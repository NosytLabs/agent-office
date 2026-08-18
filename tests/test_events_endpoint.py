from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import __init__ as plugin  # noqa: E402


def test_events_exposed_in_state(tmp_path, monkeypatch):
    monkeypatch.setattr(plugin, "_office_dir", lambda: tmp_path)
    ev = tmp_path / "events.jsonl"
    ev.write_text(
        '{"ts":1.0,"event":"session_start","session_id":"a","platform":"hermes"}\n'
        '{"ts":1.1,"event":"tool_start","session_id":"a","tool_name":"web_search"}\n'
    )
    state = plugin.build_state()
    assert "events" in state
    assert len(state["events"]) == 2
    assert state["events"][1]["tool_name"] == "web_search"
