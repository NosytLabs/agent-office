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
const confirmedSettings = structuredClone(settings),
  queuedSettings = [];
let eventMode = "latest",
  eventRuntime = "every",
  eventSession = null,
  historyEvents = [],
  historyLoaded = false,
  historyLoading = false,
  historyError = "",
  historyRequest = 0,
  historyLastLoaded = 0,
  historyReceived = -1,
  eventPageSize = 100,
  attentionNotice = null;
const seenAttention = new Set();
const seenUnlocks = new Set();
const settingsDrafts = new Set();
const settingsDraftVersions = new Map();
const panelViews = new Map(),
  panelStack = [],
  toastTimers = new WeakMap();
const contentSignatures = new WeakMap(),
  eventNodeCaches = new WeakMap();
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let lockedPage = null,
  viewRestored = false,
  viewSaveTimer = null;
let sessionUsageIndex = new Map();
let preferenceWritePending = false,
  preferenceCleanupPending = false;
let pendingHistoryScroll = null;
for (const id of [
  "room-name-input",
  "pet-cat1-name",
  "pet-cat2-name",
  "budget-input",
  "agent-name-input",
  "agent-seat-select",
  "agent-appearance-select",
])
  $(id).addEventListener("input", () => {
    settingsDrafts.add(id);
    settingsDraftVersions.set(id, (settingsDraftVersions.get(id) || 0) + 1);
  });
function acknowledgeDrafts(submitted) {
  for (const [id, value] of Object.entries(submitted))
    if ($(id).value === value) settingsDrafts.delete(id);
}
const scene = new OfficeScene($("c"), selectAgent, (p, grid) =>
  placeFurniture(p, grid),
);
window.officeScene = scene;
const roomActions = [
  ["Aquarium", () => window.openAquarium?.()],
  ["Jukebox", () => window.officeJukebox?.open()],
  ["Pet the orange cat", () => scene.petCat("cat")],
  ["Pet the black cat", () => scene.petCat("blackcat")],
];
for (const [label, action] of roomActions) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn";
  button.textContent = label;
  button.dataset.activity = label;
  button.onclick = action;
  $("room-actions").append(button);
}
scene.onProp = (kind) => {
  if (kind === "FISH_TANK" || kind === "terrarium") window.openAquarium?.();
  else if (kind === "jukebox" || kind === "recordplayer")
    window.officeJukebox?.open();
  else if (kind === "whiteboard" || kind === "focusbooth")
    openSheet("sheet-tasks");
  else if (kind === "server" || kind === "robot") openSheet("sheet-floor");
  else if (kind === "printer") openSheet("sheet-events");
  else if (kind === "filingcabinet") {
    eventMode = "history";
    eventSession = null;
    eventPageSize = 100;
    openSheet("sheet-events");
  } else if (kind === "arcade")
    toast("You found the break room. No tickets required.");
  else if (kind === "coffee") toast("Coffee break.");
};
scene.onPet = (key) => {
  const name =
    settings.pet_names?.[key === "blackcat" ? "cat2" : "cat1"] ||
    (key === "blackcat" ? "Gitcat" : "Claudio");
  toast(name + " purrs.");
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden) audioContext?.suspend().catch(() => {});
});
window.addEventListener("pagehide", () => {
  audioContext?.close().catch(() => {});
  audioContext = null;
});
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
function runtimeName(a) {
  if (
    String(a.platform || "")
      .toLowerCase()
      .includes("codex")
  )
    return "Codex";
  if (a.platform === "vscode") return "VS Code";
  return (
    {
      hermes: "Hermes",
      claude: "Claude Code",
      opencode: "OpenCode",
      telegram: "Telegram",
      cli: "CLI",
    }[platOf(a)] ||
    a.platform ||
    "Runtime"
  );
}
function runtimeBadge(a) {
  const badge = document.createElement("span");
  badge.className = "runtime-badge";
  const runtime = String(a.platform || "").toLowerCase();
  const mark = runtime.includes("claude")
    ? "claude"
    : runtime.includes("codex")
      ? "codex"
      : ["opencode", "telegram"].includes(runtime)
        ? runtime
        : null;
  if (mark) {
    const image = document.createElement("img");
    image.src = `assets/brands/${mark}.svg`;
    image.alt = "";
    image.width = image.height = 18;
    badge.append(image);
  }
  badge.append(document.createTextNode(runtimeName(a)));
  return badge;
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
  const container = $("toast"),
    text = String(message);
  let el = [...container.children].find(
    (notice) => notice.dataset.message === text,
  );
  if (el) {
    clearTimeout(toastTimers.get(el));
    el.dataset.count = String(Number(el.dataset.count || 1) + 1);
    el.querySelector(".toast-repeat").textContent =
      `Repeated ${el.dataset.count} times`;
  } else {
    el = document.createElement("div");
    el.className = "toast";
    el.dataset.message = text;
    el.dataset.count = "1";
    const copy = document.createElement("div"),
      content = document.createElement("span"),
      repeat = document.createElement("small");
    copy.className = "toast-copy";
    content.textContent = text;
    repeat.className = "toast-repeat";
    copy.append(content, repeat);
    const dismiss = document.createElement("button");
    dismiss.className = "btn toast-dismiss";
    dismiss.type = "button";
    dismiss.setAttribute("aria-label", "Dismiss notification");
    dismiss.append(icon("x"));
    dismiss.onclick = () => {
      clearTimeout(toastTimers.get(el));
      const next =
        el.nextElementSibling?.querySelector("button") ||
        el.previousElementSibling?.querySelector("button");
      const focused = el.contains(document.activeElement);
      el.remove();
      if (focused)
        (next || (opened ? $(opened).querySelector(".close") : $("c")))?.focus({
          preventScroll: true,
        });
    };
    el.append(copy, dismiss);
    while (container.children.length >= 3) {
      const oldest = [...container.children].find(
        (notice) => !notice.contains(document.activeElement),
      );
      clearTimeout(toastTimers.get(oldest));
      oldest.remove();
    }
    container.append(el);
  }
  positionNotices();
  toastTimers.set(
    el,
    setTimeout(() => {
      // Do not remove a notification while its keyboard action has focus.
      if (el.contains(document.activeElement)) return;
      el.remove();
    }, 4500),
  );
}
function chime() {
  if (
    !settings.sound ||
    document.hidden ||
    !navigator.userActivation?.hasBeenActive
  )
    return;
  try {
    audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
    audioContext.resume().catch(() => {});
    const o = audioContext.createOscillator(),
      g = audioContext.createGain();
    o.type = "sine";
    o.frequency.value = 660;
    g.gain.setValueAtTime(0.04, audioContext.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.2);
    o.connect(g);
    g.connect(audioContext.destination);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
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
    settings.room_name ||
    LAYOUTS.find((l) => l.id === settings.layout)?.name ||
    "The studio";
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
  if (!settings.sound) audioContext?.suspend().catch(() => {});
  window.officeJukebox?.sync();
}
function updateScene() {
  for (const agent of agents) {
    agent.observed_label ??= agent.label || agent.id;
    agent.label = settings.agent_names?.[agent.id] || agent.observed_label;
  }
  scene.update(agents, settings, progress, focusedId, platFilter);
  for (const button of $("room-actions").children) {
    const black = button.dataset.activity === "Pet the black cat";
    if (black || button.dataset.activity === "Pet the orange cat") {
      button.disabled =
        !settings.decorations ||
        settings.show_pets === false ||
        (black && !progress?.cosmetics?.includes("gitcat"));
      button.title = !settings.decorations
        ? "Show room decorations to visit your pets"
        : settings.show_pets === false
          ? "Show pets to visit your office cats"
          : black && button.disabled
            ? "Unlock the second cat after 100 sessions and 50 tools"
            : "Pet your office cat";
    }
  }
  window.officeAquarium?.refresh();
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
function rememberPanel(id = opened) {
  if (!id || $(id).hidden) return;
  const view = panelViews.get(id) || {};
  if (id !== "sheet-events" || pendingHistoryScroll === null)
    view.scroll = $(id).scrollTop;
  if ($(id).contains(document.activeElement))
    view.focus = document.activeElement;
  panelViews.set(id, view);
}
function positionNotices() {
  const target = opened
    ? $(opened).querySelector(".sheet-notices")
    : $("notice-slot");
  if (target && $("toast").parentElement !== target) target.append($("toast"));
  positionNoticeSlot();
}
function positionNoticeSlot() {
  if (opened || !$("toast").children.length) return;
  const gap = 12,
    bottom = innerHeight - gap;
  const controls = document
    .querySelector(".scene-controls")
    .getBoundingClientRect();
  let top = Math.max(
    gap,
    Math.min($("stage").getBoundingClientRect().top + gap, bottom - 120),
  );
  let end = bottom;
  // Keep notices out of the camera controls even when the page is scrolled.
  if (controls.bottom > top && controls.top < end) {
    const above = controls.top - gap - top;
    const below = bottom - controls.bottom - gap;
    if (above >= 96 || above >= below) end = controls.top - gap;
    else top = controls.bottom + gap;
  }
  $("notice-slot").style.top = top + "px";
  $("notice-slot").style.maxHeight = Math.max(0, end - top) + "px";
}
window.addEventListener("resize", positionNoticeSlot);
window.addEventListener("scroll", positionNoticeSlot, { passive: true });
new ResizeObserver(positionNoticeSlot).observe($("stage"));
function lockPage() {
  if (lockedPage) return;
  const style = document.body.style;
  lockedPage = {
    x: scrollX,
    y: scrollY,
    position: style.position,
    top: style.top,
    left: style.left,
    width: style.width,
  };
  document.documentElement.classList.add("panel-open");
  Object.assign(style, {
    position: "fixed",
    top: -lockedPage.y + "px",
    left: -lockedPage.x + "px",
    width: "100%",
  });
}
function unlockPage() {
  if (!lockedPage) return;
  const { x, y, ...style } = lockedPage;
  Object.assign(document.body.style, style);
  document.documentElement.classList.remove("panel-open");
  lockedPage = null;
  scrollTo(x, y);
}
function syncPanelNavigation() {
  document
    .querySelectorAll("[data-sheet]")
    .forEach((b) =>
      b.setAttribute("aria-expanded", String(b.dataset.sheet === opened)),
    );
  const previous = panelStack.at(-1);
  for (const panel of document.querySelectorAll(".sheet")) {
    const back = panel.querySelector(".sheet-back");
    back.hidden = panel.id !== opened || !previous;
    if (previous)
      back.setAttribute(
        "aria-label",
        "Back to " +
          ($(previous).getAttribute("aria-label") || "previous panel"),
      );
  }
}
function displayPanel(id) {
  for (const panel of document.querySelectorAll(".sheet"))
    panel.hidden = panel.id !== id;
  opened = id;
  $("backdrop").hidden = false;
  $("wrap").inert = true;
  positionNotices();
  syncPanelNavigation();
  const panel = $(id),
    view = panelViews.get(id);
  if (id === "sheet-events" && eventMode === "history" && !historyLoaded)
    pendingHistoryScroll = view?.scroll || 0;
  refreshPanel();
  const target =
    view?.focus?.isConnected &&
    panel.contains(view.focus) &&
    !view.focus.disabled &&
    view.focus.getClientRects().length
      ? view.focus
      : panel.querySelector(".close");
  target?.focus({ preventScroll: true });
  panel.scrollTop = view?.scroll || 0;
  if (id === "sheet-events" && historyLoaded) pendingHistoryScroll = null;
  persistView();
}
function closeSheets() {
  rememberPanel();
  for (const panel of document.querySelectorAll(".sheet")) panel.hidden = true;
  $("backdrop").hidden = true;
  $("wrap").inert = false;
  opened = null;
  panelStack.length = 0;
  syncPanelNavigation();
  positionNotices();
  unlockPage();
  if (
    returnFocus?.isConnected &&
    returnFocus.getClientRects().length &&
    !returnFocus.disabled
  )
    returnFocus.focus({ preventScroll: true });
  else if (returnFocus) $("c").focus({ preventScroll: true });
  returnFocus = null;
  persistView();
}
function backSheet() {
  if (!panelStack.length) {
    closeSheets();
    return;
  }
  rememberPanel();
  displayPanel(panelStack.pop());
}
function openSheet(id) {
  if (!$(id)?.classList.contains("sheet")) return;
  if (opened === id) {
    closeSheets();
    return;
  }
  if (opened) {
    rememberPanel();
    const existing = panelStack.indexOf(id);
    if (existing >= 0) panelStack.splice(existing);
    else {
      panelStack.push(opened);
      if (panelStack.length > 8) panelStack.shift();
    }
  } else {
    returnFocus =
      document.activeElement === document.body
        ? document.querySelector(`[data-sheet="${id}"]`) || $("c")
        : document.activeElement;
    lockPage();
  }
  displayPanel(id);
}
for (const panel of document.querySelectorAll(".sheet")) {
  const header = document.createElement("div"),
    row = document.createElement("div"),
    body = document.createElement("div");
  header.className = "sheet-header";
  row.className = "sheet-title-row";
  body.className = "sheet-body";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "btn sheet-back";
  back.textContent = "Back";
  back.hidden = true;
  back.onclick = backSheet;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn close";
  b.setAttribute("aria-label", "Close panel");
  b.append(icon("x"));
  b.onclick = closeSheets;
  const heading = panel.querySelector("h2");
  if (heading) row.append(heading);
  row.append(b);
  const notices = document.createElement("div");
  notices.className = "sheet-notices";
  header.append(back, row, notices);
  while (panel.firstChild) body.append(panel.firstChild);
  panel.append(header, body);
  panel.addEventListener(
    "scroll",
    () => {
      if (!panel.hidden) {
        rememberPanel(panel.id);
        queueViewSave();
      }
    },
    { passive: true },
  );
}
let backdropStart = null;
$("backdrop").onpointerdown = (event) => {
  backdropStart = { x: event.clientX, y: event.clientY };
};
$("backdrop").onclick = (event) => {
  if (
    backdropStart &&
    Math.hypot(
      event.clientX - backdropStart.x,
      event.clientY - backdropStart.y,
    ) < 6
  )
    closeSheets();
  backdropStart = null;
};
positionNotices();
function persistView() {
  if (!viewRestored || !window.officeViewState) return;
  rememberPanel();
  window.officeViewState.write({
    version: 1,
    zoom: scene.zoom,
    runtime: platFilter,
    paused: scene.paused,
    panel: opened,
    eventMode,
    eventRuntime,
    badgeFilter,
    queries: { agents: trackQuery, events: eventQuery, badges: badgeQuery },
    scroll: Object.fromEntries(
      [...panelViews].map(([id, view]) => [id, view.scroll || 0]),
    ),
  });
}
function queueViewSave() {
  clearTimeout(viewSaveTimer);
  viewSaveTimer = setTimeout(persistView, 200);
}
function restoreViewState() {
  viewRestored = true;
  const view = window.officeViewState?.read();
  if (!view) return null;
  platFilter = view.runtime;
  $("filterbtn").value = platFilter;
  trackQuery = view.queries.agents;
  eventQuery = view.queries.events;
  badgeQuery = view.queries.badges;
  $("trackSearch").value = trackQuery;
  $("eventSearch").value = eventQuery;
  $("badgeSearch").value = badgeQuery;
  eventMode = view.eventMode;
  eventRuntime = view.eventRuntime;
  $("event-runtime").value = eventRuntime;
  badgeFilter = view.badgeFilter;
  for (const b of $("badge-tabs").children)
    b.setAttribute("aria-pressed", String(b.dataset.filter === badgeFilter));
  for (const [id, scroll] of Object.entries(view.scroll))
    panelViews.set(id, { scroll });
  return view;
}
window.addEventListener("pagehide", persistView);
reducedMotion.addEventListener("change", (event) => {
  if (event.matches) {
    scene.paused = true;
    syncPause();
    persistView();
  }
});
for (const b of document.querySelectorAll("[data-sheet]"))
  b.onclick = () => openSheet(b.dataset.sheet);
function refreshPanel() {
  if (opened === "sheet-setup") fillSetup();
  if (opened === "sheet-floor") {
    fillRoster();
    fillStats();
  }
  if (opened === "sheet-tasks") fillTasks();
  if (opened === "sheet-events") {
    fillEvents();
    if (eventMode === "history") loadHistory();
  }
  if (opened === "sheet-inspector") fillInspector();
  if (opened === "sheet-unlocks") fillBadges();
  if (opened === "sheet-settings") fillSettings();
}
function fillSetup() {
  const runtime = $("setup-runtime").value;
  $("setup-brand").replaceChildren(runtimeBadge({ platform: runtime }));
  $("setup-codex-usage").hidden = runtime !== "codex";
  const details = {
    hermes:
      "The installer enables the pixel-office Hermes plugin. Restart Hermes and start a CLI session. If enable failed, run: hermes plugins enable pixel-office.",
    telegram:
      "Install the Hermes observer first, then use your existing Hermes Telegram gateway. Bot credentials and gateway setup belong in Hermes. Telegram sessions appear only when Hermes emits those events; this office does not connect a bot or send messages.",
    opencode:
      "The installer adds the local bridge file URL to ~/.config/opencode/opencode.json and creates missing JSON settings. For an existing opencode.jsonc, follow the manual plugin entry printed by the installer; comments are preserved. Restart OpenCode and keep run.py running.",
    claude:
      "The installer adds observer hooks to ~/.claude/settings.json and creates missing settings. Rerun it after upgrading to add session, prompt, completion, and permission hooks. Existing unrelated hooks are preserved. Restart Claude Code and keep run.py running.",
    codex:
      "The installer detects an existing Codex installation and adds local observer commands to hooks.json in CODEX_HOME or ~/.codex. Restart Codex, then open /hooks to review and trust the new definitions. Keep run.py running. These synchronous hooks have a three-second timeout and report lifecycle activity; token usage is optional below.",
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
for (const button of document.querySelectorAll("[data-copy-command]")) {
  button.onclick = async () => {
    const command = $(button.dataset.copyCommand);
    const commandText = command.textContent.trim().replace(/\s+/g, " ");
    try {
      await navigator.clipboard.writeText(commandText);
      $("setup-copy-status").textContent = "Copied: " + commandText;
    } catch {
      const range = document.createRange();
      range.selectNodeContents(command);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      $("setup-copy-status").textContent =
        "Command selected. Use your device’s Copy action.";
    }
  };
}
$("waiting-count").onclick = () => {
  const waiting = agents.filter((a) => a.status === "waiting");
  const next =
    waiting[
      (waiting.findIndex((a) => a.id === focusedId) + 1) % waiting.length
    ];
  if (next) selectAgent(next.id);
};
function syncEmptyState() {
  const filtered = agents.length > 0;
  $("empty-state").hidden = !!scene.edit || scene.list().length > 0;
  $("empty-state").querySelector("h3").textContent = filtered
    ? "No agents in this view."
    : "The office is ready.";
  $("empty-state").querySelector("p").textContent = filtered
    ? "Your other agents are still on the floor."
    : "Connect a runtime, then start a session to bring the room to life.";
  $("empty-connect").hidden = filtered;
  $("empty-show-all").hidden = !filtered;
  $("empty-demo").hidden = filtered;
}
$("empty-show-all").onclick = () => {
  $("filterbtn").value = platFilter = "every";
  updateScene();
  syncEmptyState();
  $("filterbtn").focus();
};
function agentCard(a, existing) {
  const button = existing || document.createElement("button");
  button.className = "agent-card";
  button.type = "button";
  button.dataset.agent = a.id;
  const portrait =
    button.querySelector(".portrait") || document.createElement("canvas");
  portrait.width = 16;
  portrait.height = 24;
  portrait.className = "portrait";
  portrait.setAttribute("aria-hidden", "true");
  const image =
    scene.sprites[characterSpriteKey(a, settings, scene.sprites)] ||
    scene.sprites["char" + (hash(a.id) % 6)];
  if (image)
    portrait.getContext("2d").drawImage(image, 0, 8, 16, 24, 0, 0, 16, 24);
  const body =
    button.querySelector(".agent-copy") || document.createElement("div");
  body.className = "agent-copy";
  if (!body.children.length) {
    const label = document.createElement("strong"),
      runtime = document.createElement("small"),
      elapsed = document.createElement("small"),
      usage = document.createElement("div");
    runtime.className = "agent-runtime";
    elapsed.className = "agent-elapsed";
    usage.className = "agent-usage";
    body.append(label, runtime, elapsed, usage);
  }
  setText(body.querySelector("strong"), a.label || a.id);
  const runtime = body.querySelector(".agent-runtime"),
    runtimeSignature = JSON.stringify([a.platform, a.tool, a.detail]);
  if (contentSignatures.get(runtime) !== runtimeSignature) {
    runtime.replaceChildren(
      runtimeBadge(a),
      document.createTextNode(" · " + (a.tool || a.detail || "Between tasks")),
    );
    contentSignatures.set(runtime, runtimeSignature);
  }
  setText(
    body.querySelector(".agent-elapsed"),
    duration(a.duration_s) + (a.parent ? " · subagent" : ""),
  );
  updateAgentUsage(body.querySelector(".agent-usage"), sessionUsageForAgent(a));
  const status =
    button.querySelector(".status") || document.createElement("span");
  status.className =
    "status " +
    (["working", "thinking", "waiting", "idle", "done", "gone"].includes(
      a.status,
    )
      ? a.status
      : "idle");
  status.textContent = STATUS_NAMES[a.status] || a.status;
  if (!existing) button.append(portrait, body, status);
  button.onclick = () => selectAgent(a.id);
  return button;
}
function reconcileAgentCards(box, nodes, fallback) {
  const focused = box.contains(document.activeElement)
    ? document.activeElement
    : null;
  const focusedId = focused?.dataset.agent;
  let cursor = box.firstChild;
  for (const node of nodes) {
    if (node === cursor) cursor = cursor.nextSibling;
    else box.insertBefore(node, cursor);
  }
  while (cursor) {
    const next = cursor.nextSibling;
    cursor.remove();
    cursor = next;
  }
  if (focusedId) {
    const target =
      nodes.find((node) => node.dataset.agent === focusedId) ||
      nodes.find((node) => node.dataset.agent) ||
      fallback;
    if (target && document.activeElement !== target)
      target.focus({ preventScroll: true });
  }
}
function fillRoster() {
  const box = $("roster");
  const existing = new Map(
    [...box.querySelectorAll(".agent-card")].map((b) => [b.dataset.agent, b]),
  );
  const q = trackQuery.trim().toLowerCase();
  const list = agents.filter((a) =>
    [
      a.label,
      a.id,
      a.status,
      STATUS_NAMES[a.status],
      a.tool,
      a.detail,
      a.platform,
      platOf(a),
    ]
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
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = agents.length
      ? "No agents match this search."
      : "The floor is quiet. Start a connected runtime.";
    reconcileAgentCards(box, [empty], $("trackSearch"));
    return;
  }
  reconcileAgentCards(
    box,
    list.map((a) => agentCard(a, existing.get(a.id))),
    $("trackSearch"),
  );
}
$("trackSearch").oninput = (e) => {
  trackQuery = e.target.value;
  fillRoster();
  queueViewSave();
};
function fillTasks() {
  const box = $("taskboard");
  const existing = new Map(
    [...box.querySelectorAll(".agent-card")].map((b) => [b.dataset.agent, b]),
  );
  const nodes = [];
  for (const [title, statuses] of [
    ["Needs input", ["waiting"]],
    ["In progress", ["working", "thinking"]],
    ["Between tasks", ["idle"]],
    ["Completed", ["done", "gone"]],
  ]) {
    const list = agents.filter((a) => statuses.includes(a.status));
    const h =
      box.querySelector(`[data-task-group="${statuses[0]}"]`) ||
      document.createElement("div");
    h.className = "task-heading";
    h.dataset.taskGroup = statuses[0];
    h.textContent = title + " · " + list.length;
    nodes.push(h);
    for (const a of list) nodes.push(agentCard(a, existing.get(a.id)));
    if (!list.length) {
      const e =
        box.querySelector(`[data-empty-group="${statuses[0]}"]`) ||
        document.createElement("p");
      e.className = "h";
      e.dataset.emptyGroup = statuses[0];
      e.textContent = "No sessions here.";
      nodes.push(e);
    }
  }
  reconcileAgentCards(
    box,
    nodes,
    box.closest(".sheet").querySelector(".close"),
  );
}
function usageValue(metrics, field) {
  if (metrics?.overflow?.[field]) return "Amount too large";
  const value = metrics?.[field];
  if (typeof value !== "number" || !Number.isFinite(value))
    return "Not reported";
  if (field !== "cost_usd") return value.toLocaleString();
  if (value > 0 && value < 0.000001) return "<$0.000001";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 0.01 ? 6 : 4,
  }).format(value);
}
function setText(element, value) {
  const text = String(value ?? "");
  if (element.textContent !== text) element.textContent = text;
}
function setHTMLIfChanged(element, html) {
  if (contentSignatures.get(element) === html) return;
  element.innerHTML = html;
  contentSignatures.set(element, html);
}
function sessionUsageForAgent(agent) {
  const runtime = String(agent.platform || "").toLowerCase(),
    id = String(agent.id);
  return (
    sessionUsageIndex.get(JSON.stringify([runtime, id])) ||
    sessionUsageIndex.get(JSON.stringify([canonicalRuntime(runtime), id]))
  );
}
function updateAgentUsage(element, metrics) {
  if (!metrics?.reports) {
    setHTMLIfChanged(element, "<span>Usage not reported</span>");
    element.title =
      "Tokens and cost appear only when this session's runtime reports them.";
    return;
  }
  const total = usageValue(metrics, "total_tokens"),
    cost = usageValue(metrics, "cost_usd");
  const totalKnown =
    typeof metrics.total_tokens === "number" &&
    Number.isFinite(metrics.total_tokens);
  const costKnown =
    typeof metrics.cost_usd === "number" && Number.isFinite(metrics.cost_usd);
  const totalPartial = Number(metrics.coverage?.total_tokens) < metrics.reports;
  const costPartial = Number(metrics.coverage?.cost_usd) < metrics.reports;
  const sources = (metrics.cost_sources || [])
    .map(
      (source) =>
        `${source.source}: ${source.overflow ? "Amount too large" : usageValue(source, "cost_usd")} from ${source.reports} report${source.reports === 1 ? "" : "s"}`,
    )
    .join("; ");
  element.title = `Total: ${total}. ${usageCoverage(metrics, "total_tokens")}. Runtime cost estimate: ${cost}. ${usageCoverage(metrics, "cost_usd")}. ${sources || "Cost source not reported."} Estimates may differ from billing. Cached tokens are included in input; reasoning tokens are included in output.`;
  const fields = ["input_tokens", "output_tokens", "total_tokens"];
  const complete =
    Number.isSafeInteger(metrics.reports) &&
    metrics.reports > 0 &&
    fields.every(
      (field) =>
        Number.isSafeInteger(metrics[field]) &&
        metrics[field] >= 0 &&
        metrics.coverage?.[field] === metrics.reports,
    ) &&
    Number.isSafeInteger(metrics.input_tokens + metrics.output_tokens) &&
    metrics.total_tokens === metrics.input_tokens + metrics.output_tokens &&
    metrics.total_tokens > 0;
  let composition = "";
  if (complete) {
    const input = (metrics.input_tokens / metrics.total_tokens) * 100;
    composition = `<div class="token-composition" role="img" aria-label="${escapeHTML(`Reported token composition: ${usageValue(metrics, "input_tokens")} input tokens and ${usageValue(metrics, "output_tokens")} output tokens. Cache is included in input; reasoning is included in output.`)}"><span class="token-input" style="width:${input}%"></span><span class="token-output" style="width:${100 - input}%"></span></div><small class="token-legend">Input ${escapeHTML(usageValue(metrics, "input_tokens"))} · Output ${escapeHTML(usageValue(metrics, "output_tokens"))}</small>`;
  }
  setHTMLIfChanged(
    element,
    `<span>${escapeHTML(totalKnown ? total + " tokens" : "Total " + total.toLowerCase())}${totalKnown && totalPartial ? " · partial" : ""}</span><span>${escapeHTML(costKnown ? cost + " runtime estimate" : "Cost " + cost.toLowerCase())}${costKnown && costPartial ? " · partial" : ""}</span>${composition}`,
  );
}
function usageCoverage(metrics, field) {
  const reports = Number(metrics?.reports) || 0,
    known = Number(metrics?.coverage?.[field]) || 0;
  if (!reports) return "No usage reports";
  return known < reports
    ? `${known.toLocaleString()} of ${reports.toLocaleString()} reports · partial coverage`
    : `${reports.toLocaleString()} report${reports === 1 ? "" : "s"}`;
}
function usageSummary(metrics) {
  const fields = [
    ["input_tokens", "Input tokens"],
    ["output_tokens", "Output tokens"],
    ["total_tokens", "Total tokens"],
    ["cost_usd", "Runtime cost estimate · USD"],
  ];
  const cards = fields
    .map(
      ([field, label]) =>
        `<div class="usage-card"><span>${escapeHTML(label)}</span><strong>${escapeHTML(usageValue(metrics, field))}</strong><small>${escapeHTML(usageCoverage(metrics, field))}</small></div>`,
    )
    .join("");
  const note = !metrics?.reports
    ? "No usage reports yet. Tokens and cost appear only when your runtime reports them."
    : "Amounts come from runtime usage reports. Partial coverage includes only reports that supplied that field; cost estimates may differ from billing.";
  return `<div class="usage-grid">${cards}</div><p class="h usage-note">${escapeHTML(note)}</p>`;
}
function usageTable(rows, dimension) {
  if (!rows?.length)
    return `<p class="h">No ${dimension} usage reported yet.</p>`;
  return `<div class="table-scroll"><table class="usage-table"><caption>By ${dimension}</caption><thead><tr><th scope="col">${dimension === "model" ? "Model / runtime" : "Runtime"}</th><th scope="col">Total tokens</th><th scope="col">Estimate · USD</th></tr></thead><tbody>${rows
    .map((row) => {
      const label =
        dimension === "model"
          ? `${row.model || "Model not reported"}${row.provider ? " · " + row.provider : ""} · ${row.platform || "Runtime not reported"}`
          : row.platform || "Runtime not reported";
      return `<tr><th scope="row">${escapeHTML(label)}</th><td>${escapeHTML(usageValue(row, "total_tokens"))}<small>${escapeHTML(usageCoverage(row, "total_tokens"))}</small></td><td>${escapeHTML(usageValue(row, "cost_usd"))}<small>${escapeHTML(usageCoverage(row, "cost_usd"))}</small></td></tr>`;
    })
    .join("")}</tbody></table></div>`;
}
function fillStats() {
  const s = progress?.stats || {},
    tools = s.tools || 0;
  const usage = window._state?.usage || {};
  syncBudget();
  setHTMLIfChanged($("usagebox"), usageSummary(usage.totals));
  $("usage-breakdown").innerHTML =
    usageTable(usage.by_model, "model") +
    usageTable(usage.by_platform, "runtime") +
    kv(
      [
        ["cached_input_tokens", "Cached input tokens"],
        ["cache_write_tokens", "Cache write tokens"],
        ["reasoning_output_tokens", "Reasoning output tokens"],
      ].map(([field, label]) => [
        label,
        `${usageValue(usage.totals, field)} · ${usageCoverage(usage.totals, field)}`,
      ]),
    ) +
    '<p class="h">Cache counts are included in input tokens; reasoning counts are included in output tokens.</p>';
  for (const source of usage.totals?.cost_sources || []) {
    const line = document.createElement("p");
    line.className = "h";
    line.textContent = `${source.source}: ${source.overflow ? "Amount too large" : usageValue(source, "cost_usd")} USD from ${Number(source.reports).toLocaleString()} ${Number(source.reports) === 1 ? "report" : "reports"}.`;
    $("usage-breakdown").append(line);
  }
  const top =
    Object.entries(s.by_tool || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k, v]) => k + " ×" + v)
      .join(", ") || "None yet";
  $("statbox").innerHTML = kv([
    ["Sessions observed", s.sessions || 0],
    ["Tool starts", tools],
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
    $("agent-name-form").hidden = true;
    $("agent-preference-form").hidden = true;
    $("inspect-history").hidden = true;
    box.innerHTML = '<p class="h">This session has left the office.</p>';
    return;
  }
  $("agent-name-form").hidden = false;
  fillAgentPreferences(a);
  $("inspect-history").hidden = false;
  const nameInput = $("agent-name-input");
  const changedAgent = nameInput.dataset.agent !== a.id;
  if (changedAgent) settingsDrafts.delete("agent-name-input");
  if (
    changedAgent ||
    (!settingsDrafts.has("agent-name-input") &&
      document.activeElement !== nameInput)
  )
    nameInput.value = settings.agent_names?.[a.id] || "";
  if (changedAgent) $("agent-name-status").textContent = "";
  nameInput.dataset.agent = a.id;
  nameInput.placeholder = a.observed_label || a.id;
  $("agent-name-reset").disabled = !settings.agent_names?.[a.id];
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
  box.prepend(runtimeBadge(a));
  if (a.quiet) {
    const note = document.createElement("p");
    note.className = "waiting-note";
    note.textContent =
      "No new observation for " +
      duration(a.idle_s) +
      ". Last reported " +
      (a.recorded_status || "activity") +
      (a.last_tool ? " · " + a.last_tool : "") +
      ". Check the original runtime; silence does not prove that the process is stuck or finished.";
    box.append(note);
  }
  if (a.status === "waiting") {
    const waiting = document.createElement("p");
    waiting.className = "waiting-note";
    waiting.textContent = `Respond in ${runtimeName(a)}. This request stays open until the runtime reports a response or closes the session. Last observed ${new Date(Number(a.observed_at ?? a.updated_at) * 1000).toLocaleString()}.`;
    box.append(waiting);
  }
  const usageHeading = document.createElement("h3");
  usageHeading.textContent = "This session’s reported usage";
  const usageBox = document.createElement("div");
  const sessionUsage = sessionUsageForAgent(a);
  usageBox.innerHTML = usageSummary(sessionUsage);
  box.append(usageHeading, usageBox);
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
      "No events for this session in the live window. Check saved activity for earlier events.";
    box.append(p);
  }
}
function fillAgentPreferences(agent) {
  const form = $("agent-preference-form"),
    seat = $("agent-seat-select"),
    appearance = $("agent-appearance-select");
  form.hidden = false;
  const changed = form.dataset.agent !== agent.id;
  if (changed) {
    settingsDrafts.delete(seat.id);
    settingsDrafts.delete(appearance.id);
    $("agent-preference-status").textContent = "";
  }
  form.dataset.agent = agent.id;
  const preference = agentPreference(agent.id, settings);
  const wantedSeat =
    !changed && settingsDrafts.has(seat.id)
      ? seat.value
      : String(preference.seat ?? "auto");
  const wantedAppearance =
    !changed && settingsDrafts.has(appearance.id)
      ? appearance.value
      : preference.appearance || "default";
  const seats = scene.seatOptions();
  // Keep a bounded unsaved choice when departures shrink the occupied range.
  if (
    /^\d+$/.test(wantedSeat) &&
    Number(wantedSeat) <= 127 &&
    !seats.some((choice) => choice.slot === Number(wantedSeat))
  )
    seats.push({ slot: Number(wantedSeat), agentId: null, label: "Available" });
  const signature = JSON.stringify([agent.id, seats]);
  if (seat.dataset.options !== signature) {
    const automatic = new Option("Automatic", "auto");
    seat.replaceChildren(
      automatic,
      ...seats.map((choice) => {
        const option = new Option(
          `Desk ${choice.slot + 1} · ${choice.label}`,
          String(choice.slot),
        );
        option.disabled = !!choice.agentId && choice.agentId !== agent.id;
        return option;
      }),
    );
    seat.dataset.options = signature;
  }
  if (appearance.options.length !== CHARACTER_APPEARANCES.length)
    appearance.replaceChildren(
      ...CHARACTER_APPEARANCES.map(
        (choice) => new Option(choice.name, choice.id),
      ),
    );
  seat.value = wantedSeat;
  appearance.value = wantedAppearance;
  $("agent-preference-save").disabled = preferenceWritePending;
  $("agent-preference-reset").disabled = preferenceWritePending;
}
async function saveAgentPreferences(reset = false) {
  if (preferenceWritePending) return;
  const id = focusedId;
  const submitted = {
    "agent-seat-select": reset ? "auto" : $("agent-seat-select").value,
    "agent-appearance-select": reset
      ? "default"
      : $("agent-appearance-select").value,
  };
  const draftVersions = Object.fromEntries(
    Object.keys(submitted).map((field) => [
      field,
      settingsDraftVersions.get(field) || 0,
    ]),
  );
  const seatValue = submitted["agent-seat-select"];
  if (
    seatValue !== "auto" &&
    (!/^\d+$/.test(seatValue) || Number(seatValue) > 127)
  ) {
    $("agent-preference-status").textContent =
      "Choose an available desk or Automatic before saving.";
    return;
  }
  const result = scene.agentPreferencePatch(id, {
    seat:
      submitted["agent-seat-select"] === "auto"
        ? null
        : Number(submitted["agent-seat-select"]),
    appearance: submitted["agent-appearance-select"],
  });
  if (!result.ok) {
    $("agent-preference-status").textContent = result.error;
    return;
  }
  preferenceWritePending = true;
  $("agent-preference-save").disabled = true;
  $("agent-preference-reset").disabled = true;
  const saved = await saveSettings(result.patch);
  preferenceWritePending = false;
  if (focusedId === id) {
    if (saved) {
      if (reset)
        for (const [field, value] of Object.entries(submitted))
          if ((settingsDraftVersions.get(field) || 0) === draftVersions[field])
            $(field).value = value;
      acknowledgeDrafts(submitted);
    }
    $("agent-preference-status").textContent = saved
      ? reset
        ? "Default desk and appearance restored."
        : "Preferences saved."
      : "Preferences were not saved. Your selections are ready to retry.";
  }
  if (opened === "sheet-inspector") fillInspector();
}
$("agent-preference-form").onsubmit = (event) => {
  event.preventDefault();
  saveAgentPreferences();
};
$("agent-preference-reset").onclick = () => saveAgentPreferences(true);
function inactivePreferenceIds() {
  const active = new Set(scene.agents.map((agent) => agent.id));
  return Object.keys(settings.agent_preferences || {}).filter(
    (id) => !active.has(id),
  );
}
function fillInactivePreferences() {
  const inactive = inactivePreferenceIds();
  $("agent-preferences-count").textContent =
    `${Object.keys(settings.agent_preferences || {}).length} saved · ${inactive.length} inactive · 128 session limit`;
  $("clear-inactive-preferences").disabled =
    preferenceCleanupPending || !inactive.length;
}
$("clear-inactive-preferences").onclick = async () => {
  if (preferenceCleanupPending) return;
  const inactive = inactivePreferenceIds();
  if (!inactive.length) return;
  const preferences = { ...settings.agent_preferences };
  for (const id of inactive) delete preferences[id];
  preferenceCleanupPending = true;
  $("clear-inactive-preferences").disabled = true;
  const saved = await saveSettings({ agent_preferences: preferences });
  preferenceCleanupPending = false;
  $("agent-preferences-reset-status").textContent = saved
    ? `Cleared ${inactive.length} inactive session ${inactive.length === 1 ? "choice" : "choices"}. Active choices and local names were kept.`
    : "Inactive choices were not cleared. Try again.";
  fillSettings();
};
$("agent-name-form").onsubmit = async (e) => {
  e.preventDefault();
  const id = focusedId;
  if (!agents.some((a) => a.id === id)) return;
  const submitted = { "agent-name-input": $("agent-name-input").value };
  const names = { ...settings.agent_names },
    name = submitted["agent-name-input"].trim();
  if (name) names[id] = name;
  else delete names[id];
  if (Object.keys(names).length > 128) {
    $("agent-name-status").textContent =
      "This office already has 128 local names. Restore an existing name before adding another.";
    return;
  }
  $("agent-name-save").disabled = true;
  const saved = await updateSetting("agent_names", names);
  $("agent-name-save").disabled = false;
  if (focusedId === id) {
    if (saved) acknowledgeDrafts(submitted);
    $("agent-name-status").textContent = saved
      ? name
        ? "Local name saved."
        : "Runtime name restored."
      : "Name was not saved. Try again.";
    fillInspector();
  }
};
$("agent-name-reset").onclick = () => {
  $("agent-name-input").value = "";
  settingsDrafts.add("agent-name-input");
  $("agent-name-form").requestSubmit();
};
$("inspect-history").onclick = () => {
  const agent = agents.find((a) => a.id === focusedId);
  if (!agent) return;
  eventMode = "history";
  eventSession = {
    id: agent.id,
    platform: canonicalRuntime(agent.platform),
    label: agent.label || agent.id,
  };
  eventQuery = "";
  eventRuntime = "every";
  $("eventSearch").value = eventQuery;
  $("event-runtime").value = eventRuntime;
  openSheet("sheet-events");
};
function canonicalRuntime(platform) {
  const runtime = String(platform || "").toLowerCase();
  return ["hermes", "telegram", "cli", "gateway", ""].includes(runtime)
    ? "hermes"
    : runtime;
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
  const validTime = Number.isFinite(when.getTime());
  row.innerHTML = `<header><strong>${escapeHTML(EVENT_NAMES[e.event] || String(e.event || "event").replaceAll("_", " "))}</strong><time${validTime ? ` datetime="${when.toISOString()}" title="${escapeHTML(when.toLocaleString())}"` : ""}>${escapeHTML(validTime ? (eventMode === "history" ? when.toLocaleDateString([], { month: "short", day: "numeric" }) + " · " : "") + when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "")}</time></header><p>${escapeHTML(eventText(e))}</p>`;
  const identity = document.createElement("small");
  identity.className = "event-identity";
  identity.textContent = [e.platform, e.session_id || e.child_session_id]
    .filter(Boolean)
    .join(" · ");
  if (identity.textContent) row.append(identity);
  return row;
}
function reconcileEventRows(box, events, emptyText) {
  const previous = eventNodeCaches.get(box) || new Map(),
    next = new Map(),
    occurrences = new Map();
  let cursor = box.firstChild;
  for (const event of events) {
    const identity =
      event.id == null ? JSON.stringify(event) : "event:" + event.id;
    const occurrence = occurrences.get(identity) || 0;
    occurrences.set(identity, occurrence + 1);
    const key = identity + ":" + occurrence,
      signature = JSON.stringify([eventMode, event]);
    const cached = previous.get(key),
      row = cached?.signature === signature ? cached.row : eventRow(event);
    next.set(key, { row, signature });
    if (row === cursor) cursor = cursor.nextSibling;
    else box.insertBefore(row, cursor);
  }
  if (!events.length) {
    const empty = box.querySelector(".empty") || document.createElement("p");
    empty.className = "empty";
    setText(empty, emptyText);
    if (empty === cursor) cursor = cursor.nextSibling;
    else box.insertBefore(empty, cursor);
  }
  while (cursor) {
    const nextSibling = cursor.nextSibling;
    cursor.remove();
    cursor = nextSibling;
  }
  eventNodeCaches.set(box, next);
}
async function loadHistory(force = false) {
  if (historyLoading) return false;
  if (!force && historyLoaded && Date.now() - historyLastLoaded < 5000)
    return true;
  const request = ++historyRequest;
  const receivedAtRequest = Number(window._state?.tracking?.received) || 0;
  historyLoading = true;
  historyError = "";
  fillEvents();
  try {
    const response = await fetch(`history?limit=${settings.history_limit}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("History unavailable");
    const data = await response.json();
    if (!Array.isArray(data.events)) throw new Error("Invalid history");
    if (request !== historyRequest) return false;
    historyEvents = data.events;
    historyLoaded = true;
    historyLastLoaded = Date.now();
    historyReceived = receivedAtRequest;
    return true;
  } catch {
    if (request === historyRequest)
      historyError = historyLoaded
        ? "Could not refresh saved history. The last loaded events are still available."
        : "Could not load saved history. Check the observer connection and try again.";
    return false;
  } finally {
    if (request === historyRequest) {
      historyLoading = false;
      if (opened === "sheet-events") {
        fillEvents();
        if (historyLoaded && pendingHistoryScroll !== null) {
          $("sheet-events").scrollTop = pendingHistoryScroll;
          pendingHistoryScroll = null;
          persistView();
        }
      }
    }
  }
}
function fillEvents() {
  const box = $("eventbox");
  const q = eventQuery.trim().toLowerCase();
  const source =
    eventMode === "history"
      ? historyEvents
      : (window._state?.events || []).slice().reverse();
  const events = source.filter(
    (e) =>
      (!eventSession ||
        ((e.session_id === eventSession.id ||
          e.child_session_id === eventSession.id) &&
          canonicalRuntime(e.platform) === eventSession.platform)) &&
      (eventRuntime === "every" || platOf(e) === eventRuntime) &&
      [JSON.stringify(e), EVENT_NAMES[e.event], eventText(e)]
        .join(" ")
        .toLowerCase()
        .includes(q),
  );
  reconcileEventRows(
    box,
    events.slice(0, eventPageSize),
    eventMode === "history" && historyLoading
      ? "Loading saved activity…"
      : "No matching activity yet.",
  );
  for (const button of $("event-tabs").children)
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.eventView === eventMode),
    );
  $("history-more").hidden = events.length <= eventPageSize;
  $("clear-session-filter").hidden = !eventSession;
  if (eventSession)
    $("clear-session-filter").textContent =
      `Session: ${eventSession.label} · Show all activity`;
  $("refresh-history").disabled = historyLoading;
  $("export-history").disabled = historyLoading;
  $("history-status").textContent =
    historyError && eventMode === "history"
      ? historyError
      : eventMode === "history"
        ? `${historyLoading ? "Refreshing… " : ""}Showing ${Math.min(events.length, eventPageSize).toLocaleString()} of ${events.length.toLocaleString()} matching saved events. ${source.length.toLocaleString()} loaded; newest received first.`
        : `${events.length} of ${source.length} recent events. Live activity updates automatically.`;
}
$("eventSearch").oninput = (e) => {
  eventQuery = e.target.value;
  eventPageSize = 100;
  fillEvents();
  queueViewSave();
};
$("event-runtime").onchange = (e) => {
  eventRuntime = e.target.value;
  eventSession = null;
  eventPageSize = 100;
  fillEvents();
  persistView();
};
$("clear-session-filter").onclick = () => {
  eventSession = null;
  eventPageSize = 100;
  fillEvents();
};
for (const button of $("event-tabs").children)
  button.onclick = () => {
    eventMode = button.dataset.eventView;
    pendingHistoryScroll = null;
    eventPageSize = 100;
    fillEvents();
    if (eventMode === "history") loadHistory();
    persistView();
  };
$("refresh-history").onclick = () => {
  eventMode = "history";
  loadHistory(true);
};
$("history-more").onclick = () => {
  eventPageSize += 100;
  fillEvents();
};
$("export-history").onclick = async () => {
  if (await loadHistory(true))
    downloadBlob(
      new Blob(
        [
          JSON.stringify(
            {
              version: 1,
              exported_at: new Date().toISOString(),
              events: historyEvents,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
      "agent-office-history.json",
    );
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
  queueViewSave();
};
for (const b of $("badge-tabs").querySelectorAll("button"))
  b.onclick = () => {
    badgeFilter = b.dataset.filter;
    for (const x of $("badge-tabs").children)
      x.setAttribute("aria-pressed", String(x === b));
    fillBadges();
    persistView();
  };
function syncAttention() {
  const agent = agents.find((a) => a.id === attentionNotice?.id);
  if (
    !agent ||
    (attentionNotice?.kind === "waiting" && agent.status !== "waiting")
  )
    attentionNotice = null;
  $("attention").hidden = offline || !attentionNotice;
  if (!attentionNotice) return;
  $("attention-title").textContent =
    `${window._state?.mode === "demo" ? "Demo · " : ""}${agent.label || agent.id}${attentionNotice.kind === "waiting" ? " needs input" : " reported an error"}`;
  $("attention-detail").textContent =
    attentionNotice.kind === "waiting"
      ? `${agent.detail || "A response is waiting"} · Respond in ${runtimeName(agent)}.`
      : attentionNotice.detail;
}
function updateAttention(state, previousState) {
  const events = state.events || [],
    received = state.tracking?.received,
    previousReceived = previousState?.tracking?.received;
  let fresh = [],
    notify = false;
  if (initialized) {
    if (Number.isFinite(received) && Number.isFinite(previousReceived)) {
      const count = received - previousReceived;
      if (count > 0) fresh = events.slice(-Math.min(count, events.length));
    } else
      fresh = events.filter(
        (event) =>
          !seenAttention.has(JSON.stringify(event)) &&
          Number(event.ts) >= Number(previousState?.ts || 0),
      );
  }
  for (const event of events) seenAttention.add(JSON.stringify(event));
  while (seenAttention.size > 256)
    seenAttention.delete(seenAttention.values().next().value);
  for (const event of fresh) {
    const id = String(event.session_id || event.child_session_id || ""),
      agent = agents.find((a) => a.id === id);
    if (!agent) continue;
    if (
      ["approval_request", "input_request"].includes(event.event) &&
      agent.status === "waiting"
    )
      attentionNotice = { id, kind: "waiting" };
    else if (
      event.event === "session_error" ||
      (event.event === "tool_end" && event.status === "error")
    )
      attentionNotice = {
        id,
        kind: "error",
        detail:
          event.error_message || "Inspect the recorded event for details.",
      };
    else continue;
    notify = true;
  }
  if (notify) chime();
  syncAttention();
}
$("attention-dismiss").onclick = () => {
  attentionNotice = null;
  syncAttention();
};
$("attention-inspect").onclick = () => {
  if (attentionNotice) selectAgent(attentionNotice.id);
};
function applyState(state, pollRevision = settingsRevision) {
  if (!state || !Array.isArray(state.agents) || !Array.isArray(state.events))
    throw new Error("Invalid office state");
  const previousState = window._state;
  window._state = state;
  offline = false;
  agents = state.agents;
  progress = state.progress || null;
  sessionUsageIndex = new Map(
    (state.usage?.by_session || []).map((row) => [
      JSON.stringify([
        String(row.platform || "").toLowerCase(),
        String(row.session_id),
      ]),
      row,
    ]),
  );
  const restoredView = !viewRestored ? restoreViewState() : null;
  if (state.settings && !pendingSaves && pollRevision === settingsRevision) {
    Object.assign(confirmedSettings, normalizeSettings(state.settings));
    Object.assign(settings, confirmedSettings);
  }
  applyTheme();
  updateScene();
  if (restoredView) {
    scene.paused = reducedMotion.matches || restoredView.paused;
    scene.setZoom(restoredView.zoom);
    syncPause();
  }
  if (typeof reconcileFurniture === "function") reconcileFurniture();
  if (typeof syncFurnitureControls === "function") syncFurnitureControls();
  document.body.classList.remove("offline");
  $("connection").textContent = "Connected";
  $("mode").hidden = state.mode !== "demo";
  $("agent-total").textContent = agents.length;
  const n = agents.length,
    w = agents.filter((a) => a.status === "waiting").length;
  $("count").textContent =
    n + " agent" + (n === 1 ? "" : "s") + " on the floor";
  $("waiting-count").textContent = w
    ? w + (w === 1 ? " needs input" : " need input")
    : "";
  $("waiting-count").hidden = !w;
  if (opened === "sheet-setup") fillSetup();
  syncEmptyState();
  syncHealth();
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
  const newUnlocks = [];
  for (const u of progress?.recent || []) {
    if (!seenUnlocks.has(u.id)) {
      seenUnlocks.add(u.id);
      if (initialized) newUnlocks.push(u);
    }
  }
  if (newUnlocks.length) {
    toast(
      newUnlocks.length === 1
        ? "Achievement earned: " + newUnlocks[0].name
        : newUnlocks.length +
            " achievements earned. Open Achievements to see your rewards.",
    );
    chime();
  }
  updateAttention(state, previousState);
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
  } else if (opened === "sheet-events") {
    fillEvents();
    if (
      eventMode === "history" &&
      (!historyLoaded || Number(state.tracking?.received) !== historyReceived)
    )
      loadHistory();
  } else if (opened === "sheet-inspector") fillInspector();
  else if (opened === "sheet-tasks") fillTasks();
  else if (opened === "sheet-unlocks") fillBadges();
  const signature = JSON.stringify(settings) + haveUnlock("layout_bullpen");
  if (signature !== settingsSignature) {
    settingsSignature = signature;
    fillSettings();
  } else if (opened === "sheet-settings") fillInactivePreferences();
  initialized = true;
  fillTrackingStatus();
  syncBudget();
  if (restoredView?.panel) openSheet(restoredView.panel);
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
    syncAttention();
    syncHealth();
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
  queuedSettings.push(patch);
  Object.assign(settings, patch);
  pendingSaves++;
  settingsRevision++;
  applyTheme();
  updateScene();
  fillSettings();
  $("save-status").textContent = "Saving…";
  saveQueue = saveQueue.then(async () => {
    let saved = false;
    try {
      const r = await fetch("settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) throw new Error("Save failed");
      Object.assign(confirmedSettings, normalizeSettings(await r.json()));
      saved = true;
    } catch {
      toast("Could not save settings. Reconnect and try again.");
    } finally {
      queuedSettings.shift();
      pendingSaves--;
      // Start from acknowledged server values, then preserve newer optimistic
      // edits. A failed request must never become the rollback base of another.
      Object.assign(settings, confirmedSettings, ...queuedSettings);
      // Also invalidate polls started while the write was in flight.
      settingsRevision++;
      reconcileFurniture();
      applyTheme();
      updateScene();
      fillSettings();
      $("save-status").textContent = !saved
        ? "Not saved. Server unavailable."
        : pendingSaves
          ? "Saving…"
          : "Saved on this computer.";
    }
    return saved;
  });
  // Button handlers can ignore this promise; transactional callers receive the
  // outcome of their own write, after rollback/reconciliation has completed.
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
  seg.setAttribute("role", "group");
  seg.setAttribute("aria-label", label);
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
function fillTrackingStatus() {
  const tracking = window._state?.tracking;
  if (!tracking) {
    $("tracking-status").textContent =
      "Connect the observer to view stored activity.";
    return;
  }
  const sizes = [];
  for (const [key, label] of [
    ["retained_bytes", "event history"],
    ["database_bytes", "database file"],
  ]) {
    const bytes = tracking[key];
    if (typeof bytes !== "number" || !Number.isFinite(bytes)) continue;
    const size =
      bytes >= 1048576
        ? `${(bytes / 1048576).toFixed(1)} MiB`
        : bytes >= 1024
          ? `${(bytes / 1024).toFixed(1)} KiB`
          : `${bytes.toLocaleString()} B`;
    sizes.push(`${size} ${label}`);
  }
  $("tracking-status").textContent =
    `${Number(tracking.retained || 0).toLocaleString()} saved events${sizes.length ? " · " + sizes.join(" · ") : ""}. ${Number(tracking.received || 0).toLocaleString()} received in total.${tracking.backlog ? " " + Number(tracking.backlog).toLocaleString() + " events are waiting to be processed." : ""}${tracking.invalid_records ? " " + Number(tracking.invalid_records).toLocaleString() + " unreadable records were skipped." : ""}`;
}
function syncHealth() {
  const quiet = agents.find((agent) => agent.quiet),
    tracking = window._state?.tracking || {};
  const storage =
    tracking.backlog > 0 ||
    tracking.invalid_records > 0 ||
    tracking.retained_bytes >= settings.history_max_bytes * 0.9;
  const button = $("health-alert");
  button.hidden = offline || (!quiet && !storage);
  button.textContent = quiet ? "Check quiet agent" : "Check event storage";
  button.title = quiet
    ? (quiet.label || quiet.id) +
      " has not reported for " +
      duration(quiet.idle_s)
    : "Inspect backlog, unreadable records and history retention in Customize";
  button.onclick = quiet
    ? () => selectAgent(quiet.id)
    : () => openSheet("sheet-settings");
}
function syncBudget() {
  const totals = window._state?.usage?.totals,
    budget = Number(settings.budget_usd),
    cost = totals?.cost_usd,
    reached =
      budget > 0 &&
      typeof cost === "number" &&
      Number.isFinite(cost) &&
      cost >= budget;
  $("budget-alert").hidden = !reached;
  $("budget-warning").hidden = !reached;
  if (!reached) return;
  const message = `Reported runtime cost ${usageValue(totals, "cost_usd")} has reached your ${usageValue({ cost_usd: budget }, "cost_usd")} USD alert threshold. ${usageCoverage(totals, "cost_usd")}. Runtime estimates may differ from billing.`;
  $("budget-warning").textContent = message;
  $("budget-alert").title = message;
  $("budget-alert").textContent =
    "Usage alert · " + usageValue(totals, "cost_usd");
}
$("budget-alert").onclick = () => openSheet("sheet-floor");
$("budget-form").onsubmit = async (e) => {
  e.preventDefault();
  const submitted = { "budget-input": $("budget-input").value };
  const amount = Number(submitted["budget-input"]);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1000000000) return;
  const saved = await updateSetting("budget_usd", amount);
  if (saved) acknowledgeDrafts(submitted);
  fillSettings();
  syncBudget();
  if (saved) toast(amount ? "Usage alert saved." : "Usage alert turned off.");
};
$("pet-name-form").onsubmit = async (e) => {
  e.preventDefault();
  const submitted = {
    "pet-cat1-name": $("pet-cat1-name").value,
    "pet-cat2-name": $("pet-cat2-name").value,
  };
  const names = Object.fromEntries(
    [
      ["cat1", submitted["pet-cat1-name"].trim()],
      ["cat2", submitted["pet-cat2-name"].trim()],
    ].filter(([, name]) => name),
  );
  if (await updateSetting("pet_names", names)) {
    acknowledgeDrafts(submitted);
    fillSettings();
    toast("Pet names saved.");
  }
};
$("room-name-form").onsubmit = async (e) => {
  e.preventDefault();
  const submitted = { "room-name-input": $("room-name-input").value };
  $("room-name-save").disabled = true;
  const saved = await updateSetting("room_name", submitted["room-name-input"]);
  $("room-name-save").disabled = false;
  if (saved) {
    acknowledgeDrafts(submitted);
    fillSettings();
    toast(settings.room_name ? "Office name saved." : "Layout name restored.");
  }
};
$("clear-history").onclick = async () => {
  if (
    !confirm(
      "Clear saved event history? XP, reported usage, current agents and unanswered requests will stay.",
    )
  )
    return;
  $("clear-history").disabled = true;
  try {
    const response = await fetch("history", {
      method: "DELETE",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Clear failed");
    historyRequest++;
    historyLoading = false;
    historyLoaded = true;
    historyEvents = [];
    historyError = "";
    if (window._state) {
      window._state.events = [];
      if (window._state.tracking) {
        window._state.tracking.retained = 0;
        window._state.tracking.retained_bytes = 0;
      }
    }
    $("storage-status").textContent =
      "Saved history cleared. XP, usage totals and current sessions are intact.";
    $("latest-event").textContent =
      "History cleared. Waiting for new activity…";
    fillTrackingStatus();
    fillEvents();
  } catch {
    $("storage-status").textContent =
      "Could not clear history. Check the observer connection and try again.";
  } finally {
    $("clear-history").disabled = false;
  }
};
function fillSettings() {
  fillInactivePreferences();
  for (const [id, value] of [
    ["pet-cat1-name", settings.pet_names?.cat1 || ""],
    ["pet-cat2-name", settings.pet_names?.cat2 || ""],
    ["budget-input", settings.budget_usd || 0],
    ["room-name-input", settings.room_name || ""],
  ])
    if (!settingsDrafts.has(id) && document.activeElement !== $(id))
      $(id).value = value;
  const retention = $("history-settings");
  if (!retention.children.length)
    retention.append(
      segmented("Maximum events", "history_limit", [
        [250, "250"],
        [1000, "1,000"],
        [5000, "5,000"],
      ]),
      segmented("Maximum age", "history_days", [
        [1, "1 day"],
        [7, "7 days"],
        [30, "30 days"],
      ]),
      segmented("Maximum history size", "history_max_bytes", [
        [1048576, "1 MiB"],
        [5242880, "5 MiB"],
        [20971520, "20 MiB"],
      ]),
    );
  for (const button of retention.querySelectorAll("[data-setting]"))
    button.setAttribute(
      "aria-pressed",
      String(
        settings[button.dataset.setting] === JSON.parse(button.dataset.value),
      ),
    );
  fillTrackingStatus();
  syncBudget();
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
    b.setAttribute("aria-label", l.name + ": " + b.textContent);
  }
  const box = $("settingsbox");
  if (!box.children.length) {
    box.append(
      segmented(
        "Color palette",
        "theme",
        THEMES.map((t) => [t.id, t.name]),
      ),
      segmented(
        "Desk finish",
        "desk_style",
        DESK_STYLES.map((style) => [style.id, style.name]),
      ),
      segmented("Delegated agents", "subagent_style", [
        ["robot", "Studio robot"],
        ["people", "People"],
      ]),
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
      segmented("Pets", "show_pets", [
        [true, "Show"],
        [false, "Hide"],
      ]),
      segmented("Pet movement", "pets_roam", [
        [true, "Roam"],
        [false, "Rest"],
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
      "Reset all XP, achievements, reported usage and event history? This cannot be undone. Your room settings will stay.",
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
  syncEmptyState();
  persistView();
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
for (const id of ["zoom-in", "zoom-out", "zoom-fit"])
  $(id).addEventListener("click", persistView);
$("pausebtn").onclick = () => {
  scene.paused = !scene.paused;
  syncPause();
  persistView();
};
function syncPause() {
  labelButton(
    $("pausebtn"),
    scene.paused ? "play" : "pause",
    scene.paused ? "Resume motion" : "Pause motion",
  );
  $("pausebtn").setAttribute("aria-pressed", String(scene.paused));
  window.officeJukebox?.sync();
}
$("capturebtn").onclick = () => scene.snapshot();
$("legendbox").innerHTML = kv([
  ["Working", "A tool is running"],
  ["Thinking", "Between tool calls"],
  ["Needs input", "A question or approval is waiting in the runtime"],
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
    if (opened) backSheet();
    else finishFurniture();
    return;
  }
  if (opened && e.key === "Tab") {
    const els = [
      ...$(opened).querySelectorAll(
        'button:not(:disabled),a,input,select,summary,[tabindex="0"]',
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
  "export-history": "download",
  "refresh-history": "redo-2",
  "inspect-history": "activity",
  "clear-history": "trash-2",
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
