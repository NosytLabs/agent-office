"""Current activity must follow observed lifecycle events, not an old tool."""
import json

import pytest
import __init__ as plugin


@pytest.fixture
def folded(tmp_path, monkeypatch):
    monkeypatch.setattr(plugin, "_office_dir", lambda: tmp_path)
    monkeypatch.setattr(plugin.time, "time", lambda: 1000.0)

    def fold(*events):
        records = [{"ts": 990.0 + i / 10, "session_id": "a", **ev} for i, ev in enumerate(events)]
        (tmp_path / "events.jsonl").write_text("\n".join(json.dumps(ev) for ev in records))
        return {a["id"]: a for a in plugin.build_state()["agents"]}

    return fold


def test_completed_tool_clears_activity_animation(folded):
    agent = folded(
        {"event": "tool_start", "tool_name": "write_file", "activity": "typing", "preview": "app.js"},
        {"event": "tool_end", "tool_name": "write_file", "status": "ok"},
    )["a"]
    assert agent["status"] == "thinking"
    assert (agent["tool"], agent["activity"], agent["detail"]) == ("", "", "")


@pytest.mark.parametrize("ending,status", [("session_idle", "idle"), ("session_end", "gone")])
def test_session_lifecycle_clears_old_tool(folded, ending, status):
    agent = folded(
        {"event": "tool_start", "tool_name": "terminal", "activity": "running", "preview": "npm test"},
        {"event": ending},
    )["a"]
    assert agent["status"] == status
    assert (agent["tool"], agent["activity"], agent["detail"]) == ("", "", "")


def test_subagent_completion_clears_old_tool(folded):
    agent = folded(
        {"event": "subagent_start", "child_session_id": "child", "parent_session_id": "a", "child_goal": "Review"},
        {"event": "tool_start", "session_id": "child", "tool_name": "read_file", "activity": "reading"},
        {"event": "subagent_stop", "child_session_id": "child"},
    )["child"]
    assert agent["status"] == "done"
    assert (agent["tool"], agent["activity"], agent["detail"]) == ("", "", "")


def test_session_update_keeps_running_tool_and_sets_real_title(folded):
    agent = folded(
        {"event": "tool_start", "tool_name": "read", "activity": "reading", "platform": "opencode"},
        {"event": "session_update", "title": "Review the API", "platform": "opencode"},
    )["a"]
    assert agent["label"] == "Review the API"
    assert (agent["status"], agent["tool"], agent["activity"]) == ("working", "read", "reading")


def test_session_update_retains_subagent_relationship(folded):
    agent = folded(
        {"event": "session_start", "platform": "opencode", "title": "Search docs", "parent_session_id": "parent"},
        {"event": "session_update", "title": "Search the code", "parent_session_id": "parent"},
    )["a"]
    assert agent["kind"] == "subagent"
    assert agent["parent"] == "parent"
    assert agent["label"] == "Search the code"


@pytest.mark.parametrize("choice", ["deny", "timeout", "reject", "denied"])
def test_denied_approval_never_reports_tool_still_running(folded, choice):
    agent = folded(
        {"event": "tool_start", "tool_name": "bash", "activity": "running"},
        {"event": "approval_request", "command": "npm publish"},
        {"event": "approval_response", "choice": choice},
    )["a"]
    assert agent["status"] == "thinking"
    assert (agent["tool"], agent["activity"]) == ("", "")
    assert agent["detail"] == f"approval: {choice}"


def test_approval_waiting_stops_tool_animation(folded):
    agent = folded(
        {"event": "tool_start", "tool_name": "bash", "activity": "running"},
        {"event": "approval_request", "command": "npm publish"},
    )["a"]
    assert agent["status"] == "waiting"
    assert (agent["tool"], agent["activity"]) == ("", "")
    assert agent["detail"] == "npm publish"


def test_no_event_timeout_clears_stale_tool_details(folded):
    agent = folded({"event": "tool_start", "ts": 600.0, "tool_name": "write_file", "activity": "typing", "preview": "old.py"})["a"]
    assert agent["status"] == "idle"
    assert (agent["tool"], agent["activity"], agent["detail"]) == ("", "", "")


def test_parallel_tool_completion_keeps_the_other_call_working(folded):
    agent = folded(
        {"event": "tool_start", "call_id": "read", "tool_name": "read_file", "activity": "reading", "preview": "read.py"},
        {"event": "tool_start", "call_id": "write", "tool_name": "write_file", "activity": "typing", "preview": "write.py"},
        {"event": "tool_end", "call_id": "read", "tool_name": "read_file", "status": "ok"},
    )["a"]
    assert (agent["status"], agent["tool"], agent["activity"], agent["detail"]) == ("working", "write_file", "typing", "write.py")


def test_latest_completed_call_returns_to_an_older_active_tool(folded):
    agent = folded(
        {"event": "tool_start", "call_id": "read", "tool_name": "read_file", "activity": "reading"},
        {"event": "tool_start", "call_id": "write", "tool_name": "write_file", "activity": "typing"},
        {"event": "tool_end", "call_id": "write", "tool_name": "write_file", "status": "ok"},
    )["a"]
    assert (agent["status"], agent["tool"], agent["activity"]) == ("working", "read_file", "reading")


def test_unrelated_tool_end_does_not_dismiss_pending_approval(folded):
    agent = folded(
        {"event": "tool_start", "call_id": "read", "tool_name": "read_file", "activity": "reading"},
        {"event": "tool_start", "call_id": "run", "tool_name": "terminal", "activity": "running"},
        {"event": "approval_request", "call_id": "run", "request_id": "approval-1", "command": "npm publish"},
        {"event": "tool_end", "call_id": "read", "tool_name": "read_file"},
    )["a"]
    assert agent["status"] == "waiting"
    assert agent["detail"] == "npm publish"
    assert agent["activity"] == ""


def test_resolving_one_approval_retains_the_other_pending_request(folded):
    agent = folded(
        {"event": "approval_request", "request_id": "one", "command": "first request"},
        {"event": "approval_request", "request_id": "two", "command": "second request"},
        {"event": "approval_response", "request_id": "two", "choice": "once"},
    )["a"]
    assert agent["status"] == "waiting"
    assert agent["detail"] == "first request"


def test_question_waits_for_an_answer_then_returns_to_thinking(folded):
    agent = folded({"event": "input_request", "request_id": "q1", "question": "Which branch?"})["a"]
    assert agent["status"] == "waiting"
    assert agent["detail"] == "Which branch?"
    agent = folded(
        {"event": "input_request", "request_id": "q1", "question": "Which branch?"},
        {"event": "input_response", "request_id": "q1"},
    )["a"]
    assert (agent["status"], agent["tool"], agent["activity"]) == ("thinking", "", "")


def test_session_busy_does_not_clear_known_tool_or_pending_input(folded):
    agent = folded(
        {"event": "input_request", "question": "Continue?"},
        {"event": "session_busy"},
    )["a"]
    assert (agent["status"], agent["detail"]) == ("waiting", "Continue?")


def test_model_error_survives_the_following_idle_event(folded):
    agent = folded(
        {"event": "session_error", "error_message": "Provider unreachable"},
        {"event": "session_idle"},
    )["a"]
    assert agent["status"] == "idle"
    assert "Provider unreachable" in agent["detail"]


def test_tool_completion_dismisses_its_permission_request(folded):
    agent = folded(
        {"event": "tool_start", "call_id": "run", "tool_name": "Bash", "activity": "running"},
        {"event": "approval_request", "call_id": "run", "command": "npm test"},
        {"event": "tool_end", "call_id": "run", "tool_name": "Bash"},
    )["a"]
    assert (agent["status"], agent["activity"], agent["detail"]) == ("thinking", "", "")


def test_legacy_permission_request_is_cleared_by_matching_named_tool(folded):
    agent = folded(
        {"event": "tool_start", "call_id": "run", "tool_name": "Bash", "activity": "running"},
        {"event": "approval_request", "tool_name": "Bash", "command": "npm test"},
        {"event": "tool_end", "call_id": "run", "tool_name": "Bash"},
    )["a"]
    assert (agent["status"], agent["activity"], agent["detail"]) == ("thinking", "", "")


def test_hermes_hook_call_ids_are_preserved(monkeypatch):
    events = []
    monkeypatch.setattr(plugin, "_publish", events.append)
    plugin._pre_tool_call(session_id="a", tool_call_id="call-1", tool_name="terminal", args={"command": "pytest"})
    plugin._pre_approval_request(session_id="a", tool_call_id="call-1", command="pytest")
    plugin._post_approval_response(session_id="a", tool_call_id="call-1", choice="once")
    plugin._post_tool_call(session_id="a", tool_call_id="call-1", tool_name="terminal")
    assert [ev.get("call_id") for ev in events] == ["call-1"] * 4


def test_legacy_hermes_approval_fallback_does_not_cross_concurrent_contexts(monkeypatch):
    import contextvars

    events = []
    monkeypatch.setattr(plugin, "_publish", events.append)
    a = contextvars.Context()
    b = contextvars.Context()
    a.run(plugin._pre_tool_call, session_id="a", tool_call_id="call-a", tool_name="terminal")
    b.run(plugin._pre_tool_call, session_id="b", tool_call_id="call-b", tool_name="terminal")
    a.run(plugin._pre_approval_request, command="command a")
    b.run(plugin._pre_approval_request, command="command b")
    assert [ev["session_id"] for ev in events[-2:]] == ["a", "b"]
    assert [ev.get("call_id") for ev in events[-2:]] == ["call-a", "call-b"]


def test_claude_permission_denial_handles_requests_without_a_call_id(folded):
    from claude.hook import map_hook

    agent = folded(
        map_hook({"hook_event_name": "PreToolUse", "session_id": "a", "tool_use_id": "c1", "tool_name": "Bash"}),
        map_hook({"hook_event_name": "PermissionRequest", "session_id": "a", "tool_name": "Bash"}),
        map_hook({"hook_event_name": "PermissionDenied", "session_id": "a", "tool_use_id": "c1", "tool_name": "Bash"}),
    )["a"]
    assert (agent["status"], agent["tool"], agent["activity"]) == ("thinking", "", "")


def test_rejected_question_clears_its_blocked_tool(folded):
    agent = folded(
        {"event": "tool_start", "call_id": "q-call", "tool_name": "question", "activity": "working"},
        {"event": "input_request", "request_id": "q1", "call_id": "q-call", "question": "Which branch?"},
        {"event": "input_response", "request_id": "q1", "choice": "reject"},
    )["a"]
    assert (agent["status"], agent["tool"], agent["activity"]) == ("thinking", "", "")


@pytest.mark.parametrize("ending,status", [("session_idle", "done"), ("session_end", "gone"), ("subagent_stop", "done")])
def test_delayed_tool_completion_cannot_resurrect_an_inactive_agent(folded, ending, status):
    agent = folded(
        {"event": "subagent_start", "child_session_id": "a", "child_goal": "Review"},
        {"event": "tool_start", "call_id": "old", "tool_name": "Read", "activity": "reading"},
        {"event": ending, "child_session_id": "a"},
        {"event": "tool_end", "call_id": "old", "tool_name": "Read"},
    )["a"]
    assert (agent["status"], agent["tool"], agent["activity"]) == (status, "", "")


@pytest.mark.parametrize("response", ["approval_response", "input_response"])
def test_delayed_human_response_does_not_resurrect_closed_session(folded, response):
    agent = folded(
        {"event": "approval_request", "request_id": "old", "command": "Publish?"},
        {"event": "session_end"},
        {"event": response, "request_id": "old", "choice": "once"},
    )["a"]
    assert agent["status"] == "gone"


def test_new_prompt_reactivates_a_finished_session(folded):
    agent = folded(
        {"event": "session_busy"}, {"event": "session_idle"},
        {"event": "session_busy"},
        {"event": "tool_start", "call_id": "new", "tool_name": "Read", "activity": "reading"},
        {"event": "tool_end", "call_id": "new", "tool_name": "Read"},
    )["a"]
    assert agent["status"] == "thinking"


def test_hermes_old_parallel_completion_keeps_the_current_approval_context(monkeypatch):
    import contextvars

    events = []
    monkeypatch.setattr(plugin, "_publish", events.append)
    context = contextvars.Context()
    context.run(plugin._pre_tool_call, session_id="a", tool_call_id="older", tool_name="Read")
    context.run(plugin._pre_tool_call, session_id="a", tool_call_id="current", tool_name="Bash")
    context.run(plugin._post_tool_call, session_id="a", tool_call_id="older", tool_name="Read")
    context.run(plugin._pre_approval_request, command="Current command")
    assert (events[-1]["session_id"], events[-1]["call_id"]) == ("a", "current")


def test_hermes_explicit_session_never_inherits_another_sessions_call_id(monkeypatch):
    import contextvars

    events = []
    monkeypatch.setattr(plugin, "_publish", events.append)
    context = contextvars.Context()
    context.run(plugin._pre_tool_call, session_id="a", tool_call_id="call-a", tool_name="Bash")
    context.run(plugin._pre_approval_request, session_id="b", command="Other session")
    assert (events[-1]["session_id"], events[-1]["call_id"]) == ("b", "")


def test_claude_question_completion_dismisses_the_input_prompt(folded):
    from claude.hook import map_hook

    common = {"session_id": "a", "tool_use_id": "q1", "tool_name": "AskUserQuestion"}
    agent = folded(
        map_hook({**common, "hook_event_name": "PreToolUse", "tool_input": {"questions": [{"question": "Which branch?"}]}}),
    )["a"]
    assert (agent["status"], agent["detail"]) == ("waiting", "Which branch?")
    agent = folded(
        map_hook({**common, "hook_event_name": "PreToolUse", "tool_input": {"questions": [{"question": "Which branch?"}]}}),
        map_hook({**common, "hook_event_name": "PostToolUse"}),
    )["a"]
    assert (agent["status"], agent["detail"]) == ("thinking", "")


def test_denied_question_tool_dismisses_its_unanswered_question(folded):
    from claude.hook import map_hook

    common = {"session_id": "a", "tool_name": "AskUserQuestion"}
    agent = folded(
        map_hook({**common, "hook_event_name": "PreToolUse", "tool_use_id": "q1", "tool_input": {"questions": [{"question": "Which branch?"}]}}),
        map_hook({**common, "hook_event_name": "PermissionRequest"}),
        map_hook({**common, "hook_event_name": "PermissionDenied", "tool_use_id": "q1"}),
    )["a"]
    assert (agent["status"], agent["tool"], agent["activity"]) == ("thinking", "", "")


def test_claude_question_denial_without_permission_call_ids_dismisses_prompt(folded):
    from claude.hook import map_hook

    common = {"session_id": "a", "tool_name": "AskUserQuestion"}
    agent = folded(
        map_hook({**common, "hook_event_name": "PreToolUse", "tool_use_id": "q1", "tool_input": {"questions": [{"question": "Which branch?"}]}}),
        map_hook({**common, "hook_event_name": "PermissionRequest"}),
        map_hook({**common, "hook_event_name": "PermissionDenied"}),
    )["a"]
    assert (agent["status"], agent["tool"], agent["activity"]) == ("thinking", "", "")
    assert agent["detail"] == "approval: deny"


def test_legacy_question_denial_keeps_an_independent_input_request(folded):
    agent = folded(
        {"event": "input_request", "call_id": "q1", "tool_name": "AskUserQuestion", "question": "Which branch?"},
        {"event": "input_request", "request_id": "other", "tool_name": "question", "question": "Which project?"},
        {"event": "approval_request", "tool_name": "AskUserQuestion", "command": "AskUserQuestion"},
        {"event": "approval_response", "tool_name": "AskUserQuestion", "choice": "deny"},
    )["a"]
    assert (agent["status"], agent["detail"]) == ("waiting", "Which project?")
