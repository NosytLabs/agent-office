const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const file = path.join(__dirname, "../web/js/studio.js");
const studio = fs.existsSync(file) ? require(file) : {};

test("studio has an independent, testable pose selector", () => {
  assert.equal(typeof studio.pose, "function");
});
test("attention wins over a stale command; errors are not guessed", () => {
  assert.equal(studio.pose?.({ status: "waiting", tool: "Bash" }), "attention");
  assert.equal(studio.pose?.({ status: "idle", detail: "⚠ failed" }), "error");
  assert.equal(
    studio.pose?.({ status: "idle", detail: "error-handling.py" }),
    "idle",
  );
});
test("observed commands differ from human input requests", () => {
  assert.equal(studio.pose?.({ status: "working", tool: "Bash" }), "wait");
  assert.equal(studio.pose?.({ status: "working", tool: "Read" }), "read");
  assert.equal(studio.pose?.({ status: "working", tool: "Edit" }), "type");
});
test("walking follows distance and paused poses are deterministic", () => {
  const walk = { moving: true, distance: 3 };
  assert.equal(studio.pose?.({}, walk, 0), "walk-a");
  assert.equal(studio.pose?.({}, walk, 900), "walk-a");
  assert.equal(studio.pose?.({}, { ...walk, distance: 6 }, 900), "walk-b");
  assert.equal(studio.pose?.({}, walk, 900, true), "idle");
});
test("quiet work is not converted to completion or sleep", () => {
  const agent = { status: "idle", quiet: true, recorded_status: "working" };
  const copy = structuredClone(agent);
  assert.equal(studio.pose?.(agent), "wait");
  assert.deepEqual(agent, copy);
});
test("companion poses use real walk, sleep and affection frames", () => {
  assert.equal(studio.petPose?.({ moving: true, distance: 3 }), "walk-a");
  assert.equal(studio.petPose?.({ mode: "sleep" }), "sleep");
  assert.equal(studio.petPose?.({ mode: "sit" }, true), "pet");
  assert.equal(studio.petPose?.({ moving: true }, false, true), "idle");
});
test("preferences reject unexpected values and omit telemetry", () => {
  assert.deepEqual(
    studio.preferences?.({
      art: "x",
      pets: [99, -1],
      season: "auto",
      tokens: 100,
    }),
    { art: "studio", pets: [0, 1], season: "none", finish: "oak" },
  );
  assert.deepEqual(
    studio.preferences?.({ art: "classic", pets: [4, 7], season: "winter" }),
    { art: "classic", pets: [4, 7], season: "winter", finish: "oak" },
  );
});
test("manifest rejects missing poses, out-of-bounds frames and bad anchors", () => {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../web/assets/sprites/studio/studio.json"),
      "utf8",
    ),
  );
  assert.equal(studio.validManifest?.(manifest), true);
  const missing = structuredClone(manifest);
  delete missing.entries["person-0-idle"];
  assert.equal(studio.validManifest?.(missing), false);
  const bounds = structuredClone(manifest);
  bounds.entries["person-0-idle"].rect[0] = 511;
  assert.equal(studio.validManifest?.(bounds), false);
  const anchor = structuredClone(manifest);
  anchor.entries["pet-0-idle"].anchor[0] = 99;
  assert.equal(studio.validManifest?.(anchor), false);
});

test("failed completion does not show a cheer", () => {
  assert.equal(
    studio.pose({ status: "done", detail: "⚠ Review failed" }),
    "error",
  );
});
test("companion feedback matches cats, dogs and the robot", () => {
  assert.equal(studio.companionFeedback?.(0, "Miso"), "Miso purrs.");
  assert.equal(studio.companionFeedback?.(4, "Scout"), "Scout wags happily.");
  assert.equal(studio.companionFeedback?.(7, "Bit"), "Bit beeps hello.");
});

// Execute the complete production loader, not a copy of its image helper.
// Network/timer doubles let a failed tile leave its seven siblings pending.
async function studioLoader() {
  const vm = require("node:vm");
  const images = [],
    timers = new Map(),
    nodes = new Map();
  let nextTimer = 0;
  const context = {
    drawImage() {},
    fillRect() {},
    putImageData() {},
    getImageData: (_x, _y, w, h) => ({
      data: new Uint8ClampedArray(w * h * 4),
    }),
  };
  class Element {
    constructor() {
      this.dataset = {};
    }
    append() {}
    after() {}
    addEventListener() {}
    setAttribute() {}
    querySelector(selector) {
      return node(selector);
    }
    getContext() {
      return context;
    }
  }
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, new Element());
    return nodes.get(id);
  }
  class PendingImage {
    constructor() {
      this.src = "";
      images.push(this);
    }
    removeAttribute(name) {
      if (name === "src") this.src = "";
    }
  }
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../web/assets/sprites/studio/studio.json"),
      "utf8",
    ),
  );
  const sandbox = {
    document: {
      body: new Element(),
      documentElement: new Element(),
      createElement: () => new Element(),
      getElementById: node,
      querySelector: node,
      querySelectorAll: () => [],
      dispatchEvent() {},
    },
    scene: {
      image() {},
      character() {},
      desk() {},
      pet() {},
      draw() {},
      update() {},
      previewSprite() {},
      settings: {},
      sprites: {},
    },
    agentCard() {},
    renderFurniturePreviews() {},
    localStorage: { getItem: () => null },
    Image: PendingImage,
    AbortController,
    Event,
    AbortSignal: { timeout: () => undefined },
    setTimeout(fn, ms) {
      timers.set(++nextTimer, { fn, ms });
      return nextTimer;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    fetch: async (url) => ({
      ok: url.endsWith("/studio.json"),
      json: async () => manifest,
    }),
  };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox);
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  await flush();
  assert.equal(images.length, 8);
  const complete = (image, index) => {
    image.naturalWidth = 512;
    image.naturalHeight = index === 7 ? 43 : 40;
    image.onload();
  };
  return { art: sandbox.officeStudio, images, timers, flush, complete };
}

for (const cause of ["error", "timeout"]) {
  test(`a required Studio tile ${cause} disposes every unfinished sibling before Retry`, async () => {
    const loader = await studioLoader();
    const pending = loader.art.reload();
    loader.complete(loader.images[0], 0);
    assert.equal(loader.art.ready, false, "never publish a partial base atlas");
    if (cause === "error") loader.images[3].onerror();
    else [...loader.timers.values()][2].fn();
    await pending;
    assert.equal(loader.art.source, "fallback");
    assert.match(
      loader.art.error,
      cause === "error" ? /unavailable: 3/ : /timed out: 3/,
    );
    assert.equal(
      loader.timers.size,
      0,
      "failed-attempt deadlines are released",
    );
    assert.ok(
      loader.images.slice(1).every((image) => image.src === ""),
      "all unfinished sibling image requests are cancelled",
    );
    assert.ok(
      loader.images.every(
        (image) => image.onload === null && image.onerror === null,
      ),
      "old callbacks are detached before another attempt can begin",
    );
    assert.notEqual(
      loader.images[0].src,
      "",
      "a completed image has no request to abort",
    );
  });
}

test("repeated Studio failure cannot accumulate old requests or deadlines", async () => {
  const loader = await studioLoader();
  for (let attempt = 0; attempt < 4; attempt++) {
    const pending = loader.art.reload();
    await loader.flush();
    assert.equal(loader.images.length, (attempt + 1) * 8);
    loader.images[attempt * 8 + 3].onerror();
    await pending;
  }
  assert.equal(loader.timers.size, 0);
  assert.ok(loader.images.every((image) => image.src === ""));
});

test("a failed Studio attempt's late callbacks cannot affect its healthy replacement", async () => {
  const loader = await studioLoader();
  const pending = loader.art.reload(),
    oldImages = loader.images.slice();
  const lateLoad = oldImages[1].onload,
    lateError = oldImages[2].onerror;
  oldImages[3].onerror();
  await pending;
  const next = loader.art.reload();
  assert.equal(
    loader.art.reload(),
    next,
    "concurrent retries share one attempt",
  );
  await loader.flush();
  const replacements = loader.images.slice(8);
  lateLoad();
  lateError();
  assert.equal(loader.timers.size, 8, "only current attempt deadlines remain");
  replacements.forEach(loader.complete);
  await next;
  assert.equal(loader.art.ready, true);
  assert.equal(loader.art.source, "studio");
  assert.equal(loader.art.loading, false);
  assert.equal(loader.art.error, "");
  assert.equal(loader.timers.size, 0);
  assert.ok(replacements.every((image) => image.src !== ""));
});

test("successful Studio pages publish together and preserve independent optional fallbacks", async () => {
  const loader = await studioLoader();
  const pending = loader.art.reload();
  loader.images.slice(0, 7).forEach(loader.complete);
  await loader.flush();
  assert.equal(loader.art.ready, false);
  assert.equal(loader.art.sprites.size, 0);
  loader.complete(loader.images[7], 7);
  await pending;
  assert.equal(loader.art.ready, true);
  assert.equal(loader.art.source, "studio");
  assert.ok(loader.art.sprites.size > 0);
  assert.match(loader.art.environmentError, /manifest unavailable/);
  assert.equal(loader.timers.size, 0);
  assert.ok(loader.images.every((image) => image.src !== ""));
});
