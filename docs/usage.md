# Usage, estimates, and resource costs

[Back to the README](../README.md) · [Runtime contracts](runtime-observers.md)

## Read the usage panel

Usage cards and agent inspectors display only fields supplied by runtime reports.
The breakdown groups those observations by runtime and model.

| Display | Meaning |
| --- | --- |
| **Not reported** | The source has not supplied this field; it is not an estimate of zero |
| **0** or **$0.00** | A source explicitly reported zero; a zero cost can still reflect missing runtime pricing |
| **Partial coverage** | Only the displayed number of reports supplied that field |
| **Amount too large** | The known aggregate exceeds the finite number range; it is not missing data |
| **Runtime estimate · USD** | A source's cost estimate, not a provider invoice |

Input includes cached-input tokens; output includes reasoning tokens. Cache and
reasoning rows describe those subsets and must not be added again to the total.
A model, cache count, or cost source that was not reported is left unknown.
Very small positive costs remain visible rather than rounding to zero.

Unchanged polling preserves the usage-breakdown DOM instead of rebuilding rows
and cost-source text on every refresh. New reports still update the display.

## Find work and understand freshness

In **Agents**, combine the runtime selector, status buttons, and text search to
find an agent by name, session, tool, or reported file/command preview. **Needs
input** is based on actual waiting observations, not an inferred timeout.
**Active** combines working and thinking; **Ended** contains reported ended
sessions that are still visible. These are session states, not proof that code
passed review. Counts on the status buttons reflect the selected runtime before
text search. The line underneath reports the final result count.

**Clear filters** resets the three controls and returns focus to search. These
view choices are stored only in this browser, separately for the local observer
and public demo; they do not change room settings, event history, or XP. The
canvas runtime filter is independent. Usage and observed-activity totals below
the roster retain their full scope, even when only one runtime is shown above.

If a refresh fails, Agents, Tasks, Activity, and the inspector show a visible
**Observer disconnected** notice with the last successful response time. You can
still inspect retained data, but its status may be stale. **Retry connection**
requests a refresh without starting a second polling loop. A successful response
removes the notice and keeps keyboard focus inside the panel.

Connected visible tabs wait 1.5 seconds between completed state requests. Hidden
tabs wait 15 seconds, while returning to the foreground refreshes immediately.
Repeated failures back off from 1.5 to 15 seconds. There is at most one active
state request and one scheduled follow-up per page; page exit cancels both.
These are request scheduling rules, not a claim of measured battery or billing
savings. Event publication and persistent accounting are unchanged.

Agent cards display the runtime, tool, and source-supplied detail together.
Unchanged portraits reuse their pixels; a newly loaded or changed appearance
repaints. This does not slow the office's character-animation loop.

## Which runtimes report usage

| Connection | What the current adapter reports |
| --- | --- |
| Hermes | Supported main-loop API usage hooks; coverage depends on the installed runtime |
| OpenCode | Assistant-message token counters and runtime cost estimates |
| Codex | Usage from an already captured `codex exec --json` stream, imported with a stable capture ID |
| Claude Code hooks | Lifecycle/tool activity, not token or cost counters |
| Gemini CLI hooks | Lifecycle activity, not token or cost counters |

The [runtime guide](runtime-observers.md) contains exact event semantics and the
Codex capture-import command. The office does not invent missing pricing, infer
usage from animation, or treat session completion as proof that a task succeeded.

## Cost threshold

Set a USD threshold in Customize to receive a visual usage alert. It compares
against the retained usage ledger, not a daily or monthly billing period. Set
**0** to turn it off. The alert does not stop tasks, impose a provider spending
cap, or change permissions. An overflowed known cost still triggers a positive
threshold; a genuinely unknown cost does not produce a made-up amount.

Clearing raw activity history does **not** reset usage accounting. **Reset
progress** also resets the usage ledger and XP; it is not a harmless way to hide
a cost alert. See [storage and reset boundaries](architecture.md).

## What Agent Office does not measure

This panel is **not your ChatGPT subscription, OpenAI API account, GitHub Actions,
or Vercel billing meter**. Each service accounts for its own activity. Running
the observer, moving sprites, feeding fish, or playing arcade games does not
call a model. Explicitly launched CLI tasks use that CLI's configured account
and may incur its normal charges.

## Keep development and hosting usage predictable

Ordinary users need only the Python server. npm dependencies, browser binaries,
screenshots, and build output are for development and are excluded from Git.
Do not run full browser tests simply to start the office.

The CI configuration caches dependency downloads and cancels superseded runs.
Its full verification gate runs for every pull request and push to `main`,
including documentation changes, so required checks are consistently present.
Browser evidence is retained for three days on **failed runs or explicit manual
runs**, rather than uploaded after every successful automatic run. The lightweight
repository-hygiene workflow also checks every change without installing
dependencies: deleting an asset can break a link in an unchanged Markdown file.
The product-site publishing workflow uses scoped source paths and one-day Pages
artifact retention.

These are configuration rules, not a promise that hosted CI is enabled or a
measurement of billed savings. Check the repository's actual Actions settings;
a disabled CI workflow cannot validate a commit. Do not delete successful
verification history to make a dashboard look green.

Local raw-history retention is separate from diagnostic log rotation and billing.
Use `python3 tools/maintain.py` for a read-only storage report. Do not truncate
live SQLite files, delete the pending inbox, or run a blanket ignored-file cleanup
against runtime data. [Safe maintenance](architecture.md#diagnostic-logs-and-safe-cleanup).

## Inspect and copy a session snapshot

The Agents panel keeps search and runtime/reset controls compact. On narrow
screens the status buttons scroll horizontally; swipe the strip or use Tab to
reach every status. Session names and activity no longer compete with a separate
status column for the same small width. Usage below the roster still includes
all recorded runtimes; filtering the list does not filter accounting totals.

Select a session to see its identity, reported activity, usage, and recent events
before its cosmetic settings. Unchanged command and session-ID text survives
polling, so selecting it for copying is not interrupted by elapsed-time updates.
**Customize agent** jumps to the name/preferences controls; Back restores the
previous panel, filters, scroll position, and focused card.

**Copy summary** captures a read-only snapshot of this one session at the time of
the click. It includes the runtime, session ID, reported status, activity preview,
last response time, and reported usage with its coverage. It labels synthetic
demo data and disconnected/retained data explicitly. Previews can be truncated;
use **Saved activity** and the original runtime for full context.

Copying does not submit a task, connect to a provider, grant permission, write
settings, or award XP. Clipboard-denied browsers show a readonly, selected text
field for your device's Copy action. That captured text is not rewritten by
polling and is cleared when you switch sessions. A late clipboard result cannot
insert another session's report into the new inspector. No report is persisted to
browser storage or the server. Review paths and command previews before sharing.

## Export exactly the activity you need

In **Activity → Saved**, combine the search and runtime filter, or open **Saved
activity** from one session. **Export matching** downloads every saved match,
including rows beyond the first displayed page. **Export all saved** deliberately
ignores those filters and can include other sessions. Both download JSON locally;
neither uploads events or changes XP, retention, or accounting.

A matching export records its search, runtime, and session in the JSON `filters`
field. Those filters are captured when you click, before refreshing saved history;
changing the view while it loads cannot widen the requested export. An all-history
export uses `filters: null`. A failed refresh does not download a stale fallback.
Review command previews and paths before sharing either file.
