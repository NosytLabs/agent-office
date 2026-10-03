/* Shared presentation constants. No runtime state or side effects. */
"use strict";
const THEMES = [
  {
    id: "default",
    name: "Plum",
    floor: "#665861",
    plank: "#6d5f67",
    seam: "#544952",
    wall: "#a99aab",
    trim: "#716779",
    rug: "#4b5865",
    accent: "#d3ba8c",
  },
  {
    id: "midnight",
    name: "Midnight",
    floor: "#364c5e",
    plank: "#3c5364",
    seam: "#2d4254",
    wall: "#819daf",
    trim: "#536e82",
    rug: "#294452",
    accent: "#a6cfc6",
  },
  {
    id: "amber",
    name: "Amber",
    floor: "#876b50",
    plank: "#907357",
    seam: "#73593f",
    wall: "#c7b18d",
    trim: "#947e62",
    rug: "#53675c",
    accent: "#e6c489",
  },
];
const LAYOUTS = [
  { id: "open", name: "The studio", hint: "Open desks and a quiet corner." },
  {
    id: "bullpen",
    name: "The bullpen",
    hint: "Focused workstations. Unlock after 10 sessions.",
    require: "layout_bullpen",
  },
];
const DEFAULT_SETTINGS = Object.freeze({
  layout: "open",
  theme: "default",
  sound: false,
  max_chars: 4,
  ambience: "auto",
  show_labels: true,
  decorations: true,
  furniture: [],
});
const RANKS = [
  ["intern", 0],
  ["junior", 40],
  ["staff", 150],
  ["principal", 400],
  ["distinguished", 1200],
];
const STATUS_COLORS = {
  working: "#a7d9b1",
  thinking: "#e9c78a",
  waiting: "#f5a493",
  idle: "#a8b7c6",
  done: "#b6b0e5",
  gone: "#8c98a2",
};
const PROP_SIZES = {
  sofa: [40, 28],
  server: [20, 32],
  shelf: [34, 28],
  monstera: [26, 32],
  coffee: [20, 26],
  cooler: [12, 26],
  lamp: [12, 30],
};
const PROP_NAMES = {
  sofa: "Sofa",
  server: "Server rack",
  shelf: "Bookcase",
  monstera: "Monstera",
  coffee: "Coffee cart",
  cooler: "Water cooler",
  lamp: "Floor lamp",
};
function propBounds(item, grid) {
  const [w, h] = PROP_SIZES[item.kind];
  return {
    x: Math.max(7, Math.min(grid.w - w - 7, item.x * grid.w - w / 2)),
    y: Math.max(28, Math.min(grid.h - h - 10, item.y * grid.h - h)),
    w,
    h,
  };
}
function overlapsRect(a, b, gap = 2) {
  return (
    a.x < b.x + b.w + gap &&
    a.x + a.w + gap > b.x &&
    a.y < b.y + b.h + gap &&
    a.y + a.h + gap > b.y
  );
}
function placementAt(kind, point, grid, occupied, items) {
  const [w, h] = PROP_SIZES[kind];
  const bounds = { x: point.x - w / 2, y: point.y - h, w, h };
  const item = { kind, x: point.x / grid.w, y: point.y / grid.h };
  const inside =
    bounds.x >= 7 &&
    bounds.x + w <= grid.w - 7 &&
    bounds.y >= 28 &&
    point.y <= grid.h - 10;
  const blocked = [...occupied, ...items.map((p) => propBounds(p, grid))].some(
    (b) => overlapsRect(bounds, b),
  );
  return { valid: inside && !blocked && items.length < 24, bounds, item };
}
function defaultDecor(grid) {
  return [
    { kind: "sofa", x: 23, y: grid.h - 51, w: 40, h: 28 },
    { kind: "coffee", x: 79, y: grid.h - 52, w: 20, h: 26 },
    { kind: "lamp", x: 64, y: grid.h - 58, w: 12, h: 30 },
    { kind: "shelf", x: grid.w - 52, y: grid.h - 42, w: 34, h: 28 },
    { kind: "monstera", x: grid.w - 33, y: 29, w: 22, h: 28 },
    { kind: "cooler", x: 11, y: 32, w: 12, h: 26 },
    { kind: "server", x: grid.w - 28, y: grid.h - 86, w: 17, h: 27 },
  ];
}
function hash(text) {
  let h = 0;
  for (const c of String(text)) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0;
  return h >>> 0;
}
function platOf(a) {
  const p = String(a.platform || "").toLowerCase();
  if (p.includes("claude")) return "claude";
  return ["opencode", "telegram", "cli"].includes(p) ? p : "hermes";
}
function isNight(settings) {
  const h = new Date().getHours();
  return (
    settings.ambience === "night" ||
    (settings.ambience === "auto" && (h < 6 || h >= 19))
  );
}
// The source atlas has 3 walk columns, 2 typing columns, and 2 reading
// columns per direction. Left-facing frames mirror the right-facing row.
function characterFrame(agent, character, time) {
  if (character.moving)
    return [0, 1, 2, 1][Math.floor(character.distance / 3) % 4];
  if (agent.status !== "working") return 0;
  const reading =
    agent.activity === "reading" ||
    agent.activity === "browsing" ||
    /read|search|grep|glob|fetch|browse/i.test(agent.tool || "");
  return (reading ? 5 : 3) + (Math.floor(time * 3) % 2);
}
function normalizeSettings(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const valid = {};
  const choices = {
    layout: ["open", "bullpen"],
    theme: THEMES.map((t) => t.id),
    ambience: ["auto", "day", "night"],
  };
  for (const [key, value] of Object.entries(data)) {
    if (choices[key]?.includes(value)) valid[key] = value;
    else if (
      ["sound", "show_labels", "decorations"].includes(key) &&
      typeof value === "boolean"
    )
      valid[key] = value;
    else if (
      key === "max_chars" &&
      Number.isInteger(value) &&
      value >= 2 &&
      value <= 8
    )
      valid[key] = value;
    else if (
      key === "furniture" &&
      Array.isArray(value) &&
      value.length <= 24 &&
      value.every(
        (p) =>
          p &&
          Object.hasOwn(PROP_SIZES, p.kind) &&
          ["x", "y"].every(
            (k) => Number.isFinite(p[k]) && p[k] >= 0 && p[k] <= 1,
          ),
      )
    )
      valid[key] = value.map((p) => ({ kind: p.kind, x: p.x, y: p.y }));
  }
  return valid;
}
