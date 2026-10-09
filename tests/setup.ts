import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, vi } from "vitest";

// Applied before static imports: no test may open the user's real cache/sources.
const root = mkdtempSync(join(tmpdir(), "trackermaxxing-isolated-test-"));
process.env.DATABASE_PATH = join(root, "data.db");
process.env.TRACKER_MIGRATIONS_PATH = resolve(import.meta.dirname, "../drizzle");
process.env.TRACKER_ENCRYPTION_KEY = "synthetic-test-key";
process.env.CODEX_HOME = join(root, "codex");
process.env.CLAUDE_CONFIG_DIR = join(root, "claude");
process.env.CURSOR_HOME = join(root, "cursor");
process.env.CURSOR_STATE_DB = join(root, "cursor.db");
process.env.GH_CONFIG_DIR = join(root, "gh");
delete process.env.GITHUB_TOKEN;
delete process.env.GH_TOKEN;
delete process.env.GITHUB_LOGIN;
vi.stubGlobal("fetch", () => Promise.reject(new Error("Unexpected network request in offline tests")));
afterAll(async () => {
  const { sqlite } = await import("@/lib/db");
  if (sqlite.open) sqlite.close();
  rmSync(root, { recursive: true, force: true });
});
