# Agent Office

Pixel-art floor plan for **every** live coding agent on the machine — Hermes, OpenCode, Telegram, CLI, cron. Not Claude-only.

Hermes' answer to [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents), but runtime-agnostic: one event log, one office, platform logos, XP / unlocks.

## What you see

- One character per session. Gold collar = subagent.
- Activity: typing / reading / browsing / terminal / pointing.
- Red `!` when something needs approval.
- Rank + cosmetics (beanie → visor → gold monitor → cape) that persist in `~/.hermes/pixel-office/progress.json`.
- Buttons: **roster**, **stats**, **unlocks**, **how**, **all** (cycle Hermes / OpenCode / Telegram / CLI).

## Install

```bash
git clone https://github.com/NosytLabs/agent-office ~/.hermes/plugins/pixel-office
hermes plugins enable pixel-office
```

New Hermes process, then open http://127.0.0.1:8113

OpenCode (same office):

```bash
# plugin path already in this repo under opencode/
# add the absolute path to ~/.config/opencode/opencode.json → plugin[]
```

VS Code: copy `vscode/` into `~/.vscode/extensions/teknium.hermes-pixel-office-0.2.0` (or vsce package later) → **Hermes: Open Pixel Office**. `+ agent` can spawn `hermes` or `opencode`.

Demo with no agents:

```bash
python3 demo_feed.py
```

## How it works

```
Hermes hooks  ─┐
OpenCode plugin─┼─► events.jsonl ─► /state ─► canvas office
               ┘
```

Observer only. No prompt edits, no tool blocking.

## Tests

```bash
python3 -m pytest tests/test_progress.py
```

## License

MIT. Forked conceptually from Teknium's Hermes Pixel Office v0.2; this tree is the Agent Office fork with ranks, multi-runtime logos, and the OpenCode bridge.
