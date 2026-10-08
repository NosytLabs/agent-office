"""Individual office preferences must stay separate from observed work."""
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import time
import urllib.request

import pytest
import __init__ as plugin
from event_store import EventStore


def test_pet_controls_are_boolean_and_default_on(tmp_path, monkeypatch):
    monkeypatch.setattr(plugin, "_office_dir", lambda: tmp_path)
    settings = plugin._load_settings()
    assert settings.get("show_pets") is True
    assert settings.get("pets_roam") is True
    plugin._save_settings({"show_pets": False, "pets_roam": False})
    plugin._save_settings({"show_pets": "true", "pets_roam": 1})
    assert plugin._load_settings()["show_pets"] is False
    assert plugin._load_settings()["pets_roam"] is False


def test_individual_preferences_roundtrip_without_changing_canonical_identity(tmp_path, monkeypatch):
    monkeypatch.setattr(plugin, "_office_dir", lambda: tmp_path)
    assert plugin._load_settings().get("agent_preferences") == {}
    preferences = {
        "claude/alpha": {"seat": 0, "appearance": "char4"},
        "__proto__": {"appearance": "studio-assistant"},
        "beta": {"seat": None, "appearance": "default"},
    }
    plugin._save_settings({"agent_preferences": preferences})
    expected = {
        "claude/alpha": {"seat": 0, "appearance": "char4"},
        "__proto__": {"appearance": "studio-assistant"},
    }
    assert plugin._load_settings()["agent_preferences"] == expected
    plugin._save_settings({"agent_names": {"claude/alpha": "Same name", "beta": "Same name"}})
    assert plugin._load_settings()["agent_preferences"] == expected
    assert json.loads((tmp_path / "settings.json").read_text())["agent_preferences"] == expected


@pytest.mark.parametrize("invalid", [
    None, [],
    {"a": {"seat": -1}}, {"a": {"seat": 128}}, {"a": {"seat": 1.5}},
    {"a": {"seat": True}}, {"a": {"seat": "2"}},
    {"a": {"appearance": "https://example.com/character.png"}},
    {"a": {"appearance": "char6"}}, {"a": {"hue": 80}},
    {"a": {"seat": 1}, "b": {"appearance": []}},
    {"": {"seat": 1}}, {"bad\nidentity": {"seat": 1}},
    {"x" * 513: {"seat": 1}},
    {f"agent-{i}": {"seat": i % 128} for i in range(129)},
])
def test_invalid_maps_leave_previous_preferences_intact(tmp_path, monkeypatch, invalid):
    monkeypatch.setattr(plugin, "_office_dir", lambda: tmp_path)
    previous = {"a": {"seat": 7, "appearance": "char2"}}
    plugin._save_settings({"agent_preferences": previous})
    assert plugin._load_settings().get("agent_preferences") == previous
    plugin._save_settings({"agent_preferences": invalid, "theme": "juniper"})
    assert plugin._load_settings()["agent_preferences"] == previous
    assert plugin._load_settings()["theme"] == "juniper"


def test_maximum_preferences_and_default_reset_are_supported(tmp_path, monkeypatch):
    monkeypatch.setattr(plugin, "_office_dir", lambda: tmp_path)
    preferences = {f"agent-{i}": {"seat": i, "appearance": f"char{i % 6}"} for i in range(128)}
    plugin._save_settings({"agent_preferences": preferences})
    assert plugin._load_settings().get("agent_preferences") == preferences
    plugin._save_settings({"agent_preferences": {}})
    assert plugin._load_settings()["agent_preferences"] == {}


def test_long_canonical_name_keys_remain_distinct_and_match_preferences(tmp_path, monkeypatch):
    monkeypatch.setattr(plugin, "_office_dir", lambda: tmp_path)
    first, second = "a" * 200 + "one", "a" * 200 + "two"
    names = {first: "First person", second: "Second person", "short": "Existing name"}
    preferences = {first: {"appearance": "char1"}, second: {"appearance": "char2"}}
    plugin._save_settings({"agent_names": names, "agent_preferences": preferences})
    saved = plugin._load_settings()
    assert saved["agent_names"] == names
    assert saved["agent_preferences"] == preferences
    plugin._save_settings({"agent_names": {"a" * 513: "Invalid identity"}})
    assert plugin._load_settings()["agent_names"] == names


def test_personalization_saves_leave_history_usage_and_progress_unchanged(tmp_path, monkeypatch):
    monkeypatch.setattr(plugin, "_office_dir", lambda: tmp_path)
    events = [
        {"ts": 990, "event": "session_start", "session_id": "alpha", "platform": "claude"},
        {"ts": 991, "event": "tool_start", "session_id": "alpha", "tool_name": "Read"},
        {"ts": 992, "event": "usage", "session_id": "alpha", "platform": "claude", "usage_id": "one",
         "input_tokens": 20, "output_tokens": 5, "cost_usd": 0, "cost_source": "Synthetic test"},
    ]
    EventStore(tmp_path).consume(lambda: events, 1000)
    with sqlite3.connect(tmp_path / "office.sqlite3") as db:
        before = {table: db.execute(f"SELECT * FROM {table}").fetchall()
                  for table in ("checkpoint", "history", "usage_units", "usage_totals")}
    progress = (tmp_path / "progress.json").read_bytes()
    for seat, appearance in ((0, "char0"), (5, "char5"), (1, "studio-assistant"), (2, "moss-engineer"), (3, "orbit-courier")):
        plugin._save_settings({"agent_preferences": {"alpha": {"seat": seat, "appearance": appearance}},
                               "show_pets": seat == 0, "pets_roam": seat == 1})
    assert plugin._load_settings().get("agent_preferences") == {"alpha": {"seat": 3, "appearance": "orbit-courier"}}
    with sqlite3.connect(tmp_path / "office.sqlite3") as db:
        after = {table: db.execute(f"SELECT * FROM {table}").fetchall()
                 for table in before}
    assert after == before
    assert (tmp_path / "progress.json").read_bytes() == progress


def test_settings_endpoint_persists_personalization_without_creating_observations(tmp_path):
    root = Path(__file__).resolve().parents[1]
    directory = tmp_path / "pixel-office"
    directory.mkdir()
    now = time.time()
    events = [
        {"ts": now, "event": "session_start", "session_id": "alpha", "platform": "claude"},
        {"ts": now, "event": "usage", "session_id": "alpha", "platform": "claude", "usage_id": "http-one",
         "input_tokens": 20, "output_tokens": 5, "cost_usd": 0, "cost_source": "Synthetic test"},
    ]
    (directory / "events.jsonl").write_text("\n".join(json.dumps(event) for event in events))
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    env = {**os.environ, "HERMES_HOME": str(tmp_path)}
    env.pop("AGENT_OFFICE_DEMO", None)
    server = subprocess.Popen([sys.executable, str(root / "run.py"), "--port", str(port)],
                              env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f"http://127.0.0.1:{port}"

    def request(path, payload=None):
        req = urllib.request.Request(url + path)
        if payload is not None:
            with urllib.request.urlopen(url + "/settings", timeout=2) as current:
                revision = current.headers["ETag"]
            req = urllib.request.Request(url + path, data=json.dumps(payload).encode(),
                                         headers={"Content-Type": "application/json", "If-Match": revision}, method="POST")
        with urllib.request.urlopen(req, timeout=2) as response:
            return json.load(response)

    try:
        for _ in range(50):
            try:
                before = request("/state")
                break
            except OSError:
                assert server.poll() is None, "standalone server exited"
                time.sleep(0.05)
        else:
            raise AssertionError("standalone server did not start")
        assert [agent["id"] for agent in before["agents"]] == ["alpha"]
        assert before["usage"]["totals"]["total_tokens"] == 25
        preferences = {"alpha": {"seat": 7, "appearance": "studio-assistant"}}
        saved = request("/settings", {"agent_preferences": preferences, "show_pets": False, "pets_roam": False})
        assert saved["agent_preferences"] == preferences
        assert saved["show_pets"] is False and saved["pets_roam"] is False
        request("/settings", {"agent_preferences": {"alpha": {"seat": 128}},
                              "agent_names": {"alpha": "Renamed"}})
        after = request("/state")
        assert after["settings"]["agent_preferences"] == preferences
        assert after["agents"][0]["id"] == "alpha"
        assert after["agents"][0]["label"] == "Renamed"
        for field in ("progress", "usage", "events"):
            assert after[field] == before[field]
        assert after["tracking"]["received"] == before["tracking"]["received"]
        assert after["tracking"]["retained"] == before["tracking"]["retained"]
        assert request("/settings")["agent_preferences"] == preferences
        assert json.loads((directory / "settings.json").read_text())["agent_preferences"] == preferences
    finally:
        server.terminate()
        try:
            server.wait(timeout=3)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=3)
