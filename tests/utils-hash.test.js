import test from 'node:test';
import assert from 'node:assert/strict';
import { hashId } from '../src/core/utils.js';
import { typeOf, looksLikePage } from '../src/player/player.js';

/* ============ 新增纯函数与模块结构回归 ============ */

test('hashId：djb2 哈希稳定、URL 安全、可区分不同输入', () => {
  assert.equal(hashId('https://v.qq.com/x/cover/abc'), hashId('https://v.qq.com/x/cover/abc'));
  assert.notEqual(hashId('https://a.example/1'), hashId('https://a.example/2'));
  assert.match(hashId('任意内容：凡人修仙传'), /^[a-z0-9]+$/);
  assert.equal(hashId(''), hashId(''));
  assert.equal(hashId(null), hashId('null'));
});

test('player.js 顶层不再静态依赖 artplayer/hls.js（无 node_modules 也可导入纯函数）', async () => {
  // 本测试环境未安装 npm 依赖；若 player.js 恢复静态 import，本模块会直接抛 ERR_MODULE_NOT_FOUND。
  const mod = await import('../src/player/player.js');
  assert.equal(typeof mod.createPlayer, 'function');
  assert.equal(typeof mod.swapUrl, 'function');
  assert.equal(typeof mod.destroyHls, 'function');
  assert.equal(mod.typeOf('https://a.com/x.m3u8?token=1'), 'm3u8');
  assert.equal(mod.typeOf('https://a.com/movie.mp4'), 'mp4');
  assert.equal(mod.typeOf('https://a.com/signed/abc123'), '');
  assert.equal(looksLikePage('https://ffzy.com/share/xyz'), true);
});

test('swapUrl：非 m3u8 目标会销毁残留 hls 实例', async () => {
  const { swapUrl } = await import('../src/player/player.js');
  let destroyed = 0;
  const fakeArt = {
    type: 'm3u8',
    hls: { destroy() { destroyed++; } },
    set url(v) { this._url = v; },
    get url() { return this._url; }
  };
  assert.equal(swapUrl(fakeArt, 'https://a.com/movie.mp4'), true);
  assert.equal(destroyed, 1);
  assert.equal(fakeArt.hls, null);
  assert.equal(fakeArt.type, 'mp4');
  // m3u8 → m3u8 由 customType 重建加载器，swapUrl 不在此处销毁
  fakeArt.hls = { destroy() { destroyed++; } };
  assert.equal(swapUrl(fakeArt, 'https://a.com/b.m3u8'), true);
  assert.equal(destroyed, 1, 'm3u8→m3u8 时由 customType.m3u8 负责销毁重建');
});

test('swapUrl：异常输入返回 false 而不是抛出', async () => {
  const { swapUrl } = await import('../src/player/player.js');
  assert.equal(swapUrl(null, 'https://a.com/x.mp4'), false);
});
