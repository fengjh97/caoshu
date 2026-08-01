/* 草書 · 入墨 —— UI 层。所有数据经 Engine（server / static 双模式）。 */

"use strict";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const STATIC_MODE = !!window.CAOSHU_STATIC;

const RATINGS = [
  { v: 1, label: "重来" }, { v: 2, label: "困难" },
  { v: 3, label: "良好" }, { v: 4, label: "简单" },
];

const store = { state: null, chars: null };

/* ================= 小工具 ================= */

function ripple(e) {
  const btn = e.currentTarget;
  const r = btn.getBoundingClientRect();
  const d = Math.max(r.width, r.height) * 2.2;
  const el = document.createElement("span");
  el.className = "ripple";
  el.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left}px;top:${e.clientY - r.top}px`;
  btn.appendChild(el);
  setTimeout(() => el.remove(), 600);
}

function countUp(el, to, ms = 700) {
  const t0 = performance.now();
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / ms);
    el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const CN_NUM = "〇一二三四五六七八九十";
function cnDate() {
  const d = new Date();
  const wd = "日一二三四五六"[d.getDay()];
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 週${wd}`;
}

function miSVG() {
  return `<svg class="mi" viewBox="0 0 100 100" preserveAspectRatio="none">
    <g stroke="#8b8172" stroke-width="0.55" stroke-dasharray="2.2 2.2" opacity="0.5">
      <line x1="50" y1="0" x2="50" y2="100"/><line x1="0" y1="50" x2="100" y2="50"/>
      <line x1="0" y1="0" x2="100" y2="100"/><line x1="100" y1="0" x2="0" y2="100"/>
    </g></svg>`;
}

/* ================= 手写板（墨韵版） =================
   真毛笔的物理感：起笔积墨、慢笔粗润、快笔飞白、
   收笔与驻笔处墨向纸面晕开（rAF 渐染）、疾书时甩出细小墨点。 */

const INK_RGB = "26, 23, 19";

class WritingPad {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.hasStrokes = false;
    this.last = null;
    this.lastWidth = 7;
    this.bleeds = [];   // 晕染点 {x, y, r0, r1, born}
    this.raf = null;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
    canvas.addEventListener("pointerdown", (e) => this.down(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    canvas.addEventListener("pointerup", (e) => this.up(e));
    canvas.addEventListener("pointercancel", (e) => this.up(e));
  }
  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp };
  }
  down(e) {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.last = this.pos(e);
    this.lastWidth = 7;
    this.hasStrokes = true;
    // 起笔积墨：实点 + 一圈缓慢晕开。
    this.dot(this.last.x, this.last.y, 3.2, 0.95);
    this.bleed(this.last.x, this.last.y, 4, 9);
  }
  move(e) {
    if (!this.last) return;
    e.preventDefault();
    const p = this.pos(e);
    const dist = Math.hypot(p.x - this.last.x, p.y - this.last.y);
    const v = dist / Math.max(1, p.t - this.last.t);
    const target = Math.max(2.2, Math.min(9.5, 9.5 - v * 5));
    const w = this.lastWidth * 0.72 + target * 0.28;
    const fast = v > 2.1;

    // 边缘晕染晕圈：先铺一层更宽的极淡墨。
    this.ctx.globalAlpha = 0.07;
    this.ctx.strokeStyle = `rgb(${INK_RGB})`;
    this.ctx.lineWidth = w * 2.1;
    this.seg(this.last, p);

    // 笔芯：快笔降透明度出飞白。
    this.ctx.globalAlpha = fast ? 0.55 : 0.92;
    this.ctx.lineWidth = w;
    this.seg(this.last, p);
    this.ctx.globalAlpha = 1;

    // 疾书甩墨：速度高时向笔势两侧甩出细小墨点。
    if (v > 2.6 && Math.random() < 0.5) {
      const ang = Math.atan2(p.y - this.last.y, p.x - this.last.x) + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2);
      const d = 5 + Math.random() * 13;
      this.dot(p.x + Math.cos(ang) * d, p.y + Math.sin(ang) * d, 0.6 + Math.random() * 1.3, 0.35 + Math.random() * 0.3);
    }
    // 驻笔积墨：几乎停住时墨继续洇。
    if (v < 0.12 && dist > 0) this.bleed(p.x, p.y, w * 0.5, w * 1.05);

    this.last = p;
    this.lastWidth = w;
  }
  up() {
    if (this.last) this.bleed(this.last.x, this.last.y, this.lastWidth * 0.45, this.lastWidth * 1.15);
    this.last = null;
  }
  seg(a, b) {
    this.ctx.beginPath();
    this.ctx.moveTo(a.x, a.y);
    this.ctx.lineTo(b.x, b.y);
    this.ctx.stroke();
  }
  dot(x, y, r, a) {
    this.ctx.globalAlpha = a;
    this.ctx.fillStyle = `rgb(${INK_RGB})`;
    this.ctx.beginPath();
    this.ctx.arc(x, y, r, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.globalAlpha = 1;
  }
  /* 墨晕：350ms 内从 r0 洇到 r1，每帧叠极淡圆，累积成柔和的浸润边。 */
  bleed(x, y, r0, r1) {
    this.bleeds.push({ x, y, r0, r1, born: performance.now() });
    if (!this.raf) this.raf = requestAnimationFrame(() => this.bleedTick());
  }
  bleedTick() {
    this.raf = null;
    const now = performance.now();
    for (let i = this.bleeds.length - 1; i >= 0; i--) {
      const b = this.bleeds[i];
      const p = (now - b.born) / 350;
      if (p >= 1) { this.bleeds.splice(i, 1); continue; }
      const r = b.r0 + (b.r1 - b.r0) * p;
      this.ctx.globalAlpha = 0.028 * (1 - p);
      this.ctx.fillStyle = `rgb(${INK_RGB})`;
      this.ctx.beginPath();
      this.ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.globalAlpha = 1;
    }
    if (this.bleeds.length) this.raf = requestAnimationFrame(() => this.bleedTick());
  }
  clear() {
    const r = this.canvas.getBoundingClientRect();
    this.ctx.clearRect(0, 0, r.width, r.height);
    this.bleeds.length = 0;
    this.hasStrokes = false;
  }
  exportPNG() {
    const out = document.createElement("canvas");
    out.width = 512; out.height = 512;
    const c = out.getContext("2d");
    c.fillStyle = "#fff";
    c.fillRect(0, 0, 512, 512);
    c.drawImage(this.canvas, 0, 0, 512, 512);
    return out.toDataURL("image/png");
  }
}

/* ================= 视图切换 ================= */

const VIEWS = ["today", "recognize", "decomp", "progress", "settings"];

function showView(name) {
  VIEWS.forEach((v) => {
    const el = $("#view-" + v);
    el.classList.toggle("hidden", v !== name);
    if (v === name) { el.style.animation = "none"; void el.offsetWidth; el.style.animation = ""; }
  });
  $$("#dock .dock-item").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  if (name === "today") refreshToday();
  if (name === "recognize") startQuiz();
  if (name === "decomp") initDecomp();
  if (name === "progress") renderProgress();
  if (name === "settings") renderSettings();
  history.replaceState(null, "", name === "today" ? "#" : "#" + name);
  window.scrollTo(0, 0);
}
$$("#dock .dock-item").forEach((t) => t.addEventListener("click", () => showView(t.dataset.view)));

/* ================= 今日 ================= */

const RING_LEN = 2 * Math.PI * 86;

async function refreshToday() {
  $("#home-date").textContent = cnDate();
  const s = await Engine.state();
  store.state = s;
  const remaining = s.queue.length;
  const done = s.doneToday || 0;
  const total = done + remaining;

  $("#chip-new").textContent = s.newCount;
  $("#chip-review").textContent = s.reviewCount;

  const chip = $("#home-streak");
  chip.classList.toggle("hidden", !s.streak);
  chip.textContent = `连 ${s.streak} 天`;

  const num = $("#ring-num");
  if (remaining === 0 && done > 0) {
    num.textContent = "畢";
    num.style.fontFamily = "var(--cursive)";
    $("#ring-sub").textContent = "今日已清";
  } else {
    num.style.fontFamily = "";
    countUp(num, remaining);
    $("#ring-sub").textContent = "今日待练";
  }
  const pct = total ? done / total : 0;
  requestAnimationFrame(() =>
    ($("#ring-fill").style.strokeDashoffset = RING_LEN * (1 - pct))
  );

  $("#btn-start").disabled = remaining === 0;
  const note = $("#home-note");
  if (STATIC_MODE) {
    note.innerHTML = "静态版 · 手写为自评模式 · 数据存于本机浏览器";
  } else {
    note.innerHTML = s.geminiConfigured
      ? "Gemini 判定已就绪"
      : `未配置判定 Key，盲写将自评 · <a href="#" id="goto-settings">去设置</a>`;
    const a = $("#goto-settings");
    if (a) a.addEventListener("click", (e) => { e.preventDefault(); showView("settings"); });
  }

  // 幽灵字：队列首字，让背景与今天要学的字暗合。
  if (s.queue.length) $("#ghost-glyph").textContent = s.queue[0].kai;
}

$("#btn-start").addEventListener("pointerdown", ripple);
$("#btn-start").addEventListener("click", () => {
  if (store.state && store.state.queue.length) startSession(store.state.queue);
});

/* ================= 练习会话（入墨） ================= */

const session = { queue: [], idx: 0, done: 0, pad: null, judge: null, snapshot: null };

function startSession(queue) {
  session.queue = queue.slice();
  session.idx = 0;
  session.done = 0;
  session.combo = 0;
  document.body.classList.add("night");
  const st = $("#study");
  st.classList.remove("hidden", "closing");
  renderCard();
}

function closeSession() {
  const st = $("#study");
  st.classList.add("closing");
  setTimeout(() => {
    st.classList.add("hidden");
    document.body.classList.remove("night");
    showView("today");
  }, 300);
}
$("#btn-exit-study").addEventListener("click", closeSession);

function stageHTML(html) {
  $("#study-stage").innerHTML = `<div class="stage-step">${html}</div>`;
}

function updateStudyBar() {
  const total = session.queue.length;
  $("#study-count").textContent = `${session.done}/${total}`;
  $("#study-line-fill").style.width = total ? `${(session.done / total) * 100}%` : "0";
}

function renderCard() {
  updateStudyBar();
  const card = session.queue[session.idx];
  session.judge = null;
  session.snapshot = null;
  if (!card) return renderDone();
  if (card.direction === "produce") renderProduce(card, card.isNew ? "trace" : "blind");
  else renderRecognize(card);
}

/* ---- 书写卡 ---- */

function renderProduce(card, phase) {
  const tracing = phase === "trace";
  stageHTML(`
    <div class="prompt">
      <div class="tag">書寫</div>
      <div class="k">${card.kai}</div>
      <div class="py">${card.pinyin}</div>
      <div class="phase-steps">
        <span class="${tracing ? "on" : ""}">一 · 描红</span>
        <span class="${tracing ? "" : "on"}">二 · 盲写</span>
      </div>
    </div>
    <div class="pad-wrap">
      ${miSVG()}
      ${tracing ? `<div class="trace-glyph" style="font-size:min(70vw,300px)">${card.kai}</div>` : ""}
      <canvas class="write-canvas"></canvas>
    </div>
    <div class="btn-row">
      <button id="p-clear" class="btn ghost">洗筆</button>
      <button id="p-next" class="btn">${tracing ? "描好了 · 盲写" : "落墨 · 判定"}</button>
    </div>
    ${tracing ? "" : `<p class="study-note">${
      STATIC_MODE ? "静态版：提交后对照范本自评" : "提交后由 Gemini 判字形结构"
    }</p>`}`);
  session.pad = new WritingPad($("#study-stage .write-canvas"));
  $("#p-clear").addEventListener("click", () => session.pad.clear());
  $("#p-next").addEventListener("click", () => {
    if (tracing) return renderProduce(card, "blind");
    if (!session.pad.hasStrokes) return;
    submitWriting(card);
  });
}

async function submitWriting(card) {
  session.snapshot = session.pad.exportPNG();
  stageHTML(`
    <div class="prompt"><div class="k">${card.kai}</div></div>
    <div class="judging"><div class="ink-drop"></div>墨迹入判…</div>`);
  let j;
  try { j = await Engine.judge(card.kai, session.snapshot); }
  catch { j = null; }
  session.judge = j || {
    mode: "selfAssess", score: 0, verdict: "fail", suggestedRating: 3,
    feedback: "判定服务不可用，对照范本自评。",
  };
  renderProduceResult(card);
}

function renderProduceResult(card) {
  const j = session.judge;
  const selfMode = j.mode === "selfAssess";
  stageHTML(`
    <div class="prompt"><div class="tag">${card.kai} · ${card.pinyin}</div></div>
    <div class="score-row">
      ${selfMode ? "" : `<div id="score-big" class="score-big">0</div>`}
      <div class="seal-stamp ${selfMode || j.verdict === "fail" ? "dim" : ""}">
        ${selfMode ? "自評" : j.verdict === "pass" ? "形似" : "再練"}
      </div>
    </div>
    <p class="feedback">${j.feedback}</p>
    <div class="compare">
      <div class="cell"><div class="box"><span class="g glyph-ink">${card.kai}</span></div><div class="cap">標準草書</div></div>
      <div class="cell"><div class="box"><img src="${session.snapshot}" alt="你写的"></div><div class="cap">你的墨迹</div></div>
    </div>
    <div class="rating-row">${ratingHTML(j.suggestedRating)}</div>`);
  if (!selfMode) countUp($("#score-big"), j.score, 800);
  // 盖章落定的瞬间：过 → 朱砂爆墨 + 脆响；不过 → 闷响。
  setTimeout(() => {
    const seal = $("#study-stage .seal-stamp");
    if (!seal) return;
    const r = seal.getBoundingClientRect();
    if (!selfMode && j.verdict === "pass") {
      FX.splatter(r.left + r.width / 2, r.top + r.height / 2, { n: 30, power: 8, cinnabar: true });
      FX.sound.pop();
      FX.buzz(12);
    } else if (!selfMode) {
      FX.sound.thud();
    }
  }, 300);
  bindRating(card);
}

/* ---- 认字卡 ---- */

async function renderRecognize(card) {
  const options = await Engine.options(card.kai);
  stageHTML(`
    <div class="prompt"><div class="tag">認字 · 划过正确的字，斩</div></div>
    <div class="cursive-hero glyph-ink">${card.kai}</div>
    <div class="option-grid">
      ${options.map((o, i) => `<button class="option-btn" style="--i:${i}" data-k="${o}">${o}</button>`).join("")}
    </div>`);
  wireOptions({
    root: $("#study-stage .stage-step"),
    buttons: $$("#study-stage .option-btn"),
    correctKai: card.kai,
    comboHost: session,
    onDone: (correct) =>
      setTimeout(() => renderRecognizeResult(card, correct), correct ? 620 : 950),
  });
}

/* 选项作答：点选或划斩皆可。斩对 → 劈开+溅墨+连斬；答错 → 震屏+闷响。 */
function wireOptions({ root, buttons, correctKai, comboHost, onDone }) {
  let resolved = false;
  const resolve = (btn, sliced) => {
    if (resolved || btn.disabled) return;
    resolved = true;
    const correct = btn.dataset.k === correctKai;
    const r = btn.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    buttons.forEach((b) => { b.disabled = true; if (b !== btn) b.classList.add("dim"); });
    if (correct) {
      comboHost.combo = (comboHost.combo || 0) + 1;
      if (sliced) FX.sliceElement(btn, true);
      else { btn.classList.add("correct"); FX.splatter(cx, cy, { n: 20, power: 6, cinnabar: true }); }
      FX.sound.pop();
      FX.buzz(12);
      if (comboHost.combo >= 2) FX.comboPop(cx, cy - 46, comboHost.combo);
    } else {
      comboHost.combo = 0;
      btn.classList.add("wrong");
      buttons.forEach((b) => { if (b.dataset.k === correctKai) { b.classList.remove("dim"); b.classList.add("correct"); } });
      FX.splatter(cx, cy, { n: 14, power: 4 });
      FX.sound.thud();
      FX.buzz([30, 40, 30]);
      root.classList.add("shake");
      setTimeout(() => root.classList.remove("shake"), 420);
    }
    onDone(correct);
  };
  buttons.forEach((btn) => btn.addEventListener("click", () => resolve(btn, false)));
  FX.slashable(root, ".option-btn", (btn) => resolve(btn, true));
}

function renderRecognizeResult(card, correct) {
  stageHTML(`
    <div class="prompt"><div class="tag">認字</div></div>
    <div class="score-row">
      <div class="seal-stamp ${correct ? "" : "dim"}">${correct ? "認對" : "認錯"}</div>
    </div>
    <p class="feedback">${correct ? "结构入眼即辨，好。" : `此字是「${card.kai}」（${card.pinyin}）`}</p>
    <div class="compare">
      <div class="cell"><div class="box"><span class="g">${card.kai}</span></div><div class="cap">草書</div></div>
      <div class="cell"><div class="box"><span class="gk">${card.kai}</span></div><div class="cap">楷書 · ${card.pinyin}</div></div>
    </div>
    <div class="rating-row">${ratingHTML(correct ? 3 : 1)}</div>`);
  bindRating(card);
}

/* ---- 评分 ---- */

function ratingHTML(suggested) {
  return RATINGS.map(
    (r, i) => `<button class="rating-btn ${r.v === suggested ? "suggested" : ""}" style="--i:${i}" data-r="${r.v}">${r.label}</button>`
  ).join("");
}

function bindRating(card) {
  $$("#study-stage .rating-btn").forEach((btn) =>
    btn.addEventListener("click", async () => {
      $$("#study-stage .rating-btn").forEach((b) => (b.disabled = true));
      const s = await Engine.grade(card.id, Number(btn.dataset.r));
      store.state = { ...store.state, ...s };
      session.done += 1;
      session.idx += 1;
      renderCard();
    })
  );
}

function renderDone() {
  updateStudyBar();
  stageHTML(`
    <div class="done-screen">
      <div class="big glyph-ink">畢</div>
      <p>今日 ${session.done} 张卡 · 已入册</p>
      <span class="seal-stamp">連 ${store.state ? store.state.streak : 0} 天</span>
      <div><button id="btn-back" class="btn" style="max-width:280px;margin:0 auto">出墨 · 回到今日</button></div>
    </div>`);
  $("#btn-back").addEventListener("click", closeSession);
}

/* ================= 认字自由练 ================= */

const quiz = { right: 0, total: 0 };

async function loadChars() {
  if (!store.chars) store.chars = await Engine.chars();
  return store.chars;
}

async function startQuiz() {
  const chars = await loadChars();
  let pool = chars.filter((c) => c.started);
  if (pool.length < 4) pool = chars.filter((c) => c.core).slice(0, 60);
  const target = pool[Math.floor(Math.random() * pool.length)];
  const options = await Engine.options(target.kai);
  $("#quiz-body").innerHTML = `
    <div class="quiz-round">
      <div class="card" style="background:var(--paper-hi)">
        <div class="cursive-hero glyph-ink" style="color:var(--ink)">${target.kai}</div>
      </div>
      <div class="option-grid">
        ${options.map((o, i) =>
          `<button class="option-btn paper-opt" style="--i:${i}" data-k="${o}">${o}</button>`
        ).join("")}
      </div>
    </div>`;
  wireOptions({
    root: $("#quiz-body .quiz-round"),
    buttons: $$("#quiz-body .option-btn"),
    correctKai: target.kai,
    comboHost: quiz,
    onDone: (correct) => {
      quiz.total += 1;
      if (correct) quiz.right += 1;
      const tally = $("#quiz-tally");
      tally.classList.remove("hidden");
      tally.textContent = `${quiz.right} / ${quiz.total}${quiz.combo >= 2 ? ` · 連斬 ×${quiz.combo}` : ""}`;
      setTimeout(startQuiz, correct ? 700 : 1400);
    },
  });
}

/* ================= 拆解 ================= */

let decompInited = false;
let decompFilter = "core";

async function initDecomp() {
  if (decompInited) return;
  decompInited = true;
  const chars = await loadChars();
  $("#lib-count").textContent = `${chars.length} 字 · 学 ${chars.filter((c) => c.core).length}`;
  const rerender = () => {
    const q = $("#decomp-search").value.trim().toLowerCase();
    let list = decompFilter === "core" ? chars.filter((c) => c.core) : chars;
    if (q) list = list.filter((c) => c.kai.includes(q) || (c.pinyin || "").toLowerCase().includes(q));
    renderGrid(list);
  };
  $("#decomp-search").addEventListener("input", rerender);
  $$(".filter-pill").forEach((p) =>
    p.addEventListener("click", () => {
      decompFilter = p.dataset.filter;
      $$(".filter-pill").forEach((x) => x.classList.toggle("active", x === p));
      rerender();
    })
  );
  rerender();
}

function renderGrid(list) {
  $("#char-grid").innerHTML = list.slice(0, 240)
    .map((c, i) =>
      `<div class="char-cell ${c.core ? "" : "no-core"}" style="--i:${i}" data-k="${c.kai}">${c.kai}${c.started ? '<span class="dot"></span>' : ""}</div>`
    ).join("");
  $$(".char-cell").forEach((cell) =>
    cell.addEventListener("click", () => openDecomp(cell.dataset.k))
  );
}

async function openDecomp(kai) {
  const d = await Engine.decomposition(kai);
  if (!d || d.error) return;
  const chars = await loadChars();
  const meta = chars.find((c) => c.kai === kai) || {};
  $("#decomp-index").classList.add("hidden");
  const el = $("#decomp-detail");
  el.classList.remove("hidden");
  el.innerHTML = `
    <button class="back-link" id="d-back">← 字表</button>
    <div class="decomp-hero">
      <span class="glyph glyph-ink">${d.kai}</span>
      <div class="meta">
        <div class="k">${d.kai}</div>
        <div class="py">${d.pinyin}</div>
        <div class="rank">字频第 ${meta.freqRank || "—"} 位${meta.core ? " · 学习字表" : ""}</div>
      </div>
    </div>
    ${d.missing
      ? `<div class="card"><p class="empty-note">此字暂无拆解详解（前五百高频字有完整内容），真迹仍可参照。</p></div>`
      : `
    <div class="card reveal" style="--i:0">
      <div class="sec-label">草書符號構成</div>
      ${(d.symbols || []).map((s) =>
        `<div class="sym-item"><span class="comp">${s.component}</span>
         <div class="desc">${s.cursive}<br><span class="note">${s.note || ""}</span></div></div>`
      ).join("")}
    </div>
    <div class="card reveal" style="--i:1">
      <div class="sec-label">楷 → 草 演變</div>
      <p class="evo-text">${d.evolution}</p>
    </div>
    ${d.confusable && d.confusable.length
      ? `<div class="card reveal" style="--i:2"><div class="sec-label">易混字</div>
         <div class="conf-row">${d.confusable.map((c) => `<span class="conf-chip" data-k="${c}">${c}</span>`).join("")}</div></div>`
      : ""}`}
    <div class="card reveal" style="--i:3">
      <div class="sec-label">歷代真跡</div>
      <div class="gallery" id="gallery"><span class="empty-note">墨迹搜寻中…</span></div>
    </div>`;
  $("#d-back").addEventListener("click", () => {
    el.classList.add("hidden");
    $("#decomp-index").classList.remove("hidden");
  });
  el.querySelectorAll(".conf-chip").forEach((chip) =>
    chip.addEventListener("click", () => openDecomp(chip.dataset.k))
  );
  window.scrollTo(0, 0);
  let urls = [];
  try { urls = await Engine.calligraphy(kai); } catch {}
  const g = $("#gallery");
  if (g) g.innerHTML = urls.length
    ? urls.map((u, i) => `<img src="${u}" style="--i:${i}" loading="lazy" referrerpolicy="no-referrer" alt="真迹">`).join("")
    : `<span class="empty-note">暂无真迹（离线或来源站不可用）</span>`;
}

/* ================= 进度 ================= */

async function renderProgress() {
  const p = await Engine.progress();
  const now = new Date();
  const localFmt = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todayStr = localFmt(now);
  let overdue = 0;
  const byDay = {};
  (p.dueDistribution || []).forEach((e) => {
    if (e.date < todayStr) overdue += e.count;
    else byDay[e.date] = (byDay[e.date] || 0) + e.count;
  });
  const days = [];
  for (let i = 0; i < 13; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    days.push({ label: i === 0 ? "今" : String(d.getDate()), count: byDay[localFmt(d)] || 0 });
  }
  const max = Math.max(overdue, ...days.map((d) => d.count), 1);
  const bar = (count, label, od, i) => `
    <div class="bar-col">
      ${count ? `<div class="bar-num">${count}</div>` : ""}
      <div class="bar ${od ? "overdue" : ""}" style="--i:${i};height:${(count / max) * 100}%"></div>
      <div class="bar-cap">${label}</div>
    </div>`;
  $("#progress-body").innerHTML = `
    <div class="tiles">
      <div class="card tile reveal" style="--i:0"><div class="n" id="t-m">0</div><div class="t">已掌握</div></div>
      <div class="card tile reveal" style="--i:1"><div class="n" id="t-l">0</div><div class="t">学习中</div></div>
      <div class="card tile reveal" style="--i:2"><div class="n" id="t-n">0</div><div class="t">未学</div></div>
    </div>
    <div class="card reveal" style="--i:2">
      <div class="sec-label">到期分布 · 十四日</div>
      <div class="bars">
        ${bar(overdue, "逾期", true, 0)}
        ${days.map((d, i) => bar(d.count, d.label, false, i + 1)).join("")}
      </div>
    </div>
    <div class="card reveal" style="--i:3">
      <div class="sec-label">積累</div>
      <p class="evo-text">累计复习 ${p.totalReviews} 次 · 连续 ${p.streak} 天</p>
    </div>`;
  countUp($("#t-m"), p.mastered);
  countUp($("#t-l"), p.learning);
  countUp($("#t-n"), p.notStarted);
}

/* ================= 设置 ================= */

async function renderSettings() {
  const s = await Engine.settings();
  $("#settings-body").innerHTML = `
    <div class="card reveal" style="--i:0">
      <div class="sec-label">學習</div>
      <div class="set-row">
        <span>每日新卡上限</span>
        <span class="stepper">
          <button class="stepper-btn" id="lim-m">−</button>
          <span class="stepper-val" id="lim-v">${s.dailyNewLimit}</span>
          <button class="stepper-btn" id="lim-p">＋</button>
        </span>
      </div>
      <div class="set-row">
        <span>斩字音效</span>
        <button class="toggle ${localStorage.getItem("caoshu.sound") !== "off" ? "on" : ""}" id="snd-toggle" aria-label="音效开关"><span class="knob"></span></button>
      </div>
    </div>
    ${STATIC_MODE ? `
    <div class="card reveal" style="--i:1">
      <div class="sec-label">數據</div>
      <p class="fine-print">静态版数据存于本机浏览器。换设备或清缓存前请导出备份。</p>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn ghost" id="btn-export">导出备份</button>
        <button class="btn ghost" id="btn-import">导入备份</button>
      </div>
      <input type="file" id="import-file" accept=".json" style="display:none">
    </div>` : `
    <div class="card reveal" style="--i:1">
      <div class="sec-label">Gemini 判定</div>
      <div class="set-row"><span>状态</span>
        <span class="status-txt ${s.geminiConfigured ? "ok" : ""}">${s.geminiConfigured ? "已配置 ✓" : "未配置"}</span></div>
      <input id="key-in" class="field" type="password" placeholder="粘贴 Gemini API Key" autocomplete="off">
      <div class="btn-row">
        <button class="btn" id="key-save">保存</button>
        <button class="btn ghost" id="key-clear">清除</button>
      </div>
      <p class="fine-print">Key 只存于你的 Mac（data/config.json），不进浏览器与仓库。</p>
    </div>`}
    <div class="card reveal" style="--i:2">
      <div class="sec-label">關於</div>
      <p class="fine-print">草書 · 入墨 —— 草书版多邻国 + Anki<br>
      三千字库 · 一千常用学习集 · FSRS 间隔重复<br>
      字体 钟齐流江毛草（OFL）· 真迹 书法字典<br>
      ${STATIC_MODE ? "静态版（GitHub Pages）· 手写自评" : "完整版（Mac 本地服务）· Gemini 判定"}</p>
    </div>`;
  $("#lim-m").addEventListener("click", () => bumpLimit(-1));
  $("#lim-p").addEventListener("click", () => bumpLimit(1));
  $("#snd-toggle").addEventListener("click", () => {
    const off = localStorage.getItem("caoshu.sound") === "off";
    localStorage.setItem("caoshu.sound", off ? "on" : "off");
    $("#snd-toggle").classList.toggle("on", off);
    if (off) FX.sound.pop();
  });
  if (STATIC_MODE) {
    $("#btn-export").addEventListener("click", () => {
      const blob = new Blob([Engine.exportData()], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `caoshu-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
    $("#btn-import").addEventListener("click", () => $("#import-file").click());
    $("#import-file").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        Engine.importData(await f.text());
        alert("导入成功");
        renderSettings();
      } catch { alert("备份文件无法解析"); }
    });
  } else {
    $("#key-save").addEventListener("click", async () => {
      const k = $("#key-in").value.trim();
      if (!k) return;
      await Engine.saveSettings({ geminiKey: k });
      renderSettings();
    });
    $("#key-clear").addEventListener("click", async () => {
      await Engine.saveSettings({ geminiKey: "" });
      renderSettings();
    });
  }
}

async function bumpLimit(d) {
  const cur = Number($("#lim-v").textContent);
  const s = await Engine.saveSettings({ dailyNewLimit: cur + d });
  $("#lim-v").textContent = s.dailyNewLimit;
}

/* ================= 启动 ================= */

(async () => {
  await Engine.init();
  const h = location.hash.slice(1);
  if (VIEWS.includes(h) && h !== "today") showView(h);
  else refreshToday();
})();
