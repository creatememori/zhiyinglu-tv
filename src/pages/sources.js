import { onRoute } from '../core/router.js';
import { state, cmsSources, jiexiSources, saveSettings } from '../core/state.js';
import { checkCms, checkAll, reportHealth } from '../api/cms.js';
import { pingJiexi } from '../api/parsers.js';
import { newCmsSource, newJxSource, DEFAULT_SETTINGS, DIRECTORY_SOURCES, DEFAULT_PRESETS, DEFAULT_LIVE_SOURCES } from '../api/sources.js';
import { U, svg, onAct } from '../ui/ui.js';
import { esc } from '../core/utils.js';

onRoute('sources', (view) => {
  view.innerHTML = `<div class="page slim">
    <div class="sec-head"><h2>${svg('radar', 'hot')} 数据源管理</h2>
      <div class="row-btns"><button class="btn xs ghost" id="scan-all">${svg('refresh')} 全站体检</button>
      <button class="btn xs primary" id="add-src">${svg('plus')} 添加 AppleCMS 源</button></div></div>
    <div class="set-card glass proxy-diagnostic-card"><div class="set-t">部署与中继诊断 <span class="muted">· 用于判断当前页面是否命中最新 Worker</span></div>
      <div class="src-stat" id="proxy-status">尚未检测。建议先检查部署路由，再判断源站认证。</div>
      <div class="row-btns" style="margin-top:10px"><button class="btn xs primary" id="proxy-check">${svg('activity')} 检查 /api/health</button><a class="btn xs ghost" href="/api/health" target="_blank" rel="noopener noreferrer">直接打开诊断端点</a></div>
    </div>
    <div class="src-sec-head">影视 API 候选 <span class="muted" id="src-stat-text">· 加载中…</span></div>
    <div id="cms-list"></div>
    <div class="src-sec-head">目录类来源 <span class="muted">· 仅作参考，不参与 API 采集</span></div>
    <div id="directory-list"></div>
    <div class="src-sec-head">点播解析源 <span class="muted">· VIP页面云解析（模板+目标URL）</span>
      <button class="btn xs primary" id="add-jx">${svg('plus')} 添加</button></div>
    <div id="jx-list"></div>
    <div class="src-sec-head">直播源 <span class="muted">· M3U 订阅配置 · 支持 m3u8/mp4 直链</span>
      <button class="btn xs ghost" data-href="#/live">${svg('tv')} 全部直播</button>
      <button class="btn xs primary" id="m3u-import">${svg('link')} M3U 订阅导入</button></div>
    <div class="set-card glass" id="m3u-panel" style="display:none;margin-bottom:10px">
      <div class="set-t">M3U 订阅导入</div>
      <div class="src-line"><input class="input" id="m3u-url" placeholder="粘贴 M3U/M3U8 订阅地址（http://…/playlist.m3u）" style="flex:1"></div>
      <div class="row-btns" style="margin-top:10px"><button class="btn xs primary" id="m3u-go">解析导入</button><button class="btn xs ghost" id="m3u-cancel">取消</button></div>
      <div class="muted" id="m3u-status" style="font-size:12px;margin-top:8px">通过同域服务端解析（/api/liveparse），规避订阅站 CORS 限制；每 30 分钟缓存一次。</div>
    </div>
    <div id="live-list"></div>
    <div class="set-card glass"><div class="set-t">本地开发备用中继 <span class="muted">正式站点优先走同域 /api/proxy</span></div>
      <textarea class="input" id="proxy-ta" rows="3" style="width:100%">${esc((state.settings.proxies || []).join('\n'))}</textarea>
      <div class="row-btns" style="margin-top:10px"><button class="btn xs primary" id="save-proxy">保存中继</button><button class="btn xs ghost" id="restore-default">恢复默认配置</button></div></div>
    <div class="src-tips">💡 标准 AppleCMS 接口支持 JSON/XML；非标准接口默认停用，建议单测确认后再启用。目录网址不是采集 API，不能直接参与聚合。正式部署需启用 Cloudflare Pages Function（/api/proxy），自定义接口域名需加入 Worker 的 SOURCE_HOSTS 白名单。</div></div>`;

  const LABEL = { healthy: '健康', slow: '较慢', degraded: '近期不稳定', unauthorized: '需要授权', rate_limited: '请求限流', error: '异常', down: '下线', unknown: '未检测' };
  view.querySelector('#proxy-check').onclick = async () => {
    const box = view.querySelector('#proxy-status');
    box.textContent = '正在请求同域 /api/health…';
    try {
      const r = await fetch('/api/health?ts=' + Date.now(), { cache: 'no-store', headers: { accept: 'application/json' } });
      const raw = await r.text();
      let data; try { data = JSON.parse(raw); } catch {}
      if (!r.ok || !data?.build || data?.service !== '知影录 API proxy') {
        box.textContent = `诊断失败：HTTP ${r.status}。当前路径可能未部署 Pages Function/Worker，或返回了静态 HTML。响应：${raw.replace(/\s+/g, ' ').slice(0, 180)}`;
        return;
      }
      box.textContent = `中继已响应 · build=${data.build} · 路由=${data.route} · 白名单域名数=${data.sourceHostAllowlistCount} · 时间=${data.timestamp}。这只证明中继可达，不代表上游 API 授权成功。`;
    } catch (e) {
      box.textContent = `无法访问 /api/health：${e?.message || '网络错误'}。请确认 Pages Functions 已随项目部署，且当前站点域名包含该路由。`;
    }
  };
  const findC = (id) => state.settings.cmsSources.find((s) => s.id === id);
  const findJ = (id) => state.settings.jiexiSources.find((s) => s.id === id);

  function renderAll() {
    const total = (state.settings.cmsSources || []).length;
    const enabled = (state.settings.cmsSources || []).filter((s) => s.enabled !== false).length;
    const statEl = view.querySelector('#src-stat-text');
    if (statEl) statEl.textContent = `· ${total} 个源 · ${enabled} 个已启用（实测结论见卡片备注）`;
    view.querySelector('#cms-list').innerHTML = (state.settings.cmsSources || []).map((s) => {
      const h = state.health[s.id] || {};
      return `<div class="src-card glass" data-spot>
        <div class="src-line"><span class="health-dot d-${h.status || 'unknown'}"></span><b>${esc(s.name)}</b>
          <span class="badge">${s.searchable !== false ? '可搜索' : '不可搜'}</span><span class="badge">${s.format === 'xml' ? 'XML' : s.format === 'custom' ? '非标准接口' : 'JSON/XML'}</span>${s.enabled === false ? '<span class="badge err2">已停用</span>' : ''}</div>
        <div class="src-api muted">${esc(s.api)}</div>${s.note ? `<div class="src-stat muted">${esc(s.note)}</div>` : ''}
        <div class="src-stat">${h.avg ? `平均 <b>${h.avg}ms</b> · ` : ''}成功 <b class="ok">${h.ok || 0}</b> / 失败 <b class="err">${h.fail || 0}</b> · 状态 <b>${LABEL[h.status] || '未知'}</b></div>
        ${h.lastErr ? `<div class="src-err">最近错误：${esc(h.lastErr)}</div>` : ''}
        <div class="src-ops">
          <button class="btn xs ghost" data-act="test" data-id="${s.id}">${svg('bolt')} 单测</button>
          <button class="btn xs ghost" data-act="edit" data-id="${s.id}">${svg('gear')} 编辑</button>
          <button class="btn xs ghost" data-act="toggle" data-id="${s.id}">${s.enabled === false ? '启用' : '停用'}</button>
          <button class="btn xs ghost" data-act="up" data-id="${s.id}">${svg('chevU')}</button>
          <button class="btn xs ghost" data-act="down" data-id="${s.id}">${svg('chevD')}</button>
          <button class="btn xs danger ghost" data-act="del" data-id="${s.id}">${svg('trash')}</button>
        </div></div>`;
    }).join('') || '<div class="muted">暂无数据源，点击右上角添加</div>';

    view.querySelector('#directory-list').innerHTML = DIRECTORY_SOURCES.map((d) => `<div class="src-card glass" data-spot>
      <div class="src-line"><span class="health-dot d-unknown"></span><b>${esc(d.name)}</b><span class="badge">目录参考</span></div>
      <a class="src-api muted" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">${esc(d.url)}</a>
      <div class="src-stat muted">${esc(d.note)}。同网址的多个目录名称来自原清单，已保留用于对照。</div>
    </div>`).join('');

    view.querySelector('#jx-list').innerHTML = jiexiSources().map((j) => {
      const h = state.health['jx:' + j.id] || {};
      return `<div class="src-card glass" data-spot>
        <div class="src-line"><span class="health-dot d-${h.status || 'unknown'}"></span><b>${esc(j.name)}</b><span class="badge">解析</span></div>
        <div class="src-api muted">${esc(j.url)}</div>
        <div class="src-stat">${h.avg && h.avg !== 99999 ? `延迟 <b>${h.avg}ms</b> · ` : ''}状态 <b>${LABEL[h.status] || '未知'}</b></div>
        <div class="src-ops">
          <button class="btn xs ghost" data-act="testjx" data-id="${j.id}">${svg('bolt')} 探测</button>
          <button class="btn xs ghost" data-act="editjx" data-id="${j.id}">${svg('gear')} 编辑</button>
          <button class="btn xs danger ghost" data-act="deljx" data-id="${j.id}">${svg('trash')}</button>
        </div></div>`;
    }).join('') || '<div class="muted">暂无解析源</div>';

    view.querySelector('#live-list').innerHTML = (state.settings.liveSources || []).map((lv) => `<div class="src-card glass" data-spot>
        <div class="src-line"><span class="health-dot d-unknown"></span><b>${esc(lv.name)}</b><span class="badge">直播</span>${lv.epg ? '<span class="badge">含 EPG 字段</span>' : ''}</div>
        <div class="src-api muted">${esc(lv.url)}</div>
        <div class="src-stat muted">随 lives 配置导入。支持 m3u8 / mp4 直链播放，直播不产生观看历史。</div>
        <div class="src-ops"><button class="btn xs primary" data-act="playlive" data-id="${esc(lv.id)}">${svg('play')} 播放</button></div>
      </div>`).join('') || '<div class="muted">暂无直播源。「设置 → 数据迁移 → 导入配置」可带入 lives 条目。</div>';
  }

  onAct('test', async (b) => { const s = findC(b.dataset.id); U.toast(`正在检测 ${esc(s.name)}…`); const r = await checkCms(s); r.ok ? U.toast(`${esc(s.name)} 正常 · ${r.ms}ms`, { type: 'ok' }) : U.toast(`${esc(s.name)}：${r.err || '不可用'}`, { type: 'err' }); renderAll(); });
  onAct('testjx', async (b) => { const j = findJ(b.dataset.id); const r = await pingJiexi(j, { force: true }); r.ok ? U.toast(`${esc(j.name)} 可达 · ${r.ms}ms`, { type: 'ok' }) : U.toast(`${esc(j.name)} 不可达`, { type: 'err' }); renderAll(); });
  onAct('toggle', (b) => { const s = findC(b.dataset.id); s.enabled = s.enabled === false ? true : false; saveSettings(); renderAll(); });
  onAct('up', (b) => moveC(b.dataset.id, -1));
  onAct('down', (b) => moveC(b.dataset.id, 1));
  function moveC(id, d) { const a = state.settings.cmsSources; const i = a.findIndex((s) => s.id === id); const j = i + d; if (i < 0 || j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; saveSettings(); renderAll(); }
  onAct('del', async (b) => { const s = findC(b.dataset.id); if (await U.confirmDlg({ title: '删除数据源？', body: esc(s.name), danger: true })) { state.settings.cmsSources = state.settings.cmsSources.filter((x) => x.id !== s.id); saveSettings(); renderAll(); } });
  onAct('deljx', async (b) => { if (await U.confirmDlg({ title: '删除解析源？', danger: true })) { state.settings.jiexiSources = state.settings.jiexiSources.filter((x) => x.id !== b.dataset.id); saveSettings(); renderAll(); } });
  onAct('playlive', (b) => { location.hash = '#/live?src=' + encodeURIComponent(b.dataset.id); });
  onAct('edit', (b) => editCms(findC(b.dataset.id), false));
  onAct('editjx', (b) => editJx(findJ(b.dataset.id), false));
  view.querySelector('#add-src').onclick = () => editCms(newCmsSource(), true);
  view.querySelector('#add-jx').onclick = () => editJx(newJxSource(), true);
  view.querySelector('#scan-all').onclick = async () => {
    const list = cmsSources();
    U.toast(`开始全站体检（${list.length} 个已启用源）…`);
    const results = await checkAll(list, null, 3);
    renderAll();
    const okN = results.filter((x) => x.ok).length;
    U.toast(`体检完成：${okN}/${list.length} 可用`, { type: okN ? 'ok' : 'err' });
  };
  view.querySelector('#save-proxy').onclick = () => { state.settings.proxies = view.querySelector('#proxy-ta').value.split('\n').map((x) => x.trim()).filter(Boolean); saveSettings(); U.toast('中继已保存', { type: 'ok' }); };
  view.querySelector('#restore-default').onclick = async () => {
    if (!await U.confirmDlg({ title: '恢复默认源配置？', body: '将还原 35 个影视源（默认启用 21 个）+ 8 个目录参考项 + 9 个点播解析源 + 搜索预设 + 默认缓存时长', danger: true })) return;
    state.settings.cmsSources = DEFAULT_SETTINGS.cmsSources.map((s) => ({ ...s }));
    state.settings.jiexiSources = DEFAULT_SETTINGS.jiexiSources.map((s) => ({ ...s }));
    state.settings.proxies = [...DEFAULT_SETTINGS.proxies];
    state.settings.presets = DEFAULT_PRESETS.map((p) => ({ ...p }));
    state.settings.liveSources = DEFAULT_LIVE_SOURCES.map((l) => ({ ...l }));
    state.settings.cacheTime = DEFAULT_SETTINGS.cacheTime;
    saveSettings(); renderAll(); U.toast('已恢复默认', { type: 'ok' });
  };

  function editCms(s, isNew) {
    const m = U.modal(`<div class="modal-body">
      <div class="modal-title">${isNew ? '添加数据源' : '编辑数据源'}</div>
      <label class="field"><span>名称</span><input id="f-name" class="input" value="${esc(s.name)}"></label>
      <label class="field"><span>API 地址（maccms v10）</span><input id="f-api" class="input" value="${esc(s.api)}"></label>
      <label class="field"><span>请求超时（秒，3–20，留空用默认）</span><input id="f-timeout" class="input" type="number" min="3" max="20" placeholder="默认" value="${s.timeout ? Math.round(s.timeout / 1000) : ''}"></label>
      <label class="field row"><span>参与搜索聚合</span><input type="checkbox" class="switch" id="f-search" ${s.searchable !== false ? 'checked' : ''}></label>
      <div class="modal-ft"><button class="btn ghost" id="f-no">取消</button><button class="btn primary" id="f-ok">保存</button></div></div>`);
    m.el.querySelector('#f-no').onclick = m.close;
    m.el.querySelector('#f-ok').onclick = () => {
      s.name = m.el.querySelector('#f-name').value.trim() || '未命名';
      s.api = m.el.querySelector('#f-api').value.trim();
      s.searchable = m.el.querySelector('#f-search').checked;
      const tv = Number(m.el.querySelector('#f-timeout').value);
      s.timeout = Number.isFinite(tv) && tv >= 3 ? Math.round(Math.min(20, tv) * 1000) : undefined;
      if (!/^https?:\/\//.test(s.api)) return U.toast('API 地址必须以 http(s) 开头', { type: 'err' });
      if (isNew) state.settings.cmsSources.push(s);
      saveSettings(); reportHealth(s.id, false); m.close(); renderAll(); U.toast('已保存，即将生效', { type: 'ok' });
    };
  }
  function editJx(j, isNew) {
    const m = U.modal(`<div class="modal-body">
      <div class="modal-title">${isNew ? '添加解析源' : '编辑解析源'}</div>
      <label class="field"><span>名称</span><input id="f-name" class="input" value="${esc(j.name)}"></label>
      <label class="field"><span>解析模板（以 ?url= 结尾）</span><input id="f-url" class="input" value="${esc(j.url)}"></label>
      <div class="modal-ft"><button class="btn ghost" id="f-no">取消</button><button class="btn primary" id="f-ok">保存</button></div></div>`);
    m.el.querySelector('#f-no').onclick = m.close;
    m.el.querySelector('#f-ok').onclick = () => {
      j.name = m.el.querySelector('#f-name').value.trim() || '未命名';
      j.url = m.el.querySelector('#f-url').value.trim();
      if (!/^https?:\/\//.test(j.url)) return U.toast('模板必须以 http(s) 开头', { type: 'err' });
      if (isNew) state.settings.jiexiSources.push(j);
      saveSettings(); m.close(); renderAll();
    };
  }
  /* ---- M3U 订阅导入（ 直播订阅能力） ---- */
  const m3uPanel = view.querySelector('#m3u-panel');
  const m3uStatus = view.querySelector('#m3u-status');
  view.querySelector('#m3u-import').onclick = () => { m3uPanel.style.display = 'block'; view.querySelector('#m3u-url').focus(); };
  view.querySelector('#m3u-cancel').onclick = () => { m3uPanel.style.display = 'none'; }
  view.querySelector('#m3u-go').onclick = async () => {
    const subUrl = view.querySelector('#m3u-url').value.trim();
    if (!/^https?:\/\//i.test(subUrl)) return U.toast('请输入 http(s) 开头的订阅地址', { type: 'err' });
    m3uStatus.textContent = '正在通过服务端解析订阅…';
    try {
      const { fetchM3uChannels } = await import('../api/liveparser.js');
      const { channels, viaServer } = await fetchM3uChannels(subUrl);
      if (!channels.length) { m3uStatus.textContent = '订阅解析失败：无可用频道（可能地址失效或非 M3U 格式）'; return; }
      // 合并进 liveSources（按 URL 去重）
      const cur = state.settings.liveSources || [];
      const known = new Set(cur.map((l) => l.url));
      let added = 0;
      for (const ch of channels) {
        if (known.has(ch.url)) continue;
        cur.push({ id: ch.id || ('m3u-' + Math.random().toString(36).slice(2, 8)), name: ch.name, url: ch.url, group: ch.group || '', logo: ch.logo || '' });
        known.add(ch.url); added++;
      }
      state.settings.liveSources = cur;
      saveSettings(); renderAll();
      m3uStatus.textContent = `✅ 导入完成：新增 ${added} 个频道${viaServer ? '（服务端解析）' : '（客户端解析）'}，共 ${cur.length} 个直播源。`;
      m3uPanel.style.display = 'none';
      U.toast(`M3U 订阅导入成功 · 新增 ${added} 个频道`, { type: 'ok' });
    } catch (e) {
      m3uStatus.textContent = '导入失败：' + String(e?.message || e).slice(0, 120);
    }
  };
  renderAll();
});
