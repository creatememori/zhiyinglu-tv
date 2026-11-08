import { esc, PF, posterCandidates } from '../core/utils.js';
import { buildPosterChain } from '../api/posters.js';
import { recallPoster } from '../core/postermemo.js';

/* ---------- 线性图标集（24×24 stroke） ---------- */
const I = {
  play: '<path d="M8 5v14l11-7z"/>', search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  gear: '<circle cx="12" cy="10" r="3"/><path d="M12 2v3M12 15v3M5.6 5.6l2.1 2.1M16.3 12.3l2.1 2.1M2 10h3M15 10h3M5.6 14.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>', plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="M20 6L9 17l-5-5"/>',
  chevR: '<path d="M9 18l6-6-6-6"/>', chevD: '<path d="M6 9l6 6 6-6"/>', chevU: '<path d="M18 15l-6-6-6 6"/>',
  arrowL: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  bolt: '<path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  radar: '<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 1 1-8.4 0M19 5a10 10 0 1 1-14 0"/>',
  wand: '<path d="M15 4V2M15 8V6M11.5 5.5h-2M18.5 5.5h-2M3 21l9-9M12.6 6.6l4.8 4.8"/>',
  flame: '<path d="M12 22c4.4 0 8-3.6 8-8 0-3.6-2-6-4-7.5-.6 1.1-1.5 2-2.5 2.6.4-1.9.1-4.2-1.6-6.1C9 5.5 4 8 4 14a8 8 0 0 0 8 8z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  clapperboard: '<path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9"/><path d="m12.4 3.4 3.1 4"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  tv: '<rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><path d="m17 2-5 5-5-5"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  'alert-triangle': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'
};
export const svg = (name, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${I[name] || ''}</svg>`;

/* ---------- 海报卡片 ---------- */
/**
 * 海报图统一渲染：候选链（原图 → 跨源海报池 → weserv → 占位图）写入 data-fb，
 * 由 initGlobals 的全局 error 捕获逐级推进（data-fbi 记录进度）；
 * 主链耗尽后触发豆瓣智能兜底（data-smart 携带 {n:片名,y:年份}）。
 */
export function posterImg(pic = '', { cls = '', alt = '', lazy = true, chain = null, smart = null } = {}) {
  //先同步查封面记忆（点开详情/上次回填已知的封面），命中则直接用
  if (!pic && smart && smart.s && smart.id) {
    const memo = recallPoster(smart.s, smart.id);
    if (memo) pic = memo;
  }
  const list = Array.isArray(chain) && chain.length
    ? [...new Set(chain.filter(Boolean))]
    : posterCandidates(pic);
  const first = list[0] || PF;
  const rest = list.length > 1 ? list.slice(1) : [];
  const fbAttr = rest.length ? ` data-fb='${esc(JSON.stringify(rest))}' data-fbi="0"` : '';
  //并行竞速候选：前 4 个镜像并行预载，反应最快者先填充（不阻塞主链推进）
  const raceList = list.slice(1, 5);
  const raceAttr = raceList.length ? ` data-race='${esc(JSON.stringify(raceList))}'` : '';
  const smartAttr = smart && smart.n ? ` data-smart='${esc(JSON.stringify({ n: String(smart.n).slice(0, 80), y: String(smart.y || ''), t: String(smart.t || ''), s: String(smart.s || ''), id: String(smart.id || '') }))}'` : '';
  return `<img${lazy ? ' loading="lazy" decoding="async"' : ''} referrerpolicy="no-referrer"${cls ? ` class="${esc(cls)}"` : ''} src="${esc(first)}"${fbAttr}${raceAttr}${smartAttr} alt="${esc(alt)}">`;
}

export function posterCard(v, i = 0, o = {}) {
  const pic = v.vod_pic || v.thumb || v.pic || '';
  const chain = Array.isArray(o.chain) && o.chain.length ? o.chain : buildPosterChain(pic, o.pool);
  return `<a class="card reveal" style="--i:${i}" data-href="#/v/${encodeURIComponent(v.srcId)}/${encodeURIComponent(v.vod_id || v.vodId)}" data-spot>
    <div class="card-img">
      ${posterImg(pic, { chain, smart: { n: v.vod_name, y: v.vod_year, t: v.type_name, s: v.srcId, id: v.vod_id } })}
      ${v.vod_remarks ? `<span class="card-tag">${esc(v.vod_remarks)}</span>` : ''}
      ${v.srcCount > 1 ? `<span class="card-multi">${v.srcCount}源</span>` : ''}
      <span class="card-play">${svg('play')}</span>
      <span class="card-shine"></span>
    </div>
    <div class="card-body">
      <span class="card-meta">${esc(v.vod_year || '')}${(v.vod_year && v.type_name) ? ' · ' + esc(v.type_name) : esc(v.type_name || '')}</span>
      <div class="card-title">${esc(v.vod_name || v.name || '')}</div>
    </div>
  </a>`;
}
export const skeleton = (n = 10) => `<div class="grid">${Array.from({ length: n }, (_, i) => `<div class="card sk" style="--i:${i}"><div class="card-img sk-img"></div><div class="sk-line"></div><div class="sk-line w60"></div></div>`).join('')}</div>`;
export const empty = (icon, title, sub = '') => `<div class="empty fade-in"><div class="empty-ico">${svg(icon)}</div><div class="empty-title">${esc(title)}</div>${sub ? `<div class="empty-sub">${esc(sub)}</div>` : ''}</div>`;

/* ---------- Toast 栈 ---------- */
let toastRoot = null;
export function toast(msg, { type = 'info', timeout = 3200, action } = {}) {
  if (!toastRoot) { toastRoot = document.createElement('div'); toastRoot.className = 'toast-wrap'; document.body.appendChild(toastRoot); }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${msg}</span>${action ? `<button class="btn xs ghost toast-act">${esc(action.label)}</button>` : ''}`;
  const kill = () => { t.classList.add('out'); setTimeout(() => t.remove(), 260); };
  const b = t.querySelector('.toast-act');
  if (b) b.onclick = () => { action.fn?.(); kill(); };
  if (timeout) setTimeout(kill, timeout);
  toastRoot.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  return { kill, el: t };
}

/* ---------- 确认框 / 模态 / 抽屉 ---------- */
export function confirmDlg({ title = '确认操作', body = '', ok = '确定', danger = false } = {}) {
  return new Promise((res) => {
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `<div class="modal sm fade-up"><div class="modal-title">${esc(title)}</div><div class="modal-body">${body}</div>
      <div class="modal-ft"><button class="btn ghost" data-x="no">取消</button><button class="btn ${danger ? 'danger' : 'primary'}" data-x="ok">${esc(ok)}</button></div></div>`;
    const close = (v) => { mask.remove(); res(v); };
    mask.onclick = (e) => { if (e.target === mask) close(false); };
    mask.querySelector('[data-x=no]').onclick = () => close(false);
    mask.querySelector('[data-x=ok]').onclick = () => close(true);
    document.body.appendChild(mask);
  });
}
export function modal(html, { full = false, pin = false } = {}) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `<div class="modal ${full ? 'full' : ''} fade-up">${html}</div>`;
  mask.dataset.pin = pin ? '1' : '';
  mask.onclick = (e) => { if (e.target === mask && !pin) mask.remove(); };
  document.body.appendChild(mask);
  return { el: mask, close: () => mask.remove() };
}

/* ---------- 全局动作注册（data-act 统一委派） ---------- */
const ACTS = {};
export function onAct(name, fn) { ACTS[name] = fn; }
/** 路由切换时清空上一页的动作注册表，避免失效闭包跨页残留 */
export function clearActs() { for (const k of Object.keys(ACTS)) delete ACTS[k]; }

/** 全局初始化：波纹 + 聚光灯跟随 + 链接/动作委派 + 图片兜底 —— 按钮动画的统一出口 */
export function initGlobals() {
  document.addEventListener('pointerdown', (e) => {
    const t = e.target.closest('.btn, .chip, .card, .dock-a, .nav-a, .rail-card, .ep, .jx-item');
    if (!t) return;
    const r = t.getBoundingClientRect();
    const d = Math.max(r.width, r.height) * 1.6;
    const s = document.createElement('span');
    s.className = 'ripple';
    s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
    t.appendChild(s);
    setTimeout(() => s.remove(), 600);
  });
  /* 聚光灯跟随：rAF 节流 —— 原实现每次 pointermove 都 getBoundingClientRect，
     高频事件触发强制同步布局（layout thrashing），移动端滑动时尤为明显。 */
  let spotRaf = 0, lastSpotEv = null;
  document.addEventListener('pointermove', (e) => {
    lastSpotEv = e;
    if (spotRaf) return;
    spotRaf = requestAnimationFrame(() => {
      spotRaf = 0;
      const ev = lastSpotEv;
      if (!ev) return;
      const sp = ev.target?.closest?.('[data-spot]');
      if (!sp) return;
      const r = sp.getBoundingClientRect();
      sp.style.setProperty('--mx', ((ev.clientX - r.left) / r.width * 100).toFixed(1) + '%');
      sp.style.setProperty('--my', ((ev.clientY - r.top) / r.height * 100).toFixed(1) + '%');
    });
  }, { passive: true });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-href]');
    if (a) { e.preventDefault(); location.hash = a.dataset.href; return; }
    const b = e.target.closest('[data-act]');
    if (b) { const fn = ACTS[b.dataset.act]; if (fn) fn(b, e); }
  });
  /* ---------- 海报多级降级核心：候选链推进（error 与看门狗共用） ---------- */
  const advanceImg = (img) => {
    try {
      const fb = JSON.parse(img.dataset.fb || '[]');
      const i = Math.max(0, Math.floor(Number(img.dataset.fbi) || 0)); // 已尝试的候选数
      if (Array.isArray(fb) && i < fb.length && fb[i]) {
        img.dataset.fbi = String(i + 1);
        img.src = fb[i];
        //预取下一个候选：后台预载（挂起图床被看门狗 2s 切过来时已命中浏览器缓存）
        const next = fb[i + 1];
        if (next) { try { const pre = new Image(); pre.decoding = 'async'; pre.referrerPolicy = 'no-referrer'; pre.src = next; } catch {} }
        return true;
      }
    } catch {}
    img.src = PF;
    // 主链耗尽：异步聚合外部封面（豆瓣/Bangumi/wmdb）替换，单次、按片名去重、失败静默。
    if (img.dataset.smart && !img.dataset.smartDone) {
      import('../api/posters.js').then((m) => {
        try { m.applySmartFallback(img, JSON.parse(img.dataset.smart || '{}')); } catch {}
      }).catch(() => {});
    }
    return false;
  };

  /* ---------- 并行竞速填充：多个镜像同时预载，首个成功立即出图 ----------
 先到先得（反应快的先填充），失败静默；看门狗主链不受影响。 */
  let raceProbeSeq = 0;
  function raceFill(img) {
    if (img.dataset.racing) return;
    img.dataset.racing = '1';
    let cands;
    try { cands = JSON.parse(img.dataset.race || '[]'); } catch { return; }
    if (!Array.isArray(cands) || !cands.length) return;
    let settled = false;
    const win = (u) => {
      if (settled || !img.isConnected) return;
      if (img.complete && img.naturalWidth > 0) { settled = true; return; }  // 主图已成功
      settled = true;
      img.src = u;
    };
    for (const u of cands.slice(0, 5)) {
      const pre = new Image();
      pre.referrerPolicy = 'no-referrer';
      pre.decoding = 'async';
      pre.onload = () => win(u);
      pre.onerror = () => {};
      pre.src = u;
    }
    // 3.5s 宽限期后未分出胜负 → 允许看门狗主链继续接管（避免竞速拖延降级链）
    setTimeout(() => { if (!settled && img.dataset) img.dataset.racing = '2'; }, 3500);
  }
  window.addEventListener('error', (e) => {
    if (e.target?.tagName !== 'IMG') return;
    advanceImg(e.target);
  }, true);
  /* 加载看门狗：图床"挂起"（既不报错也不出图）时 error 事件永远不会触发，
 卡片会永久停在空白。 从 5s 收紧到 2s —— 多候选链场景下坏图床
 最快 2 秒即切换下一个候选（快速切换候选图床的通用策略）。 */
  const WATCHDOG = 2000;
  const armWatchdog = (img) => {
    if (img.dataset.wd) return;
    img.dataset.wd = '1';
    const startTick = () => {
      (function tick() {
        if (!img.isConnected) return;
        if (img.complete && img.naturalWidth > 0) return; // 已成功出图
        if (!img.dataset.fb) return;                        // 无候选链（占位或兜底未命中）
        if ((img.dataset.stamp || '') === img.src) {
          if (!advanceImg(img)) return; // 候选用尽（PF 兜底）→ 停止
        }
        img.dataset.stamp = img.src;
        setTimeout(tick, WATCHDOG);
      })();
    };
    //空原图（无 data-fb 但有 data-smart）立即豆瓣兜底，兜底写回候选链后再启动
    // 看门狗盯加载。修复：data-smart 存的是 {n,y,t}，applySmartFallback 需按此解构
    // （此前按 {name,year,typeName} 解构，永远是 undefined，兜底从没真正生效过）。
    if (!img.dataset.fb && img.dataset.smart) {
      import('../api/posters.js').then((m) => {
        try {
          const task = m.applySmartFallback(img, JSON.parse(img.dataset.smart || '{}'));
          Promise.resolve(task).then(() => { if (img.isConnected && img.dataset.fb) startTick(); });
        } catch {}
      }).catch(() => {});
      return;
    }
    //并行竞速填充：主 src 若慢，镜像并行预载抢先出图
    raceFill(img);
    //智能兜底提前：3s 后仍未出图即触发豆瓣/源站聚合（原需主链耗尽才触发）
    if (img.dataset.smart && !img.dataset.smartDone) {
      setTimeout(() => {
        if (!img.isConnected || (img.complete && img.naturalWidth > 0)) return;
        if (!img.dataset.smart || img.dataset.smartDone) return;
        import('../api/posters.js').then((m) => {
          try { m.applySmartFallback(img, JSON.parse(img.dataset.smart || '{}')); } catch {}
        }).catch(() => {});
      }, 3000);
    }
    startTick();
  };
  // 只对进入视口的海报挂看门狗，避免懒加载图在屏幕外被误判失败。
  //空原图的海报立即做豆瓣兜底（不等进入视口，进入页面即执行）；有原图候选链的仍按视口懒加载
  const watch = (im) => { if (!im.dataset.fb && im.dataset.smart) armWatchdog(im); else if (io) io.observe(im); else armWatchdog(im); };
  /* 原实现对每次 DOM 变动都全文档 querySelectorAll 扫描；渐进渲染下首页
 会触发十几次全量扫描。改为只处理 MutationRecord 的新增节点（含其子树）。 */
  const watchIn = (root) => {
    if (!root || root.nodeType !== 1) return;
    if (root.matches?.('img[data-fb], img[data-smart]')) watch(root);
    root.querySelectorAll?.('img[data-fb], img[data-smart]').forEach(watch);
  };
  let io = null;
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { armWatchdog(en.target); io.unobserve(en.target); }
    }, { rootMargin: '240px' });
  }
  watchIn(document.body);
  new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) watchIn(n); })
    .observe(document.body, { childList: true, subtree: true });
}

/* ---------- 聚合导出 ---------- */
export const U = { svg, posterCard, skeleton, empty, toast, confirmDlg, modal, onAct, initGlobals };
