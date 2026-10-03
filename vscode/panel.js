"use strict";
function officeUrl(value) {
  const url = new URL(value || "http://127.0.0.1:8113/state");
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("stateUrl must use HTTP or HTTPS");
  url.pathname = url.pathname.replace(/\/state\/?$/, "/");
  url.search = "";
  url.hash = "";
  return url.href;
}
function renderPanel(template, uri) {
  const url = new URL(uri);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Office URL must use HTTP or HTTPS");
  const escape = (s) =>
    s.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  return template
    .replaceAll("{{OFFICE_URL}}", escape(url.href))
    .replaceAll("{{OFFICE_ORIGIN}}", escape(url.origin));
}
module.exports = { officeUrl, renderPanel };
