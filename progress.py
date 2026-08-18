"""Persistent XP / unlocks for Pixel Office.

Folded from events.jsonl so Hermes hooks AND the OpenCode bridge both count.
Never raises into the agent loop.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Dict, List, Set

RANKS = (
    (0, "intern"),
    (40, "junior"),
    (150, "staff"),
    (400, "principal"),
    (1200, "distinguished"),
)

CATALOG = [
    {"id": "first_shift", "name": "First shift", "hint": "clock in once", "xp": 10},
    {"id": "open_floor", "name": "Open floor", "hint": "an OpenCode session walks in", "xp": 25},
    {"id": "telegram_desk", "name": "Pager kid", "hint": "a Telegram session sits down", "xp": 15},
    {"id": "two_houses", "name": "Two houses", "hint": "Hermes + OpenCode in the same office", "xp": 40},
    {"id": "pair_programming", "name": "Pair desk", "hint": "2 agents at once", "xp": 15},
    {"id": "full_floor", "name": "Full floor", "hint": "5 agents on the floor", "xp": 30},
    {"id": "gold_collar", "name": "Gold collar", "hint": "spawn a subagent", "xp": 20},
    {"id": "swarm", "name": "Swarm", "hint": "10 subagents lifetime", "xp": 40},
    {"id": "coffee_break", "name": "Coffee break", "hint": "50 tools fired", "xp": 20},
    {"id": "centurion", "name": "Centurion", "hint": "100 tools", "xp": 30},
    {"id": "thousand_cuts", "name": "Thousand cuts", "hint": "1000 tools", "xp": 80},
    {"id": "reader", "name": "Librarian", "hint": "25 read/search tools", "xp": 15},
    {"id": "typer", "name": "Keyboard warrior", "hint": "25 write/edit tools", "xp": 15},
    {"id": "browser_tab", "name": "Tab hoarder", "hint": "15 browse tools", "xp": 15},
    {"id": "shell_jockey", "name": "Shell jockey", "hint": "25 terminal/bash tools", "xp": 15},
    {"id": "red_alert", "name": "Red alert", "hint": "an approval pops", "xp": 10},
    {"id": "night_owl", "name": "Night owl", "hint": "work between 00:00–05:00", "xp": 20},
    {"id": "fashion", "name": "Office drip", "hint": "hit staff rank", "xp": 0},
]


def _empty() -> Dict[str, Any]:
    return {
        "xp": 0,
        "stats": {
            "tools": 0,
            "sessions": 0,
            "subagents": 0,
            "approvals": 0,
            "reads": 0,
            "writes": 0,
            "browses": 0,
            "shells": 0,
            "max_concurrent": 0,
            "platforms": [],
        },
        "unlocks": {},
        "last_ts": 0.0,
        "recent": [],
    }


def load(path: Path) -> Dict[str, Any]:
    try:
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            base = _empty()
            base.update({k: data.get(k, base[k]) for k in base})
            base["stats"] = {**_empty()["stats"], **(data.get("stats") or {})}
            return base
    except Exception:
        pass
    return _empty()


def save(path: Path, data: Dict[str, Any]) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        tmp.replace(path)
    except Exception:
        pass


def rank_for(xp: int) -> str:
    name = RANKS[0][1]
    for need, label in RANKS:
        if xp >= need:
            name = label
    return name


def cosmetics_for(xp: int, unlocks: Dict[str, Any]) -> List[str]:
    out = ["desk_basic"]
    r = rank_for(xp)
    if r in ("junior", "staff", "principal", "distinguished"):
        out.append("beanie")
    if r in ("staff", "principal", "distinguished"):
        out.extend(["plant", "mug"])
    if r in ("principal", "distinguished"):
        out.append("gold_monitor")
    if r == "distinguished":
        out.extend(["cape", "crown"])
    if "open_floor" in unlocks:
        out.append("visor")
    if "telegram_desk" in unlocks:
        out.append("pin")
    if "night_owl" in unlocks:
        out.append("headphones")
    if "gold_collar" in unlocks:
        out.append("gold_trim")
    return out


def _unlock(data: Dict[str, Any], aid: str) -> None:
    if aid in data["unlocks"]:
        return
    meta = next((c for c in CATALOG if c["id"] == aid), None)
    if not meta:
        return
    now = time.time()
    data["unlocks"][aid] = {"at": now, "name": meta["name"]}
    data["xp"] = int(data.get("xp") or 0) + int(meta.get("xp") or 0)
    rec = data.setdefault("recent", [])
    rec.append({"id": aid, "name": meta["name"], "hint": meta["hint"], "at": now})
    data["recent"] = rec[-8:]


def ingest(data: Dict[str, Any], events: List[Dict[str, Any]]) -> Dict[str, Any]:
    last = float(data.get("last_ts") or 0)
    stats = data["stats"]
    plats: Set[str] = set(stats.get("platforms") or [])
    live: Set[str] = set()
    max_seen = int(stats.get("max_concurrent") or 0)
    newest = last

    READ = {"read_file", "search_files", "skill_view", "read", "glob", "grep", "list"}
    WRITE = {"write_file", "patch", "skill_manage", "edit", "write", "apply_patch"}
    BROWSE = {"web_search", "web_extract", "browser_navigate", "webfetch", "websearch"}
    SHELL = {"terminal", "execute_code", "process", "bash"}

    for ev in events:
        ts = float(ev.get("ts") or 0)
        if ts <= last:
            continue
        newest = max(newest, ts)
        kind = ev.get("event")
        plat = str(ev.get("platform") or "")
        if plat:
            plats.add(plat)
        if kind == "session_start":
            stats["sessions"] = int(stats.get("sessions") or 0) + 1
            data["xp"] = int(data.get("xp") or 0) + 5
            sid = ev.get("session_id")
            if sid:
                live.add(str(sid))
            hour = time.localtime(ts).tm_hour
            if 0 <= hour < 5:
                _unlock(data, "night_owl")
            _unlock(data, "first_shift")
            if plat == "opencode":
                _unlock(data, "open_floor")
            if plat == "telegram":
                _unlock(data, "telegram_desk")
        elif kind == "tool_start":
            stats["tools"] = int(stats.get("tools") or 0) + 1
            data["xp"] = int(data.get("xp") or 0) + 1
            tool = str(ev.get("tool_name") or "")
            if tool in READ:
                stats["reads"] = int(stats.get("reads") or 0) + 1
            elif tool in WRITE:
                stats["writes"] = int(stats.get("writes") or 0) + 1
            elif tool in BROWSE:
                stats["browses"] = int(stats.get("browses") or 0) + 1
            elif tool in SHELL:
                stats["shells"] = int(stats.get("shells") or 0) + 1
        elif kind == "subagent_start":
            stats["subagents"] = int(stats.get("subagents") or 0) + 1
            data["xp"] = int(data.get("xp") or 0) + 8
            _unlock(data, "gold_collar")
        elif kind == "approval_request":
            stats["approvals"] = int(stats.get("approvals") or 0) + 1
            data["xp"] = int(data.get("xp") or 0) + 3
            _unlock(data, "red_alert")

    # concurrent from current fold isn't in this loop; caller can pass live count
    stats["platforms"] = sorted(plats)
    if len(plats) >= 2 and ("opencode" in plats) and (
        "cli" in plats or "telegram" in plats or "gateway" in plats
    ):
        _unlock(data, "two_houses")
    if int(stats.get("tools") or 0) >= 50:
        _unlock(data, "coffee_break")
    if int(stats.get("tools") or 0) >= 100:
        _unlock(data, "centurion")
    if int(stats.get("tools") or 0) >= 1000:
        _unlock(data, "thousand_cuts")
    if int(stats.get("reads") or 0) >= 25:
        _unlock(data, "reader")
    if int(stats.get("writes") or 0) >= 25:
        _unlock(data, "typer")
    if int(stats.get("browses") or 0) >= 15:
        _unlock(data, "browser_tab")
    if int(stats.get("shells") or 0) >= 25:
        _unlock(data, "shell_jockey")
    if int(stats.get("subagents") or 0) >= 10:
        _unlock(data, "swarm")
    if rank_for(int(data.get("xp") or 0)) in ("staff", "principal", "distinguished"):
        _unlock(data, "fashion")

    data["stats"] = stats
    data["last_ts"] = newest
    data["max_concurrent"] = max_seen
    return data


def apply_live(data: Dict[str, Any], live_count: int) -> None:
    stats = data["stats"]
    if live_count > int(stats.get("max_concurrent") or 0):
        stats["max_concurrent"] = live_count
    if live_count >= 2:
        _unlock(data, "pair_programming")
    if live_count >= 5:
        _unlock(data, "full_floor")


def snapshot(data: Dict[str, Any]) -> Dict[str, Any]:
    xp = int(data.get("xp") or 0)
    nxt = None
    for need, label in RANKS:
        if xp < need:
            nxt = {"rank": label, "need": need}
            break
    return {
        "xp": xp,
        "rank": rank_for(xp),
        "next": nxt,
        "stats": data.get("stats") or {},
        "cosmetics": cosmetics_for(xp, data.get("unlocks") or {}),
        "unlocks": [
            {"id": k, "name": v.get("name") or k, "at": v.get("at")}
            for k, v in sorted((data.get("unlocks") or {}).items(), key=lambda kv: kv[1].get("at") or 0)
        ],
        "recent": data.get("recent") or [],
        "catalog": [{"id": c["id"], "name": c["name"], "hint": c["hint"],
                     "have": c["id"] in (data.get("unlocks") or {})} for c in CATALOG],
    }
