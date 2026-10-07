"""History optimizations must preserve live sessions and count appended events."""
import json

import pytest

import __init__ as plugin


@pytest.mark.parametrize("observed_before_burst", [False, True])
def test_quiet_pending_approval_survives_another_agents_large_burst(
    tmp_path, monkeypatch, observed_before_burst,
):
    monkeypatch.setattr(plugin, "_office_dir", lambda: tmp_path)
    monkeypatch.setattr(plugin.time, "time", lambda: 1000.0)
    path = tmp_path / "events.jsonl"
    waiting = {
        "ts": 990, "event": "approval_request", "session_id": "waiting",
        "request_id": "approval-1", "command": "Approve deployment?",
    }
    path.write_text(json.dumps(waiting) + "\n")
    if observed_before_burst:
        assert plugin.build_state()["agents"][0]["status"] == "waiting"
    with path.open("a") as handle:
        for i in range(7000):
            handle.write(json.dumps({
                "ts": 991 + i / 10000, "event": "tool_start", "session_id": "busy",
                "call_id": str(i), "tool_name": "Read",
            }) + "\n")
    assert path.stat().st_size > 524_288
    agents = {agent["id"]: agent for agent in plugin.build_state()["agents"]}
    assert "waiting" in agents
    assert agents["waiting"]["status"] == "waiting"
    assert agents["waiting"]["detail"] == "Approve deployment?"
    assert agents["busy"]["status"] == "working"


def test_identical_timestamp_events_append_once_beyond_a_large_history(tmp_path, monkeypatch):
    monkeypatch.setattr(plugin, "_office_dir", lambda: tmp_path)
    monkeypatch.setattr(plugin.time, "time", lambda: 1000.0)
    path = tmp_path / "events.jsonl"
    line = json.dumps({
        "ts": 990, "event": "tool_start", "session_id": "busy", "tool_name": "Read",
    }) + "\n"
    path.write_text(line * 7000)
    assert path.stat().st_size > 524_288
    first = plugin.build_state()
    with path.open("a") as handle:
        handle.write(line)
    second = plugin.build_state()
    assert second["progress"]["stats"]["tools"] == first["progress"]["stats"]["tools"] + 1
    assert second["progress"]["stats"]["tools"] == 7001
    assert plugin.build_state()["progress"]["xp"] == second["progress"]["xp"]
