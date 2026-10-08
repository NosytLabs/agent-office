"""Explicit physical compaction preserves every observer/accounting boundary."""
import hashlib
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import time

import pytest

from event_inbox import read_epoch
from event_store import EventStore


ROOT = Path(__file__).resolve().parents[1]


def publish(directory, order, **event):
    inbox = directory / "inbox"
    inbox.mkdir(exist_ok=True)
    target = inbox / f"{order:020d}-maintenance.json"
    target.write_text(json.dumps({"version": 1, "epoch": read_epoch(directory),
                                  "event": {"ts": 1000, **event}}))
    return target


def rows(directory):
    with closing(sqlite3.connect(directory / "office.sqlite3")) as db:
        tables = [row[0] for row in db.execute(
            "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")]
        return {table: sorted(db.execute('SELECT * FROM "' + table + '"'), key=repr)
                for table in tables}


def usage(index, large=False):
    return {"event": "usage", "platform": "opencode", "session_id": "a",
            "usage_id": f"unit-{index:04d}", "input_tokens": 100,
            "output_tokens": 50, "cost_usd": 0.01,
            "model": "m" * (256 if large else 1),
            "provider": "p" * (256 if large else 1),
            "cost_source": "s" * (256 if large else 1)}


def fragmented(directory):
    store = EventStore(directory)
    for large, start in ((True, 0), (False, 1000)):
        for index in range(400):
            publish(directory, start + index, **usage(index, large))
        store.consume(lambda: [], 1000)
    store.prune_history()
    return store


def cli(directory, *arguments, env=None):
    return subprocess.run([sys.executable, str(ROOT / "tools" / "maintain.py"),
                           "--directory", str(directory), *arguments],
                          capture_output=True, text=True, timeout=10, env=env)


def test_diagnostic_missing_directory_does_not_create_an_office(tmp_path):
    directory = tmp_path / "absent"
    report = EventStore(directory).storage_report()
    assert report["database_exists"] is False
    assert report["sqlite"] is None
    assert report["database_total_bytes"] == 0
    assert report["measurement_errors"] == []
    assert not directory.exists()


def test_diagnostic_reports_pages_and_sidecars_without_draining_or_writing(tmp_path):
    store = EventStore(tmp_path)
    store.consume(lambda: [], 1000)
    pending = publish(tmp_path, 1, event="tool_start", session_id="a", tool_name="Read")
    before = store.path.read_bytes()
    report = store.storage_report()
    assert report["database_exists"] is True
    assert report["files"]["database_bytes"] == len(before)
    assert report["files"]["wal_bytes"] == report["files"]["shm_bytes"] == 0
    assert report["files"]["journal_bytes"] == 0
    assert report["database_total_bytes"] == len(before)
    assert report["sqlite"]["journal_mode"] == "delete"
    assert report["sqlite"]["auto_vacuum"] == "full"
    assert report["sqlite"]["logical_bytes"] == len(before)
    assert report["sqlite"]["freelist_bytes"] == 0
    assert store.path.read_bytes() == before
    assert pending.exists()


def test_compact_reclaims_partial_pages_without_losing_observer_rows(tmp_path):
    store = fragmented(tmp_path)
    publish(tmp_path, 2000, event="approval_request", session_id="a", platform="opencode",
            request_id="waiting", command="Approve?")
    publish(tmp_path, 2001, event="tasks_update", session_id="a", platform="opencode",
            task_source="opencode.todo", task_capture_id="capture-a", task_sequence=2,
            tasks=[{"id": "todo", "content": "Still pending", "status": "pending"}])
    state = store.consume(lambda: [], 1000)
    assert state["tasks"][0]["tasks"][0]["status"] == "pending"
    pending = publish(tmp_path, 2002, event="tool_start", session_id="next", tool_name="Read")
    for name, content in (("events.jsonl", "keep legacy bytes\n"),
                          ("settings.json", "{unreadable settings"),
                          ("inbox/.unfinished.tmp", "incomplete"),
                          ("office.sqlite3.backup", "unknown sidecar")):
        (tmp_path / name).write_text(content)
    with store._transaction() as db:
        db.execute("INSERT INTO receipts VALUES ('acknowledged.json')")
        db.execute("INSERT INTO inbox_retries VALUES ('retry.json', 2000)")
    before_rows = rows(tmp_path)
    protected = {path: path.read_bytes() for path in tmp_path.rglob("*")
                 if path.is_file() and path != store.path}
    result = store.compact()
    assert result["status"] == "compacted"
    assert result["before"]["sqlite"]["freelist_count"] == 0
    assert result["after"]["files"]["database_bytes"] < result["before"]["files"]["database_bytes"]
    assert result["reclaimed_bytes"] > 0
    assert rows(tmp_path) == before_rows
    assert all(path.read_bytes() == data for path, data in protected.items())
    assert pending.exists()
    # Replay and a correction still use the original durable identities.
    (tmp_path / "events.jsonl").unlink()
    publish(tmp_path, 2003, **usage(0))
    publish(tmp_path, 2004, **{**usage(1), "output_tokens": 70})
    after = store.consume(lambda: [], 1000)
    assert after["usage"]["totals"]["reports"] == 400
    assert after["usage"]["totals"]["total_tokens"] == 60020
    assert after["tasks"] == state["tasks"]
    assert next(a for a in after["agents"] if a["id"] == "a")["status"] == "waiting"


def test_compact_preserves_pending_reset_intent_and_new_epoch_inbox(tmp_path, monkeypatch):
    store = EventStore(tmp_path)
    publish(tmp_path, 1, event="tool_start", session_id="a", tool_name="Read")
    store.consume(lambda: [], 1000)
    with monkeypatch.context() as failure:
        def crash(*args):
            raise RuntimeError("after reset fence")
        failure.setattr(store, "_apply_reset", crash)
        with pytest.raises(RuntimeError, match="reset fence"):
            store.reset(lambda: [])
    pending = publish(tmp_path, 2, event="tool_start", session_id="new", tool_name="Read")
    intent = store.epoch_path.read_bytes()
    before = rows(tmp_path)
    store.compact()
    assert rows(tmp_path) == before
    assert store.epoch_path.read_bytes() == intent
    assert pending.exists()
    recovered = store.consume(lambda: [], 1000)
    assert recovered["tracking"]["received"] == 1
    assert recovered["progress"]["stats"]["tools"] == 1
    assert recovered["agents"][0]["id"] == "new"


@pytest.mark.parametrize("journal_mode", ["delete", "wal"])
def test_compact_has_bounded_busy_failure_and_preserves_rows(tmp_path, journal_mode):
    store = EventStore(tmp_path)
    store.consume(lambda: [], 1000)
    before = rows(tmp_path)
    reader = sqlite3.connect(store.path, isolation_level=None)
    try:
        reader.execute("PRAGMA journal_mode=" + journal_mode)
        reader.execute("BEGIN")
        reader.execute("SELECT data FROM checkpoint").fetchone()
        started = time.monotonic()
        with pytest.raises(sqlite3.OperationalError, match="locked"):
            store.compact(timeout=0.03)
        assert time.monotonic() - started < 1
    finally:
        reader.rollback()
        reader.close()
    assert rows(tmp_path) == before
    assert store.compact()["status"] == "compacted"


def test_wal_diagnostic_includes_live_sidecars_and_compact_keeps_mode(tmp_path):
    store = fragmented(tmp_path)
    keeper = sqlite3.connect(store.path, isolation_level=None)
    try:
        keeper.execute("PRAGMA journal_mode=WAL")
        keeper.execute("UPDATE checkpoint SET data=data")
        report = store.storage_report()
        assert report["sqlite"]["journal_mode"] == "wal"
        for suffix, field in (("-wal", "wal_bytes"), ("-shm", "shm_bytes")):
            assert report["files"][field] == Path(str(store.path) + suffix).stat().st_size
        assert report["database_total_bytes"] == sum(report["files"].values())
    finally:
        keeper.close()
    before = rows(tmp_path)
    result = store.compact()
    assert result["after"]["sqlite"]["journal_mode"] == "wal"
    assert result["after"]["files"]["wal_bytes"] == 0
    assert rows(tmp_path) == before


@pytest.mark.parametrize("kind", ["missing", "corrupt", "foreign", "symlink", "sidecar_symlink"])
def test_compact_refuses_missing_or_unrecognized_targets(tmp_path, kind):
    store = EventStore(tmp_path)
    target = tmp_path / "do-not-touch"
    target.write_bytes(b"private bytes")
    if kind == "corrupt":
        store.path.write_bytes(b"not a sqlite database")
    elif kind == "foreign":
        with sqlite3.connect(store.path) as db:
            db.execute("CREATE TABLE unrelated (data TEXT)")
            db.execute("INSERT INTO unrelated VALUES ('keep')")
    elif kind == "symlink":
        store.path.symlink_to(target)
    elif kind == "sidecar_symlink":
        store.consume(lambda: [], 1000)
        Path(str(store.path) + "-wal").symlink_to(target)
    saved = {p: p.read_bytes() for p in tmp_path.iterdir() if p.is_file()}
    with pytest.raises((OSError, ValueError, sqlite3.Error)):
        store.compact()
    assert all(p.read_bytes() == content for p, content in saved.items())
    if kind == "missing":
        assert not store.path.exists()


def test_failed_measurement_is_unknown_not_a_partial_total(tmp_path, monkeypatch):
    store = EventStore(tmp_path)
    store.consume(lambda: [], 1000)
    original = Path.lstat
    def denied(path):
        if path == Path(str(store.path) + "-wal"):
            raise PermissionError("denied")
        return original(path)
    monkeypatch.setattr(Path, "lstat", denied)
    report = store.storage_report()
    assert report["files"]["wal_bytes"] is None
    assert report["database_total_bytes"] is None
    assert "wal" in report["measurement_errors"]


def test_compact_rejects_same_columns_without_the_declared_history_key(tmp_path):
    store = EventStore(tmp_path)
    publish(tmp_path, 1, event="tool_start", session_id="a", tool_name="Read")
    store.consume(lambda: [], 1000)
    with closing(sqlite3.connect(store.path)) as db:
        with db:
            db.execute("ALTER TABLE history RENAME TO original_history")
            db.execute("CREATE TABLE history (seq TEXT, received_at REAL NOT NULL, event TEXT NOT NULL)")
            db.execute("INSERT INTO history SELECT * FROM original_history")
            db.execute("DROP TABLE original_history")
    before = store.path.read_bytes()
    with pytest.raises(ValueError, match="Unrecognized office database schema"):
        store.compact()
    assert store.path.read_bytes() == before


def test_compact_rejects_unknown_generated_columns_before_rebuilding(tmp_path):
    store = EventStore(tmp_path)
    store.consume(lambda: [], 1000)
    with closing(sqlite3.connect(store.path)) as db:
        db.execute("ALTER TABLE history ADD COLUMN extra TEXT GENERATED ALWAYS AS (event) VIRTUAL")
    before = store.path.read_bytes()
    with pytest.raises(ValueError, match="Unrecognized office database schema"):
        store.compact()
    assert store.path.read_bytes() == before


def test_cli_diagnostic_and_explicit_compaction(tmp_path):
    store = fragmented(tmp_path)
    before = hashlib.sha256(store.path.read_bytes()).hexdigest()
    diagnostic = cli(tmp_path)
    assert diagnostic.returncode == 0, diagnostic.stderr
    assert json.loads(diagnostic.stdout)["sqlite"]["auto_vacuum"] == "full"
    assert hashlib.sha256(store.path.read_bytes()).hexdigest() == before
    compact = cli(tmp_path, "--compact")
    assert compact.returncode == 0, compact.stderr
    assert json.loads(compact.stdout)["reclaimed_bytes"] > 0


def test_cli_default_directory_and_busy_exit(tmp_path):
    env = {**os.environ, "HERMES_HOME": str(tmp_path / "hermes")}
    result = subprocess.run([sys.executable, str(ROOT / "tools" / "maintain.py")],
                            env=env, capture_output=True, text=True, timeout=5)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["directory"] == str(tmp_path / "hermes" / "pixel-office")
    assert not (tmp_path / "hermes").exists()
    store = EventStore(tmp_path)
    store.consume(lambda: [], 1000)
    with sqlite3.connect(store.path) as db:
        db.execute("BEGIN IMMEDIATE")
        busy = cli(tmp_path, "--compact", "--timeout", "0.03")
    assert busy.returncode == 2
    assert json.loads(busy.stdout)["status"] == "busy"


def test_failed_vacuum_preserves_rows_and_releases_exclusive_lock(tmp_path, monkeypatch):
    store = fragmented(tmp_path)
    before = rows(tmp_path)
    original = sqlite3.connect
    class FullDiskConnection(sqlite3.Connection):
        def execute(self, sql, *args, **kwargs):
            if sql == "VACUUM":
                raise sqlite3.OperationalError("injected disk full")
            return super().execute(sql, *args, **kwargs)
    def fail_vacuum(*args, **kwargs):
        return original(*args, **{**kwargs, "factory": FullDiskConnection})
    with monkeypatch.context() as failure:
        failure.setattr(sqlite3, "connect", fail_vacuum)
        with pytest.raises(sqlite3.OperationalError, match="disk full"):
            store.compact()
    assert rows(tmp_path) == before
    assert store.compact(timeout=0)["status"] == "compacted"


def test_cli_classifies_busy_on_python_without_sqlite_errorcode(tmp_path, monkeypatch, capsys):
    from tools import maintain
    def busy(*args, **kwargs):
        raise sqlite3.OperationalError("database is locked")
    monkeypatch.setattr(EventStore, "compact", busy)
    monkeypatch.setattr(sys, "argv", ["maintain.py", "--directory", str(tmp_path), "--compact"])
    assert maintain.main() == 2
    assert json.loads(capsys.readouterr().out)["status"] == "busy"


def test_cli_diagnostic_reports_a_busy_database_without_zeroing_its_size(tmp_path):
    store = EventStore(tmp_path)
    store.consume(lambda: [], 1000)
    with closing(sqlite3.connect(store.path, isolation_level=None)) as blocker:
        blocker.execute("BEGIN EXCLUSIVE")
        result = cli(tmp_path, "--timeout", "0.03")
    assert result.returncode == 2
    report = json.loads(result.stdout)
    assert report["sqlite"] is None
    assert report["files"]["database_bytes"] > 0
    assert "sqlite" in report["measurement_errors"]


@pytest.mark.parametrize("mode", ["delete", "wal"])
def test_compact_retains_exclusion_between_transactions_but_allows_publishers(tmp_path, monkeypatch, mode):
    store = EventStore(tmp_path)
    store.consume(lambda: [], 1000)
    with closing(sqlite3.connect(store.path, isolation_level=None)) as setup:
        setup.execute("PRAGMA journal_mode=" + mode)
    before = rows(tmp_path)
    original = sqlite3.connect
    pending = []
    class InterleavingConnection(sqlite3.Connection):
        def execute(self, sql, *args, **kwargs):
            if sql == "VACUUM":
                assert not self.in_transaction
                with closing(original(store.path, timeout=0, isolation_level=None)) as competitor:
                    with pytest.raises(sqlite3.OperationalError, match="locked"):
                        competitor.execute("BEGIN IMMEDIATE")
                pending.append(publish(tmp_path, 1, event="tool_start", session_id="new", tool_name="Read"))
            return super().execute(sql, *args, **kwargs)
    def interleaving(*args, **kwargs):
        return original(*args, **{**kwargs, "factory": InterleavingConnection})
    with monkeypatch.context() as interleave:
        interleave.setattr(sqlite3, "connect", interleaving)
        assert store.compact()["status"] == "compacted"
    assert rows(tmp_path) == before
    assert len(pending) == 1 and pending[0].exists()
    after = store.consume(lambda: [], 1000)
    assert after["progress"]["stats"]["tools"] == 1
