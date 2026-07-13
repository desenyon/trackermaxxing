import { getCodexUsage } from "@/lib/codex/usage";

import { bar, currency } from "../render/format";
import { bad, dim, good, heading, warn } from "../render/theme";

function pctColor(pct: number | null) {
  if (pct === null) return dim;
  if (pct >= 90) return bad;
  if (pct >= 70) return warn;
  return good;
}

function formatWindow(label: string, pct: number | null, resetAt: Date | null) {
  const lines = [heading(label)];
  if (pct === null) {
    lines.push(dim("  no data"));
    return lines.join("\n");
  }
  const color = pctColor(pct);
  lines.push(`  ${color(bar(pct / 100, 24))} ${color(`${pct.toFixed(1)}%`)}`);
  if (resetAt) lines.push(dim(`  resets ${resetAt.toLocaleString()}`));
  return lines.join("\n");
}

export async function runRateLimits(options: { json: boolean }) {
  const usage = await getCodexUsage();

  if (options.json) {
    process.stdout.write(`${JSON.stringify(usage, null, 2)}\n`);
    return;
  }

  const lines = [heading(`Codex plan · ${usage.planType ?? "unknown"}`), ""];
  lines.push(formatWindow("Primary window", usage.primaryUsedPct, usage.primaryResetAt));
  lines.push("");
  lines.push(formatWindow("Secondary window", usage.secondaryUsedPct, usage.secondaryResetAt));
  lines.push("");
  if (usage.creditsBalance !== null) lines.push(`${dim("Credits balance")}  ${currency(usage.creditsBalance)}`);
  if (usage.streakDays !== null) lines.push(`${dim("Current streak")}  ${usage.streakDays} days`);
  process.stdout.write(`${lines.join("\n")}\n`);
}
