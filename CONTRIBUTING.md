# Contributing

Agent Office observes existing runtimes. Its optional local task runner is a
separate, explicitly enabled path. Observer hooks must never dispatch prompts,
execute work, approve requests, or alter the runtime they observe.

## Development setup

Use Python 3.10+ and Node.js 22. npm is for development only; the local server and
production frontend do not require it.

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-dev.txt
npm ci --ignore-scripts
```

Run `python3 run.py` for an empty office on port 8113. For interface development,
use `python3 demo_feed.py` on port 8114: it creates isolated temporary data even
when `HERMES_HOME` points to a real workspace. Never add synthetic events to a
user's history.

## Checks

From the repository root, stage intended new source files, then run:

```sh
python3 tools/check_repository.py
python -m pytest -q
npm test
npm run check
npm run format:check
```

The repository checker is read-only and requires Git. It checks tracked local
Markdown links/anchors, merge markers, logs, caches, and local-data filenames.
It does not scan secrets inside arbitrary text or validate external websites.
Keep sanitized event fixtures explicitly named under `tests/fixtures/` rather
than committing live logs. `.env.example` and `.env.sample` may contain placeholders,
never credentials.

Install Chromium once, including Linux system libraries when necessary:

```sh
npx playwright install chromium
# Linux only, when required:
npx playwright install-deps chromium
npm run check:sprites
npm run test:browser
npm run build:preview
```

An existing browser works with `CHROMIUM_PATH=/absolute/path/to/chrome`.
Browser tests use temporary data and local HTTP routes, without provider calls.
`OFFICE_SCREENSHOTS=reports/screenshots npm run test:browser` saves visual
evidence. `npm run format` applies Prettier; inspect the diff afterward.
Use [build:sprites](docs/asset-pipeline.md) after an intentional source-art change;
do not regenerate original sheets to hide a failed pixel-equivalence check.

The [repository-hygiene workflow](.github/workflows/hygiene.yml) checks every
pull request and push to `main`, including asset deletions that can break unchanged
Markdown links. It installs no development dependencies. The full
[CI workflow](.github/workflows/ci.yml) runs on the same events, with Python and
Node checks, formatting, sprite pixel verification, public builds, and all browser
flows. It allows 20 minutes and keeps browser artifacts for three days on failed
or manual runs. Builds create `dist/` (demo and product site) or `site-dist/`
(`npm run build:site`); they do not deploy anything.

Optional checks require explicit local tools:

```sh
GEMINI_TEST_CLI=/absolute/path/to/gemini python -m pytest tests/test_gemini_native.py
SCENE_CANVAS_MODULE=/absolute/path/to/skia-canvas node tests/render-scene.cjs
```

The native Gemini fixture targets CLI 0.63.0, creates its own trusted temporary
workspace/configuration, uses a synthetic loopback provider, and rejects external
connections. It does not verify a paid provider or alter existing workspace trust.
The scene renderer writes `reports/scene-render`; it does not replace interactive
browser checks. Report unavailable native environments as unverified.

## Change boundaries

### Runtime adapters

Use documented runtime payloads and preserve session, tool-call, request, and
child-session identities. Hooks publish through the immutable inbox, never append
to/truncate legacy `events.jsonl`, and remain fail-open with no controlling output.
Codex hook trust is a user action. Keep private paths, commands, prompts, and tokens
out of fixtures. [Runtime contracts](docs/runtime-observers.md) describe each
adapter; installed-runtime claims require a real run with the named version.

Hook diagnostics must remain bounded and separate from stored events. Do not
log event bodies or raw exception text from publication failures. A broken log
handler must not escape into a runtime hook. Diagnostic suppression must never
suppress an event publication attempt.

### Local task runner

Keep it disabled by default and limited to startup-allowlisted project IDs,
supported runtimes/modes, and explicit Run actions. Pass literal prompts on stdin
with `shell=False`; never accept arbitrary executables/arguments/paths from HTTP
or add approval bypasses. Preserve same-origin/revision checks, bounded output and
history, admission limits, idempotency, cancellation, and uncertain-delivery states.
Exit zero means a process finished, not that work passed review. Test using
throwaway executable fixtures, not developer accounts. See
[local runner boundaries](docs/local-task-runner.md).

### Persistence and accounting

`event_store.py` owns the writer transaction: live state, progress, usage, and
receipt acknowledgement commit together; source-file cleanup follows commit.
Keep ingestion running without an open browser. Retention/reset changes must
preserve unanswered prompts and later usage corrections. Test both sides of
commit/reset failures and keep unreadable inputs retryable without starving
other publishers. Failed storage measurements are unknown, not zero.

Settings writes use the revision actually read (`If-Match`). Stale clients must
review a conflict rather than overwrite newer collections. Corrupt settings stay
untouched; invalid/unavailable retention settings suspend destructive pruning.
Physical compaction is explicit through `tools/maintain.py`, never automatic
polling cleanup. Preserve row identities, pending input, and reset state; reject
unknown schemas and busy connections. See [architecture](docs/architecture.md).

Usage records are complete replacement snapshots with stable source IDs; cached
and reasoning counters are subsets, not extra totals. Keep unknown metrics and
runtime cost estimates distinct. Reported task lists have independent lifecycle
and bounded replay memory; they never refresh agent clocks or award XP.
Do not retire an achievement by subtracting earned XP. The active catalog has
37 reachable entries. The source contracts and tests define exact limits.

### Frontend and room interactions

Keep one frontend for standalone and VS Code. Render runtime text literally.
Preserve focus, selection, scroll position, drafts, and panel context across
unchanged polls. Furniture enters undo history only after save confirmation;
external changes invalidate stale history. Preferences use canonical session IDs,
and filtered agents still occupy their desks.

Test keyboard/pointer input, touch cancellation, mobile Fit scrolling, pause,
and reduced motion. Shared geometry drives rendering, collisions, selection, and
reflow. Room toys and games never publish work events or award XP. Audio requires
an explicit gesture and stops on mute, tab hiding, and exit. Camera follow must
release on manual pan, Fit, editing, filtering, or actual departure.

The 26-prop catalog allows 24 custom placements. Props open the existing panels:
the task terminal selects Local runs when enabled and reported tasks otherwise;
the beacon reflects observed input requests; pet beds reserve reachable resting
places. Animation is not proof of work. Keep the product site usable without JS
and under a project subpath; its build has a public-file allowlist.

### Art and runtime marks

Preserve source, license, attribution, checksums, frames, and anchor contracts.
An open-source code license does not automatically cover artwork or trademarks.
Original generated sheets remain in Git; the compact atlas is reproducible through
[the asset pipeline](docs/asset-pipeline.md). Optional licensed Smallburg sheets
belong only in the local data directory via the [importer](docs/aquarium-assets.md).
The jukebox uses original synthesis, not imported recordings.

## Safe cleanup

Generated reports, builds, caches, dependency folders, `.env` files, rotated logs,
and local office state must stay out of commits. After reviewing evidence, remove
only generated folders you recognize. Do not use blanket `git clean -fdX`: ignored
files can include local credentials or data. Never delete/truncate a live database,
legacy log, pending inbox, or user artwork as part of repository tidying.
[Diagnostics and maintenance](docs/architecture.md#diagnostic-logs-and-safe-cleanup)
explain what each cleanup operation actually changes.

## VS Code development

Read [the extension guide](vscode/README.md). With a real installation:

```sh
code --extensionDevelopmentPath=/absolute/path/to/agent-office/vscode
```

Keep the observer in the same workspace environment. Verify connection reload,
offline recovery, configuration changes, disposal, and remote forwarding.
Simulated VS Code API tests and successful packaging are not extension-host tests.

## Pull requests

Describe the concrete failure, behavior change, and exact verification. Add a
regression for correctness fixes and synthetic screenshots for visible changes.
Name the environments actually exercised. Update the relevant guide rather than
adding another overlapping audit report. Preserve useful historical/provenance
records and link them from the existing documentation index.

For focused browser debugging, `npm run test:browser:original` checks the Classic
compatibility flows and `npm run test:browser:studio` checks Studio, public-package,
navigation, panel-safety and saved-brief flows. `npm run test:browser` runs both;
release verification must keep the complete command. The maintained tool and
asset inventory is in [the asset pipeline](docs/asset-pipeline.md#maintainer-tool-inventory).
