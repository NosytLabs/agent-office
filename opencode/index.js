/**
 * Observer-only: map OpenCode session/tool events onto Hermes Pixel Office
 * (~/.hermes/pixel-office/inbox). Each complete event is published atomically.
 * Never throws into the OpenCode loop.
 */
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const OFFICE_DIR = join(
  process.env.HERMES_HOME || join(homedir(), ".hermes"),
  "pixel-office",
);
const INBOX = join(OFFICE_DIR, "inbox");
const WRITER_ID = randomUUID().replaceAll("-", "");
let sequence = 0;
let lastCreatedNs = 0n;
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
  let descriptor;
  let temporary;
  try {
    mkdirSync(INBOX, { recursive: true });
    let epoch;
    try {
      epoch =
        readFileSync(join(OFFICE_DIR, "event-epoch"), "utf8").trim() ||
        "initial";
      if (epoch.startsWith("{")) {
        const intent = JSON.parse(epoch);
        if (
          intent.version !== 1 ||
          intent.reset !== true ||
          typeof intent.epoch !== "string" ||
          !intent.epoch
        )
          throw new Error("Invalid office reset intent");
        epoch = intent.epoch;
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      epoch = "initial";
    }
    const nowNs = BigInt(Date.now()) * 1000000n;
    const createdNs = nowNs > lastCreatedNs ? nowNs : lastCreatedNs + 1n;
    lastCreatedNs = createdNs;
    sequence += 1;
    const filename = `${createdNs.toString().padStart(20, "0")}-${WRITER_ID}-${String(sequence).padStart(12, "0")}.json`;
    const payload = {
      ts: Date.now() / 1000,
      pid: process.pid,
      platform: "opencode",
      ...event,
    };
    const line =
      JSON.stringify({
        version: 1,
        epoch,
        created_ns: createdNs.toString(),
        writer_id: WRITER_ID,
        sequence,
        event: payload,
      }) + "\n";
    temporary = join(INBOX, "." + filename + ".tmp");
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, line, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, join(INBOX, filename));
    temporary = undefined;
  } catch {
    /* never break opencode */
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        /* best effort */
      }
    }
    if (temporary) {
      try {
        unlinkSync(temporary);
      } catch {
        /* only unpublished temporary data */
      }
    }
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

function usageSnapshot(info) {
  const tokens = info.tokens || {};
  const count = (value) => Number.isSafeInteger(value) && value >= 0;
  const sum = (...values) =>
    values.every(count) && count(values.reduce((a, b) => a + b, 0))
      ? values.reduce((a, b) => a + b, 0)
      : undefined;
  const fields = {
    // OpenCode's buckets are disjoint; the office totals are inclusive.
    input_tokens: sum(tokens.input, tokens.cache?.read, tokens.cache?.write),
    output_tokens: sum(tokens.output, tokens.reasoning),
    cached_input_tokens: tokens.cache?.read,
    cache_write_tokens: tokens.cache?.write,
    reasoning_output_tokens: tokens.reasoning,
  };
  fields.total_tokens = count(tokens.total)
    ? tokens.total
    : sum(fields.input_tokens, fields.output_tokens);
  const event = {
    event: "usage",
    session_id: info.sessionID,
    usage_id: info.id,
    usage_scope: "assistant_message",
    model: info.modelID,
    provider: info.providerID,
  };
  for (const [name, value] of Object.entries(fields))
    if (count(value)) event[name] = value;
  if (Number.isFinite(info.cost) && info.cost >= 0) {
    event.cost_usd = info.cost;
    event.cost_source = "opencode_runtime_estimate";
  }
  return event;
}

function taskText(value, limit, multiline = false) {
  if (typeof value !== "string" || !value.trim() || value.length > limit * 2)
    return false;
  const characters = [...value];
  return (
    characters.length <= limit &&
    characters.every((character) => {
      const code = character.codePointAt(0);
      return (
        !(code < 32 && !(multiline && "\n\r\t".includes(character))) &&
        code !== 127 &&
        !(code >= 0xd800 && code <= 0xdfff)
      );
    })
  );
}

function taskSnapshot(data) {
  // SDK EventTodoUpdated supplies a complete array, not a stream of task
  // changes. Its Todo rows have no stable ID or source update timestamp.
  if (
    !taskText(data.sessionID, 512) ||
    !Array.isArray(data.todos) ||
    data.todos.length > 100
  )
    return null;
  const tasks = [];
  for (const [index, row] of data.todos.entries()) {
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      !taskText(row.content, 512, true) ||
      !["pending", "in_progress", "completed", "cancelled"].includes(row.status)
    )
      return null;
    const task = {
      id: `row-${index}`,
      content: row.content,
      status: row.status,
    };
    if (Object.hasOwn(row, "priority")) {
      if (!["high", "medium", "low"].includes(row.priority)) return null;
      task.priority = row.priority;
    }
    tasks.push(task);
  }
  return {
    event: "tasks_update",
    session_id: data.sessionID,
    task_source: "opencode.todo.updated",
    source_updated_at: null,
    tasks,
  };
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
          data.info?.sessionID ||
          data.info?.id ||
          (type.startsWith("session.") ? data.id : "") ||
          "";
        if (!sid) return;
        if (type === "todo.updated") {
          const snapshot = taskSnapshot(data);
          if (snapshot) publish(snapshot);
        } else if (type === "session.created" || type === "session.updated") {
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
        } else if (type === "message.updated") {
          const info = data.info;
          if (
            info?.role === "assistant" &&
            typeof info.id === "string" &&
            info.id &&
            typeof info.sessionID === "string" &&
            info.sessionID &&
            Number.isFinite(info.time?.completed)
          ) {
            // Each update replaces this message's usage in the durable ledger.
            // Step-finish parts are deliberately not a second accounting source.
            publish(usageSnapshot(info));
          }
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
