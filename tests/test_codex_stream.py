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
