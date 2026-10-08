"""Reported task snapshots never invent work, completion, or session activity."""
import copy
import json

import pytest

from state_model import StateModel


def update(tasks, *, runtime="opencode", session="session", ts=1000, **fields):
    return {"event": "tasks_update", "platform": runtime, "session_id": session,
            "task_source": f"{runtime}.test_fixture", "tasks": tasks, "ts": ts, **fields}


def task(identity="row-0", content="Inspect the failing test", status="pending", **fields):
    return {"id": identity, "content": content, "status": status, **fields}


def restored(model):
    return StateModel(json.loads(json.dumps(model.dump(), sort_keys=True)))


def test_reported_tasks_survive_checkpoint_without_creating_a_session():
    model = StateModel()
    model.apply([update([task(priority="high")])], 2000, received_at=2000)
    assert len(model.dump().get("task_boards", [])) == 1
    board = restored(model).snapshot_tasks(2010)[0]
    assert board == {
        "runtime": "opencode", "session_id": "session", "source": "opencode.test_fixture",
        "source_updated_at": None, "observed_at": 2000, "age_s": 10,
        "historical": True, "session_status": "unobserved",
        "tasks": [{"id": "row-0", "content": "Inspect the failing test", "status": "pending", "priority": "high"}],
    }
    assert model.visible(2010) == []
    assert model.dump()["agents"] == []


def test_old_checkpoints_have_unknown_task_coverage_until_a_source_reports():
    model = StateModel({"version": 1, "agents": []})
    assert model.dump().get("task_boards") == []
    assert model.snapshot_tasks(1000) == []
    model.apply([update([])], 1000)
    assert model.snapshot_tasks(1000)[0]["tasks"] == []


def test_task_replacement_removes_missing_rows_and_only_explicit_empty_clears():
    model = StateModel()
    model.apply([update([task(), task("row-1", "Run tests", "in_progress")])], 1000)
    assert len(model.dump().get("task_boards", [])) == 1
    model.apply([update([task("row-1", "Run tests", "completed")], ts=1001)], 1001)
    assert model.snapshot_tasks(1001)[0]["tasks"] == [
        {"id": "row-1", "content": "Run tests", "status": "completed"},
    ]
    missing = update(None, ts=1002)
    missing.pop("tasks")
    model.apply([missing], 1002)
    assert len(model.snapshot_tasks(1002)[0]["tasks"]) == 1
    model.apply([update([], ts=1003)], 1003)
    assert model.snapshot_tasks(1003)[0]["tasks"] == []


@pytest.mark.parametrize("invalid", [
    None, {}, "tasks", [None], [task(status="done")], [task(priority="urgent")],
    [task(content="")], [task(content="x" * 513)], [task(identity="x" * 257)],
    [task(identity="")], [task(identity="a\x00b")], [task(content=23)],
    [task(), task()], [task(), {"id": "other", "content": "Broken"}],
    [task(str(i)) for i in range(101)],
])
def test_invalid_task_snapshots_are_atomic_and_preserve_the_last_valid_board(invalid):
    model = StateModel()
    model.apply([update([task()])], 1000)
    assert len(model.dump().get("task_boards", [])) == 1
    before = model.dump()
    model.apply([update(invalid, ts=1001)], 1001, received_at=1001)
    assert model.dump() == before


@pytest.mark.parametrize("field,value", [
    ("platform", ""), ("platform", 3), ("session_id", ""),
    ("session_id", []), ("session_id", "x" * 513), ("task_source", ""),
    ("task_source", ["codex"]), ("source_updated_at", True),
    ("source_updated_at", "1000"), ("source_updated_at", float("nan")),
    ("source_updated_at", -1),
    pytest.param("source_updated_at", 10 ** 1000, id="overflowing-source-clock"),
])
def test_invalid_board_metadata_cannot_replace_a_known_snapshot(field, value):
    model = StateModel()
    model.apply([update([task()])], 1000)
    assert len(model.dump().get("task_boards", [])) == 1
    before = model.dump()
    model.apply([{**update([], ts=1001), field: value}], 1001)
    assert model.dump() == before


def test_task_identity_includes_runtime_and_preserves_unicode_and_text():
    model = StateModel()
    text = "Inspect <script>never_execute()</script>\nThen test the fish 🐟"
    model.apply([
        update([task(content=text)]),
        update([task(content="Different runtime")], runtime="codex"),
    ], 1000)
    assert len(model.dump().get("task_boards", [])) == 2
    boards = model.snapshot_tasks(1000)
    assert {(b["runtime"], b["session_id"]) for b in boards} == {
        ("opencode", "session"), ("codex", "session"),
    }
    assert next(b for b in boards if b["runtime"] == "opencode")["tasks"][0]["content"] == text


def test_source_clock_is_separate_from_receipt_age_and_rejects_older_source_data():
    model = StateModel()
    model.apply([update([task()], source_updated_at=900)], 5000, received_at=5000)
    assert len(model.dump().get("task_boards", [])) == 1
    model.apply([update([], ts=2000, source_updated_at=800)], 5001, received_at=5001)
    board = model.snapshot_tasks(5010)[0]
    assert (board["source_updated_at"], board["observed_at"], board["age_s"]) == (900, 5000, 10)
    assert len(board["tasks"]) == 1
    model.apply([update([], ts=3000, source_updated_at=100000)], 5002, received_at=5002)
    board = restored(model).snapshot_tasks(5010)[0]
    assert (board["source_updated_at"], board["observed_at"], board["age_s"]) == (100000, 5002, 8)
    assert model.snapshot_tasks(4900)[0]["age_s"] == 0


def test_same_captured_stream_replay_cannot_regress_or_refresh_a_later_task_snapshot():
    model = StateModel()
    model.apply([update([task(status="completed")], runtime="codex", task_capture_id="capture", task_sequence=8)],
                1000, received_at=1000)
    model = restored(model)
    model.apply([
        update([task(status="pending")], runtime="codex", task_capture_id="capture", task_sequence=3, ts=2000),
        update([task(status="completed")], runtime="codex", task_capture_id="capture", task_sequence=8, ts=2001),
    ], 2001, received_at=2001)
    board = model.snapshot_tasks(2010)[0]
    assert board["tasks"][0]["status"] == "completed"
    assert (board["observed_at"], board["age_s"]) == (1000, 1010)
    assert "task_capture_id" not in board and "task_sequence" not in board
    model.apply([update([task(status="cancelled")], runtime="codex", task_capture_id="capture", task_sequence=9, ts=2011)],
                2011, received_at=2011)
    assert model.snapshot_tasks(2011)[0]["tasks"][0]["status"] == "cancelled"


def test_recent_capture_watermarks_survive_interleaving_restart_and_new_reports():
    model = StateModel()
    for capture, sequence, content, received in [
        ("capture-a", 3, "A1", 1000),
        ("capture-a", 4, "A2", 1001),
        ("capture-b", 3, "B1", 1002),
    ]:
        model.apply([update([task(content=content)], runtime="codex", task_capture_id=capture,
                            task_sequence=sequence)], received, received_at=received)
    model = restored(model)
    before = model.dump()
    for sequence, content in [(3, "A1"), (4, "A2")]:
        model.apply([update([task(content=content)], runtime="codex", task_capture_id="capture-a",
                            task_sequence=sequence)], 2000, received_at=2000)
    assert model.dump() == before
    board = model.snapshot_tasks(2010)[0]
    assert board["tasks"][0]["content"] == "B1"
    assert (board["observed_at"], board["age_s"]) == (1002, 1008)
    assert "task_capture_watermarks" not in board
    model.apply([update([task(content="A3")], runtime="codex", task_capture_id="capture-a",
                        task_sequence=5)], 2011, received_at=2011)
    assert model.snapshot_tasks(2011)[0]["tasks"][0]["content"] == "A3"
    assert model.snapshot_tasks(2011)[0]["observed_at"] == 2011


def test_legacy_current_capture_cursor_upgrades_to_remembered_watermark():
    model = StateModel()
    model.apply([update([task()], runtime="codex")], 1000, received_at=1000)
    snapshot = model.dump()
    board = snapshot["task_boards"][0]
    board.pop("task_capture_watermarks", None)
    board.update(task_capture_id="old-capture", task_sequence=8)
    model = StateModel(snapshot)
    assert model.dump()["task_boards"][0]["task_capture_watermarks"] == [
        {"id": "old-capture", "sequence": 8},
    ]
    model.apply([update([task(content="New capture")], runtime="codex", task_capture_id="new-capture",
                        task_sequence=3)], 1001, received_at=1001)
    model = restored(model)
    before = model.dump()
    model.apply([update([task(content="Old replay")], runtime="codex", task_capture_id="old-capture",
                        task_sequence=8)], 2000, received_at=2000)
    assert model.dump() == before


def test_capture_watermarks_are_bounded_to_eight_recent_accepted_captures():
    model = StateModel()
    for index in range(9):
        model.apply([update([task(content=f"Capture {index}")], runtime="codex",
                            task_capture_id=f"capture-{index}", task_sequence=3)],
                    1000 + index, received_at=1000 + index)
    model = restored(model)
    watermarks = model.dump()["task_boards"][0]["task_capture_watermarks"]
    assert watermarks == [{"id": f"capture-{index}", "sequence": 3} for index in range(1, 9)]
    before = model.dump()
    model.apply([update([], runtime="codex", task_capture_id="capture-1", task_sequence=3)],
                2000, received_at=2000)
    assert model.dump() == before
    # An evicted capture is unknown again, so its report follows receipt order.
    model.apply([update([task(content="Evicted capture reported again")], runtime="codex",
                        task_capture_id="capture-0", task_sequence=3)], 2001, received_at=2001)
    assert model.snapshot_tasks(2001)[0]["tasks"][0]["content"] == "Evicted capture reported again"
    watermarks = model.dump()["task_boards"][0]["task_capture_watermarks"]
    assert len(watermarks) == 8
    assert watermarks[-1] == {"id": "capture-0", "sequence": 3}
    assert "capture-1" not in {watermark["id"] for watermark in watermarks}


def test_task_reports_cannot_refresh_live_agent_clocks_or_revive_ended_agents():
    model = StateModel()
    model.apply([{"event": "session_start", "session_id": "session", "platform": "opencode", "ts": 1000}], 1000)
    model.apply([update([task()])], 1001, received_at=1001)
    assert len(model.dump().get("task_boards", [])) == 1
    assert model.snapshot_tasks(1001)[0]["historical"] is False
    assert model.agents["session"]["observed_at"] == 1000
    model.apply([{"event": "session_end", "session_id": "session", "platform": "opencode", "ts": 1010}], 1010)
    ended = copy.deepcopy(model.agents["session"])
    model.apply([update([task(status="in_progress")], ts=1020)], 1020, received_at=1020)
    assert model.agents["session"] == ended
    board = model.snapshot_tasks(1020)[0]
    assert board["historical"] is True and board["session_status"] == "gone"
    assert board["tasks"][0]["status"] == "in_progress"
    model.expire(3000)
    model = restored(model)
    assert model.visible(3000) == []
    assert model.snapshot_tasks(3000)[0]["historical"] is True
    model.apply([update([task()], ts=4000)], 4000)
    assert model.visible(4000) == []


def test_other_runtime_with_same_session_id_cannot_make_a_board_live():
    model = StateModel()
    model.apply([
        {"event": "session_start", "session_id": "session", "platform": "codex", "ts": 1000},
        update([task()]),
    ], 1000)
    assert len(model.dump().get("task_boards", [])) == 1
    assert model.snapshot_tasks(1000)[0]["historical"] is True
    assert model.snapshot_tasks(1000)[0]["session_status"] == "unobserved"


def test_task_boards_keep_the_most_recent_128_and_do_not_truncate_a_full_valid_board():
    model = StateModel()
    model.apply([update([task(str(i), "x" * 512) for i in range(100)], session="old")], 1000)
    assert len(model.dump().get("task_boards", [])) == 1
    assert len(model.snapshot_tasks(1000)[0]["tasks"]) == 100
    for i in range(127):
        model.apply([update([], session=f"s{i}", ts=1001 + i)], 1001 + i)
    model.apply([update([task(content="Recently refreshed")], session="old", ts=2000)], 2000)
    model.apply([update([], session="new", ts=2001)], 2001)
    boards = restored(model).snapshot_tasks(2010)
    assert len(boards) == 128
    assert "old" in {b["session_id"] for b in boards}
    assert "s0" not in {b["session_id"] for b in boards}
    assert boards[0]["session_id"] == "new"


def test_task_input_checkpoint_and_display_objects_are_independent():
    records = [update([task()])]
    original = copy.deepcopy(records)
    model = StateModel()
    model.apply(records, 1000)
    assert len(model.dump().get("task_boards", [])) == 1
    checkpoint = model.dump()
    second = StateModel(checkpoint)
    records[0]["tasks"][0]["content"] = "Input changed"
    checkpoint["task_boards"][0]["tasks"][0]["content"] = "Checkpoint changed"
    model.snapshot_tasks(1000)[0]["tasks"][0]["content"] = "View changed"
    assert original[0]["tasks"][0]["content"] == "Inspect the failing test"
    assert model.snapshot_tasks(1000)[0]["tasks"][0]["content"] == "Inspect the failing test"
    assert second.snapshot_tasks(1000)[0]["tasks"][0]["content"] == "Inspect the failing test"
