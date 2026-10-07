// The gun material families (shared/gun-finish.js GUN_FAMILIES) and the shared ageing overlay,
// drawn as tileable fields. A recipe(n, rng, seed) returns
//   { albedo: [r, g, b] linear fields, height (in texels of a 2048² bake), rough, metal, ao? (extra
//     occlusion, multiplied into the cavity AO), aoK (cavity strength), aoR (cavity radius, px at 2048) }
// The bake turns height into the normal map and the cavity AO (bake-guns.js).
//
// Scale: a family tiles every `tile` gun units (≈ 22 units = 66 cm per 2048 px, ~0.3 mm a texel),
// so crystal grain is a texel or two, stipple a few, checkering diamonds ~20 px.

import { fbm, worley, blur, copy, make, map, normalize, stroke, polyStroke, disc, lin, clamp01, lerp, smooth, hash3 } from './field.js';

const S = (n) => n / 2048;          // pixels at 2048 → pixels at n

function fill(n, v) { return new Float32Array(n * n).fill(v); }
function rgbFields(n) { return [new Float32Array(n * n), new Float32Array(n * n), new Float32Array(n * n)]; }

/** albedo = base colour (linear) × k(i) per pixel, with an optional second colour mixed by t(i). */
function paintAlbedo(n, base, k, alt = null, t = null) {
  const A = rgbFields(n);
  for (let i = 0; i < n * n; i++) {
    const kk = k ? k[i] : 1;
    let r = base[0], g = base[1], b = base[2];
    if (alt && t) { const m = clamp01(t[i]); r = lerp(r, alt[0], m); g = lerp(g, alt[1], m); b = lerp(b, alt[2], m); }
    A[0][i] = r * kk; A[1][i] = g * kk; A[2][i] = b * kk;
  }
  return A;
}

/**
 * Fine scratches into `f` (max blend): count strokes, lengths and widths in px at 2048, mostly
 * along `dir` (radians) within `spread`; slightly bent. Returns f.
 */
export function scratches(f, n, rng, count, o = {}) {
  const s = S(n);
  const lenA = (o.len ? o.len[0] : 30) * s, lenB = (o.len ? o.len[1] : 260) * s;
  const wA = o.width ? o.width[0] : 0.7, wB = o.width ? o.width[1] : 1.8;
  const dir = o.dir ?? 0, spread = o.spread ?? Math.PI;
  for (let k = 0; k < count; k++) {
    const x = rng() * n, y = rng() * n;
    const a = dir + (rng() - 0.5) * 2 * spread;
    const L = lenA + (lenB - lenA) * Math.pow(rng(), 2);
    const bend = (rng() - 0.5) * 0.25;
    const pts = [];
    for (let j = 0; j <= 4; j++) {
      const t = j / 4, aa = a + bend * (t - 0.5) * 2;
      pts.push([x + Math.cos(aa) * L * t, y + Math.sin(aa) * L * t]);
    }
    const w = Math.max(0.6, (wA + (wB - wA) * rng()) * Math.max(0.5, s * 1.5));
    const depth = (o.depth ?? 1) * (0.35 + rng() * 0.65);
    polyStroke(f, n, pts, (t) => w * (0.4 + 0.6 * Math.sin(Math.PI * Math.min(1, t * 1.05))), (ff, idx, cov, t) => {
      const v = cov * depth * Math.sin(Math.PI * t) ** 0.35;
      if (v > ff[idx]) ff[idx] = v;
    });
  }
  return f;
}

/** Diamond (pyramid) pattern: lines along two integer lattice directions → tileable. 1 at tips, 0 in grooves. */
function diamonds(n, p1, q1, p2, q2, sharp = 1) {
  return make(n, (i, x, y) => {
    const u = x / n, v = y / n;
    const a = u * p1 + v * q1, b = u * p2 - v * q2;
    const fa = a - Math.floor(a), fb = b - Math.floor(b);
    const ta = 1 - Math.abs(fa - 0.5) * 2, tb = 1 - Math.abs(fb - 0.5) * 2;
    return Math.pow(Math.min(ta, tb), sharp);
  });
}

/** Crystalline grain of a phosphate coating: per-crystal brightness, slight relief at the boundaries. */
function crystals(n, cells, seed) {
  const w = worley(n, cells, seed, 1);
  const edge = new Float32Array(n * n), tone = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    edge[i] = smooth(0, 0.22, w.f2[i] - w.f1[i]);          // 0 on the crystal boundary
    tone[i] = w.id[i];
  }
  return { edge, tone, f1: w.f1 };
}

// ---------------------------------------------------------------------------------------
// metals

function phosphateRecipe(n, rng, seed, o) {
  const cr = crystals(n, o.cells, seed);
  const fine = crystals(n, Math.round(o.cells * 1.4), seed + 9);
  const mott = fbm(n, { cells: 3, oct: 4, seed: seed + 1, warp: 1.2 });
  const mid = fbm(n, { cells: 24, oct: 3, seed: seed + 2 });
  const scr = scratches(fill(n, 0), n, rng, Math.round(o.scratches * S(n) * S(n) * 4) + 8, { len: [20, 180], width: [0.6, 1.2], depth: 0.7 });
  const k = new Float32Array(n * n), height = new Float32Array(n * n), rough = new Float32Array(n * n), t = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const tone = cr.tone[i] * 0.6 + fine.tone[i] * 0.4;
    k[i] = (0.82 + tone * o.contrast + mott[i] * 0.09 + mid[i] * 0.04) * (1 - (1 - cr.edge[i]) * 0.18) * (1 + scr[i] * 0.35);
    t[i] = clamp01(0.5 + mott[i] * 0.9);
    height[i] = cr.edge[i] * 0.9 + fine.edge[i] * 0.45 + tone * 0.35 - scr[i] * 1.2;
    // matte, a few crystals catching the light (lower roughness), scratches burnished smoother
    rough[i] = clamp01(o.rough + (0.5 - tone) * 0.12 + mott[i] * 0.06 - (tone > 0.93 ? 0.18 : 0) - scr[i] * 0.22);
  }
  return {
    albedo: paintAlbedo(n, lin(o.base), k, lin(o.alt), t),
    height, rough, metal: fill(n, o.metal), grain: true, aoK: 0.9, aoR: 3,
  };
}

function bluedRecipe(n, rng, seed) {
  // polished steel under a blue-black oxide: long polishing lines along the gun, colour drifting
  // from blue-black to plum and brown where the bluing took unevenly, fine hairline scratches
  const polish = fbm(n, { cells: 8, oct: 5, seed: seed + 1, aniso: [1, 48] });
  const tone = fbm(n, { cells: 2, oct: 4, seed: seed + 2, warp: 1.5 });
  const plum = fbm(n, { cells: 5, oct: 3, seed: seed + 3 });
  const pits = worley(n, 220, seed + 4, 1);
  const scr = scratches(fill(n, 0), n, rng, Math.round(900 * S(n) * S(n)) + 10, { len: [40, 420], width: [0.5, 1.0], dir: 0, spread: 0.35, depth: 0.8 });
  const scr2 = scratches(fill(n, 0), n, rng, Math.round(160 * S(n) * S(n)) + 4, { len: [10, 80], width: [0.6, 1.4], depth: 0.6 });
  const base = lin('#1b2230'), alt = lin('#2a1f2a'), brown = lin('#2d241c');
  const A = rgbFields(n), height = new Float32Array(n * n), rough = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const p = clamp01(0.5 + plum[i] * 1.2), b = clamp01(0.5 + tone[i] * 1.4);
    const k = 0.85 + polish[i] * 0.12 + tone[i] * 0.12;
    const s = Math.max(scr[i], scr2[i]);
    const pit = pits.f1[i] < 0.08 ? 1 - pits.f1[i] / 0.08 : 0;
    for (let c = 0; c < 3; c++) {
      let v = lerp(base[c], alt[c], smooth(0.55, 0.9, p) * 0.7);
      v = lerp(v, brown[c], smooth(0.62, 0.95, b) * 0.45);
      A[c][i] = v * k * (1 + s * 1.6) * (1 - pit * 0.4);
    }
    height[i] = polish[i] * 0.5 - s * 1.0 - pit * 0.8;
    rough[i] = clamp01(0.24 + polish[i] * 0.05 + (0.5 - p) * 0.03 + s * 0.08 + pit * 0.3);
  }
  return { albedo: A, height, rough, metal: fill(n, 0.92), aoK: 1, aoR: 2 };
}

function anodRecipe(n, rng, seed, o) {
  // bead-blasted aluminium under a dyed anodic layer: a fine even grain, faint machining rings
  // (end-mill passes), the dye a little uneven, a few handling marks
  const grain = fbm(n, { cells: 256, oct: 1, seed: seed + 1 });
  const grain2 = fbm(n, { cells: 120, oct: 2, seed: seed + 2 });
  const dye = fbm(n, { cells: 3, oct: 4, seed: seed + 3, warp: 1 });
  const mill = fbm(n, { cells: 6, oct: 2, seed: seed + 4, aniso: [1, 30] });
  const scr = scratches(fill(n, 0), n, rng, Math.round(90 * S(n) * S(n)) + 4, { len: [15, 120], width: [0.6, 1.1], depth: 0.45 });
  const k = new Float32Array(n * n), height = new Float32Array(n * n), rough = new Float32Array(n * n), t = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const g = grain[i] * 0.6 + grain2[i] * 0.4;
    k[i] = (0.9 + g * 0.1 + dye[i] * o.dye + Math.sin(mill[i] * 9) * 0.015) * (1 + scr[i] * o.scratchLift);
    t[i] = clamp01(scr[i] * 1.5);
    height[i] = g * 0.7 + mill[i] * 0.15 - scr[i] * 0.9;
    rough[i] = clamp01(o.rough + g * 0.08 + dye[i] * 0.04 - scr[i] * 0.15);
  }
  return { albedo: paintAlbedo(n, lin(o.base), k, lin('#8c8f93'), t), height, rough, metal: map(fill(n, o.metal), (v, i) => lerp(v, 0.95, clamp01(scr[i] * 1.5))), grain: true, aoK: 0.8, aoR: 2 };
}

function stainlessRecipe(n, rng, seed) {
  const grain = fbm(n, { cells: 300, oct: 1, seed: seed + 1 });
  const grain2 = fbm(n, { cells: 140, oct: 2, seed: seed + 2 });
  const cloud = fbm(n, { cells: 4, oct: 4, seed: seed + 3 });
  const scr = scratches(fill(n, 0), n, rng, Math.round(500 * S(n) * S(n)) + 8, { len: [20, 260], width: [0.5, 1.2], depth: 0.8 });
  const k = new Float32Array(n * n), height = new Float32Array(n * n), rough = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const g = grain[i] * 0.55 + grain2[i] * 0.45;
    k[i] = 0.92 + g * 0.08 + cloud[i] * 0.06 + scr[i] * 0.08;
    height[i] = g * 0.8 - scr[i] * 0.8;
    rough[i] = clamp01(0.36 + g * 0.09 + cloud[i] * 0.05 - scr[i] * 0.14);
  }
  return { albedo: paintAlbedo(n, lin('#8e9093'), k), height, rough, metal: fill(n, 1), grain: true, aoK: 0.6, aoR: 2 };
}

function brushedRecipe(n, rng, seed) {
  // straight brushing along the gun: streaks at many scales, stretched ~60:1
  const b1 = fbm(n, { cells: 6, oct: 5, seed: seed + 1, aniso: [1, 64] });
  const b2 = fbm(n, { cells: 32, oct: 3, seed: seed + 2, aniso: [1, 24] });
  const cloud = fbm(n, { cells: 3, oct: 3, seed: seed + 3 });
  const scr = scratches(fill(n, 0), n, rng, Math.round(400 * S(n) * S(n)) + 6, { len: [30, 300], width: [0.5, 1.0], depth: 0.6 });
  const k = new Float32Array(n * n), height = new Float32Array(n * n), rough = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const b = b1[i] * 0.6 + b2[i] * 0.4;
    k[i] = 0.9 + b * 0.16 + cloud[i] * 0.05;
    height[i] = b * 1.1 - scr[i] * 0.7;
    rough[i] = clamp01(0.3 + b * 0.12 + cloud[i] * 0.04 - scr[i] * 0.1);
  }
  return { albedo: paintAlbedo(n, lin('#8b8d90'), k), height, rough, metal: fill(n, 1), aoK: 0.5, aoR: 2 };
}

function sightRecipe(n, rng, seed) {
  // blackened steel with anti-glare serrations running across (fine grooves), machining lines
  const ser = make(n, (i, x, y) => { const v = (y / n) * 160; const f = v - Math.floor(v); return Math.min(f, 1 - f) * 2; });
  const grain = fbm(n, { cells: 200, oct: 1, seed: seed + 1 });
  const cloud = fbm(n, { cells: 3, oct: 3, seed: seed + 2 });
  const k = new Float32Array(n * n), height = new Float32Array(n * n), rough = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    k[i] = 0.85 + grain[i] * 0.1 + cloud[i] * 0.08 + ser[i] * 0.1;
    height[i] = ser[i] * 2.2 + grain[i] * 0.4;
    rough[i] = clamp01(0.55 + grain[i] * 0.08 - ser[i] * 0.1);
  }
  return { albedo: paintAlbedo(n, lin('#1c1d20'), k), height, rough, metal: fill(n, 0.7), aoK: 1.4, aoR: 3 };
}

function brassRecipe(n, rng, seed) {
  const tarn = fbm(n, { cells: 4, oct: 5, seed: seed + 1, warp: 1.5 });
  const spots = worley(n, 40, seed + 2, 1);
  const grain = fbm(n, { cells: 200, oct: 1, seed: seed + 3 });
  const scr = scratches(fill(n, 0), n, rng, Math.round(500 * S(n) * S(n)) + 6, { len: [20, 200], width: [0.5, 1.2], depth: 0.7 });
  const base = lin('#c9a24a'), dark = lin('#6a4e22'), green = lin('#5e6a3c');
  const A = rgbFields(n), height = new Float32Array(n * n), rough = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const t = smooth(0.05, 0.6, tarn[i]);
    const sp = spots.f1[i] < 0.18 ? (1 - spots.f1[i] / 0.18) * 0.5 : 0;
    const s = scr[i];
    for (let c = 0; c < 3; c++) {
      let v = lerp(base[c], dark[c], t * 0.55);
      v = lerp(v, green[c], sp * 0.5);
      A[c][i] = lerp(v * (0.94 + grain[i] * 0.08), base[c] * 1.08, s * 0.8);
    }
    height[i] = grain[i] * 0.5 - s * 0.8 + sp * 0.4;
    rough[i] = clamp01(0.24 + t * 0.3 + sp * 0.25 + grain[i] * 0.04 - s * 0.12);
  }
  return { albedo: A, height, rough, metal: fill(n, 1), aoK: 0.6, aoR: 2 };
}

function knurlRecipe(n, rng, seed) {
  // straight diamond knurl (30°): sharp pyramids, the tips polished bright by hands
  const d = diamonds(n, 40, 24, 40, 24, 1.4);
  const grain = fbm(n, { cells: 200, oct: 2, seed: seed + 1 });
  const cloud = fbm(n, { cells: 3, oct: 3, seed: seed + 2 });
  const k = new Float32Array(n * n), height = new Float32Array(n * n), rough = new Float32Array(n * n), t = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const tip = smooth(0.72, 0.98, d[i]) * clamp01(0.6 + cloud[i]);
    k[i] = 0.75 + d[i] * 0.3 + grain[i] * 0.06;
    t[i] = tip * 0.8;
    height[i] = d[i] * 9 * S(2048) + grain[i] * 0.3;
    rough[i] = clamp01(0.48 - tip * 0.26 + grain[i] * 0.05 + (1 - d[i]) * 0.12);
  }
  return { albedo: paintAlbedo(n, lin('#2a2c2e'), k, lin('#9a9ca0'), t), height, rough, metal: map(fill(n, 0.75), (v, i) => lerp(v, 1, t[i])), aoK: 1.6, aoR: 6 };
}

// ---------------------------------------------------------------------------------------
// polymers

/** Fine sand-blast stipple of moulded polymer: dense small bumps (worley), a mould-flow swirl. */
function stipple(n, seed, cells = 300) {
  const w = worley(n, cells, seed, 1);
  const w2 = worley(n, Math.round(cells * 1.45), seed + 1, 1);
  const flow = fbm(n, { cells: 3, oct: 4, seed: seed + 2, warp: 2 });
  const h = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const b1 = clamp01(1 - w.f1[i] * w.f1[i] * 2.2), b2 = clamp01(1 - w2.f1[i] * w2.f1[i] * 2.2);
    h[i] = b1 * 0.65 + b2 * 0.35;
  }
  return { h, flow, tone: w.id };
}

function polyRecipe(n, rng, seed, o) {
  const st = stipple(n, seed);
  const mott = fbm(n, { cells: 5, oct: 3, seed: seed + 5 });
  const scuff = scratches(fill(n, 0), n, rng, Math.round(140 * S(n) * S(n)) + 4, { len: [20, 140], width: [1, 2.5], depth: 0.8 });
  const k = new Float32Array(n * n), height = new Float32Array(n * n), rough = new Float32Array(n * n), t = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    k[i] = 0.9 + st.h[i] * 0.12 + st.flow[i] * 0.05 + mott[i] * 0.04 + (st.tone[i] - 0.5) * 0.05;
    t[i] = scuff[i] * 0.45;
    height[i] = st.h[i] * 1.6 + st.flow[i] * 0.4 - scuff[i] * 1.0;
    // stipple peaks are worn a little smoother; scuffs are matte and pale
    rough[i] = clamp01(o.rough - st.h[i] * 0.08 + st.flow[i] * 0.05 + scuff[i] * 0.12);
  }
  return { albedo: paintAlbedo(n, lin(o.base), k, lin(o.scuff), t), height, rough, metal: fill(n, 0), grain: true, aoK: 1.2, aoR: 3 };
}

function polyGripRecipe(n, rng, seed) {
  // the grip zone of a modern polymer frame: a field of small square pyramids (rotated 45°)
  // under an aggressive stipple, neutral grey (the part's colour tints it)
  const d = diamonds(n, 96, 96, 96, 96, 0.8);
  const st = stipple(n, seed, 300);
  const k = new Float32Array(n * n), height = new Float32Array(n * n), rough = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    k[i] = 0.82 + d[i] * 0.22 + st.h[i] * 0.06;
    height[i] = d[i] * 5 + st.h[i] * 1.4;
    rough[i] = clamp01(0.78 - d[i] * 0.12 + st.h[i] * 0.04);
  }
  return { albedo: paintAlbedo(n, lin('#808080'), k), height, rough, metal: fill(n, 0), grain: true, aoK: 1.4, aoR: 6 };
}

function rubberRecipe(n, rng, seed) {
  // pebbled moulded rubber: rounded pebbles of a few sizes, a dusty bloom in the gaps
  const w = worley(n, 140, seed, 0.95);
  const w2 = worley(n, 240, seed + 1, 1);
  const dust = fbm(n, { cells: 6, oct: 3, seed: seed + 2 });
  const k = new Float32Array(n * n), height = new Float32Array(n * n), rough = new Float32Array(n * n), t = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const p = clamp01(1 - Math.pow(w.f1[i] / Math.max(0.05, w.f2[i]), 2) * 1.2);
    const q = clamp01(1 - w2.f1[i] * w2.f1[i] * 2);
    const gap = 1 - smooth(0, 0.25, w.f2[i] - w.f1[i]);
    k[i] = 0.85 + p * 0.15 + (w.id[i] - 0.5) * 0.08;
    t[i] = clamp01(gap * (0.4 + dust[i])) * 0.5;
    height[i] = Math.sqrt(p) * 3.2 + q * 0.6;
    rough[i] = clamp01(0.8 + gap * 0.1 - p * 0.12);
  }
  return { albedo: paintAlbedo(n, lin('#1b1b1b'), k, lin('#4a4844'), t), height, rough, metal: fill(n, 0), grain: true, aoK: 1.3, aoR: 5 };
}

function checkerRecipe(n, rng, seed) {
  // hand-cut checkering (wood grips, forends): sharp diamonds ~ 20 lines per inch, a few
  // run-over cuts, oil darkening the grooves; neutral (multiplies the wood or polymer under it)
  const d = diamonds(n, 64, 40, 64, 40, 1.1);
  const wob = fbm(n, { cells: 8, oct: 3, seed: seed + 1 });
  const k = new Float32Array(n * n), height = new Float32Array(n * n), rough = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const dd = clamp01(d[i] + wob[i] * 0.06);
    k[i] = 0.62 + dd * 0.48;
    height[i] = dd * 7;
    rough[i] = clamp01(0.62 - dd * 0.2);
  }
  return { albedo: paintAlbedo(n, lin('#808080'), k), height, rough, metal: fill(n, 0), aoK: 1.6, aoR: 6 };
}

function cerakoteRecipe(n, rng, seed) {
  // sprayed ceramic coating: a soft orange-peel, faint overspray speckle, satin
  const peel = fbm(n, { cells: 90, oct: 3, seed: seed + 1 });
  const speck = worley(n, 300, seed + 2, 1);
  const cloud = fbm(n, { cells: 3, oct: 3, seed: seed + 3 });
  const k = new Float32Array(n * n), height = new Float32Array(n * n), rough = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const sp = speck.f1[i] < 0.12 ? 0.04 * (speck.id[i] - 0.5) : 0;
    k[i] = 0.97 + peel[i] * 0.04 + cloud[i] * 0.03 + sp;
    height[i] = peel[i] * 1.1;
    rough[i] = clamp01(0.5 + peel[i] * 0.05 + cloud[i] * 0.04);
  }
  return { albedo: paintAlbedo(n, lin('#808080'), k), height, rough, metal: fill(n, 0), grain: true, aoK: 0.5, aoR: 3 };
}

function paintRecipe(n, rng, seed) {
  // enamel over steel: orange-peel gloss, a few chips to primer and bare steel
  const peel = fbm(n, { cells: 60, oct: 3, seed: seed + 1 });
  const chipN = fbm(n, { cells: 10, oct: 5, seed: seed + 2, warp: 1 });
  const cloud = fbm(n, { cells: 3, oct: 3, seed: seed + 3 });
  const A = rgbFields(n), height = new Float32Array(n * n), rough = new Float32Array(n * n), metal = new Float32Array(n * n);
  const grey = 0.216, primer = lin('#7a6a58'), steel = lin('#7f8285');
  for (let i = 0; i < n * n; i++) {
    const chip = smooth(0.52, 0.56, chipN[i]), bare = smooth(0.6, 0.64, chipN[i]);
    const kk = 0.97 + peel[i] * 0.04 + cloud[i] * 0.04;
    for (let c = 0; c < 3; c++) {
      let v = grey * kk;
      v = lerp(v, primer[c], chip);
      v = lerp(v, steel[c], bare);
      A[c][i] = v;
    }
    height[i] = peel[i] * 0.9 - chip * 1.2 - bare * 0.6;
    rough[i] = clamp01(lerp(lerp(0.32 + peel[i] * 0.05, 0.75, chip), 0.35, bare));
    metal[i] = bare;
  }
  return { albedo: A, height, rough, metal, aoK: 0.8, aoR: 3 };
}

// ---------------------------------------------------------------------------------------
// wood

function woodRecipe(n, rng, seed, o) {
  // a quarter-sawn board with the grain along u: many fine growth lines, gently waving (a slow
  // warp), bunched into darker streaks; open pores as short dark dashes along the grain; ray
  // flecks; mineral streaks; an oil-and-lacquer finish rubbed matte in patches
  const warp = fbm(n, { cells: 2, oct: 4, seed: seed + 1, aniso: [1, 2] });
  const warp2 = fbm(n, { cells: 8, oct: 3, seed: seed + 2, aniso: [1, 6] });
  const dens = fbm(n, { cells: 4, oct: 4, seed: seed + 7, aniso: [1, 10] });
  const pores = fbm(n, { cells: 24, oct: 2, seed: seed + 3, aniso: [1, 40] });
  const fleck = worley(n, 90, seed + 4, 1);
  const lacq = fbm(n, { cells: 4, oct: 4, seed: seed + 5 });
  const streak = fbm(n, { cells: 3, oct: 4, seed: seed + 6, aniso: [1, 12] });
  const dark = lin(o.dark), light = lin(o.light), ring = lin(o.ring);
  const A = rgbFields(n), height = new Float32Array(n * n), rough = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const v = y / n;
      const t = v * o.rings + warp[i] * o.warp + warp2[i] * o.warp * 0.12;
      const f = t - Math.floor(t);
      // late wood (a thin dark line) sharp on one side, fading into the early wood; rings bunch
      // closer and darker where `dens` is high
      const late = (Math.pow(1 - f, o.sharp) * smooth(0, 0.06, f) + smooth(0.97, 1, f)) * (0.55 + 0.45 * smooth(-0.3, 0.4, dens[i]));
      const pore = smooth(0.3, 0.6, pores[i]) * (0.45 + late * 0.55);
      const fl = fleck.f1[i] < 0.05 ? 1 - fleck.f1[i] / 0.05 : 0;
      const st = smooth(-0.15, 0.45, streak[i]);
      for (let c = 0; c < 3; c++) {
        let val = lerp(light[c], dark[c], st * 0.75 + smooth(0, 0.6, dens[i]) * 0.2);
        val = lerp(val, ring[c], late * o.ringK);
        val *= 1 - pore * 0.3;
        val = lerp(val, light[c] * 1.12, fl * 0.3 * o.fleck);
        A[c][i] = val;
      }
      height[i] = -pore * 1.1 - late * 0.3 + fl * 0.15;
      // lacquer: glossy where intact, matte where rubbed through (and in the open pores)
      const worn = smooth(0.1, 0.5, lacq[i]);
      rough[i] = clamp01(o.gloss + worn * 0.32 + pore * 0.2);
    }
  }
  return { albedo: A, height, rough, metal: fill(n, 0), aoK: 0.7, aoR: 2 };
}

// ---------------------------------------------------------------------------------------
// the registry

export const FAMILY_RECIPES = {
  parkerized: (n, r, s) => phosphateRecipe(n, r, s, { cells: 300, base: '#2a2b2c', alt: '#2c2e2a', contrast: 0.26, rough: 0.66, metal: 0.55, scratches: 380 }),
  phosphate: (n, r, s) => phosphateRecipe(n, r, s, { cells: 240, base: '#3a3c36', alt: '#33382f', contrast: 0.32, rough: 0.6, metal: 0.5, scratches: 460 }),
  blued: bluedRecipe,
  anod_black: (n, r, s) => anodRecipe(n, r, s, { base: '#1d1e20', dye: 0.05, rough: 0.46, metal: 0.45, scratchLift: 1.2 }),
  anod_tan: (n, r, s) => anodRecipe(n, r, s, { base: '#8b7756', dye: 0.06, rough: 0.5, metal: 0.3, scratchLift: 0.25 }),
  anod_od: (n, r, s) => anodRecipe(n, r, s, { base: '#3b3f2d', dye: 0.06, rough: 0.5, metal: 0.35, scratchLift: 0.9 }),
  stainless: stainlessRecipe,
  brushed: brushedRecipe,
  poly_black: (n, r, s) => polyRecipe(n, r, s, { base: '#1c1c1d', scuff: '#5a5a58', rough: 0.66 }),
  poly_fde: (n, r, s) => polyRecipe(n, r, s, { base: '#8a7451', scuff: '#c4b08a', rough: 0.7 }),
  poly_od: (n, r, s) => polyRecipe(n, r, s, { base: '#4a4f3a', scuff: '#8a8e78', rough: 0.68 }),
  poly_grip: polyGripRecipe,
  walnut: (n, r, s) => woodRecipe(n, r, s, { dark: '#24140b', light: '#6a4428', ring: '#1a0e08', rings: 120, warp: 3.2, sharp: 5, ringK: 0.5, fleck: 0.3, gloss: 0.3 }),
  birch: (n, r, s) => woodRecipe(n, r, s, { dark: '#94744c', light: '#c4a070', ring: '#7a5a3a', rings: 90, warp: 1.8, sharp: 4, ringK: 0.32, fleck: 1, gloss: 0.34 }),
  rubber: rubberRecipe,
  checker: checkerRecipe,
  knurl: knurlRecipe,
  cerakote: cerakoteRecipe,
  brass: brassRecipe,
  paint: paintRecipe,
  sight: sightRecipe,
};

// ---------------------------------------------------------------------------------------
// the ageing overlay: R scratches, G edge-chip breakup, B fingerprints / smudges, A grime

function fingerprint(f, n, rng, cx, cy, r) {
  // concentric elliptical ridges (a loop pattern) broken by noise, fading at the rim
  const a = rng() * Math.PI, e = 0.65 + rng() * 0.2, ridge = r / (9 + rng() * 4);
  const ph = rng() * 10, ca = Math.cos(a), sa = Math.sin(a);
  disc(f, n, cx, cy, r, (ff, idx, d, dx, dy) => {
    const lx = dx * ca + dy * sa, ly = (-dx * sa + dy * ca) / e;
    const rr = Math.sqrt(lx * lx + ly * ly) + Math.sin(Math.atan2(ly, lx) * 2 + ph) * ridge * 0.6;
    const ri = 0.5 + 0.5 * Math.cos((rr / ridge) * Math.PI * 2);
    const brk = hash3(Math.floor(lx / 3), Math.floor(ly / 3), 77) > 0.12 ? 1 : 0;
    const v = Math.pow(ri, 3) * (1 - d * d) * brk * 0.9;
    if (v > ff[idx]) ff[idx] = v;
  });
}

export function wearRecipe(n, rng, seed) {
  const s = S(n);
  const R = scratches(fill(n, 0), n, rng, Math.round(2600 * s * s) + 20, { len: [15, 340], width: [0.6, 1.6], depth: 1 });
  scratches(R, n, rng, Math.round(500 * s * s) + 6, { len: [8, 50], width: [1, 2.5], depth: 0.8 });
  // chip breakup: blotches at a few scales (the shader thresholds it against the edge wear)
  const g1 = fbm(n, { cells: 12, oct: 5, seed: seed + 1, warp: 1.2 });
  const g2 = fbm(n, { cells: 48, oct: 3, seed: seed + 2 });
  const G = make(n, (i) => clamp01(0.5 + g1[i] * 0.7 + g2[i] * 0.35));
  // fingerprints and smudges
  const B = fill(n, 0);
  for (let k = 0; k < 18; k++) fingerprint(B, n, rng, rng() * n, rng() * n, (34 + rng() * 26) * s * 2);
  const smudge = fbm(n, { cells: 5, oct: 4, seed: seed + 3, warp: 2 });
  for (let i = 0; i < n * n; i++) B[i] = Math.max(B[i], smooth(0.25, 0.7, smudge[i]) * 0.45);
  // grime: cloudy dirt with speckle (carbon, dust)
  const a1 = fbm(n, { cells: 6, oct: 6, seed: seed + 4, warp: 1.5 });
  const sp = worley(n, 400, seed + 5, 1);
  const A = make(n, (i) => clamp01(0.45 + a1[i] * 0.8 + (sp.f1[i] < 0.15 ? (sp.id[i] - 0.3) * 0.5 : 0)));
  return { R, G, B, A };
}
