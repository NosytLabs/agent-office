/* Native preference saves against the real observer; fixture actors never expire. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."),
  base = "http://127.0.0.1:18126";
const expected = { hermes: 0, claude: 1, opencode: 2, codex: 3, child: 4 };
let home,
  server,
  serverErrors = "";
before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "office-seat-stability-"));
  fs.mkdirSync(path.join(home, "pixel-office"));
  const now = Date.now() / 1000 - 10;
  const records = ["hermes", "claude", "opencode", "codex"].map(
    (platform, i) => ({
      event: "session_start",
      platform,
      session_id: platform,
      title: platform,
      ts: now + i,
    }),
  );
  records.push({
    event: "subagent_start",
    platform: "opencode",
    session_id: "opencode",
    parent_session_id: "opencode",
    child_session_id: "child",
    child_goal: "Stable fixture child",
    ts: now + 4,
  });
  fs.writeFileSync(
    path.join(home, "pixel-office/events.jsonl"),
    records.map(JSON.stringify).join("\n") + "\n",
  );
  server = spawn(
    process.env.PYTHON || "python",
    ["run.py", "--port", "18126"],
    {
      cwd: root,
      env: { ...process.env, HERMES_HOME: home },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  server.stderr.on("data", (chunk) => {
    serverErrors = (serverErrors + chunk).slice(-3000);
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/state")).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Seat regression observer did not start: " + serverErrors);
});
after(async () => {
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill();
    await exited;
  }
  if (home) fs.rmSync(home, { recursive: true, force: true });
});
async function withPage(run) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox"],
  });
  try {
    const p = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    p.setDefaultTimeout(10000);
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    assert.equal(
      (
        await p.request.post(base + "/settings", {
          data: { agent_preferences: {} },
        })
      ).ok(),
      true,
    );
    await p.goto(base);
    await p.waitForFunction(
      () => initialized && officeScene.grid?.seats.length === 5,
    );
    assert.deepEqual(await desks(p), expected);
    await run(p);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}
async function desks(p) {
  return p.evaluate(() =>
    Object.fromEntries(
      officeScene.grid.seats.map(({ a, slot }) => [a.id, slot]),
    ),
  );
}
async function ledger(p) {
  const state = await (await p.request.get(base + "/state")).json();
  return {
    ids: state.agents.map((a) => a.id).sort(),
    xp: state.progress.xp,
    stats: state.progress.stats,
    received: state.tracking.received,
    usage: state.usage,
  };
}
async function chooseDesk(p) {
  await p.click("#floorbtn");
  await p.locator('#roster [data-agent="hermes"]').click();
  await p.selectOption("#agent-seat-select", "5");
  await p.selectOption("#agent-appearance-select", "studio-assistant");
}
const moved = { claude: 1, opencode: 2, codex: 3, child: 4, hermes: 5 };
test("confirmed native preference saves keep all five identities and automatic peers at their desks", () =>
  withPage(async (p) => {
    const before = await ledger(p);
    await chooseDesk(p);
    await p.click("#agent-preference-save");
    await p.waitForFunction(
      () =>
        pendingSaves === 0 &&
        officeScene.grid.seats.find((s) => s.a.id === "hermes")?.slot === 5,
    );
    assert.match(await p.textContent("#agent-preference-status"), /saved/i);
    assert.deepEqual(await desks(p), moved);
    assert.deepEqual(await ledger(p), before);
    await p.setViewportSize({ width: 390, height: 844 });
    await p.waitForFunction(() => officeScene.grid.columns === 2);
    assert.deepEqual(
      await desks(p),
      moved,
      "mobile reflow preserves logical desk ownership",
    );
    await p.click("#agent-preference-reset");
    await p.waitForFunction(
      () =>
        pendingSaves === 0 &&
        officeScene.grid.seats.find((s) => s.a.id === "hermes")?.slot === 0,
    );
    assert.deepEqual(
      await desks(p),
      expected,
      "reset restores the free automatic home without moving peers",
    );
    await p.selectOption("#agent-seat-select", "5");
    await p.selectOption("#agent-appearance-select", "studio-assistant");
    await p.click("#agent-preference-save");
    await p.waitForFunction(() => pendingSaves === 0);
    await p.reload();
    await p.waitForFunction(
      () => initialized && officeScene.grid?.seats.length === 5,
    );
    assert.equal(
      (await desks(p)).hermes,
      5,
      "explicit preference survives reload",
    );
    assert.equal(
      await p.evaluate(() => settings.agent_preferences.hermes.appearance),
      "studio-assistant",
    );
    assert.deepEqual(await ledger(p), before);
  }));
test("a rejected native preference save restores the automatic home and never moves peers", () =>
  withPage(async (p) => {
    const before = await ledger(p);
    await chooseDesk(p);
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    await p.route("**/settings", async (route) => {
      if (
        route.request().method() === "POST" &&
        route.request().postDataJSON().agent_preferences
      ) {
        await held;
        await route.fulfill({ status: 503, body: "unavailable" });
      } else await route.continue();
    });
    try {
      await p.click("#agent-preference-save");
      await p.waitForFunction(
        () =>
          pendingSaves === 1 &&
          officeScene.grid.seats.find((s) => s.a.id === "hermes")?.slot === 5,
      );
      assert.deepEqual(
        await desks(p),
        moved,
        "optimistic rendering keeps peer slots",
      );
      release();
      await p.waitForFunction(
        () =>
          pendingSaves === 0 &&
          officeScene.grid.seats.find((s) => s.a.id === "hermes")?.slot === 0,
      );
      assert.match(
        await p.textContent("#agent-preference-status"),
        /not saved/i,
      );
      assert.deepEqual(await desks(p), expected);
      assert.equal(
        await p.inputValue("#agent-seat-select"),
        "5",
        "failed choice remains retryable",
      );
      assert.deepEqual(await ledger(p), before);
    } finally {
      release();
    }
  }));
