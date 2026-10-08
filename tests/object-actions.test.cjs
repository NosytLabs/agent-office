const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { observerFixture } = require("./observer-fixture.cjs");

test("the live observer serves nested arcade media with correct types and unchanged bytes", async () => {
  await observerFixture({}, async ({ base }) => {
    for (const [relative, type] of [
      ["arcade/duck-hunt/index.html", "text/html; charset=utf-8"],
      ["arcade/duck-hunt/js/upstream.js", "application/javascript"],
      ["arcade/duck-hunt/js/game.js", "application/javascript"],
      ["arcade/duck-hunt/audio/gun-shot.mp3", "audio/mpeg"],
    ]) {
      const response = await fetch(`${base}/${relative}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), type);
      assert.equal(response.headers.get("access-control-allow-origin"), null);
      assert.deepEqual(
        Buffer.from(await response.arrayBuffer()),
        fs.readFileSync(path.join(__dirname, "../web", relative)),
      );
    }
    const state = await fetch(base + "/state", { headers: { Origin: "null" } });
    assert.equal(state.headers.get("access-control-allow-origin"), null);
  });
});

async function clickProp(page, kind) {
  const point = await page.evaluate((kind) => {
    const scene = window.officeScene;
    scene.draw(0);
    const prop = scene.propHits.find((item) => item.kind === kind);
    if (!prop) return null;
    const box = scene.canvas.getBoundingClientRect();
    const { scale, ox, oy } = scene.transform;
    return {
      x: box.x + ox + (prop.x + prop.w / 2) * scale,
      y: box.y + oy + (prop.y + prop.h / 2) * scale,
    };
  }, kind);
  assert.ok(point, `${kind} has a reachable interaction target`);
  await page.mouse.click(point.x, point.y);
}

test("a lamp switches room lighting, persists through reload, and is keyboard accessible", async () => {
  await observerFixture(
    {
      events: [
        { event: "session_start", platform: "claude", session_id: "lights" },
      ],
    },
    async ({ page, base }) => {
      await page.locator("#pausebtn").click();
      const before = await page.locator("#c").screenshot();
      await clickProp(page, "lamp");
      await page.waitForFunction(
        () => settings.room_lights === false && pendingSaves === 0,
      );
      const saved = await (await fetch(base + "/settings")).json();
      assert.equal(saved.room_lights, false);
      const after = await page.locator("#c").screenshot();
      assert.notDeepEqual(
        after,
        before,
        "the switch changes the rendered floor",
      );
      const directory = path.join(__dirname, "../reports/object-actions");
      fs.mkdirSync(directory, { recursive: true });
      await page.screenshot({
        path: path.join(directory, "lights-off.png"),
        fullPage: true,
      });
      await page.reload();
      await page.waitForFunction(() => initialized && settingsReady);
      assert.equal(await page.evaluate(() => settings.room_lights), false);
      await page.locator("#room-lights").focus();
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        () => settings.room_lights === true && pendingSaves === 0,
      );
      assert.equal(
        await page.locator("#room-lights").getAttribute("aria-pressed"),
        "true",
      );
    },
  );
});

test("coffee, water and plants react without changing observer work progress", async () => {
  await observerFixture(
    {
      events: [
        { event: "session_start", platform: "claude", session_id: "props" },
      ],
    },
    async ({ page, state }) => {
      const before = (await state()).progress;
      for (const kind of ["coffee", "cooler", "monstera"]) {
        await clickProp(page, kind);
        assert.ok(
          await page.evaluate(
            (kind) =>
              officeScene.propReactions.some((entry) => entry.kind === kind),
            kind,
          ),
        );
      }
      const after = (await state()).progress;
      assert.equal(after.xp, before.xp);
      await page.locator("#pausebtn").click();
      const time = await page.evaluate(() => officeScene.time);
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => officeScene.time), time);
      await page.locator("#settingsbtn").click();
      await page.locator('[data-activity="Brew coffee"]').click();
      assert.equal(await page.locator("#sheet-settings").isVisible(), false);
      assert.match(await page.locator("#toast").textContent(), /coffee/i);
    },
  );
});

test("wall switch and mobile controls remain usable with room decorations hidden", async () => {
  await observerFixture(
    {
      viewport: { width: 320, height: 740 },
      settings: { decorations: false, room_lights: false },
    },
    async ({ page }) => {
      await clickProp(page, "light_switch");
      await page.waitForFunction(
        () => settings.room_lights === true && pendingSaves === 0,
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      for (const id of ["arcade-open", "room-lights"]) {
        const box = await page.locator("#" + id).boundingBox();
        assert.ok(box.width >= 44 && box.height >= 44);
      }
      await page.locator("#settingsbtn").click();
      assert.equal(
        await page.locator('[data-activity="Brew coffee"]').isDisabled(),
        true,
      );
      assert.equal(
        await page.locator('[data-activity="Switch room lights"]').isDisabled(),
        false,
      );
    },
  );
});

test("both new characters render complete animation frames and save as individual appearances", async () => {
  await observerFixture(
    {
      events: [
        {
          event: "session_start",
          platform: "claude",
          session_id: "new-character",
        },
      ],
    },
    async ({ page }) => {
      await page.waitForFunction(
        () =>
          officeScene.sprites["moss-engineer"] &&
          officeScene.sprites["orbit-courier"],
      );
      await page.locator("#floorbtn").click();
      await page.locator("#roster [data-agent]").first().click();
      for (const key of ["moss-engineer", "orbit-courier"]) {
        await page.selectOption("#agent-appearance-select", key);
        await page.locator("#agent-preference-save").click();
        await page.waitForFunction(
          (key) =>
            pendingSaves === 0 &&
            agentPreference(agents[0].id, settings).appearance === key,
          key,
        );
        const cells = await page.evaluate((key) => {
          const sprite =
            officeScene.sprites[
              characterSpriteKey(agents[0], settings, officeScene.sprites)
            ];
          if (sprite !== officeScene.sprites[key]) return [];
          const g = sprite.getContext("2d", { willReadFrequently: true });
          return Array.from({ length: 21 }, (_, frame) => {
            const rgba = g.getImageData(
              (frame % 7) * 16,
              Math.floor(frame / 7) * 32,
              16,
              32,
            ).data;
            let pixels = 0,
              bottom = -1;
            for (let i = 3; i < rgba.length; i += 4)
              if (rgba[i] > 32) {
                pixels++;
                bottom = Math.floor(i / 4 / 16);
              }
            return { pixels, bottom };
          });
        }, key);
        assert.equal(cells.length, 21);
        for (const cell of cells) {
          assert.ok(
            cell.pixels > 35,
            "every animation cell contains a legible character",
          );
          assert.ok(
            cell.bottom >= 29 && cell.bottom <= 30,
            "feet keep the shared baseline",
          );
        }
      }
      await page.reload();
      await page.waitForFunction(() => initialized && settingsReady);
      assert.equal(
        await page.evaluate(
          () => agentPreference(agents[0].id, settings).appearance,
        ),
        "orbit-courier",
      );
    },
  );
});
