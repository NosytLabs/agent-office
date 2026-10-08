"""The product website must work under a project subpath and publish only known public files."""
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import shutil
import subprocess
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
