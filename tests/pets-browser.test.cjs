const { postSettings, fetchSettings } = require("./settings-helper.cjs");
/* Real observer and browser flows for decorative, accounting-neutral pets. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."),
  base = "http://127.0.0.1:18124",
  reports = path.join(root, "reports/pets");
let home,
  server,
  errors = "";
before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "office-pets-"));
  fs.mkdirSync(path.join(home, "pixel-office"));
  const now = Date.now() / 1000,
    events = [];
  for (let i = 0; i < 100; i++) {
    events.push({
      event: "session_start",
      session_id: "closed-pet-" + i,
      platform: "claude",
      ts: now - 220 + i / 100,
    });
    if (i < 50)
      events.push(
        {
          event: "tool_start",
          session_id: "closed-pet-" + i,
          platform: "claude",
          tool_name: "Read",
          call_id: "recorded-read",
          ts: now - 215 + i / 100,
        },
        {
          event: "tool_end",
          session_id: "closed-pet-" + i,
          platform: "claude",
          tool_name: "Read",
          call_id: "recorded-read",
          status: "success",
          ts: now - 210 + i / 100,
        },
      );
    events.push({
      event: "session_end",
      session_id: "closed-pet-" + i,
      platform: "claude",
      ts: now - 200 + i / 100,
    });
  }
  events.push(
    {
      event: "session_start",
      session_id: "pet-reader",
      platform: "claude",
      title: "Review notes",
      ts: now,
    },
    {
      event: "session_start",
      session_id: "pet-writer",
      platform: "claude",
      title: "Build feature",
      ts: now,
    },
    {
      event: "tool_start",
      session_id: "pet-writer",
      platform: "claude",
      tool_name: "Bash",
      call_id: "build",
      ts: now + 0.001,
    },
    {
      event: "usage",
      session_id: "pet-reader",
      platform: "claude",
      usage_id: "pet-known",
      input_tokens: 256,
      output_tokens: 64,
      total_tokens: 320,
      ts: now + 0.002,
    },
  );
  fs.writeFileSync(
    path.join(home, "pixel-office/events.jsonl"),
    events.map(JSON.stringify).join("\n") + "\n",
  );
  server = spawn(
    process.env.PYTHON || "python",
    ["run.py", "--port", "18124"],
    {
      cwd: root,
      env: { ...process.env, HERMES_HOME: home },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  server.stderr.on("data", (data) => (errors = (errors + data).slice(-3000)));
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/state")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Pet test observer did not start: " + errors);
});
after(async () => {
  if (server && !server.exitCode) {
    const stopped = new Promise((r) => server.once("exit", r));
    server.kill();
    await stopped;
  }
  if (home) fs.rmSync(home, { recursive: true, force: true });
});
async function office(run, options = {}) {
  await fetchSettings(base + "/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      show_pets: true,
      pets_roam: true,
      decorations: true,
      layout: "studio",
      furniture: [],
      sound: false,
    }),
  });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox"],
  });
  try {
    const p = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "no-preference",
      ...options,
    });
    p.setDefaultTimeout(10000);
    const pageErrors = [];
    p.on("pageerror", (e) => pageErrors.push(e.message));
    await p.goto(base);
    await p.waitForFunction(
      () => initialized && officeScene.loadedAssets >= 19,
    );
    assert.equal(
      await p.evaluate(() => typeof OfficePetController),
      "function",
      "the actual page loads the pet module",
    );
    await p
      .waitForFunction(() => officeScene.petViews?.length === 2)
      .catch(async (error) => {
        console.error(
          "Pet boot state",
          await p.evaluate(() => ({
            views: officeScene.petViews,
            cosmetics: officeScene.cosmetics,
            settings: {
              decorations: officeScene.settings.decorations,
              show_pets: officeScene.settings.show_pets,
            },
            grid: {
              w: officeScene.grid?.w,
              h: officeScene.grid?.h,
              seats: officeScene.grid?.seats.length,
            },
            states: [...(officeScene.petWorld?.pets.values() || [])].map(
              (p) => ({
                key: p.key,
                x: p.x,
                y: p.y,
                visible: p.visible,
                mode: p.mode,
                path: p.path.length,
              }),
            ),
          })),
        );
        console.error("Page errors", pageErrors);
        throw error;
      });
    await run(p);
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
  }
}
const positions = (p) =>
  p.evaluate(() =>
    officeScene.petViews.map(({ key, x, y, mode, moving }) => ({
      key,
      x,
      y,
      mode,
      moving,
    })),
  );
async function accounting(p) {
  const s = await (await p.request.get(base + "/state")).json();
  return {
    xp: s.progress.xp,
    stats: s.progress.stats,
    usage: s.usage,
    received: s.tracking.received,
  };
}
async function option(p, group, name) {
  await p.click("#settingsbtn");
  await p
    .getByRole("group", { name: group, exact: true })
    .getByRole("button", { name, exact: true })
    .click();
  await p.waitForFunction(() => pendingSaves === 0);
  await p.keyboard.press("Escape");
}
async function capture(p, name) {
  fs.mkdirSync(reports, { recursive: true });
  await p.screenshot({
    path: path.join(reports, name + ".png"),
    fullPage: true,
  });
}
async function assertSafe(p) {
  const value = await p.evaluate(() => ({
    pets: officeScene.petViews,
    grid: { w: officeScene.grid.w, h: officeScene.grid.h },
    blocked: [
      ...officeScene.navigationProps,
      ...officeScene.furnitureObstacles,
    ],
    hits: officeScene.petHits,
  }));
  assert.equal(value.pets.length, 2);
  for (const pet of value.pets) {
    assert.ok(
      pet.x >= 10 &&
        pet.x <= value.grid.w - 10 &&
        pet.y >= 44 &&
        pet.y <= value.grid.h - 11,
    );
    for (const b of value.blocked)
      assert.ok(
        !(
          pet.x + 5 > b.x &&
          pet.x - 5 < b.x + b.w &&
          pet.y > b.y &&
          pet.y - 15 < b.y + b.h
        ),
        "drawn pet does not overlap a prop or workstation",
      );
    const hit = value.hits.find((h) => h.key === pet.key);
    assert.ok(hit);
    assert.ok(
      pet.x >= hit.x &&
        pet.x <= hit.x + hit.w &&
        pet.y >= hit.y &&
        pet.y <= hit.y + hit.h,
      "hit target follows grounded feet",
    );
  }
}
test("cats move on the real floor, retain collision clearance and use their drawn click targets", () =>
  office(async (p) => {
    const before = await accounting(p),
      initial = await positions(p);
    await p.waitForFunction(
      (initial) =>
        officeScene.petViews.some((pet) => {
          const old = initial.find((p) => p.key === pet.key);
          return old && Math.hypot(pet.x - old.x, pet.y - old.y) > 6;
        }),
      initial,
    );
    for (let i = 0; i < 15; i++) {
      await assertSafe(p);
      await p.waitForTimeout(60);
    }
    // Motion is already verified. Freeze it before a cross-process coordinate
    // lookup so this pointer test does not chase a moving pixel-sized target.
    await p.click("#pausebtn");
    await p.waitForFunction(() => officeScene.paused);
    await p.click("#settingsbtn");
    await p.fill("#pet-cat1-name", "Maple");
    await p.fill("#pet-cat2-name", "Mochi");
    await p.locator('#pet-name-form button[type="submit"]').click();
    await p.waitForFunction(() => pendingSaves === 0);
    await p.keyboard.press("Escape");
    for (const [key, name] of [
      ["cat", "Maple"],
      ["blackcat", "Mochi"],
    ]) {
      const at = await p.evaluate((key) => {
        const pet = officeScene.petHits.find((h) => h.key === key),
          t = officeScene.transform,
          r = document.querySelector("#c").getBoundingClientRect();
        return {
          x: r.left + t.ox + (pet.x + pet.w / 2) * t.scale,
          y: r.top + t.oy + (pet.y + pet.h / 2) * t.scale,
        };
      }, key);
      await p.mouse.click(at.x, at.y);
      await p
        .waitForFunction(
          (name) =>
            document
              .querySelector("#toast")
              .textContent.includes(name + " purrs"),
          name,
        )
        .catch(async (error) => {
          await capture(p, "pet-click-missed-" + key);
          console.error(
            "Pet click",
            { key, at },
            await p.evaluate(
              (at) => ({
                element: document
                  .elementFromPoint(at.x, at.y)
                  ?.outerHTML?.slice(0, 350),
                sheets: [
                  ...document.querySelectorAll(".sheet:not([hidden])"),
                ].map((p) => p.id),
                toast: document.querySelector("#toast").textContent,
                names: officeScene.settings.pet_names,
                active: officeScene.petActive,
                pets: officeScene.petViews,
              }),
              at,
            ),
          );
          throw error;
        });
    }
    await capture(p, "roaming-cats-and-names");
    assert.deepEqual(await accounting(p), before);
  }));
test("pet motion preferences, global pause and hidden-tab gating stop motion without changing accounting", () =>
  office(async (p) => {
    const before = await accounting(p);
    await option(p, "Pet movement", "Rest");
    const rest = await positions(p);
    await p.waitForTimeout(400);
    assert.deepEqual(await positions(p), rest);
    await option(p, "Pet movement", "Roam");
    await p.click("#pausebtn");
    const paused = await positions(p);
    await p.waitForTimeout(400);
    assert.deepEqual(await positions(p), paused);
    await p.click("#pausebtn");
    await p.evaluate(() =>
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      }),
    );
    const hidden = await positions(p);
    await p.waitForTimeout(400);
    assert.deepEqual(await positions(p), hidden);
    await p.evaluate(() => delete document.hidden);
    await p.waitForTimeout(80);
    const resumed = await positions(p);
    for (const pet of resumed) {
      const old = hidden.find((p) => p.key === pet.key);
      assert.ok(
        Math.hypot(pet.x - old.x, pet.y - old.y) < 4,
        "hidden time does not become a movement jump",
      );
    }
    await option(p, "Pets", "Hide");
    await p.waitForFunction(
      () =>
        officeScene.petHits.length === 0 && officeScene.petViews.length === 0,
    );
    await capture(p, "pets-hidden");
    await option(p, "Pets", "Show");
    await p.waitForFunction(() => officeScene.petHits.length === 2);
    assert.deepEqual(await accounting(p), before);
  }));
test("furniture edits and narrow reflow replan pets without stranding their feet", () =>
  office(async (p) => {
    await postSettings(p.request, base + "/settings", {
      data: {
        furniture: [
          { kind: "succulent", x: 0.45, y: 0.75 },
          { kind: "cart", x: 0.7, y: 0.65 },
        ],
      },
    });
    await p.waitForFunction(() => officeScene.settings.furniture.length === 2);
    await assertSafe(p);
    await p.setViewportSize({ width: 390, height: 844 });
    await p.waitForTimeout(300);
    await assertSafe(p);
    await capture(p, "pets-mobile-reflow");
    await p.setViewportSize({ width: 1440, height: 1000 });
    await p.waitForTimeout(300);
    await assertSafe(p);
  }));
test("native reduced-motion preference starts with stationary pets", () =>
  office(
    async (p) => {
      assert.equal(
        await p.evaluate(
          () => matchMedia("(prefers-reduced-motion: reduce)").matches,
        ),
        true,
      );
      const before = await positions(p);
      await p.waitForTimeout(500);
      assert.deepEqual(await positions(p), before);
      await capture(p, "pets-reduced-motion");
    },
    { reducedMotion: "reduce" },
  ));
