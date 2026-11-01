"use strict";

// 积分和倍率使用 BigInt；位置、速度和时间使用 Number。
const CONFIG = Object.freeze({
  width: 900, height: 620, radius: 7, ballSpeed: 380,
  paddleWidth: 144, paddleHeight: 14, paddleBottom: 42, paddleSpeed: 760,
  paddleGrowth: 28, maxPaddleWidth: 584, centerRatio: 0.36,
  minHorizontalRatio: 0.2, maxBounceAngle: Math.PI / 3,
  baseScore: 1n, wallMultiplier: 2n, bottomMultiplier: 1n,
  edgeMultiplier: 5n, centerMultiplier: 10n,
  firstThreshold: 20n, thresholdGrowth: 135n, thresholdExtra: 10n,
  roundSeconds: 20 * 60, step: 1 / 120, maxFrameSeconds: 0.1,
  maxEffects: 55, effectSeconds: 0.8
});

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const formatScore = value => value.toLocaleString("zh-CN");

class Game {
  constructor(random = Math.random, config = CONFIG) {
    this.random = random;
    this.config = config;
    this.reset();
  }

  reset() {
    const c = this.config;
    this.score = 0n;
    this.threshold = c.firstThreshold;
    this.gap = c.firstThreshold;
    this.progressStart = 0n;
    this.level = 0;
    this.elapsed = 0;
    this.mode = "playing";
    this.wallMultiplier = c.wallMultiplier;
    this.centerMultiplier = c.centerMultiplier;
    this.paddle = { x: c.width / 2, width: c.paddleWidth, y: c.height - c.paddleBottom };
    this.balls = [];
    this.effects = [];
    this.choices = [];
    this.hits = { wall: 0, bottom: 0, edge: 0, center: 0 };
    this.addBall();
  }

  addBall() {
    const c = this.config;
    const angle = (0.3 + this.random() * 0.4) * Math.PI;
    const direction = this.random() < 0.5 ? -1 : 1;
    this.balls.push({
      x: c.width * (0.25 + this.random() * 0.5),
      y: c.height * (0.25 + this.random() * 0.25),
      vx: Math.cos(angle) * c.ballSpeed * direction,
      vy: -Math.sin(angle) * c.ballSpeed,
      radius: c.radius, multiplier: 1n, flash: 0,
      trail: []
    });
    // 新球也避免几乎竖直的初速度。
    const ball = this.balls[this.balls.length - 1];
    if (Math.abs(ball.vx) < c.ballSpeed * c.minHorizontalRatio) {
      ball.vx = c.ballSpeed * c.minHorizontalRatio * direction;
      ball.vy = -Math.sqrt(c.ballSpeed ** 2 - ball.vx ** 2);
    }
  }

  movePaddle(x) {
    const half = this.paddle.width / 2;
    this.paddle.x = clamp(x, half, this.config.width - half);
  }

  award(surface, ball, x, y) {
    const c = this.config;
    const multiplier = { wall: this.wallMultiplier, bottom: c.bottomMultiplier,
      edge: c.edgeMultiplier, center: this.centerMultiplier }[surface];
    const points = c.baseScore * multiplier * ball.multiplier;
    this.score += points;
    this.hits[surface] += 1;
    ball.flash = surface === "center" ? 0.28 : 0.1;
    this.effects.push({ x, y, points, surface, life: c.effectSeconds });
    if (this.effects.length > c.maxEffects) this.effects.shift();
  }

  collidePaddle(ball) {
    const c = this.config;
    const p = this.paddle;
    const left = p.x - p.width / 2;
    const top = p.y;
    const nearX = clamp(ball.x, left, left + p.width);
    const nearY = clamp(ball.y, top, top + c.paddleHeight);
    const dx = ball.x - nearX;
    const dy = ball.y - nearY;
    const distance = Math.hypot(dx, dy);
    if (distance >= ball.radius) return;
    let nx, ny, penetration;
    if (distance > 0) {
      nx = dx / distance;
      ny = dy / distance;
      penetration = ball.radius - distance;
    } else {
      // 挡板移动或变长后可能覆盖球，将其推出最近的一面。
      const sides = [
        { depth: ball.y - top, nx: 0, ny: -1 },
        { depth: top + c.paddleHeight - ball.y, nx: 0, ny: 1 },
        { depth: ball.x - left, nx: -1, ny: 0 },
        { depth: left + p.width - ball.x, nx: 1, ny: 0 }
      ].sort((a, b) => a.depth - b.depth);
      ({ nx, ny } = sides[0]);
      penetration = ball.radius + sides[0].depth;
    }
    ball.x += nx * (penetration + 0.001);
    ball.y += ny * (penetration + 0.001);
    const incoming = ball.vx * nx + ball.vy * ny;
    if (incoming >= 0) return;
    const offset = clamp((nearX - p.x) / (p.width / 2), -1, 1);
    const central = ny < -0.5 && Math.abs(offset) <= c.centerRatio;
    if (ny < -0.5) {
      const speed = Math.hypot(ball.vx, ball.vy);
      const direction = Math.abs(offset) < 0.01 ? (Math.sign(ball.vx) || 1) : Math.sign(offset);
      ball.vx = Math.sin(offset * c.maxBounceAngle) * speed;
      if (Math.abs(ball.vx) < speed * c.minHorizontalRatio) {
        ball.vx = speed * c.minHorizontalRatio * direction;
      }
      ball.vy = -Math.sqrt(speed * speed - ball.vx * ball.vx);
    } else {
      ball.vx -= 2 * incoming * nx;
      ball.vy -= 2 * incoming * ny;
    }
    this.award(central ? "center" : "edge", ball, nearX, nearY);
  }

  update(dt, movement = 0) {
    if (this.mode !== "playing") return;
    const c = this.config;
    dt = Math.min(dt, c.roundSeconds - this.elapsed);
    this.movePaddle(this.paddle.x + movement * c.paddleSpeed * dt);
    this.elapsed += dt;
    for (const effect of this.effects) effect.life -= dt;
    this.effects = this.effects.filter(effect => effect.life > 0);
    for (const ball of this.balls) {
      ball.flash = Math.max(0, ball.flash - dt);
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      const r = ball.radius;
      // 位置纠正和朝向判定共同防止重叠反复计分。
      if (ball.x < r) {
        ball.x = r;
        if (ball.vx < 0) { ball.vx *= -1; this.award("wall", ball, 0, ball.y); }
      } else if (ball.x > c.width - r) {
        ball.x = c.width - r;
        if (ball.vx > 0) { ball.vx *= -1; this.award("wall", ball, c.width, ball.y); }
      }
      if (ball.y < r) {
        ball.y = r;
        if (ball.vy < 0) { ball.vy *= -1; this.award("wall", ball, ball.x, 0); }
      } else if (ball.y > c.height - r) {
        ball.y = c.height - r;
        if (ball.vy > 0) { ball.vy *= -1; this.award("bottom", ball, ball.x, c.height); }
      }
      this.collidePaddle(ball);
    }
    if (this.elapsed >= c.roundSeconds - 1e-7) {
      this.elapsed = c.roundSeconds;
      this.mode = "finished";
    } else if (this.score >= this.threshold) {
      this.mode = "upgrade";
      this.choices = this.rollChoices();
    }
  }

  rollChoices() {
    const pool = ["ball", "wall", "center"];
    if (this.paddle.width < this.config.maxPaddleWidth) pool.push("paddle");
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, 3);
  }

  chooseUpgrade(id) {
    if (this.mode !== "upgrade" || !this.choices.includes(id)) return false;
    if (id === "ball") this.addBall();
    if (id === "wall") this.wallMultiplier += 1n;
    if (id === "center") this.centerMultiplier += 5n;
    if (id === "paddle") {
      this.paddle.width = Math.min(this.config.maxPaddleWidth, this.paddle.width + this.config.paddleGrowth);
      this.movePaddle(this.paddle.x);
    }
    this.level += 1;
    this.gap = this.gap * this.config.thresholdGrowth / 100n + this.config.thresholdExtra;
    // 本次全部已得积分保留；下一门槛从当前分数往后计算，避免多球批量碰撞连弹窗口。
    this.progressStart = this.score;
    this.threshold = this.score + this.gap;
    this.choices = [];
    this.mode = "playing";
    return true;
  }

  togglePause() {
    if (this.mode === "playing") this.mode = "paused";
    else if (this.mode === "paused") this.mode = "playing";
  }
}

// 同一个物理核心可直接由 Node 内置测试运行；浏览器仍通过普通 script 双击打开。
if (typeof module !== "undefined" && module.exports) module.exports = { Game, CONFIG };

if (typeof document !== "undefined") {
  const game = new Game();
  const canvas = document.querySelector("#field");
  const ctx = canvas.getContext("2d");
  const $ = id => document.getElementById(id);
  const keys = new Set();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let lastTime = null;
  let accumulator = 0;
  let previousMode = null;
  let restartReturnMode = "playing";
  let uiTime = 0;

  function upgradeInfo(id) {
    return {
      ball: { symbol: "● +", title: "再来一颗球", detail: `${game.balls.length} → ${game.balls.length + 1} 颗球，独立反弹，独立得分。` },
      paddle: { symbol: "↔", title: "挡板加长", detail: `${game.paddle.width} → ${Math.min(CONFIG.maxPaddleWidth, game.paddle.width + CONFIG.paddleGrowth)}，中央高分区也随之变宽。` },
      wall: { symbol: "┌─┐", title: "墙壁更值钱", detail: `上、左、右墙 ×${game.wallMultiplier} → ×${game.wallMultiplier + 1n}，每次反弹多赚一点。` },
      center: { symbol: "━●━", title: "中央高倍率", detail: `挡板中央 ×${game.centerMultiplier} → ×${game.centerMultiplier + 5n}，接得准，赚得多。` }
    }[id];
  }

  function syncUI() {
    $("score").textContent = formatScore(game.score);
    $("threshold").textContent = `目标 ${formatScore(game.threshold)}`;
    $("remaining").textContent = `还差 ${formatScore(game.threshold > game.score ? game.threshold - game.score : 0n)}`;
    const percentage = Number((game.score - game.progressStart) * 10000n / game.gap) / 100;
    $("progress-fill").style.width = `${clamp(percentage, 0, 100)}%`;
    document.querySelector(".progress").setAttribute("aria-valuenow", Math.round(clamp(percentage, 0, 100)));
    $("level").textContent = `已升级 ${game.level} 次`;
    $("ball-count").textContent = `${game.balls.length} 颗球`;
    $("wall-value").textContent = `×${game.wallMultiplier}`;
    $("center-value").textContent = `×${game.centerMultiplier}`;
    $("edge-value").textContent = `×${CONFIG.edgeMultiplier}`;
    $("bottom-value").textContent = `×${CONFIG.bottomMultiplier}`;
    $("paddle-value").textContent = game.paddle.width;
    const seconds = Math.ceil(CONFIG.roundSeconds - game.elapsed);
    $("timer").textContent = `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
    $("status").textContent = { playing: "正在运行", paused: "已暂停", upgrade: "选择升级", restart: "确认重新开始", finished: "本轮完成" }[game.mode];
    $("pause").disabled = !["playing", "paused"].includes(game.mode);
    $("pause").innerHTML = `${game.mode === "paused" ? "继续" : "暂停"} <kbd>空格</kbd>`;
    if (previousMode !== game.mode) {
      previousMode = game.mode;
      showOverlay();
    }
  }

  function actionButton(text, action, className = "dialog-action") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = text;
    button.addEventListener("click", action);
    return button;
  }

  function showOverlay() {
    const overlay = $("overlay");
    overlay.hidden = game.mode === "playing";
    if (overlay.hidden) { canvas.focus({ preventScroll: true }); return; }
    keys.clear();
    const content = $("dialog-content");
    content.replaceChildren();
    if (game.mode === "upgrade") {
      $("dialog-tag").textContent = `第 ${game.level + 1} 次成长`;
      $("dialog-title").textContent = "给下一次反弹，加点惊喜。";
      $("dialog-description").textContent = "三选一，立即生效。球和计时已经暂停，不用着急。";
      const cards = document.createElement("div");
      cards.className = "upgrade-cards";
      game.choices.forEach((id, index) => {
        const info = upgradeInfo(id);
        const button = actionButton("", () => { game.chooseUpgrade(id); syncUI(); }, "upgrade-card");
        button.innerHTML = `<span class="upgrade-symbol" aria-hidden="true">${info.symbol}</span><strong>${info.title}</strong><span class="detail">${info.detail}</span><span class="choice">选择升级 ↗ · 按 ${index + 1}</span>`;
        cards.append(button);
      });
      content.append(cards);
    } else if (game.mode === "paused") {
      $("dialog-tag").textContent = "休息一下";
      $("dialog-title").textContent = "球在这里，等你回来。";
      $("dialog-description").textContent = "积分、球和剩余时间都已保留。";
      content.append(actionButton("继续游戏", () => { game.togglePause(); syncUI(); }));
    } else if (game.mode === "restart") {
      $("dialog-tag").textContent = "重新开始";
      $("dialog-title").textContent = "从第一颗球，再来一轮？";
      $("dialog-description").textContent = "这会清空本轮积分、升级和计时。";
      const actions = document.createElement("div");
      actions.className = "dialog-actions";
      actions.append(actionButton("保留本轮", () => { game.mode = restartReturnMode; syncUI(); }, "cancel"));
      actions.append(actionButton("重新开始", restart));
      content.append(actions);
    } else if (game.mode === "finished") {
      $("dialog-tag").textContent = "20 分钟 · 本轮完成";
      $("dialog-title").textContent = "从一次反弹，到这么多收获。";
      $("dialog-description").textContent = "本轮已经结束。歇一会儿，或者开启下一轮。";
      const results = document.createElement("div");
      results.className = "results";
      results.innerHTML = `<div><span>累计积分</span><strong>${formatScore(game.score)}</strong></div><div><span>获得升级</span><strong>${game.level}</strong></div><div><span>球的数量</span><strong>${game.balls.length}</strong></div>`;
      content.append(results, actionButton("再玩一轮", restart));
    }
    document.querySelector(".dialog").focus({ preventScroll: true });
  }

  function restart() {
    keys.clear();
    accumulator = 0;
    game.reset();
    syncUI();
  }

  function draw() {
    const c = CONFIG;
    ctx.fillStyle = "#14273d";
    ctx.fillRect(0, 0, c.width, c.height);
    // 稀疏定位点衬托球路，避免花纹盖过游戏。
    ctx.fillStyle = "#294056";
    for (let x = 30; x < c.width; x += 30) for (let y = 30; y < c.height; y += 30) ctx.fillRect(x, y, 1, 1);
    ctx.strokeStyle = "#779fb6";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(2, c.height - 2); ctx.lineTo(2, 2); ctx.lineTo(c.width - 2, 2); ctx.lineTo(c.width - 2, c.height - 2); ctx.stroke();
    ctx.strokeStyle = "#435870";
    ctx.setLineDash([5, 7]); ctx.beginPath(); ctx.moveTo(10, c.height - 3); ctx.lineTo(c.width - 10, c.height - 3); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = "11px 'Microsoft YaHei', sans-serif";
    ctx.textAlign = "center"; ctx.fillStyle = "#9fbcd0";
    ctx.fillText(`墙壁 ×${game.wallMultiplier}`, c.width / 2, 28);
    ctx.fillStyle = "#758da4"; ctx.fillText(`底边 ×${c.bottomMultiplier} · 漏球也有收获`, c.width / 2, c.height - 14);

    for (const ball of game.balls) {
      if (!reducedMotion) {
        for (let i = 0; i < ball.trail.length; i++) {
          ctx.globalAlpha = (i + 1) / ball.trail.length * 0.16;
          ctx.fillStyle = "#bde5f4";
          ctx.beginPath(); ctx.arc(ball.trail[i].x, ball.trail[i].y, ball.radius * (i + 1) / ball.trail.length, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = ball.flash > 0.12 ? "#ffad94" : "#e2f5ff";
      ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(ball.x - 2, ball.y - 2, 2, 0, Math.PI * 2); ctx.fill();
    }

    const p = game.paddle;
    ctx.fillStyle = "#b5cbdc";
    ctx.fillRect(p.x - p.width / 2, p.y, p.width, c.paddleHeight);
    ctx.fillStyle = "#ff816b";
    ctx.fillRect(p.x - p.width * c.centerRatio / 2, p.y, p.width * c.centerRatio, c.paddleHeight);
    ctx.fillStyle = "#19334b";
    ctx.fillRect(p.x - 1, p.y + 4, 2, 6);
    ctx.font = "10px 'Consolas', monospace"; ctx.fillStyle = "#efb0a0";
    ctx.fillText(`×${game.centerMultiplier}`, p.x, p.y - 10);

    for (const effect of game.effects) {
      const fraction = effect.life / c.effectSeconds;
      const central = effect.surface === "center";
      const x = clamp(effect.x, 40, c.width - 40);
      const y = clamp(effect.y, 45, c.height - 24) - (reducedMotion ? 0 : (1 - fraction) * 25);
      ctx.globalAlpha = Math.min(1, fraction * 3);
      ctx.fillStyle = central ? "#ffab94" : "#bde5f4";
      ctx.textAlign = "center";
      ctx.font = `${central ? "bold 23" : "15"}px 'Consolas', monospace`;
      ctx.fillText(`+${formatScore(effect.points)}`, x, y);
      if (central && !reducedMotion) {
        ctx.strokeStyle = "#ff816b"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(effect.x, effect.y, 10 + (1 - fraction) * 28, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  function frame(time) {
    const delta = lastTime === null ? 0 : Math.min((time - lastTime) / 1000, CONFIG.maxFrameSeconds);
    lastTime = time;
    if (game.mode === "playing") {
      accumulator += delta;
      const movement = Number(keys.has("ArrowRight") || keys.has("KeyD")) - Number(keys.has("ArrowLeft") || keys.has("KeyA"));
      while (accumulator >= CONFIG.step && game.mode === "playing") {
        game.update(CONFIG.step, movement);
        accumulator -= CONFIG.step;
      }
      if (game.mode !== "playing") accumulator = 0;
      if (!reducedMotion) for (const ball of game.balls) {
        ball.trail.push({ x: ball.x, y: ball.y });
        if (ball.trail.length > 7) ball.trail.shift();
      }
    } else accumulator = 0;
    uiTime += delta;
    if (uiTime >= 0.08 || previousMode !== game.mode) { syncUI(); uiTime = 0; }
    draw();
    requestAnimationFrame(frame);
  }

  canvas.addEventListener("pointermove", event => {
    if (game.mode !== "playing") return;
    const rect = canvas.getBoundingClientRect();
    game.movePaddle((event.clientX - rect.left) / rect.width * CONFIG.width);
  });
  canvas.addEventListener("pointerdown", event => {
    if (event.pointerType !== "mouse" && game.mode === "playing") {
      canvas.setPointerCapture(event.pointerId);
      const rect = canvas.getBoundingClientRect();
      game.movePaddle((event.clientX - rect.left) / rect.width * CONFIG.width);
    }
    if (game.mode === "playing") canvas.focus({ preventScroll: true });
  });
  window.addEventListener("keydown", event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (game.mode === "upgrade" && ["Digit1", "Digit2", "Digit3"].includes(event.code)) {
      if (!event.repeat) game.chooseUpgrade(game.choices[Number(event.code.slice(-1)) - 1]);
      syncUI(); return;
    }
    if (["ArrowLeft", "ArrowRight", "KeyA", "KeyD"].includes(event.code)) {
      event.preventDefault(); if (game.mode === "playing") keys.add(event.code);
    }
    if (event.code === "Space" && event.target.tagName !== "BUTTON") {
      event.preventDefault(); if (!event.repeat) { game.togglePause(); syncUI(); }
    }
    if (event.code === "Escape") {
      if (game.mode === "restart") game.mode = restartReturnMode;
      else game.togglePause();
      syncUI();
    }
    // 对话框内循环焦点，避免键盘误触背后的控件。
    if (event.code === "Tab" && !$("overlay").hidden) {
      const buttons = [...$("dialog-content").querySelectorAll("button")];
      const index = buttons.indexOf(document.activeElement);
      const next = event.shiftKey ? (index <= 0 ? buttons.length - 1 : index - 1) : (index + 1) % buttons.length;
      event.preventDefault(); buttons[next]?.focus();
    }
  });
  window.addEventListener("keyup", event => keys.delete(event.code));
  window.addEventListener("blur", () => {
    keys.clear(); if (game.mode === "playing") { game.togglePause(); syncUI(); }
  });
  document.addEventListener("visibilitychange", () => {
    lastTime = null; accumulator = 0;
    if (document.hidden && game.mode === "playing") { game.togglePause(); syncUI(); }
  });
  $("pause").addEventListener("click", () => { game.togglePause(); syncUI(); });
  $("restart").addEventListener("click", () => {
    if (game.mode === "restart") return;
    restartReturnMode = game.mode; game.mode = "restart"; syncUI();
  });
  syncUI();
  requestAnimationFrame(frame);
}
