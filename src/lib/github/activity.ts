import { desc, gte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { githubActivityDaily, githubSyncLog } from "@/lib/db/schema";
import { readSecret } from "@/lib/settings/secure-store";

type JsonRecord = Record<string, unknown>;

const dayKey = (date: Date) => date.toISOString().slice(0, 10);

async function githubToken() {
  return (await readSecret("github.metrics_token")) ?? process.env.GITHUB_TOKEN ?? null;
}

async function githubLogin() {
  return (await readSecret("github.login")) ?? process.env.GITHUB_LOGIN ?? null;
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

export async function syncGithubActivity(days = 90) {
  const token = await githubToken();
  if (!token) throw new Error("GitHub token required. Set GITHUB_TOKEN or run `trackermaxxing github login`.");

  let login = await githubLogin();
  if (!login) {
    const user = await githubFetch("/user", token) as { login?: string };
    login = user.login ?? null;
  }
  if (!login) throw new Error("Unable to resolve GitHub login.");

  const totals = new Map<string, { commits: number; prsOpened: number; prsMerged: number; prsReviewed: number; issuesOpened: number; pushEvents: number }>();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);

  let page = 1;
  while (page <= 10) {
    // GitHub caps how far back the Events API paginates (roughly the last 300
    // events) and returns a 422 once you're past it - that's "no more history
    // available", not a real failure, so stop cleanly instead of throwing.
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

    for (const event of events) {
      const createdAt = typeof event.created_at === "string" ? new Date(event.created_at) : null;
      if (!createdAt || createdAt < since) continue;
      const day = dayKey(createdAt);
      const bucket = totals.get(day) ?? { commits: 0, prsOpened: 0, prsMerged: 0, prsReviewed: 0, issuesOpened: 0, pushEvents: 0 };
      const type = String(event.type ?? "");
      const payload = (event.payload ?? {}) as JsonRecord;

      if (type === "PushEvent") {
        bucket.pushEvents += 1;
        const commits = Array.isArray(payload.commits) ? payload.commits.length : 0;
        bucket.commits += commits;
      }
      if (type === "PullRequestEvent") {
        const action = String(payload.action ?? "");
        const pr = (payload.pull_request ?? {}) as JsonRecord;
        if (action === "opened") bucket.prsOpened += 1;
        if (action === "closed" && pr.merged === true) bucket.prsMerged += 1;
      }
      if (type === "PullRequestReviewEvent") bucket.prsReviewed += 1;
      if (type === "IssuesEvent" && payload.action === "opened") bucket.issuesOpened += 1;
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

  await logSync("github-activity", "success", rowsIngested);
  return { login, rowsIngested };
}

export async function getGithubActivityOverview(days = 90) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days + 1);
  const daily = await db.select().from(githubActivityDaily).where(gte(githubActivityDaily.day, dayKey(since))).orderBy(githubActivityDaily.day);
  const [totals] = await db.select({
    commits: sql<number>`coalesce(sum(${githubActivityDaily.commits}), 0)`,
    prsOpened: sql<number>`coalesce(sum(${githubActivityDaily.prsOpened}), 0)`,
    prsMerged: sql<number>`coalesce(sum(${githubActivityDaily.prsMerged}), 0)`,
    prsReviewed: sql<number>`coalesce(sum(${githubActivityDaily.prsReviewed}), 0)`,
    issuesOpened: sql<number>`coalesce(sum(${githubActivityDaily.issuesOpened}), 0)`,
  }).from(githubActivityDaily).where(gte(githubActivityDaily.day, dayKey(since)));

  return { daily, totals: totals ?? { commits: 0, prsOpened: 0, prsMerged: 0, prsReviewed: 0, issuesOpened: 0 } };
}

export async function getGithubSyncStatus() {
  return db.select().from(githubSyncLog).orderBy(desc(githubSyncLog.completedAt)).limit(10);
}
