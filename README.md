# Agent Office

**Multi-runtime pixel-art virtual office for AI coding agents.**

One floor for every agent you run — Hermes, OpenCode, Claude Code,
Telegram, CLI, and cron. Watch agents sit at desks, type, browse, and ask
for approval. Earn ranks, unlock layouts, collect pets, and map real
project folders to colored office zones.

Observer only. Runtime-agnostic. MIT.

Inspired by [pixel-agents-hq/pixel-agents](https://github.com/pixel-agents-hq/pixel-agents).

![screenshot](docs/screenshot.png)

## quick start

```bash
git clone https://github.com/NosytLabs/agent-office
cd agent-office
python3 install.py    # detects Hermes / OpenCode / Claude / VS Code
```

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

Click **legend** in the header (or `?`) for platform icons, status key, and shortcuts.

## features

- **41 badges** with progress bars — unlock by using agents
- **5 ranks** — intern → junior → staff → principal → distinguished
- **2 layouts** — open, bullpen (lounge/library retired; old saves auto-migrate to open)
- **2 themes** — default, midnight (forest/ocean retired; old saves auto-migrate to default)
- **3 pets** — cat, dog, fish tank + fern (delivery/inspector NPCs retired; mail/cleaner/intern remain)
- **real pixel-art sprite sheets** — 6 characters × 3 directions × 7 frames with
  directional walking (up / right / mirrored-left), typing/idle variants, animated
  pets (adapted from pixel-agents, MIT — see ATTRIBUTION.md)
- **single desk style, 3 hash-stable finishes** — one readable workstation (walnut/oak/ebony picked per agent); gold monitor trim for principal+
- **usage tracking** — attention queue (who needs input + blocked time), live status mix,
  tools/session throughput, error rate, per-agent elapsed time, top tools,
  per-runtime breakdowns in the usage + roster panels; **export CSV** from usage;
  per-agent session time + tool history in the inspector (click a character)
- **tracking-first panels** — roster + usage + live share one filter query; roster is blocked-first with elapsed + blocked time, per-agent detail, team grouping; live feed is searchable (like agentroom session search)
- **day/night cycle** — ambient dim + additive light pools (neon flicker, kitchenette
  warmth, plant uplights, monitor glows) after 19:00; manual
  ◐ auto / ☾ night / ☀ day toggle in the header (persists)
- **seasonal touch** — October jack-o-lantern by the door
- **NPC visitors** — mail carriers (with parcel), cleaners, interns wander in through
  the door with waypoint pathing, idle shuffles, rotating speech bubbles, door chime;
  max 2 concurrent, 30–120s between visits
- **pair-programming** — seated agents occasionally walk to a colleague's desk with a
  green pairing indicator for 15–35s, then return
- **per-agent desk finishes** — walnut/oak/ebony, hash-stable per agent
- **bullpen extras** — bins + cactus (bookshelf/sofa retired with lounge/library)
- **cosmetics** — pets on desks, orange scarf, sleeping office cat by the kitchenette,
  storm lamp; granted cosmetics all render
- **paint mode** with drag-paint, click character to focus + inspect
- **live event ticker** + speech bubbles + health bar + hourglass
- **import/export layout** + settings persistence
- **reset everything** — settings ⚙ → wipe XP/badges/history/painted tiles
- **keyboard shortcuts** — `R/U/B/L/S/D/E/?/T/N/F/esc`
- **status legend** + live feed + raw debug
- **VS Code extension** + Claude Code hook + OpenCode bridge plugin

## how to use

Open **http://127.0.0.1:8113**.

- Click any character to focus — gold ring + inspector panel
- Click again to unfocus
- Click the cat to pet it
- Drag on the canvas in paint mode to color tiles
- Press `?` to see keyboard shortcuts

Header buttons:

- `layout` `roster` `usage` `badges` `live` `legend` `settings` — panels
- `every` — runtime filter
- theme name — cycle palette (T)
- `◐ auto` — day / night / auto (N)
- `fog` — fog of war (F)
- `sound` — chime on approval/unlock

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
python3 -m pytest tests/ -q    # 19 tests
```

## repo layout

```text
agent-office/
├── README.md                  (you are here)
├── LICENSE                    (MIT)
├── install.py                 (guided installer)
├── plugin.yaml                (Hermes plugin metadata)
├── __init__.py                (hooks + HTTP server)
├── progress.py                (43 badges, ranks, stats)
├── claude/hook.py             (Claude Code hook)
├── opencode/index.js          (OpenCode bridge plugin)
├── vscode/extension.js        (VS Code extension)
├── web/
│   ├── template.html          (HTML shell)
│   ├── css/style.css          (all styles)
│   ├── js/data.js             (themes, layouts, platforms, ranks)
│   ├── js/office.js           (canvas + UI)
│   ├── assets/*.svg           (5 runtime logos)
│   └── assets/sprites/        (pixel-art character/pet sheets — see ATTRIBUTION.md)
├── tests/                     (19 unit tests)
└── docs/architecture.md
```

## license

MIT. © NosytLabs.
