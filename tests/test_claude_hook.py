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
