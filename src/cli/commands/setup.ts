import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { hasSecret } from "@/lib/settings/secure-store";
import { isGhCliAuthenticated, isGhCliInstalled } from "@/lib/github/gh-cli";

import { bad, dim, good, heading, warn } from "../render/theme";
import { githubLogin } from "./github-login";
import { runSync } from "./sync";

function checkLocalSource(label: string, envVar: string, fallback: string, marker: string) {
  const root = resolve((process.env[envVar] ?? fallback).replace(/^~(?=$|\/)/, homedir()), marker);
  const found = existsSync(root);
  process.stdout.write(`  ${found ? good("✓") : warn("·")} ${label} ${dim(found ? root : `not found at ${root}`)}\n`);
  return found;
}

export async function runSetup() {
  process.stdout.write(`${heading("TrackerMaxxing setup")}\n\n`);

  process.stdout.write("Local AI sources:\n");
  checkLocalSource("Codex", "CODEX_HOME", "~/.codex", "sessions");
  checkLocalSource("Claude Code", "CLAUDE_CONFIG_DIR", "~/.claude", "projects");
  checkLocalSource("Cursor", "CURSOR_HOME", "~/.cursor", "projects");
  process.stdout.write("\n");

  process.stdout.write("GitHub connection:\n");
  const hasToken = Boolean(process.env.GITHUB_TOKEN || process.env.GH_TOKEN) || (await hasSecret("github.metrics_token"));
  if (hasToken) {
    process.stdout.write(`  ${good("✓")} Already configured\n\n`);
  } else if (isGhCliInstalled() && isGhCliAuthenticated()) {
    process.stdout.write(`  ${good("✓")} Found an authenticated GitHub CLI (gh) session\n`);
    await githubLogin({});
    process.stdout.write("\n");
  } else {
    process.stdout.write(`  ${warn("·")} No GitHub CLI session found (${dim("gh auth login")} sets one up)\n`);
    try {
      await githubLogin({});
    } catch (error) {
      process.stdout.write(`  ${bad("✗")} ${error instanceof Error ? error.message : "Skipped."} You can run \`trackermaxxing github login\` later.\n`);
    }
    process.stdout.write("\n");
  }

  process.stdout.write("Running initial sync…\n");
  const result = await runSync();
  process.stdout.write(`  ${good("✓")} Codex ${result.ai.codex} · Claude ${result.ai.claude} · Cursor ${result.ai.cursor} sessions\n`);
  if ("error" in result.github) {
    process.stdout.write(`  ${warn("·")} GitHub: ${result.github.error}\n`);
  } else {
    process.stdout.write(`  ${good("✓")} GitHub: ${result.github.rowsIngested} days for @${result.github.login}\n`);
  }

  process.stdout.write(`\n${good("You're all set.")} Run ${heading("trackermaxxing")} for a report or ${heading("trackermaxxing dashboard")} for the live view.\n`);
}
