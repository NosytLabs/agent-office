/* Real file chooser/download flows, review races and keyboard recovery. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { observerFixture } = require("./observer-fixture.cjs");
const key = "agent-office:prompt-library:v1:observer";
const item = (id = "imported", name = "Imported brief") => ({
  id,
  name,
  runtime: "hermes",
  text: "Goal\n\n  Preserve exact text.\n",
});
const backup = (briefs = [item()]) => JSON.stringify({ version: 1, briefs });
async function open(page) {
  if (!(await page.locator('[data-task-view="draft"]').isVisible()))
    await page.click("#tasksbtn");
  await page.click('[data-task-view="draft"]');
}
async function settled(page) {
  await page.waitForFunction(
    () =>
      document.querySelector("#prompt-library").getAttribute("aria-busy") ===
      "false",
  );
}
async function save(page, name = "Current brief") {
  await page.fill("#task-draft-text", "Current text\n");
  await page.selectOption("#task-draft-runtime", "codex");
  await page.fill("#prompt-library-name", name);
  await page.click("#prompt-library-save");
  await settled(page);
}
async function choose(page, raw, name = "briefs.json") {
  const chooser = page.waitForEvent("filechooser");
  await page.click("#prompt-library-import");
  await (
    await chooser
  ).setFiles({ name, mimeType: "application/json", buffer: Buffer.from(raw) });
}
async function reviewed(page) {
  await page.waitForFunction(
    () => !!document.querySelector("#prompt-library-import-summary"),
  );
}
const stored = (page) => page.evaluate((key) => localStorage.getItem(key), key);
async function otherTab(page, base) {
  const popup = page.waitForEvent("popup");
  await page.evaluate((url) => window.open(url, "_blank"), base);
  const other = await popup;
  await other.waitForFunction(
    () =>
      typeof initialized !== "undefined" &&
      initialized &&
      typeof settingsReady !== "undefined" &&
      settingsReady,
  );
  return other;
}
async function hold(page) {
  await page.evaluate((key) => {
    window.releaseBackupLock = null;
    navigator.locks.request(
      key,
      () => new Promise((resolve) => (window.releaseBackupLock = resolve)),
    );
  }, key);
  await page.waitForFunction(() => !!window.releaseBackupLock);
}
async function visibleFocus(page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    return (
      active !== document.body &&
      !!active?.getClientRects().length &&
      !!active.closest("#sheet-tasks") &&
      !active.closest("[hidden]")
    );
  });
}

test("an external library change recovers visible focus after removing a pending rename review", async () => {
  await observerFixture({}, async ({ page, base }) => {
    await open(page);
    await save(page);
    const other = await otherTab(page, base);
    await page.getByRole("button", { name: "Rename", exact: true }).click();
    await page.fill("#prompt-library-rename", "Unsaved name");
    await hold(page);
    await page.getByRole("button", { name: "Save name", exact: true }).click();
    await other.evaluate((key) => {
      const data = JSON.parse(localStorage.getItem(key));
      data.briefs[0].name = "Newer name";
      localStorage.setItem(key, JSON.stringify(data));
    }, key);
    await page.waitForFunction(() =>
      /another tab/i.test(
        document.querySelector("#prompt-library-status").textContent,
      ),
    );
    assert.equal(
      await visibleFocus(page),
      true,
      "removing a review must recover a visible library focus target",
    );
    await page.evaluate(() => window.releaseBackupLock());
    await settled(page);
    assert.equal(
      await visibleFocus(page),
      true,
      "a failed queued save must not focus hidden Retry or body",
    );
    assert.equal(JSON.parse(await stored(page)).briefs[0].name, "Newer name");
    await other.close();
  });
});

test("a recovered read keeps keyboard focus visible when Retry disappears", async () => {
  await observerFixture({}, async ({ page }) => {
    await open(page);
    await save(page);
    await page.evaluate((key) => {
      window.failBackupRead = true;
      const read = Storage.prototype.getItem;
      Storage.prototype.getItem = function (name) {
        if (this === localStorage && name === key && window.failBackupRead)
          throw new DOMException("Synthetic read denial", "SecurityError");
        return read.call(this, name);
      };
    }, key);
    await page.click("#prompt-library-save");
    await settled(page);
    assert.equal(await page.locator("#prompt-library-retry").isVisible(), true);
    await page.evaluate(() => (window.failBackupRead = false));
    await page.locator("#prompt-library-retry").focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await page.locator("#prompt-library-retry").isVisible(),
      false,
    );
    assert.equal(
      await visibleFocus(page),
      true,
      "read recovery must not leave focus on body or hidden Retry",
    );
  });
});

test("corrupt data from another tab preserves draft and visible focus after invalidating a queued delete", async () => {
  await observerFixture({}, async ({ page, base }) => {
    await open(page);
    await save(page);
    const other = await otherTab(page, base);
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await hold(page);
    await page
      .getByRole("button", { name: "Delete brief", exact: true })
      .click();
    await other.evaluate((key) => localStorage.setItem(key, "{invalid"), key);
    await page.waitForFunction(() =>
      /invalid/i.test(
        document.querySelector("#prompt-library-status").textContent,
      ),
    );
    assert.equal(await visibleFocus(page), true);
    await page.evaluate(() => window.releaseBackupLock());
    await settled(page);
    assert.equal(await visibleFocus(page), true);
    assert.equal(await page.inputValue("#task-draft-text"), "Current text\n");
    assert.equal(await stored(page), "{invalid");
    await other.close();
  });
});

test("oversized, unreadable and invalid UTF-8 files leave the library and review focus untouched", async () => {
  await observerFixture({}, async ({ page }) => {
    await open(page);
    await save(page);
    const initial = await stored(page);
    await page.evaluate(() => {
      const read = File.prototype.arrayBuffer;
      window.backupReadAttempts = 0;
      File.prototype.arrayBuffer = function () {
        window.backupReadAttempts++;
        if (this.name === "unreadable.json")
          return Promise.reject(
            new DOMException("Synthetic read failure", "NotReadableError"),
          );
        return read.call(this);
      };
    });
    for (const [raw, name, message] of [
      [" ".repeat(1048577), "oversize.json", /too large/i],
      [backup(), "unreadable.json", /could not read/i],
      [Buffer.from([0xff, 0xfe, 0xff]), "encoding.json", /invalid/i],
    ]) {
      await choose(page, raw, name);
      await page.waitForFunction(() =>
        /too large|could not read|invalid/i.test(
          document.querySelector("#prompt-library-status").textContent,
        ),
      );
      assert.match(await page.textContent("#prompt-library-status"), message);
      assert.equal(await stored(page), initial);
      assert.equal(await visibleFocus(page), true);
      assert.equal(await page.inputValue("#task-draft-text"), "Current text\n");
      if (name === "oversize.json")
        assert.equal(
          await page.evaluate(() => window.backupReadAttempts),
          0,
          "reject oversized files before reading their contents",
        );
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
    }
  });
});

test("backup downloads and reviewed Merge/Replace preserve drafts and publish no work", async () => {
  await observerFixture({}, async ({ page, state }) => {
    const before = await state(),
      writes = [];
    page.on("request", (request) => {
      if (request.method() !== "GET") writes.push(request.url());
    });
    await open(page);
    await save(page);
    const initial = await stored(page);
    const download = page.waitForEvent("download");
    await page.click("#prompt-library-export");
    const file = await download;
    assert.equal(file.suggestedFilename(), "agent-office-briefs.json");
    assert.deepEqual(
      JSON.parse(fs.readFileSync(await file.path(), "utf8")),
      JSON.parse(initial),
    );
    await page.fill("#task-draft-text", "Keep this unsaved draft\n");
    await page.selectOption("#task-draft-runtime", "claude");
    await choose(page, backup());
    await reviewed(page);
    assert.equal(
      await stored(page),
      initial,
      "choosing a file only stages review",
    );
    assert.match(
      await page.textContent("#prompt-library-import-summary"),
      /1.*incoming.*1.*saved/i,
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await stored(page), initial);
    await choose(page, backup());
    await reviewed(page);
    await page
      .getByRole("button", { name: "Merge briefs", exact: true })
      .click();
    await settled(page);
    assert.deepEqual(
      JSON.parse(await stored(page)).briefs.map((entry) => entry.name),
      ["Current brief", "Imported brief"],
    );
    await choose(page, backup([item("replacement", "Only replacement")]));
    await reviewed(page);
    assert.match(
      await page.textContent("#prompt-library-replace-summary"),
      /2.*saved.*1/i,
    );
    await page
      .getByRole("button", { name: "Replace saved library", exact: true })
      .click();
    await settled(page);
    assert.deepEqual(
      JSON.parse(await stored(page)),
      JSON.parse(backup([item("replacement", "Only replacement")])),
    );
    assert.equal(
      await page.inputValue("#task-draft-text"),
      "Keep this unsaved draft\n",
    );
    assert.equal(await page.inputValue("#task-draft-runtime"), "claude");
    const after = await state();
    for (const field of ["progress", "usage", "events", "agents", "tasks"])
      assert.deepEqual(after[field], before[field]);
    assert.equal(after.tracking.received, before.tracking.received);
    assert.deepEqual(writes, []);
  });
});

test("invalid backups and merge conflicts are atomic; failed imports retain their review and keyboard focus", async () => {
  await observerFixture({}, async ({ page }) => {
    await open(page);
    await save(page);
    const initial = await stored(page);
    await choose(page, backup([item("different-id", "Current brief")]));
    await reviewed(page);
    assert.equal(
      await page
        .getByRole("button", { name: "Merge briefs", exact: true })
        .isDisabled(),
      true,
    );
    assert.match(
      await page.textContent("#prompt-library-merge-summary"),
      /same|already|conflict/i,
    );
    assert.equal(await stored(page), initial);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await choose(
      page,
      JSON.stringify({ version: 1, briefs: [item()], extra: "unsupported" }),
    );
    await page.waitForFunction(() =>
      /invalid/i.test(
        document.querySelector("#prompt-library-status").textContent,
      ),
    );
    assert.equal(await stored(page), initial);
    await choose(page, backup());
    await reviewed(page);
    await page.evaluate((key) => {
      window.failBackupWrite = true;
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (this === localStorage && name === key && window.failBackupWrite)
          throw new DOMException("Synthetic quota", "QuotaExceededError");
        return original.call(this, name, value);
      };
      window.importReview = document.querySelector("#prompt-library-review");
    }, key);
    await page
      .getByRole("button", { name: "Merge briefs", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await settled(page);
    assert.equal(await stored(page), initial);
    assert.match(
      await page.textContent("#prompt-library-status"),
      /not saved/i,
    );
    assert.equal(
      await page.evaluate(() => document.activeElement.textContent),
      "Merge briefs",
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.importReview ===
          document.querySelector("#prompt-library-review"),
      ),
      true,
    );
    await page.evaluate(() => (window.failBackupWrite = false));
    await page.keyboard.press("Enter");
    await settled(page);
    assert.equal(JSON.parse(await stored(page)).briefs.length, 2);
  });
});

test("superseded, cancelled and hidden-panel file reads cannot replace newer review", async () => {
  await observerFixture({}, async ({ page }) => {
    await open(page);
    await save(page);
    const initial = await stored(page);
    await page.evaluate(() => {
      const read = File.prototype.arrayBuffer;
      window.pendingBackupReads = [];
      File.prototype.arrayBuffer = function () {
        if (!this.name.startsWith("slow")) return read.call(this);
        return new Promise((resolve, reject) =>
          window.pendingBackupReads.push(() =>
            read.call(this).then(resolve, reject),
          ),
        );
      };
    });
    await choose(page, backup([item("old", "Older file")]), "slow-old.json");
    await page.waitForFunction(() => window.pendingBackupReads.length === 1);
    await choose(page, backup([item("new", "Newest file")]), "new.json");
    await reviewed(page);
    await page.evaluate(() => window.pendingBackupReads.shift()());
    assert.match(
      await page.textContent("#prompt-library-review"),
      /Newest file/,
    );
    assert.doesNotMatch(
      await page.textContent("#prompt-library-review"),
      /Older file/,
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await choose(page, backup(), "slow-cancel.json");
    await page.waitForFunction(() => window.pendingBackupReads.length === 1);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.evaluate(() => window.pendingBackupReads.shift()());
    assert.equal(
      await page.locator("#prompt-library-review").isVisible(),
      false,
    );
    await choose(page, backup(), "slow-hidden.json");
    await page.waitForFunction(() => window.pendingBackupReads.length === 1);
    await page.locator("#sheet-tasks .close").click();
    await open(page);
    await page.getByRole("button", { name: "Rename", exact: true }).click();
    await page.fill("#prompt-library-rename", "Keep this newer review");
    await page.evaluate(() => window.pendingBackupReads.shift()());
    assert.equal(
      await page.inputValue("#prompt-library-rename"),
      "Keep this newer review",
    );
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "prompt-library-rename",
    );
    assert.equal(await stored(page), initial);
  });
});

test("an earlier file read cannot replace saving feedback after a later Save current draft", async () => {
  await observerFixture({}, async ({ page }) => {
    await open(page);
    await save(page);
    await page.evaluate(() => {
      const read = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = function () {
        return new Promise(
          (resolve, reject) =>
            (window.releaseOlderBackup = () =>
              read.call(this).then(resolve, reject)),
        );
      };
    });
    await choose(page, backup());
    await page.waitForFunction(() => !!window.releaseOlderBackup);
    await page.fill("#prompt-library-name", "Newer save");
    await hold(page);
    await page.click("#prompt-library-save");
    await page.evaluate(() => window.releaseOlderBackup());
    assert.equal(
      await page.locator("#prompt-library-review").isVisible(),
      false,
      "the older file must not replace the newer pending action",
    );
    assert.match(await page.textContent("#prompt-library-status"), /saving/i);
    await page.evaluate(() => window.releaseBackupLock());
    await settled(page);
    assert.deepEqual(
      JSON.parse(await stored(page)).briefs.map((entry) => entry.name),
      ["Current brief", "Newer save"],
    );
  });
});

test("a staged import refuses changed storage or a panel closed while its commit waits", async () => {
  await observerFixture({}, async ({ page, base }) => {
    await open(page);
    await save(page);
    const other = await otherTab(page, base);
    await choose(page, backup());
    await reviewed(page);
    await hold(page);
    await page
      .getByRole("button", { name: "Replace saved library", exact: true })
      .click();
    await other.evaluate((key) => {
      const data = JSON.parse(localStorage.getItem(key));
      data.briefs[0].name = "Changed elsewhere";
      localStorage.setItem(key, JSON.stringify(data));
    }, key);
    await page.waitForFunction(() =>
      /another tab/i.test(
        document.querySelector("#prompt-library-status").textContent,
      ),
    );
    await page.evaluate(() => window.releaseBackupLock());
    await settled(page);
    assert.equal(
      JSON.parse(await stored(page)).briefs[0].name,
      "Changed elsewhere",
    );
    await choose(page, backup());
    await reviewed(page);
    await hold(page);
    await page
      .getByRole("button", { name: "Replace saved library", exact: true })
      .click();
    await page.locator("#sheet-tasks .close").click();
    await open(page);
    await page.evaluate(() => window.releaseBackupLock());
    await settled(page);
    assert.equal(
      JSON.parse(await stored(page)).briefs[0].name,
      "Changed elsewhere",
    );
    assert.equal(await page.inputValue("#task-draft-text"), "Current text\n");
    assert.equal(
      await page.locator("#prompt-library-review").isVisible(),
      false,
    );
    await other.close();
  });
});

test("320px keyboard import review stays readable and missing coordination permits export only", async () => {
  await observerFixture(
    { viewport: { width: 320, height: 850 } },
    async ({ page }) => {
      await open(page);
      await save(page);
      const chooser = page.waitForEvent("filechooser");
      await page.locator("#prompt-library-import").focus();
      await page.keyboard.press("Enter");
      await (
        await chooser
      ).setFiles({
        name: "keyboard.json",
        mimeType: "application/json",
        buffer: Buffer.from(backup()),
      });
      await reviewed(page);
      assert.equal(await visibleFocus(page), true);
      await page.locator("#prompt-library-review summary").click();
      const report = path.resolve(__dirname, "../reports/prompt-library");
      fs.mkdirSync(report, { recursive: true });
      await page
        .locator("#prompt-library-review")
        .screenshot({ path: path.join(report, "backup-320.png") });
      await page
        .getByRole("button", { name: "Merge briefs", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await settled(page);
      const bounds = await page.evaluate(() => ({
        width: innerWidth,
        document: document.documentElement.scrollWidth,
        right: document.querySelector("#sheet-tasks").getBoundingClientRect()
          .right,
      }));
      assert.ok(
        bounds.document <= bounds.width && bounds.right <= bounds.width,
        JSON.stringify(bounds),
      );
      await page.addInitScript(() =>
        Object.defineProperty(navigator, "locks", { value: undefined }),
      );
      await page.reload();
      await page.waitForFunction(() => initialized && settingsReady);
      await open(page);
      const download = page.waitForEvent("download");
      await page.click("#prompt-library-export");
      assert.equal(
        JSON.parse(fs.readFileSync(await (await download).path(), "utf8"))
          .briefs.length,
        2,
      );
      const initial = await stored(page);
      await choose(page, backup());
      await reviewed(page);
      assert.equal(
        await page
          .getByRole("button", { name: "Merge briefs", exact: true })
          .isDisabled(),
        true,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Replace saved library", exact: true })
          .isDisabled(),
        true,
      );
      assert.equal(await stored(page), initial);
    },
  );
});
