"""pixel-office plugin — a pixel-art virtual office for Hermes agents.

Every Hermes agent (main sessions AND delegate_task subagents) shows up as
an animated pixel character sitting at a desk in a tiny office, rendered in
your browser at http://127.0.0.1:8113 (port configurable).

Design:

* Hooks are pure observers — they never block, veto, or transform anything.
  Each hook appends one JSON line to ``~/.hermes/pixel-office/events.jsonl``.
  Appends and server startup are wrapped in try/except so observer errors
  never propagate into the agent loop.

* A daemon HTTP server thread is started lazily on the first event. It
  serves the office page and ``/state``, which folds the event log into a
  current-agents snapshot. Because state is derived from the shared event
  file (not process memory), agents from OTHER Hermes processes (gateway +
  CLI at once, cron sessions) appear in the same office. If the port is
  already bound, another Hermes process is serving — we just keep appending
  events and skip serving.

* The event log is trimmed when it exceeds ~512 KB (keeps the newest half),
  so it never grows unbounded.

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
_MAX_LOG_BYTES = 512 * 1024
# An agent with no events for this long is swept from the office.
_STALE_SECONDS = 30 * 60

_lock = threading.RLock()
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
    "max_chars": 4,
    "ambience": "auto",
    "show_labels": True,
    "decorations": True,
    "furniture": [],
}


def _valid_settings(data: Any) -> Dict[str, Any]:
    if not isinstance(data, dict):
        return {}
    out = {}
    choices = {"layout": {"open", "bullpen"}, "theme": {"default", "midnight", "amber"},
               "ambience": {"auto", "day", "night"}}
    for key, value in data.items():
        if key in choices:
            if isinstance(value, str) and value in choices[key]:
                out[key] = value
        elif key in ("sound", "show_labels", "decorations") and isinstance(value, bool):
            out[key] = value
        elif key == "max_chars" and type(value) is int and 2 <= value <= 8:
            out[key] = value
        elif key == "furniture" and isinstance(value, list):
            items = []
            for item in value[:24]:
                if (isinstance(item, dict) and item.get("kind") in ("sofa", "server", "shelf", "monstera", "coffee", "cooler", "lamp", "roundtable", "stool", "succulent", "planter")
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
    # track theme switches for theme_designer badge
    if cur.get("theme") and cur.get("theme") != prev_theme:
        try:
            try:
                from .progress import record_theme_switch
            except ImportError:
                from progress import record_theme_switch
            record_theme_switch(_office_dir() / "progress.json")
        except Exception:
            logger.debug("pixel-office theme switch tracking failed", exc_info=True)
    try:
        path = _settings_path()
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(cur, indent=2), encoding="utf-8")
        tmp.replace(path)
    except Exception:
        logger.debug("pixel-office settings save failed", exc_info=True)
        raise


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
        line = json.dumps(event, ensure_ascii=False, default=str)
        path = _events_path()
        with _lock:
            with open(path, "a", encoding="utf-8") as fh:
                fh.write(line + "\n")
            _maybe_trim(path)
        _ensure_server()
        # If the serve thread exited without binding (port raced with a dying
        # predecessor), clear the flag so a later event retries the bind.
        if not _server_bound():
            global _server_started
            _server_started = False
    except Exception as exc:  # observers must never break the loop — but say so
        logger.warning("pixel-office: failed to record event (%s: %s)",
                       type(exc).__name__, exc)


def _maybe_trim(path: Path) -> None:
    try:
        if path.stat().st_size <= _MAX_LOG_BYTES:
            return
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        keep = lines[len(lines) // 2:]
        tmp = path.with_suffix(".jsonl.tmp")
        tmp.write_text("\n".join(keep) + "\n", encoding="utf-8")
        tmp.replace(path)
    except Exception:
        logger.debug("pixel-office trim failed", exc_info=True)


# ---------------------------------------------------------------------------
# State folding (server side)
# ---------------------------------------------------------------------------

def _read_events() -> List[Dict[str, Any]]:
    path = _events_path()
    if not path.exists():
        return []
    out: List[Dict[str, Any]] = []
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                    if not isinstance(event, dict):
                        continue
                    if not isinstance(event.get("event"), str) or not event["event"].strip():
                        continue
                    timestamp = float(event.get("ts") or 0)
                    if not math.isfinite(timestamp):
                        continue
                    event["ts"] = timestamp
                    out.append(event)
                except Exception:
                    continue
    except Exception:
        logger.debug("pixel-office read failed", exc_info=True)
    return out


def _agent_key(ev: Dict[str, Any]) -> Optional[str]:
    sid = ev.get("session_id") or ev.get("child_session_id")
    if sid:
        return str(sid)
    # Fall back to pid so events without a session id still get a character.
    pid = ev.get("pid")
    return f"pid-{pid}" if pid else None


def _short(text: Any, n: int = 60) -> str:
    s = str(text or "").strip().replace("\n", " ")
    return s[: n - 1] + "…" if len(s) > n else s


def build_state() -> Dict[str, Any]:
    with _lock:
        return _build_state_locked()


def _build_state_locked() -> Dict[str, Any]:
    """Fold the event log into {agents: [...]} for the frontend."""
    agents: Dict[str, Dict[str, Any]] = {}
    active_tools: Dict[str, Dict[str, Dict[str, Any]]] = {}
    pending_input: Dict[str, Dict[tuple, Dict[str, Any]]] = {}
    inactive_sessions = set()
    now = time.time()

    def ensure(key: str, ev: Dict[str, Any]) -> Dict[str, Any]:
        a = agents.get(key)
        if a is None:
            a = {
                "id": key,
                "label": f"agent {key[-6:]}",
                "kind": "main",
                "status": "idle",
                "tool": "",
                "activity": "",
                "detail": "",
                "platform": ev.get("platform") or "",
                "first_seen": ev.get("ts", now),
                "updated_at": ev.get("ts", now),
            }
            agents[key] = a
        a["updated_at"] = ev.get("ts", a["updated_at"])
        if ev.get("platform"):
            a["platform"] = str(ev["platform"])
        if ev.get("parent_session_id"):
            a["kind"] = "subagent"
            a["parent"] = str(ev["parent_session_id"])
        return a

    def clear_tool(a: Dict[str, Any]) -> None:
        a["tool"] = ""
        a["activity"] = ""
        a["detail"] = ""

    def session_metadata(a: Dict[str, Any], ev: Dict[str, Any]) -> None:
        if ev.get("title"):
            a["label"] = _short(ev["title"], 60)
        if ev.get("parent_session_id"):
            a["kind"] = "subagent"
            a["parent"] = str(ev["parent_session_id"])

    def clear_pending(key: str) -> None:
        active_tools.pop(key, None)
        pending_input.pop(key, None)

    def settle(a: Dict[str, Any], key: str, detail: str = "") -> None:
        """A parallel completion must not erase another tool or unanswered prompt."""
        clear_tool(a)
        waiting = pending_input.get(key, {})
        tools = active_tools.get(key, {})
        if waiting:
            request = list(waiting.values())[-1]
            a["status"] = "waiting"
            a["detail"] = _short(request.get("question") or request.get("command"), 60) or "needs input"
        elif tools:
            tool = list(tools.values())[-1]
            a["status"] = "working"
            a["tool"] = str(tool.get("tool_name") or "")
            a["activity"] = str(tool.get("activity") or "working")
            a["detail"] = _short(tool.get("preview"))
        else:
            a["status"] = "thinking"
            a["detail"] = detail

    events = _read_events()
    for ev in events:
        kind = ev.get("event")
        key = _agent_key(ev)
        if not key:
            continue

        if kind == "session_start":
            inactive_sessions.discard(key)
            a = ensure(key, ev)
            clear_pending(key)
            clear_tool(a)
            a["status"] = "idle"
            plat = ev.get("platform") or ""
            a["label"] = f"{plat or 'hermes'} {key[-6:]}"
            a["detail"] = "session started"
            session_metadata(a, ev)
        elif kind == "session_update":
            # Titles/diffs change during a turn; metadata is not a new session.
            a = ensure(key, ev)
            session_metadata(a, ev)
        elif kind == "session_busy":
            inactive_sessions.discard(key)
            a = ensure(key, ev)
            if a["status"] not in ("working", "waiting"):
                clear_tool(a)
                a["status"] = "thinking"
        elif kind in ("session_idle", "session_error"):
            inactive_sessions.add(key)
            a = ensure(key, ev)
            previous_error = a["detail"] if a["status"] == "idle" and a["detail"].startswith("⚠ ") else ""
            clear_pending(key)
            clear_tool(a)
            a["status"] = "idle"
            if kind == "session_error":
                a["detail"] = f"⚠ {_short(ev.get('error_message'), 60) or 'session error'}"
            else:
                a["detail"] = previous_error
        elif kind == "session_end":
            inactive_sessions.add(key)
            if key in agents:
                clear_pending(key)
                clear_tool(agents[key])
                agents[key]["status"] = "gone"
                agents[key]["updated_at"] = ev.get("ts", now)
        elif kind == "subagent_start":
            child = ev.get("child_session_id")
            if child:
                ck = str(child)
                inactive_sessions.discard(ck)
                ev2 = dict(ev)
                ev2["session_id"] = ck
                a = ensure(ck, ev2)
                clear_pending(ck)
                clear_tool(a)
                a["kind"] = "subagent"
                a["label"] = _short(ev.get("child_goal"), 26) or f"sub {ck[-6:]}"
                a["status"] = "working"
                a["detail"] = _short(ev.get("child_goal"))
                a["parent"] = str(ev.get("parent_session_id") or "")
        elif kind == "subagent_stop":
            child = ev.get("child_session_id")
            if child:
                inactive_sessions.add(str(child))
            if child and str(child) in agents:
                clear_pending(str(child))
                clear_tool(agents[str(child)])
                agents[str(child)]["status"] = "done"
                agents[str(child)]["updated_at"] = ev.get("ts", now)
        elif kind == "tool_start":
            inactive_sessions.discard(key)
            a = ensure(key, ev)
            call = str(ev.get("call_id") or f"legacy:{ev.get('tool_name') or ''}")
            active_tools.setdefault(key, {})[call] = ev
            settle(a, key)
        elif kind == "tool_end":
            if key in inactive_sessions:
                continue
            a = ensure(key, ev)
            tools = active_tools.setdefault(key, {})
            call = ev.get("call_id")
            if call:
                tools.pop(str(call), None)
            else:
                matched = [c for c, tool in tools.items() if tool.get("tool_name") == ev.get("tool_name")]
                if matched:
                    for c in matched:
                        tools.pop(c)
                else:
                    # Older hooks do not expose call ids (or even tool names).
                    tools.clear()
            waiting = pending_input.get(key, {})
            for request, data in list(waiting.items()):
                if ((call and data.get("call_id") == call)
                    or (not data.get("call_id") and ev.get("tool_name") and data.get("tool_name") == ev["tool_name"])
                    or (not call and not data.get("call_id") and not data.get("tool_name"))):
                    waiting.pop(request)
            detail = ""
            if ev.get("status") == "error":
                detail = f"⚠ {_short(ev.get('error_message'), 40) or 'tool failed'}"
            settle(a, key, detail)
        elif kind in ("approval_request", "input_request"):
            inactive_sessions.discard(key)
            a = ensure(key, ev)
            request = (kind, str(ev.get("request_id") or ev.get("call_id") or "legacy"))
            pending_input.setdefault(key, {})[request] = ev
            settle(a, key)
        elif kind in ("approval_response", "input_response"):
            if key in inactive_sessions:
                continue
            a = ensure(key, ev)
            request_kind = kind.replace("response", "request")
            waiting = pending_input.setdefault(key, {})
            request_id = ev.get("request_id") or ev.get("call_id")
            resolved = waiting.pop((request_kind, str(request_id or "legacy")), None)
            if resolved is None and not ev.get("request_id") and ev.get("tool_name"):
                # Claude PermissionRequest omits tool_use_id on some versions.
                for request, data in list(waiting.items()):
                    if request[0] == request_kind and not data.get("call_id") and data.get("tool_name") == ev["tool_name"]:
                        resolved = waiting.pop(request)
            if not request_id:
                for request in [r for r in waiting if r[0] == request_kind]:
                    resolved = waiting.pop(request)
            choice = str(ev.get("choice") or "").lower()
            accepted = choice in ("once", "always", "allow", "approve", "approved", "yes", "y")
            detail = ""
            rejected_input = kind == "input_response" and choice in ("reject", "deny", "denied", "timeout", "cancelled")
            if (kind == "approval_response" and not accepted) or rejected_input:
                call = ev.get("call_id") or (resolved or {}).get("call_id")
                if call:
                    active_tools.setdefault(key, {}).pop(str(call), None)
                    # Rejecting a permission/question cancels that call, so
                    # another prompt attached to the same call cannot stay open.
                    for request, data in list(waiting.items()):
                        if data.get("call_id") == call:
                            waiting.pop(request)
                elif resolved or not request_id:
                    active_tools.pop(key, None)
                    # Older Claude permission hooks omit tool_use_id. Resolve
                    # an attached question by tool name only when unambiguous.
                    blocked_tool = ev.get("tool_name") or (resolved or {}).get("tool_name")
                    questions = [request for request, data in waiting.items()
                                 if request[0] == "input_request" and blocked_tool and data.get("tool_name") == blocked_tool]
                    if len(questions) == 1:
                        waiting.pop(questions[0])
                detail = f"{'question' if rejected_input else 'approval'}: {choice or 'response received'}"
            settle(a, key, detail)
            if kind == "approval_response" and accepted and a["status"] == "thinking":
                a["status"] = "working"

    # Sweep stale + long-gone agents.
    visible = []
    for a in agents.values():
        age = now - float(a.get("updated_at") or 0)
        if a["status"] == "gone" and age > 20:
            continue
        if a["status"] == "done" and age > 120:
            continue
        if age > _STALE_SECONDS:
            continue
        # Agents quiet for a bit are "idle", not eternally "thinking".
        if a["status"] in ("working", "thinking") and age > 300:
            clear_tool(a)
            a["status"] = "idle"
        visible.append(a)

    visible.sort(key=lambda a: (a["kind"] != "main", a.get("first_seen", 0)))
    for a in visible:
        try:
            a["duration_s"] = max(0, int(now - float(a.get("first_seen") or now)))
            a["idle_s"] = max(0, int(now - float(a.get("updated_at") or now)))
        except Exception:
            a["duration_s"] = 0
            a["idle_s"] = 0
    settings = _load_settings()
    progress = {}
    try:
        try:
            from .progress import apply_live, ingest, load, save, snapshot
        except ImportError:
            from progress import apply_live, ingest, load, save, snapshot

        ppath = _office_dir() / "progress.json"
        pdata = load(ppath)
        pdata = ingest(pdata, events)
        apply_live(pdata, len(visible))
        save(ppath, pdata)
        progress = snapshot(pdata)
    except Exception:
        logger.debug("pixel-office progress fold failed", exc_info=True)
    return {"agents": visible, "ts": now, "progress": progress, "settings": settings,
            "events": events[-30:], "mode": "demo" if os.environ.get("AGENT_OFFICE_DEMO") == "1" else "live"}


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
                elif route == "/settings":
                    body = json.dumps(_load_settings()).encode("utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Cache-Control", "no-store")
                elif route == "/assets-manifest":
                    body = json.dumps(_asset_manifest()).encode("utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
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
            except Exception:
                logger.debug("pixel-office request failed", exc_info=True)

        def respond(self, code, data):
            body = json.dumps(data).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_DELETE(self) -> None:
            if self.path.split("?")[0] != "/state":
                self.respond(404, {"error": "not found"})
                return
            try:
                with _lock:
                    removed = []
                    for filename in ("progress.json", "events.jsonl"):
                        path = _office_dir() / filename
                        if path.exists():
                            path.unlink()
                            removed.append(filename)
                self.respond(200, {"ok": True, "removed": removed})
            except OSError:
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

    try:
        srv = ThreadingHTTPServer(("127.0.0.1", _port), Handler)
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


def register(ctx: Any) -> None:
    ctx.register_hook("on_session_start", _on_session_start)
    ctx.register_hook("on_session_end", _on_session_end)
    ctx.register_hook("pre_tool_call", _pre_tool_call)
    ctx.register_hook("post_tool_call", _post_tool_call)
    ctx.register_hook("subagent_start", _subagent_start)
    ctx.register_hook("subagent_stop", _subagent_stop)
    ctx.register_hook("pre_approval_request", _pre_approval_request)
    ctx.register_hook("post_approval_response", _post_approval_response)
    logger.info(
        "pixel-office registered — office at http://127.0.0.1:%s once events flow",
        _resolve_port(),
    )
