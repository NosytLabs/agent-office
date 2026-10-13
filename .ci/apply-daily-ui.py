"""Apply the immutable reviewed patch, then refine its measured mobile spacing."""
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
css = css.replace(marker,
    '  .inspector-summary { padding: 8px 12px; margin-bottom: 12px; }\n'
    '  .inspector-actions { margin-block: 8px; }\n' + marker, 1)
path.write_text(css)
