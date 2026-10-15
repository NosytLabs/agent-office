/* Real observer attention navigation, typing boundaries and title freshness. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { observerFixture } = require("./observer-fixture.cjs");

const approval = "attention-approval",
  question = "attention-question";
const events = [
  {
    event: "session_start",
    session_id: approval,
    platform: "claude",
    title: "Synthetic approval name",
  },
  {
    event: "approval_request",
    session_id: approval,
    platform: "claude",
    request_id: "approval-1",
    command: "Review the synthetic change",
  },
  {
    event: "session_start",
    session_id: question,
    platform: "codex",
    title: "Synthetic question name",
  },
  {
    event: "input_request",
    session_id: question,
    platform: "codex",
    request_id: "question-1",
    question: "Choose the synthetic option",
  },
];
const accounting = (state) => ({
  progress: state.progress,
  usage: state.usage,
  events: state.events,
  received: state.tracking.received,
});
const selected = (page) => page.evaluate(() => focusedId);
const currentPanel = (page) => page.evaluate(() => opened);
async function refresh(page) {
  await page.evaluate(async () => {
    await poll();
    clearTimeout(pollTimer);
    pollTimer = null;
  });
}
async function settlePoll(page) {
  await page.evaluate(async () => {
    if (pollInFlight) await pollInFlight;
    clearTimeout(pollTimer);
    pollTimer = null;
  });
}

test("attention keyboard and existing needs-input button cycle real requests without work accounting writes", async () => {
  await observerFixture({ events }, async ({ page, state }) => {
    const before = accounting(await state());
    assert.equal(await page.title(), "(2 need input) Agent Office");
    await page.keyboard.press("p");
    assert.equal(await selected(page), approval);
    assert.equal(await currentPanel(page), "sheet-inspector");
    await page.keyboard.press("p");
    assert.equal(await selected(page), question);
    await page.keyboard.press("Shift+P");
    assert.equal(await selected(page), approval);
    await page.keyboard.press("Shift+P");
    assert.equal(await selected(page), question);
    await page.keyboard.press("p");
    assert.equal(await selected(page), approval);
    await page.keyboard.press("Escape");
    await page.locator("#waiting-count").click();
    assert.equal(await selected(page), question);
    await page.keyboard.press("Escape");
    await page.locator("#waiting-count").click();
    assert.equal(await selected(page), approval);
    await page.keyboard.press("Escape");
    await page.locator("#filterbtn").selectOption("codex");
    await page.locator("#c").focus();
    await page.keyboard.press("Shift+P");
    assert.equal(await selected(page), question);
    await page.keyboard.press("p");
    assert.equal(
      await selected(page),
      approval,
      "attention also reaches a waiting session hidden by the floor filter",
    );
    assert.deepEqual(accounting(await state()), before);
  });
});

test("attention shortcuts preserve input drafts, Customize, task textarea and native Quick navigation", async () => {
  await observerFixture({ events }, async ({ page, state }) => {
    const before = accounting(await state());
    await page.keyboard.press("p");
    await page.locator("#inspector-customize").click();
    const name = page.locator("#agent-name-input");
    await name.fill("Unsaved name");
    await page.keyboard.press("p");
    assert.equal(await name.inputValue(), "Unsaved namep");
    assert.equal(await selected(page), approval);
    await refresh(page);
    assert.equal(await name.inputValue(), "Unsaved namep");
    assert.equal(
      await name.evaluate((field) => document.activeElement === field),
      true,
    );
    await page.keyboard.press("Escape");
    await page.locator("#settingsbtn").click();
    await page.locator("#sheet-settings h2").focus();
    await page.keyboard.press("p");
    assert.equal(await currentPanel(page), "sheet-settings");
    assert.equal(await selected(page), approval);
    await page.locator("#room-name-input").focus();
    await page.keyboard.press("p");
    assert.equal(await currentPanel(page), "sheet-settings");
    assert.equal(await selected(page), approval);
    await page.keyboard.press("Escape");
    await page.locator("#tasksbtn").click();
    await page.locator('[data-task-view="draft"]').click();
    const draft = page.locator("#task-draft-text");
    await draft.fill("Synthetic task draft");
    await page.keyboard.press("p");
    assert.equal(await draft.inputValue(), "Synthetic task draftp");
    assert.equal(await currentPanel(page), "sheet-tasks");
    assert.equal(await selected(page), approval);
    await page.keyboard.press("Escape");
    await page.locator("#quick-nav-open").click();
    const quick = page.locator("dialog.quick-nav-dialog"),
      search = quick.locator("input");
    await page.keyboard.press("p");
    assert.equal(await search.inputValue(), "p");
    assert.equal(await quick.evaluate((dialog) => dialog.open), true);
    assert.equal(await selected(page), approval);
    await quick.locator(".quick-nav-close").focus();
    await page.keyboard.press("p");
    assert.equal(
      await quick.evaluate((dialog) => dialog.open),
      true,
      "a native dialog keeps the shortcut even outside its text input",
    );
    assert.equal(await selected(page), approval);
    await page.keyboard.press("Escape");
    assert.equal(await quick.evaluate((dialog) => dialog.open), false);
    assert.deepEqual(accounting(await state()), before);
  });
});

test("title contains only a live count and clears it on resolution or disconnection before reconnecting", async () => {
  await observerFixture({ events }, async ({ page, publish }) => {
    assert.equal(await page.title(), "(2 need input) Agent Office");
    await page.keyboard.press("p");
    publish([
      {
        event: "approval_response",
        session_id: approval,
        platform: "claude",
        request_id: "approval-1",
        choice: "allow",
      },
    ]);
    await refresh(page);
    assert.equal(await page.title(), "(1 needs input) Agent Office");
    await settlePoll(page);
    await page.route("**/state", (route) => route.abort());
    await refresh(page);
    assert.equal(await page.title(), "Disconnected · Agent Office");
    assert.equal(
      await page.evaluate(() =>
        agents.some((agent) => agent.status === "waiting"),
      ),
      true,
      "the retained snapshot still contains a waiting session",
    );
    const prior = await selected(page);
    await page.keyboard.press("p");
    assert.equal(
      await selected(page),
      prior,
      "retained requests cannot be presented as live attention navigation",
    );
    publish([
      {
        event: "approval_request",
        session_id: approval,
        platform: "claude",
        request_id: "approval-2",
        command: "Review another synthetic change",
      },
    ]);
    await page.unroute("**/state");
    await refresh(page);
    assert.equal(await page.title(), "(2 need input) Agent Office");
    publish([
      {
        event: "approval_response",
        session_id: approval,
        platform: "claude",
        request_id: "approval-2",
        choice: "allow",
      },
      {
        event: "input_response",
        session_id: question,
        platform: "codex",
        request_id: "question-1",
        choice: "answer",
      },
    ]);
    await refresh(page);
    assert.equal(await page.title(), "Agent Office");
    for (const text of [
      approval,
      question,
      "Synthetic approval name",
      "Synthetic question name",
      "Review the synthetic change",
      "Choose the synthetic option",
    ])
      assert.equal((await page.title()).includes(text), false);
  });
});

test("preview document marker keeps synthetic attention counts labeled as Demo", async () => {
  await observerFixture({ events }, async ({ page, base }) => {
    // The public preview build adds this exact body marker before office.js runs.
    // Keep a real synthetic observer behind it to exercise the shared frontend.
    await page.route(base + "/", async (route) => {
      const response = await route.fetch(),
        html = await response.text();
      assert.ok(html.includes("<body>"));
      await route.fulfill({
        response,
        body: html.replace("<body>", '<body data-agent-office-preview="1">'),
      });
    });
    await page.reload();
    await page.waitForFunction(() => initialized && settingsReady);
    assert.equal(await page.title(), "(2 need input) Agent Office · Demo");
    await page.keyboard.press("p");
    assert.equal(await selected(page), approval);
    assert.equal(await page.title(), "(2 need input) Agent Office · Demo");
  });
});
