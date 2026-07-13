import { createHash } from "node:crypto";
import { type Dirent, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

export interface CodexSession {
  id: string;
  sessionPath: string;
  firstActivity: Date;
  lastActivity: Date;
  model: string | null;
  cwd: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  estimatedCostUsd: number;
  turnCount: number;
  sourceFileHash: string;
}

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : null;

const asNumber = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

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
  // Conservative public API-equivalent defaults. Users can override pricing in Settings later.
  const rates = model?.includes("mini")
    ? { input: 0.4, cached: 0.1, output: 1.6 }
    : { input: 2.5, cached: 0.625, output: 10 };
  return ((input - cached) * rates.input + cached * rates.cached + output * rates.output) / 1_000_000;
}

export function parseCodexJsonl(content: string, sessionPath: string): CodexSession | null {
  const lines = content.split(/\r?\n/);
  let sessionId = basename(sessionPath, ".jsonl");
  let model: string | null = null;
  let cwd: string | null = null;
  let firstActivity: Date | null = null;
  let lastActivity: Date | null = null;
  let turnCount = 0;
  let tokenUsage: JsonRecord | null = null;

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
      firstActivity ??= timestamp;
      lastActivity = timestamp;
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

    if (recordType === "response_item") turnCount += 1;

    const eventPayload = asRecord(record.payload);
    const tokenInfo = asRecord(eventPayload?.info);
    if (record.type === "event_msg" && eventPayload?.type === "token_count") {
      tokenUsage =
        asRecord(tokenInfo?.total_token_usage) ??
        asRecord(tokenInfo?.last_token_usage) ??
        asRecord(eventPayload.total_token_usage) ??
        asRecord(eventPayload.last_token_usage) ??
        tokenUsage;
      const eventModel = eventPayload.model ?? tokenInfo?.model;
      model = typeof eventModel === "string" ? eventModel : model;
    }
  }

  if (!firstActivity || !lastActivity) return null;

  const inputTokens = asNumber(tokenUsage?.input_tokens);
  const cachedInputTokens = asNumber(tokenUsage?.cached_input_tokens ?? tokenUsage?.cache_read_input_tokens);
  const outputTokens = asNumber(tokenUsage?.output_tokens);
  const reasoningTokens = asNumber(tokenUsage?.reasoning_tokens ?? tokenUsage?.reasoning_output_tokens);

  const sourceFileHash = createHash("sha256").update(content).digest("hex");
  return {
    // Forked and subagent sessions can share a Codex session_id. The file hash
    // keeps database identity unique while preserving the source session prefix.
    id: `${sessionId}-${sourceFileHash.slice(0, 12)}`,
    sessionPath,
    firstActivity,
    lastActivity,
    model,
    cwd,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningTokens,
    estimatedCostUsd: priceTokens(model, inputTokens, cachedInputTokens, outputTokens),
    turnCount,
    sourceFileHash,
  };
}

async function listJsonlFiles(directory: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return listJsonlFiles(path);
      return Promise.resolve(entry.isFile() && entry.name.endsWith(".jsonl") ? [path] : []);
    }),
  );
  return nested.flat();
}

export async function readLocalCodexSessions(): Promise<CodexSession[]> {
  const codexHome = resolve(process.env.CODEX_HOME?.replace(/^~(?=$|\/)/, homedir()) ?? join(homedir(), ".codex"));
  const files = await listJsonlFiles(join(codexHome, "sessions"));
  const sessions = await Promise.all(
    files.map(async (file) => parseCodexJsonl(await fs.readFile(file, "utf8"), file)),
  );
  return sessions.filter((session): session is CodexSession => session !== null);
}
