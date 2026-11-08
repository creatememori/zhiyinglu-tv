/**
 * 封面记忆（poster memo）：任何页面一旦拿到某片的封面，就按「源:vod_id」记到
 * 内存 Map + localStorage。首页/分类/榜单每次渲染海报时同步查记忆——命中就直接出图，
 * 不必再等待逐张取 ac=detail 的慢回填，也解决"点开详情拿到封面、返回首页仍空白"。
 */
const KEY = 'poster-memo';
const memo = new Map();
try {
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(KEY);
    if (raw) { const o = JSON.parse(raw); for (const k of Object.keys(o)) memo.set(k, o[k]); }
  }
} catch { /* 忽略解析失败 */ }

const k = (s, id) => String(s || '') + ':' + String(id || '');

function persist() {
  try {
    if (typeof localStorage === 'undefined') return;
    const o = {};
    let n = 0;
    for (const [kk, vv] of memo) { if (n++ >= 600) break; o[kk] = vv; }
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch { /* 私有模式等场景静默 */ }
}

export function rememberPoster(srcId, vodId, url) {
  const u = String(url || '').trim();
  if (!u || u.startsWith('data:')) return;
  try { memo.set(k(srcId, vodId), u); persist(); } catch {}
}

export function recallPoster(srcId, vodId) {
  return memo.get(k(srcId, vodId)) || '';
}