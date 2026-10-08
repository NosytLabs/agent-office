"use strict";
const http = require("node:http");
const https = require("node:https");
const { randomBytes } = require("node:crypto");

function httpUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("The observer URL must use HTTP or HTTPS.");
  if (url.username || url.password)
    throw new Error(
      "Use an observer URL without embedded usernames or passwords.",
    );
  url.hash = "";
  return url;
}

function officeUrl(value) {
  const url = httpUrl(value || "http://127.0.0.1:8113/state");
  url.pathname = url.pathname.replace(/\/state\/?$/, "/");
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}

function stateUrl(value) {
  const url = new URL(officeUrl(value));
  url.pathname += "state";
  return url.href;
}

const LABELS = {
  connecting: "Checking observer…",
  online: "Observer reachable",
  offline: "Observer offline",
  unverified: "Check connection",
  error: "Check connection settings",
};

function renderPanel(template, uri, options = {}) {
  const url = uri ? httpUrl(uri) : null;
  const nonce = options.nonce || randomBytes(18).toString("hex");
  if (!/^[A-Za-z0-9+/_-]{16,}$/.test(nonce))
    throw new Error("Invalid webview nonce");
  const phase = Object.hasOwn(LABELS, options.phase)
    ? options.phase
    : "connecting";
  const escape = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  const frame = url
    ? `<iframe src="${escape(url.href)}" title="Live Agent Office" referrerpolicy="no-referrer" allow="clipboard-write" sandbox="allow-scripts allow-same-origin allow-downloads allow-modals allow-popups"></iframe>`
    : "";
  const values = {
    NONCE: nonce,
    OFFICE_ORIGIN: url ? escape(url.origin) : "'none'",
    OFFICE_FRAME: frame,
    DISPLAY_URL: escape(
      url ? url.origin + url.pathname : "Observer URL in extension settings",
    ),
    CONNECTION_PHASE: phase,
    CONNECTION_LABEL: LABELS[phase],
    CONNECTION_DETAIL: escape(
      options.detail ||
        "Connecting to the configured observer. Runtime activity appears inside the floor.",
    ),
  };
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
    if (!Object.hasOwn(values, key))
      throw new Error("Unknown panel template field");
    return values[key];
  });
}

/** A single bounded check on open/reload. The iframe owns ongoing polling. */
function probeOffice(
  value,
  { signal, timeoutMs = 3000, maxBytes = 2 * 1024 * 1024 } = {},
) {
  const url = httpUrl(stateUrl(value));
  if (signal?.aborted) return Promise.resolve({ phase: "cancelled" });
  return new Promise((resolve) => {
    let finished = false;
    let request;
    const finish = (phase, detail) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      request?.destroy();
      resolve({ phase, detail });
    };
    const abort = () => finish("cancelled");
    const timer = setTimeout(
      () =>
        finish(
          "offline",
          "No response before the connection check timed out. Start the observer or check its URL, then retry.",
        ),
      timeoutMs,
    );
    signal?.addEventListener("abort", abort, { once: true });
    const transport = url.protocol === "https:" ? https : http;
    request = transport.get(
      url,
      { headers: { Accept: "application/json" } },
      (response) => {
        if (response.statusCode !== 200) {
          finish(
            "unverified",
            `The endpoint returned HTTP ${response.statusCode}. Check the URL; a forwarded server may need browser authentication.`,
          );
          return;
        }
        let bytes = 0;
        const chunks = [];
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > maxBytes) {
            finish(
              "unverified",
              "The endpoint responded, but its state exceeds the connection check limit. The floor can still load below.",
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", () =>
          finish(
            "offline",
            "The observer disconnected during the connection check. Retry when it is running.",
          ),
        );
        response.on("end", () => {
          if (finished) return;
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (
              !data ||
              !Array.isArray(data.agents) ||
              !Array.isArray(data.events) ||
              !data.stats ||
              typeof data.stats !== "object" ||
              Array.isArray(data.stats)
            )
              throw new Error("Unexpected endpoint");
            finish(
              "online",
              "Observer state verified. The floor shows live runtime activity and connection changes.",
            );
          } catch {
            finish(
              "unverified",
              "The endpoint responded but did not provide Agent Office state. Set the URL to the observer's /state endpoint.",
            );
          }
        });
      },
    );
    request.on("error", () =>
      finish(
        "offline",
        "The observer could not be reached. Start it on the extension host, check its URL, then retry.",
      ),
    );
  });
}

module.exports = { officeUrl, stateUrl, renderPanel, probeOffice };
