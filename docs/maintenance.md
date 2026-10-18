# Logs, storage and repository cleanup

[Documentation](README.md) · [Setup](setup.md) · [Storage contracts](architecture.md#storage-and-retention)

## Find the right output

| Output | Where it lives | How to maintain it |
| --- | --- | --- |
| Recorded sessions, history, XP and usage | `~/.hermes/pixel-office`, or `$HERMES_HOME/pixel-office` | Use the office's history and retention controls; this is user data |
| Observer diagnostics | The launching terminal, Hermes or another host service | Capture the relevant error; configure log rotation in that launcher or service |
| Browser-demo preferences and saved briefs | This browser's storage for the demo origin | Export any briefs you need before clearing site data |
| Developer logs, screenshots and test reports | Ignored `reports/`, `playwright-report/` or `test-results/` | Retain useful evidence outside Git, then remove generated output you no longer need |
| Public builds | Ignored `dist/` or `site-dist/` | Rebuild with the commands in [Contributing](../CONTRIBUTING.md#checks) |
| Published documentation screenshots | Tracked `docs/screenshots/` and `site/screenshots/` | These are maintained source assets; keep their references and provenance intact |

The hosted demo contains synthetic activity. Its storage is separate from your
local observer data and does not contain your installed runtimes' sessions.

## Inspect or reduce office storage

From the checkout, inspect the selected office directory:

```sh
python3 tools/maintain.py
```

Use `--directory /absolute/path/to/pixel-office` to inspect a specific office.
The report shows database and sidecar sizes, page counts and reusable free pages.
The office's storage panel separately reports retained history, pending inbox
work and legacy files. Failed measurements remain unknown; they are not zero.

In **Customize → Jump to → History & storage**, change retention or clear saved
history. Clearing history preserves XP and usage accounting. Resetting progress
also clears that accounting, so it is a different operation.

Raw history defaults to 1,000 events, seven days and 5 MiB of event JSON. This is
not a whole-directory quota: unresolved input, usage accounting, offline inbox
work and legacy files have separate lifetimes. Unreadable retention settings
suspend pruning until repaired.

Physical SQLite compaction is a separate explicit operation. Stop office servers
and follow [the compaction procedure](architecture.md#explicit-sqlite-maintenance)
when retained rows should stay intact but unused database space needs reclaiming.
It does not delete external logs or impose a directory-size limit.

## Handle diagnostic logs

Agent Office does not create or rotate a repository-wide service log. Diagnostics
go to Python logging/stderr and are retained by the process that launched it.
Changing history retention does not rotate those logs.

Repeated publication failures are summarized at most once per minute per process.
Each event still gets a publication attempt. Summaries include the error type and
suppressed count, without event bodies or raw exception messages. See the
[logging contract](architecture.md#diagnostic-logs-and-safe-cleanup) for concurrency
and failure handling.

For a bug report, include the commit, OS, Python/runtime versions and reproduction
steps. Review captured output and screenshots for credentials, prompts, command
previews and project paths before sharing them through the
[bug form](https://github.com/NosytLabs/agent-office/issues/new/choose).

## Keep development output out of Git

The ignore rules exclude logs and rotated logs, generated reports, builds,
dependency/cache folders, local credentials and office data. Before deleting
generated output, stop any test or build writing it and preserve evidence you
still need. Remove only the known output folders you selected.

Avoid blanket ignored-file deletion such as `git clean -fdX`: ignored files can
also be credentials or user data. SQLite files and sidecars, pending inbox files,
legacy event logs, settings and optional licensed artwork are not disposable
development caches.

Before committing, stage intended source changes and check the tracked files:

```sh
python3 tools/check_repository.py
git diff --cached --check
```

The checker validates local Markdown links and anchors and rejects tracked logs,
local state and conflict markers. It does not delete anything, inspect external
office data, scan arbitrary text for secrets or validate remote websites.
