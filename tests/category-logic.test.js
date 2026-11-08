import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryKey, resolveLocalType, filterByType } from '../src/api/cms.js';

/* ============ 分类页每源本地分类解析 ============ */

test('categoryKey buckets Chinese category names in priority order', () => {
  assert.equal(categoryKey('电影'), 'dianying');
  assert.equal(categoryKey('动作片'), 'dianying');
  assert.equal(categoryKey('4K电影'), 'dianying');
  assert.equal(categoryKey('纪录片'), 'dianying');       // 片尾兜底
  assert.equal(categoryKey('国产剧'), 'lianxuju');
  assert.equal(categoryKey('电视剧'), 'lianxuju');
  assert.equal(categoryKey('短剧'), 'lianxuju');
  assert.equal(categoryKey('综艺'), 'zongyi');
  assert.equal(categoryKey('大陆综艺'), 'zongyi');
  assert.equal(categoryKey('日韩动漫'), 'dongman');
  assert.equal(categoryKey('动画片'), 'dongman');         // 动画桶优先于"片尾"
  assert.equal(categoryKey(''), '');
});

test('resolveLocalType maps fuzzy names to source-local type ids', () => {
  const types = [
    { id: 1, name: '电影' }, { id: 13, name: '国产剧' },
    { id: 30, name: '日韩动漫' }, { id: 25, name: '综艺' }, { id: 8, name: '动作片' }
  ];
  assert.deepEqual(resolveLocalType(types, '电影', 1), { id: 1, name: '电影', via: 'map' });
  // 桶一致优先：想找"连续剧"，该源叫"国产剧" → 正确映射到 13
  assert.deepEqual(resolveLocalType(types, '连续剧', 2), { id: 13, name: '国产剧', via: 'map' });
  assert.deepEqual(resolveLocalType(types, '动漫', 4), { id: 30, name: '日韩动漫', via: 'map' });
  // 无任何命中 → 全局 ID 作最后兜底
  assert.deepEqual(resolveLocalType(types, '无匹配类型', 8), { id: 8, name: '无匹配类型', via: 'id' });
  assert.equal(resolveLocalType(types, '无匹配类型', null), null);
  // 仅 ID、无名称：ID 存在于本地表时直接可用
  assert.deepEqual(resolveLocalType(types, '', 8), { id: 8, name: '动作片', via: 'id' });
});

test('filterByType is the client-side fallback for sources without t support', () => {
  const list = [
    { vod_name: 'a', type_name: '电影' },
    { vod_name: 'b', type_name: '国产剧' },
    { vod_name: 'c', type_name: '动作片' },
    { vod_name: 'd', type_name: '日韩综艺' }
  ];
  assert.deepEqual(filterByType(list, '电影').map((v) => v.vod_name), ['a', 'c']);
  assert.deepEqual(filterByType(list, '连续剧').map((v) => v.vod_name), ['b']);
  assert.deepEqual(filterByType(list, '动漫'), []);
  assert.equal(filterByType(list, '').length, 4);
  assert.equal(filterByType(null, '电影').length, 0);
});