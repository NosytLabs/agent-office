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

test("legacy demo revisions detect changed bytes from another tab and preserve names on retry", () =>
  withPage(async (page) => {
    const other = await page.context().newPage();
    try {
      const legacy = {
        version: 1,
        settings: { agent_names: { alpha: "First name", beta: "Old sibling" } },
      };
      await page.evaluate(
        (value) =>
          localStorage.setItem(
            "agent-office:static-preview:v1",
            JSON.stringify(value),
          ),
        legacy,
      );
      await other.goto(baseURL);
      await other.waitForFunction(() => initialized && settingsReady);
      const firstTag = await page.evaluate(async () =>
        (await fetch("/settings")).headers.get("etag"),
      );
      assert.equal(
        await page.evaluate(async () =>
          (await fetch("/settings")).headers.get("etag"),
        ),
        firstTag,
        "Repeated reads of identical bytes keep this view's revision",
      );
      await other.evaluate((value) => {
        value.settings.agent_names.beta = "New sibling";
        // Simulate a still-open pre-CAS preview, which writes no revision.
        localStorage.setItem(
          "agent-office:static-preview:v1",
          JSON.stringify(value),
        );
      }, legacy);
      const result = await page.evaluate(async (etag) => {
        const save = await fetch("/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json", "If-Match": etag },
          body: JSON.stringify({
            agent_names: { alpha: "Stale rename", beta: "Old sibling" },
          }),
        });
        return { status: save.status, body: await save.json() };
      }, firstTag);
      assert.equal(result.status, 409);
      assert.equal(result.body.settings.agent_names.beta, "New sibling");
      const retry = await page.evaluate(async () => {
        const read = await fetch("/settings"),
          current = await read.json();
        const save = await fetch("/settings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "If-Match": read.headers.get("etag"),
          },
          body: JSON.stringify({
            agent_names: { ...current.agent_names, alpha: "Reviewed rename" },
          }),
        });
        return {
          status: save.status,
          body: await save.json(),
          stored: JSON.parse(
            localStorage.getItem("agent-office:static-preview:v1"),
          ),
        };
      });
      assert.equal(retry.status, 200);
      assert.deepEqual(retry.body.agent_names, {
        alpha: "Reviewed rename",
        beta: "New sibling",
      });
      assert.ok(
        retry.stored.settingsRevision,
        "An acknowledged save persists the shared revision",
      );
    } finally {
      await other.close();
    }
  }));

test("two views can read one legacy demo record and the second save conflicts after the first persists", () =>
  withPage(async (page) => {
    await page.evaluate(() =>
      localStorage.setItem(
        "agent-office:static-preview:v1",
        JSON.stringify({
          version: 1,
          settings: { pet_names: { cat1: "Original pet" } },
        }),
      ),
    );
    const other = await page.context().newPage();
    try {
      await other.goto(baseURL);
      await other.waitForFunction(() => initialized && settingsReady);
      const revision = async (view) =>
        view.evaluate(async () =>
          (await fetch("/settings")).headers.get("etag"),
        );
      const firstTag = await revision(page),
        secondTag = await revision(other);
      assert.equal(await revision(page), firstTag);
      assert.equal(await revision(other), secondTag);
      const first = await page.evaluate(
        async (etag) =>
          (
            await fetch("/settings", {
              method: "POST",
              headers: { "Content-Type": "application/json", "If-Match": etag },
              body: JSON.stringify({ pet_names: { cat1: "First saved pet" } }),
            })
          ).status,
        firstTag,
      );
      assert.equal(
        first,
        200,
        "Another view's read must not invalidate this view's revision",
      );
      const second = await other.evaluate(async (etag) => {
        const response = await fetch("/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json", "If-Match": etag },
          body: JSON.stringify({ pet_names: { cat1: "Stale pet" } }),
        });
        return { status: response.status, body: await response.json() };
      }, secondTag);
      assert.equal(second.status, 409);
      assert.equal(second.body.settings.pet_names.cat1, "First saved pet");
    } finally {
      await other.close();
    }
  }));

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

test("two preview tabs keep conditional preferences and preserve reset/history changes", () =>
  withPage(async (p) => {
    const other = await p.context().newPage();
    const errors = [];
    other.on("pageerror", (error) => errors.push(error.message));
    await other.goto(baseURL);
    await other.waitForFunction(() => initialized);
    const update = (page, patch) =>
      page.evaluate(async (value) => {
        const current = await fetch("settings");
        const response = await fetch("settings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "If-Match": current.headers.get("ETag"),
          },
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
    await update(p, { ambience: "night" });
    await update(other, { max_chars: 8 });
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

test("two native demo views serialize conditional map saves and keep a rejected draft", () =>
  withPage(async (p) => {
    const other = await p.context().newPage();
    await other.goto(baseURL);
    await other.waitForFunction(() => initialized && settingsReady);
    for (const page of [p, other]) await page.click("#settingsbtn");
    await p.fill("#pet-cat1-name", "Orange from first tab");
    await other.fill("#pet-cat2-name", "Black from second tab");
    // Hold the actual Web Lock until both native form submissions are waiting.
    // Each view has the same acknowledged revision and a different full map.
    await p.evaluate(() => {
      window.demoLockHeld = false;
      navigator.locks.request(
        "agent-office:static-preview:v1",
        () =>
          new Promise((resolve) => {
            window.releaseDemoLock = resolve;
            window.demoLockHeld = true;
          }),
      );
    });
    await p.waitForFunction(() => window.demoLockHeld);
    try {
      await p.locator("#pet-name-form button").click();
      await other.locator("#pet-name-form button").click();
      for (const page of [p, other])
        await page.waitForFunction(() => pendingSaves === 1);
      await p.evaluate(() => window.releaseDemoLock());
      for (const page of [p, other])
        await page.waitForFunction(() => pendingSaves === 0);
      const names = await p.evaluate(
        async () => (await (await fetch("settings")).json()).pet_names,
      );
      assert.equal(
        Object.keys(names).length,
        1,
        "one revision wins, so one stale map is rejected",
      );
      const rejected = (await p.isVisible("#settings-save-notice")) ? p : other;
      assert.match(
        await rejected.textContent("#settings-save-notice"),
        /changed in another view/,
      );
      await rejected.locator("#pet-name-form button").click();
      await rejected.waitForFunction(() => pendingSaves === 0);
      assert.deepEqual(
        await p.evaluate(
          async () => (await (await fetch("settings")).json()).pet_names,
        ),
        {
          cat1: "Orange from first tab",
          cat2: "Black from second tab",
        },
      );
    } finally {
      await p.evaluate(() => window.releaseDemoLock?.());
    }
  }));

test("static settings expose revisions and reject missing or stale write conditions", () =>
  withPage(async (p) => {
    const result = await p.evaluate(async () => {
      const initial = await fetch("settings"),
        etag = initial.headers.get("ETag");
      const write = (condition, name) =>
        fetch("settings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(condition ? { "If-Match": condition } : {}),
          },
          body: JSON.stringify({ room_name: name }),
        });
      const missing = await write(null, "Must not save");
      const first = await write(etag, "Confirmed demo");
      const stale = await write(etag, "Must not replace");
      return {
        etag,
        missing: missing.status,
        first: first.status,
        next: first.headers.get("ETag"),
        stale: stale.status,
        conflict: await stale.json(),
        state: await (await fetch("state")).json(),
      };
    });
    assert.match(result.etag, /^".+"$/);
    assert.equal(result.missing, 428);
    assert.equal(result.first, 200);
    assert.notEqual(result.next, result.etag);
    assert.equal(result.stale, 409);
    assert.equal(result.conflict.settings.room_name, "Confirmed demo");
    assert.equal(result.state.settings.room_name, "Confirmed demo");
    assert.equal(
      result.conflict.settings_revision,
      result.state.settings_revision,
    );
    assert.equal(result.state.settings_status.available, true);
  }));

test("malformed stored demo preferences stay intact and block edits until repaired", () =>
  withPage(async (p) => {
    await p.click("#settingsbtn");
    await p.fill("#room-name-input", "Preserved demo preferences");
    await p.click("#room-name-save");
    await p.waitForFunction(() => pendingSaves === 0);
    const original = await p.evaluate(() =>
      localStorage.getItem("agent-office:static-preview:v1"),
    );
    for (const corrupt of [
      '{"version":1,"settings":',
      JSON.stringify({ version: 1, settings: null }),
      "x".repeat(65537),
    ]) {
      const result = await p.evaluate(async (raw) => {
        const key = "agent-office:static-preview:v1";
        const etag = (await fetch("settings")).headers.get("ETag");
        localStorage.setItem(key, raw);
        const snapshot = await (await fetch("state")).json();
        applyState(snapshot);
        const read = await fetch("settings");
        const write = await fetch("settings", {
          method: "POST",
          headers: { "Content-Type": "application/json", "If-Match": etag },
          body: JSON.stringify({ room_name: "Must not replace" }),
        });
        const clear = await fetch("history", { method: "DELETE" });
        const reset = await fetch("state", { method: "DELETE" });
        return {
          snapshot,
          read: read.status,
          readEtag: read.headers.get("ETag"),
          write: write.status,
          clear: clear.status,
          reset: reset.status,
          stored: localStorage.getItem(key),
        };
      }, corrupt);
      assert.equal(result.snapshot.settings_status.available, false);
      assert.equal(result.snapshot.settings_revision, undefined);
      assert.ok(result.snapshot.agents.length > 0);
      assert.equal(result.read, 503);
      assert.equal(result.readEtag, null);
      assert.equal(result.write, 503);
      assert.equal(result.clear, 503);
      assert.equal(result.reset, 503);
      assert.equal(result.stored, corrupt);
      assert.equal(await p.locator("#room-name-input").isDisabled(), true);
      assert.match(
        await p.textContent("#settings-save-notice"),
        /demo preferences/i,
      );
      assert.doesNotMatch(
        await p.textContent("#settings-save-notice"),
        /settings\.json/,
      );
      await p.keyboard.press("Escape");
      await p.click("#preview-restore");
      assert.equal(
        await p.evaluate(() =>
          localStorage.getItem("agent-office:static-preview:v1"),
        ),
        corrupt,
        "restoring the sample must not overwrite unreadable preferences",
      );
      await p.reload();
      await p.waitForFunction(() => initialized);
      assert.equal(await p.evaluate(() => settingsReady), false);
      assert.ok(await p.evaluate(() => agents.length > 0));
      await p.evaluate(async (raw) => {
        localStorage.setItem("agent-office:static-preview:v1", raw);
        applyState(await (await fetch("state")).json());
      }, original);
      await p.waitForFunction(() => settingsReady);
    }
    await p.click("#settingsbtn");
    assert.equal(
      await p.inputValue("#room-name-input"),
      "Preserved demo preferences",
    );
    await p.fill("#room-name-input", "Recovered demo preferences");
    await p.click("#room-name-save");
    await p.waitForFunction(() => pendingSaves === 0);
    assert.equal(
      await p.evaluate(
        async () => (await (await fetch("settings")).json()).room_name,
      ),
      "Recovered demo preferences",
    );
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

test("demo task snapshots age and become historical without completing unfinished work", () =>
  withPage(async (p) => {
    const initial = await p.evaluate(() => window._state);
    assert.equal(initial.tasks.length, 3);
    const after = await p.evaluate(async () => {
      const seed = window.__AGENT_OFFICE_PREVIEW_SEED__,
        realNow = Date.now();
      seed.state.tasks.find(
        (board) => board.session_id === "demo-opencode",
      ).source_updated_at = seed.base_time - 40;
      Date.now = () => realNow + 310000;
      const quiet = await (await fetch("state")).json();
      Date.now = () => realNow + 1900000;
      const expired = await (await fetch("state")).json();
      return { quiet, expired, realNow };
    });
    const quiet = after.quiet.tasks.find(
      (board) => board.session_id === "demo-opencode",
    );
    assert.equal(quiet.session_status, "idle");
    assert.equal(quiet.historical, false);
    assert.ok(quiet.age_s >= 350);
    assert.ok(
      Math.abs(quiet.source_updated_at - (after.realNow / 1000 - 40)) < 2,
    );
    const ended = after.quiet.tasks.find(
      (board) => board.session_id === "demo-review",
    );
    assert.equal(ended.historical, true);
    assert.equal(ended.session_status, "done");
    const expired = after.expired.tasks.find(
      (board) => board.session_id === "demo-opencode",
    );
    assert.equal(expired.historical, true);
    assert.deepEqual(
      expired.tasks,
      initial.tasks.find((board) => board.session_id === "demo-opencode").tasks,
    );
    assert.equal(
      expired.session_status,
      "working",
      "expired views keep the last durable observation, not an invented completion",
    );
  }));
