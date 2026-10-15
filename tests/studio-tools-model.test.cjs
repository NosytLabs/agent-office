const { test } = require("node:test");
const assert = require("node:assert/strict");
const { frameKey } = require("../web/js/studio-tools.js");
test("ambient and observed-running frames follow scene time and freeze with Pause", () => {
  assert.equal(frameKey("server", { time: 0.5 }), "server-anim-2");
  assert.equal(
    frameKey("server", { time: 0.5, paused: true }),
    "server-anim-0",
  );
  assert.equal(
    frameKey("taskterminal-running", { time: 0.75 }),
    "taskterminal-running-anim-3",
  );
  assert.equal(
    frameKey("taskterminal-disconnected", { time: 100 }),
    "taskterminal-disconnected",
  );
  assert.equal(frameKey("server", { time: Infinity }), "server-anim-0");
});
test("reaction frames require a reaction and music frames require playback", () => {
  assert.equal(frameKey("coffee", { time: 1 }), "coffee");
  assert.equal(
    frameKey("coffee", { time: 1, reacting: true }),
    "coffee-anim-0",
  );
  assert.equal(
    frameKey("recordplayer", { time: 2, music: false }),
    "recordplayer",
  );
  assert.equal(
    frameKey("recordplayer", { time: 2.25, music: true }),
    "recordplayer-anim-1",
  );
  assert.equal(frameKey("lamp", { lights: false }), "lamp-off");
  assert.equal(frameKey("lamp", { lights: true }), "lamp");
});

test("plant frames only animate cosmetic watering reactions", () => {
  for (const kind of ["succulent", "fern", "planter"]) {
    assert.equal(frameKey(kind, { time: 0.75 }), kind);
    assert.equal(
      frameKey(kind, { time: 0.75, reacting: true }),
      kind + "-anim-3",
    );
    assert.equal(
      frameKey(kind, { time: 0.75, reacting: true, paused: true }),
      kind + "-anim-0",
    );
  }
});
test("sprite filtering and sequences have stable groups and frame order", () => {
  const tools = require("../web/js/studio-tools.js");
  const keys = [
    "fern",
    "fern-anim-0",
    "fern-anim-1",
    "fern-anim-2",
    "fern-anim-3",
    "pet-0-idle",
    "pet-0-walk-a",
    "pet-0-walk-b",
    "person-0-idle",
    "fx-water-drops-0",
    "icon-heart",
  ];
  assert.deepEqual(
    tools.filterKeys(keys, "FERN anim", "furniture"),
    keys.slice(1, 5),
  );
  assert.deepEqual(
    tools.filterKeys(keys, "", "companions"),
    keys.slice(5, 8),
  );
  assert.deepEqual(tools.filterKeys(keys, "not-here", "all"), []);
  assert.deepEqual(tools.animationKeys("fern-anim-2", keys), keys.slice(1, 5));
  assert.deepEqual(tools.animationKeys("pet-0-idle", keys), [
    "pet-0-idle",
    "pet-0-walk-a",
    "pet-0-walk-b",
    "pet-0-walk-a",
  ]);
  assert.deepEqual(tools.animationKeys("icon-heart", keys), ["icon-heart"]);
});
test("animated props fit their bounds without nonuniform stretching", () => {
  const { fitRect } = require("../web/js/studio-tools.js");
  assert.deepEqual(fitRect({ width: 12, height: 16 }, 10, 20, 24, 48), [
    10, 36, 24, 32,
  ]);
  assert.deepEqual(fitRect({ width: 40, height: 20 }, 0, 0, 20, 20), [
    0, 10, 20, 10,
  ]);
});
