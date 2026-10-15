const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const studio = require("../web/js/studio.js");

test("companion life loops choose observed cosmetic state and stop with Pause", () => {
  assert.equal(studio.petLifeKey?.(0, {}, false, 0), "pet-0-idle-anim-0");
  assert.equal(studio.petLifeKey?.(0, {}, false, 2.125), "pet-0-idle-anim-2");
  assert.equal(
    studio.petLifeKey?.(7, { mode: "sleep" }, false, 1.5),
    "pet-7-sleep-anim-1",
  );
  assert.equal(
    studio.petLifeKey?.(4, { moving: true }, true, 0.5),
    "pet-4-happy-anim-3",
  );
  assert.equal(studio.petLifeKey?.(4, { moving: true }, false, 0.5), null);
  assert.equal(
    studio.petLifeKey?.(7, { mode: "sleep" }, false, 1.5, true),
    "pet-7-sleep-anim-0",
  );
  assert.equal(
    studio.petLifeKey?.(3, {}, false, Infinity),
    "pet-3-idle-anim-0",
  );
});

test("the life atlas requires all eight looks, three families and grounded frames", () => {
  const manifest = JSON.parse(
    fs.readFileSync("web/assets/sprites/studio/pet-life.json", "utf8"),
  );
  assert.equal(studio.validEnvironmentManifest(manifest, "pet-life"), true);
  assert.equal(Object.keys(manifest.entries).length, 96);
  const missing = structuredClone(manifest);
  delete missing.entries["pet-7-happy-anim-3"];
  assert.equal(studio.validEnvironmentManifest(missing, "pet-life"), false);
  const shifted = structuredClone(manifest);
  shifted.entries["pet-0-sleep-anim-0"].anchor[1]--;
  assert.equal(studio.validEnvironmentManifest(shifted, "pet-life"), false);
});
