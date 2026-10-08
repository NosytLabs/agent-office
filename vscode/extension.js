"use strict";
/** One frontend, served by the observer. This shell never launches an agent. */
const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { officeUrl, stateUrl, renderPanel, probeOffice } = require("./panel");
let panel = null;
let connection = null;
let statusBar = null;
const configuration = () =>
  vscode.workspace.getConfiguration("hermesPixelOffice");
const isCurrent = (value) => panel === value.target && connection === value;

function updateStatusBar() {
  if (!statusBar) return;
  const phase = connection?.phase;
  statusBar.text = `${phase === "offline" || phase === "error" ? "$(debug-disconnect)" : "$(organization)"} Agent Office`;
  statusBar.tooltip = "Open Agent Office · observer connection and live floor";
  if (configuration().get("showStatusBar", true)) statusBar.show();
  else statusBar.hide();
}

function sendConnection(value) {
  if (!isCurrent(value)) return;
  return value.target.webview.postMessage({
    type: "office.connection",
    token: value.token,
    phase: value.phase,
    detail: value.detail,
  });
}

async function refreshPanel(context, target) {
  connection?.controller.abort();
  const value = {
    target,
    token: randomBytes(18).toString("hex"),
    controller: new AbortController(),
    phase: "connecting",
    detail: "Resolving the observer connection…",
  };
  connection = value;
  updateStatusBar();
  const template = fs.readFileSync(
    path.join(context.extensionPath, "media", "office.html"),
    "utf8",
  );
  target.webview.html = renderPanel(template, null, {
    nonce: value.token,
    ...value,
  });
  try {
    const configured = configuration().get("stateUrl");
    const endpoint = stateUrl(configured);
    const external = await vscode.env.asExternalUri(
      vscode.Uri.parse(officeUrl(configured)),
    );
    if (!isCurrent(value)) return;
    target.webview.html = renderPanel(template, external.toString(), {
      nonce: value.token,
      ...value,
    });
    const result = await probeOffice(endpoint, {
      signal: value.controller.signal,
    });
    if (!isCurrent(value) || result.phase === "cancelled") return;
    Object.assign(value, result);
    updateStatusBar();
    await sendConnection(value);
  } catch (error) {
    if (!isCurrent(value)) return;
    value.phase = "error";
    value.detail =
      error instanceof Error
        ? error.message
        : "Unable to resolve the observer URL. Check extension settings.";
    target.webview.html = renderPanel(template, null, {
      nonce: value.token,
      ...value,
    });
    updateStatusBar();
  }
}

async function openInBrowser() {
  try {
    const external = await vscode.env.asExternalUri(
      vscode.Uri.parse(officeUrl(configuration().get("stateUrl"))),
    );
    // Validate forwarding too; never accept a URL from a webview message.
    officeUrl(external.toString());
    await vscode.env.openExternal(external);
  } catch (error) {
    vscode.window.showErrorMessage("Agent Office: " + error.message);
  }
}

function attachPanel(context, current) {
  panel = current;
  current.onDidDispose(() => {
    if (panel !== current) return;
    connection?.controller.abort();
    connection = null;
    panel = null;
    updateStatusBar();
  });
  current.webview.onDidReceiveMessage((message) => {
    if (!connection || panel !== current || message?.token !== connection.token)
      return;
    switch (message.command) {
      case "ready":
        return sendConnection(connection);
      case "reload":
        return refreshPanel(context, current);
      case "openBrowser":
        return openInBrowser();
      case "settings":
        return vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "@ext:nosytlabs.agent-office",
        );
    }
  });
  return refreshPanel(context, current);
}

function openOffice(context, reload = false) {
  if (panel) {
    panel.reveal();
    if (reload || ["offline", "error"].includes(connection?.phase))
      return refreshPanel(context, panel);
    return;
  }
  return attachPanel(
    context,
    vscode.window.createWebviewPanel(
      "agentOffice",
      "Agent Office",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    ),
  );
}

function activate(context) {
  const handlers = {
    "hermesPixelOffice.open": () => openOffice(context),
    "hermesPixelOffice.reload": () => openOffice(context, true),
    "hermesPixelOffice.openInBrowser": openInBrowser,
    "hermesPixelOffice.settings": () =>
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "@ext:nosytlabs.agent-office",
      ),
  };
  for (const [name, handler] of Object.entries(handlers))
    context.subscriptions.push(vscode.commands.registerCommand(name, handler));
  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    10,
  );
  statusBar.name = "Agent Office";
  statusBar.command = "hermesPixelOffice.open";
  context.subscriptions.push(statusBar);
  updateStatusBar();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      updateStatusBar();
      if (panel && event.affectsConfiguration("hermesPixelOffice.stateUrl"))
        return refreshPanel(context, panel);
      if (
        event.affectsConfiguration("hermesPixelOffice.openOnStartup") &&
        configuration().get("openOnStartup")
      )
        return openOffice(context);
    }),
  );
  if (configuration().get("openOnStartup")) return openOffice(context);
}

function deactivate() {
  connection?.controller.abort();
  panel?.dispose();
  panel = null;
  connection = null;
  statusBar?.dispose();
  statusBar = null;
}
module.exports = { activate, deactivate };
