/* Source-reported task lists. Read-only: no task completion or agent control. */
"use strict";
(() => {
  const views = new WeakMap();
  const statusNames = {
    pending: "Pending",
    in_progress: "In progress",
    completed: "Completed",
    cancelled: "Cancelled",
  };
  const runtimeNames = {
    opencode: "OpenCode",
    codex: "Codex",
    hermes: "Hermes",
    claude: "Claude Code",
  };
  const text = (value, fallback = "") =>
    typeof value === "string" ? value : fallback;
  const node = (tag, className, content) => {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (content !== undefined) result.textContent = content;
    return result;
  };
  function dateLabel(value) {
    if (typeof value !== "number" || !Number.isFinite(value))
      return "unavailable";
    const date = new Date(value * 1000);
    return Number.isFinite(date.getTime())
      ? date.toLocaleString()
      : "unavailable";
  }
  function validRows(rows) {
    return (
      Array.isArray(rows) &&
      rows.length <= 100 &&
      rows.every(
        (row) =>
          row &&
          typeof row.id === "string" &&
          typeof row.content === "string" &&
          row.content.length <= 1024 &&
          Object.hasOwn(statusNames, row.status),
      )
    );
  }

  window.renderReportedTasks = (
    container,
    boards,
    agents,
    { onSelect } = {},
  ) => {
    if (!container) return;
    let view = views.get(container);
    if (!view) {
      view = { signature: null, onSelect: null };
      views.set(container, view);
    }
    view.onSelect = typeof onSelect === "function" ? onSelect : null;
    const inputValid = Array.isArray(boards) && boards.length <= 128;
    const entries = (inputValid ? boards : [])
      .filter((board) => board && typeof board === "object")
      .map((board) => {
        const runtime = text(board.runtime),
          session = text(board.session_id);
        // The existing inspector is keyed by session ID. Do not route an
        // ambiguous duplicate ID to whichever runtime happens to appear first.
        const candidates = (Array.isArray(agents) ? agents : []).filter(
          (agent) => agent.id === session,
        );
        const candidate =
          candidates.length === 1 &&
          text(candidates[0].platform, "hermes") === runtime
            ? candidates[0]
            : null;
        const canSelect = Boolean(
          view.onSelect &&
          candidate &&
          board.historical === false &&
          !["done", "gone"].includes(candidate.status),
        );
        return {
          runtime,
          session,
          source: text(board.source, "Unknown source"),
          observed_at: board.observed_at,
          source_updated_at: board.source_updated_at ?? null,
          historical: board.historical !== false,
          tasks: validRows(board.tasks) ? board.tasks : null,
          label: text(candidate?.label, session),
          canSelect,
        };
      });
    // Receipt dates are absolute; ticking age_s alone must not rebuild the DOM
    // and remove selected task text or the user's currently focused button.
    const signature = JSON.stringify([inputValid, entries]);
    if (signature === view.signature) return;
    view.signature = signature;
    const active = document.activeElement;
    const focused =
      container.contains(active) &&
      active?.classList.contains("task-agent-link")
        ? {
            session: active.dataset.taskSession,
            runtime: active.dataset.taskRuntime,
          }
        : null;
    const fragment = document.createDocumentFragment();
    if (!entries.length) {
      fragment.append(
        node(
          "p",
          "task-empty",
          inputValid
            ? "No task lists reported yet."
            : "Task reporting is unavailable.",
        ),
      );
      fragment.append(
        node(
          "p",
          "h",
          "OpenCode and captured Codex exec streams can report task lists. Session activity is available in the other view.",
        ),
      );
    }
    for (const board of entries) {
      const section = node("section", "task-board");
      const heading = node("div", "task-board-heading");
      heading.append(
        node(
          "h3",
          "",
          board.historical ? "Last reported tasks" : "Reported tasks",
        ),
      );
      if (board.canSelect) {
        const button = node(
          "button",
          "btn task-agent-link",
          `View ${board.label}`,
        );
        button.type = "button";
        button.dataset.taskSession = board.session;
        button.dataset.taskRuntime = board.runtime;
        button.onclick = () => view.onSelect?.(board.session, board.runtime);
        heading.append(button);
      }
      section.append(heading);
      section.append(
        node(
          "p",
          "task-board-owner",
          `${runtimeNames[board.runtime] || board.runtime || "Unknown runtime"} · ${board.label}`,
        ),
      );
      const sourceTime =
        board.source_updated_at === null
          ? "Source update time unavailable."
          : `Source updated ${dateLabel(board.source_updated_at)}`;
      section.append(
        node(
          "p",
          "task-board-meta",
          `${board.source} · Session ${board.session}\nReceived ${dateLabel(board.observed_at)}\n${sourceTime}`,
        ),
      );
      if (board.tasks === null) {
        section.append(
          node("p", "task-empty", "This source's task list is unavailable."),
        );
      } else if (!board.tasks.length) {
        section.append(
          node("p", "task-empty", "The source reported an empty task list."),
        );
      } else {
        const counts = Object.keys(statusNames).map((status) => ({
          status,
          count: board.tasks.filter((task) => task.status === status).length,
        }));
        section.append(
          node(
            "p",
            "task-board-summary",
            counts
              .filter((item) => item.count)
              .map(
                (item) =>
                  `${item.count} ${statusNames[item.status].toLowerCase()}`,
              )
              .join(" · "),
          ),
        );
        const list = node("ol", "task-list");
        for (const task of board.tasks) {
          const row = node("li", "task-row");
          row.dataset.status = task.status;
          row.append(node("span", "task-state", statusNames[task.status]));
          const copy = node("div", "task-copy");
          copy.append(node("p", "task-content", task.content));
          if (["high", "medium", "low"].includes(task.priority))
            copy.append(
              node(
                "small",
                "task-priority",
                `${task.priority[0].toUpperCase()}${task.priority.slice(1)} priority`,
              ),
            );
          row.append(copy);
          list.append(row);
        }
        section.append(list);
      }
      fragment.append(section);
    }
    container.replaceChildren(fragment);
    if (focused) {
      const replacement = [
        ...container.querySelectorAll(".task-agent-link"),
      ].find(
        (button) =>
          button.dataset.taskSession === focused.session &&
          button.dataset.taskRuntime === focused.runtime,
      );
      if (replacement) replacement.focus({ preventScroll: true });
      else {
        container.tabIndex = -1;
        container.focus({ preventScroll: true });
      }
    }
  };
})();
