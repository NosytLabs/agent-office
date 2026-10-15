/* Read-only quick navigation against its actual browser module. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
let server, browser, origin;
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/quick-nav.css"></head><body><main><button id="open" class="btn">Quick navigation</button><input id="draft" aria-label="Draft"><div id="editable" contenteditable="true">Editable brief</div><select id="outside-select"><option>One</option></select><section id="existing-panel"><h2>Existing panel</h2><p>Keep this context.</p></section><section id="destination" hidden tabindex="-1"></section></main></body></html>`;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/")
      return res.writeHead(200, { "Content-Type": "text/html" }).end(html);
    const files = {
      "/js/quick-nav.js": ["web/js/quick-nav.js", "application/javascript"],
      "/css/quick-nav.css": ["web/css/quick-nav.css", "text/css"],
      "/css/style.css": ["web/css/style.css", "text/css"],
    };
    const file = files[req.url];
    if (!file || !fs.existsSync(path.join(root, file[0])))
      return res.writeHead(404).end();
    res
      .writeHead(200, { "Content-Type": file[1] })
      .end(fs.readFileSync(path.join(root, file[0])));
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
});
async function withPage(run, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1000, height: 800 },
    ...options,
  });
  const page = await context.newPage();
  try {
    await page.goto(origin);
    const loaded = await page.evaluate(async () => {
      try {
        const { createQuickNav } = await import("/js/quick-nav.js");
        window.navigationAgents = [
          {
            id: "cedar",
            label: "Cedar <script>literal</script>",
            platform: "codex",
            status: "waiting",
            project: "Billing project",
            detail: "Review the proposed change",
          },
          {
            id: "linden",
            label: "Linden",
            platform: "claude",
            status: "working",
            workspace_name: "Website",
            tool: "Read",
            detail: "docs/setup.md",
          },
        ];
        window.navigationState = { mode: "local", offline: false };
        const destination = document.getElementById("destination");
        const show = (text) => {
          destination.hidden = false;
          destination.textContent = text;
          destination.focus();
        };
        window.quickNav = createQuickNav({
          getAgents: () => window.navigationAgents,
          getState: () => window.navigationState,
          actions: [
            {
              id: "agents",
              label: "Agents",
              keywords: ["sessions", "roster"],
              run: () => show("Agents panel"),
            },
            {
              id: "history",
              label: "Saved activity",
              keywords: ["history", "events"],
              run: () => show("Saved activity panel"),
            },
            {
              id: "draft",
              label: "Draft prompt",
              keywords: ["task", "brief"],
              run: () => show("Draft prompt panel"),
            },
          ],
          onPickAgent: (id) => show("Session: " + id),
        });
        document.getElementById("open").onclick = () => window.quickNav.open();
        return true;
      } catch (error) {
        return error.message;
      }
    });
    assert.equal(loaded, true, "The Quick navigation module must load");
    await run(page);
  } finally {
    await context.close();
  }
}
const search = (page) =>
  page.getByRole("combobox", { name: "Search sessions and panels" });

test("search opens the matching project/runtime session and renders runtime text literally", () =>
  withPage(async (page) => {
    const writes = [];
    page.on("request", (request) => {
      if (request.method() !== "GET") writes.push(request.url());
    });
    await page.locator("#draft").fill("Keep this unsent brief.");
    await page.locator("#open").click();
    await search(page).fill("billing codex");
    assert.equal(await page.getByRole("dialog").getByRole("option").count(), 1);
    assert.match(
      await page.getByRole("dialog").getByRole("option").innerText(),
      /Cedar <script>literal<\/script>/,
    );
    assert.equal(await page.locator("dialog script").count(), 0);
    await search(page).press("Enter");
    assert.equal(
      await page.locator("#destination").textContent(),
      "Session: cedar",
    );
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(
      await page.locator("#draft").inputValue(),
      "Keep this unsent brief.",
    );
    assert.deepEqual(writes, []);
  }));

test("keyboard opens panel actions, wraps selection, and restores the previous focus on Escape", () =>
  withPage(async (page) => {
    await page.locator("#open").focus();
    await page.keyboard.press("Control+k");
    assert.equal(await search(page).isVisible(), true);
    await search(page).press("ArrowUp");
    assert.match(
      await page.locator('[role="option"][aria-selected="true"]').innerText(),
      /Linden/,
    );
    await search(page).press("ArrowDown");
    assert.match(
      await page.locator('[role="option"][aria-selected="true"]').innerText(),
      /Agents/,
    );
    await search(page).fill("history");
    await search(page).press("Enter");
    assert.equal(
      await page.locator("#destination").textContent(),
      "Saved activity panel",
    );
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "destination",
    );
    await page.locator("#open").click();
    await search(page).fill("no matching destination");
    await search(page).press("ArrowDown");
    await search(page).press("Enter");
    assert.equal(await search(page).isVisible(), true);
    await search(page).fill("task");
    await search(page).press("ArrowUp");
    await search(page).press("Enter");
    assert.equal(
      await page.locator("#destination").textContent(),
      "Draft prompt panel",
    );
    await page.locator("#open").click();
    await search(page).press("Tab");
    assert.equal(
      await page
        .getByRole("button", { name: "Close quick navigation" })
        .evaluate((element) => element === document.activeElement),
      true,
    );
    await page.keyboard.press("Shift+Tab");
    assert.equal(
      await search(page).evaluate(
        (element) => element === document.activeElement,
      ),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.id), "open");
    assert.equal(await page.locator("#existing-panel").isVisible(), true);
  }));

test("the shortcut preserves text entry, composition and held keys, while the visible button still opens", () =>
  withPage(async (page) => {
    for (const selector of ["#draft", "#editable", "#outside-select"]) {
      const prevented = await page.locator(selector).evaluate((element) => {
        element.focus();
        const event = new KeyboardEvent("keydown", {
          key: "k",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      });
      assert.equal(prevented, false, selector);
      assert.equal(await page.getByRole("dialog").count(), 0);
    }
    for (const extra of [
      { isComposing: true },
      { repeat: true },
      { shiftKey: true },
      { altKey: true },
    ]) {
      await page.locator("#open").evaluate((element, extra) => {
        element.focus();
        element.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "k",
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
            ...extra,
          }),
        );
      }, extra);
      assert.equal(await page.getByRole("dialog").count(), 0);
    }
    await page.locator("#open").click();
    await search(page).evaluate((element) =>
      element.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    assert.equal(await search(page).isVisible(), true);
    await search(page).press("Meta+k");
    assert.equal(await page.getByRole("dialog").count(), 0);
  }));

test("stale sessions cannot be picked and disconnected data stays labeled on a narrow screen", () =>
  withPage(
    async (page) => {
      await page.evaluate(() => {
        window.navigationState.offline = true;
        window.navigationAgents[0].project =
          "/work/" + "nested-project-directory/".repeat(28);
      });
      await page.locator("#open").click();
      await search(page).fill("cedar");
      assert.match(
        await page.getByRole("status").innerText(),
        /disconnected|last received/i,
      );
      const initialBounds = await page
        .locator(".quick-nav-dialog")
        .evaluate((dialog) => ({
          closeTop: dialog.querySelector("button").getBoundingClientRect().top,
          inputTop: dialog.querySelector("input").getBoundingClientRect().top,
          bottom: dialog.getBoundingClientRect().bottom,
          viewport: innerHeight,
          overflow: dialog.scrollWidth > dialog.clientWidth,
        }));
      assert.ok(
        initialBounds.closeTop >= 0 &&
          initialBounds.inputTop >= 0 &&
          initialBounds.bottom <= initialBounds.viewport,
        JSON.stringify(initialBounds),
      );
      assert.equal(initialBounds.overflow, false);
      await page.evaluate(() => {
        window.navigationAgents = [];
      });
      await search(page).press("Enter");
      assert.equal(await search(page).isVisible(), true);
      assert.equal(await page.locator("#destination").isVisible(), false);
      assert.equal(
        await page.getByRole("dialog").getByRole("option").count(),
        0,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      const close = await page
        .getByRole("button", { name: "Close quick navigation" })
        .boundingBox();
      assert.ok(close.width >= 44 && close.height >= 44);
      await page.evaluate(() => window.quickNav.destroy());
      await page.locator("#open").focus();
      await page.keyboard.press("Control+k");
      assert.equal(await page.getByRole("dialog").count(), 0);
    },
    { viewport: { width: 320, height: 568 } },
  ));

test("pointer selection uses a fresh session snapshot and refresh keeps the current search", () =>
  withPage(async (page) => {
    await page.locator("#open").click();
    await search(page).fill("website");
    await page.evaluate(() => {
      window.navigationState.mode = "demo";
      window.navigationAgents[1].label = "Updated website session";
      window.quickNav.refresh();
    });
    assert.equal(await search(page).inputValue(), "website");
    assert.match(
      await page.getByRole("dialog").getByRole("option").innerText(),
      /Updated website session/,
    );
    assert.match(await page.getByRole("status").innerText(), /Synthetic demo/);
    await page.getByRole("dialog").getByRole("option").click();
    assert.equal(
      await page.locator("#destination").textContent(),
      "Session: linden",
    );
  }));

const { observerFixture } = require("./observer-fixture.cjs");
const observedEvents = [
  { event: "session_start", session_id: "quick-review", platform: "codex" },
  {
    event: "input_request",
    session_id: "quick-review",
    platform: "codex",
    request_id: "quick-request",
    question: "Which change needs review?",
  },
  { event: "session_start", session_id: "quick-docs", platform: "claude" },
];

test("the real HUD finds an observed session and opens its inspector without changing activity", async () => {
  await observerFixture({ events: observedEvents }, async ({ page, state }) => {
    await page.waitForFunction(() => !!window.officeQuickNav);
    const before = await state();
    const writes = [];
    page.on("request", (request) => {
      if (request.method() !== "GET") writes.push(request.url());
    });
    await page.locator("#quick-nav-open").click();
    await search(page).fill("codex quick-review");
    await search(page).press("Enter");
    assert.equal(await page.locator("#sheet-inspector").isVisible(), true);
    assert.match(
      await page.locator("#inspector-summary").innerText(),
      /Which change needs review/,
    );
    assert.equal(
      await page.locator("#inspectorbox").getAttribute("data-agent"),
      "quick-review",
    );
    assert.equal(await page.locator(".quick-nav-dialog").isVisible(), false);
    const after = await state();
    assert.equal(after.progress.xp, before.progress.xp);
    assert.equal(after.tracking.received, before.tracking.received);
    assert.deepEqual(writes, []);
  });
});

test("real panel navigation preserves drafts, keeps the same panel open, and isolates Escape on mobile", async () => {
  await observerFixture(
    { viewport: { width: 320, height: 568 } },
    async ({ page }) => {
      await page.waitForFunction(() => !!window.officeQuickNav);
      await page.locator("#tasksbtn").click();
      await page.locator('[data-task-view="draft"]').click();
      await page
        .locator("#task-draft-text")
        .fill("Keep the unsent task brief exactly as written.");
      await page.locator("#sheet-tasks .close").focus();
      await page.keyboard.press("Control+k");
      await search(page).fill("Customize");
      await search(page).press("Enter");
      assert.equal(await page.locator("#sheet-settings").isVisible(), true);
      await page.locator("#room-name-input").fill("Unsaved room name");
      await page.locator("#sheet-settings .close").focus();
      await page.keyboard.press("Control+k");
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#sheet-settings").isVisible(), true);
      assert.equal(
        await page.locator("#room-name-input").inputValue(),
        "Unsaved room name",
      );
      await page.keyboard.press("Control+k");
      await search(page).fill("Customize");
      fs.mkdirSync("reports/quick-nav", { recursive: true });
      await page.screenshot({ path: "reports/quick-nav/navigation-320.png" });
      await search(page).press("Enter");
      assert.equal(await page.locator("#sheet-settings").isVisible(), true);
      await page.locator("#sheet-settings .close").focus();
      await page.keyboard.press("Control+k");
      await search(page).fill("Tasks and drafts");
      await search(page).press("Enter");
      assert.equal(
        await page.locator("#task-draft-text").inputValue(),
        "Keep the unsent task brief exactly as written.",
      );
      const prevented = await page
        .locator("#task-draft-text")
        .evaluate((input) => {
          input.focus();
          const event = new KeyboardEvent("keydown", {
            key: "k",
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          });
          input.dispatchEvent(event);
          return event.defaultPrevented;
        });
      assert.equal(prevented, false);
      assert.equal(await page.locator(".quick-nav-dialog").isVisible(), false);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    },
  );
});
