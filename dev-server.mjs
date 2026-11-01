/**
 * 知影录全栈服务器（V33 起）
 *
 *  架构思路（）：
 *  - /api/proxy|img|stream   复用 worker/proxy-core.js（与 Cloudflare 生产部署一致）
 *  - /api/recommend          豆瓣推荐（服务端直连 + Referer 伪装 + 内存 TTL 缓存）
 *  - /api/liveparse          M3U 订阅解析（服务端拉取，规避浏览器 CORS）
 *  - 静态资源服务 + ESM 源码直载（开发模式）
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleProxy, handleImg, handleStream } from './worker/proxy-core.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT || 8787);

/* ============================================================
   V33 服务端基础设施（ fetch-utils.ts）
   ============================================================ */

/** 内存 TTL 缓存（推荐/订阅等热点数据；LRU 简单防膨胀） */
const memCache = new Map();
function cacheGet(key) {
  const e = memCache.get(key);
  if (!e) return undefined;
  if (Date.now() > e.exp) { memCache.delete(key); return undefined; }
  return e.value;
}
function cacheSet(key, value, ttlMs) {
  if (memCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of memCache) if (now > v.exp) memCache.delete(k);
    if (memCache.size > 500) memCache.clear();
  }
  memCache.set(key, { value, exp: Date.now() + ttlMs });
}

/** 服务端上游请求：安全重定向（手动逐跳，最多5跳）+ 超时 + 重试一次 */
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
async function fetchUpstream(rawUrl, { timeoutMs = 8000, headers = {} } = {}) {
  let current = rawUrl;
  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      for (let hop = 0; hop <= 5; hop++) {
        const c = new AbortController();
        const t = setTimeout(() => c.abort(), timeoutMs);
        let upstream;
        try { upstream = await fetch(current, { redirect: 'manual', signal: c.signal, headers }); }
        finally { clearTimeout(t); }
        if (!REDIRECT_CODES.has(upstream.status)) return { res: upstream, finalUrl: current };
        const loc = upstream.headers.get('location');
        if (!loc || hop === 5) return { res: upstream, finalUrl: current };
        current = new URL(loc, current).href;
      }
    } catch { /* 重试一次 */ }
  }
  throw new Error('上游请求失败');
}

function jsonResponse(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(data));
}

/* ============================================================
   V33 /api/recommend — 豆瓣推荐（ douban.ts）
   服务端直连豆瓣搜索接口，带 Referer 伪装与 10 分钟内存缓存
   ============================================================ */
const DOUBAN_API = 'https://movie.douban.com/j/search_subjects';
const DOUBAN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

/* ============================================================
   V105 /api/catcovers — 快速分类卡封面（豆瓣标签榜首张）
   电影=movie热门 连续剧=tv热门 综艺=tv综艺 动漫=tv动漫
   服务端直连 + CM 镜像链 + 30min 缓存
   ============================================================ */
const CAT_COVER_MAP = [
  ['电影', 'movie', '热门'],
  ['连续剧', 'tv', '热门'],
  ['综艺', 'tv', '综艺'],
  ['动漫', 'tv', '动漫'],
];

async function handleCatCovers(url, res) {
  const ck = 'catcovers';
  const hit = cacheGet(ck);
  if (hit) return jsonResponse(res, 200, { source: 'douban-tags', cache: true, map: hit });

  const map = {};
  for (const [cat, type, tag] of CAT_COVER_MAP) {
    try {
      const target = `https://movie.douban.com/j/search_subjects?type=${type}&tag=${encodeURIComponent(tag)}&page_limit=3&page_start=0`;
      const { res: up } = await fetchUpstream(target, {
        timeoutMs: 7000,
        headers: { 'User-Agent': DOUBAN_UA, Referer: 'https://movie.douban.com/', Accept: 'application/json' },
      });
      if (!up.ok) continue;
      const data = await up.json();
      const list = Array.isArray(data.subjects) ? data.subjects : [];
      const first = list.find((x) => x && x.cover);
      if (!first) continue;
      const cover = String(first.cover).trim();
      map[cat] = {
        title: String(first.title || ''),
        rate: String(first.rate || ''),
        chain: [
          cover.replace(/img\d+\.doubanio\.com/g, 'img.doubanio.cmliussss.net'),
          cover.replace(/img\d+\.doubanio\.com/g, 'img.doubanio.cmliussss.com'),
          `/api/img?url=${encodeURIComponent(cover)}`,
        ].filter((x, i, a) => a.indexOf(x) === i),
      };
    } catch { /* 单类失败不影响其他 */ }
  }
  if (!Object.keys(map).length) return jsonResponse(res, 502, { error: 'catcovers_empty' });
  cacheSet(ck, map, 30 * 60e3);
  return jsonResponse(res, 200, { source: 'douban-tags', cache: false, map });
}

/* ============================================================
   V101 /api/covers — 批量按片名查豆瓣封面
   输入 names（逗号分隔，≤20）→ 并发 4 调豆瓣 subject_suggest
   匹配（标题指纹 + 年份）→ 返回映射 + CM 镜像链封面，缓存 30 分钟
   ============================================================ */
const DOUBAN_SUGGEST_API = 'https://movie.douban.com/j/subject_suggest?q=';

/* V102 豆瓣最新榜索引（降级源）：suggest 被限流时，用最新榜全集做片名→封面映射。
   实测可用：search_subjects?type=movie|tv&tag=最新&sort=time，自带封面/时间。 */
let latestIndexCache = null;   // { at, map: <normTitle, {title, cover, year}> }
async function getLatestIndex() {
  const KEY = 'douban-latest-index';
  const hit = cacheGet(KEY);
  if (hit) return hit;
  const normTitle = (s) => String(s || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  const map = {};
  for (const [type, tag] of [['movie', '最新'], ['tv', '热门']]) {
    try {
      const target = `https://movie.douban.com/j/search_subjects?type=${type}&tag=${encodeURIComponent(tag)}&sort=time&page_limit=50&page_start=0`;
      const { res: up } = await fetchUpstream(target, {
        timeoutMs: 8000,
        headers: { 'User-Agent': DOUBAN_UA, Referer: 'https://movie.douban.com/', Accept: 'application/json' },
      });
      if (!up.ok) continue;
      const data = await up.json();
      for (const it of Array.isArray(data.subjects) ? data.subjects : []) {
        if (!it || !it.title || !it.cover) continue;
        const k = normTitle(it.title);
        if (k && !map[k]) map[k] = { title: it.title, cover: String(it.cover).trim(), year: String(it.year || '').match(/(?:19|20)\d{2}/)?.[0] || '' };
      }
    } catch { /* 单类失败不影响另一类 */ }
  }
  cacheSet(KEY, map, 30 * 60e3);
  return map;
}

async function handleCovers(url, res) {
  const namesRaw = String(url.searchParams.get('names') || '').trim();
  if (!namesRaw) return jsonResponse(res, 400, { error: 'missing_names' });
  const names = namesRaw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
  if (!names.length) return jsonResponse(res, 400, { error: 'empty_names' });

  const out = {};
  const pending = [];
  for (const name of names) {
    const ck = 'cover:' + name;
    const hit = cacheGet(ck);
    if (hit) { out[name] = hit; continue; }
    pending.push(name);
  }

  // 并发 4 查豆瓣
  let cursor = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      const name = pending[cursor++];
      try {
        const target = DOUBAN_SUGGEST_API + encodeURIComponent(name.slice(0, 40));
        const { res: up } = await fetchUpstream(target, {
          timeoutMs: 6000,
          headers: { 'User-Agent': DOUBAN_UA, Referer: 'https://movie.douban.com/', Accept: 'application/json' },
        });
        if (!up.ok) { out[name] = null; continue; }
        const data = await up.json();
        const rows = Array.isArray(data) ? data : [];
        // 匹配：标题指纹相等（去标点/空白/大小写）优先，其次包含
        const norm = (s) => String(s || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
        const targetNorm = norm(name);
        const hitRow = rows.find((it) => it && it.img && norm(it.title) === targetNorm)
          || rows.find((it) => it && it.img && (norm(it.title).includes(targetNorm.slice(0, 4)) || targetNorm.includes(norm(it.title).slice(0, 4))));
        // V102 降级：suggest 无结果/被限流 → 用最新榜索引映射
        let cover = hitRow ? String(hitRow.img || '').trim() : '';
        let matchTitle = hitRow ? String(hitRow.title || '') : '';
        let matchYear = hitRow ? String(hitRow.year || '').match(/(?:19|20)\d{2}/)?.[0] || '' : '';
        if (!cover) {
          const index = await getLatestIndex();
          const idxHit = index[targetNorm];
          if (idxHit) { cover = idxHit.cover; matchTitle = idxHit.title; matchYear = idxHit.year; }
        }
        const result = cover ? {
          cover,
          // CM 镜像链（豆瓣图床 418 直连，必须镜像/反代）
          chain: [
            cover.replace(/img\d+\.doubanio\.com/g, 'img.doubanio.cmliussss.net'),
            cover.replace(/img\d+\.doubanio\.com/g, 'img.doubanio.cmliussss.com'),
            `/api/img?url=${encodeURIComponent(cover)}`,
          ].filter((x, i, a) => a.indexOf(x) === i),
          title: matchTitle,
          year: matchYear,
          provider: 'douban',
        } : null;
        out[name] = result;
        cacheSet('cover:' + name, result, 30 * 60e3);
      } catch { out[name] = null; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, pending.length || 1) }, worker));
  return jsonResponse(res, 200, { source: 'douban-suggest', cached: names.length - pending.length, map: out });
}

async function handleRecommend(url, res) {
  const type = url.searchParams.get('type') === 'tv' ? 'tv' : 'movie';
  const tag = (url.searchParams.get('tag') || '热门').slice(0, 20);
  const pageStart = Math.max(0, Number(url.searchParams.get('start')) || 0);
  const pageSize = Math.min(60, Math.max(1, Number(url.searchParams.get('limit')) || 20));
  const cacheKey = `douban:${type}:${tag}:${pageStart}:${pageSize}`;
  const hit = cacheGet(cacheKey);
  if (hit) return jsonResponse(res, 200, { source: 'douban', cache: true, items: hit });

  const target = `${DOUBAN_API}?type=${type}&tag=${encodeURIComponent(tag)}&sort=recommend&page_limit=${pageSize}&page_start=${pageStart}`;
  try {
    const { res: up } = await fetchUpstream(target, {
      timeoutMs: 8000,
      headers: { 'User-Agent': DOUBAN_UA, Referer: 'https://movie.douban.com/', Accept: 'application/json' },
    });
    if (!up.ok) return jsonResponse(res, 502, { error: 'douban_upstream_' + up.status });
    const data = await up.json();
    const list = (data.subjects || [])
      .filter((s) => s && s.title)
      .map((s) => ({ id: String(s.id || ''), title: s.title, cover: s.cover || '', rating: s.rate && s.rate !== '0' ? s.rate : undefined, isTv: type === 'tv' }));
    cacheSet(cacheKey, list, 10 * 60e3);
    return jsonResponse(res, 200, { source: 'douban', cache: false, items: list });
  } catch (e) {
    return jsonResponse(res, 502, { error: 'douban_fetch_failed', message: String(e?.message || e).slice(0, 120) });
  }
}

/* ============================================================
   V34 /api/hotboard — 多源高分榜单聚合（豆瓣周榜 + 多题材）
   - 豆瓣 chart/top_list 多题材并行拉取（剧情/动作/科幻/动画/爱情/悬疑/战争/喜剧）
   - 合并去重、按豆瓣评分降序
   - 10 分钟内存缓存；单题材失败不影响整体
   ============================================================ */
const DOUBAN_CHART = 'https://movie.douban.com/j/chart/top_list';
// 豆瓣题材 id（实测 2026-10-29 均返回高分数据）
const DOUBAN_GENRES = [11, 5, 17, 25, 13, 10, 22, 24, 3, 16];

async function handleHotboard(url, res) {
  const limit = Math.min(40, Math.max(5, Number(url.searchParams.get('limit')) || 16));
  const cacheKey = 'hotboard:' + limit;
  const hit = cacheGet(cacheKey);
  if (hit) return jsonResponse(res, 200, { source: 'multisource', cache: true, items: hit });

  const perGenre = 8;
  const board = new Map();   // id → item
  try {
    const results = await Promise.all(DOUBAN_GENRES.map(async (g) => {
      try {
        const target = `${DOUBAN_CHART}?type=${g}&interval_id=100:90&action=&start=0&limit=${perGenre}`;
        const { res: up } = await fetchUpstream(target, {
          timeoutMs: 7000,
          headers: { 'User-Agent': DOUBAN_UA, Referer: 'https://movie.douban.com/', Accept: 'application/json' },
        });
        if (!up.ok) return [];
        const data = await up.json();
        return Array.isArray(data) ? data : [];
      } catch { return []; }
    }));
    for (const group of results) {
      for (const it of group) {
        if (!it || !it.title) continue;
        const id = String(it.id || it.title);
        if (board.has(id)) continue;
        board.set(id, {
          id,
          title: it.title,
          cover: String(it.cover_url || '').trim(),
          rating: Array.isArray(it.rating) && it.rating[0] ? String(it.rating[0]) : '',
          rank: Number(it.rank) || 0,
          types: Array.isArray(it.types) ? it.types.join('/') : '',
          regions: Array.isArray(it.regions) ? it.regions.join('/') : '',
        });
      }
    }
    const items = [...board.values()]
      .sort((a, b) => Number(b.rating) - Number(a.rating) || a.rank - b.rank)
      .slice(0, limit);
    if (!items.length) return jsonResponse(res, 502, { error: 'hotboard_empty' });
    cacheSet(cacheKey, items, 10 * 60e3);
    return jsonResponse(res, 200, { source: 'multisource', cache: false, genres: DOUBAN_GENRES.length, items });
  } catch (e) {
    return jsonResponse(res, 502, { error: 'hotboard_failed', message: String(e?.message || e).slice(0, 120) });
  }
}

/* ============================================================
   V33 /api/liveparse — M3U 订阅解析（服务端拉取， 思路）
   ============================================================ */
async function handleLiveparse(url, res) {
  const target = String(url.searchParams.get('url') || '').trim();
  if (!/^https?:\/\//i.test(target)) return jsonResponse(res, 400, { error: 'invalid_url' });
  const cacheKey = 'm3u:' + target;
  const hit = cacheGet(cacheKey);
  if (hit) return jsonResponse(res, 200, { cache: true, contentLen: 0, lines: null, raw: null, channels: hit });

  try {
    const { res: up, finalUrl } = await fetchUpstream(target, { timeoutMs: 12000, headers: { 'User-Agent': DOUBAN_UA } });
    if (!up.ok) return jsonResponse(res, 502, { error: 'upstream_' + up.status });
    const text = await up.text();
    // 服务端解析为频道列表（复用与前端一致的解析规则）
    const channels = parseM3uServer(text, finalUrl);
    cacheSet(cacheKey, channels, 30 * 60e3);
    return jsonResponse(res, 200, { cache: false, channels, total: channels.length });
  } catch (e) {
    return jsonResponse(res, 502, { error: 'fetch_failed', message: String(e?.message || e).slice(0, 120) });
  }
}

/** M3U 解析（服务端版；与前端 src/api/liveparser.js 同规则） */
function parseM3uServer(content, baseUrl) {
  const ATTR_RE = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
  const ATTR_STRIP_RE = /[a-zA-Z0-9_-]+="[^"]*"/g;
  const channels = [];
  if (!content) return channels;
  const seen = new Set();
  let ctx = null;
  const stableId = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };
  const normUrl = (raw) => {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return undefined;
    try {
      const r = new URL(trimmed, baseUrl);
      return (r.protocol === 'http:' || r.protocol === 'https:') ? r.href : undefined;
    } catch { return undefined; }
  };
  const nameFromUrl = (u) => {
    try {
      const p = new URL(u).pathname.split('/').filter(Boolean).pop();
      if (p) { const d = decodeURIComponent(p).replace(/\.(m3u8?|flv|ts|mp4)$/i, ''); if (d) return d; }
      return new URL(u).hostname;
    } catch { return '未命名频道'; }
  };
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.toUpperCase().startsWith('#EXTINF')) {
      const attrs = {};
      ATTR_RE.lastIndex = 0;
      let m;
      while ((m = ATTR_RE.exec(line))) attrs[m[1].toLowerCase()] = m[2].trim();
      const stripped = line.replace(ATTR_STRIP_RE, '').replace(/^#EXTINF\s*:\s*/i, '');
      const ci = stripped.indexOf(',');
      const title = (ci >= 0 ? stripped.slice(ci + 1) : stripped).trim().replace(/^"+|"+$/g, '');
      ctx = { attrs, title, extGroup: '' };
      continue;
    }
    if (line.toUpperCase().startsWith('#EXTGRP:')) {
      const g = line.slice(8).trim();
      if (ctx && g && !ctx.attrs['group-title']) ctx.extGroup = g;
      continue;
    }
    if (line.startsWith('#')) continue;
    const urlU = normUrl(line);
    const cur = ctx;
    ctx = null;
    if (!urlU || seen.has(urlU)) continue;
    seen.add(urlU);
    const attrs = cur?.attrs ?? {};
    const tvgId = attrs['tvg-id'];
    const logo = attrs['tvg-logo'] ? normUrl(attrs['tvg-logo']) : undefined;
    channels.push({
      id: tvgId || stableId(urlU),
      name: cur?.title || nameFromUrl(urlU),
      url: urlU,
      logo: logo || '',
      group: attrs['group-title'] || cur?.extGroup || '',
      tvgId: tvgId || '',
    });
  }
  return channels;
}

const BROWSER_UA_STR = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.map': 'application/json'
};

const IMPORTMAP = `<script type="importmap">${JSON.stringify({
  imports: {
    artplayer: '/node_modules/artplayer/dist/artplayer.mjs',
    'hls.js': '/node_modules/hls.js/dist/hls.mjs'
  }
})}</script>`;
const CSS_LINK = '<link rel="stylesheet" href="/src/styles/app.css">';

/** 原生 ESM 不支持 CSS import / import.meta.env，做最小转换 */
function transformJs(src) {
  return src
    .replace(/import\s+['"][^'"]*\.(?:css|scss|less)['"]\s*;?/g, '')
    .replace(/import\.meta\.env\.PROD\b/g, 'false')
    .replace(/import\.meta\.env\.\w+/g, 'undefined');
}

function transformHtml(html) {
  return html
    .replace('</head>', `${IMPORTMAP}\n${CSS_LINK}\n</head>`);
}

async function serveFile(filePath, res, { transform }) {
  let data;
  try { data = await readFile(filePath); } catch { return false; }
  const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  if (transform) {
    // 仅文本文件（html/js/css）做转换；二进制文件直接输出 Buffer
    res.end(transform(data.toString('utf8')));
  } else {
    res.end(data);
  }
  return true;
}

/** 把 Web Response（proxy-core 返回）转发到 Node 响应 */
async function sendWebResponse(webRes, res) {
  const headers = {};
  webRes.headers.forEach((v, k) => { headers[k] = v; });
  res.writeHead(webRes.status, headers);
  res.end(Buffer.from(await webRes.arrayBuffer()));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = normalize(url.pathname);

    // ---- 中继（复用 worker/proxy-core，与生产一致）----
    if (path === '/api/proxy' || path === '/api/health') {
      const webReq = new Request(url.href, { method: req.method, headers: req.headers });
      return sendWebResponse(await handleProxy(webReq, {}), res);
    }
    if (path === '/api/img') {
      const webReq = new Request(url.href, { method: req.method, headers: req.headers });
      return sendWebResponse(await handleImg(webReq, {}), res);
    }
    if (path === '/api/stream' || path.startsWith('/api/stream/')) {
      const webReq = new Request(url.href, { method: req.method, headers: req.headers });
      return sendWebResponse(await handleStream(webReq, {}), res);
    }
    // ---- V33 全栈 API（ 服务端能力）----
    if (path === '/api/recommend') {
      return handleRecommend(url, res);
    }
    if (path === '/api/covers') {
      return handleCovers(url, res);
    }
    if (path === '/api/catcovers') {
      return handleCatCovers(url, res);
    }
    if (path === '/api/hotboard') {
      return handleHotboard(url, res);
    }
    if (path === '/api/liveparse') {
      return handleLiveparse(url, res);
    }

    // ---- 静态资源 ----
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return serveFile(join(ROOT, 'index.html'), res, { transform: transformHtml });
    }
    if (url.pathname === '/favicon.svg') return serveFile(join(ROOT, 'public/favicon.svg'), res, {});
    if (url.pathname === '/logo.png' || url.pathname === '/logo-bai.png') return serveFile(join(ROOT, 'public/logo-bai.png'), res, {});
    if (url.pathname === '/manifest.webmanifest') return serveFile(join(ROOT, 'public/manifest.webmanifest'), res, {});
    if (url.pathname === '/sw.js') return serveFile(join(ROOT, 'public/sw.js'), res, {});

    if (path.startsWith('/src/')) {
      const filePath = join(ROOT, path);
      return serveFile(filePath, res, { transform: path.endsWith('.js') ? transformJs : null });
    }
    if (path.startsWith('/node_modules/')) {
      return serveFile(join(ROOT, path), res, {});
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found: ' + url.pathname);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Internal error: ' + (e?.message || e));
  }
});

server.listen(PORT, () => console.log(`[Zhiyinglu dev server] http://localhost:${PORT}`));