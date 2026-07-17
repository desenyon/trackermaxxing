import type { getUnifiedOverview } from "@/lib/ai/service";
import type { getGithubActivityOverview, GithubLifetimeTotals } from "@/lib/github/activity";

type AiOverview = Awaited<ReturnType<typeof getUnifiedOverview>>;
type GithubOverview = Awaited<ReturnType<typeof getGithubActivityOverview>>;

function svgBars(values: number[], color: string, width = 720, height = 120) {
  if (values.length === 0) return "";
  const max = Math.max(...values, 1);
  const barWidth = width / values.length;
  const bars = values.map((value, index) => {
    const h = Math.max(2, (value / max) * (height - 16));
    const x = index * barWidth;
    const y = height - h;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, barWidth - 1).toFixed(1)}" height="${h.toFixed(1)}" fill="${color}" rx="2" />`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img">${bars}</svg>`;
}

function providerSeries(daily: AiOverview["daily"], provider: string) {
  const byDate = new Map<string, number>();
  for (const row of daily) {
    if (row.provider !== provider) continue;
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.inputTokens + row.outputTokens);
  }
  return [...byDate.keys()].sort().map((date) => byDate.get(date) ?? 0);
}

export function renderHtmlReport(
  ai: AiOverview,
  github: GithubOverview,
  options: { days?: number; githubLifetime?: GithubLifetimeTotals | null } = {},
) {
  const days = options.days ?? 30;
  const lifetime = options.githubLifetime;
  const exportedAt = new Date().toISOString();
  const providers = [
    { id: "codex", label: "Codex", color: "#10A37F" },
    { id: "claude", label: "Claude", color: "#D97757" },
    { id: "cursor", label: "Cursor", color: "#B794F6" },
  ] as const;

  const providerCards = providers.map(({ id, label, color }) => {
    const row = ai.byProvider.find((entry) => entry.provider === id);
    const total = row?.totalTokens ?? 0;
    const series = providerSeries(ai.daily, id).slice(-days);
    return `
      <section class="card">
        <header><h2>${label}</h2><p class="stat">${total.toLocaleString()} lifetime tokens</p></header>
        ${svgBars(series, color)}
      </section>`;
  }).join("");

  const githubCommits = github.daily.slice(-days).map((row) => row.commits);
  const githubPrs = github.daily.slice(-days).map((row) => row.prsOpened);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TrackerMaxxing report</title>
  <style>
    :root { color-scheme: dark; --bg: #080b10; --panel: #10141c; --text: #edf2f7; --muted: #8c96a8; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 14px/1.5 Inter, system-ui, sans-serif; background: var(--bg); color: var(--text); padding: 32px; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    .meta { color: var(--muted); margin-bottom: 24px; }
    .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
    .card { background: var(--panel); border: 1px solid rgba(148,163,184,.12); border-radius: 14px; padding: 18px; }
    .card h2 { margin: 0; font-size: 16px; }
    .stat { margin: 6px 0 14px; font-size: 24px; font-weight: 600; }
    .kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 24px; }
    .kpi { background: var(--panel); border: 1px solid rgba(148,163,184,.12); border-radius: 12px; padding: 14px; }
    .kpi span { display: block; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    .kpi strong { display: block; margin-top: 6px; font-size: 22px; }
    @media print { body { background: #fff; color: #111; } .card, .kpi { border-color: #ddd; background: #fff; } }
  </style>
</head>
<body>
  <h1>TrackerMaxxing</h1>
  <p class="meta">Exported ${exportedAt} · window ${days} days</p>
  <div class="kpis">
    <div class="kpi"><span>Lifetime tokens</span><strong>${ai.lifetime.totalTokens.toLocaleString()}</strong></div>
    <div class="kpi"><span>Tokens today</span><strong>${ai.today.tokens.toLocaleString()}</strong></div>
    <div class="kpi"><span>Estimated cost</span><strong>$${ai.lifetime.estimatedCostUsd.toFixed(2)}</strong></div>
    <div class="kpi"><span>Sessions</span><strong>${ai.lifetime.sessions.toLocaleString()}</strong></div>
  </div>
  <div class="grid">${providerCards}</div>
  <div class="grid" style="margin-top:16px">
    <section class="card">
      <header><h2>GitHub commits</h2><p class="stat">${(lifetime?.commits ?? github.totals.commits).toLocaleString()} total</p></header>
      ${svgBars(githubCommits, "#6E40C9")}
    </section>
    <section class="card">
      <header><h2>GitHub PRs opened</h2><p class="stat">${(lifetime?.prsOpened ?? github.totals.prsOpened).toLocaleString()} total</p></header>
      ${svgBars(githubPrs, "#9a78e2")}
    </section>
  </div>
</body>
</html>`;
}
