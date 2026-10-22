/* Responsive dashboard regressions against an isolated real observer. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { observerFixture } = require("./observer-fixture.cjs");

const screenshots =
  process.env.OFFICE_DASHBOARD_SCREENSHOTS ||
  path.resolve(__dirname, "../reports/dashboard-usability");

async function capture(page, name, fullPage = true) {
  fs.mkdirSync(screenshots, { recursive: true });
  await page.screenshot({
    path: path.join(screenshots, name + ".png"),
    fullPage,
  });
}

async function showStorageWarning(page, directory) {
  fs.mkdirSync(path.join(directory, "inbox"), { recursive: true });
  fs.writeFileSync(
    path.join(
      directory,
      "inbox",
      "00000000000000000001-00000000000000000000000000000000-000000000001.json",
    ),
    "{unreadable synthetic inbox record",
  );
  await page.evaluate(() => poll());
  assert.equal(await page.locator("#health-alert").isVisible(), true);
}

test("a maximum-length office name keeps live status controls inside the viewport", async () => {
  await observerFixture(
    {
      events: [
        {
          event: "session_start",
          platform: "claude",
          session_id: "name-layout",
          title: "Review the release",
        },
        {
          event: "approval_request",
          platform: "claude",
          session_id: "name-layout",
          request_id: "release-approval",
          command: "Review the release checklist",
        },
      ],
    },
    async ({ page }) => {
      const name = "BuildReview".repeat(4) + "Room";
      assert.equal(name.length, 48);
      await page.click("#settingsbtn");
      await page.fill("#room-name-input", name);
      await page.click("#room-name-save");
      await page.waitForFunction(
        (name) => pendingSaves === 0 && settings.room_name === name,
        name,
      );
      await page.locator("#sheet-settings .close").click();
      await page.evaluate(() => document.fonts.ready);
      for (const viewport of [
        { width: 320, height: 760 },
        { width: 375, height: 667 },
        { width: 667, height: 320 },
        { width: 1440, height: 900 },
      ]) {
        await page.setViewportSize(viewport);
        await capture(page, `long-office-name-${viewport.width}`);
        assert.equal(await page.textContent("#room-name"), name);
        const layout = await page.evaluate(() => {
          const room = document.querySelector("#room-name");
          const summary = document.querySelector("#summary");
          const bounds = (node) => {
            const { left, right, top, bottom } = node.getBoundingClientRect();
            return { left, right, top, bottom };
          };
          return {
            scrollWidth: document.documentElement.scrollWidth,
            room: bounds(room),
            summary: bounds(summary),
          };
        });
        assert.equal(
          layout.scrollWidth,
          viewport.width,
          "A saved name must not create horizontal page scrolling",
        );
        for (const bounds of [layout.room, layout.summary]) {
          assert.ok(bounds.left >= 0 && bounds.right <= viewport.width);
        }
        assert.ok(
          layout.room.right <= layout.summary.left ||
            layout.room.bottom <= layout.summary.top,
          "The room name and live controls must be separate beside or below each other",
        );
        await page.click("#waiting-count");
        assert.equal(await page.evaluate(() => focusedId), "name-layout");
        assert.match(
          await page.textContent("#inspector-summary"),
          /Needs input/,
        );
        await page.locator("#sheet-inspector .close").click();
      }
    },
  );
});

test("reverse tabbing keeps settings controls below the sticky panel header", async () => {
  await observerFixture({}, async ({ page }) => {
    await page.evaluate(() => document.fonts.ready);
    for (const viewport of [
      { width: 667, height: 320 },
      { width: 320, height: 760 },
      { width: 375, height: 667 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.click("#settingsbtn");
      await page.locator("#sheet-settings .close").focus();
      await page.keyboard.press("Shift+Tab");
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "resetbtn",
      );
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Shift+Tab");
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "export-settings",
      );
      await page.keyboard.press("Shift+Tab");
      assert.equal(
        await page.evaluate(() => document.activeElement.dataset.sheet),
        "sheet-setup",
      );
      const bounds = await page.evaluate(() => {
        const control = document.activeElement.getBoundingClientRect();
        const header = document
          .querySelector("#sheet-settings .sheet-header")
          .getBoundingClientRect();
        const panel = document
          .querySelector("#sheet-settings")
          .getBoundingClientRect();
        return {
          top: control.top,
          bottom: control.bottom,
          headerBottom: header.bottom,
          panelBottom: panel.bottom,
        };
      });
      await capture(page, `keyboard-settings-${viewport.width}`, false);
      assert.ok(
        bounds.top >= bounds.headerBottom,
        `Focused Connection guide must be visible below the header: ${JSON.stringify(bounds)}`,
      );
      assert.ok(bounds.bottom < bounds.panelBottom);
      await page.keyboard.press("Enter");
      assert.equal(await page.isVisible("#sheet-setup"), true);
      await page.keyboard.press("Escape");
      assert.equal(
        await page.evaluate(() => document.activeElement.dataset.sheet),
        "sheet-setup",
        "Back restores the triggering control",
      );
      await page.locator("#sheet-settings .close").click();
    }
  });
});

test("usage and observer alerts leave a readable title and a usable room at intermediate widths", async () => {
  await observerFixture(
    {
      settings: {
        room_name: "BuildReview".repeat(4) + "Room",
        budget_usd: 0.01,
      },
      events: [
        {
          event: "session_start",
          session_id: "alert-layout",
          platform: "claude",
        },
        {
          event: "input_request",
          session_id: "alert-layout",
          platform: "claude",
          request_id: "alert-question",
          question: "Review this change?",
        },
        {
          event: "usage",
          session_id: "alert-layout",
          platform: "claude",
          usage_id: "alert-cost",
          cost_usd: 0.25,
        },
      ],
    },
    async ({ page, directory }) => {
      await showStorageWarning(page, directory);
      assert.equal(await page.locator("#budget-alert").isVisible(), true);
      await page.evaluate(() => document.fonts.ready);
      for (const width of [320, 601, 667, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 768 });
        const geometry = await page.evaluate(() => {
          const rect = (id) =>
            document.getElementById(id).getBoundingClientRect().toJSON();
          return {
            room: rect("room-name"),
            stage: rect("stage"),
            summary: rect("summary"),
            controlsBottom: document
              .querySelector(".scene-controls")
              .getBoundingClientRect().bottom,
            footerTop: document.querySelector("footer").getBoundingClientRect()
              .top,
            pageWidth: document.documentElement.scrollWidth,
          };
        });
        assert.equal(geometry.pageWidth, width, JSON.stringify(geometry));
        assert.ok(
          geometry.room.width >= 180,
          "A title must not be squeezed into a few characters: " +
            JSON.stringify(geometry),
        );
        assert.ok(
          geometry.stage.height >= 200,
          "Live alerts must not collapse the room: " + JSON.stringify(geometry),
        );
        assert.ok(
          geometry.stage.height <= 768,
          "Canvas pixels must not enlarge the layout on every resize: " +
            JSON.stringify(geometry),
        );
        assert.ok(geometry.summary.right <= width, JSON.stringify(geometry));
        assert.ok(
          geometry.controlsBottom <= geometry.footerTop,
          "The activity footer must follow the camera controls: " +
            JSON.stringify(geometry),
        );
      }
      await page.click("#health-alert");
      const target = await page
        .locator("#storage-diagnostics > summary")
        .evaluate((node) => ({
          top: node.getBoundingClientRect().top,
          headerBottom: node
            .closest(".sheet")
            .querySelector(".sheet-header")
            .getBoundingClientRect().bottom,
        }));
      assert.ok(
        target.top >= target.headerBottom,
        "The storage alert must reveal its destination below the header: " +
          JSON.stringify(target),
      );
    },
  );
});

test("the storage HUD alert reveals and focuses diagnostics below the sticky header", async () => {
  await observerFixture({}, async ({ page, directory }) => {
    await showStorageWarning(page, directory);
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 667, height: 320 },
      { width: 1440, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      await page.click("#health-alert");
      const geometry = await page
        .locator("#storage-diagnostics > summary")
        .evaluate((summary) => {
          const rect = summary.getBoundingClientRect(),
            sheet = summary.closest(".sheet");
          return {
            top: rect.top,
            bottom: rect.bottom,
            headerBottom: sheet
              .querySelector(".sheet-header")
              .getBoundingClientRect().bottom,
            panelBottom: sheet.getBoundingClientRect().bottom,
            focused: document.activeElement === summary,
          };
        });
      assert.ok(
        geometry.top >= geometry.headerBottom &&
          geometry.bottom < geometry.panelBottom,
        JSON.stringify(geometry),
      );
      assert.equal(
        geometry.focused,
        true,
        "A keyboard alert action must move focus to the revealed diagnostics",
      );
      await page.keyboard.press("Escape");
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "health-alert",
      );
    }
  });
});

test("the empty-room connection card leaves the floor unobscured and setup reachable", async () => {
  await observerFixture(
    {
      settings: { room_name: "BuildReview".repeat(4) + "Room" },
      viewport: { width: 601, height: 768 },
    },
    async ({ page }) => {
      await page.evaluate(() => document.fonts.ready);
      const bounds = await page.locator("#empty-state").evaluate((card) => ({
        card: card.getBoundingClientRect().toJSON(),
        stage: document
          .getElementById("stage")
          .getBoundingClientRect()
          .toJSON(),
      }));
      assert.ok(
        bounds.card.top >= bounds.stage.bottom,
        "Connection guidance must not obscure furniture: " +
          JSON.stringify(bounds),
      );
      await page.click("#empty-connect");
      assert.equal(await page.locator("#sheet-setup").isVisible(), true);
    },
  );
});
test("a landscape panel keeps its body usable when Back and several notices are present", async () => {
  await observerFixture(
    { viewport: { width: 667, height: 320 }, reducedMotion: "reduce" },
    async ({ page }) => {
      await page.click("#helpbtn");
      await page.keyboard.press("Control+k");
      const search = page.getByRole("combobox", {
        name: "Search sessions and panels",
      });
      await search.fill("Customize");
      await search.press("Enter");
      await page.evaluate(() => {
        toast(
          "The local server could not save this change. Check the observer and try again.",
        );
        toast("A second setting needs your attention before it can be saved.");
        toast(
          "Your current draft is preserved while the connection is restored.",
        );
      });
      const geometry = await page
        .locator("#sheet-settings")
        .evaluate((sheet) => {
          const panel = sheet.getBoundingClientRect(),
            header = sheet
              .querySelector(".sheet-header")
              .getBoundingClientRect();
          return {
            bodySpace: panel.bottom - header.bottom,
            headerTop: header.top,
            closeBottom: sheet.querySelector(".close").getBoundingClientRect()
              .bottom,
            viewportHeight: innerHeight,
          };
        });
      assert.ok(
        geometry.bodySpace >= 80,
        "The title and notices must leave space to use a form: " +
          JSON.stringify(geometry),
      );
      assert.ok(
        geometry.headerTop >= 0 &&
          geometry.closeBottom <= geometry.viewportHeight,
        JSON.stringify(geometry),
      );
      await page
        .getByLabel("Customize section")
        .selectOption({ label: "Office name" });
      await page.locator("#room-name-input").fill("Landscape office");
      assert.equal(
        await page.inputValue("#room-name-input"),
        "Landscape office",
      );
      await page.locator("#sheet-settings .sheet-back").click();
      assert.equal(await page.locator("#sheet-legend").isVisible(), true);
    },
  );
});
