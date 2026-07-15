import { and, desc, eq, gte, notInArray, sql } from "drizzle-orm";

import type { CodexSession } from "@/lib/codex/parser";
import { db } from "@/lib/db";
import { aiDailyRollups, aiSessions } from "@/lib/db/schema";

const dayKey = (date: Date) => date.toISOString().slice(0, 10);

export function reconcileAiSessions(provider: string, sessions: CodexSession[]) {
  return db.transaction((tx) => {
    for (const session of sessions) {
    // Identity is the session file's path, not its content hash. Codex/Claude
    // session files are appended to while a session is active, so the same
    // still-growing session hashes differently on every sync - keying on
    // content used to insert a brand new row each time instead of updating the
    // existing one, silently multi-counting the same conversation.
      tx.insert(aiSessions).values({
      id: session.id,
      provider,
      sessionPath: session.sessionPath,
      firstActivity: session.firstActivity,
      lastActivity: session.lastActivity,
      model: session.model,
      cwd: session.cwd,
      inputTokens: session.inputTokens,
      outputTokens: session.outputTokens,
      cachedInputTokens: session.cachedInputTokens,
      reasoningTokens: session.reasoningTokens,
      estimatedCostUsd: session.estimatedCostUsd,
      turnCount: session.turnCount,
      sourceFileHash: `${provider}:${session.sourceFileHash}`,
      }).onConflictDoUpdate({
      target: [aiSessions.provider, aiSessions.sessionPath],
      set: {
        id: session.id,
        firstActivity: session.firstActivity,
        lastActivity: session.lastActivity,
        model: session.model,
        cwd: session.cwd,
        inputTokens: session.inputTokens,
        outputTokens: session.outputTokens,
        cachedInputTokens: session.cachedInputTokens,
        reasoningTokens: session.reasoningTokens,
        estimatedCostUsd: session.estimatedCostUsd,
        turnCount: session.turnCount,
        sourceFileHash: `${provider}:${session.sourceFileHash}`,
      },
      }).run();
    }

    const providerRows = eq(aiSessions.provider, provider);
    if (sessions.length === 0) {
      tx.delete(aiSessions).where(providerRows).run();
    } else {
      tx.delete(aiSessions).where(and(
        providerRows,
        notInArray(aiSessions.sessionPath, sessions.map((session) => session.sessionPath)),
      )).run();
    }
    return sessions.length;
  });
}

export function refreshAiDailyRollups() {
  return db.transaction((tx) => {
    const sessions = tx.select().from(aiSessions).all();
    const totals = new Map<string, typeof sessions>();
    for (const session of sessions) {
      const key = `${session.provider}:${dayKey(session.firstActivity)}`;
      totals.set(key, [...(totals.get(key) ?? []), session]);
    }

    tx.delete(aiDailyRollups).run();
    for (const [key, rows] of totals) {
      const [provider, date] = key.split(":");
      const sum = (field: keyof (typeof rows)[number]) => rows.reduce((total, row) => total + Number(row[field] ?? 0), 0);
      tx.insert(aiDailyRollups).values({
        date,
        provider,
        inputTokens: sum("inputTokens"),
        outputTokens: sum("outputTokens"),
        cachedTokens: sum("cachedInputTokens"),
        sessionCount: rows.length,
        turnCount: sum("turnCount"),
        costUsd: sum("estimatedCostUsd"),
      }).run();
    }
  });
}

export async function getUnifiedOverview(days = 90) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days + 1);
  const sinceKey = dayKey(since);

  const daily = await db.select().from(aiDailyRollups).where(gte(aiDailyRollups.date, sinceKey)).orderBy(aiDailyRollups.date);
  const byProvider = await db.select({
    provider: aiSessions.provider,
    inputTokens: sql<number>`coalesce(sum(${aiSessions.inputTokens}), 0)`,
    outputTokens: sql<number>`coalesce(sum(${aiSessions.outputTokens}), 0)`,
    sessions: sql<number>`count(*)`,
    cost: sql<number>`coalesce(sum(${aiSessions.estimatedCostUsd}), 0)`,
  }).from(aiSessions).groupBy(aiSessions.provider);

  const [lifetime] = await db.select({
    inputTokens: sql<number>`coalesce(sum(${aiSessions.inputTokens}), 0)`,
    outputTokens: sql<number>`coalesce(sum(${aiSessions.outputTokens}), 0)`,
    sessions: sql<number>`count(*)`,
    cost: sql<number>`coalesce(sum(${aiSessions.estimatedCostUsd}), 0)`,
  }).from(aiSessions);

  const todayRows = daily.filter((row) => row.date === dayKey(new Date()));
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
    recentSessions: await db.select().from(aiSessions).orderBy(desc(aiSessions.lastActivity)).limit(8),
  };
}

export async function getTopSessions(provider?: string, limit = 20) {
  const query = db.select().from(aiSessions);
  const rows = provider ? await query.where(eq(aiSessions.provider, provider)) : await query;
  return rows
    .sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens))
    .slice(0, limit);
}
