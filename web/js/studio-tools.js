/* Native studio animation and inspection tools. Cosmetic only: no observer writes. */
(function (root) {
  "use strict";
  const PLANTS = ["succulent", "fern", "planter"];
  const KINDS = [
    "server",
    "coffee",
    "cooler",
    "robot",
    "recordplayer",
    "terrarium",
    "taskterminal-running",
    ...PLANTS,
  ];
  const LOOKS = [
    "Orange cat",
    "Tuxedo cat",
    "White cat",
    "Grey cat",
    "Corgi",
    "Black dog",
    "Golden dog",
    "Pocket robot",
  ];
  const PEOPLE = [
    "Brown-haired worker",
    "Copper-haired worker",
    "Indigo-haired worker",
    "Blond worker",
    "Studio robot",
    "Orbit courier",
    "Rose-shirt worker",
    "Moss-shirt worker",
  ];
  const NAMES = {
    focusbooth: "Focus booth",
    filingcabinet: "Filing cabinet",
    petbed: "Pet bed",
    roundtable: "Round table",
    coatrack: "Coat rack",
    fish_tank: "Fish tank",
    recordplayer: "Record player",
    taskterminal: "Task terminal",
    "taskterminal-running": "Task terminal running",
    "taskterminal-idle": "Task terminal idle",
    "taskterminal-failed": "Task terminal failed",
    "taskterminal-finished": "Task terminal finished",
    "taskterminal-disconnected": "Task terminal disconnected",
    "walk-a": "Walking, left step",
    "walk-b": "Walking, right step",
    type: "Typing",
    read: "Reading",
    attention: "Needs input",
    wait: "Waiting",
    cheer: "Celebrating",
    sleep: "Sleeping",
    sit: "Sitting",
    pet: "Petting",
    "surface-oak-floor": "Oak floor",
    "surface-oak-wall": "Oak wall",
    "surface-slate-floor": "Slate floor",
    "surface-slate-wall": "Slate wall",
  };
  const normalize = (value) =>
    String(value).toLowerCase().replace(/[-_]/g, " ");
  function friendlyName(value) {
    return (
      NAMES[value.toLowerCase()] ||
      normalize(value).replace(/^./, (letter) => letter.toUpperCase())
    );
  }
  function spriteLabel(key) {
    const animation =
        key.match(/-anim-(\d+)$/) ||
        (key.startsWith("fx-") && key.match(/-(\d+)$/)),
      base = animation ? key.slice(0, animation.index) : key,
      actor = base.match(/^(person|pet)-(\d+)-(.+)$/);
    let label;
    if (actor) {
      const names = actor[1] === "pet" ? LOOKS : PEOPLE,
        direction = actor[3].match(/^(up|down|left|right)-/),
        action = direction ? actor[3].slice(direction[0].length) : actor[3];
      label =
        (names[Number(actor[2])] ||
          `${actor[1] === "pet" ? "Companion" : "Character"} ${Number(actor[2]) + 1}`) +
        (direction
          ? " · Facing " +
            { down: "front", up: "back", left: "left", right: "right" }[
              direction[1]
            ]
          : "") +
        " · " +
        friendlyName(action);
    } else if (base.startsWith("icon-"))
      label = friendlyName(base.slice(5)) + " icon";
    else if (base.startsWith("fx-"))
      label = friendlyName(base.slice(3)) + " effect";
    else label = friendlyName(base);
    return (
      label + (animation ? ` · frame ${Number(animation[1]) + 1} of 4` : "")
    );
  }
  function frameKey(key, state = {}) {
    if (key === "lamp" && state.lights === false) return "lamp-off";
    if (key === "arcade" || key === "printer" || key === "lamp") {
      const time = Number.isFinite(state.time) ? Math.max(0, state.time) : 0;
      return (
        key +
        "-anim-" +
        (state.paused || (key === "printer" && !state.reacting)
          ? 0
          : Math.floor(time * (key === "arcade" ? 2 : 4)) % 4)
      );
    }
    const moving =
      key === "server" ||
      key === "taskterminal-running" ||
      (["coffee", "cooler", "robot", "terrarium", ...PLANTS].includes(key) &&
        state.reacting) ||
      (key === "recordplayer" && state.music);
    if (!moving || !KINDS.includes(key)) return key;
    const time = Number.isFinite(state.time) ? Math.max(0, state.time) : 0;
    return key + "-anim-" + (state.paused ? 0 : Math.floor(time * 4) % 4);
  }
  function makeFrames(sources, doc) {
    const frames = new Map();
    for (const kind of KINDS) {
      const source = sources.get(kind);
      if (!source) continue;
      for (let frame = 0; frame < 4; frame++) {
        const c = doc.createElement("canvas");
        c.width = source.width;
        c.height = source.height;
        const g = c.getContext("2d");
        g.imageSmoothingEnabled = false;
        g.drawImage(source, 0, 0);
        const pixel = (color, x, y, w = 1, h = 1) => {
          g.fillStyle = color;
          g.fillRect(x, y, w, h);
        };
        if (kind === "server") pixel("#86bfaf", 4, 6 + frame * 5, 2, 1);
        else if (kind === "coffee") {
          pixel("#f4e5cb", 14, 15, 3, 3);
          pixel("#7c523b", 15, 15);
          pixel("#e6dac4", 14 + (frame % 2), 11 - frame, 1, 2);
        } else if (kind === "cooler") {
          pixel("#182c42", 4, 17, 4, 7);
          pixel("#a1dbe7", 5, 18, 1, frame + 1);
          pixel("#e1e9e0", 4, 23, 4, 2);
        } else if (kind === "robot") {
          pixel("#28354f", 5, 8, 8, 5);
          pixel("#70d3b3", 6, 9, 2, frame === 2 ? 1 : 3);
          pixel("#70d3b3", 10, 9, 2, frame === 2 ? 1 : 3);
          pixel("#f4e5cb", 15, 15 - frame, 2, 3);
        } else if (kind === "recordplayer") {
          pixel("#f3c879", 12 + frame, 6, 1, 2);
          pixel("#7f929e", 19, 8 + frame, 1, 2);
        } else if (kind === "terrarium") {
          pixel("#ffe2a3", 7 + frame * 3, 10 + (frame % 2), 1, 2);
          pixel("#a8d5bb", 15 - frame * 2, 17 - frame);
        } else if (PLANTS.includes(kind)) {
          // Draw droplets inside the existing native cell. The leaves, pot,
          // baseline and collision footprint do not shift between frames.
          const x = Math.min(
              c.width - 2,
              Math.floor(c.width * (0.3 + frame * 0.13)),
            ),
            y = Math.max(1, Math.floor(c.height * 0.18) + (frame % 3));
          pixel("#99d3dd", x, y, 1, 2);
          pixel("#dbebd7", x + 1, y + 1);
        } else pixel("#75c9da", 8, 18, 2 + frame, 1);
        frames.set(kind + "-anim-" + frame, c);
      }
    }
    const lamp = sources.get("lamp");
    if (lamp) {
      const c = doc.createElement("canvas");
      c.width = lamp.width;
      c.height = lamp.height;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(lamp, 0, 0);
      const p = g.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < p.data.length; i += 4) {
        p.data[i] = Math.round(p.data[i] * 0.6);
        p.data[i + 1] = Math.round(p.data[i + 1] * 0.65);
        p.data[i + 2] = Math.round(p.data[i + 2] * 0.8);
      }
      g.putImageData(p, 0, 0);
      frames.set("lamp-off", c);
    }
    return frames;
  }
  function fitRect(source, x, y, width, height) {
    const scale = Math.min(width / source.width, height / source.height),
      w = Math.max(1, Math.round(source.width * scale)),
      h = Math.max(1, Math.round(source.height * scale));
    return [Math.round(x + (width - w) / 2), Math.round(y + height - h), w, h];
  }
  function spriteGroup(key) {
    if (key.startsWith("person-")) return "characters";
    if (key.startsWith("pet-")) return "companions";
    if (/^(icon|fx)-/.test(key)) return "effects";
    return "furniture";
  }
  function filterKeys(keys, query = "", group = "all") {
    const queryText = normalize(query).trim().replace(/\s+/g, " "),
      effectFrame = keys.find(
        (key) => /^fx-.+-\d+$/.test(key) && normalize(key) === queryText,
      );
    // Effect IDs use a bare zero-based suffix. An exact ID must not also
    // match the preceding frame's one-based friendly description.
    if (effectFrame)
      return group === "all" || group === "effects" ? [effectFrame] : [];
    const identities = [],
      animations = [],
      displayFrames = [],
      words = queryText
        // Identity and frame numbers describe different fields. Do not let an
        // actor index match the trailing frame index of an unrelated actor.
        .replace(/\b(person|pet)\s+(\d+)\b/g, (_, kind, index) => {
          identities.push(`${kind}-${index}-`);
          return " ";
        })
        .replace(/\banim\s+(\d+)\b/g, (_, index) => {
          animations.push(`-anim-${index}`);
          return " ";
        })
        .replace(/\bframe\s+(\d+)\b/g, (_, number) => {
          displayFrames.push(Number(number) - 1);
          return " ";
        })
        .split(/\s+/)
        .filter(Boolean);
    return keys.filter(
      (key) =>
        (group === "all" || spriteGroup(key) === group) &&
        identities.every((identity) => key.startsWith(identity)) &&
        animations.every((animation) => key.endsWith(animation)) &&
        displayFrames.every(
          (index) =>
            key.endsWith(`-anim-${index}`) ||
            (key.startsWith("fx-") && key.endsWith(`-${index}`)),
        ) &&
        words.every((word) =>
          (normalize(key) + " " + normalize(spriteLabel(key))).includes(word),
        ),
    );
  }
  function animationKeys(key, keys) {
    const available = new Set(keys);
    if (!available.has(key)) return [];
    const family = key.replace(/-anim-\d+$/, ""),
      life = Array.from({ length: 4 }, (_, i) => family + "-anim-" + i);
    if (
      /^(?:pet-\d+-(?:idle|sleep|happy)|person-\d+-(?:type|read|attention|idle|cheer|error))(?:-anim-\d+)?$/.test(
        key,
      ) &&
      life.every((frame) => available.has(frame))
    )
      return life;
    const actor = key.match(
      /^((?:person|pet)-\d+(?:-(?:up|down|left|right))?)-(?:idle|walk-a|walk-b)$/,
    );
    if (actor) {
      const walk = ["idle", "walk-a", "walk-b", "walk-a"].map(
        (pose) => actor[1] + "-" + pose,
      );
      if (walk.every((k) => available.has(k))) return walk;
    }
    const base = key.replace(/-anim-\d+$/, ""),
      prefix = /^fx-.*-\d+$/.test(key)
        ? key.replace(/-\d+$/, "")
        : base + "-anim",
      frames = Array.from({ length: 4 }, (_, i) => prefix + "-" + i);
    return frames.every((k) => available.has(k)) ? frames : [key];
  }
  const api = {
    frameKey,
    makeFrames,
    fitRect,
    spriteLabel,
    filterKeys,
    animationKeys,
    kinds: KINDS,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof document === "undefined") return;
  if (root.officeStudioTools) return;
  root.officeStudioTools = api;
  let installed = false,
    refreshUI = null;
  function install() {
    const art = root.officeStudio;
    if (
      !art ||
      art.loading ||
      art.source === "loading" ||
      typeof scene === "undefined"
    )
      return;
    if (installed) {
      refreshUI?.();
      return;
    }
    const section = document.querySelector(".studio-controls");
    if (!section) return;
    installed = true;
    const frames = new Map(),
      all = new Map();
    api.frames = frames;
    const enabled = () => art.ready && art.prefs.art === "studio";
    const originalPropDetails = scene.propUsesSpriteDetails;
    scene.propUsesSpriteDetails = function (kind) {
      const terminalKey =
        kind === "taskterminal" ? this.taskTerminalSpriteKey() : null;
      // The neutral fallback has no running signal; keep its activity lamp.
      const terminalDetails =
        terminalKey &&
        art.sprites.has(terminalKey) &&
        (terminalKey !== "taskterminal" ||
          this.taskTerminalState() !== "running");
      // The static Studio arcade also owns its screen when its loop is missing.
      return (
        (enabled() &&
          (frames.has(kind + "-anim-0") ||
            (kind === "arcade" && art.sprites.has(kind)) ||
            terminalDetails)) ||
        originalPropDetails?.call(this, kind) ||
        false
      );
    };
    const originalImage = scene.image,
      originalCharacter = scene.character;
    scene.image = function (key, x, y, w, h) {
      const reaction = this.propReaction(key, x, y),
        selected = frameKey(key, {
          lights: this.settings.room_lights,
          time: key === "printer" ? (reaction ?? 0) : this.time,
          paused: this.paused,
          music: this.musicPlaying,
          reacting:
            reaction !== null ||
            (key === "robot" && this.cosmetics.includes("robot_wave")) ||
            (key === "terrarium" && this.cosmetics.includes("terrarium_glow")),
        });
      const image = enabled() && frames.get(selected);
      if (!image) return originalImage.call(this, key, x, y, w, h);
      this.ctx.drawImage(image, ...fitRect(image, x, y, w, h));
      return true;
    };
    // Mirror the complete character in one actor-centered coordinate system.
    // In particular, the crown keeps the same world-space center as the head.
    scene.character = function (agent, x, y, motion) {
      if (
        !enabled() ||
        !motion.moving ||
        motion.dir !== "left" ||
        art.directionalReady
      )
        return originalCharacter.call(this, agent, x, y, motion);
      this.ctx.save();
      // The actor spans x-8..x+24. Reflection about its center x+8 uses
      // x' = 2*(x+8)-x; this also keeps its crown centered.
      this.ctx.translate(2 * x + 16, 0);
      this.ctx.scale(-1, 1);
      try {
        return originalCharacter.call(this, agent, x, y, {
          ...motion,
          dir: "right",
        });
      } finally {
        this.ctx.restore();
      }
    };
    function syncLabels() {
      for (const [i, originalName] of ["Orange cat", "Black cat"].entries()) {
        const look = enabled() ? LOOKS[art.prefs.pets[i]] : originalName;
        const label = document.querySelector(
          `label[for="pet-cat${i + 1}-name"]`,
        );
        if (label) label.textContent = look;
        const button = document.querySelector(
          `[data-activity="Pet the ${i ? "black" : "orange"} cat"]`,
        );
        if (button)
          button.textContent = enabled()
            ? "Pet the " + look
            : "Pet the " + originalName.toLowerCase();
      }
    }
    const originalSync = root.officeRoom?.sync;
    if (originalSync)
      root.officeRoom.sync = function (...args) {
        const result = originalSync(...args);
        syncLabels();
        return result;
      };
    section.addEventListener("change", (event) => {
      if (
        event.target.matches("#studio-art-choice, #studio-pet-0, #studio-pet-1")
      )
        syncLabels();
    });
    syncLabels();
    const status = document.getElementById("studio-art-status");
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "btn";
    retry.id = "studio-art-retry";
    retry.textContent = "Retry artwork";
    retry.title =
      "Retry the artwork without reloading or losing unsaved changes.";
    retry.onclick = () => {
      if (!art.loading) art.reload();
    };
    status?.after(retry);
    const gallery = document.createElement("details");
    gallery.id = "studio-gallery";
    gallery.className = "storage-diagnostics";
    gallery.innerHTML = `
      <summary>Preview &amp; download sprites</summary>
      <p class="h">Native PNGs and animation strips preserve the original transparency. Cosmetic effects never change agent work or accounting.</p>
      <div class="studio-options">
        <label class="studio-option" for="studio-sprite-search">Find sprites<input id="studio-sprite-search" class="txt" type="search" maxlength="100" placeholder="For example, orange cat or person 0" /></label>
        <label class="studio-option" for="studio-sprite-group">Category<select id="studio-sprite-group"><option value="all">All sprites</option><option value="characters">Characters</option><option value="companions">Companions</option><option value="furniture">Furniture</option><option value="effects">Effects &amp; icons</option></select></label>
      </div>
      <button type="button" class="btn" id="studio-clear-filters" hidden>Clear filters</button>
      <p id="studio-gallery-count" class="h" role="status"></p>
      <label class="studio-option" for="studio-sprite-choice">Studio sprite<select id="studio-sprite-choice"></select></label>
      <div class="studio-preview-stage">
        <canvas id="studio-sprite-preview" width="128" height="128" role="img" aria-label="Selected studio sprite" aria-describedby="studio-sprite-info"></canvas>
        <div class="studio-preview-controls">
          <div class="cluster"><button type="button" class="btn" id="studio-preview-play" aria-pressed="false">Play animation</button><button type="button" class="btn" id="studio-sprite-download">Download PNG</button><button type="button" class="btn" id="studio-strip-download">Download strip</button></div>
        </div>
      </div>
      <p id="studio-sprite-info" class="h"></p>
      <p id="studio-gallery-message" class="h" role="status"></p>`;
    section.append(gallery);
    const select = gallery.querySelector("#studio-sprite-choice"),
      search = gallery.querySelector("#studio-sprite-search"),
      group = gallery.querySelector("#studio-sprite-group"),
      clear = gallery.querySelector("#studio-clear-filters"),
      preview = gallery.querySelector("canvas"),
      save = gallery.querySelector("#studio-sprite-download"),
      strip = gallery.querySelector("#studio-strip-download"),
      play = gallery.querySelector("#studio-preview-play"),
      info = gallery.querySelector("#studio-sprite-info"),
      count = gallery.querySelector("#studio-gallery-count"),
      message = gallery.querySelector("#studio-gallery-message"),
      motion = matchMedia("(prefers-reduced-motion: reduce)");
    let playing = false,
      raf = null,
      started = null,
      exportGeneration = 0;
    const transparency = new WeakMap();
    function imageTransparency(source) {
      if (!transparency.has(source)) {
        const rgba = source
          .getContext("2d")
          .getImageData(0, 0, source.width, source.height).data;
        transparency.set(
          source,
          rgba.some((value, index) => index % 4 === 3 && value < 255),
        );
      }
      return transparency.get(source) ? "transparent" : "opaque";
    }
    function sequence() {
      const keys = animationKeys(select.value, all.keys()),
        first = all.get(keys[0]);
      return first &&
        keys.every(
          (k) =>
            all.get(k)?.width === first.width &&
            all.get(k)?.height === first.height,
        )
        ? keys
        : [];
    }
    function repaint(key = select.value) {
      const source = all.get(key),
        g = preview.getContext("2d");
      g.clearRect(0, 0, 128, 128);
      g.imageSmoothingEnabled = false;
      if (source) {
        const scale = Math.max(
          1,
          Math.floor(112 / Math.max(source.width, source.height)),
        );
        g.drawImage(
          source,
          Math.floor((128 - source.width * scale) / 2),
          Math.floor((128 - source.height * scale) / 2),
          source.width * scale,
          source.height * scale,
        );
      }
      preview.dataset.frame = key;
      preview.setAttribute(
        "aria-label",
        source ? spriteLabel(key) + " native sprite" : "No matching sprites",
      );
    }
    function stop() {
      playing = false;
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
      started = null;
      play.setAttribute("aria-pressed", "false");
      play.textContent = "Play animation";
      repaint();
    }
    function canPlay() {
      return (
        art.ready &&
        !art.loading &&
        gallery.open &&
        !document.hidden &&
        !scene.paused &&
        !motion.matches &&
        !section.closest(".sheet")?.hidden
      );
    }
    function tick(time) {
      raf = null;
      if (!playing) return;
      if (!canPlay()) {
        stop();
        return;
      }
      if (started === null) started = time;
      const frames = sequence(),
        key = frames[Math.floor((time - started) / 250) % frames.length];
      if (key && key !== preview.dataset.frame) repaint(key);
      raf = requestAnimationFrame(tick);
    }
    play.onclick = () => {
      if (playing) {
        stop();
        return;
      }
      if (!canPlay()) {
        message.textContent =
          "Motion is paused. Resume office motion to preview this animation.";
        return;
      }
      if (sequence().length < 2) return;
      message.textContent =
        "Preview only · 4 frames per second. No agent events are created.";
      playing = true;
      started = null;
      play.textContent = "Stop preview";
      play.setAttribute("aria-pressed", "true");
      scrollSheetToTarget(gallery.querySelector(".studio-preview-stage"));
      raf = requestAnimationFrame(tick);
    };
    function selectionChanged() {
      exportGeneration++;
      stop();
      const source = all.get(select.value),
        frames = sequence();
      save.disabled = !source || art.loading;
      strip.disabled = frames.length < 2 || art.loading;
      play.disabled = frames.length < 2 || art.loading;
      info.textContent = source
        ? `${source.width} × ${source.height} px · ${frames.length} frame${frames.length === 1 ? "" : "s"} · ${imageTransparency(source)} PNG`
        : "Try a different search or category.";
      message.textContent = "";
    }
    function filter() {
      const previous = select.value,
        keys = filterKeys([...all.keys()].sort(), search.value, group.value);
      select.replaceChildren(
        ...keys.map((key) => {
          const option = document.createElement("option");
          option.value = key;
          option.textContent = spriteLabel(key);
          option.title = key;
          return option;
        }),
      );
      select.value = keys.includes(previous)
        ? previous
        : keys.includes("robot-anim-0")
          ? "robot-anim-0"
          : keys[0] || "";
      select.disabled = keys.length === 0;
      clear.hidden = !search.value && group.value === "all";
      count.textContent = `${keys.length} of ${all.size} sprites`;
      selectionChanged();
    }
    search.oninput = filter;
    group.onchange = filter;
    clear.onclick = () => {
      search.value = "";
      group.value = "all";
      filter();
      search.focus({ preventScroll: true });
      scrollSheetToTarget(search.closest("label") || search);
    };
    select.onchange = selectionChanged;
    function download(source, name) {
      const generation = ++exportGeneration;
      source.toBlob((blob) => {
        if (
          generation === exportGeneration &&
          gallery.open &&
          !section.closest(".sheet")?.hidden &&
          !art.loading
        )
          message.textContent = blob
            ? "PNG exported at its native dimensions."
            : "Could not export this image. Try again.";
        if (blob) downloadBlob(blob, name);
      }, "image/png");
    }
    save.onclick = () => {
      const key = select.value,
        source = all.get(key);
      if (source && !art.loading)
        download(source, "agent-office-" + key + ".png");
    };
    strip.onclick = () => {
      const key = select.value,
        keys = sequence(),
        first = all.get(keys[0]);
      if (!first || keys.length < 2 || art.loading) return;
      const canvas = document.createElement("canvas");
      canvas.width = first.width * keys.length;
      canvas.height = first.height;
      const context = canvas.getContext("2d");
      context.imageSmoothingEnabled = false;
      keys.forEach((k, i) => context.drawImage(all.get(k), i * first.width, 0));
      download(canvas, "agent-office-" + key + "-strip.png");
    };
    function suspend() {
      exportGeneration++;
      stop();
    }
    gallery.querySelector("summary").addEventListener("click", () => {
      if (gallery.open) suspend();
    });
    gallery.addEventListener("toggle", () => {
      if (!gallery.open) suspend();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) suspend();
    });
    root.addEventListener("pagehide", suspend);
    motion.addEventListener("change", () => {
      if (motion.matches) stop();
    });
    const panel = section.closest(".sheet");
    if (panel)
      new MutationObserver((records) => {
        if (panel.hidden || records.some((record) => record.oldValue === null))
          suspend();
      }).observe(panel, {
        attributes: true,
        attributeFilter: ["hidden"],
        attributeOldValue: true,
      });
    function syncLoading() {
      section.setAttribute("aria-busy", String(art.loading));
      // Native disabled would discard keyboard focus mid-request. Keep focus
      // until recovery can move it to the visible status before hiding Retry.
      retry.setAttribute("aria-disabled", String(art.loading));
      retry.textContent = art.loading ? "Loading artwork…" : "Retry artwork";
      if (art.loading) {
        stop();
        save.disabled = strip.disabled = play.disabled = true;
      }
    }
    document.addEventListener("agent-office:studio-loading", syncLoading);
    refreshUI = () => {
      stop();
      frames.clear();
      all.clear();
      if (art.ready) {
        // Visual audit: the source crop contains an unrelated 2×7 fragment
        // at the fern's upper-left edge. Clear only this verified transparent
        // margin in the decoded canvas; keep the original PNG and plant intact.
        const fern = art.sprites.get("fern");
        if (fern?.width === 26 && fern.height === 28)
          fern.getContext("2d").clearRect(4, 0, 2, 7);
        renderFurniturePreviews();
        for (const [key, value] of makeFrames(art.sprites, document))
          frames.set(key, value);
        for (const [key, value] of art.propLife || []) frames.set(key, value);
        for (const [key, value] of art.workplaceLife || [])
          frames.set(key, value);
        for (const [key, value] of art.loungeLife || []) frames.set(key, value);
        for (const [key, value] of [
          ...art.sprites,
          ...art.directional,
          ...art.petDirectional,
          ...art.petLife,
          ...(art.characterLife || []),
          ...(art.characterReactions || []),
          ...art.surfaces,
          ...frames,
        ])
          all.set(key, value);
      }
      if (art.ready && document.activeElement === retry && status) {
        status.tabIndex = -1;
        status.focus({ preventScroll: true });
      }
      retry.hidden =
        art.ready && !art.directionalError && !art.environmentError;
      gallery.hidden = !art.ready;
      syncLoading();
      syncLabels();
      filter();
      scene.draw(0);
    };
    refreshUI();
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "css/studio-tools.css";
    document.head.append(css);
    scene.draw(0);
    document.dispatchEvent(new Event("agent-office:studio-tools-ready"));
  }
  document.addEventListener("agent-office:studio-ready", install);
  install();
})(globalThis);
