import { eq, like } from "drizzle-orm";

import { db } from "../src/lib/db";
import { refreshAiDailyRollups } from "../src/lib/ai/service";
import { aiSessions, githubActivityDaily } from "../src/lib/db/schema";

async function purgeDemo() {
  await db.delete(aiSessions).where(like(aiSessions.sourceFileHash, "demo-%"));
  await db.delete(githubActivityDaily).where(eq(githubActivityDaily.login, "demo-user"));
  refreshAiDailyRollups();
  console.info("Demo records removed.");
}

purgeDemo().catch((error: unknown) => {
  console.error("Unable to remove demo data:", error);
  process.exitCode = 1;
});
