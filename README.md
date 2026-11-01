# Creatememori · 知影录•Tv

纯前端影视聚合 SPA：多源 AppleCMS 聚合 + ArtPlayer 播放 + 云解析 + 电视直播 + PWA 离线壳。
Vite + 原生 ES Module（不引入 React/Vue），IndexedDB 本地数据，Cloudflare Pages Functions/Worker 受控中继。

**采集源开箱即用，无需手动导入**：内置 14 个 API 源（12 个经真机实测可用，含格式/搜索/详情能力标注）+ 8 个目录参考 + 9 个解析源；各接口输出经「格式探测 → JSON/XML 双协议解析 → 字段别名归一 → 地址清洗 → 标题指纹聚合」统一管线后供全站使用。另支持与 LunaTV 配置/订阅互导作为迁移通道。

## 功能特性

- **全源并行聚合搜索**：最多 4 源并发、片名指纹去重、命中即得线路、逐源增量渲染
- **分类浏览**：每源本地分类解析（名称→语义桶→全局 ID 三级回退）+ 无限滚动增量渲染
- **播放链路**：ArtPlayer 5 + hls.js——有界重试、失败自动换线、片头片尾跳过、断点续播、自动连播；超百集剧集分批虚拟渲染 + 正/倒序
- **电视直播**：LunaTV lives 配置导入即播（`#/live`），m3u8/mp4 直链，直播不写历史
- **封面聚合**：豆瓣 / Bangumi / wmdb 三路智能兜底 + 豆瓣 CDN 公共镜像（无中继也出图）+ 图床反代 + 5 秒加载看门狗
- **LunaTV 互导**：配置文件 / base58 订阅双向迁移；设置+历史+进度全量导出导入
- **PWA**：Service Worker 离线应用壳 + 静态资源 SWR，可安装到主屏
- **性能工程**：播放器依赖按需加载（路由级代码分割）、渲染签名去重、中继并行探测、Worker singleflight 请求合并

## 快速开始

```bash
npm install
npm run dev      # 本地开发
npm run build    # 产物输出到 dist/
npm run preview  # 本地预览构建产物
npm test         # Node 原生测试（74 项）
```

## 目录结构

```
├── index.html            # 入口（字体非阻塞加载、PWA manifest）
├── vite.config.js        # Vite 构建（player chunk 独立拆分）
├── package.json
├── public/               # favicon / manifest.webmanifest / sw.js（PWA 离线壳）
├── src/
│   ├── main.js           # 应用外壳 + SW 注册 + 首启引导
│   ├── core/             # state / router / db(IndexedDB) / config / data / lunaconfig / utils
│   ├── api/              # cms(聚合请求) / adapters(传输) / posters(封面) / parsers(解析) / sources(清单)
│   ├── pages/            # home / search / category / detail / play / live / history / sources / settings
│   ├── player/           # ArtPlayer + hls.js 封装（按需动态加载）
│   ├── ui/               # 组件库（卡片/海报链/Toast/Modal/全局委派）
│   └── styles/app.css    # 全部样式（主题变量 + 毛玻璃体系）
├── worker/               # Cloudflare Worker（proxy-core 双端共用）
├── functions/api/        # Cloudflare Pages Functions（/api/proxy、/api/img、/api/health）
└── tests/                # Node --test 纯逻辑回归
```

## Cloudflare 部署

### 方案 A：Cloudflare Pages + Pages Functions（同项目、同域名，推荐）

1. 将整个项目推送到 Git 仓库，Cloudflare Pages 构建命令设为 `npm run build`，输出目录设为 `dist`。
2. 保留仓库根目录 `functions/api/proxy.js` 与 `worker/proxy-core.js`；Pages Functions 会提供同域 `/api/proxy` 路由。
3. 部署后打开「数据源」页逐个单测；如果首页仍无结果，优先检查 Worker 返回的 `host_not_allowed`、上游错误或数据源状态。
4. 自定义 API 主机需要加到 Cloudflare 环境变量 `SOURCE_HOSTS`，多个域名用英文逗号分隔，例如 `api.example.com,api.other.example`。不要把不可信任的任意域名加进白名单。

### 方案 B：独立 Cloudflare Worker

项目附带 `worker/index.js` 和 `wrangler.toml`。执行 `npx wrangler deploy` 前，请先登录 Wrangler，并按 `wrangler.toml` 注释把 Worker Route 配到自己域名的 `/api/*`。如果用 Pages Functions 方案，则不需要单独部署 Worker。

### 部署验收

- 访问 `https://你的域名/api/health`，应返回代理健康状态确认。
- 静态托管（GitHub Pages 等）无中继时自动走直连/公共代理兜底，但多数采集源无 CORS，实际可用性以 Cloudflare 部署为准。

## 数据源安全与可靠性提示

- Worker 只允许内置的源站域名，避免成为任意 URL 的开放代理；新增自定义源时需同步配置 `SOURCE_HOSTS`（API）/ `IMG_HOSTS`（图片）。
- 公共 API 的存活、CORS、数据完整性和版权授权可能变化；代码接入不代表已经实测这些来源当前可用，也不保证源站内容合法或稳定。请仅接入你有权访问和使用的来源。
- 点播解析源仍按现有配置提供，解析可达性与具体视频播放可用性需分别测试。
