import type Database from "better-sqlite3";

// ai_sessions originally had an inline UNIQUE constraint on source_file_hash
// (a content hash), which SQLite can't drop with ALTER TABLE - it has to be
// rebuilt. Existing installs also picked up duplicate rows from that bug
// (the same growing session file re-inserted on every sync instead of
// updated in place), so this both migrates the schema and collapses those
// duplicates down to the most complete row per (provider, session_path).
export function migrateAiSessionsIdentity(sqlite: Database.Database) {
  const table = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ai_sessions'")
    .get() as { sql: string } | undefined;
  if (!table) return;

  const hasInlineSourceHashIdentity = (sqlite.pragma("index_list('ai_sessions')") as Array<{
    name: string;
    origin: string;
    unique: number;
  }>).some((index) => {
    if (index.origin !== "u" || index.unique !== 1) return false;
    const columns = sqlite.pragma(`index_info('${index.name.replaceAll("'", "''")}')`) as Array<{ name: string }>;
    return columns.length === 1 && columns[0]?.name === "source_file_hash";
  });
  if (!hasInlineSourceHashIdentity) return;

  sqlite.transaction(() => sqlite.exec(`
    ALTER TABLE ai_sessions RENAME TO ai_sessions_pre_migration;

    CREATE TABLE ai_sessions (
      id TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL, session_path TEXT NOT NULL,
      first_activity INTEGER NOT NULL, last_activity INTEGER NOT NULL, model TEXT, cwd TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
      cached_input_tokens INTEGER NOT NULL DEFAULT 0, reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd REAL NOT NULL DEFAULT 0, turn_count INTEGER NOT NULL DEFAULT 0,
      source_file_hash TEXT NOT NULL
    );

    INSERT INTO ai_sessions
    SELECT id, provider, session_path, first_activity, last_activity, model, cwd,
           input_tokens, output_tokens, cached_input_tokens, reasoning_tokens,
           estimated_cost_usd, turn_count, source_file_hash
    FROM (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY provider, session_path
        ORDER BY (input_tokens + output_tokens) DESC
      ) AS rn
      FROM ai_sessions_pre_migration
    )
    WHERE rn = 1;

    DROP TABLE ai_sessions_pre_migration;

    CREATE UNIQUE INDEX ai_sessions_provider_path_unique ON ai_sessions(provider, session_path);
    CREATE INDEX ai_sessions_provider_index ON ai_sessions(provider);
  `))();
}
