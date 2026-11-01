const DEFAULT_ALLOWED_DOMAINS = [
  'bfzyapi.com',
  'lziapi.com',
  'ffzyapi.com',
  '360zy.com',
  'hongniuzy2.com',
  'ikunzyapi.com',
  'maotaizy.cc',
  'dyttzyapi.com',
  'jszyapi.com',
  'juliang.live',
  'yyzy-tv.vip',
  // V30 新增采集源域名
  'heimuer.xyz',
  'wolongzyw.com',
  'suoniapi.com',
  'apiyhzy.com',
  'apibdzy.com',
  'wujinapi.com',
  'haiwaikan.com',
  'hw8.live',
  'huyaapi.com',
  'tyyszy.com',
  'rycjapi.com',
  'sdzyapi.com',
  'kczyapi.com',
  'zuidapi.com',
  'niuniuzy.me',
  'ukuapi.com',
  'hhzyapi.com',
  'xinlangapi.com',
  'mozhuazy.com',
  '49zyw.com',
  'wwzy.tv',
  // V11 封面聚合数据源（只读公开接口）
  'movie.douban.com',
  'douban.com',
  'api.bgm.tv',
  'api.wmdb.tv'
];

/* 图片反代白名单：内置源站当前使用的图床域名 + 封面聚合图床（详情见 handleImg）。
   自定义图床通过环境变量 IMG_HOSTS 追加（逗号分隔）。 */
const DEFAULT_IMG_HOSTS = [
  'p.bfvp26.com',
  'img.lzipic.com',
  'fffgood.com',
  'hongniuzyimage.com',
  'empimage.slcache.com',
  'img.jisuimage.com',
  'img.dytt-tupian.com',
  'doubanio.com',
  'lain.bgm.tv',
  'img.wmdb.tv',
  // V33 新增采集源图床（实测 2026-10-28）
  'p.lztutu.com',        // 量子资源（高频图床）
  'img.bdzyimg1.com',    // 百度资源
  'image.huyajs.com',    // 虎牙资源
  'img.bfzypic.com',     // 暴风资源
  'www.imgzy360.com',    // 360资源
  'pic.youkupic.com',    // U酷/通用
  'ok.zuidapic.com',     // 最大资源
  // V40 图片镜像域名（weserv 家族，加速通道）
  'images.weserv.nl',
  'wsrv.nl',
  // V16：豆瓣图床公共 CDN 镜像（公共镜像方案），中继侧也放行以便兜底
  'cmliussss.net',
  'cmliussss.com'
];

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_IMG_BYTES = 8 * 1024 * 1024;
const CACHE_SECONDS = 300;
const IMG_CACHE_SECONDS = 3600;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const BUILD_ID = 'zhiyinglu-proxy-v11-2026-10-27';

function allowedDomains(env) {
  const extra = String(env?.SOURCE_HOSTS || '')
    .split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  return [...new Set([...DEFAULT_ALLOWED_DOMAINS, ...extra])];
}

function isAllowedHost(host, env) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return false;
  // 不允许 IP 字面量，避免把代理变成内网请求入口。
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(h) || h.includes(':')) return false;
  return allowedDomains(env).some((d) => h === d || h.endsWith('.' + d));
}

function responseJson(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      // 允许页面托管在其他域名时仍能调用本中继（设置页自定义中继基址场景）
      'access-control-allow-origin': '*',
      ...extra
    }
  });
}

/* ============================================================
   请求合并（singleflight，请求去重合并思路）：
   同一目标 URL 的并发请求共享一次上游抓取 —— 首页 12 个源同时回源时，
   相同 URL（如同一热门列表）只打一次上游，显著降低被采集站限流的概率。
   注意：成功结果以 ArrayBuffer 形式共享，每个等待者用 buffer 副本重建
   Response（Response body 只能消费一次）。
   ============================================================ */
const INFLIGHT = new Map();
function coalesce(key, loader) {
  let flight = INFLIGHT.get(key);
  if (!flight) {
    flight = loader().finally(() => INFLIGHT.delete(key));
    INFLIGHT.set(key, flight);
  }
  return flight;
}

/**
 * 同域影视 API 中继。仅接受 allowlist 中的上游域名，禁止任意 URL 转发。
 * 浏览器端统一请求 /api/proxy?url=<encoded-source-url>，Worker 侧缓存 5 分钟。
 */
export async function handleProxy(request, env = {}) {
  const requestUrl = new URL(request.url);
  if (requestUrl.pathname === '/api/health' || requestUrl.pathname === '/health') {
    return responseJson({
      service: 'Zhiyinglu API proxy', build: BUILD_ID, ok: true,
      route: requestUrl.pathname, timestamp: new Date().toISOString(),
      sourceHostAllowlistCount: allowedDomains(env).length,
      sourceHostsExtraConfigured: Boolean(String(env?.SOURCE_HOSTS || '').trim())
    }, 200, { 'x-zhiyinglu-build': BUILD_ID });
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400'
    }});
  }
  if (request.method !== 'GET') return responseJson({ error: 'method_not_allowed' }, 405, { allow: 'GET, OPTIONS' });

  const raw = requestUrl.searchParams.get('url');
  if (!raw) return responseJson({ error: 'missing_url', message: '请提供 url 参数' }, 400);

  let target;
  try { target = new URL(raw); } catch { return responseJson({ error: 'invalid_url' }, 400); }
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
    return responseJson({ error: 'invalid_protocol' }, 400);
  }
  if (!isAllowedHost(target.hostname, env)) {
    return responseJson({ error: 'host_not_allowed', host: target.hostname, message: '该上游域名未加入 SOURCE_HOSTS 白名单' }, 403);
  }
  // 不接受片段，也不转发请求方自带的敏感身份信息。
  target.hash = '';

  const cache = globalThis.caches?.default;
  const cacheKey = new Request(`${requestUrl.origin}/api/proxy-cache?target=${encodeURIComponent(target.href)}`, { method: 'GET' });
  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    } catch { /* Cache API 在本地测试运行器中可能不可用，继续走上游。 */ }
  }

  const outcome = await coalesce('P:' + target.href, () => fetchProxyUpstream(target, env));
  if (!outcome.ok) {
    return responseJson(outcome.payload, 502, { 'x-zhiyinglu-build': BUILD_ID, ...(outcome.extraHeaders || {}) });
  }

  const headers = new Headers();
  headers.set('content-type', outcome.contentType || 'text/plain; charset=utf-8');
  headers.set('cache-control', `public, max-age=0, s-maxage=${CACHE_SECONDS}`);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('access-control-allow-origin', '*');
  headers.set('x-zhiyinglu-proxy', '1');
  headers.set('x-zhiyinglu-build', BUILD_ID);
  headers.set('x-zhiyinglu-upstream-host', outcome.host);
  const response = new Response(outcome.body.slice(0), { status: 200, headers });
  if (cache) {
    try { await cache.put(cacheKey, response.clone()); } catch { /* 缓存写入失败不影响本次返回。 */ }
  }
  return response;
}

/* 上游抓取（含白名单重定向跟随 / 超时 / 体积上限），结果供 singleflight 共享 */
async function fetchProxyUpstream(target, env) {
  let upstream;
  // 允许最多 3 次经过白名单校验的 HTTP 重定向，避免常见的规范域名跳转被误判；
  // 每一跳都重新校验目标主机，绝不把 Worker 变成任意 URL/内网代理。
  let current = target;
  for (let hop = 0; hop <= 3; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8500);
    try {
      upstream = await fetch(current.href, {
        method: 'GET', redirect: 'manual', signal: controller.signal,
        headers: {
          accept: 'application/json, application/xml, text/xml, text/plain;q=0.9, */*;q=0.8',
          // V14：上游 UA 改用桌面浏览器标识。自定义 UA（Zhiyinglu-Proxy/1.0）
          // 会被部分采集站的反爬规则直接拦截，浏览器 UA 是社区采集客户端的通行做法。
          'user-agent': BROWSER_UA
        }
      });
    } catch (error) {
      clearTimeout(timer);
      const aborted = error?.name === 'AbortError';
      return { ok: false, payload: { error: aborted ? 'upstream_timeout' : 'upstream_unreachable', message: aborted ? '上游请求超过 8.5 秒' : String(error?.message || '上游连接失败').slice(0, 180) } };
    }
    clearTimeout(timer);
    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get('location');
      if (!location || hop === 3) return { ok: false, payload: { error: 'upstream_redirect_blocked', status: upstream.status, message: '缺少 Location 或重定向次数超限' } };
      let next;
      try { next = new URL(location, current); } catch { return { ok: false, payload: { error: 'upstream_redirect_blocked', status: upstream.status } }; }
      if (!['http:', 'https:'].includes(next.protocol) || next.username || next.password || !isAllowedHost(next.hostname, env)) {
        return { ok: false, payload: { error: 'upstream_redirect_blocked', status: upstream.status, host: next.hostname, message: '重定向目标不在允许域名列表中' } };
      }
      current = next;
      continue;
    }
    break;
  }
  if (!upstream) return { ok: false, payload: { error: 'upstream_unreachable', message: '未收到上游响应' } };
  if (!upstream.ok) {
    const status = upstream.status;
    const message = status === 401 ? '源站要求认证或授权；Worker 无法绕过源站权限' : status === 403 ? '源站拒绝访问，可能存在授权、IP 或 Referer 限制' : status === 429 ? '源站请求过于频繁' : '源站返回非成功状态';
    return {
      ok: false,
      payload: { error: status === 401 ? 'upstream_auth_required' : 'upstream_http_error', status, upstreamStatus: status, message, host: current.hostname },
      extraHeaders: { 'x-zhiyinglu-upstream-status': String(status) }
    };
  }
  const declaredLength = Number(upstream.headers.get('content-length') || 0);
  if (declaredLength > MAX_BODY_BYTES) return { ok: false, payload: { error: 'response_too_large' } };

  let body;
  try { body = await upstream.arrayBuffer(); } catch { return { ok: false, payload: { error: 'upstream_read_failed' } }; }
  if (body.byteLength > MAX_BODY_BYTES) return { ok: false, payload: { error: 'response_too_large' } };
  return { ok: true, body, contentType: upstream.headers.get('content-type'), host: current.hostname };
}

/* ============================================================
   图片反代 /api/img?url=...（V10 封面聚合的落地通道）：
   - 仅允许 IMG_HOSTS 白名单域名（+ env.IMG_HOSTS），拒绝任意 URL 转发与 IP 直连；
   - 豆瓣图床（doubanio.com）对无 Referer 请求返回 418，这里补带合法 Referer；
   - Cloudflare 缓存 1 小时、8MB 上限、同域输出（图片标签天然可用，也带 ACAO 便于 blob 缓存）。
   ============================================================ */
/* ============================================================
   流媒体中继 /api/stream?url=...（V20）
   问题：采集站 m3u8 常无 CORS（实测非凡 feifei-play.com 的子列表与 .ts
   分片均无 Access-Control-Allow-Origin），浏览器里 hls.js 跨域拉分片被
   CORS 拦截 => "无法播放"，而量子/暴风带 CORS 头所以能放——这就是"各平台
   格式不统一、有的能播有的不能播"的根因。
   做法（IPTV 类项目标准方案）：m3u8 与分片经同域转发——
   清单在服务端把子列表/分片/KEY/MAP 地址重写为本中继，浏览器全程同源请求，
   天然规避跨域；同时服务端带浏览器 UA 绕过部分防盗链/反爬。
   安全：仅放行媒体类型（m3u8 / video / audio / 常见分片容器），拒绝网页；
   可用 MEDIA_HOSTS 环境变量（逗号分隔）进一步收紧域名白名单。
   ============================================================ */

/** 把 m3u8 里的相对/绝对 URI（子列表、分片、EXT-X-KEY/MAP）重写为流中继地址 */
function rewriteM3u8(text, baseHref, streamPrefix) {
  const wrap = (u) => {
    try { return streamPrefix + encodeURIComponent(new URL(String(u).trim(), baseHref).href); }
    catch { return u; }
  };
  return text.split(/\r?\n/).map((line) => {
    if (/^#EXT-X-(?:KEY|MAP|MEDIA|SESSION-KEY|I-FRAME-STREAM-INF)\s*:/i.test(line)) {
      line = line.replace(/URI="([^"]*)"/gi, (_m, u) => 'URI="' + wrap(u) + '"');
    }
    const t = line.trim();
    if (t && !t.startsWith('#')) return wrap(t);   // 子列表 / 分片行
    return line;
  }).join('\n');
}

/** 媒体分片/文件直通：透传状态码与 Range，补同源 CORS。V33  缓存策略：
    分片/清单 1 小时，覆盖流式资源；图片类 30 天（需 content-type 判定） */
function passStream(upstream) {
  const h = new Headers(upstream.headers);
  h.set('access-control-allow-origin', '*');
  h.set('access-control-expose-headers', 'content-range, content-length, accept-ranges, etag, last-modified');
  h.delete('content-security-policy');
  h.delete('x-frame-options');
  const ct = (h.get('content-type') || '').toLowerCase();
  if (!h.get('cache-control')) {
    h.set('cache-control', ct.startsWith('image/') ? 'public, max-age=2592000' : 'public, max-age=3600');
  }
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: h });
}

export async function handleStream(request, env = {}) {
  const requestUrl = new URL(request.url);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': '*', 'access-control-max-age': '86400' } });
  }
  if (request.method !== 'GET') return responseJson({ error: 'method_not_allowed' }, 405, { allow: 'GET, OPTIONS' });

  const raw = requestUrl.searchParams.get('url');
  if (!raw) return responseJson({ error: 'missing_url' }, 400);
  let target;
  try { target = new URL(raw); } catch { return responseJson({ error: 'invalid_url' }, 400); }
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
    return responseJson({ error: 'invalid_protocol' }, 400);
  }
  // 可选域名白名单（默认内容类型门控；配了 MEDIA_HOSTS 才限制域名）
  const whitelist = String(env?.MEDIA_HOSTS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (whitelist.length) {
    const h = String(target.hostname || '').toLowerCase();
    if (!whitelist.some((d) => h === d || h.endsWith('.' + d))) return responseJson({ error: 'host_not_allowed', host: h }, 403);
  }

  // 跟随重定向（CDN 跳转常见），并据最终地址 rebase 分片相对路径
  const rangeHeader = request.headers.get('range');
  let current = target;
  let upstream = null;
  for (let hop = 0; hop <= 5; hop++) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 15000);
    const h = { 'user-agent': BROWSER_UA };
    if (rangeHeader) h.range = rangeHeader;
    try { upstream = await fetch(current.href, { method: 'GET', redirect: 'manual', signal: c.signal, headers: h }); }
    catch { clearTimeout(t); return responseJson({ error: 'upstream_unreachable' }, 502); }
    clearTimeout(t);
    if (upstream.status >= 300 && upstream.status < 400) {
      const loc = upstream.headers.get('location');
      if (!loc || hop === 5) return responseJson({ error: 'upstream_redirect_blocked' }, 502);
      try { current = new URL(loc, current); } catch { return responseJson({ error: 'upstream_redirect_blocked' }, 502); }
      continue;
    }
    if (!upstream.ok) return passStream(upstream);   // 透传 4xx 让播放器拿到真实状态
    break;
  }
  if (!upstream) return responseJson({ error: 'upstream_unreachable' }, 502);

  const ct = (upstream.headers.get('content-type') || '').toLowerCase();
  const declared = Number(upstream.headers.get('content-length') || 0);
  const manifestLike = /mpegurl|m3u8|^text\/plain|^text\/html/.test(ct);
  const mediaLike = /^video\/|^audio\/|octet-stream|mp2t|mpeg|mp4|m4s|fmp4/.test(ct) || (ct === '' && declared > 0);

  // 明显是媒体分片/文件 → 直通（Range/CORS），不读文本
  if (mediaLike && !manifestLike) return passStream(upstream);

  // 疑似清单 → 读文本判断；超大则按媒体直通
  const MAX_MANIFEST = 2 * 1024 * 1024;
  if (declared > MAX_MANIFEST) return passStream(upstream);
  const text = await upstream.text().catch(() => null);
  if (text != null && text.trimStart().startsWith('#EXTM3U')) {
    // 用根相对路径重写，由 hls.js 按清单自身协议+域名解析（dev 与生产都正确，规避 localhost 问题）
    const body = rewriteM3u8(text, current.href, `/api/stream?url=`);
    return new Response(body, { status: 200, headers: {
      'content-type': 'application/vnd.apple.mpegurl; charset=utf-8',
      'cache-control': 'private, no-cache',
      'access-control-allow-origin': '*'
    } });
  }
  return responseJson({ error: 'not_streamable_media', content_type: ct }, 415);
}

export async function handleImg(request, env = {}) {
  const requestUrl = new URL(request.url);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400'
    }});
  }
  if (request.method !== 'GET') return responseJson({ error: 'method_not_allowed' }, 405, { allow: 'GET, OPTIONS' });

  const raw = requestUrl.searchParams.get('url');
  if (!raw) return responseJson({ error: 'missing_url', message: '请提供 url 参数' }, 400);
  let target;
  try { target = new URL(raw); } catch { return responseJson({ error: 'invalid_url' }, 400); }
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
    return responseJson({ error: 'invalid_protocol' }, 400);
  }
  const host = String(target.hostname || '').toLowerCase().replace(/\.$/, '');
  // 不允许 IP 字面量 / 端口 / 空主机，避免把图片代理变成内网探测入口。
  if (!host || host.includes(':') || /^(\d{1,3}\.){3}\d{1,3}$/.test(host)) {
    return responseJson({ error: 'host_not_allowed', host }, 403);
  }
  const extra = String(env?.IMG_HOSTS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const allowed = [...new Set([...DEFAULT_IMG_HOSTS, ...extra])];
  if (!allowed.some((d) => host === d || host.endsWith('.' + d))) {
    return responseJson({ error: 'host_not_allowed', host, message: '该图片域名未加入 IMG_HOSTS 白名单' }, 403);
  }

  const cache = globalThis.caches?.default;
  const cacheKey = new Request(`${requestUrl.origin}/api/img-cache?target=${encodeURIComponent(target.href)}`, { method: 'GET' });
  if (cache) {
    try { const hit = await cache.match(cacheKey); if (hit) return hit; } catch { /* 本地测试运行器可能无 Cache API。 */ }
  }

  // V14：图片请求合并 —— 同一海报被多张卡片/多页面同时引用时只回源一次
  const outcome = await coalesce('I:' + target.href, () => fetchImgUpstream(target, host));
  if (!outcome.ok) return responseJson(outcome.payload, 502);

  const respHeaders = new Headers();
  respHeaders.set('content-type', outcome.contentType || 'image/jpeg');
  respHeaders.set('cache-control', `public, max-age=${IMG_CACHE_SECONDS}`);
  respHeaders.set('x-content-type-options', 'nosniff');
  respHeaders.set('x-zhiyinglu-build', BUILD_ID);
  respHeaders.set('access-control-allow-origin', '*');
  const resp = new Response(outcome.body.slice(0), { status: 200, headers: respHeaders });
  if (cache) {
    try { await cache.put(cacheKey, resp.clone()); } catch { /* 缓存失败不影响返回。 */ }
  }
  return resp;
}

async function fetchImgUpstream(target, host) {
  const headers = { accept: 'image/*, */*;q=0.8', 'user-agent': BROWSER_UA };
  // 豆瓣图床反爬：无 Referer 返回 418，这里补带豆瓣站内 Referer（社区图床反代的通行做法）。
  if (host.endsWith('doubanio.com')) headers.referer = 'https://movie.douban.com/';

  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), 8500);
  let upstream;
  try {
    upstream = await fetch(target.href, { method: 'GET', headers, signal: c.signal });
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, payload: { error: 'upstream_unreachable', message: String(e?.message || '图片源连接失败').slice(0, 160) } };
  }
  clearTimeout(timer);
  if (!upstream.ok) {
    return { ok: false, payload: { error: 'upstream_http_error', status: upstream.status, upstreamStatus: upstream.status, message: `图片源返回 HTTP ${upstream.status}`, host } };
  }
  const declared = Number(upstream.headers.get('content-length') || 0);
  if (declared > MAX_IMG_BYTES) return { ok: false, payload: { error: 'response_too_large' } };
  let body;
  try { body = await upstream.arrayBuffer(); } catch { return { ok: false, payload: { error: 'upstream_read_failed' } }; }
  if (body.byteLength > MAX_IMG_BYTES) return { ok: false, payload: { error: 'response_too_large' } };
  return { ok: true, body, contentType: upstream.headers.get('content-type') };
}
