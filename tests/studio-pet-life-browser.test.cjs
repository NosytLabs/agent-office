const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { observerFixture } = require("./observer-fixture.cjs");

async function ready(page) {
  await page.waitForFunction(
    () =>
      window.officeStudio?.ready &&
      !officeStudio.loading &&
      window.officeStudioTools,
  );
  assert.equal(await page.evaluate(() => officeStudio.environmentError), "");
  assert.equal(await page.evaluate(() => officeStudio.petLife.size), 96);
}
const accounting = (s) => ({
  progress: s.progress,
  usage: s.usage,
  events: s.events,
  received: s.tracking.received,
});

test("all eight companion life looks have distinct grounded native animation frames", async () => {
  await observerFixture({}, async ({ page }) => {
    await ready(page);
    const groups = await page.evaluate(() =>
      Array.from({ length: 8 }, (_, pet) =>
        ["idle", "sleep", "happy"].map((family) =>
          Array.from({ length: 4 }, (_, n) => {
            const key = `pet-${pet}-${family}-anim-${n}`,
              c = officeStudio.petLife.get(key),
              d = c.getContext("2d").getImageData(0, 0, 28, 26).data;
            let left = 28,
              right = -1,
              top = 26,
              bottom = -1;
            for (let i = 3; i < d.length; i += 4)
              if (d[i] >= 160) {
                const x = ((i - 3) / 4) % 28,
                  y = Math.floor((i - 3) / 4 / 28);
                left = Math.min(left, x);
                right = Math.max(right, x);
                top = Math.min(top, y);
                bottom = Math.max(bottom, y);
              }
            return {
              key,
              width: c.width,
              height: c.height,
              left,
              right,
              top,
              bottom,
              png: c.toDataURL(),
            };
          }),
        ),
      ),
    );
    for (const pet of groups)
      for (const family of pet) {
        assert.equal(new Set(family.map((f) => f.png)).size, 4, family[0].key);
        for (const f of family) {
          assert.equal(f.width, 28, f.key);
          assert.equal(f.height, 26, f.key);
          assert.equal(f.bottom, 24, f.key);
          assert.ok(
            f.left >= 2 && f.right <= 25 && f.top >= 2 && f.top < f.bottom,
            f.key,
          );
        }
      }
  });
});

test("actual companion renderer uses calm, sleeping and happy loops and pauses without work writes", async () => {
  await observerFixture({}, async ({ page, state }) => {
    await ready(page);
    const before = accounting(await state());
    const selected = await page.evaluate(() => {
      const s = officeScene,
        original = {
          ctx: s.ctx,
          time: s.time,
          paused: s.paused,
          petActive: s.petActive,
          petUntil: s.petUntil,
          petHits: s.petHits,
          geometry: s.geometry,
        },
        canvas = document.createElement("canvas"),
        result = [];
      canvas.width = canvas.height = 180;
      s.ctx = canvas.getContext("2d");
      s.geometry = {};
      s.petHits = [];
      s.petActive = null;
      s.paused = false;
      const draw = s.ctx.drawImage.bind(s.ctx);
      s.ctx.drawImage = (image, ...args) => {
        const key = [...officeStudio.petLife].find(
          ([, source]) => source === image,
        )?.[0];
        if (key) result.push({ key, mirror: s.ctx.getTransform().a });
        return draw(image, ...args);
      };
      try {
        s.time = 2.125;
        s.pet(60, 60, false, { moving: false, facing: -1 });
        s.time = 1.5;
        s.pet(60, 60, false, { mode: "sleep", moving: false, facing: 1 });
        s.time = 0.5;
        s.petActive = "cat";
        s.petUntil = 10;
        s.pet(60, 60, false, { moving: true, facing: -1 });
        s.paused = true;
        s.pet(60, 60, false, { moving: true, facing: -1 });
        s.petActive = null;
        s.image("sleepcat", 40, 40, 18, 12);
      } finally {
        Object.assign(s, original);
      }
      return result;
    });
    assert.deepEqual(selected, [
      { key: "pet-0-idle-anim-2", mirror: 1 },
      { key: "pet-0-sleep-anim-1", mirror: 1 },
      { key: "pet-0-happy-anim-3", mirror: 1 },
      { key: "pet-0-happy-anim-0", mirror: 1 },
      { key: "pet-0-sleep-anim-0", mirror: 1 },
    ]);
    assert.deepEqual(accounting(await state()), before);
  });
});

test("new companion loops export native four-frame strips and fit narrow panels", async () => {
  await observerFixture({}, async ({ page, state }) => {
    await ready(page);
    const before = accounting(await state());
    await page.setViewportSize({ width: 320, height: 760 });
    await page.click("#settingsbtn");
    await page.locator("#studio-gallery summary").click();
    await page.fill("#studio-sprite-search", "pet 7 happy anim");
    assert.equal(await page.locator("#studio-sprite-choice option").count(), 4);
    await page.selectOption("#studio-sprite-choice", "pet-7-happy-anim-0");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#studio-strip-download"),
    ]);
    const file = await download.path();
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.readUInt32BE(16), 112);
    assert.equal(bytes.readUInt32BE(20), 26);
    const exact = await page.evaluate(async (b64) => {
      const i = new Image();
      i.src = "data:image/png;base64," + b64;
      await i.decode();
      const c = document.createElement("canvas");
      c.width = 112;
      c.height = 26;
      const g = c.getContext("2d");
      g.drawImage(i, 0, 0);
      const expected = document.createElement("canvas");
      expected.width = 112;
      expected.height = 26;
      for (let f = 0; f < 4; f++)
        expected
          .getContext("2d")
          .drawImage(
            officeStudio.petLife.get(`pet-7-happy-anim-${f}`),
            f * 28,
            0,
          );
      const pixels = expected.getContext("2d").getImageData(0, 0, 112, 26).data;
      return [...g.getImageData(0, 0, 112, 26).data].every(
        (v, n) => v === pixels[n],
      );
    }, bytes.toString("base64"));
    assert.equal(exact, true);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.locator("#studio-sprite-preview").scrollIntoViewIfNeeded();
    const dir = process.env.OFFICE_SCREENSHOTS || "reports/pet-life";
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({
      path: path.join(dir, "happy-loop-320.png"),
      fullPage: true,
    });
    assert.deepEqual(accounting(await state()), before);
  });
});

test("a missing life pack leaves walking usable and retries without losing drafts", async () => {
  await observerFixture({}, async ({ page, state }) => {
    await ready(page);
    const before = accounting(await state());
    await page.route("**/studio/pet-life.png", (route) =>
      route.fulfill({ status: 404, body: "missing" }),
    );
    await page.reload();
    await page.waitForFunction(
      () => window.officeStudio?.ready && !officeStudio.loading,
    );
    assert.equal(await page.evaluate(() => officeStudio.petLife.size), 0);
    assert.equal(
      await page.evaluate(() => officeStudio.petDirectional.size),
      96,
    );
    assert.match(
      await page.evaluate(() => officeStudio.environmentError),
      /pet-life/,
    );
    await page.click("#settingsbtn");
    await page.fill("#room-name-input", "Life pack unsaved draft");
    await page.unroute("**/studio/pet-life.png");
    await page.click("#studio-art-retry");
    await ready(page);
    assert.equal(
      await page.inputValue("#room-name-input"),
      "Life pack unsaved draft",
    );
    assert.equal(await page.locator("#studio-art-retry").isHidden(), true);
    assert.equal(
      await page.locator("#studio-sprite-choice option").count(),
      730,
    );
    assert.deepEqual(accounting(await state()), before);
  });
});
