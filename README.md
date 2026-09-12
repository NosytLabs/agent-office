# Agent Office

**Multi-runtime pixel-art virtual office for AI coding agents.**

One floor for every agent you run — Hermes, OpenCode, Claude Code,
Telegram, CLI, and cron. Watch agents sit at desks, type, browse, and ask
for approval. Earn ranks, unlock a bullpen layout, collect pets.

Observer only. Runtime-agnostic. MIT.

Inspired by [pixel-agents-hq/pixel-agents](https://github.com/pixel-agents-hq/pixel-agents).

![screenshot](docs/screenshot.png)

## quick start

```bash
git clone https://github.com/NosytLabs/agent-office
cd agent-office
python3 install.py    # detects Hermes / OpenCode / Claude / VS Code
```

The installer is idempotent: it only adds this project’s integration, keeps
other settings, and writes JSON configuration atomically. If an existing
runtime config is malformed, it reports the file and leaves it untouched so
you can repair it before rerunning the installer.

Then open **http://127.0.0.1:8113** — no agents handy? `python3 demo_feed.py`

The installer wires only what you already have. Run it again any time to add
a new runtime.

## supported runtimes

| name | what | install |
|---|---|---|
| **Hermes** | this machine's AI agent (host) | already running |
| **OpenCode** | terminal-first CLI from SST | `brew install sst/tap/opencode` |
| **Claude Code** | Anthropic's CLI | `npm i -g @anthropic-ai/claude-code` |
| **Telegram** | Hermes phone bridge | set `TELEGRAM_BOT_TOKEN` |
| **CLI / cron** | shell + scheduled tasks | already wired |

Press `?` for platform icons, status key, and shortcuts.

## features

- **41 badges** with progress bars — unlock by using agents
- **5 ranks** — intern → junior → staff → principal → distinguished
- **2 layouts** — open floor (rug + kitchenette), bullpen (cubicles; 10 sessions)
- **3 themes** — plum, midnight, amber
- **pets** — cat, dog, fish tank, fern; mail / cleaner / intern NPCs
- **pixel-art sprites** — 6 agent sheets, NPC idles, furniture (door, coffee, plant, cooler, lamp, clock, bookshelf)
- **usage** — who is waiting, tools/session, error rate, per-runtime mix, CSV export
- **day/night** — auto after 19:00, or set in settings
- **click a character** to inspect session time and recent tools

## how to use

Open **http://127.0.0.1:8113**.

- Click a character — gold ring + inspector
- Click again to unfocus
- Click the cat to pet it

Header:

- `floor` — agents + usage (R / U)
- `badges` — unlocks (B)
- `settings` — layout, theme, day/night, desks per row, reset (S)
- `every` — filter by runtime
- theme name — cycle plum / midnight / amber (T)
- `sound` — chime on approval / unlock

Other shortcuts: `E` live events, `?` legend, `N` day/night, `esc` close.

## plugin setup

Hermes plugin metadata is in `plugin.yaml`. VS Code extension + Claude hook
+ OpenCode bridge are installed by `install.py`. Re-run it after cloning.

## architecture

See [docs/architecture.md](docs/architecture.md).

```text
Hermes hooks ───┐
OpenCode plugin ┼──► ~/.hermes/pixel-office/events.jsonl ──► /state ──► canvas
Claude hook ────┘                     │
                                     ▼
                              progress.json (XP, ranks, unlocks)
```

## tests

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-dev.txt
python3 -m pytest tests/ -q
```

The suite covers event folding, settings persistence, installer behavior, and
the Claude hook. The app is observer-only: it does not approve, deny, or
rewrite agent actions.

## repo layout

```text
agent-office/
├── README.md
├── LICENSE
├── install.py
├── plugin.yaml
├── __init__.py            hooks + HTTP server
├── progress.py            badges, ranks, stats
├── claude/hook.py
├── opencode/index.js
├── vscode/extension.js
├── web/
│   ├── template.html
│   ├── css/style.css
│   ├── js/data.js
│   ├── js/office.js
│   ├── assets/*.svg
│   └── assets/sprites/
├── tests/
└── docs/architecture.md
```

## license

MIT. © NosytLabs.
