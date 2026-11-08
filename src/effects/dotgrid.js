/**
 * 知影录 · 星尘粒子背景 （）
 *
 * 特点：
 *  - 随机星尘雾场（非网格）：视口每 1400px² 一个粒子，密度柔和平滑
 *  - 半径 0.5~2.2px 随机、透明度 0.12~0.5 随机，白/淡紫灰
 *  - 缓慢漂移 + 轻微上下浮动（正弦相位错开）
 *  - 鼠标轻推 + 点击涟漪（保留项目交互特色）
 *  - 标签页隐藏暂停、reduced-motion 降级、DPR 适配
 */

const DENSITY = 1400;      // 每像素²/粒子
const BASE_DRIFT = 0.10;   // 漂移速度
const FLOAT_AMP = 0.5;
const FLOAT_SPEED = 0.0008;

const BG = '#0a0a0f';
const STAR_COLORS = [
  [255, 255, 255],    // 白
  [208, 202, 230],    // 淡紫白
  [150, 160, 255],    // 冷蓝白
];

// 涟漪（保留交互）
const RIPPLE_R = 300;
const RIPPLE_LIFE = 75;
const RIPPLE_DECAY = 0.05;
const RIPPLE_FREQ = 0.13;

let canvas, ctx, W, H, DPR;
let stars = [];
let ripples = [];
let animId = null;
let frame = 0;
let visHidden = false;
const mouse = { x: -9999, y: -9999 };

export function initDotGrid() {
  if (canvas) { canvas.remove(); cancelAnimationFrame(animId); }
  canvas = document.createElement('canvas');
  canvas.id = 'dotgrid-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'fixed', inset: 0, zIndex: '-1', pointerEvents: 'none' });
  document.body.prepend(canvas);
  ctx = canvas.getContext('2d');
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  document.addEventListener('visibilitychange', onVis);
  measure(); seed(); bind(); tick();
  return canvas;
}

export function destroyDotGrid() {
  cancelAnimationFrame(animId);
  animId = null;
  document.removeEventListener('visibilitychange', onVis);
  window.removeEventListener('resize', onResize);
  window.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('click', onClick);
  if (canvas) canvas.remove();
  canvas = null; stars = []; ripples = [];
}

function onVis() {
  visHidden = document.hidden;
  if (!visHidden && animId === null && canvas) tick();
}

function measure() {
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = W * DPR; canvas.height = H * DPR;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function seed() {
  const count = Math.min(1400, Math.floor((W * H) / DENSITY));
  stars = [];
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = BASE_DRIFT * (0.3 + Math.random() * 0.9);
    stars.push({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      r: 0.5 + Math.random() * 1.7,
      alpha: 0.12 + Math.random() * 0.38,
      phase: Math.random() * Math.PI * 2,
      floatAmp: FLOAT_AMP * (0.4 + Math.random() * 0.8),
      color: STAR_COLORS[(Math.random() * STAR_COLORS.length) | 0],
      // 闪烁
      twinkle: 0.001 + Math.random() * 0.004,
    });
  }
  ripples = [];
}

function bind() {
  window.addEventListener('resize', onResize);
  window.addEventListener('mousemove', onMouseMove, { passive: true });
  document.addEventListener('click', onClick);
}
function onResize() { measure(); seed(); }
function onMouseMove(e) { mouse.x = e.clientX; mouse.y = e.clientY; }

function onClick(e) {
  ripples.push({ x: e.clientX, y: e.clientY, t: frame, life: 0 });
  if (ripples.length > 5) ripples.shift();
}

function tick() {
  frame++;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // 涟漪更新
  for (let i = ripples.length - 1; i >= 0; i--) {
    ripples[i].life++;
    if (ripples[i].life > RIPPLE_LIFE) { ripples.splice(i, 1); }
  }

  for (const s of stars) {
    // 漂移 + 环绕
    s.x += s.vx; s.y += s.vy;
    if (s.x < -4) s.x = W + 4; else if (s.x > W + 4) s.x = -4;
    if (s.y < -4) s.y = H + 4; else if (s.y > H + 4) s.y = -4;

    // 鼠标轻推（近距离排斥）
    let px = 0, py = 0;
    const dx = s.x - mouse.x, dy = s.y - mouse.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < 130 * 130 && d2 > 1) {
      const d = Math.sqrt(d2);
      const f = (1 - d / 130) * 0.9;
      px = (dx / d) * f; py = (dy / d) * f;
    }

    // 浮动 + 闪烁
    s.phase += FLOAT_SPEED * (0.5 + s.twinkle * 300);
    const floatY = Math.sin(s.phase) * s.floatAmp;
    const twinkleA = 0.75 + 0.25 * Math.sin(s.phase * 7 + s.x);
    let alpha = s.alpha * twinkleA;
    let r = s.r;

    // 涟漪高亮（紫色点缀，保留交互趣味）
    let glow = 0;
    for (const rp of ripples) {
      const ddx = s.x - rp.x, ddy = s.y - rp.y;
      const dist = Math.sqrt(ddx * ddx + ddy * ddy);
      if (dist > RIPPLE_R) continue;
      const lt = rp.life;
      const env = Math.exp(-lt * RIPPLE_DECAY);
      const ring = Math.abs(dist - lt * 3.2);
      if (ring < 34) {
        glow = Math.max(glow, env * (1 - ring / 34) * 0.9);
      }
    }

    const x = s.x + px;
    const y = s.y + py + floatY;

    let cr = s.color[0], cg = s.color[1], cb = s.color[2];
    if (glow > 0.01) {
      cr = 157 + (255 - 157) * (1 - glow);
      cg = 107 - 0;
      cb = 255;
      r = s.r + glow * 1.6;
      alpha = Math.min(1, alpha + glow * 0.6);
      ctx.shadowColor = `rgba(157,107,255,${glow * 0.6})`;
      ctx.shadowBlur = glow * 8;
    } else {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
    }
    ctx.fillStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${Math.min(1, alpha)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  if (visHidden) { animId = null; return; }
  animId = requestAnimationFrame(tick);
}