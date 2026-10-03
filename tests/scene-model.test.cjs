const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const model = {};
vm.createContext(model);
vm.runInContext(fs.readFileSync("web/js/data.js", "utf8"), model);
test("walking never samples the typing or reading columns", () => {
  for (let distance = 0; distance < 60; distance++)
    assert.ok(
      [0, 1, 2].includes(
        model.characterFrame(
          { status: "working" },
          { moving: true, distance },
          0,
        ),
      ),
    );
});
test("working tool activity selects the actual sheet animation", () => {
  assert.equal(
    model.characterFrame(
      { status: "working", activity: "typing" },
      { moving: false },
      0,
    ),
    3,
  );
  assert.equal(
    model.characterFrame(
      { status: "working", tool: "read_file" },
      { moving: false },
      0,
    ),
    5,
  );
  assert.equal(
    model.characterFrame({ status: "idle" }, { moving: false }, 10),
    0,
  );
});
test("imported edge furniture stays inside the floor after viewport changes", () => {
  for (const grid of [
    { w: 344, h: 234 },
    { w: 208, h: 294 },
  ])
    for (const kind of ["sofa", "server", "shelf", "monstera"])
      for (const position of [0, 1]) {
        const b = model.propBounds({ kind, x: position, y: position }, grid);
        assert.ok(b.x >= 7 && b.y >= 28);
        assert.ok(b.x + b.w <= grid.w - 7);
        assert.ok(b.y + b.h <= grid.h - 10);
      }
});
test("furniture placement rejects overlap and walls while allowing open floor", () => {
  const grid = { w: 344, h: 262 },
    occupied = [{ x: 80, y: 80, w: 40, h: 40 }];
  assert.equal(
    model.placementAt("sofa", { x: 100, y: 120 }, grid, occupied, []).valid,
    false,
  );
  assert.equal(
    model.placementAt("sofa", { x: 5, y: 100 }, grid, [], []).valid,
    false,
  );
  const existing = [{ kind: "sofa", x: 0.5, y: 0.8 }];
  assert.equal(
    model.placementAt("server", { x: 195, y: 205 }, grid, [], existing).valid,
    false,
  );
  assert.equal(
    model.placementAt("server", { x: 270, y: 230 }, grid, occupied, existing)
      .valid,
    true,
  );
});
