const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const { webcrypto } = require("node:crypto");
function preview() {
  const memory = new Map(),
    pending = [],
    calls = [];
  const key = "agent-office:static-preview:v1";
  let held = false;
  const context = {
    structuredClone,
    TextEncoder,
    Response,
    URL,
    DOMException,
    Request: class extends Request {
      constructor(input, options) {
        super(new URL(input, "http://preview.test/"), options);
      }
    },
    Date,
    crypto: webcrypto,
    location: { origin: "http://preview.test" },
    document: { querySelector: () => null, addEventListener() {} },
    localStorage: {
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => memory.set(k, v),
    },
    fetch: () => {
      throw new Error("Unexpected external fetch");
    },
    __AGENT_OFFICE_PREVIEW_SEED__: JSON.parse(
      fs.readFileSync("tools/fixtures/preview.json", "utf8"),
    ),
    navigator: {
      locks: {
        request(name, options, callback) {
          if (typeof options === "function") {
            callback = options;
            options = {};
          }
          calls.push({ name, mode: options.mode || "exclusive" });
          if (!held) return Promise.resolve().then(callback);
          return new Promise((resolve, reject) => {
            const run = () =>
              Promise.resolve().then(callback).then(resolve, reject);
            pending.push(run);
            options.signal?.addEventListener(
              "abort",
              () => {
                pending.splice(pending.indexOf(run), 1);
                reject(new DOMException("Aborted", "AbortError"));
              },
              { once: true },
            );
          });
        },
      },
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("web/js/data.js", "utf8"), context);
  vm.runInContext(fs.readFileSync("web/js/preview.js", "utf8"), context);
  return {
    context,
    calls,
    hold() {
      held = true;
    },
    clear() {
      memory.set(
        key,
        JSON.stringify({
          version: 1,
          settings: {},
          settingsRevision: "clear-1",
          historyCleared: true,
          reset: false,
        }),
      );
    },
    release() {
      held = false;
      for (const run of pending.splice(0)) run();
    },
  };
}
test("demo history reads wait for a cooperating write and observe its committed flags", async () => {
  const p = preview();
  p.hold();
  let settled = false;
  const response = p.context
    .fetch("history")
    .then((r) => r.json())
    .then((value) => {
      settled = true;
      return value;
    });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    settled,
    false,
    "read must not overtake a pending reset/history transaction",
  );
  p.clear();
  p.release();
  assert.deepEqual((await response).events, []);
  assert.equal(p.calls[0].mode, "shared");
});
test("a queued preview GET honors cancellation while waiting for the read lock", async () => {
  const p = preview();
  p.hold();
  const controller = new AbortController();
  const response = p.context.fetch("settings", { signal: controller.signal });
  controller.abort();
  await assert.rejects(response, { name: "AbortError" });
  p.release();
});
