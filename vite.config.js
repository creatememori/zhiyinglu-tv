import { defineConfig } from 'vite';
import { handleProxy, handleImg, handleStream } from './worker/proxy-core.js';

/**
 * 开发态同域中继：Vite dev 默认没有 /api/proxy、/api/img、/api/health，
 * 而采集源均无 CORS，浏览器直连会被拦截导致首页空。这里用与生产
 * （Cloudflare Pages Functions）完全相同的 proxy-core 承接这三个路由，
 * 使 `npm run dev` 也能真实回源、与线上行为一致。
 */
function relayPlugin() {
  return {
    name: 'creatememori-relay',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        try {
          const u = new URL(req.url, 'http://localhost');
          if (u.pathname === '/api/proxy' || u.pathname === '/api/health' || u.pathname === '/api/img' || u.pathname === '/api/stream') {
            const webReq = new Request(u.href, { method: req.method, headers: req.headers });
            const handler = u.pathname === '/api/img' ? handleImg : u.pathname === '/api/stream' ? handleStream : handleProxy;
            Promise.resolve(
              handler(webReq, {})
            ).then(async (webRes) => {
              res.statusCode = webRes.status;
              for (const [k, v] of webRes.headers) res.setHeader(k, v);
              res.end(Buffer.from(await webRes.arrayBuffer()));
            }).catch((e) => {
              res.statusCode = 500;
              res.setHeader('content-type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ error: 'internal_error', message: String(e?.message || e) }));
            });
            return;
          }
        } catch { /* 交给 next 处理 */ }
        next();
      });
    }
  };
}

export default defineConfig({
  base: './',                        // 相对路径 → GitHub Pages / Cloudflare Pages / Vercel 通用
  build: {
    target: 'es2018', chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // V14：播放器家族独立 chunk —— 配合 player.js 的动态导入，
        // 首包不再携带 artplayer/hls.js（约 400KB），进入播放页才按需加载。
        manualChunks: { player: ['artplayer', 'hls.js'] }
      }
    }
  },
  plugins: [relayPlugin()],
  optimizeDeps: { include: ['artplayer', 'hls.js'] },
  // allowedHosts：放行隧道/公网域名，避免 Vite 的 DNS 重绑定防护拦截非 localhost 访问
  server: { port: 5173, host: true, allowedHosts: ['.trycloudflare.com', '81.70.26.224', '10.2.0.4'] }
});
