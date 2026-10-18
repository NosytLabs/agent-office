/* Lossless screenshot pixels and actual responsive publication at mobile densities. */
const { test, before, after } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  http = require("node:http"),
  { spawnSync } = require("node:child_process"),
  { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."),
  prefix = "/project/about/";
let browser, server, directory, output, url;
before(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "office-site-images-"));
  output = path.join(directory, "site");
  const built = spawnSync(
    process.execPath,
    ["tools/build_site.mjs", "--out", output],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(built.status, 0, built.stderr);
  server = http.createServer((req, res) => {
    const route = new URL(req.url, "http://localhost").pathname;
    if (!route.startsWith(prefix)) return res.writeHead(404).end();
    const file = path.resolve(
      output,
      route.slice(prefix.length) || "index.html",
    );
    if (
      !file.startsWith(output + path.sep) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile()
    )
      return res.writeHead(404).end();
    const mime = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".webp": "image/webp",
      ".woff2": "font/woff2",
    };
    res.writeHead(200, {
      "Content-Type": mime[path.extname(file)] || "text/plain",
      "Content-Length": fs.statSync(file).size,
      "Cache-Control": "no-store",
    });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}${prefix}`;
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox"],
  });
});
after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((r) => server.close(r));
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
});

test("full-size public WebP screenshots retain every decoded source pixel", async () => {
  const page = await browser.newPage();
  try {
    for (const name of ["appearance", "usage", "settings", "aquarium"]) {
      const source = fs.readFileSync(
          path.join(root, `docs/screenshots/${name}.png`),
        ),
        webp = fs.readFileSync(
          path.join(output, `assets/screenshots/${name}-1440.webp`),
        );
      const result = await page.evaluate(
        async ({ png, webp }) => {
          const decode = async (type, b64) => {
            const i = new Image();
            i.src = `data:image/${type};base64,${b64}`;
            await i.decode();
            const c = document.createElement("canvas");
            c.width = i.naturalWidth;
            c.height = i.naturalHeight;
            const g = c.getContext("2d");
            g.drawImage(i, 0, 0);
            return {
              width: c.width,
              height: c.height,
              data: g.getImageData(0, 0, c.width, c.height).data,
            };
          };
          const a = await decode("png", png),
            b = await decode("webp", webp);
          return {
            width: b.width,
            height: b.height,
            equal:
              a.width === b.width &&
              a.height === b.height &&
              a.data.every((v, n) => v === b.data[n]),
          };
        },
        { png: source.toString("base64"), webp: webp.toString("base64") },
      );
      assert.deepEqual(
        result,
        { width: 1440, height: 1000, equal: true },
        name,
      );
      assert.ok(webp.length < source.length, name);
    }
  } finally {
    await page.close();
  }
});

test("mobile pages choose smaller lossless images and high-density screens keep a sharp source", async () => {
  for (const width of [320, 390])
    for (const density of [1, 2]) {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        deviceScaleFactor: density,
        reducedMotion: "reduce",
      });
      try {
        const page = await context.newPage(),
          errors = [],
          bad = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("response", (r) => {
          if (!r.ok()) bad.push(r.url());
        });
        await page.goto(url, { waitUntil: "networkidle" });
        await page.locator(".hero-image").evaluate((i) => i.decode());
        const metrics = await page.evaluate(() => ({
          src: document.querySelector(".hero-image").currentSrc,
          images: performance
            .getEntriesByType("resource")
            .filter((r) => r.name.includes("/screenshots/"))
            .map((r) => ({ name: r.name, bytes: r.encodedBodySize })),
          overflow: document.documentElement.scrollWidth > innerWidth,
        }));
        assert.ok(
          metrics.src.endsWith(
            density === 1 ? "appearance-480.webp" : "appearance-1440.webp",
          ),
          JSON.stringify(metrics),
        );
        assert.ok(
          metrics.images.every((r) => r.name.includes("appearance-")),
          "Unselected tour images stay unloaded",
        );
        const selected = metrics.images.find((r) => r.name === metrics.src);
        assert.ok(selected && selected.bytes > 0);
        assert.ok(
          selected.bytes < 115423 * (density === 1 ? 0.3 : 0.65),
          JSON.stringify(selected),
        );
        assert.equal(metrics.overflow, false);
        await page.getByRole("tab", { name: "1. Start" }).click();
        const copy = page.getByRole("button", { name: "Copy start commands" }),
          box = await copy.boundingBox();
        assert.ok(box.width >= 44 && box.height >= 44, JSON.stringify(box));
        const textBox = await page
          .locator("#command-start code")
          .evaluate((element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            return range.getBoundingClientRect().toJSON();
          });
        assert.ok(
          textBox.top >= box.y + box.height + 8,
          "Copy must not cover the command text",
        );
        await page.getByRole("link", { name: "Credits & licenses" }).click();
        assert.equal(
          await page.locator(".skip-link").textContent(),
          "Skip to credits",
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        assert.deepEqual(errors, []);
        assert.deepEqual(bad, []);
      } finally {
        await context.close();
      }
    }
});
