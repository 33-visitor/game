"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Game, CONFIG } = require("../game.js");

function fresh() {
  const game = new Game(() => 0.42);
  game.threshold = 10n ** 20n;
  return game;
}

function place(game, x, y, vx, vy) {
  Object.assign(game.balls[0], { x, y, vx, vy });
  return game.balls[0];
}

test("三面墙与底边分别计分，反弹后不会因持续重叠重复刷分", () => {
  for (const [x, y, vx, vy, expected, surface] of [
    [7.1, 200, -100, 0, 2n, "wall"],
    [892.9, 200, 100, 0, 2n, "wall"],
    [200, 7.1, 0, -100, 2n, "wall"],
    [100, 612.9, 0, 100, 1n, "bottom"]
  ]) {
    const game = fresh();
    const ball = place(game, x, y, vx, vy);
    game.update(CONFIG.step);
    assert.equal(game.score, expected);
    assert.equal(game.hits[surface], 1);
    assert.equal(game.mode, "playing");
    assert.ok(ball.x >= ball.radius && ball.x <= CONFIG.width - ball.radius);
    assert.ok(ball.y >= ball.radius && ball.y <= CONFIG.height - ball.radius);
    game.update(CONFIG.step);
    assert.equal(game.score, expected);
  }
});

test("挡板中央高于两端；中央仍保持水平速度且总速度守恒", () => {
  for (const [offset, expected] of [[0, 10n], [0.8, 5n], [-0.8, 5n]]) {
    const game = fresh();
    const ball = place(game, game.paddle.x + offset * game.paddle.width / 2,
      game.paddle.y - CONFIG.radius - 0.1, 0, CONFIG.ballSpeed);
    game.update(CONFIG.step);
    assert.equal(game.score, expected);
    assert.ok(ball.vy < 0);
    assert.ok(Math.abs(ball.vx) >= CONFIG.ballSpeed * CONFIG.minHorizontalRatio - 1e-6);
    assert.ok(Math.abs(Math.hypot(ball.vx, ball.vy) - CONFIG.ballSpeed) < 1e-6);
    for (let i = 0; i < 5; i++) game.update(CONFIG.step);
    assert.equal(game.score, expected);
  }
});

test("挡板侧面、下表面和圆角有实体碰撞并仅计一次", () => {
  const cases = [
    [game => game.paddle.x - game.paddle.width / 2 - 6, game => game.paddle.y + 7, 100, 0, "x"],
    [game => game.paddle.x, game => game.paddle.y + CONFIG.paddleHeight + 6, 0, -100, "y"],
    [game => game.paddle.x + game.paddle.width / 2 + 4, game => game.paddle.y - 4, -100, 100, "corner"]
  ];
  for (const [x, y, vx, vy, axis] of cases) {
    const game = fresh();
    const ball = place(game, x(game), y(game), vx, vy);
    game.update(CONFIG.step);
    assert.equal(game.score, 5n);
    if (axis === "x") assert.ok(ball.vx < 0);
    if (axis === "y") assert.ok(ball.vy > 0);
    const score = game.score;
    game.update(CONFIG.step);
    assert.equal(game.score, score);
  }
});

test("漏过挡板继续撞底边反弹，没有自动接球", () => {
  const game = fresh();
  const ball = place(game, 40, game.paddle.y - 20, 0, 380);
  for (let i = 0; i < 30; i++) game.update(CONFIG.step);
  assert.equal(game.hits.center + game.hits.edge, 0);
  assert.equal(game.hits.bottom, 1);
  assert.equal(game.score, 1n);
  assert.ok(ball.vy < 0);
  assert.equal(game.paddle.x, CONFIG.width / 2);
});

test("鼠标目标和键盘移动都不能使挡板越界", () => {
  const game = fresh();
  game.movePaddle(-1e6);
  assert.equal(game.paddle.x, game.paddle.width / 2);
  game.update(CONFIG.step, -1);
  assert.equal(game.paddle.x, game.paddle.width / 2);
  game.movePaddle(1e6);
  assert.equal(game.paddle.x, CONFIG.width - game.paddle.width / 2);
});

test("升级候选始终三张不重复；选择后生效并叠加", () => {
  for (const id of ["ball", "paddle", "wall", "center"]) {
    const game = new Game(() => 0.42);
    for (let repeat = 1; repeat <= 2; repeat++) {
      game.mode = "upgrade";
      game.choices = [id];
      assert.equal(game.chooseUpgrade(id), true);
      assert.equal(game.mode, "playing");
      assert.equal(game.balls.length, id === "ball" ? repeat + 1 : 1);
      assert.equal(game.paddle.width, CONFIG.paddleWidth + (id === "paddle" ? repeat * CONFIG.paddleGrowth : 0));
      assert.equal(game.wallMultiplier, CONFIG.wallMultiplier + (id === "wall" ? BigInt(repeat) : 0n));
      assert.equal(game.centerMultiplier, CONFIG.centerMultiplier + (id === "center" ? 5n * BigInt(repeat) : 0n));
      const choices = game.rollChoices();
      assert.equal(choices.length, 3);
      assert.equal(new Set(choices).size, 3);
    }
    assert.ok(game.balls.every(ball => ball.vx !== 0 && ball.vy !== 0));
  }
});

test("满长挡板不再提供无效加长卡；加长时不会超边界", () => {
  const game = fresh();
  game.movePaddle(0);
  game.paddle.width = CONFIG.maxPaddleWidth - 1;
  game.mode = "upgrade";
  game.choices = ["paddle"];
  game.chooseUpgrade("paddle");
  assert.equal(game.paddle.width, CONFIG.maxPaddleWidth);
  assert.equal(game.paddle.x, game.paddle.width / 2);
  assert.deepEqual(new Set(game.rollChoices()), new Set(["ball", "wall", "center"]));
});

test("多球独立计分；越过多个门槛后不会连续重复弹升级", () => {
  const game = new Game(() => 0.42);
  game.score = 19n;
  for (let i = 0; i < 20; i++) game.addBall();
  for (const ball of game.balls) Object.assign(ball, { x: 50, y: 7.1, vx: 100, vy: -100 });
  game.update(CONFIG.step);
  assert.equal(game.score, 61n);
  assert.equal(game.mode, "upgrade");
  assert.equal(new Set(game.choices).size, 3);
  const score = game.score;
  game.chooseUpgrade(game.choices[0]);
  assert.equal(game.score, score);
  assert.ok(game.threshold > game.score);
  game.update(CONFIG.step);
  assert.equal(game.mode, "playing");
});

test("暂停、升级、确认重开、结算均冻结物理、特效和时钟", () => {
  for (const mode of ["paused", "upgrade", "restart", "finished"]) {
    const game = fresh();
    game.mode = mode;
    const before = structuredClone({ balls: game.balls, score: game.score, time: game.elapsed, paddle: game.paddle });
    game.update(CONFIG.step, 1);
    assert.deepEqual({ balls: game.balls, score: game.score, time: game.elapsed, paddle: game.paddle }, before);
  }
});

test("暂停恢复后继续原球路，重新开始清空全部本轮状态", () => {
  const game = new Game(() => 0.42);
  game.update(CONFIG.step);
  game.togglePause();
  assert.equal(game.mode, "paused");
  const x = game.balls[0].x;
  game.togglePause();
  game.update(CONFIG.step);
  assert.notEqual(game.balls[0].x, x);
  game.mode = "upgrade"; game.choices = ["ball"]; game.chooseUpgrade("ball");
  game.score = 12345n;
  game.reset();
  assert.equal(game.score, 0n);
  assert.equal(game.balls.length, 1);
  assert.equal(game.level, 0);
  assert.equal(game.elapsed, 0);
  assert.equal(game.threshold, 20n);
  assert.equal(game.paddle.width, CONFIG.paddleWidth);
});

test("超出安全整数范围仍精确计分；每球可以有独立倍率", () => {
  const game = fresh();
  game.score = 9007199254740993n;
  const ball = place(game, 7.1, 200, -100, 0);
  ball.multiplier = 3n;
  game.update(CONFIG.step);
  assert.equal(game.score, 9007199254740999n);
});

test("特效数量上限不影响实际积分", () => {
  const game = fresh();
  for (let i = 0; i < 200; i++) game.award("wall", game.balls[0], 0, 100);
  assert.equal(game.effects.length, CONFIG.maxEffects);
  assert.equal(game.score, 400n);
});

test("20 分钟整停止，并且结算优先于同一步达到的升级门槛", () => {
  const game = new Game(() => 0.42);
  game.elapsed = CONFIG.roundSeconds - CONFIG.step / 2;
  game.score = game.threshold;
  game.update(CONFIG.step);
  assert.equal(game.mode, "finished");
  assert.equal(game.elapsed, CONFIG.roundSeconds);
});

test("相同球路下主动瞄准中央的早期收益高于固定挡板", () => {
  function simulate(active) {
    const game = fresh();
    place(game, 150, 220, 228, 304);
    for (let i = 0; i < 120 * 120; i++) {
      const ball = game.balls[0];
      if (active) game.movePaddle(ball.x + ball.vx * CONFIG.step);
      game.update(CONFIG.step);
    }
    return game;
  }
  const idle = simulate(false);
  const active = simulate(true);
  assert.ok(active.score > idle.score * 2n, `主动 ${active.score}，固定 ${idle.score}`);
  assert.ok(idle.score > 0n);
});

test("加速模拟完整20分钟：主动与固定挡板两种策略均能升级并正常结算", t => {
  for (const active of [false, true]) {
    let seed = 20261101;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const game = new Game(random);
    let steps = 0;
    while (game.mode !== "finished" && steps < 120 * 1201) {
      if (game.mode === "upgrade") {
        const priority = game.level % 3 === 0 ? ["ball", "center", "wall", "paddle"] : ["center", "wall", "ball", "paddle"];
        game.chooseUpgrade(priority.find(id => game.choices.includes(id)));
      }
      if (active) {
        const target = game.balls.filter(ball => ball.vy > 0 && ball.y < game.paddle.y - ball.radius)
          .sort((a, b) => b.y - a.y)[0];
        if (target) game.movePaddle(target.x + target.vx * CONFIG.step);
      }
      game.update(CONFIG.step);
      steps++;
      for (const ball of game.balls) {
        assert.ok(Number.isFinite(ball.x) && Number.isFinite(ball.y));
        assert.ok(ball.x >= ball.radius - 0.01 && ball.x <= CONFIG.width - ball.radius + 0.01);
        assert.ok(ball.y >= ball.radius - 0.01 && ball.y <= CONFIG.height - ball.radius + 0.01);
      }
    }
    assert.equal(game.mode, "finished");
    assert.equal(game.elapsed, CONFIG.roundSeconds);
    assert.ok(game.level > 8);
    t.diagnostic(`${active ? "自动瞄准中央的理想操作" : "固定挡板"}：${game.score} 分，${game.level} 次升级，${game.balls.length} 颗球。此为加速逻辑模拟，不是真人试玩。`);
  }
});
