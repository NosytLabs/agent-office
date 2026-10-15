"""A public demo needs runtime artwork and notices, not art-authoring inputs."""
from hashlib import sha256
import json
from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"


@pytest.fixture(scope="module")
def public_build(tmp_path_factory):
    originals = list((WEB / "assets/sprites/studio/source").glob("*"))
    originals += list((WEB / "assets/sprites").glob("generated-*.json"))
    originals.append(WEB / "assets/sprites/asset-checksums.json")
    source_hashes = {file: sha256(file.read_bytes()).hexdigest() for file in originals if file.is_file()}
    output = tmp_path_factory.mktemp("office-public-assets") / "demo"
    result = subprocess.run(["node", "tools/build_preview.mjs", "--out", str(output)],
                            cwd=ROOT, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
    return output, source_hashes


def test_authoring_art_and_generation_records_stay_in_checkout_only(public_build):
    output, originals = public_build
    assert len(originals) >= 20, "Exercise the real raw art and generation records"
    for source, digest in originals.items():
        assert source.is_file(), source
        assert sha256(source.read_bytes()).hexdigest() == digest, source
        assert not (output / source.relative_to(WEB)).exists(), source
    assert not (output / "assets/sprites/studio/source").exists()
    published = json.loads((output / "preview-build.json").read_text())["files"]
    assert not any("/source/" in name or "/generated-" in name for name in published)


def test_every_classic_fallback_sheet_is_preserved_byte_for_byte(public_build):
    output, _ = public_build
    manifest = json.loads((WEB / "assets/sprites/runtime/manifest.json").read_text())
    assert len(manifest["sources"]) == manifest["sourceCount"] == 23
    for name, source in manifest["sources"].items():
        data = (output / "assets/sprites" / name).read_bytes()
        assert sha256(data).hexdigest() == source["sha256"], name
        assert data == (WEB / "assets/sprites" / name).read_bytes(), name
    for name in ("runtime/office.png", "runtime/manifest.json", "aquarium/manifest.json", "aquarium/original-fish.png"):
        assert (output / "assets/sprites" / name).read_bytes() == (WEB / "assets/sprites" / name).read_bytes()


def test_studio_compiled_manifests_and_supplements_remain_runtime_inputs(public_build):
    output, _ = public_build
    folder = Path("assets/sprites/studio")
    for name in ("studio.json", "directional.json", "pet-walk.json", "pet-life.json", "room-surfaces.json"):
        manifest = json.loads((WEB / folder / name).read_text())
        assert (output / folder / name).read_bytes() == (WEB / folder / name).read_bytes()
        images = manifest.get("pages", [manifest.get("image")])
        assert images and all(images)
        for image in images:
            assert (output / folder / image).read_bytes() == (WEB / folder / image).read_bytes()


def test_notices_fonts_and_arcade_keep_their_original_bytes(public_build):
    output, _ = public_build
    for relative in ("assets/fonts/geist-latin-variable.woff2", "assets/fonts/OFL.txt", "assets/icons/LICENSE.txt",
                     "assets/brands/SVGL-LICENSE.txt", "assets/brands/provenance.json", "assets/sprites/PIXEL-AGENTS-LICENSE.txt",
                     "assets/arcade/LICENSE", "assets/arcade/provenance.json"):
        assert (output / relative).read_bytes() == (WEB / relative).read_bytes(), relative
    for source in (WEB / "arcade").rglob("*"):
        if source.is_file() and source.name != "UPSTREAM-NOTICE.md" and source != WEB / "arcade/duck-hunt/js/upstream.js":
            assert (output / source.relative_to(WEB)).read_bytes() == source.read_bytes(), source
    upstream = WEB / "arcade/duck-hunt/js/upstream.js"
    assert upstream.is_file()
    assert not (output / upstream.relative_to(WEB)).exists()
    notice = (output / "arcade/duck-hunt/UPSTREAM-NOTICE.md").read_text()
    assert "a4502ff12a5f79853ed181fc93680863ddde0b4e" in notice
    assert "https://github.com/NosytLabs/agent-office/blob/main/web/arcade/duck-hunt/js/upstream.js" in notice
    assert "js/game.js" in notice
    studio = (output / "assets/sprites/studio/README.md").read_text()
    assert "AI-generated" in studio
    assert "https://github.com/NosytLabs/agent-office/tree/main/web/assets/sprites/studio/source" in studio


def test_public_sprite_credits_link_to_the_preserved_repository_provenance(public_build):
    output, _ = public_build
    credits = (output / "assets/sprites/ATTRIBUTION.md").read_text()
    source = (WEB / "assets/sprites/ATTRIBUTION.md").read_text()
    assert "MIT" in credits and "JIK-A-4" in credits
    assert "[PIXEL-AGENTS-LICENSE.txt](PIXEL-AGENTS-LICENSE.txt)" in credits
    assert "https://github.com/NosytLabs/agent-office/blob/main/web/assets/sprites/generated-atlas.json" in credits
    assert "[generated-atlas.json](generated-atlas.json)" in source
    assert "[generated-atlas.json](generated-atlas.json)" not in credits
