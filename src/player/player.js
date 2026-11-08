import { state } from '../core/state.js';

/* ============================================================
    m3u8.ts 广告过滤算法：
   在 hls.js 播放前预处理播放列表，剔除片头/中插广告段
   
   ============================================================ */

/** 片头广告判定上限：≤90s 且 ≤20 个分片 */
const LEAD_AD_MAX_SECONDS = 90;
const LEAD_AD_MAX_SEGMENTS = 20;

/** 中插广告判定：段时长 ≤30s 且前后邻段均 ≥120s */
const INTERSTITIAL_MAX_SECONDS = 30;
const INTERSTITIAL_NEIGHBOR_MIN_SECONDS = 120;

/** 广告分片 URL 特征 */
const AD_URL_PATTERN = /adjump|advert|\/ads?\//i;

function isDiscLine(l) { return l.trim() === '#EXT-X-DISCONTINUITY'; }
function isSegmentLine(l) { const t = l.trim(); return t !== '' && !t.startsWith('#'); }

/** 按 DISCONTINUITY 切分 m3u8 为组 */
function scanAdGroups(lines) {
  const discIdx = [];
  for (let i = 0; i < lines.length; i++) if (isDiscLine(lines[i])) discIdx.push(i);
  const bounds = [0, ...discIdx, lines.length];
  const groups = [];
  for (let k = 0; k < bounds.length - 1; k++) {
    const start = k === 0 ? 0 : bounds[k] + 1;
    const end = bounds[k + 1];
    let seconds = 0, count = 0;
    for (let i = start; i < end; i++) {
      const m = lines[i].trim().match(/^#EXTINF:([\d.]+)/);
      if (m) seconds += parseFloat(m[1]) || 0;
      else if (isSegmentLine(lines[i])) count++;
    }
    groups.push({ start, end, discLine: k === 0 ? -1 : bounds[k], seconds, count });
  }
  return groups;
}

/** 剔除片头广告段（位于首分片前、短小、之后仍有内容） */
function stripLeadAdGroup(content) {
  const lines = content.split('\n');
  const groups = scanAdGroups(lines);
  if (groups.length < 2) return content;
  const lead = groups[0];
  if (lead.count === 0 || lead.count > LEAD_AD_MAX_SEGMENTS) return content;
  if (lead.seconds <= 0 || lead.seconds > LEAD_AD_MAX_SECONDS) return content;
  // 多分组同构时不删（可能是封装边界而非广告）
  if (groups.length >= 4) {
    const others = groups.slice(1).map(g => g.count).filter(c => c > 0).sort((a, b) => a - b);
    if (others.length) {
      const median = others[Math.floor(others.length / 2)];
      if (Math.abs(lead.count - median) <= Math.max(3, median * 0.5)) return content;
    }
  }
  const kept = lines.filter((l, i) => {
    if (i < lead.start || i >= lead.end) return true;
    const t = l.trim();
    return t.startsWith('#EXT-X-KEY') || t.startsWith('#EXT-X-MAP');
  });
  return kept.join('\n');
}

/** 剔除中插广告段（URL 特征 + 纯时长型） */
function stripInterstitialAdGroups(content) {
  const lines = content.split('\n');
  const groups = scanAdGroups(lines);
  const drop = new Array(lines.length).fill(false);
  let changed = false;
  for (let k = 1; k < groups.length; k++) {
    const g = groups[k];
    if (g.count === 0 || g.discLine < 0) continue;
    // URL 特征判定
    let allAd = true;
    for (let i = g.start; i < g.end; i++) {
      if (isSegmentLine(lines[i]) && !AD_URL_PATTERN.test(lines[i].trim())) { allAd = false; break; }
    }
    if (allAd) {
      drop[g.discLine] = true;
      for (let i = g.start; i < g.end; i++) {
        const t = lines[i].trim();
        if (!t.startsWith('#EXT-X-KEY') && !t.startsWith('#EXT-X-MAP')) drop[i] = true;
      }
      changed = true;
      continue;
    }
    // 纯时长型：短段夹在两长段之间
    const prev = groups[k - 1], next = groups[k + 1];
    if (g.seconds <= 0 || g.seconds > INTERSTITIAL_MAX_SECONDS) continue;
    if (!prev || prev.seconds < INTERSTITIAL_NEIGHBOR_MIN_SECONDS) continue;
    if (!next || next.seconds < INTERSTITIAL_NEIGHBOR_MIN_SECONDS) continue;
    drop[g.discLine] = true;
    for (let i = g.start; i < g.end; i++) {
      const t = lines[i].trim();
      if (!t.startsWith('#EXT-X-KEY') && !t.startsWith('#EXT-X-MAP')) drop[i] = true;
    }
    changed = true;
  }
  if (!changed) return content;
  return lines.filter((_, idx) => !drop[idx]).join('\n');
}

/** 清除首分片前的孤立 DISCONTINUITY */
function stripLeadingDisc(content) {
  const lines = content.split('\n');
  const firstSeg = lines.findIndex(l => { const t = l.trim(); return t !== '' && !t.startsWith('#'); });
  if (firstSeg <= 0) return content;
  const kept = lines.filter((l, i) => !(i < firstSeg && isDiscLine(l)));
  return kept.join('\n');
}

/**
 * 广告过滤总入口：依次执行片头剔除 + 中插剔除 + 首行清理
 * @param {string} m3u8Content 原始播放列表
 * @returns {string} 过滤后的播放列表
 */
export function stripAdSegments(m3u8Content) {
  if (!m3u8Content || typeof m3u8Content !== 'string') return m3u8Content;
  let result = m3u8Content;
  result = stripLeadAdGroup(result);
  result = stripInterstitialAdGroups(result);
  result = stripLeadingDisc(result);
  return result;
}

/* ============================================================
   播放器依赖按需加载：路由级分割，仅播放页加载
   ============================================================ */
let depsPromise = null;
function loadPlayerDeps() {
  if (!depsPromise) {
    depsPromise = Promise.all([import('artplayer'), import('hls.js')])
      .then(([a, h]) => ({ Artplayer: a.default, Hls: h.default }));
    depsPromise.catch(() => { depsPromise = null; });
  }
  return depsPromise;
}

const ACCENT_HEX = { aurora: '#a855f7', vercel: '#6366f1', sunset: '#f472b6', mint: '#34d399' };
const themeColor = () => ACCENT_HEX[state.settings?.accent] || '#a855f7';

/* ============================================================
   格式探测：URL 路径模式 + Content-Type 嗅探 + 魔数检测
   isM3U8 探测思路和 source handler 注册
   ============================================================ */

/** 魔数签名：从内容前几个字节判断真实格式 */
const MAGIC_NUMBERS = [
  { format: 'm3u8', magic: '#EXTM3U', offset: 0 },
  { format: 'mp4',  magic: 'ftyp',    offset: 4 },
  { format: 'webm', magic: '\x1A\x45\xDF\xA3', offset: 0 },  // EBML header
  { format: 'flv',  magic: 'FLV',     offset: 0 },
  { format: 'ts',   magic: '\x47',    offset: 0 },           // MPEG-TS sync byte
];

/**
 * 通过内容前 N 字节判断媒体格式（魔数探测）。
 * 用于 URL 无扩展名时确定真实格式。
 */
export function sniffFormat(bytes) {
  if (!bytes || bytes.length < 4) return '';
  const view = new Uint8Array(bytes);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(view.slice(0, 16));
  for (const { format, magic, offset } of MAGIC_NUMBERS) {
    const check = text.slice(offset, offset + magic.length);
    if (check === magic) return format;
  }
  // MP4: ftyp box at offset 4
  if (view.length > 8 && view[4] === 0x66 && view[5] === 0x74 && view[6] === 0x79 && view[7] === 0x70) return 'mp4';
  return '';
}

/** 根据 URL 识别媒体类型 */
export function typeOf(url = '') {
  const u = String(url || '').toLowerCase();
  // m3u8: 路径含 .m3u8 或以 /index.m3u8 结尾
  if (u.includes('.m3u8') || u.includes('m3u8') || /\/index\.m3u8/.test(u)) return 'm3u8';
  // mp4
  if (u.includes('.mp4') || u.includes('mp4')) return 'mp4';
  // webm
  if (u.includes('.webm') || u.includes('webm')) return 'webm';
  // flv
  if (u.includes('.flv') || u.includes('flv')) return 'flv';
  // ts
  if (u.includes('.ts') && !u.includes('.ts.')) return 'ts';
  // 常见 HLS 路径模式
  if (/\/play\/.*\/index\.m3u8/.test(u) || /\/video\/.*\/index\.m3u8/.test(u)) return 'm3u8';
  // 常见直链 CDN 模式
  if (/\/video\/[a-zA-Z0-9]+\.(mp4|m3u8|flv|webm)/.test(u)) {
    return u.match(/\.(mp4|m3u8|flv|webm)/)?.[1] || '';
  }
  return '';
}

/** Content-Type → 格式映射 */
export function typeFromContentType(ct = '') {
  const c = String(ct || '').toLowerCase();
  if (c.includes('application/vnd.apple.mpegurl') || c.includes('application/x-mpegurl')) return 'm3u8';
  if (c.includes('application/dash+xml') || c.includes('video/vnd.mpeg.dash')) return 'mpd';
  if (c.includes('video/mp4'))  return 'mp4';
  if (c.includes('video/webm')) return 'webm';
  if (c.includes('video/x-flv')) return 'flv';
  if (c.includes('video/mp2t')) return 'ts';
  if (c.includes('video/'))     return 'mp4';
  if (c.includes('text/html'))  return 'page';
  return '';
}

/** 网页地址识别 */
export function looksLikePage(url = '') {
  try {
    const u = new URL(String(url));
    const p = u.pathname.toLowerCase();
    const search = u.search.toLowerCase();
    // 路径中已包含视频扩展名 → 不是页面
    if (/(m3u8|mp4|webm|flv|ts)(\?|$|#)/.test(p)) return false;
    // 分享页
    if (/\/share\//.test(p)) return true;
    // 播放页（无扩展名）
    if (/\/play\//.test(p) && !/(m3u8|mp4|webm|flv)/.test(p)) return true;
    // 其他 CMS 页面模式
    if (/\.(html|htm|php|asp|jsp|aspx|shtml)/.test(p) && !/(m3u8|mp4|webm|flv)/.test(p)) return true;
    // 查询参数含视频扩展名 → 不是页面
    if (search && /(m3u8|mp4|webm|flv|ts)/.test(search)) return false;
    return false;
  } catch { return false; }
}

/** 销毁 HLS 实例 */
export function destroyHls(art) {
  if (art?.hls) { try { art.hls.destroy(); } catch {} art.hls = null; }
}

/* ============================================================
   播放地址预检：HEAD 请求 + Range 拉取首 4KB 魔数嗅探
   manifest 加载策略和 source handler
   ============================================================ */

/**
 * 快速格式探测：HEAD 请求 Content-Type + Range 拉首 4KB 魔数嗅探。
 * 用于播放前确定 URL 的真实格式，避免创建错误类型的播放器。
 */
export async function quickProbe(url, { timeout = 4000 } = {}) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeout);
  try {
    // 第一步：HEAD 请求获取 Content-Type
    const r = await fetch(url, { method: 'HEAD', signal: c.signal, mode: 'cors', referrerPolicy: 'no-referrer' });
    const ct = String(r.headers.get('content-type') || '').toLowerCase();
    const isPage = /text\/html/.test(ct);
    const ctType = typeFromContentType(ct);
    if (isPage) return { type: 'page', page: true, ok: r.ok, via: 'head' };
    if (ctType && ctType !== 'mp4') return { type: ctType, page: false, ok: r.ok, via: 'head' };
    // 第二步：如果 HEAD 无法确定，Range 拉首 4KB 魔数嗅探
    const r2 = await fetch(url, { signal: c.signal, mode: 'cors', referrerPolicy: 'no-referrer', headers: { Range: 'bytes=0-4095' } });
    if (!r2.ok && r2.status !== 206) return { type: ctType || typeOf(url), page: false, ok: false, via: 'range-fail' };
    const buf = await r2.arrayBuffer();
    const sniffed = sniffFormat(buf);
    return { type: sniffed || ctType || typeOf(url), page: false, ok: true, via: 'sniff' };
  } catch {
    return { type: typeOf(url), page: looksLikePage(url), ok: false, via: 'fallback' };
  }
  finally { clearTimeout(t); }
}

/* ============================================================
   HLS Loader 工厂（ hls-loader.ts）：
   在 loader 层面组合广告过滤 + 分片缓存命中。
   hls.js 对每次请求 new 一个 loader 实例，destroyed 标记生命周期安全。
   ============================================================ */
function createAdFilterLoader(HlsCtor) {
  const DefaultLoader = HlsCtor.DefaultConfig.loader;
  return class AdFilterLoader extends DefaultLoader {
    constructor(config) {
      super(config);
      const load = this.load.bind(this);
      this.load = (context, config, callbacks) => {
        const isPlaylist = context.type === 'manifest' || context.type === 'level';
        if (isPlaylist) {
          // 播放列表：加载成功后过滤广告段
          const origSuccess = callbacks.onSuccess;
          callbacks.onSuccess = function (response, stats, ctx, networkDetails) {
            if (response.data && typeof response.data === 'string') {
              response.data = stripAdSegments(response.data);
            }
            origSuccess(response, stats, ctx, networkDetails);
          };
        }
        load(context, config, callbacks);
      };
    }
  };
}

export async function createPlayer(mount, { url, poster, live = false, probeType = '' } = {}) {
  const { Artplayer, Hls } = await loadPlayerDeps();
  const bestType = probeType || typeOf(url);
  return new Artplayer({
    container: mount, url, poster, type: bestType,
    isLive: live,
    autoplay: !!state.settings?.autoplay, autoSize: true, autoMini: false,
    playbackRate: !live, aspectRatio: true, screenshot: true, setting: true,
    hotkey: true, pip: true, airplay: true, fullscreen: true, fullscreenWeb: true,
    mutex: true, backdrop: true, theme: themeColor(), lang: 'zh-cn',
    moreVideoAttr: { 'webkit-playsinline': 'true', 'playsinline': 'true', 'x5-playsinline': 'true', 'x5-video-player-type': 'h5' },
    customType: {
      m3u8(video, url, art) {
        destroyHls(art);
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = url; video.load(); return;
        }
        if (!Hls.isSupported()) {
          try { art.notice.show = '此浏览器不支持 HLS；请切换线路'; } catch {}
          return;
        }
        const hls = new Hls({
          enableWorker: true, lowLatencyMode: false, backBufferLength: 60, maxBufferLength: 30,
          fragLoadingMaxRetry: 3, manifestLoadingMaxRetry: 2, levelLoadingMaxRetry: 3,
          fragLoadingRetryDelay: 800, manifestLoadingRetryDelay: 800, levelLoadingRetryDelay: 800,
          // 使用广告过滤 loader（ hls-loader.ts）
          loader: createAdFilterLoader(Hls),
          ...(live ? { liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 12, maxLiveSyncPlaybackRate: 1.5 } : {})
        });
        art.hls = hls;
        let netRetries = 0, mediaRecovered = false;
        const giveUp = (msg) => {
          try { art.notice.show = msg; } catch {}
          destroyHls(art);
          try { video.dispatchEvent(new Event('error')); } catch {}
        };
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data?.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            if (netRetries++ < 2) {
              try { art.notice.show = `HLS 网络波动，正在重试（${netRetries}/2）…`; } catch {}
              setTimeout(() => { try { hls.startLoad(); } catch {} }, 800 * netRetries);
            } else { giveUp('HLS 网络错误：检查视频地址、跨域许可或源站访问限制'); }
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            if (!mediaRecovered) {
              mediaRecovered = true;
              try { art.notice.show = '视频解码异常，正在尝试恢复'; } catch {}
              try { hls.recoverMediaError(); } catch {}
            } else { giveUp('视频解码失败，请切换线路'); }
          } else { giveUp(`HLS 播放失败：${data.details || data.type || '未知错误'}`); }
        });
      },
      // DASH 支持
      mpd(video, url, art) {
        destroyHls(art);
        if (Hls.isSupported()) {
          const hls = new Hls({ enableWorker: true, fragLoadingMaxRetry: 2, manifestLoadingMaxRetry: 2 });
          art.hls = hls;
          hls.loadSource(url); hls.attachMedia(video);
          let retries = 0;
          hls.on(Hls.Events.ERROR, (_e, data) => {
            if (!data?.fatal) return;
            if (retries++ < 1) { try { hls.startLoad(); } catch {} }
            else { try { art.notice.show = 'DASH 播放失败'; } catch {}; destroyHls(art); try { video.dispatchEvent(new Event('error')); } catch {} }
          });
        } else { video.src = url; video.load(); }
      },
      // FLV 原生尝试
      flv(video, url) { video.src = url; video.load(); },
      // TS 通过 HLS.js 加载
      ts(video, url, art) {
        destroyHls(art);
        if (Hls.isSupported()) {
          const hls = new Hls({ enableWorker: true });
          art.hls = hls; hls.loadSource(url); hls.attachMedia(video);
          hls.on(Hls.Events.ERROR, () => { try { video.dispatchEvent(new Event('error')); } catch {} });
        } else { video.src = url; video.load(); }
      },
    }
  });
}

/** 换集/换源统一入口 */
export function swapUrl(art, url) {
  try {
    const t = typeOf(url);
    if (t !== 'm3u8') destroyHls(art);
    if (art.type !== t && t) art.type = t;
    art.url = url;
    return true;
  } catch { return false; }
}

/**
 * 剧集 URL 测速：Range 拉取首 128KB + 格式探测。
 * 返回 { ok, ms, status, type, page }
 */
export async function probeUrl(url, { bytes = 131072, timeout = 7000 } = {}) {
  const t0 = performance.now();
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeout);
  try {
    const r = await fetch(url, { signal: c.signal, mode: 'cors', referrerPolicy: 'no-referrer', headers: { Range: `bytes=0-${bytes - 1}` } });
    if (!r.ok && r.status !== 206) return { ok: false, ms: Infinity, status: r.status, type: '', page: false };
    const ct = String(r.headers.get('content-type') || '').toLowerCase();
    const isPage = /text\/html/.test(ct) || looksLikePage(url);
    const fmt = typeFromContentType(ct) || typeOf(url);
    await r.arrayBuffer().catch(() => {});
    return { ok: !isPage, ms: Math.round(performance.now() - t0), status: r.status, type: fmt, page: isPage };
  } catch { return { ok: false, ms: Infinity, status: 0, type: '', page: false }; }
  finally { clearTimeout(t); }
}