# TrackerMaxxing

A fast terminal dashboard for your **Codex**, **Claude Code**, **Cursor**, and **GitHub** activity. No server, no browser, no hosting — it reads your local session files and renders straight to your terminal.

```
  _____            _           __  __               _
 |_   _| _ __ _ __| |_____ _ _|  \/  |__ ___ ____ _(_)_ _  __ _
   | || '_/ _` / _| / / -_) '_| |\/| / _` \ \ /\ \ / | ' \/ _` |
   |_||_| \__,_\__|_\_\___|_| |_|  |_\__,_/_\_\/_\_\_|_||_\__, |
                                                          |___/

LIFETIME TOKENS    TOKENS TODAY    EST. LIFETIME COST    SESSIONS
6.5B               874.1M          $14,597.42            181

── AI usage ────────────────────────────────────────────────────
┌──────────┬─────────────┬─────────────┬────────────────┐
│          │    Lifetime │    Last 30d │ Last 30d trend │
├──────────┼─────────────┼─────────────┼────────────────┤
│  CODEX   │        1.6B │        1.2B │ ▂▁▁▁▂▂▁█       │
│  CLAUDE  │        2.1B │          2B │ ▁█▁▆▁▁▁▁▁▁▂    │
│  CURSOR  │        2.8B │        881M │ ▂▁▂▁█▂▁▂▅▁▅▁▁  │
└──────────┴─────────────┴─────────────┴────────────────┘
```

## Install

One line, no manual PATH setup:

```bash
curl -fsSL https://raw.githubusercontent.com/desenyon/trackermaxxing/main/install.sh | bash
trackermaxxing setup
```

This clones the repo to `~/.trackermaxxing/cli`, builds it, and symlinks **`trackermaxxing`** and **`tmaxing`** (short alias, same binary) into `~/.local/bin`, adding that to your shell's PATH if it isn't already there. `trackermaxxing setup` walks you through the rest — see below.

<details>
<summary>Manual install (for development)</summary>

```bash
git clone https://github.com/desenyon/trackermaxxing.git
cd trackermaxxing
npm install
npm run build
npm link   # exposes `trackermaxxing` / `tmaxing` globally
```
</details>

## Setup

```bash
trackermaxxing setup
```

Checks which local sources it can find (Codex, Claude Code, Cursor), connects GitHub, and runs the first sync — all in one guided step. GitHub auth is picked up automatically from an existing `gh auth login` session if you have the [GitHub CLI](https://cli.github.com) installed; otherwise it prompts for a personal access token (`repo`, `read:user` scopes).

## Usage

```bash
trackermaxxing              # sync + print a snapshot report
tmaxing                     # same thing, shorter
trackermaxxing --no-sync    # instant report from the local cache, no re-scan
trackermaxxing --json       # machine-readable output
trackermaxxing --days 7     # narrower window (default 30)

trackermaxxing dashboard    # live, auto-refreshing full-screen view (q quit, r refresh, s sync)

trackermaxxing sync         # sync everything without printing a report
trackermaxxing rate-limits  # Codex plan usage (primary/secondary rate-limit windows)

trackermaxxing github login                    # connect GitHub (auto-detects `gh`)
trackermaxxing github create-repo my-project --push   # create + push a repo via `gh`

trackermaxxing export json --out report.json   # or `export csv`
```

## Where the data comes from

| Source | Reads from | Notes |
|---|---|---|
| Codex | `~/.codex/sessions/**/*.jsonl` | Exact token counts, straight from Codex's own session logs |
| Claude Code | `~/.claude/**/*.jsonl` | Exact token counts, straight from Claude Code's own session logs |
| Cursor | `~/Library/Application Support/Cursor/.../state.vscdb` | Cursor stopped exposing exact per-call token counts locally. Usage is reconstructed from message + tool-call content, modeling the same cumulative-context-per-turn behavior Codex/Claude report - only what the model itself generated counts as output (tool *results*, e.g. a file read or command's output, are input on the next turn, not this turn's output), capped at a context-window size calibrated against Cursor's own `contextUsagePercent` field. Exact billed usage is only on cursor.com/dashboard. |
| GitHub | `api.github.com` (Events API) | Commits, PRs opened/merged, reviews, issues — not Copilot. |

Everything is cached in a local SQLite file at `~/.trackermaxxing/data.db`, so repeat runs are instant. `trackermaxxing sync` re-scans your local files and upserts — safe to run as often as you like.

## Config

All optional (see `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_PATH` | `~/.trackermaxxing/data.db` | Local cache location |
| `CODEX_HOME` / `CODEX_AUTH_PATH` | `~/.codex` | Codex CLI paths |
| `CURSOR_HOME` / `CURSOR_STATE_DB` | `~/.cursor`, Cursor's default state db | Cursor paths |
| `GITHUB_TOKEN` / `GITHUB_LOGIN` | — | Instead of `trackermaxxing github login` |
| `TRACKER_ENCRYPTION_KEY` | auto-generated at `~/.trackermaxxing/key` | Encrypts saved credentials at rest |

## Optional background sync

```bash
npm run daemon   # runs sync on a cron schedule (SYNC_CRON, default 2am daily)
```

## Creating GitHub repos from the CLI

`trackermaxxing github create-repo` wraps the [GitHub CLI](https://cli.github.com) (`gh repo create`), so it inherits whatever `gh` auth you already have:

```bash
trackermaxxing github create-repo my-project --public --description "hi" --push
```

`--push` initializes the current directory as the repo's first commit and pushes it. Requires `gh` installed and `gh auth login` run once.

## Dev

```bash
npm run dev          # tsx src/cli/index.ts, no build step
npm run typecheck
npm run lint
npm run db:seed      # demo data
npm run db:purge-demo
```
