import test from 'node:test';
import assert from 'node:assert/strict';
import { handleImg } from '../worker/proxy-core.js';

const req = (url, init = {}) => new Request(url, init);

test('img relay refuses missing URL', async () => {
  const res = await handleImg(req('https://nebula.example/api/img'));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'missing_url');
});

test('img relay refuses unlisted hosts and IP literals', async () => {
  const bad = encodeURIComponent('https://evil.example/p.jpg');
  const res = await handleImg(req(`https://nebula.example/api/img?url=${bad}`));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'host_not_allowed');

  const ip = encodeURIComponent('http://127.0.0.1/p.jpg');
  const res2 = await handleImg(req(`https://nebula.example/api/img?url=${ip}`));
  assert.equal(res2.status, 403);
});

test('img relay proxies a white-listed douban image WITH the douban referer', async () => {
  let seenHeaders = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seenHeaders = init?.headers || {};
    return new Response('fake-image-bytes', { status: 200, headers: { 'content-type': 'image/jpeg' } });
  };
  try {
    const target = encodeURIComponent('https://img3.doubanio.com/view/photo/s_ratio_poster/public/p1.jpg');
    const res = await handleImg(req(`https://nebula.example/api/img?url=${target}`));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(JSON.stringify(seenHeaders).toLowerCase().includes('movie.douban.com'), true);
    assert.equal(await res.text(), 'fake-image-bytes');
  } finally { globalThis.fetch = originalFetch; }
});

test('img relay proxies a generic CMS image host without douban referer', async () => {
  let seenHeaders = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seenHeaders = init?.headers || {};
    return new Response('png-bytes', { status: 200, headers: { 'content-type': 'image/webp' } });
  };
  try {
    const target = encodeURIComponent('https://p.bfvp26.com/upload/vod/x.webp');
    const res = await handleImg(req(`https://nebula.example/api/img?url=${target}`));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/webp');
    assert.equal(JSON.stringify(seenHeaders).toLowerCase().includes('movie.douban.com'), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('img relay surfaces upstream HTTP errors as structured JSON', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('nope', { status: 418 });
  try {
    const target = encodeURIComponent('https://img1.doubanio.com/view/p.jpg');
    const res = await handleImg(req(`https://nebula.example/api/img?url=${target}`));
    const data = await res.json();
    assert.equal(res.status, 502);
    assert.equal(data.error, 'upstream_http_error');
    assert.equal(data.upstreamStatus, 418);
  } finally { globalThis.fetch = originalFetch; }
});