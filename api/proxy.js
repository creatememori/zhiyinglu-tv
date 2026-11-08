// Vercel API 中继 — 完全同步服务器 worker/proxy-core.js 白名单
// 注意：Vercel 海外 IP 可能被部分国内站封，此为平台限制非代码问题

const DOMAINS = [
  'bfzyapi.com','lziapi.com','ffzyapi.com','360zy.com',
  'hongniuzy2.com','ikunzyapi.com','maotaizy.cc','dyttzyapi.com',
  'jszyapi.com','juliang.live','yyzy-tv.vip',
  'heimuer.xyz','wolongzyw.com','suoniapi.com','apiyhzy.com',
  'apibdzy.com','wujinapi.com','haiwaikan.com','hw8.live',
  'huyaapi.com','tyyszy.com','rycjapi.com','sdzyapi.com',
  'kczyapi.com','zuidapi.com','niuniuzy.me','ukuapi.com',
  'hhzyapi.com','xinlangapi.com','mozhuazy.com','49zyw.com','wwzy.tv',
  'movie.douban.com','douban.com','api.bgm.tv','api.wmdb.tv'
];

const IMG_HOSTS = [
  'p.bfvp26.com','img.lzipic.com','fffgood.com','hongniuzyimage.com',
  'empimage.slcache.com','img.jisuimage.com','img.dytt-tupian.com',
  'doubanio.com','lain.bgm.tv','img.wmdb.tv',
  'p.lztutu.com','img.bdzyimg1.com','image.huyajs.com',
  'img.bfzypic.com','www.imgzy360.com','pic.youkupic.com','ok.zuidapic.com',
  'images.weserv.nl','wsrv.nl','cmliussss.net','cmliussss.com','img.doubanio.com'
];

function ok(url, list) {
  try { return list.some(h => new URL(url).hostname.includes(h)); } catch { return false; }
}

export default async function handler(req, res) {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const target = u.searchParams.get('url');
  const path = u.pathname;

  if (path === '/api/health')
    return res.json({ service:'Zhiyinglu API', ok:true, hosts:DOMAINS.length, imgHosts:IMG_HOSTS.length });

  if (!target) return res.status(400).json({ error:'missing_url' });

  // 图片反代
  if (path === '/api/img') {
    if (!ok(target, IMG_HOSTS)) return res.status(403).end();
    try {
      const r = await fetch(target, { headers: { Referer: new URL(target).origin } });
      res.status(r.status).setHeader('Content-Type', r.headers.get('content-type')||'image/jpeg');
      res.setHeader('Cache-Control','public,max-age=86400');
      return res.send(Buffer.from(await r.arrayBuffer()));
    } catch { return res.status(502).end(); }
  }

  // 流媒体中继
  if (path === '/api/stream') {
    try {
      const r = await fetch(target, { headers: { Referer: new URL(target).origin } });
      r.headers.forEach((v,k) => res.setHeader(k,v));
      res.setHeader('Access-Control-Allow-Origin','*');
      return res.send(Buffer.from(await r.arrayBuffer()));
    } catch { return res.status(502).end(); }
  }

  // 通用 API 代理
  if (!ok(target, DOMAINS))
    return res.status(403).json({ error:'host_not_allowed', host:new URL(target).hostname });

  try {
    const r = await fetch(target, {
      method: req.method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Referer': new URL(target).origin,
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      redirect: 'follow',
    });
    const buf = await r.arrayBuffer();
    r.headers.forEach((v,k) => {
      const lk = k.toLowerCase();
      if (!['content-encoding','transfer-encoding'].includes(lk)) res.setHeader(k,v);
    });
    res.setHeader('Access-Control-Allow-Origin','*');
    res.send(Buffer.from(buf));
  } catch(e) { res.status(502).json({ error:'upstream_fail', message:e.message }); }
}