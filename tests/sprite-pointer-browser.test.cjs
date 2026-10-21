const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { observerFixture } = require("./observer-fixture.cjs");
const folder =
  process.env.OFFICE_INTERACTION_SCREENSHOTS || "reports/sprite-interaction";
const initialEvents = (count) =>
  Array.from({ length: count }, (_, i) => ({
    event: "session_start",
    session_id: "incumbent-" + i,
    platform: "codex",
  }));

async function artwork(page, mode) {
  await page.waitForFunction(
    () => window.officeStudio?.ready && !officeStudio.loading,
  );
  await page.click("#settingsbtn");
  await page.selectOption("#studio-art-choice", mode);
  await page.locator("#sheet-settings .close").click();
  await page.locator("#c").scrollIntoViewIfNeeded();
}
async function freezeWalking(page, id) {
  await page.evaluate(() => poll());
  await page.waitForFunction((id) => officeScene.chars.get(id)?.moving, id);
  return page.evaluate((id) => {
    const s = officeScene;
    cancelAnimationFrame(s.frame);
    s.draw(0);
    const c = s.chars.get(id),
      t = s.transform,
      r = s.canvas.getBoundingClientRect();
    return {
      x: r.x + t.ox + (c.x + 8) * t.scale,
      y: r.y + t.oy + (c.y + 14) * t.scale,
      outsideDesk: s.hitBoxes.every(
        (h) =>
          !(
            c.x + 8 >= h.x &&
            c.x + 8 <= h.x + h.w &&
            c.y + 14 >= h.y &&
            c.y + 14 <= h.y + h.h
          ),
      ),
    };
  }, id);
}
for (const mode of ["classic", "studio"])
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ])
    test(`${mode} walking sprite opens its own session at ${viewport.width}px`, async () => {
      await observerFixture(
        {
          viewport,
          events: initialEvents(5),
          settings: {
            max_chars: 4,
            decorations: false,
            show_pets: false,
            agent_names: { "walking-target": "New arrival" },
          },
        },
        async ({ page, publish, state }) => {
          await artwork(page, mode);
          publish([
            {
              event: "session_start",
              session_id: "walking-target",
              platform: "codex",
            },
          ]);
          const point = await freezeWalking(page, "walking-target");
          assert.equal(
            point.outsideDesk,
            true,
            "the visible sprite is away from every station target",
          );
          const before = await state();
          fs.mkdirSync(folder, { recursive: true });
          await page.screenshot({
            path: path.join(folder, `${mode}-walking-${viewport.width}.png`),
          });
          await page.mouse.click(point.x, point.y);
          assert.equal(await page.evaluate(() => opened), "sheet-inspector");
          assert.equal(await page.evaluate(() => focusedId), "walking-target");
          await page.locator("#sheet-inspector .close").click();
          await page.mouse.move(point.x + 1, point.y);
          assert.equal(
            await page.locator("#c").evaluate((c) => c.style.cursor),
            "pointer",
          );
          assert.match(
            await page.locator("#c").getAttribute("title"),
            /Inspect.*New arrival/,
          );
          await page.mouse.move(0, 0);
          assert.equal(await page.locator("#c").getAttribute("title"), "");
          const after = await state();
          for (const key of ["settings", "events", "usage", "progress"])
            assert.deepEqual(after[key], before[key]);
        },
      );
    });

for (const mode of ["classic", "studio"])
  test(`${mode} overlapping arrivals select the sprite painted in front`, async () => {
    await observerFixture(
      {
        events: initialEvents(6),
        settings: { max_chars: 4, decorations: false, show_pets: false },
      },
      async ({ page, publish }) => {
        await artwork(page, mode);
        publish(
          ["arrival-a", "arrival-b"].map((session_id) => ({
            event: "session_start",
            session_id,
            platform: "codex",
          })),
        );
        await freezeWalking(page, "arrival-a");
        const front = await page.evaluate(() => {
          const s = officeScene,
            walkers = s.walking,
            last = walkers.at(-1),
            other = walkers.at(-2),
            t = s.transform,
            r = s.canvas.getBoundingClientRect();
          return {
            id: last.a.id,
            count: walkers.length,
            overlap:
              Math.abs(last.c.x - other.c.x) < 8 &&
              Math.abs(last.c.y - other.c.y) < 8,
            x: r.x + t.ox + (last.c.x + 8) * t.scale,
            y: r.y + t.oy + (last.c.y + 14) * t.scale,
          };
        });
        assert.equal(front.count, 2);
        assert.equal(front.overlap, true);
        await page.mouse.click(front.x, front.y);
        assert.equal(await page.evaluate(() => opened), "sheet-inspector");
        assert.equal(await page.evaluate(() => focusedId), front.id);
      },
    );
  });

test("a walking agent leaving the pointer clears the inspection hint without another pointer move", async () => {
  await observerFixture(
    {
      events: initialEvents(5),
      settings: {
        max_chars: 4,
        decorations: false,
        show_pets: false,
        agent_names: { "walking-target": "New arrival" },
      },
    },
    async ({ page, publish }) => {
      await artwork(page, "studio");
      publish([
        {
          event: "session_start",
          session_id: "walking-target",
          platform: "codex",
        },
      ]);
      const point = await freezeWalking(page, "walking-target");
      await page.mouse.move(point.x, point.y);
      assert.match(
        await page.locator("#c").getAttribute("title"),
        /Inspect.*New arrival/,
      );
      await page.evaluate(() => {
        officeScene.frame = requestAnimationFrame((t) => officeScene.tick(t));
      });
      await page.waitForFunction(
        () => document.getElementById("c").title === "",
      );
      assert.equal(
        await page.locator("#c").evaluate((c) => c.style.cursor),
        "default",
      );
      assert.equal(await page.evaluate(() => opened), null);
    },
  );
});

test("a full-length agent name keeps its hover hint without resizing the canvas", async () => {
  const name = "W".repeat(48);
  await observerFixture(
    {
      events: [
        { event: "session_start", session_id: "long-name", platform: "codex" },
      ],
      settings: { agent_names: { "long-name": name } },
    },
    async ({ page }) => {
      await artwork(page, "studio");
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(
        () =>
          officeScene.chars.has("long-name") &&
          !officeScene.chars.get("long-name").moving,
      );
      const target = await page.evaluate(() => {
        const label = officeScene.labelBoxes.find((h) => h.id === "long-name"),
          canvas = officeScene.canvas.getBoundingClientRect();
        return {
          x: canvas.x + label.x + label.w / 2,
          y: canvas.y + label.y + label.h / 2,
          height: canvas.height,
        };
      });
      await page.mouse.move(target.x, target.y);
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      assert.equal(
        await page.locator("#c").getAttribute("title"),
        `Inspect ${name} · Idle`,
      );
      assert.equal(
        await page
          .locator("#c")
          .evaluate((c) => c.getBoundingClientRect().height),
        target.height,
      );
      assert.equal(
        await page.locator("#c").evaluate((c) => c.style.cursor),
        "pointer",
      );
      await page.mouse.click(target.x, target.y);
      assert.equal(await page.evaluate(() => focusedId), "long-name");
    },
  );
});
