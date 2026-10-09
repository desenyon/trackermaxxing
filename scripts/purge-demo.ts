import { eq, like } from "drizzle-orm";

import { db } from "../src/lib/db";
import { refreshAiDailyRollups } from "../src/lib/ai/service";
import { aiSessions, githubActivityDaily } from "../src/lib/db/schema";

async function purgeDemo() {
  db.transaction((tx) => {
    tx.delete(aiSessions).where(like(aiSessions.sourceFileHash, "demo-%")).run();
    tx.delete(githubActivityDaily).where(eq(githubActivityDaily.login, "demo-user")).run();
    refreshAiDailyRollups();
  });
  console.info("Demo records removed.");
}

purgeDemo().catch((error: unknown) => {
  console.error("Unable to remove demo data:", error);
  process.exitCode = 1;
});
