# Contributing

Agent Office is a local observer for work performed by existing agent runtimes. Contributions should improve observation, accounting, or the office interface while preserving that boundary. Runtime adapters must not send prompts, execute tools, decide approvals, or alter the work they observe.

## Development setup

Use Python 3.10+ and Node.js 22. Node and the packages below are development dependencies; the local Python server and production frontend do not need npm installed.

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-dev.txt
npm ci
```

Run `python3 run.py` for an empty office at `http://127.0.0.1:8113`, or `python3 demo_feed.py` for synthetic activity at `http://127.0.0.1:8114`. The demo always creates an isolated temporary data directory. Use it for interface development instead of feeding fabricated events into your live history.

## Checks

From the repository root:

```sh
python -m pytest -q
npm test
npm run check
npm run format:check
```

For the browser suite, install Chromium once or select an existing executable:

```sh
npx playwright install chromium --only-shell
npm run test:browser
```

Alternatively:

```sh
CHROMIUM_PATH=/absolute/path/to/chrome npm run test:browser
```

Browser tests start their own Python server and temporary office data. They exercise actual HTTP routes, DOM controls, canvas rendering, and event fixtures without calling a model or changing runtime configuration. Save browser evidence with:

```sh
OFFICE_SCREENSHOTS=reports/screenshots npm run test:browser
```

Use `npm run format` to apply the repository's Prettier rules, then inspect the diff. Prefer focused tests while developing and run the complete checks once the change is ready. Tests should cover externally observable behavior or a meaningful failure boundary, rather than restating the implementation.

An optional scene-only renderer uses a separately installed `skia-canvas` package:

```sh
SCENE_CANVAS_MODULE=/absolute/path/to/skia-canvas node tests/render-scene.cjs
```

This produces images under `reports/scene-render` and does not replace browser interaction tests or add a production dependency. The [CI workflow](.github/workflows/ci.yml) defines Python, Node, syntax, formatting, and browser checks; documentation-only changes are excluded from its automatic triggers.

An opt-in integration check uses an already installed official Gemini CLI **0.63.0**:

```sh
GEMINI_TEST_CLI=/absolute/path/to/gemini python -m pytest tests/test_gemini_native.py
```

It creates its own empty workspace and Gemini configuration, installs the actual observer hook, and uses a synthetic loopback provider with a fake key and external connections rejected. The per-invocation trust acknowledgement applies only to that new test directory. It verifies both successful and failed provider responses, source hook omissions, quiet-state expiry, and unchanged accounting. It does not install a CLI, use a provider account, or alter an existing workspace's trust. Without the explicit executable path, these two tests are skipped.

Build the shareable demonstration with `npm run build:preview`. It packages the reviewed public fixture and assets into `dist/` and the product website into `dist/about/`. `npm run build:site` builds the website alone in `site-dist/`, suitable for GitHub Pages. These commands do not start a live observer or deploy a site. [The preview guide](docs/preview.md) explains fixture regeneration, local checks, and deployment settings.

## Change boundaries

### Runtime adapters

Start with the runtime's own documented payloads. Preserve actual session, tool-call, request, and child-session identities. Keep fixtures small and remove private commands, paths, prompts, tokens, and account data before adding them to Git. A fixture verifies the mapper; a live integration claim also requires a run with the actual supported runtime version.

Publish through the immutable inbox protocol. Do not append to or truncate `events.jsonl`, invent successful outcomes, or reuse receipt filenames. Keep hooks fail-open for the runtime and publish no controlling output. Codex hook trust remains a user action; the installer must not alter trust records. See [runtime contracts](docs/runtime-observers.md).

### Persistence and usage

[`event_store.py`](event_store.py) owns the SQLite writer transaction. Live state, progress, usage changes, and receipt acknowledgment commit together; file cleanup follows commit. Keep background ingestion working without a browser. A retention change must preserve unanswered prompts, aggregate counters, and later usage corrections. Test failures on both sides of a commit or reset boundary when changing that protocol.

Keep unreadable inputs retryable without starving other publishers or overtaking earlier records from the same writer. A failed or partial legacy read must preserve its cursor and live state, including during reset preparation. Storage measurements distinguish pending input, acknowledged cleanup, temporary files, history bytes, and database size; a failed measurement is `null`, not zero or a partial sum. Automatic retention must suspend when preferences are unavailable or contain an unsupported retention value instead of applying destructive defaults.

Physical compaction is explicit maintenance through `tools/maintain.py`, never part of polling, pruning, or reset. Preserve logical rows, declared IDs, accounting correction baselines, and pending input. Validate an existing office schema before rebuilding; report busy locks and unavailable measurements accurately. The [maintenance regressions](tests/test_storage_maintenance.py) cover exclusive locking, WAL sidecars, altered schemas, and reset recovery.

Usage events require a stable source `usage_id`, platform, and session. They are complete replacement snapshots. Input/output are inclusive; cached/reasoning values are subsets. Preserve source totals and missing values, report only observed cost with its source, and avoid counting both a component and a total containing it. Never add speculative model price tables or replace unavailable metrics with zero. The compact unit ledger remains necessary for replay/corrections even when raw history is pruned.

Reported task lists are separate complete snapshots keyed by runtime/session. Reject malformed or oversized lists atomically; distinguish unreported from explicitly empty. Task reports must not create sessions, refresh agent clocks, infer completed work, or change any progression counter. Preserve the 128-board/100-task bounds and eight-capture replay watermarks, including legacy checkpoint migration. Test interrupted and interleaved capture replay as well as genuine later source records. The public response must not expose internal capture memory.

The active achievement catalog has 37 entries. Add a reachable condition and meaningful coverage before declaring any new achievement. Preserve earned XP when retiring an ID; filter obsolete unlock/recent records through `normalize_achievements`. Display-only label changes must not revoke rewards. Runtime aliases should not create additional runtime families.

### Frontend and room interactions

Keep one shared browser frontend for standalone use and VS Code. Render event/task text literally and preserve focus, text selection, and panel context across unchanged polls. Furniture operations enter undo history only after confirmation; external furniture changes invalidate stale history.

Settings reads carry a revision: use `/state`'s `settings_revision` or the quoted `ETag` from `GET /settings`, and send it in `If-Match` for every HTTP patch. Missing conditions return 428 and stale conditions return 409. A conflict requires reviewing the returned current state, not automatically overwriting another view's collections. Preserve newer queued patches across ordinary transport failure, but discard stale-generation writes after a conflict. Corrupt or unreadable files remain untouched; editing resumes only after a valid revision arrives. See the [settings contract](docs/architecture.md#settings-consistency) before adding a new writer.

Test pointer and keyboard paths, mobile Fit scrolling, cancelled gestures, and reduced motion when modifying the canvas. Shared bounds should drive drawing, collision, selection, and reflow. Decorative interactions must not publish work events or award fabricated work XP. Music starts only after a user gesture and stops on mute, tab hiding, and page exit.

The catalog has 26 prop types and permits 24 custom placements. Connect new useful props to the existing panels: the task terminal opens reported tasks, the attention beacon reflects observed waiting sessions, and the pet bed opens pet settings while supplying a reserved rest target. A decorative animation is not proof of activity or successful work. Cat bed routing must preserve obstacle clearance, exclusive occupancy, moved/removed target cleanup, and motion preferences; unreachable targets keep a safe local rest rather than teleporting a pet.

Camera following remains an explicit view action. Manual pan, Fit, filtering out the target, editing, and actual despawn must release it. Panel switches must not lose it, and following an exit sprite must not prolong the lifecycle or change accounting. Use the [native follow tests](tests/follow-camera.test.cjs) as the behavioral contract.

Agent preferences use canonical IDs and validated full-map replacement. An invalid or occupied desk destination must leave the previous assignment intact. Filtered agents still occupy their desks. Use the shared appearance resolver for floor sprites, roster portraits, and sprite-dependent ornaments. Preserve these relationships when changing layout or customization controls.

Keep the product website progressively enhanced: content and commands must work without JavaScript, tabs must be keyboard accessible, and all resource paths must work under a project subpath. `tools/build_site.mjs` uses an explicit public-asset allowlist; do not include runtime data, arbitrary exports, or optional commercial art. The Pages workflow publishes only that output and does not alter repository visibility or enablement settings.

### Art, sound, and runtime marks

Record an asset's source, license, attribution, checksum, and animation contract before adding it. Keep original generated files and their provenance where required by the existing asset pipeline. An open-source code license does not automatically cover every bundled image or a brand's trademark use.

The public aquarium uses original art. Optional Smallburg source sheets belong in the local data directory through the verified [importer](docs/aquarium-assets.md), outside Git, public previews, and downloadable source packages. The built-in jukebox loops are original local synthesis; do not replace them with unlicensed recordings.

## VS Code development

Read [the extension guide](vscode/README.md) for commands, configuration, and packaging. With a real VS Code installation, launch an extension development host using:

```sh
code --extensionDevelopmentPath=/absolute/path/to/agent-office/vscode
```

Keep the observer server running in the same workspace environment. Verify connection reload, offline recovery, configuration changes, panel disposal, and remote forwarding where supported. The Node extension tests simulate the VS Code API and make real local HTTP requests; they do not run an extension host. Packaging and actual installation are separate release checks and must be reported accurately if unavailable.

## Pull requests

Explain the concrete problem, resulting behavior, and relevant verification. Include synthetic screenshots for visible changes and a regression case for a correctness fix. State which integration environments were actually tested; do not describe fixtures as a live provider session. Update the appropriate setup, architecture, coverage, or asset documentation when the contract changes.
