#!/usr/bin/env python3
"""Claude Code → Agent Office observer.

Claude Code pipes hook JSON on stdin. We append one events.jsonl line and
always exit 0 — never block, deny, or print decisions.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

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
}


def events_path() -> Path:
    home = Path(os.environ.get("HERMES_HOME") or (Path.home() / ".hermes"))
    d = home / "pixel-office"
    d.mkdir(parents=True, exist_ok=True)
    return d / "events.jsonl"


def publish(event: dict) -> None:
    event.setdefault("ts", time.time())
    event.setdefault("pid", os.getpid())
    event.setdefault("platform", "claude")
    path = events_path()
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(event, ensure_ascii=False, default=str) + "\n")


def map_hook(raw: dict) -> dict | None:
    name = raw.get("hook_event_name") or raw.get("hookEventName") or ""
    sid = raw.get("session_id") or raw.get("sessionId") or ""
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
    if name == "PreToolUse":
        return {
            "event": "tool_start",
            "session_id": sid,
            "tool_name": tool,
            "activity": ACTIVITY.get(tool, "working"),
            "preview": preview,
        }
    if name in ("PostToolUse", "PostToolUseFailure"):
        return {
            "event": "tool_end",
            "session_id": sid,
            "tool_name": tool,
            "status": "error" if "Failure" in name else "ok",
        }
    if name == "PermissionRequest":
        return {"event": "approval_request", "session_id": sid, "command": preview or tool}
    if name == "SubagentStart":
        return {
            "event": "subagent_start",
            "parent_session_id": sid,
            "child_session_id": raw.get("agent_id") or sid + ":sub",
            "child_goal": preview or "subagent",
        }
    if name == "SubagentStop":
        return {"event": "subagent_stop", "child_session_id": raw.get("agent_id") or sid + ":sub"}
    return None


def main() -> int:
    try:
        raw = json.loads(sys.stdin.read() or "{}")
        ev = map_hook(raw if isinstance(raw, dict) else {})
        if ev:
            publish(ev)
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
