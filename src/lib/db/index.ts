import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

import { bootstrapSql } from "./bootstrap-sql";
import { migrateAiSessionsIdentity } from "./migrate-ai-sessions";
import * as schema from "./schema";

const databasePath = resolve(
  process.env.DATABASE_PATH?.replace(/^~(?=$|\/)/, homedir()) ?? resolve(homedir(), ".trackermaxxing", "data.db"),
);

mkdirSync(dirname(databasePath), { recursive: true });

const sqlite = new Database(databasePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
migrateAiSessionsIdentity(sqlite);
sqlite.exec(bootstrapSql);

export const db = drizzle(sqlite, { schema });
export { databasePath };
