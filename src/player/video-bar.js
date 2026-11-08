/**
 * 知影录 · 视频进度条组件
 * 原生 JS，零依赖。直接操作 HTML5 <video> 元素。
 *
 * 引入：import { createVideoBar } from './video-bar.js';
 * 调用：createVideoBar(videoElement, '.container');
 */
// ======================== DOM 模板 ========================
const TEMPLATE = `
<div class="vb-wrap">
  <div class="vb-row">
    <button class="vb-btn vb-btn-play" title="播放/暂停">
      <svg class="vb-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
    </button>
    <span class="vb-time vb-time-cur">00:00</span>
    <div class="vb-track">
      <div class="vb-buffered"></div>
      <div class="vb-progress"></div>
      <div class="vb-thumb"></div>
      <div class="vb-hover-tip" hidden>00:00</div>
    </div>
    <span class="vb-time vb-time-total">00:00</span>
  </div>
</div>`;

// ======================== 样式 ========================
const STYLES = `
.vb-wrap{width:100%;background:rgba(0,0,0,.65);border-radius:0 0 var(--r-lg,16px) var(--r-lg,16px);user-select:none;-webkit-user-select:none;font-family:Inter,'Noto Sans SC',-apple-system,sans-serif}
.vb-row{display:flex;align-items:center;gap:6px;width:100%;height:34px;padding:0 8px;box-sizing:border-box}
.vb-btn{display:grid;place-items:center;width:30px;height:30px;flex-shrink:0;border:0;background:none;color:#c4b5fd;cursor:pointer;border-radius:8px;transition:all .15s}
.vb-btn:hover{background:rgba(139,92,246,.2);color:#ddd6fe}
.vb-btn:active{transform:scale(.9)}
.vb-icon{width:17px;height:17px}
.vb-time{font-size:11px;font-weight:500;color:#c4b5fd;font-variant-numeric:tabular-nums;min-width:40px;text-align:center;flex-shrink:0}
.vb-track{position:relative;flex:1;height:5px;background:rgba(255,255,255,.12);border-radius:99px;cursor:pointer}
.vb-track::before{content:'';position:absolute;inset:-10px -2px}
.vb-buffered{position:absolute;top:0;left:0;height:100%;background:rgba(196,181,253,.2);border-radius:99px;width:0%;pointer-events:none}
.vb-progress{position:absolute;top:0;left:0;height:100%;background:linear-gradient(90deg,#8b5cf6,#a78bfa);border-radius:99px;width:0%;pointer-events:none;box-shadow:0 0 8px rgba(139,92,246,.4)}
.vb-thumb{position:absolute;top:50%;left:0;width:14px;height:14px;margin-left:-7px;margin-top:-7px;border-radius:50%;background:#c4b5fd;border:2px solid #8b5cf6;box-shadow:0 0 12px rgba(139,92,246,.6);pointer-events:none;opacity:0;transition:opacity .15s ease,transform .12s ease;transform:scale(.7)}
.vb-track:hover .vb-thumb,.vb-track.dragging .vb-thumb{opacity:1;transform:scale(1)}
.vb-track:hover,.vb-track.dragging{height:7px}
.vb-hover-tip{position:absolute;bottom:calc(100% + 8px);padding:3px 8px;border-radius:6px;background:rgba(20,20,26,.92);border:1px solid rgba(139,92,246,.3);color:#c4b5fd;font-size:10px;font-weight:600;white-space:nowrap;pointer-events:none;transform:translateX(-50%)}
@media(max-width:480px){.vb-row{gap:3px;padding:0 4px;height:28px}.vb-btn{width:26px;height:26px}.vb-icon{width:15px;height:15px}.vb-time{font-size:10px;min-width:34px}.vb-track{height:4px}}
`;

// ======================== 工具 ========================
function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) return '00:00';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? p(h) + ':' + p(m) + ':' + p(s) : p(m) + ':' + p(s);
}
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// ======================== 主函数 ========================
/**
 * @param {HTMLVideoElement} video
 * @param {string|HTMLElement} container
 */
export function createVideoBar(video, container) {
  if (!video || video.tagName !== 'VIDEO') throw new Error('[VideoBar] 需要 <video> 元素');

  // 注入样式（全局一次）
  if (!document.getElementById('vb-styles')) {
    const s = document.createElement('style'); s.id = 'vb-styles'; s.textContent = STYLES;
    document.head.appendChild(s);
  }

  const host = typeof container === 'string' ? document.querySelector(container) : container;
  if (!host) throw new Error('[VideoBar] 容器不存在');

  const root = document.createElement('div'); root.innerHTML = TEMPLATE;
  host.appendChild(root);
  const wrap = root.firstElementChild;

  const $ = (sel) => wrap.querySelector(sel);
  const btnPlay    = $('.vb-btn-play');
  const timeCur    = $('.vb-time-cur');
  const timeTotal  = $('.vb-time-total');
  const track      = $('.vb-track');
  const bufferedEl = $('.vb-buffered');
  const progressEl = $('.vb-progress');
  const thumbEl    = $('.vb-thumb');
  const hoverTip   = $('.vb-hover-tip');

  // ---- 状态 ----
  let dragging = false, dragPct = 0;
  let seekTimer = null, lastSeekTarget = 0;

  // ==================== 核心：进度更新 ====================
  function setProgressUI(pct) {
    const s = (clamp(pct, 0, 1) * 100).toFixed(2) + '%';
    progressEl.style.width = s;
    thumbEl.style.left = s;
  }

  function updateBuffered() {
    try {
      const b = video.buffered;
      if (!b || !b.length) { bufferedEl.style.width = '0%'; return; }
      const end = b.end(b.length - 1);
      if (video.duration > 0) bufferedEl.style.width = (end / video.duration * 100).toFixed(2) + '%';
    } catch { bufferedEl.style.width = '0%'; }
  }

  /**
   * seek 去抖：连续拖拽时用 setTimeout 合并，只执行最后一次。
   * 为什么不用 rAF：rAF 每帧触发仍可能积压；用 60ms 延迟窗口更稳。
   */
  function seekTo(sec) {
    lastSeekTarget = sec;
    if (seekTimer) return;
    seekTimer = setTimeout(() => {
      seekTimer = null;
      try { video.currentTime = lastSeekTarget; } catch {}
    }, 60);
  }

  // ---- 视频事件 ----
  function onTimeUpdate() {
    if (dragging) return;
    const d = video.duration;
    if (!d) return;
    setProgressUI(video.currentTime / d);
    timeCur.textContent = fmtTime(video.currentTime);
  }
  function onDurationChange() {
    timeTotal.textContent = fmtTime(video.duration);
    updateBuffered();
  }
  video.addEventListener('timeupdate', onTimeUpdate);
  video.addEventListener('loadedmetadata', onDurationChange);
  video.addEventListener('durationchange', onDurationChange);
  video.addEventListener('progress', updateBuffered);

  // ---- 播放/暂停 ----
  function updatePlayIcon() {
    btnPlay.querySelector('.vb-icon').innerHTML = video.paused
      ? '<path d="M8 5v14l11-7z"/>'
      : '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
  }
  function togglePlay() { video.paused ? video.play().catch(() => {}) : video.pause(); }
  video.addEventListener('play', updatePlayIcon);
  video.addEventListener('pause', updatePlayIcon);
  btnPlay.addEventListener('click', togglePlay);

  // ---- 进度条交互：pointerdown 启动拖拽/点击 ----
  function getPct(e) {
    const r = track.getBoundingClientRect();
    return clamp((e.clientX - r.left) / r.width, 0, 1);
  }
  track.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true; track.classList.add('dragging');
    dragPct = getPct(e);
    setProgressUI(dragPct);
    timeCur.textContent = fmtTime(dragPct * video.duration);
    seekTo(dragPct * video.duration);
  });

  function onPtrMove(e) {
    if (!dragging) return;
    dragPct = getPct(e);
    setProgressUI(dragPct);
    timeCur.textContent = fmtTime(dragPct * video.duration);
    seekTo(dragPct * video.duration);
    hoverTip.hidden = false;
    hoverTip.textContent = fmtTime(dragPct * video.duration);
    hoverTip.style.left = (dragPct * 100).toFixed(1) + '%';
  }
  function onPtrUp() {
    if (!dragging) return;
    dragging = false;
    track.classList.remove('dragging');
    hoverTip.hidden = true;
  }
  document.addEventListener('pointermove', onPtrMove, { passive: true });
  document.addEventListener('pointerup', onPtrUp);
  document.addEventListener('pointercancel', onPtrUp);

  // ---- 悬浮提示（桌面端） ----
  if (matchMedia('(pointer:fine)').matches) {
    track.addEventListener('pointermove', (e) => {
      if (dragging) return;
      const pct = getPct(e);
      hoverTip.hidden = false;
      hoverTip.textContent = fmtTime(pct * video.duration);
      hoverTip.style.left = (pct * 100).toFixed(1) + '%';
    });
    track.addEventListener('pointerleave', () => { if (!dragging) hoverTip.hidden = true; });
  }

  // ---- 键盘 ← → ----
  function onKey(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const d = video.duration;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); seekTo(clamp(video.currentTime - 5, 0, d || 0)); }
    if (e.key === 'ArrowRight') { e.preventDefault(); seekTo(clamp(video.currentTime + 5, 0, d || Infinity)); }
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  }
  video.addEventListener('keydown', onKey);

  // ---- 初始同步 ----
  onDurationChange(); updatePlayIcon();

  // ---- 销毁 ----
  function destroy() {
    clearTimeout(seekTimer);
    video.removeEventListener('timeupdate', onTimeUpdate);
    video.removeEventListener('loadedmetadata', onDurationChange);
    video.removeEventListener('durationchange', onDurationChange);
    video.removeEventListener('progress', updateBuffered);
    video.removeEventListener('play', updatePlayIcon);
    video.removeEventListener('pause', updatePlayIcon);
    video.removeEventListener('keydown', onKey);
    document.removeEventListener('pointermove', onPtrMove);
    document.removeEventListener('pointerup', onPtrUp);
    document.removeEventListener('pointercancel', onPtrUp);
    root.remove();
  }

  return { root: wrap, destroy, togglePlay };
}

if (typeof window !== 'undefined') window.VideoBar = { createVideoBar };