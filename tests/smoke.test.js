import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * 冒烟测试：把除入口 main.js（其顶部直接调用 window/env API）外的所有
 * 客户端模块逐个 import。作用：在无浏览器环境下验证模块解析、导入命名、
 * 顶层副作用（onRoute 注册）都不出错 —— 比 node --check 更接近构建产物
 * 的实际加载过程。main.js 仅含模板字符串与既有导入，语法已另行校验。
 */
const MODULES = [
  '../src/ui/ui.js',
  '../src/core/utils.js',
  '../src/core/router.js',
  '../src/core/db.js',
  '../src/core/config.js',
  '../src/core/state.js',
  '../src/core/data.js',
  '../src/core/lunaconfig.js',
  '../src/api/sources.js',
  '../src/api/adapters.js',
  '../src/api/parsers.js',
  '../src/api/cms.js',
  '../src/api/posters.js',
  '../src/player/player.js',
  '../src/pages/home.js',
  '../src/pages/search.js',
  '../src/pages/category.js',
  '../src/pages/detail.js',
  '../src/pages/play.js',
  '../src/pages/history.js',
  '../src/pages/sources.js',
  '../src/pages/settings.js',
  '../src/pages/live.js'
];

test('all client modules resolve and register their routes without error', async () => {
  for (const m of MODULES) {
    await assert.doesNotReject(() => import(m), `import ${m} should not throw`);
  }
  assert.ok(true);
});