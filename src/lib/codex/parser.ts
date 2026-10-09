import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

import { DailyUsage, emptyUsage, tokenNumber, type AiSession } from "@/lib/ai/session";
import { listJsonlFiles, readJsonlContent } from "@/lib/ingestion/files";

// Compatibility alias for existing consumers; all providers use AiSession.
export type CodexSession = AiSession;

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : null;

const asNumber = tokenNumber;

function timestampFrom(record: JsonRecord): Date | null {
  for (const key of ["timestamp", "created_at", "time"]) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  return null;
}

function priceTokens(model: string | null, input: number, cached: number, output: number): number {
  // Fixed API-equivalent heuristics, not billing rates or plan charges.
  const rates = model?.includes("mini")
    ? { input: 0.4, cached: 0.1, output: 1.6 }
    : { input: 2.5, cached: 0.625, output: 10 };
  return ((input - Math.min(input, cached)) * rates.input + Math.min(input, cached) * rates.cached + output * rates.output) / 1_000_000;
}

export function parseCodexJsonl(content: string, sessionPath: string): CodexSession | null {
  const lines = content.split(/\r?\n/);
  let sessionId = basename(sessionPath, ".jsonl");
  let model: string | null = null;
  let cwd: string | null = null;
  let firstActivity: Date | null = null;
  let lastActivity: Date | null = null;
  let turnCount = 0;
  const daily = new DailyUsage();
  let previous = emptyUsage();
  let pending = emptyUsage();

  for (const line of lines) {
    if (!line.trim()) continue;
    let record: JsonRecord;
    try {
      const parsed: unknown = JSON.parse(line);
      record = asRecord(parsed) ?? {};
    } catch {
      continue;
    }

    const timestamp = timestampFrom(record);
    if (timestamp) {
      if (!firstActivity || timestamp < firstActivity) firstActivity = timestamp;
      if (!lastActivity || timestamp > lastActivity) lastActivity = timestamp;
    }

    const payload = asRecord(record.payload);
    const recordType = record.type ?? payload?.type;
    const candidate = payload ?? record;

    if (recordType === "session_meta") {
      sessionId = String(candidate.id ?? candidate.session_id ?? sessionId);
      cwd = typeof candidate.cwd === "string" ? candidate.cwd : cwd;
      model = typeof candidate.model === "string" ? candidate.model : model;
    }

    if (recordType === "turn_context") {
      model = typeof candidate.model === "string" ? candidate.model : model;
      cwd = typeof candidate.cwd === "string" ? candidate.cwd : cwd;
    }

    if (recordType === "response_item") {
      turnCount += 1;
      if (timestamp ?? lastActivity) daily.add((timestamp ?? lastActivity)!, { turnCount: 1 });
    }

    const eventPayload = asRecord(record.payload);
    const tokenInfo = asRecord(eventPayload?.info);
    if (record.type === "event_msg" && eventPayload?.type === "token_count") {
      const eventModel = eventPayload.model ?? tokenInfo?.model;
      model = typeof eventModel === "string" ? eventModel : model;
      const total = asRecord(tokenInfo?.total_token_usage) ?? asRecord(eventPayload.total_token_usage);
      const raw = total ?? asRecord(tokenInfo?.last_token_usage) ?? asRecord(eventPayload.last_token_usage);
      const at = timestamp ?? lastActivity;
      if (!raw || !at) continue;
      const current = {
        ...emptyUsage(),
        inputTokens: asNumber(raw.input_tokens),
        outputTokens: asNumber(raw.output_tokens),
        cachedInputTokens: asNumber(raw.cached_input_tokens ?? raw.cache_read_input_tokens),
        reasoningTokens: asNumber(raw.reasoning_tokens ?? raw.reasoning_output_tokens),
      };
      const delta = { ...current };
      const fields = ["inputTokens", "outputTokens", "cachedInputTokens", "reasoningTokens"] as const;
      if (total) {
        // A lower cumulative input/output starts a new counter segment.
        const reset = current.inputTokens < previous.inputTokens || current.outputTokens < previous.outputTokens;
        for (const field of fields) delta[field] = Math.max(0, current[field] - (reset ? 0 : previous[field] + pending[field]));
        previous = current;
        pending = emptyUsage();
      } else {
        for (const field of fields) pending[field] += current[field];
      }
      delta.estimatedCostUsd = priceTokens(model, delta.inputTokens, delta.cachedInputTokens, delta.outputTokens);
      daily.add(at, delta);
    }
  }

  if (!firstActivity || !lastActivity) return null;

  // Timestamp-free records use the last observed timestamp; a fully undated file is ignored.
  if (daily.rows().length === 0) daily.add(firstActivity, {});
  const missingTurns = turnCount - daily.totals().turnCount;
  if (missingTurns > 0) daily.add(firstActivity, { turnCount: missingTurns });
  const totals = daily.totals();

  const sourceFileHash = createHash("sha256").update(content).digest("hex");
  return {
    // Source label only; persistence derives stable identity from provider/path.
    id: `${sessionId}-${sourceFileHash.slice(0, 12)}`,
    sessionPath,
    firstActivity,
    lastActivity,
    model,
    cwd,
    ...totals,
    turnCount,
    dailyUsage: daily.rows(),
    sourceFileHash,
  };
}

export async function readLocalCodexSessions(): Promise<CodexSession[]> {
  const codexHome = resolve(process.env.CODEX_HOME?.replace(/^~(?=$|\/)/, homedir()) ?? join(homedir(), ".codex"));
  const files = await listJsonlFiles(join(codexHome, "sessions"));
  const sessions = [];
  for (const file of files) sessions.push(parseCodexJsonl(await readJsonlContent(file), file));
  return sessions.filter((session): session is CodexSession => session !== null);
}
