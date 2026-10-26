"""Opt-in OpenCode session handoff with durable delivery receipts.

This adapter is deliberately separate from the fresh-process task runner and
from the observer adapters.  It pairs with one already-running local OpenCode
server, one of its project directories, and one existing session, and it only
dispatches a prompt after an explicit submit call.  Every submission is first
recorded as a durable operation in a dedicated receipts ledger, so a lost
acknowledgement, a server restart, or a reconnect can be reconciled against
the runtime's own session history before anything is retried.

The ledger lives in its own file.  It is never written by the task runner,
the observer event store, XP, or usage accounting, and office reset/prune
operations do not touch it.  Receipts are pruned only by this module, and
only terminal operations are ever pruned.

No credentials are accepted, stored, or logged.  The adapter talks only to a
loopback OpenCode server, sends no Authorization header, and never follows
redirects.  Errors returned to callers are redacted summaries, never raw
runtime response bodies.
"""
from __future__ import annotations

import json
import os
import re
import secrets
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, Optional
from urllib.parse import urlsplit


MAX_PROMPT_CHARS = 8192
MAX_ACTIVE_OPERATIONS = 2
MAX_RECEIPTS = 200
MAX_ERROR_CHARS = 300
REQUEST_TIMEOUT = 5.0

# Operation states.  "accepted" means the runtime acknowledged the async
# submission; it is not proof of delivery or completion.  "unknown" means a
# dispatch may have been accepted but its acknowledgement was lost; such an
# operation is reconciled against runtime history before any retry.
TERMINAL_STATES = frozenset({"completed", "failed", "rejected", "cancelled"})
ACTIVE_STATES = frozenset({"submitted", "accepted", "executing", "awaiting_input", "unknown"})

Transport = Callable[[str, str, Optional[Dict[str, Any]], float], "TransportResponse"]


class HandoffError(Exception):
    """A request error that can be returned to the local HTTP caller."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class TransportResponse:
    """One completed HTTP exchange with the paired OpenCode server."""

    def __init__(self, status: int, data: Any):
        self.status = status
        self.data = data


class TransportFailure(Exception):
    """The exchange failed; the request may or may not have been accepted.

    ``may_have_been_accepted`` is True only when the failure happened after
    the request was sent (timeout, reset, truncated response).  A failure
    before connection, or a completed HTTP response, never sets it.
    """

    def __init__(self, message: str, *, may_have_been_accepted: bool = False):
        super().__init__(message)
        self.may_have_been_accepted = may_have_been_accepted


def _redact(value: Any) -> str:
    """Reduce an arbitrary runtime error value to a short, safe summary."""
    text = value if isinstance(value, str) else json.dumps(value, default=str)
    text = "".join(char if char.isprintable() or char == " " else " " for char in text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > MAX_ERROR_CHARS:
        text = text[:MAX_ERROR_CHARS] + "…"
    return text or "unspecified runtime error"


def _no_redirect_opener() -> urllib.request.OpenerDirector:
    class RejectRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
            return None

    # Private loopback prompts must not inherit HTTP_PROXY/HTTPS_PROXY from
    # the user's environment.  An empty ProxyHandler disables automatic
    # system-proxy discovery while preserving the redirect rejection.
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), RejectRedirect)


def _urllib_transport(method: str, url: str, body: Optional[Dict[str, Any]],
                      timeout: float) -> TransportResponse:
    payload = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=payload, method=method)
    if payload is not None:
        request.add_header("Content-Type", "application/json")
    opener = _no_redirect_opener()
    try:
        with opener.open(request, timeout=timeout) as response:
            raw = response.read(1024 * 1024)
            status = response.status
    except urllib.error.HTTPError as exc:
        # A completed HTTP response: the runtime answered, so delivery of a
        # prompt submission is decided by the status, not by uncertainty.
        try:
            raw = exc.read(64 * 1024)
        except OSError:
            raw = b""
        status = exc.code
    except (TimeoutError, ConnectionResetError) as exc:
        raise TransportFailure(f"runtime exchange interrupted: {exc}",
                               may_have_been_accepted=True) from exc
    except urllib.error.URLError as exc:
        reason = getattr(exc, "reason", exc)
        accepted = isinstance(reason, (TimeoutError, ConnectionResetError))
        raise TransportFailure(f"runtime unreachable: {reason}",
                               may_have_been_accepted=accepted) from exc
    except OSError as exc:
        raise TransportFailure(f"runtime exchange failed: {exc}",
                               may_have_been_accepted=True) from exc
    if status in (301, 302, 303, 307, 308):
        raise TransportFailure(f"runtime answered with an unexpected redirect ({status})")
    data = None
    if raw:
        try:
            data = json.loads(raw.decode("utf-8", errors="replace"))
        except ValueError:
            data = None
    return TransportResponse(status, data)


class ReceiptLedger:
    """Durable, atomic storage for pairing state and operation receipts.

    The file is replaced atomically (temporary file, fsync, rename) on every
    change.  An unreadable existing file is an error, never a silent reset:
    losing receipts would break the no-duplicate-delivery guarantee.
    """

    VERSION = 1

    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.RLock()
        self._pairing: Optional[Dict[str, Any]] = None
        self._operations: Dict[str, Dict[str, Any]] = {}
        self._order: list[str] = []
        self._load()

    def _load(self) -> None:
        try:
            raw = self.path.read_bytes()
        except FileNotFoundError:
            return
        except OSError as exc:
            raise HandoffError(503, f"handoff receipts could not be read: {exc}") from exc
        try:
            data = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeError) as exc:
            raise HandoffError(
                503,
                "handoff receipts file could not be parsed; its contents are "
                "preserved. Repair or remove it to reset the handoff ledger.",
            ) from exc
        if not isinstance(data, dict) or data.get("version") != self.VERSION \
                or not isinstance(data.get("operations"), list):
            raise HandoffError(
                503,
                "handoff receipts file has an unsupported format; its contents "
                "are preserved. Repair or remove it to reset the handoff ledger.",
            )
        pairing = data.get("pairing")
        if pairing is not None and not isinstance(pairing, dict):
            raise HandoffError(503, "handoff receipts file has an invalid pairing record")
        self._pairing = pairing
        for operation in data["operations"]:
            if isinstance(operation, dict) and isinstance(operation.get("id"), str):
                self._operations[operation["id"]] = operation
                self._order.append(operation["id"])

    def _save_locked(self) -> None:
        payload = {
            "version": self.VERSION,
            "pairing": self._pairing,
            "operations": [self._operations[op_id] for op_id in self._order],
        }
        raw = json.dumps(payload, indent=2, ensure_ascii=True, allow_nan=False).encode("utf-8")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, name = tempfile.mkstemp(
            prefix="opencode-handoff-", suffix=".tmp", dir=self.path.parent)
        temporary = Path(name)
        try:
            with os.fdopen(descriptor, "wb") as output:
                output.write(raw)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, self.path)
        finally:
            temporary.unlink(missing_ok=True)

    def pairing(self) -> Optional[Dict[str, Any]]:
        with self._lock:
            return None if self._pairing is None else dict(self._pairing)

    def set_pairing(self, pairing: Optional[Dict[str, Any]]) -> None:
        with self._lock:
            self._pairing = pairing
            self._save_locked()

    def get(self, operation_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            operation = self._operations.get(operation_id)
            return None if operation is None else dict(operation)

    def find_by_request(self, request_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            for operation in self._operations.values():
                if operation["request_id"] == request_id:
                    return dict(operation)
            return None

    def put(self, operation: Dict[str, Any]) -> None:
        with self._lock:
            if operation["id"] not in self._operations:
                self._order.append(operation["id"])
            self._operations[operation["id"]] = dict(operation)
            self._prune_locked()
            self._save_locked()

    def all(self) -> list[Dict[str, Any]]:
        with self._lock:
            return [dict(self._operations[op_id]) for op_id in self._order]

    def _prune_locked(self) -> None:
        # Only terminal receipts are prunable; an uncertain or in-flight
        # operation is retained however old it is.
        while len(self._order) > MAX_RECEIPTS:
            removable = next(
                (op_id for op_id in self._order
                 if self._operations[op_id]["state"] in TERMINAL_STATES),
                None,
            )
            if removable is None:
                break
            self._order.remove(removable)
            self._operations.pop(removable, None)


class OpenCodeHandoff:
    """Dispatch reviewed prompts to one paired, existing OpenCode session."""

    def __init__(self, ledger_path: Path, *, transport: Optional[Transport] = None):
        self.token = secrets.token_urlsafe(32)
        self.instance_id = str(uuid.uuid4())
        self._ledger = ReceiptLedger(Path(ledger_path))
        self._transport: Transport = transport or _urllib_transport
        self._lock = threading.RLock()

    # -- status ---------------------------------------------------------

    def status(self) -> Dict[str, Any]:
        with self._lock:
            pairing = self._ledger.pairing()
            operations = self._ledger.all()
            return {
                "enabled": True,
                "instance_id": self.instance_id,
                "token": self.token,
                "paired": pairing is not None,
                "pairing": None if pairing is None else {
                    key: pairing[key]
                    for key in ("server_url", "session_id", "session_title",
                                "project_directory", "runtime_version", "paired_at")
                },
                "operations": [self._summary(op) for op in reversed(operations)],
                "max_prompt_chars": MAX_PROMPT_CHARS,
                "max_active_operations": MAX_ACTIVE_OPERATIONS,
                "max_receipts": MAX_RECEIPTS,
            }

    def detail(self, operation_id: str) -> Dict[str, Any]:
        with self._lock:
            operation = self._ledger.get(operation_id)
            if operation is None:
                raise HandoffError(404, "handoff operation not found")
            return {"operation": self._receipt(operation)}

    # -- pairing --------------------------------------------------------

    def pair(self, payload: Any) -> Dict[str, Any]:
        server_url, session_id, project = self._validate_pairing_payload(payload)
        health = self._request("GET", server_url, "/global/health")
        if health.status != 200 or not isinstance(health.data, dict) \
                or health.data.get("healthy") is not True \
                or not isinstance(health.data.get("version"), str):
            raise HandoffError(409, "the selected server did not report a healthy OpenCode runtime")
        version = health.data["version"]
        session = self._session(server_url, session_id)
        directory = session.get("directory")
        if not isinstance(directory, str) or not directory:
            raise HandoffError(409, "the selected session does not report a project directory")
        try:
            resolved = str(Path(directory).resolve(strict=True))
        except (OSError, RuntimeError):
            resolved = None
        if resolved is None or resolved != project:
            raise HandoffError(
                409,
                "the selected session belongs to a different project directory "
                "than the one reviewed; pair again with the session's directory",
            )
        pairing = {
            "server_url": server_url,
            "session_id": session_id,
            "session_title": session.get("title") if isinstance(session.get("title"), str) else None,
            "project_directory": project,
            "runtime_version": version,
            "paired_at": time.time(),
        }
        with self._lock:
            self._ledger.set_pairing(pairing)
            return {"pairing": self.status()["pairing"]}

    def unpair(self, payload: Any) -> Dict[str, Any]:
        if payload != {}:
            raise HandoffError(400, "unpair requires an empty JSON object")
        with self._lock:
            self._ledger.set_pairing(None)
            return {"pairing": None}

    # -- submission -----------------------------------------------------

    def submit(self, payload: Any) -> tuple[Dict[str, Any], bool]:
        request_id, prompt = self._validate_submit_payload(payload)
        with self._lock:
            previous = self._ledger.find_by_request(request_id)
            if previous is not None:
                if previous["prompt"] != prompt:
                    raise HandoffError(409, "request_id was already used for a different prompt")
                return {"operation": self._receipt(previous)}, False
            pairing = self._require_pairing()
            active = [op for op in self._ledger.all() if op["state"] in ACTIVE_STATES]
            if len(active) >= MAX_ACTIVE_OPERATIONS:
                raise HandoffError(409, "the handoff adapter is at its active operation limit")
            # Destination freshness: the paired server, version, session, and
            # project directory must still match what was reviewed at pairing.
            health = self._request("GET", pairing["server_url"], "/global/health")
            if health.status != 200 or not isinstance(health.data, dict) \
                    or health.data.get("healthy") is not True \
                    or health.data.get("version") != pairing["runtime_version"]:
                raise HandoffError(409, "the paired runtime changed or is unavailable; pair again")
            session = self._session(pairing["server_url"], pairing["session_id"])
            directory = session.get("directory")
            try:
                resolved = str(Path(directory).resolve(strict=True)) if isinstance(directory, str) else None
            except (OSError, RuntimeError):
                resolved = None
            if resolved != pairing["project_directory"]:
                raise HandoffError(409, "the paired session no longer matches its project directory; pair again")
            history = self._history(pairing)
            watermark = history[-1]["info"]["id"] if history else None

            operation = {
                "id": uuid.uuid4().hex,
                "request_id": request_id,
                "prompt": prompt,
                "server_url": pairing["server_url"],
                "session_id": pairing["session_id"],
                "project_directory": pairing["project_directory"],
                "runtime_version": pairing["runtime_version"],
                "state": "submitted",
                "created_at": time.time(),
                "updated_at": time.time(),
                "finished_at": None,
                "history_watermark": watermark,
                "delivered_message_id": None,
                "assistant_message_id": None,
                "cancel_requested": False,
                "error": None,
            }
            # Durable identity first: the receipt exists before dispatch, so
            # any later uncertainty can be reconciled instead of retried blind.
            self._ledger.put(operation)
            self._dispatch(operation, pairing)
            return {"operation": self._receipt(operation)}, True

    def _dispatch(self, operation: Dict[str, Any], pairing: Dict[str, Any]) -> None:
        body = {"parts": [{"type": "text", "text": operation["prompt"]}]}
        path = f"/session/{pairing['session_id']}/prompt_async"
        try:
            response = self._transport("POST", pairing["server_url"] + path, body, REQUEST_TIMEOUT)
        except TransportFailure as exc:
            operation["state"] = "unknown" if exc.may_have_been_accepted else "failed"
            operation["error"] = _redact(str(exc)) if not exc.may_have_been_accepted else (
                "the submission acknowledgement was lost; delivery is uncertain "
                "and must be reconciled before retrying")
            operation["updated_at"] = time.time()
            if operation["state"] == "failed":
                operation["finished_at"] = operation["updated_at"]
            self._ledger.put(operation)
            return
        if response.status in (200, 204):
            operation["state"] = "accepted"
        elif response.status in (400, 404, 409, 422):
            operation["state"] = "rejected"
            operation["error"] = _redact(
                response.data if response.data is not None
                else f"the runtime rejected the submission (HTTP {response.status})")
            operation["finished_at"] = time.time()
        else:
            operation["state"] = "unknown"
            operation["error"] = (
                f"the runtime answered HTTP {response.status}; delivery is "
                "uncertain and must be reconciled before retrying")
        operation["updated_at"] = time.time()
        self._ledger.put(operation)

    # -- reconciliation ---------------------------------------------------

    def refresh(self, operation_id: str) -> Dict[str, Any]:
        with self._lock:
            operation = self._ledger.get(operation_id)
            if operation is None:
                raise HandoffError(404, "handoff operation not found")
            if operation["state"] in TERMINAL_STATES:
                return {"operation": self._receipt(operation)}
            pairing = self._ledger.pairing()
            if pairing is None or pairing["session_id"] != operation["session_id"] \
                    or pairing["server_url"] != operation["server_url"]:
                raise HandoffError(409, "the operation's destination is no longer paired; pair again to reconcile it")
            self._reconcile(operation, pairing)
            return {"operation": self._receipt(operation)}

    def _reconcile(self, operation: Dict[str, Any], pairing: Dict[str, Any]) -> None:
        server = pairing["server_url"]
        session_id = pairing["session_id"]
        try:
            history = self._history(pairing)
            statuses = self._request("GET", server, "/session/status")
            permissions = self._request("GET", server, "/permission")
            questions = self._request("GET", server, "/question")
        except HandoffError:
            # Runtime unreachable: nothing new is known.  An operation whose
            # delivery was uncertain stays visibly uncertain.
            return
        delivered_id = operation["delivered_message_id"]
        assistant = None
        if delivered_id is None:
            delivered_id, assistant = self._find_delivery(operation, history)
            if delivered_id is not None:
                operation["delivered_message_id"] = delivered_id
        else:
            assistant = self._assistant_after(operation, history)
        if delivered_id is None:
            # A durably submitted receipt can survive a crash between
            # dispatch and acknowledgement.  An async runtime may not yet
            # expose the accepted prompt in session history, so its absence
            # is NOT proof of failed delivery.  Preserve the request identity
            # and reconcile later without silently resending.
            if operation["state"] == "submitted":
                operation["state"] = "unknown"
                operation["error"] = (
                    "the office restarted before the submission outcome "
                    "was recorded; delivery remains uncertain"
                )
            operation["updated_at"] = time.time()
            self._ledger.put(operation)
            return
        if assistant is not None:
            operation["assistant_message_id"] = assistant["info"].get("id")
            error = assistant["info"].get("error")
            completed = (assistant["info"].get("time") or {}).get("completed")
            if isinstance(error, dict):
                name = error.get("name")
                if name == "MessageAbortedError":
                    operation["state"] = "cancelled"
                else:
                    operation["state"] = "failed"
                    operation["error"] = _redact(
                        f"the runtime reported {name}" if isinstance(name, str)
                        else "the runtime reported an error")
                operation["finished_at"] = time.time()
                operation["updated_at"] = time.time()
                self._ledger.put(operation)
                return
            if completed is not None:
                operation["state"] = "completed"
                operation["finished_at"] = time.time()
                operation["updated_at"] = time.time()
                self._ledger.put(operation)
                return
        if self._awaiting_input(permissions.data, session_id) \
                or self._awaiting_input(questions.data, session_id):
            operation["state"] = "awaiting_input"
        elif self._session_busy(statuses.data, session_id):
            operation["state"] = "executing"
        elif operation["state"] == "unknown":
            # Delivered and now idle with no completed assistant message yet
            # recorded: delivery is confirmed, execution state is accepted.
            operation["state"] = "accepted"
        operation["updated_at"] = time.time()
        self._ledger.put(operation)

    def _find_delivery(self, operation: Dict[str, Any],
                       history: list[Dict[str, Any]]) -> tuple[Optional[str], Optional[Dict[str, Any]]]:
        start = 0
        if operation["history_watermark"] is not None:
            for index, entry in enumerate(history):
                if entry["info"].get("id") == operation["history_watermark"]:
                    start = index + 1
                    break
        for index in range(start, len(history)):
            entry = history[index]
            info = entry.get("info") or {}
            if info.get("role") != "user":
                continue
            texts = [part.get("text") for part in entry.get("parts") or []
                     if isinstance(part, dict) and part.get("type") == "text"]
            if operation["prompt"] in texts:
                assistant = history[index + 1] if index + 1 < len(history) else None
                if assistant is not None and (assistant.get("info") or {}).get("role") != "assistant":
                    assistant = None
                return info.get("id"), assistant
        return None, None

    def _assistant_after(self, operation: Dict[str, Any],
                         history: list[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        for index, entry in enumerate(history):
            if (entry.get("info") or {}).get("id") == operation["delivered_message_id"]:
                following = history[index + 1] if index + 1 < len(history) else None
                if following is not None and (following.get("info") or {}).get("role") == "assistant":
                    return following
                return None
        return None

    @staticmethod
    def _awaiting_input(data: Any, session_id: str) -> bool:
        if not isinstance(data, list):
            return False
        return any(isinstance(item, dict) and item.get("sessionID") == session_id
                   for item in data)

    @staticmethod
    def _session_busy(data: Any, session_id: str) -> bool:
        if not isinstance(data, dict):
            return False
        status = data.get(session_id)
        return isinstance(status, dict) and status.get("type") in ("busy", "retry")

    # -- cancellation -----------------------------------------------------

    def cancel(self, operation_id: str) -> Dict[str, Any]:
        with self._lock:
            operation = self._ledger.get(operation_id)
            if operation is None:
                raise HandoffError(404, "handoff operation not found")
            if operation["state"] in TERMINAL_STATES:
                return {"operation": self._receipt(operation)}
            pairing = self._ledger.pairing()
            if pairing is None or pairing["session_id"] != operation["session_id"] \
                    or pairing["server_url"] != operation["server_url"]:
                raise HandoffError(409, "the operation's destination is no longer paired")
            response = self._request(
                "POST", pairing["server_url"],
                f"/session/{pairing['session_id']}/abort", {})
            if response.status != 200:
                raise HandoffError(409, f"the runtime did not acknowledge cancellation (HTTP {response.status})")
            operation["cancel_requested"] = True
            operation["updated_at"] = time.time()
            self._ledger.put(operation)
            # Cancellation is terminal only when the runtime confirms the
            # session stopped; reconcile once so the receipt can say so.
            self._reconcile(operation, pairing)
            return {"operation": self._receipt(operation)}

    # -- runtime helpers ----------------------------------------------------

    def _require_pairing(self) -> Dict[str, Any]:
        pairing = self._ledger.pairing()
        if pairing is None:
            raise HandoffError(409, "no OpenCode session is paired; pair a session before submitting")
        return pairing

    def _session(self, server_url: str, session_id: str) -> Dict[str, Any]:
        response = self._request("GET", server_url, f"/session/{session_id}")
        if response.status == 404:
            raise HandoffError(404, "the selected session was not found on the paired server")
        if response.status != 200 or not isinstance(response.data, dict):
            raise HandoffError(409, "the paired server did not return the selected session")
        return response.data

    def _history(self, pairing: Dict[str, Any]) -> list[Dict[str, Any]]:
        response = self._request(
            "GET", pairing["server_url"], f"/session/{pairing['session_id']}/message")
        if response.status != 200 or not isinstance(response.data, list):
            raise HandoffError(409, "the paired server did not return session history")
        return [entry for entry in response.data
                if isinstance(entry, dict) and isinstance(entry.get("info"), dict)]

    def _request(self, method: str, server_url: str, path: str,
                 body: Optional[Dict[str, Any]] = None) -> TransportResponse:
        try:
            return self._transport(method, server_url + path, body, REQUEST_TIMEOUT)
        except TransportFailure as exc:
            raise HandoffError(503, _redact(f"the paired OpenCode server could not be reached: {exc}")) from exc

    # -- validation ---------------------------------------------------------

    @staticmethod
    def _validate_pairing_payload(payload: Any) -> tuple[str, str, str]:
        expected = {"server_url", "session_id", "project_directory"}
        if not isinstance(payload, dict) or set(payload) != expected:
            raise HandoffError(400, "expected exactly server_url, session_id, and project_directory")
        if not all(isinstance(payload[key], str) for key in expected):
            raise HandoffError(400, "pairing fields must be strings")
        invalid_origin = (
            "server_url must be a loopback OpenCode server origin "
            "like http://127.0.0.1:4096"
        )
        try:
            parsed = urlsplit(payload["server_url"])
            hostname = parsed.hostname
            port = parsed.port
            username, password = parsed.username, parsed.password
        except ValueError as exc:
            # Malformed IPv6 brackets or non-numeric/out-of-range ports
            # are caller errors, not unhandled server exceptions.
            raise HandoffError(400, invalid_origin) from exc
        if parsed.scheme != "http" or hostname not in ("127.0.0.1", "localhost", "::1") \
                or username is not None or password is not None \
                or parsed.path not in ("", "/") or parsed.query or parsed.fragment \
                or port is None:
            raise HandoffError(400, invalid_origin)
        host = hostname if hostname != "::1" else "[::1]"
        server_url = f"http://{host}:{port}"
        session_id = payload["session_id"]
        if not session_id or len(session_id) > 256 or any(char.isspace() for char in session_id) \
                or "/" in session_id or "?" in session_id or "#" in session_id:
            raise HandoffError(400, "session_id is not a valid OpenCode session identifier")
        raw_project = payload["project_directory"]
        if not Path(raw_project).is_absolute():
            raise HandoffError(400, "project_directory must be an absolute path")
        try:
            project = str(Path(raw_project).resolve(strict=True))
        except (OSError, RuntimeError):
            raise HandoffError(400, "project_directory is unavailable")
        if not Path(project).is_dir():
            raise HandoffError(400, "project_directory is not a directory")
        return server_url, session_id, project

    @staticmethod
    def _validate_submit_payload(payload: Any) -> tuple[str, str]:
        expected = {"request_id", "prompt"}
        if not isinstance(payload, dict) or set(payload) != expected:
            raise HandoffError(400, "expected exactly request_id and prompt")
        if not all(isinstance(payload[key], str) for key in expected):
            raise HandoffError(400, "handoff fields must be strings")
        try:
            parsed = uuid.UUID(payload["request_id"])
        except (ValueError, AttributeError):
            raise HandoffError(400, "request_id must be a UUID")
        if str(parsed) != payload["request_id"].lower():
            raise HandoffError(400, "request_id must be a canonical UUID")
        prompt = payload["prompt"]
        if not prompt.strip() or len(prompt) > MAX_PROMPT_CHARS:
            raise HandoffError(400, f"prompt must contain 1–{MAX_PROMPT_CHARS} characters")
        if any(0xD800 <= ord(char) <= 0xDFFF for char in prompt):
            raise HandoffError(400, "prompt contains invalid Unicode")
        return str(parsed), prompt

    # -- presentation -------------------------------------------------------

    @staticmethod
    def _summary(operation: Dict[str, Any]) -> Dict[str, Any]:
        keys = (
            "id", "request_id", "session_id", "project_directory", "runtime_version",
            "state", "created_at", "updated_at", "finished_at", "cancel_requested", "error",
        )
        return {key: operation[key] for key in keys}

    @classmethod
    def _receipt(cls, operation: Dict[str, Any]) -> Dict[str, Any]:
        receipt = cls._summary(operation)
        receipt["prompt"] = operation["prompt"]
        receipt["delivered_message_id"] = operation["delivered_message_id"]
        receipt["assistant_message_id"] = operation["assistant_message_id"]
        return receipt
