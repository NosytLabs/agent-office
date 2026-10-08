#!/usr/bin/env python3
"""Observe usage from an existing codex exec --json stream; never launch Codex.

The documented stream has no turn ID. The caller therefore supplies a stable,
unique ID for this captured invocation; its turn.started sequence is replayable.
Reuse the same --stream-id only when replaying that same capture. Lifecycle is
left to the Codex hook adapter, so attaching both cannot duplicate tool/session XP.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import BinaryIO, Iterator

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from codex.hook import publish

MAX_LINE_BYTES = 1024 * 1024
MAX_SAFE_TOKENS = (1 << 53) - 1


class UsageStream:
    def __init__(self, stream_id: str):
        if not isinstance(stream_id, str) or not stream_id.strip() or len(stream_id) > 256 or any(ord(c) < 32 for c in stream_id):
            raise ValueError("stream-id must be a nonempty capture identifier of at most 256 characters")
        self.stream_id = stream_id.strip()
        self.session_id = ""
        self.turn = 0

    def observe(self, raw: dict) -> dict | None:
        kind = raw.get("type")
        if kind == "thread.started":
            sid = raw.get("thread_id")
            self.session_id = sid if isinstance(sid, str) else ""
            self.turn = 0
        elif kind == "turn.started" and self.session_id:
            self.turn += 1
        elif kind == "turn.completed" and self.session_id and self.turn:
            source = raw.get("usage")
            if not isinstance(source, dict):
                return None
            event = {"event": "usage", "platform": "codex", "session_id": self.session_id,
                     "usage_id": f"exec:{self.stream_id}:turn:{self.turn}", "usage_scope": "exec_turn"}
            fields = {"input_tokens": "input_tokens", "output_tokens": "output_tokens",
                      "cached_input_tokens": "cached_input_tokens", "cache_write_input_tokens": "cache_write_tokens",
                      "reasoning_output_tokens": "reasoning_output_tokens", "total_tokens": "total_tokens"}
            for source_key, target_key in fields.items():
                value = source.get(source_key)
                if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= MAX_SAFE_TOKENS:
                    event[target_key] = value
            return event
        return None


def iter_records(source: BinaryIO) -> Iterator[dict]:
    """Ignore malformed/oversized input with a bounded buffer per JSONL record."""
    while True:
        line = source.readline(MAX_LINE_BYTES + 1)
        if not line:
            return
        if len(line) > MAX_LINE_BYTES:
            while line and not line.endswith(b"\n"):
                line = source.readline(MAX_LINE_BYTES + 1)
            continue
        try:
            raw = json.loads(line)
        except (ValueError, UnicodeError):
            continue
        if isinstance(raw, dict):
            yield raw


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stream-id", required=True, help="unique stable name of this captured Codex invocation; reuse only for replay")
    args = parser.parse_args()
    try:
        observer = UsageStream(args.stream_id)
    except ValueError as exc:
        parser.error(str(exc))
    for raw in iter_records(sys.stdin.buffer):
        try:
            event = observer.observe(raw)
            if event:
                publish(event)
        except Exception:
            # Usage observation must not terminate an upstream runtime pipeline.
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
