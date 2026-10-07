"""Achievement rules and progress snapshots for observed runtime activity.

EventStore owns transactional persistence; JSON helpers support legacy import
and the exported progress mirror.
"""
from __future__ import annotations

import json
import math
from collections import Counter
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
    {"id": "first_shift", "name": "First day", "hint": "clock in once", "xp": 10},
    {"id": "open_floor", "name": "Open floor", "hint": "an OpenCode session walks in", "xp": 25},
    {"id": "telegram_desk", "name": "Telegram desk", "hint": "observe a Telegram session", "xp": 15},
    {"id": "claude_desk", "name": "Claude Code desk", "hint": "observe a Claude Code session", "xp": 25},
    {"id": "two_houses", "name": "Two runtimes", "hint": "observe Hermes and OpenCode activity", "xp": 40},
    {"id": "three_houses", "name": "Three runtimes", "hint": "observe Hermes, OpenCode and Claude Code activity", "xp": 60},
    {"id": "polyglot", "name": "Multiple runtimes", "hint": "observe 3 distinct runtimes", "xp": 35},
    {"id": "pair_programming", "name": "Pair desk", "hint": "2 agents at once", "xp": 15},
    {"id": "full_floor", "name": "Full floor", "hint": "5 agents on the floor", "xp": 30},
    {"id": "gold_collar", "name": "First subagent", "hint": "observe a subagent starting", "xp": 20},
    {"id": "swarm", "name": "Swarm", "hint": "10 subagents lifetime", "xp": 40},
    {"id": "coffee_break", "name": "Coffee break", "hint": "50 tools fired", "xp": 20},
    {"id": "centurion", "name": "Centurion", "hint": "100 tools", "xp": 30},
    {"id": "thousand_cuts", "name": "Thousand cuts", "hint": "1000 tools", "xp": 80},
    {"id": "five_k", "name": "Five thousand", "hint": "5000 tools", "xp": 120},
    {"id": "reader", "name": "Librarian", "hint": "25 read/search tools", "xp": 15},
    {"id": "typer", "name": "File editor", "hint": "25 write/edit tools", "xp": 15},
    {"id": "browser_tab", "name": "Web browsing", "hint": "15 browse tools", "xp": 15},
    {"id": "shell_jockey", "name": "Shell jockey", "hint": "25 terminal/bash tools", "xp": 15},
    {"id": "toolkit", "name": "Toolkit", "hint": "10 distinct tools used", "xp": 25},
    {"id": "specialist", "name": "Specialist", "hint": "one tool 50 times", "xp": 25},
    {"id": "oops", "name": "Oops", "hint": "10 tool errors", "xp": 10},
    {"id": "red_alert", "name": "Red alert", "hint": "an approval pops", "xp": 10},
    {"id": "night_owl", "name": "Night owl", "hint": "start a session between 00:00–05:00", "xp": 20},
    {"id": "early_bird", "name": "Early bird", "hint": "start a session between 05:00–08:00", "xp": 15},
    {"id": "fashion", "name": "Coffee mugs", "hint": "reach staff rank", "xp": 0},
    {"id": "corner_office", "name": "Corner office", "hint": "hit principal rank", "xp": 0},
    {"id": "layout_bullpen", "name": "Bullpen layout", "hint": "10 sessions ever", "xp": 25},
    {"id": "pet_cat", "name": "Office cat", "hint": "50 sessions", "xp": 15},
    {"id": "pet_plant", "name": "Office fern", "hint": "first session", "xp": 0},
    {"id": "pet_dog", "name": "Midnight cat", "hint": "100 sessions + 50 tools", "xp": 30},
    {"id": "pet_fish", "name": "Office fish", "hint": "25 browse tools", "xp": 20},
    {"id": "weather_storm", "name": "Warm lamp", "hint": "5 tool errors lifetime", "xp": 15},
    {"id": "weather_sun", "name": "Hundred sessions", "hint": "100 sessions", "xp": 25},
    {"id": "workhorse", "name": "Workhorse", "hint": "500 tools", "xp": 50},
    {"id": "deep_work", "name": "Deep work", "hint": "50 sessions", "xp": 40},
    {"id": "theme_designer", "name": "Theme designer", "hint": "switch theme 5 times", "xp": 20},
    {"id": "marathon", "name": "Marathon", "hint": "10k tools", "xp": 80},
    {"id": "codex_desk", "name": "Codex desk", "hint": "observe a Codex session", "xp": 25},
    {"id": "arcade_break", "name": "Arcade cabinet", "hint": "100 observed tool calls", "xp": 0},
    {"id": "listening_room", "name": "Record player", "hint": "5 recorded sessions", "xp": 0},
    {"id": "helping_hand", "name": "Desk robot", "hint": "observe a subagent starting", "xp": 0},
    {"id": "green_thumb", "name": "Terrarium", "hint": "25 read or search tool calls", "xp": 0},
    {"id": "measured_work", "name": "Usage tracking", "hint": "receive a runtime usage report", "xp": 10},
]

# Visible room rewards, kept alongside the event-driven achievement catalog.
REWARDS = {
    "fashion": "Coffee mugs on desks",
    "corner_office": "Gold monitor trim",
    "layout_bullpen": "Bullpen layout",
    "pet_cat": "Sleeping cat on the sofa",
    "pet_plant": "Desk ferns",
    "pet_dog": "A second interactive cat",
    "pet_fish": "Lounge aquarium",
    "weather_storm": "Warm lounge lamp accent",
    "arcade_break": "Animated arcade screen",
    "listening_room": "Record-player visualizer",
    "helping_hand": "Desk robot wave",
    "green_thumb": "Terrarium fireflies",
}


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
            "errors": 0,
            "by_tool": {},
            "by_platform": {},
        },
        "unlocks": {},
        "last_ts": 0.0,
        "last_ts_counts": {},
        "recent": [],
    }


def normalize_achievements(data: Dict[str, Any]) -> bool:
    """Remove retired records without changing earned XP, stats or cursors.

    Active IDs remain earned even when an old display record is incomplete.
    Names and hints come from the current catalog; acquisition times are kept.
    The caller persists changes in its existing transaction.
    """
    catalog = {badge["id"]: badge for badge in CATALOG}
    previous = data.get("unlocks")
    unlocks = {}
    for aid, record in (previous.items() if isinstance(previous, dict) else []):
        if aid not in catalog:
            continue
        at = record.get("at") if isinstance(record, dict) else None
        try:
            valid_time = type(at) in (int, float) and math.isfinite(at)
        except (ValueError, OverflowError):
            valid_time = False
        unlocks[aid] = {"at": at if valid_time else None, "name": catalog[aid]["name"]}

    recent = []
    seen = set()
    previous_recent = data.get("recent")
    for record in reversed(previous_recent if isinstance(previous_recent, list) else []):
        aid = record.get("id") if isinstance(record, dict) else None
        if not isinstance(aid, str) or aid not in unlocks or aid in seen:
            continue
        seen.add(aid)
        recent.append({"id": aid, "name": catalog[aid]["name"],
                       "hint": catalog[aid]["hint"], "at": unlocks[aid]["at"]})
        if len(recent) == 8:
            break
    recent.reverse()
    changed = previous != unlocks or previous_recent != recent
    if changed:
        data["unlocks"] = unlocks
        data["recent"] = recent
    return changed


def load(path: Path) -> Dict[str, Any]:
    try:
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            base = _empty()
            base.update({k: data.get(k, base[k]) for k in base})
            base["stats"] = {**_empty()["stats"], **(data.get("stats") or {})}
            if "last_ts_counts" not in data:
                base["last_ts_counts"] = None
            normalize_achievements(base)
            return base
    except Exception:
        pass
    return _empty()


def save(path: Path, data: Dict[str, Any]) -> None:
    try:
        data = dict(data)
        normalize_achievements(data)
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
    out = []
    r = rank_for(xp)
    if r in ("staff", "principal", "distinguished"):
        out.append("mug")
    if r in ("principal", "distinguished"):
        out.append("gold_monitor")
    if r == "distinguished":
        out.append("crown")
    if "pet_plant" in unlocks:
        out.append("fern")
    if "pet_dog" in unlocks:
        out.append("gitcat")   # legacy badge id; reward is a second cat
    if "pet_fish" in unlocks:
        out.append("fish_tank")
    if "pet_cat" in unlocks:
        out.append("office_cat")
    if "weather_storm" in unlocks:
        out.append("storm_lamp")
    for badge, cosmetic in (("arcade_break", "arcade_glow"),
                            ("listening_room", "vinyl_spin"),
                            ("helping_hand", "robot_wave"),
                            ("green_thumb", "terrarium_glow")):
        if badge in unlocks:
            out.append(cosmetic)
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


def record_theme_switch_data(data: Dict[str, Any]) -> None:
    """Update the aggregate inside the caller's persistence transaction."""
    stats = data["stats"]
    stats["theme_switches"] = int(stats.get("theme_switches") or 0) + 1
    n = stats["theme_switches"]
    if n >= 5:
        _unlock(data, "theme_designer")


def _runtime_family(platform: str) -> str:
    platform = platform.strip().lower().replace("_", "-").replace(" ", "-")
    return {"cli": "hermes", "telegram": "hermes", "gateway": "hermes",
            "hermes-cli": "hermes", "claude-code": "claude", "codex-cli": "codex"}.get(platform, platform)


def ingest(data: Dict[str, Any], events: List[Dict[str, Any]], *,
           new_batch: bool = False) -> Dict[str, Any]:
    """Apply events; ``new_batch`` requires a transactional receipt cursor.

    The timestamp boundary is retained only for importing legacy progress.
    A durable inbox consumer already knows which records are new, so every
    record in its batch counts even when its producer clock goes backwards.
    """
    last = float(data.get("last_ts") or 0)
    stats = data["stats"]
    plats: Set[str] = set(stats.get("platforms") or [])
    newest = last
    previous_counts = data.get("last_ts_counts")
    boundary_counts = Counter()
    newest_counts = Counter()

    READ = {"read_file", "search_files", "skill_view", "read", "glob", "grep", "list", "Read", "Grep", "Glob"}
    WRITE = {"write_file", "patch", "skill_manage", "edit", "write", "apply_patch", "Edit", "Write"}
    BROWSE = {"web_search", "web_extract", "browser_navigate", "webfetch", "websearch", "WebFetch", "WebSearch"}
    SHELL = {"terminal", "execute_code", "process", "bash", "Bash"}

    by_tool = dict(stats.get("by_tool") or {})
    by_plat = dict(stats.get("by_platform") or {})

    for ev in events:
        try:
            ts = float(ev.get("ts") or 0)
        except (TypeError, ValueError, OverflowError):
            continue
        if not math.isfinite(ts):
            continue
        if new_batch:
            # Durable receipts already own replay identity. Retaining serialized
            # bodies here would duplicate history outside its retention limit.
            newest = max(newest, ts)
        else:
            if ts < last:
                continue
            identity = json.dumps(ev, sort_keys=True, separators=(",", ":"))
            if ts > newest:
                newest = ts
                newest_counts.clear()
            if ts == newest:
                newest_counts[identity] += 1
            if ts == last:
                boundary_counts[identity] += 1
                # Existing stores without a boundary cursor have already counted
                # their final timestamp. Track it only for legacy ingestion.
                if previous_counts is None or boundary_counts[identity] <= previous_counts.get(identity, 0):
                    continue
        kind = ev.get("event")
        plat = str(ev.get("platform") or "")
        if plat:
            plats.add(plat)
            by_plat[plat] = int(by_plat.get(plat) or 0) + 1
        if kind == "session_start":
            runtime = _runtime_family(plat)
            stats["sessions"] = int(stats.get("sessions") or 0) + 1
            data["xp"] = int(data.get("xp") or 0) + 5
            try:
                hour = time.localtime(ts).tm_hour
            except (ValueError, OverflowError, OSError):
                hour = None  # An invalid source clock cannot earn a time badge.
            if hour is not None:
                if 0 <= hour < 5:
                    _unlock(data, "night_owl")
                if 5 <= hour < 8:
                    _unlock(data, "early_bird")
            _unlock(data, "first_shift")
            if runtime == "opencode":
                _unlock(data, "open_floor")
            if plat.strip().lower() == "telegram":
                _unlock(data, "telegram_desk")
            if runtime == "claude":
                _unlock(data, "claude_desk")
            if runtime == "codex":
                _unlock(data, "codex_desk")
        elif kind == "tool_start":
            stats["tools"] = int(stats.get("tools") or 0) + 1
            data["xp"] = int(data.get("xp") or 0) + 1
            tool = str(ev.get("tool_name") or "")
            if tool:
                by_tool[tool] = int(by_tool.get(tool) or 0) + 1
            if tool in READ:
                stats["reads"] = int(stats.get("reads") or 0) + 1
            elif tool in WRITE:
                stats["writes"] = int(stats.get("writes") or 0) + 1
            elif tool in BROWSE:
                stats["browses"] = int(stats.get("browses") or 0) + 1
            elif tool in SHELL:
                stats["shells"] = int(stats.get("shells") or 0) + 1
        elif kind == "tool_end" and ev.get("status") == "error":
            stats["errors"] = int(stats.get("errors") or 0) + 1
        elif kind == "subagent_start":
            stats["subagents"] = int(stats.get("subagents") or 0) + 1
            data["xp"] = int(data.get("xp") or 0) + 8
            _unlock(data, "gold_collar")
        elif kind == "approval_request":
            stats["approvals"] = int(stats.get("approvals") or 0) + 1
            data["xp"] = int(data.get("xp") or 0) + 3
            _unlock(data, "red_alert")

    stats["by_tool"] = by_tool
    stats["by_platform"] = by_plat
    stats["platforms"] = sorted(plats)
    runtimes = {_runtime_family(platform) for platform in plats} - {""}
    if {"hermes", "opencode"} <= runtimes:
        _unlock(data, "two_houses")
    if {"hermes", "opencode", "claude"} <= runtimes:
        _unlock(data, "three_houses")
    if len(runtimes) >= 3:
        _unlock(data, "polyglot")
    if int(stats.get("tools") or 0) >= 50:
        _unlock(data, "coffee_break")
    if int(stats.get("tools") or 0) >= 100:
        _unlock(data, "centurion")
    if int(stats.get("tools") or 0) >= 500:
        _unlock(data, "workhorse")
    if int(stats.get("tools") or 0) >= 1000:
        _unlock(data, "thousand_cuts")
    if int(stats.get("tools") or 0) >= 5000:
        _unlock(data, "five_k")
    if int(stats.get("reads") or 0) >= 25:
        _unlock(data, "reader")
    if int(stats.get("writes") or 0) >= 25:
        _unlock(data, "typer")
    if int(stats.get("browses") or 0) >= 15:
        _unlock(data, "browser_tab")
    if int(stats.get("browses") or 0) >= 25:
        _unlock(data, "pet_fish")
    if (int(stats.get("sessions") or 0) >= 100) and (int(stats.get("tools") or 0) >= 50):
        _unlock(data, "pet_dog")
    if int(stats.get("shells") or 0) >= 25:
        _unlock(data, "shell_jockey")
    if int(stats.get("subagents") or 0) >= 10:
        _unlock(data, "swarm")
    if len(by_tool) >= 10:
        _unlock(data, "toolkit")
    if any(int(v) >= 50 for v in by_tool.values()):
        _unlock(data, "specialist")
    if int(stats.get("errors") or 0) >= 10:
        _unlock(data, "oops")
    rk = rank_for(int(data.get("xp") or 0))
    if rk in ("staff", "principal", "distinguished"):
        _unlock(data, "fashion")
    if rk in ("principal", "distinguished"):
        _unlock(data, "corner_office")
    if int(stats.get("sessions") or 0) >= 10:
        _unlock(data, "layout_bullpen")
    if int(stats.get("sessions") or 0) >= 50:
        _unlock(data, "pet_cat")
        _unlock(data, "deep_work")
    if int(stats.get("tools") or 0) >= 10000:
        _unlock(data, "marathon")
    if int(stats.get("sessions") or 0) >= 1:
        _unlock(data, "pet_plant")
    if int(stats.get("sessions") or 0) >= 100:
        _unlock(data, "weather_sun")
    if int(stats.get("errors") or 0) >= 5:
        _unlock(data, "weather_storm")
    for badge, stat, threshold in (("arcade_break", "tools", 100),
                                   ("listening_room", "sessions", 5),
                                   ("helping_hand", "subagents", 1),
                                   ("green_thumb", "reads", 25),
                                   ("measured_work", "usage_reports", 1)):
        if int(stats.get(stat) or 0) >= threshold:
            _unlock(data, badge)

    data["stats"] = stats
    data["last_ts"] = newest
    if new_batch:
        data["last_ts_counts"] = {}
    elif newest_counts:
        data["last_ts_counts"] = dict(newest_counts)
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
    data = dict(data)
    normalize_achievements(data)
    xp = int(data.get("xp") or 0)
    nxt = None
    for need, label in RANKS:
        if xp < need:
            nxt = {"rank": label, "need": need}
            break
    stats = data.get("stats") or {}
    by_tool = stats.get("by_tool") or {}
    plats = set(stats.get("platforms") or [])
    return {
        "xp": xp,
        "rank": rank_for(xp),
        "next": nxt,
        "stats": stats,
        "cosmetics": cosmetics_for(xp, data.get("unlocks") or {}),
        "unlocks": [
            {"id": k, "name": v.get("name") or k, "at": v.get("at")}
            for k, v in sorted((data.get("unlocks") or {}).items(), key=lambda kv: kv[1].get("at") or 0)
        ],
        "recent": data.get("recent") or [],
        "catalog": [
            {"id": c["id"], "name": c["name"], "hint": c["hint"],
             "xp": c["xp"], "reward": REWARDS.get(c["id"]),
             "have": c["id"] in (data.get("unlocks") or {}),
             "progress": 100 if c["id"] in (data.get("unlocks") or {}) else _progress_for(c["id"], stats, xp, plats, by_tool)}
            for c in CATALOG
        ],
    }


def _progress_for(badge_id: str, stats: Dict[str, Any], xp: int,
                  plats: set, by_tool: dict) -> int:
    """Return 0..100 progress for a badge so the front-end can show a bar."""
    def pct(num: int, den: int) -> int:
        return min(100, max(0, int(round(num / max(1, den) * 100))))

    tools = int(stats.get("tools") or 0)
    sessions = int(stats.get("sessions") or 0)
    reads = int(stats.get("reads") or 0)
    writes = int(stats.get("writes") or 0)
    browses = int(stats.get("browses") or 0)
    shells = int(stats.get("shells") or 0)
    subs = int(stats.get("subagents") or 0)
    errors = int(stats.get("errors") or 0)
    rk = rank_for(xp)
    runtimes = {_runtime_family(platform) for platform in plats} - {""}
    return {
        "first_shift": 100 if sessions >= 1 else 0,
        "open_floor": 100 if "opencode" in runtimes else 0,
        "telegram_desk": 100 if any(p.strip().lower() == "telegram" for p in plats) else 0,
        "claude_desk": 100 if "claude" in runtimes else 0,
        "two_houses": pct(len(runtimes & {"hermes", "opencode"}), 2),
        "three_houses": pct(len(runtimes & {"hermes", "opencode", "claude"}), 3),
        "polyglot": pct(len(runtimes), 3),
        "pair_programming": pct(int(stats.get("max_concurrent") or 0),2),
        "full_floor": pct(int(stats.get("max_concurrent") or 0),5),
        "gold_collar": pct(subs,1),
        "swarm": pct(subs,10),
        "coffee_break": pct(tools,50),
        "centurion": pct(tools,100),
        "thousand_cuts": pct(tools,1000),
        "five_k": pct(tools,5000),
        "reader": pct(reads,25),
        "typer": pct(writes,25),
        "browser_tab": pct(browses,15),
        "shell_jockey": pct(shells,25),
        "toolkit": pct(len(by_tool),10),
        "specialist": pct(max(int(v) for v in by_tool.values()) if by_tool else 0, 50),
        "oops": pct(errors,10),
        "red_alert": pct(int(stats.get("approvals") or 0),1),
        # An earned time badge is handled by snapshot's unlock lookup.
        "night_owl": 0,
        "early_bird": 0,
        "fashion": 100 if rk in ("staff","principal","distinguished") else pct(xp,150),
        "corner_office": 100 if rk in ("principal","distinguished") else pct(xp,400),
        "layout_bullpen": pct(sessions,10),
        "pet_cat": pct(sessions,50),
        "pet_plant": 100 if sessions >= 1 else 0,
        "pet_dog": min(pct(sessions,100), pct(tools,50)),
        "pet_fish": pct(browses,25),
        "weather_storm": pct(errors,5),
        "weather_sun": pct(sessions,100),
        "workhorse": pct(tools,500),
        "deep_work": pct(sessions,50),
        "theme_designer": pct(int(stats.get("theme_switches") or 0), 5),
        "marathon": pct(tools,10000),
        "codex_desk": 100 if "codex" in runtimes else 0,
        "arcade_break": pct(tools,100),
        "listening_room": pct(sessions,5),
        "helping_hand": pct(subs,1),
        "green_thumb": pct(reads,25),
        "measured_work": pct(int(stats.get("usage_reports") or 0),1),
    }.get(badge_id, 0)
