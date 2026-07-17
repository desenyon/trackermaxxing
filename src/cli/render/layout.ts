import type { getUnifiedOverview } from "@/lib/ai/service";
import type { getGithubActivityOverview, GithubLifetimeTotals } from "@/lib/github/activity";

import { compactNumber, currency, sparkline } from "./format";

type AiOverview = Awaited<ReturnType<typeof getUnifiedOverview>>;
type GithubOverview = Awaited<ReturnType<typeof getGithubActivityOverview>>;
type Provider = "codex" | "claude" | "cursor";

const PROVIDERS: Provider[] = ["codex", "claude", "cursor"];
const PROVIDER_LABEL: Record<Provider, string> = {
  codex: "Codex",
  claude: "Claude",
  cursor: "Cursor",
};

function graphWidth(width: number) {
  return Math.max(18, Math.min(48, width - 26));
}

function windowTrend(daily: AiOverview["daily"], provider: string, days: number) {
  const byDate = new Map<string, number>();
  for (const row of daily) {
    if (row.provider !== provider) continue;
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.inputTokens + row.outputTokens);
  }
  return [...byDate.keys()].sort().slice(-days).map((date) => byDate.get(date) ?? 0);
}

function lifetimeTokens(ai: AiOverview, provider: Provider) {
  const row = ai.byProvider.find((entry) => entry.provider === provider);
  return row?.totalTokens ?? 0;
}

function githubSeries(daily: GithubOverview["daily"], key: keyof GithubOverview["daily"][number], days: number) {
  return daily.slice(-days).map((row) => Number(row[key] ?? 0));
}

export function buildReportLines(
  ai: AiOverview,
  github: GithubOverview,
  options: { days?: number; width?: number; githubLifetime?: GithubLifetimeTotals | null } = {},
) {
  const days = options.days ?? 30;
  const width = options.width ?? Math.min(process.stdout.columns ?? 80, 96);
  const graph = graphWidth(width);
  const windowDays = github.days ?? days;
  const lines: string[] = [];

  lines.push(
    [
      `Lifetime ${compactNumber(ai.lifetime.totalTokens)}`,
      `Today ${compactNumber(ai.today.tokens)}`,
      `Cost ${currency(ai.lifetime.estimatedCostUsd)}`,
      `Sessions ${compactNumber(ai.lifetime.sessions)}`,
    ].join("  ·  "),
  );
  lines.push("");

  for (const provider of PROVIDERS) {
    const total = lifetimeTokens(ai, provider);
    const trend = windowTrend(ai.daily, provider, graph);
    lines.push(`${PROVIDER_LABEL[provider].padEnd(8)} ${compactNumber(total).padStart(8)}  ${sparkline(trend)}`);
  }

  lines.push("");
  const lifetime = options.githubLifetime;
  const ghMetrics = [
    ["Commits", lifetime?.commits, github.totals.commits, githubSeries(github.daily, "commits", graph)],
    ["PRs", lifetime?.prsOpened, github.totals.prsOpened, githubSeries(github.daily, "prsOpened", graph)],
    ["Merged", lifetime?.prsMerged, github.totals.prsMerged, githubSeries(github.daily, "prsMerged", graph)],
    ["Reviews", lifetime?.reviews, github.totals.prsReviewed, githubSeries(github.daily, "prsReviewed", graph)],
  ] as const;

  for (const [label, lifetimeValue, windowValue, series] of ghMetrics) {
    const windowLabel = `last ${windowDays}d`;
    const stat = lifetimeValue === undefined
      ? `${compactNumber(windowValue)} ${windowLabel}`
      : `${compactNumber(lifetimeValue)} · ${compactNumber(windowValue)} ${windowLabel}`;
    lines.push(`${label.padEnd(8)} ${stat.padStart(8)}  ${sparkline(series)}`);
  }

  return lines;
}
