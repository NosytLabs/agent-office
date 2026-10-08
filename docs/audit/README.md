# Validation and integration limits

This document describes Agent Office 0.5.0's verification scope and release evidence. The screenshots and browser fixtures use synthetic activity in isolated data directories. They demonstrate the interface and observation path; they do not represent live model sessions.

## Interface evidence

![Task terminal, status beacon, pet bed, and fern in an isolated test office](../screenshots/signals.png)

| View | Screenshot |
| --- | --- |
| Aquarium | [Fish selection and feeding](../screenshots/aquarium.png) |
| Usage | [Reported counters and coverage](../screenshots/usage.png) |
| Settings | [Desk, pet, and saved-choice controls](../screenshots/settings.png) |
| Personalization | [Individual desk and character preferences](../screenshots/personalization.png) |
| Appearance | [Juniper, walnut desks, and a delegated robot](../screenshots/appearance.png) |
| Product website | [Responsive product introduction](../screenshots/product-site.png) |
| New interactive props | [Desktop](../screenshots/signals.png) and [320-pixel mobile reflow](../screenshots/signals-mobile.png) |
| Pet bed | [Cat resting at the placed bed](../screenshots/pet-bed.png) |

See [the preview guide](../preview.md) for the demonstration and [CONTRIBUTING.md](../../CONTRIBUTING.md) to reproduce local browser checks.

## Automated coverage

| Layer | What the tests exercise | Main evidence |
| --- | --- | --- |
| Event durability | Out-of-order source timestamps, identical event publications, competing consumers, failures before/after commit, receipt cleanup, and raw count/age/byte retention | [`test_event_store.py`](../../tests/test_event_store.py), [`test_event_inbox.py`](../../tests/test_event_inbox.py) |
| Settings integrity | Required revisions, stale full-map conflicts, cooperating process concurrency, preserved malformed files, oversized numbers, repair, and suspension of pruning while retention settings are unavailable | [`test_settings_concurrency.py`](../../tests/test_settings_concurrency.py), [`settings-concurrency.test.cjs`](../../tests/settings-concurrency.test.cjs) |
| Storage health | Fair durable retries, publisher ordering, acknowledged cleanup, temporary/legacy bytes, unavailable measurements, exact usage-record counts, and legacy I/O recovery | [`test_storage_health.py`](../../tests/test_storage_health.py), [`test_event_cache.py`](../../tests/test_event_cache.py) |
| Reset recovery | Recovery after publishing a reset intent, post-commit cleanup failures, late old-epoch writes, pending reset reads, and concurrent legacy appends | [`test_reset_protocol.py`](../../tests/test_reset_protocol.py) |
| Lifecycle | Parallel calls, independent unanswered prompts, real child-session IDs, duplicate terminal events, late orphan completions, quiet-state context, and session expiry | [`test_state_model.py`](../../tests/test_state_model.py), [`test_agent_lifecycle.py`](../../tests/test_agent_lifecycle.py) |
| Usage | Stable identities, duplicate snapshots, corrections, missing/invalid fields, token subsets, cost coverage, overflow handling, and history/reset boundaries | [`test_usage.py`](../../tests/test_usage.py), [`test_event_store.py`](../../tests/test_event_store.py) |
| Runtime adapters | Provider-shaped fixtures through actual local hook processes or the OpenCode plugin, immutable publication, and SQLite consumption | [`test_runtime_adapters.py`](../../tests/test_runtime_adapters.py), [`test_codex_hook.py`](../../tests/test_codex_hook.py), [`test_codex_stream.py`](../../tests/test_codex_stream.py), [`test_hermes_usage.py`](../../tests/test_hermes_usage.py), [`opencode-bridge.test.mjs`](../../tests/opencode-bridge.test.mjs) |
| Reported task lists | Valid full snapshots, explicit clearing, atomic invalid-input rejection, stable source/receipt times, eight-capture replay memory, restart, source adapters, historical rows, and unchanged XP/lifecycle | [`test_tasks.py`](../../tests/test_tasks.py), [`test_tasks_integration.py`](../../tests/test_tasks_integration.py), [`tasks-view.test.cjs`](../../tests/tasks-view.test.cjs), [`settings-concurrency.test.cjs`](../../tests/settings-concurrency.test.cjs) |
| Installation | Runtime detection, additive configuration, malformed configuration preservation, optional hooks, Codex trust boundaries, and extension file selection | [`test_install_config.py`](../../tests/test_install_config.py), [`test_audit_regressions.py`](../../tests/test_audit_regressions.py) |
| Achievements | All 37 catalog conditions are reachable; retired records disappear while earned XP, statistics, and existing lamps remain; errors, time of day, and theme changes award no XP; aliases do not inflate runtime counts | [`test_progress.py`](../../tests/test_progress.py), [`test_layout_unlocks.py`](../../tests/test_layout_unlocks.py), [`test_event_store.py`](../../tests/test_event_store.py), [`test_audit_regressions.py`](../../tests/test_audit_regressions.py) |
| Browser and scene | Real local HTTP routes, polling, disconnected states, furniture/editor persistence, failed queued saves, touch scrolling, focus, search, reset, assets, and downloads | [`browser.test.cjs`](../../tests/browser.test.cjs), [`scene-model.test.cjs`](../../tests/scene-model.test.cjs), [`product-ui.test.cjs`](../../tests/product-ui.test.cjs) |
| Appearance | All 21 compiled robot poses, roster consistency, grounded crowns, real walk frames/facing in both layouts, desk finishes, save recovery, unlock gates, transformed canvas clicks, and responsive collision bounds | [`appearance.test.cjs`](../../tests/appearance.test.cjs) |
| Personalization | Canonical-ID desk and character preferences, atomic validation, occupied-seat rejection, deterministic conflicts, stable automatic homes, native save/rollback, filtering and responsive layouts, persistence without fabricated activity | [`personalization.test.cjs`](../../tests/personalization.test.cjs), [`personalization-browser.test.cjs`](../../tests/personalization-browser.test.cjs), [`test_personalization.py`](../../tests/test_personalization.py) |
| HUD | Visible close controls, preserved scroll and inspector return context, selected history text across polling, contained mobile scrolling, deduplicated notices, safe view persistence, and per-agent usage coverage | [`hud.test.cjs`](../../tests/hud.test.cjs) |
| Pets | Bounded movement, collision clearance, idle approaches and active-work avoidance, sleep, click targets, reflow, pause, visibility, and reduced-motion behavior | [`pets.test.cjs`](../../tests/pets.test.cjs), [`pets-browser.test.cjs`](../../tests/pets-browser.test.cjs) |
| Follow camera | Native follow/stop, panel retention, manual pan/Fit/filter/edit cancellation, and release after actual session-end ingestion and sprite fade | [`scene-model.test.cjs`](../../tests/scene-model.test.cjs), [`follow-camera.test.cjs`](../../tests/follow-camera.test.cjs) |
| Interactive props and beds | Native placement/actions/reload, exact sprite pixels, mobile collisions, connected waiting-only beacon, frozen overlays, normal pet motion, accelerated bed arrival, and moved/removed-bed release | [`signals-browser.test.cjs`](../../tests/signals-browser.test.cjs) |
| Aquarium and music | Fish movement/feeding limits, unlocks, preferences, optional art validation, gesture-started audio, voice cleanup, and muted/hidden behavior | [`aquarium.test.cjs`](../../tests/aquarium.test.cjs), [`jukebox-model.test.cjs`](../../tests/jukebox-model.test.cjs), [`room-interactions.test.cjs`](../../tests/room-interactions.test.cjs), [`test_smallburg_import.py`](../../tests/test_smallburg_import.py) |
| Public preview | Isolated fixture generation, static build boundaries, synthetic markers, reset/history/preferences, and exclusion of local data and optional commercial art | [`test_preview_build.py`](../../tests/test_preview_build.py), [`preview.test.cjs`](../../tests/preview.test.cjs) |
| Product website | Allowlisted public build, safe regeneration, relative paths, real desktop/mobile browser flows, keyboard tabs, actual clipboard and denied-clipboard recovery, reduced motion and no-JavaScript content | [`test_site_build.py`](../../tests/test_site_build.py), [`site.test.cjs`](../../tests/site.test.cjs) |
| VS Code view | URL validation, actual local HTTP probes, cancellation/race handling, command boundaries, and panel lifecycle | [`vscode-panel.test.cjs`](../../tests/vscode-panel.test.cjs): 11 focused tests passed in this validation environment |

Run the repository's Python, Node, syntax, formatting, and browser commands together before release. The [CI workflow](../../.github/workflows/ci.yml) defines the same checks and captures browser artifacts. A configured workflow is not evidence of a hosted run; consult the pull request's actual check results for its commit. This document does not carry forward test totals or benchmarks from an older implementation.

### Verified 0.5.0 task-reporting update

The integrated local run on 8 October 2026 (UTC) used Python **3.12.14**, Node
**24.19.0**, and Chromium **153.0.8010.0**. The configured CI Node version is 22;
local tests do not establish the result in that separate environment.

| Command or flow | Result |
| --- | --- |
| `python -m pytest -q -o addopts=''` | 441 passed |
| `npm test` | 101 passed |
| `npm run test:browser` | 160 passed, 0 failed, 1 optional local-art check skipped; 74.2 seconds |
| Separate optional Smallburg browser check | 1 passed with the verified local pack; all four fish decoded all four native frames |
| `npm run check` | Passed |
| `npm run format:check` and `git diff --check` | Passed |
| `npm run build:preview` | Built 61 public demo files and 19 product-site files; no local runtime data or Smallburg sheets |

The new real-server browser flows exercise two-tab stale saves, queued
replacement-map conflicts, corrupt settings and repair, unavailable storage
measurements, task-list publication and historical state, a mobile inspector
that leads with activity, and camera follow/stop behavior. They use the actual
Python publisher, inbox, SQLite store, and HTTP routes with synthetic events.
Provider executables are not invoked by these fixtures.

The new furniture suite verifies native placement, clicks, reload persistence,
320-pixel reflow, actual amber/neutral beacon pixels, and paused overlays.
It first observes pet movement under the ordinary browser animation loop.
Bed arrival then uses explicitly accelerated scene frames: 614 and 615 steps
at 1/30 second, approximately 20.47 and 20.50 **simulated** seconds. Both paths
have zero detected collisions and reach the exact bed target. Native bed
movement and removal release the reservation. These measurements do not claim
wall-clock nap timing or provider activity.

Independent core review reproduced two additional failures before their
fixes: unreadable settings could apply a shorter default history limit, and a
parseable oversized integer could raise an exception during settings loading.
The retention regressions preserve 1,001 existing rows, accept a new row, keep
all 1,002 through repair, and prune only after an explicit shorter policy.
They cover corrupt JSON, denied reads, and invalid count, age, or byte limits.
Numeric and process-concurrency regressions also passed on independent review.
Missing task coverage now remains distinct from a known empty collection.

Existing browser gates continue to cover actual audio waveforms and cleanup,
aquarium feeding/unlocks, animation frames/facing, stable desk assignments,
pre-hydration write guards, keyboard/focus/scroll behavior, and the product
website. Their passing totals must come from the current integrated run,
not from an earlier release. Optional commercial fish artwork is excluded
from the public fixture and uses its separate local-art check.

[The hosted-review guide](../preview.md#hosted-review) records the prior deployed
build and explains how to inspect the source commit for a later release.
A Vercel build confirms the static build environment; it is separate from
Python, Node, and Chromium test execution. At this review, main had a successful
Vercel status and no GitHub test check-runs. The CI workflow had previously been
disabled manually; the connected tools cannot administer that setting.
GitHub Pages remains disabled. Its separate site workflow can build while
skipping Pages deployment. No replacement workflow or access-setting change
was used to bypass either configuration.

## Integration limits

**Installed runtime sessions remain unverified here.** Hermes, Claude Code, Codex, and OpenCode executables were unavailable in this environment. Tests exercised their adapter contracts and the real local publisher → inbox → database → HTTP/browser path using fixtures. A user-environment check must still confirm that the installed runtime version emits those payloads and successfully loads its configuration. [Runtime coverage](../runtime-observers.md) identifies adapter-specific capabilities and source contracts.

**The VS Code extension host was unavailable.** `/usr/local/bin/code` was a launcher shim whose version check reported that VS Code/Code Insiders was not installed. The 11 extension tests include real local HTTP requests and a simulated VS Code API, not a running extension host. Remote forwarding, workspace-host installation, and authentication handoff therefore need an actual VS Code environment. Packaging through the pinned official `@vscode/vsce` tool was attempted, but dependency download was blocked by the execution environment's network policy. No successfully packaged or installed VSIX is claimed by this audit.

**Usage is observed coverage.** Claude hooks supply no usage counters. Supported Hermes hooks cover main-loop API attempts, and Codex usage requires the documented captured-stream path. OpenCode's monetary field is a runtime estimate; reported zero can reflect missing runtime pricing. Missing metrics remain unknown. A differing old usage snapshot without a revision is indistinguishable from a correction.

**Retention has explicit boundaries.** The default 1,000-event / seven-day / 5-MiB limit applies to raw activity. Live unresolved prompts and compact accounting survive pruning. Automatic pruning pauses when retention settings are unavailable. Usage identities grow with unique observed units, offline inbox files wait for the server, and legacy JSONL files remain read-only. Arbitrary legacy rewrites lack the stable identity guarantees of new publishers. See [storage and reset design](../architecture.md).

**Task lists preserve source statements.** A completed session does not establish that every reported task finished. Recent known Codex capture replays are suppressed by bounded per-board memory; unseen or evicted captures have no shared source clock and follow receipt order. A board evicted from the 128-board collection loses that replay memory. OpenCode's inspected TODO payload has no source-update timestamp, so the UI labels receipt time separately.

**Settings concurrency covers cooperating local servers.** Tests cover processes sharing the same local SQLite lock and injected I/O failures. They do not prove power-loss durability, network-filesystem locking, or atomicity against arbitrary external editors racing the final file replacement.

**Optional commercial art is local.** The public aquarium uses original bundled artwork. The Smallburg importer validates an existing licensed Little Current checkout and installs outside this repository; it does not fetch, license, or publish the commercial source files. [The import guide](../aquarium-assets.md) records exact sources, hashes, frame selection, and license boundaries.

## Source and asset review

[The reference review](../reference-review-2026-10-07.md) records inspected repositories, primary runtime documentation, and what can be adopted by a local observer. It covers Pixel Agents and Hootbu's fork, Harish Kotra's AgentOffice, AgentSystemLabs, thepixeloffice.ai, Claw3D, Termi, the supplied LinkedIn prototype, and SVGL's AI marks.

Provider normalization, readable status grouping, editable rooms, and separate temporary animation cues are compatible concepts. Autonomous dispatch, agent hiring, model execution, and permission decisions are outside this product. No feature claim is inherited merely because it appears in a reference project's README or marketing page.

MIT code notices, separately licensed artwork, generated-art provenance, and trademark attribution are kept distinct. Noncommercial or restricted artwork is not included based solely on an open repository. Consult [sprite provenance](../../web/assets/sprites/ATTRIBUTION.md), [font, icon, and runtime mark credits](../../web/assets/ATTRIBUTION.md), and [optional aquarium art](../aquarium-assets.md) for the shipped assets.
