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
test("following is explicit, validates the visible actor, and stops without resetting the view", () => {
  const changes = [];
  const scene = Object.create(model.Scene.prototype);
  Object.assign(scene, {
    agents: [{ id: "alpha", platform: "opencode" }],
    filter: "every",
    following: null,
    zoom: 1,
    pan: { x: 12, y: -20 },
    draw() {},
    onFollowChange: (id) => changes.push(id),
  });
  assert.equal(scene.followAgent("missing"), false);
  assert.equal(scene.following, null);
  assert.equal(scene.followAgent("alpha"), true);
  assert.equal(scene.following, "alpha");
  assert.equal(scene.zoom, 1.75);
  assert.equal(scene.followAgent("alpha"), true);
  assert.deepEqual(changes, ["alpha"]);
  assert.equal(scene.followAgent(null), true);
  assert.equal(scene.following, null);
  assert.deepEqual(scene.pan, { x: 12, y: -20 });
  assert.deepEqual(changes, ["alpha", null]);
  scene.filter = "claude";
  assert.equal(scene.followAgent("alpha"), false);
});
test("follow camera tracks the character and keeps floor edges inside bounded pan", () => {
  const scene = Object.create(model.Scene.prototype);
  Object.assign(scene, {
    following: "alpha",
    chars: new Map([["alpha", { x: 192, y: 254 }]]),
    pan: { x: 0, y: 0 },
    relayout: false,
  });
  const room = {
    w: 400,
    h: 600,
    seats: [{ a: { id: "alpha" }, x: 80, y: 100 }],
  };
  scene.followCamera(room, 500, 500, 2);
  assert.equal(
    scene.pan.x,
    0,
    "uses moving character x rather than its distant desk",
  );
  assert.equal(scene.pan.y, 60);
  scene.chars.get("alpha").x = -50;
  scene.chars.get("alpha").y = 999;
  scene.followCamera(room, 500, 500, 2);
  assert.equal(scene.pan.x, 162);
  assert.equal(scene.pan.y, -362);
  scene.followCamera(room, 1000, 1600, 1);
  assert.equal(Math.abs(scene.pan.x), 0);
  assert.equal(Math.abs(scene.pan.y), 0);
});
test("filtering or removing the followed session clears the camera target", () => {
  const scene = Object.create(model.Scene.prototype);
  const changes = [];
  Object.assign(scene, {
    chars: new Map(),
    following: "alpha",
    onFollowChange: (id) => changes.push(id),
  });
  const agent = { id: "alpha", platform: "opencode" };
  scene.update([agent], {}, null, "alpha", "claude");
  assert.equal(scene.following, null);
  scene.following = "alpha";
  scene.update([], {}, null, null, "every");
  assert.equal(scene.following, null);
  assert.deepEqual(changes, [null, null]);
});
test("appearance preferences accept only supported finishes and subagent styles", () => {
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        model.normalizeSettings({
          theme: "juniper",
          desk_style: "slate",
          subagent_style: "robot",
        }),
      ),
    ),
    { theme: "juniper", desk_style: "slate", subagent_style: "robot" },
  );
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        model.normalizeSettings({
          desk_style: "remote-url",
          subagent_style: ["robot"],
        }),
      ),
    ),
    {},
  );
});
test("delegated sessions use the selected character style without changing parents", () => {
  const parent = { id: "parent", kind: "agent" };
  const child = { id: "child", kind: "subagent", parent: "parent" };
  assert.match(
    model.characterSpriteKey(parent, { subagent_style: "robot" }),
    /^char[0-5]$/,
  );
  assert.equal(
    model.characterSpriteKey(child, { subagent_style: "robot" }),
    "studio-assistant",
  );
  assert.match(
    model.characterSpriteKey(child, { subagent_style: "people" }),
    /^char[0-5]$/,
  );
  assert.equal(model.characterSpriteKey(child, {}), "studio-assistant");
});
test("new workstation props retain finite collision bounds through responsive reflow", () => {
  for (const grid of [
    { w: 210, h: 238 },
    { w: 344, h: 262 },
  ]) {
    const result = model.resolveFurniture(
      [
        { kind: "focusbooth", x: 0.5, y: 0.65 },
        { kind: "filingcabinet", x: 0.5, y: 0.65 },
      ],
      grid,
      [],
    );
    assert.equal(result.unplaced, 0);
    assert.equal(result.props.length, 2);
    const [a, b] = result.props.map((p) => p.bounds);
    assert.equal(model.overlapsRect(a, b), false);
    for (const bounds of [a, b]) {
      assert.ok(Object.values(bounds).every(Number.isFinite));
      assert.ok(bounds.x >= 7 && bounds.y >= 28);
      assert.ok(bounds.x + bounds.w <= grid.w - 7);
      assert.ok(bounds.y + bounds.h <= grid.h - 10);
    }
  }
});
test("crowns follow the resolved character's head and retain the human fallback", () => {
  const scene = Object.create(model.Scene.prototype);
  const rectangles = [];
  Object.assign(scene, {
    sprites: { "studio-assistant": {} },
    spriteFrameTops: { "studio-assistant": Array(21).fill(10) },
    settings: { subagent_style: "robot" },
    cosmetics: ["crown"],
    time: 0,
    stateAtTime: 0,
    paused: true,
    ctx: { save() {}, restore() {}, drawImage() {} },
    rect: (...args) => rectangles.push(args),
  });
  const child = { id: "child", kind: "subagent", status: "idle" };
  const humanKey = model.characterSpriteKey(child, {
    subagent_style: "people",
  });
  scene.sprites[humanKey] = {};
  scene.character(child, 10, 20, { moving: false });
  assert.equal(rectangles[0][1], 32, "crown follows the shorter robot's head");
  rectangles.length = 0;
  delete scene.sprites["studio-assistant"];
  scene.character(child, 10, 20, { moving: false });
  assert.equal(
    rectangles[0][1],
    24,
    "missing robot art keeps the human crown anchor",
  );
});
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
      "whiteboard",
      "printer",
      "cart",
      "coatrack",
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
test("a desktop prop relocates clear of mobile desks without changing saved coordinates", () => {
  const items = [{ kind: "sofa", x: 185 / 344, y: 122 / 262 }];
  const saved = JSON.stringify(items);
  const grid = { w: 210, h: 338 };
  const occupied = [
    { x: 47, y: 35, w: 48, h: 56 },
    { x: 115, y: 35, w: 48, h: 56 },
    { x: 47, y: 111, w: 48, h: 56 },
    { x: 115, y: 111, w: 48, h: 56 },
    { x: 47, y: 187, w: 48, h: 56 },
    { x: 115, y: 187, w: 48, h: 56 },
    ...model.defaultDecor(grid, []),
  ];
  const result = model.resolveFurniture(items, grid, occupied);
  assert.equal(result.relocated, 1);
  assert.equal(result.unplaced, 0);
  const bounds = result.props[0].bounds;
  assert.ok(bounds && occupied.every((b) => !model.overlapsRect(bounds, b)));
  assert.equal(JSON.stringify(items), saved);
  assert.deepEqual(model.resolveFurniture(items, grid, occupied), result);
});
test("a full floor reports unplaced furniture while preserving editable settings", () => {
  const result = model.resolveFurniture(
    [{ kind: "sofa", x: 0.5, y: 0.5 }],
    { w: 210, h: 238 },
    [{ x: 0, y: 0, w: 210, h: 238 }],
  );
  assert.equal(result.unplaced, 1);
  assert.equal(result.props.length, 1);
  assert.equal(result.props[0].index, 0);
  assert.equal(result.props[0].bounds, null);
});
test("crowded furniture resolution stays bounded and avoids other custom props", () => {
  const grid = { w: 344, h: 2542 };
  const desks = Array.from({ length: 128 }, (_, i) => ({
    x: 46 + (i % 4) * 68,
    y: 35 + Math.floor(i / 4) * 76,
    w: 48,
    h: 56,
  }));
  const items = Array.from({ length: 24 }, () => ({
    kind: "server",
    x: 0.2,
    y: 0.5,
  }));
  const result = model.resolveFurniture(items, grid, desks);
  assert.equal(result.unplaced, 0);
  const occupied = [...desks];
  for (const prop of result.props) {
    assert.ok(occupied.every((b) => !model.overlapsRect(prop.bounds, b)));
    occupied.push(prop.bounds);
  }
  assert.ok(result.attempts <= 24 * 2048, "resolution search is bounded");
});
test("editing hit tests and placement use displayed furniture after relocation", () => {
  const scene = Object.create(model.Scene.prototype);
  scene.settings = {
    decorations: false,
    furniture: [{ kind: "sofa", x: 0.5, y: 0.5 }],
  };
  scene.grid = { w: 210, h: 238 };
  scene.resolvedFurniture = [
    { index: 0, kind: "sofa", bounds: { x: 150, y: 190, w: 40, h: 28 } },
  ];
  scene.hitBoxes = [];
  scene.movingIndex = null;
  scene.edit = "server";
  assert.equal(scene.propAt({ x: 160, y: 200 }), 0);
  assert.equal(scene.propAt({ x: 100, y: 110 }), -1);
  assert.equal(scene.placement({ x: 168, y: 217 }).valid, false);
  assert.equal(scene.placement({ x: 105, y: 119 }).valid, true);
});
test("nameplate status lines and edges select their session", () => {
  model.devicePixelRatio = 1;
  const noop = () => {},
    handlers = new Map(),
    selected = [];
  const ctx = Object.fromEntries(
    [
      "setTransform",
      "clearRect",
      "fillRect",
      "save",
      "translate",
      "scale",
      "restore",
      "beginPath",
      "roundRect",
      "fill",
      "fillText",
    ].map((name) => [name, noop]),
  );
  ctx.measureText = (text) => ({ width: text.length * 7 });
  const scene = Object.create(model.Scene.prototype);
  Object.assign(scene, {
    canvas: {
      style: {},
      clientWidth: 1100,
      clientHeight: 650,
      width: 1100,
      height: 650,
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      addEventListener: (name, handler) => handlers.set(name, handler),
      setPointerCapture: noop,
    },
    ctx,
    agents: [],
    settings: {
      max_chars: 4,
      theme: "default",
      show_labels: true,
      decorations: false,
      furniture: [],
    },
    cosmetics: [],
    sprites: {},
    chars: new Map(),
    filter: "every",
    zoom: 1,
    pan: { x: 0, y: 0 },
    paused: true,
    time: 0,
    edit: null,
    movingIndex: null,
    onSelect: (id) => selected.push(id),
    onPlace: noop,
    room: noop,
    rect: noop,
    shadow: noop,
    text: noop,
  });
  scene.update(
    Array.from({ length: 6 }, (_, i) => ({
      id: "session-" + i,
      label: "Session " + i,
      status: "working",
      tool: "terminal",
    })),
    scene.settings,
    null,
    null,
    "every",
  );
  scene.draw(0);
  scene.bindInput();
  // Independent coordinates cover the lower status line and left label edge.
  for (const [x, y] of [
    [313.5, 241.4],
    [241, 218],
  ]) {
    const label = scene.labelBoxes[0];
    assert.ok(
      x > label.x &&
        x < label.x + label.w &&
        y > label.y &&
        y < label.y + label.h,
    );
    const event = {
      clientX: x,
      clientY: y,
      button: 0,
      isPrimary: true,
      pointerId: 1,
    };
    handlers.get("pointerdown")(event);
    handlers.get("pointerup")(event);
  }
  assert.deepEqual(selected, ["session-0", "session-0"]);
});
