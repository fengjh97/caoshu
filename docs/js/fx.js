/* 墨戏特效引擎 —— 粒子溅墨 / 刀光墨痕 / 斩字 / 连斬 / 合成音效 / 触觉。
   全 Canvas + WebAudio 合成，零素材。尊重 prefers-reduced-motion 与音效开关。 */

"use strict";

const FX = (() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const INK = "26, 23, 19";
  const CINNABAR = "197, 57, 31";

  /* ---------- 覆盖层画布（全屏、不挡触摸） ---------- */
  let canvas = null, ctx = null, raf = null;
  const particles = [];
  const trail = [];

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.className = "fx-canvas";
    document.body.appendChild(canvas);
    ctx = canvas.getContext("2d");
    resize();
    addEventListener("resize", resize);
  }
  function resize() {
    const dpr = devicePixelRatio || 1;
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function run() { if (!raf) raf = requestAnimationFrame(loop); }
  function loop() {
    raf = null;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const now = performance.now();

    // 墨滴粒子：重力 + 衰减。
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += 0.14;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 1;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      ctx.globalAlpha = Math.min(1, p.life / 22) * p.a;
      ctx.fillStyle = `rgb(${p.color})`;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.r, p.r * (0.7 + 0.3 * Math.random()), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 刀光墨痕：近段粗、远段细，随时间隐没。
    while (trail.length && now - trail[0].t > 170) trail.shift();
    if (trail.length > 1) {
      for (let i = 1; i < trail.length; i++) {
        const a = trail[i - 1], b = trail[i];
        const age = (now - b.t) / 170;
        ctx.strokeStyle = `rgba(${INK}, ${0.6 * (1 - age)})`;
        ctx.lineWidth = Math.max(1, 9 * (1 - age));
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    if (particles.length || trail.length) run();
    else ctx.clearRect(0, 0, innerWidth, innerHeight);
  }

  /* ---------- 公开：溅墨 ---------- */
  function splatter(x, y, opts = {}) {
    if (reduced) return;
    ensureCanvas();
    const n = opts.n || 26;
    const power = opts.power || 7;
    const color = opts.cinnabar ? CINNABAR : INK;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const v = (0.25 + Math.random() * 0.75) * power;
      particles.push({
        x, y,
        vx: Math.cos(ang) * v,
        vy: Math.sin(ang) * v - power * 0.35,
        r: 0.8 + Math.random() * 2.6,
        a: 0.55 + Math.random() * 0.45,
        life: 26 + Math.random() * 26,
        color,
      });
    }
    run();
  }

  function trailPoint(x, y) {
    if (reduced) return;
    ensureCanvas();
    trail.push({ x, y, t: performance.now() });
    run();
  }

  /* ---------- 斩字：把按钮劈成两半飞出 ---------- */
  function sliceElement(el, cinnabar) {
    const r = el.getBoundingClientRect();
    el.style.visibility = "hidden";
    [0, 1].forEach((side) => {
      const half = el.cloneNode(true);
      half.classList.add("slice-half");
      half.classList.remove("correct", "wrong");
      half.style.cssText += `;position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;margin:0;visibility:visible;`;
      half.style.clipPath = side
        ? "polygon(0 52%, 100% 40%, 100% 100%, 0 100%)"
        : "polygon(0 0, 100% 0, 100% 40%, 0 52%)";
      half.style.setProperty("--fly-x", `${side ? 34 : -30}px`);
      half.style.setProperty("--fly-r", `${side ? 13 : -9}deg`);
      document.body.appendChild(half);
      setTimeout(() => half.remove(), 750);
    });
    splatter(r.left + r.width / 2, r.top + r.height / 2, { n: 34, power: 8, cinnabar });
  }

  /* ---------- 连斬弹出 ---------- */
  function comboPop(x, y, n) {
    const el = document.createElement("div");
    el.className = "combo-pop";
    el.textContent = `連斬 ×${n}`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  /* ---------- 划斩绑定：容器内滑动划过选项即斩 ---------- */
  function slashable(container, selector, onHit) {
    let down = false, resolved = false, lastX = 0, lastY = 0, lastT = 0, lastSwish = 0;
    const hitTest = (x, y) => {
      const el = document.elementFromPoint(x, y);
      return el && el.closest(selector);
    };
    container.addEventListener("pointerdown", (e) => {
      down = true;
      lastX = e.clientX; lastY = e.clientY; lastT = e.timeStamp;
    });
    container.addEventListener("pointermove", (e) => {
      if (!down || resolved) return;
      trailPoint(e.clientX, e.clientY);
      const v = Math.hypot(e.clientX - lastX, e.clientY - lastY) / Math.max(1, e.timeStamp - lastT);
      lastX = e.clientX; lastY = e.clientY; lastT = e.timeStamp;
      if (v > 1.1 && e.timeStamp - lastSwish > 260) { sound.swish(); lastSwish = e.timeStamp; }
      const btn = v > 0.35 ? hitTest(e.clientX, e.clientY) : null;
      if (btn && !btn.disabled) {
        resolved = true;
        onHit(btn, true);
      }
    });
    const end = () => { down = false; setTimeout(() => (resolved = false), 400); };
    container.addEventListener("pointerup", end);
    container.addEventListener("pointercancel", end);
  }

  /* ---------- 合成音效（无素材，首次手势解锁） ---------- */
  const sound = (() => {
    let ac = null;
    const on = () => localStorage.getItem("caoshu.sound") !== "off";
    function ctx_() {
      if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === "suspended") ac.resume();
      return ac;
    }
    function noiseBuf(a, dur = 0.2) {
      const len = a.sampleRate * dur;
      const buf = a.createBuffer(1, len, a.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    }
    return {
      unlock() { try { if (on()) ctx_(); } catch {} },
      swish() {
        if (!on()) return;
        try {
          const a = ctx_(), t = a.currentTime;
          const src = a.createBufferSource();
          src.buffer = noiseBuf(a, 0.16);
          const bp = a.createBiquadFilter();
          bp.type = "bandpass";
          bp.frequency.setValueAtTime(900, t);
          bp.frequency.exponentialRampToValueAtTime(3200, t + 0.13);
          bp.Q.value = 1.1;
          const g = a.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
          src.connect(bp).connect(g).connect(a.destination);
          src.start(t); src.stop(t + 0.17);
        } catch {}
      },
      pop() {
        if (!on()) return;
        try {
          const a = ctx_(), t = a.currentTime;
          const o = a.createOscillator();
          o.type = "sine";
          o.frequency.setValueAtTime(340, t);
          o.frequency.exponentialRampToValueAtTime(80, t + 0.12);
          const g = a.createGain();
          g.gain.setValueAtTime(0.28, t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
          o.connect(g).connect(a.destination);
          o.start(t); o.stop(t + 0.15);
        } catch {}
      },
      thud() {
        if (!on()) return;
        try {
          const a = ctx_(), t = a.currentTime;
          const o = a.createOscillator();
          o.type = "triangle";
          o.frequency.setValueAtTime(120, t);
          o.frequency.exponentialRampToValueAtTime(46, t + 0.18);
          const g = a.createGain();
          g.gain.setValueAtTime(0.3, t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
          o.connect(g).connect(a.destination);
          o.start(t); o.stop(t + 0.21);
        } catch {}
      },
    };
  })();

  function buzz(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch {} }

  // 首次手势解锁音频。
  addEventListener("pointerdown", () => sound.unlock(), { once: true });

  return { splatter, trailPoint, sliceElement, comboPop, slashable, sound, buzz, reduced };
})();
