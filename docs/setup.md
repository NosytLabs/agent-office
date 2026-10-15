# Set up Agent Office

[Back to the README](../README.md) · [Runtime event coverage](runtime-observers.md)

## Choose what to run

| Mode | Command from the checkout | What it does |
| --- | --- | --- |
| Your local office | `python3 run.py` | Serves your locally recorded sessions; no runtime configuration changes |
| Safe local demo | `python3 demo_feed.py` | Creates temporary synthetic activity on port 8114 |
| Preview integrations | `python3 install.py --dry-run` | Detects existing installations; does not write their configuration |
| Connect a runtime | `python3 install.py --only codex` | Adds observer definitions only for the selected detected runtime |
| Optional task execution | See the [local runner guide](local-task-runner.md) | Launches new supported CLI tasks only after you enable it |

Normal use requires Python 3.10+ with SQLite, Git for cloning/updating, and a
modern browser. npm and Playwright are development tools, not installation
requirements. The local observer itself does not call model providers.

## First connection

Keep the server terminal open. In another terminal, change into the same checkout
and run `python3 install.py --dry-run`. This previews detection, not whether every
runtime configuration file is valid. It neither installs CLIs nor tests provider
credentials.

Select one or more detected integrations:

```sh
python3 install.py --only codex
python3 install.py --only claude opencode
```

These are alternatives; run the selection you actually use. Options are `hermes`,
`opencode`, `claude`, `codex`, `gemini`, and `vscode`. `--only` can be repeated;
duplicates are connected once. With no selection, `python3 install.py` keeps the
existing behavior of connecting all detected integrations. `--help` is read-only;
unknown options fail before any configuration is changed.

Restart the selected runtime and generate an ordinary session/tool event. Follow
its own trust prompts. Keep the checkout in place: observer definitions reference
files here. Rerun installation if you move or update it. Existing unrelated
configuration is preserved; an invalid configuration file is reported rather
than replaced.

## Runtime-specific steps

| Runtime | Installed connection | Important next step |
| --- | --- | --- |
| Hermes | Enables the local `pixel-office` plugin | Restart Hermes; CLI and Telegram sessions share its events |
| OpenCode | Local plugin URL | Existing JSONC needs the printed manual edit; restart OpenCode |
| Claude Code | Hooks in `~/.claude/settings.json` | Restart Claude Code and keep the observer running |
| Codex | `hooks.json` in `$CODEX_HOME` or `~/.codex` | Review/trust hooks through Codex `/hooks` |
| Gemini CLI | Four lifecycle hooks in `~/.gemini/settings.json` | Respect disabled hooks and workspace trust; restart Gemini |
| VS Code | Local extension files | Reload the window; run **Agent Office: Open Floor** |

A connected runtime does not necessarily report tokens or costs. Consult the
[usage guide](usage.md). VS Code packaging and simulated API checks are not the
same as verifying every extension-host or remote-development environment; see
[extension setup](../vscode/README.md) and [validation limits](audit/README.md).

## Ports and data location

The office binds to `127.0.0.1`, not your public network interface.

```sh
python3 run.py --port 8120
```

Open the port printed by the server. `--port` overrides `AGENT_OFFICE_PORT`.
Invalid port values receive a command-line error rather than a traceback.
`python3 run.py --help` works even when that environment variable is malformed.

Observer requests accept `127.0.0.1`, `localhost`, and `[::1]` Host headers only
at the actual listening port. Browser API requests must use that same origin;
foreign/null origins and cross-site requests are rejected. This also protects
settings changes and history/reset actions from websites that resolve their own
hostname to loopback. Direct local HTTP clients can continue using the API
without browser headers. The listener itself remains IPv4 loopback.

For a VS Code or other trusted forwarding service that exposes a different
browser origin, explicitly allow that exact origin when starting the observer:

```sh
python3 run.py --observer-origin https://office.example-forwarder.test
```

Repeat `--observer-origin` for each required origin. The equivalent
`AGENT_OFFICE_OBSERVER_ORIGINS` environment variable takes comma-separated
origins and also works for the Hermes-started observer. Include a nondefault
port when present; omit paths, query parameters, credentials, and wildcards.
Restart after changing the allowlist. A trusted forwarder may preserve its
public Host or rewrite it to the observer's loopback Host. Proxy forwarding
headers do not grant trust. Only add forwarding endpoints you control and keep
their access controls enabled: this exposes the observer's recorded activity
and editing/reset API through that endpoint. This allowlist does not change
the local task runner's separate loopback/token checks.

Default data lives in `~/.hermes/pixel-office`. To use a different location, set
the **same `HERMES_HOME`** for the server, installer, and runtime processes.
For example, in each macOS/Linux shell:

```sh
export HERMES_HOME="$HOME/.agent-office-data"
```

On PowerShell, use `$env:HERMES_HOME = "$HOME/.agent-office-data"` in each shell.
Changing this variable changes which office you see; it does not migrate existing
history. Preserve or back up the old directory before changing your setup.

## Windows and WSL

The Windows Python launcher can run the server with `py -3 run.py`. Check that
`py -3 --version` is at least 3.10 and use `py -3` for the installer/demo commands.
The server uses standard-library components, but not every native Windows CLI
hook, shell invocation, or VS Code host has been exercised.

For agents running in WSL, run the office and installer inside that same WSL
distribution so paths, executables, and data locations agree. Mixing a Windows
installer with a WSL runtime is not a shared configuration by default.

## In-app connection guide

Selecting a runtime updates the copied installer command to use `--only` for
that integration. **Telegram via Hermes** selects `--only hermes`, not a separate
Telegram installer. VS Code selects `--only vscode`. Add `--dry-run` to inspect
the setup plan first. Copying or selecting a command never runs it automatically.

A disconnected data panel includes **Retry connection** and labels the retained
snapshot. Start the local server first; a responding server alone does not prove
that a particular runtime is publishing events.

## Troubleshooting

**The room is empty.** Confirm the browser is on the local port printed by
`run.py`, not the hosted demo. Preview detection, install the selected integration,
restart that runtime, and generate activity. Check both processes use the same
data directory. The Connection guide distinguishes a reachable server from
received runtime events.

**Python or Git is not found.** Install those prerequisites and reopen the
terminal. The app does not require an npm installation. In Windows, try `py -3`
instead of `python3`.

**The port is in use.** An office may already be serving that data. Check the
existing local page, or choose another port. Do not kill an unrelated process to
free a port. The task runner intentionally refuses to attach itself to an
existing observer-only server.

**Tokens/cost are missing.** Missing reports are not zero-cost work. Claude and
Gemini lifecycle hooks do not provide usage counters. See [coverage by runtime](usage.md#which-runtimes-report-usage).

**Settings cannot be saved.** Reopen the editor after a revision conflict. For
unreadable or malformed local settings, back up and repair the file; do not delete
the office directory. Ingestion continues while unsafe edits and pruning pause.

**Updating failed.** Use `git status` to inspect your local edits, preserve them,
and pull with `git pull --ff-only`. After an update, rerun the installer for your
selected runtimes and restart both the observer and those runtimes.

Before sharing logs or screenshots, remove secrets, prompts, project paths, and
other private content. Report the commit, OS, Python version, runtime, and exact
reproduction steps using the [bug form](https://github.com/NosytLabs/agent-office/issues/new/choose).
