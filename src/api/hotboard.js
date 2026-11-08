/**
 * 知影录 · 多源高分榜单客户端
 *
 * 通过服务端 /api/hotboard 获取跨题材高分聚合榜（豆瓣 10 题材并行聚合，
 * 去重后按评分降序），服务端不可用时返回 null（调用方回退源站热度榜）。
 */

let hotboardCache = null;   // { items, at }

export async function fetchHotboard({ limit = 16, fresh = false } = {}) {
  const TTL = 10 * 60e3;
  if (!fresh && hotboardCache && Date.now() - hotboardCache.at < TTL) return hotboardCache.items;
  try {
    const base = globalThis.location?.origin || '';
    const r = await fetch(`${base}/api/hotboard?limit=${limit}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const data = await r.json();
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) return null;
    hotboardCache = { items, at: Date.now() };
    return items;
  } catch {
    return null;
  }
}