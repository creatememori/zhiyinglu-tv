import { onRoute } from '../core/router.js';
import { state, cmsSources, saveSettings } from '../core/state.js';
import { getList, checkAll, mergeSearchHits, activeSources } from '../api/cms.js';
import { detectRelay } from '../api/adapters.js';
import { relayImageUrl } from '../api/posters.js';
import { buildPosterChainRelayed, coverPoster, posterImageSrc, mirrorCandidates } from '../api/posters.js';
import { listHistory } from '../core/db.js';
import { U, svg, posterCard, posterImg, skeleton, empty } from '../ui/ui.js';
import { esc, shuffle, timeAgo, PF } from '../core/utils.js';
import { CC_TYPES } from '../api/sources.js';

onRoute('home', (view) => {
  view.innerHTML = `
    <div class="page home-page">
      <div class="hero" id="hx">${skeleton(1)}</div>
      <section class="section home-categories" id="home-categories"><div class="sec-head"><h2>${svg('grid', 'hot')} 快速分类</h2><span class="sec-sub">按兴趣开始探索</span></div><div class="home-category-grid">${CC_TYPES.map(([id, name], i) => `<a class="home-category-tile cat-tone-${i}" data-href="#/cat?t=${id}&n=${encodeURIComponent(name)}"><span class="home-category-icon">${[svg('clapperboard'),svg('tv'),svg('mic'),svg('sparkles')][i]}</span><span class="home-category-name">${name}</span><span class="home-category-sub">发现更多${name}</span><span class="home-category-arrow">${svg('chevR')}</span></a>`).join('')}</div></section>
      <section class="section" id="sx-resume"></section>
      <section class="section home-section-hot"><div class="sec-head"><h2>${svg('flame', 'hot')} 热门榜单</h2><span class="sec-sub">全站热度参考</span></div><div id="popular-zone">${skeleton(6)}</div></section>
      <section class="section"><div class="sec-head"><h2>${svg('clock', 'hot')} 今日更新</h2><span class="sec-sub" id="src-name">正在聚合数据源…</span></div><div id="today-zone">${skeleton(12)}</div></section>
      <section class="section home-recommend"><div class="sec-head"><h2>${svg('wand', 'hot')} 为你推荐</h2><button class="btn xs ghost" id="rx">${svg('refresh')} 换一批</button></div><p class="home-section-note">根据当前可用片源随机组合，每次都能发现不一样的内容</p><div id="hot-zone">${skeleton(6)}</div></section>
      <section class="section home-douban" id="sx-douban" style="display:none"><div class="sec-head"><h2>${svg('sparkles', 'hot')} 豆瓣精选 <span class="badge hot">NEW</span></h2><button class="btn xs ghost" id="sx-douban-refresh">${svg('refresh')} 换一批</button></div><p class="home-section-note">服务端直连豆瓣公开接口（缓存 10 分钟），点击影片名可在站内搜索</p><div id="douban-zone"></div></section>
      <section class="section home-discover"><div class="sec-head"><h2>${svg('compass', 'hot')} 发现更多</h2><span class="sec-sub">按影片类型继续浏览</span></div><div class="chips-row home-type-chips">${CC_TYPES.map(([id, name]) => `<a class="chip" data-href="#/cat?t=${id}&n=${encodeURIComponent(name)}">${name} ${svg('chevR')}</a>`).join('')}</div></section>
    </div>`;

  let heroTimer = null, alive = true, merged = [], srcCount = 0;
  let lastSig = '', heroSig = '';          // V14 渲染去重签名（见 loadFeed）
  const heroState = { i: 0 };              // 轮播当前停留位置，重绘时保留
  // V16：近 2h 判定 down 的源自动暂停本轮聚合（TTL 思路），全部暂停时退回全量
  const allCount = cmsSources().length;
  const srcs = activeSources(cmsSources());
  const pausedCount = allCount - srcs.length;
  // V18 修复：relayOk 原为 loadFeed 内局部变量，却被同屏的 fill/renderHero/fillPopular
  // 引用 → ReferenceError，卡片永不渲染。提升到本路由作用域。
  let relayOk = false;

  if (!srcs.length) {
    view.querySelector('#hx').innerHTML = `
      <div class="empty"><div class="empty-ico">${svg('radar')}</div>
      <div class="empty-title">还没有可用数据源</div>
      <div class="empty-sub">已内置 12 个 API 候选（其中 2 个非标准接口默认停用），可在「数据源」页检查状态</div>
      <div class="retry-row"><button class="btn primary" data-href="#/sources">${svg('radar')} 前往数据源</button></div></div>`;
    view.querySelector('#today-zone').closest('section').style.display = 'none';
    view.querySelector('#hot-zone').closest('section').style.display = 'none';
    view.querySelector('#popular-zone').closest('section').style.display = 'none';
  } else {
    loadFeed();
  }

  /* V33 豆瓣精选（ douban.ts 推荐能力）：
     服务端 /api/recommend 直连豆瓣（规避 CORS + 10min 缓存）。
     加载失败静默隐藏区块，不阻塞首页主链路。 */
  let doubanType = Math.random() < 0.5 ? 'movie' : 'tv';
  let recommendTaken = false;      // V101 为你推荐：豆瓣热门是否已接管
  let recommendOk = false;         // 豆瓣热门是否成功加载
  async function loadDouban(fresh = false) {
    const zone = view.querySelector('#douban-zone');
    const section = view.querySelector('#sx-douban');
    if (!zone || !alive) return;
    zone.innerHTML = skeleton(6);
    try {
      const { fetchRecommend } = await import('../api/recommend.js');
      const items = await fetchRecommend({ type: doubanType, tag: '热门', start: 0, limit: 12, fresh });
      if (!alive || !items.length) { if (section) section.style.display = 'none'; return; }
      const gridCls = items.length <= 6 ? 'grid' : 'rail';
      const doubanImg = (src, title) => {
        if (!src) return '';
        // V35 修复：豆瓣图床主源必须走 CM 公共镜像（原链无 Referer 必 418），
        // 竞速链兜 weserv/wsrv/反代，data-fb 提供最终降级（看门狗可推进）
        const primary = posterImageSrc('douban', src);      // 自动选 CM 镜像
        const cands = [primary, ...mirrorCandidates(src).filter((u) => u !== primary)];
        const uniq = [...new Set(cands)].slice(0, 5);
        const first = uniq[0];
        const race = uniq.length > 1 ? ` data-race='${esc(JSON.stringify(uniq.slice(1)))}'` : '';
        const fb = ` data-fb='${esc(JSON.stringify([...uniq.slice(1), relayImageUrl(src), PF]))}'`;
        // V35 修复：豆瓣精选区块数据量小（≤12 张），取消懒加载避免视口外永不加载
        return `<img src="${esc(first)}" decoding="async" referrerpolicy="no-referrer"${race}${fb} alt="${esc(title)}">`;
      };
      zone.innerHTML = `<div class="${gridCls}">${items.map((it) => `
        <a class="card" data-href="#/search?wd=${encodeURIComponent(it.title)}" title="${esc(it.title)}">
          <div class="card-img" style="aspect-ratio:auto;min-height:150px">${doubanImg(it.cover, it.title)}</div>
          <div class="card-body"><div class="card-title">${esc(it.title)}</div>
          <div class="card-meta">${it.rating ? '豆瓣 ' + esc(it.rating) + ' 分 · ' : ''}${it.isTv ? '剧集' : '电影'} · 点击搜索</div></div>
        </a>`).join('')}</div>`;
      section.style.display = '';
    } catch { if (section) section.style.display = 'none'; }
  }
  loadDouban(false);
  view.querySelector('#sx-douban-refresh').onclick = () => {
    doubanType = doubanType === 'movie' ? 'tv' : 'movie';   // 切换类型换一批
    loadDouban(true);
  };

  /* V101 为你推荐升级：豆瓣热门（点击站内搜索）+ 源站随机兜底 */
  async function loadDoubanRecommend(fresh = false) {
    const zone = view.querySelector('#hot-zone');
    if (!zone || !alive) return;
    recommendTaken = true;
    if (!fresh) zone.innerHTML = skeleton(6);
    try {
      const { fetchRecommend } = await import('../api/recommend.js');
      const items = await fetchRecommend({ type: 'movie', tag: '热门', start: Math.floor(Math.random() * 3) * 12, limit: 12, fresh: fresh || recommendOk });
      if (!alive) return;
      if (Array.isArray(items) && items.length) {
        const doubanImg = (src, title) => {
          if (!src) return '';
          const cands = mirrorCandidates(src);
          const uniq = [...new Set(cands)].slice(0, 5);
          const first = uniq[0];
          const race = uniq.length > 1 ? ` data-race='${esc(JSON.stringify(uniq.slice(1)))}'` : '';
          const fb = ` data-fb='${esc(JSON.stringify([...uniq.slice(1), relayImageUrl(src), PF]))}'`;
          return `<img src="${esc(first)}" decoding="async" referrerpolicy="no-referrer"${race}${fb} alt="${esc(title)}">`;
        };
        zone.innerHTML = `<div class="rail">${items.map((it) => `
          <a class="card" data-href="#/search?wd=${encodeURIComponent(it.title)}" title="${esc(it.title)}">
            <div class="card-img">${doubanImg(it.cover, it.title)}</div>
            <div class="card-body"><div class="card-title">${esc(it.title)}</div>
            <div class="card-meta">${it.rating ? '豆瓣 ' + esc(it.rating) + ' 分 · ' : ''}点击站内搜索</div></div>
          </a>`).join('')}</div>`;
        recommendOk = true;
        return;
      }
    } catch {}
    recommendOk = false;
    // 豆瓣失败 → 源站随机兜底（原有逻辑）
    try { fill(zone, buildRecommendations(merged).slice(0, 12), 'recommend'); } catch {}
  }

  /* V34 多源高分榜单（ 豆瓣周榜思路 + 10 题材聚合）：
     服务端 /api/hotboard 并行聚合豆瓣 10 个题材高分榜、评分降序。
     成功则升级「热门榜单」区块为聚合榜（显示豆瓣评分/题材/地区）；
     失败静默保留源站热度榜（原有逻辑不受影响）。 */
  async function loadHotboard() {
    const zone = view.querySelector('#popular-zone');
    if (!zone || !alive) return;
    try {
      const { fetchHotboard } = await import('../api/hotboard.js');
      const items = await fetchHotboard({ limit: 8 });
      if (!alive || !Array.isArray(items) || !items.length) return;
      const ranked = items.slice(0, 8);
      const mirror = (u) => {   // 豆瓣图床 → 公共 CDN 镜像（无中继也能出图）
        try {
          const url = new URL(String(u));
          if (/doubanio\.com/.test(url.hostname)) {
            const m1 = new URL(`https://img.doubanio.cmliussss.net${url.pathname}`);
            return m1.href;
          }
        } catch {}
        return u;
      };
      const posterImgOf = (it) => {
        // V35 竞速镜像链：CM 镜像 → weserv → wsrv → 反代，反应快的先出图
        const base = mirror(it.cover);
        const cands = mirrorCandidates(base);
        const first = cands[0] || relayImageUrl(base);
        const race = cands.length > 1 ? ` data-race='${esc(JSON.stringify(cands.slice(1, 5)))}'` : '';
        if (!first) return '';
        // V35 修复：榜单区块取消懒加载（避免视口外不加载），竞速链立即预热
        return `<img decoding="async" referrerpolicy="no-referrer"${race} src="${esc(first)}">`;
      };
      zone.innerHTML = `<div class="popular-layout">
        <div class="popular-feature">${ranked[0] ? `<a class="card" data-href="#/search?wd=${encodeURIComponent(ranked[0].title)}"><div class="card-img">${posterImgOf(ranked[0])}</div><div class="card-body"><div class="card-title">${esc(ranked[0].title)}</div><div class="card-meta">豆瓣 ${esc(ranked[0].rating)} 分 · ${esc(ranked[0].types || '')}</div></div></a><div class="popular-feature-caption"><span class="badge hot">高分聚合榜</span><strong>${esc(ranked[0].title)}</strong><span>${esc(ranked[0].rating)} 分 · ${esc(ranked[0].regions || '')} · 点击站内搜索</span></div>` : ''}</div>
        <div class="popular-ranking">${ranked.slice(1, 7).map((v, i) => `<a class="popular-rank-row" data-href="#/search?wd=${encodeURIComponent(v.title)}" title="站内搜索「${esc(v.title)}」"><span class="popular-rank-num rank-${i + 2}">${String(i + 2).padStart(2, '0')}</span><span class="popular-rank-poster">${posterImgOf(v)}</span><span class="popular-rank-info"><b>${esc(v.title)}</b><small>${esc(v.types || '')} · ${esc(v.regions || '')}</small></span><span class="popular-rank-play">${svg('search')}</span></a>`).join('')}</div>
      </div>`;
      // 更新区块标题提示来源
      const head = zone.closest('.home-section-hot')?.querySelector('.sec-sub');
      if (head) head.textContent = '豆瓣 10 题材高分榜聚合 · 点击站内搜索';
      zone.dataset.hotboard = '1';   // 接管标记：源站 fillPopular 不再覆盖
    } catch { /* 静默：保留源站热度榜 */ }
  }
  loadHotboard();
  /* V22：快速分类卡片挂代表海报。V105 升级：服务端 /api/catcovers 直连豆瓣
     分类标签榜（电影/剧集/综艺/动漫各取榜首封面 + CM 镜像链），
     失败再回退到原 coverPoster 智能兜底，最终回退渐变。 */
  const CATEGORY_POSTERS = [
    { n: '电影', title: '流浪地球2', type: '电影' },
    { n: '连续剧', title: '狂飙', type: '连续剧' },
    { n: '综艺', title: '奔跑吧兄弟', type: '综艺' },
    { n: '动漫', title: '哪吒之魔童降世', type: '动漫' }
  ];
  async function decorateCategories() {
    const tiles = [...view.querySelectorAll('.home-category-tile')];
    if (!tiles.length) return;
    // 主方案：服务端分类封面
    try {
      const base = location.origin;
      const r = await fetch(base + '/api/catcovers', { cache: 'no-store' });
      if (r.ok) {
        const data = await r.json();
        const map = data.map || {};
        for (const t of tiles) {
          const name = t.querySelector('.home-category-name')?.textContent?.trim() || '';
          const entry = map[name];
          if (!entry || !Array.isArray(entry.chain) || !entry.chain.length) continue;
          // 竞速链：首个成功的镜像作为背景
          const tryChain = (idx) => {
            if (idx >= entry.chain.length) return;
            const url = entry.chain[idx];
            const probe = new Image();
            probe.referrerPolicy = 'no-referrer';
            probe.onload = () => {
              if (!alive || !t.isConnected) return;
              t.style.backgroundImage = `linear-gradient(103deg, rgba(9,9,16,.84) 0%, rgba(9,9,16,.34) 52%, rgba(9,9,16,.62) 100%), url("${url}")`;
              t.style.backgroundSize = 'cover';
              t.style.backgroundPosition = 'center';
              t.classList.add('has-poster');
            };
            probe.onerror = () => tryChain(idx + 1);
            probe.onload && (probe.onerror = () => tryChain(idx + 1));
            probe.src = url;
            // 双重保险：加载失败时链推进（onerror 已在上面）；用 onload 避免两回调丢失
          };
          tryChain(0);
        }
        const handled = tiles.filter((t) => t.classList.contains('has-poster')).length;
        if (handled) return;   // 服务端方案成功即返回
      }
    } catch {}
    // 回退：原 coverPoster 智能兜底
    for (const t of tiles) {
      const name = t.querySelector('.home-category-name')?.textContent?.trim() || '';
      const cfg = CATEGORY_POSTERS.find((c) => c.n === name);
      if (!cfg) continue;
      coverPoster(cfg.title, '', cfg.type).then((hit) => {
        if (!alive || !hit?.img) return;
        const src = posterImageSrc(hit.provider, hit.img);
        t.style.backgroundImage = `linear-gradient(103deg, rgba(9,9,16,.84) 0%, rgba(9,9,16,.34) 52%, rgba(9,9,16,.62) 100%), url("${src}")`;
        t.style.backgroundSize = 'cover';
        t.style.backgroundPosition = 'center';
        t.classList.add('has-poster');
      }).catch(() => {});
    }
  }
  buildResume();
  decorateCategories();

  /**
   * 首页数据：全源并行拉取（每源内部失败被捕获）→ 片名指纹合组去重 →
   * 一张聚合网同时供「焦点轮播 / 今日更新 / 猜你喜欢」使用。
   * 任意一个启用源返回有效影视列表，首页就会立即开始展示，不再等待所有源结束。
   */
  async function loadFeed() {
    const results = new Map();
    let done = 0, anyRendered = false, relayNoted = false;
    const status = view.querySelector('#src-name');
    const target = (id) => view.querySelector(id);
    // 提前触发中继探测（vodRequest 内部会复用同一 Promise），首次渲染后补一句传输模式提示。
    const relayPromise = detectRelay();
    // 需要确认中继可用性后再生成海报候选链（直链 + 反代交替）。
    relayPromise.then((ok) => { relayOk = ok; });

    const showWaiting = (title, sub) => {
      if (!alive || anyRendered) return;
      target('#hx').innerHTML = `${empty('radar', title, sub)}<div class="retry-row"><button class="btn ghost" data-href="#/sources">${svg('radar')} 查看数据源</button></div>`;
    };

    // 0–3 秒保持首屏骨架；3 秒、10 秒分别反馈连接进度；15 秒不再无限等待骨架。
    const t3 = setTimeout(() => showWaiting('正在连接影视数据源…', `已并发连接 ${srcs.length} 个来源，正在尝试同域 API 中继。`), 3000);
    const t10 = setTimeout(() => {
      if (!alive || anyRendered) return;
      status.textContent = `已收到 ${done}/${srcs.length} 个来源响应，较慢来源仍在尝试`;
      showWaiting('正在等待可用来源…', `已收到 ${done}/${srcs.length} 个来源响应，较慢来源仍在尝试。`);
    }, 10000);
    const t15 = setTimeout(() => {
      if (!alive) return;
      if (anyRendered) { status.textContent = `已先展示可用结果 · 其余 ${srcs.length - done} 个来源仍在连接`; return; }
      showWaiting('暂时还没有收到影视列表', '已达到首屏等待上限，页面会继续接收慢源结果；也可以打开「数据源」查看状态。');
      target('#today-zone').innerHTML = empty('clock', '正在等待影视列表', '来源返回后会自动显示，不需要刷新页面。');
      target('#hot-zone').innerHTML = empty('clock', '正在生成推荐', '获取到影视条目后会自动填充。');
    }, 15000);

    /* V14 渲染去重：此前每返回一个源就全量重建 4 个区块 + 重绘轮播
       （12 个源 = 最多 12 次全量 innerHTML，图片元素反复销毁重建）。
       现在按内容签名比对：没变化就只更新状态行；轮播仅在 top6 变化时
       重绘，且保留当前停留位置。 */
    function renderPartial() {
      if (!alive) return;
      const good = [...results.values()].filter((x) => x.vods?.length);
      if (!good.length) return;
      const next = mergeSearchHits(good);
      if (!next.length) return;
      merged = next;
      srcCount = good.length;
      const firstRender = !anyRendered;
      anyRendered = true;
      if (!relayNoted) {
        relayNoted = true;
        relayPromise.then((ok) => { if (!ok && alive) status.textContent = `直连兜底模式（未检测到同域中继） · ${status.textContent}`; });
      }
      status.textContent = `聚合自 ${srcCount} 个可用来源 · 自动去重${done < srcs.length ? ` · 其余 ${srcs.length - done} 个加载中` : ''}${pausedCount ? ` · 自动跳过 ${pausedCount} 个故障源` : ''}`;
      const sig = next.length + '|' + next.slice(0, 30).map((v) => (v.key || '') + (v.vod_id || '')).join(',');
      if (!firstRender && sig === lastSig) return;
      lastSig = sig;
      // 焦点轮播：top6 集合变化才重绘，保留当前停留位置
      const heroTop = merged.slice().sort((a, b) => (Number(b.vod_hits) || 0) - (Number(a.vod_hits) || 0)).slice(0, 6);
      const hSig = heroTop.map((v) => (v.key || '') + (v.vod_id || '')).join(',');
      if (hSig !== heroSig) { heroSig = hSig; renderHero(heroTop, Math.min(heroState.i, Math.max(0, heroTop.length - 1))); }
      const today = merged.slice().sort((a, b) => String(b.vod_time || '').localeCompare(String(a.vod_time || '')));
      fill(target('#today-zone'), today.slice(0, 18), 'today');
      fillPopular(target('#popular-zone'), today.slice().sort((a, b) => (Number(b.vod_hits) || 0) - (Number(a.vod_hits) || 0)).slice(0, 8));
      if (!recommendTaken) loadDoubanRecommend(false);
      else if (!recommendOk) fill(target('#hot-zone'), buildRecommendations(today).slice(0, 12), 'recommend');
    }

    const tasks = srcs.map(async (s) => {
      try {
        const r = await getList(s, { pg: 1, h: 24, timeout: 5500 });
        results.set(s.id, { src: s, vods: r.list || [], stale: !!r.__stale });
      } catch (e) {
        results.set(s.id, { src: s, vods: [], err: e?.message || '请求失败' });
      } finally {
        done++;
        renderPartial();
        if (!anyRendered && alive && done < srcs.length && done % 3 === 0) {
          status.textContent = `已检查 ${done}/${srcs.length} 个来源，等待可用数据…`;
        }
      }
    });

    await Promise.allSettled(tasks);
    clearTimeout(t3); clearTimeout(t10); clearTimeout(t15);
    if (!alive) return;
    if (merged.length) {
      status.textContent = `聚合自 ${srcCount} 个可用来源 · 自动去重${pausedCount ? ` · 自动跳过 ${pausedCount} 个故障源（2h 内自动恢复）` : ''}`;
      if (state.settings.autoScan && Date.now() - (state.settings.lastScan || 0) > 4 * 3600e3) {
        // V14 修复两处：lastScan 属于设置项，此前误用 saveHealth 导致永不持久化；
        // 巡检原先 fire-and-forget 全量并发，改为与「数据源」页一致的 3 并发受限池，避免打满上游触发限流。
        state.settings.lastScan = Date.now(); saveSettings();
        checkAll(srcs, null, 3).catch(() => {});
      }
      return;
    }

    const items = [...results.values()];
    const fails = items.filter((i) => i.err);
    const authFails = fails.filter((i) => /401|authentication required|upstream_auth_required|要求认证/i.test(i.err || ''));
    const proxyMismatch = fails.filter((i) => /404|not found|Unexpected token|<html/i.test(i.err || ''));
    const relayOkNow = await relayPromise;
    const relayNote = relayOkNow ? '' : '本次未检测到同域 /api/proxy 中继（/api/health 不可用），已自动走直连/公共代理通道；如需受控中继请按 README 部署 Worker 或 Pages Functions。';
    const summary = authFails.length === fails.length && fails.length
      ? `当前 ${authFails.length} 个失败来源均提示认证/授权问题。HTTP 401 来自源站时，前端或 Worker 无法绕过权限；需要更换可公开访问的合法 API，或由源站管理员配置授权。`
      : proxyMismatch.length ? '部分请求可能没有命中已部署的同域 Worker/Pages Function。请先检查 /api/health 的构建标识和部署路由。'
      : '请先区分源站 HTTP 状态、Worker 路由、数据格式和浏览器网络错误，再决定是否更换来源。';
    const failRows = fails.slice(0, 6).map((i) => `<div class="home-diagnostic-row"><b>${esc(i.src.name)}</b><span>${esc(i.err || '请求失败')}</span></div>`).join('');
    target('#hx').innerHTML = `
      <div class="empty home-diagnostic"><div class="empty-ico">${svg('radar')}</div>
      <div class="empty-title">暂时没有获取到影视内容</div>
      <div class="empty-sub">已检查 ${done}/${srcs.length} 个来源。${esc(summary)}${relayNote ? '<br>' + esc(relayNote) : ''}</div>
      <div class="home-diagnostic-list">${failRows || '<div>暂无详细错误，请进入数据源管理进行单源检测。</div>'}</div>
      <div class="retry-row"><button class="btn primary" data-href="#/sources">${svg('radar')} 数据源诊断</button><button class="btn ghost" id="retry">${svg('refresh')} 重试</button></div></div>`;
    target('#retry').onclick = () => location.reload();
    // 所有源失败时，不允许栏目永久停留在骨架屏；显示明确空态，布局仍保留原样式体系。
    target('#today-zone').innerHTML = empty('clock', '今日更新暂不可用', '连接到可用数据源后会自动恢复');
    target('#hot-zone').innerHTML = empty('wand', '暂时无法生成推荐', '推荐内容来自真实影视数据，不使用虚构影片填充');
    target('#popular-zone').innerHTML = empty('flame', '热门榜单暂不可用', '当前没有可验证的影片热度数据');
  }

  function fill(mount, list, mode = 'default') {
    if (!mount) return;
    mount.innerHTML = list.length
      ? `<div class="grid home-grid home-grid-${mode}">${list.map((v, k) => posterCard(v, k, { pool: v.posterPool, chain: buildPosterChainRelayed(v.vod_pic, v.posterPool, relayOk) })).join('')}</div>`
      : empty('clapperboard', '暂时没有可展示的影片', '可以稍后重试，或前往分类页浏览');
    // V101：源站封面未出的卡片，批量按片名查豆瓣封面（服务端直连 + CM 镜像链）
    if (list.length) enhanceCoversFromServer(mount, list);
  }

  /* V101 批量豆瓣封面补强：对仍显示占位/未加载的卡片按片名查封面并竞速替换 */
  let coversTask = null;
  function enhanceCoversFromServer(mount, list) {
    if (!alive) return;
    const names = list.map((v) => String(v.vod_name || '').trim()).filter(Boolean).slice(0, 20);
    if (!names.length) return;
    const task = (async () => {
      try {
        const { fetchCovers } = await import('../api/covers.js');
        const map = await fetchCovers(names);
        let replaced = 0;
        for (const v of list) {
          const entry = map[v.vod_name] || map[String(v.vod_name || '').trim()];
          if (!entry || !Array.isArray(entry.chain) || !entry.chain.length) continue;
          const img = [...mount.querySelectorAll('img')].find((im) => {
            const title = im.closest('.card')?.querySelector('.card-title')?.textContent?.trim();
            return title === v.vod_name || im.closest('.card')?.dataset?.href?.includes(encodeURIComponent(v.vod_id || ''));
          });
          if (!img) continue;
          // 仅当当前是占位（SVG）或已碎时才替换
          const complete = img.complete && img.naturalWidth > 0;
          if (complete && !img.src.startsWith('data:image/svg')) continue;
          // 竞速链：按序试（首个成功即停）
          let idx = 0;
          const tryNext = () => {
            if (idx >= entry.chain.length) return;
            const candidate = entry.chain[idx++];
            const probe = new Image();
            probe.referrerPolicy = 'no-referrer';
            probe.onload = () => { if (alive && mount.isConnected) { img.src = candidate; replaced++; } };
            probe.onerror = tryNext;
            probe.src = candidate;
          };
          tryNext();
        }
        if (replaced && alive) U.toast(`已为 ${replaced} 张封面启用豆瓣镜像加速`, { type: 'ok', timeout: 1800 });
      } catch { /* 封面补强失败静默 */ }
    })();
    coversTask = task;
  }

  function buildRecommendations(list) {
    const recent = list.filter((v) => v.vod_name);
    const pool = recent.filter((v) => !v.vod_remarks?.includes('完结'));
    return shuffle(pool.length >= 6 ? pool : recent);
  }

  function fillPopular(mount, list) {
    if (!mount) return;
    if (mount.dataset.hotboard === '1') return;   // V34：聚合榜已接管，源站热度榜不再覆盖
    const ranked = list.slice(0, 8);
    mount.innerHTML = ranked.length ? `<div class="popular-layout">
      <div class="popular-feature">${ranked[0] ? posterCard(ranked[0], 0, { pool: ranked[0].posterPool, chain: buildPosterChainRelayed(ranked[0].vod_pic, ranked[0].posterPool, relayOk) }) : ''}<div class="popular-feature-caption"><span class="badge hot">今日热映</span><strong>${esc(ranked[0]?.vod_name || '')}</strong><span>热度优选 · 点击查看详情</span></div></div>
      <div class="popular-ranking">${ranked.slice(1, 7).map((v, i) => `<a class="popular-rank-row" data-href="#/v/${encodeURIComponent(v.srcId)}/${encodeURIComponent(v.vod_id)}"><span class="popular-rank-num rank-${i + 2}">${String(i + 2).padStart(2, '0')}</span><span class="popular-rank-poster">${posterImg(v.vod_pic, { chain: buildPosterChainRelayed(v.vod_pic, v.posterPool, relayOk), smart: { n: v.vod_name, y: v.vod_year, t: v.type_name, s: v.srcId, id: v.vod_id } })}</span><span class="popular-rank-info"><b>${esc(v.vod_name)}</b><small>${esc(v.type_name || '影视')} · ${esc(v.vod_year || v.vod_remarks || '热门推荐')}</small></span><span class="popular-rank-play">${svg('play')}</span></a>`).join('')}</div>
    </div>` : empty('flame', '热门榜单暂不可用', '获取到影视数据后会自动生成');
  }

  /* 焦点轮播：合并网里按热度取前6，每个条目自带所属源 srcId */
  function renderHero(list, initialIndex = 0) {
    clearInterval(heroTimer);
    const hx = view.querySelector('#hx');
    const hero = list.slice().sort((a, b) => (b.vod_hits || 0) - (a.vod_hits || 0)).slice(0, 6);
    if (!hero.length) return;
    let i = initialIndex % hero.length;
    const paint = () => {
      heroState.i = i;
      const v = hero[i];
      hx.innerHTML = `<div class="hero-bg">${posterImg(v.vod_pic, { cls: 'hero-img', lazy: false, chain: buildPosterChainRelayed(v.vod_pic, v.posterPool, relayOk), smart: { n: v.vod_name, y: v.vod_year, t: v.type_name, s: v.srcId, id: v.vod_id } })}</div>
        <div class="hero-veil"></div>
        <div class="hero-info fade-in">
          <div class="hero-tags">${v.type_name ? `<span class="badge">${esc(v.type_name)}</span>` : ''}${v.vod_remarks ? `<span class="badge hot">${esc(v.vod_remarks)}</span>` : ''}${v.vod_year ? `<span class="badge">${esc(v.vod_year)}</span>` : ''}${v.srcCount > 1 ? `<span class="badge hot">${v.srcCount}源聚合</span>` : ''}</div>
          <h1 class="hero-title">${[...esc(v.vod_name)].map((ch, ci) => `<span class="ch" style="--ci:${ci}">${ch}</span>`).join('')}</h1>
          <div class="hero-actions">
            <button class="btn primary lg" data-href="#/play/${encodeURIComponent(v.srcId)}/${encodeURIComponent(v.vod_id)}">${svg('play')} 立即播放</button>
            <button class="btn ghost lg" data-href="#/v/${encodeURIComponent(v.srcId)}/${encodeURIComponent(v.vod_id)}">查看详情</button>
          </div>
        </div>
        <div class="hero-dots">${hero.map((_, j) => `<button type="button" class="dot ${j === i ? 'on' : ''}" data-hero-index="${j}" aria-label="切换到第 ${j + 1} 部影片"></button>`).join('')}</div>`;
    };
    paint();
    heroTimer = setInterval(() => { i = (i + 1) % hero.length; paint(); }, 6000);
  }
  view.querySelector('#rx')?.addEventListener('click', () => loadDoubanRecommend(true));
  view.querySelector('#hx')?.addEventListener('click', (e) => { const dot = e.target.closest('[data-hero-index]'); if (dot && merged.length) { const list = merged.slice().sort((a, b) => (Number(b.vod_hits) || 0) - (Number(a.vod_hits) || 0)).slice(0, 6); const n = Number(dot.dataset.heroIndex); if (Number.isInteger(n) && list[n]) { renderHero(list, n); } } });

  /* 继续观看 + 收藏横栏 */
  async function buildResume() {
    const box = view.querySelector('#sx-resume');
    const rows = (await listHistory()).slice(0, 12);
    const favs = (state.settings.favs || []).slice().reverse();
    const favCards = favs.map((f) => ({ title: f.title, thumb: f.thumb, sub: '我的收藏', href: `#/v/${encodeURIComponent(f.srcId)}/${encodeURIComponent(f.vodId)}`, prog: 0 }));
    const histCards = rows.map((h) => {
      const isParse = h.kind === 'parse' || h.srcId === 'parse';
      return {
        title: h.title, thumb: h.thumb,
        sub: (h.ep || '') + (isParse ? ' · 云解析' : '') + ' · ' + timeAgo(h.updated),
        href: isParse
          ? `#/parse?url=${encodeURIComponent(h.vodId || '')}`
          : `#/play/${encodeURIComponent(h.srcId)}/${encodeURIComponent(h.vodId)}?ep=${h.ei != null ? h.ei : 0}`,
        prog: h.prog || 0
      };
    });
    const cards = [...favCards, ...histCards].slice(0, 12);
    if (!cards.length) { box.style.display = 'none'; return; }
    box.innerHTML = `<div class="sec-head"><h2>${svg('clock', 'hot')} 继续观看 · 收藏</h2><a class="chip" data-href="#/history">全部 ${svg('chevR')}</a></div>
      <div class="rail">${cards.map((c) => `
        <a class="rail-card reveal" data-href="${c.href}" data-spot>
          <div class="card-img">${posterImg(c.thumb)}
          <span class="card-play">${svg('play')}</span>${c.prog ? `<span class="rail-prog"><i style="width:${Math.min(100, (c.prog * 100) | 0)}%"></i></span>` : ''}</div>
          <div class="card-title">${esc(c.title)}</div><div class="card-meta">${esc(c.sub)}</div>
        </a>`).join('')}</div>`;
  }

  return () => { alive = false; clearInterval(heroTimer); };
});
