"""The published reset intent is recoverable across either-side DB crashes."""
import json
from pathlib import Path
import sqlite3

import pytest

from event_inbox import publish
from event_store import EventStore


def fence_epoch(directory):
    text = (Path(directory) / "event-epoch").read_text().strip()
    try:
        parsed = json.loads(text)
    except ValueError:
        return text
    return parsed["epoch"] if isinstance(parsed, dict) else text


def checkpoint(directory):
    with sqlite3.connect(Path(directory) / "office.sqlite3") as db:
        return json.loads(db.execute("SELECT data FROM checkpoint WHERE id=1").fetchone()[0])


def event(kind="tool_start", **values):
    return {"event": kind, "ts": 10, "session_id": "before", "platform": "opencode", "tool_name": "Read", **values}


def consume(directory, reader=lambda: []):
    return EventStore(directory).consume(reader, 100)


def test_crash_after_intent_before_db_commit_rolls_forward_and_keeps_new_events(tmp_path, monkeypatch):
    publish(tmp_path, event())
    publish(tmp_path, event("usage", usage_id="message", input_tokens=100, output_tokens=20, cost_usd=0.01))
    publish(tmp_path, event("approval_request", request_id="old-prompt", command="Old approval"))
    consume(tmp_path)
    old_epoch = fence_epoch(tmp_path)
    old_ready = publish(tmp_path, event(session_id="queued-before-reset"))
    original = EventStore._save

    def crash(db, data, original_data=None):
        if data["epoch"] != old_epoch:
            raise RuntimeError("crash after intent publication before DB commit")
        return original(db, data, original_data)

    monkeypatch.setattr(EventStore, "_save", staticmethod(crash))
    with pytest.raises(RuntimeError, match="after intent"):
        EventStore(tmp_path).reset(lambda: [])
    assert fence_epoch(tmp_path) != old_epoch
    assert checkpoint(tmp_path)["epoch"] == old_epoch
    # The observer stays offline, but the bundled writer sees the reset intent.
    after_ready = publish(tmp_path, event(ts=0, session_id="after-reset"))
    monkeypatch.setattr(EventStore, "_save", staticmethod(original))
    snapshot = consume(tmp_path)
    assert snapshot["progress"]["stats"]["tools"] == 1
    assert snapshot["usage"]["totals"]["reports"] == 0
    assert {agent["id"] for agent in snapshot["agents"]} == {"after-reset"}
    assert snapshot["tracking"]["received"] == 1
    assert not old_ready.exists()
    assert not after_ready.exists()
    assert checkpoint(tmp_path)["epoch"] == fence_epoch(tmp_path)
    assert consume(tmp_path)["progress"] == snapshot["progress"]


def test_crash_after_db_commit_before_cleanup_never_replays_old_or_drops_new_units(tmp_path, monkeypatch):
    publish(tmp_path, event())
    consume(tmp_path)
    old_epoch = fence_epoch(tmp_path)
    old_ready = publish(tmp_path, event(session_id="queued-before-reset"))
    original = EventStore._cleanup

    def crash(self):
        raise RuntimeError("crash after DB commit before cleanup")

    monkeypatch.setattr(EventStore, "_cleanup", crash)
    with pytest.raises(RuntimeError, match="before cleanup"):
        EventStore(tmp_path).reset(lambda: [])
    assert checkpoint(tmp_path)["epoch"] == fence_epoch(tmp_path)
    assert fence_epoch(tmp_path) != old_epoch
    report = event("usage", session_id="after-reset", usage_id="message", input_tokens=30, output_tokens=10)
    publish(tmp_path, report)
    publish(tmp_path, report)
    publish(tmp_path, event(session_id="after-reset"))
    monkeypatch.setattr(EventStore, "_cleanup", original)
    snapshot = consume(tmp_path)
    assert snapshot["progress"]["stats"]["tools"] == 1
    assert snapshot["usage"]["totals"]["reports"] == 1
    assert snapshot["usage"]["totals"]["total_tokens"] == 40
    assert not old_ready.exists()
    assert not list((tmp_path / "inbox").glob("*.json"))


def test_legacy_append_after_reset_intent_survives_cleanup(tmp_path, monkeypatch):
    legacy = tmp_path / "events.jsonl"
    legacy.write_text(json.dumps(event()) + "\n")

    def read_legacy():
        return [json.loads(line) for line in legacy.read_text().splitlines()] if legacy.exists() else []

    consume(tmp_path, read_legacy)
    old_epoch = fence_epoch(tmp_path)
    original = EventStore._save
    appended = False

    def append_after_intent(db, data, original_data=None):
        nonlocal appended
        if data["epoch"] != old_epoch and not appended:
            assert fence_epoch(tmp_path) != old_epoch
            appended = True
            with legacy.open("a") as stream:
                stream.write(json.dumps(event(session_id="legacy-after-reset")) + "\n")
        return original(db, data, original_data)

    monkeypatch.setattr(EventStore, "_save", staticmethod(append_after_intent))
    EventStore(tmp_path).reset(read_legacy)
    assert appended
    assert legacy.exists()
    snapshot = consume(tmp_path, read_legacy)
    assert snapshot["progress"]["stats"]["tools"] == 1
    assert [record["session_id"] for record in snapshot["events"]] == ["legacy-after-reset"]
    assert consume(tmp_path, read_legacy)["progress"] == snapshot["progress"]


def test_history_read_rolls_a_published_reset_forward_before_returning_raw_rows(tmp_path, monkeypatch):
    publish(tmp_path, event())
    consume(tmp_path)
    original = EventStore._save

    def crash(db, data, original_data=None):
        raise RuntimeError("crash before reset DB save")

    monkeypatch.setattr(EventStore, "_save", staticmethod(crash))
    with pytest.raises(RuntimeError, match="before reset"):
        EventStore(tmp_path).reset(lambda: [])
    monkeypatch.setattr(EventStore, "_save", staticmethod(original))
    assert EventStore(tmp_path).history() == []
    assert checkpoint(tmp_path)["epoch"] == fence_epoch(tmp_path)


def test_reset_cursor_retries_a_legacy_append_during_snapshot_capture(tmp_path):
    legacy = tmp_path / "events.jsonl"

    def append(session):
        with legacy.open("a") as stream:
            stream.write(json.dumps(event(session_id=session)) + "\n")

    def read_legacy():
        return [json.loads(line) for line in legacy.read_text().splitlines()]

    append("before")
    consume(tmp_path, read_legacy)
    raced = False

    def racing_read():
        nonlocal raced
        snapshot = read_legacy()
        if not raced:
            raced = True
            append("also-before-fence")
        return snapshot

    EventStore(tmp_path).reset(racing_read)
    assert consume(tmp_path, read_legacy)["progress"]["stats"]["tools"] == 0
    append("after-reset")
    snapshot = consume(tmp_path, read_legacy)
    assert snapshot["progress"]["stats"]["tools"] == 1
    assert [record["session_id"] for record in snapshot["events"]] == ["after-reset"]


def test_busy_legacy_snapshot_aborts_before_publishing_a_reset(tmp_path):
    legacy = tmp_path / "events.jsonl"
    legacy.write_text(json.dumps(event()) + "\n")

    def reader():
        return [json.loads(line) for line in legacy.read_text().splitlines()]

    before = consume(tmp_path, reader)
    epoch = fence_epoch(tmp_path)

    def busy_reader():
        snapshot = reader()
        with legacy.open("a") as stream:
            stream.write(json.dumps(event(session_id="writer-active")) + "\n")
        return snapshot

    with pytest.raises(RuntimeError, match="Legacy log changed"):
        EventStore(tmp_path).reset(busy_reader)
    assert fence_epoch(tmp_path) == epoch
    assert checkpoint(tmp_path)["progress"]["xp"] == before["progress"]["xp"]
    assert len(EventStore(tmp_path).history()) == 1
