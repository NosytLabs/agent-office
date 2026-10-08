/* Real recorded lifecycle, native controls, and canvas follow behavior. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { observerFixture } = require("./observer-fixture.cjs");
const events = ["alpha", "beta", "gamma"].map((id, index) => ({
  event: "session_start",
  session_id: id,
  platform: index ? "claude" : "opencode",
  title: id,
}));

async function follow(page, id = "alpha") {
  await page.click("#floorbtn");
  await page.locator(`#roster [data-agent="${id}"]`).click();
  await page
    .getByRole("button", { name: "Follow on floor", exact: true })
    .click();
  await page.waitForFunction(
    (id) => officeScene.following === id && opened === null,
    id,
  );
}

function accounting(state) {
  return {
    progress: state.progress,
    usage: state.usage,
    received: state.tracking.received,
    events: state.events,
  };
}

test("following uses the visible character, survives panel switches, and leaves accounting unchanged", async () => {
  await observerFixture({ events }, async ({ page, state }) => {
    const before = accounting(await state());
    await follow(page);
    const view = await page.evaluate(() => {
      const scene = officeScene,
        c = scene.chars.get("alpha"),
        t = scene.transform;
      return {
        id: scene.following,
        zoom: scene.zoom,
        x: t.ox + (c.x + 8) * t.scale,
        y: t.oy + (c.y + 16) * t.scale,
        width: scene.canvas.clientWidth,
        height: scene.canvas.clientHeight,
        pan: scene.pan,
      };
    });
    assert.equal(view.id, "alpha");
    assert.equal(view.zoom, 1.75);
    assert.ok(
      view.x > 0 && view.x < view.width && view.y > 0 && view.y < view.height,
    );
    assert.ok(
      Math.abs(view.pan.x) + Math.abs(view.pan.y) > 0,
      "Follow actually moves the camera",
    );
    await page.click("#tasksbtn");
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => officeScene.following), "alpha");
    await page.click("#floorbtn");
    await page.locator('#roster [data-agent="alpha"]').click();
    const stop = page.getByRole("button", {
      name: "Stop following",
      exact: true,
    });
    assert.equal(await stop.getAttribute("aria-pressed"), "true");
    await stop.click();
    assert.equal(await page.evaluate(() => officeScene.following), null);
    assert.equal(
      await page
        .getByRole("button", { name: "Follow on floor", exact: true })
        .getAttribute("aria-pressed"),
      "false",
    );
    assert.deepEqual(accounting(await state()), before);
  });
});

test("manual pan, Fit, runtime filtering, and furniture editing cancel follow", async () => {
  await observerFixture({ events }, async ({ page }) => {
    await follow(page);
    const canvas = await page.locator("#c").boundingBox();
    await page.mouse.move(
      canvas.x + canvas.width / 2,
      canvas.y + canvas.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      canvas.x + canvas.width / 2 + 80,
      canvas.y + canvas.height / 2 + 30,
      { steps: 5 },
    );
    await page.mouse.up();
    assert.equal(await page.evaluate(() => officeScene.following), null);
    const stopped = await page.evaluate(() => ({ ...officeScene.pan }));
    await page.waitForTimeout(150);
    assert.deepEqual(
      await page.evaluate(() => ({ ...officeScene.pan })),
      stopped,
    );
    await follow(page);
    await page.click("#zoom-fit");
    assert.deepEqual(
      await page.evaluate(() => [
        officeScene.following,
        officeScene.zoom,
        officeScene.pan.x,
        officeScene.pan.y,
      ]),
      [null, 1, 0, 0],
    );
    await follow(page);
    await page.selectOption("#filterbtn", "claude");
    assert.equal(await page.evaluate(() => officeScene.following), null);
    await page.selectOption("#filterbtn", "every");
    await follow(page);
    await page.click("#settingsbtn");
    await page.getByRole("button", { name: "Pet bed", exact: true }).click();
    assert.equal(await page.evaluate(() => officeScene.following), null);
    await page.keyboard.press("Escape");
  });
});

test("a followed session fades after a real end event and releases its camera target", async () => {
  await observerFixture(
    { events, reducedMotion: "reduce" },
    async ({ page, publish }) => {
      await follow(page);
      publish([
        { event: "session_end", session_id: "alpha", platform: "opencode" },
      ]);
      await page.waitForFunction(
        () =>
          officeScene.agents.find((agent) => agent.id === "alpha")?.status ===
          "gone",
      );
      assert.equal(
        await page.evaluate(() => officeScene.following),
        "alpha",
        "The ending sprite can still be inspected during its fade",
      );
      await page.waitForFunction(
        () => !officeScene.agents.some((agent) => agent.id === "alpha"),
        null,
        { timeout: 30000 },
      );
      assert.equal(await page.evaluate(() => officeScene.following), null);
    },
  );
});
