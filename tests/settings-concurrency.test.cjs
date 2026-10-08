/* Native two-view settings conflicts against a real, isolated observer. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
const { postSettings } = require("./settings-helper.cjs");
const root = path.resolve(__dirname, ".."),
  base = "http://127.0.0.1:18221";
let home, settingsFile, server, browser;
before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "office-settings-conflicts-"));
  const directory = path.join(home, "pixel-office");
  fs.mkdirSync(directory);
  settingsFile = path.join(directory, "settings.json");
  const now = Date.now() / 1000;
  fs.writeFileSync(
    path.join(directory, "events.jsonl"),
    ["alpha", "beta"]
      .map((id, i) =>
        JSON.stringify({
          event: "session_start",
          session_id: id,
          platform: i ? "claude" : "hermes",
          title: id,
          ts: now - 2 + i,
        }),
      )
      .join("\n") + "\n",
  );
  server = spawn(
    process.env.PYTHON || "python",
    ["run.py", "--port", "18221"],
    {
      cwd: root,
      env: { ...process.env, HERMES_HOME: home },
      stdio: "ignore",
    },
  );
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/state")).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox"],
  });
});
after(async () => {
  await browser?.close();
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill();
    await exited;
  }
  if (home) fs.rmSync(home, { recursive: true, force: true });
});
async function withViews(run) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  const a = await context.newPage(),
    b = await context.newPage();
  for (const p of [a, b]) {
    p.setDefaultTimeout(10000);
    p.on("pageerror", (error) => errors.push(error.message));
  }
  try {
    assert.equal(
      (
        await postSettings(a.request, base + "/settings", {
          data: {
            agent_names: {},
            agent_preferences: {},
            pet_names: {},
            furniture: [],
            decorations: false,
            theme: "plum",
            room_name: "Conflict fixture",
          },
        })
      ).ok(),
      true,
    );
    for (const p of [a, b]) {
      await p.goto(base);
      await p.waitForFunction(
        () => initialized && settingsReady && officeScene.loadedAssets === 23,
      );
    }
    // Two valid loaded views; simulate a background view whose next observation
    // has not arrived. Its writes still reach the actual server.
    await b.route("**/state", (route) => route.abort());
    await run(a, b);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}
async function stored(p) {
  return await (await p.request.get(base + "/settings")).json();
}
async function accounting(p) {
  const s = await (await p.request.get(base + "/state")).json();
  return {
    progress: s.progress,
    usage: s.usage,
    events: s.events,
    received: s.tracking.received,
  };
}
async function inspector(p, id) {
  await p.click("#floorbtn");
  await p.locator(`#roster [data-agent="${id}"]`).click();
}
async function settled(p) {
  await p.waitForFunction(() => pendingSaves === 0);
}

test("a stale agent-name save preserves another view's name and a native retry keeps both", () =>
  withViews(async (a, b) => {
    const before = await accounting(a);
    await inspector(a, "alpha");
    await a.fill("#agent-name-input", "Alpha from A");
    await a.click("#agent-name-save");
    await settled(a);
    await inspector(b, "beta");
    await b.fill("#agent-name-input", "Beta from B");
    await b.click("#agent-name-save");
    await settled(b);
    assert.deepEqual(
      (await stored(a)).agent_names,
      { alpha: "Alpha from A" },
      "stale map must not erase Alpha",
    );
    assert.equal(await b.inputValue("#agent-name-input"), "Beta from B");
    assert.match(
      await b.textContent("#settings-save-notice"),
      /another|changed|review/i,
    );
    await b.click("#agent-name-save");
    await settled(b);
    assert.deepEqual((await stored(a)).agent_names, {
      alpha: "Alpha from A",
      beta: "Beta from B",
    });
    assert.deepEqual(await accounting(a), before);
  }));

test("a stale appearance save keeps another agent's preference and retains the selected draft", () =>
  withViews(async (a, b) => {
    await inspector(a, "alpha");
    await a.selectOption("#agent-appearance-select", "studio-assistant");
    await a.click("#agent-preference-save");
    await settled(a);
    await inspector(b, "beta");
    await b.selectOption("#agent-appearance-select", "char4");
    await b.click("#agent-preference-save");
    await settled(b);
    assert.deepEqual((await stored(a)).agent_preferences, {
      alpha: { appearance: "studio-assistant" },
    });
    assert.equal(await b.inputValue("#agent-appearance-select"), "char4");
    await b.click("#agent-preference-save");
    await settled(b);
    assert.deepEqual((await stored(a)).agent_preferences, {
      alpha: { appearance: "studio-assistant" },
      beta: { appearance: "char4" },
    });
  }));

test("a stale pet-name save restores its untouched sibling field before a native retry", () =>
  withViews(async (a, b) => {
    await a.click("#settingsbtn");
    await a.fill("#pet-cat1-name", "Orange from A");
    await a.locator("#pet-name-form button").click();
    await settled(a);
    await b.click("#settingsbtn");
    await b.fill("#pet-cat2-name", "Black from B");
    await b.locator("#pet-name-form button").click();
    await settled(b);
    assert.deepEqual((await stored(a)).pet_names, { cat1: "Orange from A" });
    assert.equal(await b.inputValue("#pet-cat1-name"), "Orange from A");
    assert.equal(await b.inputValue("#pet-cat2-name"), "Black from B");
    await b.locator("#pet-name-form button").click();
    await settled(b);
    assert.deepEqual((await stored(a)).pet_names, {
      cat1: "Orange from A",
      cat2: "Black from B",
    });
  }));

test("a conflicted furniture import leaves the current room intact until a reviewed reimport", () =>
  withViews(async (a, b) => {
    const stool = { kind: "stool", x: 0.2, y: 0.9 },
      plant = { kind: "monstera", x: 0.8, y: 0.9 };
    const upload = async (p, furniture) => {
      const request = p.waitForResponse(
        (response) =>
          response.url().endsWith("/settings") &&
          response.request().method() === "POST",
      );
      await p.locator("#import-settings").setInputFiles({
        name: "agent-office-layout.json",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({ version: 1, settings: { furniture } }),
        ),
      });
      await request;
      await p.waitForFunction(() => !furnitureSaving && pendingSaves === 0);
    };
    await a.click("#settingsbtn");
    await upload(a, [stool]);
    await b.click("#settingsbtn");
    await upload(b, [plant]);
    assert.deepEqual((await stored(a)).furniture, [stool]);
    assert.match(
      await b.textContent("#settings-save-notice"),
      /another|changed|review/i,
    );
    assert.equal(await b.evaluate(() => furnitureHistory.length), 0);
    // Import is intentionally a replacement. The user reviews the current room
    // and selects a revised file rather than silently rebasing a stale array.
    await upload(b, [stool, plant]);
    assert.deepEqual((await stored(a)).furniture, [stool, plant]);
  }));

test("a conflict invalidates all older queued map writes instead of rebasing them", () =>
  withViews(async (a, b) => {
    let release,
      calls = 0;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    await b.route("**/settings", async (route) => {
      if (route.request().method() === "POST") {
        calls++;
        if (calls === 1) await held;
      }
      await route.continue();
    });
    try {
      await b.click("#settingsbtn");
      await b.fill("#pet-cat2-name", "First B draft");
      await b.locator("#pet-name-form button").click();
      await b.waitForFunction(() => pendingSaves === 1);
      await b.fill("#pet-cat2-name", "Newer B draft");
      await b.locator("#pet-name-form button").click();
      await b.waitForFunction(() => pendingSaves === 2);
      await a.click("#settingsbtn");
      await a.fill("#pet-cat1-name", "A kept");
      await a.locator("#pet-name-form button").click();
      await settled(a);
      release();
      await settled(b);
      assert.equal(
        calls,
        1,
        "the second stale full-map patch must never be sent",
      );
      assert.deepEqual((await stored(a)).pet_names, { cat1: "A kept" });
      assert.equal(await b.inputValue("#pet-cat2-name"), "Newer B draft");
      await b.locator("#pet-name-form button").click();
      await settled(b);
      assert.deepEqual((await stored(a)).pet_names, {
        cat1: "A kept",
        cat2: "Newer B draft",
      });
    } finally {
      release();
    }
  }));

test("a settings read failure keeps observations visible but blocks later edits until repair", () =>
  withViews(async (a) => {
    const original = fs.readFileSync(settingsFile);
    const broken = Buffer.from('{"room_name":"preserve these original bytes"');
    try {
      fs.writeFileSync(settingsFile, broken);
      await a.waitForFunction(
        () => window._state?.settings_status?.available === false,
      );
      assert.equal(await a.evaluate(() => settingsReady), false);
      assert.equal(await a.textContent("#connection"), "Connected");
      assert.equal(await a.textContent("#agent-total"), "2");
      await a.click("#settingsbtn");
      assert.equal(await a.isDisabled("#room-name-input"), true);
      assert.match(
        await a.textContent("#settings-loading-status"),
        /repair|read|unavailable/i,
      );
      assert.equal(
        await a.evaluate(() => saveSettings({ theme: "juniper" })),
        false,
      );
      assert.deepEqual(fs.readFileSync(settingsFile), broken);
      fs.writeFileSync(settingsFile, original);
      await a.waitForFunction(() => settingsReady === true);
      assert.equal(await a.isDisabled("#room-name-input"), false);
      await a.fill("#room-name-input", "Repaired office");
      await a.click("#room-name-save");
      await settled(a);
      assert.equal((await stored(a)).room_name, "Repaired office");
    } finally {
      fs.writeFileSync(settingsFile, original);
    }
  }));

test("the first unavailable settings response still renders observed agents safely", () =>
  withViews(async (a) => {
    const original = fs.readFileSync(settingsFile);
    try {
      fs.writeFileSync(settingsFile, "[invalid settings");
      await a.reload();
      await a.waitForFunction(
        () =>
          initialized && window._state?.settings_status?.available === false,
      );
      assert.equal(await a.evaluate(() => settingsReady), false);
      assert.equal(await a.textContent("#agent-total"), "2");
      assert.equal(await a.textContent("#connection"), "Connected");
      await a.click("#settingsbtn");
      assert.equal(await a.isDisabled("#room-name-input"), true);
      assert.match(
        await a.textContent("#settings-loading-status"),
        /repair|read|unavailable/i,
      );
    } finally {
      fs.writeFileSync(settingsFile, original);
    }
  }));

test("the mobile inspector leads with real activity before naming and desk controls", () =>
  withViews(async (a) => {
    fs.appendFileSync(
      path.join(home, "pixel-office/events.jsonl"),
      JSON.stringify({
        event: "tool_start",
        session_id: "alpha",
        platform: "hermes",
        tool_name: "Read",
        call_id: "panel-read",
        ts: Date.now() / 1000,
      }) + "\n",
    );
    await a.waitForFunction(
      () => agents.find((agent) => agent.id === "alpha")?.status === "working",
    );
    await a.setViewportSize({ width: 320, height: 568 });
    await inspector(a, "alpha");
    assert.match(await a.textContent("#inspector-summary"), /Working/);
    assert.match(await a.textContent("#inspector-summary"), /Read/);
    const summary = await a.locator("#inspector-summary").boundingBox();
    const name = await a.locator("#agent-name-form").boundingBox();
    assert.ok(
      summary.y >= 8 && summary.y + summary.height < 540,
      "the live summary is visible without scrolling",
    );
    assert.ok(
      summary.y + summary.height <= name.y,
      "customization follows observed work",
    );
    assert.equal(
      await a
        .locator(".sheet:not([hidden])")
        .evaluate((panel) => panel.scrollWidth > panel.clientWidth),
      false,
    );
    assert.equal(
      await a.locator("#filterbtn").getAttribute("aria-label"),
      "Floor runtime",
    );
  }));

test("storage diagnostics distinguish cleanup, processing, unknown measurements and raw history limits", () =>
  withViews(async (a) => {
    await a.route("**/state", async (route) => {
      const response = await route.fetch(),
        state = await response.json();
      Object.assign(state.tracking, {
        backlog: 3,
        backlog_bytes: 1024,
        cleanup_pending: 2,
        cleanup_pending_bytes: 2048,
        inbox_files: 6,
        inbox_bytes: null,
        temporary_files: 1,
        temporary_bytes: 512,
        legacy_log_bytes: 4096,
        usage_units: 25,
        retrying_files: 1,
        database_bytes: 65536,
        retention_suspended: true,
        measurement_errors: ["inbox"],
      });
      await route.fulfill({ response, json: state });
    });
    await a.waitForFunction(
      () => window._state?.tracking?.cleanup_pending === 2,
    );
    assert.equal(await a.isVisible("#health-alert"), true);
    await a.click("#health-alert");
    assert.equal(
      await a.isVisible("#storage-measurements"),
      true,
      "the storage alert opens its measured details directly",
    );
    const text = await a.textContent("#storage-diagnostics");
    assert.match(text, /Waiting to process[\s\S]*3/);
    assert.match(text, /Processed, awaiting cleanup[\s\S]*2/);
    assert.match(text, /Inbox total[\s\S]*Unavailable/);
    assert.match(text, /Temporary publications[\s\S]*1/);
    assert.match(text, /Legacy log[\s\S]*4 KiB/);
    assert.match(text, /Usage correction records[\s\S]*25/);
    assert.match(text, /Unreadable files to retry[\s\S]*1/);
    assert.match(text, /raw event history/i);
    assert.equal(await a.isVisible("#retention-paused"), true);
    assert.match(
      text,
      /Automatic history pruning is paused until settings can be read/,
    );
    assert.match(
      text,
      /inbox.*could not be measured|could not be measured.*inbox/i,
    );
    await a.setViewportSize({ width: 320, height: 568 });
    assert.equal(
      await a
        .locator("#sheet-settings")
        .evaluate((panel) => panel.scrollWidth > panel.clientWidth),
      false,
    );
  }));

test("the Tasks panel distinguishes unavailable coverage from a reported empty collection", () =>
  withViews(async (a) => {
    await a.route("**/state", (route) => route.abort());
    await a.click("#tasksbtn");
    await a.click('[data-task-view="reported"]');
    for (const coverage of ["missing", "null", "empty"]) {
      await a.evaluate((value) => {
        const next = structuredClone(window._state);
        if (value === "missing") delete next.tasks;
        else next.tasks = value === "null" ? null : [];
        applyState(next);
      }, coverage);
      const content = await a.textContent("#reported-taskboard");
      if (coverage === "empty") {
        assert.match(content, /No task lists reported yet/);
        assert.doesNotMatch(content, /unavailable/);
      } else {
        assert.match(content, /Task reporting is unavailable/);
        assert.doesNotMatch(content, /No task lists reported yet/);
      }
    }
  }));

test("reported task snapshots appear in the existing Tasks panel and retain source state after completion", () =>
  withViews(async (a) => {
    const publish = (event) =>
      fs.appendFileSync(
        path.join(home, "pixel-office/events.jsonl"),
        JSON.stringify({
          platform: "opencode",
          session_id: "workflow",
          ts: Date.now() / 1000,
          ...event,
        }) + "\n",
      );
    publish({ event: "session_start", title: "Review source" });
    await a.waitForFunction(() =>
      agents.some((agent) => agent.id === "workflow"),
    );
    const before = await accounting(a);
    const tasks = [
      {
        id: "read",
        content: "Check the loading notice",
        status: "in_progress",
        priority: "high",
      },
      {
        id: "verify",
        content: "Verify the retry keeps both names",
        status: "pending",
      },
    ];
    publish({
      event: "tasks_update",
      task_source: "opencode.todo.updated",
      tasks,
    });
    await a.waitForFunction(() =>
      window._state?.tasks?.some((board) => board.session_id === "workflow"),
    );
    await a.click("#tasksbtn");
    await a.click('[data-task-view="reported"]');
    assert.equal(await a.isVisible("#taskboard"), false);
    assert.match(
      await a.textContent("#reported-taskboard"),
      /Check the loading notice/,
    );
    assert.match(
      await a.textContent("#reported-taskboard"),
      /opencode.todo.updated/,
    );
    assert.equal(
      await a
        .locator('#reported-taskboard [data-status="in_progress"]')
        .count(),
      1,
    );
    await a.locator("#reported-taskboard .task-agent-link").click();
    assert.equal(await a.isVisible("#sheet-inspector"), true);
    await a.locator("#sheet-inspector .sheet-back").click();
    assert.equal(
      await a.getAttribute('[data-task-view="reported"]', "aria-pressed"),
      "true",
    );
    await a.reload();
    await a.waitForFunction(() => initialized && opened === "sheet-tasks");
    assert.equal(await a.isVisible("#reported-taskboard"), true);
    assert.equal(
      await a.getAttribute('[data-task-view="reported"]', "aria-pressed"),
      "true",
    );
    assert.equal(
      (await accounting(a)).progress.xp,
      before.progress.xp,
      "task reports do not mint work XP",
    );
    publish({ event: "session_end" });
    publish({
      event: "tasks_update",
      task_source: "opencode.todo.updated",
      tasks: [{ ...tasks[0], status: "completed" }, tasks[1]],
    });
    await a.waitForFunction(
      () =>
        window._state?.tasks?.find((board) => board.session_id === "workflow")
          ?.historical,
    );
    assert.match(
      await a.textContent("#reported-taskboard"),
      /Last reported tasks/,
    );
    assert.equal(
      await a.locator('#reported-taskboard [data-status="pending"]').count(),
      1,
      "ending a session does not complete its pending task",
    );
    assert.equal(
      await a.locator("#reported-taskboard .task-agent-link").count(),
      0,
    );
    await a.setViewportSize({ width: 320, height: 568 });
    assert.equal(
      await a
        .locator("#sheet-tasks")
        .evaluate((panel) => panel.scrollWidth > panel.clientWidth),
      false,
    );
    publish({
      event: "tasks_update",
      task_source: "opencode.todo.updated",
      tasks: [],
    });
    await a.waitForFunction(
      () =>
        window._state?.tasks?.find((board) => board.session_id === "workflow")
          ?.tasks.length === 0,
    );
    assert.match(
      await a.textContent("#reported-taskboard"),
      /source reported an empty task list/i,
    );
  }));
