export const bootstrapSql = `
  CREATE TABLE IF NOT EXISTS codex_account_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    account_id TEXT NOT NULL DEFAULT 'default',
    plan_type TEXT,
    primary_used_pct REAL,
    secondary_used_pct REAL,
    primary_reset_at INTEGER,
    secondary_reset_at INTEGER,
    credits_balance REAL,
    lifetime_tokens INTEGER,
    peak_daily_tokens INTEGER,
    streak_days INTEGER
  );
  CREATE INDEX IF NOT EXISTS codex_snapshots_timestamp_index ON codex_account_snapshots(timestamp);
  CREATE TABLE IF NOT EXISTS gh_sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, day TEXT, status TEXT NOT NULL,
    rows_ingested INTEGER NOT NULL DEFAULT 0, error TEXT, completed_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ai_sessions (
    id TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL, session_path TEXT NOT NULL,
    first_activity INTEGER NOT NULL, last_activity INTEGER NOT NULL, model TEXT, cwd TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
    cached_input_tokens INTEGER NOT NULL DEFAULT 0, reasoning_tokens INTEGER NOT NULL DEFAULT 0,
    estimated_cost_usd REAL NOT NULL DEFAULT 0, turn_count INTEGER NOT NULL DEFAULT 0,
    source_file_hash TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS ai_sessions_provider_path_unique ON ai_sessions(provider, session_path);
  CREATE INDEX IF NOT EXISTS ai_sessions_provider_index ON ai_sessions(provider);
  CREATE TABLE IF NOT EXISTS ai_daily_rollups (
    date TEXT NOT NULL, provider TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0, cached_tokens INTEGER NOT NULL DEFAULT 0,
    session_count INTEGER NOT NULL DEFAULT 0, turn_count INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0, UNIQUE(date, provider)
  );
  CREATE TABLE IF NOT EXISTS gh_activity_daily (
    day TEXT NOT NULL, login TEXT NOT NULL, commits INTEGER NOT NULL DEFAULT 0,
    prs_opened INTEGER NOT NULL DEFAULT 0, prs_merged INTEGER NOT NULL DEFAULT 0,
    prs_reviewed INTEGER NOT NULL DEFAULT 0, issues_opened INTEGER NOT NULL DEFAULT 0,
    push_events INTEGER NOT NULL DEFAULT 0, UNIQUE(day, login)
  );
`;
