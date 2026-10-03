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
const STATUS_NAMES = {
  working: "Working",
  thinking: "Thinking",
  waiting: "Needs input",
  idle: "Idle",
  done: "Completed",
  gone: "Ended",
};
const EVENT_NAMES = {
  session_start: "Session started",
  session_end: "Session ended",
  session_busy: "Session working",
  session_idle: "Session idle",
  session_update: "Session updated",
  session_error: "Session error",
  tool_start: "Tool started",
  tool_end: "Tool finished",
  approval_request: "Approval requested",
  approval_response: "Approval answered",
  input_request: "Question asked",
  input_response: "Question answered",
  subagent_start: "Subagent started",
  subagent_stop: "Subagent completed",
};
const PROP_SIZES = {
  sofa: [40, 28],
  server: [20, 32],
  shelf: [34, 28],
  monstera: [26, 32],
  coffee: [20, 26],
  cooler: [12, 26],
  lamp: [12, 30],
  roundtable: [28, 24],
  stool: [16, 18],
  succulent: [12, 16],
  planter: [32, 18],
};
const PROP_NAMES = {
  sofa: "Sofa",
  server: "Server rack",
  shelf: "Bookcase",
  monstera: "Monstera",
  coffee: "Coffee cart",
  cooler: "Water cooler",
  lamp: "Floor lamp",
  roundtable: "Cafe table",
  stool: "Sage stool",
  succulent: "Succulent",
  planter: "Planter box",
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
// Saved positions are viewport-independent preferences. Resolve a display-only
// rectangle against this room's desks/decor without changing exported settings.
function resolveFurniture(items, grid, occupied) {
  const blocked = [...occupied],
    props = [];
  let relocated = 0,
    unplaced = 0,
    attempts = 0;
  for (const [index, item] of items.entries()) {
    const preferred = propBounds(item, grid),
      { w, h } = preferred;
    let bounds = null;
    const clear = (b) => !blocked.some((p) => overlapsRect(b, p));
    if (clear(preferred)) bounds = preferred;
    else {
      const axis = (key, size, low, high) =>
        [
          ...new Set(
            [
              preferred[key],
              low,
              high,
              ...blocked.flatMap((b) => [
                b[key] - size - 2,
                b[key] + b[key === "x" ? "w" : "h"] + 2,
              ]),
            ].filter((n) => n >= low && n <= high),
          ),
        ].sort(
          (a, b) =>
            Math.abs(a - preferred[key]) - Math.abs(b - preferred[key]) ||
            a - b,
        );
      const xs = axis("x", w, 7, grid.w - w - 7),
        ys = axis("y", h, 28, grid.h - h - 10),
        heap = [];
      const distance = (ix, iy) =>
        (xs[ix] - preferred.x) ** 2 + (ys[iy] - preferred.y) ** 2;
      const push = (node) => {
        heap.push(node);
        let i = heap.length - 1;
        while (i > 0) {
          const p = Math.floor((i - 1) / 2);
          if (heap[p].d <= node.d) break;
          heap[i] = heap[p];
          i = p;
        }
        heap[i] = node;
      };
      const pop = () => {
        const first = heap[0],
          last = heap.pop();
        if (heap.length) {
          let i = 0;
          while (i * 2 + 1 < heap.length) {
            let c = i * 2 + 1;
            if (c + 1 < heap.length && heap[c + 1].d < heap[c].d) c++;
            if (heap[c].d >= last.d) break;
            heap[i] = heap[c];
            i = c;
          }
          heap[i] = last;
        }
        return first;
      };
      if (ys.length)
        for (let ix = 0; ix < xs.length; ix++)
          push({ ix, iy: 0, d: distance(ix, 0) });
      for (let tried = 0; heap.length && tried < 2048; tried++) {
        const { ix, iy } = pop(),
          b = { x: xs[ix], y: ys[iy], w, h };
        attempts++;
        if (clear(b)) {
          bounds = b;
          break;
        }
        if (iy + 1 < ys.length)
          push({ ix, iy: iy + 1, d: distance(ix, iy + 1) });
      }
    }
    const moved =
      !!bounds && (bounds.x !== preferred.x || bounds.y !== preferred.y);
    if (moved) relocated++;
    if (bounds) blocked.push(bounds);
    else unplaced++;
    props.push({ index, kind: item.kind, bounds, relocated: moved });
  }
  return { props, relocated, unplaced, attempts };
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
function defaultDecor(grid, cosmetics = []) {
  const props = [
    { kind: "sofa", x: 23, y: grid.h - 51, w: 40, h: 28 },
    { kind: "coffee", x: 79, y: grid.h - 52, w: 20, h: 26 },
    { kind: "lamp", x: 64, y: grid.h - 58, w: 12, h: 30 },
    { kind: "shelf", x: grid.w - 52, y: grid.h - 42, w: 34, h: 28 },
    { kind: "monstera", x: grid.w - 33, y: 29, w: 22, h: 28 },
    { kind: "cooler", x: 11, y: 32, w: 12, h: 26 },
    { kind: "server", x: grid.w - 28, y: grid.h - 86, w: 17, h: 27 },
  ];
  if (grid.w >= 320)
    props.push(
      { kind: "roundtable", x: 111, y: grid.h - 40, w: 28, h: 24 },
      { kind: "stool", x: 145, y: grid.h - 29, w: 16, h: 18 },
    );
  if (cosmetics.includes("fish_tank"))
    props.push({
      kind: "FISH_TANK",
      x: grid.w - 85,
      y: grid.h - 33,
      w: 24,
      h: 18,
    });
  return props;
}
// Four-way breadth-first navigation for character feet. Inflated rectangles keep
// sprites clear of furniture; an unreachable desk gets a seated arrival instead.
function officePath(start, target, grid, occupied) {
  const step = 4,
    margin = 4;
  const inside = (p) =>
    p.x >= 10 && p.x <= grid.w - 10 && p.y >= 30 && p.y <= grid.h - 11;
  const clear = (p) =>
    inside(p) &&
    !occupied.some(
      (b) =>
        p.x > b.x - margin &&
        p.x < b.x + b.w + margin &&
        p.y > b.y - margin &&
        p.y < b.y + b.h + margin,
    );
  if (!clear(start) || !clear(target)) return null;
  // Anchor the lattice at the exact start, then join the goal only along a
  // short unobstructed segment. No diagonal corner cutting between grid cells.
  const segmentClear = (a, b) => {
    const d = Math.hypot(b.x - a.x, b.y - a.y),
      n = Math.max(1, Math.ceil(d));
    for (let i = 0; i <= n; i++)
      if (
        !clear({
          x: a.x + ((b.x - a.x) * i) / n,
          y: a.y + ((b.y - a.y) * i) / n,
        })
      )
        return false;
    return true;
  };
  const queue = [{ x: start.x, y: start.y, ix: 0, iy: 0, parent: -1 }],
    seen = new Set(["0,0"]);
  let goal = -1;
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head];
    if (
      Math.hypot(p.x - target.x, p.y - target.y) <= step * 1.5 &&
      segmentClear(p, target)
    ) {
      goal = head;
      break;
    }
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]) {
      const ix = p.ix + dx,
        iy = p.iy + dy;
      const q = {
          x: start.x + ix * step,
          y: start.y + iy * step,
          ix,
          iy,
          parent: head,
        },
        key = `${ix},${iy}`;
      if (!seen.has(key) && segmentClear(p, q)) {
        seen.add(key);
        queue.push(q);
      }
    }
  }
  if (goal < 0) return null;
  const path = [{ x: target.x, y: target.y }];
  for (let i = goal; i > 0; i = queue[i].parent)
    path.unshift({ x: queue[i].x, y: queue[i].y });
  return path;
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
