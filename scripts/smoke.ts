/** Built-artifact integration test: synthetic inputs, isolated cache, no network. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = mkdtempSync(join(tmpdir(), "trackermaxxing-smoke-"));
const project = resolve(import.meta.dirname, "..");
try {
  const packaged = join(root, "package");
  mkdirSync(packaged);
  cpSync(join(project, "dist"), join(packaged, "dist"), { recursive: true });
  writeFileSync(join(packaged, "package.json"), '{"type":"module"}');
  symlinkSync(join(project, "node_modules"), join(packaged, "node_modules"), "dir");
  const marker = join(root, "network-attempt");
  const guard = join(root, "guard.mjs");
  writeFileSync(guard, `import { writeFileSync } from 'node:fs'; globalThis.fetch = () => { writeFileSync(${JSON.stringify(marker)}, 'fetch'); throw new Error('Network forbidden by smoke test'); };`);
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), `#!/bin/sh\nprintf gh > '${marker}'\nexit 1\n`, { mode: 0o755 });
  const env = { ...process.env, DATABASE_PATH: join(root, "cache.db"), CODEX_HOME: join(root, "codex"), CLAUDE_CONFIG_DIR: join(root, "claude"), CURSOR_HOME: join(root, "cursor"), CURSOR_STATE_DB: join(root, "cursor.db"), GITHUB_TOKEN: "", GH_TOKEN: "", GITHUB_LOGIN: "example", GH_CONFIG_DIR: join(root, "gh"), TRACKER_ENCRYPTION_KEY: "synthetic-smoke-key", PATH: `${bin}:${process.env.PATH}`, NODE_OPTIONS: `--import=${guard}` };
  delete (env as NodeJS.ProcessEnv).TRACKER_MIGRATIONS_PATH;
  const run = (...args: string[]) => {
    const result = spawnSync(process.execPath, [join(packaged, "dist/cli.js"), ...args], { cwd: root, env, encoding: "utf8", timeout: 30_000 });
    assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr || result.error}`);
    assert.equal(existsSync(marker), false, "Offline command attempted network or gh execution");
    return result.stdout;
  };
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const previous = new Date(now); previous.setUTCDate(previous.getUTCDate() - 1);
  const yesterday = previous.toISOString().slice(0, 10);
  const source = join(env.CODEX_HOME, "sessions"); mkdirSync(source, { recursive: true });
  mkdirSync(join(env.CLAUDE_CONFIG_DIR, "projects"), { recursive: true });
  mkdirSync(join(env.CURSOR_HOME, "projects"), { recursive: true });
  const fixture = [
    { type: "session_meta", timestamp: `${yesterday}T23:50:00Z`, payload: { id: "synthetic-session" } },
    ...[[`${yesterday}T23:59:00Z`, 100, 20], [`${today}T00:00:00Z`, 160, 30]].map(([timestamp, input_tokens, output_tokens]) => ({ type: "event_msg", timestamp, payload: { type: "token_count", info: { total_token_usage: { input_tokens, output_tokens } } } })),
  ].map((row) => JSON.stringify(row)).join("\n");
  writeFileSync(join(source, "session.jsonl"), fixture);
  run("sync", "--offline");
  let report = JSON.parse(run("report", "--offline", "--json", "--days", "2"));
  assert.equal(report.ai.lifetime.totalTokens, 190);
  assert.equal(report.ai.today.tokens, 70);
  assert.equal(report.ai.daily.length, 2);
  run("sync", "--offline");
  assert.equal(JSON.parse(run("--offline", "--json")).ai.lifetime.totalTokens, 190);
  const exported = join(root, "report.json");
  run("export", "json", "--offline", "--out", exported);
  assert.equal(JSON.parse(readFileSync(exported, "utf8")).ai.lifetime.totalTokens, 190);
  assert.match(run("export", "csv", "--offline"), /codex_tokens,70/);
  assert.match(run("export", "html", "--offline"), /<html/i);
  assert.equal(JSON.parse(run("sessions", "--json")).length, 1);
  rmSync(join(source, "session.jsonl"));
  run("sync", "--offline");
  report = JSON.parse(run("--offline", "--json"));
  assert.equal(report.ai.lifetime.totalTokens, 0);
  assert.equal(report.ai.daily.length, 0);
  for (const script of ["seed", "purge-demo"]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", `scripts/${script}.ts`], { cwd: project, env, encoding: "utf8", timeout: 30_000 });
    assert.equal(result.status, 0, result.stderr);
    const demo = JSON.parse(run("--offline", "--json", "--days", "30"));
    assert.equal(demo.ai.daily.reduce((sum: number, row: { inputTokens: number; outputTokens: number }) => sum + row.inputTokens + row.outputTokens, 0), demo.ai.lifetime.totalTokens);
    if (script === "purge-demo") assert.equal(demo.ai.lifetime.totalTokens, 0);
  }
  console.info("Offline packaged CLI smoke passed: migrations, ingestion, midnight split, repeat sync, exports, audit and deletion.");
} finally { rmSync(root, { recursive: true, force: true }); }
