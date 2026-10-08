/* Native Breakout model and real-browser arcade lifecycle checks. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
const {
  BreakoutGame,
  WIDTH,
  HEIGHT,
  PATTERNS,
} = require("../web/js/arcade.js");

const root = path.resolve(__dirname, ".."),
  baseURL = "http://127.0.0.1:18131",
  screenshots = path.join(root, "reports", "arcade");
let home,
  server,
  serverOutput = "";

before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "office-arcade-"));
  fs.mkdirSync(path.join(home, "pixel-office"));
  fs.writeFileSync(path.join(home, "pixel-office", "events.jsonl"), "");
  server = spawn(
    process.env.PYTHON || "python",
    ["run.py", "--port", "18131"],
    {
      cwd: root,
      env: { ...process.env, HERMES_HOME: home, AGENT_OFFICE_DEMO: "1" },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  server.stderr.on("data", (chunk) => {
    serverOutput = (serverOutput + chunk.toString()).slice(-4000);
  });
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      if ((await fetch(baseURL + "/state")).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Arcade test observer did not start: " + serverOutput);
});

after(async () => {
  if (server) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill();
    await exited;
  }
  if (home) fs.rmSync(home, { recursive: true, force: true });
});

async function withPage(
  run,
  viewport = { width: 1180, height: 900 },
  pageOptions = {},
  initScript,
) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage({ viewport, ...pageOptions });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.stack || error.message));
    if (initScript) await page.addInitScript(initScript);
    await page.goto(baseURL);
    await page.waitForFunction(
      () =>
        typeof initialized !== "undefined" &&
        initialized &&
        window.officeArcade,
    );
    await run(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}

test("Duck Hunt runtime is the exact documented patch of the pinned bundle", () => {
  const source = fs.readFileSync(
      path.join(root, "web/arcade/duck-hunt/js/upstream.js"),
      "utf8",
    ),
    runtime = fs.readFileSync(
      path.join(root, "web/arcade/duck-hunt/js/game.js"),
      "utf8",
    ),
    sourceHash = crypto.createHash("sha256").update(source).digest("hex");
  assert.equal(
    sourceHash,
    "a503f24c1124b5aa510a79555d4c55abd4bb159a3ebf43fada1fd3795f39ed42",
  );
  assert.equal(
    runtime,
    source
      .replace("this.position.x+=20/t", "this.position.x+=.072*t")
      .replace("this.position.x+=50/t", "this.position.x+=.18*t"),
  );
});

test("Breakout uses bounded time, loses cleanly and advances every pattern", () => {
  const game = new BreakoutGame(() => 0.25);
  game.start();
  const initial = game.snapshot();
  assert.equal(initial.state, "playing");
  assert.equal(initial.lives, 3);
  assert.ok(initial.remaining > 0);

  const before = game.ball.x;
  game.step(60); // clamped rather than consuming a hidden-tab minute
  assert.ok(Math.abs(game.ball.x - before) < WIDTH / 2);

  game.lives = 1;
  game.ball.y = HEIGHT + 20;
  game.ball.vy = 100;
  game.step(1 / 60);
  assert.equal(game.state, "lost");
  assert.equal(game.lives, 0);

  const winner = new BreakoutGame(() => 0.25);
  winner.start();
  for (let level = 1; level <= PATTERNS.length; level++) {
    winner.bricks.forEach((brick) => {
      brick.hits = 0;
    });
    winner.step(1 / 120);
    if (level < PATTERNS.length) assert.equal(winner.level, level + 1);
  }
  assert.equal(winner.state, "won");
});

test("Breakout starts explicitly, scopes keys and pauses on panel close", () =>
  withPage(async (page) => {
    await page.evaluate(() => officeArcade.open());
    await page.click("#arcade-game-breakout");
    assert.equal(
      (await page.evaluate(() => officeArcade.snapshot())).paused,
      true,
    );
    await page.click("#arcade-start");
    const first = await page.evaluate(() => officeArcade.snapshot());
    await page.waitForTimeout(250);
    const second = await page.evaluate(() => officeArcade.snapshot());
    assert.equal(second.selected, "breakout");
    assert.equal(second.paused, false);
    assert.notDeepEqual(second.breakout.ball, first.breakout.ball);

    const bodyAllowed = await page.evaluate(() =>
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    assert.equal(bodyAllowed, true, "the arcade does not hijack page arrows");
    const canvasAllowed = await page
      .locator("#arcade-canvas")
      .evaluate((canvas) =>
        canvas.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "ArrowRight",
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
    assert.equal(canvasAllowed, false, "focused game arrows are consumed");

    fs.mkdirSync(screenshots, { recursive: true });
    await page.screenshot({
      path: path.join(screenshots, "breakout-playing.png"),
      fullPage: true,
    });
    await page.locator("#sheet-arcade .close").click();
    await page.waitForFunction(() => officeArcade.snapshot().paused);
    const closed = await page.evaluate(() => officeArcade.snapshot());
    assert.equal(closed.sheetOpen, false);
    assert.equal(closed.frameActive, false);
  }));

test("Duck Hunt is local, sandboxed, responsive and stopped by lifecycle controls", () =>
  withPage(
    async (page) => {
      const requests = [];
      page.on("request", (request) => requests.push(request.url()));
      await page.route("**/audio/duck-flappingg.mp3", (route) => route.abort());
      await page.evaluate(() => officeArcade.open());
      await page.click("#arcade-game-duck-hunt");
      await page.click("#arcade-duck-start");
      await page.waitForFunction(() => officeArcade.snapshot().duck.ready);
      const frameElement = page.locator("#arcade-duck-frame");
      assert.equal(await frameElement.getAttribute("sandbox"), "allow-scripts");
      const frame = frameElement.contentFrame();
      await frame.locator("#canvas").waitFor({ state: "visible" });
      await frame
        .locator(".loading")
        .waitFor({ state: "hidden", timeout: 6000 });
      assert.equal(await frame.locator("#canvas").getAttribute("width"), "768");
      const canvasBox = await frame.locator("#canvas").boundingBox();
      assert.ok(
        canvasBox.width <= 500,
        "fixed logical canvas scales into the sheet",
      );
      const menuFrame = await frame.locator("#canvas").screenshot();

      // A fresh keyboard path starts the game, targets a real rendered duck,
      // fires through the original collision code, and changes the real score.
      await frame.locator("#canvas").press("Enter");
      await page.waitForTimeout(120);
      assert.equal(
        menuFrame.equals(await frame.locator("#canvas").screenshot()),
        false,
        "Enter starts the first round from a fresh menu",
      );
      const child = page
        .frames()
        .find((item) => item.url().includes("/arcade/duck-hunt/"));
      assert.equal(
        await child.evaluate(() => window.__agentOfficeSlowRafTest),
        true,
        "the real embedded game is running under deliberately slow RAF delivery",
      );
      await child.waitForFunction(
        () =>
          document.getElementById("keyboard-game-status")?.dataset
            .targetReady === "yes",
        null,
        { timeout: 20000 },
      );
      await frame.locator("#canvas").press("t");
      await frame.locator("#canvas").press("Escape");
      await page.waitForFunction(() => officeArcade.snapshot().duck.paused);
      await frame.locator("#canvas").press("Space");
      await frame.locator("#canvas").press("Escape");
      await page.waitForFunction(() => !officeArcade.snapshot().duck.paused);
      await page.waitForTimeout(100);
      assert.equal(
        await frame.locator("#keyboard-score").textContent(),
        "000000",
        "a paused game cannot fire at its frozen duck",
      );
      await frame.locator("#canvas").press("t");
      await frame.locator("#canvas").press("Space");
      await child.waitForFunction(
        () =>
          document.getElementById("keyboard-score")?.textContent !== "000000",
      );
      assert.notEqual(
        await frame.locator("#keyboard-score").textContent(),
        "000000",
      );
      assert.equal(await frame.locator("#keyboard-aim").isVisible(), true);
      await frame.locator("#canvas").press("Escape");
      await page.waitForFunction(() => officeArcade.snapshot().duck.paused);
      assert.equal(
        (await page.evaluate(() => officeArcade.snapshot())).paused,
        true,
      );
      await frame.locator("#canvas").press("Escape");
      await page.waitForFunction(() => !officeArcade.snapshot().duck.paused);

      // Entering an iframe leaves it as the parent document's activeElement,
      // so the child owns the real window-blur stop and reports it to the host.
      await child.evaluate(() => dispatchEvent(new Event("blur")));
      await page.waitForFunction(() => officeArcade.snapshot().duck.paused);
      await page.click("#arcade-pause");
      await page.waitForFunction(() => !officeArcade.snapshot().duck.paused);

      // Restart into a fresh sandbox and exercise real touch input at a scaled
      // mobile viewport. One tap must leave the menu; no two-tap workaround.
      await page.click("#arcade-restart");
      await page.waitForFunction(() => officeArcade.snapshot().duck.ready);
      const touchFrame = page.locator("#arcade-duck-frame").contentFrame();
      await touchFrame
        .locator(".loading")
        .waitFor({ state: "hidden", timeout: 6000 });
      const touchCanvas = touchFrame.locator("#canvas"),
        touchBox = await touchCanvas.boundingBox(),
        touchMenu = await touchCanvas.screenshot();
      await touchCanvas.tap({
        position: {
          x: (384 / 768) * touchBox.width,
          y: (460 / 720) * touchBox.height,
        },
      });
      await page.waitForTimeout(120);
      const startedFrame = await touchCanvas.screenshot();
      assert.equal(
        touchMenu.equals(startedFrame),
        false,
        "one scaled tap leaves the menu and paints the first round",
      );
      assert.equal(
        await touchFrame
          .locator("audio")
          .evaluateAll((audio) => audio.every((item) => item.muted)),
        true,
        "embedded audio follows the default muted office preference",
      );

      fs.mkdirSync(screenshots, { recursive: true });
      await page.screenshot({
        path: path.join(screenshots, "duck-hunt-playing.png"),
        fullPage: true,
      });
      assert.ok(
        requests
          .filter((url) => /duck-hunt/.test(url))
          .every((url) => url.startsWith(baseURL + "/arcade/duck-hunt/")),
        "Duck Hunt loads only vendored local game resources",
      );

      await page.click("#arcade-pause");
      assert.equal(
        (await page.evaluate(() => officeArcade.snapshot())).duck.paused,
        true,
      );
      await page.locator("#sheet-arcade .close").click();
      await page.waitForFunction(() => officeArcade.snapshot().duck.paused);
      assert.equal(
        (await page.evaluate(() => officeArcade.snapshot())).sheetOpen,
        false,
      );
      await page.evaluate(() => officeArcade.open());
      await page.click("#arcade-exit");
      await page.waitForFunction(() => !officeArcade.snapshot().duck.loaded);
      assert.equal(await page.locator("#arcade-duck-frame").count(), 0);
    },
    { width: 390, height: 844 },
    { hasTouch: true, isMobile: true },
    () => {
      if (!location.pathname.endsWith("/arcade/duck-hunt/index.html")) return;
      window.__agentOfficeSlowRafTest = true;
      const nativeRequestAnimationFrame = requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) =>
        nativeRequestAnimationFrame((time) =>
          setTimeout(() => callback(time), 42),
        );
    },
  ));
