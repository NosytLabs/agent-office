const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const studio = require("../web/js/studio.js");

test("room and companion atlases reject missing, off-grid and floating entries", () => {
  for (const name of ["room-surfaces", "pet-walk"]) {
    const manifest = JSON.parse(
      fs.readFileSync(`web/assets/sprites/studio/${name}.json`, "utf8"),
    );
    assert.equal(studio.validEnvironmentManifest?.(manifest, name), true);
    const key = Object.keys(manifest.entries)[0];
    const missing = structuredClone(manifest);
    delete missing.entries[key];
    assert.equal(studio.validEnvironmentManifest?.(missing, name), false);
    const outside = structuredClone(manifest);
    outside.entries[key].rect[0] = manifest.width;
    assert.equal(studio.validEnvironmentManifest?.(outside, name), false);
    const floating = structuredClone(manifest);
    floating.entries[key].anchor[1]++;
    assert.equal(studio.validEnvironmentManifest?.(floating, name), false);
  }
  assert.equal(studio.validEnvironmentManifest?.({}, "other"), false);
});

test("companion heading follows real travel, pauses and resets safely on room changes", () => {
  assert.deepEqual(
    studio.petMotion?.(
      4,
      1,
      { x: 4, y: 4, distance: 3, dir: "left", geometry: "same" },
      "same",
      false,
      1,
    ),
    { x: 4, y: 1, distance: 6, dir: "up", geometry: "same" },
  );
  assert.equal(
    studio.petMotion?.(
      4,
      1,
      { x: 4, y: 4, distance: 3, dir: "left", geometry: "same" },
      "same",
      true,
      1,
    )?.dir,
    "left",
  );
  assert.equal(
    studio.petMotion?.(
      400,
      1,
      { x: 4, y: 4, distance: 3, dir: "left", geometry: "old" },
      "new",
      false,
      1,
    )?.distance,
    0,
  );
  assert.equal(
    studio.petDirectionalKey?.(
      0,
      { moving: true, dir: "up", distance: 6 },
      false,
      false,
    ),
    "pet-0-up-walk-b",
  );
  assert.equal(
    studio.petDirectionalKey?.(
      7,
      { moving: true, dir: "left", distance: 6 },
      false,
      true,
    ),
    "pet-7-left-idle",
  );
  assert.equal(
    studio.petDirectionalKey?.(3, { moving: true, dir: "up" }, true, false),
    null,
  );
  assert.equal(
    studio.petDirectionalKey?.(3, { moving: false, dir: "up" }, false, false),
    null,
  );
});
