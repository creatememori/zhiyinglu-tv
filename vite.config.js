import { defineConfig } from 'vite';

function relayPlugin() {
  return {
    name: 'zhiyinglu-relay',
    configureServer(server) {
      // 动态导入：仅 dev server 需要，不影响 build
      import('./worker/proxy-core.js').then(({ handleProxy, handleImg, handleStream }) => {
        server.middlewares.use((req, res, next) => {
          try {
            const u = new URL(req.url, 'http://localhost');
            if (u.pathname === '/api/proxy' || u.pathname === '/api/health' || u.pathname === '/api/img' || u.pathname === '/api/stream') {
              const webReq = new Request(u.href, { method: req.method, headers: req.headers });
              const handler = u.pathname === '/api/img' ? handleImg : u.pathname === '/api/stream' ? handleStream : handleProxy;
              Promise.resolve(handler(webReq, {}))
                .then(async (webRes) => {
                  res.statusCode = webRes.status;
                  for (const [k, v] of webRes.headers) res.setHeader(k, v);
                  res.end(Buffer.from(await webRes.arrayBuffer()));
                }).catch((e) => {
                  res.statusCode = 500;
                  res.setHeader('content-type', 'application/json; charset=utf-8');
                  res.end(JSON.stringify({ error: String(e?.message || 'internal') }));
                });
              return;
            }
          } catch {}
          next();
        });
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
