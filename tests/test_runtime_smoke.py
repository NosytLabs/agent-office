"""Standalone boot and actual hook stdin → disk → HTTP observer flow.

Uses documented synthetic payloads, never invokes a provider or edits runtime settings.
"""
import json
import os
from pathlib import Path
import signal
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _cli_environment(tmp_path):
    supplied_home = tmp_path / "supplied-home"
    supplied_home.mkdir()
    (supplied_home / "keep.txt").write_text("unrelated caller data\n")
    temporary = tmp_path / "temporary"
    temporary.mkdir()
    env = {
        **os.environ,
        "HERMES_HOME": str(supplied_home),
        "TMPDIR": str(temporary),
        "TMP": str(temporary),
        "TEMP": str(temporary),
    }
    for key in ("AGENT_OFFICE_DEMO", "AGENT_OFFICE_PORT", "AGENT_OFFICE_OBSERVER_ORIGINS"):
        env.pop(key, None)
    return env, supplied_home, temporary


def _stop_owned_process(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)


@pytest.mark.parametrize("script", ["run.py", "demo_feed.py"])
@pytest.mark.parametrize("occupied_by_office", [False, True], ids=["foreign", "office"])
def test_cli_rejects_occupied_port_without_claiming_readiness(tmp_path, script, occupied_by_office):
    body = b'{"agents": [], "mode": "live"}' if occupied_by_office else b"existing unrelated listener"

    class ExistingListener(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    listener = ThreadingHTTPServer(("127.0.0.1", 0), ExistingListener)
    worker = threading.Thread(target=listener.serve_forever, daemon=True)
    worker.start()
    env, supplied_home, temporary = _cli_environment(tmp_path)
    try:
        result = subprocess.run(
            [sys.executable, str(ROOT / script), "--port", str(listener.server_port)],
            cwd=tmp_path, env=env, capture_output=True, text=True, timeout=5,
        )
        assert result.returncode == 1, result.stdout + result.stderr
        assert "could not bind" in result.stderr
        assert "choose an unused --port" in result.stderr
        assert "Traceback" not in result.stderr
        assert not result.stdout, "A launcher that did not bind must not announce readiness"
        with urllib.request.urlopen(f"http://127.0.0.1:{listener.server_port}/state", timeout=2) as response:
            assert response.read() == body
        assert sorted(path.name for path in supplied_home.iterdir()) == ["keep.txt"]
        assert not list(temporary.iterdir())
    finally:
        listener.shutdown()
        listener.server_close()
        worker.join(timeout=2)


@pytest.mark.skipif(os.name == "nt", reason="POSIX SIGINT/SIGTERM exercise graceful signal handlers")
@pytest.mark.parametrize("script,mode", [("run.py", "live"), ("demo_feed.py", "demo")])
@pytest.mark.parametrize("stop_signal", [signal.SIGINT, signal.SIGTERM], ids=["ctrl-c", "sigterm"])
def test_cli_signal_stops_listener_and_cleans_temporary_demo(tmp_path, script, mode, stop_signal):
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    env, supplied_home, temporary = _cli_environment(tmp_path)
    process = subprocess.Popen(
        [sys.executable, str(ROOT / script), "--port", str(port)],
        cwd=tmp_path, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    try:
        deadline = time.monotonic() + 6
        while time.monotonic() < deadline:
            assert process.poll() is None, "launcher exited before serving its office"
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/state", timeout=0.5) as response:
                    state = json.load(response)
                if state["mode"] == mode and (mode != "demo" or len(state["agents"]) == 6):
                    break
            except OSError:
                pass
            time.sleep(0.05)
        else:
            raise AssertionError("launcher did not serve its expected office state")
        if mode == "demo":
            assert len(list(temporary.glob("agent-office-demo-*"))) == 1
        process.send_signal(stop_signal)
        stdout, stderr = process.communicate(timeout=5)
        assert process.returncode == 0, stdout + stderr
        assert "Traceback" not in stderr
        with pytest.raises(OSError):
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                pass
        assert not list(temporary.iterdir()), "Demo temporary data must be removed after graceful stop"
        assert (supplied_home / "keep.txt").read_text() == "unrelated caller data\n"
        if mode == "demo":
            assert sorted(path.name for path in supplied_home.iterdir()) == ["keep.txt"]
    finally:
        _stop_owned_process(process)


def test_demo_producer_start_failure_reports_error_and_cleans_temporary_home(tmp_path):
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    env, supplied_home, temporary = _cli_environment(tmp_path)
    wrapper = """
import runpy, socket, sys, threading
root, port = sys.argv[1], int(sys.argv[2])
original = threading.Thread.start
def start(thread, *args, **kwargs):
    if thread.name == 'agent-office-demo-feed':
        # Keep the real bind path: readiness must run after the socket listens.
        with socket.create_connection(('127.0.0.1', port), timeout=1):
            pass
        raise RuntimeError('cannot start another thread')
    return original(thread, *args, **kwargs)
threading.Thread.start = start
sys.path.insert(0, root)
sys.argv = [root + '/demo_feed.py', '--port', str(port)]
runpy.run_path(sys.argv[0], run_name='__main__')
"""
    result = subprocess.run(
        [sys.executable, "-c", wrapper, str(ROOT), str(port)],
        cwd=tmp_path, env=env, capture_output=True, text=True, timeout=5,
    )
    assert result.returncode == 1, result.stdout + result.stderr
    assert "could not finish startup" in result.stderr
    assert "cannot start another thread" in result.stderr
    assert "Traceback" not in result.stderr
    assert not result.stdout
    with pytest.raises(OSError):
        with socket.create_connection(("127.0.0.1", port), timeout=0.2):
            pass
    assert not list(temporary.iterdir())
    assert sorted(path.name for path in supplied_home.iterdir()) == ["keep.txt"]


def test_standalone_tracks_hook_lifecycle_and_serves_new_props(tmp_path):
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    env = {**os.environ, "HERMES_HOME": str(tmp_path)}
    env.pop("AGENT_OFFICE_DEMO", None)
    server = subprocess.Popen([sys.executable, str(ROOT / "run.py"), "--port", str(port)],
                              env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f"http://127.0.0.1:{port}"

    def state():
        with urllib.request.urlopen(url + "/state", timeout=2) as response:
            return json.load(response)

    def hook(name, **fields):
        subprocess.run([sys.executable, str(ROOT / "claude/hook.py")],
                       input=json.dumps({"hook_event_name": name, "session_id": "smoke", **fields}),
                       text=True, env=env, check=True, timeout=5, capture_output=True)

    try:
        for _ in range(50):
            try:
                initial = state()
                assert initial["agents"] == []
                assert initial["mode"] == "live"
                break
            except OSError:
                assert server.poll() is None, "standalone server exited"
                time.sleep(0.05)
        else:
            raise AssertionError("standalone server did not start")
        hook("SessionStart")
        # Observe the database without asking HTTP /state to trigger ingestion.
        # The standalone server must drain an inbox even with no open browser.
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            with sqlite3.connect(tmp_path / "pixel-office" / "office.sqlite3") as db:
                received = db.execute("SELECT COUNT(*) FROM history").fetchone()[0]
            if received == 1:
                break
            time.sleep(0.05)
        else:
            raise AssertionError("server did not drain background inbox")
        hook("PreToolUse", tool_name="Write", tool_use_id="write", tool_input={"file_path": "app.py"})
        assert state()["agents"][0]["activity"] == "typing"
        hook("PermissionRequest", tool_name="Write", tool_use_id="write", tool_input={"file_path": "app.py"})
        assert state()["agents"][0]["status"] == "waiting"
        hook("PermissionDenied", tool_name="Write", tool_use_id="write")
        assert state()["agents"][0]["status"] == "thinking"
        hook("PreToolUse", agent_id="child", tool_name="Read", tool_use_id="read", tool_input={"file_path": "app.py"})
        child = next(a for a in state()["agents"] if a["id"] == "child")
        assert (child["parent"], child["activity"]) == ("smoke", "reading")
        hook("PostToolUse", agent_id="child", tool_name="Read", tool_use_id="read")
        hook("Stop")
        agents = {a["id"]: a for a in state()["agents"]}
        assert (agents["smoke"]["status"], agents["smoke"]["tool"]) == ("idle", "")
        assert (agents["child"]["status"], agents["child"]["tool"]) == ("thinking", "")
        props = [{"kind": kind, "x": 0.5, "y": 0.8} for kind in ("roundtable", "stool", "succulent", "planter")]
        with urllib.request.urlopen(url + "/settings", timeout=2) as current:
            revision = current.headers["ETag"]
        request = urllib.request.Request(url + "/settings", data=json.dumps({"furniture": props}).encode(),
                                         headers={"Content-Type": "application/json", "If-Match": revision}, method="POST")
        with urllib.request.urlopen(request, timeout=2) as response:
            assert response.status == 200
        assert state()["settings"]["furniture"] == props
        with urllib.request.urlopen(url + "/assets/sprites/furniture/decor-atlas.png", timeout=2) as response:
            assert response.headers.get_content_type() == "image/png"
            assert response.read() == (ROOT / "web/assets/sprites/furniture/decor-atlas.png").read_bytes()
    finally:
        server.terminate()
        try:
            server.wait(timeout=3)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=3)
