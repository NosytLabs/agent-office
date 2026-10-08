/* Local arcade host. Breakout and Snake adapt MIT-licensed mazipan/mini-games; Duck Hunt runs in a sandbox. */
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
        // Separate the ball from the contact surface before the next substep.
        // Otherwise a diagonal corner can damage the same brick twice.
        if (fromSide) {
          ball.x = ball.vx > 0 ? brick.x - BALL_RADIUS : brick.x + brick.w + BALL_RADIUS;
          ball.vx *= -1;
        } else {
          ball.y = ball.vy > 0 ? brick.y - BALL_RADIUS : brick.y + brick.h + BALL_RADIUS;
          ball.vy *= -1;
        }
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

  // Port of Snake's startGame/setDir/tick/scoring from mazipan/mini-games
  // a9421318e6f4644c5f144df78576114db60de8a6, src/games/snake/index.njk.
  // MIT notice: web/assets/arcade/LICENSE. No autoplay, intervals, or global keys.
  const SNAKE_COLS = 24,
    SNAKE_ROWS = 18,
    SNAKE_CELL = 20,
    SNAKE_KEYS = Object.freeze({
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      w: [0, -1],
      s: [0, 1],
      a: [-1, 0],
      d: [1, 0],
    });

  class SnakeGame {
    constructor(random = Math.random) {
      this.random = random;
      this.start();
      this.state = "ready";
    }
    get speed() {
      return Math.max(0.1, 0.45 - (this.level - 1) * 0.025);
    }
    start() {
      const x = Math.floor(SNAKE_COLS / 2),
        y = Math.floor(SNAKE_ROWS / 2);
      this.body = [{ x, y }, { x: x - 1, y }, { x: x - 2, y }];
      this.direction = { x: 1, y: 0 };
      this.nextDirection = null;
      this.elapsed = 0;
      this.score = 0;
      this.level = 1;
      this.lives = 1;
      this.state = "playing";
      this.spawnFood();
    }
    spawnFood() {
      // Enumerating free cells also terminates when the board is full.
      const occupied = new Set(this.body.map((p) => p.y * SNAKE_COLS + p.x)),
        free = [];
      for (let y = 0; y < SNAKE_ROWS; y++)
        for (let x = 0; x < SNAKE_COLS; x++)
          if (!occupied.has(y * SNAKE_COLS + x)) free.push({ x, y });
      if (!free.length) {
        this.food = null;
        this.state = "won";
        return;
      }
      const random = this.random(),
        fraction = Number.isFinite(random) ? Math.max(0, Math.min(1, random)) : 0;
      this.food = free[Math.min(free.length - 1, Math.floor(fraction * free.length))];
    }
    turn(x, y) {
      if (
        this.state !== "playing" ||
        this.nextDirection ||
        !Number.isInteger(x) ||
        !Number.isInteger(y) ||
        Math.abs(x) + Math.abs(y) !== 1 ||
        (x === -this.direction.x && y === -this.direction.y) ||
        (x === this.direction.x && y === this.direction.y)
      ) return false;
      this.nextDirection = { x, y };
      return true;
    }
    clearInput() {
      this.nextDirection = null;
    }
    step(seconds) {
      if (this.state !== "playing" || !Number.isFinite(seconds) || seconds <= 0) return;
      this.elapsed += Math.min(0.25, seconds);
      while (this.elapsed + 1e-9 >= this.speed && this.state === "playing") {
        this.elapsed = Math.max(0, this.elapsed - this.speed);
        this.advance();
      }
    }
    advance() {
      if (this.state !== "playing") return;
      this.direction = this.nextDirection || this.direction;
      this.nextDirection = null;
      const head = {
          x: this.body[0].x + this.direction.x,
          y: this.body[0].y + this.direction.y,
        },
        eating = head.x === this.food?.x && head.y === this.food?.y,
        occupied = eating ? this.body : this.body.slice(0, -1);
      if (
        head.x < 0 || head.x >= SNAKE_COLS ||
        head.y < 0 || head.y >= SNAKE_ROWS ||
        occupied.some((p) => p.x === head.x && p.y === head.y)
      ) {
        this.state = "lost";
        this.lives = 0;
        return;
      }
      this.body.unshift(head);
      if (eating) {
        this.score += 10;
        this.level = Math.floor(this.score / 50) + 1;
        this.spawnFood();
      } else this.body.pop();
    }
    snapshot() {
      return {
        state: this.state,
        score: this.score,
        level: this.level,
        lives: this.lives,
        body: this.body.map((p) => ({ ...p })),
        food: this.food ? { ...this.food } : null,
      };
    }
  }

  if (typeof module !== "undefined" && module.exports)
    module.exports = { BreakoutGame, SnakeGame, WIDTH, HEIGHT, PATTERNS, SNAKE_COLS, SNAKE_ROWS };
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
    snake = new SnakeGame(),
    swipe = null,
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

  function nativeSelected() {
    return selected === "breakout" || selected === "snake";
  }
  function nativeGame() {
    return selected === "snake" ? snake : breakout;
  }
  function gameTitle() {
    return selected === "snake" ? "Snake" : "Breakout";
  }
  function storageKey() {
    return `agent-office:${window._state?.mode === "demo" ? "preview" : "observer"}:arcade:${selected === "snake" ? "snake" : "breakout"}-best`;
  }
  function readBest(key = storageKey()) {
    try {
      const value = Number(localStorage.getItem(key));
      return Number.isSafeInteger(value) && value >= 0 ? value : 0;
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
      !nativeSelected() ||
      userPaused ||
      lifecycleBlocked() ||
      nativeGame().state !== "playing"
    )
      return;
    frame = requestAnimationFrame(tick);
  }
  function tick(time) {
    frame = null;
    if (userPaused || lifecycleBlocked() || !nativeSelected()) return;
    const seconds = lastFrame ? Math.min(0.05, (time - lastFrame) / 1000) : 0;
    lastFrame = time;
    const game = nativeGame();
    if (selected === "breakout") {
      if (keys.has("ArrowLeft")) breakout.movePaddle(-1, seconds);
      if (keys.has("ArrowRight")) breakout.movePaddle(1, seconds);
    }
    game.step(seconds);
    // Save at scoring time so changing games does not discard a personal best.
    if (game.score > best) {
      best = game.score;
      writeBest(best);
    }
    if (game.state === "won" || game.state === "lost") {
      stopFrame();
      userPaused = true;
      status =
        game.state === "won"
          ? `Cabinet cleared. Final score ${game.score}.`
          : `Game over. Final score ${game.score}.`;
    } else schedule();
    drawNative();
    render();
  }
  function drawNative() {
    const game = nativeGame();
    context.fillStyle = "#121b25";
    context.fillRect(0, 0, WIDTH, HEIGHT);
    context.fillStyle = "#182633";
    const grid = selected === "snake" ? SNAKE_CELL : 24;
    for (let x = 0; x < WIDTH; x += grid) context.fillRect(x, 0, 1, HEIGHT);
    for (let y = 0; y < HEIGHT; y += grid) context.fillRect(0, y, WIDTH, 1);
    if (selected === "snake") {
      for (let i = game.body.length - 1; i >= 0; i--) {
        const segment = game.body[i],
          x = segment.x * SNAKE_CELL,
          y = segment.y * SNAKE_CELL;
        context.fillStyle = i === 0 ? "#b6e1ba" : i % 2 ? "#719f8a" : "#87b29a";
        context.fillRect(x + 1, y + 1, SNAKE_CELL - 2, SNAKE_CELL - 2);
        if (i === 0) {
          context.fillStyle = "#121b25";
          const dx = game.direction.x * 4, dy = game.direction.y * 4;
          context.fillRect(x + 7 + dx - Math.abs(dy), y + 7 + dy - Math.abs(dx), 3, 3);
          context.fillRect(x + 7 + dx + Math.abs(dy), y + 7 + dy + Math.abs(dx), 3, 3);
        }
      }
      if (game.food) {
        const x = game.food.x * SNAKE_CELL, y = game.food.y * SNAKE_CELL;
        context.fillStyle = "#f3c779";
        context.fillRect(x + 5, y + 6, 11, 10);
        context.fillStyle = "#9ad6bf";
        context.fillRect(x + 10, y + 3, 5, 3);
      }
    } else {
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
    }
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
              ? gameTitle().toUpperCase()
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
    swipe = null;
    snake.clearInput();
  }
  function pause(message, explicit = false) {
    stopFrame();
    clearKeys();
    userPaused = true;
    if (explicit) localMotionOptIn = false;
    if (selected === "duck-hunt") pauseDuck();
    if (message) status = message;
    drawNative();
    render();
  }
  function startNative(fresh = false) {
    if (!nativeSelected() || lifecycleBlocked()) return;
    const game = nativeGame();
    if (fresh || game.state !== "playing") {
      stopFrame();
      clearKeys();
      game.start();
    }
    unloadDuck();
    localMotionOptIn = true;
    userPaused = false;
    status = selected === "snake"
      ? "Snake running. Use arrows or WASD on the canvas, swipe, or use the direction buttons."
      : "Breakout running. Drag the paddle or hold Left and Right while the canvas is focused.";
    canvas.focus({ preventScroll: true });
    drawNative();
    render();
    schedule();
  }
  function choose(game) {
    if (!["breakout", "duck-hunt", "snake"].includes(game)) return;
    pause();
    if (selected === "duck-hunt" && game !== selected) unloadDuck();
    selected = game;
    syncBestNamespace();
    userPaused = true;
    localMotionOptIn = false;
    status =
      nativeSelected()
        ? `${gameTitle()} selected. Press Start when you are ready.`
        : "Duck Hunt selected. Press Load & start; the game stays stopped until then.";
    render();
    drawNative();
    const control = byId(nativeSelected()
      ? nativeGame().state === "playing" ? "arcade-pause" : "arcade-start"
      : duckReady ? "arcade-pause" : "arcade-duck-start");
    control.focus({ preventScroll: true });
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
        : nativeSelected()
          ? gameTitle()
          : "Arcade cabinet";
    for (const button of sheet.querySelectorAll("[data-arcade-game]"))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.arcadeGame === selected),
      );
    const state = nativeGame().snapshot();
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
      !nativeSelected() || state.state === "playing";
    byId("arcade-start").textContent = `Start ${gameTitle()}`;
    canvas.setAttribute("aria-label", selected === "snake"
      ? "Snake playfield. Use arrows or WASD, swipe, or use the direction buttons."
      : "Breakout playfield. Drag to move the paddle, or use Left and Right arrow keys.");
    sheet.querySelector(".arcade-hud").setAttribute("aria-label", `${gameTitle()} score`);
    for (const button of sheet.querySelectorAll("[data-snake-turn]"))
      button.disabled = selected !== "snake" || userPaused || state.state !== "playing";
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

  // Register the additional upstream game without duplicating the arcade host.
  const snakeChoice = document.createElement("button");
  snakeChoice.type = "button";
  snakeChoice.id = "arcade-game-snake";
  snakeChoice.className = "arcade-choice";
  snakeChoice.dataset.arcadeGame = "snake";
  const snakeTitle = document.createElement("strong"),
    snakeDescription = document.createElement("span");
  snakeTitle.textContent = "Snake";
  snakeDescription.textContent = "Growing snake · arrows, WASD, swipe, or touch buttons";
  snakeChoice.append(snakeTitle, snakeDescription);
  sheet.querySelector(".arcade-picker").append(snakeChoice);
  sheet.querySelector(".arcade-intro").textContent =
    "Pick a game for your next break. Breakout and Snake best scores stay in this browser.";
  const attribution = sheet.querySelector(".arcade-attribution");
  if (attribution?.firstChild?.nodeType === 3)
    attribution.firstChild.textContent = "Breakout and Snake by ";
  const directions = document.createElement("div");
  directions.id = "arcade-snake-controls";
  directions.setAttribute("role", "group");
  directions.setAttribute("aria-label", "Snake directions");
  for (const [label, x, y] of [["Up", 0, -1], ["Left", -1, 0], ["Down", 0, 1], ["Right", 1, 0]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn";
    button.textContent = label;
    button.setAttribute("aria-label", `Snake ${label.toLowerCase()}`);
    button.dataset.snakeTurn = label.toLowerCase();
    button.onclick = () => {
      if (selected === "snake" && !userPaused) snake.turn(x, y);
    };
    directions.append(button);
  }
  byId("arcade-breakout-stage").after(directions);

  for (const button of sheet.querySelectorAll("[data-arcade-game]"))
    button.onclick = () => choose(button.dataset.arcadeGame);
  byId("arcade-start").onclick = () => startNative(true);
  byId("arcade-duck-start").onclick = () => {
    localMotionOptIn = true;
    userPaused = false;
    if (!duckFrame || duckFailed) loadDuck();
    else resumeDuck();
  };
  byId("arcade-pause").onclick = () => {
    if (!userPaused) pause("Game paused.", true);
    else if (nativeSelected()) startNative(false);
    else if (selected === "duck-hunt") resumeDuck();
  };
  byId("arcade-restart").onclick = () => {
    if (nativeSelected()) startNative(true);
    else if (selected === "duck-hunt") {
      localMotionOptIn = true;
      userPaused = false;
      loadDuck();
    }
  };
  byId("arcade-exit").onclick = exitGame;
  canvas.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || lifecycleBlocked()) return;
    if (selected === "snake" && SNAKE_KEYS[event.key]) {
      event.preventDefault();
      if (!userPaused && !event.repeat) snake.turn(...SNAKE_KEYS[event.key]);
      return;
    }
    if (
      !["ArrowLeft", "ArrowRight"].includes(event.key) ||
      selected !== "breakout"
    )
      return;
    event.preventDefault();
    keys.add(event.key);
    if (userPaused && breakout.state === "playing") startNative(false);
  });
  canvas.addEventListener("keyup", (event) => keys.delete(event.key));
  canvas.addEventListener("blur", clearKeys);
  canvas.addEventListener("pointerdown", (event) => {
    if (userPaused) return;
    if (selected === "snake") {
      swipe = { x: event.clientX, y: event.clientY, id: event.pointerId };
      canvas.setPointerCapture?.(event.pointerId);
      return;
    }
    if (selected !== "breakout") return;
    canvas.setPointerCapture?.(event.pointerId);
    const rect = canvas.getBoundingClientRect();
    breakout.setPaddle(((event.clientX - rect.left) / rect.width) * WIDTH);
    drawNative();
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
  canvas.addEventListener("pointerup", (event) => {
    if (selected !== "snake" || userPaused || !swipe || swipe.id !== event.pointerId) return;
    const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y;
    swipe = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 12) return;
    if (Math.abs(dx) > Math.abs(dy)) snake.turn(Math.sign(dx), 0);
    else snake.turn(0, Math.sign(dy));
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
  reducedMotion.addEventListener?.("change", () => {
    if (reducedMotion.matches) pause("Reduced motion enabled. Press Resume to opt into game motion.", true);
    else sync();
  });
  drawNative();
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
            : nativeSelected() && nativeGame().state !== "playing"
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
        snake: snake.snapshot(),
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
