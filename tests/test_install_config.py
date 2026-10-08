from __future__ import annotations

import json
from pathlib import Path

import install
import pytest


def test_load_json_config_returns_empty_for_missing_and_reports_invalid_file(tmp_path):
    assert install.load_json_config(tmp_path / "missing.json") == {}
    broken = tmp_path / "broken.json"
    broken.write_text("{not json")
    with pytest.raises(ValueError):
        install.load_json_config(broken)


def test_save_json_config_is_atomic_and_keeps_valid_object(tmp_path):
    path = tmp_path / "config.json"
    install.save_json_config(path, {"plugin": ["existing"], "enabled": True})
    assert json.loads(path.read_text()) == {"plugin": ["existing"], "enabled": True}
    assert not list(tmp_path.glob("*.tmp"))


def test_save_json_config_rejects_non_object_payload(tmp_path):
    path = tmp_path / "config.json"
    try:
        install.save_json_config(path, ["not", "a", "mapping"])
    except ValueError as exc:
        assert "JSON object" in str(exc)
    else:
        raise AssertionError("expected ValueError")


@pytest.mark.parametrize("bucket", [{}, [None], [{"hooks": "invalid"}], [{"hooks": [None]}]])
def test_claude_invalid_hook_bucket_is_reported_without_writing(tmp_path, monkeypatch, bucket):
    monkeypatch.setattr(install, "HOME", tmp_path)
    path = tmp_path / ".claude/settings.json"
    path.parent.mkdir(parents=True)
    original = json.dumps({"hooks": {"PostToolUse": bucket}, "unrelated": True})
    path.write_text(original)
    assert "skip claude" in install.enable_claude()
    assert path.read_text() == original


@pytest.mark.parametrize("runtime,relative_path,enable", [
    ("opencode", ".config/opencode/opencode.json", install.enable_opencode),
    ("claude", ".claude/settings.json", install.enable_claude),
])
def test_installer_accepts_an_existing_empty_json_object(tmp_path, monkeypatch, runtime, relative_path, enable):
    monkeypatch.setattr(install, "HOME", tmp_path)
    path = tmp_path / relative_path
    path.parent.mkdir(parents=True)
    path.write_text("{}")
    result = enable()
    data = json.loads(path.read_text())
    assert "skip" not in result
    assert data.get("plugin") if runtime == "opencode" else data.get("hooks")


@pytest.mark.parametrize("relative_path,enable", [
    (".config/opencode/opencode.json", install.enable_opencode),
    (".claude/settings.json", install.enable_claude),
])
def test_installer_reports_non_object_json_without_replacing_it(tmp_path, monkeypatch, relative_path, enable):
    monkeypatch.setattr(install, "HOME", tmp_path)
    path = tmp_path / relative_path
    path.parent.mkdir(parents=True)
    path.write_text('["unrelated existing config"]')
    try:
        result = enable()
    except ValueError:
        pytest.fail("installer raised instead of reporting the invalid configuration")
    assert "skip" in result
    assert path.read_text() == '["unrelated existing config"]'


@pytest.mark.parametrize("relative_path,enable", [
    (".config/opencode/opencode.json", install.enable_opencode),
    (".claude/settings.json", install.enable_claude),
])
def test_first_install_creates_missing_configuration(tmp_path, monkeypatch, relative_path, enable):
    monkeypatch.setattr(install, "HOME", tmp_path)
    path = tmp_path / relative_path
    assert "skip" not in enable()
    data = json.loads(path.read_text())
    assert data.get("plugin") if "opencode" in relative_path else data.get("hooks")
    first = path.read_text()
    assert "already wired" in enable()
    assert path.read_text() == first


@pytest.mark.parametrize("plugin", [False, None, {}, ""])
def test_opencode_malformed_plugin_setting_is_not_overwritten(tmp_path, monkeypatch, plugin):
    monkeypatch.setattr(install, "HOME", tmp_path)
    path = tmp_path / ".config/opencode/opencode.json"
    path.parent.mkdir(parents=True)
    original = json.dumps({"plugin": plugin, "model": "existing/model"})
    path.write_text(original)
    assert "skip" in install.enable_opencode()
    assert path.read_text() == original


def test_opencode_installs_importable_file_and_preserves_other_plugins(tmp_path, monkeypatch):
    monkeypatch.setattr(install, "HOME", tmp_path)
    path = tmp_path / ".config/opencode/opencode.json"
    path.parent.mkdir(parents=True)
    existing = {"plugin": ["existing-plugin", ["other-plugin", {"enabled": True}]], "model": "existing/model"}
    path.write_text(json.dumps(existing))
    install.enable_opencode()
    data = json.loads(path.read_text())
    from urllib.parse import unquote, urlparse
    local = urlparse(data["plugin"][-1])
    assert local.scheme == "file"
    assert Path(unquote(local.path)).is_file()
    assert data["plugin"][:2] == existing["plugin"]
    assert data["model"] == existing["model"]
    assert "already wired" in install.enable_opencode()
    assert len(json.loads(path.read_text())["plugin"]) == 3


def test_claude_unrelated_command_does_not_hide_missing_observer(tmp_path, monkeypatch):
    monkeypatch.setattr(install, "HOME", tmp_path)
    path = tmp_path / ".claude/settings.json"
    path.parent.mkdir(parents=True)
    unrelated = {"matcher": "Bash", "hooks": [{"type": "command", "command": "echo agent-office-notification"}]}
    path.write_text(json.dumps({"hooks": {"PreToolUse": [unrelated]}, "permissions": {"allow": ["Read"]}}))
    install.enable_claude()
    data = json.loads(path.read_text())
    assert data["hooks"]["PreToolUse"][0] == unrelated
    assert len(data["hooks"]["PreToolUse"]) == 2
    assert data["permissions"] == {"allow": ["Read"]}
    assert "already wired" in install.enable_claude()


def test_saving_configuration_preserves_private_file_permissions(tmp_path):
    import stat
    path = tmp_path / "config.json"
    path.write_text('{"token": "private"}')
    path.chmod(0o600)
    install.save_json_config(path, {"token": "private", "enabled": True})
    assert stat.S_IMODE(path.stat().st_mode) == 0o600


def test_hermes_install_respects_custom_data_home(tmp_path, monkeypatch):
    monkeypatch.setattr(install, "HOME", tmp_path)
    custom = tmp_path / "custom hermes"
    monkeypatch.setenv("HERMES_HOME", str(custom))
    monkeypatch.setattr(install.subprocess, "run", lambda *args, **kwargs: (_ for _ in ()).throw(FileNotFoundError()))
    install.enable_hermes()
    assert (custom / "plugins/pixel-office").resolve() == install.HERE
    assert not (tmp_path / ".hermes/plugins").exists()


def test_hermes_install_repairs_dangling_plugin_link(tmp_path, monkeypatch):
    monkeypatch.setattr(install, "HOME", tmp_path)
    monkeypatch.delenv("HERMES_HOME", raising=False)
    link = tmp_path / ".hermes/plugins/pixel-office"
    link.parent.mkdir(parents=True)
    link.symlink_to(tmp_path / "old-clone")
    monkeypatch.setattr(install.subprocess, "run", lambda *args, **kwargs: (_ for _ in ()).throw(FileNotFoundError()))
    install.enable_hermes()
    assert link.resolve() == install.HERE


def test_hermes_refreshes_copied_runtime_files_but_keeps_local_configuration(tmp_path, monkeypatch):
    source = tmp_path / "checkout"
    source.mkdir()
    for name in ("__init__.py", "event_inbox.py", "event_store.py", "usage.py", "plugin.yaml"):
        (source / name).write_text("current " + name)
    (source / "web/assets").mkdir(parents=True)
    (source / "web/assets/prop.png").write_bytes(b"sprite")
    for name in ("node_modules", "reports", ".git", "__pycache__", "test-results", "tests"):
        (source / name).mkdir()
        (source / name / "generated").write_text("do not install")
    monkeypatch.setattr(install, "HERE", source)
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "home"))
    dest = tmp_path / "home/plugins/pixel-office"
    dest.mkdir(parents=True)
    (dest / "__init__.py").write_text("old")
    (dest / "local-config.json").write_text('{"preserve":true}')
    monkeypatch.setattr(install.subprocess, "run", lambda *a, **kw: (_ for _ in ()).throw(FileNotFoundError()))
    install.enable_hermes()
    assert (dest / "__init__.py").read_text() == "current __init__.py"
    assert (dest / "event_inbox.py").is_file() and (dest / "usage.py").is_file()
    assert (dest / "local-config.json").read_text() == '{"preserve":true}'
    assert (dest / "web/assets/prop.png").read_bytes() == b"sprite"
    assert not any((dest / name).exists() for name in ("node_modules", "reports", ".git", "__pycache__", "test-results", "tests"))


@pytest.mark.parametrize("copy_reason", ["existing-copy", "symlinks-unavailable"])
def test_copied_hermes_plugin_loads_and_observes_without_the_source_checkout(tmp_path, monkeypatch, copy_reason):
    """A missing transitive runtime module must fail a real isolated install."""
    import os
    import subprocess
    import sys

    home = tmp_path / "hermes"
    dest = home / "plugins/pixel-office"
    monkeypatch.setenv("HERMES_HOME", str(home))
    if copy_reason == "existing-copy":
        dest.mkdir(parents=True)
        (dest / "local-config.json").write_text('{"preserve":true}')
    else:
        def symlinks_unavailable(*args, **kwargs):
            raise OSError("symlinks unavailable on this filesystem")
        monkeypatch.setattr(Path, "symlink_to", symlinks_unavailable)

    run = subprocess.run
    monkeypatch.setattr(install.subprocess, "run", lambda *a, **kw: (_ for _ in ()).throw(FileNotFoundError()))
    install.enable_hermes()
    assert not dest.is_symlink()
    if copy_reason == "existing-copy":
        assert (dest / "local-config.json").read_text() == '{"preserve":true}'

    # -I excludes the checkout and PYTHONPATH. Import and use the installed
    # package, settings store, publisher, and SQLite model in a fresh process.
    probe = '''
import importlib.util
import json
import sys
import time
from pathlib import Path

root = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("copied_office", root / "__init__.py",
                                            submodule_search_locations=[str(root)])
office = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = office
spec.loader.exec_module(office)
settings = office._settings_store().read()
office._save_settings({"room_name": "Copied studio"}, expected_revision=settings.revision)
from event_inbox import publish
publish(office._office_dir(), {"event": "session_start", "session_id": "copied-session",
                              "platform": "hermes", "ts": time.time()})
snapshot = office.build_state()
assert snapshot["settings"]["room_name"] == "Copied studio"
assert [agent["id"] for agent in snapshot["agents"]] == ["copied-session"]
print(json.dumps({"room": snapshot["settings"]["room_name"], "agents": len(snapshot["agents"])}))
'''
    result = run([sys.executable, "-I", "-c", probe, str(dest)], cwd=tmp_path,
                 env={**os.environ, "HERMES_HOME": str(home)}, text=True,
                 capture_output=True, timeout=10)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {"room": "Copied studio", "agents": 1}


def test_codex_installs_synchronous_observers_preserves_config_and_requires_visible_trust(tmp_path, monkeypatch):
    import shlex
    monkeypatch.setenv("CODEX_HOME", str(tmp_path / "custom codex"))
    path = tmp_path / "custom codex/hooks.json"
    path.parent.mkdir(parents=True)
    original = {"matcher": "Bash", "hooks": [{"type": "command", "command": "existing-observer"}]}
    path.write_text(json.dumps({"hooks": {"PreToolUse": [original]}, "description": "keep me"}))
    result = install.enable_codex()
    assert "/hooks" in result and "review" in result and "trust" in result
    data = json.loads(path.read_text())
    assert data["description"] == "keep me" and data["hooks"]["PreToolUse"][0] == original
    for event in install.CODEX_EVENTS:
        handler = data["hooks"][event][-1]["hooks"][0]
        assert handler["type"] == "command" and handler["timeout"] == 3
        assert handler.get("async") is not True
        assert shlex.split(handler["command"])[-1] == str(install.HERE / "codex/hook.py")
        assert "bypass" not in handler["command"]
    before = path.read_text()
    assert "already wired" in install.enable_codex()
    assert path.read_text() == before


def test_codex_invalid_hook_config_is_not_replaced(tmp_path, monkeypatch):
    monkeypatch.setenv("CODEX_HOME", str(tmp_path))
    path = tmp_path / "hooks.json"
    original = '{"hooks":{"Stop":"invalid"},"keep":1}'
    path.write_text(original)
    assert "skip codex" in install.enable_codex()
    assert path.read_text() == original


def test_codex_detects_existing_user_config_without_launching_runtime(tmp_path, monkeypatch):
    monkeypatch.setattr(install, "HOME", tmp_path)
    monkeypatch.setenv("CODEX_HOME", str(tmp_path / "custom"))
    monkeypatch.setattr(install, "have", lambda cmd: False)
    assert not install.detect()["codex"]
    (tmp_path / "custom").mkdir()
    (tmp_path / "custom/config.toml").write_text('model = "existing"\n')
    assert install.detect()["codex"]


def test_vscode_installs_current_manifest_version_with_runtime_whitelist(tmp_path, monkeypatch):
    monkeypatch.setattr(install, "HOME", tmp_path)
    result = install.enable_vscode()
    manifest = json.loads((install.HERE / "vscode/package.json").read_text())
    ext = tmp_path / ".vscode/extensions" / f"{manifest['publisher']}.{manifest['name']}-{manifest['version']}"
    assert ext.is_dir() and str(ext) in result
    assert (ext / "extension.js").is_file() and (ext / "panel.js").is_file()
    assert (ext / "package.json").read_text() == (install.HERE / "vscode/package.json").read_text()
    assert not (ext / "node_modules").exists()



def test_claude_restricted_existing_observer_does_not_hide_other_tools(tmp_path, monkeypatch):
    import shlex
    monkeypatch.setattr(install, "HOME", tmp_path)
    path = tmp_path / ".claude/settings.json"
    path.parent.mkdir(parents=True)
    command = shlex.join([install.sys.executable, str(install.HERE / "claude/hook.py")])
    restricted = {"matcher": "Bash", "hooks": [{"type": "command", "command": command}]}
    path.write_text(json.dumps({"hooks": {"PreToolUse": [restricted]}}))
    install.enable_claude()
    buckets = json.loads(path.read_text())["hooks"]["PreToolUse"]
    assert buckets[0] == restricted
    assert any(not item.get("matcher") or item.get("matcher") == "*" for item in buckets)
    assert "already wired" in install.enable_claude()
    assert len(json.loads(path.read_text())["hooks"]["PreToolUse"]) == 2


def test_claude_installs_prompt_idle_failure_and_denied_permission_hooks(tmp_path, monkeypatch):
    monkeypatch.setattr(install, "HOME", tmp_path)
    path = tmp_path / ".claude/settings.json"
    install.enable_claude()
    hooks = json.loads(path.read_text())["hooks"]
    for event in ["UserPromptSubmit", "Stop", "StopFailure", "PermissionDenied"]:
        assert len(hooks[event]) == 1
        assert hooks[event][0]["hooks"][0]["type"] == "command"
    first = path.read_text()
    assert "already wired" in install.enable_claude()
    assert path.read_text() == first


def test_opencode_jsonc_is_reported_without_shadow_config(tmp_path, monkeypatch):
    monkeypatch.setattr(install, "HOME", tmp_path)
    monkeypatch.setattr(install, "have", lambda cmd: False)
    path = tmp_path / ".config/opencode/opencode.jsonc"
    path.parent.mkdir(parents=True)
    original = '// user configuration\n{"plugin": ["other-plugin"],}\n'
    path.write_text(original)
    assert install.detect()["opencode"]
    result = install.enable_opencode()
    assert "skip" in result and "opencode.jsonc" in result and "file:" in result
    assert path.read_text() == original
    assert not path.with_suffix(".json").exists()


def test_opencode_old_directory_entry_is_repaired_without_duplicate_bridge(tmp_path, monkeypatch):
    monkeypatch.setattr(install, "HOME", tmp_path)
    path = tmp_path / ".config/opencode/opencode.json"
    path.parent.mkdir(parents=True)
    plug = (install.HERE / "opencode/index.js").resolve().as_uri()
    path.write_text(json.dumps({"plugin": [str(install.HERE / "opencode"), plug, "other-plugin"]}))
    install.enable_opencode()
    assert json.loads(path.read_text())["plugin"] == [plug, "other-plugin"]
    assert "already wired" in install.enable_opencode()



def test_saving_symlinked_configuration_updates_managed_target(tmp_path):
    target = tmp_path / "dotfiles/settings.json"
    target.parent.mkdir()
    target.write_text('{"permissions": {"allow": ["Read"]}}')
    link = tmp_path / "settings.json"
    link.symlink_to(target)
    install.save_json_config(link, {"permissions": {"allow": ["Read"]}, "hooks": {}})
    assert link.is_symlink()
    assert json.loads(target.read_text())["hooks"] == {}


def test_install_reports_io_failure_and_continues_other_integrations(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(install, "HOME", tmp_path)
    monkeypatch.setattr(install, "detect", lambda: {"hermes": True, "opencode": True, "claude": False, "vscode": False})
    def denied():
        raise PermissionError("cannot write plugin directory")
    monkeypatch.setattr(install, "enable_hermes", denied)
    result = install.main()
    output = capsys.readouterr().out
    assert result == 1
    assert "hermes" in output and "cannot write plugin directory" in output
    assert json.loads((tmp_path / ".config/opencode/opencode.json").read_text())["plugin"]


def test_checkout_source_directories_are_not_detected_as_installed_runtimes(tmp_path, monkeypatch):
    monkeypatch.setattr(install, "HOME", tmp_path)
    monkeypatch.delenv("HERMES_HOME", raising=False)
    monkeypatch.setattr(install.shutil, "which", lambda cmd: None)
    monkeypatch.chdir(install.HERE)
    found = install.detect()
    assert found["claude"] is False
    assert found["opencode"] is False
    assert found["hermes"] is False


def test_observer_data_directory_is_not_a_hermes_installation(tmp_path, monkeypatch):
    monkeypatch.setattr(install, "HOME", tmp_path)
    monkeypatch.delenv("HERMES_HOME", raising=False)
    monkeypatch.setattr(install.shutil, "which", lambda cmd: None)
    (tmp_path / ".hermes/pixel-office").mkdir(parents=True)
    assert install.detect()["hermes"] is False


def test_existing_hermes_configuration_is_detected_without_cli_on_path(tmp_path, monkeypatch):
    monkeypatch.setattr(install, "HOME", tmp_path)
    monkeypatch.delenv("HERMES_HOME", raising=False)
    monkeypatch.setattr(install.shutil, "which", lambda cmd: None)
    config = tmp_path / ".hermes/config.yaml"
    config.parent.mkdir()
    config.write_text("plugins: {}\n")
    assert install.detect()["hermes"] is True


def test_first_install_without_runtimes_does_not_create_agent_configuration(tmp_path, monkeypatch):
    monkeypatch.setattr(install, "HOME", tmp_path)
    monkeypatch.delenv("HERMES_HOME", raising=False)
    monkeypatch.setattr(install.shutil, "which", lambda cmd: None)
    monkeypatch.chdir(install.HERE)
    assert install.main() == 0
    assert not (tmp_path / ".claude").exists()
    assert not (tmp_path / ".config/opencode").exists()


def test_gemini_install_honors_parent_home_preserves_disabled_hooks_and_is_idempotent(tmp_path, monkeypatch):
    monkeypatch.setattr(install, "HOME", tmp_path / "normal-home")
    monkeypatch.setenv("GEMINI_CLI_HOME", str(tmp_path / "isolated-home"))
    monkeypatch.setattr(install, "have", lambda cmd: False)
    path = tmp_path / "isolated-home/.gemini/settings.json"
    path.parent.mkdir(parents=True)
    original = {"hooks": {"enabled": False, "disabled": ["agent-office-observer"],
                           "BeforeTool": [{"matcher": "read_file", "hooks": [{"type": "command", "command": "keep"}]}]},
                "security": {"auth": {"selectedType": "keep"}, "folderTrust": {"enabled": True}}, "model": {"name": "keep"}}
    path.write_text(json.dumps(original))
    assert install.detect().get("gemini") is True
    assert callable(getattr(install, "enable_gemini", None))
    assert "skip" not in install.enable_gemini()
    first = path.read_text()
    result = json.loads(first)
    assert result["security"] == original["security"] and result["model"] == original["model"]
    for key in ("enabled", "disabled", "BeforeTool"):
        assert result["hooks"][key] == original["hooks"][key]
    for name in ("SessionStart", "BeforeAgent", "AfterAgent", "SessionEnd"):
        handler = result["hooks"][name][0]["hooks"][0]
        assert handler["type"] == "command" and handler["timeout"] == 3000
        assert handler["name"] == "agent-office-observer"
        assert "gemini/hook.py" in handler["command"]
    assert "already wired" in install.enable_gemini()
    assert path.read_text() == first
    assert not (tmp_path / "normal-home/.gemini").exists()


@pytest.mark.parametrize("raw", ['// keep comments\n{"hooks": {}}', '{"hooks": {"AfterAgent": [null]}}', '{"hooks": false}', '[]'])
def test_gemini_invalid_or_jsonc_settings_are_preserved(tmp_path, monkeypatch, raw):
    monkeypatch.setattr(install, "HOME", tmp_path)
    monkeypatch.delenv("GEMINI_CLI_HOME", raising=False)
    path = tmp_path / ".gemini/settings.json"
    path.parent.mkdir()
    path.write_text(raw)
    assert callable(getattr(install, "enable_gemini", None))
    assert "skip" in install.enable_gemini()
    assert path.read_text() == raw


def test_gemini_cli_detection_wires_only_installed_runtime(tmp_path, monkeypatch):
    monkeypatch.setattr(install, "HOME", tmp_path)
    monkeypatch.delenv("GEMINI_CLI_HOME", raising=False)
    monkeypatch.delenv("HERMES_HOME", raising=False)
    monkeypatch.delenv("CODEX_HOME", raising=False)
    monkeypatch.setattr(install, "have", lambda cmd: cmd == "gemini")
    assert install.main() == 0
    path = tmp_path / ".gemini/settings.json"
    assert path.is_file()
    assert set(json.loads(path.read_text())["hooks"]) == {"SessionStart", "BeforeAgent", "AfterAgent", "SessionEnd"}


@pytest.mark.parametrize("group", [
    {}, {"hooks": [{}]}, {"hooks": [], "matcher": []},
    {"hooks": [], "sequential": "false"},
    {"hooks": [{"type": "command", "command": 7}]},
    {"hooks": [{"type": "runtime", "name": "embedded", "action": None}]},
    {"hooks": [{"type": "command", "command": "keep", "name": []}]},
    {"hooks": [{"type": "command", "command": "keep", "timeout": True}]},
    {"hooks": [{"type": "command", "command": "keep", "timeout": float("inf")}]},
    {"hooks": [{"type": "command", "command": "keep", "env": {"FLAG": False}}]},
    {"hooks": [{"type": "command", "command": "keep", "source": "unsupported"}]},
    {"hooks": [{"type": "command", "command": "keep", "action": None}]},
])
def test_gemini_preserves_invalid_existing_target_definition_byte_for_byte(tmp_path, monkeypatch, group):
    monkeypatch.setattr(install, "HOME", tmp_path)
    monkeypatch.delenv("GEMINI_CLI_HOME", raising=False)
    path = tmp_path / ".gemini/settings.json"
    path.parent.mkdir()
    original = json.dumps({"hooks": {"AfterAgent": [group]}, "other": "preserve"}, indent=4) + "\n\n"
    path.write_text(original)
    assert "skip" in install.enable_gemini()
    assert path.read_text() == original


def test_gemini_preserves_valid_target_and_unrelated_hook_fields(tmp_path, monkeypatch):
    monkeypatch.setattr(install, "HOME", tmp_path)
    monkeypatch.delenv("GEMINI_CLI_HOME", raising=False)
    path = tmp_path / ".gemini/settings.json"
    path.parent.mkdir()
    group = {"matcher": "*", "sequential": True, "hooks": [{
        "type": "command", "command": "keep-command", "name": "existing", "description": "keep description",
        "timeout": 250.5, "source": "user", "env": {"FLAG": "value"}, "future_field": {"keep": True},
    }]}
    other = [{"matcher": "read_file", "hooks": [{"type": "command", "command": "keep-tool"}]}]
    original = {"hooks": {"AfterAgent": [group, {"hooks": []}], "BeforeTool": other}, "security": {"keep": True}}
    path.write_text(json.dumps(original))
    assert "skip" not in install.enable_gemini()
    result = json.loads(path.read_text())
    assert result["hooks"]["AfterAgent"][:2] == [group, {"hooks": []}]
    assert result["hooks"]["BeforeTool"] == other and result["security"] == {"keep": True}
    assert len(result["hooks"]["AfterAgent"]) == 3
