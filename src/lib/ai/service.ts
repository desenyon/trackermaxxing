import { createHash } from "node:crypto";

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";

import { type AiSession, type AiDailyUsage, usageFields } from "@/lib/ai/session";
import { db } from "@/lib/db";
import { aiDailyRollups, aiSessionDaily, aiSessions } from "@/lib/db/schema";

import { utcDay as dayKey, utcWindow } from "@/lib/time";

function sessionDays(session: AiSession): AiDailyUsage[] {
  const rows = session.dailyUsage ?? [{ ...session, date: dayKey(session.firstActivity) }];
  const dates = new Set<string>();
  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || new Date(row.date).toISOString().slice(0, 10) !== row.date || dates.has(row.date)) {
      throw new Error(`Invalid or duplicate usage day: ${row.date}`);
    }
    dates.add(row.date);
    for (const field of usageFields) {
      if (!Number.isFinite(row[field]) || row[field] < 0 || (field !== "estimatedCostUsd" && !Number.isSafeInteger(row[field]))) {
        throw new Error(`Invalid ${field} in session ${session.sessionPath}`);
      }
    }
  }
  for (const field of usageFields) {
    const sum = rows.reduce((total, row) => total + row[field], 0);
    if (!Number.isFinite(session[field]) || Math.abs(sum - session[field]) > 1e-8) {
      throw new Error(`Daily ${field} does not match session ${session.sessionPath}`);
    }
  }
  return rows;
}

/** Replace one complete provider snapshot and its projections in one transaction. */
export function reconcileAiSessions(provider: string, sessions: AiSession[]) {
  return db.transaction((tx) => {
    const paths = new Set<string>();
    for (const session of sessions) {
      if (paths.has(session.sessionPath)) throw new Error(`Duplicate session path: ${session.sessionPath}`);
      paths.add(session.sessionPath);
      const days = sessionDays(session);
      const row = { ...session };
      delete row.dailyUsage;
      const values = { ...row, id: `${provider}-${createHash("sha256").update(session.sessionPath).digest("hex")}`, provider, sourceFileHash: `${provider}:${session.sourceFileHash}` };
      tx.insert(aiSessions).values(values).onConflictDoUpdate({
        target: [aiSessions.provider, aiSessions.sessionPath], set: values,
      }).run();
      tx.delete(aiSessionDaily).where(and(eq(aiSessionDaily.provider, provider), eq(aiSessionDaily.sessionPath, session.sessionPath))).run();
      for (const day of days) {
        tx.insert(aiSessionDaily).values({
          provider, sessionPath: session.sessionPath, date: day.date,
          inputTokens: day.inputTokens, outputTokens: day.outputTokens,
          cachedInputTokens: day.cachedInputTokens, reasoningTokens: day.reasoningTokens,
          estimatedCostUsd: day.estimatedCostUsd, turnCount: day.turnCount,
        }).run();
      }
    }
    // Do not put every path into a NOT IN query: large histories exceed SQLite's variable limit.
    for (const row of tx.select({ path: aiSessions.sessionPath }).from(aiSessions).where(eq(aiSessions.provider, provider)).all()) {
      if (!paths.has(row.path)) tx.delete(aiSessions).where(and(eq(aiSessions.provider, provider), eq(aiSessions.sessionPath, row.path))).run();
    }
    refreshAiDailyRollups();
    return sessions.length;
  });
}

export function refreshAiDailyRollups() {
  return db.transaction((tx) => {
    tx.delete(aiDailyRollups).run();
    tx.run(sql`
      INSERT INTO ai_daily_rollups (date, provider, input_tokens, output_tokens, cached_tokens, session_count, turn_count, cost_usd)
      SELECT date, provider, sum(input_tokens), sum(output_tokens), sum(cached_input_tokens), count(*), sum(turn_count), sum(estimated_cost_usd)
      FROM ai_session_daily GROUP BY date, provider
    `);
  });
}

export async function getUnifiedOverview(days = 90) {
  return db.transaction((tx) => {
    const { since: sinceKey, through } = utcWindow(days);

    const daily = tx.select().from(aiDailyRollups).where(and(gte(aiDailyRollups.date, sinceKey), lte(aiDailyRollups.date, through))).orderBy(aiDailyRollups.date).all();
    const byProvider = tx.select({
      provider: aiSessions.provider,
      inputTokens: sql<number>`coalesce(sum(${aiSessions.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${aiSessions.outputTokens}), 0)`,
      sessions: sql<number>`count(*)`,
      cost: sql<number>`coalesce(sum(${aiSessions.estimatedCostUsd}), 0)`,
    }).from(aiSessions).groupBy(aiSessions.provider).all();

    const lifetime = tx.select({
      inputTokens: sql<number>`coalesce(sum(${aiSessions.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${aiSessions.outputTokens}), 0)`,
      sessions: sql<number>`count(*)`,
      cost: sql<number>`coalesce(sum(${aiSessions.estimatedCostUsd}), 0)`,
    }).from(aiSessions).get();

    const todayRows = daily.filter((row) => row.date === through);
    const todayTokens = todayRows.reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0);

    return {
      lifetime: {
        totalTokens: Number(lifetime?.inputTokens ?? 0) + Number(lifetime?.outputTokens ?? 0),
        sessions: Number(lifetime?.sessions ?? 0),
        estimatedCostUsd: Number(lifetime?.cost ?? 0),
      },
      today: { tokens: todayTokens, sessions: todayRows.reduce((sum, row) => sum + row.sessionCount, 0) },
      byProvider: byProvider.map((row) => ({
        provider: row.provider,
        totalTokens: Number(row.inputTokens) + Number(row.outputTokens),
        sessions: Number(row.sessions),
        cost: Number(row.cost),
      })),
      daily,
      recentSessions: tx.select().from(aiSessions).orderBy(desc(aiSessions.lastActivity)).limit(8).all(),
    };
  });
}

export async function getTopSessions(provider?: string, limit = 20) {
  const query = db.select().from(aiSessions);
  const rows = provider ? await query.where(eq(aiSessions.provider, provider)) : await query;
  return rows
    .sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens))
    .slice(0, limit);
}
