const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { observerFixture } = require("./observer-fixture.cjs");
async function ready(page) {
  await page.waitForFunction(
    () => window.officeStudio?.ready && window.officeStudioTools?.frames,
  );
}
test("mirrored characters keep crowns above the same head and animation variants preserve dimensions", async () => {
  await observerFixture({}, async ({ page }) => {
    await ready(page);
    const crown = await page.evaluate(() => {
      const s = officeScene,
        old = s.ctx,
        cosmetics = s.cosmetics;
      const c = document.createElement("canvas");
      c.width = c.height = 180;
      s.ctx = c.getContext("2d");
      s.cosmetics = ["crown"];
      const g = s.ctx,
        draw = g.drawImage.bind(g),
        positions = [];
      g.drawImage = (im, ...args) => {
        if (im === officeStudio.sprites.get("icon-crown")) {
          const t = g.getTransform(),
            px = args[0] + args[2] / 2,
            py = args[1];
          positions.push({
            x: t.a * px + t.c * py + t.e,
            y: t.b * px + t.d * py + t.f,
          });
        }
        draw(im, ...args);
      };
      try {
        for (const dir of ["right", "left"])
          s.character({ id: "crown-test", status: "idle" }, 60, 60, {
            moving: true,
            dir,
            distance: 3,
          });
      } finally {
        s.ctx = old;
        s.cosmetics = cosmetics;
      }
      return positions;
    });
    assert.deepEqual(crown, [
      { x: 68, y: 54 },
      { x: 68, y: 54 },
    ]);
    const frames = await page.evaluate(() => ({
      count: officeStudioTools.frames.size,
      groups: officeStudioTools.kinds.map((kind) =>
        Array.from({ length: 4 }, (_, i) => {
          const c = officeStudioTools.frames.get(kind + "-anim-" + i);
          return c ? { w: c.width, h: c.height, png: c.toDataURL() } : null;
        }),
      ),
    }));
    assert.equal(frames.count, 29);
    for (const group of frames.groups) {
      assert.ok(group.every(Boolean));
      assert.equal(new Set(group.map((f) => f.w + ":" + f.h)).size, 1);
      assert.equal(new Set(group.map((f) => f.png)).size, 4);
    }
  });
});
test("failed artwork offers an explicit reload recovery without clearing saved view choices", async () => {
  await observerFixture({}, async ({ page, state }) => {
    await ready(page);
    await page.click("#settingsbtn");
    await page.selectOption("#studio-pet-0", "4");
    await page.route("**/studio-3.png", (r) =>
      r.fulfill({ status: 404, body: "missing" }),
    );
    await page.reload();
    await page.waitForFunction(
      () =>
        window.officeStudio?.source === "fallback" &&
        document.getElementById("studio-art-retry"),
    );
    await page.click("#settingsbtn");
    const retry = page.locator("#studio-art-retry");
    assert.equal(await retry.isVisible(), true);
    const before = await state();
    await page.unroute("**/studio-3.png");
    await Promise.all([page.waitForEvent("load"), retry.click()]);
    await ready(page);
    assert.equal(await page.evaluate(() => officeStudio.prefs.pets[0]), 4);
    const after = await state();
    assert.deepEqual(after.progress, before.progress);
    assert.deepEqual(after.usage, before.usage);
    assert.deepEqual(after.events, before.events);
    assert.equal(await page.locator("#studio-art-retry").isHidden(), true);
  });
});
test("companion labels match their look and a native sprite exports on mobile without accounting changes", async () => {
  await observerFixture({}, async ({ page, state }) => {
    await ready(page);
    const before = await state();
    await page.click("#settingsbtn");
    await page.selectOption("#studio-pet-0", "4");
    assert.equal(
      await page.locator('label[for="pet-cat1-name"]').textContent(),
      "Corgi",
    );
    assert.equal(
      await page.locator('[data-activity="Pet the orange cat"]').textContent(),
      "Pet the Corgi",
    );
    await page.evaluate(() => officeRoom.sync());
    assert.equal(
      await page.locator('label[for="pet-cat1-name"]').textContent(),
      "Corgi",
    );
    await page.locator("#studio-gallery summary").click();
    await page.selectOption("#studio-sprite-choice", "robot-anim-2");
    const download = page.waitForEvent("download");
    await page.click("#studio-sprite-download");
    const file = await download;
    assert.equal(file.suggestedFilename(), "agent-office-robot-anim-2.png");
    const bytes = fs.readFileSync(await file.path());
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    assert.equal(bytes.readUInt32BE(16), 18);
    assert.equal(bytes.readUInt32BE(20), 28);
    const folder = process.env.OFFICE_SCREENSHOTS || "reports/studio-tools";
    fs.mkdirSync(folder, { recursive: true });
    for (const viewport of [
      { width: 320, height: 760 },
      { width: 667, height: 320 },
    ]) {
      await page.setViewportSize(viewport);
      await page.locator("#studio-sprite-download").scrollIntoViewIfNeeded();
      assert.equal(
        await page
          .locator("#sheet-settings")
          .evaluate((e) => e.scrollWidth > e.clientWidth),
        false,
      );
      await page.screenshot({
        path: path.join(folder, "sprite-gallery-" + viewport.width + ".png"),
        fullPage: true,
      });
    }
    await page.selectOption("#studio-art-choice", "classic");
    assert.equal(
      await page.locator('label[for="pet-cat1-name"]').textContent(),
      "Orange cat",
    );
    const after = await state();
    assert.deepEqual(after.progress, before.progress);
    assert.deepEqual(after.usage, before.usage);
    assert.deepEqual(after.events, before.events);
  });
});
