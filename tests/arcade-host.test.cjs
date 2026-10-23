/* Host logic checks: minimal DOM/clock doubles, real arcade controller code. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
function host() {
  const nodes = [],
    frames = new Map(),
    timers = new Map(),
    listeners = new Map(),
    storage = new Map(),
    labels = [];
  let nextFrame = 0,
    nextTimer = 0,
    blockedStorage = false;
  const context = Object.fromEntries(
    ["fillRect", "beginPath", "roundRect", "fill", "arc"].map((key) => [
      key,
      () => {},
    ]),
  );
  context.fillText = (text) => labels.push(text);
  class Element {
    constructor(tag = "div", id = "") {
      this.tagName = tag;
      this.id = id;
      this.dataset = {};
      this.children = [];
      this.attrs = {};
      this.events = {};
      this.hidden = false;
      this.removed = false;
      if (tag === "iframe") {
        this.messages = [];
        this.contentWindow = {
          postMessage: (message) => this.messages.push(message),
        };
      }
      nodes.push(this);
    }
    setAttribute(k, v) {
      this.attrs[k] = v;
    }
    getAttribute(k) {
      return this.attrs[k];
    }
    removeAttribute(key) {
      delete this.attrs[key];
    }
    remove() {
      this.removed = true;
    }
    replaceChildren(...children) {
      this.children.forEach((child) => child.remove());
      this.children = children;
    }
    append(...children) {
      this.children.push(...children);
    }
    after(child) {
      this.insertedAfter = child;
    }
    focus() {
      document.activeElement = this;
    }
    getContext() {
      return context;
    }
    addEventListener(k, fn) {
      this.events[k] = fn;
    }
    querySelector(selector) {
      return nodes.find((n) => n.className === selector.slice(1));
    }
    querySelectorAll(selector) {
      const key =
        selector === "[data-arcade-game]" ? "arcadeGame" : "snakeTurn";
      return nodes.filter((n) => n.dataset[key]);
    }
  }
  const ids = [
    "sheet-arcade",
    "arcade-canvas",
    "arcade-heading",
    "arcade-score",
    "arcade-best",
    "arcade-level",
    "arcade-lives",
    "arcade-status",
    "arcade-pause",
    "arcade-restart",
    "arcade-exit",
    "arcade-start",
    "arcade-duck-start",
    "arcade-motion-note",
    "arcade-breakout-stage",
    "arcade-duck-stage",
    "arcade-game-breakout",
    "arcade-game-duck-hunt",
  ];
  for (const id of ids) new Element("div", id);
  for (const name of [
    "arcade-picker",
    "arcade-intro",
    "arcade-attribution",
    "arcade-hud",
    "close",
  ])
    new Element().className = name;
  const get = (id) => nodes.find((n) => n.id === id && !n.removed);
  get("arcade-game-breakout").dataset.arcadeGame = "breakout";
  get("arcade-game-duck-hunt").dataset.arcadeGame = "duck-hunt";
  get("sheet-arcade").hidden = true;
  const document = {
    hidden: false,
    activeElement: null,
    getElementById: get,
    createElement: (tag) => new Element(tag),
    addEventListener: (key, fn) => listeners.set(key, fn),
  };
  const motion = {
    matches: false,
    addEventListener: (_, fn) => {
      motion.change = fn;
    },
  };
  const sandbox = {
    document,
    settings: { sound: false },
    _state: { mode: "demo" },
    officeScene: { paused: false },
    matchMedia: () => motion,
    openSheet: () => {
      get("sheet-arcade").hidden = false;
    },
    MutationObserver: class {
      observe() {}
    },
    requestAnimationFrame: (fn) => {
      frames.set(++nextFrame, fn);
      return nextFrame;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    addEventListener: (key, fn) => listeners.set(key, fn),
    setTimeout: (fn) => {
      timers.set(++nextTimer, fn);
      return nextTimer;
    },
    clearTimeout: (id) => timers.delete(id),
    localStorage: {
      getItem: (key) => {
        if (blockedStorage) throw new Error("blocked");
        return storage.get(key) || null;
      },
      setItem: (key, value) => {
        if (blockedStorage) throw new Error("blocked");
        storage.set(key, value);
      },
    },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../web/js/arcade.js"), "utf8"),
    sandbox,
  );
  const snapshot = () =>
    JSON.parse(JSON.stringify(sandbox.officeArcade.snapshot()));
  return {
    get,
    document,
    motion,
    sandbox,
    frames,
    labels,
    storage,
    snapshot,
    timers,
    emit: (type, event = {}) => listeners.get(type)?.(event),
    childMessage(type, overrides = {}) {
      const frame = get("arcade-duck-frame");
      listeners.get("message")({
        source: frame.contentWindow,
        origin: "null",
        data: {
          channel: "agent-office-arcade",
          nonce: new URL(frame.src, "http://office.test/").searchParams.get(
            "nonce",
          ),
          type,
        },
        ...overrides,
      });
    },
    blockStorage: () => {
      blockedStorage = true;
    },
    click: (id) => get(id).onclick(),
    tick: (time) => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((fn) => fn(time));
    },
    open: () => sandbox.officeArcade.open(),
  };
}
test("selecting Snake focuses its visible Start control and paints its title", () => {
  const h = host();
  h.open();
  h.labels.length = 0;
  h.click("arcade-game-snake");
  assert.equal(h.document.activeElement.id, "arcade-start");
  assert.ok(h.labels.includes("SNAKE"));
  assert.equal(h.snapshot().paused, true);
  assert.equal(h.frames.size, 0);
});
test("native games share one loop, and hiding the panel pauses without auto-resume", () => {
  const h = host();
  h.open();
  h.click("arcade-game-snake");
  h.click("arcade-start");
  assert.equal(h.frames.size, 1);
  h.tick(1000);
  h.tick(1050);
  assert.equal(h.frames.size, 1);
  h.get("sheet-arcade").hidden = true;
  h.sandbox.officeArcade.sync();
  assert.equal(h.frames.size, 0);
  assert.equal(h.snapshot().paused, true);
  h.open();
  assert.equal(h.snapshot().paused, true);
  assert.equal(h.frames.size, 0);
  h.click("arcade-pause");
  assert.equal(h.frames.size, 1);
  h.click("arcade-exit");
  h.click("arcade-game-breakout");
  assert.equal(h.frames.size, 0);
});
test("enabling reduced motion pauses a running game after an explicit start", () => {
  const h = host();
  h.open();
  h.click("arcade-game-snake");
  h.click("arcade-start");
  h.motion.matches = true;
  h.motion.change();
  assert.equal(h.frames.size, 0);
  assert.equal(h.snapshot().paused, true);
  h.click("arcade-pause");
  assert.equal(h.frames.size, 1);
  assert.equal(h.motion.matches, true);
});
test("Snake and Breakout best scores stay separate and reject corrupt values", () => {
  const h = host();
  h.storage.set("agent-office:preview:arcade:snake-best", "80");
  h.open();
  h.click("arcade-game-snake");
  assert.equal(h.snapshot().best, 80);
  h.click("arcade-exit");
  h.click("arcade-game-breakout");
  assert.equal(h.snapshot().best, 0);
  h.storage.set("agent-office:observer:arcade:breakout-best", "Infinity");
  h.sandbox._state.mode = "observer";
  h.sandbox.officeArcade.sync();
  assert.equal(h.snapshot().best, 0);
});
test("Snake direction buttons do not resume a paused game", () => {
  const h = host();
  h.open();
  h.click("arcade-game-snake");
  h.click("arcade-start");
  h.click("arcade-pause");
  const before = h.snapshot();
  const button = h.get("arcade-snake-controls").children[0];
  button.onclick();
  assert.deepEqual(h.snapshot(), before);
  assert.equal(button.disabled, true);
});

test("reselecting a paused native game tells the player to resume", () => {
  const h = host();
  h.open();
  h.click("arcade-game-snake");
  h.click("arcade-start");
  h.click("arcade-exit");
  h.click("arcade-game-snake");
  assert.equal(h.get("arcade-start").hidden, true);
  assert.equal(h.get("arcade-pause").textContent, "Resume");
  assert.equal(
    h.get("arcade-status").textContent,
    "Snake selected. Press Resume when you are ready.",
  );
  assert.equal(h.document.activeElement.id, "arcade-pause");
});

test("Snake accepts uppercase WASD without leaking the key to the page", () => {
  const h = host();
  h.open();
  h.click("arcade-game-snake");
  h.click("arcade-start");
  let prevented = false;
  h.get("arcade-canvas").events.keydown({
    key: "W",
    shiftKey: true,
    preventDefault: () => {
      prevented = true;
    },
  });
  for (let time = 1000; time <= 1500; time += 50) h.tick(time);
  assert.equal(prevented, true);
  assert.deepEqual(h.snapshot().snake.body[0], { x: 12, y: 8 });
});

for (const type of ["paused", "resumed"])
  test(`Duck Hunt ignores ${type} reports before required artwork is ready`, () => {
    const h = host();
    h.open();
    h.click("arcade-game-duck-hunt");
    h.click("arcade-duck-start");
    const status = h.get("arcade-status").textContent;
    h.childMessage(type);
    assert.equal(
      h.get("arcade-status").textContent,
      status,
      "loading feedback must remain truthful",
    );
    assert.equal(h.snapshot().duck.ready, false);
    assert.equal(h.snapshot().duck.paused, true);
    assert.equal(
      h.timers.size,
      1,
      "early input must not cancel the readiness deadline",
    );
    h.childMessage("ready");
    assert.equal(h.snapshot().duck.ready, true);
    assert.equal(
      h.snapshot().duck.paused,
      false,
      "the original explicit start is retained",
    );
    assert.equal(h.timers.size, 0);
  });

for (const stoppedBy of ["panel", "tab"])
  test(`a delayed Duck Hunt resume cannot undo a ${stoppedBy} lifecycle stop`, () => {
    const h = host();
    h.open();
    h.click("arcade-game-duck-hunt");
    h.click("arcade-duck-start");
    h.childMessage("ready");
    if (stoppedBy === "panel") {
      h.get("sheet-arcade").hidden = true;
      h.sandbox.officeArcade.sync();
    } else {
      h.document.hidden = true;
      h.emit("visibilitychange");
    }
    const status = h.get("arcade-status").textContent;
    h.childMessage("resumed");
    assert.equal(h.snapshot().paused, true);
    assert.equal(h.snapshot().duck.paused, true);
    assert.equal(h.get("arcade-status").textContent, status);
    assert.equal(h.get("arcade-duck-frame").messages.at(-1).action, "pause");
    h.document.hidden = false;
    h.open();
    assert.equal(
      h.snapshot().paused,
      true,
      "returning to the game must not autoplay",
    );
    h.click("arcade-pause");
    assert.equal(
      h.snapshot().duck.paused,
      false,
      "explicit Resume still works",
    );
  });

test("ready Duck Hunt accepts active child controls and rejects another frame or origin", () => {
  const h = host();
  h.open();
  h.click("arcade-game-duck-hunt");
  h.click("arcade-duck-start");
  h.childMessage("ready");
  h.childMessage("paused", { source: {} });
  h.childMessage("paused", { origin: "https://untrusted.example" });
  assert.equal(h.snapshot().paused, false);
  h.childMessage("paused");
  assert.equal(h.snapshot().paused, true);
  h.childMessage("resumed");
  assert.equal(h.snapshot().paused, false);
});
