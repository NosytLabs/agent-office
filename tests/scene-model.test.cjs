const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const model = {};
vm.createContext(model);
vm.runInContext(fs.readFileSync("web/js/data.js", "utf8"), model);
test("walking never samples the typing or reading columns", () => {
  for (let distance = 0; distance < 60; distance++)
    assert.ok(
      [0, 1, 2].includes(
        model.characterFrame(
          { status: "working" },
          { moving: true, distance },
          0,
        ),
      ),
    );
});
test("working tool activity selects the actual sheet animation", () => {
  assert.equal(
    model.characterFrame(
      { status: "working", activity: "typing" },
      { moving: false },
      0,
    ),
    3,
  );
  assert.equal(
    model.characterFrame(
      { status: "working", tool: "read_file" },
      { moving: false },
      0,
    ),
    5,
  );
  assert.equal(
    model.characterFrame({ status: "idle" }, { moving: false }, 10),
    0,
  );
});
