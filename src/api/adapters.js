import { state } from '../core/state.js';

/** 直连 fetch（带超时）。CORS 被拦截时由 cms.js 自动降级 */
export async function httpFetch(url, { timeout = 9000, signal: externalSignal } = {}) {
  if (!/^https?:/.test(url)) throw new Error('非法地址');
  const c = new AbortController();
  const abortFromExternal = () => c.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
  const t = setTimeout(() => c.abort(new DOMException('Request timed out', 'TimeoutError')), timeout);
  try {
    const r = await fetch(url, { signal: c.signal, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!r.ok) {
      let detail = '';
      try {
        const body = (await r.text()).replace(/\s+/g, ' ').slice(0, 600);
        let parsed; try { parsed = JSON.parse(body); } catch {}
        if (parsed?.error === 'upstream_http_error' || parsed?.error === 'upstream_auth_required') {
          const code = Number(parsed.upstreamStatus || parsed.status || r.status);
          const hints = {
            401: '源站要求认证或授权；检查接口是否公开、是否需要密钥/白名单。中继不能绕过源站权限。',
            403: '源站拒绝访问；检查来源授权、IP/Referer 限制或站点策略。',
            404: '接口路径不存在；核对 API 地址及 JSON/XML 路径。',
            429: '源站限流；降低并发并等待后重试。'
          };
          detail = `上游 HTTP ${code}${hints[code] ? ' · ' + hints[code] : ''}`;
        } else if (parsed?.error === 'upstream_redirect_blocked') {
          detail = '源站发生跳转，中继已阻止未验证的重定向；需检查最终跳转域名。';
        } else if (parsed?.error === 'upstream_unreachable') {
          detail = 'Worker 无法连接源站：' + String(parsed.message || '').slice(0, 180);
        } else detail = body;
      } catch {}
      throw new Error('HTTP ' + r.status + (detail ? ' · ' + detail : ''));
    }
    return await r.text();
  } finally { clearTimeout(t); externalSignal?.removeEventListener('abort', abortFromExternal); }
}

/** JSONP：老款无 CORS 的 AppleCMS 用 script 标签跨域取数（callback/cb/jsonp 三键齐发兼容） */
export function httpJsonp(rawUrl, { timeout = 9000 } = {}) {
  return new Promise((resolve, reject) => {
    const name = '__gv_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    let done = false;
    const s = document.createElement('script');
    const fin = (fn, arg) => { if (done) return; done = true; clearTimeout(t); s.remove(); try { delete window[name]; } catch {} fn(arg); };
    const t = setTimeout(() => fin(reject, new Error('jsonp timeout')), timeout);
    window[name] = (data) => fin(resolve, data);
    const u = new URL(rawUrl);
    u.searchParams.set('callback', name); u.searchParams.set('cb', name); u.searchParams.set('jsonp', name);
    s.src = u.href;
    s.onerror = () => fin(reject, new Error('jsonp load error'));
    document.head.appendChild(s);
  });
}

export const viaProxy = (proxy, url) => proxy + encodeURIComponent(url);
export const proxies = () => (state.settings?.proxies || []).filter(Boolean);

/* ---------- 同域 / 自定义中继基址 ---------- */
export const relayBase = () => {
  const custom = String(state.settings?.relayBase || '').trim().replace(/\/+$/, '');
  if (custom) return custom;
  const origin = globalThis.location?.origin || '';
  return origin === 'null' || origin === 'file://' ? '' : origin;
};
const relayUrl = (path, target) => {
  const e = new URL(path, (relayBase() || 'http://localhost') + '/');
  e.searchParams.set('url', String(target || ''));
  return e.href;
};
export const relayEndpoint = (url) => relayUrl('/api/proxy', url);
export const relayImageBase = (url) => relayUrl('/api/img', url);
export const relayStreamUrl = (url) => relayUrl('/api/stream', url);   // 媒体流同源中继（m3u8 分片）

/* ---------- 同域中继能力探测（会话内一次） ----------
 * 支持两种形态：同域 Pages Functions/Worker；或设置页填写的自建中继基址。
 * 判定依据：/api/health 带构建标识；或 /api/proxy 返回我们 handler 的
 * 结构化 JSON（错误体含 "error"），避免把普通静态站 404/首页误判为中继。 */
let relayProbe = null;
async function probeOne(u, timeoutMs) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const r = await fetch(u, { signal: c.signal, cache: 'no-store' });
    if (r.ok) {
      const txt = (await r.text()).slice(0, 400);
      if (/zhiyinglu/i.test(txt) && /proxy|service/i.test(txt)) return true;
    }
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('json')) {
      const txt = (await r.text()).slice(0, 200);
      if (txt.includes('"error"')) return true; // 我们 handler 的结构化错误
    }
    return false;
  } catch { return false; }
  finally { clearTimeout(t); }
}
/* 首个成功即返回 true 的并行竞速（Promise.any 语义的手写版，兼容 Safari 14-）。
   原实现串行探测，最坏情况（自定义基址超时 ×2 + 同域超时）首个业务请求被拖 3×timeout。 */
const anyOk = (promises) => new Promise((resolve) => {
  let pending = promises.length;
  if (!pending) return resolve(false);
  for (const p of promises) {
    Promise.resolve(p).then((v) => { if (v) resolve(true); else if (--pending === 0) resolve(false); },
      () => { if (--pending === 0) resolve(false); });
  }
});

export async function detectRelay({ timeout = 2200 } = {}) {
  if (relayProbe) return relayProbe;
  relayProbe = (async () => {
    const targets = [];
    const custom = String(state.settings?.relayBase || '').trim().replace(/\/+$/, '');
    if (custom) targets.push(custom + '/api/health', custom + '/api/proxy');
    const origin = globalThis.location?.origin;
    if (origin && origin !== 'null' && origin !== 'file://') targets.push(origin + '/api/health');
    return anyOk(targets.map((u) => probeOne(u, timeout)));
  })();
  return relayProbe;
}
/** 中继地址/部署变更后调用，强制重新探测 */
export const resetRelayProbe = () => { relayProbe = null; };
