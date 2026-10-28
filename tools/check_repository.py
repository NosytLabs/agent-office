#!/usr/bin/env python3
"""Read-only checks for tracked artifacts and local Markdown links; no network."""
from __future__ import annotations

import argparse
import html
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit

LOCAL_DIRS = frozenset({
    '.ci', '.hermes', '.venv', '.vercel', '__pycache__', '.pytest_cache',
    '.mypy_cache', '.ruff_cache', 'node_modules', 'dist', 'site-dist',
    'reports', 'playwright-report', 'test-results', 'coverage', 'htmlcov',
    'logs', 'pixel-office', 'shots',
})
TEXT_SUFFIXES = frozenset({'.py', '.js', '.mjs', '.cjs', '.css', '.html', '.md',
                           '.json', '.yml', '.yaml', '.toml', '.txt', '.sh'})
# Support the repository's inline links/images, reference definitions, angle
# destinations, escaped characters and parenthesized filenames (one level).
INLINE_LINK = re.compile(
    r'!?\[[^\[\]]*\]\(\s*(<[^>\n]+>|(?:\\.|[^\s\\()]|\((?:\\.|[^()\\])*\))+)'
    r'(?:\s+(?:"[^"\n]*"|\x27[^\x27\n]*\x27))?\s*\)')
REFERENCE = re.compile(r'^ {0,3}\[[^\]\n]+\]:[ \t]*(<[^>\n]+>|\S+)', re.M)
CONFLICT = re.compile(r'^(?:<<<<<<< .+|=======|>>>>>>> .+)$', re.M)


def without_fences(text: str) -> str:
    """Blank examples/comments while preserving line numbers for diagnostics."""
    result, fence, length = [], '', 0
    for line in text.splitlines(keepends=True):
        mark = re.match(r'^ {0,3}(`{3,}|~{3,})', line)
        if fence:
            if re.match(r'^ {0,3}' + re.escape(fence) + '{' + str(length) + r',}[ \t]*$', line.rstrip('\r\n')):
                fence = ''
            result.append('\n' if line.endswith('\n') else '')
        elif mark:
            fence, length = mark[1][0], len(mark[1])
            result.append('\n' if line.endswith('\n') else '')
        else:
            result.append(line)
    return re.sub(r'<!--.*?-->', lambda m: '\n' * m[0].count('\n'), ''.join(result), flags=re.S)


def anchors(text: str) -> set[str]:
    text = without_fences(text)
    found = set(re.findall(r'<[a-zA-Z][^>]*\b(?:id|name)=["\x27]([^"\x27]+)["\x27]', text))
    generated: set[str] = set()
    lines = text.splitlines()
    for i, line in enumerate(lines):
        heading = re.match(r'^ {0,3}#{1,6}\s+(.+?)(?:\s+#+\s*)?$', line)
        title = heading[1] if heading else None
        if title is None and i + 1 < len(lines) and line.strip() and re.fullmatch(r' {0,3}(?:=+|-+)[ \t]*', lines[i + 1]):
            title = line.strip()
        if title is None:
            continue
        title = re.sub(r'!?\[([^\]]+)\]\([^)]*\)', r'\1', title)
        title = re.sub(r'<[^>]+>', '', title)
        title = re.sub(r'(?<!\w)_([^_]+)_(?!\w)', r'\1', title)
        base = re.sub(r'[^\w\- ]', '', html.unescape(title).lower().strip()).replace(' ', '-')
        value, suffix = base, 0
        while value in generated:
            suffix += 1
            value = f'{base}-{suffix}'
        generated.add(value)
    return found | generated


def local_only(name: str) -> bool:
    path = PurePosixPath(name)
    base = path.name
    return (any(part in LOCAL_DIRS for part in path.parts[:-1])
            or base.endswith(('.log', '.pyc', '.pyo', '.tmp', '.bak', '.vsix'))
            or bool(re.search(r'\.log\.(?:\d[^/]*|gz|bz2|xz|zst)$', base))
            or base == '.DS_Store' or base.startswith('.coverage')
            or (base.startswith('.env') and base not in ('.env.example', '.env.sample'))
            or path.parts[0] == 'inbox'
            or (len(path.parts) == 1 and (base in ('settings.json', 'progress.json', 'events.jsonl', 'event-epoch',
                                                 'opencode-handoff.json')
                                          or base.startswith('office.sqlite3'))))


def inspect(root: Path, names: list[str]) -> tuple[list[str], int, int]:
    root = root.resolve()
    tracked = set(names)
    errors: list[str] = []
    documents: dict[str, str] = {}
    for name in names:
        if local_only(name):
            errors.append(f'{name}: generated or local-only file is tracked')
            continue
        path = root / name
        resolved = path.resolve()
        if not resolved.is_relative_to(root):
            errors.append(f'{name}: tracked path resolves outside repository')
            continue
        # A tracked symlink is not permission to inspect its untracked or
        # local-only target, even when that target is inside the checkout.
        resolved_name = resolved.relative_to(root).as_posix()
        if resolved_name not in tracked:
            errors.append(f'{name}: untracked symlink target')
            continue
        if local_only(resolved_name):
            errors.append(f'{name}: local-only symlink target')
            continue
        if not path.is_file():
            errors.append(f'{name}: tracked file is missing')
            continue
        if path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        try:
            text = path.read_text(encoding='utf-8')
        except (OSError, UnicodeError) as exc:
            errors.append(f'{name}: cannot read text ({type(exc).__name__})')
            continue
        if path.suffix.lower() == '.md':
            documents[name] = text
            # Setext headings and examples may legitimately contain =======.
            conflicts = re.search(r'^(?:<<<<<<< .+|>>>>>>> .+)$', without_fences(text), re.M)
        else:
            conflicts = CONFLICT.search(text)
        if conflicts:
            errors.append(f'{name}: unresolved merge conflict marker')
    heading_sets = {name: anchors(text) for name, text in documents.items()}
    links = 0
    for name, raw in documents.items():
        text = without_fences(raw)
        text = re.sub(r'(`+)[^\n]*?\1', '', text)
        for match in [*INLINE_LINK.finditer(text), *REFERENCE.finditer(text)]:
            destination = re.sub(r'\\([\\()<> ])', r'\1', html.unescape(match[1].strip('<>')))
            try:
                url = urlsplit(destination)
            except ValueError:
                errors.append(f'{name}: malformed link {destination!r}')
                continue
            if url.scheme or url.netloc:
                continue
            links += 1
            line = text.count('\n', 0, match.start()) + 1
            label = f'{name}:{line}: {destination}'
            target = ((root / unquote(url.path).lstrip('/')) if url.path.startswith('/')
                      else (root / name).parent / unquote(url.path)) if url.path else root / name
            target = target.resolve()
            if not target.is_relative_to(root):
                errors.append(label + ': outside repository')
                continue
            relative = target.relative_to(root).as_posix()
            in_tree = relative in tracked or (target.is_dir() and
                      (relative == '.' or any(p.startswith(relative + '/') for p in tracked)))
            if not target.exists() or not in_tree:
                errors.append(label + ': missing tracked target')
            elif url.fragment and relative in heading_sets and unquote(url.fragment) not in heading_sets[relative]:
                errors.append(label + ': missing heading or named anchor')
    return errors, len(documents), links


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    try:
        output = subprocess.run(['git', 'ls-files', '-z'], cwd=args.root, check=True,
                                capture_output=True, timeout=15)
        names = [name.decode('utf-8') for name in output.stdout.split(b'\0') if name]
        errors, documents, links = inspect(args.root, names)
    except (OSError, UnicodeError, subprocess.SubprocessError) as exc:
        print(f'Repository check requires a readable Git checkout ({type(exc).__name__}).', file=sys.stderr)
        return 2
    for error in errors:
        print(error)
    print(f'Checked {len(names)} tracked files, {documents} Markdown files, {links} local links; {len(errors)} issues.')
    return int(bool(errors))


if __name__ == '__main__':
    raise SystemExit(main())
