"""Unit tests for Agent Office progress / unlocks."""
from __future__ import annotations

import json
import time
from copy import deepcopy
from pathlib import Path

import pytest

import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import progress

from progress import (  # noqa: E402
    apply_live,
    ingest,
    load,
    rank_for,
    save,
    snapshot,
)

RETIRED = {"oops", "weather_storm", "weather_sun", "deep_work",
           "theme_designer", "night_owl", "early_bird"}


def test_active_catalog_retires_error_time_and_appearance_badges():
    ids = {badge["id"] for badge in progress.CATALOG}
    assert len(ids) == 37
    assert not RETIRED & ids


def test_retired_lamp_migration_preserves_earned_xp_statistics_and_cursors(tmp_path):
    data = progress._empty()
    data.update(xp=450, last_ts=100, last_ts_counts={"legacy boundary": 2})
    data["stats"].update(errors=12, theme_switches=8, custom_counter=7)
    data["unlocks"] = {aid: {"at": 1, "name": "Previous label"} for aid in RETIRED}
    data["unlocks"]["first_shift"] = {"at": 2, "name": "First day"}
    data["recent"] = [{"id": aid, "at": 1, "name": "Previous label"} for aid in RETIRED]
    data["recent"].append({"id": "first_shift", "at": 2})
    original = deepcopy(data)
    path = tmp_path / "progress.json"
    path.write_text(json.dumps(data), encoding="utf-8")

    restored = load(path)
    assert restored["xp"] == 450
    assert restored["stats"] == original["stats"]
    assert restored["last_ts"] == 100 and restored["last_ts_counts"] == {"legacy boundary": 2}
    assert set(restored["unlocks"]) == {"first_shift"}
    assert [badge["id"] for badge in restored["recent"]] == ["first_shift"]
    assert restored["legacy_cosmetics"] == ["storm_lamp"]
    assert progress.normalize_achievements(restored) is False
    view = snapshot(restored)
    assert view["cosmetics"].count("storm_lamp") == 1
    lamp = next(badge for badge in view["catalog"] if badge["id"] == "coffee_break")
    assert lamp["have"] is False and lamp["progress"] == 0
    assert not RETIRED & {badge["id"] for badge in view["catalog"]}

    save(path, restored)
    assert load(path) == restored
    assert data == original


@pytest.mark.parametrize("saved,expected", [
    (None, []),
    ("storm_lamp", []),
    ({"storm_lamp": True}, []),
    (["fish_tank", "unknown"], []),
    (["storm_lamp", "storm_lamp", "fish_tank", None, ["storm_lamp"]], ["storm_lamp"]),
])
def test_legacy_cosmetics_accepts_only_the_existing_lamp_record(saved, expected):
    data = progress._empty()
    data["legacy_cosmetics"] = saved
    progress.normalize_achievements(data)
    assert data["legacy_cosmetics"] == expected
    assert snapshot(data)["cosmetics"] == expected
    assert data["xp"] == 0 and not data["unlocks"]
    assert progress.normalize_achievements(data) is False


def test_tool_errors_remain_recorded_without_awarding_xp_or_room_rewards():
    data = progress._empty()
    ingest(data, [{"event": "tool_end", "status": "error", "ts": 100 + i,
                   "call_id": str(i)} for i in range(10)], new_batch=True)
    assert data["stats"]["errors"] == 10
    assert data["xp"] == 0
    assert not data["unlocks"]
    assert snapshot(data)["cosmetics"] == []


@pytest.mark.parametrize("hour", [1, 6, 13])
def test_session_start_awards_the_same_work_xp_at_any_time(hour):
    data = progress._empty()
    ts = time.mktime((2026, 1, 15, hour, 0, 0, 0, 0, -1))
    ingest(data, [{"event": "session_start", "ts": ts}], new_batch=True)
    assert data["stats"]["sessions"] == 1
    assert data["xp"] == 15
    assert set(data["unlocks"]) == {"first_shift", "pet_plant"}


def test_warm_lamp_unlocks_at_fifty_observed_tools_without_duplicate_legacy_reward():
    data = progress._empty()
    ingest(data, [{"event": "tool_start", "ts": 100 + i,
                   "tool_name": f"tool-{i % 9}"} for i in range(49)], new_batch=True)
    assert "storm_lamp" not in snapshot(data)["cosmetics"]
    ingest(data, [{"event": "tool_start", "ts": 150, "tool_name": "tool-4"}], new_batch=True)
    view = snapshot(data)
    lamp = next(badge for badge in view["catalog"] if badge["id"] == "coffee_break")
    assert lamp["have"] is True and lamp["progress"] == 100
    assert lamp["reward"] == "Warm lounge lamp accent"
    assert data["xp"] == 70 and data["stats"]["tools"] == 50
    assert view["cosmetics"].count("storm_lamp") == 1
    data["legacy_cosmetics"] = ["storm_lamp"]
    assert snapshot(data)["cosmetics"].count("storm_lamp") == 1


@pytest.mark.parametrize("badge_id,tools,expected_progress,earned", [
    ("workhorse", 499, 99, False),
    ("thousand_cuts", 995, 99, False),
    ("thousand_cuts", 999, 99, False),
    ("thousand_cuts", 1000, 100, True),
    ("five_k", 4999, 99, False),
    ("five_k", 5000, 100, True),
    ("marathon", 9999, 99, False),
])
def test_tool_milestone_percentages_reach_completion_only_at_the_threshold(
        badge_id, tools, expected_progress, earned):
    data = progress._empty()
    data["stats"]["tools"] = tools
    ingest(data, [], new_batch=True)
    badge = next(item for item in snapshot(data)["catalog"] if item["id"] == badge_id)
    assert badge["have"] is earned
    assert badge["progress"] == expected_progress


def test_new_batch_does_not_serialize_or_retain_event_bodies(monkeypatch):
    data = progress._empty()
    data["last_ts"] = 200
    data["last_ts_counts"] = {"old event body": 99}
    def unexpected_serialization(*args, **kwargs):
        raise AssertionError("receipt ingestion must not serialize an event identity")
    monkeypatch.setattr(progress.json, "dumps", unexpected_serialization)
    progress.ingest(data, [
        {"event": "tool_start", "ts": 100, "tool_name": "Read", "preview": "x" * 200000},
        {"event": "tool_start", "ts": 201, "tool_name": "Read", "preview": "x" * 200000},
    ], new_batch=True)
    assert data["stats"]["tools"] == 2
    assert data["last_ts"] == 201
    assert data["last_ts_counts"] == {}


def test_empty_new_batch_clears_obsolete_boundary_bodies_without_changing_totals():
    data = progress._empty()
    data["last_ts"] = 200
    data["last_ts_counts"] = {"old event body": 99}
    progress.ingest(data, [], new_batch=True)
    assert data["stats"]["tools"] == 0 and data["xp"] == 0
    assert data["last_ts"] == 200 and data["last_ts_counts"] == {}


def test_unrepresentable_source_clock_counts_work_without_clock_based_badges():
    data = progress._empty()
    progress.ingest(data, [
        {"event": "session_start", "ts": 1e300, "session_id": "bad-clock"},
        {"event": "tool_start", "ts": 1000, "session_id": "healthy", "tool_name": "Read"},
    ], new_batch=True)
    assert data["stats"]["sessions"] == 1 and data["stats"]["tools"] == 1
    assert "first_shift" in data["unlocks"]
    assert "night_owl" not in data["unlocks"] and "early_bird" not in data["unlocks"]


def test_malformed_source_timestamps_do_not_poison_following_progress_events():
    data = progress._empty()
    events = [{"event": "session_start", "ts": value} for value in (float("nan"), float("inf"), 10 ** 400, "invalid")]
    events.append({"event": "tool_start", "ts": 1000, "tool_name": "Read"})
    progress.ingest(data, events, new_batch=True)
    assert data["stats"]["sessions"] == 0 and data["stats"]["tools"] == 1


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
    assert sum(bool(c["reward"]) for c in catalog) == 14
    fish = next(c for c in catalog if c["id"] == "pet_fish")
    assert fish["reward"] == "Lounge aquarium"
    assert fish["xp"] == 20
    assert all(isinstance(c["xp"], int) and c["xp"] >= 0 for c in catalog)


def test_normalize_achievements_preserves_current_rewards_and_earned_totals():
    data = progress._empty()
    data.update(xp=80, last_ts=14, last_ts_counts=None)
    data["stats"].update(tools=3, custom_counter=12)
    data["unlocks"] = {
        "architect": {"at": 1, "name": "Architect"},
        "future_or_removed_badge": {"at": 2, "name": "Old badge"},
        **{badge["id"]: {"at": 3, "name": "Old label", "unused": True}
           for badge in progress.CATALOG},
    }
    data["recent"] = [
        {"id": "architect", "at": 1, "name": "Architect"},
        {"id": "future_or_removed_badge", "at": 2},
        {"id": "codex_desk", "at": 3, "name": "Old label", "hint": "Old hint", "unused": True},
    ]
    expected_stats = deepcopy(data["stats"])
    assert progress.normalize_achievements(data) is True
    assert set(data["unlocks"]) == {badge["id"] for badge in progress.CATALOG}
    codex = next(badge for badge in progress.CATALOG if badge["id"] == "codex_desk")
    assert data["unlocks"]["codex_desk"] == {"at": 3, "name": codex["name"]}
    assert data["recent"] == [{"id": "codex_desk", "at": 3,
                              "name": codex["name"], "hint": codex["hint"]}]
    assert data["xp"] == 80 and data["stats"] == expected_stats
    assert data["last_ts"] == 14 and data["last_ts_counts"] is None
    assert progress.normalize_achievements(data) is False


def test_save_and_snapshot_filter_retired_records_without_mutating_the_input(tmp_path):
    data = progress._empty()
    data["xp"] = 80
    data["unlocks"] = {"architect": {"at": 1, "name": "Architect"}}
    data["recent"] = [{"id": "architect", "at": 1, "name": "Architect"}]
    original = deepcopy(data)
    snap = snapshot(data)
    assert snap["unlocks"] == [] and snap["recent"] == []
    assert snap["xp"] == 80
    path = tmp_path / "progress.json"
    save(path, data)
    saved = json.loads(path.read_text())
    assert saved["xp"] == 80
    assert saved["unlocks"] == {} and saved["recent"] == []
    assert data == original


def test_malformed_and_duplicate_recent_records_do_not_invent_or_erase_unlocks():
    data = progress._empty()
    data["xp"] = 80
    data["unlocks"] = {"first_shift": {"at": 1}, "pet_fish": None}
    data["recent"] = [None, "old", {"id": ["invalid"]},
                      {"id": "architect"}, {"id": "reader"},
                      {"id": "first_shift", "at": 1},
                      {"id": "first_shift", "at": 1},
                      {"id": "pet_fish", "at": None}]
    progress.normalize_achievements(data)
    assert data["xp"] == 80
    assert set(data["unlocks"]) == {"first_shift", "pet_fish"}
    assert data["unlocks"]["pet_fish"]["at"] is None
    assert [item["id"] for item in data["recent"]] == ["first_shift", "pet_fish"]
    assert "fish_tank" in snapshot(data)["cosmetics"]


@pytest.mark.parametrize("platforms", [
    ["cli", "telegram", "gateway", "hermes"],
    ["claude", "claude-code", "claude_code", "Claude Code"],
    ["codex", "codex-cli", "codex_cli", "Codex CLI"],
])
def test_runtime_aliases_count_as_one_runtime_without_changing_platform_statistics(platforms):
    data = progress._empty()
    ingest(data, [{"event": "session_start", "platform": platform, "ts": 1}
                  for platform in platforms], new_batch=True)
    assert "polyglot" not in data["unlocks"]
    polyglot = next(item for item in snapshot(data)["catalog"] if item["id"] == "polyglot")
    assert polyglot["progress"] == 33
    assert data["stats"]["platforms"] == sorted(platforms)
    assert data["stats"]["by_platform"] == {platform: 1 for platform in platforms}


def test_runtime_achievement_aliases_match_their_displayed_progress():
    data = progress._empty()
    ingest(data, [{"event": "session_start", "platform": platform, "ts": 1}
                  for platform in ("gateway", "opencode", "Claude Code", "Codex CLI")],
           new_batch=True)
    badges = {"two_houses", "three_houses", "polyglot", "claude_desk", "codex_desk"}
    assert badges <= data["unlocks"].keys()
    assert all(item["progress"] == 100 and item["have"]
               for item in snapshot(data)["catalog"] if item["id"] in badges)


def test_runtime_alias_fix_preserves_an_already_earned_badge_and_xp():
    data = progress._empty()
    data["xp"] = 80
    data["stats"]["platforms"] = ["cli", "gateway", "telegram"]
    data["unlocks"]["polyglot"] = {"at": 5, "name": "Polyglot"}
    ingest(data, [], new_batch=True)
    assert data["xp"] == 80
    assert data["unlocks"]["polyglot"]["at"] == 5


def test_every_declared_achievement_has_a_reachable_condition():
    data = progress._empty()
    timestamp = 1000
    platforms = ("cli", "opencode", "claude", "codex", "telegram")
    tools = ("read_file", "search_files", "Read", "write_file", "Edit",
             "web_search", "WebFetch", "terminal", "Bash", "custom")
    events = [{"event": "session_start", "platform": platforms[i % len(platforms)],
               "ts": timestamp} for i in range(100)]
    events.extend({"event": "tool_start", "tool_name": tools[i % len(tools)], "ts": timestamp}
                  for i in range(10000))
    events.extend({"event": "subagent_start", "ts": timestamp} for _ in range(10))
    events.append({"event": "approval_request", "ts": timestamp})
    # EventStore supplies the deduplicated ledger count, checked separately in
    # test_usage_duplicate_correction_prune_and_reset_share_event_transaction.
    data["stats"]["usage_reports"] = 1
    ingest(data, events, new_batch=True)
    apply_live(data, 5)
    assert len(progress.CATALOG) == 37
    assert set(data["unlocks"]) == {badge["id"] for badge in progress.CATALOG}
    assert all(badge["have"] and badge["progress"] == 100
               for badge in snapshot(data)["catalog"])
