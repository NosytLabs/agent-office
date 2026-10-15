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

## Maintain the project

[Contributing](../CONTRIBUTING.md) covers development checks and source contracts.
[Architecture](architecture.md) describes tracking, storage, and UI boundaries.
[Diagnostics and safe cleanup](architecture.md#diagnostic-logs-and-safe-cleanup) separates
event retention, service logs, and disposable build/test output.
[The asset pipeline](asset-pipeline.md) explains compact sprites, source artwork,
and pixel-equivalence checks.

[Validation and limitations](audit/README.md) records release-specific evidence;
[historical reports](audit/history.md) and the [earlier source comparison](reference-review-2026-10-07.md)
are background records, not a current feature backlog. Test totals always belong
to the named commit and environment. A successful deployment is not a substitute
for passing the tests.
