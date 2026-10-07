// The zombies' baked texture sets (scripts/bake-zombies.js → public/textures/zombies/, read by
// render3d/actor-ztex.js and drawn by the corpse material's HH_ZTEX path in actor-zmat.js): the
// bake is deterministic, the shipped PNGs are valid and match the manifest's pixel hashes, the
// runtime decoder reads them byte for byte, every type builds on every tier with and without the
// sets, the VRAM stays inside the tier budgets, a missing file falls back to the procedural
// shading, and the indoor light mask (indoor.js) still wraps the textured material.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = pathToFileURL(path.resolve(HERE, '../public/vendor/three') + path.sep).href;
const TEX = path.resolve(HERE, '../public/textures/zombies');
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: '${VENDOR}three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: '${VENDOR}addons/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`));

let THREE, bake, lib, zt, rigmat, zm, look, indoor;
const TYPES = ['walker', 'runner', 'crawler', 'bloater', 'spitter', 'screamer', 'brute', 'boss'];

before(async () => {
  THREE = await import('three');
  bake = await import('../scripts/bake-zombies.js');
  lib = await import('../scripts/zbake/lib.js');
  zt = await import('../public/js/render3d/actor-ztex.js');
  rigmat = await import('../public/js/render3d/actor-rigmat.js');
  zm = await import('../public/js/render3d/actor-zmodels.js');
  look = await import('../public/js/render3d/actor-zlook.js');
  indoor = await import('../public/js/render3d/indoor.js');
});

/** A fetch over the shipped files (or a list of missing ones). */
function fileFetch(missing = []) {
  return async (url) => {
    const name = url.split('/').pop();
    if (missing.includes(name)) return { ok: false, status: 404 };
    try {
      const b = fs.readFileSync(path.join(TEX, name));
      return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) };
    } catch { return { ok: false, status: 404 }; }
  };
}

test('the bake is deterministic: the same code paints the same pixels', () => {
  for (const name of ['skin-weeks', 'face-c', 'cloth-denim', 'wounds', 'grime']) {
    const set = bake.SETS.find((s) => s.name === name);
    const a = bake.bakeSet(set, 64), b = bake.bakeSet(set, 64);
    assert.deepEqual(a.hashes, b.hashes, name);
    for (const k of ['albedo', 'normal', 'pack']) assert.ok(a.maps[k].px.some((v) => v !== a.maps[k].px[0]), `${name} ${k} is not blank`);
  }
});

test('the baker and the runtime agree on the sets, their order and their kinds', () => {
  assert.deepEqual(bake.SETS.map((s) => [s.name, s.kind]), zt.ZT_SETS);
  // every runtime class names real sets
  for (const tier of ['high', 'ultra', 'cinematic']) {
    const L = zt.ztexLayout(tier);
    for (const g of L.groups) for (const [, s] of g.layers) assert.ok(zt.ZT_SETS.some(([n]) => n === s), s);
    for (const c of zt.ZT_CLASSES) assert.ok(L.slot[c], `${tier} places ${c}`);
  }
  assert.equal(zt.ztexLayout('low'), null, 'low keeps the procedural shading');
});

test('PNG writer and readers: a round trip through node and the runtime decoder, CRCs checked', async () => {
  const r = lib.rng(7);
  for (const ch of [1, 2, 3, 4]) {
    const w = 37, h = 23, px = new Uint8Array(w * h * ch);
    for (let i = 0; i < px.length; i++) px[i] = i % 7 === 0 ? 255 : Math.floor(r() * 256);
    const png = lib.encodePNG(w, h, ch, px);
    const a = lib.decodePNG(png);
    assert.equal(a.w, w); assert.equal(a.h, h); assert.equal(a.ch, ch);
    assert.deepEqual(a.px, px);
    const b = await zt.decodePNG(new Uint8Array(png));
    assert.deepEqual(b.px, px, `runtime decoder, ${ch} channels`);
    const bad = Buffer.from(png);
    bad[bad.length - 20] ^= 0x55;
    assert.throws(() => lib.decodePNG(bad), /CRC|data|inflate|incorrect/i);
  }
});

test('the shipped files are all there, valid, at their sizes and match the manifest', async () => {
  const man = JSON.parse(fs.readFileSync(path.join(TEX, 'manifest.json'), 'utf8'));
  assert.equal(man.size, 2048, 'painted at 2048²');
  assert.deepEqual(man.sets.map((s) => s.name), zt.ZT_SETS.map(([n]) => n));
  const crypto = await import('node:crypto');
  let bytes = 0;
  for (const s of man.sets) {
    for (const k of ['albedo', 'normal', 'pack']) {
      const f = s.files[k];
      const buf = fs.readFileSync(path.join(TEX, f.file));
      bytes += buf.length;
      const img = lib.decodePNG(buf);
      assert.equal(img.w, f.size, `${f.file} size`);
      assert.equal(img.h, f.size);
      assert.equal(crypto.createHash('sha256').update(img.px).digest('hex').slice(0, 16), s.hashes[k], `${f.file} pixels match the bake`);
    }
    const sizes = ['albedo', 'normal', 'pack'].map((k) => s.files[k].size);
    if (['skin-fresh', 'skin-weeks', 'skin-months'].includes(s.name)) assert.deepEqual(sizes, [2048, 2048, 2048], s.name);
  }
  assert.ok(bytes < 200e6, `the sets weigh ${(bytes / 1e6).toFixed(0)} MB`);
});

test('the runtime decoder reads the shipped PNGs byte for byte', async () => {
  for (const f of ['skin-months-normal.png', 'face-d-albedo.png', 'grime-albedo.png']) {
    const buf = fs.readFileSync(path.join(TEX, f));
    const a = lib.decodePNG(buf), b = await zt.decodePNG(new Uint8Array(buf));
    assert.equal(b.w, a.w); assert.equal(b.ch, a.ch);
    assert.ok(Buffer.compare(Buffer.from(a.px), Buffer.from(b.px)) === 0, f);
  }
});

test('VRAM: the zombie textures stay inside the tier budgets', () => {
  const mb = (t) => zt.ztexBytes(zt.ztexLayout(t)) / 1e6;
  assert.ok(mb('ultra') < 300, `ultra ${mb('ultra').toFixed(0)} MB`);
  assert.ok(mb('cinematic') < 600, `cinematic ${mb('cinematic').toFixed(0)} MB`);
  assert.ok(mb('high') < mb('ultra') && mb('ultra') < mb('cinematic'));
  // at most three arrays (three samplers) on any tier
  for (const t of ['high', 'ultra', 'cinematic']) assert.ok(zt.ztexLayout(t).groups.length <= 3, t);
});

test('a missing file falls back to the procedural shading (null, nothing thrown)', async () => {
  const r = await zt.loadZombieTextures('high', { fetch: fileFetch(['face-c-pack.png']), quiet: true });
  assert.equal(r, null);
  assert.equal(await zt.loadZombieTextures('low', { fetch: fileFetch() }), null);
  assert.equal(await zt.loadZombieTextures('high', { fetch: async () => { throw new Error('offline'); }, quiet: true }), null);
});

test('the sets load into texture arrays laid out as the tier says', async () => {
  const r = await zt.loadZombieTextures('high', { fetch: fileFetch(), quiet: true });
  assert.ok(r, 'loaded');
  const L = zt.ztexLayout('high');
  assert.equal(r.textures.length, L.groups.length);
  r.textures.forEach((t, i) => {
    assert.ok(t.isDataArrayTexture);
    assert.equal(t.image.width, L.groups[i].size);
    assert.equal(t.image.depth, L.groups[i].layers.length);
    assert.equal(t.colorSpace, THREE.NoColorSpace);
  });
  // a skin layer's alpha is the subsurface thickness: fresh skin is thick, months-dead none
  const g = L.slot.skinA, data = r.textures[g.g].image.data, n = L.groups[g.g].size ** 2 * 4;
  const avgA = (layer) => { let s = 0; for (let i = layer * n + 3; i < (layer + 1) * n; i += 64) s += data[i]; return s / (n / 64); };
  assert.ok(avgA(g.base) > 150 && avgA(g.base + 2) < 40, `thickness fresh ${avgA(g.base).toFixed(0)}, months ${avgA(g.base + 2).toFixed(0)}`);
  for (const t of r.textures) t.dispose();
});

const shared = () => ({ uRigTex: { value: null }, uDetail: { value: null }, uDetail2: { value: null }, uNrm: { value: null }, uTime: { value: 0 }, uCin: { value: 0 } });

function zombieOpts(type, layout) {
  const P = zm.zombieParams(type), fa = zm.faceAnchors(type);
  return {
    rim: '#8ea4c8', rimStrength: 0.2,
    zombie: {
      body: [P.waist, P.chest, P.sY, P.gaunt], body2: [P.headC[0], P.headC[1], P.legGap, P.bulk * P.upper], day: { value: 1 },
      ztex: { state: { layout, tier: layout && layout.tier }, uniforms: { uZT0: { value: null }, uZT1: { value: null }, uZT2: { value: null } } },
      special: zt.SPECIAL[type] ?? -1, spitter: type === 'spitter', bloater: type === 'bloater', face: [fa.ez, fa.ey, fa.my, fa.cy], head: P.headR,
    },
  };
}

function compile(mat) {
  const sh = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  mat.onBeforeCompile(sh);
  return sh;
}

test('every type builds on every tier, with the sets and without', () => {
  for (const tier of ['low', 'high', 'ultra', 'cinematic']) {
    const layout = zt.ztexLayout(tier);
    for (const type of TYPES) {
      const r = rigmat.makeMaterials(shared(), zombieOpts(type, layout));
      const plain = compile(r.material);
      assert.ok(!plain.fragmentShader.includes('zTriN('), `${tier} ${type}: procedural until the sets are in`);
      if (!layout) continue;
      r.material.defines = { HH_ZTEX: 2 };
      const sh = compile(r.material);
      const f = sh.fragmentShader;
      assert.ok(f.includes('zTriN(') && f.includes('zFaceAt(') && f.includes('zWoundTex('), `${tier} ${type}: the textured path`);
      assert.ok(sh.vertexShader.includes('vMN = normal;'), 'the rest normal for the projections');
      // every class macro the code uses is defined by the layout, every sampler declared once
      for (const m of f.matchAll(/\bZ[SB]_(\w+)/g)) assert.ok(f.includes(`#define ${m[0]} `), `${tier}: ${m[0]} defined`);
      for (let i = 0; i < layout.groups.length; i++) assert.equal(f.split(`uniform highp sampler2DArray uZT${i};`).length, 2, `uZT${i}`);
      for (const k of ['uZTex', 'uZFace', 'uZHead', 'uZT0']) assert.ok(k in sh.uniforms, k);
      assert.equal(sh.uniforms.uZTex.value.x, zt.SPECIAL[type] ?? -1, `${type}: its own skin`);
      // three's chunks all found their anchors
      for (const inc of ['#include <roughnessmap_fragment>', '#include <normal_fragment_maps>', '#include <metalnessmap_fragment>']) assert.ok(!f.includes(inc), inc);
    }
  }
});

test('the textured corpse material keeps three\'s light chunks: the indoor light mask still wraps it', () => {
  const layout = zt.ztexLayout('ultra');
  const r = rigmat.makeMaterials(shared(), zombieOpts('walker', layout));
  r.material.defines = { HH_ZTEX: 2 };
  assert.ok(indoor.patchIndoor(r.material), 'patched');
  const sh = compile(r.material);
  const f = sh.fragmentShader;
  assert.ok(f.startsWith('#define HH_INDOOR'), 'the indoor define, chained after our onBeforeCompile');
  assert.ok(f.includes('uniform sampler2D uIndoorMap') && 'uIndoorMap' in sh.uniforms);
  for (const inc of ['#include <lights_fragment_begin>', '#include <lights_fragment_end>', '#include <fog_fragment>', '#include <lights_physical_fragment>']) assert.ok(f.includes(inc), inc);
  assert.ok(f.includes('zTriN(') && f.includes('directLight.color * ( wrapNL'), 'the baked sets and the wrapped subsurface term');
  assert.ok(r.material.customProgramCacheKey().endsWith('|hhIndoor'));
});

test('who wears what: faces follow the decay stage, the rotted-nose faces only go to the nose-less', () => {
  const stages = new Set(), fabs = new Set();
  for (const type of TYPES) {
    for (let id = 1; id <= 300; id++) {
      const l = look.zombieLook(type, id);
      const c = look.ztexChoice(l), c2 = look.ztexChoice(look.zombieLook(type, id));
      assert.deepEqual(c, c2, 'deterministic');
      assert.equal(Math.floor(c.face / 2), look.stageOf(l.rot));
      if (c.face % 2 === 1) assert.ok(!l.opts.has('nose'), `${type} ${id}: a nose under a rotted-nose face`);
      stages.add(Math.floor(c.face / 2));
      fabs.add(c.top); fabs.add(c.bottom);
      assert.ok(look.ztexCode(l) >= 0 && look.ztexCode(l) < 6 * 11 * 11);
    }
  }
  assert.equal(stages.size, 3, 'all three stages of decay appear');
  assert.equal(fabs.size, 11, `every fabric is worn (${[...fabs].sort((a, b) => a - b)})`);
});
