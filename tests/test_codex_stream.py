"""Structured usage uses replayable stream/turn identity, never timestamps."""
import io
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from codex.stream import MAX_LINE_BYTES, UsageStream, iter_records
from event_store import EventStore


def test_codex_stream_reports_inclusive_usage_with_stable_replacement_identity():
    observer = UsageStream("build-check")
    assert observer.observe({"type": "thread.started", "thread_id": "thread"}) is None
    assert observer.observe({"type": "turn.started"}) is None
    raw = {"type": "turn.completed", "usage": {"input_tokens": 20, "cached_input_tokens": 10,
           "cache_write_input_tokens": 3, "output_tokens": 8, "reasoning_output_tokens": 5}}
    event = observer.observe(raw)
    assert event["platform"] == "codex" and event["session_id"] == "thread"
    assert event["input_tokens"] == 20 and event["output_tokens"] == 8
    assert event["cached_input_tokens"] == 10 and event["cache_write_tokens"] == 3
    assert event["reasoning_output_tokens"] == 5
    assert "cost_usd" not in event and "model" not in event
    assert observer.observe(raw) == event
    corrected = observer.observe({"type": "turn.completed", "usage": {"input_tokens": 19, "output_tokens": 7}})
    assert corrected["usage_id"] == event["usage_id"]
    observer.observe({"type": "turn.started"})
    assert observer.observe(raw)["usage_id"] != event["usage_id"]


def test_codex_stream_requires_thread_turn_and_real_usage():
    observer = UsageStream("build-check")
    raw = {"type": "turn.completed", "usage": {"input_tokens": 0, "output_tokens": 0}}
    assert observer.observe(raw) is None
    observer.observe({"type": "thread.started", "thread_id": "thread"})
    assert observer.observe(raw) is None
    observer.observe({"type": "turn.started"})
    assert observer.observe({"type": "turn.completed", "usage": None}) is None
    assert observer.observe(raw)["input_tokens"] == 0


@pytest.mark.parametrize("name", ["", "\n", "x" * 257])
def test_codex_stream_rejects_an_unusable_capture_identity(name):
    with pytest.raises(ValueError):
        UsageStream(name)


def test_codex_stream_bounds_malformed_oversized_and_partial_records():
    good = {"type": "thread.started", "thread_id": "thread"}
    source = io.BytesIO(b"{broken}\n" + b"x" * (MAX_LINE_BYTES + 3) + b"\n" +
                        json.dumps(good).encode() + b"\n" + b'{"type":')
    assert list(iter_records(source)) == [good]


@pytest.mark.parametrize("kind", ["item.started", "item.updated", "item.completed"])
def test_codex_source_todo_flags_determine_completion_even_when_the_list_event_completes(kind):
    observer = UsageStream("plan-check")
    observer.observe({"type": "thread.started", "thread_id": "thread"})
    observer.observe({"type": "turn.started"})
    event = observer.observe({"type": kind, "item": {
        "id": "plan-1", "type": "todo_list", "items": [
            {"text": "Run the tests", "completed": True},
            {"text": "Review the result", "completed": False},
        ],
    }})
    assert event is not None
    assert event["event"] == "tasks_update"
    assert event["platform"] == "codex" and event["session_id"] == "thread"
    assert event["task_source"] == "codex.exec.todo_list"
    assert event["source_updated_at"] is None
    assert event["tasks"] == [
        {"id": "row-0", "content": "Run the tests", "status": "completed"},
        {"id": "row-1", "content": "Review the result", "status": "pending"},
    ]
    assert event["task_capture_id"] == "plan-check" and event["task_sequence"] == 3


def test_codex_empty_todo_snapshot_is_reported_but_turn_completion_does_not_invent_one():
    observer = UsageStream("plan-check")
    observer.observe({"type": "thread.started", "thread_id": "thread"})
    observer.observe({"type": "turn.started"})
    event = observer.observe({"type": "item.updated", "item": {"id": "plan", "type": "todo_list", "items": []}})
    assert event is not None and event["tasks"] == []
    complete = observer.observe({"type": "turn.completed", "usage": {"input_tokens": 0, "output_tokens": 0}})
    assert complete["event"] == "usage" and "tasks" not in complete


@pytest.mark.parametrize("items", [
    None, {}, [None], [{"text": "Missing flag"}], [{"text": "Not boolean", "completed": "true"}],
    [{"text": "Too long " + "x" * 512, "completed": False}],
    [{"text": "Valid", "completed": False}, {"text": "Bad flag", "completed": 1}],
    [{"text": "Duplicate source descriptions are fine", "completed": False}] * 101,
])
def test_codex_invalid_todo_snapshot_is_not_published_as_an_empty_or_partial_board(items):
    observer = UsageStream("plan-check")
    observer.observe({"type": "thread.started", "thread_id": "thread"})
    observer.observe({"type": "turn.started"})
    assert observer.observe({"type": "item.updated", "item": {"id": "plan", "type": "todo_list", "items": items}}) is None


def test_codex_todo_requires_source_identity_and_never_parses_a_plan_from_message_text():
    observer = UsageStream("plan-check")
    plan = {"type": "item.updated", "item": {"id": "plan", "type": "todo_list", "items": []}}
    assert observer.observe(plan) is None
    observer.observe({"type": "thread.started", "thread_id": "thread"})
    assert observer.observe({"type": "item.updated", "item": {"type": "todo_list", "items": []}}) is None
    assert observer.observe({"type": "item.completed", "item": {
        "id": "message", "type": "agent_message", "text": "[x] Done\n[ ] Next",
    }}) is None


def test_codex_preserves_a_full_100_row_todo_snapshot_and_unicode_content():
    observer = UsageStream("plan-check")
    observer.observe({"type": "thread.started", "thread_id": "thread"})
    event = observer.observe({"type": "item.updated", "item": {
        "id": "plan", "type": "todo_list", "items": [{"text": "🐟" * 512, "completed": False}] * 100,
    }})
    assert event is not None
    assert len(event["tasks"]) == 100 and len({task["id"] for task in event["tasks"]}) == 100
    assert event["tasks"][99]["content"] == "🐟" * 512


def test_codex_stream_real_stdin_replay_and_distinct_capture_accounting(tmp_path):
    payload = "\n".join(json.dumps(event) for event in [
        {"type": "thread.started", "thread_id": "thread"}, {"type": "turn.started"},
        {"type": "turn.completed", "usage": {"input_tokens": 20, "cached_input_tokens": 10, "output_tokens": 8}},
    ]) + "\n"
    def publish(capture):
        result = subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / "codex/stream.py"), "--stream-id", capture],
                                input=payload, text=True, capture_output=True,
                                env={**os.environ, "HERMES_HOME": str(tmp_path)})
        assert result.returncode == 0 and result.stdout == "" and result.stderr == ""
    directory = tmp_path / "pixel-office"
    publish("capture-one")
    first = EventStore(directory).consume(lambda: [], 1000)
    assert first["usage"]["totals"]["total_tokens"] == 28
    publish("capture-one")
    replay = EventStore(directory).consume(lambda: [], 1000)
    assert replay["usage"]["totals"]["total_tokens"] == 28
    assert replay["progress"]["stats"]["sessions"] == 0  # hooks own lifecycle
    publish("capture-two")
    assert EventStore(directory).consume(lambda: [], 1000)["usage"]["totals"]["total_tokens"] == 56
