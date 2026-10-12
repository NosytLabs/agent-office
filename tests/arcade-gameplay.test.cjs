/* Regression flows for real user input and incomplete Duck Hunt artwork. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { observerFixture } = require("./observer-fixture.cjs");
const snapshot = (page) => page.evaluate(() => officeArcade.snapshot());
async function openGame(page, game) {
  await page.evaluate(() => officeArcade.open());
  await page.locator(`#arcade-game-${game}`).click();
}

test("Breakout stays paused when movement keys are pressed", async () => {
  await observerFixture({}, async ({ page }) => {
    await openGame(page, "breakout");
    await page.locator("#arcade-start").click();
    await page.locator("#arcade-pause").click();
    const before = await snapshot(page);
    await page.locator("#arcade-canvas").press("ArrowRight");
    assert.equal((await snapshot(page)).paused, true);
    assert.deepEqual((await snapshot(page)).breakout, before.breakout);
    await page.locator("#arcade-pause").click();
    assert.equal((await snapshot(page)).paused, false);
  });
});

test("Duck Hunt does not report ready while a required image is still loading", async () => {
  await observerFixture({}, async ({ page }) => {
    let pending;
    await page.route("**/arcade/duck-hunt/images/dog.png", (route) => {
      pending = route;
    });
    await openGame(page, "duck-hunt");
    await page.locator("#arcade-duck-start").click();
    await page.waitForTimeout(1600);
    assert.ok(pending, "the actual sprite request was intercepted");
    assert.equal((await snapshot(page)).duck.ready, false);
    await pending.continue();
    await page.waitForFunction(() => officeArcade.snapshot().duck.ready);
    assert.equal(
      await page
        .frameLocator("#arcade-duck-frame")
        .locator(".loading")
        .isVisible(),
      false,
    );
  });
});

test("Duck Hunt recovers from a broken image through Retry without reloading the office", async () => {
  await observerFixture({}, async ({ page, state }) => {
    const before = (await state()).progress.xp;
    const pattern = "**/arcade/duck-hunt/images/dog.png";
    await page.route(pattern, (route) => route.abort());
    await openGame(page, "duck-hunt");
    await page.locator("#arcade-duck-start").click();
    await page.waitForFunction(
      () => officeArcade.snapshot().duck.failed,
      null,
      { timeout: 11000 },
    );
    assert.equal(
      await page.locator("#arcade-duck-start").innerText(),
      "Retry Duck Hunt",
    );
    await page.unroute(pattern);
    await page.locator("#arcade-duck-start").click();
    await page.waitForFunction(() => officeArcade.snapshot().duck.ready);
    assert.equal((await snapshot(page)).duck.failed, false);
    assert.equal((await state()).progress.xp, before);
  });
});

test("Snake retains an accepted keyboard turn when focus moves to its direction pad", async () => {
  await observerFixture({}, async ({ page }) => {
    await openGame(page, "snake");
    await page.locator("#arcade-start").click();
    // Both inputs occur before one movement tick. The second turn is rejected,
    // not allowed to erase the already accepted first turn on canvas blur.
    await page.evaluate(() => {
      document
        .getElementById("arcade-canvas")
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
        );
      const left = document.querySelector('[data-snake-turn="left"]');
      left.focus();
      left.click();
    });
    await page.waitForFunction(() => {
      const head = officeArcade.snapshot().snake.body[0];
      return head.x !== 12 || head.y !== 9;
    });
    assert.deepEqual((await snapshot(page)).snake.body[0], { x: 12, y: 8 });
  });
});

test("Duck Hunt times out a stalled image and leaves other games usable", async () => {
  await observerFixture({}, async ({ page }) => {
    await page.route("**/arcade/duck-hunt/images/dog.png", () => {});
    await openGame(page, "duck-hunt");
    await page.locator("#arcade-duck-start").click();
    await page.waitForFunction(
      () => officeArcade.snapshot().duck.failed,
      null,
      { timeout: 11000 },
    );
    assert.equal((await snapshot(page)).duck.ready, false);
    await page.locator("#arcade-exit").click();
    await page.locator("#arcade-game-snake").click();
    await page.locator("#arcade-start").click();
    assert.equal((await snapshot(page)).snake.state, "playing");
    assert.equal((await snapshot(page)).duck.loaded, false);
  });
});

test("Breakout ignores right clicks but left clicks still position its paddle", async () => {
  await observerFixture({}, async ({ page }) => {
    await openGame(page, "breakout");
    await page.locator("#arcade-start").click();
    const playfield = page.locator("#arcade-canvas");
    const before = (await snapshot(page)).breakout.paddleX;
    await playfield.click({ button: "right", position: { x: 20, y: 20 } });
    assert.equal((await snapshot(page)).breakout.paddleX, before);
    await playfield.click({ position: { x: 20, y: 20 } });
    assert.ok((await snapshot(page)).breakout.paddleX < before);
  });
});

test("Duck Hunt ignores right-clicking Start; Enter still starts a round", async () => {
  await observerFixture({}, async ({ page }) => {
    await openGame(page, "duck-hunt");
    await page.locator("#arcade-duck-start").click();
    await page.waitForFunction(() => officeArcade.snapshot().duck.ready);
    const child = page
      .frames()
      .find((frame) => frame.url().includes("/arcade/duck-hunt/"));
    const playfield = child.locator("#canvas");
    await child.waitForFunction(
      () => !document.querySelector(".loading").classList.contains("visible"),
    );
    // Let the explicit host resume paint before observing original draw calls.
    await child.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await child.evaluate(() => {
      window.roundWasDrawn = false;
      const original = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
        if (text === "ROUND") window.roundWasDrawn = true;
        return original.call(this, text, ...args);
      };
    });
    const box = await playfield.boundingBox();
    await playfield.click({
      button: "right",
      position: { x: box.width / 2, y: (box.height * 460) / 720 },
    });
    await page.waitForTimeout(120);
    assert.equal(
      await child.evaluate(() => window.roundWasDrawn),
      false,
      "secondary input must leave the menu unchanged",
    );
    await playfield.press("Enter");
    await page.waitForTimeout(120);
    assert.equal(
      await child.evaluate(() => window.roundWasDrawn),
      true,
      "Enter still starts the actual upstream game",
    );
  });
});

test("Snake keeps the first finger's swipe when another finger touches the canvas", async () => {
  await observerFixture({}, async ({ page }) => {
    await openGame(page, "snake");
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    await page.locator("#arcade-start").click();
    const box = await page.locator("#arcade-canvas").boundingBox();
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send("Emulation.setTouchEmulationEnabled", {
        enabled: true,
        maxTouchPoints: 5,
      });
      const first = { id: 1, x: box.x + 100, y: box.y + 150 };
      const second = { id: 2, x: box.x + 180, y: box.y + 150 };
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [first],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [first, second],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ ...first, y: first.y - 80 }, second],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [second],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await page.clock.runFor(500);
      assert.deepEqual((await snapshot(page)).snake.body[0], { x: 12, y: 8 });
    } finally {
      await cdp.detach();
    }
  });
});

test("Duck Hunt Pause stays paused when iframe blur arrives before mouse release", async () => {
  await observerFixture({}, async ({ page }) => {
    await openGame(page, "duck-hunt");
    await page.locator("#arcade-duck-start").click();
    await page.waitForFunction(() => officeArcade.snapshot().duck.ready);
    const child = page
      .frames()
      .find((frame) => frame.url().includes("/arcade/duck-hunt/"));
    const canvas = child.locator("#canvas");
    await canvas.press("Enter");
    await page.waitForTimeout(120);
    const pause = page.locator("#arcade-pause");
    await pause.scrollIntoViewIfNeeded();
    const box = await pause.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // Focus leaves the sandbox on press, before a human releases the button.
    await page.waitForFunction(() => officeArcade.snapshot().duck.paused);
    await page.mouse.up();
    await page.waitForTimeout(100);
    assert.equal((await snapshot(page)).paused, true);
    assert.equal((await snapshot(page)).duck.paused, true);
    const frozen = await canvas.screenshot();
    await page.waitForTimeout(120);
    assert.ok(
      frozen.equals(await canvas.screenshot()),
      "the actual game canvas freezes",
    );
    await pause.click();
    await page.waitForFunction(() => !officeArcade.snapshot().duck.paused);
    assert.equal((await snapshot(page)).paused, false);
  });
});
