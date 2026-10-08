/* Product flows against a real isolated observer, with synthetic test records. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
const baseURL = "http://127.0.0.1:18118";
const root = path.resolve(__dirname, "..");
const screenshots =
  process.env.OFFICE_PRODUCT_SCREENSHOTS ||
  path.join(root, "reports/product-ui");
let home, log, server;
const record = (event, session_id = "a", extra = {}) => ({
  event,
  session_id,
  platform: "claude",
  ts: Date.now() / 1000,
  ...extra,
});
before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "office-product-"));
  fs.mkdirSync(path.join(home, "pixel-office"));
  log = path.join(home, "pixel-office/events.jsonl");
  const rows = [
    record("session_start", "a", { title: "Build the API" }),
    record("session_start", "b", {
      title: "Review docs",
      platform: "opencode",
    }),
    record("approval_request", "old-wait", {
      request_id: "historical",
      command: "An old unanswered request",
      ts: Date.now() / 1000 - 7200,
    }),
    ...Array.from({ length: 60 }, (_, i) =>
      record("tool_start", "a", {
        call_id: "read-" + i,
        tool_name: "Read",
        activity: "reading",
        preview: "older-file-" + i + ".js",
      }),
    ),
    record("usage", "a", {
      usage_id: "m1",
      model: "test-model",
      provider: "test-provider",
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
      cached_input_tokens: 10,
      reasoning_output_tokens: 5,
      cost_usd: 0.0123,
      cost_source: "test runtime estimate",
    }),
    record("usage", "a", {
      usage_id: "m2",
      model: "test-model",
      provider: "test-provider",
      output_tokens: 25,
    }),
  ];
  fs.writeFileSync(log, rows.map(JSON.stringify).join("\n") + "\n");
  server = spawn(
    process.env.PYTHON || "python",
    ["run.py", "--port", "18118"],
    {
      cwd: root,
      env: { ...process.env, HERMES_HOME: home, AGENT_OFFICE_DEMO: "1" },
      stdio: "ignore",
    },
  );
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(baseURL + "/state")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Product test observer did not start");
});
after(async () => {
  if (server) {
    server.kill();
    await new Promise((r) => server.once("exit", r));
  }
  if (home) fs.rmSync(home, { recursive: true, force: true });
});
async function withPage(run, options = {}) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox"],
  });
  try {
    const p = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      ...options,
    });
    p.setDefaultTimeout(10000);
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(baseURL);
    await p.waitForFunction(() => initialized);
    await p.evaluate(() => document.fonts.ready);
    await run(p);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}
async function capture(p, name) {
  fs.mkdirSync(screenshots, { recursive: true });
  await p.screenshot({
    path: path.join(screenshots, name + ".png"),
    fullPage: true,
  });
}
test("office and agent names persist, while typing survives live polling", () =>
  withPage(async (p) => {
    await p.click("#settingsbtn");
    await p.fill("#room-name-input", "North Office");
    await p.click("#room-name-save");
    await p.waitForFunction(() => pendingSaves === 0);
    assert.equal(await p.textContent("#room-name"), "North Office");
    await p.keyboard.press("Escape");
    await p.click("#floorbtn");
    await p.click('#roster [data-agent="a"]');
    await p.fill("#agent-name-input", "Coder One");
    await p.click("#agent-name-save");
    await p.waitForFunction(() => pendingSaves === 0);
    assert.match(await p.textContent("#inspector-summary"), /Coder One/);
    await p.fill("#agent-name-input", "Draft name");
    await p.locator("#inspect-history").focus();
    await p.waitForTimeout(1700);
    assert.equal(await p.inputValue("#agent-name-input"), "Draft name");
    await p.reload();
    await p.waitForFunction(() => initialized);
    assert.equal(await p.textContent("#room-name"), "North Office");
    await p.click("#floorbtn");
    assert.match(await p.textContent('#roster [data-agent="a"]'), /Coder One/);
    await p.click('#roster [data-agent="a"]');
    await capture(p, "agent-details-usage");
    await p.click("#inspect-history");
    await p.waitForFunction(() => historyLoaded && !historyLoading);
    const identities = await p
      .locator("#eventbox .event-identity")
      .allTextContents();
    assert.ok(identities.length > 30);
    assert.ok(identities.every((text) => text === "claude · a"));
    assert.equal(await p.isVisible("#clear-session-filter"), true);
    await p.click("#clear-session-filter");
    assert.match(await p.textContent("#eventbox"), /old-wait/);
  }));
test("usage shows exact known metrics, partial coverage, model sources, and unknown sessions", () =>
  withPage(async (p) => {
    await p.click("#floorbtn");
    const cards = p.locator("#usagebox .usage-card");
    assert.equal(await cards.nth(0).locator("strong").textContent(), "100");
    assert.equal(await cards.nth(1).locator("strong").textContent(), "45");
    assert.equal(await cards.nth(2).locator("strong").textContent(), "120");
    assert.equal(await cards.nth(3).locator("strong").textContent(), "$0.0123");
    assert.match(await cards.nth(0).textContent(), /1 of 2 reports.*partial/);
    await p.click(".usage-breakdown summary");
    assert.match(await p.textContent("#usage-breakdown"), /test-model/);
    assert.match(
      await p.textContent("#usage-breakdown"),
      /test runtime estimate/,
    );
    await p.locator("#usagebox").scrollIntoViewIfNeeded();
    await capture(p, "reported-usage");
    await p.click('#roster [data-agent="b"]');
    assert.match(await p.textContent("#inspectorbox"), /Not reported/);
    assert.doesNotMatch(await p.textContent("#inspectorbox"), /\$0\.00/);
    const brands = await p
      .locator("#inspectorbox .runtime-badge img")
      .evaluateAll((images) =>
        images.every((image) => image.complete && image.naturalWidth > 0),
      );
    assert.equal(brands, true);
  }));
test("Hermes transport sessions show canonical runtime usage in the inspector", () =>
  withPage(async (p) => {
    fs.appendFileSync(
      log,
      [
        record("session_start", "transport-session", {
          platform: "telegram",
          title: "Telegram assistant",
        }),
        record("usage", "transport-session", {
          platform: "hermes",
          usage_id: "hermes-report",
          input_tokens: 31,
        }),
      ]
        .map(JSON.stringify)
        .join("\n") + "\n",
    );
    await p.waitForFunction(() =>
      agents.some((a) => a.id === "transport-session"),
    );
    await p.click("#floorbtn");
    await p.click('#roster [data-agent="transport-session"]');
    assert.equal(
      await p
        .locator("#inspectorbox .usage-card")
        .first()
        .locator("strong")
        .textContent(),
      "31",
    );
    assert.match(
      await p.textContent("#inspectorbox .runtime-badge"),
      /Telegram/,
    );
    await p.click("#inspect-history");
    await p.waitForFunction(() => historyLoaded && !historyLoading);
    assert.equal(await p.locator("#eventbox .event").count(), 2);
    assert.match(await p.textContent("#eventbox"), /usage/i);
  }));
test("Codex setup explains hook trust and the optional captured-stream import", () =>
  withPage(async (p) => {
    await p.click("#settingsbtn");
    await p.click('#sheet-settings [data-sheet="sheet-setup"]');
    await p.selectOption("#setup-runtime", "codex");
    assert.match(await p.textContent("#setup-detail"), /hooks.json/);
    assert.match(
      await p.textContent("#setup-detail"),
      /\/hooks to review and trust/,
    );
    assert.equal(await p.isVisible("#setup-codex-usage"), true);
    const command = (await p.textContent("#command-codex-usage"))
      .trim()
      .replace(/\s+/g, " ");
    assert.equal(
      command,
      "python3 codex/stream.py --stream-id build-check-01 < build-check-01.jsonl",
    );
    assert.match(
      await p.textContent("#setup-codex-usage"),
      /reuse it only for the\s+same capture/,
    );
    assert.match(
      await p.getAttribute("#setup-brand img", "src"),
      /brands\/codex.svg$/,
    );
    await capture(p, "codex-connection-guide");
    await p.selectOption("#setup-runtime", "claude");
    assert.equal(await p.isVisible("#setup-codex-usage"), false);
  }));
test("saved history searches beyond the live window and retains rows after a refresh failure", () =>
  withPage(async (p) => {
    await p.click("#eventsbtn");
    await p.fill("#eventSearch", "older-file-0.js");
    assert.equal(await p.locator("#eventbox .event").count(), 0);
    await p.click('[data-event-view="history"]');
    await p.waitForFunction(() => historyLoaded && !historyLoading);
    assert.equal(await p.locator("#eventbox .event").count(), 1);
    await p.locator("#eventSearch").focus();
    await p.waitForTimeout(1700);
    assert.equal(await p.inputValue("#eventSearch"), "older-file-0.js");
    assert.equal(
      await p.evaluate(() => document.activeElement.id),
      "eventSearch",
    );
    const download = p.waitForEvent("download");
    await p.click("#export-history");
    const file = await download;
    const data = JSON.parse(fs.readFileSync(await file.path(), "utf8"));
    assert.ok(data.events.length > 30);
    await p.route("**/history?*", (route) =>
      route.fulfill({ status: 503, body: "unavailable" }),
    );
    await p.click("#refresh-history");
    await p.waitForFunction(() => !historyLoading);
    assert.match(await p.textContent("#history-status"), /Could not refresh/);
    assert.equal(await p.locator("#eventbox .event").count(), 1);
    await p.unroute("**/history?*");
    await p.fill("#eventSearch", "");
    await p.click("#refresh-history");
    await p.waitForFunction(() => !historyLoading);
    await capture(p, "saved-history");
  }));
test("retention, pet names and a reported-cost budget survive reload", () =>
  withPage(async (p) => {
    await p.click("#settingsbtn");
    await p.click(
      '#history-settings [data-setting="history_limit"][data-value="250"]',
    );
    await p.click(
      '#history-settings [data-setting="history_days"][data-value="1"]',
    );
    await p.click(
      '#history-settings [data-setting="history_max_bytes"][data-value="1048576"]',
    );
    await p.fill("#pet-cat1-name", "Maple");
    await p.fill("#pet-cat2-name", "Mochi");
    await p.locator('#pet-name-form button[type="submit"]').click();
    await p.fill("#budget-input", "0.01");
    await p.locator('#budget-form button[type="submit"]').click();
    await p.waitForFunction(() => pendingSaves === 0);
    await p.reload();
    await p.waitForFunction(() => initialized);
    await p.click("#settingsbtn");
    assert.equal(
      await p.getAttribute(
        '#history-settings [data-setting="history_max_bytes"][data-value="1048576"]',
        "aria-pressed",
      ),
      "true",
    );
    assert.equal(await p.inputValue("#pet-cat1-name"), "Maple");
    assert.equal(await p.inputValue("#pet-cat2-name"), "Mochi");
    assert.equal(await p.inputValue("#budget-input"), "0.01");
    await p.locator("#history-settings").scrollIntoViewIfNeeded();
    await capture(p, "retention-and-usage-alert");
    await p.keyboard.press("Escape");
    await p.click("#floorbtn");
    assert.equal(await p.isVisible("#budget-warning"), true);
    assert.match(await p.textContent("#budget-warning"), /partial coverage/);
  }));
test("attention notices are new-event-only, dismissible, and inspect the right agent", () =>
  withPage(async (p) => {
    assert.equal(await p.isVisible("#attention"), false);
    fs.appendFileSync(
      log,
      JSON.stringify(
        record("input_request", "b", {
          platform: "opencode",
          request_id: "new-question",
          question: "Choose the next branch",
        }),
      ) + "\n",
    );
    await p.waitForFunction(() => !document.querySelector("#attention").hidden);
    assert.match(await p.textContent("#attention"), /Demo/);
    await capture(p, "attention-notice");
    await p.click("#attention-inspect");
    assert.equal(await p.evaluate(() => focusedId), "b");
    await p.keyboard.press("Escape");
    await p.click("#attention-dismiss");
    await p.waitForTimeout(1700);
    assert.equal(await p.isVisible("#attention"), false);
    fs.appendFileSync(
      log,
      JSON.stringify(
        record("session_error", "b", {
          platform: "opencode",
          error_message: "Provider unavailable",
        }),
      ) + "\n",
    );
    await p.waitForFunction(() => !document.querySelector("#attention").hidden);
    assert.match(await p.textContent("#attention"), /Provider unavailable/);
    await p.route("**/state", (route) => route.abort());
    await p.waitForFunction(() => offline);
    assert.equal(await p.isVisible("#attention"), false);
    await p.unroute("**/state");
  }));
test("mobile name forms, history tools and usage stay within the dialog", () =>
  withPage(
    async (p) => {
      for (const id of ["floorbtn", "settingsbtn", "eventsbtn"]) {
        await p.click("#" + id);
        assert.equal(
          await p.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        assert.equal(
          await p.evaluate(() => {
            const panel = document.querySelector(".sheet:not([hidden])");
            return panel.scrollWidth > panel.clientWidth;
          }),
          false,
        );
        await capture(p, "mobile-" + id);
        await p.keyboard.press("Escape");
      }
    },
    { viewport: { width: 320, height: 760 }, isMobile: true, hasTouch: true },
  ));
test("clearing saved history preserves XP, reported usage and old unanswered requests", () =>
  withPage(async (p) => {
    const beforeState = await (await p.request.get(baseURL + "/state")).json();
    await p.click("#settingsbtn");
    p.once("dialog", (dialog) => dialog.accept());
    await p.click("#clear-history");
    await p.waitForFunction(() =>
      document.querySelector("#storage-status").textContent.includes("cleared"),
    );
    const afterState = await (await p.request.get(baseURL + "/state")).json();
    assert.equal(afterState.progress.xp, beforeState.progress.xp);
    assert.deepEqual(afterState.usage, beforeState.usage);
    assert.equal(
      afterState.agents.find((agent) => agent.id === "old-wait").status,
      "waiting",
    );
    assert.equal(
      (await (await p.request.get(baseURL + "/history")).json()).events.length,
      0,
    );
    await p.reload();
    await p.waitForFunction(() => initialized);
    assert.equal(await p.isVisible("#attention"), false);
  }));
