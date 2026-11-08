import { state, saveHealth } from '../core/state.js';
import { cacheSet, cacheGet, kvGet, kvSet } from '../core/db.js';
import { httpFetch, httpJsonp, proxies, viaProxy, detectRelay, relayEndpoint } from './adapters.js';
import { normalizeTitle, toHttps } from '../core/utils.js';
import { rememberPoster } from '../core/postermemo.js';

/* ============================================================
   传输策略：每个"源×请求类型"记住上次成功的传输方式（直连/JSONP/
   代理N），失败自动回退其余方式 —— 接口"自愈"，越用越快。
   ============================================================ */
const tr = new Map();
const trOf = (s, t) => tr.get(s.id + ':' + t) || null;
const trSet = (s, t, m) => tr.set(s.id + ':' + t, m);

/* 单源搜索失败短窗口记忆（10 分钟）。只影响详情页的跨源补充策略，
   不参与健康度判定，也不阻塞搜索页对所有源的正常检索。 */
const searchDown = new Map();

function norm(res) {
  if (!res) throw new Error('空响应');
  const candidates = [
    res.list,
    Array.isArray(res) ? res : null,
    res.data,
    res.items,
    res.results,
    res.vod_list,
    res.data?.list,
    res.result?.list
  ];
  const list = candidates.find((x) => Array.isArray(x) && x.length)
    || candidates.find((x) => Array.isArray(x));
  if (!Array.isArray(list)) throw new Error('返回结构不兼容（未找到 list/data/items）');
  const pick = (...values) => values.find((v) => v !== undefined && v !== null && String(v).trim() !== '') ?? '';
  const normalized = list.map((v) => ({
    ...v,
    vod_id: String(pick(v.vod_id, v.vodId, v.id, v.ID)),
    type_id: pick(v.type_id, v.typeId, v.tid),
    type_name: pick(v.type_name, v.typeName, v.type),
    vod_name: pick(v.vod_name, v.vodName, v.name, v.title, v.vod_title),
    vod_pic: pick(v.vod_pic, v.vodPic, v.pic, v.cover, v.poster, v.image),
    vod_remarks: pick(v.vod_remarks, v.remarks, v.note, v.state, v.vod_state),
    vod_year: pick(v.vod_year, v.year),
    vod_content: pick(v.vod_content, v.content, v.description, v.des),
    vod_play_from: pick(v.vod_play_from, v.play_from),
    vod_play_url: pick(v.vod_play_url, v.play_url)
  }));
  return {
    code: res.code ?? 1, msg: res.msg || '', page: +res.page || 1,
    pagecount: +res.pagecount || 1,
    total: +(res.total ?? res.count ?? normalized.length) || normalized.length,
    list: normalized
  };
}

/* JSON/JSONP 整形（兼容裸对象、伪 JSONP 包裹、var 声明） */
function shapeJson(text) {
  const t = (text || '').trim(); if (!t) throw new Error('空响应');
  try { return norm(JSON.parse(t)); } catch {}
  const m = t.match(/\{[\s\S]*\}/); if (m) { try { return norm(JSON.parse(m[0])); } catch {} }
  throw new Error('JSON 解析失败');
}

/* XML 整形（at/xml 接口）：<list><video> 与详情 <rss><video>，<dl><dd> 线路转 play_url */
function shapeXml(text) {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML 解析失败');
  const t = (e, sel) => e?.querySelector(sel)?.textContent?.trim() || '';
  const vids = [...doc.querySelectorAll('rss>list>video, rss>video')].map((v) => ({
    vod_id: t(v, 'id'), type_id: t(v, 'tid'), type_name: t(v, 'type'), vod_name: t(v, 'name'), vod_pic: t(v, 'pic'),
    vod_actor: t(v, 'actor'), vod_director: t(v, 'director'), vod_area: t(v, 'area'), vod_lang: t(v, 'lang'),
    vod_year: t(v, 'year'), vod_remarks: t(v, 'note') || t(v, 'state'), vod_content: t(v, 'des'),
    vod_score: t(v, 'score'), vod_hits: +(t(v, 'hits') || 0),
    vod_play_from: [...v.querySelectorAll('dl dd')].map((d) => d.getAttribute('flag') || '线路').join('$$$'),
    vod_play_url: [...v.querySelectorAll('dl dd')].map((d) => d.textContent.trim()).join('$$$')
  }));
  const l = doc.querySelector('rss>list');
  return { code: vids.length ? 1 : 0, page: +(l?.getAttribute('page') || 1), pagecount: +(l?.getAttribute('pagecount') || 1), total: vids.length, list: vids };
}

/* AppleCMS v10 请求构造：list / videolist(搜索) / detail 三态 */
const ACS = { list: 'list', search: 'videolist', detail: 'detail' };
function buildUrl(src, type, q) {
  const u = new URL(src.api);
  // /at/xml/ 与非标准 API 通常不识别 AppleCMS 的 ac 参数。
  if (!['xml', 'custom'].includes(src.format)) u.searchParams.set('ac', ACS[type]);
  if (type === 'search') u.searchParams.set('wd', q.wd || '');
  if (type === 'detail') u.searchParams.set('ids', q.ids);
  for (const k of ['t', 'pg', 'h', 'by', 'class', 'year', 'letter', 'area', 'lang', 'limit']) if (q[k] != null) u.searchParams.set(k, q[k]);
  return u.href;
}

function isLocalHost() {
  const host = globalThis.location?.hostname || '';
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
}

async function requestThroughWorker(url, timeout = 10500, signal) {
  // 同域 /api/proxy 或设置里的自定义中继基址
  return httpFetch(relayEndpoint(url), { timeout, signal });
}

/**
 * 传输方式候选序列（纯函数，便于测试）：
 * - 有同域中继（Pages Functions / Worker）→ 只走 worker，保持原安全策略；
 * - 中继缺失（静态托管 / file:// / 局域网调试）→ 直连 → JSONP → 公共代理兜底，
 *   与多通道回退策略一致，首页不再整页空白。
 * 每源每请求类型记忆上次成功方式（remembered），命中则放在最前加速。
 */
export function transportCandidates(src, type, remembered, { relayOk = false, local = false, proxyCount = 0 } = {}) {
  const modes = [];
  if (remembered) modes.push(remembered);
  if (relayOk) modes.push('worker');
  if (!relayOk || local) {
    modes.push('fetch');
    if (src.format !== 'xml') modes.push('jsonp');
    for (let i = 0; i < proxyCount; i++) modes.push('proxy' + i);
  }
  return [...new Set(modes.filter(Boolean))];
}

async function vodRequest(src, type, q = {}, opt = {}) {
  const url = buildUrl(src, type, q);
  const localFallback = isLocalHost();
  // 单源超时覆盖（ms，设置页可调）；空值/非法值回落内置默认
  const tmo = (dflt) => Math.max(3000, Math.min(20000, Math.round(Number(opt.timeout) || Number(src.timeout) || dflt)));
  // 会话内一次的同域中继探测：静态托管没有 /api/health 时自动启用直连/代理兜底。
  const relayOk = await detectRelay();
  const order = transportCandidates(src, type, trOf(src, type), { relayOk, local: localFallback, proxyCount: proxies().length });

  /* 竞速修正：worker 拥有 800ms 优先窗口；worker 快速失败时
 fetch 立即启动（不等软超时）——消除"worker 秒挂 + fetch 干等"的时序空洞。 */
  const raceWithFetch = async () => {
    const workerP = requestThroughWorker(url, tmo(9000), opt.signal);
    let fetchStarted = false;
    const startFetch = (res, rej) => {
      if (fetchStarted) return;
      fetchStarted = true;
      httpFetch(url, { timeout: tmo(7000), signal: opt.signal }).then(res, () => rej(new Error('fetch-race-silent')));
    };
    const fetchP = new Promise((res, rej) => {
      // worker 800ms 优先窗口：窗口内成功则 fetch 不启动
      const t = setTimeout(() => startFetch(res, rej), 800);
      // worker 失败立即启动 fetch（不再等待）
      workerP.catch(() => { clearTimeout(t); startFetch(res, rej); });
    });
    return Promise.any([workerP, fetchP]);
  };

  /* 快速重试（快速重试自愈）：失败后 700ms 重试一次。
 注意：worker 走竞速不重试（竞速本身就是双保险）。 */
  const withRetry = async (fn) => {
    try { return await fn(); }
    catch (e) {
      if (opt.signal?.aborted || e?.name === 'AbortError') throw e;
      await new Promise((r) => setTimeout(r, 700));
      return await fn();
    }
  };

  let last;
  for (const mode of order) {
    try {
      let text;
      if (mode === 'worker') {
        // 竞速模式自带双通道兜底，不再叠加重试（避免时序爆炸）
        text = await raceWithFetch();
      }
      else if (mode === 'fetch') text = await withRetry(() => httpFetch(url, { timeout: tmo(9000), signal: opt.signal }));
      else if (mode === 'jsonp') {
        const payload = await withRetry(() => httpJsonp(url, { timeout: tmo(6000) }));
        const r = norm(payload);
        if (r.list.length) { trSet(src, type, mode); return r; }
        throw new Error('该接口无可展示数据');
      } else if (mode.startsWith('proxy')) {
        const p = proxies()[+mode.slice(5)]; if (!p) continue;
        text = await withRetry(() => httpFetch(viaProxy(p, url), { timeout: tmo(6000), signal: opt.signal }));
      }
      const trimmed = String(text || '').trim();
      const r = src.format === 'xml' || trimmed.startsWith('<') ? shapeXml(trimmed) : shapeJson(trimmed);
      // 统一处理相对海报地址，并过滤没有名称/ID 的脏记录。
      const base = new URL(src.api);
      r.list = (r.list || []).map((v) => {
        let pic = String(v.vod_pic || '').trim();
        if (pic.startsWith('//')) pic = base.protocol + pic;
        else if (pic.startsWith('/')) pic = new URL(pic, base.origin).href;
        else if (pic && !/^(https?:|data:|blob:)/i.test(pic)) {
          try { pic = new URL(pic, base.href).href; } catch {}
        }
        return { ...v, vod_pic: toHttps(pic) };
      }).filter((v) => v.vod_name && String(v.vod_name).trim());
      if (r.list?.length) {
        // 详情请求必须返回指定 ID，禁止把接口的“默认第一条”误当作用户点选的影片。
        if (type === 'detail' && q.ids) {
          const wanted = String(q.ids);
          const exact = r.list.find((v) => String(v.vod_id) === wanted);
          if (exact) r.list = [exact];
          else if (r.list.length === 1 && String(r.list[0].vod_id) === wanted) r.list = [r.list[0]];
          else throw new Error(`详情 ID 不匹配：请求 ${wanted}，接口返回 ${r.list.slice(0, 3).map((v) => v.vod_id || '?').join(', ')}`);
        }
        trSet(src, type, mode); return r;
      }
      last = new Error('该接口暂未返回可展示影视数据');
    } catch (e) {
      last = e;
      if (opt.signal?.aborted || e?.name === 'AbortError') throw e;
    }
  }
  const err = last || new Error('请求失败：请检查 Worker 部署、接口地址与源状态');
  if (!relayOk) err.message = `${err.message}（同域中继不可用：多数采集源未开放 CORS、也不支持 JSONP，浏览器无法直连。请部署 Pages Functions/Worker 获得受控中继，或更换支持跨域直连的来源。）`;
  throw err;
}

/* ============ 健康度：滚动均值 + 状态判定，持久化 IndexedDB ============ */
export function reportHealth(key, ok, ms = null, err = null) {
  const now = Date.now();
  const previous = state.health[key] || {};
  const h = {
    id: key, ok: Number(previous.ok) || 0, fail: Number(previous.fail) || 0,
    avg: Number(previous.avg) || 0, last: Number(previous.last) || 0,
    lastErr: previous.lastErr || '', samples: Array.isArray(previous.samples) ? previous.samples : []
  };
  // Keep a bounded recent window so old successes cannot permanently mask a broken source.
  h.samples = [...h.samples.filter((x) => x && now - x.at < 24 * 3600e3), { at: now, ok: !!ok, ms: Number.isFinite(ms) ? Math.round(ms) : null, err: ok ? '' : String(err || '').slice(0, 180) }].slice(-20);
  h.last = now;
  if (ok) {
    h.ok++;
    h.avg = h.avg ? Math.round(h.avg * 0.6 + (ms || 0) * 0.4) : Math.round(ms || 0);
    h.lastErr = '';
  } else {
    h.fail++;
    h.lastErr = String(err || '').slice(0, 180);
  }
  const recent = h.samples;
  const recentFails = recent.filter((x) => !x.ok);
  const recentSuccesses = recent.filter((x) => x.ok);
  const errText = h.lastErr.toLowerCase();
  if (!ok && /401|authentication|认证|授权/.test(errText)) h.status = 'unauthorized';
  else if (!ok && /429|rate limit|限流/.test(errText)) h.status = 'rate_limited';
  else if (!ok && recentFails.length >= 3 && recentSuccesses.length === 0) h.status = 'down';
  else if (!ok) h.status = 'error';
  else if (ms > 4500) h.status = 'slow';
  else if (recentFails.length >= 3 && recentFails.length > recentSuccesses.length) h.status = 'degraded';
  else h.status = 'healthy';
  state.health[key] = h;
  saveHealth();
}

/* ============ 源站健康评分：成功率×0.5 + 速度×0.35 + 近期稳定性×0.15 ============ */
export function sourceScore(srcId) {
  const h = state.health[srcId];
  if (!h || !h.samples?.length) return 50;
  const recent = h.samples.filter((x) => Date.now() - x.at < 24 * 3600e3);
  if (!recent.length) return 50;
  const okCount = recent.filter((x) => x.ok).length;
  const successRate = recent.length ? okCount / recent.length : 0;
  const okMs = recent.filter((x) => x.ok && x.ms).map((x) => x.ms);
  const avgMs = okMs.length ? okMs.reduce((a, b) => a + b, 0) / okMs.length : 5000;
  const speedScore = Math.max(0, 100 - (avgMs / 5000) * 100);
  const last5 = recent.slice(-5);
  const stability = last5.filter((x) => x.ok).length / Math.max(1, last5.length);
  return Math.round(successRate * 50 + speedScore * 0.35 + stability * 15);
}

/* ============ 三大基础请求 ============ */
export async function getList(src, { pg = 1, t, h = 24, by, timeout, fresh } = {}) {
  const key = ['list', src.id, t || 0, pg, h || 0, by || ''].join(':');
  const cached = !fresh ? await cacheGet(key) : null;
  if (cached && !cached.stale) return cached.data;
  const t0 = performance.now();
  try {
    const r = await vodRequest(src, 'list', { pg, t, h, by }, { timeout });
    r.__id = src.id;
    reportHealth(src.id, true, performance.now() - t0);
    cacheSet(key, r, 8 * 60e3);
    return r;
  } catch (e) {
    reportHealth(src.id, false, null, e?.message);
    // 网络或源站暂时失败时，优先用过期列表兜底，避免首页瞬间变空。
    if (cached?.data?.list?.length) return { ...cached.data, __id: src.id, __stale: true };
    throw e;
  }
}

export async function searchCms(src, wd, { fresh, pg, signal, timeout } = {}) {
  const key = ['s', src.id, wd, pg || 1].join(':');
  const cached = !fresh ? await cacheGet(key) : null;
  if (cached && !cached.stale) return cached.data;
  const t0 = performance.now();
  try {
    const r = await vodRequest(src, 'search', { wd, pg }, { signal, timeout });
    reportHealth(src.id, true, performance.now() - t0);
    // 缓存时长跟随设置（默认 30 分钟；对应配置的缓存时长）
    const ttlSec = Number(state.settings?.cacheTime) || 1800;
    cacheSet(key, r, Math.max(120e3, Math.min(86400e3, ttlSec * 1000)));
    return r;
  } catch (e) {
    reportHealth(src.id, false, null, e?.message);
    // 短窗口失败记忆：详情页跨源补全在窗口期内不再重打该源，避免反复请求坏死的源。
    if (!signal?.aborted) searchDown.set(src.id, Date.now() + 10 * 60e3);
    // Stale-while-revalidate fallback: an upstream outage should not erase a useful prior search.
    if (!signal?.aborted && cached?.data?.list?.length) return { ...cached.data, __stale: true };
    throw e;
  }
}
export const searchRecentlyFailed = (srcId) => (searchDown.get(String(srcId)) || 0) > Date.now();
export async function getDetailCms(src, id, { fresh } = {}) {
  const key = ['d', src.id, id].join(':');
  if (!fresh) {
    const hit = await cacheGet(key);
    // 早期实现曾可能把接口返回的第一条影片误缓存为指定 ID；必须校验后才能复用。
    if (hit && !hit.stale && hit.data && String(hit.data.vod_id) === String(id)) return hit.data;
  }
  const t0 = performance.now();
  try {
    const r = await vodRequest(src, 'detail', { ids: id });
    const rows = Array.isArray(r.list) ? r.list : [];
    const vod = rows.find((v) => String(v.vod_id) === String(id)) || (rows.length === 1 ? rows[0] : null);
    if (!vod || String(vod.vod_id) !== String(id)) throw new Error(`详情返回不匹配：${src.name} / ${id}`);
    reportHealth(src.id, true, performance.now() - t0);
    rememberPoster(src.id, String(vod.vod_id), vod.vod_pic);   // 记住封面，返回首页即时出图
    cacheSet(key, vod, 6 * 3600e3);
    return vod;
  } catch (e) { reportHealth(src.id, false, null, e?.message); throw e; }
}

/* ============ 健康巡检（单源 / 全量并发） ============ */
export async function checkCms(src) {
  const t0 = performance.now();
  try { await getList(src, { pg: 1, h: 24, fresh: true, timeout: 8000 }); return { ok: true, ms: Math.round(performance.now() - t0) }; }
  catch (e) { return { ok: false, ms: Math.round(performance.now() - t0), err: e?.message || '失败' }; }
}
export async function checkAll(list, onOne, pool = 3) {
  const res = []; const q = [...list];
  await Promise.all(Array.from({ length: pool }, async () => { while (q.length) { const s = q.shift(); const r = await checkCms(s); res.push(r); onOne?.(s, r); } }));
  return res;
}

/* ============================================================
   同名影片聚合去重：
   多源搜索结果 → normalizeTitle 指纹合组 → 每组保留信息最全代表
   条目 + 命中源数(srcCount) → "双源/3源"徽标；详情页按此聚合线路
   ============================================================ */
export function mergeSearchHits(items, query = '') {
  const map = new Map();
  const queryKey = normalizeTitle(query);
  for (const it of items) {
    if (!it || it.err || !it.vods) continue;
    for (const vod of it.vods) {
      //搜索结果相关性过滤（季数识别+多词命中+标点归一化）
      if (!isRelevantResult(vod.vod_name || '', query)) continue;
      const titleKey = normalizeTitle(vod.vod_name || '');
      if (!titleKey) continue;
      // 缺少年份时不跨源强行合并：同名重拍/版本不明的条目宁可暂时分开，避免串片。
      const year = String(vod.vod_year || '').trim().match(/(?:19|20)\d{2}/)?.[0] || '';
      const key = titleKey + (year ? ':' + year : `:unknown-year:${it.src.id}`);
      let g = map.get(key);
      if (!g) { g = { key: titleKey, groupKey: key, counts: new Set(), best: null, bestScore: -1, playMap: new Map(), posters: new Set() }; map.set(key, g); }
      g.counts.add(it.src.id);
      //跨源海报池：同片在各源的封面互为候选（首页封面多级降级的核心数据）
      if (vod.vod_pic) g.posters.add(String(vod.vod_pic).trim());
      const score = (vod.vod_pic ? 2 : 0) + (vod.vod_remarks ? 1 : 0) + (vod.vod_year ? 1 : 0) + (vod.vod_score ? 1 : 0);
      if (score > g.bestScore) { g.bestScore = score; g.best = vod; g.srcId = it.src.id; g.srcName = it.src.name; }
      // 在搜索阶段提取剧集地址（episodes/episodes_titles）：
      // 命中结果直接保留解析后的线路，详情/播放页无需等待详情接口即可出线路。
      if (vod.vod_play_url) {
        const lines = sortLinesPlayable(parsePlayUrl(vod.vod_play_url, vod.vod_play_from));
        const eps = lines.reduce((n, ln) => n + ln.eps.length, 0);
        const prev = g.playMap.get(it.src.id);
        if (lines.length && (!prev || prev.eps < eps)) g.playMap.set(it.src.id, { srcId: it.src.id, srcName: it.src.name, lines, eps });
      }
    }
  }
  return [...map.values()].map((g) => {
    const title = normalizeTitle(g.best?.vod_name || '');
    const relevance = queryKey && title === queryKey ? 3 : queryKey && title.startsWith(queryKey) ? 2 : queryKey && title.includes(queryKey) ? 1 : 0;
    const fastPlays = [...g.playMap.values()].sort((a, b) => (b.eps || 0) - (a.eps || 0)).slice(0, 4).map(({ eps, ...p }) => p);
    const bestPic = String(g.best?.vod_pic || '').trim();
    const posterPool = [...g.posters].filter((p) => p && p !== bestPic).slice(0, 4);
    return { key: g.key, srcId: g.srcId, srcName: g.srcName, srcCount: g.counts.size, sourceIds: [...g.counts], fastPlays, posterPool, _relevance: relevance, ...g.best };
  }).sort((a, b) => b._relevance - a._relevance || (b.srcCount || 0) - (a.srcCount || 0) || (b.vod_hits || 0) - (a.vod_hits || 0))
    .map(({ _relevance, ...item }) => item);
}

/* ============================================================
   搜索命中记忆（会话内，30 分钟）：搜索页聚合结果进入映射，
   详情/播放页先复用已解析线路，再后台补全 —— 首屏不再等详情接口。
   ============================================================ */
const hitStore = new Map();
const HIT_TTL = 30 * 60e3, HIT_MAX = 60;
export function rememberHits(hits) {
  for (const h of hits || []) {
    if (!h || !h.key || !Array.isArray(h.fastPlays) || !h.fastPlays.length) continue;
    const y = String(h.vod_year || '').match(/(?:19|20)\d{2}/)?.[0] || '';
    hitStore.set(h.key + (y ? ':' + y : ''), { hit: h, at: Date.now() });
  }
  if (hitStore.size > HIT_MAX) {
    const olds = [...hitStore.entries()].sort((a, b) => a[1].at - b[1].at);
    for (const [k] of olds.slice(0, hitStore.size - HIT_MAX)) hitStore.delete(k);
  }
}
export function recallHit(seriesKey) {
  const ent = hitStore.get(seriesKey);
  if (!ent || Date.now() - ent.at > HIT_TTL) { hitStore.delete(seriesKey); return null; }
  return ent.hit;
}

/**
 * 多源聚合搜索：有界并发 + 单源故障隔离 + 增量回调。
 * onSourceResult 每完成一个源就收到当前聚合结果和状态，UI 可先展示快源，
 * 不必等最慢的源结束。signal 用于用户更换关键词或离开页面时取消旧请求。
 */
export async function multiSearch(wd, { pg = 1, signal, concurrency = 4, onSourceResult } = {}) {
  //处于自动暂停期（近 2h 判定 down）的源不参与本轮搜索；全部暂停时退回全量
  let srcs = activeSources((state.settings?.cmsSources || []).filter((s) => s.enabled !== false && s.searchable !== false));
  //按健康评分降序排列——优质源优先请求，快源结果先到达 UI（源优先级调度）
  srcs = [...srcs].sort((a, b) => sourceScore(b.id) - sourceScore(a.id));
  const items = [];
  let cursor = 0;
  const poolSize = Math.max(1, Math.min(srcs.length || 1, Number(concurrency) || 4));
  const worker = async () => {
    while (cursor < srcs.length) {
      if (signal?.aborted) return;
      const src = srcs[cursor++];
      let item;
      try {
        const r = await searchCms(src, wd, { pg, signal });
        item = { src, vods: r.list || [], count: (r.list || []).length, ok: true, stale: !!r.__stale };
      } catch (e) {
        if (signal?.aborted || e?.name === 'AbortError') return;
        item = { src, vods: [], count: 0, ok: false, err: e?.message || '请求失败' };
      }
      items.push(item);
      try { onSourceResult?.({ src: item.src, ok: item.ok, count: item.count, err: item.err || '', completed: items.length, total: srcs.length, results: mergeSearchHits(items, wd), sourceResults: [...items] }); } catch {}
    }
  };
  await Promise.all(Array.from({ length: poolSize }, worker));
  if (signal?.aborted) throw new DOMException('Search cancelled', 'AbortError');
  const merged = mergeSearchHits(items, wd);
  rememberHits(merged); // 会话内记忆命中线路，详情/播放页复用
  return merged;
}

/**
 * cms-parser.ts 核心算法：
 * 1. 季数识别（parseSeasonSuffix）——搜索"庆余年2"也能匹配"庆余年 第二季"
 * 2. 关键词归一化（normalizeTitle）——忽略标点大小写
 * 3. 智能关键词过滤（isRelevant）——多词查询逐词命中
 * 4. 从简介文本提取 m3u8（extractM3u8FromText）——部分源列表无播放地址，简介里有
 * 5. 从详情页 HTML 提取 m3u8（parseDetailPageHtml）——爬详情页兜底
 */

/* ---- 标题归一化 ---- */
export function normalizeTitleLibre(s) {
  return String(s || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

/* ---- 季数解析 ---- */
function parseSeasonSuffix(title, allowAnnotations = false, bareNeedsSpace = true) {
  const t = String(title || '').trim();
  // 第X季模式
  const explicitRe = allowAnnotations
    ? new RegExp('^(.*?)\\s*第\\s*([1-9]\\d?|[一二两三四五六七八九十]{1,3})\\s*季.*$', 'u')
    : new RegExp('^(.*?)\\s*第\\s*([1-9]\\d?|[一二两三四五六七八九十]{1,3})\\s*季$', 'u');
  const explicit = t.match(explicitRe);
  const bare = t.match(bareNeedsSpace
    ? new RegExp('^(.*?)\\s+([1-9]\\d?)$', 'u')
    : new RegExp('^(.*?)\\s*([1-9]\\d?)$', 'u'));
  const match = explicit ?? bare;
  if (!match || !normalizeTitleLibre(match[1])) return undefined;
  const value = match[2];
  const digits = '零一二三四五六七八九';
  let season = Number(value);
  if (!Number.isFinite(season)) {
    const chinese = value.replace('两', '二');
    if (/^[一二三四五六七八九]$/u.test(chinese)) season = digits.indexOf(chinese);
    else if (/^[一二三四五六七八九]?十[一二三四五六七八九]?$/u.test(chinese)) {
      const [tens, units] = chinese.split('十');
      season = (tens ? digits.indexOf(tens) : 1) * 10 + (units ? digits.indexOf(units) : 0);
    }
  }
  if (!Number.isFinite(season)) return undefined;
  return { base: match[1], season, explicit: Boolean(explicit) };
}

/* ---- 关键词命中（数字完整匹配） ---- */
function includesKeyword(title, keyword) {
  if (!title || !keyword) return false;
  let index = title.indexOf(keyword);
  while (index >= 0) {
    const before = title[index - 1] ?? '';
    const after = title[index + keyword.length] ?? '';
    if ((!/\d/u.test(keyword) || !/\d/u.test(before)) &&
        (!/\d$/u.test(keyword) || !/\d$/u.test(after))) return true;
    index = title.indexOf(keyword, index + 1);
  }
  return false;
}

/* ---- 搜索结果相关性过滤 ---- */
export function isRelevantResult(name, wd) {
  const nName = normalizeTitleLibre(name);
  const nWd = normalizeTitleLibre(wd);
  if (!nWd) return true;
  // 直接包含
  if (includesKeyword(nName, nWd)) return true;
  // 季数匹配
  const qSeason = parseSeasonSuffix(wd, false, false);
  const tSeason = parseSeasonSuffix(name, true);
  if (qSeason && tSeason) {
    if (qSeason.season !== tSeason.season) return false;
    if (qSeason.explicit || tSeason.explicit) {
      const baseMatch = includesKeyword(normalizeTitleLibre(tSeason.base), normalizeTitleLibre(qSeason.base));
      if (baseMatch) return true;
    }
  }
  // 多词逐词命中
  const tokens = wd.trim().split(/\s+/).map(normalizeTitleLibre).filter(Boolean);
  return tokens.length > 1 && tokens.every((t) => includesKeyword(nName, t));
}

/* ---- 从简介文本提取 m3u8 ---- */
const M3U8_TEXT_PATTERN = /\$https?:\/\/[^"'\s]+?\.m3u8/g;
export function extractM3u8FromText(text) {
  if (!text) return [];
  const matches = String(text).match(M3U8_TEXT_PATTERN) || [];
  return [...new Set(matches.map((link) => link.replace(/^\$/, '')))];
}

/* ---- 从详情页 HTML 提取 m3u8 ---- */
export function extractM3u8FromHtml(html) {
  if (!html) return [];
  let matches = html.match(/\$https?:\/\/[^"'\s]+?\.m3u8/g) || [];
  if (!matches.length) {
    matches = html.match(/\$https?:\/\/[^"'\s]+?\/\d{8}\/\d+_[a-f0-9]+\/index\.m3u8/g) || [];
  }
  return [...new Set(matches)].map((link) => {
    let u = link.substring(1);
    const pi = u.indexOf('(');
    if (pi > 0) u = u.substring(0, pi);
    return u;
  });
}

/**
 * 增强：播放地址后处理
 * 1. 播放页自动补全（/play/xxx → /play/xxx/index.m3u8）
 * 2. 分享页标记（需后续提取）
 */
function enhancePlayUrl(url) {
  const u = String(url || '').trim();
  if (!u) return u;
  const lower = u.toLowerCase();
  // 极速资源模式：/play/xxx 无扩展名 → 补全 /index.m3u8
  if (/\/play\/[a-zA-Z0-9]+$/.test(lower) && !/(m3u8|mp4|webm|flv)/.test(lower)) {
    return u + '/index.m3u8';
  }
  return u;
}

/**
 * 地址清洗（URL 规范化）：
 * - 去首尾空白与不可见字符
 * - 协议相对 // 补全为 https:
 * - 修正常见错误协议（http;// htp:// 等）
 * - 去掉地址尾部的管道符与多余斜杠
 */
export function cleanPlayUrl(raw) {
  let u = String(raw || '').trim().replace(/[​‎‏﻿]/g, '');
  if (!u) return '';
  if (u.startsWith('//')) u = 'https:' + u;
  u = u.replace(/^(https?)[;：]/i, '$1:').replace(/^(https?):\/+/, '$1://');
  u = u.replace(/[|＋+]+$/, '');
  return u;
}

/**
 * 分享页解析：从页面 HTML 提取真实视频地址
 * 量子资源模式：var main = "/path/index.m3u8"
 */
export async function extractFromSharePage(url, { timeout = 8000 } = {}) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeout), mode: 'cors', referrerPolicy: 'no-referrer' });
    const html = await r.text();
    // 量子资源模式：var main = "/20250304/21904_bd1a228a/index.m3u8?sign=..."
    const m = html.match(/var\s+main\s*=\s*["']([^"']+)["']/);
    if (m) {
      const base = new URL(url).origin;
      const videoUrl = base + m[1];
      return { ok: true, url: videoUrl, type: 'm3u8' };
    }
    // 通用模式：直接查找 m3u8/mp4 URL
    const urls = html.match(/https?:\/\/[^\s"'<>]+(?:m3u8|mp4|flv|webm)[^\s"'<>]*/i);
    if (urls) return { ok: true, url: urls[0], type: 'direct' };
    return { ok: false, reason: 'no video found' };
  } catch (e) {
    return { ok: false, reason: e?.message || 'fetch failed' };
  }
}

/* ============================================================
 maccms v10 播放地址解析：
   "线路A$第01集$url#第02集$url$$$线路B$..." → [{name, eps:[{label,url}]}]
   ============================================================ */
export function parsePlayUrl(vod_play_url = '', vod_play_from = '') {
  const froms = String(vod_play_from || '').split('$$$');
  return String(vod_play_url || '').split('$$$').map((block, i) => {
    const eps = block.split('#').map((seg) => {
      const match = seg.match(/https?:\/\/[^\s]+/i);
      if (!match) return null;
      let url = toHttps(cleanPlayUrl(match[0]));
      //播放页自动补全
      url = enhancePlayUrl(url);
      const p = seg.indexOf(match[0]);
      return { label: (seg.slice(0, p).replace(/\$+/g, ' ').trim() || '第1集'), url };
    }).filter(Boolean);
    return { name: (froms[i] || '').trim() || '线路' + (i + 1), eps };
  }).filter((l) => l.eps.length);
}

/* 直链媒体判定 —— 与 player.typeOf 支持范围对齐（m3u8/mp4/webm/flv）。
 通用约定：vod_play_from 里叫 "xxxm3u8" 的线是可直接播的直链，
 不带 m3u8 的线（如 /share/、/play/ 页面）是"解析线"，需第三方解析。 */
export function isPlayableUrl(u = '') {
  const s = String(u || '').toLowerCase();
  return s.includes('m3u8') || s.includes('.mp4') || s.includes('.webm') || s.includes('.flv');
}

/** 线路排序：直链（m3u8/mp4）优先置顶、解析线沉底；组内保持原相对顺序。
    这样默认线路（l=0）就是可播的，不再"点开就不支持"。 */
export function sortLinesPlayable(lines = []) {
  const score = (ln) => ((ln.eps || []).some((e) => isPlayableUrl(e.url))) ? 1 : 0;
  return [...lines].sort((a, b) => score(b) - score(a));
}

/* ============================================================
   详情跨源聚合：主源详情 + 其余源并行"同名搜索→取详情"，
   输出 { vod, key, plays:[{src, lines}] } 供播放页"全站资源"切换
   ============================================================ */
export async function aggregateDetail(srcId, vodId, { limit = 5, fast = false, fresh = false } = {}) {
  const srcs = state.settings.cmsSources;
  const src = srcs.find((s) => String(s.id) === String(srcId) && s.enabled !== false);
  if (!src) throw new Error(`找不到影片所属来源：${srcId}。为避免串片，已停止回退到其他来源。`);
  // 主源详情是播放必需的关键路径；先完成它，不能让跨源搜索拖慢首播。
  const vod = await getDetailCms(src, vodId, { fresh });
  const key = normalizeTitle(vod.vod_name);
  const year = String(vod.vod_year || '').trim();

  /* 搜索命中记忆：本次会话搜索过的同名片（严格年份匹配），
 直接复用已解析线路作为即时可选资源，后台再补全其余源。 */
  let instant = [];
  if (year) {
    const hit = recallHit(key + ':' + year);
    if (hit && Array.isArray(hit.fastPlays)) {
      instant = hit.fastPlays
        .filter((fp) => String(fp.srcId) !== String(src.id))
        .map((fp) => ({ src: { id: fp.srcId, name: fp.srcName || fp.srcId }, vod: { ...hit }, lines: fp.lines, fromSearch: true }))
        .filter((pl) => Array.isArray(pl.lines) && pl.lines.some((ln) => Array.isArray(ln.eps) && ln.eps.length));
    }
  }

  const primary = { src, vod, lines: sortLinesPlayable(parsePlayUrl(vod.vod_play_url, vod.vod_play_from)) };
  const instantIds = new Set(instant.map((pl) => String(pl.src.id)));
  // 跳过 10 分钟内搜索失败的源，避免详情页反复打坏死的源。
  const others = srcs.filter((s) => s.id !== src.id && s.enabled !== false && !instantIds.has(String(s.id)) && (fresh || !searchRecentlyFailed(s.id))).slice(0, limit);
  const loadExtras = async () => {
    const extras = await Promise.all(others.map(async (s) => {
      try {
        const hits = await searchCms(s, vod.vod_name, { fresh });
        // 同名只作为候选：年份存在时严格匹配；若源站无年份则仍需标题完全一致。
        const hit = (hits.list || []).find((v) => normalizeTitle(v.vod_name) === key && (!year || String(v.vod_year || '').trim() === year));
        if (!hit || !hit.vod_id) return null;
        const d = await getDetailCms(s, hit.vod_id, { fresh });
        // 再次验证 ID，禁止接口返回错误影片时把它加入线路列表。
        if (String(d.vod_id) !== String(hit.vod_id) || normalizeTitle(d.vod_name) !== key) return null;
        if (year && String(d.vod_year || '').trim() !== year) return null;
        const lines = sortLinesPlayable(parsePlayUrl(d.vod_play_url, d.vod_play_from));
        return lines.length ? { src: s, vod: d, lines } : null;
      } catch { return null; }
    }));
    return extras.filter(Boolean);
  };
  if (fast) {
    // 播放页立即使用主源线路 + 搜索命中快取；跨源补充在后台进行，不阻塞播放器创建。
    return { vod, key, plays: [primary, ...instant], more: loadExtras() };
  }
  const extras = await loadExtras();
  return { vod, key, plays: [primary, ...instant, ...extras] };
}

/* ============================================================
 分类解析：每个采集源的分类 ID 体系完全不同（实测：
 国产剧在多数源=13、在 md=26；动漫 360=40、md=2；电影类常被
 拆成 动作片/喜剧片/爱情片…）。首页全局 ID(1/2/3/4) 只能当兜底，
 正式请求前必须把「分类名」解析成「该源本地 type_id」。
 ============================================================ */

/** 分类名 → 语义桶。判定顺序决定归属优先级。 */
const CATEGORY_RULES = [
  ['zongyi', (n) => n.includes('综艺')],
  ['dongman', (n) => /动漫|动画|番剧/.test(n)],
  ['dianying', (n) => n.includes('电影') || (n.endsWith('片') && !n.includes('剧'))],
  ['lianxuju', (n) => n.includes('剧') && !/直播|广告/.test(n)]
];
export function categoryKey(name = '') {
  const n = String(name || '').replace(/\s+/g, '');
  if (!n) return '';
  for (const [key, test] of CATEGORY_RULES) if (test(n)) return key;
  return normalizeTitle(n) || '';
}

/**
 * 在源本地分类表里解析分类名（核心）：
 * - 精确同名 → 桶一致 → 名称关键词互含 → 全局 ID 作最后兜底
 * 返回 { id, name, via }；完全无法解析返回 null（由调用方降级为客户端筛选）。
 */
export function resolveLocalType(types = [], wantName = '', globalId = null) {
  const names = Array.isArray(types) ? types : [];
  const raw = String(wantName || '').replace(/\s+/g, '');
  if (!raw) {
    if (globalId != null && names.some((x) => String(x.id) === String(globalId))) {
      const hit = names.find((x) => String(x.id) === String(globalId));
      return { id: +globalId, name: String(hit?.name || '').trim(), via: 'id' };
    }
    return null;
  }
  const key = categoryKey(raw);
  let best = null, bestScore = -1;
  for (const x of names) {
    const tn = String(x.name || '').replace(/\s+/g, '');
    if (!tn) continue;
    let s = -1;
    if (tn === raw) s = 100;
    else if (key && categoryKey(tn) === key) s = 80;
    else if (tn.includes(raw) || raw.includes(tn)) s = 60;
    if (s > bestScore) { bestScore = s; best = x; }
  }
  if (best) return { id: +best.id, name: String(best.name).trim(), via: 'map' };
  if (globalId != null) return { id: +globalId, name: raw, via: 'id' };
  return null;
}

/** 客户端兜底筛选：按分类桶过滤列表条目（源不支持 t 参数时使用） */
export function filterByType(list = [], wantName = '') {
  const key = categoryKey(wantName);
  if (!key || !Array.isArray(list)) return list || [];
  return list.filter((v) => {
    const tn = String(v.type_name || v.vod_class || '');
    return categoryKey(tn) === key;
  });
}

/* 分类表归纳：扫描源前 3 页默认列表收集 type_id→name 映射。
 与本地累积表（KTYPES）做并集：近 7 日内容窗口可能全是剧集而漏掉"电影"等分类，
 曾见过的分类会持久记忆，跨会话越来越全。空表不缓存，瞬时失败不固化。
 3 页串行 → 并行（原来是分类页首屏最大 30s+ 阻塞的主因之一）。 */
export async function collectTypes(src) {
  const key = 'types:' + src.id;
  const hit = await cacheGet(key); if (hit && !hit.stale && hit.data?.length) return hit.data;
  const known = (await kvGet('KTYPES:' + src.id)) || [];
  const map = new Map((Array.isArray(known) ? known : []).map((x) => [String(x.id), x.name]));
  const pages = await Promise.all([1, 2, 3].map((pg) => getList(src, { pg, h: 24 * 7 }).catch(() => null)));
  for (const r of pages) {
    for (const v of r?.list || []) {
      if (v.type_id != null && v.type_name && !map.has(String(v.type_id))) map.set(String(v.type_id), v.type_name);
    }
  }
  const arr = [...map.entries()].map(([id, name]) => ({ id, name })).slice(0, 120);
  if (arr.length) {
    cacheSet(key, arr, 12 * 3600e3);
    kvSet('KTYPES:' + src.id, arr).catch(() => {});
  }
  return arr;
}

/* ============================================================
 源自动暂停（，TTL 自动停用思路）：
 近 2 小时内被判定 down 的源不参与首页/搜索聚合 —— 坏死源每轮都要
 白等一轮超时，是弱网下"首页长时间骨架"的最大元凶。到期自动恢复
 尝试；「数据源」页单测成功会立即刷新健康度、提前唤醒。
 ============================================================ */
const AUTOPAUSE_MS = 2 * 3600e3;
export function isAutoPaused(srcId, now = Date.now()) {
  const h = state.health?.[srcId];
  return !!(h && h.status === 'down' && h.last && (now - h.last) < AUTOPAUSE_MS);
}
/** 过滤掉处于自动暂停期的源；若全部被暂停（可能整体网络异常），退回全量尝试 */
export function activeSources(list, now = Date.now()) {
  const arr = Array.isArray(list) ? list : [];
  const live = arr.filter((s) => !isAutoPaused(s.id, now));
  return live.length ? live : arr;
}
