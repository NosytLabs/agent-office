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
  assert.equal(
    await page.evaluate(() => officeStudio.characterReactions.size),
    96,
  );
}
const accounting = (s) => ({
  progress: s.progress,
  usage: s.usage,
  events: s.events,
  received: s.tracking.received,
});

test("reaction loops are native, grounded, distinct and remain independently recoverable", async () => {
  await observerFixture({}, async ({ page, state }) => {
    await ready(page);
    const before = accounting(await state());
    const groups = await page.evaluate(() =>
      Array.from({ length: 8 }, (_, actor) =>
        ["idle", "cheer", "error"].map((family) =>
          Array.from({ length: 4 }, (_, frame) => {
            const key = `person-${actor}-${family}-anim-${frame}`,
              c = officeStudio.characterReactions.get(key),
              pixels = c
                .getContext("2d")
                .getImageData(0, 0, c.width, c.height).data;
            let bottom = -1,
              left = c.width,
              right = -1;
            for (let i = 3; i < pixels.length; i += 4)
              if (pixels[i] >= 160) {
                const x = ((i - 3) / 4) % c.width;
                bottom = Math.max(bottom, Math.floor((i - 3) / 4 / c.width));
                left = Math.min(left, x);
                right = Math.max(right, x);
              }
            return {
              key,
              width: c.width,
              height: c.height,
              bottom,
              left,
              right,
              png: c.toDataURL(),
            };
          }),
        ),
      ),
    );
    for (const actor of groups)
      for (const family of actor) {
        assert.ok(new Set(family.map((f) => f.png)).size >= 2, family[0].key);
        for (const frame of family) {
          assert.equal(frame.width, 32, frame.key);
          assert.equal(frame.height, 36, frame.key);
          assert.equal(frame.bottom, 34, frame.key);
          assert.ok(frame.left >= 3 && frame.right <= 28, frame.key);
        }
      }
    await page.click("#settingsbtn");
    await page.locator("#studio-gallery summary").click();
    await page.fill("#room-name-input", "Keep this reaction draft");
    await page.route("**/studio/character-reactions.png*", (route) =>
      route.fulfill({ status: 404, body: "missing" }),
    );
    await page.evaluate(() => officeStudio.reload());
    assert.equal(
      await page.evaluate(() => officeStudio.characterReactions.size),
      0,
    );
    assert.equal(
      await page.evaluate(() => officeStudio.characterLife.size),
      96,
    );
    assert.equal(await page.evaluate(() => officeStudio.directional.size), 96);
    assert.equal(await page.evaluate(() => officeStudio.ready), true);
    await page.fill("#studio-sprite-search", "person 0 cheer anim");
    assert.equal(await page.locator("#studio-sprite-choice option").count(), 0);
    assert.equal(
      await page.locator("#studio-strip-download").isDisabled(),
      true,
    );
    await page.unroute("**/studio/character-reactions.png*");
    await page.click("#studio-art-retry");
    await page.waitForFunction(
      () =>
        !officeStudio.loading && officeStudio.characterReactions.size === 96,
    );
    assert.equal(await page.locator("#studio-sprite-choice option").count(), 4);
    assert.equal(
      await page.inputValue("#room-name-input"),
      "Keep this reaction draft",
    );
    assert.deepEqual(accounting(await state()), before);
  });
});

test("reaction strips export native pixels in order and the actual renderer freezes them on Pause", async () => {
  await observerFixture({}, async ({ page }) => {
    await ready(page);
    await page.click("#settingsbtn");
    await page.locator("#studio-gallery summary").click();
    await page.fill("#studio-sprite-search", "person 7 celebrating");
    await page.selectOption("#studio-sprite-choice", "person-7-cheer-anim-2");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#studio-strip-download"),
    ]);
    const bytes = fs.readFileSync(await download.path());
    assert.equal(bytes.readUInt32BE(16), 128);
    assert.equal(bytes.readUInt32BE(20), 36);
    assert.equal(
      await page.evaluate(async (base64) => {
        const image = new Image();
        image.src = "data:image/png;base64," + base64;
        await image.decode();
        const c = document.createElement("canvas"),
          expected = document.createElement("canvas");
        c.width = expected.width = 128;
        c.height = expected.height = 36;
        c.getContext("2d").drawImage(image, 0, 0);
        for (let frame = 0; frame < 4; frame++)
          expected
            .getContext("2d")
            .drawImage(
              officeStudio.characterReactions.get(
                `person-7-cheer-anim-${frame}`,
              ),
              frame * 32,
              0,
            );
        const actual = c.getContext("2d").getImageData(0, 0, 128, 36).data,
          reference = expected
            .getContext("2d")
            .getImageData(0, 0, 128, 36).data;
        return actual.every((value, i) => value === reference[i]);
      }, bytes.toString("base64")),
      true,
    );
    const drawn = await page.evaluate(() => {
      const s = officeScene,
        saved = { ctx: s.ctx, time: s.time, paused: s.paused },
        canvas = document.createElement("canvas"),
        out = [];
      canvas.width = canvas.height = 180;
      s.ctx = canvas.getContext("2d");
      s.ctx.drawImage = (image) => {
        const key = [...officeStudio.characterReactions].find(
          ([, v]) => v === image,
        )?.[0];
        if (key) out.push(key);
      };
      try {
        for (const paused of [false, true])
          for (const status of ["idle", "done"]) {
            s.paused = paused;
            s.time = 2.125;
            s.character({ id: "reactions", status }, 60, 60, { moving: false });
          }
        s.character(
          { id: "reactions", status: "done", detail: "⚠ Failed" },
          60,
          60,
          { moving: false },
        );
      } finally {
        Object.assign(s, saved);
      }
      return out.map((key) => key.replace(/^person-\d+-/, ""));
    });
    assert.deepEqual(drawn, [
      "idle-anim-2",
      "cheer-anim-2",
      "idle-anim-0",
      "cheer-anim-0",
      "error-anim-0",
    ]);
  });
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
          ["reactions", officeStudio.characterReactions],
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
      [
        "life",
        "life",
        "life",
        "life",
        "walk",
        "base",
        "reactions",
        "reactions",
        "base",
      ],
    );
    for (const [i, suffix] of [
      "type-anim-3",
      "read-anim-1",
      "attention-anim-1",
      "type-anim-0",
      "left-walk-b",
      "wait",
      "error-anim-0",
      "cheer-anim-2",
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
