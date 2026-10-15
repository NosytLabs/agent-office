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
async function withPage(run, { classic = false, sourceFallback = false } = {}) {
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
        )
      )
        bad.push(response.url());
    });
    await page.goto(origin + prefix);
    await page.waitForFunction(
      () => initialized && window._state?.mode === "demo",
    );
    await run(page, requests);
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
    assert.ok(
      await page.evaluate(
        () =>
          officeStudio.petDirectional.size > 0 &&
          officeStudio.surfaces.size > 0,
      ),
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
