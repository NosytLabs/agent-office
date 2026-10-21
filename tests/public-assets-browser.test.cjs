/* Exercise the reduced public package, including its genuine source fallback. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawnSync } = require("node:child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const prefix = "/";
let temporary, output, server, browser, origin;

before(async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "office-public-package-"));
  output = path.join(temporary, "site");
  const built = spawnSync(
    process.execPath,
    ["tools/build_preview.mjs", "--out", output],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(built.status, 0, built.stderr);
  const types = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
    ".mp3": "audio/mpeg",
  };
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (!pathname.startsWith(prefix)) return res.writeHead(404).end();
    const file = path.resolve(
      output,
      pathname.slice(prefix.length) || "index.html",
    );
    if (
      !file.startsWith(output + path.sep) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile()
    )
      return res.writeHead(404).end();
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "text/plain",
      "Cache-Control": "no-store",
    });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox"],
  });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
});
async function withPage(
  run,
  {
    classic = false,
    sourceFallback = false,
    beforeNavigate,
    expectedFailures = [],
    navigationTimeout = 10000,
  } = {},
) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  try {
    if (classic)
      await context.addInitScript(() =>
        localStorage.setItem(
          "agent-office:studio:v1:preview",
          JSON.stringify({ art: "classic" }),
        ),
      );
    if (sourceFallback)
      await context.route("**/assets/sprites/runtime/manifest.json", (route) =>
        route.fulfill({ status: 404, body: "forced missing compact manifest" }),
      );
    if (beforeNavigate) await beforeNavigate(context);
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [],
      requests = [],
      bad = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) =>
      requests.push({ url: request.url(), method: request.method() }),
    );
    page.on("response", (response) => {
      if (
        !response.ok() &&
        !(
          sourceFallback &&
          response.url().endsWith("/assets/sprites/runtime/manifest.json")
        ) &&
        !expectedFailures.includes(new URL(response.url()).pathname)
      )
        bad.push(response.url());
    });
    await page.goto(origin + prefix, { timeout: navigationTimeout });
    await page.waitForFunction(
      () => initialized && window._state?.mode === "demo",
    );
    await run(page, requests, context);
    assert.deepEqual(errors, []);
    assert.deepEqual(bad, []);
    assert.ok(
      requests.every(
        (request) =>
          request.method === "GET" && request.url.startsWith(origin + prefix),
      ),
      "The package must use only local static GET requests",
    );
    assert.ok(
      !requests.some((request) =>
        /\/(?:state|settings|history)(?:[?]|$)/.test(request.url),
      ),
      "Synthetic APIs never contact a live observer",
    );
    assert.ok(
      !requests.some((request) =>
        /\/source\/|\/generated-[^/]+\.json|asset-checksums\.json|\/js\/upstream\.js/.test(
          request.url,
        ),
      ),
      "No authoring input is a browser dependency",
    );
  } finally {
    await context.close();
  }
}

test("the reduced public demo loads Studio supplements and exports a sprite without authoring files", () =>
  withPage(async (page) => {
    await page.waitForFunction(
      () => window.officeStudio?.ready && !officeStudio.loading,
    );
    assert.equal(await page.evaluate(() => officeStudio.source), "studio");
    assert.equal(
      await page.evaluate(() => officeScene.spriteAssetSource),
      "native",
    );
    assert.equal(
      await page.evaluate(() => officeStudio.directionalReady),
      true,
    );
    assert.deepEqual(
      await page.evaluate(() => ({
        pets: officeStudio.petDirectional.size,
        petLife: officeStudio.petLife.size,
        characters: officeStudio.characterLife.size,
        reactions: officeStudio.characterReactions.size,
        surfaces: officeStudio.surfaces.size,
        error: officeStudio.environmentError,
      })),
      {
        pets: 96,
        petLife: 96,
        characters: 96,
        reactions: 96,
        surfaces: 4,
        error: "",
      },
    );
    await page.locator("#settingsbtn").click();
    await page.locator("#studio-gallery summary").click();
    await page.locator("#studio-sprite-search").fill("fern");
    const download = page.waitForEvent("download");
    await page.locator("#studio-sprite-download").click();
    const image = fs.readFileSync(await (await download).path());
    assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    await page.keyboard.press("Escape");
    fs.mkdirSync("reports/public-assets", { recursive: true });
    await page.screenshot({ path: "reports/public-assets/studio-packed.png" });
  }));

test("valid slow artwork transfers keep the compact and Studio packs without source fallback", () => {
  const delayed = [
    "/assets/sprites/runtime/manifest.json",
    "/assets/sprites/runtime/office.png",
    "/assets/sprites/studio/studio.json",
    "/assets/sprites/studio/studio-0.png",
    "/assets/sprites/studio/directional.json",
  ];
  const reached = new Set();
  return withPage(
    async (page, requests) => {
      await page.waitForFunction(
        () =>
          window.officeStudio &&
          !officeStudio.loading &&
          officeScene.spriteAssetSource !== "loading",
        null,
        { timeout: 35000 },
      );
      assert.equal(
        await page.evaluate(() => officeScene.spriteAssetSource),
        "native",
      );
      assert.equal(await page.evaluate(() => officeStudio.source), "studio");
      assert.equal(
        await page.evaluate(() => officeStudio.directionalReady),
        true,
      );
      assert.deepEqual(
        await page.evaluate(() => [
          officeStudio.error,
          officeStudio.directionalError,
          officeStudio.environmentError,
        ]),
        ["", "", ""],
      );
      assert.deepEqual([...reached].sort(), delayed.slice().sort());
      assert.equal(
        requests.some(({ url }) =>
          /\/assets\/sprites\/(?!runtime\/|studio\/)/.test(
            new URL(url).pathname,
          ),
        ),
        false,
        "valid delayed transfers do not fan out into legacy source-sheet requests",
      );
      await page.click("#settingsbtn");
      await page.fill("#room-name-input", "Slow artwork stays usable");
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#room-view-toggle").isEnabled(), true);
    },
    {
      navigationTimeout: 35000,
      beforeNavigate: async (context) => {
        let closed = false;
        context.on("close", () => {
          closed = true;
        });
        for (const pathname of delayed)
          await context.route("**" + pathname, async (route) => {
            reached.add(pathname);
            const response = await route.fetch();
            await new Promise((resolve) => setTimeout(resolve, 6000));
            if (!closed) await route.fulfill({ response });
          });
      },
    },
  );
});

async function accounting(page) {
  return page.evaluate(async () => {
    const state = await (await fetch("state")).json();
    return {
      progress: state.progress,
      usage: state.usage,
      events: state.events,
      received: state.tracking.received,
    };
  });
}

for (const fault of ["manifest", "image", "integrity"])
  test(`the public character pack recovers from ${fault} failure without losing drafts or accounting`, async () => {
    const pathname =
        prefix +
        `assets/sprites/studio/character-life.${fault === "image" ? "png" : "json"}`,
      routePattern = "**" + pathname;
    let attempts = 0;
    await withPage(
      async (page, requests, context) => {
        await page.waitForFunction(
          () => window.officeStudio?.ready && !officeStudio.loading,
        );
        assert.ok(attempts > 0, "the controlled fault was exercised");
        assert.deepEqual(
          await page.evaluate(() => ({
            base: officeStudio.sprites.size,
            people: officeStudio.directional.size,
            pets: officeStudio.petDirectional.size,
            life: officeStudio.petLife.size,
            surfaces: officeStudio.surfaces.size,
            characters: officeStudio.characterLife.size,
          })),
          {
            base: 197,
            people: 96,
            pets: 96,
            life: 96,
            surfaces: 4,
            characters: 0,
          },
          "an optional pack failure keeps all other artwork usable",
        );
        assert.match(
          await page.evaluate(() => officeStudio.environmentError),
          fault === "integrity"
            ? /character-life pixels failed integrity check/
            : /character-life/,
        );
        const before = await accounting(page);
        await page.locator("#tasksbtn").click();
        await page.locator('[data-task-view="draft"]').click();
        await page
          .locator("#task-draft-text")
          .fill("Keep this public demo brief unsent.");
        await page.locator("#sheet-tasks .close").click();
        await page.locator("#settingsbtn").click();
        await page.locator("#room-name-input").fill("Unsent public room draft");
        await page.evaluate(() => {
          window.__publicRetryDocument = true;
        });
        await context.unroute(routePattern);
        await page.locator("#studio-art-retry").click();
        await page.waitForFunction(
          () => !officeStudio.loading && officeStudio.characterLife.size === 96,
        );
        assert.equal(
          await page.evaluate(() => officeStudio.environmentError),
          "",
        );
        assert.equal(
          await page.evaluate(() => window.__publicRetryDocument),
          true,
        );
        assert.equal(
          await page.locator("#room-name-input").inputValue(),
          "Unsent public room draft",
        );
        assert.equal(await page.locator("#studio-art-retry").isHidden(), true);
        assert.ok(
          requests.some(
            (request) =>
              new URL(request.url).pathname ===
              prefix + "assets/sprites/studio/character-life.png",
          ),
        );
        await page.locator("#sheet-settings .close").click();
        await page.locator("#tasksbtn").click();
        await page.locator('[data-task-view="draft"]').click();
        assert.equal(
          await page.locator("#task-draft-text").inputValue(),
          "Keep this public demo brief unsent.",
        );
        assert.deepEqual(await accounting(page), before);
      },
      {
        expectedFailures: fault === "integrity" ? [] : [pathname],
        beforeNavigate: async (context) => {
          await context.route(routePattern, (route) => {
            attempts++;
            if (fault !== "integrity")
              return route.fulfill({
                status: 404,
                body: "controlled missing character pack",
              });
            const manifest = JSON.parse(
              fs.readFileSync(
                path.join(output, pathname.slice(prefix.length)),
                "utf8",
              ),
            );
            manifest.rgbaSha256 = "0".repeat(64);
            return route.fulfill({ status: 200, json: manifest });
          });
        },
      },
    );
  });

test("the reduced demo retains every Classic sheet when the compact atlas is unavailable", () =>
  withPage(
    async (page, requests) => {
      await page.waitForFunction(
        () =>
          officeScene.spriteAssetSource === "source" &&
          officeScene.loadedAssets === 23,
      );
      assert.equal(
        await page.locator("html").getAttribute("data-office-art"),
        "classic",
      );
      assert.deepEqual(await page.evaluate(() => officeScene.assetErrors), []);
      const manifest = JSON.parse(
        fs.readFileSync(
          path.join(root, "web/assets/sprites/runtime/manifest.json"),
          "utf8",
        ),
      );
      const loaded = new Set(
        requests.map((request) => new URL(request.url).pathname),
      );
      for (const file of Object.keys(manifest.sources))
        assert.ok(loaded.has(prefix + "assets/sprites/" + file), file);
      await page.locator("#floorbtn").click();
      assert.ok((await page.locator("#roster .agent-card").count()) > 0);
      fs.mkdirSync("reports/public-assets", { recursive: true });
      await page.screenshot({
        path: "reports/public-assets/classic-source-packed.png",
      });
    },
    { classic: true, sourceFallback: true },
  ));

test("the packaged Duck Hunt loads its derived runtime without the authoring bundle", () =>
  withPage(async (page, requests) => {
    await page.locator("#arcade-open").click();
    await page.locator("#arcade-game-duck-hunt").click();
    await page.locator("#arcade-duck-start").click();
    await page.waitForFunction(() => officeArcade.snapshot().duck.ready);
    const frame = page.locator("#arcade-duck-frame");
    assert.equal(await frame.getAttribute("sandbox"), "allow-scripts");
    await frame.contentFrame().locator("#canvas").waitFor({ state: "visible" });
    assert.ok(
      requests.some((request) =>
        new URL(request.url).pathname.endsWith("/arcade/duck-hunt/js/game.js"),
      ),
    );
    assert.ok(
      !fs.existsSync(path.join(output, "arcade/duck-hunt/js/upstream.js")),
    );
  }));
