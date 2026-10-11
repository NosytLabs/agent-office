const { test } = require("node:test");
const assert = require("node:assert/strict");
const { observerFixture } = require("./observer-fixture.cjs");

test("Duck Hunt offers Retry when the iframe document never boots", async () => {
  await observerFixture({}, async ({ page }) => {
    await page.clock.install();
    await page.route("**/arcade/duck-hunt/index.html?*", (route) =>
      route.abort(),
    );
    await page.evaluate(() => officeArcade.open());
    await page.locator("#arcade-game-duck-hunt").click();
    await page.locator("#arcade-duck-start").click();
    await page.clock.fastForward(11000);
    assert.equal(
      (await page.evaluate(() => officeArcade.snapshot())).duck.failed,
      true,
    );
    assert.equal(
      await page.locator("#arcade-duck-start").innerText(),
      "Retry Duck Hunt",
    );
    assert.equal(await page.locator("#arcade-duck-start").isEnabled(), true);
    await page.locator("#arcade-exit").click();
    await page.locator("#arcade-game-snake").click();
    await page.clock.fastForward(11000);
    assert.equal(
      (await page.evaluate(() => officeArcade.snapshot())).selected,
      "snake",
    );
  });
});
