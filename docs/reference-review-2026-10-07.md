# Reference review — 7 October 2026

This review identifies concrete additions for Agent Office's local observer. It is a research and implementation recommendation, not a claim that the features below have shipped. Sources were read through GitHub, Firecrawl, and Context7; source code links are pinned where a revision was available. No third-party code or artwork was imported by this research step.

## Recommended implementation order

| Priority | Addition | Bounded implementation | Acceptance evidence |
| --- | --- | --- | --- |
| 1 | Real runtime usage | Observe OpenCode completed assistant messages and Hermes completed API requests. Store source identity, model, token buckets, and cost provenance. Extend the existing Usage panel, inspector, and CSV. | Duplicate message snapshots and restart do not increase totals; unsupported usage is unavailable; zero remains a valid reported value. |
| 1 | Codex CLI integration | Add a small lifecycle hook adapter and an optional reader for an existing `codex exec --json` stream. Keep launching, prompting, approvals, and model selection in Codex. | Session, tool, permission, subagent, interrupt, and completion fixtures; structured usage stream fixtures; hook errors produce no control decisions. |
| 2 | Actual observed task lists | Consume OpenCode `todo.updated` and Codex `todo_list` items. Replace each source's current task snapshot and show its session and freshness. | Repeated snapshots do not duplicate tasks; completed, cancelled, and removed items reconcile correctly. |
| 2 | Useful furniture interactions | Planning board opens observed tasks; server rack opens Usage; printer opens the existing export action. Add keyboard-accessible equivalents and visible interaction labels. | Canvas and keyboard routes open the same existing functions; arranging furniture still takes precedence over interaction. |
| 3 | Optional earned animations | Tie a lamp glow, coffee animation, or pet interaction variant to existing recorded milestones. Preserve all already-placeable props and keep the normal navigation available. | Unlocks survive reload and migration; replaying events cannot earn rewards twice; reduced-motion behavior remains respected. |
| 3 | Context display with known limits | Show the latest reported context snapshot separately from lifetime usage. Show a percentage only when the runtime supplies a verified context limit. | Compaction can lower the context gauge without lowering lifetime usage; unknown limits do not become invented percentages. |

The furniture and reward choices above are proposed product decisions. They reuse this repository's generated assets and existing panels rather than requiring an agent execution service.

## Runtime contracts and accounting

### OpenCode

The official [plugin event documentation](https://opencode.ai/docs/plugins/#events) includes `message.updated`, `message.part.updated`, and `todo.updated`. Both inspected SDK generations expose assistant message identity, model/provider, completion time, token buckets, and `cost`: [V1 schema](https://github.com/anomalyco/opencode/blob/a697115b203395c54a7496dc3d1863fe7b319c0c/packages/sdk/js/src/gen/types.gen.ts), [V2 schema](https://github.com/anomalyco/opencode/blob/a697115b203395c54a7496dc3d1863fe7b319c0c/packages/sdk/js/src/v2/gen/types.gen.ts).

Consume `properties.info` when `role` is `assistant` and `time.completed` is present. Use `(runtime, sessionID, message id)` as the usage identity; repeated updates are snapshots of the same message. Do not count both message-level totals and the constituent `step-finish` parts. V2 also supplies an optional `tokens.total` and top-level event IDs; tolerate their absence in older payloads.

The [actual normalization and cost function](https://github.com/anomalyco/opencode/blob/a697115b203395c54a7496dc3d1863fe7b319c0c/packages/opencode/src/session/session.ts) subtracts cached tokens from `tokens.input` and reasoning tokens from `tokens.output`. Its buckets are therefore disjoint. Cost is calculated from runtime pricing/model metadata, with a zero fallback for missing prices. Label this **runtime cost estimate**, not an invoice or proof that a request was free.

`todo.updated` supplies `properties.sessionID` and a complete `todos` array containing `content`, `status`, and `priority`. The inspected V2 `Todo` type has no item ID. Treat that array as one replaceable source snapshot instead of assigning identity by title alone. The statuses described in the schema include pending, in progress, completed, and cancelled.

### Hermes

Current [observer-hook documentation](https://hermes-agent.nousresearch.com/docs/developer-guide/observer-hooks) exposes `post_api_request`, stable `api_request_id`, runtime/model information, timing, and normalized usage. `pre_api_request` and `api_request_error` provide the matching start/failure boundaries. Auxiliary model calls have separate hooks and must have an explicit coverage label if omitted.

The [hook implementation](https://github.com/NousResearch/hermes-agent/blob/c538ec5f402e8078248becacd474e47a08c6e79a/agent/api_request_hooks.py) supplies canonical token data without requiring the observer to inspect the raw model response. The [canonical usage model](https://github.com/NousResearch/hermes-agent/blob/c538ec5f402e8078248becacd474e47a08c6e79a/agent/usage_pricing.py) defines `prompt_tokens` as uncached input plus cache reads and writes; `total_tokens` adds output. Reasoning is a reported detail within output, not an extra total to add again. The canonical usage object does not itself supply a billed dollar amount.

Feature-detect newly supported hooks on older Hermes installations. Existing lifecycle observation must continue if richer telemetry is unavailable. Accept additive keyword fields and publish only the needed metadata and counters.

### Codex

The current official [hooks documentation](https://learn.chatgpt.com/docs/hooks) is the destination of the former `developers.openai.com/codex/hooks` URL. It documents lifecycle, tool, permission, subagent, stop, and interrupt events; hook JSON includes session/model information and event-specific identifiers. User hooks require review through `/hooks`. Background hooks can finish out of order, are cancelled at session end, and cannot control the triggering action; `SessionEnd` remains synchronous.

`PermissionRequest` does not document `tool_use_id`, unlike the pre/post tool hooks. Preserve available turn and tool information without inventing a call identity or an approval outcome. Keep observer output empty and successful; never emit prompt context, permission decisions, or result replacements. The documentation explicitly describes transcript format as unstable.

For structured usage, [non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) documents `codex exec --json` and `turn.completed.usage`. The official [event types](https://github.com/openai/codex/blob/main/sdk/typescript/src/events.ts) include input, cached input, output, reasoning output, and a newer cache-write field. The [item types](https://github.com/openai/codex/blob/main/sdk/typescript/src/items.ts) include command executions, file changes, MCP calls, web searches, and `todo_list`. This supports a stream observer without turning Agent Office into a CLI launcher. Select one lifecycle source when hooks and a stream describe the same run.

An optional interactive usage fallback can follow the narrow approach in [AgentSystemLabs' Codex reader](https://github.com/AgentSystemLabs/agent-office/blob/7f7211ea1050c8206afc6a354d56437da7654e2b/src/server/codex-usage.ts): read only an explicitly hooked transcript, validate its session header and location, use bounded reads, and extract cumulative counters. Treat it as version-tested compatibility, not a stable Codex API. It reports cost as unavailable and excludes subagents from its root-session totals.

### Keep source semantics distinct

| Source | Token total | Cost treatment |
| --- | --- | --- |
| OpenCode normalized message | Input + output + reasoning + cache read + cache write; retain an explicit source total when available | Runtime estimate; zero may reflect missing pricing |
| Hermes canonical API usage | Input + cache read + cache write + output; reasoning is already represented within output | Unavailable unless a separately identified cost source supplies it |
| Codex structured usage | Input + output; cached input and reasoning output are subtotals | Unavailable from the documented usage event |

Usage records should retain source identity, aggregation scope (message, API attempt, turn, or cumulative session), model/provider, observation time, and completeness. Unknown values must remain distinguishable from numeric zero. Session-wide cumulative snapshots must replace their predecessor rather than be added repeatedly. Preserve corrections and replay behavior in the same durable transaction as the event receipt.

## Reference projects and reuse decisions

| Reference | Specific useful evidence | Reuse decision |
| --- | --- | --- |
| [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents/blob/main/README.md) | [Provider contract](https://github.com/pixel-agents-hq/pixel-agents/blob/3537e140c2094761beae748592aeb92ece8edfdd/core/src/provider.ts) separates normalization, capabilities, and presentation. [Context usage](https://github.com/pixel-agents-hq/pixel-agents/blob/3537e140c2094761beae748592aeb92ece8edfdd/server/src/contextUsage.ts) distinguishes current context from a running usage total. [Asset manifests](https://github.com/pixel-agents-hq/pixel-agents/blob/main/docs/external-assets.md) describe state and animation groups. | [MIT code](https://github.com/pixel-agents-hq/pixel-agents/blob/main/LICENSE), with notices retained for copied portions. Independently adapt the provider and animation concepts. Check separate artwork provenance before adding assets. |
| [Harish Kotra AgentOffice](https://github.com/harishkotra/agent-office/blob/main/README.md) | [TaskBoard](https://github.com/harishkotra/agent-office/blob/58f11f9b31770c10bcf3d7a0618325d22bd0ee9e/packages/ui/src/components/TaskBoard.tsx) combines status, assignment, and task cards. | [MIT code](https://github.com/harishkotra/agent-office/blob/main/LICENSE). Adopt readable observed task cards; its task dispatch, autonomous hiring, and inference loop are outside this observer. Avoid its title-based task identity. |
| [AgentSystemLabs Agent Office](https://github.com/AgentSystemLabs/agent-office/blob/main/README.md) | Bounded Codex usage reader and explicit known/unavailable usage coverage in [provider metadata](https://github.com/AgentSystemLabs/agent-office/blob/7f7211ea1050c8206afc6a354d56437da7654e2b/src/shared/providers.ts). | [MIT code](https://github.com/AgentSystemLabs/agent-office/blob/main/LICENSE). Useful accounting and compatibility patterns; terminal hosting and account management are a different product scope. |
| [thepixeloffice.ai](https://thepixeloffice.ai/) | A live landing page presents role-oriented office scenes and autonomous-workforce marketing. | Visual reference only. No reusable source or artwork license was established by the page. Do not treat marketing claims as implemented capabilities here. |
| [Sahni Agents Office](https://github.com/ajsahni/agents-office) | Previously cited setup direction. | [PolyForm Noncommercial plus extra restrictions](https://github.com/ajsahni/agents-office/blob/main/LICENSE) prohibit rebundling into another agent product and constrain rebranding. Do not import its code or assets. |
| [Star Office UI](https://github.com/ringhyacinth/Star-Office-UI) | Previously cited setup and session-status direction. | [License separates MIT logic from noncommercial artwork](https://github.com/ringhyacinth/Star-Office-UI/blob/master/LICENSE). Keep any future code attribution separate; use this project's generated art. |

## Additional product references

**Claw3D.** The [feature page](https://www.claw3d.ai/#features) links its public
[repository](https://github.com/iamlukethedev/Claw3D), whose
[license](https://github.com/iamlukethedev/Claw3D/blob/main/LICENSE) is MIT,
copyright Luke The Dev, 2026. Its
[README](https://github.com/iamlukethedev/Claw3D/blob/main/README.md) describes
camera follow, office layouts, runtime-backed activity, and interactive
workflows. The inspected
[event-trigger module](https://github.com/iamlukethedev/Claw3D/blob/main/src/lib/office/eventTriggers.ts)
separates temporary animation cues from durable session/approval state before
the scene consumes them. That separation is useful here: an animation may
finish while an unanswered approval remains visible. A follow-selected-agent
camera is another compatible addition. Keep these as independently
implemented observer features; Claw3D's agent chat, task dispatch, session
reset, and approval controls belong to its different runtime architecture.
No Claw3D code or models were imported. Any later copied portions need MIT
notice retention and a separate check of its third-party asset inventory.

**Javier Mancilla Montero's LinkedIn post.** The public
[user-supplied post](https://www.linkedin.com/posts/mancillamontero_ai-agents-localllm-activity-7453426180398997504-aO3_)
was accessible through web retrieval; Firecrawl reported that the site was
unsupported. The author describes a local Ollama/Qwen NPC dialogue prototype,
per-character presentation, and saved rooms, avatars, and inventory atop a
modified `bobba_client`. The post describes agent jobs and coordination as
future work. It does not establish that those capabilities already work or
grant redistribution rights to the modified client or its artwork. Useful
concepts for this observer are recognizable individual agents, click-to-inspect
interaction, and persistent decorating. Importing a conversational runtime or
Habbo-style asset collection is not required for those concepts.

**SVGL's AI directory.** The requested
[directory](https://svgl.app/directory/ai) provides SVG variants for brands
including Codex, OpenCode, and Anthropic. Its linked project publishes an
[MIT license](https://github.com/pheralb/svgl/blob/main/LICENSE), copyright Pablo
Hdez, 2022, and its
[README](https://github.com/pheralb/svgl/blob/main/README.md) describes light/dark
variants, `viewBox` preservation, and optional brand-guideline links. It is a
useful asset source with attributable repository provenance, rather than a
substitute for each brand owner's trademark rules. When vendoring a selected
file, retain its precise source URL, checksum, repository license notice, and
brand attribution; use the mark to identify a runtime without implying
affiliation. Do not recolor or pixel-reinterpret a mark where its owner's
guidelines prohibit alterations. This review did not itself import icon files.

### Brand-specific source checks

- [OpenAI's official brand page](https://openai.com/brand/) supplies assets and usage terms. Use an unmodified provided mark only to identify the related integration, with attribution and clear space, subordinate to Agent Office's own identity. Do not create a pixel-art reinterpretation and call it official.
- [OpenCode's official brand page](https://opencode.ai/brand) publishes light/dark and square logo assets. Prefer those original variants, recording the downloaded file's source and checksum. Its [repository license](https://github.com/anomalyco/opencode/blob/a697115b203395c54a7496dc3d1863fe7b319c0c/LICENSE) is MIT; copyright licensing does not establish affiliation.
- The attempted `anthropic.com/brand` URL returned 404. The implementation uses the unmodified Claude icon distributed by the MIT-licensed SVGL collection, with its exact source, checksum, and notice recorded in [the asset credits](../web/assets/ATTRIBUTION.md). This is collection provenance, not a claim of an additional trademark grant or Anthropic endorsement. Hermes remains a text label because a suitable asset source was not verified.

## Implementation outcome

The review led to durable per-source usage accounting, a Codex lifecycle and
captured-stream adapter, a shared-dashboard VS Code view, and independently
implemented room interactions and earned animations. See [runtime support and
coverage](runtime-observers.md) and [the architecture](architecture.md) for the
contracts that shipped. The imported SVGL marks have exact source checksums;
new furniture and fallback fish use original generated art.

Source TODO snapshots, current-context gauges, follow-agent camera controls,
and additional Gemini CLI, Aider, Cursor, and Copilot CLI adapters remain
future work. The Tasks panel shows observed session activity; it does not claim
to import a runtime's full task list. No new upstream repository was forked or
rebundled during this implementation.

## Repository inventory

Read-only GitHub connector queries on 7 October 2026 returned **no open pull requests**, **no open issues**, and **one branch, `main`**, for [NosytLabs/agent-office](https://github.com/NosytLabs/agent-office). The branch listing was paginated through an empty final page. This is a point-in-time inventory, not permission or a recommendation to merge future changes without reviewing them.

## Tests to carry into implementation

Test recorded source payloads from each supported schema, repeated usage snapshots, same-timestamp and older-timestamp delivery, a restart between report and cleanup, and missing or malformed usage. Verify cached/reasoning tokens are not counted twice, a model switch keeps separate attribution, and costs retain their provenance. For observed task lists, test a full replacement with removed and cancelled items. For furniture, test touch, mouse, keyboard, editor precedence, focus restoration, and reduced motion. These additions must retain the existing observer-only hook contract.
