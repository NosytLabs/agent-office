/* Operational session actions must keep context and make export scope explicit. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { observerFixture } = require('./observer-fixture.cjs');
const events = [
  { event: 'session_start', session_id: 'review-a', platform: 'claude' },
  { event: 'approval_request', session_id: 'review-a', platform: 'claude', request_id: 'p1', command: 'npm test' },
  { event: 'session_start', session_id: 'review-b', platform: 'opencode' },
  { event: 'tool_start', session_id: 'review-b', platform: 'opencode', call_id: 't1', tool_name: 'read', preview: 'src/api.ts' },
];
async function saved(page) {
  await page.evaluate(() => { eventMode = 'history'; openSheet('sheet-events'); });
  await page.waitForFunction(() => historyLoaded && !historyLoading);
}
async function exported(page, id) {
  const pending = page.waitForEvent('download');
  await page.locator(id).click();
  const file = await pending;
  return JSON.parse(fs.readFileSync(await file.path(), 'utf8'));
}

test('switching the inspected session stays open and resets to its useful summary', async () => {
  await observerFixture({ events }, async ({ page }) => {
    await page.locator('#floorbtn').click();
    await page.locator('#roster [data-agent="review-a"]').click();
    await page.locator('#inspector-customize').click();
    await page.evaluate(() => selectAgent('review-b'));
    assert.equal(await page.locator('#sheet-inspector').isVisible(), true);
    assert.match(await page.locator('#inspector-summary').innerText(), /src\/api\.ts/);
    assert.equal(await page.locator('#sheet-inspector').evaluate(el => el.scrollTop), 0);
    await page.evaluate(() => selectAgent('review-b'));
    assert.equal(await page.locator('#sheet-inspector').isVisible(), true);
    await page.locator('#sheet-inspector .sheet-back').click();
    assert.equal(await page.locator('#sheet-floor').isVisible(), true);
  });
});

test('saved activity offers separate matching and all exports without changing XP', async () => {
  await observerFixture({ events }, async ({ page, state }) => {
    const xp = (await state()).progress.xp;
    await saved(page);
    assert.match(await page.locator('#export-history').innerText(), /all/i);
    assert.equal(await page.locator('#export-filtered-history').count(), 1);
    assert.equal(await page.locator('#export-filtered-history').isVisible(), false);
    await page.locator('#event-runtime').selectOption('opencode');
    await page.locator('#eventSearch').fill('src/api');
    const matching = await exported(page, '#export-filtered-history');
    assert.equal(matching.events.length, 1);
    assert.equal(matching.events[0].session_id, 'review-b');
    assert.equal(matching.filters.runtime, 'opencode');
    assert.equal(matching.filters.query, 'src/api');
    const all = await exported(page, '#export-history');
    assert.equal(all.events.length, events.length);
    assert.equal((await state()).progress.xp, xp);
  });
});

test('session exports capture scope when clicked, not a later filter during refresh', async () => {
  await observerFixture({ events }, async ({ page }) => {
    await page.locator('#floorbtn').click();
    await page.locator('#roster [data-agent="review-a"]').click();
    await page.locator('#inspect-history').click();
    await page.waitForFunction(() => historyLoaded && !historyLoading);
    assert.equal(await page.locator('#export-filtered-history').count(), 1);
    let release, arrived;
    const gate = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { arrived = resolve; });
    await page.route('**/history?*', async route => {
      const response = await route.fetch(); arrived(); await gate;
      await route.fulfill({ response });
    });
    try {
      const pending = exported(page, '#export-filtered-history');
      await started;
      await page.locator('#clear-session-filter').click();
      await page.locator('#eventSearch').fill('src/api');
      release();
      const data = await pending;
      assert.equal(data.events.length, 2);
      assert.ok(data.events.every(event => event.session_id === 'review-a'));
      assert.equal(data.filters.session.id, 'review-a');
    } finally { release(); }
  });
});

test('matching export includes saved matches beyond the first visible page', async () => {
  const many = Array.from({length: 105}, (_, index) => ({
    event: 'tool_start', session_id: 'review-b', platform: 'opencode',
    call_id: 'match-' + index, tool_name: 'read', preview: 'MATCH_FILE_' + index,
  }));
  await observerFixture({ events: [...events, ...many] }, async ({ page }) => {
    await saved(page);
    assert.equal(await page.locator('#export-filtered-history').count(), 1);
    await page.locator('#eventSearch').fill('MATCH_FILE_');
    assert.equal(await page.locator('#eventbox .event').count(), 100);
    const data = await exported(page, '#export-filtered-history');
    assert.equal(data.events.length, 105);
  });
});
