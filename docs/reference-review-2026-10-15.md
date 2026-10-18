# Reference review — 15 October 2026

This review records source mechanisms inspected on 15 October 2026 and supplements the [7–8 October review](reference-review-2026-10-07.md). Shipped-feature descriptions were reconciled on 18 October; the source revisions and retrieval evidence below remain those of the original review.

Public source was read through GitHub and pinned, read-only checkouts. No upstream application was run or installed, and no third-party application code or artwork was imported by this review. BridgeMind and Termi findings are their publishers' product and release claims; source inspection supports the repository findings below. Local synthetic browser checks establish only the Agent Office flows explicitly described under verification.

## Source mechanisms and current overlap

| Reference | Primary evidence inspected | What transfers to this observer |
| --- | --- | --- |
| AgentSystemLabs Agent Office, `852e2ab28c4f3f31bffdf4b20353bd119c9d3270` | [Palette entries and shortcut guard](https://github.com/AgentSystemLabs/agent-office/blob/852e2ab28c4f3f31bffdf4b20353bd119c9d3270/src/client/features/palette/index.ts), [search results and keyboard selection](https://github.com/AgentSystemLabs/agent-office/blob/852e2ab28c4f3f31bffdf4b20353bd119c9d3270/src/client/ui/palette.ts), [next-up ordering](https://github.com/AgentSystemLabs/agent-office/blob/852e2ab28c4f3f31bffdf4b20353bd119c9d3270/src/client/nextup.ts) | Search across sessions and existing panels, then open a result with keyboard or pointer. Agent Office already remembers its last view and filters; a unified search makes those destinations easier to find. Upstream terminal writing, hiring and service actions are outside this navigation addition. |
| Pixel Agents HQ, `d1e007a9fdf3003c252d2973abe1999ae59aec33` | [Settings component](https://github.com/pixel-agents-hq/pixel-agents/blob/d1e007a9fdf3003c252d2973abe1999ae59aec33/webview-ui/src/components/SettingsModal.tsx) exposes sound, watch-all-session and label controls, plus layout import/export | Most settings patterns already exist here. Retain clear distinctions between a viewing preference, an installed observer integration and a runtime action; a checkbox alone is not proof that hooks are installed. |
| Harish Kotra AgentOffice, `58f11f9b31770c10bcf3d7a0618325d22bd0ee9e` | [FloatingPanel](https://github.com/harishkotra/agent-office/blob/58f11f9b31770c10bcf3d7a0618325d22bd0ee9e/packages/ui/src/components/FloatingPanel.tsx) persists local panel position and minimized state and clamps its position | Preserve useful panel context. Named view presets would be an independently proposed extension, not a feature established by this file. Agent Office already restores panel/scroll/focus context. |
| Habblaud, `86c0379b18cd1be35dd3661f98f87662633db3ef` | [State counters](https://github.com/marmottajr/habblaud/blob/86c0379b18cd1be35dd3661f98f87662633db3ef/client/src/ui/model.ts#L52-L84), [request navigation](https://github.com/marmottajr/habblaud/blob/86c0379b18cd1be35dd3661f98f87662633db3ef/client/src/ui/permission.ts#L77-L95), [keyboard handling](https://github.com/marmottajr/habblaud/blob/86c0379b18cd1be35dd3661f98f87662633db3ef/client/src/ui/index.ts#L356-L427), [title/notifications](https://github.com/marmottajr/habblaud/blob/86c0379b18cd1be35dd3661f98f87662633db3ef/client/src/ui/notify.ts#L29-L65) | Find the next observed input request without approving it. A count-only tab title provides muted/background awareness without revealing session text or requesting notification permission. Its [room layout](https://github.com/marmottajr/habblaud/blob/86c0379b18cd1be35dd3661f98f87662633db3ef/client/src/world/layout/room.ts#L141-L174) and [walking geometry](https://github.com/marmottajr/habblaud/blob/86c0379b18cd1be35dd3661f98f87662633db3ef/client/src/world/layout/building.ts#L28-L60) also show why visible furniture and navigation footprints should agree. |
| Hootbu Pixel Agents, `a6c4d85df1266ed43fa7d0ef70525475248fafc3` | [Task text and approval display](https://github.com/hootbu/pixel-agents/blob/a6c4d85df1266ed43fa7d0ef70525475248fafc3/webview-ui/src/components/TaskPanel.tsx#L16-L48), [bubble lifecycle](https://github.com/hootbu/pixel-agents/blob/a6c4d85df1266ed43fa7d0ef70525475248fafc3/webview-ui/src/office/engine/officeState.ts#L643-L689), [shared layout footprints](https://github.com/hootbu/pixel-agents/blob/a6c4d85df1266ed43fa7d0ef70525475248fafc3/webview-ui/src/office/layout/layoutSerializer.ts#L19-L149) | Keep useful reported commands/questions readable and keep layout geometry consistent. Some upstream waiting states use [transcript silence timers](https://github.com/hootbu/pixel-agents/blob/a6c4d85df1266ed43fa7d0ef70525475248fafc3/src/timerManager.ts#L45-L64); preserve Agent Office's explicit input-request semantics instead of inferring a blocked agent from silence. |
| Star-Office-UI, `f29c107e9728a72f2635f10b4e8203b29b37221d` | [State/area map and stale fallback](https://github.com/ringhyacinth/Star-Office-UI/blob/f29c107e9728a72f2635f10b4e8203b29b37221d/backend/app.py#L65-L184), [memo route](https://github.com/ringhyacinth/Star-Office-UI/blob/f29c107e9728a72f2635f10b4e8203b29b37221d/backend/app.py#L1138-L1181), [memo extraction](https://github.com/ringhyacinth/Star-Office-UI/blob/f29c107e9728a72f2635f10b4e8203b29b37221d/backend/memo_utils.py#L18-L104) | Six reported states map to work/rest/error areas. The memo reads a dated log, takes its first three qualifying points, applies limited pattern redaction/truncation and adds a random quote. It is not an AI summary. A local recorded-history recap can serve the same returning-to-work use case without scanning arbitrary memory folders. |
| BridgeMind / BridgeVerse, official product and dated releases | [BridgeVerse product](https://www.bridgemind.ai/bridgeverse), [v0.3.3, 2 October](https://www.bridgemind.ai/changelog/bridgemind-one/v0-3-3), [v0.3.4, 5 October](https://www.bridgemind.ai/changelog/bridgemind-one/v0-3-4) | Publisher-described urgency boards, saved/searchable prompts, stable restoration and reduced background rendering are useful interaction references. Existing Agent Office needs-input filters, summaries, quiet/retained labels and focus preservation already cover part of this. Terminal access, voice relay, remote approvals and background execution are separate control capabilities. |
| Termi Protocol, official October/August release notes | [Official changelog](https://termiprotocol.com/changelog), retrieved 15 October 2026, including October v0.4.0 and v0.3.1 | Publisher-described alert-loop, false-waiting, focus-theft, clipped-request, offline-continuity and usage-count fixes supply concrete regression scenarios. They do not establish executed behavior in an installed Termi app. Agent Office already has bounded rendering, hidden-page handling, durable accounting and explicit unavailable-data labels. |

## Shipped improvements informed by this review

Quick navigation, attention controls, panel navigation, and the artwork supplements are now present in Agent Office. The table describes their scope; exact-commit verification belongs in the [validation report](audit/README.md).

| Area | Decision and limits |
| --- | --- |
| Quick navigation | Search existing panels and observed sessions with keyboard selection, Escape and focus return. Text-entry and editing guards preserve their existing keys. Results open established views; searching never submits a prompt, approves a request, installs a runtime or starts a process. |
| Attention navigation and tab awareness | P / Shift+P moves through observed waiting sessions, including those hidden by the floor filter. A count-only tab title clears resolved/departed sessions and states disconnection explicitly. Typing, furniture editing and unrelated modal keys keep their own behavior. Ordering follows available source/session data; it does not establish the age of a pending request. |
| Long-panel usability | Customize includes section jumps, and history exports sit before potentially long results. Hidden or unavailable destinations are omitted. Panel navigation preserves focus and drafts; the tab trap includes textareas and excludes disabled/hidden controls. |
| Original art and room presentation | Generated directional sources retain their prompts, source hashes and reproducible compilers. Six identities provide 72 walking frames and 72 activity frames; each character pack gains 24 palette variants at runtime. Companion packs provide 96 walking and 96 life frames, with four seamless room surfaces. Base-art fallback, retry, paused poses and native PNG/strip export remain supported. See [studio art](studio-art.md), [asset pipeline](asset-pipeline.md) and [studio tools](studio-tools.md). |
| Room/HUD restraint | Keep desk capacity, labels, furniture footprints and walking geometry consistent across desktop and narrow layouts. Use reported work states for HUD information. Existing 30 fps room rendering, 8 fps paused rendering and hidden-page drawing suppression already address part of the power-use lessons; decoration never produces work, usage or XP. |

The local observer also includes per-session summary copy, filtered saved-history export, an editable task brief, a named saved-brief library, explicit per-tab draft retention, optional local-run preparation, artwork fallback/retry and stable panel return context.

## Follow-through and remaining options

The reusable task-brief proposal has shipped: a named, searchable browser-local
library with Load/Append, Rename/Delete, and reviewed JSON backup import/export.
Saving/loading preserves exact text and never contacts a runtime. See the
[current saved-brief guide](task-briefs.md) for the supported flows and limits.

**Activity recap and notification sound preferences have shipped.** Customize
offers Today / Since last review over the latest 30 snapshot events. Range and
Mark reviewed state stay in browser storage; observed events remain in the
observer's snapshot. This is a bounded recent-activity view. Activity → Saved
provides retained-history review and export. The separate master Sound toggle
and needs-input/error/reward preferences control notification chimes; the
kind-level preferences are saved with office settings. See the
[usage guide](usage.md#notification-sounds-and-activity-recap).

A fuller retained-history recap remains a possible extension. Its retrieval
limit, time zone, freshness, retention window and partial coverage would need
clear labels. The history reader caps returned rows at 5,000, and default
retention is seven days/1,000 events. Session end, tool activity and animation
do not establish a successful shipment; achievements have their existing
Achievements surface.

Browser/OS notifications are still a separate optional proposal. They should
start off, request permission only from a deliberate action, deduplicate fresh
event/request identities, remain silent for bootstrap/reconnect replay, and open
an inspector without answering anything. Existing chimes remain silent in hidden
tabs.

Named view presets are another possible bounded extension of existing persistence; the inspected Harish panel source does not implement them. Oldest-request sorting first needs a durable `waiting_since` projection from still-pending request events, including multiple requests, resolution, restart and pruning tests. `updated_at`, `observed_at` and `idle_s` can change during later tool activity and cannot substitute for request age.

Existing-session OpenCode handoff remains excluded. These proposals do not add interactive terminal attachment, provider approvals, cross-agent prompt relay, authenticated provider control, recurring autonomous work or upstream checkpoint restoration. The [optional local task runner](local-task-runner.md) retains its separate explicit-startup and admission contract.

## License and asset boundaries

| Reference | Reuse boundary |
| --- | --- |
| AgentSystemLabs | [Pinned MIT license](https://github.com/AgentSystemLabs/agent-office/blob/852e2ab28c4f3f31bffdf4b20353bd119c9d3270/LICENSE), copyright AgentSystemLabs. Substantial copied code would require its notices. The selected navigation implementation is independent. |
| Pixel Agents HQ | [Pinned MIT license](https://github.com/pixel-agents-hq/pixel-agents/blob/d1e007a9fdf3003c252d2973abe1999ae59aec33/LICENSE), copyright Pablo De Lucca. The code license is not evidence for every external art pack; inspect provenance separately. |
| Harish Kotra | [Pinned MIT license](https://github.com/harishkotra/agent-office/blob/58f11f9b31770c10bcf3d7a0618325d22bd0ee9e/LICENSE), copyright Harish Kotra. No application code or art was imported. |
| Habblaud | [Pinned MIT license](https://github.com/marmottajr/habblaud/blob/86c0379b18cd1be35dd3661f98f87662633db3ef/LICENSE), copyright Márcio Junior; [README provenance](https://github.com/marmottajr/habblaud/blob/86c0379b18cd1be35dd3661f98f87662633db3ef/README.md#license) describes project-generated images. No images were reused. |
| Hootbu Pixel Agents | [Pinned MIT license](https://github.com/hootbu/pixel-agents/blob/a6c4d85df1266ed43fa7d0ef70525475248fafc3/LICENSE) includes the original and modification notices. [Office asset terms](https://github.com/hootbu/pixel-agents/blob/a6c4d85df1266ed43fa7d0ef70525475248fafc3/README.md#office-assets) identify the separately licensed Donarg tileset. MIT code does not grant rights to that pack. |
| Star-Office-UI | [Pinned license](https://github.com/ringhyacinth/Star-Office-UI/blob/f29c107e9728a72f2635f10b4e8203b29b37221d/LICENSE) separates MIT code/logic from noncommercial-only art, including sprites, backgrounds, furniture, UI skins and assembled packs. Keep original/generated art here. |
| Sahni Agents Office | [LICENSE at `3773c9b6aed6a1d2c3ab2765d113c644261c2019`](https://github.com/ajsahni/agents-office/blob/3773c9b6aed6a1d2c3ab2765d113c644261c2019/LICENSE) combines PolyForm Noncommercial with extra notice, rebranding and integration restrictions. It was read only to establish reuse boundaries; its code and assets are not import candidates. |
| BridgeMind and Termi | The reviewed product/release pages do not establish a reusable application-code or artwork license. Use interaction ideas and documented failure scenarios with independently written code and original assets. |

## Verification and limits

The review did not run provider CLIs, upstream applications or real user sessions. Earlier isolated Agent Office checks used temporary homes, random ports and synthetic events at 1440, 390 and 320 px widths. They exercised needs-input inspection/copy, panel Back/close focus, exact draft copy and preservation, filtered history export, art switching, optional-art recovery, lights, arcade open/close and companion feedback. Accounting remained unchanged, and the captured flows had no missing artwork or failed requests apart from deliberately injected asset failures.

Those checks preceded the final integration of the selected search/attention/background changes and do not validate changes that had not yet been written. During that review, a hidden-gallery Customize jump edge case was corrected and checked with a synthetic fallback fixture. Release-specific checks and remaining live-runtime/VS Code limitations belong in the [validation report](audit/README.md). The pinned review evidence does not establish upstream feature parity or verification of later releases.
