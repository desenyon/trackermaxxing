import { syncGithubActivity } from "@/lib/github/activity";
import { setMeta } from "@/lib/settings/meta";
import { syncAllLocalAi } from "@/lib/sync/local-ai";

export async function runSync() {
  const ai = await syncAllLocalAi();
  let github: { login: string; rowsIngested: number } | { error: string };
  try {
    github = await syncGithubActivity();
  } catch (error) {
    github = { error: error instanceof Error ? error.message : "GitHub sync failed." };
  }
  await setMeta("last_sync_at", new Date().toISOString());
  return { ai, github };
}
