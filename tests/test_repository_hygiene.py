"""Exercise repository hygiene against real, isolated Git indexes."""
from pathlib import Path
import subprocess
import sys

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / 'tools' / 'check_repository.py'


def check(tmp_path, files):
    root = tmp_path / 'checkout'
    root.mkdir()
    subprocess.run(['git', 'init', '-q', str(root)], check=True)
    for name, content in files.items():
        file = root / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(content)
    subprocess.run(['git', 'add', '--all'], cwd=root, check=True)
    # An ignored/local file must not mask a missing committed link target.
    (root / 'not-committed.md').write_text('# Secret local note\n')
    return subprocess.run([sys.executable, str(SCRIPT), '--root', str(root)],
                          capture_output=True, text=True, timeout=10)


def test_repository_hygiene_command_exists():
    assert SCRIPT.is_file(), 'Add a repeatable repository/documentation hygiene gate'


def test_valid_local_links_anchors_references_and_external_urls(tmp_path):
    result = check(tmp_path, {
        'README.md': '# Office\n[Guide](/docs/guide.md#same-1)\n[Text][ref]\n'
                     '[ref]: docs/guide.md#named\n[External](https://example.invalid/missing)\n',
        'docs/guide.md': '# Same\n## Same\n<a id="named"></a>\n[Home](../README.md#office)\n',
    })
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.parametrize('destination,problem', [
    ('missing.md', 'missing tracked target'),
    ('not-committed.md', 'missing tracked target'),
    ('README.md#missing', 'missing heading'),
    ('../outside.md', 'outside repository'),
])
def test_bad_local_links_fail_even_when_an_untracked_target_exists(tmp_path, destination, problem):
    result = check(tmp_path, {'README.md': f'# Office\n[Broken]({destination})\n'})
    assert result.returncode == 1
    assert problem in result.stdout


@pytest.mark.parametrize('name', [
    'server.log', 'server.log.1', 'reports/latest.txt', 'dist/app.js',
    '.env', '.env.local', '__pycache__/cached.pyc', '.ci/transport.txt',
    'pixel-office/settings.json', '.coverage', 'logs/trace.txt',
])
def test_generated_logs_local_state_and_credentials_cannot_be_tracked(tmp_path, name):
    result = check(tmp_path, {name: 'fixture only'})
    assert result.returncode == 1
    assert 'generated or local-only' in result.stdout


def test_templates_and_deliberate_jsonl_test_fixtures_are_allowed(tmp_path):
    result = check(tmp_path, {'.env.example': 'MODEL=example\n',
                              'tests/fixtures/sample-events.jsonl': '{}\n'})
    assert result.returncode == 0, result.stdout + result.stderr


def test_code_examples_do_not_create_phantom_links(tmp_path):
    result = check(tmp_path, {'README.md': '# Guide\n```md\n[example](missing.md)\n'
                              '```\n`[inline example](absent.md)`\n'})
    assert result.returncode == 0, result.stdout + result.stderr


def test_encoded_spaces_parentheses_and_setext_headings(tmp_path):
    result = check(tmp_path, {'README.md': '[A](docs/a%20b.md#title)\n[B](docs/file(1).md#title)\n',
                              'docs/a b.md': 'Title\n=====\n', 'docs/file(1).md': '# Title\n'})
    assert result.returncode == 0, result.stdout + result.stderr


def test_source_conflict_markers_are_rejected(tmp_path):
    result = check(tmp_path, {'main.py': '<<<<<<< HEAD\na = 1\n=======\na = 2\n>>>>>>> incoming\n'})
    assert result.returncode == 1
    assert 'merge conflict' in result.stdout


def test_links_with_code_formatted_labels_are_not_skipped(tmp_path):
    result = check(tmp_path, {'README.md': '[`missing.py`](missing.py)\n'})
    assert result.returncode == 1
    assert 'missing tracked target' in result.stdout


def test_missing_checkout_is_reported_without_a_traceback(tmp_path):
    result = subprocess.run([sys.executable, str(SCRIPT), '--root', str(tmp_path / 'absent')],
                            capture_output=True, text=True)
    assert result.returncode == 2
    assert 'readable Git checkout' in result.stderr
    assert 'Traceback' not in result.stderr


def test_tracked_symlink_cannot_read_outside_checkout(tmp_path):
    root = tmp_path / 'repo'
    root.mkdir()
    outside = tmp_path / 'private.md'
    outside.write_text('# Never read this\n[Private](sensitive-token)\n')
    (root / 'README.md').symlink_to(outside)
    subprocess.run(['git', 'init', '-q', str(root)], check=True)
    subprocess.run(['git', 'add', '--all'], cwd=root, check=True)
    result = subprocess.run([sys.executable, str(SCRIPT), '--root', str(root)],
                            capture_output=True, text=True)
    assert result.returncode == 1
    assert 'outside repository' in result.stdout
    assert 'sensitive-token' not in result.stdout


def test_ignore_rules_protect_development_output_and_local_credentials(tmp_path):
    root = tmp_path / 'repo'
    root.mkdir()
    (root / '.gitignore').write_bytes((SCRIPT.parents[1] / '.gitignore').read_bytes())
    subprocess.run(['git', 'init', '-q', str(root)], check=True)
    names = ['.env', '.env.local', 'server.log.2', '.coverage', '.ruff_cache/file',
             'pixel-office/settings.json', 'reports/screenshot.png', 'settings.json']
    result = subprocess.run(['git', 'check-ignore', '--stdin'], cwd=root,
                            input='\n'.join(names) + '\n', capture_output=True, text=True)
    assert result.stdout.splitlines() == names
    templates = subprocess.run(['git', 'check-ignore', '--no-index', '.env.example', '.env.sample'],
                               cwd=root, capture_output=True, text=True)
    assert templates.returncode == 1


def test_tracked_symlink_does_not_read_untracked_local_file(tmp_path):
    root = tmp_path / 'repo'
    root.mkdir()
    (root / 'README.md').symlink_to('private-note.md')
    subprocess.run(['git', 'init', '-q', str(root)], check=True)
    subprocess.run(['git', 'add', 'README.md'], cwd=root, check=True)
    (root / 'private-note.md').write_text('[Private detail](local-private-token)\n')
    result = subprocess.run([sys.executable, str(SCRIPT), '--root', str(root)],
                            capture_output=True, text=True, timeout=10)
    assert result.returncode == 1
    assert 'untracked symlink target' in result.stdout
    assert 'local-private-token' not in result.stdout
    assert '0 Markdown files' in result.stdout


def test_symlink_to_tracked_document_still_checks_links(tmp_path):
    root = tmp_path / 'repo'
    root.mkdir()
    (root / 'README.md').symlink_to('guide.md')
    (root / 'guide.md').write_text('# Guide\n[Missing](absent.md)\n')
    subprocess.run(['git', 'init', '-q', str(root)], check=True)
    subprocess.run(['git', 'add', '--all'], cwd=root, check=True)
    result = subprocess.run([sys.executable, str(SCRIPT), '--root', str(root)],
                            capture_output=True, text=True, timeout=10)
    assert result.returncode == 1
    assert 'missing tracked target' in result.stdout
    assert 'untracked symlink target' not in result.stdout


def test_rejected_local_state_is_not_parsed_as_documentation(tmp_path):
    root = tmp_path / 'repo'
    root.mkdir()
    (root / 'pixel-office').mkdir()
    (root / 'pixel-office/private.md').write_text('[Private detail](local-private-token)\n')
    (root / 'README.md').symlink_to('pixel-office/private.md')
    subprocess.run(['git', 'init', '-q', str(root)], check=True)
    subprocess.run(['git', 'add', '--all'], cwd=root, check=True)
    result = subprocess.run([sys.executable, str(SCRIPT), '--root', str(root)],
                            capture_output=True, text=True, timeout=10)
    assert result.returncode == 1
    assert 'local-only' in result.stdout
    assert 'local-private-token' not in result.stdout
    assert '0 Markdown files' in result.stdout
