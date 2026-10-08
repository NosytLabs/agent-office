import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  existsSync,
  rmSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const bridgeUrl = new URL("../opencode/index.js", import.meta.url).href;

function recordEvents(events, customHome = false, options = {}) {
  const home = mkdtempSync(join(tmpdir(), "agent-office-bridge-"));
  const hermesHome = customHome
    ? join(home, "custom-hermes")
    : join(home, ".hermes");
  const script = `
    import bridgeFactory from ${JSON.stringify(bridgeUrl)};
    import { readFileSync } from 'node:fs';
    if (${Boolean(options.freezeClock)}) Date.now = () => 1000;
    if (${Boolean(options.failRename)}) {
      const fs = await import('node:fs');
      fs.default.renameSync = () => { throw new Error('simulated rename failure'); };
      (await import('node:module')).syncBuiltinESMExports();
    }
    const bridge = await bridgeFactory();
    for (const item of JSON.parse(readFileSync(0, 'utf8'))) {
      if (item.hook) await bridge[item.hook](item.input, Object.hasOwn(item, "output") ? item.output : {});
      else await bridge.event({event: item});
    }
  `;
  try {
    if (options.epoch) {
      mkdirSync(join(hermesHome, "pixel-office"), { recursive: true });
      writeFileSync(
        join(hermesHome, "pixel-office", "event-epoch"),
        options.epoch + "\n",
      );
    }
    const env = { ...process.env, HOME: home };
    delete env.HERMES_HOME;
    if (customHome) env.HERMES_HOME = hermesHome;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      { env, encoding: "utf8", input: JSON.stringify(events) },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    const path = join(hermesHome, "pixel-office", "inbox");
    assert.equal(
      existsSync(join(hermesHome, "pixel-office", "events.jsonl")),
      false,
    );
    const names = existsSync(path) ? readdirSync(path).sort() : [];
    assert.ok(
      names.every((name) => name.endsWith(".json")),
      "no partial temporary files remain",
    );
    const records = names.map((name) => ({
      filename: name,
      ...JSON.parse(readFileSync(join(path, name), "utf8")),
    }));
    return options.raw ? records : records.map((record) => record.event);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("OpenCode identical equal-clock events get distinct ordered receipts in the current epoch", () => {
  const event = { type: "session.created", data: { id: "same-session" } };
  const records = recordEvents([event, event, event], true, {
    raw: true,
    freezeClock: true,
    epoch: "reset-two",
  });
  assert.equal(records.length, 3);
  assert.equal(new Set(records.map((record) => record.filename)).size, 3);
  assert.deepEqual(
    records.map((record) => record.event),
    [records[0].event, records[0].event, records[0].event],
  );
  assert.deepEqual(
    records.map((record) => record.created_ns),
    ["1000000000", "1000000001", "1000000002"],
  );
  assert.deepEqual(
    records.map((record) => record.sequence),
    [1, 2, 3],
  );
  assert.ok(
    records.every(
      (record) => record.version === 1 && record.epoch === "reset-two",
    ),
  );
});

test("OpenCode reads the published JSON reset intent before the observer recovers", () => {
  const records = recordEvents(
    [{ type: "session.created", data: { id: "new-epoch" } }],
    true,
    {
      raw: true,
      epoch: JSON.stringify({
        version: 1,
        reset: true,
        epoch: "after-reset",
        legacy: { signature: null, count: 0, digest: "" },
      }),
    },
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].epoch, "after-reset");
});

test("OpenCode failed atomic publication stays silent and exposes no ready event", () => {
  assert.deepEqual(
    recordEvents([{ type: "session.created", data: { id: "s" } }], true, {
      failRename: true,
    }),
    [],
  );
});

test("OpenCode publishes complete source TODO snapshots with explicit unknown source time", () => {
  const events = recordEvents(
    [
      {
        id: "evt-plan",
        type: "todo.updated",
        properties: {
          sessionID: "session",
          todos: [
            {
              content: "Inspect the bug",
              status: "completed",
              priority: "high",
            },
            {
              content: "Run the regression",
              status: "in_progress",
              priority: "medium",
            },
            {
              content: "Retired approach",
              status: "cancelled",
              priority: "low",
            },
          ],
        },
      },
      { type: "todo.updated", properties: { sessionID: "session", todos: [] } },
    ],
    true,
    { freezeClock: true },
  );
  assert.equal(events.length, 2);
  assert.deepEqual(events[0].tasks, [
    {
      id: "row-0",
      content: "Inspect the bug",
      status: "completed",
      priority: "high",
    },
    {
      id: "row-1",
      content: "Run the regression",
      status: "in_progress",
      priority: "medium",
    },
    {
      id: "row-2",
      content: "Retired approach",
      status: "cancelled",
      priority: "low",
    },
  ]);
  assert.equal(events[0].event, "tasks_update");
  assert.equal(events[0].session_id, "session");
  assert.equal(events[0].platform, "opencode");
  assert.equal(events[0].task_source, "opencode.todo.updated");
  assert.equal(events[0].source_updated_at, null);
  assert.equal(events[0].ts, 1);
  assert.deepEqual(events[1].tasks, []);
});

test("OpenCode rejects malformed or oversized TODO snapshots instead of partial lists", () => {
  const row = {
    content: "Keep the full plan",
    status: "pending",
    priority: "high",
  };
  const invalid = [
    undefined,
    null,
    {},
    [null],
    [row, { content: "Broken", status: "done" }],
    [{ ...row, content: "x".repeat(513) }],
    [{ ...row, priority: "urgent" }],
    [{ ...row, content: "\u0000" }],
    Array.from({ length: 101 }, () => row),
  ];
  const events = recordEvents(
    invalid.map((todos) => ({
      type: "todo.updated",
      properties: { sessionID: "session", todos },
    })),
  );
  assert.deepEqual(events, []);
});

test("OpenCode preserves 100 TODOs, repeated descriptions, and 512 Unicode characters", () => {
  const todos = Array.from({ length: 100 }, () => ({
    content: "🐟".repeat(512),
    status: "pending",
    priority: "low",
  }));
  const events = recordEvents([
    { type: "todo.updated", properties: { sessionID: "session", todos } },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].tasks.length, 100);
  assert.equal(new Set(events[0].tasks.map((row) => row.id)).size, 100);
  assert.equal(events[0].tasks[0].content, "🐟".repeat(512));
});

test("OpenCode completed assistant usage is normalized by message identity without double-counted subsets", () => {
  const info = {
    id: "message",
    sessionID: "session",
    role: "assistant",
    modelID: "model",
    providerID: "provider",
    time: { created: 1, completed: 2 },
    cost: 0.02,
    tokens: {
      input: 10,
      output: 7,
      reasoning: 3,
      cache: { read: 20, write: 5 },
      total: 47,
    },
  };
  const events = recordEvents([
    {
      type: "message.updated",
      properties: { info: { ...info, time: { created: 1 } } },
    },
    {
      type: "message.updated",
      properties: { info: { ...info, role: "user" } },
    },
    { type: "message.updated", properties: { info } },
    { type: "message.updated", properties: { info } },
    {
      type: "message.part.updated",
      properties: {
        part: {
          type: "step-finish",
          sessionID: "session",
          tokens: info.tokens,
          cost: info.cost,
        },
      },
    },
  ]);
  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map(({ ts, ...event }) => event),
    [events[0], events[0]].map(({ ts, ...event }) => event),
  );
  assert.equal(events[0].session_id, "session");
  assert.equal(events[0].usage_id, "message");
  assert.equal(events[0].input_tokens, 35);
  assert.equal(events[0].output_tokens, 10);
  assert.equal(events[0].cached_input_tokens, 20);
  assert.equal(events[0].cache_write_tokens, 5);
  assert.equal(events[0].reasoning_output_tokens, 3);
  assert.equal(events[0].total_tokens, 47);
  assert.equal(events[0].model, "model");
  assert.equal(events[0].provider, "provider");
  assert.equal(events[0].cost_source, "opencode_runtime_estimate");
});

test("OpenCode usage preserves reported zero and unknown invalid counters", () => {
  const base = {
    id: "message",
    sessionID: "session",
    role: "assistant",
    time: { completed: 2 },
  };
  const events = recordEvents([
    {
      type: "message.updated",
      properties: {
        info: {
          ...base,
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        },
      },
    },
    {
      type: "message.updated",
      properties: {
        info: {
          ...base,
          cost: -1,
          tokens: {
            input: -1,
            output: "3",
            reasoning: null,
            cache: { read: 0 },
          },
        },
      },
    },
  ]);
  assert.equal(events[0].input_tokens, 0);
  assert.equal(events[0].output_tokens, 0);
  assert.equal(events[0].total_tokens, 0);
  assert.equal(events[0].cost_usd, 0);
  assert.equal(events[1].input_tokens, undefined);
  assert.equal(events[1].output_tokens, undefined);
  assert.equal(events[1].total_tokens, undefined);
  assert.equal(events[1].cost_usd, undefined);
});

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

test("OpenCode throwing tools finish through the authoritative error part", () => {
  const events = recordEvents([
    {
      hook: "tool.execute.before",
      input: { sessionID: "s", callID: "read-1", tool: "read" },
      output: { args: { filePath: "missing.ts" } },
    },
    {
      type: "message.part.updated",
      properties: {
        part: {
          sessionID: "s",
          callID: "read-1",
          type: "tool",
          tool: "read",
          state: {
            status: "error",
            error: "File not found",
            time: { start: 100, end: 240 },
          },
        },
      },
    },
  ]);
  assert.deepEqual(
    events.map(({ event }) => event),
    ["tool_start", "tool_end"],
  );
  assert.equal(events[1].status, "error");
  assert.equal(events[1].error_message, "File not found");
  assert.equal(events[1].call_id, "read-1");
  assert.equal(events[1].duration_ms, 140);
});

test("OpenCode terminal snapshots do not duplicate hook completions", () => {
  const completed = {
    type: "message.part.updated",
    properties: {
      sessionID: "s",
      part: {
        sessionID: "s",
        callID: "read-1",
        type: "tool",
        tool: "read",
        state: { status: "completed" },
      },
    },
  };
  const events = recordEvents([
    {
      hook: "tool.execute.before",
      input: { sessionID: "s", callID: "read-1", tool: "read" },
    },
    {
      hook: "tool.execute.after",
      input: { sessionID: "s", callID: "read-1", tool: "read" },
      output: { output: "contents" },
    },
    completed,
    completed,
  ]);
  assert.deepEqual(
    events.map(({ event }) => event),
    ["tool_start", "tool_end"],
  );
});

test("OpenCode repeated error snapshots count one failure and cannot become success", () => {
  const failed = {
    type: "message.part.updated",
    properties: {
      sessionID: "s",
      part: {
        sessionID: "s",
        callID: "read-1",
        type: "tool",
        tool: "read",
        state: { status: "error", error: "File not found" },
      },
    },
  };
  const events = recordEvents([
    {
      hook: "tool.execute.before",
      input: { sessionID: "s", callID: "read-1", tool: "read" },
    },
    failed,
    failed,
    {
      hook: "tool.execute.after",
      input: { sessionID: "s", callID: "read-1", tool: "read" },
      output: { output: "late hook" },
    },
  ]);
  assert.deepEqual(
    events.map(({ event }) => event),
    ["tool_start", "tool_end"],
  );
  assert.equal(events[1].status, "error");
});

test("OpenCode MCP error results retain their actual failure text", () => {
  const events = recordEvents([
    {
      hook: "tool.execute.before",
      input: { sessionID: "s", callID: "mcp-1", tool: "custom_mcp" },
    },
    {
      hook: "tool.execute.after",
      input: { sessionID: "s", callID: "mcp-1", tool: "custom_mcp" },
      output: {
        isError: true,
        content: [{ type: "text", text: "MCP server unavailable" }],
      },
    },
  ]);
  assert.equal(events[1].status, "error");
  assert.equal(events[1].error_message, "MCP server unavailable");
});

test("OpenCode null task results wait for the real terminal failure", () => {
  const events = recordEvents([
    {
      hook: "tool.execute.before",
      input: { sessionID: "s", callID: "task-1", tool: "task" },
    },
    {
      hook: "tool.execute.after",
      input: { sessionID: "s", callID: "task-1", tool: "task" },
      output: null,
    },
    {
      type: "message.part.updated",
      properties: {
        sessionID: "s",
        part: {
          sessionID: "s",
          callID: "task-1",
          type: "tool",
          tool: "task",
          state: { status: "error", error: "Task execution failed" },
        },
      },
    },
  ]);
  assert.deepEqual(
    events.map(({ event }) => event),
    ["tool_start", "tool_end"],
  );
  assert.equal(events[1].status, "error");
  assert.equal(events[1].error_message, "Task execution failed");
});
