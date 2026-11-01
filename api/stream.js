// Vercel 流媒体中继
export default async function handler(req, res) {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const target = u.searchParams.get('url');
  if (!target) return res.status(400).end();
  try {
    const r = await fetch(target, { headers: { Referer: new URL(target).origin } });
    res.status(r.status);
    r.headers.forEach((v,k) => res.setHeader(k,v));
    res.setHeader('Access-Control-Allow-Origin','*');
    const buf = await r.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch { res.status(502).end(); }
}