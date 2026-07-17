import boxen from "boxen";
import chalk from "chalk";

import type { getUnifiedOverview } from "@/lib/ai/service";
import type { getGithubActivityOverview, GithubLifetimeTotals } from "@/lib/github/activity";

import { buildReportLines } from "./layout";

type AiOverview = Awaited<ReturnType<typeof getUnifiedOverview>>;
type GithubOverview = Awaited<ReturnType<typeof getGithubActivityOverview>>;

export function renderSnapshot(
  ai: AiOverview,
  github: GithubOverview,
  options: { lastSynced?: Date; days?: number; githubLifetime?: GithubLifetimeTotals | null } = {},
) {
  return buildReportLines(ai, github, {
    days: options.days ?? 30,
    githubLifetime: options.githubLifetime,
  }).join("\n");
}

export function renderError(message: string) {
  return boxen(chalk.red(message), { padding: 1, borderColor: "red", borderStyle: "round" });
}
