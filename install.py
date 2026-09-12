#!/usr/bin/env python3
"""Guided Agent Office install — only wires what you already have."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HOME = Path.home()


def have(cmd: str) -> bool:
    return shutil.which(cmd) is not None or Path(cmd).exists()


def load_json_config(path: Path) -> dict:
    """Read an optional JSON object without making installation fatal."""
    try:
        if not path.exists():
            return {}
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError(f"{path} must contain a JSON object")
        return data
    except (OSError, json.JSONDecodeError):
        return {}


def save_json_config(path: Path, data: dict) -> None:
    """Persist a JSON object atomically so a terminated install cannot corrupt it."""
    if not isinstance(data, dict):
        raise ValueError("configuration must be a JSON object")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def detect() -> dict:
    return {
        "hermes": have("hermes") or (HOME / ".hermes").is_dir(),
        "opencode": have("opencode") or (HOME / ".config/opencode/opencode.json").exists(),
        "claude": have("claude") or (HOME / ".claude/settings.json").exists(),
        "vscode": (Path("/Applications/Visual Studio Code.app").exists()
                   or have("code")),
    }


def enable_hermes() -> str:
    dest = HOME / ".hermes/plugins/pixel-office"
    if dest.resolve() != HERE:
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists() and dest.is_symlink():
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
    plug = str(HERE / "opencode")
    if not (HERE / "opencode/index.js").exists():
        return "skip opencode (no bridge in this tree)"
    if not cfg.exists():
        return "skip opencode (no ~/.config/opencode/opencode.json)"
    try:
        data = load_json_config(cfg)
        if cfg.read_text(encoding="utf-8").strip() and not data:
            return "skip opencode (invalid JSON in opencode.json; fix it and rerun)"
    except OSError:
        return "skip opencode (cannot read opencode.json)"
    arr = data.get("plugin") or []
    if not isinstance(arr, list):
        return "skip opencode (plugin setting is not a JSON array)"
    if plug not in arr:
        arr.append(plug)
        data["plugin"] = arr
        save_json_config(cfg, data)
        return f"opencode plugin appended ({plug})"
    return "opencode already wired"


def enable_claude() -> str:
    settings = HOME / ".claude/settings.json"
    hook = str(HERE / "claude/hook.py")
    os.chmod(HERE / "claude/hook.py", 0o755)
    cmd = f"{sys.executable} {hook}"
    if not settings.exists():
        return "skip claude (no settings.json)"
    try:
        data = load_json_config(settings)
        if settings.read_text(encoding="utf-8").strip() and not data:
            return "skip claude (invalid JSON in settings.json; fix it and rerun)"
    except OSError:
        return "skip claude (cannot read settings.json)"
    hooks = data.setdefault("hooks", {})
    if not isinstance(hooks, dict):
        return "skip claude (hooks setting is not a JSON object)"
    added = 0
    for ev in ("SessionStart", "SessionEnd", "PreToolUse", "PostToolUse",
               "PostToolUseFailure", "PermissionRequest", "SubagentStart", "SubagentStop"):
        bucket = hooks.setdefault(ev, [])
        already = False
        for item in bucket:
            for h in item.get("hooks") or []:
                if "agent-office" in str(h.get("command", "")) or "claude/hook.py" in str(h.get("command", "")):
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
    for name in ("extension.js", "package.json", "LICENSE", "README.md"):
        if (src / name).exists():
            shutil.copy2(src / name, ext / name)
    media = ext / "media"
    media.mkdir(exist_ok=True)
    html = HERE / "web/template.html"
    if html.exists():
        shutil.copy2(html, media / "office.html")
    return f"vscode ext → {ext} (reload window)"


def main() -> int:
    found = detect()
    print("Agent Office install")
    print("detected:", ", ".join(k for k, v in found.items() if v) or "nothing")
    print()
    if found["hermes"]:
        print("•", enable_hermes())
    else:
        print("• skip hermes (not installed)")
    if found["opencode"]:
        print("•", enable_opencode())
    else:
        print("• skip opencode")
    if found["claude"]:
        print("•", enable_claude())
    else:
        print("• skip claude")
    if found["vscode"]:
        print("•", enable_vscode())
    else:
        print("• skip vscode")
    print()
    print("open  http://127.0.0.1:8113  after a fresh hermes/opencode/claude session")
    print("demo  python3 demo_feed.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
