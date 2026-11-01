/* 分类兜底 */
export const CC_TYPES = [[1, '电影'], [2, '连续剧'], [3, '综艺'], [4, '动漫']];

/**
 * 内置接口清单：
 * - auto：AppleCMS/macCMS 常见 JSON/XML 自动识别
 * - xml：固定 XML 输出（/at/xml/）
 * - custom：非标准 API，默认停用，避免错误响应拖慢首页；验证返回结构后再启用
 */
export const DEFAULT_CMS_SOURCES = [
  { id: 'bf', name: '暴风资源', api: 'https://bfzyapi.com/api.php/provide/vod', format: 'auto', searchable: true, enabled: true },
  { id: 'lz', name: '量子资源', api: 'https://cj.lziapi.com/api.php/provide/vod', format: 'auto', searchable: true, enabled: true },
  { id: 'ff', name: '非凡资源', api: 'https://cj.ffzyapi.com/api.php/provide/vod', format: 'auto', searchable: true, enabled: true },
  { id: '360', name: '360资源', api: 'https://360zy.com/api.php/provide/vod', format: 'auto', searchable: true, enabled: true },
  { id: 'hn', name: '红牛资源', api: 'https://www.hongniuzy2.com/api.php/provide/vod/at/xml/', format: 'xml', searchable: true, enabled: true, note: 'XML 接口；部分网络/地区连接被重置，故障时请停用或切换网络重试' },
  { id: 'ikun', name: 'iKun资源', api: 'https://ikunzyapi.com/api.php/provide/vod', format: 'auto', searchable: true, enabled: true, note: '部分网络/地区连接被重置，故障时请停用或切换网络重试' },
  { id: 'mt', name: '茅台资源', api: 'https://caiji.maotaizy.cc/api.php/provide/vod/at/xml/', format: 'xml', searchable: false, enabled: true, note: '实测不支持关键词搜索（返回 code:1002），仅参与列表/详情' },
  { id: 'dytt', name: '电影天堂资源', api: 'https://caiji.dyttzyapi.com/api.php/provide/vod', format: 'auto', searchable: true, enabled: true },
  { id: 'js', name: '极速资源', api: 'https://jszyapi.com/api.php/provide/vod', format: 'auto', searchable: true, enabled: true },
  { id: 'jl', name: '巨量资源', api: 'https://api.juliang.live/api/provide/vod/at/xml/', format: 'xml', searchable: true, enabled: true, note: '候选接口' },
  { id: 'gs', name: '光速资源', api: 'https://api.guangsuapi.com/api.php/provide/vod', format: 'auto', searchable: true, enabled: true, note: '实测可用（支持 t 分类筛选）' },
  { id: 'md', name: '麻豆资源', api: 'https://www.mdzyapi.com/api.php/provide/vod', format: 'auto', searchable: true, enabled: true, note: '实测可用（支持 t 分类筛选）' },
  // 实测：两个 ldg 接口返回的都是标准 maccms XML（不是非标 JSON），格式从 custom 改正为 xml。
  // 但它们忽略 ids 参数（详情取数永远返回全量列表）→ 拿不到播放地址，默认仍停用；
  // 需要扩充列表/搜索覆盖面时可在数据源页手动启用，播放请切换到支持详情的源。
  { id: 'yy-all', name: '优质资源 / 黑木耳综合接口', api: 'https://api.yyzy-tv.vip/inc/ldg_api_all.php', format: 'xml', searchable: true, enabled: false, note: '实测标准 maccms XML；支持列表/搜索，不支持详情取数（无播放线路），默认停用' },
  { id: '1080zyk', name: '1080ZYK高清资源库', api: 'https://api.yyzy-tv.vip/inc/ldg_api.php', format: 'xml', searchable: true, enabled: false, note: '实测标准 maccms XML；支持列表/搜索，不支持详情取数（无播放线路），默认停用' },

  /* ---- 新增采集源（已实测：2026-10-28） ---- */
  // ✅ 搜索+列表均可用
  { id: 'baidu', name: '百度资源', api: 'https://api.apibdzy.com/api.php/provide/vod', format: 'auto', searchable: true, enabled: true },
  { id: 'wujin', name: '无尽资源', api: 'https://api.wujinapi.com/api.php/provide/vod', format: 'auto', searchable: true, enabled: true },
  { id: 'huya', name: '虎牙资源', api: 'https://www.huyaapi.com/api.php/provide/vod', format: 'auto', searchable: true, enabled: true },
  { id: 'zuida', name: '最大资源', api: 'https://api.zuidapi.com/api.php/provide/vod', format: 'auto', searchable: true, enabled: true },
  { id: 'huohu', name: '火狐资源', api: 'https://hhzyapi.com/api.php/provide/vod', format: 'auto', searchable: true, enabled: true },
  // ⚠️ 列表可用但不支持关键词搜索（返回"暂不支持搜索"）
  { id: 'suoni', name: '索尼资源', api: 'https://suoniapi.com/api.php/provide/vod', format: 'auto', searchable: false, enabled: true, note: '实测列表/详情可用，不支持搜索' },
  { id: 'tianya', name: '天涯资源', api: 'https://tyyszy.com/api.php/provide/vod', format: 'auto', searchable: false, enabled: true, note: '实测列表/详情可用，不支持搜索' },
  { id: 'shandian', name: '闪电资源', api: 'http://sdzyapi.com/api.php/provide/vod', format: 'auto', searchable: false, enabled: true, note: '实测列表/详情可用，不支持搜索；HTTP 源可能被浏览器混合内容拦截' },
  { id: 'niuniu', name: '牛牛资源', api: 'https://api.niuniuzy.me/api.php/provide/vod', format: 'auto', searchable: false, enabled: true, note: '实测列表/详情可用，不支持搜索' },
  // ❌ 实测 502/不可用，默认停用（源站恢复后可手动启用）
  { id: 'heimuer', name: '黑木耳', api: 'https://json.heimuer.xyz/api.php/provide/vod', format: 'auto', searchable: true, enabled: false, note: '实测 502（2026-10-28），源站不可用' },
  { id: 'wolong', name: '卧龙资源', api: 'https://collect.wolongzyw.com/api.php/provide/vod', format: 'auto', searchable: true, enabled: false, note: '实测返回 HTML 页面而非数据（2026-10-28）' },
  { id: 'yinghua', name: '樱花资源', api: 'https://m3u8.apiyhzy.com/api.php/provide/vod', format: 'auto', searchable: true, enabled: false, note: '实测 502（2026-10-28）' },
  { id: 'haiwai', name: '海外看', api: 'https://haiwaikan.com/api.php/provide/vod', format: 'auto', searchable: true, enabled: false, note: '实测 502（2026-10-28）' },
  { id: 'huawei', name: '华为吧', api: 'https://hw8.live/api.php/provide/vod', format: 'auto', searchable: true, enabled: false, note: '实测 502（2026-10-28）' },
  { id: 'ruyi', name: '如意资源', api: 'https://cj.rycjapi.com/api.php/provide/vod', format: 'auto', searchable: true, enabled: false, note: '实测 502（2026-10-28）' },
  { id: 'kuaiche', name: '快车资源', api: 'https://caiji.kczyapi.com/api.php/provide/vod', format: 'auto', searchable: true, enabled: false, note: '实测 502（2026-10-28）' },
  { id: 'uku', name: 'U酷资源', api: 'https://api.ukuapi.com/api.php/provide/vod', format: 'auto', searchable: true, enabled: false, note: '实测 502（2026-10-28）' },
  { id: 'mozhua', name: '魔爪资源', api: 'https://mozhuazy.com/api.php/provide/vod', format: 'auto', searchable: true, enabled: false, note: '实测 502（2026-10-28）' },
  { id: 'sijiu', name: '四九资源', api: 'https://49zyw.com/api.php/provide/vod', format: 'auto', searchable: true, enabled: false, note: '实测 502（2026-10-28）' },
  { id: 'wangwang', name: '旺旺短剧', api: 'https://wwzy.tv/api.php/provide/vod', format: 'auto', searchable: true, enabled: false, note: '实测 502（2026-10-28）' },
  { id: 'xinlang', name: '新浪资源', api: 'https://api.xinlangapi.com/xinlangapi.php/provide/vod', format: 'auto', searchable: false, enabled: false, note: '列表可用但搜索返回空（2026-10-28），默认停用观察' }
];

/** 以下是目录网站，不是采集 API，不会参与首页请求；同一网址被用户列为多个目录类别，按原意保留名称。 */
export const DIRECTORY_SOURCES = [
  { id: 'dir-mango', name: '芒果资源（目录）', url: 'https://www.zzzypro.com/', note: '目录站点，不是可直接采集的 API' },
  { id: 'dir-changzhang', name: '厂长资源（目录）', url: 'https://www.zzzypro.com/', note: '目录站点，不是可直接采集的 API' },
  { id: 'dir-muji', name: '母鸡资源（目录）', url: 'https://www.zzzypro.com/', note: '目录站点，不是可直接采集的 API' },
  { id: 'dir-tianya', name: '天涯资源（目录）', url: 'https://www.zzzypro.com/', note: '目录站点，不是可直接采集的 API' },
  { id: 'dir-kuyun', name: '酷云资源（目录）', url: 'https://www.szkfq.cn/', note: '目录站点，不是可直接采集的 API' },
  { id: 'dir-hot', name: '热门资源（目录）', url: 'https://www.szkfq.cn/', note: '目录站点，不是可直接采集的 API' },
  { id: 'dir-huiji', name: '汇集资源（目录）', url: 'https://www.szkfq.cn/', note: '目录站点，不是可直接采集的 API' },
  { id: 'dir-caicai', name: '采采资源（目录）', url: 'https://www.szkfq.cn/', note: '目录站点，不是可直接采集的 API' }
];

/* 点播解析源（云解析）：目标视频页 URL 追加在模板尾部即可 */
export const DEFAULT_JIEXI_SOURCES = [
  { id: 'jx202617', name: '2026解析', url: 'https://jx.202617.xyz/tv.php?url=' },
  { id: 'lxyy', name: '乐享YY', url: 'https://jx.lxyy.club/index.php?url=' },
  { id: 'bdjx', name: 'BD解析', url: 'https://bd.jx.cn/?url=' },
  { id: '789jx', name: '789解析', url: 'https://jiexi.789jiexi.com/?url=' },
  { id: 'txnp', name: 'txnp播放', url: 'https://bfq.txnp.cn/player?url=' },
  { id: 'aibox', name: 'AIBox', url: 'https://aibox.eu.org/?url=' },
  { id: 'yemy', name: '野木解析', url: 'https://yemu.xyz/?url=', note: '社区清单实测可达' },
  { id: 'yparse', name: 'YParse解析', url: 'https://yparse.ik9.cc/index.php?url=', note: '社区清单实测可达' },
  { id: 'xmflv', name: 'XMFLV解析', url: 'https://jx.xmflv.com/?url=', note: '社区清单实测可达' }
];

/* 仅供无同域中继时的 CORS 兜底；正式部署优先走同域 /api/proxy Worker，不依赖公共代理。
   corsproxy.io 已改为强制要求 API Key（2026），不再内置；allorigins 部分网络可能不可达。 */
export const DEFAULT_PROXIES = ['https://api.allorigins.win/raw?url='];

/**
 * 搜索预设分类（快捷分类：名称 + movie/tv 类型 + 查询词）。
 * 展示在搜索页 chips 行，可在设置中增删改。
 */
export const DEFAULT_PRESETS = [
  { id: 'p-movie-hot', name: '电影·热门', type: 'movie', query: '热门' },
  { id: 'p-movie-classic', name: '电影·经典', type: 'movie', query: '经典' },
  { id: 'p-movie-action', name: '动作', type: 'movie', query: '动作' },
  { id: 'p-movie-scifi', name: '科幻', type: 'movie', query: '科幻' },
  { id: 'p-movie-comedy', name: '喜剧', type: 'movie', query: '喜剧' },
  { id: 'p-tv-domestic', name: '国产剧', type: 'tv', query: '国产剧' },
  { id: 'p-tv-kr', name: '韩剧', type: 'tv', query: '韩剧' },
  { id: 'p-tv-anime', name: '动漫', type: 'tv', query: '动漫' }
];

/** 直播源槽位：由外部配置导入填充；起支持 m3u8/mp4 直链直播播放（#/live）。 */
export const DEFAULT_LIVE_SOURCES = [];

export const DEFAULT_SETTINGS = {
  seen: false, accent: 'sunset', glass: 20, fx: true,
  autoplay: true, autonext: true, resume: true, autoScan: true,
  cmsSources: DEFAULT_CMS_SOURCES, jiexiSources: DEFAULT_JIEXI_SOURCES,
  proxies: DEFAULT_PROXIES, recent: [], favs: [], lastScan: 0,
  presets: DEFAULT_PRESETS, liveSources: DEFAULT_LIVE_SOURCES,
  cacheTime: 1800, // 搜索结果缓存时长（秒），对应配置的缓存时长
  relayBase: '',   // 自定义中继基址（自建 Worker 等）；留空使用同域 /api/proxy
  sourceCatalogVersion: 4   // ldg 双源 custom→xml、茅台 searchable=false 的迁移标记
};
export const newCmsSource = (id) => ({ id: id || 's' + Math.random().toString(36).slice(2, 8), name: '新数据源', api: 'https://example.com/api.php/provide/vod/', format: 'auto', searchable: true, enabled: true });
export const newJxSource = (id) => ({ id: id || 'j' + Math.random().toString(36).slice(2, 8), name: '新解析源', url: 'https://example.com/?url=' });
