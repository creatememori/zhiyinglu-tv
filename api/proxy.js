// Vercel API 中继 — 独立轻量版（不依赖 worker/）
// Node.js 18+ 原生支持 fetch/Request/Response

const HOSTS = [
  'bfzyapi.com','lziapi.com','ffzyapi.com','360zy.com',
  'moguvod.com','cjapi.com','kkapi.com','mjwapicj.com',
  'xzdst.cn','blackbox.com','libvio.com','tvapi.com',
  'douban.com','doubanio.com','img.doubanio.com',
  'images.weserv.nl','wsrv.nl','img.cmliussss.net'
];

function allowHost(url) {
  try { return HOSTS.some(h => new URL(url).hostname.includes(h)); }
  catch { return false; }
}

export default async function handler(req, res) {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const target = u.searchParams.get('url');

  // 健康检查
  if (u.pathname === '/api/health') {
    return res.json({ service:'Zhiyinglu API', ok:true, runtime:'vercel-node' });
  }

  if (!target) return res.status(400).json({ error:'missing_url' });
  if (!allowHost(target)) return res.status(403).json({ error:'host_not_allowed', host:new URL(target).hostname });

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: { 'User-Agent':'Mozilla/5.0','Accept':'*/*','Referer':new URL(target).origin },
      redirect: 'follow',
    });
    const buf = await upstream.arrayBuffer();
    res.status(upstream.status);
    upstream.headers.forEach((v,k) => { if (!['content-encoding','transfer-encoding'].includes(k.toLowerCase())) res.setHeader(k,v); });
    res.setHeader('Access-Control-Allow-Origin','*');
    res.send(Buffer.from(buf));
  } catch(e) {
    res.status(502).json({ error:'upstream_fail', message:e.message });
  }
}