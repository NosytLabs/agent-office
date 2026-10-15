# Validation and integration limits

This is a verification snapshot, not a promise that every runtime or device has
been tested. Browser fixtures use synthetic activity and isolated data folders;
they do not represent paid-provider work or the owner's live sessions.

## Current local validation

The 15 October 2026 cleanup uses Python 3.13.15, Node 22.23.3, Playwright
1.63.0 and Google Chrome 155 on macOS. The release gate repeats the complete
suite on Ubuntu 24.04 / Python 3.13 / Node 22 with the runner’s maintained Chrome.

| Check | Recorded local result |
| --- | --- |
| Python suite, including HTTP-boundary and build regressions | **670 passed**, **2 optional native Gemini fixture skips** |
| Node models, controllers, and bridges | **162 passed** |
| Browser flows | Full compatibility, Studio, product-site, navigation and attention command defined by `package.json`; see the exact commit’s [CI checks](https://github.com/NosytLabs/agent-office/pull/32/checks) for the release gate |
| Compiled sprites | **47 native sprites / 23 sheets**, **72 character walking frames**, **96 companion walking frames**, **4 seamless surfaces** reproduced from preserved sources |
| Syntax, formatting, local documentation links, and tracked-artifact checks | Required in CI; reproduced locally before publication |
| Public builds | **135 demo files** and **20 product-site files** |

Focused real-observer browser fixtures cover all character/companion directions,
Pause, native PNG/strip pixels, art fallback/retry without draft loss, oak/slate/
original finishes, 320-pixel panels, Customize jumps, history exports, Quick
navigation, attention keyboard cycling and disconnected tab titles. The broader
suite also covers storage, settings conflicts, local runner fixtures, arcade,
aquarium, room editing and usage. No viewing action changes work accounting.

The native Gemini tests require an explicit installed CLI path. The private-art
case requires the owner’s licensed Smallburg pack; public art and synthetic
fallback tests run without it. A successful Vercel deployment is separate from
suite results. Hosted checks and production smoke results must match the merged
commit. Earlier results remain in [history](history.md).

Cold-page connection resets were reproduced with the standard five-connection
listener backlog. The observer now queues 128 requests, and an HTTP regression
queues 32 connections before accepting them. The boundary suite covers foreign
Host/Origin/Fetch Metadata requests, local aliases and explicitly trusted forwarded
origins. A real-Chrome sandboxed forwarding fixture verified preserved and rewritten
Host forms; that is not actual VS Code extension-host verification.

## Reproduce the checks

Use the [development setup](../../CONTRIBUTING.md#development-setup), then run:

```sh
python3 tools/check_repository.py
python -m pytest -q
npm test
npm run check
npm run format:check
npm run check:sprites
npm run test:browser
npm run build:preview
```

`check_repository.py` inspects the Git index and tracked working files only.
Tracked symlinks to untracked or local-only files are rejected before content is
read. Rejected local data is never parsed as documentation. It
checks local Markdown paths/anchors, tracked logs/caches/local data, and conflict
markers without making network requests or deleting files. It is not a complete
Markdown parser or a secret-content scanner. Stage intended new source files
before running it; untracked local files cannot satisfy a committed docs link.

The small [repository-hygiene workflow](../../.github/workflows/hygiene.yml)
checks every pull request and push to `main` without installing npm packages or
running browsers. Asset-only deletions can break unchanged Markdown links, and
any tracked file can contain a conflict marker or forbidden artifact. The full
[CI workflow](../../.github/workflows/ci.yml) uses the same unfiltered events so
required checks are present on documentation changes too. Its 20-minute gate
runs Python and Node tests, syntax and formatting checks, read-only sprite pixel
verification, public builds, and the complete browser command in `package.json`.
Failed or manual runs retain browser artifacts for three days. Consult each
commit's actual check results for evidence of hosted verification.

## Automated coverage

| Area | Main tests and contract |
| --- | --- |
| Publication, transactions, reset, and replay | `test_event_inbox.py`, `test_event_store.py`, `test_reset_protocol.py` |
| Retention, measurements, and explicit compaction | `test_storage_health.py`, `test_storage_maintenance.py`, `test_event_cache.py` |
| Settings and preferences | `test_settings_concurrency.py`, `test_personalization.py`, and corresponding browser flows |
| Lifecycle, usage, and reported tasks | `test_state_model.py`, `test_agent_lifecycle.py`, `test_usage.py`, `test_tasks*.py` |
| Runtime hooks and local task processes | `test_runtime_adapters.py`, runtime-specific hook tests, `test_task_runner*.py` |
| Office, rooms, assets, arcade, and mobile controls | Node models and browser files listed by `package.json`; `test_assets.py`; `native-sprites.test.cjs` |
| Log failure handling | `test_observer_logging.py`: concurrent failures, bounded warnings, redaction, continued publication, broken log handlers |
| Repository hygiene | `test_repository_hygiene.py`: real temporary Git indexes, generated artifacts, local links, anchors, and code examples |

The [tests directory](../../tests) is the source of truth for individual cases.
Do not copy changing test totals into feature descriptions or treat synthetic
fixtures as installed-runtime proof.

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
| Gemini lifecycle | [Mobile inspector with a synthetic hook fixture and unreported usage](../screenshots/gemini-mobile.png) |
| Narrow office heading | [A 48-character name at 320 pixels](../screenshots/long-office-name-mobile.png) |
| Keyboard settings | [Visible focused control below the sticky header](../screenshots/keyboard-settings.png) |
| Arcade | [Duck Hunt with a scored hit](../screenshots/arcade-duck-hunt.png) and [Breakout in play](../screenshots/arcade-breakout.png) |
| Snake | [Desktop play](../screenshots/arcade-snake-desktop.png) and [mobile controls](../screenshots/arcade-snake-mobile.png) |
| Room toys and characters | [Moss engineer and Orbit courier in the office](../screenshots/office-toys.png) and [saved room lighting](../screenshots/room-lights.png) |
| Aquarium interactions | [Public fish, tank lighting, and visible artwork source](../screenshots/aquarium-interactions.png) |
| Local task runs | [Desktop form](../screenshots/local-runs-desktop.png), [completed fixture output](../screenshots/local-runs-output.png), and [320-pixel mobile output](../screenshots/local-runs-mobile.png) |
| Task console | [Original generated console in the assembled office](../screenshots/task-console-running.png) |

See [the preview guide](../preview.md) for the demonstration and [CONTRIBUTING.md](../../CONTRIBUTING.md) to reproduce local browser checks.

## Integration limits

**Runtime coverage is version-specific.** The earlier Gemini CLI 0.63.0 review
exercised real hooks against a synthetic loopback provider, not a paid account.
That opt-in check was not repeated in this cleanup. Hermes, Claude Code, Codex,
and OpenCode adapters are fixture-tested here; authenticated installed sessions
remain unverified. See [runtime contracts](../runtime-observers.md).

**Local runs start fresh processes.** Tests use temporary Codex/Claude-shaped
executables. They do not prove authentication, model access, provider completion,
or compatibility with every CLI version. POSIX process-group cleanup is covered;
native Windows cleanup is still unverified/best-effort. Existing-session OpenCode
handoff and durable delivery receipts remain open in
[issue #18](https://github.com/NosytLabs/agent-office/issues/18).
See the [runner contract](../local-task-runner.md).

**VS Code packaging is not extension-host verification.** Earlier VSIX packaging
and simulated-API/real-HTTP tests passed. Actual installation, activation, remote
forwarding, and authentication still need a working VS Code host. Physical
mobile devices and Safari/iOS were not independently exercised in this cleanup.

**Usage and task data remain observations.** Missing counters stay unknown;
runtime costs are estimates, not invoices. A completed session does not complete
its task list. Recent capture replays have bounded memory; a previously unseen
capture without a source clock follows receipt order. See
[usage and task contracts](../runtime-observers.md).

**Retention is not a whole-directory quota.** Raw history uses the configured
count/age/byte limits. Compact accounting and unresolved prompts survive pruning;
usage identities can grow, pending offline inbox files remain, and legacy JSONL
files are read-only. Invalid/unavailable retention settings suspend pruning.
Settings locks protect cooperating local servers, not arbitrary external editors,
network filesystems, or power-loss durability. See
[storage and maintenance](../architecture.md#storage-and-retention).

**Diagnostics are separate from event history.** Repeated hook-publish failures
emit at most one warning per minute per process, with a suppressed-count summary
on the next warning. Raw exception messages and event bodies are not included in
that warning. All event attempts still occur, and logging failures cannot escape
into the agent loop. This is not a global quota on external service logs; see
[diagnostics and safe cleanup](../architecture.md#diagnostic-logs-and-safe-cleanup).

## Source and asset review

The dated [current reference review](../reference-review-2026-10-15.md) preserves inspected
sources and reuse decisions. It is background, not the current feature backlog.
Automatic orchestration, agent hiring, and answering permission prompts are not
implemented by copying a product description.

Original artwork and licenses are preserved. The public aquarium uses original
fish; the owner's optional commercial Smallburg pack is installed outside Git.
Duck Hunt package metadata is not a separate license for its artwork/audio.
Consult [arcade provenance](../arcade.md), [sprite provenance](../../web/assets/sprites/ATTRIBUTION.md),
[font/icon/runtime marks](../../web/assets/ATTRIBUTION.md), and
[optional aquarium artwork](../aquarium-assets.md).
