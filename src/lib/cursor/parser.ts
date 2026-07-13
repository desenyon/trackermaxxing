import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { type Dirent, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { CodexSession } from "@/lib/codex/parser";

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : null;

const asNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

// Current Cursor builds no longer populate per-message tokenCount in cursorDiskKV
// (verified: every bubble row has {inputTokens: 0, outputTokens: 0}) - usage
// accounting moved server-side. When exact counts are absent, approximate from
// the actual message + tool-call content using the standard ~4-chars-per-token
// rule of thumb. This is a size-based estimate, not Cursor's billed token count -
// cursor.com/dashboard remains the source of truth for exact usage.
const CHARS_PER_TOKEN = 4;
const estimateTokens = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN);

// No single call can be billed for more than the model's context window, no
// matter how long the conversation has run - once history would exceed it, the
// agent has already summarized/dropped older turns. Calibrated against Cursor's
// own composerHeaders.contextUsagePercent (the % of context in use it reports
// per conversation): back-solving window size = impliedTokens / (pct/100)
// across real sessions here clusters at a median of ~150K tokens once tool
// results are excluded from the char count - use that instead of guessing.
const MAX_CONTEXT_CHARS = 150_000 * CHARS_PER_TOKEN;
// Long-running agent loops don't sit pinned at the ceiling forever either - like
// Claude Code and other agent harnesses, they compact/summarize history once the
// window fills, then keep growing from a much smaller base. Modeling a hard cap
// alone still overstates very long sessions (thousands of turns in one sitting),
// so once the cap is hit, collapse back to this fraction of it.
const COMPACTION_RATIO = 0.3;

// toolFormerData.result is the tool's return value - file contents, command
// output, search hits - fed back to the model as *input* on the next turn, not
// something the model generated. Only text and the call itself (params) are
// genuinely this turn's output; folding result in too (as an earlier version
// did) inflated output tokens by ~4x here, since a single large command/file
// read can dwarf everything else in the conversation combined.
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
  return resolve(
    process.env.CURSOR_STATE_DB ??
      join(homedir(), "Library/Application Support/Cursor/User/globalStorage/state.vscdb"),
  );
}

export function readCursorTokenSessions(): CodexSession[] {
  let db: Database.Database;
  try {
    db = new Database(cursorDbPath(), { readonly: true, fileMustExist: true });
  } catch {
    return [];
  }

  const rows = db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'").all() as Array<{ key: string; value: string }>;
  db.close();

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
    const createdAt = typeof payload.createdAt === "string" ? new Date(payload.createdAt) : new Date();
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
  }>();

  for (const [conversationId, bubbles] of byConversation) {
    bubbles.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    let firstActivity = bubbles[0].createdAt;
    let lastActivity = bubbles[0].createdAt;
    let inputTokens = 0;
    let outputTokens = 0;
    let turnCount = 0;
    let model: string | null = null;
    // Every provider (Codex, Claude) bills the FULL conversation-so-far as input
    // on each turn, since agent loops re-send prior context every call. Cursor no
    // longer exposes exact per-call counts, so this walks bubbles chronologically
    // and rebuilds that same cumulative-context shape from message + tool-call
    // content size, instead of counting each message once in isolation (which
    // silently drops the context-regrowth cost that dominates real usage).
    let cumulativeChars = 0;

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
        }
      }

      // The tool result (if any) still becomes part of what gets re-sent as
      // input on future turns, even though it isn't this turn's output.
      const grown = cumulativeChars + contextChars;
      cumulativeChars = grown > MAX_CONTEXT_CHARS ? MAX_CONTEXT_CHARS * COMPACTION_RATIO + contextChars : grown;
    }

    if (inputTokens + outputTokens === 0) continue;
    conversations.set(conversationId, { firstActivity, lastActivity, inputTokens, outputTokens, turnCount, model });
  }

  return [...conversations.entries()].map(([conversationId, session]) => {
    const sourceFileHash = createHash("sha256").update(conversationId).digest("hex");
    return {
      id: `cursor-${conversationId.slice(0, 24)}`,
      sessionPath: `cursor://conversation/${conversationId}`,
      firstActivity: session.firstActivity,
      lastActivity: session.lastActivity,
      model: session.model,
      cwd: null,
      inputTokens: session.inputTokens,
      outputTokens: session.outputTokens,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      estimatedCostUsd: session.inputTokens / 1_000_000 * 2.5 + session.outputTokens / 1_000_000 * 10,
      turnCount: session.turnCount,
      sourceFileHash: `cursor-${sourceFileHash}`,
    };
  });
}

async function listTranscriptFiles(directory: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return listTranscriptFiles(path);
      return Promise.resolve(entry.isFile() && entry.name.endsWith(".jsonl") ? [path] : []);
    }),
  );
  return nested.flat();
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
  const files = await listTranscriptFiles(root);
  const sessions: CodexSession[] = [];
  for (const file of files) {
    if (!file.includes("/agent-transcripts/")) continue;
    const content = await fs.readFile(file, "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);
    let turns = 0;
    let inputChars = 0;
    let outputChars = 0;
    let firstActivity: Date | null = null;
    let lastActivity: Date | null = null;
    for (const line of lines) {
      try {
        const record = asRecord(JSON.parse(line));
        if (!record) continue;
        const chars = messageContentChars(record);
        if (record.role === "assistant") {
          turns += 1;
          outputChars += chars;
        } else if (record.role === "user") {
          inputChars += chars;
        }
      } catch {
        continue;
      }
    }
    const stat = await fs.stat(file);
    firstActivity = stat.birthtime;
    lastActivity = stat.mtime;
    if (turns === 0) continue;
    const sourceFileHash = createHash("sha256").update(content).digest("hex");
    sessions.push({
      id: `cursor-transcript-${sourceFileHash.slice(0, 12)}`,
      sessionPath: file,
      firstActivity,
      lastActivity,
      model: null,
      cwd: null,
      inputTokens: estimateTokens(inputChars),
      outputTokens: estimateTokens(outputChars),
      cachedInputTokens: 0,
      reasoningTokens: 0,
      estimatedCostUsd: 0,
      turnCount: turns,
      sourceFileHash: `cursor-tx-${sourceFileHash}`,
    });
  }
  return sessions;
}

export async function readLocalCursorSessions() {
  const tokenSessions = readCursorTokenSessions();
  if (tokenSessions.length > 0) return tokenSessions;
  return readCursorTranscriptSessions();
}
