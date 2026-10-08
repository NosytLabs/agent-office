"""Progress describes observed activity, not error counts or work quality."""
import json

import progress
from event_store import EventStore

RETIRED = {"oops", "weather_storm", "weather_sun", "deep_work", "theme_designer", "night_owl", "early_bird"}


def test_catalog_does_not_reward_errors_or_claim_deep_work():
    assert not RETIRED & {badge["id"] for badge in progress.CATALOG}


def test_errors_remain_recorded_without_creating_work_xp():
    data = progress._empty()
    events = [{"event": "tool_end", "status": "error", "session_id": "s", "call_id": str(i), "ts": i + 100} for i in range(10)]
    progress.ingest(data, events, new_batch=True)
    assert data["stats"]["errors"] == 10
    assert data["xp"] == 0
    assert not data["unlocks"]


def test_theme_preferences_are_not_work_xp():
    data = progress._empty()
    for _ in range(10):
        progress.record_theme_switch_data(data)
    assert data["xp"] == 0
    assert not data["unlocks"]


def test_grandfathered_lamp_preserves_xp_ownership_and_acquisition_time(tmp_path):
    data = progress._empty()
    data["xp"] = 450
    data["unlocks"] = {"weather_storm": {"at": 123, "name": "Stormy"}, "deep_work": {"at": 124, "name": "Deep work"}}
    data["recent"] = [{"id": "weather_storm", "name": "Stormy", "at": 123}]
    before = json.dumps(data, sort_keys=True)
    view = progress.snapshot(data)
    assert view["xp"] == 450
    assert "storm_lamp" in view["cosmetics"]
    assert {badge["id"] for badge in view["unlocks"]} == {"lounge_lamp"}
    assert view["unlocks"][0]["at"] == 123
    assert json.dumps(data, sort_keys=True) == before
    progress.save(tmp_path / "progress.json", data)
    state = EventStore(tmp_path).consume(lambda: [], 200)
    assert state["progress"]["xp"] == 450
    assert "storm_lamp" in state["progress"]["cosmetics"]
    assert not RETIRED & {badge["id"] for badge in state["progress"]["unlocks"]}


def test_lamp_is_now_earned_from_sessions_not_errors():
    data = progress._empty()
    data["stats"]["sessions"] = 5
    progress.ingest(data, [], new_batch=True)
    assert "lounge_lamp" in data["unlocks"]
    assert "storm_lamp" in progress.snapshot(data)["cosmetics"]


def test_progress_cannot_show_complete_before_the_threshold():
    data = progress._empty()
    data["stats"]["tools"] = 999
    view = progress.snapshot(data)
    badge = next(b for b in view["catalog"] if b["id"] == "thousand_cuts")
    assert badge["progress"] == 99
    assert badge["have"] is False
