/* Sound controls follow the same revisioned settings state as other controls. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { observerFixture } = require("./observer-fixture.cjs");
const { fetchSettings } = require("./settings-helper.cjs");

function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

async function soundControls(page) {
  return page
    .locator("[data-sound-pref]")
    .evaluateAll((controls) =>
      Object.fromEntries(
        controls.map((control) => [control.dataset.soundPref, control.checked]),
      ),
    );
}

async function stored(base) {
  return (await fetchSettings(base + "/settings")).json();
}

async function withSoundControls(run) {
  await observerFixture(
    {
      settings: {
        sound: true,
        sound_needs_input: true,
        sound_error: true,
        sound_reward: true,
      },
    },
    async (fixture) => {
      await fixture.page.locator("#settingsbtn").click();
      await fixture.page.waitForFunction(
        () => document.querySelector("#sound-error").checked,
      );
      await run(fixture);
    },
  );
}

for (const phase of ["pending", "acknowledged"])
  test(`an older state response cannot repaint a sound preference (${phase})`, async () => {
    await withSoundControls(async ({ page, base }) => {
      const stateGate = deferred(),
        saveGate = deferred();
      let captureState = true;
      await page.route("**/state", async (route) => {
        if (!captureState) return route.continue();
        captureState = false;
        const response = await route.fetch(),
          snapshot = await response.json();
        snapshot.__soundFixtureSnapshot = true;
        await page.evaluate(() => {
          window.__soundSnapshotHeld = true;
        });
        await stateGate.promise;
        await route.fulfill({ response, json: snapshot });
      });
      await page.route("**/settings", async (route) => {
        if (route.request().method() === "POST") await saveGate.promise;
        await route.continue();
      });
      try {
        // Capture the real poll before the edit; its revision is now older
        // than the optimistic preference and its eventual acknowledgement.
        await page.waitForFunction(() => window.__soundSnapshotHeld);
        await page.locator("#sound-error").click();
        await page.waitForFunction(() => pendingSaves === 1);
        if (phase === "acknowledged") {
          saveGate.resolve();
          await page.waitForFunction(() => pendingSaves === 0);
          assert.equal((await stored(base)).sound_error, false);
        }
        stateGate.resolve();
        await page.waitForFunction(() => window._state.__soundFixtureSnapshot);
        assert.equal(
          await page.evaluate(() => settings.sound_error),
          false,
          "the settings owner retained the newer preference",
        );
        assert.deepEqual(await soundControls(page), {
          sound_needs_input: true,
          sound_error: false,
          sound_reward: true,
        });
        if (phase === "pending") {
          assert.equal(await page.evaluate(() => pendingSaves), 1);
          saveGate.resolve();
          await page.waitForFunction(() => pendingSaves === 0);
        }
        assert.equal((await stored(base)).sound_error, false);
        assert.equal(await page.locator("#sound-error").isChecked(), false);
      } finally {
        stateGate.resolve();
        saveGate.resolve();
      }
    });
  });

test("a failed sound save restores acknowledged controls before another poll", async () => {
  await withSoundControls(async ({ page, base }) => {
    // Prevent a later successful poll from hiding a missing rollback update.
    await page.route("**/state", (route) => route.abort());
    await page.route("**/settings", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 503, json: { error: "unavailable" } })
        : route.continue(),
    );
    await page.locator("#sound-error").click();
    await page.waitForFunction(() => pendingSaves === 0);
    assert.equal(await page.evaluate(() => settings.sound_error), true);
    assert.equal((await stored(base)).sound_error, true);
    assert.deepEqual(await soundControls(page), {
      sound_needs_input: true,
      sound_error: true,
      sound_reward: true,
    });
    assert.match(
      await page.locator("#save-status").textContent(),
      /not saved/i,
    );
    await page.unroute("**/settings");
    await page.locator("#sound-error").click();
    await page.waitForFunction(() => pendingSaves === 0);
    assert.equal((await stored(base)).sound_error, false);
    assert.equal(await page.locator("#sound-error").isChecked(), false);
  });
});

test("a sound revision conflict adopts current controls and allows a reviewed retry", async () => {
  await withSoundControls(async ({ page, base }) => {
    await page.route("**/state", (route) => route.abort());
    const changed = await fetchSettings(base + "/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sound_needs_input: false }),
    });
    assert.ok(changed.ok);
    await page.locator("#sound-error").click();
    await page.waitForFunction(() => pendingSaves === 0);
    assert.deepEqual(await soundControls(page), {
      sound_needs_input: false,
      sound_error: true,
      sound_reward: true,
    });
    assert.match(
      await page.locator("#settings-save-notice").textContent(),
      /changed|review/i,
    );
    await page.locator("#sound-error").click();
    await page.waitForFunction(() => pendingSaves === 0);
    const saved = await stored(base);
    assert.equal(saved.sound_needs_input, false);
    assert.equal(saved.sound_error, false);
    assert.equal(saved.sound_reward, true);
    assert.equal(saved.sound, true, "kind choices preserve the master toggle");
    assert.equal(await page.locator("#sound-error").isChecked(), false);
  });
});
