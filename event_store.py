"""Transactional event consumption, live checkpoints and bounded history.

Publishers own immutable inbox files. A consumer commits their effects and
receipts together, then removes acknowledged files. A crash at either side
of that boundary cannot replay an event. No consumer rewrites a shared log.
"""
from __future__ import annotations

from collections import Counter
from contextlib import contextmanager
import copy
import hashlib
import heapq
import json
import logging
import math
import os
from pathlib import Path
import sqlite3
import uuid

try:
    from . import progress
    from .state_model import StateModel
    from .usage import ensure_schema, consume_usage, snapshot_usage
except ImportError:
    import progress
    from state_model import StateModel
    from usage import ensure_schema, consume_usage, snapshot_usage

logger = logging.getLogger(__name__)
MAX_RECORD_BYTES = 256 * 1024
MAX_BATCH = 2048
DEFAULT_HISTORY_LIMIT = 1000
DEFAULT_HISTORY_DAYS = 7
DEFAULT_HISTORY_MAX_BYTES = 5 * 1024 * 1024


def valid_event(event):
    if not isinstance(event, dict):
        return None
    if not isinstance(event.get("event"), str) or not event["event"].strip():
        return None
    try:
        timestamp = float(event.get("ts") or 0)
        if not math.isfinite(timestamp):
            return None
    except (ValueError, TypeError, OverflowError):
        return None
    normalized = {**event, "ts": timestamp}
    try:
        # Python accepts NaN and lone surrogates while the browser's JSON/UTF-8
        # boundary does not. Quarantine a malformed record before the commit.
        json.dumps(normalized, ensure_ascii=False, allow_nan=False).encode("utf-8")
    except (ValueError, TypeError, UnicodeError, RecursionError):
        return None
    return normalized


def _signature(path):
    try:
        stat = path.stat()
        return [stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns]
    except FileNotFoundError:
        return None


def _fingerprint(event):
    encoded = json.dumps(event, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _digest(fingerprints):
    return hashlib.sha256("".join(fingerprints).encode("ascii")).hexdigest()


class EventStore:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.path = self.directory / "office.sqlite3"
        self.inbox = self.directory / "inbox"
        self.epoch_path = self.directory / "event-epoch"

    @contextmanager
    def _transaction(self):
        self.directory.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        try:
            # Reclaim deleted history pages rather than retaining a high-water
            # file size after the user chooses a shorter retention period.
            db.execute("PRAGMA auto_vacuum = FULL")
            db.execute("BEGIN IMMEDIATE")
            db.execute("CREATE TABLE IF NOT EXISTS checkpoint (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS receipts (name TEXT PRIMARY KEY)")
            db.execute("CREATE TABLE IF NOT EXISTS history (seq INTEGER PRIMARY KEY AUTOINCREMENT, received_at REAL NOT NULL, event TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS legacy_counts (fingerprint TEXT PRIMARY KEY, n INTEGER NOT NULL)")
            ensure_schema(db)
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def _load(self, db):
        row = db.execute("SELECT data FROM checkpoint WHERE id=1").fetchone()
        epoch, intent = self._read_fence()
        if row:
            data = json.loads(row[0])
            if data.get("version") != 1:
                raise ValueError("unsupported office checkpoint version")
            if progress.normalize_achievements(data["progress"]):
                self._save(db, data)
            if intent and intent["epoch"] != data["epoch"]:
                self._apply_reset(db, data, intent)
                return data, None
            return data, row[0]
        data = {
            "version": 1, "epoch": epoch, "model": None,
            "progress": progress.load(self.directory / "progress.json"),
            "legacy_started": False, "legacy_signature": None,
            "legacy_count": 0, "legacy_digest": _digest([]),
            "inbox_received": False, "received": 0, "invalid_records": 0,
            "recent": [],
        }
        if intent:
            self._apply_reset(db, data, intent)
        return data, None

    def _read_fence(self):
        try:
            raw = self.epoch_path.read_text(encoding="utf-8").strip()
        except FileNotFoundError:
            return "initial", None
        if not raw.startswith("{"):
            return raw or "initial", None  # Initial/plaintext v1 compatibility.
        try:
            intent = json.loads(raw)
            legacy = intent["legacy"]
            if (intent.get("version") != 1 or intent.get("reset") is not True
                    or not isinstance(intent.get("epoch"), str) or not intent["epoch"]
                    or not isinstance(legacy, dict)
                    or type(legacy.get("count")) is not int or legacy["count"] < 0
                    or not isinstance(legacy.get("digest"), str)):
                raise ValueError("invalid reset intent")
        except (ValueError, KeyError, TypeError, RecursionError) as exc:
            raise ValueError("invalid office reset intent; inputs retained") from exc
        return intent["epoch"], intent

    def _write_fence(self, value):
        encoded = json.dumps(value, separators=(",", ":")) if isinstance(value, dict) else value
        temp = self.directory / ("event-epoch." + uuid.uuid4().hex + ".tmp")
        try:
            with temp.open("w", encoding="utf-8") as handle:
                handle.write(encoded + "\n")
                handle.flush()
                os.fsync(handle.fileno())
            temp.replace(self.epoch_path)
            if hasattr(os, "O_DIRECTORY"):
                fd = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(fd)
                finally:
                    os.close(fd)
        finally:
            temp.unlink(missing_ok=True)

    def _apply_reset(self, db, data, intent):
        legacy = intent["legacy"]
        data.update(epoch=intent["epoch"], model=None, progress=progress._empty(),
                    legacy_started=True, legacy_signature=legacy.get("signature"),
                    legacy_count=legacy["count"], legacy_digest=legacy["digest"],
                    legacy_reset_guard=True, inbox_received=True, received=0,
                    invalid_records=0, recent=[])
        for table in ("history", "usage_units", "usage_totals", "legacy_counts"):
            db.execute("DELETE FROM " + table)
        self._save(db, data)

    @staticmethod
    def _save(db, data, original=None):
        encoded = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        if encoded != original:
            db.execute("INSERT INTO checkpoint(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data", (encoded,))
            return True
        return False

    def _sync_epoch(self, epoch):
        """Call only while holding the SQLite writer transaction.

        Read the epoch from that transaction, never from an old cached state:
        an earlier drain must not overwrite a subsequent reset's fence.
        """
        if self.epoch_path.exists() and self._read_fence()[0] == epoch:
            return
        self._write_fence(epoch)

    def _legacy(self, db, data, model, read_legacy, now):
        """Import old integrations without truncating their shared JSONL file.

        Append positions, not event timestamps, decide what is new after the
        initial migration. An arbitrary old-format rewrite has no stable IDs;
        conserve matching occurrences rather than inventing extra XP.
        """
        path = self.directory / "events.jsonl"
        signature = _signature(path)
        if data["legacy_started"] and signature == data["legacy_signature"]:
            return model, []
        events = read_legacy() if signature is not None else []
        if _signature(path) != signature:
            return model, []  # retry a concurrent write on the next drain
        hashes = [_fingerprint(event) for event in events]
        count = data["legacy_count"]
        first = not data["legacy_started"]
        append = len(hashes) >= count and _digest(hashes[:count]) == data["legacy_digest"]
        if first:
            fresh = events
            # Only this unknown historical boundary uses the old watermark.
            # Every later append is unambiguously new, regardless of its ts.
            progress.ingest(data["progress"], fresh)
            model.apply(events, now)
        elif append:
            fresh = events[count:]
            progress.ingest(data["progress"], fresh, new_batch=True)
            model.apply(fresh, now)
        else:
            previous = dict(db.execute("SELECT fingerprint,n FROM legacy_counts"))
            seen = Counter()
            fresh = []
            for event, identity in zip(events, hashes):
                seen[identity] += 1
                if not data.get("legacy_reset_guard") and seen[identity] > previous.get(identity, 0):
                    fresh.append(event)
            progress.ingest(data["progress"], fresh, new_batch=True)
            if not data["inbox_received"]:
                # Preserve the legacy read API's replacement semantics until
                # new publishers use the durable model. A legacy rotation may
                # never erase live state already observed through the inbox.
                model = StateModel()
                model.apply(events, now)
            else:
                model.apply(fresh, now, received_at=now)
        db.execute("DELETE FROM legacy_counts")
        db.executemany("INSERT INTO legacy_counts VALUES(?,?)", Counter(hashes).items())
        data.update(legacy_started=True, legacy_signature=signature,
                    legacy_count=len(hashes), legacy_digest=_digest(hashes),
                    legacy_reset_guard=False)
        return model, fresh

    def _ready_files(self, acknowledged=()):
        # Directory enumeration is not causal order. The filename contains a
        # publication clock and per-writer sequence separate from payload ts.
        return heapq.nsmallest(MAX_BATCH, (path for path in self.inbox.glob("*.json")
                                         if path.name not in acknowledged)) if self.inbox.exists() else []

    def _read_ready(self, path):
        if path.stat().st_size > MAX_RECORD_BYTES:
            return None
        try:
            envelope = json.loads(path.read_text(encoding="utf-8"))
        except (ValueError, UnicodeError, RecursionError):
            return None
        if not isinstance(envelope, dict) or envelope.get("version") != 1:
            return None
        event = valid_event(envelope.get("event"))
        if event is None or not isinstance(envelope.get("epoch"), str):
            return None
        return envelope["epoch"], event

    @staticmethod
    def _remember(db, data, events, now):
        db.executemany("INSERT INTO history(received_at,event) VALUES(?,?)", (
            (now, json.dumps(event, ensure_ascii=False, separators=(",", ":")))
            for event in events
        ))
        data["received"] += len(events)
        data["recent"] = (data["recent"] + events)[-30:]

    @staticmethod
    def _prune(db, data, now, limit, days, max_bytes):
        limit = limit if limit in (250, 1000, 5000) else DEFAULT_HISTORY_LIMIT
        days = days if days in (1, 7, 30) else DEFAULT_HISTORY_DAYS
        max_bytes = max_bytes if max_bytes in (1024 * 1024, 5 * 1024 * 1024, 20 * 1024 * 1024) else DEFAULT_HISTORY_MAX_BYTES
        before = db.total_changes
        db.execute("DELETE FROM history WHERE received_at < ?", (now - days * 86400,))
        db.execute("DELETE FROM history WHERE seq IN (SELECT seq FROM history ORDER BY seq DESC LIMIT -1 OFFSET ?)", (limit,))
        # Count encoded bytes, not Unicode characters. Keep the newest rows
        # that fit; source clocks never determine retention or ordering.
        db.execute("""DELETE FROM history WHERE seq IN (
            SELECT seq FROM (
                SELECT seq, SUM(LENGTH(CAST(event AS BLOB))) OVER (ORDER BY seq DESC) AS bytes
                FROM history
            ) WHERE bytes > ?
        )""", (max_bytes,))
        if db.total_changes != before:
            rows = db.execute("SELECT event FROM history ORDER BY seq DESC LIMIT 30").fetchall()
            data["recent"] = [json.loads(row[0]) for row in reversed(rows)]

    def _cleanup(self):
        """A receipt is retired only after its published file is absent."""
        with self._transaction() as db:
            for (name,) in db.execute("SELECT name FROM receipts").fetchall():
                try:
                    (self.inbox / name).unlink(missing_ok=True)
                except OSError:
                    continue
                db.execute("DELETE FROM receipts WHERE name=?", (name,))

    def _export_progress(self):
        # This backwards-compatible file is a mirror, never the ingestion
        # authority. Read a fresh transaction so a late drain cannot overwrite
        # a more recent reset or event batch with its old in-memory value.
        with self._transaction() as db:
            data, _ = self._load(db)
            progress.save(self.directory / "progress.json", data["progress"])

    def consume(self, read_legacy, now, *, history_limit=DEFAULT_HISTORY_LIMIT,
                history_days=DEFAULT_HISTORY_DAYS,
                history_max_bytes=DEFAULT_HISTORY_MAX_BYTES):
        changed = False
        with self._transaction() as db:
            data, original = self._load(db)
            self._sync_epoch(data["epoch"])
            model = StateModel(data["model"])
            model, legacy = self._legacy(db, data, model, read_legacy, now)
            self._remember(db, data, legacy, now)
            fresh = []
            acknowledged = {row[0] for row in db.execute("SELECT name FROM receipts")}
            for path in self._ready_files(acknowledged):
                try:
                    record = self._read_ready(path)
                except OSError:
                    continue  # unreadable inputs remain available for retry
                if record is None:
                    data["invalid_records"] += 1
                elif record[0] == data["epoch"]:
                    fresh.append(record[1])
                db.execute("INSERT INTO receipts(name) VALUES(?)", (path.name,))
            if fresh:
                data["inbox_received"] = True
                model.apply(fresh, now, received_at=now)
                progress.ingest(data["progress"], fresh, new_batch=True)
                self._remember(db, data, fresh, now)
            for event in (*legacy, *fresh):
                consume_usage(db, event, now)
            model.expire(now)
            visible = model.visible(now)
            session_keys = set()
            for agent in visible:
                platform = str(agent.get("platform") or "hermes").lower()
                session_keys.add((platform, agent["id"]))
                if platform in ("cli", "telegram", "gateway"):
                    session_keys.add(("hermes", agent["id"]))
            usage = snapshot_usage(db, session_keys=session_keys)
            data["progress"]["stats"]["usage_reports"] = usage["totals"]["reports"]
            progress.ingest(data["progress"], [], new_batch=True)
            progress.apply_live(data["progress"], sum(
                agent["status"] not in ("done", "gone") for agent in visible))
            data["model"] = model.dump()
            self._prune(db, data, now, history_limit, history_days, history_max_bytes)
            changed = self._save(db, data, original)
            retained = db.execute("SELECT COUNT(*) FROM history").fetchone()[0]
            retained_bytes = db.execute("SELECT COALESCE(SUM(LENGTH(CAST(event AS BLOB))),0) FROM history").fetchone()[0]
            backlog = max(0, sum(1 for _ in self.inbox.glob("*.json")) - db.execute("SELECT COUNT(*) FROM receipts").fetchone()[0])
        # Neither an unlink failure nor a mirror-file failure can undo the
        # committed checkpoint. Replayed ready files find their receipt.
        self._cleanup()
        if changed:
            self._export_progress()
        return {
            "agents": visible, "progress": progress.snapshot(data["progress"]),
            "events": copy.deepcopy(data["recent"]),
            "usage": usage,
            "tracking": {"received": data["received"], "retained": retained,
                         "retained_bytes": retained_bytes,
                         "database_bytes": self.path.stat().st_size,
                         "invalid_records": data["invalid_records"],
                         "backlog": backlog,
                         "legacy_log": (self.directory / "events.jsonl").exists()},
        }

    def history(self, limit=1000):
        limit = max(1, min(int(limit), 5000))
        with self._transaction() as db:
            self._load(db)  # Roll a published reset intent forward before reading.
            rows = db.execute("SELECT seq,received_at,event FROM history ORDER BY seq DESC LIMIT ?", (limit,)).fetchall()
        return [{**json.loads(event), "id": seq, "received_at": at} for seq, at, event in rows]

    def prune_history(self):
        with self._transaction() as db:
            data, original = self._load(db)
            count = db.execute("SELECT COUNT(*) FROM history").fetchone()[0]
            db.execute("DELETE FROM history")
            data["recent"] = []
            self._save(db, data, original)
        return count

    def reset(self, read_legacy):
        # The atomic fence is a durable reset intent and the publication
        # boundary. If the database transaction fails after publication,
        # _load rolls forward before consuming events in the new epoch.
        with self._transaction() as db:
            data, _ = self._load(db)
            path = self.directory / "events.jsonl"
            # The cursor must describe exactly the contents we fenced out.
            # Legacy publishers do not share our database lock, so an append
            # may race this snapshot. Retry before publishing any reset intent;
            # if it stays busy, preserve all existing data and let the caller
            # retry instead of guessing a boundary.
            for _ in range(8):
                signature = _signature(path)
                events = read_legacy() if signature is not None else []
                if _signature(path) == signature:
                    break
            else:
                raise RuntimeError("Legacy log changed during reset; retry after the writer is idle")
            hashes = [_fingerprint(event) for event in events]
            intent = {"version": 1, "reset": True, "epoch": uuid.uuid4().hex,
                      "legacy": {"signature": signature, "count": len(hashes),
                                 "digest": _digest(hashes)}}
            self._write_fence(intent)
            self._apply_reset(db, data, intent)
            db.executemany("INSERT INTO legacy_counts VALUES(?,?)", Counter(hashes).items())
            data["legacy_reset_guard"] = False
            self._save(db, data)
        # Never unlink a legacy writer's append target: a new append may have
        # arrived after the reset boundary. Its saved prefix prevents replay.
        self._export_progress()
        self._cleanup()
