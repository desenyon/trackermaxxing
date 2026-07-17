# TrackerMaxxing

A fast, local-only terminal dashboard for **OpenAI Codex**, **Claude Code**, **Cursor**, and **GitHub** activity.

No server, no browser, no hosting. TrackerMaxxing reads your local AI session files, pulls GitHub metrics through the API (preferring the [GitHub CLI](https://cli.github.com) when you already have `gh auth login`), caches everything in SQLite on your machine, and renders stats + sparklines straight to your terminal.

```
Lifetime 8.7B  ·  Today 10.3M  ·  Cost $18,809.40  ·  Sessions 190

Codex        2.6B  ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁█▄▂▂
Claude       3.2B  ▁▁▁▁▁▇▁▅▁▁▁▁▁▁▂▁█
Cursor         3B  ▂▁▁▂▄▁▃▃▁▂▂▁▂▁█▂▁▂▅▁▅▁▂▃▁

Commits  5.2K · 1.9K last 90d  ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▇▆▂▁▁▁▅█▄▄▂▂▄▅
PRs      149 · 141 last 90d  ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▂▂▂▂▃▃██▃▂▁▄▅
Merged   72 · 69 last 90d  ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁
Reviews  2 · 0 last 90d  ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁
```

## What you get

- **Unified AI usage** across Codex, Claude Code, and Cursor — lifetime tokens, today's usage, estimated cost, session count, per-provider sparklines
- **GitHub engineering activity** — commits, PRs opened, PRs merged, and reviews (not Copilot billing)
- **One-shot reports** or a **live dashboard** that auto-refreshes
- **Exports** to JSON, CSV, or self-contained HTML for sharing
- **Session audit** — drill into the largest sessions behind any total that looks wrong
- **Codex rate limits** — primary/secondary window usage from your ChatGPT plan

Everything stays on your machine. Credentials saved via `trackermaxxing github login` are encrypted at rest.

## Requirements

- **Node.js 20+** and **npm**
- **macOS or Linux** (Cursor's default state DB path is macOS-oriented; override with `CURSOR_STATE_DB` on Linux)
- **GitHub** — optional but recommended: [GitHub CLI](https://cli.github.com) (`gh auth login`) for the most reliable commit counts

## Install

One line — clones, builds, and links `trackermaxxing` / `tmaxing` into `~/.local/bin`:

```bash
curl -fsSL https://raw.githubusercontent.com/desenyon/trackermaxxing/main/install.sh | bash
trackermaxxing setup
```

The installer puts the repo at `~/.trackermaxxing/cli`, adds `~/.local/bin` to your shell PATH when needed, and symlinks both command names to the same binary.

<details>
<summary>Manual install (for development)</summary>

```bash
git clone https://github.com/desenyon/trackermaxxing.git
cd trackermaxxing
npm install
npm run build
npm link   # exposes `trackermaxxing` and `tmaxing` globally
```

</details>

## Quick start

```bash
trackermaxxing setup    # find local sources, connect GitHub, run first sync
trackermaxxing          # sync + print a snapshot report
trackermaxxing dashboard   # live view (see keyboard shortcuts below)
```

`setup` checks Codex / Claude / Cursor install locations, connects GitHub (auto-detecting `gh` when possible), and ingests your first batch of data.

## Commands

### Reports

```bash
trackermaxxing              # default: sync sources, then print report
tmaxing                     # short alias, same binary
trackermaxxing --no-sync    # read from cache only (still refreshes stale GitHub Search totals)
trackermaxxing --json       # machine-readable JSON
trackermaxxing --days 90    # window for sparklines + GitHub totals (default: 30)
```

### Live dashboard

```bash
trackermaxxing dashboard
trackermaxxing dash --days 90
```

| Key | Action |
|---|---|
| `q` / `Esc` | Quit |
| `r` | Force-refresh GitHub + reload display |
| `s` | Full sync (all AI sources + GitHub) |

The dashboard re-reads the local cache every **15 seconds** and pulls fresh GitHub data every **30 seconds** (push events + commit/PR totals via `gh api` when available). You do not need to restart it after pushing a commit — give it up to half a minute, or press `r`.

### Sync

```bash
trackermaxxing sync
```

Re-scans Codex, Claude, and Cursor session files and reconciles GitHub activity into `~/.trackermaxxing/data.db`. Safe to run as often as you like.

### GitHub

```bash
trackermaxxing github login
trackermaxxing github login --no-gh-cli    # skip gh auto-detect, prompt for token
trackermaxxing github create-repo my-app --public --description "hi" --push
```

`github login` prefers an existing **`gh auth login`** session (token + username). Otherwise it prompts for a personal access token with `repo` and `read:user` scopes.

`github create-repo` wraps `gh repo create` — requires the GitHub CLI installed and authenticated.

### Audit and exports

```bash
trackermaxxing sessions                  # top 20 sessions by tokens
trackermaxxing sessions --provider codex --limit 50 --json

trackermaxxing export json --out report.json
trackermaxxing export csv  --out report.csv
trackermaxxing export html --out report.html --days 90
```

HTML export is a self-contained page with bar charts — useful for screenshots or sharing without the CLI.

### Codex plan usage

```bash
trackermaxxing rate-limits
trackermaxxing rate-limits --json
```

Shows primary/secondary rate-limit windows from Codex's ChatGPT usage API (requires Codex auth at `~/.codex/auth.json`).

## Reading the report

**Header** — combined AI stats: lifetime tokens, tokens today, estimated lifetime cost (model heuristics, not a real invoice), total sessions.

**Codex / Claude / Cursor rows** — lifetime token total for that provider, plus a sparkline of daily usage over your `--days` window.

**GitHub rows** — `lifetime · window last Nd` format:

- **Lifetime** — from GitHub Search API (`author:you` queries), accurate for all public history
- **Window** — Search API counts for the last *N* days (`author-date:>=…` for commits)
- **Sparkline** — daily activity from the Events API (~30 days of push/PR events); useful for *when* you were active, not for matching the window total exactly

GitHub commit totals only include **pushed** commits attributed to your GitHub user. Local commits that haven't been pushed won't appear.

## Where the data comes from

| Source | Location | Accuracy |
|---|---|---|
| **Codex** | `$CODEX_HOME/sessions/**/*.jsonl` (default `~/.codex`) | Exact — parsed from Codex session logs (`payload.info.total_token_usage`) |
| **Claude Code** | `$CLAUDE_CONFIG_DIR/projects/**/*.jsonl` (default `~/.claude`) | Exact — parsed from Claude Code JSONL transcripts |
| **Cursor** | `$CURSOR_STATE_DB` or Cursor project transcripts under `$CURSOR_HOME/projects` | **Estimated** — Cursor no longer exposes exact per-call token counts locally. Usage is reconstructed from message + tool-call content, modeling cumulative context per turn. Exact billed usage is only on [cursor.com/dashboard](https://cursor.com/dashboard). |
| **GitHub** | Events API + Search API (via `gh api` when authenticated) | Events for daily sparklines; Search for lifetime/window totals. See limitations below. |

Cache file: **`~/.trackermaxxing/data.db`** (override with `DATABASE_PATH`).

Local AI sync reconciles source snapshots and rebuilds daily rollups from canonical session rows, so deleted or moved sessions cannot leave stale totals behind.

## GitHub details

TrackerMaxxing is built for **your commits and PR activity**, not Copilot usage metrics.

**How counts are fetched**

1. **Events API** — up to ~300 recent events (roughly 30 days). Used for per-day sparklines. Push events often ship empty payload sizes; TrackerMaxxing falls back to counting at least one commit per push so days are not silently zeroed.
2. **Search API** — `author:login` queries for lifetime and `author-date:>=YYYY-MM-DD` for window totals. This is the number shown as `1.9K last 90d`.
3. **`gh api`** — when `gh auth login` is active, Search requests go through the GitHub CLI first (same data, your existing auth).

**Why a new commit might lag**

- Must be **pushed** to GitHub
- **Events API** — usually within ~30s in the live dashboard
- **Search API** (lifetime/window totals) — can lag a few minutes while GitHub indexes the commit; press `r` in the dashboard or run `trackermaxxing sync`

**Not tracked:** Copilot suggestions accepted, private repo activity you can't access with your token, commits authored under a different GitHub identity.

## Architecture

```text
Codex / Claude / Cursor files          GitHub (gh api / REST)
              │                                    │
              └──── parsers + sync adapters ───────┤
                                                   ▼
                                    SQLite + Drizzle migrations
                                                   │
                                     aggregate query services
                                                   │
                        snapshot report / Ink dashboard / JSON · CSV · HTML export
```

Checked-in Drizzle migrations are the single schema authority. The built CLI bundles migrations; no separate database setup step.

## Configuration

All optional — copy `.env.example` if you want overrides:

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_PATH` | `~/.trackermaxxing/data.db` | Local cache |
| `CODEX_HOME` | `~/.codex` | Codex CLI root |
| `CODEX_AUTH_PATH` | `~/.codex/auth.json` | Codex auth (for rate-limits) |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Claude Code config root |
| `CURSOR_HOME` | `~/.cursor` | Cursor projects root |
| `CURSOR_STATE_DB` | macOS default `state.vscdb` path | Cursor SQLite state |
| `GITHUB_TOKEN` / `GITHUB_LOGIN` | — | Alternative to `trackermaxxing github login` |
| `TRACKER_ENCRYPTION_KEY` | auto-generated at `~/.trackermaxxing/key` | Encrypts saved credentials |
| `SYNC_CRON` | `0 2 * * *` | Cron for background worker (UTC) |
| `SYNC_ON_START` | — | Set `true` to sync immediately when worker starts |

## Background sync

Optional daily sync via `node-cron`:

```bash
npm run daemon
# or with env:
SYNC_ON_START=true npm run daemon
```

Runs local AI + GitHub sync on `SYNC_CRON` (default 2:00 AM UTC). Useful if you want the cache warm without opening the dashboard.

## Development

```bash
npm run dev          # tsx src/cli/index.ts — no build step
npm test
npm run test:coverage
npm run typecheck
npm run lint
npm run build
npm run db:seed      # load demo data
npm run db:purge-demo
npm run db:generate  # new Drizzle migration
npm run db:migrate
```

## Troubleshooting

| Symptom | Things to try |
|---|---|
| GitHub shows 0 commits | Run `trackermaxxing github login` or `gh auth login`, then `trackermaxxing sync` |
| New commit not showing | Confirm it's pushed; wait ~30s in dashboard or press `r`; Search totals may take a few minutes |
| Window total much higher than sparkline sum | Expected — sparkline is Events API (~30d); window total is Search API for full `--days` |
| Cursor numbers feel off | Local estimates only; compare with cursor.com/dashboard for billing |
| `dashboard` fails | Needs a TTY; use plain `trackermaxxing` in scripts/CI |
| Rate limits empty | Codex must be logged in; check `~/.codex/auth.json` |

## License

Private project — see repository for terms.
