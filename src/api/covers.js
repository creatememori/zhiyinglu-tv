/**
 * 知影录 · 批量封面客户端
 * 通过服务端 /api/covers 按片名批量取豆瓣封面（并发4 + 30min服务端缓存），
 * 客户端再做 10 分钟内存缓存。用于「今日更新/为你推荐」等源站图床不稳定的栏目。
 */

const cache = new Map();   // name → { chain, at }

export async function fetchCovers(names = [], { fresh = false } = {}) {
  const uniqNames = [...new Set((names || []).map((s) => String(s || '').trim()).filter(Boolean))].slice(0, 20);
  if (!uniqNames.length) return {};
  const TTL = 10 * 60e3;
  const result = {};
  const missing = [];
  for (const n of uniqNames) {
    const hit = cache.get(n);
    if (!fresh && hit && Date.now() - hit.at < TTL) { result[n] = hit.data; continue; }
    missing.push(n);
  }
  if (!missing.length) return result;
  try {
    const base = globalThis.location?.origin || '';
    const r = await fetch(base + '/api/covers?names=' + encodeURIComponent(missing.join(',')), { cache: 'no-store' });
    if (!r.ok) return result;
    const data = await r.json();
    const map = data.map || {};
    for (const n of missing) {
      const entry = map[n];
      if (entry && Array.isArray(entry.chain) && entry.chain.length) {
        cache.set(n, { data: entry, at: Date.now() });
        result[n] = entry;
      } else {
        cache.set(n, { data: null, at: Date.now() });   // 负面缓存
      }
    }
  } catch {}
  return result;
}

/** 清空客户端缓存（调试/换批时用） */
export const clearCoversCache = () => cache.clear();