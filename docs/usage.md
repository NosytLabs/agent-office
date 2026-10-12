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

The CI configuration caches dependency downloads, cancels superseded runs, and
skips documentation-only changes. Browser evidence is retained for three days
on **failed runs or explicit manual runs**, rather than uploaded after every
successful automatic run. The lightweight repository-hygiene workflow checks
Markdown changes without installing dependencies. The product-site workflow
uses scoped source paths and one-day Pages artifact retention.

These are configuration rules, not a promise that hosted CI is enabled or a
measurement of billed savings. Check the repository's actual Actions settings;
a disabled CI workflow cannot validate a commit. Do not delete successful
verification history to make a dashboard look green.

Local raw-history retention is separate from diagnostic log rotation and billing.
Use `python3 tools/maintain.py` for a read-only storage report. Do not truncate
live SQLite files, delete the pending inbox, or run a blanket ignored-file cleanup
against runtime data. [Safe maintenance](architecture.md#diagnostic-logs-and-safe-cleanup).
