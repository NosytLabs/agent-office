"""Persistent lifecycle state must survive checkpoints without losing live work."""
import copy
import json

import pytest

from state_model import StateModel


def event(kind, ts=1000, session="a", **fields):
    return {"event": kind, "ts": ts, "session_id": session, **fields}


def restored(model):
    # Object-key sorting must not change which parallel call/prompt is latest.
    return StateModel(json.loads(json.dumps(model.dump(), sort_keys=True)))


def test_quiet_activity_exposes_the_last_observation_without_claiming_a_stuck_process():
    model = StateModel()
    model.apply([event("tool_start", call_id="long", tool_name="Read")], 1000)
    quiet = model.visible(1301)[0]
    assert quiet["status"] == "idle"
    assert quiet["quiet"] is True
    assert quiet["recorded_status"] == "working"
    assert quiet["last_tool"] == "Read"
    assert model.agents["a"]["status"] == "working"
    model.apply([event("tool_end", 1302, call_id="long", tool_name="Read")], 1302)
    assert not model.visible(1302)[0].get("quiet")


@pytest.mark.parametrize("ending", ["session_idle", "session_end", "subagent_stop"])
@pytest.mark.parametrize("inbox", [False, True])
def test_terminal_duration_freezes_across_polls_metadata_and_checkpoint(ending, inbox):
    model = StateModel()
    start = 5000 if inbox else 1000
    model.apply([event("subagent_start", child_session_id="a", parent_session_id="parent")],
                start, received_at=start if inbox else None)
    model.apply([event(ending, 1010, child_session_id="a")],
                start + 10, received_at=start + 10 if inbox else None)
    assert model.visible(start + 10)[0]["duration_s"] == 10
    assert model.visible(start + 15)[0]["duration_s"] == 10
    model = restored(model)
    model.apply([
        event("session_update", 1012, title="Completed task"),
        event(ending, 1013, child_session_id="a"),
        event("tool_end", 1014, call_id="late", tool_name="Read"),
    ], start + 14, received_at=start + 14 if inbox else None)
    view = model.visible(start + 15)[0]
    assert view["duration_s"] == 10
    assert view["idle_s"] == 5


def test_incremental_checkpoints_match_a_complete_arrival_order_fold():
    records = [
        event("session_start", title="Main", platform="opencode"),
        event("tool_start", 1001, call_id="z-read", tool_name="Read", activity="reading", preview="old.py"),
        event("tool_start", 1002, call_id="a-write", tool_name="Write", activity="typing", preview="new.py"),
        event("approval_request", 1003, request_id="z-approval", call_id="a-write", command="Write files?"),
        event("input_request", 1004, request_id="a-question", call_id="a-write", question="Which branch?"),
        event("tool_end", 1002, call_id="z-read", tool_name="Read"),
        event("input_response", 1005, request_id="a-question"),
        event("session_start", 1006, "closed", title="Closed"),
        event("session_end", 1007, "closed"),
        event("tool_end", 1008, "closed", tool_name="Read"),
        event("subagent_start", 1009, child_session_id="child", parent_session_id="a", child_goal="Check tests"),
        event("tool_start", 1010, "child", call_id="c", tool_name="Bash", activity="running"),
        event("approval_response", 1011, request_id="z-approval", choice="once"),
        event("tool_end", 1012, call_id="a-write", tool_name="Write"),
    ]
    complete = StateModel()
    complete.apply(records, 1013)
    expected = complete.visible(1013)
    assert [(a["id"], a["status"]) for a in expected] == [
        ("a", "thinking"), ("closed", "gone"), ("child", "working")
    ]
    for split in range(len(records) + 1):
        model = StateModel()
        model.apply(records[:split], 1013)
        model = restored(model)
        model.visible(1400)  # Rendering a quiet frame cannot change the checkpoint.
        model.apply(records[split:], 1013)
        assert model.visible(1013) == expected
        assert model.dump() == complete.dump()


def test_parallel_tool_order_survives_sorted_json_and_completion():
    model = StateModel()
    model.apply([
        event("tool_start", call_id="z-first", tool_name="Read", activity="reading"),
        event("tool_start", 1001, call_id="a-second", tool_name="Write", activity="typing"),
    ], 1001)
    model = restored(model)
    model.apply([event("session_update", 1002, title="Working")], 1002)
    assert model.visible(1002)[0]["tool"] == "Write"
    model.apply([event("tool_end", 1003, call_id="a-second", tool_name="Write")], 1003)
    agent = model.visible(1003)[0]
    assert (agent["status"], agent["tool"], agent["activity"]) == ("working", "Read", "reading")


@pytest.mark.parametrize("kind,field,response", [
    ("approval_request", "command", "approval_response"),
    ("input_request", "question", "input_response"),
])
def test_unanswered_requests_survive_age_expiration_and_restore(kind, field, response):
    model = StateModel()
    full_prompt = "A long unfinished request " * 200
    request = event(kind, request_id="pending", **{field: full_prompt})
    model.apply([request], 1000)
    model.expire(10000)
    assert model.visible(10000)[0]["status"] == "waiting"
    model = restored(model)
    assert model.pending_input["a"][(kind, "pending")][field] == full_prompt
    model.expire(10000)
    assert model.visible(10000)[0]["idle_s"] == 9000
    model.apply([event(response, 10001, request_id="pending", choice="once")], 10001)
    assert model.visible(10001)[0]["status"] != "waiting"
    model.expire(11802)
    assert model.visible(11802) == []


def test_pending_request_order_and_parallel_calls_survive_multiple_checkpoints():
    model = StateModel()
    model.apply([
        event("tool_start", call_id="run", tool_name="Bash", activity="running"),
        event("approval_request", 1001, request_id="z-first", call_id="run", command="First request"),
        event("approval_request", 1002, request_id="a-second", call_id="run", command="Second request"),
    ], 1002)
    model = restored(model)
    model.apply([event("session_busy", 1003)], 1003)
    assert model.visible(1003)[0]["detail"] == "Second request"
    model.apply([event("approval_response", 1004, request_id="a-second", choice="once")], 1004)
    model = restored(model)
    assert model.visible(1004)[0]["detail"] == "First request"
    model.apply([event("approval_response", 1005, request_id="z-first", choice="once")], 1005)
    agent = model.visible(1005)[0]
    assert (agent["status"], agent["tool"]) == ("working", "Bash")


@pytest.mark.parametrize("ending,status,hidden_at", [
    ("session_idle", "done", 1122),
    ("session_end", "gone", 1022),
    ("subagent_stop", "done", 1122),
])
def test_recent_inactive_tombstones_block_delayed_responses_and_completions(ending, status, hidden_at):
    model = StateModel()
    model.apply([
        event("subagent_start", child_session_id="a", child_goal="Review"),
        event("approval_request", request_id="old", command="Run?"),
        event(ending, 1001, child_session_id="a"),
    ], 1001)
    assert model.visible(1001)[0]["status"] == status
    if hidden_at:
        assert model.visible(hidden_at) == []
    model.expire(1123)
    model = restored(model)
    model.apply([
        event("tool_end", 1124, call_id="old", tool_name="Bash"),
        event("approval_response", 1125, request_id="old", choice="once"),
        event("input_response", 1126, request_id="old"),
    ], 1126)
    assert model.agents["a"]["status"] == status
    assert model.agents["a"]["updated_at"] == 1001
    assert "a" in model.inactive_sessions
    model.expire(2801)
    assert "a" in model.inactive_sessions  # Exactly 30 minutes is retained.
    model.expire(2802)
    assert model.dump()["agents"] == []
    assert not model.inactive_sessions
    assert not model.active_tools
    assert not model.pending_input


def test_session_end_without_a_known_start_still_retains_a_closed_marker():
    model = StateModel()
    model.apply([event("session_end")], 1000)
    model.expire(1030)
    model = restored(model)
    model.apply([event("tool_end", 1031, tool_name="Read")], 1031)
    assert model.visible(1031) == []
    assert "a" in model.inactive_sessions


@pytest.mark.parametrize("ending", ["session_idle", "session_error", "session_end"])
def test_explicit_session_closure_clears_even_very_old_pending_prompts(ending):
    model = StateModel()
    model.apply([event("approval_request", request_id="old", command="Still pending")], 1000)
    model.expire(10000)
    model.apply([event(ending, 10001, error_message="Stopped")], 10001)
    assert not model.pending_input
    assert model.visible(10001)[0]["status"] != "waiting"


def test_soft_idle_display_does_not_change_durable_work_or_future_metadata_updates():
    model = StateModel()
    model.apply([event("tool_start", call_id="read", tool_name="Read", activity="reading", preview="app.py")], 1000)
    durable = model.dump()
    view = model.visible(1301)
    assert (view[0]["status"], view[0]["tool"], view[0]["detail"]) == ("idle", "", "")
    assert (view[0]["duration_s"], view[0]["idle_s"]) == (301, 301)
    assert model.dump() == durable
    model.apply([event("session_update", 1302, title="Still reading")], 1302)
    assert (model.visible(1302)[0]["status"], model.visible(1302)[0]["tool"]) == ("working", "Read")


def test_late_old_timestamps_do_not_make_recent_activity_stale():
    model = StateModel()
    model.apply([
        event("session_start"),
        event("tool_start", 2000, call_id="new", tool_name="Read"),
        event("session_update", 1001, title="Late metadata"),
    ], 3001)
    model.expire(3001)
    agent = model.visible(3001)[0]
    assert (agent["updated_at"], agent["idle_s"], agent["label"]) == (2000, 1001, "Late metadata")
    model.apply([event("session_end", 1002)], 3001)
    assert model.agents["a"]["updated_at"] == 2000
    assert model.inactive_sessions["a"] == 2000


def test_inputs_snapshots_and_display_results_are_independent():
    records = [event("input_request", request_id="q", question="Keep me", extra={"nested": [1]})]
    original = copy.deepcopy(records)
    model = StateModel()
    model.apply(records, 1000)
    assert records == original
    snapshot = model.dump()
    second = StateModel(snapshot)
    records[0]["extra"]["nested"].append(2)
    snapshot["agents"][0]["detail"] = "changed"
    snapshot["pending_input"]["a"][0][1]["extra"]["nested"].append(3)
    view = second.visible(1001)
    view[0]["detail"] = "changed display"
    assert second.visible(1001)[0]["detail"] == "Keep me"
    assert second.pending_input["a"][("input_request", "q")]["extra"] == {"nested": [1]}
    assert model.dump() == second.dump()


def test_expiration_removes_stale_ordinary_maps_without_removing_waits():
    model = StateModel()
    model.apply([
        event("tool_start", 1000, "quiet", call_id="old", tool_name="Read"),
        event("input_request", 1000, "waiting", request_id="q", question="Waiting"),
    ], 1000)
    model.expire(3000)
    assert [a["id"] for a in model.visible(3000)] == ["waiting"]
    assert "quiet" not in model.active_tools
    assert "quiet" not in model.agents


def test_malformed_records_do_not_poison_the_serializable_checkpoint():
    model = StateModel()
    model.apply([None, [], {}, event([], 1000), event("tool_start", float("nan")),
                 event("tool_start", "invalid"), event("session_start", 1000, "valid")], 1000)
    assert [a["id"] for a in model.visible(1001)] == ["valid"]
    json.dumps(model.dump(), allow_nan=False)
