import './styles/app.css';
import { loadState, state, applyTheme, saveSettings, subscribe } from './core/state.js';
import { boot } from './core/router.js';
import { U, svg, modal } from './ui/ui.js';
// 注册全部页面路由（副作用导入）
import './pages/home.js';
import './pages/search.js';
import './pages/category.js';
import './pages/detail.js';
import './pages/play.js';
import './pages/history.js';
import './pages/sources.js';
import './pages/settings.js';
import './pages/live.js';

/* PWA 离线壳：仅生产环境注册 Service Worker（开发期避免缓存干扰热更新） */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

async function mountShell() {
  document.getElementById('app').innerHTML = `
    <div class="bg"></div>
    <header class="topbar-wrap">
      <div class="topbar glass liquid" data-spot>
        <a class="logo" data-href="#/"><span class="logo-badge logo-img"></span><b><span class="logo-name">知影录</span><span class="logo-tv">•Tv</span></b></a>
        <nav class="nav-links">
          <a class="nav-a" data-href="#/">${svg('home')} 首页</a>
          <a class="nav-a" data-href="#/cat">${svg('grid')} 分类</a>
          <a class="nav-a" data-href="#/parse">${svg('bolt')} 解析</a>
          <a class="nav-a" data-href="#/history">${svg('clock')} 历史</a>
          <a class="nav-a" data-href="#/sources">${svg('radar')} 数据源<span class="nav-warn" id="nav-warn" hidden></span></a>
          <a class="nav-a" data-href="#/settings">${svg('gear')} 设置</a>
        </nav>
        <button class="search-mini" data-href="#/search">${svg('search')}<span class="muted">搜索</span><kbd>⌘K</kbd></button>
        <!-- 移动端顶栏快捷图标（≤680px 显示） -->
        <div class="top-icos">
          <a class="top-ico" data-href="#/sources" title="数据源">${svg('radar')}<span class="nav-warn top-warn" id="nav-warn-m" hidden></span></a>
          <a class="top-ico" data-href="#/settings" title="设置">${svg('gear')}</a>
        </div>
      </div>
    </header>
    <main id="view"></main>
    <nav class="dock glass liquid">${[['#/', 'home', '首页'], ['#/search', 'search', '搜索'], ['#/cat', 'grid', '分类'], ['#/parse', 'bolt', '解析'], ['#/history', 'clock', '历史']].map(([h, i, n]) => `<a class="dock-a" data-href="${h}">${svg(i)}<span>${n}</span></a>`).join('')}</nav>`;

  U.initGlobals();

  // ⌘K / Ctrl+K 聚焦搜索
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault(); location.hash = '#/search';
      setTimeout(() => document.getElementById('si')?.focus(), 380);
    }
  });

  // 数据源红点提醒（导航与移动顶栏同步；订阅 state 通知，体检结果出来后实时刷新）
  const paintWarn = () => {
    const bad = Object.values(state.health).filter((h) => h.id && !h.id.startsWith('jx:') && h.status === 'down').length;
    const w1 = document.getElementById('nav-warn'), w2 = document.getElementById('nav-warn-m');
    if (w1) { w1.hidden = bad === 0; w1.textContent = bad; }
    if (w2) { w2.hidden = bad === 0; w2.textContent = bad; }
  };
  paintWarn();
  subscribe(paintWarn);

  // 导航激活态
  const paintNav = () => {
    const seg = (location.hash.replace(/^#/, '').split('/')[0]) || 'home';
    document.querySelectorAll('.nav-a, .dock-a').forEach((a) => a.classList.toggle('on', a.dataset.href === '#' + seg));
  };
  window.addEventListener('hashchange', paintNav);
  paintNav();

  document.getElementById('boot')?.remove();
  boot();

  // 首启引导
  if (!state.settings.seen) {
    state.settings.seen = true; saveSettings();
    modal(`<div class="modal-body fade-up">
      <div class="modal-title">欢迎使用知影录 👋</div>
      <ol class="hello-list">
        <li>已内置 <b>35 个影视源接口</b>（默认启用 21 个）+ <b>8 个目录参考</b> + <b>9 个点播解析源</b>，<b>无需手动导入</b>，开箱即用</li>
        <li>首页/搜索 = <b>全源并行聚合 + 片名指纹去重</b></li>
        <li>搜索命中即得线路，详情页与播放页 <b>秒开</b>；播放页支持 <b>片头片尾跳过</b></li>
        <li>VIP 平台页面地址自动走「点播解析源」云解析</li>
        <li>设置页可 <b>导入/导出配置与订阅</b>，全量数据可迁移</li>
        <li>进度 / 历史 / 缓存全部存于你的浏览器本地</li>
      </ol>
      <p class="muted" style="font-size:12px">源失效时点顶部「数据源」一键体检替换，标准源兼容 maccms v10（JSON/XML）；正式站点通过同域 Worker 中继请求。</p>
      <div class="modal-ft"><button class="btn primary" id="hello-ok">开始使用</button></div>
    </div>`);
    document.querySelector('#hello-ok').onclick = () => document.querySelector('.modal-mask')?.remove();
  }
}

loadState().then(() => {
  applyTheme(); mountShell();
  
//全局交互动效（光标光晕/卡片倾斜/磁吸/滚动渐入）
  import('./effects/interactions.js').then((m) => m.initInteractions()).catch(() => {});
  // 顶栏滚动加深
  const tw = document.querySelector('.topbar-wrap');
  window.addEventListener('scroll', () => { tw?.classList.toggle('scrolled', window.scrollY > 24); }, { passive: true });
});
window.addEventListener('unhandledrejection', (e) => {
  console.warn('[知影录]', e.reason);
  try { U.toast('操作失败：' + String(e.reason?.message || e.reason).slice(0, 60), { type: 'err' }); } catch {}
});
