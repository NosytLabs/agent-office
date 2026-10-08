#!/usr/bin/env python3
"""Report Agent Office SQLite storage; use --compact for an explicit rebuild."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sqlite3
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from event_store import EventStore


def _busy(error_code, message):
    # Python 3.10 exceptions do not expose SQLite result codes. The fallback
    # is restricted to SQLite's standard lock error messages.
    return ((error_code & 255) in (5, 6) if error_code is not None else message in (
        "database is locked", "database table is locked", "database schema is locked"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=(
        Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes") / "pixel-office"),
        help="office data directory (default: HERMES_HOME/pixel-office)")
    parser.add_argument("--compact", action="store_true",
                        help="rebuild existing SQLite storage without deleting retained observations")
    parser.add_argument("--timeout", type=float, default=1.0,
                        help="maximum wait for a database lock, 0–5 seconds (default: 1)")
    args = parser.parse_args()
    if not 0 <= args.timeout <= 5:
        parser.error("timeout must be between 0 and 5 seconds")
    store = EventStore(args.directory.expanduser())
    try:
        result = (store.compact(timeout=args.timeout) if args.compact
                  else store.storage_report(timeout=args.timeout))
        code = int(bool(result.get("measurement_errors") or
                        result.get("after", {}).get("measurement_errors")))
        if _busy(result.get("sqlite_errorcode"), result.get("sqlite_error")):
            code = 2
    except (OSError, ValueError, sqlite3.Error) as exc:
        busy = isinstance(exc, sqlite3.Error) and _busy(getattr(exc, "sqlite_errorcode", None), str(exc))
        result = {"status": "busy" if busy else "failed", "error": str(exc)}
        code = 2 if busy else 1
    print(json.dumps(result, indent=2, allow_nan=False))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
