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

async function deferClipboard(page) {
  await page.evaluate(() => {
    window.pendingPanelCopies = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text) =>
          new Promise((resolve, reject) =>
            pendingPanelCopies.push({ text, resolve, reject }),
          ),
      },
    });
  });
}

const copyViews = [
  {
    name: "connection guide",
    copy: '[data-copy-command="command-install"]',
    status: "#setup-copy-status",
    focus: "#setup-runtime",
    open: async (page) => {
      await page.click("#helpbtn");
      await page.click('#sheet-legend [data-sheet="sheet-setup"]');
    },
  },
  {
    name: "task draft",
    copy: "#task-draft-copy",
    status: "#task-draft-status",
    focus: "#task-draft-runtime",
    open: async (page) => {
      await page.click("#tasksbtn");
      await page.click('[data-task-view="draft"]');
      if (!(await page.inputValue("#task-draft-text")))
        await page.fill("#task-draft-text", "Keep this unsent audit brief.");
    },
  },
  {
    name: "session report",
    copy: "#inspector-copy",
    status: "#inspector-copy-status",
    focus: "#agent-name-input",
    open: async (page) => {
      await page.click("#floorbtn");
      await page.locator('#roster [data-agent="review-a"]').click();
    },
  },
];

for (const view of copyViews) {
  test(`a failed ${view.name} copy preserves a later keyboard text selection`, async () => {
    await observerFixture({ events }, async ({ page }) => {
      await deferClipboard(page);
      await view.open(page);
      await page.click(view.copy);
      await page.keyboard.press(
        process.platform === "darwin" ? "Meta+a" : "Control+a",
      );
      const heading = page.locator(".sheet:not([hidden]) h2");
      assert.equal(
        await heading.evaluate((node) =>
          getSelection().containsNode(node, true),
        ),
        true,
        "Native Select All selected panel text",
      );
      await page.evaluate(() =>
        pendingPanelCopies[0].reject(new Error("Synthetic permission denial")),
      );
      assert.equal(
        await heading.evaluate((node) =>
          getSelection().containsNode(node, true),
        ),
        true,
        "Copy feedback must not replace a later selection",
      );
    });
  });

  test(`a delayed ${view.name} copy cannot select text after the panel is closed and reopened`, async () => {
    await observerFixture({ events }, async ({ page, state }) => {
      const before = await state();
      await deferClipboard(page);
      await view.open(page);
      const original = await page.textContent(view.status);
      await page.click(view.copy);
      await page.locator(".sheet:not([hidden]) .close").click();
      await view.open(page);
      const focus = await page.evaluate(() => document.activeElement.id);
      await page.evaluate(() =>
        pendingPanelCopies[0].reject(
          new Error("Delayed synthetic permission denial"),
        ),
      );
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        focus,
        "A previous visit must not steal focus",
      );
      assert.equal(
        await page.textContent(view.status),
        original,
        "A previous visit must not replace current feedback",
      );
      assert.equal(await page.evaluate(() => getSelection().toString()), "");
      const after = await state();
      assert.deepEqual(after.progress, before.progress);
      assert.deepEqual(after.tasks, before.tasks);
      assert.deepEqual(after.usage, before.usage);
    });
  });

  test(`a failed ${view.name} copy preserves focus after the user moves to another control`, async () => {
    await observerFixture({ events }, async ({ page }) => {
      await deferClipboard(page);
      await view.open(page);
      await page.click(view.copy);
      await page.locator(view.focus).focus();
      await page.evaluate(() =>
        pendingPanelCopies[0].reject(
          new Error("Delayed synthetic permission denial"),
        ),
      );
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        view.focus.slice(1),
      );
      assert.equal(
        await page.evaluate(() => getSelection().toString()),
        "",
        "Manual Copy must not replace the user's selection elsewhere",
      );
    });
  });
}

for (const outcome of ["resolve", "reject"]) {
  test(`connection command copy ignores a delayed ${outcome} after changing runtimes`, async () => {
    await observerFixture({}, async ({ page }) => {
      await deferClipboard(page);
      await copyViews[0].open(page);
      await page.selectOption("#setup-runtime", "codex");
      await page.click('[data-copy-command="command-install"]');
      await page.selectOption("#setup-runtime", "claude");
      await page.evaluate(
        (outcome) =>
          pendingPanelCopies[0][outcome](
            outcome === "reject"
              ? new Error("Synthetic permission denial")
              : undefined,
          ),
        outcome,
      );
      assert.equal(await page.textContent("#setup-copy-status"), "");
      assert.equal(await page.evaluate(() => getSelection().toString()), "");
      assert.match(
        await page.textContent("#command-install"),
        /--only claude$/,
      );
    });
  });
}

test("newer setup Copy feedback survives an older response arriving last", async () => {
  await observerFixture({}, async ({ page }) => {
    await deferClipboard(page);
    await copyViews[0].open(page);
    await page.click('[data-copy-command="command-install"]');
    await page.click('[data-copy-command="command-observer"]');
    await page.evaluate(() => pendingPanelCopies[1].resolve());
    const latest = await page.textContent("#setup-copy-status");
    assert.match(latest, /python3 run.py/);
    await page.evaluate(() => pendingPanelCopies[0].resolve());
    assert.equal(await page.textContent("#setup-copy-status"), latest);
  });
});

test("a delayed draft copy failure does not select newer text or move its caret", async () => {
  await observerFixture({}, async ({ page }) => {
    await deferClipboard(page);
    await copyViews[1].open(page);
    await page.click("#task-draft-copy");
    await page.fill(
      "#task-draft-text",
      "This newer draft has not been copied.",
    );
    const before = await page
      .locator("#task-draft-text")
      .evaluate((field) => [field.selectionStart, field.selectionEnd]);
    await page.evaluate(() =>
      pendingPanelCopies[0].reject(new Error("Synthetic permission denial")),
    );
    assert.deepEqual(
      await page
        .locator("#task-draft-text")
        .evaluate((field) => [field.selectionStart, field.selectionEnd]),
      before,
    );
    assert.equal(
      await page.inputValue("#task-draft-text"),
      "This newer draft has not been copied.",
    );
  });
});

test("leaving and returning to the Draft tab invalidates its pending Copy feedback", async () => {
  await observerFixture({}, async ({ page }) => {
    await deferClipboard(page);
    await copyViews[1].open(page);
    await page.click("#task-draft-copy");
    await page.click('[data-task-view="activity"]');
    await page.click('[data-task-view="draft"]');
    await page.evaluate(() => pendingPanelCopies[0].resolve());
    assert.equal(await page.textContent("#task-draft-status"), "");
    assert.equal(
      await page.inputValue("#task-draft-text"),
      "Keep this unsent audit brief.",
    );
  });
});

test("returning from a hidden page does not revive pending session-report selection", async () => {
  await observerFixture({ events }, async ({ page }) => {
    await deferClipboard(page);
    await copyViews[2].open(page);
    await page.click("#inspector-copy");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      pendingPanelCopies[0].reject(
        new Error("Synthetic delayed clipboard denial"),
      );
    });
    assert.equal(await page.locator("#inspector-report").isVisible(), false);
    assert.equal(await page.textContent("#inspector-copy-status"), "");
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "inspector-copy",
    );
  });
});

test("a pending session copy does not replace an older report that the user is selecting", async () => {
  await observerFixture({ events }, async ({ page, publish }) => {
    await deferClipboard(page);
    await copyViews[2].open(page);
    await page.click("#inspector-copy");
    await page.evaluate(() =>
      pendingPanelCopies[0].reject(new Error("Synthetic clipboard denial")),
    );
    const field = page.locator("#inspector-report-text"),
      before = await field.inputValue();
    publish([
      {
        event: "session_update",
        session_id: "review-a",
        platform: "codex",
        title: "Updated report label",
      },
    ]);
    await page.evaluate(() => poll());
    await page.click("#inspector-copy");
    await field.focus();
    await field.press(process.platform === "darwin" ? "Meta+a" : "Control+a");
    const selection = await field.evaluate((node) => [
      node.selectionStart,
      node.selectionEnd,
    ]);
    await page.evaluate(() =>
      pendingPanelCopies[1].reject(new Error("Synthetic delayed denial")),
    );
    assert.equal(
      await field.inputValue(),
      before,
      "The report being selected must retain its text",
    );
    assert.deepEqual(
      await field.evaluate((node) => [node.selectionStart, node.selectionEnd]),
      selection,
    );
  });
});
