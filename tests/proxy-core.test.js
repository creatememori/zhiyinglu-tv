import test from 'node:test';
import assert from 'node:assert/strict';
import { handleProxy } from '../worker/proxy-core.js';

const req = (url, init = {}) => new Request(url, init);

test('health route returns a versioned diagnostic response', async () => {
  const res = await handleProxy(req('https://nebula.example/api/health'));
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.match(data.build, /^nebula-proxy-v11-/);
  assert.ok(data.sourceHostAllowlistCount >= 10);
});

test('proxy refuses missing URL', async () => {
  const res = await handleProxy(req('https://nebula.example/api/proxy'));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'missing_url');
});

test('proxy refuses unlisted hosts', async () => {
  const target = encodeURIComponent('https://not-allowed.example/api');
  const res = await handleProxy(req(`https://nebula.example/api/proxy?url=${target}`));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'host_not_allowed');
});

test('upstream 401 is surfaced as a structured authentication diagnosis', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('auth required', { status: 401 });
  try {
    const target = encodeURIComponent('https://bfzyapi.com/api.php/provide/vod?ac=list');
    const res = await handleProxy(req(`https://nebula.example/api/proxy?url=${target}`));
    const data = await res.json();
    assert.equal(res.status, 502);
    assert.equal(data.error, 'upstream_auth_required');
    assert.equal(data.upstreamStatus, 401);
    assert.match(data.message, /无法绕过/);
  } finally { globalThis.fetch = originalFetch; }
});

test('redirect to a host outside the allowlist is blocked', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/collect' } });
  try {
    const target = encodeURIComponent('https://bfzyapi.com/api.php/provide/vod');
    const res = await handleProxy(req(`https://nebula.example/api/proxy?url=${target}`));
    const data = await res.json();
    assert.equal(res.status, 502);
    assert.equal(data.error, 'upstream_redirect_blocked');
  } finally { globalThis.fetch = originalFetch; }
});



test('proxy rejects deceptive suffix hosts that only contain an allowed domain as text', async () => {
  const target = encodeURIComponent('https://bfzyapi.com.attacker.example/api.php/provide/vod');
  const res = await handleProxy(req(`https://nebula.example/api/proxy?url=${target}`));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'host_not_allowed');
});

test('proxy rejects non-GET methods', async () => {
  const res = await handleProxy(req('https://nebula.example/api/proxy', { method: 'POST' }));
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'GET, OPTIONS');
});

test('proxy rejects non-http protocols and credential-bearing URLs', async () => {
  for (const url of ['file:///etc/passwd', 'https://user:pass@bfzyapi.com/api.php/provide/vod']) {
    const res = await handleProxy(req(`https://nebula.example/api/proxy?url=${encodeURIComponent(url)}`));
    assert.equal(res.status, 400);
  }
});

test('successful upstream payload is returned with build diagnostics and bounded caching', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"code":1,"list":[]}', {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
  try {
    const target = encodeURIComponent('https://bfzyapi.com/api.php/provide/vod?ac=list');
    const res = await handleProxy(req(`https://nebula.example/api/proxy?url=${target}`));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-nebula-proxy'), '1');
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(res.headers.get('x-nebula-build'), 'nebula-proxy-v11-2026-10-27');
    assert.match(res.headers.get('cache-control'), /s-maxage=300/);
    assert.deepEqual(await res.json(), { code: 1, list: [] });
  } finally { globalThis.fetch = originalFetch; }
});

test('upstream 429 is identified as rate limiting', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('rate limited', { status: 429 });
  try {
    const target = encodeURIComponent('https://bfzyapi.com/api.php/provide/vod?ac=list');
    const res = await handleProxy(req(`https://nebula.example/api/proxy?url=${target}`));
    const data = await res.json();
    assert.equal(res.status, 502);
    assert.equal(data.upstreamStatus, 429);
    assert.match(data.message, /过于频繁/);
  } finally { globalThis.fetch = originalFetch; }
});

/* V14 singleflight：同一目标的并发请求只回源一次，每个等待者拿到独立可读副本 */
test('concurrent requests to the same target share one upstream fetch', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 50));
    return new Response('{"code":1,"list":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const target = encodeURIComponent('https://bfzyapi.com/api.php/provide/vod?ac=list&pg=7');
    const [r1, r2, r3] = await Promise.all([
      handleProxy(req(`https://nebula.example/api/proxy?url=${target}`)),
      handleProxy(req(`https://nebula.example/api/proxy?url=${target}`)),
      handleProxy(req(`https://nebula.example/api/proxy?url=${target}`))
    ]);
    assert.equal(calls, 1);
    for (const r of [r1, r2, r3]) {
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { code: 1, list: [] });
    }
  } finally { globalThis.fetch = originalFetch; }
});

/* V14 singleflight：上游失败同样合并，且结果在合并窗口后不被固化（可重试） */
test('concurrent failures are coalesced but not cached', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return new Response('x', { status: 500 }); };
  try {
    const target = encodeURIComponent('https://bfzyapi.com/api.php/provide/vod?ac=list&pg=8');
    const [r1, r2] = await Promise.all([
      handleProxy(req(`https://nebula.example/api/proxy?url=${target}`)),
      handleProxy(req(`https://nebula.example/api/proxy?url=${target}`))
    ]);
    assert.equal(calls, 1);
    assert.equal(r1.status, 502);
    assert.equal(r2.status, 502);
    // 合并窗口结束后再次请求应重新回源（错误不被缓存）
    const r3 = await handleProxy(req(`https://nebula.example/api/proxy?url=${target}`));
    assert.equal(r3.status, 502);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; }
});

/* V14：上游请求使用浏览器 UA（部分采集站拦截非浏览器标识） */
test('upstream fetch uses a browser user-agent', async () => {
  const originalFetch = globalThis.fetch;
  let seenUA = '';
  globalThis.fetch = async (url, init) => { seenUA = init?.headers?.['user-agent'] || ''; return new Response('{"code":1,"list":[]}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    const target = encodeURIComponent('https://bfzyapi.com/api.php/provide/vod?ac=list&pg=9');
    await handleProxy(req(`https://nebula.example/api/proxy?url=${target}`));
    assert.match(seenUA, /Mozilla\/5\.0/);
  } finally { globalThis.fetch = originalFetch; }
});
