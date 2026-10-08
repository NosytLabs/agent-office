/* Deterministic care interactions; these never touch observer progression. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  AquariumHabitat,
  MAX_PELLETS,
  FEED_COOLDOWN,
} = require("../web/js/aquarium.js");

test("a full animated food queue does not block still-mode feeding", () => {
  const tank = new AquariumHabitat();
  tank.select(["ember"]);
  for (let i = 0; i < 4; i++)
    assert.equal(tank.feed(330, i * FEED_COOLDOWN), "fed");
  assert.equal(tank.pellets.length, MAX_PELLETS);
  const before = tank.snapshot();
  assert.equal(tank.feed(330, 4 * FEED_COOLDOWN, true), "fed");
  assert.equal(tank.eaten, 1);
  assert.deepEqual(
    tank.pellets,
    before.pellets,
    "still-mode care must not add more falling food",
  );
  assert.equal(tank.feed(330, 4 * FEED_COOLDOWN + 1, true), "cooldown");
  assert.equal(tank.feed(330, 5 * FEED_COOLDOWN), "full");
});

test("food ripples expire on simulation time and do not animate still-mode feeding", () => {
  const tank = new AquariumHabitat();
  tank.select(["ember"]);
  tank.feed(180, 0);
  assert.ok(
    Array.isArray(tank.snapshot().ripples),
    "the habitat exposes bounded ripple state",
  );
  assert.equal(tank.snapshot().ripples.length, 1);
  for (let i = 0; i < 20; i++) tank.step(0.08);
  assert.equal(tank.snapshot().ripples.length, 0);
  tank.feed(180, FEED_COOLDOWN, true);
  assert.equal(tank.snapshot().ripples.length, 0);
});

test("clearing the tank clears food and ripples without losing visit totals", () => {
  const tank = new AquariumHabitat();
  tank.select(["ember"]);
  tank.feed(180, 0, true);
  tank.feed(180, FEED_COOLDOWN);
  tank.select([]);
  assert.deepEqual(tank.snapshot().pellets, []);
  assert.deepEqual(tank.snapshot().ripples, []);
  assert.equal(tank.eaten, 1);
});
