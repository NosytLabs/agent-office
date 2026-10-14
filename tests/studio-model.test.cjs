const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const file = path.join(__dirname, "../web/js/studio.js");
const studio = fs.existsSync(file) ? require(file) : {};

test("studio has an independent, testable pose selector", () => {
  assert.equal(typeof studio.pose, "function");
});
test("attention wins over a stale command; errors are not guessed", () => {
  assert.equal(studio.pose?.({ status: "waiting", tool: "Bash" }), "attention");
  assert.equal(studio.pose?.({ status: "idle", detail: "⚠ failed" }), "error");
  assert.equal(studio.pose?.({ status: "idle", detail: "error-handling.py" }), "idle");
});
test("observed commands differ from human input requests", () => {
  assert.equal(studio.pose?.({ status: "working", tool: "Bash" }), "wait");
  assert.equal(studio.pose?.({ status: "working", tool: "Read" }), "read");
  assert.equal(studio.pose?.({ status: "working", tool: "Edit" }), "type");
});
test("walking follows distance and paused poses are deterministic", () => {
  const walk = { moving: true, distance: 3 };
  assert.equal(studio.pose?.({}, walk, 0), "walk-a");
  assert.equal(studio.pose?.({}, walk, 900), "walk-a");
  assert.equal(studio.pose?.({}, { ...walk, distance: 6 }, 900), "walk-b");
  assert.equal(studio.pose?.({}, walk, 900, true), "idle");
});
test("quiet work is not converted to completion or sleep", () => {
  const agent = { status: "idle", quiet: true, recorded_status: "working" };
  const copy = structuredClone(agent);
  assert.equal(studio.pose?.(agent), "wait");
  assert.deepEqual(agent, copy);
});
test("companion poses use real walk, sleep and affection frames", () => {
  assert.equal(studio.petPose?.({ moving: true, distance: 3 }), "walk-a");
  assert.equal(studio.petPose?.({ mode: "sleep" }), "sleep");
  assert.equal(studio.petPose?.({ mode: "sit" }, true), "pet");
  assert.equal(studio.petPose?.({ moving: true }, false, true), "idle");
});
test("preferences reject unexpected values and omit telemetry", () => {
  assert.deepEqual(studio.preferences?.({ art: "x", pets: [99, -1], season: "auto", tokens: 100 }), { art: "studio", pets: [0, 1], season: "none" });
  assert.deepEqual(studio.preferences?.({ art: "classic", pets: [4, 7], season: "winter" }), { art: "classic", pets: [4, 7], season: "winter" });
});
test("manifest rejects missing poses, out-of-bounds frames and bad anchors", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../web/assets/sprites/studio/studio.json"), "utf8"));
  assert.equal(studio.validManifest?.(manifest), true);
  const missing = structuredClone(manifest);
  delete missing.entries["person-0-idle"];
  assert.equal(studio.validManifest?.(missing), false);
  const bounds = structuredClone(manifest);
  bounds.entries["person-0-idle"].rect[0] = 511;
  assert.equal(studio.validManifest?.(bounds), false);
  const anchor = structuredClone(manifest);
  anchor.entries["pet-0-idle"].anchor[0] = 99;
  assert.equal(studio.validManifest?.(anchor), false);
});
