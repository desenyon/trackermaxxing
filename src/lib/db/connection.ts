import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { migrateAiSessionsIdentity } from "./migrate-ai-sessions";
import * as schema from "./schema";

export function locateMigrationsFolder(moduleUrl = import.meta.url) {
  const moduleDirectory = dirname(fileURLToPath(moduleUrl));
  const candidates = [
    process.env.TRACKER_MIGRATIONS_PATH,
    resolve(moduleDirectory, "../../../drizzle"),
    resolve(moduleDirectory, "../drizzle"),
    resolve(process.cwd(), "drizzle"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const folder = candidates.find((candidate) => existsSync(resolve(candidate, "meta/_journal.json")));
  if (!folder) throw new Error("Unable to locate TrackerMaxxing database migrations.");
  return folder;
}

export function openDatabase(databasePath: string, migrationsFolder = locateMigrationsFolder()) {
  mkdirSync(dirname(databasePath), { recursive: true });

  const sqlite = new Database(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  // Pre-Drizzle releases used an inline UNIQUE(source_file_hash) constraint.
  // Rebuild that one legacy shape first, then let checked-in migrations own
  // every fresh and future schema change.
  migrateAiSessionsIdentity(sqlite);

  const database = drizzle(sqlite, { schema });
  migrate(database, { migrationsFolder });
  return { db: database, sqlite };
}
