const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { observerFixture } = require("./observer-fixture.cjs");
const ready = (page) =>
  page.waitForFunction(
    () =>
      window.officeStudio?.ready &&
      !officeStudio.loading &&
      window.officeStudioTools?.frames,
  );
const ledger = (s) => ({
  progress: s.progress,
  usage: s.usage,
  events: s.events,
  received: s.tracking.received,
});

test("in-place recovery keeps drafts, panel, focus and one wrapper set", async () => {
  await observerFixture({}, async ({ page, state }) => {
    await ready(page);
    assert.equal(
      await page.evaluate(() => typeof officeStudio.reload),
      "function",
    );
    await page.route("**/studio-3.png", (r) =>
      r.fulfill({ status: 404, body: "missing" }),
    );
    await page.evaluate(() => officeStudio.reload());
    await page.waitForFunction(() => officeStudio.source === "fallback");
    await page.click("#settingsbtn");
    await page.fill("#room-name-input", "Unsaved studio name");
    await page.selectOption("#studio-pet-0", "4");
    await page.evaluate(() => {
      window.__sameDocument = true;
    });
    const before = ledger(await state());
    await page.unroute("**/studio-3.png");
    await page.click("#studio-art-retry");
    await ready(page);
    assert.equal(await page.evaluate(() => window.__sameDocument), true);
    assert.equal(
      await page.inputValue("#room-name-input"),
      "Unsaved studio name",
    );
    assert.equal(await page.evaluate(() => opened), "sheet-settings");
    assert.equal(await page.locator(".studio-controls").count(), 1);
    assert.equal(await page.locator("#studio-gallery").count(), 1);
    assert.equal(await page.evaluate(() => officeStudioTools.frames.size), 41);
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "studio-art-status",
    );
    const shared = await page.evaluate(async () => {
      const a = officeStudio.reload(),
        b = officeStudio.reload(),
        same = a === b;
      await Promise.all([a, b]);
      return same;
    });
    assert.equal(shared, true, "Concurrent retries share one request set");
    assert.equal(
      await page.locator("#studio-sprite-choice option").count(),
      238,
    );
    assert.deepEqual(ledger(await state()), before);
  });
});

test("gallery filters, exports a native strip and stops preview when closed", async () => {
  await observerFixture({}, async ({ page, state }) => {
    await ready(page);
    await page.click("#settingsbtn");
    assert.equal(await page.locator("#studio-sprite-search").count(), 1);
    const before = ledger(await state());
    await page.locator("#studio-gallery summary").click();
    await page.selectOption("#studio-sprite-group", "furniture");
    await page.fill("#studio-sprite-search", "fern anim");
    assert.equal(
      await page.locator("#studio-sprite-choice option").count(),
      4,
    );
    await page.selectOption("#studio-sprite-choice", "fern-anim-0");
    assert.match(await page.textContent("#studio-sprite-info"), /26 × 28/);
    assert.match(await page.textContent("#studio-sprite-info"), /4 frames/);
    const download = page.waitForEvent("download");
    await page.click("#studio-strip-download");
    const file = await download,
      bytes = fs.readFileSync(await file.path());
    assert.equal(
      file.suggestedFilename(),
      "agent-office-fern-anim-0-strip.png",
    );
    assert.equal(bytes.readUInt32BE(16), 104);
    assert.equal(bytes.readUInt32BE(20), 28);
    const out = process.env.OFFICE_SCREENSHOTS || "reports/studio-polish";
    fs.mkdirSync(out, { recursive: true });
    fs.copyFileSync(
      await file.path(),
      path.join(out, "fern-watering-strip.png"),
    );
    await page.click("#studio-preview-play");
    await page.waitForFunction(
      () =>
        document.getElementById("studio-sprite-preview").dataset.frame !==
        "fern-anim-0",
    );
    await page.locator("#studio-gallery summary").click();
    assert.equal(
      await page.getAttribute("#studio-preview-play", "aria-pressed"),
      "false",
    );
    await page.locator("#studio-gallery summary").click();
    await page.fill("#studio-sprite-search", "zz-no-match");
    assert.equal(
      await page.locator("#studio-sprite-choice option").count(),
      0,
    );
    assert.equal(await page.isDisabled("#studio-sprite-download"), true);
    assert.equal(await page.isDisabled("#studio-strip-download"), true);
    await page.fill("#studio-sprite-search", "");
    await page.selectOption("#studio-sprite-group", "all");
    for (const viewport of [
      { width: 320, height: 760 },
      { width: 667, height: 320 },
      { width: 1440, height: 960 },
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
        path: path.join(out, "gallery-" + viewport.width + ".png"),
        fullPage: true,
      });
    }
    assert.deepEqual(ledger(await state()), before);
  });
});

test("watering frames retain footprints and enter the actual scene renderer", async () => {
  await observerFixture({}, async ({ page }) => {
    await ready(page);
    const result = await page.evaluate(() => {
      const tools = officeStudioTools,
        s = officeScene,
        old = s.ctx,
        react = s.propReaction;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 100;
      s.ctx = canvas.getContext("2d");
      const records = [],
        draw = s.ctx.drawImage.bind(s.ctx);
      s.ctx.drawImage = (im, ...args) => {
        records.push({
          key: [...tools.frames].find(([, v]) => v === im)?.[0],
          args,
        });
        draw(im, ...args);
      };
      s.propReaction = () => 0.2;
      try {
        s.image("fern", 10, 10, 26, 40);
      } finally {
        s.ctx = old;
        s.propReaction = react;
      }
      return {
        records,
        groups: ["fern", "succulent", "planter"].map((kind) =>
          Array.from({ length: 4 }, (_, i) => {
            const c = tools.frames.get(kind + "-anim-" + i);
            return c ? { w: c.width, h: c.height, data: c.toDataURL() } : null;
          }),
        ),
      };
    });
    assert.match(result.records[0].key, /^fern-anim-/);
    assert.deepEqual(result.records[0].args, [10, 22, 26, 28]);
    for (const group of result.groups) {
      assert.ok(group.every(Boolean));
      assert.equal(new Set(group.map((v) => v.w + ":" + v.h)).size, 1);
      assert.equal(new Set(group.map((v) => v.data)).size, 4);
    }
  });
});
