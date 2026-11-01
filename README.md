<div align="center">

<a href="https://ko-fi.com/creatememori">
  <img src="./public/logo.png" width="130" alt="知影录 Logo" />
</a>

# 知影录 • Tv

> 🎬 纯前端影视聚合 SPA — 多源并行搜索，命中即播

[![Stars](https://img.shields.io/github/stars/creatememori/zhiyinglu-tv?style=social)](https://github.com/creatememori/zhiyinglu-tv/stargazers)
[![Forks](https://img.shields.io/github/forks/creatememori/zhiyinglu-tv?style=social)](https://github.com/creatememori/zhiyinglu-tv/network/members)
[![Issues](https://img.shields.io/github/issues/creatememori/zhiyinglu-tv)](https://github.com/creatememori/zhiyinglu-tv/issues)
![License](https://img.shields.io/github/license/creatememori/zhiyinglu-tv)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/creatememori)
[![QQ](https://img.shields.io/badge/QQ群-661816585-8b5cf6?logo=tencentqq)](https://qm.qq.com/q/tKu1lR8oPm)
[![爱发电](https://img.shields.io/badge/爱发电-支持作者-ff69b4.svg)](https://ifdian.net/a/creatememori)

🖥️ [**在线预览**](https://tv-eosin-five.vercel.app/)  
<sub>⚠️ 部署于 Vercel（海外平台），部分国内 API 源可能被屏蔽，封面/数据加载偶有不全。完整功能请自行部署至国内 VPS。</sub>

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/creatememori/zhiyinglu-tv)
[![Deploy to Cloudflare](https://img.shields.io/badge/Deploy-CF%20Pages-F6821F?logo=cloudflare)](https://dash.cloudflare.com/)

</div>

---

📖 **Readme:** [简体中文](README.md) | [English](README.en.md)

> [!TIP]
> 知影录是一款**纯前端影视聚合 SPA**，不依赖任何后端服务。内置 14 个 API 源，采用原生 ES Module 架构驱动多源并行搜索引擎，格式探测 → 双协议解析 → 字段归一 → 指纹去重全流程浏览器端完成。**零服务器，打开即用。**

<blockquote style="border-left:3px solid #8b5cf6;padding:0 1em;margin:16px 0">
🦾 <span style="color:#8b5cf6"><b>纯前端架构</b></span> — 不依赖 React / Vue / jQuery，原生 ES Module 自主驱动，<b>无后端，浏览器即引擎</b>
</blockquote>

<blockquote style="border-left:3px solid #d946ef;padding:0 1em;margin:16px 0">
⚡ <span style="color:#d946ef"><b>多源并行引擎</b></span> — 14 源并发聚合 · 格式探测 → 双协议解析 → 字段归一 · <b>先到先显，逐源增量渲染</b>
</blockquote>

<blockquote style="border-left:3px solid #8b5cf6;padding:0 1em;margin:16px 0">
🎯 <span style="color:#8b5cf6"><b>命中即播</b></span> — 搜索命中直接出播放线路，无需中转详情页，域名级 CDN 同源故障自动跳过
</blockquote>

<blockquote style="border-left:3px solid #d946ef;padding:0 1em;margin:16px 0">
🖥️ <span style="color:#d946ef"><b>服务端级中继</b></span> — 同域 API 代理解决 CORS 封锁 · Worker singleflight 请求合并 · Cloudflare / Vercel 双平台兼容
</blockquote>

<blockquote style="border-left:3px solid #8b5cf6;padding:0 1em;margin:16px 0">
🧠 <span style="color:#8b5cf6"><b>智能封面链</b></span> — 原图 → 跨源海报池 → CDN 镜像 · 豆瓣 / Bangumi / wmdb 三路兜底 · 并行竞速 + 看门狗出图
</blockquote>

<blockquote style="border-left:3px solid #d946ef;padding:0 1em;margin:16px 0">
📦 <span style="color:#d946ef"><b>全栈浏览器化</b></span> — IndexedDB 持久化全部数据 · PWA 离线壳 + SWR 缓存 · <b>零服务器，打开即用</b>
</blockquote>

## 📸 界面预览

| 🏠 首页 | 🏠 首页 |
|---|---|
| <img src="./docs/screenshots/ui1.jpg" width="100%" /> | <img src="./docs/screenshots/ui2.jpg" width="100%" /> |
| <img src="./docs/screenshots/ui3.jpg" width="100%" /> | <img src="./docs/screenshots/ui4.jpg" width="100%" /> |

<details><summary><b>📱 展开更多截图</b></summary>

| 🏠 首页 | 🏠 首页 |
|---|---|
| <img src="./docs/screenshots/ui5.jpg" width="100%" /> | <img src="./docs/screenshots/ui6.jpg" width="100%" /> |

| 🔍 搜索 | 📂 分类 |
|---|---|
| <img src="./docs/screenshots/ui7.jpg" width="100%" /> | <img src="./docs/screenshots/ui8.jpg" width="100%" /> |

| 📂 分类 | ⚡ 在线解析 |
|---|---|
| <img src="./docs/screenshots/ui9.jpg" width="100%" /> | <img src="./docs/screenshots/ui10.jpg" width="100%" /> |

| 📖 观看历史 | 📡 数据源管理 |
|---|---|
| <img src="./docs/screenshots/ui11.jpg" width="100%" /> | <img src="./docs/screenshots/ui12.jpg" width="100%" /> |

| 🎨 UI 自定义 | ⚙️ 设置 |
|---|---|
| <img src="./docs/screenshots/ui13.jpg" width="100%" /> | <img src="./docs/screenshots/ui14.jpg" width="100%" /> |

| ⚙️ 设置 | |
|---|---|
| <img src="./docs/screenshots/ui15.jpg" width="100%" /> | |

</details>

## ✨ 功能特性

### 🏠 首页聚合推荐

- [x] **Hero 轮播** · 热门影片大图展示，点击直达播放页
- [x] **快速分类入口** · 电影 / 连续剧 / 综艺 / 动漫四大版块一键浏览
- [x] **热门榜单** · 豆瓣高分 + 多题材聚合排行，点击站内搜索
- [x] **今日更新** · 17+ 数据源实时聚合去重，最新剧集即刻呈现
- [x] **为你推荐** · 豆瓣精选 + 源站随机组合，每次刷新都有新发现

### 🔍 全源并行搜索

- [x] **多源并发** · 最多 4 源同时发起请求，片名指纹去重
- [x] **增量渲染** · 搜索结果先到先显，越搜越多
- [x] **格式探测** · JSON / XML 双协议自动识别解析，字段别名智能归一
- [x] **预设分类** · 电影 / 剧集 / 动漫 / 综艺一键切换搜索范围

### 🎬 播放体验

- [x] **ArtPlayer 5** · hls.js 驱动，m3u8 / mp4 / flv 全格式支持
- [x] **片头片尾跳过** · 按片名独立记忆 intro / outro 秒数
- [x] **断点续播** · IndexedDB 持久化播放进度，刷新页面不丢失
- [x] **自动连播** · 剧集结束 3 秒倒计时自动跳转下一集
- [x] **云解析** · VIP 平台页面地址自动走解析线路

### 📡 数据源

- [x] **14 个内置源** · 12 个实测可用，开箱即用无需手动导入
- [x] **一键体检** · 并行探测延迟 + 健康评分排序，自动停用失效源
- [x] **自定义源** · 支持手动添加接口 + 配置文件导入导出

### 📱 PWA

- [x] **离线应用壳** · Service Worker 缓存静态资源，断网也能打开
- [x] **可安装** · 添加到手机桌面 / PC 主屏，接近原生应用体验

## 🚀 快速开始

```bash
git clone https://github.com/creatememori/zhiyinglu-tv.git
cd zhiyinglu-tv
npm install
npm run dev         # 本地 → http://localhost:5173
npm run build       # 生产 → dist/
npm test            # 运行测试
```

## ☁️ 平台托管部署

| 平台 | 说明 |
|------|------|
| **Vercel** | `api/` 自动识别 Serverless Functions |
| **Cloudflare Pages** | `functions/` 自动接管 API 中继 |
| **VPS / 裸机** | `node dev-server.mjs` → 端口 8787 |

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/creatememori/zhiyinglu-tv)

## ⚙️ 配置文件结构

```
src/
├── api/          # 聚合引擎 · 解析器 · 封面降级链 · 线路预检
├── core/         # 状态管理 · 路由 · IndexedDB · 配置迁移
├── pages/        # 首页 · 搜索 · 分类 · 详情 · 播放 · 直播 · 设置
├── player/       # ArtPlayer 封装 + video-bar 自定义进度条
├── ui/           # Toast · Modal · 海报卡片 · SVG 图标集
├── effects/      # 光标光晕 · 3D 线框 · 卡片倾斜 · 滚动渐入
└── styles/       # 液态毛玻璃设计系统 (78KB CSS)
```

## 🛠️ 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | **原生 ES Module** · 零运行时依赖 |
| 构建 | Vite 6 |
| 播放器 | ArtPlayer 5 · hls.js |
| 存储 | IndexedDB |
| PWA | Service Worker · Web Manifest |
| 中继 | Cloudflare Workers / Pages Functions / Vercel Serverless |
| 测试 | Node.js Native Test Runner |

## 📄 License

MIT © 2026

---

<div align="center">
  <a href="https://ko-fi.com/creatememori"><img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Support me on Ko-fi" /></a>
  <br><sub>💬 QQ群：661816585</sub>
  <br><br>
  <sub>本应用不存储、不上传任何视频内容，仅聚合第三方公开接口</sub>
</div>