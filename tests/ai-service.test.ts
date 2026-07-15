import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
