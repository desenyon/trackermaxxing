import { and, desc, eq, gte, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { githubActivityDaily, githubSyncLog } from "@/lib/db/schema";
import { getMeta, setMeta } from "@/lib/settings/meta";
import { normalizeGithubLogin, rememberGithubAccount, resolveGithubAccount, type GithubAccount } from "./account";
import { githubFetch } from "./transport";

type JsonRecord = Record<string, unknown>;
export const GITHUB_EVENT_HISTORY_DAYS = 30;
export const GITHUB_DEFAULT_WINDOW_DAYS = 90;
export const GITHUB_SEARCH_TTL_MS = 2 * 60 * 1000;
export const GITHUB_EVENTS_SYNC_TTL_MS = 30 * 1000;

export type GithubActivityMetrics = {
  commits: number; prsOpened: number; prsMerged: number; prsReviewed: number; issuesOpened: number; pushEvents: number;
};
export type GithubLifetimeTotals = {
  commits: number; prsOpened: number; prsMerged: number; reviews: number; issuesOpened: number; login: string; syncedAt: string;
};
export type GithubWindowTotals = GithubLifetimeTotals & { days: number; since: string; through: string };
export type GithubOverview = {
  daily: (typeof githubActivityDaily.$inferSelect)[];
  totals: Omit<GithubActivityMetrics, "pushEvents">;
  days: number;
  login?: string | null;
  lifetime?: GithubLifetimeTotals | null;
  totalsSource?: "search" | "events";
  searchStale?: boolean;
  warning?: string;
};

import { utcDay as dayKey, utcWindow as dateWindow } from "@/lib/time";
const accountKey = (login: string, suffix: string) => `github.accounts.${normalizeGithubLogin(login)}.${suffix}`;
const zeroMetrics = (): GithubActivityMetrics => ({ commits: 0, prsOpened: 0, prsMerged: 0, prsReviewed: 0, issuesOpened: 0, pushEvents: 0 });

export function windowTotalsMetaKey(days: number, login: string) {
  return accountKey(login, `window_totals.${days}`);
}

export function isStaleGithubSync(syncedAt: string | undefined, ttlMs: number) {
  if (!syncedAt) return true;
  const age = Date.now() - Date.parse(syncedAt);
  return !Number.isFinite(age) || age < 0 || age >= ttlMs;
}

export function buildGithubSearchPath(kind: "commits" | "issues", query: string) {
  return `/search/${kind}?q=${encodeURIComponent(query)}&per_page=1`;
}

async function searchCount(kind: "commits" | "issues", query: string, token: string) {
  const payload = await githubFetch(buildGithubSearchPath(kind, query), token) as { total_count?: unknown; incomplete_results?: boolean };
  if (!Number.isSafeInteger(payload.total_count) || Number(payload.total_count) < 0 || payload.incomplete_results === true) {
    throw new Error("GitHub Search returned incomplete or invalid totals.");
  }
  return Number(payload.total_count);
}

async function searchTotals(login: string, token: string, window?: { since: string; through: string }) {
  const range = window ? `${window.since}..${window.through}` : null;
  // Sequential calls keep the ten-request refresh below a burst of parallel Search requests.
  const commits = await searchCount("commits", `author:${login}${range ? ` author-date:${range}` : ""}`, token);
  const prsOpened = await searchCount("issues", `author:${login} type:pr${range ? ` created:${range}` : ""}`, token);
  const prsMerged = await searchCount("issues", `author:${login} type:pr is:merged${range ? ` merged:${range}` : ""}`, token);
  const reviews = await searchCount("issues", `reviewed-by:${login} type:pr${range ? ` created:${range}` : ""}`, token);
  const issuesOpened = await searchCount("issues", `author:${login} type:issue${range ? ` created:${range}` : ""}`, token);
  return { commits, prsOpened, prsMerged, reviews, issuesOpened, login, syncedAt: new Date().toISOString() };
}

async function readTotals(key: string, login: string): Promise<GithubLifetimeTotals | null> {
  const setting = await getMeta(key);
  if (!setting) return null;
  try {
    const value = JSON.parse(setting.value);
    if (value?.login !== login || typeof value.syncedAt !== "string" || !Number.isFinite(Date.parse(value.syncedAt))) return null;
    for (const field of ["commits", "prsOpened", "prsMerged", "reviews", "issuesOpened"]) {
      if (!Number.isSafeInteger(value[field]) || value[field] < 0) return null;
    }
    return value;
  } catch { return null; }
}

export async function getGithubLifetimeTotals(login?: string): Promise<GithubLifetimeTotals | null> {
  login ??= (await resolveGithubAccount({ offline: true }))?.login;
  if (!login) return null;
  login = normalizeGithubLogin(login);
  return readTotals(accountKey(login, "lifetime_totals"), login);
}

export async function getGithubWindowTotals(days = GITHUB_DEFAULT_WINDOW_DAYS, login?: string): Promise<GithubWindowTotals | null> {
  login ??= (await resolveGithubAccount({ offline: true }))?.login;
  if (!login) return null;
  login = normalizeGithubLogin(login);
  const parsed = await readTotals(windowTotalsMetaKey(days, login), login) as GithubWindowTotals | null;
  const window = dateWindow(days);
  return parsed?.days === days && parsed.since === window.since && parsed.through === window.through ? parsed : null;
}

export async function syncGithubWindowTotals(login: string, token: string, days = GITHUB_DEFAULT_WINDOW_DAYS) {
  login = normalizeGithubLogin(login);
  const window = dateWindow(days);
  const totals: GithubWindowTotals = { ...await searchTotals(login, token, window), ...window, days };
  await setMeta(windowTotalsMetaKey(days, login), JSON.stringify(totals));
  return totals;
}

const searchRefreshes = new Map<string, Promise<void>>();
async function refreshSearch(account: GithubAccount, days: number, force = false) {
  if (!account.token) return;
  const { login, token } = account;
  const key = windowTotalsMetaKey(days, login);
  const existing = searchRefreshes.get(key);
  if (existing) return existing;
  const task = (async () => {
    const cachedLifetime = await getGithubLifetimeTotals(login);
    const cachedWindow = await getGithubWindowTotals(days, login);
    if (force || isStaleGithubSync(cachedLifetime?.syncedAt, GITHUB_SEARCH_TTL_MS)) {
      const totals = await searchTotals(login, token);
      await setMeta(accountKey(login, "lifetime_totals"), JSON.stringify(totals));
    }
    if (force || isStaleGithubSync(cachedWindow?.syncedAt, GITHUB_SEARCH_TTL_MS)) await syncGithubWindowTotals(login, token, days);
  })().finally(() => searchRefreshes.delete(key));
  searchRefreshes.set(key, task);
  return task;
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


const eventSyncs = new Map<string, Promise<{ login: string; rowsIngested: number; warning?: string }>>();
async function syncEvents(account: GithubAccount, days: number, forceSearch = false) {
  const { login, token } = account;
  if (!token) throw new Error("GitHub token required. Set GITHUB_TOKEN or run `trackermaxxing github login`.");
  dateWindow(days);
  const key = `${login}:${days}`;
  const existing = eventSyncs.get(key);
  if (existing) return existing;
  const task = (async () => {
    const window = dateWindow(Math.min(days, GITHUB_EVENT_HISTORY_DAYS));
    const since = new Date(`${window.since}T00:00:00Z`);
    const events: JsonRecord[] = [];
    const ids = new Set<string>();
    let truncated = false;
    let pollMs = GITHUB_EVENTS_SYNC_TTL_MS;
    for (let page = 1; page <= 3; page += 1) {
      const batch = await githubFetch(`/users/${encodeURIComponent(login)}/events?per_page=100&page=${page}`, token, (headers) => {
        const seconds = Number(headers.get("x-poll-interval"));
        if (Number.isFinite(seconds) && seconds > 0) pollMs = Math.max(pollMs, seconds * 1000);
      });
      if (!Array.isArray(batch)) throw new Error("GitHub Events returned invalid data.");
      for (const event of batch) {
        if (!event || typeof event !== "object" || typeof event.created_at !== "string" || !Number.isFinite(Date.parse(event.created_at))) {
          throw new Error("GitHub Events returned an invalid timestamp.");
        }
        if (typeof event.id === "string") {
          if (ids.has(event.id)) continue;
          ids.add(event.id);
        }
        events.push(event);
      }
      if (batch.length < 100) break;
      if (page === 3) truncated = true;
    }
    const totals = summarizeGithubEvents(events, since);
    // At the API cap the oldest returned day may be incomplete. Preserve its
    // previous lower bound and never delete history that the response cannot cover.
    const oldest = events.map((event) => String(event.created_at).slice(0, 10)).sort()[0];
    const partialDay = truncated && oldest && oldest >= window.since ? oldest : null;
    const replacementSince = partialDay ?? window.since;
    db.transaction((tx) => {
      tx.delete(githubActivityDaily).where(and(
        sql`lower(${githubActivityDaily.login}) = ${login}`,
        partialDay ? sql`${githubActivityDaily.day} > ${replacementSince}` : gte(githubActivityDaily.day, replacementSince),
        lte(githubActivityDaily.day, window.through),
      )).run();
      for (const [day, metrics] of totals) {
        if (day > window.through) continue;
        const previous = tx.select().from(githubActivityDaily).where(and(eq(githubActivityDaily.day, day), sql`lower(${githubActivityDaily.login}) = ${login}`)).all();
        if (day === partialDay) {
          for (const row of previous) for (const field of Object.keys(metrics) as (keyof GithubActivityMetrics)[]) metrics[field] = Math.max(metrics[field], row[field]);
        }
        // Normalize any historical mixed-case account key on replacement.
        tx.delete(githubActivityDaily).where(and(eq(githubActivityDaily.day, day), sql`lower(${githubActivityDaily.login}) = ${login}`)).run();
        tx.insert(githubActivityDaily).values({ day, login, ...metrics }).run();
      }
      tx.insert(githubSyncLog).values({ source: `github-activity:${login}`, day: window.through, status: "success", rowsIngested: totals.size, completedAt: new Date() }).run();
    });
    await setMeta(accountKey(login, "last_sync_at"), new Date().toISOString());
    await setMeta(accountKey(login, "next_event_sync_at"), new Date(Date.now() + pollMs).toISOString());
    await rememberGithubAccount(login);
    let warning: string | undefined;
    try { await refreshSearch(account, GITHUB_DEFAULT_WINDOW_DAYS, forceSearch); }
    catch (error) { warning = error instanceof Error ? error.message : "GitHub Search unavailable."; }
    return { login, rowsIngested: totals.size, ...(warning ? { warning } : {}) };
  })().finally(() => eventSyncs.delete(key));
  eventSyncs.set(key, task);
  return task;
}

export async function syncGithubActivity(days = GITHUB_EVENT_HISTORY_DAYS) {
  const account = await resolveGithubAccount();
  if (!account) throw new Error("GitHub account required. Run `trackermaxxing github login`.");
  return syncEvents(account, days);
}

export async function syncGithubIfStale(options: { force?: boolean; eventTtlMs?: number } = {}) {
  const account = await resolveGithubAccount();
  if (!account?.token) return { skipped: true as const };
  const last = await getMeta(accountKey(account.login, "last_sync_at"));
  const next = await getMeta(accountKey(account.login, "next_event_sync_at"));
  if (next && Date.parse(next.value) > Date.now()) {
    await refreshSearch(account, GITHUB_DEFAULT_WINDOW_DAYS, options.force);
    return { skipped: true as const };
  }
  if (!options.force && !isStaleGithubSync(last?.value, options.eventTtlMs ?? GITHUB_EVENTS_SYNC_TTL_MS) && last?.value.slice(0, 10) === dayKey(new Date())) {
    await refreshSearch(account, GITHUB_DEFAULT_WINDOW_DAYS);
    return { skipped: true as const };
  }
  const result = await syncEvents(account, GITHUB_EVENT_HISTORY_DAYS, options.force);
  return { skipped: false as const, ...result };
}

export async function getGithubActivityOverview(days = GITHUB_DEFAULT_WINDOW_DAYS, options: { offline?: boolean } = {}): Promise<GithubOverview> {
  const window = dateWindow(days);
  const account = await resolveGithubAccount(options);
  if (!account) return { daily: [], totals: zeroMetrics(), days, login: null, lifetime: null, totalsSource: "events" };
  const { login } = account;
  const rows = db.select().from(githubActivityDaily).where(and(
    sql`lower(${githubActivityDaily.login}) = ${login}`, gte(githubActivityDaily.day, window.since), lte(githubActivityDaily.day, window.through),
  )).orderBy(githubActivityDaily.day).all().map((row) => ({ ...row, commits: row.commits || row.pushEvents }));
  const byDay = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    const previous = byDay.get(row.day);
    const merged = { ...row, login };
    if (previous) for (const field of Object.keys(zeroMetrics()) as (keyof GithubActivityMetrics)[]) merged[field] = Math.max(previous[field], row[field]);
    byDay.set(row.day, merged);
  }
  const daily = [...byDay.values()];
  let warning: string | undefined;
  if (!options.offline && account.token) {
    try { await refreshSearch(account, days); await rememberGithubAccount(login); }
    catch (error) { warning = error instanceof Error ? error.message : "GitHub Search unavailable."; }
  }
  const cached = await getGithubWindowTotals(days, login);
  const lifetime = await getGithubLifetimeTotals(login);
  const totals = zeroMetrics();
  for (const row of daily) for (const field of Object.keys(totals) as (keyof GithubActivityMetrics)[]) totals[field] += row[field];
  // Search counts authorship; push events count pushed commits. They are different
  // measurements, so do not take max() and inflate Search with someone else's commits.
  return {
    daily, days, login, lifetime,
    totals: cached ? { commits: cached.commits, prsOpened: cached.prsOpened, prsMerged: cached.prsMerged, prsReviewed: cached.reviews, issuesOpened: cached.issuesOpened } : totals,
    totalsSource: cached ? "search" : "events",
    searchStale: isStaleGithubSync(cached?.syncedAt, GITHUB_SEARCH_TTL_MS),
    ...(warning ? { warning } : {}),
  };
}

export async function getGithubSyncStatus() {
  return db.select().from(githubSyncLog).orderBy(desc(githubSyncLog.completedAt)).limit(10);
}
