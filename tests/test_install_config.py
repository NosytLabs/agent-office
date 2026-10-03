from __future__ import annotations

import json
from pathlib import Path

import install
import pytest


def test_load_json_config_returns_empty_for_missing_and_reports_invalid_file(tmp_path):
    assert install.load_json_config(tmp_path / "missing.json") == {}
    broken = tmp_path / "broken.json"
    broken.write_text("{not json")
    with pytest.raises(ValueError):
        install.load_json_config(broken)


def test_save_json_config_is_atomic_and_keeps_valid_object(tmp_path):
    path = tmp_path / "config.json"
    install.save_json_config(path, {"plugin": ["existing"], "enabled": True})
    assert json.loads(path.read_text()) == {"plugin": ["existing"], "enabled": True}
    assert not list(tmp_path.glob("*.tmp"))


def test_save_json_config_rejects_non_object_payload(tmp_path):
    path = tmp_path / "config.json"
    try:
        install.save_json_config(path, ["not", "a", "mapping"])
    except ValueError as exc:
        assert "JSON object" in str(exc)
    else:
        raise AssertionError("expected ValueError")


@pytest.mark.parametrize("bucket", [{}, [None], [{"hooks": "invalid"}], [{"hooks": [None]}]])
def test_claude_invalid_hook_bucket_is_reported_without_writing(tmp_path, monkeypatch, bucket):
    monkeypatch.setattr(install, "HOME", tmp_path)
    path = tmp_path / ".claude/settings.json"
    path.parent.mkdir(parents=True)
    original = json.dumps({"hooks": {"PostToolUse": bucket}, "unrelated": True})
    path.write_text(original)
    assert "skip claude" in install.enable_claude()
    assert path.read_text() == original


@pytest.mark.parametrize("runtime,relative_path,enable", [
    ("opencode", ".config/opencode/opencode.json", install.enable_opencode),
    ("claude", ".claude/settings.json", install.enable_claude),
])
def test_installer_accepts_an_existing_empty_json_object(tmp_path, monkeypatch, runtime, relative_path, enable):
    monkeypatch.setattr(install, "HOME", tmp_path)
    path = tmp_path / relative_path
    path.parent.mkdir(parents=True)
    path.write_text("{}")
    result = enable()
    data = json.loads(path.read_text())
    assert "skip" not in result
    assert data.get("plugin") if runtime == "opencode" else data.get("hooks")


@pytest.mark.parametrize("relative_path,enable", [
    (".config/opencode/opencode.json", install.enable_opencode),
    (".claude/settings.json", install.enable_claude),
])
def test_installer_reports_non_object_json_without_replacing_it(tmp_path, monkeypatch, relative_path, enable):
    monkeypatch.setattr(install, "HOME", tmp_path)
    path = tmp_path / relative_path
    path.parent.mkdir(parents=True)
    path.write_text('["unrelated existing config"]')
    try:
        result = enable()
    except ValueError:
        pytest.fail("installer raised instead of reporting the invalid configuration")
    assert "skip" in result
    assert path.read_text() == '["unrelated existing config"]'
