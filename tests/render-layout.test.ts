import { describe, expect, it } from "vitest";

import { buildReportLines } from "@/cli/render/layout";

describe("report layout", () => {
  it("renders only stats and sparkline graphs", () => {
    const lines = buildReportLines(
      {
        lifetime: { totalTokens: 1_000_000, sessions: 10, estimatedCostUsd: 12.5 },
        today: { tokens: 50_000, sessions: 2 },
        byProvider: [
          { provider: "codex", totalTokens: 600_000, sessions: 6, cost: 8 },
          { provider: "claude", totalTokens: 300_000, sessions: 3, cost: 3 },
          { provider: "cursor", totalTokens: 100_000, sessions: 1, cost: 1.5 },
        ],
        daily: [
          { date: "2026-07-15", provider: "codex", inputTokens: 100, outputTokens: 50, cachedTokens: 0, sessionCount: 1, turnCount: 1, costUsd: 1 },
          { date: "2026-07-16", provider: "codex", inputTokens: 200, outputTokens: 100, cachedTokens: 0, sessionCount: 1, turnCount: 1, costUsd: 2 },
        ],
        recentSessions: [],
      },
      {
        daily: [
          { day: "2026-07-15", login: "you", commits: 2, prsOpened: 1, prsMerged: 0, prsReviewed: 0, issuesOpened: 0, pushEvents: 1 },
          { day: "2026-07-16", login: "you", commits: 4, prsOpened: 0, prsMerged: 1, prsReviewed: 1, issuesOpened: 0, pushEvents: 1 },
        ],
        totals: { commits: 6, prsOpened: 1, prsMerged: 1, prsReviewed: 1, issuesOpened: 0 },
        days: 2,
      },
      { days: 2, githubLifetime: { commits: 100, prsOpened: 20, prsMerged: 10, reviews: 5, issuesOpened: 3, login: "you", syncedAt: "2026-07-17T00:00:00.000Z" } },
    );

    expect(lines.some((line) => line.includes("Lifetime"))).toBe(true);
    expect(lines.some((line) => line.includes("Codex"))).toBe(true);
    expect(lines.some((line) => line.includes("Commits"))).toBe(true);
    expect(lines.join("\n")).not.toMatch(/TrackerMaxxing|──|figlet|CODEX/);
  });
});
