import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readLocalCodexSessions } from "@/lib/codex/parser";
import { reconcileAiSessions } from "@/lib/ai/service";
import { syncAllLocalAi } from "@/lib/sync/local-ai";
import { db } from "@/lib/db";
import { aiSessions } from "@/lib/db/schema";

const meta = JSON.stringify({ type: "session_meta", timestamp: "2026-07-16T00:00:00Z", payload: { id: "synthetic" } });
const usage = JSON.stringify({ type: "event_msg", timestamp: "2026-07-16T00:01:00Z", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, output_tokens: 10 } } } });

describe("complete source snapshots", () => {
  it("retains cached totals on malformed input but tolerates an unfinished trailing append", async () => {
    const root = join(process.env.CODEX_HOME!, "sessions");
    mkdirSync(root, { recursive: true });
    const file = join(root, "synthetic.jsonl");
    writeFileSync(file, `${meta}\n${usage}\n`);
    reconcileAiSessions("codex", await readLocalCodexSessions());
    writeFileSync(file, `${meta}\ncorrupt-record\n${usage}\n`);
    const result = await syncAllLocalAi();
    expect(result.errors.codex).toBeTruthy();
    expect(db.select().from(aiSessions).get()?.inputTokens).toBe(100);
    writeFileSync(file, `${meta}\n${usage}\n{"type":`);
    expect(await readLocalCodexSessions()).toEqual([expect.objectContaining({ inputTokens: 100 })]);
  });
});
