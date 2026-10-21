const { test } = require("node:test");
const assert = require("node:assert/strict");
const { observerFixture } = require("./observer-fixture.cjs");

test("native coffee and server loops keep fixed footprints, pause, export, and recover independently", async () => {
  await observerFixture({}, async ({ page, state }) => {
    await page.waitForFunction(
      () => officeStudio.ready && !officeStudio.loading,
    );
    assert.equal(
      await page.evaluate(() => officeStudio.workplaceLife?.size),
      8,
    );
    const before = await state();
    const rows = await page.evaluate(() =>
      ["server", "coffee"].map((kind) => {
        const frames = Array.from({ length: 4 }, (_, i) =>
          officeStudio.workplaceLife.get(`${kind}-anim-${i}`),
        );
        const seed = officeStudio.sprites.get(kind);
        const pixels = (c) =>
          Array.from(
            c.getContext("2d").getImageData(0, 0, c.width, c.height).data,
          );
        return {
          kind,
          width: seed.width,
          height: seed.height,
          seed: pixels(seed),
          frames: frames.map((c) => ({
            width: c.width,
            height: c.height,
            pixels: pixels(c),
            png: c.toDataURL(),
          })),
        };
      }),
    );
    for (const row of rows) {
      assert.deepEqual(
        row.frames[0].pixels,
        row.seed,
        row.kind + " idle is the original seed",
      );
      assert.ok(
        new Set(row.frames.map((f) => f.png)).size >= 3,
        row.kind + " distinct generated frames",
      );
      for (const frame of row.frames) {
        assert.equal(frame.width, row.width);
        assert.equal(frame.height, row.height);
      }
    }
    const drawn = await page.evaluate(() => {
      const s = officeScene,
        saved = {
          ctx: s.ctx,
          paused: s.paused,
          time: s.time,
          propHits: s.propHits,
        },
        out = [];
      const c = document.createElement("canvas");
      c.width = c.height = 120;
      try {
        s.ctx = c.getContext("2d");
        s.propHits = [];
        s.ctx.drawImage = (im) =>
          out.push(
            [...officeStudio.workplaceLife].find(([, c]) => c === im)?.[0],
          );
        for (const paused of [false, true]) {
          s.paused = paused;
          s.time = 0.75;
          s.prop("server", 30, 30, 20, 32);
        }
      } finally {
        Object.assign(s, saved);
      }
      return out.filter(Boolean);
    });
    assert.deepEqual(drawn, ["server-anim-3", "server-anim-0"]);
    await page.click("#settingsbtn");
    await page.locator("#studio-gallery summary").click();
    await page.fill("#studio-sprite-search", "coffee anim");
    assert.equal(await page.locator("#studio-sprite-choice option").count(), 4);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#studio-strip-download"),
    ]);
    assert.match(download.suggestedFilename(), /coffee/);
    await page.fill("#room-name-input", "Keep this draft");
    await page.route("**/studio/workplace-life.png", (r) =>
      r.fulfill({ status: 404, body: "missing" }),
    );
    await page.evaluate(() => officeStudio.reload());
    assert.equal(await page.evaluate(() => officeStudio.workplaceLife.size), 0);
    assert.equal(await page.evaluate(() => officeStudio.propLife.size), 8);
    assert.equal(await page.evaluate(() => officeStudio.ready), true);
    await page.unroute("**/studio/workplace-life.png");
    await page.click("#studio-art-retry");
    await page.waitForFunction(
      () => !officeStudio.loading && officeStudio.workplaceLife.size === 8,
    );
    assert.equal(await page.inputValue("#room-name-input"), "Keep this draft");
    const after = await state();
    for (const key of ["events", "usage", "progress"])
      assert.deepEqual(after[key], before[key]);
  });
});
