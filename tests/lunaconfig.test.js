import test from 'node:test';
import assert from 'node:assert/strict';
import {
  b58decode, b58encode, isLunaConfigFile, lunaSourcesToCms, lunaCategoriesToPresets,
  lunaLivesToSources, lunaCacheTimeToSec, toLunaConfigFile, parseSubscriptionText, sanitizeId
} from '../src/core/lunaconfig.js';

test('base58 round-trip preserves UTF-8 text', () => {
  const text = JSON.stringify({ api_site: { bf: { api: 'https://bfzyapi.com/api.php/provide/vod', name: '暴风资源' } } });
  const enc = b58encode(new TextEncoder().encode(text));
  const dec = new TextDecoder().decode(b58decode(enc));
  assert.equal(dec, text);
});

test('base58 decoder rejects invalid characters', () => {
  assert.throws(() => b58decode('0OIl'), /非法 base58 字符/);
  assert.throws(() => b58decode(''), /为空/);
});

test('base58 decoder matches the Bitcoin alphabet fixed vector', () => {
  // "abc" in ASCII = 0x61 0x62 0x63 → base58 "ZiCa"
  const bytes = Uint8Array.from([0x61, 0x62, 0x63]);
  assert.equal(b58encode(bytes), 'ZiCa');
  assert.deepEqual([...b58decode('ZiCa')], [0x61, 0x62, 0x63]);
});

test('parses raw JSON / base64 / base58 subscription text', () => {
  const cfg = { api_site: { a: { api: 'https://example.com/api.php/provide/vod', name: 'A站' } } };
  const raw = JSON.stringify(cfg);
  assert.deepEqual(parseSubscriptionText(raw), cfg);
  const b64 = Buffer.from(raw, 'utf8').toString('base64');
  assert.deepEqual(parseSubscriptionText(b64), cfg);
  const b58 = b58encode(new TextEncoder().encode(raw));
  assert.deepEqual(parseSubscriptionText(b58), cfg);
});

test('recognizes a LunaTV config file by api_site structure', () => {
  assert.ok(isLunaConfigFile({ api_site: {}, cache_time: 7200 }));
  assert.ok(!isLunaConfigFile({ api_site: [] }));
  assert.ok(!isLunaConfigFile(null));
});

test('maps api_site entries to CMS sources with deduped sanitized ids', () => {
  const out = lunaSourcesToCms({
    '暴风!!资源': { api: 'https://a.example/api.php/provide/vod', name: '暴风' },
    bad: { api: 'javascript:alert(1)', name: '坏源' },
    another: { api: 'https://b.example/api.php/provide/vod', name: 'B', detail: 'https://b.example/detail' }
  });
  assert.equal(out.length, 2); // 非法协议项被丢弃
  assert.match(out[0].id, /^[a-z0-9_-]+$/);
  assert.ok(out.every((s) => s.enabled && s.searchable && s.format === 'auto'));
  assert.ok(out[1].note.includes('网页详情候选'));
});

test('custom_category dogfooding to presets dedupes by type+query', () => {
  const out = lunaCategoriesToPresets([
    { name: '豆瓣高分', type: 'movie', query: '高分' },
    { name: '另一个名字', type: 'movie', query: '高分' },
    { name: '韩剧', type: 'tv', query: '韩剧' }
  ]);
  assert.equal(out.length, 2);
  assert.ok(out.every((p) => p.type === 'movie' || p.type === 'tv'));
});

test('lives mapping keeps ua/epg metadata', () => {
  const out = lunaLivesToSources({ cctv1: { name: 'CCTV1', url: 'https://live.example/cctv1.m3u8', epg: 'https://epg.example/x.xml' } });
  assert.equal(out.length, 1);
  assert.equal(out[0].epg, 'https://epg.example/x.xml');
});

test('cache_time clamps into the supported seconds range', () => {
  assert.equal(lunaCacheTimeToSec(7200), 7200);
  assert.equal(lunaCacheTimeToSec(1), 120);
  assert.equal(lunaCacheTimeToSec('bad'), 1800);
  assert.ok(lunaCacheTimeToSec(999999) >= 86400);
});

test('export → reimport round-trip keeps sources, presets, lives and cache_time', () => {
  const settings = {
    cmsSources: [{ id: 'bf', name: '暴风', api: 'https://bfzyapi.com/api.php/provide/vod' }],
    presets: [{ name: '悬疑', type: 'movie', query: '悬疑' }],
    liveSources: [{ id: 'lv1', name: '台1', url: 'https://live.example/a.m3u8', ua: 'ua' }],
    cacheTime: 3600
  };
  const file = toLunaConfigFile(settings);
  assert.equal(file.cache_time, 3600);
  const back = lunaSourcesToCms(file.api_site);
  assert.equal(back.length, 1);
  assert.equal(back[0].name, '暴风');
  assert.equal(lunaCategoriesToPresets(file.custom_category).length, 1);
  assert.equal(lunaLivesToSources(file.lives).length, 1);
});

test('sanitizeId yields safe identifiers and falls back for non-latin input', () => {
  assert.equal(sanitizeId('暴风 资源!!', 'src'), 'src-x'); // 无法映射成 ASCII 时用兜底名
  assert.equal(sanitizeId('My_Source.1', 'src'), 'my_source-1');
  assert.match(sanitizeId('123abc'), /^[a-z]/);
});

test('b58 export is decodable back to the same JSON', () => {
  const settings = { cmsSources: [{ id: 'a', name: '源', api: 'https://example.com/api.php/provide/vod' }], cacheTime: 1200 };
  const enc = b58decode(b58encode(new TextEncoder().encode(JSON.stringify(toLunaConfigFile(settings)))));
  const back = JSON.parse(new TextDecoder().decode(enc));
  assert.equal(back.cache_time, 1200);
  assert.equal(Object.keys(back.api_site)[0], 'a');
});