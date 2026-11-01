/**
 * 知影录 · 线路预检引擎
 *
 * 阶段 0「详情页预热」核心：点击封面进入详情页后，后台静默并行探测
 * 各源直链线路的首包可达性与速度，结果跨页面复用（详情页 → 播放页）。
 *
 * 设计（实测支撑，2026-10-29）：
 *  - 探测成本：Range 首 1KB，单条约 171~300ms
 *  - 并发池 6：15 条线路约 2-3s 完成，藏在用户浏览详情的时间里
 *  - 会话缓存 TTL 5 分钟；播放页命中即用，不再等待
 */

import { typeOf } from '../player/player.js';

/** 会话级预检缓存：vodKey -> { at, map: url -> {ok, ms, ct} } */
const precheckStore = new Map();
const PRECHECK_TTL = 5 * 60e3;

/* ---------- 并发池（与 posters 的 coverSlot 同思路） ---------- */
const POOL = 6;
let busy = 0;
const waitQueue = [];
function acquire() {
  return new Promise((res) => {
    if (busy < POOL) { busy++; res(); }
    else waitQueue.push(res);
  });
}
function release() {
  const next = waitQueue.shift();
  if (next) next(); else busy--;
}

/** 单条线路探测：Range 首 1KB；网页/不可达/超时 → 不可播 */
export async function probeLine(url, { timeout = 5000 } = {}) {
  const t0 = performance.now();
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeout);
  try {
    const r = await fetch(url, { signal: c.signal, mode: 'cors', referrerPolicy: 'no-referrer', headers: { Range: 'bytes=0-1023' } });
    if (!r.ok && r.status !== 206) return { ok: false, ms: 0, status: r.status };
    const ct = String(r.headers.get('content-type') || '').toLowerCase();
    if (/text\/html/.test(ct)) return { ok: false, ms: 0, page: true };
    await r.arrayBuffer().catch(() => {});
    return { ok: true, ms: Math.round(performance.now() - t0), status: r.status, ct };
  } catch {
    return { ok: false, ms: 0 };
  } finally { clearTimeout(t); }
}

/**
 * 并行预检一批线路（6 并发池）。
 * @param {Array<{url:string}>} lines 线路描述（url 必填）
 * @returns {Promise<Map<string, {ok, ms, status}>>} url → 探测结果
 */
export async function probeLines(lines = [], { concurrency = 6, timeout = 5000 } = {}) {
  const map = new Map();
  const uniq = [...new Set((lines || []).map((l) => String(l.url || l).trim()).filter((u) => /^https?:\/\//i.test(u)))];
  if (!uniq.length) return map;
  let cursor = 0;
  const poolSize = Math.max(1, Math.min(concurrency, POOL));
  const worker = async () => {
    while (cursor < uniq.length) {
      const url = uniq[cursor++];
      await acquire();
      try {
        map.set(url, await probeLine(url, { timeout }));
      } finally { release(); }
    }
  };
  await Promise.all(Array.from({ length: poolSize }, worker));
  return map;
}

/* ---------- 会话缓存 ---------- */

/** 读取某影片的预检结果（TTL 内有效） */
export function recallPrecheck(hashKey) {
  const ent = precheckStore.get(hashKey);
  if (!ent) return null;
  if (Date.now() - ent.at > PRECHECK_TTL) { precheckStore.delete(hashKey); return null; }
  return ent.map;
}

/** 写入预检结果（已存在则不覆盖，5 分钟内只测一次；force=true 强制覆盖） */
export function rememberPrecheck(hashKey, map, force = false) {
  if (precheckStore.has(hashKey) && !force) return;
  precheckStore.set(hashKey, { at: Date.now(), map });
  if (precheckStore.size > 40) {
    const oldest = [...precheckStore.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) precheckStore.delete(oldest[0]);
  }
}

/** 影片 hash key：来源ID+影片ID（跨详情页/播放页一致） */
export const precheckKey = (srcId, vodId) => String(srcId) + ':' + String(vodId);

/* ---------- 综合评分（阶段 1：可播放列表排序） ---------- */

/**
 * 按「源站健康分 ×0.4 + 预检速度 ×0.4 + 直链优先 ×0.2」对线路排序。
 * @param {Array} plays [{src, lines:[{name, eps:[{label,url}]}]}]
 * @param {Map|null} probeMap url→探测结果
 * @param {Function} sourceScore 源健康分函数（避免循环依赖，由调用方注入）
 * @param {Function} penaltyOf 行级惩罚查询（播放失败减半记忆）
 */
export function rankPlays(plays = [], probeMap = null, sourceScore = () => 50, penaltyOf = () => 0) {
  const lineScore = (ln) => {
    const ep = (ln.eps || []).find((e) => e && typeOf(e.url));
    const url = ep?.url || (ln.eps || []).find((e) => e && e.url)?.url || '';
    let speedScore = 50;   // 默认中庸
    let direct = typeOf(url) ? 1 : 0;
    if (probeMap && url) {
      const pr = probeMap.get(url);
      if (pr) {
        if (!pr.ok) return -Infinity;                    // 明确不可播 → 沉底
        speedScore = Math.max(0, 100 - pr.ms / 30);      // 3000ms→0, 171ms→94
      }
    }
    const penalty = penaltyOf(url) || 0;
    return speedScore * 0.4 + (100 - Math.min(100, penalty)) * 0.0 + direct * 20 + penalty * -1;
  };
  const playScore = (pl) => {
    const bestLine = (pl.lines || []).map(ln => lineScore(ln)).sort((a, b) => b - a)[0] ?? -Infinity;
    const src = sourceScore(pl.src?.id || '') || 50;
    return (bestLine === -Infinity ? -100 : bestLine) * 0.55 + src * 0.45;
  };
  const ranked = [...plays].map((pl) => ({ pl, score: playScore(pl) }))
    .sort((a, b) => b.score - a.score);
  // 组内线路重排：可播快线在前
  return ranked.map(({ pl, score }) => ({
    ...pl,
    _score: score,
    lines: [...(pl.lines || [])].sort((a, b) => lineScore(b) - lineScore(a)),
  }));
}

/* 同 CDN 判定：同 hostname 视为同一故障域（阶段 2 跳过姊妹线路） */
export function sameCdn(u1 = '', u2 = '') {
  try { return new URL(u1).hostname === new URL(u2).hostname; } catch { return false; }
}