const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const model = {};
vm.createContext(model);
vm.runInContext(fs.readFileSync("web/js/data.js", "utf8"), model);
vm.runInContext(
  fs.readFileSync("web/js/scene.js", "utf8") + ";globalThis.Scene=OfficeScene;",
  model,
);
test("departed sessions release character state instead of leaking NPCs", () => {
  const scene = Object.create(model.Scene.prototype);
  scene.chars = new Map([
    ["old", {}],
    ["active", {}],
  ]);
  scene.update([{ id: "active" }], {}, null, null, "every");
  assert.deepEqual([...scene.chars.keys()], ["active"]);
});
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
    for (const kind of [
      "sofa",
      "server",
      "shelf",
      "monstera",
      "coffee",
      "cooler",
      "lamp",
      "roundtable",
      "stool",
      "succulent",
      "planter",
    ])
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
test("unlocked aquarium participates in the same decoration collision bounds", () => {
  const grid = { w: 344, h: 262 };
  const decor = model.defaultDecor(grid, ["fish_tank"]);
  assert.ok(decor.some((p) => p.kind === "FISH_TANK"));
  assert.equal(
    model.placementAt("cooler", { x: 272, y: 244 }, grid, decor, []).valid,
    false,
  );
  assert.equal(
    model.defaultDecor(grid, []).some((p) => p.kind === "FISH_TANK"),
    false,
  );
});
test("walking routes avoid props instead of cutting through their corners", () => {
  const start = { x: 32, y: 30 },
    target = { x: 148, y: 133 },
    grid = { w: 210, h: 262 };
  const occupied = [
    { x: 80, y: 48, w: 30, h: 65 },
    { x: 130, y: 76, w: 30, h: 30 },
  ];
  const route = model.officePath(start, target, grid, occupied);
  assert.ok(route && route.length);
  let previous = start;
  for (const p of route) {
    for (let i = 0; i <= 10; i++) {
      const x = previous.x + ((p.x - previous.x) * i) / 10,
        y = previous.y + ((p.y - previous.y) * i) / 10;
      for (const b of occupied)
        assert.ok(
          !(
            x > b.x - 4 &&
            x < b.x + b.w + 4 &&
            y > b.y - 4 &&
            y < b.y + b.h + 4
          ),
        );
    }
    previous = p;
  }
  assert.equal(previous.x, target.x);
  assert.equal(previous.y, target.y);
});
test("unreachable desks return no walk through solid furniture", () => {
  assert.equal(
    model.officePath({ x: 32, y: 30 }, { x: 148, y: 133 }, { w: 210, h: 238 }, [
      { x: 6, y: 70, w: 198, h: 16 },
    ]),
    null,
  );
});
test("fractional route origins remain bounded and all default desk rows are reachable", () => {
  for (const columns of [2, 4, 8]) {
    const grid = { w: Math.max(320, columns * 68 + 72), h: 338 };
    const seats = Array.from({ length: columns * 3 }, (_, i) => ({
      x: (grid.w - ((columns - 1) * 68 + 40)) / 2 + (i % columns) * 68,
      y: 60 + Math.floor(i / columns) * 76,
    }));
    for (const s of seats) {
      const obstacles = seats
        .filter((p) => p !== s)
        .map((p) => ({ x: p.x - 3, y: p.y - 6, w: 46, h: 27 }))
        .concat(model.defaultDecor(grid, []));
      const route = model.officePath(
        { x: 32.5, y: 30.5 },
        { x: s.x + 16, y: s.y + 13 },
        grid,
        obstacles,
      );
      assert.ok(route, `reachable desk ${s.x},${s.y}`);
      assert.ok(route.length < (grid.w * grid.h) / 16);
    }
  }
});
