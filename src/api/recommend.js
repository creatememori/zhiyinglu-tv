/**
 * 知影录 · 豆瓣推荐客户端 
 *
 * 通过服务端 /api/recommend 获取豆瓣精选（服务端直连 + 10 分钟缓存），
 * 服务端不可用时降级为空（不阻塞首页）。
 */

let recommendCache = new Map();   // { 'movie:热门:p0:12': {items, at} }

export async function fetchRecommend({ type = 'movie', tag = '热门', start = 0, limit = 12, fresh = false } = {}) {
  const key = `${type}:${tag}:${start}:${limit}`;
  const TTL = 10 * 60e3;
  if (!fresh) {
    const hit = recommendCache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.items;
  }
  try {
    const base = globalThis.location?.origin || '';
    const url = `${base}/api/recommend?type=${type}&tag=${encodeURIComponent(tag)}&start=${start}&limit=${limit}`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return [];
    const data = await r.json();
    const items = Array.isArray(data.items) ? data.items : [];
    recommendCache.set(key, { items, at: Date.now() });
    if (recommendCache.size > 30) recommendCache.clear();
    return items;
  } catch {
    return [];
  }
}