# Sources and reuse boundaries

[Documentation](README.md) · [Asset pipeline](asset-pipeline.md)

Agent Office combines a local observer with a separately enabled fresh-process
runner. Reference products inform interaction ideas; they are not dependencies,
proof of supported features, or permission to redistribute their artwork.
Current behavior belongs in the feature guides, not in a comparison backlog.

## Shipped source and attribution

Keep the project [MIT license](../LICENSE), [asset notices](../web/assets/ATTRIBUTION.md),
[sprite provenance](../web/assets/sprites/ATTRIBUTION.md), and
[Duck Hunt modification record](arcade.md#duck-hunt) with their code/assets.
Those records identify the actual inputs, local modifications, source revisions
and redistribution boundaries. Runtime marks and fonts retain their own notices.
Optional commercial Smallburg artwork is local-only and is not published.

Original sheets and the pinned Duck Hunt authoring bundle remain reproducibility
inputs. They are not dead assets: pixel checks and the patch verifier need them;
Classic sheets also provide the documented runtime fallback. Studio source-only
inputs stay out of public builds. See the [asset pipeline](asset-pipeline.md).

## Design references

| Reference | Boundary retained here |
| --- | --- |
| [Pixel Agents HQ](https://github.com/pixel-agents-hq/pixel-agents), [Hootbu Pixel Agents](https://github.com/hootbu/pixel-agents) | Scene, layout and agent-state ideas. Imported art is governed by the shipped notices, not by a blanket assumption that all upstream art is reusable. |
| [Harish Kotra Agent Office](https://github.com/harishkotra/agent-office), [AgentSystemLabs](https://github.com/AgentSystemLabs/agent-office), [Habblaud](https://github.com/marmottajr/habblaud) | Task identities, bounded output and explicit process ownership. Reported tasks, local runs and cosmetic characters remain separate. |
| [Termi](https://termiprotocol.com/), [BridgeMind](https://www.bridgemind.ai/) | Workspace and task-preparation references. Marketing descriptions do not establish reusable application source or verified local behavior. |
| [Star Office UI](https://github.com/ringhyacinth/Star-Office-UI) and other reviewed rooms | Check code and artwork rights separately; use the assets covered by this repository's own source records. |

This cleanup imports no new third-party code or art. The runtime contracts are
maintained in [observer coverage](runtime-observers.md) and
[local task runner](local-task-runner.md), not inferred from reference products.
Existing-session OpenCode delivery is tracked separately in
[issue #18](https://github.com/NosytLabs/agent-office/issues/18).

## Historical research

The detailed comparisons remain available at their last pre-cleanup revision:

- [7–8 October source and reuse review](https://github.com/NosytLabs/agent-office/blob/7266c771e173cb53495c08157047d682b38ccb56/docs/reference-review-2026-10-07.md)
- [15 October implementation review](https://github.com/NosytLabs/agent-office/blob/7266c771e173cb53495c08157047d682b38ccb56/docs/reference-review-2026-10-15.md)
- [21 October runtime and workflow review](https://github.com/NosytLabs/agent-office/blob/7266c771e173cb53495c08157047d682b38ccb56/docs/reference-review-2026-10-21.md)

These are dated records of source inspection, not claims about today's upstream
versions or successful provider-backed execution. New behavior and unresolved
work belong in maintained guides and GitHub issues; do not append another audit
narrative to the checkout.
