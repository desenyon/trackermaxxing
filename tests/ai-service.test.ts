import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { parseCodexJsonl } from "@/lib/codex/parser";
import { parseClaudeJsonl } from "@/lib/claude/parser";
import type { CodexSession } from "@/lib/codex/parser";

const directory = mkdtempSync(resolve(tmpdir(), "trackermaxxing-ai-service-"));
process.env.DATABASE_PATH = resolve(directory, "data.db");
process.env.TRACKER_MIGRATIONS_PATH = resolve(import.meta.dirname, "../drizzle");

let service: typeof import("@/lib/ai/service");
let database: typeof import("@/lib/db");
let schema: typeof import("@/lib/db/schema");

const session = (overrides: Partial<CodexSession> = {}): CodexSession => ({
  id: "session-1",
  sessionPath: "/sessions/one.jsonl",
  firstActivity: new Date("2026-07-14T01:00:00Z"),
  lastActivity: new Date("2026-07-14T02:00:00Z"),
  model: "test",
  cwd: null,
  inputTokens: 10,
  outputTokens: 5,
  cachedInputTokens: 2,
  reasoningTokens: 1,
  estimatedCostUsd: 0.01,
  turnCount: 2,
  sourceFileHash: "hash-1",
  ...overrides,
});

beforeAll(async () => {
  service = await import("@/lib/ai/service");
  database = await import("@/lib/db");
  schema = await import("@/lib/db/schema");
});

beforeEach(() => { database.sqlite.exec("DELETE FROM ai_sessions; DELETE FROM ai_daily_rollups;"); });

afterAll(() => {
  database.sqlite.close();
  rmSync(directory, { recursive: true, force: true });
  delete process.env.DATABASE_PATH;
  delete process.env.TRACKER_MIGRATIONS_PATH;
});

describe("AI session reconciliation", () => {
  it("is idempotent for an unchanged provider snapshot", async () => {
    service.reconcileAiSessions("codex", [session()]);
    service.reconcileAiSessions("codex", [session()]);

    const rows = await database.db.select().from(schema.aiSessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.inputTokens).toBe(10);
  });

  it("removes source sessions that disappeared", async () => {
    service.reconcileAiSessions("codex", [session(), session({ id: "session-2", sessionPath: "/sessions/two.jsonl" })]);
    service.reconcileAiSessions("codex", [session()]);

    const rows = await database.db.select().from(schema.aiSessions);
    expect(rows.map((row) => row.sessionPath)).toEqual(["/sessions/one.jsonl"]);
  });

  it("rebuilds rollups so deleted and moved sessions cannot leave stale totals", async () => {
    service.reconcileAiSessions("codex", [session()]);
    service.refreshAiDailyRollups();
    service.reconcileAiSessions("codex", [session({ firstActivity: new Date("2026-07-15T01:00:00Z") })]);
    service.refreshAiDailyRollups();

    let rollups = await database.db.select().from(schema.aiDailyRollups);
    expect(rollups.map((row) => row.date)).toEqual(["2026-07-15"]);

    service.reconcileAiSessions("codex", []);
    service.refreshAiDailyRollups();
    rollups = await database.db.select().from(schema.aiDailyRollups);
    expect(rollups).toEqual([]);
  });
});


describe("daily ingestion boundaries", () => {
  it("attributes cumulative Codex deltas to UTC event days and publishes rollups atomically", async () => {
    const rows = [
      { type: "session_meta", timestamp: "2026-07-14T23:00:00Z", payload: { id: "overnight" } },
      ...[["2026-07-14T23:59:00Z", 100, 20], ["2026-07-15T00:01:00Z", 160, 30], ["2026-07-15T00:02:00Z", 160, 30]].map(([timestamp, input_tokens, output_tokens]) => ({
        type: "event_msg", timestamp, payload: { type: "token_count", info: { total_token_usage: { input_tokens, output_tokens } } },
      })),
    ];
    const parsed = parseCodexJsonl(rows.map((row) => JSON.stringify(row)).join("\n"), "/sessions/overnight.jsonl")!;
    service.reconcileAiSessions("codex", [parsed]);
    const daily = await database.db.select().from(schema.aiDailyRollups).orderBy(schema.aiDailyRollups.date);
    expect(daily.map(({ date, inputTokens, outputTokens }) => ({ date, inputTokens, outputTokens }))).toEqual([
      { date: "2026-07-14", inputTokens: 100, outputTokens: 20 },
      { date: "2026-07-15", inputTokens: 60, outputTokens: 10 },
    ]);
    service.reconcileAiSessions("codex", [parsed]);
    service.refreshAiDailyRollups();
    expect(await database.db.select().from(schema.aiDailyRollups).orderBy(schema.aiDailyRollups.date)).toEqual(daily);
  });

  it("attributes Claude messages to their timestamp including timezone offsets", async () => {
    service.reconcileAiSessions("codex", []);
    const parsed = parseClaudeJsonl([
      { type: "assistant", timestamp: "2026-07-14T23:00:00-02:00", message: { id: "a", usage: { input_tokens: 20, output_tokens: 5 } } },
      { type: "assistant", timestamp: "2026-07-16T00:00:00Z", message: { id: "b", usage: { input_tokens: 30, output_tokens: 7 } } },
    ].map((row) => JSON.stringify(row)).join("\n"), "/sessions/claude.jsonl", new Set())!;
    service.reconcileAiSessions("claude", [parsed]);
    service.refreshAiDailyRollups();
    const daily = await database.db.select().from(schema.aiDailyRollups).orderBy(schema.aiDailyRollups.date);
    expect(daily.map(({ date, inputTokens, outputTokens, turnCount }) => ({ date, inputTokens, outputTokens, turnCount }))).toEqual([
      { date: "2026-07-15", inputTokens: 20, outputTokens: 5, turnCount: 1 },
      { date: "2026-07-16", inputTokens: 30, outputTokens: 7, turnCount: 1 },
    ]);
    service.reconcileAiSessions("claude", []);
  });

  it("does not erase a cached provider when its source directory is unavailable", async () => {
    service.reconcileAiSessions("codex", [session()]);
    const { syncAllLocalAi } = await import("@/lib/sync/local-ai");
    await syncAllLocalAi();
    expect(await database.db.select().from(schema.aiSessions)).toHaveLength(1);
  });
});


it("keeps identical content at different source paths independent", async () => {
  service.reconcileAiSessions("codex", [session(), session({ sessionPath: "/sessions/copy.jsonl" })]);
  expect(await database.db.select().from(schema.aiSessions)).toHaveLength(2);
});

it("rolls back the entire provider snapshot if a daily ledger is invalid", async () => {
  service.reconcileAiSessions("codex", [session()]);
  expect(() => service.reconcileAiSessions("codex", [session({ inputTokens: 100 }), session({ id: "bad", sessionPath: "/bad.jsonl", dailyUsage: [] })])).toThrow();
  expect(await database.db.select().from(schema.aiSessions)).toEqual([expect.objectContaining({ inputTokens: 10 })]);
  expect(await database.db.select().from(schema.aiDailyRollups)).toEqual([expect.objectContaining({ inputTokens: 10 })]);
});

it("reads one consistent overview while a sync replaces the provider", async () => {
  service.reconcileAiSessions("codex", [session()]);
  const pending = service.getUnifiedOverview(36500);
  await Promise.resolve();
  await Promise.resolve();
  service.reconcileAiSessions("codex", [session({ inputTokens: 100 })]);
  const overview = await pending;
  expect(overview.daily.reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0)).toBe(overview.lifetime.totalTokens);
});
