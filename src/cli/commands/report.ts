import { getUnifiedOverview } from "@/lib/ai/service";
import { getGithubActivityOverview, getGithubLifetimeTotals } from "@/lib/github/activity";
import { getMeta } from "@/lib/settings/meta";

import { renderSnapshot } from "../render/snapshot";
import { runSync } from "./sync";

export async function runReport(options: { sync: boolean; json: boolean; days: number }) {
  if (options.sync) {
    await runSync();
  }

  const [ai, github, githubLifetime, lastSync] = await Promise.all([
    getUnifiedOverview(options.days),
    getGithubActivityOverview(options.days),
    getGithubLifetimeTotals(),
    getMeta("last_sync_at"),
  ]);

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ai, github, githubLifetime }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${renderSnapshot(ai, github, { lastSynced: lastSync?.updatedAt, days: options.days, githubLifetime })}\n`);
}
