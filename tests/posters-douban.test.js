import test from 'node:test';
import assert from 'node:assert/strict';
import { doubanMirrorUrls, doubanCandidateChain } from '../src/api/posters.js';
import { isAutoPaused, activeSources } from '../src/api/cms.js';
import { state } from '../src/core/state.js';

/* ============ V16：豆瓣 CDN 镜像封面链 + 源自动暂停（LibreTV/LunaTV 借鉴） ============ */

test('doubanMirrorUrls：仅处理豆瓣图床，生成腾讯/阿里 CDN 镜像', () => {
  const m = doubanMirrorUrls('https://img1.doubanio.com/view/photo/m/public/p123.jpg');
  assert.deepEqual(m, [
    'https://img.doubanio.cmliussss.net/view/photo/m/public/p123.jpg',
    'https://img.doubanio.cmliussss.com/view/photo/m/public/p123.jpg'
  ]);
  assert.deepEqual(doubanMirrorUrls('https://lain.bgm.tv/pic/cover/l/xx.jpg'), []);
  assert.deepEqual(doubanMirrorUrls(''), []);
  assert.deepEqual(doubanMirrorUrls('not-a-url'), []);
});

test('doubanCandidateChain：镜像优先、反代居中、原图垫底，全链去重', () => {
  const c = doubanCandidateChain('https://img2.doubanio.com/view/p.jpg');
  assert.equal(c.length, 4);
  assert.ok(c[0].includes('cmliussss.net'), '第一候选为腾讯 CDN 镜像');
  assert.ok(c[1].includes('cmliussss.com'), '第二候选为阿里 CDN 镜像');
  assert.ok(c[2].includes('/api/img?url='), '第三候选为同域反代');
  assert.equal(c[3], 'https://img2.doubanio.com/view/p.jpg');
});

test('源自动暂停：近 2h 内 down 的源被跳过，到期自动恢复', () => {
  const now = Date.now();
  state.health = {
    bf: { id: 'bf', status: 'down', last: now - 30 * 60e3 },   // 30 分钟前 → 暂停
    lz: { id: 'lz', status: 'down', last: now - 3 * 3600e3 },  // 3 小时前 → 已恢复
    ff: { id: 'ff', status: 'healthy', last: now - 60e3 }
  };
  assert.equal(isAutoPaused('bf', now), true);
  assert.equal(isAutoPaused('lz', now), false);
  assert.equal(isAutoPaused('ff', now), false);
  assert.equal(isAutoPaused('unknown-src', now), false);
  const list = [{ id: 'bf' }, { id: 'lz' }, { id: 'ff' }];
  assert.deepEqual(activeSources(list, now).map((s) => s.id), ['lz', 'ff']);
  state.health = {};
});

test('源自动暂停：全部处于暂停期时退回全量（避免整体网络异常时首页全空）', () => {
  const now = Date.now();
  state.health = {
    bf: { id: 'bf', status: 'down', last: now - 60e3 },
    lz: { id: 'lz', status: 'down', last: now - 60e3 }
  };
  assert.equal(activeSources([{ id: 'bf' }, { id: 'lz' }], now).length, 2);
  state.health = {};
});
