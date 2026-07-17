import { Box, Text, useApp, useInput } from "ink";
import { useCallback, useEffect, useState } from "react";

import type { getUnifiedOverview } from "@/lib/ai/service";
import type { getGithubActivityOverview, GithubLifetimeTotals } from "@/lib/github/activity";

import { runSync } from "../commands/sync";
import { buildReportLines } from "../render/layout";

type AiOverview = Awaited<ReturnType<typeof getUnifiedOverview>>;
type GithubOverview = Awaited<ReturnType<typeof getGithubActivityOverview>>;

const REFRESH_MS = 15_000;

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

  const refresh = useCallback(async () => {
    const [nextAi, nextGithub, nextGithubLifetime] = await Promise.all([
      loaders.getAi(days),
      loaders.getGithub(days),
      loaders.getGithubLifetime(),
    ]);
    setAi(nextAi);
    setGithub(nextGithub);
    setGithubLifetime(nextGithubLifetime);
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
      {status ? <Text dimColor>{status}</Text> : null}
    </Box>
  );
}
