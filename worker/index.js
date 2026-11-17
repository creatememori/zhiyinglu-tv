import { handleProxy, handleImg, handleStream, handleJxProbe } from './proxy-core.js';

export default {
  fetch(request, env, ctx) {
    try {
      const path = new URL(request.url).pathname;
      if (path === '/api/img' || path.startsWith('/api/img?')) return handleImg(request, env);
      if (path === '/api/stream' || path.startsWith('/api/stream?')) return handleStream(request, env);
      if (path === '/api/jxprobe' || path.startsWith('/api/jxprobe?')) return handleJxProbe(request, env);
      return handleProxy(request, env);
    } catch (e) {
      return new Response(JSON.stringify({ error: 'internal_error', message: String(e?.message || e).slice(0, 200) }), { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } });
    }
  }
};
