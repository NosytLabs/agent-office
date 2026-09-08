from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import __init__ as plugin  # noqa: E402


SPRITES = ROOT / "web" / "assets" / "sprites"


def test_furniture_and_npc_sprites_exist():
    for rel in (
        "furniture/DOOR.png",
        "furniture/COFFEE.png",
        "furniture/LARGE_PLANT.png",
        "furniture/WATER_COOLER.png",
        "furniture/LAMP.png",
        "furniture/CLOCK.png",
        "furniture/BOOKSHELF.png",
        "furniture/FISH_TANK.png",
        "furniture/BIN.png",
        "furniture/CACTUS.png",
        "furniture/PACKAGE.png",
        "npcs/mail.png",
        "npcs/cleaner.png",
        "npcs/intern.png",
        "pets/sleep_cat.png",
        "pets/claudio.png",
        "pets/gitcat.png",
        "pets/claudio_idle.png",
        "pets/gitcat_idle.png",
        "characters/char_0.png",
    ):
        assert (SPRITES / rel).is_file(), rel


def test_sofa_retired():
    assert not (SPRITES / "furniture" / "SOFA_FRONT.png").exists()


def test_safe_web_file_serves_js(tmp_path, monkeypatch):
    web = ROOT / "web"
    for rel in ("js/data.js", "js/office.js", "css/style.css"):
        p = plugin._safe_web_file(web, "/" + rel)
        assert p is not None and p.is_file()
    assert plugin._safe_web_file(web, "/js/../__init__.py") is None
    assert plugin._safe_web_file(web, "/nope.js") is None


def test_logos_are_svg():
    assets = ROOT / "web" / "assets"
    for name in ("hermes", "opencode", "claude", "telegram", "cli"):
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
