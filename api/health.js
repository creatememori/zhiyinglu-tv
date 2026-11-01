// Vercel 健康检查
export default function handler(req, res) {
  res.json({ service:'Zhiyinglu API', ok:true, runtime:'vercel-node', timestamp:new Date().toISOString() });
}