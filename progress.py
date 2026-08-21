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
    {"id": "first_shift", "name": "First day", "hint": "clock in once", "xp": 10},
    {"id": "open_floor", "name": "Open floor", "hint": "an OpenCode session walks in", "xp": 25},
    {"id": "telegram_desk", "name": "Pager kid", "hint": "a Telegram session sits down", "xp": 15},
    {"id": "claude_desk", "name": "Orange desk", "hint": "a Claude Code session clocks in", "xp": 25},
    {"id": "two_houses", "name": "Two runtimes", "hint": "Hermes + OpenCode on the same floor", "xp": 40},
    {"id": "three_houses", "name": "Three runtimes", "hint": "Hermes + OpenCode + Claude", "xp": 60},
    {"id": "polyglot", "name": "Polyglot", "hint": "3+ runtimes ever", "xp": 35},
    {"id": "pair_programming", "name": "Pair desk", "hint": "2 agents at once", "xp": 15},
    {"id": "full_floor", "name": "Full floor", "hint": "5 agents on the floor", "xp": 30},
    {"id": "gold_collar", "name": "Boss moves", "hint": "spawn a subagent", "xp": 20},
    {"id": "swarm", "name": "Swarm", "hint": "10 subagents lifetime", "xp": 40},
    {"id": "coffee_break", "name": "Coffee break", "hint": "50 tools fired", "xp": 20},
    {"id": "centurion", "name": "Centurion", "hint": "100 tools", "xp": 30},
    {"id": "thousand_cuts", "name": "Thousand cuts", "hint": "1000 tools", "xp": 80},
    {"id": "five_k", "name": "Five thousand", "hint": "5000 tools", "xp": 120},
    {"id": "reader", "name": "Librarian", "hint": "25 read/search tools", "xp": 15},
    {"id": "typer", "name": "Keyboard warrior", "hint": "25 write/edit tools", "xp": 15},
    {"id": "browser_tab", "name": "Tab hoarder", "hint": "15 browse tools", "xp": 15},
    {"id": "shell_jockey", "name": "Shell jockey", "hint": "25 terminal/bash tools", "xp": 15},
    {"id": "toolkit", "name": "Toolkit", "hint": "10 distinct tools used", "xp": 25},
    {"id": "specialist", "name": "Specialist", "hint": "one tool 50 times", "xp": 25},
    {"id": "oops", "name": "Oops", "hint": "10 tool errors", "xp": 10},
    {"id": "red_alert", "name": "Red alert", "hint": "an approval pops", "xp": 10},
    {"id": "night_owl", "name": "Night owl", "hint": "work between 00:00–05:00", "xp": 20},
    {"id": "early_bird", "name": "Early bird", "hint": "work between 05:00–08:00", "xp": 15},
    {"id": "fashion", "name": "Office drip", "hint": "hit staff rank", "xp": 0},
    {"id": "corner_office", "name": "Corner office", "hint": "hit principal rank", "xp": 0},
    {"id": "layout_bullpen", "name": "Bullpen layout", "hint": "10 sessions ever", "xp": 25},
    {"id": "layout_war_room", "name": "War room", "hint": "principal rank", "xp": 40},
    {"id": "layout_lounge", "name": "Lounge layout", "hint": "3+ runtimes at once", "xp": 30},
    {"id": "layout_mexico", "name": "Roof deck", "hint": "night owl + 5 sessions", "xp": 35},
    {"id": "layout_garden", "name": "Garden", "hint": "25 writes + 100 sessions", "xp": 50},
    {"id": "layout_library", "name": "Library", "hint": "25 reads", "xp": 35},
    {"id": "layout_arcade", "name": "Arcade", "hint": "5000 tools", "xp": 60},
    {"id": "layout_penthouse", "name": "Penthouse", "hint": "10000 tools", "xp": 100},
    {"id": "layout_beach", "name": "Beach day", "hint": "100 sessions + switch theme 10 times", "xp": 60},
    {"id": "layout_atelier", "name": "Atelier", "hint": "100 writes + 100 sessions", "xp": 70},
    {"id": "layout_spaceship", "name": "Mission control", "hint": "10k tools + 3 platforms", "xp": 120},
    {"id": "areas_q1", "name": "Cartographer", "hint": "paint one named area", "xp": 10},
    {"id": "areas_q2", "name": "City planner", "hint": "paint three areas", "xp": 25},
    {"id": "pet_cat", "name": "Office cat", "hint": "50 sessions", "xp": 15},
    {"id": "pet_plant", "name": "Office fern", "hint": "first session", "xp": 0},
    {"id": "pet_dog", "name": "Office dog", "hint": "100 sessions + 50 tools", "xp": 30},
    {"id": "pet_fish", "name": "Office fish", "hint": "25 browse tools", "xp": 20},
    {"id": "weather_storm", "name": "Stormy", "hint": "5 errors in one day", "xp": 15},
    {"id": "weather_sun", "name": "Sunny", "hint": "100 sessions", "xp": 25},
    {"id": "canvas_artisan", "name": "Canvas artisan", "hint": "paint 30 tiles", "xp": 30},
    {"id": "auto_arrange", "name": "Auto-arrange", "hint": "50 sessions", "xp": 25},
    {"id": "theme_designer", "name": "Theme designer", "hint": "switch theme 5 times", "xp": 20},
    {"id": "tour_guide", "name": "Tour guide", "hint": "open 5 different sheets", "xp": 15},
    {"id": "screenshotter", "name": "Screenshotter", "hint": "import a layout", "xp": 10},
    {"id": "decorator", "name": "Decorator", "hint": "paint 100 tiles", "xp": 50},
    {"id": "architect", "name": "Architect", "hint": "3 areas + folder maps", "xp": 40},
    {"id": "marathon", "name": "Marathon", "hint": "10k tools", "xp": 80},
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
            "errors": 0,
            "by_tool": {},
            "by_platform": {},
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
    if "claude_desk" in unlocks:
        out.append("orange_scarf")
    if "pet_plant" in unlocks:
        out.append("fern")
    if "pet_cat" in unlocks:
        out.append("office_cat")
    if "weather_sun" in unlocks:
        out.append("sun")
    if "weather_storm" in unlocks:
        out.append("storm_lamp")
    if "marathon" in unlocks:
        out.append("desk_glass")
    if "centurion" in unlocks:
        out.append("desk_standing")
    if "fashion" in unlocks:
        out.append("desk_wood")
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


def record_theme_switch(path=None) -> None:
    """Count a theme switch (called from POST /settings when theme changes)."""
    ppath = path or (Path.home() / ".hermes" / "pixel-office" / "progress.json")
    data = load(ppath) if Path(ppath).exists() else _empty()
    stats = data["stats"]
    stats["theme_switches"] = int(stats.get("theme_switches") or 0) + 1
    n = stats["theme_switches"]
    if n >= 5:
        _unlock(data, "theme_designer")
    if n >= 10 and int(stats.get("sessions") or 0) >= 100:
        _unlock(data, "layout_beach")
    save(ppath, data)


def ingest(data: Dict[str, Any], events: List[Dict[str, Any]]) -> Dict[str, Any]:
    last = float(data.get("last_ts") or 0)
    stats = data["stats"]
    plats: Set[str] = set(stats.get("platforms") or [])
    live: Set[str] = set()
    max_seen = int(stats.get("max_concurrent") or 0)
    newest = last

    READ = {"read_file", "search_files", "skill_view", "read", "glob", "grep", "list", "Read", "Grep", "Glob"}
    WRITE = {"write_file", "patch", "skill_manage", "edit", "write", "apply_patch", "Edit", "Write"}
    BROWSE = {"web_search", "web_extract", "browser_navigate", "webfetch", "websearch", "WebFetch", "WebSearch"}
    SHELL = {"terminal", "execute_code", "process", "bash", "Bash"}

    by_tool = dict(stats.get("by_tool") or {})
    by_plat = dict(stats.get("by_platform") or {})

    for ev in events:
        ts = float(ev.get("ts") or 0)
        if ts <= last:
            continue
        newest = max(newest, ts)
        kind = ev.get("event")
        plat = str(ev.get("platform") or "")
        if plat:
            plats.add(plat)
            by_plat[plat] = int(by_plat.get(plat) or 0) + 1
        if kind == "session_start":
            stats["sessions"] = int(stats.get("sessions") or 0) + 1
            data["xp"] = int(data.get("xp") or 0) + 5
            sid = ev.get("session_id")
            if sid:
                live.add(str(sid))
            hour = time.localtime(ts).tm_hour
            if 0 <= hour < 5:
                _unlock(data, "night_owl")
            if 5 <= hour < 8:
                _unlock(data, "early_bird")
            _unlock(data, "first_shift")
            if plat == "opencode":
                _unlock(data, "open_floor")
            if plat == "telegram":
                _unlock(data, "telegram_desk")
            if plat in ("claude", "claude-code"):
                _unlock(data, "claude_desk")
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
    hermesish = bool(plats & {"cli", "telegram", "gateway", "hermes"})
    if hermesish and "opencode" in plats:
        _unlock(data, "two_houses")
    if hermesish and "opencode" in plats and (plats & {"claude", "claude-code"}):
        _unlock(data, "three_houses")
    if len(plats) >= 3:
        _unlock(data, "polyglot")
    if int(stats.get("tools") or 0) >= 50:
        _unlock(data, "coffee_break")
    if int(stats.get("tools") or 0) >= 100:
        _unlock(data, "centurion")
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
        _unlock(data, "pet_cat")
    if rk in ("principal", "distinguished"):
        _unlock(data, "layout_war_room")
    if (int(stats.get("writes") or 0) >= 25) and (int(stats.get("sessions") or 0) >= 100):
        _unlock(data, "layout_garden")
    if int(stats.get("reads") or 0) >= 25:
        _unlock(data, "layout_library")
    if int(stats.get("tools") or 0) >= 5000:
        _unlock(data, "layout_arcade")
    if int(stats.get("tools") or 0) >= 10000:
        _unlock(data, "layout_penthouse")
        _unlock(data, "marathon")
    live_now = 0
    if rk in ("staff", "principal", "distinguished"):
        # unlock lounge if user has hit 3 platforms in their lifetime
        if len(plats) >= 3:
            _unlock(data, "layout_lounge")
    if "night_owl" in (data.get("unlocks") or {}) and int(stats.get("sessions") or 0) >= 5:
        _unlock(data, "layout_mexico")
    if (int(stats.get("sessions") or 0) >= 100) and len(plats) >= 10:
        _unlock(data, "layout_beach")
    if (int(stats.get("writes") or 0) >= 100) and (int(stats.get("sessions") or 0) >= 100):
        _unlock(data, "layout_atelier")
    if (int(stats.get("tools") or 0) >= 10000) and len(plats) >= 3:
        _unlock(data, "layout_spaceship")
    _unlock(data, "pet_plant")
    if int(stats.get("sessions") or 0) >= 100:
        _unlock(data, "weather_sun")
        _unlock(data, "auto_arrange")
    if int(stats.get("errors") or 0) >= 5:
        _unlock(data, "weather_storm")

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
    stats = data.get("stats") or {}
    by_tool = stats.get("by_tool") or {}
    by_platform = stats.get("by_platform") or {}
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
             "have": c["id"] in (data.get("unlocks") or {}),
             "progress": _progress_for(c["id"], stats, xp, plats, by_tool, by_platform)}
            for c in CATALOG
        ],
    }


def _progress_for(badge_id: str, stats: Dict[str, Any], xp: int,
                  plats: set, by_tool: dict, by_platform: dict) -> int:
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
    has_nightowl = "night_owl" in (stats.get("_unlocks") or {})
    return {
        "first_shift": 100 if sessions >= 1 else 0,
        "open_floor": 100 if "opencode" in plats else 0,
        "telegram_desk": 100 if "telegram" in plats else 0,
        "claude_desk": 100 if any("claude" in p for p in plats) else 0,
        "two_houses": 100 if "opencode" in plats and (plats & {"cli","telegram","gateway","hermes"}) else pct(2,2),
        "three_houses": 100 if ("opencode" in plats and any("claude" in p for p in plats)
                               and (plats & {"cli","telegram","gateway","hermes"})) else pct(2,3),
        "polyglot": pct(len(plats),3),
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
        "night_owl": 100 if has_nightowl else 0,
        "early_bird": 100 if has_nightowl else 0,
        "fashion": 100 if rk in ("staff","principal","distinguished") else pct(xp,50),
        "corner_office": 100 if rk in ("principal","distinguished") else pct(xp,300),
        "layout_bullpen": pct(sessions,10),
        "layout_war_room": 100 if rk in ("principal","distinguished") else pct(xp,1200),
        "layout_lounge": pct(len(plats),3),
        "layout_mexico": pct(sessions,5),
        "layout_garden": min(pct(writes,25), pct(sessions,100)),
        "layout_library": pct(reads,25),
        "layout_arcade": pct(tools,5000),
        "layout_penthouse": pct(tools,10000),
        "areas_q1": 100 if stats.get("_have_areas") else 0,
        "areas_q2": pct(int(stats.get("_area_count") or 0),3),
        "pet_cat": pct(sessions,50),
        "pet_plant": 100 if sessions >= 1 else 0,
        "pet_dog": min(pct(sessions,100), pct(tools,50)),
        "pet_fish": pct(browses,25),
        "weather_storm": pct(errors,5),
        "weather_sun": pct(sessions,100),
        "canvas_artisan": pct(int(stats.get("_painted_count") or 0), 30),
        "decorator": pct(int(stats.get("_painted_count") or 0), 100),
        "architect": 100 if (stats.get("_have_areas") and int(stats.get("_area_count") or 0) >= 3
                            and len(stats.get("_folder_areas") or {}) >= 1) else 0,
        "tour_guide": pct(int(stats.get("_sheets_opened") or 0), 5),
        "screenshotter": 100 if stats.get("_did_import") else 0,
        "layout_beach": min(pct(sessions,100), pct(len(plats),10)),
        "layout_atelier": min(pct(writes,100), pct(sessions,100)),
        "layout_spaceship": min(pct(tools,10000), pct(len(plats),3)),
        "mood_master": pct(int(stats.get("_moods_clicked") or 0), 10),
        "marathon": pct(tools,10000),
    }.get(badge_id, 0)
