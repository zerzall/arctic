// The post chain's pure parts (render3d/post.js) in plain Node: settings normalisation, the
// refresh-aware dynamic resolution and the Cinematic pixel budget. three.js is resolved from the
// vendored copy through a loader hook; nothing here needs a GL context.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const VENDOR = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/vendor/three') + path.sep).href;
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: '${VENDOR}three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: '${VENDOR}addons/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`));

let post;
before(async () => {
  globalThis.document = { createElement: () => ({ width: 1, height: 1, style: {}, getContext: () => new Proxy({}, { get: () => () => {} }) }) };
  post = await import('../public/js/render3d/post.js');
});

test('post settings: the cinematic extras stay undefined until a caller passes them', () => {
  const d = post.normPostSettings({});
  for (const k of ['msaa', 'shadowsHigh', 'contactShadows', 'aoFull', 'fxHigh', 'motionBlur', 'dof', 'lensFx', 'lightShadows']) assert.equal(d[k], undefined, k);
  assert.equal(d.brightness, 1);
  assert.equal(d.contrast, 1);
  assert.equal(d.saturation, 1);
  assert.equal(d.timing, false);
  const s = post.normPostSettings({ msaa: 8, shadowsHigh: 1, dof: true, motionBlur: false, brightness: 1.2, contrast: 5, saturation: 0.1, timing: true });
  assert.equal(s.msaa, 8);
  assert.equal(s.shadowsHigh, false, 'only a real true counts');
  assert.equal(s.dof, true);
  assert.equal(s.motionBlur, false);
  assert.equal(s.brightness, 1.2);
  assert.equal(s.contrast, 1.3, 'clamped');
  assert.equal(s.saturation, 0.7);
  assert.equal(s.timing, true);
  assert.equal(post.normPostSettings({ msaa: 3 }).msaa, 0, 'not a sample count: off');
  assert.deepEqual(Object.keys(post.CINEMATIC_DEFAULTS).sort(), ['aoFull', 'contactShadows', 'dof', 'fxHigh', 'lensFx', 'lightShadows', 'motionBlur', 'msaa', 'shadowsHigh']);
  assert.equal(post.CINEMATIC_DEFAULTS.msaa, 4);
  assert.equal(post.CINEMATIC_DEFAULTS.motionBlur, false, 'motion blur is opt-in');
});

/** Run the controller on a simulated GPU: frame time = max(one refresh period, gpu time); gpu = base ms * scale^2. */
function settle(hz, baseMs, maxScale, seconds = 120, startScale = 1) {
  const dyn = post.createDynRes(maxScale, hz * 0.97);
  dyn.reset(startScale);
  let scale = startScale, now = 0;
  for (let i = 0; i < hz * seconds; i++) {
    const gpu = baseMs * scale * scale;
    now += Math.max(1000 / hz, gpu);
    const ns = dyn.tick(now, gpu);
    if (ns !== null) scale = ns;
  }
  return { scale, dyn };
}

test('dynamic resolution aims at 97 % of the refresh rate', () => {
  assert.ok(Math.abs(post.createDynRes(1).target - 58.2) < 1e-9, 'the default is a 60 Hz display');
  assert.ok(Math.abs(post.createDynRes(1.5, 139.68).target - 139.68) < 1e-9);
  const d = post.createDynRes(1, 58.2);
  d.setTarget(232.8);
  assert.ok(Math.abs(d.target - 232.8) < 1e-9, 'a rate measured late re-aims');
});

test('dynamic resolution: a strong GPU climbs, a weak one settles where the display\'s rate holds', () => {
  // 60 Hz, 4 ms of GPU at 100%: climbs to the ceiling of 1.5
  assert.ok(settle(60, 4, 1.5).scale >= 1.45);
  // ... and Cinematic's ceiling is 2 (the pixel budget of renderer3d caps it further)
  assert.ok(settle(60, 1, 2).scale >= 1.95);
  // 144 Hz: 2 ms at 100% (4.6 ms of headroom = 2/3 of 6.9): climbs until gpu time reaches it (scale ~1.5)
  const strong = settle(144, 2, 2).scale;
  assert.ok(strong > 1.35 && strong <= 1.6, `144 Hz strong GPU settled at ${strong}`);
  // 144 Hz with a GPU that needs 14.8 ms at 100% (as in the 60 Hz test): 6.7 ms is the budget -> ~0.67
  const weak = settle(144, 14.8, 1.5, 200, 1.5).scale;
  assert.ok(weak >= 0.6 && weak <= 0.78, `144 Hz weak GPU settled at ${weak}`);
  // the same GPU at 60 Hz can hold ~1.0
  const w60 = settle(60, 14.8, 1.5, 200, 1.5).scale;
  assert.ok(w60 >= 0.9 && w60 <= 1.15, `60 Hz weak GPU settled at ${w60}`);
  // 240 Hz: 3.9 ms budget
  const w240 = settle(240, 14.8, 1.5, 200, 1.5).scale;
  assert.ok(w240 >= 0.5 && w240 <= 0.6, `240 Hz weak GPU settled at ${w240}`);
  // a CPU-bound machine (fixed 12 ms frames at 144 Hz whatever the scale) is not driven to the floor
  const dyn = post.createDynRes(1.5, 139.68);
  dyn.reset(1);
  let now = 0, scale = 1;
  for (let i = 0; i < 144 * 120; i++) {
    now += 12;
    const ns = dyn.tick(now, 1);
    if (ns !== null) scale = ns;
  }
  assert.ok(scale >= 0.85, `CPU-bound: scale ${scale}`);
});

test('dynamic resolution stays inside its range', () => {
  const lo = settle(60, 200, 1.5, 200, 1).scale;
  assert.equal(lo, 0.5, 'a hopeless GPU ends at the floor');
  assert.ok(settle(60, 0.1, 1, 200, 1).scale <= 1, 'a ceiling of 1 is respected');
  assert.ok(settle(60, 0.1, 9, 200, 1).scale <= post.RENDER_SCALE_LIMIT, 'and never above the limit');
});

test('pixel budgets per tier', () => {
  assert.equal(post.PIXEL_BUDGET.cinematic, 36e6);
  // 4K at 1.5 squared = 18.7 million pixels fits Cinematic's budget, 2.0 squared (33 M) too
  assert.ok(3840 * 2160 * 1.5 * 1.5 <= post.PIXEL_BUDGET.cinematic);
  assert.ok(3840 * 2160 * 2 * 2 <= post.PIXEL_BUDGET.cinematic);
  assert.ok(3840 * 2160 * 2 * 2 > post.PIXEL_BUDGET.ultra, 'the other tiers cap 200% at 4K');
});
