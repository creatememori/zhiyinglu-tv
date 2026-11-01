import { onRoute } from '../core/router.js';
import { state, saveSettings } from '../core/state.js';
import { kvClearPrefix, kvDel, clearHistory, clearPosters, usage } from '../core/db.js';
import { U, svg, onAct } from '../ui/ui.js';
import { esc, fmtBytes, copyText } from '../core/utils.js';
import { detectRelay, resetRelayProbe } from '../api/adapters.js';
import { normalizeImportedSettings } from '../core/config.js';
import { DEFAULT_SETTINGS } from '../api/sources.js';
import { buildDataExport, applyDataImport } from '../core/data.js';
import {
  isLunaConfigFile, lunaSourcesToCms, lunaCategoriesToPresets, lunaLivesToSources,
  lunaCacheTimeToSec, toLunaConfigFile, b58Export, parseSubscriptionText
} from '../core/lunaconfig.js';

onRoute('settings', (view) => {
  const s = () => state.settings;
  const CACHE_TTL_OPTS = [[600, '10 分钟'], [1200, '20 分钟'], [1800, '30 分钟'], [3600, '1 小时'], [7200, '2 小时'], [14400, '4 小时']];
  const matchTtl = (v) => CACHE_TTL_OPTS.find(([x]) => x === v) ? v : 1800;

  view.innerHTML = `<div class="page slim">
    <div class="sec-head"><h2>${svg('gear', 'hot')} 设置</h2></div>
    <div class="set-card glass"><div class="set-t">外观主题</div>
      <div class="set-row"><span>主题色</span><div class="swatches">${[['aurora', '极光紫'], ['vercel', 'Vercel蓝'], ['sunset', '落日粉'], ['mint', '薄荷绿']].map(([k, n]) => `<button class="swatch ${s().accent === k ? 'on' : ''}" data-accentk="${k}" title="${n}"><i class="sw-${k}"></i></button>`).join('')}</div></div>
      <div class="set-row"><span>毛玻璃强度 <b class="num" id="glass-v">${s().glass}px</b></span><input type="range" min="0" max="40" value="${s().glass}" id="glass-r" class="range"></div>
      <div class="set-row"><span>全屏视觉特效（极光/网格/噪点）</span><label class="switch-inline"><input type="checkbox" class="switch" id="sw-fx" ${s().fx ? 'checked' : ''}></label></div>
    </div>
    <div class="set-card glass"><div class="set-t">播放</div>
      <div class="set-row"><span>自动播放</span><input type="checkbox" class="switch" id="sw-ap" ${s().autoplay ? 'checked' : ''}></div>
      <div class="set-row"><span>自动连播下一集（3s 可取消）</span><input type="checkbox" class="switch" id="sw-an" ${s().autonext ? 'checked' : ''}></div>
      <div class="set-row"><span>断点续播记忆</span><input type="checkbox" class="switch" id="sw-rs" ${s().resume ? 'checked' : ''}></div>
      <div class="set-row"><span>源健康自动巡检（4h）</span><input type="checkbox" class="switch" id="sw-scan" ${s().autoScan ? 'checked' : ''}></div>
      <div class="set-row"><span>片头片尾跳过</span><span class="muted">在播放页「跳片」按钮中按片设置</span></div>
    </div>
    <div class="set-card glass"><div class="set-t">网络与中继 <span class="muted">跨域请求的骨干通道</span></div>
      <div class="set-row" style="align-items:flex-end;gap:8px;flex-wrap:wrap">
        <label class="field" style="flex:1;min-width:220px"><span>中继基址（自建 Worker，可留空）</span>
          <input id="relay-base" class="input" placeholder="https://your-name.workers.dev" value="${esc(s().relayBase || '')}"></label>
        <button class="btn xs primary" id="relay-check">${svg('radar')} 检测中继</button>
      </div>
      <div class="src-tips">留空 = 使用同域 /api/proxy（Cloudflare Pages 自带 Functions，推荐）。填写自建 Worker 后，所有取数与图片反代都走该基址；需其 SOURCE_HOSTS / IMG_HOSTS 白名单放行对应域名（本包 worker 响应自带跨域许可）。修改后刷新页面生效。</div>
    </div>
    <div class="set-card glass"><div class="set-t">搜索与缓存 <span class="muted">搜索命中线路缓存 · 对应配置的搜索缓存</span></div>
      <div class="set-row"><span>搜索缓存时长</span><select class="input" id="cache-sel" style="width:auto">${CACHE_TTL_OPTS.map(([v, n]) => `<option value="${v}" ${matchTtl(s().cacheTime) === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="set-t" style="margin-top:14px">搜索预设分类 <span class="muted">搜索页快捷 chips · 快捷分类</span></div>
      <div id="preset-list"></div>
      <div class="set-row" style="align-items:flex-end;gap:8px;flex-wrap:wrap">
        <label class="field" style="flex:1;min-width:120px"><span>名称</span><input id="p-name" class="input" placeholder="如：悬疑"></label>
        <label class="field" style="flex:none"><span>类型</span><select id="p-type" class="input" style="width:auto"><option value="movie">电影</option><option value="tv">电视剧</option></select></label>
        <label class="field" style="flex:1;min-width:120px"><span>关键词</span><input id="p-query" class="input" placeholder="搜索词"></label>
        <button class="btn xs primary" id="p-add" style="margin-bottom:2px">${svg('plus')} 添加</button>
      </div>
    </div>
    <div class="set-card glass"><div class="set-t">本地存储 <span class="muted">全部落盘你的浏览器</span></div>
      <div class="set-row"><span>已用空间</span><span class="muted" id="usage">计算中…</span></div>
      <div class="row-btns"><button class="btn xs ghost" data-act="clearcache">${svg('refresh')} 清理接口缓存</button>
        <button class="btn xs ghost" data-act="clearposter">清理海报缓存</button>
        <button class="btn xs danger ghost" data-act="clearhist">清空观看历史</button></div>
    </div>
    <div class="set-card glass"><div class="set-t">数据迁移 <span class="muted">导出/导入 · 配置迁移</span></div>
      <div class="row-btns"><button class="btn xs ghost" data-act="export">${svg('download')} 导出配置</button>
        <button class="btn xs ghost" data-act="import">${svg('upload')} 导入配置</button>
        <button class="btn xs primary" data-act="exportdata">${svg('download')} 导出全部数据</button>
        <button class="btn xs primary" data-act="importdata">${svg('upload')} 导入全部数据</button></div>
      <div class="row-btns" style="margin-top:10px"><button class="btn xs ghost" data-act="lunaout">${svg('external')} 导出源配置</button>
        <button class="btn xs ghost" data-act="lunain">${svg('upload')} 导入源配置</button>
        <button class="btn xs ghost" data-act="lunasub">${svg('link')} 订阅链接导入</button>
        <button class="btn xs danger ghost" data-act="reset">重置全部</button></div>
      <div class="src-tips" style="margin-top:10px">「全部数据」= 设置+源+历史+进度+跳片配置，可转移设备。配置支持 api_site / custom_category / cache_time / lives（直播源导入后可在「数据源 → 直播源」直接播放）。订阅链接为 base58 编码的配置文本。</div>
    </div>
    <div class="about glass"><h3>知影录•Tv</h3>
      <p class="muted">纯前端聚合应用 · ArtPlayer 5 + hls.js · IndexedDB 本地存储<br>
      本应用不存储、不上传任何视频内容，仅聚合第三方公开接口。<br>
      请遵守目标接口服务条款与当地法律法规，仅限授权测试与学习场景使用。</p></div>
  </div>`;

  const bind = (sel, key) => { view.querySelector(sel).onchange = (e) => { state.settings[key] = e.target.checked; saveSettings(); }; };
  bind('#sw-ap', 'autoplay'); bind('#sw-an', 'autonext'); bind('#sw-rs', 'resume'); bind('#sw-scan', 'autoScan'); bind('#sw-fx', 'fx');
  /* 中继基址：修改后重置探测缓存；点击检测即时反馈连通性 */
  const relayInput = view.querySelector('#relay-base');
  relayInput.onchange = () => {
    state.settings.relayBase = relayInput.value.trim().slice(0, 300);
    saveSettings(); resetRelayProbe();
    U.toast('中继基址已保存，刷新页面后生效', { type: 'ok' });
  };
  view.querySelector('#relay-check').onclick = async (ev) => {
    const b = ev.currentTarget;
    b.disabled = true; const original = b.innerHTML; b.textContent = '探测中…';
    const ok = await detectRelay();
    b.disabled = false; b.innerHTML = original;
    U.toast(ok ? '中继可用：取数与图片反代链路已激活' : `未检测到中继（${state.settings.relayBase ? '自定义基址不可达或未返回有效标识' : '同域 /api/health 不可用'}），请核对部署与白名单。`, { type: ok ? 'ok' : 'err' });
  };
  view.querySelector('#cache-sel').onchange = (e) => { state.settings.cacheTime = +e.target.value; saveSettings(); U.toast('缓存时长已保存', { type: 'ok' }); };
  view.querySelectorAll('[data-accentk]').forEach((b) => b.onclick = () => { state.settings.accent = b.dataset.accentk; saveSettings(); view.querySelectorAll('[data-accentk]').forEach((x) => x.classList.toggle('on', x === b)); });
  view.querySelector('#glass-r').oninput = (e) => { state.settings.glass = +e.target.value; view.querySelector('#glass-v').textContent = e.target.value + 'px'; saveSettings(); };
  usage().then((u) => { view.querySelector('#usage').textContent = fmtBytes(u.usage) + ' / ' + fmtBytes(u.quota || 0); });

  /* ---------- 搜索预设管理 ---------- */
  const renderPresets = () => {
    const list = state.settings.presets || [];
    view.querySelector('#preset-list').innerHTML = list.length
      ? list.map((p, i) => `<div class="src-line" style="padding:6px 2px;border-bottom:1px solid rgba(255,255,255,.06)">
          <span class="badge">${p.type === 'movie' ? '电影' : '剧集'}</span><b>${esc(p.name)}</b><span class="muted" style="flex:1;overflow:hidden;text-overflow:ellipsis">“${esc(p.query)}”</span>
          <button class="btn xs danger ghost" data-act="preset-del" data-i="${i}">${svg('trash')}</button></div>`).join('')
      : '<div class="muted" style="padding:6px 0">暂无预设，搜索页将展示默认热门词</div>';
  };
  renderPresets();
  view.querySelector('#p-add').onclick = () => {
    const name = view.querySelector('#p-name').value.trim();
    const query = view.querySelector('#p-query').value.trim();
    const type = view.querySelector('#p-type').value;
    if (!query) return U.toast('请填写预设关键词', { type: 'err' });
    const presets = state.settings.presets || (state.settings.presets = []);
    if (presets.length >= 30) return U.toast('预设最多 30 个', { type: 'err' });
    if (presets.some((p) => p.type === type && p.query === query)) return U.toast('该类型+关键词已存在', { type: 'err' });
    presets.push({ id: 'p' + Math.random().toString(36).slice(2, 8), name: (name || query).slice(0, 60), type, query: query.slice(0, 40) });
    saveSettings(); renderPresets();
    view.querySelector('#p-name').value = ''; view.querySelector('#p-query').value = '';
  };

  onAct('clearcache', async () => { await kvClearPrefix('CH:'); U.toast('接口缓存已清理', { type: 'ok' }); });
  onAct('clearposter', async () => { await clearPosters(); U.toast('海报缓存已清理', { type: 'ok' }); });
  onAct('clearhist', async () => { if (await U.confirmDlg({ title: '清空观看历史？', danger: true })) { await clearHistory(); U.toast('已清空', { type: 'ok' }); } });
  onAct('preset-del', (b) => {
    const i = +b.dataset.i;
    state.settings.presets.splice(i, 1);
    saveSettings(); renderPresets();
  });

  const download = (data, name) => {
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  };
  const pickJsonFile = (onText) => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,text/plain,application/json';
    inp.onchange = () => { const f = inp.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => onText(String(rd.result || '')); rd.readAsText(f); };
    inp.click();
  };

  onAct('export', () => download(JSON.stringify(state.settings, null, 2), 'zhiyinglu-config.json'));
  onAct('import', () => {
    pickJsonFile((text) => {
      try {
        const imported = normalizeImportedSettings(JSON.parse(text), state.settings, DEFAULT_SETTINGS);
        Object.assign(state.settings, imported); saveSettings();
        U.toast('配置校验通过，导入成功，正在刷新…', { type: 'ok' }); setTimeout(() => location.reload(), 800);
      } catch (e) { U.toast(`导入失败：${e?.message || '配置文件解析失败'}`, { type: 'err' }); }
    });
  });

  /* ---------- 全量数据迁移 ---------- */
  onAct('exportdata', async () => {
    try {
      const data = await buildDataExport();
      download(JSON.stringify(data, null, 2), 'zhiyinglu-data-' + new Date().toISOString().slice(0, 10) + '.json');
      U.toast('已导出全部本地数据', { type: 'ok' });
    } catch (e) { U.toast('导出失败：' + (e?.message || '未知错误'), { type: 'err' }); }
  });
  onAct('importdata', () => {
    pickJsonFile(async (text) => {
      try {
        const info = await applyDataImport(JSON.parse(text));
        U.toast(`导入成功：历史 ${info.history} 条 · 进度 ${info.progress} · 跳片 ${info.skips}，正在刷新…`, { type: 'ok' });
        setTimeout(() => location.reload(), 900);
      } catch (e) { U.toast('数据导入失败：' + (e?.message || '无法解析'), { type: 'err' }); }
    });
  });

  /* ---------- 配置互导 ---------- */
  onAct('lunaout', () => {
    const file = toLunaConfigFile(state.settings);
    const json = JSON.stringify(file, null, 2);
    const b58 = b58Export(state.settings);
    const m = U.modal(`<div class="modal-body">
      <div class="modal-title">${svg('external')} 兼容配置导出</div>
      <p class="muted" style="font-size:12px">JSON 格式配置文件；base58 串可作为订阅链接内容。仅导出源/预设/直播槽位与缓存时长，不包含播放历史。</p>
      <label class="field"><span>JSON（可粘贴到配置管理）</span><textarea id="luna-json" class="input" rows="6" readonly>${esc(json)}</textarea></label>
      <label class="field"><span>Base58 订阅正文</span><textarea id="luna-b58" class="input" rows="2" readonly>${esc(b58)}</textarea></label>
      <div class="modal-ft"><button class="btn ghost" data-copy="json">${svg('copy')} 复制 JSON</button><button class="btn ghost" data-copy="b58">${svg('copy')} 复制订阅</button><button class="btn primary" id="luna-dl">${svg('download')} 下载 .json</button><button class="btn ghost" id="luna-close">关闭</button></div></div>`, { full: false, pin: true });
    m.el.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => { copyText(m.el.querySelector(b.dataset.copy === 'json' ? '#luna-json' : '#luna-b58').value); U.toast('已复制', { type: 'ok' }); });
    m.el.querySelector('#luna-dl').onclick = () => { download(json, 'config-backup.json'); m.close(); };
    m.el.querySelector('#luna-close').onclick = m.close;
  });

  const mergeLunaConfig = (cfg, srcLabel) => {
    if (!isLunaConfigFile(cfg)) throw new Error('不是有效的配置文件（缺少 api_site 结构）');
    const cur = state.settings;
    const sources = lunaSourcesToCms(cfg.api_site, new Set(cur.cmsSources.map((x) => x.id)));
    const presets = lunaCategoriesToPresets(cfg.custom_category, new Set(cur.presets.map((p) => p.type + ':' + p.query)));
    const lives = lunaLivesToSources(cfg.lives, new Set(cur.liveSources.map((x) => x.id)));
    const cacheTime = lunaCacheTimeToSec(cfg.cache_time);
    cur.cmsSources = cur.cmsSources.concat(sources);
    cur.presets = cur.presets.concat(presets).slice(0, 30);
    cur.liveSources = cur.liveSources.concat(lives).slice(0, 200);
    cur.cacheTime = cacheTime;
    cur.sourceCatalogVersion = 3;
    if (!sources.length && !presets.length && !lives.length) throw new Error('配置中没有可用的影视源/预设/直播源');
    saveSettings();
    return { sources: sources.length, presets: presets.length, lives: lives.length, cacheTime };
  };

  const lunaImportModal = (withUrl) => {
    const m = U.modal(`<div class="modal-body">
      <div class="modal-title">${svg('upload')} 导入源配置${withUrl ? '（订阅）' : ''}</div>
      <p class="muted" style="font-size:12px">${withUrl ? '粘贴订阅链接：应用会尝试直接获取并解码 base58/JSON 内容；跨域失败时请改用手动文本。' : '粘贴配置 JSON 或 base58 订阅正文，或选择本机 .json 文件。'}</p>
      ${withUrl ? `<label class="field"><span>订阅链接 URL</span><div class="row-btns" style="gap:8px"><input id="luna-url" class="input" placeholder="https://example.com/config"><button class="btn xs primary" id="luna-fetch">${svg('link')} 获取</button></div></label>` : ''}
      <label class="field"><span>配置文本</span><textarea id="luna-text" class="input" rows="6" placeholder='{"api_site": {...}, "custom_category": [...], "cache_time": 7200}'></textarea></label>
      <div class="modal-ft"><button class="btn ghost" id="luna-file">${svg('upload')} 选择文件</button><button class="btn ghost" id="luna-no">取消</button><button class="btn primary" id="luna-ok">${svg('check')} 解析并导入</button></div></div>`, { full: false, pin: true });
    const ta = m.el.querySelector('#luna-text');
    const done = (cfg, label) => {
      try {
        const r = mergeLunaConfig(cfg, label);
        m.close();
        U.toast(`已导入 ${label}：${r.sources} 个影视源 · ${r.presets} 个预设 · ${r.lives} 个直播槽位 · 缓存 ${Math.round(r.cacheTime / 60)} 分钟`, { type: 'ok', timeout: 4000 });
      } catch (e) { U.toast('导入失败：' + (e?.message || '格式无法识别'), { type: 'err' }); }
    };
    m.el.querySelector('#luna-file').onclick = () => pickJsonFile((text) => done(parseSubscriptionText(text), "配置文件"));
    m.el.querySelector('#luna-ok').onclick = () => { try { done(parseSubscriptionText(ta.value), "配置文件"); } catch (e) { U.toast(e?.message || '解析失败', { type: 'err' }); } };
    m.el.querySelector('#luna-no').onclick = m.close;
    if (withUrl) {
      m.el.querySelector('#luna-fetch').onclick = async () => {
        const url = m.el.querySelector('#luna-url').value.trim();
        if (!/^https?:/.test(url)) return U.toast('请输入 http(s) 订阅链接', { type: 'err' });
        U.toast('正在获取订阅…');
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          done(parseSubscriptionText(await res.text()), '订阅');
        } catch (e) {
          U.toast('订阅获取失败（可能是跨域限制）：' + (e?.message || '网络错误') + '。请找可直连的链接，或复制订阅文本手动粘贴。', { type: 'err', timeout: 5000 });
        }
      };
    }
  };
  onAct('lunain', () => lunaImportModal(false));
  onAct('lunasub', () => lunaImportModal(true));

  onAct('reset', async () => {
    if (await U.confirmDlg({ title: '重置全部数据？', body: '设置 / 源 / 历史 / 进度全部清空', danger: true })) { await kvDel('settings'); location.reload(); }
  });
});