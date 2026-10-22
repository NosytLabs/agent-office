const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { observerFixture } = require("./observer-fixture.cjs");

async function capture(page, name) {
  const directory =
    process.env.OFFICE_SCREENSHOTS || "reports/studio-environment";
  fs.mkdirSync(directory, { recursive: true });
  await page.screenshot({
    path: path.join(directory, `${name}.png`),
    fullPage: true,
  });
}

async function openCustomize(page) {
  if (!(await page.locator("#sheet-settings").isVisible()))
    await page.click("#settingsbtn");
}

async function ready(page) {
  await page.waitForFunction(
    () => window.officeStudio?.ready && !officeStudio.loading,
  );
  assert.equal(
    await page.evaluate(() => officeStudio.environmentError),
    "",
    "Optional environment artwork must load",
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      pets: officeStudio.petDirectional.size,
      surfaces: officeStudio.surfaces.size,
    })),
    { pets: 96, surfaces: 4 },
  );
  await page.waitForFunction(() => window.officeStudioTools?.frames);
}

const accounting = (state) => ({
  progress: state.progress,
  usage: state.usage,
  events: state.events,
});

test("all 96 companion frames keep their native footprint, baseline and distinct directions", async () => {
  await observerFixture({}, async ({ page }) => {
    await ready(page);
    const inventory = await page.evaluate(() => {
      const groups = [];
      for (let actor = 0; actor < 8; actor++) {
        const directions = [];
        for (const direction of ["down", "up", "right", "left"]) {
          const frames = ["idle", "walk-a", "walk-b"].map((pose) => {
            const key = `pet-${actor}-${direction}-${pose}`,
              canvas = officeStudio.petDirectional.get(key),
              rgba = canvas.getContext("2d").getImageData(0, 0, 28, 26).data;
            let left = 28,
              right = -1,
              top = 26,
              bottom = -1;
            for (let i = 3; i < rgba.length; i += 4) {
              // The preserved generated artwork has alpha up to 254, not 255.
              if (rgba[i] < 160) continue;
              const pixel = (i - 3) / 4,
                x = pixel % 28,
                y = Math.floor(pixel / 28);
              left = Math.min(left, x);
              right = Math.max(right, x);
              top = Math.min(top, y);
              bottom = Math.max(bottom, y);
            }
            return {
              key,
              width: canvas.width,
              height: canvas.height,
              left,
              right,
              top,
              bottom,
              pixels: canvas.toDataURL(),
            };
          });
          directions.push(frames);
        }
        groups.push(directions);
      }
      return { count: officeStudio.petDirectional.size, groups };
    });
    assert.equal(inventory.count, 96);
    for (const directions of inventory.groups) {
      assert.equal(
        new Set(directions.map((frames) => frames[0].pixels)).size,
        4,
        "Every companion needs four actual directional views",
      );
      for (const frames of directions) {
        assert.equal(
          new Set(frames.map((frame) => frame.pixels)).size,
          3,
          frames[0].key,
        );
        for (const frame of frames) {
          assert.equal(frame.width, 28, frame.key);
          assert.equal(frame.height, 26, frame.key);
          assert.equal(
            frame.bottom,
            24,
            JSON.stringify(frame, ["key", "bottom"]),
          );
          assert.ok(
            frame.left >= 2 &&
              frame.right <= 25 &&
              frame.top >= 2 &&
              frame.right >= frame.left &&
              frame.bottom >= frame.top,
            JSON.stringify(frame, ["key", "left", "right", "top", "bottom"]),
          );
        }
      }
    }
  });
});

test("scene companions follow real travel and pause their heading without a second mirror", async () => {
  await observerFixture({}, async ({ page, state }) => {
    await ready(page);
    const before = accounting(await state());
    const drawn = await page.evaluate(() => {
      const scene = officeScene,
        original = {
          ctx: scene.ctx,
          paused: scene.paused,
          geometry: scene.geometry,
          petActive: scene.petActive,
          petHits: scene.petHits,
        },
        canvas = document.createElement("canvas"),
        selected = [];
      canvas.width = canvas.height = 180;
      scene.ctx = canvas.getContext("2d");
      scene.geometry = {};
      scene.petActive = null;
      scene.petHits = [];
      const draw = scene.ctx.drawImage.bind(scene.ctx);
      scene.ctx.drawImage = (image, ...args) => {
        const key = [...officeStudio.petDirectional].find(
          ([, source]) => source === image,
        )?.[0];
        if (key)
          selected.push({
            key,
            mirror: scene.ctx.getTransform().a,
            size: args.slice(-2),
          });
        return draw(image, ...args);
      };
      try {
        scene.paused = false;
        scene.pet(100, 100, false, { moving: false, facing: 1 });
        scene.pet(100, 103, false, { moving: true, facing: -1 });
        scene.pet(100, 100, false, { moving: true, facing: 1 });
        scene.pet(103, 100, false, { moving: true, facing: -1 });
        scene.pet(100, 100, false, { moving: true, facing: -1 });
        scene.paused = true;
        scene.pet(100, 97, false, { moving: true, facing: 1 });
      } finally {
        Object.assign(scene, original);
      }
      return selected;
    });
    assert.equal(drawn.length, 5);
    for (const [index, suffix] of [
      "down-walk-a",
      "up-walk-b",
      "right-walk-a",
      "left-idle",
      "left-idle",
    ].entries()) {
      assert.match(drawn[index].key, new RegExp(`-${suffix}$`));
      assert.equal(drawn[index].mirror, 1, drawn[index].key);
      assert.deepEqual(drawn[index].size, [20, 19]);
    }
    assert.deepEqual(accounting(await state()), before);
  });
});

async function finishState(page) {
  return page.evaluate(() => {
    const scene = officeScene,
      fills = [],
      fill = scene.ctx.fillRect.bind(scene.ctx);
    scene.ctx.fillRect = (...args) => {
      if (
        (args[0] === 4 && args[1] === 28 && args[2] === scene.grid.w - 8) ||
        (args[0] === 3 &&
          args[1] === 3 &&
          args[2] === scene.grid.w - 6 &&
          args[3] === 23)
      )
        fills.push({
          area: args[0] === 4 ? "floor" : "wall",
          pattern: scene.ctx.fillStyle instanceof CanvasPattern,
        });
      return fill(...args);
    };
    try {
      scene.draw(0);
    } finally {
      scene.ctx.fillRect = fill;
    }
    const finish = officeStudio.prefs.finish;
    return {
      finish,
      art: document.documentElement.dataset.officeArt,
      surfaces: scene.roomSurfaces
        ? {
            floor:
              scene.roomSurfaces.floor ===
              officeStudio.surfaces.get(`surface-${finish}-floor`),
            wall:
              scene.roomSurfaces.wall ===
              officeStudio.surfaces.get(`surface-${finish}-wall`),
          }
        : null,
      fills,
    };
  });
}

test("room finishes persist locally and original artwork restores the theme without observer writes", async () => {
  await observerFixture({}, async ({ page, state }) => {
    await ready(page);
    const before = accounting(await state()),
      writes = [];
    page.on("request", (request) => {
      if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method()))
        writes.push(request.url());
    });
    for (const finish of ["oak", "slate", "classic"]) {
      await openCustomize(page);
      await page.selectOption("#studio-room-finish", finish);
      const rendered = await finishState(page);
      assert.equal(rendered.finish, finish);
      assert.deepEqual(
        rendered.surfaces,
        finish === "classic" ? null : { floor: true, wall: true },
      );
      assert.deepEqual(
        rendered.fills,
        ["floor", "wall"].map((area) => ({
          area,
          pattern: finish !== "classic",
        })),
      );
      await page.reload();
      await ready(page);
      assert.equal(await page.inputValue("#studio-room-finish"), finish);
      assert.equal((await finishState(page)).finish, finish);
      if (await page.locator("#sheet-settings").isVisible())
        await page.locator("#sheet-settings .close").click();
      await capture(page, `room-finish-${finish}`);
    }
    await openCustomize(page);
    await page.selectOption("#studio-room-finish", "slate");
    await page.selectOption("#studio-art-choice", "classic");
    const original = await finishState(page);
    assert.equal(original.art, "classic");
    assert.equal(original.surfaces, null);
    assert.ok(original.fills.every((fill) => !fill.pattern));
    await page.reload();
    await ready(page);
    assert.equal(await page.inputValue("#studio-art-choice"), "classic");
    assert.equal(await page.inputValue("#studio-room-finish"), "slate");
    assert.equal((await finishState(page)).surfaces, null);
    await openCustomize(page);
    await page.selectOption("#studio-art-choice", "studio");
    assert.deepEqual((await finishState(page)).surfaces, {
      floor: true,
      wall: true,
    });
    assert.deepEqual(writes, []);
    assert.deepEqual(accounting(await state()), before);
  });
});

test("the companion gallery exports the selected four-frame native strip", async () => {
  await observerFixture(
    { viewport: { width: 320, height: 760 } },
    async ({ page, state }) => {
      await ready(page);
      const before = accounting(await state());
      await page.click("#settingsbtn");
      await page.locator("#studio-gallery summary").click();
      await page.selectOption("#studio-sprite-group", "companions");
      await page.fill("#studio-sprite-search", "pet 0 up");
      assert.equal(
        await page.locator("#studio-sprite-choice option").count(),
        3,
      );
      await page.selectOption("#studio-sprite-choice", "pet-0-up-idle");
      const pending = page.waitForEvent("download");
      await page.click("#studio-strip-download");
      const download = await pending,
        png = fs.readFileSync(await download.path());
      assert.equal(
        download.suggestedFilename(),
        "agent-office-pet-0-up-idle-strip.png",
      );
      assert.equal(png.subarray(1, 4).toString(), "PNG");
      assert.equal(png.readUInt32BE(16), 112);
      assert.equal(png.readUInt32BE(20), 26);
      const matches = await page.evaluate(async (base64) => {
        const image = new Image();
        image.src = "data:image/png;base64," + base64;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 112;
        canvas.height = 26;
        const g = canvas.getContext("2d", { willReadFrequently: true });
        g.drawImage(image, 0, 0);
        return ["idle", "walk-a", "walk-b", "walk-a"].map((pose, i) => {
          const actual = g.getImageData(i * 28, 0, 28, 26).data,
            expected = officeStudio.petDirectional
              .get(`pet-0-up-${pose}`)
              .getContext("2d")
              .getImageData(0, 0, 28, 26).data;
          return actual.every((value, index) => value === expected[index]);
        });
      }, png.toString("base64"));
      assert.deepEqual(matches, [true, true, true, true]);
      assert.equal(
        await page
          .locator("#sheet-settings")
          .evaluate((element) => element.scrollWidth > element.clientWidth),
        false,
      );
      await page
        .locator("#studio-sprite-preview")
        .evaluate((element) => element.scrollIntoView({ block: "center" }));
      await capture(page, "companion-strip-gallery-320");
      assert.deepEqual(accounting(await state()), before);
    },
  );
});

test("missing room and companion artwork keeps the base set and retries without losing drafts", async () => {
  await observerFixture({}, async ({ page, state }) => {
    await ready(page);
    const routes = ["**/studio/room-surfaces.png*", "**/studio/pet-walk.png*"];
    for (const route of routes)
      await page.route(route, (request) =>
        request.fulfill({ status: 404, body: "missing optional artwork" }),
      );
    await page.reload();
    await page.waitForFunction(
      () =>
        window.officeStudio?.ready &&
        !officeStudio.loading &&
        officeStudio.environmentError,
    );
    assert.deepEqual(
      await page.evaluate(() => ({
        base: officeStudio.sprites.size,
        people: officeStudio.directional.size,
        pets: officeStudio.petDirectional.size,
        life: officeStudio.petLife.size,
        surfaces: officeStudio.surfaces.size,
        floor: !!officeScene.roomSurfaces?.floor,
        wall: !!officeScene.roomSurfaces?.wall,
      })),
      {
        base: 197,
        people: 96,
        pets: 0,
        life: 96,
        surfaces: 0,
        floor: false,
        wall: false,
      },
    );
    assert.ok((await finishState(page)).fills.every((fill) => !fill.pattern));
    await page.click("#tasksbtn");
    await page.click('[data-task-view="draft"]');
    await page.fill("#task-draft-text", "Keep this unsent environment brief.");
    await page.locator("#sheet-tasks .close").click();
    await page.click("#settingsbtn");
    await page.fill("#room-name-input", "Unsaved environment draft");
    assert.equal(await page.locator("#studio-art-retry").isVisible(), true);
    const before = accounting(await state());
    await page.evaluate(() => {
      window.__environmentDocument = true;
    });
    for (const route of routes) await page.unroute(route);
    await page.click("#studio-art-retry");
    await ready(page);
    assert.equal(await page.evaluate(() => window.__environmentDocument), true);
    assert.equal(
      await page.inputValue("#room-name-input"),
      "Unsaved environment draft",
    );
    assert.equal(await page.locator("#studio-art-retry").isHidden(), true);
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "studio-art-status",
    );
    assert.equal(
      await page.locator("#studio-sprite-choice option").count(),
      734,
    );
    await page.locator("#sheet-settings .close").click();
    await page.click("#tasksbtn");
    await page.click('[data-task-view="draft"]');
    assert.equal(
      await page.inputValue("#task-draft-text"),
      "Keep this unsent environment brief.",
    );
    assert.deepEqual(accounting(await state()), before);
  });
});
