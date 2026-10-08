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
            const { left, right } = node.getBoundingClientRect();
            return { left, right };
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
        assert.ok(layout.room.right <= layout.summary.left);
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
