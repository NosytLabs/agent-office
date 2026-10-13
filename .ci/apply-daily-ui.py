"""Apply reviewed UI changes and remove timing assumptions from two arcade tests."""
from pathlib import Path
import subprocess

source = subprocess.check_output(
    ['git', 'show', 'e695ffd25c288d58c3c990c4b79ae1ea6de346cd:.ci/apply-daily-ui.py'],
    text=True,
)
exec(compile(source, '<pinned-reviewed-daily-ui-patch>', 'exec'))
path = Path('web/css/style.css')
css = path.read_text()
marker = '  #trackSearch, #roster-runtime { font-size: 16px; }'
assert css.count(marker) == 1
path.write_text(css.replace(marker,
    '  .inspector-summary { padding: 8px 12px; margin-bottom: 12px; }\n'
    '  .inspector-actions { margin-block: 8px; }\n' + marker, 1))

path = Path('tests/arcade-gameplay.test.cjs')
text = path.read_text()
old = '''    await playfield.press("Enter");
    await page.waitForTimeout(120);
    assert.equal('''
new = '''    await playfield.press("Enter");
    // Observe the upstream round render, not an assumed 120 ms frame budget.
    await child.waitForFunction(() => window.roundWasDrawn === true);
    assert.equal('''
assert text.count(old) == 1
text = text.replace(old, new, 1)
old = '''    await openGame(page, "snake");
    await page.clock.install();
    await page.clock.pauseAt(new Date());'''
new = '''    // Install before reloading so all page timers use the same clock.
    // Independent host/browser wall clocks can make pauseAt(new Date()) go backwards.
    await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
    await page.reload();
    await page.waitForFunction(() => initialized && settingsReady && officeScene.sprites.petbed);
    await openGame(page, "snake");
    await page.clock.pauseAt(new Date("2026-01-01T01:00:00Z"));'''
assert text.count(old) == 1
path.write_text(text.replace(old, new, 1))
