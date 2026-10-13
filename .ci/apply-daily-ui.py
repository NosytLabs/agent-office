from pathlib import Path
import json

def replace(text, old, new):
    assert text.count(old) == 1, ('unexpected source match', old[:100], text.count(old))
    return text.replace(old, new, 1)

p = Path('web/template.html'); s = p.read_text()
s = replace(s, 'Observed sessions, with blocked agents first. Select one for details.', 'Needs input first. Select a session.')
s = replace(s, '      <div id="usagebox"></div>', '      <p class="h usage-scope">All recorded runtimes; not narrowed by the agent filters.</p>\n      <div id="usagebox"></div>')
s = replace(s, '''      <button class="btn" id="agent-follow" aria-pressed="false" hidden>
        Follow on floor
      </button>''', '''      <div class="cluster inspector-actions" id="inspector-actions" hidden>
        <button class="btn" id="inspector-copy" type="button">Copy summary</button>
        <button class="btn" id="inspect-history" type="button" aria-label="View saved activity">Saved activity</button>
        <button class="btn" id="agent-follow" type="button" aria-pressed="false" hidden>Follow on floor</button>
        <button class="btn" id="inspector-customize" type="button">Customize agent</button>
      </div>
      <p class="h" id="inspector-copy-status" role="status"></p>
      <div id="inspector-report" hidden>
        <label class="setting-label" for="inspector-report-text">Selected session snapshot — review before sharing</label>
        <textarea id="inspector-report-text" class="txt" rows="8" readonly aria-label="Session report to copy"></textarea>
      </div>
      <div id="inspectorbox"></div>''')
s = replace(s, '''      <div id="inspectorbox"></div>
      <button class="btn" id="inspect-history">View saved activity</button>''', '')
s = replace(s, '''        This office reflects events from your coding agents. It does not run
        tasks or approve actions. Pets and room objects are decoration.''', '''        This office observes your coding agents by default. Tasks → Local runs
        can start a fresh Codex or Claude Code task only after you enable the
        local runner. Existing sessions and approvals stay in the original
        runtime. Room toys do not run agent commands.''')
s = replace(s, '''        Run <code>python3 install.py</code> from the repository, restart your
        runtime, and keep <code>python3 run.py</code> open. The installer
        detects Hermes, OpenCode, Claude Code and VS Code.''', '''        Open the Connection guide to choose a runtime. Preview setup with
        <code>python3 install.py --dry-run</code>, then connect only what you
        use with <code>--only</code>. Restart the runtime and keep
        <code>python3 run.py</code> open. The installer detects Hermes,
        OpenCode, Claude Code, Codex, Gemini CLI, and the VS Code view.''')
s = replace(s, 'https://github.com/NosytLabs/agent-office#troubleshooting', 'https://github.com/NosytLabs/agent-office/blob/main/docs/setup.md#troubleshooting')
p.write_text(s)

p = Path('web/js/office.js'); s = p.read_text()
s = replace(s, 'let sessionUsageIndex = new Map();', 'let sessionUsageIndex = new Map();\nlet inspectorCopyVersion = 0;')
s = replace(s, 'Observed sessions, with blocked agents first. Select one for details.', 'Needs input first. Select a session.')
s = replace(s, '''    const label = document.createElement("strong"),
      runtime = document.createElement("small"),''', '''    const heading = document.createElement("div"),
      label = document.createElement("strong"),
      runtime = document.createElement("small"),''')
s = replace(s, '    body.append(label, runtime, elapsed, usage);', '''    heading.className = "agent-heading";
    heading.append(label);
    body.append(heading, runtime, elapsed, usage);''')
s = replace(s, '  if (!existing) button.append(portrait, body, status);', '''  if (!existing) {
    body.querySelector(".agent-heading").append(status);
    button.append(portrait, body);
  }''')
s = replace(s, '`${list.length} of ${agents.length} sessions shown. Usage totals below include all recorded runtimes, not just this view.`', '`${list.length} of ${agents.length} sessions shown.`')
start = s.index('function fillInspector()'); end = s.index('function syncAgentFollow()', start)
f = s[start:end]
f = replace(f, '''  if (!a) {
    summary.replaceChildren();''', '''  resetInspectorReport(a?.id);
  $("inspector-actions").hidden = !a;
  if (!a) {
    setHTMLIfChanged(summary, "");''')
f = replace(f, '  const headline = document.createElement("div"),', '  const content = document.createElement("div"),\n    headline = document.createElement("div"),')
f = replace(f, '  summary.replaceChildren(headline, activity);', '  content.append(headline, activity);')
f = replace(f, '''  metadata.innerHTML = kv([
    ["Session", a.id],
    ["Parent", a.parent || "—"],
    ["Elapsed", duration(a.duration_s)],
    ["Since event", duration(a.idle_s)],
  ]);
  metadata.prepend(runtimeBadge(a));''', '''  if (!metadata.children.length) {
    metadata.innerHTML = kv(["Session", "Parent", "Elapsed", "Since event"].map((name) => [name, ""]));
    const runtime = document.createElement("div");
    runtime.className = "inspector-runtime";
    metadata.prepend(runtime);
  }
  const runtime = metadata.querySelector(".inspector-runtime");
  if (contentSignatures.get(runtime) !== a.platform) {
    runtime.replaceChildren(runtimeBadge(a));
    contentSignatures.set(runtime, a.platform);
  }
  const values = [a.id, a.parent || "—", duration(a.duration_s), duration(a.idle_s)];
  metadata.querySelectorAll(".kv b").forEach((value, index) => setText(value, values[index]));''')
f = replace(f, 'summary.append(note);', 'content.append(note);')
f = replace(f, 'summary.append(waiting);', 'content.append(waiting);')
f = replace(f, '''    waiting.textContent = `Respond in ${runtimeName(a)}. This request stays open until the runtime reports a response or closes the session. Last observed: ${new Date(Number(a.observed_at ?? a.updated_at) * 1000).toLocaleString()}`;''', '''    const observed = a.observed_at ?? a.updated_at;
    const when = typeof observed === "number" && Number.isFinite(observed)
      ? new Date(observed * 1000) : null;
    const stamp = when && Number.isFinite(when.getTime())
      ? "Last reported: " + when.toLocaleString() : "Request time not reported.";
    waiting.textContent = `Respond in ${runtimeName(a)}, not here. ${stamp}`;''')
f = replace(f, '  const usageSection = section("usage");', '  setHTMLIfChanged(summary, content.innerHTML);\n  const usageSection = section("usage");')
s = s[:start] + f + s[end:]
helpers = '''function resetInspectorReport(id) {
  const report = $("inspector-report");
  if (report.dataset.agent === (id || "")) return;
  inspectorCopyVersion++;
  report.dataset.agent = id || "";
  report.hidden = true;
  $("inspector-report-text").value = "";
  $("inspector-copy-status").textContent = "";
}
function sessionReport(agent) {
  const metrics = sessionUsageForAgent(agent);
  const received = lastObserverResponse === null
    ? "Not received"
    : new Date(lastObserverResponse).toISOString();
  return [
    "Agent Office — session snapshot",
    "Source: " + (window._state?.mode === "demo" ? "Synthetic demo" : "Local observer"),
    "Freshness: " + (offline
      ? "Observer disconnected — retained data; it may be stale."
      : "Last received snapshot; not a live process guarantee."),
    "Received: " + received,
    "Session: " + agent.id,
    "Runtime: " + runtimeName(agent),
    "Name: " + (agent.label || agent.id),
    "Reported status: " + (STATUS_NAMES[agent.status] || agent.status || "Not reported"),
    "Tool: " + (agent.tool || "Not reported"),
    "Activity preview: " + (agent.detail || "Not reported"),
    "Total tokens: " + usageValue(metrics, "total_tokens") + " · " + usageCoverage(metrics, "total_tokens"),
    "Runtime cost estimate (USD): " + usageValue(metrics, "cost_usd") + " · " + usageCoverage(metrics, "cost_usd"),
    "",
    "Preview text may be truncated. Check saved activity and the original runtime for full context.",
    "This report does not send a task or grant approval. Resolve input in the original runtime.",
  ].join("\\n");
}
$("inspector-copy").onclick = async () => {
  const agent = agents.find((value) => value.id === focusedId);
  if (!agent) return;
  const id = agent.id, version = ++inspectorCopyVersion, text = sessionReport(agent);
  const current = () => version === inspectorCopyVersion && opened === "sheet-inspector" && focusedId === id && agents.some((value) => value.id === id);
  try {
    await navigator.clipboard.writeText(text);
    if (!current()) return;
    $("inspector-report").hidden = true;
    $("inspector-report-text").value = "";
    $("inspector-copy-status").textContent = "Session snapshot copied. Review paths and commands before sharing.";
  } catch {
    if (!current()) return;
    const field = $("inspector-report-text");
    field.value = text;
    $("inspector-report").hidden = false;
    $("inspector-copy-status").textContent = "Clipboard unavailable. Snapshot selected below; use your device’s Copy action.";
    field.focus();
    field.select();
  }
};
$("inspector-customize").onclick = () => {
  if (!agents.some((agent) => agent.id === focusedId)) return;
  $("agent-name-input").focus();
};
'''
s = replace(s, 'function syncAgentFollow() {', helpers + 'function syncAgentFollow() {')
p.write_text(s)

p = Path('web/css/style.css'); s = p.read_text()
s = replace(s, '''  align-items: center;
  gap: 12px;
  width: 100%;
  border: 1px solid var(--line);
  background: var(--panel2);''', '''  align-items: flex-start;
  gap: 10px;
  width: 100%;
  border: 1px solid var(--line);
  background: var(--panel2);''')
s = replace(s, '''#agent-follow {
  margin-bottom: 18px;
}
''', '')
s = replace(s, '''  margin: 10px 0;
}
.roster-toolbar .txt''', '''  margin: 8px 0;
}
.roster-toolbar .txt''')
s = replace(s, '''#roster-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 10px 0;
}''', '''#roster-filters {
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
  margin: 8px 0;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scrollbar-width: thin;
  padding-bottom: 4px;
}''')
s = replace(s, '''#roster-filters button {
  flex: 1 1 auto;
  min-height: 44px;
  font-size: 13px;
}''', '''#roster-filters button {
  flex: 1 0 auto;
  min-height: 44px;
  font-size: 13px;
  white-space: nowrap;
}''')
s = replace(s, '''#roster-summary {
  font-size: 12px;''', '''#roster-summary {
  margin: 6px 0;
  font-size: 12px;''')
s = replace(s, '''@media (max-width: 380px) {
  .roster-toolbar {
    flex-wrap: wrap;
  }
  .roster-toolbar .txt {
    flex-basis: 100%;
  }
}
''', '')
s += '''
/* Keep sessions visible before secondary metrics or personalization. */
#sheet-floor #roster-description { font-size: 12px; margin: 0 0 8px; }
#sheet-floor #trackSearch { margin: 8px 0; min-height: 44px; }
.roster-toolbar .txt, .roster-toolbar .btn { min-height: 44px; }
.agent-heading { display: flex; flex-wrap: wrap; align-items: baseline; gap: 3px 10px; }
.agent-heading strong { flex: 1 1 100%; }
.agent-heading .status { font-size: 12px; }
.inspector-actions { flex-wrap: wrap; margin: 12px 0; }
.inspector-actions .btn { min-height: 44px; font-size: 13px; padding: 8px 10px; white-space: normal; }
#inspector-copy-status:empty { display: none; }
#inspector-report-text { font-family: ui-monospace, monospace; }
@media (max-width: 560px) {
  #trackSearch, #roster-runtime { font-size: 16px; }
  .roster-toolbar .btn { padding-inline: 8px; }
  #roster-filters button { font-size: 12px; padding-inline: 9px; }
  .inspector-actions .btn { flex: 1 1 calc(50% - 8px); }
}
'''
p.write_text(s)
p = Path('package.json'); data = json.loads(p.read_text()); data['scripts']['test:browser'] += ' tests/daily-workflow.test.cjs'; p.write_text(json.dumps(data, indent=2) + '\n')
p = Path('README.md'); s = p.read_text()
s = replace(s, 'Disconnected panels show **last received data**', '''**Inspect before customizing:** session identity, recent activity, and reported
usage come before desk and appearance settings. **Copy summary** copies only the
selected session's timestamped snapshot, with a selectable-text fallback when
clipboard access is unavailable. It never sends a prompt or grants approval;
review paths and command previews before sharing. **Customize agent** jumps to
its preferences without losing your filtered list.

Disconnected panels show **last received data**''')
p.write_text(s)
p = Path('docs/usage.md'); s = p.read_text()
s += '''
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
'''
p.write_text(s)
