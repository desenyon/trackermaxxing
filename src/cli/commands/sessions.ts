import Table from "cli-table3";

import { getTopSessions } from "@/lib/ai/service";

import { compactNumber } from "../render/format";
import { dim, heading, providerBadge } from "../render/theme";

function shortPath(path: string) {
  const home = process.env.HOME ?? "";
  const shortened = home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
  return shortened.length > 60 ? `…${shortened.slice(-59)}` : shortened;
}

export async function runSessions(options: { provider?: string; limit: number; json: boolean }) {
  const sessions = await getTopSessions(options.provider, options.limit);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
    return;
  }

  if (sessions.length === 0) {
    process.stdout.write(`${dim("No sessions found.")} ${options.provider ? `(provider: ${options.provider})` : ""}\n`);
    return;
  }

  process.stdout.write(`${heading(`Top ${sessions.length} sessions by tokens`)}${options.provider ? dim(` · ${options.provider}`) : ""}\n\n`);

  const table = new Table({
    head: ["", "Tokens", "In", "Out", "Turns", "Last active", "Path"].map((h) => heading(h)),
    style: { head: [], border: [] },
    colAligns: ["left", "right", "right", "right", "right", "left", "left"],
  });
  for (const session of sessions) {
    table.push([
      providerBadge(session.provider as "codex" | "claude" | "cursor"),
      compactNumber(session.inputTokens + session.outputTokens),
      compactNumber(session.inputTokens),
      compactNumber(session.outputTokens),
      String(session.turnCount),
      session.lastActivity.toLocaleDateString(),
      dim(shortPath(session.sessionPath)),
    ]);
  }
  process.stdout.write(`${table.toString()}\n`);
}
