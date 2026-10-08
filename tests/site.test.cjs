/* Actual static product site under a GitHub Pages-style project subpath. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawnSync } = require("node:child_process");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const origin = "http://127.0.0.1:18125";
const prefix = "/agent-office/";
const url = origin + prefix;
const screenshots =
  process.env.OFFICE_SITE_SCREENSHOTS || path.join(root, "reports/site");
let temporary, output, server, browser;

before(async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "office-product-site-"));
  output = path.join(temporary, "site");
  const built = spawnSync(
    process.execPath,
    ["tools/build_site.mjs", "--out", output],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(built.status, 0, built.stderr);
  const types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".txt": "text/plain",
  };
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, origin).pathname;
    if (!pathname.startsWith(prefix))
      return res.writeHead(404).end("outside project site");
    const relative = pathname.slice(prefix.length) || "index.html";
    const file = path.resolve(output, relative);
    if (
      !file.startsWith(output + path.sep) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile()
    )
      return res.writeHead(404).end("not found");
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(18125, "127.0.0.1", resolve);
  });
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox"],
  });
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
});

async function withPage(run, options = {}) {
  const { clipboardBlocked, ...contextOptions } = options;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ...contextOptions,
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    const errors = [],
      badResponses = [],
      network = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("response", (r) => {
      if (!r.ok()) badResponses.push(`${r.status()} ${r.url()}`);
    });
    page.on("request", (r) =>
      network.push({ url: r.url(), method: r.method() }),
    );
    if (clipboardBlocked)
      await page.addInitScript(() =>
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async () => {
              throw new DOMException("Clipboard denied", "NotAllowedError");
            },
          },
        }),
      );
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    await run(page, context);
    assert.deepEqual(errors, []);
    assert.deepEqual(badResponses, []);
    assert.ok(
      network.every((r) => r.url.startsWith(url) && r.method === "GET"),
      "The landing page must not connect to analytics, runtimes, or a model provider",
    );
    assert.equal(await page.evaluate(() => localStorage.length), 0);
  } finally {
    await context.close();
  }
}

async function capture(page, name, fullPage = true) {
  fs.mkdirSync(screenshots, { recursive: true });
  await page.screenshot({
    path: path.join(screenshots, name + ".png"),
    fullPage,
  });
}

test("desktop product site loads its real screenshots and local assets under a project path", () =>
  withPage(async (page) => {
    assert.match(await page.title(), /Agent Office/);
    assert.equal(await page.locator("h1").count(), 1);
    assert.match(
      await page.locator(".hero-note").innerText(),
      /Free.*open source/,
    );
    assert.match(
      await page.locator(".tour-caption").innerText(),
      /synthetic test sessions/,
    );
    assert.match(
      await page.locator(".coverage-note").innerText(),
      /host-level validation/,
    );
    assert.equal(
      await page
        .getByRole("link", { name: "Explore the demo" })
        .getAttribute("href"),
      "https://agent-office-preview-seven.vercel.app/",
    );
    const image = page.locator(".hero-image");
    await image.evaluate((i) => i.decode());
    assert.equal(await image.evaluate((i) => i.naturalWidth), 1440);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await capture(page, "desktop-hero", false);
    await capture(page, "desktop-product-site");
  }));

test("feature tour supports manual keyboard tabs and loads each actual screenshot", () =>
  withPage(async (page) => {
    const list = page.getByRole("tablist", { name: "Office feature tour" });
    const tabs = list.getByRole("tab");
    await tabs.first().focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await tabs.nth(1).evaluate((e) => e === document.activeElement),
      true,
    );
    assert.equal(await tabs.first().getAttribute("aria-selected"), "true");
    await page.keyboard.press("Space");
    assert.equal(await tabs.nth(1).getAttribute("aria-selected"), "true");
    assert.equal(await page.locator("#tour-floor").isVisible(), false);
    assert.equal(await page.locator("#tour-usage").isVisible(), true);
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    assert.equal(await tabs.last().getAttribute("aria-selected"), "true");
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    assert.equal(await tabs.first().getAttribute("aria-selected"), "true");
    for (let i = 0; i < 4; i++) {
      await tabs.nth(i).click();
      const target = await tabs.nth(i).getAttribute("aria-controls");
      const panel = page.locator(`#${target}`);
      assert.equal(
        await page
          .locator('[data-tab-group="tour"] [role="tabpanel"]:visible')
          .count(),
        1,
      );
      await panel.locator("img").evaluate((image) => image.decode());
      assert.ok(
        await panel.locator("img").evaluate((image) => image.naturalHeight > 0),
      );
    }
    await capture(page, "aquarium-feature-tour", false);
  }));

test("install commands copy exact multiline text to the browser clipboard", () =>
  withPage(async (page, context) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin,
    });
    await page.getByRole("button", { name: "Copy start commands" }).click();
    const expected =
      "git clone https://github.com/NosytLabs/agent-office.git\ncd agent-office\npython3 run.py";
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      expected,
    );
    assert.match(await page.locator("#copy-status").innerText(), /^Copied/);
    await page.getByRole("tab", { name: "2. Connect" }).click();
    await page.getByRole("button", { name: "Copy connection command" }).click();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      "python3 install.py",
    );
    await page.getByRole("tab", { name: "3. Editor" }).click();
    await page.getByRole("button", { name: "Copy VS Code command" }).click();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      "Agent Office: Open Floor",
    );
  }));

test("clipboard denial provides a selected command and an honest recovery message", () =>
  withPage(
    async (page) => {
      await page.getByRole("button", { name: "Copy start commands" }).click();
      assert.match(
        await page.locator("#copy-status").innerText(),
        /unavailable.*selected/,
      );
      assert.equal(
        await page.evaluate(() => window.getSelection().toString()),
        "git clone https://github.com/NosytLabs/agent-office.git\ncd agent-office\npython3 run.py",
      );
      assert.equal(
        await page
          .locator("#command-start")
          .evaluate((e) => e === document.activeElement),
        true,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Copy start commands" })
          .isEnabled(),
        true,
      );
    },
    { clipboardBlocked: true },
  ));

test("mobile menu closes with Escape and navigation leaves focus in the selected section", () =>
  withPage(
    async (page) => {
      const menu = page.getByRole("button", { name: "Menu" });
      await menu.click();
      assert.equal(await menu.getAttribute("aria-expanded"), "true");
      await page.keyboard.press("Escape");
      assert.equal(await menu.getAttribute("aria-expanded"), "false");
      assert.equal(
        await menu.evaluate((e) => e === document.activeElement),
        true,
      );
      await menu.click();
      await page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Connections" })
        .click();
      assert.equal(await menu.getAttribute("aria-expanded"), "false");
      assert.equal(new URL(page.url()).hash, "#connections");
      assert.equal(
        await page
          .locator("#connections")
          .evaluate((e) => e === document.activeElement),
        true,
      );
      await page.locator("#top").scrollIntoViewIfNeeded();
      await capture(page, "mobile-390-product-site");
    },
    { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  ));

test("320px and tablet layouts retain usable controls with no horizontal page overflow", () =>
  withPage(async (page) => {
    for (const width of [320, 768, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator("#top").scrollIntoViewIfNeeded();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `overflow at ${width}px`,
      );
      for (const control of [
        page.getByRole("link", { name: "Run locally", exact: true }),
        page.getByRole("tab", { name: "1. Start" }),
      ]) {
        const box = await control.boundingBox();
        assert.ok(
          box.width >= 44 && box.height >= 44,
          `small touch control at ${width}px`,
        );
      }
      const tabs = page
        .getByRole("tablist", { name: "Office feature tour" })
        .getByRole("tab");
      for (let i = 0; i < 4; i++) {
        await tabs.nth(i).click();
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
          `tour ${i} overflows at ${width}px`,
        );
      }
      if (width === 320) {
        await page.locator("#top").scrollIntoViewIfNeeded();
        await capture(page, "mobile-320-product-site");
      }
    }
  }));

test("content, installation steps, credits, and native FAQs work without JavaScript", () =>
  withPage(
    async (page) => {
      assert.equal(await page.locator("[data-tab-panel]:visible").count(), 7);
      assert.equal(
        await page
          .getByRole("button", { name: "Copy start commands" })
          .isVisible(),
        false,
      );
      assert.equal(
        await page
          .getByRole("navigation", { name: "Main navigation" })
          .isVisible(),
        true,
      );
      await page
        .locator("#questions details")
        .first()
        .locator("summary")
        .click();
      assert.match(
        await page.locator("#questions details[open]").innerText(),
        /respond|original runtime/,
      );
      await page.getByRole("link", { name: "Credits & licenses" }).click();
      assert.equal(page.url(), url + "credits.html");
      assert.match(
        await page.locator("main").innerText(),
        /Smallburg packs are not included/,
      );
      assert.equal(
        await page.locator("h1").textContent(),
        "Credits & licenses",
      );
    },
    { javaScriptEnabled: false, viewport: { width: 390, height: 844 } },
  ));

test("reduced-motion preference removes animated scrolling and hover movement", () =>
  withPage(
    async (page) => {
      assert.equal(
        await page.evaluate(
          () => getComputedStyle(document.documentElement).scrollBehavior,
        ),
        "auto",
      );
      const cta = page.getByRole("link", { name: "Run locally", exact: true });
      await cta.hover();
      assert.equal(
        await cta.evaluate((e) => getComputedStyle(e).transform),
        "none",
      );
    },
    { reducedMotion: "reduce" },
  ));
