const { fetchSettings } = require("./settings-helper.cjs");
/* Real observer and canvas evidence for appearance settings and reward furniture. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const baseURL = "http://127.0.0.1:18122";
const reports =
  process.env.OFFICE_APPEARANCE_SCREENSHOTS ||
  path.join(root, "reports/appearance");
const record = (event, extra = {}) => ({
  event,
  platform: "claude",
  session_id: "appearance-main",
  ts: Date.now() / 1000,
  ...extra,
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Each flow has its own recorded history. The three visible actors occupy a
// two-column, two-row room, so a fourth arrival really walks without a resize.
async function withOffice(run, options = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "office-appearance-"));
  const office = path.join(home, "pixel-office"),
    log = path.join(office, "events.jsonl");
  fs.mkdirSync(office);
  fs.writeFileSync(log, "");
  const publish = (events) =>
    fs.appendFileSync(log, events.map(JSON.stringify).join("\n") + "\n");
  const historical = Array.from({ length: 10 }, (_, index) => [
    record("session_start", {
      session_id: "closed-" + index,
      ts: Date.now() / 1000 - 90,
    }),
    record("session_end", {
      session_id: "closed-" + index,
      ts: Date.now() / 1000 - 60,
    }),
  ]).flat();
  publish([
    ...historical,
    record("session_start", { title: "Build the office" }),
    record("tool_start", { tool_name: "Bash", tool_use_id: "main-typing" }),
    record("subagent_start", {
      parent_session_id: "appearance-main",
      child_session_id: "appearance-child",
      child_goal: "Review appearance",
    }),
    record("tool_start", {
      session_id: "appearance-child",
      parent_session_id: "appearance-main",
      tool_name: "Read",
      tool_use_id: "child-reading",
    }),
    record("session_start", {
      session_id: "appearance-peer",
      title: "Documentation",
    }),
    record("usage", {
      usage_id: "appearance-usage",
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
    }),
  ]);
  let server,
    browser,
    serverOutput = "",
    p;
  const errors = [];
  try {
    server = spawn(
      process.env.PYTHON || "python",
      ["run.py", "--port", "18122"],
      {
        cwd: root,
        env: { ...process.env, HERMES_HOME: home, AGENT_OFFICE_DEMO: "1" },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    server.stderr.on("data", (chunk) => {
      serverOutput = (serverOutput + chunk).slice(-3000);
    });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        if ((await fetch(baseURL + "/state")).ok) {
          ready = true;
          break;
        }
      } catch {}
      await delay(50);
    }
    assert.ok(ready, "Appearance observer starts: " + serverOutput);
    const saved = await fetchSettings(baseURL + "/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        max_chars: 2,
        ambience: "day",
        sound: false,
        ...options.settings,
      }),
    });
    assert.ok(saved.ok);
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ["--no-sandbox"],
    });
    p = await browser.newPage({
      viewport: options.viewport || { width: 1440, height: 1000 },
      reducedMotion: options.reducedMotion || "no-preference",
    });
    p.setDefaultTimeout(10000);
    p.on("pageerror", (error) => errors.push(error.stack || error.message));
    if (options.blockRobot)
      await p.route(
        "**/assets/sprites/characters/studio-assistant.png",
        (route) => route.abort(),
      );
    await p.goto(baseURL);
    await p.waitForFunction(() => initialized && agents.length === 3);
    await p.waitForFunction(
      (blocked) =>
        officeScene.loadedAssets === (blocked ? 19 : 20) &&
        [
          "filingcabinet",
          "taskterminal",
          "statusbeacon",
          "petbed",
          "fern",
        ].every((key) => officeScene.sprites[key]),
      !!options.blockRobot,
    );
    await observeDraws(p);
    await run(p, publish);
    assert.deepEqual(errors, [], "no uncaught page errors");
  } catch (error) {
    if (p && !p.isClosed()) {
      const diagnostics = await p
        .evaluate(() => ({
          settings,
          initialized,
          pendingSaves,
          opened,
          assets: officeScene.loadedAssets,
          assetErrors: officeScene.assetErrors,
          agents: agents.map((a) => ({
            id: a.id,
            kind: a.kind,
            parent: a.parent,
            status: a.status,
          })),
          chars: [...officeScene.chars],
          grid: officeScene.grid,
          draws: window.__appearanceDraws?.slice(-12),
          status: document.querySelector("#save-status")?.textContent,
        }))
        .catch(() => null);
      error.message +=
        "\nAppearance diagnostics: " +
        JSON.stringify(diagnostics) +
        "\nPage errors: " +
        JSON.stringify(errors);
    }
    throw error;
  } finally {
    if (browser) await browser.close();
    if (server && server.exitCode === null) {
      const stopped = new Promise((resolve) => server.once("exit", resolve));
      server.kill();
      await stopped;
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
}

async function observeDraws(p) {
  await p.evaluate(() => {
    // Instrument native calls; do not replace pixels, paths, motion, or timing.
    window.__appearanceDraws = [];
    window.__appearancePortraitDraws = [];
    window.__appearanceCrownRects = [];
    const character = officeScene.character;
    officeScene.character = function (agent, x, y, c) {
      window.__appearanceActor = {
        id: agent.id,
        moving: c.moving,
        dir: c.dir,
        x,
        y,
        distance: c.distance,
      };
      try {
        return character.call(this, agent, x, y, c);
      } finally {
        window.__appearanceActor = null;
      }
    };
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
      const result = draw.call(this, image, ...args);
      if (this.canvas.classList.contains("portrait")) {
        const key = Object.entries(officeScene.sprites).find(
          ([, sprite]) => sprite === image,
        )?.[0];
        window.__appearancePortraitDraws.push({ canvas: this.canvas, key });
        if (window.__appearancePortraitDraws.length > 200)
          window.__appearancePortraitDraws.shift();
      }
      if (
        this.canvas.id === "c" &&
        window.__appearanceActor &&
        args.length === 8
      ) {
        const key = Object.entries(officeScene.sprites).find(
          ([, sprite]) => sprite === image,
        )?.[0];
        window.__appearanceDraws.push({
          ...window.__appearanceActor,
          key,
          column: args[0] / 16,
          row: args[1] / 32,
          flip: this.getTransform().a < 0,
          time: officeScene.time,
        });
        if (window.__appearanceDraws.length > 2400)
          window.__appearanceDraws.splice(0, 600);
      }
      return result;
    };
    const fill = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function (x, y, w, h) {
      const result = fill.call(this, x, y, w, h);
      if (
        this.canvas.id === "c" &&
        window.__appearanceActor &&
        this.fillStyle === "#dfbb68"
      ) {
        window.__appearanceCrownRects.push({
          ...window.__appearanceActor,
          rect: { x, y, w, h },
        });
        if (window.__appearanceCrownRects.length > 600)
          window.__appearanceCrownRects.splice(0, 120);
      }
      return result;
    };
  });
}
async function ledger(p) {
  const state = await (await p.request.get(baseURL + "/state")).json();
  return {
    xp: state.progress.xp,
    stats: state.progress.stats,
    usage: state.usage,
    received: state.tracking.received,
  };
}
async function customize(p) {
  if (await p.evaluate(() => opened === "sheet-settings")) return;
  if (await p.evaluate(() => !!opened)) await p.keyboard.press("Escape");
  await p.click("#settingsbtn");
}
async function choose(p, group, name) {
  await customize(p);
  const button = p
    .getByRole("group", { name: group, exact: true })
    .getByRole("button", { name, exact: true });
  await button.focus();
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => pendingSaves === 0);
  return button;
}
async function closePanel(p) {
  if (await p.evaluate(() => !!opened)) await p.keyboard.press("Escape");
}
async function capture(p, name) {
  fs.mkdirSync(reports, { recursive: true });
  // Capture the settled UI after its ordinary transient notices expire.
  await p.waitForFunction(
    () => document.querySelector("#toast").children.length === 0,
  );
  await p.screenshot({
    path: path.join(reports, name + ".png"),
    fullPage: true,
  });
}
async function pause(p) {
  await closePanel(p);
  if (!(await p.evaluate(() => officeScene.paused))) await p.click("#pausebtn");
  await p.waitForTimeout(160);
}
async function deskPixels(p) {
  await closePanel(p);
  await p.waitForTimeout(170);
  return p.evaluate(() => {
    const s = officeScene,
      seat = s.grid.seats[0],
      t = s.transform,
      dpr = s.canvas.width / s.canvas.clientWidth;
    const x = Math.ceil((t.ox + (seat.x + 1) * t.scale) * dpr),
      y = Math.ceil((t.oy + (seat.y + 14) * t.scale) * dpr);
    const pixels = s.ctx.getImageData(
      x,
      y,
      Math.max(1, Math.floor(37 * t.scale * dpr)),
      Math.max(1, Math.floor(5 * t.scale * dpr)),
    ).data;
    let hash = 2166136261;
    for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    return hash;
  });
}
async function waitLatestSprites(p, style) {
  await p.waitForTimeout(180);
  return p.evaluate((style) => {
    const latest = [
      ...new Map(__appearanceDraws.map((d) => [d.id, d])).values(),
    ];
    return latest.map((d) => ({
      id: d.id,
      key: d.key,
      expectedChild: style === "robot",
    }));
  }, style);
}

test("the compiled assistant atlas has 21 grounded frames and is actually used only for delegated agents", () =>
  withOffice(async (p) => {
    const frames = await p.evaluate(() => {
      const image = officeScene.sprites["studio-assistant"],
        canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 32;
      const g = canvas.getContext("2d", { willReadFrequently: true }),
        cells = [];
      for (let row = 0; row < 3; row++)
        for (let col = 0; col < 7; col++) {
          g.clearRect(0, 0, 16, 32);
          g.drawImage(image, col * 16, row * 32, 16, 32, 0, 0, 16, 32);
          const pixels = g.getImageData(0, 0, 16, 32).data;
          let left = 16,
            right = -1,
            top = 32,
            bottom = -1,
            count = 0,
            hash = 2166136261;
          for (let y = 0; y < 32; y++)
            for (let x = 0; x < 16; x++) {
              const offset = (y * 16 + x) * 4;
              if (pixels[offset + 3] > 32) {
                left = Math.min(left, x);
                right = Math.max(right, x);
                top = Math.min(top, y);
                bottom = Math.max(bottom, y);
                count++;
              }
              for (let channel = 0; channel < 4; channel++)
                hash =
                  Math.imul(hash ^ pixels[offset + channel], 16777619) >>> 0;
            }
          cells.push({ row, col, left, right, top, bottom, count, hash });
        }
      return { width: image.width, height: image.height, cells };
    });
    assert.deepEqual([frames.width, frames.height], [112, 96]);
    assert.equal(frames.cells.length, 21);
    for (const frame of frames.cells) {
      assert.ok(
        frame.count > 50,
        "visible silhouette in frame " + JSON.stringify(frame),
      );
      assert.ok(
        frame.left >= 1 && frame.right <= 14 && frame.top >= 2,
        "cell gutters prevent neighboring pose bleed",
      );
      assert.ok(
        frame.bottom >= 29 && frame.bottom <= 30,
        "all poses share a stable baseline",
      );
      assert.ok(
        Math.abs((frame.left + frame.right) / 2 - 7.5) <= 1,
        "centered pose",
      );
    }
    for (let row = 0; row < 3; row++)
      assert.equal(
        new Set(frames.cells.filter((f) => f.row === row).map((f) => f.hash))
          .size,
        7,
        "each pose in row " + row + " has distinct pixels",
      );
    await p.waitForTimeout(500);
    const rendered = await waitLatestSprites(p, "robot");
    assert.match(
      rendered.find((d) => d.id.endsWith("appearance-main")).key,
      /^char[0-5]$/,
    );
    assert.equal(
      rendered.find((d) => d.id.endsWith("appearance-child")).key,
      "studio-assistant",
    );
    assert.match(
      rendered.find((d) => d.id.endsWith("appearance-peer")).key,
      /^char[0-5]$/,
    );
    const contact = await p.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 112 * 5;
      c.height = 96 * 5;
      const g = c.getContext("2d");
      g.imageSmoothingEnabled = false;
      g.fillStyle = "#26322f";
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(
        officeScene.sprites["studio-assistant"],
        0,
        0,
        c.width,
        c.height,
      );
      return c.toDataURL("image/png").split(",")[1];
    });
    fs.mkdirSync(reports, { recursive: true });
    fs.writeFileSync(
      path.join(reports, "assistant-compiled-21-frames.png"),
      Buffer.from(contact, "base64"),
    );
    fs.writeFileSync(
      path.join(reports, "assistant-frames.json"),
      JSON.stringify(frames, null, 2),
    );
    await choose(p, "Color palette", "Juniper");
    await closePanel(p);
    await capture(p, "juniper-walnut-studio-robot");
  }));

test("keyboard appearance controls change rendered desks and persist without creating activity, XP, or usage", () =>
  withOffice(async (p) => {
    const before = await ledger(p);
    await pause(p);
    await customize(p);
    assert.equal(
      await p
        .getByRole("group", { name: "Desk finish", exact: true })
        .getByRole("button", { name: "Walnut", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await p
        .getByRole("group", { name: "Delegated agents", exact: true })
        .getByRole("button", { name: "Studio robot", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    const pixels = [];
    for (const name of ["Classic", "Walnut", "Slate"]) {
      const button = await choose(p, "Desk finish", name);
      assert.equal(await button.getAttribute("aria-pressed"), "true");
      pixels.push(await deskPixels(p));
    }
    assert.equal(
      new Set(pixels).size,
      3,
      "all three finishes change actual desk pixels",
    );
    await choose(p, "Delegated agents", "People");
    await choose(p, "Color palette", "Juniper");
    await closePanel(p);
    const rendered = await waitLatestSprites(p, "people");
    assert.ok(
      rendered.every((d) => /^char[0-5]$/.test(d.key)),
      "people preference changes the child draw as well as its control",
    );
    await capture(p, "juniper-slate-people");
    await p.reload();
    await p.waitForFunction(
      () => initialized && officeScene.loadedAssets === 20,
    );
    await customize(p);
    for (const [group, name] of [
      ["Desk finish", "Slate"],
      ["Delegated agents", "People"],
      ["Color palette", "Juniper"],
    ])
      assert.equal(
        await p
          .getByRole("group", { name: group, exact: true })
          .getByRole("button", { name, exact: true })
          .getAttribute("aria-pressed"),
        "true",
      );
    assert.deepEqual(await ledger(p), before);
  }));

test("agent cards use the chosen delegated appearance and keep parent portraits as people", () =>
  withOffice(async (p) => {
    await p.click("#floorbtn");
    const portraits = () =>
      p.evaluate(() =>
        [...document.querySelectorAll("#roster .agent-card")].map((card) => ({
          id: card.dataset.agent,
          key: __appearancePortraitDraws.findLast(
            (d) => d.canvas === card.querySelector(".portrait"),
          )?.key,
        })),
      );
    const robot = await portraits();
    assert.equal(
      robot.find((d) => d.id.endsWith("appearance-child")).key,
      "studio-assistant",
      "child roster portrait follows its actual floor appearance",
    );
    assert.match(
      robot.find((d) => d.id.endsWith("appearance-main")).key,
      /^char[0-5]$/,
    );
    await choose(p, "Delegated agents", "People");
    await closePanel(p);
    await p.click("#floorbtn");
    assert.ok((await portraits()).every((d) => /^char[0-5]$/.test(d.key)));
    await capture(p, "people-roster-portraits");
  }));

test("failed appearance saves restore acknowledged choices and a newer queued edit remains intact", () =>
  withOffice(async (p) => {
    const before = await ledger(p);
    await pause(p);
    const originalPixels = await deskPixels(p);
    await p.route("**/settings", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 503, body: "unavailable" })
        : route.continue(),
    );
    await choose(p, "Desk finish", "Slate");
    assert.match(await p.textContent("#save-status"), /Not saved/);
    assert.equal(await p.evaluate(() => settings.desk_style), "walnut");
    assert.equal(
      await deskPixels(p),
      originalPixels,
      "failed write restores rendered desk",
    );
    await choose(p, "Delegated agents", "People");
    assert.equal(await p.evaluate(() => settings.subagent_style), "robot");
    assert.match(await p.textContent("#save-status"), /Not saved/);
    await p.unroute("**/settings");
    let release,
      count = 0;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    await p.route("**/settings", async (route) => {
      if (route.request().method() === "POST" && ++count === 1) {
        await held;
        await route.fulfill({ status: 503, body: "unavailable" });
      } else await route.continue();
    });
    try {
      await customize(p);
      await p
        .getByRole("group", { name: "Desk finish", exact: true })
        .getByRole("button", { name: "Slate", exact: true })
        .click();
      await p.waitForFunction(() => pendingSaves === 1);
      await p
        .getByRole("group", { name: "Delegated agents", exact: true })
        .getByRole("button", { name: "People", exact: true })
        .click();
      await p.waitForFunction(() => pendingSaves === 2);
      release();
      await p.waitForFunction(() => pendingSaves === 0);
      assert.deepEqual(
        await p.evaluate(() => [settings.desk_style, settings.subagent_style]),
        ["walnut", "people"],
      );
      assert.match(
        await p.textContent("#save-status"),
        /Saved on this computer/,
      );
      const state = await (await p.request.get(baseURL + "/state")).json();
      assert.deepEqual(
        [state.settings.desk_style, state.settings.subagent_style],
        ["walnut", "people"],
      );
      await p.unroute("**/settings");
      await choose(p, "Desk finish", "Slate");
      assert.equal(
        await p.evaluate(() => settings.desk_style),
        "slate",
        "retry succeeds",
      );
      assert.deepEqual(await ledger(p), before);
    } finally {
      release();
    }
  }));

for (const style of ["robot", "people"])
  for (const layout of ["open", "bullpen"])
    test(`${style} arrivals really walk and face their route in ${layout}, then pause freezes the scene`, () =>
      withOffice(
        async (p, publish) => {
          assert.ok(
            await p.evaluate(() => haveUnlock("layout_bullpen")),
            "layout earned from recorded sessions",
          );
          const geometry = await p.evaluate(() => officeScene.geometry);
          publish([
            record("subagent_start", {
              parent_session_id: "appearance-main",
              child_session_id: "appearance-arrival",
              child_goal: "Verify motion",
            }),
            record("tool_start", {
              session_id: "appearance-arrival",
              parent_session_id: "appearance-main",
              tool_name: "Read",
              tool_use_id: "arrival-reading",
            }),
          ]);
          await p.waitForFunction(() =>
            __appearanceDraws.some(
              (d) =>
                d.id.endsWith("appearance-arrival") &&
                d.moving &&
                d.distance > 10,
            ),
          );
          assert.equal(
            await p.evaluate(() => officeScene.geometry),
            geometry,
            "arrival does not trigger a teleporting reflow",
          );
          await p.waitForFunction(
            () => {
              const actor = [...officeScene.chars].find(([id]) =>
                id.endsWith("appearance-arrival"),
              )?.[1];
              return actor && actor.distance > 10 && !actor.moving;
            },
            null,
            { timeout: 15000 },
          );
          const trace = await p.evaluate(() =>
            __appearanceDraws.filter((d) =>
              d.id.endsWith("appearance-arrival"),
            ),
          );
          const walking = trace.filter((d) => d.moving);
          assert.ok(
            walking.length >= 8,
            "native canvas painted a real arrival route",
          );
          assert.ok(
            new Set(walking.map((d) => Math.round(d.x) + ":" + Math.round(d.y)))
              .size >= 6,
            "character moved through distinct world positions",
          );
          assert.ok(
            new Set(walking.map((d) => d.column)).size >= 3,
            "distance-based walk cycle advances",
          );
          assert.ok(
            new Set(walking.map((d) => d.dir)).size >= 2,
            "route turns rather than sliding in one facing",
          );
          const expectedKey =
            style === "robot"
              ? "studio-assistant"
              : await p.evaluate(
                  (id) => "char" + (hash(id) % 6),
                  walking[0].id,
                );
          for (const d of walking) {
            assert.equal(d.key, expectedKey);
            assert.equal(d.row, d.dir === "up" ? 1 : d.dir === "down" ? 0 : 2);
            assert.equal(d.flip, d.dir === "left");
          }
          await p.waitForFunction(() => {
            const frames = __appearanceDraws
              .filter((d) => d.id.endsWith("appearance-arrival") && !d.moving)
              .map((d) => d.column);
            return frames.includes(5) && frames.includes(6);
          });
          await pause(p);
          const frozen = await p.evaluate(() => ({
            time: officeScene.time,
            chars: [...officeScene.chars].map(([id, c]) => [
              id,
              c.x,
              c.y,
              c.distance,
            ]),
          }));
          await p.waitForTimeout(450);
          assert.deepEqual(
            await p.evaluate(() => ({
              time: officeScene.time,
              chars: [...officeScene.chars].map(([id, c]) => [
                id,
                c.x,
                c.y,
                c.distance,
              ]),
            })),
            frozen,
          );
          fs.mkdirSync(reports, { recursive: true });
          fs.writeFileSync(
            path.join(reports, `motion-${style}-${layout}.json`),
            JSON.stringify(
              {
                nativeDraws: walking.length,
                directions: [...new Set(walking.map((d) => d.dir))],
                frames: [...new Set(walking.map((d) => d.column))],
                first: walking[0],
                last: walking.at(-1),
              },
              null,
              2,
            ),
          );
          await capture(p, `${layout}-${style}-arrival-seated`);
        },
        { settings: { subagent_style: style, layout } },
      ));

async function place(p, kind, { tryCollision = false } = {}) {
  await customize(p);
  const before = await p.evaluate(() => settings.furniture.length);
  await p.click(`#furniture-tools [data-kind="${kind}"]`);
  if (tryCollision) {
    const occupied = await p.evaluate(() => {
      const s = officeScene,
        t = s.transform,
        r = s.canvas.getBoundingClientRect(),
        seat = s.grid.seats[0];
      return {
        x: r.left + t.ox + (seat.x + 20) * t.scale,
        y: r.top + t.oy + (seat.y + 15) * t.scale,
      };
    });
    await p.mouse.click(occupied.x, occupied.y);
    assert.equal(
      await p.evaluate(() => settings.furniture.length),
      before,
      "occupied desk rejects placement",
    );
  }
  const point = await p.evaluate(() => {
    const s = officeScene,
      t = s.transform,
      r = s.canvas.getBoundingClientRect();
    for (let y = 65; y < s.grid.h - 20; y += 5)
      for (let x = 18; x < s.grid.w - 18; x += 5) {
        if (
          ![-1, 0, 1].every((dx) =>
            [-1, 0, 1].every(
              (dy) => s.placement({ x: x + dx, y: y + dy })?.valid,
            ),
          )
        )
          continue;
        const point = {
          x: r.left + t.ox + x * t.scale,
          y: r.top + t.oy + y * t.scale,
        };
        if (document.elementFromPoint(point.x, point.y)?.id === "c")
          return point;
      }
    return null;
  });
  assert.ok(point, "free floor for " + kind);
  await p.mouse.click(point.x, point.y);
  await p.waitForFunction(
    (count) => pendingSaves === 0 && settings.furniture.length === count,
    before + 1,
  );
  await p.click("#finish-furniture");
}
async function clickProp(p, kind) {
  await closePanel(p);
  const point = await p.evaluate((kind) => {
    const s = officeScene,
      hit =
        s.propHits.findLast((h) => h.kind === kind) ||
        s.resolvedFurniture.find((item) => item.kind === kind)?.bounds,
      t = s.transform,
      r = s.canvas.getBoundingClientRect();
    if (!hit) return null;
    return {
      x: r.left + t.ox + (hit.x + hit.w / 2) * t.scale,
      y: r.top + t.oy + (hit.y + hit.h / 2) * t.scale,
    };
  }, kind);
  assert.ok(point, "rendered bounds for " + kind);
  await p.mouse.click(point.x, point.y);
}
test("recorded progress gates booth and cabinet; their previews, placement, reflow and canvas actions work", () =>
  withOffice(async (p, publish) => {
    await customize(p);
    const booth = p.locator('#furniture-tools [data-kind="focusbooth"]'),
      cabinet = p.locator('#furniture-tools [data-kind="filingcabinet"]');
    assert.deepEqual(
      await p
        .locator("#furniture-tools button")
        .evaluateAll((buttons) =>
          buttons.map((button) => button.dataset.kind).sort(),
        ),
      await p.evaluate(() => Object.keys(PROP_NAMES).sort()),
      "every registered prop has one catalog button",
    );
    assert.equal(await booth.isDisabled(), true);
    assert.equal(await cabinet.isDisabled(), true);
    assert.match(await booth.textContent(), /Workhorse|500/);
    assert.match(await cabinet.textContent(), /Toolkit|10/);
    publish(
      Array.from({ length: 8 }, (_, i) => [
        record("tool_start", {
          tool_name: "Distinct tool " + i,
          tool_use_id: "distinct-" + i,
        }),
        record("tool_end", {
          tool_name: "Distinct tool " + i,
          tool_use_id: "distinct-" + i,
        }),
      ]).flat(),
    );
    await p.waitForFunction(() => haveUnlock("toolkit"));
    assert.equal(await cabinet.isDisabled(), false);
    assert.equal(await booth.isDisabled(), true);
    const tools = await p.evaluate(() => progress.stats.tools);
    publish(
      Array.from({ length: 500 - tools }, (_, i) => [
        record("tool_start", {
          tool_name: "Read",
          tool_use_id: "workhorse-" + i,
        }),
        record("tool_end", {
          tool_name: "Read",
          tool_use_id: "workhorse-" + i,
        }),
      ]).flat(),
    );
    await p.waitForFunction(() => haveUnlock("workhorse"));
    assert.equal(await booth.isDisabled(), false);
    const previews = await p
      .locator(
        '#furniture-tools [data-kind="focusbooth"] canvas, #furniture-tools [data-kind="filingcabinet"] canvas',
      )
      .evaluateAll((cs) =>
        cs.map((c) => ({
          w: c.width,
          h: c.height,
          pixels: c
            .getContext("2d")
            .getImageData(0, 0, c.width, c.height)
            .data.filter((v, i) => i % 4 === 3 && v > 32).length,
        })),
      );
    assert.equal(previews.length, 2);
    assert.ok(
      previews.every((c) => c.pixels > 30),
      "actual new atlas previews contain visible pixels",
    );
    const before = await ledger(p);
    await place(p, "focusbooth", { tryCollision: true });
    await place(p, "filingcabinet");
    const saved = await p.evaluate(() => structuredClone(settings.furniture));
    await clickProp(p, "focusbooth");
    assert.equal(await p.locator("#sheet-tasks").isVisible(), true);
    await clickProp(p, "filingcabinet");
    assert.equal(await p.locator("#sheet-events").isVisible(), true);
    assert.equal(
      await p
        .locator('[data-event-view="history"]')
        .getAttribute("aria-pressed"),
      "true",
    );
    await p.waitForFunction(() => historyLoaded && !historyLoading);
    assert.match(await p.textContent("#eventbox"), /Read|Distinct tool/);
    await closePanel(p);
    await capture(p, "earned-focus-booth-and-filing-cabinet");
    for (const layout of ["bullpen", "open"]) {
      await customize(p);
      await p.click(`[data-layout="${layout}"]`);
      await p.waitForFunction(() => pendingSaves === 0);
      await closePanel(p);
      for (const width of [1440, 320]) {
        await p.setViewportSize({ width, height: 1000 });
        await p.waitForTimeout(220);
        const actual = await p.evaluate(() => {
          const s = officeScene;
          return {
            grid: { w: s.grid.w, h: s.grid.h },
            props: s.resolvedFurniture.map((p) => ({
              kind: p.kind,
              bounds: p.bounds,
            })),
            obstacles: s.furnitureObstacles,
            decor: s.settings.decorations
              ? defaultDecor(s.grid, s.cosmetics)
              : [],
          };
        });
        assert.equal(actual.props.length, 2);
        const occupied = [...actual.obstacles, ...actual.decor];
        for (const prop of actual.props) {
          assert.ok(prop.bounds, "new prop remains placed after reflow");
          const b = prop.bounds;
          assert.ok(
            b.x >= 7 &&
              b.y >= 28 &&
              b.x + b.w <= actual.grid.w - 7 &&
              b.y + b.h <= actual.grid.h - 10,
          );
          for (const a of occupied)
            assert.equal(
              b.x < a.x + a.w + 2 &&
                b.x + b.w + 2 > a.x &&
                b.y < a.y + a.h + 2 &&
                b.y + b.h + 2 > a.y,
              false,
              "new prop does not overlap desk, decor or another prop",
            );
          occupied.push(b);
        }
        assert.deepEqual(
          await p.evaluate(() => settings.furniture),
          saved,
          "reflow does not mutate saved layout",
        );
      }
    }
    await p.reload();
    await p.waitForFunction(
      () => initialized && officeScene.loadedAssets === 20,
    );
    assert.deepEqual(await p.evaluate(() => settings.furniture), saved);
    assert.deepEqual(
      await ledger(p),
      before,
      "decor placement, layout and panels add no observer work",
    );
  }));

test("appearance controls fit 320 pixels and remain keyboard usable after reload", () =>
  withOffice(
    async (p) => {
      const before = await ledger(p);
      await choose(p, "Desk finish", "Slate");
      await choose(p, "Delegated agents", "People");
      await choose(p, "Color palette", "Juniper");
      for (const group of [
        "Desk finish",
        "Delegated agents",
        "Color palette",
      ]) {
        const overflow = await p
          .getByRole("group", { name: group, exact: true })
          .evaluate((el) => {
            const parent = el.closest(".sheet").getBoundingClientRect();
            return [...el.querySelectorAll("button")].some((b) => {
              const r = b.getBoundingClientRect();
              return r.left < parent.left - 1 || r.right > parent.right + 1;
            });
          });
        assert.equal(overflow, false, group + " stays inside the mobile panel");
      }
      assert.ok(
        await p.evaluate(
          () =>
            document.documentElement.scrollWidth <= innerWidth &&
            document.body.scrollWidth <= innerWidth,
        ),
      );
      await p
        .getByRole("group", { name: "Desk finish", exact: true })
        .scrollIntoViewIfNeeded();
      await capture(p, "mobile-320-appearance-controls");
      await p.reload();
      await p.waitForFunction(() => initialized);
      await customize(p);
      for (const [group, name] of [
        ["Desk finish", "Slate"],
        ["Delegated agents", "People"],
        ["Color palette", "Juniper"],
      ])
        assert.equal(
          await p
            .getByRole("group", { name: group, exact: true })
            .getByRole("button", { name, exact: true })
            .getAttribute("aria-pressed"),
          "true",
        );
      assert.deepEqual(await ledger(p), before);
    },
    { viewport: { width: 320, height: 900 } },
  ));

test("missing assistant art falls back to a visible person and reduced motion freezes it", () =>
  withOffice(
    async (p) => {
      assert.equal(await p.evaluate(() => officeScene.paused), true);
      assert.match(
        (await p.evaluate(() => officeScene.assetErrors)).join(" "),
        /studio-assistant/,
      );
      await p.waitForTimeout(240);
      const draws = await p.evaluate(() =>
        __appearanceDraws.filter((d) => d.id.endsWith("appearance-child")),
      );
      assert.ok(draws.length > 0);
      assert.ok(
        draws.every((d) => /^char[0-5]$/.test(d.key)),
        "child remains visibly rendered by a loaded people sprite",
      );
      assert.equal(
        await p.evaluate(() => settings.subagent_style),
        "robot",
        "asset failure does not overwrite saved preference",
      );
      const time = await p.evaluate(() => officeScene.time);
      await p.waitForTimeout(350);
      assert.equal(await p.evaluate(() => officeScene.time), time);
      assert.equal(
        await p.locator("#pausebtn").getAttribute("aria-pressed"),
        "true",
      );
    },
    { blockRobot: true, reducedMotion: "reduce" },
  ));

test("an earned crown sits on the shorter robot silhouette and survives switching to people", () =>
  withOffice(async (p, publish) => {
    publish(
      Array.from({ length: 1200 }, (_, i) => [
        record("tool_start", { tool_name: "Read", call_id: "crown-" + i }),
        record("tool_end", {
          tool_name: "Read",
          call_id: "crown-" + i,
          status: "success",
        }),
      ]).flat(),
    );
    await p.waitForFunction(() => officeScene.cosmetics.includes("crown"));
    await pause(p);
    const evidence = await p.evaluate(() => {
      const draw = __appearanceDraws.findLast((d) =>
          d.id.endsWith("appearance-child"),
        ),
        image = officeScene.sprites[draw.key];
      const c = document.createElement("canvas");
      c.width = 16;
      c.height = 32;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(image, draw.column * 16, draw.row * 32, 16, 32, 0, 0, 16, 32);
      const rgba = g.getImageData(0, 0, 16, 32).data;
      let headTop = 32;
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 16; x++)
          if (rgba[(y * 16 + x) * 4 + 3] > 32) headTop = Math.min(headTop, y);
      const crown = __appearanceCrownRects
        .filter((d) => d.id === draw.id)
        .slice(-4)
        .map((d) => ({
          top: d.rect.y - draw.y,
          bottom: d.rect.y + d.rect.h - draw.y,
        }));
      return { key: draw.key, headTop, crown };
    });
    assert.equal(evidence.key, "studio-assistant");
    assert.equal(evidence.crown.length, 4);
    assert.ok(
      Math.min(...evidence.crown.map((r) => r.top)) <= evidence.headTop,
      "crown reaches the top of the visible head",
    );
    assert.ok(
      Math.max(...evidence.crown.map((r) => r.bottom)) >= evidence.headTop,
      "crown is attached instead of floating in the empty atlas gutter",
    );
    assert.ok(
      Math.max(...evidence.crown.map((r) => r.bottom)) <= evidence.headTop + 6,
      "crown stays near the top of the head",
    );
    await choose(p, "Color palette", "Juniper");
    await closePanel(p);
    await capture(p, "earned-crown-studio-robot");
    const before = await ledger(p);
    await choose(p, "Delegated agents", "People");
    await closePanel(p);
    assert.ok(
      (await waitLatestSprites(p, "people")).every((d) =>
        /^char[0-5]$/.test(d.key),
      ),
    );
    await capture(p, "earned-crown-people");
    assert.deepEqual(await ledger(p), before);
    fs.writeFileSync(
      path.join(reports, "crown-anchor.json"),
      JSON.stringify(evidence, null, 2),
    );
  }));
