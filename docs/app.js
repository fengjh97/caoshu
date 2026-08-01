/* 草书 Web —— 前端单页逻辑（无框架）。
   视图：今日 / 练习会话 / 认字自由练 / 拆解 / 进度 / 设置。 */

"use strict";

const $ = (sel) => document.querySelector(sel);
const api = {
  get: (p) => fetch(p).then((r) => r.json()),
  post: (p, body) =>
    fetch(p, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json()),
};

const RATings = [
  { v: 1, label: "重来", sub: "<1分钟" },
  { v: 2, label: "困难", sub: "" },
  { v: 3, label: "良好", sub: "" },
  { v: 4, label: "简单", sub: "" },
];

const store = {
  state: null, // /api/state 载荷
  chars: null, // /api/chars 缓存
};

/* ================= 视图切换 ================= */

const VIEWS = ["today", "study", "recognize", "decomp", "progress", "settings"];

function showView(name) {
  VIEWS.forEach((v) => $("#view-" + v).classList.toggle("hidden", v !== name));
  document.querySelectorAll("#tabbar .tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.view === name)
  );
  $("#tabbar").classList.toggle("hidden", name === "study");
  if (name === "today") refreshToday();
  if (name === "progress") renderProgress();
  if (name === "recognize") startQuiz();
  if (name === "decomp") initDecomp();
  if (name === "settings") renderSettings();
  window.scrollTo(0, 0);
}

document.querySelectorAll("#tabbar .tab").forEach((t) =>
  t.addEventListener("click", () => showView(t.dataset.view))
);

/* ================= 今日 ================= */

async function refreshToday() {
  const s = await api.get("/api/state");
  store.state = s;
  $("#stat-new").textContent = s.newCount;
  $("#stat-review").textContent = s.reviewCount;
  const badge = $("#streak-badge");
  badge.classList.toggle("hidden", s.streak === 0);
  badge.textContent = `连 ${s.streak} 天`;
  const total = s.queue.length;
  $("#today-hint").textContent = total
    ? `今日共 ${total} 张卡（复习 ${s.reviewCount} · 新学 ${s.newCount}）`
    : "今日已清空，明天见。";
  $("#btn-start").disabled = total === 0;
  $("#gemini-hint").classList.toggle("hidden", s.geminiConfigured);
}

$("#btn-start").addEventListener("click", () => {
  if (store.state && store.state.queue.length) startSession(store.state.queue);
});
$("#gemini-hint").addEventListener("click", () => showView("settings"));

/* ================= 米字格 + 手写画布 ================= */

function miGridSVG() {
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none">
    <g stroke="#9e968a" stroke-width="0.6" stroke-dasharray="2.4 2" opacity="0.55">
      <line x1="50" y1="0" x2="50" y2="100"/><line x1="0" y1="50" x2="100" y2="50"/>
      <line x1="0" y1="0" x2="100" y2="100"/><line x1="100" y1="0" x2="0" y2="100"/>
    </g></svg>`;
}

/** 手写画布：pointer events，笔速映射笔宽求毛笔感。 */
class WritingPad {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.hasStrokes = false;
    this.last = null;
    this.lastWidth = 0;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
    this.ctx.strokeStyle = "#211f1c";

    canvas.addEventListener("pointerdown", (e) => this.down(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    canvas.addEventListener("pointerup", () => (this.last = null));
    canvas.addEventListener("pointercancel", () => (this.last = null));
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
    // 起笔一个点。
    this.ctx.beginPath();
    this.ctx.arc(this.last.x, this.last.y, 3, 0, Math.PI * 2);
    this.ctx.fillStyle = "#211f1c";
    this.ctx.fill();
  }
  move(e) {
    if (!this.last) return;
    e.preventDefault();
    const p = this.pos(e);
    const dx = p.x - this.last.x, dy = p.y - this.last.y;
    const dt = Math.max(1, p.t - this.last.t);
    const v = Math.hypot(dx, dy) / dt; // px/ms
    // 快笔细、慢笔粗，平滑过渡。
    const target = Math.max(2.2, Math.min(9, 9 - v * 5));
    const w = this.lastWidth * 0.7 + target * 0.3;
    this.ctx.lineWidth = w;
    this.ctx.beginPath();
    this.ctx.moveTo(this.last.x, this.last.y);
    this.ctx.lineTo(p.x, p.y);
    this.ctx.stroke();
    this.last = p;
    this.lastWidth = w;
  }
  clear() {
    const r = this.canvas.getBoundingClientRect();
    this.ctx.clearRect(0, 0, r.width, r.height);
    this.hasStrokes = false;
  }
  /** 导出：白底 PNG，缩到 512 便于上传。 */
  exportPNG() {
    const out = document.createElement("canvas");
    out.width = 512;
    out.height = 512;
    const c = out.getContext("2d");
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, 512, 512);
    c.drawImage(this.canvas, 0, 0, 512, 512);
    return out.toDataURL("image/png");
  }
  snapshotURL() {
    return this.exportPNG();
  }
}

function gridWrapHTML(traceKai) {
  const glyph = traceKai
    ? `<div class="trace-glyph" style="font-size: min(64vw, 300px)">${traceKai}</div>`
    : "";
  return `<div class="grid-wrap">
    <div class="mi-grid">${miGridSVG()}${glyph}</div>
    <canvas class="write-canvas"></canvas>
  </div>`;
}

/* ================= 练习会话 ================= */

const session = {
  queue: [], idx: 0, done: 0,
  pad: null, lastJudge: null, lastSnapshot: null,
};

function startSession(queue) {
  session.queue = queue.slice();
  session.idx = 0;
  session.done = 0;
  showView("study");
  renderCurrentCard();
}

$("#btn-exit-study").addEventListener("click", () => showView("today"));

function updateStudyProgress() {
  const total = session.queue.length;
  $("#study-count").textContent = `${session.done}/${total}`;
  $("#study-progress-fill").style.width = total ? `${(session.done / total) * 100}%` : "0";
}

function renderCurrentCard() {
  updateStudyProgress();
  const card = session.queue[session.idx];
  if (!card) return renderSessionDone();
  session.lastJudge = null;
  session.lastSnapshot = null;
  if (card.direction === "produce") renderProducePhase(card, card.isNew ? "tracing" : "blind");
  else renderRecognizeCard(card);
}

/* ---- 楷→草 书写卡 ---- */

function renderProducePhase(card, phase) {
  const tracing = phase === "tracing";
  $("#study-body").innerHTML = `
    <div class="card-prompt">
      <div class="direction-tag">书写 · 楷→草</div>
      <div class="target-kai">${card.kai}</div>
      <div class="target-pinyin">${card.pinyin}</div>
      <span class="phase-tag">${tracing ? "① 描红 — 沿浅色范本走一遍" : "② 盲写 — 凭记忆写出草书"}</span>
    </div>
    ${gridWrapHTML(tracing ? card.kai : null)}
    <div class="btn-row">
      <button id="btn-clear" class="ink-btn small outline">清除</button>
      <button id="btn-phase-next" class="ink-btn small">${tracing ? "写好了，盲写" : "提交判定"}</button>
    </div>
    ${tracing ? "" : `<p class="faint-note">提交后由 Gemini 判定字形结构是否像标准草书。</p>`}
  `;
  session.pad = new WritingPad($("#study-body .write-canvas"));
  $("#btn-clear").addEventListener("click", () => session.pad.clear());
  $("#btn-phase-next").addEventListener("click", () => {
    if (tracing) {
      renderProducePhase(card, "blind");
    } else {
      if (!session.pad.hasStrokes) return;
      submitWriting(card);
    }
  });
}

async function submitWriting(card) {
  const img = session.pad.exportPNG();
  session.lastSnapshot = img;
  $("#study-body").innerHTML = `
    <div class="card-prompt"><div class="target-kai">${card.kai}</div></div>
    <div class="judging-overlay"><div class="brush-spinner"></div>判定中…</div>`;
  const res = await api.post("/api/judge", { kai: card.kai, image: img }).catch(() => null);
  session.lastJudge = res || { mode: "selfAssess", score: 0, verdict: "fail",
    feedback: "判定服务不可用，请对照范本自评。", suggestedRating: 3 };
  renderProduceResult(card);
}

function renderProduceResult(card) {
  const j = session.lastJudge;
  const selfMode = j.mode === "selfAssess";
  const scoreHTML = selfMode
    ? `<div class="result-score"><span class="verdict-seal">自评</span></div>`
    : `<div class="result-score"><span class="num">${j.score}</span><span class="verdict-seal ${j.verdict === "fail" ? "fail" : ""}">${j.verdict === "pass" ? "形似" : "再练"}</span></div>`;
  $("#study-body").innerHTML = `
    <div class="card-prompt">
      <div class="direction-tag">书写 · ${card.kai} ${card.pinyin}</div>
    </div>
    ${scoreHTML}
    <p class="result-feedback">${j.feedback}</p>
    <div class="compare-row">
      <div class="compare-cell"><div class="box"><span class="glyph">${card.kai}</span></div><div class="cap">标准草书范本</div></div>
      <div class="compare-cell"><div class="box"><img src="${session.lastSnapshot}" alt="你写的"></div><div class="cap">你写的</div></div>
    </div>
    <div class="rating-row">${ratingButtonsHTML(j.suggestedRating)}</div>`;
  bindRatingButtons(card);
}

/* ---- 草→楷 认字卡 ---- */

async function renderRecognizeCard(card) {
  const options = await api.get("/api/options/" + encodeURIComponent(card.kai));
  $("#study-body").innerHTML = `
    <div class="card-prompt">
      <div class="direction-tag">认字 · 草→楷</div>
    </div>
    <div class="ink-card"><div class="cursive-display">${card.kai}</div></div>
    <div class="option-grid">
      ${options.map((o) => `<button class="option-btn" data-kai="${o}">${o}</button>`).join("")}
    </div>`;
  document.querySelectorAll("#study-body .option-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      const chosen = btn.dataset.kai;
      const correct = chosen === card.kai;
      document.querySelectorAll("#study-body .option-btn").forEach((b) => {
        b.disabled = true;
        if (b.dataset.kai === card.kai) b.classList.add("correct");
        else if (b === btn) b.classList.add("wrong");
      });
      setTimeout(() => renderRecognizeResult(card, correct), 550);
    })
  );
}

function renderRecognizeResult(card, correct) {
  const suggested = correct ? 3 : 1;
  $("#study-body").innerHTML = `
    <div class="card-prompt"><div class="direction-tag">认字 · 草→楷</div></div>
    <div class="result-score">
      <span class="verdict-seal ${correct ? "" : "fail"}">${correct ? "认对" : "认错"}</span>
    </div>
    <p class="result-feedback">${correct ? "正确！" : `正确答案是「${card.kai}」（${card.pinyin}）`}</p>
    <div class="compare-row">
      <div class="compare-cell"><div class="box"><span class="glyph">${card.kai}</span></div><div class="cap">草书</div></div>
      <div class="compare-cell"><div class="box"><span class="glyph" style="font-family: var(--kaiti); font-size: 72px">${card.kai}</span></div><div class="cap">楷书 · ${card.pinyin}</div></div>
    </div>
    <div class="rating-row">${ratingButtonsHTML(suggested)}</div>`;
  bindRatingButtons(card);
}

/* ---- 评分与前进 ---- */

function ratingButtonsHTML(suggested) {
  return RATings.map(
    (r) =>
      `<button class="rating-btn ${r.v === suggested ? "suggested" : ""}" data-rating="${r.v}">${r.label}</button>`
  ).join("");
}

function bindRatingButtons(card) {
  document.querySelectorAll("#study-body .rating-btn").forEach((btn) =>
    btn.addEventListener("click", async () => {
      document.querySelectorAll("#study-body .rating-btn").forEach((b) => (b.disabled = true));
      const s = await api.post("/api/grade", { card_id: card.id, rating: Number(btn.dataset.rating) });
      store.state = { ...store.state, ...s };
      session.done += 1;
      session.idx += 1;
      renderCurrentCard();
    })
  );
}

function renderSessionDone() {
  updateStudyProgress();
  $("#study-body").innerHTML = `
    <div class="done-screen">
      <div class="big">畢</div>
      <p>今日 ${session.done} 张卡已完成</p>
      <span class="seal-badge">连 ${store.state ? store.state.streak : 0} 天</span>
      <div style="height:28px"></div>
      <button id="btn-back-today" class="ink-btn">回到今日</button>
    </div>`;
  $("#btn-back-today").addEventListener("click", () => showView("today"));
}

/* ================= 认字自由练习 ================= */

const quiz = { right: 0, total: 0 };

async function loadChars() {
  if (!store.chars) store.chars = await api.get("/api/chars");
  return store.chars;
}

async function startQuiz() {
  const chars = await loadChars();
  let pool = chars.filter((c) => c.started);
  if (pool.length < 4) pool = chars.slice(0, 50); // 还没学几个字时用前 50 高频字
  const target = pool[Math.floor(Math.random() * pool.length)];
  const options = await api.get("/api/options/" + encodeURIComponent(target.kai));
  $("#quiz-body").innerHTML = `
    <div class="ink-card"><div class="cursive-display">${target.kai}</div></div>
    <div class="option-grid">
      ${options.map((o) => `<button class="option-btn" data-kai="${o}">${o}</button>`).join("")}
    </div>`;
  document.querySelectorAll("#quiz-body .option-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      const correct = btn.dataset.kai === target.kai;
      quiz.total += 1;
      if (correct) quiz.right += 1;
      const tally = $("#quiz-tally");
      tally.classList.remove("hidden");
      tally.textContent = `${quiz.right} / ${quiz.total}`;
      document.querySelectorAll("#quiz-body .option-btn").forEach((b) => {
        b.disabled = true;
        if (b.dataset.kai === target.kai) b.classList.add("correct");
        else if (b === btn) b.classList.add("wrong");
      });
      setTimeout(startQuiz, correct ? 650 : 1400);
    })
  );
}

/* ================= 拆解 ================= */

let decompInited = false;

async function initDecomp() {
  if (decompInited) return;
  decompInited = true;
  const chars = await loadChars();
  renderCharGrid(chars);
  $("#decomp-search").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    renderCharGrid(
      q
        ? chars.filter((c) => c.kai.includes(q) || c.pinyin.toLowerCase().includes(q))
        : chars
    );
  });
}

function renderCharGrid(list) {
  $("#char-grid").innerHTML = list
    .slice(0, 200)
    .map(
      (c) =>
        `<div class="char-cell" data-kai="${c.kai}">${c.kai}${c.started ? '<span class="dot"></span>' : ""}</div>`
    )
    .join("");
  document.querySelectorAll(".char-cell").forEach((cell) =>
    cell.addEventListener("click", () => openDecomp(cell.dataset.kai))
  );
}

async function openDecomp(kai) {
  const d = await api.get("/api/decomposition/" + encodeURIComponent(kai));
  if (d.error) return;
  $("#decomp-index").classList.add("hidden");
  const detail = $("#decomp-detail");
  detail.classList.remove("hidden");
  detail.innerHTML = `
    <button class="back-link" id="btn-decomp-back">← 返回字表</button>
    <div class="decomp-head">
      <span class="glyph">${d.kai}</span>
      <div class="meta"><div class="kai">${d.kai}</div><div class="py">${d.pinyin}</div></div>
    </div>
    <div class="ink-card">
      <div class="section-label">草书符号构成</div>
      ${d.symbols
        .map(
          (s) => `<div class="symbol-item"><span class="comp">${s.component}</span>
            <div class="desc">${s.cursive}<br><span class="note">${s.note || ""}</span></div></div>`
        )
        .join("")}
    </div>
    <div class="ink-card">
      <div class="section-label">楷→草演变</div>
      <p class="evolution-text">${d.evolution}</p>
    </div>
    ${
      d.confusable && d.confusable.length
        ? `<div class="ink-card"><div class="section-label">易混字</div>
           <div class="confusable-row">${d.confusable
             .map((c) => `<span class="confusable-chip" data-kai="${c}">${c}</span>`)
             .join("")}</div></div>`
        : ""
    }
    <div class="ink-card">
      <div class="section-label">历代真迹</div>
      <div class="gallery" id="gallery"><span class="faint-note">拉取中…</span></div>
    </div>`;
  $("#btn-decomp-back").addEventListener("click", () => {
    detail.classList.add("hidden");
    $("#decomp-index").classList.remove("hidden");
  });
  detail.querySelectorAll(".confusable-chip").forEach((chip) =>
    chip.addEventListener("click", () => {
      // 易混字不一定在 500 字表内，点了没有就不跳。
      openDecomp(chip.dataset.kai);
    })
  );
  const urls = await api.get("/api/calligraphy/" + encodeURIComponent(kai)).catch(() => []);
  $("#gallery").innerHTML = urls.length
    ? urls.map((u) => `<img src="${u}" loading="lazy" alt="真迹">`).join("")
    : `<span class="faint-note">暂无真迹（离线或来源站不可用）</span>`;
  window.scrollTo(0, 0);
}

/* ================= 进度 ================= */

async function renderProgress() {
  const p = await api.get("/api/progress");
  const today = new Date();
  const fmt = (d) => d.toISOString().slice(0, 10);
  // 逾期合并为首柱，其后今天起 13 天。
  const localFmt = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todayStr = localFmt(today);
  let overdue = 0;
  const byDay = {};
  p.dueDistribution.forEach((e) => {
    if (e.date < todayStr) overdue += e.count;
    else byDay[e.date] = (byDay[e.date] || 0) + e.count;
  });
  const days = [];
  for (let i = 0; i < 13; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const key = localFmt(d);
    days.push({ key, label: i === 0 ? "今" : String(d.getDate()), count: byDay[key] || 0 });
  }
  const max = Math.max(overdue, ...days.map((d) => d.count), 1);
  const bar = (count, label, overdueBar) => `
    <div class="bar-col">
      ${count ? `<div class="bar-num">${count}</div>` : ""}
      <div class="bar ${overdueBar ? "overdue" : ""}" style="height:${(count / max) * 100}%"></div>
      <div class="bar-cap">${label}</div>
    </div>`;
  $("#progress-body").innerHTML = `
    <div class="progress-tiles">
      <div class="ink-card stat-tile"><div class="stat-num">${p.mastered}</div><div class="stat-label">已掌握</div></div>
      <div class="ink-card stat-tile"><div class="stat-num">${p.learning}</div><div class="stat-label">学习中</div></div>
      <div class="ink-card stat-tile"><div class="stat-num">${p.notStarted}</div><div class="stat-label">未学</div></div>
    </div>
    <div class="ink-card chart-card">
      <div class="section-label">到期分布（14 天）</div>
      <div class="bars">
        ${bar(overdue, "逾期", true)}
        ${days.map((d) => bar(d.count, d.label, false)).join("")}
      </div>
    </div>
    <div class="ink-card">
      <div class="section-label">累计</div>
      <p class="about-text">总复习 ${p.totalReviews} 次 · 连续 ${p.streak} 天</p>
    </div>`;
}

/* ================= 设置 ================= */

async function renderSettings() {
  const s = await api.get("/api/settings");
  $("#limit-value").textContent = s.dailyNewLimit;
  setKeyStatus(s.geminiConfigured);
}

function setKeyStatus(ok) {
  const el = $("#key-status");
  el.textContent = ok ? "已配置 ✓" : "未配置";
  el.classList.toggle("ok", ok);
}

async function bumpLimit(delta) {
  const cur = Number($("#limit-value").textContent);
  const s = await api.post("/api/settings", { dailyNewLimit: cur + delta });
  $("#limit-value").textContent = s.dailyNewLimit;
}
$("#limit-minus").addEventListener("click", () => bumpLimit(-1));
$("#limit-plus").addEventListener("click", () => bumpLimit(1));

$("#btn-save-key").addEventListener("click", async () => {
  const key = $("#key-input").value.trim();
  if (!key) return;
  const s = await api.post("/api/settings", { geminiKey: key });
  $("#key-input").value = "";
  setKeyStatus(s.geminiConfigured);
});
$("#btn-clear-key").addEventListener("click", async () => {
  const s = await api.post("/api/settings", { geminiKey: "" });
  setKeyStatus(s.geminiConfigured);
});

/* ================= 启动 ================= */

refreshToday();
