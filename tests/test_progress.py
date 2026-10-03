"""Unit tests for Agent Office progress / unlocks."""
from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from progress import (  # noqa: E402
    apply_live,
    ingest,
    load,
    rank_for,
    save,
    snapshot,
)


def test_rank_ladder():
    assert rank_for(0) == "intern"
    assert rank_for(40) == "junior"
    assert rank_for(150) == "staff"
    assert rank_for(400) == "principal"
    assert rank_for(1200) == "distinguished"


def test_first_shift_and_platforms(tmp_path: Path):
    data = load(tmp_path / "missing.json")
    now = time.time()
    data = ingest(
        data,
        [
            {"event": "session_start", "session_id": "h1", "platform": "cli", "ts": now},
            {"event": "session_start", "session_id": "o1", "platform": "opencode", "ts": now + 1},
            {"event": "session_start", "session_id": "t1", "platform": "telegram", "ts": now + 2},
        ],
    )
    apply_live(data, 3)
    snap = snapshot(data)
    ids = {u["id"] for u in snap["unlocks"]}
    assert "first_shift" in ids
    assert "open_floor" in ids
    assert "telegram_desk" in ids
    assert "two_houses" in ids
    assert "pair_programming" in ids
    assert snap["xp"] > 0
    assert "fern" in snap["cosmetics"]


def test_tool_buckets_and_persist(tmp_path: Path):
    p = tmp_path / "progress.json"
    data = load(p)
    now = time.time()
    evs = []
    for i in range(25):
        evs.append({"event": "tool_start", "tool_name": "read_file", "ts": now + i})
        evs.append({"event": "tool_start", "tool_name": "write_file", "ts": now + 100 + i})
        evs.append({"event": "tool_start", "tool_name": "bash", "ts": now + 200 + i})
    for i in range(15):
        evs.append({"event": "tool_start", "tool_name": "web_search", "ts": now + 300 + i})
    data = ingest(data, evs)
    save(p, data)
    again = load(p)
    ids = set(again["unlocks"])
    assert "reader" in ids
    assert "typer" in ids
    assert "shell_jockey" in ids
    assert "browser_tab" in ids
    assert again["stats"]["tools"] == 90


def test_idempotent_replay():
    data = load(Path("/nonexistent"))
    now = time.time()
    ev = [{"event": "session_start", "session_id": "x", "platform": "cli", "ts": now}]
    data = ingest(data, ev)
    xp1 = data["xp"]
    data = ingest(data, ev)  # same ts — should not double count
    assert data["xp"] == xp1


def test_snapshot_catalog_flags():
    data = ingest(
        load(Path("/nope")),
        [{"event": "subagent_start", "child_session_id": "c1", "ts": time.time()}],
    )
    snap = snapshot(data)
    gold = next(c for c in snap["catalog"] if c["id"] == "gold_collar")
    assert gold["have"] is True
    assert isinstance(snap["catalog"], list)
    assert len(snap["catalog"]) >= 10


def test_catalog_exposes_xp_and_only_real_room_rewards():
    catalog = snapshot(load(Path("/nope")))["catalog"]
    assert sum(bool(c["reward"]) for c in catalog) == 8
    fish = next(c for c in catalog if c["id"] == "pet_fish")
    assert fish["reward"] == "Lounge aquarium"
    assert fish["xp"] == 20
    assert all(isinstance(c["xp"], int) and c["xp"] >= 0 for c in catalog)
