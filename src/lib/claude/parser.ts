import { createHash } from "node:crypto";
import { type Dirent, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

import type { CodexSession } from "@/lib/codex/parser";

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : null;

const asNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

function claudeUsage(message: JsonRecord) {
  const usage = asRecord(message.usage) ?? {};
  const input = asNumber(usage.input_tokens);
  const cacheCreate = asNumber(usage.cache_creation_input_tokens);
  const cacheRead = asNumber(usage.cache_read_input_tokens);
  const output = asNumber(usage.output_tokens);
  return {
    inputTokens: input + cacheCreate + cacheRead,
    outputTokens: output,
    cachedInputTokens: cacheRead,
    reasoningTokens: 0,
  };
}

export function parseClaudeJsonl(content: string, sessionPath: string, seenMessageIds: Set<string>): CodexSession | null {
  const lines = content.split(/\r?\n/);
  const sessionId = basename(sessionPath, ".jsonl");
  let model: string | null = null;
  let cwd: string | null = null;
  let firstActivity: Date | null = null;
  let lastActivity: Date | null = null;
  let turnCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    let record: JsonRecord;
    try {
      record = asRecord(JSON.parse(line)) ?? {};
    } catch {
      continue;
    }

    const timestamp = typeof record.timestamp === "string" ? new Date(record.timestamp) : null;
    if (timestamp && !Number.isNaN(timestamp.getTime())) {
      firstActivity ??= timestamp;
      lastActivity = timestamp;
    }

    cwd = typeof record.cwd === "string" ? record.cwd : cwd;
    if (record.type === "assistant") {
      const message = asRecord(record.message);
      if (!message) continue;
      const messageId = typeof message.id === "string" ? message.id : null;
      if (messageId && seenMessageIds.has(messageId)) continue;
      if (messageId) seenMessageIds.add(messageId);
      model = typeof message.model === "string" ? message.model : model;
      const usage = claudeUsage(message);
      inputTokens += usage.inputTokens;
      outputTokens += usage.outputTokens;
      cachedInputTokens += usage.cachedInputTokens;
      turnCount += 1;
    }
  }

  if (!firstActivity || !lastActivity || turnCount === 0) return null;
  const sourceFileHash = createHash("sha256").update(content).digest("hex");
  return {
    id: `claude-${sessionId}-${sourceFileHash.slice(0, 12)}`,
    sessionPath,
    firstActivity,
    lastActivity,
    model,
    cwd,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningTokens: 0,
    estimatedCostUsd: inputTokens / 1_000_000 * 3 + outputTokens / 1_000_000 * 15,
    turnCount,
    sourceFileHash,
  };
}

async function listJsonlFiles(directory: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
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

export async function readLocalClaudeSessions() {
  const root = resolve(process.env.CLAUDE_CONFIG_DIR?.replace(/^~(?=$|\/)/, homedir()) ?? join(homedir(), ".claude"), "projects");
  const files = await listJsonlFiles(root);

  // Resuming a Claude Code session writes a *new* file that re-embeds the
  // entire prior transcript before continuing - the same assistant messages
  // (and their tokens) then exist in both the original file and every
  // resumed continuation. Deduping per-file (as parseClaudeJsonl does on its
  // own) doesn't catch this since it's genuinely two different files; this
  // walks files oldest-first with one shared seen-set so a message counts
  // once, credited to whichever file it actually appeared in first.
  const withMtime = await Promise.all(
    files.map(async (file) => ({ file, mtime: (await fs.stat(file)).mtime })),
  );
  withMtime.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());

  const seenMessageIds = new Set<string>();
  const sessions: CodexSession[] = [];
  for (const { file } of withMtime) {
    const content = await fs.readFile(file, "utf8");
    const session = parseClaudeJsonl(content, file, seenMessageIds);
    if (session) sessions.push(session);
  }
  return sessions;
}
