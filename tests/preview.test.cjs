/* Actual static server + browser: no Python observer or real runtime data. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawnSync } = require("node:child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const baseURL = "http://127.0.0.1:18120";
const screenshots =
  process.env.OFFICE_PREVIEW_SCREENSHOTS || path.join(root, "reports/preview");
const requests = [];
let temporary, output, server;

before(async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "office-static-preview-"));
  output = path.join(temporary, "site");
  const built = spawnSync(
    process.execPath,
    ["tools/build_preview.mjs", "--out", output],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(built.status, 0, built.stderr);
  const types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
  };
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, baseURL).pathname;
    requests.push({ method: req.method, pathname });
    const file = path.resolve(
      output,
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
    if (
      !file.startsWith(output + path.sep) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile()
    ) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "text/plain",
      "Cache-Control": "no-store",
    });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(18120, "127.0.0.1", resolve);
  });
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
});
async function withPage(run, options = {}) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox"],
  });
  try {
    const { storageBlocked, storageWriteBlocked, ...pageOptions } = options;
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      ...pageOptions,
    });
    const p = await context.newPage();
    if (storageBlocked)
      await p.addInitScript(() => {
        Storage.prototype.getItem = Storage.prototype.setItem = () => {
          throw new DOMException("Storage disabled", "SecurityError");
        };
      });
    else if (storageWriteBlocked)
      await p.addInitScript(() => {
        Storage.prototype.setItem = () => {
          throw new DOMException("Storage full", "QuotaExceededError");
        };
      });
    p.setDefaultTimeout(10000);
    const errors = [];
    p.on("pageerror", (error) => errors.push(error.stack || error.message));
    await p.goto(baseURL);
    await p.waitForFunction(
      () => initialized && window._state?.mode === "demo",
    );
    await p.evaluate(() => document.fonts.ready);
    await run(p);
    assert.deepEqual(errors, []);
    assert.equal(
      requests.some((request) =>
        ["/state", "/settings", "/history"].includes(request.pathname),
      ),
      false,
      "Demo API traffic must stay inside the browser",
    );
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

test("static preview has fresh synthetic state, honest usage, and no local observer connection", () =>
  withPage(async (p) => {
    assert.match(
      await p.textContent("#preview-notice"),
      /All agents, activity, XP and usage here are fictional/,
    );
    assert.equal(await p.isVisible("#mode"), true);
    const snapshot = await p.evaluate(() => window._state);
    assert.equal(snapshot.agents.length, 5);
    assert.deepEqual(
      [...new Set(snapshot.agents.map((a) => a.platform))].sort(),
      ["claude", "codex", "hermes", "opencode"],
    );
    assert.ok(snapshot.agents.some((a) => a.status === "waiting"));
    assert.ok(
      snapshot.agents.some(
        (a) => a.status === "done" && a.parent === "demo-opencode",
      ),
    );
    assert.ok(Math.abs(snapshot.ts - Date.now() / 1000) < 10);
    assert.ok(snapshot.events.at(-1).ts > Date.now() / 1000 - 30);
    assert.equal(snapshot.usage.totals.input_tokens, 22000);
    assert.equal(snapshot.usage.totals.cost_usd, 0.0184);
    await capture(p, "desktop-demo");
    await p.click("#floorbtn");
    assert.match(
      await p.textContent(".preview-usage-note"),
      /not real charges/,
    );
    await p.click(".usage-breakdown summary");
    assert.match(
      await p.textContent("#usage-breakdown"),
      /Synthetic preview example/,
    );
    assert.equal(
      await p.evaluate(
        async () => (await fetch("http://127.0.0.1:8113/state")).status,
      ),
      403,
    );
    assert.equal(
      await p.evaluate(
        async () => (await fetch("/user/aquarium/manifest.json")).status,
      ),
      404,
    );
    assert.equal(
      await p.evaluate(
        async () => (await fetch("/user/aquarium/ember.png")).status,
      ),
      404,
    );
  }));

test("demo preferences persist separately and update the same UI", () =>
  withPage(async (p) => {
    await p.evaluate(() => localStorage.setItem("unrelated-sentinel", "keep"));
    await p.click("#settingsbtn");
    await p.fill("#room-name-input", "My sample studio");
    await p.click("#room-name-save");
    await p.waitForFunction(() => pendingSaves === 0);
    await p.keyboard.press("Escape");
    await p.click("#themeNextbtn");
    await p.waitForFunction(() => pendingSaves === 0);
    await p.reload();
    await p.waitForFunction(() => initialized);
    assert.equal(await p.textContent("#room-name"), "My sample studio");
    assert.equal(
      await p.evaluate(() => window._state.settings.theme),
      "midnight",
    );
    assert.equal(
      await p.evaluate(() => localStorage.getItem("unrelated-sentinel")),
      "keep",
    );
    const stored = await p.evaluate(() =>
      JSON.parse(localStorage.getItem("agent-office:static-preview:v1")),
    );
    assert.equal(stored.settings.room_name, "My sample studio");
    assert.equal(stored.settings.theme, "midnight");
    assert.equal(Object.hasOwn(stored, "agents"), false);
    assert.equal(Object.hasOwn(stored, "usage"), false);
  }));

test("clear history, reset, and restore remain coherent demo-only actions", () =>
  withPage(async (p) => {
    const original = await p.evaluate(() => window._state);
    await p.click("#settingsbtn");
    await p.fill("#room-name-input", "Keep this room name");
    await p.click("#room-name-save");
    await p.waitForFunction(() => pendingSaves === 0);
    p.once("dialog", (dialog) => dialog.accept());
    await p.click("#clear-history");
    await p.waitForFunction(() =>
      document.getElementById("storage-status").textContent.includes("cleared"),
    );
    const cleared = await p.evaluate(async () => ({
      state: await (await fetch("state")).json(),
      history: await (await fetch("history")).json(),
    }));
    assert.deepEqual(cleared.history.events, []);
    assert.deepEqual(cleared.state.events, []);
    assert.equal(cleared.state.progress.xp, original.progress.xp);
    assert.deepEqual(cleared.state.usage, original.usage);
    assert.equal(cleared.state.agents.length, original.agents.length);
    p.once("dialog", (dialog) => dialog.accept());
    await p.click("#resetbtn");
    await p.waitForFunction(
      () => initialized && window._state.progress.xp === 0,
    );
    const empty = await p.evaluate(() => window._state);
    assert.deepEqual(empty.agents, []);
    assert.equal(empty.usage.totals.reports, 0);
    assert.equal(empty.usage.totals.input_tokens, null);
    assert.equal(empty.settings.room_name, "Keep this room name");
    await p.click("#preview-restore");
    await p.waitForFunction(() => initialized && window._state.progress.xp > 0);
    assert.equal(
      await p.evaluate(() => window._state.progress.xp),
      original.progress.xp,
    );
    assert.equal(await p.textContent("#room-name"), "Keep this room name");
    assert.ok(
      (await p.evaluate(
        async () => (await (await fetch("history")).json()).events.length,
      )) > 30,
    );
  }));

test("mobile preview remains usable and its public aquarium needs no private pack", () =>
  withPage(
    async (p) => {
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
      );
      assert.equal(await p.isVisible("#preview-restore"), true);
      await capture(p, "mobile-demo");
      await p.evaluate(() => openAquarium());
      await p.waitForFunction(
        () => !document.getElementById("sheet-aquarium").hidden,
      );
      assert.ok(
        (await p.evaluate(() => officeAquarium.snapshot())).fish.length > 0,
      );
      assert.equal(
        await p.evaluate(
          async () => (await fetch("/user/aquarium/manifest.json")).status,
        ),
        404,
      );
      await capture(p, "mobile-aquarium-demo");
    },
    { viewport: { width: 390, height: 844 } },
  ));

for (const [label, options] of [
  ["blocked browser storage", { storageBlocked: true }],
  [
    "storage write failure with readable old data",
    { storageWriteBlocked: true },
  ],
])
  test(label + " still permits coherent in-visit demo reset and restore", () =>
    withPage(async (p) => {
      await p.click("#settingsbtn");
      await p.fill("#room-name-input", "This visit only");
      await p.click("#room-name-save");
      await p.waitForFunction(() => pendingSaves === 0);
      assert.match(
        await p.textContent("#preview-notice"),
        /storage is unavailable/,
      );
      p.once("dialog", (dialog) => dialog.accept());
      await p.click("#resetbtn");
      await p.waitForFunction(() => window._state.progress.xp === 0);
      assert.equal(await p.textContent("#room-name"), "This visit only");
      await p.click("#preview-restore");
      await p.waitForFunction(() => window._state.progress.xp > 0);
      assert.equal(await p.textContent("#room-name"), "This visit only");
    }, options),
  );

test("two preview tabs merge preferences and preserve reset/history changes", () =>
  withPage(async (p) => {
    const other = await p.context().newPage();
    const errors = [];
    other.on("pageerror", (error) => errors.push(error.message));
    await other.goto(baseURL);
    await other.waitForFunction(() => initialized);
    const update = (page, patch) =>
      page.evaluate(async (value) => {
        const response = await fetch("settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(value),
        });
        if (!response.ok) throw new Error("Demo preference write failed");
        return response.json();
      }, patch);
    const stored = () =>
      p.evaluate(() =>
        JSON.parse(localStorage.getItem("agent-office:static-preview:v1")),
      );

    await update(p, { room_name: "Shared sample room" });
    await update(other, { sound: true });
    assert.equal((await stored()).settings.room_name, "Shared sample room");
    assert.equal((await stored()).settings.sound, true);
    await Promise.all([
      update(p, { ambience: "night" }),
      update(other, { max_chars: 8 }),
    ]);
    assert.equal((await stored()).settings.ambience, "night");
    assert.equal((await stored()).settings.max_chars, 8);

    await p.evaluate(() => fetch("history", { method: "DELETE" }));
    await update(other, { theme: "amber" });
    assert.equal((await stored()).historyCleared, true);
    assert.deepEqual(
      await other.evaluate(
        async () => (await (await fetch("history")).json()).events,
      ),
      [],
    );
    await p.evaluate(() => fetch("state", { method: "DELETE" }));
    await update(other, { music_volume: 0.25 });
    assert.equal((await stored()).reset, true);
    await other.reload();
    await other.waitForFunction(() => initialized);
    assert.equal(await other.evaluate(() => window._state.agents.length), 0);
    assert.equal(await other.textContent("#room-name"), "Shared sample room");

    await p.click("#preview-restore");
    await other.waitForFunction(() => window._state.agents.length > 0);
    assert.equal((await stored()).reset, false);
    assert.equal((await stored()).historyCleared, false);
    assert.equal((await stored()).settings.music_volume, 0.25);
    await other.click("#settingsbtn");
    await other.fill("#room-name-input", "Unsaved local draft");
    await other.press("#room-name-input", "Tab");
    await update(p, { aquarium_name: "Shared fish" });
    await other.waitForFunction(() => settings.aquarium_name === "Shared fish");
    assert.equal(await other.isVisible("#sheet-settings"), true);
    assert.equal(
      await other.inputValue("#room-name-input"),
      "Unsaved local draft",
    );
    assert.deepEqual(errors, []);
  }));

test("preview quiet context and terminal durations match the live observer", () =>
  withPage(async (p) => {
    const initial = await p.evaluate(() => window._state);
    const finished = initial.agents.find((agent) => agent.status === "done");
    const elapsed = Math.floor(
      finished.observed_at - finished.first_received_at,
    );
    assert.equal(finished.duration_s, elapsed);
    const later = await p.evaluate(async () => {
      const now = Date.now();
      window.previewTestClock = now;
      Date.now = () => window.previewTestClock + 45000;
      return (await fetch("state")).json();
    });
    assert.equal(
      later.agents.find((agent) => agent.id === finished.id).duration_s,
      elapsed,
    );
    const quiet = await p.evaluate(async () => {
      Date.now = () => window.previewTestClock + 310000;
      return (await fetch("state")).json();
    });
    const reader = quiet.agents.find((agent) => agent.id === "demo-hermes");
    assert.equal(reader.status, "idle");
    assert.equal(reader.quiet, true);
    assert.equal(reader.recorded_status, "working");
    assert.equal(reader.last_tool, "Read");
    assert.equal(
      quiet.agents.some((agent) => agent.id === finished.id),
      false,
    );
    assert.equal(
      quiet.agents.find((agent) => agent.id === "demo-claude").status,
      "waiting",
    );

    const gone = await p.evaluate(async () => {
      Date.now = () => window.previewTestClock;
      const seed = window.__AGENT_OFFICE_PREVIEW_SEED__;
      const ended = seed.state.agents.find((agent) => agent.status === "done");
      ended.status = "gone";
      ended.observed_at = seed.base_time - 2;
      return (await fetch("state")).json();
    });
    const ended = gone.agents.find((agent) => agent.id === finished.id);
    assert.equal(
      ended.duration_s,
      Math.floor(ended.observed_at - ended.first_received_at),
    );
    const departed = await p.evaluate(async () => {
      Date.now = () => window.previewTestClock + 25000;
      return (await fetch("state")).json();
    });
    assert.equal(
      departed.agents.some((agent) => agent.id === finished.id),
      false,
    );
  }));
