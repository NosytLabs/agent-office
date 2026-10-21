const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { observerFixture } = require("./observer-fixture.cjs");
const { fetchSettings } = require("./settings-helper.cjs");
const events = [
  { event: "session_start", session_id: "room-view-agent", platform: "codex" },
  {
    event: "input_request",
    session_id: "room-view-agent",
    platform: "codex",
    request_id: "room-view-question",
    question: "Review the room?",
  },
];
const folder = process.env.OFFICE_ROOMVIEW_SCREENSHOTS || "reports/room-view";
for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 568, height: 320 },
  { width: 667, height: 320 },
])
  test(`room view keeps its compact HUD and room within ${viewport.width}×${viewport.height}`, async () => {
    await observerFixture({ viewport, events }, async ({ page, state }) => {
      await page.waitForFunction(
        () => officeStudio?.ready && !officeStudio.loading,
      );
      const before = await state();
      await page.click("#room-view-toggle");
      await page.waitForFunction(() =>
        document.body.classList.contains("room-focus"),
      );
      const geometry = await page.evaluate(() => {
        const rect = (id) => {
          const r = document.getElementById(id).getBoundingClientRect();
          return {
            id,
            x: r.x,
            y: r.y,
            right: r.right,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
          };
        };
        return {
          width: innerWidth,
          height: innerHeight,
          overflowX: document.documentElement.scrollWidth > innerWidth,
          overflowY: document.documentElement.scrollHeight > innerHeight + 1,
          items: [
            "connection",
            "floorbtn",
            "tasksbtn",
            "eventsbtn",
            "settingsbtn",
            "filterbtn",
            "quick-nav-open",
            "waiting-count",
            "stage",
            "room-view-toggle",
            "zoom-fit",
            "pausebtn",
          ].map(rect),
        };
      });
      assert.equal(geometry.overflowX, false, JSON.stringify(geometry));
      assert.equal(geometry.overflowY, false, JSON.stringify(geometry));
      for (const r of geometry.items) {
        assert.ok(r.width > 0 && r.height > 0, JSON.stringify(r));
        assert.ok(
          r.x >= 0 &&
            r.y >= 0 &&
            r.right <= viewport.width + 1 &&
            r.bottom <= viewport.height + 1,
          JSON.stringify(r),
        );
      }
      assert.ok(geometry.items.find((r) => r.id === "stage").height >= 80);
      await page.click("#waiting-count");
      assert.equal(await page.evaluate(() => opened), "sheet-inspector");
      await page.locator("#sheet-inspector .close").click();
      assert.equal(
        await page.locator("#room-view-toggle").getAttribute("aria-pressed"),
        "true",
      );
      fs.mkdirSync(folder, { recursive: true });
      await page.screenshot({
        path: path.join(folder, `room-${viewport.width}.png`),
      });
      await page.keyboard.press("Escape");
      assert.equal(
        await page.locator("#room-view-toggle").getAttribute("aria-pressed"),
        "false",
      );
      const after = await state();
      for (const k of ["settings", "events", "usage", "progress"])
        assert.deepEqual(after[k], before[k]);
    });
  });

test("room view is a browser preference, preserves panel drafts and respects typing and editing Escape", async () => {
  await observerFixture({ events }, async ({ page, state }) => {
    const before = await state();
    await page.keyboard.press("v");
    assert.equal(
      await page.locator("#room-view-toggle").getAttribute("aria-pressed"),
      "true",
    );
    await page.click("#settingsbtn");
    await page.fill("#room-name-input", "Unsent room name");
    await page.keyboard.press("v");
    assert.equal(
      await page.inputValue("#room-name-input"),
      "Unsent room namev",
    );
    assert.equal(await page.locator("#room-view-choice").isChecked(), true);
    await page.uncheck("#room-view-choice");
    assert.equal(await page.evaluate(() => opened), "sheet-settings");
    assert.equal(
      await page.inputValue("#room-name-input"),
      "Unsent room namev",
    );
    await page.check("#room-view-choice");
    await page.getByRole("button", { name: "Pet bed", exact: true }).click();
    assert.ok(await page.evaluate(() => officeScene.edit));
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => officeScene.edit), null);
    assert.equal(
      await page.locator("#room-view-toggle").getAttribute("aria-pressed"),
      "true",
    );
    await page.reload();
    await page.waitForFunction(() => initialized && settingsReady);
    assert.equal(
      await page.locator("#room-view-toggle").getAttribute("aria-pressed"),
      "true",
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator("#room-view-toggle").getAttribute("aria-pressed"),
      "false",
    );
    const after = await state();
    for (const k of ["settings", "events", "usage", "progress"])
      assert.deepEqual(after[k], before[k]);
  });
});

test("room view stays usable and explains blocked browser storage", async () => {
  await observerFixture({ events }, async ({ page }) => {
    await page.evaluate(() => {
      Storage.prototype.setItem = function () {
        throw new Error("blocked fixture");
      };
    });
    await page.click("#room-view-toggle");
    assert.equal(
      await page.locator("#room-view-toggle").getAttribute("aria-pressed"),
      "true",
    );
    assert.match(
      await page.textContent("#toast"),
      /this visit.*storage is unavailable/i,
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator("#room-view-toggle").getAttribute("aria-pressed"),
      "false",
    );
  });
});

test("landscape room view uses a wide desk row while retaining seat identities across rotation", async () => {
  await observerFixture(
    {
      viewport: { width: 568, height: 320 },
      settings: { max_chars: 6 },
      events: [
        ...events,
        ...Array.from({ length: 4 }, (_, i) => ({
          event: "session_start",
          session_id: "landscape-agent-" + i,
          platform: "codex",
        })),
      ],
    },
    async ({ page, state }) => {
      const before = await state();
      const seats = () =>
        page.evaluate(() =>
          officeScene.assignedSeats().map(({ a, slot }) => [a.id, slot]),
        );
      const assigned = await seats();
      assert.equal(await page.evaluate(() => officeScene.grid.columns), 2);
      await page.click("#room-view-toggle");
      await page.waitForFunction(() => officeScene.grid.columns === 5);
      assert.equal(await page.evaluate(() => officeScene.grid.rows), 1);
      assert.deepEqual(await seats(), assigned);
      await page.setViewportSize({ width: 320, height: 568 });
      await page.waitForFunction(() => officeScene.grid.columns === 2);
      assert.deepEqual(await seats(), assigned);
      await page.setViewportSize({ width: 568, height: 320 });
      await page.waitForFunction(() => officeScene.grid.columns === 5);
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => officeScene.grid.columns === 2);
      assert.deepEqual(await seats(), assigned);
      const after = await state();
      for (const k of ["settings", "events", "usage", "progress"])
        assert.deepEqual(after[k], before[k]);
    },
  );
});

test("a null layout export gives a readable error without changing settings", async () => {
  await observerFixture({}, async ({ page, state }) => {
    const before = await state();
    await page.click("#settingsbtn");
    await page.locator("#import-settings").setInputFiles({
      name: "null.json",
      mimeType: "application/json",
      buffer: Buffer.from("null"),
    });
    await page.waitForFunction(() =>
      document
        .getElementById("toast")
        .textContent.includes("Choose an Agent Office layout export"),
    );
    assert.match(
      await page.textContent("#toast"),
      /Choose an Agent Office layout export/,
    );
    assert.deepEqual((await state()).settings, before.settings);
  });
});

async function holdLayout(page) {
  await page.evaluate(() => {
    const read = File.prototype.text;
    window.__releaseLayout = null;
    File.prototype.text = function () {
      return this.name === "slow.json"
        ? new Promise((resolve) => {
            window.__releaseLayout = () => read.call(this).then(resolve);
          })
        : read.call(this);
    };
  });
  await page.locator("#import-settings").setInputFiles({
    name: "slow.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        version: 1,
        settings: { room_name: "Older layout", furniture: [] },
      }),
    ),
  });
  await page.waitForFunction(
    () => typeof window.__releaseLayout === "function",
  );
}
for (const scenario of [
  "newer file",
  "new room save",
  "save adopted from another view",
  "closed and reopened panel",
])
  test(`a delayed layout import cannot replace a ${scenario}`, async () => {
    await observerFixture({ events }, async ({ page, state, base }) => {
      const before = await state();
      await page.click("#settingsbtn");
      await holdLayout(page);
      if (scenario === "newer file") {
        await page.locator("#import-settings").setInputFiles({
          name: "new.json",
          mimeType: "application/json",
          buffer: Buffer.from(
            JSON.stringify({
              version: 1,
              settings: { room_name: "Newer layout", furniture: [] },
            }),
          ),
        });
        await page.waitForFunction(
          () => settings.room_name === "Newer layout" && pendingSaves === 0,
        );
      } else if (scenario === "new room save") {
        await page.fill("#room-name-input", "Newer saved name");
        await page.click("#room-name-save");
        await page.waitForFunction(
          () => pendingSaves === 0 && settings.room_name === "Newer saved name",
        );
      } else if (scenario === "save adopted from another view") {
        const changed = await fetchSettings(base + "/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room_name: "Newer external save" }),
        });
        assert.equal(changed.status, 200);
        await page.evaluate(() => poll());
        await page.waitForFunction(
          () => settings.room_name === "Newer external save",
        );
      } else {
        await page.locator("#sheet-settings .close").click();
        await page.click("#settingsbtn");
      }
      const current = await state();
      await page.evaluate(() => window.__releaseLayout());
      await page.waitForTimeout(150);
      const after = await state();
      assert.deepEqual(after.settings, current.settings);
      for (const k of ["events", "usage", "progress"])
        assert.deepEqual(after[k], before[k]);
      if (
        scenario === "new room save" ||
        scenario === "save adopted from another view"
      )
        assert.match(
          await page.textContent("#toast"),
          /settings changed while reading/i,
        );
    });
  });
