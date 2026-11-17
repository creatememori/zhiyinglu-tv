# 解析代理（方案 C）接入契约

> 目的：给“直连超时/被 XFO 拦截”的解析源一个兼容兜底。
> **不要把解析页代理到主站同源**：第三方 JS 会获得主站 origin，可读 localStorage、调用主站接口。

## 1. 部署要求

- 独立 registrable domain，例如 `jxproxy.example.com`，不要用 `app.example.com` 的路径反代。
- 不设置任何应用 Cookie；代理响应剥离 `Set-Cookie`。
- 代理域不承载登录态、后台接口、静态应用资源。
- 严格 host allowlist；禁止 localhost、内网 IP、任意 URL。
- 只代理 `https:`，限制响应体大小、超时、并发和速率。

## 2. 接口

### `GET /p?u=<encoded 解析页 URL>`

返回改写后的解析页 HTML：

- 删除 `X-Frame-Options`、`Content-Security-Policy`（仅该响应）；
- 去掉 `<meta http-equiv="Content-Security-Policy">` 与 `<base>`；
- 把 `src/href/action/poster` 等资源地址改写到 `/a?u=...`；
- 注入监控脚本（见下）；
- 不转发主站 Cookie，不把代理页 HTML 返回给主站 DOM。

### `GET /a?u=<encoded 资源 URL>`

代理解析页的子资源：

- 透传 `content-type`，不设置 `X-Frame-Options`；
- 剥离 `Set-Cookie`；
- 只允许 allowlist 资源域。

### `GET /health`

返回 `{ ok: true, version: 1 }`，客户端只用来判断代理是否启用，不参与源排序。

## 3. 监控脚本

代理页注入：

```js
(function () {
  var send = function (phase, extra) {
    try { parent.postMessage(Object.assign({ type: 'jx:state', phase: phase }, extra || {}), '*'); } catch (e) {}
  };
  addEventListener('DOMContentLoaded', function () { send('dom'); });
  setInterval(function () {
    var v = document.querySelector('video');
    if (v) send('media', { ready: v.readyState, src: v.currentSrc || v.src || '' });
  }, 1200);
  addEventListener('error', function () { send('error'); });
})();
```

主站只接受：

- `event.origin === 配置的代理 origin`；
- `event.data.type === 'jx:state'`；
- 消息只作为“页面/播放器信号”，不执行任何 HTML。

## 4. 客户端启用

在 `index.html` 加：

```html
<meta name="jx-proxy-origin" content="https://jxproxy.example.com">
```

或运行时：

```js
window.__JX_PROXY_ORIGIN = 'https://jxproxy.example.com';
```

未配置时：

- 不生成代理 URL；
- 不增加任何请求；
- 当前纯静态健康清单 + 直连 iframe 行为完全不变。

## 5. 调度策略（已实现于 `src/api/resolver.js` + `src/pages/play.js`）

1. 直连 iframe 先加载，保持首屏速度；
2. 直连 `error` / 9s 超时 / 源状态为 `bad` 时，若配置代理，切同一源代理；
3. 代理页 `load` 后等待 `jx:state` 信号，7s 无信号则下一路；
4. 直连全部试过仍失败，再对未代理过的源做一轮代理兜底；
5. 代理全部失败才提示“换目标页/新窗口/刷新源”。

## 6. 已知边界

- 代理页内再套跨域播放器 iframe 时，监控脚本仍读不到内层 `video`；这种情况需要无头浏览器抓真实媒体地址（方案 A）。
- 解析站可能检测 `window.top`、`location.host`、Cookie、指纹；代理不保证通过。
- 代理会多一跳，通常比直连慢；不要对所有源默认启用。