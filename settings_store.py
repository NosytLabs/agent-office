"""Versioned settings files, with atomic writes and cross-process serialization.

The existing office database supplies a write lock, not a second settings copy.
Revisions describe the exact file bytes, so an external edit also invalidates an
older browser snapshot. An unreadable existing file is never a defaults write.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
import sqlite3
import stat
import tempfile
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, Optional


@dataclass
class SettingsSnapshot:
    settings: Dict[str, Any]
    revision: Optional[str]
    error: Optional[str] = None

    def public(self) -> Dict[str, Any]:
        status = {"available": self.error is None}
        if self.error:
            status["error"] = self.error
        return {"settings": copy.deepcopy(self.settings),
                "settings_revision": self.revision, "settings_status": status}


class SettingsUnavailable(OSError):
    def __init__(self, snapshot: SettingsSnapshot):
        super().__init__(snapshot.error)
        self.snapshot = snapshot


class SettingsConflict(Exception):
    def __init__(self, snapshot: SettingsSnapshot):
        super().__init__("Settings changed in another view. Review the latest values and try again.")
        self.snapshot = snapshot


class SettingsStore:
    def __init__(self, path: Path, defaults: Dict[str, Any], validate: Callable):
        self.path = path
        self.defaults = defaults
        self.validate = validate

    def read(self) -> SettingsSnapshot:
        settings = copy.deepcopy(self.defaults)
        try:
            info = self.path.lstat()
            if not stat.S_ISREG(info.st_mode):
                return SettingsSnapshot(settings, None,
                    "settings.json is not a regular file. Restore a regular settings file to enable editing.")
            if info.st_size > 1024 * 1024:
                raise ValueError("settings file exceeds the supported size")
            raw = self.path.read_bytes()
            data = parse_settings_json(raw)
            if not isinstance(data, dict):
                raise ValueError("settings must be an object")
        except FileNotFoundError:
            return SettingsSnapshot(settings, "missing")
        except (ValueError, UnicodeError, RecursionError):
            return SettingsSnapshot(settings, None,
                "settings.json could not be parsed. Its contents are preserved. Repair the JSON file to enable editing.")
        except OSError:
            return SettingsSnapshot(settings, None,
                "settings.json could not be read. Its contents are preserved. Check file access to enable editing.")
        normalized = self.validate(data)
        settings.update(normalized)
        invalid_retention = [key for key in ("history_limit", "history_days", "history_max_bytes")
                             if key in data and key not in normalized]
        if invalid_retention:
            return SettingsSnapshot(settings, None,
                "settings.json contains an unsupported history retention value. Its contents are preserved. "
                "Repair " + ", ".join(invalid_retention) + " to enable editing and automatic pruning.")
        return SettingsSnapshot(settings, hashlib.sha256(raw).hexdigest())

    def save(self, payload: Dict[str, Any], expected_revision: Optional[str] = None) -> SettingsSnapshot:
        # Multiple local servers can observe one office directory. A SQLite
        # write transaction serializes the compare-and-replace across them.
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path.parent / "office.sqlite3", timeout=5)) as db:
            with db:
                db.execute("BEGIN IMMEDIATE")
                current = self.read()
                if current.error:
                    raise SettingsUnavailable(current)
                if expected_revision is not None and expected_revision != current.revision:
                    raise SettingsConflict(current)
                settings = copy.deepcopy(current.settings)
                settings.update(self.validate(payload))
                raw = json.dumps(settings, indent=2, ensure_ascii=True, allow_nan=False).encode("utf-8")
                if len(raw) > 1024 * 1024:
                    raise ValueError("settings file exceeds the supported size")
                descriptor, name = tempfile.mkstemp(prefix="settings-", suffix=".tmp", dir=self.path.parent)
                temporary = Path(name)
                try:
                    with os.fdopen(descriptor, "wb") as output:
                        output.write(raw)
                        output.flush()
                        os.fsync(output.fileno())
                    # Detect a non-cooperating editor that changed the file while
                    # the temporary replacement was being written.
                    latest = self.read()
                    if latest.error:
                        raise SettingsUnavailable(latest)
                    if latest.revision != current.revision:
                        raise SettingsConflict(latest)
                    os.replace(temporary, self.path)
                finally:
                    temporary.unlink(missing_ok=True)
        return SettingsSnapshot(settings, hashlib.sha256(raw).hexdigest())


MAX_SETTINGS_DEPTH = 128


def parse_settings_json(raw: bytes) -> Dict[str, Any]:
    """Bound JSON nesting before decoding, including on Python 3.14."""
    text = raw.decode('utf-8')
    depth = 0
    quoted = escaped = False
    for char in text:
        if quoted:
            if escaped:
                escaped = False
            elif char == chr(92):
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char in '[{':
            depth += 1
            if depth > MAX_SETTINGS_DEPTH:
                raise ValueError('settings nesting exceeds the supported limit')
        elif char in ']}':
            depth -= 1
    def reject_constant(value):
        raise ValueError('non-finite JSON number: ' + value)
    data = json.loads(text, parse_constant=reject_constant)
    if not isinstance(data, dict):
        raise ValueError('settings must be an object')
    return data
