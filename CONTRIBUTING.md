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

This produces images under `reports/scene-render` and does not replace browser interaction tests or add a production dependency. The [CI workflow](.github/workflows/ci.yml) runs Python, Node, syntax, formatting, and browser checks; documentation-only changes are excluded from its automatic triggers.

Build the shareable demonstration with `npm run build:preview`. It packages the reviewed public fixture and assets into `dist/` and the product website into `dist/about/`. `npm run build:site` builds the website alone in `site-dist/`, suitable for GitHub Pages. These commands do not start a live observer or deploy a site. [The preview guide](docs/preview.md) explains fixture regeneration, local checks, and deployment settings.

## Change boundaries

### Runtime adapters

Start with the runtime's own documented payloads. Preserve actual session, tool-call, request, and child-session identities. Keep fixtures small and remove private commands, paths, prompts, tokens, and account data before adding them to Git. A fixture verifies the mapper; a live integration claim also requires a run with the actual supported runtime version.

Publish through the immutable inbox protocol. Do not append to or truncate `events.jsonl`, invent successful outcomes, or reuse receipt filenames. Keep hooks fail-open for the runtime and publish no controlling output. Codex hook trust remains a user action; the installer must not alter trust records. See [runtime contracts](docs/runtime-observers.md).

### Persistence and usage

[`event_store.py`](event_store.py) owns the SQLite writer transaction. Live state, progress, usage changes, and receipt acknowledgment commit together; file cleanup follows commit. Keep background ingestion working without a browser. A retention change must preserve unanswered prompts, aggregate counters, and later usage corrections. Test failures on both sides of a commit or reset boundary when changing that protocol.

Usage events require a stable source `usage_id`, platform, and session. They are complete replacement snapshots. Input/output are inclusive; cached/reasoning values are subsets. Preserve source totals and missing values, report only observed cost with its source, and avoid counting both a component and a total containing it. Never add speculative model price tables or replace unavailable metrics with zero. The compact unit ledger remains necessary for replay/corrections even when raw history is pruned.

The active achievement catalog has 37 entries. Add a reachable condition and meaningful coverage before declaring any new achievement. Preserve earned XP when retiring an ID; filter obsolete unlock/recent records through `normalize_achievements`. Display-only label changes must not revoke rewards. Runtime aliases should not create additional runtime families.

### Frontend and room interactions

Keep one shared browser frontend for standalone use and VS Code. Render event text safely and preserve keyboard focus when reconciling cards. Settings saves must protect newer queued patches from earlier failures. Furniture operations enter undo history only after confirmation; external furniture changes invalidate stale history.

Test pointer and keyboard paths, mobile Fit scrolling, cancelled gestures, and reduced motion when modifying the canvas. Shared bounds should drive drawing, collision, selection, and reflow. Decorative interactions must not publish work events or award fabricated work XP. Music starts only after a user gesture and stops on mute, tab hiding, and page exit.

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
