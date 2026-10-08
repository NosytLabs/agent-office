"""Synthetic source contracts through real adapters, inbox publication, and SQLite."""
import json
import os
from pathlib import Path
import subprocess
import sys

from event_store import EventStore
from event_inbox import publish

ROOT = Path(__file__).resolve().parents[1]


def codex_publish(home, records, capture="fixture-capture"):
    result = subprocess.run(
        [sys.executable, str(ROOT / "codex/stream.py"), "--stream-id", capture],
        input="".join(json.dumps(record) + "\n" for record in records),
        text=True, capture_output=True, env={**os.environ, "HERMES_HOME": str(home)},
    )
    assert result.returncode == 0 and result.stdout == "" and result.stderr == ""


def opencode_publish(home, records):
    script = """
        import bridgeFactory from './opencode/index.js';
        import { readFileSync } from 'node:fs';
        const bridge = await bridgeFactory();
        for (const event of JSON.parse(readFileSync(0, 'utf8'))) await bridge.event({event});
    """
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script], cwd=ROOT,
        input=json.dumps(records), text=True, capture_output=True,
        env={**os.environ, "HERMES_HOME": str(home)},
    )
    assert result.returncode == 0 and result.stdout == "" and result.stderr == ""


def consume(home, now, **options):
    return EventStore(home / "pixel-office").consume(lambda: [], now, **options)


def test_task_only_opencode_reports_do_not_earn_runtime_achievements_or_progress(tmp_path):
    publish(tmp_path / "pixel-office", {
        "event": "session_start", "platform": "hermes", "session_id": "hermes-fixture", "ts": 1000,
    })
    before = consume(tmp_path, 1000)
    opencode_publish(tmp_path, [{"type": "todo.updated", "properties": {
        "sessionID": "task-fixture", "todos": [{"content": "Observe only", "status": "pending", "priority": "low"}],
    }}])
    after = consume(tmp_path, 1001)
    assert len(after["tasks"]) == 1
    assert after["progress"]["xp"] == before["progress"]["xp"]
    assert after["progress"]["unlocks"] == before["progress"]["unlocks"]
    assert after["progress"]["stats"] == before["progress"]["stats"]


def test_codex_real_stream_task_replay_preserves_the_latest_plan_without_earning_xp(tmp_path):
    records = [
        {"type": "thread.started", "thread_id": "task-fixture"},
        {"type": "turn.started"},
        {"type": "item.started", "item": {"id": "plan", "type": "todo_list", "items": [
            {"text": "Inspect source", "completed": False}, {"text": "Review results", "completed": False},
        ]}},
        {"type": "item.completed", "item": {"id": "plan", "type": "todo_list", "items": [
            {"text": "Inspect source", "completed": True}, {"text": "Review results", "completed": False},
        ]}},
    ]
    codex_publish(tmp_path, records)
    first = consume(tmp_path, 1000)
    assert first["agents"] == [] and first["progress"]["xp"] == 0
    assert first["progress"]["stats"]["sessions"] == first["progress"]["stats"]["tools"] == 0
    assert first["tasks"][0]["tasks"] == [
        {"id": "row-0", "content": "Inspect source", "status": "completed"},
        {"id": "row-1", "content": "Review results", "status": "pending"},
    ]
    assert first["tasks"][0]["source_updated_at"] is None
    assert first["tasks"][0]["historical"] is True
    # Even an interrupted replay that ends on an older plan cannot regress it.
    codex_publish(tmp_path, records[:-1])
    replay = consume(tmp_path, 1100)
    assert replay["tasks"][0]["tasks"] == first["tasks"][0]["tasks"]
    assert replay["tasks"][0]["observed_at"] == 1000
    codex_publish(tmp_path, records)
    replay = consume(tmp_path, 1200)
    assert replay["tasks"][0]["observed_at"] == 1000
    assert replay["progress"] == first["progress"]
    assert replay["usage"]["totals"]["reports"] == 0
    # Revisiting saved capture A after capture B is still a known replay.
    second = records[:2] + [{"type": "item.updated", "item": {
        "id": "other-plan", "type": "todo_list", "items": [{"text": "New capture plan", "completed": False}],
    }}]
    codex_publish(tmp_path, second, capture="second-capture")
    current = consume(tmp_path, 1300)
    assert current["tasks"][0]["tasks"][0]["content"] == "New capture plan"
    codex_publish(tmp_path, records)
    older = consume(tmp_path, 1400)
    assert older["tasks"][0]["tasks"] == current["tasks"][0]["tasks"]
    assert older["tasks"][0]["observed_at"] == 1300
    assert older["progress"] == first["progress"]
    extended = records + [{"type": "item.updated", "item": {
        "id": "plan", "type": "todo_list", "items": [{"text": "New record in first capture", "completed": False}],
    }}]
    codex_publish(tmp_path, extended)
    fresh = consume(tmp_path, 1500)
    assert fresh["tasks"][0]["tasks"][0]["content"] == "New record in first capture"
    assert fresh["tasks"][0]["observed_at"] == 1500
    assert fresh["progress"] == first["progress"]


def test_opencode_real_publisher_keeps_late_task_updates_historical_after_session_exit(tmp_path):
    def todo(rows):
        return {"type": "todo.updated", "properties": {"sessionID": "task-fixture", "todos": rows}}
    opencode_publish(tmp_path, [
        {"type": "session.created", "properties": {"info": {"id": "task-fixture", "title": "Fixture"}}},
        todo([{"content": "Review result", "status": "pending", "priority": "high"}]),
    ])
    first = consume(tmp_path, 1000)
    assert first["tasks"][0]["historical"] is False
    opencode_publish(tmp_path, [{"type": "session.deleted", "properties": {"info": {"id": "task-fixture"}}}])
    ended = consume(tmp_path, 1010)
    assert ended["agents"][0]["status"] == "gone"
    assert ended["agents"][0]["duration_s"] == 10
    opencode_publish(tmp_path, [todo([{"content": "Review result", "status": "in_progress", "priority": "high"}])])
    late = consume(tmp_path, 1100, history_limit=1)
    assert late["agents"] == []
    assert late["tasks"][0]["historical"] is True
    assert late["tasks"][0]["session_status"] == "gone"
    assert late["tasks"][0]["tasks"][0]["status"] == "in_progress"
    assert late["progress"] == ended["progress"]
    # Task state survives raw-history pruning and the lifecycle retention window.
    after_expiry = consume(tmp_path, 4000, history_limit=1)
    assert after_expiry["tasks"][0]["tasks"] == late["tasks"][0]["tasks"]
    assert after_expiry["tasks"][0]["historical"] is True
    opencode_publish(tmp_path, [todo([{"content": "Malformed", "status": "done"}])])
    invalid = consume(tmp_path, 4001)
    assert invalid["tasks"][0]["tasks"] == [
        {"id": "row-0", "content": "Review result", "status": "in_progress", "priority": "high"},
    ]
    assert invalid["tasks"][0]["observed_at"] == 1100
    opencode_publish(tmp_path, [todo([])])
    cleared = consume(tmp_path, 4002)
    assert cleared["tasks"][0]["tasks"] == [] and cleared["agents"] == []
    assert cleared["progress"] == ended["progress"]


def test_parent_child_task_boards_and_same_id_codex_report_remain_independent(tmp_path):
    def todo(session, content, status="pending"):
        return {"type": "todo.updated", "properties": {"sessionID": session, "todos": [
            {"content": content, "status": status, "priority": "medium"},
        ]}}

    opencode_publish(tmp_path, [
        {"type": "session.created", "properties": {"info": {"id": "parent", "title": "Parent fixture"}}},
        {"type": "session.created", "properties": {"info": {
            "id": "child", "parentID": "parent", "title": "Child fixture",
        }}},
        todo("parent", "Review delegated work"),
        todo("child", "Check a source", "in_progress"),
    ])
    before = consume(tmp_path, 1000)
    assert {agent["id"] for agent in before["agents"]} == {"parent", "child"}
    assert all(board["historical"] is False for board in before["tasks"])
    codex_publish(tmp_path, [
        {"type": "thread.started", "thread_id": "child"},
        {"type": "item.updated", "item": {"id": "plan", "type": "todo_list", "items": [
            {"text": "Unrelated runtime plan", "completed": False},
        ]}},
    ])
    same_id = consume(tmp_path, 1001)
    boards = {(board["runtime"], board["session_id"]): board for board in same_id["tasks"]}
    assert len(boards) == 3
    assert boards["codex", "child"]["historical"] is True
    assert boards["codex", "child"]["session_status"] == "unobserved"
    assert boards["opencode", "child"]["historical"] is False
    assert same_id["progress"] == before["progress"]

    # A separate plugin process can identify an existing child through metadata.
    opencode_publish(tmp_path, [
        {"type": "session.updated", "properties": {"info": {"id": "child", "parentID": "parent"}}},
        {"type": "session.idle", "properties": {"sessionID": "child"}},
    ])
    stopped = consume(tmp_path, 1010)
    parent_before = next(agent for agent in stopped["agents"] if agent["id"] == "parent")
    child_before = next(agent for agent in stopped["agents"] if agent["id"] == "child")
    assert child_before["status"] == "done"
    opencode_publish(tmp_path, [todo("child", "Still pending source review")])
    late = consume(tmp_path, 1011)
    assert next(agent for agent in late["agents"] if agent["id"] == "parent")["observed_at"] == parent_before["observed_at"]
    assert next(agent for agent in late["agents"] if agent["id"] == "child")["observed_at"] == child_before["observed_at"]
    boards = {(board["runtime"], board["session_id"]): board for board in late["tasks"]}
    assert boards["opencode", "parent"]["tasks"][0]["content"] == "Review delegated work"
    assert boards["codex", "child"]["tasks"][0]["content"] == "Unrelated runtime plan"
    assert boards["opencode", "child"]["historical"] is True
    assert boards["opencode", "child"]["tasks"][0]["status"] == "pending"
    assert late["progress"] == stopped["progress"]
