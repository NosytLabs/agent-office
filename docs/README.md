# Agent Office documentation

Start with the [repository quick start](../README.md#start-locally). The local
observer and the public demo look similar, but only the local observer connects
to your runtime data. Demo activity is synthetic.

## Use the office

[Installation and troubleshooting](setup.md) · [Usage and cost semantics](usage.md)

| Task | Guide |
| --- | --- |
| Connect Hermes, OpenCode, Codex, Claude, or Gemini reporting | [Runtime coverage and contracts](runtime-observers.md) |
| Save, find, review and reuse a task brief | [Browser-local saved briefs](task-briefs.md) |
| Start a fresh Codex or Claude task locally | [Optional local runner](local-task-runner.md) |
| Play Duck Hunt, Breakout, or Snake | [Arcade controls and recovery](arcade.md) |
| Feed or greet fish, choose artwork, and install a local licensed pack | [Aquarium assets and care](aquarium-assets.md) |
| Share or deploy the synthetic demonstration | [Public preview](preview.md) |
| Arrange furniture, toggle lights, or choose agent appearances | [Room features](../README.md#activity-usage-and-room-controls) |
| Choose room finishes, characters, companions and animation options | [Studio artwork](studio-art.md) |
| Preview or export a native sprite or animation strip | [Studio gallery and tools](studio-tools.md) |
| Find diagnostics, manage storage or clean generated files | [Logs and maintenance](maintenance.md) |

## Maintain the project

[Contributing](../CONTRIBUTING.md) covers development checks and source contracts.
[Architecture](architecture.md) describes tracking, storage, and UI boundaries.
[Logs and maintenance](maintenance.md) separates event retention, service logs,
browser storage and disposable build/test output.
[The asset pipeline](asset-pipeline.md) explains compact sprites, source artwork,
and pixel-equivalence checks.

[Validation and limitations](audit/README.md) records commit-specific evidence.
[Historical reports](audit/history.md), the [7–8 October comparison](reference-review-2026-10-07.md)
and the [15 October reference review](reference-review-2026-10-15.md) are background
records, not a current feature backlog. Test totals always belong
to the named commit and environment. A successful deployment is not a substitute
for passing the tests.
