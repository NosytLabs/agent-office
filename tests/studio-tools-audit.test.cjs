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

for (const viewport of [
  { width: 320, height: 568 },
  { width: 667, height: 320 },
])
  test(`starting a sprite animation keeps its preview and Stop control visible at ${viewport.width}px`, async () => {
    await observerFixture({ viewport }, async ({ page }) => {
      await gallery(page);
      await page.fill("#studio-sprite-search", "studio robot reading");
      await page.selectOption("#studio-sprite-choice", "person-4-read-anim-2");
      await page.click("#studio-preview-play");
      const geometry = await page.evaluate(() => {
        const panel = document.getElementById("sheet-settings"),
          header = panel.querySelector(".sheet-header").getBoundingClientRect(),
          bounds = panel.getBoundingClientRect();
        return ["studio-sprite-preview", "studio-preview-play"].map((id) => {
          const rect = document.getElementById(id).getBoundingClientRect();
          return {
            id,
            top: rect.top,
            bottom: rect.bottom,
            header: header.bottom,
            panel: bounds.bottom,
          };
        });
      });
      for (const rect of geometry) {
        assert.ok(rect.top >= rect.header, JSON.stringify(rect));
        assert.ok(rect.bottom <= rect.panel, JSON.stringify(rect));
      }
      assert.equal(
        await page.locator("#studio-preview-play").getAttribute("aria-pressed"),
        "true",
      );
      await page.click("#studio-preview-play");
      assert.equal(
        await page.locator("#studio-preview-play").getAttribute("aria-pressed"),
        "false",
      );
    });
  });

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

test("gallery searches use companion identity and expose friendly accessible labels", async () => {
  await observerFixture(
    { viewport: { width: 320, height: 760 } },
    async ({ page }) => {
      await gallery(page);
      for (const pet of [0, 1, 2, 3]) {
        await page.fill("#studio-sprite-search", `pet ${pet} happy anim`);
        assert.equal(
          await page.locator("#studio-sprite-choice option").count(),
          4,
        );
        assert.ok(
          (
            await page
              .locator("#studio-sprite-choice option")
              .evaluateAll((options) => options.map((option) => option.value))
          ).every((key) => key.startsWith(`pet-${pet}-happy-anim-`)),
        );
      }
      await page.fill("#studio-sprite-search", "orange cat happy anim");
      assert.equal(
        await page.locator("#studio-sprite-choice option").count(),
        4,
      );
      await page.selectOption("#studio-sprite-choice", "pet-0-happy-anim-2");
      assert.match(
        await page
          .locator("#studio-sprite-choice option:checked")
          .textContent(),
        /Orange cat.*Happy.*frame 3/i,
      );
      assert.match(
        await page.locator("#studio-sprite-preview").getAttribute("aria-label"),
        /Orange cat.*Happy.*frame 3/i,
      );
      await page.fill("#studio-sprite-search", "orange cat happy frame 3");
      assert.equal(
        await page.locator("#studio-sprite-choice option").count(),
        1,
      );
      assert.equal(
        await page.inputValue("#studio-sprite-choice"),
        "pet-0-happy-anim-2",
      );
      const download = page.waitForEvent("download");
      await page.click("#studio-sprite-download");
      assert.equal(
        (await download).suggestedFilename(),
        "agent-office-pet-0-happy-anim-2.png",
      );
      await page.fill("#studio-sprite-search", "studio robot reading");
      await page.selectOption("#studio-sprite-choice", "person-4-read");
      assert.match(
        await page
          .locator("#studio-sprite-choice option:checked")
          .textContent(),
        /Studio robot.*Reading/,
      );
      await page.fill("#studio-sprite-search", "no-such-sprite");
      for (const id of [
        "studio-preview-play",
        "studio-sprite-download",
        "studio-strip-download",
      ])
        assert.equal(await page.locator("#" + id).isDisabled(), true);
      assert.equal(
        await page.locator("#studio-sprite-preview").getAttribute("aria-label"),
        "No matching sprites",
      );
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "studio-sprite-search",
      );
      await page.keyboard.press("Shift+Tab");
      assert.equal(
        await page
          .locator("#studio-gallery summary")
          .evaluate((summary) => document.activeElement === summary),
        true,
      );
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "studio-sprite-search",
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    },
  );
});

test("character life families export native strips and leave no stale choices after optional failure", async () => {
  const fs = require("node:fs");
  await observerFixture({}, async ({ page, state }) => {
    await gallery(page);
    const before = await state(),
      total = await page.locator("#studio-sprite-choice option").count(),
      lifeCount = await page.evaluate(() => officeStudio.characterLife.size);
    for (const query of [
      "person 0 typing anim",
      "person 7 reading anim",
      "person 4 needs input anim",
    ]) {
      await page.fill("#studio-sprite-search", query);
      assert.equal(
        await page.locator("#studio-sprite-choice option").count(),
        4,
        query,
      );
    }
    await page.fill("#studio-sprite-search", "person 7 reading anim");
    await page.selectOption("#studio-sprite-choice", "person-7-read-anim-2");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#studio-strip-download"),
    ]);
    assert.equal(
      download.suggestedFilename(),
      "agent-office-person-7-read-anim-2-strip.png",
    );
    const bytes = fs.readFileSync(await download.path());
    assert.equal(bytes.readUInt32BE(16), 128);
    assert.equal(bytes.readUInt32BE(20), 36);
    assert.equal(
      await page.evaluate(async (base64) => {
        const image = new Image();
        image.src = "data:image/png;base64," + base64;
        await image.decode();
        const strip = document.createElement("canvas"),
          expected = document.createElement("canvas");
        strip.width = expected.width = 128;
        strip.height = expected.height = 36;
        strip.getContext("2d").drawImage(image, 0, 0);
        for (let frame = 0; frame < 4; frame++)
          expected
            .getContext("2d")
            .drawImage(
              officeStudio.characterLife.get(`person-7-read-anim-${frame}`),
              frame * 32,
              0,
            );
        const actual = strip.getContext("2d").getImageData(0, 0, 128, 36).data,
          source = expected.getContext("2d").getImageData(0, 0, 128, 36).data;
        return actual.every((value, index) => value === source[index]);
      }, bytes.toString("base64")),
      true,
    );
    await page.fill("#room-name-input", "Unsaved character gallery draft");
    await page.route("**/studio/character-life.png", (route) =>
      route.fulfill({ status: 404, body: "missing" }),
    );
    await page.evaluate(() => officeStudio.reload());
    assert.equal(await page.locator("#studio-sprite-choice option").count(), 0);
    assert.equal(
      await page.locator("#studio-sprite-download").isDisabled(),
      true,
    );
    await page.fill("#studio-sprite-search", "");
    assert.equal(
      await page.locator("#studio-sprite-choice option").count(),
      total - lifeCount,
    );
    await page.unroute("**/studio/character-life.png");
    await page.click("#studio-art-retry");
    await page.waitForFunction(
      () => officeStudio.ready && !officeStudio.loading,
    );
    assert.equal(
      await page.locator("#studio-sprite-choice option").count(),
      total,
    );
    assert.equal(
      await page.inputValue("#room-name-input"),
      "Unsaved character gallery draft",
    );
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "studio-art-status",
    );
    const after = await state();
    for (const key of ["progress", "usage", "events"])
      assert.deepEqual(after[key], before[key]);
  });
});
