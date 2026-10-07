"""pixel-office plugin — a pixel-art virtual office for Hermes agents.

Every Hermes agent (main sessions AND delegate_task subagents) shows up as
an animated pixel character sitting at a desk in a tiny office, rendered in
your browser at http://127.0.0.1:8113 (port configurable).

Design:

* Hooks are pure observers — they never veto or transform anything.
  Each hook atomically publishes one immutable record into the local inbox.
  Publishing and server startup are wrapped in try/except so observer errors
  never propagate into the agent loop.

* A daemon HTTP server thread is started lazily on the first event. It
  serves the office page and ``/state``, which folds the event log into a
  current-agents snapshot. Because state is checkpointed in a shared local
  SQLite database, agents from OTHER Hermes processes (gateway +
  CLI at once, cron sessions) appear in the same office. If the port is
  already bound, another Hermes process is serving — we just keep appending
  events and skip serving.

* Processed input files are removed only after their state and XP commit.
  Recent history has configurable count/age/byte retention. Pending approvals
  survive compaction and restart. Old events.jsonl integrations remain readable.

Configuration (all optional, config.yaml):

    plugins:
      entries:
        pixel-office:
          port: 8113        # HTTP port for the office page
          enabled: true

Nothing here touches the conversation, the prompt cache, or tool results.
"""

from __future__ import annotations

import json
import copy
import contextvars
import logging
import math
import os
import socket
import sys
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from hermes_constants import get_hermes_home
except ImportError:
    def get_hermes_home() -> Path:
        return Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")

_PLUGIN_DIR = Path(__file__).resolve().parent
if str(_PLUGIN_DIR) not in sys.path:
    sys.path.insert(0, str(_PLUGIN_DIR))

logger = logging.getLogger(__name__)

DEFAULT_PORT = 8113
_lock = threading.RLock()
_event_cache: Optional[tuple[tuple, List[Dict[str, Any]]]] = None
_server_started = False
_port: int = DEFAULT_PORT
# Current Hermes versions provide session/tool ids on approvals. Keep a
# context-local fallback for older hooks; one gateway process runs concurrent
# sessions, so a process-global "last session" can attribute the wrong agent.
_current_session_id = contextvars.ContextVar("office_session_id", default="")
_current_call_id = contextvars.ContextVar("office_call_id", default="")


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

def _office_dir() -> Path:
    d = get_hermes_home() / "pixel-office"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _events_path() -> Path:
    return _office_dir() / "events.jsonl"


def _settings_path() -> Path:
    return _office_dir() / "settings.json"


_DEFAULTS = {
    "layout": "open",
    "theme": "default",
    "sound": False,
    "music_track": "window-seat",
    "music_volume": 0.12,
    "max_chars": 4,
    "ambience": "auto",
    "show_labels": True,
    "decorations": True,
    "furniture": [],
    "room_name": "",
    "agent_names": {},
    "history_limit": 1000,
    "history_days": 7,
    "history_max_bytes": 5 * 1024 * 1024,
    "pet_names": {},
    "budget_usd": 0,
    "aquarium_name": "",
    "aquarium_species": ["ember"],
}


def _valid_settings(data: Any) -> Dict[str, Any]:
    if not isinstance(data, dict):
        return {}
    out = {}
    choices = {"layout": {"open", "bullpen"}, "theme": {"default", "midnight", "amber"},
               "ambience": {"auto", "day", "night"},
               "music_track": {"window-seat", "night-shift", "rainy-break"}}
    for key, value in data.items():
        if key in choices:
            if isinstance(value, str) and value in choices[key]:
                out[key] = value
        elif key in ("sound", "show_labels", "decorations") and isinstance(value, bool):
            out[key] = value
        elif key == "max_chars" and type(value) is int and 2 <= value <= 8:
            out[key] = value
        elif key in ("room_name", "aquarium_name") and isinstance(value, str):
            out[key] = " ".join(value.split())[:48]
        elif key == "agent_names" and isinstance(value, dict):
            out[key] = {str(k)[:200]: " ".join(v.split())[:48]
                        for k, v in list(value.items())[:128]
                        if isinstance(k, str) and k and isinstance(v, str) and v.strip()}
        elif key == "history_limit" and type(value) is int and value in (250, 1000, 5000):
            out[key] = value
        elif key == "history_days" and type(value) is int and value in (1, 7, 30):
            out[key] = value
        elif key == "history_max_bytes" and type(value) is int and value in (1024 * 1024, 5 * 1024 * 1024, 20 * 1024 * 1024):
            out[key] = value
        elif key == "budget_usd" and type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1000000000:
            out[key] = value
        elif key == "music_volume" and type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 0.5:
            out[key] = value
        elif key == "pet_names" and isinstance(value, dict):
            out[key] = {k: " ".join(v.split())[:32] for k, v in value.items()
                        if k in ("cat1", "cat2") and isinstance(v, str) and v.strip()}
        elif key == "aquarium_species" and isinstance(value, list):
            out[key] = list(dict.fromkeys(v for v in value[:4]
                                          if isinstance(v, str) and v in ("ember", "mint", "violet", "pearl"))) or ["ember"]
        elif key == "furniture" and isinstance(value, list):
            items = []
            for item in value[:24]:
                if (isinstance(item, dict) and item.get("kind") in (
                    "sofa", "server", "shelf", "monstera", "coffee", "cooler", "lamp",
                    "roundtable", "stool", "succulent", "planter", "whiteboard",
                    "printer", "cart", "coatrack", "arcade", "recordplayer", "robot", "terrarium", "jukebox")
                    and all(type(item.get(k)) in (int, float) and math.isfinite(item[k]) and 0 <= item[k] <= 1 for k in ("x", "y"))):
                    items.append({k: item[k] for k in ("kind", "x", "y")})
            out[key] = items
    return out


def _load_settings() -> Dict[str, Any]:
    try:
        path = _settings_path()
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
        else:
            data = {}
    except Exception:
        data = {}
    out = dict(_DEFAULTS)
    out.update(_valid_settings(data))
    return out


def _save_settings(payload: Dict[str, Any]) -> None:
    with _lock:
        _save_settings_locked(payload)


def _save_settings_locked(payload: Dict[str, Any]) -> None:
    cur = _load_settings()
    prev_theme = cur.get("theme")
    cur.update(_valid_settings(payload))
    try:
        path = _settings_path()
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(cur, indent=2), encoding="utf-8")
        tmp.replace(path)
    except Exception:
        logger.debug("pixel-office settings save failed", exc_info=True)
        raise
    if cur.get("theme") != prev_theme:
        try:
            _store().record_theme_switch()
        except Exception:
            logger.debug("pixel-office theme switch tracking failed", exc_info=True)


def _asset_manifest() -> Dict[str, Any]:
    """List bundled + user-added SVG assets. External dirs are read at startup."""
    bundled: List[Dict[str, str]] = []
    base = Path(__file__).resolve().parent / "web" / "assets"
    for f in sorted(base.glob("*.svg")):
        bundled.append({"id": f.stem, "src": f"/assets/{f.name}", "kind": "logo"})
    user: List[Dict[str, str]] = []
    user_dir = _office_dir() / "assets"
    if user_dir.is_dir():
        for f in sorted(user_dir.glob("*.svg")):
            user.append({"id": f"user:{f.stem}", "src": f"/user/{f.name}", "kind": "logo"})
    return {"bundled": bundled, "user": user}


# ---------------------------------------------------------------------------
# Event publishing (hook side — must be cheap and never raise)
# ---------------------------------------------------------------------------

def _publish(event: Dict[str, Any]) -> None:
    try:
        event.setdefault("ts", time.time())
        event.setdefault("pid", os.getpid())
        try:
            from .event_inbox import publish
        except ImportError:
            from event_inbox import publish
        publish(_office_dir(), event)
        _ensure_server()
        # If the serve thread exited without binding (port raced with a dying
        # predecessor), clear the flag so a later event retries the bind.
        if not _server_bound():
            global _server_started
            _server_started = False
    except Exception as exc:  # observers must never break the loop — but say so
        logger.warning("pixel-office: failed to record event (%s: %s)",
                       type(exc).__name__, exc)




# ---------------------------------------------------------------------------
# State folding (server side)
# ---------------------------------------------------------------------------

def _read_events() -> List[Dict[str, Any]]:
    """Return independent events for callers that may modify their result."""
    with _lock:
        return copy.deepcopy(_read_event_snapshot())


def _event_signature(path: Path, stat: os.stat_result) -> tuple:
    return (str(path), stat.st_dev, stat.st_ino, stat.st_size,
            stat.st_mtime_ns, stat.st_ctime_ns)


def _read_event_snapshot() -> List[Dict[str, Any]]:
    """Internal read-only snapshot; callers hold _lock while using it.

    Keep one stable parsed log. Any file change forces a full read so quiet
    waiting sessions and repeated same-timestamp events remain in the fold.
    """
    global _event_cache
    try:
        from .event_store import valid_event
    except ImportError:
        from event_store import valid_event
    path = _events_path().resolve()
    out: List[Dict[str, Any]] = []
    try:
        before = _event_signature(path, path.stat())
        if _event_cache is not None and _event_cache[0] == before:
            return _event_cache[1]
        _event_cache = None
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            opened = _event_signature(path, os.fstat(fh.fileno()))
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    event = valid_event(json.loads(line))
                    if event is not None:
                        out.append(event)
                except Exception:
                    continue
            finished = _event_signature(path, os.fstat(fh.fileno()))
        after = _event_signature(path, path.stat())
        if before == opened == finished == after:
            _event_cache = (after, out)
    except FileNotFoundError:
        _event_cache = None
    except Exception:
        _event_cache = None
        logger.debug("pixel-office read failed", exc_info=True)
    return out


def _short(text: Any, n: int = 60) -> str:
    s = str(text or "").strip().replace("\n", " ")
    return s[: n - 1] + "…" if len(s) > n else s


def build_state() -> Dict[str, Any]:
    with _lock:
        return _build_state_locked()


def _store():
    try:
        from .event_store import EventStore
    except ImportError:
        from event_store import EventStore
    return EventStore(_office_dir())


def _build_state_locked() -> Dict[str, Any]:
    """Apply new receipts and render the durable live checkpoint."""
    now = time.time()
    settings = _load_settings()
    state = _store().consume(_read_event_snapshot, now,
                             history_limit=settings["history_limit"],
                             history_days=settings["history_days"],
                             history_max_bytes=settings["history_max_bytes"])
    for agent in state["agents"]:
        agent["observed_label"] = agent["label"]
        agent["label"] = settings["agent_names"].get(agent["id"], agent["label"])
    return {**state, "ts": now, "settings": settings,
            "mode": "demo" if os.environ.get("AGENT_OFFICE_DEMO") == "1" else "live"}


# ---------------------------------------------------------------------------
# HTTP server
# ---------------------------------------------------------------------------

def _resolve_port() -> int:
    if os.environ.get("AGENT_OFFICE_PORT"):
        return int(os.environ["AGENT_OFFICE_PORT"])
    try:
        from hermes_cli.config import cfg_get, load_config

        p = cfg_get(load_config(), "plugins", "entries", "pixel-office", "port")
        if p:
            return int(p)
    except Exception:
        pass
    return DEFAULT_PORT


def _ensure_server() -> None:
    global _server_started
    if _server_started:
        return
    with _lock:
        if _server_started:
            return
        _server_started = True
    t = threading.Thread(target=_serve, name="pixel-office-http", daemon=True)
    t.start()


def _server_bound() -> bool:
    """True if a pixel-office HTTP server is actually listening on _port."""
    try:
        with socket.create_connection(("127.0.0.1", _port), timeout=1):
            return True
    except OSError:
        return False


_STATIC_TYPES = {
    ".css": "text/css",
    ".js": "application/javascript",
    ".html": "text/html; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".json": "application/json",
    ".woff2": "font/woff2",
}


def _safe_web_file(web_dir: Path, url_path: str) -> Optional[Path]:
    rel = url_path.split("?")[0].lstrip("/")
    if not rel or ".." in Path(rel).parts:
        return None
    path = (web_dir / rel).resolve()
    try:
        path.relative_to(web_dir.resolve())
    except ValueError:
        return None
    return path if path.is_file() else None


def _serve() -> None:
    global _port
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    _port = _resolve_port()
    web_dir = Path(__file__).resolve().parent / "web"
    html_path = web_dir / "template.html"

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args: Any) -> None:  # silence stdout
            pass

        def do_GET(self) -> None:
            try:
                route = self.path.split("?")[0]
                if route == "/":
                    body = html_path.read_bytes()
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Cache-Control", "no-store")
                elif route == "/state":
                    body = json.dumps(build_state()).encode("utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Cache-Control", "no-store")
                elif route == "/history":
                    from urllib.parse import parse_qs, urlsplit
                    query = parse_qs(urlsplit(self.path).query)
                    try:
                        limit = int(query.get("limit", ["1000"])[0])
                    except ValueError:
                        self.respond(400, {"error": "history limit must be an integer"})
                        return
                    with _lock:
                        build_state()
                        rows = _store().history(limit)
                    self.respond(200, {"events": rows})
                    return
                elif route == "/settings":
                    body = json.dumps(_load_settings()).encode("utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Cache-Control", "no-store")
                elif route == "/assets-manifest":
                    body = json.dumps(_asset_manifest()).encode("utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                elif route.startswith("/user/aquarium/"):
                    name = route.rsplit("/", 1)[-1]
                    allowed = {"ember.png", "mint.png", "violet.png", "pearl.png", "manifest.json"}
                    root = (_office_dir() / "assets" / "aquarium").resolve()
                    asset = (root / name).resolve()
                    if name in allowed and asset.parent == root and asset.is_file():
                        body = asset.read_bytes()
                        self.send_response(200)
                        self.send_header("Content-Type", "application/json" if name.endswith(".json") else "image/png")
                        self.send_header("Cache-Control", "no-store")
                    else:
                        self.respond(404, {"error": "optional aquarium pack not installed"})
                        return
                elif route.startswith("/user/"):
                    name = Path(route).name
                    asset = _office_dir() / "assets" / name
                    if asset.is_file() and asset.suffix == ".svg":
                        body = asset.read_bytes()
                        self.send_response(200)
                        self.send_header("Content-Type", "image/svg+xml")
                    else:
                        self.send_response(404)
                        body = b"not found"
                        self.send_header("Content-Type", "text/plain")
                else:
                    static_path = _safe_web_file(web_dir, route)
                    ctype = _STATIC_TYPES.get((static_path.suffix if static_path else ""), "")
                    if static_path and ctype:
                        body = static_path.read_bytes()
                        self.send_response(200)
                        self.send_header("Content-Type", ctype)
                        if static_path.suffix in (".js", ".css", ".html"):
                            self.send_header("Cache-Control", "no-store")
                        elif static_path.suffix == ".png":
                            self.send_header("Cache-Control", "max-age=86400")
                    else:
                        self.send_response(404)
                        body = b"not found"
                        self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception:
                logger.debug("pixel-office request failed", exc_info=True)
                try:
                    self.respond(500, {"error": "could not read office state"})
                except OSError:
                    pass

        def respond(self, code, data):
            body = json.dumps(data).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_DELETE(self) -> None:
            global _event_cache
            route = self.path.split("?")[0]
            if route not in ("/state", "/history"):
                self.respond(404, {"error": "not found"})
                return
            try:
                with _lock:
                    if route == "/history":
                        removed = _store().prune_history()
                        self.respond(200, {"ok": True, "removed_events": removed})
                        return
                    _store().reset(_read_event_snapshot)
                    _event_cache = None
                self.respond(200, {"ok": True, "cleared": ["progress", "history", "usage"],
                                   "legacy_log_retained": _events_path().exists()})
            except Exception:
                logger.debug("pixel-office reset failed", exc_info=True)
                self.respond(500, {"error": "could not reset state"})

        def do_POST(self) -> None:
            if self.path.split("?")[0] != "/settings":
                self.respond(404, {"error": "not found"})
                return
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                self.respond(415, {"error": "use application/json"})
                return
            try:
                length = int(self.headers.get("Content-Length") or 0)
                if not 0 < length <= 65536:
                    self.respond(413, {"error": "settings must be 1–65536 bytes"})
                    return
                self.connection.settimeout(5)
                payload = json.loads(self.rfile.read(length))
                if not isinstance(payload, dict):
                    raise ValueError("object required")
            except (ValueError, UnicodeError):
                self.respond(400, {"error": "expected a JSON object"})
                return
            try:
                _save_settings(payload)
                self.respond(200, _load_settings())
            except OSError:
                self.respond(500, {"error": "could not save settings"})

    class OfficeServer(ThreadingHTTPServer):
        daemon_threads = True
        next_maintenance = 0.0
        next_failure_log = 0.0

        def service_actions(self):
            # Consume even with no browser connected. Only unacknowledged
            # offline activity remains in the inbox between server runs.
            now = time.monotonic()
            if now >= self.next_maintenance:
                self.next_maintenance = now + 1.0
                try:
                    build_state()
                    self.next_failure_log = 0.0
                except Exception:
                    if now >= self.next_failure_log:
                        self.next_failure_log = now + 60.0
                        logger.warning("pixel-office background ingestion failed; inputs retained", exc_info=True)

    try:
        srv = OfficeServer(("127.0.0.1", _port), Handler)
    except OSError as exc:
        # Port already bound. Probe it: a healthy pixel-office answers /state
        # with JSON containing "agents". Anything else is a foreign squatter
        # (another app, or a ghost VS Code port-forward) — say so LOUDLY,
        # because to the user it looks like "office unreachable".
        verdict = _probe_port(_port)
        if verdict == "office":
            logger.info(
                "pixel-office: port %s already serving a healthy office "
                "(another Hermes process) — this process will feed events only",
                _port,
            )
        elif verdict.startswith("dead/"):
            # Port looked bound but nothing answers — a predecessor's socket
            # raced us. Log it and fall through so a later _ensure_server()
            # retry (flag cleared by _publish) can bind once it's truly free.
            logger.warning(
                "pixel-office: bind on %s failed (%s) and probe says %s — "
                "will retry on next event",
                _port, exc, verdict,
            )
            return
        else:
            logger.warning(
                "pixel-office: could NOT bind 127.0.0.1:%s (%s) and the "
                "current listener does not answer like a pixel-office "
                "(probe: %s). Another app or a stale VS Code port-forward is "
                "squatting the port. Fix: free the port, or set "
                "plugins.entries.pixel-office.port in config.yaml and update "
                "the extension's hermesPixelOffice.stateUrl to match.",
                _port, exc, verdict,
            )
        return
    logger.info("pixel-office serving at http://127.0.0.1:%s", _port)
    try:
        srv.serve_forever()
    except Exception:
        logger.debug("pixel-office server exited", exc_info=True)


def _probe_port(port: int) -> str:
    """Classify whatever is listening on *port*: 'office', 'foreign', or 'dead'."""
    try:
        import urllib.request

        req = urllib.request.Request(f"http://127.0.0.1:{port}/state")
        with urllib.request.urlopen(req, timeout=2) as resp:
            body = resp.read(4096).decode("utf-8", errors="replace")
        return "office" if '"agents"' in body else "foreign"
    except Exception as exc:
        return f"dead/{type(exc).__name__}"


# ---------------------------------------------------------------------------
# Hook callbacks — all **kwargs so core payload changes never break us
# ---------------------------------------------------------------------------

# Tool name → activity shown in the office (drives the character animation).
_ACTIVITY = {
    "write_file": "typing", "patch": "typing", "skill_manage": "typing",
    "read_file": "reading", "search_files": "reading", "skill_view": "reading",
    "web_search": "browsing", "web_extract": "browsing",
    "browser_navigate": "browsing", "browser_click": "browsing",
    "browser_snapshot": "browsing", "browser_vision": "browsing",
    "terminal": "running", "execute_code": "running", "process": "running",
    "delegate_task": "delegating",
}


def _activity_for(tool: str) -> str:
    return _ACTIVITY.get(str(tool or ""), "working")


def _on_session_start(**kw: Any) -> None:
    _publish({
        "event": "session_start",
        "session_id": kw.get("session_id"),
        "platform": kw.get("platform"),
    })


def _on_session_end(**kw: Any) -> None:
    _publish({"event": "session_end", "session_id": kw.get("session_id")})


def _pre_tool_call(**kw: Any) -> None:
    sid = kw.get("session_id") or ""
    _current_session_id.set(str(sid))
    _current_call_id.set(str(kw.get("tool_call_id") or kw.get("call_id") or ""))
    args = kw.get("args") or {}
    preview = ""
    if isinstance(args, dict):
        for k in ("command", "path", "query", "url", "goal", "pattern", "prompt"):
            if args.get(k):
                preview = str(args[k])
                break
    tool = kw.get("tool_name")
    _publish({
        "event": "tool_start",
        "session_id": sid,
        "call_id": _current_call_id.get(),
        "tool_name": tool,
        "activity": _activity_for(tool),
        "preview": _short(preview),
    })
    return None  # observer — never blocks


def _post_tool_call(**kw: Any) -> None:
    _publish({
        "event": "tool_end",
        "session_id": kw.get("session_id"),
        "call_id": kw.get("tool_call_id") or kw.get("call_id") or "",
        "tool_name": kw.get("tool_name"),
        "status": kw.get("status") or "ok",
        "error_message": kw.get("error_message"),
        "duration_ms": kw.get("duration_ms"),
    })
    completed_call = str(kw.get("tool_call_id") or kw.get("call_id") or "")
    if (str(kw.get("session_id") or "") == _current_session_id.get()
        and (not completed_call or completed_call == _current_call_id.get())):
        _current_session_id.set("")
        _current_call_id.set("")


def _subagent_start(**kw: Any) -> None:
    _publish({
        "event": "subagent_start",
        "parent_session_id": kw.get("parent_session_id"),
        "child_session_id": kw.get("child_session_id"),
        "child_role": kw.get("child_role"),
        "child_goal": kw.get("child_goal"),
    })


def _subagent_stop(**kw: Any) -> None:
    _publish({
        "event": "subagent_stop",
        "child_session_id": kw.get("child_session_id"),
    })


def _approval_identity(kw: Dict[str, Any]) -> tuple:
    sid = kw.get("session_id") or _current_session_id.get()
    call = kw.get("tool_call_id") or kw.get("call_id") or ""
    if not call and str(sid) == _current_session_id.get():
        call = _current_call_id.get()
    return sid, call


def _pre_approval_request(**kw: Any) -> None:
    sid, call = _approval_identity(kw)
    _publish({
        "event": "approval_request",
        "session_id": sid,
        "call_id": call,
        "request_id": kw.get("request_id") or "",
        "command": kw.get("command") or kw.get("description"),
        "surface": kw.get("surface"),
    })


def _post_approval_response(**kw: Any) -> None:
    sid, call = _approval_identity(kw)
    _publish({
        "event": "approval_response",
        "session_id": sid,
        "call_id": call,
        "request_id": kw.get("request_id") or "",
        "choice": kw.get("choice"),
    })


def _pre_llm_call(**kw: Any) -> None:
    _publish({"event": "session_busy", "session_id": kw.get("session_id"),
              "platform": kw.get("platform") or "hermes"})


def _post_llm_call(**kw: Any) -> None:
    _publish({"event": "session_idle", "session_id": kw.get("session_id"),
              "platform": kw.get("platform") or "hermes"})


def _post_api_request(**kw: Any) -> None:
    """Normalize one stable Hermes API attempt; reasoning is within output."""
    source = kw.get("usage")
    sid, request_id = kw.get("session_id"), kw.get("api_request_id")
    if not isinstance(source, dict) or not isinstance(sid, str) or not sid or not isinstance(request_id, str) or not request_id:
        return
    event = {"event": "usage", "platform": "hermes", "session_id": sid,
             "usage_id": request_id, "usage_scope": "api_request",
             "model": kw.get("response_model") or kw.get("model"), "provider": kw.get("provider")}
    fields = {"prompt_tokens": "input_tokens", "output_tokens": "output_tokens",
              "cache_read_tokens": "cached_input_tokens", "cache_write_tokens": "cache_write_tokens",
              "reasoning_tokens": "reasoning_output_tokens", "total_tokens": "total_tokens"}
    for source_key, target_key in fields.items():
        value = source.get(source_key)
        if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= (1 << 53) - 1:
            event[target_key] = value
    _publish(event)


def register(ctx: Any) -> None:
    ctx.register_hook("on_session_start", _on_session_start)
    ctx.register_hook("on_session_end", _on_session_end)
    ctx.register_hook("pre_tool_call", _pre_tool_call)
    ctx.register_hook("post_tool_call", _post_tool_call)
    ctx.register_hook("subagent_start", _subagent_start)
    ctx.register_hook("subagent_stop", _subagent_stop)
    ctx.register_hook("pre_approval_request", _pre_approval_request)
    ctx.register_hook("post_approval_response", _post_approval_response)
    # Old Hermes versions reject or warn about unknown hook names. Richer
    # telemetry must never prevent the established tool/session hooks loading.
    try:
        from hermes_cli.plugins import VALID_HOOKS
    except (ImportError, AttributeError):
        VALID_HOOKS = set()
    for name, callback in (("pre_llm_call", _pre_llm_call),
                           ("post_llm_call", _post_llm_call),
                           ("post_api_request", _post_api_request)):
        if name in VALID_HOOKS:
            ctx.register_hook(name, callback)
    logger.info(
        "pixel-office registered — office at http://127.0.0.1:%s once events flow",
        _resolve_port(),
    )
