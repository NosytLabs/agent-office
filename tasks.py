"""Bounded, source-reported task boards; no lifecycle or progression side effects.

Each event replaces one runtime/session board in full. Task row identities are
local to that snapshot; they are not evidence that two edited plans share work.
"""
from __future__ import annotations

from collections import OrderedDict
import copy
import math
import re
from typing import Any

MAX_BOARDS = 128
MAX_TASKS = 100
MAX_CONTENT = 512
MAX_TASK_ID = 256
MAX_CAPTURE_WATERMARKS = 8
STATUSES = frozenset(("pending", "in_progress", "completed", "cancelled"))
PRIORITIES = frozenset(("high", "medium", "low"))


def _text(value: Any, limit: int, *, multiline: bool = False) -> bool:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        return False
    allowed = "\n\r\t" if multiline else ""
    return not any((ord(c) < 32 and c not in allowed) or ord(c) == 127
                   or 0xD800 <= ord(c) <= 0xDFFF for c in value)


def _clock(value: Any) -> bool:
    try:
        return (isinstance(value, (int, float)) and not isinstance(value, bool)
                and math.isfinite(value) and value >= 0)
    except OverflowError:
        return False


def _capture_cursor(identity: Any, sequence: Any) -> bool:
    return (_text(identity, 256) and isinstance(sequence, int)
            and not isinstance(sequence, bool) and 1 <= sequence <= (1 << 53) - 1)


def _restore_watermarks(board: dict) -> OrderedDict[str, int] | None:
    """Load bounded replay memory and upgrade the earlier single-capture form."""
    source = board.get("task_capture_watermarks", [])
    if not isinstance(source, list) or len(source) > MAX_CAPTURE_WATERMARKS:
        return None
    watermarks: OrderedDict[str, int] = OrderedDict()
    for item in source:
        if not isinstance(item, dict):
            return None
        identity, sequence = item.get("id"), item.get("sequence")
        if not _capture_cursor(identity, sequence) or identity in watermarks:
            return None
        watermarks[identity] = sequence
    if "task_capture_id" in board or "task_sequence" in board:
        identity, sequence = board.get("task_capture_id"), board.get("task_sequence")
        if not _capture_cursor(identity, sequence):
            return None
        watermarks[identity] = max(watermarks.get(identity, sequence), sequence)
        watermarks.move_to_end(identity)
        while len(watermarks) > MAX_CAPTURE_WATERMARKS:
            watermarks.popitem(last=False)
    return watermarks


def normalize_rows(value: Any) -> list[dict] | None:
    """Reject a malformed/oversized whole list rather than falsely truncating it."""
    if not isinstance(value, list) or len(value) > MAX_TASKS:
        return None
    result, identities = [], set()
    for item in value:
        if not isinstance(item, dict):
            return None
        identity, content, status = item.get("id"), item.get("content"), item.get("status")
        if (not _text(identity, MAX_TASK_ID) or identity in identities
                or not _text(content, MAX_CONTENT, multiline=True)
                or not isinstance(status, str) or status not in STATUSES):
            return None
        row = {"id": identity, "content": content, "status": status}
        if "priority" in item:
            priority = item["priority"]
            if not isinstance(priority, str) or priority not in PRIORITIES:
                return None
            row["priority"] = priority
        result.append(row)
        identities.add(identity)
    return result


class TaskBoards:
    """A small checkpoint collection keyed by runtime and exact session identity."""

    def __init__(self, snapshot: Any = None):
        self._boards: OrderedDict[tuple[str, str], dict] = OrderedDict()
        if isinstance(snapshot, list):
            for board in snapshot:
                if isinstance(board, dict):
                    watermarks = _restore_watermarks(board)
                    if watermarks is None:
                        continue
                    if self.apply({
                        "platform": board.get("runtime"), "session_id": board.get("session_id"),
                        "task_source": board.get("source"), "tasks": board.get("tasks"),
                        "source_updated_at": board.get("source_updated_at"),
                    }, board.get("observed_at")):
                        self._boards[board["runtime"], board["session_id"]]["task_capture_watermarks"] = [
                            {"id": identity, "sequence": sequence} for identity, sequence in watermarks.items()
                        ]

    def apply(self, event: dict, observed_at: Any) -> bool:
        runtime, session, source = event.get("platform"), event.get("session_id"), event.get("task_source")
        source_time = event.get("source_updated_at")
        if (not isinstance(runtime, str) or not re.fullmatch(r"[a-z][a-z0-9_-]{0,63}", runtime)
                or not _text(session, 512) or not _text(source, 128)
                or not _clock(observed_at) or (source_time is not None and not _clock(source_time))):
            return False
        rows = normalize_rows(event.get("tasks"))
        if rows is None:
            return False
        capture, sequence = event.get("task_capture_id"), event.get("task_sequence")
        has_capture = "task_capture_id" in event or "task_sequence" in event
        if has_capture and not _capture_cursor(capture, sequence):
            return False
        key = (runtime, session)
        previous = self._boards.get(key)
        if (previous and previous["source"] == source and source_time is not None
                and previous["source_updated_at"] is not None
                and source_time < previous["source_updated_at"]):
            return False
        watermarks = OrderedDict(
            (item["id"], item["sequence"]) for item in
            (previous["task_capture_watermarks"] if previous and previous["source"] == source else [])
        )
        if has_capture:
            if sequence <= watermarks.get(capture, 0):
                return False
            watermarks[capture] = sequence
            watermarks.move_to_end(capture)
            while len(watermarks) > MAX_CAPTURE_WATERMARKS:
                watermarks.popitem(last=False)
        self._boards[key] = {
            "runtime": runtime, "session_id": session, "source": source,
            "source_updated_at": source_time,
            "observed_at": max(previous["observed_at"], observed_at) if previous else observed_at,
            "tasks": rows,
            "task_capture_watermarks": [
                {"id": identity, "sequence": ordinal} for identity, ordinal in watermarks.items()
            ],
        }
        self._boards.move_to_end(key)
        while len(self._boards) > MAX_BOARDS:
            self._boards.popitem(last=False)
        return True

    def dump(self) -> list[dict]:
        return copy.deepcopy(list(self._boards.values()))

    def snapshot(self, now: float) -> list[dict]:
        return [{**copy.deepcopy({key: value for key, value in board.items()
                                  if key not in ("task_capture_id", "task_sequence", "task_capture_watermarks")}),
                 "age_s": max(0, int(now - board["observed_at"]))}
                for board in reversed(self._boards.values())]
