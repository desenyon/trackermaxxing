import { db } from "../src/lib/db";
import { aiDailyRollups, aiSessions, githubActivityDaily } from "../src/lib/db/schema";

async function seed() {
  const now = new Date();
  for (let offset = 0; offset < 28; offset += 1) {
    const day = new Date(now);
    day.setUTCDate(now.getUTCDate() - offset);
    const date = day.toISOString().slice(0, 10);
    const input = 25_000 + ((offset * 4_271) % 55_000);
    const output = 9_000 + ((offset * 1_777) % 22_000);
    await db.insert(aiDailyRollups).values({ date, provider: "codex", inputTokens: input, outputTokens: output, cachedTokens: Math.floor(input * .25), sessionCount: 1 + offset % 5, turnCount: 6 + offset % 16, costUsd: input / 1_000_000 * 2.5 + output / 1_000_000 * 10 }).onConflictDoUpdate({ target: [aiDailyRollups.date, aiDailyRollups.provider], set: { inputTokens: input, outputTokens: output } });
    await db.insert(githubActivityDaily).values({ day: date, login: "demo-user", commits: offset % 6, prsOpened: offset % 3 === 0 ? 1 : 0, prsMerged: offset % 5 === 0 ? 1 : 0, prsReviewed: offset % 4, issuesOpened: offset % 7 === 0 ? 1 : 0, pushEvents: offset % 6 }).onConflictDoUpdate({ target: [githubActivityDaily.day, githubActivityDaily.login], set: { commits: offset % 6 } });
    if (offset < 8) await db.insert(aiSessions).values({ id: `demo-${offset}`, provider: "codex", sessionPath: `demo/session-${offset}.jsonl`, firstActivity: day, lastActivity: day, model: "gpt-5-codex", cwd: "/workspace/demo", inputTokens: input, outputTokens: output, cachedInputTokens: Math.floor(input * .25), reasoningTokens: Math.floor(output * .15), estimatedCostUsd: input / 1_000_000 * 2.5 + output / 1_000_000 * 10, turnCount: 6 + offset, sourceFileHash: `demo-${offset}` }).onConflictDoNothing();
  }
  console.info("Demo analytics data seeded.");
}

seed().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
