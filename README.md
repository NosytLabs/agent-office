# Agent Office

One pixel floor for **whatever agents you actually run**.

Hermes-only? Just Hermes. Add OpenCode later — they sit at the same desks. Claude Code hooks in the same way. Telegram sessions walk in from the gateway.

Inspired by [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) (Claude-only). Agent Office is runtime-agnostic, MIT, no telemetry.

## Guided install

```bash
git clone https://github.com/NosytLabs/agent-office
cd agent-office
python3 install.py
```

The installer **detects** Hermes / OpenCode / Claude Code / VS Code and only wires what exists. Hermes-only machines never get Claude hooks.

Then start a **new** process of whatever you use, and open:

**http://127.0.0.1:8113**

or VS Code command **Agent Office: Open Floor**.

No agents handy?

```bash
python3 demo_feed.py
```

## What you get

| surface | what it is |
|---|---|
| floor | canvas office, day/night, cosmetics |
| **roster** | every live session + status + tool |
| **usage** | real counts: tools, reads/writes, errors, peak concurrent, top tools, by runtime |
| **badges** | 27 unlocks — first shift → three houses → 5k tools |
| **guide** | how the event log works |

Observer only. Nothing blocks tools or edits prompts.

```
Hermes hooks ─┐
OpenCode     ─┼─► events.jsonl ─► /state ─► floor
Claude hooks ─┘
```

## Manual (if you skip install.py)

```bash
# Hermes
ln -s "$(pwd)" ~/.hermes/plugins/pixel-office
hermes plugins enable pixel-office

# OpenCode — add this repo's opencode/ path to plugin[]
# Claude — python3 claude/hook.py on SessionStart/PreToolUse/… (installer appends)
```

## Tests

```bash
python3 -m pytest tests/test_progress.py tests/test_claude_hook.py
```

## License

MIT.
