/* Lifecycle boundary around the pinned Adi52/duck-hunt browser build. */
"use strict";
(() => {
  const nonce = new URLSearchParams(location.search).get("nonce") || "",
    nativeRequest = window.requestAnimationFrame.bind(window),
    nativeCancel = window.cancelAnimationFrame.bind(window),
    nativeTimeout = window.setTimeout.bind(window),
    callbacks = new Map(),
    scheduled = new Map();
  let nextFrame = 1,
    paused = true,
    muted = true,
    virtualTime = 0,
    lastNativeTime = null,
    menuStarted = false,
    suppressCompatibilityMouseUntil = 0,
    aim = { x: 384, y: 330 },
    latestDuck = null,
    resumeMedia = new Set();

  // The upstream desktop guard reads screen.width. The host scales its fixed
  // logical canvas responsively, so use the desktop code path inside this
  // deliberately bounded frame even on a narrow device.
  try {
    Object.defineProperty(window.screen, "width", {
      configurable: true,
      get: () => 1024,
    });
  } catch {}

  function run(id) {
    if (paused || scheduled.has(id) || !callbacks.has(id)) return;
    scheduled.set(
      id,
      nativeRequest((time) => {
        scheduled.delete(id);
        if (paused || !callbacks.has(id)) return;
        const callback = callbacks.get(id);
        callbacks.delete(id);
        // Upstream stores RAF timestamps. Exclude hidden/paused wall time and
        // cap a throttled frame so a resume cannot launch a duck off-screen.
        if (lastNativeTime !== null)
          virtualTime += Math.min(50, Math.max(0, time - lastNativeTime));
        lastNativeTime = time;
        callback(virtualTime);
      }),
    );
  }
  window.requestAnimationFrame = (callback) => {
    const id = nextFrame++;
    callbacks.set(id, callback);
    run(id);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    callbacks.delete(id);
    const nativeId = scheduled.get(id);
    if (nativeId !== undefined) nativeCancel(nativeId);
    scheduled.delete(id);
  };
  // Keep the original load sequence but remove its five-second decorative wait.
  window.setTimeout = (callback, delay, ...args) =>
    nativeTimeout(callback, delay === 5000 ? 450 : delay, ...args);

  const nativeCreate = document.createElement.bind(document);
  document.createElement = (name, options) => {
    const element = nativeCreate(name, options);
    if (String(name).toLowerCase() === "audio") element.muted = muted;
    return element;
  };
  const nativePlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    this.muted = muted;
    if (paused) {
      resumeMedia.add(this);
      return Promise.resolve();
    }
    const result = nativePlay.call(this);
    result?.catch?.(() => {});
    return result;
  };

  // The upstream loader waits forever when an MP3 never emits
  // canplaythrough. Treat metadata, canplaythrough, or a bounded fallback as
  // readiness; playback remains best-effort and individually guarded above.
  const nativeMediaListen = HTMLMediaElement.prototype.addEventListener;
  HTMLMediaElement.prototype.addEventListener = function (
    type,
    listener,
    options,
  ) {
    if (type !== "canplaythrough") {
      nativeMediaListen.call(this, type, listener, options);
      return;
    }
    let settled = false;
    const finish = (event) => {
      if (settled) return;
      settled = true;
      listener.call(this, event || new Event("canplaythrough"));
    };
    nativeMediaListen.call(this, "canplaythrough", finish, { once: true });
    nativeMediaListen.call(this, "loadedmetadata", finish, { once: true });
    nativeMediaListen.call(this, "error", finish, { once: true });
    nativeTimeout(() => finish(new Event("canplaythrough")), 900);
  };

  // Mirror the visible target and score into keyboard/accessibility state.
  // This does not change collision or scoring; Space still uses the upstream
  // mousedown path and its original hit test.
  const nativeDrawImage = CanvasRenderingContext2D.prototype.drawImage,
    nativeFillText = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
    if (this.canvas.id === "canvas" && image?.id === "background") {
      latestDuck = null;
      const status = document.getElementById("keyboard-game-status");
      if (status) delete status.dataset.targetReady;
    }
    if (
      image?.id === "ducksFlyUpImg" &&
      args.length >= 8 &&
      Number.isFinite(args[4]) &&
      Number.isFinite(args[5]) &&
      args[4] >= 0 &&
      args[4] < 730 &&
      args[5] >= 0 &&
      args[5] < 500
    ) {
      latestDuck = {
        x: args[4] + args[6] / 2,
        y: args[5] + args[7] / 2,
      };
      const status = document.getElementById("keyboard-game-status");
      if (status) status.dataset.targetReady = "yes";
    }
    return nativeDrawImage.call(this, image, ...args);
  };
  CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...args) {
    if (text === "START GAME") {
      menuStarted = false;
      latestDuck = null;
      const status = document.getElementById("keyboard-game-status");
      if (status) delete status.dataset.targetReady;
    } else if (["ROUND", "FLY AWAY", "GAME"].includes(String(text))) {
      latestDuck = null;
      const status = document.getElementById("keyboard-game-status");
      if (status) delete status.dataset.targetReady;
    }
    if (y === 647 && /^\d{6}$/.test(String(text))) {
      const score = document.getElementById("keyboard-score");
      if (score) score.textContent = String(text);
    }
    return nativeFillText.call(this, text, x, y, ...args);
  };

  // The fixed 768×720 game subtracts the CSS rect but omits its scale. Wrap
  // only the upstream canvas mousedown listener and provide logical pixels.
  const nativeCanvasListen = HTMLCanvasElement.prototype.addEventListener;
  HTMLCanvasElement.prototype.addEventListener = function (
    type,
    listener,
    options,
  ) {
    if (this.id !== "canvas" || type !== "mousedown") {
      nativeCanvasListen.call(this, type, listener, options);
      return;
    }
    const wrapped = (event) => {
      if (paused) return;
      if (
        event.isTrusted &&
        performance.now() < suppressCompatibilityMouseUntil
      )
        return;
      const rect = this.getBoundingClientRect(),
        logicalX = ((event.clientX - rect.left) * this.width) / rect.width,
        logicalY = ((event.clientY - rect.top) * this.height) / rect.height,
        mapped = new Proxy(event, {
          get(target, key) {
            if (key === "clientX") return rect.left + logicalX;
            if (key === "clientY") return rect.top + logicalY;
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      if (
        !menuStarted &&
        logicalX > 236 &&
        logicalX < 531 &&
        logicalY > 447 &&
        logicalY < 473
      ) {
        // Upstream calls menuStartGame before assigning this click's mouse
        // coordinates. Prime once, then deliver the same intentional click.
        listener.call(this, mapped);
        menuStarted = true;
      }
      listener.call(this, mapped);
    };
    nativeCanvasListen.call(this, type, wrapped, options);
  };

  function media(action) {
    for (const audio of document.querySelectorAll("audio")) {
      audio.muted = muted;
      if (action === "pause") audio.pause();
    }
  }
  function pause() {
    if (paused) return;
    paused = true;
    for (const nativeId of scheduled.values()) nativeCancel(nativeId);
    scheduled.clear();
    lastNativeTime = null;
    for (const audio of document.querySelectorAll("audio")) {
      if (!audio.paused) resumeMedia.add(audio);
    }
    media("pause");
  }
  function resume() {
    if (!paused) return;
    paused = false;
    lastNativeTime = null;
    for (const id of callbacks.keys()) run(id);
    const pendingMedia = [...resumeMedia];
    resumeMedia.clear();
    for (const audio of pendingMedia) audio.play().catch(() => {});
    document.getElementById("canvas")?.focus({ preventScroll: true });
  }
  function setMuted(value) {
    muted = value !== false;
    media();
  }
  function post(type, detail = {}) {
    parent.postMessage(
      { channel: "agent-office-arcade", nonce, type, ...detail },
      "*",
    );
  }
  function ready() {
    setMuted(muted);
    const canvas = document.getElementById("canvas"),
      marker = document.createElement("span");
    marker.id = "keyboard-aim";
    marker.hidden = true;
    canvas?.parentElement?.append(marker);
    function placeAim() {
      marker.style.left = `${(aim.x / 768) * 100}%`;
      marker.style.top = `${(aim.y / 720) * canvas.offsetHeight}px`;
    }
    canvas?.addEventListener("keydown", (event) => {
      if (paused) return;
      if (
        ![
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          " ",
          "Enter",
          "t",
          "T",
        ].includes(event.key)
      )
        return;
      event.preventDefault();
      marker.hidden = false;
      if (event.key === "ArrowLeft") aim.x = Math.max(18, aim.x - 28);
      else if (event.key === "ArrowRight") aim.x = Math.min(750, aim.x + 28);
      else if (event.key === "ArrowUp") aim.y = Math.max(18, aim.y - 28);
      else if (event.key === "ArrowDown") aim.y = Math.min(702, aim.y + 28);
      else if (event.key === "t" || event.key === "T") {
        if (latestDuck) aim = { ...latestDuck };
        const status = document.getElementById("keyboard-game-status");
        if (status)
          status.textContent = latestDuck
            ? "Visible duck targeted. Press Space to fire, or use arrows to refine aim."
            : "Wait for a duck to appear, then press T to aim.";
      } else {
        if (!menuStarted) {
          aim = { x: 384, y: 460 };
        }
        const rect = canvas.getBoundingClientRect();
        canvas.dispatchEvent(
          new MouseEvent("mousedown", {
            bubbles: true,
            clientX: rect.left + (aim.x / canvas.width) * rect.width,
            clientY: rect.top + (aim.y / canvas.height) * rect.height,
          }),
        );
      }
      placeAim();
    });
    canvas?.addEventListener("pointerup", (event) => {
      if (event.pointerType !== "touch") return;
      suppressCompatibilityMouseUntil = performance.now() + 800;
      canvas.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          clientX: event.clientX,
          clientY: event.clientY,
        }),
      );
    });
    addEventListener("resize", placeAim);
    placeAim();
    post("ready");
  }
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (paused) {
        resume();
        post("resumed");
      } else {
        pause();
        post("paused");
      }
    },
    true,
  );
  addEventListener("message", (event) => {
    if (event.source !== parent) return;
    const data = event.data;
    if (!data || data.channel !== "agent-office-arcade" || data.nonce !== nonce)
      return;
    if (data.action === "pause") pause();
    else if (data.action === "resume") resume();
    else if (data.action === "mute") setMuted(data.muted);
    else if (data.action === "focus")
      document.getElementById("canvas")?.focus();
  });
  addEventListener("pagehide", pause);
  addEventListener("blur", () => {
    if (paused) return;
    pause();
    post("paused");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
  });
  window.duckHuntLifecycle = { ready, pause, resume, setMuted };
})();
