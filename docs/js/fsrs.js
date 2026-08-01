/* FSRS-4.5 调度器（静态版用，无后端时在浏览器本地排期）。
   公式与默认权重来自 open-spaced-repetition/fsrs4anki 论文实现。
   卡片状态: {reps, lapses, stability, difficulty, due(ms), lastReview(ms), state} */

"use strict";

const FSRS = (() => {
  const W = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031,
             1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755];
  const DECAY = -0.5;
  const FACTOR = 19 / 81;
  const RETENTION = 0.9;
  const DAY = 86400000;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function retrievability(elapsedDays, stability) {
    return Math.pow(1 + (FACTOR * elapsedDays) / stability, DECAY);
  }
  function initStability(g) { return Math.max(W[g - 1], 0.1); }
  function initDifficulty(g) { return clamp(W[4] - (g - 3) * W[5], 1, 10); }
  function nextDifficulty(d, g) {
    const nd = d - W[6] * (g - 3);
    return clamp(W[7] * initDifficulty(3) + (1 - W[7]) * nd, 1, 10);
  }
  function recallStability(d, s, r, g) {
    const hard = g === 2 ? W[15] : 1;
    const easy = g === 4 ? W[16] : 1;
    return s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) *
      (Math.exp(W[10] * (1 - r)) - 1) * hard * easy);
  }
  function forgetStability(d, s, r) {
    return Math.min(
      W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r)),
      s
    );
  }
  // 目标保持率 0.9 时 interval ≈ stability 天。
  function intervalDays(s) {
    return clamp(Math.round((s / FACTOR) * (Math.pow(RETENTION, 1 / DECAY) - 1)), 1, 36500);
  }

  /** 评分一张卡。rating: 1=重来 2=困难 3=良好 4=简单。返回新状态。 */
  function review(card, rating, now = Date.now()) {
    const c = { ...card };
    const isNew = c.lastReview == null;
    if (isNew) {
      c.stability = initStability(rating);
      c.difficulty = initDifficulty(rating);
      c.state = rating === 1 ? 1 : 2; // learning / review
    } else {
      const elapsed = Math.max(0, (now - c.lastReview) / DAY);
      const r = retrievability(elapsed, c.stability || 0.1);
      c.difficulty = nextDifficulty(c.difficulty || 5, rating);
      if (rating === 1) {
        c.stability = forgetStability(c.difficulty, c.stability || 0.1, r);
        c.lapses = (c.lapses || 0) + 1;
        c.state = 3; // relearning
      } else {
        c.stability = recallStability(c.difficulty, c.stability || 0.1, r, rating);
        c.state = 2;
      }
    }
    c.reps = (c.reps || 0) + 1;
    c.lastReview = now;
    // 重来 → 10 分钟后再见；其余按稳定度排天。
    c.due = rating === 1 ? now + 10 * 60000 : now + intervalDays(c.stability) * DAY;
    return c;
  }

  return { review, intervalDays };
})();

if (typeof module !== "undefined") module.exports = FSRS;
