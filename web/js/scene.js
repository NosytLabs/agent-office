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
    this.spriteFrameTops = {};
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
    this.movingIndex = null;
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
    load("studio-assistant-source", "characters/studio-assistant.png", (im) => {
      this.normalizeCharacter(im, "studio-assistant");
    });
    for (const n of ["DOOR", "FISH_TANK"]) load(n, "furniture/" + n + ".png");
    load("cat", "pets/claudio.png");
    load("blackcat", "pets/gitcat.png");
    load("sleepcat", "pets/sleep_cat.png");
    load("jukebox-source", "furniture/jukebox.png", (im) => {
      this.normalizeProp(im, "jukebox", [0, 0, im.width, im.height]);
      this.canvas.dispatchEvent(new Event("spritesready"));
    });
    for (const [atlas, cells] of [
      ["studio", ["sofa", "server", "shelf", "monstera"]],
      ["utilities", ["coffee", "cooler", "lamp", "clock"]],
      ["decor", ["roundtable", "stool", "succulent", "planter"]],
      ["workshop", ["whiteboard", "printer", "cart", "coatrack"]],
      ["rewards", ["arcade", "recordplayer", "robot", "terrarium"]],
      [
        "workstations",
        ["desk-walnut", "desk-slate", "focusbooth", "filingcabinet"],
      ],
    ])
      load(atlas, "furniture/" + atlas + "-atlas.png", (im) => {
        // Normalize once; source image pixels never drive collision geometry.
        for (const [i, key] of cells.entries()) {
          const w = Math.floor(im.width / 2),
            h = Math.floor(im.height / 2);
          this.normalizeProp(im, key, [
            (i % 2) * w,
            Math.floor(i / 2) * h,
            w,
            h,
          ]);
        }
        this.canvas.dispatchEvent(new Event("spritesready"));
      });
  }
  normalizeCharacter(image, key) {
    // Generated poses share one scale and a grounded bottom-center anchor.
    // Keep source pixels intact; the renderer builds the native atlas once.
    const frames = [];
    let widest = 0,
      tallest = 0;
    for (let row = 0; row < 3; row++)
      for (let column = 0; column < 7; column++) {
        const sx = Math.round((column * image.width) / 7),
          sy = Math.round((row * image.height) / 3),
          width = Math.round(((column + 1) * image.width) / 7) - sx,
          height = Math.round(((row + 1) * image.height) / 3) - sy,
          sample = document.createElement("canvas");
        sample.width = width;
        sample.height = height;
        const context = sample.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, sx, sy, width, height, 0, 0, width, height);
        const rgba = context.getImageData(0, 0, width, height).data;
        let left = width,
          right = -1,
          top = height,
          bottom = -1;
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            if (rgba[(y * width + x) * 4 + 3] <= 32) continue;
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
        if (right < left) {
          this.assetErrors.push(
            "Empty character frame: " + key + ":" + frames.length,
          );
          return;
        }
        const w = right - left + 1,
          h = bottom - top + 1;
        widest = Math.max(widest, w);
        tallest = Math.max(tallest, h);
        frames.push({ sample, left, top, w, h, row, column });
      }
    const normalized = document.createElement("canvas"),
      scale = Math.min(14 / widest, 28 / tallest);
    normalized.width = 112;
    normalized.height = 96;
    const context = normalized.getContext("2d");
    context.imageSmoothingEnabled = false;
    const frameTops = [];
    for (const frame of frames) {
      const width = Math.max(1, Math.round(frame.w * scale)),
        height = Math.max(1, Math.round(frame.h * scale));
      frameTops.push(31 - height);
      context.drawImage(
        frame.sample,
        frame.left,
        frame.top,
        frame.w,
        frame.h,
        frame.column * 16 + Math.floor((16 - width) / 2),
        frame.row * 32 + 31 - height,
        width,
        height,
      );
    }
    this.sprites[key] = normalized;
    this.spriteFrameTops[key] = frameTops;
  }
  normalizeProp(image, key, region) {
    const [sx, sy, width, height] = region,
      sample = document.createElement("canvas");
    sample.width = width;
    sample.height = height;
    const source = sample.getContext("2d", { willReadFrequently: true });
    source.drawImage(image, sx, sy, width, height, 0, 0, width, height);
    const rgba = source.getImageData(0, 0, width, height).data;
    let left = width,
      top = height,
      right = -1,
      bottom = -1;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        if (rgba[(y * width + x) * 4 + 3] <= 32) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    if (right < left) {
      this.assetErrors.push("Empty prop: " + key);
      return;
    }
    const normalized = document.createElement("canvas");
    // The wall clock is built-in scenery, not an editable furniture item.
    const size =
      PROP_SIZES[key] ||
      (key === "clock"
        ? [10, 10]
        : key === "desk-walnut" || key === "desk-slate"
          ? [40, 14]
          : null);
    if (!size) {
      this.assetErrors.push("Unknown prop dimensions: " + key);
      return;
    }
    [normalized.width, normalized.height] = size;
    const target = normalized.getContext("2d");
    target.imageSmoothingEnabled = false;
    target.drawImage(
      sample,
      left,
      top,
      right - left + 1,
      bottom - top + 1,
      0,
      0,
      normalized.width,
      normalized.height,
    );
    this.sprites[key] = normalized;
  }
  update(agents, settings, progress, focus, filter) {
    // Bootstrap observed sessions at their stations. Subsequent arrivals may
    // walk; bounded planning keeps large rooms responsive without hiding agents.
    if (!this.initialIds) this.initialIds = new Set(agents.map((a) => a.id));
    const ids = new Set(agents.map((a) => a.id));
    for (const id of this.chars.keys()) if (!ids.has(id)) this.chars.delete(id);
    for (const id of this.initialIds)
      if (!ids.has(id)) this.initialIds.delete(id);
    this.agents = agents;
    this.settings = settings;
    this.cosmetics = progress?.cosmetics || [];
    this.focus = focus;
    this.filter = filter;
    this.stateAtTime = this.time;
  }
  list() {
    return this.agents.filter(
      (a) => this.filter === "every" || platOf(a) === this.filter,
    );
  }
  seatOptions() {
    const seats = resolveAgentSeats(this.agents, this.settings);
    const occupants = new Map(seats.map(({ a, slot }) => [slot, a]));
    const count = Math.min(
      AGENT_PREFERENCE_LIMIT,
      Math.max(8, (seats.at(-1)?.slot ?? -1) + 2),
    );
    return Array.from({ length: count }, (_, slot) => {
      const a = occupants.get(slot);
      return {
        slot,
        agentId: a?.id ?? null,
        label: a ? a.label || a.id : "Available",
      };
    });
  }
  agentPreferencePatch(id, changes) {
    const fail = (code, error) => ({ ok: false, code, error });
    if (!validAgentPreferenceId(id) || !this.agents.some((a) => a.id === id))
      return fail("missing", "This session has left the office.");
    if (!normalizeAgentPreference(changes))
      return fail("invalid", "Choose a supported appearance and workstation.");
    const preferences = normalizeAgentPreferences(
      this.settings.agent_preferences ?? {},
    );
    if (!preferences)
      return fail("invalid", "Saved agent preferences are invalid.");
    // Validate occupancy against every active session, including filtered ones,
    // before producing any replacement map. The normal save queue owns commit.
    if (Object.hasOwn(changes, "seat") && changes.seat !== null) {
      const occupant = resolveAgentSeats(this.agents, this.settings).find(
        ({ slot }) => slot === changes.seat,
      );
      if (occupant && occupant.a.id !== id)
        return fail(
          "occupied",
          "That workstation is occupied. Choose an available workstation.",
        );
    }
    const preference = normalizeAgentPreference({
      ...agentPreference(id, this.settings),
      ...changes,
    });
    const entries = Object.entries(preferences).filter(
      ([agentId]) => agentId !== id,
    );
    if (Object.keys(preference).length) entries.push([id, preference]);
    if (entries.length > AGENT_PREFERENCE_LIMIT)
      return fail(
        "limit",
        "The office already has preferences for 128 sessions. Reset an existing preference first.",
      );
    return {
      ok: true,
      patch: { agent_preferences: Object.fromEntries(entries) },
    };
  }
  layout(width) {
    const assigned = resolveAgentSeats(this.agents, this.settings),
      max = width < 600 ? 2 : this.settings.max_chars;
    const capacity = Math.max(
      this.agents.length,
      (assigned.at(-1)?.slot ?? -1) + 1,
    );
    const columns = Math.max(1, Math.min(max, Math.max(2, this.agents.length)));
    const rows = Math.max(1, Math.ceil(capacity / columns));
    const w = Math.max(width < 600 ? 210 : 320, columns * 68 + 72),
      h = Math.max(238, rows * 76 + 110);
    const start = (w - ((columns - 1) * 68 + 40)) / 2;
    const seats = assigned
      .filter(({ a }) => this.filter === "every" || platOf(a) === this.filter)
      .map(({ a, slot }) => ({
        a,
        slot,
        x: start + (slot % columns) * 68,
        y: 60 + Math.floor(slot / columns) * 76,
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
  prop(kind, x, y, w, h) {
    this.image(kind, x, y, w, h);
    if (
      [
        "FISH_TANK",
        "jukebox",
        "whiteboard",
        "server",
        "printer",
        "arcade",
        "recordplayer",
        "robot",
        "terrarium",
        "coffee",
        "focusbooth",
        "filingcabinet",
      ].includes(kind)
    )
      this.propHits.push({ kind, x, y, w, h });
    const r = this.rect.bind(this),
      pulse = Math.floor(this.time * 3) % 2;
    if (kind === "server") {
      r(x + w * 0.26, y + h * 0.34, 2, 1, pulse ? "#b1d5b5" : "#729e98");
    } else if (kind === "arcade" && this.cosmetics.includes("arcade_glow")) {
      r(x + w * 0.36, y + h * 0.27, 2, 1, "#94d4c2");
      r(
        x + w * (0.38 + Math.sin(this.time * 1.4) * 0.13),
        y + h * 0.2,
        1,
        1,
        "#eed6a0",
      );
    } else if (
      (kind === "jukebox" ||
        (kind === "recordplayer" && this.cosmetics.includes("vinyl_spin"))) &&
      this.musicPlaying
    ) {
      for (let i = 0; i < 3; i++)
        r(
          x + w * 0.4 + i * 2,
          y + h * 0.58 - ((pulse + i) % 3),
          1,
          2 + ((pulse + i) % 3),
          "#bad7af",
        );
    } else if (kind === "robot" && this.cosmetics.includes("robot_wave")) {
      r(x + w * 0.34, y + h * 0.24, 2, pulse ? 1 : 2, "#b1e1cc");
      r(x + w * 0.55, y + h * 0.24, 2, pulse ? 1 : 2, "#b1e1cc");
      r(x + w * 0.84, y + h * 0.5 - pulse * 3, 2, 3, "#ecdec3");
    } else if (
      kind === "terrarium" &&
      this.cosmetics.includes("terrarium_glow")
    ) {
      r(
        x + w * 0.55 + Math.sin(this.time) * 3,
        y + h * 0.35 + Math.cos(this.time * 0.8) * 3,
        1,
        1,
        "#f0d899",
      );
    } else if (kind === "FISH_TANK") {
      r(
        x + 5 + ((this.time * 2) % Math.max(1, w - 10)),
        y + 7,
        2,
        1,
        "#f2c18c",
      );
    }
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
    const windowWidth = w < 260 ? 32 : 40;
    for (const x of w < 260 ? [48, w - 59] : [w * 0.29, w * 0.69]) {
      r(x, 6, windowWidth, 17, t.trim);
      r(x + 2, 7, windowWidth - 4, 14, dark ? "#243854" : "#b5d4db");
      r(x + 4, 8, 2, 10, dark ? "#67768c" : "#d8e9e6");
      r(x + windowWidth / 2 - 1, 7, 2, 14, t.trim);
      r(x, 22, windowWidth, 2, t.trim);
      if (dark) {
        r(x + 9, 10, 1, 1, "#e8cf93");
        r(x + windowWidth - 11, 9, 1, 1, "#e8cf93");
      } else {
        r(x + windowWidth - 17, 10, 8, 1, "#e6f0e8");
      }
    }
    r(w / 2 - 20, 7, 40, 14, "#26313a");
    this.text(
      (this.settings.room_name || "AGENT OFFICE").slice(0, 18),
      w / 2,
      16,
      "#e9d4a4",
      4,
      "center",
    );
    r(4, h - 8, w - 8, 4, t.trim);
    r(4, 28, 2, h - 36, t.trim);
    r(w - 6, 28, 2, h - 36, t.trim);
    if (this.settings.decorations) {
      // Break area remains separate from the desk rows at every viewport.
      const by = h - 46;
      r(18, by - 10, 85, 42, t.rug);
      r(21, by - 7, 79, 1, t.accent);
      r(21, by + 28, 79, 1, t.accent);
      for (const p of defaultDecor(g, this.cosmetics))
        this.prop(p.kind, p.x, p.y, p.w, p.h);
      if (this.cosmetics.includes("storm_lamp"))
        this.rect(68, h - 54, 4, 2, "#efb481");
    }
    for (const item of this.resolvedFurniture || []) {
      const b = item.bounds;
      if (!b) continue;
      this.prop(item.kind, b.x, b.y, b.w, b.h);
      if (item.index === this.movingIndex) {
        this.ctx.strokeStyle = "#e9ca8e";
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4);
      }
    }
    this.drawPets(g);
    if (dark) {
      r(3, 3, w - 6, h - 6, "#111d3a35");
    }
  }
  drawPets(grid) {
    const enabled =
      this.settings.decorations && this.settings.show_pets !== false;
    if (typeof OfficePetController === "function")
      this.petWorld ||= new OfficePetController(officePath);
    const world = {
      w: grid.w,
      h: grid.h,
      key: this.navigationKey + JSON.stringify(this.furnitureObstacles || []),
      blocked: [
        ...(this.navigationProps || []),
        ...(this.furnitureObstacles || []),
      ],
      agents: (grid.seats || []).map((s) => ({
        id: s.a.id,
        status: s.a.status,
        quiet: s.a.quiet,
        recorded_status: s.a.recorded_status,
        x: s.x + 20,
        y: s.y + 13,
      })),
      homes: {
        cat: { x: 58, y: grid.h - 18 },
        blackcat: { x: grid.w - 68, y: grid.h - 18 },
      },
    };
    this.petViews = this.petWorld
      ? this.petWorld.step(this.dt, world, {
          enabled,
          secondCat: this.cosmetics.includes("gitcat"),
          roam: this.settings.pets_roam !== false,
          paused:
            this.paused ||
            matchMedia("(prefers-reduced-motion: reduce)").matches,
          hidden: document.hidden,
        })
      : [];
    for (const pet of this.petViews)
      this.pet(pet.x, pet.y, pet.key === "blackcat", pet);
    // The sofa sleeper remains its earned decoration, not an extra roaming pet.
    if (enabled && this.cosmetics.includes("office_cat"))
      this.image("sleepcat", 34, grid.h - 36, 18, 12);
  }
  pet(x, y, black = false, behavior = {}) {
    const sheet = this.sprites[black ? "blackcat" : "cat"];
    if (!sheet) return;
    const key = black ? "blackcat" : "cat";
    const active = this.petActive === key && this.petUntil > this.time;
    // Verified front-idle alpha bounds in the existing 96x96 sheets. Native
    // walk ranges are unverified; movement changes position/facing, not frames.
    const [sx, sy, sw, sh, width, height] = black
      ? [3, 12, 9, 17, 8, 15]
      : [2, 11, 12, 20, 9, 15];
    const left = Math.round(x - width / 2),
      top = Math.round(y - height);
    const g = this.ctx;
    g.save();
    if (behavior.facing < 0) {
      g.translate(left + width, top);
      g.scale(-1, 1);
      g.drawImage(sheet, sx, sy, sw, sh, 0, 0, width, height);
    } else g.drawImage(sheet, sx, sy, sw, sh, left, top, width, height);
    g.restore();
    if (behavior.mode === "sleep" && !behavior.moving)
      this.text("z", x + 6, y - 15, "#afc4cf", 5, "center");
    if (active) {
      this.text("♥", x, y - 17, "#ecad98", 6, "center");
      const name =
        this.settings.pet_names?.[black ? "cat2" : "cat1"] ||
        (black ? "Gitcat" : "Claudio");
      this.text(name.slice(0, 16), x, y + 8, "#f0ddbe", 4, "center");
    }
    this.petHits.push({
      key,
      x: left - 3,
      y: top - 2,
      w: width + 6,
      h: height + 4,
    });
  }
  petCat(key) {
    if (
      !this.settings.decorations ||
      this.settings.show_pets === false ||
      !["cat", "blackcat"].includes(key) ||
      !this.petViews?.some((p) => p.key === key)
    )
      return;
    if (key === "blackcat" && !this.cosmetics.includes("gitcat")) return;
    this.petWorld?.hold(key);
    this.petActive = key;
    this.petUntil = this.time + 1.5;
    this.onPet?.(key);
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
    const deskStyle = this.settings.desk_style || DEFAULT_SETTINGS.desk_style;
    const deskLeg = deskStyle === "slate" ? "#525e65" : "#453b3b";
    r(x + 3, y + 10, 3, 11, deskLeg);
    r(x + 34, y + 10, 3, 11, deskLeg);
    // Chair and backrest precede the character; desktop occludes the legs.
    r(x + 9, y - 3, 14, 13, "#303a43");
    r(x + 11, y - 5, 10, 3, "#596570");
    r(x + 10, y + 10, 12, 3, "#26313a");
    const target = { x: x + 8, y: y - 17 };
    let c = this.chars.get(a.id);
    if (!c) {
      const seated = this.initialIds?.delete(a.id);
      c = {
        x: seated ? target.x : 24,
        y: seated ? target.y : 0,
        distance: 0,
        path: [],
      };
      this.chars.set(a.id, c);
    }
    const routeKey = this.navigationKey + ":" + target.x + ":" + target.y;
    if (c.routeKey !== routeKey) {
      c.routeKey = routeKey;
      if (
        this.paused ||
        this.relayout ||
        this.grid.seats.length > 16 ||
        !this.routeBudget ||
        (c.x === target.x && c.y === target.y)
      ) {
        c.path = [];
        c.x = target.x;
        c.y = target.y;
      } else {
        this.routeBudget--;
        const occupied = [
          ...this.grid.seats
            .filter((s) => s.a.id !== a.id)
            .map((s) => ({ x: s.x - 3, y: s.y - 6, w: 46, h: 27 })),
          ...this.navigationProps,
        ];
        const route = officePath(
          { x: c.x + 8, y: c.y + 30 },
          { x: target.x + 8, y: target.y + 30 },
          this.grid,
          occupied,
        );
        c.path = route?.map((p) => ({ x: p.x - 8, y: p.y - 30 })) || [];
        if (!route) {
          c.x = target.x;
          c.y = target.y;
        }
      }
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
    const desktop = this.sprites["desk-" + deskStyle];
    if (desktop) g.drawImage(desktop, x, y + 7, 40, 14);
    else {
      r(x, y + 7, 40, 2, "#d6b17b");
      r(x, y + 9, 40, 8, "#b18b63");
      r(x, y + 17, 40, 3, "#795b4b");
      r(x + 1, y + 10, 38, 1, "#c39a6b");
    }
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
    const key = characterSpriteKey(a, this.settings, this.sprites),
      im = this.sprites[key];
    if (!im) return;
    const row = c.moving ? (c.dir === "up" ? 1 : c.dir === "down" ? 0 : 2) : 0;
    const f = characterFrame(a, c, this.time);
    const g = this.ctx;
    g.save();
    const age = Math.max(
      0,
      (Number(a.idle_s) || 0) + this.time - (this.stateAtTime || 0),
    );
    g.globalAlpha =
      a.status === "gone"
        ? Math.max(0.15, 0.7 * (1 - age / 20))
        : a.status === "done"
          ? Math.max(0.2, Math.min(1, (120 - age) / 10))
          : 1;
    if (a.status === "done" && age < 1.5 && !this.paused)
      y -= Math.abs(Math.sin(age * Math.PI * 2)) * 2;
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
      const crownY = y + (this.spriteFrameTops?.[key]?.[row * 7 + f] ?? 2) - 2;
      this.rect(x + 3, crownY + 4, 10, 3, "#dfbb68");
      this.rect(x + 3, crownY + 2, 2, 2, "#dfbb68");
      this.rect(x + 7, crownY + 1, 2, 3, "#dfbb68");
      this.rect(x + 11, crownY + 2, 2, 2, "#dfbb68");
    }
    g.restore();
  }
  draw(dt = 0) {
    const cv = this.canvas,
      g = this.ctx,
      W = cv.clientWidth,
      H = cv.clientHeight;
    // At Fit, a swipe should reach controls below the mobile floor. Reserve
    // gestures for the canvas only when panning or arranging furniture.
    cv.style.touchAction = this.zoom > 1 || this.edit ? "none" : "pan-y";
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
    const decorations = this.settings.decorations
        ? defaultDecor(room, this.cosmetics)
        : [],
      furniture = this.settings.furniture || [],
      desks = room.seats.map((s) => ({
        // Reserve the full native-resolution label footprint as well as the desk.
        x: s.x - 12,
        y: s.y - 25,
        w: 64,
        h: 72,
      })),
      resolutionKey =
        geometry + JSON.stringify([desks, decorations, furniture]);
    this.furnitureObstacles = desks;
    if (this.furnitureResolutionKey !== resolutionKey) {
      this.furnitureResolutionKey = resolutionKey;
      const result = resolveFurniture(furniture, room, [
        ...desks,
        ...decorations,
      ]);
      this.resolvedFurniture = result.props;
      this.furnitureResolution = {
        relocated: result.relocated,
        unplaced: result.unplaced,
      };
      this.onFurnitureResolution?.(this.furnitureResolution);
    }
    this.navigationProps = [
      ...decorations,
      ...this.resolvedFurniture.map((p) => p.bounds).filter(Boolean),
    ];
    this.navigationKey =
      geometry +
      JSON.stringify([
        room.seats.map((s) => [s.a.id, s.x, s.y]),
        this.navigationProps,
      ]);
    this.dt = dt;
    this.hitBoxes = [];
    this.petHits = [];
    this.propHits = [];
    this.walking = [];
    this.routeBudget = 2;
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
        (seat) => Math.floor(seat.slot / room.columns) === row,
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
    if (this.editKind() && this.pointer) {
      const p = this.placement(this.pointer),
        b = p.bounds;
      g.save();
      g.globalAlpha = 0.65;
      this.image(this.editKind(), b.x, b.y, b.w, b.h);
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
              : STATUS_NAMES[s.a.status] || s.a.status;
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
    const kind = this.editKind();
    if (!kind) return null;
    const occupied = [
      ...(this.furnitureObstacles || this.hitBoxes),
      ...(this.settings.decorations
        ? defaultDecor(this.grid, this.cosmetics)
        : []),
      ...(this.resolvedFurniture || [])
        .filter((p) => p.index !== this.movingIndex && p.bounds)
        .map((p) => p.bounds),
    ];
    const placement = placementAt(kind, point, this.grid, occupied, []);
    placement.valid &&=
      this.movingIndex !== null || this.settings.furniture.length < 24;
    return placement;
  }
  editKind() {
    return this.movingIndex !== null
      ? this.settings.furniture[this.movingIndex]?.kind
      : Object.hasOwn(PROP_SIZES, this.edit)
        ? this.edit
        : null;
  }
  propAt(p) {
    if (!p) return -1;
    return (
      (this.resolvedFurniture || []).findLast((item) => {
        const b = item.bounds;
        return (
          b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h
        );
      })?.index ?? -1
    );
  }
  furnitureBounds(index) {
    return this.resolvedFurniture?.[index]?.bounds || null;
  }
  bindInput() {
    const cv = this.canvas;
    cv.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !e.isPrimary) return;
      const point = this.point(e),
        at = this.edit === "move" ? this.propAt(point) : -1;
      const newlyPicked = at >= 0 && this.movingIndex !== at;
      if (at >= 0) this.onPick?.(at);
      const anchor = at >= 0 ? { ...this.pointer } : null;
      this.drag = {
        id: e.pointerId,
        prop: at >= 0,
        newlyPicked,
        anchor,
        point,
        x: e.clientX,
        y: e.clientY,
        pan: { ...this.pan },
        moved: false,
      };
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener("pointermove", (e) => {
      if (!e.isPrimary || (this.drag && this.drag.id !== e.pointerId)) return;
      this.pointer = this.point(e);
      if (!this.drag || this.drag.id !== e.pointerId) return;
      const dx = e.clientX - this.drag.x,
        dy = e.clientY - this.drag.y;
      if (Math.hypot(dx, dy) > 5) this.drag.moved = true;
      if (this.drag.prop) {
        this.pointer = {
          x: this.drag.anchor.x + this.pointer.x - this.drag.point.x,
          y: this.drag.anchor.y + this.pointer.y - this.drag.point.y,
        };
      } else if (this.drag.moved && this.zoom > 1) {
        this.pan.x = this.drag.pan.x + dx;
        this.pan.y = this.drag.pan.y + dy;
      }
    });
    cv.addEventListener("pointerup", (e) => {
      const drag = this.drag;
      if (!drag || drag.id !== e.pointerId) return;
      this.drag = null;
      if (drag.prop && drag.moved) {
        this.onPlace(this.pointer, this.grid);
        return;
      }
      if (drag.newlyPicked || drag.moved) return;
      const p = this.point(e);
      if (!p) return;
      if (this.edit) {
        this.onPlace(p, this.grid);
        return;
      }
      const canvasBounds = cv.getBoundingClientRect(),
        screen = {
          x: e.clientX - canvasBounds.left,
          y: e.clientY - canvasBounds.top,
        },
        label = (this.labelBoxes || []).find(
          (h) =>
            screen.x >= h.x &&
            screen.x <= h.x + h.w &&
            screen.y >= h.y &&
            screen.y <= h.y + h.h,
        );
      const hit =
        label ||
        this.hitBoxes.find(
          (h) =>
            p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h,
        );
      if (hit) {
        this.onSelect(hit.id);
        return;
      }
      const h = this.petHits.find(
        (h) => p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h,
      );
      if (h) {
        this.petCat(h.key);
        return;
      }
      const prop = this.propHits.findLast(
        (hit) =>
          p.x >= hit.x &&
          p.x <= hit.x + hit.w &&
          p.y >= hit.y &&
          p.y <= hit.y + hit.h,
      );
      if (prop) this.onProp?.(prop.kind);
    });
    cv.addEventListener("pointercancel", (e) => {
      if (!e.isPrimary || (this.drag && this.drag.id !== e.pointerId)) return;
      this.drag = null;
      this.pointer = null;
    });
    cv.addEventListener("lostpointercapture", (e) => {
      if (this.drag?.id === e.pointerId) this.drag = null;
    });
    cv.addEventListener("pointerleave", (e) => {
      if (!e.isPrimary || this.drag) return;
      this.pointer = null;
    });
    cv.addEventListener("keydown", (e) => {
      if (
        this.edit === "move" &&
        e.key === " " &&
        this.settings.furniture.length
      ) {
        e.preventDefault();
        this.onPick?.(
          ((this.movingIndex ?? -1) + 1) % this.settings.furniture.length,
        );
        return;
      }
      if (this.edit && ["Delete", "Backspace"].includes(e.key)) {
        e.preventDefault();
        this.onRemove?.();
        return;
      }
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
