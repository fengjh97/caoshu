/* 毛筆筆刷引擎 —— BrushPad
   手指無壓感，全部筆性由物理推出：
   · 彈簧-阻尼筆尖：筆鋒滯後於手指，使轉圓、甩筆出鋒（毛筆惯性的來源）
   · 速度僞壓感：快提慢按，EMA 平滑 + gamma 映射 + 變化率限幅（防竹節）
   · 等距軟邊圓 stamp 鏈：中鋒圓頭；起筆漸入，擡手動量收鋒（懸針、牽絲）
   · 多絲飛白：筆頭 8 束絲各有固定偏移與墨量，速度快/墨盡時斷墨露紙
   · 墨量衰減：一筆越長越枯；停駐洇墨暈圈
   目標 iPhone 60fps：stamp 全走 drawImage + globalAlpha，無像素級讀寫。 */

"use strict";

class BrushPad {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.hasStrokes = false;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    this.cssW = rect.width;
    this.cssH = rect.height;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);

    // 筆徑隨字格縮放：毛筆天生比硬筆粗，快筆也不能細成鐵絲
    this.W_MIN = Math.max(3, rect.width * 0.014);
    this.W_MAX = rect.width * 0.062;
    this.V_MAX = 3.2;            // px/ms，速度歸一上限
    this.SPACING = 0.3;          // stamp 間距 = 筆寬比例
    this.DEPLETE_LEN = rect.width * 4.2;  // 墨盡長度

    this._makeSprites();
    this._resetStroke();
    this.tailRaf = null;
    this.bleedAcc = 0;

    canvas.addEventListener("pointerdown", (e) => this.down(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    canvas.addEventListener("pointerup", (e) => this.up(e));
    canvas.addEventListener("pointercancel", (e) => this.up(e));
  }

  /* 軟邊圓 sprite ×2（筆芯 / 暈圈），一次生成，之後全靠 drawImage 縮放。 */
  _makeSprites() {
    const mk = (hard) => {
      const s = document.createElement("canvas");
      s.width = s.height = 64;
      const c = s.getContext("2d");
      const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      // 微偏藍紫的墨色，不用純黑
      if (hard) {
        g.addColorStop(0, "rgba(28,26,30,1)");
        g.addColorStop(0.72, "rgba(28,26,30,0.95)");
        g.addColorStop(1, "rgba(28,26,30,0)");
      } else {
        g.addColorStop(0, "rgba(28,26,30,0.5)");
        g.addColorStop(1, "rgba(28,26,30,0)");
      }
      c.fillStyle = g;
      c.fillRect(0, 0, 64, 64);
      return s;
    };
    this.tip = mk(true);
    this.halo = mk(false);
  }

  _resetStroke() {
    this.finger = null;          // 手指錨點
    this.tipPos = null;          // 彈簧筆尖
    this.tipVel = { x: 0, y: 0 };
    this.pressure = 0.6;
    // 起始寬 = 中等按壓，落筆即有肉，EMA 不用從零爬
    this.width = this.W_MIN + (this.W_MAX - this.W_MIN) * 0.42;
    this.strokeLen = 0;
    this.leftover = 0;
    this.lastT = 0;
    this.bristles = null;
  }

  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  down(e) {
    e.preventDefault();
    if (this.tailRaf) { cancelAnimationFrame(this.tailRaf); this.tailRaf = null; }
    try { this.canvas.setPointerCapture(e.pointerId); } catch {}
    this._resetStroke();
    const p = this._pos(e);
    this.finger = p;
    this.tipPos = { x: p.x, y: p.y };
    this.lastT = e.timeStamp;
    this.hasStrokes = true;
    // 每筆蘸墨：初始化 8 束絲
    this.bristles = Array.from({ length: 8 }, () => ({
      off: Math.random() * 2 - 1,
      ink: 0.6 + Math.random() * 0.4,
      size: 0.16 + Math.random() * 0.16,
    }));
    // 落筆頓點：藏鋒按下的一按
    this._stamp(p.x, p.y, this.width * 0.9, 0.8, 0, 1, 0);
  }

  move(e) {
    if (!this.finger) return;
    e.preventDefault();
    let events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    if (!events.length) events = [e];
    for (const ev of events) this._feed(this._pos(ev), ev.timeStamp);
  }

  _feed(p, t) {
    const dt = Math.max(1, t - this.lastT);
    const dist = Math.hypot(p.x - this.finger.x, p.y - this.finger.y);
    const v = dist / dt;
    this.lastT = t;
    this.finger = p;

    // 速度僞壓感：EMA + gamma（保留下限，快筆細而不斷）
    const raw = 1 - Math.min(1, v / this.V_MAX);
    this.pressure += (raw - this.pressure) * 0.25;
    let target = this.W_MIN + (this.W_MAX - this.W_MIN) *
      (0.14 + 0.86 * Math.pow(this.pressure, 1.4));
    // 起筆漸入（露鋒切入），行程約一個最大筆寬
    const taper = Math.min(1, this.strokeLen / (this.W_MAX * 1.1));
    target *= 0.38 + 0.62 * taper * (2 - taper);
    // 按行進距離平滑逼近目標寬（防竹節，且不拖尾）
    this.width += (target - this.width) * Math.min(1, 0.10 * dist);

    // 彈簧-阻尼筆尖追手指
    this._springStep(3, v);

    // 停駐洇墨
    if (v < 0.1) {
      this.bleedAcc = Math.min(1, this.bleedAcc + dt / 620);
      const bw = this.width * (1.3 + this.bleedAcc * 1.1);
      this.ctx.globalAlpha = 0.05;
      this.ctx.drawImage(this.halo, this.tipPos.x - bw / 2, this.tipPos.y - bw / 2, bw, bw);
      this.ctx.globalAlpha = 1;
    } else this.bleedAcc *= 0.88;
  }

  /* 彈簧筆尖每輸入點推進 n 子步，沿途鋪 stamp。 */
  _springStep(n, v) {
    const SPRING = 0.34, FRICTION = 0.52;
    for (let i = 0; i < n; i++) {
      const prev = { x: this.tipPos.x, y: this.tipPos.y };
      this.tipVel.x = (this.tipVel.x + (this.finger.x - this.tipPos.x) * SPRING) * FRICTION;
      this.tipVel.y = (this.tipVel.y + (this.finger.y - this.tipPos.y) * SPRING) * FRICTION;
      this.tipPos.x += this.tipVel.x;
      this.tipPos.y += this.tipVel.y;
      this._stampSegment(prev, this.tipPos, v);
    }
  }

  _stampSegment(a, b, v) {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    if (dist < 0.01) return;
    this.strokeLen += dist;
    const depletion = Math.min(0.55, this.strokeLen / this.DEPLETE_LEN);
    // 速度再過一層 EMA：瞬時尖峰不至於突然全枯
    this.vEma = (this.vEma || 0) * 0.7 + Math.min(1, v / this.V_MAX) * 0.3;
    const dryness = Math.max(0, Math.min(0.8, this.vEma * 0.95 + depletion * 0.9 - 0.72));
    const alpha = 0.85 - depletion * 0.28;
    const dirX = (b.x - a.x) / dist, dirY = (b.y - a.y) / dist;
    const step = Math.max(0.8, this.width * this.SPACING);
    let d = this.leftover;
    for (; d < dist; d += step) {
      const sx = a.x + dirX * d, sy = a.y + dirY * d;
      this._stamp(sx, sy, this.width, alpha, dryness, dirX, dirY);
    }
    this.leftover = d - dist;
  }

  _stamp(x, y, w, alpha, dryness, dirX, dirY) {
    const ctx = this.ctx;
    const jitter = 0.9 + Math.random() * 0.2;
    if (dryness < 0.15) {
      // 濕筆：整體圓點
      const s = w * jitter;
      ctx.globalAlpha = alpha;
      ctx.drawImage(this.tip, x - s / 2, y - s / 2, s, s);
    } else {
      // 飛白：底層仍鋪淡筆芯保持連貫，絲束在其上斷墨出紋
      const nx = -dirY, ny = dirX;
      const wet = Math.max(0.25, 1 - dryness * 1.1);
      const s = w * jitter;
      ctx.globalAlpha = alpha * wet * 0.6;
      ctx.drawImage(this.tip, x - s / 2, y - s / 2, s, s);
      for (const br of this.bristles) {
        if (Math.random() < dryness * 0.75 * (1.05 - br.ink)) continue; // 斷墨露紙
        const bx = x + nx * br.off * w * 0.42;
        const by = y + ny * br.off * w * 0.42;
        const bs = Math.max(1.3, w * br.size * (1.2 - dryness * 0.35));
        ctx.globalAlpha = alpha * br.ink * 0.85;
        ctx.drawImage(this.tip, bx - bs / 2, by - bs / 2, bs, bs);
      }
    }
    ctx.globalAlpha = 1;
  }

  up() {
    if (!this.finger) return;
    this.finger = null;
    // 擡手動量收鋒：筆尖帶剩餘速度飛行，寬度逐幀衰減 → 懸針/出鋒
    const tail = () => {
      this.tailRaf = null;
      const sp = Math.hypot(this.tipVel.x, this.tipVel.y);
      if (this.width < 0.5 || sp < 0.08) return;
      const prev = { x: this.tipPos.x, y: this.tipPos.y };
      this.tipPos.x += this.tipVel.x;
      this.tipPos.y += this.tipVel.y;
      this.tipVel.x *= 0.8;
      this.tipVel.y *= 0.8;
      this.width *= 0.62;
      this._stampSegment(prev, this.tipPos, sp * 1.2);
      this.tailRaf = requestAnimationFrame(tail);
    };
    tail();
  }

  clear() {
    this.ctx.clearRect(0, 0, this.cssW, this.cssH);
    if (this.tailRaf) { cancelAnimationFrame(this.tailRaf); this.tailRaf = null; }
    this._resetStroke();
    this.hasStrokes = false;
  }

  exportPNG() {
    const out = document.createElement("canvas");
    out.width = 512;
    out.height = 512;
    const c = out.getContext("2d");
    c.fillStyle = "#fff";
    c.fillRect(0, 0, 512, 512);
    c.drawImage(this.canvas, 0, 0, 512, 512);
    return out.toDataURL("image/png");
  }
}

window.BrushPad = BrushPad;
