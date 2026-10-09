import { and, eq } from "drizzle-orm";

import { db } from "../src/lib/db";
import { refreshAiDailyRollups } from "../src/lib/ai/service";
import { aiSessionDaily, aiSessions, githubActivityDaily } from "../src/lib/db/schema";

// Run against an explicit sandbox cache, e.g. DATABASE_PATH=/tmp/trackermaxxing-demo.db.
// Upsert only demo paths; never reconcile/replace the user's complete provider.
function seed() {
  const now = new Date();
  db.transaction((tx) => {
    for (let offset = 0; offset < 28; offset += 1) {
      const day = new Date(now); day.setUTCDate(now.getUTCDate() - offset);
      const date = day.toISOString().slice(0, 10);
      const inputTokens = 25_000 + ((offset * 4_271) % 55_000);
      const outputTokens = 9_000 + ((offset * 1_777) % 22_000);
      const usage = { inputTokens, outputTokens, cachedInputTokens: Math.floor(inputTokens * .25), reasoningTokens: Math.floor(outputTokens * .15), estimatedCostUsd: inputTokens / 1_000_000 * 2.5 + outputTokens / 1_000_000 * 10, turnCount: 6 + offset };
      const sessionPath = `demo/session-${offset}.jsonl`;
      const session = { id: `demo-${offset}`, provider: "codex", sessionPath, firstActivity: day, lastActivity: day, model: "demo-model", cwd: "/workspace/demo", ...usage, sourceFileHash: `demo-${offset}` };
      tx.insert(aiSessions).values(session).onConflictDoUpdate({ target: [aiSessions.provider, aiSessions.sessionPath], set: session }).run();
      tx.delete(aiSessionDaily).where(and(eq(aiSessionDaily.provider, "codex"), eq(aiSessionDaily.sessionPath, sessionPath))).run();
      tx.insert(aiSessionDaily).values({ provider: "codex", sessionPath, date, ...usage }).onConflictDoUpdate({ target: [aiSessionDaily.provider, aiSessionDaily.sessionPath, aiSessionDaily.date], set: usage }).run();
      const activity = { day: date, login: "demo-user", commits: offset % 6, prsOpened: offset % 3 === 0 ? 1 : 0, prsMerged: offset % 5 === 0 ? 1 : 0, prsReviewed: offset % 4, issuesOpened: offset % 7 === 0 ? 1 : 0, pushEvents: offset % 6 };
      tx.insert(githubActivityDaily).values(activity).onConflictDoUpdate({ target: [githubActivityDaily.day, githubActivityDaily.login], set: activity }).run();
    }
    refreshAiDailyRollups();
  });
  console.info("Demo analytics data seeded.");
}

try { seed(); } catch (error) { console.error(error); process.exitCode = 1; }
