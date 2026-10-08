#!/usr/bin/env python3
"""Codex hook stdin → Agent Office. Always silent, advisory, and fail-open.

Uses the documented hook payload, never the unstable transcript format. Review
installed definitions in Codex's /hooks before they can run.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from event_inbox import publish as publish_inbox

ACTIVITY = {
    "Bash": "running", "exec_command": "running", "shell": "running",
    "Read": "reading", "Grep": "reading", "Glob": "reading",
    "Edit": "typing", "Write": "typing", "apply_patch": "typing",
    "WebSearch": "browsing", "web_search": "browsing",
    "spawn_agent": "delegating", "Agent": "delegating",
}


def publish(event: dict) -> None:
    payload = {"ts": time.time(), "pid": os.getpid(), "platform": "codex", **event}
    home = Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes").expanduser()
    publish_inbox(home / "pixel-office", payload)


def _text(value: object, limit: int = 80) -> str:
    return str(value or "").replace("\n", " ")[:limit]


def _outcome(response: object) -> tuple[str, str]:
    """Only infer failure/success from explicit structured outcome fields."""
    if isinstance(response, dict):
        code = response.get("exit_code", response.get("exitCode"))
        if isinstance(code, int) and not isinstance(code, bool):
            return ("error", f"exit code {code}") if code else ("ok", "")
        if response.get("isError") is True or response.get("error") or response.get("status") in ("failed", "error"):
            return "error", _text(response.get("error") or "tool failed")
        if response.get("isError") is False or response.get("status") in ("completed", "ok"):
            return "ok", ""
    if isinstance(response, str):
        match = re.search(r"(?m)^(?:Process exited with code|Exit code:) ([+-]?\d+)\s*$", response)
        if match:
            code = int(match.group(1))
            return ("error", f"exit code {code}") if code else ("ok", "")
    return "unknown", ""


def map_hook(raw: dict) -> dict | None:
    name = raw.get("hook_event_name")
    sid = raw.get("session_id")
    if not isinstance(sid, str) or not sid:
        return None
    child = raw.get("agent_id") if isinstance(raw.get("agent_id"), str) else ""
    context = {"platform": "codex", "session_id": child or sid}
    if child:
        context["parent_session_id"] = sid
    for key in ("turn_id", "model"):
        if isinstance(raw.get(key), str) and raw[key]:
            context[key] = raw[key]
    tool = _text(raw.get("tool_name"), 120)
    inp = raw.get("tool_input")
    preview = ""
    if isinstance(inp, dict):
        for key in ("command", "file_path", "path", "query", "url", "pattern", "description"):
            if inp.get(key):
                preview = _text(inp[key])
                break
    if name == "SessionStart":
        # Automatic compaction can happen mid-turn: it must not clear tools.
        return {"event": "session_update" if raw.get("source") == "compact" else "session_start", **context}
    if name == "SessionEnd":
        return {"event": "session_end", **context}
    if name == "UserPromptSubmit":
        return {"event": "session_busy", **context}
    if name in ("Stop", "Interrupt"):
        return {"event": "session_idle", **context, "reason": "interrupted" if name == "Interrupt" else "completed"}
    if name in ("SubagentStart", "SubagentStop"):
        if not child:
            return None
        return {"event": "subagent_start" if name == "SubagentStart" else "subagent_stop",
                **context, "parent_session_id": sid, "child_session_id": child,
                "child_goal": _text(raw.get("agent_type") or "subagent")}
    if name == "PermissionRequest":
        # This hook has no documented tool_use_id; never invent an approval result.
        return {"event": "approval_request", **context, "tool_name": tool, "command": preview or tool}
    if name not in ("PreToolUse", "PostToolUse"):
        return None
    if isinstance(raw.get("tool_use_id"), str) and raw["tool_use_id"]:
        context["call_id"] = raw["tool_use_id"]
    if name == "PostToolUse":
        status, error = _outcome(raw.get("tool_response"))
        return {"event": "tool_end", **context, "tool_name": tool, "status": status, "error_message": error}
    if tool in ("request_user_input", "AskUserQuestion"):
        questions = inp.get("questions") if isinstance(inp, dict) else None
        first = questions[0] if isinstance(questions, list) and questions and isinstance(questions[0], dict) else {}
        return {"event": "input_request", **context, "tool_name": tool,
                "question": _text(first.get("question") or first.get("header") or "needs an answer")}
    return {"event": "tool_start", **context, "tool_name": tool,
            "activity": ACTIVITY.get(tool, "working"), "preview": preview}


def main() -> int:
    try:
        raw = json.loads(sys.stdin.read() or "{}")
        event = map_hook(raw if isinstance(raw, dict) else {})
        if event:
            if event["event"] == "input_request":
                publish({**event, "event": "tool_start", "activity": "working", "preview": event["question"]})
            publish(event)
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
