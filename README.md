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
[![QQ](https://img.shields.io/badge/QQ群-661816585-8b5cf6?logo=tencentqq)](https://qm.qq.com/q/creatememori)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/creatememori/zhiyinglu-tv)
[![Deploy to Cloudflare](https://img.shields.io/badge/Deploy-CF%20Pages-F6821F?logo=cloudflare)](https://dash.cloudflare.com/)

</div>

---

📖 **Readme:** [简体中文](README.md) | [English](README.en.md)

⚡ **开箱即用** · 14 个内置 API 源，零配置上手  
🎬 **全源聚合** · 并行搜索 + 指纹去重 + 命中即播  
📺 **流畅播放** · ArtPlayer 5 + hls.js + 自定义紫色进度条  
🎨 **暗色毛玻璃** · 4 种主题色 · 液态玻璃设计  
📱 **PWA 离线壳** · 可安装到主屏

## 📸 界面预览

### 🏠 首页

<img src="./docs/screenshots/ui1.jpg" width="300" /> <img src="./docs/screenshots/ui2.jpg" width="300" /> <img src="./docs/screenshots/ui3.jpg" width="300" />

<details>
<summary>📱 首页更多截图</summary>
<img src="./docs/screenshots/ui4.jpg" width="300" /> <img src="./docs/screenshots/ui5.jpg" width="300" /> <img src="./docs/screenshots/ui6.jpg" width="300" />
</details>

### 🔍 搜索

<img src="./docs/screenshots/ui7.jpg" width="480" />

### 📂 分类

<img src="./docs/screenshots/ui8.jpg" width="480" /> <img src="./docs/screenshots/ui9.jpg" width="480" />

### ⚡ 在线解析

<img src="./docs/screenshots/ui10.jpg" width="480" />

### 📖 观看历史

<img src="./docs/screenshots/ui11.jpg" width="480" />

### 📡 数据源管理

<img src="./docs/screenshots/ui12.jpg" width="480" />

### 🎨 UI 自定义

<img src="./docs/screenshots/ui13.jpg" width="480" />

### ⚙️ 设置

<img src="./docs/screenshots/ui14.jpg" width="480" /> <img src="./docs/screenshots/ui15.jpg" width="480" />

## ✨ 功能特性

### 🏠 首页聚合推荐

- **Hero 轮播** · 热门影片大图展示，一键跳转播放
- **快速分类入口** · 电影 / 连续剧 / 综艺 / 动漫四大版块
- **热门榜单** · 豆瓣高分 + 多题材聚合，点击站内搜索
- **今日更新** · 17+ 数据源聚合去重，实时刷新
- **为你推荐** · 个性化推荐 + 豆瓣精选

### 🔍 全源并行搜索

- 最多 4 源并发，片名指纹去重，命中即得线路
- 逐源增量渲染 — 先到的先展示，越搜越多
- 搜索预设分类，一键切换电影/剧集/动漫

### 🎬 播放体验

- **ArtPlayer 5** · hls.js 驱动，m3u8/mp4/flv 全支持
- **自定义紫色进度条** · 点击跳转 · 拖拽滑块 · 悬浮时间预览
- **片头片尾跳过** · 按片名独立记忆
- **断点续播** · IndexedDB 持久化
- **自动连播** · 剧集结束自动跳下一集

### 📡 数据源

- 14 个内置 API 源，一键体检并行探测
- 健康评分排序，自动停用失效源
- 支持自定义源 + 配置导入导出

### 📱 PWA 离线壳

Service Worker 缓存静态资源，可安装到桌面

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