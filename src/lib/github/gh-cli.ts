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

export function ghRepoCreate(args: string[]) {
  const result = spawnSync("gh", ["repo", "create", ...args], { stdio: "inherit" });
  return result.status === 0;
}
