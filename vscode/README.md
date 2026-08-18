# Hermes Pixel Office — VS Code Extension ☤

Watch your [Hermes](https://github.com/NousResearch/hermes-agent) agents work
as animated pixel characters in a tiny office, inside VS Code.

![live screenshot](screenshot-live.png)

Sessions walk in through the door and sit at desks. Subagents get gold
collars and their goal as a name tag. Characters type, read, browse, and run
terminals based on what the agent is actually doing. When an agent needs a
dangerous-command approval, its character throws up a red "!" bubble and the
header shows "N waiting!" — with an optional chime.

## Requirements

- [Hermes Agent](https://github.com/NousResearch/hermes-agent) with the
  [pixel-office plugin](https://github.com/teknium1/hermes-pixel-office)
  enabled:

  ```bash
  git clone https://github.com/teknium1/hermes-pixel-office ~/.hermes/plugins/pixel-office
  hermes plugins enable pixel-office
  ```

- VS Code 1.85+

## Use

1. Start any Hermes session (new process — plugins load at startup).
2. `Ctrl+Shift+P` → **Hermes: Open Pixel Office**.
3. The **+ agent** button in the office header opens a terminal running
   `hermes`.

## How it connects

```
hermes agents ──hooks──▶ pixel-office plugin ──HTTP 127.0.0.1:8113/state──▶ this panel
```

The extension host polls the plugin's `/state` endpoint with Node's `http`
(the webview itself needs no network access) and posts snapshots into the
canvas office. Visual only — it never sends anything to your agents.

**Remote/SSH:** works out of the box — the extension host runs where Hermes
runs, so `127.0.0.1` is correct on both ends.

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `hermesPixelOffice.stateUrl` | `http://127.0.0.1:8113/state` | Match `plugins.entries.pixel-office.port` if you changed it |
| `hermesPixelOffice.openOnStartup` | `false` | Auto-open the office when VS Code starts |

## Troubleshooting

- **"hermes office unreachable"** — the plugin's server isn't answering.
  Check that the plugin is enabled and a *fresh* Hermes session has run at
  least one tool, then `curl http://127.0.0.1:8113/state`. The plugin logs
  loud WARNINGs (`hermes logs --level warning`) when its port is squatted,
  including by stale VS Code port-forwards — a forward from a previous
  remote window can shadow your local server and swallow every request.
- Standalone mode (no VS Code): just open http://127.0.0.1:8113 in a
  browser.

## License

MIT
