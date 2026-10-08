"""Static preview provenance, schema parity, and publication boundaries."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess

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
        assert relative.parts[0] in {"assets", "css", "js", "arcade", "index.html", "preview-build.json"}
        assert file.suffix not in {".py", ".sqlite3", ".jsonl"}
        assert b"PRIVATE_" not in file.read_bytes()
    for name in ("office.js", "scene.js", "editor.js", "aquarium.js", "data.js", "room.js", "arcade.js"):
        assert (output / "js" / name).read_bytes() == (ROOT / "web/js" / name).read_bytes()
    for name in ("index.html", "lifecycle.js", "embed.css", "js/upstream.js", "js/game.js",
                 "audio/gun-shot.mp3", "images/duck_fly_up.png", "UPSTREAM-NOTICE.md"):
        relative = Path("arcade/duck-hunt") / name
        assert (output / relative).read_bytes() == (ROOT / "web" / relative).read_bytes()
    assert (output / "assets/arcade/LICENSE").read_bytes() == (ROOT / "web/assets/arcade/LICENSE").read_bytes()
    assert not (output / "user").exists()
    page = (output / "index.html").read_text()
    assert page.index('src="js/data.js"') < page.index('src="js/preview.js"') < page.index('src="js/office.js"')
    assert "Synthetic demo usage" in page and "All agents, activity, XP and usage here are fictional" in page
    assert 'content="Explore Agent Office with fictional agents' in page
    assert 'property="og:title" content="Agent Office — Interactive demo"' in page
    assert 'agent-office#start-locally' in page
    assert "data-agent-office-preview" not in (ROOT / "web/template.html").read_text()
    assert (private_home / "events.jsonl").read_text() == "PRIVATE_EVENT_SENTINEL"


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
