# Saved task briefs

Open **Tasks → Draft prompt**. Write the brief, choose its destination, and use
**Saved briefs → Save current draft** with a name. The library holds up to 12
briefs in this browser; the demo and local observer keep separate libraries.
Each brief stores its exact text and destination. Names are limited to 48
characters and briefs to the existing 8,192-character draft limit.

Search by name, destination or text. **Load** places a saved brief into an empty
draft. If a draft already contains text, review the saved text and choose
**Replace draft**, **Append to draft**, or **Cancel**. Replace uses the saved
destination; Append keeps your current destination and inserts two newlines.
If the draft changes while review is open, the next confirmation asks you to
review it again. An append that exceeds the limit leaves the draft unchanged.

**Rename** changes only the saved name. **Delete** asks for an inline confirmation
and removes only that saved entry; it leaves the open draft intact. Saving a
name already in use fails explicitly rather than replacing a different brief.
Loading or saving never submits a prompt, starts a local run, approves a request,
creates observer events, or changes usage/XP. Review the draft and use its existing
copy or explicit Local runs flow separately.

Saved-brief changes are serialized across cooperating browser tabs and checked
against the stored revision. A stale view asks for review/retry instead of
silently replacing other saved entries. Invalid data and unavailable/quota-full
storage leave the previous library and draft untouched. Browsers without the
required write coordination can still read saved briefs and use the draft;
Save/Rename/Delete are unavailable. **Retry reading saved briefs** retries a
failed read without deleting stored data. This library is browser-local; it is
not included in the observer's settings export or shared with another browser.

The library does not change the separate **Keep this draft in this tab** choice.
That choice controls the current draft; saving a reusable brief is always explicit.
