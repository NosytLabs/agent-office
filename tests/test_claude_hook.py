from claude.hook import map_hook


def test_session_and_bash():
    ev = map_hook({"hook_event_name": "SessionStart", "session_id": "s1"})
    assert ev["event"] == "session_start"
    assert ev["platform"] == "claude"
    ev = map_hook({
        "hook_event_name": "PreToolUse",
        "session_id": "s1",
        "tool_name": "Bash",
        "tool_input": {"command": "pytest -q"},
    })
    assert ev["event"] == "tool_start"
    assert ev["activity"] == "running"
    assert "pytest" in ev["preview"]


def test_unknown_is_none():
    assert map_hook({"hook_event_name": "Notification"}) is None


def test_permission_and_fail():
    ev = map_hook({"hook_event_name": "PermissionRequest", "session_id": "s", "tool_name": "Bash"})
    assert ev["event"] == "approval_request"
    ev = map_hook({"hook_event_name": "PostToolUseFailure", "session_id": "s", "tool_name": "Edit"})
    assert ev["status"] == "error"


def test_subagent_tools_and_permissions_are_attributed_to_the_child():
    for name, expected in [("PreToolUse", "tool_start"), ("PostToolUse", "tool_end"), ("PermissionRequest", "approval_request")]:
        ev = map_hook({
            "hook_event_name": name, "session_id": "parent", "agent_id": "child",
            "tool_name": "Read", "tool_use_id": "call-1", "tool_input": {"file_path": "app.py"},
        })
        assert ev["event"] == expected
        assert ev["session_id"] == "child"
        assert ev["parent_session_id"] == "parent"
        assert ev["call_id"] == "call-1"


def test_subagent_start_uses_the_real_agent_type():
    ev = map_hook({"hook_event_name": "SubagentStart", "session_id": "parent", "agent_id": "child", "agent_type": "Explore"})
    assert ev["child_goal"] == "Explore"
    assert ev["child_session_id"] == "child"


def test_claude_turn_lifecycle_reports_thinking_and_idle():
    assert map_hook({"hook_event_name": "UserPromptSubmit", "session_id": "a"})["event"] == "session_busy"
    assert map_hook({"hook_event_name": "Stop", "session_id": "a"})["event"] == "session_idle"


def test_claude_failures_include_the_observed_error():
    for name, expected in [("PostToolUseFailure", "tool_end"), ("StopFailure", "session_error")]:
        ev = map_hook({"hook_event_name": name, "session_id": "a", "tool_name": "Bash", "error": "Exit code 1", "duration_ms": 123})
        assert ev["event"] == expected
        assert ev["error_message"] == "Exit code 1"
    assert map_hook({"hook_event_name": "PostToolUseFailure", "session_id": "a", "duration_ms": 123})["duration_ms"] == 123


def test_claude_permission_denial_dismisses_the_pending_approval():
    ev = map_hook({"hook_event_name": "PermissionDenied", "session_id": "a", "tool_name": "Bash"})
    assert ev["event"] == "approval_response"
    assert ev["choice"] == "deny"
