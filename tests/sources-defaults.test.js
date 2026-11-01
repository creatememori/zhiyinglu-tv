import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CMS_SOURCES, DIRECTORY_SOURCES } from '../src/api/sources.js';
import { migrateSources } from '../src/core/state.js';

/* ============ V17：内置源清单与存档迁移（基于 2026-10-26 全量实测） ============ */

test('内置源清单：12 个实测 API 源 + 2 个半可用源 + 8 个目录参考全部在册', () => {
  const ids = DEFAULT_CMS_SOURCES.map((s) => s.id);
  for (const id of ['bf', 'lz', 'ff', '360', 'hn', 'ikun', 'mt', 'dytt', 'js', 'jl', 'gs', 'md', 'yy-all', '1080zyk']) {
    assert.ok(ids.includes(id), `缺少内置源 ${id}`);
  }
  assert.equal(DEFAULT_CMS_SOURCES.length, 14);
  assert.equal(DIRECTORY_SOURCES.length, 8);
});

test('V17 实测修正：茅台不参与搜索；ldg 双源为 xml 且默认停用', () => {
  const mt = DEFAULT_CMS_SOURCES.find((s) => s.id === 'mt');
  assert.equal(mt.searchable, false, '茅台 /at/xml/ 返回 code:1002 禁止关键词搜索');
  assert.equal(mt.enabled, true, '列表/详情仍可用，保持启用');
  for (const id of ['yy-all', '1080zyk']) {
    const s = DEFAULT_CMS_SOURCES.find((x) => x.id === id);
    assert.equal(s.format, 'xml', `${id} 实测为标准 maccms XML，不是 custom`);
    assert.equal(s.enabled, false, `${id} 不支持详情取数，默认停用`);
  }
});

test('migrateSources：未改地址的存档跟随新默认，用户停用偏好保留', () => {
  const saved = [
    { id: 'yy-all', name: '优质资源 / 黑木耳综合接口', api: 'https://api.yyzy-tv.vip/inc/ldg_api_all.php', format: 'custom', enabled: false },
    { id: 'mt', name: '茅台资源', api: 'https://caiji.maotaizy.cc/api.php/provide/vod/at/xml/', format: 'xml', searchable: true, enabled: true },
    { id: 'bf', name: '暴风资源', api: 'https://bfzyapi.com/api.php/provide/vod', enabled: false }
  ];
  const out = migrateSources(saved);
  const yy = out.find((s) => s.id === 'yy-all');
  assert.equal(yy.format, 'xml', 'ldg 格式应从 custom 修正为 xml');
  assert.equal(yy.enabled, false, '默认停用状态保持');
  const mt = out.find((s) => s.id === 'mt');
  assert.equal(mt.searchable, false, '茅台应跟随新默认不参与搜索');
  const bf = out.find((s) => s.id === 'bf');
  assert.equal(bf.enabled, false, '用户手动停用偏好保留');
  // 新增内置源（gs/md 等）补齐到存档
  assert.ok(out.find((s) => s.id === 'gs'));
  assert.ok(out.find((s) => s.id === 'md'));
});

test('migrateSources：改过地址的镜像源不跟随默认修正', () => {
  const saved = [{ id: 'mt', name: '我的茅台镜像', api: 'https://my-mirror.example.com/vod', format: 'auto', searchable: true, enabled: true }];
  const out = migrateSources(saved);
  const mt = out.find((s) => s.id === 'mt');
  assert.equal(mt.api, 'https://my-mirror.example.com/vod');
  assert.equal(mt.name, '我的茅台镜像');
  assert.equal(mt.searchable, true, '镜像源可能支持搜索，保留用户设置');
});
