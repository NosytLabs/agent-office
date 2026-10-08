/* Native editor actions against isolated observer state and conditional saves. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { observerFixture } = require("./observer-fixture.cjs");
const { fetchSettings } = require("./settings-helper.cjs");

async function freePoint(page, distant = false) {
  return page.evaluate((distant) => {
    const scene = officeScene,
      transform = scene.transform,
      rect = scene.canvas.getBoundingClientRect(),
      old = scene.furnitureBounds(0);
    for (let y = 75; y < scene.grid.h - 15; y += 4)
      for (let x = 24; x < scene.grid.w - 24; x += 4) {
        if (
          distant &&
          old &&
          Math.hypot(x - old.x - old.w / 2, y - old.y - old.h) < 50
        )
          continue;
        if (
          ![-1, 0, 1].every((dx) =>
            [-1, 0, 1].every(
              (dy) => scene.placement({ x: x + dx, y: y + dy })?.valid,
            ),
          )
        )
          continue;
        const point = {
          x: rect.left + transform.ox + x * transform.scale,
          y: rect.top + transform.oy + y * transform.scale,
        };
        if (document.elementFromPoint(point.x, point.y)?.id === "c")
          return point;
      }
    return null;
  }, distant);
}
async function placeFern(page) {
  await page.click("#settingsbtn");
  await page.click('#furniture-tools [data-kind="fern"]');
  const point = await freePoint(page);
  assert.ok(point, "The scene has free floor for the fixture fern");
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(
    () =>
      pendingSaves === 0 && !furnitureSaving && settings.furniture.length === 1,
  );
}
async function moveFern(page) {
  await page.click("#arrange-furniture");
  await page.locator("#c").focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(() => officeScene.movingIndex === 0);
  const point = await freePoint(page, true);
  assert.ok(point, "The scene has a separate valid destination");
  await page.mouse.click(point.x, point.y);
}
function delaySave(page, fail) {
  let release, received;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const requested = new Promise((resolve) => {
    received = resolve;
  });
  const handler = async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    received();
    await waiting;
    if (fail)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic temporary write failure" }),
      });
    return route.continue();
  };
  return page
    .route("**/settings", handler)
    .then(() => ({ requested, release, handler }));
}

test("a failed move never reports success and can be retried through native controls", async () => {
  await observerFixture(
    { settings: { furniture: [], show_pets: false } },
    async ({ page, state }) => {
      await placeFern(page);
      const before = (await state()).settings.furniture;
      const delayed = await delaySave(page, true);
      await moveFern(page);
      await delayed.requested;
      assert.match(await page.textContent("#edit-message"), /Saving/i);
      assert.doesNotMatch(await page.textContent("#edit-message"), /Moved\./);
      delayed.release();
      await page.waitForFunction(() => pendingSaves === 0 && !furnitureSaving);
      assert.deepEqual((await state()).settings.furniture, before);
      assert.match(
        await page.textContent("#edit-message"),
        /not saved.*try again/i,
      );
      await page.unroute("**/settings", delayed.handler);
      await moveFern(page);
      await page.waitForFunction(() => pendingSaves === 0 && !furnitureSaving);
      assert.notDeepEqual((await state()).settings.furniture, before);
      assert.match(await page.textContent("#edit-message"), /^Moved\./);
    },
  );
});

for (const leave of ["Done", "Escape"]) {
  test(`finishing via ${leave} while a move saves prevents stale editor feedback`, async () => {
    await observerFixture(
      { settings: { furniture: [], show_pets: false } },
      async ({ page, state }) => {
        await placeFern(page);
        const before = (await state()).settings.furniture;
        const delayed = await delaySave(page, false);
        await moveFern(page);
        await delayed.requested;
        assert.match(await page.textContent("#edit-message"), /Saving/i);
        if (leave === "Done") await page.click("#finish-furniture");
        else await page.keyboard.press("Escape");
        assert.equal(await page.isVisible("#edit-hint"), false);
        const message = await page.textContent("#edit-message");
        delayed.release();
        await page.waitForFunction(
          () => pendingSaves === 0 && !furnitureSaving,
        );
        assert.notDeepEqual((await state()).settings.furniture, before);
        assert.equal(await page.textContent("#edit-message"), message);
        await page.unroute("**/settings", delayed.handler);
        await page.click("#settingsbtn");
        await page.click('#furniture-tools [data-kind="fern"]');
        assert.match(await page.textContent("#edit-message"), /^Place /);
      },
    );
  });
}

test("a move rejected after another view replaces furniture preserves the new layout and asks to retry", async () => {
  await observerFixture(
    { settings: { furniture: [], show_pets: false } },
    async ({ page, state, base }) => {
      await placeFern(page);
      const delayed = await delaySave(page, false);
      await moveFern(page);
      await delayed.requested;
      const changed = await fetchSettings(base + "/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ furniture: [] }),
      });
      assert.equal(changed.status, 200);
      delayed.release();
      await page.waitForFunction(() => pendingSaves === 0 && !furnitureSaving);
      assert.deepEqual((await state()).settings.furniture, []);
      assert.deepEqual(await page.evaluate(() => settings.furniture), []);
      assert.match(
        await page.textContent("#edit-message"),
        /not saved.*try again/i,
      );
      assert.equal(await page.isDisabled("#undo-furniture"), true);
      assert.match(
        await page.textContent("#settings-save-notice"),
        /changed in another view/i,
      );
      await page.unroute("**/settings", delayed.handler);
    },
  );
});
