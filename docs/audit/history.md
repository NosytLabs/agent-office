# Historical validation reports

These reports preserve earlier local validation results and release-specific
review evidence. They describe the repository at the time of each named update;
the [current validation report](README.md) contains the latest totals and
integration limits. A configured CI or deployment workflow is not evidence
that these local results ran in a hosted environment.

## Integrity branch reconciliation — 8 October 2026

The former `codex/office-integrity` line at `897d3e0` was reviewed before the
arcade merge. Its useful terminal-callback and late-error coverage was already
incorporated; its remaining test-only expectations described a retired reward
policy and were not reintroduced. Current progression and event-store tests
cover retired achievements, no-XP error handling, settings-only theme changes,
legacy lamp preservation, the 50-observed-tool lamp reward, and milestone
percentages.

A later cleanup comparison confirmed `897d3e0` is an ancestor of current
`main`: the branch has zero unique commits and is fully superseded. No user XP,
rewards, or event history were rewritten during that reconciliation.

## Local task control and console update — 8 October 2026

The [optional local runner](../local-task-runner.md) is a separate execution
path for explicitly starting a new Codex or Claude Code task. The existing
observer adapters retain their reporting role. The shared Tasks panel now
contains session activity, reported lists, editable briefs, and Local runs.

This validation used Python **3.12.14**, Node **24.19.0**, and Chromium
**153.0.8010.0** on Linux. CI and Vercel are configured for Node 22.

| Command or flow | Result |
| --- | --- |
| `GEMINI_TEST_CLI=... python -m pytest -v -o addopts='' --junitxml=reports/local-runs-review-python.xml` | **579 passed**, including both native Gemini fixture cases; 35.83 seconds |
| `npm test` | **101 passed** |
| `npm run test:browser` | **209 passed**, 0 failed, 1 optional private-art check skipped; 129.50 seconds |
| `npm run check` | Passed |
| `npm run format:check` and `git diff --check` | Passed |
| `npm run build:preview` | Built **104 public demo files** and **20 product-site files**; no local office data or private aquarium sheets |

Runner checks start the actual Python HTTP server and temporary executable
fixtures. They verify exact prompts and selected working directories, fixed
Codex/Claude argument lists, nonzero exits, a missing executable, output before
process completion, and concurrent stdin/stdout pumping. They also exercise
the 256 KiB output limit, 40-entry settled history, global and per-project
admission, canonical UUID retries, and cancellation of a descendant that keeps
the output pipe open after its parent exits. Startup on an occupied port fails
clearly without altering the existing observer's shared-port behavior.

The browser runner flow deliberately loses the first successful POST response
and retries the unchanged request, producing one run. It verifies literal
output, cancellation, prompt reuse, retained and programmatic draft transfer,
Unicode code-point limits, focus and text selection across polling, stale-read
rejection, and the disabled public preview. The desktop sheet expands to fit
its form and history; narrower containers use one column. History is bounded,
and mobile metadata wraps without horizontal clipping.

The new console uses an original generated four-state atlas with exact source
bytes, generation metadata, checksum, and the existing 24-by-34 placement box.
Its running-only activity lamp has two frames and freezes under Pause or
reduced motion. Only a successful process exit selects the steady finished
sprite. A newer failure, cancellation, or interruption overrides an older
success; a failed exit uses a steady error lamp. Missing artwork falls back to
the established console while preserving the correct Local runs action.

An additional assembled-app review exercised Settings save/reload, Escape
focus restoration, keyboard pause/zoom/Fit, canvas selection, and desktop and
320-pixel mobile placement. No page errors, sprite errors, or horizontal page
overflow were observed in those flows. The screenshots show synthetic task
fixtures, not provider-backed work.

The runner tests do **not** establish a real authenticated Codex or Claude task
on a provider account. Neither CLI was installed for native verification here.
POSIX cleanup was exercised; native Windows signaling remains unverified.
Interactive PTYs, attaching to existing sessions, answering permission prompts,
durable scheduling, and orchestration are outside this implementation. These
limits are also recorded in the [runner guide](../local-task-runner.md).

The complete browser run contained 210 cases. Its one skip is the existing
optional private Smallburg artwork check; the public artwork and missing-pack
fallback paths passed. All new runner and console cases ran. The CI workflow
includes the new runner suite through `npm run test:browser`; these results
are local evidence, not a claim that the repository's disabled hosted CI ran.

### Review follow-up

The published review prompted an additional fault-injection pass. Failure to
start a task worker had consumed admission without creating a child; failure
to start its stdin pump could abort cleanup by joining an unstarted thread.
Both paths are now covered by regressions. Worker startup becomes a retained,
idempotent failed run with a released slot. A started child is terminated and
reaped before a pump failure is finalized. The browser reports an immediately
failed acknowledgement without saying that a CLI started.

| Review point | Decision and evidence |
| --- | --- |
| Windows descendants | Documented the best-effort boundary and possible surviving descendants in the [runner guide](../local-task-runner.md), with Microsoft and Python references. Console-group delivery can include descendants; the fallback does not guarantee their termination. Native Windows verification remains outstanding. |
| Worker bookkeeping and resource failure | Fixed the reproduced startup paths, including terminal timestamps, idempotency, process reaping, closed pipes, released project/global admission, and a successful subsequent run. |
| Duplicate Host fields | Kept the exact single-Host boundary. [RFC 9112 section 3.2](https://www.rfc-editor.org/rfc/rfc9112.html#section-3.2) requires rejection of duplicate Host field lines; allowing any matching value would weaken that boundary. |
| HTTP timeout versus CLI startup | Kept the bounded HTTP timeout. Creation acknowledges the registered worker independently of CLI startup/output. The retained request ID and run-list polling recover a lost acknowledgement; timing out is not an instruction to cancel the user's task. |
| Blocking output reads | Kept the blocking pipe read. It waits when the pipe is empty, as described by the [Linux pipe manual](https://man7.org/linux/man-pages/man7/pipe.7.html), and consumes available output without adding timer-based polling. |
| Feedback and themes | Operation feedback and validation occupy separate lines. Output uses the selected theme's background variable. |

## Earlier arcade, aquarium, and room update

The integrated local run on 8 October 2026 (UTC) used Python **3.12.14**,
Node **24.19.0**, and Chromium **153.0.8010.0**. CI and Vercel remain configured
for Node 22. The following results belong to this update:

| Command or flow | Result |
| --- | --- |
| `GEMINI_TEST_CLI=... python -m pytest -q -o addopts=''` | **531 passed**, including both native CLI cases; 21.75 seconds |
| `npm test` | **101 passed** |
| `npm run test:browser` | **189 passed**, 0 failed, 1 optional local-art check skipped; 122.56 seconds |
| `npm run check` | Passed |
| `npm run format:check` and `git diff --check` | Passed |
| `npm run build:preview` | Built 99 public demo files and 20 product-site files, including local arcade media and source notices; no local runtime data or private Smallburg sheets |
| Built static preview playthrough | An actual mouse hit scored 1,000 in Duck Hunt; Breakout cleared a brick; both new appearances and room lights saved and survived reload; no page errors, failed requests, or external game requests |

The browser command bounds independent test-file workers to four. Its complete
190-test result includes one deliberate skip for the optional private Smallburg
pack, which was unavailable in this environment. Original public fish, the
missing-pack fallback, rejection of false manifest geometry, fish inspection,
feeding, tank-light save/reload, and failed-save recovery were exercised. The
existing importer separately retains pinned source-hash, 96-by-64 sheet,
16-by-16 frame, path, and atomic-publication checks. This does not establish a
runtime review of the absent private pack.

Duck Hunt uses the actual pinned Adi52 game and runtime assets. The original
bundle remains byte-identical. A reproducible two-expression correction makes
the dog's intro movement proportional to elapsed time; a deliberately slow
42-millisecond animation-frame wrapper exercises the real intro, aiming, and
scoring path. Browser checks also exercise keyboard and touch input, restarted
menus, pause/resume messages, delayed audio readiness, sandbox isolation, local
HTTP MIME types, and the absence of an observer API CORS grant. Breakout model
checks cover every brick pattern, score, lives, win/loss, and bounded movement;
native browser controls cover starting, pausing, restarting, and closing.
[Arcade documentation](../arcade.md) records source revisions, notices, controls,
and the narrow compatibility patch.

The hosted branch review exposed the protected-preview cookie boundary: the
opaque iframe received its document but could not authenticate requests for
its local scripts and stylesheet. An inline bootstrap now waits for both the
stylesheet and lifecycle script before requesting the upstream game, reports a
fixed load error instead of calling an undefined lifecycle function, and offers
an explicit retry in a new iframe. A native regression aborts the child files,
checks that the game is not requested without its lifecycle boundary, then
allows the files and verifies successful retry. No sandbox or deployment
protection permission was broadened. See [hosted review](../preview.md#hosted-review)
for the public playthrough route.

Room checks cover a real lamp click and rendered darkening, acknowledged light
saves and reload, keyboard actions, a usable wall switch with decorations
hidden, bounded coffee/water/plant reactions, and motion pause. Both generated
characters have 21 nonempty grounded frames and persist as individual agent
appearances. Interactions and games leave observer events, reported usage,
progression, and XP unchanged. The narrowest UI checks run at 320 pixels.

The full suite also retains backend event durability, settings concurrency,
runtime adapters, native Gemini hook fixtures, task and usage reporting,
furniture, pets, audio, focus, history, responsive product-site, and extension
contract coverage. The codebase review covered these boundaries as well as the
new interactions; it does not extend the native runtime or extension-host
claims described below.

The repository's GitHub CI workflow was observed to be manually disabled during
release preparation. The test totals above are local results. A Vercel build
and any Pages workflow have their own statuses and do not establish a hosted
regression run. The release pull request records the published commit and
deployment evidence.

## Earlier 0.5.0 UI and reliability verification

The integrated local run on 8 October 2026 (UTC) used Python **3.12.14**,
Node **24.19.0**, and Chromium **153.0.8010.0**. CI and Vercel are configured
for Node 22; local tests do not establish a hosted CI result.

| Command or flow | Result |
| --- | --- |
| `GEMINI_TEST_CLI=... python -m pytest -q -o addopts=''` | **530 passed**, including both native CLI cases; 17.03 seconds |
| `npm test` | **101 passed** |
| `npm run test:browser` | **175 passed**, 0 failed, 1 optional local-art check skipped; 80.54 seconds |
| `npm run check` | Passed |
| `npm run format:check` and `git diff --check` | Passed |
| `npm run build:preview` | Built 62 public demo files and 20 product-site files; no local runtime data or Smallburg source sheets |

The preceding maintenance release also passed official `@vscode/vsce` 4.0.0
packaging: eight expected VSIX entries, 11,505 bytes, with manifest and runtime
files matching source. Extension files are unchanged in this update; packaging
was not repeated. The current run includes all 11 extension contract tests.

Without `GEMINI_TEST_CLI`, the two native cases skip; their eight isolation
guards still run. The native cases use the actual official Gemini CLI 0.63.0
and installed observer command with an explicit synthetic loopback provider.
Success emits start/busy/idle/end. The tested provider-error path emits only
start/busy; after five minutes the UI marks that observation quiet, and after
30 minutes the ordinary stale limit removes it. XP and all progression
statistics remain unchanged through those presentation changes. This does
not establish interactive or paid-provider behavior.

Three new ingestion regressions first reproduced a recursion failure from
deeply nested event payloads. A bounded iterative validation pass now rejects
those records before state application. Healthy neighboring events commit,
invalid records are counted, receipts are acknowledged, and restart does not
replay the healthy events. Legacy source files remain unchanged. Seven new
progress cases cover milestone boundaries: a displayed 100% now requires the
threshold to be reached. These fixes change neither XP nor unlock thresholds.

Real-server Chromium flows verify a saved 48-character unbroken office name at
320, 375, 667, and 1440 pixels, including an actionable waiting-agent control.
Keyboard traversal keeps settings links below the sticky header while panel
close/reopen retains the previous reading position. Site navigation keeps focus
on visible controls when the viewport changes and closes the mobile disclosure
when keyboard focus enters page content.

Two preview regressions exercise a native ordinary-HTTP browser context, where
`crypto.randomUUID()` is unavailable. Settings revisions now use 128 random
bits from `crypto.getRandomValues()`. Fresh saves, legacy migration, reload, and
stale-write rejection work without changing the existing exact-byte comparison
or locking boundaries. See the [MDN API contract](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues)
and the [W3C disclosure navigation example](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/)
for the checked browser behavior and keyboard interaction guidance.

The full run retains copied-Hermes isolation, SQLite compaction/concurrency,
queued furniture-save failure recovery, timestamps, and Gemini hook-to-browser
coverage from the preceding maintenance release. Independent backend and
frontend reviews were scoped to those boundaries.

The complete browser gate also retains coverage for aquarium feeding/unlocks,
audio playback and cleanup, character frames/facing, collisions, pet beds,
follow controls, panel persistence, keyboard/focus/scroll behavior, and the
responsive product website. The optional commercial fish-sheet browser check
was skipped in this run; original public aquarium artwork was exercised.

[The hosted-review guide](../preview.md#hosted-review) explains deployment
verification. Vercel's static build is separate from Python, Node, and browser
tests. The repository's GitHub CI workflow remains manually disabled; the
connected tools cannot administer that setting. GitHub Pages also remains
disabled. No replacement workflow or access-setting change was used to bypass
those configurations. The release pull request records the exact deployed
commit and hosted review results.
