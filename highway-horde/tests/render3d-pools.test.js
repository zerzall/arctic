// Effect pools of the first-person renderer in plain Node (no GL): particle / decal ring
// buffers, severed limbs, shell casings and the gore palette must stay inside their caps
// however hard a fight gets. three.js is resolved from the vendored copy through a loader
// hook, and a stub canvas stands in for the sprite / decal atlases (their pixels are checked
// visually with the Playwright sandbox, not here).

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

/** A canvas 2D context that accepts everything and draws nothing. */
function fakeContext(canvas) {
  const grad = { addColorStop() {} };
  const methods = {
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    measureText: () => ({ width: 10 }),
  };
  const store = { canvas };
  return new Proxy(store, {
    get: (t, p) => (p in methods ? methods[p] : p in t ? t[p] : () => {}),
    set: (t, p, v) => { t[p] = v; return true; },
  });
}

let THREE, core, decalsMod, goreMod, casingsMod, bloodMod;

before(async () => {
  globalThis.document = {
    createElement: () => {
      const c = { width: 1, height: 1, style: {} };
      c.getContext = () => fakeContext(c);
      return c;
    },
  };
  THREE = await import('three');
  core = await import('../public/js/render3d/fx-core.js');
  decalsMod = await import('../public/js/render3d/fx-decals.js');
  goreMod = await import('../public/js/render3d/gore3d.js');
  casingsMod = await import('../public/js/render3d/casings3d.js');
  bloodMod = await import('../public/js/render3d/blood3d.js');
});

function makeCtx(quality) {
  return { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(70, 1.6, 2, 5000), quality, rng: Math.random };
}

/** Run the pools' per-frame flush (what three.js does while projecting the scene). */
function flush(ctx, now, dt = 1 / 60) {
  const fx = core.acquireFx(ctx);
  fx.begin({ now, dt });
  core.releaseFx(ctx);
  const root = ctx.scene.children.find((c) => c.name === 'fx-core');
  root.update();
}

const CAPS = {
  ultra: { particles: 4200, gore: 1600, marks: 700 },
  high: { particles: 2600, gore: 800, marks: 360 },
  low: { particles: 900, gore: 160, marks: 80 },
};

for (const tier of ['ultra', 'high', 'low']) {
  test(`particle pool is capped on ${tier}`, () => {
    const ctx = makeCtx(tier);
    const fx = core.acquireFx(ctx);
    const white = new THREE.Color(1, 1, 1);
    let ok = 0, refused = 0;
    for (let i = 0; i < CAPS[tier].particles + 3000; i++) {
      const k = fx.spawn(0, 10, 0, 1, 1, 1, 5, 2, 2, white, 1, core.FR.DOT, 0);
      if (k >= 0) ok++; else refused++;
    }
    assert.equal(ok, CAPS[tier].particles, 'exactly the tier\'s cap was accepted');
    assert.ok(refused >= 3000, 'the rest was refused');
    assert.equal(fx.load(), 1);
    flush(ctx, 1);
    assert.equal(fx.stats.particles, CAPS[tier].particles);
    core.releaseFx(ctx);
  });

  test(`decal ring buffers are capped and recycle the oldest on ${tier}`, () => {
    const ctx = makeCtx(tier);
    const fx = core.acquireFx(ctx);
    const D = fx.decals, c = CAPS[tier];
    for (let i = 0; i < c.gore * 4 + 17; i++) D.add(0, i, 0, i, 0, 1, 0, 10, decalsMod.DC.SPLAT, decalsMod.DK.BLOOD, 0.5, 0, 0, 1, 100);
    for (let i = 0; i < c.marks * 4 + 5; i++) D.add(1, i, 0, i, 0, 1, 0, 5, decalsMod.DC.HOLE, decalsMod.DK.HOLE, 0, 0, 0, 1, 100);
    flush(ctx, 1);
    assert.equal(D.stats.gore, c.gore);
    assert.equal(D.stats.marks, c.marks);
    assert.equal(fx.stats.decals, c.gore + c.marks);
    const mesh = ctx.scene.children.find((k) => k.name === 'fx-core') && ctx.scene.getObjectByName('fx-decals');
    const total = CAPS.ultra.gore + CAPS.ultra.marks;
    assert.ok(mesh.geometry.instanceCount <= total, 'never draws more instances than the buffer holds');
    // the ring wraps: after the clock moves on, the next decal takes the oldest slot
    const before = D.stats.born;
    D.advance(30);
    D.add(0, 999, 0, 999, 0, 1, 0, 10, decalsMod.DC.SPLAT, decalsMod.DK.BLOOD, 0.5, 0, 0, 1, 100);
    assert.equal(D.stats.born, before + 1);
    const birth = mesh.geometry.getAttribute('iInfo').array;
    let newest = 0;
    for (let s = 0; s < c.gore; s++) newest = Math.max(newest, birth[s * 4 + 1]);
    assert.ok(newest >= 30, 'the new decal overwrote an old slot');
    // the gore ring never touches the marks ring and vice versa
    assert.equal(mesh.geometry.getAttribute('iPos').array.length, total * 4);
    core.releaseFx(ctx);
  });
}

test('switching quality down shrinks the rings and the particle pool', () => {
  const ctx = makeCtx('ultra');
  const fx = core.acquireFx(ctx);
  for (let i = 0; i < 5000; i++) fx.decals.add(0, i, 0, i, 0, 1, 0, 10, 0, 0, 1, 0, 0, 1, 50);
  const white = new THREE.Color(1, 1, 1);
  for (let i = 0; i < 5000; i++) fx.spawn(0, 10, 0, 0, 0, 0, 5, 2, 2, white, 1, core.FR.DOT, 0);
  fx.setQuality('low');
  flush(ctx, 1);
  assert.ok(fx.decals.stats.gore <= CAPS.low.gore);
  assert.ok(fx.decals.stats.marks <= CAPS.low.marks);
  assert.ok(fx.stats.particles <= CAPS.low.particles);
  core.releaseFx(ctx);
});

test('gore palette: red when on, thinner when low, dark ash grey when off', () => {
  const ctx = makeCtx('high');
  const fx = core.acquireFx(ctx);
  assert.equal(fx.gore.mode, 'on');
  assert.ok(fx.gore.splat.r > fx.gore.splat.g * 4, 'blood is red');
  assert.equal(fx.setGore('low'), true);
  assert.equal(fx.gore.k, 0.5);
  assert.ok(fx.gore.splat.r > fx.gore.splat.g * 4, 'low keeps red');
  assert.equal(fx.setGore('off'), true);
  assert.equal(fx.gore.k, 0);
  for (const c of [fx.gore.blood, fx.gore.blood2, fx.gore.mist, fx.gore.splat, fx.gore.pool, fx.gore.flesh]) {
    assert.ok(Math.abs(c.r - c.g) < 0.02 && Math.abs(c.g - c.b) < 0.02, 'ash grey has no red: ' + [c.r, c.g, c.b].map((v) => v.toFixed(3)).join(','));
    assert.ok(c.r < 0.12, 'and it is dark');
  }
  assert.equal(fx.setGore('off'), false, 'no change, no work');
  assert.equal(fx.setGore('garbage'), true, 'unknown values mean on');
  assert.equal(fx.gore.mode, 'on');
  core.releaseFx(ctx);
});

function goreEnv(fx) {
  return { G: () => 0, surf: () => null, high: true, ultra: true, blood: { groundSplat() {}, wallSplat() {}, smear() {} } };
}

for (const [tier, cap] of [['ultra', 110], ['high', 64], ['low', 0]]) {
  test(`severed limbs are pooled: at most ${cap} on ${tier}, and they sink away`, () => {
    const ctx = makeCtx(tier);
    const fx = core.acquireFx(ctx);
    const gore = goreMod.createGore3D(ctx, fx, goreEnv(fx));
    for (let i = 0; i < 300; i++) gore.burst(100 + i, 100, NaN, 0.9, 14, i);
    assert.ok(gore.count <= cap, `count ${gore.count} <= ${cap}`);
    if (cap) assert.ok(gore.count > 0);
    for (let f = 0; f < 60 * 32; f++) gore.step(1 / 60);
    assert.equal(gore.count, 0, 'everything is recycled after its life');
    // gore low or off: nothing is thrown
    for (const mode of ['low', 'off']) {
      fx.setGore(mode);
      gore.burst(0, 0, 0, 1, 14, 0);
      gore.limb(0, 0, 0, 1, 0);
      assert.equal(gore.count, 0, `no limbs with gore ${mode}`);
    }
    gore.dispose();
    core.releaseFx(ctx);
  });
}

for (const [tier, cap] of [['ultra', 140], ['high', 80], ['low', 22]]) {
  test(`shell casings are pooled: at most ${cap} on ${tier}; they settle and fade`, () => {
    const ctx = makeCtx(tier);
    const fx = core.acquireFx(ctx);
    const c = casingsMod.createCasings3D(ctx, fx, { G: () => 0 });
    for (let i = 0; i < 1000; i++) c.eject(0, 40, 0, i * 0.1, i % 3);
    assert.ok(c.count <= cap, `count ${c.count} <= ${cap}`);
    for (let f = 0; f < 60 * 4; f++) c.step(1 / 60);
    assert.ok(c.count > 0 && c.count <= cap, 'they stay on the ground for a while');
    for (let f = 0; f < 60 * 45; f++) c.step(1 / 60);
    assert.equal(c.count, 0, 'and are recycled after their life');
    c.dispose();
    core.releaseFx(ctx);
  });
}

test('blood sprays are budgeted per frame (a minigun into a horde cannot flood the decal rings)', () => {
  const ctx = makeCtx('high');
  const fx = core.acquireFx(ctx);
  const blood = bloodMod.createBlood(ctx, fx, { G: () => 0, surf: () => null, gm: () => 3 });
  blood.update({ zombies: [], players: [] }, { dt: 1 / 60 });
  const born0 = fx.decals.stats.born;
  for (let i = 0; i < 400; i++) blood.exitSpray(100, 30, 100, 0.3, 0.6, 0);
  const one = fx.decals.stats.born - born0;
  assert.ok(one <= 9 * 3, `a frame's sprays are capped (${one} decals)`);
  blood.update({ zombies: [], players: [] }, { dt: 1 / 60 });
  for (let i = 0; i < 400; i++) blood.exitSpray(100, 30, 100, 0.3, 0.6, 0);
  assert.ok(fx.decals.stats.born - born0 <= 2 * 9 * 3 + 2);
  core.releaseFx(ctx);
});

test('the decal atlas has a cell for every decal type', () => {
  const { DC } = decalsMod;
  const cells = Object.entries(DC).filter(([k]) => !k.endsWith('_N')).map(([, v]) => v);
  for (const v of cells) assert.ok(Number.isInteger(v) && v >= 0 && v < 64, 'cell inside the 8x8 atlas');
  const ranges = [['SPLAT', 'SPLAT_N'], ['SPRAY', 'SPRAY_N'], ['DRIP', 'DRIP_N'], ['SMEAR', 'SMEAR_N'], ['POOL', 'POOL_N'], ['MIST', 'MIST_N'], ['HOLE', 'HOLE_N'], ['CHIP', 'CHIP_N'], ['SCORCH', 'SCORCH_N']];
  const used = new Map();
  for (const [a, n] of ranges) for (let i = 0; i < DC[n]; i++) {
    assert.ok(!used.has(DC[a] + i), `cell ${DC[a] + i} (${a}) is unique`);
    used.set(DC[a] + i, a);
  }
  for (const k of ['FOOT_SHOE', 'FOOT_BARE', 'HOLE_METAL', 'HOLE_GLASS', 'HOLE_WOOD', 'DENT', 'CRATER', 'SOOT', 'ACID', 'CLAW', 'SPLASH_RING', 'ASH']) {
    assert.ok(!used.has(DC[k]), `cell ${DC[k]} (${k}) is unique`);
    used.set(DC[k], k);
  }
});
