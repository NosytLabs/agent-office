# Historical validation index

[Validation and integration limits](README.md) · [Documentation](../README.md)

Earlier reports are preserved in Git rather than repeated as current status.
Their counts, runtime versions, deployment observations and integration limits
belong to the stated revision and environment. Statements about CI being disabled
describe those earlier runs, not the current workflow.

## Release records

| Period or scope | Preserved evidence |
| --- | --- |
| UI/pages validation recorded on 18 October, before the panel fixes | [Validation page before this documentation cleanup](https://github.com/NosytLabs/agent-office/blob/2fbd6fcc0c8730522523a7634724710927bfee08/docs/audit/README.md) |
| 8–12 October reports: arcade baseline, integrity-branch reconciliation, local task control, console and worker-startup review, aquarium, storage and 0.5.0 UI checks | [Detailed historical reports](https://github.com/NosytLabs/agent-office/blob/2fbd6fcc0c8730522523a7634724710927bfee08/docs/audit/history.md) |
| Original pre-cleanup report for the 12 October baseline | [Report at `923196d`](https://github.com/NosytLabs/agent-office/blob/923196dee3b55d8d08335b9f4dc67cf3c4558bec/docs/audit/README.md) |

The local-runner reports used temporary executable fixtures; the native Gemini
checks used an explicitly selected CLI with a synthetic loopback provider. Neither
establishes paid-provider execution. Read [current integration limits](README.md#integration-limits)
before applying an old result to a new runtime or host.

## Source reviews

- [7–8 October comparison](../reference-review-2026-10-07.md): inspected runtime
  contracts, product comparisons, source/reuse decisions and the original plan.
- [15 October review](../reference-review-2026-10-15.md): pinned source mechanisms
  behind navigation, attention, recap, artwork and saved-brief improvements.

These are dated research records. Current user behavior belongs in the linked
feature guides, and outstanding work belongs in
[GitHub issues](https://github.com/NosytLabs/agent-office/issues), including the
deferred [OpenCode session-handoff issue](https://github.com/NosytLabs/agent-office/issues/18).
Repository source inspection and publisher claims remain distinct from running
an upstream application. Source links do not grant rights to redistribute artwork.

## Future updates

Update the existing [validation record](README.md) with a named commit, exact
checks, exercised environment and limits. Preserve superseded narratives with a
commit-pinned link here. Keep raw logs and temporary screenshots in ignored
development output; see [documentation maintenance](../../CONTRIBUTING.md#maintain-the-documentation).
