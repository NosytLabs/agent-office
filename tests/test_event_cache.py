"""Reuse unchanged logs without retaining stale files or leaking cached data."""
import builtins
import json
import os
from pathlib import Path

import pytest

import __init__ as plugin
from event_inbox import publish


@pytest.fixture
def log_reader(tmp_path, monkeypatch):
    monkeypatch.setattr(plugin, "_office_dir", lambda: tmp_path)
    counts = {"bytes": 0, "json": 0}

    class MeteredFile:
        def __init__(self, handle):
            self.handle = handle

        def __getattr__(self, key):
            return getattr(self.handle, key)

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return self.handle.__exit__(*args)

        def __iter__(self):
            for line in self.handle:
                counts["bytes"] += len(line.encode("utf-8") if isinstance(line, str) else line)
                yield line

        def read(self, *args):
            data = self.handle.read(*args)
            counts["bytes"] += len(data.encode("utf-8") if isinstance(data, str) else data)
            return data

    def metered_open(filename, *args, **kwargs):
        handle = builtins.open(filename, *args, **kwargs)
        return MeteredFile(handle) if Path(filename).name == "events.jsonl" else handle

    original_loads = json.loads

    def metered_loads(value, *args, **kwargs):
        result = original_loads(value, *args, **kwargs)
        if isinstance(result, dict) and "event" in result:
            counts["json"] += 1
        return result

    monkeypatch.setattr(plugin, "open", metered_open, raising=False)
    monkeypatch.setattr(plugin.json, "loads", metered_loads)
    return tmp_path / "events.jsonl", counts


def test_unchanged_state_poll_reads_and_decodes_no_event_log_bytes(log_reader):
    path, counts = log_reader
    path.write_text('{"ts": 1, "event": "session_start", "session_id": "a"}\n')
    first = plugin.build_state()
    first_counts = dict(counts)
    assert first_counts["bytes"] > 0 and first_counts["json"] == 1
    second = plugin.build_state()
    assert second["events"] == first["events"]
    assert counts == first_counts


@pytest.mark.parametrize("change", ["append", "rewrite", "rotation", "deletion"])
def test_changed_log_invalidates_cached_events(log_reader, change):
    path, counts = log_reader
    one = '{"ts": 1, "event": "session_start", "session_id": "a"}\n'
    two = one.replace('"a"', '"b"')
    path.write_text(one)
    assert plugin._read_events()[0]["session_id"] == "a"
    previous = dict(counts)
    stat = path.stat()
    if change == "append":
        with path.open("a") as handle:
            handle.write(two)
        expected = ["a", "b"]
    elif change == "rewrite":
        path.write_text(two)
        # Size and mtime alone cannot detect an in-place edit with restored mtime.
        os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))
        expected = ["b"]
    elif change == "rotation":
        replacement = path.with_suffix(".replacement")
        replacement.write_text(two)
        os.utime(replacement, ns=(stat.st_atime_ns, stat.st_mtime_ns))
        replacement.replace(path)
        expected = ["b"]
    else:
        path.unlink()
        expected = []
    assert [event["session_id"] for event in plugin._read_events()] == expected
    if change != "deletion":
        assert counts["bytes"] > previous["bytes"]
    else:
        path.write_text(two)
        assert plugin._read_events()[0]["session_id"] == "b"


def test_only_one_current_log_is_cached(log_reader, tmp_path, monkeypatch):
    path, counts = log_reader
    path.write_text('{"ts": 1, "event": "session_start", "session_id": "a"}\n')
    second_dir = tmp_path / "another-office"
    second_dir.mkdir()
    (second_dir / "events.jsonl").write_text('{"ts": 1, "event": "session_start", "session_id": "b"}\n')
    assert plugin._read_events()[0]["session_id"] == "a"
    monkeypatch.setattr(plugin, "_office_dir", lambda: second_dir)
    assert plugin._read_events()[0]["session_id"] == "b"
    previous = dict(counts)
    monkeypatch.setattr(plugin, "_office_dir", lambda: tmp_path)
    assert plugin._read_events()[0]["session_id"] == "a"
    assert counts["bytes"] > previous["bytes"]


def test_returned_state_and_reader_results_cannot_mutate_cached_events(log_reader, monkeypatch):
    path, counts = log_reader
    monkeypatch.setattr(plugin.time, "time", lambda: 1000.0)
    original = {
        "ts": 990, "event": "tool_start", "session_id": "a", "tool_name": "Read",
        "extra": {"paths": ["one.py"]},
    }
    path.write_text(json.dumps(original) + "\n")
    state = plugin.build_state()
    state["events"][0]["extra"]["paths"].append("mutated.py")
    state["agents"][0]["tool"] = "mutated tool"
    events = plugin._read_events()
    assert events == [original]
    events[0]["extra"]["paths"].clear()
    events.append({"event": "invalid"})
    after = plugin.build_state()
    assert after["events"] == [original]
    assert after["agents"][0]["tool"] == "Read"


def test_file_modified_during_read_is_not_cached(log_reader, monkeypatch):
    path, counts = log_reader
    first_line = '{"ts": 1, "event": "session_start", "session_id": "a"}\n'
    second_line = first_line.replace('"a"', '"b"')
    path.write_text(first_line)
    original_loads = plugin.json.loads
    appended = False

    def append_while_reading(value, *args, **kwargs):
        nonlocal appended
        result = original_loads(value, *args, **kwargs)
        if not appended:
            appended = True
            with path.open("a") as handle:
                handle.write(second_line)
        return result

    monkeypatch.setattr(plugin.json, "loads", append_while_reading)
    plugin._read_events()
    previous = dict(counts)
    assert [event["session_id"] for event in plugin._read_events()] == ["a", "b"]
    assert counts["bytes"] > previous["bytes"]
    stable_counts = dict(counts)
    plugin._read_events()
    assert counts == stable_counts


def _interrupt_legacy_read(monkeypatch, *, during_iteration):
    original = builtins.open

    class InterruptedFile:
        def __init__(self, handle):
            self.handle = handle

        def __getattr__(self, name):
            return getattr(self.handle, name)

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return self.handle.__exit__(*args)

        def __iter__(self):
            yield next(iter(self.handle))
            raise PermissionError("legacy reader interrupted after a valid prefix")

    def interrupted(filename, *args, **kwargs):
        if Path(filename).name != "events.jsonl":
            return original(filename, *args, **kwargs)
        if not during_iteration:
            raise PermissionError("legacy reader temporarily unavailable")
        return InterruptedFile(original(filename, *args, **kwargs))

    monkeypatch.setattr(plugin, "open", interrupted, raising=False)
    monkeypatch.setattr(plugin, "_event_cache", None)


@pytest.mark.parametrize("during_iteration", [False, True])
def test_legacy_read_failure_preserves_cursor_and_live_work_while_inbox_drains(tmp_path, monkeypatch, during_iteration):
    monkeypatch.setattr(plugin, "_office_dir", lambda: tmp_path)
    monkeypatch.setattr(plugin.time, "time", lambda: 1000)
    path = tmp_path / "events.jsonl"
    events = [
        {"ts": 990, "event": "session_start", "session_id": "alpha", "platform": "opencode"},
        {"ts": 991, "event": "tool_start", "session_id": "alpha", "platform": "opencode", "tool_name": "Read", "tool_call_id": "one"},
    ]
    path.write_text("".join(json.dumps(event) + "\n" for event in events))
    before = plugin.build_state()
    assert before["agents"][0]["tool"] == "Read"
    events.append({"ts": 992, "event": "tool_end", "session_id": "alpha", "platform": "opencode", "tool_name": "Read", "tool_call_id": "one"})
    path.write_text("".join(json.dumps(event) + "\n" for event in events))
    publish(tmp_path, {"ts": 999, "event": "session_start", "session_id": "beta", "platform": "claude"})
    with monkeypatch.context() as failure:
        _interrupt_legacy_read(failure, during_iteration=during_iteration)
        with pytest.raises(OSError):
            plugin._read_events()
        state = plugin.build_state()
        agents = {agent["id"]: agent for agent in state["agents"]}
        assert agents["alpha"]["tool"] == "Read"
        assert agents["beta"]["status"] == "idle"
        assert state["progress"]["stats"]["tools"] == 1
        assert state["tracking"]["received"] == 3
        assert "legacy_log_read" in state["tracking"]["measurement_errors"]
    recovered = plugin.build_state()
    assert next(agent for agent in recovered["agents"] if agent["id"] == "alpha")["tool"] == ""
    assert recovered["progress"]["stats"]["tools"] == 1
    assert recovered["tracking"]["received"] == 4
    assert "legacy_log_read" not in recovered["tracking"]["measurement_errors"]


def test_reset_cannot_use_an_unreadable_legacy_prefix_as_its_boundary(tmp_path, monkeypatch):
    monkeypatch.setattr(plugin, "_office_dir", lambda: tmp_path)
    monkeypatch.setattr(plugin.time, "time", lambda: 1000)
    path = tmp_path / "events.jsonl"
    path.write_text('{"ts":990,"event":"tool_start","session_id":"alpha","tool_name":"Read"}\n')
    before = plugin.build_state()
    fence = (tmp_path / "event-epoch").read_bytes()
    with monkeypatch.context() as failure:
        _interrupt_legacy_read(failure, during_iteration=False)
        with pytest.raises(OSError):
            plugin._store().reset(plugin._read_event_snapshot)
    assert (tmp_path / "event-epoch").read_bytes() == fence
    after = plugin.build_state()
    for field in ("progress", "usage", "agents", "events"):
        assert after[field] == before[field]
