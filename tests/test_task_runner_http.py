"""HTTP boundary tests for the optional local task runner."""
from __future__ import annotations

import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

import pytest


def _unused_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


class Server:
    def __init__(self, tmp_path, *, enabled):
        root = Path(__file__).resolve().parents[1]
        self.port = _unused_port()
        self.url = f"http://127.0.0.1:{self.port}"
        self.workspace = tmp_path / "workspace"
        self.workspace.mkdir()
        binary_dir = tmp_path / "bin"
        binary_dir.mkdir()
        source = f"""#!{sys.executable}
import json, os, sys, time
prompt = sys.stdin.read()
if prompt == 'sleep':
    open('child.pid', 'w').write(str(os.getpid()))
    print(os.getpid(), flush=True)
    time.sleep(30)
else:
    print(json.dumps({{'argv': sys.argv[1:], 'stdin': prompt}}))
"""
        for name in ("codex", "claude"):
            binary = binary_dir / name
            binary.write_text(source)
            binary.chmod(0o755)
        command = [sys.executable, str(root / "run.py"), "--port", str(self.port)]
        if enabled:
            command += ["--enable-task-runner", "--workspace", str(self.workspace)]
        environment = {**os.environ, "PATH": str(binary_dir), "HERMES_HOME": str(tmp_path / "home")}
        self.process = subprocess.Popen(
            command, env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True
        )
        deadline = time.monotonic() + 7
        while time.monotonic() < deadline:
            try:
                status, _, _ = self.request("GET", "/task-runs")
                if status == 200:
                    break
            except OSError:
                if self.process.poll() is not None:
                    raise AssertionError(f"server exited: {self.process.stderr.read()}")
                time.sleep(0.02)
        else:
            raise AssertionError("server did not become ready")

    def request(self, method, route, payload=None, *, raw=None, headers=None):
        request_headers = dict(headers or {})
        body = raw
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
        if body is not None and "Content-Type" not in request_headers:
            request_headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            self.url + route, data=body, headers=request_headers, method=method
        )
        try:
            response = urllib.request.urlopen(request, timeout=7)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read()), response.headers

    def close(self):
        if self.process.poll() is None:
            self.process.terminate()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=3)


@pytest.fixture
def enabled_server(tmp_path):
    server = Server(tmp_path, enabled=True)
    yield server
    server.close()


def _task(**updates):
    task = {
        "request_id": str(uuid.uuid4()),
        "runtime": "codex",
        "workspace_id": "w1",
        "prompt": "hello",
        "mode": "read",
    }
    task.update(updates)
    return task


def _wait_finished(server, run_id):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        status, body, _ = server.request("GET", f"/task-runs/{run_id}")
        assert status == 200
        if body["run"]["status"] != "running":
            return body["run"]
        time.sleep(0.02)
    raise AssertionError("task did not finish")


def test_disabled_endpoint_exposes_no_token_workspace_path_or_runs(tmp_path):
    server = Server(tmp_path, enabled=False)
    try:
        status, body, headers = server.request("GET", "/task-runs")
        assert status == 200
        assert body == {
            "enabled": False,
            "token": None,
            "workspaces": [],
            "runtimes": [],
            "runs": [],
            "max_prompt_chars": 8192,
            "max_running": 2,
        }
        assert "Access-Control-Allow-Origin" not in headers
        status, body, _ = server.request("POST", "/task-runs", _task(), headers={
            "X-Agent-Office-Token": "not-a-token"
        })
        assert status == 403 and body["error"]
    finally:
        server.close()


def test_cli_enablement_requires_an_explicit_absolute_workspace(tmp_path):
    root = Path(__file__).resolve().parents[1]
    cases = [
        (["--enable-task-runner"], "requires at least one --workspace"),
        (["--workspace", str(tmp_path)], "requires --enable-task-runner"),
        (["--enable-task-runner", "--workspace", "relative"], "workspace must be an absolute path"),
    ]
    for arguments, message in cases:
        result = subprocess.run(
            [sys.executable, str(root / "run.py"), *arguments],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5,
        )
        assert result.returncode == 2
        assert message in result.stderr


def test_enabled_runner_fails_clearly_when_port_is_already_bound(tmp_path):
    root = Path(__file__).resolve().parents[1]
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        port = listener.getsockname()[1]
        result = subprocess.run(
            [
                sys.executable, str(root / "run.py"), "--port", str(port),
                "--enable-task-runner", "--workspace", str(workspace),
            ],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5,
        )
    assert result.returncode == 1
    assert "Agent Office —" not in result.stdout
    assert f"could not bind http://127.0.0.1:{port}" in result.stderr
    assert "Stop the existing Agent Office" in result.stderr
    assert "choose an unused --port" in result.stderr


def test_observer_only_server_keeps_existing_shared_port_behavior(monkeypatch):
    import __init__ as office

    previous_port = office._port
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        port = listener.getsockname()[1]
        monkeypatch.setattr(office, "_resolve_port", lambda: port)
        monkeypatch.setattr(office, "_probe_port", lambda _port: "office")
        try:
            assert office._serve() is None
        finally:
            office._port = previous_port


def test_capabilities_create_idempotency_detail_and_cancel(enabled_server):
    server = enabled_server
    status, capabilities, headers = server.request("GET", "/task-runs")
    assert status == 200 and capabilities["enabled"] is True
    assert capabilities["workspaces"] == [{
        "id": "w1", "name": "workspace", "path": str(server.workspace.resolve())
    }]
    assert [(runtime["id"], runtime["name"]) for runtime in capabilities["runtimes"]] == [
        ("codex", "Codex"), ("claude", "Claude Code")
    ]
    assert all(runtime["available"] for runtime in capabilities["runtimes"])
    assert "Access-Control-Allow-Origin" not in headers
    token_headers = {"X-Agent-Office-Token": capabilities["token"]}

    payload = _task(prompt="exact $(shell) text")
    status, created, _ = server.request("POST", "/task-runs", payload, headers=token_headers)
    assert status == 201
    run_id = created["run"]["id"]
    status, repeated, _ = server.request("POST", "/task-runs", payload, headers=token_headers)
    assert status == 201 and repeated["run"]["id"] == run_id
    finished = _wait_finished(server, run_id)
    assert finished["status"] == "succeeded"
    record = json.loads(finished["output"])
    assert record["stdin"] == payload["prompt"]

    status, conflict, _ = server.request(
        "POST", "/task-runs", {**payload, "prompt": "changed"}, headers=token_headers
    )
    assert status == 409 and conflict["error"]

    sleeping = _task(prompt="sleep")
    status, created, _ = server.request("POST", "/task-runs", sleeping, headers=token_headers)
    assert status == 201
    status, cancelled, _ = server.request(
        "POST", f"/task-runs/{created['run']['id']}/cancel", {}, headers=token_headers
    )
    assert status == 200 and cancelled["run"]["status"] in {"running", "cancelled"}
    if cancelled["run"]["status"] == "running":
        assert cancelled["run"]["finished_at"] is None
    assert _wait_finished(server, created["run"]["id"])["status"] == "cancelled"


@pytest.mark.parametrize("headers", [
    {"Host": "localhost:1"},
    {"Origin": "null"},
    {"Origin": "https://attacker.example"},
    {"Sec-Fetch-Site": "cross-site"},
])
def test_read_endpoints_reject_wrong_host_cross_origin_and_cross_site(enabled_server, headers):
    status, body, _ = enabled_server.request("GET", "/task-runs", headers=headers)
    assert status == 403 and body["error"]


def test_mutations_require_same_origin_token_json_and_strict_shape(enabled_server):
    server = enabled_server
    _, capabilities, _ = server.request("GET", "/task-runs")
    token = capabilities["token"]
    same_origin = f"http://127.0.0.1:{server.port}"
    payload = _task()

    for headers in ({}, {"X-Agent-Office-Token": "wrong"}, {
        "X-Agent-Office-Token": token, "Origin": "null"
    }, {"X-Agent-Office-Token": "é"}, {
        "X-Agent-Office-Token": token, "Origin": "https://attacker.example"
    }):
        status, body, _ = server.request("POST", "/task-runs", payload, headers=headers)
        assert status == 403 and body["error"]

    allowed = {"X-Agent-Office-Token": token, "Origin": same_origin}
    status, body, _ = server.request(
        "POST", "/task-runs", raw=b"{}", headers={**allowed, "Content-Type": "text/plain"}
    )
    assert status == 415 and body["error"]
    for raw in (
        b"\xff", b"null", b"[]", b'{"prompt":',
        b"[" * 10000 + b"0" + b"]" * 10000,
    ):
        status, body, _ = server.request("POST", "/task-runs", raw=raw, headers=allowed)
        assert status == 400 and body["error"]
    status, body, _ = server.request(
        "POST", "/task-runs", raw=b"{" + b" " * 65536 + b"}", headers=allowed
    )
    assert status == 413 and body["error"]
    status, body, _ = server.request(
        "POST", "/task-runs", {**payload, "executable": "/tmp/evil"}, headers=allowed
    )
    assert status == 400 and body["error"]

    duplicate = (
        '{"request_id":' + json.dumps(payload["request_id"]) +
        ',"runtime":"codex","workspace_id":"w1","prompt":"first",'
        '"prompt":"second","mode":"read"}'
    ).encode()
    status, body, _ = server.request("POST", "/task-runs", raw=duplicate, headers=allowed)
    assert status == 400 and body["error"]


def test_incomplete_body_timeout_returns_json_without_starting_a_task(enabled_server):
    server = enabled_server
    _, capabilities, _ = server.request("GET", "/task-runs")
    with socket.create_connection(("127.0.0.1", server.port), timeout=3) as client:
        client.settimeout(7)
        request = (
            f"POST /task-runs HTTP/1.1\r\nHost: 127.0.0.1:{server.port}\r\n"
            f"X-Agent-Office-Token: {capabilities['token']}\r\n"
            "Content-Type: application/json\r\nContent-Length: 100\r\nConnection: close\r\n\r\n{"
        ).encode()
        client.sendall(request)
        response = b""
        while True:
            chunk = client.recv(4096)
            if not chunk:
                break
            response += chunk
    assert b" 408 " in response.split(b"\r\n", 1)[0]
    assert json.loads(response.split(b"\r\n\r\n", 1)[1])["error"]
    _, refreshed, _ = server.request("GET", "/task-runs")
    assert refreshed["runs"] == []


def test_sigterm_server_shutdown_interrupts_active_child(enabled_server):
    server = enabled_server
    _, capabilities, _ = server.request("GET", "/task-runs")
    headers = {"X-Agent-Office-Token": capabilities["token"]}
    status, created, _ = server.request("POST", "/task-runs", _task(prompt="sleep"), headers=headers)
    assert status == 201
    run_id = created["run"]["id"]
    deadline = time.monotonic() + 3
    pid = None
    while time.monotonic() < deadline:
        path = server.workspace / "child.pid"
        if path.exists():
            pid = int(path.read_text())
            break
        time.sleep(0.02)
    assert pid is not None
    server.process.terminate()
    assert server.process.wait(timeout=5) == 0
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            break
        time.sleep(0.02)
    else:
        raise AssertionError("task child survived server shutdown")

