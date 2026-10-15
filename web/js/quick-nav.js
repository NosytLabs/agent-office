/* Read-only navigation. Callers supply view-opening actions, never task execution. */
let instance = 0;
const runtimeNames = {
  hermes: "Hermes",
  cli: "Hermes CLI",
  telegram: "Telegram",
  gateway: "Hermes gateway",
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
};
const statusNames = {
  waiting: "Needs input",
  working: "Working",
  thinking: "Thinking",
  idle: "Idle",
  done: "Ended",
  gone: "Ended",
};
const text = (value) => (typeof value === "string" ? value : "");
const fold = (value) => value.normalize("NFKC").toLowerCase();
function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content) node.textContent = content;
  return node;
}

export function createQuickNav({
  getAgents = () => [],
  getState = () => ({}),
  actions = [],
  onPickAgent = () => {},
} = {}) {
  const id = "quick-nav-" + ++instance;
  const dialog = element("dialog", "quick-nav-dialog");
  const header = element("div", "quick-nav-header");
  const heading = element("h2", "", "Quick navigation");
  heading.id = id + "-heading";
  const closeButton = element("button", "btn quick-nav-close", "×");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close quick navigation");
  header.append(heading, closeButton);
  const input = element("input", "txt quick-nav-search");
  input.type = "search";
  input.maxLength = 160;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "Find a session or office panel…";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-label", "Search sessions and panels");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "true");
  const list = element("ul", "quick-nav-list");
  list.id = id + "-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Navigation results");
  input.setAttribute("aria-controls", list.id);
  const status = element("p", "quick-nav-status");
  status.setAttribute("role", "status");
  status.id = id + "-status";
  const hint = element(
    "p",
    "quick-nav-hint",
    "↑ ↓ choose · Enter opens · Escape closes. Opens views only.",
  );
  hint.id = id + "-hint";
  input.setAttribute("aria-describedby", status.id);
  dialog.setAttribute("aria-labelledby", heading.id);
  dialog.setAttribute("aria-describedby", hint.id);
  dialog.append(header, input, status, list, hint);
  document.body.append(dialog);
  let opener = null,
    selected = 0,
    matches = [],
    destroyed = false,
    composing = false;

  function agents() {
    const value = getAgents();
    return Array.isArray(value) ? value : [];
  }
  function freshness() {
    const state = getState() || {};
    if (state.offline)
      return "Observer disconnected; sessions are last received data.";
    return state.mode === "demo"
      ? "Synthetic demo sessions."
      : "Sessions use the last received observations.";
  }
  function entries() {
    const panels = actions
      .filter((action) => action && typeof action.run === "function")
      .map((action) => ({
        key: "action:" + action.id,
        label: text(action.label),
        detail: "Office panel",
        search: [
          text(action.label),
          ...(Array.isArray(action.keywords)
            ? action.keywords.map(text)
            : [text(action.keywords)]),
        ].join(" "),
        action,
      }));
    return panels.concat(
      agents()
        .filter((agent) => agent && text(agent.id))
        .map((agent) => {
          const platform = text(agent.platform) || text(agent.runtime);
          const runtime =
            runtimeNames[platform.toLowerCase()] ||
            platform ||
            "Runtime not reported";
          const project =
            text(agent.project_name) ||
            text(agent.project) ||
            text(agent.project?.name) ||
            text(agent.workspace_name) ||
            text(agent.workspace) ||
            text(agent.workspace?.name) ||
            text(agent.cwd);
          const label = text(agent.label) || agent.id;
          const detail = [
            runtime,
            statusNames[agent.status] || text(agent.status),
            project,
          ]
            .filter(Boolean)
            .join(" · ");
          return {
            key: "agent:" + agent.id,
            label,
            detail,
            search: [
              label,
              agent.id,
              detail,
              platform,
              text(agent.tool),
              text(agent.detail),
            ].join(" "),
            agentId: agent.id,
          };
        }),
    );
  }
  function select(index) {
    selected = matches.length ? (index + matches.length) % matches.length : 0;
    [...list.children].forEach((row, i) =>
      row.setAttribute("aria-selected", String(i === selected)),
    );
    const row = list.children[selected];
    if (row) {
      input.setAttribute("aria-activedescendant", row.id);
      row.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  }
  function render(keepSelection = false) {
    const previous = keepSelection ? matches[selected]?.key : null;
    const query = fold(input.value.trim());
    const terms = query.split(/\s+/).filter(Boolean);
    const found = entries().filter((entry) =>
      terms.every((term) => fold(entry.search).includes(term)),
    );
    const rank = (entry) =>
      fold(entry.label) === query
        ? 0
        : fold(entry.label).startsWith(query)
          ? 1
          : 2;
    found.sort((a, b) => rank(a) - rank(b));
    matches = found.slice(0, 20);
    list.replaceChildren(
      ...matches.map((entry, index) => {
        const row = element("li", "quick-nav-row");
        row.id = id + "-option-" + index;
        row.setAttribute("role", "option");
        row.append(
          element("strong", "quick-nav-label", entry.label),
          element("small", "quick-nav-detail", entry.detail),
        );
        row.addEventListener("pointerdown", (event) => event.preventDefault());
        row.addEventListener("click", () => pick(index));
        return row;
      }),
    );
    const count =
      found.length > matches.length
        ? `${matches.length} of ${found.length} matches.`
        : `${matches.length} ${matches.length === 1 ? "match" : "matches"}.`;
    status.textContent = `${found.length ? count : "No matching sessions or panels."} ${freshness()}`;
    const previousIndex = matches.findIndex((entry) => entry.key === previous);
    select(previousIndex >= 0 ? previousIndex : 0);
  }
  function close(restoreFocus = true) {
    if (!dialog.open) return;
    dialog.close();
    composing = false;
    if (
      restoreFocus &&
      opener?.isConnected &&
      !opener.matches(":disabled") &&
      !opener.closest("[inert]") &&
      opener.getClientRects().length
    )
      opener.focus({ preventScroll: true });
    opener = null;
  }
  function pick(index) {
    const entry = matches[index];
    if (!entry) return;
    if (
      entry.agentId &&
      !agents().some((agent) => agent.id === entry.agentId)
    ) {
      render();
      status.textContent =
        "This session is no longer available. " + freshness();
      return;
    }
    close(false);
    if (entry.agentId) onPickAgent(entry.agentId);
    else entry.action.run();
  }
  function open() {
    if (destroyed) return;
    if (!dialog.open) {
      opener = document.activeElement;
      input.value = "";
      dialog.showModal();
    }
    render();
    input.focus({ preventScroll: true });
  }
  function shortcut(event) {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      composing ||
      event.repeat ||
      event.altKey ||
      event.shiftKey ||
      event.ctrlKey === event.metaKey ||
      event.key.toLowerCase() !== "k"
    )
      return;
    const inside = dialog.contains(event.target);
    if (
      !inside &&
      event
        .composedPath()
        .some(
          (node) =>
            node instanceof HTMLElement &&
            (node.matches("input,textarea,select") ||
              node.isContentEditable ||
              node.getAttribute("role") === "textbox"),
        )
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    if (dialog.open) close();
    else open();
  }
  input.addEventListener("input", () => render());
  dialog.addEventListener("compositionstart", () => {
    composing = true;
  });
  dialog.addEventListener("compositionend", () => {
    composing = false;
    render();
  });
  dialog.addEventListener("keydown", (event) => {
    // Existing sheet shortcuts must not run underneath this top-layer dialog.
    event.stopPropagation();
    if (event.isComposing || composing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (
      event.target === input &&
      ["ArrowDown", "ArrowUp", "Enter"].includes(event.key)
    ) {
      event.preventDefault();
      if (event.key === "Enter") pick(selected);
      else select(selected + (event.key === "ArrowDown" ? 1 : -1));
    } else if (
      event.key === "Tab" &&
      ((event.target === input && !event.shiftKey) ||
        (event.target === closeButton && event.shiftKey))
    ) {
      event.preventDefault();
      (event.target === input ? closeButton : input).focus();
    }
  });
  closeButton.addEventListener("click", () => close());
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (!composing) close();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    )
      close();
  });
  document.addEventListener("keydown", shortcut, true);
  return Object.freeze({
    open,
    close: () => close(),
    refresh: () => {
      if (dialog.open) render(true);
    },
    destroy() {
      close();
      destroyed = true;
      document.removeEventListener("keydown", shortcut, true);
      dialog.remove();
    },
    get isOpen() {
      return dialog.open;
    },
  });
}
