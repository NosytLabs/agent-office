"""Standalone boot and actual hook stdin → disk → HTTP observer flow.

Uses documented synthetic payloads, never invokes a provider or edits runtime settings.
"""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


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
        request = urllib.request.Request(url + "/settings", data=json.dumps({"furniture": props}).encode(),
                                         headers={"Content-Type": "application/json"}, method="POST")
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
