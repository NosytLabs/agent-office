/* Deterministic behavior and collision invariants; no browser or observer mocks. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const model = vm.createContext({});
vm.runInContext(fs.readFileSync("web/js/data.js", "utf8"), model);
if (fs.existsSync("web/js/pets.js"))
  vm.runInContext(
    fs.readFileSync("web/js/pets.js", "utf8") +
      ";globalThis.Pets=OfficePetController;",
    model,
  );
function controller(planner) {
  assert.equal(
    typeof model.Pets,
    "function",
    "the bounded pet behavior controller exists",
  );
  return new model.Pets(planner || model.officePath);
}
function room(extra = {}) {
  return {
    w: 260,
    h: 240,
    key: "room-a",
    blocked: [],
    agents: [],
    homes: { cat: { x: 50, y: 205 }, blackcat: { x: 210, y: 205 } },
    ...extra,
  };
}
const plain = (value) => JSON.parse(JSON.stringify(value));
function safe(pet, world) {
  assert.ok(Number.isFinite(pet.x) && Number.isFinite(pet.y));
  assert.ok(pet.x >= 10 && pet.x <= world.w - 10);
  assert.ok(pet.y >= 44 && pet.y <= world.h - 11);
  for (const b of world.blocked)
    assert.ok(
      !(
        pet.x + 5 > b.x &&
        pet.x - 5 < b.x + b.w &&
        pet.y > b.y &&
        pet.y - 15 < b.y + b.h
      ),
      "visible pet clears furniture: " + JSON.stringify({ pet, b }),
    );
}
test("pets wander deterministically without changing their world inputs", () => {
  const a = controller(),
    b = controller(),
    world = room();
  const before = JSON.stringify(world),
    first = a.step(0, world)[0];
  b.step(0, world);
  let distance = 0;
  for (let i = 0; i < 300; i++) {
    const left = a.step(0.1, world),
      right = b.step(0.1, world);
    assert.deepEqual(plain(left), plain(right));
    distance = Math.max(
      distance,
      Math.hypot(left[0].x - first.x, left[0].y - first.y),
    );
  }
  assert.ok(
    distance > 10,
    "enabled pets actually leave their starting position",
  );
  assert.equal(JSON.stringify(world), before);
});
test("roaming bodies avoid furniture and room edges along every movement segment", () => {
  const pets = controller(),
    world = room({
      blocked: [
        { x: 105, y: 65, w: 25, h: 105 },
        { x: 175, y: 165, w: 40, h: 24 },
      ],
    });
  for (let i = 0; i < 700; i++)
    for (const pet of pets.step(0.1, world, { secondCat: true }))
      safe(pet, world);
});
test("pause, hidden tabs and rest preference freeze movement without catch-up", () => {
  for (const option of [{ paused: true }, { hidden: true }, { roam: false }]) {
    const pets = controller(),
      world = room();
    for (let i = 0; i < 30; i++) pets.step(0.1, world);
    const before = plain(pets.step(0, world));
    for (let i = 0; i < 30; i++)
      assert.deepEqual(plain(pets.step(100, world, option)), before);
    const after = pets.step(0.1, world);
    assert.ok(
      Math.hypot(after[0].x - before[0].x, after[0].y - before[0].y) <= 3,
      "resume uses one bounded frame, not hidden time",
    );
  }
});
test("a cat visits an idle agent and moves away when that work becomes active", () => {
  const pets = controller(),
    world = room({
      homes: { cat: { x: 60, y: 160 } },
      agents: [{ id: "reader", x: 95, y: 150, status: "idle" }],
    });
  let visitor;
  for (let i = 0; i < 1200; i++) {
    const pet = pets.step(0.1, world)[0];
    if (
      pet.mode === "visit" &&
      !pet.moving &&
      Math.hypot(pet.x - 95, pet.y - 150) < 58
    ) {
      visitor = pet;
      break;
    }
  }
  assert.ok(visitor, "reachable idle work has a genuine visit state");
  const oldDistance = Math.hypot(visitor.x - 95, visitor.y - 150);
  world.agents[0].status = "working";
  let distance = oldDistance,
    retreat = false;
  for (let i = 0; i < 160; i++) {
    const pet = pets.step(0.1, world)[0];
    retreat ||= pet.mode === "retreat";
    distance = Math.max(distance, Math.hypot(pet.x - 95, pet.y - 150));
  }
  assert.ok(retreat, "active work triggers a retreat decision");
  assert.ok(
    distance > oldDistance + 10,
    "the cat visibly gives active work space",
  );
});
test("petting stops a moving cat briefly and quiet periods include sleep", () => {
  const pets = controller(),
    world = room();
  let current;
  for (let i = 0; i < 100; i++) {
    current = pets.step(0.1, world)[0];
    if (current.moving) break;
  }
  assert.ok(current.moving);
  assert.equal(pets.hold("cat"), true);
  const resting = pets.step(0, world)[0];
  for (let i = 0; i < 10; i++) {
    const pet = pets.step(0.1, world)[0];
    assert.equal(pet.x, resting.x);
    assert.equal(pet.y, resting.y);
  }
  let asleep = false;
  for (let i = 0; i < 1800; i++)
    asleep ||= pets.step(0.1, world)[0].mode === "sleep";
  assert.ok(asleep, "sleep is reachable after roaming and rest");
});
test("layout changes relocate invalid positions safely even while paused", () => {
  const pets = controller(),
    large = room();
  const old = pets.step(0, large)[0];
  const small = room({
    w: 165,
    h: 185,
    key: "small",
    blocked: [{ x: old.x - 15, y: 140, w: 30, h: 40 }],
  });
  const after = pets.step(0, small, { paused: true })[0];
  assert.ok(after);
  safe(after, small);
  assert.equal(after.moving, false);
  assert.notDeepEqual([after.x, after.y], [old.x, old.y]);
});
test("only earned cats appear and hiding pets never advances their positions", () => {
  const pets = controller(),
    world = room();
  assert.deepEqual(plain(pets.step(0, world).map((p) => p.key)), ["cat"]);
  const both = plain(pets.step(0, world, { secondCat: true }));
  assert.deepEqual(
    both.map((p) => p.key),
    ["cat", "blackcat"],
  );
  for (let i = 0; i < 100; i++)
    assert.deepEqual(
      plain(pets.step(1, world, { enabled: false, secondCat: true })),
      [],
    );
  assert.deepEqual(plain(pets.step(0, world, { secondCat: true })), both);
  assert.deepEqual(plain(pets.step(0, world).map((p) => p.key)), ["cat"]);
  assert.equal(pets.hold("blackcat"), false);
});
test("unreachable rooms and large floors retain finite planning and valid coordinates", () => {
  let calls = 0;
  const pets = controller((start, target, grid, blocked) => {
    calls++;
    assert.ok(
      grid.w <= 200 && grid.h <= 220,
      "navigation is limited to a local window",
    );
    return model.officePath(start, target, grid, blocked);
  });
  const world = room({ w: 5000, h: 5000, homes: { cat: { x: 100, y: 150 } } });
  for (let i = 0; i < 300; i++) {
    const before = calls;
    for (const pet of pets.step(0.1, world)) safe(pet, world);
    assert.ok(
      calls - before <= 3,
      "one cat performs no more than three route attempts per frame",
    );
  }
  assert.ok(calls > 0);
  const covered = room({
    key: "covered",
    blocked: [{ x: 0, y: 0, w: 260, h: 240 }],
  });
  assert.deepEqual(plain(pets.step(0.1, covered)), []);
});
test("invalid frame durations do not move a pet or produce nonfinite positions", () => {
  const pets = controller(),
    world = room(),
    before = plain(pets.step(0, world));
  for (const dt of [NaN, Infinity, -1, undefined])
    assert.deepEqual(plain(pets.step(dt, world)), before);
});
test("cats choose separate free resting spots when mobile furniture covers their homes", () => {
  const pets = controller(),
    world = room({
      w: 210,
      h: 238,
      key: "mobile-lounge",
      homes: { cat: { x: 58, y: 220 }, blackcat: { x: 142, y: 220 } },
      blocked: plain(model.defaultDecor({ w: 210, h: 238 }, ["fish_tank"])),
    });
  const visible = pets.step(0, world, { secondCat: true });
  assert.equal(visible.length, 2);
  for (const pet of visible) safe(pet, world);
  const [a, b] = visible;
  assert.ok(
    Math.abs(a.x - b.x) >= 10 || Math.abs(a.y - b.y) >= 15,
    "initial relocation does not stack both cats in the same small opening",
  );
});
test("a blocked original home still permits sleeping at a safe resting spot", () => {
  const pets = controller(),
    world = room({
      w: 320,
      h: 238,
      key: "furnished-lounge",
      homes: { cat: { x: 58, y: 220 } },
      blocked: plain(model.defaultDecor({ w: 320, h: 238 }, [])),
    });
  let slept = false;
  for (let i = 0; i < 2200; i++) {
    const pet = pets.step(0.1, world)[0];
    safe(pet, world);
    slept ||= pet.mode === "sleep" && !pet.moving;
  }
  assert.ok(slept, "the actual furnished lounge has a reachable sleep state");
});
