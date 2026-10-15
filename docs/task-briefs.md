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

Use **Export briefs** to download `agent-office-briefs.json`, a backup of this
view's saved library. It preserves every brief's name, text, destination and saved
identity. Export does not include the open draft or change either saved data or
the separate tab-draft preference.

Use **Import briefs** and choose an exported JSON file. Choosing a file only opens
a review: the saved library stays unchanged. The review lists incoming names,
destinations and text lengths; expand an entry to read its full text. It shows the
incoming and current counts, then offers three explicit choices:

- **Merge briefs** adds all incoming briefs while keeping every existing entry.
  A repeated saved identity, a name already in use (ignoring case), or a combined
  count above 12 blocks the entire merge. No entry is silently skipped or replaced.
- **Replace saved library** removes the saved entries listed in the replacement
  count and saves exactly the incoming library. An empty backup explicitly replaces
  the saved library with zero entries.
- **Cancel** leaves the saved library and open draft unchanged.

Imports accept only the exported version-one format, with exactly `version` and
`briefs` at the top level and `id`, `name`, `runtime` and `text` in each entry.
The entire UTF-8 file must fit within 1 MB (1,048,576 bytes). Existing name,
destination, 12-entry and 8,192-character limits still apply. Unsupported versions,
extra fields, malformed text and invalid entries reject the whole file. A failed
write leaves the previous saved library intact and keeps the review available
for an explicit retry.

Selecting another file, cancelling, changing task views or closing Tasks
invalidates an unfinished import review. An older file read cannot replace a
newer review. A library change from another tab also invalidates the review;
choose the backup again to review the latest saved entries before importing.
An import queued behind another save is checked again before it writes. Import
and export never contact a runtime or change the open draft's destination.

Saved-brief changes are serialized across cooperating browser tabs and checked
against the stored revision. A stale view asks for review/retry instead of
silently replacing other saved entries. Invalid data and unavailable/quota-full
storage leave the previous library and draft untouched. Browsers without the
required write coordination can still read, export and load saved briefs, inspect
an import review, and use the draft; Save/Rename/Delete and import confirmation
are unavailable. **Retry reading saved briefs** retries a
failed read without deleting stored data. This library is browser-local; it is
not included in the observer's settings export. Use its explicit backup file to
move saved briefs to another browser or between the separate demo/observer views.

The library does not change the separate **Keep this draft in this tab** choice.
That choice controls the current draft; saving a reusable brief is always explicit.
