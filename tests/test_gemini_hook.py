"""Synthetic Gemini v0.63.0 contracts through the real stdin/inbox adapter."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

import pytest

from event_store import EventStore

ROOT = Path(__file__).resolve().parents[1]


def hook(home, name, **overrides):
    payload = {
        "hook_event_name": name, "session_id": "gemini-source-session",
        "cwd": "/private/project", "transcript_path": "/must/not/read",
        "timestamp": "2026-10-08T12:00:00.000Z", **overrides,
    }
    result = subprocess.run([sys.executable, str(ROOT / "gemini/hook.py")],
                            input=json.dumps(payload), text=True, capture_output=True,
                            env={**os.environ, "HERMES_HOME": str(home)})
    assert result.returncode == 0 and result.stdout == "" and result.stderr == ""
    return [json.loads(path.read_text())["event"]
            for path in sorted((home / "pixel-office/inbox").glob("*.json"))]


@pytest.mark.parametrize("name,expected", [
    ("SessionStart", "session_start"), ("BeforeAgent", "session_busy"),
    ("AfterAgent", "session_idle"), ("SessionEnd", "session_end"),
])
def test_gemini_lifecycle_uses_only_source_session_and_no_private_payload(tmp_path, name, expected):
    before = time.time()
    events = hook(tmp_path, name, prompt="secret input", prompt_response="secret output",
                  tool_input={"command": "secret command"}, llm_response={"usageMetadata": {"totalTokenCount": 500}},
                  agent_id="unsupported child", turn_id="unsupported turn", model="unsupported model")
    assert len(events) == 1
    event = events[0]
    assert event["event"] == expected and event["platform"] == "gemini"
    assert event["session_id"] == "gemini-source-session"
    assert before <= event["ts"] <= time.time()
    assert set(event) <= {"event", "session_id", "platform", "ts", "pid", "reason", "source"}
    assert "secret" not in json.dumps(event)


@pytest.mark.parametrize("name", ["BeforeTool", "AfterTool", "Notification", "BeforeModel", "AfterModel", "PreCompress", "Unknown"])
def test_gemini_unsupported_events_do_not_invent_correlated_work(tmp_path, name):
    assert hook(tmp_path, name, tool_name="run_shell_command", tool_input={"command": "pytest"},
                notification_type="ToolPermission", llm_response={"usageMetadata": {"totalTokenCount": 12}}) == []


@pytest.mark.parametrize("session", [None, "", "  ", 123, {}, "x" * 257, "session\nother"])
def test_gemini_rejects_unusable_source_identity_without_fabricating_one(tmp_path, session):
    assert hook(tmp_path, "SessionStart", session_id=session) == []


def test_gemini_source_reason_is_bounded_and_does_not_claim_success(tmp_path):
    assert hook(tmp_path, "SessionStart", source="resume")[0]["source"] == "resume"
    assert hook(tmp_path, "AfterAgent", stop_hook_active=True)[-1]["reason"] == "after_agent"
    assert hook(tmp_path, "SessionEnd", reason="logout")[-1]["reason"] == "logout"
    assert "reason" not in hook(tmp_path, "SessionEnd", reason="secret arbitrary text")[-1]


@pytest.mark.parametrize("payload", [b"not json", b"[]", b"\xff", b'{"hook_event_name":"SessionStart"}',
                                      b'{"hook_event_name":"SessionStart","session_id":"source"}'])
def test_gemini_stdin_is_silent_and_fail_open_when_input_or_output_is_invalid(tmp_path, payload):
    (tmp_path / "pixel-office").write_text("occupied")
    result = subprocess.run([sys.executable, str(ROOT / "gemini/hook.py")],
                            input=payload, capture_output=True,
                            env={**os.environ, "HERMES_HOME": str(tmp_path)})
    assert result.returncode == 0 and result.stdout == result.stderr == b""


def test_gemini_rejects_oversized_input_without_publishing_partial_session(tmp_path):
    assert hook(tmp_path, "SessionStart", prompt="x" * (1024 * 1024)) == []


def test_gemini_lifecycle_reaches_sqlite_without_fabricating_work_or_usage(tmp_path):
    store = EventStore(tmp_path / "pixel-office")
    def state(name, **values):
        hook(tmp_path, name, **values)
        return store.consume(lambda: [], time.time())
    start = state("SessionStart", source="startup")
    assert start["agents"][0]["platform"] == "gemini"
    assert start["agents"][0]["status"] == "idle"
    xp = start["progress"]["xp"]
    assert state("BeforeAgent", prompt="private")["agents"][0]["status"] == "thinking"
    idle = state("AfterAgent", prompt_response="not proof of success")
    assert idle["agents"][0]["status"] == "idle" and idle["progress"]["xp"] == xp
    # An upstream AfterAgent hook may reject a response; BeforeAgent runs again.
    assert state("BeforeAgent")["agents"][0]["status"] == "thinking"
    ended = state("SessionEnd", reason="exit")
    assert ended["agents"][0]["status"] == "gone"
    late = state("AfterAgent")
    assert late["agents"][0]["status"] == "gone"
    assert late["progress"]["xp"] == xp
    assert late["progress"]["stats"]["sessions"] == 1
    assert late["progress"]["stats"]["tools"] == 0
    assert late["progress"]["stats"]["subagents"] == 0
    assert late["usage"]["totals"]["reports"] == 0
    assert late["tasks"] == []
    assert all(event["session_id"] == "gemini-source-session" for event in late["events"])
