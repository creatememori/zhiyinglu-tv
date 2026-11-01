import test from 'node:test';
import assert from 'node:assert/strict';
import { toHttps, isPageUrl, posterCandidates, PF } from '../src/core/utils.js';
import { typeOf, looksLikePage } from '../src/player/player.js';
import { transportCandidates, parsePlayUrl } from '../src/api/cms.js';

/* ============ V9：媒体地址清洗 / 海报级联 / 传输回退 / 线路解析 ============ */

test('toHttps upgrades http to https and passes through the rest', () => {
  assert.equal(toHttps('http://a.com/b.m3u8'), 'https://a.com/b.m3u8');
  assert.equal(toHttps('https://a.com/b.jpg'), 'https://a.com/b.jpg');
  assert.equal(toHttps('data:image/svg+xml;base64,AAAA'), 'data:image/svg+xml;base64,AAAA');
  assert.equal(toHttps('   '), '');
});

test('posterCandidates builds a de-duplicated chain that always ends with the placeholder', () => {
  const c1 = posterCandidates('https://x/p.jpg');
  assert.equal(c1[0], 'https://x/p.jpg');
  assert.ok(c1.includes('https://images.weserv.nl/?url=' + encodeURIComponent('https://x/p.jpg')));
  assert.equal(c1.at(-1), PF);

  // http 海报：https 升级版排最前，避免 HTTPS 页面混合内容直接被拦截
  const c2 = posterCandidates('http://x/p.jpg');
  assert.equal(c2[0], 'https://x/p.jpg');
  assert.ok(c2.includes('http://x/p.jpg'));
  assert.equal(new Set(c2).size, c2.length);

  // 空/占位输入：不制造无效请求
  assert.deepEqual(posterCandidates(''), [PF]);
  const d = posterCandidates('data:image/svg+xml,%3Csvg%3E');
  assert.equal(d[0].startsWith('data:'), true);
});

test('isPageUrl only flags share-style pages, not media links', () => {
  assert.equal(isPageUrl('https://cdn.com/share/abc123'), true);
  assert.equal(isPageUrl('https://cdn.com/video/1.mp4'), false);
  assert.equal(isPageUrl('https://cdn.com/play/1.mp4'), false);
  assert.equal(isPageUrl('bad-url'), false);
});

test('typeOf detects media extensions anywhere in the URL, returns empty for pages', () => {
  assert.equal(typeOf('https://a/b/index.m3u8?sign=1&t=2'), 'm3u8');
  assert.equal(typeOf('https://a/b/video.mp4?token=x#frag'), 'mp4');
  assert.equal(typeOf('https://a/b/v.webm'), 'webm');
  assert.equal(typeOf('https://a/share/8b02381898b'), '');
});

test('looksLikePage flags /share/ and extension-less /play/ pages only', () => {
  assert.equal(looksLikePage('https://super.ffzy-online6.com/share/123'), true);
  assert.equal(looksLikePage('https://hn.bfvvs.com/play/dJ6YrOyd'), true);
  assert.equal(looksLikePage('https://hn.bfvvs.com/play/dJ6YrOyd/index.m3u8'), false);
  assert.equal(looksLikePage('https://a.com/v.mp4'), false);
});

test('transportCandidates: worker-only when relay is up, direct+jsonp+proxy fallback otherwise', () => {
  const json = { id: 's1', format: 'auto' };
  const xml = { id: 's2', format: 'xml' };
  assert.deepEqual(transportCandidates(json, 'list', null, { relayOk: true }), ['worker']);
  assert.deepEqual(transportCandidates(json, 'list', 'worker', { relayOk: true }), ['worker']);
  assert.deepEqual(transportCandidates(json, 'list', null, { relayOk: false, proxyCount: 2 }), ['fetch', 'jsonp', 'proxy0', 'proxy1']);
  assert.deepEqual(transportCandidates(xml, 'list', null, { relayOk: false, proxyCount: 1 }), ['fetch', 'proxy0']);
  assert.deepEqual(transportCandidates(json, 'list', 'fetch', { relayOk: false, local: true, proxyCount: 0 }), ['fetch', 'jsonp']);
  // 记忆的成功方式总是排最前，不重复
  assert.deepEqual(transportCandidates(json, 'search', 'jsonp', { relayOk: false, proxyCount: 1 }), ['jsonp', 'fetch', 'proxy0']);
});

test('parsePlayUrl upgrades http to https and keeps line/episode labels', () => {
  const lines = parsePlayUrl('第1集$http://a.com/1.m3u8#第2集$https://a.com/2.m3u8$$$第1集$https://b.com/1.mp4|', 'bfzym3u8$$$bm3u8');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].name, 'bfzym3u8');
  assert.equal(lines[0].eps[0].label, '第1集');
  assert.equal(lines[0].eps[0].url, 'https://a.com/1.m3u8');
  assert.equal(lines[0].eps[1].url, 'https://a.com/2.m3u8');
  assert.equal(lines[1].name, 'bm3u8');
  assert.equal(lines[1].eps[0].url, 'https://b.com/1.mp4');
});