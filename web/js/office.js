/* Application state, accessible panels, and the local observer transport. */
"use strict";
const $ = (id) => document.getElementById(id);
const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let agents = [],
  progress = null,
  settings = { ...DEFAULT_SETTINGS },
  focusedId = null,
  platFilter = "every",
  offline = false;
let trackQuery = "",
  eventQuery = "",
  badgeQuery = "",
  badgeFilter = "all",
  opened = null,
  returnFocus = null,
  initialized = false;
let pendingSaves = 0,
  settingsRevision = 0,
  saveQueue = Promise.resolve(),
  audioContext = null,
  settingsSignature = "";
const seenUnlocks = new Set();
const scene = new OfficeScene($("c"), selectAgent, (p, grid) =>
  placeFurniture(p, grid),
);
window.officeScene = scene;
function duration(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return s < 60
    ? s + "s"
    : s < 3600
      ? Math.floor(s / 60) + "m " + (s % 60) + "s"
      : Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
}
function haveUnlock(id) {
  return !!progress?.catalog?.find((c) => c.id === id && c.have);
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  $("toast").append(el);
  setTimeout(() => el.remove(), 4500);
}
function chime() {
  if (!settings.sound) return;
  try {
    audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
    audioContext.resume();
    const o = audioContext.createOscillator(),
      g = audioContext.createGain();
    o.type = "sine";
    o.frequency.value = 660;
    g.gain.setValueAtTime(0.04, audioContext.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.2);
    o.connect(g);
    g.connect(audioContext.destination);
    o.start();
    o.stop(audioContext.currentTime + 0.2);
  } catch {}
}
function applyTheme() {
  document.documentElement.dataset.theme = settings.theme;
  labelButton(
    $("themeNextbtn"),
    "palette",
    THEMES.find((t) => t.id === settings.theme)?.name || "Plum",
  );
  $("room-name").textContent =
    LAYOUTS.find((l) => l.id === settings.layout)?.name || "The studio";
  labelButton(
    $("sound"),
    settings.sound ? "volume-2" : "volume-x",
    settings.sound ? "Sound on" : "Sound off",
  );
  $("sound").setAttribute("aria-pressed", String(settings.sound));
  $("sound").setAttribute(
    "aria-label",
    settings.sound ? "Sound on" : "Sound off",
  );
}
function updateScene() {
  scene.update(agents, settings, progress, focusedId, platFilter);
}
function kv(rows) {
  return rows
    .map(
      ([k, v]) =>
        `<div class="kv"><span>${escapeHTML(k)}</span><b>${escapeHTML(v)}</b></div>`,
    )
    .join("");
}
function selectAgent(id) {
  focusedId = id;
  updateScene();
  fillInspector();
  openSheet("sheet-inspector");
}
function closeSheets() {
  for (const s of document.querySelectorAll(".sheet")) s.hidden = true;
  $("backdrop").hidden = true;
  document
    .querySelectorAll("[data-sheet]")
    .forEach((b) => b.setAttribute("aria-expanded", "false"));
  opened = null;
  if (returnFocus?.isConnected) returnFocus.focus();
  returnFocus = null;
}
function openSheet(id) {
  if (opened === id) {
    closeSheets();
    return;
  }
  const previous = returnFocus || document.activeElement;
  closeSheets();
  returnFocus = previous;
  opened = id;
  $(id).hidden = false;
  $("backdrop").hidden = false;
  document
    .querySelectorAll(`[data-sheet="${id}"]`)
    .forEach((b) => b.setAttribute("aria-expanded", "true"));
  refreshPanel();
  $(id).querySelector("input:not([type=file]),button")?.focus();
}
for (const panel of document.querySelectorAll(".sheet")) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn close";
  b.setAttribute("aria-label", "Close panel");
  b.append(icon("x"));
  b.onclick = closeSheets;
  panel.prepend(b);
}
$("backdrop").onclick = closeSheets;
for (const b of document.querySelectorAll("[data-sheet]"))
  b.onclick = () => openSheet(b.dataset.sheet);
function refreshPanel() {
  if (opened === "sheet-setup") fillSetup();
  if (opened === "sheet-floor") {
    fillRoster();
    fillStats();
  }
  if (opened === "sheet-tasks") fillTasks();
  if (opened === "sheet-events") fillEvents();
  if (opened === "sheet-inspector") fillInspector();
  if (opened === "sheet-unlocks") fillBadges();
  if (opened === "sheet-settings") fillSettings();
}
function fillSetup() {
  const runtime = $("setup-runtime").value;
  const details = {
    hermes:
      "The installer enables the pixel-office Hermes plugin. Restart Hermes and start a CLI session. If enable failed, run: hermes plugins enable pixel-office.",
    telegram:
      "Install the Hermes observer first, then use your existing Hermes Telegram gateway. Bot credentials and gateway setup belong in Hermes. Telegram sessions appear only when Hermes emits those events; this office does not connect a bot or send messages.",
    opencode:
      "The installer adds the local bridge file URL to ~/.config/opencode/opencode.json and creates missing JSON settings. For an existing opencode.jsonc, follow the manual plugin entry printed by the installer; comments are preserved. Restart OpenCode and keep run.py running.",
    claude:
      "The installer adds observer hooks to ~/.claude/settings.json and creates missing settings. Rerun it after upgrading to add session, prompt, completion, and permission hooks. Existing unrelated hooks are preserved. Restart Claude Code and keep run.py running.",
    vscode:
      "The installer copies the local extension. Reload VS Code and run Agent Office: Open Floor. Keep the observer running; if using a different port, update hermesPixelOffice.stateUrl to its /state URL.",
  };
  $("setup-detail").textContent = details[runtime];
  const matching = agents.filter(
    (a) =>
      a.platform === runtime ||
      runtime === "vscode" ||
      (runtime === "hermes" &&
        ["cli", "telegram", "gateway", ""].includes(a.platform || "")),
  );
  $("setup-observed").textContent = offline
    ? "Observer disconnected. Start the server to check recorded sessions."
    : window._state?.mode === "demo"
      ? "Demo activity is synthetic. Switch to your real observer to verify this connection."
      : matching.length
        ? matching.length + " recorded session(s) visible for this view."
        : "No recorded sessions for this runtime yet. Installation cannot be verified from an empty room.";
}
$("setup-runtime").onchange = fillSetup;
$("setup-done").onclick = closeSheets;
$("waiting-count").onclick = () => {
  const next =
    agents.find((a) => a.status === "waiting" && a.id !== focusedId) ||
    agents.find((a) => a.status === "waiting");
  if (next) selectAgent(next.id);
};
function agentCard(a) {
  const button = document.createElement("button");
  button.className = "agent-card";
  button.type = "button";
  button.dataset.agent = a.id;
  const portrait = document.createElement("canvas");
  portrait.width = 16;
  portrait.height = 24;
  portrait.className = "portrait";
  portrait.setAttribute("aria-hidden", "true");
  const image = scene.sprites["char" + (hash(a.id) % 6)];
  if (image)
    portrait.getContext("2d").drawImage(image, 0, 8, 16, 24, 0, 0, 16, 24);
  button.append(portrait);
  const body = document.createElement("div");
  body.className = "agent-copy";
  body.innerHTML = `<strong>${escapeHTML(a.label || a.id)}</strong><small>${escapeHTML(platOf(a))} · ${escapeHTML(a.tool || a.detail || "Between tasks")}</small><small>${escapeHTML(duration(a.duration_s))}${a.parent ? " · subagent" : ""}</small>`;
  const status = document.createElement("span");
  status.className =
    "status " +
    (["working", "thinking", "waiting", "idle", "done", "gone"].includes(
      a.status,
    )
      ? a.status
      : "idle");
  status.textContent = STATUS_NAMES[a.status] || a.status;
  button.append(body, status);
  button.onclick = () => selectAgent(a.id);
  return button;
}
function fillRoster() {
  const box = $("roster");
  if (box.contains(document.activeElement)) return;
  box.replaceChildren();
  const q = trackQuery.toLowerCase();
  const list = agents.filter((a) =>
    [a.label, a.id, a.status, a.tool, a.detail, a.platform]
      .join(" ")
      .toLowerCase()
      .includes(q),
  );
  const priority = {
    waiting: 0,
    working: 1,
    thinking: 2,
    idle: 3,
    done: 4,
    gone: 5,
  };
  list.sort((a, b) => (priority[a.status] ?? 9) - (priority[b.status] ?? 9));
  if (!list.length) {
    box.innerHTML =
      '<p class="empty">' +
      (agents.length
        ? "No agents match this search."
        : "The floor is quiet. Start a connected runtime.") +
      "</p>";
    return;
  }
  for (const a of list) box.append(agentCard(a));
}
$("trackSearch").oninput = (e) => {
  trackQuery = e.target.value;
  fillRoster();
};
function fillTasks() {
  const box = $("taskboard");
  if (box.contains(document.activeElement)) return;
  box.replaceChildren();
  for (const [title, statuses] of [
    ["Needs input", ["waiting"]],
    ["In progress", ["working", "thinking"]],
    ["Between tasks", ["idle"]],
    ["Completed", ["done", "gone"]],
  ]) {
    const list = agents.filter((a) => statuses.includes(a.status));
    const h = document.createElement("div");
    h.className = "task-heading";
    h.textContent = title + " · " + list.length;
    box.append(h);
    for (const a of list) box.append(agentCard(a));
    if (!list.length) {
      const e = document.createElement("p");
      e.className = "h";
      e.textContent = "No sessions here.";
      box.append(e);
    }
  }
}
function fillStats() {
  const s = progress?.stats || {},
    tools = s.tools || 0;
  const top =
    Object.entries(s.by_tool || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k, v]) => k + " ×" + v)
      .join(", ") || "None yet";
  $("statbox").innerHTML = kv([
    ["Sessions", s.sessions || 0],
    ["Tool calls", tools],
    ["Subagents", s.subagents || 0],
    ["Approvals", s.approvals || 0],
    [
      "Tool errors",
      (s.errors || 0) +
        (tools
          ? " · " + (((s.errors || 0) / tools) * 100).toFixed(1) + "%"
          : ""),
    ],
    ["Peak concurrent", s.max_concurrent || 0],
    ["Frequent tools", top],
  ]);
}
function fillInspector() {
  const a = agents.find((a) => a.id === focusedId);
  const box = $("inspectorbox");
  if (!a) {
    box.innerHTML = '<p class="h">This session has left the office.</p>';
    return;
  }
  box.innerHTML = kv([
    ["Agent", a.label || a.id],
    ["Runtime", platOf(a)],
    ["Status", STATUS_NAMES[a.status] || a.status],
    ["Tool", a.tool || "—"],
    ["Detail", a.detail || "—"],
    ["Session", a.id],
    ["Parent", a.parent || "—"],
    ["Elapsed", duration(a.duration_s)],
    ["Since event", duration(a.idle_s)],
  ]);
  const heading = document.createElement("h3");
  heading.textContent = "Recent session events";
  box.append(heading);
  const events = (window._state?.events || [])
    .filter((e) => (e.session_id || e.child_session_id) === a.id)
    .slice(-8)
    .reverse();
  for (const e of events) box.append(eventRow(e));
  if (!events.length) {
    const p = document.createElement("p");
    p.className = "h";
    p.textContent =
      "No events for this session in the current 30-event window.";
    box.append(p);
  }
}
function eventText(e) {
  return [
    e.tool_name ||
      EVENT_NAMES[e.event] ||
      String(e.event || "event").replaceAll("_", " "),
    e.preview ||
      e.command ||
      e.question ||
      e.title ||
      e.child_goal ||
      e.error_message ||
      e.platform ||
      e.session_id ||
      e.child_session_id ||
      "",
  ]
    .filter(Boolean)
    .join(" · ");
}
function eventRow(e) {
  const row = document.createElement("div");
  row.className = "event";
  const when = new Date(Number(e.ts) * 1000);
  row.innerHTML = `<header><strong>${escapeHTML(EVENT_NAMES[e.event] || String(e.event || "event").replaceAll("_", " "))}</strong><time>${escapeHTML(Number.isFinite(when.getTime()) ? when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "")}</time></header><p>${escapeHTML(eventText(e))}</p>`;
  return row;
}
function fillEvents() {
  const box = $("eventbox");
  box.replaceChildren();
  const q = eventQuery.toLowerCase();
  const events = (window._state?.events || [])
    .filter((e) => JSON.stringify(e).toLowerCase().includes(q))
    .slice()
    .reverse();
  for (const e of events) box.append(eventRow(e));
  if (!events.length)
    box.innerHTML = '<p class="empty">No matching activity yet.</p>';
}
$("eventSearch").oninput = (e) => {
  eventQuery = e.target.value;
  fillEvents();
};
function fillBadges() {
  const catalog = progress?.catalog || [],
    earned = catalog.filter((c) => c.have).length;
  $("badge-summary").textContent =
    earned +
    " of " +
    catalog.length +
    " earned. Progress comes from your recorded sessions.";
  const list = catalog
    .filter(
      (c) =>
        badgeFilter === "all" ||
        (badgeFilter === "rewards"
          ? !!c.reward
          : badgeFilter === "earned"
            ? c.have
            : !c.have),
    )
    .filter((c) =>
      [c.name, c.hint, c.reward]
        .join(" ")
        .toLowerCase()
        .includes(badgeQuery.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(b.have) - Number(a.have) ||
        (b.progress || 0) - (a.progress || 0),
    );
  const box = $("achgrid");
  box.replaceChildren();
  for (const c of list) {
    const tile = document.createElement("article");
    tile.className = "ach" + (c.have ? " have" : "");
    tile.dataset.badge = c.id;
    const pct = c.have
      ? 100
      : Math.max(0, Math.min(100, Number(c.progress) || 0));
    tile.innerHTML = `<small>${c.have ? "✓ EARNED" : pct + "% COMPLETE"}</small><p><strong>${escapeHTML(c.name)}</strong></p><div class="h">${escapeHTML(c.hint)}</div><div class="progress-track" role="progressbar" aria-label="${escapeHTML(c.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>`;
    const reward = document.createElement("div");
    reward.className = "achievement-reward";
    reward.append(
      icon(c.reward ? "gift" : "trophy"),
      document.createTextNode(c.reward || "Activity milestone"),
    );
    const xp = document.createElement("span");
    xp.className = "achievement-xp";
    xp.textContent = c.xp ? "+" + c.xp + " XP" : "Milestone";
    tile.append(reward, xp);
    box.append(tile);
  }
  if (!list.length)
    box.innerHTML = '<p class="h">Nothing in this view yet.</p>';
}
$("badgeSearch").oninput = (e) => {
  badgeQuery = e.target.value;
  fillBadges();
};
for (const b of $("badge-tabs").querySelectorAll("button"))
  b.onclick = () => {
    badgeFilter = b.dataset.filter;
    for (const x of $("badge-tabs").children)
      x.setAttribute("aria-pressed", String(x === b));
    fillBadges();
  };
function applyState(state, pollRevision = settingsRevision) {
  if (!state || !Array.isArray(state.agents) || !Array.isArray(state.events))
    throw new Error("Invalid office state");
  window._state = state;
  offline = false;
  const previous = new Map(agents.map((a) => [a.id, a.status]));
  agents = state.agents;
  progress = state.progress || null;
  if (state.settings && !pendingSaves && pollRevision === settingsRevision) {
    Object.assign(settings, normalizeSettings(state.settings));
  }
  applyTheme();
  updateScene();
  if (typeof reconcileFurniture === "function") reconcileFurniture();
  document.body.classList.remove("offline");
  $("connection").textContent = "Connected";
  $("mode").hidden = state.mode !== "demo";
  $("agent-total").textContent = agents.length;
  const n = agents.length,
    w = agents.filter((a) => a.status === "waiting").length;
  $("count").textContent =
    n + " agent" + (n === 1 ? "" : "s") + " on the floor";
  $("waiting-count").textContent = w ? w + " need input" : "";
  $("waiting-count").hidden = !w;
  if (opened === "sheet-setup") fillSetup();
  $("empty-state").hidden = !!scene.edit || scene.list().length > 0;
  if (!agents.length || !scene.list().length) {
    $("empty-state").querySelector("h3").textContent = agents.length
      ? "No agents in this view."
      : "The office is ready.";
    $("empty-state").querySelector("p").textContent = agents.length
      ? "Choose All runtimes to see the whole team."
      : "Start a connected agent to bring the room to life.";
  }
  const xp = progress?.xp || 0,
    rank = progress?.rank || "intern";
  $("rank").textContent = rank + " · " + xp + " XP";
  const prev = RANKS.find((r) => r[0] === rank)?.[1] || 0;
  const pct = progress?.next
    ? Math.max(
        0,
        Math.min(100, ((xp - prev) / (progress.next.need - prev)) * 100),
      )
    : xp
      ? 100
      : 0;
  $("xpfill").style.width = pct + "%";
  for (const u of progress?.recent || []) {
    if (!seenUnlocks.has(u.id)) {
      seenUnlocks.add(u.id);
      if (initialized) {
        toast("Achievement earned: " + u.name);
        chime();
      }
    }
  }
  const newlyWaiting = agents.filter(
    (a) => a.status === "waiting" && previous.get(a.id) !== "waiting",
  );
  if (initialized && newlyWaiting.length) {
    chime();
    toast(
      newlyWaiting.length === 1
        ? `${newlyWaiting[0].label || newlyWaiting[0].id} needs input. Use the button above the floor; respond in the original runtime.`
        : `${newlyWaiting.length} agents need input. Use the button above the floor; respond in their original runtimes.`,
    );
  }
  const last = state.events.at(-1);
  $("latest-event").textContent = last
    ? eventText(last)
    : "Waiting for a session…";
  if (focusedId && !agents.some((a) => a.id === focusedId)) {
    focusedId = null;
    updateScene();
  }
  // Search fields and controls are persistent. Only data containers refresh.
  if (opened === "sheet-floor") {
    fillRoster();
    fillStats();
  } else if (opened === "sheet-events") fillEvents();
  else if (opened === "sheet-inspector") fillInspector();
  else if (opened === "sheet-tasks") fillTasks();
  else if (opened === "sheet-unlocks") fillBadges();
  const signature = JSON.stringify(settings) + haveUnlock("layout_bullpen");
  if (signature !== settingsSignature) {
    settingsSignature = signature;
    fillSettings();
  }
  initialized = true;
}
async function poll() {
  const revision = settingsRevision;
  try {
    const r = await fetch("state", {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    applyState(await r.json(), revision);
  } catch {
    offline = true;
    if (opened === "sheet-setup") fillSetup();
    document.body.classList.add("offline");
    $("connection").textContent = "Reconnecting";
    $("count").textContent = "Connection lost";
    $("latest-event").textContent =
      "Office unavailable. Start python3 run.py; reconnecting automatically.";
  }
  setTimeout(poll, 1500);
}
function updateSetting(key, value) {
  return saveSettings({ [key]: value });
}
function saveSettings(patch) {
  patch = normalizeSettings(patch);
  Object.assign(settings, patch);
  pendingSaves++;
  settingsRevision++;
  applyTheme();
  updateScene();
  fillSettings();
  $("save-status").textContent = "Saving…";
  const task = saveQueue.then(async () => {
    const r = await fetch("settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error("Save failed");
    const saved = await r.json();
    if (pendingSaves === 1) {
      Object.assign(settings, saved);
      reconcileFurniture();
    }
    $("save-status").textContent = "Saved on this computer.";
  });
  saveQueue = task
    .catch(() => {
      toast("Could not save settings. Reconnect and try again.");
      $("save-status").textContent = "Not saved. Server unavailable.";
    })
    .finally(() => {
      pendingSaves--;
      // Also invalidate polls started while the write was in flight.
      settingsRevision++;
      applyTheme();
      updateScene();
      fillSettings();
    });
  return saveQueue;
}
function segmented(label, key, options) {
  const row = document.createElement("div");
  row.className = "row";
  const title = document.createElement("span");
  title.className = "setting-label";
  title.textContent = label;
  const seg = document.createElement("div");
  seg.className = "seg";
  for (const [id, name] of options) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = name;
    b.dataset.setting = key;
    b.dataset.value = JSON.stringify(id);
    b.setAttribute("aria-pressed", String(settings[key] === id));
    b.onclick = () => updateSetting(key, id);
    seg.append(b);
  }
  row.append(title, seg);
  return row;
}
function fillSettings() {
  const layout = $("layoutbox");
  if (!layout.children.length)
    for (const l of LAYOUTS) {
      const row = document.createElement("div");
      row.className = "row";
      const info = document.createElement("div");
      info.innerHTML = `<strong class="setting-label">${escapeHTML(l.name)}</strong><div class="h">${escapeHTML(l.hint)}</div>`;
      const b = document.createElement("button");
      b.className = "btn";
      b.dataset.layout = l.id;
      b.onclick = () => updateSetting("layout", l.id);
      row.append(info, b);
      layout.append(row);
    }
  for (const l of LAYOUTS) {
    const b = layout.querySelector(`[data-layout="${l.id}"]`);
    const locked = l.require && !haveUnlock(l.require);
    b.disabled = !!locked;
    b.textContent = locked
      ? "Locked"
      : settings.layout === l.id
        ? "Selected"
        : "Use layout";
    b.setAttribute("aria-pressed", String(settings.layout === l.id));
  }
  const box = $("settingsbox");
  if (!box.children.length) {
    box.append(
      segmented(
        "Color palette",
        "theme",
        THEMES.map((t) => [t.id, t.name]),
      ),
      segmented("Lighting", "ambience", [
        ["auto", "Auto"],
        ["day", "Day"],
        ["night", "Night"],
      ]),
      segmented("Desk labels", "show_labels", [
        [true, "Show"],
        [false, "Hide"],
      ]),
      segmented("Room decorations", "decorations", [
        [true, "Show"],
        [false, "Hide"],
      ]),
    );
    const row = document.createElement("label");
    row.className = "row";
    row.innerHTML =
      '<span class="setting-label">Maximum desks per row</span><input class="txt" type="number" id="mc" min="2" max="8" aria-label="Maximum desks per row">';
    row.querySelector("input").value = settings.max_chars;
    row.querySelector("input").onchange = (e) =>
      updateSetting(
        "max_chars",
        Math.max(2, Math.min(8, Math.round(Number(e.target.value) || 4))),
      );
    box.append(row);
  }
  for (const b of box.querySelectorAll("[data-setting]"))
    b.setAttribute(
      "aria-pressed",
      String(settings[b.dataset.setting] === JSON.parse(b.dataset.value)),
    );
  if (document.activeElement !== $("mc")) $("mc").value = settings.max_chars;
}
$("exportTrack").onclick = () => {
  const cell = (v) =>
    '"' +
    String(v ?? "")
      .replace(/^[=+\-@\t\r]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  const rows = [
    ["agent", "runtime", "status", "tool", "detail", "elapsed_s"],
    ...agents.map((a) => [
      a.label || a.id,
      platOf(a),
      a.status,
      a.tool,
      a.detail,
      a.duration_s || 0,
    ]),
  ];
  downloadBlob(
    new Blob([rows.map((row) => row.map(cell).join(",")).join("\n")], {
      type: "text/csv",
    }),
    "agent-office-tracking.csv",
  );
};
$("resetbtn").onclick = async () => {
  if (
    !confirm(
      "Reset all XP, achievements and event history? This cannot be undone. Your room settings will stay.",
    )
  )
    return;
  try {
    const r = await fetch("state", {
      method: "DELETE",
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error();
    seenUnlocks.clear();
    location.reload();
  } catch {
    toast("Reset failed. Check that the local server is running.");
  }
};
$("filterbtn").onchange = (e) => {
  platFilter = e.target.value;
  updateScene();
  $("empty-state").hidden = scene.list().length > 0;
};
$("themeNextbtn").onclick = () =>
  updateSetting(
    "theme",
    THEMES[
      (THEMES.findIndex((t) => t.id === settings.theme) + 1) % THEMES.length
    ].id,
  );
$("sound").onclick = () => {
  const sound = !settings.sound;
  updateSetting("sound", sound);
  if (sound) chime();
};
$("zoom-in").onclick = () => scene.setZoom(scene.zoom + 0.25);
$("zoom-out").onclick = () => scene.setZoom(scene.zoom - 0.25);
$("zoom-fit").onclick = () => scene.setZoom(1);
$("pausebtn").onclick = () => {
  scene.paused = !scene.paused;
  syncPause();
};
function syncPause() {
  labelButton(
    $("pausebtn"),
    scene.paused ? "play" : "pause",
    scene.paused ? "Resume motion" : "Pause motion",
  );
  $("pausebtn").setAttribute("aria-pressed", String(scene.paused));
}
$("capturebtn").onclick = () => scene.snapshot();
$("legendbox").innerHTML = kv([
  ["Working", "A tool is running"],
  ["Thinking", "Between tool calls"],
  ["Needs input", "Approval requested in the runtime"],
  ["Idle", "No recent tool activity"],
  ["Completed", "Subagent finished or session ended"],
  ["R / U", "Agents and usage"],
  ["B / S / E", "Achievements / Customize / Activity"],
  ["T / N", "Palette / Lighting"],
  ["Escape", "Close panel or finish placing props"],
  ["Zoom + drag", "Explore the room at a larger scale"],
]);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeSheets();
    finishFurniture();
    return;
  }
  if (opened && e.key === "Tab") {
    const els = [
      ...$(opened).querySelectorAll(
        'button:not(:disabled),a,input,select,[tabindex="0"]',
      ),
    ].filter((x) => !x.hidden && x.offsetParent !== null);
    const first = els[0],
      last = els.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
    return;
  }
  if (
    e.ctrlKey ||
    e.metaKey ||
    e.altKey ||
    /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) ||
    e.target.isContentEditable
  )
    return;
  const key = e.key.toLowerCase();
  const ids = {
    r: "sheet-floor",
    u: "sheet-floor",
    b: "sheet-unlocks",
    s: "sheet-settings",
    l: "sheet-settings",
    e: "sheet-events",
    "?": "sheet-legend",
  };
  if (ids[key]) {
    e.preventDefault();
    openSheet(ids[key]);
  } else if (key === "t") $("themeNextbtn").click();
  else if (key === "n") {
    const modes = ["auto", "day", "night"];
    updateSetting(
      "ambience",
      modes[(modes.indexOf(settings.ambience) + 1) % 3],
    );
  }
});
for (const [id, name] of Object.entries({
  floorbtn: "users",
  tasksbtn: "list-checks",
  eventsbtn: "activity",
  achbtn: "trophy",
  settingsbtn: "sliders-horizontal",
  capturebtn: "camera",
  "export-settings": "download",
  exportTrack: "download",
  "clear-furniture": "trash-2",
  "undo-furniture": "undo-2",
  "redo-furniture": "redo-2",
  "arrange-furniture": "move",
  "edit-furniture": "move",
  "delete-furniture": "trash-2",
  "catalog-furniture": "plus",
  "finish-furniture": "check",
}))
  $(id).prepend(icon(name));
labelButton($("helpbtn"), "circle-help", "Help");
labelButton($("zoom-fit"), "scan", "Fit");
$("zoom-in").replaceChildren(icon("plus"));
$("zoom-out").replaceChildren(icon("minus"));
fillSettings();
applyTheme();
syncPause();
poll();
