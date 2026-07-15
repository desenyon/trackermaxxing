import { reconcileAiSessions, refreshAiDailyRollups } from "@/lib/ai/service";
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
    codex: reconcileAiSessions("codex", codex),
    claude: reconcileAiSessions("claude", claude),
    cursor: reconcileAiSessions("cursor", cursor),
  };
  refreshAiDailyRollups();
  return { ...counts, discovered: codex.length + claude.length + cursor.length };
}
