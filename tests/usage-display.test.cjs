const { test } = require("node:test");
const assert = require("node:assert/strict");
const { observerFixture } = require("./observer-fixture.cjs");

test("unchanged usage polling preserves breakdown rows and cost sources", async () => {
  await observerFixture({}, async ({ page }) => {
    const stable = await page.evaluate(() => {
      const metrics = {
        reports: 1,
        total_tokens: 200,
        cost_usd: 0.001,
        coverage: { total_tokens: 1, cost_usd: 1 },
        cost_sources: [
          { source: "fixture estimate", cost_usd: 0.001, reports: 1 },
        ],
      };
      window._state.usage = {
        totals: metrics,
        by_model: [{ ...metrics, model: "fixture" }],
      };
      fillStats();
      const nodes = [...document.querySelector("#usage-breakdown").children];
      fillStats();
      return nodes.length > 0 && nodes.every((node) => node.isConnected);
    });
    assert.equal(stable, true);
  });
});

test("overflowed reported cost still triggers a positive usage threshold", async () => {
  await observerFixture({}, async ({ page }) => {
    const result = await page.evaluate(() => {
      settings.budget_usd = 10;
      window._state.usage = {
        totals: {
          reports: 2,
          cost_usd: null,
          coverage: { cost_usd: 2 },
          overflow: { cost_usd: true },
        },
      };
      syncBudget();
      return {
        hidden: document.querySelector("#budget-alert").hidden,
        message: document.querySelector("#budget-warning").textContent,
      };
    });
    assert.equal(result.hidden, false);
    assert.match(result.message, /Amount too large/);
    assert.match(result.message, /threshold/);
  });
});

test("unknown cost stays unknown and a disabled threshold stays off", async () => {
  await observerFixture({}, async ({ page }) => {
    const result = await page.evaluate(() => {
      settings.budget_usd = 10;
      window._state.usage = { totals: { reports: 1, cost_usd: null } };
      syncBudget();
      const unknownHidden = document.querySelector("#budget-alert").hidden;
      const unknown = usageValue(window._state.usage.totals, "cost_usd");
      settings.budget_usd = 0;
      window._state.usage.totals.overflow = { cost_usd: true };
      syncBudget();
      return {
        unknown,
        unknownHidden,
        disabledHidden: document.querySelector("#budget-alert").hidden,
        tiny: usageValue({ cost_usd: 0.0000001 }, "cost_usd"),
      };
    });
    assert.equal(result.unknown, "Not reported");
    assert.equal(result.unknownHidden, true);
    assert.equal(result.disabledHidden, true);
    assert.equal(result.tiny, "<$0.000001");
  });
});
