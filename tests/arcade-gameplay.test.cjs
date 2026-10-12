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
