import { ghCliLogin, ghCliToken, isGhCliAuthenticated, isGhCliInstalled } from "@/lib/github/gh-cli";
import { normalizeGithubLogin } from "@/lib/github/account";
import { githubFetch } from "@/lib/github/transport";
import { writeSecrets } from "@/lib/settings/secure-store";

import { dim, good } from "../render/theme";

export function applyMaskedInput(value: string, char: string): { action: "continue" | "submit" | "cancel"; value: string } {
  if (char === "\u0003") return { action: "cancel", value };
  if (char === "\r" || char === "\n") return { action: "submit", value };
  if (char === "\u007f" || char === "\b") return { action: "continue", value: value.slice(0, -1) };
  return { action: "continue", value: value + char };
}

function promptMasked(question: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    process.stdout.write(question);
    const { stdin } = process;
    const wasRaw = stdin.isTTY ? stdin.isRaw : false;
    let value = "";

    if (!stdin.isTTY) {
      // Not an interactive terminal (piped input) - read a single line plainly.
      let buffered = "";
      const finish = () => {
        stdin.off("data", onData);
        stdin.off("end", finish);
        process.stdout.write("\n");
        resolvePromise(buffered.split("\n")[0].trim());
      };
      const onData = (chunk: Buffer) => {
        buffered += chunk.toString("utf8");
        if (buffered.includes("\n")) finish();
      };
      stdin.on("data", onData);
      stdin.on("end", finish);
      return;
    }

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const cleanup = () => {
      stdin.setRawMode(Boolean(wasRaw));
      stdin.pause();
      stdin.off("data", onData);
      process.stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        const next = applyMaskedInput(value, char);
        value = next.value;
        if (next.action === "submit") {
          cleanup();
          resolvePromise(value.trim());
          return;
        }
        if (next.action === "cancel") {
          cleanup();
          rejectPromise(new Error("GitHub login cancelled."));
          return;
        }
      }
    };
    stdin.on("data", onData);
  });
}

export async function githubLogin(options: { token?: string; login?: string; noGhCli?: boolean }) {
  let token = options.token;
  let login = options.login;
  let source = "provided token";

  if (!token && !options.noGhCli && isGhCliInstalled() && isGhCliAuthenticated()) {
    token = ghCliToken() ?? undefined;
    login = login ?? ghCliLogin() ?? undefined;
    source = "GitHub CLI (gh)";
  }

  if (!token) {
    token = await promptMasked("GitHub token (repo, read:user scopes): ");
    source = "prompt";
  }

  if (!token.trim()) throw new Error("A GitHub token is required.");

  const user = await githubFetch("/user", token.trim()) as { login?: unknown };
  if (typeof user.login !== "string") throw new Error("Unable to resolve GitHub login.");
  login = normalizeGithubLogin(login?.trim() || user.login);
  writeSecrets({ "github.metrics_token": token.trim(), "github.login": login });

  process.stdout.write(`${good("✓")} GitHub credentials saved via ${source}${login ? ` (@${login})` : ""}. ${dim("Run `trackermaxxing sync` to pull commits and PRs.")}\n`);
}
