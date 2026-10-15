const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { observerFixture } = require("./observer-fixture.cjs");

const events = [
  { event: "session_start", session_id: "review-a", platform: "codex" },
  {
    event: "input_request",
    session_id: "review-a",
    platform: "codex",
    request_id: "question-a",
    question: "Which API version should be documented?",
  },
  { event: "session_start", session_id: "review-b", platform: "claude" },
  {
    event: "approval_request",
    session_id: "review-b",
    platform: "claude",
    request_id: "approval-b",
    command: "npm test",
  },
];

const viewports = [
  { width: 1440, height: 1000 },
  { width: 320, height: 568 },
];

for (const viewport of viewports) {
  test(`composition Escape preserves the active draft and panel at ${viewport.width}px`, async () => {
    await observerFixture({ events, viewport }, async ({ page }) => {
      const writes = [];
      page.on("request", (request) => {
        if (request.method() !== "GET") writes.push(request.url());
      });
      await page.click("#tasksbtn");
      await page.click('[data-task-view="draft"]');
      await page.fill("#task-draft-text", "Keep this composing task brief.");
      for (const detail of [{ isComposing: true }, { keyCode: 229 }]) {
        await page.locator("#task-draft-text").evaluate((input, detail) => {
          input.focus();
          input.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Escape",
              bubbles: true,
              cancelable: true,
              ...detail,
            }),
          );
        }, detail);
        assert.equal(await page.locator("#sheet-tasks").isVisible(), true);
        assert.equal(
          await page.evaluate(() => document.activeElement.id),
          "task-draft-text",
        );
      }
      assert.equal(
        await page.inputValue("#task-draft-text"),
        "Keep this composing task brief.",
      );
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#sheet-tasks").isVisible(), false);
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "tasksbtn",
      );
      await page.locator("#c").evaluate((canvas) => {
        canvas.focus();
        canvas.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "t",
            isComposing: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      assert.deepEqual(writes, [], "Composing keys must not change settings");
    });
  });

  test(`the waiting HUD labels retained data and blocks navigation while disconnected at ${viewport.width}px`, async () => {
    await observerFixture({ events, viewport }, async ({ page }) => {
      const waiting = page.locator("#waiting-count");
      await waiting.click();
      assert.equal(await page.evaluate(() => focusedId), "review-a");
      await page.locator("#sheet-inspector .close").click();
      await waiting.focus();
      await page.route("**/state", (route) => route.abort());
      await page.evaluate(() => poll());
      await page.waitForFunction(() => offline);
      assert.match(await waiting.textContent(), /last reported/i);
      assert.equal(await waiting.getAttribute("aria-disabled"), "true");
      assert.match(await page.title(), /Disconnected/);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "waiting-count",
        "A lost connection must not discard the user's keyboard focus",
      );
      await waiting.evaluate((button) => button.click());
      assert.equal(await page.locator("#sheet-inspector").isVisible(), false);
      assert.equal(await page.evaluate(() => focusedId), "review-a");
      await page.keyboard.press("p");
      assert.equal(await page.locator("#sheet-inspector").isVisible(), false);
      await page.unroute("**/state");
      await page.evaluate(() => poll());
      await page.waitForFunction(() => !offline);
      assert.equal(await waiting.getAttribute("aria-disabled"), "false");
      assert.doesNotMatch(await waiting.textContent(), /last reported/i);
      await waiting.click();
      assert.equal(await page.evaluate(() => focusedId), "review-b");
      assert.equal(await page.locator("#sheet-inspector").isVisible(), true);
    });
  });

  test(`quick navigation closes its own modal and preserves the underlying panel stack at ${viewport.width}px`, async () => {
    await observerFixture({ events, viewport }, async ({ page }) => {
      await page.waitForFunction(() => window.officeQuickNav);
      await page.click("#tasksbtn");
      await page.click('[data-task-view="draft"]');
      await page.fill("#task-draft-text", "Keep this unsent navigation brief.");
      await page.locator("#sheet-tasks .close").focus();
      await page.keyboard.press("Control+k");
      const search = page.getByRole("combobox", {
        name: "Search sessions and panels",
      });
      await search.fill("review-b");
      await search.press("Enter");
      assert.equal(await page.locator("#sheet-inspector").isVisible(), true);
      await page.locator("#sheet-inspector .close").focus();
      await page.keyboard.press("Control+k");
      await search.fill("Activity history");
      await search.press("Escape");
      assert.equal(await page.locator("dialog[open]").count(), 0);
      assert.equal(await page.locator("#sheet-inspector").isVisible(), true);
      assert.equal(
        await page
          .locator("#sheet-inspector .close")
          .evaluate((button) => button === document.activeElement),
        true,
      );
      await page.keyboard.press("Control+k");
      await search.fill("Activity history");
      await search.press("Enter");
      assert.equal(await page.locator("#sheet-events").isVisible(), true);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#sheet-inspector").isVisible(), true);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#sheet-tasks").isVisible(), true);
      assert.equal(
        await page.inputValue("#task-draft-text"),
        "Keep this unsent navigation brief.",
      );
      await page.locator("#sheet-tasks .close").click();
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "tasksbtn",
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    });
  });
}

test("blocked settings retain an unsaved name while local artwork and section navigation remain usable", async () => {
  await observerFixture(
    { events, viewport: { width: 320, height: 568 } },
    async ({ page, directory }) => {
      await page.waitForFunction(
        () => window.officeStudio?.ready && !officeStudio.loading,
      );
      await page.click("#settingsbtn");
      await page.fill("#room-name-input", "Keep this unsaved name");
      const settingsFile = path.join(directory, "settings.json"),
        original = fs.readFileSync(settingsFile),
        writes = [];
      page.on("request", (request) => {
        if (request.method() !== "GET") writes.push(request.url());
      });
      try {
        fs.writeFileSync(settingsFile, "[unreadable synthetic settings");
        await page.evaluate(() => poll());
        await page.waitForFunction(() => !settingsReady);
        assert.equal(await page.locator("#room-name-input").isDisabled(), true);
        assert.equal(
          await page.locator("#studio-art-choice").isEnabled(),
          true,
        );
        const navigation = page.getByLabel("Customize section"),
          destination = await navigation
            .locator("option")
            .evaluateAll(
              (options) =>
                options.find((option) => /sprite/i.test(option.textContent))
                  ?.value,
            );
        assert.ok(destination);
        await navigation.selectOption(destination);
        assert.equal(
          await page.locator("#studio-gallery").getAttribute("open"),
          "",
        );
        const geometry = await page
          .locator("#studio-gallery > summary")
          .evaluate((summary) => ({
            top: summary.getBoundingClientRect().top,
            bottom: summary.getBoundingClientRect().bottom,
            header: summary
              .closest(".sheet")
              .querySelector(".sheet-header")
              .getBoundingClientRect().bottom,
            viewport: innerHeight,
          }));
        assert.ok(geometry.top >= geometry.header, JSON.stringify(geometry));
        assert.ok(
          geometry.bottom < geometry.viewport,
          JSON.stringify(geometry),
        );
        await page.selectOption("#studio-art-choice", "classic");
        assert.equal(
          await page.evaluate(() => document.documentElement.dataset.officeArt),
          "classic",
        );
        assert.deepEqual(writes, []);
        fs.writeFileSync(settingsFile, original);
        await page.evaluate(() => poll());
        await page.waitForFunction(() => settingsReady);
        await navigation.selectOption({ label: "Office name" });
        assert.equal(await page.locator("#room-name-input").isEnabled(), true);
        assert.equal(
          await page.inputValue("#room-name-input"),
          "Keep this unsaved name",
        );
        assert.equal(
          await page
            .locator("#sheet-settings")
            .evaluate((sheet) => sheet.scrollWidth > sheet.clientWidth),
          false,
        );
      } finally {
        fs.writeFileSync(settingsFile, original);
      }
    },
  );
});
