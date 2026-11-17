# Vue Bits feedback layer

Reference: <https://vue-bits.dev/get-started/index> · source: <https://github.com/DavidHDev/vue-bits>

This project is a vanilla ES module SPA, so the Vue components were **ported as DOM/CSS
patterns**, not shipped with the Vue runtime.

| Vue Bits source | Local implementation | Notes |
| --- | --- | --- |
| `Animations/ClickSpark` | `src/effects/feedback.js` → `burst()` + `.fb-spark-canvas` | 8–11 radial sparks, 360–500 ms, DPR ≤ 2, one shared canvas |
| `Micro/HoldButton` | `pointerdown/up` state + `.fb-hold-ring` | 360 ms charge start, 540 ms fill, burst + `navigator.vibrate` at 900 ms |
| `Micro/LatticeLoader` | `.fb-load` 3×3 orbit grid | parse-iframe `src` mutation shows it; `load` hides after 280 ms |
| `Micro/PulseHeart` / buttons | press/release `scale` via `.fb-press` / `.fb-releasing` | uses the independent `scale` property so it never overwrites card tilt transforms |

## Behaviour

- Click spark only fires for taps that move < 8 px, so scrolling/swiping does not spark.
- Long press is cancelled by > 12 px movement or pointer cancel; it suppresses the
  synthetic click so a hold does not accidentally navigate.
- `prefers-reduced-motion` and the site's `body.no-fx` setting disable sparks, the
  charge ring and loader animation.
- Loading is real: it is triggered by `iframe.parse-frame` `src` changes and cleared on
  `load`/`error`/15 s timeout, not a decorative fake delay.

## Files

- `src/styles/feedback.css`
- `src/effects/feedback.js`
- imported by `src/main.js` after `cinema.css`.