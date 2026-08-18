# Agent Office

Multi-runtime pixel-art virtual office for AI coding agents. **Observer only** —
never blocks, vetoes, or rewrites prompts. Inspired by [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents);
runtime-agnostic and MIT-licensed.

## one-command install

```bash
git clone https://github.com/NosytLabs/agent-office
cd agent-office
python3 install.py    # detects Hermes / OpenCode / Claude / VS Code
```

The installer wires **only what you already have**. Hermes-only? Just Hermes.
Add Claude later — installer re-runs safely.

Open **http://127.0.0.1:8113** — no agents handy? `python3 demo_feed.py`

## runtimes supported

| name | what | install |
|---|---|---|
| **Hermes** | this machine's AI agent (host) | already running |
| **OpenCode** | terminal-first CLI from SST | `brew install sst/tap/opencode` |
| **Claude Code** | Anthropic's CLI | `npm i -g @anthropic-ai/claude-code` |
| **Telegram** | Hermes phone bridge | set `TELEGRAM_BOT_TOKEN` |
| **CLI / cron** | shell agents + scheduled tasks | already wired |

click **platforms** in the header (or press `P`) for full details.

## what you get

- **one character per agent session** — 5 runtimes, all in one office
- **real usage stats** — tools, reads/writes, browse/shell, subagents, errors, by-tool, by-runtime
- **48 badges with progress bars** — rank up intern → distinguished
- **8 unlockable layouts** — bullpen, war room, lounge, roof deck, garden, library, arcade, penthouse
- **6 themes** — default, midnight, forest, solar, cyberpunk, sunset
- **multi-pet** — cat (default) + dog + fish tank (each unlockable)
- **named areas** painted behind desks + folder→area mapping
- **paint mode** with drag-paint, click character to focus + inspector
- **live event ticker** + speech bubbles + health bar + animated hourglass
- **import/export layout** + settings persistence
- **keyboard shortcuts** (R/U/B/L/S/D/E/?/T/P/esc) + status legend + inspector + platforms
- **VS Code extension** + Claude Code hook + OpenCode bridge plugin

## keyboard shortcuts

| key | opens |
|---|---|
| `R` | roster |
| `U` | usage stats |
| `B` | badges |
| `L` | layouts |
| `S` | settings |
| `D` | debug (raw /state) |
| `E` | live events |
| `?` | legend |
| `T` | cycle theme |
| `P` | platforms (what is what?) |
| `esc` | close all sheets |

## for non-Hermes users

The plugin is a **Hermes plugin**. To use Agent Office with OpenCode,
Claude Code, or any other CLI:

1. Run **any** agent — each runtime has its own observer that writes
   to `~/.hermes/pixel-office/events.jsonl`
2. Open the office at **http://127.0.0.1:8113**
3. That's it — agents from every runtime show up in one office

The Claude Code hook is at `claude/hook.py` (auto-installed by `install.py`).
The OpenCode bridge is at `opencode/index.js` (auto-installed).

## architecture

see `docs/architecture.md`.

## tests

```bash
python3 -m pytest tests/ -q   # 18 tests
```

## license

MIT.
