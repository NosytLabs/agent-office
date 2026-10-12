/* Real observer flows for finding work and distinguishing stale state. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { observerFixture } = require("./observer-fixture.cjs");
const events = [
  { event: "session_start", session_id: "release-check", platform: "claude" },
  {
    event: "approval_request",
    session_id: "release-check",
    platform: "claude",
    command: "npm test",
    request_id: "p1",
  },
  { event: "session_start", session_id: "api-work", platform: "opencode" },
  {
    event: "tool_start",
    session_id: "api-work",
    platform: "opencode",
    tool_name: "read",
    preview: "src/api.ts",
    call_id: "t1",
  },
  { event: "session_start", session_id: "docs-work", platform: "codex" },
  {
    event: "input_request",
    session_id: "docs-work",
    platform: "codex",
    question: "Which API version?",
    request_id: "q1",
  },
];
async function stopTimers(page) {
  // Give the browser clock a known earlier origin; a host timestamp sampled
  // after install can already be in its past under parallel execution.
  const pausedAt = new Date();
  await page.clock.install({ time: new Date(pausedAt.getTime() - 60000) });
  await page.clock.pauseAt(pausedAt);
  await page.evaluate(() => poll());
}
const ids = (page) =>
  page
    .locator("#roster .agent-card")
    .evaluateAll((nodes) => nodes.map((n) => n.dataset.agent));

test("connection guide commands target only the selected integration", async () => {
  await observerFixture({}, async ({ page }) => {
    await page.evaluate(() => openSheet("sheet-setup"));
    for (const [choice, target] of [
      ["codex", "codex"],
      ["claude", "claude"],
      ["telegram", "hermes"],
      ["vscode", "vscode"],
    ]) {
      await page.locator("#setup-runtime").selectOption(choice);
      assert.equal(
        await page.locator("#command-install").innerText(),
        "python3 install.py --only " + target,
      );
    }
  });
});

test("status and runtime filters combine with search without hiding unrelated usage", async () => {
  await observerFixture({ events }, async ({ page, state }) => {
    const before = (await state()).progress.xp;
    await page.locator("#floorbtn").click();
    assert.equal(await page.locator("#roster-filters").count(), 1);
    await page.locator('[data-roster-status="waiting"]').click();
    assert.deepEqual((await ids(page)).sort(), ["docs-work", "release-check"]);
    await page.locator("#roster-runtime").selectOption("codex");
    assert.deepEqual(await ids(page), ["docs-work"]);
    await page.locator("#trackSearch").fill("no matching session");
    assert.deepEqual(await ids(page), []);
    assert.match(await page.locator("#roster-summary").innerText(), /0 of 3/);
    await page.locator("#roster-reset").click();
    assert.equal((await ids(page)).length, 3);
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "trackSearch",
    );
    assert.equal(await page.locator("#roster-runtime").inputValue(), "every");
    assert.equal((await state()).progress.xp, before);
  });
});

test("roster filters persist as view-only preferences and retain keyboard focus during polling", async () => {
  await observerFixture({ events }, async ({ page }) => {
    await page.locator("#floorbtn").click();
    assert.equal(await page.locator("#roster-filters").count(), 1);
    await page.locator('[data-roster-status="waiting"]').click();
    await page.locator("#roster-runtime").selectOption("claude");
    await page.reload();
    await page.waitForFunction(() => initialized && settingsReady);
    assert.deepEqual(await ids(page), ["release-check"]);
    await page.locator("#roster .agent-card").focus();
    const unchanged = await page.evaluate(() => {
      const before = document.activeElement;
      fillRoster();
      return document.activeElement === before;
    });
    assert.equal(unchanged, true);
  });
});

test("every data panel labels disconnection and Retry restores real observer state", async () => {
  await observerFixture({ events }, async ({ page }) => {
    await stopTimers(page);
    await page.route("**/state", (route) => route.abort());
    await page.evaluate(() => poll());
    for (const panel of [
      "sheet-floor",
      "sheet-tasks",
      "sheet-events",
      "sheet-inspector",
    ]) {
      await page.evaluate((panel) => {
        if (panel === "sheet-inspector") selectAgent("release-check");
        else openSheet(panel);
      }, panel);
      const notice = page.locator("#" + panel + " .connection-notice");
      assert.equal(await notice.count(), 1);
      assert.equal(await notice.isVisible(), true);
      assert.match(await notice.innerText(), /last received|last reported/i);
    }
    await page.unroute("**/state");
    await page.locator("#sheet-inspector [data-retry-observer]").click();
    await page.waitForFunction(() => !offline);
    assert.equal(
      await page.locator("#sheet-inspector .connection-notice").isVisible(),
      false,
    );
  });
});

test("overlapping refreshes share one active request", async () => {
  await observerFixture({}, async ({ page }) => {
    await stopTimers(page);
    const result = await page.evaluate(async () => {
      const real = window.fetch;
      let calls = 0,
        release;
      const wait = new Promise((resolve) => (release = resolve));
      window.fetch = async (...args) => {
        if (String(args[0]) === "state") {
          calls++;
          await wait;
        }
        return real(...args);
      };
      const requests = [poll(), poll(), poll()];
      await Promise.resolve();
      const count = calls;
      release();
      await Promise.all(requests);
      window.fetch = real;
      return count;
    });
    assert.equal(result, 1);
  });
});

test("hidden documents poll less often while visible polling keeps its cadence", async () => {
  await observerFixture({}, async ({ page }) => {
    await stopTimers(page);
    const delays = await page.evaluate(async () => {
      const real = window.setTimeout,
        record = [];
      window.setTimeout = (fn, ms, ...rest) => {
        if (fn === poll) record.push(ms);
        return real(fn, ms, ...rest);
      };
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      await poll();
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => false,
      });
      await poll();
      window.setTimeout = real;
      return record;
    });
    assert.deepEqual(delays, [15000, 1500]);
  });
});

test("offline retries back off without losing the retained sessions", async () => {
  await observerFixture({ events }, async ({ page }) => {
    await stopTimers(page);
    await page.route("**/state", (r) => r.abort());
    const result = await page.evaluate(async () => {
      const real = window.setTimeout,
        delays = [];
      window.setTimeout = (fn, ms, ...rest) => {
        if (fn === poll) delays.push(ms);
        return real(fn, ms, ...rest);
      };
      for (let i = 0; i < 6; i++) await poll();
      window.setTimeout = real;
      return { delays, count: agents.length };
    });
    assert.deepEqual(result.delays, [1500, 3000, 6000, 12000, 15000, 15000]);
    assert.equal(result.count, 3);
  });
});

test("agent cards expose the reported file or command next to the tool", async () => {
  await observerFixture({ events }, async ({ page }) => {
    await page.locator("#floorbtn").click();
    assert.match(
      await page
        .locator('#roster [data-agent="api-work"] .agent-runtime')
        .innerText(),
      /read.*src\/api\.ts/,
    );
  });
});

test("unchanged cards reuse portrait pixels but appearance changes repaint", async () => {
  await observerFixture({ events }, async ({ page }) => {
    await page.locator("#floorbtn").click();
    const result = await page.evaluate(() => {
      const portrait = document.querySelector(
        '#roster [data-agent="api-work"] .portrait',
      );
      const context = portrait.getContext("2d"),
        draw = context.drawImage.bind(context);
      let calls = 0;
      context.drawImage = (...args) => {
        calls++;
        return draw(...args);
      };
      fillRoster();
      const unchanged = calls;
      const agent = agents.find((a) => a.id === "api-work");
      const key = characterSpriteKey(agent, settings, scene.sprites);
      const before = scene.sprites[key];
      const replacement = document.createElement("canvas");
      replacement.width = 112;
      replacement.height = 96;
      scene.sprites[key] = replacement;
      fillRoster();
      scene.sprites[key] = before;
      context.drawImage = draw;
      fillRoster();
      return { unchanged, changed: calls };
    });
    assert.equal(result.unchanged, 0);
    assert.equal(result.changed, 1);
  });
});

test("returning to a visible document refreshes without waiting for the hidden timer", async () => {
  await observerFixture({}, async ({ page }) => {
    await stopTimers(page);
    const result = await page.evaluate(async () => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      const real = window.fetch;
      let calls = 0;
      window.fetch = (...args) => {
        if (String(args[0]) === "state") calls++;
        return real(...args);
      };
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      await poll();
      window.fetch = real;
      return calls;
    });
    assert.equal(result, 1);
  });
});

test("state refresh works without the newer AbortSignal.any helper", async () => {
  await observerFixture({}, async ({ page }) => {
    await stopTimers(page);
    const result = await page.evaluate(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, "any");
      Object.defineProperty(AbortSignal, "any", {
        configurable: true,
        value: undefined,
      });
      try {
        return await poll();
      } finally {
        if (descriptor) Object.defineProperty(AbortSignal, "any", descriptor);
        else delete AbortSignal.any;
      }
    });
    assert.equal(result, true);
  });
});
