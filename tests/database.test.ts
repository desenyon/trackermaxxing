import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "@/lib/db/connection";

const migrationsFolder = resolve(import.meta.dirname, "../drizzle");
const temporaryDirectories: string[] = [];

function temporaryDatabasePath() {
  const directory = mkdtempSync(resolve(tmpdir(), "trackermaxxing-db-"));
  temporaryDirectories.push(directory);
  return resolve(directory, "data.db");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("database migrations", () => {
  it("creates the current schema and remains idempotent", () => {
    const databasePath = temporaryDatabasePath();
    const first = openDatabase(databasePath, migrationsFolder);
    const indexes = first.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'ai_sessions'").pluck().all();
    first.sqlite.close();

    expect(indexes).toContain("ai_sessions_provider_path_unique");
    expect(indexes).not.toContain("ai_sessions_source_hash_unique");
    expect(() => openDatabase(databasePath, migrationsFolder).sqlite.close()).not.toThrow();
  });

  it("adopts the legacy inline source-hash schema without losing rows", () => {
    const databasePath = temporaryDatabasePath();
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE ai_sessions (
        id TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL, session_path TEXT NOT NULL,
        first_activity INTEGER NOT NULL, last_activity INTEGER NOT NULL, model TEXT, cwd TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0, reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL NOT NULL DEFAULT 0, turn_count INTEGER NOT NULL DEFAULT 0,
        source_file_hash TEXT NOT NULL UNIQUE
      );
      INSERT INTO ai_sessions VALUES ('a', 'codex', '/a.jsonl', 1, 2, NULL, NULL, 1, 1, 0, 0, 0, 1, 'same');
    `);
    legacy.close();

    const { sqlite } = openDatabase(databasePath, migrationsFolder);
    expect(sqlite.prepare("SELECT count(*) FROM ai_sessions").pluck().get()).toBe(1);
    expect(() => sqlite.prepare(`
      INSERT INTO ai_sessions VALUES ('b', 'codex', '/b.jsonl', 1, 2, NULL, NULL, 1, 1, 0, 0, 0, 1, 'same')
    `).run()).not.toThrow();
    sqlite.close();
  });

  it("collapses duplicate paths from the original explicit source-hash index", () => {
    const databasePath = temporaryDatabasePath();
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE ai_sessions (
        id TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL, session_path TEXT NOT NULL,
        first_activity INTEGER NOT NULL, last_activity INTEGER NOT NULL, model TEXT, cwd TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0, reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL NOT NULL DEFAULT 0, turn_count INTEGER NOT NULL DEFAULT 0,
        source_file_hash TEXT NOT NULL
      );
      CREATE UNIQUE INDEX ai_sessions_source_hash_unique ON ai_sessions(source_file_hash);
      INSERT INTO ai_sessions VALUES ('old', 'codex', '/same.jsonl', 1, 2, NULL, NULL, 1, 1, 0, 0, 0, 1, 'old-hash');
      INSERT INTO ai_sessions VALUES ('new', 'codex', '/same.jsonl', 1, 3, NULL, NULL, 10, 5, 0, 0, 0, 2, 'new-hash');
    `);
    legacy.close();

    const { sqlite } = openDatabase(databasePath, migrationsFolder);
    expect(sqlite.prepare("SELECT id FROM ai_sessions").pluck().all()).toEqual(["new"]);
    const indexes = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'ai_sessions'").pluck().all();
    expect(indexes).toContain("ai_sessions_provider_path_unique");
    expect(indexes).not.toContain("ai_sessions_source_hash_unique");
    sqlite.close();
  });

  it("adopts a bootstrap-created database through the same migration journal", () => {
    const databasePath = temporaryDatabasePath();
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE ai_sessions (
        id TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL, session_path TEXT NOT NULL,
        first_activity INTEGER NOT NULL, last_activity INTEGER NOT NULL, model TEXT, cwd TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0, reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL NOT NULL DEFAULT 0, turn_count INTEGER NOT NULL DEFAULT 0,
        source_file_hash TEXT NOT NULL
      );
      CREATE UNIQUE INDEX ai_sessions_provider_path_unique ON ai_sessions(provider, session_path);
    `);
    legacy.close();

    const { sqlite } = openDatabase(databasePath, migrationsFolder);
    expect(sqlite.prepare("SELECT count(*) FROM __drizzle_migrations").pluck().get()).toBe(3);
    sqlite.close();
  });
});

it("backfills a pre-ledger cache and keeps its tokens available offline", async () => {
  const { copyFileSync, mkdirSync, readFileSync, writeFileSync } = await import("node:fs");
  const databasePath = temporaryDatabasePath();
  const oldFolder = resolve(databasePath, "../old-migrations");
  mkdirSync(resolve(oldFolder, "meta"), { recursive: true });
  const journal = JSON.parse(readFileSync(resolve(migrationsFolder, "meta/_journal.json"), "utf8"));
  journal.entries = journal.entries.slice(0, 2);
  writeFileSync(resolve(oldFolder, "meta/_journal.json"), JSON.stringify(journal));
  for (const entry of journal.entries) copyFileSync(resolve(migrationsFolder, `${entry.tag}.sql`), resolve(oldFolder, `${entry.tag}.sql`));
  const old = openDatabase(databasePath, oldFolder);
  old.sqlite.prepare("INSERT INTO ai_sessions VALUES ('existing', 'codex', '/existing.jsonl', ?, ?, NULL, NULL, 100, 20, 10, 5, 0.25, 2, 'hash')").run(Date.parse("2026-07-15T23:59:00Z"), Date.parse("2026-07-16T01:00:00Z"));
  old.sqlite.close();
  const current = openDatabase(databasePath, migrationsFolder);
  expect(current.sqlite.prepare("SELECT date, input_tokens, output_tokens FROM ai_session_daily").all()).toEqual([{ date: "2026-07-15", input_tokens: 100, output_tokens: 20 }]);
  expect(current.sqlite.prepare("SELECT input_tokens FROM ai_daily_rollups").pluck().get()).toBe(100);
  current.sqlite.close();
});
