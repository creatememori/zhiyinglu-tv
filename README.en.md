<div align="center">

<a href="https://ko-fi.com/creatememori">
  <img src="./public/logo.png" width="130" alt="Zhiyinglu Logo" />
</a>

# Zhiyinglu • Tv

> 🎬 Pure Frontend Media Aggregator — Multi-source Search, Click to Play

[![Stars](https://img.shields.io/github/stars/creatememori/zhiyinglu-tv?style=social)](https://github.com/creatememori/zhiyinglu-tv/stargazers)
[![Forks](https://img.shields.io/github/forks/creatememori/zhiyinglu-tv?style=social)](https://github.com/creatememori/zhiyinglu-tv/network/members)
![License](https://img.shields.io/github/license/creatememori/zhiyinglu-tv)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/creatememori)
[![QQ](https://img.shields.io/badge/QQ_Group-661816585-8b5cf6?logo=tencentqq)](https://qm.qq.com/q/creatememori)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/creatememori/zhiyinglu-tv)

</div>

---

📖 **Readme:** [简体中文](README.md) | **English**

⚡ **Plug & Play** · 14 built-in API sources, zero config required  
🎬 **Federated Search** · Parallel multi-source · fingerprint dedup · incremental render  
📺 **Smooth Playback** · ArtPlayer 5 + hls.js · skip intro/outro · custom progress bar  
🎨 **Dark Glassmorphism** · Purple gradient · 4 theme colors · responsive  
📱 **PWA** · Installable · offline shell

## ✨ Features

### 🏠 Home Feed

- Hero carousel with trending titles
- Quick category tiles (Movies / TV / Variety / Anime)
- Hot ranking board aggregated from multiple sources
- Daily updates from 17+ sources, auto-dedup
- Personalized recommendations

### 🔍 Search

- Up to 4 sources in parallel
- Title fingerprint dedup
- Incremental rendering — results appear as they arrive
- Search preset categories

### 🎬 Player

- ArtPlayer 5 with hls.js
- Custom progress bar with click-to-seek, drag, hover preview
- Skip intro/outro per-title memory
- Resume playback from last position
- Auto-play next episode
- Cloud parser for VIP platforms

### 📡 Sources

- 14 built-in API sources (12 verified working)
- One-click health check with parallel latency probe
- Custom source support + config import

## 🚀 Quick Start

```bash
git clone https://github.com/creatememori/zhiyinglu-tv.git
cd zhiyinglu-tv
npm install
npm run dev        # → http://localhost:5173
npm run build      # → dist/
```

## ☁️ Deploy

| Platform | Notes | 
|------|------|
| **Vercel** | `api/` auto-detected as Serverless Functions |
| **Cloudflare Pages** | `functions/` auto-detected |
| **VPS** | `node dev-server.mjs` on port 8787 |

## 🛠️ Tech Stack

| Category | Technology |
|------|------|
| Framework | **Vanilla ES Modules** · Zero dependencies |
| Build | Vite 6 |
| Player | ArtPlayer 5 · hls.js |
| Storage | IndexedDB |
| PWA | Service Worker · Web Manifest |
| Relay | Cloudflare Workers / Pages Functions / Vercel Serverless |

## 📄 License

MIT © 2026

---

<div align="center">
  <sub>This application does not store or upload any video content. It only aggregates third-party public APIs.</sub>
</div>