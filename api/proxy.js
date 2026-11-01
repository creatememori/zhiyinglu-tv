// Vercel Serverless Function — API 代理入口
// 使用 Node.js 内置 fetch/Request/Response (Node 18+)
import { handleProxy, handleImg, handleStream } from '../../worker/proxy-core.js';

const handlers = { img: handleImg, stream: handleStream, proxy: handleProxy, health: handleProxy };

export default async function handler(req, res) {
  const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host}`);
  const name = pathname.split('/').pop(); // proxy | img | stream | health

  // 构造 Web Request
  const webReq = new Request(`http://host${pathname}?${searchParams}`, {
    method: req.method,
    headers: Object.entries(req.headers).reduce((h, [k, v]) => { h.set(k, v); return h; }, new Headers()),
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
  });

  const fn = handlers[name] || handleProxy;
  try {
    const webRes = await fn(webReq, { env: process.env });
    res.status(webRes.status);
    webRes.headers.forEach((v, k) => res.setHeader(k, v));
    const buf = await webRes.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (e) {
    res.status(502).json({ error: 'proxy_error', message: e.message });
  }
}