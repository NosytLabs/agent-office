/* The office is a session dashboard first: readable triage and safe handoff. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { observerFixture } = require("./observer-fixture.cjs");
const events = [
  { event: "session_start", session_id: "release-check", platform: "claude" },
  { event: "approval_request", session_id: "release-check", platform: "claude", command: "npm test -- --runInBand", request_id: "approval-1" },
  { event: "session_start", session_id: "api-work", platform: "opencode" },
  { event: "tool_start", session_id: "api-work", platform: "opencode", tool_name: "read", preview: "src/api/session.ts", call_id: "read-1" },
];
const openInspector = async (page) => {
  await page.locator("#floorbtn").click();
  await page.locator('#roster [data-agent="release-check"]').click();
};

test("a complete first session fits a narrow screen without squeezed card text", async () => {
  await observerFixture({ events, viewport: { width: 320, height: 568 } }, async ({ page }) => {
    await page.locator("#floorbtn").click();
    const geometry = await page.locator("#roster .agent-card").first().evaluate((card) => ({
      bottom: card.getBoundingClientRect().bottom,
      textWidth: card.querySelector(".agent-copy").getBoundingClientRect().width,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    assert.ok(geometry.bottom <= 544, JSON.stringify(geometry));
    assert.ok(geometry.textWidth >= 180, JSON.stringify(geometry));
    assert.equal(geometry.overflow, false);
    fs.mkdirSync("reports/daily", { recursive: true });
    await page.screenshot({ path: "reports/daily/agents-320.jpg", type: "jpeg", quality: 45 });
    console.log("MOBILE_SESSION_GEOMETRY", JSON.stringify(geometry));
    for (const key of ["waiting", "ended", "all"]) {
      const button = page.locator(`[data-roster-status="${key}"]`);
      await button.focus();
      await button.press("Enter");
      const box = await button.boundingBox();
      assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= 321);
    }
  });
});

test("operational details precede personalization and customization stays reachable", async () => {
  await observerFixture({ events }, async ({ page }) => {
    await openInspector(page);
    const ordered = await page.evaluate(() => !!(document.getElementById("inspectorbox").compareDocumentPosition(document.getElementById("agent-name-form")) & Node.DOCUMENT_POSITION_FOLLOWING));
    assert.equal(ordered, true);
    assert.equal(await page.locator("#inspector-customize").count(), 1);
    await page.locator("#inspector-customize").click();
    assert.equal(await page.evaluate(() => document.activeElement.id), "agent-name-input");
    await page.locator("#sheet-inspector .sheet-back").click();
    assert.equal(await page.evaluate(() => document.activeElement.dataset.agent), "release-check");
  });
});

test("unchanged inspector polling preserves selected command and session text", async () => {
  await observerFixture({ events }, async ({ page }) => {
    await openInspector(page);
    for (const selector of ["#inspector-summary p", '[data-inspector-section="metadata"] .kv b']) {
      const result = await page.evaluate((selector) => {
        const node = document.querySelector(selector), range = document.createRange();
        range.selectNodeContents(node);
        getSelection().removeAllRanges(); getSelection().addRange(range);
        const before = getSelection().toString();
        agents.find((agent) => agent.id === focusedId).duration_s += 3;
        fillInspector();
        return { connected: node.isConnected, before, after: getSelection().toString() };
      }, selector);
      assert.equal(result.connected, true, selector);
      assert.equal(result.after, result.before, selector);
    }
  });
});

test("Copy summary copies a scoped snapshot without commands, XP or settings writes", async () => {
  await observerFixture({ events }, async ({ page, state }) => {
    const xp = (await state()).progress.xp;
    const writes = [];
    page.on("request", (request) => { if (request.method() !== "GET") writes.push(request.url()); });
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.copiedReport = text; } } }));
    await openInspector(page);
    assert.equal(await page.locator("#inspector-copy").count(), 1);
    await page.locator("#inspector-copy").click();
    const text = await page.evaluate(() => window.copiedReport);
    assert.match(text, /Session: release-check/);
    assert.match(text, /Runtime: Claude Code/);
    assert.match(text, /npm test -- --runInBand/);
    assert.match(text, /snapshot|Snapshot/);
    assert.doesNotMatch(text, /api-work|src\/api\/session\.ts/);
    assert.deepEqual(writes, []);
    assert.equal((await state()).progress.xp, xp);
  });
});

test("clipboard failure leaves a selectable frozen report labeled as retained data", async () => {
  await observerFixture({ events }, async ({ page }) => {
    await openInspector(page);
    assert.equal(await page.locator("#inspector-copy").count(), 1);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("Denied"); } } });
      offline = true; fillInspector();
    });
    await page.locator("#inspector-copy").click();
    const field = page.locator("#inspector-report-text");
    const captured = await field.inputValue();
    assert.match(captured, /disconnected|Disconnected/);
    assert.match(captured, /retained|Retained/);
    assert.equal(await field.isVisible(), true);
    await page.evaluate(() => { fillInspector(); });
    assert.equal(await field.inputValue(), captured);
    assert.equal(await field.evaluate((el) => el.selectionEnd - el.selectionStart), captured.length);
    await page.evaluate(() => selectAgent("api-work"));
    assert.equal(await field.inputValue(), "");
  });
});

test("a late copy rejection never inserts another session's report", async () => {
  await observerFixture({ events }, async ({ page }) => {
    await openInspector(page);
    assert.equal(await page.locator("#inspector-copy").count(), 1);
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => new Promise((resolve, reject) => { window.rejectReport = reject; }) } }));
    await page.locator("#inspector-copy").click();
    await page.evaluate(() => selectAgent("api-work"));
    await page.evaluate(() => window.rejectReport(new Error("Denied later")));
    assert.equal(await page.locator("#inspector-report-text").inputValue(), "");
    assert.doesNotMatch(await page.locator("#inspector-copy-status").innerText(), /release-check/);
  });
});

test("Help describes the actual optional runner and all installed observers", async () => {
  await observerFixture({}, async ({ page }) => {
    await page.evaluate(() => openSheet("sheet-legend"));
    const help = await page.locator("#sheet-legend").innerText();
    assert.match(help, /Local runs/);
    assert.match(help, /Codex/);
    assert.match(help, /Gemini/);
    assert.doesNotMatch(help, /does not run tasks/);
  });
});

test("mobile inspector shows session data without scrolling past cosmetics", async () => {
  await observerFixture({ events, viewport: { width: 320, height: 568 } }, async ({ page }) => {
    await openInspector(page);
    const box = await page.locator("#inspectorbox").boundingBox();
    assert.ok(box.y < 500, `Session data begins at ${box.y}px`);
    fs.mkdirSync("reports/daily", { recursive: true });
    await page.screenshot({ path: "reports/daily/inspector-320.jpg", type: "jpeg", quality: 45 });
    console.log("MOBILE_INSPECTOR_TOP", box.y);
  });
});

test("an unavailable request timestamp is never printed as Invalid Date", async () => {
  await observerFixture({ events }, async ({ page }) => {
    await openInspector(page);
    await page.evaluate(() => {
      const agent = agents.find((value) => value.id === focusedId);
      agent.observed_at = undefined; agent.updated_at = undefined;
      fillInspector();
    });
    const summary = await page.locator("#inspector-summary").innerText();
    assert.doesNotMatch(summary, /Invalid Date/);
    assert.match(summary, /time not reported/);
  });
});
