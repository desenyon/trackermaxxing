import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseClaudeJsonl } from "@/lib/claude/parser";
import { parseCodexJsonl } from "@/lib/codex/parser";
import { readCursorTokenSessions, readCursorTranscriptSessions } from "@/lib/cursor/parser";
import { decryptSecret, encryptSecret } from "@/lib/settings/secure-store";

const tempRoots: string[] = [];
const originalCursorDb = process.env.CURSOR_STATE_DB;
const originalCursorHome = process.env.CURSOR_HOME;
const originalEncryptionKey = process.env.TRACKER_ENCRYPTION_KEY;

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), "trackermaxxing-test-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  if (originalCursorDb === undefined) delete process.env.CURSOR_STATE_DB;
  else process.env.CURSOR_STATE_DB = originalCursorDb;
  if (originalCursorHome === undefined) delete process.env.CURSOR_HOME;
  else process.env.CURSOR_HOME = originalCursorHome;
  if (originalEncryptionKey === undefined) delete process.env.TRACKER_ENCRYPTION_KEY;
  else process.env.TRACKER_ENCRYPTION_KEY = originalEncryptionKey;
});

describe("Codex and Claude parsers", () => {
  it("uses the latest Codex token snapshot and preserves session metadata", () => {
    const content = [
      { type: "session_meta", timestamp: "2026-07-01T00:00:00Z", payload: { id: "abc", cwd: "/repo", model: "gpt-5" } },
      { type: "response_item", timestamp: "2026-07-01T00:01:00Z", payload: {} },
      { type: "event_msg", timestamp: "2026-07-01T00:02:00Z", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 30, reasoning_output_tokens: 7 } } } },
      { type: "event_msg", timestamp: "2026-07-01T00:03:00Z", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 200, cached_input_tokens: 40, output_tokens: 60, reasoning_output_tokens: 9 } } } },
    ].map((value) => JSON.stringify(value)).join("\n");
    const session = parseCodexJsonl(content, "/tmp/fallback.jsonl");
    expect(session).toMatchObject({ model: "gpt-5", cwd: "/repo", inputTokens: 200, cachedInputTokens: 40, outputTokens: 60, reasoningTokens: 9, turnCount: 1 });
    expect(session?.id).toMatch(/^abc-[a-f0-9]{12}$/);
  });

  it("deduplicates resumed Claude messages across files", () => {
    const row = JSON.stringify({
      type: "assistant", timestamp: "2026-07-01T00:00:00Z", cwd: "/repo",
      message: { id: "msg-1", model: "claude-sonnet", usage: { input_tokens: 10, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 4 } },
    });
    const seen = new Set<string>();
    expect(parseClaudeJsonl(row, "/tmp/one.jsonl", seen)).toMatchObject({ inputTokens: 15, cachedInputTokens: 3, outputTokens: 4, turnCount: 1 });
    expect(parseClaudeJsonl(row, "/tmp/two.jsonl", seen)).toBeNull();
  });

  it("rejects files without usable activity", () => {
    expect(parseCodexJsonl("not-json", "/tmp/empty.jsonl")).toBeNull();
    expect(parseClaudeJsonl("{}", "/tmp/empty.jsonl", new Set())).toBeNull();
  });
});

describe("Cursor parsers", () => {
  it("reads exact token counts from Cursor's state database", () => {
    const dbPath = join(tempRoot(), "state.vscdb");
    const sqlite = new Database(dbPath);
    sqlite.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    sqlite.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)").run("bubbleId:conversation-1:first", JSON.stringify({
      createdAt: "2026-07-01T00:00:00Z", type: 2, model: "cursor-model", tokenCount: { inputTokens: 11, outputTokens: 7 }, text: "answer",
    }));
    sqlite.close();
    process.env.CURSOR_STATE_DB = dbPath;

    expect(readCursorTokenSessions()).toEqual([expect.objectContaining({ inputTokens: 11, outputTokens: 7, turnCount: 1, model: "cursor-model" })]);
  });

  it("falls back to transcript content when the state database is unavailable", async () => {
    const root = tempRoot();
    const transcripts = join(root, "projects", "demo", "agent-transcripts");
    mkdirSync(transcripts, { recursive: true });
    writeFileSync(join(transcripts, "session.jsonl"), [
      { role: "user", message: { content: [{ type: "text", text: "12345678" }] } },
      { role: "assistant", message: { content: [{ type: "text", text: "123456789012" }] } },
    ].map((value) => JSON.stringify(value)).join("\n"));
    process.env.CURSOR_HOME = root;
    process.env.CURSOR_STATE_DB = join(root, "missing.db");

    expect(await readCursorTranscriptSessions()).toEqual([expect.objectContaining({ inputTokens: 2, outputTokens: 3, turnCount: 1 })]);
  });
});

describe("secret encryption", () => {
  it("round-trips with authenticated encryption and rejects tampering", () => {
    process.env.TRACKER_ENCRYPTION_KEY = "test-only-key";
    const encrypted = encryptSecret("github-token");
    expect(encrypted).not.toContain("github-token");
    expect(decryptSecret(encrypted)).toBe("github-token");
    const parts = encrypted.split(":");
    parts[3] = `${parts[3].slice(0, -1)}${parts[3].endsWith("A") ? "B" : "A"}`;
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });

  it("rejects malformed ciphertext", () => {
    process.env.TRACKER_ENCRYPTION_KEY = "test-only-key";
    expect(() => decryptSecret("plaintext")).toThrow("invalid format");
  });
});
