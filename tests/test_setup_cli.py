"""Setup commands must be safe to inspect and deterministic to repeat."""
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]


def invoke(tmp_path, script, *args, extra_env=None):
    home = tmp_path / 'home'
    home.mkdir(exist_ok=True)
    for directory in ['.claude', '.codex', '.gemini']:
        (home / directory).mkdir(exist_ok=True)
    binary = home / 'bin'
    binary.mkdir(exist_ok=True)
    for name in ['claude', 'codex', 'gemini']:
        file = binary / name
        file.write_text('#!/bin/sh\nexit 0\n')
        file.chmod(0o755)
    env = {**os.environ, 'HOME': str(home), 'USERPROFILE': str(home),
           'HERMES_HOME': str(home / '.hermes'), 'CODEX_HOME': str(home / '.codex'),
           'GEMINI_CLI_HOME': str(home), 'PATH': str(binary), **(extra_env or {})}
    return subprocess.run([sys.executable, str(ROOT / script), *args],
                          cwd=ROOT, env=env, capture_output=True, text=True, timeout=10)


@pytest.mark.parametrize('flag', ['--help', '--dry-run'])
def test_installer_inspection_does_not_write_runtime_configuration(tmp_path, flag):
    result = invoke(tmp_path, 'install.py', flag)
    assert result.returncode == 0, result.stderr
    assert not list((tmp_path / 'home').rglob('*.json'))
    assert ('usage:' in result.stdout if flag == '--help' else 'no changes' in result.stdout.lower())


def test_only_selected_runtime_is_connected_and_repeat_is_idempotent(tmp_path):
    result = invoke(tmp_path, 'install.py', '--only', 'claude')
    assert result.returncode == 0, result.stderr
    home = tmp_path / 'home'
    before = (home / '.claude/settings.json').read_bytes()
    assert not (home / '.codex/hooks.json').exists()
    assert not (home / '.gemini/settings.json').exists()
    assert 'SessionStart' in json.loads(before)['hooks']
    result = invoke(tmp_path, 'install.py', '--only', 'claude', 'claude')
    assert result.returncode == 0, result.stderr
    assert (home / '.claude/settings.json').read_bytes() == before


@pytest.mark.parametrize('args', [('--only', 'cluade'), ('--unsupported',)])
def test_mistyped_installer_option_fails_before_configuration_writes(tmp_path, args):
    result = invoke(tmp_path, 'install.py', *args)
    assert result.returncode == 2
    assert not list((tmp_path / 'home').rglob('*.json'))


def test_dry_run_describes_selected_runtime_without_connecting_others(tmp_path):
    result = invoke(tmp_path, 'install.py', '--only', 'claude', '--dry-run')
    assert result.returncode == 0
    assert 'would connect claude' in result.stdout
    assert 'would connect codex' not in result.stdout
    assert not list((tmp_path / 'home').rglob('*.json'))


@pytest.mark.parametrize('args', [('--help',), ('--port', '8120', '--help')])
def test_server_help_ignores_a_malformed_environment_port(tmp_path, args):
    result = invoke(tmp_path, 'run.py', *args, extra_env={'AGENT_OFFICE_PORT': 'not-a-port'})
    assert result.returncode == 0
    assert 'usage:' in result.stdout
    assert 'Traceback' not in result.stderr


def test_invalid_environment_port_has_actionable_error_without_traceback(tmp_path):
    result = invoke(tmp_path, 'run.py', extra_env={'AGENT_OFFICE_PORT': 'not-a-port'})
    assert result.returncode == 2
    assert 'port' in result.stderr
    assert 'Traceback' not in result.stderr
