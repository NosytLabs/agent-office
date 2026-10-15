const { test } = require("node:test");
const assert = require("node:assert/strict");
const { observerFixture } = require("./observer-fixture.cjs");

async function gallery(page) {
  await page.waitForFunction(
    () =>
      window.officeStudioTools &&
      window.officeStudio?.ready &&
      !officeStudio.loading,
  );
  await page.click("#settingsbtn");
  await page.locator("#studio-gallery summary").click();
}

test("an older sprite export cannot overwrite feedback for the selected export", async () => {
  await observerFixture({}, async ({ page }) => {
    await gallery(page);
    await page.selectOption("#studio-sprite-choice", "person-0-down-idle");
    await page.evaluate(() => {
      window.__exports = [];
      window.__downloadNames = [];
      HTMLCanvasElement.prototype.toBlob = function (callback) {
        window.__exports.push(callback);
      };
      downloadBlob = (blob, name) => window.__downloadNames.push(name);
    });
    await page.click("#studio-sprite-download");
    await page.selectOption("#studio-sprite-choice", "person-0-down-walk-a");
    await page.click("#studio-sprite-download");
    await page.evaluate(() =>
      window.__exports[1](new Blob(["fixture"], { type: "image/png" })),
    );
    const message = await page.textContent("#studio-gallery-message");
    assert.match(message, /exported/);
    await page.evaluate(() => window.__exports[0](null));
    assert.equal(await page.textContent("#studio-gallery-message"), message);
    assert.deepEqual(await page.evaluate(() => window.__downloadNames), [
      "agent-office-person-0-down-walk-a.png",
    ]);
    await page.click("#studio-sprite-download");
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.__exports[2](null));
    assert.equal(await page.textContent("#studio-gallery-message"), message);
    await page.click("#settingsbtn");
    await page.click("#studio-sprite-download");
    await page.keyboard.press("Escape");
    await page.click("#settingsbtn");
    await page.evaluate(() => window.__exports[3](null));
    assert.equal(await page.textContent("#studio-gallery-message"), message);
    await page.click("#studio-sprite-download");
    await page.locator("#studio-gallery summary").click();
    await page.locator("#studio-gallery summary").click();
    await page.evaluate(() => window.__exports[4](null));
    assert.equal(await page.textContent("#studio-gallery-message"), message);
  });
});

test("the gallery distinguishes opaque room textures from transparent sprite exports", async () => {
  await observerFixture({}, async ({ page }) => {
    await gallery(page);
    await page.selectOption("#studio-sprite-choice", "surface-oak-floor");
    assert.match(await page.textContent("#studio-sprite-info"), /opaque PNG/);
    await page.selectOption("#studio-sprite-choice", "person-0-down-idle");
    assert.match(
      await page.textContent("#studio-sprite-info"),
      /transparent PNG/,
    );
  });
});
