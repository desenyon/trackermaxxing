import { Command } from "commander";

import { runExport } from "./commands/export";
import { githubCreateRepo } from "./commands/github-create-repo";
import { githubLogin } from "./commands/github-login";
import { runRateLimits } from "./commands/rate-limits";
import { runReport } from "./commands/report";
import { runSessions } from "./commands/sessions";
import { runSetup } from "./commands/setup";
import { runSync } from "./commands/sync";
import { dayCount, positiveInteger } from "./options";
import { renderError } from "./render/snapshot";

const program = new Command();

program
  .name("trackermaxxing")
  .description("A fast terminal dashboard for your Codex, Claude, Cursor, and GitHub activity.")
  .version("0.4.0");

program
  .command("report", { isDefault: true })
  .description("Print a snapshot report (default command)")
  .option("--json", "output raw JSON instead of a formatted report")
  .option("--days <n>", "window size in UTC days (1–36500)", dayCount, 30)
  .option("--offline", "read cached data only; no source scans, GitHub CLI calls, or network requests")
  .option("--no-sync", "skip syncing local files first, read from cache")
  .action(async (options: { json: boolean; days: number; sync: boolean; offline?: boolean }) => {
    await runReport({ json: options.json, days: options.days, sync: options.sync, offline: options.offline });
  });

program
  .command("setup")
  .description("Guided first-run setup: checks local sources, connects GitHub, runs an initial sync")
  .action(async () => {
    await runSetup();
  });

program
  .command("sync")
  .description("Sync Codex, Claude, Cursor, and GitHub activity into the local cache")
  .option("--offline", "sync local AI sources only; skip GitHub")
  .action(async (options: { offline?: boolean }) => {
    const result = await runSync(options);
    if (Object.keys(result.ai.errors).length) process.exitCode = 1;
    const github = "error" in result.github ? `error: ${result.github.error}` : `${result.github.rowsIngested} days for @${result.github.login}`;
    process.stdout.write(
      `Codex ${result.ai.codex} · Claude ${result.ai.claude} · Cursor ${result.ai.cursor} sessions synced.\nGitHub: ${github}\n`,
    );
  });

program
  .command("dashboard")
  .alias("dash")
  .description("Live, auto-refreshing terminal dashboard")
  .option("--days <n>", "window size in UTC days (1–36500)", dayCount, 30)
  .action(async (options: { days: number }) => {
    const { runDashboard } = await import("./dashboard/index");
    await runDashboard({ days: options.days });
  });

const github = program.command("github").description("GitHub account connection and repos");
github
  .command("login")
  .description("Save a GitHub token - auto-detected from `gh auth login` if available, otherwise prompted")
  .option("--token <token>", "token value (otherwise prompted)")
  .option("--login <username>", "GitHub username, resolved automatically if omitted")
  .option("--no-gh-cli", "skip auto-detecting an authenticated GitHub CLI session")
  .action(async (options: { token?: string; login?: string; ghCli: boolean }) => {
    await githubLogin({ token: options.token, login: options.login, noGhCli: !options.ghCli });
  });

github
  .command("create-repo")
  .description("Create a GitHub repo via the GitHub CLI (gh)")
  .argument("<name>", "repo name")
  .option("--public", "create a public repo")
  .option("--private", "create a private repo (default)")
  .option("--description <text>", "repo description")
  .option("--push", "push the current directory as the initial commit")
  .action(async (name: string, options: { public?: boolean; private?: boolean; description?: string; push?: boolean }) => {
    await githubCreateRepo(name, { private: !options.public, description: options.description, push: options.push });
  });

program
  .command("sessions")
  .description("List the sessions behind your token totals, largest first - for auditing a number that looks off")
  .option("--provider <name>", "filter to codex, claude, or cursor")
  .option("--limit <n>", "how many to show", positiveInteger, 20)
  .option("--json", "output raw JSON")
  .action(async (options: { provider?: string; limit: number; json: boolean }) => {
    await runSessions(options);
  });

program
  .command("rate-limits")
  .description("Codex plan usage (primary/secondary rate-limit windows)")
  .option("--json", "output raw JSON")
  .action(async (options: { json: boolean }) => {
    await runRateLimits(options);
  });

program
  .command("export")
  .description("Export usage data as json, csv, or html")
  .argument("<format>", "json, csv, or html")
  .option("--offline", "export cached data without network requests or GitHub CLI calls")
  .option("--out <path>", "write to a file instead of stdout")
  .option("--days <n>", "window size in UTC days (1–36500)", dayCount, 365)
  .action(async (format: string, options: { out?: string; days: number; offline?: boolean }) => {
    if (format !== "json" && format !== "csv" && format !== "html") throw new Error("Format must be json, csv, or html.");
    await runExport(format, options);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`${renderError(error instanceof Error ? error.message : String(error))}\n`);
  process.exitCode = 1;
});
