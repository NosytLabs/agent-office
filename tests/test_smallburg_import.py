"""The optional importer verifies and copies local art without bundling it.

Fixtures are freshly generated plain-color PNGs, never Smallburg asset bytes.
"""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import zlib

import pytest


_SPEC = importlib.util.spec_from_file_location(
    "import_smallburg", Path(__file__).resolve().parents[1] / "tools/import_smallburg.py")
importer = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(importer)


def png(width=96, height=64, color=0):
    def chunk(kind, data):
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))
    scanlines = (b"\x00" + bytes((color, 0, 0, 255)) * width) * height
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(scanlines)) + chunk(b"IEND", b""))


@pytest.fixture
def source(tmp_path, monkeypatch):
    root = tmp_path / "little-current"
    (root / importer.FISH_PATH).mkdir(parents=True)
    (root / importer.LICENSE_PATH).parent.mkdir(parents=True)
    license_bytes = b"Synthetic license fixture; no third-party asset or license bytes.\n"
    (root / importer.LICENSE_PATH).write_bytes(license_bytes)
    monkeypatch.setattr(importer, "LICENSE_SHA256", hashlib.sha256(license_bytes).hexdigest())
    assets = copy.deepcopy(importer.ASSETS)
    for index, asset in enumerate(assets.values()):
        content = png(color=index)
        (root / importer.FISH_PATH / asset["source_filename"]).write_bytes(content)
        asset["sha256"] = hashlib.sha256(content).hexdigest()
    monkeypatch.setattr(importer, "ASSETS", assets)
    return root


def test_import_preserves_original_bytes_and_publishes_native_frame_manifest(source, tmp_path):
    target, manifest = importer.import_pack(source, tmp_path / "office-data")
    assert target == tmp_path / "office-data/assets/aquarium"
    assert json.loads((target / "manifest.json").read_text()) == manifest
    assert manifest["pack"] == "smallburg-diving"
    assert manifest["license"]["redistribution_allowed"] is False
    assert set(manifest["fish"]) == {"ember", "mint", "violet", "pearl"}
    assert len(manifest["files"]) == 5
    for fish_id, entry in manifest["fish"].items():
        original = (source / importer.FISH_PATH / entry["source_filename"]).read_bytes()
        assert (target / entry["filename"]).read_bytes() == original
        assert entry["url"] == f"/user/aquarium/{fish_id}.png"
        assert [entry[key] for key in ("sheet_width", "sheet_height", "frame_width", "frame_height",
                                      "frame_count", "x", "y", "stride_x")] == [96, 64, 16, 16, 4, 16, 16, 16]
        assert entry["facing"] == "right"
        assert manifest["files"][entry["filename"]]["sha256"] == hashlib.sha256(original).hexdigest()
    assert (target / importer.LICENSE_NAME).read_bytes() == (source / importer.LICENSE_PATH).read_bytes()


def test_identical_repeat_is_noop_and_does_not_touch_backups(source, tmp_path):
    office = tmp_path / "office"
    backup = office / "assets/aquarium.backup"
    backup.mkdir(parents=True)
    (backup / "original.txt").write_text("keep me")
    target, _ = importer.import_pack(source, office)
    before = {path.name: path.stat().st_mtime_ns for path in target.iterdir()}
    assert importer.import_pack(source, office)[0] == target
    assert before == {path.name: path.stat().st_mtime_ns for path in target.iterdir()}
    assert (backup / "original.txt").read_text() == "keep me"


@pytest.mark.parametrize("fault", ["missing", "hash", "license", "dimensions"])
def test_invalid_source_never_creates_destination(source, tmp_path, fault):
    asset = importer.ASSETS["ember"]
    path = source / importer.FISH_PATH / asset["source_filename"]
    if fault == "missing":
        path.unlink()
    elif fault == "hash":
        path.write_bytes(path.read_bytes() + b"changed")
    elif fault == "license":
        (source / importer.LICENSE_PATH).write_text("different notice")
    else:
        content = png(width=16)
        path.write_bytes(content)
        asset["sha256"] = hashlib.sha256(content).hexdigest()
    office = tmp_path / "office"
    with pytest.raises(importer.ImportFailure):
        importer.import_pack(source, office)
    assert not office.exists()


def test_conflicting_existing_install_is_never_overwritten(source, tmp_path):
    office = tmp_path / "office"
    target, _ = importer.import_pack(source, office)
    (target / "ember.png").write_bytes(b"user custom fish")
    before = {path.name: path.read_bytes() for path in target.iterdir()}
    with pytest.raises(importer.ImportFailure, match="left unchanged"):
        importer.import_pack(source, office)
    assert before == {path.name: path.read_bytes() for path in target.iterdir()}


def test_disk_failure_does_not_publish_partial_pack(source, tmp_path, monkeypatch):
    real_write = importer._write_file
    def fail_after_first(path, content):
        if path.name == "mint.png":
            raise OSError("simulated full disk")
        real_write(path, content)
    monkeypatch.setattr(importer, "_write_file", fail_after_first)
    office = tmp_path / "office"
    with pytest.raises(OSError, match="full disk"):
        importer.import_pack(source, office)
    assert not (office / "assets/aquarium").exists()
    assert list((office / "assets").iterdir()) == []


def test_source_symlink_cannot_read_outside_checkout(source, tmp_path):
    path = source / importer.FISH_PATH / importer.ASSETS["ember"]["source_filename"]
    outside = tmp_path / "outside.png"
    outside.write_bytes(path.read_bytes())
    path.unlink()
    path.symlink_to(outside)
    with pytest.raises(importer.ImportFailure, match="escapes"):
        importer.import_pack(source, tmp_path / "office")


def test_code_and_source_checkout_destinations_are_rejected(source, tmp_path, monkeypatch):
    code = tmp_path / "public-code"
    monkeypatch.setattr(importer, "CODE_DIR", code)
    for office in (code / "demo", source / "data"):
        with pytest.raises(importer.ImportFailure, match="outside both code checkouts"):
            importer.import_pack(source, office)
        assert not office.exists()


def test_hermes_home_selects_the_data_directory(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "hermes"))
    assert importer.default_office_dir() == tmp_path / "hermes/pixel-office"
