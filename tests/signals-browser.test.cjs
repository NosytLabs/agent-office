/* Actual observer events and native controls. Pet nap loops below are explicitly
 * accelerated rendering steps; they do not advance observer or provider time. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { observerFixture } = require("./observer-fixture.cjs");
const reports = path.resolve(__dirname, "../reports/signals");
const sizes = {
  taskterminal: [24, 34],
  statusbeacon: [12, 28],
  petbed: [26, 16],
  fern: [26, 28],
};
const targets = {
  taskterminal: { x: 0.17, y: 0.64 },
  statusbeacon: { x: 0.83, y: 0.51 },
  petbed: { x: 0.53, y: 0.65 },
  fern: { x: 0.8, y: 0.72 },
};
const events = [
  {
    event: "session_start",
    session_id: "signals-planning",
    platform: "opencode",
    title: "Plan the release",
  },
  {
    event: "session_start",
    session_id: "signals-review",
    platform: "hermes",
    title: "Review the layout",
  },
  {
    event: "tasks_update",
    session_id: "signals-planning",
    platform: "opencode",
    task_source: "opencode.todo.updated",
    tasks: [
      {
        id: "review",
        content: "Review the office signals",
        status: "in_progress",
      },
      { id: "release", content: "Verify the release notes", status: "pending" },
    ],
  },
  {
    event: "usage",
    session_id: "signals-planning",
    platform: "opencode",
    usage_id: "signals-usage",
    input_tokens: 100,
    output_tokens: 25,
    total_tokens: 125,
    cost_usd: 0.0012,
  },
];
const settings = {
  room_name: "Signals studio",
  theme: "juniper",
  decorations: true,
  show_pets: false,
  furniture: [],
};
const accounting = (state) => ({
  progress: state.progress,
  usage: state.usage,
  events: state.events,
  received: state.tracking.received,
});

async function capture(page, name) {
  fs.mkdirSync(reports, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: path.join(reports, name + ".png"),
    fullPage: true,
  });
}
async function closePanel(page) {
  if (await page.evaluate(() => opened !== null))
    await page.keyboard.press("Escape");
}
async function freePoint(page, target, minDistance = 0) {
  return page.evaluate(
    ({ target, minDistance }) => {
      const scene = officeScene,
        t = scene.transform,
        rect = scene.canvas.getBoundingClientRect();
      const candidates = [];
      const old =
        scene.movingIndex === null
          ? null
          : scene.furnitureBounds(scene.movingIndex);
      for (let y = 62; y < scene.grid.h - 12; y += 3)
        for (let x = 20; x < scene.grid.w - 20; x += 3) {
          if (
            old &&
            Math.hypot(x - old.x - old.w / 2, y - old.y - old.h) < minDistance
          )
            continue;
          if (
            ![-1, 0, 1].every((dx) =>
              [-1, 0, 1].every(
                (dy) => scene.placement({ x: x + dx, y: y + dy })?.valid,
              ),
            )
          )
            continue;
          const point = {
            x: rect.left + t.ox + x * t.scale,
            y: rect.top + t.oy + y * t.scale,
          };
          if (document.elementFromPoint(point.x, point.y)?.id !== "c") continue;
          candidates.push({
            ...point,
            distance: Math.hypot(
              x - target.x * scene.grid.w,
              y - target.y * scene.grid.h,
            ),
          });
        }
      return candidates.sort((a, b) => a.distance - b.distance)[0] || null;
    },
    { target, minDistance },
  );
}
async function place(page, kind) {
  await closePanel(page);
  await page.click("#settingsbtn");
  const before = await page.evaluate(() => settings.furniture.length);
  await page.locator(`#furniture-tools [data-kind="${kind}"]`).click();
  const point = await freePoint(page, targets[kind]);
  assert.ok(point, "Free native placement for " + kind);
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(
    (count) => pendingSaves === 0 && settings.furniture.length === count,
    before + 1,
  );
  await page.click("#finish-furniture");
}
async function propPoint(page, kind) {
  await page.locator("#c").scrollIntoViewIfNeeded();
  const point = await page.evaluate((kind) => {
    const scene = officeScene,
      item = scene.resolvedFurniture.find((item) => item.kind === kind),
      b = item?.bounds;
    if (!b) return null;
    const r = scene.canvas.getBoundingClientRect(),
      t = scene.transform;
    return {
      x: r.left + t.ox + (b.x + b.w / 2) * t.scale,
      y: r.top + t.oy + (b.y + b.h / 2) * t.scale,
    };
  }, kind);
  assert.ok(point, "Resolved target for " + kind);
  return point;
}
async function clickProp(page, kind) {
  await closePanel(page);
  const point = await propPoint(page, kind);
  await page.mouse.click(point.x, point.y);
}
async function assertGeometry(page) {
  const scene = await page.evaluate(() => ({
    grid: { w: officeScene.grid.w, h: officeScene.grid.h },
    props: officeScene.resolvedFurniture,
    occupied: [
      ...officeScene.furnitureObstacles,
      ...defaultDecor(officeScene.grid, officeScene.cosmetics),
    ],
  }));
  for (const item of scene.props) {
    const b = item.bounds;
    assert.ok(b, item.kind + " remains placeable after reflow");
    assert.ok(
      b.x >= 7 &&
        b.y >= 28 &&
        b.x + b.w <= scene.grid.w - 7 &&
        b.y + b.h <= scene.grid.h - 10,
    );
    for (const other of scene.occupied)
      assert.equal(
        b.x < other.x + other.w &&
          b.x + b.w > other.x &&
          b.y < other.y + other.h &&
          b.y + b.h > other.y,
        false,
        item.kind + " overlaps another prop or desk",
      );
    scene.occupied.push(b);
  }
}

test("four signal props place through Customize, survive mobile reflow, and open their existing panels without accounting writes", async () => {
  await observerFixture({ events, settings }, async ({ page, state }) => {
    const before = accounting(await state());
    const sprites = await page.evaluate(
      (keys) =>
        Object.fromEntries(
          keys.map((key) => {
            const sprite = officeScene.sprites[key];
            return [
              key,
              {
                width: sprite.width,
                height: sprite.height,
                visible: sprite
                  .getContext("2d")
                  .getImageData(0, 0, sprite.width, sprite.height)
                  .data.some((v, i) => i % 4 === 3 && v > 0),
              },
            ];
          }),
        ),
      Object.keys(sizes),
    );
    for (const [key, [width, height]] of Object.entries(sizes))
      assert.deepEqual(sprites[key], { width, height, visible: true });
    for (const kind of Object.keys(sizes)) await place(page, kind);
    const saved = await page.evaluate(() =>
      structuredClone(settings.furniture),
    );
    assert.deepEqual(
      saved.map((item) => item.kind),
      Object.keys(sizes),
    );
    await page.reload();
    await page.waitForFunction(
      () =>
        initialized &&
        officeScene.sprites.petbed &&
        settings.furniture.length === 4,
    );
    assert.deepEqual(await page.evaluate(() => settings.furniture), saved);
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 320, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.waitForFunction(
        () =>
          officeScene.canvas.width ===
          Math.round(
            officeScene.canvas.clientWidth * Math.min(devicePixelRatio, 2),
          ),
      );
      await assertGeometry(page);
      await capture(
        page,
        viewport.width === 320 ? "mobile-320-scene" : "desktop-scene",
      );
      await clickProp(page, "taskterminal");
      await page.waitForFunction(
        () => opened === "sheet-tasks" && taskMode === "reported",
      );
      assert.match(
        await page.textContent("#reported-taskboard"),
        /Review the office signals/,
      );
      assert.equal(await page.isVisible("#taskboard"), false);
      await clickProp(page, "statusbeacon");
      await page.waitForFunction(
        () => opened === "sheet-tasks" && taskMode === "activity",
      );
      assert.equal(await page.isVisible("#reported-taskboard"), false);
      await clickProp(page, "petbed");
      await page.waitForFunction(() => opened === "sheet-settings");
      const name = await page.locator("#pet-cat1-name").boundingBox();
      assert.ok(
        name.y >= 0 && name.y + name.height <= viewport.height,
        "Pet bed scrolls its existing name settings into view",
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await closePanel(page);
      assert.deepEqual(
        await page.evaluate(() => settings.furniture),
        saved,
        "Reflow and room actions preserve stored positions",
      );
    }
    assert.deepEqual(accounting(await state()), before);
  });
});

test("task console uses real local-run states, gates routing, and keeps the observer fallback", async () => {
  await observerFixture({ events, settings }, async ({ page, state }) => {
    await place(page, "taskterminal");
    const before = accounting(await state());
    assert.deepEqual(
      await page.evaluate(() => ({
        state: officeScene.taskTerminalState(),
        sprite: officeScene.taskTerminalSpriteKey(),
      })),
      { state: null, sprite: "taskterminal" },
      "an observer-only office keeps the original Reported tasks terminal",
    );
    await clickProp(page, "taskterminal");
    await page.waitForFunction(
      () => opened === "sheet-tasks" && taskMode === "reported",
    );
    await closePanel(page);
    await page.evaluate(() => {
      window.localRunOpens = 0;
      window.officeTaskRunner.open = function () {
        window.localRunOpens++;
      };
    });
    const cases = [
      [{ enabled: true, connected: true, runs: [] }, "idle"],
      [
        {
          enabled: true,
          connected: true,
          runs: [{ id: "one", status: "running", finished_at: null }],
        },
        "running",
      ],
      [
        {
          enabled: true,
          connected: true,
          runs: [{ id: "one", status: "succeeded", finished_at: 1 }],
        },
        "finished",
      ],
      [{ enabled: true, connected: false, runs: [] }, "disconnected"],
    ];
    const sprites = [];
    for (const [detail, expected] of cases) {
      sprites.push(
        await page.evaluate(
          ({ detail, expected }) => {
            window.dispatchEvent(
              new CustomEvent("agent-office:task-runs", { detail }),
            );
            const key = officeScene.taskTerminalSpriteKey();
            const sprite = officeScene.sprites[key];
            const pixels = sprite
              .getContext("2d")
              .getImageData(0, 0, sprite.width, sprite.height).data;
            let hash = 2166136261;
            for (const byte of pixels)
              hash = Math.imul(hash ^ byte, 16777619) >>> 0;
            return {
              state: officeScene.taskTerminalState(),
              key,
              size: [sprite.width, sprite.height],
              visible: sprite
                .getContext("2d")
                .getImageData(0, 0, sprite.width, sprite.height)
                .data.some((value, index) => index % 4 === 3 && value > 0),
              hash,
              expected,
            };
          },
          { detail, expected },
        ),
      );
      if (process.env.OFFICE_SCREENSHOTS) {
        fs.mkdirSync(process.env.OFFICE_SCREENSHOTS, { recursive: true });
        await page.locator("#c").screenshot({
          path: path.join(
            process.env.OFFICE_SCREENSHOTS,
            `task-console-${expected}-desktop.png`,
          ),
        });
      }
    }
    for (const sprite of sprites)
      assert.deepEqual(sprite, {
        state: sprite.expected,
        key: "taskterminal-" + sprite.expected,
        size: [24, 34],
        visible: true,
        hash: sprite.hash,
        expected: sprite.expected,
      });
    assert.equal(
      new Set(sprites.map((sprite) => sprite.hash)).size,
      4,
      "all four generated source cells normalize to distinct rendered states",
    );
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("agent-office:task-runs", {
          detail: {
            enabled: true,
            connected: true,
            runs: [{ status: "running", created_at: 30 }],
          },
        }),
      ),
    );
    const motionFrames = [];
    for (let index = 0; index < 8; index++) {
      motionFrames.push(await terminalPixels(page));
      await page.waitForTimeout(130);
    }
    assert.equal(
      new Set(motionFrames).size,
      2,
      "the running-only activity lamp uses two restrained frames",
    );
    await page.click("#pausebtn");
    const pausedTerminal = await terminalPixels(page);
    await page.waitForTimeout(800);
    assert.equal(
      await terminalPixels(page),
      pausedTerminal,
      "Pause freezes the running activity lamp",
    );
    await page.click("#pausebtn");
    const terminalOutcomes = await page.evaluate(() => {
      const emit = (runs) => {
        window.dispatchEvent(
          new CustomEvent("agent-office:task-runs", {
            detail: { enabled: true, connected: true, runs },
          }),
        );
        return {
          state: officeScene.taskTerminalState(),
          sprite: officeScene.taskTerminalSpriteKey(),
        };
      };
      const oldSuccess = {
        status: "succeeded",
        created_at: 10,
        finished_at: 11,
        exit_code: 0,
      };
      return {
        failure: emit([
          oldSuccess,
          {
            status: "failed",
            created_at: 20,
            finished_at: 21,
            exit_code: 1,
          },
        ]),
        cancelled: emit([
          {
            status: "cancelled",
            created_at: 20,
            finished_at: 21,
            exit_code: -15,
          },
          oldSuccess,
        ]),
        cancelling: emit([
          oldSuccess,
          {
            status: "running",
            created_at: 20,
            finished_at: null,
            exit_code: null,
          },
        ]),
      };
    });
    assert.deepEqual(terminalOutcomes, {
      failure: { state: "failed", sprite: "taskterminal-idle" },
      cancelled: { state: "idle", sprite: "taskterminal-idle" },
      cancelling: { state: "running", sprite: "taskterminal-running" },
    });
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("agent-office:task-runs", {
          detail: { enabled: true, connected: false, runs: [] },
        }),
      ),
    );
    if (process.env.OFFICE_SCREENSHOTS) {
      await page.setViewportSize({ width: 320, height: 844 });
      await page.locator("#c").screenshot({
        path: path.join(
          process.env.OFFICE_SCREENSHOTS,
          "task-console-disconnected-mobile.png",
        ),
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await clickProp(page, "taskterminal");
    assert.equal(await page.evaluate(() => window.localRunOpens), 1);
    assert.equal(await page.evaluate(() => opened), null);
    const roomButton = page.locator(
      '#room-actions [data-activity="Open task terminal"]',
    );
    assert.equal(await roomButton.isDisabled(), false);
    await page.click("#settingsbtn");
    await roomButton.scrollIntoViewIfNeeded();
    await roomButton.click();
    assert.equal(await page.evaluate(() => window.localRunOpens), 2);
    assert.equal(
      await page.evaluate(() => {
        window.savedDisconnectedSprite =
          officeScene.sprites["taskterminal-disconnected"];
        delete officeScene.sprites["taskterminal-disconnected"];
        officeScene.draw(0);
        return officeScene.taskTerminalSpriteKey();
      }),
      "taskterminal",
    );
    await clickProp(page, "taskterminal");
    assert.equal(
      await page.evaluate(() => window.localRunOpens),
      3,
      "missing state art still routes an enabled runner to Local runs",
    );
    await page.evaluate(() => {
      officeScene.sprites["taskterminal-disconnected"] =
        window.savedDisconnectedSprite;
      delete window.savedDisconnectedSprite;
    });
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("agent-office:task-runs", {
          detail: { enabled: false, connected: false, runs: [] },
        }),
      ),
    );
    await clickProp(page, "taskterminal");
    await page.waitForFunction(
      () => opened === "sheet-tasks" && taskMode === "reported",
    );
    assert.deepEqual(accounting(await state()), before);
  });
});

async function terminalPixels(page) {
  return page.evaluate(() => {
    const s = officeScene,
      t = s.transform,
      dpr = Math.min(devicePixelRatio, 2),
      b = s.resolvedFurniture.find(
        (item) => item.kind === "taskterminal",
      ).bounds,
      x = Math.floor((t.ox + b.x * t.scale) * dpr),
      y = Math.floor((t.oy + b.y * t.scale) * dpr),
      data = s.ctx.getImageData(
        x,
        y,
        Math.ceil(b.w * t.scale * dpr),
        Math.ceil(b.h * t.scale * dpr),
      ).data;
    let hash = 2166136261;
    for (const byte of data) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    return hash;
  });
}

test("reduced motion keeps the running task console steady", async () => {
  await observerFixture(
    { events, settings, reducedMotion: "reduce" },
    async ({ page }) => {
      await place(page, "taskterminal");
      await page.evaluate(() =>
        window.dispatchEvent(
          new CustomEvent("agent-office:task-runs", {
            detail: {
              enabled: true,
              connected: true,
              runs: [{ status: "running", created_at: 1 }],
            },
          }),
        ),
      );
      assert.equal(await page.evaluate(() => officeScene.paused), true);
      const frame = await terminalPixels(page);
      await page.waitForTimeout(800);
      assert.equal(await terminalPixels(page), frame);
    },
  );
});

async function pixels(page) {
  return page.evaluate(() => {
    const s = officeScene,
      t = s.transform,
      dpr = Math.min(devicePixelRatio, 2),
      result = {};
    for (const key of ["taskterminal", "statusbeacon"]) {
      const b = s.resolvedFurniture.find((p) => p.kind === key).bounds;
      const x = Math.floor((t.ox + b.x * t.scale) * dpr),
        y = Math.floor((t.oy + b.y * t.scale) * dpr);
      const data = s.ctx.getImageData(
        x,
        y,
        Math.ceil(b.w * t.scale * dpr),
        Math.ceil(b.h * t.scale * dpr),
      ).data;
      let hash = 2166136261;
      for (const byte of data) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
      result[key] = hash;
      if (key === "statusbeacon") {
        const px = Math.floor(
          (t.ox + (Math.round(b.x + b.w * 0.4) + 1.5) * t.scale) * dpr,
        );
        const py = Math.floor(
          (t.oy + (Math.round(b.y + b.h * 0.2) + 1.5) * t.scale) * dpr,
        );
        result.light =
          "#" +
          [...s.ctx.getImageData(px, py, 1, 1).data]
            .slice(0, 3)
            .map((v) => v.toString(16).padStart(2, "0"))
            .join("");
      }
    }
    return { ...result, time: s.time, connected: s.observerConnected };
  });
}
async function waitForLight(page, colors) {
  const deadline = Date.now() + 2000;
  let frame;
  do {
    frame = await pixels(page);
    if (colors.includes(frame.light)) return frame;
    await page.waitForTimeout(40);
  } while (Date.now() < deadline);
  assert.ok(
    colors.includes(frame.light),
    "The actual rendered light reaches " + colors.join(" or "),
  );
}

test("beacon light follows actual waiting observations and disconnection; Pause freezes its pulse and the task cursor", async () => {
  await observerFixture({ events, settings }, async ({ page, publish }) => {
    await place(page, "taskterminal");
    await place(page, "statusbeacon");
    assert.equal(
      (await pixels(page)).light,
      "#8c989b",
      "Connected alone is neutral, not a healthy-green claim",
    );
    publish([
      {
        event: "approval_request",
        session_id: "signals-planning",
        platform: "opencode",
        request_id: "release-permission",
        command: "Review the release",
      },
    ]);
    await page.waitForFunction(
      () =>
        officeScene.agents.find((agent) => agent.id === "signals-planning")
          ?.status === "waiting",
    );
    await waitForLight(page, ["#f3c17b", "#d99d5c"]);
    const active = [];
    for (let i = 0; i < 8; i++) {
      active.push(await pixels(page));
      await page.waitForTimeout(130);
    }
    assert.ok(
      active.every((frame) => ["#f3c17b", "#d99d5c"].includes(frame.light)),
    );
    assert.equal(
      new Set(active.map((frame) => frame.light)).size,
      2,
      "Actual beacon pixels pulse while a request is waiting",
    );
    assert.ok(
      new Set(active.map((frame) => frame.taskterminal)).size >= 2,
      "The rendered terminal cursor animates",
    );
    await page.click("#pausebtn");
    const paused = await pixels(page);
    await page.waitForTimeout(800);
    assert.deepEqual(
      await pixels(page),
      paused,
      "Paused scene time and both prop pixel crops remain unchanged",
    );
    await page.route("**/state", (route) => route.abort());
    await page.waitForFunction(
      () => offline && officeScene.observerConnected === false,
    );
    assert.equal(
      (await pixels(page)).light,
      "#8c989b",
      "A stale waiting agent does not light a disconnected beacon",
    );
    await page.unroute("**/state");
    await page.waitForFunction(() => !offline && officeScene.observerConnected);
    await waitForLight(page, ["#f3c17b", "#d99d5c"]);
    publish([
      {
        event: "approval_response",
        session_id: "signals-planning",
        platform: "opencode",
        request_id: "release-permission",
        choice: "allow",
      },
    ]);
    await page.waitForFunction(
      () =>
        officeScene.agents.find((agent) => agent.id === "signals-planning")
          ?.status === "working",
    );
    await waitForLight(page, ["#8c989b"]);
    fs.mkdirSync(reports, { recursive: true });
    fs.writeFileSync(
      path.join(reports, "beacon-pixels.json"),
      JSON.stringify({ active, paused, resolved: await pixels(page) }, null, 2),
    );
  });
});

async function advanceRenderedPetToBed(page) {
  return page.evaluate(() => {
    const s = officeScene;
    cancelAnimationFrame(s.frame);
    const result = {
      mode: "accelerated-render-steps",
      stepSeconds: 1 / 30,
      steps: 0,
      distance: 0,
      modes: [],
      samples: [],
      collisions: [],
      nap: null,
    };
    const modes = new Set();
    let previous = null;
    try {
      for (let step = 0; step < 2700; step++) {
        s.time += 1 / 30;
        s.draw(1 / 30);
        result.steps++;
        const pet = s.petViews.find((pet) => pet.key === "cat");
        if (!pet) continue;
        modes.add(pet.mode);
        if (previous)
          result.distance += Math.hypot(pet.x - previous.x, pet.y - previous.y);
        previous = { x: pet.x, y: pet.y };
        const beds = new Set(
          s.resolvedFurniture
            .filter((item) => item.kind === "petbed")
            .map((item) => item.bounds),
        );
        const blocked = [
          ...s.navigationProps.filter((bounds) => !beds.has(bounds)),
          ...s.furnitureObstacles,
        ];
        for (const b of blocked)
          if (
            pet.x + 4.5 > b.x &&
            pet.x - 4.5 < b.x + b.w &&
            pet.y > b.y &&
            pet.y - 15 < b.y + b.h
          ) {
            if (result.collisions.length < 5)
              result.collisions.push({ pet: { ...pet }, blocked: b });
          }
        if (step % 30 === 0)
          result.samples.push({ x: pet.x, y: pet.y, mode: pet.mode });
        if (pet.mode === "sleep" && !pet.moving && pet.bed_id) {
          const bed = s.resolvedFurniture.find(
            (item) => item.kind === "petbed",
          )?.bounds;
          result.nap = {
            ...pet,
            target: bed
              ? { x: bed.x + bed.w / 2, y: bed.y + bed.h / 2 + 3 }
              : null,
          };
          break;
        }
      }
    } finally {
      s.last = performance.now();
      s.painted = s.last;
      s.frame = requestAnimationFrame((time) => s.tick(time));
    }
    result.modes = [...modes];
    result.simulatedSeconds = result.steps / 30;
    return result;
  });
}
async function selectBedForEdit(page) {
  await page.click("#settingsbtn");
  await page.click("#edit-furniture");
  const point = await propPoint(page, "petbed");
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(
    () =>
      officeScene.movingIndex !== null &&
      settings.furniture[officeScene.movingIndex]?.kind === "petbed",
  );
}

test("native pet motion reaches a placed bed through collision-safe rendered frames (accelerated naps), and moving or removing the bed releases it", async () => {
  await observerFixture(
    { events, settings: { ...settings, show_pets: true, pets_roam: true } },
    async ({ page, state }) => {
      const before = accounting(await state());
      await place(page, "petbed");
      await place(page, "fern");
      const origin = await page.evaluate(() => ({
        ...officeScene.petViews.find((pet) => pet.key === "cat"),
      }));
      assert.ok(origin.key);
      await page.waitForFunction(
        (origin) => {
          const pet = officeScene.petViews.find((pet) => pet.key === "cat");
          return pet && Math.hypot(pet.x - origin.x, pet.y - origin.y) > 4;
        },
        origin,
        { timeout: 12000 },
      );
      const first = await advanceRenderedPetToBed(page);
      assert.deepEqual(
        first.collisions,
        [],
        "Every accelerated rendered frame clears all non-bed props and desks",
      );
      assert.ok(
        first.distance > 5 && first.modes.includes("bed"),
        "The pet travels to the bed instead of teleporting",
      );
      assert.ok(
        first.nap,
        "A reachable placed bed is selected within 90 simulated seconds",
      );
      assert.ok(
        Math.hypot(
          first.nap.x - first.nap.target.x,
          first.nap.y - first.nap.target.y,
        ) < 0.01,
      );
      await page.click("#pausebtn");
      await capture(page, "pet-nap-desktop");
      const oldBed = await page.evaluate(() =>
        JSON.stringify(
          settings.furniture.find((item) => item.kind === "petbed"),
        ),
      );
      await selectBedForEdit(page);
      const destination = await freePoint(page, { x: 0.25, y: 0.65 }, 45);
      assert.ok(destination, "A distinct free location for the bed");
      await page.mouse.click(destination.x, destination.y);
      await page.waitForFunction(
        (old) =>
          pendingSaves === 0 &&
          JSON.stringify(
            settings.furniture.find((item) => item.kind === "petbed"),
          ) !== old &&
          officeScene.petViews.find((pet) => pet.key === "cat")?.bed_id ===
            null,
        oldBed,
      );
      assert.equal(
        await page.evaluate(
          () => officeScene.petViews.find((pet) => pet.key === "cat")?.bed_id,
        ),
        null,
      );
      await page.click("#finish-furniture");
      await page.click("#pausebtn");
      const moved = await advanceRenderedPetToBed(page);
      assert.deepEqual(moved.collisions, []);
      assert.ok(moved.nap, "The moved bed remains a reachable rest target");
      assert.notEqual(moved.nap.bed_id, first.nap.bed_id);
      await page.click("#pausebtn");
      await selectBedForEdit(page);
      await page.locator("#c").press("Delete");
      await page.waitForFunction(
        () =>
          pendingSaves === 0 &&
          !settings.furniture.some((item) => item.kind === "petbed") &&
          !officeScene.resolvedFurniture.some(
            (item) => item.kind === "petbed",
          ) &&
          officeScene.petViews.find((pet) => pet.key === "cat")?.bed_id ===
            null,
      );
      const removed = await page.evaluate(() => ({
        ...officeScene.petViews.find((pet) => pet.key === "cat"),
      }));
      assert.equal(removed.bed_id, null);
      assert.equal(removed.mode, "rest");
      await page.click("#finish-furniture");
      assert.deepEqual(accounting(await state()), before);
      fs.mkdirSync(reports, { recursive: true });
      fs.writeFileSync(
        path.join(reports, "pet-bed-render-steps.json"),
        JSON.stringify(
          { nativeMotionVerified: true, first, moved, removed },
          null,
          2,
        ),
      );
    },
  );
});
