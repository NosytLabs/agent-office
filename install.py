#!/usr/bin/env python3
"""Guided Agent Office install — only wires what you already have."""
from __future__ import annotations

import json
import os
import re
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
CODEX_EVENTS = ("SessionStart", "SessionEnd", "UserPromptSubmit", "Stop", "Interrupt",
                "PreToolUse", "PostToolUse", "PermissionRequest", "SubagentStart", "SubagentStop")


def hermes_home() -> Path:
    return Path(os.environ.get("HERMES_HOME") or HOME / ".hermes").expanduser()


def codex_home() -> Path:
    return Path(os.environ.get("CODEX_HOME") or HOME / ".codex").expanduser()


def have(cmd: str) -> bool:
    # Source directories such as ./claude are not runtime executables.
    return shutil.which(cmd) is not None


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
        "hermes": have("hermes") or (hermes_home() / "config.yaml").is_file(),
        "opencode": have("opencode") or any(
            (HOME / ".config/opencode" / name).exists()
            for name in ("opencode.json", "opencode.jsonc")
        ),
        "claude": have("claude") or (HOME / ".claude/settings.json").exists(),
        "codex": have("codex") or any((codex_home() / name).is_file() for name in ("config.toml", "hooks.json")),
        "vscode": (Path("/Applications/Visual Studio Code.app").exists()
                   or have("code")),
    }


def _refresh_hermes_copy(dest: Path) -> None:
    """Refresh source-owned runtime files, retaining unrelated local settings."""
    dest.mkdir(parents=True, exist_ok=True)
    for name in ("__init__.py", "settings_store.py", "event_inbox.py", "event_store.py", "state_model.py",
                 "progress.py", "usage.py", "tasks.py", "plugin.yaml", "LICENSE", "README.md"):
        if (HERE / name).is_file():
            shutil.copy2(HERE / name, dest / name)
    ignore = shutil.ignore_patterns("node_modules", "reports", ".git", "__pycache__",
                                   ".pytest_cache", "test-results", "playwright-report", "*.pyc")
    for name in ("web", "claude", "opencode", "codex"):
        if (HERE / name).is_dir():
            shutil.copytree(HERE / name, dest / name, dirs_exist_ok=True, ignore=ignore)


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
                _refresh_hermes_copy(dest)
        else:
            _refresh_hermes_copy(dest)
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


def _enable_command_hooks(runtime: str, settings: Path, events: tuple, options: dict | None = None) -> str:
    hook = str(HERE / runtime / "hook.py")
    if not Path(hook).is_file():
        return f"skip {runtime} (no bridge in this tree)"
    cmd = shlex.join([sys.executable, hook])
    try:
        data = load_json_config(settings)
    except OSError:
        return f"skip {runtime} (cannot read {settings.name})"
    except ValueError:
        return f"skip {runtime} (invalid JSON object in {settings.name}; fix it and rerun)"
    hooks = data.setdefault("hooks", {})
    if not isinstance(hooks, dict):
        return f"skip {runtime} (hooks setting is not a JSON object)"
    # Validate all observed event buckets before changing anything on disk.
    for ev in events:
        bucket = hooks.get(ev, [])
        if not isinstance(bucket, list) or any(
            not isinstance(item, dict)
            or not isinstance(item.get("hooks", []), list)
            or any(not isinstance(h, dict) for h in item.get("hooks", []))
            for item in bucket
        ):
            return f"skip {runtime} (invalid {ev} hooks; fix {settings.name} and rerun)"
    added = 0
    for ev in events:
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
        bucket.append({"hooks": [{"type": "command", "command": cmd, **(options or {})}]})
        added += 1
    save_json_config(settings, data)
    return f"{runtime} hooks appended ({added} events)" if added else f"{runtime} already wired"


def enable_claude() -> str:
    return _enable_command_hooks("claude", HOME / ".claude/settings.json", CLAUDE_EVENTS)


def enable_codex() -> str:
    # Synchronous, short local writes preserve event order and SessionEnd delivery.
    # Codex itself owns review/trust; never write trust state or bypass its check.
    result = _enable_command_hooks("codex", codex_home() / "hooks.json", CODEX_EVENTS, {"timeout": 3})
    if result.startswith("skip"):
        return result
    return result + " — open Codex /hooks to review and trust the observer definitions before they run"


def enable_vscode() -> str:
    src = HERE / "vscode"
    if not (src / "extension.js").exists():
        return "skip vscode (no vscode/ in tree)"
    try:
        manifest = load_json_config(src / "package.json")
    except (OSError, ValueError):
        return "skip vscode (cannot read a valid extension package.json)"
    publisher, name, version = (manifest.get(key, "") for key in ("publisher", "name", "version"))
    if not all(isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", value)
               for value in (publisher, name, version)):
        return "skip vscode (invalid extension identity in package.json)"
    ext = HOME / ".vscode/extensions" / f"{publisher}.{name}-{version}"
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
                         ("claude", enable_claude), ("codex", enable_codex), ("vscode", enable_vscode)):
        if not found.get(name):
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
