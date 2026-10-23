const { test } = require("node:test");
const assert = require("node:assert/strict");
const library = require("../web/js/prompt-library.js");

const brief = (id = "one", name = "Review API") => ({
  id,
  name,
  runtime: "codex",
  text: "Goal\n\n  Keep indentation.\nLast line\n",
});
function fixture(raw = null) {
  let value = raw,
    failRead = false,
    failWrite = false,
    nextId = 0;
  const storage = {
    getItem: () => {
      if (failRead) throw new Error("denied");
      return value;
    },
    setItem: (_key, next) => {
      if (failWrite) throw new Error("quota");
      value = next;
    },
  };
  const store = library.createStore({
    storage,
    key: "test",
    idFactory: () => "brief-" + ++nextId,
  });
  store.read();
  return {
    store,
    raw: () => value,
    replace: (next) => {
      value = next;
    },
    failRead: (next) => {
      failRead = next;
    },
    failWrite: (next) => {
      failWrite = next;
    },
  };
}

test("validated library retains exact multiline text and isolates observer and preview keys", () => {
  assert.deepEqual(library.parseLibrary(null), { version: 1, briefs: [] });
  const item = brief(),
    raw = JSON.stringify({ version: 1, briefs: [item] });
  assert.deepEqual(library.parseLibrary(raw).briefs[0], item);
  assert.notEqual(library.storageKey(false), library.storageKey(true));
});

test("malformed, oversized, duplicate and unsupported saved entries fail closed as a whole", () => {
  for (const value of [
    "{",
    JSON.stringify({ version: 2, briefs: [] }),
    JSON.stringify({
      version: 1,
      briefs: [brief(), { ...brief("two"), runtime: "arbitrary-cli" }],
    }),
    JSON.stringify({
      version: 1,
      briefs: [brief(), brief("two", "review api")],
    }),
    JSON.stringify({ version: 1, briefs: [brief(), brief("one", "Another")] }),
    JSON.stringify({
      version: 1,
      briefs: [{ ...brief(), text: "x".repeat(8193) }],
    }),
    JSON.stringify({ version: 1, briefs: [{ ...brief(), name: "Bad\nname" }] }),
    JSON.stringify({
      version: 1,
      briefs: Array.from({ length: 13 }, (_, i) =>
        brief("b" + i, "Brief " + i),
      ),
    }),
  ])
    assert.throws(() => library.parseLibrary(value), /invalid/i);
});

test("saving twelve named briefs rejects the thirteenth and never silently replaces duplicate names", () => {
  const f = fixture();
  for (let i = 0; i < 12; i++)
    assert.equal(f.store.add({ ...brief(), name: "Brief " + i }).ok, true);
  const before = f.raw();
  assert.equal(f.store.add(brief()).ok, false);
  assert.equal(f.raw(), before);
  assert.equal(f.store.rename("brief-1", "Brief 1").ok, false);
  assert.equal(f.raw(), before);
  assert.equal(f.store.rename("brief-1", "Renamed brief").ok, true);
  assert.equal(f.store.state().briefs[0].text, brief().text);
  assert.equal(f.store.remove("brief-1").ok, true);
  assert.equal(f.store.state().briefs.length, 11);
});

test("failed storage writes preserve the prior library until an explicit retry succeeds", () => {
  const f = fixture();
  assert.equal(f.store.add(brief()).ok, true);
  const before = f.raw();
  f.failWrite(true);
  assert.equal(f.store.add(brief("unused", "Second brief")).ok, false);
  assert.equal(f.raw(), before);
  assert.equal(f.store.state().briefs.length, 1);
  assert.match(f.store.state().error, /not saved|could not/i);
  f.failWrite(false);
  assert.equal(f.store.add(brief("unused", "Second brief")).ok, true);
  assert.equal(f.store.state().briefs.length, 2);
});

test("a stale tab refreshes its library and requires review before a mutation can retry", () => {
  const f = fixture();
  f.store.add(brief());
  const external = JSON.stringify({
    version: 1,
    briefs: [brief("external", "Other tab")],
  });
  f.replace(external);
  assert.equal(f.store.rename("brief-1", "Stale replacement").ok, false);
  assert.equal(f.raw(), external);
  assert.match(f.store.state().error, /another tab|changed/i);
  assert.equal(f.store.state().briefs[0].id, "external");
  assert.equal(f.store.add(brief("unused", "Fresh brief")).ok, true);
  assert.deepEqual(
    f.store.state().briefs.map((b) => b.name),
    ["Other tab", "Fresh brief"],
  );
});

test("unreadable and corrupt storage keeps the last readable library but disables changes", () => {
  const f = fixture();
  f.store.add(brief());
  f.failRead(true);
  f.store.read();
  assert.equal(f.store.state().available, false);
  assert.equal(f.store.state().briefs.length, 1);
  assert.equal(f.store.remove("brief-1").ok, false);
  f.failRead(false);
  f.replace("{invalid stored data");
  f.store.read();
  assert.equal(f.store.state().available, false);
  assert.equal(f.store.add(brief()).ok, false);
  assert.equal(f.raw(), "{invalid stored data");
});

test("loading requires a concrete choice for nonempty drafts, and append keeps the current destination", () => {
  const current = { text: "Unsaved work\n", runtime: "claude" },
    item = brief();
  assert.throws(() => library.prepareLoad(current, item), /review/i);
  assert.deepEqual(current, { text: "Unsaved work\n", runtime: "claude" });
  assert.deepEqual(library.prepareLoad(current, item, "append"), {
    text: "Unsaved work\n\n\n" + item.text,
    runtime: "claude",
  });
  assert.deepEqual(library.prepareLoad(current, item, "replace"), {
    text: item.text,
    runtime: "codex",
  });
  assert.deepEqual(library.prepareLoad({ text: "", runtime: "claude" }, item), {
    text: item.text,
    runtime: "codex",
  });
  assert.throws(
    () =>
      library.prepareLoad(
        { text: "x".repeat(8190), runtime: "claude" },
        item,
        "append",
      ),
    /8,192|8192|space/i,
  );
});

test("search finds literal names, destinations and content without changing stored entries", () => {
  const input = [
      brief(),
      {
        ...brief("two", "Write docs"),
        runtime: "claude",
        text: "Document the release.",
      },
    ],
    before = JSON.stringify(input);
  assert.deepEqual(
    library.searchBriefs(input, "CLAUDE").map((b) => b.id),
    ["two"],
  );
  assert.deepEqual(
    library.searchBriefs(input, "indentation").map((b) => b.id),
    ["one"],
  );
  assert.equal(JSON.stringify(input), before);
});

test("backup serialization round trips the exact strict version-one source shape", () => {
  const items = [brief(), brief("two", "Second")];
  const raw = library.serializeLibrary(items);
  assert.deepEqual(library.parseLibrary(raw), { version: 1, briefs: items });
  assert.throws(
    () => library.serializeLibrary([{ ...brief(), extra: true }]),
    /invalid/i,
  );
  assert.throws(
    () =>
      library.parseLibrary(
        JSON.stringify({ version: 1, briefs: [], extra: true }),
      ),
    /invalid/i,
  );
});

test("the backup size limit measures UTF-8 bytes and accepts the exact boundary", () => {
  const raw = JSON.stringify({
    version: 1,
    briefs: [{ ...brief(), text: "🙂".repeat(4096) }],
  });
  assert.equal(
    library.parseLibrary(
      " ".repeat(library.MAX_BYTES - Buffer.byteLength(raw)) + raw,
    ).briefs.length,
    1,
  );
  assert.throws(
    () => library.parseLibrary(" ".repeat(library.MAX_BYTES) + raw),
    /invalid/i,
  );
  assert.throws(
    () =>
      library.parseLibrary(
        " ".repeat(library.MAX_BYTES - Buffer.byteLength(raw) + 1) + raw,
      ),
    /invalid/i,
  );
});

test("reviewed Merge rejects all collisions and overflow without partially changing inputs", () => {
  const current = [brief()],
    incoming = [brief("two", "Second")],
    before = JSON.stringify([current, incoming]);
  assert.deepEqual(library.prepareImport(current, incoming, "merge").briefs, [
    ...current,
    ...incoming,
  ]);
  assert.equal(JSON.stringify([current, incoming]), before);
  for (const conflict of [
    [brief("one", "New name")],
    [brief("different", "review api")],
    Array.from({ length: 12 }, (_, i) => brief("b" + i, "Brief " + i)),
  ])
    assert.throws(
      () => library.prepareImport(current, conflict, "merge"),
      /same|already|12|conflict/i,
    );
  assert.throws(
    () => library.prepareImport(current, incoming),
    /choose|review|merge|replace/i,
  );
  assert.deepEqual(library.prepareImport(current, incoming, "replace"), {
    version: 1,
    briefs: incoming,
  });
  assert.deepEqual(library.prepareImport(current, [], "replace"), {
    version: 1,
    briefs: [],
  });
});

test("import commits are atomic across quota failure, stale storage, and explicit retry", () => {
  const f = fixture();
  f.store.add(brief());
  const initial = f.raw(),
    raw = JSON.stringify({
      version: 1,
      briefs: [brief("incoming", "Incoming")],
    });
  f.failWrite(true);
  assert.equal(f.store.importLibrary(raw, "merge").ok, false);
  assert.equal(f.raw(), initial);
  assert.deepEqual(
    f.store.state().briefs.map((item) => item.name),
    ["Review API"],
  );
  f.failWrite(false);
  f.replace(
    JSON.stringify({ version: 1, briefs: [brief("external", "Other tab")] }),
  );
  assert.equal(f.store.importLibrary(raw, "replace").ok, false);
  assert.equal(JSON.parse(f.raw()).briefs[0].name, "Other tab");
  assert.equal(f.store.importLibrary(raw, "merge").ok, true);
  assert.deepEqual(
    f.store.state().briefs.map((item) => item.name),
    ["Other tab", "Incoming"],
  );
  const stored = f.raw();
  assert.equal(
    f.store.importLibrary('{"version":1,"briefs":[],"extra":true}', "replace")
      .ok,
    false,
  );
  assert.equal(f.raw(), stored);
});

test("saved brief text uses the runner's Unicode code-point boundary without changing exact text", () => {
  const item = { ...brief(), text: "🚀".repeat(8190) + "\n末" };
  const f = fixture();
  assert.equal(f.store.add(item).ok, true);
  const saved = f.store.state().briefs[0];
  assert.equal(saved.text, item.text);
  assert.equal(
    library.parseLibrary(library.serializeLibrary([saved])).briefs[0].text,
    item.text,
  );
  assert.equal(
    library.prepareLoad({ text: "", runtime: "claude" }, saved).text,
    item.text,
  );
  const previous = f.raw();
  assert.equal(
    f.store.add({ ...item, name: "Too long", text: item.text + "x" }).ok,
    false,
  );
  assert.equal(f.raw(), previous);
  assert.throws(
    () =>
      library.parseLibrary(
        JSON.stringify({
          version: 1,
          briefs: [{ ...saved, text: item.text + "x" }],
        }),
      ),
    /invalid/i,
  );
});

test("Unicode Append includes its separators and rejects overflow without altering either source", () => {
  const current = { text: "😀".repeat(4095), runtime: "claude" };
  const item = { ...brief(), text: "𝒳".repeat(4095) };
  const before = JSON.stringify([current, item]);
  assert.deepEqual(library.prepareLoad(current, item, "append"), {
    text: current.text + "\n\n" + item.text,
    runtime: "claude",
  });
  assert.throws(
    () =>
      library.prepareLoad(
        { ...current, text: current.text + "x" },
        item,
        "append",
      ),
    /space|8,192/i,
  );
  assert.equal(JSON.stringify([current, item]), before);
  assert.equal(
    library.prepareLoad(
      { text: "🚀".repeat(8192), runtime: "claude" },
      item,
      "replace",
    ).text,
    item.text,
  );
});

test("combined emoji and combining marks are code points, not one displayed symbol", () => {
  for (const ending of ["👨‍👩‍👧‍👦", "e\u0301"]) {
    const text = "x".repeat(8192 - Array.from(ending).length) + ending;
    const f = fixture();
    assert.equal(f.store.add({ ...brief(), text }).ok, true);
    assert.equal(
      f.store.add({ ...brief(), name: "Over boundary", text: text + "x" }).ok,
      false,
    );
    assert.equal(f.store.state().briefs[0].text, text);
  }
});

// Exercise the real draft controller without requiring a browser or provider.
function draftFixture(storage = new Map()) {
  const fs = require("node:fs"),
    path = require("node:path"),
    vm = require("node:vm");
  const nodes = new Map(),
    events = [],
    copied = [],
    downloads = [];
  function get(id) {
    if (!nodes.has(id))
      nodes.set(id, {
        value: "",
        checked: false,
        disabled: false,
        textContent: "",
        events: {},
        attrs: {},
        addEventListener(type, listener) {
          this.events[type] = listener;
        },
        setAttribute(name, value) {
          this.attrs[name] = value;
        },
        removeAttribute(name) {
          delete this.attrs[name];
        },
        setCustomValidity(message) {
          this.validationMessage = message;
        },
        focus() {},
        select() {},
      });
    return nodes.get(id);
  }
  const runtime = get("task-draft-runtime");
  runtime.value = "codex";
  runtime.options = [
    { value: "codex", textContent: "Codex" },
    { value: "claude", textContent: "Claude Code" },
  ];
  Object.defineProperty(runtime, "selectedOptions", {
    get: () => runtime.options.filter((item) => item.value === runtime.value),
  });
  get("task-draft-text").attrs.maxlength = "8192";
  const sandbox = {
    document: {
      body: { dataset: {} },
      getElementById: get,
      createElement: () => ({ click() {} }),
    },
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    navigator: {
      clipboard: { writeText: async (value) => copied.push(value) },
    },
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    dispatchEvent: (event) => events.push(event),
    capturePanelInteraction: () => () => true,
    canSelectCopyFallback: () => false,
    Blob,
    URL: {
      createObjectURL: (blob) => {
        downloads.push(blob);
        return "blob:fixture";
      },
      revokeObjectURL() {},
    },
    setTimeout() {},
  };
  sandbox.window = sandbox;
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../web/js/task-desk.js"), "utf8"),
    sandbox,
  );
  return {
    get,
    storage,
    events,
    copied,
    downloads,
    key: "agent-office:task-draft:v1:observer",
    input(value) {
      get("task-draft-text").value = value;
      get("task-draft-text").events.input();
    },
    remember(value) {
      get("task-draft-remember").checked = value;
      get("task-draft-remember").events.change();
    },
    click(id) {
      return get(id).events.click();
    },
  };
}

test("draft counts, native editing and retained restoration accept 8,192 Unicode code points", async () => {
  const f = draftFixture(),
    text = "🚀".repeat(8190) + "\n末";
  assert.equal(
    f.get("task-draft-text").attrs.maxlength,
    undefined,
    "UTF-16 maxlength must not truncate valid Unicode input",
  );
  f.input(text);
  assert.equal(
    f.get("task-draft-count").textContent,
    "8,192 / 8,192 characters",
  );
  assert.equal(f.events.at(-1).detail.length, 8192);
  assert.equal(f.get("task-draft-copy").disabled, false);
  f.remember(true);
  const restored = draftFixture(f.storage);
  assert.equal(restored.get("task-draft-text").value, text);
  assert.equal(restored.get("task-draft-remember").checked, true);
  await f.click("task-draft-copy");
  await f.click("task-draft-export");
  assert.equal(f.copied[0], text);
  assert.equal(await f.downloads[0].text(), text);
});

test("oversized draft edits remain visible but cannot overwrite retention or copy/export", async () => {
  const f = draftFixture();
  f.input("Retain this exact brief");
  f.remember(true);
  const previous = f.storage.get(f.key),
    tooLong = "🚀".repeat(8193);
  f.input(tooLong);
  assert.equal(f.get("task-draft-text").value, tooLong);
  assert.equal(f.storage.get(f.key), previous);
  assert.equal(f.get("task-draft-copy").disabled, true);
  assert.equal(f.get("task-draft-export").disabled, true);
  assert.equal(f.get("task-draft-text").attrs["aria-invalid"], "true");
  assert.match(
    f.get("task-draft-status").textContent,
    /8,192|too long|limit|exceeds/i,
  );
  await f.click("task-draft-copy");
  await f.click("task-draft-export");
  assert.equal(f.copied.length, 0);
  assert.equal(f.downloads.length, 0);
  f.input("Corrected 🧪");
  assert.equal(JSON.parse(f.storage.get(f.key)).text, "Corrected 🧪");
  assert.equal(f.get("task-draft-copy").disabled, false);
  assert.equal(f.get("task-draft-text").attrs["aria-invalid"], "false");
  f.input(tooLong);
  f.remember(false);
  assert.equal(
    f.storage.has(f.key),
    false,
    "oversized text must not block explicit opt-out",
  );
});

test("a template uses Unicode capacity without splitting input or overflowing", () => {
  const f = draftFixture();
  f.click("task-draft-template");
  const outline = f.get("task-draft-text").value;
  const prefix = "😀".repeat(8192 - Array.from(outline).length - 2);
  f.input(prefix);
  f.click("task-draft-template");
  const expected = prefix + "\n\n" + outline;
  assert.equal(f.get("task-draft-text").value, expected);
  assert.equal(
    f.get("task-draft-count").textContent,
    "8,192 / 8,192 characters",
  );
  f.click("task-draft-template");
  assert.equal(f.get("task-draft-text").value, expected);
  assert.match(f.get("task-draft-status").textContent, /not enough space/i);
});

test("explicit Replace can recover an oversized open draft without weakening Append validation", () => {
  const current = { text: "🚀".repeat(8193), runtime: "claude" },
    item = brief(),
    before = JSON.stringify([current, item]);
  assert.throws(() => library.prepareLoad(current, item), /review/i);
  assert.throws(
    () => library.prepareLoad(current, item, "append"),
    /limit|space/i,
  );
  assert.deepEqual(library.prepareLoad(current, item, "replace"), {
    text: item.text,
    runtime: item.runtime,
  });
  assert.equal(JSON.stringify([current, item]), before);
});
