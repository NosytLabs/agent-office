/* Browser-local recap and per-kind sound preferences. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");
const net = require("node:net");
const os = require("node:os");
const { chromium } = require("playwright");
const { fetchSettings } = require("./settings-helper.cjs");

const root = path.resolve(__dirname, "..");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function observerFixture(options, run) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "office-recap-flow-"));
  const directory = path.join(home, "pixel-office");
  const python = process.env.PYTHON || "python";
  const environment = { ...process.env, HERMES_HOME: home };
  delete environment.AGENT_OFFICE_DEMO;
  const publish = (events) => {
    const result = spawnSync(
      python,
      [
        "-c",
        "import json,sys; from pathlib import Path; from event_inbox import publish; [publish(Path(sys.argv[1]), event) for event in json.load(sys.stdin)]",
        directory,
      ],
      {
        cwd: root,
        env: environment,
        input: JSON.stringify(events),
        encoding: "utf8",
        timeout: 5000,
      },
    );
    assert.equal(result.status, 0, "Actual inbox publisher: " + result.stderr);
  };
  let server,
    browser,
    output = "";
  try {
    publish(options.events || []);
    const probe = net.createServer();
    await new Promise((resolve, reject) =>
      probe.once("error", reject).listen(0, "127.0.0.1", resolve),
    );
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    const base = `http://127.0.0.1:${port}`;
    server = spawn(python, ["run.py", "--port", String(port)], {
      cwd: root,
      env: environment,
      stdio: ["ignore", "ignore", "pipe"],
    });
    server.stderr.on(
      "data",
      (chunk) => (output = (output + chunk).slice(-5000)),
    );
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        if ((await fetch(base + "/state")).ok) {
          ready = true;
          break;
        }
      } catch {}
      assert.equal(server.exitCode, null, "Observer exited: " + output);
      await delay(50);
    }
    assert.ok(ready, "Observer started: " + output);
    await fetchSettings(base + "/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sound: true,
        max_chars: 2,
        ambience: "day",
        ...(options.settings || {}),
      }),
    });
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ["--no-sandbox", ...(options.browserArgs || [])],
    });
    const page = await browser.newPage({
      viewport: options.viewport || { width: 1280, height: 800 },
    });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page.waitForFunction(
      () => initialized && settingsReady && officeScene?.sprites?.petbed,
    );
    await run({ page, base });
    assert.deepEqual(errors, [], "pageerror events: " + errors.join(" | "));
  } finally {
    if (browser) await browser.close();
    if (server && server.exitCode === null) {
      server.kill("SIGKILL");
      await new Promise((resolve) => server.once("exit", resolve));
    }
    try {
      fs.rmSync(path.join(home, "pixel-office"), {
        recursive: true,
        force: true,
      });
    } catch {}
  }
}

function makeEvent(overrides) {
  return {
    ts: Date.now() / 1000,
    session_id: "sess-1",
    platform: "codex",
    event: "tool_end",
    status: "ok",
    tool: "Bash",
    ...overrides,
  };
}

test("per-kind sound preferences hide or show checkboxes by setting", async () => {
  await observerFixture(
    {
      settings: {
        sound: true,
        sound_needs_input: false,
        sound_error: true,
        sound_reward: false,
      },
    },
    async ({ page, base }) => {
      const resp = await fetchSettings(base + "/settings");
      const s = await resp.json();
      console.log(
        "DEBUG s:",
        s.sound_needs_input,
        s.sound_error,
        s.sound_reward,
      );
      await page.locator("#settingsbtn").click();
      await page.waitForFunction(
        () => !!document.querySelector("#sound-prefs-form"),
      );
      const checked = await page.$$eval("[data-sound-pref]", (nodes) =>
        nodes.map((n) => ({ key: n.dataset.soundPref, checked: n.checked })),
      );
      assert.deepEqual(checked, [
        { key: "sound_needs_input", checked: false },
        { key: "sound_error", checked: true },
        { key: "sound_reward", checked: false },
      ]);
    },
  );
});

test("toggling a sound preference persists in settings.json", async () => {
  let saved = null;
  await observerFixture(
    { settings: { sound: true } },
    async ({ page, base }) => {
      await page.locator("#settingsbtn").click();
      await page.waitForFunction(
        () => !!document.querySelector("#sound-prefs-form"),
      );
      await page.waitForFunction(
        () => document.querySelector("#sound-error")?.checked === true,
      );
      await page.locator("#sound-error").click();
      // Wait for the persisted setting to flip on the server.
      for (let i = 0; i < 30; i++) {
        const r = await fetchSettings(base + "/settings");
        saved = await r.json();
        if (saved.sound_error === false) break;
        await delay(100);
      }
    },
  );
  assert.equal(saved.sound_error, false);
  assert.equal(saved.sound_needs_input, true);
  assert.equal(saved.sound_reward, true);
});

test("recap today counts waiting, error and reward events separately", async () => {
  const now = Date.now() / 1000;
  const events = [
    makeEvent({ event: "tool_end", tool: "Bash", status: "ok" }),
    makeEvent({ event: "approval_request", status: "waiting" }),
    makeEvent({ event: "session_error", error_message: "boom" }),
    makeEvent({ event: "tool_end", tool: "read", status: "error" }),
    makeEvent({ event: "achievement", kind: "achievement" }),
  ];
  await observerFixture({ events }, async ({ page }) => {
    await page.locator("#settingsbtn").click();
    await page.waitForFunction(
      () => !!document.querySelector("#recap-summary"),
    );
    const summary = await page.$eval("#recap-summary", (node) =>
      Array.from(node.querySelectorAll("dt")).map((dt, i) => [
        dt.textContent,
        node.querySelectorAll("dd")[i].textContent,
      ]),
    );
    const asMap = Object.fromEntries(summary);
    assert.equal(asMap.Range, "Today");
    assert.equal(Number(asMap.Events), 5);
    assert.equal(Number(asMap["Needs input"]), 1);
    assert.equal(Number(asMap.Errors), 2);
    assert.equal(Number(asMap.Achievements), 1);
    const items = await page.$$eval("#recap-events li", (nodes) =>
      nodes.map((n) => ({ kind: n.dataset.kind, text: n.textContent.trim() })),
    );
    assert.equal(items.length, 4);
    const kinds = items.map((i) => i.kind).sort();
    assert.deepEqual(kinds, ["error", "error", "needs_input", "reward"]);
  });
});

test("mark reviewed switches recap to the since-review window", async () => {
  const events = [
    makeEvent({ event: "tool_end", tool: "Bash", status: "ok" }),
    makeEvent({ event: "session_error", error_message: "early" }),
  ];
  await observerFixture({ events }, async ({ page }) => {
    await page.locator("#settingsbtn").click();
    await page.waitForFunction(
      () => !!document.querySelector("#recap-summary"),
    );
    // Today shows both.
    let eventsCount = await page.$eval(
      "#recap-summary dd:nth-of-type(2)",
      (n) => n.textContent,
    );
    assert.equal(eventsCount, "2");
    // Mark reviewed now and switch to since-review.
    await page.locator("#recap-mark-reviewed").click();
    await delay(50);
    const since = await page.$eval(
      "#recap-summary dd:nth-of-type(2)",
      (n) => n.textContent,
    );
    assert.equal(since, "0");
    const label = await page.$eval(
      "#recap-last-reviewed",
      (n) => n.textContent,
    );
    assert.match(label, /^Last reviewed /);
  });
});
