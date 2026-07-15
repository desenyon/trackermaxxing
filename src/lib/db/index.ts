import { homedir } from "node:os";
import { resolve } from "node:path";

import { openDatabase } from "./connection";

const databasePath = resolve(
  process.env.DATABASE_PATH?.replace(/^~(?=$|\/)/, homedir()) ?? resolve(homedir(), ".trackermaxxing", "data.db"),
);

export const { db, sqlite } = openDatabase(databasePath);
export { databasePath };
