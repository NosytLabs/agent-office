const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { observerFixture } = require("./observer-fixture.cjs");

async function ready(page) {
  await page.waitForFunction(
    () => window.officeStudio?.ready && !officeStudio.loading,
  );
  assert.equal(
    await page.evaluate(() => officeStudio.directionalReady),
    true,
    await page.evaluate(() => officeStudio.directionalError),
  );
}
const accounting = (state) => ({
  progress: state.progress,
  usage: state.usage,
  events: state.events,
});

test("all eight character looks have grounded, distinct directional walking frames", async () => {
  await observerFixture({}, async ({ page }) => {
    await ready(page);
    const inventory = await page.evaluate(() => {
      const groups = [];
      for (let actor = 0; actor < 8; actor++) {
        const directions = [];
        for (const direction of ["up", "down", "left", "right"]) {
          const frames = ["idle", "walk-a", "walk-b"].map((pose) => {
            const canvas = officeStudio.directional.get(
              `person-${actor}-${direction}-${pose}`,
            );
            const rgba = canvas
              .getContext("2d")
              .getImageData(0, 0, 32, 36).data;
            let bottom = -1,
              top = 36;
            for (let i = 3; i < rgba.length; i += 4)
              if (rgba[i] > 160) {
                bottom = Math.max(bottom, Math.floor(i / 4 / 32));
                top = Math.min(top, Math.floor(i / 4 / 32));
              }
            return {
              width: canvas.width,
              height: canvas.height,
              bottom,
              top,
              pixels: canvas.toDataURL(),
            };
          });
          directions.push(frames);
        }
        groups.push(directions);
      }
      return { count: officeStudio.directional.size, groups };
    });
    assert.equal(inventory.count, 96);
    for (const group of inventory.groups) {
      assert.equal(
        new Set(group.map((direction) => direction[0].pixels)).size,
        4,
      );
      for (const direction of group) {
        assert.equal(new Set(direction.map((frame) => frame.pixels)).size, 3);
        assert.ok(
          direction.every(
            (frame) =>
              frame.width === 32 &&
              frame.height === 36 &&
              frame.bottom === 34 &&
              frame.top >= 4,
          ),
        );
      }
    }
  });
});

test("the room draws the selected direction and freezes walking without changing accounting", async () => {
  await observerFixture({}, async ({ page, state }) => {
    await ready(page);
    const before = accounting(await state());
    const drawn = await page.evaluate(() => {
      const scene = officeScene,
        original = scene.ctx,
        paused = scene.paused;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 180;
      scene.ctx = canvas.getContext("2d");
      const draw = scene.ctx.drawImage.bind(scene.ctx),
        selected = [];
      scene.ctx.drawImage = (image, ...args) => {
        const key = [...officeStudio.directional].find(
          ([, source]) => source === image,
        )?.[0];
        if (key) selected.push({ key, transform: scene.ctx.getTransform().a });
        return draw(image, ...args);
      };
      try {
        scene.paused = false;
        for (const dir of ["up", "down", "left", "right"])
          scene.character(
            { id: "directional-render", status: "idle" },
            60,
            60,
            { moving: true, dir, distance: 6 },
          );
        scene.paused = true;
        scene.character({ id: "directional-render", status: "idle" }, 60, 60, {
          moving: true,
          dir: "up",
          distance: 6,
        });
      } finally {
        scene.ctx = original;
        scene.paused = paused;
      }
      return selected;
    });
    assert.equal(drawn.length, 5);
    for (const [index, direction] of [
      "up",
      "down",
      "left",
      "right",
    ].entries()) {
      assert.match(drawn[index].key, new RegExp(`-${direction}-walk-b$`));
      assert.equal(
        drawn[index].transform,
        1,
        "Generated left views are not mirrored again",
      );
    }
    assert.match(drawn[4].key, /-up-idle$/);
    assert.deepEqual(accounting(await state()), before);
  });
});

test("directional frames export a real native strip and remain usable on mobile", async () => {
  await observerFixture({}, async ({ page, state }) => {
    await ready(page);
    const before = accounting(await state());
    await page.click("#settingsbtn");
    await page.locator("#studio-gallery summary").click();
    await page.selectOption("#studio-sprite-group", "characters");
    await page.fill("#studio-sprite-search", "person 0 up");
    assert.equal(await page.locator("#studio-sprite-choice option").count(), 3);
    await page.selectOption("#studio-sprite-choice", "person-0-up-idle");
    const downloading = page.waitForEvent("download");
    await page.click("#studio-strip-download");
    const download = await downloading;
    assert.equal(
      download.suggestedFilename(),
      "agent-office-person-0-up-idle-strip.png",
    );
    const png = fs.readFileSync(await download.path());
    assert.equal(png.readUInt32BE(16), 128);
    assert.equal(png.readUInt32BE(20), 36);
    const directory =
      process.env.OFFICE_SCREENSHOTS || "reports/studio-directional";
    fs.mkdirSync(directory, { recursive: true });
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: width === 320 ? 760 : 1000 });
      await page.locator("#studio-sprite-preview").scrollIntoViewIfNeeded();
      assert.equal(
        await page
          .locator("#sheet-settings")
          .evaluate((element) => element.scrollWidth > element.clientWidth),
        false,
      );
      await page.screenshot({
        path: path.join(directory, `directional-gallery-${width}.png`),
        fullPage: true,
      });
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    const stillFrame = await page
      .locator("#studio-sprite-preview")
      .getAttribute("data-frame");
    await page.click("#studio-preview-play");
    assert.equal(
      await page.locator("#studio-preview-play").getAttribute("aria-pressed"),
      "false",
    );
    assert.match(
      await page.locator("#studio-gallery-message").textContent(),
      /paused/,
    );
    await page.waitForTimeout(550);
    assert.equal(
      await page.locator("#studio-sprite-preview").getAttribute("data-frame"),
      stillFrame,
    );
    assert.deepEqual(accounting(await state()), before);
  });
});

test("missing directional artwork keeps the base set and retries without losing a draft", async () => {
  await observerFixture({}, async ({ page, state }) => {
    await ready(page);
    await page.route("**/studio/directional.png", (route) =>
      route.fulfill({ status: 404, body: "missing" }),
    );
    await page.reload();
    await page.waitForFunction(
      () =>
        window.officeStudio?.ready &&
        !officeStudio.loading &&
        !officeStudio.directionalReady,
    );
    assert.equal(await page.evaluate(() => officeStudio.sprites.size), 197);
    await page.click("#settingsbtn");
    await page.fill("#room-name-input", "Unsaved directional draft");
    assert.equal(await page.locator("#studio-art-retry").isVisible(), true);
    const before = accounting(await state());
    await page.evaluate(() => {
      window.__directionalDocument = true;
    });
    await page.unroute("**/studio/directional.png");
    await page.click("#studio-art-retry");
    await ready(page);
    assert.equal(await page.evaluate(() => window.__directionalDocument), true);
    assert.equal(
      await page.inputValue("#room-name-input"),
      "Unsaved directional draft",
    );
    assert.equal(await page.locator("#studio-art-retry").isHidden(), true);
    assert.equal(
      await page.locator("#studio-sprite-choice option").count(),
      434,
    );
    assert.deepEqual(accounting(await state()), before);
  });
});
