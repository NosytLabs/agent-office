/* Deterministic arcade regressions; no DOM, server, assets, or dependencies. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  BreakoutGame,
  SnakeGame,
  SNAKE_COLS,
  SNAKE_ROWS,
} = require("../web/js/arcade.js");

test("a Breakout corner contact damages an armored brick only once", () => {
  const game = new BreakoutGame(() => 0.25);
  game.start();
  game.bricks = [
    { x: 100, y: 100, w: 44, h: 16, hits: 2 },
    { x: 300, y: 40, w: 44, h: 16, hits: 1 },
  ];
  game.ball = { x: 95, y: 125, vx: 150, vy: -190 };
  game.step(0.05);
  assert.equal(game.bricks[0].hits, 1);
  assert.equal(game.score, 0);
  assert.ok(game.ball.x < 100 - 7);
});

test("Snake is an exported, independently testable game", () => {
  assert.equal(typeof SnakeGame, "function");
});

function snake() {
  assert.equal(typeof SnakeGame, "function", "SnakeGame must be implemented");
  const game = new SnakeGame(() => 0);
  game.start();
  return game;
}

test("Snake begins with three segments and an empty-cell food", () => {
  const game = snake();
  assert.equal(game.state, "playing");
  assert.equal(game.score, 0);
  assert.equal(game.level, 1);
  assert.equal(game.lives, 1);
  assert.equal(game.body.length, 3);
  assert.ok(!game.body.some((p) => p.x === game.food.x && p.y === game.food.y));
});

test("Snake rejects reversal, invalid directions, and two turns in one tick", () => {
  const game = snake();
  assert.equal(game.turn(-1, 0), false);
  assert.equal(game.turn(0, 0), false);
  assert.equal(game.turn(NaN, 1), false);
  assert.equal(game.turn(0.5, 0.5), false);
  assert.equal(game.turn(0, -1), true);
  assert.equal(game.turn(-1, 0), false);
  const head = { ...game.body[0] };
  game.advance();
  assert.deepEqual(game.body[0], { x: head.x, y: head.y - 1 });
  assert.equal(game.turn(-1, 0), true);
  game.advance();
  assert.deepEqual(game.body[0], { x: head.x - 1, y: head.y - 1 });
});

test("Snake grows, scores ten per food, and levels up every five foods", () => {
  const game = snake();
  for (let i = 0; i < 5; i++) {
    game.food = { x: game.body[0].x + 1, y: game.body[0].y };
    game.advance();
  }
  assert.equal(game.score, 50);
  assert.equal(game.body.length, 8);
  assert.equal(game.level, 2);
  assert.ok(game.speed < 0.45);
});

test("Snake can move into its vacating tail without a false collision", () => {
  const game = snake();
  game.body = [
    { x: 1, y: 1 },
    { x: 1, y: 2 },
    { x: 2, y: 2 },
    { x: 2, y: 1 },
  ];
  game.direction = { x: 0, y: -1 };
  game.food = { x: 10, y: 10 };
  assert.equal(game.turn(1, 0), true);
  game.advance();
  assert.equal(game.state, "playing");
  assert.deepEqual(game.body[0], { x: 2, y: 1 });
  assert.equal(new Set(game.body.map((p) => `${p.x},${p.y}`)).size, 4);
});

test("Snake ends cleanly on a wall or occupied body", () => {
  const wall = snake();
  wall.body = [
    { x: SNAKE_COLS - 1, y: 1 },
    { x: SNAKE_COLS - 2, y: 1 },
  ];
  wall.advance();
  assert.equal(wall.state, "lost");
  assert.equal(wall.lives, 0);
  const body = snake();
  body.body = [
    { x: 1, y: 1 },
    { x: 1, y: 2 },
    { x: 2, y: 2 },
    { x: 2, y: 1 },
    { x: 3, y: 1 },
  ];
  body.advance();
  assert.equal(body.state, "lost");
});

test("Snake fills the board without an infinite food-spawn loop", () => {
  const game = snake();
  const last = { x: SNAKE_COLS - 1, y: SNAKE_ROWS - 1 };
  const head = { x: last.x - 1, y: last.y };
  game.body = [head];
  for (let y = 0; y < SNAKE_ROWS; y++)
    for (let x = 0; x < SNAKE_COLS; x++) {
      if ((x === last.x && y === last.y) || (x === head.x && y === head.y))
        continue;
      game.body.push({ x, y });
    }
  game.food = last;
  game.advance();
  assert.equal(game.state, "won");
  assert.equal(game.body.length, SNAKE_COLS * SNAKE_ROWS);
  assert.equal(game.food, null);
});

test("Snake uses elapsed time rather than monitor frame rate", () => {
  const sixty = snake(),
    fast = snake();
  for (let i = 0; i < 60; i++) sixty.step(1 / 60);
  for (let i = 0; i < 144; i++) fast.step(1 / 144);
  assert.deepEqual(sixty.snapshot(), fast.snapshot());
});

test("Snake bounds a hidden-tab delta and ignores invalid time", () => {
  const game = snake();
  const before = game.snapshot();
  for (const delta of [NaN, Infinity, -1]) game.step(delta);
  assert.deepEqual(game.snapshot(), before);
  game.step(60);
  assert.ok(game.body[0].x - before.body[0].x <= 1);
  assert.equal(game.state, "playing");
});

test("Snake snapshots do not expose mutable model state", () => {
  const game = snake(),
    state = game.snapshot();
  state.body[0].x = -100;
  state.food.x = -100;
  assert.notEqual(game.body[0].x, -100);
  assert.notEqual(game.food.x, -100);
});

test("Snake restart resets score, direction, timing, and terminal state", () => {
  const game = snake();
  game.state = "lost";
  game.score = 900;
  game.lives = 0;
  game.start();
  assert.equal(game.state, "playing");
  assert.equal(game.score, 0);
  assert.equal(game.body.length, 3);
  assert.deepEqual(game.direction, { x: 1, y: 0 });
});
