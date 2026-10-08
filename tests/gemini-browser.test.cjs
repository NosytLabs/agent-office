/* Actual Gemini hook adapter, isolated observer, and native Chromium controls. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { observerFixture } = require("./observer-fixture.cjs");
const root = path.resolve(__dirname, "..");

test("Gemini lifecycle hooks render their own runtime and keep unreported work and usage unknown", async () => {
  await observerFixture(
    {
      events: [
        {
          event: "session_start",
          session_id: "other-runtime",
          platform: "hermes",
        },
      ],
    },
    async ({ page, directory, state }) => {
      function hook(name) {
        const result = spawnSync(
          process.env.PYTHON || "python",
          ["gemini/hook.py"],
          {
            cwd: root,
            env: { ...process.env, HERMES_HOME: path.dirname(directory) },
            encoding: "utf8",
            input: JSON.stringify({
              hook_event_name: name,
              session_id: "gemini-ui",
              source: "startup",
              reason: "exit",
              prompt: "Private synthetic input must not appear",
            }),
          },
        );
        assert.equal(result.status, 0);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "");
      }
      hook("SessionStart");
      hook("BeforeAgent");
      await page.waitForFunction(() =>
        agents.some(
          (agent) => agent.id === "gemini-ui" && agent.status === "thinking",
        ),
      );
      const before = await state();
      await page.click("#floorbtn");
      const card = page.locator('#roster [data-agent="gemini-ui"]');
      assert.equal(
        await card.locator(".runtime-badge").innerText(),
        "Gemini CLI",
      );
      await card.click();
      assert.equal(
        await page.locator("#inspectorbox .runtime-badge").innerText(),
        "Gemini CLI",
      );
      const brand = page.locator('#inspectorbox img[src$="/gemini.svg"]');
      await brand.waitFor();
      assert.equal(
        await brand.evaluate(
          (image) => image.complete && image.naturalWidth > 0,
        ),
        true,
      );
      assert.match(await page.textContent("#inspectorbox"), /Not reported/);
      assert.doesNotMatch(
        await page.textContent("#inspectorbox"),
        /\$0\.00|Private synthetic/,
      );
      const reports = path.join(root, "reports/gemini-ui");
      fs.mkdirSync(reports, { recursive: true });
      await brand.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(reports, "desktop-inspector.png"),
        fullPage: true,
      });
      await page.keyboard.press("Escape");
      await page.selectOption("#filterbtn", "gemini");
      assert.deepEqual(
        await page.evaluate(() => officeScene.list().map((agent) => agent.id)),
        ["gemini-ui"],
      );
      await page.reload();
      await page.waitForFunction(() => initialized && settingsReady);
      assert.equal(await page.inputValue("#filterbtn"), "gemini");
      if (await page.evaluate(() => opened !== null))
        await page.keyboard.press("Escape");
      await page.click("#eventsbtn");
      await page.selectOption("#event-runtime", "gemini");
      assert.ok(
        (
          await page.locator("#eventbox .event-identity").allTextContents()
        ).every((value) => value === "gemini · gemini-ui"),
      );
      assert.ok((await page.locator("#eventbox .event-identity").count()) >= 2);
      await page.keyboard.press("Escape");
      await page.click("#settingsbtn");
      await page.click('#sheet-settings [data-sheet="sheet-setup"]');
      await page.selectOption("#setup-runtime", "gemini");
      assert.equal(
        await page.locator("#setup-brand").innerText(),
        "Gemini CLI",
      );
      const detail = await page.textContent("#setup-detail");
      assert.match(detail, /lifecycle only/i);
      assert.match(detail, /GEMINI_CLI_HOME/);
      assert.match(detail, /not report.*tokens.*cost/i);
      assert.match(detail, /errors.*omit.*end/i);
      assert.match(
        await page.textContent("#setup-observed"),
        /1 recorded session/,
      );
      await page.keyboard.press("Escape");
      hook("AfterAgent");
      await page.waitForFunction(() =>
        agents.some(
          (agent) => agent.id === "gemini-ui" && agent.status === "idle",
        ),
      );
      const idle = await state();
      assert.equal(
        idle.progress.xp,
        before.progress.xp,
        "Returning from an agent loop is not completion XP",
      );
      assert.equal(idle.usage.totals.reports, 0);
      assert.equal(idle.progress.stats.tools, 0);
      assert.equal(idle.progress.stats.subagents, 0);
      assert.deepEqual(idle.tasks, []);
      if (await page.evaluate(() => opened !== null))
        await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 320, height: 720 });
      await page.click("#floorbtn");
      await page.locator('#roster [data-agent="gemini-ui"]').click();
      assert.equal(
        await page.locator("#inspectorbox .runtime-badge").innerText(),
        "Gemini CLI",
      );
      const bounds = await page.locator("#sheet-inspector").boundingBox();
      assert.ok(
        bounds.x >= 0 && bounds.x + bounds.width <= 320,
        "Gemini inspector remains inside the mobile viewport",
      );
      assert.match(await page.textContent("#inspectorbox"), /Not reported/);
      await page
        .locator("#inspectorbox .runtime-badge")
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(reports, "mobile-inspector.png"),
        fullPage: true,
      });
      hook("SessionEnd");
      await page.waitForFunction(() =>
        agents.some(
          (agent) => agent.id === "gemini-ui" && agent.status === "gone",
        ),
      );
      assert.equal((await state()).progress.xp, before.progress.xp);
    },
  );
});
