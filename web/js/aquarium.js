/* A quiet, optional toy. Only aquarium preferences are persisted. */
"use strict";
(() => {
  const WIDTH = 360,
    HEIGHT = 210,
    MAX_PELLETS = 12,
    FEED_COOLDOWN = 1600,
    REACTION_DURATION = 0.72,
    RIPPLE_DURATION = 0.85,
    IMAGE_TIMEOUT_MS = 5000;
  const SPECIES = [
    {
      id: "ember",
      name: "Ember",
      kind: "Goldfish",
      color: "#f4b266",
      size: [24, 16],
      requirement: "Always available",
    },
    {
      id: "mint",
      name: "Mint",
      kind: "Guppy",
      color: "#8ed5bc",
      size: [22, 14],
      requirement: "10 read/search tools",
    },
    {
      id: "violet",
      name: "Violet",
      kind: "Betta",
      color: "#b5a4ed",
      size: [26, 20],
      requirement: "25 tool starts",
    },
    {
      id: "pearl",
      name: "Pearl",
      kind: "Angelfish",
      color: "#e9e5c8",
      size: [20, 24],
      requirement: "1 valid usage report",
    },
  ];
  // Original bundled artwork is the default. An optional local manifest can
  // override it without copying private source sheets into the public bundle.
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  class AquariumHabitat {
    constructor() {
      this.fish = [];
      this.pellets = [];
      this.ripples = [];
      this.time = 0;
      this.lastFeedAt = -Infinity;
      this.eaten = 0;
    }
    select(ids) {
      this.fish = SPECIES.filter((species) => ids.includes(species.id)).map(
        (species) => {
          const existing = this.fish.find((fish) => fish.id === species.id);
          const index = SPECIES.indexOf(species);
          return (
            existing || {
              id: species.id,
              x: 76 + index * 62,
              y: 70 + (index % 3) * 35,
              vx: index % 2 ? -12 : 12,
              vy: index % 2 ? 2 : -2,
              snacks: 0,
              glow: 0,
              reaction: 0,
            }
          );
        },
      );
      if (!this.fish.length) {
        this.pellets = [];
        this.ripples = [];
      }
    }
    fishAt(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return (
        [...this.fish].reverse().find((fish) => {
          const species = SPECIES.find((item) => item.id === fish.id),
            hitWidth = Math.max(18, species.size[0] / 2 + 7),
            hitHeight = Math.max(14, species.size[1] / 2 + 6);
          return (
            Math.abs(x - fish.x) <= hitWidth &&
            Math.abs(y - fish.y) <= hitHeight
          );
        }) || null
      );
    }
    react(id, animate = true) {
      const fish = this.fish.find((item) => item.id === id);
      if (!fish) return false;
      if (animate) fish.reaction = REACTION_DURATION;
      return true;
    }
    feed(x, now, instant = false) {
      if (!this.fish.length) return "empty";
      x = Number.isFinite(x) ? x : WIDTH / 2;
      if (now - this.lastFeedAt < FEED_COOLDOWN) return "cooldown";
      // Still-mode care adds no falling food, even when the paused queue is full.
      if (!instant && this.pellets.length + 3 > MAX_PELLETS) return "full";
      this.lastFeedAt = now;
      if (instant) {
        for (const fish of this.fish) {
          fish.snacks++;
          fish.glow = 1.4;
          this.eaten++;
        }
      } else {
        this.ripples.push({ x: clamp(x, 24, WIDTH - 24), age: 0 });
        this.ripples = this.ripples.slice(-4);
        for (let index = -1; index <= 1; index++)
          this.pellets.push({
            x: clamp(x + index * 7, 24, WIDTH - 24),
            y: 29 + Math.abs(index) * 3,
            age: 0,
          });
      }
      return "fed";
    }
    step(seconds) {
      const dt = clamp(Number(seconds) || 0, 0, 0.08);
      this.time += dt;
      for (const ripple of this.ripples) ripple.age += dt;
      this.ripples = this.ripples.filter(
        (ripple) => ripple.age < RIPPLE_DURATION,
      );
      for (const pellet of this.pellets) {
        pellet.y += dt * 8;
        pellet.age += dt;
      }
      this.pellets = this.pellets.filter(
        (pellet) => pellet.age < 16 && pellet.y < HEIGHT - 28,
      );
      for (const fish of this.fish) {
        const reacting = fish.reaction > 0,
          swimSpeed = reacting ? 2.8 : 1;
        let target = null,
          distance = Infinity;
        for (const pellet of this.pellets) {
          const next = Math.hypot(pellet.x - fish.x, pellet.y - fish.y);
          if (next < distance) {
            target = pellet;
            distance = next;
          }
        }
        if (target) {
          if (distance < 8) {
            this.pellets.splice(this.pellets.indexOf(target), 1);
            fish.snacks++;
            fish.glow = 1.4;
            this.eaten++;
          } else {
            const dx = target.x - fish.x,
              dy = target.y - fish.y;
            fish.vx = dx < 0 ? -12 : 12;
            fish.x += (dx / distance) * dt * 25 * swimSpeed;
            fish.y += (dy / distance) * dt * 25 * swimSpeed;
          }
        } else {
          fish.x += fish.vx * dt * swimSpeed;
          fish.y += fish.vy * dt * swimSpeed;
        }
        if (
          (fish.x <= 24 && fish.vx < 0) ||
          (fish.x >= WIDTH - 24 && fish.vx > 0)
        ) {
          fish.vx *= -1;
        }
        if (
          (fish.y <= 36 && fish.vy < 0) ||
          (fish.y >= HEIGHT - 38 && fish.vy > 0)
        ) {
          fish.vy *= -1;
        }
        fish.x = clamp(fish.x, 24, WIDTH - 24);
        fish.y = clamp(fish.y, 36, HEIGHT - 38);
        fish.glow = Math.max(0, fish.glow - dt);
        fish.reaction = Math.max(0, fish.reaction - dt);
      }
    }
    snapshot() {
      return {
        fish: this.fish.map((fish) => ({ ...fish })),
        pellets: this.pellets.map((pellet) => ({ ...pellet })),
        ripples: this.ripples.map((ripple) => ({ ...ripple })),
        time: this.time,
        eaten: this.eaten,
      };
    }
  }
  if (typeof module !== "undefined" && module.exports)
    module.exports = {
      AquariumHabitat,
      SPECIES,
      WIDTH,
      HEIGHT,
      MAX_PELLETS,
      FEED_COOLDOWN,
    };
  if (typeof document === "undefined") return;
  const byId = (id) => document.getElementById(id);
  const panel = byId("sheet-aquarium"),
    canvas = byId("aquarium-canvas"),
    ctx = canvas.getContext("2d");
  const habitat = new AquariumHabitat(),
    reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const sprites = new Map(),
    images = new Map(),
    cards = new Map();
  let frame = 0,
    timer = 0,
    lastFrame = 0,
    paintedFrames = 0,
    localPause = false;
  let loading = false,
    loaded = false,
    assetErrors = 0,
    artSource = "pixel",
    savingSpecies = false,
    savingLight = false,
    inspectedFish = "",
    nameDraft = false,
    nameRevision = 0;
  const active = () => !panel.hidden && !document.hidden;
  const moving = () =>
    active() &&
    !localPause &&
    !reducedMotion.matches &&
    !window.officeScene?.paused;
  const prefs = () => (typeof settings === "object" ? settings : {});
  function unlocks() {
    const state = window._state || {},
      stats = state.progress?.stats || {};
    return {
      ember: true,
      mint: Number(stats.reads) >= 10,
      violet: Number(stats.tools) >= 25,
      pearl: Number(state.usage?.totals?.reports) >= 1,
    };
  }
  function selected() {
    const ids = prefs().aquarium_species;
    return Array.isArray(ids)
      ? ids.filter((id) => SPECIES.some((species) => species.id === id))
      : ["ember"];
  }
  function fallback(context, species, x, y) {
    context.fillStyle = species.color;
    context.fillRect(x - 8, y - 4, 13, 8);
    context.fillRect(x - 5, y - 6, 8, 12);
    context.fillRect(x - 13, y - 6, 4, 12);
    context.fillRect(x - 10, y - 3, 4, 6);
    context.fillStyle = "#172d39";
    context.fillRect(x + 2, y - 2, 2, 2);
  }
  function drawFish(context, fish, x = fish.x, y = fish.y, scale = 1) {
    const species = SPECIES.find((item) => item.id === fish.id),
      frames = sprites.get(fish.id),
      sprite = frames?.[Math.floor(habitat.time * 5) % frames.length],
      reacting = Number(fish.reaction) > 0,
      bob = reacting ? Math.sin(habitat.time * 34) * 2 : 0;
    context.save();
    context.translate(Math.round(x), Math.round(y + bob));
    context.scale(
      fish.vx < 0 ? -scale : scale,
      scale * (reacting ? 1 + Math.sin(habitat.time * 28) * 0.08 : 1),
    );
    if (sprite)
      context.drawImage(
        sprite,
        -Math.floor(sprite.width / 2),
        -Math.floor(sprite.height / 2),
      );
    else fallback(context, species, 0, 0);
    context.restore();
  }
  function paint() {
    if (!active()) return;
    paintedFrames++;
    ctx.imageSmoothingEnabled = false;
    const water = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    const light = prefs().aquarium_light !== false;
    water.addColorStop(0, light ? "#28515d" : "#1b3643");
    water.addColorStop(1, light ? "#142d3c" : "#0d202d");
    ctx.fillStyle = water;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = "#9cdcc633";
    ctx.fillRect(10, 18, WIDTH - 20, 2);
    ctx.fillStyle = light ? "#b5e5d012" : "#b5e5d006";
    ctx.beginPath();
    ctx.moveTo(55, 20);
    ctx.lineTo(76, 20);
    ctx.lineTo(190, HEIGHT);
    ctx.lineTo(124, HEIGHT);
    ctx.fill();
    ctx.fillStyle = "#6e7564";
    ctx.fillRect(0, HEIGHT - 24, WIDTH, 24);
    ctx.fillStyle = "#929581";
    ctx.fillRect(0, HEIGHT - 26, WIDTH, 3);
    for (let i = 0; i < 32; i++) {
      ctx.fillStyle = i % 2 ? "#59665a" : "#a2a28a";
      ctx.fillRect((i * 43 + 7) % WIDTH, HEIGHT - 20 + ((i * 7) % 17), 3, 2);
    }
    for (const [x, tall] of [
      [24, 49],
      [43, 30],
      [315, 61],
      [336, 38],
    ]) {
      ctx.fillStyle = "#3d8273";
      ctx.fillRect(x, HEIGHT - 24 - tall, 3, tall);
      for (let branch = 0; branch < 4; branch++) {
        ctx.fillStyle = branch % 2 ? "#5fa38a" : "#3d8273";
        ctx.fillRect(
          x + (branch % 2 ? 0 : -8),
          HEIGHT - 31 - branch * 10,
          10,
          4,
        );
      }
    }
    ctx.fillStyle = "#394e50";
    ctx.fillRect(268, HEIGHT - 36, 28, 12);
    ctx.fillRect(273, HEIGHT - 42, 17, 7);
    for (let i = 0; i < 6; i++) {
      const x = 286 + (i % 2) * 5,
        y = HEIGHT - 43 - ((habitat.time * 11 + i * 27) % 130);
      ctx.strokeStyle = "#addbd244";
      ctx.strokeRect(x, Math.round(y), 2 + (i % 2), 2 + (i % 2));
    }
    // Surface ripples share the habitat clock, including every pause state.
    ctx.save();
    for (const ripple of habitat.ripples) {
      const phase = ripple.age / RIPPLE_DURATION;
      ctx.globalAlpha = (1 - phase) * 0.6;
      ctx.strokeStyle = "#b0e1d1";
      ctx.beginPath();
      ctx.ellipse(
        ripple.x,
        27,
        3 + phase * 16,
        1 + phase * 3,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
    ctx.restore();
    for (const pellet of habitat.pellets) {
      ctx.fillStyle = "#e8c884";
      ctx.fillRect(Math.round(pellet.x), Math.round(pellet.y), 2, 2);
    }
    for (const fish of habitat.fish) {
      drawFish(ctx, fish);
      if (fish.reaction > 0) {
        const phase = (REACTION_DURATION - fish.reaction) * 24;
        ctx.strokeStyle = "#d8f3e099";
        for (let bubble = 0; bubble < 3; bubble++) {
          const bx = Math.round(fish.x + 11 + bubble * 4),
            by = Math.round(fish.y - 8 - ((phase + bubble * 5) % 15));
          ctx.strokeRect(bx, by, 2 + (bubble % 2), 2 + (bubble % 2));
        }
      }
      if (fish.glow > 0) {
        ctx.fillStyle = "#f6c5af";
        ctx.fillRect(Math.round(fish.x) - 2, Math.round(fish.y) - 20, 2, 3);
        ctx.fillRect(Math.round(fish.x) + 1, Math.round(fish.y) - 20, 2, 3);
        ctx.fillRect(Math.round(fish.x) - 1, Math.round(fish.y) - 18, 3, 2);
      }
    }
    ctx.strokeStyle = "#cce5cf1c";
    ctx.strokeRect(5, 5, WIDTH - 10, HEIGHT - 10);
  }
  function loadImage(src) {
    if (!images.has(src))
      images.set(
        src,
        new Promise((resolve, reject) => {
          const image = new Image();
          const cleanup = () => {
            clearTimeout(timeout);
            image.onload = null;
            image.onerror = null;
          };
          const timeout = setTimeout(() => {
            cleanup();
            image.removeAttribute("src");
            reject(new Error("Fish image timed out"));
          }, IMAGE_TIMEOUT_MS);
          image.onload = () => {
            cleanup();
            resolve(image);
          };
          image.onerror = () => {
            cleanup();
            reject(new Error("Fish image unavailable"));
          };
          image.src = src;
        }),
      );
    return images.get(src);
  }
  function normalizeSprite(image, asset, species) {
    if (image.naturalWidth > 2048 || image.naturalHeight > 2048)
      throw new Error("Fish sheet is too large");
    if (!asset || typeof asset !== "object" || Array.isArray(asset))
      throw new Error("Invalid fish artwork");
    if (asset.facing !== undefined && !["left", "right"].includes(asset.facing))
      throw new Error("Invalid fish facing");
    if (asset.sheet_width !== undefined || asset.sheet_height !== undefined) {
      if (
        !Number.isInteger(asset.sheet_width) ||
        !Number.isInteger(asset.sheet_height) ||
        asset.sheet_width !== image.naturalWidth ||
        asset.sheet_height !== image.naturalHeight
      )
        throw new Error("Fish sheet dimensions differ from its manifest");
    }
    let regions;
    if (asset.frame_count !== undefined) {
      if (
        ![
          asset.frame_count,
          asset.frame_width,
          asset.frame_height,
          asset.x,
          asset.y,
          asset.stride_x,
        ].every(Number.isInteger) ||
        asset.frame_count < 1 ||
        asset.frame_count > 8
      )
        throw new Error("Invalid fish animation");
      regions = Array.from({ length: asset.frame_count }, (_, index) => [
        asset.x + index * asset.stride_x,
        asset.y,
        asset.frame_width,
        asset.frame_height,
      ]);
    } else if (asset.region) regions = [asset.region];
    else if (
      Array.isArray(asset.cell) &&
      asset.cell.length === 2 &&
      asset.cell.every((value) => value === 0 || value === 1)
    )
      regions = [
        [
          (asset.cell[0] * image.naturalWidth) / 2,
          (asset.cell[1] * image.naturalHeight) / 2,
          image.naturalWidth / 2,
          image.naturalHeight / 2,
        ],
      ];
    else regions = [[0, 0, image.naturalWidth, image.naturalHeight]];
    let minX = Infinity,
      minY = Infinity,
      maxX = -1,
      maxY = -1;
    const samples = regions.map((region) => {
      if (
        !Array.isArray(region) ||
        region.length !== 4 ||
        !region.every(Number.isInteger) ||
        region[0] < 0 ||
        region[1] < 0 ||
        region[2] <= 0 ||
        region[3] <= 0 ||
        region[0] + region[2] > image.naturalWidth ||
        region[1] + region[3] > image.naturalHeight
      )
        throw new Error("Invalid fish frame bounds");
      const sample = document.createElement("canvas");
      sample.width = region[2];
      sample.height = region[3];
      const source = sample.getContext("2d", { willReadFrequently: true });
      source.drawImage(image, ...region, 0, 0, sample.width, sample.height);
      const rgba = source.getImageData(0, 0, sample.width, sample.height).data;
      let opaque = 0;
      for (let y = 0; y < sample.height; y++)
        for (let x = 0; x < sample.width; x++)
          if (rgba[(y * sample.width + x) * 4 + 3] > 32) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            opaque++;
          }
      if (!opaque) throw new Error("Fish frame is empty");
      return sample;
    });
    // Use one crop for every frame to keep the body steady while fins animate.
    return samples.map((sample) => {
      const output = document.createElement("canvas");
      [output.width, output.height] = species.size;
      const target = output.getContext("2d"),
        cropWidth = maxX - minX + 1,
        cropHeight = maxY - minY + 1;
      const ratio = Math.min(
          output.width / cropWidth,
          output.height / cropHeight,
        ),
        width = Math.max(1, Math.round(cropWidth * ratio)),
        height = Math.max(1, Math.round(cropHeight * ratio));
      target.imageSmoothingEnabled = false;
      if (asset.facing === "left") {
        target.translate(output.width, 0);
        target.scale(-1, 1);
      }
      target.drawImage(
        sample,
        minX,
        minY,
        cropWidth,
        cropHeight,
        Math.floor((output.width - width) / 2),
        Math.floor((output.height - height) / 2),
        width,
        height,
      );
      return output;
    });
  }
  async function loadSprites(retry = false) {
    if (loading || (loaded && !retry)) return;
    loading = true;
    if (retry) images.clear();
    byId("aquarium-art-status").hidden = false;
    byId("aquarium-art-status").textContent =
      "Loading fish artwork. Pixel silhouettes keep the tank ready.";
    byId("aquarium-retry-art").hidden = true;
    const nextSprites = new Map(),
      kinds = new Map(),
      sources = new Set();
    let localIssue = false;
    for (const source of ["local", "original"]) {
      try {
        const manifestPath =
          source === "local"
            ? "user/aquarium/manifest.json"
            : "assets/sprites/aquarium/manifest.json";
        const response = await fetch(manifestPath, {
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) {
          if (source === "local" && response.status !== 404) localIssue = true;
          continue;
        }
        const manifest = await response.json();
        if (
          manifest.version !== 1 ||
          !manifest.fish ||
          typeof manifest.fish !== "object" ||
          Array.isArray(manifest.fish)
        )
          throw new Error("Unsupported fish manifest");
        const results = await Promise.allSettled(
          SPECIES.filter((species) => !nextSprites.has(species.id)).map(
            async (species) => {
              const asset = manifest.fish[species.id];
              const expectedPath =
                source === "local"
                  ? `/user/aquarium/${species.id}.png`
                  : "assets/sprites/aquarium/original-fish.png";
              if (!asset || asset.url !== expectedPath)
                throw new Error("Invalid fish artwork path");
              const image = await loadImage(
                source === "local" ? expectedPath.slice(1) : expectedPath,
              );
              nextSprites.set(
                species.id,
                normalizeSprite(image, asset, species),
              );
              sources.add(source);
              if (
                typeof asset.kind === "string" &&
                asset.kind.trim() &&
                asset.kind.length <= 48
              )
                kinds.set(species.id, asset.kind.trim());
            },
          ),
        );
        if (
          source === "local" &&
          results.some((result) => result.status === "rejected")
        )
          localIssue = true;
        if (nextSprites.size === SPECIES.length) break;
      } catch {
        if (source === "local") localIssue = true;
      }
    }
    sprites.clear();
    for (const [id, frames] of nextSprites) sprites.set(id, frames);
    for (const species of SPECIES) {
      species.kind =
        kinds.get(species.id) ||
        {
          ember: "Goldfish",
          mint: "Guppy",
          violet: "Betta",
          pearl: "Angelfish",
        }[species.id];
      cards.get(species.id).kind.textContent = species.kind;
    }
    assetErrors = SPECIES.length - sprites.size;
    artSource =
      sources.size > 1 ? "mixed" : sources.values().next().value || "pixel";
    loading = false;
    loaded = true;
    byId("aquarium-art-status").hidden = assetErrors === 0 && !localIssue;
    byId("aquarium-art-status").textContent = assetErrors
      ? "Some fish artwork could not load. Pixel fish keep the tank playable."
      : localIssue
        ? "Some optional local artwork could not load. Original fish fill in."
        : "";
    byId("aquarium-retry-art").hidden = assetErrors === 0 && !localIssue;
    byId("aquarium-art-source").textContent =
      "Artwork: " +
      {
        original: "Agent Office originals",
        local: "local Smallburg pack",
        mixed: "local Smallburg pack with original fallbacks",
        pixel: "built-in pixel silhouettes",
      }[artSource];
    paintPreviews();
    paint();
  }
  function paintPreviews() {
    for (const species of SPECIES) {
      const preview = cards.get(species.id)?.preview;
      if (!preview) continue;
      const context = preview.getContext("2d");
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, preview.width, preview.height);
      drawFish(context, { id: species.id, vx: 1 }, 30, 24, 1.5);
    }
  }
  function buildCollection() {
    for (const species of SPECIES) {
      const label = document.createElement("label");
      label.className = "aquarium-choice";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.fish = species.id;
      const preview = document.createElement("canvas");
      preview.width = 60;
      preview.height = 48;
      preview.setAttribute("aria-hidden", "true");
      const copy = document.createElement("span");
      copy.className = "aquarium-fish-copy";
      const name = document.createElement("strong");
      name.textContent = species.name;
      const kind = document.createElement("span");
      kind.textContent = species.kind;
      const requirement = document.createElement("small");
      requirement.id = `aquarium-requirement-${species.id}`;
      input.setAttribute("aria-describedby", requirement.id);
      copy.append(name, kind, requirement);
      label.append(input, preview, copy);
      byId("aquarium-collection").append(label);
      cards.set(species.id, { label, input, preview, requirement, kind });
      input.onchange = async () => {
        if (savingSpecies) return;
        const ids = selected().filter((id) => id !== species.id);
        if (input.checked && unlocks()[species.id]) ids.push(species.id);
        if (!ids.some((id) => unlocks()[id])) {
          byId("aquarium-status").textContent =
            "Choose another resident before removing your last fish.";
          refresh();
          return;
        }
        savingSpecies = true;
        const saving = saveSettings({
          aquarium_species: SPECIES.filter((item) => ids.includes(item.id)).map(
            (item) => item.id,
          ),
        });
        refresh();
        const saved = await saving;
        savingSpecies = false;
        byId("aquarium-status").textContent = saved
          ? "Tank residents saved."
          : "Residents were not saved. Try again.";
        refresh();
      };
    }
    paintPreviews();
  }
  function render() {
    const unlocked = unlocks(),
      ids = selected(),
      count = SPECIES.filter((species) => unlocked[species.id]).length;
    habitat.select(ids.filter((id) => unlocked[id]));
    byId("aquarium-heading").textContent =
      prefs().aquarium_name || "A little quiet water";
    if (!nameDraft && document.activeElement !== byId("aquarium-name-input"))
      byId("aquarium-name-input").value = prefs().aquarium_name || "";
    for (const species of SPECIES) {
      const card = cards.get(species.id),
        have = unlocked[species.id];
      card.input.checked = have && ids.includes(species.id);
      card.input.disabled =
        !have ||
        savingSpecies ||
        (habitat.fish.length === 1 && habitat.fish[0].id === species.id);
      card.label.dataset.locked = String(!have);
      card.requirement.textContent = have
        ? species.id === "ember"
          ? "Always available"
          : "Discovered · ready for your tank"
        : "Unlock: " + species.requirement;
    }
    byId("aquarium-summary").textContent =
      `${habitat.fish.length} fish in the tank · ${count} of 4 species discovered`;
    const pausedReason = reducedMotion.matches
      ? "Reduced motion is on. Feeding still works without animation."
      : window.officeScene?.paused
        ? "Office motion is paused. Feeding still works."
        : localPause
          ? "Fish motion is paused. Feeding still works."
          : "Tap a fish or use Left/Right to say hello. Tap open water to feed.";
    byId("aquarium-motion-note").textContent = pausedReason;
    byId("aquarium-motion").textContent = localPause
      ? "Resume fish"
      : "Pause fish";
    byId("aquarium-motion").setAttribute("aria-pressed", String(localPause));
    byId("aquarium-motion").disabled =
      reducedMotion.matches || !!window.officeScene?.paused;
    const light = prefs().aquarium_light !== false;
    byId("aquarium-light").textContent = light
      ? "Tank light on"
      : "Tank light off";
    byId("aquarium-light").setAttribute("aria-pressed", String(light));
    byId("aquarium-light").disabled = savingLight;
    byId("aquarium-greet").disabled = !habitat.fish.length;
    updateFeeding();
  }
  function updateFeeding() {
    const cooling = performance.now() - habitat.lastFeedAt < FEED_COOLDOWN;
    byId("aquarium-feed").disabled =
      !habitat.fish.length ||
      cooling ||
      (moving() && habitat.pellets.length + 3 > MAX_PELLETS);
    byId("aquarium-feed").textContent = cooling ? "Snack time…" : "Feed fish";
    byId("aquarium-snacks").textContent = habitat.eaten
      ? `${habitat.eaten} snack${habitat.eaten === 1 ? "" : "s"} enjoyed this visit`
      : "A happy tank, on your schedule";
  }
  function feed(x) {
    if (!active()) return;
    const result = habitat.feed(x, performance.now(), !moving());
    byId("aquarium-status").textContent = {
      fed: moving()
        ? "A little snack is in the water."
        : "Snack shared. The fish are happy to stay still.",
      cooldown: "Let them enjoy this snack first.",
      full: "There is enough food in the water for now.",
      empty: "Choose a discovered fish for your tank first.",
    }[result];
    updateFeeding();
    paint();
  }
  function greetFish(fish) {
    if (!active() || !fish) return;
    inspectedFish = fish.id;
    habitat.react(fish.id, moving());
    const species = SPECIES.find((item) => item.id === fish.id),
      snackCopy = fish.snacks
        ? `${fish.snacks} snack${fish.snacks === 1 ? "" : "s"} enjoyed`
        : "no snacks yet";
    byId("aquarium-status").textContent =
      `${species.name} · ${species.kind} · ${snackCopy}.`;
    paint();
  }
  function inspectOrFeed(x, y) {
    if (!active()) return;
    const fish = habitat.fishAt(x, y);
    if (fish) greetFish(fish);
    else {
      inspectedFish = "";
      feed(x);
    }
  }
  function greetNext(direction = 1) {
    const fish = habitat.fish;
    if (!active() || !fish.length) return;
    const current = fish.findIndex((item) => item.id === inspectedFish);
    let next = (current + direction + fish.length) % fish.length;
    if (current < 0) next = direction > 0 ? 0 : fish.length - 1;
    greetFish(fish[next]);
  }
  function tick(now) {
    frame = 0;
    if (!moving()) {
      lastFrame = 0;
      return;
    }
    if (lastFrame) habitat.step((now - lastFrame) / 1000);
    lastFrame = now;
    paint();
    updateFeeding();
    frame = requestAnimationFrame(tick);
  }
  function refresh() {
    if (!active()) {
      if (frame) cancelAnimationFrame(frame);
      if (timer) clearInterval(timer);
      frame = 0;
      timer = 0;
      lastFrame = 0;
      return;
    }
    render();
    if (moving()) {
      if (!frame) {
        lastFrame = 0;
        frame = requestAnimationFrame(tick);
      }
    } else {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      lastFrame = 0;
    }
    if (!timer) timer = setInterval(refresh, 500);
    paint();
  }
  const greetButton = document.createElement("button");
  greetButton.id = "aquarium-greet";
  greetButton.type = "button";
  greetButton.className = "btn";
  greetButton.textContent = "Greet fish";
  greetButton.onclick = () => greetNext();
  byId("aquarium-motion").before(greetButton);
  canvas.setAttribute(
    "aria-label",
    "Aquarium. Select a fish to say hello, or use Left and Right arrows. Tap open water or press Space or Enter to feed.",
  );
  byId("aquarium-feed").onclick = () => feed(WIDTH / 2);
  canvas.onclick = (event) => {
    const rect = canvas.getBoundingClientRect();
    inspectOrFeed(
      ((event.clientX - rect.left) * WIDTH) / rect.width,
      ((event.clientY - rect.top) * HEIGHT) / rect.height,
    );
  };
  canvas.onkeydown = (event) => {
    if (!active() || event.altKey || event.ctrlKey || event.metaKey) return;
    if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) greetNext(event.key === "ArrowLeft" ? -1 : 1);
    } else if ([" ", "Enter"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      feed(WIDTH / 2);
    }
  };
  byId("aquarium-motion").onclick = () => {
    localPause = !localPause;
    refresh();
  };
  byId("aquarium-light").onclick = async () => {
    if (savingLight) return;
    savingLight = true;
    const saving = saveSettings({
      aquarium_light: prefs().aquarium_light === false,
    });
    refresh();
    const saved = await saving;
    savingLight = false;
    byId("aquarium-status").textContent = saved
      ? "Tank lighting saved."
      : "Tank lighting was not saved. Your previous light is restored.";
    refresh();
  };
  byId("aquarium-retry-art").onclick = () => loadSprites(true);
  byId("aquarium-name-input").oninput = () => {
    nameDraft = true;
    nameRevision++;
  };
  byId("aquarium-name-form").onsubmit = async (event) => {
    event.preventDefault();
    const submitted = byId("aquarium-name-input").value,
      revision = nameRevision;
    byId("aquarium-name-save").disabled = true;
    const saved = await saveSettings({ aquarium_name: submitted });
    byId("aquarium-name-save").disabled = false;
    if (
      saved &&
      revision === nameRevision &&
      byId("aquarium-name-input").value === submitted
    )
      nameDraft = false;
    byId("aquarium-status").textContent = saved
      ? "Aquarium name saved."
      : "The name was not saved. Your draft is ready to retry.";
    refresh();
  };
  const observer = new MutationObserver(() => {
    if (active()) loadSprites();
    refresh();
  });
  observer.observe(panel, { attributes: true, attributeFilter: ["hidden"] });
  document.addEventListener("visibilitychange", refresh);
  reducedMotion.addEventListener("change", refresh);
  byId("pausebtn")?.addEventListener("click", refresh);
  buildCollection();
  window.openAquarium = () => {
    if (!settingsReady) {
      toast(
        "Loading office settings. Your aquarium will be ready after the observer responds.",
      );
      return;
    }
    if (panel.hidden) openSheet("sheet-aquarium");
    loadSprites();
    refresh();
  };
  window.officeAquarium = Object.freeze({
    refresh,
    snapshot: () => ({
      ...habitat.snapshot(),
      running: !!frame,
      timerActive: !!timer,
      paused: !moving(),
      paintedFrames,
      sprites: [...sprites.keys()],
      spriteFrames: Object.fromEntries(
        [...sprites].map(([id, frames]) => [id, frames.length]),
      ),
      assetErrors,
      artSource,
      inspectedFish,
      light: prefs().aquarium_light !== false,
      unlocked: { ...unlocks() },
    }),
  });
})();
