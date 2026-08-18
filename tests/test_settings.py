from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import __init__ as plugin  # noqa: E402


def test_settings_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(plugin, "_office_dir", lambda: tmp_path)
    assert plugin._load_settings()["layout"] == "open"
    plugin._save_settings({"layout": "bullpen", "theme": "midnight",
                           "areas": {"api": "#5fce7a"},
                           "paint": True, "painted": {"10,12": "api"}})
    s = plugin._load_settings()
    assert s["layout"] == "bullpen"
    assert s["theme"] == "midnight"
    assert s["paint"] is True
    assert s["painted"] == {"10,12": "api"}


def test_unknown_key_ignored(tmp_path, monkeypatch):
    monkeypatch.setattr(plugin, "_office_dir", lambda: tmp_path)
    plugin._save_settings({"layout": "lounge", "unknown": "x", "rce": True})
    s = plugin._load_settings()
    assert s["layout"] == "lounge"
    assert "unknown" not in s
    assert "rce" not in s


def test_asset_manifest_includes_user_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(plugin, "_office_dir", lambda: tmp_path)
    user = tmp_path / "assets"
    user.mkdir()
    (user / "mylogo.svg").write_text("<svg/>")
    m = plugin._asset_manifest()
    assert any(x["id"].endswith("mylogo") for x in m["user"])
