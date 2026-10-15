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
