/* Reusable local briefs exercise the actual observer and draft workspace. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { observerFixture } = require("./observer-fixture.cjs");
const key = "agent-office:prompt-library:v1:observer";
const accounting = (state) => ({
  progress: state.progress,
  usage: state.usage,
  events: state.events,
  received: state.tracking.received,
});
async function open(page) {
  if (!(await page.locator('[data-task-view="draft"]').isVisible()))
    await page.click("#tasksbtn");
  await page.click('[data-task-view="draft"]');
  assert.equal(await page.locator("#prompt-library").count(), 1);
}
async function secondTab(page, base) {
  const opened = page.waitForEvent("popup");
  await page.evaluate((url) => window.open(url, "_blank"), base);
  const other = await opened;
  other.setDefaultTimeout(10000);
  await other.waitForFunction(
    () =>
      typeof initialized !== "undefined" &&
      initialized &&
      typeof settingsReady !== "undefined" &&
      settingsReady,
  );
  return other;
}
async function save(page, name, text, runtime = "codex") {
  await page.fill("#task-draft-text", text);
  await page.selectOption("#task-draft-runtime", runtime);
  await page.fill("#prompt-library-name", name);
  await page.click("#prompt-library-save");
  await page.waitForFunction(() =>
    /Saved/.test(document.querySelector("#prompt-library-status").textContent),
  );
}
function row(page, name) {
  return page
    .locator(".prompt-library-item")
    .filter({ has: page.locator(".prompt-library-name", { hasText: name }) });
}

test("saved briefs preserve exact text and destination, require explicit load review, and never publish work", async () => {
  await observerFixture({}, async ({ page, state }) => {
    const before = accounting(await state()),
      writes = [];
    page.on("request", (request) => {
      if (request.method() !== "GET") writes.push(request.url());
    });
    await open(page);
    const original =
      "Goal\n\n  Preserve indentation.\n<literal>text</literal>\n";
    await save(page, "Review API", original);
    assert.equal(await page.inputValue("#task-draft-text"), original);
    await page.fill("#task-draft-text", "Unsaved requirements\n");
    await page.selectOption("#task-draft-runtime", "claude");
    await row(page, "Review API")
      .getByRole("button", { name: "Load", exact: true })
      .click();
    assert.equal(
      await page.inputValue("#task-draft-text"),
      "Unsaved requirements\n",
    );
    assert.equal(await page.textContent("#prompt-library-preview"), original);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(
      await page.inputValue("#task-draft-text"),
      "Unsaved requirements\n",
    );
    await row(page, "Review API")
      .getByRole("button", { name: "Load", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Append to draft", exact: true })
      .click();
    assert.equal(
      await page.inputValue("#task-draft-text"),
      "Unsaved requirements\n\n\n" + original,
    );
    assert.equal(await page.inputValue("#task-draft-runtime"), "claude");
    await row(page, "Review API")
      .getByRole("button", { name: "Load", exact: true })
      .click();
    await page.fill("#task-draft-text", "Newer edit during review");
    await page
      .getByRole("button", { name: "Replace draft", exact: true })
      .click();
    assert.equal(
      await page.inputValue("#task-draft-text"),
      "Newer edit during review",
    );
    assert.match(
      await page.textContent("#prompt-library-status"),
      /draft changed/i,
    );
    await page
      .getByRole("button", { name: "Replace draft", exact: true })
      .click();
    assert.equal(await page.inputValue("#task-draft-text"), original);
    assert.equal(await page.inputValue("#task-draft-runtime"), "codex");
    assert.equal(
      await page.locator("#prompt-library-preview literal").count(),
      0,
    );
    await page.reload();
    await page.waitForFunction(() => initialized && settingsReady);
    await open(page);
    assert.equal(await row(page, "Review API").count(), 1);
    assert.equal(
      await page.inputValue("#task-draft-text"),
      "",
      "saving a reusable brief does not remember the current tab draft",
    );
    await row(page, "Review API")
      .getByRole("button", { name: "Load", exact: true })
      .click();
    assert.equal(await page.inputValue("#task-draft-text"), original);
    assert.deepEqual(accounting(await state()), before);
    assert.deepEqual(writes, []);
  });
});

test("search, rename and delete preserve focus across polls and fit a narrow touch workspace", async () => {
  await observerFixture(
    { viewport: { width: 320, height: 850 } },
    async ({ page }) => {
      await open(page);
      await save(page, "Review API", "Review the endpoint");
      await save(page, "Write docs", "Document the release", "claude");
      await page.fill("#prompt-library-search", "endpoint");
      assert.equal(
        await page.locator(".prompt-library-item:visible").count(),
        1,
      );
      await page.fill("#prompt-library-search", "");
      await row(page, "Review API")
        .getByRole("button", { name: "Rename", exact: true })
        .click();
      await page.fill("#prompt-library-rename", "Unsaved rename");
      await page.evaluate(async () => {
        window.renameField = document.querySelector("#prompt-library-rename");
        await poll();
      });
      assert.equal(
        await page.inputValue("#prompt-library-rename"),
        "Unsaved rename",
      );
      assert.equal(
        await page.evaluate(
          () => document.activeElement === window.renameField,
        ),
        true,
      );
      await page.keyboard.press("Enter");
      await page.waitForFunction(() =>
        /renamed/i.test(
          document.querySelector("#prompt-library-status").textContent,
        ),
      );
      assert.equal(await row(page, "Unsaved rename").count(), 1);
      await row(page, "Write docs")
        .getByRole("button", { name: "Delete", exact: true })
        .click();
      assert.equal(
        await row(page, "Write docs").count(),
        1,
        "delete is reviewed inline before storage changes",
      );
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await row(page, "Write docs")
        .getByRole("button", { name: "Delete", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Delete brief", exact: true })
        .click();
      await page.waitForFunction(() =>
        /deleted/i.test(
          document.querySelector("#prompt-library-status").textContent,
        ),
      );
      assert.equal(await row(page, "Write docs").count(), 0);
      const bounds = await page.evaluate(() => ({
        width: innerWidth,
        document: document.documentElement.scrollWidth,
        panel: document.querySelector("#sheet-tasks").getBoundingClientRect()
          .right,
      }));
      assert.ok(
        bounds.document <= bounds.width && bounds.panel <= bounds.width,
        JSON.stringify(bounds),
      );
      const reports = path.resolve(__dirname, "../reports/prompt-library");
      fs.mkdirSync(reports, { recursive: true });
      await page
        .locator("#prompt-library")
        .screenshot({ path: path.join(reports, "library-320.png") });
    },
  );
});

test("write failures, corrupt storage and stale tabs preserve both open drafts and saved data", async () => {
  await observerFixture({}, async ({ page, base }) => {
    await open(page);
    await save(page, "First brief", "Stored original");
    const original = await page.evaluate(
      (key) => localStorage.getItem(key),
      key,
    );
    await page.evaluate((key) => {
      window.failBriefWrite = true;
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (this === localStorage && name === key && window.failBriefWrite)
          throw new DOMException("Synthetic quota", "QuotaExceededError");
        return write.call(this, name, value);
      };
    }, key);
    await page.fill("#task-draft-text", "Keep my open work");
    await page.fill("#prompt-library-name", "Second brief");
    await page.click("#prompt-library-save");
    await page.waitForFunction(() =>
      /not saved|could not/i.test(
        document.querySelector("#prompt-library-status").textContent,
      ),
    );
    assert.equal(
      await page.inputValue("#task-draft-text"),
      "Keep my open work",
    );
    assert.equal(
      await page.evaluate((key) => localStorage.getItem(key), key),
      original,
    );
    await page.evaluate(() => (window.failBriefWrite = false));
    const other = await secondTab(page, base);
    await open(other);
    await save(other, "Other tab", "Stored elsewhere");
    await other.close();
    assert.match(
      await page.textContent("#prompt-library-status"),
      /another tab|changed/i,
    );
    assert.equal(
      await page.inputValue("#task-draft-text"),
      "Keep my open work",
    );
    await page.click("#prompt-library-save");
    await page.waitForFunction(() =>
      /Saved/.test(
        document.querySelector("#prompt-library-status").textContent,
      ),
    );
    assert.deepEqual(
      await page.evaluate(
        (key) =>
          JSON.parse(localStorage.getItem(key)).briefs.map((b) => b.name),
        key,
      ),
      ["First brief", "Other tab", "Second brief"],
    );
    await page.evaluate((key) => {
      localStorage.setItem(key, "{invalid");
    }, key);
    await page.click("#prompt-library-save");
    await page.waitForFunction(
      () =>
        document.querySelector("#prompt-library").getAttribute("aria-busy") ===
        "false",
    );
    assert.match(
      await page.textContent("#prompt-library-status"),
      /invalid.*untouched/i,
    );
    assert.equal(
      await page.inputValue("#task-draft-text"),
      "Keep my open work",
    );
    assert.equal(
      await page.evaluate((key) => localStorage.getItem(key), key),
      "{invalid",
    );
    assert.equal(await page.isDisabled("#prompt-library-save"), true);
  });
});

test("demo briefs use a separate namespace and unavailable browser storage leaves the draft usable", async () => {
  await observerFixture({}, async ({ page, base }) => {
    await open(page);
    await save(page, "Observer only", "Synthetic observer brief");
    await page.route(base + "/", async (route) => {
      const response = await route.fetch(),
        html = await response.text();
      await route.fulfill({
        response,
        body: html.replace("<body>", '<body data-agent-office-preview="1">'),
      });
    });
    await page.reload();
    await page.waitForFunction(() => initialized && settingsReady);
    await open(page);
    assert.equal(await page.locator(".prompt-library-item").count(), 0);
    await save(page, "Demo only", "Synthetic demo brief", "hermes");
    assert.deepEqual(
      await page.evaluate(() => [
        JSON.parse(
          localStorage.getItem("agent-office:prompt-library:v1:observer"),
        ).briefs[0].name,
        JSON.parse(
          localStorage.getItem("agent-office:prompt-library:v1:preview"),
        ).briefs[0].name,
      ]),
      ["Observer only", "Demo only"],
    );
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("Synthetic denial", "SecurityError");
        },
      });
    });
    await page.reload();
    await page.waitForFunction(() => initialized && settingsReady);
    await open(page);
    await page.fill("#task-draft-text", "Still editable");
    assert.match(
      await page.textContent("#prompt-library-status"),
      /unavailable/i,
    );
    assert.equal(await page.isDisabled("#prompt-library-save"), true);
    assert.equal(await page.isDisabled("#task-draft-copy"), false);
  });
});

test("two tabs saving together retain both briefs or surface a conflict before retry", async () => {
  await observerFixture({}, async ({ page, base }) => {
    await open(page);
    const other = await secondTab(page, base);
    await open(other);
    for (const [tab, name, text] of [
      [page, "First tab", "First tab work"],
      [other, "Second tab", "Second tab work"],
    ]) {
      await tab.fill("#task-draft-text", text);
      await tab.fill("#prompt-library-name", name);
    }
    await Promise.all([
      page.click("#prompt-library-save"),
      other.click("#prompt-library-save"),
    ]);
    for (const tab of [page, other])
      await tab.waitForFunction(
        () =>
          document
            .querySelector("#prompt-library")
            .getAttribute("aria-busy") === "false",
      );
    let stored = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)).briefs,
      key,
    );
    assert.ok(stored.length >= 1 && stored.length <= 2);
    if (stored.length === 1) {
      const missing = stored[0].name === "First tab" ? other : page;
      assert.match(
        await missing.textContent("#prompt-library-status"),
        /another tab|changed/i,
      );
      await missing.click("#prompt-library-save");
      await missing.waitForFunction(() =>
        /Saved/.test(
          document.querySelector("#prompt-library-status").textContent,
        ),
      );
      stored = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)).briefs,
        key,
      );
    }
    assert.deepEqual(stored.map((item) => [item.name, item.text]).sort(), [
      ["First tab", "First tab work"],
      ["Second tab", "Second tab work"],
    ]);
    assert.equal(await page.inputValue("#task-draft-text"), "First tab work");
    assert.equal(await other.inputValue("#task-draft-text"), "Second tab work");
    await other.close();
  });
});

test("queued rename and delete cannot claim cancellation while an authorized save is pending", async () => {
  await observerFixture({}, async ({ page }) => {
    await open(page);
    await save(page, "Reviewed brief", "Keep this reusable text");
    for (const action of ["rename", "delete"]) {
      const name = action === "rename" ? "Reviewed brief" : "Renamed brief";
      await row(page, name)
        .getByRole("button", {
          name: action === "rename" ? "Rename" : "Delete",
          exact: true,
        })
        .click();
      if (action === "rename")
        await page.fill("#prompt-library-rename", "Renamed brief");
      await page.evaluate((key) => {
        window.releaseReviewLock = null;
        window.holdReviewLock = navigator.locks.request(
          key,
          () => new Promise((resolve) => (window.releaseReviewLock = resolve)),
        );
      }, key);
      await page.waitForFunction(() => !!window.releaseReviewLock);
      await page
        .getByRole("button", {
          name: action === "rename" ? "Save name" : "Delete brief",
          exact: true,
        })
        .click();
      // aria-disabled keeps the real button focusable. Exercise a keyboard
      // activation, which reaches our handler even while a save is pending.
      await page.getByRole("button", { name: "Cancel", exact: true }).focus();
      await page.keyboard.press("Enter");
      assert.equal(
        await page.locator("#prompt-library-review").isVisible(),
        true,
      );
      await page.keyboard.press("Escape");
      assert.equal(
        await page.locator("#prompt-library-review").isVisible(),
        true,
      );
      assert.match(await page.textContent("#prompt-library-status"), /saving/i);
      assert.doesNotMatch(
        await page.textContent("#prompt-library-status"),
        /cancelled/i,
      );
      await page.fill(
        "#task-draft-text",
        "Newer draft while " + action + " waits",
      );
      await page.evaluate(() => window.releaseReviewLock());
      await page.waitForFunction(
        () =>
          document
            .querySelector("#prompt-library")
            .getAttribute("aria-busy") === "false",
      );
      assert.equal(
        await page.locator("#prompt-library-review").isVisible(),
        false,
      );
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "task-draft-text",
        "a completed " +
          action +
          " must not steal focus from newer draft edits",
      );
      if (action === "rename")
        assert.equal(await row(page, "Renamed brief").count(), 1);
      else assert.equal(await page.locator(".prompt-library-item").count(), 0);
    }
  });
});

test("a library change from another tab invalidates a queued rename before it can overwrite it", async () => {
  await observerFixture({}, async ({ page, base }) => {
    await open(page);
    await save(page, "Original brief", "Original text");
    const other = await secondTab(page, base);
    await page.evaluate((key) => {
      window.holdStaleLock = navigator.locks.request(
        key,
        () => new Promise((resolve) => (window.releaseStaleLock = resolve)),
      );
    }, key);
    await page.waitForFunction(() => !!window.releaseStaleLock);
    await row(page, "Original brief")
      .getByRole("button", { name: "Rename", exact: true })
      .click();
    await page.fill("#prompt-library-rename", "Queued old choice");
    await page.getByRole("button", { name: "Save name", exact: true }).click();
    await other.evaluate((key) => {
      const saved = JSON.parse(localStorage.getItem(key));
      saved.briefs[0].name = "Newer tab choice";
      localStorage.setItem(key, JSON.stringify(saved));
    }, key);
    await page.waitForFunction(() =>
      /another tab/i.test(
        document.querySelector("#prompt-library-status").textContent,
      ),
    );
    await page.evaluate(() => window.releaseStaleLock());
    await page.waitForFunction(
      () =>
        document.querySelector("#prompt-library").getAttribute("aria-busy") ===
        "false",
    );
    assert.match(
      await page.textContent("#prompt-library-status"),
      /another tab.*waiting/i,
    );
    assert.equal(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)).briefs[0].name,
        key,
      ),
      "Newer tab choice",
    );
    assert.equal(await page.inputValue("#task-draft-text"), "Original text");
    await other.close();
  });
});

test("browsers without coordinated tab saves retain readable briefs but disable unsafe mutations", async () => {
  await observerFixture({}, async ({ page }) => {
    await open(page);
    await save(page, "Readable brief", "Keep this saved text");
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "locks", { value: undefined }),
    );
    await page.reload();
    await page.waitForFunction(() => initialized && settingsReady);
    await open(page);
    assert.match(
      await page.textContent("#prompt-library-coordination"),
      /saving.*unavailable/i,
    );
    assert.equal(await page.isDisabled("#prompt-library-save"), true);
    assert.equal(
      await row(page, "Readable brief")
        .getByRole("button", { name: "Rename", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await row(page, "Readable brief")
        .getByRole("button", { name: "Delete", exact: true })
        .isDisabled(),
      true,
    );
    await row(page, "Readable brief")
      .getByRole("button", { name: "Load", exact: true })
      .click();
    assert.equal(
      await page.inputValue("#task-draft-text"),
      "Keep this saved text",
    );
  });
});

test("pending saves and storage failures preserve keyboard focus, and IME Escape keeps rename review open", async () => {
  await observerFixture({}, async ({ page }) => {
    await open(page);
    await page.fill("#task-draft-text", "Earlier draft for saving");
    await page.fill("#prompt-library-name", "Keyboard brief");
    await page.evaluate((key) => {
      window.holdBriefLock = navigator.locks.request(
        key,
        () => new Promise((resolve) => (window.releaseBriefLock = resolve)),
      );
    }, key);
    await page.waitForFunction(() => !!window.releaseBriefLock);
    await page.click("#prompt-library-save");
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "prompt-library-save",
      "waiting for a save must not blur the focused button",
    );
    await page.fill("#task-draft-text", "Newer edit while save waits");
    await page.evaluate(() => window.releaseBriefLock());
    await page.waitForFunction(() =>
      /Saved/.test(
        document.querySelector("#prompt-library-status").textContent,
      ),
    );
    assert.equal(
      await page.inputValue("#task-draft-text"),
      "Newer edit while save waits",
    );
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "task-draft-text",
      "save completion must not steal focus from newer edits",
    );
    assert.equal(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)).briefs[0].text,
        key,
      ),
      "Earlier draft for saving",
    );
    await row(page, "Keyboard brief")
      .getByRole("button", { name: "Rename", exact: true })
      .click();
    await page.fill("#prompt-library-rename", "Composing name");
    await page.evaluate(() => {
      const input = document.querySelector("#prompt-library-rename");
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          isComposing: true,
        }),
      );
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          keyCode: 229,
        }),
      );
    });
    assert.equal(
      await page.inputValue("#prompt-library-rename"),
      "Composing name",
    );
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "prompt-library-rename",
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator("#prompt-library-review").isVisible(),
      false,
    );
    await page.fill("#prompt-library-name", "Quota brief");
    await page.evaluate((key) => {
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (this === localStorage && name === key)
          throw new DOMException("Synthetic quota", "QuotaExceededError");
        return write.call(this, name, value);
      };
    }, key);
    await page.click("#prompt-library-save");
    await page.waitForFunction(() =>
      /not saved/i.test(
        document.querySelector("#prompt-library-status").textContent,
      ),
    );
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "prompt-library-save",
    );
    assert.equal(
      await page.inputValue("#task-draft-text"),
      "Newer edit while save waits",
    );
  });
});
