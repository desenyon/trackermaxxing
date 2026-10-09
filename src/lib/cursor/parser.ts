import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { promises as fs, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { CodexSession } from "@/lib/codex/parser";
import { DailyUsage, tokenNumber, type AiDailyUsage } from "@/lib/ai/session";
import { listJsonlFiles, readJsonlContent, sourcePath } from "@/lib/ingestion/files";

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : null;

const asNumber = tokenNumber;

// Some Cursor versions omit useful token counts. Fall back to content-size
// heuristics; these estimates are not Cursor billing or tokenizer measurements.
const CHARS_PER_TOKEN = 4;
const estimateTokens = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN);

// Heuristic context ceiling and compaction model, not measured model limits.
const MAX_CONTEXT_CHARS = 150_000 * CHARS_PER_TOKEN;
const COMPACTION_RATIO = 0.3;

// Tool results are input context, not generated output.
function bubbleChars(payload: JsonRecord): { ownOutputChars: number; contextChars: number } {
  const textChars = typeof payload.text === "string" ? payload.text.length : 0;
  const toolFormerData = asRecord(payload.toolFormerData);
  const paramsChars = typeof toolFormerData?.params === "string" ? toolFormerData.params.length : 0;
  const resultChars = typeof toolFormerData?.result === "string" ? toolFormerData.result.length : 0;
  return {
    ownOutputChars: textChars + paramsChars,
    contextChars: textChars + paramsChars + resultChars,
  };
}

function cursorDbPath() {
  return sourcePath(process.env.CURSOR_STATE_DB,
    join(homedir(), "Library/Application Support/Cursor/User/globalStorage/state.vscdb"));
}

export function readCursorTokenSessions(): CodexSession[] {
  const path = cursorDbPath();
  try { statSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const db = new Database(path, { readonly: true, fileMustExist: true });
  let rows: Array<{ key: string; value: string }>;
  try {
    // An older Cursor schema can legitimately lack this table; use transcripts.
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'cursorDiskKV' AND type = 'table'").get()) return [];
    rows = db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%' ORDER BY key").all() as typeof rows;
  } finally { db.close(); }

  // Group bubbles by conversation first - token accounting needs chronological
  // order within a conversation, not row order (which follows the DB, not time).
  const byConversation = new Map<string, Array<{ createdAt: Date; payload: JsonRecord }>>();
  for (const row of rows) {
    let payload: JsonRecord;
    try {
      payload = asRecord(JSON.parse(row.value)) ?? {};
    } catch {
      continue;
    }
    const conversationId = row.key.split(":")[1] ?? "unknown";
    const createdAt = typeof payload.createdAt === "string" ? new Date(payload.createdAt) : null;
    if (!createdAt || !Number.isFinite(createdAt.getTime())) continue;
    const bucket = byConversation.get(conversationId);
    if (bucket) bucket.push({ createdAt, payload });
    else byConversation.set(conversationId, [{ createdAt, payload }]);
  }

  const conversations = new Map<string, {
    firstActivity: Date;
    lastActivity: Date;
    inputTokens: number;
    outputTokens: number;
    turnCount: number;
    model: string | null;
    dailyUsage: AiDailyUsage[];
  }>();

  for (const [conversationId, bubbles] of byConversation) {
    bubbles.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    let firstActivity = bubbles[0].createdAt;
    let lastActivity = bubbles[0].createdAt;
    let inputTokens = 0;
    let outputTokens = 0;
    let turnCount = 0;
    let model: string | null = null;
    // Approximate repeated context on assistant turns when exact counts are absent.
    let cumulativeChars = 0;
    const daily = new DailyUsage();

    for (const { createdAt, payload } of bubbles) {
      if (createdAt < firstActivity) firstActivity = createdAt;
      if (createdAt > lastActivity) lastActivity = createdAt;
      if (typeof payload.model === "string") model = payload.model;

      const tokenCount = asRecord(payload.tokenCount);
      const exactInput = asNumber(tokenCount?.inputTokens);
      const exactOutput = asNumber(tokenCount?.outputTokens);
      const { ownOutputChars, contextChars } = bubbleChars(payload);

      if (exactInput + exactOutput > 0) {
        inputTokens += exactInput;
        outputTokens += exactOutput;
        turnCount += 1;
        daily.add(createdAt, { inputTokens: exactInput, outputTokens: exactOutput, turnCount: 1, estimatedCostUsd: exactInput / 1_000_000 * 2.5 + exactOutput / 1_000_000 * 10 });
        cumulativeChars += contextChars;
        continue;
      }

      if (payload.type === 2) {
        // Assistant turn: input is everything accumulated so far (the re-sent
        // context), output is only what the model itself generated this turn.
        const turnInput = estimateTokens(Math.min(cumulativeChars, MAX_CONTEXT_CHARS));
        const turnOutput = estimateTokens(ownOutputChars);
        if (turnInput + turnOutput > 0) {
          inputTokens += turnInput;
          outputTokens += turnOutput;
          turnCount += 1;
          daily.add(createdAt, { inputTokens: turnInput, outputTokens: turnOutput, turnCount: 1, estimatedCostUsd: turnInput / 1_000_000 * 2.5 + turnOutput / 1_000_000 * 10 });
        }
      }

      // The tool result (if any) still becomes part of what gets re-sent as
      // input on future turns, even though it isn't this turn's output.
      const grown = cumulativeChars + contextChars;
      cumulativeChars = grown > MAX_CONTEXT_CHARS ? MAX_CONTEXT_CHARS * COMPACTION_RATIO + contextChars : grown;
    }

    if (inputTokens + outputTokens === 0) continue;
    conversations.set(conversationId, { firstActivity, lastActivity, inputTokens, outputTokens, turnCount, model, dailyUsage: daily.rows() });
  }

  return [...conversations.entries()].map(([conversationId, session]) => {
    const sourceFileHash = createHash("sha256").update(JSON.stringify({ conversationId, bubbles: byConversation.get(conversationId) })).digest("hex");
    return {
      id: `cursor-${conversationId}`,
      sessionPath: `cursor://conversation/${conversationId}`,
      firstActivity: session.firstActivity,
      lastActivity: session.lastActivity,
      model: session.model,
      cwd: null,
      inputTokens: session.inputTokens,
      outputTokens: session.outputTokens,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      estimatedCostUsd: session.dailyUsage.reduce((sum, day) => sum + day.estimatedCostUsd, 0),
      turnCount: session.turnCount,
      sourceFileHash: `cursor-${sourceFileHash}`,
      dailyUsage: session.dailyUsage,
    };
  });
}

function messageContentChars(record: JsonRecord): number {
  const message = asRecord(record.message);
  const content = message?.content;
  if (!Array.isArray(content)) return 0;
  let chars = 0;
  for (const block of content) {
    const part = asRecord(block);
    if (!part) continue;
    if (typeof part.text === "string") chars += part.text.length;
    if (part.type === "tool_use" && part.input !== undefined) chars += JSON.stringify(part.input).length;
  }
  return chars;
}

export async function readCursorTranscriptSessions(): Promise<CodexSession[]> {
  const root = resolve(process.env.CURSOR_HOME?.replace(/^~(?=$|\/)/, homedir()) ?? join(homedir(), ".cursor"), "projects");
  const files = await listJsonlFiles(root);
  const sessions: CodexSession[] = [];
  for (const file of files) {
    if (!file.includes("/agent-transcripts/")) continue;
    const content = await readJsonlContent(file);
    const lines = content.split(/\r?\n/).filter(Boolean);
    const stat = await fs.stat(file);
    let firstActivity = stat.birthtime;
    let lastActivity = stat.mtime;
    const daily = new DailyUsage();
    let turns = 0;
    for (const line of lines) {
      try {
        const record = asRecord(JSON.parse(line));
        if (!record) continue;
        const chars = messageContentChars(record);
        const parsedDate = typeof record.timestamp === "string" ? new Date(record.timestamp) : null;
        const at = parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate : stat.birthtime;
        if (at < firstActivity) firstActivity = at;
        if (at > lastActivity) lastActivity = at;
        if (record.role === "assistant") {
          turns += 1;
          daily.add(at, { outputTokens: estimateTokens(chars), turnCount: 1 });
        } else if (record.role === "user") {
          daily.add(at, { inputTokens: estimateTokens(chars) });
        }
      } catch {
        continue;
      }
    }
    if (turns === 0) continue;
    const sourceFileHash = createHash("sha256").update(content).digest("hex");
    sessions.push({
      id: `cursor-transcript-${sourceFileHash.slice(0, 12)}`,
      sessionPath: file,
      firstActivity,
      lastActivity,
      model: null,
      cwd: null,
      inputTokens: daily.totals().inputTokens,
      outputTokens: daily.totals().outputTokens,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      estimatedCostUsd: 0,
      turnCount: turns,
      sourceFileHash: `cursor-tx-${sourceFileHash}`,
      dailyUsage: daily.rows(),
    });
  }
  return sessions;
}

export async function readLocalCursorSessions() {
  const tokenSessions = readCursorTokenSessions();
  if (tokenSessions.length > 0) return tokenSessions;
  return readCursorTranscriptSessions();
}
