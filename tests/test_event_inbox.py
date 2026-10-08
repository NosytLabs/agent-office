"""Each publisher creates immutable, ordered, complete receipt files."""
import copy
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

import event_inbox


def packets(directory):
    return [(path, json.loads(path.read_text())) for path in sorted((directory / "inbox").glob("*.json"))]


def test_identical_payloads_get_distinct_receipts_without_mutating_input(tmp_path):
    event = {"ts": 100, "event": "tool_start", "nested": {"paths": ["a.py"]}}
    original = copy.deepcopy(event)
    one = event_inbox.publish(tmp_path, event)
    two = event_inbox.publish(tmp_path, event)
    records = packets(tmp_path)
    assert one != two
    assert [record["event"] for _, record in records] == [original, original]
    assert event == original
    assert all(record["version"] == 1 and record["epoch"] == "initial" for _, record in records)
    assert not (tmp_path / "events.jsonl").exists()


def test_equal_clock_still_orders_receipts_and_ignores_payload_timestamp(tmp_path, monkeypatch):
    monkeypatch.setattr(event_inbox.time, "time_ns", lambda: 100)
    for ts in (200, 100, 100):
        event_inbox.publish(tmp_path, {"ts": ts, "event": "tool_start"})
    records = packets(tmp_path)
    assert [record["event"]["ts"] for _, record in records] == [200, 100, 100]
    created = [int(record["created_ns"]) for _, record in records]
    assert created == [created[0], created[0] + 1, created[0] + 2]
    for path, record in records:
        assert path.name == f'{int(record["created_ns"]):020d}-{record["writer_id"]}-{record["sequence"]:012d}.json'


def test_each_publication_reads_the_current_reset_epoch(tmp_path):
    event_inbox.publish(tmp_path, {"event": "session_start"})
    (tmp_path / "event-epoch").write_text("reset-two\n")
    event_inbox.publish(tmp_path, {"event": "session_start"})
    (tmp_path / "event-epoch").write_text("reset-three\n")
    event_inbox.publish(tmp_path, {"event": "session_start"})
    assert [record["epoch"] for _, record in packets(tmp_path)] == ["initial", "reset-two", "reset-three"]


@pytest.mark.parametrize("stage", ["flush", "rename"])
def test_failed_publication_never_exposes_a_partial_ready_file(tmp_path, monkeypatch, stage):
    def fail(*args, **kwargs):
        raise OSError("simulated publication failure")
    if stage == "flush":
        monkeypatch.setattr(event_inbox.os, "fsync", fail)
    else:
        monkeypatch.setattr(Path, "replace", fail)
    with pytest.raises(OSError, match="simulated"):
        event_inbox.publish(tmp_path, {"event": "session_start", "payload": "x" * 20000})
    assert list((tmp_path / "inbox").iterdir()) == []


def test_concurrent_threads_publish_distinct_complete_files(tmp_path):
    with ThreadPoolExecutor(max_workers=4) as pool:
        paths = list(pool.map(lambda n: event_inbox.publish(tmp_path, {"event": "tool_start", "index": n}), range(24)))
    records = packets(tmp_path)
    assert len(set(paths)) == len(records) == 24
    assert sorted(record["event"]["index"] for _, record in records) == list(range(24))
    created = [int(record["created_ns"]) for _, record in records]
    assert len(set(created)) == 24


def test_separate_processes_use_distinct_writer_ids(tmp_path):
    root = Path(__file__).resolve().parents[1]
    script = "from pathlib import Path; import sys; from event_inbox import publish; publish(Path(sys.argv[1]), {'event':'session_start'})"
    for _ in range(2):
        result = subprocess.run([sys.executable, "-c", script, str(tmp_path)], cwd=root,
                                capture_output=True, text=True, check=True)
        assert result.stdout == result.stderr == ""
    records = packets(tmp_path)
    assert len(records) == 2
    assert len({record["writer_id"] for _, record in records}) == 2
@pytest.mark.skipif(not hasattr(os, "fork"), reason="fork is not available")
def test_child_publisher_does_not_inherit_a_locked_parent_mutex(tmp_path):
    import multiprocessing
    process = multiprocessing.get_context("fork").Process(target=event_inbox.publish, args=(tmp_path, {"event": "session_start"}))
    with event_inbox._lock:
        process.start()
        process.join(timeout=3)
        if process.is_alive():
            process.terminate()
            process.join(timeout=3)
            pytest.fail("forked publisher inherited a permanently locked mutex")
    assert process.exitcode == 0
    assert len(list((tmp_path / "inbox").glob("*.json"))) == 1
