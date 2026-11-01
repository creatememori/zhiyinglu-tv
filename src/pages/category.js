import { onRoute } from '../core/router.js';
import { state, cmsSources, saveSettings } from '../core/state.js';
import { getList, collectTypes, resolveLocalType, filterByType } from '../api/cms.js';
import { kvGet } from '../core/db.js';
import { detectRelay } from '../api/adapters.js';
import { buildPosterChainRelayed } from '../api/posters.js';
import { CC_TYPES } from '../api/sources.js';
import { U, svg, posterCard, skeleton, empty, onAct } from '../ui/ui.js';
import { esc } from '../core/utils.js';

/* ============================================================
   分类页 ：每个源的分类 ID 体系不同，不能拿全局
   ID(1/2/3/4) 直接发请求。加载阶梯：
     1) 源本地分类表解析（resolveLocalType，名称优先）
     2) 本地 ID 无结果 → 重试全局 ID
     3) 仍为空 → 不带 t 拉列表 + 客户端按分类桶过滤
   分类 chips 始终显示当前源的本地分类；质量兜底 Census 全局分类。
   ============================================================ */
onRoute('cat', (view, _segs, query) => {
  let alive = true, page = 1, pcount = 1, busy = false, wfDestroy = null;
  let relayOk = false;
  let srcId = state.settings.catSrc || cmsSources()[0]?.id || '';
  const globalT = query.t != null && query.t !== '' ? +query.t : null;
  const wantName = decodeURIComponent(String(query.n || ''))
    || (globalT != null ? ((CC_TYPES.find(([id]) => id === globalT) || [])[1] || '') : '');

  view.innerHTML = `<div class="page slim">
    <div class="cat-toolbar glass">
      <select id="cat-src" class="select">${cmsSources().map((s) => `<option value="${s.id}" ${s.id === srcId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      <span class="muted" id="cat-hint"></span>
    </div>
    <div class="chips-row" id="type-chips"><div class="sk-line"></div></div>
    <div id="cat-grid">${skeleton(12)}</div>
    <div id="sentinel"></div>
    <div class="loadmore" id="loadmore">正在加载更多…</div>
  </div>`;

  const grid = view.querySelector('#cat-grid');
  const chipsBox = view.querySelector('#type-chips');
  const hint = view.querySelector('#cat-hint');
  const loadmore = view.querySelector('#loadmore');
  const src = () => cmsSources().find((s) => s.id === srcId) || cmsSources()[0];
  let types = [], localT = null, filterMode = false, finished = false;
  const seen = new Set();

  view.querySelector('#cat-src').onchange = (e) => {
    state.settings.catSrc = e.target.value; saveSettings();
    srcId = e.target.value; page = 1; pcount = 1; filterMode = false; localT = null; seen.clear(); finished = false;
    grid.innerHTML = skeleton(12); loadmore.style.display = '';
    start();
  };

  function mergeCcTypes() {
    // 全局常见分类兜底补充，保证即使扫描几乎失败也有可点项
    const have = new Set(types.map((x) => String(x.id)));
    for (const [id, n] of CC_TYPES) if (!have.has(String(id))) types.push({ id, name: n });
  }

  async function start() {
    const s = src();
    if (!s) { grid.innerHTML = empty('radar', '无可用数据源', '请在「数据源」页添加或启用至少一个采集源'); return; }
    /* 非阻塞分类解析（修复"解析分类中…"长卡）：先读本地累积分类表
       （KTYPES，IndexedDB 本地读、毫秒级）立即渲染 chips 并开始加载列表；
       网络归纳（collectTypes，已改并行）在后台完成后刷新 chips，
       若解析出更准的本地 ID 且当前列表为空/处于客户端过滤模式，自动平滑重载。 */
    try { types = (await kvGet('KTYPES:' + s.id)) || []; } catch { types = []; }
    mergeCcTypes();
    localT = resolveLocalType(types, wantName, globalT);
    renderChips();
    hint.textContent = `浏览源：${esc(s.name)}${localT?.name ? ' · ' + esc(localT.name) : wantName ? ' · ' + esc(wantName) : ''}`;
    const idle = !wantName && globalT == null;
    if (idle) {
      grid.innerHTML = `<div class="wireframe-stage" id="wf-cat" style="grid-column:1/-1"></div>` + empty('grid', '选择一个分类开始浏览', '分类来自数据源近 7 日片源自动归纳，可点击上方任意分类');
      const host = grid.querySelector('#wf-cat');
      if (host) import('../effects/wireframe.js').then((m) => { if (alive) wfDestroy = m.createWireframe(host, { size: 280 }); }).catch(() => {});
      loadmore.style.display = 'none';
    } else {
      grid.innerHTML = ''; loadmore.style.display = '';
      loadMore();
    }
    collectTypes(s).then((fresh) => {
      if (!alive || !Array.isArray(fresh) || !fresh.length) return;
      const haveIds = new Set(types.map((x) => String(x.id)));
      for (const t of fresh) if (!haveIds.has(String(t.id))) { types.push(t); haveIds.add(String(t.id)); }
      mergeCcTypes();
      const better = resolveLocalType(types, wantName, globalT);
      renderChips();
      if (!idle && better && better.via === 'map' && String(better.id) !== String(localT?.id) && (filterMode || !grid.querySelector('.card'))) {
        // 解析精度提升（全局兜底 → 本地映射）：用新 ID 重载列表
        localT = better; filterMode = false; page = 1; pcount = 1; seen.clear(); finished = false;
        grid.innerHTML = skeleton(12); loadmore.style.display = '';
        hint.textContent = `浏览源：${esc(s.name)} · ${esc(better.name)}`;
        loadMore();
      } else if (better) {
        localT = better;   // 后续翻页直接用更准的 ID
      }
    }).catch(() => {});
  }

  function renderChips() {
    if (!types.length) { chipsBox.innerHTML = `<div class="chips-wrap">${CC_TYPES.map(([id, n]) => `<button class="chip nav" data-act="goT" data-t="${id}" data-n="${n}"><b>${n}</b></button>`).join('')}</div>`; return; }
    const curId = localT?.id;
    chipsBox.innerHTML = `<div class="chips-wrap">${types.slice(0, 30).map((x) => `<button class="chip nav ${String(curId) === String(x.id) ? 'on' : ''}" data-act="goT" data-t="${x.id}" data-n="${esc(x.name)}"><b>${esc(x.name)}</b></button>`).join('')}</div>`;
  }
  onAct('goT', (b) => { location.hash = `#/cat?t=${b.dataset.t}&n=${encodeURIComponent(b.dataset.n || '')}`; });

  /** 拉取一页：按阶梯尝试，返回条目数组（空数组 = 确实没有） */
  async function fetchPage() {
    const s = src();
    if (filterMode || !localT) {
      // 客户端筛选模式（或目标分类无法解析）：不带 t 拉最多 3 页，按分类桶过滤
      filterMode = true;
      const pool = [];
      for (let i = 0; i < 3; i++) {
        try {
          const r = await getList(s, { pg: page + i, h: 24 });
          pool.push(...(r.list || []));
          const pc = +r.pagecount || 0;
          if (pool.length >= 24 || (pc && page + i >= pc)) break;
        } catch { break; }
      }
      page += 3;
      return filterByType(pool, wantName);
    }
    // 阶梯1：本地分类ID——空结果/异常都视为"无结果"，回退下一阶梯而非直接报错
    let list = [];
    try {
      const r = await getList(s, { pg: page, t: localT?.id, h: 24 });
      pcount = +r.pagecount || 1;
      list = r.list || [];
    } catch { list = []; }
    if (list.length) { page++; return list; }
    // 阶梯 2：本地 ID 无结果 → 试全局 ID
    if (localT?.via === 'map' && globalT != null && globalT !== localT.id) {
      try {
        const r2 = await getList(s, { pg: page, t: globalT, h: 24 });
        if ((r2.list || []).length) { pcount = +r2.pagecount || 1; page++; return r2.list; }
      } catch { /* 继续下一阶梯 */ }
    }
    // 阶梯 3：不带 t 拉取 + 客户端分类桶过滤
    filterMode = true;
    return fetchPage();
  }

  async function loadMore() {
    if (busy || finished) return;
    busy = true;
    try {
      const list = await fetchPage();
      const fresh = (list || []).filter((v) => !seen.has(String(v.vod_id)));
      fresh.forEach((v) => seen.add(String(v.vod_id)));
      if (fresh.length) {
        /* 性能修复：innerHTML += 会把已有卡片全部序列化再重新解析
           （无限滚动 N 页后每页都重建 N×20 个节点）。insertAdjacentHTML
           只解析新增片段，已有 DOM（含图片加载状态、看门狗标记）原样保留。 */
        grid.insertAdjacentHTML('beforeend', `<div class="grid">${fresh.map((v, i) => posterCard({ ...v, srcId: src().id }, i, { pool: v.posterPool, chain: buildPosterChainRelayed(v.vod_pic, v.posterPool, relayOk) })).join('')}</div>`);
      }
      // 页面确实没有更多内容时停手；客户端筛选模式按 3 页一批继续
      const exhausted = page > pcount || filterMode;
      if (!fresh.length && exhausted) {
        finished = true;
        loadmore.style.display = 'none';
        if (!grid.querySelector('.card')) {
          grid.innerHTML = empty('clapperboard', `「${esc(wantName || '该分类')}」暂无内容`,
            '该源没有此类片源，或接口分类体系不同：点上方分类选择本站原生分类，或切换其他数据源试试');
        }
      } else {
        loadmore.style.display = '';
      }
    } catch {
      if (!grid.querySelector('.card')) grid.innerHTML = empty('radar', '该分类加载失败', '源可能已下线或该分类不受支持：请切换站点，或到「数据源」页体检');
      loadmore.style.display = 'none';
    }
    busy = false;
  }

  const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) loadMore(); }, { rootMargin: '600px' });
  io.observe(view.querySelector('#sentinel'));
  detectRelay().then((ok) => { relayOk = ok; });
  start();
  return () => { alive = false; io.disconnect(); try { wfDestroy?.(); } catch {} };
});