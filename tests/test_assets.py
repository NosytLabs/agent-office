from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import __init__ as plugin  # noqa: E402


SPRITES = ROOT / "web" / "assets" / "sprites"


def test_runtime_sprite_dimensions_and_png_headers():
    import struct
    expected = {
        **{f"characters/char_{i}.png": (112, 96) for i in range(6)},
        "pets/claudio.png": (96, 96), "pets/gitcat.png": (96, 96),
        "pets/sleep_cat.png": (24, 16), "furniture/studio-atlas.png": (1254, 1254),
        "furniture/utilities-atlas.png": (1254, 1254),
        "furniture/decor-atlas.png": (1254, 1254),
        "furniture/workshop-atlas.png": (1254, 1254),
        "furniture/rewards-atlas.png": (1254, 1254),
    }
    for rel, size in expected.items():
        raw = (SPRITES / rel).read_bytes()
        assert raw[:8] == b"\x89PNG\r\n\x1a\n", rel
        assert struct.unpack(">II", raw[16:24]) == size, rel


def test_safe_web_file_serves_js(tmp_path, monkeypatch):
    web = ROOT / "web"
    for rel in ("js/data.js", "js/scene.js", "js/office.js", "css/style.css"):
        p = plugin._safe_web_file(web, "/" + rel)
        assert p is not None and p.is_file()
    assert plugin._safe_web_file(web, "/js/../__init__.py") is None
    assert plugin._safe_web_file(web, "/nope.js") is None


def test_logos_are_svg():
    assets = ROOT / "web" / "assets"
    for name in ("office",):
        text = (assets / f"{name}.svg").read_text()
        assert "<svg" in text
        assert "<text" not in text


def test_defaults_dropped_dead_keys():
    assert "show_chips" not in plugin._DEFAULTS
    assert "moods_clicked" not in plugin._DEFAULTS
    assert "did_import" not in plugin._DEFAULTS
    assert "theme" in plugin._DEFAULTS
    assert "layout" in plugin._DEFAULTS


def test_header_merged():
    html = (ROOT / "web" / "template.html").read_text()
    assert 'id="floorbtn"' in html
    assert 'id="rosterbtn"' not in html
    assert 'id="statsbtn"' not in html
    assert 'id="fogbtn"' not in html
    assert 'id="legendbtn"' not in html


def test_sprite_checksums_match_complete_runtime_inventory():
    import hashlib
    import json
    checksums = json.loads((SPRITES / "asset-checksums.json").read_text())
    actual = {str(p.relative_to(SPRITES)): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in SPRITES.rglob("*.png")}
    assert checksums == actual
