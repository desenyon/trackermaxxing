import { writeFile } from "node:fs/promises";

import { getUnifiedOverview } from "@/lib/ai/service";
import { getGithubActivityOverview } from "@/lib/github/activity";

import { renderHtmlReport } from "../render/html";
import { good } from "../render/theme";

function csvEscape(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

export async function runExport(format: "json" | "csv" | "html", options: { out?: string; days: number; offline?: boolean }) {
  const [ai, github] = await Promise.all([
    getUnifiedOverview(options.days),
    getGithubActivityOverview(options.days, { offline: options.offline }),
  ]);

  if (github.warning) process.stderr.write(`${github.warning} Using cached GitHub data.\n`);
  const githubLifetime = github.lifetime ?? null;
  let output: string;
  if (format === "html") {
    output = renderHtmlReport(ai, github, { days: options.days, githubLifetime });
  } else if (format === "json") {
    output = JSON.stringify({ exportedAt: new Date().toISOString(), ai, github, githubLifetime }, null, 2);
  } else {
    const rows: Array<Array<string | number>> = [["section", "date", "metric", "value"]];
    for (const row of ai.daily) rows.push(["ai", row.date, `${row.provider}_tokens`, row.inputTokens + row.outputTokens]);
    for (const row of github.daily) {
      rows.push(["github", row.day, "commits", row.commits]);
      rows.push(["github", row.day, "prs_merged", row.prsMerged]);
    }
    output = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  }

  if (options.out) {
    await writeFile(options.out, output, "utf8");
    process.stdout.write(`${good("✓")} Wrote ${options.out}\n`);
  } else {
    process.stdout.write(`${output}\n`);
  }
}
