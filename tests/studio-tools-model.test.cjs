const { test } = require("node:test");
const assert = require("node:assert/strict");

test("arcade motion is quiet and printer motion requires an interaction", () => {
  const { frameKey } = require("../web/js/studio-tools.js");
  assert.equal(frameKey("arcade", { time: 0.75 }), "arcade-anim-1");
  assert.equal(frameKey("arcade", { time: 3, paused: true }), "arcade-anim-0");
  assert.equal(frameKey("printer", { time: 0.75 }), "printer-anim-0");
  assert.equal(
    frameKey("printer", { time: 0.75, reacting: true }),
    "printer-anim-3",
  );
  assert.equal(
    frameKey("printer", { time: 0.75, reacting: true, paused: true }),
    "printer-anim-0",
  );
});
const { frameKey } = require("../web/js/studio-tools.js");
test("ambient and observed-running frames follow scene time and freeze with Pause", () => {
  assert.equal(frameKey("server", { time: 0.5 }), "server-anim-2");
  assert.equal(
    frameKey("server", { time: 0.5, paused: true }),
    "server-anim-0",
  );
  assert.equal(
    frameKey("taskterminal-running", { time: 0.75 }),
    "taskterminal-running-anim-3",
  );
  assert.equal(
    frameKey("taskterminal-disconnected", { time: 100 }),
    "taskterminal-disconnected",
  );
  assert.equal(frameKey("server", { time: Infinity }), "server-anim-0");
});
test("reaction frames require a reaction and music frames require playback", () => {
  assert.equal(frameKey("coffee", { time: 1 }), "coffee");
  assert.equal(
    frameKey("coffee", { time: 1, reacting: true }),
    "coffee-anim-0",
  );
  assert.equal(
    frameKey("recordplayer", { time: 2, music: false }),
    "recordplayer",
  );
  assert.equal(
    frameKey("recordplayer", { time: 2.25, music: true }),
    "recordplayer-anim-1",
  );
  assert.equal(frameKey("lamp", { lights: false }), "lamp-off");
  assert.equal(frameKey("lamp", { lights: true }), "lamp");
});

test("plant frames only animate cosmetic watering reactions", () => {
  for (const kind of ["succulent", "fern", "planter"]) {
    assert.equal(frameKey(kind, { time: 0.75 }), kind);
    assert.equal(
      frameKey(kind, { time: 0.75, reacting: true }),
      kind + "-anim-3",
    );
    assert.equal(
      frameKey(kind, { time: 0.75, reacting: true, paused: true }),
      kind + "-anim-0",
    );
  }
});
test("sprite filtering and sequences have stable groups and frame order", () => {
  const tools = require("../web/js/studio-tools.js");
  const keys = [
    "fern",
    "fern-anim-0",
    "fern-anim-1",
    "fern-anim-2",
    "fern-anim-3",
    "pet-0-idle",
    "pet-0-walk-a",
    "pet-0-walk-b",
    "person-0-idle",
    "fx-water-drops-0",
    "icon-heart",
  ];
  assert.deepEqual(
    tools.filterKeys(keys, "FERN anim", "furniture"),
    keys.slice(1, 5),
  );
  assert.deepEqual(tools.filterKeys(keys, "", "companions"), keys.slice(5, 8));
  assert.deepEqual(tools.filterKeys(keys, "not-here", "all"), []);
  assert.deepEqual(tools.animationKeys("fern-anim-2", keys), keys.slice(1, 5));
  assert.deepEqual(tools.animationKeys("pet-0-idle", keys), [
    "pet-0-idle",
    "pet-0-walk-a",
    "pet-0-walk-b",
    "pet-0-walk-a",
  ]);
  assert.deepEqual(tools.animationKeys("icon-heart", keys), ["icon-heart"]);
});
test("animated props fit their bounds without nonuniform stretching", () => {
  const { fitRect } = require("../web/js/studio-tools.js");
  assert.deepEqual(
    fitRect({ width: 12, height: 16 }, 10, 20, 24, 48),
    [10, 36, 24, 32],
  );
  assert.deepEqual(
    fitRect({ width: 40, height: 20 }, 0, 0, 20, 20),
    [0, 10, 20, 10],
  );
});

test("actor searches keep identity numbers separate from animation frame numbers", () => {
  const { filterKeys } = require("../web/js/studio-tools.js"),
    keys = Array.from({ length: 8 }, (_, pet) =>
      Array.from({ length: 4 }, (_, frame) => `pet-${pet}-happy-anim-${frame}`),
    ).flat();
  for (const [query, expected] of [
    [
      "pet 0 happy anim",
      [
        "pet-0-happy-anim-0",
        "pet-0-happy-anim-1",
        "pet-0-happy-anim-2",
        "pet-0-happy-anim-3",
      ],
    ],
    [
      "PET_1 happy anim",
      [
        "pet-1-happy-anim-0",
        "pet-1-happy-anim-1",
        "pet-1-happy-anim-2",
        "pet-1-happy-anim-3",
      ],
    ],
    [
      "pet-2 happy anim",
      [
        "pet-2-happy-anim-0",
        "pet-2-happy-anim-1",
        "pet-2-happy-anim-2",
        "pet-2-happy-anim-3",
      ],
    ],
    [
      "happy pet 3 anim",
      [
        "pet-3-happy-anim-0",
        "pet-3-happy-anim-1",
        "pet-3-happy-anim-2",
        "pet-3-happy-anim-3",
      ],
    ],
    ["pet-0-happy-anim-1", ["pet-0-happy-anim-1"]],
  ])
    assert.deepEqual(filterKeys(keys, query), expected, query);
  const characters = [
    "person-1-read-anim-0",
    "person-10-read-anim-1",
    "person-2-read-anim-1",
  ];
  assert.deepEqual(filterKeys(characters, "person 1 read"), [
    "person-1-read-anim-0",
  ]);
  assert.deepEqual(filterKeys(keys, "pet 0", "characters"), []);
});

test("friendly appearance and action names remain searchable alongside source IDs", () => {
  const { filterKeys } = require("../web/js/studio-tools.js"),
    keys = [
      "pet-4-happy-anim-0",
      "pet-0-happy-anim-1",
      "person-4-read",
      "person-2-attention",
      "taskterminal-running-anim-0",
    ];
  assert.deepEqual(filterKeys(keys, "corgi happy"), ["pet-4-happy-anim-0"]);
  assert.deepEqual(filterKeys(keys, "studio robot reading"), ["person-4-read"]);
  assert.deepEqual(filterKeys(keys, "indigo needs input"), [
    "person-2-attention",
  ]);
  assert.deepEqual(filterKeys(keys, "task terminal running"), [
    "taskterminal-running-anim-0",
  ]);
  assert.deepEqual(filterKeys(keys, "person-4-read"), ["person-4-read"]);
});

test("displayed frame numbers and source animation indices each select one frame", () => {
  const { filterKeys } = require("../web/js/studio-tools.js"),
    keys = [
      "pet-0-happy-anim-0",
      "pet-0-happy-anim-1",
      "pet-0-happy-anim-2",
      "pet-0-happy-anim-3",
      "fx-sparkles-0",
      "fx-sparkles-1",
    ];
  assert.deepEqual(filterKeys(keys, "orange cat happy frame 3"), [
    "pet-0-happy-anim-2",
  ]);
  assert.deepEqual(filterKeys(keys, "pet 0 happy anim 3"), [
    "pet-0-happy-anim-3",
  ]);
  assert.deepEqual(filterKeys(keys, "sparkles frame 2"), ["fx-sparkles-1"]);
  assert.deepEqual(filterKeys(keys, "fx-sparkles-1"), ["fx-sparkles-1"]);
  assert.deepEqual(filterKeys(keys, "fx sparkles 1", "companions"), []);
  assert.deepEqual(filterKeys(keys, "frame 9"), []);
});

test("character life families expose native source order and retain static fallback", () => {
  const { animationKeys } = require("../web/js/studio-tools.js"),
    keys = [
      "person-0-type",
      "person-0-type-anim-0",
      "person-0-type-anim-1",
      "person-0-type-anim-2",
      "person-0-type-anim-3",
      "person-1-read-anim-0",
      "person-1-read-anim-1",
    ];
  assert.deepEqual(animationKeys("person-0-type", keys), [
    "person-0-type-anim-0",
    "person-0-type-anim-1",
    "person-0-type-anim-2",
    "person-0-type-anim-3",
  ]);
  assert.deepEqual(animationKeys("person-0-type-anim-2", keys), [
    "person-0-type-anim-0",
    "person-0-type-anim-1",
    "person-0-type-anim-2",
    "person-0-type-anim-3",
  ]);
  assert.deepEqual(animationKeys("person-1-read-anim-0", keys), [
    "person-1-read-anim-0",
  ]);
  assert.deepEqual(animationKeys("person-0-type", ["person-0-type"]), [
    "person-0-type",
  ]);
});
