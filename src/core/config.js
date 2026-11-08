/**
 * Strictly normalize user-imported configuration. This keeps a malformed or
 * hand-edited JSON backup from replacing required arrays with arbitrary values.
 * This is a pure client-side validator; it does not make third-party URLs trusted.
 */
const isHttpUrl = (value) => {
  try { const u = new URL(String(value || '').trim()); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
};
const uniqueById = (items, validate) => {
  if (!Array.isArray(items)) throw new Error('配置中的数据源必须是数组');
  const seen = new Set();
  return items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`第 ${index + 1} 项配置格式错误`);
    const id = String(item.id || '').trim();
    if (!id || id.length > 100) throw new Error(`第 ${index + 1} 项缺少有效 ID`);
    if (seen.has(id)) throw new Error(`数据源 ID 重复：${id}`);
    seen.add(id);
    return validate({ ...item, id }, index);
  });
};

export function normalizeImportedSettings(raw, current, defaults) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('配置文件根节点必须是 JSON 对象');
  const next = { ...current };
  const boolKeys = ['seen', 'fx', 'autoplay', 'autonext', 'resume', 'autoScan'];
  for (const key of boolKeys) if (typeof raw[key] === 'boolean') next[key] = raw[key];
  if (['aurora', 'vercel', 'sunset', 'mint'].includes(raw.accent)) next.accent = raw.accent;
  if (Number.isFinite(Number(raw.glass))) next.glass = Math.max(0, Math.min(40, Math.round(Number(raw.glass))));
  if (Array.isArray(raw.cmsSources)) {
    next.cmsSources = uniqueById(raw.cmsSources, (s, i) => {
      if (!isHttpUrl(s.api)) throw new Error(`影视源 ${s.name || s.id} 的 API 地址必须是 HTTP(S) URL`);
      if (!String(s.name || '').trim()) throw new Error(`第 ${i + 1} 个影视源缺少名称`);
      const format = ['auto', 'xml', 'custom'].includes(s.format) ? s.format : 'auto';
      const clean = { ...s, name: String(s.name).trim().slice(0, 100), api: String(s.api).trim(), format, enabled: s.enabled !== false, searchable: s.searchable !== false };
      const t = Number(s.timeout);
      if (Number.isFinite(t) && t > 0) clean.timeout = Math.max(3000, Math.min(20000, Math.round(t)));
      else delete clean.timeout;
      return clean;
    });
  }
  if (Array.isArray(raw.jiexiSources)) {
    next.jiexiSources = uniqueById(raw.jiexiSources, (s, i) => {
      if (!isHttpUrl(s.url)) throw new Error(`解析源 ${s.name || s.id} 的模板必须是 HTTP(S) URL`);
      if (!String(s.name || '').trim()) throw new Error(`第 ${i + 1} 个解析源缺少名称`);
      return { ...s, name: String(s.name).trim().slice(0, 100), url: String(s.url).trim() };
    });
  }
  if (Array.isArray(raw.proxies)) next.proxies = raw.proxies.filter(isHttpUrl).map((x) => String(x).trim()).slice(0, 20);
  if (Number.isFinite(Number(raw.cacheTime))) next.cacheTime = Math.max(120, Math.min(86400, Math.round(Number(raw.cacheTime))));
  if (typeof raw.relayBase === 'string') next.relayBase = raw.relayBase.trim().slice(0, 300);
  if (Array.isArray(raw.presets)) {
    const seenP = new Set();
    const seenId = new Set();
    next.presets = [];
    for (const [index, p] of raw.presets.entries()) {
      if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error(`第 ${index + 1} 个搜索预设格式错误`);
      const query = String(p.query || '').trim();
      const name = String(p.name || '').trim();
      if (!query) throw new Error(`第 ${index + 1} 个搜索预设缺少关键词`);
      if (!name) throw new Error(`第 ${index + 1} 个搜索预设缺少名称`);
      const type = p.type === 'movie' ? 'movie' : 'tv';
      const dk = type + ':' + query;
      if (seenP.has(dk)) continue;
      seenP.add(dk);
      let id = String(p.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 40) || 'p' + (next.presets.length + 1);
      if (seenId.has(id)) id += '-' + (next.presets.length + 1);
      seenId.add(id);
      next.presets.push({ id, name: name.slice(0, 60), type, query: query.slice(0, 40) });
      if (next.presets.length >= 30) break;
    }
  }
  if (Array.isArray(raw.liveSources)) {
    next.liveSources = uniqueById(raw.liveSources, (l, i) => {
      if (!isHttpUrl(l.url)) throw new Error(`直播源 ${l.name || l.id} 的地址必须是 HTTP(S) URL`);
      if (!String(l.name || '').trim()) throw new Error(`第 ${i + 1} 个直播源缺少名称`);
      return { ...l, name: String(l.name).trim().slice(0, 100), url: String(l.url).trim(), ua: String(l.ua || '').slice(0, 200), epg: String(l.epg || '').slice(0, 300) };
    }).slice(0, 200);
  }
  if (Array.isArray(raw.recent)) next.recent = raw.recent.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, 30);
  if (Array.isArray(raw.favs)) next.favs = raw.favs.filter((x) => x && typeof x === 'object' && !Array.isArray(x)).slice(0, 1000);
  if (Number.isFinite(Number(raw.lastScan))) next.lastScan = Math.max(0, Number(raw.lastScan));
  next.sourceCatalogVersion = Number(defaults?.sourceCatalogVersion || 2);
  return next;
}
