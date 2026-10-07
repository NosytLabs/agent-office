# Agent Office 0.5.0 static preview

The hosted preview demonstrates the same office UI with **fictional agents,
activity, XP, token usage, and cost examples**. It does not connect to local
coding tools. The page displays a persistent demo notice and labels the usage
section as synthetic. Sample costs are illustrative values, not model prices
or real charges.

## Build and inspect locally

The public build has no npm package dependencies and needs Node.js 22 or later:

```sh
node tools/build_preview.mjs
```

The output is `dist/`. An optional `--out /path/to/preview-directory` selects a
separate directory outside the checkout. An existing generated preview can be
rebuilt; an unrelated existing directory is never replaced.

Serve that directory with any static server. The focused browser test supplies
its own Node static server on port **18120**:

```sh
python -m pytest -q tests/test_preview_build.py
node --test tests/preview.test.cjs
```

Set `CHROMIUM_PATH` when using a system Chromium executable. Browser screenshots
are saved under `reports/preview/`, or `OFFICE_PREVIEW_SCREENSHOTS` when supplied.
They contain only the public demo and public fallback fish.

## Vercel settings

Use these project settings for the reviewed branch/commit:

| Setting | Value |
| --- | --- |
| Framework | Other (`null` in the API) |
| Root directory | Repository root |
| Build command | `node tools/build_preview.mjs` |
| Output directory | `dist` |
| Install command | `node --version` |
| Node.js version | 22.x or a newer supported version |

No serverless functions, environment variables, runtime credentials, Python
build environment, or external service calls are needed. The install override
avoids downloading the repository's development-only browser/test packages.
Vercel supports custom build and output settings for static builds. Its
`package.json` Node engine range overrides the project setting, so a broad range
such as `>=22` selects the latest supported matching version; use `22.x` if
specifically pinning that major version is desired.

This document describes build configuration. A deployment should refer to the
final integrated and verified commit; the build script does not deploy or create
a Vercel project.

References:

- [Vercel build configuration](https://vercel.com/docs/builds/configure-a-build)
- [Supported Node.js versions and engine overrides](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
- [Vercel CLI project setting overrides](https://github.com/vercel/vercel/blob/main/packages/cli/src/util/projects/project-settings.ts)

## Synthetic data and interactions

`tools/generate_preview_fixture.py` creates its own temporary directories and
feeds fictional observer events through the actual `EventStore`, lifecycle
model, XP catalog, and usage ledger. Its checked-in JSON fixture includes a
working Hermes agent, Claude approval request, OpenCode work and completed
subagent, Codex activity, retained history, and both complete and partial usage
reports. A separately generated empty state supplies the reset behavior.

Regenerate the public seed after intentional schema or catalog changes:

```sh
python tools/generate_preview_fixture.py
```

The generator never opens the operator's configured office directory, event
log, or database. The schema regression compares the checked-in fixture with a
fresh isolated generation. The public Node build only reads this reviewed
fixture and the `web/assets`, `web/css`, `web/js`, and template inputs.

The build adds `preview.js` before the regular application script. It answers
the UI's state, settings, and history requests inside the browser. Timestamps
are rebased to the visit, duration counters advance, and the completed subagent
leaves after its normal display window. The fixed example does not invent new
runtime work while the page is open. Restore sample starts the fictional scene
again with fresh relative times.

Preferences use only the `agent-office:static-preview:v1` localStorage key.
They do not alter a real office or another localStorage key. Clear demo history
removes the displayed history while preserving sample agents, XP, and usage.
Reset demo progress clears the sample agents, achievements, usage, and history
while preserving room preferences. Restore sample reinstates the original
fictional state while keeping those preferences. If browser storage is blocked,
changes last for the current visit and the notice explains that limit. Theme
changes and furniture editing customize the example; they do not generate real
observer events or increase its fixed sample activity totals.

## What a public preview cannot observe

The normal Python observer runs on the same computer as the coding runtimes and
receives their local hook/inbox events. A static Vercel deployment cannot read
those files or observe those CLI processes. Deploying a serverless function
would not give it access to a visitor's local filesystem either. To monitor
actual work, install the observer and runtime integrations locally using the
repository's setup instructions.

The public build excludes local logs, SQLite databases, runtime configuration,
the Python server, and optional Smallburg assets. The demo adapter returns 404
for `/user/aquarium/manifest.json` and local asset paths and blocks cross-origin
fetches to local or remote observers. The aquarium uses only the publicly
redistributable fallback. The builder rejects asset symlinks, private/development
asset directories, Smallburg filenames, and the exact known owner-only sheet
hashes rather than packaging them accidentally.
