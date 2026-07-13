import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { db } from "@/lib/db";
import { codexAccountSnapshots } from "@/lib/db/schema";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function date(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = typeof value === "number"
    ? new Date(value < 10_000_000_000 ? value * 1_000 : value)
    : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function authPath() {
  const raw = process.env.CODEX_AUTH_PATH ?? "~/.codex/auth.json";
  return resolve(raw.replace(/^~(?=$|\/)/, homedir()));
}

export async function getCodexUsage() {
  let auth: JsonRecord;
  try {
    auth = record(JSON.parse(await fs.readFile(authPath(), "utf8"))) ?? {};
  } catch {
    throw new Error(`Codex auth file not found at ${authPath()}. Sign in with the Codex CLI first.`);
  }
  const tokens = record(auth.tokens) ?? auth;
  const token = typeof tokens.access_token === "string" ? tokens.access_token : null;
  if (!token) throw new Error("Codex auth file does not contain an access token. Run `codex login`.");
  const accountId = typeof tokens.account_id === "string" ? tokens.account_id : undefined;
  const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(accountId ? { "ChatGPT-Account-Id": accountId } : {}),
      "User-Agent": "TrackerMaxxing",
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`ChatGPT usage API returned ${response.status}. Re-authenticate with Codex if this persists.`);
  const payload = record(await response.json()) ?? {};
  const rateLimit = record(payload.rate_limit) ?? {};
  const primary = record(rateLimit.primary_window) ?? {};
  const secondary = record(rateLimit.secondary_window) ?? {};
  const summary = record(payload.summary) ?? {};
  const snapshot = {
    accountId: accountId ?? "default",
    planType: typeof payload.plan_type === "string" ? payload.plan_type : null,
    primaryUsedPct: number(primary.used_percent),
    secondaryUsedPct: number(secondary.used_percent),
    primaryResetAt: date(primary.reset_at),
    secondaryResetAt: date(secondary.reset_at),
    creditsBalance: number(record(payload.credits)?.balance),
    lifetimeTokens: number(summary.lifetime_tokens),
    peakDailyTokens: number(summary.peak_daily_tokens),
    streakDays: number(summary.current_streak_days),
  };
  await db.insert(codexAccountSnapshots).values({ timestamp: new Date(), ...snapshot });
  return snapshot;
}
