#!/usr/bin/env python3
"""Regenerate the public synthetic preview fixture through the real EventStore.

This command creates and removes its own temporary office. It never opens the
operator's HERMES_HOME, configured office, or existing event database.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import tempfile
import time
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from event_inbox import publish
from event_store import EventStore
import progress

BASE_TIME = datetime(2026, 10, 7, 12, tzinfo=timezone.utc).timestamp()
OUTPUT = ROOT / "tools/fixtures/preview.json"


def sample_events():
    rows = []

    def add(offset, event, session_id, platform="hermes", **extra):
        rows.append({"ts": BASE_TIME + offset, "event": event,
                     "session_id": session_id, "platform": platform,
                     "synthetic": True, **extra})

    for index in range(10):
        sid = f"demo-earlier-{index + 1:02d}"
        add(-3600 + index * 40, "session_start", sid, title="Demo · Earlier sample session")
        add(-3580 + index * 40, "session_end", sid)
    for offset, sid, platform, title in (
        (-240, "demo-hermes", "hermes", "Demo · Plan the release"),
        (-220, "demo-claude", "claude", "Demo · Review the API"),
        (-200, "demo-opencode", "opencode", "Demo · Build the interface"),
        (-180, "demo-codex", "codex", "Demo · Check the tests"),
    ):
        add(offset, "session_start", sid, platform, title=title)
    # Sample work earns real catalog entries through the same ingest code. The
    # event payloads and resulting metrics are fictional and labeled as such.
    for index in range(28):
        offset = -170 + index * 3
        add(offset, "tool_start", "demo-hermes", call_id=f"demo-read-{index}",
            tool_name="Read", activity="reading", preview=f"sample/docs/chapter-{index + 1}.md")
        add(offset + 1, "tool_end", "demo-hermes", call_id=f"demo-read-{index}",
            tool_name="Read", status="ok")
    add(-76, "subagent_start", "demo-opencode", "opencode",
        parent_session_id="demo-opencode", child_session_id="demo-review",
        child_goal="Demo · Review accessibility")
    add(-70, "tool_start", "demo-review", "opencode", parent_session_id="demo-opencode",
        call_id="demo-child-read", tool_name="read", activity="reading", preview="sample/Button.tsx")
    add(-60, "tool_end", "demo-review", "opencode", parent_session_id="demo-opencode",
        call_id="demo-child-read", tool_name="read", status="ok")
    add(-52, "usage", "demo-opencode", "opencode", usage_id="demo-ui-message",
        model="Demo model · interface", provider="synthetic-example", input_tokens=12400,
        output_tokens=2800, total_tokens=15200, cached_input_tokens=8000,
        reasoning_output_tokens=600, cost_usd=0.0184,
        cost_source="Synthetic preview example — not a real charge")
    add(-42, "usage", "demo-hermes", usage_id="demo-plan-request",
        model="Demo model · planner", provider="synthetic-example", input_tokens=9600,
        output_tokens=1900, total_tokens=11500, cached_input_tokens=3200,
        reasoning_output_tokens=400)
    add(-38, "usage", "demo-codex", "codex", usage_id="demo-test-turn",
        model="Demo model · reviewer", provider="synthetic-example", output_tokens=1100)
    add(-32, "subagent_stop", "demo-opencode", "opencode",
        parent_session_id="demo-opencode", child_session_id="demo-review")
    add(-28, "tool_start", "demo-opencode", "opencode", call_id="demo-edit",
        tool_name="edit", activity="writing", preview="sample/WelcomeCard.tsx")
    add(-24, "tool_start", "demo-hermes", call_id="demo-plan",
        tool_name="Read", activity="reading", preview="sample/release-checklist.md")
    add(-20, "session_busy", "demo-codex", "codex")
    add(-16, "approval_request", "demo-claude", "claude", request_id="demo-approval",
        tool_name="Bash", command="Demo request: run the sample test suite?")
    return sorted(rows, key=lambda event: event["ts"])


def fixture():
    with tempfile.TemporaryDirectory(prefix="office-public-fixture-") as temp:
        office = Path(temp) / "sample"
        store = EventStore(office)
        # Catalog timestamps and time-of-day achievements must reproduce on any
        # developer's timezone. This temporary clock never enters a live server.
        with patch.object(progress.time, "time", return_value=BASE_TIME), \
                patch.object(progress.time, "localtime", time.gmtime):
            for event in sample_events():
                publish(office, event)
                store.consume(lambda: [], event["ts"])
            state = store.consume(lambda: [], BASE_TIME)
            empty = EventStore(Path(temp) / "empty").consume(lambda: [], BASE_TIME)
        for snapshot in (state, empty):
            snapshot.update(ts=BASE_TIME, mode="demo", synthetic=True)
            # A static preview has no deployed SQLite database. Do not display
            # the temporary generator's file size as a user's storage metric.
            snapshot["tracking"].pop("database_bytes", None)
            snapshot["tracking"]["storage"] = "browser-demo"
            snapshot["usage"]["synthetic"] = True
            for agent in snapshot["agents"]:
                agent["observed_label"] = agent["label"]
        return {
            "version": 1, "product_version": "0.5.0", "synthetic": True,
            "base_time": BASE_TIME,
            "description": "Fictional public sample generated in an isolated temporary EventStore. No real agents, token usage, or charges.",
            "settings": {"room_name": "The demo studio", "max_chars": 6,
                         "aquarium_species": ["ember", "mint", "violet", "pearl"]},
            "state": state, "empty_state": empty, "history": store.history(1000),
        }


if __name__ == "__main__":
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(fixture(), indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote synthetic preview fixture: {OUTPUT.relative_to(ROOT)}")
