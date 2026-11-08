export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
/** djb2 字符串哈希（base36 输出）：为任意 URL/文本生成稳定短 ID，用于历史记录去重等场景 */
export const hashId = (s = '') => { let h = 5381; const str = String(s); for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
export const debounce = (fn, ms = 350) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const shuffle = (a) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [r[i], r[j]] = [r[j], r[i]]; } return r; };
export const parseQS = (q = '') => { const o = {}; for (const [k, v] of new URLSearchParams(q)) o[k] = v; return o; };

export function fmtDur(s = 0) {
  s = Math.max(0, Math.floor(s || 0)); const h = (s / 3600) | 0, m = ((s % 3600) / 60) | 0, x = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(x)}` : `${m}:${p(x)}`;
}
export function timeAgo(ts) {
  const s = Math.max(1, (Date.now() - ts) / 1000) | 0;
  if (s < 60) return '刚刚';
  if (s < 3600) return `${(s / 60) | 0}分钟前`;
  if (s < 86400) return `${(s / 3600) | 0}小时前`;
  return `${(s / 86400) | 0}天前`;
}
export const fmtBytes = (n = 0) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1024).toFixed(0) + ' KB');

/**
 * 标题归一化 —— 同名影片聚合去重的核心指纹：
 * 去广告括号/别名/空白/标点、NFKC 全半角归一、保留季数与年份差异。
 * 《凡人修仙传》/ [高清]凡人修仙传 / 凡人修仙傳 → 同一 key
 */
export function normalizeTitle(name = '') {
  if (!name) return '';
  let s = String(name).trim();
  s = s.replace(/<[^>]+>/g, '')
       .replace(/[【\[［].*?[】\]］]/g, '')
       .replace(/（(?:别名|又名)[^）]*）/g, '')
       .replace(/\s+/g, '')
       .normalize('NFKC')
       .replace(/[·、,，。.!！?？:：;；'"’“”‘()（）《》〈〉\-—_–~～|｜\\/]/g, '');
  s = s.replace(/第\s*([一二三四五六七八九十百千万\d]+)\s*季.*$/g, '$1季'); // 保留第X季区分季别
  return s.toLowerCase();
}

/** 剧集号提取："第12集"/"EP.3"/"12" → number；用于同名跨源集匹配 + 自动连播 */
export function epNum(label = '') {
  const s = String(label);
  let m = s.match(/第\s*(\d{1,4})\s*[集话回話期]/);
  if (m) return +m[1];
  m = s.match(/\bEP?\.?\s*(\d{1,4})\b/i);
  if (m) return +m[1];
  m = s.match(/(\d{1,4})/);
  return m ? +m[1] : null;
}

/* ---------- 剧集分批虚拟渲染（） ----------
   超百集剧集一次渲染全部按钮会明显掉帧，改为按批渲染 + 倒序支持。
   纯函数便于测试；play.js 的 renderEps 使用。 */

/** 展示窗口大小：保证目标集（在展示序列中的位置 curVisibleIdx）落在窗口内，按 chunk 扩批 */
export function epWindowSize(curVisibleIdx, shown, chunk, total) {
  const t = Math.max(0, total | 0);
  let s = Math.max(chunk | 0, shown | 0);
  const cur = Math.max(0, curVisibleIdx | 0);
  while (s <= cur && s < t) s += chunk;
  return Math.min(s, t);
}

/** 展示索引序列：正序 [0..n) 或倒序 [total-1..]，仅取前 shown 个（映射回真实集数索引） */
export function epDisplayOrder(total, shown, desc = false) {
  const t = Math.max(0, total | 0);
  const n = Math.max(0, Math.min(shown | 0, t));
  const arr = new Array(n);
  for (let i = 0; i < n; i++) arr[i] = desc ? t - 1 - i : i;
  return arr;
}

/** VIP 平台页面地址识别：命中则由"点播解析源"接管 */
const VIP_HOSTS = ['v.qq.com','iqiyi.com','iq.com','youku.com','mgtv.com','bilibili.com','b23.tv',
  '1905.com','pptv.com','le.com','sohu.com','cctv.com','yangshipin.cn','douyin.com','kuaishou.com',
  'migu.cn','miguvideo.com','youtube.com','acfun.cn','ixigua.com'];
export function isVipUrl(url = '') {
  try { const h = new URL(url).hostname.toLowerCase(); return VIP_HOSTS.some((k) => h === k || h.endsWith('.' + k)); } catch { return false; }
}
export function copyText(t) { return navigator.clipboard?.writeText(t).catch(() => {}); }

/* ---------- 媒体地址安全化（通用直链清洗思路） ---------- */

/**
 * http → https 升级：HTTPS 站点上加载 http 海报/视频会被浏览器“混合内容”策略
 * 直接拦截（控制台报 Mixed Content），这是线上部署封面空白、播放失败的常见原因。
 */
export function toHttps(url = '') {
  const s = String(url || '').trim();
  if (!s) return s;
  if (/^http:/i.test(s)) return s.replace(/^http:/i, 'https:');
  return s;
}

/** 识别“网页地址”而非直链媒体：部分源把 /share/ 分享页塞进播放字段，播放器无法直出 */
export function isPageUrl(url = '') {
  try {
    const u = new URL(String(url));
    return /\/share\//i.test(u.pathname);
  } catch { return false; }
}

/**
 * 海报候选链：原图 → weserv 开源图片代理（解决混合内容、防盗链、慢源）→ 内置占位。
 * 集合去重保证 onerror 级联时不重复尝试同一地址。
 */
export function posterCandidates(pic = '') {
  const p = String(pic || '').trim();
  if (!p) return [PF];
  if (p.startsWith('data:') || p.startsWith('blob:')) return [p, PF];
  const list = [];
  if (/^https?:/i.test(p)) {
    const secure = toHttps(p);
    list.push(secure);
    if (secure !== p) list.push(p);        // https 失败后按原 http 再试一次（http 页面下才可能成功）
    list.push('https://images.weserv.nl/?url=' + encodeURIComponent(p));
  } else {
    list.push(p);
  }
  return [...new Set([...list, PF])];
}

/* 海报占位（全量编码，可安全放入任意属性字符串） */
export const PF = "data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 300 450%27%3E%3Crect width=%27300%27 height=%27450%27 fill=%27%2315151d%27/%3E%3Cpath d=%27M118 170l70 42-70 42z%27 fill=%27%23424466%27/%3E%3C/svg%3E";
