# Runtime observers and coverage

Agent Office observes work performed by an existing runtime. The installer adds local observer definitions to detected runtimes; it does not install a model CLI, sign into an account, select a model, or start a model session. Local hook/stdin fixtures exercise the entire adapter → inbox → SQLite path. They are not evidence that a user's installed CLI has delivered its hooks until that CLI is connected and used.

## Implemented adapters

| Runtime | Lifecycle observation | Usage and task reports | Setup and limits |
| --- | --- | --- | --- |
| Hermes | Existing session, tool, approval, and real subagent callbacks; turn busy/idle callbacks when supported | Current `post_api_request`, keyed by `api_request_id`; no source task-list adapter | Run `python3 install.py` with an existing Hermes installation. Optional hook names are checked against that runtime's `VALID_HOOKS`. Older Hermes keeps the established callbacks and may have no usage reporting. |
| OpenCode | Sessions, busy/idle, real child sessions, tools, permissions, questions, errors | Completed assistant `message.updated` usage snapshots; complete `todo.updated` task lists | Installer adds an importable `file:` URL. Existing JSONC configuration is preserved and receives a manual setup instruction. Restart OpenCode after changing the plugin. |
| Claude Code | Session, prompt, stop/failure, tool, approval, question, and subagent hooks | No usage or source task-list adapter | Installer merges the observer into `~/.claude/settings.json`, preserving unrelated hooks. No transcript usage scraping is performed. |
| Codex | Session, prompt, tool, permission, subagent, stop, interrupt hooks | Optional existing `codex exec --json` stream supplies usage and `todo_list` snapshots; hooks themselves provide neither | Installer merges `hooks.json` in `CODEX_HOME` or `~/.codex`. Open Codex **`/hooks` to review and trust** the new definitions. The installer never changes trust records or bypasses trust. |
| Gemini CLI | Session start/end and agent-loop busy/idle boundaries | No tool, permission, subagent, usage, cost, or task-list reporting | Installer merges four synchronous observer hooks into `~/.gemini/settings.json`, or `.gemini/settings.json` beneath `GEMINI_CLI_HOME`. Existing disabled hooks and trust/auth settings are preserved. |

All bundled writers publish complete immutable files in `HERMES_HOME/pixel-office/inbox`, or `~/.hermes/pixel-office/inbox` by default. Each publication has a unique receipt, even when two event payloads are identical. Filename order comes from publication time and process-local sequence, not the runtime payload timestamp. Writes use a temporary file and atomic rename. A write failure remains fail-open for the agent runtime. Python and JavaScript writers do not append to the legacy JSONL file.

The server commits observations and their receipts before deleting acknowledged inbox files. Processed history retention is independent of active tools, pending approvals, and bounded task checkpoints. Unreadable publications remain retryable; a durable same-writer barrier prevents later corrections from overtaking them, while other writers continue to drain. An offline server necessarily leaves an unprocessed inbox backlog. These guarantees do not imply delivery when a runtime cancels a hook, loses access to the filesystem, or never emits an event.

### OpenCode setup

From the checked-out repository, run:

```sh
python3 install.py
```

For a detected OpenCode installation, this merges the absolute `file:` URL of `opencode/index.js` into the `plugin` array in `~/.config/opencode/opencode.json`. It also repairs the obsolete directory-path entry used by earlier installs. Keep the checkout at that location or rerun the installer after moving it.

When `opencode.jsonc` exists, the installer preserves it and prints the URL to add manually to its existing `plugin` array. To obtain the correct URL, including path escaping:

```sh
python3 -c "from pathlib import Path; print(Path('opencode/index.js').resolve().as_uri())"
```

Restart OpenCode, keep the office server running, and perform work in the existing runtime. The plugin observes source events without launching an agent. Task lists appear only when that source emits `todo.updated`; absence is not reported as an empty plan. OpenCode's JavaScript plugin is not a Codex or Claude Code plugin: those runtimes use their separate Python hook adapters installed by `install.py`.

### Codex usage and task input

Import an already captured structured stream from the repository root:

```sh
python3 codex/stream.py --stream-id build-check-01 < build-check-01.jsonl
```

Use a unique stable name for each captured invocation. Reuse that name only when replaying the same capture. Codex's documented `turn.completed` event does not include a turn ID, so usage identity combines the capture name with the sequence of `turn.started` records. Usage requires `thread.started` and turn boundaries; task items require the known thread identity. Arbitrary transcript fragments are not a supported substitute. Repeated snapshots of one turn replace that turn's counters. Different captures of resumed work require different names.

The reader accepts JSONL on stdin, reads at most 1 MiB per record, and discards malformed or oversized records without accumulating the full stream. It emits usage and complete task-list snapshots; installed Codex hooks own lifecycle observation, avoiding duplicate session/tool counts when both paths are attached. It emits no model/provider/cost claim absent a supported source field. Interactive transcript usage remains unsupported because the transcript format is not a stable hook API.

Codex hook installation uses synchronous commands with a three-second timeout. This keeps short local publications ordered and avoids normal background-hook cancellation at session end. `SessionStart` with source `compact` changes metadata without clearing active tools. `PermissionRequest` retains the tool and turn without fabricating a tool-call ID or permission outcome. Tool results without an explicit recognized outcome are recorded as `unknown`, not assumed successful.

### Gemini CLI setup and coverage

With an existing Gemini CLI installation, run `python3 install.py` from the checkout. The installer adds `SessionStart`, `BeforeAgent`, `AfterAgent`, and `SessionEnd` to the user-level `hooks` configuration. Each command invokes `gemini/hook.py` with the installer's Python interpreter, uses the name `agent-office-observer`, and has a 3000-millisecond timeout. Keep the checkout and interpreter at those locations or rerun the installer after moving them. `GEMINI_CLI_HOME` is a **parent home override**: the runtime settings path is `$GEMINI_CLI_HOME/.gemini/settings.json`.

Review the hook definitions in Gemini's `/hooks panel`. Existing `hooks.enabled: false`, `hooks.disabled`, project trust, and authentication remain under the user's control. The installer does not enable disabled hooks or trust a workspace. Settings with comments (JSONC), malformed JSON, or invalid target hook groups are preserved byte-for-byte; merge manually into the existing `hooks` object instead of replacing it. This command prints the four observer groups with correctly quoted local paths for a manual merge:

```sh
python3 -c 'import install,json,shlex,sys; h={"type":"command","name":"agent-office-observer","command":shlex.join([sys.executable,str(install.HERE/"gemini/hook.py")]),"timeout":3000}; print(json.dumps({k:[{"hooks":[h]}] for k in install.GEMINI_EVENTS},indent=2))'
```

Only source `session_id` supplies identity. `BeforeAgent` marks that session busy; `AfterAgent` marks it idle without claiming success, completed tasks, or additional completion XP. An upstream hook can reject an agent response, after which Gemini fires `BeforeAgent` again. `SessionEnd` retains a recognized source reason and starts the office's existing exit animation. Receipt timestamps describe observation time; prompts, responses, CWD, and transcript content are not persisted. The adapter reads at most 1 MiB, silently rejects invalid or oversized payloads, and always returns an empty, successful hook response even if the office directory cannot be written.

This is deliberately **session lifecycle coverage**. The checked hook types provide no stable tool-call, turn, approval-request, or model-response identity, so the observer does not manufacture correlations, child agents, token totals, cost, or task completion. Translated `AfterModel` usage arrives per streaming chunk and is not an accounting ledger. Session-end delivery is best effort: cancellation, a killed process, or an upstream error path may omit terminal hooks. In particular, Gemini 0.63.0 headless JSON output calls synchronous cleanup and exits after a provider error without its asynchronous `SessionEnd` hook. Agent Office retains the last observed state; after five quiet minutes it displays a quiet observation, and the default 30-minute stale limit removes it. Neither timeout is proof that the task succeeded or failed.

[Adapter regression tests](../tests/test_gemini_hook.py) exercise real stdin publication and SQLite folding. [Opt-in native tests](../tests/test_gemini_native.py) run the official npm CLI **0.63.0**, with a fake key, a fresh isolated home/workspace, telemetry and update checks disabled, explicit empty system-settings/defaults fixtures, and a connection guard allowing only a loopback synthetic provider. Native cases skip when existing system settings, system policy entries, or configured system overrides are present, or their absence cannot be verified; existing system policy is never bypassed. The documented per-invocation `--skip-trust` acknowledges only that newly created test directory; no account credentials or persistent trust are used. Native success and HTTP 400 error paths verify both actual hook delivery and its missing-terminal-hook limit. These tests validate the installed CLI/observer boundary, not a paid provider session or every user's runtime configuration:

```sh
GEMINI_TEST_CLI=/absolute/path/to/isolated/node_modules/.bin/gemini python3 -m pytest tests/test_gemini_native.py
```

### Reported task semantics

| Source | Explicit task data | Limits on interpretation |
| --- | --- | --- |
| OpenCode `todo.updated` | `properties.sessionID` and complete `todos` rows with `content`, `status`, and optional accepted priority | Preserves `pending`, `in_progress`, `completed`, and `cancelled`. The checked schema supplies no row ID or source update clock. |
| Codex `todo_list` in `item.started`, `item.updated`, or `item.completed` | Whole-list item ID, known thread, and complete `items` rows with `text` and boolean `completed` | Only the row boolean selects pending/completed. A completed item or turn does not complete unfinished rows; no in-progress state or source update clock is supplied. |

Boards are keyed by exact runtime/session identity, including separate parents and children. Each valid report replaces the whole previous list, removing absent rows. Empty `[]` means the source explicitly reported no tasks. Missing or malformed data preserves the last valid board, or remains unknown when none exists. A board admits at most 100 tasks with 512-character content; an oversized snapshot is rejected rather than truncated. Row IDs are positional within a source snapshot, not evidence that two edited plans contain the same historical work.

The Tasks panel shows full reported text, source, session, and the observer receipt date. Source update time remains unavailable for these two adapters; receipt time does not claim when the upstream plan changed. Task telemetry cannot create or revive a sprite, refresh its work status, earn XP, or infer completion. A board becomes **Last reported** when no current nonterminal matching sprite is visible, and unfinished rows stay unfinished. The observer retains the 128 most recently accepted boards after raw history is pruned.

For Codex task replay, each board remembers maximum parsed-record sequences for its eight most recently accepted capture IDs. This memory survives restart and migrates the previous single-capture checkpoint. Known older or duplicate records from A remain ignored after B reports; an unseen later record from A can replace the board. Evicting a capture or board removes that replay protection. New records from different captures are ordered by receipt, since the source provides no shared update clock. Usage deduplication remains a separate durable accounting contract.

The adapter, restart, parent/child, replay, and terminal-session paths are covered by [synthetic source-contract integration tests](../tests/test_tasks_integration.py) through actual publishers and SQLite. [Browser tests](../tests/tasks-view.test.cjs) exercise text and focus behavior. These checks do not establish an installed OpenCode or Codex model session in this environment.

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
| Cursor | [Official hooks](https://cursor.com/docs/hooks) include session, tool, and subagent events. [Third-party hook compatibility](https://cursor.com/docs/reference/third-party-hooks) supports some Claude-style events. | A native mapper must preserve Cursor conversation/generation/subagent identities and verify the selected CLI surface. Permission-style hooks have different output requirements; blindly reusing a silent observer can be unsafe. Compatibility is not a tested dedicated integration. |
| GitHub Copilot | [Official hook reference](https://docs.github.com/en/copilot/reference/hooks-reference) documents user/repository hooks and separate camelCase and VS Code-compatible payload shapes. | A Copilot-specific config and mapper, identity/deduplication tests, explicit CLI/cloud/IDE coverage, and source-verified usage ingestion. Installing the Agent Office VS Code panel does not supply these runtime events. |
| Aider | [Official options](https://aider.chat/docs/config/options.html#--notifications-command-command) expose a notification command for response-ready notifications. | This is not evidence of a full session/tool/subagent/usage event feed. A reliable structured observation contract must be established before advertising full support. |

## Source contracts

Reviewed on 7–8 October 2026:

- [Codex hooks](https://learn.chatgpt.com/docs/hooks), [non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [pinned TypeScript event types](https://github.com/openai/codex/blob/624b45c4dcdc43a64da0307ce59c4508ef2206e9/sdk/typescript/src/events.ts), and [task item types](https://github.com/openai/codex/blob/624b45c4dcdc43a64da0307ce59c4508ef2206e9/sdk/typescript/src/items.ts).
- [OpenCode plugin events](https://opencode.ai/docs/plugins/#events), [pinned V2 schemas](https://github.com/anomalyco/opencode/blob/a697115b203395c54a7496dc3d1863fe7b319c0c/packages/sdk/js/src/v2/gen/types.gen.ts), and [source usage normalization](https://github.com/anomalyco/opencode/blob/a697115b203395c54a7496dc3d1863fe7b319c0c/packages/opencode/src/session/session.ts).
- [Hermes observer hooks](https://hermes-agent.nousresearch.com/docs/developer-guide/observer-hooks), [pinned request hook implementation](https://github.com/NousResearch/hermes-agent/blob/c538ec5f402e8078248becacd474e47a08c6e79a/agent/api_request_hooks.py), and [canonical usage model](https://github.com/NousResearch/hermes-agent/blob/c538ec5f402e8078248becacd474e47a08c6e79a/agent/usage_pricing.py).
- [Gemini hook reference](https://geminicli.com/docs/hooks/reference), [configuration](https://geminicli.com/docs/get-started/configuration/), and stable [v0.63.0 hook types](https://github.com/google-gemini/gemini-cli/blob/573846625af9e93b3b968e0e0b86bb093a4c9b16/packages/core/src/hooks/types.ts), [silent-success runner](https://github.com/google-gemini/gemini-cli/blob/573846625af9e93b3b968e0e0b86bb093a4c9b16/packages/core/src/hooks/hookRunner.ts), [agent-loop lifecycle](https://github.com/google-gemini/gemini-cli/blob/573846625af9e93b3b968e0e0b86bb093a4c9b16/packages/core/src/core/client.ts), [provider base URL](https://github.com/google-gemini/gemini-cli/blob/573846625af9e93b3b968e0e0b86bb093a4c9b16/packages/core/src/core/contentGenerator.ts), and [headless error cleanup](https://github.com/google-gemini/gemini-cli/blob/573846625af9e93b3b968e0e0b86bb093a4c9b16/packages/cli/src/utils/errors.ts).
