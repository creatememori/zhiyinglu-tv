/**
 * 知影录 · 全局交互动效增强
 *
 * 
 *   Linear / Vercel  — 卡片 3D tilt、磁吸按钮
 *   Framer Motion    — 滚动渐入 stagger
 *   Awwwards 站点     — 自定义光标光晕
 *
 * 全部 transform/opacity，GPU 友好；prefers-reduced-motion 时自动禁用。
 */

let initialized = false;

export function initInteractions() {
  if (initialized) return;
  initialized = true;

  // 尊重系统减少动效偏好
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  initCursorGlow();
  initTilt();
  initMagnetic();
  initElasticDrag();
  initSharedTransition();
  initScrollReveal();
}

/* ---------- 1. 光标光晕：紫色柔光跟随鼠标 ---------- */
function initCursorGlow() {
  // 仅桌面端（有指针设备）
  if (!window.matchMedia('(pointer: fine)').matches) return;

  const glow = document.createElement('div');
  glow.id = 'cursor-glow';
  document.body.appendChild(glow);

  let x = -200, y = -200, tx = -200, ty = -200;
  window.addEventListener('mousemove', (e) => { tx = e.clientX; ty = e.clientY; }, { passive: true });

  (function follow() {
    // 缓动跟随（lags behind 更丝滑）
    x += (tx - x) * 0.12;
    y += (ty - y) * 0.12;
    glow.style.transform = `translate(${x - 160}px, ${y - 160}px)`;
    requestAnimationFrame(follow);
  })();
}

/* ---------- 2. 卡片 3D 倾斜 + 高光跟随 + Spring 回正 ---------- */
function initTilt() {
  if (!window.matchMedia('(pointer: fine)').matches) return;

  let current = null;
  let rafPending = false;
  let lastEv = null;

  const applyTilt = (card, ev) => {
    const r = card.getBoundingClientRect();
    const px = (ev.clientX - r.left) / r.width;
    const py = (ev.clientY - r.top) / r.height;
    const rx = (0.5 - py) * 7;
    const ry = (px - 0.5) * 7;
    // 倾斜 + 高光位置（--tx/--ty 供 CSS 径向渐变使用）
    card.style.transform = `perspective(900px) rotateX(${(-rx).toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(-4px)`;
    card.style.setProperty('--tx', (px * 100).toFixed(1) + '%');
    card.style.setProperty('--ty', (py * 100).toFixed(1) + '%');
  };

  document.addEventListener('mousemove', (e) => {
    lastEv = e;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      const ev = lastEv;
      const card = ev.target.closest?.('.card, .home-category-tile, .jx-item, .src-card');
      if (card !== current) {
        if (current) releaseTilt(current);
        current = card;
      }
      if (card) applyTilt(card, ev);
    });
  }, { passive: true });

  const releaseTilt = (el) => {
    el.classList.add('tilt-release');
    el.style.transform = '';
    el.style.removeProperty('--tx');
    el.style.removeProperty('--ty');
    setTimeout(() => el.classList.remove('tilt-release'), 620);
  };

  document.addEventListener('mouseout', (e) => {
    if (current && !current.contains(e.relatedTarget)) {
      releaseTilt(current);
      current = null;
    }
  }, { passive: true });
}

function resetTilt(el) {
  el.style.transform = '';
}

/* ---------- 3. 磁吸按钮（.btn.primary / .chip.on 向鼠标偏移） ---------- */
function initMagnetic() {
  if (!window.matchMedia('(pointer: fine)').matches) return;

  document.addEventListener('mousemove', (e) => {
    const btn = e.target.closest?.('.btn.primary, .search-mini, .logo');
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 60) {
      const pull = (1 - dist / 60) * 5;
      btn.style.transform = `translate(${(dx / dist * pull).toFixed(1)}px, ${(dy / dist * pull).toFixed(1)}px)`;
    }
  }, { passive: true });

  document.addEventListener('mouseout', (e) => {
    const btn = e.target.closest?.('.btn.primary, .search-mini, .logo');
    if (btn && !btn.contains(e.relatedTarget)) btn.style.transform = '';
  }, { passive: true });
}

/* ---------- 4. 橡皮筋阻尼拖拽（需求4：跟手 + 速度吸附回弹） ---------- */
function initElasticDrag() {
  let dragEl = null, startX = 0, startY = 0, lastX = 0, lastY = 0, velX = 0, velY = 0, dragging = false;

  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest?.('.chip, .ep, .btn.ghost, .dock-a');
    if (!el) return;
    // 卡片（.card）已带 3D 倾斜，跳过避免冲突
    if (el.closest('.card')) return;
    dragEl = el;
    startX = lastX = e.clientX;
    startY = lastY = e.clientY;
    velX = velY = 0;
    dragging = true;
    el.classList.add('elastic-drag', 'dragging');
    try { el.setPointerCapture(e.pointerId); } catch {}
  }, { passive: true });

  document.addEventListener('pointermove', (e) => {
    if (!dragging || !dragEl) return;
    velX = e.clientX - lastX; velY = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    // 橡皮筋阻尼：位移按 0.3 系数压缩 + 上限 24px
    const dx = Math.min(24, Math.max(-24, (e.clientX - startX) * 0.3));
    const dy = Math.min(24, Math.max(-24, (e.clientY - startY) * 0.3));
    dragEl.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
  }, { passive: true });

  const endDrag = () => {
    if (!dragging || !dragEl) return;
    dragging = false;
    const el = dragEl;
    dragEl = null;
    el.classList.remove('dragging');
    // 速度吸附：滑速超阈值 → 微弹出；否则弹簧回正
    const speed = Math.sqrt(velX * velX + velY * velY);
    if (speed > 8) {
      // 超调一下再回正（physics feel）
      el.style.transform = `translate(${Math.min(12, velX * 0.8).toFixed(1)}px, ${Math.min(12, velY * 0.8).toFixed(1)}px)`;
      requestAnimationFrame(() => { setTimeout(() => { el.style.transform = ''; }, 90); });
    } else {
      el.style.transform = '';
    }
    setTimeout(() => el.classList.remove('elastic-drag'), 550);
  };
  document.addEventListener('pointerup', endDrag, { passive: true });
  document.addEventListener('pointercancel', endDrag, { passive: true });
}

/* ---------- 5. 共享元素转场辅助（需求3：卡片 → 详情页连续缩放） ---------- */
function initSharedTransition() {
  if (!document.startViewTransition) return;
  // 点击卡片时，把点击的海报标记为转场元素，详情页同名元素完成过渡
  document.addEventListener('click', (e) => {
    const card = e.target.closest?.('.card[data-href^="#/v/"]');
    if (!card) return;
    const img = card.querySelector('.card-img img');
    if (img && img.complete && img.naturalWidth > 0) {
      img.style.viewTransitionName = 'hero-share';
      setTimeout(() => { try { img.style.viewTransitionName = ''; } catch {} }, 800);
    }
  }, { capture: true, passive: true });
}

/* ---------- 6. 滚动渐入：MutationObserver 监听新节点 → IO 观察 ---------- */
function initScrollReveal() {
  const io = new IntersectionObserver((entries) => {
    for (const ent of entries) {
      if (ent.isIntersecting) {
        ent.target.classList.add('revealed');
        io.unobserve(ent.target);
      }
    }
  }, { threshold: 0.08, rootMargin: '0px 0px -6% 0px' });

  const watch = (root) => {
    root.querySelectorAll?.('.card, .res-card, .home-category-tile, .src-card, .hist-row, .set-card, .jx-item, .stat').forEach((el) => {
      if (!el.classList.contains('sr-watched')) {
        el.classList.add('sr-watched');
        io.observe(el);
      }
    });
  };

  // 初始 + 后续动态内容
  watch(document);
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) {
          if (node.matches?.('.card, .res-card, .home-category-tile, .src-card, .hist-row, .set-card, .jx-item, .stat')) {
            node.classList.add('sr-watched');
            io.observe(node);
          }
          watch(node);
        }
      }
    }
  }).observe(document.getElementById('view') || document.body, { childList: true, subtree: true });
}
