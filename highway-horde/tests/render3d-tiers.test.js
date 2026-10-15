// The quality tiers of the first-person renderer: 'cinematic' sits above 'ultra', and every
// per-tier table in render3d must have a row for it (a table without one silently rendered
// cinematic as 'high'). three.js is resolved from the vendored copy through a loader hook and a
// stub canvas stands in for the atlases, as in render3d-effects.test.js.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = pathToFileURL(path.resolve(HERE, '../public/vendor/three') + path.sep).href;
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: '${VENDOR}three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: '${VENDOR}addons/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`));

function fakeContext(canvas) {
  const grad = { addColorStop() {} };
  const methods = {
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    measureText: () => ({ width: 10 }),
  };
  return new Proxy({ canvas }, {
    get: (t, p) => (p in methods ? methods[p] : p in t ? t[p] : () => {}),
    set: (t, p, v) => { t[p] = v; return true; },
  });
}

const mods = {};
let tier;

before(async () => {
  globalThis.document = {
    createElement: () => {
      const c = { width: 1, height: 1, style: {} };
      c.getContext = () => fakeContext(c);
      return c;
    },
  };
  tier = await import('../public/js/render3d/tier.js');
  mods.lights = await import('../public/js/render3d/lights.js');
  mods.fx = await import('../public/js/render3d/fx-core.js');
  mods.ground = await import('../public/js/render3d/ground.js');
  mods.dress = await import('../public/js/render3d/world-dress.js');
  mods.veg = await import('../public/js/render3d/world-veg.js');
  mods.casings = await import('../public/js/render3d/casings3d.js');
  mods.gore = await import('../public/js/render3d/gore3d.js');
  mods.zombies = await import('../public/js/render3d/zombies3d.js');
  mods.ambient = await import('../public/js/render3d/ambient3d.js');
  mods.post = await import('../public/js/render3d/post.js');
  mods.shared = await import('../public/js/shared/dress.js');
});

// ---- tier.js ----------------------------------------------------------------------------------

test('tiers run low < high < ultra < cinematic; cinematic reads as ultra for old tables', () => {
  assert.deepEqual([...tier.TIERS], ['low', 'high', 'ultra', 'cinematic']);
  assert.ok(tier.tierAtLeast('cinematic', 'ultra') && tier.tierAtLeast('ultra', 'ultra'));
  assert.ok(!tier.tierAtLeast('ultra', 'cinematic') && !tier.tierAtLeast('high', 'ultra'));
  assert.ok(tier.tierAtLeast('nonsense', 'high') && !tier.tierAtLeast('nonsense', 'ultra'), 'unknown ranks as high');
  assert.equal(tier.baseTier('cinematic'), 'ultra');
  assert.deepEqual(['low', 'high', 'ultra', 'weird', undefined].map(tier.baseTier), ['low', 'high', 'ultra', 'high', 'high']);
  assert.deepEqual(['cinematic', 'ultra', 'high', 'low', 'weird', null].map(tier.normTier), ['cinematic', 'ultra', 'high', 'low', 'high', 'high']);
  assert.deepEqual(['low', 'high', 'ultra', 'cinematic'].map(tier.texScale), [1, 1, 1, 2]);
  assert.equal(tier.tierRow({ ultra: 5, high: 3 }, 'cinematic'), 5, 'a table without a cinematic row falls back to ultra');
  assert.equal(tier.tierRow({ cinematic: 9, ultra: 5, high: 3 }, 'cinematic'), 9);
  assert.equal(tier.tierRow({ ultra: 5, high: 3 }, 'nope'), 3);
});

test('anisotropic filtering: 16x on ultra and cinematic, clamped to the GPU', () => {
  assert.equal(tier.anisoFor('cinematic', 16), 16);
  assert.equal(tier.anisoFor('ultra', 16), 16);
  assert.equal(tier.anisoFor('high', 16), 8);
  assert.equal(tier.anisoFor('low', 16), 2);
  assert.equal(tier.anisoFor('cinematic', 4), 4);
  assert.equal(tier.anisoFor('cinematic', 0), 1);
});

// ---- every per-tier table has a cinematic row -------------------------------------------------

/** [name, table] of every exported per-tier table in render3d (and shared/dress.js). */
function tables() {
  return [
    ['lights LIGHT_POOL', mods.lights.LIGHT_POOL],
    ['lights FLASH_MAP', mods.lights.FLASH_MAP],
    ['lights SUN_MAP', mods.lights.SUN_MAP],
    ['lights SUN_SPAN', mods.lights.SUN_SPAN],
    ['lights LAMP_SHADOWS', mods.lights.LAMP_SHADOWS],
    ['fx-core QUALITY', mods.fx.QUALITY],
    ['ground GROUND_TEXELS', mods.ground.GROUND_TEXELS],
    ['ground GROUND_DENSITY', mods.ground.GROUND_DENSITY],
    ['world-dress TRI_BUDGET', mods.dress.TRI_BUDGET],
    ['world-veg GRASS', mods.veg.GRASS],
    ['casings3d CAP', mods.casings.CAP],
    ['gore3d CAP', mods.gore.CAP],
    ['zombies3d LOD_DIST', mods.zombies.LOD_DIST],
    ['ambient3d FLY', mods.ambient.FLY],
    ['ambient3d BIRDS', mods.ambient.BIRDS],
    ['post PIXEL_BUDGET', mods.post.PIXEL_BUDGET],
    ['shared/dress DRESS_DENSITY', mods.shared.DRESS_DENSITY],
  ];
}

const numbersOf = (v) => (typeof v === 'number' ? [v] : Array.isArray(v) ? v.flatMap(numbersOf) : v && typeof v === 'object' ? Object.values(v).flatMap(numbersOf) : []);

test('every per-tier table has a cinematic row that is at least as generous as ultra', () => {
  for (const [name, t] of tables()) {
    assert.ok(t, `${name} is exported`);
    assert.ok('cinematic' in t, `${name} has a cinematic row`);
    assert.ok('ultra' in t && 'high' in t, `${name} still has its ultra and high rows`);
    // (the grass' `cell` is a spacing: smaller is denser)
    const rest = (r) => (name === 'world-veg GRASS' ? { grid: r.grid, height: r.height, density: r.density } : r);
    const c = numbersOf(rest(t.cinematic)), u = numbersOf(rest(t.ultra));
    assert.equal(c.length, u.length, `${name}: cinematic and ultra rows have the same shape`);
    // nothing gets cheaper or shorter on the top tier
    c.forEach((v, i) => assert.ok(v >= u[i], `${name}[${i}]: cinematic ${v} >= ultra ${u[i]}`));
  }
});

test('the cinematic budgets are the ones the brief asks for', () => {
  assert.equal(mods.lights.LIGHT_POOL.cinematic, 20);
  assert.equal(mods.lights.SUN_MAP.cinematic, 4096);
  assert.ok(mods.lights.LAMP_SHADOWS.cinematic >= 2 && mods.lights.LAMP_SHADOWS.ultra === 0, 'shadow-casting lamps are a Cinematic feature');
  assert.equal(mods.lights.FLASH_MAP.cinematic, 4096);
  assert.equal(mods.dress.TRI_BUDGET.cinematic, 2500000, 'set-dressing cap 650k -> 2.5M');
  assert.equal(mods.dress.TRI_BUDGET.ultra, 650000);
  const q = mods.fx.QUALITY;
  for (const k of ['particles', 'beams', 'gore', 'marks']) {
    const r = q.cinematic[k] / q.ultra[k];
    assert.ok(r >= 2 && r <= 3, `${k} pool x${r.toFixed(2)} is 2-3x ultra`);
  }
  assert.ok(mods.casings.CAP.cinematic / mods.casings.CAP.ultra >= 2);
  assert.ok(mods.gore.CAP.cinematic / mods.gore.CAP.ultra >= 2);
  const g = mods.veg.GRASS;
  assert.ok((g.cinematic.grid ** 2) / (g.ultra.grid ** 2) >= 1.6, 'grass tufts >= 1.6x');
  assert.equal(mods.post.PIXEL_BUDGET.cinematic, 36e6);
  assert.equal(mods.post.PIXEL_BUDGET.ultra, 16e6);
  for (const t of ['low', 'high', 'ultra']) assert.equal(mods.post.PIXEL_BUDGET[t], 16e6, `${t} keeps the 16M pixel budget`);
});

test('the existing tiers keep their old rows', () => {
  assert.deepEqual(mods.lights.LIGHT_POOL, { cinematic: 20, ultra: 12, high: 8, low: 4 });
  assert.deepEqual(mods.fx.QUALITY.ultra, { particles: 4200, beams: 480, gore: 1600, marks: 700 });
  assert.deepEqual(mods.fx.QUALITY.high, { particles: 2600, beams: 320, gore: 800, marks: 360 });
  assert.deepEqual(mods.fx.QUALITY.low, { particles: 900, beams: 140, gore: 160, marks: 80 });
  assert.equal(mods.ground.GROUND_TEXELS.ultra, 10e6);
  assert.equal(mods.casings.CAP.ultra, 140);
  assert.equal(mods.gore.CAP.ultra, 110);
  assert.deepEqual(mods.shared.DRESS_DENSITY, { cinematic: 1, ultra: 1, high: 0.6, low: 0.25 });
});

// ---- guard against a new table nobody remembered ---------------------------------------------------

test('a render3d source file with an `ultra:` table row mentions cinematic too', () => {
  const dir = path.resolve(HERE, '../public/js/render3d');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => path.join(dir, f));
  files.push(path.resolve(HERE, '../public/js/shared/dress.js'));
  files.push(path.resolve(HERE, '../public/js/ui/storage.js'));
  const bad = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    // a table literal row: `ultra: ` at a word boundary that is not a method / property access
    if (/(^|[{,\s])ultra\s*:/m.test(src) && !/cinematic/.test(src)) bad.push(path.basename(f));
  }
  assert.deepEqual(bad, [], 'these files keep a per-tier table without a cinematic row');
});

test('no render3d file collapses cinematic into high with a three-way tier ternary', () => {
  const dir = path.resolve(HERE, '../public/js/render3d');
  const bad = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js') && x !== 'tier.js')) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    // `q === 'ultra' ? 'ultra' : q === 'low' ? 'low' : 'high'` and its siblings map cinematic to 'high'
    if (/===\s*'ultra'\s*\?\s*'ultra'\s*:\s*\w+(\.\w+)?\s*===\s*'low'\s*\?\s*'low'\s*:\s*'high'/.test(src)) bad.push(f);
    if (/===\s*'low'\s*\|\|\s*\w+(\.\w+)?\s*===\s*'ultra'\s*\?/.test(src)) bad.push(f);
  }
  assert.deepEqual(bad, []);
});
