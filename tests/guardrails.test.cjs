"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const guardrails = require("../web/js/guardrails.js");

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    map,
  };
}

test("caps round-trip through storage and drop invalid entries", () => {
  const storage = memoryStorage();
  const caps = guardrails.setCap({}, "agent-1", { tokens: 5000, cost_usd: 2 });
  assert.equal(guardrails.saveCaps(storage, caps), true);
  assert.deepEqual(guardrails.loadCaps(storage), {
    "agent-1": { tokens: 5000, cost_usd: 2 },
  });
  assert.deepEqual(
    guardrails.parseCaps({
      bad: { tokens: -1 },
      worse: "nope",
      ok: { tokens: "250" },
    }),
    { ok: { tokens: 250 } },
  );
  assert.deepEqual(guardrails.loadCaps(memoryStorage({ x: "{broken" })), {});
});

test("clearing both caps removes the agent entry", () => {
  const caps = guardrails.setCap({ a: { tokens: 10 } }, "a", {
    tokens: 0,
    cost_usd: 0,
  });
  assert.deepEqual(caps, {});
});

test("cap state reports within, near, exceeded and unknown", () => {
  assert.equal(guardrails.capState(10, 100).state, "within");
  assert.equal(guardrails.capState(80, 100).state, "near");
  assert.equal(guardrails.capState(100, 100).state, "exceeded");
  assert.equal(guardrails.capState(undefined, 100).state, "unknown");
  assert.equal(guardrails.capState(10, 0), null);
});

test("evaluateAgent surfaces a tripped breaker before cap findings", () => {
  const agent = {
    id: "a",
    guard: { kind: "loop", detail: "Same tool call reported 6 times" },
  };
  const findings = guardrails.evaluateAgent(
    agent,
    { a: { tokens: 100 } },
    {
      total_tokens: 90,
    },
  );
  assert.equal(findings[0].kind, "breaker");
  assert.equal(findings[0].breaker, "loop");
  assert.equal(findings[1].kind, "cap-near");
});

test("firstAlert returns the first agent with findings", () => {
  const agents = [
    { id: "quiet" },
    { id: "loud", guard: { kind: "error-storm" } },
  ];
  const alert = guardrails.firstAlert(agents, {}, () => null);
  assert.equal(alert.agent.id, "loud");
  assert.equal(
    guardrails.firstAlert([{ id: "quiet" }], {}, () => null),
    null,
  );
});
