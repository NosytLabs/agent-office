# Runtime observers and coverage

Agent Office observes work performed by an existing runtime. The installer adds local observer definitions to detected runtimes; it does not install a model CLI, sign into an account, select a model, or start a model session. Local hook/stdin fixtures exercise the entire adapter → inbox → SQLite path. They are not evidence that a user's installed CLI has delivered its hooks until that CLI is connected and used.

## Implemented adapters

| Runtime | Lifecycle observation | Usage observation | Setup and limits |
| --- | --- | --- | --- |
| Hermes | Existing session, tool, approval, and real subagent callbacks; turn busy/idle callbacks when supported | Current `post_api_request`, keyed by `api_request_id` | Run `python3 install.py` with an existing Hermes installation. Optional hook names are checked against that runtime's `VALID_HOOKS`. Older Hermes keeps the established callbacks and may have no usage reporting. |
| OpenCode | Sessions, busy/idle, real child sessions, tools, permissions, questions, errors | Completed assistant `message.updated` snapshots, keyed by message ID | Installer adds an importable `file:` URL. Existing JSONC configuration is preserved and receives a manual setup instruction. Restart OpenCode after changing the plugin. |
| Claude Code | Session, prompt, stop/failure, tool, approval, question, and subagent hooks | Not reported by this adapter | Installer merges the observer into `~/.claude/settings.json`, preserving unrelated hooks. No transcript usage scraping is performed. |
| Codex | Session, prompt, tool, permission, subagent, stop, interrupt hooks | Optional existing `codex exec --json` stream; hooks themselves provide no usage counters | Installer merges `hooks.json` in `CODEX_HOME` or `~/.codex`. Open Codex **`/hooks` to review and trust** the new definitions. The installer never changes trust records or bypasses trust. |

All bundled writers publish complete immutable files in `HERMES_HOME/pixel-office/inbox`, or `~/.hermes/pixel-office/inbox` by default. Each publication has a unique receipt, even when two event payloads are identical. Filename order comes from publication time and process-local sequence, not the runtime payload timestamp. Writes use a temporary file and atomic rename. A write failure remains fail-open for the agent runtime. Python and JavaScript writers do not append to the legacy JSONL file.

The server commits observations and their receipts before deleting acknowledged inbox files. Processed history retention is independent of active tools and pending approvals. An offline server necessarily leaves an unprocessed inbox backlog; start the office server to drain it. These guarantees do not imply delivery when a runtime cancels a hook, loses access to the filesystem, or never emits an event.

### Codex usage input

Import an already captured structured stream from the repository root:

```sh
python3 codex/stream.py --stream-id build-check-01 < build-check-01.jsonl
```

Use a unique stable name for each captured invocation. Reuse that name only when replaying the same capture. Codex's documented `turn.completed` event does not include a turn ID, so this adapter combines the capture name with the sequence of `turn.started` records. The stream must include its `thread.started` and turn boundaries; arbitrary transcript fragments are not a supported substitute. Repeated snapshots of one turn replace that turn's counters. Different captures of resumed work require different names.

The reader accepts JSONL on stdin, reads at most 1 MiB per record, and discards malformed or oversized records without accumulating the full stream. It emits usage only; installed Codex hooks own lifecycle observation, avoiding duplicate session/tool counts when both paths are attached. It emits no model/provider/cost claim absent a supported source field. Interactive transcript usage remains unsupported because the transcript format is not a stable hook API.

Codex hook installation uses synchronous commands with a three-second timeout. This keeps short local publications ordered and avoids normal background-hook cancellation at session end. `SessionStart` with source `compact` changes metadata without clearing active tools. `PermissionRequest` retains the tool and turn without fabricating a tool-call ID or permission outcome. Tool results without an explicit recognized outcome are recorded as `unknown`, not assumed successful.

### Usage semantics

Usage records are complete replacement snapshots of a stable source unit. Duplicate snapshots do not add tokens; corrected snapshots replace that unit's prior contribution. Tokens unavailable from the runtime remain unknown, distinct from a reported zero. Without a source revision, a different older snapshot is indistinguishable from a correction received later.

| Source | Inclusive counters used by the office | Monetary coverage |
| --- | --- | --- |
| OpenCode assistant message | Input = uncached input + cache reads + cache writes. Output = ordinary output + reasoning. Preserve explicit total when supplied. | Source `cost` is an **OpenCode runtime estimate**. Its reported zero may reflect missing runtime pricing; it is not proof of free or billed usage. |
| Hermes API attempt | Input = canonical `prompt_tokens`. Output already includes reasoning. | Current canonical usage supplies no amount; cost remains unavailable. Main-loop API attempts are covered; auxiliary calls are not included. |
| Codex structured turn | Input and output are already inclusive; cached input, cache writes, and reasoning are subsets. | The documented stream provides no monetary amount; cost remains unavailable. |

The usage ledger keeps one compact identity/counter row per observed unit so arbitrary replay and later corrections remain exact. This ledger grows with the number of units; raw activity retention does not delete that accounting baseline. It stores no prompts, tool commands, response bodies, or raw event history.

## Other requested runtimes

These are support gaps in this repository, not claims that the upstream products lack extension points. No dedicated adapter or automatic installer is currently bundled for them.

| Runtime | Verified upstream capability | Remaining work before claiming support |
| --- | --- | --- |
| Gemini CLI | [Official hooks](https://geminicli.com/docs/hooks/) provide session, agent, model, and tool boundaries. | A Gemini-specific mapper, validated output contract, config merge, usage identity policy, and actual payload fixtures. |
| Cursor | [Official hooks](https://cursor.com/docs/hooks) include session, tool, and subagent events. [Third-party hook compatibility](https://cursor.com/docs/reference/third-party-hooks) supports some Claude-style events. | A native mapper must preserve Cursor conversation/generation/subagent identities and verify the selected CLI surface. Permission-style hooks have different output requirements; blindly reusing a silent observer can be unsafe. Compatibility is not a tested dedicated integration. |
| GitHub Copilot | [Official hook reference](https://docs.github.com/en/copilot/reference/hooks-reference) documents user/repository hooks and separate camelCase and VS Code-compatible payload shapes. | A Copilot-specific config and mapper, identity/deduplication tests, explicit CLI/cloud/IDE coverage, and source-verified usage ingestion. Installing the Agent Office VS Code panel does not supply these runtime events. |
| Aider | [Official options](https://aider.chat/docs/config/options.html#--notifications-command-command) expose a notification command for response-ready notifications. | This is not evidence of a full session/tool/subagent/usage event feed. A reliable structured observation contract must be established before advertising full support. |

## Source contracts

Reviewed on 7 October 2026:

- [Codex hooks](https://learn.chatgpt.com/docs/hooks), [non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), and [official TypeScript event types](https://github.com/openai/codex/blob/main/sdk/typescript/src/events.ts).
- [OpenCode plugin events](https://opencode.ai/docs/plugins/#events), [pinned V2 schemas](https://github.com/anomalyco/opencode/blob/a697115b203395c54a7496dc3d1863fe7b319c0c/packages/sdk/js/src/v2/gen/types.gen.ts), and [source usage normalization](https://github.com/anomalyco/opencode/blob/a697115b203395c54a7496dc3d1863fe7b319c0c/packages/opencode/src/session/session.ts).
- [Hermes observer hooks](https://hermes-agent.nousresearch.com/docs/developer-guide/observer-hooks), [pinned request hook implementation](https://github.com/NousResearch/hermes-agent/blob/c538ec5f402e8078248becacd474e47a08c6e79a/agent/api_request_hooks.py), and [canonical usage model](https://github.com/NousResearch/hermes-agent/blob/c538ec5f402e8078248becacd474e47a08c6e79a/agent/usage_pricing.py).
