/* Observer attention navigation and tab-title presentation. */
"use strict";
(function (root) {
  function waitingAgents(agents) {
    return Array.isArray(agents)
      ? agents.filter(
          (agent) =>
            agent?.status === "waiting" &&
            typeof agent.id === "string" &&
            agent.id.length > 0,
        )
      : [];
  }

  function statusCounts(agents) {
    const counts = { working: 0, thinking: 0, waiting: 0 };
    for (const agent of Array.isArray(agents) ? agents : [])
      if (
        typeof agent?.id === "string" &&
        agent.id.length > 0 &&
        Object.hasOwn(counts, agent.status)
      )
        counts[agent.status]++;
    return counts;
  }

  function nextWaitingAgent(agents, currentId, direction = 1) {
    const waiting = waitingAgents(agents);
    if (!waiting.length) return null;
    const current = waiting.findIndex((agent) => agent.id === currentId),
      step = direction < 0 ? -1 : 1;
    if (current < 0) return step < 0 ? waiting.at(-1) : waiting[0];
    return waiting[(current + step + waiting.length) % waiting.length];
  }

  function attentionTitle({
    agents = [],
    status = "connecting",
    baseTitle = "Agent Office",
  } = {}) {
    if (status === "connected") {
      const count = waitingAgents(agents).length;
      return count
        ? `(${count} ${count === 1 ? "needs" : "need"} input) ${baseTitle}`
        : baseTitle;
    }
    const label =
      status === "disconnected"
        ? "Disconnected"
        : status === "connecting"
          ? "Connecting"
          : "Last snapshot";
    return `${label} · ${baseTitle}`;
  }

  function typingTarget(event) {
    const path = event.composedPath?.() || [event.target];
    return path.some(
      (target) =>
        /^(INPUT|TEXTAREA|SELECT)$/i.test(target?.tagName || "") ||
        target?.isContentEditable ||
        target?.closest?.(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"], [role="combobox"]',
        ),
    );
  }

  function createController({
    getAgents,
    inspect,
    getSelectedId = () => null,
    getStatus = () => "connecting",
    getPanel = () => null,
    isEditing = () => false,
    setTitle = () => {},
    baseTitle = "Agent Office",
  }) {
    function navigate(direction = 1, event) {
      if (getStatus() !== "connected" || isEditing()) return false;
      const next = nextWaitingAgent(getAgents(), getSelectedId(), direction);
      if (!next) return false;
      event?.preventDefault();
      inspect(next.id);
      return true;
    }

    function handleKeydown(event) {
      if (
        String(event.key).toLowerCase() !== "p" ||
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.repeat ||
        typingTarget(event)
      )
        return false;
      const panel = getPanel();
      if (panel && panel !== "sheet-inspector") return false;
      return navigate(event.shiftKey ? -1 : 1, event);
    }

    function refresh() {
      const title = attentionTitle({
        agents: getAgents(),
        status: getStatus(),
        baseTitle,
      });
      setTitle(title);
      return title;
    }

    return Object.freeze({ handleKeydown, refresh, inspectNext: navigate });
  }

  const api = Object.freeze({
    waitingAgents,
    nextWaitingAgent,
    attentionTitle,
    createController,
    statusCounts,
  });
  if (typeof module === "object" && module.exports) module.exports = api;
  root.OfficeAttention = api;
})(typeof window === "undefined" ? globalThis : window);
