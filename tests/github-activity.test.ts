import { describe, expect, it } from "vitest";

import { pushCommitCount, summarizeGithubEvents } from "@/lib/github/activity";

describe("summarizeGithubEvents", () => {
  const since = new Date("2026-07-01T00:00:00.000Z");

  it("falls back to one commit per push when GitHub omits payload sizes", () => {
    const totals = summarizeGithubEvents([{
      type: "PushEvent",
      created_at: "2026-07-02T12:00:00.000Z",
      payload: {},
    }], since);
    expect(totals.get("2026-07-02")).toMatchObject({ commits: 1, pushEvents: 1 });
  });

  it("parses string push sizes from the API", () => {
    const totals = summarizeGithubEvents([{
      type: "PushEvent",
      created_at: "2026-07-02T12:00:00.000Z",
      payload: { distinct_size: "25", size: "27" },
    }], since);
    expect(totals.get("2026-07-02")).toMatchObject({ commits: 25, pushEvents: 1 });
  });

  it("uses the push size instead of the API's truncated commits array", () => {
    const totals = summarizeGithubEvents([{
      type: "PushEvent",
      created_at: "2026-07-02T12:00:00.000Z",
      payload: { distinct_size: 25, size: 27, commits: Array.from({ length: 20 }) },
    }], since);
    expect(totals.get("2026-07-02")).toMatchObject({ commits: 25, pushEvents: 1 });
  });

  it("counts only newly created reviews and the relevant PR and issue actions", () => {
    const event = (type: string, payload: Record<string, unknown>) => ({ type, payload, created_at: "2026-07-03T12:00:00.000Z" });
    const totals = summarizeGithubEvents([
      event("PullRequestEvent", { action: "opened" }),
      event("PullRequestEvent", { action: "closed", pull_request: { merged: true } }),
      event("PullRequestReviewEvent", { action: "created" }),
      event("PullRequestReviewEvent", { action: "updated" }),
      event("IssuesEvent", { action: "opened" }),
      event("IssuesEvent", { action: "closed" }),
    ], since);
    expect(totals.get("2026-07-03")).toMatchObject({ prsOpened: 1, prsMerged: 1, prsReviewed: 1, issuesOpened: 1 });
  });

  it("ignores stale and invalid timestamps and falls back to the commit array", () => {
    const totals = summarizeGithubEvents([
      { type: "PushEvent", created_at: "2026-06-30T23:59:59.000Z", payload: { commits: [1] } },
      { type: "PushEvent", created_at: "invalid", payload: { commits: [1] } },
      { type: "PushEvent", created_at: "2026-07-04T12:00:00.000Z", payload: { commits: [1, 2] } },
    ], since);
    expect([...totals]).toEqual([["2026-07-04", { commits: 2, prsOpened: 0, prsMerged: 0, prsReviewed: 0, issuesOpened: 0, pushEvents: 1 }]]);
  });

  it("counts at least one commit for empty push payloads", () => {
    expect(pushCommitCount({})).toBe(1);
  });
});
