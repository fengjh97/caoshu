/* 學書 —— UI 層。所有數據經 Engine（server / static 雙模式）。
   核心流：每日一句（自寫短句 / 唐詩選句）→ 逐字入課：生字現學、熟字重寫，
   加上 FSRS 到期複習。草書字形一律用簡體碼位（字體子集），楷書文字顯示繁體。 */

"use strict";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const STATIC_MODE = !!window.CAOSHU_STATIC;

const RATINGS = [
  { v: 1, label: "重來" }, { v: 2, label: "困難" },
  { v: 3, label: "良好" }, { v: 4, label: "簡單" },
];

const LS_DAILY = "caoshu.daily.v1";

const store = {
  state: null,
  chars: null,      // 字庫數組
  byKai: null,      // 簡體 → 條目
  byTC: null,       // 繁體 → 條目
  poems: null,      // 唐詩三百首（懶加載）
  daily: null,      // 今日文句 {date, text, src, chars:[{k,tc,st}], done:[]}
};

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

function cnDate() {
  const d = new Date();
  const wd = "日一二三四五六"[d.getDay()];
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 週${wd}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function miSVG() {
  return `<svg class="mi" viewBox="0 0 100 100" preserveAspectRatio="none">
    <g stroke="#8b8172" stroke-width="0.55" stroke-dasharray="2.2 2.2" opacity="0.5">
      <line x1="50" y1="0" x2="50" y2="100"/><line x1="0" y1="50" x2="100" y2="50"/>
      <line x1="0" y1="0" x2="100" y2="100"/><line x1="100" y1="0" x2="0" y2="100"/>
    </g></svg>`;
}

const HAN_RE = /[一-鿿]/;

async function loadChars() {
  if (!store.chars) {
    store.chars = await Engine.chars();
    store.byKai = new Map(store.chars.map((c) => [c.kai, c]));
    store.byTC = new Map();
    store.bySC = new Map();
    store.chars.forEach((c) => {
      if (c.tc && !store.byTC.has(c.tc)) store.byTC.set(c.tc, c);
      if (c.sc && !store.bySC.has(c.sc)) store.bySC.set(c.sc, c);
    });
  }
  return store.chars;
}

/* 任意漢字（繁或簡）→ 字庫條目；查不到 = 暫缺。 */
function mapChar(ch) {
  return store.byKai.get(ch) || store.byTC.get(ch) || store.bySC.get(ch) || null;
}

function tcOf(kai) {
  const c = store.byKai.get(kai);
  return (c && c.tc) || kai;
}

/* ================= 今日文句 ================= */

function loadDaily() {
  try {
    const d = JSON.parse(localStorage.getItem(LS_DAILY));
    store.daily = d && d.date === todayStr() ? d : null;
  } catch { store.daily = null; }
  return store.daily;
}

function saveDaily() {
  if (store.daily) localStorage.setItem(LS_DAILY, JSON.stringify(store.daily));
  else localStorage.removeItem(LS_DAILY);
}

/* 文本 → 今日文句（逐字去重、映射字庫、標狀態）。 */
async function setDailyText(text, src) {
  await loadChars();
  const seen = new Set();
  const chars = [];
  for (const ch of text) {
    if (!HAN_RE.test(ch)) continue;
    const c = mapChar(ch);
    const key = c ? c.kai : ch;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!c) chars.push({ k: ch, tc: ch, st: "miss" });
    else chars.push({ k: c.kai, tc: c.tc || c.kai, st: Engine.isStarted(c.kai) ? "old" : "new" });
  }
  store.daily = { date: todayStr(), text: text.trim(), src: src || { type: "self" }, chars, done: [] };
  saveDaily();
  refreshToday();
}

function clearDaily() {
  store.daily = null;
  saveDaily();
  refreshToday();
}

function markDailyDone(kai) {
  const d = store.daily;
  if (!d || d.done.includes(kai)) return;
  if (!d.chars.some((c) => c.k === kai && c.st !== "miss")) return;
  d.done.push(kai);
  saveDaily();
}

function pendingSentenceChars() {
  const d = store.daily;
  if (!d) return [];
  return d.chars.filter((c) => c.st !== "miss" && !d.done.includes(c.k));
}

/* ================= 視圖切換 ================= */

const VIEWS = ["today", "review", "decomp", "progress", "settings"];

function showView(name) {
  VIEWS.forEach((v) => {
    const el = $("#view-" + v);
    el.classList.toggle("hidden", v !== name);
    if (v === name) { el.style.animation = "none"; void el.offsetWidth; el.style.animation = ""; }
  });
  $$("#dock .dock-item").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  if (name === "today") refreshToday();
  if (name === "review") renderReview();
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
  await loadChars();
  loadDaily();
  const s = await Engine.state();
  store.state = s;

  const pending = pendingSentenceChars();
  const newPending = pending.filter((c) => c.st === "new").length;
  const remaining = pending.length + s.queue.length;
  const d = store.daily;
  const doneCount = d ? d.done.length : 0;
  const total = remaining + doneCount + (s.doneToday || 0);

  $("#chip-new").textContent = newPending;
  $("#chip-review").textContent = s.reviewCount + pending.length - newPending;

  const chip = $("#home-streak");
  chip.classList.toggle("hidden", !s.streak);
  chip.textContent = `連 ${s.streak} 天`;

  const num = $("#ring-num");
  if (remaining === 0 && doneCount > 0) {
    num.textContent = "畢";
    num.style.fontFamily = "var(--cursive)";
    $("#ring-sub").textContent = "今日已清";
  } else {
    num.style.fontFamily = "";
    countUp(num, remaining);
    $("#ring-sub").textContent = "今日待練";
  }
  const pct = total ? (total - remaining) / total : 0;
  requestAnimationFrame(() =>
    ($("#ring-fill").style.strokeDashoffset = RING_LEN * (1 - pct))
  );

  renderDailyBlock();

  $("#btn-start").disabled = remaining === 0;
  $("#home-note").innerHTML = STATIC_MODE
    ? "手寫對照範本自評 · 數據存於本機瀏覽器"
    : "本地服務模式";

  const g = pending[0] || (s.queue[0] ? { k: s.queue[0].kai } : null);
  if (g) $("#ghost-glyph").textContent = g.k;
}

/* 今日文句卡：未設 → 輸入；已設 → 逐字狀態。 */
function renderDailyBlock() {
  const el = $("#daily-block");
  const d = store.daily;
  if (!d) {
    el.innerHTML = `
      <div class="card daily-card">
        <div class="sec-label">今日一句</div>
        <p class="daily-hint">寫下今天想用草書寫的一句話 —— 生字現學，熟字重寫。</p>
        <textarea id="daily-input" class="field daily-input" rows="2"
          placeholder="例：晚來天欲雪，能飲一杯無" maxlength="40"></textarea>
        <div class="btn-row">
          <button class="btn" id="daily-use">用這句練</button>
          <button class="btn ghost" id="daily-poem">從唐詩選</button>
        </div>
      </div>`;
    $("#daily-use").addEventListener("click", () => {
      const t = $("#daily-input").value.trim();
      if ([...t].some((ch) => HAN_RE.test(ch))) setDailyText(t, { type: "self" });
    });
    $("#daily-poem").addEventListener("click", openPoemSheet);
    return;
  }
  const srcLabel = d.src.type === "poem"
    ? `${d.src.t} · ${d.src.a}`
    : "自寫一句";
  el.innerHTML = `
    <div class="card daily-card">
      <div class="sec-label">今日文句<span class="daily-src">${srcLabel}</span></div>
      <p class="daily-text">${d.text}</p>
      <div class="daily-chars">
        ${d.chars.map((c) => {
          const done = d.done.includes(c.k);
          const cls = c.st === "miss" ? "miss" : done ? "done" : c.st;
          const tag = c.st === "miss" ? "缺" : done ? "畢" : c.st === "new" ? "新" : "習";
          return `<span class="dchar ${cls}" data-k="${c.k}"><span class="dchar-g">${c.tc}</span><span class="dchar-t">${tag}</span></span>`;
        }).join("")}
      </div>
      <button class="link-btn" id="daily-clear">換一句</button>
    </div>`;
  $("#daily-clear").addEventListener("click", clearDaily);
  el.querySelectorAll(".dchar:not(.miss)").forEach((c) =>
    c.addEventListener("click", () => openDecomp(c.dataset.k, "today"))
  );
}

$("#btn-start").addEventListener("pointerdown", ripple);
$("#btn-start").addEventListener("click", async () => {
  const s = store.state || await Engine.state();
  const queue = buildTodayQueue(s);
  if (queue.length) startSession(queue);
});

/* 今日隊列：文句逐字（生字學 / 熟字寫）在前，FSRS 到期複習在後。 */
function buildTodayQueue(s) {
  const items = [];
  const inSentence = new Set();
  pendingSentenceChars().forEach((c) => {
    inSentence.add(c.k);
    const meta = store.byKai.get(c.k) || {};
    const card = {
      id: c.k + "/p", kai: c.k, tc: c.tc, pinyin: meta.pinyin || "",
      direction: "produce", isNew: c.st === "new",
    };
    items.push({ kind: c.st === "new" ? "learn" : "test", card });
  });
  s.queue.forEach((m) => {
    if (!inSentence.has(m.kai)) items.push({ kind: "review", card: m });
  });
  return items;
}

/* ================= 唐詩選句 ================= */

async function loadPoems() {
  if (!store.poems) {
    store.poems = await fetch("data/poems.json").then((r) => r.json());
  }
  return store.poems;
}

const sheet = { poem: null, sel: new Set() };

async function openPoemSheet() {
  $("#poem-sheet").classList.remove("hidden");
  document.body.classList.add("sheet-open");
  $("#poem-search").value = "";
  try {
    await Promise.all([loadPoems(), loadChars()]);
  } catch {
    $("#poem-body").innerHTML = `<p class="empty-note">詩庫加載失敗，請檢查網絡後重試。</p>`;
    return;
  }
  pickRandomPoem();
}

function closePoemSheet() {
  $("#poem-sheet").classList.add("hidden");
  document.body.classList.remove("sheet-open");
}
$("#poem-close").addEventListener("click", closePoemSheet);

/* 一句詩的字況：幾個生字、幾個庫外字。 */
function lineStats(line) {
  let fresh = 0, miss = 0;
  const seen = new Set();
  for (const ch of line) {
    if (!HAN_RE.test(ch) || seen.has(ch)) continue;
    seen.add(ch);
    const c = mapChar(ch);
    if (!c) miss += 1;
    else if (!Engine.isStarted(c.kai)) fresh += 1;
  }
  return { fresh, miss };
}

function pickRandomPoem() {
  const limit = (store.state && store.state.dailyNewLimit) || 10;
  // 推薦：優先整首生字量貼近每日目標、庫外字少的短詩。
  const scored = store.poems.map((p) => {
    const text = p.ls.join("");
    const st = lineStats(text);
    return { p, st, len: text.length };
  });
  const good = scored.filter((x) => x.st.miss === 0 && x.st.fresh > 0 && x.st.fresh <= limit && x.len <= 48);
  const pool = good.length ? good : scored.filter((x) => x.st.miss <= 2 && x.len <= 60);
  const pick = pool[Math.floor(Math.random() * pool.length)] || scored[0];
  renderPoem(pick.p);
}

function renderPoem(p) {
  sheet.poem = p;
  sheet.sel = new Set();
  const whole = lineStats(p.ls.join(""));
  $("#poem-body").innerHTML = `
    <div class="poem-detail">
      <div class="poem-title-row">
        <div>
          <div class="poem-title">${p.t}</div>
          <div class="poem-meta">${p.a} · ${p.ty} · 生字 ${whole.fresh}${whole.miss ? ` · 庫外 ${whole.miss}` : ""}</div>
        </div>
        <button class="btn ghost btn-mini" id="poem-shuffle">換一首</button>
      </div>
      <div class="poem-lines">
        ${p.ls.map((ln, i) => {
          const st = lineStats(ln);
          return `<button class="poem-line" data-i="${i}">
            <span class="pl-text">${ln}</span>
            <span class="pl-tag">${st.fresh ? `${st.fresh} 生字` : "全學過"}${st.miss ? ` · ${st.miss} 缺` : ""}</span>
          </button>`;
        }).join("")}
      </div>
      <div class="btn-row poem-actions">
        <button class="btn ghost" id="poem-whole">用整首</button>
        <button class="btn" id="poem-use" disabled>用所選句</button>
      </div>
      <p class="fine-print">點選一句或多句 · 生字當天現學，日後可用整句草書創作</p>
    </div>
    <div id="poem-results"></div>`;
  $("#poem-shuffle").addEventListener("click", pickRandomPoem);
  $("#poem-whole").addEventListener("click", () => usePoemLines(p, p.ls.map((_, i) => i)));
  $("#poem-use").addEventListener("click", () => usePoemLines(p, [...sheet.sel].sort((a, b) => a - b)));
  $$(".poem-line").forEach((btn) =>
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.i);
      if (sheet.sel.has(i)) sheet.sel.delete(i); else sheet.sel.add(i);
      btn.classList.toggle("sel", sheet.sel.has(i));
      $("#poem-use").disabled = !sheet.sel.size;
    })
  );
}

function usePoemLines(p, idxs) {
  if (!idxs.length) return;
  const text = idxs.map((i) => p.ls[i]).join("");
  setDailyText(text, { type: "poem", t: p.t, a: p.a });
  closePoemSheet();
}

let poemSearchTimer = null;
$("#poem-search").addEventListener("input", () => {
  clearTimeout(poemSearchTimer);
  poemSearchTimer = setTimeout(() => {
    const q = $("#poem-search").value.trim();
    const box = $("#poem-results");
    if (!box) return;
    if (!q) { box.innerHTML = ""; return; }
    const hits = store.poems.filter((p) =>
      p.t.includes(q) || p.a.includes(q) || p.ls.some((l) => l.includes(q))
    ).slice(0, 30);
    box.innerHTML = hits.length
      ? `<div class="sec-label" style="margin-top:20px">搜索結果</div>` + hits.map((p, i) =>
          `<button class="poem-hit" data-i="${i}"><b>${p.t}</b><span>${p.a} · ${p.ls[0]}</span></button>`
        ).join("")
      : `<p class="empty-note" style="margin-top:20px">無結果</p>`;
    box.querySelectorAll(".poem-hit").forEach((btn) =>
      btn.addEventListener("click", () => { renderPoem(hits[Number(btn.dataset.i)]); window.scrollTo(0, 0); })
    );
  }, 200);
});

/* ================= 練習會話（入墨） ================= */

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
  const item = session.queue[session.idx];
  session.judge = null;
  session.snapshot = null;
  if (!item) return renderDone();
  const card = item.card;
  if (card.direction === "produce") renderProduce(item, card.isNew ? "trace" : "blind");
  else renderRecognize(item);
}

const KIND_TAG = {
  learn: "新字 · 書寫", learnR: "新字 · 認一認",
  test: "今日文句 · 默寫", review: "複習", free: "重寫",
};

/* ---- 書寫卡 ---- */

function renderProduce(item, phase) {
  const card = item.card;
  const tracing = phase === "trace";
  stageHTML(`
    <div class="prompt">
      <div class="tag">${KIND_TAG[item.kind] || "書寫"}</div>
      <div class="k">${card.tc || tcOf(card.kai)}</div>
      <div class="py">${card.pinyin}</div>
      <div class="phase-steps">
        <span class="${tracing ? "on" : ""}">一 · 描紅</span>
        <span class="${tracing ? "" : "on"}">二 · 盲寫</span>
      </div>
    </div>
    <div class="pad-wrap">
      ${miSVG()}
      ${tracing ? `<div class="trace-glyph" style="font-size:min(70vw,300px)">${card.kai}</div>` : ""}
      <canvas class="write-canvas"></canvas>
    </div>
    <div class="btn-row">
      <button id="p-clear" class="btn ghost">洗筆</button>
      <button id="p-next" class="btn">${tracing ? "描好了 · 盲寫" : "落墨 · 判定"}</button>
    </div>
    ${tracing ? "" : `<p class="study-note">${
      STATIC_MODE ? "提交後對照範本自評" : "提交後由 Gemini 判字形結構"
    }</p>`}`);
  session.pad = new BrushPad($("#study-stage .write-canvas"));
  $("#p-clear").addEventListener("click", () => session.pad.clear());
  $("#p-next").addEventListener("click", () => {
    if (tracing) return renderProduce(item, "blind");
    if (!session.pad.hasStrokes) return;
    submitWriting(item);
  });
}

async function submitWriting(item) {
  const card = item.card;
  session.snapshot = session.pad.exportPNG();
  stageHTML(`
    <div class="prompt"><div class="k">${card.tc || tcOf(card.kai)}</div></div>
    <div class="judging"><div class="ink-drop"></div>墨跡入判…</div>`);
  let j;
  try { j = await Engine.judge(card.kai, session.snapshot); }
  catch { j = null; }
  session.judge = j || {
    mode: "selfAssess", score: 0, verdict: "fail", suggestedRating: 3,
    feedback: "判定服務不可用，對照範本自評。",
  };
  renderProduceResult(item);
}

function renderProduceResult(item) {
  const card = item.card;
  const j = session.judge;
  const selfMode = j.mode === "selfAssess";
  stageHTML(`
    <div class="prompt"><div class="tag">${card.tc || tcOf(card.kai)} · ${card.pinyin}</div></div>
    <div class="score-row">
      ${selfMode ? "" : `<div id="score-big" class="score-big">0</div>`}
      <div class="seal-stamp ${selfMode || j.verdict === "fail" ? "dim" : ""}">
        ${selfMode ? "自評" : j.verdict === "pass" ? "形似" : "再練"}
      </div>
    </div>
    <p class="feedback">${j.feedback}</p>
    <div class="compare">
      <div class="cell"><div class="box"><span class="g glyph-ink">${card.kai}</span></div><div class="cap">標準草書</div></div>
      <div class="cell"><div class="box"><img src="${session.snapshot}" alt="你寫的"></div><div class="cap">你的墨跡</div></div>
    </div>
    <div class="masters-block">
      <div class="masters-cap">歷代名家寫「${card.tc || tcOf(card.kai)}」</div>
      <div class="gallery night-gallery" id="result-gallery"><span class="empty-note">墨跡搜尋中…</span></div>
    </div>
    <div class="rating-row">${ratingHTML(j.suggestedRating)}</div>`);
  if (!selfMode) countUp($("#score-big"), j.score, 800);
  fillGallery("#result-gallery", card.kai, "一種草書有多種寫法 · 之後可在字庫細看");
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
  bindRating(item);
}

async function fillGallery(sel, kai, emptyHint) {
  let urls = [];
  try { urls = await Engine.calligraphy(kai); } catch {}
  const g = $(sel);
  if (!g) return;
  g.innerHTML = urls.length
    ? urls.map((u, i) => `<img src="${u}" style="--i:${i}" loading="lazy" referrerpolicy="no-referrer" alt="真跡">`).join("")
    : `<span class="empty-note">${emptyHint || "暫無真跡（離線或來源站不可用）"}</span>`;
}

/* ---- 認字卡 ---- */

async function renderRecognize(item) {
  const card = item.card;
  const options = await Engine.options(card.kai);
  stageHTML(`
    <div class="prompt"><div class="tag">${KIND_TAG[item.kind] || "認字"} · 劃過正確的字，斬</div></div>
    <div class="cursive-hero glyph-ink">${card.kai}</div>
    <div class="option-grid">
      ${options.map((o, i) => `<button class="option-btn" style="--i:${i}" data-k="${o}">${tcOf(o)}</button>`).join("")}
    </div>`);
  wireOptions({
    root: $("#study-stage .stage-step"),
    buttons: $$("#study-stage .option-btn"),
    correctKai: card.kai,
    comboHost: session,
    onDone: (correct) =>
      setTimeout(() => renderRecognizeResult(item, correct), correct ? 620 : 950),
  });
}

/* 選項作答：點選或劃斬皆可。 */
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

function renderRecognizeResult(item, correct) {
  const card = item.card;
  stageHTML(`
    <div class="prompt"><div class="tag">認字</div></div>
    <div class="score-row">
      <div class="seal-stamp ${correct ? "" : "dim"}">${correct ? "認對" : "認錯"}</div>
    </div>
    <p class="feedback">${correct ? "結構入眼即辨，好。" : `此字是「${card.tc || tcOf(card.kai)}」（${card.pinyin}）`}</p>
    <div class="compare">
      <div class="cell"><div class="box"><span class="g">${card.kai}</span></div><div class="cap">草書</div></div>
      <div class="cell"><div class="box"><span class="gk">${card.tc || tcOf(card.kai)}</span></div><div class="cap">楷書 · ${card.pinyin}</div></div>
    </div>
    <div class="rating-row">${ratingHTML(correct ? 3 : 1)}</div>`);
  bindRating(item);
}

/* ---- 評分與隊列推進 ---- */

function ratingHTML(suggested) {
  return RATINGS.map(
    (r, i) => `<button class="rating-btn ${r.v === suggested ? "suggested" : ""}" style="--i:${i}" data-r="${r.v}">${r.label}</button>`
  ).join("");
}

function bindRating(item) {
  $$("#study-stage .rating-btn").forEach((btn) =>
    btn.addEventListener("click", async () => {
      $$("#study-stage .rating-btn").forEach((b) => (b.disabled = true));
      const card = item.card;
      const s = await Engine.grade(card.id, Number(btn.dataset.r));
      store.state = { ...store.state, ...s };
      session.done += 1;
      session.idx += 1;
      if (item.kind === "learn") {
        // 新字：寫完緊跟一張認字卡，認完才算過了這個字。
        session.queue.splice(session.idx, 0, {
          kind: "learnR",
          card: { id: card.kai + "/r", kai: card.kai, tc: card.tc, pinyin: card.pinyin, direction: "recognize", isNew: true },
        });
      } else if (item.kind === "learnR" || item.kind === "test") {
        markDailyDone(card.kai);
      }
      renderCard();
    })
  );
}

function renderDone() {
  updateStudyBar();
  stageHTML(`
    <div class="done-screen">
      <div class="big glyph-ink">畢</div>
      <p>今日 ${session.done} 張卡 · 已入冊</p>
      <span class="seal-stamp">連 ${store.state ? store.state.streak : 0} 天</span>
      <div><button id="btn-back" class="btn" style="max-width:280px;margin:0 auto">出墨 · 回到今日</button></div>
    </div>`);
  $("#btn-back").addEventListener("click", closeSession);
}

/* ================= 複習 ================= */

const quiz = { right: 0, total: 0 };

async function renderReview() {
  const chars = await loadChars();
  const started = chars.filter((c) => c.started);
  const body = $("#review-body");
  if (started.length === 0) {
    body.innerHTML = `<div class="card"><p class="empty-note">還沒學過字。回「今日」寫下第一句，生字自會入冊。</p></div>`;
    return;
  }
  body.innerHTML = `
    <div class="card" id="quiz-card">
      <div class="sec-label">認字快練<span class="daily-src">不影響排期</span></div>
      <div id="quiz-body"></div>
    </div>
    <div class="card">
      <div class="sec-label">重寫一遍<span class="daily-src">已學 ${started.length} 字 · 點字入墨</span></div>
      <div class="char-grid rw-grid">
        ${started.map((c, i) =>
          `<div class="char-cell" style="--i:${i}" data-k="${c.kai}">${c.kai}</div>`
        ).join("")}
      </div>
    </div>`;
  if (started.length >= 4) startQuiz(started);
  else $("#quiz-body").innerHTML = `<p class="empty-note">學滿 4 個字後開放快練。</p>`;
  body.querySelectorAll(".rw-grid .char-cell").forEach((cell) =>
    cell.addEventListener("click", () => {
      const kai = cell.dataset.k;
      const meta = store.byKai.get(kai) || {};
      startSession([{
        kind: "free",
        card: { id: kai + "/p", kai, tc: meta.tc || kai, pinyin: meta.pinyin || "", direction: "produce", isNew: false },
      }]);
    })
  );
}

async function startQuiz(pool) {
  const target = pool[Math.floor(Math.random() * pool.length)];
  const options = await Engine.options(target.kai);
  const box = $("#quiz-body");
  if (!box) return;
  box.innerHTML = `
    <div class="quiz-round">
      <div class="cursive-hero glyph-ink" style="color:var(--ink);min-height:170px;font-size:120px">${target.kai}</div>
      <div class="option-grid">
        ${options.map((o, i) =>
          `<button class="option-btn paper-opt" style="--i:${i}" data-k="${o}">${tcOf(o)}</button>`
        ).join("")}
      </div>
    </div>`;
  wireOptions({
    root: box.querySelector(".quiz-round"),
    buttons: [...box.querySelectorAll(".option-btn")],
    correctKai: target.kai,
    comboHost: quiz,
    onDone: (correct) => {
      quiz.total += 1;
      if (correct) quiz.right += 1;
      const tally = $("#quiz-tally");
      tally.classList.remove("hidden");
      tally.textContent = `${quiz.right} / ${quiz.total}${quiz.combo >= 2 ? ` · 連斬 ×${quiz.combo}` : ""}`;
      setTimeout(() => startQuiz(pool), correct ? 700 : 1400);
    },
  });
}

/* ================= 字庫 ================= */

let decompInited = false;
let decompFilter = "core";
let decompBackTo = null;

async function initDecomp() {
  if (decompInited) return;
  decompInited = true;
  const chars = await loadChars();
  $("#lib-count").textContent = `${chars.length} 字 · 學 ${chars.filter((c) => c.core).length}`;
  const rerender = () => {
    const q = $("#decomp-search").value.trim().toLowerCase();
    let list = decompFilter === "core" ? chars.filter((c) => c.core) : chars;
    if (q) list = list.filter((c) =>
      c.kai.includes(q) || (c.tc || "").includes(q) || (c.sc || "").includes(q)
        || (c.pinyin || "").toLowerCase().includes(q)
    );
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
  $$("#char-grid .char-cell").forEach((cell) =>
    cell.addEventListener("click", () => openDecomp(cell.dataset.k))
  );
}

async function openDecomp(kai, backTo) {
  const d = await Engine.decomposition(kai);
  if (!d || d.error) return;
  const chars = await loadChars();
  const meta = chars.find((c) => c.kai === kai) || {};
  decompBackTo = backTo || null;
  if (backTo) showView("decomp");
  $("#decomp-index").classList.add("hidden");
  const el = $("#decomp-detail");
  el.classList.remove("hidden");
  const tc = d.tc || meta.tc || kai;
  el.innerHTML = `
    <button class="back-link" id="d-back">← ${backTo === "today" ? "今日" : "字表"}</button>
    <div class="decomp-hero">
      <span class="glyph glyph-ink">${d.kai}</span>
      <div class="meta">
        <div class="k">${tc}</div>
        <div class="py">${d.pinyin}</div>
        <div class="rank">字頻第 ${meta.freqRank || "—"} 位${meta.core ? " · 學習字表" : ""}</div>
      </div>
    </div>
    ${d.missing
      ? `<div class="card"><p class="empty-note">此字暫無拆解詳解（前五百高頻字有完整內容），真跡仍可參照。</p></div>`
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
      <div class="sec-label">歷代名家寫法</div>
      <p class="fine-print" style="margin:0 0 12px">一種草書多種寫法 —— 看各家如何處理同一個字，用草書理解草書。</p>
      <div class="gallery" id="gallery"><span class="empty-note">墨跡搜尋中…</span></div>
    </div>`;
  $("#d-back").addEventListener("click", () => {
    el.classList.add("hidden");
    $("#decomp-index").classList.remove("hidden");
    if (decompBackTo === "today") showView("today");
    decompBackTo = null;
  });
  el.querySelectorAll(".conf-chip").forEach((chip) =>
    chip.addEventListener("click", () => openDecomp(chip.dataset.k))
  );
  window.scrollTo(0, 0);
  fillGallery("#gallery", kai);
}

/* ================= 進度 ================= */

async function renderProgress() {
  const p = await Engine.progress();
  const now = new Date();
  const localFmt = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = localFmt(now);
  let overdue = 0;
  const byDay = {};
  (p.dueDistribution || []).forEach((e) => {
    if (e.date < today) overdue += e.count;
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
      <div class="card tile reveal" style="--i:1"><div class="n" id="t-l">0</div><div class="t">學習中</div></div>
      <div class="card tile reveal" style="--i:2"><div class="n" id="t-n">0</div><div class="t">未學</div></div>
    </div>
    <div class="card reveal" style="--i:2">
      <div class="sec-label">到期分佈 · 十四日</div>
      <div class="bars">
        ${bar(overdue, "逾期", true, 0)}
        ${days.map((d, i) => bar(d.count, d.label, false, i + 1)).join("")}
      </div>
    </div>
    <div class="card reveal" style="--i:3">
      <div class="sec-label">積累</div>
      <p class="evo-text">累計複習 ${p.totalReviews} 次 · 連續 ${p.streak} 天</p>
    </div>`;
  countUp($("#t-m"), p.mastered);
  countUp($("#t-l"), p.learning);
  countUp($("#t-n"), p.notStarted);
}

/* ================= 設置 ================= */

async function renderSettings() {
  const s = await Engine.settings();
  $("#settings-body").innerHTML = `
    <div class="card reveal" style="--i:0">
      <div class="sec-label">學習</div>
      <div class="set-row">
        <span>每日生字目標</span>
        <span class="stepper">
          <button class="stepper-btn" id="lim-m">−</button>
          <span class="stepper-val" id="lim-v">${s.dailyNewLimit}</span>
          <button class="stepper-btn" id="lim-p">＋</button>
        </span>
      </div>
      <p class="fine-print">唐詩推薦會按這個量挑生字合適的詩。</p>
      <div class="set-row">
        <span>斬字音效</span>
        <button class="toggle ${localStorage.getItem("caoshu.sound") !== "off" ? "on" : ""}" id="snd-toggle" aria-label="音效開關"><span class="knob"></span></button>
      </div>
    </div>
    ${STATIC_MODE ? `
    <div class="card reveal" style="--i:1">
      <div class="sec-label">數據</div>
      <p class="fine-print">數據存於本機瀏覽器。換設備或清緩存前請導出備份。</p>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn ghost" id="btn-export">導出備份</button>
        <button class="btn ghost" id="btn-import">導入備份</button>
      </div>
      <input type="file" id="import-file" accept=".json" style="display:none">
    </div>` : `
    <div class="card reveal" style="--i:1">
      <div class="sec-label">Gemini 判定</div>
      <div class="set-row"><span>狀態</span>
        <span class="status-txt ${s.geminiConfigured ? "ok" : ""}">${s.geminiConfigured ? "已配置 ✓" : "未配置"}</span></div>
      <input id="key-in" class="field" type="password" placeholder="粘貼 Gemini API Key" autocomplete="off">
      <div class="btn-row">
        <button class="btn" id="key-save">保存</button>
        <button class="btn ghost" id="key-clear">清除</button>
      </div>
      <p class="fine-print">Key 只存於你的 Mac，不進瀏覽器與倉庫。</p>
    </div>`}
    <div class="card reveal" style="--i:2">
      <div class="sec-label">關於</div>
      <p class="fine-print">學書 —— 在每日書寫中學會草書<br>
      每日一句 · 唐詩三百首 · 三千字庫 · FSRS 間隔重複<br>
      刊頭「學」王羲之《學書帖》 · 「書」歐陽詢《卜商帖》<br>
      字體 霞鶩文楷 TC / 鍾齊流江毛草（皆開源）· 真跡 書法字典</p>
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
        alert("導入成功");
        renderSettings();
      } catch { alert("備份文件無法解析"); }
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

/* ================= 啟動 ================= */

(async () => {
  await Engine.init();
  const h = location.hash.slice(1);
  if (VIEWS.includes(h) && h !== "today") showView(h);
  else refreshToday();
})();
