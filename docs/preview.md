# Agent Office 0.5.0 public website and demo

The hosted preview demonstrates the same office UI with **fictional agents,
activity, XP, token usage, and cost examples**. It does not connect to local
coding tools. The page displays a persistent demo notice and labels the usage
section as synthetic. Sample costs are illustrative values, not model prices
or real charges.

The product website in `site/` explains the office, runtime observation,
optional local task execution, setup, and limits. It uses actual app screenshots
with synthetic sessions, bundled licensed fonts/icons, and original page design. It performs
no analytics, model, or observer requests and writes no browser storage.
Copy buttons and keyboard tabs enhance content that also works without
JavaScript.

Links such as `#setup-connect` and `#tour-usage` open the requested tab, including
when following an in-page link or using Back. The tab controls stay below the
sticky header. Responsive screenshots offer 480px, 720px and 1440px versions;
the full-size copies retain the original capture pixels. See the
[image manifest and reproduction steps](../site/screenshots/README.md).

## Product website and GitHub Pages

Build the standalone website with:

```sh
npm run build:site
python3 -m http.server 8080 --directory site-dist
```

Open `http://127.0.0.1:8080`. The generated `site-dist/` contains only explicit public
files plus its build manifest. Every resource and local page link is relative,
so the same output works at `/agent-office/` on GitHub Pages or `/about/` on the
existing Vercel demo. The build reads only its allowlisted source files and
screenshots, rejects symlinked inputs/outputs, and refuses to replace unrelated
directories. Normal macOS `/var` and `/tmp` system aliases are canonicalized to
their fixed `/private` locations; source and output symlinks below those locations
remain rejected, including dangling output links. A failed input check preserves
the previous generated output.

The [Product website workflow](../.github/workflows/pages.yml) is now **manual-only**.
The repository currently has GitHub Pages disabled and serves its production
website from Vercel, so automatically rebuilding an unused Pages artifact on
site changes wasted GitHub Actions minutes. The separate
[CI verification gate](../.github/workflows/ci.yml) still builds the site and
checks application tests on every pull request and `main` push.

If you choose GitHub Pages as a second host, select **Settings → Pages → Build
and deployment → Source: GitHub Actions**, then **Actions → Product website →
Run workflow**. That explicit run builds `site-dist/`, publishes it to the
`github-pages` environment, and retains its build artifact for one day. If
Pages is still disabled, the workflow reports the configuration issue and
skips upload/deployment. It does not change repository access settings. To
make Pages automatically publish on subsequent site changes, reintroduce a
narrow `push` trigger only after enabling Pages; Vercel's Git deployment is
unaffected. Do not treat the GitHub Pages URL as live until verified.

Sources: [GitHub custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
and [configure-pages enablement requirements](https://github.com/actions/configure-pages/blob/45bfe0192ca1faeb007ade9deae92b16b8254a0d/action.yml).

Focused checks:

```sh
python -m pytest -q tests/test_site_build.py
CHROMIUM_PATH=/absolute/path/to/chrome node --test tests/site.test.cjs tests/site-images.test.cjs
```

The browser suite serves the website under `/agent-office/` on port 18125.
It checks desktop, 320/390-pixel mobile and tablet layouts, keyboard tabs,
focus across responsive navigation changes, actual clipboard copying and denied-clipboard recovery,
reduced motion, no-JavaScript content, credits, and local-only asset requests.
Screenshots are saved in `reports/site/` or `OFFICE_SITE_SCREENSHOTS`.

## Hosted review

[Open the product website](https://agent-office-preview-seven.vercel.app/about/)
or [try the live demo](https://agent-office-preview-seven.vercel.app/).
The production address serves the public, synthetic office. Release pull
requests link the exact source commit and Vercel build; check those records
when comparing a later deployment. Branch-preview URLs retain the project's
existing deployment protection. The public production address above needs no
temporary share link.

Duck Hunt runs inside an opaque-origin sandbox. A protected branch preview can
load the iframe document using its preview session while withholding that
cookie from the iframe's stylesheet and script requests. In that case the
arcade shows a load error and an explicit Retry button; it does not start the
upstream game without its lifecycle wrapper. Use the public demo above or a
local server for a full Duck Hunt playthrough. Deployment protection and the
iframe's isolation remain intact.

Use the [merged release pull requests](https://github.com/NosytLabs/agent-office/pulls?q=is%3Apr+is%3Amerged)
for each reviewed commit's exact deployment and hosted checks. The current
[validation guide](audit/README.md) covers reproducible gates and integration limits. A READY static deployment is not a Python, browser-test,
or installed-runtime verification result. Hosted checks cover the public
synthetic application; local Chromium tests additionally verify exact copied
command bytes and controlled error paths that the public demo cannot create.

## Build and inspect locally

The public build has no npm package dependencies and needs Node.js 22 or later:

```sh
npm run build:preview
```

The output is the synthetic app in `dist/` and the product website in
`dist/about/`. To build only the app, use `node tools/build_preview.mjs`; its
optional `--out /path/to/preview-directory` selects a separate directory
outside the checkout. An existing generated preview can be rebuilt; an
unrelated existing directory is never replaced.

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
| Build command | `npm run build:preview` |
| Output directory | `dist` |
| Install command | `node --version` |
| Node.js version | 22.x |

No serverless functions, environment variables, runtime credentials, Python
build environment, or external service calls are needed. The install override
avoids downloading the repository's development-only browser/test packages.
Vercel supports custom build and output settings for static builds. Its
`package.json` Node engine range overrides the project setting, so a broad range
such as `>=22` selects the latest supported matching version; use `22.x` if
specifically pinning that major version is desired.

The build script does not deploy or create a Vercel project. The existing
`agent-office-preview` project builds the connected GitHub branch. Use the
deployment's source commit and check results when reviewing later updates.

References:

- [Vercel build configuration](https://vercel.com/docs/builds/configure-a-build)
- [Supported Node.js versions and engine overrides](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
- [Vercel CLI project setting overrides](https://github.com/vercel/vercel/blob/main/packages/cli/src/util/projects/project-settings.ts)

## Synthetic data and interactions

`tools/generate_preview_fixture.py` creates its own temporary directories and
feeds fictional observer events through the actual `EventStore`, lifecycle
model, XP catalog, and usage ledger. Its checked-in JSON fixture includes a
working Hermes agent, Claude approval request, OpenCode work and completed
subagent, Codex activity, retained history, reported task lists, and both
complete and partial usage reports. A separately generated empty state supplies
the reset behavior.

Regenerate the public seed after intentional schema or catalog changes:

```sh
python tools/generate_preview_fixture.py
```

The generator never opens the operator's configured office directory, event
log, or database. The schema regression compares the checked-in fixture with a
fresh isolated generation. The public Node build only reads this reviewed
fixture and the `web/assets`, `web/arcade`, `web/css`, `web/js`, and template inputs.

The build adds `preview.js` before the regular application script. It answers
the UI's state, settings, and history requests inside the browser. Timestamps
are rebased to the visit, duration counters advance, and the completed subagent
leaves after its normal display window. Task observation ages and historical
labels track those same lifecycle changes; pending tasks remain pending.
The fixed example does not invent new runtime work while the page is open.
Restore sample starts the fictional scene again with fresh relative times.

Room preferences use one record in the `agent-office:static-preview:v1`
IndexedDB database. Existing preferences in the former localStorage key of the
same name migrate once, and that key is removed after the migration commits.
Validated browser view preferences use a separate demo-specific key. Neither
alters a real office. Clear demo history
removes the displayed history while preserving sample agents, XP, and usage.
Reset demo progress clears the sample agents, achievements, usage, and history
while preserving room preferences. Restore sample reinstates the original
fictional state while keeping those preferences. Settings writes use revisions
and an IndexedDB transaction to detect conflicts between tabs. Web Locks also
order cooperating reads and writes; their ordering alone does not refresh a
renderer’s cached localStorage snapshot. A stale edit keeps its draft
and asks the user to review the current settings before retrying. Malformed or
oversized saved demo data remains untouched, with editing and destructive demo
actions disabled until it is repaired. If browser storage itself is blocked,
changes last for the current visit and the notice explains that separate limit.
Clearing this site's browser storage removes the saved demo preferences;
resetting demo progress keeps them, as the confirmation explains.
Theme changes and furniture editing customize the example; they do not generate
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


## Product-page search metadata

`npm run build:preview` publishes the synthetic demo at `/` and the product site
at `/about/`. The product builder adds canonical links, Open Graph/Twitter image
metadata, a real screenshot preview, and a sitemap for the overview and credits.
The default canonical product address is
`https://agent-office-preview-seven.vercel.app/about/`.

For your own production domain, set the same explicit base for both builders:

```sh
AGENT_OFFICE_SITE_URL=https://example.com/about/ npm run build:preview
# A standalone product site can use the root or a project subpath:
AGENT_OFFICE_SITE_URL=https://example.com/ npm run build:site
```

Only absolute HTTPS directory URLs without credentials, whitespace, query or
fragment are accepted. Invalid configuration fails before replacing an existing
build. Do not use a temporary branch-preview URL as the canonical address.
Resources remain relative so project-subpath hosting still works.

The root demo `robots.txt` points to the product sitemap; the product-only builder
also writes a `robots.txt` for root-hosted sites. Crawlers use only the domain-root
robots file, so on shared project-subpath hosts submit the generated sitemap
through that site's search tooling instead. A sitemap is a discovery hint, not a
guarantee of indexing or rankings. See [Google's sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).

The demo uses `noindex, follow`; the local observer remains loopback-only.
Robots directives are not access control. Keep the observer bound to loopback;
never publish local data or rely on robots directives to hide private sessions.
