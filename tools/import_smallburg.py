#!/usr/bin/env python3
"""Install the owner's optional Smallburg fish locally without redistributing art.

Only the exact, inspected Little Current sheets are accepted. No network access,
image conversion, or writes to the source checkout are involved.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import sys
import tempfile


CODE_DIR = Path(__file__).resolve().parents[1]
SOURCE_REPOSITORY = "NosytLabs/little-current"
SOURCE_REVISION = "15733b26b98271b89a4dd4c928532520ba30fdbc"
FISH_PATH = Path("Assets/Resources/Smallburg/Fish")
LICENSE_PATH = Path("ThirdParty/Smallburg-Diving-license.txt")
LICENSE_SHA256 = "ffab939499ade85ed5cb0099de7c44174486db34c2c7909499ddca293c580d7b"
LICENSE_NAME = "Smallburg-Diving-license.txt"
ASSETS = {
    "ember": {
        "source_filename": "clown_fish-red.png", "kind": "Clownfish",
        "sha256": "efac23e9983e1c1f49cb22692a95af533711f2dd11c3626f7be302e1e959a223",
    },
    "mint": {
        "source_filename": "guppy-blue.png", "kind": "Guppy",
        "sha256": "58067e766aece90bd7c0fbce7e7020af4544a156a08e2ef3fe1a4ecd74cc2e24",
    },
    "violet": {
        "source_filename": "neon_tetra-light_blue.png", "kind": "Neon tetra",
        "sha256": "5e3d76f06b867402dfa45429e9babd67a83b477b869ce11c6a5e586816a83007",
    },
    "pearl": {
        "source_filename": "butterfly_fish-yellow_white_fin.png", "kind": "Butterflyfish",
        "sha256": "392dbeee17c9d668d04b57e6d4565e29377af745f5abb1c83c87390ee1a453a2",
    },
}
MAX_SOURCE_BYTES = 1024 * 1024


class ImportFailure(ValueError):
    """An unsupported source or existing destination needs the owner's attention."""


def default_office_dir() -> Path:
    return Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes") / "pixel-office"


def _read_verified(source: Path, relative: Path, expected: str) -> bytes:
    candidate = source / relative
    if not candidate.resolve().is_relative_to(source):
        raise ImportFailure(f"Source file escapes the source directory: {relative}")
    if not candidate.is_file():
        raise ImportFailure(f"Missing source file: {relative}")
    with candidate.open("rb") as stream:
        content = stream.read(MAX_SOURCE_BYTES + 1)
    if len(content) > MAX_SOURCE_BYTES:
        raise ImportFailure(f"Source file is too large: {relative}")
    if hashlib.sha256(content).hexdigest() != expected:
        raise ImportFailure(
            f"Source hash differs for {relative}. This importer accepts the inspected "
            f"Smallburg Diving sheets from {SOURCE_REPOSITORY}@{SOURCE_REVISION}; "
            "it will not guess crops for changed assets."
        )
    return content


def _check_sheet(content: bytes, name: str) -> None:
    # The closed SHA256 roster authenticates the complete PNG. Inspect its IHDR
    # too, so a future roster change cannot silently invalidate frame geometry.
    if (len(content) < 33 or content[:8] != b"\x89PNG\r\n\x1a\n"
            or content[8:16] != b"\x00\x00\x00\rIHDR"):
        raise ImportFailure(f"Not a PNG sheet: {name}")
    if struct.unpack(">II", content[16:24]) != (96, 64):
        raise ImportFailure(f"Expected a 96 by 64 PNG sheet: {name}")


def _prepare(source: Path) -> tuple[dict, dict[str, bytes]]:
    files = {LICENSE_NAME: _read_verified(source, LICENSE_PATH, LICENSE_SHA256)}
    fish = {}
    for fish_id, asset in ASSETS.items():
        content = _read_verified(source, FISH_PATH / asset["source_filename"], asset["sha256"])
        _check_sheet(content, asset["source_filename"])
        filename = f"{fish_id}.png"
        files[filename] = content
        fish[fish_id] = {
            "kind": asset["kind"], "filename": filename,
            "url": f"/user/aquarium/{filename}",
            "source_filename": asset["source_filename"], "sha256": asset["sha256"],
            "sheet_width": 96, "sheet_height": 64,
            "frame_width": 16, "frame_height": 16, "frame_count": 4,
            "x": 16, "y": 16, "stride_x": 16, "facing": "right",
        }
    manifest = {
        "version": 1, "pack": "smallburg-diving",
        "source": {"repository": SOURCE_REPOSITORY, "revision": SOURCE_REVISION},
        "license": {"filename": LICENSE_NAME, "sha256": LICENSE_SHA256,
                    "redistribution_allowed": False},
        "fish": fish,
        "files": {name: {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
                  for name, data in sorted(files.items())},
    }
    files["manifest.json"] = (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode("utf-8")
    return manifest, files


def _already_installed(target: Path, files: dict[str, bytes]) -> bool:
    if target.is_symlink() or not target.is_dir():
        return False
    if {path.name for path in target.iterdir()} != set(files):
        return False
    for name, content in files.items():
        path = target / name
        if path.is_symlink() or not path.is_file() or path.stat().st_size != len(content):
            return False
        if path.read_bytes() != content:
            return False
    return True


def _write_file(path: Path, content: bytes) -> None:
    with path.open("xb") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())


def import_pack(source: Path, office_dir: Path | None = None) -> tuple[Path, dict]:
    """Validate all files, then atomically publish one complete local directory.

    Existing identical installs are left untouched. A differing destination is
    never replaced, so hand-edited art and previous backups remain intact.
    """
    source = Path(source).expanduser().resolve()
    office_dir = Path(office_dir or default_office_dir()).expanduser().resolve()
    target = office_dir / "assets" / "aquarium"
    if target.resolve().is_relative_to(CODE_DIR) or target.resolve().is_relative_to(source):
        raise ImportFailure("Use an office data directory outside both code checkouts; licensed art must stay local.")
    if target.parent.is_symlink() or target.is_symlink():
        raise ImportFailure("The aquarium destination must not be a symlink.")
    # Validation precedes any destination write, including creating directories.
    manifest, files = _prepare(source)
    if target.exists():
        if _already_installed(target, files):
            return target, manifest
        raise ImportFailure(f"Existing aquarium directory differs and was left unchanged: {target}")
    target.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".aquarium-import-", dir=target.parent))
    try:
        for name, content in files.items():
            _write_file(stage / name, content)
        # Directory publication keeps the server from seeing a half-imported
        # manifest. Renaming over a nonempty existing install fails safely.
        if target.exists() or target.is_symlink():
            raise ImportFailure(f"Aquarium destination appeared during import and was left unchanged: {target}")
        stage.rename(target)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return target, manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="Owner's existing Little Current checkout")
    parser.add_argument("--office-dir", type=Path, default=None,
                        help="Office data directory (default: $HERMES_HOME/pixel-office or ~/.hermes/pixel-office)")
    args = parser.parse_args(argv)
    try:
        target, manifest = import_pack(args.source, args.office_dir)
    except (ImportFailure, OSError) as exc:
        print(f"Smallburg import failed: {exc}", file=sys.stderr)
        return 1
    print(f"Installed {len(manifest['fish'])} verified local fish sheets in {target}")
    print("Reload Agent Office to use them. Keep this licensed asset directory out of source control and public deployments.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
