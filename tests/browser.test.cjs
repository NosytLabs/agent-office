/* Browser regressions: actual server, DOM, canvas, and bundled asset requests. */
const { test, before, after } = require("node:test");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const baseURL = process.env.OFFICE_URL || "http://127.0.0.1:18113";
let server, home;
before(async () => {
  if (process.env.OFFICE_URL) return;
  home = fs.mkdtempSync(path.join(os.tmpdir(), "office-browser-"));
  fs.mkdirSync(path.join(home, "pixel-office"));
  const now = Date.now() / 1000;
  const names = [
    "cli-build",
    "claude-review",
    "opencode-api",
    "telegram-notes",
    "hermes-docs",
    "cli-tests",
  ];
  const platforms = ["cli", "claude", "opencode", "telegram", "hermes", "cli"];
  const events = names.map((id, i) => ({
    ts: now + i / 100,
    event: "session_start",
    session_id: id,
    platform: platforms[i],
  }));
  for (let i = 0; i < 6; i++)
    events.push({
      ts: now + 0.1 + i / 100,
      event: "tool_start",
      session_id: names[i],
      tool_name: [
        "terminal",
        "read_file",
        "write_file",
        "web_search",
        "read_file",
        "terminal",
      ][i],
      preview: [
        "Run the build",
        "Review a patch",
        "Update the API",
        "Research release notes",
        "Read the docs",
        "Run regression tests",
      ][i],
    });
  events.push({
    ts: now + 0.2,
    event: "approval_request",
    session_id: "claude-review",
    command: "Apply the reviewed patch",
  });
  fs.writeFileSync(
    path.join(home, "pixel-office", "events.jsonl"),
    events.map((e) => JSON.stringify(e)).join("\n"),
  );
  server = spawn(
    process.env.PYTHON || "python3",
    ["run.py", "--port", "18113"],
    {
      env: { ...process.env, HERMES_HOME: home, AGENT_OFFICE_DEMO: "1" },
      stdio: "ignore",
    },
  );
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(baseURL + "/state");
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Test server did not start");
});
after(async () => {
  if (server) {
    server.kill();
    await new Promise((resolve) => server.once("exit", resolve));
  }
  if (home) fs.rmSync(home, { recursive: true, force: true });
});
const launch = () =>
  chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox"],
  });
async function withPage(fn) {
  const browser = await launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(baseURL);
    await page.waitForFunction(() =>
      document.querySelector("#count").textContent.includes("agent"),
    );
    await fn(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}
test("saved theme and desk settings survive a reload", () =>
  withPage(async (p) => {
    await p.request.post(baseURL + "/settings", {
      data: { theme: "amber", max_chars: 2 },
    });
    await p.reload();
    await p.waitForTimeout(1800);
    assert.equal(await p.locator("html").getAttribute("data-theme"), "amber");
    await p.locator("#settingsbtn").click();
    assert.equal(await p.locator("#mc").inputValue(), "2");
  }));
test("roster search keeps focus and query through typing and polling", () =>
  withPage(async (p) => {
    await p.locator("#floorbtn").click();
    await p.locator("#trackSearch").pressSequentially("cli", { delay: 100 });
    await p.waitForTimeout(1700);
    assert.equal(await p.locator("#trackSearch").inputValue(), "cli");
    assert.equal(
      await p.evaluate(() => document.activeElement.id),
      "trackSearch",
    );
  }));
test("agent and event text cannot become executable markup", () =>
  withPage(async (p) => {
    await p.evaluate(() => {
      const s = structuredClone(
        window._state || {
          agents: agents,
          progress,
          settings,
          events: window._stateEvents,
        },
      );
      s.agents[0].detail = '<img src=x onerror="window.__injected=1">';
      applyState(s);
    });
    await p.locator("#floorbtn").click();
    await p.waitForTimeout(200);
    assert.equal(await p.evaluate(() => window.__injected), undefined);
    assert.equal(await p.locator('#roster img[src="x"]').count(), 0);
  }));
test("mobile scene and dialogs fit, loaded sprites are valid", () =>
  withPage(async (p) => {
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.setViewportSize({ width: 390, height: 844 });
    await p.waitForTimeout(500);
    assert.ok(await p.evaluate(() => document.body.scrollWidth <= innerWidth));
    await p.locator("#settingsbtn").click();
    const box = await p.locator("#sheet-settings").boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390);
    assert.deepEqual(errors, []);
  }));
test("all sprite images load and canvas frames stay within room bounds on desktop and mobile", () =>
  withPage(async (p) => {
    await p.waitForFunction(
      () => officeScene.loadedAssets === 16 && officeScene.sprites.monstera,
    );
    assert.deepEqual(await p.evaluate(() => officeScene.assetErrors), []);
    for (const width of [1440, 768, 390, 320]) {
      await p.setViewportSize({ width, height: 900 });
      await p.waitForTimeout(200);
      const state = await p.evaluate(() => ({
        g: officeScene.grid,
        boxes: officeScene.hitBoxes,
        transform: officeScene.transform,
        width: officeScene.canvas.clientWidth,
        height: officeScene.canvas.clientHeight,
      }));
      for (const b of state.boxes) {
        assert.ok(b.x >= 0 && b.x + b.w <= state.g.w);
        assert.ok(b.y >= 0 && b.y + b.h <= state.g.h);
      }
      assert.ok(state.transform.ox >= 0 && state.transform.oy >= 0);
    }
  }));
test("activity search persists, tasks open inspector, Escape restores focus", () =>
  withPage(async (p) => {
    await p.locator("#eventsbtn").click();
    await p.locator("#eventSearch").fill("terminal");
    await p.waitForTimeout(1700);
    assert.equal(await p.locator("#eventSearch").inputValue(), "terminal");
    assert.ok((await p.locator("#eventbox").innerText()).includes("terminal"));
    await p.keyboard.press("Escape");
    assert.equal(
      await p.evaluate(() => document.activeElement.id),
      "eventsbtn",
    );
    await p.locator("#tasksbtn").click();
    await p.locator("#taskboard .agent-card").first().click();
    assert.ok(await p.locator("#sheet-inspector").isVisible());
    assert.ok(
      (await p.locator("#inspectorbox").innerText()).includes(
        "Apply the reviewed patch",
      ),
    );
  }));
test("layout export and import round-trip real server settings", () =>
  withPage(async (p) => {
    await p.locator("#settingsbtn").click();
    const download = p.waitForEvent("download");
    await p.locator("#export-settings").click();
    const file = await download;
    const saved = JSON.parse(fs.readFileSync(await file.path(), "utf8"));
    assert.equal(saved.version, 1);
    saved.settings.theme = "midnight";
    saved.settings.ambience = "night";
    saved.settings.furniture = [{ kind: "monstera", x: 0.8, y: 0.8 }];
    await p.locator("#import-settings").setInputFiles({
      name: "layout.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(saved)),
    });
    await p.waitForFunction(
      () => document.documentElement.dataset.theme === "midnight",
    );
    await p.waitForFunction(() => pendingSaves === 0);
    await p.reload();
    await p.waitForFunction(() => settings.ambience === "night");
    assert.equal(
      await p.evaluate(() => settings.furniture[0].kind),
      "monstera",
    );
  }));
test("pause, zoom, runtime filters, snapshot download, achievements and furniture placement", () =>
  withPage(async (p) => {
    await p.locator("#pausebtn").click();
    assert.equal(
      await p.locator("#pausebtn").getAttribute("aria-pressed"),
      "true",
    );
    const t = await p.evaluate(() => officeScene.time);
    await p.waitForTimeout(250);
    assert.equal(await p.evaluate(() => officeScene.time), t);
    await p.locator("#zoom-in").click();
    assert.equal(await p.evaluate(() => officeScene.zoom), 1.25);
    await p.locator("#zoom-fit").click();
    await p.locator("#filterbtn").selectOption("claude");
    assert.equal(await p.evaluate(() => officeScene.list().length), 1);
    await p.locator("#filterbtn").selectOption("every");
    const download = p.waitForEvent("download");
    await p.locator("#capturebtn").click();
    assert.equal((await download).suggestedFilename(), "agent-office.png");
    await p.locator("#achbtn").click();
    await p.locator('[data-filter="earned"]').click();
    assert.ok((await p.locator(".ach.have").count()) > 0);
    await p.keyboard.press("Escape");
    await p.locator("#settingsbtn").click();
    await p.locator("#clear-furniture").click();
    await p.waitForFunction(() => pendingSaves === 0);
    await p
      .locator("#furniture-tools button")
      .filter({ hasText: "server" })
      .click();
    const point = await p.evaluate(() => {
      const { scale, ox, oy } = officeScene.transform,
        g = officeScene.grid,
        b = officeScene.canvas.getBoundingClientRect();
      return {
        x: b.left + ox + g.w * 0.5 * scale,
        y: b.top + oy + (g.h - 18) * scale,
      };
    });
    await p.mouse.click(point.x, point.y);
    await p.waitForFunction(
      () => settings.furniture.length === 1 && pendingSaves === 0,
    );
    await p.keyboard.press("Escape");
    assert.equal(await p.locator("#edit-hint").isVisible(), false);
    await p.reload();
    await p.waitForFunction(() => settings.furniture.length === 1);
  }));
test("HTTP settings endpoint rejects malformed and oversized bodies with JSON errors", () =>
  withPage(async (p) => {
    let r = await p.request.post(baseURL + "/settings", {
      headers: { "Content-Type": "application/json" },
      data: "{bad",
    });
    assert.equal(r.status(), 400);
    r = await p.request.post(baseURL + "/settings", {
      headers: { "Content-Type": "application/json" },
      data: "[]",
    });
    assert.equal(r.status(), 400);
    r = await p.request.post(baseURL + "/settings", {
      headers: { "Content-Type": "application/json" },
      data: "x".repeat(65537),
    });
    assert.equal(r.status(), 413);
    r = await p.request.post(baseURL + "/settings", {
      headers: { "Content-Type": "text/plain" },
      data: "{}",
    });
    assert.equal(r.status(), 415);
  }));
test("malformed layout import leaves settings intact", () =>
  withPage(async (p) => {
    await p.locator("#settingsbtn").click();
    const theme = await p.evaluate(() => settings.theme);
    await p.locator("#import-settings").setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          version: 1,
          settings: { furniture: "not an array", theme: [] },
        }),
      ),
    });
    assert.ok((await p.locator("#toast").innerText()).includes("invalid"));
    assert.equal(await p.evaluate(() => settings.theme), theme);
  }));
test("lost connection is visible and polling recovers", () =>
  withPage(async (p) => {
    await p.route("**/state", (r) => r.abort());
    await p.waitForFunction(
      () =>
        document.querySelector("#connection").textContent === "Reconnecting",
    );
    assert.ok(
      (await p.locator("#count").innerText()).includes("Connection lost"),
    );
    await p.unroute("**/state");
    await p.waitForFunction(
      () => document.querySelector("#connection").textContent === "Connected",
    );
  }));
test("capture reviewed desktop, mobile, settings, badges, and night scenes", () =>
  withPage(async (p) => {
    const dir = process.env.OFFICE_SCREENSHOTS;
    if (!dir) return;
    fs.mkdirSync(dir, { recursive: true });
    await p.request.post(baseURL + "/settings", {
      data: { ...(await p.evaluate(() => DEFAULT_SETTINGS)), ambience: "day" },
    });
    await p.reload();
    await p.waitForFunction(
      () =>
        officeScene.loadedAssets === 16 &&
        officeScene.sprites.sofa &&
        initialized,
    );
    await p.locator("#pausebtn").click();
    await p.waitForTimeout(200);
    await p.screenshot({ path: path.join(dir, "desktop-studio.png") });
    await p.locator("#achbtn").click();
    await p.screenshot({ path: path.join(dir, "achievements.png") });
    await p.keyboard.press("Escape");
    await p.locator("#settingsbtn").click();
    await p.screenshot({ path: path.join(dir, "desktop-settings.png") });
    await p.keyboard.press("Escape");
    await p.evaluate(() =>
      saveSettings({ theme: "midnight", ambience: "night" }),
    );
    await p.waitForTimeout(200);
    await p.screenshot({ path: path.join(dir, "midnight-studio.png") });
    await p.evaluate(() => saveSettings({ theme: "default", ambience: "day" }));
    await p.setViewportSize({ width: 390, height: 844 });
    await p.waitForTimeout(200);
    await p.screenshot({ path: path.join(dir, "mobile-studio.png") });
    await p.locator("#settingsbtn").click();
    await p.screenshot({ path: path.join(dir, "mobile-settings.png") });
  }));
test("confirmed reset clears only progress and events in the isolated test workspace", () =>
  withPage(async (p) => {
    if (process.env.OFFICE_URL) return; // Never reset a caller-supplied server.
    const theme = await p.evaluate(() => settings.theme);
    await p.locator("#settingsbtn").click();
    p.once("dialog", (d) => d.accept());
    await p.locator("#resetbtn").click();
    await p.waitForFunction(() => window._state?.agents.length === 0);
    assert.equal(await p.evaluate(() => progress.xp), 0);
    assert.equal(await p.evaluate(() => settings.theme), theme);
    assert.ok(await p.locator("#empty-state").isVisible());
  }));
