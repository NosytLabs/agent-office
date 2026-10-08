/* Real-browser Snake controls and shared arcade lifecycle regressions. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
let server, home, baseURL, output = "";
before(async () => {
  const reservation = net.createServer();
  await new Promise((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolve); });
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  baseURL = `http://127.0.0.1:${port}`;
  home = fs.mkdtempSync(path.join(os.tmpdir(), "office-snake-"));
  fs.mkdirSync(path.join(home, "pixel-office"));
  fs.writeFileSync(path.join(home, "pixel-office", "events.jsonl"), "");
  server = spawn(process.env.PYTHON || "python", ["run.py", "--port", String(port)], {
    cwd: root, env: { ...process.env, HERMES_HOME: home, AGENT_OFFICE_DEMO: "1" }, stdio: ["ignore", "ignore", "pipe"],
  });
  server.stderr.on("data", (data) => { output = (output + data.toString()).slice(-4000); });
  server.on("error", (error) => { output += error.message; });
  for (let attempt = 0; attempt < 120; attempt++) {
    try { if ((await fetch(baseURL + "/state")).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Snake test observer failed to start: " + output);
});
after(async () => {
  if (server && server.exitCode === null && !server.killed) {
    await new Promise((resolve) => { server.once("exit", resolve); server.kill(); });
  }
  if (home) fs.rmSync(home, { recursive: true, force: true });
});
async function withPage(run, options = {}) {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1180, height: 900 }, ...options });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(baseURL);
    await page.waitForFunction(() => typeof initialized !== "undefined" && initialized && window.officeArcade);
    await page.evaluate(() => window.officeArcade.open());
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}
const snapshot = (page) => page.evaluate(() => window.officeArcade.snapshot());
async function selectSnake(page) {
  await page.locator("#arcade-game-snake").click();
  assert.equal(await page.locator("#arcade-heading").innerText(), "Snake");
  assert.equal(await page.evaluate(() => document.activeElement.id), "arcade-start");
  assert.equal((await snapshot(page)).frameActive, false);
  await page.locator("#arcade-start").click();
}
test("Snake is playable by keyboard, pauses, restarts, and leaves work progress unchanged", async () => {
  await withPage(async (page) => {
    const before = await page.evaluate(() => JSON.stringify(window._state?.progress));
    await selectSnake(page);
    await page.locator("#arcade-canvas").press("ArrowUp");
    await page.waitForFunction(() => window.officeArcade.snapshot().snake.body[0].y < 9);
    await page.locator("#arcade-pause").click();
    const paused = await snapshot(page);
    assert.equal(paused.paused, true);
    assert.equal(paused.frameActive, false);
    await page.waitForTimeout(550);
    assert.deepEqual((await snapshot(page)).snake, paused.snake);
    await page.locator("#arcade-restart").click();
    assert.equal((await snapshot(page)).snake.score, 0);
    assert.equal((await snapshot(page)).snake.body.length, 3);
    assert.equal(await page.evaluate(() => JSON.stringify(window._state?.progress)), before);
  });
});
test("Snake touch controls fit mobile and switch back to Breakout without a running loop", async () => {
  await withPage(async (page) => {
    await selectSnake(page);
    const pad = page.getByRole("button", { name: "Snake up", exact: true });
    const box = await pad.boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44);
    await pad.tap();
    await page.waitForFunction(() => window.officeArcade.snapshot().snake.body[0].y < 9);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.locator("#arcade-pause").click();
    fs.mkdirSync(path.join(root, "reports", "arcade"), { recursive: true });
    await page.screenshot({ path: path.join(root, "reports", "arcade", "snake-mobile.png"), fullPage: true });
    await page.locator("#arcade-exit").click();
    await page.locator("#arcade-game-breakout").click();
    assert.equal((await snapshot(page)).selected, "breakout");
    assert.equal((await snapshot(page)).frameActive, false);
    assert.equal(await page.locator("#arcade-snake-controls").isVisible(), false);
    await page.locator("#arcade-start").click();
    assert.equal((await snapshot(page)).frameActive, true);
  }, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
});
test("reduced-motion changes and closing the panel stop Snake until explicit Resume", async () => {
  await withPage(async (page) => {
    await selectSnake(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(() => window.officeArcade.snapshot().paused);
    assert.equal((await snapshot(page)).frameActive, false);
    await page.locator("#arcade-pause").click();
    assert.equal((await snapshot(page)).paused, false);
    await page.locator("#sheet-arcade .close").click();
    await page.waitForFunction(() => !window.officeArcade.snapshot().sheetOpen);
    assert.equal((await snapshot(page)).frameActive, false);
    await page.evaluate(() => window.officeArcade.open());
    assert.equal((await snapshot(page)).paused, true);
  });
});
test("Snake and Breakout read independent, namespaced personal bests", async () => {
  await withPage(async (page) => {
    await page.evaluate(() => {
      for (const mode of ["preview", "observer"]) {
        localStorage.setItem(`agent-office:${mode}:arcade:snake-best`, "80");
        localStorage.setItem(`agent-office:${mode}:arcade:breakout-best`, "170");
      }
    });
    await page.locator("#arcade-game-snake").click();
    assert.equal((await snapshot(page)).best, 80);
    await page.locator("#arcade-exit").click();
    await page.locator("#arcade-game-breakout").click();
    assert.equal((await snapshot(page)).best, 170);
  });
});
