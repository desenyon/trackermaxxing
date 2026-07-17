import { spawnSync } from "node:child_process";

function run(args: string[]) {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}

export function isGhCliInstalled() {
  return run(["--version"]) !== null;
}

export function isGhCliAuthenticated() {
  const result = spawnSync("gh", ["auth", "status"], { encoding: "utf8" });
  return result.status === 0;
}

export function ghCliToken() {
  return run(["auth", "token"]);
}

export function ghCliLogin() {
  return run(["api", "user", "--jq", ".login"]);
}

/** Run an authenticated GitHub REST request via `gh api`. */
export function ghApiSearchCount(apiPath: string): number | null {
  const result = spawnSync("gh", ["api", apiPath, "--jq", ".total_count"], { encoding: "utf8" });
  if (result.status !== 0) return null;
  const parsed = Number(result.stdout.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function ghRepoCreate(args: string[]) {
  const result = spawnSync("gh", ["repo", "create", ...args], { stdio: "inherit" });
  return result.status === 0;
}
