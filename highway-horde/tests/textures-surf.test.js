// The world's procedural surface layers (render3d/world-surf.js) in plain Node, no GL: the layer ids
// the level art writes into its vertices must not move, the interior names must be layers of their
// own, every layer must carry real detail in both of its slices (normal / roughness / albedo, and
// hue / height), the per-layer shading tables must be sane, and the cinematic 512² generation must
// come out the same size, spread over many slices. three.js is resolved from the vendored copy.

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

let surf, tex, data, N, L;

before(async () => {
  surf = await import('../public/js/render3d/world-surf.js');
  tex = surf.makeDetailArray(1);
  data = tex.image.data;
  N = tex.image.width;
  L = surf.DET_LAYERS;
});

const INTERIOR = ['linoleum', 'carpet', 'drywall', 'ceiltile', 'wallpaper', 'terrazzo'];
// (the procedural layers; the ids past DET_LAYERS are the baked library's own surfaces, drawn here by a base layer)
const SURFACES = () => Object.keys(surf.DET).filter((k) => k !== 'none' && k !== 'macro' && surf.DET[k] < L);

/** Channel c (0..3) of slice `layer` as a Float64 statistic: mean and standard deviation. */
function stats(layer, c) {
  const base = layer * N * N * 4;
  let s = 0, s2 = 0;
  for (let i = 0; i < N * N; i++) { const v = data[base + i * 4 + c]; s += v; s2 += v * v; }
  const m = s / (N * N);
  return { mean: m, sd: Math.sqrt(Math.max(0, s2 / (N * N) - m * m)) };
}

test('layer ids: the old ones stay put, the interior names are layers of their own', () => {
  const OLD = {
    none: 0, brick: 1, concrete: 2, siding: 3, corrugated: 4, panel: 5, char: 6, wood: 7, fabric: 8, bark: 9, rubber: 10, shingle: 11,
    hesco: 12, stucco: 13, rock: 14, glass: 15, asphalt: 16, slab: 17, grass: 18, gravel: 19, rust: 20, plastic: 21, dirt: 22, macro: 23,
    plaster: 24, tile: 25, metalroof: 26, paver: 27, cracked: 28, strata: 29, crackmacro: 30, sand: 31,
  };
  for (const [k, v] of Object.entries(OLD)) assert.equal(surf.DET[k], v, k);
  const ids = new Set();
  for (const k of INTERIOR) {
    const id = surf.DET[k];
    assert.ok(Number.isInteger(id) && id >= 32 && id < L, `${k} = ${id}`);
    ids.add(id);
  }
  assert.equal(ids.size, INTERIOR.length, 'six distinct interior layers');
  assert.equal(new Set(Object.values(surf.DET)).size, Object.keys(surf.DET).length, 'no aliases left');
  assert.equal(surf.DET_COUNT, Math.max(...Object.values(surf.DET)) + 1);
  assert.equal(L, 38, 'the procedural array keeps its 38 layers');
  // every baked-only surface is drawn by a procedural layer on the procedural path
  for (let id = L; id < surf.DET_COUNT; id++) assert.ok(surf.DET_BASE[id] > 0 && surf.DET_BASE[id] < L, `base of ${surf.DET_NAMES[id]}`);
  assert.ok(Object.isFrozen(surf.DET));
});

test('tile sizes: every layer has a positive, finite repeat in world units', () => {
  assert.equal(surf.DET_TILE.length, surf.DET_COUNT);
  for (const [k, id] of Object.entries(surf.DET)) {
    const t = surf.DET_TILE[id];
    assert.ok(Number.isFinite(t) && t > 4 && t <= 400, `${k}: ${t}`);
  }
  // (the scale convention the level art relies on is unchanged for the old layers)
  assert.equal(surf.DET_TILE[surf.DET.brick], 48);
  assert.equal(surf.DET_TILE[surf.DET.asphalt], 30);
  assert.equal(surf.DET_TILE[surf.DET.slab], 128);
});

test('the array holds two slices per layer at 256²', () => {
  assert.equal(N, 256);
  assert.equal(tex.image.height, 256);
  assert.equal(tex.image.depth, L * 2);
  assert.equal(data.length, N * N * 4 * L * 2);
  assert.ok(surf.detailGenMs() > 0, 'the generation reports its time');
  const b = surf.detailGenBreakdown();
  for (const k of SURFACES()) assert.ok(Number.isFinite(b.layers[k]), `time of ${k}`);
});

test('every surface layer carries detail: normals, albedo and height vary; hue shifts stay moderate', () => {
  for (const k of SURFACES()) {
    const id = surf.DET[k];
    const nx = stats(id, 0), ny = stats(id, 1), al = stats(id, 3), ht = stats(id + L, 3);
    assert.ok(nx.sd + ny.sd > 2, `${k}: normals too flat (${nx.sd.toFixed(2)}, ${ny.sd.toFixed(2)})`);
    assert.ok(al.sd > 1.5, `${k}: albedo too flat (${al.sd.toFixed(2)})`);
    assert.ok(ht.sd > 1, `${k}: height too flat (${ht.sd.toFixed(2)})`);
    // albedo centred near neutral (the vertex colour keeps its brightness on average)
    assert.ok(Math.abs(al.mean - 128) < 40, `${k}: albedo mean ${al.mean.toFixed(1)}`);
    // hue shifts around neutral: no layer tints its whole surface
    for (const c of [0, 1]) {
      const h = stats(id + L, c);
      assert.ok(Math.abs(h.mean - 128) < 24, `${k}: hue channel ${c} mean ${h.mean.toFixed(1)}`);
    }
  }
});

test('the interior layers differ from each other and from the layers they used to alias', () => {
  const slice = (id) => data.subarray(id * N * N * 4, (id + 1) * N * N * 4);
  const diff = (a, b) => {
    const A = slice(a), B = slice(b);
    let d = 0;
    for (let i = 0; i < A.length; i += 7) d += Math.abs(A[i] - B[i]);
    return d / (A.length / 7);
  };
  const OLD_ALIAS = { linoleum: 'tile', carpet: 'fabric', drywall: 'plaster', ceiltile: 'plaster', wallpaper: 'plaster', terrazzo: 'tile' };
  for (const k of INTERIOR) {
    assert.ok(diff(surf.DET[k], surf.DET[OLD_ALIAS[k]]) > 3, `${k} is not its old alias`);
    for (const j of INTERIOR) if (j !== k) assert.ok(diff(surf.DET[k], surf.DET[j]) > 2, `${k} vs ${j}`);
  }
});

test('shading tables: parallax depth, grain, the mip variance and the weathering class', () => {
  const P = surf.DET_PARAMS;
  assert.equal(P.length, surf.DET_COUNT * 4);
  for (const [k, id] of Object.entries(surf.DET)) {
    const depth = P[id * 4], grain = P[id * 4 + 1], variance = P[id * 4 + 2], cls = P[id * 4 + 3];
    assert.ok(depth >= 0 && depth < 0.05, `${k}: parallax depth ${depth} (texture units)`);
    assert.ok(grain >= 0 && grain <= 1, `${k}: grain ${grain}`);
    assert.ok(Number.isFinite(variance) && variance >= 0 && variance < 1, `${k}: variance ${variance}`);
    assert.ok(Number.isInteger(cls) && cls >= 0 && cls <= 6, `${k}: class ${cls}`);
  }
  // relief layers have parallax, flat ones none; the interiors are class 6; the variance was filled in
  for (const k of ['brick', 'shingle', 'tile', 'gravel', 'rock']) assert.ok(P[surf.DET[k] * 4] > 0, k);
  for (const k of ['panel', 'glass', 'macro', 'none']) assert.equal(P[surf.DET[k] * 4], 0, k);
  for (const k of INTERIOR) assert.equal(P[surf.DET[k] * 4 + 3], 6, k);
  assert.ok(P[surf.DET.brick * 4 + 2] > 0.01, 'brick loses normal detail in its mips');
  // element grids: bricks in a running bond, slabs one per tile
  const G = surf.DET_CELLS;
  assert.deepEqual([...G.subarray(surf.DET.brick * 4, surf.DET.brick * 4 + 3)], [5, 16, 0.5]);
  assert.equal(G[surf.DET.slab * 4], 1);
  for (let i = 0; i < surf.DET_COUNT; i++) if (G[i * 4 + 3] > 0) assert.ok(G[i * 4] >= 1 && G[i * 4 + 1] >= 1, `layer ${i} cells`);
});

test('tile breaking: each layer\'s shift maps its elements onto themselves', () => {
  const S = surf.DET_SHIFT, G = surf.DET_CELLS;
  assert.equal(S.length, surf.DET_COUNT * 2);
  const whole = (v) => Math.abs(v - Math.round(v)) < 1e-4;
  for (const [k, id] of Object.entries(surf.DET)) {
    const su = S[id * 2], sv = S[id * 2 + 1];
    assert.ok(su >= 0 && su < 1 && sv >= 0 && sv < 1, `${k}: shift within a tile`);
    const [cu, cv, stagger, tone] = G.subarray(id * 4, id * 4 + 4);
    if (tone > 0) {
      // whole elements across and up (a layer of full-height elements, the standing-seam roof's panels,
      // has no course to keep); an even number of courses where odd courses are offset
      assert.ok(whole(su * cu) && (cv === 1 && k !== 'slab' && k !== 'terrazzo' || whole(sv * cv)), `${k}: shift (${su}, ${sv}) in whole ${cu} x ${cv} cells`);
      if (stagger) assert.ok(Math.round(sv * cv) % 2 === 0, `${k}: an even number of courses`);
    }
  }
  // most layers are broken up; one-element tiles, seams and the raw fields never are
  for (const k of ['brick', 'siding', 'plaster', 'concrete', 'wood', 'drywall', 'wallpaper']) assert.ok(S[surf.DET[k] * 2] + S[surf.DET[k] * 2 + 1] > 0, k);
  for (const k of ['none', 'slab', 'terrazzo', 'linoleum', 'macro', 'crackmacro', 'glass']) assert.equal(S[surf.DET[k] * 2] + S[surf.DET[k] * 2 + 1], 0, k);
});

test('the macro layer holds raw fields in both slices', () => {
  const m = surf.DET.macro;
  for (const c of [0, 1, 2, 3]) assert.ok(stats(m, c).sd > 5, `macro channel ${c}`);
  for (const c of [0, 1, 2, 3]) assert.ok(stats(m + L, c).sd > 2, `macro grain channel ${c}`);
});

test('cinematic: the 512² layers come out the same shape, generated in many slices', async () => {
  const hi = await surf.makeDetailArrayAsync(1);
  assert.equal(hi.image.width, 512);
  assert.equal(hi.image.depth, tex.image.depth);
  const b = surf.detailGenBreakdown();
  assert.ok(b.slices512 > 40, `spread over ${b.slices512} slices`);
  // the same content at twice the resolution: the layers' mean albedo agrees with the 256² ones
  const d = hi.image.data, n = 512;
  for (const k of ['brick', 'asphalt', 'terrazzo']) {
    const id = surf.DET[k];
    let s = 0;
    for (let i = 0; i < n * n; i += 13) s += d[id * n * n * 4 + i * 4 + 3];
    const mean = s / Math.ceil(n * n / 13);
    assert.ok(Math.abs(mean - stats(id, 3).mean) < 8, `${k}: ${mean.toFixed(1)} vs ${stats(id, 3).mean.toFixed(1)}`);
  }
  // a second call reuses the generated texels
  const again = await surf.makeDetailArrayAsync(1);
  assert.equal(again.image.data, hi.image.data);
});
