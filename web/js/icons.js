/* Selected Lucide 1.51.0 icons. ISC / MIT notices: assets/icons/LICENSE.txt. */
"use strict";
const ICON_PATHS = Object.freeze({
  move: '<path d="M12 2v20" />\n  <path d="m15 19-3 3-3-3" />\n  <path d="m19 9 3 3-3 3" />\n  <path d="M2 12h20" />\n  <path d="m5 9-3 3 3 3" />\n  <path d="m9 5 3-3 3 3" />',
  "redo-2":
    '<path d="m15 14 5-5-5-5" />\n  <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13" />',
  gift: '<path d="M12 7v14" />\n  <path d="M20 11v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8" />\n  <path d="M7.5 7a1 1 0 0 1 0-5A4.8 8 0 0 1 12 7a4.8 8 0 0 1 4.5-5 1 1 0 0 1 0 5" />\n  <rect x="3" y="7" width="18" height="4" rx="1" />',

  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />\n  <path d="M16 3.128a4 4 0 0 1 0 7.744" />\n  <path d="M22 21v-2a4 4 0 0 0-3-3.87" />\n  <circle cx="9" cy="7" r="4" />',
  "list-checks":
    '<path d="M13 5h8" />\n  <path d="M13 12h8" />\n  <path d="M13 19h8" />\n  <path d="m3 17 2 2 4-4" />\n  <path d="m3 7 2 2 4-4" />',
  activity:
    '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />',
  trophy:
    '<path d="M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2" />\n  <path d="M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2" />\n  <path d="M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3" />\n  <path d="M4 22h16" />\n  <path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z" />\n  <path d="M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3" />',
  "sliders-horizontal":
    '<path d="M10 5H3" />\n  <path d="M12 19H3" />\n  <path d="M14 3v4" />\n  <path d="M16 17v4" />\n  <path d="M21 12h-9" />\n  <path d="M21 19h-5" />\n  <path d="M21 5h-7" />\n  <path d="M8 10v4" />\n  <path d="M8 12H3" />',
  "circle-help":
    '<circle cx="12" cy="12" r="10" />\n  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />\n  <path d="M12 17h.01" />',
  "volume-2":
    '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />\n  <path d="M16 9a5 5 0 0 1 0 6" />\n  <path d="M19.364 18.364a9 9 0 0 0 0-12.728" />',
  "volume-x":
    '<path d="M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298z" />\n  <path d="m16.5 14.5 5-5" />\n  <path d="m16.5 9.5 5 5" />',
  palette:
    '<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" />\n  <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />\n  <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />\n  <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />\n  <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />',
  minus: '<path d="M5 12h14" />',
  plus: '<path d="M5 12h14" />\n  <path d="M12 5v14" />',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2" />\n  <path d="M17 3h2a2 2 0 0 1 2 2v2" />\n  <path d="M21 17v2a2 2 0 0 1-2 2h-2" />\n  <path d="M7 21H5a2 2 0 0 1-2-2v-2" />',
  pause:
    '<rect x="14" y="3" width="5" height="18" rx="1" />\n  <rect x="5" y="3" width="5" height="18" rx="1" />',
  play: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />',
  camera:
    '<path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z" />\n  <circle cx="12" cy="13" r="3" />',
  x: '<path d="M18 6 6 18" />\n  <path d="m6 6 12 12" />',
  "undo-2":
    '<path d="M9 14 4 9l5-5" />\n  <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />',
  check: '<path d="M20 6 9 17l-5-5" />',
  "trash-2":
    '<path d="M10 11v6" />\n  <path d="M14 11v6" />\n  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />\n  <path d="M3 6h18" />\n  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />',
  "building-2":
    '<path d="M10 12h4" />\n  <path d="M10 8h4" />\n  <path d="M14 21v-3a2 2 0 0 0-4 0v3" />\n  <path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2" />\n  <path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />',
  download:
    '<path d="M12 15V3" />\n  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />\n  <path d="m7 10 5 5 5-5" />',
});
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("icon");
  svg.innerHTML = ICON_PATHS[name] || ICON_PATHS["circle-help"];
  return svg;
}
function labelButton(button, name, label) {
  const span = document.createElement("span");
  span.className = "button-label";
  span.textContent = label;
  button.replaceChildren(icon(name), span);
}
