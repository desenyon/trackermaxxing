import cron from "node-cron";

import { syncAllLocalAi } from "../src/lib/sync/local-ai";
import { syncGithubActivity } from "../src/lib/github/activity";

async function runDailySync() {
  await syncAllLocalAi();
  try {
    await syncGithubActivity();
  } catch (error) {
    console.warn("GitHub activity sync skipped:", error);
  }
}

const schedule = process.env.SYNC_CRON ?? "0 2 * * *";
cron.schedule(schedule, () => {
  runDailySync().catch((error: unknown) => console.error("Scheduled sync failed:", error));
}, { timezone: "UTC" });

console.info(`TrackerMaxxing worker started (${schedule} UTC).`);

if (process.env.SYNC_ON_START === "true") {
  runDailySync().catch((error: unknown) => console.error("Initial sync failed:", error));
}
