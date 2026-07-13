import { ghCliLogin, ghCliToken, isGhCliAuthenticated, isGhCliInstalled } from "@/lib/github/gh-cli";
import { writeSecret } from "@/lib/settings/secure-store";

import { dim, good } from "../render/theme";

function promptMasked(question: string): Promise<string> {
  return new Promise((resolvePromise) => {
    process.stdout.write(question);
    const { stdin } = process;
    const wasRaw = stdin.isTTY ? stdin.isRaw : false;
    let value = "";

    if (!stdin.isTTY) {
      // Not an interactive terminal (piped input) - read a single line plainly.
      let buffered = "";
      const onData = (chunk: Buffer) => {
        buffered += chunk.toString("utf8");
        if (buffered.includes("\n")) {
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolvePromise(buffered.split("\n")[0].trim());
        }
      };
      stdin.on("data", onData);
      return;
    }

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          stdin.setRawMode(Boolean(wasRaw));
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolvePromise(value.trim());
          return;
        }
        if (char === "") process.exit(130); // Ctrl+C
        if (char === "" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
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

  await writeSecret("github.metrics_token", token.trim());
  if (login?.trim()) await writeSecret("github.login", login.trim());

  process.stdout.write(`${good("✓")} GitHub credentials saved via ${source}${login ? ` (@${login})` : ""}. ${dim("Run `trackermaxxing sync` to pull commits and PRs.")}\n`);
}
