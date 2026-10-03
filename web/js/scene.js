/* Canvas scene. All agent activity comes from the observer state; props are decorative. */
"use strict";
class OfficeScene {
  constructor(canvas, onSelect, onPlace) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onSelect = onSelect;
    this.onPlace = onPlace;
    this.agents = [];
    this.settings = { ...DEFAULT_SETTINGS };
    this.cosmetics = [];
    this.sprites = {};
    this.chars = new Map();
    this.assetErrors = [];
    this.loadedAssets = 0;
    this.focus = null;
    this.filter = "every";
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.paused = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.time = 0;
    this.last = 0;
    this.edit = null;
    this.hitBoxes = [];
    this.loadAssets();
    this.bindInput();
    this.resize = new ResizeObserver(() => {
      this.pan = { x: 0, y: 0 };
      this.draw(0);
    });
    this.resize.observe(canvas);
    this.frame = requestAnimationFrame((t) => this.tick(t));
  }
  loadAssets() {
    const load = (key, src, ready) => {
      const im = new Image();
      im.onload = () => {
        this.loadedAssets++;
        this.sprites[key] = im;
        if (ready) ready(im);
      };
      im.onerror = () => this.assetErrors.push(src);
      im.src = "assets/sprites/" + src;
    };
    for (let i = 0; i < 6; i++)
      load("char" + i, "characters/char_" + i + ".png", (im) => {
        if (im.width !== 112 || im.height !== 96)
          this.assetErrors.push("Invalid character dimensions: " + i);
      });
    for (const n of ["DOOR", "FISH_TANK"]) load(n, "furniture/" + n + ".png");
    load("cat", "pets/claudio.png");
    load("blackcat", "pets/gitcat.png");
    load("sleepcat", "pets/sleep_cat.png");
    for (const [atlas, cells] of [
      ["studio", ["sofa", "server", "shelf", "monstera"]],
      ["utilities", ["coffee", "cooler", "lamp", "clock"]],
    ])
      load(atlas, "furniture/" + atlas + "-atlas.png", (im) => {
        // Extract each atlas quadrant once, trim transparent padding, then normalize
        // to logical pixel dimensions. Generated imagery never drives collision math.
        for (const [i, key] of cells.entries()) {
          const w = Math.floor(im.width / 2),
            h = Math.floor(im.height / 2),
            c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          const g = c.getContext("2d", { willReadFrequently: true });
          g.drawImage(im, (i % 2) * w, Math.floor(i / 2) * h, w, h, 0, 0, w, h);
          const d = g.getImageData(0, 0, w, h).data;
          let x0 = w,
            y0 = h,
            x1 = 0,
            y1 = 0;
          for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++)
              if (d[(y * w + x) * 4 + 3] > 32) {
                x0 = Math.min(x0, x);
                x1 = Math.max(x1, x);
                y0 = Math.min(y0, y);
                y1 = Math.max(y1, y);
              }
          if (x0 > x1) {
            this.assetErrors.push("Empty atlas cell: " + key);
            continue;
          }
          const normalized = document.createElement("canvas");
          [normalized.width, normalized.height] = PROP_SIZES[key] || [10, 10];
          const ng = normalized.getContext("2d");
          ng.imageSmoothingEnabled = false;
          ng.drawImage(
            c,
            x0,
            y0,
            x1 - x0 + 1,
            y1 - y0 + 1,
            0,
            0,
            normalized.width,
            normalized.height,
          );
          this.sprites[key] = normalized;
        }
        this.canvas.dispatchEvent(new Event("spritesready"));
      });
  }
  update(agents, settings, progress, focus, filter) {
    this.agents = agents;
    this.settings = settings;
    this.cosmetics = progress?.cosmetics || [];
    this.focus = focus;
    this.filter = filter;
  }
  list() {
    return this.agents.filter(
      (a) => this.filter === "every" || platOf(a) === this.filter,
    );
  }
  layout(width) {
    const list = this.list(),
      max = width < 600 ? 2 : this.settings.max_chars;
    const columns = Math.max(1, Math.min(max, Math.max(2, list.length)));
    const rows = Math.max(1, Math.ceil(list.length / columns));
    const w = Math.max(width < 600 ? 210 : 320, columns * 68 + 72),
      h = Math.max(238, rows * 76 + 110);
    const start = (w - ((columns - 1) * 68 + 40)) / 2;
    const seats = list.map((a, i) => ({
      a,
      x: start + (i % columns) * 68,
      y: 60 + Math.floor(i / columns) * 76,
    }));
    return { w, h, seats, columns, rows };
  }
  tick(t) {
    const dt = Math.min(0.05, (t - (this.last || t)) / 1000);
    this.last = t;
    if (
      !document.hidden &&
      t - (this.painted || 0) >= 1000 / (this.paused ? 8 : 30)
    ) {
      const elapsed = Math.min(0.1, (t - (this.painted || t)) / 1000);
      this.painted = t;
      if (!this.paused) this.time += elapsed;
      this.draw(this.paused ? 0 : elapsed || dt);
    }
    this.frame = requestAnimationFrame((n) => this.tick(n));
  }
  rect(x, y, w, h, color) {
    const g = this.ctx;
    g.fillStyle = color;
    g.fillRect(Math.round(x), Math.round(y), w, h);
  }
  text(text, x, y, color, size = 4, align = "left") {
    const g = this.ctx;
    g.fillStyle = color;
    g.font = size + "px ui-monospace,monospace";
    g.textAlign = align;
    g.fillText(text, x, y);
  }
  image(key, x, y, w, h) {
    const im = this.sprites[key];
    if (!im) return false;
    this.ctx.drawImage(im, Math.round(x), Math.round(y), w, h);
    return true;
  }
  shadow(x, y, w) {
    this.rect(x + 2, y, w - 4, 2, "#10182745");
  }
  room(g) {
    const { w, h } = g,
      t = THEMES.find((x) => x.id === this.settings.theme) || THEMES[0],
      r = this.rect.bind(this),
      dark = isNight(this.settings);
    r(4, 7, w, h, "#070a1255");
    r(0, 0, w, h, t.trim);
    r(3, 3, w - 6, h - 6, t.floor);
    // Low-contrast staggered timber boards, instead of the old checkerboard.
    for (let y = 28; y < h - 6; y += 7) {
      r(4, y, w - 8, 6, Math.round(y / 7) % 2 ? t.plank : t.floor);
      r(4, y + 6, w - 8, 1, t.seam);
      for (let x = (Math.round(y / 7) % 2) * 18 + 4; x < w - 4; x += 36)
        r(x, y, 1, 6, t.seam);
    }
    r(3, 3, w - 6, 23, t.wall);
    r(3, 24, w - 6, 3, t.trim);
    r(3, 27, w - 6, 2, "#15182430");
    this.image("DOOR", 12, 5, 14, 23);
    this.image("clock", 34, 8, 10, 10);
    for (const x of [w * 0.29, w * 0.69]) {
      r(x, 6, 40, 17, t.trim);
      r(x + 2, 7, 36, 14, dark ? "#243854" : "#b5d4db");
      r(x + 4, 8, 2, 10, dark ? "#67768c" : "#d8e9e6");
      r(x + 19, 7, 2, 14, t.trim);
      r(x, 22, 40, 2, t.trim);
      if (dark) {
        r(x + 9, 10, 1, 1, "#e8cf93");
        r(x + 29, 9, 1, 1, "#e8cf93");
      } else {
        r(x + 23, 10, 8, 1, "#e6f0e8");
      }
    }
    r(w / 2 - 20, 7, 40, 14, "#26313a");
    this.text("AGENT OFFICE", w / 2, 16, "#e9d4a4", 4, "center");
    r(4, h - 8, w - 8, 4, t.trim);
    r(4, 28, 2, h - 36, t.trim);
    r(w - 6, 28, 2, h - 36, t.trim);
    if (this.settings.decorations) {
      // Break area remains separate from the desk rows at every viewport.
      const by = h - 46;
      r(18, by - 10, 85, 42, t.rug);
      r(21, by - 7, 79, 1, t.accent);
      r(21, by + 28, 79, 1, t.accent);
      for (const p of defaultDecor(g)) this.image(p.kind, p.x, p.y, p.w, p.h);
      if (this.cosmetics.includes("fish_tank"))
        this.image("FISH_TANK", w - 85, h - 33, 24, 18);
      this.pet(58, h - 20);
      if (this.cosmetics.includes("office_cat"))
        this.image("sleepcat", 34, h - 36, 18, 12);
      if (this.cosmetics.includes("storm_lamp"))
        this.rect(68, h - 54, 4, 2, "#efb481");
      if (this.cosmetics.includes("gitcat")) this.pet(w - 68, h - 21, true);
    }
    for (const item of this.settings.furniture || []) {
      const b = propBounds(item, g);
      this.image(item.kind, b.x, b.y, b.w, b.h);
    }
    if (dark) {
      r(3, 3, w - 6, h - 6, "#111d3a35");
    }
  }
  pet(x, y, black = false) {
    const sheet = this.sprites[black ? "blackcat" : "cat"];
    if (!sheet) return;
    const bounce = this.petUntil > this.time ? Math.sin(this.time * 16) * 2 : 0;
    this.ctx.drawImage(sheet, 0, 0, 16, 32, x, y - 18 + bounce, 10, 20);
    if (this.petUntil > this.time)
      this.text("♥", x + 4, y - 19, "#ecad98", 6, "center");
    this.petHit = { x: x - 3, y: y - 17, w: 17, h: 24 };
  }
  desk(s) {
    const { x, y, a } = s,
      g = this.ctx,
      r = this.rect.bind(this),
      t = THEMES.find((t) => t.id === this.settings.theme) || THEMES[0];
    if (this.settings.layout === "bullpen") {
      r(x - 3, y - 12, 46, 2, t.trim);
      r(x - 4, y - 12, 2, 36, t.trim);
    }
    this.shadow(x, y + 21, 42);
    r(x + 3, y + 10, 3, 11, "#453b3b");
    r(x + 34, y + 10, 3, 11, "#453b3b");
    // Chair and backrest precede the character; desktop occludes the legs.
    r(x + 9, y - 3, 14, 13, "#303a43");
    r(x + 11, y - 5, 10, 3, "#596570");
    r(x + 10, y + 10, 12, 3, "#26313a");
    const target = { x: x + 8, y: y - 17 };
    let c = this.chars.get(a.id);
    if (!c) {
      c = {
        x: 12,
        y: 12,
        distance: 0,
        path: [
          { x: 12, y: target.y - 16 },
          { x: target.x, y: target.y - 16 },
          target,
        ],
      };
      this.chars.set(a.id, c);
    }
    if (this.paused || this.relayout) {
      c.x = target.x;
      c.y = target.y;
      c.path = [];
      c.moving = false;
    }
    const waypoint = c.path?.[0];
    if (waypoint) {
      const dx = waypoint.x - c.x,
        dy = waypoint.y - c.y,
        d = Math.hypot(dx, dy);
      if (d < 1) {
        c.x = waypoint.x;
        c.y = waypoint.y;
        c.path.shift();
        c.moving = c.path.length > 0;
      } else {
        const step = Math.min(d, 70 * this.dt);
        c.x += (dx / d) * step;
        c.y += (dy / d) * step;
        c.distance += step;
        c.moving = true;
        c.dir =
          Math.abs(dx) > Math.abs(dy)
            ? dx < 0
              ? "left"
              : "right"
            : dy < 0
              ? "up"
              : "down";
      }
    } else {
      c.x = target.x;
      c.y = target.y;
      c.moving = false;
    }
    // Characters at the station always use the idle frame; moving sprites use
    // distance travelled, not refresh rate, for the four-frame walk cycle.
    if (!c.moving) this.character(a, c.x, c.y, c);
    r(x, y + 7, 40, 2, "#d6b17b");
    r(x, y + 9, 40, 8, "#b18b63");
    r(x, y + 17, 40, 3, "#795b4b");
    r(x + 1, y + 10, 38, 1, "#c39a6b");
    r(x + 9, y + 8, 13, 4, "#343c46");
    r(x + 10, y + 9, 10, 1, "#829091");
    r(x + 25, y + 10, 3, 3, "#ded6bb");
    r(x + 25, y - 6, 13, 13, "#23313c");
    r(x + 26, y - 5, 11, 10, "#19292e");
    r(x + 29, y + 7, 5, 2, "#34414a");
    const col = STATUS_COLORS[a.status] || STATUS_COLORS.idle;
    const active = a.status === "working";
    r(x + 27, y - 3, 7, 1, col);
    r(x + 27, y, 5, 1, active ? "#9dcab7" : "#506566");
    r(
      x + 27,
      y + 2,
      active ? (Math.floor(this.time * 3) % 3) + 3 : 3,
      1,
      "#6c9d94",
    );
    if (this.cosmetics.includes("gold_monitor"))
      r(x + 25, y - 6, 13, 1, "#d8b56d");
    if (this.cosmetics.includes("mug")) {
      r(x + 3, y + 7, 3, 4, "#dbb794");
      r(x + 6, y + 8, 1, 2, "#dbb794");
    }
    if (this.cosmetics.includes("fern")) {
      r(x + 1, y + 4, 5, 3, "#a77552");
      r(x + 2, y, 3, 5, "#829966");
      r(x, y + 1, 7, 2, "#95aa75");
    }
    if (a.status === "waiting") {
      r(x + 17, y - 28, 10, 9, "#f0b19d");
      r(x + 20, y - 19, 3, 2, "#f0b19d");
      this.text("!", x + 22, y - 21, "#382d33", 7, "center");
    }
    if (a.status === "done")
      this.text("✓", x + 21, y - 17, "#c1d9aa", 7, "center");
    if (this.focus === a.id) {
      g.strokeStyle = "#edd1a0";
      g.lineWidth = 1;
      g.strokeRect(x - 3, y - 24, 46, 47);
    }
    this.hitBoxes.push({ id: a.id, x: x - 4, y: y - 25, w: 48, h: 56 });
    if (c.moving) this.walking.push({ a, c });
  }
  character(a, x, y, c) {
    const im = this.sprites["char" + (hash(a.id) % 6)];
    if (!im) return;
    const row = c.moving ? (c.dir === "up" ? 1 : c.dir === "down" ? 0 : 2) : 0;
    const f = characterFrame(a, c, this.time);
    const g = this.ctx;
    g.save();
    g.globalAlpha = a.status === "gone" ? 0.4 : 1;
    if (c.moving && c.dir === "left") {
      g.translate(Math.round(x + 16), Math.round(y));
      g.scale(-1, 1);
      g.drawImage(im, f * 16, row * 32, 16, 32, 0, 0, 16, 32);
    } else
      g.drawImage(
        im,
        f * 16,
        row * 32,
        16,
        32,
        Math.round(x),
        Math.round(y),
        16,
        32,
      );
    if (this.cosmetics.includes("crown") && !c.moving) {
      this.rect(x + 3, y + 4, 10, 3, "#dfbb68");
      this.rect(x + 3, y + 2, 2, 2, "#dfbb68");
      this.rect(x + 7, y + 1, 2, 3, "#dfbb68");
      this.rect(x + 11, y + 2, 2, 2, "#dfbb68");
    }
    g.restore();
  }
  draw(dt = 0) {
    const cv = this.canvas,
      g = this.ctx,
      W = cv.clientWidth,
      H = cv.clientHeight;
    if (!W || !H) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, W, H);
    g.fillStyle = "#111720";
    g.fillRect(0, 0, W, H);
    const room = this.layout(W);
    const geometry = room.w + ":" + room.h + ":" + room.columns;
    this.relayout = !!this.geometry && this.geometry !== geometry;
    this.geometry = geometry;
    this.grid = room;
    this.dt = dt;
    this.hitBoxes = [];
    this.walking = [];
    const scale =
      Math.min((W - 24) / (room.w + 5), (H - 24) / (room.h + 8)) * this.zoom;
    const ox = (W - room.w * scale) / 2 + this.pan.x,
      oy = (H - room.h * scale) / 2 + this.pan.y;
    this.transform = { scale, ox, oy };
    g.save();
    g.translate(ox, oy);
    g.scale(scale, scale);
    this.room(room);
    // Per-row rugs establish workstation groups without covering footpaths.
    const theme = THEMES.find((t) => t.id === this.settings.theme) || THEMES[0];
    for (let row = 0; row < room.rows; row++) {
      const seats = room.seats.filter(
        (_, i) => Math.floor(i / room.columns) === row,
      );
      if (!seats.length) continue;
      const first = seats[0],
        last = seats.at(-1);
      this.rect(
        first.x - 7,
        first.y - 10,
        last.x - first.x + 54,
        40,
        theme.rug,
      );
      this.rect(
        first.x - 5,
        first.y + 28,
        last.x - first.x + 50,
        1,
        theme.accent,
      );
    }
    for (const s of room.seats) this.desk(s);
    for (const { a, c } of this.walking.sort((a, b) => a.c.y - b.c.y))
      this.character(a, c.x, c.y, c);
    if (this.edit && this.pointer) {
      const p = this.placement(this.pointer),
        b = p.bounds;
      g.save();
      g.globalAlpha = 0.65;
      this.image(this.edit, b.x, b.y, b.w, b.h);
      g.globalAlpha = 1;
      g.strokeStyle = p.valid ? "#a5e0b2" : "#ffb29f";
      g.lineWidth = 1 / scale;
      g.strokeRect(b.x - 1, b.y - 1, b.w + 2, b.h + 2);
      g.restore();
    }
    g.restore();
    // Text uses screen pixels, independent from sprite resolution.
    this.labelBoxes = [];
    if (this.settings.show_labels && scale >= 0.85)
      for (const s of room.seats) {
        const x = ox + (s.x + 20) * scale,
          y = oy + (s.y + 22) * scale,
          width = Math.min(154, 68 * scale - 10),
          max = width - 14,
          // Reserve the next row's approval bubble before adding a detail line.
          details = 26 * scale - 3 >= 32,
          height = details ? 32 : 18;
        g.fillStyle = "#17212f";
        g.beginPath();
        g.roundRect(x - width / 2, y, width, height, 5);
        g.fill();
        g.textAlign = "center";
        g.textBaseline = "alphabetic";
        g.font = '600 13px "Geist", sans-serif';
        let name = String(s.a.label || s.a.id).replace(/[_-]+/g, " ");
        while (g.measureText(name).width > max && name.length > 2)
          name = name.slice(0, -2) + "…";
        g.fillStyle = "#f4f6f2";
        g.fillText(name, x, y + 13);
        g.font = '500 12px "Geist", sans-serif';
        g.fillStyle = STATUS_COLORS[s.a.status] || "#a7b2bd";
        let detail =
          s.a.status === "waiting"
            ? "Needs input"
            : s.a.tool
              ? String(s.a.tool).replaceAll("_", " ")
              : s.a.status;
        while (g.measureText(detail).width > max && detail.length > 2)
          detail = detail.slice(0, -2) + "…";
        if (details) g.fillText(detail, x, y + 26);
        this.labelBoxes.push({
          id: s.a.id,
          x: x - width / 2,
          y,
          w: width,
          h: height,
        });
      }
    const active = new Set(this.agents.map((a) => a.id));
    for (const id of this.chars.keys())
      if (!active.has(id)) this.chars.delete(id);
  }
  point(event) {
    const b = this.canvas.getBoundingClientRect(),
      t = this.transform;
    return t
      ? {
          x: (event.clientX - b.left - t.ox) / t.scale,
          y: (event.clientY - b.top - t.oy) / t.scale,
        }
      : null;
  }
  placement(point) {
    const occupied = [
      ...this.hitBoxes,
      ...(this.settings.decorations ? defaultDecor(this.grid) : []),
    ];
    return placementAt(
      this.edit,
      point,
      this.grid,
      occupied,
      this.settings.furniture || [],
    );
  }
  bindInput() {
    const cv = this.canvas;
    cv.addEventListener("pointerdown", (e) => {
      this.drag = {
        x: e.clientX,
        y: e.clientY,
        pan: { ...this.pan },
        moved: false,
      };
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener("pointermove", (e) => {
      this.pointer = this.point(e);
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x,
        dy = e.clientY - this.drag.y;
      if (Math.hypot(dx, dy) > 5) this.drag.moved = true;
      if (this.drag.moved && this.zoom > 1) {
        this.pan.x = this.drag.pan.x + dx;
        this.pan.y = this.drag.pan.y + dy;
      }
    });
    cv.addEventListener("pointerup", (e) => {
      const moved = this.drag?.moved;
      this.drag = null;
      if (moved) return;
      const p = this.point(e);
      if (!p) return;
      if (this.edit) {
        this.onPlace(p, this.grid);
        return;
      }
      const hit = this.hitBoxes.find(
        (h) => p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h,
      );
      if (hit) {
        this.onSelect(hit.id);
        return;
      }
      const h = this.petHit;
      if (h && p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h)
        this.petUntil = this.time + 1.5;
    });
    cv.addEventListener("pointercancel", () => {
      this.drag = null;
    });
    cv.addEventListener("pointerleave", () => {
      this.pointer = null;
    });
    cv.addEventListener("keydown", (e) => {
      if (this.edit && (e.key.startsWith("Arrow") || e.key === "Enter")) {
        e.preventDefault();
        this.pointer ||= { x: this.grid.w / 2, y: this.grid.h - 18 };
        const step = e.shiftKey ? 8 : 4;
        if (e.key === "ArrowLeft") this.pointer.x -= step;
        if (e.key === "ArrowRight") this.pointer.x += step;
        if (e.key === "ArrowUp") this.pointer.y -= step;
        if (e.key === "ArrowDown") this.pointer.y += step;
        this.pointer.x = Math.max(7, Math.min(this.grid.w - 7, this.pointer.x));
        this.pointer.y = Math.max(
          28,
          Math.min(this.grid.h - 10, this.pointer.y),
        );
        if (e.key === "Enter") this.onPlace(this.pointer, this.grid);
        return;
      }
      if (e.key === "Enter") {
        const a = this.list()[0];
        if (a) this.onSelect(a.id);
      }
    });
  }
  setZoom(value) {
    this.zoom = Math.max(1, Math.min(3, value));
    if (this.zoom === 1) this.pan = { x: 0, y: 0 };
    this.draw();
  }
  snapshot() {
    this.draw();
    this.canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, "agent-office.png");
    });
  }
}
