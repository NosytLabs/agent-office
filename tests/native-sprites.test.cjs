/* Compiled art must remain pixel-equivalent to the preserved source loader. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { observerFixture } = require("./observer-fixture.cjs");

test("the office uses compact native sprites without downloading authoring sheets", async () => {
  // Exact normalization pixels use the same CPU canvas backend as the compiler.
  await observerFixture(
    { browserArgs: ["--disable-gpu"] },
    async ({ page }) => {
      await page.waitForFunction(() => officeScene.loadedAssets === 23);
      assert.equal(
        await page.evaluate(() => officeScene.spriteAssetSource),
        "native",
      );
      const requests = await page.evaluate(() =>
        performance.getEntriesByType("resource").map((entry) => entry.name),
      );
      assert.ok(requests.some((url) => url.endsWith("/runtime/office.png")));
      assert.ok(
        !requests.some((url) =>
          /\/(?:moss-engineer|orbit-courier|studio-assistant|studio-atlas)\.png$/.test(
            url,
          ),
        ),
      );
      const comparison = await page.evaluate(async () => {
        const original = Object.assign(Object.create(OfficeScene.prototype), {
          sprites: {},
          spriteFrameTops: {},
          assetErrors: [],
          loadedAssets: 0,
          canvas: document.createElement("canvas"),
        });
        original.loadSourceAssets();
        const deadline = performance.now() + 10000;
        while (original.loadedAssets !== 23 && performance.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 20));
        if (original.loadedAssets !== 23)
          throw new Error("Source artwork did not load");
        const mismatches = [];
        for (const [key, size] of Object.entries(
          officeScene.runtimeSpriteSizes(),
        )) {
          const a = document.createElement("canvas"),
            b = document.createElement("canvas");
          for (const canvas of [a, b]) [canvas.width, canvas.height] = size;
          a.getContext("2d").drawImage(original.sprites[key], 0, 0);
          b.getContext("2d").drawImage(officeScene.sprites[key], 0, 0);
          const x = a.getContext("2d").getImageData(0, 0, ...size).data;
          const y = b.getContext("2d").getImageData(0, 0, ...size).data;
          if (x.some((value, index) => value !== y[index]))
            mismatches.push(key);
        }
        return {
          mismatches,
          before: original.spriteFrameTops,
          after: officeScene.spriteFrameTops,
        };
      });
      assert.deepEqual(comparison.mismatches, []);
      assert.deepEqual(comparison.after, comparison.before);
    },
  );
});

test("invalid compact artwork falls back to the complete original sprite set", async () => {
  await observerFixture({}, async ({ page }) => {
    await page.route("**/assets/sprites/runtime/manifest.json", (route) =>
      route.fulfill({ json: { version: 1, width: 1, height: 1, entries: {} } }),
    );
    await page.reload();
    await page.waitForFunction(
      () => initialized && officeScene.loadedAssets === 23,
    );
    assert.equal(
      await page.evaluate(() => officeScene.spriteAssetSource),
      "source",
    );
    assert.ok(
      await page.evaluate(
        () =>
          !!officeScene.sprites["orbit-courier"] &&
          !!officeScene.sprites["taskterminal-running"],
      ),
    );
  });
});
