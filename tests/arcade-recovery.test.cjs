const { test } = require("node:test");
const assert = require("node:assert/strict");
const { observerFixture } = require("./observer-fixture.cjs");

test("Duck Hunt offers Retry when the iframe document never boots", async () => {
  await observerFixture({}, async ({ page }) => {
    await page.clock.install();
    await page.route("**/arcade/duck-hunt/index.html?*", (route) =>
      route.abort(),
    );
    await page.evaluate(() => officeArcade.open());
    await page.locator("#arcade-game-duck-hunt").click();
    await page.locator("#arcade-duck-start").click();
    await page.clock.fastForward(11000);
    assert.equal(
      (await page.evaluate(() => officeArcade.snapshot())).duck.failed,
      true,
    );
    assert.equal(
      await page.locator("#arcade-duck-start").innerText(),
      "Retry Duck Hunt",
    );
    assert.equal(await page.locator("#arcade-duck-start").isEnabled(), true);
    await page.locator("#arcade-exit").click();
    await page.locator("#arcade-game-snake").click();
    await page.clock.fastForward(11000);
    assert.equal(
      (await page.evaluate(() => officeArcade.snapshot())).selected,
      "snake",
    );
  });
});

test("Escape during Duck Hunt artwork loading keeps loading feedback and the explicit start", async () => {
  await observerFixture({}, async ({ page }) => {
    let release;
    const heldImage = new Promise((resolve) => {
      release = resolve;
    });
    await page.route("**/arcade/duck-hunt/images/logo.png", async (route) => {
      await heldImage;
      await route.continue();
    });
    await page.evaluate(() => {
      window.arcadeReports = [];
      addEventListener("message", (event) => {
        if (event.data?.channel === "agent-office-arcade")
          arcadeReports.push(event.data.type);
      });
      officeArcade.open();
    });
    await page.locator("#arcade-game-duck-hunt").click();
    await page.locator("#arcade-duck-start").click();
    const frame = page.locator("#arcade-duck-frame").contentFrame();
    try {
      await frame.locator("#canvas").waitFor({ state: "visible" });
      const child = page
        .frames()
        .find((item) => item.url().includes("/arcade/duck-hunt/"));
      await child.waitForFunction(() => !!window.duckHuntLifecycle);
      await frame.locator("#canvas").press("Escape");
      await page.waitForFunction(() => arcadeReports.includes("resumed"));
      assert.equal(
        await page.locator("#arcade-status").innerText(),
        "Loading the local Duck Hunt game…",
      );
      const snapshot = await page.evaluate(() => officeArcade.snapshot());
      assert.equal(snapshot.duck.ready, false);
      assert.equal(snapshot.duck.paused, true);
    } finally {
      release();
    }
    await page.waitForFunction(() => officeArcade.snapshot().duck.ready);
    assert.equal(
      (await page.evaluate(() => officeArcade.snapshot())).duck.paused,
      false,
    );
  });
});

test("a delayed child resume after closing Duck Hunt cannot autoplay on reopen", async () => {
  await observerFixture({}, async ({ page }) => {
    await page.evaluate(() => officeArcade.open());
    await page.locator("#arcade-game-duck-hunt").click();
    await page.locator("#arcade-duck-start").click();
    await page.waitForFunction(() => officeArcade.snapshot().duck.ready);
    const child = page
      .frames()
      .find((item) => item.url().includes("/arcade/duck-hunt/"));
    await page.locator("#sheet-arcade .close").click();
    await page.waitForFunction(
      () =>
        !officeArcade.snapshot().sheetOpen && officeArcade.snapshot().paused,
    );
    const before = await page.evaluate(() => ({
      status: document.getElementById("arcade-status").textContent,
      progress: JSON.stringify(_state.progress),
      usage: JSON.stringify(_state.usage),
    }));
    await page.evaluate(() => {
      window.lateArcadeResume = false;
      addEventListener("message", (event) => {
        if (
          event.data?.channel === "agent-office-arcade" &&
          event.data.type === "resumed"
        )
          window.lateArcadeResume = true;
      });
    });
    // Deliver the same authenticated report as the child's Escape handler,
    // after the parent has already handled Close. This fixes the ordering
    // deterministically instead of waiting for a scheduler-dependent race.
    await child.evaluate(() => {
      parent.postMessage(
        {
          channel: "agent-office-arcade",
          nonce: new URLSearchParams(location.search).get("nonce"),
          type: "resumed",
        },
        "*",
      );
    });
    await page.waitForFunction(() => window.lateArcadeResume);
    const stopped = await page.evaluate(() => officeArcade.snapshot());
    assert.equal(stopped.paused, true);
    assert.equal(stopped.duck.paused, true);
    assert.equal(
      await page.locator("#arcade-status").textContent(),
      before.status,
    );
    await page.evaluate(() => officeArcade.open());
    assert.equal(
      (await page.evaluate(() => officeArcade.snapshot())).paused,
      true,
    );
    await page.locator("#arcade-pause").click();
    await page.waitForFunction(() => !officeArcade.snapshot().duck.paused);
    assert.equal(
      await page.evaluate(() => JSON.stringify(_state.progress)),
      before.progress,
    );
    assert.equal(
      await page.evaluate(() => JSON.stringify(_state.usage)),
      before.usage,
    );
  });
});

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
])
  test(`old Duck Hunt reports cannot replace newer controls after reopening at ${viewport.width}px`, async () => {
    await observerFixture({ viewport }, async ({ page }) => {
      // Observe delivery before pressing Escape; host readiness alone does
      // not establish that its initial Resume reached the child already.
      await page.addInitScript(() => {
        window.lastHostControl = 0;
        addEventListener("message", (event) => {
          if (
            event.source === parent &&
            event.data?.channel === "agent-office-arcade" &&
            ["pause", "resume"].includes(event.data.action)
          )
            window.lastHostControl = event.data.controlRevision;
        });
      });
      await page.evaluate(() => {
        window.controlReports = [];
        addEventListener("message", (event) => {
          if (event.data?.channel === "agent-office-arcade")
            controlReports.push(event.data);
        });
        officeArcade.open();
      });
      await page.locator("#arcade-game-duck-hunt").click();
      await page.locator("#arcade-duck-start").click();
      await page.waitForFunction(() => officeArcade.snapshot().duck.ready);
      const child = page
        .frames()
        .find((item) => item.url().includes("/arcade/duck-hunt/"));
      const canvas = child.locator("#canvas");
      await child.waitForFunction(() => lastHostControl > 0);
      await canvas.press("Escape");
      await page.waitForFunction(() => officeArcade.snapshot().paused);
      await canvas.press("Escape");
      await page.waitForFunction(() => !officeArcade.snapshot().paused);
      const oldResume = await page.evaluate(() =>
        controlReports.findLast((report) => report.type === "resumed"),
      );
      assert.ok(Number.isSafeInteger(oldResume.controlRevision));
      const accounting = await page.evaluate(() =>
        JSON.stringify([_state.progress, _state.usage]),
      );
      await page.locator("#sheet-arcade .close").click();
      await page.evaluate(() => officeArcade.open());
      await child.waitForFunction(
        (revision) => lastHostControl > revision,
        oldResume.controlRevision,
      );
      const stoppedRevision = await child.evaluate(() => lastHostControl);
      const stoppedStatus = await page.locator("#arcade-status").textContent();
      const beforeReplay = await page.evaluate(() => controlReports.length);
      // Replay an actual keyboard report from the same iframe, now delivered
      // after Close and reopen. Source/origin/nonce are all genuinely valid.
      await child.evaluate(
        (report) => parent.postMessage(report, "*"),
        oldResume,
      );
      await page.waitForFunction(
        (count) => controlReports.length > count,
        beforeReplay,
      );
      assert.equal(
        (await page.evaluate(() => officeArcade.snapshot())).paused,
        true,
      );
      assert.equal(
        await page.locator("#arcade-status").textContent(),
        stoppedStatus,
      );
      await child.waitForFunction(
        (revision) => lastHostControl > revision,
        stoppedRevision,
      );
      await canvas.press("Escape");
      await page.waitForFunction(() => !officeArcade.snapshot().paused);
      await canvas.press("Escape");
      await page.waitForFunction(() => officeArcade.snapshot().paused);
      const oldPause = await page.evaluate(() =>
        controlReports.findLast((report) => report.type === "paused"),
      );
      await page.locator("#arcade-pause").click();
      await child.waitForFunction(
        (revision) => lastHostControl > revision,
        oldPause.controlRevision,
      );
      const playingStatus = await page.locator("#arcade-status").textContent();
      const beforePauseReplay = await page.evaluate(
        () => controlReports.length,
      );
      await child.evaluate(
        (report) => parent.postMessage(report, "*"),
        oldPause,
      );
      await page.waitForFunction(
        (count) => controlReports.length > count,
        beforePauseReplay,
      );
      assert.equal(
        (await page.evaluate(() => officeArcade.snapshot())).paused,
        false,
      );
      assert.equal(
        await page.locator("#arcade-status").textContent(),
        playingStatus,
      );
      assert.equal(
        await page.evaluate(() =>
          JSON.stringify([_state.progress, _state.usage]),
        ),
        accounting,
      );
      await canvas.press("Escape");
      await page.waitForFunction(() => officeArcade.snapshot().paused);
      const fs = require("node:fs"),
        path = require("node:path");
      const directory = path.join(__dirname, "../reports/arcade");
      fs.mkdirSync(directory, { recursive: true });
      await page.screenshot({
        path: path.join(directory, `control-reopen-${viewport.width}.png`),
        fullPage: true,
      });
    });
  });
