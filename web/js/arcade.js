/* Local arcade host. Breakout adapts MIT-licensed mini-games logic; Duck Hunt runs in a sandbox. */
"use strict";
(() => {
  const WIDTH = 480,
    HEIGHT = 360,
    PADDLE_WIDTH = 88,
    PADDLE_HEIGHT = 12,
    BALL_RADIUS = 7,
    PATTERNS = Object.freeze([
      ["2222222222", "2222222222", "1111111111", "1111111111"],
      ["1111111111", "0111111110", "0011111100", "0001111000", "0000110000"],
      ["0000110000", "0001111000", "0011221100", "0112222110", "1122222211"],
      ["2020202020", "0101010101", "2020202020", "0101010101", "2020202020"],
      ["2200000022", "2111111112", "2100000012", "2111111112", "2222222222"],
    ]),
    COLORS = ["#f08b78", "#efb766", "#dfd07b", "#8fc5a5", "#79a9c7"];

  class BreakoutGame {
    constructor(random = Math.random) {
      this.random = random;
      this.state = "ready";
      this.score = 0;
      this.level = 1;
      this.lives = 3;
      this.paddle = { x: (WIDTH - PADDLE_WIDTH) / 2, y: HEIGHT - 28 };
      this.ball = { x: WIDTH / 2, y: HEIGHT - 48, vx: 150, vy: -190 };
      this.bricks = [];
    }
    snapshot() {
      return {
        state: this.state,
        score: this.score,
        level: this.level,
        lives: this.lives,
        remaining: this.bricks.filter((brick) => brick.hits > 0).length,
        paddleX: this.paddle.x,
        ball: { ...this.ball },
      };
    }
    createBricks() {
      const pattern = PATTERNS[(this.level - 1) % PATTERNS.length],
        gap = 4,
        width = (WIDTH - gap * 11) / 10,
        height = 16;
      this.bricks = [];
      for (let row = 0; row < pattern.length; row++)
        for (let column = 0; column < 10; column++) {
          const hits = Number(pattern[row][column]);
          if (hits)
            this.bricks.push({
              x: gap + column * (width + gap),
              y: 45 + row * (height + gap),
              w: width,
              h: height,
              hits,
              color: COLORS[row % COLORS.length],
            });
        }
    }
    resetBall() {
      const speed = 190 + (this.level - 1) * 24,
        direction = this.random() < 0.5 ? -1 : 1;
      this.paddle.x = (WIDTH - PADDLE_WIDTH) / 2;
      this.ball = {
        x: WIDTH / 2,
        y: HEIGHT - 48,
        vx: direction * speed * 0.72,
        vy: -speed,
      };
    }
    start() {
      this.state = "playing";
      this.score = 0;
      this.level = 1;
      this.lives = 3;
      this.createBricks();
      this.resetBall();
    }
    setPaddle(center) {
      this.paddle.x = Math.max(
        0,
        Math.min(WIDTH - PADDLE_WIDTH, center - PADDLE_WIDTH / 2),
      );
    }
    movePaddle(direction, seconds) {
      this.setPaddle(
        this.paddle.x + PADDLE_WIDTH / 2 + direction * 310 * seconds,
      );
    }
    step(seconds) {
      if (this.state !== "playing") return;
      let remaining = Math.max(0, Math.min(0.08, seconds));
      while (remaining > 0 && this.state === "playing") {
        const step = Math.min(1 / 120, remaining);
        this.advance(step);
        remaining -= step;
      }
    }
    advance(seconds) {
      const ball = this.ball;
      ball.x += ball.vx * seconds;
      ball.y += ball.vy * seconds;
      if (ball.x - BALL_RADIUS < 0) {
        ball.x = BALL_RADIUS;
        ball.vx = Math.abs(ball.vx);
      } else if (ball.x + BALL_RADIUS > WIDTH) {
        ball.x = WIDTH - BALL_RADIUS;
        ball.vx = -Math.abs(ball.vx);
      }
      if (ball.y - BALL_RADIUS < 0) {
        ball.y = BALL_RADIUS;
        ball.vy = Math.abs(ball.vy);
      }
      const paddle = this.paddle;
      if (
        ball.vy > 0 &&
        ball.y + BALL_RADIUS >= paddle.y &&
        ball.y - BALL_RADIUS <= paddle.y + PADDLE_HEIGHT &&
        ball.x + BALL_RADIUS >= paddle.x &&
        ball.x - BALL_RADIUS <= paddle.x + PADDLE_WIDTH
      ) {
        ball.y = paddle.y - BALL_RADIUS;
        const offset =
          (ball.x - (paddle.x + PADDLE_WIDTH / 2)) / (PADDLE_WIDTH / 2);
        ball.vx = offset * (220 + this.level * 18);
        ball.vy = -Math.max(180, Math.abs(ball.vy));
      }
      for (const brick of this.bricks) {
        if (
          !brick.hits ||
          ball.x + BALL_RADIUS < brick.x ||
          ball.x - BALL_RADIUS > brick.x + brick.w ||
          ball.y + BALL_RADIUS < brick.y ||
          ball.y - BALL_RADIUS > brick.y + brick.h
        )
          continue;
        brick.hits--;
        if (!brick.hits) this.score += 10 * this.level;
        const fromSide =
          Math.min(
            Math.abs(ball.x - brick.x),
            Math.abs(ball.x - (brick.x + brick.w)),
          ) <
          Math.min(
            Math.abs(ball.y - brick.y),
            Math.abs(ball.y - (brick.y + brick.h)),
          );
        if (fromSide) ball.vx *= -1;
        else ball.vy *= -1;
        break;
      }
      if (this.bricks.every((brick) => !brick.hits)) {
        if (this.level >= PATTERNS.length) this.state = "won";
        else {
          this.level++;
          this.createBricks();
          this.resetBall();
        }
        return;
      }
      if (ball.y - BALL_RADIUS > HEIGHT) {
        this.lives--;
        if (this.lives <= 0) this.state = "lost";
        else this.resetBall();
      }
    }
  }

  if (typeof module !== "undefined" && module.exports)
    module.exports = { BreakoutGame, WIDTH, HEIGHT, PATTERNS };
  if (typeof document === "undefined") return;

  const byId = (id) => document.getElementById(id),
    sheet = byId("sheet-arcade"),
    canvas = byId("arcade-canvas"),
    context = canvas?.getContext("2d"),
    reducedMotion = matchMedia("(prefers-reduced-motion: reduce)"),
    keys = new Set();
  if (!sheet || !canvas || !context) return;

  let selected = null,
    breakout = new BreakoutGame(),
    frame = null,
    lastFrame = 0,
    userPaused = true,
    localMotionOptIn = false,
    lastOfficePaused = !!window.officeScene?.paused,
    duckReady = false,
    duckFailed = false,
    duckPaused = true,
    duckNonce = "",
    duckFrame = null,
    status = "Choose a game. Nothing starts automatically.";

  function storageKey() {
    return `agent-office:${window._state?.mode === "demo" ? "preview" : "observer"}:arcade:breakout-best`;
  }
  function readBest(key = storageKey()) {
    try {
      return Math.max(0, Number(localStorage.getItem(key)) || 0);
    } catch {
      return 0;
    }
  }
  function writeBest(value) {
    try {
      localStorage.setItem(bestKey, String(value));
    } catch {}
  }
  let bestKey = storageKey(),
    best = readBest(bestKey);
  function syncBestNamespace() {
    const key = storageKey();
    if (key === bestKey) return;
    bestKey = key;
    best = readBest(bestKey);
  }

  function sheetOpen() {
    return !sheet.hidden;
  }
  function officePaused() {
    return !!window.officeScene?.paused;
  }
  function lifecycleBlocked() {
    return document.hidden || !sheetOpen();
  }
  function sendDuck(action, detail = {}) {
    if (!duckFrame?.contentWindow || !duckNonce) return;
    duckFrame.contentWindow.postMessage(
      { channel: "agent-office-arcade", nonce: duckNonce, action, ...detail },
      "*",
    );
  }
  function muteDuck() {
    const sound = typeof settings !== "undefined" && settings.sound === true;
    sendDuck("mute", { muted: !sound });
  }
  function pauseDuck(message) {
    sendDuck("pause");
    duckPaused = true;
    if (message) status = message;
  }
  function resumeDuck() {
    if (!duckReady || lifecycleBlocked()) return;
    localMotionOptIn = true;
    userPaused = false;
    duckPaused = false;
    muteDuck();
    sendDuck("resume");
    status =
      "Click or tap flying ducks. Keyboard: Enter starts, arrows aim, T targets a duck, Space fires. Escape pauses.";
    render();
  }
  function unloadDuck() {
    if (!duckFrame) return;
    pauseDuck();
    duckFrame.removeAttribute("src");
    duckFrame.src = "about:blank";
    duckFrame.remove();
    duckFrame = null;
    duckReady = false;
    duckFailed = false;
    duckNonce = "";
  }
  function loadDuck() {
    unloadDuck();
    duckNonce =
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    duckFrame = document.createElement("iframe");
    duckFailed = false;
    duckFrame.id = "arcade-duck-frame";
    duckFrame.title = "Duck Hunt browser game";
    duckFrame.sandbox = "allow-scripts";
    duckFrame.referrerPolicy = "no-referrer";
    duckFrame.src = `arcade/duck-hunt/index.html?nonce=${encodeURIComponent(duckNonce)}`;
    byId("arcade-duck-stage").replaceChildren(duckFrame);
    status = "Loading the local Duck Hunt game…";
    render();
  }

  function stopFrame() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    lastFrame = 0;
  }
  function schedule() {
    if (
      frame !== null ||
      selected !== "breakout" ||
      userPaused ||
      lifecycleBlocked() ||
      breakout.state !== "playing"
    )
      return;
    frame = requestAnimationFrame(tick);
  }
  function tick(time) {
    frame = null;
    if (userPaused || lifecycleBlocked() || selected !== "breakout") return;
    const seconds = lastFrame ? Math.min(0.05, (time - lastFrame) / 1000) : 0;
    lastFrame = time;
    if (keys.has("ArrowLeft")) breakout.movePaddle(-1, seconds);
    if (keys.has("ArrowRight")) breakout.movePaddle(1, seconds);
    breakout.step(seconds);
    if (breakout.state === "won" || breakout.state === "lost") {
      stopFrame();
      userPaused = true;
      if (breakout.score > best) {
        best = breakout.score;
        writeBest(best);
      }
      status =
        breakout.state === "won"
          ? `Cabinet cleared. Final score ${breakout.score}.`
          : `Game over. Final score ${breakout.score}.`;
    } else schedule();
    drawBreakout();
    render();
  }
  function drawBreakout() {
    const game = breakout;
    context.fillStyle = "#121b25";
    context.fillRect(0, 0, WIDTH, HEIGHT);
    context.fillStyle = "#182633";
    for (let x = 0; x < WIDTH; x += 24) context.fillRect(x, 0, 1, HEIGHT);
    for (let y = 0; y < HEIGHT; y += 24) context.fillRect(0, y, WIDTH, 1);
    for (const brick of game.bricks) {
      if (!brick.hits) continue;
      context.fillStyle = brick.color;
      context.globalAlpha = brick.hits > 1 ? 1 : 0.7;
      context.beginPath();
      context.roundRect(brick.x, brick.y, brick.w, brick.h, 3);
      context.fill();
    }
    context.globalAlpha = 1;
    context.fillStyle = "#9ad6bf";
    context.beginPath();
    context.roundRect(
      game.paddle.x,
      game.paddle.y,
      PADDLE_WIDTH,
      PADDLE_HEIGHT,
      5,
    );
    context.fill();
    context.fillStyle = "#f3d290";
    context.beginPath();
    context.arc(game.ball.x, game.ball.y, BALL_RADIUS, 0, Math.PI * 2);
    context.fill();
    if (game.state !== "playing" || userPaused) {
      context.fillStyle = "#101820c9";
      context.fillRect(0, 0, WIDTH, HEIGHT);
      context.fillStyle = "#f4ead7";
      context.textAlign = "center";
      context.font = "600 22px ui-monospace, monospace";
      const label =
        game.state === "won"
          ? "CABINET CLEARED"
          : game.state === "lost"
            ? "GAME OVER"
            : game.state === "ready"
              ? "BREAKOUT"
              : "PAUSED";
      context.fillText(label, WIDTH / 2, HEIGHT / 2);
      context.font = "14px ui-monospace, monospace";
      context.fillStyle = "#aebdca";
      context.fillText(
        "Press Start or Resume below",
        WIDTH / 2,
        HEIGHT / 2 + 30,
      );
    }
  }
  function clearKeys() {
    keys.clear();
  }
  function pause(message, explicit = false) {
    stopFrame();
    clearKeys();
    userPaused = true;
    if (explicit) localMotionOptIn = false;
    if (selected === "duck-hunt") pauseDuck();
    if (message) status = message;
    drawBreakout();
    render();
  }
  function startBreakout(fresh = false) {
    if (fresh || breakout.state !== "playing") breakout.start();
    selected = "breakout";
    unloadDuck();
    localMotionOptIn = true;
    userPaused = false;
    status =
      "Breakout running. Drag the paddle or hold Left and Right while the canvas is focused.";
    canvas.focus({ preventScroll: true });
    drawBreakout();
    render();
    schedule();
  }
  function choose(game) {
    pause();
    if (selected === "duck-hunt" && game !== selected) unloadDuck();
    selected = game;
    userPaused = true;
    localMotionOptIn = false;
    status =
      game === "breakout"
        ? "Breakout selected. Press Start when you are ready."
        : "Duck Hunt selected. Press Load & start; the game stays stopped until then.";
    render();
    byId(game === "breakout" ? "arcade-start" : "arcade-duck-start").focus({
      preventScroll: true,
    });
  }
  function exitGame() {
    pause();
    unloadDuck();
    selected = null;
    status = "Choose a game. Nothing starts automatically.";
    render();
    byId("arcade-game-breakout").focus({ preventScroll: true });
  }
  function render() {
    sheet.dataset.game = selected || "picker";
    byId("arcade-heading").textContent =
      selected === "duck-hunt"
        ? "Duck Hunt"
        : selected === "breakout"
          ? "Breakout"
          : "Arcade cabinet";
    for (const button of sheet.querySelectorAll("[data-arcade-game]"))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.arcadeGame === selected),
      );
    const state = breakout.snapshot();
    byId("arcade-score").textContent = String(state.score);
    byId("arcade-best").textContent = String(best);
    byId("arcade-level").textContent = String(state.level);
    byId("arcade-lives").textContent = "●".repeat(state.lives) || "—";
    if (byId("arcade-status").textContent !== status)
      byId("arcade-status").textContent = status;
    byId("arcade-pause").textContent = userPaused ? "Resume" : "Pause";
    byId("arcade-pause").disabled =
      selected === "duck-hunt"
        ? !duckReady
        : !selected || state.state !== "playing";
    byId("arcade-restart").disabled = !selected;
    byId("arcade-exit").disabled = !selected;
    byId("arcade-start").hidden =
      selected !== "breakout" || state.state === "playing";
    byId("arcade-duck-start").hidden = selected !== "duck-hunt" || duckReady;
    byId("arcade-duck-start").textContent = duckFrame
      ? duckFailed
        ? "Retry Duck Hunt"
        : duckReady
          ? "Resume Duck Hunt"
          : "Loading…"
      : "Load & start Duck Hunt";
    byId("arcade-duck-start").disabled =
      !!duckFrame && !duckReady && !duckFailed;
    byId("arcade-motion-note").textContent =
      reducedMotion.matches || officePaused()
        ? "Office motion is paused. Start or Resume opts into motion for this game only."
        : "Games pause when this panel or tab is hidden and never resume automatically.";
  }
  function sync() {
    syncBestNamespace();
    const currentOfficePaused = officePaused();
    if (currentOfficePaused && !lastOfficePaused) localMotionOptIn = false;
    lastOfficePaused = currentOfficePaused;
    muteDuck();
    if (lifecycleBlocked()) {
      pause("Arcade paused while the panel or tab is hidden.");
      return;
    }
    if (currentOfficePaused && !localMotionOptIn && !userPaused)
      pause("Office motion paused. Press Resume to opt into game motion.");
    else render();
  }

  for (const button of sheet.querySelectorAll("[data-arcade-game]"))
    button.onclick = () => choose(button.dataset.arcadeGame);
  byId("arcade-start").onclick = () => startBreakout(true);
  byId("arcade-duck-start").onclick = () => {
    localMotionOptIn = true;
    userPaused = false;
    if (!duckFrame || duckFailed) loadDuck();
    else resumeDuck();
  };
  byId("arcade-pause").onclick = () => {
    if (!userPaused) pause("Game paused.", true);
    else if (selected === "breakout") startBreakout(false);
    else if (selected === "duck-hunt") resumeDuck();
  };
  byId("arcade-restart").onclick = () => {
    if (selected === "breakout") startBreakout(true);
    else if (selected === "duck-hunt") {
      localMotionOptIn = true;
      userPaused = false;
      loadDuck();
    }
  };
  byId("arcade-exit").onclick = exitGame;
  canvas.addEventListener("keydown", (event) => {
    if (
      !["ArrowLeft", "ArrowRight"].includes(event.key) ||
      selected !== "breakout"
    )
      return;
    event.preventDefault();
    keys.add(event.key);
    if (userPaused && breakout.state === "playing") startBreakout(false);
  });
  canvas.addEventListener("keyup", (event) => keys.delete(event.key));
  canvas.addEventListener("blur", clearKeys);
  canvas.addEventListener("pointerdown", (event) => {
    if (selected !== "breakout" || userPaused) return;
    canvas.setPointerCapture?.(event.pointerId);
    const rect = canvas.getBoundingClientRect();
    breakout.setPaddle(((event.clientX - rect.left) / rect.width) * WIDTH);
    drawBreakout();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (
      selected !== "breakout" ||
      userPaused ||
      (!event.buttons && event.pointerType !== "touch")
    )
      return;
    const rect = canvas.getBoundingClientRect();
    breakout.setPaddle(((event.clientX - rect.left) / rect.width) * WIDTH);
  });
  canvas.addEventListener("pointercancel", clearKeys);
  addEventListener("message", (event) => {
    const data = event.data;
    if (
      event.source !== duckFrame?.contentWindow ||
      event.origin !== "null" ||
      !data ||
      data.channel !== "agent-office-arcade" ||
      data.nonce !== duckNonce ||
      !["ready", "paused", "resumed", "load-error"].includes(data.type)
    )
      return;
    if (data.type === "ready") {
      duckReady = true;
      muteDuck();
      if (!userPaused && selected === "duck-hunt") resumeDuck();
      else render();
    } else if (data.type === "load-error") {
      duckReady = false;
      duckFailed = true;
      duckPaused = true;
      userPaused = true;
      localMotionOptIn = false;
      status =
        "Duck Hunt could not load its local game files. Press Retry Duck Hunt.";
      render();
    } else if (data.type === "paused") {
      duckPaused = true;
      userPaused = true;
      localMotionOptIn = false;
      status =
        "Duck Hunt paused. Press Escape in the game or Resume below to continue.";
      render();
    } else {
      duckPaused = false;
      userPaused = false;
      localMotionOptIn = true;
      status = "Duck Hunt resumed.";
      render();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause("Arcade paused because the tab was hidden.");
  });
  addEventListener("blur", () => {
    // Moving focus into the sandbox blurs the parent Window but remains an
    // intentional interaction with this panel. Defer so activeElement is final.
    setTimeout(() => {
      if (document.activeElement !== duckFrame)
        pause("Arcade paused because the window lost focus.");
    });
  });
  addEventListener("pagehide", () => {
    pause();
    unloadDuck();
  });
  new MutationObserver(sync).observe(sheet, {
    attributes: true,
    attributeFilter: ["hidden"],
  });
  reducedMotion.addEventListener?.("change", sync);
  drawBreakout();
  render();
  window.officeArcade = {
    open() {
      openSheet("sheet-arcade");
      sync();
      const control = byId(
        !selected
          ? "arcade-game-breakout"
          : selected === "duck-hunt" && !duckReady
            ? "arcade-duck-start"
            : selected === "breakout" && breakout.state !== "playing"
              ? "arcade-start"
              : "arcade-pause",
      );
      (control.disabled ? sheet.querySelector(".close") : control).focus({
        preventScroll: true,
      });
    },
    sync,
    snapshot() {
      return {
        selected,
        paused: userPaused,
        sheetOpen: sheetOpen(),
        frameActive: frame !== null,
        breakout: breakout.snapshot(),
        best,
        duck: {
          loaded: !!duckFrame,
          ready: duckReady,
          failed: duckFailed,
          paused: duckPaused,
          muted: !(typeof settings !== "undefined" && settings.sound === true),
        },
      };
    },
  };
})();
