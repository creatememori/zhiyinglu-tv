const DB_NAME = 'creatememori-tv', DB_VER = 1;
let dbp = null, broken = false;
const mem = new Map();

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res) => {
    try {
      const rq = indexedDB.open(DB_NAME, DB_VER);
      rq.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'k' });
        if (!d.objectStoreNames.contains('history')) { const s = d.createObjectStore('history', { keyPath: 'id' }); s.createIndex('updated', 'updated'); }
        if (!d.objectStoreNames.contains('posters')) d.createObjectStore('posters', { keyPath: 'url' });
      };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => { broken = true; res(null); };
    } catch { broken = true; res(null); }
  });
  return dbp;
}
const prom = (rq) => new Promise((ok, no) => { (rq.onsuccess = () => ok(rq.result), rq.onerror = () => no(rq.error)); });

/* 降级通道（无痕模式等异常环境） */
const lsJ = (k) => { try { const v = localStorage.getItem('gv:' + k); return v ? JSON.parse(v) : undefined; } catch { return mem.get(k); } };
const lsS = (k, v) => { mem.set(k, v); try { localStorage.setItem('gv:' + k, JSON.stringify(v)); } catch {} };

export async function kvSet(k, v) {
  try { const d = await open(); if (!d) return lsS(k, v); await prom(d.transaction('kv', 'readwrite').objectStore('kv').put({ k, v })); }
  catch { lsS(k, v); }
}
export async function kvGet(k) {
  try { const d = await open(); if (!d) return lsJ(k); const r = await prom(d.transaction('kv').objectStore('kv').get(k)); return r ? r.v : undefined; }
  catch { return lsJ(k); }
}
export async function kvDel(k) {
  try { const d = await open(); if (d) await prom(d.transaction('kv', 'readwrite').objectStore('kv').delete(k)); } catch { mem.delete(k); }
}
/** 按前缀清理（清空接口缓存使用） */
export async function kvClearPrefix(prefix) {
  const d = await open();
  if (!d) { for (const k of [...mem.keys()]) if (k.startsWith(prefix)) mem.delete(k); return; }
  const store = d.transaction('kv', 'readwrite').objectStore('kv');
  await new Promise((res) => { const c = store.openCursor(); c.onsuccess = () => { const cur = c.result; if (!cur) return res(); if (String(cur.value.k).startsWith(prefix)) cur.delete(); cur.continue(); }; c.onerror = res; });
}

/* API 响应缓存（TTL + stale 兜底） */
export const cacheSet = (k, data, ttl) => kvSet('CH:' + k, { t: Date.now(), ttl, data });
export async function cacheGet(k) {
  const r = await kvGet('CH:' + k); if (!r) return null;
  return { data: r.data, stale: Date.now() - r.t > (r.ttl || 600000) };
}

/* 播放进度（断点续播记忆） */
export const progressSet = (key, v) => kvSet('PG:' + key, { ...v, updated: Date.now() });
export const progressGet = (key) => kvGet('PG:' + key);

/* 片头片尾跳过配置（片头片尾跳过配置：按"片名:年份"记忆 intro/outro 秒数） */
export const skipGet = (key) => kvGet('SK:' + key);
export const skipSet = (key, v) => kvSet('SK:' + key, { ...v, updated: Date.now() });
export const skipDel = (key) => kvDel('SK:' + key);

/* 按前缀枚举 kv 条目（数据导出用：进度 / 跳过配置全量收集） */
export async function listPrefixed(prefix) {
  const d = await open();
  const out = [];
  if (!d) {
    for (const [k, v] of mem.entries()) if (String(k).startsWith(prefix)) out.push({ k, v });
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('gv:' + prefix)) out.push({ k: k.slice(3), v: JSON.parse(localStorage.getItem(k)) }); } } catch {}
    return out;
  }
  await new Promise((res) => {
    const store = d.transaction('kv').objectStore('kv');
    const c = store.openCursor();
    c.onsuccess = () => {
      const cur = c.result;
      if (!cur) return res();
      if (String(cur.value.k).startsWith(prefix)) out.push(cur.value);
      cur.continue();
    };
    c.onerror = res;
  });
  return out;
}

/* 观看历史（自动裁剪到 200 条）
  性能修复：原实现每次写入都 getAll() 全表读取 + 排序，播放页每 5 秒
   调一次 → 持续全表扫描。改为 O(1) 的 count() 探针，超限时才用 updated
   索引游标定位最旧条目删除（游标顺序即索引升序，前 N 条即最旧 N 条）。 */
export async function addHistory(h) {
  const entry = { ...h, updated: Date.now() };
  const d = await open();
  if (!d) { lsS('hist', [entry, ...(lsJ('hist') || []).filter((x) => x.id !== entry.id)].slice(0, 300)); return; }
  const tx = d.transaction('history', 'readwrite');
  const store = tx.objectStore('history');
  await prom(store.put(entry));
  const count = await prom(store.count());
  if (count > 220) {
    const excess = count - 200;
    let removed = 0;
    await new Promise((res) => {
      const c = store.index('updated').openCursor();
      c.onsuccess = () => {
        const cur = c.result;
        if (!cur || removed >= excess) return res();
        cur.delete(); removed++; cur.continue();
      };
      c.onerror = res;
    });
  }
}
export async function listHistory() {
  const d = await open(); if (!d) return (lsJ('hist') || []).sort((a, b) => b.updated - a.updated);
  return (await prom(d.transaction('history').objectStore('history').getAll())).sort((a, b) => b.updated - a.updated);
}
export const delHistory = (id) => open().then((d) => d && prom(d.transaction('history', 'readwrite').objectStore('history').delete(id)));
export const clearHistory = () => open().then((d) => d && prom(d.transaction('history', 'readwrite').objectStore('history').clear()));

/* 海报 blob 缓存（CORS 允许时生效，否则回退浏览器原生缓存） */
const urls = new Map();
export async function posterBlob(url) {
  if (!url) return url;
  if (urls.has(url)) return urls.get(url);
  try {
    const d = await open(); let b = null;
    if (d) { const r = await prom(d.transaction('posters').objectStore('posters').get(url)); if (r) b = r.blob; }
    if (!b) { const res = await fetch(url, { mode: 'cors', referrerPolicy: 'no-referrer' }); b = await res.blob(); if (d) await prom(d.transaction('posters', 'readwrite').objectStore('posters').put({ url, blob: b })); }
    const o = URL.createObjectURL(b);
    if (urls.size > 300) { const [k] = urls.keys(); try { URL.revokeObjectURL(urls.get(k)); } catch {} urls.delete(k); }
    urls.set(url, o); return o;
  } catch { return url; }
}
export const clearPosters = () => open().then((d) => d && prom(d.transaction('posters', 'readwrite').objectStore('posters').clear()));

/* 健康度快照 / 存储占用 */
export const healthLoad = () => kvGet('health') || {};
export const healthSave = (m) => kvSet('health', m);
export const usage = async () => (navigator.storage?.estimate ? navigator.storage.estimate() : { usage: 0, quota: 0 });
