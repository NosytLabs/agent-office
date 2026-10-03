/**
 * Observer-only: map OpenCode session/tool events onto Hermes Pixel Office
 * (~/.hermes/pixel-office/events.jsonl). Same format the office folds.
 * Never throws into the OpenCode loop.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const OFFICE_DIR = join(
  process.env.HERMES_HOME || join(homedir(), ".hermes"),
  "pixel-office",
);
const EVENTS = join(OFFICE_DIR, "events.jsonl");
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
    mkdirSync(OFFICE_DIR, { recursive: true });
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
  for (const k of [
    "command",
    "path",
    "filePath",
    "query",
    "url",
    "pattern",
    "description",
    "prompt",
    "content",
  ]) {
    if (args[k]) return String(args[k]).replace(/\n/g, " ").slice(0, 60);
  }
  return "";
}

export const PixelOfficeBridge = async () => {
  const childSessions = new Set();
  const finishedCalls = new Map();
  const callKey = (sid, callID) => JSON.stringify([sid, callID]);
  const finishTool = (sid, callID, tool, status, error = "", duration) => {
    const key = callID ? callKey(sid, callID) : "";
    const previous = key && finishedCalls.get(key);
    if (previous === status || previous === "error") return;
    if (key) {
      finishedCalls.set(key, status);
      // Live terminal snapshots may repeat; keep the observer cache bounded.
      if (finishedCalls.size > 1024)
        finishedCalls.delete(finishedCalls.keys().next().value);
    }
    publish({
      event: "tool_end",
      session_id: sid,
      call_id: callID || "",
      tool_name: tool || "",
      status,
      error_message: String(error || "").slice(0, 80),
      ...(Number.isFinite(duration)
        ? { duration_ms: Math.max(0, duration) }
        : {}),
    });
  };
  const publishIdle = (sid) =>
    publish(
      childSessions.has(sid)
        ? { event: "subagent_stop", child_session_id: sid }
        : { event: "session_idle", session_id: sid },
    );
  return {
    event: async ({ event }) => {
      try {
        const type = event?.type || "";
        const data = event?.properties || event?.data || event || {};
        const sid =
          data.sessionID ||
          data.sessionId ||
          data.part?.sessionID ||
          data.info?.id ||
          (type.startsWith("session.") ? data.id : "") ||
          "";
        if (!sid) return;
        if (type === "session.created" || type === "session.updated") {
          const info = data.info || data;
          if (info.parentID) childSessions.add(sid);
          if (type === "session.created" && info.parentID) {
            publish({
              event: "subagent_start",
              parent_session_id: info.parentID,
              child_session_id: sid,
              child_goal: info.title || "subagent",
            });
          } else {
            publish({
              event:
                type === "session.created" ? "session_start" : "session_update",
              session_id: sid,
              title: info.title || "",
              parent_session_id: info.parentID || "",
            });
          }
        } else if (type === "session.deleted") {
          publish({ event: "session_end", session_id: sid });
          childSessions.delete(sid);
        } else if (type === "session.idle") {
          publishIdle(sid);
        } else if (type === "session.status") {
          if (data.status?.type === "idle") publishIdle(sid);
          else if (
            data.status?.type === "busy" ||
            data.status?.type === "retry"
          ) {
            publish({ event: "session_busy", session_id: sid });
          }
        } else if (type === "session.error") {
          publish({
            event: "session_error",
            session_id: sid,
            status: "error",
            error_message: String(
              data.error?.data?.message ||
                data.error?.message ||
                data.error?.name ||
                "session error",
            ).slice(0, 80),
          });
        } else if (type === "message.part.updated") {
          const part = data.part;
          if (
            part?.type === "tool" &&
            part.callID &&
            (part.state?.status === "error" ||
              part.state?.status === "completed")
          ) {
            // OpenCode skips execute.after when a tool throws. The terminal
            // part records that failure; successful hooks/parts are deduplicated.
            finishTool(
              sid,
              part.callID,
              part.tool,
              part.state.status === "error" ? "error" : "ok",
              part.state.error,
              part.state.time?.end - part.state.time?.start,
            );
          }
        } else if (
          type === "permission.asked" ||
          type === "permission.requested" ||
          type === "permission.updated"
        ) {
          publish({
            event: "approval_request",
            session_id: sid,
            request_id: data.id || data.requestID || data.permissionID || "",
            call_id: data.tool?.callID || data.callID || "",
            command: String(
              data.patterns?.join(", ") ||
                data.pattern ||
                data.title ||
                data.permission ||
                "needs approval",
            ).slice(0, 80),
          });
        } else if (type === "permission.replied") {
          publish({
            event: "approval_response",
            session_id: sid,
            request_id: data.requestID || data.permissionID || "",
            choice:
              data.reply || data.response || data.decision || data.choice || "",
          });
        } else if (type === "question.asked") {
          publish({
            event: "input_request",
            session_id: sid,
            request_id: data.id || "",
            call_id: data.tool?.callID || "",
            question: String(
              data.questions?.[0]?.question ||
                data.questions?.[0]?.header ||
                "needs an answer",
            ).slice(0, 80),
          });
        } else if (
          type === "question.replied" ||
          type === "question.rejected"
        ) {
          publish({
            event: "input_response",
            session_id: sid,
            request_id: data.requestID || "",
            choice: type === "question.rejected" ? "reject" : "answered",
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
        if (!input?.sessionID) return;
        if (input.callID)
          finishedCalls.delete(callKey(input.sessionID, input.callID));
        publish({
          event: "tool_start",
          session_id: input?.sessionID || "",
          call_id: input?.callID || "",
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
        // Failed task execution can invoke this hook with no result; its
        // subsequent terminal part supplies the error rather than a false OK.
        if (!input?.sessionID || output == null) return;
        const err =
          output.error ||
          output.metadata?.error ||
          (output.isError
            ? output.content?.find((c) => c.type === "text")?.text ||
              "MCP tool failed"
            : "");
        finishTool(
          input.sessionID,
          input.callID,
          input.tool,
          err ? "error" : "ok",
          err,
        );
      } catch {
        /* ignore */
      }
    },
  };
};

export default PixelOfficeBridge;
