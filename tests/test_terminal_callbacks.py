"""A delayed error is evidence, not a new running session."""
import pytest

from event_inbox import publish
from event_store import EventStore
from state_model import StateModel


def event(kind, ts, **extra):
    return {"event": kind, "ts": ts, "session_id": "worker", "platform": "opencode", **extra}


@pytest.mark.parametrize("terminal,kind,expected,timeout", [
    ("session_end", "main", "gone", 20),
    ("session_idle", "subagent", "done", 120),
])
def test_late_errors_keep_terminal_status_duration_and_exit(terminal, kind, expected, timeout):
    model = StateModel()
    extra = {"parent_session_id": "parent"} if kind == "subagent" else {}
    model.apply([event("session_start", 100, **extra)], now=100, received_at=100)
    model.apply([event(terminal, 110)], now=110, received_at=110)
    model = StateModel(model.dump())  # restart boundary
    model.apply([event("session_error", 112, error_message="late transport close")], now=112, received_at=112)
    agent = model.visible(112)[0]
    assert agent["status"] == expected
    assert agent["duration_s"] == 10
    assert agent["observed_at"] == 110
    assert not model.visible(111 + timeout)


def test_live_session_errors_still_surface_and_clear_pending_tools():
    model = StateModel()
    model.apply([event("session_start", 100), event("tool_start", 101, call_id="call", tool_name="bash")], now=101)
    model.apply([event("session_error", 102, error_message="connection lost")], now=102)
    agent = model.visible(102)[0]
    assert agent["status"] == "idle"
    assert "connection lost" in agent["detail"]
    assert not model.active_tools


def test_late_error_stays_in_history_without_reopening_a_finished_child(tmp_path):
    store = EventStore(tmp_path)
    publish(tmp_path, event("session_start", 100, parent_session_id="parent"))
    store.consume(lambda: [], 100)
    publish(tmp_path, event("session_idle", 110))
    store.consume(lambda: [], 110)
    publish(tmp_path, event("session_error", 500, error_message="late callback"))
    state = EventStore(tmp_path).consume(lambda: [], 500)
    assert state["agents"] == []
    assert store.history()[0]["event"] == "session_error"
    assert store.history()[0]["error_message"] == "late callback"
    assert state["progress"]["stats"]["sessions"] == 1
