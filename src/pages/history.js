import { onRoute } from '../core/router.js';
import { listHistory, delHistory, clearHistory } from '../core/db.js';
import { U, svg, posterImg, empty, onAct } from '../ui/ui.js';
import { esc, timeAgo, fmtDur } from '../core/utils.js';

onRoute('history', (view) => {
  view.innerHTML = `<div class="page slim">
    <div class="sec-head"><h2>${svg('clock', 'hot')} 观看历史</h2><button class="btn xs danger ghost" data-act="clearall">${svg('trash')} 清空全部</button></div>
    <div id="hist">加载中…</div></div>`;
  const box = view.querySelector('#hist');

  async function load() {
    const list = await listHistory();
    const totalSec = list.reduce((s, h) => s + (h.sec || 0), 0);
    box.innerHTML = !list.length ? empty('clock', '还没有观看记录', '从首页挑一部开始吧') : `
      <div class="stats-row">
        <div class="stat glass"><b>${list.length}</b><span>部影片</span></div>
        <div class="stat glass"><b>${fmtDur(totalSec)}</b><span>累计在线时长</span></div>
        <div class="stat glass"><b>${new Set(list.map((h) => h.srcId)).size}</b><span>覆盖站点</span></div>
      </div>
      <div class="hist-list">${list.map((h) => {
        const isParse = h.kind === 'parse' || h.srcId === 'parse';
        const playHref = isParse
          ? `#/parse?url=${encodeURIComponent(h.vodId || '')}`
          : `#/play/${encodeURIComponent(h.srcId)}/${encodeURIComponent(h.vodId)}?ep=${h.ei != null ? h.ei : 0}`;
        return `
        <div class="hist-row glass" data-spot>
          <a class="hist-thumb" data-href="${playHref}">
            ${posterImg(h.thumb)}<span class="card-play">${svg('play')}</span></a>
          <div class="hist-info">
            <div class="hist-title">${esc(h.title)}${isParse ? ' <span class="badge">云解析</span>' : ''}</div>
            <div class="card-meta">${esc(h.ep || '')} · ${timeAgo(h.updated)}${h.sec ? ' · 本集看到 ' + fmtDur(h.sec) : ''}</div>
            ${h.prog ? `<div class="pbar"><i style="width:${Math.min(100, (h.prog * 100) | 0)}%"></i></div>` : ''}
          </div>
          <div class="hist-ops">
            ${isParse
              ? `<button class="btn xs primary" data-href="${playHref}">${svg('bolt')} 打开解析</button>`
              : `<button class="btn xs primary" data-act="resume" data-src="${encodeURIComponent(h.srcId)}" data-id="${encodeURIComponent(h.vodId)}" data-ei="${h.ei != null ? h.ei : 0}">${svg('play')} 续播</button>`}
            <button class="btn xs ghost" data-act="del" data-id="${esc(h.id)}">${svg('x')}</button>
          </div>
        </div>`;
      }).join('')}</div>`;
  }
  onAct('resume', (b) => { location.hash = `#/play/${b.dataset.src}/${b.dataset.id}?ep=${b.dataset.ei}`; });
  onAct('del', async (b) => { await delHistory(b.dataset.id); load(); });
  onAct('clearall', async () => { if (await U.confirmDlg({ title: '清空全部历史？', body: '该操作不可恢复', danger: true })) { await clearHistory(); load(); } });
  load();
});
