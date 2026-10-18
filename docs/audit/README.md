# Validation and integration limits

[Documentation](../README.md) · [Development checks](../../CONTRIBUTING.md#checks) · [Historical evidence](history.md)

Tests use synthetic activity and isolated data folders. Their results establish
the exercised contracts, not paid-provider work or the owner's live sessions.

## Verified application snapshot — 18 October 2026

These results belong to commit
[`2fbd6fc`](https://github.com/NosytLabs/agent-office/commit/2fbd6fcc0c8730522523a7634724710927bfee08).
[PR #39](https://github.com/NosytLabs/agent-office/pull/39) fixed crowded HUDs,
landscape panels, diagnostics focus and stale Copy feedback.
[PR #40](https://github.com/NosytLabs/agent-office/pull/40) allowed slow optional
artwork downloads to finish. [PR #41](https://github.com/NosytLabs/agent-office/pull/41)
corrected timing-dependent browser assertions without changing the application.

| Check | Recorded result |
| --- | --- |
| [Final PR CI](https://github.com/NosytLabs/agent-office/actions/runs/39148888553) and [merged main CI](https://github.com/NosytLabs/agent-office/actions/runs/39149806699) | Passed on their exact commits |
| Python on Ubuntu 24.04 / Python 3.13 | **686 passed**, 8 optional/platform-specific skips |
| Node 22 models, controllers and bridges | **182 passed** |
| Complete browser command | **383 passed**, 1 optional private-art skip; Original 273 + Studio 110 |
| Syntax, formatting, sprite reproduction, public builds and repository hygiene | Passed |
| Production smoke | 1440, 768, 601, 390 and 320px flows, plus a 667 × 320px landscape panel; no page errors or failed resources |
| Published output | 30 checked files matched the tested application; 3 authoring paths returned 404 |

The five fresh-browser production flows loaded every supplemental artwork pack
without Retry. They exercised actual command copying, delayed setup-copy
feedback, settings persistence, draft retention, Back/Escape and unchanged
synthetic activity/accounting. The last merge changed only two tests; the
published application was checked against the same verified source.

Counts describe this snapshot, not every later commit. Check a newer revision's
actual [CI run](https://github.com/NosytLabs/agent-office/actions/workflows/ci.yml)
and deployment separately. A successful deployment does not establish a test pass.

## Reproduce the checks

Follow [the development setup and complete checks](../../CONTRIBUTING.md#development-setup).
The full browser gate is `npm run test:browser`, which runs both compatibility
and Studio flows. Focused passes do not replace that complete release check.

Stage intended new source files before running `python3 tools/check_repository.py`.
It reads tracked working files and the Git index, checks local Markdown links and
anchors, rejects generated/local-only artifacts and conflict markers, and rejects
unsafe symlinks before reading their targets. It does not delete data, validate
external websites or scan arbitrary file contents for secrets.

Both [CI](../../.github/workflows/ci.yml) and
[repository hygiene](../../.github/workflows/hygiene.yml) run for every PR and push
to main, including documentation-only changes. Full CI uses the runner's maintained
Chrome, allows 20 minutes, and retains browser artifacts for three days after
failed or manual runs. Keep raw logs and temporary reports outside Git; see
[logs and maintenance](../maintenance.md#keep-development-output-out-of-git).

<a id="automated-coverage"></a>

## Integration limits

| Area | Coverage and practical limit |
| --- | --- |
| Observation, persistence and accounting | Event inbox/store, reset/replay, retention, usage and task-model tests use isolated local data. Reported usage is an estimate; missing counters remain unknown. See [runtime contracts](../runtime-observers.md). |
| UI and artwork | Real HTTP/browser flows cover panels, focus, drafts, settings conflicts, room controls, sprite fallback/retry, exports, arcade and aquarium. See the browser commands in [package.json](../../package.json). Physical mobile devices and Safari/iOS were not independently exercised. |
| Runtime adapters | Fixture-tested here. The optional native Gemini fixture targets a specific installed version and synthetic loopback provider; it does not prove paid-provider success. Authenticated Hermes, Claude Code, Codex and OpenCode sessions were not verified by this snapshot. |
| Local task runner | Temporary Codex/Claude-shaped executables exercise admission, prompts, output, cancellation and retry contracts. They do not prove credentials, model access or useful task completion. Native Windows cleanup remains best-effort/unverified. See [runner limits](../local-task-runner.md). |
| VS Code | Packaging, simulated APIs and real HTTP checks are separate from actual extension-host installation, activation and remote-forwarding verification. See [the extension guide](../../vscode/README.md). |
| Clipboard | Browser checks cover successful copies, denied/delayed responses and preserved selection/focus. Real operating-system permission prompts were not exercised. |
| Logs and cleanup | Publication failures, bounded warnings, redaction and broken log handlers are covered by `test_observer_logging.py`. The repository checker has isolated Git-index tests in `test_repository_hygiene.py`. See [maintenance](../maintenance.md) for storage and log boundaries. |

Existing-session OpenCode handoff and durable delivery receipts remain deferred in
[issue #18](https://github.com/NosytLabs/agent-office/issues/18). Fresh local tasks,
observed task lists and saved briefs do not implement that adapter. Dated
[reference reviews](history.md#source-reviews) preserve research and reuse decisions;
they are not proof that upstream software ran here or that a proposed feature shipped.

## Interface evidence

The maintained captures use synthetic data. They illustrate the interface;
the commit-specific checks above establish the recorded verification.

| View | Capture |
| --- | --- |
| Office and characters | [Studio office](../screenshots/studio-office.png), [appearance](../screenshots/appearance.png), [personalization](../screenshots/personalization.png) |
| Activity and usage | [Usage](../screenshots/usage.png), [Gemini fixture inspector](../screenshots/gemini-mobile.png) |
| Settings and narrow layouts | [Settings](../screenshots/settings.png), [keyboard focus](../screenshots/keyboard-settings.png), [long mobile title](../screenshots/long-office-name-mobile.png) |
| Props and lighting | [Task signals](../screenshots/signals.png), [mobile signals](../screenshots/signals-mobile.png), [pet bed](../screenshots/pet-bed.png), [room toys](../screenshots/office-toys.png), [lights](../screenshots/room-lights.png) |
| Arcade and aquarium | [Duck Hunt](../screenshots/arcade-duck-hunt.png), [Breakout](../screenshots/arcade-breakout.png), [Snake desktop](../screenshots/arcade-snake-desktop.png), [Snake mobile](../screenshots/arcade-snake-mobile.png), [fish](../screenshots/aquarium.png), [tank controls](../screenshots/aquarium-interactions.png) |
| Local run fixtures | [Form](../screenshots/local-runs-desktop.png), [output](../screenshots/local-runs-output.png), [mobile output](../screenshots/local-runs-mobile.png), [console](../screenshots/task-console-running.png) |
| Product website | [Product introduction](../screenshots/product-site.png) |

## Source and asset review

Project code, runtime marks, fonts, games and artwork have separate source notices.
Keep [asset notices](../../web/assets/ATTRIBUTION.md),
[sprite provenance](../../web/assets/sprites/ATTRIBUTION.md) and
[arcade provenance](../arcade.md) with their assets. The optional licensed
[Smallburg aquarium pack](../aquarium-assets.md) is not distributed in Git.
