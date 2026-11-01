import { parseQS } from './utils.js';
import { clearActs } from '../ui/ui.js';

const routes = new Map();
let cleanup = null;
export function onRoute(name, fn) { routes.set(name, fn); }

const TITLES = { home: '知影录•Tv · 全网聚合', search: '搜索', cat: '分类浏览', v: '影片详情', play: '正在播放', parse: '在线解析', history: '观看历史', sources: '数据源管理', settings: '设置', live: '电视直播' };

export function run(hash) {
  const target = document.getElementById('view');
  if (!target) return;
  const [raw, q = ''] = (hash || location.hash || '#/').replace(/^#/, '').split('?');
  const segs = raw.split('/').filter(Boolean);
  let name = segs[0] || 'home';
  if (!routes.has(name)) name = 'home';
  const handler = routes.get(name);
  const query = parseQS(q);
  const swap = () => {                       // 真正的 DOM 切换
    document.querySelectorAll('.modal-mask,.sheet').forEach((n) => n.remove());
    if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
    clearActs();                             // 清掉上一页的 data-act 闭包，防止跨页误触发
    target.innerHTML = '';
    cleanup = handler(target, segs, query) || null;
    window.scrollTo({ top: 0 });
  };
  try { // 原生 View Transitions；老浏览器退化为普通切换
    if (document.startViewTransition) document.startViewTransition(swap); else swap();
  } catch { swap(); }
  document.title = TITLES[name] || '知影录•Tv';
}
export function boot() { window.addEventListener('hashchange', () => run()); run(); }
export function goto(h) { if (location.hash === h) run(); else location.hash = h; }
