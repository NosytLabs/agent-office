/* Local-run controls use delayed synthetic replies over the real observer UI. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { observerFixture } = require("./observer-fixture.cjs");
const capability = {
  enabled: true,
  token: "synthetic-token",
  max_prompt_chars: 8192,
  max_running: 2,
  workspaces: [
    { id: "one", name: "Project one" },
    { id: "two", name: "Project two" },
  ],
  runtimes: [
    {
      id: "codex",
      name: "Codex",
      available: true,
      modes: [{ id: "read", name: "Review" }],
    },
  ],
  runs: [],
};
const withPage = (run) => observerFixture({}, ({ page }) => run(page));
const load = async (page) => {
  await page.reload();
  await page.waitForFunction(
    () => initialized && settingsReady && officeTaskRunner.status.enabled,
  );
};
// A delayed local action must never describe a different run as its target.
async function twoRuns(page, intercept = () => false) {
  const summaries = ["one", "two"].map((id) => ({
    id,
    request_id: id,
    runtime: "codex",
    workspace_id: id,
    workspace_name: `Project ${id}`,
    prompt: `Prompt ${id}`,
    mode: "read",
    status: "running",
    created_at: 1791453600,
    finished_at: null,
    exit_code: null,
    output_truncated: false,
    error: null,
  }));
  await page.route("**/task-runs**", async (route) => {
    if (await intercept(route)) return;
    const url = new URL(route.request().url());
    const run = summaries.find(
      (run) => url.pathname === `/task-runs/${run.id}`,
    );
    await route.fulfill({
      json: run
        ? { run: { ...run, output: `Output ${run.id}` } }
        : { ...capability, runs: summaries },
    });
  });
  await load(page);
  await page.evaluate(() => officeTaskRunner.open());
  await page.locator('[data-run-id="one"]').click();
  await page.waitForFunction(
    () =>
      document.getElementById("task-run-output").textContent === "Output one",
  );
}

for (const outcome of ["resolve", "reject"]) {
  test(`late clipboard ${outcome} cannot alter another run`, () =>
    withPage(async (page) => {
      await twoRuns(page);
      await page.evaluate(() =>
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: () =>
              new Promise((resolve, reject) => {
                window.finishCopy = { resolve, reject };
              }),
          },
        }),
      );
      await page.locator("#task-run-copy").click();
      await page.locator('[data-run-id="two"]').click();
      await page.waitForFunction(
        () =>
          document.getElementById("task-run-output").textContent ===
          "Output two",
      );
      await page.evaluate(async (outcome) => {
        window.finishCopy[outcome]();
        await Promise.resolve();
      }, outcome);
      assert.equal(
        await page.locator("#task-run-detail-status").textContent(),
        "",
      );
      assert.equal(await page.evaluate(() => getSelection().toString()), "");
    }));
}

test("cancelling one run cannot mark another run as cancelled", () =>
  withPage(async (page) => {
    let release, seen;
    const received = new Promise((resolve) => {
      seen = resolve;
    });
    const delayed = new Promise((resolve) => {
      release = resolve;
    });
    await twoRuns(page, async (route) => {
      if (!route.request().url().endsWith("/one/cancel")) return false;
      seen();
      await delayed;
      await route.fulfill({
        json: {
          run: {
            id: "one",
            runtime: "codex",
            status: "cancelled",
            created_at: 1791453600,
          },
        },
      });
      return true;
    });
    try {
      await page.locator("#task-run-cancel").click();
      await received;
      await page.locator('[data-run-id="two"]').click();
      release();
      await page.waitForFunction(
        () => !document.getElementById("task-run-cancel").disabled,
      );
      assert.equal(
        await page.locator("#task-run-detail-status").textContent(),
        "",
      );
      assert.match(
        await page.locator("#task-run-detail-title").textContent(),
        /Project two/,
      );
    } finally {
      release();
    }
  }));

test("inactive idle local runner uses a slower summary cadence", () =>
  withPage(async (page) => {
    await page.route("**/task-runs", (route) =>
      route.fulfill({ json: capability }),
    );
    await page.addInitScript(() => {
      window.scheduledDelays = [];
      const original = window.setTimeout.bind(window);
      window.setTimeout = (fn, ms, ...args) => {
        window.scheduledDelays.push(ms);
        return original(fn, ms, ...args);
      };
    });
    await load(page);
    await page.evaluate(() => officeTaskRunner.refresh());
    assert.ok(
      await page.evaluate(() => scheduledDelays.includes(15000)),
      "Idle floor summaries should not poll at the active run rate",
    );
  }));

test("closing and reopening the run view invalidates an old clipboard result", () =>
  withPage(async (page) => {
    await twoRuns(page);
    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: () =>
            new Promise((resolve) => {
              window.finishCopy = resolve;
            }),
        },
      }),
    );
    await page.locator("#task-run-copy").click();
    await page.evaluate(() => {
      officeTaskRunner.close();
      officeTaskRunner.open();
    });
    await page.evaluate(async () => {
      window.finishCopy();
      await Promise.resolve();
    });
    assert.equal(
      await page.locator("#task-run-detail-status").textContent(),
      "",
    );
  }));

test("a malformed cancellation reply never claims acceptance", () =>
  withPage(async (page) => {
    await twoRuns(page, async (route) => {
      if (!route.request().url().endsWith("/cancel")) return false;
      await route.fulfill({ json: {} });
      return true;
    });
    await page.locator("#task-run-cancel").click();
    await page.waitForFunction(
      () => !document.getElementById("task-run-cancel").disabled,
    );
    assert.match(
      await page.locator("#task-run-detail-status").textContent(),
      /invalid cancellation response/,
    );
    assert.doesNotMatch(
      await page.locator("#task-run-detail-status").textContent(),
      /Cancellation requested/,
    );
  }));

test("a clipboard failure never selects text that arrived after Copy was clicked", () =>
  withPage(async (page) => {
    let changed = false;
    await twoRuns(page, async (route) => {
      if (!changed || !route.request().url().endsWith("/one")) return false;
      await route.fulfill({
        json: {
          run: {
            id: "one",
            runtime: "codex",
            status: "running",
            output: "New output",
            created_at: 1791453600,
          },
        },
      });
      return true;
    });
    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: () =>
            new Promise((resolve, reject) => {
              window.rejectCopy = reject;
            }),
        },
      }),
    );
    await page.locator("#task-run-copy").click();
    changed = true;
    await page.evaluate(() => officeTaskRunner.refresh());
    await page.waitForFunction(
      () =>
        document.getElementById("task-run-output").textContent === "New output",
    );
    await page.evaluate(async () => {
      window.rejectCopy();
      await Promise.resolve();
    });
    assert.equal(await page.evaluate(() => getSelection().toString()), "");
    assert.match(
      await page.locator("#task-run-detail-status").textContent(),
      /Output changed/,
    );
  }));
