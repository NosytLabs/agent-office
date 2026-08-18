"use strict";
/** Agent Office — VS Code panel. Polls /state, never talks back to agents. */
const vscode = require("vscode");
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

let panel = null;
let timer = null;

function fetchState(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { timeout: 3000 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

function startPolling() {
  stopPolling();
  const tick = async () => {
    if (!panel) return;
    const url = vscode.workspace.getConfiguration("hermesPixelOffice").get("stateUrl");
    try {
      panel.webview.postMessage({ type: "state", state: await fetchState(url) });
    } catch (e) {
      panel.webview.postMessage({ type: "offline", url, error: String(e && e.message ? e.message : e) });
    }
  };
  timer = setInterval(tick, 1500);
  tick();
}

function stopPolling() {
  if (timer) { clearInterval(timer); timer = null; }
}

function openOffice(context) {
  if (panel) { panel.reveal(); return; }
  panel = vscode.window.createWebviewPanel(
    "agentOffice",
    "Agent Office",
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  const htmlPath = path.join(context.extensionPath, "media", "office.html");
  panel.webview.html = fs.readFileSync(htmlPath, "utf8");
  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg && msg.type === "spawnAgent") {
      const pick = await vscode.window.showQuickPick(
        [
          { label: "hermes", description: "Hermes CLI" },
          { label: "opencode", description: "OpenCode" },
          { label: "claude", description: "Claude Code" },
        ],
        { placeHolder: "which runtime?" }
      );
      if (!pick) return;
      const term = vscode.window.createTerminal({ name: pick.label });
      term.show(false);
      term.sendText(pick.label, true);
    }
  });
  panel.onDidDispose(() => { panel = null; stopPolling(); });
  startPolling();
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("hermesPixelOffice.open", () => openOffice(context))
  );
  if (vscode.workspace.getConfiguration("hermesPixelOffice").get("openOnStartup")) {
    openOffice(context);
  }
}

function deactivate() { stopPolling(); }

module.exports = { activate, deactivate };
