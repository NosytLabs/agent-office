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
    assert.equal(await page.evaluate(() => officeStudio.sprites.size), 186);
    const before = accounting(await state());
    await capture(page, "studio-desktop");
    await page.click("#settingsbtn");
    await page.selectOption("#studio-pet-0", "4");
    await page.selectOption("#studio-pet-1", "7");
    await page.selectOption("#studio-season-choice", "winter");
    await capture(page, "studio-customize");
    await page.keyboard.press("Escape");
    await page.reload();
    await ready(page);
    assert.deepEqual(await page.evaluate(() => officeStudio.prefs), {
      art: "studio",
      pets: [4, 7],
      season: "winter",
    });
    assert.equal(
      await page.evaluate(() =>
        officeScene.petViews.some((p) => p.key === "blackcat"),
      ),
      false,
      "No cosmetic bypass of the second-pet unlock",
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
      const after = await page.evaluate(() => ({
        time: officeScene.time,
        poses: officeScene.agents.map((a) => OfficeStudio.pose(a)),
      }));
      assert.deepEqual(after, before);
      assert.ok(after.poses.includes("attention"));
      assert.ok(after.poses.includes("type"));
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
    await page.evaluate(() => {
      toast("Studio keyboard notice");
    });
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
