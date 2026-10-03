const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { officeUrl, renderPanel } = require("../vscode/panel");
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
test("forwarded URI is escaped and allowed by the iframe policy", () => {
  const html = renderPanel(
    fs.readFileSync("vscode/media/office.html", "utf8"),
    "https://example.com/proxy/?a=1&b=2",
  );
  assert.ok(html.includes("frame-src https://example.com"));
  assert.ok(html.includes('src="https://example.com/proxy/?a=1&amp;b=2"'));
  assert.ok(!html.includes("{{"));
});
