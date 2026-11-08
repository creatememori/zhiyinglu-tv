import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSearchHits, parsePlayUrl, rememberHits, recallHit, searchRecentlyFailed } from '../src/api/cms.js';

const src = (id) => ({ id, name: `源${id}` });
const hit = (name, year = '', extra = {}) => ({ vod_name: name, vod_year: year, vod_id: `${name}-${year || 'na'}`, ...extra });

test('search aggregation merges same title and same year across sources', () => {
  const merged = mergeSearchHits([
    { src: src('a'), vods: [hit('星际旅程', '2024', { vod_pic: 'poster.jpg' })] },
    { src: src('b'), vods: [hit('星际旅程', '2024', { vod_remarks: '更新中' })] }
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].srcCount, 2);
  assert.deepEqual(new Set(merged[0].sourceIds), new Set(['a', 'b']));
  assert.equal(merged[0].vod_year, '2024');
});

test('search aggregation does not merge different years', () => {
  const merged = mergeSearchHits([
    { src: src('a'), vods: [hit('重启', '2019')] },
    { src: src('b'), vods: [hit('重启', '2025')] }
  ]);
  assert.equal(merged.length, 2);
});

test('search aggregation keeps missing-year records separate across sources', () => {
  const merged = mergeSearchHits([
    { src: src('a'), vods: [hit('迷雾')] },
    { src: src('b'), vods: [hit('迷雾')] }
  ]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((x) => x.srcCount), [1, 1]);
});

test('play URL parser extracts HTTP(S) episode addresses and skips malformed segments', () => {
  const lines = parsePlayUrl('第01集$https://media.example/ep1.m3u8#第02集$https://media.example/ep2.mp4#坏地址$javascript:alert(1)', '线路A');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].eps.length, 2);
  assert.equal(lines[0].eps[0].label, '第01集');
  assert.equal(lines[0].eps[1].url, 'https://media.example/ep2.mp4');
});

test('search aggregation extracts fastPlays from vods that carry play urls', () => {
  const merged = mergeSearchHits([
    { src: src('a'), vods: [hit('星际旅程', '2024', { vod_play_url: '线路A$第01集$https://media.example/ep1.m3u8' })] },
    { src: src('b'), vods: [hit('星际旅程', '2024', { vod_pic: 'x.jpg' })] }
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].fastPlays.length, 1);
  assert.equal(merged[0].fastPlays[0].srcId, 'a');
  assert.equal(merged[0].fastPlays[0].lines[0].eps.length, 1);
});

test('search aggregation keeps fastPlays per source and caps at most four', () => {
  const items = [];
  for (const id of ['a', 'b', 'c', 'd', 'e']) {
    items.push({ src: src(id), vods: [hit('环世界', '2025', { vod_play_url: `线$${id}集$https://media.example/${id}.m3u8` })] });
  }
  const merged = mergeSearchHits(items);
  assert.equal(merged.length, 1);
  assert.ok(merged[0].fastPlays.length <= 4);
  assert.deepEqual(new Set(merged[0].fastPlays.map((x) => x.srcId)).size, 4);
});

test('hit memory recalls playable hits within the session window', () => {
  rememberHits([{ key: '流浪月球', vod_year: '2026', fastPlays: [{ srcId: 'a', srcName: '源A', lines: [{ name: '线', eps: [{ label: '1', url: 'https://media.example/e1.m3u8' }] }] }] }]);
  const hit = recallHit('流浪月球:2026');
  assert.ok(hit);
  assert.equal(hit.fastPlays[0].srcName, '源A');
  assert.equal(recallHit('流浪月球:1999'), null);
  assert.equal(recallHit('不存在的片:2026'), null);
});

test('searchRecentlyFailed defaults to false without recorded failures', () => {
  assert.equal(searchRecentlyFailed('randomsrc' + Math.random().toString(36).slice(2)), false);
});
