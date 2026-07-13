import { upsertAiSessions, refreshAiDailyRollups } from "@/lib/ai/service";
import { readLocalClaudeSessions } from "@/lib/claude/parser";
import { readLocalCodexSessions } from "@/lib/codex/parser";
import { readLocalCursorSessions } from "@/lib/cursor/parser";

export async function syncAllLocalAi() {
  const [codex, claude, cursor] = await Promise.all([
    readLocalCodexSessions(),
    readLocalClaudeSessions(),
    readLocalCursorSessions(),
  ]);

  const counts = {
    codex: await upsertAiSessions("codex", codex),
    claude: await upsertAiSessions("claude", claude),
    cursor: await upsertAiSessions("cursor", cursor),
  };
  await refreshAiDailyRollups();
  return { ...counts, discovered: codex.length + claude.length + cursor.length };
}
