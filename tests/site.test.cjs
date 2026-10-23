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
    ".webp": "image/webp",
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
  const { clipboardBlocked, clipboardDeferred, ...contextOptions } = options;
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
    if (clipboardDeferred)
      await page.addInitScript(() => {
        window.pendingCopies = [];
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: (text) =>
              new Promise((resolve, reject) =>
                window.pendingCopies.push({ text, resolve, reject }),
              ),
          },
        });
      });
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
    assert.equal(
      await page
        .getByRole("link", { name: "Explore the demo" })
        .getAttribute("href"),
      "https://agent-office-preview-seven.vercel.app/",
    );
    const image = page.locator(".hero-image");
    await image.evaluate((i) => i.decode());
    const dimensions = await image.evaluate((i) => ({
      width: i.naturalWidth,
      height: i.naturalHeight,
    }));
    assert.ok(dimensions.width > 0 && dimensions.height > 0);
    assert.ok(
      Math.abs(dimensions.width / dimensions.height - 1440 / 1000) < 0.005,
      "The decoded hero keeps the source aspect ratio: " +
        JSON.stringify(dimensions),
    );
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
      "python3 install.py --dry-run\npython3 install.py --only codex",
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

async function finishCopy(page, index, result, target) {
  await page.evaluate(
    ({ index, result }) => {
      const pending = window.pendingCopies[index];
      if (result === "resolve") pending.resolve();
      else
        pending.reject(new DOMException("Clipboard denied", "NotAllowedError"));
    },
    { index, result },
  );
  await page.waitForFunction((target) => {
    const button = document.querySelector(`[data-copy-target="${target}"]`);
    return !button.disabled && button.getAttribute("aria-disabled") !== "true";
  }, target);
}

test("delayed clipboard results cannot change feedback or select a command after setup tabs change", async () => {
  for (const [result, returnToStart] of [
    ["resolve", false],
    ["reject", false],
    ["reject", true],
  ])
    await withPage(
      async (page) => {
        await page.getByRole("button", { name: "Copy start commands" }).click();
        await page.getByRole("tab", { name: "2. Connect" }).click();
        if (returnToStart)
          await page.getByRole("tab", { name: "1. Start" }).click();
        const tab = page.getByRole("tab", {
          name: returnToStart ? "1. Start" : "2. Connect",
        });
        await finishCopy(page, 0, result, "command-start");
        assert.equal(await page.locator("#copy-status").textContent(), "");
        assert.equal(
          await tab.evaluate((element) => document.activeElement === element),
          true,
        );
        assert.equal(
          await page.evaluate(() =>
            window
              .getSelection()
              .containsNode(document.getElementById("command-start"), true),
          ),
          false,
        );
      },
      { clipboardDeferred: true },
    );
});

test("an older clipboard attempt cannot replace a newer copy result", async () => {
  for (const [older, newer] of [
    ["reject", "resolve"],
    ["resolve", "reject"],
  ])
    await withPage(
      async (page) => {
        await page.getByRole("button", { name: "Copy start commands" }).click();
        await page.getByRole("tab", { name: "2. Connect" }).click();
        await page
          .getByRole("button", { name: "Copy connection command" })
          .click();
        await finishCopy(page, 1, newer, "command-connect");
        const message = await page.locator("#copy-status").textContent(),
          focused = await page.evaluate(() => document.activeElement.id),
          selection = await page.evaluate(() =>
            window.getSelection().toString(),
          );
        assert.match(message, newer === "resolve" ? /^Copied/ : /unavailable/);
        await finishCopy(page, 0, older, "command-start");
        assert.equal(await page.locator("#copy-status").textContent(), message);
        assert.equal(
          await page.evaluate(() => document.activeElement.id),
          focused,
        );
        assert.equal(
          await page.evaluate(() => window.getSelection().toString()),
          selection,
        );
      },
      { clipboardDeferred: true },
    );
});

test("a delayed clipboard fallback respects focus moved to another visible control", () =>
  withPage(
    async (page) => {
      const copy = page.getByRole("button", { name: "Copy start commands" });
      await copy.click();
      const tab = page.getByRole("tab", { name: "1. Start" });
      await tab.focus();
      await finishCopy(page, 0, "reject", "command-start");
      assert.equal(
        await tab.evaluate((element) => document.activeElement === element),
        true,
      );
      assert.equal(
        await page.evaluate(() =>
          window
            .getSelection()
            .containsNode(document.getElementById("command-start"), true),
        ),
        false,
      );
      assert.match(
        await page.locator("#copy-status").textContent(),
        /unavailable.*manually/,
      );
      assert.doesNotMatch(
        await page.locator("#copy-status").textContent(),
        /is selected/,
      );
    },
    { clipboardDeferred: true },
  ));

test("pending clipboard work retains keyboard focus and prevents duplicate copies", () =>
  withPage(
    async (page) => {
      const copy = page.getByRole("button", { name: "Copy start commands" });
      await copy.click();
      assert.equal(
        await copy.evaluate((element) => document.activeElement === element),
        true,
      );
      assert.equal(await copy.getAttribute("aria-disabled"), "true");
      await page.keyboard.press("Enter");
      assert.equal(await page.evaluate(() => window.pendingCopies.length), 1);
      await finishCopy(page, 0, "resolve", "command-start");
      assert.equal(
        await copy.evaluate((element) => document.activeElement === element),
        true,
      );
      await page.keyboard.press("Enter");
      assert.equal(await page.evaluate(() => window.pendingCopies.length), 2);
      await finishCopy(page, 1, "resolve", "command-start");
    },
    { clipboardDeferred: true },
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
      assert.equal(await page.locator("[data-tab-panel]:visible").count(), 8);
      assert.equal(await page.locator("#setup-run").isVisible(), true);
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

test("responsive navigation returns focus to a visible control when desktop links collapse", () =>
  withPage(
    async (page) => {
      const navigation = page.getByRole("navigation", {
        name: "Main navigation",
      });
      await navigation
        .getByRole("link", { name: "Connections", exact: true })
        .focus();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(
        () => document.activeElement === document.querySelector(".menu-toggle"),
      );
      assert.equal(await navigation.isVisible(), false);
      const menu = page.getByRole("button", { name: "Menu" });
      assert.equal(await menu.isVisible(), true);
      await page.keyboard.press("Enter");
      assert.equal(await navigation.isVisible(), true);
      await page.keyboard.press("Tab");
      assert.equal(
        await navigation
          .getByRole("link", { name: "The office", exact: true })
          .evaluate((e) => e === document.activeElement),
        true,
      );
      await page.keyboard.press("Escape");
      assert.equal(
        await menu.evaluate((e) => e === document.activeElement),
        true,
      );
      await page.setViewportSize({ width: 651, height: 900 });
      await page.waitForFunction(
        () => document.activeElement === document.querySelector("#site-nav a"),
      );
      assert.equal(await navigation.isVisible(), true);
      const contentLink = page.getByRole("link", {
        name: "Run locally",
        exact: true,
      });
      await contentLink.focus();
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await contentLink.evaluate((e) => e === document.activeElement),
        true,
      );
    },
    { viewport: { width: 768, height: 900 } },
  ));

test("mobile navigation closes when keyboard focus continues into page content", () =>
  withPage(
    async (page) => {
      const menu = page.getByRole("button", { name: "Menu" });
      const navigation = page.getByRole("navigation", {
        name: "Main navigation",
      });
      await menu.click();
      await navigation.getByRole("link", { name: "Get started" }).focus();
      await page.keyboard.press("Tab");
      const next = page.getByRole("link", { name: "Run locally", exact: true });
      assert.equal(
        await next.evaluate((e) => e === document.activeElement),
        true,
      );
      assert.equal(await menu.getAttribute("aria-expanded"), "false");
      assert.equal(await navigation.isVisible(), false);
      // Native keyboard focus can initiate smooth scrolling; wait for the
      // visible outcome rather than sampling the first animation frame.
      await page.waitForFunction(() => {
        const target = document.activeElement;
        const box = target.getBoundingClientRect();
        return target.contains(
          document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          ),
        );
      });
      const visible = await next.evaluate((e) => {
        const box = e.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        return {
          visible: e.contains(hit),
          box: box.toJSON(),
          hit: hit?.tagName,
          scrollY,
          height: innerHeight,
          header: document
            .querySelector(".site-header")
            .getBoundingClientRect()
            .toJSON(),
        };
      });
      assert.equal(
        visible.visible,
        true,
        "The continued keyboard target is not covered by the sticky header: " +
          JSON.stringify(visible),
      );
    },
    { viewport: { width: 390, height: 320 } },
  ));

test("a direct setup link reveals its command panel and later fragment navigation remains usable", () =>
  withPage(
    async (page) => {
      await page.goto(url + "#setup-connect");
      assert.equal(await page.locator("#setup-connect").isVisible(), true);
      assert.equal(await page.locator("#setup-start").isVisible(), false);
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      assert.equal(
        await page
          .locator(".setup-tabs")
          .evaluate(
            (e) =>
              e.getBoundingClientRect().top >=
              document.querySelector(".site-header").getBoundingClientRect()
                .bottom,
          ),
        true,
        "Setup tabs stay below the sticky header",
      );
      await page.locator("#command-connect").focus();
      await page.evaluate(() => {
        location.hash = "setup-editor";
      });
      await page.waitForFunction(
        () => !document.getElementById("setup-editor").hidden,
      );
      assert.equal(await page.locator("#setup-editor").isVisible(), true);
      assert.equal(
        await page.evaluate(
          () => document.activeElement.getClientRects().length > 0,
        ),
        true,
      );
      await page.goBack();
      await page.waitForFunction(
        () => !document.getElementById("setup-connect").hidden,
      );
      assert.equal(await page.locator("#setup-connect").isVisible(), true);
      await page.getByRole("tab", { name: "1. Start" }).click();
      await page.getByRole("link", { name: "Connection steps" }).click();
      assert.equal(await page.locator("#setup-connect").isVisible(), true);
    },
    { reducedMotion: "reduce" },
  ));

test("a direct tour link reveals the requested screenshot without loading the other tour panels", () =>
  withPage(
    async (page) => {
      const screenshots = [];
      page.on("response", (r) => {
        if (r.url().includes("/screenshots/")) screenshots.push(r.url());
      });
      await page.goto(url + "#tour-usage", { waitUntil: "networkidle" });
      assert.equal(await page.locator("#tour-usage").isVisible(), true);
      assert.equal(await page.locator("#tour-floor").isVisible(), false);
      await page.locator("#tour-usage img").evaluate((i) => i.decode());
      assert.ok(screenshots.some((s) => s.includes("usage-")));
      assert.ok(screenshots.every((s) => /(?:appearance|usage)-/.test(s)));
      await page.evaluate(() => {
        location.hash = "tour-usage%ZZ";
      });
      assert.equal(await page.locator("#tour-usage").isVisible(), true);
    },
    { reducedMotion: "reduce" },
  ));

test("a focused desktop source link remains reachable when the tablet header hides it", () =>
  withPage(async (page) => {
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await nav.getByRole("link", { name: "GitHub" }).focus();
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const focus = await page.evaluate(() => {
      const e = document.activeElement;
      return {
        withinNavigation: !!e.closest("#site-nav"),
        visible: e.getClientRects().length > 0,
      };
    });
    assert.deepEqual(focus, { withinNavigation: true, visible: true });
    await page.keyboard.press("Tab");
    assert.equal(
      await page
        .getByRole("link", { name: "Run locally", exact: true })
        .evaluate((e) => e === document.activeElement),
      true,
    );
  }));

test("a focused mobile source link moves to visible navigation after expanding to tablet width", () =>
  withPage(
    async (page) => {
      const nav = page.getByRole("navigation", { name: "Main navigation" });
      await page.getByRole("button", { name: "Menu" }).click();
      await nav.getByRole("link", { name: "GitHub" }).focus();
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      const focus = await page.evaluate(() => {
        const e = document.activeElement;
        return {
          withinNavigation: !!e.closest("#site-nav"),
          visible: e.getClientRects().length > 0,
        };
      });
      assert.deepEqual(focus, { withinNavigation: true, visible: true });
      await page.keyboard.press("Tab");
      assert.equal(
        await page
          .getByRole("link", { name: "Run locally", exact: true })
          .evaluate((e) => e === document.activeElement),
        true,
      );
    },
    { viewport: { width: 390, height: 844 } },
  ));

for (const width of [1440, 320]) {
  test(`optional CLI setup is reachable by keyboard and keeps commands explicit at ${width}px`, () =>
    withPage(
      async (page, context) => {
        await context.grantPermissions(["clipboard-read", "clipboard-write"], {
          origin,
        });
        await page.getByRole("link", { name: "Enable local runs" }).click();
        const panel = page.locator("#setup-run");
        await panel.waitFor({ state: "visible" });
        const tabs = page
          .getByRole("tablist", { name: "Installation steps" })
          .getByRole("tab");
        assert.equal(await tabs.count(), 4);
        const runTab = page.getByRole("tab", { name: "Optional runs" });
        assert.equal(await runTab.getAttribute("aria-selected"), "true");
        assert.match(
          await panel.innerText(),
          /Stop the existing office server/,
        );
        assert.match(
          await panel.innerText(),
          /own account, permissions and billing/,
        );
        assert.match(
          await panel.innerText(),
          /not a message to an existing session/,
        );
        await page
          .getByRole("button", { name: "Copy local runner command" })
          .click();
        assert.equal(
          await page.evaluate(() => navigator.clipboard.readText()),
          "python3 run.py --enable-task-runner --workspace /absolute/path/to/project",
        );
        await runTab.focus();
        await page.keyboard.press("Home");
        await page.keyboard.press("Enter");
        assert.equal(await page.locator("#setup-start").isVisible(), true);
        await page.keyboard.press("End");
        await page.keyboard.press("Enter");
        assert.equal(await panel.isVisible(), true);
        assert.equal(
          await page
            .locator('[data-tab-group="setup"] [role="tabpanel"]:visible')
            .count(),
          1,
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        for (const tab of await tabs.all()) {
          const box = await tab.boundingBox();
          assert.ok(
            box &&
              box.width >= 44 &&
              box.height >= 44 &&
              box.x >= 0 &&
              box.x + box.width <= width,
            "each setup tab stays visible and touch sized",
          );
        }
        await capture(page, `local-run-setup-${width}`, false);
      },
      { viewport: { width, height: width === 320 ? 800 : 1000 } },
    ));
}
