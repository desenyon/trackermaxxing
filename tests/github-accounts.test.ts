import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db, sqlite } from "@/lib/db";
import { githubActivityDaily } from "@/lib/db/schema";
import { getGithubActivityOverview, getGithubLifetimeTotals, syncGithubActivity, syncGithubIfStale } from "@/lib/github/activity";
import { setMeta } from "@/lib/settings/meta";

vi.mock("@/lib/github/gh-cli", () => ({
  isGhCliAuthenticated: () => false,
  ghCliToken: () => null,
  ghCliLogin: () => null,
  ghApiSearchCount: () => null,
}));

beforeEach(() => {
  sqlite.exec("DELETE FROM gh_activity_daily; DELETE FROM app_settings; DELETE FROM gh_sync_log;");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-16T00:01:00Z"));
  process.env.GITHUB_LOGIN = "bob";
  process.env.GITHUB_TOKEN = "synthetic-bob-token";
  vi.stubGlobal("fetch", async (url: string) => {
    const parsed = new URL(url);
    if (parsed.pathname.includes("/events")) return Response.json([]);
    if (parsed.pathname === "/user") return Response.json({ login: "bob" });
    return Response.json({ total_count: 0, incomplete_results: false });
  });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.GITHUB_LOGIN;
  delete process.env.GITHUB_TOKEN;
});

const daily = (login: string, commits: number, day = "2026-07-16") => ({ login, day, commits, pushEvents: 1 });

describe("GitHub account isolation", () => {
  it("filters daily activity by the currently selected login and excludes future days", async () => {
    db.insert(githubActivityDaily).values([daily("alice", 100), daily("bob", 2), daily("bob", 40, "2026-07-17")]).run();
    const report = await getGithubActivityOverview(30);
    expect(report.daily.map((row) => [row.login, row.commits])).toEqual([["bob", 2]]);
  });

  it("does not reuse a previous account's lifetime identity or totals", async () => {
    await setMeta("github.lifetime_totals", JSON.stringify({ login: "alice", commits: 999, syncedAt: "2026-07-16T00:00:59Z" }));
    await getGithubActivityOverview(30);
    expect(await getGithubLifetimeTotals()).toMatchObject({ login: "bob", commits: 0 });
  });

  it("invalidates a window across UTC midnight even while its TTL is fresh", async () => {
    let count = 12;
    vi.stubGlobal("fetch", async () => Response.json({ total_count: count, incomplete_results: false }));
    vi.setSystemTime(new Date("2026-07-15T23:59:59Z"));
    expect((await getGithubActivityOverview(1)).totals.commits).toBe(12);
    count = 1;
    vi.setSystemTime(new Date("2026-07-16T00:00:01Z"));
    expect((await getGithubActivityOverview(1)).totals.commits).toBe(1);
  });

  it("replaces an empty successful event window while preserving older and other-account history", async () => {
    db.insert(githubActivityDaily).values([daily("alice", 100), daily("bob", 2), daily("bob", 3, "2026-01-01")]).run();
    await syncGithubActivity();
    expect(db.select().from(githubActivityDaily).all().map((row) => [row.login, row.day, row.commits])).toEqual([
      ["alice", "2026-07-16", 100], ["bob", "2026-01-01", 3],
    ]);
  });

  it("preserves event cache when a later page fails", async () => {
    db.insert(githubActivityDaily).values(daily("bob", 5)).run();
    vi.stubGlobal("fetch", async (url: string) => {
      if (new URL(url).searchParams.get("page") === "1") return Response.json(Array.from({ length: 100 }, (_, id) => ({ id: String(id), type: "PushEvent", created_at: "2026-07-16T00:00:00Z", payload: {} })));
      return new Response("Unavailable", { status: 503 });
    });
    await expect(syncGithubActivity()).rejects.toThrow();
    expect(db.select().from(githubActivityDaily).get()?.commits).toBe(5);
  });

  it("does not let account A's event TTL suppress account B's first sync", async () => {
    process.env.GITHUB_LOGIN = "alice";
    await syncGithubIfStale();
    process.env.GITHUB_LOGIN = "bob";
    expect(await syncGithubIfStale()).toMatchObject({ skipped: false, login: "bob" });
  });
});


it("uses a saved same-account Search cache when refresh fails", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ total_count: 21, incomplete_results: false }));
  await getGithubActivityOverview(30);
  vi.setSystemTime(new Date("2026-07-16T00:04:00Z"));
  vi.stubGlobal("fetch", async () => new Response("rate limit", { status: 403 }));
  expect(await getGithubActivityOverview(30)).toMatchObject({ totals: { commits: 21 }, totalsSource: "search", searchStale: true });
});

it("does not mix an environment token with the previously saved account login", async () => {
  const { writeSecret } = await import("@/lib/settings/secure-store");
  await writeSecret("github.metrics_token", "synthetic-alice-token");
  await writeSecret("github.login", "alice");
  delete process.env.GITHUB_LOGIN;
  expect(await getGithubActivityOverview(30)).toMatchObject({ login: "bob" });
});

it("makes no network calls in offline mode and never guesses an unknown token's account", async () => {
  await getGithubActivityOverview(30);
  vi.stubGlobal("fetch", () => { throw new Error("offline violation"); });
  expect(await getGithubActivityOverview(30, { offline: true })).toMatchObject({ login: "bob" });
  delete process.env.GITHUB_LOGIN;
  process.env.GITHUB_TOKEN = "synthetic-unknown-token";
  expect(await getGithubActivityOverview(30, { offline: true })).toMatchObject({ login: null, daily: [] });
});

it("replaces a previously saved login when saving a new token without --login", async () => {
  const { writeSecret, readSecret } = await import("@/lib/settings/secure-store");
  await writeSecret("github.login", "alice");
  const { githubLogin } = await import("@/cli/commands/github-login");
  await githubLogin({ token: "synthetic-bob-token", noGhCli: true });
  expect(await readSecret("github.login")).toBe("bob");
});

it("honors GitHub's minimum event polling interval", async () => {
  vi.stubGlobal("fetch", async (url: string) => new URL(url).pathname.includes("/events")
    ? Response.json([], { headers: { "X-Poll-Interval": "120" } })
    : Response.json({ total_count: 0, incomplete_results: false }));
  await syncGithubIfStale();
  vi.setSystemTime(new Date("2026-07-16T00:01:40Z"));
  expect(await syncGithubIfStale()).toMatchObject({ skipped: true });
});

it("deduplicates overlapping event pages and retains capped historical day totals", async () => {
  db.insert(githubActivityDaily).values(daily("bob", 500, "2026-07-15")).run();
  vi.stubGlobal("fetch", async (url: string) => {
    const parsed = new URL(url);
    if (!parsed.pathname.includes("/events")) return Response.json({ total_count: 0, incomplete_results: false });
    const page = Number(parsed.searchParams.get("page"));
    return Response.json(Array.from({ length: 100 }, (_, index) => ({ id: String((page - 1) * 99 + index), type: "PushEvent", created_at: "2026-07-15T12:00:00Z", payload: {} })));
  });
  await syncGithubActivity();
  expect(db.select().from(githubActivityDaily).get()?.commits).toBe(500);
});

it("collapses legacy mixed-case rows for the same GitHub account and day", async () => {
  db.insert(githubActivityDaily).values([daily("Bob", 3), daily("bob", 2)]).run();
  const report = await getGithubActivityOverview(30, { offline: true });
  expect(report.daily).toEqual([expect.objectContaining({ login: "bob", commits: 3 })]);
  expect(report.totals.commits).toBe(3);
});
