/* Native UI with synthetic CLI replies: retained drafts never submit themselves. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { observerFixture } = require("./observer-fixture.cjs");
const draftKey = "agent-office:local-run-draft:v1";
const outputKey = "agent-office:run-output:v1";
const exact = "\n Inspect 🪴 <b>literal</b> $(touch nope)\nkeep spacing  \n";
const makeCapability = () => ({
  enabled: true,
  instance_id: "aff382b2-7480-420d-abbe-2146eaf7d97a",
  token: "never-store-this-write-token",
  max_prompt_chars: 8192,
  max_running: 2,
  workspaces: [
    { id: "one", name: "First", path: "/projects/first" },
    { id: "two", name: "Second", path: "/projects/second" },
  ],
  runtimes: [
    {
      id: "codex",
      name: "Codex",
      available: true,
      modes: [
        { id: "read", name: "Review" },
        { id: "edit", name: "Edit" },
      ],
    },
  ],
  runs: [],
});

for (const missing of ["runtime", "mode"]) {
  test(`retaining edits with a missing ${missing} keeps a readable draft and requires a valid selection`, () =>
    observerFixture({}, async ({ page }) => {
      const cap = makeCapability();
      await setup(page, cap);
      await page.selectOption("#task-run-mode", "edit");
      await page.check("#task-run-remember");
      await page.fill("#task-run-prompt", exact);
      if (missing === "runtime") cap.runtimes = [];
      else cap.runtimes[0].modes.pop();
      await page.evaluate(() => officeTaskRunner.refresh());
      const edited = exact + "New edits while choice is missing";
      await page.fill("#task-run-prompt", edited);
      const retained = JSON.parse(
        await page.evaluate((key) => sessionStorage.getItem(key), draftKey),
      );
      assert.equal(retained.runtime, "codex");
      assert.equal(retained.mode, "edit");
      await reopen(page);
      assert.equal(await page.inputValue("#task-run-prompt"), edited);
      assert.equal(await page.isDisabled("#task-run-submit"), true);
    }));
}
async function setup(page, cap, onPost = async (route) => route.abort()) {
  await page.route("**/task-runs**", async (route) => {
    if (route.request().method() === "POST") return onPost(route);
    const run = cap.runs.find((run) =>
      route.request().url().endsWith(`/${run.id}`),
    );
    await route.fulfill({
      json: run
        ? {
            run: {
              ...run,
              output: "long output ".repeat(200) + "\n" + "x".repeat(200),
            },
          }
        : cap,
    });
  });
  await reopen(page);
}
async function reopen(page) {
  await page.reload();
  await page.waitForFunction(
    () => initialized && settingsReady && officeTaskRunner.status.enabled,
  );
  await page.evaluate(() => officeTaskRunner.open());
}

test("a live capability refresh retains the selected project path and refuses a removed path", () =>
  observerFixture({}, async ({ page }) => {
    const cap = makeCapability();
    await setup(page, cap);
    await page.selectOption("#task-run-workspace", "two");
    await page.fill("#task-run-prompt", exact);
    cap.instance_id = "6cbe86c8-0e9d-4c25-8d8a-cb8eaa92bc92";
    cap.workspaces = [
      { ...cap.workspaces[1], id: "one" },
      { ...cap.workspaces[0], id: "two" },
    ];
    await page.evaluate(() => officeTaskRunner.refresh());
    assert.equal(await page.inputValue("#task-run-workspace"), "one");
    assert.equal(await page.inputValue("#task-run-prompt"), exact);
    const projects = cap.workspaces;
    cap.enabled = false;
    cap.workspaces = [];
    await page.evaluate(() => officeTaskRunner.refresh());
    cap.enabled = true;
    cap.workspaces = projects.toReversed();
    await page.evaluate(() => officeTaskRunner.refresh());
    assert.equal(await page.inputValue("#task-run-workspace"), "one");
    cap.workspaces = cap.workspaces.filter(
      (item) => item.path !== "/projects/second",
    );
    await page.evaluate(() => officeTaskRunner.refresh());
    assert.equal(await page.inputValue("#task-run-workspace"), "");
    assert.equal(await page.isDisabled("#task-run-submit"), true);
  }));

test("an empty disabled response preserves CLI and mode, then retains edits made while disconnected", () =>
  observerFixture({}, async ({ page }) => {
    const cap = makeCapability();
    cap.runtimes.push({
      id: "claude",
      name: "Claude Code",
      available: true,
      modes: [{ id: "default", name: "CLI permissions" }],
    });
    await setup(page, cap);
    await page.check("#task-run-remember");
    await page.selectOption("#task-run-runtime", "claude");
    await page.fill("#task-run-prompt", exact);
    const connected = structuredClone(cap);
    Object.assign(cap, {
      enabled: false,
      token: null,
      runtimes: [],
      workspaces: [],
    });
    await page.evaluate(() => officeTaskRunner.refresh());
    const edited = exact + "After reconnect";
    await page.fill("#task-run-prompt", edited);
    Object.assign(cap, connected);
    await page.evaluate(() => officeTaskRunner.refresh());
    assert.equal(await page.inputValue("#task-run-runtime"), "claude");
    assert.equal(await page.inputValue("#task-run-mode"), "default");
    assert.equal(
      JSON.parse(
        await page.evaluate((key) => sessionStorage.getItem(key), draftKey),
      ).prompt,
      edited,
    );
  }));

test("typing during reload keeps the retained project choice while preserving the newer prompt", () =>
  observerFixture({}, async ({ page }) => {
    const cap = makeCapability();
    await setup(page, cap);
    await page.check("#task-run-remember");
    await page.selectOption("#task-run-workspace", "two");
    await page.fill("#task-run-prompt", exact);
    let release, seen;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const received = new Promise((resolve) => {
      seen = resolve;
    });
    await page.route("**/task-runs", async (route) => {
      seen();
      await held;
      await route.fulfill({ json: cap });
    });
    try {
      await page.reload();
      await received;
      await page.evaluate(() => officeTaskRunner.open());
      await page.fill("#task-run-prompt", "Newer local edits");
      release();
      await page.waitForFunction(() => officeTaskRunner.status.enabled);
      assert.equal(await page.inputValue("#task-run-workspace"), "two");
      assert.equal(
        await page.inputValue("#task-run-prompt"),
        "Newer local edits",
      );
      assert.equal(
        JSON.parse(
          await page.evaluate((key) => sessionStorage.getItem(key), draftKey),
        ).prompt,
        "Newer local edits",
      );
    } finally {
      release();
    }
  }));

test("retention is gated until initial projects arrive, then stores the already typed prompt", () =>
  observerFixture({}, async ({ page }) => {
    let release, seen;
    const received = new Promise((resolve) => {
      seen = resolve;
    });
    const held = new Promise((resolve) => {
      release = resolve;
    });
    await page.route("**/task-runs", async (route) => {
      seen();
      await held;
      await route.fulfill({ json: makeCapability() });
    });
    try {
      await page.reload();
      await received;
      await page.evaluate(() => officeTaskRunner.open());
      await page.fill("#task-run-prompt", exact);
      assert.equal(await page.isDisabled("#task-run-remember"), true);
      release();
      await page.waitForFunction(() => officeTaskRunner.status.enabled);
      await page.check("#task-run-remember");
      assert.equal(
        JSON.parse(
          await page.evaluate((key) => sessionStorage.getItem(key), draftKey),
        ).prompt,
        exact,
      );
      await reopen(page);
      assert.equal(await page.inputValue("#task-run-prompt"), exact);
    } finally {
      release();
    }
  }));

test("draft retention is opt-in and restores exact text and project by path without running", () =>
  observerFixture({}, async ({ page }) => {
    const cap = makeCapability();
    let posts = 0;
    await setup(page, cap, async (route) => {
      posts++;
      await route.abort();
    });
    await page.fill("#task-run-prompt", exact);
    await reopen(page);
    assert.equal(await page.inputValue("#task-run-prompt"), "");
    await page.check("#task-run-remember");
    await page.selectOption("#task-run-workspace", "two");
    await page.selectOption("#task-run-mode", "edit");
    await page.fill("#task-run-prompt", exact);
    // Startup order can change; an ordinal ID must not move a draft to another path.
    cap.workspaces = [
      { ...cap.workspaces[1], id: "one" },
      { ...cap.workspaces[0], id: "two" },
    ];
    await reopen(page);
    assert.equal(await page.inputValue("#task-run-prompt"), exact);
    assert.equal(await page.inputValue("#task-run-workspace"), "one");
    assert.equal(await page.inputValue("#task-run-mode"), "edit");
    assert.equal(posts, 0);
    assert.equal(await page.locator("#task-run-remember").isChecked(), true);
    const saved = await page.evaluate(
      (key) => sessionStorage.getItem(key),
      draftKey,
    );
    assert.equal(saved.includes(cap.token), false);
    assert.equal(saved.includes("long output"), false);
    await page.uncheck("#task-run-remember");
    assert.equal(
      await page.evaluate((key) => sessionStorage.getItem(key), draftKey),
      null,
    );
    assert.equal(await page.inputValue("#task-run-prompt"), exact);
  }));

test("a retained uncertain submission reuses its request ID after reload", () =>
  observerFixture({}, async ({ page }) => {
    const cap = makeCapability();
    const payloads = [];
    await setup(page, cap, async (route) => {
      payloads.push(route.request().postDataJSON());
      await route.abort();
    });
    await page.check("#task-run-remember");
    await page.fill("#task-run-prompt", exact);
    await page.click("#task-run-submit");
    await page.waitForFunction(() =>
      /uncertain/.test(
        document.getElementById("task-run-form-status").textContent,
      ),
    );
    await reopen(page);
    await page.click("#task-run-submit");
    await page.waitForFunction(() =>
      /uncertain/.test(
        document.getElementById("task-run-form-status").textContent,
      ),
    );
    assert.equal(payloads.length, 2);
    assert.deepEqual(payloads[1], payloads[0]);
    assert.equal(payloads[0].prompt, exact);
  }));

test("a server restart gates an uncertain draft until explicit review as a new run", () =>
  observerFixture({}, async ({ page }) => {
    const cap = makeCapability();
    const payloads = [];
    await setup(page, cap, async (route) => {
      payloads.push(route.request().postDataJSON());
      await route.abort();
    });
    await page.check("#task-run-remember");
    await page.fill("#task-run-prompt", exact);
    await page.click("#task-run-submit");
    await page.waitForFunction(() =>
      /uncertain/.test(
        document.getElementById("task-run-form-status").textContent,
      ),
    );
    cap.instance_id = "6cbe86c8-0e9d-4c25-8d8a-cb8eaa92bc92";
    await reopen(page);
    assert.equal(await page.isDisabled("#task-run-submit"), true);
    assert.equal(await page.inputValue("#task-run-prompt"), exact);
    await page.click("#task-run-new-draft");
    assert.equal(payloads.length, 1);
    await page.click("#task-run-submit");
    await page.waitForFunction(() =>
      /uncertain/.test(
        document.getElementById("task-run-form-status").textContent,
      ),
    );
    assert.notEqual(payloads[1].request_id, payloads[0].request_id);
    await page.click("#task-run-clear-draft");
    assert.equal(await page.inputValue("#task-run-prompt"), "");
    await reopen(page);
    assert.equal(await page.inputValue("#task-run-prompt"), "");
  }));

test("output reading preferences survive reload and keep long lines inside a 320px dialog", () =>
  observerFixture(
    { viewport: { width: 320, height: 740 } },
    async ({ page }) => {
      const cap = makeCapability();
      cap.runs = [
        {
          id: "finished",
          runtime: "codex",
          workspace_id: "one",
          workspace_name: "First",
          mode: "read",
          prompt: exact,
          status: "succeeded",
          created_at: 1792540000,
          finished_at: 1792540002,
          exit_code: 0,
        },
      ];
      await setup(page, cap);
      await page.locator('[data-run-id="finished"]').click();
      await page.selectOption("#task-run-output-size", "large");
      await page.uncheck("#task-run-wrap");
      const reading = async () =>
        page.locator("#task-run-output").evaluate((node) => ({
          size: getComputedStyle(node).fontSize,
          wrap: getComputedStyle(node).whiteSpace,
          overflow: node.scrollWidth > node.clientWidth,
        }));
      assert.deepEqual(await reading(), {
        size: "16px",
        wrap: "pre",
        overflow: true,
      });
      await reopen(page);
      await page.locator('[data-run-id="finished"]').click();
      assert.equal(await page.inputValue("#task-run-output-size"), "large");
      assert.equal(await page.isChecked("#task-run-wrap"), false);
      await page.check("#task-run-wrap");
      assert.deepEqual(await reading(), {
        size: "16px",
        wrap: "pre-wrap",
        overflow: false,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      assert.equal(
        (
          await page.evaluate((key) => localStorage.getItem(key), outputKey)
        ).includes(exact),
        false,
      );
    },
  ));

test("a removed project requires a new choice and Clear draft forgets it even with no matching project", () =>
  observerFixture({}, async ({ page }) => {
    const cap = makeCapability();
    await setup(page, cap);
    await page.check("#task-run-remember");
    await page.selectOption("#task-run-workspace", "two");
    await page.fill("#task-run-prompt", exact);
    cap.workspaces.pop();
    await reopen(page);
    assert.equal(await page.inputValue("#task-run-workspace"), "");
    assert.equal(await page.isDisabled("#task-run-submit"), true);
    assert.equal(await page.inputValue("#task-run-prompt"), exact);
    await page.click("#task-run-clear-draft");
    assert.equal(
      await page.evaluate((key) => sessionStorage.getItem(key), draftKey),
      null,
    );
    await reopen(page);
    assert.equal(await page.inputValue("#task-run-prompt"), "");
  }));

test("blocked storage keeps the form usable and explicitly reports that retention failed", () =>
  observerFixture({}, async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.getItem =
        Storage.prototype.setItem =
        Storage.prototype.removeItem =
          () => {
            throw new DOMException("Blocked", "SecurityError");
          };
    });
    await setup(page, makeCapability());
    await page.fill("#task-run-prompt", exact);
    await page.check("#task-run-remember");
    assert.match(
      await page.textContent("#task-run-draft-status"),
      /not retained/,
    );
    assert.equal(await page.isDisabled("#task-run-submit"), false);
    await page.click("#task-run-clear-draft");
    assert.equal(await page.inputValue("#task-run-prompt"), "");
  }));

test("an unreadable retained draft never replaces the form or submits a request", () =>
  observerFixture({}, async ({ page }) => {
    await page.evaluate(
      (key) => sessionStorage.setItem(key, "{broken"),
      draftKey,
    );
    let posts = 0;
    await setup(page, makeCapability(), async (route) => {
      posts++;
      await route.abort();
    });
    assert.equal(await page.inputValue("#task-run-prompt"), "");
    assert.equal(await page.isChecked("#task-run-remember"), false);
    assert.match(
      await page.textContent("#task-run-draft-status"),
      /could not be read/,
    );
    await page.fill("#task-run-prompt", exact);
    assert.equal(await page.isDisabled("#task-run-submit"), false);
    assert.equal(posts, 0);
  }));
