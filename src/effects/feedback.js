/* ============================================================
   Motion feedback — adapted from Vue Bits (DavidHDev/vue-bits)
   ClickSpark · HoldButton · LatticeLoader patterns, vanilla port.
   ============================================================ */

const INTERACTIVE = [
  '.btn', '.chip', '.card', '.rail-card', '.film-card', '.dock-a', '.nav-a',
  '.home-category-tile', '.ep', '[data-href]', 'button', 'a[role="tab"]'
].join(',');

const REDUCE_Q = '(prefers-reduced-motion: reduce)';
const reduceQ = window.matchMedia ? window.matchMedia(REDUCE_Q) : { matches: false, addEventListener() {} };

let started = false;
let sparkCanvas = null;
let sparkCtx = null;
let sparks = [];
let sparkRaf = 0;
let sparkDpr = 1;

let pressState = null;
let pressTimer = 0;
let pressRaf = 0;
let holdRing = null;
let holdP = 0;
let suppressEl = null;
let suppressUntil = 0;

let loadEl = null;
let loadTimer = 0;
let loadHideTimer = 0;
let frameObserver = null;
const frameSeen = new WeakSet();
const frameTimers = new WeakMap();

function effectsOff() {
  return document.body.classList.contains('no-fx') || reduceQ.matches;
}

function inEditable(el) {
  return !!(el && el.closest('input,textarea,select,[contenteditable="true"]'));
}

function interactiveFrom(target) {
  if (!(target instanceof Element)) return null;
  if (inEditable(target)) return null;
  return target.closest(INTERACTIVE);
}

/* ---------------- ClickSpark ---------------- */

function ensureCanvas() {
  if (sparkCanvas) return;
  sparkCanvas = document.createElement('canvas');
  sparkCanvas.className = 'fb-spark-canvas';
  sparkCanvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(sparkCanvas);
  sparkCtx = sparkCanvas.getContext('2d');
  sparkCtx.globalCompositeOperation = 'lighter';
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas, { passive: true });
}

function resizeCanvas() {
  if (!sparkCanvas || !sparkCtx) return;
  sparkDpr = Math.min(innerWidth < 700 ? 1.5 : 2, window.devicePixelRatio || 1);
  sparkCanvas.width = Math.floor(innerWidth * sparkDpr);
  sparkCanvas.height = Math.floor(innerHeight * sparkDpr);
  sparkCtx.setTransform(sparkDpr, 0, 0, sparkDpr, 0, 0);
}

function burst(x, y, count) {
  if (effectsOff()) return;
  ensureCanvas();
  sparkCanvas.style.display = 'block';
  const n = count || 8;
  const now = performance.now();
  const base = Math.random() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    sparks.push({
      x, y,
      angle: base + (i / n) * Math.PI * 2 + (Math.random() - .5) * .18,
      radius: 9 + Math.random() * 9,
      length: 5 + Math.random() * 6,
      at: now,
      duration: 360 + Math.random() * 140,
      color: i % 3 === 0 ? '#f472b6' : '#c084fc'
    });
  }
  if (sparks.length > 90) sparks = sparks.slice(-90);
  if (!sparkRaf) sparkRaf = requestAnimationFrame(drawSparks);
}

function drawSparks(now) {
  sparkRaf = 0;
  if (!sparkCtx) return;
  sparkCtx.clearRect(0, 0, innerWidth, innerHeight);
  const alive = [];
  for (const p of sparks) {
    const t = Math.min(1, (now - p.at) / p.duration);
    if (t >= 1) continue;
    alive.push(p);
    const eased = 1 - Math.pow(1 - t, 3);
    const inner = 2 + eased * p.radius;
    const len = Math.max(0, p.length * (1 - eased * .7));
    const alpha = (1 - t) * .9;
    sparkCtx.globalAlpha = alpha;
    sparkCtx.strokeStyle = p.color;
    sparkCtx.lineWidth = 1.35;
    sparkCtx.lineCap = 'round';
    sparkCtx.beginPath();
    sparkCtx.moveTo(p.x + Math.cos(p.angle) * inner, p.y + Math.sin(p.angle) * inner);
    sparkCtx.lineTo(p.x + Math.cos(p.angle) * (inner + len), p.y + Math.sin(p.angle) * (inner + len));
    sparkCtx.stroke();
  }
  sparkCtx.globalAlpha = 1;
  sparks = alive;
  if (alive.length) sparkRaf = requestAnimationFrame(drawSparks);
  else {
    sparkCtx.clearRect(0, 0, innerWidth, innerHeight);
    if (sparkCanvas) sparkCanvas.style.display = 'none';
  }
}

/* ---------------- press / long hold (HoldButton pattern) ---------------- */

function ensureRing() {
  if (holdRing) return;
  holdRing = document.createElement('div');
  holdRing.className = 'fb-hold-ring';
  holdRing.setAttribute('aria-hidden', 'true');
  document.body.appendChild(holdRing);
}

function setRing(x, y) {
  ensureRing();
  holdRing.style.left = x + 'px';
  holdRing.style.top = y + 'px';
  holdRing.style.setProperty('--fb-p', holdP.toFixed(3));
}

function startPress(e) {
  if (effectsOff() || e.button > 0) return;
  const el = interactiveFrom(e.target);
  if (!el || el.matches('[disabled],[aria-disabled="true"]')) return;
  const p = e.pointerType || 'mouse';
  if (p === 'mouse' && e.button !== 0) return;
  e.__fb = { x: e.clientX, y: e.clientY, at: performance.now() };
  el.classList.add('fb-press');
  pressState = {
    el, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY,
    long: false, done: false, pid: e.pointerId, startedAt: performance.now()
  };
  holdP = 0;
  pressTimer = window.setTimeout(() => {
    if (!pressState || pressState.done) return;
    pressState.long = true;
    if (!pressState.el.isConnected) {
      const under = document.elementFromPoint(pressState.x, pressState.y);
      const next = interactiveFrom(under);
      if (next) pressState.el = next;
    }
    pressState.el.classList.add('fb-press', 'fb-holding');
    setRing(pressState.x, pressState.y);
    holdRing.dataset.on = '1';
    if (navigator.vibrate) { try { navigator.vibrate(7); } catch {} }
    const holdStart = pressState.startedAt + 360;
    const tick = () => {
      if (!pressState || pressState.done) return;
      holdP = Math.min(1, (performance.now() - holdStart) / 540);
      setRing(pressState.x, pressState.y);
      if (holdP < 1) pressRaf = requestAnimationFrame(tick);
      else {
        burst(pressState.x, pressState.y, 11);
        if (navigator.vibrate) { try { navigator.vibrate([4, 18, 8]); } catch {} }
      }
    };
    tick();
  }, 360);
}

function movePress(e) {
  if (!pressState || e.pointerId !== pressState.pid) return;
  const dx = e.clientX - pressState.sx;
  const dy = e.clientY - pressState.sy;
  if (dx * dx + dy * dy > 144) cancelPress();
}

function endPress(e) {
  if (!pressState || (e && e.pointerId !== pressState.pid)) return;
  const st = pressState;
  st.done = true;
  clearTimeout(pressTimer);
  cancelAnimationFrame(pressRaf);
  if (holdRing) holdRing.dataset.on = '0';
  if (st.long) {
    suppressEl = st.el;
    suppressUntil = performance.now() + 720;
  }
  const el = st.el;
  el.classList.remove('fb-press', 'fb-holding');
  el.classList.add('fb-releasing');
  setTimeout(() => el.classList.remove('fb-releasing'), 260);
  pressState = null;
  holdP = 0;
  if (!st.long && e && e.type === 'pointerup') {
    const dx = (e.clientX || 0) - st.sx;
    const dy = (e.clientY || 0) - st.sy;
    if (dx * dx + dy * dy <= 64 && performance.now() - st.startedAt < 700) {
      burst(e.clientX, e.clientY, 8);
    }
  }
}

function cancelPress() {
  if (!pressState) return;
  const st = pressState;
  st.done = true;
  clearTimeout(pressTimer);
  cancelAnimationFrame(pressRaf);
  if (holdRing) holdRing.dataset.on = '0';
  st.el.classList.remove('fb-press', 'fb-holding');
  st.el.classList.add('fb-releasing');
  setTimeout(() => st.el.classList.remove('fb-releasing'), 260);
  pressState = null;
  holdP = 0;
}

/* ---------------- loading (LatticeLoader pattern) ---------------- */

function ensureLoad() {
  if (loadEl) return loadEl;
  loadEl = document.createElement('div');
  loadEl.className = 'fb-load';
  loadEl.setAttribute('role', 'status');
  loadEl.setAttribute('aria-live', 'polite');
  loadEl.innerHTML = '<span class="fb-grid" aria-hidden="true">' +
    Array.from({ length: 9 }, (_, i) => `<i class="fb-cell" style="--i:${i}"></i>`).join('') +
    '</span><span class="fb-label"></span><span class="fb-dots" aria-hidden="true"></span>';
  document.body.appendChild(loadEl);
  return loadEl;
}

function showLoading(text, timeout = 15000) {
  if (document.body.classList.contains('no-fx')) return;
  const el = ensureLoad();
  el.querySelector('.fb-label').textContent = text || '正在加载';
  el.dataset.on = '1';
  clearTimeout(loadTimer);
  clearTimeout(loadHideTimer);
  loadTimer = window.setTimeout(hideLoading, timeout);
}

function hideLoading() {
  clearTimeout(loadTimer);
  if (!loadEl) return;
  loadEl.dataset.on = '0';
  clearTimeout(loadHideTimer);
}

function attachFrame(frame) {
  if (!frame || frameSeen.has(frame)) return;
  frameSeen.add(frame);
  const sync = () => {
    if (!frame.src || frame.src === 'about:blank') return;
    showLoading('正在连接解析线路');
    clearTimeout(frameTimers.get(frame));
    frameTimers.set(frame, window.setTimeout(hideLoading, 15000));
  };
  new MutationObserver(sync).observe(frame, { attributes: true, attributeFilter: ['src'] });
  frame.addEventListener('load', () => {
    clearTimeout(frameTimers.get(frame));
    window.setTimeout(hideLoading, 280);
  });
  frame.addEventListener('error', hideLoading);
  sync();
}

function scanFrames() {
  document.querySelectorAll('iframe.parse-frame').forEach(attachFrame);
}

/* ---------------- init ---------------- */

export function initFeedback() {
  if (started) return;
  started = true;

  document.addEventListener('pointerdown', startPress, { passive: true });
  document.addEventListener('pointermove', movePress, { passive: true });
  document.addEventListener('pointerup', endPress, { passive: true });
  document.addEventListener('pointercancel', cancelPress, { passive: true });

  document.addEventListener('click', (e) => {
    if (e.detail !== 0) return;
    const el = interactiveFrom(e.target);
    if (!el) return;
    const r = el.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, 7);
  }, true);

  document.addEventListener('click', (e) => {
    if (!suppressEl || performance.now() > suppressUntil) return;
    if (!suppressEl.contains(e.target)) return;
    suppressEl = null;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  window.addEventListener('fb:loading', (e) => {
    const d = e.detail || {};
    if (d.on === false) hideLoading();
    else showLoading(d.text, d.timeout || 15000);
  });

  // 不在全站 subtree MutationObserver 上扫 iframe：影视首页会高频插入卡片，
  // 每次 mutation 都触发 DOM 查询反而拖慢滚动。改为路由/点击即时扫 + 低频兜底。
  document.addEventListener('click', () => setTimeout(scanFrames, 60), true);
  window.addEventListener('hashchange', () => setTimeout(scanFrames, 80));
  setInterval(scanFrames, 800);
  scanFrames();
}