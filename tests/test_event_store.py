"""Receipt, checkpoint, retention and reset guarantees across process restarts."""
import json
from pathlib import Path
import sqlite3
from concurrent.futures import ThreadPoolExecutor
import threading

import pytest

from event_store import EventStore
from event_inbox import read_epoch


def publish(directory, order, event, epoch=None):
    directory = Path(directory)
    inbox = directory / "inbox"
    inbox.mkdir(exist_ok=True)
    if epoch is None:
        epoch = read_epoch(directory)
    path = inbox / f"{order:020d}-writer-{order:012d}.json"
    path.write_text(json.dumps({"version": 1, "epoch": epoch, "event": event}, ensure_ascii=False), encoding="utf-8")
    return path


def event(kind="tool_start", **values):
    return {"ts": 990, "event": kind, "session_id": "a", "tool_name": "Read", **values}


def consume(directory, now=1000, **options):
    return EventStore(directory).consume(lambda: [], now, **options)


@pytest.mark.parametrize("split", [False, True])
def test_late_and_identical_timestamps_have_batch_independent_totals(tmp_path, split):
    publish(tmp_path, 1, event(ts=990.2))
    if split:
        assert consume(tmp_path)["progress"]["stats"]["tools"] == 1
    publish(tmp_path, 2, event(ts=990.1))
    publish(tmp_path, 3, event(ts=990.1))
    state = consume(tmp_path)
    assert state["progress"]["stats"]["tools"] == 3
    assert state["progress"]["stats"]["reads"] == 3
    assert consume(tmp_path)["progress"]["xp"] == state["progress"]["xp"]
    assert not list((tmp_path / "inbox").glob("*.json"))


def test_publication_order_is_independent_of_payload_clock_and_creation_order(tmp_path):
    publish(tmp_path, 2, event("tool_end", ts=989, call_id="one"))
    publish(tmp_path, 1, event(ts=991, call_id="one"))
    state = consume(tmp_path)
    assert state["agents"][0]["status"] == "thinking"
    assert [ev["event"] for ev in state["events"]] == ["tool_start", "tool_end"]


def test_failure_before_checkpoint_commit_preserves_inputs_and_no_xp(tmp_path, monkeypatch):
    ready = publish(tmp_path, 1, event())
    original = EventStore._save

    def fail(*args, **kwargs):
        raise RuntimeError("injected checkpoint failure")

    monkeypatch.setattr(EventStore, "_save", fail)
    with pytest.raises(RuntimeError, match="checkpoint failure"):
        consume(tmp_path)
    assert ready.exists()
    monkeypatch.setattr(EventStore, "_save", staticmethod(original))
    assert consume(tmp_path)["progress"]["stats"]["tools"] == 1


def test_restart_after_commit_before_cleanup_does_not_replay(tmp_path, monkeypatch):
    ready = publish(tmp_path, 1, event())
    original = EventStore._cleanup

    def crash(self):
        raise RuntimeError("injected post-commit crash")

    monkeypatch.setattr(EventStore, "_cleanup", crash)
    with pytest.raises(RuntimeError, match="post-commit"):
        consume(tmp_path)
    assert ready.exists()
    monkeypatch.setattr(EventStore, "_cleanup", original)
    state = consume(tmp_path)
    assert state["progress"]["stats"]["tools"] == 1
    assert state["tracking"]["received"] == 1
    assert not ready.exists()


def test_failed_unlink_keeps_receipt_until_file_is_removed(tmp_path, monkeypatch):
    ready = publish(tmp_path, 1, event())
    original = Path.unlink

    def locked(path, *args, **kwargs):
        if path == ready:
            raise PermissionError("locked by test")
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", locked)
    for _ in range(2):
        assert consume(tmp_path)["progress"]["stats"]["tools"] == 1
        assert ready.exists()
    monkeypatch.setattr(Path, "unlink", original)
    assert consume(tmp_path)["progress"]["stats"]["tools"] == 1
    with sqlite3.connect(tmp_path / "office.sqlite3") as db:
        assert db.execute("SELECT COUNT(*) FROM receipts").fetchone()[0] == 0


def test_retention_and_restart_preserve_parallel_tools_and_unanswered_prompts(tmp_path):
    setup = [
        event("session_start", title="Review deployment", parent_session_id="boss"),
        event(call_id="read"), event(call_id="run", tool_name="Bash"),
        event("approval_request", request_id="older", call_id="run", command="Approve older?"),
        event("approval_request", request_id="newer", command="Approve newer?"),
    ]
    for i, record in enumerate(setup):
        publish(tmp_path, i, record)
    consume(tmp_path)
    for i in range(400):
        publish(tmp_path, 10 + i, event(session_id="busy", preview="x" * 1500))
    state = consume(tmp_path, history_limit=250)
    assert state["tracking"]["retained"] == 250
    assert state["progress"]["stats"]["tools"] == 402
    publish(tmp_path, 500, event("approval_response", request_id="newer", choice="once"))
    publish(tmp_path, 501, event("tool_end", call_id="read"))
    state = consume(tmp_path, now=5000, history_limit=250)
    waiting = next(a for a in state["agents"] if a["id"] == "a")
    assert waiting["status"] == "waiting"
    assert waiting["detail"] == "Approve older?"
    assert waiting["label"] == "Review deployment"
    assert waiting["parent"] == "boss"


def test_reset_fences_a_prepared_old_record_and_accepts_old_payload_time(tmp_path):
    publish(tmp_path, 1, event())
    consume(tmp_path)
    old_epoch = (tmp_path / "event-epoch").read_text().strip()
    EventStore(tmp_path).reset(lambda: [])
    # An old publisher can finish its atomic rename after the reset returns.
    publish(tmp_path, 2, event(), epoch=old_epoch)
    publish(tmp_path, 3, event(ts=100))
    state = consume(tmp_path)
    assert state["progress"]["stats"]["tools"] == 1
    assert state["tracking"]["received"] == 1


def test_prune_history_preserves_xp_and_pending_state(tmp_path):
    publish(tmp_path, 1, event("approval_request", request_id="pending", command="Approve?"))
    before = consume(tmp_path)
    assert EventStore(tmp_path).prune_history() == 1
    after = consume(tmp_path)
    assert after["events"] == []
    assert after["progress"] == before["progress"]
    assert after["agents"][0]["status"] == "waiting"


def test_retention_uses_receive_time_instead_of_skewed_producer_time(tmp_path):
    publish(tmp_path, 1, event(ts=99999999999))
    consume(tmp_path, history_days=1)
    after = consume(tmp_path, now=1000 + 86401, history_days=1)
    assert after["tracking"]["retained"] == 0
    assert after["progress"]["stats"]["tools"] == 1


def test_byte_retention_counts_utf8_payload_and_preserves_observed_totals(tmp_path):
    for index in range(12):
        publish(tmp_path, index, event(preview="🐟" * 24000, call_id=str(index)))
    state = consume(tmp_path, history_max_bytes=1024 * 1024)
    assert 0 < state["tracking"]["retained"] < 12
    assert state["tracking"]["retained_bytes"] <= 1024 * 1024
    assert state["progress"]["stats"]["tools"] == 12
    saved = EventStore(tmp_path).history()
    assert saved[0]["call_id"] == "11"
    assert sum(len(json.dumps({k: v for k, v in row.items() if k not in ("id", "received_at")},
                              ensure_ascii=False, separators=(",", ":")).encode())
               for row in saved) == state["tracking"]["retained_bytes"]
    EventStore(tmp_path).prune_history()
    assert consume(tmp_path)["tracking"]["retained_bytes"] == 0


@pytest.mark.parametrize("source_ts", [1, 99999999999])
def test_source_clock_skew_does_not_control_sprite_lifetime(tmp_path, source_ts):
    publish(tmp_path, 1, event("session_start", ts=source_ts))
    state = consume(tmp_path, now=10000)
    assert state["agents"][0]["status"] == "idle"
    assert state["agents"][0]["idle_s"] == 0
    assert state["agents"][0]["updated_at"] == source_ts
    publish(tmp_path, 2, event("session_end", ts=source_ts))
    assert consume(tmp_path, now=10001)["agents"][0]["status"] == "gone"
    assert consume(tmp_path, now=10022)["agents"] == []
    consume(tmp_path, now=12000)
    publish(tmp_path, 3, event("tool_end", ts=source_ts, call_id="late"))
    assert consume(tmp_path, now=12001)["agents"] == []


def test_partial_and_invalid_inputs_do_not_block_a_valid_record(tmp_path):
    ready = publish(tmp_path, 1, event())
    (ready.parent / "partial.tmp").write_text('{"version":')
    (ready.parent / "invalid.json").write_text('{"version":')
    state = consume(tmp_path)
    assert state["progress"]["stats"]["tools"] == 1
    assert state["tracking"]["invalid_records"] == 1
    assert (ready.parent / "partial.tmp").exists()
    assert consume(tmp_path)["tracking"]["invalid_records"] == 1


def test_non_json_numbers_and_invalid_unicode_do_not_poison_the_state_api(tmp_path):
    publish(tmp_path, 1, event(extra=float("nan")))
    publish(tmp_path, 2, event(extra=float("inf")))
    ready = publish(tmp_path, 3, event())
    bad = json.dumps({"version": 1, "epoch": "initial", "event": event(preview="\ud800")})
    (ready.parent / "bad-unicode.json").write_text(bad)
    (ready.parent / "too-deep.json").write_text("[" * 20000 + "0" + "]" * 20000)
    snapshot = consume(tmp_path)
    assert snapshot["tracking"]["invalid_records"] == 4
    assert snapshot["progress"]["stats"]["tools"] == 1
    json.dumps(snapshot, allow_nan=False).encode("utf-8")


@pytest.mark.parametrize("container", ["list", "object"])
def test_deep_valid_json_is_quarantined_without_blocking_other_receipts(tmp_path, container):
    nested = "leaf"
    for _ in range(600):
        nested = [nested] if container == "list" else {"nested": nested}
    # This is valid, modestly sized JSON. Its structure used to pass the
    # decoder and serializer, then exhaust recursion while copying live state.
    publish(tmp_path, 1, event(session_id="too-deep", extra=nested))
    publish(tmp_path, 2, event(session_id="healthy", call_id="observed"))

    state = consume(tmp_path)
    assert state["tracking"]["invalid_records"] == 1
    assert state["tracking"]["received"] == 1
    assert state["progress"]["stats"]["tools"] == 1
    assert [agent["id"] for agent in state["agents"]] == ["healthy"]
    assert [record["session_id"] for record in EventStore(tmp_path).history()] == ["healthy"]
    json.dumps(state, allow_nan=False).encode("utf-8")
    assert not list((tmp_path / "inbox").glob("*.json"))
    assert consume(tmp_path)["progress"] == state["progress"]


def test_competing_consumers_commit_each_receipt_only_once(tmp_path):
    for index in range(40):
        publish(tmp_path, index, event(call_id=str(index)))
    ready = threading.Barrier(2)

    def competing():
        ready.wait(timeout=5)
        return consume(tmp_path)

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(competing) for _ in range(2)]
        for future in futures:
            assert future.result(timeout=10)["progress"]["stats"]["tools"] == 40
    final = consume(tmp_path)
    assert final["tracking"]["received"] == final["tracking"]["retained"] == 40
    assert json.loads((tmp_path / "progress.json").read_text())["stats"]["tools"] == 40


def test_theme_changes_leave_authoritative_progress_and_legacy_statistics_unchanged(tmp_path, monkeypatch):
    import __init__ as plugin

    monkeypatch.setattr(plugin, "_office_dir", lambda: tmp_path)
    publish(tmp_path, 1, event())
    consume(tmp_path)
    with sqlite3.connect(tmp_path / "office.sqlite3") as db:
        checkpoint = json.loads(db.execute("SELECT data FROM checkpoint WHERE id=1").fetchone()[0])
        checkpoint["progress"]["stats"]["theme_switches"] = 3
        checkpoint["progress"]["xp"] = 80
        encoded = json.dumps(checkpoint)
        db.execute("UPDATE checkpoint SET data=? WHERE id=1", (encoded,))
    mirror = (tmp_path / "progress.json").read_bytes()
    for theme in ("amber", "midnight", "default", "amber", "default"):
        plugin._save_settings({"theme": theme})
    assert plugin._load_settings()["theme"] == "default"
    with sqlite3.connect(tmp_path / "office.sqlite3") as db:
        assert db.execute("SELECT data FROM checkpoint WHERE id=1").fetchone()[0] == encoded
    assert (tmp_path / "progress.json").read_bytes() == mirror


def test_loading_retired_achievement_records_migrates_the_authoritative_checkpoint(tmp_path):
    consume(tmp_path)
    with sqlite3.connect(tmp_path / "office.sqlite3") as db:
        checkpoint = json.loads(db.execute("SELECT data FROM checkpoint WHERE id=1").fetchone()[0])
        saved = checkpoint["progress"]
        saved["xp"] = 80
        saved["stats"].update(tools=17, errors=6, theme_switches=3, custom_counter=9)
        saved["unlocks"] = {"architect": {"at": 1, "name": "Architect"},
                            "weather_storm": {"at": 1, "name": "Warm lamp"},
                            "theme_designer": {"at": 1, "name": "Theme designer"},
                            "first_shift": {"at": 2, "name": "First day"}}
        saved["recent"] = [{"id": "architect", "at": 1, "name": "Architect"},
                           {"id": "weather_storm", "at": 1, "name": "Warm lamp"}]
        db.execute("UPDATE checkpoint SET data=? WHERE id=1", (json.dumps(checkpoint),))
    # The JSON mirror is deliberately unrelated: SQLite remains authoritative.
    (tmp_path / "progress.json").write_text('{"xp": 9999}', encoding="utf-8")
    EventStore(tmp_path).history()
    with sqlite3.connect(tmp_path / "office.sqlite3") as db:
        restored = json.loads(db.execute("SELECT data FROM checkpoint WHERE id=1").fetchone()[0])["progress"]
    assert restored["xp"] == 80
    assert restored["stats"] == saved["stats"]
    assert restored["unlocks"] == {"first_shift": {"at": 2, "name": "First day"}}
    assert restored["recent"] == []
    assert restored["legacy_cosmetics"] == ["storm_lamp"]
    state = consume(tmp_path)
    assert state["progress"]["cosmetics"] == ["storm_lamp"]
    assert state["progress"]["xp"] == 80 and state["progress"]["stats"] == saved["stats"]
    assert not any(badge["have"] for badge in state["progress"]["catalog"]
                   if badge["id"] == "coffee_break")
    EventStore(tmp_path).prune_history()
    assert consume(tmp_path)["progress"] == state["progress"]
    EventStore(tmp_path).reset(lambda: [])
    reset = consume(tmp_path)
    assert reset["progress"]["xp"] == 0 and reset["progress"]["cosmetics"] == []
    assert json.loads((tmp_path / "progress.json").read_text())["legacy_cosmetics"] == []


def test_initial_legacy_json_import_keeps_lamp_without_restoring_retired_badges(tmp_path):
    (tmp_path / "progress.json").write_text(json.dumps({
        "xp": 80, "stats": {"errors": 6, "theme_switches": 8},
        "unlocks": {"weather_storm": {"at": 1, "name": "Warm lamp"}},
        "recent": [{"id": "weather_storm", "at": 1}],
    }), encoding="utf-8")
    state = consume(tmp_path)["progress"]
    assert state["xp"] == 80
    assert state["unlocks"] == [] and state["recent"] == []
    assert state["cosmetics"] == ["storm_lamp"]
    assert state["stats"]["errors"] == 6 and state["stats"]["theme_switches"] == 8
    mirrored = json.loads((tmp_path / "progress.json").read_text())
    assert mirrored["unlocks"] == {} and mirrored["legacy_cosmetics"] == ["storm_lamp"]
    assert consume(tmp_path)["progress"] == state


@pytest.mark.parametrize("completed_kind", ["main", "subagent"])
def test_completed_exit_sprites_do_not_inflate_concurrent_agent_achievements(tmp_path, completed_kind):
    for index in range(5):
        sid = f"finished-{index}"
        if completed_kind == "main":
            started = event("session_start", session_id=sid)
            stopped = event("session_end", session_id=sid)
        else:
            started = event("subagent_start", child_session_id=sid)
            stopped = event("subagent_stop", child_session_id=sid)
        publish(tmp_path, index * 2, started)
        publish(tmp_path, index * 2 + 1, stopped)
    publish(tmp_path, 11, event("session_start", session_id="active"))
    state = consume(tmp_path)
    assert len(state["agents"]) == 6  # Includes the five animated departures.
    assert state["progress"]["stats"]["max_concurrent"] == 1
    assert not {"pair_programming", "full_floor"} & {
        badge["id"] for badge in state["progress"]["unlocks"]}


def test_usage_duplicate_correction_prune_and_reset_share_event_transaction(tmp_path):
    report = event("usage", platform="opencode", usage_id="message-1", model="observed-model",
                   input_tokens=100, output_tokens=40, cached_input_tokens=20,
                   cost_usd=0.02, cost_source="OpenCode runtime estimate")
    publish(tmp_path, 1, report)
    publish(tmp_path, 2, report)
    first = consume(tmp_path)
    assert first["usage"]["totals"]["reports"] == 1
    assert first["usage"]["totals"]["total_tokens"] == 140
    assert any(c["id"] == "measured_work" and c["have"] for c in first["progress"]["catalog"])
    EventStore(tmp_path).prune_history()
    assert consume(tmp_path)["usage"] == first["usage"]
    publish(tmp_path, 3, {**report, "output_tokens": 50, "cost_usd": 0.025})
    corrected = consume(tmp_path)
    assert corrected["usage"]["totals"]["total_tokens"] == 150
    assert corrected["usage"]["totals"]["reports"] == 1
    EventStore(tmp_path).reset(lambda: [])
    reset = consume(tmp_path)
    assert reset["usage"]["totals"]["reports"] == 0
    assert reset["usage"]["totals"]["cost_usd"] is None
