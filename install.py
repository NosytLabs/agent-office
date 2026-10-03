#!/usr/bin/env python3
"""Guided Agent Office install — only wires what you already have."""
from __future__ import annotations

import json
import os
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
HOME = Path.home()
CLAUDE_EVENTS = ("SessionStart", "SessionEnd", "UserPromptSubmit", "Stop", "StopFailure",
                 "PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest",
                 "PermissionDenied", "SubagentStart", "SubagentStop")


def hermes_home() -> Path:
    return Path(os.environ.get("HERMES_HOME") or HOME / ".hermes").expanduser()


def have(cmd: str) -> bool:
    return shutil.which(cmd) is not None or Path(cmd).exists()


def load_json_config(path: Path) -> dict:
    """Read an optional object; callers report invalid files without replacing them."""
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return data


def save_json_config(path: Path, data: dict) -> None:
    """Persist a JSON object atomically so a terminated install cannot corrupt it."""
    if not isinstance(data, dict):
        raise ValueError("configuration must be a JSON object")
    # Dotfile managers commonly symlink runtime configuration; keep that link.
    path = path.resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o600
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix=f".{path.name}.", suffix=".tmp", delete=False) as fh:
            tmp = Path(fh.name)
            fh.write(json.dumps(data, indent=2) + "\n")
        os.chmod(tmp, mode)
        tmp.replace(path)
    finally:
        if tmp is not None:
            tmp.unlink(missing_ok=True)


def detect() -> dict:
    return {
        "hermes": have("hermes") or hermes_home().is_dir(),
        "opencode": have("opencode") or any(
            (HOME / ".config/opencode" / name).exists()
            for name in ("opencode.json", "opencode.jsonc")
        ),
        "claude": have("claude") or (HOME / ".claude/settings.json").exists(),
        "vscode": (Path("/Applications/Visual Studio Code.app").exists()
                   or have("code")),
    }


def enable_hermes() -> str:
    dest = hermes_home() / "plugins/pixel-office"
    if dest.resolve() != HERE:
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.is_symlink():
            dest.unlink()
        if not dest.exists():
            try:
                dest.symlink_to(HERE)
            except OSError:
                shutil.copytree(HERE, dest, dirs_exist_ok=True)
    try:
        r = subprocess.run(["hermes", "plugins", "enable", "pixel-office"],
                           capture_output=True, text=True, timeout=30)
        return "hermes plugin enabled" if r.returncode == 0 else "hermes plugin copied (enable later)"
    except Exception:
        return "hermes plugin on disk — run: hermes plugins enable pixel-office"


def enable_opencode() -> str:
    cfg = HOME / ".config/opencode/opencode.json"
    plug = (HERE / "opencode/index.js").resolve().as_uri()
    if not (HERE / "opencode/index.js").exists():
        return "skip opencode (no bridge in this tree)"
    if cfg.with_suffix(".jsonc").exists():
        return f'skip opencode (preserving opencode.jsonc; add {json.dumps(plug)} to its plugin array and restart)'
    try:
        data = load_json_config(cfg)
    except OSError:
        return "skip opencode (cannot read opencode.json)"
    except ValueError:
        return "skip opencode (invalid JSON object in opencode.json; fix it and rerun)"
    arr = data.get("plugin", [])
    if not isinstance(arr, list):
        return "skip opencode (plugin setting is not a JSON array)"
    # Older installs used a directory path, which is not a JS module import.
    old = str(HERE / "opencode")
    if old in arr:
        repaired = []
        for entry in arr:
            entry = plug if entry == old else entry
            if entry != plug or plug not in repaired:
                repaired.append(entry)
        arr = repaired
        data["plugin"] = arr
        save_json_config(cfg, data)
        return f"opencode plugin repaired ({plug})"
    if plug not in arr:
        arr.append(plug)
        data["plugin"] = arr
        save_json_config(cfg, data)
        return f"opencode plugin appended ({plug})"
    return "opencode already wired"


def enable_claude() -> str:
    settings = HOME / ".claude/settings.json"
    hook = str(HERE / "claude/hook.py")
    if not (HERE / "claude/hook.py").is_file():
        return "skip claude (no bridge in this tree)"
    cmd = shlex.join([sys.executable, hook])
    try:
        data = load_json_config(settings)
    except OSError:
        return "skip claude (cannot read settings.json)"
    except ValueError:
        return "skip claude (invalid JSON object in settings.json; fix it and rerun)"
    hooks = data.setdefault("hooks", {})
    if not isinstance(hooks, dict):
        return "skip claude (hooks setting is not a JSON object)"
    # Validate all observed event buckets before changing anything on disk.
    for ev in CLAUDE_EVENTS:
        bucket = hooks.get(ev, [])
        if not isinstance(bucket, list) or any(
            not isinstance(item, dict)
            or not isinstance(item.get("hooks", []), list)
            or any(not isinstance(h, dict) for h in item.get("hooks", []))
            for item in bucket
        ):
            return f"skip claude (invalid {ev} hooks; fix settings.json and rerun)"
    added = 0
    for ev in CLAUDE_EVENTS:
        bucket = hooks.setdefault(ev, [])
        already = False
        for item in bucket:
            if item.get("matcher") not in (None, "", "*"):
                continue
            for h in item.get("hooks") or []:
                try:
                    args = shlex.split(h.get("command", ""))
                except (ValueError, TypeError):
                    continue
                if h.get("type") == "command" and hook in args:
                    already = True
        if already:
            continue
        bucket.append({"hooks": [{"type": "command", "command": cmd}]})
        added += 1
    save_json_config(settings, data)
    return f"claude hooks appended ({added} events)" if added else "claude already wired"


def enable_vscode() -> str:
    ext = HOME / ".vscode/extensions/nosytlabs.agent-office-0.3.0"
    src = HERE / "vscode"
    if not (src / "extension.js").exists():
        return "skip vscode (no vscode/ in tree)"
    ext.mkdir(parents=True, exist_ok=True)
    for name in ("extension.js", "panel.js", "package.json", "LICENSE", "README.md"):
        if (src / name).exists():
            shutil.copy2(src / name, ext / name)
    media = ext / "media"
    media.mkdir(exist_ok=True)
    html = src / "media/office.html"
    if html.exists():
        shutil.copy2(html, media / "office.html")
    return f"vscode ext → {ext} (reload window)"


def main() -> int:
    found = detect()
    print("Agent Office install")
    print("detected:", ", ".join(k for k, v in found.items() if v) or "nothing")
    print()
    failed = False
    for name, enable in (("hermes", enable_hermes), ("opencode", enable_opencode),
                         ("claude", enable_claude), ("vscode", enable_vscode)):
        if not found[name]:
            print(f"• skip {name} (not installed)")
            continue
        try:
            print("•", enable())
        except OSError as exc:
            print(f"• {name} setup failed: {exc}")
            failed = True
    print()
    print("serve python3 run.py  — open http://127.0.0.1:8113")
    print("demo  python3 demo_feed.py  — separate demo at http://127.0.0.1:8114")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
