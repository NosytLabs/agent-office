# Agent Office for VS Code

Open your live local Agent Office beside your code. The extension embeds the
same office frontend, including runtime activity, usage reports, layout
editing, and earned rewards. It observes existing runtimes; it does not start
agents, submit prompts, or approve their tools.

1. From the repository, run `python3 install.py` with VS Code installed.
2. Reload the VS Code window.
3. Keep `python3 run.py` running (or use Hermes's observer server).
4. Run **Agent Office: Open Floor** from the Command Palette.

## Commands and connection recovery

The status-bar **Agent Office** shortcut opens the floor. The Command Palette
also provides **Agent Office: Reload Connection**, **Open in Browser**, and
**Connection Settings**. The panel has matching buttons.

Each open/reload performs one bounded `/state` check. A reachable observer is
different from a connected agent: runtime activity is reported by the floor.
An offline panel explains how to start the observer and lets you retry without
closing it. HTTP authentication, unexpected endpoint content, and large state
responses are shown as unverified so the browser can still try loading the
floor. The shared frontend owns subsequent polling and offline indicators;
the extension does not maintain a second polling loop.

Changing `hermesPixelOffice.stateUrl` reloads the existing panel immediately.
Old connection attempts cannot overwrite newer settings, and closing the
panel cancels its pending check. Opening an already-connected panel preserves
its current floor; **Reload Connection** explicitly reloads it.

## Settings and remote environments

`hermesPixelOffice.stateUrl` defaults to `http://127.0.0.1:8113/state`.
Set it to a different port or forwarded endpoint as needed. HTTP and HTTPS,
IPv4/IPv6 loopback, proxy paths, and forwarding query parameters are supported.
Do not put usernames/passwords in the URL. Query parameters are kept for
forwarding but are not displayed in the panel footer.

The extension runs on the workspace host. With SSH, WSL, or Dev Containers,
install it into that environment and run Agent Office there. It resolves the
office URL through VS Code's
[`env.asExternalUri`](https://code.visualstudio.com/api/advanced-topics/remote-extensions)
before embedding or opening it. A forwarded authentication page may need
**Open in Browser**. A pure browser editor without a Node extension host is
not supported by this package.

The connection shell uses a nonce-based content policy and grants no webview
access to workspace files. Only its fixed reload/browser/settings actions
reach the extension. Workspace-specific URL/startup settings require workspace
trust; user-level settings remain available.

Set `hermesPixelOffice.openOnStartup` to open the panel automatically.
Disable `hermesPixelOffice.showStatusBar` to hide the shortcut.
The demo runs on port 8114; use `http://127.0.0.1:8114/state` to view it.

## Build and install a VSIX

With Node.js 22+ and npm available, from this directory run:

```sh
npm run package
code --install-extension agent-office-0.5.0.vsix
```

The packaging command uses the pinned official `@vscode/vsce` tool. Its first
run downloads that development tool; the extension itself has no runtime npm
dependencies. You can also use **Extensions: Install from VSIX…** in VS Code.
The package contains the extension entry point, URL/connection helpers, panel
HTML, this guide, its manifest, and the MIT license.

To develop locally, open this repository in VS Code and launch an extension
development host with `--extensionDevelopmentPath=/absolute/path/to/agent-office/vscode`.
The repository's `node --test tests/vscode-panel.test.cjs` checks URL handling,
real local HTTP checks, race cancellation, and command boundaries. These
checks do not substitute for a real VS Code extension host. On 8 October 2026,
the official `@vscode/vsce` 4.0.0 command successfully packaged the extension
with no runtime npm dependencies. The audit environment had no VS Code binary;
the official test-host download timed out and its display prerequisite could
not be installed. Actual host activation, installation, and remote forwarding
remain user-environment integration checks.

[Repository and setup guide](https://github.com/NosytLabs/agent-office)
