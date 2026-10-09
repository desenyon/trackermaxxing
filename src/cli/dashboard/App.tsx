import { Box, Text, useApp, useInput } from "ink";
import { useCallback, useEffect, useState, useRef } from "react";

import type { getUnifiedOverview } from "@/lib/ai/service";
import type { getGithubActivityOverview, GithubLifetimeTotals } from "@/lib/github/activity";
import { syncGithubIfStale } from "@/lib/github/activity";

import { runSync } from "../commands/sync";
import { buildReportLines } from "../render/layout";

type AiOverview = Awaited<ReturnType<typeof getUnifiedOverview>>;
type GithubOverview = Awaited<ReturnType<typeof getGithubActivityOverview>>;

const REFRESH_MS = 15_000;
const GITHUB_SYNC_MS = 30_000;

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
  const [status, setStatus] = useState<string>("");

  const refreshing = useRef(false);
  const syncing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const [nextAi, nextGithub] = await Promise.all([loaders.getAi(days), loaders.getGithub(days)]);
      setAi(nextAi);
      setGithub(nextGithub);
      setGithubLifetime(nextGithub.lifetime ?? null);
      setStatus(nextGithub.warning ?? "");
    } finally { refreshing.current = false; }
  }, [days, loaders]);

  const pullGithub = useCallback(async (force = false) => {
    if (syncing.current) return;
    syncing.current = true;
    let warning = "";
    try { await syncGithubIfStale({ force }); }
    catch (error) { warning = error instanceof Error ? error.message : "GitHub sync failed."; }
    finally { syncing.current = false; }
    await refresh();
    if (warning) setStatus(warning);
  }, [refresh]);

  useEffect(() => {
    pullGithub(true).catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Failed to load."));
    const refreshInterval = setInterval(() => {
      refresh().catch(() => undefined);
    }, REFRESH_MS);
    const githubInterval = setInterval(() => {
      pullGithub().catch(() => undefined);
    }, GITHUB_SYNC_MS);
    return () => {
      clearInterval(refreshInterval);
      clearInterval(githubInterval);
    };
  }, [pullGithub, refresh]);

  useInput((input, key) => {
    if (input === "q" || key.escape) exit();
    if (input === "r") {
      setStatus("refreshing");
      pullGithub(true)
        .then(() => setStatus(""))
        .catch((error: unknown) => setStatus(error instanceof Error ? error.message : "refresh failed"));
    }
    if (input === "s") {
      setStatus("syncing");
      runSync()
        .then(() => refresh())
        .then(() => setStatus(""))
        .catch((error: unknown) => setStatus(error instanceof Error ? error.message : "sync failed"));
    }
  });

  if (!ai || !github) {
    return <Box paddingX={1}><Text dimColor>{status || "loading"}</Text></Box>;
  }

  const lines = buildReportLines(ai, github, { days, githubLifetime });

  return (
    <Box flexDirection="column" paddingX={1}>
      {lines.map((line) => (
        <Text key={line}>{line || " "}</Text>
      ))}
      {status ? <Text dimColor>{status}</Text> : <Text dimColor>auto-sync · r refresh · s full sync · q quit</Text>}
    </Box>
  );
}
