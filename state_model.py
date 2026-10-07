"""Incremental observer lifecycle state, independent of storage and presentation.

Apply only newly received events, in arrival order. The caller owns delivery
and checkpoint transactions; this model preserves unfinished calls and prompts
across checkpoints without retaining the entire historical event stream.
"""
from __future__ import annotations

import copy
import math
from typing import Any, Dict, Iterable, Optional


def _agent_key(ev: Dict[str, Any]) -> Optional[str]:
    sid = ev.get("session_id") or ev.get("child_session_id")
    if sid:
        return str(sid)
    pid = ev.get("pid")
    return f"pid-{pid}" if pid else None


def _short(text: Any, n: int = 60) -> str:
    s = str(text or "").strip().replace("\n", " ")
    return s[: n - 1] + "…" if len(s) > n else s


class StateModel:
    """Durable activity plus independently derived display state."""

    def __init__(self, snapshot: Optional[Dict[str, Any]] = None):
        self.agents: Dict[str, Dict[str, Any]] = {}
        self.active_tools: Dict[str, Dict[str, Dict[str, Any]]] = {}
        self.pending_input: Dict[str, Dict[tuple, Dict[str, Any]]] = {}
        self.inactive_sessions: Dict[str, float] = {}
        if not snapshot:
            return
        if not isinstance(snapshot, dict) or snapshot.get("version") != 1:
            raise ValueError("Unsupported office state snapshot")
        data = copy.deepcopy(snapshot)
        self.agents = {a["id"]: a for a in data.get("agents", [])}
        self.active_tools = {
            key: dict(records) for key, records in data.get("active_tools", {}).items()
        }
        self.pending_input = {
            key: {tuple(request): event for request, event in records}
            for key, records in data.get("pending_input", {}).items()
        }
        self.inactive_sessions = data.get("inactive_sessions", {})

    def dump(self) -> Dict[str, Any]:
        """Return an independent JSON-safe checkpoint, preserving arrival order."""
        return copy.deepcopy({
            "version": 1,
            "agents": list(self.agents.values()),
            "active_tools": {
                key: list(records.items()) for key, records in self.active_tools.items()
            },
            "pending_input": {
                key: [[list(request), event] for request, event in records.items()]
                for key, records in self.pending_input.items()
            },
            "inactive_sessions": self.inactive_sessions,
        })

    def apply(self, events: Iterable[Dict[str, Any]], now: float, *, received_at: Optional[float] = None) -> None:
        """Fold observations in arrival order.

        New inbox batches supply their receipt clock. Legacy imports omit it,
        preserving historical ages while clamping impossible future clocks.
        Source timestamps remain available separately for audit/history.
        """
        agents = self.agents
        active_tools = self.active_tools
        pending_input = self.pending_input
        inactive_sessions = self.inactive_sessions

        def observed(ev: Dict[str, Any]) -> float:
            return received_at if received_at is not None else min(ev["ts"], now)

        def mark_inactive(key: str, ev: Dict[str, Any]) -> None:
            inactive_sessions[key] = max(
                inactive_sessions.get(key, observed(ev)), observed(ev),
                agents.get(key, {}).get("observed_at", observed(ev)),
            )

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
                    "first_received_at": observed(ev),
                    "observed_at": observed(ev),
                }
                agents[key] = a
            a["updated_at"] = max(a["updated_at"], ev.get("ts", a["updated_at"]))
            a["observed_at"] = max(a.get("observed_at", observed(ev)), observed(ev))
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

        for source in events:
            if not isinstance(source, dict) or not isinstance(source.get("event"), str) or not source["event"].strip():
                continue
            ev = copy.deepcopy(source)
            try:
                ev["ts"] = float(ev.get("ts", now) or 0)
            except (TypeError, ValueError, OverflowError):
                continue
            if not math.isfinite(ev["ts"]):
                continue
            kind = ev.get("event")
            key = _agent_key(ev)
            if not key:
                continue

            if kind == "session_start":
                inactive_sessions.pop(key, None)
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
                if key not in agents:
                    continue
                a = agents[key] if agents[key]["status"] in ("done", "gone") else ensure(key, ev)
                session_metadata(a, ev)
            elif kind == "session_busy":
                inactive_sessions.pop(key, None)
                a = ensure(key, ev)
                if a["status"] not in ("working", "waiting"):
                    clear_tool(a)
                    a["status"] = "thinking"
            elif kind in ("session_idle", "session_error"):
                previous = agents.get(key)
                if kind == "session_idle" and previous is None:
                    continue
                if kind == "session_idle" and previous and previous["status"] in ("done", "gone"):
                    continue  # A repeated terminal callback cannot extend its exit.
                mark_inactive(key, ev)
                a = ensure(key, ev)
                previous_error = a["detail"] if a["status"] == "idle" and a["detail"].startswith("⚠ ") else ""
                clear_pending(key)
                clear_tool(a)
                a["status"] = "done" if kind == "session_idle" and a["kind"] == "subagent" else "idle"
                if kind == "session_error":
                    a["detail"] = f"⚠ {_short(ev.get('error_message'), 60) or 'session error'}"
                else:
                    a["detail"] = previous_error
            elif kind == "session_end":
                if key in agents and agents[key]["status"] == "gone":
                    continue
                mark_inactive(key, ev)
                if key in agents:
                    clear_pending(key)
                    clear_tool(agents[key])
                    agents[key]["status"] = "gone"
                    agents[key]["updated_at"] = max(agents[key]["updated_at"], ev.get("ts", now))
                    agents[key]["observed_at"] = max(agents[key].get("observed_at", observed(ev)), observed(ev))
            elif kind == "subagent_start":
                child = ev.get("child_session_id")
                if child:
                    ck = str(child)
                    inactive_sessions.pop(ck, None)
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
                if child and str(child) in agents and agents[str(child)]["status"] in ("done", "gone"):
                    continue
                if child:
                    mark_inactive(str(child), ev)
                if child and str(child) in agents:
                    clear_pending(str(child))
                    clear_tool(agents[str(child)])
                    agents[str(child)]["status"] = "done"
                    agents[str(child)]["updated_at"] = max(agents[str(child)]["updated_at"], ev.get("ts", now))
                    agents[str(child)]["observed_at"] = max(agents[str(child)].get("observed_at", observed(ev)), observed(ev))
            elif kind == "tool_start":
                inactive_sessions.pop(key, None)
                a = ensure(key, ev)
                call = str(ev.get("call_id") or f"legacy:{ev.get('tool_name') or ''}")
                active_tools.setdefault(key, {})[call] = ev
                settle(a, key)
            elif kind == "tool_end":
                if key in inactive_sessions or key not in agents:
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
                inactive_sessions.pop(key, None)
                a = ensure(key, ev)
                request = (kind, str(ev.get("request_id") or ev.get("call_id") or "legacy"))
                pending_input.setdefault(key, {})[request] = ev
                settle(a, key)
            elif kind in ("approval_response", "input_response"):
                if key in inactive_sessions or key not in agents:
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


    def visible(self, now: float, stale_seconds: float = 1800) -> list[Dict[str, Any]]:
        """Return display copies; unanswered prompts remain until explicitly resolved."""
        visible = []
        for key, durable in self.agents.items():
            age = now - float(durable.get("observed_at", durable.get("updated_at")) or 0)
            waiting = bool(self.pending_input.get(key))
            if not waiting and (
                (durable["status"] == "gone" and age > 20)
                or (durable["status"] == "done" and age > 120)
                or age > stale_seconds
            ):
                continue
            agent = copy.deepcopy(durable)
            if agent["status"] in ("working", "thinking") and age > 300 and not waiting:
                agent.update(status="idle", tool="", activity="", detail="")
            agent["duration_s"] = max(0, int(now - float(agent.get("first_received_at", agent.get("first_seen")) or now)))
            agent["idle_s"] = max(0, int(age))
            visible.append(agent)
        visible.sort(key=lambda a: (a["kind"] != "main", a.get("first_seen", 0)))
        return visible

    def expire(self, now: float, stale_seconds: float = 1800) -> None:
        """Forget ordinary stale sessions, retaining pending prompts and recent tombstones.

        Hiding a gone/done avatar is only a presentation decision. Its closed
        marker remains for the full retention period, so late completions and
        permission responses cannot resurrect that session.
        """
        for key, agent in list(self.agents.items()):
            if now - float(agent.get("observed_at", agent.get("updated_at")) or 0) > stale_seconds and not self.pending_input.get(key):
                self.agents.pop(key)
                self.active_tools.pop(key, None)
                self.pending_input.pop(key, None)
        for key, timestamp in list(self.inactive_sessions.items()):
            latest = max(timestamp, self.agents.get(key, {}).get("observed_at", timestamp))
            if now - latest > stale_seconds and not self.pending_input.get(key):
                self.inactive_sessions.pop(key)
        for mapping in (self.active_tools, self.pending_input):
            for key in list(mapping):
                if key not in self.agents or not mapping[key]:
                    mapping.pop(key)
