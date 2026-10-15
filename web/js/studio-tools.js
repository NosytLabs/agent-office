/* Native studio animation and inspection tools. Cosmetic only: no observer writes. */
(function (root) {
  "use strict";
  const KINDS = [
    "server",
    "coffee",
    "cooler",
    "robot",
    "recordplayer",
    "terrarium",
    "taskterminal-running",
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
  function frameKey(key, state = {}) {
    if (key === "lamp" && state.lights === false) return "lamp-off";
    const moving =
      key === "server" ||
      key === "taskterminal-running" ||
      (["coffee", "cooler", "robot", "terrarium"].includes(key) &&
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
  const api = { frameKey, makeFrames, kinds: KINDS };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof document === "undefined") return;
  if (root.officeStudioTools) return;
  root.officeStudioTools = api;
  let installed = false;
  function install() {
    const art = root.officeStudio;
    if (
      installed ||
      !art ||
      art.source === "loading" ||
      typeof scene === "undefined"
    )
      return;
    const section = document.querySelector(".studio-controls");
    if (!section) return;
    installed = true;
    const frames = art.ready ? makeFrames(art.sprites, document) : new Map();
    api.frames = frames;
    const enabled = () => art.ready && art.prefs.art === "studio";
    const originalImage = scene.image,
      originalCharacter = scene.character;
    scene.image = function (key, x, y, w, h) {
      const selected = frameKey(key, {
        lights: this.settings.room_lights,
        time: this.time,
        paused: this.paused,
        music: this.musicPlaying,
        reacting:
          this.propReaction(key, x, y) !== null ||
          (key === "robot" && this.cosmetics.includes("robot_wave")) ||
          (key === "terrarium" && this.cosmetics.includes("terrarium_glow")),
      });
      const image = enabled() && frames.get(selected);
      if (!image) return originalImage.call(this, key, x, y, w, h);
      this.ctx.drawImage(image, Math.round(x), Math.round(y), w, h);
      return true;
    };
    // Mirror the complete character in one actor-centered coordinate system.
    // In particular, the crown keeps the same world-space center as the head.
    scene.character = function (agent, x, y, motion) {
      if (!enabled() || !motion.moving || motion.dir !== "left")
        return originalCharacter.call(this, agent, x, y, motion);
      this.ctx.save();
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
    section.addEventListener("change", syncLabels);
    syncLabels();
    const status = document.getElementById("studio-art-status");
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "btn";
    retry.id = "studio-art-retry";
    retry.textContent = "Reload artwork";
    retry.hidden = art.ready;
    retry.title =
      "Reload this view and retry the artwork. Your saved office settings are kept.";
    retry.onclick = () => {
      retry.disabled = true;
      root.location.reload();
    };
    status?.after(retry);
    const gallery = document.createElement("details");
    gallery.id = "studio-gallery";
    gallery.className = "storage-diagnostics";
    gallery.hidden = !art.ready;
    gallery.innerHTML =
      '<summary>Preview &amp; download sprites</summary><p class="h">Native PNGs, including 29 additional animation and lighting frames. Server flicker is decorative, not a health signal.</p><label class="studio-option" for="studio-sprite-choice">Studio sprite<select id="studio-sprite-choice"></select></label><canvas id="studio-sprite-preview" width="128" height="128" role="img" aria-label="Selected studio sprite"></canvas><button type="button" class="btn" id="studio-sprite-download">Download PNG</button>';
    section.append(gallery);
    const all = new Map([...art.sprites, ...frames]);
    const select = gallery.querySelector("select"),
      preview = gallery.querySelector("canvas"),
      save = gallery.querySelector("button");
    for (const key of [...all.keys()].sort()) {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = key.replaceAll("-", " ");
      select.append(option);
    }
    select.value = "robot-anim-0";
    function repaint() {
      const source = all.get(select.value),
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
      preview.setAttribute(
        "aria-label",
        select.value.replaceAll("-", " ") + " native sprite",
      );
      save.disabled = !source;
    }
    select.onchange = repaint;
    repaint();
    save.onclick = () => {
      const key = select.value,
        source = all.get(key);
      if (!source) return;
      source.toBlob((blob) => {
        if (blob) downloadBlob(blob, "agent-office-" + key + ".png");
        else if (status)
          status.textContent = "Could not export this sprite. Try again.";
      }, "image/png");
    };
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
