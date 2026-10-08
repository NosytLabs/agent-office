#!/usr/bin/env python3
"""Claude Code → Agent Office observer.

Claude Code pipes hook JSON on stdin. We publish one immutable inbox event and
always exit 0 — never block, deny, or print decisions.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from event_inbox import publish as publish_inbox

ACTIVITY = {
    "Bash": "running",
    "Read": "reading",
    "Grep": "reading",
    "Glob": "reading",
    "Edit": "typing",
    "Write": "typing",
    "NotebookEdit": "typing",
    "WebFetch": "browsing",
    "WebSearch": "browsing",
    "Task": "delegating",
    "Agent": "delegating",
}


def office_dir() -> Path:
    home = Path(os.environ.get("HERMES_HOME") or (Path.home() / ".hermes"))
    d = home / "pixel-office"
    d.mkdir(parents=True, exist_ok=True)
    return d


def publish(event: dict) -> None:
    event = dict(event)
    event.setdefault("ts", time.time())
    event.setdefault("pid", os.getpid())
    event.setdefault("platform", "claude")
    publish_inbox(office_dir(), event)


def map_hook(raw: dict) -> dict | None:
    name = raw.get("hook_event_name") or raw.get("hookEventName") or ""
    sid = raw.get("session_id") or raw.get("sessionId") or ""
    child = raw.get("agent_id") or ""
    context = {"session_id": child or sid, "platform": "claude"}
    if child:
        context["parent_session_id"] = sid
    if raw.get("tool_use_id"):
        context["call_id"] = raw["tool_use_id"]
    tool = raw.get("tool_name") or raw.get("toolName") or ""
    inp = raw.get("tool_input") or raw.get("toolInput") or {}
    preview = ""
    if isinstance(inp, dict):
        for k in ("command", "file_path", "path", "query", "url", "pattern", "description"):
            if inp.get(k):
                preview = str(inp[k])[:80]
                break
    if name == "SessionStart":
        return {"event": "session_start", "session_id": sid, "platform": "claude"}
    if name == "SessionEnd":
        return {"event": "session_end", "session_id": sid}
    if name == "UserPromptSubmit":
        return {"event": "session_busy", **context}
    if name == "Stop":
        return {"event": "session_idle", **context}
    if name == "StopFailure":
        return {"event": "session_error", **context, "error_message": str(raw.get("error") or "session error")[:80]}
    if name == "PreToolUse":
        if tool == "AskUserQuestion":
            questions = inp.get("questions", []) if isinstance(inp, dict) else []
            first = questions[0] if isinstance(questions, list) and questions and isinstance(questions[0], dict) else {}
            return {
                "event": "input_request", **context, "tool_name": tool,
                "question": str(first.get("question") or first.get("header") or "needs an answer")[:80],
            }
        return {
            "event": "tool_start",
            **context,
            "tool_name": tool,
            "activity": ACTIVITY.get(tool, "working"),
            "preview": preview,
        }
    if name in ("PostToolUse", "PostToolUseFailure"):
        return {
            "event": "tool_end",
            **context,
            "tool_name": tool,
            "status": "error" if "Failure" in name else "ok",
            "error_message": str(raw.get("error") or "")[:80],
            "duration_ms": raw.get("duration_ms"),
        }
    if name == "PermissionRequest":
        return {"event": "approval_request", **context, "tool_name": tool, "command": preview or tool}
    if name == "PermissionDenied":
        return {"event": "approval_response", **context, "tool_name": tool, "choice": "deny"}
    if name == "SubagentStart":
        return {
            "event": "subagent_start",
            "parent_session_id": sid,
            "child_session_id": raw.get("agent_id") or sid + ":sub",
            "child_goal": preview or raw.get("agent_type") or "subagent",
        }
    if name == "SubagentStop":
        return {"event": "subagent_stop", "child_session_id": raw.get("agent_id") or sid + ":sub"}
    return None


def main() -> int:
    try:
        raw = json.loads(sys.stdin.read() or "{}")
        ev = map_hook(raw if isinstance(raw, dict) else {})
        if ev:
            if ev.get("event") == "input_request" and ev.get("tool_name") == "AskUserQuestion":
                # Keep one observed tool invocation in lifetime stats while
                # distinguishing its human question from a permission approval.
                publish({**ev, "event": "tool_start", "activity": "working", "preview": ev["question"]})
            publish(ev)
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
