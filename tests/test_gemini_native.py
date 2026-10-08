"""Opt-in official CLI verification with a synthetic, loopback-only provider.

GEMINI_TEST_CLI must name an already installed official Gemini CLI 0.63.0.
No package installation, account credentials, or persisted workspace trust.
"""
import http.server
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time

import pytest

import install
from event_store import EventStore

CLI = os.environ.get("GEMINI_TEST_CLI")


def _check_native_host(system_directory=None):
    """Respect real system policy before setting up an isolated synthetic host."""
    for key in ("GEMINI_CLI_SYSTEM_SETTINGS_PATH", "GEMINI_CLI_SYSTEM_DEFAULTS_PATH"):
        if key in os.environ:
            pytest.skip("native Gemini fixture respects configured system settings overrides")
    if system_directory is None:
        system_directory = Path({
            "darwin": "/Library/Application Support/GeminiCli",
            "win32": r"C:\ProgramData\gemini-cli",
        }.get(sys.platform, "/etc/gemini-cli"))
    # Policy directories are independent of the settings path overrides.
    # lstat also treats dangling links as existing configuration to preserve.
    for name in ("settings.json", "system-defaults.json", "policies"):
        try:
            (system_directory / name).lstat()
        except FileNotFoundError:
            continue
        except OSError:
            pytest.skip("native Gemini fixture cannot verify system configuration is absent")
        pytest.skip("native Gemini fixture respects existing system settings/defaults/policies")


@pytest.mark.skipif(not CLI, reason="set GEMINI_TEST_CLI to an isolated official 0.63.0 installation")
@pytest.mark.parametrize("provider_error", [False, True], ids=["completed", "provider-error"])
def test_installed_gemini_delivers_installed_observer_hooks_without_remote_provider(tmp_path, monkeypatch, provider_error):
    _check_native_host()
    cli = str(Path(CLI).resolve())
    # Exercise Node options and installed hook command quoting on every run.
    tmp_path = tmp_path / "fixture with spaces"
    tmp_path.mkdir()
    # Every path belongs to this fresh fixture; --skip-trust acknowledges only
    # this empty directory for this invocation, never existing user projects.
    project = tmp_path / "project"
    project.mkdir()
    home = tmp_path / "home"
    settings = home / ".gemini/settings.json"
    settings.parent.mkdir(parents=True)
    data_home = tmp_path / "office-data"
    system_settings = tmp_path / "system-settings.json"
    system_defaults = tmp_path / "system-defaults.json"
    system_settings.write_text("{}")
    system_defaults.write_text("{}")
    settings.write_text(json.dumps({
        "general": {"enableAutoUpdate": False, "enableAutoUpdateNotification": False},
        "privacy": {"usageStatisticsEnabled": False}, "telemetry": {"enabled": False},
        "security": {"auth": {"selectedType": "gemini-api-key"}},
    }))
    monkeypatch.setenv("GEMINI_CLI_HOME", str(home))
    assert "skip" not in install.enable_gemini()
    store = EventStore(data_home / "pixel-office")
    observed = []
    requests = []

    class Provider(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            self.rfile.read(int(self.headers.get("Content-Length", 0)))
            requests.append(self.path)
            observed.append(store.consume(lambda: [], time.time()))
            if provider_error:
                body = json.dumps({"error": {"code": 400, "message": "Synthetic provider failure", "status": "INVALID_ARGUMENT"}}).encode()
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
            else:
                response = {"candidates": [{"content": {"role": "model", "parts": [{"text": "SYNTHETIC_LOOPBACK_OK"}]}, "finishReason": "STOP", "index": 0}],
                            "usageMetadata": {"promptTokenCount": 8, "candidatesTokenCount": 4, "totalTokenCount": 12},
                            "modelVersion": "gemini-2.5-flash", "responseId": "synthetic-provider-response"}
                body = ("data: " + json.dumps(response) + "\n\n").encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    guard = tmp_path / "loopback-only.cjs"
    guard.write_text("""const net = require('node:net');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = typeof first === 'object' ? first.host : typeof args[1] === 'string' ? args[1] : 'localhost';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host || 'localhost')) throw new Error('Non-loopback connection rejected by test');
  return connect.apply(this, args);
};
""")
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Provider)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    # Do not inherit account/provider variables or a user's NODE_OPTIONS.
    env = {key: value for key, value in os.environ.items() if key in ("PATH", "LANG", "TMPDIR")}
    env.update({"GEMINI_CLI_HOME": str(home), "HERMES_HOME": str(data_home),
                "GEMINI_API_KEY": "synthetic-local-only", "GOOGLE_GEMINI_BASE_URL": f"http://127.0.0.1:{server.server_port}",
                "NODE_OPTIONS": "--require=" + json.dumps(str(guard), ensure_ascii=False),
                "GEMINI_CLI_SYSTEM_SETTINGS_PATH": str(system_settings),
                "GEMINI_CLI_SYSTEM_DEFAULTS_PATH": str(system_defaults), "GEMINI_CLI_NO_RELAUNCH": "1", "NO_COLOR": "1"})
    try:
        version = subprocess.run([cli, "--version"], env=env, cwd=project, capture_output=True, text=True, timeout=20)
        assert version.returncode == 0 and version.stdout.strip() == "0.63.0"
        result = subprocess.run([cli, "--skip-trust", "--model", "gemini-2.5-flash", "--prompt",
                                 "Return the synthetic fixture acknowledgement. Do not use tools.", "--output-format", "json"],
                                env=env, cwd=project, input="", capture_output=True, text=True, timeout=45)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
    assert len(requests) == 1 and requests[0].startswith("/v1beta/models/gemini-2.5-flash:streamGenerateContent")
    assert observed[0]["agents"][0]["platform"] == "gemini"
    assert observed[0]["agents"][0]["status"] == "thinking"
    source_id = observed[0]["agents"][0]["id"]
    final = store.consume(lambda: [], time.time())
    assert final["agents"][0]["status"] == ("thinking" if provider_error else "gone")
    history = list(reversed(store.history()))
    events = [row["event"] for row in history]
    expected = ["session_start", "session_busy"] + ([] if provider_error else ["session_idle", "session_end"])
    assert events == expected
    assert all(row["session_id"] == source_id for row in history)
    assert final["progress"]["stats"]["sessions"] == 1
    assert final["progress"]["stats"]["tools"] == final["progress"]["stats"]["errors"] == 0
    assert final["progress"]["xp"] == observed[0]["progress"]["xp"]
    assert final["usage"]["totals"]["reports"] == 0 and final["tasks"] == []
    if provider_error:
        assert result.returncode != 0
        assert "Synthetic provider failure" in result.stdout + result.stderr
        # JSON-mode upstream exits skip async SessionEnd; absence becomes a
        # quiet/stale observation, never an invented error or completed turn.
        now = time.time()
        quiet = store.consume(lambda: [], now + 301)
        assert quiet["agents"][0]["quiet"] is True
        assert quiet["agents"][0]["recorded_status"] == "thinking"
        expired = store.consume(lambda: [], now + 1801)
        assert expired["agents"] == []
        for stage in (quiet, expired):
            assert stage["progress"]["xp"] == final["progress"]["xp"]
            assert stage["progress"]["stats"] == final["progress"]["stats"]
            assert stage["usage"]["totals"]["reports"] == 0
            assert stage["tasks"] == []
        assert [row["event"] for row in reversed(store.history())] == ["session_start", "session_busy"]
    else:
        assert result.returncode == 0
        output = json.loads(result.stdout)
        assert output["response"] == "SYNTHETIC_LOOPBACK_OK"
        assert output["session_id"] == source_id
    # Native auth settings remain exactly the fixture's own selected fake-key
    # mode, and --skip-trust must not persist a trusted-folders record.
    assert json.loads(settings.read_text())["security"]["auth"] == {"selectedType": "gemini-api-key"}
    assert not (home / ".gemini/trustedFolders.json").exists()


@pytest.mark.parametrize("entry", ["settings.json", "system-defaults.json", "policies", "broken-link"])
def test_native_fixture_respects_existing_system_configuration(tmp_path, monkeypatch, entry):
    for key in ("GEMINI_CLI_SYSTEM_SETTINGS_PATH", "GEMINI_CLI_SYSTEM_DEFAULTS_PATH"):
        monkeypatch.delenv(key, raising=False)
    if entry == "policies":
        (tmp_path / entry).mkdir()
    elif entry == "broken-link":
        (tmp_path / "settings.json").symlink_to(tmp_path / "absent")
    else:
        (tmp_path / entry).write_text("preserve system settings")
    check = _check_native_host
    with pytest.raises(pytest.skip.Exception, match="system"):
        check(tmp_path)


@pytest.mark.parametrize("key", ["GEMINI_CLI_SYSTEM_SETTINGS_PATH", "GEMINI_CLI_SYSTEM_DEFAULTS_PATH"])
def test_native_fixture_respects_configured_system_override_even_if_file_missing(tmp_path, monkeypatch, key):
    monkeypatch.setenv(key, str(tmp_path / "missing"))
    check = _check_native_host
    with pytest.raises(pytest.skip.Exception, match="system"):
        check(tmp_path)


def test_native_fixture_skips_when_system_config_presence_is_unknown(tmp_path, monkeypatch):
    for key in ("GEMINI_CLI_SYSTEM_SETTINGS_PATH", "GEMINI_CLI_SYSTEM_DEFAULTS_PATH"):
        monkeypatch.delenv(key, raising=False)
    original = Path.lstat
    def denied(path):
        if path == tmp_path / "settings.json":
            raise PermissionError("unknown presence")
        return original(path)
    monkeypatch.setattr(Path, "lstat", denied)
    check = _check_native_host
    with pytest.raises(pytest.skip.Exception, match="system"):
        check(tmp_path)


def test_native_fixture_accepts_confirmed_absent_system_configuration(tmp_path, monkeypatch):
    for key in ("GEMINI_CLI_SYSTEM_SETTINGS_PATH", "GEMINI_CLI_SYSTEM_DEFAULTS_PATH"):
        monkeypatch.delenv(key, raising=False)
    check = _check_native_host
    check(tmp_path)
    assert list(tmp_path.iterdir()) == []
