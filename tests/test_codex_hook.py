"""Codex observer payloads never return hook decisions or prompt context."""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from codex.hook import map_hook


@pytest.mark.parametrize("name,expected", [
    ("SessionStart", "session_start"), ("UserPromptSubmit", "session_busy"),
    ("Stop", "session_idle"), ("Interrupt", "session_idle"),
    ("SessionEnd", "session_end"),
])
def test_codex_lifecycle_preserves_identity_and_model_without_prompt(name, expected):
    event = map_hook({"hook_event_name": name, "session_id": "thread", "turn_id": "turn",
                      "model": "codex-model", "prompt": "private input"})
    assert event["event"] == expected
    assert event["session_id"] == "thread"
    assert event["platform"] == "codex"
    assert event["model"] == "codex-model"
    assert event["turn_id"] == "turn"
    assert "prompt" not in event


def test_codex_compaction_start_does_not_clear_active_tools():
    event = map_hook({"hook_event_name": "SessionStart", "session_id": "thread", "source": "compact"})
    assert event["event"] == "session_update"


def test_codex_tool_and_permission_use_only_available_source_identity():
    fields = {"session_id": "parent", "turn_id": "turn", "tool_name": "Bash",
              "tool_input": {"command": "pytest -q"}}
    start = map_hook({**fields, "hook_event_name": "PreToolUse", "tool_use_id": "call"})
    assert start["event"] == "tool_start" and start["call_id"] == "call"
    assert start["activity"] == "running"
    request = map_hook({**fields, "hook_event_name": "PermissionRequest"})
    assert request["event"] == "approval_request"
    assert request["command"] == "pytest -q"
    assert "call_id" not in request and "request_id" not in request
    end = map_hook({**fields, "hook_event_name": "PostToolUse", "tool_use_id": "call",
                    "tool_response": {"exit_code": 1}})
    assert end["status"] == "error" and end["call_id"] == "call"


def test_codex_mcp_error_and_unknown_output_are_not_assumed_successful():
    fields = {"hook_event_name": "PostToolUse", "session_id": "thread", "tool_use_id": "call"}
    assert map_hook({**fields, "tool_response": {"isError": True}})["status"] == "error"
    assert map_hook({**fields, "tool_response": "unstructured result"})["status"] == "unknown"


def test_codex_child_identity_is_never_fabricated():
    common = {"session_id": "parent", "agent_id": "child", "agent_type": "reviewer"}
    start = map_hook({**common, "hook_event_name": "SubagentStart"})
    assert start["child_session_id"] == "child" and start["parent_session_id"] == "parent"
    stop = map_hook({**common, "hook_event_name": "SubagentStop"})
    assert stop["child_session_id"] == "child"
    assert map_hook({"session_id": "parent", "hook_event_name": "SubagentStart"}) is None
    child_tool = map_hook({**common, "hook_event_name": "PreToolUse", "tool_name": "Read", "tool_use_id": "read"})
    assert child_tool["session_id"] == "child" and child_tool["parent_session_id"] == "parent"


@pytest.mark.parametrize("payload", ["not json", "[]", '{"hook_event_name":"Stop"}',
                                      '{"hook_event_name":"Stop","session_id":"thread"}'])
def test_codex_stdin_is_silent_and_fail_open_even_when_disk_is_unwritable(tmp_path, payload):
    (tmp_path / "pixel-office").write_text("occupied")
    result = subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / "codex/hook.py")],
                            input=payload, text=True, capture_output=True,
                            env={**os.environ, "HERMES_HOME": str(tmp_path)})
    assert result.returncode == 0 and result.stdout == "" and result.stderr == ""


def test_codex_question_stdin_publishes_tool_and_request_without_transcript_reads(tmp_path):
    payload = {"hook_event_name": "PreToolUse", "session_id": "thread", "tool_use_id": "ask",
               "tool_name": "request_user_input", "transcript_path": "/must/not/read",
               "tool_input": {"questions": [{"question": "Which branch?"}]}}
    result = subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / "codex/hook.py")],
                            input=json.dumps(payload), text=True, capture_output=True,
                            env={**os.environ, "HERMES_HOME": str(tmp_path)})
    assert result.returncode == 0 and result.stdout == "" and result.stderr == ""
    events = [json.loads(path.read_text())["event"] for path in sorted((tmp_path / "pixel-office/inbox").glob("*.json"))]
    assert [event["event"] for event in events] == ["tool_start", "input_request"]
    assert all(event["call_id"] == "ask" for event in events)
