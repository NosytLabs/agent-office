/* Optional studio presentation. Observed activity and the native atlas remain
 * independent of artwork, companion looks, effects and browser preferences. */
(function (root) {
  "use strict";
  const POSES = [
    "idle",
    "walk-a",
    "walk-b",
    "type",
    "read",
    "attention",
    "wait",
    "cheer",
    "error",
  ];
  const PET_POSES = [
    "idle",
    "walk-a",
    "walk-b",
    "sit",
    "sleep",
    "happy",
    "pet",
  ];
  const PET_NAMES = [
    "Orange cat",
    "Tuxedo cat",
    "White cat",
    "Grey cat",
    "Corgi",
    "Black dog",
    "Golden dog",
    "Pocket robot",
  ];
  const DIRECTIONS = ["down", "up", "right", "left"];
  const WALK_POSES = ["idle", "walk-a", "walk-b"];
  function petMotion(x, y, previous, geometry, paused, facing = 1) {
    const same = previous?.geometry === geometry,
      dx = same ? x - previous.x : 0,
      dy = same ? y - previous.y : 0,
      travelled = Math.hypot(dx, dy),
      moving = !paused && travelled > 0.01 && travelled < 10;
    return {
      x,
      y,
      geometry,
      distance: (same ? previous.distance : 0) + (moving ? travelled : 0),
      dir: moving
        ? Math.abs(dx) > Math.abs(dy)
          ? dx < 0
            ? "left"
            : "right"
          : dy < 0
            ? "up"
            : "down"
        : same
          ? previous.dir
          : facing < 0
            ? "left"
            : "right",
    };
  }
  function petDirectionalKey(index, motion, affection = false, paused = false) {
    const key = !affection && directionalKey(index, motion, paused);
    return key ? key.replace(/^person-/, "pet-") : null;
  }
  function validEnvironmentManifest(m, name) {
    const surfaces = name === "room-surfaces",
      pets = name === "pet-walk";
    if (
      (!surfaces && !pets) ||
      !m ||
      m.version !== 1 ||
      m.image !== name + ".png" ||
      m.width !== (surfaces ? 256 : 336) ||
      m.height !== (surfaces ? 256 : 208) ||
      !/^[a-f0-9]{64}$/.test(m.rgbaSha256) ||
      !m.entries ||
      typeof m.entries !== "object" ||
      Array.isArray(m.entries) ||
      Object.keys(m.entries).length !== (surfaces ? 4 : 96)
    )
      return false;
    const expected = [];
    if (surfaces)
      ["oak-floor", "slate-floor", "oak-wall", "slate-wall"].forEach((key, i) =>
        expected.push([
          `surface-${key}`,
          [(i % 2) * 128, Math.floor(i / 2) * 128, 128, 128],
          [0, 0],
        ]),
      );
    else
      for (let pet = 0; pet < 8; pet++)
        DIRECTIONS.forEach((direction, d) =>
          WALK_POSES.forEach((pose, p) =>
            expected.push([
              `pet-${pet}-${direction}-${pose}`,
              [(d * 3 + p) * 28, pet * 26, 28, 26],
              [14, 25],
            ]),
          ),
        );
    return expected.every(
      ([key, rect, anchor]) =>
        JSON.stringify(m.entries[key]?.rect) === JSON.stringify(rect) &&
        JSON.stringify(m.entries[key]?.anchor) === JSON.stringify(anchor),
    );
  }
  function directionalKey(person, motion = {}, paused = false) {
    if (!motion.moving || !DIRECTIONS.includes(motion.dir)) return null;
    const distance = Number.isFinite(motion.distance)
      ? Math.max(0, motion.distance)
      : 0;
    const frame = paused
      ? "idle"
      : ["idle", "walk-a", "walk-b", "walk-a"][Math.floor(distance / 3) % 4];
    return `person-${person}-${motion.dir}-${frame}`;
  }
  function validDirectionalManifest(manifest) {
    if (
      !manifest ||
      manifest.version !== 1 ||
      manifest.width !== 384 ||
      manifest.height !== 216 ||
      manifest.image !== "directional.png" ||
      !manifest.entries ||
      typeof manifest.entries !== "object" ||
      Array.isArray(manifest.entries) ||
      Object.keys(manifest.entries).length !== 72 ||
      !/^[0-9a-f]{64}$/.test(manifest.rgbaSha256)
    )
      return false;
    for (let person = 0; person < 6; person++)
      for (const [direction, name] of DIRECTIONS.entries())
        for (const [pose, label] of WALK_POSES.entries()) {
          const entry = manifest.entries[`person-${person}-${name}-${label}`];
          if (
            !entry ||
            JSON.stringify(entry.rect) !==
              JSON.stringify([
                (direction * 3 + pose) * 32,
                person * 36,
                32,
                36,
              ]) ||
            JSON.stringify(entry.anchor) !== "[16,35]"
          )
            return false;
        }
    return true;
  }
  function pose(a = {}, c = {}, time = 0, paused = false) {
    if (c.moving && !paused)
      return ["idle", "walk-a", "walk-b", "walk-a"][
        Math.floor(Math.max(0, Number(c.distance) || 0) / 3) % 4
      ];
    if (a.status === "waiting") return "attention";
    if (
      ["idle", "done"].includes(a.status) &&
      String(a.detail || "").startsWith("⚠ ")
    )
      return "error";
    if (a.quiet && ["working", "thinking"].includes(a.recorded_status))
      return "wait";
    if (a.status === "done") return "cheer";
    if (a.status === "working") {
      if (
        /read|search|grep|glob|fetch|browse/i.test(a.tool || "") ||
        ["reading", "browsing"].includes(a.activity)
      )
        return "read";
      if (/bash|shell|exec|terminal|command/i.test(a.tool || "")) return "wait";
      return "type";
    }
    return "idle";
  }
  function petPose(p = {}, affection = false, paused = false) {
    if (affection) return "pet";
    if (p.mode === "sleep" && !p.moving) return "sleep";
    if (p.moving && !paused)
      return ["idle", "walk-a", "walk-b", "walk-a"][
        Math.floor(Math.max(0, Number(p.distance) || 0) / 3) % 4
      ];
    return p.mode === "sit" ? "sit" : "idle";
  }
  function companionFeedback(index, name) {
    return (
      String(name || PET_NAMES[index] || "Companion").slice(0, 24) +
      (index === 7
        ? " beeps hello."
        : index >= 4
          ? " wags happily."
          : " purrs.")
    );
  }
  function preferences(value = {}) {
    return {
      art: value?.art === "classic" ? "classic" : "studio",
      pets: [0, 1].map((fallback, i) =>
        Number.isInteger(value?.pets?.[i]) &&
        value.pets[i] >= 0 &&
        value.pets[i] < 8
          ? value.pets[i]
          : fallback,
      ),
      season: ["autumn", "winter"].includes(value?.season)
        ? value.season
        : "none",
      finish: ["slate", "classic"].includes(value?.finish)
        ? value.finish
        : "oak",
    };
  }
  function validManifest(m) {
    if (
      !m ||
      m.version !== 1 ||
      !Number.isInteger(m.width) ||
      !Number.isInteger(m.height) ||
      m.width < 1 ||
      m.height < 1 ||
      m.width > 1024 ||
      m.height > 1024 ||
      !m.entries ||
      typeof m.entries !== "object" ||
      Array.isArray(m.entries)
    )
      return false;
    const required = [
      ...Array.from({ length: 6 }, (_, i) =>
        POSES.map((p) => `person-${i}-${p}`),
      ).flat(),
      ...Array.from({ length: 8 }, (_, i) =>
        PET_POSES.map((p) => `pet-${i}-${p}`),
      ).flat(),
      "icon-parcel",
      "icon-crown",
      "holiday-tree",
      "holiday-gift",
      "holiday-wreath",
      "holiday-pumpkin",
      "holiday-ghost",
      "holiday-bat",
    ];
    if (
      Object.keys(m.entries).length > 256 ||
      !required.every((k) => Object.hasOwn(m.entries, k))
    )
      return false;
    return Object.entries(m.entries).every(([key, entry]) => {
      const r = entry?.rect,
        a = entry?.anchor;
      return (
        /^[a-zA-Z0-9_-]+$/.test(key) &&
        Array.isArray(r) &&
        r.length === 4 &&
        r.every(Number.isInteger) &&
        r[0] >= 0 &&
        r[1] >= 0 &&
        r[2] > 0 &&
        r[3] > 0 &&
        r[0] + r[2] <= m.width &&
        r[1] + r[3] <= m.height &&
        Array.isArray(a) &&
        a.length === 2 &&
        a.every(Number.isInteger) &&
        a[0] >= 0 &&
        a[0] < r[2] &&
        a[1] >= 0 &&
        a[1] < r[3] &&
        (!key.startsWith("person-") ||
          (r[2] === 32 && r[3] === 36 && a[0] === 16 && a[1] === 35)) &&
        (!key.startsWith("pet-") ||
          (r[2] === 28 && r[3] === 26 && a[0] === 14 && a[1] === 25))
      );
    });
  }
  function addStudioDetails(sprites) {
    const ink = "#151a2b",
      edge = "#4c5b78",
      navy = "#28354f";
    const cream = "#f4e5cb",
      shade = "#c0b7ac",
      wood = "#b2794c";
    const leaf = "#356b50",
      light = "#75a765",
      stem = "#294b40";
    function make(key, width, height, rectangles) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const g = canvas.getContext("2d");
      for (const [color, x, y, w, h] of rectangles) {
        g.fillStyle = color;
        g.fillRect(x, y, w, h);
      }
      sprites.set(key, canvas);
    }
    make("succulent", 12, 16, [
      [ink, 2, 9, 9, 7],
      [shade, 3, 10, 7, 5],
      [cream, 3, 10, 6, 3],
      [stem, 5, 3, 2, 7],
      [leaf, 2, 5, 8, 3],
      [light, 3, 4, 2, 3],
      [leaf, 4, 1, 4, 4],
      [light, 5, 1, 2, 3],
      [stem, 1, 7, 3, 2],
    ]);
    make("planter", 32, 18, [
      [ink, 0, 9, 32, 8],
      [wood, 1, 10, 30, 6],
      [cream, 2, 10, 28, 2],
      [shade, 3, 12, 26, 3],
      [ink, 3, 16, 3, 2],
      [ink, 26, 16, 3, 2],
      [stem, 6, 2, 2, 8],
      [leaf, 2, 4, 10, 4],
      [light, 3, 3, 4, 3],
      [stem, 16, 2, 2, 8],
      [leaf, 12, 1, 8, 5],
      [light, 14, 0, 3, 4],
      [stem, 25, 3, 2, 7],
      [leaf, 22, 4, 9, 4],
      [light, 23, 3, 4, 3],
    ]);
    make("robot", 18, 28, [
      [ink, 7, 1, 4, 5],
      [leaf, 8, 1, 2, 2],
      [ink, 2, 5, 14, 11],
      [shade, 3, 6, 12, 9],
      [cream, 4, 6, 10, 7],
      [navy, 5, 8, 8, 5],
      ["#70d3b3", 6, 9, 2, 3],
      ["#70d3b3", 10, 9, 2, 3],
      [ink, 3, 16, 12, 9],
      [shade, 4, 17, 10, 7],
      [cream, 5, 17, 8, 5],
      [leaf, 7, 19, 4, 3],
      [ink, 0, 17, 3, 6],
      [cream, 1, 18, 2, 3],
      [ink, 15, 17, 3, 6],
      [cream, 15, 18, 2, 3],
      [ink, 3, 25, 5, 3],
      [ink, 10, 25, 5, 3],
    ]);
    make("statusbeacon", 12, 28, [
      [ink, 1, 23, 10, 5],
      [navy, 2, 24, 8, 3],
      [edge, 3, 24, 6, 1],
      [ink, 5, 12, 2, 11],
      [edge, 5, 13, 1, 10],
      [ink, 1, 4, 10, 8],
      [navy, 2, 5, 8, 6],
      [edge, 3, 3, 6, 6],
      [shade, 4, 4, 3, 2],
      [cream, 4, 5, 1, 2],
      [ink, 1, 11, 10, 2],
    ]);
    make("DOOR", 32, 48, [
      [ink, 1, 0, 30, 48],
      [edge, 3, 1, 26, 46],
      [navy, 5, 4, 23, 43],
      [wood, 6, 7, 20, 39],
      ["#92613f", 8, 9, 16, 37],
      ["#d59b60", 7, 7, 18, 2],
      [ink, 10, 13, 12, 15],
      [edge, 11, 14, 10, 13],
      ["#7aa9b4", 12, 15, 8, 11],
      ["#aacbc9", 12, 15, 3, 9],
      [cream, 22, 33, 2, 5],
      [ink, 5, 45, 23, 3],
    ]);
    const terminal = [
      [ink, 2, 2, 20, 30],
      [navy, 3, 3, 18, 28],
      [edge, 4, 3, 16, 2],
      [ink, 5, 6, 14, 15],
      ["#101d29", 6, 7, 12, 13],
      [wood, 2, 22, 20, 3],
      ["#d89c60", 3, 22, 18, 1],
      [ink, 5, 26, 14, 4],
      [edge, 6, 27, 12, 1],
      [ink, 1, 31, 22, 3],
    ];
    const states = ["idle", "running", "finished", "failed", "disconnected"];
    for (const state of states) {
      const color =
        state === "running"
          ? "#75c9da"
          : state === "finished"
            ? "#8bc59b"
            : state === "failed"
              ? "#f1a28f"
              : "#91a1b0";
      const marks =
        state === "finished"
          ? [
              [color, 8, 12, 2, 3],
              [color, 10, 14, 2, 2],
              [color, 12, 10, 2, 5],
            ]
          : state === "failed"
            ? [
                [color, 8, 10, 2, 2],
                [color, 10, 12, 2, 2],
                [color, 12, 14, 2, 2],
                [color, 12, 10, 2, 2],
                [color, 8, 14, 2, 2],
              ]
            : state === "disconnected"
              ? [[color, 8, 12, 7, 2]]
              : [
                  [color, 8, 10, 6, 1],
                  [color, 8, 13, 8, 1],
                  [color, 8, 16, state === "running" ? 4 : 2, 1],
                ];
      make("taskterminal-" + state, 24, 34, [...terminal, ...marks]);
    }
    sprites.set("taskterminal", sprites.get("taskterminal-idle"));
  }
  const api = Object.freeze({
    pose,
    petPose,
    companionFeedback,
    preferences,
    validManifest,
    directionalKey,
    validDirectionalManifest,
    petMotion,
    petDirectionalKey,
    validEnvironmentManifest,
    addStudioDetails,
  });
  if (typeof module === "object" && module.exports) module.exports = api;
  root.OfficeStudio = api;
  if (
    typeof document === "undefined" ||
    root.officeStudio ||
    typeof scene === "undefined"
  )
    return;
  const storageKey =
    "agent-office:studio:v1:" +
    (document.body.dataset.agentOfficePreview === "1" ? "preview" : "observer");
  let prefs;
  try {
    prefs = preferences(JSON.parse(localStorage.getItem(storageKey)));
  } catch {
    prefs = preferences();
  }
  const art = {
    ready: false,
    source: "loading",
    sprites: new Map(),
    directional: new Map(),
    directionalReady: false,
    directionalError: "",
    surfaces: new Map(),
    petDirectional: new Map(),
    environmentError: "",
    error: "",
    prefs,
    loading: false,
    handoffs: new Map(),
  };
  root.officeStudio = art;
  const original = {
    image: scene.image,
    character: scene.character,
    desk: scene.desk,
    pet: scene.pet,
    draw: scene.draw,
    update: scene.update,
    onPet: scene.onPet,
    agentCard,
    renderFurniturePreviews,
  };
  const portraits = new WeakMap(),
    petDistances = new Map(),
    handoffs = art.handoffs;
  let before = null,
    wasConnected = false;
  const enabled = () => art.ready && prefs.art === "studio";
  const sprite = (key) => (enabled() ? art.sprites.get(key) : null);
  function person(a) {
    const key = characterSpriteKey(a, scene.settings, scene.sprites);
    if (key === "studio-assistant") return 4;
    if (key === "orbit-courier") return 5;
    if (key === "moss-engineer") return 2;
    const index = /^char[0-5]$/.test(key)
      ? Number(key.slice(-1))
      : hash(a.id) % 6;
    return index >= 4 ? index + 2 : index;
  }
  function image(key, x, y, w, h) {
    const im = sprite(key);
    if (!im) return false;
    const scale = Math.min(w / im.width, h / im.height),
      iw = Math.max(1, Math.round(im.width * scale)),
      ih = Math.max(1, Math.round(im.height * scale));
    scene.ctx.drawImage(
      im,
      Math.round(x + (w - iw) / 2),
      Math.round(y + h - ih),
      iw,
      ih,
    );
    return true;
  }
  scene.image = function (key, x, y, w, h) {
    const selected =
      key === "sleepcat"
        ? `pet-${prefs.pets[0]}-sleep`
        : key.startsWith("taskterminal") &&
            this.taskTerminalState() === "failed"
          ? "taskterminal-failed"
          : key;
    return (
      image(selected, x, y, w, h) || original.image.call(this, key, x, y, w, h)
    );
  };
  scene.character = function (a, x, y, c) {
    const state = pose(a, c, this.time, this.paused),
      directional =
        enabled() &&
        art.directional.get(directionalKey(person(a), c, this.paused)),
      im =
        directional ||
        sprite(`person-${person(a)}-${state === "type" ? "idle" : state}`);
    if (!im) return original.character.call(this, a, x, y, c);
    const g = this.ctx,
      left = Math.round(x - 8),
      top = Math.round(y - 4);
    g.save();
    if (a.status === "gone") g.globalAlpha = 0.4;
    else if (a.status === "done") g.globalAlpha = 0.85;
    if (!directional && c.moving && c.dir === "left") {
      g.translate(left + 32, top);
      g.scale(-1, 1);
      g.drawImage(im, 0, 0);
    } else g.drawImage(im, left, top);
    if (this.cosmetics.includes("crown"))
      image("icon-crown", left + 9, top - 2, 14, 12);
    g.restore();
  };
  scene.desk = function (s) {
    const result = original.desk.call(this, s),
      c = this.chars.get(s.a.id);
    if (
      enabled() &&
      c &&
      !c.moving &&
      pose(s.a, c, this.time, this.paused) === "type"
    ) {
      const tap = this.paused ? 0 : Math.floor(this.time * 5) % 2;
      const skin =
        person(s.a) === 4
          ? "#e1e5d9"
          : person(s.a) === 5
            ? "#ad754b"
            : "#e8c49d";
      this.rect(s.x + 11, s.y + 7 + tap, 3, 2, skin);
      this.rect(s.x + 18, s.y + 8 - tap, 3, 2, skin);
    }
    return result;
  };
  scene.pet = function (x, y, black = false, behavior = {}) {
    const key = black ? "blackcat" : "cat",
      index = black ? 1 : 0,
      active = this.petActive === key && this.petUntil > this.time;
    const motion = petMotion(
      x,
      y,
      petDistances.get(key),
      this.geometry,
      this.paused,
      behavior.facing,
    );
    petDistances.set(key, motion);
    const state = { ...behavior, ...motion },
      directional =
        enabled() &&
        art.petDirectional.get(
          petDirectionalKey(prefs.pets[index], state, active, this.paused),
        ),
      im =
        directional ||
        sprite(
          `pet-${prefs.pets[index]}-${petPose(state, active, this.paused)}`,
        );
    if (!im) return original.pet.call(this, x, y, black, behavior);
    const left = Math.round(x - 10),
      top = Math.round(y - 18),
      g = this.ctx;
    g.save();
    if (!directional && behavior.facing < 0) {
      g.translate(left + 20, top);
      g.scale(-1, 1);
      g.drawImage(im, 0, 0, 20, 19);
    } else g.drawImage(im, left, top, 20, 19);
    g.restore();
    if (active) {
      image("icon-heart", x - 5, y - 27, 10, 10);
      const name =
        this.settings.pet_names?.[black ? "cat2" : "cat1"] ||
        (black ? "Gitcat" : "Claudio");
      this.text(name.slice(0, 16), x, y + 8, "#f0ddbe", 4, "center");
    }
    this.petHits.push({ key, x: left - 2, y: top - 2, w: 24, h: 23 });
  };
  scene.onPet = function (key) {
    if (!enabled()) return original.onPet?.(key);
    const second = key === "blackcat",
      index = prefs.pets[second ? 1 : 0];
    const name =
      this.settings.pet_names?.[second ? "cat2" : "cat1"] ||
      (second ? "Gitcat" : "Claudio");
    toast(companionFeedback(index, name));
  };
  scene.update = function (...args) {
    const next = args[0] || [],
      ids = new Set(next.map((a) => a.id));
    // A reconnect/bootstrap/removal is not a newly observed successful handoff.
    if (before && wasConnected && this.observerConnected && !this.paused)
      for (const a of next) {
        const prior = before.get(a.id);
        if (
          a.kind === "subagent" &&
          a.parent &&
          a.status === "done" &&
          prior &&
          !prior.failed &&
          !String(a.detail || "").startsWith("⚠ ") &&
          !["done", "gone"].includes(prior.status) &&
          ids.has(a.parent)
        ) {
          handoffs.set(a.id, { parent: a.parent, start: this.time });
          if (handoffs.size > 16) handoffs.delete(handoffs.keys().next().value);
        }
      }
    before = new Map(
      next.map((a) => [
        a.id,
        { status: a.status, failed: String(a.detail || "").startsWith("⚠ ") },
      ]),
    );
    wasConnected = !!this.observerConnected;
    for (const [id, h] of handoffs)
      if (!ids.has(id) || !ids.has(h.parent)) handoffs.delete(id);
    return original.update.apply(this, args);
  };
  scene.draw = function (...args) {
    const result = original.draw.apply(this, args);
    if (!enabled() || !this.grid || !this.transform) return result;
    const g = this.ctx,
      { scale, ox, oy } = this.transform,
      dpr = Math.min(devicePixelRatio || 1, 2);
    g.save();
    g.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
    g.imageSmoothingEnabled = false;
    if (this.settings.room_lights === false) g.globalAlpha = 0.45;
    if (this.settings.decorations && prefs.season !== "none") {
      const w = this.grid.w;
      const decorations =
        prefs.season === "winter"
          ? [
              ["holiday-tree", w - 34, 3, 24, 30],
              ["holiday-gift", w - 52, 17, 14, 14],
              ["holiday-wreath", 9, 8, 16, 16],
            ]
          : [
              ["holiday-pumpkin", w - 29, 15, 18, 18],
              ["holiday-ghost", 8, 8, 14, 20],
              ["holiday-bat", w / 2 - 11, 8, 22, 12],
            ];
      for (const p of decorations) image(...p);
    }
    for (const r of this.propReactions || []) {
      const age = this.time - r.started;
      if (age < 0 || age >= 4) continue;
      const kind =
        r.kind === "coffee"
          ? "coffee-steam"
          : ["cooler", "monstera", "fern", "planter", "succulent"].includes(
                r.kind,
              )
            ? "water-drops"
            : "sparkles";
      image(`fx-${kind}-${Math.floor(age * 4) % 4}`, r.x + 2, r.y - 10, 16, 16);
    }
    for (const [id, h] of handoffs) {
      const age = this.time - h.start;
      if (age < 0 || age >= 3 || !this.observerConnected) {
        handoffs.delete(id);
        continue;
      }
      const from = this.grid.seats.find((s) => s.a.id === id),
        to = this.grid.seats.find((s) => s.a.id === h.parent);
      if (!from || !to) continue;
      const t = Math.min(1, age / 2);
      image(
        "icon-parcel",
        from.x + 12 + (to.x - from.x) * t,
        from.y - 25 + (to.y - from.y) * t - Math.sin(t * Math.PI) * 12,
        12,
        12,
      );
    }
    g.restore();
    return result;
  };
  function paintPortrait(a, card) {
    if (!enabled()) return;
    const canvas = card.querySelector(".portrait"),
      im = sprite(`person-${person(a)}-idle`);
    if (
      !canvas ||
      !im ||
      (portraits.get(canvas) === im &&
        canvas.width === 24 &&
        canvas.height === 28)
    )
      return;
    canvas.width = 24;
    canvas.height = 28;
    const g = canvas.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.drawImage(im, 4, 5, 24, 28, 0, 0, 24, 28);
    portraits.set(canvas, im);
  }
  agentCard = function (a, existing) {
    // The native card owns content, focus and click handling. Studio owns its
    // pixels, avoiding a native repaint immediately underneath a studio repaint.
    const canvas = existing?.querySelector(".portrait");
    if (enabled() && canvas) {
      const native =
        scene.sprites[characterSpriteKey(a, settings, scene.sprites)];
      if (portraitSources.get(canvas) !== native) portraits.delete(canvas);
      portraitSources.set(canvas, native);
    }
    const card = original.agentCard(a, existing);
    paintPortrait(a, card);
    return card;
  };
  renderFurniturePreviews = function () {
    original.renderFurniturePreviews();
    if (!enabled()) return;
    for (const b of document.querySelectorAll("#furniture-tools [data-kind]")) {
      const im = sprite(b.dataset.kind);
      if (!im) continue;
      const c = b.querySelector("canvas"),
        g = c.getContext("2d"),
        k = Math.max(1, Math.floor(Math.min(104 / im.width, 88 / im.height)));
      g.clearRect(0, 0, c.width, c.height);
      g.imageSmoothingEnabled = false;
      g.drawImage(
        im,
        Math.round((120 - im.width * k) / 2),
        Math.round((104 - im.height * k) / 2),
        im.width * k,
        im.height * k,
      );
    }
  };
  function redraw() {
    document.documentElement.dataset.officeArt = enabled()
      ? "studio"
      : "classic";
    scene.roomSurfaces =
      enabled() && prefs.finish !== "classic"
        ? {
            floor: art.surfaces.get(`surface-${prefs.finish}-floor`),
            wall: art.surfaces.get(`surface-${prefs.finish}-wall`),
          }
        : null;
    for (const card of document.querySelectorAll(".agent-card[data-agent]")) {
      const a = agents.find((a) => a.id === card.dataset.agent);
      if (!a) continue;
      portraitSources.delete(card.querySelector(".portrait"));
      portraits.delete(card.querySelector(".portrait"));
      agentCard(a, card);
    }
    renderFurniturePreviews();
    scene.draw(0);
  }
  document.getElementById("c")?.addEventListener("spritesready", () => {
    if (art.ready) redraw();
  });
  const section = document.createElement("section");
  section.className = "studio-controls";
  section.setAttribute("aria-labelledby", "studio-art-heading");
  section.innerHTML =
    '<h3 id="studio-art-heading">Studio artwork</h3><p class="h">Characters, furniture and companion looks. These viewing preferences never change agent work or usage.</p><div class="studio-options"></div><p class="h" id="studio-art-status" role="status">Loading studio sprites…</p>';
  const options = section.querySelector(".studio-options"),
    status = section.querySelector("#studio-art-status");
  function select(label, id, choices, value, change) {
    const wrap = document.createElement("label");
    wrap.className = "studio-option";
    wrap.htmlFor = id;
    wrap.textContent = label;
    const input = document.createElement("select");
    input.id = id;
    for (const [v, text] of choices) {
      const option = document.createElement("option");
      option.value = v;
      option.textContent = text;
      input.append(option);
    }
    input.value = String(value);
    input.onchange = () => {
      change(input.value);
      art.prefs = prefs;
      let saved = true;
      try {
        localStorage.setItem(storageKey, JSON.stringify(prefs));
      } catch {
        saved = false;
      }
      redraw();
      status.textContent = !art.ready
        ? "Original artwork is active; studio sprites are unavailable."
        : saved
          ? "View saved on this browser."
          : "Applied for this visit; browser storage is unavailable.";
    };
    wrap.append(input);
    options.append(wrap);
  }
  select(
    "Artwork",
    "studio-art-choice",
    [
      ["studio", "Studio pixel art"],
      ["classic", "Original artwork"],
    ],
    prefs.art,
    (value) => {
      prefs = { ...prefs, art: value };
    },
  );
  select(
    "Room finish",
    "studio-room-finish",
    [
      ["oak", "Warm oak"],
      ["slate", "Blue slate"],
      ["classic", "Original theme"],
    ],
    prefs.finish,
    (value) => {
      prefs = { ...prefs, finish: value };
    },
  );
  select(
    "Wall decorations",
    "studio-season-choice",
    [
      ["none", "None"],
      ["autumn", "Autumn"],
      ["winter", "Winter"],
    ],
    prefs.season,
    (value) => {
      prefs = { ...prefs, season: value };
    },
  );
  for (let i = 0; i < 2; i++)
    select(
      i ? "Second companion look" : "First companion look",
      `studio-pet-${i}`,
      PET_NAMES.map((name, n) => [n, name]),
      prefs.pets[i],
      (value) => {
        const pets = [...prefs.pets];
        pets[i] = Number(value);
        prefs = { ...prefs, pets };
      },
    );
  section.append(
    Object.assign(document.createElement("p"), {
      className: "h",
      textContent:
        "Companion looks use the existing two pet slots. The second slot still requires its existing unlock. Seasonal wall art is decorative.",
    }),
  );
  // Keep appearance choices beside atmosphere settings, not after destructive
  // actions: the established reset/export reverse-tab order remains unchanged.
  const appearanceControls = document.getElementById("settingsbox");
  if (appearanceControls) appearanceControls.after(section);
  else document.querySelector("#sheet-settings .sheet-body")?.append(section);
  document.getElementById("toast")?.addEventListener("focusout", (event) => {
    const notice = event.target.closest(".toast");
    if (!notice) return;
    clearTimeout(toastTimers.get(notice));
    toastTimers.set(
      notice,
      setTimeout(() => {
        if (!notice.contains(document.activeElement)) notice.remove();
      }, 4500),
    );
  });
  function loadImage(index) {
    return new Promise((resolve, reject) => {
      const im = new Image(),
        timer = setTimeout(
          () => finish(new Error("Studio image timed out")),
          5000,
        );
      function finish(error) {
        clearTimeout(timer);
        im.onload = im.onerror = null;
        if (error) {
          im.removeAttribute("src");
          reject(error);
        } else resolve(im);
      }
      im.onload = () => finish();
      im.onerror = () => finish(new Error("Studio image unavailable"));
      im.src =
        "assets/sprites/studio/" +
        (typeof index === "number" ? `studio-${index}.png` : index);
    });
  }
  function paletteVariant(source, finish) {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 36;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(source, 0, 0);
    const pixels = context.getImageData(0, 0, 32, 36),
      d = pixels.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i],
        green = d[i + 1],
        b = d[i + 2];
      if (d[i + 3] && b > 60 && b > r * 1.4 && b > green * 1.1) {
        d[i] = Math.round(b * (finish === "rose" ? 0.85 : 0.46));
        d[i + 1] = Math.round(finish === "rose" ? green * 0.65 : b * 0.75);
        d[i + 2] = Math.round(b * (finish === "rose" ? 0.55 : 0.5));
      }
    }
    context.putImageData(pixels, 0, 0);
    return canvas;
  }
  async function loadDirectional() {
    const response = await fetch("assets/sprites/studio/directional.json", {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Directional manifest unavailable");
    const manifest = await response.json();
    if (!validDirectionalManifest(manifest))
      throw new Error("Invalid directional atlas");
    const image = await loadImage("directional.png");
    if (image.naturalWidth !== 384 || image.naturalHeight !== 216)
      throw new Error("Directional image dimensions differ");
    const atlas = document.createElement("canvas");
    atlas.width = 384;
    atlas.height = 216;
    const context = atlas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    if (root.crypto?.subtle) {
      const digest = await root.crypto.subtle.digest(
        "SHA-256",
        context.getImageData(0, 0, 384, 216).data,
      );
      if (
        [...new Uint8Array(digest)]
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("") !== manifest.rgbaSha256
      )
        throw new Error("Directional pixels failed integrity check");
    }
    const sprites = new Map();
    for (const [key, entry] of Object.entries(manifest.entries)) {
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 36;
      canvas.getContext("2d").drawImage(atlas, ...entry.rect, 0, 0, 32, 36);
      sprites.set(key, canvas);
    }
    for (const [id, finish] of [
      [6, "rose"],
      [7, "moss"],
    ])
      for (const direction of DIRECTIONS)
        for (const pose of WALK_POSES)
          sprites.set(
            `person-${id}-${direction}-${pose}`,
            paletteVariant(
              sprites.get(`person-3-${direction}-${pose}`),
              finish,
            ),
          );
    return sprites;
  }
  async function loadEnvironment(name) {
    const response = await fetch(`assets/sprites/studio/${name}.json`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`${name} manifest unavailable`);
    const manifest = await response.json();
    if (!validEnvironmentManifest(manifest, name))
      throw new Error(`Invalid ${name} atlas`);
    const image = await loadImage(name + ".png");
    if (
      image.naturalWidth !== manifest.width ||
      image.naturalHeight !== manifest.height
    )
      throw new Error(`${name} dimensions differ`);
    const atlas = document.createElement("canvas");
    atlas.width = manifest.width;
    atlas.height = manifest.height;
    const context = atlas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    if (root.crypto?.subtle) {
      const digest = await root.crypto.subtle.digest(
        "SHA-256",
        context.getImageData(0, 0, atlas.width, atlas.height).data,
      );
      if (
        [...new Uint8Array(digest)]
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("") !== manifest.rgbaSha256
      )
        throw new Error(`${name} pixels failed integrity check`);
    }
    const sprites = new Map();
    for (const [key, entry] of Object.entries(manifest.entries)) {
      const canvas = document.createElement("canvas");
      [canvas.width, canvas.height] = entry.rect.slice(2);
      canvas
        .getContext("2d")
        .drawImage(atlas, ...entry.rect, 0, 0, canvas.width, canvas.height);
      sprites.set(key, canvas);
    }
    return sprites;
  }
  async function load() {
    try {
      const response = await fetch("assets/sprites/studio/studio.json", {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("Studio manifest unavailable");
      const manifest = await response.json();
      if (
        !validManifest(manifest) ||
        manifest.width !== 512 ||
        manifest.height !== 323
      )
        throw new Error("Invalid studio atlas");
      const pages = await Promise.all(
          Array.from({ length: 8 }, (_, i) => loadImage(i)),
        ),
        atlas = document.createElement("canvas");
      atlas.width = 512;
      atlas.height = 323;
      const context = atlas.getContext("2d", { willReadFrequently: true });
      context.imageSmoothingEnabled = false;
      for (let i = 0; i < 8; i++) {
        if (
          pages[i].naturalWidth !== 512 ||
          pages[i].naturalHeight !== (i === 7 ? 43 : 40)
        )
          throw new Error("Studio image dimensions differ");
        context.drawImage(pages[i], 0, i * 40);
      }
      if (root.crypto?.subtle && typeof manifest.rgbaSha256 === "string") {
        const digest = await root.crypto.subtle.digest(
          "SHA-256",
          context.getImageData(0, 0, 512, 323).data,
        );
        if (
          [...new Uint8Array(digest)]
            .map((n) => n.toString(16).padStart(2, "0"))
            .join("") !== manifest.rgbaSha256
        )
          throw new Error("Studio pixels failed integrity check");
      }
      const sprites = new Map();
      for (const [key, entry] of Object.entries(manifest.entries)) {
        const c = document.createElement("canvas");
        [c.width, c.height] = entry.rect.slice(2);
        const g = c.getContext("2d");
        g.imageSmoothingEnabled = false;
        g.drawImage(atlas, ...entry.rect, 0, 0, c.width, c.height);
        sprites.set(key, c);
      }
      for (const [id, finish] of [
        [6, "rose"],
        [7, "moss"],
      ])
        for (const p of POSES) {
          sprites.set(
            `person-${id}-${p}`,
            paletteVariant(sprites.get(`person-3-${p}`), finish),
          );
        }
      addStudioDetails(sprites);
      art.directional = new Map();
      art.directionalError = "";
      try {
        art.directional = await loadDirectional();
      } catch (error) {
        art.directionalError = error.message;
      }
      art.directionalReady = art.directional.size === 96;
      art.environmentError = "";
      for (const [name, property] of [
        ["room-surfaces", "surfaces"],
        ["pet-walk", "petDirectional"],
      ]) {
        art[property] = new Map();
        try {
          art[property] = await loadEnvironment(name);
        } catch (error) {
          art.environmentError += error.message + ". ";
        }
      }
      art.sprites = sprites;
      art.ready = true;
      art.source = "studio";
      art.manifest = manifest;
      status.textContent =
        art.directionalReady && !art.environmentError
          ? "Studio sprites, room finishes and directional walking ready. Viewing choices stay on this browser."
          : "Studio sprites ready. Some optional artwork is unavailable; use Retry artwork to restore it.";
      redraw();
    } catch (error) {
      art.ready = false;
      art.sprites.clear();
      art.directional.clear();
      art.directionalReady = false;
      art.surfaces.clear();
      art.petDirectional.clear();
      art.source = "fallback";
      art.error = error.message;
      status.textContent =
        "Using original artwork. Studio sprites could not load.";
      redraw();
    }
    scene.studioArtSource = art.source;
  }
  // Retry only the optional atlas. Keep the document, form drafts, focus,
  // observer transport and saved preferences intact. Concurrent retries share
  // one attempt; consumers rebuild their caches only after it settles.
  let loadPromise = null;
  art.reload = function () {
    if (loadPromise) return loadPromise;
    art.loading = true;
    art.error = "";
    status.textContent = "Loading studio sprites…";
    loadPromise = load().finally(() => {
      art.loading = false;
      loadPromise = null;
      document.dispatchEvent(new Event("agent-office:studio-ready"));
    });
    document.dispatchEvent(new Event("agent-office:studio-loading"));
    return loadPromise;
  };
  art.reload();
})(typeof globalThis === "object" ? globalThis : this);
