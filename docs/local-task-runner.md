# Local task runs

Agent Office can launch a new Codex or Claude Code task from its Tasks panel
when the standalone server is explicitly started with the local task runner.
The office remains an observer with the ordinary `python3 run.py` command.

## Start with a project

```sh
python3 run.py --enable-task-runner --workspace /absolute/path/to/project
```

Use `--workspace` again for another project. Install and sign in to the CLI
through its own supported setup before starting a run. The selector reports
whether the executable is on the server's PATH; finding it does not verify its
version, authentication, model access, or account balance.

If another office already uses port 8113, stop that server first or add an
unused port, for example `--port 8123`. An enabled runner exits with a clear
startup error when it cannot bind; it does not silently upgrade an observer
that is already running. Open the exact `127.0.0.1` URL printed after startup.

Open `http://127.0.0.1:8113`, then **Tasks → Local runs**. Choose a project,
runtime, and execution mode, write a brief, and select **Run task**. You can
also prepare text under **Draft prompt** and transfer it into the run form.
Copying, exporting, or transferring a brief does not start a run.

| Runtime | Modes | Behavior |
| --- | --- | --- |
| Codex | Read-only review; project edits | Starts a fresh `codex exec` with the selected `read-only` or `workspace-write` sandbox, using the selected project as its working directory. The prompt arrives on standard input. |
| Claude Code | CLI permissions | Starts a fresh print-mode task with `--permission-mode default --permission-prompts none`. Normal configured permissions apply, and any request for a new permission is denied because this view cannot answer it. Requires Claude Code **2.1.259 or later** for `--permission-prompts none`. |

Runs use the CLI's existing account and configuration. Model usage belongs to
that account. Agent Office does not collect credentials, select a paid plan,
change trust records, add automatic approval rules, or pass permission-bypass
flags. A configured project is a launch location, not an independent filesystem
sandbox: the runtime's own sandbox and permission policy govern tool access.

The initial adapters use the official
[Codex exec interface](https://github.com/openai/codex/blob/main/codex-rs/exec/src/cli.rs)
and [Claude CLI reference](https://code.claude.com/docs/en/cli-reference).
The application does not install or upgrade either runtime.

## Output and lifecycle

The selected run shows captured standard output and errors, its process state,
and its exit code. **Finished** means that the CLI exited with code zero. Read
the output and inspect the project changes to verify the task's outcome.
A CLI can describe a permission denial or an incomplete task even when its
process returns successfully.

On POSIX, **Cancel** sends termination to the run's process group and escalates
if the group does not exit. This also stops descendants that remain in that group,
including a child that still holds the captured output pipe after the original
CLI process exits. A descendant that deliberately detaches into a different
process group is outside this cleanup boundary.

On Windows, cancellation cleanup is **best-effort**. The runner starts a new
process group and sends `CTRL_BREAK_EVENT`, which can reach descendants in that
group only when they share the server's console; see Microsoft's
[console-event scope](https://learn.microsoft.com/en-us/windows/console/generateconsolectrlevent).
The fallback uses Python's
[`terminate()` / `kill()`](https://docs.python.org/3/library/subprocess.html#subprocess.Popen.terminate)
on the launched CLI process. Windows
[process termination does not terminate child processes](https://learn.microsoft.com/en-us/windows/win32/procthread/terminating-a-process),
so this does not guarantee descendant cleanup.

After cancellation, a run remains **Running** until its process is reaped and
the captured output reaches end-of-file, then becomes **Cancelled**; this keeps
the project slot occupied while cleanup is still in progress. A surviving
Windows descendant can keep that run and slot active by retaining a write
handle to the captured output pipe; the pipe cannot reach end-of-file until
[all its write handles close](https://learn.microsoft.com/en-us/windows/win32/ipc/anonymous-pipe-operations).
Cancellation does not revert file changes, recall requests already accepted by
a provider, or stop an agent launched separately from the run. Reuse a previous
prompt to prepare a new run; starting the new run remains an explicit action.

The runner permits at most two simultaneous runs and one per resolved project
path. These are process admission limits, not file locks on tools launched
elsewhere. It retains 256 KiB of combined standard output and errors for each
run. When a run exceeds that cap, the view says the captured text was truncated
while the server continues to drain the pipe so a chatty CLI cannot deadlock.

Run history, prompts, and output live in the server's memory for its current
lifetime. After runs settle, the runner keeps the 40 most recent entries; up to
two active entries can temporarily sit above that cap until completion pruning.
Restarting the server clears them. The CLI may keep its own transcripts under
its own retention policy. Copy output you need before restarting.

Launching a run does not create synthetic observer events, mark reported tasks
complete, award XP, or invent token costs. Installed runtime hooks can still
report their normal observations independently. The floor's task console uses
the local runner's actual status when available and opens **Local runs**;
without the runner it continues to open **Reported tasks**.

## Availability and request boundaries

The runner is available through the standalone loopback server. The public
static preview has no runner and never submits a run request. The Hermes
plugin's automatically started observer does not enable execution. Open the
local browser URL for task runs if an embedded or forwarded view cannot use
the endpoint.

Projects are allowlisted at startup. HTTP clients select a project ID and a
fixed runtime adapter; they cannot supply an executable, shell command, extra
arguments, or an arbitrary working directory. Prompts are bounded and passed
as input, never evaluated as shell command text. A prompt must contain a
non-whitespace character and is limited to 8,192 Unicode code points. The
complete JSON request body is independently limited to 64 KiB.

Every runner request requires the exact `127.0.0.1` Host and actual server port.
When an Origin header is present, it must be the matching
`http://127.0.0.1:<port>` origin; local non-browser clients may omit Origin.
Cross-site Fetch Metadata requests are rejected and the server sends no CORS
permission. Writes additionally require JSON and a random token scoped to this
server process. Repeated submissions with the same canonical UUID and payload
resolve to the same retained run; changing the payload under the same ID is
rejected. This lets the UI retry an uncertain response without starting
another process.

## Verification scope

The runner's Python and browser tests execute temporary local fixture programs.
They exercise HTTP admission, prompt delivery, output, failure, cancellation,
duplicate requests, and project concurrency without using a provider account.
Those checks establish the runner's behavior, not that an installed Codex or
Claude session completed a real provider-backed task on your computer.
Process-group cleanup has been exercised on POSIX. Windows cancellation,
including console-event delivery and descendant cleanup, has not been exercised
on a native Windows host for this update.

Full interactive terminals, attaching to existing sessions, responding to
their questions, cross-CLI conversation transfer, persistent task scheduling,
and automatic orchestration are separate capabilities and are not provided
by this initial local runner.
