const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("playwright");

let browser;

before(async () => {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox"],
  });
});

after(async () => browser?.close());

function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

// Synthetic OpenCode server that mirrors the shipped Python HTTP fixture so
// the browser flow drives the real adapter over the real loopback boundary.
async function startFakeOpenCode(directory) {
  const messages = [];
  const prompts = [];
  let completed = false;
  const server = http.createServer((req, res) => {
    const send = (status, data) => {
      const body = data == null ? "" : JSON.stringify(data);
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      });
      res.end(body);
    };
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/global/health") {
      return send(200, { healthy: true, version: "2.0.29" });
    }
    if (req.method === "GET" && url.pathname === "/session/ses_browser") {
      return send(200, {
        id: "ses_browser",
        title: "Browser fixture",
        directory,
      });
    }
    if (
      req.method === "GET" &&
      url.pathname === "/session/ses_browser/message"
    ) {
      return send(200, messages);
    }
    if (req.method === "GET" && url.pathname === "/session/status") {
      const busy =
        prompts.length && !completed ? { ses_browser: { type: "busy" } } : {};
      return send(200, busy);
    }
    if (
      req.method === "GET" &&
      ["/permission", "/question"].includes(url.pathname)
    ) {
      return send(200, []);
    }
    if (
      req.method === "POST" &&
      url.pathname === "/session/ses_browser/prompt_async"
    ) {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const body = JSON.parse(raw);
        const text = body.parts[0].text;
        prompts.push(text);
        messages.push({
          info: {
            id: `msg_user_${messages.length}`,
            role: "user",
            sessionID: "ses_browser",
            time: { created: 1 },
          },
          parts: [{ type: "text", text }],
        });
        send(204, null);
      });
      return;
    }
    if (
      req.method === "POST" &&
      url.pathname === "/session/ses_browser/abort"
    ) {
      completed = true;
      messages.push({
        info: {
          id: "msg_asst_aborted",
          role: "assistant",
          sessionID: "ses_browser",
          time: { created: 2, completed: 3 },
          error: { name: "MessageAbortedError", data: {} },
        },
        parts: [],
      });
      return send(200, true);
    }
    return send(404, { error: "not found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    prompts,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function resolvePython() {
  const requested = process.env.PYTHON || process.env.OFFICE_PYTHON || "python";
  const resolved = spawnSync(
    requested,
    ["-c", "import sys; print(sys.executable)"],
    {
      encoding: "utf8",
    },
  );
  if (resolved.status !== 0 || !resolved.stdout.trim())
    throw new Error(`Could not resolve Python executable: ${requested}`);
  return resolved.stdout.trim();
}

async function startOffice(project) {
  const root = path.resolve(__dirname, "..");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "office-handoff-ui-"));
  const home = path.join(temp, "home");
  fs.mkdirSync(home, { recursive: true });
  const fake = await startFakeOpenCode(project);
  const python = await resolvePython();
  const port = await unusedPort();
  const handle = spawn(
    python,
    ["run.py", "--port", String(port), "--enable-opencode-handoff"],
    {
      cwd: root,
      env: { ...process.env, HERMES_HOME: home },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 140; attempt++) {
    try {
      const response = await fetch(`${base}/opencode-handoff`);
      if (response.ok) {
        const body = await response.json();
        return {
          base,
          fake,
          token: body.token,
          project,
          close: async () => {
            handle.kill();
            await new Promise((resolve) => handle.once("exit", resolve));
            await fake.close();
            fs.rmSync(temp, { recursive: true, force: true });
          },
        };
      }
    } catch {}
    if (handle.exitCode !== null)
      throw new Error(`Handoff server exited: ${handle.stderr.read()}`);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  handle.kill();
  throw new Error("Handoff server did not start");
}

async function revealHandoffTab(page) {
  await page.waitForFunction(() => window.officeHandoff != null);
  const open = await page.evaluate(() => {
    const sheet = document.querySelector("#sheet-tasks");
    const btn = document.querySelector('[data-sheet="sheet-tasks"]');
    return (
      sheet && !sheet.hidden && btn?.getAttribute("aria-expanded") === "true"
    );
  });
  if (!open) await page.click('[data-sheet="sheet-tasks"]');
  const pressed = await page.evaluate(
    () =>
      document
        .querySelector('[data-task-view="handoff"]')
        .getAttribute("aria-pressed") === "true",
  );
  if (!pressed) await page.click('[data-task-view="handoff"]');
  await page.waitForFunction(
    () => !document.querySelector("#session-handoff").hidden,
  );
}

async function openHandoffTab(page) {
  await page.goto(office.base);
  await revealHandoffTab(page);
}

let office;

async function pageready() {
  const page = await browser.newPage({ viewport: { width: 820, height: 900 } });
  page.setDefaultTimeout(5000);
  return page;
}

test("pair, send, reconcile, and cancel a reviewed prompt end to end", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-proj-"));
  const project = path.join(temp, "project");
  fs.mkdirSync(project, { recursive: true });
  office = await startOffice(project);
  const page = await pageready();
  const handoffErrors = [];
  page.on("pageerror", (error) => {
    if (/handoff|Handoff|officeHandoff/.test(error.message))
      handoffErrors.push(error.message);
  });
  try {
    await openHandoffTab(page);

    // Capability banner reflects a healthy, enabled, unpaired adapter.
    await page.waitForFunction(() =>
      document
        .querySelector("#handoff-capability")
        .textContent.includes("Not paired"),
    );

    // A stale/mismatched selection is rejected by the adapter before dispatch:
    // pair with the wrong project must fail and never reach the runtime.
    await page.fill("#handoff-server-url", office.fake.url);
    await page.fill("#handoff-session-id", "ses_browser");
    await page.fill("#handoff-project", temp); // wrong: runtime reports project
    await page.click("#handoff-pair-submit");
    await page.waitForFunction(
      () =>
        document
          .querySelector("#handoff-pair-status")
          .textContent.includes("could not pair") ||
        document
          .querySelector("#handoff-pair-status")
          .textContent.includes("Could not pair"),
    );
    assert.equal(office.fake.prompts.length, 0);

    // Pair with the reviewed project succeeds and shows the observed version.
    await page.fill("#handoff-project", office.project);
    await page.click("#handoff-pair-submit");
    await page.waitForFunction(
      () => !document.querySelector("#handoff-paired").hidden,
    );
    assert.equal(
      await page.locator("#handoff-pair-server").innerText(),
      office.fake.url,
    );
    assert.equal(
      await page.locator("#handoff-pair-version").innerText(),
      "2.0.29",
    );
    assert.equal(
      await page.locator("#handoff-pair-project").innerText(),
      office.project,
    );

    // Only an explicit Send dispatches. Clicking furniture (the paired card,
    // change button, and an unrelated label) must never create a receipt.
    await page.click("#handoff-paired");
    await page.click("#handoff-send-disclosure");
    await page.click("#handoff-change");
    await page.click("#handoff-pair-cancel");
    assert.equal(office.fake.prompts.length, 0);

    // Send the exact prompt.
    const promptText = "refactor login, keep $\n🪴 $(literal) and the dry run";
    await page.fill("#handoff-prompt", promptText);
    await page.click("#handoff-send-submit");
    await page.waitForFunction(
      () =>
        document.querySelectorAll("#handoff-list .handoff-card").length >= 1,
    );
    await page.waitForFunction(
      () =>
        document.querySelectorAll("#handoff-list .handoff-status-accepted")
          .length +
          document.querySelectorAll("#handoff-list .handoff-status-executing")
            .length >=
        1,
    );
    assert.deepEqual(office.fake.prompts, [promptText]);

    // Select the receipt, which loads its full prompt and detail.
    await page.click("#handoff-list .handoff-card");
    await page.waitForFunction(
      (expected) =>
        document.querySelector("#handoff-list .handoff-prompt-text")
          ?.textContent === expected,
      promptText,
    );

    // Refresh reconciles against runtime history.
    await page.click("#handoff-list .handoff-refresh");
    await page.waitForFunction(() =>
      document
        .querySelector("#handoff-list .handoff-detail-status")
        ?.textContent.includes("Reconciled"),
    );

    // Cancel the active receipt; the runtime confirms the abort.
    await page.click("#handoff-list .handoff-cancel");
    await page.waitForFunction(() =>
      document
        .querySelector("#handoff-list .handoff-detail-status")
        ?.textContent.includes("Cancellation recorded"),
    );
    assert.equal(
      await page.locator("#handoff-list .handoff-status-cancelled").count(),
      1,
    );

    assert.deepEqual(handoffErrors, []);
  } finally {
    await page.close();
    await office.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("draft retry after reload reuses the request identity without a second dispatch", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-retry-"));
  const project = path.join(temp, "project");
  fs.mkdirSync(project, { recursive: true });
  office = await startOffice(project);
  const page = await pageready();
  try {
    await openHandoffTab(page);
    await page.fill("#handoff-server-url", office.fake.url);
    await page.fill("#handoff-session-id", "ses_browser");
    await page.fill("#handoff-project", office.project);
    await page.click("#handoff-pair-submit");
    await page.waitForFunction(
      () => !document.querySelector("#handoff-paired").hidden,
    );

    await page.check("#handoff-remember");
    const promptText = "duplicate-safe prompt";
    await page.fill("#handoff-prompt", promptText);
    await page.click("#handoff-send-submit");
    await page.waitForFunction(
      () =>
        document.querySelectorAll("#handoff-list .handoff-card").length >= 1,
    );
    const firstDispatches = office.fake.prompts.length;
    assert.equal(firstDispatches, 1);

    // Reload keeps the paired destination (server side) and restores the draft,
    // reusing the same request identity so re-sending does not create a new
    // submission.
    await page.reload();
    await revealHandoffTab(page);
    await page.waitForFunction(
      () => !document.querySelector("#handoff-paired").hidden,
    );
    await page.waitForFunction(
      (expected) =>
        document.querySelector("#handoff-prompt")?.value === expected,
      promptText,
    );
    const reusedId = await page.evaluate(
      () => document.querySelector("#handoff-draft-status").textContent,
    );

    // Re-send the unchanged draft; the server returns the existing receipt and
    // does not dispatch a second prompt.
    await page.click("#handoff-send-submit");
    await page.waitForFunction(
      () =>
        document.querySelectorAll("#handoff-list .handoff-card").length >= 1,
    );
    assert.equal(office.fake.prompts.length, 1);
    assert.match(reusedId, /request ID/i);
  } finally {
    await page.close();
    await office.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
