/* 引擎抽象层：同一套 UI 跑两种后端。
   ServerEngine —— Mac Flask（Gemini 判定、SQLite、真迹代理）
   LocalEngine  —— 纯静态（localStorage + 浏览器内 FSRS、自评判定、真迹直连图床）
   选择由 config.js 的 window.CAOSHU_STATIC 决定。 */

"use strict";

/* ================= 服务器引擎 ================= */

class ServerEngine {
  constructor() { this.mode = "server"; }
  async init() {}
  _get(p) { return fetch(p).then((r) => r.json()); }
  _post(p, body) {
    return fetch(p, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body) }).then((r) => r.json());
  }
  state() { return this._get("api/state"); }
  grade(cardId, rating) { return this._post("api/grade", { card_id: cardId, rating }); }
  chars() { return this._get("api/chars"); }
  decomposition(kai) { return this._get("api/decomposition/" + encodeURIComponent(kai)); }
  options(kai) { return this._get("api/options/" + encodeURIComponent(kai)); }
  judge(kai, image) { return this._post("api/judge", { kai, image }); }
  calligraphy(kai) { return this._get("api/calligraphy/" + encodeURIComponent(kai)); }
  settings() { return this._get("api/settings"); }
  saveSettings(patch) { return this._post("api/settings", patch); }
  exportData() { return null; }
  importData() { return null; }
}

/* ================= 本地引擎（静态版） ================= */

const LS = {
  cards: "caoshu.cards.v1",
  logs: "caoshu.logs.v1",
  settings: "caoshu.settings.v1",
};

class LocalEngine {
  constructor() {
    this.mode = "static";
    this.lib = [];        // 3000 字
    this.core = [];       // 1000 学习字
    this.decomp = {};
    this.cards = {};      // id -> fsrs 状态
    this.logs = [];
    this.cfg = { dailyNewLimit: 10 };
  }

  async init() {
    const [chars, decs] = await Promise.all([
      fetch("data/chars.json").then((r) => r.json()),
      fetch("data/decompositions.json").then((r) => r.json()),
    ]);
    this.lib = chars;
    this.core = chars.filter((c) => c.core);
    decs.forEach((d) => (this.decomp[d.kai] = d));
    try { this.cards = JSON.parse(localStorage.getItem(LS.cards)) || {}; } catch { this.cards = {}; }
    try { this.logs = JSON.parse(localStorage.getItem(LS.logs)) || []; } catch { this.logs = []; }
    try { Object.assign(this.cfg, JSON.parse(localStorage.getItem(LS.settings)) || {}); } catch {}
  }

  _persist() {
    localStorage.setItem(LS.cards, JSON.stringify(this.cards));
    localStorage.setItem(LS.logs, JSON.stringify(this.logs.slice(-20000)));
    localStorage.setItem(LS.settings, JSON.stringify(this.cfg));
  }

  _cardIds() {
    // 卡 id：`kai/r` 认字、`kai/p` 书写；顺序即字频序。
    const ids = [];
    this.core.forEach((c) => { ids.push(c.kai + "/r"); ids.push(c.kai + "/p"); });
    return ids;
  }

  _cardMeta(id) {
    const kai = id.slice(0, -2);
    const h = this.lib.find((c) => c.kai === kai) || { pinyin: "", freqRank: 0 };
    const st = this.cards[id] || {};
    return {
      id, kai,
      pinyin: h.pinyin, freqRank: h.freqRank,
      direction: id.endsWith("/r") ? "recognize" : "produce",
      reps: st.reps || 0, state: st.state || 0,
      due: st.due || null, isNew: !(st.reps > 0),
    };
  }

  _localDay(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  async state() {
    const now = Date.now();
    const today = this._localDay(now);
    const metas = this._cardIds().map((id) => this._cardMeta(id));
    const reviews = metas
      .filter((m) => m.reps > 0 && m.due && m.due <= now)
      .sort((a, b) => a.due - b.due);
    const introducedToday = Object.values(this.cards).filter(
      (c) => c.firstReview && this._localDay(c.firstReview) === today
    ).length;
    const allowance = Math.max(0, this.cfg.dailyNewLimit - introducedToday);
    const news = metas.filter((m) => m.isNew).slice(0, allowance);
    return {
      queue: [...reviews, ...news],
      newCount: news.length,
      reviewCount: reviews.length,
      streak: this._streak(),
      dailyNewLimit: this.cfg.dailyNewLimit,
      geminiConfigured: false,
      mode: "static",
    };
  }

  _streak() {
    if (!this.logs.length) return 0;
    const days = new Set(this.logs.map((l) => this._localDay(l.at)));
    let cursor = new Date();
    if (!days.has(this._localDay(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
    let n = 0;
    while (days.has(this._localDay(cursor.getTime()))) { n += 1; cursor.setDate(cursor.getDate() - 1); }
    return n;
  }

  async grade(cardId, rating) {
    const now = Date.now();
    const prev = this.cards[cardId] || {};
    const next = FSRS.review(prev, rating, now);
    if (!prev.firstReview) next.firstReview = now;
    this.cards[cardId] = next;
    this.logs.push({ cardId, rating, at: now });
    this._persist();
    return this.state();
  }

  async chars() {
    const started = new Set();
    Object.entries(this.cards).forEach(([id, c]) => { if (c.reps > 0) started.add(id.slice(0, -2)); });
    return this.lib.map((c) => ({ ...c, started: started.has(c.kai), hasDecomp: !!this.decomp[c.kai] }));
  }

  async decomposition(kai) {
    const h = this.lib.find((c) => c.kai === kai);
    if (!h) return { error: "not found" };
    const d = this.decomp[kai];
    return d
      ? { ...d, pinyin: h.pinyin }
      : { kai, pinyin: h.pinyin, symbols: [], evolution: "", confusable: [], missing: true };
  }

  async options(kai) {
    const pool = this.lib.filter((c) => c.core && c.kai !== kai).map((c) => c.kai);
    const opts = [];
    while (opts.length < 3 && pool.length) {
      const i = Math.floor(Math.random() * pool.length);
      opts.push(pool.splice(i, 1)[0]);
    }
    opts.push(kai);
    for (let i = opts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [opts[i], opts[j]] = [opts[j], opts[i]];
    }
    return opts;
  }

  async judge(kai) {
    return {
      score: 0, verdict: "fail", mode: "selfAssess", suggestedRating: 3,
      feedback: `静态版无自动判定。对照范本比一比「${kai}」的结构，自己评个档。`,
    };
  }

  async calligraphy(kai) {
    // 预抓清单（构建时生成）；无则空。图片直连图床（no-referrer）。
    const cp = [...kai].map((ch) => ch.codePointAt(0)).join("_");
    try {
      const r = await fetch(`data/calligraphy/${cp}.json`);
      if (!r.ok) return [];
      return await r.json();
    } catch { return []; }
  }

  async settings() {
    return { dailyNewLimit: this.cfg.dailyNewLimit, geminiConfigured: false, mode: "static" };
  }
  async saveSettings(patch) {
    if ("dailyNewLimit" in patch)
      this.cfg.dailyNewLimit = Math.max(0, Math.min(100, Number(patch.dailyNewLimit) || 0));
    this._persist();
    return this.settings();
  }

  async progress() {
    const metas = this._cardIds().map((id) => this._cardMeta(id));
    let mastered = 0, learning = 0, notStarted = 0;
    const dist = {};
    metas.forEach((m) => {
      const st = this.cards[m.id];
      if (!st || !st.reps) { notStarted += 1; return; }
      if (st.state === 2 && (st.stability || 0) >= 21) mastered += 1;
      else learning += 1;
      const day = this._localDay(st.due);
      dist[day] = (dist[day] || 0) + 1;
    });
    return {
      mastered, learning, notStarted,
      totalReviews: this.logs.length, streak: this._streak(),
      dueDistribution: Object.entries(dist).sort().map(([date, count]) => ({ date, count })),
    };
  }

  exportData() {
    return JSON.stringify({ cards: this.cards, logs: this.logs, settings: this.cfg, v: 1 });
  }
  importData(text) {
    const d = JSON.parse(text);
    if (!d || typeof d.cards !== "object") throw new Error("bad backup");
    this.cards = d.cards; this.logs = d.logs || []; Object.assign(this.cfg, d.settings || {});
    this._persist();
  }
}

/* ServerEngine 没有 progress 端点差异：补一个透传。 */
ServerEngine.prototype.progress = function () { return this._get("api/progress"); };

const Engine = window.CAOSHU_STATIC ? new LocalEngine() : new ServerEngine();
