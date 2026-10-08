const { fetchSettings } = require("./settings-helper.cjs");
/* Real observer, pointer/keyboard interaction, and native Web Audio measurements. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const baseURL = "http://127.0.0.1:18121";
const screenshots =
  process.env.OFFICE_ROOM_SCREENSHOTS ||
  path.join(root, "reports/room-interactions");
let home,
  log,
  server,
  serverOutput = "";
const record = (event, extra = {}) => ({
  event,
  platform: "claude",
  session_id: "room-main",
  ts: Date.now() / 1000,
  ...extra,
});
function publish(events) {
  fs.appendFileSync(log, events.map(JSON.stringify).join("\n") + "\n");
}
before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "office-room-"));
  fs.mkdirSync(path.join(home, "pixel-office"));
  log = path.join(home, "pixel-office/events.jsonl");
  fs.writeFileSync(log, "");
  publish([
    record("session_start", { title: "Room audit" }),
    record("usage", {
      usage_id: "known-usage",
      input_tokens: 256,
      output_tokens: 64,
      total_tokens: 320,
    }),
  ]);
  server = spawn(
    process.env.PYTHON || "python",
    ["run.py", "--port", "18121"],
    {
      cwd: root,
      env: { ...process.env, HERMES_HOME: home, AGENT_OFFICE_DEMO: "1" },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  server.stderr.on("data", (chunk) => {
    serverOutput = (serverOutput + chunk.toString()).slice(-3000);
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(baseURL + "/state")).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Room test observer did not start: " + serverOutput);
});
after(async () => {
  if (server) {
    const closed = new Promise((resolve) => server.once("exit", resolve));
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
    await fetchSettings(baseURL + "/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sound: false,
        music_track: "window-seat",
        music_volume: 0.12,
      }),
    });
    const p = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      ...options,
    });
    p.setDefaultTimeout(10000);
    const errors = [];
    p.on("pageerror", (error) => errors.push(error.stack || error.message));
    await p.addInitScript(() => {
      // Observe the real graph. A zero-gain side branch lets AnalyserNode read
      // the master output without changing the audible path or replacing audio.
      window.__audioMeters = [];
      window.__audioOscillators = [];
      const connect = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (destination, ...args) {
        const result = connect.call(this, destination, ...args);
        if (
          this instanceof GainNode &&
          destination instanceof AudioDestinationNode
        ) {
          const context = this.context,
            analyser = context.createAnalyser(),
            silent = context.createGain();
          analyser.fftSize = 2048;
          silent.gain.value = 0;
          connect.call(this, analyser);
          connect.call(analyser, silent);
          connect.call(silent, destination);
          window.__audioMeters.push({ context, analyser, master: this });
        }
        return result;
      };
      const create = BaseAudioContext.prototype.createOscillator;
      BaseAudioContext.prototype.createOscillator = function () {
        const oscillator = create.call(this);
        window.__audioOscillators.push(oscillator);
        return oscillator;
      };
      window.__measureMusic = () => {
        const meter = window.__audioMeters.at(-1);
        if (!meter) return { state: "absent", rms: 0 };
        const samples = new Float32Array(meter.analyser.fftSize);
        meter.analyser.getFloatTimeDomainData(samples);
        return {
          state: meter.context.state,
          native: meter.context instanceof AudioContext,
          rms: Math.sqrt(
            samples.reduce((sum, value) => sum + value * value, 0) /
              samples.length,
          ),
          gain: meter.master.gain.value,
          frequencies: window.__audioOscillators
            .filter((node) => node.context === meter.context)
            .map((node) => node.frequency.value),
        };
      };
    });
    await p.goto(baseURL);
    await p.waitForFunction(
      () => initialized && officeScene.loadedAssets >= 17,
    );
    try {
      await run(p);
    } catch (error) {
      error.message +=
        "\nBrowser diagnostics: " +
        JSON.stringify(
          await p.evaluate(() => ({
            music: window.officeJukebox?.snapshot(),
            measured: window.__measureMusic?.(),
            sound: settings.sound,
            pendingSaves,
            status: document.querySelector("#jukebox-status")?.textContent,
            opened,
            furniture: settings.furniture,
            editMode: officeScene.editMode,
            editKind: officeScene.editKind(),
            pointer: officeScene.pointer,
            placement:
              officeScene.pointer && officeScene.placement(officeScene.pointer),
            toast: document.querySelector("#toast")?.textContent,
          })),
        ) +
        "\nPage errors: " +
        JSON.stringify(errors);
      throw new Error(error.message, { cause: error });
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}
async function closePanels(p) {
  const panel = p.locator(".sheet:not([hidden])");
  if (await panel.count())
    await panel
      .getByRole("button", { name: "Close panel", exact: true })
      .click();
  assert.equal(await p.evaluate(() => opened), null);
  assert.equal(await panel.count(), 0, "no active modal remains");
  assert.equal(await p.isVisible("#backdrop"), false);
  assert.equal(await p.locator("#wrap").evaluate((el) => el.inert), false);
}
async function roomAction(p, name) {
  await closePanels(p);
  await p.click("#settingsbtn");
  const button = p
    .locator("#room-actions")
    .getByRole("button", { name, exact: true });
  await button.focus();
  await p.keyboard.press("Enter");
}
async function screenshot(p, name) {
  fs.mkdirSync(screenshots, { recursive: true });
  await p.screenshot({
    path: path.join(screenshots, name + ".png"),
    fullPage: true,
  });
}
async function propPoint(p, kind) {
  await p.waitForFunction(
    (kind) => officeScene.propHits.some((hit) => hit.kind === kind),
    kind,
  );
  return p.evaluate((kind) => {
    const hit = officeScene.propHits.findLast((hit) => hit.kind === kind),
      t = officeScene.transform,
      rect = document.querySelector("#c").getBoundingClientRect();
    return {
      x: rect.left + t.ox + (hit.x + hit.w / 2) * t.scale,
      y: rect.top + t.oy + (hit.y + hit.h / 2) * t.scale,
    };
  }, kind);
}
async function clickProp(p, kind) {
  await closePanels(p);
  const point = await propPoint(p, kind);
  await p.mouse.click(point.x, point.y);
}
async function place(p, kind) {
  await closePanels(p);
  const before = await p.evaluate(() => settings.furniture.length);
  await p.click("#settingsbtn");
  await p.click(`#furniture-tools [data-kind="${kind}"]`);
  const point = await p.evaluate(() => {
    const s = officeScene,
      rect = document.querySelector("#c").getBoundingClientRect(),
      t = s.transform;
    for (let y = 70; y < s.grid.h - 20; y += 6)
      for (let x = 18; x < s.grid.w - 18; x += 6) {
        // Use an interior point, not a mathematically exact collision edge
        // that becomes occupied after screen-coordinate rounding.
        if (
          [-1, 0, 1].every((dx) =>
            [-1, 0, 1].every(
              (dy) => s.placement({ x: x + dx, y: y + dy })?.valid,
            ),
          )
        ) {
          const point = {
            x: rect.left + t.ox + x * t.scale,
            y: rect.top + t.oy + y * t.scale,
          };
          if (document.elementFromPoint(point.x, point.y)?.id === "c")
            return point;
        }
      }
    return null;
  });
  assert.ok(point, "free floor exists for " + kind);
  await p.mouse.click(point.x, point.y);
  await p.waitForFunction(
    (length) => pendingSaves === 0 && settings.furniture.length === length,
    before + 1,
  );
  await p.click("#finish-furniture");
}
test("three tracks produce a measured native audio signal and stop without autoplay", () =>
  withPage(async (p) => {
    assert.equal(await p.evaluate(() => __audioMeters.length), 0);
    await roomAction(p, "Jukebox");
    assert.equal(await p.locator("#jukebox-tracks option").count(), 3);
    assert.equal(
      await p.evaluate(() => officeJukebox.snapshot().playing),
      false,
    );
    const measurements = [];
    for (const id of ["window-seat", "night-shift", "rainy-break"]) {
      await p.selectOption("#jukebox-tracks", id);
      await p.waitForFunction(() => pendingSaves === 0);
      await p.click("#jukebox-play");
      await p.waitForFunction(
        () =>
          __measureMusic().state === "running" && __measureMusic().rms > 0.0001,
      );
      const audio = await p.evaluate(() => __measureMusic());
      assert.equal(audio.native, true);
      assert.ok(audio.frequencies.length >= 2);
      measurements.push({ track: id, ...audio });
      assert.equal(
        await p.evaluate(() => officeJukebox.snapshot().trackId),
        id,
      );
      await p.click("#jukebox-play");
      await p.waitForFunction(() =>
        __audioMeters.every((meter) => meter.context.state === "closed"),
      );
      assert.equal(
        await p.evaluate(() => officeJukebox.snapshot().activeVoices),
        0,
      );
    }
    fs.mkdirSync(screenshots, { recursive: true });
    fs.writeFileSync(
      path.join(screenshots, "audio-measurements.json"),
      JSON.stringify(measurements, null, 2) + "\n",
    );
    await p.reload();
    await p.waitForFunction(() => initialized);
    await roomAction(p, "Jukebox");
    assert.equal(await p.evaluate(() => __audioMeters.length), 0);
    assert.equal(
      await p.evaluate(() => officeJukebox.snapshot().playing),
      false,
    );
    assert.equal(await p.inputValue("#jukebox-tracks"), "rainy-break");
  }));
test("volume preview survives live polling and saved volume survives reload", () =>
  withPage(async (p) => {
    await roomAction(p, "Jukebox");
    await p.click("#jukebox-play");
    await p.waitForFunction(
      () => officeJukebox.snapshot().playing && pendingSaves === 0,
    );
    await p.focus("#jukebox-volume");
    await p.locator("#jukebox-volume").evaluate((input) => {
      input.value = "31";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await p.waitForTimeout(1700);
    assert.equal(await p.textContent("#jukebox-volume-label"), "31%");
    assert.equal(await p.evaluate(() => officeJukebox.snapshot().volume), 0.31);
    await p.locator("#jukebox-volume").dispatchEvent("change");
    await p.waitForFunction(() => pendingSaves === 0);
    await p.reload();
    await p.waitForFunction(() => initialized);
    await roomAction(p, "Jukebox");
    assert.equal(await p.inputValue("#jukebox-volume"), "31");
    assert.equal(await p.textContent("#jukebox-volume-label"), "31%");
    assert.equal(await p.evaluate(() => __audioMeters.length), 0);
  }));
test("failed track and volume saves restore truthful controls and allow retry", () =>
  withPage(async (p) => {
    await roomAction(p, "Jukebox");
    await p.route("**/settings", (route) =>
      route.fulfill({ status: 503, body: "unavailable" }),
    );
    await p.selectOption("#jukebox-tracks", "night-shift");
    await p.waitForFunction(() => pendingSaves === 0);
    assert.equal(await p.inputValue("#jukebox-tracks"), "window-seat");
    assert.match(await p.textContent("#jukebox-status"), /not saved/);
    await p.locator("#jukebox-volume").evaluate((input) => {
      input.focus();
      input.value = "28";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await p.waitForFunction(() => pendingSaves === 0);
    assert.equal(await p.inputValue("#jukebox-volume"), "12");
    assert.equal(await p.textContent("#jukebox-volume-label"), "12%");
    await p.unroute("**/settings");
    await p.selectOption("#jukebox-tracks", "night-shift");
    await p.waitForFunction(() => pendingSaves === 0);
    await p.click("#jukebox-play");
    await p.waitForFunction(() => __measureMusic().rms > 0.0001);
    assert.equal(
      await p.evaluate(() => officeJukebox.snapshot().trackId),
      "night-shift",
    );
  }));
test("a rejected sound save closes audible playback and reports the failure", () =>
  withPage(async (p) => {
    await roomAction(p, "Jukebox");
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    await p.route("**/settings", async (route) => {
      await held;
      await route.fulfill({ status: 503, body: "unavailable" });
    });
    try {
      await p.click("#jukebox-play");
      await p.waitForFunction(() => __measureMusic().rms > 0.0001);
      assert.equal(await p.evaluate(() => pendingSaves), 1);
      release();
      await p.waitForFunction(
        () => pendingSaves === 0 && !officeJukebox.snapshot().playing,
      );
      await p.waitForFunction(() =>
        __audioMeters.every((meter) => meter.context.state === "closed"),
      );
      assert.match(
        await p.textContent("#jukebox-status"),
        /Sound preference was not saved/,
      );
      assert.equal(await p.evaluate(() => settings.sound), false);
      assert.equal(
        await p.evaluate(() => officeJukebox.snapshot().activeVoices),
        0,
      );
      await p.waitForTimeout(1700);
      assert.match(await p.textContent("#jukebox-status"), /not saved/);
      assert.equal(
        await p.evaluate(() => officeJukebox.snapshot().playing),
        false,
      );
    } finally {
      release();
    }
  }));
test("a failed earlier volume save preserves a newer queued edit", () =>
  withPage(async (p) => {
    await roomAction(p, "Jukebox");
    let release,
      requests = 0;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    await p.route("**/settings", async (route) => {
      if (++requests === 1) {
        await held;
        await route.fulfill({ status: 503, body: "unavailable" });
      } else await route.continue();
    });
    const setVolume = (value) =>
      p.locator("#jukebox-volume").evaluate((input, value) => {
        input.focus();
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, value);
    try {
      await setVolume("20");
      await p.waitForFunction(() => pendingSaves === 1);
      await setVolume("36");
      await p.waitForFunction(() => pendingSaves === 2);
      release();
      await p.waitForFunction(() => pendingSaves === 0);
      assert.equal(await p.inputValue("#jukebox-volume"), "36");
      assert.equal(await p.textContent("#jukebox-volume-label"), "36%");
      assert.equal(
        await p.evaluate(() => officeJukebox.snapshot().volume),
        0.36,
      );
      const state = await (await p.request.get(baseURL + "/state")).json();
      assert.equal(state.settings.music_volume, 0.36);
      assert.doesNotMatch(await p.textContent("#jukebox-status"), /not saved/);
    } finally {
      release();
    }
  }));
test("a failed track selection stops playback started while that save was pending", () =>
  withPage(async (p) => {
    await roomAction(p, "Jukebox");
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    await p.route("**/settings", async (route) => {
      if (route.request().postDataJSON().music_track) {
        await held;
        await route.fulfill({ status: 503, body: "unavailable" });
      } else await route.continue();
    });
    try {
      await p.selectOption("#jukebox-tracks", "night-shift");
      await p.click("#jukebox-play");
      await p.waitForFunction(() => __measureMusic().rms > 0.0001);
      release();
      await p.waitForFunction(() => pendingSaves === 0);
      assert.equal(await p.inputValue("#jukebox-tracks"), "window-seat");
      assert.equal(
        await p.evaluate(() => officeJukebox.snapshot().playing),
        false,
      );
      assert.match(
        await p.textContent("#jukebox-status"),
        /Track was not saved/,
      );
      await p.waitForFunction(() =>
        __audioMeters.every((meter) => meter.context.state === "closed"),
      );
    } finally {
      release();
    }
  }));
test("header mute, page visibility and pagehide release actual audio contexts", () =>
  withPage(async (p) => {
    await roomAction(p, "Jukebox");
    await p.click("#jukebox-play");
    await p.waitForFunction(() => __measureMusic().rms > 0.0001);
    await closePanels(p);
    await p.click("#sound");
    await p.waitForFunction(
      () =>
        !officeJukebox.snapshot().playing &&
        __audioMeters.every((meter) => meter.context.state === "closed"),
    );
    await roomAction(p, "Jukebox");
    await p.click("#jukebox-play");
    await p.waitForFunction(() => __measureMusic().rms > 0.0001);
    await p.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await p.waitForFunction(() =>
      __audioMeters.every((meter) => meter.context.state === "closed"),
    );
    await p.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await p.waitForTimeout(300);
    assert.equal(
      await p.evaluate(() => officeJukebox.snapshot().playing),
      false,
    );
    await p.click("#jukebox-play");
    await p.waitForFunction(() => __measureMusic().rms > 0.0001);
    await p.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await p.waitForFunction(() =>
      __audioMeters.every((meter) => meter.context.state === "closed"),
    );
    assert.equal(
      await p.evaluate(() => officeJukebox.snapshot().activeVoices),
      0,
    );
  }));
test("canvas props open usage, tasks, history and the jukebox", () =>
  withPage(async (p) => {
    await clickProp(p, "server");
    assert.equal(await p.isVisible("#sheet-floor"), true);
    assert.match(await p.textContent("#usagebox"), /320/);
    for (const [kind, panel] of [
      ["whiteboard", "sheet-tasks"],
      ["printer", "sheet-events"],
      ["jukebox", "sheet-jukebox"],
    ]) {
      await place(p, kind);
      await clickProp(p, kind);
      assert.equal(await p.isVisible("#" + panel), true);
    }
    await p.click("#jukebox-play");
    await p.waitForFunction(() => __measureMusic().rms > 0.0001);
    await screenshot(p, "jukebox-playing");
    await closePanels(p);
    await screenshot(p, "office-interactions");
  }));
test("four reward props unlock from recorded sessions, tools and subagent work", () =>
  withPage(async (p) => {
    await p.click("#settingsbtn");
    for (const kind of ["arcade", "recordplayer", "robot", "terrarium"])
      assert.equal(await p.isDisabled(`[data-kind="${kind}"]`), true);
    await p.evaluate(() => {
      window.__roomToastBatches = [];
      window.__roomToastObserver = new MutationObserver((changes) => {
        const messages = changes
          .flatMap((change) => [...change.addedNodes])
          .filter(
            (node) =>
              node.nodeType === Node.ELEMENT_NODE &&
              node.classList.contains("toast"),
          )
          .map((node) => node.textContent);
        if (messages.length) window.__roomToastBatches.push(messages);
      });
      window.__roomToastObserver.observe(document.querySelector("#toast"), {
        childList: true,
      });
    });
    const old = Date.now() / 1000 - 60;
    publish(
      Array.from({ length: 4 }, (_, i) => [
        record("session_start", { session_id: "finished-" + i, ts: old }),
        record("session_end", { session_id: "finished-" + i, ts: old + 1 }),
      ]).flat(),
    );
    await p.waitForFunction(
      () => !document.querySelector('[data-kind="recordplayer"]').disabled,
    );
    publish([
      record("subagent_start", {
        child_session_id: "room-helper",
        parent_session_id: "room-main",
        child_goal: "Check room interactions",
      }),
      record("subagent_stop", {
        child_session_id: "room-helper",
        status: "success",
      }),
    ]);
    await p.waitForFunction(
      () => !document.querySelector('[data-kind="robot"]').disabled,
    );
    publish(
      Array.from({ length: 25 }, (_, i) => [
        record("tool_start", { call_id: "read-" + i, tool_name: "Read" }),
        record("tool_end", {
          call_id: "read-" + i,
          tool_name: "Read",
          status: "success",
        }),
      ]).flat(),
    );
    await p.waitForFunction(
      () => !document.querySelector('[data-kind="terrarium"]').disabled,
    );
    assert.equal(await p.isDisabled('[data-kind="arcade"]'), true);
    publish(
      Array.from({ length: 75 }, (_, i) => [
        record("tool_start", { call_id: "run-" + i, tool_name: "Bash" }),
        record("tool_end", {
          call_id: "run-" + i,
          tool_name: "Bash",
          status: "success",
        }),
      ]).flat(),
    );
    await p.waitForFunction(
      () => !document.querySelector('[data-kind="arcade"]').disabled,
    );
    const notices = await p.evaluate(() => {
      window.__roomToastObserver.disconnect();
      return {
        batches: window.__roomToastBatches,
        visible: document.querySelector("#toast").children.length,
      };
    });
    assert.ok(
      notices.batches.some((batch) =>
        batch.some((text) => /achievements? earned/i.test(text)),
      ),
    );
    assert.ok(
      notices.batches.every(
        (batch) =>
          batch.filter((text) => /achievements? earned/i.test(text)).length <=
          1,
      ),
      "one grouped achievement notice per poll",
    );
    assert.ok(
      notices.visible <= 3,
      "transient notices stay bounded after the activity burst",
    );
    for (const kind of ["arcade", "recordplayer", "robot", "terrarium"])
      await place(p, kind);
    const state = await (await p.request.get(baseURL + "/state")).json();
    for (const cosmetic of [
      "arcade_glow",
      "vinyl_spin",
      "robot_wave",
      "terrarium_glow",
    ])
      assert.ok(state.progress.cosmetics.includes(cosmetic));
    await p.waitForFunction(
      () => document.querySelector("#toast").children.length === 0,
    );
    await screenshot(p, "reward-furniture");
  }));
test("named cats, feeding and music leave recorded work and usage unchanged", () =>
  withPage(async (p) => {
    const state = await (await p.request.get(baseURL + "/state")).json(),
      old = Date.now() / 1000 - 60;
    const needed = 100 - state.progress.stats.sessions;
    publish(
      Array.from({ length: needed }, (_, i) => [
        record("session_start", { session_id: "pet-unlock-" + i, ts: old }),
        record("session_end", { session_id: "pet-unlock-" + i, ts: old + 1 }),
      ]).flat(),
    );
    await p.waitForFunction(() => officeScene.cosmetics.includes("gitcat"));
    await p.click("#settingsbtn");
    await p.fill("#pet-cat1-name", "Maple");
    await p.fill("#pet-cat2-name", "Mochi");
    await p.locator('#pet-name-form button[type="submit"]').click();
    await p.waitForFunction(() => pendingSaves === 0);
    const beforeState = await (await p.request.get(baseURL + "/state")).json();
    await roomAction(p, "Pet the orange cat");
    assert.match(await p.textContent("#toast"), /Maple purrs/);
    await roomAction(p, "Pet the black cat");
    assert.match(await p.textContent("#toast"), /Mochi purrs/);
    await closePanels(p);
    const point = await p.evaluate(() => {
      const pet = officeScene.petHits.find((pet) => pet.key === "blackcat"),
        t = officeScene.transform,
        rect = document.querySelector("#c").getBoundingClientRect();
      return {
        x: rect.left + t.ox + (pet.x + pet.w / 2) * t.scale,
        y: rect.top + t.oy + (pet.y + pet.h / 2) * t.scale,
      };
    });
    await p.mouse.click(point.x, point.y);
    assert.match(await p.textContent("#toast"), /Mochi purrs/);
    await roomAction(p, "Aquarium");
    await p.click("#aquarium-feed");
    await roomAction(p, "Jukebox");
    await p.click("#jukebox-play");
    await p.waitForFunction(() => __measureMusic().rms > 0.0001);
    const afterState = await (await p.request.get(baseURL + "/state")).json();
    assert.equal(afterState.progress.xp, beforeState.progress.xp);
    assert.deepEqual(afterState.progress.stats, beforeState.progress.stats);
    assert.deepEqual(afterState.usage, beforeState.usage);
    assert.equal(afterState.tracking.received, beforeState.tracking.received);
  }));
test("an old unresolved tool observation opens a truthful quiet-agent inspector", () =>
  withPage(async (p) => {
    const old = Date.now() / 1000 - 301;
    publish([
      record("session_start", {
        session_id: "quiet-room",
        title: "Long-running build",
        ts: old - 10,
      }),
      record("tool_start", {
        session_id: "quiet-room",
        call_id: "quiet-build",
        tool_name: "Bash",
        ts: old,
      }),
    ]);
    await p.waitForFunction(() =>
      agents.some((agent) => agent.id === "quiet-room" && agent.quiet),
    );
    assert.equal(await p.textContent("#health-alert"), "Check quiet agent");
    await p.focus("#health-alert");
    await p.keyboard.press("Enter");
    assert.equal(await p.isVisible("#sheet-inspector"), true);
    assert.match(
      await p.textContent("#inspector-summary"),
      /No new observation/,
    );
    assert.match(
      await p.textContent("#inspector-summary"),
      /Last reported working · Bash/,
    );
    assert.match(
      await p.textContent("#inspector-summary"),
      /silence does not prove/,
    );
    await screenshot(p, "quiet-agent-inspector");
    publish([
      record("tool_end", {
        session_id: "quiet-room",
        call_id: "quiet-build",
        tool_name: "Bash",
        status: "success",
      }),
    ]);
    await p.waitForFunction(() =>
      agents.some((agent) => agent.id === "quiet-room" && !agent.quiet),
    );
    await closePanels(p);
    assert.equal(await p.isVisible("#health-alert"), false);
  }));
test("jukebox and room action controls fit on a 320 pixel screen", () =>
  withPage(
    async (p) => {
      await roomAction(p, "Jukebox");
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      assert.equal(
        await p.evaluate(() => {
          const panel = document.querySelector("#sheet-jukebox");
          return panel.scrollWidth > panel.clientWidth;
        }),
        false,
      );
      await screenshot(p, "mobile-jukebox");
      await closePanels(p);
      await p.click("#settingsbtn");
      await p.locator("#room-actions").scrollIntoViewIfNeeded();
      assert.equal(
        await p.evaluate(() => {
          const panel = document.querySelector("#sheet-settings");
          return panel.scrollWidth > panel.clientWidth;
        }),
        false,
      );
      await screenshot(p, "mobile-room-actions");
    },
    { viewport: { width: 320, height: 760 }, isMobile: true, hasTouch: true },
  ));
