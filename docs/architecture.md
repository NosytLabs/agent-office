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
| `/state` | DELETE | reset progress + event history |
| `/settings` | GET | persisted layout / theme / toggles |
| `/settings` | POST | save whitelisted settings (theme switches tracked) |
| `/assets-manifest` | GET | bundled + user SVGs |
| `/assets/sprites/**.png` | GET | pixel-art sheets |
| `/user/<name>.svg` | GET | user-uploaded logo |

Static files under `web/` are served with a path-safe handler.

## persistence

| file | format | purpose |
|---|---|---|
| `events.jsonl` | newline-delimited JSON | raw hook events, trimmed to 512 KB |
| `progress.json` | JSON | ranks, unlocks, stats — 41 badge catalog |
| `settings.json` | JSON | layout, theme, max_chars |

## front-end

Vanilla canvas + DOM, no build step. `data.js` then `office.js`.

Header panels: **floor** (roster + usage), **badges**, **settings** (layout + theme).
Shortcuts: `R/U` floor, `B` badges, `S/L` settings, `E` live, `?` legend, `T` theme, `N` day/night, `esc` close.

Characters render from sprite sheets (`assets/sprites/`, adapted from pixel-agents, MIT)
with a procedural fallback while sheets load. NPCs use dedicated idle sprites.

## plugins

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
