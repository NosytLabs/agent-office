const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { observerFixture } = require("./observer-fixture.cjs");
async function ready(page) {
  await page.waitForFunction(
    () => window.officeStudio?.ready && !officeStudio.loading,
  );
  assert.equal(await page.evaluate(() => officeStudio.environmentError), "");
  assert.equal(await page.evaluate(() => officeStudio.characterLife.size), 96);
}
const accounting = (s) => ({
  progress: s.progress,
  usage: s.usage,
  events: s.events,
  received: s.tracking.received,
});

test("eight character looks have distinct grounded native activity frames", async () => {
  await observerFixture({}, async ({ page }) => {
    await ready(page);
    const groups = await page.evaluate(() =>
      Array.from({ length: 8 }, (_, actor) =>
        ["type", "read", "attention"].map((family) =>
          Array.from({ length: 4 }, (_, frame) => {
            const key = `person-${actor}-${family}-anim-${frame}`,
              c = officeStudio.characterLife.get(key),
              d = c.getContext("2d").getImageData(0, 0, 32, 36).data;
            let left = 32,
              right = -1,
              top = 36,
              bottom = -1;
            for (let i = 3; i < d.length; i += 4)
              if (d[i] >= 160) {
                const x = ((i - 3) / 4) % 32,
                  y = Math.floor((i - 3) / 4 / 32);
                left = Math.min(left, x);
                right = Math.max(right, x);
                top = Math.min(top, y);
                bottom = Math.max(bottom, y);
              }
            return {
              key,
              width: c.width,
              height: c.height,
              left,
              right,
              top,
              bottom,
              png: c.toDataURL(),
            };
          }),
        ),
      ),
    );
    for (const actor of groups)
      for (const family of actor) {
        assert.equal(new Set(family.map((f) => f.png)).size, 4, family[0].key);
        for (const f of family) {
          assert.equal(f.width, 32, f.key);
          assert.equal(f.height, 36, f.key);
          assert.equal(f.bottom, 34, f.key);
          assert.ok(
            f.left >= 3 && f.right <= 28 && f.top >= 4 && f.top < f.bottom,
            f.key,
          );
        }
      }
  });
});

test("actual character renderer follows work, input, walking and pause with independent base fallback", async () => {
  await observerFixture({}, async ({ page, state }) => {
    await ready(page);
    const before = accounting(await state());
    const selected = await page.evaluate(() => {
      const s = officeScene,
        original = { ctx: s.ctx, time: s.time, paused: s.paused },
        c = document.createElement("canvas"),
        out = [];
      c.width = c.height = 180;
      s.ctx = c.getContext("2d");
      s.paused = false;
      s.time = 0.75;
      const draw = s.ctx.drawImage.bind(s.ctx);
      s.ctx.drawImage = (image, ...args) => {
        for (const [pack, map] of [
          ["life", officeStudio.characterLife],
          ["walk", officeStudio.directional],
          ["base", officeStudio.sprites],
        ]) {
          const key = [...map].find(([, source]) => source === image)?.[0];
          if (key?.startsWith("person-")) {
            out.push({ pack, key, mirror: s.ctx.getTransform().a });
            break;
          }
        }
        return draw(image, ...args);
      };
      const actor = {
          id: "character-life-render",
          status: "working",
          tool: "Edit",
        },
        still = { moving: false };
      let removed;
      try {
        s.character(actor, 60, 60, still);
        s.character({ ...actor, tool: "Read" }, 60, 60, still);
        s.character({ ...actor, status: "waiting" }, 60, 60, still);
        s.paused = true;
        s.character(actor, 60, 60, still);
        s.paused = false;
        s.character(actor, 60, 60, { moving: true, dir: "left", distance: 6 });
        s.character({ ...actor, tool: "Bash" }, 60, 60, still);
        s.character(
          { ...actor, status: "done", detail: "⚠ Failed" },
          60,
          60,
          still,
        );
        s.character({ ...actor, status: "done" }, 60, 60, still);
        const lifeKey = out[0].key;
        removed = [lifeKey, officeStudio.characterLife.get(lifeKey)];
        officeStudio.characterLife.delete(lifeKey);
        s.character(actor, 60, 60, still);
      } finally {
        if (removed) officeStudio.characterLife.set(...removed);
        Object.assign(s, original);
      }
      return out;
    });
    assert.deepEqual(
      selected.map((v) => v.pack),
      ["life", "life", "life", "life", "walk", "base", "base", "base", "base"],
    );
    for (const [i, suffix] of [
      "type-anim-3",
      "read-anim-1",
      "attention-anim-1",
      "type-anim-0",
      "left-walk-b",
      "wait",
      "error",
      "cheer",
      "idle",
    ].entries()) {
      assert.ok(
        selected[i].key.endsWith("-" + suffix),
        JSON.stringify(selected[i]),
      );
      assert.equal(selected[i].mirror, 1);
    }
    assert.deepEqual(accounting(await state()), before);
  });
});

test("reported work and input use still activity poses with reduced motion at 320 pixels", async () => {
  const events = [
    {
      event: "session_start",
      session_id: "life-editor",
      platform: "claude",
      title: "Editing",
    },
    {
      event: "tool_start",
      session_id: "life-editor",
      platform: "claude",
      tool_name: "Edit",
      call_id: "edit-life",
    },
    {
      event: "session_start",
      session_id: "life-reader",
      platform: "codex",
      title: "Reading",
    },
    {
      event: "tool_start",
      session_id: "life-reader",
      platform: "codex",
      tool_name: "Read",
      call_id: "read-life",
    },
    {
      event: "session_start",
      session_id: "life-input",
      platform: "codex",
      title: "Review",
    },
    {
      event: "input_request",
      session_id: "life-input",
      platform: "codex",
      request_id: "life-question",
      question: "Review the change?",
    },
  ];
  await observerFixture(
    {
      events,
      settings: { max_chars: 4, sound_enabled: false, ambience: "day" },
      viewport: { width: 320, height: 760 },
      reducedMotion: "reduce",
    },
    async ({ page, state }) => {
      await ready(page);
      await page.waitForFunction(
        () =>
          officeScene.agents.filter(
            (a) => a.status === "working" || a.status === "waiting",
          ).length === 3,
      );
      assert.equal(await page.evaluate(() => officeScene.paused), true);
      const before = accounting(await state());
      const frames = await page.evaluate(() => {
        const s = officeScene,
          ctx = s.ctx,
          canvas = document.createElement("canvas"),
          out = [];
        canvas.width = canvas.height = 180;
        s.ctx = canvas.getContext("2d");
        const draw = s.ctx.drawImage.bind(s.ctx);
        s.ctx.drawImage = (image, ...args) => {
          const key = [...officeStudio.characterLife].find(
            ([, source]) => source === image,
          )?.[0];
          if (key) out.push(key);
          return draw(image, ...args);
        };
        try {
          for (const a of s.agents.filter(
            (a) => a.status === "working" || a.status === "waiting",
          ))
            s.character(a, 60, 60, { moving: false });
        } finally {
          s.ctx = ctx;
        }
        return { time: s.time, keys: out };
      });
      assert.equal(frames.keys.length, 3);
      assert.deepEqual(
        frames.keys.map((k) => k.replace(/^person-\d+-/, "")).sort(),
        ["attention-anim-0", "read-anim-0", "type-anim-0"],
      );
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => officeScene.time), frames.time);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      const dir = process.env.OFFICE_SCREENSHOTS || "reports/character-life";
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({
        path: path.join(dir, "working-room-320.png"),
        fullPage: true,
      });
      assert.deepEqual(accounting(await state()), before);
    },
  );
});
