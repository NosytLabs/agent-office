"""Regression cases found during the October browser/server audit."""
import json
import time
import shlex
import shutil
import subprocess
from pathlib import Path

import pytest
import __init__ as plugin
import install
import progress


def test_corrupt_event_records_do_not_break_state(tmp_path, monkeypatch):
    monkeypatch.setattr(plugin, '_office_dir', lambda: tmp_path)
    records = [None, [], 'bad', {'event': 'tool_start', 'ts': 'invalid', 'session_id': 'bad'},
               {'event': 'session_start', 'ts': time.time(), 'session_id': 'good', 'platform': 'cli'}]
    (tmp_path / 'events.jsonl').write_text('\n'.join(json.dumps(x) for x in records))
    assert [a['id'] for a in plugin.build_state()['agents']] == ['good']


def test_event_names_must_be_nonempty_strings(tmp_path, monkeypatch):
    monkeypatch.setattr(plugin, '_office_dir', lambda: tmp_path)
    records = [{'ts': 1}, {'ts': 2, 'event': None}, {'ts': 3, 'event': []},
               {'ts': 4, 'event': ''}, {'ts': 5, 'event': 'tool_start'}]
    (tmp_path / 'events.jsonl').write_text('\n'.join(json.dumps(x) for x in records))
    assert plugin._read_events() == [records[-1]]


def test_settings_recover_from_non_object_file(tmp_path, monkeypatch):
    monkeypatch.setattr(plugin, '_office_dir', lambda: tmp_path)
    (tmp_path / 'settings.json').write_text('[1,2]')
    assert plugin._load_settings()['theme'] == 'default'


def test_settings_validate_values_and_keep_valid_prefs(tmp_path, monkeypatch):
    monkeypatch.setattr(plugin, '_office_dir', lambda: tmp_path)
    plugin._save_settings({'theme': 'amber', 'max_chars': 3})
    plugin._save_settings({'theme': '<script>', 'max_chars': -100, 'layout': [], 'sound': 'false'})
    got = plugin._load_settings()
    assert got['theme'] == 'amber'
    assert got['max_chars'] == 3
    assert got['layout'] == 'open'
    assert got['sound'] is False


def test_theme_switches_do_not_create_work_progress(tmp_path, monkeypatch):
    monkeypatch.setattr(plugin, '_office_dir', lambda: tmp_path)
    for theme in ['amber', 'midnight', 'default', 'amber', 'default']:
        plugin._save_settings({'theme': theme})
    assert plugin._load_settings()['theme'] == 'default'
    assert not (tmp_path / 'progress.json').exists()
    assert not (tmp_path / 'office.sqlite3').exists()


def test_fish_unlock_matches_displayed_threshold(tmp_path):
    data = progress.load(tmp_path / 'progress.json')
    data['stats']['browses'] = 15
    progress.ingest(data, [])
    assert 'pet_fish' not in data['unlocks']
    data['stats']['browses'] = 25
    progress.ingest(data, [])
    assert 'pet_fish' in data['unlocks']


def test_empty_floor_does_not_unlock_first_session_plant(tmp_path):
    data = progress.ingest(progress.load(tmp_path / 'progress.json'), [])
    assert 'pet_plant' not in data['unlocks']


def test_earned_badges_show_complete_progress(tmp_path):
    data = progress.load(tmp_path / 'progress.json')
    data['unlocks']['first_shift'] = {'name': 'First day', 'at': 1}
    badge = next(c for c in progress.snapshot(data)['catalog'] if c['id'] == 'first_shift')
    assert badge['have'] and badge['progress'] == 100


def test_claude_hook_command_handles_spaces(tmp_path, monkeypatch):
    monkeypatch.setattr(install, 'HOME', tmp_path)
    root = tmp_path / 'folder with spaces'
    (root / 'claude').mkdir(parents=True)
    (root / 'claude/hook.py').write_text('# hook')
    monkeypatch.setattr(install, 'HERE', root)
    cfg = tmp_path / '.claude/settings.json'
    cfg.parent.mkdir()
    cfg.write_text('{}')
    install.enable_claude()
    command = json.loads(cfg.read_text())['hooks']['SessionStart'][0]['hooks'][0]['command']
    assert shlex.split(command)[1] == str(root / 'claude/hook.py')


def test_vscode_install_keeps_the_iframe_wrapper(tmp_path, monkeypatch):
    monkeypatch.setattr(install, 'HOME', tmp_path)
    install.enable_vscode()
    node = shutil.which('node')
    if node is None:
        pytest.skip('Node is required to execute the installed VS Code renderer')
    installed = next((tmp_path / '.vscode/extensions').glob('*/media/office.html')).parent.parent
    rendered = subprocess.run([
        node, '-e', """
const fs = require('node:fs');
const root = process.argv[1];
const { renderPanel } = require(root + '/panel.js');
process.stdout.write(renderPanel(fs.readFileSync(root + '/media/office.html', 'utf8'), 'http://127.0.0.1:8125/'));
""", str(installed),
    ], check=True, capture_output=True, text=True).stdout
    assert '<iframe src="http://127.0.0.1:8125/"' in rendered
    assert 'frame-src http://127.0.0.1:8125' in rendered
    assert '{{' not in rendered
    assert 'css/style.css' not in rendered


def test_incremental_events_with_same_timestamp_are_counted_once(tmp_path):
    data = progress.load(tmp_path / 'progress.json')
    one = {'ts': 100.0, 'event': 'tool_start', 'session_id': 'a', 'tool_name': 'read_file'}
    two = {'ts': 100.0, 'event': 'tool_start', 'session_id': 'b', 'tool_name': 'write_file'}
    progress.ingest(data, [one])
    progress.ingest(data, [one, two])
    assert data['stats']['tools'] == 2
    progress.ingest(data, [one, two])
    assert data['stats']['tools'] == 2


def test_legacy_progress_cursor_does_not_replay_last_event(tmp_path):
    path = tmp_path / 'progress.json'
    data = progress.load(path)
    event = {'ts': 100.0, 'event': 'tool_start', 'tool_name': 'read_file'}
    progress.ingest(data, [event])
    del data['last_ts_counts']
    path.write_text(json.dumps(data))
    restored = progress.load(path)
    progress.ingest(restored, [event])
    assert restored['stats']['tools'] == 1
