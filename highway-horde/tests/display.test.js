// Display helpers (ui/display.js): refresh-rate measurement and snapping, dynamic-resolution target,
// the frame-rate limiter and the "Recommended" resolution hint.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REFRESH_RATES, snapRefresh, median, estimateRefreshHz, isSteady, measureRefresh, dynResTarget, createFrameLimiter, resolutionHint,
  DYNRES_TARGET_SHARE,
} from '../public/js/ui/display.js';

/** n rAF intervals around 1000/hz ms with a little jitter (deterministic). */
function intervals(hz, n = 90, jitter = 0.03) {
  const out = [];
  let seed = 7;
  for (let i = 0; i < n; i++) {
    seed = (seed * 16807) % 2147483647;
    out.push((1000 / hz) * (1 + (seed / 2147483647 - 0.5) * 2 * jitter));
  }
  return out;
}

test('a measured rate snaps to the nearest real refresh rate', () => {
  assert.deepEqual([...REFRESH_RATES].slice(0, 8), [60, 75, 90, 100, 120, 144, 165, 240]);
  const cases = [[59.94, 60], [60.2, 60], [74.9, 75], [90.4, 90], [99.5, 100], [119.88, 120], [143.7, 144], [144.3, 144], [164, 165], [239.5, 240], [238, 240], [61.5, 60], [117, 120], [150, 144]];
  for (const [hz, want] of cases) assert.equal(snapRefresh(hz), want, String(hz));
  // a throttled or busy machine measures low: it reads as 60, never as 30
  for (const hz of [10, 30, 45, 49.9, NaN, Infinity * 0, undefined, null]) assert.equal(snapRefresh(hz), 60, String(hz));
});

test('refresh estimation: the median of the intervals, hitches and start-up frames ignored', () => {
  for (const hz of [60, 75, 90, 100, 120, 144, 165, 240]) {
    const iv = intervals(hz);
    assert.equal(estimateRefreshHz(iv), hz, `${hz} Hz`);
  }
  // long start-up frames and a couple of hitches do not move the median
  const iv = [180, 90, 55, ...intervals(144, 80), 400, 260, 32];
  assert.equal(estimateRefreshHz(iv), 144);
  assert.equal(estimateRefreshHz([16.7, 16.7]), null, 'too few samples to say');
  assert.equal(estimateRefreshHz([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.ok(Number.isNaN(median([])));
});

test('steady measurements are told from busy ones', () => {
  assert.equal(isSteady(intervals(144)), true);
  assert.equal(isSteady(intervals(60, 90, 0.05)), true);
  const busy = intervals(144, 90, 0.03).map((v, i) => (i % 3 === 0 ? v * 2.1 : v));
  assert.equal(isSteady(busy), false, 'every third frame dropped: not the display\'s own rhythm');
  assert.equal(isSteady([16, 17]), false);
});

test('measureRefresh drives requestAnimationFrame and reports the rate and steadiness', () => {
  const run = (hz) => {
    let t = 0, cb = null, out = null;
    const period = 1000 / hz;
    const raf = (f) => { cb = f; };
    measureRefresh({ raf, frames: 60, onDone: (r, steady) => { out = { r, steady }; } });
    for (let i = 0; i < 400 && cb; i++) { const f = cb; cb = null; t += period; f(t); }
    return out;
  };
  assert.deepEqual(run(144), { r: 144, steady: true });
  assert.deepEqual(run(60), { r: 60, steady: true });
  const m = measureRefresh({ raf: () => {}, onDone: () => assert.fail('never called') });
  m.stop();
});

test('dynamic resolution aims at 97 % of the refresh rate', () => {
  assert.equal(DYNRES_TARGET_SHARE, 0.97);
  assert.ok(Math.abs(dynResTarget(60) - 58.2) < 1e-9);
  assert.ok(Math.abs(dynResTarget(144) - 139.68) < 1e-9);
  assert.ok(Math.abs(dynResTarget(240) - 232.8) < 1e-9);
  assert.ok(Math.abs(dynResTarget(undefined) - 58.2) < 1e-9, 'unknown: 60 Hz');
  assert.ok(Math.abs(dynResTarget(12) - 58.2) < 1e-9, 'nonsense: 60 Hz');
});

test('the frame limiter: a cap holds the rate on any display, no cap runs every frame', () => {
  const run = (displayHz, cap, seconds = 20) => {
    const lim = createFrameLimiter();
    let ran = 0;
    const period = 1000 / displayHz;
    for (let t = period; t < seconds * 1000; t += period) if (lim.allow(t, cap, displayHz)) ran++;
    return ran / seconds;
  };
  for (const [disp, cap, want] of [[144, 60, 60], [144, 120, 120], [240, 144, 144], [165, 60, 60], [120, 60, 60], [60, 30, 30]]) {
    const fps = run(disp, cap);
    assert.ok(Math.abs(fps - want) <= want * 0.02, `${disp} Hz display, cap ${cap}: ${fps.toFixed(1)} fps`);
  }
  const near = (a, b) => Math.abs(a - b) < 0.5;
  for (const cap of ['off', 0, undefined, null, 'x']) assert.ok(near(run(144, cap), 144), `cap ${cap}`);
  assert.ok(near(run(60, 60), 60), 'a cap equal to the display rate skips nothing');
  assert.ok(near(run(144, 144), 144));
  // a long hidden-tab gap restarts the schedule instead of running a burst
  const lim = createFrameLimiter();
  assert.equal(lim.allow(1000, 60, 144), true);
  assert.equal(lim.allow(60000, 60, 144), true);
  assert.equal(lim.allow(60007, 60, 144), false);
});

test('the resolution hint follows the card, the preset, the screen and the refresh rate', () => {
  const rtx = { gpuTier: 'cinematic', quality: 'cinematic' };
  const at1080 = resolutionHint({ ...rtx, width: 1920, height: 1080, dpr: 1, refreshHz: 60 });
  assert.equal(at1080.value, 'auto');
  assert.match(at1080.text, /^Recommended: Auto/);
  assert.match(at1080.text, /150-200%/);
  const at1440 = resolutionHint({ ...rtx, width: 2560, height: 1440, dpr: 1, refreshHz: 144 });
  assert.match(at1440.text, /Auto/);
  assert.match(at1440.text, /150%/);
  // 4K = 3840x2160 at dpr 1, or 2560x1440 css at dpr 1.5
  for (const [w, h, dpr] of [[3840, 2160, 1], [2560, 1440, 1.5]]) {
    const at4k = resolutionHint({ ...rtx, width: w, height: h, dpr, refreshHz: 60 });
    assert.equal(at4k.value, 'auto');
    assert.match(at4k.text, /near 100% at 4K/);
  }
  assert.match(resolutionHint({ ...rtx, width: 3840, height: 2160, dpr: 1, refreshHz: 144 }).text, /144 Hz/);
  // a mid card on the Ultra preset at 4K: a fixed lower scale is suggested
  const mid = resolutionHint({ gpuTier: 'ultra', quality: 'ultra', width: 3840, height: 2160, dpr: 1, refreshHz: 60 });
  assert.equal(mid.value, 0.85);
  // the lower presets and unknown cards: Auto
  for (const o of [{ gpuTier: null, quality: 'high' }, { gpuTier: null, quality: 'low' }]) {
    const h = resolutionHint({ ...o, width: 3840, height: 2160, dpr: 1, refreshHz: 60 });
    assert.equal(h.value, 'auto');
    assert.match(h.text, /^Recommended: Auto/);
  }
});
