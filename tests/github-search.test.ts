import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildGithubSearchPath, getGithubWindowTotals, isStaleGithubSync, windowTotalsMetaKey } from "@/lib/github/activity";
import { setMeta } from "@/lib/settings/meta";

const directory = mkdtempSync(resolve(tmpdir(), "trackermaxxing-github-window-"));
process.env.DATABASE_PATH = resolve(directory, "data.db");
process.env.TRACKER_MIGRATIONS_PATH = resolve(import.meta.dirname, "../drizzle");

beforeAll(async () => {
  await import("@/lib/db");
});

afterAll(async () => {
  const database = await import("@/lib/db");
  database.sqlite.close();
  rmSync(directory, { recursive: true, force: true });
  delete process.env.DATABASE_PATH;
  delete process.env.TRACKER_MIGRATIONS_PATH;
});

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

describe("windowTotalsMetaKey", () => {
  beforeEach(async () => {
    const database = await import("@/lib/db");
    database.sqlite.prepare("DELETE FROM app_settings").run();
  });

  it("uses a distinct cache key per window size", () => {
    expect(windowTotalsMetaKey(30, "alice")).toBe("github.accounts.alice.window_totals.30");
    expect(windowTotalsMetaKey(90, "alice")).toBe("github.accounts.alice.window_totals.90");
    expect(windowTotalsMetaKey(30, "alice")).not.toBe(windowTotalsMetaKey(90, "alice"));
  });

  it("keeps separate caches for different --days values", async () => {
    const now = new Date();
    const since = (days: number) => { const d = new Date(now); d.setUTCDate(d.getUTCDate() - days + 1); return d.toISOString().slice(0, 10); };
    const base = {
      login: "alice", through: now.toISOString().slice(0, 10),
      prsOpened: 0,
      prsMerged: 0,
      reviews: 0,
      issuesOpened: 0,
      syncedAt: new Date().toISOString(),
    };
    await setMeta(windowTotalsMetaKey(30, "alice"), JSON.stringify({ ...base, days: 30, since: since(30), commits: 12 }));
    await setMeta(windowTotalsMetaKey(90, "alice"), JSON.stringify({ ...base, days: 90, since: since(90), commits: 120 }));

    expect((await getGithubWindowTotals(30, "alice"))?.commits).toBe(12);
    expect((await getGithubWindowTotals(90, "alice"))?.commits).toBe(120);
  });

  it("rejects legacy window caches that cannot be attributed to an account", async () => {
    await setMeta("github.window_totals", JSON.stringify({
      days: 90,
      commits: 55,
      prsOpened: 0,
      prsMerged: 0,
      reviews: 0,
      issuesOpened: 0,
      syncedAt: new Date().toISOString(),
    }));

    expect(await getGithubWindowTotals(90, "alice")).toBeNull();
    expect(await getGithubWindowTotals(30, "alice")).toBeNull();
  });
});
