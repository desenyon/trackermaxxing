import { desc, gte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { githubActivityDaily, githubSyncLog } from "@/lib/db/schema";
import { ghApiSearchCount, ghCliLogin, ghCliToken, isGhCliAuthenticated } from "@/lib/github/gh-cli";
import { getMeta, setMeta } from "@/lib/settings/meta";
import { readSecret } from "@/lib/settings/secure-store";

type JsonRecord = Record<string, unknown>;
export const GITHUB_EVENT_HISTORY_DAYS = 30;
export const GITHUB_DEFAULT_WINDOW_DAYS = 90;

export type GithubActivityMetrics = {
  commits: number;
  prsOpened: number;
  prsMerged: number;
  prsReviewed: number;
  issuesOpened: number;
  pushEvents: number;
};

export type GithubLifetimeTotals = {
  commits: number;
  prsOpened: number;
  prsMerged: number;
  reviews: number;
  issuesOpened: number;
  login: string;
  syncedAt: string;
};

export type GithubWindowTotals = {
  days: number;
  commits: number;
  prsOpened: number;
  prsMerged: number;
  reviews: number;
  issuesOpened: number;
  syncedAt: string;
};

const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const LIFETIME_META_KEY = "github.lifetime_totals";
const WINDOW_META_KEY = "github.window_totals";
const LAST_GITHUB_SYNC_KEY = "github.last_sync_at";
export const GITHUB_SEARCH_TTL_MS = 2 * 60 * 1000;
export const GITHUB_EVENTS_SYNC_TTL_MS = 30 * 1000;

export function isStaleGithubSync(syncedAt: string | undefined, ttlMs: number) {
  if (!syncedAt) return true;
  const age = Date.now() - Date.parse(syncedAt);
  return !Number.isFinite(age) || age >= ttlMs;
}

async function githubToken() {
  const stored = (await readSecret("github.metrics_token")) ?? process.env.GITHUB_TOKEN ?? null;
  if (stored) return stored;
  if (isGhCliAuthenticated()) return ghCliToken();
  return null;
}

async function githubLogin() {
  const stored = (await readSecret("github.login")) ?? process.env.GITHUB_LOGIN ?? null;
  if (stored) return stored;
  if (isGhCliAuthenticated()) return ghCliLogin();
  return null;
}

async function githubFetch(path: string, token: string) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "TrackerMaxxing",
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
  return response.json();
}

async function logSync(source: string, status: "success" | "error", rows: number, error?: string) {
  await db.insert(githubSyncLog).values({ source, day: dayKey(new Date()), status, rowsIngested: rows, error, completedAt: new Date() });
}

export function buildGithubSearchPath(kind: "commits" | "issues", query: string) {
  return `/search/${kind}?q=${encodeURIComponent(query)}&per_page=1`;
}

async function searchCount(kind: "commits" | "issues", query: string, token: string): Promise<number> {
  const path = buildGithubSearchPath(kind, query);
  if (isGhCliAuthenticated()) {
    const viaGh = ghApiSearchCount(path);
    if (viaGh !== null) return viaGh;
  }
  const payload = await githubFetch(path, token) as { total_count?: number };
  return payload.total_count ?? 0;
}

async function syncGithubLifetimeTotals(login: string, token: string) {
  const [commits, prsOpened, prsMerged, reviews, issuesOpened] = await Promise.all([
    searchCount("commits", `author:${login}`, token),
    searchCount("issues", `author:${login} type:pr`, token),
    searchCount("issues", `author:${login} type:pr is:merged`, token),
    searchCount("issues", `reviewed-by:${login} type:pr`, token),
    searchCount("issues", `author:${login} type:issue`, token),
  ]);
  const totals: GithubLifetimeTotals = { commits, prsOpened, prsMerged, reviews, issuesOpened, login, syncedAt: new Date().toISOString() };
  await setMeta(LIFETIME_META_KEY, JSON.stringify(totals));
  return totals;
}

export async function syncGithubWindowTotals(login: string, token: string, days = GITHUB_DEFAULT_WINDOW_DAYS) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days + 1);
  const sinceKey = dayKey(since);
  const [commits, prsOpened, prsMerged, reviews, issuesOpened] = await Promise.all([
    searchCount("commits", `author:${login} author-date:>=${sinceKey}`, token),
    searchCount("issues", `author:${login} type:pr created:>=${sinceKey}`, token),
    searchCount("issues", `author:${login} type:pr is:merged merged:>=${sinceKey}`, token),
    searchCount("issues", `reviewed-by:${login} type:pr created:>=${sinceKey}`, token),
    searchCount("issues", `author:${login} type:issue created:>=${sinceKey}`, token),
  ]);
  const totals: GithubWindowTotals = { days, commits, prsOpened, prsMerged, reviews, issuesOpened, syncedAt: new Date().toISOString() };
  await setMeta(WINDOW_META_KEY, JSON.stringify(totals));
  return totals;
}

export async function getGithubLifetimeTotals(): Promise<GithubLifetimeTotals | null> {
  const setting = await getMeta(LIFETIME_META_KEY);
  if (!setting) return null;
  try {
    return JSON.parse(setting.value) as GithubLifetimeTotals;
  } catch {
    return null;
  }
}

export async function getGithubWindowTotals(days = GITHUB_DEFAULT_WINDOW_DAYS): Promise<GithubWindowTotals | null> {
  const setting = await getMeta(WINDOW_META_KEY);
  if (!setting) return null;
  try {
    const parsed = JSON.parse(setting.value) as GithubWindowTotals;
    return parsed.days === days ? parsed : null;
  } catch {
    return null;
  }
}

async function refreshGithubSearchTotalsIfStale(
  login: string,
  token: string,
  days = GITHUB_DEFAULT_WINDOW_DAYS,
  { force = false } = {},
) {
  const [cachedWindow, cachedLifetime] = await Promise.all([
    getGithubWindowTotals(days),
    getGithubLifetimeTotals(),
  ]);
  const tasks: Array<Promise<unknown>> = [];
  if (force || isStaleGithubSync(cachedWindow?.syncedAt, GITHUB_SEARCH_TTL_MS)) {
    tasks.push(syncGithubWindowTotals(login, token, days));
  }
  if (force || isStaleGithubSync(cachedLifetime?.syncedAt, GITHUB_SEARCH_TTL_MS)) {
    tasks.push(syncGithubLifetimeTotals(login, token));
  }
  await Promise.all(tasks);
}

/** Pull fresh GitHub events + search totals when the cache is stale. */
export async function syncGithubIfStale(options: { force?: boolean; eventTtlMs?: number } = {}) {
  const eventTtlMs = options.eventTtlMs ?? GITHUB_EVENTS_SYNC_TTL_MS;
  const last = await getMeta(LAST_GITHUB_SYNC_KEY);
  const eventsStale = options.force || isStaleGithubSync(last?.updatedAt.toISOString(), eventTtlMs);

  const token = await githubToken();
  const login = (await getGithubLifetimeTotals())?.login ?? await githubLogin();

  if (!eventsStale) {
    if (token && login) {
      await refreshGithubSearchTotalsIfStale(login, token, GITHUB_DEFAULT_WINDOW_DAYS, { force: options.force });
    }
    return { skipped: true as const };
  }

  const result = await syncGithubActivity();
  await setMeta(LAST_GITHUB_SYNC_KEY, new Date().toISOString());
  return { skipped: false as const, ...result };
}

function numericMetric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

// GitHub's Events API often omits push payload sizes and commit arrays now.
// Fall back to one commit per push so daily activity is not silently zeroed.
export function pushCommitCount(payload: JsonRecord) {
  const fromSize = numericMetric(payload.distinct_size) ?? numericMetric(payload.size);
  if (fromSize && fromSize > 0) return fromSize;
  if (Array.isArray(payload.commits) && payload.commits.length > 0) return payload.commits.length;
  return 1;
}

export function summarizeGithubEvents(events: JsonRecord[], since: Date) {
  const totals = new Map<string, GithubActivityMetrics>();
  for (const event of events) {
    const createdAt = typeof event.created_at === "string" ? new Date(event.created_at) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime()) || createdAt < since) continue;
    const day = dayKey(createdAt);
    const bucket = totals.get(day) ?? { commits: 0, prsOpened: 0, prsMerged: 0, prsReviewed: 0, issuesOpened: 0, pushEvents: 0 };
    const type = String(event.type ?? "");
    const payload = (event.payload ?? {}) as JsonRecord;

    if (type === "PushEvent") {
      bucket.pushEvents += 1;
      bucket.commits += pushCommitCount(payload);
    }
    if (type === "PullRequestEvent") {
      const action = String(payload.action ?? "");
      const pr = (payload.pull_request ?? {}) as JsonRecord;
      if (action === "opened") bucket.prsOpened += 1;
      if (action === "closed" && pr.merged === true) bucket.prsMerged += 1;
    }
    if (type === "PullRequestReviewEvent" && payload.action === "created") bucket.prsReviewed += 1;
    if (type === "IssuesEvent" && payload.action === "opened") bucket.issuesOpened += 1;
    totals.set(day, bucket);
  }
  return totals;
}

function normalizeDailyRow<T extends { commits: number; pushEvents: number }>(row: T): T {
  if (row.commits > 0 || row.pushEvents === 0) return row;
  return { ...row, commits: row.pushEvents };
}

export async function syncGithubActivity(days = GITHUB_EVENT_HISTORY_DAYS) {
  const token = await githubToken();
  if (!token) throw new Error("GitHub token required. Set GITHUB_TOKEN or run `trackermaxxing github login`.");

  let login = await githubLogin();
  if (!login) {
    const user = await githubFetch("/user", token) as { login?: string };
    login = user.login ?? null;
  }
  if (!login) throw new Error("Unable to resolve GitHub login.");

  const totals = new Map<string, GithubActivityMetrics>();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - Math.min(days, GITHUB_EVENT_HISTORY_DAYS));

  let page = 1;
  while (page <= 10) {
    const response = await fetch(`https://api.github.com/users/${login}/events?per_page=100&page=${page}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "TrackerMaxxing",
      },
      cache: "no-store",
    });
    if (response.status === 422) break;
    if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
    const events = await response.json() as JsonRecord[];
    if (!Array.isArray(events) || events.length === 0) break;

    for (const [day, metrics] of summarizeGithubEvents(events, since)) {
      const bucket = totals.get(day) ?? { commits: 0, prsOpened: 0, prsMerged: 0, prsReviewed: 0, issuesOpened: 0, pushEvents: 0 };
      for (const key of Object.keys(metrics) as Array<keyof GithubActivityMetrics>) bucket[key] += metrics[key];
      totals.set(day, bucket);
    }

    if (events.length < 100) break;
    page += 1;
  }

  let rowsIngested = 0;
  for (const [day, metrics] of totals) {
    await db.insert(githubActivityDaily).values({ day, login, ...metrics }).onConflictDoUpdate({
      target: [githubActivityDaily.day, githubActivityDaily.login],
      set: metrics,
    });
    rowsIngested += 1;
  }

  try {
    await syncGithubLifetimeTotals(login, token);
    await syncGithubWindowTotals(login, token, GITHUB_DEFAULT_WINDOW_DAYS);
  } catch {
    // Search totals are additive; don't fail the event sync when rate-limited.
  }

  await logSync("github-activity", "success", rowsIngested);
  return { login, rowsIngested };
}

export async function getGithubActivityOverview(days = GITHUB_DEFAULT_WINDOW_DAYS) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days + 1);
  const sinceKey = dayKey(since);
  const daily = (await db.select().from(githubActivityDaily).where(gte(githubActivityDaily.day, sinceKey)).orderBy(githubActivityDaily.day))
    .map(normalizeDailyRow);

  const [eventTotals] = await db.select({
    commits: sql<number>`coalesce(sum(${githubActivityDaily.commits}), 0)`,
    prsOpened: sql<number>`coalesce(sum(${githubActivityDaily.prsOpened}), 0)`,
    prsMerged: sql<number>`coalesce(sum(${githubActivityDaily.prsMerged}), 0)`,
    prsReviewed: sql<number>`coalesce(sum(${githubActivityDaily.prsReviewed}), 0)`,
    issuesOpened: sql<number>`coalesce(sum(${githubActivityDaily.issuesOpened}), 0)`,
  }).from(githubActivityDaily).where(gte(githubActivityDaily.day, sinceKey));

  let totals = eventTotals ?? { commits: 0, prsOpened: 0, prsMerged: 0, prsReviewed: 0, issuesOpened: 0 };

  const token = await githubToken();
  const login = (await getGithubLifetimeTotals())?.login ?? await githubLogin();
  if (token && login) {
    try {
      await refreshGithubSearchTotalsIfStale(login, token, days);
      const windowTotals = days === GITHUB_DEFAULT_WINDOW_DAYS
        ? await getGithubWindowTotals(days)
        : await syncGithubWindowTotals(login, token, days);
      if (!windowTotals) throw new Error("GitHub window totals unavailable.");
      totals = {
        commits: Math.max(Number(totals.commits), windowTotals.commits),
        prsOpened: Math.max(Number(totals.prsOpened), windowTotals.prsOpened),
        prsMerged: Math.max(Number(totals.prsMerged), windowTotals.prsMerged),
        prsReviewed: Math.max(Number(totals.prsReviewed), windowTotals.reviews),
        issuesOpened: Math.max(Number(totals.issuesOpened), windowTotals.issuesOpened),
      };
    } catch {
      // Keep event-derived totals when Search is unavailable.
    }
  }

  return { daily, totals, days };
}

export async function getGithubSyncStatus() {
  return db.select().from(githubSyncLog).orderBy(desc(githubSyncLog.completedAt)).limit(10);
}
