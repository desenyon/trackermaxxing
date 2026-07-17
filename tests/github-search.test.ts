import { describe, expect, it } from "vitest";

import { buildGithubSearchPath, isStaleGithubSync } from "@/lib/github/activity";

describe("buildGithubSearchPath", () => {
  it("builds a valid REST path for the Search API", () => {
    const path = buildGithubSearchPath("commits", "author:desenyon author-date:>=2026-04-19");
    expect(path.startsWith("/search/commits?q=")).toBe(true);
    expect(path).toContain(encodeURIComponent("author:desenyon author-date:>=2026-04-19"));
    expect(path).toContain("per_page=1");
  });
});

describe("isStaleGithubSync", () => {
  it("treats missing and expired timestamps as stale", () => {
    expect(isStaleGithubSync(undefined, 60_000)).toBe(true);
    const old = new Date(Date.now() - 120_000).toISOString();
    expect(isStaleGithubSync(old, 60_000)).toBe(true);
    const fresh = new Date(Date.now() - 30_000).toISOString();
    expect(isStaleGithubSync(fresh, 60_000)).toBe(false);
  });
});
