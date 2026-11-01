/* ============================================================
   Creatememori Service Worker —— 离线应用壳（App Shell）+ 静态资源 SWR
   策略Google Workbox 经典配方（不引入依赖，手写最小实现）：
   - 导航请求：网络优先，失败回退缓存的 index.html（离线也能打开应用壳）
   - 同源静态资源（js/css/字体/图标）：stale-while-revalidate
   - /api/* 中继接口与所有跨域请求：直接放行，绝不缓存
     （列表数据时效性优先；海报已有 IndexedDB blob 缓存与 Worker 缓存）
   部署注意：本文件位于 public/，构建后原样输出到站点根目录；
   改缓存策略时必须升 VERSION，否则旧缓存不会被清理。
   ============================================================ */
const VERSION = 'creatememori-shell-v15-2026-10-26';
const SHELL_CACHE = VERSION + ':shell';
const STATIC_CACHE = VERSION + ':static';
const SHELL = ['./', './index.html', './favicon.svg', './manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 跨域（图床 / 源站 / 字体 CDN）一律放行
  if (url.pathname.startsWith('/api/')) return;       // 中继接口永不缓存

  // 导航请求：网络优先，离线回退应用壳
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(SHELL_CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 同源静态资源：stale-while-revalidate（先出缓存，后台更新）
  if (/\.(?:js|css|svg|woff2?|ttf|png|webp|webmanifest)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then((cached) => {
        const fetched = fetch(req).then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        }).catch(() => cached);
        return cached || fetched;
      })
    );
  }
});
