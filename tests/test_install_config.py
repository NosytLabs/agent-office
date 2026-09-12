from __future__ import annotations

import json
from pathlib import Path

import install


def test_load_json_config_returns_empty_for_missing_or_invalid_file(tmp_path):
    assert install.load_json_config(tmp_path / "missing.json") == {}
    broken = tmp_path / "broken.json"
    broken.write_text("{not json")
    assert install.load_json_config(broken) == {}


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
