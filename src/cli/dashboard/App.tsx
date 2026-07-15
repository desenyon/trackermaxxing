import { Box, Text, useApp, useInput } from "ink";
import { useCallback, useEffect, useState } from "react";

import type { getUnifiedOverview } from "@/lib/ai/service";
import type { getGithubActivityOverview, GithubLifetimeTotals } from "@/lib/github/activity";

import { runSync } from "../commands/sync";
import { bar, compactNumber, currency, sparkline } from "../render/format";

type AiOverview = Awaited<ReturnType<typeof getUnifiedOverview>>;
type GithubOverview = Awaited<ReturnType<typeof getGithubActivityOverview>>;

const PROVIDERS = ["codex", "claude", "cursor"] as const;
const PROVIDER_COLOR: Record<(typeof PROVIDERS)[number], string> = {
  codex: "#10A37F",
  claude: "#D97757",
  cursor: "#B794F6",
};
const PROVIDER_LABEL: Record<(typeof PROVIDERS)[number], string> = {
  codex: "CODEX",
  claude: "CLAUDE",
  cursor: "CURSOR",
};
const BADGE_WIDTH = Math.max(...Object.values(PROVIDER_LABEL).map((label) => label.length));
const REFRESH_MS = 15_000;

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

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box flexDirection="column" marginRight={4}>
      <Text dimColor>{label.toUpperCase()}</Text>
      <Text bold color={color}>{value}</Text>
    </Box>
  );
}

function Badge({ provider }: { provider: (typeof PROVIDERS)[number] }) {
  return (
    <Text backgroundColor={PROVIDER_COLOR[provider]} color="black" bold>
      {` ${PROVIDER_LABEL[provider].padEnd(BADGE_WIDTH, " ")} `}
    </Text>
  );
}

export function App({ days, loaders }: {
  days: number;
  loaders: {
    getAi: (days: number) => Promise<AiOverview>;
    getGithub: (days: number) => Promise<GithubOverview>;
    getGithubLifetime: () => Promise<GithubLifetimeTotals | null>;
  };
}) {
  const { exit } = useApp();
  const [ai, setAi] = useState<AiOverview | null>(null);
  const [github, setGithub] = useState<GithubOverview | null>(null);
  const [githubLifetime, setGithubLifetime] = useState<GithubLifetimeTotals | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [status, setStatus] = useState<string>("Loading…");

  const refresh = useCallback(async () => {
    const [nextAi, nextGithub, nextGithubLifetime] = await Promise.all([loaders.getAi(days), loaders.getGithub(days), loaders.getGithubLifetime()]);
    setAi(nextAi);
    setGithub(nextGithub);
    setGithubLifetime(nextGithubLifetime);
    setLastUpdated(new Date());
    setStatus("");
  }, [days, loaders]);

  useEffect(() => {
    refresh().catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Failed to load."));
    const interval = setInterval(() => {
      refresh().catch(() => undefined);
    }, REFRESH_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  useInput((input, key) => {
    if (input === "q" || key.escape) exit();
    if (input === "r") refresh().catch(() => undefined);
    if (input === "s") {
      setStatus("Syncing…");
      runSync()
        .then(() => refresh())
        .then(() => setStatus(""))
        .catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Sync failed."));
    }
  });

  if (!ai || !github) {
    return (
      <Box padding={1}>
        <Text color="gray">{status || "Loading…"}</Text>
      </Box>
    );
  }

  const maxProviderTotal = Math.max(1, ...ai.byProvider.map((row) => row.totalTokens));

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="magentaBright">TrackerMaxxing <Text dimColor>— live dashboard</Text></Text>

      <Box marginTop={1}>
        <Stat label="Lifetime tokens" value={compactNumber(ai.lifetime.totalTokens)} />
        <Stat label="Tokens today" value={compactNumber(ai.today.tokens)} color="green" />
        <Stat label="Est. cost" value={currency(ai.lifetime.estimatedCostUsd)} color="magenta" />
        <Stat label="Sessions" value={compactNumber(ai.lifetime.sessions)} />
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>── AI usage</Text>
        {PROVIDERS.map((provider) => {
          const lifetime = ai.byProvider.find((entry) => entry.provider === provider);
          const recent = windowTotals(ai.daily, provider);
          const trend = windowTrend(ai.daily, provider, 24);
          return (
            <Box key={provider} marginTop={1} flexDirection="column">
              <Box>
                <Badge provider={provider} />
                <Text> </Text>
                <Text color={PROVIDER_COLOR[provider]}>{sparkline(trend)}</Text>
              </Box>
              <Box marginLeft={BADGE_WIDTH + 3}>
                <Box width={22}>
                  <Text dimColor>lifetime </Text>
                  <Text bold>{compactNumber(lifetime?.totalTokens ?? 0)}</Text>
                  <Text dimColor> ({lifetime?.sessions ?? 0})</Text>
                </Box>
                <Box>
                  <Text dimColor>last {days}d </Text>
                  <Text bold>{compactNumber(recent.tokens)}</Text>
                  <Text dimColor> ({recent.sessions})</Text>
                </Box>
              </Box>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>── Share of lifetime tokens</Text>
        {PROVIDERS.map((provider) => {
          const row = ai.byProvider.find((entry) => entry.provider === provider);
          const total = row?.totalTokens ?? 0;
          return (
            <Box key={provider}>
              <Badge provider={provider} />
              <Text> </Text>
              <Text color={PROVIDER_COLOR[provider]}>{bar(total / maxProviderTotal, 28)}</Text>
              <Text dimColor> {compactNumber(total)}</Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>── GitHub activity</Text>
        {[
          ["Commits", githubLifetime?.commits, github.totals.commits],
          ["PRs opened", githubLifetime?.prsOpened, github.totals.prsOpened],
          ["PRs merged", githubLifetime?.prsMerged, github.totals.prsMerged],
          ["Reviews", githubLifetime?.reviews, github.totals.prsReviewed],
          ["Issues", githubLifetime?.issuesOpened, github.totals.issuesOpened],
        ].map(([label, lifetimeValue, windowValue]) => (
          <Box key={label as string}>
            <Box width={14}><Text dimColor>{label}</Text></Box>
            <Box width={20}>
              <Text dimColor>lifetime </Text>
              <Text bold>{lifetimeValue === undefined ? "—" : compactNumber(lifetimeValue as number)}</Text>
            </Box>
            <Text dimColor>last {days}d </Text>
            <Text bold>{compactNumber(windowValue as number)}</Text>
          </Box>
        ))}
        {!githubLifetime && <Text dimColor>Lifetime totals need one sync with GitHub connected (press s).</Text>}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          [r] refresh  [s] sync  [q] quit · {status || `updated ${lastUpdated ? lastUpdated.toLocaleTimeString() : ""}`}
        </Text>
      </Box>
    </Box>
  );
}
