// Display helpers (SPEC §7.5.3): the monitor's refresh rate, the optional frame-rate cap and the
// "Recommended" resolution hint of Settings. Pure functions plus one small rAF-based meter, so
// the numbers are unit-tested without a browser.
//
// The game loop is requestAnimationFrame-driven, so it already runs at the display's refresh
// rate (there is no built-in 60 fps limit); what needs the rate is dynamic resolution, which
// aims at 97 % of it (post.js createDynRes(maxScale, targetFps)) instead of a fixed 58-60.

/** Refresh rates monitors actually have; a measurement snaps to the nearest one. */
export const REFRESH_RATES = Object.freeze([60, 75, 90, 100, 120, 144, 165, 240, 360]);

/** Dynamic resolution aims at this share of the refresh rate (v-sync keeps the frame time on the grid). */
export const DYNRES_TARGET_SHARE = 0.97;

/**
 * Snap a measured frame rate to a real refresh rate: the nearest of REFRESH_RATES by ratio.
 * Anything under 50 (a throttled tab, a slow machine measured while busy) reads as 60.
 * @param {number} hz measured frames per second
 * @returns {number}
 */
export function snapRefresh(hz) {
  if (!Number.isFinite(hz) || hz < 50) return 60;
  let best = REFRESH_RATES[0], bd = Infinity;
  for (const r of REFRESH_RATES) {
    const d = Math.abs(Math.log(hz / r));
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}

/** Median of a list of numbers (NaN for an empty list). */
export function median(list) {
  if (!list.length) return NaN;
  const a = [...list].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * Refresh rate from requestAnimationFrame intervals (ms): the first few are dropped (start-up
 * frames are long), the rest are cut at 2.5x the median (a hitch, a tab switch) and the median
 * of what is left snaps to a real rate. Null when there are too few samples to say.
 * @param {number[]} intervalsMs
 * @returns {number|null}
 */
export function estimateRefreshHz(intervalsMs) {
  const xs = intervalsMs.filter((v) => Number.isFinite(v) && v > 0.5).slice(3);
  if (xs.length < 12) return null;
  const m0 = median(xs);
  const kept = xs.filter((v) => v <= m0 * 2.5);
  if (kept.length < 10) return null;
  return snapRefresh(1000 / median(kept));
}

/**
 * Measure the refresh rate with requestAnimationFrame. Call while nothing heavy is running (the
 * title screen); a measurement made under load can only come out low, so callers keep the
 * highest result seen.
 * @param {{ raf?: Function, now?: Function, frames?: number, onDone: (hz: number|null) => void }} o
 * @returns {{ stop(): void }}
 */
export function measureRefresh(o) {
  const raf = o.raf || ((f) => requestAnimationFrame(f));
  const frames = o.frames || 90;
  const iv = [];
  let last = 0, stopped = false;
  const step = (t) => {
    if (stopped) return;
    if (last) iv.push(t - last);
    last = t;
    if (iv.length >= frames) { stopped = true; o.onDone(estimateRefreshHz(iv)); return; }
    raf(step);
  };
  raf(step);
  return { stop() { stopped = true; } };
}

/**
 * Target frame rate of dynamic resolution for a display: 97 % of its refresh rate (58.2 fps on
 * 60 Hz, 139.7 on 144 Hz).
 */
export function dynResTarget(refreshHz) {
  const hz = Number.isFinite(refreshHz) && refreshHz >= 30 ? refreshHz : 60;
  return hz * DYNRES_TARGET_SHARE;
}

/**
 * Frame-rate limiter for the rAF loop: `allow(t, cap, refreshHz)` says whether a frame may run
 * at time `t` (ms). With a cap it lets one frame in every 1/cap seconds through, judging with
 * half a display frame of slack so a 60 cap on a 144 Hz screen averages 60, not 48 or 72.
 * cap 0 / 'off' / undefined = unlimited.
 */
export function createFrameLimiter() {
  let due = 0;
  return {
    reset() { due = 0; },
    allow(t, cap, refreshHz) {
      const c = Number(cap);
      if (!(c > 0)) { due = 0; return true; }
      const period = 1000 / c;
      const half = 500 / (Number.isFinite(refreshHz) && refreshHz > 0 ? refreshHz : 60);
      if (!due) { due = t + period; return true; }
      if (t + half < due) return false;
      due += period;
      if (due < t - period) due = t + period;      // fell far behind (a hidden tab): start over
      return true;
    },
  };
}

/**
 * The "Recommended:" hint next to Resolution.
 * @param {{ gpuTier?: 'cinematic'|'ultra'|null, quality?: string, width: number, height: number, dpr?: number, refreshHz?: number }} o
 *   gpuTier: what GPU detection recommends; quality: the preset in use; width/height: CSS px of the screen
 * @returns {{ value: 'auto'|number, text: string }}
 */
export function resolutionHint(o) {
  const dpr = o.dpr > 0 ? o.dpr : 1;
  const px = (o.width || 0) * (o.height || 0) * dpr * dpr;
  const hz = o.refreshHz || 60;
  const strong = o.gpuTier === 'cinematic' && o.quality === 'cinematic';
  const decent = strong || o.gpuTier === 'ultra' || o.quality === 'cinematic' || o.quality === 'ultra';
  const size = px <= 2.6e6 ? '1080p' : px <= 4.4e6 ? '1440p' : px <= 9.5e6 ? '4K' : '5K+';
  if (!decent) return { value: 'auto', text: 'Recommended: Auto — it holds your display\'s refresh rate.' };
  if (size === '1080p') {
    return strong
      ? { value: 'auto', text: 'Recommended: Auto — your GPU has room to draw 150-200% and shrink it back: the sharpest 1080p.' }
      : { value: 'auto', text: 'Recommended: Auto — it goes above 100% (sharper) when there is room.' };
  }
  if (size === '1440p') {
    return strong
      ? { value: 'auto', text: 'Recommended: Auto (or a fixed 150% if you like the sharpest picture).' }
      : { value: 'auto', text: 'Recommended: Auto.' };
  }
  if (size === '4K') {
    if (strong) {
      return hz >= 120
        ? { value: 'auto', text: `Recommended: Auto — 4K at ${hz} Hz is demanding, Auto trades resolution for frame rate.` }
        : { value: 'auto', text: 'Recommended: Auto — it settles near 100% at 4K; pick 100% for a fixed native picture.' };
    }
    return { value: 0.85, text: 'Recommended: 85% or Auto — 4K is a lot of pixels for this preset.' };
  }
  return { value: 0.7, text: 'Recommended: 70% or Auto — the screen has a huge number of pixels.' };
}
