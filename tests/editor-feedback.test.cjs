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

test("Props reveals a searchable catalog at phone width after Customize was scrolled elsewhere", async () => {
  await observerFixture(
    { viewport: { width: 320, height: 568 } },
    async ({ page, state }) => {
      const before = await state();
      await page.click("#settingsbtn");
      await page.selectOption('[aria-label="Customize section"]', {
        label: "History & storage",
      });
      await page.click("#edit-furniture");
      await page.click("#catalog-furniture");
      const search = page.getByRole("searchbox", { name: "Find a prop" });
      await search.waitFor({ timeout: 1500 });
      assert.equal(
        await search.evaluate((el) => el === document.activeElement),
        true,
      );
      const geometry = await search.evaluate((el) => ({
        top: el.getBoundingClientRect().top,
        bottom: el.getBoundingClientRect().bottom,
        headerBottom: el
          .closest(".sheet")
          .querySelector(".sheet-header")
          .getBoundingClientRect().bottom,
        viewport: innerHeight,
      }));
      assert.ok(
        geometry.top >= geometry.headerBottom &&
          geometry.bottom < geometry.viewport,
      );
      const cards = page.locator("#furniture-tools .furniture-card:visible");
      assert.equal(await cards.count(), 26);
      await search.fill("LAMP");
      assert.equal(await cards.count(), 1);
      assert.equal(await cards.getAttribute("data-kind"), "lamp");
      await search.fill("taskterminal");
      assert.equal(await cards.count(), 1);
      assert.equal(await cards.getAttribute("data-kind"), "taskterminal");
      await search.fill("unfindable prop");
      assert.equal(await cards.count(), 0);
      assert.match(
        await page.textContent("#furniture-results"),
        /No props match/,
      );
      await page.click("#clear-furniture-filters");
      assert.equal(await cards.count(), 26);
      assert.equal(await search.inputValue(), "");
      await page.selectOption("#furniture-availability", "available");
      assert.equal(await cards.count(), 20);
      assert.equal(
        await page.locator('#furniture-tools [data-kind="arcade"]').isVisible(),
        false,
      );
      await page.selectOption("#furniture-availability", "all");
      assert.equal(
        await page
          .locator('#furniture-tools [data-kind="arcade"]')
          .isDisabled(),
        true,
      );
      await page.keyboard.press("Escape");
      const after = await state();
      for (const key of ["settings", "usage", "progress", "events"])
        assert.deepEqual(
          after[key],
          before[key],
          key + " is untouched by catalog browsing",
        );
    },
  );
});

test("the on-screen prop picker selects duplicate props by identity, removes, undoes, and reloads", async () => {
  const furniture = [
    { kind: "fern", x: 0.35, y: 0.45 },
    { kind: "fern", x: 0.65, y: 0.65 },
    { kind: "lamp", x: 0.8, y: 0.8 },
  ];
  await observerFixture(
    { viewport: { width: 390, height: 844 }, settings: { furniture } },
    async ({ page, state }) => {
      await page.click("#settingsbtn");
      await page.click("#edit-furniture");
      const picker = page.getByRole("combobox", { name: "Custom prop" });
      await picker.waitFor({ timeout: 1500 });
      await picker.selectOption("1");
      assert.equal(await page.evaluate(() => officeScene.movingIndex), 1);
      assert.equal(await page.isDisabled("#delete-furniture"), false);
      const destination = await freePoint(page, true);
      assert.ok(destination, "A free destination is available");
      await page.mouse.click(destination.x, destination.y);
      await page.waitForFunction(() => !furnitureSaving && pendingSaves === 0);
      const moved = (await state()).settings.furniture;
      assert.notDeepEqual(moved[1], furniture[1]);
      assert.deepEqual([moved[0], moved[2]], [furniture[0], furniture[2]]);
      await page.click("#undo-furniture");
      await page.waitForFunction(() => !furnitureSaving && pendingSaves === 0);
      await picker.selectOption("1");
      await page.click("#delete-furniture");
      await page.waitForFunction(() => !furnitureSaving && pendingSaves === 0);
      assert.deepEqual((await state()).settings.furniture, [
        furniture[0],
        furniture[2],
      ]);
      await page.click("#undo-furniture");
      await page.waitForFunction(() => !furnitureSaving && pendingSaves === 0);
      assert.deepEqual((await state()).settings.furniture, furniture);
      await picker.selectOption("2");
      assert.equal(await page.evaluate(() => officeScene.movingIndex), 2);
      await page.locator("#c").press("Space");
      assert.equal(
        await picker.inputValue(),
        "0",
        "Keyboard cycling and the touch picker agree",
      );
      await page.click("#finish-furniture");
      await page.reload();
      await page.waitForFunction(() => initialized && settingsReady);
      assert.deepEqual((await state()).settings.furniture, furniture);
    },
  );
});

test("the prop picker cannot change selection while a conditional furniture save is pending", async () => {
  await observerFixture(
    {
      settings: {
        furniture: [
          { kind: "fern", x: 0.35, y: 0.45 },
          { kind: "lamp", x: 0.65, y: 0.65 },
        ],
      },
    },
    async ({ page }) => {
      await page.click("#settingsbtn");
      await page.click("#edit-furniture");
      const picker = page.getByRole("combobox", { name: "Custom prop" });
      await picker.waitFor({ timeout: 1500 });
      await picker.selectOption("0");
      const delayed = await delaySave(page, false);
      await page.click("#delete-furniture");
      await delayed.requested;
      assert.equal(await picker.isDisabled(), true);
      delayed.release();
      await page.waitForFunction(() => !furnitureSaving && pendingSaves === 0);
      assert.equal(await picker.isDisabled(), false);
      assert.equal(await picker.locator("option").count(), 2);
      await picker.selectOption("0");
      assert.equal(await page.evaluate(() => officeScene.editKind()), "lamp");
    },
  );
});

test("a crowded phone floor keeps unplaced props selectable and removable without canvas hit targets", async () => {
  const furniture = Array.from({ length: 24 }, () => ({
    kind: "sofa",
    x: 0.5,
    y: 0.5,
  }));
  await observerFixture(
    { viewport: { width: 320, height: 568 }, settings: { furniture } },
    async ({ page, state }) => {
      const before = await state();
      const unplaced = await page.evaluate(
        () => officeScene.resolvedFurniture.find((item) => !item.bounds)?.index,
      );
      assert.ok(
        Number.isInteger(unplaced),
        "The actual phone layout cannot display every sofa",
      );
      await page.click("#settingsbtn");
      await page.click("#edit-furniture");
      await page.selectOption("#furniture-picker", String(unplaced));
      assert.equal(
        await page.evaluate(() => officeScene.movingIndex),
        unplaced,
      );
      await page.click("#delete-furniture");
      await page.waitForFunction(() => !furnitureSaving && pendingSaves === 0);
      assert.equal((await state()).settings.furniture.length, 23);
      await page.click("#undo-furniture");
      await page.waitForFunction(() => !furnitureSaving && pendingSaves === 0);
      const after = await state();
      assert.deepEqual(after.settings.furniture, furniture);
      for (const key of ["usage", "progress", "events"])
        assert.deepEqual(
          after[key],
          before[key],
          key + " is untouched by room editing",
        );
    },
  );
});
