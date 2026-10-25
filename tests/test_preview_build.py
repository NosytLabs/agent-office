"""Static preview provenance, schema parity, and publication boundaries."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools/build_preview.mjs"
SEED = ROOT / "tools/fixtures/preview.json"
_SPEC = importlib.util.spec_from_file_location("preview_fixture", ROOT / "tools/generate_preview_fixture.py")
generator = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(generator)


def build(output, *, env=None, script=SCRIPT, check=True):
    return subprocess.run(["node", str(script), "--out", str(output)],
                          cwd=ROOT, env=env, check=check, capture_output=True, text=True)


def test_checked_in_fixture_matches_real_isolated_event_store_schema():
    seed = json.loads(SEED.read_text())
    assert generator.fixture() == seed
    assert seed["synthetic"] is True
    state = seed["state"]
    assert state["mode"] == "demo"
    assert {a["status"] for a in state["agents"]} >= {"working", "waiting", "done"}
    assert {a["platform"] for a in state["agents"]} == {"hermes", "claude", "opencode", "codex"}
    assert all(a["id"].startswith("demo-") for a in state["agents"])
    assert all(row["synthetic"] is True for row in seed["history"])
    assert state["usage"]["totals"]["input_tokens"] == 22000
    assert state["usage"]["totals"]["reports"] == 3
    assert "Synthetic" in state["usage"]["totals"]["cost_sources"][0]["source"]
    assert seed["empty_state"]["progress"]["xp"] == 0
    assert seed["empty_state"]["usage"]["totals"]["input_tokens"] is None
    assert "database_bytes" not in state["tracking"]


def test_build_contains_only_public_web_and_synthetic_seed(tmp_path):
    private_home = tmp_path / "private-home/pixel-office"
    private_home.mkdir(parents=True)
    (private_home / "events.jsonl").write_text("PRIVATE_EVENT_SENTINEL")
    (private_home / "office.sqlite3").write_text("PRIVATE_DATABASE_SENTINEL")
    (private_home / "assets/aquarium").mkdir(parents=True)
    (private_home / "assets/aquarium/ember.png").write_bytes(b"PRIVATE_FISH_SENTINEL")
    output = tmp_path / "site"
    build(output, env={**os.environ, "HERMES_HOME": str(private_home.parent)})
    files = [path for path in output.rglob("*") if path.is_file()]
    assert files
    for file in files:
        relative = file.relative_to(output)
        assert relative.parts[0] in {"assets", "css", "js", "arcade", "index.html", "preview-build.json", "robots.txt"}
        assert file.suffix not in {".py", ".sqlite3", ".jsonl"}
        assert b"PRIVATE_" not in file.read_bytes()
    for name in ("office.js", "scene.js", "editor.js", "aquarium.js", "data.js", "room.js", "arcade.js"):
        assert (output / "js" / name).read_bytes() == (ROOT / "web/js" / name).read_bytes()
    for name in ("index.html", "lifecycle.js", "embed.css", "js/game.js",
                 "audio/gun-shot.mp3", "images/duck_fly_up.png"):
        relative = Path("arcade/duck-hunt") / name
        assert (output / relative).read_bytes() == (ROOT / "web" / relative).read_bytes()
    public_notice = (output / "arcade/duck-hunt/UPSTREAM-NOTICE.md").read_text()
    assert public_notice.startswith((ROOT / "web/arcade/duck-hunt/UPSTREAM-NOTICE.md").read_text())
    assert (output / "assets/arcade/LICENSE").read_bytes() == (ROOT / "web/assets/arcade/LICENSE").read_bytes()
    assert not (output / "user").exists()
    page = (output / "index.html").read_text()
    assert page.index('src="js/data.js"') < page.index('src="js/preview.js"') < page.index('src="js/office.js"')
    assert "Synthetic demo usage" in page and "All agents, activity, XP and usage here are fictional" in page
    assert 'content="Explore Agent Office with fictional agents' in page
    assert 'property="og:title" content="Agent Office — Interactive demo"' in page
    assert 'https://agent-office-preview-seven.vercel.app/about/#get-started' in page
    assert "data-agent-office-preview" not in (ROOT / "web/template.html").read_text()
    assert (private_home / "events.jsonl").read_text() == "PRIVATE_EVENT_SENTINEL"


def test_synthetic_notice_uses_accessible_compact_mobile_disclosure(tmp_path):
    output = tmp_path / "public-preview"
    build(output)
    html = (output / "index.html").read_text()
    # Disclosure is always labelled as fictional, including when closed.
    assert '<details id="preview-info">' in html
    assert '<summary>Interactive demo · Fictional data</summary>' in html
    assert 'id="preview-restore"' in html
    assert 'id="preview-run-locally"' in html
    # The disclosure is closed on phones while remaining open on desktops.
    js = (output / "js/preview.js").read_text()
    assert 'previewInfo.open = window.matchMedia("(min-width: 681px)").matches' in js


def test_desktop_demo_details_share_row_with_restore_instead_of_tall_stack(tmp_path):
    output = tmp_path / "public-preview"
    build(output)
    html = (output / "index.html").read_text()
    # Native details content is internally wrapped by the browser; CSS Grid on
    # the details element does not position the description and button as siblings.
    assert "#preview-info[open]{display:block" in html
    assert "#preview-info[open] p{display:inline" in html
    assert "#preview-info[open] #preview-restore{display:inline-flex" in html


def test_preview_connection_status_describes_fictional_data(tmp_path):
    output = tmp_path / "public-preview"
    build(output)
    office = (output / "js/office.js").read_text()
    html = (output / "index.html").read_text()
    assert '"Sample data"' in office
    assert 'dataset.agentOfficePreview' in office
    assert 'body[data-agent-office-preview]:not(.offline) #connection-dot' in html


def test_existing_generated_build_can_be_rebuilt_but_unrelated_directory_is_preserved(tmp_path):
    output = tmp_path / "site"
    output.mkdir()
    (output / "keep.txt").write_text("user content")
    result = build(output, check=False)
    assert result.returncode != 0
    assert (output / "keep.txt").read_text() == "user content"
    generated = tmp_path / "generated"
    build(generated)
    (generated / "stale.txt").write_text("previous build output")
    build(generated)
    assert not (generated / "stale.txt").exists()


@pytest.mark.parametrize("fault", ["symlink", "licensed_name"])
def test_publication_rejects_symlinks_and_local_pack_files(tmp_path, fault):
    project = tmp_path / "source"
    (project / "tools/fixtures").mkdir(parents=True)
    shutil.copyfile(SCRIPT, project / "tools/build_preview.mjs")
    shutil.copyfile(ROOT / "tools/build_paths.mjs", project / "tools/build_paths.mjs")
    shutil.copyfile(SEED, project / "tools/fixtures/preview.json")
    shutil.copytree(ROOT / "web", project / "web")
    if fault == "symlink":
        private = tmp_path / "private.txt"
        private.write_text("private data")
        (project / "web/assets/leak.txt").symlink_to(private)
    else:
        (project / "web/assets/Smallburg-example.png").write_bytes(b"not actual licensed art")
    output = tmp_path / "site"
    result = build(output, script=project / "tools/build_preview.mjs", check=False)
    assert result.returncode != 0
    assert not output.exists()


@pytest.mark.parametrize("relative", ["web/assets", "web/js", "web/css", "web/arcade",
                                      "web/template.html", "tools/fixtures/preview.json"])
def test_top_level_public_inputs_cannot_redirect_to_external_files(tmp_path, relative):
    project = tmp_path / "source"
    (project / "tools/fixtures").mkdir(parents=True)
    shutil.copyfile(SCRIPT, project / "tools/build_preview.mjs")
    shutil.copyfile(ROOT / "tools/build_paths.mjs", project / "tools/build_paths.mjs")
    shutil.copyfile(SEED, project / "tools/fixtures/preview.json")
    shutil.copytree(ROOT / "web", project / "web")
    source = project / relative
    external = tmp_path / "external"
    source.rename(external)
    source.symlink_to(external, target_is_directory=external.is_dir())
    output = tmp_path / "site"
    output.mkdir()
    (output / "preview-build.json").write_text(json.dumps({"format": "agent-office-static-preview-v1"}))
    keep = output / "keep.txt"
    keep.write_text("previous public build")
    result = build(output, script=project / "tools/build_preview.mjs", check=False)
    assert result.returncode != 0
    assert "symlink" in result.stderr.lower()
    assert keep.read_text() == "previous public build"


@pytest.mark.parametrize("redirect", ["parent", "marker", "dangling_output"])
def test_output_redirects_are_rejected_before_replacing_any_directory(tmp_path, redirect):
    original = tmp_path / "original"
    original.mkdir()
    keep = original / "keep.txt"
    keep.write_text("keep unrelated content")
    marker = {"format": "agent-office-static-preview-v1"}
    if redirect == "parent":
        (original / "preview-build.json").write_text(json.dumps(marker))
        alias = tmp_path / "alias"
        alias.symlink_to(tmp_path, target_is_directory=True)
        output = alias / original.name
    elif redirect == "marker":
        external = tmp_path / "external-marker.json"
        external.write_text(json.dumps(marker))
        (original / "preview-build.json").symlink_to(external)
        output = original
    else:
        output = tmp_path / "dangling"
        output.symlink_to(tmp_path / "missing", target_is_directory=True)
    result = build(output, check=False)
    assert result.returncode != 0
    assert "symlink" in result.stderr.lower()
    assert keep.read_text() == "keep unrelated content"
    if redirect == "dangling_output":
        assert output.is_symlink()


@pytest.mark.skipif(sys.platform != "darwin", reason="macOS temporary-directory system aliases")
@pytest.mark.parametrize("temporary_root", [None, "/tmp"])
def test_macos_system_aliases_accept_safe_preview_output(temporary_root):
    with tempfile.TemporaryDirectory(prefix="office-preview-portability-", dir=temporary_root) as temporary:
        output = Path(temporary) / "preview"
        build(output)
        assert json.loads((output / "preview-build.json").read_text())["synthetic"] is True
        (output / "stale.txt").write_text("previous generated build")
        build(output)
        assert not (output / "stale.txt").exists()


@pytest.mark.skipif(sys.platform != "darwin", reason="macOS temporary-directory system aliases")
def test_macos_alias_cannot_bypass_preview_source_boundary():
    with tempfile.TemporaryDirectory(prefix="office-preview-boundary-", dir="/tmp") as temporary:
        project = Path(temporary) / "source"
        (project / "tools").mkdir(parents=True)
        script = project / "tools/build_preview.mjs"
        shutil.copyfile(SCRIPT, script)
        shutil.copyfile(ROOT / "tools/build_paths.mjs", project / "tools/build_paths.mjs")
        result = build(project / "private", script=script, check=False)
        assert result.returncode != 0
        assert "outside the source checkout" in result.stderr
        assert not (project / "private").exists()


def test_preview_keeps_synthetic_activity_out_of_search_and_links_product_setup(tmp_path):
    from html.parser import HTMLParser

    class Metadata(HTMLParser):
        def __init__(self):
            super().__init__()
            self.robots = []
        def handle_starttag(self, tag, attrs):
            attrs = dict(attrs)
            if tag == "meta" and attrs.get("name") == "robots":
                self.robots.append(attrs.get("content"))

    output = tmp_path / "demo"
    base = "https://example.test/product/"
    build(output, env={**os.environ, "AGENT_OFFICE_SITE_URL": base})
    demo = Metadata()
    demo.feed((output / "index.html").read_text())
    assert demo.robots == ["noindex, follow"]
    assert f'href="{base}#get-started"' in (output / "index.html").read_text()
    assert (output / "robots.txt").read_text() == f"User-agent: *\nAllow: /\nSitemap: {base}sitemap.xml\n"
    assert not (output / "sitemap.xml").exists(), "synthetic sessions are not product pages"
