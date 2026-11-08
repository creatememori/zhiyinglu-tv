import test from 'node:test';
import assert from 'node:assert/strict';
import { pickDoubanMatch, pickWmdbMatch, pickBangumiMatch, buildPosterChain, buildPosterChainRelayed, posterImageSrc, relayImageUrl, relayApi } from '../src/api/posters.js';
import { relayEndpoint, relayImageBase } from '../src/api/adapters.js';
import { state } from '../src/core/state.js';
import { mergeSearchHits } from '../src/api/cms.js';

/* ============ 封面聚合（豆瓣 + Bangumi + wmdb 三路 + 图床链路） ============ */

test('pickDoubanMatch matches by normalized title + optional year, rejects mismatches', () => {
  const rows = [
    { title: '繁花', year: '2023', img: 'https://img3.doubanio.com/a.webp', id: '1' },
    { title: '[高清] 繁花', year: '2023', img: 'https://img3.doubanio.com/b.jpg', id: '2' },
    { title: '繁花', year: '1996', img: 'http://img3.doubanio.com/c.jpg', id: '3' },
    { title: '不相关的片', year: '2023', img: 'https://img3.doubanio.com/d.jpg', id: '4' }
  ];
  const m = pickDoubanMatch(rows, '繁花', '2023');
  assert.equal(m.id, '1');
  assert.ok(m.img.startsWith('https://'));
  assert.equal(m.provider, 'douban');
  assert.equal(pickDoubanMatch(rows, '繁花', '1996').id, '3');
  assert.equal(pickDoubanMatch(rows, '不存在的片', '2023'), null);
});

test('pickWmdbMatch finds poster inside nested data and honors title+year', () => {
  const rows = {
    data: [
      { originalName: 'The Wandering Earth', year: 2019, data: [{ name: '流浪地球', poster: 'http://img.wmdb.tv/movie/poster/x.jpg' }] },
      { originalName: 'Suzume', year: 2022, data: [{ name: '铃芽之旅', poster: 'https://img.wmdb.tv/movie/poster/y.jpg' }] }
    ]
  };
  assert.equal(pickWmdbMatch(rows.data, '流浪地球', '2019').img, 'https://img.wmdb.tv/movie/poster/x.jpg');
  assert.equal(pickWmdbMatch(rows.data, '流浪地球', '2000'), null); // 年份不符
  assert.equal(pickWmdbMatch(rows.data, '不存在的片', '2019'), null);
  assert.equal(pickWmdbMatch(rows.data, '铃芽之旅', '2022').provider, 'wmdb');
});

test('pickBangumiMatch accepts 季数 variance and picks large cover', () => {
  const rows = {
    list: [
      { id: 1, name: '進撃の巨人', name_cn: '进击的巨人', air_date: '2013-04-07', images: { large: 'http://lain.bgm.tv/pic/cover/l/1.jpg', common: 'http://lain.bgm.tv/pic/cover/c/1.jpg' } },
      { id: 2, name: '葬送のフリーレン', name_cn: '葬送的芙莉莲', air_date: '', images: { large: 'https://lain.bgm.tv/pic/cover/l/2.jpg' } }
    ]
  };
  const m = pickBangumiMatch(rows, '进击的巨人', '2013');
  assert.equal(m.img, 'https://lain.bgm.tv/pic/cover/l/1.jpg');
  assert.equal(m.provider, 'bangumi');
  // 季名差异：CMS 叫"进击的巨人 第二季"，Bangumi 无季名 → 用去季名指纹互认
  const m2 = pickBangumiMatch(rows, '进击的巨人 第二季', '2013');
  assert.equal(m2.id, '1');
  assert.equal(pickBangumiMatch(rows, '葬送的芙莉莲', '').id, '2');
});

test('posterImageSrc: douban images prefer public CDN mirror (relay stays in chain), direct for others', () => {
  //豆瓣封面第一候选改为公共 CDN 镜像（LunaTV 方案，无中继也能出图）；
  // 同域反代仍保留在 doubanCandidateChain 的后续候选中。
  assert.ok(posterImageSrc('douban', 'https://img3.doubanio.com/x.jpg').includes('cmliussss.net'));
  assert.equal(posterImageSrc('wmdb', 'http://img.wmdb.tv/m/p.jpg'), 'https://img.wmdb.tv/m/p.jpg');
  assert.equal(posterImageSrc('bangumi', 'https://lain.bgm.tv/pic/cover/l/1.jpg'), 'https://lain.bgm.tv/pic/cover/l/1.jpg');
});

test('buildPosterChain: own poster first, then pool, unique, weserv tail', () => {
  const chain = buildPosterChain('http://a.com/p.jpg', ['https://b.com/p.jpg', 'https://a.com/p.jpg', 'https://c.com/p.jpg']);
  assert.equal(chain[0], 'https://a.com/p.jpg');
  assert.equal(chain[1], 'https://b.com/p.jpg');
  assert.equal(chain[2], 'https://c.com/p.jpg');
  assert.equal(new Set(chain).size, chain.length);
  assert.ok(chain.some((u) => u.includes('images.weserv.nl')));
});

test('mergeSearchHits collects a cross-source poster pool per title', () => {
  const items = [
    { src: { id: 's1', name: 'A站' }, vods: [{ vod_id: '1', vod_name: '测试影片', vod_year: '2024', vod_pic: 'https://a.com/1.jpg' }] },
    { src: { id: 's2', name: 'B站' }, vods: [{ vod_id: '2', vod_name: '测试影片', vod_year: '2024', vod_pic: 'https://b.com/2.jpg' }] }
  ];
  const merged = mergeSearchHits(items);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].srcCount, 2);
  assert.ok(merged[0].posterPool.includes('https://a.com/1.jpg') || merged[0].posterPool.includes('https://b.com/2.jpg'));
  assert.equal(merged[0].posterPool.includes(merged[0].vod_pic), false);
});

test('relay URL builders point at same-origin endpoints', () => {
  assert.ok(relayImageUrl('https://x/y.jpg').includes('/api/img?url='));
  assert.ok(relayApi('https://x/api').includes('/api/proxy?url='));
  assert.ok(relayApi('https://x/api').includes(encodeURIComponent('https://x/api')));
});

test('buildPosterChainRelayed interleaves /api/img relay candidates only when relay is up', () => {
  const plain = buildPosterChainRelayed('https://a.com/p.jpg', ['https://b.com/q.jpg'], false);
  assert.equal(plain.length, 3); // 原图 + 跨源池 + weserv（无反代介入）
  assert.ok(!plain.some((u) => u.includes('/api/img')));

  const rel = buildPosterChainRelayed('https://a.com/p.jpg', ['https://b.com/q.jpg'], true);
  assert.equal(rel[0], 'https://a.com/p.jpg');
  assert.ok(rel[1].includes('/api/img?url='));
  assert.equal(rel[2], 'https://b.com/q.jpg');
  assert.ok(rel[3].includes('/api/img?url='));
  assert.ok(rel.length <= 10);
  const weserv = rel.filter((u) => u.includes('images.weserv.nl'));
  assert.equal(weserv.length, 1); // weserv 不参与反代包装
});

test('custom relay base is honored by all endpoint builders', () => {
  state.settings = { relayBase: 'https://my-relay.workers.dev' };
  assert.ok(relayEndpoint('https://x/api').startsWith('https://my-relay.workers.dev/api/proxy?url='));
  assert.ok(relayImageBase('https://x/y.jpg').startsWith('https://my-relay.workers.dev/api/img?url='));
  assert.ok(relayImageUrl('https://x/y.jpg').startsWith('https://my-relay.workers.dev/api/img?url='));
  state.settings = {};
});