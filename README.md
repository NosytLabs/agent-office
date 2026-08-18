# Agent Office

Multi-runtime pixel-art virtual office. **Observer only** — never blocks,
vetoes, or rewrites prompts. Inspired by [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents);
runtime-agnostic and MIT-licensed.

## one-command install

```bash
git clone https://github.com/NosytLabs/agent-office
python3 install.py    # detects Hermes / OpenCode / Claude / VS Code
```

open **http://127.0.0.1:8113** — no agents handy? `python3 demo_feed.py`

## what you get

- **one character per agent session** — Hermes, OpenCode, Claude Code, Telegram, CLI, cron
- **real usage stats** — tools, reads/writes, browse/shell, subagents, errors, by-tool, by-runtime
- **30+ badges with progress bars** — rank up intern → distinguished
- **8 unlockable layouts** — bullpen, war room, lounge, roof deck, garden, library, arcade, penthouse
- **6 themes** — default, midnight, forest, solar, cyberpunk, sunset
- **multi-pet** — cat (default) + dog (100 sessions/50 tools) + fish tank (25 browse)
- **named areas** painted behind desks + folder→area mapping
- **paint mode** with drag-paint, click character to focus + inspector
- **live event ticker** + speech bubbles + health bar + animated hourglass
- **import/export layout** + settings persistence
- **keyboard shortcuts** (R/U/B/L/S/D/E/?/T/esc) + status legend + inspector
- **VS Code extension** + Claude Code hook + OpenCode bridge plugin

## architecture

see `docs/architecture.md`. 18 tests, all green:

```
python3 -m pytest tests/ -q
```

## license

MIT.
