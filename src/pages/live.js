import { onRoute } from '../core/router.js';
import { state } from '../core/state.js';
import { createPlayer, swapUrl, destroyHls, typeOf } from '../player/player.js';
import { U, svg, empty } from '../ui/ui.js';
import { esc } from '../core/utils.js';

/* ============================ 电视直播 ============================
   直播源来自「设置 → 数据迁移 → 导入配置」的 lives 条目。
   与点播页的差异：isLive 播放器（无进度条/倍速/断点续播）、hls.js 直播
   边缘同步配置、不写历史与进度。UI 复用播放页 player-shell / res-card 体系。
   入口：数据源管理 → 直播源 → 播放 / 全部直播；直达路由 #/live?src=<id>。
   ======================================================================== */
onRoute('live', (view, _segs, query) => {
  const lives = () => state.settings.liveSources || [];
  let art = null, alive = true, curId = String(query?.src || '');

  view.innerHTML = `<div class="page">
    <div class="player-shell">
      <div class="artwrap"><div id="art"></div></div>
      <div id="play-diagnostic" class="play-diagnostic" hidden></div>
      <aside class="player-side glass">
        <div class="side-head">
          <button class="btn xs ghost" data-href="#/sources">${svg('arrowL')} 返回</button>
          <div class="side-title" id="live-title">电视直播</div>
          <span class="badge hot">LIVE</span>
        </div>
        <div class="side-sec"><span>直播源 <span class="muted" id="live-count"></span></span><span class="muted">不写观看记录</span></div>
        <div id="live-list" style="display:grid;gap:10px"></div>
      </aside>
    </div>
  </div>`;

  const artbox = view.querySelector('#art');
  const diag = view.querySelector('#play-diagnostic');
  const titleEl = view.querySelector('#live-title');
  const listBox = view.querySelector('#live-list');
  const showDiag = (msg) => { diag.hidden = false; diag.innerHTML = `<b>${svg('alert-triangle')} 直播诊断</b><span>${esc(msg)}</span><small>直播流对时效与跨域更敏感：失败多为源站下线或格式不受支持，换一路试试。</small>`; };
  const hideDiag = () => { diag.hidden = true; };

  function renderList() {
    const arr = lives();
    view.querySelector('#live-count').textContent = `${arr.length} 个`;
    listBox.innerHTML = arr.length ? arr.map((lv) => `
      <div class="res-card ${lv.id === curId ? 'on' : ''}" data-live="${esc(lv.id)}" style="cursor:pointer">
        <div class="res-head"><span class="res-name">${esc(lv.name)}</span>
          <span class="badge">直播</span>${lv.epg ? '<span class="badge">EPG</span>' : ''}${lv.id === curId ? '<span class="badge hot">播放中</span>' : ''}</div>
        <div class="src-api muted">${esc(lv.url)}</div>
      </div>`).join('')
      : `<div class="muted" style="padding:12px 2px">暂无直播源。「设置 → 数据迁移 → 导入配置」带入 lives 条目后，回到这里即可观看。</div>`;
  }

  function renderIdle() {
    const has = lives().length > 0;
    artbox.innerHTML = empty('tv',
      has ? '选择右侧直播源开始播放' : '暂无直播源',
      has ? '支持 m3u8 / mp4 直链；直播不保存进度与历史' : '先在「设置 → 数据迁移」导入含 lives 的配置');
  }

  async function playLive(lv) {
    if (!lv || !alive) return;
    curId = lv.id;
    renderList();
    titleEl.textContent = lv.name;
    hideDiag();
    artbox.innerHTML = '';
    if (!typeOf(lv.url)) U.toast('该地址未识别出 m3u8/mp4 格式，将尝试直接播放；失败请更换直播源', { type: 'err' });
    try {
      if (art) {
        swapUrl(art, lv.url);
      } else {
        art = await createPlayer(artbox, { url: lv.url, live: true });
        if (!alive) { try { destroyHls(art); art.destroy(true); } catch {} return; }
        art.on('video:error', () => { if (alive) showDiag('该直播源暂时无法播放：地址失效、跨域受限或格式不受支持。请在右侧切换其他直播源。'); });
        art.on('video:playing', hideDiag);
      }
    } catch (err) {
      showDiag('播放器组件加载失败：' + String(err?.message || err).slice(0, 120) + '。请检查网络后刷新重试。');
    }
  }

  listBox.addEventListener('click', (ev) => {
    const card = ev.target.closest('[data-live]');
    if (card) playLive(lives().find((x) => x.id === card.dataset.live));
  });

  renderList();
  renderIdle();
  const first = lives().find((x) => x.id === curId);
  if (first) playLive(first);
  else if (curId) { curId = ''; renderList(); }

  return () => {   // 路由离开：销毁播放器与 hls 实例
    alive = false;
    try { if (art) { destroyHls(art); art.destroy(true); } } catch {}
    art = null;
  };
});
