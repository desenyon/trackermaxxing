import { syncGithubActivity } from "@/lib/github/activity";
import { setMeta } from "@/lib/settings/meta";
import { syncAllLocalAi } from "@/lib/sync/local-ai";

export async function runSync(options: { offline?: boolean } = {}) {
  const ai = await syncAllLocalAi();
  let github: { login: string; rowsIngested: number } | { error: string };
  try {
    github = options.offline ? { error: "Offline mode: GitHub sync skipped." } : await syncGithubActivity();
  } catch (error) {
    github = { error: error instanceof Error ? error.message : "GitHub sync failed." };
  }
  for (const [provider, error] of Object.entries(ai.errors)) process.stderr.write(`${provider}: ${error} (cached data retained)\n`);
  if (ai.skipped.length) process.stderr.write(`Unavailable sources retained: ${ai.skipped.join(", ")}\n`);
  await setMeta("last_sync_at", new Date().toISOString());
  return { ai, github };
}
