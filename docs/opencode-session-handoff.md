# OpenCode session handoff

The local task runner starts a **fresh** CLI process per run. The session
handoff adapter is separately enabled: it sends a reviewed prompt to an
**existing** OpenCode session on an already-running local OpenCode server,
and it keeps a durable delivery
receipt for every submission so a lost acknowledgement can be reconciled
instead of retried blind.

This adapter currently exposes an HTTP API. The browser interface for reviewing
a destination, pairing, and sending is still to be built. Copying a prompt from
Tasks does not submit it through this adapter. Follow-up interface work is tracked
in [issue #18](https://github.com/NosytLabs/agent-office/issues/18).

The adapter is off unless the standalone server is started with it:

```sh
python3 run.py --enable-opencode-handoff
```

It is independent of `--enable-task-runner`; either, both, or neither may be
enabled. The public preview and the Hermes observer never enable it.

## Pairing

Nothing can be dispatched until a destination is paired, and pairing is a
review step, not a side effect of browsing the office:

1. The caller supplies the server origin, a session ID, and the project
   directory they reviewed.
2. The adapter requires the origin to be a loopback `http://127.0.0.1:<port>`
   (or `localhost` / `[::1]`) origin with no credentials, path, or query.
3. It probes `GET /global/health` and records the reported runtime version,
   then reads `GET /session/<id>` and requires the session's own reported
   project directory to resolve to exactly the reviewed directory. A stale
   or mismatched selection is rejected before anything can be sent.

Pairing is persisted in the receipts ledger, so it survives a server
restart. Before every submission the adapter re-checks the health version
and the session's directory against the pairing and refuses to dispatch if
either changed. **Unpair** clears the pairing; receipts are retained.

## Submission and receipts

A submission takes the exact prompt text and a caller-chosen canonical UUID
request ID, the same idempotency contract as the task runner:

- The operation is written to the durable ledger **before** dispatch, in
  state `submitted`. Its identity therefore survives crashes, restarts, and
  reconnects.
- Repeating a submission with the same request ID and prompt returns the
  existing receipt and never dispatches again. Reusing the ID with a
  different prompt is rejected.
- The prompt is sent verbatim as a single text part to
  `POST /session/<id>/prompt_async`. It is data for the runtime, never a
  shell command. The 8,192 code-point bound matches the task runner.
- At most two operations may be active at once.

Receipts live in `opencode-handoff.json` in the office directory, written
atomically (temporary file, fsync, rename). The ledger retains at most 200
operations; only terminal receipts are pruned. Office reset, history prune,
XP, usage, and the task runner never read or write this file. A corrupt
ledger is an explicit error — it is never silently reset, because losing
receipts would break the no-duplicate guarantee.

## Delivery states

States come from the runtime, not from process exit codes:

| State | Meaning |
| --- | --- |
| `submitted` | Recorded durably; dispatch in progress or not yet reconciled. |
| `accepted` | The runtime acknowledged the async submission (HTTP 204). This is **not** proof of completion. |
| `executing` | Runtime history shows the prompt and the session is busy or retrying. |
| `awaiting_input` | The session has a pending permission or question request. The office reports the wait; it never answers it. |
| `completed` | The assistant message after the delivered prompt finished without an error. |
| `failed` | The runtime reported an error for the turn or dispatch definitively failed before the runtime could accept it. |
| `rejected` | The runtime refused the submission with a client error. |
| `cancelled` | Cancellation was acknowledged and the runtime recorded the turn as aborted. |
| `unknown` | A dispatch may have been accepted but its acknowledgement was lost (timeout, reset, unexpected status or office restart before the receipt was updated). No history trace yet does not establish that the asynchronous prompt was never received. |

**Refresh** reconciles one operation against runtime history: it looks for
the exact prompt text after the history watermark recorded at submission,
then maps session status, pending permission/question requests, and the
following assistant message onto the states above. An `unknown` operation
whose prompt is found is confirmed delivered without any resubmission; one
with no trace stays `unknown` rather than being resent or declared failed.
Even a receipt still marked `submitted` after an office crash moves to
`unknown` if the runtime has no visible history yet: the caller must not
automatically create a new request ID to retry uncertain work.

## Cancellation

**Cancel** posts to `POST /session/<id>/abort` for the paired session only.
The receipt records the request, and cancellation becomes terminal only
when the runtime confirms the turn stopped (an aborted assistant message).
Cancelling never changes runtime trust, approval, or permission settings.

## Boundaries

- Loopback only: the same exact-Host, Origin, Fetch Metadata, and
  per-process token checks as the task runner guard every handoff route
  (`GET /opencode-handoff`, `POST /opencode-handoff/pair|unpair|submit`,
  `POST /opencode-handoff/<id>/refresh|cancel`).
- No credentials are accepted, stored, sent, or logged. The adapter sends
  no `Authorization` header, ignores system HTTP proxy settings for its private
  loopback exchanges, and never follows redirects.
- Runtime error details are redacted to a short printable summary before
  they reach a receipt; raw response bodies are not retained.
- Furniture clicks, labels, logs, and model output can never dispatch a
  prompt: the only dispatch path is the explicit submit route.

## Verification scope

`tests/test_opencode_handoff.py` exercises the adapter against a synthetic
in-process transport, and `tests/test_opencode_handoff_http.py` against a
synthetic OpenCode HTTP server. They cover pairing rejection (wrong origin,
unpaired, unhealthy runtime, stale project), literal prompt preservation,
duplicate submission, lost-acknowledgement reconciliation, rejection,
permission/question waits, cancellation, restart durability, and ledger
pruning. These are contract tests with fixtures.

They do **not** establish that an installed OpenCode runtime completed a
provider-backed task. That verification is separate and still outstanding:
the installed v2.0.29 adapter's provider path is account-gated (an active
OpenCode Go subscription was required in the last smoke test), so
authenticated provider execution remains unverified until it is exercised
with a working account. The browser interface will use the HTTP contract above;
its interaction flows are not covered by these adapter tests.
