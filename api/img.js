// Vercel 图片反代
const IMG_HOSTS = ['doubanio.com','img.doubanio.com','images.weserv.nl','wsrv.nl','img.cmliussss.net'];
function ok(url) { try { return IMG_HOSTS.some(h=>new URL(url).hostname.includes(h)); } catch { return false; } }

export default async function handler(req, res) {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const target = u.searchParams.get('url');
  if (!target) return res.status(400).end();
  if (!ok(target)) return res.status(403).end();
  try {
    const r = await fetch(target, { headers: { Referer: new URL(target).origin } });
    const buf = await r.arrayBuffer();
    res.status(r.status).setHeader('Content-Type', r.headers.get('content-type')||'image/jpeg');
    res.setHeader('Cache-Control','public,max-age=86400');
    res.send(Buffer.from(buf));
  } catch { res.status(502).end(); }
}