import { reconcileAiSessions } from "@/lib/ai/service";
import { readLocalClaudeSessions } from "@/lib/claude/parser";
import { readLocalCodexSessions } from "@/lib/codex/parser";
import { readLocalCursorSessions } from "@/lib/cursor/parser";
import { SourceUnavailableError } from "@/lib/ingestion/files";

let inFlight: Promise<Awaited<ReturnType<typeof sync>>> | undefined;

async function sync() {
  const counts = { codex: 0, claude: 0, cursor: 0 };
  const skipped: string[] = [];
  const errors: Record<string, string> = {};
  const readers = { codex: readLocalCodexSessions, claude: readLocalClaudeSessions, cursor: readLocalCursorSessions };
  for (const provider of ["codex", "claude", "cursor"] as const) {
    try {
      const sessions = await readers[provider]();
      counts[provider] = reconcileAiSessions(provider, sessions);
    } catch (error) {
      if (error instanceof SourceUnavailableError) skipped.push(provider);
      else errors[provider] = error instanceof Error ? error.message : String(error);
    }
  }
  return { ...counts, discovered: counts.codex + counts.claude + counts.cursor, skipped, errors };
}

/** Coalesce overlapping dashboard/worker requests within this process. */
export function syncAllLocalAi() {
  inFlight ??= sync().finally(() => { inFlight = undefined; });
  return inFlight;
}
