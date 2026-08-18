from __future__ import annotations

import json
from pathlib import Path
from unittest import mock

import pytest

import progress
import sys
from pathlib import Path as _P
sys.path.insert(0, str(_P(__file__).resolve().parents[1]))
from progress import ingest, load, save, snapshot, RANKS, CATALOG


def _save(tmp, data):
    save(tmp / "progress.json", data)


def test_layout_unlocks_for_sessions(tmp_path):
    data = load(tmp_path / "progress.json")
    data["stats"]["sessions"] = 10
    data = ingest(data, [])
    assert "layout_bullpen" in data["unlocks"]
    assert "pet_cat" in data["unlocks"]


def test_weather_unlocks(tmp_path):
    data = load(tmp_path / "progress.json")
    data["stats"]["errors"] = 5
    data = ingest(data, [])
    assert "weather_storm" in data["unlocks"]


def test_claude_platform_unlocks(tmp_path):
    data = load(tmp_path / "progress.json")
    data = ingest(data, [
        {"ts": 1.0, "event": "session_start", "session_id": "x", "platform": "claude"},
    ])
    assert "claude_desk" in data["unlocks"]
    assert "orange_scarf" in snapshot(data)["cosmetics"]


def test_catalog_grew():
    ids = {c["id"] for c in CATALOG}
    assert {"layout_bullpen", "layout_war_room", "layout_lounge",
            "layout_mexico", "areas_q1", "areas_q2",
            "pet_cat", "pet_plant", "weather_storm", "weather_sun"} <= ids


def test_ranks_still_intact():
    assert RANKS[0][1] == "intern"
    assert RANKS[-1][1] == "distinguished"


def test_no_overlap_between_layouts_and_ranks():
    """Layout unlocks are cosmetic; they should never change a rank."""
    data = load(Path("/tmp") / "p.json")
    data["xp"] = 99999
    before = snapshot(data)["rank"]
    data = ingest(data, [{"ts": 1.0, "event": "session_start",
                          "session_id": "y", "platform": "claude"}])
    assert snapshot(data)["rank"] == before
