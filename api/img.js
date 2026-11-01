// Vercel — 图片反代
import { handleImg } from '../../worker/proxy-core.js';
export default async function handler(req, res) {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const webReq = new Request(u.href, { headers: new Headers(req.headers) });
  const webRes = await handleImg(webReq, { env: process.env });
  res.status(webRes.status);
  webRes.headers.forEach((v, k) => res.setHeader(k, v));
  const buf = await webRes.arrayBuffer();
  res.send(Buffer.from(buf));
}