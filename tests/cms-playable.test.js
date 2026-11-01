import test from 'node:test';
import assert from 'node:assert/strict';
import { isPlayableUrl, sortLinesPlayable } from '../src/api/cms.js';

/* ============ V22：直链优先排序（解析线/分享页沉底） ============ */

test('isPlayableUrl: m3u8/mp4/webm/flv 为直链，share/play/VIP 页面不是', () => {
  assert.equal(isPlayableUrl('https://x.com/v/a/b/index.m3u8'), true);
  assert.equal(isPlayableUrl('https://x.com/v.mp4?sign=1'), true);
  assert.equal(isPlayableUrl('https://x.com/a.webm'), true);
  assert.equal(isPlayableUrl('https://x.com/a.flv'), true);
  assert.equal(isPlayableUrl('https://x.com/share/abc123'), false);
  assert.equal(isPlayableUrl('https://x.com/play/eVONLNoa'), false);
  assert.equal(isPlayableUrl('https://v.qq.com/x/cover/abc.html'), false);
});

test('sortLinesPlayable: 直链优先、解析线沉底、组内顺序稳定', () => {
  const lines = [
    { name: '分享线', eps: [{ url: 'https://x/share/a', label: '1' }] },
    { name: 'm3u8线', eps: [{ url: 'https://x/b/index.m3u8', label: '1' }] },
    { name: 'play页线', eps: [{ url: 'https://x/play/zz', label: '1' }] },
    { name: 'mp4线', eps: [{ url: 'https://x/c.mp4', label: '1' }] }
  ];
  const out = sortLinesPlayable(lines);
  assert.deepEqual(out.map((l) => l.name), ['m3u8线', 'mp4线', '分享线', 'play页线']);
});

test('sortLinesPlayable: 空数组/全解析线 不抛错', () => {
  assert.deepEqual(sortLinesPlayable([]), []);
  const out = sortLinesPlayable([{ name: 'a', eps: [{ url: 'https://x/share/x', label: '1' }] }]);
  assert.equal(out[0].name, 'a');
});