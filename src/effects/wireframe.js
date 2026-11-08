/**
 * 知影录 · 终末地风格 3D 黑白线框引擎
 *
 * Arknights: Endfield 视觉风格（黑白几何线框）
 * 实现：纯 Canvas 2D 透视投影，零依赖（比 three.js 小 ~600KB）
 *
 * 几何体：二十面体（icosahedron）+ 轨道环 + 顶点光点
 * 运动：自转 + 鼠标视差 + 呼吸缩放
 */

const PHI = (1 + Math.sqrt(5)) / 2;

// 二十面体 12 顶点
const VERTS = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
].map(([x, y, z]) => {
  const l = Math.sqrt(x * x + y * y + z * z);
  return [x / l, y / l, z / l];
});

// 三十条边：归一化后相邻顶点距离² = 4/(1+PHI²) ≈ 1.1056
const EDGES = [];
for (let i = 0; i < 12; i++) {
  for (let j = i + 1; j < 12; j++) {
    const dx = VERTS[i][0] - VERTS[j][0];
    const dy = VERTS[i][1] - VERTS[j][1];
    const dz = VERTS[i][2] - VERTS[j][2];
    if (Math.abs(dx * dx + dy * dy + dz * dz - 1.1056) < 0.02) {
      EDGES.push([i, j]);
    }
  }
}

// 轨道环（XZ 平面圆）
const RING_N = 48;
const RING_R = 1.45;

let raf = null;

/**
 * 在指定容器创建线框场景
 * @param {HTMLElement} host 容器
 * @param {object} opts { size, dark, interactive }
 */
export function createWireframe(host, { size = 320, dark = false, interactive = true } = {}) {
  const canvas = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  Object.assign(canvas.style, { width: size + 'px', height: size + 'px', pointerEvents: 'none' });
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const LINE = dark ? 'rgba(255,255,255,.55)' : 'rgba(15,23,42,.5)';
  const LINE_FAR = dark ? 'rgba(255,255,255,.18)' : 'rgba(15,23,42,.14)';
  const DOT = dark ? '#fff' : '#0f172a';
  const ACCENT = '#8b5cf6';

  let rotX = 0.4, rotY = 0, t = 0;
  let targetTiltX = 0, targetTiltY = 0, tiltX = 0, tiltY = 0;
  let alive = true;

  if (interactive) {
    window.addEventListener('mousemove', (e) => {
      targetTiltY = (e.clientX / window.innerWidth - 0.5) * 0.5;
      targetTiltX = (e.clientY / window.innerHeight - 0.5) * 0.35;
    }, { passive: true });
  }

  function project([x, y, z], scale) {
    // 透视投影
    const fov = 3.2;
    const z2 = z + fov;
    const s = scale * fov / z2;
    return [size / 2 + x * s, size / 2 + y * s, z];
  }

  function rot([x, y, z], ax, ay) {
    // 绕 Y 轴
    const cx = Math.cos(ay), sx = Math.sin(ay);
    let nx = x * cx + z * sx, nz = -x * sx + z * cx;
    // 绕 X 轴
    const cy = Math.cos(ax), sy = Math.sin(ax);
    let ny = y * cy - nz * sy;
    nz = y * sy + nz * cy;
    return [nx, ny, nz];
  }

  function frame() {
    if (!alive || !canvas.isConnected) return;
    t += 0.008;
    rotY = t * 0.9;
    tiltX += (targetTiltX - tiltX) * 0.06;
    tiltY += (targetTiltY - tiltY) * 0.06;
    const breathe = 1 + Math.sin(t * 1.6) * 0.04;
    const scale = size * 0.26 * breathe;

    ctx.clearRect(0, 0, size, size);

    // 轨道环
    ctx.strokeStyle = LINE_FAR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= RING_N; i++) {
      const a = (i / RING_N) * Math.PI * 2;
      const p = project(rot([Math.cos(a) * RING_R, 0, Math.sin(a) * RING_R], rotX * 0.6 + tiltX, rotY + tiltY), scale);
      if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke();

    // 二十面体边
    const pts = VERTS.map((v) => project(rot(v, rotX + tiltX, rotY + tiltY), scale));
    for (const [a, b] of EDGES) {
      const za = (pts[a][2] + pts[b][2]) / 2;
      ctx.strokeStyle = za > 0 ? LINE : LINE_FAR;
      ctx.lineWidth = za > 0 ? 1.4 : 0.8;
      ctx.beginPath();
      ctx.moveTo(pts[a][0], pts[a][1]);
      ctx.lineTo(pts[b][0], pts[b][1]);
      ctx.stroke();
    }

    // 顶点光点
    for (const p of pts) {
      const r = p[2] > 0 ? 2.4 : 1.2;
      ctx.fillStyle = p[2] > 0 ? DOT : LINE_FAR;
      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 环上巡航的紫色光点（终末地式点缀）
    const orbA = t * 1.8;
    const orb = project(rot([Math.cos(orbA) * RING_R, 0, Math.sin(orbA) * RING_R], rotX * 0.6 + tiltX, rotY + tiltY), scale);
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 10;
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.arc(orb[0], orb[1], 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    raf = requestAnimationFrame(frame);
  }
  frame();

  return () => { alive = false; cancelAnimationFrame(raf); canvas.remove(); };
}
