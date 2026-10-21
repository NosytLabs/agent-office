const { test } = require("node:test");
const assert = require("node:assert/strict");
const { observerFixture } = require("./observer-fixture.cjs");

test("missing prop animation keeps the Studio arcade pixels intact and Original effects available", async () => {
  await observerFixture({}, async ({ page, state }) => {
    await page.waitForFunction(
      () => officeStudio.ready && !officeStudio.loading,
    );
    const before = await state();
    await page.route("**/studio/prop-life.json", (route) =>
      route.fulfill({ status: 404, body: "missing" }),
    );
    await page.evaluate(() => officeStudio.reload());
    const samples = await page.evaluate(() => {
      const s = officeScene,
        art = officeStudio,
        mode = art.prefs.art,
        saved = {
          ctx: s.ctx,
          rect: s.rect,
          time: s.time,
          propHits: s.propHits,
        },
        canvas = document.createElement("canvas"),
        out = [];
      canvas.width = canvas.height = 120;
      try {
        s.ctx = canvas.getContext("2d");
        s.time = 0.75;
        s.propHits = [];
        for (const selected of ["studio", "classic"]) {
          art.prefs.art = selected;
          const rectangles = [],
            images = [];
          s.rect = (...args) => rectangles.push(args);
          s.ctx.drawImage = (image, ...args) =>
            images.push({ native: image === art.sprites.get("arcade"), args });
          s.prop("arcade", 30, 30, 24, 34);
          out.push({ selected, rectangles, images });
        }
      } finally {
        Object.assign(s, saved);
        art.prefs.art = mode;
      }
      return { out, frames: art.propLife.size };
    });
    assert.equal(samples.frames, 0);
    assert.equal(samples.out[0].images[0].native, true);
    assert.deepEqual(samples.out[0].images[0].args, [30, 30, 24, 34]);
    assert.deepEqual(
      samples.out[0].rectangles,
      [],
      "Fallback must not overpaint the Studio screen and marquee",
    );
    assert.ok(
      samples.out[1].rectangles.length >= 4,
      "Original retains its screen effects",
    );
    const after = await state();
    for (const key of ["events", "usage", "progress"])
      assert.deepEqual(after[key], before[key]);
  });
});

test("Studio and Original characters fade by the same observed lifecycle age", async () => {
  await observerFixture({}, async ({ page }) => {
    await page.waitForFunction(
      () => officeStudio.ready && !officeStudio.loading,
    );
    const samples = await page.evaluate(() => {
      const s = officeScene,
        art = officeStudio,
        mode = art.prefs.art,
        saved = {
          ctx: s.ctx,
          time: s.time,
          stateAtTime: s.stateAtTime,
          paused: s.paused,
          cosmetics: s.cosmetics,
        },
        canvas = document.createElement("canvas"),
        out = [];
      canvas.width = canvas.height = 120;
      try {
        s.ctx = canvas.getContext("2d");
        s.time = 20;
        s.stateAtTime = 19;
        s.paused = true;
        s.cosmetics = [];
        for (const selected of ["classic", "studio"]) {
          art.prefs.art = selected;
          for (const status of ["gone", "done"])
            for (const idle_s of [0, 10, 19, 115, 121]) {
              let alpha;
              s.ctx.drawImage = () => {
                alpha = s.ctx.globalAlpha;
              };
              s.character({ id: "fade-audit", status, idle_s }, 30, 30, {
                moving: false,
              });
              out.push({ selected, status, idle_s, alpha });
            }
        }
      } finally {
        Object.assign(s, saved);
        art.prefs.art = mode;
      }
      return out;
    });
    for (let i = 0; i < 10; i++) {
      assert.ok(Number.isFinite(samples[i].alpha));
      assert.equal(
        samples[i + 10].alpha,
        samples[i].alpha,
        JSON.stringify(samples[i]),
      );
    }
    assert.ok(samples[0].alpha > samples[1].alpha);
    assert.ok(samples[5].alpha > samples[8].alpha);
  });
});

async function gallery(page) {
  await page.waitForFunction(
    () =>
      window.officeStudioTools &&
      window.officeStudio?.ready &&
      !officeStudio.loading,
  );
  await page.click("#settingsbtn");
  await page.locator("#studio-gallery summary").click();
}

test("optional manifests finish before large image downloads compete for connections", async () => {
  await observerFixture({}, async ({ page }) => {
    await page.waitForFunction(
      () => officeStudio.ready && !officeStudio.loading,
    );
    let manifestReleased = false;
    const early = [];
    await page.route("**/studio/prop-life.json", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
      manifestReleased = true;
    });
    await page.route("**/studio/*.png", (route) => {
      if (!/\/studio-\d\.png$/.test(route.request().url()) && !manifestReleased)
        early.push(route.request().url());
      return route.continue();
    });
    await page.evaluate(() => officeStudio.reload());
    assert.deepEqual(
      early,
      [],
      "Large images must not starve the last small manifest",
    );
    assert.equal(await page.evaluate(() => officeStudio.propLife.size), 8);
    assert.equal(await page.evaluate(() => officeStudio.environmentError), "");
  });
});

test("native prop loops preserve their idle seed, baseline and actual render selection", async () => {
  await observerFixture({}, async ({ page }) => {
    await page.waitForFunction(
      () => officeStudioTools.frames && !officeStudio.loading,
    );
    const result = await page.evaluate(() => {
      const s = officeScene,
        canvas = document.createElement("canvas"),
        saved = {
          ctx: s.ctx,
          rect: s.rect,
          time: s.time,
          paused: s.paused,
          propHits: s.propHits,
          propReactions: s.propReactions,
        },
        groups = [],
        drawn = [],
        rects = [];
      for (const kind of ["arcade", "printer"]) {
        const frames = Array.from({ length: 4 }, (_, i) =>
          officeStudio.propLife.get(`${kind}-anim-${i}`),
        );
        groups.push({
          kind,
          seed:
            frames[0].toDataURL() ===
            officeStudio.sprites.get(kind).toDataURL(),
          frames: frames.map((c) => {
            const d = c
              .getContext("2d")
              .getImageData(0, 0, c.width, c.height).data;
            const seed = frames[0]
                .getContext("2d")
                .getImageData(0, 0, c.width, c.height).data,
              regions =
                kind === "arcade"
                  ? [[6, 10, 15, 10]]
                  : [
                      [7, 0, 10, 7],
                      [3, 9, 3, 3],
                    ];
            const stableBody = d.every((v, i) => {
              const x = Math.floor(i / 4) % c.width,
                y = Math.floor(i / 4 / c.width);
              return (
                regions.some(
                  ([rx, ry, w, h]) =>
                    x >= rx && x < rx + w && y >= ry && y < ry + h,
                ) || v === seed[i]
              );
            });
            let bottom = -1,
              fractional = false;
            for (let i = 3; i < d.length; i += 4) {
              if (d[i])
                bottom = Math.max(bottom, Math.floor((i - 3) / 4 / c.width));
              fractional ||= d[i] !== 0 && d[i] !== 255;
            }
            return {
              width: c.width,
              height: c.height,
              bottom,
              fractional,
              stableBody,
              png: c.toDataURL(),
            };
          }),
        });
      }
      canvas.width = canvas.height = 120;
      try {
        s.ctx = canvas.getContext("2d");
        s.rect = (...a) => rects.push(a);
        s.propHits = [];
        s.ctx.drawImage = (im) =>
          drawn.push(
            [...officeStudio.propLife].find(([, c]) => c === im)?.[0] ||
              "fallback",
          );
        s.time = 0.75;
        s.paused = false;
        s.propReactions = [];
        s.prop("arcade", 30, 30, 24, 34);
        s.prop("printer", 30, 30, 24, 24);
        s.propReactions = [{ kind: "printer", x: 30, y: 30, started: 0 }];
        s.prop("printer", 30, 30, 24, 24);
        s.paused = true;
        s.prop("arcade", 30, 30, 24, 34);
        s.prop("printer", 30, 30, 24, 24);
      } finally {
        Object.assign(s, saved);
      }
      return { groups, drawn, rects };
    });
    assert.deepEqual(result.drawn, [
      "arcade-anim-1",
      "printer-anim-0",
      "printer-anim-3",
      "arcade-anim-0",
      "printer-anim-0",
    ]);
    assert.deepEqual(
      result.rects,
      [],
      "Native arcade frames must not receive a second screen overlay",
    );
    for (const group of result.groups) {
      assert.equal(group.seed, true, group.kind);
      assert.ok(new Set(group.frames.map((f) => f.png)).size >= 3, group.kind);
      assert.equal(
        new Set(group.frames.map((f) => f.bottom)).size,
        1,
        group.kind,
      );
      for (const f of group.frames) {
        assert.equal(f.width, 24);
        assert.equal(f.height, group.kind === "arcade" ? 34 : 24);
        assert.equal(f.fractional, false);
        assert.equal(
          f.stableBody,
          true,
          "Furniture bodies remain pixel-identical between frames",
        );
      }
    }
  });
});

test("prop strips export exact native pixels in order", async () => {
  const fs = require("node:fs");
  await observerFixture({}, async ({ page }) => {
    await gallery(page);
    for (const kind of ["arcade", "printer"]) {
      await page.fill("#studio-sprite-search", kind + " anim");
      assert.equal(
        await page.locator("#studio-sprite-choice option").count(),
        4,
      );
      await page.selectOption("#studio-sprite-choice", kind + "-anim-2");
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.click("#studio-strip-download"),
      ]);
      const bytes = fs.readFileSync(await download.path()),
        height = kind === "arcade" ? 34 : 24;
      assert.equal(bytes.readUInt32BE(16), 96);
      assert.equal(bytes.readUInt32BE(20), height);
      assert.equal(
        await page.evaluate(
          async ({ base64, kind, height }) => {
            const i = new Image();
            i.src = "data:image/png;base64," + base64;
            await i.decode();
            const c = document.createElement("canvas"),
              r = document.createElement("canvas");
            c.width = r.width = 96;
            c.height = r.height = height;
            c.getContext("2d").drawImage(i, 0, 0);
            for (let frame = 0; frame < 4; frame++)
              r.getContext("2d").drawImage(
                officeStudio.propLife.get(`${kind}-anim-${frame}`),
                frame * 24,
                0,
              );
            const a = c.getContext("2d").getImageData(0, 0, 96, height).data,
              b = r.getContext("2d").getImageData(0, 0, 96, height).data;
            return a.every((v, n) => v === b[n]);
          },
          { base64: bytes.toString("base64"), kind, height },
        ),
        true,
      );
    }
  });
});

test("clearing sprite filters recovers from an empty category search and retains keyboard focus", async () => {
  await observerFixture({}, async ({ page }) => {
    await gallery(page);
    const total = await page.locator("#studio-sprite-choice option").count();
    await page.selectOption("#studio-sprite-group", "furniture");
    await page.fill("#studio-sprite-search", "no matching office prop");
    assert.equal(await page.locator("#studio-sprite-choice option").count(), 0);
    await page
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    assert.equal(await page.inputValue("#studio-sprite-search"), "");
    assert.equal(await page.inputValue("#studio-sprite-group"), "all");
    assert.equal(
      await page.locator("#studio-sprite-choice option").count(),
      total,
    );
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "studio-sprite-search",
    );
    assert.equal(
      await page.locator("#studio-sprite-download").isDisabled(),
      false,
    );
  });
});

test("missing prop artwork keeps static fallback and retry preserves drafts and accounting", async () => {
  await observerFixture({}, async ({ page, state }) => {
    await gallery(page);
    const before = await state();
    await page.fill("#room-name-input", "Keep this prop draft");
    await page.route("**/studio/prop-life.png", (r) =>
      r.fulfill({ status: 404, body: "missing" }),
    );
    await page.evaluate(() => officeStudio.reload());
    assert.equal(await page.evaluate(() => officeStudio.ready), true);
    assert.equal(await page.evaluate(() => officeStudio.propLife.size), 0);
    assert.equal(
      await page.evaluate(() => officeScene.propUsesSpriteDetails("arcade")),
      false,
    );
    await page.fill("#studio-sprite-search", "printer anim");
    assert.equal(await page.locator("#studio-sprite-choice option").count(), 0);
    assert.equal(
      await page.locator("#studio-strip-download").isDisabled(),
      true,
    );
    await page.unroute("**/studio/prop-life.png");
    await page.click("#studio-art-retry");
    await page.waitForFunction(
      () => !officeStudio.loading && officeStudio.propLife.size === 8,
    );
    assert.equal(await page.locator("#studio-sprite-choice option").count(), 4);
    assert.equal(
      await page.inputValue("#room-name-input"),
      "Keep this prop draft",
    );
    const after = await state();
    for (const key of ["events", "usage", "progress"])
      assert.deepEqual(after[key], before[key]);
  });
});

test("the placed printer opens latest Activity by pointer and keyboard without reporting work", async () => {
  await observerFixture(
    {
      viewport: { width: 390, height: 844 },
      events: [
        {
          event: "session_start",
          session_id: "printer-flow",
          platform: "codex",
        },
      ],
      settings: { furniture: [{ kind: "printer", x: 0.5, y: 0.6 }] },
    },
    async ({ page, state }) => {
      await page.waitForFunction(
        () => officeStudioTools.frames && !officeStudio.loading,
      );
      const before = await state();
      await page.locator("#c").scrollIntoViewIfNeeded();
      const point = await page.evaluate(() => {
        const s = officeScene;
        s.draw(0);
        const h = s.propHits.find((p) => p.kind === "printer"),
          r = s.canvas.getBoundingClientRect(),
          t = s.transform;
        return {
          x: r.x + t.ox + (h.x + h.w / 2) * t.scale,
          y: r.y + t.oy + (h.y + h.h / 2) * t.scale,
        };
      });
      await page.mouse.click(point.x, point.y);
      assert.equal(await page.locator("#sheet-events").isVisible(), true);
      assert.equal(
        await page.evaluate(() =>
          officeScene.propReactions.some((p) => p.kind === "printer"),
        ),
        true,
      );
      await page.keyboard.press("Escape");
      await page.click("#settingsbtn");
      const button = page.getByRole("button", {
        name: "Read activity at printer",
        exact: true,
      });
      await button.focus();
      await page.keyboard.press("Enter");
      assert.equal(await page.locator("#sheet-events").isVisible(), true);
      assert.equal(await page.evaluate(() => eventMode), "latest");
      const after = await state();
      for (const key of ["events", "usage", "progress"])
        assert.deepEqual(after[key], before[key]);
    },
  );
});

test("Studio prop animation owns its pixels while Original retains procedural details", async () => {
  await observerFixture({}, async ({ page }) => {
    await page.waitForFunction(
      () =>
        officeStudio.ready && !officeStudio.loading && officeStudioTools.frames,
    );
    const samples = await page.evaluate(() => {
      const s = officeScene,
        art = officeStudio,
        canvas = document.createElement("canvas"),
        saved = {
          ctx: s.ctx,
          rect: s.rect,
          text: s.text,
          time: s.time,
          cosmetics: s.cosmetics,
          propReactions: s.propReactions,
          propHits: s.propHits,
        },
        mode = art.prefs.art;
      canvas.width = canvas.height = 120;
      const out = [];
      try {
        s.ctx = canvas.getContext("2d");
        s.time = 0.75;
        s.cosmetics = [];
        for (const selected of ["studio", "classic"]) {
          art.prefs.art = selected;
          s.propHits = [];
          const rectangles = [],
            images = [];
          s.rect = (...args) => rectangles.push(args);
          s.text = () => {};
          s.propReactions = [{ kind: "robot", x: 30, y: 30, started: 0.5 }];
          s.ctx.drawImage = (image, ...args) =>
            images.push({
              frame: [...officeStudioTools.frames].find(
                ([, value]) => image === value,
              )?.[0],
              args,
            });
          s.prop("robot", 30, 30, 18, 28);
          out.push({ selected, rectangles, images, hits: s.propHits });
        }
      } finally {
        Object.assign(s, saved);
        art.prefs.art = mode;
      }
      return out;
    });
    assert.equal(samples[0].images[0].frame, "robot-anim-3");
    assert.equal(
      samples[0].rectangles.length,
      0,
      "Do not paint a second face over the Studio robot",
    );
    assert.ok(
      samples[1].rectangles.length >= 3,
      "Original artwork keeps its procedural wave/eyes",
    );
    assert.equal(samples[0].hits[0].kind, "robot");
  });
});

test("a Studio terminal retains its running lamp when native state artwork is unavailable", async () => {
  await observerFixture({}, async ({ page }) => {
    await page.waitForFunction(
      () =>
        officeStudio.ready && !officeStudio.loading && officeStudioTools.frames,
    );
    const sample = await page.evaluate(() => {
      const s = officeScene,
        canvas = document.createElement("canvas"),
        native = s.sprites["taskterminal-running"],
        saved = {
          ctx: s.ctx,
          rect: s.rect,
          time: s.time,
          propHits: s.propHits,
          taskRunner: s.taskRunner,
        },
        rectangles = [];
      canvas.width = canvas.height = 120;
      try {
        s.ctx = canvas.getContext("2d");
        s.time = 0.75;
        s.propHits = [];
        s.rect = (...args) => rectangles.push(args);
        s.taskRunner = {
          enabled: true,
          connected: true,
          runs: [{ status: "running" }],
        };
        delete s.sprites["taskterminal-running"];
        s.prop("taskterminal", 30, 30, 24, 34);
        return {
          key: s.taskTerminalSpriteKey(),
          rectangles,
          hits: s.propHits,
        };
      } finally {
        s.sprites["taskterminal-running"] = native;
        Object.assign(s, saved);
      }
    });
    assert.equal(sample.key, "taskterminal");
    assert.deepEqual(sample.rectangles, [
      [30 + 24 * 0.72, 30 + 34 * 0.12, 2, 2, "#568d84"],
    ]);
    assert.equal(sample.hits[0].kind, "taskterminal");
  });
});

test("watering a Studio plant keeps its pot anchored and selects its reaction frame", async () => {
  await observerFixture({}, async ({ page }) => {
    await page.waitForFunction(
      () =>
        officeStudio.ready && !officeStudio.loading && officeStudioTools.frames,
    );
    const sample = await page.evaluate(() => {
      const s = officeScene,
        canvas = document.createElement("canvas"),
        saved = {
          ctx: s.ctx,
          rect: s.rect,
          time: s.time,
          propReactions: s.propReactions,
          propHits: s.propHits,
        };
      canvas.width = canvas.height = 120;
      const out = [];
      try {
        s.ctx = canvas.getContext("2d");
        s.time = 0.75;
        s.propHits = [];
        s.rect = () => {};
        s.propReactions = [{ kind: "fern", x: 30, y: 30, started: 0.5 }];
        s.ctx.drawImage = (image, ...args) =>
          out.push({
            frame:
              [...officeStudioTools.frames].find(
                ([, value]) => image === value,
              )?.[0] || "static",
            args,
          });
        s.prop("fern", 30, 30, 26, 40);
      } finally {
        Object.assign(s, saved);
      }
      return out;
    });
    assert.equal(sample[0].frame, "fern-anim-3");
    assert.deepEqual(sample[0].args, [30, 42, 26, 28]);
  });
});

test("desk status marks share the character center and failed completions do not show a check", async () => {
  await observerFixture({}, async ({ page }) => {
    await page.waitForFunction(
      () =>
        officeStudio.ready && !officeStudio.loading && officeStudioTools.frames,
    );
    const samples = await page.evaluate(() => {
      const s = officeScene,
        canvas = document.createElement("canvas"),
        mode = officeStudio.prefs.art,
        saved = {
          ctx: s.ctx,
          text: s.text,
          character: s.character,
          paused: s.paused,
          grid: s.grid,
          propHits: s.propHits,
          hitBoxes: s.hitBoxes,
          walking: s.walking,
        };
      canvas.width = canvas.height = 200;
      const out = [];
      try {
        s.ctx = canvas.getContext("2d");
        s.paused = true;
        s.hitBoxes = [];
        s.walking = [];
        for (const selected of ["studio", "classic"])
          for (const [status, detail] of [
            ["waiting", ""],
            ["done", ""],
            ["done", "⚠ Synthetic failure"],
          ]) {
            officeStudio.prefs.art = selected;
            const seat = {
                x: 60,
                y: 60,
                a: { id: "status-marker", status, detail },
              },
              marks = [];
            let center;
            s.grid = { ...saved.grid, seats: [seat] };
            s.text = (text, x, y) => marks.push({ text, x, y });
            s.character = (a, x) => {
              center = x + 8;
            };
            s.desk(seat);
            out.push({ selected, status, detail, center, marks });
          }
      } finally {
        s.chars.delete("status-marker");
        Object.assign(s, saved);
        officeStudio.prefs.art = mode;
      }
      return out;
    });
    for (const sample of samples) {
      assert.equal(sample.marks[0].x, sample.center, JSON.stringify(sample));
      assert.equal(
        sample.marks[0].text,
        sample.detail ? "!" : sample.status === "waiting" ? "!" : "✓",
      );
    }
  });
});

for (const viewport of [
  { width: 320, height: 320 },
  { width: 320, height: 568 },
  { width: 568, height: 320 },
  { width: 600, height: 320 },
  { width: 667, height: 320 },
])
  test(`starting a sprite animation keeps its preview and Stop control visible at ${viewport.width}×${viewport.height}`, async () => {
    await observerFixture({ viewport }, async ({ page }) => {
      await gallery(page);
      await page.fill("#studio-sprite-search", "studio robot reading");
      await page.selectOption("#studio-sprite-choice", "person-4-read-anim-2");
      await page.click("#studio-preview-play");
      const geometry = await page.evaluate(() => {
        const panel = document.getElementById("sheet-settings"),
          header = panel.querySelector(".sheet-header").getBoundingClientRect(),
          bounds = panel.getBoundingClientRect();
        return ["studio-sprite-preview", "studio-preview-play"].map((id) => {
          const rect = document.getElementById(id).getBoundingClientRect();
          return {
            id,
            top: rect.top,
            bottom: rect.bottom,
            header: header.bottom,
            panel: bounds.bottom,
          };
        });
      });
      for (const rect of geometry) {
        assert.ok(rect.top >= rect.header, JSON.stringify(rect));
        assert.ok(rect.bottom <= rect.panel, JSON.stringify(rect));
      }
      assert.equal(
        await page.locator("#studio-preview-play").getAttribute("aria-pressed"),
        "true",
      );
      await page.click("#studio-preview-play");
      assert.equal(
        await page.locator("#studio-preview-play").getAttribute("aria-pressed"),
        "false",
      );
    });
  });

test("an older sprite export cannot overwrite feedback for the selected export", async () => {
  await observerFixture({}, async ({ page }) => {
    await gallery(page);
    await page.selectOption("#studio-sprite-choice", "person-0-down-idle");
    await page.evaluate(() => {
      window.__exports = [];
      window.__downloadNames = [];
      HTMLCanvasElement.prototype.toBlob = function (callback) {
        window.__exports.push(callback);
      };
      downloadBlob = (blob, name) => window.__downloadNames.push(name);
    });
    await page.click("#studio-sprite-download");
    await page.selectOption("#studio-sprite-choice", "person-0-down-walk-a");
    await page.click("#studio-sprite-download");
    await page.evaluate(() =>
      window.__exports[1](new Blob(["fixture"], { type: "image/png" })),
    );
    const message = await page.textContent("#studio-gallery-message");
    assert.match(message, /exported/);
    await page.evaluate(() => window.__exports[0](null));
    assert.equal(await page.textContent("#studio-gallery-message"), message);
    assert.deepEqual(await page.evaluate(() => window.__downloadNames), [
      "agent-office-person-0-down-walk-a.png",
    ]);
    await page.click("#studio-sprite-download");
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.__exports[2](null));
    assert.equal(await page.textContent("#studio-gallery-message"), message);
    await page.click("#settingsbtn");
    await page.click("#studio-sprite-download");
    await page.keyboard.press("Escape");
    await page.click("#settingsbtn");
    await page.evaluate(() => window.__exports[3](null));
    assert.equal(await page.textContent("#studio-gallery-message"), message);
    await page.click("#studio-sprite-download");
    await page.locator("#studio-gallery summary").click();
    await page.locator("#studio-gallery summary").click();
    await page.evaluate(() => window.__exports[4](null));
    assert.equal(await page.textContent("#studio-gallery-message"), message);
  });
});

test("the gallery distinguishes opaque room textures from transparent sprite exports", async () => {
  await observerFixture({}, async ({ page }) => {
    await gallery(page);
    await page.selectOption("#studio-sprite-choice", "surface-oak-floor");
    assert.match(await page.textContent("#studio-sprite-info"), /opaque PNG/);
    await page.selectOption("#studio-sprite-choice", "person-0-down-idle");
    assert.match(
      await page.textContent("#studio-sprite-info"),
      /transparent PNG/,
    );
  });
});

test("gallery searches use companion identity and expose friendly accessible labels", async () => {
  await observerFixture(
    { viewport: { width: 320, height: 760 } },
    async ({ page }) => {
      await gallery(page);
      for (const pet of [0, 1, 2, 3]) {
        await page.fill("#studio-sprite-search", `pet ${pet} happy anim`);
        assert.equal(
          await page.locator("#studio-sprite-choice option").count(),
          4,
        );
        assert.ok(
          (
            await page
              .locator("#studio-sprite-choice option")
              .evaluateAll((options) => options.map((option) => option.value))
          ).every((key) => key.startsWith(`pet-${pet}-happy-anim-`)),
        );
      }
      await page.fill("#studio-sprite-search", "orange cat happy anim");
      assert.equal(
        await page.locator("#studio-sprite-choice option").count(),
        4,
      );
      await page.selectOption("#studio-sprite-choice", "pet-0-happy-anim-2");
      assert.match(
        await page
          .locator("#studio-sprite-choice option:checked")
          .textContent(),
        /Orange cat.*Happy.*frame 3/i,
      );
      assert.match(
        await page.locator("#studio-sprite-preview").getAttribute("aria-label"),
        /Orange cat.*Happy.*frame 3/i,
      );
      await page.fill("#studio-sprite-search", "orange cat happy frame 3");
      assert.equal(
        await page.locator("#studio-sprite-choice option").count(),
        1,
      );
      assert.equal(
        await page.inputValue("#studio-sprite-choice"),
        "pet-0-happy-anim-2",
      );
      const download = page.waitForEvent("download");
      await page.click("#studio-sprite-download");
      assert.equal(
        (await download).suggestedFilename(),
        "agent-office-pet-0-happy-anim-2.png",
      );
      await page.fill("#studio-sprite-search", "studio robot reading");
      await page.selectOption("#studio-sprite-choice", "person-4-read");
      assert.match(
        await page
          .locator("#studio-sprite-choice option:checked")
          .textContent(),
        /Studio robot.*Reading/,
      );
      await page.fill("#studio-sprite-search", "no-such-sprite");
      for (const id of [
        "studio-preview-play",
        "studio-sprite-download",
        "studio-strip-download",
      ])
        assert.equal(await page.locator("#" + id).isDisabled(), true);
      assert.equal(
        await page.locator("#studio-sprite-preview").getAttribute("aria-label"),
        "No matching sprites",
      );
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "studio-sprite-search",
      );
      await page.keyboard.press("Shift+Tab");
      assert.equal(
        await page
          .locator("#studio-gallery summary")
          .evaluate((summary) => document.activeElement === summary),
        true,
      );
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "studio-sprite-search",
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    },
  );
});

test("character life families export native strips and leave no stale choices after optional failure", async () => {
  const fs = require("node:fs");
  await observerFixture({}, async ({ page, state }) => {
    await gallery(page);
    const before = await state(),
      total = await page.locator("#studio-sprite-choice option").count(),
      lifeCount = await page.evaluate(() => officeStudio.characterLife.size);
    for (const query of [
      "person 0 typing anim",
      "person 7 reading anim",
      "person 4 needs input anim",
    ]) {
      await page.fill("#studio-sprite-search", query);
      assert.equal(
        await page.locator("#studio-sprite-choice option").count(),
        4,
        query,
      );
    }
    await page.fill("#studio-sprite-search", "person 7 reading anim");
    await page.selectOption("#studio-sprite-choice", "person-7-read-anim-2");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#studio-strip-download"),
    ]);
    assert.equal(
      download.suggestedFilename(),
      "agent-office-person-7-read-anim-2-strip.png",
    );
    const bytes = fs.readFileSync(await download.path());
    assert.equal(bytes.readUInt32BE(16), 128);
    assert.equal(bytes.readUInt32BE(20), 36);
    assert.equal(
      await page.evaluate(async (base64) => {
        const image = new Image();
        image.src = "data:image/png;base64," + base64;
        await image.decode();
        const strip = document.createElement("canvas"),
          expected = document.createElement("canvas");
        strip.width = expected.width = 128;
        strip.height = expected.height = 36;
        strip.getContext("2d").drawImage(image, 0, 0);
        for (let frame = 0; frame < 4; frame++)
          expected
            .getContext("2d")
            .drawImage(
              officeStudio.characterLife.get(`person-7-read-anim-${frame}`),
              frame * 32,
              0,
            );
        const actual = strip.getContext("2d").getImageData(0, 0, 128, 36).data,
          source = expected.getContext("2d").getImageData(0, 0, 128, 36).data;
        return actual.every((value, index) => value === source[index]);
      }, bytes.toString("base64")),
      true,
    );
    await page.fill("#room-name-input", "Unsaved character gallery draft");
    await page.route("**/studio/character-life.png", (route) =>
      route.fulfill({ status: 404, body: "missing" }),
    );
    await page.evaluate(() => officeStudio.reload());
    assert.equal(await page.locator("#studio-sprite-choice option").count(), 0);
    assert.equal(
      await page.locator("#studio-sprite-download").isDisabled(),
      true,
    );
    await page.fill("#studio-sprite-search", "");
    assert.equal(
      await page.locator("#studio-sprite-choice option").count(),
      total - lifeCount,
    );
    await page.unroute("**/studio/character-life.png");
    await page.click("#studio-art-retry");
    await page.waitForFunction(
      () => officeStudio.ready && !officeStudio.loading,
    );
    assert.equal(
      await page.locator("#studio-sprite-choice option").count(),
      total,
    );
    assert.equal(
      await page.inputValue("#room-name-input"),
      "Unsaved character gallery draft",
    );
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "studio-art-status",
    );
    const after = await state();
    for (const key of ["progress", "usage", "events"])
      assert.deepEqual(after[key], before[key]);
  });
});
