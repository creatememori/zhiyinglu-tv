import { kvGet, kvSet, healthLoad, healthSave } from './db.js';
import { DEFAULT_SETTINGS, DEFAULT_CMS_SOURCES, DEFAULT_JIEXI_SOURCES, DEFAULT_PROXIES, DEFAULT_PRESETS, DEFAULT_LIVE_SOURCES } from '../api/sources.js';

export const state = { ready: false, settings: null, health: {} };
const subs = new Set();
export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const notify = () => subs.forEach((f) => { try { f(); } catch {} });

/* 旧版内置源 URL，用于安全迁移：保留用户自定义接口，仅更新旧版默认 URL。 */
const LEGACY_DEFAULT_APIS = {
  bf: 'https://bfzyapi.com/api.php/provide/vod',
  js: 'https://jszyapi.com/api.php/provide/vod',
  lz: 'https://cj.lziapi.com/api.php/provide/vod',
  ff: 'https://cj.ffzyapi.com/api.php/provide/vod',
  md: 'https://www.mdzyapi.com/api.php/provide/vod',
  dytt: 'https://caiji.dyttzyapi.com/api.php/provide/vod',
  ikun: 'https://ikunzyapi.com/api.php/provide/vod',
  '360': 'https://360zy.com/api.php/provide/vod',
  wj: 'https://api.wujinapi.me/api.php/provide/vod',
  gs: 'https://api.guangsuapi.com/api.php/provide/vod'
};
const DEFAULT_BY_ID = new Map(DEFAULT_CMS_SOURCES.map((s) => [s.id, s]));

/**起导出为纯函数（测试可直调）。规则：未改动过地址的默认源跟随新默认的
    format/note/searchable 修正；用户改过地址或手动关过搜索的偏好一律保留。 */
export function migrateSources(savedSources) {
  const input = Array.isArray(savedSources) ? savedSources : [];
  const output = [];
  const seen = new Set();
  for (const old of input) {
    if (!old || !old.id) continue;
    const legacyApi = LEGACY_DEFAULT_APIS[old.id];
    const current = DEFAULT_BY_ID.get(old.id);
    // 纯旧默认源（已不再内置）移除；用户编辑过的则当作自定义源保留。
    if (!current && legacyApi && old.api === legacyApi) continue;
    if (current) {
      const isOldDefault = legacyApi && old.api === legacyApi;
      const untouchedApi = old.api === current.api;   // 地址未被用户改动
      output.push({
        ...current, ...old,
        api: isOldDefault ? current.api : (old.api || current.api),
        format: (isOldDefault || untouchedApi) ? current.format : (old.format || current.format),
        // 默认源被实测为不支持搜索时，仅对"地址没被用户改动过"的存档跟随修正（茅台 code:1002）；
        // 改过地址的镜像源与用户手动关过的设置一律保留
        searchable: (untouchedApi && current.searchable === false) ? false : (old.searchable !== false),
        note: untouchedApi ? current.note : (old.note || current.note)
      });
      seen.add(current.id);
    } else {
      output.push({ format: 'auto', ...old });
      seen.add(old.id);
    }
  }
  // 把新增内置源追加到已保存的列表末尾，不覆盖用户自定义源和启停状态。
  for (const src of DEFAULT_CMS_SOURCES) {
    if (!seen.has(src.id)) output.push({ ...src });
  }
  return output;
}

export async function loadState() {
  const saved = await kvGet('settings');
  state.settings = Object.assign({}, DEFAULT_SETTINGS, saved || {});
  state.settings.cmsSources = migrateSources(state.settings.cmsSources);
  if (!Array.isArray(state.settings.jiexiSources) || !state.settings.jiexiSources.length) state.settings.jiexiSources = [...DEFAULT_SETTINGS.jiexiSources];
  if (!Array.isArray(state.settings.proxies)) state.settings.proxies = [...DEFAULT_SETTINGS.proxies];
  
//corsproxy.io 已强制 API Key，从旧存档中清除失效代理；无可用代理时回填默认。
  state.settings.proxies = (state.settings.proxies || []).filter((x) => typeof x === 'string' && !!x.trim() && !/corsproxy\.io/i.test(x));
  if (!state.settings.proxies.length) state.settings.proxies = [...DEFAULT_SETTINGS.proxies];
  
//预设分类 / 直播源槽位 / 缓存时长 —— 兼容旧存档并收拢数值范围
  if (!Array.isArray(state.settings.presets) || !state.settings.presets.length) state.settings.presets = [...DEFAULT_PRESETS];
  else state.settings.presets = state.settings.presets.slice(0, 30);
  if (!Array.isArray(state.settings.liveSources)) state.settings.liveSources = [...DEFAULT_LIVE_SOURCES];
  const ct = Number(state.settings.cacheTime);
  state.settings.cacheTime = Number.isFinite(ct) ? Math.max(120, Math.min(86400, Math.round(ct))) : DEFAULT_SETTINGS.cacheTime;

  state.settings.relayBase = typeof state.settings.relayBase === 'string' ? state.settings.relayBase.trim().slice(0, 300) : '';
  // 旧版默认代理只留给本地开发兜底，正式站点请求由同域 Worker 处理。
  state.settings.sourceCatalogVersion = 4;
  kvSet('settings', state.settings).catch(() => {});

  state.health = (await healthLoad()) || {};
  applyTheme();
  state.ready = true;
  notify();
}

let t = null;
export function saveSettings() { clearTimeout(t); t = setTimeout(() => kvSet('settings', state.settings), 400); applyTheme(); notify(); }
let ht = null;

//健康度落盘后同步通知订阅者（导航红点等 UI 需要随体检结果实时刷新）
export function saveHealth() { clearTimeout(ht); ht = setTimeout(() => { healthSave(state.health); notify(); }, 1500); }

/** 主题应用：accent 色 + 毛玻璃强度 + 全屏特效开关 */
export function applyTheme() {
  const s = state.settings || {};
  document.documentElement.dataset.accent = s.accent || 'sunset';
  document.documentElement.style.setProperty('--blur', (s.glass ?? 20) + 'px');
  document.body.classList.toggle('no-fx', s.fx === false);
}
export const cmsSources = () => (state.settings?.cmsSources || []).filter((s) => s.enabled !== false && s.kind !== 'directory');
export const jiexiSources = () => (state.settings?.jiexiSources || []);
