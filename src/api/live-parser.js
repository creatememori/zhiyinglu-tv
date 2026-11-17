/**
 * 知影录 · 直播源 M3U 解析器 
 *
 * 
 *
 * 兼容两种写法：
 * - 标准：`#EXTINF:-1 tvg-id="cctv1" tvg-logo="..." group-title="央视",CCTV-1`
 * - 非标准（属性写在标题后）：`#EXTINF:-1,CCTV-1 tvg-id="cctv1"`
 * 另有 `#EXTGRP:分组名` 补充分组。
 *
 * 单趟扫描 O(n)，按 URL 去重，仅保留 http(s) 流（rtp/udp/rtsp 浏览器不可播，丢弃）。
 */

const ATTR_RE = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
const ATTR_STRIP_RE = /[a-zA-Z0-9_-]+="[^"]*"/g;

/** djb2 变体：任意字符串 → 稳定短 id */
function stableId(input) {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** 相对地址按订阅 URL 解析为绝对地址；仅放行 http(s) */
export function normalizeStreamUrl(raw, baseUrl) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return undefined;
  try {
    const resolved = new URL(trimmed, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return undefined;
    return resolved.href;
  } catch { return undefined; }
}

/** URL 无名时的兜底名称：路径末段 → decode → 主机名 */
function nameFromUrl(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop();
    if (last) {
      const decoded = decodeURIComponent(last).replace(/\.(m3u8?|flv|ts|mp4)$/i, '');
      if (decoded) return decoded;
    }
    return u.hostname;
  } catch { return '未命名频道'; }
}

/**
 * 解析 M3U / M3U8 直播播放列表
 * @param {string} content 播放列表文本
 * @param {string} [baseUrl] 订阅地址（用于解析相对地址）
 * @returns {Array<{id,name,url,logo,group,tvgId,rawName}>} 频道列表
 */
export function parseM3u(content, baseUrl) {
  const channels = [];
  if (!content) return channels;

  const seen = new Set();
  let ctx = null;

  for (const rawLine of String(content).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.toUpperCase().startsWith('#EXTINF')) {
      const attrs = {};
      ATTR_RE.lastIndex = 0;
      let m;
      while ((m = ATTR_RE.exec(line))) attrs[m[1].toLowerCase()] = m[2].trim();

      // 移除属性片段后取首个逗号之后的文本为显示名
      const stripped = line.replace(ATTR_STRIP_RE, '').replace(/^#EXTINF\s*:\s*/i, '');
      const commaIdx = stripped.indexOf(',');
      const title = (commaIdx >= 0 ? stripped.slice(commaIdx + 1) : stripped)
        .trim()
        .replace(/^"+|"+$/g, '');

      ctx = { attrs, title, extGroup: '' };
      continue;
    }

    if (line.toUpperCase().startsWith('#EXTGRP:')) {
      const g = line.slice('#EXTGRP:'.length).trim();
      if (ctx && g && !ctx.attrs['group-title']) ctx.extGroup = g;
      continue;
    }

    if (line.startsWith('#')) continue; // 其余指令（#EXTVLCOPT 等）忽略

    // 非注释行即流地址
    const url = normalizeStreamUrl(line, baseUrl);
    const cur = ctx;
    ctx = null;
    if (!url || seen.has(url)) continue;
    seen.add(url);

    const attrs = cur?.attrs ?? {};
    const tvgId = attrs['tvg-id'];
    const logo = attrs['tvg-logo'] ? normalizeStreamUrl(attrs['tvg-logo'], baseUrl) : undefined;
    const name = cur?.title || nameFromUrl(url);
    channels.push({
      id: tvgId || stableId(url),
      name,
      url,
      logo: logo || '',
      group: attrs['group-title'] || cur?.extGroup || '',
      tvgId: tvgId || '',
      rawName: attrs['tvg-name'] || '',
    });
  }

  return channels;
}

/**
 * 服务端解析：优先走同域 /api/liveparse（规避 CORS + 服务端缓存），
 * 失败时降级为客户端直接 fetch 解析。
 * @param {string} subscriptionUrl 订阅地址
 * @returns {Promise<Array>} 频道列表
 */
export async function fetchM3uChannels(subscriptionUrl) {
  const base = globalThis.location?.origin || '';
  let channels = [];
  let viaServer = true;
  try {
    // 1) 服务端解析
    const r = await fetch(base + '/api/liveparse?url=' + encodeURIComponent(subscriptionUrl), { cache: 'no-store' });
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data.channels) && data.channels.length) channels = data.channels;
    }
  } catch { viaServer = false; }

  if (!channels.length) {
    viaServer = false;
    try {
      // 2) 客户端直连兜底
      const r = await fetch(subscriptionUrl, { cache: 'no-store' });
      if (r.ok) channels = parseM3u(await r.text(), subscriptionUrl);
    } catch { channels = []; }
  }

  return { channels, viaServer };
}