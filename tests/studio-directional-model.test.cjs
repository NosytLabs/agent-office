const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const studio = require("../web/js/studio.js");

test("directional walking follows travel direction and freezes its cycle", () => {
  assert.equal(
    studio.directionalKey?.(0, { moving: true, dir: "up", distance: 3 }),
    "person-0-up-walk-a",
  );
  assert.equal(
    studio.directionalKey?.(4, { moving: true, dir: "left", distance: 6 }),
    "person-4-left-walk-b",
  );
  assert.equal(
    studio.directionalKey?.(
      5,
      { moving: true, dir: "right", distance: 6 },
      true,
    ),
    "person-5-right-idle",
  );
  assert.equal(studio.directionalKey?.(2, { moving: false, dir: "up" }), null);
  assert.equal(
    studio.directionalKey?.(2, { moving: true, dir: "unexpected" }),
    null,
  );
});

test("directional manifest requires every direction and three grounded poses", () => {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../web/assets/sprites/studio/directional.json"),
      "utf8",
    ),
  );
  assert.equal(studio.validDirectionalManifest?.(manifest), true);
  assert.equal(Object.keys(manifest.entries).length, 72);
  const missing = structuredClone(manifest);
  delete missing.entries["person-0-up-idle"];
  assert.equal(studio.validDirectionalManifest?.(missing), false);
  const outside = structuredClone(manifest);
  outside.entries["person-5-left-walk-b"].rect[0] = 384;
  assert.equal(studio.validDirectionalManifest?.(outside), false);
  const floating = structuredClone(manifest);
  floating.entries["person-0-down-idle"].anchor[1] = 32;
  assert.equal(studio.validDirectionalManifest?.(floating), false);
});
