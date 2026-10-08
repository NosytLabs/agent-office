const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { observerFixture } = require("./observer-fixture.cjs");

// Capture evidence after a paint opportunity and verify the saved image itself.
// This deliberately has no screenshot retries or expected font/pixel snapshot.
async function captureVisibleDraft(page, filename) {
  const sample = await page.evaluate(async () => {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const sheet = document
      .querySelector("#sheet-tasks")
      .getBoundingClientRect();
    const clip = (element) => {
      const rect = element.getBoundingClientRect();
      const left = Math.ceil(Math.max(0, sheet.left, rect.left));
      const top = Math.ceil(Math.max(0, sheet.top, rect.top));
      const right = Math.floor(Math.min(innerWidth, sheet.right, rect.right));
      const bottom = Math.floor(
        Math.min(innerHeight, sheet.bottom, rect.bottom),
      );
      return { x: left, y: top, width: right - left, height: bottom - top };
    };
    const header = document.querySelector("#sheet-tasks .sheet-header");
    const title = header.querySelector("h2");
    return {
      regions: [header, document.querySelector("#task-draft-text")].map(
        (el) => ({
          name: el.id || el.className,
          rect: clip(el),
          visibility: getComputedStyle(el).visibility,
        }),
      ),
      title: clip(title),
      foreground: getComputedStyle(title).color,
      background: getComputedStyle(header).backgroundColor,
    };
  });
  for (const region of [
    ...sample.regions,
    { name: "Task title", rect: sample.title },
  ]) {
    assert.ok(
      region.rect.width > 0 &&
        region.rect.height > 0 &&
        region.visibility !== "hidden",
      `${region.name} must intersect the visible sheet: ${JSON.stringify(region)}`,
    );
  }
  const png = await page.screenshot({
    path: filename,
    fullPage: true,
    scale: "css",
  });
  const painted = await page.evaluate(
    async ({ encoded, sample }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${encoded}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      const rgb = (color) => {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
      };
      const foreground = rgb(sample.foreground),
        background = rgb(sample.background);
      const distance = (a, b) =>
        a.reduce((sum, channel, i) => sum + Math.abs(channel - b[i]), 0);
      const contrast = distance(foreground, background);
      canvas.width = image.width;
      canvas.height = image.height;
      context.drawImage(image, 0, 0);
      const { x, y, width, height } = sample.title;
      const pixels = context.getImageData(x, y, width, height).data;
      let ink = 0,
        paper = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const color = pixels.subarray(i, i + 3);
        if (distance(foreground, color) < contrast / 3) ink++;
        if (distance(background, color) < contrast / 3) paper++;
      }
      return { ink, paper, contrast };
    },
    { encoded: png.toString("base64"), sample },
  );
  assert.ok(
    painted.ink > 0 && painted.paper > 0,
    `Saved Task title must contain foreground text and background: ${JSON.stringify(painted)}`,
  );
  return { sample, painted };
}

async function openDraft(page) {
  await page.click("#tasksbtn");
  assert.equal(
    await page.locator('[data-task-view="draft"]').count(),
    1,
    "Tasks needs a real draft workspace",
  );
  await page.click('[data-task-view="draft"]');
}

test("drafting and panel changes preserve text without manufacturing activity", async () => {
  await observerFixture({}, async ({ page, state }) => {
    const before = await state();
    await openDraft(page);
    const text =
      "Inspect these changes.\n<article>must stay literal</article>\nDo not run anything yet.";
    await page.fill("#task-draft-text", text);
    await page.click('[data-task-view="activity"]');
    await page.click('[data-task-view="draft"]');
    assert.equal(await page.inputValue("#task-draft-text"), text);
    await page.locator("#sheet-tasks .close").click();
    await openDraft(page);
    assert.equal(await page.inputValue("#task-draft-text"), text);
    const after = await state();
    assert.deepEqual(after.progress, before.progress);
    assert.deepEqual(after.agents, before.agents);
    assert.deepEqual(after.tasks, before.tasks);
    assert.deepEqual(
      await page.evaluate(() => Object.keys(sessionStorage)),
      [],
    );
  });
});

test("copy uses exact current text and never issues an execution request", async () => {
  await observerFixture({}, async ({ page }) => {
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    const writes = [];
    page.on("request", (r) => {
      if (r.method() !== "GET") writes.push(r.url());
    });
    await openDraft(page);
    const text =
      "Review the API\n\nInclude tests and report remaining limits.\n";
    await page.fill("#task-draft-text", text);
    await page.selectOption("#task-draft-runtime", "claude");
    await page.click("#task-draft-copy");
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      text,
    );
    assert.match(
      await page.textContent("#task-draft-status"),
      /Copied.*Claude Code/,
    );
    assert.deepEqual(writes, []);
  });
});

test("draft persistence is explicit and switching it off removes the stored draft", async () => {
  await observerFixture({}, async ({ page }) => {
    await openDraft(page);
    await page.fill("#task-draft-text", "Remember only in this tab");
    await page.selectOption("#task-draft-runtime", "hermes");
    await page.check("#task-draft-remember");
    await page.reload();
    await page.waitForFunction(() => initialized && settingsReady);
    await page.locator('[data-task-view="draft"]').click();
    assert.equal(
      await page.inputValue("#task-draft-text"),
      "Remember only in this tab",
    );
    assert.equal(await page.inputValue("#task-draft-runtime"), "hermes");
    await page.uncheck("#task-draft-remember");
    await page.reload();
    await page.waitForFunction(() => initialized && settingsReady);
    await page.locator('[data-task-view="draft"]').click();
    assert.equal(await page.inputValue("#task-draft-text"), "");
  });
});

test("failed draft removal remains visible and retries without saving newer text", async () => {
  await observerFixture({}, async ({ page }) => {
    await openDraft(page);
    const original = "Previously remembered draft";
    const newer = "Keep this newer text only on the open page";
    await page.fill("#task-draft-text", original);
    await page.check("#task-draft-remember");
    await page.evaluate(() => {
      sessionStorage.setItem("unrelated-draft-test", "keep");
      window.failDraftRemoval = true;
      const remove = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function (key) {
        if (
          this === sessionStorage &&
          key === "agent-office:task-draft:v1:observer" &&
          window.failDraftRemoval
        )
          throw new DOMException("Injected removal denial", "SecurityError");
        return remove.call(this, key);
      };
    });

    await page.click("#task-draft-remember");
    assert.equal(await page.isChecked("#task-draft-remember"), true);
    assert.match(
      await page.textContent("#task-draft-status"),
      /could not remove/i,
    );
    assert.match(await page.textContent("#task-draft-status"), /still stored/i);
    assert.equal(await page.inputValue("#task-draft-text"), original);
    await page.fill("#task-draft-text", newer);
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(
            sessionStorage.getItem("agent-office:task-draft:v1:observer"),
          ).text,
      ),
      original,
      "A failed opt-out must not start saving newer edits again",
    );

    await page.evaluate(() => {
      window.failDraftRemoval = false;
    });
    await page.click("#task-draft-remember");
    assert.equal(await page.isChecked("#task-draft-remember"), false);
    assert.match(
      await page.textContent("#task-draft-status"),
      /stored draft removed/i,
    );
    assert.equal(await page.inputValue("#task-draft-text"), newer);
    assert.deepEqual(
      await page.evaluate(() => [
        sessionStorage.getItem("agent-office:task-draft:v1:observer"),
        sessionStorage.getItem("unrelated-draft-test"),
      ]),
      [null, "keep"],
    );
    await page.reload();
    await page.waitForFunction(() => initialized && settingsReady);
    assert.equal(await page.inputValue("#task-draft-text"), "");
    assert.equal(await page.isChecked("#task-draft-remember"), false);
  });
});

test("template save failure discloses the retained draft until storage recovers", async () => {
  await observerFixture({}, async ({ page }) => {
    await openDraft(page);
    const original = "Keep my saved requirements";
    await page.fill("#task-draft-text", original);
    await page.check("#task-draft-remember");
    await page.evaluate(() => {
      sessionStorage.setItem("unrelated-draft-test", "keep");
      window.failDraftWrite = true;
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (
          this === sessionStorage &&
          key === "agent-office:task-draft:v1:observer" &&
          window.failDraftWrite
        )
          throw new DOMException("Injected write denial", "QuotaExceededError");
        return write.call(this, key, value);
      };
    });

    await page.click("#task-draft-template");
    const appended = await page.inputValue("#task-draft-text");
    assert.ok(appended.startsWith(original + "\n\nGoal\n"));
    assert.match(await page.textContent("#task-draft-status"), /not saved/i);
    assert.match(
      await page.textContent("#task-draft-status"),
      /previous draft.*still stored/i,
    );
    assert.equal(await page.isChecked("#task-draft-remember"), true);
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(
            sessionStorage.getItem("agent-office:task-draft:v1:observer"),
          ).text,
      ),
      original,
    );
    const download = page.waitForEvent("download");
    await page.click("#task-draft-export");
    await download;
    assert.match(await page.textContent("#task-draft-status"), /not saved/i);

    await page.evaluate(() => {
      window.failDraftWrite = false;
    });
    const recovered = appended + "\nCheck the final behavior.";
    await page.fill("#task-draft-text", recovered);
    assert.doesNotMatch(
      await page.textContent("#task-draft-status"),
      /not saved/i,
    );
    assert.deepEqual(
      await page.evaluate(() => [
        JSON.parse(
          sessionStorage.getItem("agent-office:task-draft:v1:observer"),
        ).text,
        sessionStorage.getItem("unrelated-draft-test"),
      ]),
      [recovered, "keep"],
    );
    await page.reload();
    await page.waitForFunction(() => initialized && settingsReady);
    assert.equal(await page.inputValue("#task-draft-text"), recovered);
    assert.equal(await page.isChecked("#task-draft-remember"), true);
  });
});

test("templates append without erasing work; export contains the exact draft", async () => {
  await observerFixture({}, async ({ page }) => {
    await openDraft(page);
    await page.fill("#task-draft-text", "Keep my requirements");
    await page.click("#task-draft-template");
    const text = await page.inputValue("#task-draft-text");
    assert.ok(text.startsWith("Keep my requirements\n\n"));
    assert.match(text, /Verification/);
    const pending = page.waitForEvent("download");
    await page.click("#task-draft-export");
    const download = await pending;
    assert.equal(fs.readFileSync(await download.path(), "utf8"), text);
  });
});

test("clipboard denial keeps a selectable draft and narrow layout stays within the viewport", async () => {
  await observerFixture({}, async ({ page }) => {
    await openDraft(page);
    await page.evaluate(() => {
      navigator.clipboard.writeText = async () => {
        throw new Error("denied");
      };
    });
    await page.fill("#task-draft-text", "A".repeat(200));
    await page.click("#task-draft-copy");
    assert.match(await page.textContent("#task-draft-status"), /could not/);
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "task-draft-text",
    );
    const reports = path.resolve(__dirname, "../reports/task-desk");
    fs.mkdirSync(reports, { recursive: true });
    for (const width of [320, 375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const sizes = await page.evaluate(() => ({
        vw: innerWidth,
        page: document.documentElement.scrollWidth,
        panel: document.querySelector("#sheet-tasks").getBoundingClientRect()
          .right,
      }));
      assert.ok(
        sizes.page <= sizes.vw && sizes.panel <= sizes.vw,
        JSON.stringify(sizes),
      );
      if (width === 320 || width === 1440)
        await captureVisibleDraft(
          page,
          path.join(reports, `draft-${width}.png`),
        );
    }
  });
});
