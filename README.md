# Agent Office

**Your coding agents, in good company.** A local pixel-art workspace for Hermes, OpenCode, Claude Code, and Telegram/CLI sessions.

Watch real tool activity, find sessions waiting for input, inspect subagents, and make the room your own. Agent Office is an **observer**: it never executes tasks, grants approval, or fabricates agent output.

![Agent Office showing six synthetic sessions in the studio](docs/screenshot.png)

## Start the office

Python 3.10+ is enough. The app has no third-party runtime dependencies, frontend build step, account, or API key.

```bash
git clone https://github.com/NosytLabs/agent-office.git
cd agent-office
python3 run.py
```

Open **[127.0.0.1:8113](http://127.0.0.1:8113)**. Keep the server running while using Claude Code or OpenCode. Hermes can also start the server from its plugin hooks.

To try the room without connecting an agent:

```bash
python3 demo_feed.py
```

Open **[127.0.0.1:8114](http://127.0.0.1:8114)**. The **DEMO** label means synthetic events. Every demo uses a temporary workspace, even if `HERMES_HOME` is set; it does not modify your real XP or event history. Ctrl+C stops it.

Both commands accept `--port 8120`. The server binds to loopback only.

## Connect your agents

```bash
python3 install.py
```

The installer detects existing runtime installations, adds this observer, and preserves other configuration. Restart the runtime after installation. Invalid configuration is reported without replacement.

| Integration | What it observes | Setup |
|---|---|---|
| Hermes | Sessions, tools, subagents, approval requests | Enables `pixel-office` through the Hermes plugin CLI |
| OpenCode | Session, tool, and permission events | Adds the local bridge to `~/.config/opencode/opencode.json` |
| Claude Code | Session/tool hooks, permissions, subagents | Adds hooks to `~/.claude/settings.json` |
| Telegram / CLI | Sessions emitted by Hermes with those platform labels | Configure the bridge in Hermes itself |
| VS Code | The same local web interface | Installs the local extension; run **Agent Office: Open Floor** |

For a custom data directory, set the same `HERMES_HOME` for the server and each agent runtime. The installer configures runtime files in their standard locations; it does not install the runtimes themselves. No message is sent to Telegram by this app.

## A room that reflects the work

- **Real activity:** working, thinking, waiting, idle, completed, and ended sessions. An approval bubble means you need to respond in the original runtime.
- **Agent inspection:** runtime, current tool, recent events, elapsed time, and parent session. Search keeps your cursor while the state refreshes.
- **Task overview:** sessions grouped by current status. This is an observed-work board, not a task dispatch engine.
- **Activity stream:** searchable recent events, with timestamps. Usage and CSV export report the events this observer has recorded.
- **A furnished scene:** corrected walk/read/type animations, matching object scale, low-contrast floors, and a generated furniture atlas.
- **Customization:** Plum, Midnight, and Amber palettes; automatic/day/night lighting; labels and decoration toggles; desk density.
- **Furniture placement:** add or remove sofas, servers, shelves, and plants in free floor space. Export and import your settings as JSON.
- **Camera controls:** zoom, drag when zoomed, reset to fit, pause motion, and download a scene snapshot. Reduced-motion preferences start the scene paused.
- **38 achievements:** earned/up-next views and real progress bars. Old retired achievements remain in saved history without losing XP.

### Unlocks

| Milestone | Visible reward |
|---|---|
| First session | Desk ferns |
| 10 sessions | Bullpen layout |
| Staff rank · 150 XP | Coffee mugs |
| Principal rank · 400 XP | Gold monitor trim |
| Distinguished rank · 1,200 XP | Crowns |
| 25 browsing tools | Lounge aquarium |
| 50 sessions | Sleeping cat on the sofa |
| 100 sessions + 50 tools | A second cat |
| 5 tool errors lifetime | Warm accent on the lounge lamp |

The room starts with a decorative cat. Pets and furnishing are ambience; they do not represent additional agents. XP is a playful event counter, not a measurement of work quality or task completion.

### Controls

Click an agent or choose one in **Agents**. Open **Customize → Place furniture**, select a prop, then click the floor; click a custom prop while placing to remove it. Escape finishes placement. Custom props use relative room positions; after changing desk density or viewport size, check their placement.

| Shortcut | Action |
|---|---|
| R / U | Agents and usage |
| B | Achievements |
| S / L | Customize |
| E | Activity stream |
| T / N | Cycle palette / lighting |
| ? | Help |
| Escape | Close panel / finish placing |

## Data and privacy

By default, files live in `~/.hermes/pixel-office/`: `events.jsonl`, `progress.json`, and `settings.json`. Events can contain command or file-path previews. The web app loads local assets and makes no analytics or model-provider requests. There is no hosted backend.

The server reads a bounded recent event log and returns the last 30 events. Quiet working/thinking sessions become idle after five minutes; sessions expire from the scene after 30 minutes. Ended sessions leave after 20 seconds and completed subagents after two minutes. The UI reconnects automatically; on disconnection it retains the last scene and labels it disconnected.

**Reset progress** requires confirmation and deletes recorded events, XP, and achievements. Room settings remain. Previously recorded data may be recreated as connected runtimes continue emitting events.

## Development and tests

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-dev.txt
python -m pytest -q

# Node 22+ is only required for bridge/frontend development checks.
npm ci
npm run check
npm test
npm run format:check
npx playwright install chromium --only-shell
npm run test:browser
```

The browser suite starts its own Python server and temporary data directory, writes representative event fixtures, and exercises the real HTTP routes, DOM controls, canvas, and asset loader. It does not call an LLM or modify runtime configurations. To use an existing Chrome installation, set `CHROMIUM_PATH` to its executable. Set `OFFICE_SCREENSHOTS=reports/screenshots` to save browser evidence.

CI runs once for pull requests and main-branch code changes, plus manual dispatch. It runs Python, Node, formatting, and browser checks in one bounded job; artifacts expire after three days. Documentation-only changes skip CI. The Ubuntu runner's maintained Chrome avoids redundant browser downloads.

See [the audit and screenshots](docs/audit/README.md), [architecture](docs/architecture.md), and [asset provenance](web/assets/sprites/ATTRIBUTION.md).

## Troubleshooting

- **Empty room:** start `run.py`, run `install.py`, restart the agent, and check that the server and runtime use the same `HERMES_HOME`. A standalone OpenCode/Claude hook records events but does not start an HTTP server.
- **Port occupied:** use `python3 run.py --port 8120`. For Hermes, configure `plugins.entries.pixel-office.port`. For VS Code, set `hermesPixelOffice.stateUrl` to the matching `/state` URL.
- **VS Code panel unavailable:** keep the local server running and reload the extension after reinstalling. Remote forwarding uses VS Code's `asExternalUri`; full extension-host testing is separate from browser tests.
- **Settings will not save:** the panel shows a failed-save message. Check that the local server is running and the data directory is writable.
- **Old room preferences:** removed paint/fog/area settings and invalid values are ignored. Existing supported settings and earned XP remain.
- **Small characters on a crowded floor:** increase desks per row or zoom in and drag. Use the Agents panel for full names and details.

## Credits and license

Inspired by [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents), [thepixeloffice.ai](https://thepixeloffice.ai/), and [Harish Kotra's AgentOffice](https://github.com/harishkotra/agent-office). The reference research and what was adopted are documented in the audit. This is an independent local observer, with no claim of feature parity or affiliation.

MIT; existing copyright notices are preserved in [LICENSE](LICENSE). Character/pet sources, furniture history, generated-art provenance, and third-party notices are in [ATTRIBUTION.md](web/assets/sprites/ATTRIBUTION.md).
