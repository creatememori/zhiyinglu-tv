import { onRoute } from '../core/router.js';
import { state, saveSettings } from '../core/state.js';
import { multiSearch } from '../api/cms.js';
import { detectRelay } from '../api/adapters.js';
import { buildPosterChainRelayed } from '../api/posters.js';
import { U, svg, posterCard, skeleton, empty, onAct } from '../ui/ui.js';
import { esc, debounce } from '../core/utils.js';

onRoute('search', (view, _segs, query) => {
  let page = 1, alive = true, totalHits = 0, wd = query.wd || '', searchSeq = 0, activeController = null;
  // 搜索结果卡接入「直链+中继反代交替」候选链与跨源海报池（此前只发原图一张）
  let relayOk = false;
  detectRelay().then((ok) => { relayOk = ok; });
  view.innerHTML = `
    <div class="page slim">
      <div class="search-big glass liquid" data-spot>
        ${svg('search', 'ico-lg')}
        <input id="si" placeholder="搜索全网资源…（⌘K / Ctrl+K 快速聚焦）" value="${esc(wd)}" autocomplete="off">
        <button class="btn xs ghost" data-act="clearq">${svg('x')}</button>
      </div>
      <div class="chips-row" id="hot-chips"><span class="muted">热门：</span></div>
      <div class="src-sum" id="src-sum"></div>
      <div id="result">${wd ? skeleton(12) : `<div class="wireframe-stage" id="wf-stage"></div>` + empty('search', '输入关键词开始全网搜索', '将并行检索所有已启用数据源，并按片名归一化指纹聚合去重')}</div>
      <div class="pager" id="pager" style="display:none"></div>
    </div>`;

  // 空态 3D 线框（终末地风格）
  let wfDestroy = null;
  const wfHost = view.querySelector('#wf-stage');
  if (wfHost) {
    import('../effects/wireframe.js').then((m) => { wfDestroy = m.createWireframe(wfHost, { size: 300 }); }).catch(() => {});
  }

  const input = view.querySelector('#si');
  const resultBox = view.querySelector('#result');
  const chipsBox = view.querySelector('#hot-chips');
  const HOT = ['庆余年', '凡人修仙传', '狂飙', '流浪地球', '三体', '繁花', '热辣滚烫'];
  const presets = (state.settings.presets || []);
  const presetChips = presets.length ? presets : [];
  chipsBox.innerHTML += presetChips.map((p) => `<button class="chip" data-act="hot" data-wd="${esc(p.query)}" title="${esc(p.type === 'movie' ? '电影' : '电视剧')}·${esc(p.query)}">${svg(p.type === 'movie' ? 'clapperboard' : 'tv')} ${esc(p.name || p.query)}</button>`).join('')
    + (presetChips.length ? '' : HOT.map((k) => `<button class="chip" data-act="hot" data-wd="${k}">${k}</button>`).join(''))
    + (state.settings.recent || []).slice(0, 6).map((k) => `<button class="chip soft" data-act="hot" data-wd="${esc(k)}">${svg('clock')} ${esc(k)}</button>`).join('');
  onAct('hot', (b) => { input.value = b.dataset.wd; go(1); });
  onAct('clearq', () => { input.value = ''; activeController?.abort(); searchSeq++; resultBox.innerHTML = empty('search', '输入关键词'); view.querySelector('#pager').style.display = 'none'; view.querySelector('#src-sum').textContent = ''; });
  onAct('pg', (b) => go(+b.dataset.pg));

  input.addEventListener('input', debounce(() => go(1), 450));
  input.addEventListener('keydown', (e) => e.key === 'Enter' && go(1));

  function renderRows(rows, w, partial = false) {
    totalHits = rows.length;
    if (!alive) return;
    resultBox.innerHTML = rows.length
      ? `<div class="count-line">「<b>${esc(w)}</b>」${partial ? '当前已聚合' : '聚合去重后'} <b>${rows.length}</b> 条结果，覆盖 <b>${new Set(rows.flatMap((r) => r.sourceIds || [r.srcId])).size}</b> 个站点</div>
         <div class="grid">${rows.map((v, i) => posterCard(v, i, { pool: v.posterPool, chain: buildPosterChainRelayed(v.vod_pic, v.posterPool, relayOk) })).join('')}</div>`
      : (partial ? '<div class="muted" style="padding:18px 0">正在收集各数据源结果…</div>' : empty('search', '没有找到相关影片', '换关键词试试，或到「数据源」页检查健康状态'));
    const pager = view.querySelector('#pager');
    pager.style.display = !partial && totalHits >= 20 ? '' : 'none';
    pager.innerHTML = !partial && totalHits >= 20
      ? `<button class="btn ghost xs" ${page <= 1 ? 'disabled' : ''} data-act="pg" data-pg="${page - 1}">${svg('arrowL')} 上一页</button><span class="muted">第 ${page} 页</span><button class="btn ghost xs" data-act="pg" data-pg="${page + 1}">下一页 ${svg('chevR')}</button>` : '';
  }

  async function go(pg) {
    const w = input.value.trim();
    if (!w) { activeController?.abort(); searchSeq++; resultBox.innerHTML = empty('search', '输入关键词开始全网搜索'); view.querySelector('#pager').style.display = 'none'; view.querySelector('#src-sum').textContent = ''; return; }
    activeController?.abort();
    const controller = new AbortController(); activeController = controller;
    const seq = ++searchSeq;
    page = pg;
    const on = (state.settings.cmsSources || []).filter((s) => s.enabled !== false && s.searchable !== false);
    resultBox.innerHTML = skeleton(12);
    view.querySelector('#pager').style.display = 'none';
    view.querySelector('#src-sum').innerHTML = `<span class="pdot"></span> 正在检索 ${on.length} 个站点（最多 4 个并发），先返回的结果会优先展示…`;
    const sourceStatus = new Map();
    try {
      const rows = await multiSearch(w, { pg, signal: controller.signal, concurrency: 4, onSourceResult: (part) => {
        if (!alive || seq !== searchSeq) return;
        sourceStatus.set(part.src.id, part);
        renderRows(part.results, w, true);
        const finished = part.completed, total = part.total;
        const ok = [...sourceStatus.values()].filter((x) => x.ok).length;
        const failed = finished - ok;
        const stale = [...sourceStatus.values()].filter((x) => x.stale).length;
        view.querySelector('#src-sum').textContent = `已完成 ${finished}/${total} 个源 · 成功 ${ok} · 失败 ${failed} · 缓存兜底 ${stale} · 已实时合并结果`;
      }});
      if (!alive || seq !== searchSeq) return;
      state.settings.recent = [w, ...(state.settings.recent || []).filter((x) => x !== w)].slice(0, 10);
      saveSettings();
      renderRows(rows, w, false);
      const finished = sourceStatus.size, ok = [...sourceStatus.values()].filter((x) => x.ok).length;
      const stale = [...sourceStatus.values()].filter((x) => x.stale).length;
      view.querySelector('#src-sum').textContent = `搜索完成 · ${finished}/${on.length} 个源返回 · 成功 ${ok} · 失败 ${finished - ok} · 缓存兜底 ${stale}`;
    } catch (e) {
      if (e?.name === 'AbortError' || controller.signal.aborted || seq !== searchSeq) return;
      resultBox.innerHTML = empty('radar', '搜索失败', '数据源繁忙，可到「数据源」页体检与更换');
      view.querySelector('#src-sum').textContent = '搜索未能完成，请检查网络或数据源状态。';
    }
  }
  if (wd) go(1);
  setTimeout(() => input.focus(), 250);
  return () => { alive = false; activeController?.abort(); searchSeq++; try { wfDestroy?.(); } catch {} };
});
