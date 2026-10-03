import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const bridgeUrl = new URL("../opencode/index.js", import.meta.url).href;

function recordEvents(events, customHome = false) {
  const home = mkdtempSync(join(tmpdir(), "agent-office-bridge-"));
  const hermesHome = customHome
    ? join(home, "custom-hermes")
    : join(home, ".hermes");
  const script = `
    import bridgeFactory from ${JSON.stringify(bridgeUrl)};
    const bridge = await bridgeFactory();
    for (const item of JSON.parse(process.argv[1])) {
      if (item.hook) await bridge[item.hook](item.input, item.output || {});
      else await bridge.event({event: item});
    }
  `;
  try {
    const env = { ...process.env, HOME: home };
    delete env.HERMES_HOME;
    if (customHome) env.HERMES_HOME = hermesHome;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script, JSON.stringify(events)],
      { env, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const path = join(hermesHome, "pixel-office", "events.jsonl");
    return existsSync(path)
      ? readFileSync(path, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
      : [];
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("OpenCode writes events to the configured HERMES_HOME", () => {
  const events = recordEvents(
    [{ type: "session.created", data: { id: "custom-home-session" } }],
    true,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].session_id, "custom-home-session");
});

test("OpenCode session creation and deletion use properties.info.id", () => {
  const info = {
    id: "sdk-session",
    title: "Review changes",
    version: "1",
    time: { created: 1, updated: 2 },
  };
  const events = recordEvents([
    { type: "session.created", properties: { info } },
    { type: "session.deleted", properties: { info } },
  ]);
  assert.deepEqual(
    events.map(({ event, session_id }) => ({ event, session_id })),
    [
      { event: "session_start", session_id: "sdk-session" },
      { event: "session_end", session_id: "sdk-session" },
    ],
  );
});

test("OpenCode approval events retain the requesting session and response", () => {
  const events = recordEvents([
    {
      type: "permission.asked",
      properties: {
        id: "permission-1",
        sessionID: "approval-session",
        permission: "bash",
        patterns: ["npm test"],
        metadata: {},
      },
    },
    {
      type: "permission.replied",
      properties: {
        sessionID: "approval-session",
        requestID: "permission-1",
        reply: "once",
      },
    },
  ]);
  assert.deepEqual(
    events.map(({ event, session_id, command, choice }) => ({
      event,
      session_id,
      command,
      choice,
    })),
    [
      {
        event: "approval_request",
        session_id: "approval-session",
        command: "npm test",
        choice: undefined,
      },
      {
        event: "approval_response",
        session_id: "approval-session",
        command: undefined,
        choice: "once",
      },
    ],
  );
});

test("OpenCode session errors from properties remain attributed to the session", () => {
  const events = recordEvents([
    {
      type: "session.error",
      properties: {
        sessionID: "failed-session",
        error: { name: "UnknownError", data: { message: "fixture failure" } },
      },
    },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].session_id, "failed-session");
  assert.equal(events[0].status, "error");
});

test("OpenCode retains support for legacy data payloads", () => {
  const events = recordEvents([
    { type: "session.created", data: { sessionID: "legacy-session" } },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].session_id, "legacy-session");
});

test("OpenCode session updates change metadata without restarting the session", () => {
  const events = recordEvents([
    {
      type: "session.created",
      properties: { info: { id: "s", title: "First title" } },
    },
    {
      type: "session.updated",
      properties: { info: { id: "s", title: "Review the code" } },
    },
  ]);
  assert.deepEqual(
    events.map(({ event, title }) => ({ event, title })),
    [
      { event: "session_start", title: "First title" },
      { event: "session_update", title: "Review the code" },
    ],
  );
});

test("OpenCode observes model busy and idle lifecycle events", () => {
  const events = recordEvents([
    {
      type: "session.status",
      properties: { sessionID: "s", status: { type: "busy" } },
    },
    {
      type: "session.status",
      properties: { sessionID: "s", status: { type: "idle" } },
    },
    { type: "session.idle", properties: { sessionID: "s" } },
  ]);
  assert.deepEqual(
    events.map(({ event }) => event),
    ["session_busy", "session_idle", "session_idle"],
  );
});

test("OpenCode tracks real child sessions instead of duplicate synthetic task agents", () => {
  const events = recordEvents([
    {
      hook: "tool.execute.before",
      input: { tool: "task", sessionID: "parent", callID: "task-call" },
      output: { args: { description: "Review code" } },
    },
    {
      type: "session.created",
      properties: {
        info: { id: "real-child", parentID: "parent", title: "Review code" },
      },
    },
    { type: "session.idle", properties: { sessionID: "real-child" } },
    {
      hook: "tool.execute.after",
      input: { tool: "task", sessionID: "parent", callID: "task-call" },
      output: {},
    },
  ]);
  assert.deepEqual(
    events.map(({ event }) => event),
    ["tool_start", "subagent_start", "subagent_stop", "tool_end"],
  );
  assert.equal(events[1].child_session_id, "real-child");
  assert.equal(events[1].parent_session_id, "parent");
  assert.equal(events[1].child_goal, "Review code");
  assert.equal(events[2].child_session_id, "real-child");
});

test("OpenCode tool calls retain ids and useful description previews", () => {
  const events = recordEvents([
    {
      hook: "tool.execute.before",
      input: { tool: "task", sessionID: "s", callID: "call-1" },
      output: { args: { description: "Audit the API" } },
    },
    {
      hook: "tool.execute.after",
      input: { tool: "task", sessionID: "s", callID: "call-1" },
      output: {},
    },
  ]);
  const tools = events.filter(
    ({ event }) => event === "tool_start" || event === "tool_end",
  );
  assert.equal(tools[0].preview, "Audit the API");
  assert.deepEqual(
    tools.map(({ call_id }) => call_id),
    ["call-1", "call-1"],
  );
});

test("OpenCode legacy permission replies preserve response and request ids", () => {
  const events = recordEvents([
    {
      type: "permission.updated",
      properties: {
        id: "p1",
        sessionID: "s",
        title: "Run tests",
        callID: "c1",
      },
    },
    {
      type: "permission.replied",
      properties: { sessionID: "s", permissionID: "p1", response: "reject" },
    },
  ]);
  assert.equal(events[0].event, "approval_request");
  assert.equal(events[0].request_id, "p1");
  assert.equal(events[0].call_id, "c1");
  assert.equal(events[1].choice, "reject");
  assert.equal(events[1].request_id, "p1");
});

test("OpenCode questions are separate needs-input events", () => {
  const events = recordEvents([
    {
      type: "question.asked",
      properties: {
        id: "q1",
        sessionID: "s",
        questions: [{ question: "Which branch?", header: "Branch" }],
        tool: { callID: "question-call" },
      },
    },
    {
      type: "question.replied",
      properties: { sessionID: "s", requestID: "q1", answers: [["main"]] },
    },
    {
      type: "question.rejected",
      properties: { sessionID: "s", requestID: "q2" },
    },
  ]);
  assert.equal(events[0].event, "input_request");
  assert.equal(events[0].question, "Which branch?");
  assert.equal(events[0].request_id, "q1");
  assert.equal(events[0].call_id, "question-call");
  assert.equal(events[1].event, "input_response");
  assert.equal(events[1].request_id, "q1");
  assert.equal(events[2].event, "input_response");
  assert.equal(events[2].choice, "reject");
});

test("OpenCode session failures retain the real error without inventing an anonymous agent", () => {
  const events = recordEvents([
    {
      type: "session.error",
      properties: {
        sessionID: "s",
        error: {
          name: "UnknownError",
          data: { message: "Provider unavailable" },
        },
      },
    },
    {
      type: "permission.asked",
      properties: { id: "not-a-session", permission: "bash" },
    },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "session_error");
  assert.equal(events[0].error_message, "Provider unavailable");
});
