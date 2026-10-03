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
  let page;
  const errors = [];
  try {
    page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(baseURL);
    await page.waitForFunction(() =>
      document.querySelector("#count").textContent.includes("agent"),
    );
    await page.evaluate(() => document.fonts.ready);
    await fn(page);
    assert.deepEqual(errors, []);
  } catch (err) {
    const state = await page.evaluate(() => ({
      edit: officeScene.edit,
      pending: pendingSaves,
      toast: document.querySelector("#toast").textContent,
      furniture: settings.furniture,
      transform: officeScene.transform,
      size: [officeScene.canvas.clientWidth, officeScene.canvas.clientHeight],
      pointer: officeScene.pointer,
    }));
    err.stack += "\nBrowser state: " + JSON.stringify({ ...state, errors });
    throw err;
  } finally {
    await browser.close();
  }
}
test("connection guide explains each runtime and distinguishes demo from live tracking", () =>
  withPage(async (p) => {
    await p.click('[data-sheet="sheet-settings"]');
    await p.click('#sheet-settings [data-sheet="sheet-setup"]');
    for (const [runtime, text] of [
      ["hermes", "hermes plugins enable pixel-office"],
      ["telegram", "does not connect a bot"],
      ["opencode", "opencode.json"],
      ["claude", "settings.json"],
      ["vscode", "hermesPixelOffice.stateUrl"],
    ]) {
      await p.selectOption("#setup-runtime", runtime);
      assert.ok((await p.textContent("#setup-detail")).includes(text));
    }
    assert.match(await p.textContent("#setup-observed"), /synthetic/);
    assert.equal(
      await p.getAttribute(
        '#sheet-settings [data-sheet="sheet-setup"]',
        "aria-expanded",
      ),
      "true",
    );
    await p.evaluate(() => {
      window._state.mode = "live";
      agents = [{ id: "cli-live", platform: "cli", status: "working" }];
    });
    await p.selectOption("#setup-runtime", "hermes");
    assert.match(await p.textContent("#setup-observed"), /1 recorded/);
    await p.route("**/state", (route) => route.abort());
    await p.waitForTimeout(1700);
    assert.match(await p.textContent("#setup-observed"), /disconnected/);
    assert.equal(await p.inputValue("#setup-runtime"), "hermes");
    await p.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    if (process.env.OFFICE_SCREENSHOTS) {
      fs.mkdirSync(process.env.OFFICE_SCREENSHOTS, { recursive: true });
      await p.screenshot({
        path: path.join(process.env.OFFICE_SCREENSHOTS, "connection-guide.png"),
      });
    }
    await p.click("#setup-done");
    assert.equal(await p.isVisible("#sheet-setup"), false);
  }));
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
test("a delayed state response cannot undo a completed settings save", () =>
  withPage(async (p) => {
    await p.evaluate(() => saveSettings({ theme: "amber" }));
    const stale = await (await p.request.get(baseURL + "/state")).json();
    stale.reviewMarker = "stale settings response";
    let release, markHeld;
    const gate = new Promise((r) => (release = r));
    const held = new Promise((r) => (markHeld = r));
    await p.route("**/state", async (route) => {
      markHeld();
      await gate;
      await route.fulfill({ json: stale });
    });
    try {
      await held;
      await p.evaluate(() => saveSettings({ theme: "midnight" }));
      release();
      await p.waitForFunction(() => window._state.reviewMarker);
      assert.equal(
        await p.locator("html").getAttribute("data-theme"),
        "midnight",
      );
    } finally {
      release();
      await p.unroute("**/state");
    }
  }));
test("focused settings controls update their selected state without losing focus", () =>
  withPage(async (p) => {
    await p.evaluate(() => saveSettings({ theme: "default" }));
    await p.locator("#settingsbtn").click();
    const panel = p.locator("#settingsbox");
    const amber = panel.getByRole("button", { name: "Amber", exact: true });
    await amber.click();
    await p.waitForFunction(() => pendingSaves === 0);
    assert.equal(await amber.getAttribute("aria-pressed"), "true");
    assert.equal(
      await panel
        .getByRole("button", { name: "Plum", exact: true })
        .getAttribute("aria-pressed"),
      "false",
    );
    assert.equal(
      await amber.evaluate((b) => b === document.activeElement),
      true,
    );
    await p.waitForTimeout(1700);
    assert.equal(await amber.getAttribute("aria-pressed"), "true");
  }));
test("malformed event names do not interrupt polling or activity rendering", () =>
  withPage(async (p) => {
    await p.evaluate(() => {
      const state = structuredClone(window._state);
      state.events.push({ ts: Date.now() / 1000 });
      applyState(state);
    });
    assert.equal(await p.locator("#connection").innerText(), "Connected");
    assert.equal(await p.locator("#latest-event").innerText(), "event");
    await p.locator("#eventsbtn").click();
    assert.ok((await p.locator("#eventbox").innerText()).includes("event"));
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
      () => officeScene.loadedAssets === 14 && officeScene.sprites.monstera,
    );
    assert.deepEqual(await p.evaluate(() => officeScene.assetErrors), []);
    assert.equal(
      await p.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = 16;
        c.height = 32;
        const g = c.getContext("2d", { willReadFrequently: true });
        for (let n = 0; n < 6; n++)
          for (let row = 0; row < 3; row++)
            for (let col = 0; col < 7; col++) {
              g.clearRect(0, 0, 16, 32);
              g.drawImage(
                officeScene.sprites["char" + n],
                col * 16,
                row * 32,
                16,
                32,
                0,
                0,
                16,
                32,
              );
              if (
                !g
                  .getImageData(0, 0, 16, 32)
                  .data.some((v, i) => i % 4 === 3 && v > 0)
              )
                return false;
            }
        return true;
      }),
      true,
      "all 126 character frames contain visible pixels",
    );
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
      .filter({ hasText: "Server rack" })
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
test("all new furniture can be placed, retained, and removed through the canvas", () =>
  withPage(async (p) => {
    await p.evaluate(() =>
      saveSettings({
        theme: "default",
        decorations: false,
        furniture: [],
        max_chars: 4,
      }),
    );
    const kinds = [
      "sofa",
      "server",
      "shelf",
      "monstera",
      "coffee",
      "cooler",
      "lamp",
    ];
    for (const [i, kind] of kinds.entries()) {
      await p.locator("#settingsbtn").click();
      await p
        .locator("#furniture-tools")
        .locator(`[data-kind="${kind}"]`)
        .click();
      const point = await p.evaluate((i) => {
        const s = officeScene,
          b = s.canvas.getBoundingClientRect(),
          t = s.transform;
        return {
          x:
            b.left +
            t.ox +
            (i < 4 ? 60 + i * 65 : 205 + (i - 4) * 45) * t.scale,
          y: b.top + t.oy + (i < 4 ? s.grid.h - 12 : 170) * t.scale,
        };
      }, i);
      await p.mouse.click(point.x, point.y);
      await p.waitForFunction(
        (n) => settings.furniture.length === n && pendingSaves === 0,
        i + 1,
      );
      await p.keyboard.press("Escape");
    }
    await p.reload();
    await p.waitForFunction(
      () =>
        initialized &&
        officeScene.sprites.monstera &&
        settings.furniture.length === 7,
    );
    assert.deepEqual(
      await p.evaluate(() => settings.furniture.map((x) => x.kind)),
      kinds,
    );
    if (process.env.OFFICE_SCREENSHOTS) {
      fs.mkdirSync(process.env.OFFICE_SCREENSHOTS, { recursive: true });
      await p.screenshot({
        path: path.join(
          process.env.OFFICE_SCREENSHOTS,
          "furniture-placement.png",
        ),
      });
    }
    // Valid imported edge coordinates must be visible and removable after reflow.
    await p.evaluate(() =>
      saveSettings({ furniture: [{ kind: "sofa", x: 0, y: 0 }] }),
    );
    await p.setViewportSize({ width: 390, height: 844 });
    await p.waitForTimeout(200);
    await p.locator("#settingsbtn").click();
    await p
      .locator("#furniture-tools")
      .getByRole("button", { name: "Sofa", exact: true })
      .click();
    const point = await p.evaluate(() => {
      const s = officeScene,
        b = propBounds(settings.furniture[0], s.grid),
        r = s.canvas.getBoundingClientRect(),
        t = s.transform;
      return {
        x: r.left + t.ox + (b.x + b.w / 2) * t.scale,
        y: r.top + t.oy + (b.y + b.h / 2) * t.scale,
      };
    });
    await p.mouse.click(point.x, point.y);
    await p.waitForFunction(
      () => settings.furniture.length === 0 && pendingSaves === 0,
    );
    await p.keyboard.press("Escape");
    await p.evaluate(() => saveSettings({ decorations: true }));
  }));
test("every navigation panel opens, traps focus, and closes on desktop and mobile", () =>
  withPage(async (p) => {
    for (const width of [1440, 390]) {
      await p.setViewportSize({ width, height: 900 });
      for (const id of [
        "floorbtn",
        "tasksbtn",
        "eventsbtn",
        "achbtn",
        "settingsbtn",
        "helpbtn",
      ]) {
        const trigger = p.locator("#" + id);
        const panelId = await trigger.getAttribute("data-sheet");
        await trigger.click();
        const panel = p.locator("#" + panelId);
        assert.equal(await panel.isVisible(), true);
        assert.equal(await trigger.getAttribute("aria-expanded"), "true");
        await panel.getByRole("button", { name: "Close panel" }).focus();
        await p.keyboard.press("Shift+Tab");
        assert.equal(
          await panel.evaluate((s) => s.contains(document.activeElement)),
          true,
        );
        await p.keyboard.press("Tab");
        assert.equal(
          await panel
            .getByRole("button", { name: "Close panel" })
            .evaluate((b) => b === document.activeElement),
          true,
        );
        await p.keyboard.press("Escape");
        assert.equal(await panel.isVisible(), false);
        assert.equal(await trigger.getAttribute("aria-expanded"), "false");
        assert.equal(
          await trigger.evaluate((b) => b === document.activeElement),
          true,
        );
      }
    }
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
    await p.waitForFunction(() =>
      document.querySelector("#toast").textContent.includes("invalid"),
    );
    assert.equal(await p.evaluate(() => settings.theme), theme);
  }));
test("readable local fonts, decorative icons, labels, and catalog previews load", () =>
  withPage(async (p) => {
    const font = await p.request.get(
      baseURL + "/assets/fonts/geist-latin-variable.woff2",
    );
    assert.equal(font.status(), 200);
    assert.ok(font.headers()["content-type"].startsWith("font/woff2"));
    assert.ok(await p.evaluate(() => document.fonts.check('15px "Geist"')));
    assert.ok(
      await p.evaluate(
        () =>
          parseFloat(
            getComputedStyle(document.querySelector("#floorbtn")).fontSize,
          ) >= 14,
      ),
    );
    assert.equal(
      await p.locator("#toolbar svg:not([aria-hidden=true])").count(),
      0,
    );
    await p.waitForFunction(
      () => officeScene.sprites.clock && officeScene.labelBoxes.length === 6,
    );
    for (const width of [1440, 390, 320]) {
      await p.setViewportSize({ width, height: 900 });
      await p.waitForTimeout(200);
      const boxes = await p.evaluate(() => officeScene.labelBoxes);
      assert.equal(boxes.length, 6);
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i],
            b = boxes[j];
          assert.equal(
            a.x < b.x + b.w &&
              a.x + a.w > b.x &&
              a.y < b.y + b.h &&
              a.y + a.h > b.y,
            false,
          );
        }
    }
    await p.locator("#settingsbtn").click();
    assert.equal(await p.locator("#furniture-tools button").count(), 11);
    const populated = await p
      .locator("#furniture-tools canvas")
      .evaluateAll((cs) =>
        cs.every((c) =>
          c
            .getContext("2d")
            .getImageData(0, 0, c.width, c.height)
            .data.some((value, i) => i % 4 === 3 && value > 0),
        ),
      );
    assert.equal(populated, true);
  }));
test("crowded mobile labels leave approval alerts visible", () =>
  withPage(async (p) => {
    await p.setViewportSize({ width: 390, height: 900 });
    await p.waitForTimeout(100);
    for (const count of [8, 10]) {
      const layout = await p.evaluate((count) => {
        const previous = officeScene.agents;
        officeScene.agents = Array.from({ length: count }, (_, i) => ({
          ...previous[0],
          id: "crowded-" + i,
          label: "Review " + i,
          status: "waiting",
        }));
        officeScene.draw(0);
        const { ox, oy, scale } = officeScene.transform;
        const result = {
          labels: officeScene.labelBoxes,
          alerts: officeScene.grid.seats.map((s) => ({
            x: ox + (s.x + 17) * scale,
            y: oy + (s.y - 28) * scale,
            w: 10 * scale,
            h: 11 * scale,
          })),
        };
        officeScene.agents = previous;
        return result;
      }, count);
      assert.equal(layout.labels.length, count);
      for (const a of layout.labels)
        for (const b of layout.alerts)
          assert.equal(
            a.x < b.x + b.w &&
              a.x + a.w > b.x &&
              a.y < b.y + b.h &&
              a.y + a.h > b.y,
            false,
          );
    }
  }));
test("furniture supports keyboard placement, collision feedback, undo and Done", () =>
  withPage(async (p) => {
    await p.evaluate(() => saveSettings({ furniture: [], decorations: false }));
    await p.locator("#settingsbtn").click();
    await p.locator('#furniture-tools [data-kind="coffee"]').click();
    const blocked = await p.evaluate(() => {
      const b = officeScene.hitBoxes[0],
        { scale, ox, oy } = officeScene.transform,
        rect = officeScene.canvas.getBoundingClientRect();
      return {
        x: rect.left + ox + (b.x + b.w / 2) * scale,
        y: rect.top + oy + (b.y + b.h / 2) * scale,
      };
    });
    await p.mouse.click(blocked.x, blocked.y);
    assert.equal(await p.evaluate(() => settings.furniture.length), 0);
    assert.match(await p.locator("#toast").innerText(), /free floor/i);
    await p.evaluate(() => {
      officeScene.pointer = null;
    });
    await p.locator("#c").press("ArrowRight");
    assert.equal(
      await p.evaluate(() => officeScene.placement(officeScene.pointer).valid),
      true,
    );
    await p.locator("#c").press("Enter");
    await p.waitForFunction(
      () => settings.furniture.length === 1 && pendingSaves === 0,
    );
    await p.locator("#undo-furniture").click();
    await p.waitForFunction(
      () => settings.furniture.length === 0 && pendingSaves === 0,
    );
    assert.equal(await p.locator("#undo-furniture").isDisabled(), true);
    await p.locator("#finish-furniture").click();
    assert.equal(await p.locator("#edit-hint").isVisible(), false);
    assert.equal(await p.evaluate(() => officeScene.edit), null);
    await p.evaluate(() => saveSettings({ decorations: true }));
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
test("move props by mouse and keyboard, undo/redo, cancel, remove and reload", () =>
  withPage(async (p) => {
    await p.evaluate(() =>
      saveSettings({
        furniture: [{ kind: "cooler", x: 0.5, y: 0.95 }],
        decorations: false,
      }),
    );
    await p.locator("#settingsbtn").click();
    await p.locator("#edit-furniture").click();
    await p.locator("#c").press("Space");
    assert.equal(await p.evaluate(() => officeScene.movingIndex), 0);
    const original = await p.evaluate(() =>
      structuredClone(settings.furniture),
    );
    await p.locator("#c").press("ArrowRight");
    await p.locator("#c").press("Enter");
    await p.waitForFunction(() => pendingSaves === 0);
    const keyboard = await p.evaluate(() =>
      structuredClone(settings.furniture),
    );
    assert.equal(keyboard.length, 1);
    assert.ok(keyboard[0].x > original[0].x);
    await p.locator("#undo-furniture").click();
    await p.waitForFunction(() => pendingSaves === 0);
    assert.deepEqual(await p.evaluate(() => settings.furniture), original);
    await p.locator("#redo-furniture").click();
    await p.waitForFunction(() => pendingSaves === 0);
    assert.deepEqual(await p.evaluate(() => settings.furniture), keyboard);
    const point = await p.evaluate(() => {
      const b = propBounds(settings.furniture[0], officeScene.grid),
        { ox, oy, scale } = officeScene.transform,
        rect = officeScene.canvas.getBoundingClientRect();
      return {
        x: rect.left + ox + (b.x + b.w / 2) * scale,
        y: rect.top + oy + (b.y + b.h / 2) * scale,
      };
    });
    await p.mouse.move(point.x, point.y);
    await p.mouse.down();
    await p.mouse.move(point.x + 28, point.y, { steps: 4 });
    const expected = await p.evaluate(() => ({ ...officeScene.pointer }));
    await p.locator("#c").dispatchEvent("pointermove", {
      pointerId: 99,
      isPrimary: false,
      clientX: point.x + 100,
      clientY: point.y - 50,
    });
    await p
      .locator("#c")
      .dispatchEvent("pointercancel", { pointerId: 99, isPrimary: false });
    assert.deepEqual(await p.evaluate(() => officeScene.pointer), expected);
    assert.ok(await p.evaluate(() => !!officeScene.drag));
    await p.mouse.up();
    await p.waitForFunction(() => pendingSaves === 0);
    const dragged = await p.evaluate(() => structuredClone(settings.furniture));
    assert.ok(dragged[0].x > keyboard[0].x);
    await p.mouse.move(point.x + 28, point.y);
    await p.mouse.down();
    await p.mouse.move(point.x + 42, point.y - 10, { steps: 3 });
    await p.locator("#c").dispatchEvent("pointercancel", {
      pointerId: await p.evaluate(() => officeScene.drag.id),
      isPrimary: true,
    });
    await p.mouse.up();
    assert.deepEqual(await p.evaluate(() => settings.furniture), dragged);
    await p.keyboard.press("Escape");
    await p.reload();
    await p.waitForFunction(() => initialized);
    assert.deepEqual(await p.evaluate(() => settings.furniture), dragged);
    await p.setViewportSize({ width: 390, height: 844 });
    await p.locator("#settingsbtn").click();
    await p.locator("#edit-furniture").click();
    await p.locator("#c").press("Space");
    await p.locator("#c").press("Delete");
    await p.waitForFunction(() => pendingSaves === 0);
    assert.equal(await p.evaluate(() => settings.furniture.length), 0);
    await p.locator("#undo-furniture").click();
    await p.waitForFunction(() => pendingSaves === 0);
    assert.deepEqual(await p.evaluate(() => settings.furniture), dragged);
    await p.evaluate(() => saveSettings({ furniture: [], decorations: true }));
  }));
test("external furniture changes invalidate stale selection and undo", () =>
  withPage(async (p) => {
    await p.evaluate(() => saveSettings({ furniture: [], decorations: false }));
    await p.locator("#settingsbtn").click();
    await p.locator('[data-kind="cooler"]').click();
    await p.locator("#c").press("ArrowRight");
    await p.locator("#c").press("Enter");
    await p.waitForFunction(() => pendingSaves === 0);
    await p.locator("#arrange-furniture").click();
    await p.locator("#c").press("Space");
    await p.request.post(baseURL + "/settings", { data: { furniture: [] } });
    await p.waitForFunction(() => settings.furniture.length === 0);
    assert.equal(await p.evaluate(() => officeScene.movingIndex), null);
    assert.equal(await p.locator("#undo-furniture").isDisabled(), true);
    await p.keyboard.press("Escape");
    await p.evaluate(() => saveSettings({ decorations: true }));
  }));
test("a settings save response invalidates an externally replaced selected prop", () =>
  withPage(async (p) => {
    await p.route("**/state", (r) => r.abort());
    await p.evaluate(() =>
      saveSettings({ furniture: [{ kind: "cooler", x: 0.5, y: 0.95 }] }),
    );
    await p.locator("#settingsbtn").click();
    await p.locator("#edit-furniture").click();
    await p.locator("#c").press("Space");
    await p.request.post(baseURL + "/settings", {
      data: { furniture: [{ kind: "sofa", x: 0.5, y: 0.95 }] },
    });
    await p.evaluate(() => saveSettings({ theme: "amber" }));
    assert.equal(await p.evaluate(() => settings.furniture[0].kind), "sofa");
    assert.equal(await p.evaluate(() => officeScene.movingIndex), null);
    assert.equal(await p.locator("#delete-furniture").isDisabled(), true);
    await p.evaluate(() => saveSettings({ furniture: [], theme: "default" }));
  }));
test("both cats have independent click targets and hidden pets leave no targets", () =>
  withPage(async (p) => {
    await p.waitForFunction(() => officeScene.sprites.blackcat);
    for (const key of ["cat", "blackcat"]) {
      const point = await p.evaluate((key) => {
        officeScene.cosmetics = ["gitcat"];
        officeScene.settings.decorations = true;
        officeScene.draw(0);
        const h = officeScene.petHits.find((h) => h.key === key),
          { ox, oy, scale } = officeScene.transform,
          rect = officeScene.canvas.getBoundingClientRect();
        return {
          x: rect.left + ox + (h.x + h.w / 2) * scale,
          y: rect.top + oy + (h.y + h.h / 2) * scale,
        };
      }, key);
      await p.mouse.click(point.x, point.y);
      assert.equal(await p.evaluate(() => officeScene.petActive), key);
    }
    assert.equal(
      await p.evaluate(() => {
        officeScene.settings.decorations = false;
        officeScene.draw(0);
        const count = officeScene.petHits.length;
        officeScene.settings.decorations = true;
        return count;
      }),
      0,
    );
  }));
test("achievement rewards and XP are searchable without losing focus during polling", () =>
  withPage(async (p) => {
    await p.locator("#achbtn").click();
    await p.locator('[data-filter="rewards"]').click();
    assert.equal(await p.locator(".ach").count(), 8);
    await p.locator("#badgeSearch").fill("aquarium");
    await p.waitForTimeout(1700);
    assert.equal(await p.locator("#badgeSearch").inputValue(), "aquarium");
    assert.equal(
      await p.evaluate(() => document.activeElement.id),
      "badgeSearch",
    );
    assert.equal(await p.locator(".ach").count(), 1);
    assert.match(await p.locator(".ach").innerText(), /Lounge aquarium/);
    assert.match(await p.locator(".achievement-xp").innerText(), /20 XP/);
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
        officeScene.loadedAssets === 14 &&
        officeScene.sprites.sofa &&
        initialized,
    );
    await p.locator("#pausebtn").click();
    await p.waitForTimeout(200);
    await p.screenshot({ path: path.join(dir, "desktop-studio.png") });
    await p.locator("#achbtn").click();
    await p.screenshot({ path: path.join(dir, "achievements.png") });
    await p.locator('[data-filter="rewards"]').click();
    await p.screenshot({ path: path.join(dir, "room-rewards.png") });
    await p.locator('[data-filter="all"]').click();
    await p.keyboard.press("Escape");
    await p.locator("#settingsbtn").click();
    await p.screenshot({ path: path.join(dir, "desktop-settings.png") });
    await p.keyboard.press("Escape");
    await p.evaluate(() =>
      saveSettings({ furniture: [{ kind: "coffee", x: 0.55, y: 0.95 }] }),
    );
    await p.locator("#settingsbtn").click();
    await p.locator("#edit-furniture").click();
    await p.locator("#c").press("Space");
    await p.locator("#c").press("ArrowRight");
    await p.screenshot({
      path: path.join(dir, "furniture-editor.png"),
      fullPage: true,
    });
    await p.keyboard.press("Escape");
    await p.evaluate(() => saveSettings({ furniture: [] }));
    await p.evaluate(() =>
      saveSettings({ theme: "midnight", ambience: "night" }),
    );
    await p.waitForTimeout(200);
    await p.screenshot({ path: path.join(dir, "midnight-studio.png") });
    await p.evaluate(() => saveSettings({ theme: "default", ambience: "day" }));
    await p.setViewportSize({ width: 390, height: 844 });
    await p.waitForTimeout(200);
    await p.locator("#capturebtn").scrollIntoViewIfNeeded();
    assert.equal(await p.locator("#capturebtn").isVisible(), true);
    await p.screenshot({
      path: path.join(dir, "mobile-studio.png"),
      fullPage: true,
    });
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
