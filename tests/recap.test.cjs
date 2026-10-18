/* Browser-local recap and per-kind sound preferences. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { observerFixture } = require("./observer-fixture.cjs");
const { fetchSettings } = require("./settings-helper.cjs");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeEvent(overrides) {
  return {
    ts: Date.now() / 1000,
    session_id: "sess-1",
    platform: "codex",
    event: "tool_end",
    status: "ok",
    tool: "Bash",
    ...overrides,
  };
}

test("per-kind sound preferences hide or show checkboxes by setting", async () => {
  await observerFixture(
    {
      settings: {
        sound: true,
        sound_needs_input: false,
        sound_error: true,
        sound_reward: false,
      },
    },
    async ({ page }) => {
      await page.locator("#settingsbtn").click();
      await page.waitForFunction(
        () => !!document.querySelector("#sound-prefs-form"),
      );
      const checked = await page.$$eval("[data-sound-pref]", (nodes) =>
        nodes.map((n) => ({ key: n.dataset.soundPref, checked: n.checked })),
      );
      assert.deepEqual(checked, [
        { key: "sound_needs_input", checked: false },
        { key: "sound_error", checked: true },
        { key: "sound_reward", checked: false },
      ]);
    },
  );
});

test("toggling a sound preference persists in settings.json", async () => {
  let saved = null;
  await observerFixture(
    { settings: { sound: true } },
    async ({ page, base }) => {
      await page.locator("#settingsbtn").click();
      await page.waitForFunction(
        () => !!document.querySelector("#sound-prefs-form"),
      );
      await page.waitForFunction(
        () => document.querySelector("#sound-error")?.checked === true,
      );
      await page.locator("#sound-error").click();
      // Wait for the persisted setting to flip on the server.
      for (let i = 0; i < 30; i++) {
        const r = await fetchSettings(base + "/settings");
        saved = await r.json();
        if (saved.sound_error === false) break;
        await delay(100);
      }
    },
  );
  assert.equal(saved.sound_error, false);
  assert.equal(saved.sound_needs_input, true);
  assert.equal(saved.sound_reward, true);
});

test("recap counts actual request event payloads without invented waiting or reward fields", async () => {
  const now = Date.now() / 1000;
  const events = [
    makeEvent({ event: "tool_end", tool: "Bash", status: "ok" }),
    {
      ts: now,
      session_id: "approval",
      platform: "claude",
      event: "approval_request",
      request_id: "approval-1",
      command: "Synthetic approval",
    },
    {
      ts: now,
      session_id: "question",
      platform: "codex",
      event: "input_request",
      request_id: "question-1",
      question: "Synthetic question",
    },
    makeEvent({ event: "session_error", error_message: "boom" }),
    makeEvent({ event: "tool_end", tool: "read", status: "error" }),
  ];
  await observerFixture({ events }, async ({ page }) => {
    await page.locator("#settingsbtn").click();
    await page.waitForFunction(
      () => !!document.querySelector("#recap-summary"),
    );
    const summary = await page.$eval("#recap-summary", (node) =>
      Array.from(node.querySelectorAll("dt")).map((dt, i) => [
        dt.textContent,
        node.querySelectorAll("dd")[i].textContent,
      ]),
    );
    const asMap = Object.fromEntries(summary);
    assert.equal(asMap.Range, "Today");
    assert.equal(Number(asMap.Events), 5);
    assert.equal(Number(asMap["Input requests"] ?? asMap["Needs input"]), 2);
    assert.equal(Number(asMap.Errors), 2);
    assert.equal(
      Object.hasOwn(asMap, "Achievements"),
      false,
      "earned rewards are not raw history events",
    );
    const items = await page.$$eval("#recap-events li", (nodes) =>
      nodes.map((n) => ({ kind: n.dataset.kind, text: n.textContent.trim() })),
    );
    assert.equal(items.length, 4);
    const kinds = items.map((i) => i.kind).sort();
    assert.deepEqual(kinds, ["error", "error", "needs_input", "needs_input"]);
  });
});

test("recap states its recent-snapshot scope when retained history has more than thirty events", async () => {
  const events = Array.from({ length: 45 }, (_, i) =>
    makeEvent({
      session_id: "burst-" + i,
      event: "session_error",
      error_message: "Synthetic error " + i,
    }),
  );
  await observerFixture({ events }, async ({ page, base }) => {
    assert.equal(
      (await (await fetch(base + "/state")).json()).events.length,
      30,
    );
    assert.equal(
      (await (await fetch(base + "/history?limit=100")).json()).events.length,
      45,
    );
    await page.locator("#settingsbtn").click();
    assert.match(
      await page.textContent("#recap-scope"),
      /latest 30|recent 30/i,
    );
    assert.match(
      await page.textContent("#recap-scope"),
      /not.*full|older.*activity/i,
    );
    assert.equal(await page.locator("#recap-events li").count(), 30);
    await page.locator("#recap-open-activity").click();
    assert.equal(await page.locator("#sheet-events").isVisible(), true);
  });
});

test("unchanged recap polls preserve selected text, event nodes and reading position", async () => {
  await observerFixture(
    {
      events: Array.from({ length: 22 }, (_, i) =>
        makeEvent({
          event: "session_error",
          error_message: "Synthetic recap selection " + i,
        }),
      ),
    },
    async ({ page }) => {
      await page.locator("#settingsbtn").click();
      const result = await page.evaluate(async () => {
        if (pollInFlight) await pollInFlight;
        clearTimeout(pollTimer);
        const list = document.querySelector("#recap-events"),
          node = list.querySelector("li span"),
          range = document.createRange();
        list.scrollTop = 130;
        range.selectNodeContents(node);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        const text = selection.toString(),
          offset = list.scrollTop;
        await poll();
        clearTimeout(pollTimer);
        return {
          same: node === list.querySelector("li span"),
          selected: selection.toString(),
          text,
          offset,
          after: list.scrollTop,
        };
      });
      assert.equal(
        result.same,
        true,
        "unchanged polling must reuse visible recap nodes",
      );
      assert.equal(result.selected, result.text);
      assert.equal(result.after, result.offset);
    },
  );
});

test("hidden recap does no DOM work and opening Customize immediately shows its latest snapshot", async () => {
  await observerFixture(
    { events: [makeEvent({ event: "session_error" })] },
    async ({ page, publish }) => {
      await page.evaluate(() => {
        clearTimeout(pollTimer);
        window.recapMutations = [];
        window.recapWatcher = new MutationObserver((records) =>
          recapMutations.push(...records),
        );
        recapWatcher.observe(document.querySelector("#recap-events"), {
          childList: true,
          subtree: true,
          characterData: true,
        });
      });
      publish([
        makeEvent({
          event: "session_error",
          error_message: "Arrived while closed",
        }),
      ]);
      await page.evaluate(async () => {
        await poll();
        clearTimeout(pollTimer);
        await new Promise(requestAnimationFrame);
      });
      assert.equal(
        await page.evaluate(() => recapMutations.length),
        0,
        "a closed recap should not recreate or update its contents",
      );
      await page.locator("#settingsbtn").click();
      assert.equal(await page.locator("#recap-events li").count(), 2);
      assert.match(
        await page.textContent("#recap-events"),
        /Arrived while closed/,
      );
    },
  );
});

test("demo and observer review markers stay separate and ambiguous legacy markers are ignored", async () => {
  await observerFixture(
    { events: [makeEvent({ event: "session_error" })] },
    async ({ page, base }) => {
      await page.evaluate(async () => {
        localStorage.setItem(
          "agentOffice.lastReviewedAt",
          String(Date.now() / 1000 + 86400),
        );
        localStorage.setItem("agentOffice.recapRange", "since_review");
        await poll();
        clearTimeout(pollTimer);
      });
      await page.locator("#settingsbtn").click();
      assert.match(
        await page.textContent("#recap-last-reviewed"),
        /never reviewed/i,
      );
      await page.locator("#recap-mark-reviewed").click();
      const local = await page.evaluate(() =>
        localStorage.getItem("agent-office:recap:v1:observer"),
      );
      assert.ok(local);
      await page.route(base + "/", async (route) => {
        const response = await route.fetch();
        const html = await response.text();
        await route.fulfill({
          response,
          body: html.replace("<body>", '<body data-agent-office-preview="1">'),
        });
      });
      await page.reload();
      await page.waitForFunction(() => initialized && settingsReady);
      await page.locator("#settingsbtn").click();
      assert.match(
        await page.textContent("#recap-last-reviewed"),
        /never reviewed/i,
      );
      await page.locator("#recap-mark-reviewed").click();
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem("agent-office:recap:v1:observer"),
        ),
        local,
      );
      assert.ok(
        await page.evaluate(() =>
          localStorage.getItem("agent-office:recap:v1:preview"),
        ),
      );
    },
  );
});

test("failed recap preference writes keep the previous marker and show a retryable message", async () => {
  await observerFixture(
    { events: [makeEvent({ event: "session_error" })] },
    async ({ page, base }) => {
      await page.locator("#settingsbtn").click();
      const before = await (await fetch(base + "/state")).json();
      await page.evaluate(() => {
        const save = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (
            key.startsWith("agent-office:recap:") ||
            key.startsWith("agentOffice.")
          )
            throw new DOMException("Synthetic quota", "QuotaExceededError");
          return save.call(this, key, value);
        };
      });
      await page.locator("#recap-mark-reviewed").click();
      assert.match(
        await page.textContent("#recap-status"),
        /not saved|could not/i,
      );
      assert.match(
        await page.textContent("#recap-last-reviewed"),
        /never reviewed/i,
      );
      assert.equal(
        await page
          .locator('input[name="recap-range"][value="today"]')
          .isChecked(),
        true,
      );
      const after = await (await fetch(base + "/state")).json();
      for (const field of ["progress", "usage", "events"])
        assert.deepEqual(after[field], before[field]);
      // Observer ages advance independently of browser-local recap preferences.
      const withoutAges = (agents) =>
        agents.map(({ duration_s, idle_s, ...agent }) => agent);
      assert.deepEqual(withoutAges(after.agents), withoutAges(before.agents));
      for (let i = 0; i < after.agents.length; i++)
        for (const field of ["duration_s", "idle_s"])
          assert.ok(after.agents[i][field] >= before.agents[i][field]);
    },
  );
});

test("mark reviewed switches recap to the since-review window", async () => {
  const events = [
    makeEvent({ event: "tool_end", tool: "Bash", status: "ok" }),
    makeEvent({ event: "session_error", error_message: "early" }),
  ];
  await observerFixture({ events }, async ({ page }) => {
    await page.locator("#settingsbtn").click();
    await page.waitForFunction(
      () => !!document.querySelector("#recap-summary"),
    );
    // Today shows both.
    let eventsCount = await page.$eval(
      "#recap-summary dd:nth-of-type(2)",
      (n) => n.textContent,
    );
    assert.equal(eventsCount, "2");
    // Mark reviewed now and switch to since-review.
    await page.locator("#recap-mark-reviewed").click();
    const since = await page.$eval(
      "#recap-summary dd:nth-of-type(2)",
      (n) => n.textContent,
    );
    assert.equal(since, "0");
    const label = await page.$eval(
      "#recap-last-reviewed",
      (n) => n.textContent,
    );
    assert.match(label, /^Last reviewed /);
  });
});
