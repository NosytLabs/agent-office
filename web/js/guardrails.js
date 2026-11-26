/* Guard rails: per-agent caps plus circuit-breaker presentation.

   Feature concepts after Munder Difflin (MIT, (c) 2026 Chaitanya Giri,
   https://github.com/HarnessMD/munder-difflin): a per-agent token cap and a
   circuit breaker that watches for loops and error storms. This is an
   original implementation for this observer: caps live in this browser,
   usage figures are the runtime-reported ones the office already shows, and
   a tripped breaker is reported, never enforced -- the office does not stop
   or message the observed agent. */
"use strict";
(function (root) {
  const STORAGE_KEY = "agent-office-guardrail-caps";
  const MAX_TOKEN_CAP = 1_000_000_000_000;
  const MAX_COST_CAP = 1_000_000;

  function cleanCap(value, max) {
    const number = typeof value === "string" ? Number(value) : value;
    if (typeof number !== "number" || !Number.isFinite(number)) return 0;
    if (number <= 0) return 0;
    return Math.min(number, max);
  }

  function parseCaps(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const caps = {};
    for (const [id, entry] of Object.entries(raw)) {
      if (typeof id !== "string" || !id || !entry || typeof entry !== "object")
        continue;
      const tokens = cleanCap(entry.tokens, MAX_TOKEN_CAP),
        cost = cleanCap(entry.cost_usd, MAX_COST_CAP);
      if (tokens > 0 || cost > 0)
        caps[id] = {
          ...(tokens > 0 ? { tokens } : {}),
          ...(cost > 0 ? { cost_usd: cost } : {}),
        };
    }
    return caps;
  }

  function loadCaps(storage) {
    try {
      return parseCaps(JSON.parse(storage?.getItem(STORAGE_KEY) || "null"));
    } catch {
      return {};
    }
  }

  function saveCaps(storage, caps) {
    const clean = parseCaps(caps);
    try {
      if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(clean));
      return true;
    } catch {
      return false;
    }
  }

  function setCap(caps, id, { tokens, cost_usd } = {}) {
    const next = { ...parseCaps(caps) };
    if (typeof id !== "string" || !id) return next;
    const entry = {
      ...(cleanCap(tokens, MAX_TOKEN_CAP) > 0
        ? { tokens: cleanCap(tokens, MAX_TOKEN_CAP) }
        : {}),
      ...(cleanCap(cost_usd, MAX_COST_CAP) > 0
        ? { cost_usd: cleanCap(cost_usd, MAX_COST_CAP) }
        : {}),
    };
    if (entry.tokens || entry.cost_usd) next[id] = entry;
    else delete next[id];
    return next;
  }

  function capState(used, cap) {
    if (!(cap > 0)) return null;
    if (typeof used !== "number" || !Number.isFinite(used) || used < 0)
      return { state: "unknown", ratio: null };
    const ratio = used / cap;
    return {
      state: ratio >= 1 ? "exceeded" : ratio >= 0.8 ? "near" : "within",
      ratio,
    };
  }

  function evaluateAgent(agent, caps, usage) {
    const findings = [];
    if (agent?.guard?.kind)
      findings.push({
        agentId: agent.id,
        kind: "breaker",
        breaker: agent.guard.kind,
        detail: String(agent.guard.detail || "Guard rail tripped"),
      });
    const cap = caps?.[agent?.id];
    if (cap && usage) {
      const tokens = capState(usage.total_tokens, cap.tokens),
        cost = capState(usage.cost_usd, cap.cost_usd);
      if (tokens?.state === "exceeded" || tokens?.state === "near")
        findings.push({
          agentId: agent.id,
          kind: tokens.state === "exceeded" ? "cap-exceeded" : "cap-near",
          field: "tokens",
          detail: `Reported ${Number(usage.total_tokens).toLocaleString()} tokens against a ${Number(cap.tokens).toLocaleString()} token cap`,
        });
      if (cost?.state === "exceeded" || cost?.state === "near")
        findings.push({
          agentId: agent.id,
          kind: cost.state === "exceeded" ? "cap-exceeded" : "cap-near",
          field: "cost_usd",
          detail: `Reported $${Number(usage.cost_usd).toLocaleString()} cost estimate against a $${Number(cap.cost_usd).toLocaleString()} cap`,
        });
    }
    return findings;
  }

  function firstAlert(agents, caps, usageFor) {
    for (const agent of Array.isArray(agents) ? agents : []) {
      if (!agent || typeof agent.id !== "string" || !agent.id) continue;
      const findings = evaluateAgent(
        agent,
        caps,
        typeof usageFor === "function" ? usageFor(agent) : null,
      );
      if (findings.length) return { agent, findings };
    }
    return null;
  }

  const api = Object.freeze({
    STORAGE_KEY,
    MAX_TOKEN_CAP,
    MAX_COST_CAP,
    parseCaps,
    loadCaps,
    saveCaps,
    setCap,
    capState,
    evaluateAgent,
    firstAlert,
  });
  if (typeof module === "object" && module.exports) module.exports = api;
  root.OfficeGuardrails = api;
})(typeof window === "undefined" ? globalThis : window);
