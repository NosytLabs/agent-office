# Validation and integration limits

[Documentation](../README.md) · [Development checks](../../CONTRIBUTING.md#checks)

## Verify a revision, not a headline count

A green deployment only proves the static build deployed. For a release, inspect
the exact commit's [CI run](https://github.com/NosytLabs/agent-office/actions/workflows/ci.yml),
[hygiene run](https://github.com/NosytLabs/agent-office/actions/workflows/hygiene.yml),
and deployed commit separately. A PR's tested merge tree must match the source
actually merged. Test totals belong in that PR or CI run, not in a stale table here.

Follow [development setup](../../CONTRIBUTING.md#development-setup), then run:

```sh
python3 tools/check_repository.py
python -m pytest -q
npm test
npm run check
npm run format:check
npm run check:sprites
npm run build:preview
npm run test:browser
```

Stage intended new source files before hygiene checks. The checker reads tracked
working files and the Git index; it does not delete user data, validate external
websites, or scan arbitrary contents for secrets. Both browser suites are required;
a passing focused case is not a replacement for the full release gate.

CI uses isolated data and the runner's maintained Chrome. It retains reports for
three days after failed or manually dispatched runs. For a local visual review:

```sh
OFFICE_SCREENSHOTS=reports/screenshots npm run test:browser
```

Inspect representative desktop, narrow-phone, landscape, keyboard-focus, failure
and recovery captures. Generated screenshots are not automatically a visual review.
Never commit live account data; keep reports outside Git. See
[logs and cleanup](../maintenance.md#keep-development-output-out-of-git).

<a id="automated-coverage"></a>

## Integration limits

| Area | What the checks establish |
| --- | --- |
| Observation and accounting | Synthetic inbox/store, reset/replay, retention, usage and task identities in isolated data. Unknown counters remain unknown. [Runtime coverage](../runtime-observers.md). |
| Office and artwork | HTTP/browser flows cover panels, drafts, focus, settings conflicts, room controls, sprites, recovery, gallery exports, games and aquarium. Chromium is not independent Safari/iOS or physical-device verification. |
| Local CLI runs | Temporary executables and process doubles cover admission, literal prompts, output, cancellation and in-memory retries. They do not establish installed versions, credentials, provider access or useful task completion. Native Windows cleanup remains best-effort. [Runner contract](../local-task-runner.md). |
| Runtime integrations | Hook fixtures establish only the named contract. Optional native Gemini tests use a selected CLI and synthetic loopback provider, not a paid account. Label any installed-runtime/provider smoke test separately. |
| VS Code | Simulated APIs, packaging and HTTP checks are not actual extension-host activation or remote forwarding. [Extension guide](../../vscode/README.md). |
| Product website | Static build tests cover public-only assets, canonical/social metadata, sitemap, configured URLs and link targets. Browser flows cover no-JavaScript content, setup, copy, tabs and responsive layouts. Metadata is not proof of indexing or ranking. |

## Open investigations

- [Issue #56](https://github.com/NosytLabs/agent-office/issues/56): remaining historical
  restart-readiness and observer delays. Reproduce the failing boundary and keep
  diagnostic evidence; do not close it just because an isolated rerun passed.
- [Issue #18](https://github.com/NosytLabs/agent-office/issues/18): existing-session
  OpenCode handoff and durable delivery receipts. Fresh CLI runs, saved briefs and
  downloaded output snapshots do not implement this capability.

## Documentation images and source records

The [Studio overview](../screenshots/studio-office.png) and product-site screenshots
are synthetic examples, not today's production state. Four original captures
(appearance, usage, settings and aquarium) remain inputs to the checked responsive
image pipeline. Source-art/provenance captures also remain where generation records
reference them. One-off historical UI screenshots are available in Git rather
than carried as current documentation.

Keep the [asset notices](../../web/assets/ATTRIBUTION.md),
[sprite provenance](../../web/assets/sprites/ATTRIBUTION.md),
[asset pipeline](../asset-pipeline.md), and [source/reuse guide](../references.md).

Historical validation records and removed captures remain available in the
[pre-cleanup audit directory](https://github.com/NosytLabs/agent-office/blob/7266c771e173cb53495c08157047d682b38ccb56/docs/audit/README.md) and
[its history index](https://github.com/NosytLabs/agent-office/blob/7266c771e173cb53495c08157047d682b38ccb56/docs/audit/history.md).
