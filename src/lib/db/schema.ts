import { foreignKey, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const codexAccountSnapshots = sqliteTable(
  "codex_account_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull(),
    accountId: text("account_id").notNull().default("default"),
    planType: text("plan_type"),
    primaryUsedPct: real("primary_used_pct"),
    secondaryUsedPct: real("secondary_used_pct"),
    primaryResetAt: integer("primary_reset_at", { mode: "timestamp_ms" }),
    secondaryResetAt: integer("secondary_reset_at", { mode: "timestamp_ms" }),
    creditsBalance: real("credits_balance"),
    lifetimeTokens: integer("lifetime_tokens"),
    peakDailyTokens: integer("peak_daily_tokens"),
    streakDays: integer("streak_days"),
  },
  (table) => [index("codex_snapshots_timestamp_index").on(table.timestamp)],
);

export const githubSyncLog = sqliteTable("gh_sync_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(),
  day: text("day"),
  status: text("status").notNull(),
  rowsIngested: integer("rows_ingested").notNull().default(0),
  error: text("error"),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }).notNull(),
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const aiSessions = sqliteTable(
  "ai_sessions",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    sessionPath: text("session_path").notNull(),
    firstActivity: integer("first_activity", { mode: "timestamp_ms" }).notNull(),
    lastActivity: integer("last_activity", { mode: "timestamp_ms" }).notNull(),
    model: text("model"),
    cwd: text("cwd"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    estimatedCostUsd: real("estimated_cost_usd").notNull().default(0),
    turnCount: integer("turn_count").notNull().default(0),
    sourceFileHash: text("source_file_hash").notNull(),
  },
  (table) => [
    // Identity is (provider, sessionPath), not content hash - a session file's
    // hash changes every time it grows, so hashing content would insert a new
    // row per sync instead of updating the same session in place.
    uniqueIndex("ai_sessions_provider_path_unique").on(table.provider, table.sessionPath),
    index("ai_sessions_provider_index").on(table.provider),
  ],
);

export const aiDailyRollups = sqliteTable(
  "ai_daily_rollups",
  {
    date: text("date").notNull(),
    provider: text("provider").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cachedTokens: integer("cached_tokens").notNull().default(0),
    sessionCount: integer("session_count").notNull().default(0),
    turnCount: integer("turn_count").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
  },
  (table) => [uniqueIndex("ai_daily_rollups_date_provider_unique").on(table.date, table.provider)],
);

export const githubActivityDaily = sqliteTable(
  "gh_activity_daily",
  {
    day: text("day").notNull(),
    login: text("login").notNull(),
    commits: integer("commits").notNull().default(0),
    prsOpened: integer("prs_opened").notNull().default(0),
    prsMerged: integer("prs_merged").notNull().default(0),
    prsReviewed: integer("prs_reviewed").notNull().default(0),
    issuesOpened: integer("issues_opened").notNull().default(0),
    pushEvents: integer("push_events").notNull().default(0),
  },
  (table) => [uniqueIndex("gh_activity_daily_unique").on(table.day, table.login)],
);

// Canonical per-session ledger: rollups can be rebuilt without re-reading sources.
export const aiSessionDaily = sqliteTable("ai_session_daily", {
  provider: text("provider").notNull(),
  sessionPath: text("session_path").notNull(),
  date: text("date").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
  reasoningTokens: integer("reasoning_tokens").notNull().default(0),
  estimatedCostUsd: real("estimated_cost_usd").notNull().default(0),
  turnCount: integer("turn_count").notNull().default(0),
}, (table) => [
  uniqueIndex("ai_session_daily_identity").on(table.provider, table.sessionPath, table.date),
  index("ai_session_daily_date").on(table.date),
  foreignKey({ columns: [table.provider, table.sessionPath], foreignColumns: [aiSessions.provider, aiSessions.sessionPath] }).onDelete("cascade"),
]);
