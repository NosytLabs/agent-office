"""The product website must work under a project subpath and publish only known public files."""
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools/build_site.mjs"


def build(output, *, script=SCRIPT, env=None, check=True):
    return subprocess.run(["node", str(script), "--out", str(output)],
                          cwd=ROOT, env=env, check=check, capture_output=True, text=True)


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.local = []
        self.ids = []
        self.resources = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            self.ids.append(attrs["id"])
        for name in ("href", "src"):
            if name not in attrs:
                continue
            target = attrs[name]
            if not urlsplit(target).scheme:
                self.local.append(target)
            if tag in {"script", "link", "img", "iframe"}:
                self.resources.append(target)


def test_product_build_uses_relative_links_and_bundled_public_assets(tmp_path):
    private_home = tmp_path / "private/pixel-office"
    private_home.mkdir(parents=True)
    (private_home / "events.jsonl").write_text("PRIVATE_EVENT_SENTINEL")
    (private_home / "office.sqlite3").write_text("PRIVATE_DATABASE_SENTINEL")
    output = tmp_path / "site"
    build(output, env={**os.environ, "HERMES_HOME": str(private_home.parent)})
    parser = Links()
    parser.feed((output / "index.html").read_text())
    assert len(parser.ids) == len(set(parser.ids)), "IDs must be unique for keyboard navigation"
    for target in parser.local:
        parts = urlsplit(target)
        assert not parts.path.startswith("/"), f"Project Pages would break: {target}"
        assert ".." not in Path(parts.path).parts, f"Escapes published site: {target}"
        if parts.path:
            assert (output / parts.path).is_file(), target
        elif parts.fragment:
            assert parts.fragment in parser.ids, target
    assert all(not urlsplit(target).scheme for target in parser.resources)
    for relative in ("assets/office.svg", "assets/fonts/OFL.txt", "assets/icons/LICENSE.txt",
                     "assets/brands/SVGL-LICENSE.txt", "assets/sprites/PIXEL-AGENTS-LICENSE.txt",
                     "assets/screenshots/appearance.png", "LICENSE.txt"):
        assert (output / relative).is_file()
    metadata = json.loads((output / "site-build.json").read_text())
    assert metadata["format"] == "agent-office-product-site-v1"
    assert metadata["runtime_data"] is False
    assert metadata["screenshots"] == "synthetic examples"
    actual = {str(p.relative_to(output)) for p in output.rglob("*") if p.is_file()}
    assert actual == set(metadata["files"]) | {"site-build.json"}
    for file in output.rglob("*"):
        if file.is_file():
            assert b"PRIVATE_" not in file.read_bytes()
            assert file.suffix not in {".py", ".sqlite3", ".jsonl"}


def test_rebuild_only_replaces_generated_output(tmp_path):
    output = tmp_path / "site"
    output.mkdir()
    (output / "keep.txt").write_text("user content")
    failed = build(output, check=False)
    assert failed.returncode != 0
    assert (output / "keep.txt").read_text() == "user content"
    generated = tmp_path / "generated"
    build(generated)
    (generated / "stale.txt").write_text("old generated output")
    build(generated)
    assert not (generated / "stale.txt").exists()


@pytest.mark.parametrize("fault", ["missing", "symlink", "parent_symlink"])
def test_invalid_asset_input_preserves_previous_site(tmp_path, fault):
    project = tmp_path / "source"
    (project / "tools").mkdir(parents=True)
    shutil.copyfile(SCRIPT, project / "tools/build_site.mjs")
    shutil.copytree(ROOT / "site", project / "site")
    shutil.copytree(ROOT / "docs/screenshots", project / "docs/screenshots")
    shutil.copytree(ROOT / "web/assets", project / "web/assets")
    shutil.copyfile(ROOT / "LICENSE", project / "LICENSE")
    output = tmp_path / "site"
    build(output)
    (output / "previous-build.txt").write_text("must survive failure")
    asset = project / "docs/screenshots/appearance.png"
    if fault == "parent_symlink":
        original = project / "docs/screenshots"
        moved = project / "outside-screenshots"
        original.rename(moved)
        original.symlink_to(moved, target_is_directory=True)
    else:
        asset.unlink()
        if fault == "symlink":
            private = tmp_path / "private.png"
            private.write_bytes(b"private source")
            asset.symlink_to(private)
    result = build(output, script=project / "tools/build_site.mjs", check=False)
    assert result.returncode != 0
    assert (output / "previous-build.txt").read_text() == "must survive failure"


def test_output_symlink_and_source_directory_are_never_replaced(tmp_path):
    target = tmp_path / "target"
    target.mkdir()
    (target / "keep").write_text("user content")
    linked = tmp_path / "linked"
    linked.symlink_to(target, target_is_directory=True)
    assert build(linked, check=False).returncode != 0
    assert (target / "keep").read_text() == "user content"
    assert build(ROOT / "site", check=False).returncode != 0
    assert (ROOT / "site/index.html").exists()


@pytest.mark.skipif(sys.platform != "darwin", reason="macOS temporary-directory system aliases")
@pytest.mark.parametrize("temporary_root", [None, "/tmp"])
def test_macos_system_temporary_aliases_accept_safe_site_output(temporary_root):
    # Use the native spelling instead of pytest's canonicalized temporary path.
    # /var/folders and /tmp are normal macOS output locations.
    with tempfile.TemporaryDirectory(prefix="office-site-portability-", dir=temporary_root) as temporary:
        output = Path(temporary) / "site"
        build(output)
        metadata = json.loads((output / "site-build.json").read_text())
        assert metadata["format"] == "agent-office-product-site-v1"
        (output / "stale.txt").write_text("previous generated build")
        build(output)
        assert not (output / "stale.txt").exists()


def test_output_parent_symlink_cannot_replace_a_previous_build(tmp_path):
    target = tmp_path / "actual"
    output = target / "site"
    build(output)
    (output / "keep.txt").write_text("must survive redirected output")
    linked = tmp_path / "linked"
    linked.symlink_to(target, target_is_directory=True)
    result = build(linked / "site", check=False)
    assert result.returncode != 0
    assert "symlinked site input/output" in result.stderr
    assert (output / "keep.txt").read_text() == "must survive redirected output"


def test_dangling_output_symlink_is_not_replaced(tmp_path):
    output = tmp_path / "site"
    output.symlink_to(tmp_path / "missing-target", target_is_directory=True)
    result = build(output, check=False)
    assert result.returncode != 0
    assert output.is_symlink()
    assert not (tmp_path / "missing-target").exists()


@pytest.mark.skipif(sys.platform != "darwin", reason="macOS temporary-directory system aliases")
def test_macos_alias_cannot_bypass_source_output_boundary():
    with tempfile.TemporaryDirectory(prefix="office-site-boundary-", dir="/tmp") as temporary:
        project = Path(temporary) / "source"
        (project / "tools").mkdir(parents=True)
        script = project / "tools/build_site.mjs"
        shutil.copyfile(SCRIPT, script)
        result = build(project / "private", script=script, check=False)
        assert result.returncode != 0
        assert "outside the source checkout" in result.stderr
        assert not (project / "private").exists()
