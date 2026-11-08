import { state, saveHealth } from '../core/state.js';

/** 拼接解析地址：模板 + 编码后的目标视频页面 URL */
export const jxUrl = (jx, target) => jx.url + encodeURIComponent(target);

/**
 * 解析源探测：no-cors fetch 一返回即计时（≈首包时延），10 分钟内缓存。
 * fetch 在收到响应头后即 resolve，天然适合做 ping。
 */
export async function pingJiexi(jx, { force = false } = {}) {
  const key = 'jx:' + jx.id;
  const h = state.health[key];
  if (!force && h && h.jxT && Date.now() - h.jxT < 10 * 60e3) return { ok: h.status !== 'down', ms: h.avg };
  const t0 = performance.now();
  try {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 9000);
    await fetch(jxUrl(jx, 'https://www.baidu.com/'), { mode: 'no-cors', signal: c.signal, referrerPolicy: 'no-referrer' });
    clearTimeout(t);
    const ms = Math.round(performance.now() - t0);
    state.health[key] = { id: key, ok: (h?.ok || 0) + 1, fail: h?.fail || 0, avg: h?.avg ? Math.round(h.avg * 0.6 + ms * 0.4) : ms, last: Date.now(), status: 'healthy', jxT: Date.now() };
    saveHealth();
    return { ok: true, ms };
  } catch (e) {
    state.health[key] = { id: key, ok: h?.ok || 0, fail: (h?.fail || 0) + 1, avg: h?.avg || 99999, last: Date.now(), lastErr: e?.message || '', status: 'down', jxT: Date.now() };
    saveHealth();
    return { ok: false, ms: Infinity, err: e?.message };
  }
}
