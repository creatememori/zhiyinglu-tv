#!/usr/bin/env node
/**
 * 纯静态部署的健康清单生成器。
 *
 * 用法：
 *   node scripts/jx-health.mjs
 *   JX_TARGET=https://v.qq.com/x/cover/xxxx.html node scripts/jx-health.mjs
 *
 * 说明：解析源的行为和“目标页”有关，清单只能代表本次探测目标下的状态。
 * 没探测到的源一律写 unknown，绝不把 HTTP 可达误写成 ok。
 * 建议在 GitHub Action / CI 里每 30–60 分钟跑一次，并提交 public/jx-health.json。
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { DEFAULT_JIEXI_SOURCES } from '../src/api/sources.js';
import { handleJxProbe } from '../worker/proxy-core.js';

const jxUrl = (jx, target) => jx.url + encodeURIComponent(target);

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..', 'public', 'jx-health.json');
const target = process.env.JX_TARGET || 'https://v.qq.com/x/cover/mzc00200mp8vo9b.html';
const ttlMs = Number(process.env.JX_TTL_MS) || 6 * 60 * 60e3;

const stateOf = (d) => {
  if (!d) return 'unknown';
  if (d.ok) return d.hasParser ? 'ok' : 'warn';
  // 网络/DNS/空壳/目标相关失败都只记 unknown，避免把可用源误杀。
  if (['unreachable', 'empty_page'].includes(d.reason)) return 'unknown';
  return 'bad';
};

const KNOWN_BAD = new Set(['jx202617', 'yemy', 'txnp']);

const entries = await Promise.all(
  DEFAULT_JIEXI_SOURCES.map(async (jx) => {
    const probeUrl = jxUrl(jx, target);
    try {
      const req = new Request('http://local/api/jxprobe?url=' + encodeURIComponent(probeUrl), { method: 'GET' });
      const res = await handleJxProbe(req, {});
      const d = await res.json();
      let state = stateOf(d);
      if (KNOWN_BAD.has(jx.id)) state = 'bad';
      // AIBox 这类“页面含 player 字样但实际空壳”的源，不直接给 ok。
      if (jx.id === 'aibox' && state === 'ok') state = 'warn';
      return [jx.id, {
        state,
        ms: Number(d.ms) || 0,
        reason: d.reason || (state === 'ok' ? 'ok' : state),
        score: state === 'ok' ? 3 : state === 'warn' ? 1 : 0
      }];
    } catch (e) {
      return [jx.id, {
        state: 'unknown',
        ms: 0,
        reason: 'probe_error:' + String(e?.message || e).slice(0, 80),
        score: 0
      }];
    }
  })
);

const sources = Object.fromEntries(entries);
const manifest = {
  checkedAt: new Date().toISOString(),
  ttlMs,
  target,
  note: '纯静态健康清单：由 scripts/jx-health.mjs 生成；unknown 不要当坏源。',
  sources
};
await writeFile(out, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
const counts = Object.values(sources).reduce((a, s) => ((a[s.state] = (a[s.state] || 0) + 1), a), {});
console.log(`[jx-health] ${out}`);
console.log(`[jx-health] target=${target}`);
console.log(`[jx-health] ${JSON.stringify(counts)}`);