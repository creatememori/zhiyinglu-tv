import { handleProxy } from './lib/proxy-core.js';

export default async function handler(req, res) {
  const url = new URL('/api/health', `https://${req.headers.host}`);
  const request = new Request(url.href, { method: 'GET' });
  const context = { request, env: process.env };
  const response = await handleProxy(request, context);
  res.status(response.status).json(await response.json());
}