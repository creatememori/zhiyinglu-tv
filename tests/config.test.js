import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeImportedSettings } from '../src/core/config.js';

const current = { accent: 'aurora', glass: 20, cmsSources: [], jiexiSources: [], proxies: [], recent: [], favs: [] };
const defaults = { sourceCatalogVersion: 2 };

test('imported configuration accepts valid source URLs and clamps appearance values', () => {
  const result = normalizeImportedSettings({
    glass: 99,
    cmsSources: [{ id: 'a', name: '源A', api: 'https://api.example/vod', enabled: true }],
    jiexiSources: [{ id: 'j1', name: '解析A', url: 'https://jx.example/?url=' }],
    proxies: ['https://proxy.example/?url=', 'javascript:alert(1)']
  }, current, defaults);
  assert.equal(result.glass, 40);
  assert.equal(result.cmsSources.length, 1);
  assert.equal(result.jiexiSources.length, 1);
  assert.deepEqual(result.proxies, ['https://proxy.example/?url=']);
});

test('imported configuration rejects malformed source URLs and duplicate IDs', () => {
  assert.throws(() => normalizeImportedSettings({ cmsSources: [{ id: 'x', name: 'bad', api: 'javascript:alert(1)' }] }, current, defaults), /HTTP\(S\)/);
  assert.throws(() => normalizeImportedSettings({ cmsSources: [
    { id: 'x', name: 'one', api: 'https://one.example' },
    { id: 'x', name: 'two', api: 'https://two.example' }
  ] }, current, defaults), /ID 重复/);
});

test('imported configuration rejects non-object root values', () => {
  assert.throws(() => normalizeImportedSettings([], current, defaults), /JSON 对象/);
});

test('imported configuration clamps cacheTime and validates presets', () => {
  const result = normalizeImportedSettings({
    cacheTime: 999999,
    presets: [
      { id: 'p1', name: '悬疑', type: 'movie', query: '悬疑' },
      { id: 'p1', name: '重复', type: 'movie', query: '悬疑' }
    ]
  }, current, defaults);
  assert.equal(result.cacheTime, 86400);
  // 重复项被去重，缺词项被拒绝
  assert.throws(() => normalizeImportedSettings({
    presets: [{ id: 'p2', name: 'x', type: 'tv', query: '  ' }]
  }, current, defaults), /缺少关键词/);
  assert.equal(result.presets.length, 1);
  assert.equal(result.presets[0].type, 'movie');
});

test('imported configuration validates live sources and source timeouts', () => {
  const r1 = normalizeImportedSettings({
    liveSources: [{ id: 'lv1', name: '台1', url: 'https://live.example/a.m3u8', ua: 'Mozilla' }]
  }, current, defaults);
  assert.equal(r1.liveSources.length, 1);
  assert.match(r1.liveSources[0].ua, /Mozilla/);
  assert.throws(() => normalizeImportedSettings({ liveSources: [{ id: 'lv2', name: '坏', url: 'ftp://live.example/x' }] }, current, defaults), /直播源/);
  const r2 = normalizeImportedSettings({ cmsSources: [{ id: 's', name: '慢源', api: 'https://x.example', timeout: 60000 }] }, current, defaults);
  assert.equal(r2.cmsSources[0].timeout, 20000);
});
