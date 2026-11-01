#!/bin/sh
# Creatememori 开发预览 · 一键启动
# 用法：sh start.sh

echo "[Creatememori] 启动开发服务器…"
cd /workspace/creatememori-tv

# 杀掉旧进程
pkill -f "dev-server.mjs" 2>/dev/null
pkill -f "localtunnel.*8787" 2>/dev/null
sleep 1

# 启动 dev server
nohup node dev-server.mjs > /tmp/dev.log 2>&1 &
sleep 2

# 检查 dev server
if curl -s -o /dev/null -w "%{http_code}" http://localhost:8787 | grep -q 200; then
  echo "[Creatememori] ✅ Dev server → http://localhost:8787"
else
  echo "[Creatememori] ❌ Dev server 启动失败，查看 /tmp/dev.log"
  exit 1
fi

# 启动公网隧道
echo "[Creatememori] 启动公网隧道…"
node /usr/local/lib/node_modules/localtunnel/bin/lt.js --port 8787 > /tmp/lt.log 2>&1 &
sleep 8

TUNNEL_URL=$(grep -o 'https://[^ ]*\.loca\.lt' /tmp/lt.log 2>/dev/null)
if [ -n "$TUNNEL_URL" ]; then
  echo "[Creatememori] ✅ 公网地址 → $TUNNEL_URL"
else
  echo "[Creatememori] ⚠️ 隧道可能还在连接，查看 /tmp/lt.log"
fi

echo "[Creatememori] 启动完成！"