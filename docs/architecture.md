# Agent Office — architecture

Multi-runtime pixel-art virtual office. Observer only — never blocks,
vetoes, or rewrites prompts.

## event flow

```
              hooks / plugins
                   │
   hermes ─────────┤
   opencode ───────┼──► ~/.hermes/pixel-office/events.jsonl
   claude code ────┤            │
   telegram ───────┤            ▼
   cli / cron ─────┘   ingest() ──► progress.json
                            │
                            ▼
                       /state (HTTP)
                            │
                ┌───────────┼────────────┐
                ▼           ▼            ▼
           canvas      vscode ext    standalone CLI
```

## server endpoints

| path | method | purpose |
|---|---|---|
| `/` | GET | pixel office HTML |
| `/state` | GET | folded agents + progress + settings + last 30 events |
| `/settings` | GET | persisted layout/areas/toggles |
| `/settings` | POST | save partial settings (whitelisted keys) |
| `/assets-manifest` | GET | list bundled + user SVGs |
| `/assets/<name>.svg` | GET | bundled logo |
| `/user/<name>.svg` | GET | user-uploaded logo from `~/.hermes/pixel-office/assets/` |

## persistence

| file | format | purpose |
|---|---|---|
| `events.jsonl` | newline-delimited JSON | raw hook events, trimmed to 512 KB |
| `progress.json` | JSON | ranks, unlocks, stats — 28+ badge catalog |
| `settings.json` | JSON | layout, theme, areas, painted tiles, folders |

## front-end (`web/template.html`)

single file, no build step, ~1150 lines. Vanilla canvas + DOM.
8 sheets open with keyboard shortcuts (`R/U/B/L/S/D/E/?/T/esc`).

## plugins (4 runtimes + 1 obs)

| file | hook | events written |
|---|---|---|
| `__init__.py` (hermes) | `on_session_start`, `pre_tool_call`, ... | full lifecycle |
| `opencode/index.js` | `tool.execute.*`, `session.*` | full lifecycle |
| `claude/hook.py` | stdin JSON for SessionStart/PreToolUse/... | full lifecycle |
| `vscode/extension.js` | polls `/state` every 1.5s | observer only |

## tests

```
python3 -m pytest tests/ -q
```

18 tests across progress, settings, claude hook, layout unlocks, events endpoint.
