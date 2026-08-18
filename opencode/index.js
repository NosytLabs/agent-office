/**
 * Observer-only: map OpenCode session/tool events onto Hermes Pixel Office
 * (~/.hermes/pixel-office/events.jsonl). Same format the office folds.
 * Never throws into the OpenCode loop.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const EVENTS = join(homedir(), ".hermes", "pixel-office", "events.jsonl");
const ACTIVITY = {
  bash: "running",
  terminal: "running",
  read: "reading",
  glob: "reading",
  grep: "reading",
  list: "reading",
  edit: "typing",
  write: "typing",
  patch: "typing",
  apply_patch: "typing",
  webfetch: "browsing",
  websearch: "browsing",
  web_search: "browsing",
  task: "delegating",
};

function publish(event) {
  try {
    mkdirSync(join(homedir(), ".hermes", "pixel-office"), { recursive: true });
    const line = JSON.stringify({
      ts: Date.now() / 1000,
      pid: process.pid,
      platform: "opencode",
      ...event,
    });
    appendFileSync(EVENTS, line + "\n", "utf8");
  } catch {
    /* never break opencode */
  }
}

function preview(args) {
  if (!args || typeof args !== "object") return "";
  for (const k of ["command", "path", "filePath", "query", "url", "pattern", "content"]) {
    if (args[k]) return String(args[k]).replace(/\n/g, " ").slice(0, 60);
  }
  return "";
}

export const PixelOfficeBridge = async () => ({
  event: async ({ event }) => {
    try {
      const type = event?.type || "";
      const data = event?.data || event || {};
      const sid = data.sessionID || data.sessionId || data.id || "";
      if (type === "session.created" || type === "session.updated") {
        if (sid) publish({ event: "session_start", session_id: sid, platform: "opencode" });
      } else if (type === "session.deleted" || type === "session.idle") {
        // idle is a heartbeat-end, not a walk-out — skip end on idle
        if (type === "session.deleted" && sid) publish({ event: "session_end", session_id: sid });
      } else if (type === "session.error") {
        if (sid) publish({ event: "tool_end", session_id: sid, status: "error", error_message: "session error" });
      } else if (type === "permission.asked" || type === "permission.requested") {
        publish({
          event: "approval_request",
          session_id: sid,
          command: data.permission || data.pattern || data.title || "needs approval",
        });
      } else if (type === "permission.replied") {
        publish({
          event: "approval_response",
          session_id: sid,
          choice: data.reply || data.decision || data.choice || "",
        });
      }
    } catch {
      /* ignore */
    }
  },

  "tool.execute.before": async (input, output) => {
    try {
      const tool = input?.tool || "";
      const args = output?.args || input?.args || {};
      const sid = input?.sessionID || "";
      if (tool === "task") {
        publish({
          event: "subagent_start",
          parent_session_id: sid,
          child_session_id: sid + ":task:" + (input?.callID || Date.now()),
          child_goal: preview(args) || "task",
        });
      }
      publish({
        event: "tool_start",
        session_id: input?.sessionID || "",
        tool_name: tool,
        activity: ACTIVITY[tool] || "working",
        preview: preview(args),
      });
    } catch {
      /* ignore */
    }
  },

  "tool.execute.after": async (input, output) => {
    try {
      const err = output?.error || output?.metadata?.error;
      const tool = input?.tool || "";
      const sid = input?.sessionID || "";
      if (tool === "task") {
        publish({
          event: "subagent_stop",
          child_session_id: sid + ":task:" + (input?.callID || "x"),
        });
      }
      publish({
        event: "tool_end",
        session_id: input?.sessionID || "",
        tool_name: input?.tool || "",
        status: err ? "error" : "ok",
        error_message: err ? String(err).slice(0, 80) : "",
      });
    } catch {
      /* ignore */
    }
  },
});

export default PixelOfficeBridge;
