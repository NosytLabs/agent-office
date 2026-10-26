"""HTTP boundary tests for the opt-in OpenCode session handoff adapter.

A synthetic OpenCode server runs in-process; no installed runtime or
provider account is exercised.  See docs/opencode-session-handoff.md.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest


def _unused_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


class FakeOpenCodeServer:
    def __init__(self, directory: str):
        self.directory = directory
        self.messages: list[dict] = []
        self.prompts: list[str] = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _send(self, status, data):
                body = b"" if data is None else json.dumps(data).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                if self.path == "/global/health":
                    self._send(200, {"healthy": True, "version": "2.0.29"})
                elif self.path == "/session/ses_http":
                    self._send(200, {"id": "ses_http", "title": "HTTP fixture",
                                     "directory": outer.directory})
                elif self.path == "/session/ses_http/message":
                    self._send(200, outer.messages)
                elif self.path == "/session/status":
                    busy = {"ses_http": {"type": "busy"}} if outer.prompts and not outer.completed else {}
                    self._send(200, busy)
                elif self.path in ("/permission", "/question"):
                    self._send(200, [])
                else:
                    self._send(404, None)

            def do_POST(self):
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length) if length else b""
                if self.path == "/session/ses_http/prompt_async":
                    body = json.loads(raw)
                    text = body["parts"][0]["text"]
                    outer.prompts.append(text)
                    outer.messages.append({
                        "info": {"id": "msg_user_http", "role": "user",
                                 "sessionID": "ses_http", "time": {"created": 1}},
                        "parts": [{"type": "text", "text": text}],
                    })
                    self._send(204, None)
                elif self.path == "/session/ses_http/abort":
                    outer.completed = True
                    outer.messages.append({
                        "info": {"id": "msg_asst_http", "role": "assistant",
                                 "sessionID": "ses_http",
                                 "time": {"created": 2, "completed": 3},
                                 "error": {"name": "MessageAbortedError", "data": {}}},
                        "parts": [],
                    })
                    self._send(200, True)
                else:
                    self._send(404, None)

        self.completed = False
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    @property
    def url(self):
        return f"http://127.0.0.1:{self.port}"

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class OfficeServer:
    def __init__(self, tmp_path, *, handoff_enabled):
        root = Path(__file__).resolve().parents[1]
        self.port = _unused_port()
        self.url = f"http://127.0.0.1:{self.port}"
        self.project = tmp_path / "project"
        self.project.mkdir()
        self.fake = FakeOpenCodeServer(str(self.project.resolve()))
        command = [sys.executable, str(root / "run.py"), "--port", str(self.port)]
        if handoff_enabled:
            command += ["--enable-opencode-handoff"]
        environment = {**os.environ, "HERMES_HOME": str(tmp_path / "home")}
        self.process = subprocess.Popen(
            command, env=environment, stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE, text=True)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            try:
                status, _, _ = self.request("GET", "/opencode-handoff")
                if status == 200:
                    break
            except OSError:
                if self.process.poll() is not None:
                    raise AssertionError(f"server exited: {self.process.stderr.read()}")
                time.sleep(0.02)
        else:
            raise AssertionError("server did not become ready")

    def request(self, method, route, payload=None, *, headers=None):
        request_headers = dict(headers or {})
        body = None
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            request_headers.setdefault("Content-Type", "application/json")
        request = urllib.request.Request(
            self.url + route, data=body, headers=request_headers, method=method)
        try:
            response = urllib.request.urlopen(request, timeout=7)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read()
            return response.status, (json.loads(raw) if raw else {}), response.headers

    def close(self):
        if self.process.poll() is None:
            self.process.terminate()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
        self.fake.close()


@pytest.fixture()
def office(tmp_path):
    server = OfficeServer(tmp_path, handoff_enabled=True)
    yield server
    server.close()


def _token(office):
    _, status, _ = office.request("GET", "/opencode-handoff")
    return status["token"]


def _pair(office):
    return office.request("POST", "/opencode-handoff/pair", {
        "server_url": office.fake.url,
        "session_id": "ses_http",
        "project_directory": str(office.project),
    }, headers={"X-Agent-Office-Token": _token(office)})


def test_handoff_is_disabled_without_the_flag(tmp_path):
    server = OfficeServer(tmp_path, handoff_enabled=False)
    try:
        status, body, _ = server.request("GET", "/opencode-handoff")
        assert status == 200 and body["enabled"] is False and body["token"] is None
        status, body, _ = server.request("POST", "/opencode-handoff/pair", {
            "server_url": server.fake.url, "session_id": "ses_http",
            "project_directory": str(server.project),
        }, headers={"X-Agent-Office-Token": "anything"})
        # No token exists while disabled, so mutations fail the boundary
        # check before routing, exactly like the disabled task runner.
        assert status == 403
    finally:
        server.close()


def test_pair_submit_and_cancel_over_http(office):
    status, body, _ = _pair(office)
    assert status == 200
    assert body["pairing"]["runtime_version"] == "2.0.29"
    token = _token(office)

    request_id = str(uuid.uuid4())
    status, body, _ = office.request("POST", "/opencode-handoff/submit", {
        "request_id": request_id, "prompt": "hello from the test",
    }, headers={"X-Agent-Office-Token": token})
    assert status == 201
    operation = body["operation"]
    assert operation["state"] == "accepted"
    assert office.fake.prompts == ["hello from the test"]

    status, body, _ = office.request(
        "POST", f"/opencode-handoff/{operation['id']}/refresh", {},
        headers={"X-Agent-Office-Token": token})
    assert status == 200
    assert body["operation"]["state"] == "executing"

    status, body, _ = office.request(
        "POST", f"/opencode-handoff/{operation['id']}/cancel", {},
        headers={"X-Agent-Office-Token": token})
    assert status == 200
    assert body["operation"]["state"] == "cancelled"

    status, body, _ = office.request("GET", f"/opencode-handoff/{operation['id']}")
    assert status == 200
    assert body["operation"]["state"] == "cancelled"


def test_mutations_require_the_handoff_token(office):
    status, _, _ = office.request("POST", "/opencode-handoff/pair", {
        "server_url": office.fake.url, "session_id": "ses_http",
        "project_directory": str(office.project),
    })
    assert status == 403
    status, _, _ = office.request("POST", "/opencode-handoff/pair", {
        "server_url": office.fake.url, "session_id": "ses_http",
        "project_directory": str(office.project),
    }, headers={"X-Agent-Office-Token": "wrong-token"})
    assert status == 403


def test_cross_origin_mutation_is_rejected(office):
    status, _, _ = office.request("POST", "/opencode-handoff/pair", {
        "server_url": office.fake.url, "session_id": "ses_http",
        "project_directory": str(office.project),
    }, headers={
        "X-Agent-Office-Token": _token(office),
        "Origin": "http://example.com",
    })
    assert status == 403
