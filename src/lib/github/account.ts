import { createHash } from "node:crypto";

import { ghCliToken, isGhCliAuthenticated } from "@/lib/github/gh-cli";
import { getMeta, setMeta } from "@/lib/settings/meta";
import { readSecret } from "@/lib/settings/secure-store";
import { githubFetch } from "./transport";

export type GithubAccount = { login: string; token: string | null };
const ACTIVE_ACCOUNT = "github.active_login";

export function normalizeGithubLogin(value: string) {
  const login = value.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(login)) throw new Error("Invalid GitHub login.");
  return login;
}

export async function resolveGithubAccount({ offline = false } = {}): Promise<GithubAccount | null> {
  const environmentToken = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  const storedToken = environmentToken ? null : await readSecret("github.metrics_token");
  let token = environmentToken || storedToken || null;
  // An environment token must never inherit the saved token's old login.
  let login = process.env.GITHUB_LOGIN?.trim() || (storedToken ? await readSecret("github.login") : null);
  if (!token && !offline && isGhCliAuthenticated()) token = ghCliToken();
  if (token && !login) {
    const key = `github.token_identity.${createHash("sha256").update(token).digest("hex")}`;
    login = (await getMeta(key))?.value ?? null;
    if (!login && !offline) {
      const user = await githubFetch("/user", token) as { login?: unknown };
      if (typeof user.login !== "string") throw new Error("Unable to resolve GitHub login.");
      login = normalizeGithubLogin(user.login);
      await setMeta(key, login);
    }
    // An unrecognized token in offline mode cannot select another account's cache.
    if (!login) return null;
  }
  if (!login) login = (await getMeta(ACTIVE_ACCOUNT))?.value ?? null;
  return login ? { login: normalizeGithubLogin(login), token: offline ? null : token } : null;
}

export async function rememberGithubAccount(login: string) {
  await setMeta(ACTIVE_ACCOUNT, normalizeGithubLogin(login));
}
