import { getUnifiedOverview } from "@/lib/ai/service";
import { getGithubActivityOverview } from "@/lib/github/activity";
import { getMeta } from "@/lib/settings/meta";

import { renderSnapshot } from "../render/snapshot";
import { runSync } from "./sync";

export async function runReport(options: { sync: boolean; json: boolean; days: number; offline?: boolean }) {
  if (options.sync && !options.offline) {
    await runSync();
  }

  const [ai, github, lastSync] = await Promise.all([
    getUnifiedOverview(options.days),
    getGithubActivityOverview(options.days, { offline: options.offline }),
    getMeta("last_sync_at"),
  ]);

  if (github.warning) process.stderr.write(`${github.warning} Using cached GitHub data.\n`);
  const githubLifetime = github.lifetime ?? null;
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ai, github, githubLifetime }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${renderSnapshot(ai, github, { lastSynced: lastSync?.updatedAt, days: options.days, githubLifetime })}\n`);
}
