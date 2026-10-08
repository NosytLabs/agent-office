const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const http = require("node:http");
const panelHelpers = require("../vscode/panel");
const { officeUrl, renderPanel } = panelHelpers;
test("panel uses the configured server port and strips only the state endpoint", () => {
  assert.equal(
    officeUrl("http://127.0.0.1:8125/state"),
    "http://127.0.0.1:8125/",
  );
  assert.equal(
    officeUrl("https://example.com/proxy/8125/state"),
    "https://example.com/proxy/8125/",
  );
  assert.throws(() => officeUrl("javascript:alert(1)"));
});
test("URL handling preserves forwarding queries and rejects embedded credentials", () => {
  assert.equal(
    officeUrl("https://example.com/proxy/state?route=office#old"),
    "https://example.com/proxy/?route=office",
  );
  assert.equal(officeUrl("http://[::1]:8113"), "http://[::1]:8113/");
  assert.throws(() => officeUrl("http://user:secret@localhost:8113/state"));
});
test("forwarded URI is escaped and allowed by the iframe policy", () => {
  const html = renderPanel(
    fs.readFileSync("vscode/media/office.html", "utf8"),
    "https://example.com/proxy/?a=1&b=2",
  );
  assert.ok(html.includes("frame-src https://example.com"));
  assert.ok(html.includes('src="https://example.com/proxy/?a=1&amp;b=2"'));
  assert.ok(!html.includes("{{"));
});
test("connection shell permits only nonce scripts and does not display query secrets", () => {
  const html = renderPanel(
    fs.readFileSync("vscode/media/office.html", "utf8"),
    "https://example.com/proxy/?token=secret-token",
    {
      nonce: "0123456789abcdef0123456789abcdef",
      phase: "offline",
      detail: "<untrusted>",
    },
  );
  assert.ok(
    html.includes("script-src 'nonce-0123456789abcdef0123456789abcdef'"),
  );
  assert.ok(!html.includes("'unsafe-inline'"));
  assert.ok(html.includes("&lt;untrusted&gt;"));
  assert.ok(html.includes('data-phase="offline"'));
  assert.ok(!html.includes(">https://example.com/proxy/?token="));
  assert.ok(html.includes('data-command="reload"'));
});

test("unusual hostname characters cannot escape the CSP attribute", () => {
  const html = renderPanel(
    fs.readFileSync("vscode/media/office.html", "utf8"),
    'https://example.test"data-injected="true/',
  );
  assert.ok(
    html.includes(
      "frame-src https://example.test&quot;data-injected=&quot;true",
    ),
  );
  assert.ok(!html.includes('example.test"data-injected="true'));
});

async function localServer(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${server.address().port}/state`;
}

test("one-shot connection check recognizes observer state and refuses unrelated JSON", async (t) => {
  assert.equal(typeof panelHelpers.probeOffice, "function");
  let valid = true;
  const address = await localServer(t, (request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify(
        valid ? { agents: [], events: [], stats: {} } : { ok: true },
      ),
    );
  });
  assert.equal((await panelHelpers.probeOffice(address)).phase, "online");
  valid = false;
  assert.equal((await panelHelpers.probeOffice(address)).phase, "unverified");
});

test("connection checks time out and can be aborted without waiting for the server", async (t) => {
  assert.equal(typeof panelHelpers.probeOffice, "function");
  const address = await localServer(t, () => {});
  assert.equal(
    (await panelHelpers.probeOffice(address, { timeoutMs: 30 })).phase,
    "offline",
  );
  const controller = new AbortController();
  const pending = panelHelpers.probeOffice(address, {
    signal: controller.signal,
  });
  controller.abort();
  assert.equal((await pending).phase, "cancelled");
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function extensionHarness(options = {}) {
  const commands = new Map();
  const panels = [];
  const external = [];
  const settings = {
    stateUrl: "http://127.0.0.1:8113/state",
    openOnStartup: false,
    showStatusBar: true,
  };
  const errors = [];
  let configurationListener;
  let serializer;
  const uri = (value) => ({ toString: () => value });
  const disposable = () => ({ dispose() {} });
  const api = {
    Uri: { parse: uri },
    ViewColumn: { Beside: 2 },
    StatusBarAlignment: { Left: 1 },
    env: {
      asExternalUri: options.asExternalUri || (async (value) => value),
      openExternal: async (value) => {
        external.push(value.toString());
        return true;
      },
    },
    commands: {
      registerCommand(name, callback) {
        commands.set(name, callback);
        return disposable();
      },
      executeCommand: async (...args) => {
        external.push(args);
      },
    },
    workspace: {
      getConfiguration: () => ({
        get: (key, fallback) => settings[key] ?? fallback,
      }),
      onDidChangeConfiguration(callback) {
        configurationListener = callback;
        return disposable();
      },
    },
    window: {
      showErrorMessage: (message) => errors.push(message),
      createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
      registerWebviewPanelSerializer(type, value) {
        serializer = value;
        return disposable();
      },
      createWebviewPanel(type, title, column, webviewOptions) {
        let disposed = false;
        let disposeListener;
        let receiveListener;
        let html = "";
        const panel = {
          options: webviewOptions,
          messages: [],
          reveals: 0,
          webview: {
            get html() {
              return html;
            },
            set html(value) {
              assert.ok(!disposed, "disposed panel must not be changed");
              html = value;
            },
            postMessage: async (message) => {
              panel.messages.push(message);
              return true;
            },
            onDidReceiveMessage(callback) {
              receiveListener = callback;
              return disposable();
            },
          },
          onDidDispose(callback) {
            disposeListener = callback;
            return disposable();
          },
          reveal() {
            panel.reveals += 1;
          },
          dispose() {
            if (!disposed) {
              disposed = true;
              disposeListener?.();
            }
          },
          receive(message) {
            return receiveListener?.(message);
          },
        };
        panels.push(panel);
        return panel;
      },
    },
  };
  const extensionModule = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync("vscode/extension.js", "utf8"),
    {
      module: extensionModule,
      exports: extensionModule.exports,
      require(name) {
        if (name === "vscode") return api;
        if (name === "./panel")
          return {
            ...panelHelpers,
            probeOffice:
              options.probeOffice ||
              (async () => ({ phase: "online", detail: "Observer reachable" })),
          };
        return require(name);
      },
      AbortController,
      console,
      setTimeout,
      clearTimeout,
    },
    { filename: "extension.js" },
  );
  const context = { extensionPath: path.resolve("vscode"), subscriptions: [] };
  extensionModule.exports.activate(context);
  return {
    commands,
    panels,
    settings,
    external,
    errors,
    dispose: () => extensionModule.exports.deactivate(),
    change: (key) =>
      configurationListener({
        affectsConfiguration: (name) => name === `hermesPixelOffice.${key}`,
      }),
    get serializer() {
      return serializer;
    },
  };
}

test("an older asynchronous forwarding result cannot overwrite newer URL settings", async () => {
  const older = deferred();
  const harness = extensionHarness({
    asExternalUri: (uri) =>
      uri.toString().includes("8113") ? older.promise : Promise.resolve(uri),
  });
  const opening = harness.commands.get("hermesPixelOffice.open")();
  harness.settings.stateUrl = "http://127.0.0.1:8125/state";
  await harness.change("stateUrl");
  await new Promise(setImmediate);
  assert.ok(harness.panels[0].webview.html.includes("127.0.0.1:8125"));
  older.resolve({ toString: () => "http://127.0.0.1:8113/" });
  await opening;
  await new Promise(setImmediate);
  assert.ok(harness.panels[0].webview.html.includes("127.0.0.1:8125"));
  assert.ok(!harness.panels[0].webview.html.includes("127.0.0.1:8113"));
  harness.dispose();
});

test("reload is discoverable and refreshes the same panel without granting filesystem access", async () => {
  const harness = extensionHarness();
  assert.equal(
    typeof harness.commands.get("hermesPixelOffice.reload"),
    "function",
  );
  await harness.commands.get("hermesPixelOffice.open")();
  const panel = harness.panels[0];
  const before = panel.webview.html;
  await harness.commands.get("hermesPixelOffice.reload")();
  assert.equal(harness.panels.length, 1);
  assert.notEqual(panel.webview.html, before);
  assert.deepEqual(Array.from(panel.options.localResourceRoots), []);
  await harness.commands.get("hermesPixelOffice.openInBrowser")();
  assert.deepEqual(harness.external, ["http://127.0.0.1:8113/"]);
  harness.dispose();
});

test("closing a connecting panel cancels its check and prevents late updates", async () => {
  const pending = deferred();
  let signal;
  const harness = extensionHarness({
    probeOffice: async (url, options) => {
      signal = options.signal;
      return pending.promise;
    },
  });
  const opening = harness.commands.get("hermesPixelOffice.open")();
  await new Promise(setImmediate);
  harness.panels[0].dispose();
  assert.ok(signal?.aborted);
  pending.resolve({ phase: "online", detail: "Late response" });
  await opening;
  assert.equal(harness.panels[0].messages.length, 0);
  assert.deepEqual(harness.errors, []);
  harness.dispose();
});

test("webview messages cannot provide arbitrary commands or external URLs", async () => {
  const harness = extensionHarness();
  await harness.commands.get("hermesPixelOffice.open")();
  const panel = harness.panels[0];
  const token = /data-token="([^"]+)"/.exec(panel.webview.html)?.[1];
  assert.ok(token);
  await panel.receive({
    command: "openBrowser",
    token: "wrong",
    url: "https://attacker.example",
  });
  await panel.receive({ command: "workbench.action.terminal.new", token });
  assert.deepEqual(harness.external, []);
  await panel.receive({
    command: "openBrowser",
    token,
    url: "https://attacker.example",
  });
  assert.deepEqual(harness.external, ["http://127.0.0.1:8113/"]);
  harness.dispose();
});
