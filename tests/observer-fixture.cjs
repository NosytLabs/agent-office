/* Isolated real HTTP observer for focused scene integration flows. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("playwright");
const { fetchSettings } = require("./settings-helper.cjs");
const root = path.resolve(__dirname, "..");
const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function observerFixture(options, run) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "office-scene-flow-"));
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
        input: JSON.stringify(
          events.map((event) => ({ ts: Date.now() / 1000, ...event })),
        ),
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
    server.stderr.on("data", (chunk) => {
      output = (output + chunk).slice(-5000);
    });
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
    const saved = await fetchSettings(base + "/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        max_chars: 2,
        sound: false,
        ambience: "day",
        ...options.settings,
      }),
    });
    assert.ok(saved.ok, "Fixture settings saved through conditional HTTP");
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage({
      viewport: options.viewport || { width: 1440, height: 1000 },
      reducedMotion: options.reducedMotion || "no-preference",
    });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page.waitForFunction(
      () => initialized && settingsReady && officeScene.sprites.petbed,
    );
    await run({
      page,
      publish,
      base,
      directory,
      state: async () => (await fetch(base + "/state")).json(),
    });
    assert.deepEqual(errors, [], "No uncaught browser errors");
  } finally {
    await browser?.close();
    if (server && server.exitCode === null) {
      server.kill();
      await Promise.race([
        new Promise((resolve) => server.once("exit", resolve)),
        delay(3000),
      ]);
      if (server.exitCode === null) server.kill("SIGKILL");
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
}

module.exports = { observerFixture };
