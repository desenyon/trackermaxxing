/** Every request uses the selected credential, including Search. Never mix gh auth. */
export async function githubFetch(path: string, token: string, onHeaders?: (headers: Headers) => void): Promise<unknown> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "TrackerMaxxing",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  // API error bodies can include private repository details. Do not persist them.
  if (!response.ok) throw new Error(`GitHub API ${response.status}${response.status === 403 || response.status === 429 ? " (access denied or rate limited)" : ""}`);
  onHeaders?.(response.headers);
  return response.json();
}
