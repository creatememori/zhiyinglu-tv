// Vercel Serverless Function 格式适配层
// 把 Cloudflare Pages 的 onRequest(context) 转为 Vercel 的 (req, res)
import { handleProxy } from './lib/proxy-core.js';

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const request = new Request(url.href, {
    method: req.method,
    headers: req.headers,
    body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
  });
  const context = { request, env: process.env };
  const response = await handleProxy(request, context);
  res.status(response.status);
  response.headers.forEach((v, k) => res.setHeader(k, v));
  res.send(await response.text());
}