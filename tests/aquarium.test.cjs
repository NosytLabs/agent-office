const { postSettings } = require("./settings-helper.cjs");
/* Aquarium product checks use a real, isolated observer and synthetic records. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
const {
  AquariumHabitat,
  WIDTH,
  HEIGHT,
  MAX_PELLETS,
  FEED_COOLDOWN,
} = require("../web/js/aquarium.js");
const root = path.resolve(__dirname, "..");
const baseURL = "http://127.0.0.1:18119";
const screenshots =
  process.env.OFFICE_AQUARIUM_SCREENSHOTS ||
  path.resolve(
    root,
    process.env.AQUARIUM_ASSET_DIR
      ? "../aquarium-private-review"
      : "reports/aquarium",
  );
let home,
  server,
  log,
  serverOutput = "";
before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "office-aquarium-"));
  fs.mkdirSync(path.join(home, "pixel-office"));
  if (process.env.AQUARIUM_ASSET_DIR) {
    const target = path.join(home, "pixel-office/assets/aquarium");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(process.env.AQUARIUM_ASSET_DIR, target, { recursive: true });
  }
  log = path.join(home, "pixel-office/events.jsonl");
  fs.writeFileSync(log, "");
  server = spawn(
    process.env.PYTHON || "python",
    ["run.py", "--port", "18119"],
    {
      cwd: root,
      env: { ...process.env, HERMES_HOME: home, AGENT_OFFICE_DEMO: "1" },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  server.stderr.on("data", (chunk) => {
    serverOutput = (serverOutput + chunk.toString()).slice(-3000);
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(baseURL + "/state")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Aquarium test observer did not start: " + serverOutput);
});
after(async () => {
  if (server) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill();
    await exited;
  }
  if (home) fs.rmSync(home, { recursive: true, force: true });
});
async function withPage(run, options = {}) {
  const { beforeReady, initialSettings, ...pageOptions } = options;
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox"],
  });
  try {
    const p = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      ...pageOptions,
    });
    if (initialSettings)
      await postSettings(p.request, baseURL + "/settings", {
        data: initialSettings,
      });
    p.setDefaultTimeout(8000);
    const errors = [];
    p.on("pageerror", (error) => errors.push(error.stack || error.message));
    let releaseInitialState;
    if (beforeReady) {
      const held = new Promise((resolve) => {
        releaseInitialState = resolve;
      });
      await p.route("**/state", async (route) => {
        await held;
        await route.continue().catch(() => {});
      });
    }
    await p.goto(baseURL);
    if (beforeReady) {
      try {
        await p.waitForFunction(
          () =>
            typeof openAquarium === "function" &&
            officeScene.loadedAssets >= 19,
        );
        await beforeReady(p);
      } finally {
        releaseInitialState();
      }
    }
    await p.waitForFunction(() => initialized);
    await run(p);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}
async function open(p) {
  assert.equal(await p.evaluate(() => typeof window.openAquarium), "function");
  await p.evaluate(() => openAquarium());
  await p.waitForFunction(
    () => !document.querySelector("#sheet-aquarium").hidden,
  );
}
async function capture(p, name) {
  fs.mkdirSync(screenshots, { recursive: true });
  await p.screenshot({
    path: path.join(screenshots, name + ".png"),
    fullPage: true,
  });
}
function publish(rows) {
  fs.appendFileSync(
    log,
    rows
      .map((row) =>
        JSON.stringify({
          platform: "claude",
          session_id: "aquarium-work",
          ts: Date.now() / 1000,
          ...row,
        }),
      )
      .join("\n") + "\n",
  );
}
test("fish reflect at tank boundaries and snapshots cannot mutate the tank", () => {
  const tank = new AquariumHabitat();
  tank.select(["ember", "mint", "violet", "pearl"]);
  tank.fish[0].x = WIDTH - 24.01;
  tank.fish[0].vx = 12;
  tank.step(0.04);
  assert.ok(tank.fish[0].vx < 0);
  tank.fish[1].y = HEIGHT - 38.01;
  tank.fish[1].vy = 2;
  tank.step(0.04);
  assert.ok(tank.fish[1].vy < 0);
  for (let frame = 0; frame < 6000; frame++) tank.step(1 / 30);
  for (const fish of tank.fish) {
    assert.ok(fish.x >= 24 && fish.x <= WIDTH - 24);
    assert.ok(fish.y >= 36 && fish.y <= HEIGHT - 38);
  }
  tank.snapshot().fish[0].x = -1000;
  assert.ok(tank.fish[0].x >= 24);
  tank.fish[0].y = 36.1;
  tank.fish[0].vy = 2;
  tank.pellets = [{ x: tank.fish[0].x, y: 26, age: 0 }];
  tank.step(0.08);
  assert.ok(
    tank.fish[0].y >= 36,
    "chasing a snack cannot move a fish through the waterline",
  );
});
test("feeding is capped and cooled down, and abandoned pellets expire", () => {
  const tank = new AquariumHabitat();
  tank.select(["ember"]);
  assert.equal(tank.feed(100, 0), "fed");
  for (let n = 0; n < 30; n++) assert.equal(tank.feed(100, 200), "cooldown");
  for (let n = 1; n < 4; n++)
    assert.equal(tank.feed(100, FEED_COOLDOWN * n), "fed");
  assert.equal(tank.pellets.length, MAX_PELLETS);
  assert.equal(tank.feed(100, FEED_COOLDOWN * 4), "full");
  for (let frame = 0; frame < 700; frame++) tank.step(1 / 30);
  assert.equal(tank.pellets.length, 0);
  const time = tank.time;
  assert.equal(tank.feed(100, FEED_COOLDOWN * 5, true), "fed");
  assert.equal(tank.time, time);
  assert.equal(tank.pellets.length, 0);
  assert.ok(tank.fish[0].snacks > 0);
});
test("tapping a fish identifies it and gives a bounded swimming reaction", () => {
  const tank = new AquariumHabitat();
  tank.select(["ember", "mint"]);
  const ember = tank.fish.find((fish) => fish.id === "ember");
  const start = ember.x;
  assert.equal(tank.fishAt(ember.x + 5, ember.y - 4)?.id, "ember");
  assert.equal(tank.fishAt(10, 20), null);
  assert.equal(tank.react("ember"), true);
  assert.ok(ember.reaction > 0);
  tank.step(0.08);
  assert.ok(
    Math.abs(ember.x - start) > 12 * 0.08,
    "a greeted fish briefly darts faster than its normal swim",
  );
  for (let frame = 0; frame < 20; frame++) tank.step(0.08);
  assert.equal(ember.reaction, 0);
  assert.equal(tank.react("missing"), false);
});
test("the aquarium starts with one free fish and honest locked species", () =>
  withPage(async (p) => {
    await open(p);
    assert.equal(await p.isChecked('[data-fish="ember"]'), true);
    assert.equal(await p.isDisabled('[data-fish="ember"]'), true);
    for (const id of ["mint", "violet", "pearl"])
      assert.equal(await p.isDisabled(`[data-fish="${id}"]`), true);
    assert.match(await p.textContent("#aquarium-collection"), /10 read/);
    assert.match(await p.textContent("#aquarium-collection"), /25 tool/);
    assert.match(await p.textContent("#aquarium-collection"), /usage report/);
    assert.equal(
      (await p.evaluate(() => officeAquarium.snapshot())).fish.length,
      1,
    );
    await capture(p, "first-fish");
  }));
test("real observed work unlocks fish and selected residents survive reload", () =>
  withPage(async (p) => {
    await open(p);
    publish([
      { event: "session_start" },
      ...Array.from({ length: 10 }, (_, i) => ({
        event: "tool_start",
        call_id: "read-" + i,
        tool_name: "Read",
      })),
    ]);
    await p.waitForFunction(
      () => !document.querySelector('[data-fish="mint"]').disabled,
    );
    assert.equal(await p.isDisabled('[data-fish="mint"]'), false);
    assert.equal(await p.isDisabled('[data-fish="violet"]'), true);
    await p.check('[data-fish="mint"]');
    await p.waitForFunction(() => pendingSaves === 0);
    publish(
      Array.from({ length: 15 }, (_, i) => ({
        event: "tool_start",
        call_id: "bash-" + i,
        tool_name: "Bash",
      })),
    );
    await p.waitForFunction(
      () => !document.querySelector('[data-fish="violet"]').disabled,
    );
    assert.equal(await p.isDisabled('[data-fish="pearl"]'), true);
    await p.check('[data-fish="violet"]');
    await p.waitForFunction(() => pendingSaves === 0);
    publish([{ event: "usage", usage_id: "fish-unlock", input_tokens: 42 }]);
    await p.waitForFunction(
      () => !document.querySelector('[data-fish="pearl"]').disabled,
    );
    await p.check('[data-fish="pearl"]');
    await p.waitForFunction(() => pendingSaves === 0);
    await p.reload();
    await p.waitForFunction(() => initialized);
    await open(p);
    assert.deepEqual(
      (await p.evaluate(() => officeAquarium.snapshot())).fish.map(
        (fish) => fish.id,
      ),
      ["ember", "mint", "violet", "pearl"],
    );
    await capture(p, "collection-unlocked");
  }));
test("feeding by keyboard and repeated tank taps never change activity, usage or XP", () =>
  withPage(async (p) => {
    await open(p);
    const beforeState = await (await p.request.get(baseURL + "/state")).json();
    await p.locator("#aquarium-feed").focus();
    await p.keyboard.press("Enter");
    assert.equal(
      (await p.evaluate(() => officeAquarium.snapshot())).pellets.length,
      3,
    );
    await p.evaluate(() => {
      const canvas = document.querySelector("#aquarium-canvas"),
        rect = canvas.getBoundingClientRect();
      for (let count = 0; count < 40; count++)
        canvas.dispatchEvent(
          new MouseEvent("click", {
            clientX: rect.left + 50,
            clientY: rect.top + 50,
          }),
        );
    });
    assert.equal(
      (await p.evaluate(() => officeAquarium.snapshot())).pellets.length,
      3,
    );
    assert.match(
      await p.textContent("#aquarium-status"),
      /enjoy this snack first/,
    );
    const afterState = await (await p.request.get(baseURL + "/state")).json();
    assert.equal(afterState.progress.xp, beforeState.progress.xp);
    assert.deepEqual(afterState.progress.stats, beforeState.progress.stats);
    assert.deepEqual(afterState.usage, beforeState.usage);
    assert.equal(afterState.tracking.received, beforeState.tracking.received);
    await capture(p, "feeding");
  }));
test("fish taps inspect and animate while open water still feeds", () =>
  withPage(async (p) => {
    await open(p);
    await p.evaluate(() => {
      const fish = officeAquarium.snapshot().fish[0],
        canvas = document.querySelector("#aquarium-canvas"),
        rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(
        new MouseEvent("click", {
          clientX: rect.left + (fish.x / 360) * rect.width,
          clientY: rect.top + (fish.y / 210) * rect.height,
        }),
      );
    });
    let snapshot = await p.evaluate(() => officeAquarium.snapshot());
    assert.equal(snapshot.pellets.length, 0);
    assert.equal(snapshot.inspectedFish, "ember");
    assert.ok(snapshot.fish[0].reaction > 0);
    assert.match(await p.textContent("#aquarium-status"), /Ember · Goldfish/);
    await capture(p, "fish-greeting");
    await p.evaluate(() => {
      const canvas = document.querySelector("#aquarium-canvas"),
        rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(
        new MouseEvent("click", {
          clientX: rect.left + (10 / 360) * rect.width,
          clientY: rect.top + (20 / 210) * rect.height,
        }),
      );
    });
    snapshot = await p.evaluate(() => officeAquarium.snapshot());
    assert.equal(snapshot.pellets.length, 3);
    assert.match(
      await p.getAttribute("#aquarium-canvas", "aria-label"),
      /select a fish/i,
    );
  }));
test("the tank light persists and rolls back after a failed save", () =>
  withPage(async (p) => {
    await open(p);
    assert.equal(
      await p.getAttribute("#aquarium-light", "aria-pressed"),
      "true",
    );
    await p.click("#aquarium-light");
    await p.waitForFunction(() => pendingSaves === 0);
    assert.equal(
      await p.getAttribute("#aquarium-light", "aria-pressed"),
      "false",
    );
    assert.equal(
      (await (await p.request.get(baseURL + "/settings")).json())
        .aquarium_light,
      false,
    );
    await p.reload();
    await p.waitForFunction(() => initialized);
    await open(p);
    assert.equal(
      await p.getAttribute("#aquarium-light", "aria-pressed"),
      "false",
    );
    await p.route("**/settings", (route) =>
      route.fulfill({ status: 503, body: "unavailable" }),
    );
    await p.click("#aquarium-light");
    await p.waitForFunction(() => pendingSaves === 0);
    assert.equal(
      await p.getAttribute("#aquarium-light", "aria-pressed"),
      "false",
    );
    assert.equal(
      (await p.evaluate(() => officeAquarium.snapshot())).light,
      false,
    );
    assert.match(await p.textContent("#aquarium-status"), /not saved/i);
    await p.unroute("**/settings");
    await p.click("#aquarium-light");
    await p.waitForFunction(() => pendingSaves === 0);
    assert.equal(
      await p.getAttribute("#aquarium-light", "aria-pressed"),
      "true",
    );
  }));
test("aquarium names preserve blurred drafts, queued newer edits and failed-save retries", () =>
  withPage(async (p) => {
    await open(p);
    await p.fill("#aquarium-name-input", "Blue Harbor");
    await p.locator("#aquarium-motion").focus();
    await p.waitForTimeout(1700);
    assert.equal(await p.inputValue("#aquarium-name-input"), "Blue Harbor");
    await p.click("#aquarium-name-save");
    await p.waitForFunction(() => pendingSaves === 0);
    assert.equal(await p.textContent("#aquarium-heading"), "Blue Harbor");
    let release;
    const blocked = new Promise((resolve) => {
      release = resolve;
    });
    await p.route("**/settings", async (route) => {
      await blocked;
      await route.continue();
    });
    await p.fill("#aquarium-name-input", "Submitted name");
    await p.click("#aquarium-name-save");
    await p.waitForFunction(() => pendingSaves > 0);
    await p.fill("#aquarium-name-input", "Newer draft");
    release();
    await p.waitForFunction(() => pendingSaves === 0);
    assert.equal(await p.inputValue("#aquarium-name-input"), "Newer draft");
    await p.unroute("**/settings");
    await p.route("**/settings", (route) =>
      route.fulfill({ status: 503, body: "unavailable" }),
    );
    await p.click("#aquarium-name-save");
    await p.waitForFunction(() => pendingSaves === 0);
    assert.equal(await p.inputValue("#aquarium-name-input"), "Newer draft");
    assert.match(await p.textContent("#aquarium-status"), /not saved/);
    assert.equal(await p.textContent("#aquarium-heading"), "Submitted name");
    await p.unroute("**/settings");
    await p.click("#aquarium-name-save");
    await p.waitForFunction(() => pendingSaves === 0);
    await p.reload();
    await p.waitForFunction(() => initialized);
    await open(p);
    assert.equal(await p.textContent("#aquarium-heading"), "Newer draft");
    assert.equal(await p.inputValue("#aquarium-name-input"), "Newer draft");
  }));
test("fish pause with controls, office motion and hidden or closed panels", () =>
  withPage(async (p) => {
    await open(p);
    const first = await p.evaluate(() => officeAquarium.snapshot());
    await p.waitForFunction(
      (startedAt) => officeAquarium.snapshot().time > startedAt,
      first.time,
      { timeout: 8000 },
    );
    await p.click("#aquarium-motion");
    const paused = await p.evaluate(() => officeAquarium.snapshot());
    await p.waitForTimeout(300);
    assert.equal(
      (await p.evaluate(() => officeAquarium.snapshot())).time,
      paused.time,
    );
    await p.click("#aquarium-motion");
    await p.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const hidden = await p.evaluate(() => officeAquarium.snapshot());
    assert.equal(hidden.running, false);
    assert.equal(hidden.timerActive, false);
    await p.waitForTimeout(200);
    assert.equal(
      (await p.evaluate(() => officeAquarium.snapshot())).time,
      hidden.time,
    );
    await p.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await p.waitForFunction(() => officeAquarium.snapshot().running);
    await p.keyboard.press("Escape");
    const closed = await p.evaluate(() => officeAquarium.snapshot());
    assert.equal(closed.running, false);
    assert.equal(closed.timerActive, false);
    await p.waitForTimeout(250);
    assert.equal(
      (await p.evaluate(() => officeAquarium.snapshot())).paintedFrames,
      closed.paintedFrames,
    );
    await p.evaluate(() => {
      officeScene.paused = true;
      openAquarium();
    });
    assert.equal(
      (await p.evaluate(() => officeAquarium.snapshot())).running,
      false,
    );
  }));
test("reduced motion keeps keyboard feeding available without simulation", () =>
  withPage(
    async (p) => {
      await open(p);
      assert.equal(
        (await p.evaluate(() => officeAquarium.snapshot())).running,
        false,
      );
      await p.evaluate(() => {
        const fish = officeAquarium.snapshot().fish[0],
          canvas = document.querySelector("#aquarium-canvas"),
          rect = canvas.getBoundingClientRect();
        canvas.dispatchEvent(
          new MouseEvent("click", {
            clientX: rect.left + (fish.x / 360) * rect.width,
            clientY: rect.top + (fish.y / 210) * rect.height,
          }),
        );
      });
      const inspected = await p.evaluate(() => officeAquarium.snapshot());
      assert.equal(inspected.inspectedFish, "ember");
      assert.equal(inspected.fish[0].reaction, 0);
      assert.equal(inspected.pellets.length, 0);
      await p.locator("#aquarium-canvas").focus();
      await p.keyboard.press("Space");
      const fed = await p.evaluate(() => officeAquarium.snapshot());
      assert.equal(fed.pellets.length, 0);
      assert.ok(fed.eaten > 0);
      await p.waitForTimeout(200);
      assert.equal(
        (await p.evaluate(() => officeAquarium.snapshot())).time,
        fed.time,
      );
      assert.match(
        await p.textContent("#aquarium-motion-note"),
        /Reduced motion/,
      );
    },
    { reducedMotion: "reduce" },
  ));
test("mobile aquarium controls and collection fit at 320 pixels", () =>
  withPage(
    async (p) => {
      await open(p);
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      assert.equal(
        await p.evaluate(() => {
          const panel = document.querySelector("#sheet-aquarium");
          return panel.scrollWidth > panel.clientWidth;
        }),
        false,
      );
      await capture(p, "mobile-aquarium");
      await p.locator("#aquarium-name-input").scrollIntoViewIfNeeded();
      await capture(p, "mobile-collection");
    },
    { viewport: { width: 320, height: 760 }, isMobile: true, hasTouch: true },
  ));
test("missing optional artwork is visible and leaves the fish playable", () =>
  withPage(async (p) => {
    await p.route("**/user/aquarium/manifest.json", (route) =>
      route.fulfill({ status: 404, body: "not installed" }),
    );
    await p.route("**/assets/sprites/aquarium/manifest.json", (route) =>
      route.fulfill({ status: 404, body: "unavailable" }),
    );
    await open(p);
    await p.waitForFunction(() => officeAquarium.snapshot().assetErrors > 0);
    assert.match(
      await p.textContent("#aquarium-art-status"),
      /Pixel fish keep the tank playable/,
    );
    assert.equal(await p.isVisible("#aquarium-retry-art"), true);
    assert.ok(
      (await p.evaluate(() => officeAquarium.snapshot())).fish.length > 0,
    );
    await p.click("#aquarium-feed");
    assert.ok(
      (await p.evaluate(() => officeAquarium.snapshot())).pellets.length > 0,
    );
  }));
test("a local manifest with false sheet geometry falls back to original art", () =>
  withPage(async (p) => {
    const atlas = fs.readFileSync(
      path.join(root, "web/assets/sprites/aquarium/original-fish.png"),
    );
    const fish = Object.fromEntries(
      ["ember", "mint", "violet", "pearl"].map((id) => [
        id,
        {
          url: `/user/aquarium/${id}.png`,
          region: [0, 0, 1254, 1254],
          facing: "right",
          sheet_width: 96,
          sheet_height: 64,
        },
      ]),
    );
    await p.route("**/user/aquarium/manifest.json", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ version: 1, fish }),
      }),
    );
    await p.route(
      /\/user\/aquarium\/(ember|mint|violet|pearl)\.png$/,
      (route) => route.fulfill({ contentType: "image/png", body: atlas }),
    );
    await open(p);
    await p.waitForFunction(
      () =>
        officeAquarium.snapshot().sprites.length === 4 &&
        officeAquarium.snapshot().artSource === "original",
    );
    assert.match(
      await p.textContent("#aquarium-art-status"),
      /optional local artwork could not load/i,
    );
    assert.equal(
      await p.textContent("#aquarium-art-source"),
      "Artwork: Agent Office originals",
    );
  }));
test("original public fish load once without a local pack and keep correct species labels", () =>
  withPage(async (p) => {
    await p.route("**/user/aquarium/manifest.json", (route) =>
      route.fulfill({ status: 404, body: "not installed" }),
    );
    let imageLoads = 0;
    p.on("request", (request) => {
      if (request.url().endsWith("/assets/sprites/aquarium/original-fish.png"))
        imageLoads++;
    });
    await open(p);
    await p.waitForFunction(
      () =>
        officeAquarium.snapshot().sprites.length === 4 ||
        officeAquarium.snapshot().assetErrors > 0,
    );
    const snapshot = await p.evaluate(() => officeAquarium.snapshot());
    assert.equal(snapshot.sprites.length, 4);
    assert.deepEqual(snapshot.spriteFrames, {
      ember: 1,
      mint: 1,
      violet: 1,
      pearl: 1,
    });
    assert.equal(snapshot.artSource, "original");
    assert.equal(imageLoads, 1);
    assert.match(await p.textContent("#aquarium-collection"), /Goldfish/);
    assert.match(await p.textContent("#aquarium-collection"), /Betta/);
    assert.match(await p.textContent("#aquarium-collection"), /Angelfish/);
    assert.equal(await p.isVisible("#aquarium-art-status"), false);
    assert.equal(
      await p.textContent("#aquarium-art-source"),
      "Artwork: Agent Office originals",
    );
    await p.fill("#aquarium-name-input", "The quiet cove");
    await p.click("#aquarium-name-save");
    await p.waitForFunction(() => pendingSaves === 0);
    await p.locator("#aquarium-heading").scrollIntoViewIfNeeded();
    const destination = path.join(
      root,
      "reports/product-ui/aquarium-public.png",
    );
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    await p.screenshot({ path: destination, fullPage: true });
  }));
test(
  "the optional local pack decodes every native animation frame",
  { skip: !process.env.AQUARIUM_ASSET_DIR },
  () =>
    withPage(async (p) => {
      await open(p);
      await p.waitForFunction(
        () => officeAquarium.snapshot().sprites.length === 4,
      );
      const snapshot = await p.evaluate(() => officeAquarium.snapshot());
      assert.equal(snapshot.assetErrors, 0);
      assert.deepEqual(snapshot.spriteFrames, {
        ember: 4,
        mint: 4,
        violet: 4,
        pearl: 4,
      });
      assert.equal(await p.isVisible("#aquarium-art-status"), false);
      await capture(p, "local-fish-pack");
    }),
);

test("aquarium room and canvas actions wait for saved settings before exposing editable names", () => {
  let posts = 0;
  return withPage(
    async (p) => {
      await p.click("#settingsbtn");
      await p.locator('[data-activity="Aquarium"]').click();
      assert.equal(await p.inputValue("#aquarium-name-input"), "Saved Lagoon");
      await p.click("#aquarium-name-save");
      await p.waitForFunction(() => pendingSaves === 0);
      assert.equal(
        (await (await p.request.get(baseURL + "/settings")).json())
          .aquarium_name,
        "Saved Lagoon",
      );
      assert.equal(posts, 1);
    },
    {
      initialSettings: { aquarium_name: "Saved Lagoon", decorations: true },
      beforeReady: async (p) => {
        p.on("request", (request) => {
          if (
            request.url().endsWith("/settings") &&
            request.method() === "POST"
          )
            posts++;
        });
        await p.click("#settingsbtn");
        await p.locator('[data-activity="Aquarium"]').click();
        assert.equal(
          await p.isVisible("#sheet-aquarium"),
          false,
          "room action cannot expose placeholder name",
        );
        assert.equal(await p.evaluate(() => opened), "sheet-settings");
        assert.match(await p.textContent("#toast"), /loading.*settings/i);
        await p.locator("#sheet-settings .close").click();
        while (await p.locator(".toast-dismiss").count())
          await p.locator(".toast-dismiss").first().click();
        // The earned tank is absent until progress loads. Exercise its actual
        // scene callback to ensure it shares the same protected entry point.
        await p.evaluate(() => officeScene.onProp("FISH_TANK"));
        assert.equal(
          await p.isVisible("#sheet-aquarium"),
          false,
          "the canvas interaction callback also waits",
        );
        assert.match(await p.textContent("#toast"), /loading.*settings/i);
        assert.equal(posts, 0);
        assert.equal(
          (await (await p.request.get(baseURL + "/settings")).json())
            .aquarium_name,
          "Saved Lagoon",
        );
        assert.equal(
          await p.evaluate(() => {
            officeViewState.write({ version: 1, panel: "sheet-aquarium" });
            return officeViewState.read().panel;
          }),
          null,
          "editable aquarium is not an automatically restored panel",
        );
      },
    },
  );
});
