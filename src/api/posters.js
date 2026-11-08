import { normalizeTitle, toHttps } from '../core/utils.js';
import { detectRelay, proxies, viaProxy, relayEndpoint, relayImageBase } from './adapters.js';
import { cacheGet, cacheSet } from '../core/db.js';
import { state } from '../core/state.js';
import { getDetailCms } from './cms.js';
import { rememberPoster } from '../core/postermemo.js';

/* ============================================================
   影视封面聚合 ：
   封面数据源三路并行取数，按可信度回退：
     1) 豆瓣 subject_suggest —— 华语/日韩内容覆盖最好（数据无 CORS，需走中继）
     2) Bangumi api.bgm.tv —— 动漫向补漏（数据无 CORS，需走中继；图床可直链）
     3) wmdb.tv —— 国际片向补漏（数据无 CORS，需走中继；图床可直链）
   每条结果均做「标题指纹 + 年份」双条件校验，防串片；结果 12h 缓存、
   负面 1h 缓存；全部失败静默降级，不影响首页主链路。
   图床策略：doubanio 无 Referer 一律 418 → 必须 /api/img 反代；
             lain.bgm.tv / img.wmdb.tv 实测可直链（并支持 https）。
   ============================================================ */

const DOUBAN_SUGGEST = 'https://movie.douban.com/j/subject_suggest?q=';
const BANGUMI_SEARCH = 'https://api.bgm.tv/search/subject/';
const WMDB_SEARCH = 'https://api.wmdb.tv/api/v1/movie/search?q=';

/* ---------- 各提供方的匹配纯函数（标题指纹 + 年份双条件） ---------- */

export function pickDoubanMatch(rows = [], name = '', year = '') {
  const key = normalizeTitle(name);
  if (!key || !Array.isArray(rows)) return null;
  const wantYear = yearOf(year);
  for (const it of rows) {
    if (!it || typeof it !== 'object' || !it.img) continue;
    if (normalizeTitle(it.title) !== key) continue;
    const y = yearOf(it.year);
    if (wantYear && y && y !== wantYear) continue;
    return { img: toHttps(String(it.img)), title: it.title, year: y, provider: 'douban', id: it.id || '' };
  }
  return null;
}

/* wmdb 响应：{data:[{..., data:[{name,poster,...}]}]}，海报在嵌套 data 数组里 */
export function pickWmdbMatch(rows = [], name = '', year = '') {
  const key = normalizeTitle(name);
  if (!key) return null;
  const outer = Array.isArray(rows) ? rows : [];
  const wantYear = yearOf(year);
  for (const it of outer) {
    const nested = Array.isArray(it?.data) ? it.data : [it].filter((x) => x && typeof x === 'object');
    for (const n of nested) {
      if (!n || typeof n !== 'object' || !n.poster) continue;
      const hit = normalizeTitle(n.name) === key || normalizeTitle(n.originalName) === key || normalizeTitle(it?.originalName) === key;
      if (!hit) continue;
      const y = yearOf(n.year || it?.year);
      if (wantYear && y && y !== wantYear) continue;
      return { img: toHttps(String(n.poster)), title: n.name || it?.originalName, year: y, provider: 'wmdb', id: it?.doubanId || '' };
    }
  }
  return null;
}

/* bangumi 响应：{list:[{name,name_cn,air_date,images:{large,common,medium,small}}]} */
export function pickBangumiMatch(rows = [], name = '', year = '') {
  const key = normalizeTitle(name);
  if (!key) return null;
  const list = Array.isArray(rows) ? rows : (Array.isArray(rows?.list) ? rows.list : []);
  const wantYear = yearOf(year);
  const legacy = normalizeTitle(name.replace(/第\s*[一二三四五六七八九十百千万\d]+\s*[季期部]/g, ''));
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    const titles = [it.name_cn, it.name, it.nameCn].map(normalizeTitle).filter(Boolean);
    // 允许"第X季"差异：CMS 名带季数而 Bangumi 不带时，用去季名指纹互认
    if (!titles.includes(key) && !titles.includes(legacy)) continue;
    const y = yearOf(it.air_date);
    if (wantYear && y && y !== wantYear) continue;
    const imgs = it.images || {};
    const img = toHttps(imgs.large || imgs.common || imgs.medium || imgs.small || '');
    if (!img) continue;
    return { img, title: it.name_cn || it.name, year: y, provider: 'bangumi', id: String(it.id || '') };
  }
  return null;
}

const yearOf = (v) => String(v || '').match(/(?:19|20)\d{2}/)?.[0] || '';

/* ---------- 传输：直连 → 同域中继 → 公共代理（逐级尝试） ---------- */
function fetchJson(url, { timeout = 4500, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const c = new AbortController();
    const t = setTimeout(() => { c.abort(); reject(new Error('外部封面查询超时')); }, timeout);
    fetch(url, { signal: c.signal, referrerPolicy: 'no-referrer', headers: { accept: 'application/json', ...headers } })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((d) => { clearTimeout(t); resolve(d); })
      .catch((e) => { clearTimeout(t); reject(e); });
  });
}

async function fetchVia(fullUrl, { timeout = 4500 } = {}) {
  /* 顺序修正：豆瓣/Bangumi/wmdb 实测均无 CORS 头（见 调研），
     中继可用时浏览器直连必然失败 —— 先试中继省掉一个注定失败的超时等待；
     无中继时才以直连起手（少数网络环境下仍可能通），公共代理殿后。 */
  const relayOk = await detectRelay();
  const attempts = relayOk ? [relayApi(fullUrl), fullUrl] : [fullUrl];
  for (const p of proxies()) attempts.push(viaProxy(p, fullUrl));
  for (const u of attempts) {
    try { return await fetchJson(u, { timeout }); } catch { /* 下一通道 */ }
  }
  return null;
}

async function cachedFetch(key, loader, ttlOk = 12 * 3600e3, ttlMiss = 3600e3) {
  const hit = await cacheGet(key);
  if (hit) return hit.data || null;
  try {
    const found = await loader();
    cacheSet(key, found, found ? ttlOk : ttlMiss).catch(() => {});
    return found || null;
  } catch { return null; }
}

/* ---------- 三个提供方 ---------- */

/** 搜索词裁剪：去掉集数/季尾注，豆瓣对冗长剧名匹配较差 */
function normalizeQuery(name = '') {
  return String(name)
    .replace(/第\s*[一二三四五六七八九十百千万\d]+\s*[季部]/g, '')
    .replace(/[（(【\[]([^）)】\]]{0,40})[）)】\]]$/g, '')
    .trim()
    .slice(0, 40);
}

export async function doubanPoster(name, year = '', { timeout = 4500 } = {}) {
  const key = 'DBP:' + normalizeTitle(name) + '|' + (yearOf(year) || 'no');
  return cachedFetch(key, async () => {
    const data = await fetchVia(DOUBAN_SUGGEST + encodeURIComponent(normalizeQuery(name)), { timeout });
    return pickDoubanMatch(Array.isArray(data) ? data : [], name, year);
  });
}

export async function bangumiPoster(name, year = '', { timeout = 4500 } = {}) {
  const key = 'DBB:' + normalizeTitle(name) + '|' + (yearOf(year) || 'no');
  return cachedFetch(key, async () => {
    const data = await fetchVia(`${BANGUMI_SEARCH}${encodeURIComponent(normalizeQuery(name))}?responseGroup=small&max_results=6&type=2`, { timeout });
    return pickBangumiMatch(data, name, year);
  });
}

export async function wmdbPoster(name, year = '', { timeout = 4500 } = {}) {
  const key = 'DBW:' + normalizeTitle(name) + '|' + (yearOf(year) || 'no');
  return cachedFetch(key, async () => {
    const data = await fetchVia(`${WMDB_SEARCH}${encodeURIComponent(normalizeQuery(name))}&limit=5`, { timeout });
    return pickWmdbMatch(data?.data, name, year);
  });
}

const ANIME_HINT = /动漫|动画|番剧|剧场版/;

/* 封面聚合并发限流 —— 首页一次性几十张空封面同时兜底时，限制同时进行的
   三方查询数（默认 4），避免把豆瓣/Bangumi/wmdb 打爆触发限流（限流会触发负缓存，
   反而让后续 1 小时都取不到封面）。 */
const COVER_LIMIT = 6;
let coverBusy = 0;
const coverWait = [];
function coverSlot() {
  return new Promise((res) => {
    if (coverBusy < COVER_LIMIT) { coverBusy++; res(); }
    else coverWait.push(res);
  });
}
function coverRelease() {
  const next = coverWait.shift();
  if (next) next(); else coverBusy--;
}

/** 并行竞速工具：多个 Promise 首个成功即返回（兼容无 Promise.any 的浏览器） */
function firstHit(promises) {
  return new Promise((resolve) => {
    let pending = promises.length;
    if (!pending) return resolve(null);
    let settled = false;
    for (const p of promises) {
      Promise.resolve(p).then((v) => {
        if (!settled && v) { settled = true; resolve(v); }
        else if (--pending === 0) resolve(null);
      }, () => { if (--pending === 0 && !settled) resolve(null); });
    }
  });
}

/** 聚合查询：豆瓣 / Bangumi / wmdb / 源站详情四路并行竞速，首个命中即返回
    （此前串行最坏 3×4.5s，现在最坏 = 单个超时 = 4.5s，典型命中 <1s） */
export async function coverPoster(name, year = '', typeName = '', opt = {}) {
  if (!name) return null;
  const t = String(typeName || '');
  const tasks = [
    doubanPoster(name, year, opt),
    wmdbPoster(name, year, opt),
  ];
  if (ANIME_HINT.test(t)) tasks.push(bangumiPoster(name, year, opt));
  return firstHit(tasks);
}

/* 豆瓣图床公共 CDN 镜像（公共 CDN 镜像方案：
   imgN.doubanio.com → img.doubanio.cmliussss.net / .com，腾讯/阿里 CDN 镜像，
   无需自有中继即可出图，国内网络下最可靠的豆瓣封面通道）。 */
export function doubanMirrorUrls(url = '') {
  const u = toHttps(String(url || '').trim());
  if (!/doubanio\.com/.test(u)) return [];
  const mirrors = [
    u.replace(/img\d+\.doubanio\.com/g, 'img.doubanio.cmliussss.net'),
    u.replace(/img\d+\.doubanio\.com/g, 'img.doubanio.cmliussss.com'),
  ];
  return [...new Set(mirrors.filter((x) => x !== u))];
}

/** 提供方图片直出 URL：豆瓣图床优先公共 CDN 镜像（无中继也能出图），其余可直链 */
export function posterImageSrc(provider = '', img = '') {
  const secure = toHttps(img);
  try {
    if (provider === 'douban' && new URL(secure).hostname.endsWith('doubanio.com')) {
      return doubanMirrorUrls(secure)[0] || relayImageUrl(secure);
    }
  } catch {}
  return secure;
}

/** 豆瓣封面的完整候选链：CDN 镜像 ×2 → 同域反代 → 原图（全部去重） */
export function doubanCandidateChain(img = '') {
  const secure = toHttps(img);
  return [...new Set([...doubanMirrorUrls(secure), relayImageUrl(secure), secure])].filter(Boolean);
}

/* ---------- 中继地址拼装（支持设置里自定义中继基址） ---------- */
export const relayApi = (url) => relayEndpoint(url);
export const relayImageUrl = (url) => relayImageBase(url);

/* ---------- 海报候选链（纯函数） ----------
 * 强化：每个候选自动配备 3 条加速镜像（weserv 压缩 320px / wsrv 压缩 / 反代），
 * 与"并行竞速填充"（ui.js raceFill）配合，反应最快的镜像先出图。 */
const WESERV = 'https://images.weserv.nl/?url=';
const WSRV = 'https://wsrv.nl/?url=';

/** 单图多镜像候选（按命中率排序：直连 → weserv小图 → wsrv小图） */
export function mirrorCandidates(pic = '') {
  const u = toHttps(String(pic || '').trim());
  if (!u || /^(data:|blob:)/i.test(u) || u.includes('/api/img')) return [];
  const enc = encodeURIComponent(u);
  return [
    u,
    `${WESERV}${enc}&w=320&output=jpg`,
    `${WSRV}${enc}&w=320&output=jpg`,
  ];
}

export function buildPosterChain(pic = '', pool = []) {
  const chain = [];
  const push = (u) => {
    const v = toHttps(String(u || '').trim());
    if (v && !chain.includes(v)) chain.push(v);
  };
  const p = toHttps(String(pic || '').trim());
  if (p) { push(p); push(WESERV + encodeURIComponent(p) + '&w=320&output=jpg'); push(WSRV + encodeURIComponent(p) + '&w=320&output=jpg'); }
  for (const u of Array.isArray(pool) ? pool : []) push(u);
  return chain;
}

/**
 * 中继增强候选链：探测到同域/自定义中继可用时，
 * 每个直链候选后面紧跟一个 /api/img 反代同图 —— 直连被墙或挂起时，
 * 由中继从服务器侧取图返回（同源输出，绕开防盗链/地区阻断），看门狗按序推进。
 */
export function buildPosterChainRelayed(pic = '', pool = [], relayOk = false) {
  const base = buildPosterChain(pic, pool);
  if (!relayOk) return base;
  const out = [];
  for (const u of base) {
    out.push(u);
    if (/^https:\/\//i.test(u) && !u.includes('/api/img') && !u.includes('images.weserv.nl')) {
      out.push(relayImageUrl(u));
    }
    if (out.length >= 10) break;
  }
  return [...new Set(out)];
}

/* ---------- 智能兜底：主链耗尽后异步聚合封面 ---------- */
const inflight = new Map();

/* 源站真封面 —— ac=list 不返回 vod_pic，而 ac=detail 有；新片豆瓣常未收录，
   源站自身才最可靠，且与"点开后看到的封面"一致。 */
async function sourcePoster(srcId, vodId) {
  try {
    const src = (state.settings?.cmsSources || []).find((x) => String(x.id) === String(srcId));
    if (!src || !src.api) return null;
    await coverSlot();
    try {
      const vod = await getDetailCms(src, String(vodId));
      const p = vod && typeof vod.vod_pic === 'string' ? vod.vod_pic.trim() : '';
      const url = p && !p.startsWith('data:') ? toHttps(p) : null;
      if (url) rememberPoster(srcId, vodId, url);   // 记住，返回首页瞬间出图
      return url;
    } finally { coverRelease(); }
  } catch { return null; }
}

export function applySmartFallback(img, { n: name, y: year, t: typeName, s: srcId, id: vodId } = {}) {
  const key = normalizeTitle(name || '') + '|' + (year || '') + '|' + (typeName || '') + '|' + (srcId || '') + '|' + (vodId || '');
  if (!key || img.dataset.smartDone) return;
  img.dataset.smartDone = '1';
  if (inflight.has(key)) return inflight.get(key);
  const task = (async () => {
    try {
      /* 顺序：1) 源站真封面 2) 豆瓣/Bangumi/wmdb 聚合 */
      let hit = null;
      if (srcId && vodId) {
        const pic = await sourcePoster(srcId, vodId);
        if (pic) hit = { img: pic, provider: 'source' };
      }
      if (!hit) hit = await coverPoster(name, year, typeName);
      if (!hit?.img) return false;
      let chain;
      if (hit.provider === 'douban') chain = doubanCandidateChain(hit.img);
      else if (hit.provider === 'source') chain = [...new Set([toHttps(hit.img), relayImageUrl(hit.img)])].filter(Boolean);
      else chain = [posterImageSrc(hit.provider, hit.img)].filter(Boolean);
      if (!chain.length) return false;
      img.dataset.fbi = '0';
      img.dataset.fb = JSON.stringify(chain.slice(1));
      img.src = chain[0];
      return true;
    } catch { return false; }
  })().finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}