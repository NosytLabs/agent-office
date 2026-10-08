/* HUD regressions against a real observer; all records are synthetic fixtures. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."),
  baseURL = "http://127.0.0.1:18123";
const reports =
  process.env.OFFICE_HUD_SCREENSHOTS || path.join(root, "reports/hud");
const viewKey = "agent-office:view:v1:observer",
  previewKey = "agent-office:view:v1:preview";
let home, log, server;
const record = (event, extra = {}) => ({
  event,
  platform: "claude",
  session_id: "hud-0",
  ts: Date.now() / 1000,
  ...extra,
});
function publish(events) {
  fs.appendFileSync(log, events.map(JSON.stringify).join("\n") + "\n");
}
before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "office-hud-"));
  fs.mkdirSync(path.join(home, "pixel-office"));
  log = path.join(home, "pixel-office/events.jsonl");
  fs.writeFileSync(log, "");
  publish([
    ...Array.from({ length: 18 }, (_, i) => [
      record("session_start", {
        session_id: "hud-" + i,
        platform: i % 2 ? "opencode" : "claude",
        title: "Workspace review " + i,
      }),
      record("tool_start", {
        session_id: "hud-" + i,
        platform: i % 2 ? "opencode" : "claude",
        tool_name: "Read",
        call_id: "active-" + i,
      }),
    ]).flat(),
    ...Array.from({ length: 160 }, (_, i) =>
      record("session_update", {
        session_id: "hud-0",
        title: "Inspect source file " + i,
      }),
    ),
    record("usage", {
      usage_id: "full",
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
      cached_input_tokens: 60,
      reasoning_output_tokens: 20,
      cost_usd: 0.03,
      cost_source: "test runtime estimate",
    }),
    record("usage", {
      session_id: "hud-1",
      platform: "opencode",
      usage_id: "partial-1",
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
      cost_usd: 0,
      cost_source: "test runtime estimate",
    }),
    record("usage", {
      session_id: "hud-1",
      platform: "opencode",
      usage_id: "partial-2",
      output_tokens: 5,
    }),
    record("usage", {
      session_id: "hud-2",
      usage_id: "different-total",
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 500,
    }),
    record("session_start", {
      session_id: "hud-hermes",
      platform: "cli",
      title: "Hermes terminal",
    }),
    record("usage", {
      session_id: "hud-hermes",
      platform: "hermes",
      usage_id: "zero",
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      cost_usd: 0,
      cost_source: "test runtime estimate",
    }),
    record("session_start", {
      session_id: "hud-alias",
      platform: "cli",
      title: "Exact CLI usage",
    }),
    record("usage", {
      session_id: "hud-alias",
      platform: "cli",
      usage_id: "cli-exact",
      input_tokens: 20,
      output_tokens: 5,
      total_tokens: 25,
      cost_usd: 0,
    }),
    record("usage", {
      session_id: "hud-alias",
      platform: "hermes",
      usage_id: "hermes-alias",
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
      cost_usd: 0.03,
    }),
  ]);
  server = spawn(
    process.env.PYTHON || "python",
    ["run.py", "--port", "18123"],
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
  throw new Error("HUD observer did not start");
});
after(async () => {
  if (server && server.exitCode === null) {
    const closed = new Promise((r) => server.once("exit", r));
    server.kill();
    await closed;
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
    const context = await browser.newContext({
      viewport: options.viewport || { width: 1440, height: 1000 },
      reducedMotion: options.reducedMotion || "no-preference",
    });
    const p = await context.newPage();
    await p.request.post(baseURL + "/settings", {
      data: {
        agent_preferences: {},
        show_pets: true,
        pets_roam: true,
        ...options.initialSettings,
      },
    });
    p.setDefaultTimeout(10000);
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.stack || e.message));
    if (options.stored !== undefined)
      await p.addInitScript(
        ({ key, value }) => {
          localStorage.setItem(key, value);
        },
        { key: viewKey, value: options.stored },
      );
    if (options.unavailableStorage)
      await p.addInitScript(() => {
        Storage.prototype.getItem = Storage.prototype.setItem = () => {
          throw new DOMException("Unavailable", "SecurityError");
        };
      });
    let releaseInitialState;
    if (options.beforeReady) {
      const held = new Promise((resolve) => {
        releaseInitialState = resolve;
      });
      let attempts = 0;
      await p.route("**/state", async (route) => {
        if (options.failFirstState && attempts++ === 0) {
          await route.fulfill({ status: 503, body: "Unavailable" });
          return;
        }
        await held;
        await route.continue().catch(() => {});
      });
    }
    await p.goto(baseURL);
    if (options.beforeReady) {
      try {
        await p.waitForFunction(
          () =>
            typeof startFurniture === "function" &&
            officeScene.loadedAssets >= 19,
        );
        await options.beforeReady(p);
      } finally {
        releaseInitialState();
      }
    }
    await p.waitForFunction(
      () => initialized && officeScene.loadedAssets >= 19,
    );
    await run(p);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}
async function capture(p, name) {
  if (name !== "mobile-notice-and-controls")
    await p.waitForFunction(
      () => !document.querySelector("#toast").children.length,
    );
  fs.mkdirSync(reports, { recursive: true });
  await p.screenshot({
    path: path.join(reports, name + ".png"),
    fullPage: true,
  });
}
async function ledger(p) {
  const s = await (await p.request.get(baseURL + "/state")).json();
  return {
    xp: s.progress.xp,
    stats: s.progress.stats,
    received: s.tracking.received,
    usage: s.usage,
  };
}
async function closeAll(p) {
  const panel = p.locator(".sheet:not([hidden])");
  if (await panel.count())
    await panel
      .getByRole("button", { name: "Close panel", exact: true })
      .click();
}

test("deep mobile panels keep their header and close control visible and preserve reading position", () =>
  withPage(
    async (p) => {
      await p.click("#settingsbtn");
      await p.locator("#history-settings").scrollIntoViewIfNeeded();
      const before = await p
        .locator("#sheet-settings")
        .evaluate((el) => el.scrollTop);
      assert.ok(before > 500);
      const close = await p.locator("#sheet-settings .close").boundingBox();
      assert.ok(
        close.y >= 8 && close.y + close.height <= 900,
        "close remains visible in the deep panel",
      );
      const heading = await p.locator("#sheet-settings h2").boundingBox();
      assert.ok(heading.y >= 8, "panel identity stays visible");
      await capture(p, "mobile-deep-customize");
      await closeAll(p);
      await p.click("#settingsbtn");
      assert.ok(
        Math.abs(
          (await p.locator("#sheet-settings").evaluate((el) => el.scrollTop)) -
            before,
        ) < 3,
        "reopen restores scroll",
      );
      assert.equal(
        await p.evaluate(() => document.querySelector("#wrap").inert),
        true,
      );
    },
    { viewport: { width: 320, height: 900 } },
  ));

test("inspector Back and Escape return to the searched roster and its focused card", () =>
  withPage(async (p) => {
    await p.click("#floorbtn");
    await p.fill("#trackSearch", "Workspace");
    const card = p.locator("#roster .agent-card").last();
    await card.scrollIntoViewIfNeeded();
    const id = await card.getAttribute("data-agent"),
      scroll = await p.locator("#sheet-floor").evaluate((el) => el.scrollTop);
    assert.ok(scroll > 0);
    await card.click();
    assert.equal(await p.isVisible("#sheet-inspector"), true);
    await p.keyboard.press("Escape");
    assert.equal(
      await p.isVisible("#sheet-floor"),
      true,
      "Escape returns to the originating panel",
    );
    assert.equal(await p.inputValue("#trackSearch"), "Workspace");
    assert.ok(
      Math.abs(
        (await p.locator("#sheet-floor").evaluate((el) => el.scrollTop)) -
          scroll,
      ) < 3,
    );
    assert.equal(
      await p.evaluate(() => document.activeElement.dataset.agent),
      id,
    );
    await card.click();
    await p
      .getByRole("button", { name: "Back to Agents", exact: true })
      .click();
    assert.equal(await p.isVisible("#sheet-floor"), true);
    await p.keyboard.press("Escape");
    assert.equal(await p.evaluate(() => opened), null);
    assert.equal(await p.evaluate(() => document.activeElement.id), "floorbtn");
  }));

test("selected saved-event text survives unchanged polling and a newer inserted event", () =>
  withPage(async (p) => {
    await p.click("#eventsbtn");
    await p.click('[data-event-view="history"]');
    await p.waitForFunction(() => historyLoaded && !historyLoading);
    const detail = p
      .locator("#eventbox .event p")
      .filter({ hasText: "Inspect source file" })
      .first();
    await detail.dblclick();
    const selected = await p.evaluate(() => String(getSelection()));
    assert.ok(selected);
    await p.evaluate(() => {
      window.hudSelectedNode = getSelection().anchorNode;
    });
    await p.waitForTimeout(1800);
    assert.equal(
      await p.evaluate(() => String(getSelection())),
      selected,
      "polling leaves selected text intact",
    );
    assert.equal(await p.evaluate(() => hudSelectedNode.isConnected), true);
    publish([record("session_update", { title: "Newer observed title" })]);
    await p.waitForFunction(
      () => historyEvents[0]?.title === "Newer observed title",
    );
    assert.equal(
      await p.evaluate(() => String(getSelection())),
      selected,
      "a new leading row preserves the old selected row",
    );
    await capture(p, "selected-history-stable");
  }));

test("mobile modal scrolling is contained and closing restores the original page position", () =>
  withPage(
    async (p) => {
      await p.locator("#pausebtn").scrollIntoViewIfNeeded();
      const before = await p.evaluate(() => scrollY);
      // Use the keyboard shortcut so opening the panel does not scroll to a toolbar trigger.
      await p.locator("#pausebtn").focus();
      await p.keyboard.press("e");
      await p.click('[data-event-view="history"]');
      await p.waitForFunction(() => historyLoaded && !historyLoading);
      const locked = await p.evaluate(() => scrollY);
      await p.locator("#export-history").scrollIntoViewIfNeeded();
      await p.hover("#sheet-events");
      await p.mouse.wheel(0, 100000);
      await p.waitForTimeout(150);
      await p.mouse.wheel(0, 1000);
      await p.waitForTimeout(150);
      assert.equal(
        await p.evaluate(() => scrollY),
        locked,
        "background does not scroll through the modal",
      );
      await closeAll(p);
      assert.equal(
        await p.evaluate(() => scrollY),
        before,
        "closing restores the page location",
      );
    },
    { viewport: { width: 320, height: 900 } },
  ));

test("identical save failures make one dismissible notice outside camera controls", () =>
  withPage(
    async (p) => {
      const before = await ledger(p);
      await p.click("#settingsbtn");
      await p.route("**/settings", (r) =>
        r.request().method() === "POST"
          ? r.fulfill({ status: 503, body: "unavailable" })
          : r.continue(),
      );
      for (const [group, name] of [
        ["Desk finish", "Classic"],
        ["Delegated agents", "People"],
        ["Color palette", "Juniper"],
      ]) {
        await p
          .getByRole("group", { name: group, exact: true })
          .getByRole("button", { name, exact: true })
          .click();
        await p.waitForFunction(() => pendingSaves === 0);
      }
      assert.equal(
        await p.locator(".toast").count(),
        1,
        "same failure is deduplicated",
      );
      assert.match(await p.textContent("#toast"), /Could not save settings/);
      await closeAll(p);
      await p.locator("#pausebtn").scrollIntoViewIfNeeded();
      assert.equal(
        await p.evaluate(() => {
          const t = document.querySelector(".toast").getBoundingClientRect();
          return [...document.querySelectorAll(".scene-controls button")].some(
            (el) => {
              const r = el.getBoundingClientRect();
              return (
                t.left < r.right &&
                t.right > r.left &&
                t.top < r.bottom &&
                t.bottom > r.top
              );
            },
          );
        }),
        false,
        "notice does not cover camera actions",
      );
      await capture(p, "mobile-notice-and-controls");
      await p
        .getByRole("button", { name: "Dismiss notification", exact: true })
        .click();
      assert.equal(await p.locator(".toast").count(), 0);
      assert.deepEqual(await ledger(p), before);
    },
    { viewport: { width: 320, height: 900 } },
  ));

test("safe local views restore zoom, runtime, pause, panel filters and scroll without observer work", () =>
  withPage(async (p) => {
    const before = await ledger(p);
    await p.click("#zoom-in");
    await p.click("#zoom-in");
    await p.click("#pausebtn");
    await p.selectOption("#filterbtn", "opencode");
    await p.click("#floorbtn");
    await p.fill("#trackSearch", "Workspace");
    await p.locator("#roster .agent-card").last().scrollIntoViewIfNeeded();
    const scroll = await p
      .locator("#sheet-floor")
      .evaluate((el) => el.scrollTop);
    assert.ok(scroll > 0);
    await p.reload();
    await p.waitForFunction(() => initialized);
    assert.equal(await p.evaluate(() => officeScene.zoom), 1.5);
    assert.equal(await p.inputValue("#filterbtn"), "opencode");
    assert.equal(await p.evaluate(() => officeScene.paused), true);
    assert.equal(await p.isVisible("#sheet-floor"), true);
    assert.equal(await p.inputValue("#trackSearch"), "Workspace");
    assert.ok(
      Math.abs(
        (await p.locator("#sheet-floor").evaluate((el) => el.scrollTop)) -
          scroll,
      ) < 3,
    );
    assert.equal(
      await p.evaluate(() => officeJukebox.snapshot().playing),
      false,
    );
    assert.equal(await p.evaluate(() => officeScene.edit), null);
    assert.deepEqual(await p.evaluate(() => officeScene.pan), { x: 0, y: 0 });
    await closeAll(p);
    await p.click("#settingsbtn");
    await p.reload();
    await p.waitForFunction(() => initialized);
    assert.equal(
      await p.evaluate(() => opened),
      null,
      "editing panels do not auto-reopen",
    );
    assert.deepEqual(await ledger(p), before);
  }));

test("invalid saved views are bounded and reduced-motion preference overrides saved motion", () =>
  withPage(
    async (p) => {
      assert.ok(
        await p.evaluate(() => officeScene.zoom >= 1 && officeScene.zoom <= 3),
      );
      assert.equal(await p.inputValue("#filterbtn"), "every");
      assert.equal(await p.evaluate(() => opened), null);
      assert.equal(await p.evaluate(() => officeScene.paused), true);
      assert.deepEqual(await p.evaluate(() => officeScene.pan), { x: 0, y: 0 });
      assert.equal(await p.evaluate(() => officeScene.edit), null);
      assert.equal(
        await p.evaluate(() => officeJukebox.snapshot().playing),
        false,
      );
    },
    {
      reducedMotion: "reduce",
      stored: JSON.stringify({
        version: 1,
        zoom: 999999,
        runtime: "unknown",
        paused: false,
        panel: "sheet-jukebox",
        pan: { x: 1e30, y: -1e30 },
        edit: "sofa",
        music: true,
      }),
    },
  ));

test("unavailable browser storage leaves view controls usable", () =>
  withPage(
    async (p) => {
      await p.click("#zoom-in");
      assert.equal(await p.evaluate(() => officeScene.zoom), 1.25);
      await p.click("#floorbtn");
      assert.equal(await p.isVisible("#sheet-floor"), true);
      await closeAll(p);
    },
    { unavailableStorage: true },
  ));

test("static preview and observer view preferences use separate namespaces", () =>
  withPage(async (p) => {
    await p.click("#zoom-in");
    await p.click("#pausebtn");
    const observer = await p.evaluate(
      (key) => localStorage.getItem(key),
      viewKey,
    );
    assert.ok(observer);
    const preview = await p.context().newPage();
    await preview.route(baseURL + "/", async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace(
        "<body>",
        '<body data-agent-office-preview="1">',
      );
      await route.fulfill({ response, body });
    });
    await preview.goto(baseURL);
    await preview.waitForFunction(() => initialized);
    assert.equal(await preview.evaluate(() => officeScene.zoom), 1);
    assert.equal(await preview.evaluate(() => officeScene.paused), false);
    await preview.click("#zoom-in");
    await preview.click("#zoom-in");
    assert.equal(
      await preview.evaluate((key) => localStorage.getItem(key), viewKey),
      observer,
    );
    assert.equal(
      JSON.parse(
        await preview.evaluate((key) => localStorage.getItem(key), previewKey),
      ).zoom,
      1.5,
    );
    await preview.close();
    await p.reload();
    await p.waitForFunction(() => initialized);
    assert.equal(await p.evaluate(() => officeScene.zoom), 1.25);
  }));

test("agent summaries show reported totals and provenance without double-counting token subsets", () =>
  withPage(async (p) => {
    const before = await ledger(p);
    await p.click("#floorbtn");
    const full = p.locator('#roster [data-agent="hud-0"] .agent-usage');
    assert.match(await full.textContent(), /150/);
    assert.match(await full.textContent(), /0\.03/);
    assert.match(await full.textContent(), /estimate/i);
    const bar = full.locator('[role="img"]');
    assert.equal(await bar.count(), 1);
    assert.match(await bar.getAttribute("aria-label"), /100 input.*50 output/i);
    assert.match(await full.getAttribute("title"), /test runtime estimate/);
    const partial = p.locator('#roster [data-agent="hud-1"] .agent-usage');
    assert.match(await partial.textContent(), /120/);
    assert.match(await partial.textContent(), /partial/i);
    assert.match(await partial.textContent(), /0\.00/);
    assert.equal(await partial.locator('[role="img"]').count(), 0);
    const inconsistent = p.locator('#roster [data-agent="hud-2"] .agent-usage');
    assert.equal(await inconsistent.locator('[role="img"]').count(), 0);
    const unknown = p.locator('#roster [data-agent="hud-3"] .agent-usage');
    assert.match(await unknown.textContent(), /not reported/i);
    assert.doesNotMatch(await unknown.textContent(), /\$0/);
    const zero = p.locator('#roster [data-agent="hud-hermes"] .agent-usage');
    assert.match(await zero.textContent(), /0 tokens/i);
    assert.match(await zero.textContent(), /0\.00/);
    assert.equal(await zero.locator('[role="img"]').count(), 0);
    await p.locator('#roster [data-agent="hud-0"]').scrollIntoViewIfNeeded();
    await capture(p, "agent-reported-usage");
    assert.deepEqual(await ledger(p), before);
  }));

test("all HUD panels and notice controls fit at 320 pixels", () =>
  withPage(
    async (p) => {
      for (const id of [
        "floorbtn",
        "tasksbtn",
        "eventsbtn",
        "achbtn",
        "settingsbtn",
        "helpbtn",
      ]) {
        await p.click("#" + id);
        const panel = p.locator(".sheet:not([hidden])");
        assert.equal(
          await panel.evaluate((el) => el.scrollWidth > el.clientWidth),
          false,
          id + " has no horizontal panel overflow",
        );
        assert.equal(
          await p.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        const close = await panel
          .getByRole("button", { name: "Close panel", exact: true })
          .boundingBox();
        assert.ok(close.x >= 8 && close.x + close.width <= 312);
        await closeAll(p);
      }
    },
    { viewport: { width: 320, height: 900 } },
  ));

test("inspector desk and appearance choices persist, render, and restore defaults without accounting changes", () =>
  withPage(async (p) => {
    const before = await ledger(p);
    await p.click("#floorbtn");
    await p.locator('#roster [data-agent="hud-0"]').click();
    assert.equal(await p.locator("#agent-appearance-select option").count(), 8);
    const free = await p
      .locator("#agent-seat-select option")
      .evaluateAll(
        (options) =>
          options.find(
            (o) =>
              o.value !== "auto" &&
              !o.disabled &&
              o.textContent.includes("Available"),
          )?.value,
      );
    assert.ok(free);
    await p.selectOption("#agent-seat-select", free);
    await p.selectOption("#agent-appearance-select", "studio-assistant");
    await p.click("#agent-preference-save");
    await p.waitForFunction(() => pendingSaves === 0);
    assert.match(await p.textContent("#agent-preference-status"), /saved/i);
    assert.deepEqual(
      await p.evaluate(() => settings.agent_preferences["hud-0"]),
      { seat: Number(free), appearance: "studio-assistant" },
    );
    await p.keyboard.press("Escape");
    assert.equal(
      await p
        .locator('#roster [data-agent="hud-0"] canvas')
        .evaluate((canvas) => {
          const expected = document.createElement("canvas");
          expected.width = 16;
          expected.height = 24;
          expected
            .getContext("2d")
            .drawImage(
              officeScene.sprites["studio-assistant"],
              0,
              8,
              16,
              24,
              0,
              0,
              16,
              24,
            );
          return canvas.toDataURL() === expected.toDataURL();
        }),
      true,
      "portrait uses the chosen loaded sprite",
    );
    await closeAll(p);
    await p.reload();
    await p.waitForFunction(() => initialized);
    await p.click("#floorbtn");
    await p.locator('#roster [data-agent="hud-0"]').click();
    assert.equal(await p.inputValue("#agent-seat-select"), free);
    assert.equal(
      await p.inputValue("#agent-appearance-select"),
      "studio-assistant",
    );
    await capture(p, "desktop-inspector-personalization");
    await p.locator("#inspectorbox h3").first().scrollIntoViewIfNeeded();
    await capture(p, "desktop-inspector-usage");
    await p.click("#agent-preference-reset");
    await p.waitForFunction(() => pendingSaves === 0);
    assert.equal(
      await p.evaluate(() => settings.agent_preferences["hud-0"]),
      undefined,
    );
    assert.equal(await p.inputValue("#agent-seat-select"), "auto");
    assert.equal(await p.inputValue("#agent-appearance-select"), "default");
    assert.deepEqual(await ledger(p), before);
  }));

test("failed preference writes retain drafts and hidden occupied desks stay unavailable", () =>
  withPage(async (p) => {
    const before = await ledger(p);
    await p.selectOption("#filterbtn", "claude");
    await p.click("#floorbtn");
    await p.locator('#roster [data-agent="hud-0"]').click();
    const occupied = await p.evaluate(
      () => officeScene.seatOptions().find((o) => o.agentId === "hud-1").slot,
    );
    assert.equal(
      await p
        .locator(`#agent-seat-select option[value="${occupied}"]`)
        .isDisabled(),
      true,
      "filtered actors still own their desks",
    );
    await p.selectOption("#agent-appearance-select", "char5");
    await p.route("**/settings", (r) =>
      r.request().method() === "POST"
        ? r.fulfill({ status: 503, body: "unavailable" })
        : r.continue(),
    );
    await p.click("#agent-preference-save");
    await p.waitForFunction(() => pendingSaves === 0);
    assert.match(await p.textContent("#agent-preference-status"), /not saved/i);
    assert.equal(
      await p.evaluate(() => settings.agent_preferences["hud-0"]),
      undefined,
    );
    await p.waitForTimeout(1800);
    assert.equal(
      await p.inputValue("#agent-appearance-select"),
      "char5",
      "polling preserves the failed draft",
    );
    await p.unroute("**/settings");
    await p.click("#agent-preference-save");
    await p.waitForFunction(() => pendingSaves === 0);
    assert.equal(
      await p.evaluate(() => settings.agent_preferences["hud-0"].appearance),
      "char5",
    );
    assert.deepEqual(await ledger(p), before);
  }));

test("inactive preference cleanup frees a bounded map and preserves active filtered agents and names", () =>
  withPage(async (p) => {
    const prefs = Object.fromEntries(
      Array.from({ length: 126 }, (_, i) => [
        "departed-" + i,
        { appearance: "char2" },
      ]),
    );
    prefs["hud-0"] = { appearance: "char1" };
    prefs["hud-1"] = { appearance: "char5" };
    await p.request.post(baseURL + "/settings", {
      data: {
        agent_preferences: prefs,
        agent_names: { "hud-1": "Hidden colleague" },
      },
    });
    await p.reload();
    await p.waitForFunction(() => initialized);
    const before = await ledger(p);
    await p.selectOption("#filterbtn", "claude");
    await p.click("#settingsbtn");
    assert.match(
      await p.textContent("#agent-preferences-count"),
      /126 inactive/,
    );
    await p.click("#clear-inactive-preferences");
    await p.waitForFunction(() => pendingSaves === 0);
    assert.deepEqual(await p.evaluate(() => settings.agent_preferences), {
      "hud-0": { appearance: "char1" },
      "hud-1": { appearance: "char5" },
    });
    assert.equal(
      await p.evaluate(() => settings.agent_names["hud-1"]),
      "Hidden colleague",
    );
    assert.match(await p.textContent("#agent-preferences-reset-status"), /126/);
    await closeAll(p);
    await p.click("#floorbtn");
    await p.locator('#roster [data-agent="hud-2"]').click();
    await p.selectOption("#agent-appearance-select", "char3");
    await p.click("#agent-preference-save");
    await p.waitForFunction(() => pendingSaves === 0);
    assert.equal(
      await p.evaluate(() => settings.agent_preferences["hud-2"].appearance),
      "char3",
    );
    assert.deepEqual(await ledger(p), before);
  }));

test("pet visibility and movement controls persist and gate keyboard visits without accounting writes", () =>
  withPage(async (p) => {
    const before = await ledger(p);
    await p.click("#settingsbtn");
    await p
      .getByRole("group", { name: "Pets", exact: true })
      .getByRole("button", { name: "Hide", exact: true })
      .click();
    await p.waitForFunction(() => pendingSaves === 0);
    const orange = p.locator('[data-activity="Pet the orange cat"]');
    assert.equal(await orange.isDisabled(), true);
    assert.equal(await p.evaluate(() => officeScene.petHits.length), 0);
    await p
      .getByRole("group", { name: "Pet movement", exact: true })
      .getByRole("button", { name: "Rest", exact: true })
      .click();
    await p.waitForFunction(() => pendingSaves === 0);
    await p.reload();
    await p.waitForFunction(() => initialized);
    await p.click("#settingsbtn");
    assert.equal(
      await p
        .getByRole("group", { name: "Pets", exact: true })
        .getByRole("button", { name: "Hide", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await p
        .getByRole("group", { name: "Pet movement", exact: true })
        .getByRole("button", { name: "Rest", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await p
      .getByRole("group", { name: "Pets", exact: true })
      .getByRole("button", { name: "Show", exact: true })
      .click();
    await p.waitForFunction(() => pendingSaves === 0);
    assert.equal(await orange.isDisabled(), false);
    await p
      .getByRole("group", { name: "Desk finish", exact: true })
      .evaluate((group) => {
        const panel = document.querySelector("#sheet-settings");
        panel.scrollTop +=
          group.getBoundingClientRect().top -
          panel.getBoundingClientRect().top -
          panel.querySelector(".sheet-header").offsetHeight -
          16;
      });
    await capture(p, "desktop-customize-controls");
    assert.deepEqual(await ledger(p), before);
  }));

test("delayed saved history restores its reading position after reload", () =>
  withPage(async (p) => {
    await p.click("#eventsbtn");
    await p.click('[data-event-view="history"]');
    await p.waitForFunction(() => historyLoaded && !historyLoading);
    await p.locator("#sheet-events").evaluate((el) => (el.scrollTop = 1800));
    await p.waitForTimeout(250);
    const before = await p
      .locator("#sheet-events")
      .evaluate((el) => el.scrollTop);
    assert.ok(before > 1000);
    await p.route("**/history?*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.continue();
    });
    await p.reload();
    await p.waitForFunction(
      () => initialized && historyLoaded && !historyLoading,
    );
    assert.ok(
      Math.abs(
        (await p.locator("#sheet-events").evaluate((el) => el.scrollTop)) -
          before,
      ) < 3,
      "history scroll restores after async rows exist",
    );
    assert.equal(
      JSON.parse(await p.evaluate((key) => localStorage.getItem(key), viewKey))
        .scroll["sheet-events"],
      before,
    );
  }));

test("exact runtime usage wins over a Hermes alias bucket for the same session", () =>
  withPage(async (p) => {
    await p.click("#floorbtn");
    const usage = p.locator('#roster [data-agent="hud-alias"] .agent-usage');
    assert.match(await usage.textContent(), /25 tokens/);
    assert.match(await usage.textContent(), /0\.00/);
    assert.doesNotMatch(await usage.textContent(), /150|0\.03/);
    await p.locator('#roster [data-agent="hud-alias"]').click();
    assert.match(await p.textContent("#inspectorbox"), /25/);
  }));

test("bounded notification eviction preserves keyboard focus inside the active panel", () =>
  withPage(async (p) => {
    await p.click("#settingsbtn");
    await p.evaluate(() => {
      toast("First notice");
      toast("Second notice");
      toast("Third notice");
    });
    await p
      .locator(".toast")
      .first()
      .getByRole("button", { name: "Dismiss notification" })
      .focus();
    await p.evaluate(() => toast("Fourth notice"));
    assert.equal(await p.locator(".toast").count(), 3);
    assert.equal(
      await p.evaluate(() =>
        document
          .querySelector("#sheet-settings")
          .contains(document.activeElement),
      ),
      true,
    );
    assert.equal(
      await p.evaluate(() => document.activeElement.matches("button")),
      true,
    );
  }));

test("a drafted free desk survives another session leaving and an empty desk cannot be saved", () =>
  withPage(async (p) => {
    await p.request.post(baseURL + "/settings", {
      data: { agent_preferences: { "hud-1": { seat: 30 } } },
    });
    await p.reload();
    await p.waitForFunction(() => initialized);
    await p.click("#floorbtn");
    await p.locator('#roster [data-agent="hud-0"]').click();
    await p.selectOption("#agent-seat-select", "31");
    await p.evaluate(() => {
      const next = structuredClone(window._state);
      next.agents = next.agents.filter((agent) => agent.id !== "hud-1");
      applyState(next);
    });
    assert.equal(
      await p.inputValue("#agent-seat-select"),
      "31",
      "departing sessions do not erase a valid unsaved choice",
    );
    const before = await p.evaluate(() =>
      JSON.stringify(settings.agent_preferences),
    );
    await p.locator("#agent-seat-select").evaluate((el) => {
      el.value = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await p.click("#agent-preference-save");
    assert.match(
      await p.textContent("#agent-preference-status"),
      /choose.*desk|select.*desk/i,
    );
    assert.equal(
      await p.evaluate(() => JSON.stringify(settings.agent_preferences)),
      before,
      "empty value is not coerced into Desk 1",
    );
  }));

test("resetting preferences does not overwrite edits made while its save is pending", () =>
  withPage(async (p) => {
    await p.request.post(baseURL + "/settings", {
      data: { agent_preferences: { "hud-0": { appearance: "char5" } } },
    });
    await p.reload();
    await p.waitForFunction(() => initialized);
    await p.click("#floorbtn");
    await p.locator('#roster [data-agent="hud-0"]').click();
    await p.route("**/settings", async (route) => {
      if (route.request().method() === "POST")
        await new Promise((resolve) => setTimeout(resolve, 400));
      await route.continue();
    });
    await p.click("#agent-preference-reset");
    await p.selectOption("#agent-appearance-select", "char4");
    await p.waitForFunction(() => pendingSaves === 0);
    assert.equal(
      await p.inputValue("#agent-appearance-select"),
      "char4",
      "new edit remains a draft after the older reset completes",
    );
    assert.equal(
      await p.evaluate(() => settingsDrafts.has("agent-appearance-select")),
      true,
    );
    assert.equal(
      await p.evaluate(() => settings.agent_preferences["hud-0"]),
      undefined,
    );
    await p.click("#agent-preference-save");
    await p.waitForFunction(() => pendingSaves === 0);
    assert.equal(
      await p.evaluate(() => settings.agent_preferences["hud-0"].appearance),
      "char4",
    );
  }));

test("inactive-choice summary follows departing sessions while Customize stays open", () =>
  withPage(async (p) => {
    await p.request.post(baseURL + "/settings", {
      data: { agent_preferences: { "hud-1": { appearance: "char3" } } },
    });
    await p.reload();
    await p.waitForFunction(() => initialized);
    await p.click("#settingsbtn");
    assert.equal(
      await p.locator("#clear-inactive-preferences").isDisabled(),
      true,
    );
    await p.evaluate(() => {
      const next = structuredClone(window._state);
      next.agents = next.agents.filter((agent) => agent.id !== "hud-1");
      applyState(next);
    });
    assert.match(await p.textContent("#agent-preferences-count"), /1 inactive/);
    assert.equal(
      await p.locator("#clear-inactive-preferences").isDisabled(),
      false,
    );
  }));

test("initial loading blocks furniture actions and imports without replacing saved furniture", () => {
  const saved = [{ kind: "monstera", x: 0.2, y: 0.8 }];
  let posts = 0,
    downloads = 0;
  return withPage(
    async (p) => {
      assert.deepEqual(
        (await (await p.request.get(baseURL + "/settings")).json()).furniture,
        saved,
      );
      await p.click("#settingsbtn");
      assert.equal(await p.locator('[data-kind="stool"]').isDisabled(), false);
      await p.locator('[data-kind="stool"]').click();
      await p.waitForTimeout(160);
      const point = await p.evaluate(() => {
        const s = officeScene,
          r = s.canvas.getBoundingClientRect();
        for (let y = 30; y < s.grid.h - 10; y += 4)
          for (let x = 15; x < s.grid.w - 15; x += 4) {
            if (
              [-4, 0, 4].every((dx) =>
                [-4, 0, 4].every(
                  (dy) => s.placement({ x: x + dx, y: y + dy })?.valid,
                ),
              )
            )
              return {
                x: r.x + s.transform.ox + x * s.transform.scale,
                y: r.y + s.transform.oy + y * s.transform.scale,
              };
          }
        return null;
      });
      assert.ok(point);
      await p.mouse.click(point.x, point.y);
      await p.waitForFunction(() => pendingSaves === 0);
      assert.equal(posts, 1);
      const after = (await (await p.request.get(baseURL + "/settings")).json())
        .furniture;
      assert.equal(after.length, 2);
      assert.deepEqual(after[0], saved[0]);
      assert.equal(after[1].kind, "stool");
    },
    {
      initialSettings: { furniture: saved },
      beforeReady: async (p) => {
        p.on("request", (request) => {
          if (
            request.url().endsWith("/settings") &&
            request.method() === "POST"
          )
            posts++;
        });
        p.on("download", () => downloads++);
        await p.click("#settingsbtn");
        for (const id of [
          '[data-kind="arcade"]',
          '[data-kind="focusbooth"]',
          '[data-kind="filingcabinet"]',
          '[data-kind="stool"]',
          "#edit-furniture",
          "#clear-furniture",
          "#import-settings",
          "#export-settings",
        ])
          assert.equal(
            await p.locator(id).isDisabled(),
            true,
            id + " waits for saved settings",
          );
        assert.match(
          await p.locator('[data-kind="focusbooth"]').textContent(),
          /loading/i,
        );
        await p.locator('[data-kind="stool"]').click({ force: true });
        await p.locator("#edit-furniture").click({ force: true });
        await p.locator("#clear-furniture").click({ force: true });
        await p.locator("#export-settings").click({ force: true });
        await p.evaluate(() =>
          document.querySelector("#export-settings").onclick(),
        );
        assert.equal(await p.evaluate(() => officeScene.edit), null);
        // File selection dispatches change even if its control is disabled: the handler also needs a guard.
        await p.locator("#import-settings").setInputFiles({
          name: "early-layout.json",
          mimeType: "application/json",
          buffer: Buffer.from(
            JSON.stringify({
              version: 1,
              settings: { furniture: [{ kind: "sofa", x: 0.5, y: 0.5 }] },
            }),
          ),
        });
        await closeAll(p);
        const c = await p.locator("#c").boundingBox();
        await p.mouse.click(c.x + c.width / 2, c.y + c.height / 2);
        assert.equal(posts, 0);
        assert.equal(downloads, 0);
        assert.equal(await p.evaluate(() => pendingSaves), 0);
        assert.equal(await p.evaluate(() => furnitureHistory.length), 0);
        assert.deepEqual(
          (await (await p.request.get(baseURL + "/settings")).json()).furniture,
          saved,
        );
      },
    },
  );
});

test("pre-ready pet-name save preserves both stored names and its retry keeps the untouched name", () => {
  const names = { cat1: "Saved orange", cat2: "Saved black" };
  let posts = 0;
  return withPage(
    async (p) => {
      assert.equal(await p.inputValue("#pet-cat1-name"), "Draft orange");
      assert.equal(await p.inputValue("#pet-cat2-name"), "Saved black");
      await p.locator('#pet-name-form button[type="submit"]').click();
      await p.waitForFunction(() => pendingSaves === 0);
      assert.equal(posts, 1);
      assert.deepEqual(
        (await (await p.request.get(baseURL + "/settings")).json()).pet_names,
        { cat1: "Draft orange", cat2: "Saved black" },
      );
    },
    {
      initialSettings: { pet_names: names },
      beforeReady: async (p) => {
        p.on("request", (request) => {
          if (
            request.url().endsWith("/settings") &&
            request.method() === "POST"
          )
            posts++;
        });
        await p.click("#settingsbtn");
        assert.equal(await p.locator("#pet-cat1-name").isDisabled(), true);
        assert.equal(
          await p.locator('#pet-name-form button[type="submit"]').isDisabled(),
          true,
        );
        await p
          .locator('#pet-name-form button[type="submit"]')
          .click({ force: true });
        // An integration can still dispatch a form submission; the central writer must reject it before any optimism or queue mutation.
        await p.locator("#pet-cat1-name").evaluate((input) => {
          input.value = "Draft orange";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.form.requestSubmit();
        });
        assert.equal(posts, 0);
        assert.equal(await p.evaluate(() => pendingSaves), 0);
        assert.equal(await p.evaluate(() => settingsRevision), 0);
        assert.equal(await p.evaluate(() => queuedSettings.length), 0);
        assert.match(
          await p.textContent("#toast"),
          /loading.*settings|settings.*load/i,
        );
        assert.deepEqual(
          (await (await p.request.get(baseURL + "/settings")).json()).pet_names,
          names,
        );
      },
    },
  );
});

test("first hydration fills a focused untouched pet-name field before a full-map save", () =>
  withPage(
    async (p) => {
      assert.equal(await p.inputValue("#pet-cat2-name"), "Saved black");
      await p.locator('#pet-name-form button[type="submit"]').click();
      await p.waitForFunction(() => pendingSaves === 0);
      assert.deepEqual(
        (await (await p.request.get(baseURL + "/settings")).json()).pet_names,
        { cat1: "Saved orange", cat2: "Saved black" },
      );
    },
    {
      initialSettings: {
        pet_names: { cat1: "Saved orange", cat2: "Saved black" },
      },
      beforeReady: async (p) => {
        await p.click("#settingsbtn");
        assert.equal(await p.locator("#pet-cat2-name").isDisabled(), true);
        await p.locator("#pet-cat2-name").focus();
        assert.notEqual(
          await p.evaluate(() => document.activeElement.id),
          "pet-cat2-name",
        );
        assert.equal(await p.inputValue("#pet-cat2-name"), "");
      },
    },
  ));

test("failed initial state keeps editing blocked until a successful retry", () =>
  withPage(
    async (p) => {
      assert.equal(await p.evaluate(() => settingsReady), true);
      assert.equal(await p.locator("#pet-cat1-name").isDisabled(), false);
      assert.equal(await p.locator('[data-kind="stool"]').isDisabled(), false);
      assert.equal(
        await p.locator('[data-kind="focusbooth"]').isDisabled(),
        true,
        "readiness does not override reward gates",
      );
      assert.equal(
        await p.locator("#settings-loading-status").isVisible(),
        false,
      );
    },
    {
      failFirstState: true,
      beforeReady: async (p) => {
        await p.waitForFunction(() =>
          document.body.classList.contains("offline"),
        );
        await p.click("#settingsbtn");
        assert.equal(await p.evaluate(() => settingsReady), false);
        assert.equal(await p.locator("#pet-cat1-name").isDisabled(), true);
        assert.equal(await p.locator('[data-kind="stool"]').isDisabled(), true);
        assert.equal(
          await p.locator("#settings-loading-status").isVisible(),
          true,
        );
        await closeAll(p);
        assert.equal(await p.evaluate(() => opened), null);
        await p.click("#helpbtn");
        await closeAll(p);
        await p.click("#settingsbtn");
      },
    },
  ));

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 320, height: 900 },
])
  test(`notices preserve native canvas position and fit at ${viewport.width}px, including panel handoff`, () =>
    withPage(
      async (p) => {
        const geometry = () =>
          p.evaluate(() => {
            const c = officeScene.canvas,
              r = c.getBoundingClientRect();
            return {
              x: r.x,
              y: r.y,
              width: r.width,
              height: r.height,
              pixelWidth: c.width,
              pixelHeight: c.height,
              scale: officeScene.transform.scale,
            };
          });
        await p.waitForTimeout(100);
        const before = await geometry();
        await p.evaluate(() => {
          toast("First office notice");
          toast("Second office notice");
          toast("Third office notice");
        });
        await p.waitForTimeout(250);
        assert.deepEqual(
          await geometry(),
          before,
          "visible notices never move or rescale the canvas",
        );
        await p.click("#settingsbtn");
        await closeAll(p);
        await p.waitForTimeout(250);
        assert.deepEqual(
          await geometry(),
          before,
          "moving notices out of a panel preserves click coordinates",
        );
        assert.equal(
          await p.evaluate(() => {
            const notices = document
              .querySelector("#notice-slot")
              .getBoundingClientRect();
            return [
              ...document.querySelectorAll(".scene-controls button"),
            ].some((button) => {
              const rect = button.getBoundingClientRect();
              return (
                notices.left < rect.right &&
                notices.right > rect.left &&
                notices.top < rect.bottom &&
                notices.bottom > rect.top
              );
            });
          }),
          false,
          "notice overlay does not cover camera controls",
        );
        assert.equal(
          await p.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
      },
      { viewport },
    ));
