const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { observerFixture } = require("./observer-fixture.cjs");
const events = [
  {
    event: "session_start",
    session_id: "studio-parent",
    platform: "claude",
    title: "Studio integration",
  },
  {
    event: "tool_start",
    session_id: "studio-parent",
    platform: "claude",
    tool_name: "Edit",
    call_id: "edit-1",
  },
  {
    event: "session_start",
    session_id: "studio-waiting",
    platform: "codex",
    title: "Review the changes",
  },
  {
    event: "input_request",
    session_id: "studio-waiting",
    platform: "codex",
    request_id: "question-1",
    question: "Which change should I review?",
  },
];
async function ready(page) {
  await page.waitForFunction(
    () =>
      window.officeStudio?.source !== undefined &&
      officeStudio.source !== "loading",
  );
  assert.equal(
    await page.evaluate(() => officeStudio.source),
    "studio",
    await page.evaluate(() => officeStudio.error),
  );
}
async function capture(page, name) {
  const folder = process.env.OFFICE_SCREENSHOTS || "reports/studio";
  fs.mkdirSync(folder, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: path.join(folder, name + ".png"),
    fullPage: true,
  });
}
const accounting = (s) => ({
  progress: s.progress,
  usage: s.usage,
  events: s.events,
  received: s.tracking.received,
});

test("studio sprites, palettes, pet looks and wall art persist without changing work", async () => {
  await observerFixture({ events }, async ({ page, state }) => {
    await ready(page);
    assert.equal(
      await page.evaluate(() => officeScene.spriteAssetSource),
      "native",
    );
    assert.equal(await page.evaluate(() => officeStudio.sprites.size), 197);
    const before = accounting(await state());
    await capture(page, "studio-desktop");
    await page.click("#settingsbtn");
    await page.selectOption("#studio-pet-0", "4");
    await page.selectOption("#studio-pet-1", "7");
    await page.selectOption("#studio-season-choice", "winter");
    await page.locator("#studio-art-choice").scrollIntoViewIfNeeded();
    await capture(page, "studio-customize");
    await page.keyboard.press("Escape");
    await page.reload();
    await ready(page);
    assert.deepEqual(await page.evaluate(() => officeStudio.prefs), {
      art: "studio",
      pets: [4, 7],
      season: "winter",
      finish: "oak",
    });
    assert.equal(
      await page.evaluate(() =>
        officeScene.petViews.some((p) => p.key === "blackcat"),
      ),
      false,
      "The second-pet unlock is preserved",
    );
    await page.click("#settingsbtn");
    await page.selectOption("#studio-art-choice", "classic");
    assert.equal(await page.getAttribute("html", "data-office-art"), "classic");
    await page.selectOption("#studio-art-choice", "studio");
    await page.keyboard.press("Escape");
    assert.deepEqual(accounting(await state()), before);
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, "studio-mobile");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.click("#settingsbtn");
    await page.locator("#studio-art-choice").scrollIntoViewIfNeeded();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await capture(page, "studio-mobile-settings");
  });
});
test("a missing studio tile falls back atomically to the original atlas", async () => {
  await observerFixture({ events }, async ({ page }) => {
    await ready(page);
    await page.route("**/studio-3.png", (route) =>
      route.fulfill({ status: 404, body: "missing" }),
    );
    await page.reload();
    await page.waitForFunction(
      () => window.officeStudio?.source === "fallback",
    );
    assert.equal(await page.evaluate(() => officeStudio.ready), false);
    assert.equal(
      await page.evaluate(() => officeScene.spriteAssetSource),
      "native",
    );
    assert.equal(await page.getAttribute("html", "data-office-art"), "classic");
    await page.click("#settingsbtn");
    assert.match(
      await page.textContent("#studio-art-status"),
      /original artwork/,
    );
  });
});
test("motion pause stops new sprite animation without changing observed status", async () => {
  await observerFixture(
    { events, reducedMotion: "reduce" },
    async ({ page }) => {
      await ready(page);
      assert.equal(await page.evaluate(() => officeScene.paused), true);
      const before = await page.evaluate(() => ({
        time: officeScene.time,
        poses: officeScene.agents.map((a) => OfficeStudio.pose(a)),
      }));
      await page.waitForTimeout(250);
      assert.deepEqual(
        await page.evaluate(() => ({
          time: officeScene.time,
          poses: officeScene.agents.map((a) => OfficeStudio.pose(a)),
        })),
        before,
      );
      assert.ok(before.poses.includes("attention"));
      assert.ok(before.poses.includes("type"));
      const frames = await page.evaluate(() =>
        ["idle", "walk-a", "walk-b"].map((p) =>
          officeStudio.sprites.get("pet-0-" + p).toDataURL(),
        ),
      );
      assert.equal(new Set(frames).size, 3);
    },
  );
});
test("subagent handoff is tied to a new observed completion, never replayed on refresh", async () => {
  await observerFixture({ events }, async ({ page, publish }) => {
    await ready(page);
    publish([
      {
        event: "subagent_start",
        session_id: "studio-parent",
        parent_session_id: "studio-parent",
        child_session_id: "studio-child",
        child_goal: "Review sprites",
        platform: "claude",
      },
    ]);
    await page.evaluate(() => poll());
    await page.waitForFunction(() =>
      officeScene.agents.some((a) => a.id === "studio-child"),
    );
    publish([
      {
        event: "subagent_stop",
        session_id: "studio-parent",
        parent_session_id: "studio-parent",
        child_session_id: "studio-child",
        platform: "claude",
      },
    ]);
    await page.evaluate(() => poll());
    await page.waitForFunction(() => officeStudio.handoffs.has("studio-child"));
    assert.equal(await page.evaluate(() => officeStudio.handoffs.size), 1);
    await capture(page, "studio-handoff");
    await page.reload();
    await ready(page);
    assert.equal(await page.evaluate(() => officeStudio.handoffs.size), 0);
  });
});
test("a notice whose expiry was paused for keyboard focus expires after blur", async () => {
  await observerFixture({ events: [] }, async ({ page }) => {
    await ready(page);
    await page.evaluate(() => toast("Studio keyboard notice"));
    const notice = page
      .locator(".toast")
      .filter({ hasText: "Studio keyboard notice" });
    await notice.locator("button").focus();
    await page.waitForTimeout(4600);
    assert.equal(await notice.count(), 1);
    await page.locator("#settingsbtn").focus();
    await page.waitForTimeout(4700);
    assert.equal(await notice.count(), 0);
  });
});
test("new plants, robot, beacon, door and terminal sprites retain their native bounds", async () => {
  await observerFixture({ events }, async ({ page }) => {
    await ready(page);
    const sizes = await page.evaluate(() => {
      const names = [
        "succulent",
        "planter",
        "robot",
        "statusbeacon",
        "DOOR",
        "taskterminal",
        "taskterminal-idle",
        "taskterminal-running",
        "taskterminal-finished",
        "taskterminal-failed",
        "taskterminal-disconnected",
      ];
      return names.map((key) => {
        const c = officeStudio.sprites.get(key);
        const alpha =
          c &&
          c
            .getContext("2d")
            .getImageData(0, 0, c.width, c.height)
            .data.some((v, i) => i % 4 === 3 && v > 0);
        return [key, c?.width, c?.height, !!alpha];
      });
    });
    assert.deepEqual(
      sizes.map((s) => s.slice(1)),
      [
        [12, 16, true],
        [32, 18, true],
        [18, 28, true],
        [12, 28, true],
        [32, 48, true],
        ...Array.from({ length: 6 }, () => [24, 34, true]),
      ],
    );
    const states = await page.evaluate(() =>
      ["idle", "running", "finished", "failed", "disconnected"].map((state) =>
        officeStudio.sprites.get("taskterminal-" + state).toDataURL(),
      ),
    );
    assert.equal(new Set(states).size, 5);
  });
});
test("studio portraits repaint once, retain their appearance, and match inspector choices", async () => {
  await observerFixture({ events }, async ({ page }) => {
    await ready(page);
    await page.click("#floorbtn");
    const result = await page.evaluate(() => {
      const card = document.querySelector(
          '#roster [data-agent="studio-parent"]',
        ),
        c = card.querySelector("canvas"),
        g = c.getContext("2d"),
        draw = g.drawImage.bind(g);
      let calls = 0;
      g.drawImage = (...args) => {
        calls++;
        return draw(...args);
      };
      fillRoster();
      const same = calls;
      const a = agents.find((a) => a.id === "studio-parent"),
        key = characterSpriteKey(a, settings, scene.sprites),
        old = scene.sprites[key];
      scene.sprites[key] = document.createElement("canvas");
      fillRoster();
      const changed = calls;
      scene.sprites[key] = old;
      g.drawImage = draw;
      fillRoster();
      return { same, changed, width: c.width, height: c.height };
    });
    assert.deepEqual(result, { same: 0, changed: 1, width: 24, height: 28 });
    await page.locator('#roster [data-agent="studio-parent"]').click();
    await page.selectOption("#agent-appearance-select", "studio-assistant");
    await page.click("#agent-preference-save");
    await page.waitForFunction(() => pendingSaves === 0);
    await page.keyboard.press("Escape");
    assert.equal(
      await page
        .locator('#roster [data-agent="studio-parent"] canvas')
        .evaluate((c) => {
          const expected = document.createElement("canvas");
          expected.width = 24;
          expected.height = 28;
          expected
            .getContext("2d")
            .drawImage(
              officeStudio.sprites.get("person-4-idle"),
              4,
              5,
              24,
              28,
              0,
              0,
              24,
              28,
            );
          return c.toDataURL() === expected.toDataURL();
        }),
      true,
    );
  });
});
