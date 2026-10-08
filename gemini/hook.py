#!/usr/bin/env python3
"""Observe Gemini CLI session boundaries without returning hook instructions.

Gemini v0.63.0 hooks lack tool-call, turn, and usage-unit identities. This
adapter deliberately observes only session lifecycle; it never reads a
transcript or persists prompts, responses, or tool inputs.
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

MAX_INPUT_BYTES = 1024 * 1024
EVENTS = {"SessionStart": "session_start", "BeforeAgent": "session_busy",
          "AfterAgent": "session_idle", "SessionEnd": "session_end"}


def map_hook(raw: dict) -> dict | None:
    name = raw.get("hook_event_name")
    sid = raw.get("session_id")
    if (not isinstance(name, str) or name not in EVENTS
            or not isinstance(sid, str) or not sid.strip() or len(sid) > 256
            or any(ord(char) < 32 or ord(char) == 127 for char in sid)):
        return None
    event = {"event": EVENTS[name], "session_id": sid, "platform": "gemini"}
    if name == "SessionStart" and raw.get("source") in ("startup", "resume", "clear"):
        event["source"] = raw["source"]
    elif name == "AfterAgent":
        # A returned agent loop is not proof of success, completed tasks, or
        # completed tools. Another hook can reject it and trigger BeforeAgent.
        event["reason"] = "after_agent"
    elif name == "SessionEnd" and raw.get("reason") in ("exit", "clear", "logout", "prompt_input_exit", "other"):
        event["reason"] = raw["reason"]
    return event


def main() -> int:
    try:
        # Hook input can contain large prompts/responses. Bound the read and
        # discard oversized input atomically rather than parsing a prefix.
        payload = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
        if len(payload) > MAX_INPUT_BYTES:
            return 0
        raw = json.loads(payload)
        event = map_hook(raw) if isinstance(raw, dict) else None
        if event:
            from event_inbox import publish
            home = Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes").expanduser()
            publish(home / "pixel-office", {"ts": time.time(), "pid": os.getpid(), **event})
    except Exception:
        # Empty stdout/stderr and exit 0 are Gemini's no-op hook result. An
        # unavailable office must never block, alter, or add context to work.
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
