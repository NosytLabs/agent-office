"""Measured storage health and recoverable, fair immutable-input retries."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import sqlite3

import pytest

import event_store
from event_store import EventStore


def publish(directory, order, *, writer="a", sequence=None, **changes):
    inbox = directory / "inbox"
    inbox.mkdir(exist_ok=True)
    payload = {"event": "session_start", "session_id": "office-a",
               "platform": "opencode", "ts": 1000, **changes}
    path = inbox / f"{order:020d}-{writer * 32}-{sequence or order:012d}.json"
    path.write_text(json.dumps({"version": 1, "epoch": "initial", "event": payload}),
                    encoding="utf-8")
    return path


def consume(directory, now=1000, **options):
    return EventStore(directory).consume(lambda: [], now, **options)


def unreadable(monkeypatch, paths):
    original = Path.read_text
    def read(path, *args, **kwargs):
        if path in paths:
            raise PermissionError("injected read denial")
        return original(path, *args, **kwargs)
    monkeypatch.setattr(Path, "read_text", read)


def test_acknowledged_files_are_measured_until_cleanup_recovers(tmp_path, monkeypatch):
    ready = publish(tmp_path, 1, event="usage", usage_id="message-1",
                    input_tokens=100, output_tokens=40, cost_usd=0.0123)
    bytes_on_disk = ready.stat().st_size
    original = Path.unlink
    def unlink(path, *args, **kwargs):
        if path == ready:
            raise PermissionError("injected cleanup denial")
        return original(path, *args, **kwargs)
    with monkeypatch.context() as failure:
        failure.setattr(Path, "unlink", unlink)
        before = consume(tmp_path)
        after_restart = consume(tmp_path, 1001)
        tracking = after_restart["tracking"]
        assert tracking["cleanup_pending"] == 1
        assert tracking["cleanup_pending_bytes"] == bytes_on_disk
        assert tracking["backlog"] == tracking["backlog_bytes"] == 0
        assert tracking["inbox_files"] == 1
        assert tracking["inbox_bytes"] == bytes_on_disk
        assert tracking["usage_units"] == 1
        assert after_restart["progress"] == before["progress"]
        assert after_restart["usage"] == before["usage"]
        assert tracking["received"] == 1
        assert ready.exists()
    recovered = consume(tmp_path, 1002)
    assert recovered["tracking"]["cleanup_pending"] == 0
    assert recovered["tracking"]["cleanup_pending_bytes"] == 0
    assert recovered["tracking"]["inbox_files"] == 0
    assert recovered["tracking"]["inbox_bytes"] == 0
    assert recovered["usage"] == before["usage"]
    assert not ready.exists()
    with sqlite3.connect(tmp_path / "office.sqlite3") as db:
        assert db.execute("SELECT COUNT(*) FROM receipts").fetchone()[0] == 0


def test_inventory_counts_pending_temporary_and_other_entries_without_target_sizes(tmp_path, monkeypatch):
    monkeypatch.setattr(event_store, "MAX_BATCH", 2)
    publish(tmp_path, 1)
    publish(tmp_path, 2)
    pending = publish(tmp_path, 3)
    pending_bytes = pending.stat().st_size
    inbox = tmp_path / "inbox"
    temporary = inbox / ".incomplete.tmp"
    temporary.write_bytes(b"pending")
    other = inbox / "notes.txt"
    other.write_bytes(b"note")
    target = tmp_path / "outside-large"
    target.write_bytes(b"x" * 1000000)
    link = inbox / "outside-link"
    link.symlink_to(target)
    link_bytes = link.lstat().st_size
    nested = inbox / "nested"
    nested.mkdir()
    (nested / "ignored.tmp").write_bytes(b"nested-file")
    tracking = consume(tmp_path)["tracking"]
    assert tracking["backlog"] == 1
    assert tracking["backlog_bytes"] == pending_bytes
    assert tracking["cleanup_pending"] == 0
    assert tracking["temporary_files"] == 1
    assert tracking["temporary_bytes"] == 7
    assert tracking["inbox_files"] == 4
    assert tracking["inbox_bytes"] == pending_bytes + 7 + 4 + link_bytes
    assert tracking["measurement_errors"] == []
    assert temporary.read_bytes() == b"pending"
    assert other.read_bytes() == b"note"
    assert target.stat().st_size == 1000000


def test_usage_unit_counter_survives_duplicates_corrections_prune_and_reset(tmp_path):
    publish(tmp_path, 1, event="usage", usage_id="report", input_tokens=100, output_tokens=40)
    publish(tmp_path, 2, event="usage", usage_id="report", input_tokens=100, output_tokens=40)
    first = consume(tmp_path)
    assert first["tracking"]["usage_units"] == 1
    publish(tmp_path, 3, event="usage", usage_id="report", input_tokens=100, output_tokens=50)
    corrected = consume(tmp_path)
    assert corrected["usage"]["totals"]["total_tokens"] == 150
    assert corrected["tracking"]["usage_units"] == 1
    EventStore(tmp_path).prune_history()
    assert consume(tmp_path)["tracking"]["usage_units"] == 1
    with sqlite3.connect(tmp_path / "office.sqlite3") as db:
        assert db.execute("SELECT COUNT(*) FROM usage_units").fetchone()[0] == 1
    EventStore(tmp_path).reset(lambda: [])
    assert consume(tmp_path)["tracking"]["usage_units"] == 0
    with sqlite3.connect(tmp_path / "office.sqlite3") as db:
        assert db.execute("SELECT COUNT(*) FROM usage_units").fetchone()[0] == 0


def test_missing_storage_is_known_zero_and_legacy_size_counts_bytes(tmp_path):
    first = consume(tmp_path)["tracking"]
    assert first["inbox_files"] == first["inbox_bytes"] == 0
    assert first["legacy_log"] is False
    assert first["legacy_log_bytes"] == 0
    legacy = tmp_path / "events.jsonl"
    legacy.write_text("fish 🐟\n", encoding="utf-8")
    after = consume(tmp_path)["tracking"]
    assert after["legacy_log"] is True
    assert after["legacy_log_bytes"] == 10
    assert legacy.read_text(encoding="utf-8") == "fish 🐟\n"


def test_failed_entry_stat_reports_unknown_instead_of_a_partial_total(tmp_path, monkeypatch):
    consume(tmp_path)
    inbox = tmp_path / "inbox"
    inbox.mkdir()
    temporary = inbox / ".incomplete.tmp"
    temporary.write_bytes(b"pending")
    original = Path.stat
    def stat(path, *args, **kwargs):
        if path == temporary:
            raise PermissionError("injected entry stat denial")
        return original(path, *args, **kwargs)
    with monkeypatch.context() as failure:
        failure.setattr(Path, "stat", stat)
        tracking = consume(tmp_path)["tracking"]
    assert tracking["inbox_files"] is None
    assert tracking["inbox_bytes"] is None
    assert tracking["temporary_files"] is None
    assert tracking["temporary_bytes"] is None
    assert tracking["backlog"] == tracking["backlog_bytes"] == 0
    assert "inbox" in tracking["measurement_errors"]
    assert temporary.read_bytes() == b"pending"


def test_failed_directory_inventory_preserves_inputs_and_marks_unknown(tmp_path, monkeypatch):
    before = consume(tmp_path)
    ready = publish(tmp_path, 1)
    original = os.scandir
    def scandir(path):
        if Path(path) == tmp_path / "inbox":
            raise PermissionError("injected directory read denial")
        return original(path)
    with monkeypatch.context() as failure:
        failure.setattr(os, "scandir", scandir)
        after = consume(tmp_path)
    for key in ("backlog", "backlog_bytes", "cleanup_pending", "cleanup_pending_bytes",
                "inbox_files", "inbox_bytes", "temporary_files", "temporary_bytes", "retrying_files"):
        assert after["tracking"][key] is None
    assert "inbox" in after["tracking"]["measurement_errors"]
    assert after["progress"] == before["progress"]
    assert ready.exists()
    assert consume(tmp_path)["tracking"]["received"] == 1


def test_directory_disappearing_mid_inventory_cannot_report_a_partial_total(tmp_path, monkeypatch):
    consume(tmp_path)
    inbox = tmp_path / "inbox"
    inbox.mkdir()
    (inbox / ".incomplete.tmp").write_bytes(b"pending")
    original = os.scandir
    @contextmanager
    def interrupted(path):
        with original(path) as entries:
            def partial():
                yield next(entries)
                raise FileNotFoundError("directory vanished during iteration")
            yield partial()
    def scandir(path):
        return interrupted(path) if Path(path) == inbox else original(path)
    monkeypatch.setattr(os, "scandir", scandir)
    tracking = consume(tmp_path)["tracking"]
    assert tracking["inbox_files"] is None
    assert tracking["inbox_bytes"] is None
    assert tracking["temporary_bytes"] is None
    assert "inbox" in tracking["measurement_errors"]


def test_database_size_failure_does_not_report_zero_or_break_ingestion(tmp_path, monkeypatch):
    consume(tmp_path)
    ready = publish(tmp_path, 1)
    original = Path.stat
    def stat(path, *args, **kwargs):
        if path == tmp_path / "office.sqlite3":
            raise PermissionError("injected database stat denial")
        return original(path, *args, **kwargs)
    monkeypatch.setattr(Path, "stat", stat)
    after = consume(tmp_path)
    assert after["tracking"]["database_bytes"] is None
    assert "database" in after["tracking"]["measurement_errors"]
    assert after["tracking"]["received"] == 1
    assert not ready.exists()


def test_legacy_stat_failure_preserves_cursor_while_other_inputs_are_consumed(tmp_path, monkeypatch):
    legacy = tmp_path / "events.jsonl"
    legacy.write_text(json.dumps({"event": "session_start", "session_id": "legacy", "ts": 999}) + "\n")
    read = lambda: [json.loads(legacy.read_text())]
    before = EventStore(tmp_path).consume(read, 1000)
    publish(tmp_path, 1, session_id="new")
    original = Path.stat
    def stat(path, *args, **kwargs):
        if path == legacy:
            raise PermissionError("injected legacy stat denial")
        return original(path, *args, **kwargs)
    with monkeypatch.context() as failure:
        failure.setattr(Path, "stat", stat)
        after = EventStore(tmp_path).consume(read, 1001)
    assert after["tracking"]["legacy_log_bytes"] is None
    assert after["tracking"]["legacy_log"] is None
    assert "legacy_log" in after["tracking"]["measurement_errors"]
    assert after["tracking"]["received"] == before["tracking"]["received"] + 1
    assert {agent["id"] for agent in after["agents"]} == {"legacy", "new"}
    recovered = EventStore(tmp_path).consume(read, 1002)
    assert recovered["tracking"]["received"] == 2
    assert recovered["progress"] == after["progress"]


@pytest.mark.parametrize("batch", [1, 2, 8])
def test_unreadable_early_batch_does_not_starve_other_writers(tmp_path, monkeypatch, batch):
    monkeypatch.setattr(event_store, "MAX_BATCH", batch)
    blocked = {publish(tmp_path, 1, writer="a"), publish(tmp_path, 2, writer="b")}
    publish(tmp_path, 3, writer="c", session_id="healthy", title="First title")
    publish(tmp_path, 4, writer="c", session_id="healthy", event="session_update", title="Latest title")
    unreadable(monkeypatch, blocked)
    consume(tmp_path, 1000)
    # A restart and a clock jump making every retry due must still give fresh
    # writers capacity. Eligible events from a healthy writer retain order.
    for now in range(1100, 1900, 100):
        state = consume(tmp_path, now)
    assert state["tracking"]["received"] == 2
    assert state["agents"][0]["label"] == "Latest title"
    assert state["tracking"]["backlog"] == 2
    assert state["tracking"]["retrying_files"] == 2
    assert all(path.exists() for path in blocked)


def test_writer_barrier_survives_restart_and_recovers_in_source_order(tmp_path, monkeypatch):
    monkeypatch.setattr(event_store, "MAX_BATCH", 2)
    blocked = publish(tmp_path, 1, writer="a", session_id="ordered")
    later = publish(tmp_path, 2, writer="a", event="tool_start", session_id="ordered",
                    tool_name="Read", call_id="read")
    publish(tmp_path, 3, writer="b", session_id="healthy")
    with monkeypatch.context() as failure:
        unreadable(failure, {blocked})
        first = consume(tmp_path, 1000)
        after_restart = consume(tmp_path, 1001)
        assert first["tracking"]["received"] == 0
        assert {a["id"] for a in after_restart["agents"]} == {"healthy"}
        assert after_restart["progress"]["stats"]["tools"] == 0
        assert blocked.exists() and later.exists()
    recovered_first = consume(tmp_path, 1010)
    assert next(a for a in recovered_first["agents"] if a["id"] == "ordered")["status"] == "idle"
    recovered_later = consume(tmp_path, 1011)
    ordered = next(a for a in recovered_later["agents"] if a["id"] == "ordered")
    assert (ordered["status"], ordered["tool"]) == ("working", "Read")
    assert recovered_later["tracking"]["received"] == 3
    assert recovered_later["tracking"]["retrying_files"] == 0
    assert recovered_later["progress"]["stats"]["sessions"] == 2
    assert recovered_later["progress"]["stats"]["tools"] == 1
    again = consume(tmp_path, 1012)
    assert again["progress"] == recovered_later["progress"]
    assert not blocked.exists() and not later.exists()


def test_recovered_usage_and_later_correction_never_apply_backwards_or_duplicate(tmp_path, monkeypatch):
    monkeypatch.setattr(event_store, "MAX_BATCH", 2)
    fields = {"event": "usage", "usage_id": "same-request", "input_tokens": 100}
    blocked = publish(tmp_path, 1, writer="a", output_tokens=40, **fields)
    publish(tmp_path, 2, writer="a", output_tokens=50, **fields)
    publish(tmp_path, 3, writer="b", session_id="healthy")
    with monkeypatch.context() as failure:
        unreadable(failure, {blocked})
        consume(tmp_path, 1000)
        before_recovery = consume(tmp_path, 1001)
        assert before_recovery["usage"]["totals"]["reports"] == 0
    first = consume(tmp_path, 1010)
    assert first["usage"]["totals"]["total_tokens"] == 140
    corrected = consume(tmp_path, 1011)
    assert corrected["usage"]["totals"]["total_tokens"] == 150
    assert corrected["tracking"]["usage_units"] == 1
    assert corrected["tracking"]["received"] == 3
    assert corrected["progress"]["stats"]["sessions"] == 1
    assert consume(tmp_path, 1012)["usage"] == corrected["usage"]


def test_missing_blocked_file_releases_writer_without_retaining_retry_metadata(tmp_path, monkeypatch):
    blocked = publish(tmp_path, 1, writer="a")
    with monkeypatch.context() as failure:
        unreadable(failure, {blocked})
        assert consume(tmp_path)["tracking"]["retrying_files"] == 1
    blocked.unlink()
    publish(tmp_path, 2, writer="a", title="Recovered writer")
    recovered = consume(tmp_path, 1001)
    assert recovered["tracking"]["retrying_files"] == 0
    assert recovered["agents"][0]["label"] == "Recovered writer"
    with sqlite3.connect(tmp_path / "office.sqlite3") as db:
        assert db.execute("SELECT COUNT(*) FROM inbox_retries").fetchone()[0] == 0


def test_failed_checkpoint_cannot_commit_retry_state_or_acknowledgements(tmp_path, monkeypatch):
    consume(tmp_path)
    blocked = publish(tmp_path, 1, writer="a")
    valid = publish(tmp_path, 2, writer="b", session_id="healthy")
    def fail(*args, **kwargs):
        raise RuntimeError("injected checkpoint failure")
    with monkeypatch.context() as failure:
        unreadable(failure, {blocked})
        failure.setattr(EventStore, "_save", staticmethod(fail))
        with pytest.raises(RuntimeError, match="checkpoint failure"):
            consume(tmp_path)
    with sqlite3.connect(tmp_path / "office.sqlite3") as db:
        for table in ("inbox_retries", "receipts", "history"):
            assert db.execute("SELECT COUNT(*) FROM " + table).fetchone()[0] == 0
    assert blocked.exists() and valid.exists()
    recovered = consume(tmp_path)
    assert recovered["tracking"]["received"] == 2
    assert recovered["tracking"]["retrying_files"] == 0
    assert recovered["progress"]["stats"]["sessions"] == 2
