/**
 * 外部配置文件 / 订阅互操作层 —— 纯前端实现。
 *
 * 只借用其公开配置格式（api_site / custom_category / cache_time / lives）做
 * 双向迁移，不复制任何第三方源码。解密/编码均为标准算法：
 *  - base58：Bitcoin 字母表（订阅链接 = base58 编码的配置 JSON）。
 *  - 兼容纯 JSON 文本与 base64 文本输入。
 */

/* ---------------- base58 编解码（Bitcoin 字母表） ---------------- */
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_MAP = new Map([...B58_ALPHABET].map((c, i) => [c, i]));

export function b58decode(str = '') {
  if (typeof str !== 'string' || !str.trim()) throw new Error('base58 内容为空');
  const s = str.trim();
  const bytes = [0];
  for (const ch of s) {
    const v = B58_MAP.get(ch);
    if (v === undefined) throw new Error(`非法 base58 字符：${JSON.stringify(ch)}`);
    let carry = v;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry = Math.floor(carry / 256);
    }
    while (carry) { bytes.push(carry & 0xff); carry = Math.floor(carry / 256); }
  }
  for (let k = 0; k < s.length && s[k] === '1'; k++) bytes.push(0);
  bytes.reverse();
  return new Uint8Array(bytes);
}

export function b58encode(input = new Uint8Array(0)) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
  }
  let out = '';
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) out += '1';
  return out + digits.reverse().map((d) => B58_ALPHABET[d]).join('');
}

const utf8Encode = (s) => new TextEncoder().encode(s);
const utf8Decode = (b) => new TextDecoder('utf-8', { fatal: false }).decode(b);

/* ---------------- 通用校验 ---------------- */
const isHttpUrl = (v) => {
  try { const u = new URL(String(v || '').trim()); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
};
export const sanitizeId = (s, fallback = 'src') => {
  const clean = String(s || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return /^[a-z]/.test(clean) ? (clean || fallback) : (fallback + '-' + (clean || 'x')).slice(0, 40);
};

/* ---------------- 配置结构识别 ---------------- */
export function isLunaConfigFile(obj) {
  return !!obj && typeof obj === 'object' && !Array.isArray(obj)
    && !!obj.api_site && typeof obj.api_site === 'object' && !Array.isArray(obj.api_site);
}

/* ---------------- Luna 配置 → 知影录 设置 ---------------- */
/**
 * api_site: { key: { api, name, detail? } } → cmsSources 数组。
 * 碰撞处理：与现有源 ID 重复时追加编号后缀；非法 API 地址丢弃。
 */
export function lunaSourcesToCms(apiSites, existingIds = new Set()) {
  const out = [];
  const seen = new Set(existingIds);
  for (const [key, site] of Object.entries(apiSites || {})) {
    if (!site || typeof site !== 'object' || !isHttpUrl(site.api)) continue;
    let id = sanitizeId(String(key || ''), 'luna');
    let n = 0;
    while (seen.has(id)) { n++; id = sanitizeId(String(key || ''), 'luna').slice(0, 36) + '-' + n; }
    seen.add(id);
    out.push({
      id, name: String(site.name || key || id).slice(0, 100),
      api: String(site.api).trim(), format: 'auto', searchable: true, enabled: true,
      note: site.detail ? `外部配置 · 网页详情候选：${String(site.detail).slice(0, 120)}` : '外部配置导入'
    });
  }
  return out;
}

/** custom_category → 搜索预设（name/type/query），按 type+query 去重。 */
export function lunaCategoriesToPresets(categories, existingKeys = new Set()) {
  const out = [];
  const seen = new Set(existingKeys);
  for (const c of Array.isArray(categories) ? categories : []) {
    if (!c || typeof c !== 'object' || !c.query) continue;
    const type = c.type === 'movie' ? 'movie' : 'tv';
    const query = String(c.query).trim().slice(0, 40);
    if (!query) continue;
    const dk = type + ':' + query;
    if (seen.has(dk)) continue;
    seen.add(dk);
    out.push({ id: sanitizeId('p-' + type + '-' + query, 'preset'), name: String(c.name || query).slice(0, 60), type, query });
  }
  return out;
}

/** lives → liveSources（导入后可在「数据源 → 直播源」/ #/live 直接播放，起）。 */
export function lunaLivesToSources(lives, existingIds = new Set()) {
  const out = [];
  const seen = new Set(existingIds);
  for (const [key, v] of Object.entries(lives || {})) {
    if (!v || typeof v !== 'object' || !isHttpUrl(v.url)) continue;
    let id = sanitizeId(String(key || ''), 'live');
    let n = 0;
    while (seen.has(id)) { n++; id = sanitizeId(String(key || ''), 'live').slice(0, 36) + '-' + n; }
    seen.add(id);
    out.push({ id, name: String(v.name || key || id).slice(0, 100), url: String(v.url).trim(), ua: String(v.ua || '').slice(0, 200), epg: String(v.epg || '').slice(0, 300) });
  }
  return out;
}

/** cache_time（秒）→ 搜索缓存 TTL（秒），知影录 侧按 120–86400 收拢。 */
export const lunaCacheTimeToSec = (n) => {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return 1800;
  return Math.max(120, Math.min(86400 * 2, Math.round(x)));
};

/* ---------------- 知影录 设置 → Luna 配置 ---------------- */
export function toLunaConfigFile(settings = {}) {
  const apiSite = {};
  for (const s of Array.isArray(settings.cmsSources) ? settings.cmsSources : []) {
    if (!isHttpUrl(s.api)) continue;
    const entry = { api: String(s.api).trim(), name: String(s.name || s.id).slice(0, 100) };
    apiSite[sanitizeId(s.id || '', 'src')] = entry;
  }
  const custom_category = (settings.presets || []).map((p) => ({ name: p.name, type: p.type === 'movie' ? 'movie' : 'tv', query: p.query }));
  const lives = {};
  for (const l of Array.isArray(settings.liveSources) ? settings.liveSources : []) {
    if (!isHttpUrl(l.url)) continue;
    const e = { name: String(l.name || l.id), url: String(l.url).trim() };
    if (l.ua) e.ua = l.ua;
    if (l.epg) e.epg = l.epg;
    lives[sanitizeId(l.id || '', 'live')] = e;
  }
  const file = { cache_time: lunaCacheTimeToSec(settings.cacheTime) };
  if (Object.keys(apiSite).length) file.api_site = apiSite;
  if (custom_category.length) file.custom_category = custom_category;
  if (Object.keys(lives).length) file.lives = lives;
  return file;
}

/* ---------------- 订阅 / 配置文本解析 ---------------- */
export function parseSubscriptionText(text = '') {
  const t = String(text || '').trim();
  if (!t) throw new Error('输入为空');
  // 1) 原始 JSON
  try { return JSON.parse(t); }
  catch {}
  // 2) base64
  try {
    if (/^[A-Za-z0-9+/=_-]+$/.test(t) && t.length % 4 === 0) {
      const clean = t.replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(utf8Decode(Uint8Array.from(atob(clean), (c) => c.charCodeAt(0))));
    }
  } catch {}
  // 3) base58（base58 订阅链接正文）
  try {
    const json = utf8Decode(b58decode(t));
    return JSON.parse(json);
  }
  catch { throw new Error('无法解析：既不是 JSON，也不是 base64/base58 编码的配置文本'); }
}

export const b58Export = (settings) => b58encode(utf8Encode(JSON.stringify(toLunaConfigFile(settings))));