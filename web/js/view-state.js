/* Browser-only viewing preferences. Never contains observer or playback state. */
"use strict";
window.officeViewState = (() => {
  const runtimes = [
    "every",
    "hermes",
    "claude",
    "codex",
    "opencode",
    "telegram",
    "cli",
  ];
  const panels = [
    "sheet-floor",
    "sheet-tasks",
    "sheet-events",
    "sheet-unlocks",
    "sheet-legend",
  ];
  const scrollPanels = [...panels, "sheet-settings", "sheet-setup"];
  const key =
    "agent-office:view:v1:" +
    (document.body.dataset.agentOfficePreview === "1" ? "preview" : "observer");
  const text = (value) =>
    typeof value === "string" ? value.slice(0, 160) : "";
  function validate(value) {
    const input =
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      value.version === 1
        ? value
        : {};
    const scroll = {};
    for (const panel of scrollPanels) {
      const offset = input.scroll?.[panel];
      if (typeof offset === "number" && Number.isFinite(offset))
        scroll[panel] = Math.max(0, Math.min(250000, Math.round(offset)));
    }
    return {
      version: 1,
      zoom:
        typeof input.zoom === "number" && Number.isFinite(input.zoom)
          ? Math.max(1, Math.min(3, input.zoom))
          : 1,
      runtime: runtimes.includes(input.runtime) ? input.runtime : "every",
      paused: input.paused === true,
      panel: panels.includes(input.panel) ? input.panel : null,
      eventMode: input.eventMode === "history" ? "history" : "latest",
      taskMode: input.taskMode === "reported" ? "reported" : "activity",
      eventRuntime: runtimes.includes(input.eventRuntime)
        ? input.eventRuntime
        : "every",
      badgeFilter: ["all", "earned", "next", "rewards"].includes(
        input.badgeFilter,
      )
        ? input.badgeFilter
        : "all",
      queries: {
        agents: text(input.queries?.agents),
        events: text(input.queries?.events),
        badges: text(input.queries?.badges),
      },
      scroll,
    };
  }
  return Object.freeze({
    key,
    read() {
      try {
        return validate(JSON.parse(localStorage.getItem(key)));
      } catch {
        return validate(null);
      }
    },
    write(value) {
      try {
        localStorage.setItem(key, JSON.stringify(validate(value)));
        return true;
      } catch {
        return false;
      }
    },
  });
})();
