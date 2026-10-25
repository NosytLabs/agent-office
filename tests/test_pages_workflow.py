"""Prevent optional, unconfigured GitHub Pages publishing from burning Actions minutes."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def test_optional_pages_workflow_is_manual_only():
    workflow = (ROOT / '.github/workflows/pages.yml').read_text(encoding='utf-8')
    # Vercel owns the production site. Pages is optional and disabled in the
    # repository; CI already tests both public builds on push/PR.
    assert re.search(r'(?m)^on:\s*\n  workflow_dispatch:', workflow)
    assert not re.search(r'(?m)^  (?:push|pull_request|schedule):', workflow)
    assert "steps.pages-status.outputs.enabled == 'true'" in workflow
