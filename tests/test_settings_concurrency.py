"""Settings edits preserve the file and require a current revision over HTTP."""
from __future__ import annotations

import concurrent.futures
import json
import multiprocessing
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

import pytest

import __init__ as plugin


@pytest.mark.parametrize("original", [b'{"room_name":"Saved room",', b'[]', b'null', b'"text"', b'\xff'])
def test_unreadable_settings_cannot_be_replaced_by_an_unrelated_edit(tmp_path, monkeypatch, original):
    monkeypatch.setattr(plugin, "_office_dir", lambda: tmp_path)
    path = tmp_path / "settings.json"
    path.write_bytes(original)
    with pytest.raises(plugin.SettingsUnavailable):
        plugin._save_settings({"sound": True})
    assert path.read_bytes() == original


def test_transient_settings_read_error_preserves_file_and_recovers(tmp_path, monkeypatch):
    monkeypatch.setattr(plugin, "_office_dir", lambda: tmp_path)
    path = tmp_path / "settings.json"
    original = b'{"room_name":"Saved room","furniture":[{"kind":"sofa","x":0.4,"y":0.8}]}'
    path.write_bytes(original)
    read = Path.read_bytes

    def blocked(self):
        if self == path:
            raise PermissionError("test file is temporarily unavailable")
        return read(self)

    with monkeypatch.context() as context:
        context.setattr(Path, "read_bytes", blocked)
        with pytest.raises(plugin.SettingsUnavailable):
            plugin._save_settings({"sound": True})
    assert path.read_bytes() == original
    plugin._save_settings({"sound": True})
    assert plugin._load_settings()["room_name"] == "Saved room"
    assert plugin._load_settings()["furniture"] == [{"kind": "sofa", "x": 0.4, "y": 0.8}]


def test_corrupt_settings_are_visible_without_stopping_observation(tmp_path, monkeypatch):
    monkeypatch.setattr(plugin, "_office_dir", lambda: tmp_path)
    (tmp_path / "settings.json").write_text('{"room_name":')
    (tmp_path / "events.jsonl").write_text(json.dumps({
        "event": "session_start", "session_id": "live", "platform": "opencode", "ts": 100,
    }) + "\n")
    monkeypatch.setattr(plugin.time, "time", lambda: 101)
    state = plugin.build_state()
    assert state.get("settings_status", {}).get("available") is False
    assert state.get("settings_revision") is None
    assert [agent["id"] for agent in state["agents"]] == ["live"]
    (tmp_path / "settings.json").write_text('{"room_name":"Repaired"}')
    repaired = plugin.build_state()
    assert repaired["settings_status"]["available"] is True
    assert repaired["settings"]["room_name"] == "Repaired"
    assert repaired["settings_revision"]


def test_stale_replacement_preserves_other_views_preferences(tmp_path, monkeypatch):
    monkeypatch.setattr(plugin, "_office_dir", lambda: tmp_path)
    revision = plugin.build_state().get("settings_revision")
    assert revision, "A readable settings snapshot needs a revision before it is editable"
    plugin._save_settings({"agent_names": {"alpha": "Alpha"}}, expected_revision=revision)
    with pytest.raises(plugin.SettingsConflict):
        plugin._save_settings({"agent_names": {"beta": "Beta"}}, expected_revision=revision)
    assert plugin._load_settings()["agent_names"] == {"alpha": "Alpha"}
    refreshed = plugin.build_state()["settings_revision"]
    plugin._save_settings({"agent_names": {"alpha": "Alpha", "beta": "Beta"}}, expected_revision=refreshed)
    assert plugin._load_settings()["agent_names"] == {"alpha": "Alpha", "beta": "Beta"}


def test_explicit_clear_uses_current_revision_and_old_revision_cannot_restore_it(tmp_path, monkeypatch):
    monkeypatch.setattr(plugin, "_office_dir", lambda: tmp_path)
    plugin._save_settings({"pet_names": {"cat1": "Miso", "cat2": "Bean"}})
    revision = plugin.build_state().get("settings_revision")
    assert revision
    plugin._save_settings({"pet_names": {}}, expected_revision=revision)
    with pytest.raises(plugin.SettingsConflict):
        plugin._save_settings({"pet_names": {"cat2": "Old view"}}, expected_revision=revision)
    assert plugin._load_settings()["pet_names"] == {}


def test_default_collections_are_independent_reads(tmp_path, monkeypatch):
    monkeypatch.setattr(plugin, "_office_dir", lambda: tmp_path)
    defaults = plugin._load_settings()
    defaults["furniture"].append({"kind": "sofa", "x": 0.5, "y": 0.8})
    defaults["agent_names"]["alpha"] = "Changed locally"
    assert plugin._load_settings()["furniture"] == []
    assert plugin._load_settings()["agent_names"] == {}


def test_excessively_nested_settings_are_preserved_without_stopping_observation(tmp_path, monkeypatch):
    monkeypatch.setattr(plugin, "_office_dir", lambda: tmp_path)
    path = tmp_path / "settings.json"
    original = b'{"unknown":' + b'[' * 20000 + b'0' + b']' * 20000 + b'}'
    path.write_bytes(original)
    state = plugin.build_state()
    assert state["settings_status"]["available"] is False
    with pytest.raises(plugin.SettingsUnavailable):
        plugin._save_settings({"sound": True})
    assert path.read_bytes() == original


@pytest.mark.parametrize("field,value", [
    ("budget_usd", 10 ** 400),
    ("music_volume", 10 ** 400),
    ("furniture", [{"kind": "sofa", "x": 10 ** 400, "y": 0.8}]),
], ids=["budget", "volume", "furniture"])
def test_out_of_range_numbers_do_not_stop_observation_or_rewrite_the_source(tmp_path, monkeypatch, field, value):
    monkeypatch.setattr(plugin, "_office_dir", lambda: tmp_path)
    path = tmp_path / "settings.json"
    original = json.dumps({"room_name": "Saved room", field: value}).encode()
    path.write_bytes(original)
    state = plugin.build_state()
    assert state["settings_status"]["available"] is True
    assert state["settings"]["room_name"] == "Saved room"
    assert state["settings"][field] == plugin._DEFAULTS[field]
    assert path.read_bytes() == original


def _save_from_process(arguments):
    from settings_store import SettingsStore, SettingsConflict
    directory, index = arguments
    store = SettingsStore(Path(directory) / "settings.json", {"agent_names": {}}, dict)
    try:
        store.save({"agent_names": {str(index): f"Agent {index}"}}, "missing")
        return index
    except SettingsConflict:
        return None


def test_independent_server_processes_cannot_accept_the_same_revision(tmp_path):
    context = multiprocessing.get_context("spawn")
    with concurrent.futures.ProcessPoolExecutor(max_workers=4, mp_context=context) as pool:
        results = list(pool.map(_save_from_process, [(str(tmp_path), index) for index in range(8)]))
    winners = [index for index in results if index is not None]
    assert len(winners) == 1
    index = winners[0]
    assert json.loads((tmp_path / "settings.json").read_text())["agent_names"] == {str(index): f"Agent {index}"}
    assert list(tmp_path.glob("settings-*.tmp")) == []


@pytest.fixture
def settings_server(tmp_path):
    root = Path(__file__).resolve().parents[1]
    directory = tmp_path / "pixel-office"
    directory.mkdir()
    (directory / "events.jsonl").write_text(json.dumps({
        "event": "session_start", "session_id": "observed", "platform": "opencode", "ts": time.time(),
    }) + "\n")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    environment = {**os.environ, "HERMES_HOME": str(tmp_path)}
    environment.pop("AGENT_OFFICE_DEMO", None)
    process = subprocess.Popen([sys.executable, str(root / "run.py"), "--port", str(port)],
                               env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f"http://127.0.0.1:{port}"

    def request(route, payload=None, condition=None, *, raw=None):
        headers = {"Content-Type": "application/json"}
        if condition is not None:
            headers["If-Match"] = condition
        body = raw if raw is not None else None if payload is None else json.dumps(payload).encode()
        call = urllib.request.Request(url + route, headers=headers, data=body,
            method="GET" if body is None else "POST")
        try:
            response = urllib.request.urlopen(call, timeout=7)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.load(response), response.headers

    try:
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            try:
                status, _, _ = request("/settings")
                assert status == 200
                break
            except OSError:
                assert process.poll() is None, "observer exited before HTTP was ready"
                time.sleep(0.02)
        else:
            raise AssertionError("observer HTTP server did not start")
        yield request, directory
    finally:
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)


def test_http_requires_exact_revision_and_returns_the_saved_snapshot(settings_server):
    request, directory = settings_server
    status, _, headers = request("/settings")
    assert status == 200 and headers["ETag"] == '"missing"'
    status, state, _ = request("/state")
    assert status == 200 and state["settings_revision"] == "missing"
    assert state["settings_status"] == {"available": True}
    for condition, expected in [(None, 428), ("*", 400), ('W/"missing"', 400), ("missing", 400)]:
        status, body, _ = request("/settings", {"agent_names": {"alpha": "Alpha"}}, condition)
        assert status == expected and body["error"]
        assert not (directory / "settings.json").exists()
    status, saved, first = request("/settings", {"agent_names": {"alpha": "Alpha"}}, headers["ETag"])
    assert status == 200 and saved["agent_names"] == {"alpha": "Alpha"}
    assert first["ETag"] != headers["ETag"]
    status, stale, _ = request("/settings", {"agent_names": {"beta": "Beta"}}, headers["ETag"])
    assert status == 409 and stale["settings"]["agent_names"] == {"alpha": "Alpha"}
    assert f'"{stale["settings_revision"]}"' == first["ETag"]
    status, saved, second = request("/settings", {"agent_names": {"alpha": "Alpha", "beta": "Beta"}}, first["ETag"])
    assert status == 200 and saved["agent_names"] == {"alpha": "Alpha", "beta": "Beta"}
    assert second["ETag"] != first["ETag"]
    assert json.loads((directory / "settings.json").read_text()) == saved
    _, state, _ = request("/state")
    assert state["settings"] == saved
    assert f'"{state["settings_revision"]}"' == second["ETag"]


def test_http_preserves_corrupt_settings_while_observation_and_repair_work(settings_server):
    request, directory = settings_server
    _, _, headers = request("/settings")
    original = b'{"room_name":"Do not lose me",'
    (directory / "settings.json").write_bytes(original)
    for payload in (None, {"sound": True}):
        status, failed, _ = request("/settings", payload, headers["ETag"])
        assert status == 503 and failed["settings_status"]["available"] is False
        assert failed["settings_revision"] is None
        assert (directory / "settings.json").read_bytes() == original
    status, state, _ = request("/state")
    assert status == 200 and [agent["id"] for agent in state["agents"]] == ["observed"]
    assert state["settings_status"]["available"] is False
    (directory / "settings.json").write_text('{"room_name":"Repaired room"}')
    status, repaired, headers = request("/settings")
    assert status == 200 and repaired["room_name"] == "Repaired room"
    status, saved, _ = request("/settings", {"sound": True}, headers["ETag"])
    assert status == 200 and saved["room_name"] == "Repaired room" and saved["sound"] is True


def test_http_storage_lock_failure_reports_retryable_error_without_losing_settings(settings_server):
    request, directory = settings_server
    _, _, headers = request("/settings")
    status, _, headers = request("/settings", {"room_name": "Saved room"}, headers["ETag"])
    assert status == 200
    original = (directory / "settings.json").read_bytes()
    database = directory / "office.sqlite3"
    held = directory / "office-held.sqlite3"
    database.rename(held)
    database.mkdir()
    try:
        status, failed, _ = request("/settings", {"room_name": "Not saved"}, headers["ETag"])
        assert status == 503 and "try again" in failed["error"]
        assert (directory / "settings.json").read_bytes() == original
    finally:
        database.rmdir()
        held.rename(database)
    status, saved, _ = request("/settings", {"sound": True}, headers["ETag"])
    assert status == 200 and saved["room_name"] == "Saved room" and saved["sound"] is True


def test_http_rejects_excessively_nested_json_without_closing_connection(settings_server):
    request, directory = settings_server
    _, _, headers = request("/settings")
    original = b'{"unknown":' + b'[' * 20000 + b'0' + b']' * 20000 + b'}'
    status, failed, _ = request("/settings", condition=headers["ETag"], raw=original)
    assert status == 400 and failed["error"]
    assert not (directory / "settings.json").exists()
    (directory / "settings.json").write_bytes(original)
    status, state, _ = request("/state")
    assert status == 200 and state["settings_status"]["available"] is False
    assert [agent["id"] for agent in state["agents"]] == ["observed"]
    assert (directory / "settings.json").read_bytes() == original


def test_http_ignores_out_of_range_numeric_patches_without_losing_valid_preferences(settings_server):
    request, _ = settings_server
    _, _, headers = request("/settings")
    previous = [{"kind": "sofa", "x": 0.4, "y": 0.8}]
    _, _, headers = request("/settings", {"room_name": "Saved room", "furniture": previous}, headers["ETag"])
    status, saved, _ = request("/settings", {
        "budget_usd": 10 ** 400, "music_volume": 10 ** 400,
        "furniture": [{"kind": "sofa", "x": 10 ** 400, "y": 0.8}],
    }, headers["ETag"])
    assert status == 200 and saved["room_name"] == "Saved room"
    assert saved["budget_usd"] == plugin._DEFAULTS["budget_usd"]
    assert saved["music_volume"] == plugin._DEFAULTS["music_volume"]
    assert saved["furniture"] == previous


@pytest.mark.parametrize("invalid", [
    [{"kind": "sofa", "x": 0.4, "y": 0.8}, {"kind": "stool", "x": -1, "y": 0.8}],
    [{"kind": "sofa", "x": 0.4, "y": 0.8}] * 25,
], ids=["invalid-row", "too-many"])
def test_invalid_furniture_patch_cannot_partially_replace_the_saved_layout(tmp_path, monkeypatch, invalid):
    monkeypatch.setattr(plugin, "_office_dir", lambda: tmp_path)
    previous = [{"kind": "stool", "x": 0.3, "y": 0.8}]
    plugin._save_settings({"furniture": previous})
    plugin._save_settings({"furniture": invalid})
    assert plugin._load_settings()["furniture"] == previous


@pytest.mark.parametrize("failure_kind", ["corrupt", "denied", "invalid-count", "invalid-age", "invalid-bytes"])
def test_unavailable_settings_never_apply_a_shorter_default_history_policy(tmp_path, monkeypatch, failure_kind):
    monkeypatch.setattr(plugin, "_office_dir", lambda: tmp_path)
    monkeypatch.setattr(plugin.time, "time", lambda: 10000)
    plugin._save_settings({"history_limit": 5000, "history_days": 30, "history_max_bytes": 20 * 1024 * 1024})
    path = tmp_path / "settings.json"
    original = path.read_bytes()
    rows = [{"event": "session_update", "session_id": "alpha", "ts": 9000 + index / 100,
             "title": f"record {index}"} for index in range(1001)]
    (tmp_path / "events.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))
    before = plugin.build_state()
    assert before["tracking"]["retained"] == 1001
    with monkeypatch.context() as unavailable:
        if failure_kind == "corrupt":
            path.write_bytes(b'{"history_limit":')
        elif failure_kind.startswith("invalid-"):
            broken = json.loads(original)
            key, value = {
                "invalid-count": ("history_limit", "5000"),
                "invalid-age": ("history_days", 29),
                "invalid-bytes": ("history_max_bytes", None),
            }[failure_kind]
            broken[key] = value
            path.write_text(json.dumps(broken))
        else:
            read = Path.read_bytes
            def denied(file):
                if file == path:
                    raise PermissionError("settings cannot currently be read")
                return read(file)
            unavailable.setattr(Path, "read_bytes", denied)
        state = plugin.build_state()
        assert state["settings_status"]["available"] is False
        assert state["tracking"]["retained"] == 1001
        assert state["tracking"]["retention_suspended"] is True
        # Keep observing new work during the settings failure.
        from event_inbox import publish
        publish(tmp_path, {"event": "tool_start", "session_id": "beta", "platform": "opencode", "tool_name": "Read", "ts": 10000})
        state = plugin.build_state()
        assert state["tracking"]["retained"] == 1002
        assert next(agent for agent in state["agents"] if agent["id"] == "beta")["tool"] == "Read"
    path.write_bytes(original)
    restored = plugin.build_state()
    assert restored["tracking"]["retained"] == 1002
    assert restored["tracking"]["retention_suspended"] is False
    # Once the user deliberately selects a shorter policy, pruning resumes.
    plugin._save_settings({"history_limit": 1000})
    assert plugin.build_state()["tracking"]["retained"] == 1000
