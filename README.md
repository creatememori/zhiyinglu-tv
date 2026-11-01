<div align="center">

<img src="./public/logo-bai.png" width="120" height="107" alt="知影录 Logo" />

# 知影录 • Tv

> 纯前端影视聚合 SPA —— 多源并行搜索，命中即播

[![Stars](https://img.shields.io/github/stars/creatememori/zhiyinglu-tv?style=social)](https://github.com/creatememori/zhiyinglu-tv/stargazers)
[![Forks](https://img.shields.io/github/forks/creatememori/zhiyinglu-tv?style=social)](https://github.com/creatememori/zhiyinglu-tv/network/members)
[![Issues](https://img.shields.io/github/issues/creatememori/zhiyinglu-tv)](https://github.com/creatememori/zhiyinglu-tv/issues)
![License](https://img.shields.io/github/license/creatememori/zhiyinglu-tv)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/creatememori/zhiyinglu-tv)
[![Deploy to Cloudflare Pages](https://img.shields.io/badge/Deploy-CF%20Pages-F6821F?logo=cloudflare)](https://dash.cloudflare.com/)

</div>

---

⚡ **开箱即用** · 内置 14 个 API 源，无需手动导入
🎬 **聚合搜索** · 全源并行 + 指纹去重 + 逐源增量渲染
📺 **流畅播放** · ArtPlayer 5 + hls.js · 片头尾跳过 · 断点续播
🎨 **暗色毛玻璃** · 紫色渐变主题 · 响应式适配
📱 **PWA 离线壳** · 可安装到主屏

<table align="center">
  <tr>
    <td align="center"><b>🏠 首页聚合</b></td>
    <td align="center"><b>🔍 多源搜索</b></td>
    <td align="center"><b>🎬 播放页面</b></td>
  </tr>
</table>

## ✨ 功能特性

| 模块 | 特性 |
|------|------|
| 🔍 **搜索** | 全源并行聚合 · 片名指纹去重 · 命中即得线路 · 逐源增量渲染 |
| 📂 **分类** | 本地分类解析 · 名称→语义桶→全局 ID 三级回退 · 无限滚动 |
| ▶️ **播放** | ArtPlayer 5 + hls.js · 失败自动换线 · 片头片尾跳过 · 自动连播 |
| 📡 **直播** | m3u8/mp4 直链 · 配置导入即播 · 直播不写历史 |
| 🖼️ **封面** | 豆瓣 / Bangumi / wmdb 三路兜底 · CDN 镜像链 · 加载看门狗 |
| 📦 **迁移** | 配置 / base58 订阅双向互导 · 全量数据导出导入 |
| 📱 **PWA** | Service Worker 离线壳 · 静态资源缓存 · 可安装到主屏 |
| ⚡ **性能** | 播放器按需加载 · 渲染签名去重 · 中继并行探测 |

## 🚀 快速开始

```bash
git clone https://github.com/creatememori/zhiyinglu-tv.git
cd zhiyinglu-tv
npm install
npm run dev      # 本地 → http://localhost:5173
npm run build    # 构建 → dist/
```

## ☁️ 部署

| 平台 | 说明 | 部署 |
|------|------|------|
| **Vercel** | 自动识别 `vercel.json` | [![Deploy](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/creatememori/zhiyinglu-tv) |
| **Cloudflare Pages** | `functions/` 自动接管 API | 连接仓库 → `npm run build` → `dist/` |
| **VPS / 裸机** | Node.js 16+ | `node dev-server.mjs` → `:8787` |

## 📁 目录结构

```
├── src/
│   ├── api/       # 聚合引擎 · 解析器 · 封面链 · 线路探测
│   ├── core/      # 状态管理 · 路由 · IndexedDB · 配置
│   ├── pages/     # 首页 · 搜索 · 分类 · 详情 · 播放 · 直播 · 设置
│   ├── player/    # ArtPlayer + video-bar 进度条组件
│   ├── ui/        # Toast · Modal · 海报卡片 · 图标集
│   ├── effects/   # 光晕 · 3D线框 · 滚动渐入
│   └── styles/    # 液态毛玻璃设计系统 (78KB)
├── worker/        # Cloudflare Worker 中继
├── functions/api/ # Cloudflare Pages Functions
├── api/           # Vercel Serverless Functions
└── tests/         # 14 项 Node 原生测试
```

## 🛠️ 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | **原生 ES Module** · 零框架依赖 |
| 构建 | Vite 6 |
| 播放器 | ArtPlayer 5 · hls.js |
| 存储 | IndexedDB |
| 中继 | Cloudflare Workers / Pages Functions / Vercel Serverless |
| PWA | Service Worker · Web Manifest |

## 📄 License

MIT © 2026

---

<div align="center">
<sub>本应用不存储、不上传任何视频内容，仅聚合第三方公开接口</sub>
</div>