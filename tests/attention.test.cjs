const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  waitingAgents,
  nextWaitingAgent,
  attentionTitle,
  createController,
  statusCounts,
} = require("../web/js/attention.js");

const agents = () => [
  { id: "working", status: "working" },
  { id: "waiting-a", status: "waiting" },
  { id: "thinking", status: "thinking" },
  { id: "waiting-b", status: "waiting" },
  { id: "quiet", status: "idle", quiet: true, recorded_status: "working" },
  { id: "departed", status: "gone" },
];

test("attention uses explicit waiting observations in source order without changing them", () => {
  const input = agents(),
    before = JSON.stringify(input);
  assert.deepEqual(
    waitingAgents(input).map((a) => a.id),
    ["waiting-a", "waiting-b"],
  );
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(
    waitingAgents([null, {}, { id: "", status: "waiting" }]),
    [],
  );
  assert.deepEqual(waitingAgents(null), []);
});

test("next and previous attention wrap and recover when the selected session leaves", () => {
  const input = agents();
  assert.equal(nextWaitingAgent(input, null).id, "waiting-a");
  assert.equal(nextWaitingAgent(input, "waiting-a").id, "waiting-b");
  assert.equal(nextWaitingAgent(input, "waiting-b").id, "waiting-a");
  assert.equal(nextWaitingAgent(input, null, -1).id, "waiting-b");
  assert.equal(nextWaitingAgent(input, "waiting-a", -1).id, "waiting-b");
  assert.equal(nextWaitingAgent(input, "waiting-b", -1).id, "waiting-a");
  assert.equal(nextWaitingAgent(input, "departed").id, "waiting-a");
  assert.equal(nextWaitingAgent([], "waiting-a"), null);
  assert.equal(
    nextWaitingAgent([{ id: "one", status: "waiting" }], "one", -1).id,
    "one",
  );
});

test("title counts current waiting sessions and removes resolved requests", () => {
  assert.equal(
    attentionTitle({ agents: agents(), status: "connected" }),
    "(2 need input) Agent Office",
  );
  assert.equal(
    attentionTitle({
      agents: [{ id: "one", status: "waiting" }],
      status: "connected",
    }),
    "(1 needs input) Agent Office",
  );
  assert.equal(
    attentionTitle({
      agents: [{ id: "one", status: "working" }],
      status: "connected",
    }),
    "Agent Office",
  );
  assert.equal(
    attentionTitle({ agents: [], status: "connected", baseTitle: "My office" }),
    "My office",
  );
});

test("disconnected, stale, connecting and unknown snapshots never claim a live waiting count", () => {
  for (const [status, expected] of [
    ["disconnected", "Disconnected · Agent Office"],
    ["stale", "Last snapshot · Agent Office"],
    ["connecting", "Connecting · Agent Office"],
    ["unknown", "Last snapshot · Agent Office"],
  ])
    assert.equal(attentionTitle({ agents: agents(), status }), expected);
  assert.equal(attentionTitle(), "Connecting · Agent Office");
});

function event(updates = {}) {
  return {
    key: "p",
    target: { tagName: "BODY" },
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...updates,
  };
}

function fixture() {
  const state = {
      agents: agents(),
      selected: null,
      status: "connected",
      panel: null,
      editing: false,
      title: "",
    },
    inspected = [],
    controller = createController({
      getAgents: () => state.agents,
      getSelectedId: () => state.selected,
      getStatus: () => state.status,
      getPanel: () => state.panel,
      isEditing: () => state.editing,
      inspect: (id) => {
        state.selected = id;
        inspected.push(id);
      },
      setTitle: (title) => {
        state.title = title;
      },
    });
  return { controller, state, inspected };
}

test("P and Shift+P inspect waiting sessions across repeated input while the inspector is open", () => {
  const { controller, state, inspected } = fixture(),
    first = event();
  assert.equal(controller.handleKeydown(first), true);
  assert.equal(first.defaultPrevented, true);
  state.panel = "sheet-inspector";
  assert.equal(controller.handleKeydown(event({ key: "P" })), true);
  assert.equal(
    controller.handleKeydown(event({ key: "P", shiftKey: true })),
    true,
  );
  assert.deepEqual(inspected, ["waiting-a", "waiting-b", "waiting-a"]);
  state.agents = [{ id: "waiting-b", status: "waiting" }];
  controller.handleKeydown(event());
  assert.equal(state.selected, "waiting-b");
});

test("attention keys leave typing, editable descendants and shadow-DOM input untouched", () => {
  for (const target of [
    { tagName: "INPUT" },
    { tagName: "TEXTAREA" },
    { tagName: "SELECT" },
    { tagName: "DIV", isContentEditable: true },
    { tagName: "SPAN", closest: () => ({ isContentEditable: true }) },
  ]) {
    const { controller, inspected } = fixture(),
      press = event({ target });
    assert.equal(controller.handleKeydown(press), false);
    assert.equal(press.defaultPrevented, false);
    assert.deepEqual(inspected, []);
  }
  const { controller, inspected } = fixture();
  assert.equal(
    controller.handleKeydown(
      event({
        composedPath: () => [{ tagName: "INPUT" }, { tagName: "CUSTOM-FIELD" }],
      }),
    ),
    false,
  );
  assert.deepEqual(inspected, []);
});

test("composition, shortcuts with modifiers, repeated keys and already handled input are ignored", () => {
  for (const updates of [
    { isComposing: true },
    { keyCode: 229 },
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { repeat: true },
    { defaultPrevented: true },
    { key: "r" },
  ]) {
    const { controller, inspected } = fixture();
    assert.equal(controller.handleKeydown(event(updates)), false);
    assert.deepEqual(inspected, []);
  }
});

test("unrelated panels, furniture editing and unavailable observations block navigation", () => {
  for (const updates of [
    { panel: "sheet-settings" },
    { panel: "sheet-events" },
    { panel: "sheet-tasks" },
    { editing: true },
    { status: "disconnected" },
    { status: "stale" },
    { status: "connecting" },
  ]) {
    const { controller, state, inspected } = fixture(),
      press = event();
    Object.assign(state, updates);
    assert.equal(controller.handleKeydown(press), false);
    assert.equal(press.defaultPrevented, false);
    assert.deepEqual(inspected, []);
  }
});

test("title refresh follows connection changes without invoking inspection or changing agents", () => {
  const { controller, state, inspected } = fixture(),
    before = JSON.stringify(state.agents);
  assert.equal(controller.refresh(), "(2 need input) Agent Office");
  assert.equal(state.title, "(2 need input) Agent Office");
  state.status = "disconnected";
  controller.refresh();
  assert.equal(state.title, "Disconnected · Agent Office");
  state.status = "connected";
  state.agents[1].status = "working";
  controller.refresh();
  assert.equal(state.title, "(1 needs input) Agent Office");
  assert.deepEqual(inspected, []);
  state.agents[1].status = "waiting";
  assert.equal(JSON.stringify(state.agents), before);
});

test("no waiting observation leaves keyboard input untouched", () => {
  const { controller, state, inspected } = fixture(),
    press = event();
  state.agents = [{ id: "working", status: "working" }];
  assert.equal(controller.handleKeydown(press), false);
  assert.equal(press.defaultPrevented, false);
  assert.deepEqual(inspected, []);
});

test("explicit button navigation shares selection but still refuses disconnected or editing state", () => {
  const { controller, state, inspected } = fixture();
  assert.equal(controller.inspectNext(-1), true);
  assert.equal(state.selected, "waiting-b");
  state.status = "stale";
  assert.equal(controller.inspectNext(1), false);
  state.status = "connected";
  state.editing = true;
  assert.equal(controller.inspectNext(1), false);
  assert.deepEqual(inspected, ["waiting-b"]);
});

test("a controller without a confirmed live status fails closed", () => {
  const inspected = [],
    controller = createController({
      getAgents: agents,
      inspect: (id) => inspected.push(id),
    });
  assert.equal(controller.handleKeydown(event()), false);
  assert.equal(controller.inspectNext(), false);
  assert.equal(controller.refresh(), "Connecting · Agent Office");
  assert.deepEqual(inspected, []);
});

test("compact status counts reflect observed working, thinking and waiting without upgrading quiet sessions", () => {
  assert.deepEqual(statusCounts(agents()), {
    working: 1,
    thinking: 1,
    waiting: 2,
  });
  assert.deepEqual(
    statusCounts([
      { id: "ended", status: "done" },
      { id: "quiet", status: "idle", recorded_status: "working" },
    ]),
    { working: 0, thinking: 0, waiting: 0 },
  );
  assert.deepEqual(statusCounts(null), { working: 0, thinking: 0, waiting: 0 });
});
