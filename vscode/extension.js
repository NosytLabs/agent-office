"use strict";
/** One frontend, served by the observer. No duplicate renderer or polling loop. */
const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");
const { officeUrl, renderPanel } = require("./panel");
let panel = null;
async function refreshPanel(context, target) {
  try {
    const configured = vscode.workspace
      .getConfiguration("hermesPixelOffice")
      .get("stateUrl");
    const uri = await vscode.env.asExternalUri(
      vscode.Uri.parse(officeUrl(configured)),
    );
    if (panel !== target) return;
    target.webview.html = renderPanel(
      fs.readFileSync(
        path.join(context.extensionPath, "media", "office.html"),
        "utf8",
      ),
      uri.toString(),
    );
  } catch (error) {
    vscode.window.showErrorMessage("Agent Office: " + error.message);
  }
}
function openOffice(context) {
  if (panel) {
    panel.reveal();
    return;
  }
  panel = vscode.window.createWebviewPanel(
    "agentOffice",
    "Agent Office",
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  const current = panel;
  current.onDidDispose(() => {
    if (panel === current) panel = null;
  });
  refreshPanel(context, current);
}
function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("hermesPixelOffice.open", () =>
      openOffice(context),
    ),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (panel && event.affectsConfiguration("hermesPixelOffice.stateUrl"))
        refreshPanel(context, panel);
    }),
  );
  if (
    vscode.workspace.getConfiguration("hermesPixelOffice").get("openOnStartup")
  )
    openOffice(context);
}
function deactivate() {
  panel?.dispose();
  panel = null;
}
module.exports = { activate, deactivate };
