/* Bottom dock — official @colineapp/liquid-glass tabs.
 *
 * The dock itself is fixed. What moves is the segmented-control thumb: it
 * lifts out of the selected tab, turns into a lens that bends the labels and
 * the page behind it, stretches toward the pointer, and refills as it lands
 * on the next tab. That is the iOS-style liquid-glass segmented control shipped by
 * the package, not a draggable navigation bar.
 */
import { attachLiquidGlassTabs } from '@colineapp/liquid-glass';

let tabs = null;
let dockEl = null;
let started = false;

const canUseDom = typeof window !== 'undefined' && typeof document !== 'undefined';
/** The package's lens is measured for a control sitting still. While the thumb
 *  is being pulled across a tab row we want the page visibly bending through it,
 *  so amplify only the thumb's displacement map. */
const THUMB_REFRACT_GAIN = 4.5;
const reduceQ = canUseDom
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false, addEventListener() {} };
const isLowPowerDevice = () =>
  !canUseDom ||
  (navigator.deviceMemory || 8) <= 2 ||
  (navigator.hardwareConcurrency || 8) <= 2;
const effectsDisabled = () => !canUseDom || document.body.classList.contains('no-fx') || reduceQ.matches;

function routeHref() {
  const raw = location.hash.replace(/^#\/?/, '').split('/')[0].split('?')[0];
  const seg = raw || 'home';
  return seg === 'home' ? '#/' : '#/' + seg;
}

/** The thumb's rim is intentionally gentle at rest; make the moving lens read
 *  as actual refraction by scaling its displacement map. The filter is rebuilt
 *  by the package when the thumb resizes, so re-apply after every update. */
let boostTimer = 0;
let watching = false;

/** The package re-measures and rewrites `scale` on the thumb's displacement
 *  maps while the thumb is lifted. Wrap the attribute write once so every
 *  re-measure keeps our gain instead of flickering back to the resting value. */
function patchScaleNode(node) {
  if (node.__cineScalePatched) return;
  const original = node.setAttribute.bind(node);
  node.__cineScalePatched = true;
  node.__origSetScale = original;
  node.setAttribute = function setAttribute(name, value) {
    if (name === 'scale') {
      const base = Number(value);
      if (Number.isFinite(base) && base > 0) {
        node.dataset.baseScale = String(value);
        return original('scale', (base * THUMB_REFRACT_GAIN).toFixed(3));
      }
    }
    return original(name, value);
  };
}

function boostThumbRefraction() {
  if (!canUseDom || !dockEl || effectsDisabled() || isLowPowerDevice()) return;
  const layer = dockEl.querySelector(
    '.liquid-glass-tabs-thumb .liquid-glass-layer[data-layer="refract"]'
  );
  const id = layer?.style.backdropFilter?.match(/#([\w-]+)/)?.[1];
  const filter = id && document.getElementById(id);
  if (!filter) return;
  filter.querySelectorAll('feDisplacementMap').forEach((node) => {
    patchScaleNode(node);
    if (!node.dataset.baseScale) {
      node.dataset.baseScale = node.getAttribute('scale') || '0';
    }
    const base = Number(node.dataset.baseScale);
    if (base > 0) {
      const value = (base * THUMB_REFRACT_GAIN).toFixed(3);
      if (node.__origSetScale) node.__origSetScale('scale', value);
      else node.setAttribute('scale', value);
    }
  });
}

function scheduleBoost() {
  if (!canUseDom) return;
  requestAnimationFrame(() => {
    boostThumbRefraction();
    // Some builds finish the lens filter one frame after the thumb moves.
    setTimeout(boostThumbRefraction, 70);
  });
}

/** The package resets the lens to its gentle resting geometry when the thumb
 *  is pressed and re-measured. Keep the boost applied for the whole gesture,
 *  including the settle after release. */
function startBoostLoop() {
  if (!canUseDom) return;
  boostThumbRefraction();
  if (boostTimer) return;
  boostTimer = window.setInterval(boostThumbRefraction, 48);
}

function stopBoostLoop() {
  if (!canUseDom) return;
  if (boostTimer) {
    clearInterval(boostTimer);
    boostTimer = 0;
  }
  [0, 90, 200, 380].forEach((ms) => setTimeout(boostThumbRefraction, ms));
}

function watchThumb() {
  if (watching || !dockEl) return;
  const thumb = dockEl.querySelector('.liquid-glass-tabs-thumb');
  if (!thumb) return;
  watching = true;
  const obs = new MutationObserver(() => {
    if (thumb.hasAttribute('data-raised')) startBoostLoop();
    else stopBoostLoop();
  });
  obs.observe(thumb, { attributes: true, attributeFilter: ['data-raised', 'data-shown'] });
  dockEl.addEventListener('pointerdown', startBoostLoop, true);
  window.addEventListener('pointerup', stopBoostLoop, true);
  window.addEventListener('pointercancel', stopBoostLoop, true);
}

/** Put selection on one tab immediately, before the hashchange paints it. */
function selectTab(tab) {
  if (!dockEl) return;
  dockEl.querySelectorAll('.dock-a[role="tab"]').forEach((a) => {
    const on = a === tab;
    a.classList.toggle('on', on);
    a.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const href = tab.dataset.href;
  if (href && location.hash !== href) location.hash = href;
  tabs?.update();
  scheduleBoost();
}

/** Reconcile aria-selected/class after a route change. */
function syncAria() {
  if (!dockEl) return;
  const href = routeHref();
  dockEl.querySelectorAll('.dock-a[role="tab"]').forEach((a) => {
    const on = a.dataset.href === href;
    a.classList.toggle('on', on);
    a.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  tabs?.update();
  scheduleBoost();
}

export function refreshDockTabs() {
  syncAria();
}

export function initDock() {
  if (started) return tabs;
  const dock = document.querySelector('.dock');
  if (!dock) return null;
  started = true;
  dockEl = dock;
  dock.setAttribute('role', 'tablist');

  const tabsEls = dock.querySelectorAll('.dock-a');
  tabsEls.forEach((a) => {
    a.setAttribute('role', 'tab');
    a.setAttribute('aria-selected', a.classList.contains('on') ? 'true' : 'false');
  });

  // The package prewarms 21 lens radii (8..28px) on requestIdleCallback with a
  // 2–4s timeout. Each radius rasterizes seven slice atlases via canvas
  // toDataURL; on a phone that is seconds of main-thread work for radii this
  // fixed-height dock never uses. Suppress only those long-timeout idle jobs
  // while the tabs mount; the thumb's actual radius is still built eagerly by
  // createLiquidGlass, and any unusual radius is built on demand.
  const nativeIdle = window.requestIdleCallback;
  if (typeof nativeIdle === 'function') {
    window.requestIdleCallback = (cb, opts = {}) => {
      if ((opts.timeout || 0) >= 2000) return 0;
      return nativeIdle.call(window, cb, opts);
    };
  }

  
  try {
    tabs = attachLiquidGlassTabs(dock, {
      appearance: 'dark',
      orientation: 'horizontal',
      tabs: '.dock-a',
      isSelected: (el) => el.classList.contains('on'),
      onSelect: selectTab,
      refraction: !isLowPowerDevice() && !effectsDisabled(),
      // The track is glass of its own; the thumb is the package's lens.
      glass: {
        level: 0.38,
        // Mobile keeps the full refraction and only drops rim AA samples; the
        // desktop track keeps the crisp 4-sample rim.
        samples: isLowPowerDevice() || innerWidth < 680 ? 1 : 4,
        hue: '#c084fc',
        hueStrength: 0.3,
      },
    });
  } catch (err) {
    dock.classList.add('dock--fallback');
    console.warn('[dock] liquid-glass tabs unavailable:', err);
  } finally {
    if (typeof nativeIdle === 'function') window.requestIdleCallback = nativeIdle;
  }

  syncAria();
  scheduleBoost();
  watchThumb();
  setTimeout(watchThumb, 250);
  window.addEventListener('hashchange', syncAria);
  window.addEventListener('resize', scheduleBoost, { passive: true });
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      tabs?.update();
      scheduleBoost();
    });
  }

  return tabs;
}