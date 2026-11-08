/**
 * 全量数据迁移（全量数据迁移设计）—— 纯前端落盘：
 * 一个 JSON 文件打包 设置(含源/预设/直播槽位) + 观看历史 + 播放进度 + 跳过配置。
 * 与"仅配置导出"不同，这份数据可整体转移到另一台设备/浏览器。
 */
import { kvGet, kvSet, listPrefixed, listHistory, addHistory, clearHistory, progressSet, skipSet } from './db.js';
import { normalizeImportedSettings } from './config.js';
import { state, saveSettings } from './state.js';

const APP_TAG = 'creatememori-tv';
const DATA_VERSION = 3;

export async function buildDataExport() {
  const settings = (await kvGet('settings')) || state.settings || {};
  const history = await listHistory();
  const progress = await listPrefixed('PG:');
  const skips = await listPrefixed('SK:');
  return {
    app: APP_TAG, version: DATA_VERSION, savedAt: new Date().toISOString(),
    settings,
    history: history.slice(0, 300),
    progress: progress.slice(0, 800).map((e) => ({ ...e, k: String(e.k).slice(3) })),
    skips: skips.slice(0, 800).map((e) => ({ ...e, k: String(e.k).slice(3) }))
  };
}

/** 校验+写入。任何一块非法都会整体拒绝，避免半写入破坏本地数据。 */
export async function applyDataImport(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('数据文件根节点必须是 JSON 对象');
  if (raw.app !== APP_TAG) throw new Error(`数据文件标识不符（期望 ${APP_TAG}，收到 ${String(raw.app || '空')}）`);
  const version = Number(raw.version || 0);
  if (!Number.isFinite(version) || version < 1 || version > DATA_VERSION) throw new Error(`不支持的数据版本：${raw.version}`);

  // 1) 设置：复用严格校验器（源地址、ID、预设、直播槽位等全部核验）
  const settings = normalizeImportedSettings(raw.settings || {}, state.settings || {}, { sourceCatalogVersion: 4 });
  settings.sourceCatalogVersion = 4;
  state.settings = { ...(state.settings || {}), ...settings };
  saveSettings();
  await kvSet('settings', state.settings);

  // 2) 历史：替换式导入
  const history = Array.isArray(raw.history) ? raw.history.filter((h) => h && typeof h === 'object' && h.id) : [];
  await clearHistory();
  for (const h of history.slice(0, 300)) await addHistory({ ...h, updated: Number(h.updated) || Date.now() });

  // 3) 进度 / 跳过配置：键白名单字符过滤，值必须为对象
  const restore = async (list, prefix, setter) => {
    const arr = Array.isArray(list) ? list : [];
    for (const e of arr.slice(0, 800)) {
      const k = String(e?.k || '').slice(0, 200);
      if (!k || !e || typeof e !== 'object') continue;
      await setter(prefix + k, e);
    }
  };
  await restore(raw.progress, 'PG:', progressSet);
  await restore(raw.skips, 'SK:', skipSet);
  return { history: history.length, progress: Array.isArray(raw.progress) ? raw.progress.length : 0, skips: Array.isArray(raw.skips) ? raw.skips.length : 0 };
}