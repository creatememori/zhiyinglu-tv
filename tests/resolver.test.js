import test from 'node:test';
import assert from 'node:assert/strict';
import { rankSources, targetKey, buildProxyUrl, isTrustedProxyMessage, STATE_WEIGHT } from '../src/api/resolver.js';

const src = (id, state, ms = 1000) => ({ id, name: id, url: `https://${id}.example/jx?url=`, _probe: { state, ok: state === 'ok', ms } });

test('四态权重与排序：ok 优先于 warn/unknown/bad', () => {
  assert.ok(STATE_WEIGHT.ok > STATE_WEIGHT.warn);
  assert.ok(STATE_WEIGHT.warn > STATE_WEIGHT.unknown);
  assert.ok(STATE_WEIGHT.unknown > STATE_WEIGHT.bad);
  const ranked = rankSources([src('bad', 'bad'), src('ok', 'ok'), src('unknown', 'unknown'), src('warn', 'warn')], { target: 'https://v.qq.com/x/cover/a.html' });
  assert.equal(ranked[0].id, 'ok');
  assert.equal(ranked[1].id, 'warn');
  assert.equal(ranked[2].id, 'unknown');
  assert.equal(ranked[3].id, 'bad');
});

test('同态时速度更快者优先，人工顺序只做同分兜底', () => {
  const ranked = rankSources([src('slow', 'ok', 4200), src('fast', 'ok', 300), src('mid', 'ok', 900)], { target: 'https://v.qq.com/x/cover/b.html', order: ['mid', 'slow', 'fast'] });
  assert.equal(ranked[0].id, 'fast');
  assert.equal(ranked[1].id, 'mid');
});

test('目标页记忆：最近成功且快的源获得加成，且只影响对应目标', () => {
  const target = 'https://v.qq.com/x/cover/c.html';
  const memory = { [targetKey(target)]: { t: Date.now(), sources: { remembered: { t: Date.now(), ms: 200, ok: 1 } } } };
  const ranked = rankSources([src('remembered', 'warn', 2000), src('other', 'warn', 500)], { target, memory });
  assert.equal(ranked[0].id, 'remembered');
  const otherTarget = rankSources([src('remembered', 'warn', 2000), src('other', 'warn', 500)], { target: 'https://v.qq.com/x/cover/d.html' });
  assert.equal(otherTarget[0].id, 'other');
});

test('代理 URL 只在显式配置 origin 时生成，且编码目标页', () => {
  const jx = { id: 'demo', url: 'https://demo.example/jx?url=' };
  const target = 'https://v.qq.com/x/cover/a.html?x=1';
  const url = buildProxyUrl(jx, target, 'https://jxproxy.example.com/');
  assert.ok(url.startsWith('https://jxproxy.example.com/p?u='));
  const inner = decodeURIComponent(url.split('u=')[1].split('&')[0]);
  assert.equal(inner, jx.url + encodeURIComponent(target));
  assert.equal(buildProxyUrl(jx, target, ''), '');
});

test('代理消息只接受配置的 origin 和 jx:state 形状', () => {
  const origin = 'https://jxproxy.example.com';
  assert.equal(isTrustedProxyMessage({ origin, data: { type: 'jx:state', phase: 'media' } }, origin), true);
  assert.equal(isTrustedProxyMessage({ origin: 'https://evil.example', data: { type: 'jx:state', phase: 'media' } }, origin), false);
  assert.equal(isTrustedProxyMessage({ origin, data: { type: 'other', phase: 'media' } }, origin), false);
});