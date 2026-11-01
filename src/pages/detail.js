import { onRoute, goto } from '../core/router.js';
import { state, saveSettings } from '../core/state.js';
import { aggregateDetail, getList, sourceScore } from '../api/cms.js';
import { progressGet, posterBlob } from '../core/db.js';
import { U, svg, posterCard, posterImg, empty, onAct } from '../ui/ui.js';
import { buildPosterChainRelayed } from '../api/posters.js';
import { detectRelay } from '../api/adapters.js';
import { esc, normalizeTitle, copyText, PF, posterCandidates } from '../core/utils.js';
import { probeLines, recallPrecheck, rememberPrecheck, precheckKey, rankPlays } from '../api/lineprobe.js';

onRoute('v', (view, segs) => {
  const [, srcId, vodId] = segs;
  let alive = true;
  view.innerHTML = `<div class="page slim">
    <div class="detail-bg"><img id="dbg" class="hero-img" src="${PF}"><div class="hero-veil"></div></div>
    <div class="detail load" id="dbox"><div class="load-logo"></div><div class="load-text">正在聚合详情（含跨源资源）…</div></div>
    <div id="rel"></div></div>`;

  (async () => {
    let ag = null;

    /* V30 智能重试算法（利用接口间歇性抖动，替代整页刷新）：
       - 指数退避：1.2s → 2.5s → 4s → 6s，最多 4 次
       - 页面不刷新，加载区实时显示重试进度
       - 401/403/404 类权限/不存在错误不重试（重试也无意义）
       - 用户离开页面（alive=false）立即停止 */
    const MAX_RETRY = 4;
    const BACKOFF = [1200, 2500, 4000, 6000];
    const dbox = view.querySelector('#dbox');
    const isRetryable = (e) => !/401|403|404|认证|授权|不存在|不匹配|找不到/.test(String(e?.message || ''));
    const showRetrying = (attempt) => {
      if (!alive || !dbox) return;
      dbox.innerHTML = `<div class="load-logo"></div><div class="load-text">接口繁忙，自动重试中（${attempt}/${MAX_RETRY}）…</div>`;
    };

    for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
      try {
        ag = await aggregateDetail(srcId, vodId, { fast: true });
        break; // 成功，跳出重试链
      } catch (e) {
        if (!alive) return;
        if (!isRetryable(e) || attempt === MAX_RETRY) {
          if (dbox) dbox.innerHTML = empty('radar', '详情加载失败', '该资源可能已下架或源站持续不可用，返回重试或到「数据源」页更换源');
          return;
        }
        showRetrying(attempt + 1);
        await new Promise((r) => setTimeout(r, BACKOFF[attempt]));
      }
    }
    if (!ag || !alive) return;
    const vod = ag.vod;
    const bg = view.querySelector('#dbg');
    bg.src = posterCandidates(vod.vod_pic)[0] || PF;
    posterBlob(vod.vod_pic).then((u) => { if (alive && u !== vod.vod_pic) bg.src = u; }).catch(() => {});
    const fav = (state.settings.favs || []).find((f) => f.srcId === srcId && String(f.vodId) === String(vodId));
    const seriesKey = normalizeTitle(vod.vod_name) + (vod.vod_year ? ':' + vod.vod_year : '');
    const prog = await progressGet(seriesKey);
    const playable = (ag.plays || []).filter((p) => (p.lines || []).some((ln) => (ln.eps || []).length));
    const ep0 = playable[0]?.lines?.[0];
    // 跨源海报池：同片在其他源/页面缓存里的封面互为候选
    const posterPool = [...new Set([vod.vod_pic, ...(ag.plays || []).map((p) => p.vod?.vod_pic)].filter(Boolean))];
    const relayOk = await detectRelay();
    const chain = buildPosterChainRelayed(vod.vod_pic, posterPool.slice(1, 5), relayOk);

    // 线路区渲染函数：主源先渲染，跨源补充到达后增量重绘（V29c）
    const paintResGroups = () => {
      const playableNow = (ag.plays || []).filter((p) => (p.lines || []).some((ln) => (ln.eps || []).length));
      const box = view.querySelector('#res-groups');
      const cntEl = view.querySelector('#res-count');
      if (cntEl) cntEl.textContent = `${playableNow.length} 个站点命中同名影片`;
      const probeMap = recallPrecheck(precheckKey(srcId, vodId));
      if (box) box.innerHTML = playableNow.map((p, pi) => {
        // V35 线路状态点：预检结果绿可播/灰未测/红不可播
        const firstUrl = (p.lines || []).map((ln) => (ln.eps || []).find((e) => e?.url)?.url || '').find(Boolean) || '';
        const pr = firstUrl && probeMap ? probeMap.get(firstUrl) : null;
        const dotCls = pr ? (pr.ok ? 'd-healthy' : 'd-down') : 'd-unknown';
        const dotTitle = pr ? (pr.ok ? `预检通过 · ${pr.ms}ms` : '预检不可达') : '等待预检';
        return `
            <div class="res-card ${pi === 0 ? 'on' : ''}" data-act="play" data-pi="${pi}" data-li="0" data-ei="0">
              <div class="res-head"><span class="health-dot ${dotCls}" title="${esc(dotTitle)}"></span><span class="res-name">${esc(p.src.name)}</span>${p.fromSearch ? '<span class="badge">搜索快取</span>' : ''}<span class="muted">${p.lines.map((ln) => `${esc(ln.name)}(${ln.eps.length})`).join(' · ')}</span>${pi === 0 ? '<span class="badge hot">主源</span>' : ''}</div>
              <button class="btn xs primary">${svg('play')} 用此站播放</button>
            </div>`;
      }).join('');
      return playableNow;
    };

    view.querySelector('#dbox').innerHTML = `
      <div class="detail-post">${posterImg(vod.vod_pic, { lazy: false, chain, smart: { n: vod.vod_name, y: vod.vod_year, t: vod.type_name } })}
        ${vod.vod_remarks ? `<span class="card-tag">${esc(vod.vod_remarks)}</span>` : ''}</div>
      <div class="detail-main">
        <h1 class="detail-title">${esc(vod.vod_name)}</h1>
        <div class="detail-meta">${[vod.vod_year, vod.vod_area, vod.vod_lang, vod.type_name || vod.vod_class, vod.vod_score ? '评分 ' + esc(vod.vod_score) : ''].filter(Boolean).map((x) => `<span class="badge">${esc(x)}</span>`).join('')}</div>
        <div class="detail-actions">
          <button class="btn primary lg" data-act="play" data-pi="0" data-li="0" data-ei="0" ${ep0 ? '' : 'disabled'}>${svg('play')} ${ep0 ? `立即播放（共 ${ep0.eps.length} 集）` : '暂无可用播放地址'}</button>
          <button class="btn ghost lg" data-act="fav">${svg('heart', fav ? 'fill' : '')} ${fav ? '已收藏' : '收藏'}</button>
          <button class="btn ghost lg" data-act="share">${svg('copy')} 复制链接</button>
        </div>
        ${prog && prog.ei != null ? `<div class="resume-bar"><span>${svg('clock')} 上次看到 第 ${prog.ei + 1} 集 · ${((prog.t || 0) / 60) | 0} 分钟处</span><button class="btn xs primary" data-act="resume" data-ei="${prog.ei}">${svg('play')} 继续观看</button></div>` : ''}
        <div class="res-sect"><div class="sect-t">${svg('radar', 'hot')} 资源聚合 <span class="muted" id="res-count">${playable.length} 个站点命中同名影片</span></div>
          <div id="res-groups"></div></div>
        <div class="detail-syn" id="syn">${esc(vod.vod_content || '暂无简介')}</div>
        <button class="btn xs ghost" data-act="more">${svg('chevD')} 展开简介</button>
      </div>`;
    view.querySelector('#dbox').classList.remove('load');
    // 首次渲染线路区
    paintResGroups();

    /* ---- V35 阶段0 详情页预热：后台静默预检每源首条直链（6并发，约2-3s） ----
       结果跨页面缓存，播放页点击即用；预检完成刷新线路状态点。 */
    const warmupProbe = async () => {
      if (!alive) return;
      if (recallPrecheck(precheckKey(srcId, vodId))) return;   // 5 分钟内测过，跳过
      const candidates = [];
      for (const pl of ag.plays || []) {
        for (const ln of pl.lines || []) {
          const ep = (ln.eps || []).find((e) => e && /^https?:\/\//i.test(e.url || ''));
          if (ep) { candidates.push(ep.url); break; }        // 每源只测 1 条首线
        }
      }
      if (!candidates.length) return;
      let map = await probeLines(candidates.slice(0, 15), { timeout: 5000 });
      if (!alive) return;
      // V98 思路②：预热发现线路全部不可达 → 自动 fresh 重拉详情 + 重预检（最多 2 轮，后台静默）
      const allDown = candidates.length > 0 && [...map.values()].every((v) => v && !v.ok);
      if (allDown) {
        for (let round = 1; round <= 2 && alive; round++) {
          try {
            const retryAg = await aggregateDetail(srcId, vodId, { fast: true, fresh: true });
            if (!alive || !retryAg) break;
            // 合并跨源补充
            if (retryAg.more && typeof retryAg.more.then === 'function') {
              const extras = await Promise.race([
                Promise.resolve(retryAg.more).catch(() => []),
                new Promise((r) => setTimeout(() => r([]), 8000)),
              ]);
              const known = new Set((retryAg.plays || []).map((x) => String(x.src?.id)));
              for (const ex of Array.isArray(extras) ? extras : []) {
                if (ex && !known.has(String(ex.src?.id))) { retryAg.plays.push(ex); known.add(String(ex.src?.id)); }
              }
            }
            const retryCands = [];
            for (const pl of retryAg.plays || []) {
              for (const ln of pl.lines || []) {
                const ep = (ln.eps || []).find((e) => e && /^https?:\/\//i.test(e.url || ''));
                if (ep) { retryCands.push(ep.url); break; }
              }
            }
            if (!retryCands.length) break;
            map = await probeLines(retryCands.slice(0, 20), { timeout: 5000 });
            const anyOk = [...map.values()].some((v) => v && v.ok);
            if (anyOk) {
              // 发现新可用线路：接管数据
              ag.plays.push(...retryAg.plays.filter((p) => !ag.plays.some((x) => String(x.src?.id) === String(p.src?.id))));
              ag.plays = rankPlays(ag.plays, map, sourceScore, () => 0);
              if (alive) U.toast(`线路预热完成 · 自动重扫发现 ${retryAg.plays.length} 个站点`, { type: 'ok', timeout: 2500 });
              break;
            }
          } catch { /* 本轮重试失败，继续下一轮 */ }
        }
      }
      rememberPrecheck(precheckKey(srcId, vodId), map, true);   // 强制覆盖（预热完成最新数据）
      paintResGroups();   // 状态点刷新
    };
    // 预热延迟 600ms：等首屏渲染与主图开始加载，避免抢占刚需带宽
    setTimeout(warmupProbe, 600);

    // V29c：跨源补充后台到达后，增量合并并重绘线路区（不刷新主内容）
    if (ag.more && typeof ag.more.then === 'function') {
      ag.more.then((extras) => {
        if (!alive || !Array.isArray(extras) || !extras.length) return;
        const known = new Set((ag.plays || []).map((p) => String(p.src.id)));
        let added = 0;
        for (const ex of extras) {
          if (!known.has(String(ex.src.id))) { ag.plays.push(ex); known.add(String(ex.src.id)); added++; }
        }
        if (added) {
          paintResGroups();
          U.toast(`已补充 ${added} 个同源站点线路`, { type: 'ok', timeout: 2000 });
        }
      }).catch(() => {});
    }

    // 相关推荐：同分类随机页，排除自身
    // V14 修复：无可用线路时 ag.plays 为空，原写法 ag.plays[0].src 直接抛 TypeError
    const relSrc = ag.plays?.[0]?.src;
    if (relSrc) getList(relSrc, { pg: 1 + ((Math.random() * 3) | 0), t: vod.type_id, h: 24 * 30, fresh: true })
      .then((r) => {
        if (!alive) return;
        const list = (r.list || []).filter((v) => normalizeTitle(v.vod_name) !== ag.key).slice(0, 12);
        if (list.length) view.querySelector('#rel').innerHTML = `<section class="section"><div class="sec-head"><h2>相关推荐</h2></div><div class="grid">${list.map((v, i) => posterCard({ ...v, srcId: r.__id }, i)).join('')}</div></section>`;
      }).catch(() => {});

    // V14：ACTS 注册表现在随路由切换清空；慢加载跨页返回时不允许再注册本页闭包
    if (!alive) return;
    onAct('resume', (b) => goto(`#/play/${encodeURIComponent(srcId)}/${encodeURIComponent(vodId)}?p=0&l=0&e=${b.dataset.ei}`));
    onAct('play', (b) => {
      // V32 修复：实时从 ag.plays 计算（跨源补充到达后按钮状态正确刷新）
      const playableNow = (ag.plays || []).filter((p) => (p.lines || []).some((ln) => (ln.eps || []).length));
      if (b.disabled || !playableNow.length) return U.toast('该影片暂无可用播放地址，请切换数据源', { type: 'err' });
      // 路由始终使用影片的真实主源 ID；跨源线路切换由播放页内部处理。
      goto(`#/play/${encodeURIComponent(srcId)}/${encodeURIComponent(vodId)}?p=${b.dataset.pi || 0}&l=${b.dataset.li || 0}&e=${b.dataset.ei || 0}`);
    });
    onAct('share', () => { copyText(location.href); U.toast('链接已复制到剪贴板', { type: 'ok' }); });
    onAct('fav', () => {
      const fs = state.settings.favs || [];
      const hit = fs.find((f) => f.srcId === srcId && String(f.vodId) === String(vodId));
      state.settings.favs = hit ? fs.filter((f) => f !== hit) : [...fs, { srcId, vodId: String(vodId), title: vod.vod_name, thumb: vod.vod_pic, t: Date.now() }];
      saveSettings(); U.toast(hit ? '已取消收藏' : '已加入收藏', { type: 'ok' });
      const btn = view.querySelector('[data-act=fav]');
      btn.innerHTML = `${svg('heart', hit ? '' : 'fill')} ${hit ? '收藏' : '已收藏'}`;
    });
    onAct('more', () => {
      const s = view.querySelector('#syn'); s.classList.toggle('open');
      view.querySelector('[data-act=more]').innerHTML = s.classList.contains('open') ? `${svg('chevU')} 收起简介` : `${svg('chevD')} 展开简介`;
    });
  })();
  return () => { alive = false; };
});
