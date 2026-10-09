# TrackerMaxxing

A terminal dashboard for **Codex**, **Claude Code**, **Cursor**, and **GitHub** activity. It reads local AI logs, stores derived usage in SQLite, and provides a snapshot report, a live Ink dashboard, session audits, and JSON/CSV/HTML exports.

There is no application server or hosted analytics service. GitHub refreshes contact `api.github.com`; `rate-limits` contacts the Codex ChatGPT usage endpoint. Use `--offline` for cache-only reports and exports, or `sync --offline` to ingest local AI sources without contacting GitHub.

## Requirements and installation

- **Node.js 22.12 or newer**; Node 24 LTS is recommended. The installed Commander and Ink versions require Node 22, so the older Node 20 requirement no longer applies.
- npm and Git. macOS and Linux are the intended environments; CI runs on Linux.
- `better-sqlite3` is a native dependency. If a prebuilt binary is unavailable for your platform/Node version, installation needs a working native build toolchain.
- Optional: [GitHub CLI](https://cli.github.com) for existing GitHub authentication and `github create-repo`.

```bash
git clone https://github.com/desenyon/trackermaxxing.git
cd trackermaxxing
npm ci
npm run build
npm link
trackermaxxing setup
```

Both `trackermaxxing` and `tmaxing` run the same CLI. `npm run dev -- --offline` runs the source without building. The package is currently marked `private`; install it from the repository rather than assuming a published npm release exists.

The repository also provides an installer:

```bash
curl -fsSL https://raw.githubusercontent.com/desenyon/trackermaxxing/main/install.sh -o install-trackermaxxing.sh
# Inspect the script before running it.
bash install-trackermaxxing.sh
```

It clones into `~/.trackermaxxing/cli`, installs the lockfile dependencies, builds, and links the commands into `~/.local/bin`. It adds that directory to an existing shell startup file when needed. Re-running it updates the checkout with a fast-forward-only pull. The installer tracks `main`; it does not install an unmerged improvement branch.

## Quick start

```bash
trackermaxxing setup                   # discover sources, connect GitHub, ingest
trackermaxxing                         # sync, then report
trackermaxxing --days 90
trackermaxxing dashboard

trackermaxxing sync --offline          # local AI ingestion only
trackermaxxing --offline               # render the existing cache
trackermaxxing --offline --json        # no source reads, gh calls, or network
```

GitHub is optional. AI reports work without an account. A missing local provider is reported as unavailable and its previous cache is retained. `setup` is interactive; do not use it as an unattended installation check.

## Command reference

| Command | Behavior |
| --- | --- |
| `trackermaxxing [report]` | Sync local sources and GitHub, then display a report. |
| `report --json` | Output the AI overview, GitHub overview, and GitHub lifetime cache as JSON. |
| `report --days N` | Inclusive UTC day window, default **30**. |
| `report --no-sync` | Skip ingestion; stale GitHub Search totals may still refresh. |
| `report --offline` | Skip ingestion and all GitHub access. Read only the local cache. |
| `sync` | Reconcile local AI sources and fetch GitHub activity. |
| `sync --offline` | Reconcile local AI sources, skip GitHub. |
| `dashboard` / `dash` | Interactive dashboard, default **30** days; requires a TTY. |
| `sessions` | Largest **20** sessions by input + output tokens. |
| `sessions --provider codex --limit 50 --json` | Filter and export the underlying cached sessions. |
| `export json\|csv\|html` | Export the cache; may refresh GitHub Search, but does not scan AI files. Default **365** days. |
| `export html --offline --out report.html --days 90` | Write a self-contained HTML report without network access. |
| `github login` | Validate and save a token/login pair; detect `gh` credentials when available. |
| `github login --no-gh-cli` | Skip `gh` detection and prompt for a token. |
| `github create-repo NAME --public --description TEXT --push` | Wrap `gh repo create`. Creates a repository and optionally pushes; requires authenticated `gh`. Defaults to private without `--public`. |
| `rate-limits [--json]` | Fetch Codex primary/secondary plan usage using local Codex authentication. |

`--days` accepts 1–36500. `--limit` accepts positive safe integers. Run `<command> --help` for options. Diagnostic warnings go to stderr so JSON/CSV stdout remains usable. `sync` exits with status 1 if a local provider scan fails; missing roots are skips. GitHub failure is reported without preventing successful local ingestion.

The dashboard reads the cache every 15 seconds and checks GitHub every 30 seconds. Automatic event refreshes respect the server's `X-Poll-Interval`; Search has a two-minute cache. These are polling intervals, **not delivery guarantees**.

| Key | Action |
| --- | --- |
| `q` / `Esc` | Quit |
| `r` | Refresh Search and eligible GitHub events, then reload |
| `s` | Run a complete sync, then reload |

## How to read the numbers

**Lifetime** means the total of the currently cached, discoverable AI session snapshot. It is not an immutable billing archive. Deleting a session from an available source removes it on the next successful scan. **Today** and every `--days` boundary use **UTC**, independent of the machine's timezone and daylight-saving changes.

Input tokens include cached input where the source reports it. Output tokens already include any reported reasoning subset; cached and reasoning fields are not added again to the headline total. Daily session count means sessions active on that day. One overnight session can count on two days while counting once in lifetime sessions.

Sparklines include inactive dates as zero. When a window is wider than the terminal chart, adjacent calendar days are summed into bins spanning the full window. HTML graphs use at most 720 bins. A zero may also mean no observed event history, so GitHub sparklines are not proof of inactivity.

Estimated cost is a fixed heuristic, **not an invoice, current price quote, or subscription charge**:

| Provider | Cost model per million tokens |
| --- | --- |
| Codex model name containing `mini` | Input 0.40, cached input 0.10, output 1.60 USD |
| Other Codex models | Input 2.50, cached input 0.625, output 10.00 USD |
| Claude | Combined input 3.00, output 15.00 USD |
| Cursor database bubbles | Input 2.50, output 10.00 USD |
| Cursor transcript fallback | No cost estimate; stored as zero |

These constants are in the parsers. There is no pricing settings screen or environment override. Different models, caching rules, compaction, source omissions, and subscription plans can make the estimate differ substantially from billed usage.

## AI sources and daily attribution

| Provider | Source | Attribution and limitations |
| --- | --- | --- |
| Codex | `$CODEX_HOME/sessions/**/*.jsonl` | Differences between cumulative token snapshots belong to each event's UTC date. Repeated cumulative snapshots contribute zero. Last-only usage records are summed; a decrease in cumulative input/output starts a new counter segment. |
| Claude Code | `$CLAUDE_CONFIG_DIR/projects/**/*.jsonl` | Assistant usage belongs to its timestamp's UTC day. For repeated message IDs within a file, the last record carrying usage wins. Across files, message IDs are credited once, in modification-time order with path as the tie-breaker. |
| Cursor database | `$CURSOR_STATE_DB`, `cursorDiskKV` bubbles | Positive exact token fields are used when present. Otherwise, assistant input/output is estimated from accumulated message/tool content. Each bubble uses its own UTC timestamp. Invalid/missing timestamps are skipped. |
| Cursor transcripts | `$CURSOR_HOME/projects/**/agent-transcripts/**/*.jsonl` | Used when no token-bearing database conversations are found. Content-length estimates use record timestamps when present and file birth time otherwise. This fallback does not reconstruct repeated context. |

Codex events without a timestamp use the latest observed activity timestamp; entirely undated files are ignored. A first cumulative snapshot includes all usage reported so far, assigned to that snapshot's day. A gap in logs cannot be divided accurately across the missing days. Counter resets are an explicit heuristic, not proof of an additional billed segment. Codex `turnCount` counts `response_item` records, not necessarily human prompts.

Claude input includes normal input, cache creation, and cache reads. Its across-file ownership is deterministic for an unchanged scan, but changing file modification times can move ownership between sessions. Per-day totals use message timestamps rather than file creation time.

Cursor's fallback uses approximately four characters per token, a 150,000-token context ceiling, and a 30% compaction assumption. These are heuristics, not measured model limits or benchmark claims. Tool results contribute future input context, not generated output. The database and transcript sources are alternatives, not merged histories; switching the available source can change totals. Consult Cursor's billing dashboard for actual charges.

## Ingestion and persistence architecture

```text
Codex / Claude / Cursor sources
          |
  complete, bounded file scan
          |
  provider-neutral AiSession + dailyUsage[]
          |
  one SQLite transaction per successful provider
          +-- ai_sessions          lifetime totals + source identity
          +-- ai_session_daily     per-session UTC ledger
          +-- ai_daily_rollups     rebuildable date/provider projection
          |
  report / dashboard / session audit / JSON, CSV, HTML

GitHub credentials -> selected account -> Events and Search REST requests
                                             |
                           account-scoped daily rows, caches and refresh times
                                             |
                                     report and exports
```

- `src/lib/ai/session.ts` defines the provider-neutral usage contract. `CodexSession` remains a compatibility type alias.
- `src/lib/ingestion/files.ts` traverses directories in deterministic order and validates source JSONL. A damaged interior record aborts that provider's scan. An unfinished final append after valid JSON is tolerated.
- `src/lib/ai/service.ts` validates daily sums, upserts sessions by `(provider, sessionPath)`, replaces their daily ledger, prunes disappeared paths, and rebuilds rollups transactionally. Overview reads use one SQLite transaction, so a concurrent sync cannot mix old daily rows with new lifetime totals. Stored IDs are a provider prefix plus a SHA-256 path digest, stable while a file grows. Content hashes are provenance, not identity.
- An unavailable root or a read/parse/reconciliation failure **does not publish an empty snapshot**. That provider's previous data remains; other providers can still succeed. A readable empty source is a successful empty snapshot and removes that provider's old rows.
- Overlapping local syncs coalesce within a process. Separate CLI processes rely on SQLite transactions/WAL; scans are still complete snapshots, not incremental ingestion.
- `src/lib/time.ts` supplies shared inclusive UTC windows. Queries exclude future dates from daily windows.
- `src/lib/github/account.ts` selects credentials and identity. `transport.ts` applies one selected bearer token to every REST call, a 15-second timeout, and sanitized HTTP errors.
- `src/lib/github/activity.ts` scopes all daily queries and caches by normalized login. Window caches also record the number of days and exact UTC bounds.
- Drizzle SQL migrations are the schema authority. Startup applies them automatically. Builds copy migrations into `dist/drizzle`, so a packaged CLI can create or upgrade its database from any working directory.

The cache stores derived numbers, paths, working directories, model names, hashes, and encrypted saved credentials. It does not store raw transcript text. Parsers currently read each file fully into memory and scan the full source tree. There is no incremental offset index or cross-process scan lock.

## GitHub accounts, totals and refreshes

Token selection is explicit and consistent:

1. `GITHUB_TOKEN`, or `GH_TOKEN` when the former is unset/empty.
2. The token saved by `github login`.
3. The active GitHub CLI token, if online and authenticated.

`GITHUB_LOGIN` explicitly selects the tracked login. Otherwise, a saved token uses its saved login; a new environment/CLI token resolves `/user` and caches that token's identity under a SHA-256 token fingerprint. An environment token never inherits the saved token's previous login. Tokens are sent only in the Authorization header, not query strings.

`github login` validates `/user` before replacing both encrypted settings in one transaction. An explicit `--login` may select a different public account to track. Prefer the prompt over `--token` on shared systems because command arguments can be visible in shell history/process listings.

```bash
# Select an account for this invocation (token supplied by your environment).
GITHUB_LOGIN=example trackermaxxing sync

# Select a specific cached account offline, without gh authentication calls.
GITHUB_LOGIN=example trackermaxxing --offline --json
```

Without an explicit account or token, offline reads use the last selected account. An unknown environment token without a login has no usable offline identity and returns an empty GitHub overview instead of another account's data. Cached accounts remain separate; switching accounts does not delete earlier caches. GitHub Enterprise hosts are not configurable.

**Events:** up to three pages of 100 events are fetched before any daily rows are changed. Duplicate event IDs across pages are counted once. Successful complete windows replace existing rows, including clearing days that now have no events. At the 300-event cap, the oldest returned day may be partial; the cache retains its previous per-metric lower bounds and does not delete older history. A failed page or malformed response leaves the prior snapshot intact. Automatic refreshes honor `X-Poll-Interval`; manual `sync` requests a fresh scan.

GitHub limits the timeline to 300 events from the past 30 days, and documents event latency from 30 seconds to six hours. Private events require the appropriate authenticated identity and access. These limits apply even when `--days` is longer. See [GitHub's Events documentation](https://docs.github.com/en/rest/activity/events).

**Search:** lifetime and requested-window counts use these qualifiers:

| Metric | Lifetime | Additional window qualifier |
| --- | --- | --- |
| Commits | `author:LOGIN` | `author-date:START..END` |
| PRs opened | `author:LOGIN type:pr` | `created:START..END` |
| PRs merged | `author:LOGIN type:pr is:merged` | `merged:START..END` |
| Reviews | `reviewed-by:LOGIN type:pr` | `created:START..END` |
| Issues opened | `author:LOGIN type:issue` | `created:START..END` |

The **Reviews Search count is the number of reviewed PRs**, and its window is based on PR creation date, not review submission date. The Events sparkline counts newly created review events. Neither metric is a count of all individual reviews over arbitrary history.

Search is subject to permissions, indexing delay, and rate limits. Incomplete/invalid Search responses are rejected. Cached values from the same account and same date bounds are used on refresh failure; otherwise totals fall back to the available event rows. Search counts take precedence when available: the app does not take the maximum of Search and Events because commit authorship and pushed commits are different measurements. For a push with no usable count/commit array, the event estimate is one commit per push.

JSON includes `github.login`, `totalsSource` (`search` or `events`), `searchStale`, and an optional `warning`. Lifetime Search caches carry `syncedAt`. Window entries expire after two minutes or a UTC day-boundary change. Old event rows can remain cached beyond the API's retrieval window; they are not a complete historical archive.

## Configuration

Variables must be exported by your shell/process. **The CLI does not automatically load `.env`.** `.env.example` is a reference; Node can load a file explicitly:

```bash
node --env-file=.env dist/cli.js --offline
# Or set individual variables:
DATABASE_PATH=/tmp/trackermaxxing-demo.db trackermaxxing sync --offline
```

| Variable | Default / purpose |
| --- | --- |
| `DATABASE_PATH` | `~/.trackermaxxing/data.db`; SQLite cache, with sibling `-wal` and `-shm` files while open. |
| `CODEX_HOME` | `~/.codex`; reads the `sessions` subtree. |
| `CODEX_AUTH_PATH` | `~/.codex/auth.json`; used only for Codex plan usage. |
| `CLAUDE_CONFIG_DIR` | `~/.claude`; reads the `projects` subtree. |
| `CURSOR_HOME` | `~/.cursor`; reads project transcript files. |
| `CURSOR_STATE_DB` | `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`; override on Linux or other Cursor installations. |
| `GITHUB_TOKEN` / `GH_TOKEN` | Environment credential override. |
| `GITHUB_LOGIN` | Explicit tracked account, including offline cache selection. |
| `TRACKER_ENCRYPTION_KEY` | Optional local encryption material; otherwise a random key is stored at `~/.trackermaxxing/key`. |
| `TRACKER_MIGRATIONS_PATH` | Developer override for the migration folder containing `meta/_journal.json`. Normally unnecessary. |
| `SYNC_CRON` | Worker schedule; default `0 2 * * *`, interpreted in UTC. |
| `SYNC_ON_START` | `true` to run the worker immediately on startup. |

Use absolute paths for reproducible automation. Local source/cache paths support a leading `~`; do not assume every third-party configuration parser expands it.

Saved credentials use AES-256-GCM with a key derived from the configured/generated encryption material. The local generated key file has mode `0600`. This protects stored ciphertext, not a compromised account or machine: anyone who can read both the cache and key can decrypt it. Changing or losing the key makes existing saved credentials unreadable. `DATABASE_PATH` does not relocate the default key file.

Exports and session audits can contain local paths, working directories and account names. Review them before sharing. AI source content is read locally; GitHub queries transmit the selected login and date qualifiers, and Codex plan-usage requests use Codex authentication.

## Upgrade and migration

1. Stop running dashboards/workers before upgrading. Back up the SQLite database with a SQLite-aware backup, or copy it and its WAL only while no process is writing; keep encryption material if saved credentials must remain usable.
2. Update the checkout, run `npm ci` and `npm run build` using Node 22.12+.
3. The next CLI invocation applies pending migrations automatically. Run `trackermaxxing sync --offline` to reconstruct AI day attribution, then `trackermaxxing sync` for GitHub.

Migration `0002_session_daily_ledger.sql` creates and backfills the per-session ledger. Legacy rows have no event-level dates, so their entire usage remains on the first activity day until a successful source rescan replaces it. Rollups are rebuilt from that ledger immediately, preserving available offline totals. Missing original source files cannot be used to recover exact historical daily attribution.

The earlier content-hash identity repair remains supported, including legacy inline/explicit unique indexes. Stored session IDs become stable provider/path digests on rescan; consumers must treat IDs as opaque. Copied files at different paths count as separate Codex sessions; Claude message-ID deduplication applies separately.

Legacy GitHub Search caches were global and could not safely identify every window's account. They are ignored and fetched into new account-scoped keys on the next online refresh. Existing daily event rows stay in SQLite and are filtered by login; mixed-case aliases for the same account/day use per-metric maxima instead of being added twice; use `GITHUB_LOGIN` for an offline selection before the first new refresh. This can temporarily remove GitHub lifetime/window Search numbers from offline output. The migration is additive; there is no automatic downgrade migration.

## Background sync

```bash
npm run daemon
SYNC_ON_START=true SYNC_CRON='0 */6 * * *' npm run daemon
```

The worker stays in the foreground, uses UTC, and prevents overlapping scheduled callbacks. It reports skipped/failed providers and retains their cache. It is not installed as a system service and does not run when the process is closed. Configure your own process manager if you need it to persist.

## Development and verification

```bash
npm ci
npm run check          # typecheck + lint + tests + build + offline packaged smoke
npm run test:coverage
npm run dev -- --offline
```

| Command | Coverage |
| --- | --- |
| `npm test` | Parser contracts, UTC boundaries, transactional reconciliation/rollback, migration adoption/backfill, account isolation, Search freshness/failure, event pagination and rendering. |
| `npm run typecheck` | Strict TypeScript across source, tests and scripts. |
| `npm run lint` | ESLint / typescript-eslint. |
| `npm run build` | ESM CLI/dashboard chunks plus bundled migrations and executable entry point. |
| `npm run test:smoke` | Runs the built distribution from an unrelated temporary directory using synthetic sources and a temporary database; rejects network/gh calls, verifies overnight ingestion, repeat sync, exports, session audit, deletion and demo cleanup. Requires a build first. |
| `npm run test:coverage` | V8 coverage report; coverage is evidence, not a claim that all real provider formats have been tested. |
| `npm run db:generate -- --name=change_name` | Generate a checked-in migration after a schema change. Review SQL and add upgrade tests. |
| `npm run db:migrate` | Apply migrations directly using Drizzle tooling; normal CLI startup already migrates automatically. |

Tests isolate cache paths, local source paths, encryption material and GitHub CLI configuration **before importing database modules**. Fetch is disabled unless a test supplies a synthetic API response. No test requires paid services, real transcripts or personal credentials. Vitest uses two workers to keep local resource usage modest. CI validates Node 22 and Node 24 and runs the same built-artifact smoke check.

For demo data, use a disposable database. Seeding modifies the selected cache; it does not download any data:

```bash
DATABASE_PATH=/tmp/trackermaxxing-demo.db npm run db:seed
DATABASE_PATH=/tmp/trackermaxxing-demo.db GITHUB_LOGIN=demo-user npm run dev -- --offline
DATABASE_PATH=/tmp/trackermaxxing-demo.db npm run db:purge-demo
```

Demo sessions and their daily ledger are consistent, and purging them rebuilds the rollups. A regular successful local scan replaces the provider snapshot, including any demo sessions for that provider.

## Troubleshooting and known limits

| Symptom | Explanation / next step |
| --- | --- |
| Native module fails to load | Re-run `npm ci` using the same supported Node runtime used to run the CLI. Install native build tools if no binary is available. |
| Missing migrations | Rebuild; `dist/drizzle/meta/_journal.json` and SQL files must travel with the CLI. Check `TRACKER_MIGRATIONS_PATH` if set. |
| Source unavailable, old totals remain | Restore/correct the configured source root and sync again. An absent root is deliberately not treated as deletion. |
| Corrupt JSONL / permission error | Fix source access/content; the provider cache is retained. An active file's unfinished final append is tolerated. |
| Yesterday's session contributes to today | Expected when timestamped usage crosses midnight UTC. |
| Wrong GitHub account | Inspect `GITHUB_TOKEN`, `GH_TOKEN` and `GITHUB_LOGIN`; environment values override saved credentials. Re-run `github login` or explicitly select a cached login offline. |
| `--no-sync` still connects | Use `--offline` to prohibit network and GitHub CLI access. |
| GitHub Search unavailable | Cached same-account Search totals or event totals are used. Inspect JSON provenance and stderr; retry after the rate limit/index delay. |
| New commit absent | It must be pushed and attributed to the selected login. Events and Search may lag; polling faster does not guarantee fresh upstream data. |
| Window totals differ from the sparkline | Expected: Search and Events have different semantics and history limits. |
| Cursor cost/usage differs from billing | Local heuristics are incomplete. Compare with Cursor's billing dashboard. |
| Dashboard fails under a pipe | It needs an interactive TTY; use a snapshot report or export. |
| Saved credentials cannot decrypt | Restore the original encryption key or use an environment token; the app cannot recover a lost key. |
| Codex rate limits unavailable | Check Codex authentication and `CODEX_AUTH_PATH`; this command always requires online access. |

Only local files in the configured trees are discovered. Symlinked directories are not traversed. Archived/moved/deleted logs outside those trees are not an authoritative lifetime record. Full-file scans, first-snapshot attribution, source-specific turn definitions, API truncation and heuristics constrain accuracy. No performance benchmark or exact billing claim is made.

## License

This repository does not currently include a license file. No additional distribution rights are implied by this README.
