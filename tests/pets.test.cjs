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

function until(pets, world, predicate, options = {}, limit = 2400) {
  let previous = pets.step(0, world, options);
  for (let frame = 0; frame < limit; frame++) {
    const current = pets.step(0.1, world, options);
    for (const pet of current) {
      safe(pet, world);
      const old = previous.find((p) => p.key === pet.key);
      if (old)
        assert.ok(
          Math.hypot(pet.x - old.x, pet.y - old.y) <= 1.801,
          "a bed journey uses bounded movement rather than teleportation",
        );
    }
    const reserved = current.map((pet) => pet.bed_id).filter(Boolean);
    assert.equal(
      new Set(reserved).size,
      reserved.length,
      "each bed has at most one reservation",
    );
    if (predicate(current)) return current;
    previous = current;
  }
  assert.fail(
    "the requested pet behavior did not occur within the bounded run",
  );
}

test("cats reserve separate beds and reach their exact foot points before sleeping", () => {
  const pets = controller(),
    world = room({
      w: 420,
      h: 280,
      homes: { cat: { x: 50, y: 240 }, blackcat: { x: 370, y: 240 } },
      beds: [
        { id: "left-bed", x: 80, y: 190 },
        { id: "right-bed", x: 340, y: 190 },
      ],
      progress: { xp: 120 },
      events: [{ event: "observed" }],
      usage: { input_tokens: 150 },
    }),
    original = JSON.stringify(world),
    slept = new Map();
  until(
    pets,
    world,
    (current) => {
      for (const pet of current) {
        if (pet.mode !== "sleep" || pet.moving || !pet.bed_id) continue;
        const bed = world.beds.find((bed) => bed.id === pet.bed_id);
        assert.ok(bed);
        assert.ok(Math.hypot(pet.x - bed.x, pet.y - bed.y) < 0.1);
        slept.set(pet.key, pet.bed_id);
      }
      return slept.size === 2;
    },
    { secondCat: true },
  );
  assert.equal(new Set(slept.values()).size, 2);
  assert.equal(
    JSON.stringify(world),
    original,
    "beds do not mutate XP, observations, or layout data",
  );
});

test("a bed journey routes around furniture and never sleeps at an intermediate waypoint", () => {
  const pets = controller(),
    world = room({
      w: 360,
      h: 280,
      homes: { cat: { x: 50, y: 205 } },
      beds: [{ id: "window-bed", x: 230, y: 170 }],
      blocked: [{ x: 95, y: 155, w: 18, h: 60 }],
    });
  let traveled = false;
  until(pets, world, ([pet]) => {
    traveled ||= pet.mode === "bed" && pet.moving;
    if (pet.bed_id === "window-bed" && pet.mode === "sleep") {
      assert.equal(pet.moving, false);
      assert.ok(Math.hypot(pet.x - 230, pet.y - 170) < 0.1);
      return true;
    }
    return false;
  });
  assert.ok(traveled, "resting in a bed follows a visible journey");
});

test("one bed cannot be reserved by both cats or overlapping duplicate beds", () => {
  const pets = controller(),
    world = room({
      beds: [
        { id: "single", x: 125, y: 165 },
        { id: "overlap", x: 126, y: 166 },
        { id: "single", x: 220, y: 120 },
      ],
    });
  let slept = false;
  until(
    pets,
    world,
    (current) => {
      assert.ok(
        current.filter((pet) => pet.bed_id).length <= 1,
        "overlapping bed targets have a shared physical occupancy limit",
      );
      const [a, b] = current;
      assert.ok(
        Math.abs(a.x - b.x) >= 10 || Math.abs(a.y - b.y) >= 15,
        "bed occupants never overlap",
      );
      slept ||= current.some(
        (pet) => pet.bed_id && pet.mode === "sleep" && !pet.moving,
      );
      return slept;
    },
    { secondCat: true },
  );
});

test("blocked or malformed beds preserve safe fallback resting behavior", () => {
  const pets = controller(),
    world = room({
      w: 300,
      beds: [
        null,
        { id: "bad", x: NaN, y: 150 },
        { id: "edge", x: 0, y: 0 },
        { id: "wall-bed", x: 230, y: 140 },
      ],
      blocked: [{ x: 135, y: 46, w: 20, h: 180 }],
    });
  until(pets, world, ([pet]) => {
    assert.ok(
      pet.x < 135,
      "an inaccessible bed cannot pull a cat through a wall",
    );
    return pet.mode === "sleep" && !pet.moving && !pet.bed_id;
  });
});

test("bed movement freezes while paused or hidden and rest preference does not start a journey", () => {
  const pets = controller(),
    world = room({ beds: [{ id: "rest", x: 200, y: 100 }] });
  until(pets, world, ([pet]) => pet.mode === "bed" && pet.moving);
  const frozen = plain(pets.step(0, world));
  for (const option of [{ paused: true }, { hidden: true }, { roam: false }])
    for (let i = 0; i < 20; i++)
      assert.deepEqual(plain(pets.step(20, world, option)), frozen);
  const settled = controller(),
    initial = plain(settled.step(0, world, { roam: false }));
  for (let i = 0; i < 100; i++)
    assert.deepEqual(plain(settled.step(20, world, { roam: false })), initial);
  assert.equal(initial[0].bed_id, null);
});

test("moving or removing a bed releases its reservation without relocating the cat", () => {
  for (const changed of [[], [{ id: "rest", x: 110, y: 80 }]]) {
    const pets = controller(),
      world = room({ beds: [{ id: "rest", x: 200, y: 100 }] });
    const [before] = until(
      pets,
      world,
      ([pet]) => pet.mode === "bed" && pet.moving,
    );
    world.beds = changed;
    const [after] = pets.step(0.1, world);
    assert.equal(after.bed_id, null);
    assert.equal(after.moving, false);
    assert.equal(after.x, before.x);
    assert.equal(after.y, before.y);
    safe(after, world);
  }
});

test("petting or nearby active work releases a bed for another cat", () => {
  for (const action of ["pet", "work"]) {
    const pets = controller(),
      world = room({ beds: [{ id: "rest", x: 180, y: 100 }] });
    const [before] = until(
      pets,
      world,
      ([pet]) => pet.mode === "sleep" && pet.bed_id,
    );
    if (action === "pet") assert.equal(pets.hold("cat"), true);
    else
      world.agents = [
        { id: "working", x: before.x + 5, y: before.y + 5, status: "working" },
      ];
    const [after] = pets.step(0.1, world);
    assert.equal(after.bed_id, null);
    assert.notEqual(after.mode, "sleep");
    safe(after, world);
  }
});
