import { onRoute, goto } from '../core/router.js';
import { state, saveSettings } from '../core/state.js';
import { aggregateDetail, sourceScore, extractFromSharePage } from '../api/cms.js';
import { createPlayer, swapUrl, probeUrl, looksLikePage, destroyHls, typeOf, quickProbe } from '../player/player.js';
import { createVideoBar } from '../player/video-bar.js';
import { detectRelay, relayStreamUrl } from '../api/adapters.js';
import { pingJiexi, jxUrl } from '../api/parsers.js';
import { progressGet, progressSet, addHistory, skipGet, skipSet } from '../core/db.js';
import { U, svg, empty, onAct } from '../ui/ui.js';
import { esc, normalizeTitle, epNum, isVipUrl, isPageUrl, fmtDur, PF, hashId, posterCandidates, epDisplayOrder, epWindowSize } from '../core/utils.js';
import { probeLines, recallPrecheck, rememberPrecheck, precheckKey, rankPlays, sameCdn } from '../api/lineprobe.js';

/* ============ 云解析悬浮面板（播放页 & 解析页复用） ============ */
function openParsePanel(targetUrl, preferId) {
  const jxs = state.settings.jiexiSources;
  let selId = jxs.find((j) => j.id === preferId)?.id || jxs[0]?.id;
  const hostOf = (u) => { try { return new URL(u).hostname; } catch { return u; } };
  const m = U.modal(`<div class="pane">
    <div class="pane-head">
      <div class="pane-title">${svg('bolt', 'hot')} 云解析播放 · <span class="muted">${esc(hostOf(targetUrl))}</span>
        <div class="chips-row" style="margin-top:8px">${jxs.map((j) => `<button class="chip ${j.id === selId ? 'on' : ''}" data-jx="${j.id}">${esc(j.name)}</button>`).join('')}</div>
      </div>
      <div class="pane-btns">
        <button class="btn xs ghost" id="jx-open">${svg('external')} 新窗口</button>
        <button class="btn xs ghost" id="jx-refresh">${svg('refresh')} 刷新</button>
        <button class="btn xs ghost" id="jx-close">${svg('x')} 关闭</button>
      </div>
    </div>
    <iframe id="jx-frame" class="parse-frame" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="no-referrer"></iframe></div>`, { full: true, pin: true });
  const frame = m.el.querySelector('#jx-frame');
  const load = () => { frame.src = jxUrl(jxs.find((j) => j.id === selId) || jxs[0], targetUrl); };
  load();
  m.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-jx]');
    if (b) { selId = b.dataset.jx; m.el.querySelectorAll('[data-jx]').forEach((x) => x.classList.toggle('on', x === b)); load(); }
  });
  m.el.querySelector('#jx-open').onclick = () => window.open(frame.src, '_blank');
  m.el.querySelector('#jx-refresh').onclick = load;
  m.el.querySelector('#jx-close').onclick = m.close;
  // 解析观看计入历史：同一目标地址复用同一条记录（djb2 哈希作 key），避免重复打开面板刷爆历史列表
  addHistory({ id: 'px:' + hashId(targetUrl), kind: 'parse', srcId: 'parse', vodId: targetUrl, title: hostOf(targetUrl), thumb: '', ep: '云解析', ei: -1, sec: 0 }).catch(() => {});
  return m;
}

/* ============================ 播放页 ============================ */
onRoute('play', (view, segs, query) => {
  const [, srcId, vodId] = segs;
  // 云解析历史记录（srcId: 'parse'）不是普通剧集，回解析页直接打开对应面板。
  if (srcId === 'parse') { goto(`#/parse?url=${encodeURIComponent(decodeURIComponent(vodId || ''))}`); return; }
  let playbackSrcId = srcId, playbackVodId = vodId;
  let art = null, ag = null, alive = true, vpBar = null;
  let p = Math.max(0, +query.p || 0), l = Math.max(0, +query.l || 0), e = Math.max(0, +query.e || 0);
  let seriesKey = '', resumeAt = null, resumeIntro = false, autoNext = state.settings.autonext !== false;
  let lastSaveAt = 0, nextCtl = null, epStartAt = Date.now();
  // 播放失败自动换线状态：连续计数 + 已试线路集合（成功播放或手动切换时清零）
  let errTries = 0;
  const triedLines = new Set();
  // 线路预检与重载循环状态
  const linePenalty = new Map();   // url → 失败惩罚次数（评分减半记忆）
  let probeMap = null;             // 预检结果 Map
  let reloadRound = 0;             // 重载循环轮次（0=初始，1/2/3=三轮，3后停止）
  let lastFailedAll = null;        // 上一轮全败标记
  let groupsExpanded = false;      // 线路「展开全部」开关
  let autoRescanRound = 0;         // 自动重扫循环轮次（成功播放清零）
  const AUTO_RESCAN_MAX = 3;       // 自动重扫上限（防止无限循环）
  // 片头片尾跳过配置：enable + intro/outro 秒，按片名记忆
  let skip = { enable: false, intro: 0, outro: 0 }, outroFired = false;

  view.innerHTML = `<div class="page player-page">
    <div class="player-shell">
      <div class="artwrap"><div id="art"></div></div>
      <div id="play-diagnostic" class="play-diagnostic" hidden></div>
      <aside class="player-side glass">
        <div class="side-head">
          <button class="btn xs ghost" data-href="#/v/${encodeURIComponent(srcId)}/${encodeURIComponent(vodId)}">${svg('arrowL')} 返回</button>
          <div class="side-title" id="side-title">加载中…</div>
          <button class="btn xs ghost" id="skip-cfg" title="片头片尾跳过设置">${svg('gear')} 跳片</button>
          <label class="switch-inline" title="自动连播下一集">${svg('flame')}<input type="checkbox" class="switch" id="sw-next" ${autoNext ? 'checked' : ''}></label>
        </div>
        <div id="groups"></div>
        <div class="side-sec"><span>剧集 <span class="muted" id="ep-total"></span></span><span><button class="btn xs ghost" id="ep-order" hidden>倒序</button> <button class="btn xs ghost" id="speed-btn">${svg('bolt')} 本集换源测速</button></span></div>
        <div class="ep-grid" id="eps"></div>
      </aside>
    </div>
    <!-- 播放提示区：不进播放器黑框，独立全宽展示（手机端不再被裁剪） -->
    <div id="play-notice" class="play-notice" hidden></div>
    <div class="jx-line" id="jx-line" hidden></div>
  </div>`;

  const artbox = view.querySelector('#art');
  const diagnosticBox = view.querySelector('#play-diagnostic');
  // m3u8 播放地址经同域流中继，规避采集站分片无 CORS 导致"无法播放"
  let relayOk = false;
  detectRelay().then((ok) => { relayOk = ok; });
  const playable = (u) => (relayOk && typeOf(u) === 'm3u8') ? relayStreamUrl(u) : u;
  let playWatchdog = null;
  const showPlayDiagnostic = (message) => {
    if (!diagnosticBox || !alive) return;
    diagnosticBox.hidden = false;
    diagnosticBox.innerHTML = `<b>${svg('alert-triangle')} 播放诊断</b><span>${esc(message)}</span><small>不要反复刷新；先确认该线路返回的是媒体文件/播放清单，而不是网页或鉴权错误。</small>`;
  };
  const hidePlayDiagnostic = () => { if (diagnosticBox) diagnosticBox.hidden = true; clearTimeout(playWatchdog); playWatchdog = null; };
  const groupsBox = view.querySelector('#groups');
  const epsBox = view.querySelector('#eps');
  view.querySelector('#sw-next').onchange = (ev) => { autoNext = ev.target.checked; state.settings.autonext = autoNext; saveSettings(); if (!autoNext && nextCtl) { nextCtl.kill(); nextCtl = null; } };
  view.querySelector('#speed-btn').onclick = speedTest;
  view.querySelector('#ep-order').onclick = () => { epDesc = !epDesc; epShown = EP_CHUNK; renderEps(true); };

  (async () => {
    // 播放页智能重试：与详情页同算法（指数退避 + 权限类不重试 + 可取消）
    const MAX_RETRY = 4;
    const BACKOFF = [1200, 2500, 4000, 6000];
    const isRetryable = (e) => !/401|403|404|认证|授权|不存在|不匹配|找不到/.test(String(e?.message || ''));
    for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
      try { ag = await aggregateDetail(srcId, vodId, { fast: true }); break; }
      catch (error) {
        if (!alive) return;
        if (!isRetryable(error) || attempt === MAX_RETRY) {
          artbox.innerHTML = empty('radar', '资源加载失败', `主源详情请求失败：${String(error?.message || '未知错误').slice(0, 180)}。请先在数据源管理中确认 API 可用。`);
          return;
        }
        // 播放器区域显示重试状态
        artbox.innerHTML = `<div class="empty fade-in" style="min-height:280px"><div class="load-logo"></div><div class="empty-sub" style="margin-top:14px">接口繁忙，自动重试中（${attempt + 1}/${MAX_RETRY}）…</div></div>`;
        await new Promise((r) => setTimeout(r, BACKOFF[attempt]));
      }
    }
    if (!ag || !alive) return;
    seriesKey = normalizeTitle(ag.vod.vod_name) + (ag.vod.vod_year ? ':' + ag.vod.vod_year : '');
    view.querySelector('#side-title').textContent = ag.vod.vod_name;
    view.querySelector('#skip-cfg').onclick = () => openSkipConfig();
    // 聚合结果必须至少有一条真实播放线路；没有时给出可操作的提示，不能继续访问空数组。
    ag.plays = (ag.plays || []).filter((pl) => Array.isArray(pl.lines) && pl.lines.some((ln) => Array.isArray(ln.eps) && ln.eps.length));
    // 阶段1：预检优先（详情页预热命中直接复用；无则快速预检每源1条）
    probeMap = recallPrecheck(precheckKey(srcId, vodId));
    if (!probeMap) {
      const cands = [];
      for (const pl of ag.plays) {
        const ep = (pl.lines || []).flatMap((ln) => ln.eps || []).find((x) => x && /^https?:\/\//i.test(x.url || ''));
        if (ep) cands.push(ep.url);
      }
      probeMap = await probeLines(cands.slice(0, 6), { timeout: 4500 });
      rememberPrecheck(precheckKey(srcId, vodId), probeMap);
    }
    // 阶段1：综合评分排序（源健康分×0.4 + 预检速度×0.4 + 直链×0.2 + 惩罚）
    ag.plays = rankPlays(ag.plays, probeMap, sourceScore, (u) => linePenalty.get(u) || 0);
    if (!ag.plays.length && ag.more) {
      // 仅当主源没有可播放线路时才等待跨源补充；正常情况不让跨源搜索阻塞首播。
      const extras = await ag.more.catch(() => []);
      if (!alive) return;
      const playableExtras = (extras || []).filter((pl) => Array.isArray(pl.lines) && pl.lines.some((ln) => Array.isArray(ln.eps) && ln.eps.length));
      if (playableExtras.length) {
        ag.plays = playableExtras;
        ag.vod = playableExtras[0].vod;
        playbackSrcId = playableExtras[0].src.id;
        playbackVodId = playableExtras[0].vod.vod_id;
      }
    }
    if (!ag.plays.length) {
      artbox.innerHTML = empty('play', '该影片暂无可用播放地址', '主源没有可播放线路，且其他来源未找到可靠匹配。请检查源站播放字段或在详情页手动切换资源。');
      view.querySelector('#side-title').textContent = ag.vod.vod_name || '影片播放';
      groupsBox.innerHTML = '';
      epsBox.innerHTML = '';
      return;
    }
    // 额外补充(若有)也重排，随后默认从"推荐线路"（综合分第1名）开始
    ag.plays = rankPlays(ag.plays, probeMap, sourceScore, (u) => linePenalty.get(u) || 0);
    (p = 0), (l = 0);
    e = Math.min(e, (ag.plays[0]?.lines?.[0]?.eps || []).length - 1);
    renderGroups(); renderEps(true);
    // 跨源补充放在后台：主源可立即进入播放器，额外来源就绪后再追加切换线路。
    if (ag.more && typeof ag.more.then === 'function') {
      ag.more.then((extras) => {
        if (!alive || !Array.isArray(extras) || !extras.length) return;
        const known = new Set((ag.plays || []).map((pl) => String(pl.src.id)));
        for (const extra of extras) if (!known.has(String(extra.src.id))) { ag.plays.push(extra); known.add(String(extra.src.id)); }
        const prevP = p, prevL = l, prevE = e;
        renderGroups(); renderEps();
        // 只重绘线路列表，不重置当前播放的 video URL 或进度。
        p = Math.min(prevP, ag.plays.length - 1); l = prevL; e = prevE;
      }).catch(() => {});
    }
    // 断点续播：同集命中保存进度时续点；同时读片头片尾跳过配置
    const [pg, skCfg] = await Promise.all([progressGet(seriesKey), skipGet(seriesKey).catch(() => null)]);
    if (skCfg && typeof skCfg === 'object') {
      skip = { enable: skCfg.enable !== false, intro: Math.max(0, Math.min(600, Math.round(+skCfg.intro || 0))), outro: Math.max(0, Math.min(600, Math.round(+skCfg.outro || 0))) };
    }
    if (pg && state.settings.resume && pg.ei === e && pg.t > 8) resumeAt = pg.t;
    if (resumeAt == null && skip.enable && skip.intro > 0) { resumeIntro = true; resumeAt = skip.intro; }
    await new Promise((r) => requestAnimationFrame(r));
    const currentUrl = cur()?.url || '';
    if (!/^https?:\/\//i.test(currentUrl)) {
      artbox.innerHTML = empty('play', '播放地址格式不正确', '当前线路没有返回有效的 http(s) 地址，请切换线路。');
      return;
    }
    // 预连接媒体域名（TCP+TLS 握手提前完成，首帧加载更快；参考业界实践）
    try {
      const host = new URL(currentUrl).origin;
      if (!document.querySelector(`link[rel="preconnect"][href="${host}"]`)) {
        const link = document.createElement('link');
        link.rel = 'preconnect'; link.href = host; link.crossOrigin = 'anonymous';
        document.head.appendChild(link);
      }
    } catch {}
    if (isVipUrl(currentUrl) || isPageUrl(currentUrl) || looksLikePage(currentUrl)) {
      /* 页面检测提示移到播放器外的独立全宽区（#play-notice），
         手机端不再被播放器黑框裁剪；artbox 只放轻量占位。 */
      const noticeBox = view.querySelector('#play-notice');
      artbox.innerHTML = `<div class="empty fade-in" style="min-height:180px"><div class="empty-ico">${svg('bolt')}</div><div class="empty-title">该线路为第三方视频页面</div><div class="empty-sub">请在下方「播放提示」中选择云解析线路</div></div>`;
      if (noticeBox) {
        noticeBox.hidden = false;
        noticeBox.innerHTML = `<div class="notice-head">${svg('bolt', 'hot')} 播放提示 · 检测到第三方视频页面</div>
          <div class="notice-body">该地址不是可直接播放的媒体文件（平台页/分享页），点击下方云解析线路在线播放，或在右侧切换其他线路。</div>
          <div class="chips-wrap">${state.settings.jiexiSources.map((j) => `<button class="chip" data-jx="${esc(j.id)}">${esc(j.name)}</button>`).join('')}</div>`;
        noticeBox.querySelectorAll('[data-jx]').forEach((b) => b.onclick = () => openParsePanel(currentUrl, b.dataset.jx));
      }
      checkJx();
    } else {
      hidePlayDiagnostic();
      // 播放器依赖（artplayer + hls.js）按需加载，仅首次播放时拉取 chunk
      try {
        art = await createPlayer(artbox, { url: playable(currentUrl), poster: posterCandidates(ag.vod.vod_pic)[0] || PF });
      } catch (loadErr) {
        showPlayDiagnostic('播放器组件加载失败：' + String(loadErr?.message || loadErr).slice(0, 120) + '。可能是网络波动导致播放器脚本未下载完成，请刷新重试。');
        return;
      }
      if (!alive) { try { art.destroy(true); } catch {} return; }
      bindArt(art);
      // 挂载自定义进度条（替代 ArtPlayer 内置进度条，支持拖拽/点击/悬浮时间）
      try {
        if (vpBar) { vpBar.destroy(); vpBar = null; }
        const videoEl = art?.video;
        const oldHost = document.querySelector('.vp-bar-host');
        if (oldHost) oldHost.remove();
        if (videoEl) {
          const shell = view.querySelector('.player-shell');
          const barHost = document.createElement('div');
          barHost.className = 'vp-bar-host';
          shell?.appendChild(barHost);
          vpBar = createVideoBar(videoEl, barHost);
        }
      } catch {};
      playWatchdog = setTimeout(() => {
        const v = art?.video;
        if (alive && v && v.readyState < 2 && !v.error) showPlayDiagnostic('已等待 12 秒仍未取得可播放媒体数据。可能是源站拒绝请求、视频跨域/CORS、Referer 限制、无效 HLS 清单，或当前浏览器不支持该格式。请切换线路并查看下方错误。');
      }, 12000);
      checkJx();
    }
  })();

  const cur = () => ag.plays[p].lines[l].eps[e];

  function renderGroups() {
    const MAX_SHOWN = 3;   // 直显前 3 名（推荐），其余折叠
    const total = ag.plays.length;
    const showAll = total <= MAX_SHOWN || groupsExpanded;
    const visible = showAll ? ag.plays : ag.plays.slice(0, MAX_SHOWN);
    groupsBox.innerHTML = visible.map((pl, pi) => {
      const score = sourceScore(pl.src.id);
      const rankNum = pi + 1;
      const rankBadge = pi < 3 ? `<span class="badge hot">⚡推荐 #${rankNum}</span>` : '';
      const scoreBadge = score >= 70 ? `<span class="badge" style="background:rgba(34,197,94,.15);color:#4ade80">${score}</span>` :
                         score >= 40 ? `<span class="badge" style="background:rgba(234,179,8,.15);color:#facc15">${score}</span>` :
                         `<span class="badge" style="background:rgba(239,68,68,.15);color:#f87171">${score}</span>`;
      return `
      <div class="res-card ${pi === p ? 'on' : ''}">
        <div class="res-head"><span class="res-name">${esc(pl.src.name)}</span>${rankBadge}${scoreBadge}${pl.fromSearch ? '<span class="badge">搜索快取</span>' : ''}${pi === 0 ? '<span class="badge hot">推荐播放</span>' : ''}</div>
        <div class="chips-row">${pl.lines.map((ln, li) => {
          const ep0 = (ln.eps || []).find((x) => x && x.url)?.url || '';
          const pr = ep0 && probeMap ? probeMap.get(ep0) : null;
          const msTxt = pr ? (pr.ok ? `<span class="muted">${pr.ms}ms</span>` : `<span class="muted" title="预检不可达">✕</span>`) : '';
          return `
          <button class="chip ${pi === p && li === l ? 'on' : ''}" data-act="pickline" data-pi="${pi}" data-li="${li}">${esc(ln.name)}<span class="muted">${ln.eps.length}</span>${msTxt}</button>`;
        }).join('')}
        </div>
      </div>`;
    }).join('') + (showAll ? '' : `<button class="btn xs ghost" id="groups-toggle" style="width:100%;margin-top:4px">展开全部 ${total - MAX_SHOWN} 个站点线路（按推荐评分排序）</button>`);
    const toggleBtn = groupsBox.querySelector('#groups-toggle');
    if (toggleBtn) toggleBtn.onclick = () => { groupsExpanded = true; renderGroups(); };
  }
  /* 剧集分批虚拟渲染：超百集剧集（长篇动漫/电视剧）一次渲染全部按钮会
     明显掉帧。默认渲染 1 批（120 集），底部「展开更多」按批追加；集数超过
     一批时出现正/倒序切换；切集后当前集自动滚入可视区域。 */
  const EP_CHUNK = 120;
  let epShown = EP_CHUNK, epDesc = false;
  function renderEps(scrollCur = false) {
    const ln = ag.plays[p].lines[l];
    const total = ln.eps.length;
    epShown = epWindowSize(epDesc ? total - 1 - e : e, epShown, EP_CHUNK, total);
    epsBox.innerHTML = epDisplayOrder(total, epShown, epDesc).map((ei) => {
      const ep = ln.eps[ei];
      return `<button class="ep ${ei === e ? 'on' : ''}${isVipUrl(ep.url) ? ' vip' : ''}" data-act="pickep" data-ei="${ei}" title="${esc(ep.label)}">
        <span>${esc(ep.label.replace(/第|集/g, '') || ep.label)}</span>${isVipUrl(ep.url) ? svg('bolt') : ''}
      </button>`;
    }).join('') + (epShown < total ? `<button class="ep ep-more" data-act="epmore">展开更多 · ${epShown}/${total}</button>` : '');
    const totalEl = view.querySelector('#ep-total');
    if (totalEl) totalEl.textContent = `共 ${total} 集`;
    const orderBtn = view.querySelector('#ep-order');
    if (orderBtn) { orderBtn.hidden = total <= EP_CHUNK; orderBtn.textContent = epDesc ? '正序' : '倒序'; }
    if (scrollCur) epsBox.querySelector('.ep.on')?.scrollIntoView({ block: 'nearest' });
  }
  function bindArt(a) {
    a.on('video:timeupdate', () => {
      saveProg(false);
      // 片尾提前量：距结尾 ≤ outro 秒时触发自动连播（复用倒计时逻辑，仅一次）
      const v = a.video;
      if (skip.enable && skip.outro > 0 && !outroFired && v && isFinite(v.duration) && v.duration > 0) {
        const remain = v.duration - v.currentTime;
        if (remain > 0 && remain <= skip.outro) { outroFired = true; nextEp(); }
      }
    });
    a.on('video:pause', () => saveProg(true));
    a.on('video:ended', nextEp);
    a.on('video:playing', () => { errTries = 0; triedLines.clear(); autoRescanRound = 0; hidePlayDiagnostic(); });
    a.on('video:loadedmetadata', hidePlayDiagnostic);
    a.on('video:error', () => {
      if (!alive || !ag) return;
      const v = a.video;
      const code = v?.error?.code;
      errTries++;
      /* 阶段2：惩罚当前线路（评分记忆减半）+ 智能换线 */
      const curUrl = cur()?.url || '';
      if (curUrl) linePenalty.set(curUrl, (linePenalty.get(curUrl) || 0) + 1);
      if (errTries <= 4 && nextPlayable()) {
        U.toast(`当前线路无法播放，已自动切换（${errTries}/4）`, { type: 'err' });
        return;
      }
      /* 阶段3：三轮重载循环（第1轮零成本重排 → 2/3轮 fresh 重新拉全接口） */
      reloadAllLines(code);
    });
    a.on('video:loadedmetadata', () => {
      if (resumeAt != null) {
        const t = resumeAt, intro = resumeIntro;
        resumeAt = null; resumeIntro = false;
        setTimeout(() => {
          try {
            a.video.currentTime = t;
            U.toast(intro ? `已跳过片头 ${fmtDur(t)}，可在「跳片」中调整` : `已从 ${fmtDur(t)} 处续播`, { timeout: 2200 });
          } catch {}
        }, 300);
      }
    });
  }

  /* 进度记忆：5s 节流写入 + pause/离页 flush，连同剧集进度写入历史 */
  function saveProg(force) {
    if (!ag) return;
    const v = art?.video;
    if (!v || !isFinite(v.duration) || !v.duration) return;
    const now = Date.now();
    if (!force && now - lastSaveAt < 5000) return;
    lastSaveAt = now;
    const ep = cur();
    progressSet(seriesKey, { t: v.currentTime, dur: v.duration, ei: e, pi: p, li: l, srcId: playbackSrcId, vodId: playbackVodId, title: ag.vod.vod_name, thumb: ag.vod.vod_pic });
    // 历史记录补全 标准扩展字段：年份 / 总集数 / 搜索标题 / 播放时长
    addHistory({
      id: 'v:' + playbackSrcId + ':' + playbackVodId, kind: 'vod', srcId: playbackSrcId, vodId: String(playbackVodId),
      title: ag.vod.vod_name, thumb: ag.vod.vod_pic || '', ep: ep.label, ei: e,
      sec: Math.round((Date.now() - epStartAt) / 1000), prog: v.currentTime / v.duration,
      year: ag.vod.vod_year || '', totalEpisodes: (ag.plays[p]?.lines?.[l]?.eps || []).length,
      searchTitle: seriesKey, playTime: Math.round(v.currentTime), totalTime: Math.round(v.duration)
    }).catch(() => {});
  }

  /* 自动连播：同线路下一集 → 换线路 → 本源完结；3s 倒计时可取消 */
  function nextEp() {
    if (!autoNext || !ag) return;
    const line = ag.plays[p].lines[l];
    let np = p, nl = l, ne = e + 1;
    if (ne >= line.eps.length) {
      nl++; ne = 0;
      if (nl >= ag.plays[p].lines.length) { U.toast('本源已全部播放完毕 🎉', { type: 'ok' }); l = 0; e = 0; return; }
    }
    const label = ag.plays[np].lines[nl].eps[ne].label;
    const t = U.toast(`下一集：<b>${esc(label)}</b>（<b class="nx">3</b>s）`, { timeout: 0 });
    const btn = document.createElement('button');
    btn.className = 'btn xs ghost'; btn.textContent = '取消';
    t.el.appendChild(btn);
    let n = 3;
    const iv = setInterval(() => {
      n--;
      const nx = t.el.querySelector('.nx'); if (nx) nx.textContent = n + 's';
      if (n <= 0) { clearInterval(iv); t.kill(); nextCtl = null; switchEpisode(np, nl, ne); }
    }, 1000);
    nextCtl = { kill: () => { clearInterval(iv); t.kill(); nextCtl = null; } };
    btn.onclick = nextCtl.kill;
  }

  function switchEpisode(np, nl, ne, opt = {}) {
    const lineChanged = np !== p || nl !== l;
    p = np; l = nl; e = ne;
    epStartAt = Date.now(); outroFired = false;
    resumeAt = skip.enable && skip.intro > 0 ? skip.intro : null;
    resumeIntro = resumeAt != null;
    // 手动换集/换线视为用户接管：清空自动换线状态。
    if (!opt.auto) { errTries = 0; triedLines.clear(); }
    if (lineChanged) epShown = EP_CHUNK;   // 换线路后从第一批重新展开
    renderGroups(); renderEps(lineChanged);
    swapUrl(art, playable(cur().url));
    // 切集后重建控制栏（视频元素可能已被 ArtPlayer 替换）
    setTimeout(() => {
      try {
        if (vpBar) { vpBar.destroy(); vpBar = null; }
        const oldHost = document.querySelector('.vp-bar-host');
        if (oldHost) oldHost.remove();
        const videoEl = art?.video;
        if (videoEl) {
          const shell = view.querySelector('.player-shell');
          const barHost = document.createElement('div');
          barHost.className = 'vp-bar-host';
          shell?.appendChild(barHost);
          vpBar = createVideoBar(videoEl, barHost);
        }
      } catch {}
    }, 300);
    checkJx();
  }

  /* 播放失败自动换线：先同源下一线路 → 再向后一个源；保持当前集数，跳过分享页线路。
     增强：跳过与失败线路同 CDN 域名的姊妹线（同一故障域不重复试）。 */
  function nextPlayable() {
    if (!ag) return false;
    triedLines.add(p + ':' + l);
    const failedUrl = cur()?.url || '';
    for (let li = l + 1; li < (ag.plays[p]?.lines?.length || 0); li++) {
      if (triedLines.has(p + ':' + li)) continue;
      const u2 = ag.plays[p].lines[li].eps.map((x) => x.url).find(Boolean) || '';
      if (failedUrl && sameCdn(failedUrl, u2)) { triedLines.add(p + ':' + li); continue; }  // 同CDN跳过
      if (jumpTo(p, li)) return true;
    }
    for (let pi = p + 1; pi < ag.plays.length; pi++) {
      for (let li = 0; li < (ag.plays[pi]?.lines?.length || 0); li++) {
        if (triedLines.has(pi + ':' + li)) continue;
        const u2 = ag.plays[pi].lines[li].eps.map((x) => x.url).find(Boolean) || '';
        if (failedUrl && sameCdn(failedUrl, u2)) { triedLines.add(pi + ':' + li); continue; }
        if (jumpTo(pi, li)) return true;
      }
    }
    return false;
  }

  /* ============ 阶段3：三轮重载循环 ============
     第 1 轮：已有线路重排重试（零网络成本）
     第 2 轮：fresh 重新拉全量详情 + 全量预检重排后重试
     第 3 轮：再次 fresh（放宽预检超时），只重试前两轮未试过的线路
     三轮后仍全败：暂停并给出「一键重扫」+ 云解析 + 诊断提示 */
  let reloading = false;
  async function reloadAllLines(code) {
    if (reloading || !alive || !ag) return;
    const labels = { 1: '播放被中止', 2: '网络错误或媒体请求失败', 3: '媒体解码失败', 4: '格式不支持或媒体地址不是可播放文件' };
    if (reloadRound >= 3) {
      // 三轮自愈耗尽 → 自动进入「重新扫描」循环（免手动点击）
      if (autoRescanRound < AUTO_RESCAN_MAX) {
        autoRescanLoop(code);
        return;
      }
      // 最终失败：暂停并提示 
      const noticeBox = view.querySelector('#play-notice');
      if (artbox) artbox.innerHTML = `<div class="empty fade-in" style="min-height:180px"><div class="empty-ico">${svg('alert-triangle')}</div><div class="empty-title">暂无可播放线路</div><div class="empty-sub">请查看下方播放提示中的操作选项</div></div>`;
      if (noticeBox) {
        noticeBox.hidden = false;
        noticeBox.innerHTML = `<div class="notice-head">${svg('alert-triangle', 'hot')} 播放提示 · 已重载 ${reloadRound} 轮仍无可用线路</div>
          <div class="notice-body">${labels[code] || '播放失败'}。已排查全部可用线路仍无法播放。请尝试：</div>
          <div class="retry-row">
            <button class="btn primary" id="rlb-rescan">${svg('refresh')} 重新扫描全部线路</button>
            <button class="btn ghost" id="rlb-parse">${svg('bolt')} 云解析播放</button>
            <button class="btn ghost" data-href="#/sources">${svg('radar')} 数据源体检</button>
          </div>`;
        noticeBox.querySelector('#rlb-rescan').onclick = () => { fullRescan(); };
        noticeBox.querySelector('#rlb-parse')?.addEventListener('click', () => {
          const u = cur()?.url || '';
          if (u) openParsePanel(u);
        });
      }
      return;
    }
    reloading = true;
    reloadRound++;
    const round = reloadRound;
    showPlayDiagnostic(`正在重载线路（第 ${round}/3 轮）…`);
    try {
      if (round === 1) {
        // 第 1 轮：仅重排（未试线路按评分前置），零网络
        ag.plays = rankPlays(ag.plays, probeMap, sourceScore, (u) => linePenalty.get(u) || 0);
        triedLines.clear();   // 按新顺序允许重试
        errTries = 0;
        p = 0; l = 0;
        renderGroups(); renderEps(true);
        if (art) { swapUrl(art, playable(cur().url)); } else { try { createAndPlay(); } catch {} }
      } else {
        // 第 2/3 轮：fresh 重新聚合全部接口 + 全量预检
        const freshAg = await aggregateDetail(srcId, vodId, { fast: true, fresh: true });
        if (!alive || !freshAg) return;
        const playableAgg = (freshAg.plays || []).filter((pl) => Array.isArray(pl.lines) && pl.lines.some((ln) => Array.isArray(ln.eps) && ln.eps.length));
        const cands = [];
        if (round === 2) {
          for (const pl of playableAgg) {
            const ep = (pl.lines || []).flatMap((ln) => ln.eps || []).find((x) => x && /^https?:\/\//i.test(x.url || ''));
            if (ep) cands.push(ep.url);
          }
        } else {
          // 第 3 轮：只测前两轮未见过的线路
          const known = new Set([...triedLines].map((k) => ag.plays?.[+k.split(':')[0]]?.lines?.[+k.split(':')[1]]?.eps.map((x) => x.url).find(Boolean)));
          for (const pl of playableAgg) {
            const ep = (pl.lines || []).flatMap((ln) => ln.eps || []).find((x) => x && /^https?:\/\//i.test(x.url || '') && !known.has(x.url));
            if (ep) cands.push(ep.url);
          }
        }
        const newMap = await probeLines(cands.slice(0, 20), { timeout: round === 3 ? 8000 : 5000 });
        probeMap = newMap;
        rememberPrecheck(precheckKey(srcId, vodId), newMap);
        ag = freshAg;
        ag.plays = rankPlays(playableAgg, newMap, sourceScore, (u) => linePenalty.get(u) || 0);
        if (!ag.plays.length) { showPlayDiagnostic('重载后仍未找到可播放线路。'); return; }
        triedLines.clear();
        errTries = 0;
        p = 0; l = 0;
        renderGroups(); renderEps(true);
        if (art) { swapUrl(art, playable(cur().url)); } else { try { createAndPlay(); } catch {} }
      }
      reloading = false;
    } catch (e) {
      reloading = false;
      if (!alive) return;
      // 本轮重载失败：继续下一轮或最终提示
      setTimeout(() => { if (alive) reloadAllLines(code); }, 1500);
    }
  }

  /* ============ 完整重扫管线（手动「重新扫描全部线路」） ============
     一步到位：fresh 重新聚合全部接口 → 全量预检（≤40条）→ 强制覆盖
     预检缓存 → 重置全部换线状态 → 综合评分重排 → 自动播放新第 1 名。
     真实效果等价于「刷新网页重新获取线路并排序」，但页面状态不丢失。 */
  async function fullRescan({ clearPenalty = true, silent = false } = {}) {
    if (reloading || !alive || !ag) return;
    reloading = true;
    const rescanToast = silent ? null : U.toast('正在重新获取全部线路…', { timeout: 0 });
    try {
      // ① fresh 重新聚合（fast 模式）
      const freshAg = await aggregateDetail(srcId, vodId, { fast: true, fresh: true });
      if (!alive) return;
      /* ①b 等待跨源补充完成（限时 10s）——刷新网页后线路包含跨源 5 源的
         完整集；重扫也必须等齐，否则与手动刷新出现差异 */
      if (freshAg.more && typeof freshAg.more.then === 'function') {
        try {
          const extras = await Promise.race([
            Promise.resolve(freshAg.more).catch(() => []),
            new Promise((r) => setTimeout(() => r([]), 10000)),
          ]);
          const known = new Set((freshAg.plays || []).map((x) => String(x.src?.id)));
          for (const ex of Array.isArray(extras) ? extras : []) {
            if (ex && !known.has(String(ex.src?.id))) { freshAg.plays.push(ex); known.add(String(ex.src?.id)); }
          }
        } catch { /* 跨源补充失败不阻塞主流程 */ }
      }
      // 死链惩罚：自动循环保留惩罚，惩罚≥3 的死链 URL 下轮排除（真正刷新新线路）
      const deadUrls = new Set([...linePenalty.entries()].filter(([, v]) => v >= 3).map(([u]) => u));
      const playableAgg = (freshAg.plays || []).filter((pl) => Array.isArray(pl.lines) && pl.lines.some((ln) => Array.isArray(ln.eps) && ln.eps.length));
      // ② 收集全部线路 URL（优先排除死链；若过滤后为空则退回全量保底）
      let cands = [];
      for (const pl of playableAgg) {
        for (const ln of pl.lines || []) {
          const ep = (ln.eps || []).find((x) => x && /^https?:\/\//i.test(x.url || '') && !deadUrls.has(x.url));
          if (ep) { cands.push(ep.url); break; }
        }
        if (cands.length >= 60) break;
      }
      if (!cands.length) {
        cands = [];
        for (const pl of playableAgg) {
          for (const ln of pl.lines || []) {
            const ep = (ln.eps || []).find((x) => x && /^https?:\/\//i.test(x.url || ''));
            if (ep) { cands.push(ep.url); break; }
          }
          if (cands.length >= 60) break;
        }
      }
      // ③ 全量并行预检
      const newMap = await probeLines(cands, { timeout: 5000 });
      // ④ 强制覆盖预检缓存（关键修复：否则旧预检不刷新）
      rememberPrecheck(precheckKey(srcId, vodId), newMap, true);
      probeMap = newMap;
      // ⑤ 重置状态（手动重扫清惩罚=刷新网页效果；自动循环保留=死链记忆）
      if (clearPenalty) linePenalty.clear();
      ag = freshAg;
      ag.plays = rankPlays(playableAgg, newMap, sourceScore, (u) => linePenalty.get(u) || 0);
      if (!ag.plays.length) {
        showPlayDiagnostic('重新扫描后仍未找到可播放线路。');
        reloading = false;
        return;
      }
      triedLines.clear();
      errTries = 0;
      reloadRound = 0;
      p = 0; l = 0;
      // ⑥⑦ 重排 + 自动播放
      renderGroups(); renderEps(true);
      if (art) { swapUrl(art, playable(cur().url)); } else { try { createAndPlay(); } catch {} }
      const totalLines = ag.plays.reduce((n, pl) => n + (pl.lines || []).reduce((m, ln) => m + (ln.eps || []).length, 0), 0);
      if (!silent) U.toast(`已重新扫描全部线路 · 聚合 ${ag.plays.length} 个站点 · 共 ${totalLines} 条线路`, { type: 'ok', timeout: 2500 });
      else showPlayDiagnostic(`已重新扫描：${ag.plays.length} 个站点 · ${totalLines} 条线路，自动重试中`);
      reloading = false;
    } catch (e) {
      reloading = false;
      try { rescanToast?.kill?.(); } catch {}
      if (!alive) return;
      showPlayDiagnostic('重新扫描失败：' + String(e?.message || e).slice(0, 120) + '。可稍后再次点击重扫。');
    }
  }

  /* ============ 自动重扫循环（思路①：全败自动刷新重试） ============ */
  async function autoRescanLoop(code) {
    if (!alive || !ag || reloading) return;
    autoRescanRound++;
    const r = autoRescanRound;
    showPlayDiagnostic(`线路全部不可用，自动重新扫描全部线路（${r}/${AUTO_RESCAN_MAX}）…`);
    // 指数退避：2s → 4s → 6s，避免打爆源站
    await new Promise((res) => setTimeout(res, 2000 * r));
    if (!alive) return;
    try { await fullRescan({ clearPenalty: false, silent: true }); }
    catch { /* fullRescan 内部已处理诊断 */ }
  }
  /* 测试/调试钩子（无业务影响，供无头浏览器与排障调用） */
  try { window.__cmRescan = fullRescan; } catch {}

  /* 提取播放器创建+绑定（重载后无需重复定义） */
  async function createAndPlay() {
    const currentUrl = cur()?.url || '';
    if (!/^https?:\/\//i.test(currentUrl)) return;
    art = await createPlayer(artbox, { url: playable(currentUrl), poster: posterCandidates(ag.vod.vod_pic)[0] || PF });
    if (alive) bindArt(art);
  }
  function jumpTo(np, nl) {
    if (np === p && nl === l) return false;
    const line = ag.plays[np]?.lines?.[nl];
    if (!line || !line.eps?.length) return false;
    const curEp = cur();
    let ne = e;
    const n0 = epNum(curEp.label);
    if (n0 != null) { const hit = line.eps.findIndex((x) => epNum(x.label) === n0); if (hit >= 0) ne = hit; }
    ne = Math.max(0, Math.min(ne, line.eps.length - 1));
    const u = line.eps[ne]?.url || '';
    // 分享页/网页地址不喂给播放器，直接标记再找下一条。
    if (isPageUrl(u) || looksLikePage(u)) { triedLines.add(np + ':' + nl); return false; }
    switchEpisode(np, nl, ne, { auto: true });
    return true;
  }
  onAct('pickep', (b) => { if (nextCtl) { nextCtl.kill(); nextCtl = null; } switchEpisode(p, l, +b.dataset.ei); });
  onAct('epmore', () => { epShown += EP_CHUNK; renderEps(); });
  onAct('pickline', (b) => switchEpisode(+b.dataset.pi, +b.dataset.li, 0));

  /* 本集换源测速：跨站同名集 Range 首包探测排序，点击即切换 */
  async function speedTest() {
    if (!ag) return;
    const curE = cur();
    const n0 = epNum(curE.label);
    const cands = [];
    ag.plays.forEach((pl, pi) => pl.lines.forEach((ln, li) => ln.eps.forEach((ep, ei) => {
      const en = epNum(ep.label);
      if (en == null || n0 == null || en === n0) cands.push({ ...ep, pi, li, ei, src: pl.src.name, line: ln.name });
    })));
    const list = cands.slice(0, 12);
    const m = U.modal(`<div class="modal-body"><div class="modal-title">${svg('bolt', 'hot')} 本集换源测速 <span class="muted">Range 首包探测</span></div>
      <div id="sp-list"><div class="pdot"></div> 正在并行探测 ${list.length} 个地址…</div>
      <div class="modal-ft"><button class="btn ghost" id="sp-no">关闭</button></div></div>`);
    m.el.querySelector('#sp-no').onclick = m.close;
    const rows = await Promise.all(list.map(async (c) => ({ ...c, s: await probeUrl(playable(c.url)) })));
    rows.sort((a, b) => (a.s.ok ? a.s.ms : 99999) - (b.s.ok ? b.s.ms : 99999));
    m.el.querySelector('#sp-list').innerHTML = rows.map((r, i) => `
      <div class="sp-row" data-pi="${r.pi}" data-li="${r.li}" data-ei="${r.ei}">
        <span class="sp-rank">${i + 1}</span>
        <span class="sp-name">${esc(r.src)} · ${esc(r.line)} · ${esc(r.label)}</span>
        <span class="sp-ms ${r.s.ok ? (r.s.ms < 1000 ? 'ok' : 'warn') : 'err'}">${r.s.ok ? r.s.ms + 'ms' : '不可直连'}</span>
      </div>`).join('');
    m.el.querySelectorAll('.sp-row').forEach((row) => { row.classList.add('clickable'); row.onclick = () => { m.close(); switchEpisode(+row.dataset.pi, +row.dataset.li, +row.dataset.ei); }; });
  }

  /* VIP 地址 → 云解析线路条 */
  function checkJx() {
    const bx = view.querySelector('#jx-line');
    const ep = cur();
    if (!isVipUrl(ep.url)) { bx.hidden = true; return; }
    bx.hidden = false;
    bx.innerHTML = `<div class="jx-t">${svg('bolt', 'hot')} 检测到 VIP 平台页面地址，可使用点播解析源在线播放</div><div class="chips-wrap">${state.settings.jiexiSources.map((j) => `<button class="chip" data-jx="${j.id}">${esc(j.name)}<span class="jx-ms" data-jxms="${j.id}">…</span></button>`).join('')}</div>`;
    bx.querySelectorAll('[data-jx]').forEach((b) => b.onclick = () => openParsePanel(ep.url, b.dataset.jx));
    // 仅在确实展示云解析线路时才探测延迟（此前进入播放页会无条件 ping 全部 9 个解析源）
    state.settings.jiexiSources.forEach((j) => pingJiexi(j).then((r) => {
      const el2 = bx.querySelector(`[data-jxms="${j.id}"]`); if (el2) el2.textContent = r.ok ? r.ms + 'ms' : '不可达';
    }));
  }

  /* 片头片尾跳过设置（按片名记忆，仅存本地） */
  function openSkipConfig() {
    const m = U.modal(`<div class="modal-body">
      <div class="modal-title">${svg('gear')} 片头片尾跳过 <span class="muted">· ${esc(seriesKey || '当前影片')}</span></div>
      <label class="field row"><span>启用自动跳过</span><input type="checkbox" class="switch" id="sk-en" ${skip.enable ? 'checked' : ''}></label>
      <label class="field"><span>片头跳过（秒，0 表示不跳过）</span><input id="sk-intro" class="input" type="number" min="0" max="600" step="1" value="${skip.intro || 0}"></label>
      <label class="field"><span>片尾提前（秒，0 表示不跳过，配合自动连播）</span><input id="sk-outro" class="input" type="number" min="0" max="600" step="1" value="${skip.outro || 0}"></label>
      <p class="muted" style="font-size:12px">对整部剧生效：片头从每集开头快进；接近片尾时自动进入下一集倒计时。配置保存在本机。</p>
      <div class="modal-ft"><button class="btn ghost" id="sk-no">取消</button><button class="btn primary" id="sk-ok">保存</button></div></div>`);
    m.el.querySelector('#sk-no').onclick = m.close;
    m.el.querySelector('#sk-ok').onclick = () => {
      const intro = Math.max(0, Math.min(600, Math.round(+m.el.querySelector('#sk-intro').value || 0)));
      const outro = Math.max(0, Math.min(600, Math.round(+m.el.querySelector('#sk-outro').value || 0)));
      skip = { enable: m.el.querySelector('#sk-en').checked, intro, outro };
      skipSet(seriesKey, skip).catch(() => {});
      outroFired = false;
      m.close();
      U.toast(skip.enable ? (intro || outro ? '片头片尾跳过已启用，下集起生效' : '跳过已关闭') : '片头片尾跳过已关闭', { type: 'ok' });
    };
  }

  return () => {                 // 路由离开：flush 进度 + 销毁播放器
    alive = false;
    clearTimeout(playWatchdog);
    if (nextCtl) nextCtl.kill();
    try { if (vpBar) { vpBar.destroy(); vpBar = null; } } catch {}
    try { if (art) { saveProg(true); destroyHls(art); art.destroy(true); } } catch {}
    art = null;
  };
});

/* ============================ 独立解析页 ============================ */
onRoute('parse', (view, segs, query) => {
  view.innerHTML = `<div class="page slim">
    <div class="sec-head"><h2>${svg('bolt', 'hot')} 在线解析</h2></div>
    <div class="search-big glass liquid" data-spot>${svg('link', 'ico-lg')}<input id="jx-url" placeholder="粘贴任意视频页面地址（腾讯/爱奇艺/优酷/芒果/B站…）"><button class="btn primary" id="jx-go">开始解析</button></div>
    <div class="set-card glass" style="margin-top:18px">
      <div class="set-t">点播解析源 <button class="btn xs ghost" id="jx-test">${svg('refresh')} 全部测速</button></div>
      <div class="jx-grid">${state.settings.jiexiSources.map((j) => `<button class="jx-item" data-jxid="${j.id}"><span class="jx-name">${esc(j.name)}</span><span class="jx-ms" data-ms="${j.id}">…</span></button>`).join('')}</div>
      <p class="muted" style="font-size:12px">点击卡片即用该源解析。所有解析源均为第三方公开接口，本站仅转发播放地址，不存储任何视频内容。</p>
    </div></div>`;
  const urlI = view.querySelector('#jx-url');
  const go = (jxid) => {
    const u = urlI.value.trim();
    if (!/^https?:/.test(u)) return U.toast('请输入 http(s) 开头的视频页地址', { type: 'err' });
    openParsePanel(u, jxid);
  };
  view.querySelector('#jx-go').onclick = () => go();
  urlI.addEventListener('keydown', (ev) => ev.key === 'Enter' && go());
  // 从历史/收藏跳转时携带 ?url=：预填并自动打开对应解析面板（恢复上次的解析观看）。
  const pre = String(query?.url || '').trim();
  if (pre && /^https?:/i.test(pre)) { urlI.value = pre; setTimeout(() => { if (urlI.value === pre) go(); }, 260); }
  const update = (j) => pingJiexi(j, { force: true }).then((r) => { const el2 = view.querySelector(`[data-ms="${j.id}"]`); if (el2) el2.textContent = r.ok ? r.ms + 'ms' : '超时'; });
  view.querySelector('#jx-test').onclick = () => state.settings.jiexiSources.forEach(update);
  state.settings.jiexiSources.forEach((j) => pingJiexi(j).then((r) => { const el2 = view.querySelector(`[data-ms="${j.id}"]`); if (el2) el2.textContent = r.ok ? r.ms + 'ms' : '超时'; }));
  view.querySelectorAll('[data-jxid]').forEach((b) => b.onclick = () => go(b.dataset.jxid));
});
