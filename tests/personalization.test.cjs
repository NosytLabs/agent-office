const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const model = {};
vm.createContext(model);
vm.runInContext(
  fs.readFileSync("web/js/data.js", "utf8") +
    ";globalThis.defaults=DEFAULT_SETTINGS;",
  model,
);
vm.runInContext(
  fs.readFileSync("web/js/scene.js", "utf8") + ";globalThis.Scene=OfficeScene;",
  model,
);
const plain = (value) => JSON.parse(JSON.stringify(value));
const agent = (id, platform = "claude") => ({
  id,
  label: "Same name",
  platform,
});
function sceneWith(agents, preferences = {}, extra = {}) {
  const scene = Object.create(model.Scene.prototype);
  scene.chars = new Map();
  scene.update(
    agents,
    { ...model.defaults, agent_preferences: preferences, ...extra },
    null,
    null,
    "every",
  );
  return scene;
}
const slots = (room) =>
  Object.fromEntries(room.seats.map((seat) => [seat.a.id, seat.slot]));

test("moving an automatic agent keeps every peer's established desk and reset restores its home", () => {
  const all = ["hermes", "claude", "opencode", "codex", "child"].map((id) =>
    agent(id),
  );
  const scene = sceneWith(all);
  assert.deepEqual(slots(scene.layout(1100)), {
    hermes: 0,
    claude: 1,
    opencode: 2,
    codex: 3,
    child: 4,
  });
  const moved = scene.agentPreferencePatch("hermes", {
    seat: 5,
    appearance: "studio-assistant",
  });
  assert.equal(moved.ok, true);
  Object.assign(scene.settings, moved.patch);
  assert.deepEqual(slots(scene.layout(1100)), {
    claude: 1,
    opencode: 2,
    codex: 3,
    child: 4,
    hermes: 5,
  });
  assert.equal(scene.seatOptions().find((s) => s.slot === 0).agentId, null);
  Object.assign(
    scene.settings,
    scene.agentPreferencePatch("hermes", { seat: null }).patch,
  );
  assert.deepEqual(slots(scene.layout(1100)), {
    hermes: 0,
    claude: 1,
    opencode: 2,
    codex: 3,
    child: 4,
  });
});

test("automatic desks survive snapshot reordering, new arrivals, departures and filtering", () => {
  const [alpha, beta, gamma, newcomer] = ["alpha", "beta", "gamma", "new"].map(
    (id) => agent(id),
  );
  beta.platform = "codex";
  const scene = sceneWith([alpha, beta, gamma]);
  scene.layout(1100);
  scene.update(
    [newcomer, gamma, beta, alpha],
    scene.settings,
    null,
    null,
    "every",
  );
  assert.deepEqual(slots(scene.layout(1100)), {
    alpha: 0,
    beta: 1,
    gamma: 2,
    new: 3,
  });
  scene.update([newcomer, gamma, alpha], scene.settings, null, null, "every");
  assert.deepEqual(slots(scene.layout(1100)), { alpha: 0, gamma: 2, new: 3 });
  assert.equal(scene.seatOptions().find((s) => s.slot === 1).agentId, null);
  scene.update(
    [newcomer, gamma, alpha, beta],
    scene.settings,
    null,
    null,
    "claude",
  );
  assert.deepEqual(slots(scene.layout(390)), { alpha: 0, gamma: 2, new: 3 });
  assert.equal(scene.seatOptions().find((s) => s.slot === 1).agentId, "beta");
  assert.equal(
    scene.agentPreferencePatch("alpha", { seat: 1 }).code,
    "occupied",
  );
  scene.filter = "every";
  assert.deepEqual(slots(scene.layout(1100)), {
    alpha: 0,
    beta: 1,
    gamma: 2,
    new: 3,
  });
});

test("an optimistic explicit move cannot replace the automatic home needed by failed-save rollback", () => {
  const scene = sceneWith([agent("alpha"), agent("beta"), agent("gamma")]);
  const before = slots(scene.layout(1100));
  const confirmed = scene.settings.agent_preferences;
  Object.assign(
    scene.settings,
    scene.agentPreferencePatch("alpha", { seat: 5 }).patch,
  );
  assert.deepEqual(slots(scene.layout(1100)), { beta: 1, gamma: 2, alpha: 5 });
  scene.settings.agent_preferences = confirmed;
  assert.deepEqual(slots(scene.layout(1100)), before);
});

test("returning to automatic never evicts a peer that acquired the vacated home", () => {
  const alpha = agent("alpha"),
    beta = agent("beta"),
    newcomer = agent("new");
  const scene = sceneWith([alpha, beta]);
  scene.layout(1100);
  Object.assign(
    scene.settings,
    scene.agentPreferencePatch("alpha", { seat: 5 }).patch,
  );
  scene.layout(1100);
  scene.update([alpha, beta, newcomer], scene.settings, null, null, "every");
  assert.deepEqual(slots(scene.layout(1100)), { new: 0, beta: 1, alpha: 5 });
  Object.assign(
    scene.settings,
    scene.agentPreferencePatch("alpha", { seat: null }).patch,
  );
  assert.deepEqual(slots(scene.layout(1100)), { new: 0, beta: 1, alpha: 2 });
});

test("departed IDs release their automatic history before a later session return", () => {
  const [alpha, beta, newcomer] = ["alpha", "beta", "new"].map((id) =>
    agent(id),
  );
  const scene = sceneWith([alpha, beta]);
  scene.layout(1100);
  scene.update([beta], scene.settings, null, null, "every");
  assert.deepEqual(slots(scene.layout(1100)), { beta: 1 });
  scene.update([newcomer, beta], scene.settings, null, null, "every");
  assert.deepEqual(slots(scene.layout(1100)), { new: 0, beta: 1 });
  scene.update([alpha, newcomer, beta], scene.settings, null, null, "every");
  assert.deepEqual(slots(scene.layout(1100)), { new: 0, beta: 1, alpha: 2 });
});

test("fresh views restore explicit preferences but bootstrap automatic homes independently", () => {
  const all = [agent("alpha"), agent("beta"), agent("gamma")];
  const current = sceneWith(all);
  current.layout(1100);
  Object.assign(
    current.settings,
    current.agentPreferencePatch("alpha", { seat: 5 }).patch,
  );
  assert.deepEqual(slots(current.layout(1100)), {
    beta: 1,
    gamma: 2,
    alpha: 5,
  });
  const reloaded = sceneWith(all, current.settings.agent_preferences);
  assert.deepEqual(slots(reloaded.layout(1100)), {
    beta: 0,
    gamma: 1,
    alpha: 5,
  });
});

test("live imported conflicts remain deterministic and rejected occupied requests leave homes intact", () => {
  const all = [agent("zeta"), agent("alpha"), agent("other")];
  const scene = sceneWith(all);
  scene.settings.agent_preferences = { zeta: { seat: 4 }, alpha: { seat: 4 } };
  assert.deepEqual(slots(scene.layout(1100)), { zeta: 0, other: 2, alpha: 4 });
  const before = slots(scene.layout(1100));
  assert.equal(
    scene.agentPreferencePatch("zeta", { seat: 2 }).code,
    "occupied",
  );
  assert.deepEqual(slots(scene.layout(1100)), before);
  scene.update([...all].reverse(), scene.settings, null, null, "every");
  assert.deepEqual(slots(scene.layout(1100)), before);
  scene.settings.agent_preferences = {};
  assert.deepEqual(slots(scene.layout(1100)), { zeta: 0, alpha: 1, other: 2 });
});

test("stable slot ownership uses current observed actor data and releases an empty office", () => {
  const scene = sceneWith([agent("alpha"), agent("beta")]);
  scene.update(
    [{ ...agent("beta"), status: "waiting", label: "New question" }],
    scene.settings,
    null,
    null,
    "every",
  );
  const room = scene.layout(1100);
  assert.deepEqual(slots(room), { beta: 1 });
  assert.equal(room.seats[0].a.status, "waiting");
  assert.equal(room.seats[0].a.label, "New question");
  scene.update([], scene.settings, null, null, "every");
  scene.update([agent("new")], scene.settings, null, null, "every");
  assert.deepEqual(slots(scene.layout(1100)), { new: 0 });
});

test("long canonical name keys stay distinct and match individual preferences", () => {
  const first = "a".repeat(200) + "one",
    second = "a".repeat(200) + "two";
  const names = {
    [first]: "First person",
    [second]: "Second person",
    short: "Existing name",
  };
  const preferences = {
    [first]: { appearance: "char1" },
    [second]: { appearance: "char2" },
  };
  assert.deepEqual(
    plain(
      model.normalizeSettings({
        agent_names: names,
        agent_preferences: preferences,
      }),
    ),
    { agent_names: names, agent_preferences: preferences },
  );
  assert.deepEqual(
    plain(
      model.normalizeSettings({
        agent_names: { ["a".repeat(513)]: "Invalid identity" },
      }),
    ),
    {},
  );
});

test("pet visibility and roaming default on and accept only booleans", () => {
  assert.equal(model.defaults.show_pets, true);
  assert.equal(model.defaults.pets_roam, true);
  assert.deepEqual(
    plain(model.normalizeSettings({ show_pets: false, pets_roam: false })),
    { show_pets: false, pets_roam: false },
  );
  assert.deepEqual(
    plain(model.normalizeSettings({ show_pets: "false", pets_roam: 1 })),
    {},
  );
});

test("individual settings round-trip canonical IDs and clear default overrides", () => {
  const preferences = JSON.parse(
    '{"claude/alpha":{"seat":0,"appearance":"char4"},"__proto__":{"appearance":"studio-assistant"},"beta":{"seat":null,"appearance":"default"}}',
  );
  assert.deepEqual(
    plain(model.normalizeSettings({ agent_preferences: preferences })),
    {
      agent_preferences: JSON.parse(
        '{"claude/alpha":{"seat":0,"appearance":"char4"},"__proto__":{"appearance":"studio-assistant"}}',
      ),
    },
  );
  assert.deepEqual(plain(model.defaults.agent_preferences), {});
  assert.equal({}.appearance, undefined);
});

test("malformed or oversized maps are rejected as a whole without partial resets", () => {
  const oversized = Object.fromEntries(
    Array.from({ length: 129 }, (_, i) => ["agent-" + i, { seat: i % 128 }]),
  );
  for (const invalid of [
    null,
    [],
    { a: { seat: -1 } },
    { a: { seat: 128 } },
    { a: { seat: 1.5 } },
    { a: { seat: true } },
    { a: { seat: "2" } },
    { a: { appearance: "https://example.com/character.png" } },
    { a: { appearance: "char6" } },
    { a: { hue: 80 } },
    { a: { seat: 1 }, b: { appearance: [] } },
    { "": { seat: 1 } },
    { "bad\nidentity": { seat: 1 } },
    { ["x".repeat(513)]: { seat: 1 } },
    oversized,
  ]) {
    assert.deepEqual(
      plain(model.normalizeSettings({ agent_preferences: invalid })),
      {},
    );
  }
  const maximum = Object.fromEntries(
    Array.from({ length: 128 }, (_, i) => ["agent-" + i, { seat: i }]),
  );
  assert.deepEqual(
    plain(model.normalizeSettings({ agent_preferences: maximum })),
    { agent_preferences: maximum },
  );
});

test("individual appearance overrides a delegated default and ignores display names", () => {
  const a = { ...agent("alpha"), parent: "parent", kind: "subagent" };
  const settings = {
    subagent_style: "robot",
    agent_preferences: { alpha: { appearance: "char4" } },
  };
  assert.equal(model.characterSpriteKey(a, settings), "char4");
  assert.equal(
    model.characterSpriteKey({ ...a, label: "Renamed" }, settings),
    "char4",
  );
  assert.equal(
    model.characterSpriteKey({ ...a, id: "beta" }, settings),
    "studio-assistant",
  );
  assert.equal(
    model.characterSpriteKey(a, { ...settings, agent_preferences: {} }),
    "studio-assistant",
  );
  assert.equal(
    model.characterSpriteKey(agent("alpha"), {
      agent_preferences: { alpha: { appearance: "studio-assistant" } },
    }),
    "studio-assistant",
  );
  const inherited = Object.create({ alpha: { appearance: "char4" } });
  assert.equal(
    model.characterSpriteKey(a, { agent_preferences: inherited }),
    "studio-assistant",
  );
});

test("the shared appearance resolver and crown use the loaded fallback frame", () => {
  const a = { ...agent("alpha"), status: "idle" };
  const humanKey = model.characterSpriteKey(a, {});
  const human = {},
    robot = {};
  const scene = sceneWith([a], { alpha: { appearance: "studio-assistant" } });
  const images = [],
    rectangles = [];
  Object.assign(scene, {
    sprites: { [humanKey]: human, "studio-assistant": robot },
    spriteFrameTops: { "studio-assistant": Array(21).fill(10) },
    cosmetics: ["crown"],
    time: 0,
    stateAtTime: 0,
    paused: true,
    ctx: {
      save() {},
      restore() {},
      drawImage(image) {
        images.push(image);
      },
    },
    rect: (...args) => rectangles.push(args),
  });
  assert.equal(
    model.characterSpriteKey(a, scene.settings, scene.sprites),
    "studio-assistant",
  );
  scene.character(a, 10, 20, { moving: false });
  assert.equal(images[0], robot);
  assert.equal(rectangles[0][1], 32);
  delete scene.sprites["studio-assistant"];
  images.length = 0;
  rectangles.length = 0;
  assert.equal(
    model.characterSpriteKey(a, scene.settings, scene.sprites),
    humanKey,
  );
  scene.character(a, 10, 20, { moving: false });
  assert.equal(images[0], human);
  assert.equal(rectangles[0][1], 24);
});

test("unset preferences preserve the existing workstation order and geometry", () => {
  const scene = sceneWith([agent("gamma"), agent("alpha"), agent("beta")]);
  const room = scene.layout(1100);
  assert.deepEqual(plain(room.seats.map(({ a, x, y }) => [a.id, x, y])), [
    ["gamma", 72, 60],
    ["alpha", 140, 60],
    ["beta", 208, 60],
  ]);
  assert.deepEqual(slots(room), { gamma: 0, alpha: 1, beta: 2 });
});

test("imported seat conflicts resolve by canonical ID before automatic placements", () => {
  const preferences = {
    zeta: { seat: 1 },
    alpha: { seat: 1 },
    absent: { seat: 0 },
  };
  const one = sceneWith(
    [agent("zeta"), agent("alpha"), agent("other")],
    preferences,
  );
  assert.deepEqual(slots(one.layout(1100)), { zeta: 0, alpha: 1, other: 2 });
  const two = sceneWith(
    [agent("other"), agent("alpha"), agent("zeta")],
    preferences,
  );
  assert.deepEqual(slots(two.layout(1100)), { other: 0, alpha: 1, zeta: 2 });
  assert.deepEqual(preferences, {
    zeta: { seat: 1 },
    alpha: { seat: 1 },
    absent: { seat: 0 },
  });
});

test("occupied or invalid changes preserve the old seat and appearance atomically", () => {
  const scene = sceneWith([agent("alpha"), agent("beta", "codex")], {
    alpha: { seat: 3, appearance: "char2" },
    beta: { seat: 1 },
  });
  scene.filter = "claude";
  const before = JSON.stringify(scene.settings);
  const occupied = scene.agentPreferencePatch("alpha", {
    seat: 1,
    appearance: "char5",
  });
  assert.equal(occupied.ok, false);
  assert.equal(occupied.code, "occupied");
  assert.match(occupied.error, /occupied/i);
  for (const changes of [
    { seat: 128 },
    { seat: -1 },
    { seat: true },
    { appearance: "char8" },
  ]) {
    assert.equal(scene.agentPreferencePatch("alpha", changes).ok, false);
  }
  assert.equal(scene.agentPreferencePatch("departed", { seat: 2 }).ok, false);
  assert.equal(JSON.stringify(scene.settings), before);
  assert.deepEqual(slots(scene.layout(1100)), { alpha: 3 });
});

test("valid patches preserve other agents and clearing one field retains the other", () => {
  const scene = sceneWith([agent("alpha"), agent("beta")], {
    alpha: { seat: 3, appearance: "char2" },
    beta: { seat: 1 },
  });
  const before = JSON.stringify(scene.settings);
  const moved = scene.agentPreferencePatch("alpha", {
    seat: 4,
    appearance: "char5",
  });
  assert.deepEqual(plain(moved), {
    ok: true,
    patch: {
      agent_preferences: {
        alpha: { seat: 4, appearance: "char5" },
        beta: { seat: 1 },
      },
    },
  });
  assert.equal(
    JSON.stringify(scene.settings),
    before,
    "preparing a patch is read-only",
  );
  Object.assign(scene.settings, moved.patch);
  assert.deepEqual(slots(scene.layout(1100)), { beta: 1, alpha: 4 });
  const clearedSeat = scene.agentPreferencePatch("alpha", { seat: null });
  assert.deepEqual(plain(clearedSeat.patch.agent_preferences.alpha), {
    appearance: "char5",
  });
  Object.assign(scene.settings, clearedSeat.patch);
  const clearedAppearance = scene.agentPreferencePatch("alpha", {
    appearance: "default",
  });
  assert.deepEqual(plain(clearedAppearance.patch), {
    agent_preferences: { beta: { seat: 1 } },
  });
});

test("a full preference map permits editing existing IDs but refuses silent eviction", () => {
  const preferences = Object.fromEntries(
    Array.from({ length: 128 }, (_, i) => [
      "agent-" + i,
      { appearance: "char0" },
    ]),
  );
  const scene = sceneWith([agent("new"), agent("agent-3")], preferences);
  assert.equal(
    scene.agentPreferencePatch("new", { appearance: "char1" }).code,
    "limit",
  );
  assert.equal(
    scene.agentPreferencePatch("agent-3", { appearance: "char1" }).ok,
    true,
  );
  assert.equal(Object.keys(scene.settings.agent_preferences).length, 128);
});

test("logical slots survive layouts, filtering, responsive columns and lifecycle changes", () => {
  for (const layout of ["open", "bullpen"]) {
    const all = [agent("alpha"), agent("beta", "codex"), agent("gamma")];
    const scene = sceneWith(
      all,
      { alpha: { seat: 5 }, beta: { seat: 2 } },
      { layout },
    );
    const desktop = scene.layout(1100);
    assert.deepEqual(slots(desktop), { gamma: 0, beta: 2, alpha: 5 });
    const alpha = desktop.seats.find((seat) => seat.a.id === "alpha");
    scene.filter = "claude";
    const filtered = scene.layout(1100);
    assert.deepEqual(slots(filtered), { gamma: 0, alpha: 5 });
    assert.deepEqual(
      plain(filtered.seats.find((seat) => seat.a.id === "alpha")),
      plain(alpha),
    );
    assert.deepEqual(
      [filtered.w, filtered.h, filtered.columns],
      [desktop.w, desktop.h, desktop.columns],
    );
    const mobile = scene.layout(390);
    assert.deepEqual(slots(mobile), { gamma: 0, alpha: 5 });
    assert.equal(mobile.columns, 2);
    assert.equal(mobile.rows, 3);
    scene.update([agent("new"), ...all], scene.settings, null, null, "every");
    assert.equal(slots(scene.layout(1100)).alpha, 5);
    assert.equal(slots(scene.layout(1100)).beta, 2);
    scene.update(
      [agent("new"), agent("beta", "codex")],
      scene.settings,
      null,
      null,
      "every",
    );
    assert.equal(slots(scene.layout(1100)).beta, 2);
    assert.equal(
      scene.seatOptions("beta").find((option) => option.slot === 5).agentId,
      null,
    );
    scene.update(all, scene.settings, null, null, "every");
    assert.equal(slots(scene.layout(1100)).alpha, 5);
    assert.equal(scene.settings.agent_preferences.alpha.seat, 5);
  }
});

test("seat choices include filtered occupants and bounded free workstations", () => {
  const scene = sceneWith([agent("alpha"), agent("beta", "codex")], {
    alpha: { seat: 3 },
  });
  scene.filter = "claude";
  const choices = scene.seatOptions("alpha");
  assert.equal(choices.find((option) => option.slot === 0).agentId, "beta");
  assert.equal(choices.find((option) => option.slot === 3).agentId, "alpha");
  assert.equal(choices.find((option) => option.slot === 4).agentId, null);
  assert.ok(choices.length >= 8 && choices.length <= 128);
  assert.ok(choices.every((option) => option.slot >= 0 && option.slot < 128));
});

test("preference limits never hide actors beyond the assignable workstations", () => {
  const agents = Array.from({ length: 200 }, (_, i) => agent("actor-" + i));
  const scene = sceneWith(agents, { "actor-0": { seat: 127 } });
  const room = scene.layout(390);
  assert.equal(room.seats.length, 200);
  assert.equal(new Set(room.seats.map(({ slot }) => slot)).size, 200);
  assert.equal(slots(room)["actor-0"], 127);
  assert.equal(room.rows, 100);
  assert.equal(scene.seatOptions("actor-0").length, 128);
  assert.ok(
    room.seats.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)),
  );
});

test("prototype-like canonical IDs can be personalized without overwriting other entries", () => {
  const scene = sceneWith([agent("__proto__"), agent("constructor")]);
  const result = scene.agentPreferencePatch("__proto__", {
    seat: 3,
    appearance: "char1",
  });
  assert.equal(result.ok, true);
  Object.assign(scene.settings, result.patch);
  assert.deepEqual(plain(model.agentPreference("__proto__", scene.settings)), {
    seat: 3,
    appearance: "char1",
  });
  assert.deepEqual(
    plain(model.agentPreference("constructor", scene.settings)),
    {},
  );
  assert.deepEqual(slots(scene.layout(1100)), {
    constructor: 1,
    ["__proto__"]: 3,
  });
  assert.equal({}.seat, undefined);
});
