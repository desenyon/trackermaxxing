import { describe, expect, it, vi } from "vitest";
import { buildReportLines } from "@/cli/render/layout";

it("preserves inactive UTC days in terminal trends", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-16T00:00:00Z"));
  try {
    const lines = buildReportLines({
      lifetime: { totalTokens: 20, sessions: 2, estimatedCostUsd: 0 }, today: { tokens: 10, sessions: 1 },
      byProvider: [{ provider: "codex", totalTokens: 20, sessions: 2, cost: 0 }], recentSessions: [],
      daily: ["2026-07-14", "2026-07-16"].map((date) => ({ date, provider: "codex", inputTokens: 10, outputTokens: 0, cachedTokens: 0, sessionCount: 1, turnCount: 1, costUsd: 0 })),
    }, { daily: [], totals: { commits: 0, prsOpened: 0, prsMerged: 0, prsReviewed: 0, issuesOpened: 0 }, days: 3 }, { days: 3 });
    expect(lines.find((line) => line.startsWith("Codex"))).toContain("█▁█");
  } finally { vi.useRealTimers(); }
});

describe("day count input", () => {
  it("rejects excessive date ranges before rendering or querying", async () => {
    const { dayCount } = await import("@/cli/options");
    expect(() => dayCount("36501")).toThrow();
  });
});
