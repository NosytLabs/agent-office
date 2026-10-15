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
