import test from 'node:test';
import assert from 'node:assert/strict';
import { epDisplayOrder, epWindowSize } from '../src/core/utils.js';

/* ============ 剧集分批虚拟渲染（纯函数） ============ */

test('epWindowSize：默认一批 120；目标集超出窗口时按批扩展', () => {
  assert.equal(epWindowSize(0, 120, 120, 500), 120);
  assert.equal(epWindowSize(119, 120, 120, 500), 120);
  assert.equal(epWindowSize(120, 120, 120, 500), 240);   // 第 121 集触发扩批
  assert.equal(epWindowSize(300, 120, 120, 500), 360);
  assert.equal(epWindowSize(499, 120, 120, 500), 500);   // 不超过总数
  assert.equal(epWindowSize(0, 120, 120, 0), 0);         // 空列表
  assert.equal(epWindowSize(50, 240, 120, 500), 240);    // 已展开的不回缩
});

test('epDisplayOrder：正序/倒序均映射回真实集数索引', () => {
  assert.deepEqual(epDisplayOrder(5, 3, false), [0, 1, 2]);
  assert.deepEqual(epDisplayOrder(5, 3, true), [4, 3, 2]);
  assert.deepEqual(epDisplayOrder(5, 10, false), [0, 1, 2, 3, 4]);  // shown 超出 total 自动截断
  assert.deepEqual(epDisplayOrder(0, 120, false), []);
});

test('epDisplayOrder + epWindowSize 组合：倒序时当前集一定落在窗口内', () => {
  const total = 1000, cur = 3;                          // 当前第 4 集
  const curVisible = total - 1 - cur;                   // 倒序后它排在第 997 位
  const shown = epWindowSize(curVisible, 120, 120, total);
  const order = epDisplayOrder(total, shown, true);
  assert.ok(order.includes(cur), '倒序窗口必须包含当前集');
  assert.equal(order[0], total - 1, '倒序首项是最后一集');
  assert.ok(shown > curVisible, '窗口扩到能容纳当前集');
  assert.equal(shown, total, '窗口不超过总数（被 total 截断）');
});
