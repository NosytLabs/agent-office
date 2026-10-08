const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("playwright");

const script = path.resolve(__dirname, "../web/js/task-runner.js");
let browser;

before(async () => {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox"],
  });
});

after(async () => browser?.close());

function markup(preview = false) {
  return `<!doctype html><head><base href="http://127.0.0.1:19999/"></head><body${preview ? ' data-agent-office-preview="1"' : ""}>
    <textarea id="task-draft-text"></textarea>
    <button id="task-draft-template">Append task template</button>
    <button id="task-draft-run">Use for local run</button>
    <section id="task-runs" class="task-runner" hidden>
      <p id="task-run-capability" role="status"></p>
      <div id="task-run-enable" hidden><code>python3 run.py --enable-task-runner --workspace /absolute/path/to/project</code></div>
      <form id="task-run-form" class="task-run-form">
        <label>Project<select id="task-run-workspace"></select></label>
        <label>Installed CLI<select id="task-run-runtime"></select></label>
        <label>Mode<select id="task-run-mode"></select></label>
        <label>Prompt<textarea id="task-run-prompt"></textarea></label>
        <output id="task-run-count"></output>
        <button id="task-run-submit" type="submit">Run task</button>
        <p id="task-run-form-status" role="status"></p>
      </form>
      <p id="task-run-disclosure"></p>
      <div id="task-run-list" class="task-run-list"></div>
      <section id="task-run-detail" class="task-run-detail" hidden>
        <h3 id="task-run-detail-title"></h3>
        <p id="task-run-detail-meta"></p>
        <pre id="task-run-output" class="task-run-output"></pre>
        <button id="task-run-cancel">Cancel run</button>
        <button id="task-run-copy">Copy output</button>
        <button id="task-run-reuse">Reuse prompt</button>
        <p id="task-run-detail-status" role="status"></p>
      </section>
    </section>`;
}

async function withPage(run, { preview = false, width = 760 } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(3000);
  try {
    await page.route("http://127.0.0.1:19999/", (route) =>
      route.fulfill({ contentType: "text/html", body: markup(preview) }),
    );
    await page.goto("http://127.0.0.1:19999/");
    await run(page);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

const capability = {
  enabled: true,
  token: "local-token",
  max_prompt_chars: 8192,
  max_running: 2,
  workspaces: [{ id: "project", name: "Project", path: "/tmp/project" }],
  runtimes: [
    {
      id: "codex",
      name: "Codex",
      available: true,
      modes: [
        { id: "read", name: "Review, read-only sandbox" },
        { id: "edit", name: "Allow project edits" },
      ],
    },
    {
      id: "claude",
      name: "Claude Code",
      available: false,
      minimum_version: "2.1.259",
      modes: [{ id: "default", name: "CLI permissions" }],
    },
  ],
  runs: [],
};

async function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function startRealServer() {
  const root = path.resolve(__dirname, "..");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "office-task-ui-"));
  const workspace = path.join(temp, "project");
  const bin = path.join(temp, "bin");
  fs.mkdirSync(workspace);
  fs.mkdirSync(bin);
  const requestedPython =
    process.env.PYTHON || process.env.OFFICE_PYTHON || "python3";
  const resolvedPython = spawnSync(
    requestedPython,
    ["-c", "import sys; print(sys.executable)"],
    { encoding: "utf8" },
  );
  if (resolvedPython.status !== 0 || !resolvedPython.stdout.trim())
    throw new Error(`Could not resolve Python executable: ${requestedPython}`);
  const python = resolvedPython.stdout.trim();
  const fake = `#!${python}
import os, sys, time
prompt = sys.stdin.read()
if prompt == "sleep":
    print("waiting", flush=True)
    time.sleep(30)
else:
    sys.stdout.buffer.write(b"<b>literal</b>\\n\\x1b[31mred\\n" + prompt.encode())
`;
  for (const name of ["codex", "claude"]) {
    const executable = path.join(bin, name);
    fs.writeFileSync(executable, fake, { mode: 0o755 });
  }
  const port = await unusedPort();
  const processHandle = spawn(
    python,
    [
      "run.py",
      "--port",
      String(port),
      "--enable-task-runner",
      "--workspace",
      workspace,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        PATH: bin,
        HERMES_HOME: path.join(temp, "home"),
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 140; attempt++) {
    try {
      const response = await fetch(`${base}/task-runs`);
      if (response.ok)
        return {
          base,
          close: async () => {
            processHandle.kill();
            await new Promise((resolve) => processHandle.once("exit", resolve));
            fs.rmSync(temp, { recursive: true, force: true });
          },
        };
    } catch {}
    if (processHandle.exitCode !== null)
      throw new Error(
        `Real task server exited: ${processHandle.stderr.read()}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  processHandle.kill();
  throw new Error("Real task server did not start");
}

test("preview mode gives local-only guidance without requesting or dispatching", () =>
  withPage(
    async (page) => {
      let requests = 0;
      await page.route("**/task-runs**", (route) => {
        requests++;
        return route.fulfill({ json: capability });
      });
      await page.addScriptTag({ path: script });
      await page.evaluate(() => window.officeTaskRunner.open());
      assert.match(
        await page.locator("#task-run-capability").innerText(),
        /local Agent Office browser/i,
      );
      assert.equal(requests, 0);
      assert.equal(await page.locator("#task-run-submit").isDisabled(), true);
    },
    { preview: true },
  ));

test("draft transfer is explicit, preserves exact text, and focuses an editable prompt", () =>
  withPage(async (page) => {
    await page.route("**/task-runs", (route) =>
      route.fulfill({ json: capability }),
    );
    await page.addScriptTag({ path: script });
    await page.evaluate(() => window.officeTaskRunner.open());
    const prompt = "Review <literal> & keep\nthese exact lines.";
    await page.locator("#task-draft-text").fill(prompt);
    await page.locator("#task-draft-run").click();
    assert.equal(await page.locator("#task-run-prompt").inputValue(), prompt);
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "task-run-prompt",
    );
    assert.equal(await page.locator("#task-run-submit").isDisabled(), false);
  }));

test("programmatic draft updates enable exact transfer without splitting long text", () =>
  withPage(async (page) => {
    await page.route("**/task-runs", (route) =>
      route.fulfill({ json: capability }),
    );
    await page.addScriptTag({ path: script });
    await page.evaluate(() => {
      document
        .querySelector("#task-draft-template")
        .addEventListener("click", () => {
          document.querySelector("#task-draft-text").value =
            "😀".repeat(4096) + "Z";
          window.dispatchEvent(
            new CustomEvent("agent-office:task-draft-change"),
          );
        });
    });
    await page.locator("#task-draft-template").click();
    assert.equal(await page.locator("#task-draft-run").isDisabled(), false);
    await page.locator("#task-draft-run").click();
    assert.equal(
      await page.locator("#task-run-prompt").inputValue(),
      "😀".repeat(4096) + "Z",
    );
  }));

test("pasted emoji use the server code-point limit without native UTF-16 truncation", () =>
  withPage(async (page) => {
    await page.route("**/task-runs", (route) =>
      route.fulfill({ json: capability }),
    );
    await page.addScriptTag({ path: script });
    await page.evaluate(() => window.officeTaskRunner.open());
    const tooLong = "😀".repeat(8192) + "Z";
    await page.locator("#task-run-prompt").fill(tooLong);
    assert.equal(await page.locator("#task-run-prompt").inputValue(), tooLong);
    assert.match(await page.locator("#task-run-count").innerText(), /8,193/);
    assert.match(
      await page.locator("#task-run-form-status").innerText(),
      /exceeds the 8,192 character limit/i,
    );
    assert.equal(await page.locator("#task-run-submit").isDisabled(), true);
    await page.locator("#task-run-prompt").fill("😀".repeat(8192));
    assert.equal(await page.locator("#task-run-submit").isDisabled(), false);
  }));

test("runtime availability and modes disable dispatch without losing the draft", () =>
  withPage(async (page) => {
    await page.route("**/task-runs", (route) =>
      route.fulfill({ json: capability }),
    );
    await page.addScriptTag({ path: script });
    await page.evaluate(() => window.officeTaskRunner.open());
    await page.locator("#task-run-prompt").fill("Keep this draft");
    await page.locator("#task-run-runtime").selectOption("claude");
    assert.match(
      await page.locator("#task-run-runtime option:checked").innerText(),
      /not found on PATH/i,
    );
    assert.match(
      await page.locator("#task-run-form-status").innerText(),
      /not found on the server PATH/i,
    );
    assert.equal(await page.locator("#task-run-submit").isDisabled(), true);
    await page.evaluate(() => {
      window.officeTaskRunner.refresh();
      return true;
    });
    assert.equal(
      await page.locator("#task-run-prompt").inputValue(),
      "Keep this draft",
    );
  }));

test("malformed success retains the idempotency key and operation feedback", () =>
  withPage(async (page) => {
    const requestIds = [];
    let attempts = 0;
    await page.route("**/task-runs", async (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({ json: capability });
      const payload = route.request().postDataJSON();
      requestIds.push(payload.request_id);
      attempts++;
      if (attempts === 1)
        return route.fulfill({ status: 201, json: { run: {} } });
      return route.fulfill({
        status: 201,
        json: {
          run: {
            id: "acknowledged",
            ...payload,
            workspace_name: "Project",
            status: "running",
            created_at: 1791453600,
            finished_at: null,
            exit_code: null,
            output_truncated: false,
            error: null,
          },
        },
      });
    });
    await page.addScriptTag({ path: script });
    await page.evaluate(() => window.officeTaskRunner.open());
    await page.locator("#task-run-prompt").fill("Retry unchanged");
    await page.locator("#task-run-submit").click();
    await page.getByText(/result is uncertain/i).waitFor();
    await page.locator("#task-run-submit").click();
    await page.locator('[data-run-id="acknowledged"]').waitFor();
    assert.deepEqual(requestIds, [requestIds[0], requestIds[0]]);
    assert.match(
      await page.locator("#task-run-form-status").innerText(),
      /Run started.*active run/is,
    );
  }));

test("a worker startup failure is shown as failed and leaves the form retryable", () =>
  withPage(async (page) => {
    let failedRun = null;
    await page.route("**/task-runs**", (route) => {
      if (route.request().method() === "POST") {
        failedRun = {
          ...route.request().postDataJSON(),
          id: "worker-failed",
          workspace_name: "Project",
          status: "failed",
          created_at: 1791453600,
          finished_at: 1791453600,
          exit_code: null,
          output_truncated: false,
          error: "Could not start task worker",
        };
        return route.fulfill({ status: 201, json: { run: failedRun } });
      }
      if (new URL(route.request().url()).pathname.endsWith("/worker-failed"))
        return route.fulfill({ json: { run: { ...failedRun, output: "" } } });
      return route.fulfill({
        json: { ...capability, runs: failedRun ? [failedRun] : [] },
      });
    });
    await page.addScriptTag({ path: script });
    await page.evaluate(() => window.officeTaskRunner.open());
    await page.locator("#task-run-prompt").fill("Inspect the project");
    await page.locator("#task-run-submit").click();
    await page.locator('[data-run-id="worker-failed"]').waitFor();
    assert.match(
      await page.locator("#task-run-form-status").innerText(),
      /Run could not start/,
    );
    assert.match(
      await page.locator("#task-run-detail-meta").innerText(),
      /Failed/,
    );
    assert.equal(await page.locator("#task-run-cancel").isVisible(), false);
    assert.equal(await page.locator("#task-run-submit").isDisabled(), false);
    assert.equal(
      await page.locator("#task-run-prompt").inputValue(),
      "Inspect the project",
    );
  }));

test("a delayed pre-submit poll cannot erase the acknowledged run", () =>
  withPage(async (page) => {
    let getCount = 0;
    let delayedPollRequested = false;
    await page.route("**/task-runs", async (route) => {
      if (route.request().method() === "POST") {
        const payload = route.request().postDataJSON();
        return route.fulfill({
          status: 201,
          json: {
            run: {
              id: "new-run",
              ...payload,
              workspace_name: "Project",
              status: "running",
              created_at: 1791453600,
              finished_at: null,
              exit_code: null,
              output_truncated: false,
              error: null,
            },
          },
        });
      }
      getCount++;
      if (getCount === 2) {
        delayedPollRequested = true;
        setTimeout(() => route.fulfill({ json: capability }), 350);
        return;
      }
      return route.fulfill({ json: capability });
    });
    await page.addScriptTag({ path: script });
    await page.evaluate(() => window.officeTaskRunner.open());
    await page.waitForFunction(() => window.officeTaskRunner.status.connected);
    await page.evaluate(() => window.officeTaskRunner.refresh());
    for (let attempt = 0; attempt < 250 && !delayedPollRequested; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(delayedPollRequested, "delayed poll was not requested");
    await page.locator("#task-run-prompt").fill("Create once");
    await page.locator("#task-run-submit").click();
    await page.locator('[data-run-id="new-run"]').waitFor();
    await page.waitForTimeout(450);
    assert.equal(await page.locator('[data-run-id="new-run"]').count(), 1);
  }));

test("run lifecycle is idempotent, output is literal, cancellable, copyable, and reusable", () =>
  withPage(async (page) => {
    let posted;
    const summary = {
      id: "run-1",
      request_id: "request-1",
      runtime: "codex",
      workspace_id: "project",
      workspace_name: "Project",
      prompt: "Inspect safely",
      mode: "read",
      status: "running",
      created_at: 1791453600,
      finished_at: null,
      exit_code: null,
      output_truncated: false,
      error: null,
    };
    let currentRuns = [];
    await page.route("**/task-runs**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === "POST" && url.pathname.endsWith("/cancel")) {
        currentRuns = [
          { ...summary, status: "cancelled", finished_at: 1791453610 },
        ];
        return route.fulfill({
          json: {
            run: currentRuns[0],
          },
        });
      }
      if (request.method() === "POST") {
        posted = request.postDataJSON();
        currentRuns = [summary];
        return route.fulfill({ status: 201, json: { run: summary } });
      }
      if (url.pathname.endsWith("/run-1"))
        return route.fulfill({
          json: {
            run: {
              ...(currentRuns[0] || summary),
              output: "<b>literal</b>\n\u001b[31mred",
            },
          },
        });
      return route.fulfill({ json: { ...capability, runs: currentRuns } });
    });
    await page.addScriptTag({ path: script });
    await page.evaluate(() => window.officeTaskRunner.open());
    await page.locator("#task-run-prompt").fill("Inspect safely");
    assert.equal(
      await page.locator("#task-run-submit").isDisabled(),
      false,
      await page.locator("#task-run-form-status").innerText(),
    );
    await page.locator("#task-run-submit").click();
    await page.waitForTimeout(100);
    assert.ok(posted, await page.locator("#task-run-form-status").innerText());
    await page.locator('[data-run-id="run-1"]').click();
    await page.locator('[data-run-id="run-1"]').focus();
    await page.evaluate(() => window.officeTaskRunner.refresh());
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.runId),
      "run-1",
    );
    assert.equal(
      await page.locator("#task-run-output").textContent(),
      "<b>literal</b>\nred",
    );
    assert.equal(await page.locator("#task-run-output b").count(), 0);
    assert.match(posted.request_id, /^[0-9a-f-]{36}$/i);
    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.copied = text;
          },
        },
      }),
    );
    await page.locator("#task-run-copy").click();
    assert.equal(
      await page.evaluate(() => window.copied),
      "<b>literal</b>\nred",
    );
    await page.locator("#task-run-reuse").click();
    assert.equal(
      await page.locator("#task-run-prompt").inputValue(),
      "Inspect safely",
    );
    await page.locator("#task-run-cancel").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#task-run-detail-meta")
        ?.textContent.includes("Cancelled"),
    );
    assert.match(
      await page.locator("#task-run-detail-meta").innerText(),
      /Cancelled/,
    );
  }));

test("local-run controls fit 320px and retain keyboard focus across unchanged refreshes", () =>
  withPage(
    async (page) => {
      await page.route("**/task-runs", (route) =>
        route.fulfill({ json: capability }),
      );
      await page.addStyleTag({
        path: path.resolve(__dirname, "../web/css/task-runner.css"),
      });
      await page.addScriptTag({ path: script });
      await page.evaluate(() => window.officeTaskRunner.open());
      await page.locator("#task-run-prompt").fill("Focused draft");
      await page.locator("#task-run-prompt").focus();
      await page.evaluate(() => window.officeTaskRunner.refresh());
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "task-run-prompt",
      );
      assert.equal(
        await page.locator("#task-run-prompt").inputValue(),
        "Focused draft",
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    },
    { width: 320 },
  ));

test(
  "real local server preserves an uncertain request id, streams literal output, and cancels",
  { timeout: 20000 },
  async () => {
    const server = await startRealServer();
    const page = await browser.newPage({
      viewport: { width: 320, height: 800 },
    });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.addInitScript(() => {
        sessionStorage.setItem(
          "agent-office:task-draft:v1:observer",
          JSON.stringify({
            version: 1,
            runtime: "codex",
            text: "retained exact draft",
          }),
        );
      });
      await page.goto(server.base);
      await page.waitForFunction(
        () =>
          typeof initialized !== "undefined" &&
          initialized &&
          window.officeTaskRunner,
      );
      await page.click("#tasksbtn");
      await page.click('[data-task-view="draft"]');
      assert.equal(await page.locator("#task-draft-run").isDisabled(), false);
      await page.locator("#task-draft-run").click();
      assert.equal(
        await page.locator("#task-run-prompt").inputValue(),
        "retained exact draft",
      );
      await page.click('[data-task-view="local-runs"]');
      await page.waitForFunction(() => window.officeTaskRunner.status.enabled);
      assert.match(
        await page.locator("#task-run-runtime option:checked").innerText(),
        /available/i,
      );

      let loseFirstResponse = true;
      await page.route("**/task-runs", async (route) => {
        if (route.request().method() !== "POST" || !loseFirstResponse)
          return route.continue();
        loseFirstResponse = false;
        await route.fetch();
        await route.abort("failed");
      });
      await page.locator("#task-run-prompt").fill("real exact prompt");
      await page.locator("#task-run-submit").click();
      await page.getByText(/result is uncertain/i).waitFor();
      await page.locator("#task-run-submit").click();
      await page.locator(".task-run-card").first().click();
      await page.waitForFunction(() =>
        document
          .querySelector("#task-run-detail-meta")
          ?.textContent.includes("Finished"),
      );
      assert.equal(await page.locator(".task-run-card").count(), 1);
      assert.equal(
        await page.locator("#task-run-output").textContent(),
        "<b>literal</b>\nred\nreal exact prompt",
      );
      assert.equal(await page.locator("#task-run-output b").count(), 0);
      await page.evaluate(() => {
        const range = document.createRange();
        range.selectNodeContents(document.querySelector("#task-run-output"));
        getSelection().removeAllRanges();
        getSelection().addRange(range);
      });
      await page.waitForTimeout(2100);
      assert.match(
        await page.evaluate(() => getSelection().toString()),
        /literal/,
      );

      await page.locator("#task-run-prompt").fill("sleep");
      await page.locator("#task-run-submit").click();
      await page
        .locator(".task-run-card")
        .filter({ hasText: "Running" })
        .click();
      await page.locator("#task-run-cancel").click();
      await page.waitForFunction(() =>
        document
          .querySelector("#task-run-detail-meta")
          ?.textContent.includes("Cancelled"),
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
      await server.close();
    }
  },
);
