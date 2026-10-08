# Reference review — 7–8 October 2026

This review separates implemented additions from remaining recommendations for Agent Office's local observer. Sources were read through GitHub, Firecrawl, and Context7; source code links are pinned where a revision was available. No third-party code or artwork was imported by this research step.

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

### Implementation outcome

| Area | Current state |
| --- | --- |
| Runtime usage and Codex observation | Implemented with source-aware accounting, lifecycle hooks, and the optional captured Codex stream reader. [Runtime coverage](runtime-observers.md) distinguishes supported fields from unknown values and installation limits. |
| Storage and settings correctness | Implemented separate history/inbox/cleanup/temporary/ledger measurements, unknown values for failed measurements, fair durable read retries, and legacy I/O preservation. Revisioned settings writes reject stale clients and preserve corrupt files; automatic retention suspends when the saved policy is unavailable or explicitly invalid. See [architecture contracts](architecture.md). |
| Office interactions and earned content | Implemented 26 furniture choices, aquarium feeding/species, original music, earned room props, and individual desk/appearance preferences. New task terminals and attention beacons open existing task views; pet beds supply reserved rest targets and open pet settings; ferns are decoration. Rewards follow observed counters; animation does not create work records. |
| Hootbu-inspired quality-of-life changes | Implemented per-agent usage summaries, safe view persistence, panel return context, stable desk choices, character selection, and roaming cats using this project's own state and assets. See the source-by-source decisions below. |
| Product website | Implemented a separate allowlisted static site, accessible feature tour, setup commands, and credits. [Hosting instructions](preview.md) cover the public demo and the owner-controlled GitHub Pages activation step. |
| Observed source TODO snapshots | Implemented from OpenCode `todo.updated` and captured Codex `todo_list` events, with atomic replacement, runtime/session identity, explicit source-time coverage, bounded checkpoint persistence, and a read-only renderer. Unreported coverage, an explicitly empty list, and historical reports remain distinct. |
| Follow-agent camera | Implemented an explicit inspector control with bounded pan and clean cancellation. Three native browser flows verified panel persistence, manual controls, accounting preservation, and real observer session-end/fade/despawn behavior using synthetic event fixtures. |
| Current-context gauge | Still future work. Cumulative token usage is not a measurement of current context, and an unknown model limit is not inferred. |

[Validation evidence](audit/README.md) records tested flows and the remaining installed-runtime and VS Code host checks. The sections below retain the checked source contracts and explain why some reference capabilities were deliberately kept outside the local observer.

## Runtime contracts and accounting

### OpenCode

The official [plugin event documentation](https://opencode.ai/docs/plugins/#events) includes `message.updated`, `message.part.updated`, and `todo.updated`. Both inspected SDK generations expose assistant message identity, model/provider, completion time, token buckets, and `cost`: [V1 schema](https://github.com/anomalyco/opencode/blob/a697115b203395c54a7496dc3d1863fe7b319c0c/packages/sdk/js/src/gen/types.gen.ts), [V2 schema](https://github.com/anomalyco/opencode/blob/a697115b203395c54a7496dc3d1863fe7b319c0c/packages/sdk/js/src/v2/gen/types.gen.ts).

Consume `properties.info` when `role` is `assistant` and `time.completed` is present. Use `(runtime, sessionID, message id)` as the usage identity; repeated updates are snapshots of the same message. Do not count both message-level totals and the constituent `step-finish` parts. V2 also supplies an optional `tokens.total` and top-level event IDs; tolerate their absence in older payloads.

The [actual normalization and cost function](https://github.com/anomalyco/opencode/blob/a697115b203395c54a7496dc3d1863fe7b319c0c/packages/opencode/src/session/session.ts) subtracts cached tokens from `tokens.input` and reasoning tokens from `tokens.output`. Its buckets are therefore disjoint. Cost is calculated from runtime pricing/model metadata, with a zero fallback for missing prices. Label this **runtime cost estimate**, not an invoice or proof that a request was free.

`todo.updated` supplies `properties.sessionID` and a complete `todos` array containing `content`, `status`, and `priority`. The inspected V2 `Todo` type has no row ID, and `EventTodoUpdated` has no source update timestamp. The implemented adapter preserves explicit pending, in-progress, completed, and cancelled states and reports source update time as unavailable. Array positions identify rows within one snapshot; they do not claim identity across edited plans. The event envelope's receipt timestamp is not substituted for a missing source timestamp.

### Hermes

Current [observer-hook documentation](https://hermes-agent.nousresearch.com/docs/developer-guide/observer-hooks) exposes `post_api_request`, stable `api_request_id`, runtime/model information, timing, and normalized usage. `pre_api_request` and `api_request_error` provide the matching start/failure boundaries. Auxiliary model calls have separate hooks and must have an explicit coverage label if omitted.

The [hook implementation](https://github.com/NousResearch/hermes-agent/blob/c538ec5f402e8078248becacd474e47a08c6e79a/agent/api_request_hooks.py) supplies canonical token data without requiring the observer to inspect the raw model response. The [canonical usage model](https://github.com/NousResearch/hermes-agent/blob/c538ec5f402e8078248becacd474e47a08c6e79a/agent/usage_pricing.py) defines `prompt_tokens` as uncached input plus cache reads and writes; `total_tokens` adds output. Reasoning is a reported detail within output, not an extra total to add again. The canonical usage object does not itself supply a billed dollar amount.

Feature-detect newly supported hooks on older Hermes installations. Existing lifecycle observation must continue if richer telemetry is unavailable. Accept additive keyword fields and publish only the needed metadata and counters.

### Codex

The current official [hooks documentation](https://learn.chatgpt.com/docs/hooks) is the destination of the former `developers.openai.com/codex/hooks` URL. It documents lifecycle, tool, permission, subagent, stop, and interrupt events; hook JSON includes session/model information and event-specific identifiers. User hooks require review through `/hooks`. Background hooks can finish out of order, are cancelled at session end, and cannot control the triggering action; `SessionEnd` remains synchronous.

`PermissionRequest` does not document `tool_use_id`, unlike the pre/post tool hooks. Preserve available turn and tool information without inventing a call identity or an approval outcome. Keep observer output empty and successful; never emit prompt context, permission decisions, or result replacements. The documentation explicitly describes transcript format as unstable.

For structured usage, [non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) documents `codex exec --json` and `turn.completed.usage`. The official [event types](https://github.com/openai/codex/blob/624b45c4dcdc43a64da0307ce59c4508ef2206e9/sdk/typescript/src/events.ts) include input, cached input, output, reasoning output, and a newer cache-write field. The [item types](https://github.com/openai/codex/blob/624b45c4dcdc43a64da0307ce59c4508ef2206e9/sdk/typescript/src/items.ts) include command executions, file changes, MCP calls, web searches, and `todo_list`. This supports a stream observer without turning Agent Office into a CLI launcher. The implemented stream reader reports usage and task lists; lifecycle remains hook-owned.

The inspected `TodoListItem` has a whole-list `id` and an `items` array of `{text, completed}` rows. `item.started`, `item.updated`, and `item.completed` all carry these items. Only each row's explicit boolean sets completion: a completed list event or turn does not complete unfinished rows. The source supplies neither a row ID, an in-progress row state, nor a source update timestamp. The adapter reports positional row IDs, pending/completed states, and an unavailable source time without parsing plans from message text.

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

### Termi Protocol — 8 October follow-up

The requested [product page](https://termiprotocol.com/) and its
[August patch notes](https://termiprotocol.com/changelog) describe a desktop
workspace with an agent overview, task boards, terminal sessions, checkpoints,
project continuity, attention alerts, room editing, and pets. The
[Chronicle](https://termiprotocol.com/news) adds useful failure scenarios: an
alert repeatedly chiming, a new agent stealing typing focus, a long approval
request being clipped, saved agents disappearing after room editing, and idle
rendering or activity feeds consuming resources. These are the publisher's
descriptions, not features exercised in a Termi installation during this audit.

The official [public repository](https://github.com/ERCAAP/termi-protocol)
was checked at
[`9cc7ea4`](https://github.com/ERCAAP/termi-protocol/commit/9cc7ea4371432edb8935cc058ea47a6a5289c322).
Its [README](https://github.com/ERCAAP/termi-protocol/blob/9cc7ea4371432edb8935cc058ea47a6a5289c322/README.md)
explicitly identifies it as a product-discovery and feedback repository;
application source is private, the examples are illustrative, and the media
are visual references. The inspected tree has no `LICENSE` file. Its
[Terms, section 9](https://termiprotocol.com/terms) reserve rights in the
software, artwork, and designs and grant a limited right to use the service.
No reusable application source or asset license was established. Independently
implement the relevant interaction ideas using Agent Office's own code and
assets; do not vendor Termi's screenshots, room models, branding, or examples.

| Priority | Compatible addition | Decision and implementation state | Acceptance evidence |
| --- | --- | --- | --- |
| 1 | Observed task board | Implemented the documented OpenCode `todo.updated` and Codex `todo_list` arrays as replaceable snapshots, with runtime, exact session, source, and receipt-date labels. The existing Tasks panel has separate activity and reported-list views. | Focused state, real publisher/SQLite integration, and Chromium renderer tests pass. They cover full replacement, malformed input, explicit empty lists, Codex capture replay, parent/child isolation, and preserving unfinished source rows after lifecycle completion. |
| 2 | Follow an agent | Implemented an explicit inspector control and bounded scene camera target. Following selects at least 1.75 zoom while preserving a higher existing zoom. | [Three native browser flows](../tests/follow-camera.test.cjs) passed: the actual actor comes into view and survives panel switches without changing accounting; manual pan, Fit, filtering, and editing cancel follow; a real observer end event retains the exit sprite briefly, then releases the target after the 20-second fade under reduced motion. |
| 2 | Useful attention preferences | The current dashboard has one chime toggle. Expose separate approval, completion, and reward choices with a volume control, deduplication, and a cooldown. Keep long request details readable. | First load and replay are silent; repeated unresolved requests do not ring continuously; saved choices survive reload; notifications do not imply that the observer can approve runtime actions. |
| 2 | A more complete agent overview | Extend the current inspector with reported model, current observed task, source freshness, usage coverage, and the existing history route. Avoid introducing a second competing inspector. | Fields remain unavailable when their source does not report them; changing the selected agent does not mix session data; slow updates preserve unfinished preference drafts. |
| 3 | Project-scoped views | Termi describes shared rooms with project tabs; Pixel Agents has named areas mapped to workspace folders. Start with a source-backed workspace filter before a full area editor. | Switching views preserves agent identity, desk occupancy, and saved panel context; a hidden agent still owns its seat; absent workspace metadata is labelled rather than guessed. |

The task-board addition is implemented and verified with synthetic source
fixtures through the actual publishers, observer, and existing Tasks panel.
Its activity/reported-list choice survives reload and Back navigation. Camera
following passed its dedicated browser flows with actual EventStore-backed
synthetic observations. Attention preferences, an expanded overview, and project-scoped views
remain recommendations. Terminal hosting, automatic approvals, file locking,
agent orchestration, checkpoint restoration, and cross-CLI prompt delivery
require a different execution contract from this local observer. The product
page's broad CLI list does not establish supported hooks or accurate usage
for any particular runtime here. Likewise, a current-context gauge needs a
reported snapshot and known capacity; it must not turn cumulative usage into
an invented percentage.

The Pixel Agents heads were rechecked and are unchanged from the earlier
review: HQ
[`3537e140`](https://github.com/pixel-agents-hq/pixel-agents/commit/3537e140c2094761beae748592aeb92ece8edfdd)
and Hootbu
[`a6c4d85`](https://github.com/hootbu/pixel-agents/commit/a6c4d85df1266ed43fa7d0ef70525475248fafc3).
The HQ [camera implementation](https://github.com/pixel-agents-hq/pixel-agents/blob/3537e140c2094761beae748592aeb92ece8edfdd/webview-ui/src/office/components/OfficeCanvas.tsx)
follows a selected character and cancels following on manual pan. Its
[sound module](https://github.com/pixel-agents-hq/pixel-agents/blob/3537e140c2094761beae748592aeb92ece8edfdd/webview-ui/src/notificationSound.ts)
has distinct completion and permission cues. Hootbu's
[task panel](https://github.com/hootbu/pixel-agents/blob/a6c4d85df1266ed43fa7d0ef70525475248fafc3/webview-ui/src/components/TaskPanel.tsx)
actually nests subagents and derives activity from unfinished tools; it is
not a reconciled source TODO board. Its
[pixel-text editor](https://github.com/hootbu/pixel-agents/blob/a6c4d85df1266ed43fa7d0ef70525475248fafc3/webview-ui/src/office/editor/PixelTextEditor.tsx)
supplies an editable preview and bounded text. These are inspected source
implementations, although this review did not run those upstream apps.

Both Pixel Agents code licenses remain MIT; copied portions must retain the
applicable notices described below. Their implementation details are examples
to assess, not contracts to copy unquestioningly: the HQ context module uses
an estimated fallback window, while this product's accounting policy keeps an
unknown context limit unknown. Hootbu's build workflow runs a build;
HQ's [CI definition](https://github.com/pixel-agents-hq/pixel-agents/blob/3537e140c2094761beae748592aeb92ece8edfdd/.github/workflows/ci.yml)
also defines protocol-drift and package-contract checks. Workflow definitions
are not evidence that our repository's disabled CI ran successfully.

### Hootbu's Pixel Agents

The user-requested [fork](https://github.com/hootbu/pixel-agents) was checked at
[`a6c4d85`](https://github.com/hootbu/pixel-agents/commit/a6c4d85df1266ed43fa7d0ef70525475248fafc3).
Its [MIT license](https://github.com/hootbu/pixel-agents/blob/a6c4d85df1266ed43fa7d0ef70525475248fafc3/LICENSE)
retains Pablo De Lucca's copyright and identifies Hootbu's modifications. Those
notices would both need to accompany copied portions. Its README separately
identifies paid Donarg office art; a code license is not permission to copy that
pack. Original supplier provenance for its converted pet sheets was not
established, so those images were not imported.

| Observed feature and source | Gap in this office | Implementation decision |
| --- | --- | --- |
| [UsagePanel](https://github.com/hootbu/pixel-agents/blob/a6c4d85df1266ed43fa7d0ef70525475248fafc3/webview-ui/src/components/UsagePanel.tsx): per-agent colored token buckets | The roster required an extra inspection step to see usage | Add compact per-agent reported usage from this project's canonical ledger. Do not copy the upstream summation: cache/reasoning counters here are subsets. The upstream panel does not establish a USD cost implementation. |
| [View provider](https://github.com/hootbu/pixel-agents/blob/a6c4d85df1266ed43fa7d0ef70525475248fafc3/src/PixelAgentsViewProvider.ts) and [editor actions](https://github.com/hootbu/pixel-agents/blob/a6c4d85df1266ed43fa7d0ef70525475248fafc3/webview-ui/src/hooks/useEditorActions.ts): retained view/camera state | Browser reload reset the view and opening panels lost reading context | Preserve safe browser view state and panel scroll. The existing VS Code view already used `retainContextWhenHidden`; that is not a newly added capability. |
| [Office state](https://github.com/hootbu/pixel-agents/blob/a6c4d85df1266ed43fa7d0ef70525475248fafc3/webview-ui/src/office/engine/officeState.ts) and [layout serializer](https://github.com/hootbu/pixel-agents/blob/a6c4d85df1266ed43fa7d0ef70525475248fafc3/webview-ui/src/office/layout/layoutSerializer.ts): explicit seat assignment | Desks were derived only from input order | Add preferences keyed by canonical session identity. Validate the destination before releasing the old assignment; keep hidden agents in occupancy checks and resolve imported conflicts deterministically. |
| [CostumePanel](https://github.com/hootbu/pixel-agents/blob/a6c4d85df1266ed43fa7d0ef70525475248fafc3/webview-ui/src/components/CostumePanel.tsx): six appearances and hue controls | Appearance was derived from ID or the global subagent setting | Add individual default/person/robot choices using existing licensed and original art. Share the resolver across floor, portraits, and crown placement. Hue adjustment remains future work. |
| [Pet state machine](https://github.com/hootbu/pixel-agents/blob/a6c4d85df1266ed43fa7d0ef70525475248fafc3/webview-ui/src/office/engine/pets.ts): wander, sit, sleep, approach, and flee | Existing cats were mainly ambient decorations | Add bounded state-machine movement for this project's existing cats, with collision-aware paths, pause/reduced-motion rules, and opt-out settings. These behaviors do not call an AI model. The larger dog/five-pet manager is not included. |

These are independent implementations of compatible concepts. No Hootbu code
or artwork is copied into this repository. Its full layout editor, arbitrary
wall text/z-layers, and hue editor are separate future additions. Its event
reactions should also be understood as reactions to observed events, not
measurements of an agent's emotions or proof of successful task completion.

### Product website references

[Handy](https://handy.computer/) was read live with Firecrawl for its focused
product promise, immediate primary action, short demonstration, and concrete
benefit sections. [The Pixel Office](https://thepixeloffice.ai/) was reviewed
for its visual office introduction and feature cards. The resulting `site/`
uses original layout/copy, the existing licensed Geist font, and this project's
actual synthetic-fixture screenshots. No reference-site artwork, customer
claims, or autonomous-workforce claims are inherited.

The landing page's keyboard tabs follow the
[W3C tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) with manual
activation; content and install instructions remain available without JavaScript.
GitHub Pages setup follows the
[official custom-workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
The checked action revisions are pinned in the workflow. The
[configure-pages action](https://github.com/actions/configure-pages/blob/45bfe0192ca1faeb007ade9deae92b16b8254a0d/action.yml)
does not auto-enable Pages with the ordinary workflow token; publishing-source
configuration remains an explicit repository setting.

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
camera is now independently implemented and covered by the native flows above. Keep these as independently
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

The follow-up adds [reported task state](../tasks.py), source adapters, and a
[read-only task renderer](../web/js/tasks-view.js). The checkpoint retains at
most 128 recently reported runtime/session boards and 100 tasks per board;
oversized or malformed snapshots are rejected in full. Task reports do not
create sprites, refresh agent clocks, infer completion, or earn XP. A board
without a currently visible matching session is labelled **Last reported**;
this is not proof that the runtime process has stopped.

[Publisher integration tests](../tests/test_tasks_integration.py) exercise
synthetic OpenCode and Codex payloads through the actual subprocess adapters,
atomic inbox, and SQLite state. They verify that task-only reports leave all
progress counters unchanged, late child updates preserve parent and other
runtime boards, terminal agents stay terminal, and raw-history pruning does
not erase the bounded task checkpoint. [Renderer tests](../tests/tasks-view.test.cjs)
use real Chromium to verify literal full text, unknown versus reported-empty
states, safe runtime/session routing, and focus/text-selection retention.
These are source-contract tests, not evidence of an installed provider run.

Codex replay protection uses the caller's stable capture ID and the parsed
record sequence. Each board remembers the maximum accepted sequence for its
eight most recently accepted captures, including across observer restarts.
Replaying remembered capture A after capture B cannot regress the board or
refresh its receipt time; a previously unseen later record from A is still
accepted. Older single-capture checkpoints migrate into this bounded memory.
An evicted capture or board loses that replay protection. Unseen records from
different captures still follow receipt order: their schemas supply no shared
source clock, so the observer does not assert a globally ordered task history.
OpenCode's source schema likewise supplies no source update clock.
Current-context gauges and additional Gemini CLI, Aider,
Cursor, and Copilot CLI adapters remain future work. No new upstream repository
was forked or rebundled during this implementation.

## Repository inventory

Read-only GitHub connector queries on 7 October 2026 returned **no open pull requests**, **no open issues**, and **one branch, `main`**, for [NosytLabs/agent-office](https://github.com/NosytLabs/agent-office). The branch listing was paginated through an empty final page. This is a point-in-time inventory, not permission or a recommendation to merge future changes without reviewing them.

A later inventory on 8 October found new work on [`codex/office-integrity` at `897d3e0`](https://github.com/NosytLabs/agent-office/commit/897d3e0b7ad4977217b5f6664dfe48c832e765e2), based on published main `0aec140`. The first two commits add [four terminal-callback regressions](https://github.com/NosytLabs/agent-office/commit/8d4cf0efb1b50dafc1f87540b30cb938a9c86a75) and [preserve completed agents when late errors arrive](https://github.com/NosytLabs/agent-office/commit/f71ebfed5acddf9924bd8a3218cde6095d3ca35a). Both were incorporated unchanged after reproducing three failures, then running the full integrated checks. The third, test-only commit assumes a different five-session lamp reward and was not imported wholesale.

The current catalog policy retires `oops`, `weather_storm`, `weather_sun`, `deep_work`, `theme_designer`, `night_owl`, and `early_bird`. It preserves earned XP and statistics, awards no XP for errors, appearance changes, or time of day, and keeps existing lamp appearances while assigning the lamp to the 50-tool milestone. This leaves 37 reachable active achievements. An earlier snapshot of the preparation branch contained an obsolete source-replacement script and self-writing workflow; neither was imported. Branch contents were rechecked before deciding what to integrate.

## Tests to carry into implementation

Test recorded source payloads from each supported schema, repeated usage snapshots, same-timestamp and older-timestamp delivery, a restart between report and cleanup, and missing or malformed usage. Verify cached/reasoning tokens are not counted twice, a model switch keeps separate attribution, and costs retain their provenance. For observed task lists, test a full replacement with removed and cancelled items. For furniture, test touch, mouse, keyboard, editor precedence, focus restoration, and reduced motion. These additions must retain the existing observer-only hook contract.
