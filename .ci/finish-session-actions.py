"""Finish the reviewed session actions on the pinned usability branch."""
from pathlib import Path
import json

p = Path('web/js/office.js')
s = p.read_text()
old = '''function selectAgent(id) {
  focusedId = id;
  updateScene();
  fillInspector();
  openSheet("sheet-inspector");
}'''
new = '''function selectAgent(id) {
  const changed = focusedId !== id;
  if (changed) panelViews.delete("sheet-inspector");
  focusedId = id;
  updateScene();
  fillInspector();
  if (opened !== "sheet-inspector") openSheet("sheet-inspector");
  else {
    // Selecting a session is not the same action as toggling its panel.
    if (changed) {
      const panel = $("sheet-inspector"), heading = panel.querySelector("h2");
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      panel.scrollTop = 0;
    }
    persistView();
  }
}'''
assert s.count(old) == 1
s = s.replace(old, new, 1)
start = s.index('function fillEvents() {')
end = s.index('  reconcileEventRows(', start)
s = s[:start] + '''function currentEventFilter() {
  return {
    query: eventQuery.trim(),
    runtime: eventRuntime,
    session: eventSession
      ? { id: eventSession.id, platform: eventSession.platform }
      : null,
  };
}
function matchingEvents(source, filters) {
  const q = filters.query.toLowerCase();
  return source.filter(
    (event) =>
      (!filters.session ||
        ((event.session_id === filters.session.id ||
          event.child_session_id === filters.session.id) &&
          canonicalRuntime(event.platform) === filters.session.platform)) &&
      (filters.runtime === "every" || platOf(event) === filters.runtime) &&
      [JSON.stringify(event), EVENT_NAMES[event.event], eventText(event)]
        .join(" ")
        .toLowerCase()
        .includes(q),
  );
}
function fillEvents() {
  const box = $("eventbox"), filters = currentEventFilter();
  const source =
    eventMode === "history"
      ? historyEvents
      : (window._state?.events || []).slice().reverse();
  const events = matchingEvents(source, filters);
''' + s[end:]
old = '''  $("export-history").disabled = historyLoading;'''
new = '''  $("export-history").disabled = historyLoading;
  $("export-filtered-history").disabled = historyLoading;
  $("export-filtered-history").hidden =
    !filters.query && filters.runtime === "every" && !filters.session;'''
assert s.count(old) == 1
s = s.replace(old, new, 1)
start = s.index('$("export-history").onclick = async () => {')
end = s.index('\nfunction fillBadges()', start)
s = s[:start] + '''async function exportHistory(filters = null) {
  if (!(await loadHistory(true))) return;
  downloadBlob(
    new Blob(
      [JSON.stringify({
        version: 1,
        exported_at: new Date().toISOString(),
        filters,
        events: filters ? matchingEvents(historyEvents, filters) : historyEvents,
      }, null, 2)],
      { type: "application/json" },
    ),
    filters ? "agent-office-filtered-history.json" : "agent-office-history.json",
  );
}
$("export-history").onclick = () => exportHistory();
// Capture the user's scope before refreshing; later edits cannot widen this export.
$("export-filtered-history").onclick = () => exportHistory(currentEventFilter());
''' + s[end:]
p.write_text(s)
p = Path('web/template.html')
s = p.read_text()
old = '''      <button class="btn" id="export-history">Export saved history ↓</button>'''
new = '''      <div class="cluster history-export-actions">
        <button class="btn" id="export-filtered-history" type="button" hidden
          title="Download all saved events matching the current search, runtime, and session filters, including additional pages">
          Export matching ↓
        </button>
        <button class="btn" id="export-history" type="button"
          title="Download all loaded saved events, including sessions hidden by the current filters">
          Export all saved ↓
        </button>
      </div>'''
assert s.count(old) == 1
p.write_text(s.replace(old, new, 1))
p = Path('web/css/style.css')
p.write_text(p.read_text() + '''
.history-export-actions {
  flex-wrap: wrap;
  margin-top: 12px;
}
.history-export-actions .btn {
  min-height: 44px;
}
''')
p = Path('package.json')
data = json.loads(p.read_text())
assert 'tests/session-actions.test.cjs' not in data['scripts']['test:browser']
data['scripts']['test:browser'] += ' tests/session-actions.test.cjs'
p.write_text(json.dumps(data, indent=2) + '\n')
p = Path('README.md')
s = p.read_text()
old = 'its preferences without losing your filtered list.'
assert s.count(old) == 1
p.write_text(s.replace(old, old + ' Saved activity offers separate\n**Export matching** and **Export all saved** downloads, so you choose what to share.', 1))
p = Path('docs/usage.md')
p.write_text(p.read_text() + '''
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
''')
