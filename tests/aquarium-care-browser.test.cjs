/* Real HTTP/browser coverage for feeding, artwork recovery, and greetings. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { observerFixture } = require("./observer-fixture.cjs");

async function openTank(page) {
  await page.evaluate(() => openAquarium());
  await page.waitForFunction(
    () => !document.getElementById("sheet-aquarium").hidden,
  );
}

test("feeding remains usable after a full food queue is paused", async () => {
  await observerFixture({}, async ({ page, state }) => {
    const before = (await state()).progress.xp;
    await openTank(page);
    const canvas = page.locator("#aquarium-canvas");
    for (let i = 0; i < 4; i++) {
      if (i) await page.waitForTimeout(1650);
      const box = await canvas.boundingBox();
      await canvas.click({
        position: { x: box.width * 0.92, y: box.height * 0.12 },
      });
    }
    assert.equal(
      await page.evaluate(() => officeAquarium.snapshot().pellets.length),
      12,
    );
    await page.locator("#aquarium-motion").click();
    await page.waitForTimeout(1700);
    assert.equal(await page.locator("#aquarium-feed").isDisabled(), false);
    await page.locator("#aquarium-feed").click();
    const after = await page.evaluate(() => officeAquarium.snapshot());
    assert.equal(after.eaten, 1);
    assert.equal(after.pellets.length, 12);
    assert.equal(after.running, false);
    assert.equal((await state()).progress.xp, before);
  });
});

test("a stalled optional fish image falls back and retry recovers native frames", async () => {
  await observerFixture({}, async ({ page }) => {
    const ids = ["ember", "mint", "violet", "pearl"];
    const manifest = {
      version: 1,
      fish: Object.fromEntries(
        ids.map((id) => [
          id,
          {
            url: `/user/aquarium/${id}.png`,
            kind: "Test fish",
            sheet_width: 96,
            sheet_height: 64,
            x: 16,
            y: 16,
            frame_width: 16,
            frame_height: 16,
            stride_x: 16,
            frame_count: 4,
            facing: "right",
          },
        ]),
      ),
    };
    const image = Buffer.from(
      await page.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = 96;
        c.height = 64;
        const g = c.getContext("2d");
        for (let i = 0; i < 4; i++) {
          g.fillStyle = i % 2 ? "#69b3ac" : "#deb678";
          g.fillRect(19 + 16 * i, 20, 9, 7);
        }
        return c.toDataURL("image/png").split(",")[1];
      }),
      "base64",
    );
    await page.route("**/user/aquarium/manifest.json", (route) =>
      route.fulfill({ json: manifest }),
    );
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    let hold = true;
    await page.route(/\/user\/aquarium\/[^/]+\.png$/, async (route) => {
      if (hold) await held;
      await route
        .fulfill({ contentType: "image/png", body: image })
        .catch(() => {});
    });
    try {
      await openTank(page);
      await page.waitForFunction(
        () => officeAquarium.snapshot().artSource === "original",
        null,
        { timeout: 7500 },
      );
      assert.equal(await page.locator("#aquarium-retry-art").isVisible(), true);
      hold = false;
      release();
      await page.locator("#aquarium-retry-art").click();
      await page.waitForFunction(
        () => officeAquarium.snapshot().artSource === "local",
      );
      const snapshot = await page.evaluate(() => officeAquarium.snapshot());
      assert.deepEqual(Object.values(snapshot.spriteFrames), [4, 4, 4, 4]);
      assert.equal(snapshot.assetErrors, 0);
      assert.equal(
        await page.locator("#aquarium-retry-art").isVisible(),
        false,
      );
    } finally {
      release();
    }
  });
});

test("keyboard and touch-friendly greetings work with reduced motion and do not feed", async () => {
  await observerFixture(
    { reducedMotion: "reduce", viewport: { width: 390, height: 844 } },
    async ({ page, state }) => {
      const before = (await state()).progress.xp;
      await openTank(page);
      await page.locator("#aquarium-canvas").press("ArrowRight");
      let tank = await page.evaluate(() => officeAquarium.snapshot());
      assert.equal(tank.inspectedFish, "ember");
      assert.equal(tank.running, false);
      assert.equal(tank.eaten, 0);
      const greet = page.getByRole("button", {
        name: "Greet fish",
        exact: true,
      });
      await greet.click();
      tank = await page.evaluate(() => officeAquarium.snapshot());
      assert.equal(tank.inspectedFish, "ember");
      assert.equal(tank.fish[0].reaction, 0);
      assert.equal((await state()).progress.xp, before);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      const directory = path.join(__dirname, "../reports/aquarium-care");
      fs.mkdirSync(directory, { recursive: true });
      await page.screenshot({
        path: path.join(directory, "mobile-greeting.png"),
        fullPage: true,
      });
    },
  );
});
