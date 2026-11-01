import { handleStream } from './lib/proxy-core.js';

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const request = new Request(url.href, { headers: req.headers });
  const context = { request, env: process.env };
  const response = await handleStream(request, context);
  res.status(response.status);
  response.headers.forEach((v, k) => res.setHeader(k, v));
  if (response.body) {
    const buf = await response.arrayBuffer();
    res.send(Buffer.from(buf));
  } else {
    res.end();
  }
}