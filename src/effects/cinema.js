/* 知影录 · 放映室层
   cinema.css 的行为侧：胶片颗粒、滚动进度、时间码、换场、胶片廊拖拽、SCENE 编号。
   原则：不接管数据与播放器；尊重 prefers-reduced-motion 与设置里的「关闭特效」(body.no-fx)。 */

import { initDock } from './liquid-dock.js';

const REDUCE_Q = '(prefers-reduced-motion: reduce)';
const prefersReducedMotion = () => {
  try { return window.matchMedia(REDUCE_Q).matches; } catch { return false; }
};
const effectsDisabled = () => document.body.classList.contains('no-fx') || prefersReducedMotion();
const twoDigits = (n) => String(n).padStart(2, '0');

/* ---------- 1. 胶片颗粒 ---------- */
function initGrain() {
  if (document.querySelector('.film-grain')) return;
  const cv = document.createElement('canvas');
  cv.className = 'film-grain';
  cv.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cv);

  const W = 180, H = 180;
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d', { alpha: true });
  if (!ctx) return;
  const img = ctx.createImageData(W, H);
  const d = img.data;

  const draw = () => {
    if (effectsDisabled() || document.hidden) return;
    for (let i = 0; i < d.length; i += 4) {
      const v = 90 + ((Math.random() * 150) | 0);
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = Math.random() < 0.55 ? 26 : 0;
    }
    ctx.putImageData(img, 0, 0);
  };

  draw();
  // 12fps 足够像胶片；比逐帧 rAF 省电
  if (!prefersReducedMotion()) setInterval(draw, 110);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) draw(); });
}

/* ---------- 2. 卷轴进度 + 顶栏时间码 ---------- */
function initHud() {
  const bar = document.querySelector('.film-progress i');
  const tc = document.getElementById('tc');
  let last = '';
  let max = 1;
  let frame = 0;

  const paint = () => {
    frame = 0;
    const p = Math.min(1, Math.max(0, (window.scrollY || document.documentElement.scrollTop || 0) / max));
    if (bar) bar.style.transform = `scaleX(${p.toFixed(4)})`;
  };
  const onScroll = () => {
    if (!frame) frame = requestAnimationFrame(paint);
  };
  const refreshMax = () => {
    max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    paint();
  };

  paint();
  refreshMax();
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', refreshMax, { passive: true });
  addEventListener('load', refreshMax, { once: true });
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => refreshMax());
    ro.observe(document.body);
  }

  // The timecode only needs film-frame granularity (24fps), not 60fps.
  // It is also skipped entirely while the top bar timecode is display:none.
  const tick = () => {
    if (!tc || document.hidden || tc.offsetParent === null) return;
    const now = new Date();
    const ff = Math.floor((now.getMilliseconds() / 1000) * 24);
    const s = `${twoDigits(now.getHours())}:${twoDigits(now.getMinutes())}:${twoDigits(now.getSeconds())}:${twoDigits(ff)}`;
    if (s !== last) { tc.textContent = s; last = s; }
  };
  setInterval(tick, 42);
}

/* ---------- 3. 换场：不做白闪，做一次暗场光扫 ---------- */
function initReelCut() {
  if (document.querySelector('.reel-veil')) return;
  const veil = document.createElement('div');
  veil.className = 'reel-veil';
  veil.setAttribute('aria-hidden', 'true');
  document.body.appendChild(veil);

  let timer = 0;
  window.addEventListener('hashchange', () => {
    if (effectsDisabled()) return;
    document.body.classList.remove('reel-cut');
    void veil.offsetWidth;
    document.body.classList.add('reel-cut');
    clearTimeout(timer);
    timer = setTimeout(() => document.body.classList.remove('reel-cut'), 860);
  });
}

/* ---------- 4. 胶片廊：拖拽 / 箭头 / 键盘 ---------- */
function wireStrip(strip) {
  const track = strip.querySelector('.filmstrip-track');
  if (!track) return;
  const step = () => {
    const card = track.querySelector('.film-card');
    const gap = parseFloat(getComputedStyle(track).columnGap || '20') || 20;
    return (card ? card.getBoundingClientRect().width : 200) + gap;
  };
  const scrollByDir = (dir) => {
    track.scrollBy({ left: dir * step() * 1.5, behavior: effectsDisabled() ? 'auto' : 'smooth' });
  };

  strip.querySelectorAll('[data-film-dir]').forEach((btn) => {
    btn.addEventListener('click', () => scrollByDir(Number(btn.dataset.filmDir) || 1));
  });

  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); scrollByDir(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); scrollByDir(-1); }
  });

  // 桌面鼠标拖拽：触摸端保留原生惯性滚动，不接管
  let down = false, startX = 0, startLeft = 0, moved = 0, pid = null;
  track.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    down = true; moved = 0; startX = e.clientX; startLeft = track.scrollLeft; pid = e.pointerId;
    track.classList.add('is-dragging');
    try { track.setPointerCapture(pid); } catch {}
  });
  track.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > moved) moved = Math.abs(dx);
    track.scrollLeft = startLeft - dx;
  });
  const endDrag = () => {
    if (!down) return;
    down = false;
    track.classList.remove('is-dragging');
    if (pid != null) { try { track.releasePointerCapture(pid); } catch {} }
    pid = null;
  };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);
  track.addEventListener('pointerleave', () => { if (down) endDrag(); });
  // 拖拽之后的那次 click 不应触发跳转
  track.addEventListener('click', (e) => {
    if (moved > 6) { e.preventDefault(); e.stopPropagation(); moved = 0; }
  }, true);
}

export function initFilmstrip(root = document) {
  root.querySelectorAll('.filmstrip').forEach((strip) => {
    if (strip.dataset.cineReady === '1') return;
    strip.dataset.cineReady = '1';
    wireStrip(strip);
  });
}

/* ---------- 5. SCENE 序号：只给可见的区块编号 ---------- */
function decorateScenes() {
  const heads = [...document.querySelectorAll('#view .sec-head')].filter((h) => h.offsetParent !== null);
  heads.forEach((h, i) => { h.dataset.scene = twoDigits(i + 1); });
}

/* ---------- 入口 ---------- */
let started = false;
export function initCinema() {
  if (started) return;
  started = true;
  document.documentElement.classList.add('cine');
  // 低端设备不为液态玻璃做逐帧折射，保留磨砂外观
  if ((navigator.deviceMemory && navigator.deviceMemory <= 2) ||
      (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2)) {
    document.documentElement.classList.add('lg-lite');
  }
  initGrain();
  initHud();
  initReelCut();
  initDock();
  initFilmstrip();
  decorateScenes();

  const view = document.getElementById('view');
  if (view) {
    let t = 0;
    const mo = new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => {
        decorateScenes();
        initFilmstrip(view);
      }, 140);
    });
    mo.observe(view, { childList: true, subtree: true });
  }
}