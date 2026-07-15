import boxen from "boxen";
import chalk from "chalk";
import Table from "cli-table3";
import figlet from "figlet";
import gradient from "gradient-string";

import type { getUnifiedOverview } from "@/lib/ai/service";
import type { getGithubActivityOverview, GithubLifetimeTotals } from "@/lib/github/activity";

import { bar, compactNumber, currency, pad, sparkline } from "./format";
import { accent, dim, good, heading, providerBadge, providerColor } from "./theme";

type AiOverview = Awaited<ReturnType<typeof getUnifiedOverview>>;
type GithubOverview = Awaited<ReturnType<typeof getGithubActivityOverview>>;
type Provider = "codex" | "claude" | "cursor";
const PROVIDERS: Provider[] = ["codex", "claude", "cursor"];

const brand = gradient(["#10A37F", "#B794F6", "#D97757"]);

function width() {
  return Math.min(process.stdout.columns ?? 80, 100);
}

function banner() {
  const text = figlet.textSync("TrackerMaxxing", { font: "Small", width: width() });
  return brand.multiline(text);
}

const STAT_GAP = 4;

function statRow(stats: Array<{ label: string; value: string; color?: (text: string) => string }>) {
  const columnWidths = stats.map(({ label, value }) => Math.max(label.length, value.length));
  const gap = " ".repeat(STAT_GAP);
  const labelLine = stats.map(({ label }, i) => pad(dim(label.toUpperCase()), columnWidths[i])).join(gap);
  const valueLine = stats.map(({ value, color }, i) => pad((color ?? heading)(value), columnWidths[i])).join(gap);
  return `${labelLine}\n${valueLine}`;
}

function sectionTitle(title: string) {
  const prefix = `── ${title} `;
  return heading(prefix + "─".repeat(Math.max(0, width() - prefix.length)));
}

function windowTrend(daily: AiOverview["daily"], provider: string, days: number) {
  const byDate = new Map<string, number>();
  for (const row of daily) {
    if (row.provider !== provider) continue;
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.inputTokens + row.outputTokens);
  }
  return [...byDate.keys()].sort().slice(-days).map((date) => byDate.get(date) ?? 0);
}

function windowTotals(daily: AiOverview["daily"], provider: string) {
  let tokens = 0;
  let sessions = 0;
  for (const row of daily) {
    if (row.provider !== provider) continue;
    tokens += row.inputTokens + row.outputTokens;
    sessions += row.sessionCount;
  }
  return { tokens, sessions };
}

export function renderSnapshot(ai: AiOverview, github: GithubOverview, options: { lastSynced?: Date; days?: number; githubLifetime?: GithubLifetimeTotals | null } = {}) {
  const days = options.days ?? 30;
  const lines: string[] = [];
  lines.push(banner());
  lines.push("");

  lines.push(
    statRow([
      { label: "Lifetime tokens", value: compactNumber(ai.lifetime.totalTokens) },
      { label: "Tokens today", value: compactNumber(ai.today.tokens), color: good },
      { label: "Est. lifetime cost", value: currency(ai.lifetime.estimatedCostUsd), color: accent },
      { label: "Sessions", value: compactNumber(ai.lifetime.sessions) },
    ]),
  );
  lines.push("");

  lines.push(sectionTitle("AI usage"));
  const trendWidth = Math.max(10, Math.min(30, width() - 56));
  const providerTable = new Table({
    head: ["", `Lifetime`, `Last ${days}d`, `Last ${days}d trend`].map((h) => heading(h)),
    style: { head: [], border: [] },
    colAligns: ["left", "right", "right", "left"],
  });
  for (const provider of PROVIDERS) {
    const color = providerColor[provider];
    const lifetime = ai.byProvider.find((entry) => entry.provider === provider);
    const recent = windowTotals(ai.daily, provider);
    const trend = windowTrend(ai.daily, provider, trendWidth);
    providerTable.push([
      providerBadge(provider),
      `${heading(compactNumber(lifetime?.totalTokens ?? 0))}\n${dim(`${lifetime?.sessions ?? 0} sessions`)}`,
      `${heading(compactNumber(recent.tokens))}\n${dim(`${recent.sessions} sessions`)}`,
      `${color(sparkline(trend))}`,
    ]);
  }
  lines.push(providerTable.toString());
  lines.push("");

  lines.push(sectionTitle("GitHub activity"));
  const lifetime = options.githubLifetime;
  const ghRows = [
    ["Commits", lifetime?.commits, github.totals.commits],
    ["PRs opened", lifetime?.prsOpened, github.totals.prsOpened],
    ["PRs merged", lifetime?.prsMerged, github.totals.prsMerged],
    ["Reviews", lifetime?.reviews, github.totals.prsReviewed],
    ["Issues", lifetime?.issuesOpened, github.totals.issuesOpened],
  ] as const;
  const ghTable = new Table({
    head: ["", "Lifetime", `Last ${days}d`].map((h) => heading(h)),
    style: { head: [], border: [] },
    colAligns: ["left", "right", "right"],
  });
  for (const [label, lifetimeValue, windowValue] of ghRows) {
    ghTable.push([
      dim(label),
      heading(lifetimeValue === undefined ? "—" : compactNumber(lifetimeValue)),
      heading(compactNumber(windowValue)),
    ]);
  }
  lines.push(ghTable.toString());
  if (!lifetime) lines.push(dim("Lifetime totals need one `trackermaxxing sync` with GitHub connected."));

  const ghTrend = github.daily.slice(-30).map((row) => row.commits);
  if (ghTrend.some((v) => v > 0)) {
    lines.push("");
    lines.push(`${dim("commits, last 30d")}  ${accent(sparkline(ghTrend))}`);
  }
  lines.push("");

  const barWidth = Math.min(28, width() - 24);
  const maxProviderTotal = Math.max(1, ...ai.byProvider.map((row) => row.totalTokens));
  lines.push(sectionTitle("Share of lifetime tokens"));
  for (const provider of PROVIDERS) {
    const row = ai.byProvider.find((entry) => entry.provider === provider);
    const total = row?.totalTokens ?? 0;
    const color = providerColor[provider];
    lines.push(`${providerBadge(provider)} ${color(bar(total / maxProviderTotal, barWidth))} ${dim(compactNumber(total))}`);
  }
  lines.push("");

  const synced = options.lastSynced
    ? dim(`Last synced ${formatRelativeTime(options.lastSynced)} · trackermaxxing sync to refresh`)
    : dim("trackermaxxing sync to refresh");
  lines.push(synced);

  return lines.join("\n");
}

function formatRelativeTime(date: Date) {
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function renderError(message: string) {
  return boxen(chalk.red(message), { padding: 1, borderColor: "red", borderStyle: "round" });
}
