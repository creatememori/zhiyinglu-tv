// Vercel — 健康检查
import { handleProxy } from '../../worker/proxy-core.js';
export default async function handler(req, res) {
  const webReq = new Request('http://host/api/health', { method: 'GET' });
  const webRes = await handleProxy(webReq, { env: process.env });
  res.status(webRes.status).json(await webRes.json());
}