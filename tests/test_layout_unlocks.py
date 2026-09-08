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
    data["stats"]["sessions"] = 50
    data = ingest(data, [])
    assert "pet_cat" in data["unlocks"]
    assert "deep_work" in data["unlocks"]


def test_tracking_badges(tmp_path):
    data = load(tmp_path / "progress.json")
    data["stats"]["tools"] = 500
    data = ingest(data, [])
    assert "workhorse" in data["unlocks"]


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
    assert {"layout_bullpen",
            "pet_dog", "pet_fish",
            "areas_q1", "areas_q2",
            "pet_cat", "pet_plant", "weather_storm", "weather_sun",
            "workhorse", "deep_work", "theme_designer",
            "architect", "marathon"} <= ids
    # retired bloat stays retired (lounge/library layouts, dead desk cosmetics)
    assert not {"layout_lounge", "layout_library",
                "layout_war_room", "layout_mexico", "layout_garden",
                "layout_arcade", "layout_penthouse", "layout_beach",
                "layout_atelier", "layout_spaceship",
                "canvas_artisan", "decorator", "auto_arrange",
                "tour_guide", "screenshotter", "mood_master"} & ids


def test_no_dead_cosmetics():
    """desk_glass/standing/wood + sun never rendered — must stay retired."""
    from progress import cosmetics_for
    data = load(Path("/tmp") / "p.json")
    data["xp"] = 99999
    for badge in ("marathon", "centurion", "fashion", "weather_sun",
                  "layout_lounge", "layout_library"):
        data["unlocks"][badge] = {"at": 1.0, "name": badge}
    from progress import snapshot
    cos = set(snapshot(data)["cosmetics"])
    assert not {"desk_glass", "desk_standing", "desk_wood", "sun"} & cos


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
