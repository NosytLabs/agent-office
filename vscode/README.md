# Agent Office for VS Code

Open the same local Agent Office in a VS Code panel.

1. From the repository, run `python3 install.py` with VS Code installed.
2. Reload the VS Code window.
3. Keep `python3 run.py` running (or use Hermes's observer server).
4. Run **Agent Office: Open Floor** from the Command Palette.

`hermesPixelOffice.stateUrl` defaults to `http://127.0.0.1:8113/state`.
Set it to a different port or forwarded endpoint as needed. The extension
resolves the office URL through `vscode.env.asExternalUri`, then embeds the
frontend in an iframe. Settings changes reload that iframe. It has no
second renderer, extra polling loop, or terminal-launch button.

Set `hermesPixelOffice.openOnStartup` to open the panel automatically.
The demo runs on port 8114; use `http://127.0.0.1:8114/state` to view it.

[Repository and setup guide](https://github.com/NosytLabs/agent-office)
