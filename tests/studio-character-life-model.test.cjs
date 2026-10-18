const { test } = require("node:test");
const assert = require("node:assert/strict");
const studio = require("../web/js/studio.js");

test("character activity loops follow supported reported poses and freeze with Pause", () => {
  assert.equal(
    studio.characterLifeKey?.(0, "type", 0.5),
    "person-0-type-anim-2",
  );
  assert.equal(studio.characterLifeKey?.(4, "read", 1), "person-4-read-anim-2");
  assert.equal(
    studio.characterLifeKey?.(7, "attention", 1.5),
    "person-7-attention-anim-3",
  );
  assert.equal(
    studio.characterLifeKey?.(1, "type", 3.9, true),
    "person-1-type-anim-0",
  );
  assert.equal(
    studio.characterLifeKey?.(2, "read", Infinity),
    "person-2-read-anim-0",
  );
  assert.equal(
    studio.characterLifeKey?.(3, "attention", -2),
    "person-3-attention-anim-0",
  );
  for (const state of ["wait", "walk-a", "walk-b", "constructor", undefined])
    assert.equal(studio.characterLifeKey?.(0, state), null);
});

test("idle blinks are occasional, completion and error loops freeze with Pause", () => {
  for (const [state, time, expected] of [
    ["idle", 0, 0],
    ["idle", 1, 0],
    ["idle", 2.125, 2],
    ["idle", 2.25, 3],
    ["idle", 2.375, 0],
    ["cheer", 0.75, 2],
    ["error", 1.5, 1],
  ]) {
    assert.equal(
      studio.characterLifeKey(4, state, time),
      `person-4-${state}-anim-${expected}`,
    );
    assert.equal(
      studio.characterLifeKey(4, state, time, true),
      `person-4-${state}-anim-0`,
    );
  }
});

test("reaction manifests require their own complete grounded frame set", () => {
  const manifest = require("../web/assets/sprites/studio/character-reactions.json");
  assert.equal(
    studio.validEnvironmentManifest(manifest, "character-reactions"),
    true,
  );
  assert.equal(
    studio.validEnvironmentManifest(manifest, "character-life"),
    false,
  );
  for (const mutate of [
    (m) => delete m.entries["person-5-error-anim-3"],
    (m) => m.entries["person-0-idle-anim-0"].anchor[1]--,
    (m) => (m.entries["person-4-cheer-anim-2"].rect[0] = 384),
    (m) =>
      (m.entries["person-5-type-anim-0"] = {
        rect: [0, 0, 32, 36],
        anchor: [16, 35],
      }),
  ]) {
    const copy = structuredClone(manifest);
    mutate(copy);
    assert.equal(
      studio.validEnvironmentManifest(copy, "character-reactions"),
      false,
    );
  }
});

test("character activity manifest requires all 72 exact native rectangles and grounded anchors", () => {
  const entries = {};
  for (let actor = 0; actor < 6; actor++)
    for (const [family, name] of ["type", "read", "attention"].entries())
      for (let frame = 0; frame < 4; frame++)
        entries[`person-${actor}-${name}-anim-${frame}`] = {
          rect: [(family * 4 + frame) * 32, actor * 36, 32, 36],
          anchor: [16, 35],
        };
  const manifest = {
    version: 1,
    image: "character-life.png",
    width: 384,
    height: 216,
    rgbaSha256: "0".repeat(64),
    entries,
  };
  assert.equal(
    studio.validEnvironmentManifest(manifest, "character-life"),
    true,
  );
  for (const mutate of [
    (copy) => delete copy.entries["person-0-type-anim-0"],
    (copy) => (copy.entries["person-0-type-anim-0"].anchor = [16, 34]),
    (copy) => (copy.entries["person-1-read-anim-2"].rect = [384, 36, 32, 36]),
    (copy) => (copy.image = "../directional.png"),
    (copy) => (copy.width = 385),
  ]) {
    const copy = structuredClone(manifest);
    mutate(copy);
    assert.equal(
      studio.validEnvironmentManifest(copy, "character-life"),
      false,
    );
  }
});
