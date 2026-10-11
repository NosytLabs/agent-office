const { test } = require("node:test");
const assert = require("node:assert/strict");
const { observerFixture } = require("./observer-fixture.cjs");

test("inspector headings survive polling and elapsed-time updates", async () => {
  await observerFixture(
    {
      events: [
        {
          event: "session_start",
          platform: "claude",
          session_id: "stable-inspector",
        },
      ],
    },
    async ({ page }) => {
      await page.locator("#floorbtn").click();
      await page.locator('#roster [data-agent="stable-inspector"]').click();
      const stable = await page.evaluate(() => {
        const before = [...document.querySelectorAll("#inspectorbox h3")];
        fillInspector();
        const agent = agents.find((agent) => agent.id === focusedId);
        agent.duration_s += 3;
        agent.idle_s += 3;
        fillInspector();
        return before.length === 2 && before.every((node) => node.isConnected);
      });
      assert.equal(stable, true);
    },
  );
});
