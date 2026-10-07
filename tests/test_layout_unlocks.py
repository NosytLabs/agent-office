from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from progress import ingest, load, save, snapshot, RANKS


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
    assert "fern" in snapshot(data)["cosmetics"]


def test_legacy_earned_badges_do_not_lose_xp(tmp_path):
    path = tmp_path / "progress.json"
    data = load(path)
    data["xp"] = 80
    data["stats"].update(tools=17, theme_switches=3, custom_counter=9)
    data["unlocks"]["architect"] = {"name": "Architect", "at": 1}
    data["unlocks"]["first_shift"] = {"name": "First day", "at": 2}
    data["recent"] = [{"id": "architect", "name": "Architect", "at": 1}]
    data["last_ts"] = 200
    data["last_ts_counts"] = {"legacy boundary": 2}
    expected_stats = deepcopy(data["stats"])
    # Seed an actual old file; the current save path must not pre-clean it.
    path.write_text(json.dumps(data), encoding="utf-8")
    restored = load(path)
    assert snapshot(restored)["xp"] == 80
    assert "architect" not in restored["unlocks"]
    assert restored["unlocks"]["first_shift"] == {"name": "First day", "at": 2}
    assert restored["recent"] == []
    assert restored["stats"] == expected_stats
    assert restored["last_ts"] == 200
    assert restored["last_ts_counts"] == {"legacy boundary": 2}
    assert not any(b["id"] == "architect" for b in snapshot(restored)["catalog"])
    save(path, restored)
    assert json.loads(path.read_text())["unlocks"] == restored["unlocks"]


def test_no_dead_cosmetics(tmp_path):
    """desk_glass/standing/wood + sun never rendered — must stay retired."""
    data = load(tmp_path / "progress.json")
    data["xp"] = 99999
    for badge in ("marathon", "centurion", "fashion", "weather_sun",
                  "layout_lounge", "layout_library"):
        data["unlocks"][badge] = {"at": 1.0, "name": badge}
    cos = set(snapshot(data)["cosmetics"])
    assert not {"desk_glass", "desk_standing", "desk_wood", "sun"} & cos


def test_ranks_still_intact():
    assert RANKS[0][1] == "intern"
    assert RANKS[-1][1] == "distinguished"


def test_no_overlap_between_layouts_and_ranks(tmp_path):
    """Layout unlocks are cosmetic; they should never change a rank."""
    data = load(tmp_path / "progress.json")
    data["xp"] = 99999
    before = snapshot(data)["rank"]
    data = ingest(data, [{"ts": 1.0, "event": "session_start",
                          "session_id": "y", "platform": "claude"}])
    assert snapshot(data)["rank"] == before
