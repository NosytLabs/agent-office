const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { observerFixture } = require("./observer-fixture.cjs");

test("vacant desks and connection guidance keep desktop, phone and short floors usable", async () => {
  await observerFixture(
    { settings: { max_chars: 4 } },
    async ({ page, state }) => {
      await page.waitForFunction(
        () => officeStudio.ready && !officeStudio.loading,
      );
      const before = await state();
      fs.mkdirSync("reports/scene-repair", { recursive: true });
      for (const [name, width, height] of [
        ["desktop", 1440, 1000],
        ["phone", 390, 844],
        ["short", 601, 768],
        ["landscape", 844, 390],
      ]) {
        await page.setViewportSize({ width, height });
        await page.waitForFunction(
          () =>
            officeScene.grid.workstations.length ===
            (officeScene.canvas.clientWidth < 600 ? 2 : 4),
        );
        const geometry = await page.evaluate(() => {
          officeScene.draw(0);
          const rect = (id) =>
            document.getElementById(id).getBoundingClientRect().toJSON();
          return {
            stage: rect("stage"),
            card: rect("empty-state"),
            seats: officeScene.grid.seats.length,
            actors: officeScene.chars.size,
            hits: officeScene.hitBoxes.length,
            labels: officeScene.labelBoxes.length,
            overflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
        assert.equal(geometry.seats, 0);
        assert.equal(geometry.actors, 0);
        assert.equal(geometry.hits, 0);
        assert.equal(geometry.labels, 0);
        assert.equal(geometry.overflow, false);
        assert.ok(geometry.card.top >= geometry.stage.bottom);
        await page.screenshot({
          path: `reports/scene-repair/empty-${name}.png`,
          fullPage: true,
        });
        await page.click("#empty-connect");
        assert.equal(await page.locator("#sheet-setup").isVisible(), true);
        await page.keyboard.press("Escape");
      }
      await page.setViewportSize({ width: 568, height: 320 });
      await page.click("#room-view-toggle");
      const compact = await page.evaluate(() => ({
        floor: document.getElementById("stage").getBoundingClientRect().height,
        guidance: document.getElementById("empty-state").getBoundingClientRect()
          .height,
      }));
      assert.ok(compact.floor >= 80);
      assert.ok(
        compact.guidance <= 60,
        "A short room view keeps compact connection guidance",
      );
      await page.screenshot({
        path: "reports/scene-repair/empty-room-view.png",
        fullPage: true,
      });
      await page.click("#empty-connect");
      assert.equal(await page.locator("#sheet-setup").isVisible(), true);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      const after = await state();
      for (const key of ["agents", "settings", "events", "usage", "progress"])
        assert.deepEqual(after[key], before[key]);
    },
  );
});

test("generated lounge loops preserve seed footprints, pause, lighting, gallery and retry", async () => {
  await observerFixture({}, async ({ page, state }) => {
    await page.waitForFunction(
      () => officeStudio.ready && !officeStudio.loading,
    );
    const before = await state();
    assert.equal(await page.evaluate(() => officeStudio.loungeLife.size), 8);
    const rows = await page.evaluate(() =>
      ["lamp", "terrarium"].map((kind) => {
        const seed = officeStudio.sprites.get(kind),
          frames = Array.from({ length: 4 }, (_, i) =>
            officeStudio.loungeLife.get(`${kind}-anim-${i}`),
          );
        const pixels = (c) =>
          Array.from(
            c.getContext("2d").getImageData(0, 0, c.width, c.height).data,
          );
        return {
          kind,
          seed: pixels(seed),
          size: [seed.width, seed.height],
          frames: frames.map((c) => ({
            size: [c.width, c.height],
            pixels: pixels(c),
            png: c.toDataURL(),
          })),
        };
      }),
    );
    for (const row of rows) {
      assert.deepEqual(row.frames[0].pixels, row.seed);
      assert.ok(
        new Set(row.frames.map((f) => f.png)).size >= 3,
        row.kind + " generated frames are distinct",
      );
      for (const frame of row.frames) {
        assert.deepEqual(frame.size, row.size);
        assert.deepEqual(
          frame.pixels.filter((_, i) => i % 4 === 3),
          row.seed.filter((_, i) => i % 4 === 3),
          row.kind + " keeps the exact silhouette without holes",
        );
      }
    }
    const drawn = await page.evaluate(() => {
      const s = officeScene,
        saved = {
          ctx: s.ctx,
          time: s.time,
          paused: s.paused,
          settings: s.settings,
        },
        out = [];
      const c = document.createElement("canvas");
      c.width = c.height = 100;
      try {
        s.ctx = c.getContext("2d");
        s.ctx.drawImage = (im) =>
          out.push(
            [...officeStudioTools.frames].find(([, c]) => c === im)?.[0],
          );
        s.time = 0.75;
        for (const [paused, lights] of [
          [false, true],
          [true, true],
          [false, false],
        ]) {
          s.paused = paused;
          s.settings = { ...saved.settings, room_lights: lights };
          s.image("lamp", 30, 30, 12, 30);
        }
      } finally {
        Object.assign(s, saved);
      }
      return out;
    });
    assert.deepEqual(drawn, ["lamp-anim-3", "lamp-anim-0", "lamp-off"]);
    await page.click("#settingsbtn");
    await page.locator("#studio-gallery summary").click();
    await page.fill("#studio-sprite-search", "terrarium anim");
    assert.equal(await page.locator("#studio-sprite-choice option").count(), 4);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#studio-strip-download"),
    ]);
    assert.match(download.suggestedFilename(), /terrarium/);
    await page.fill("#room-name-input", "Keep lounge draft");
    await page.route("**/studio/lounge-life.png*", (r) =>
      r.fulfill({ status: 404, body: "missing" }),
    );
    await page.evaluate(() => officeStudio.reload());
    assert.equal(await page.evaluate(() => officeStudio.loungeLife.size), 0);
    assert.equal(await page.evaluate(() => officeStudio.workplaceLife.size), 8);
    assert.equal(await page.evaluate(() => officeStudio.ready), true);
    await page.unroute("**/studio/lounge-life.png*");
    await page.click("#studio-art-retry");
    await page.waitForFunction(
      () => !officeStudio.loading && officeStudio.loungeLife.size === 8,
    );
    assert.equal(
      await page.inputValue("#room-name-input"),
      "Keep lounge draft",
    );
    const after = await state();
    for (const key of ["agents", "settings", "events", "usage", "progress"])
      assert.deepEqual(after[key], before[key]);
  });
});
