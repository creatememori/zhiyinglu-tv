import { state, saveHealth } from '../core/state.js';

/** 拼接解析地址：模板 + 编码后的目标视频页面 URL */
export const jxUrl = (jx, target) => jx.url + encodeURIComponent(target);

/**
 * 解析源探测：no-cors fetch 一返回即计时（≈首包时延），10 分钟内缓存。
 * fetch 在收到响应头后即 resolve，天然适合做 ping。
 */
/**
 * 纯静态健康清单：部署时生成 public/jx-health.json，客户端只读这份清单。
 * 状态四态：ok / warn / unknown / bad。清单过期或缺失时回退到 no-cors ping，
 * 但 ping 只能证明“网络可达”，因此只记 warn/unknown，绝不记 ok/bad。
 */
const HEALTH_TTL = 6 * 60 * 60e3;
let healthPromise = null;

const normalizeState = (p) => {
  const s = p && p.state;
  if (s === 'ok' || s === 'warn' || s === 'unknown' || s === 'bad') return s;
  if (p && p.ok === true) return 'ok';
  if (p && p.ok === false) return 'bad';
  return 'unknown';
};

function healthUrl() {
  const base = typeof document !== 'undefined' && document.baseURI ? document.baseURI : 'http://localhost/';
  return new URL('jx-health.json', base).href;
}

export function loadJxHealth() {
  if (healthPromise) return healthPromise;
  healthPromise = (async () => {
    const res = await fetch(healthUrl(), { cache: 'no-store' });
    if (!res.ok) throw new Error('health_http_' + res.status);
    const data = await res.json();
    if (!data || !data.sources || !data.checkedAt) throw new Error('health_shape');
    const checked = Date.parse(data.checkedAt);
    const ttl = Number(data.ttlMs) || HEALTH_TTL;
    if (!Number.isFinite(checked) || Date.now() - checked > ttl) throw new Error('health_stale');
    return data;
  })().catch((e) => { healthPromise = null; throw e; });
  return healthPromise;
}

/** 并发读取健康清单；缺项/过期/接口不可用时回退到 ping，返回四态结果。 */
export async function probeJiexiSources(jxs, target) {
  let manifest = null;
  try { manifest = await loadJxHealth(); } catch { manifest = null; }
  return Promise.all((jxs || []).map(async (jx) => {
    const row = manifest?.sources?.[jx.id];
    if (row) {
      const state = normalizeState(row);
      return {
        ...jx,
        _probe: {
          state,
          ok: state === 'ok',
          ms: Number(row.ms) || 9999,
          reason: row.reason || 'manifest',
          source: 'manifest',
          checkedAt: manifest.checkedAt
        }
      };
    }
    const p = await pingJiexi(jx, { force: true }).catch(() => ({ ok: false, ms: Infinity }));
    // ping 只代表“可达”，不代表真实出画；失败也可能是本地 DNS，不能判死。
    const state = p.ok ? 'warn' : 'unknown';
    return {
      ...jx,
      _probe: {
        state,
        ok: false,
        ms: Number(p.ms) || 9999,
        reason: p.ok ? 'ping_reachable_unverified' : 'ping_unknown',
        source: 'ping'
      }
    };
  }));
}

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
