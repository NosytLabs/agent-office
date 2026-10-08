/* Read-only task presentation in real Chromium; all board data are synthetic. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { observerFixture } = require("./observer-fixture.cjs");

const script = path.resolve(__dirname, "../web/js/tasks-view.js");
let browser;
before(async () => {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox"],
  });
});
after(async () => {
  await browser?.close();
});

async function withView(run, options = {}) {
  const page = await browser.newPage({
    viewport: { width: 760, height: 700 },
    ...options,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(3000);
  try {
    await page.setContent(
      '<input aria-label="Unrelated draft"><div id="boards"></div><output id="selected"></output>',
    );
    if (fs.existsSync(script)) await page.addScriptTag({ path: script });
    await run(page);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

const board = (fields = {}) => ({
  runtime: "opencode",
  session_id: "fixture",
  source: "opencode.todo.updated",
  source_updated_at: null,
  observed_at: 1791453600,
  age_s: 10,
  historical: false,
  session_status: "working",
  tasks: [
    {
      id: "row-0",
      content: "Inspect the source",
      status: "pending",
      priority: "high",
    },
  ],
  ...fields,
});

async function render(page, boards, agents = []) {
  await page.evaluate(
    ({ boards, agents }) => {
      window.renderReportedTasks?.(
        document.getElementById("boards"),
        boards,
        agents,
        {
          onSelect: (id, runtime) => {
            document.getElementById("selected").textContent =
              `${runtime}:${id}`;
          },
        },
      );
    },
    { boards, agents },
  );
}

test("localized source and receipt dates retain their punctuation without adding a second period", () =>
  withView(
    async (page) => {
      await render(page, [board({ source_updated_at: 1791453500 })]);
      const text = await page.locator(".task-board-meta").innerText();
      const expected = await page.evaluate(() => ({
        received: new Date(1791453600 * 1000).toLocaleString(),
        source: new Date(1791453500 * 1000).toLocaleString(),
      }));
      assert.match(expected.received, /[ap]\.m\.$/);
      assert.ok(text.includes("Received " + expected.received));
      assert.ok(text.includes("Source updated " + expected.source));
      assert.doesNotMatch(text, /\.\./);
    },
    { locale: "en-CA", timezoneId: "America/Toronto" },
  ));

test("the native waiting inspector uses the localized observation date without double punctuation", async () => {
  await observerFixture(
    {
      events: [
        {
          event: "session_start",
          platform: "opencode",
          session_id: "locale-audit",
          title: "Synthetic date check",
        },
        {
          event: "approval_request",
          platform: "opencode",
          session_id: "locale-audit",
          request_id: "locale-approval",
          command: "Synthetic approval",
        },
      ],
    },
    async ({ page, base }) => {
      const localized = await page
        .context()
        .browser()
        .newPage({
          viewport: { width: 1440, height: 1000 },
          locale: "en-CA",
          timezoneId: "America/Toronto",
        });
      const errors = [];
      localized.on("pageerror", (error) => errors.push(error.message));
      try {
        await localized.goto(base);
        await localized.waitForFunction(() => initialized && settingsReady);
        await localized.click("#waiting-count");
        const note = await localized
          .locator("#sheet-inspector .waiting-note")
          .innerText();
        const date = await localized.evaluate(() =>
          new Date(
            agents.find((agent) => agent.id === "locale-audit").observed_at *
              1000,
          ).toLocaleString(),
        );
        assert.match(date, /[ap]\.m\.$/);
        assert.ok(note.includes(date));
        assert.doesNotMatch(note, /\.\./);
        assert.deepEqual(errors, []);
      } finally {
        await localized.close();
      }
    },
  );
});

test("unreported task coverage is distinct from an explicitly empty source snapshot", async () =>
  withView(async (page) => {
    await render(page, []);
    assert.match(
      await page.locator("#boards").innerText(),
      /No task lists reported yet/,
    );
    await render(page, [
      board({ tasks: [], historical: true, session_status: "gone" }),
    ]);
    assert.match(
      await page.locator("#boards").innerText(),
      /source reported an empty task list/i,
    );
    assert.match(
      await page.locator(".task-board h3").innerText(),
      /Last reported tasks/,
    );
    assert.equal(await page.locator(".task-agent-link").count(), 0);
  }));

test("task content is literal full text and historical lifecycle never completes unfinished rows", async () =>
  withView(async (page) => {
    const unsafe =
      '<img src=x onerror="window.executed=true">\n' + "A".repeat(430);
    await render(page, [
      board({
        historical: true,
        session_status: "gone",
        tasks: [
          {
            id: "row-0",
            content: unsafe,
            status: "in_progress",
            priority: "high",
          },
          { id: "row-1", content: "Still pending", status: "pending" },
        ],
      }),
    ]);
    assert.equal(
      await page.locator(".task-content").first().textContent(),
      unsafe,
    );
    assert.equal(await page.locator("#boards img").count(), 0);
    assert.equal(await page.evaluate(() => window.executed), undefined);
    assert.deepEqual(await page.locator(".task-state").allTextContents(), [
      "In progress",
      "Pending",
    ]);
    assert.match(
      await page.locator(".task-board-meta").innerText(),
      /opencode\.todo\.updated/,
    );
    assert.match(
      await page.locator(".task-board-meta").innerText(),
      /Source update time unavailable/,
    );
  }));

test("session inspection uses matching runtime identity and refuses ambiguous IDs", async () =>
  withView(async (page) => {
    const agents = [
      {
        id: "fixture",
        platform: "opencode",
        label: "Fixture worker",
        status: "working",
      },
    ];
    await render(page, [board()], agents);
    assert.equal(await page.locator(".task-agent-link").count(), 1);
    await page.getByRole("button", { name: "View Fixture worker" }).click();
    assert.equal(
      await page.locator("#selected").innerText(),
      "opencode:fixture",
    );
    await render(page, [board({ runtime: "codex" })], agents);
    assert.equal(await page.locator(".task-agent-link").count(), 0);
    await render(
      page,
      [board()],
      [
        ...agents,
        { id: "fixture", platform: "codex", label: "Other", status: "working" },
      ],
    );
    assert.equal(await page.locator(".task-agent-link").count(), 0);
  }));

test("unchanged polling preserves selected task text and the focused native session button", async () =>
  withView(async (page) => {
    const boards = [board()],
      agents = [
        {
          id: "fixture",
          platform: "opencode",
          label: "Fixture worker",
          status: "working",
        },
      ];
    await render(page, boards, agents);
    await page.locator(".task-agent-link").focus();
    await page.evaluate(() => {
      window.originalTaskButton = document.activeElement;
      const range = document.createRange();
      range.selectNodeContents(document.querySelector(".task-content"));
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    });
    await render(page, [board({ age_s: 12 })], agents);
    assert.equal(
      await page.evaluate(
        () => document.activeElement === window.originalTaskButton,
      ),
      true,
    );
    assert.equal(
      await page.evaluate(() => window.getSelection().toString()),
      "Inspect the source",
    );
    await page.evaluate(
      ({ boards, agents }) => {
        window.renderReportedTasks(
          document.getElementById("boards"),
          boards,
          agents,
          {
            onSelect: () => {
              document.getElementById("selected").textContent =
                "Latest callback";
            },
          },
        );
      },
      { boards, agents },
    );
    await page.keyboard.press("Enter");
    assert.equal(
      await page.locator("#selected").innerText(),
      "Latest callback",
    );
  }));

test("changed snapshots restore local focus without stealing an unrelated draft", async () =>
  withView(async (page) => {
    const agents = [
      {
        id: "fixture",
        platform: "opencode",
        label: "Fixture worker",
        status: "working",
      },
    ];
    await render(page, [board()], agents);
    await page.locator(".task-agent-link").focus();
    await render(
      page,
      [
        board({
          tasks: [
            { id: "row-0", content: "Run the tests", status: "in_progress" },
          ],
        }),
      ],
      agents,
    );
    assert.equal(
      await page
        .locator(".task-agent-link")
        .evaluate((node) => node === document.activeElement),
      true,
    );
    const draft = page.getByRole("textbox", { name: "Unrelated draft" });
    await draft.fill("Keep typing here");
    await render(
      page,
      [board({ tasks: [], historical: true, session_status: "gone" })],
      [],
    );
    assert.equal(
      await draft.evaluate((node) => node === document.activeElement),
      true,
    );
    assert.equal(await draft.inputValue(), "Keep typing here");
  }));
