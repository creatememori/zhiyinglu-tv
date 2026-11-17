import { jxUrl } from './parsers.js';

/**
 * 统一解析调度器（纯函数 + 本地记忆，不依赖 DOM）。
 *
 * 设计目标：
 * 1. 归一化健康清单的四态，排序时 ok > warn > unknown > bad；
 * 2. 同态时优先“更快、最近成功过”的源，其次才用静态顺序；
 * 3. 目标页相关：不同目标页的源表现分开记忆，避免一个目标拖累全部；
 * 4. 方案 C 的代理入口只做 URL 拼接与来源校验，不在主域渲染代理页。
 */

export const STATE_WEIGHT = Object.freeze({ ok: 1, warn: 0.62, unknown: 0.34, bad: 0.06 });

const MEM_KEY = 'zyl:jx:resolver:v1';
const MEM_MAX_AGE = 30 * 60e3;
const MEM_MAX_TARGETS = 24;

function storage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readMemory() {
  const store = storage();
  if (!store) return {};
  try {
    const raw = JSON.parse(store.getItem(MEM_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function writeMemory(mem) {
  const store = storage();
  if (!store) return;
  try {
    const keys = Object.keys(mem).sort((a, b) => (mem[b]?.t || 0) - (mem[a]?.t || 0)).slice(0, MEM_MAX_TARGETS);
    const trimmed = {};
    keys.forEach((k) => { trimmed[k] = mem[k]; });
    store.setItem(MEM_KEY, JSON.stringify(trimmed));
  } catch { /* quota / private mode */ }
}

export function targetKey(target) {
  try {
    const u = new URL(target);
    return u.hostname + u.pathname.replace(/\/+$/, '');
  } catch {
    return String(target || '').slice(0, 180);
  }
}

/** 记录一次“文档载入”或真实成功；失败用 recordFailure。 */
export function recordLoad(sourceId, target, { ms = 9999, ok = true } = {}) {
  if (!sourceId || !target) return;
  const mem = readMemory();
  const key = targetKey(target);
  const row = mem[key] || { sources: {} };
  row.sources = row.sources || {};
  row.sources[sourceId] = {
    t: Date.now(),
    ms: Math.max(0, Math.round(Number(ms) || 9999)),
    ok: ok ? 1 : 0
  };
  row.t = Date.now();
  mem[key] = row;
  writeMemory(mem);
}

export function recordFailure(sourceId, target) {
  recordLoad(sourceId, target, { ms: 9999, ok: false });
}

/** 目标页记忆分数：最近成功 + 速度；失败会被降权。 */
function memoryScore(mem, target, id) {
  const row = mem[targetKey(target)]?.sources?.[id];
  if (!row || !row.t) return 0.5;
  const age = Date.now() - row.t;
  if (age > MEM_MAX_AGE) return 0.5;
  const fresh = 1 - age / MEM_MAX_AGE;
  const speed = Number.isFinite(row.ms) ? Math.max(0, 1 - Math.min(row.ms, 12000) / 12000) : 0;
  return (row.ok ? 0.65 + 0.35 * fresh : 0.15) * 0.5 + speed * 0.5;
}

export function stateOfSource(jx) {
  const p = jx?._probe;
  if (p?.state) return p.state;
  if (p?.ok === true) return 'ok';
  if (p?.ok === false) return 'bad';
  return 'unknown';
}

/**
 * 排序并给出 _score。order 是人工偏好顺序（同分时用）。
 * 不修改原数组。
 */
export function rankSources(list, { target = '', order = [], memory = readMemory() } = {}) {
  const orderIndex = new Map((order || []).map((id, i) => [id, i]));
  return (list || []).map((jx, i) => {
    const state = stateOfSource(jx);
    const health = STATE_WEIGHT[state] ?? STATE_WEIGHT.unknown;
    const mem = memoryScore(memory, target, jx.id);
    const speed = Number.isFinite(jx?._probe?.ms) ? Math.max(0, 1 - Math.min(jx._probe.ms, 12000) / 12000) : 0.35;
    const manual = orderIndex.has(jx.id) ? 1 - orderIndex.get(jx.id) / Math.max(1, orderIndex.size) : 0;
    // 速度略高于人工顺序：人工顺序只用来打破“同健康、同速度”的平局。
    const score = health * 0.55 + mem * 0.20 + speed * 0.24 + manual * 0.01;
    return { jx, i, score, state };
  }).sort((a, b) => (b.score - a.score) || (a.i - b.i)).map(({ jx, score, state }) => ({
    ...jx,
    _rank: score,
    _state: state
  }));
}

export function pickBest(list, opts = {}) {
  return rankSources(list, opts)[0] || null;
}

/** 方案 C 代理入口：必须由部署方显式配置 origin，默认不启用。 */
export function proxyOrigin() {
  if (typeof window === 'undefined') return '';
  const meta = document?.querySelector?.('meta[name="jx-proxy-origin"]');
  return String(meta?.content || window.__JX_PROXY_ORIGIN || '').replace(/\/+$/, '');
}

export function buildProxyUrl(jx, target, origin = proxyOrigin()) {
  if (!origin || !jx?.url) return '';
  // /p?u= 是独立代理域的固定契约；代理端必须做 host allowlist。
  const base = String(origin).replace(/\/+$/, '');
  return `${base}/p?u=${encodeURIComponent(jxUrl(jx, target))}&v=1`;
}

/** 只接受配置代理域发来的消息，防止任意页面伪造“播放成功”。 */
export function isTrustedProxyMessage(event, origin = proxyOrigin()) {
  if (!origin || !event) return false;
  if (event.origin !== origin) return false;
  const d = event.data;
  return !!d && d.type === 'jx:state' && typeof d.phase === 'string';
}

export function clearMemory() {
  const store = storage();
  try { store?.removeItem(MEM_KEY); } catch { /* noop */ }
}