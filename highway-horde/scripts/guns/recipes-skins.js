// Gun skin patterns (shared/gun-finish.js SKIN_PATTERNS), tileable, 1024². A recipe(n, rng, seed)
// returns { albedo: [r, g, b] linear, cover (0..1: where the finish is; the alpha of the albedo
// PNG), height (texels of a 1024² bake), rough, metal }. Where cover is 0 the gun's own material
// shows (the blood and grime of the zombie-hunter skin, chips in the hazard paint).

import { fbm, map, polyStroke, disc, lin, clamp01, lerp, smooth, hash3 } from './field.js';

const S = (n) => n / 1024;
const fill = (n, v) => new Float32Array(n * n).fill(v);
const rgb = (n) => [new Float32Array(n * n), new Float32Array(n * n), new Float32Array(n * n)];

/** Paint layers by thresholds: cols = [[hex, field, threshold], ...] painted in order over `base`. */
function layered(n, base, layers, o = {}) {
  const A = rgb(n), height = new Float32Array(n * n), rough = new Float32Array(n * n);
  const b = lin(base);
  const cols = layers.map((l) => lin(l[0]));
  const grain = fbm(n, { cells: 200, oct: 2, seed: 991 });
  for (let i = 0; i < n * n; i++) {
    let c0 = b[0], c1 = b[1], c2 = b[2], h = 0;
    for (let k = 0; k < layers.length; k++) {
      const [, f, th, soft = 0.012] = layers[k];
      const m = smooth(th - soft, th + soft, f[i]);
      c0 = lerp(c0, cols[k][0], m); c1 = lerp(c1, cols[k][1], m); c2 = lerp(c2, cols[k][2], m);
      h += m * 0.6;
    }
    const g = 1 + grain[i] * 0.05;
    A[0][i] = c0 * g; A[1][i] = c1 * g; A[2][i] = c2 * g;
    height[i] = h + grain[i] * 0.3;
    rough[i] = clamp01((o.rough ?? 0.68) + grain[i] * 0.05);
  }
  return { albedo: A, cover: fill(n, 1), height, rough, metal: fill(n, 0) };
}

function woodland(n) {
  const f = (s, c, w) => fbm(n, { cells: c, oct: 5, seed: s, warp: w, aniso: [1, 1.3] });
  return layered(n, '#7d7a50', [['#56603a', f(11, 3, 0.7), 0.04], ['#5e4a30', f(12, 4, 0.8), 0.14], ['#232619', f(13, 5, 0.9), 0.24]]);
}
function desert(n) {
  const f = (s, c, w) => fbm(n, { cells: c, oct: 4, seed: s, warp: w });
  return layered(n, '#c8ae80', [['#a68a5d', f(21, 4, 0.6), 0.02, 0.03], ['#7a5f3d', f(22, 5, 0.7), 0.2, 0.025]], { rough: 0.72 });
}
function urban(n) {
  // pixelated: two block sizes, the colour of a block from fbm sampled at its centre
  const big = fbm(n, { cells: 4, oct: 4, seed: 31 }), small = fbm(n, { cells: 8, oct: 3, seed: 32 });
  const B1 = Math.max(2, Math.round(n / 48)), B2 = Math.max(1, Math.round(n / 96));
  const cols = ['#9a9da0', '#6b6f74', '#45494e', '#26292c'].map(lin);
  const A = rgb(n), height = new Float32Array(n * n), rough = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    const bx = Math.floor(x / B1) * B1 + (B1 >> 1), by = Math.floor(y / B1) * B1 + (B1 >> 1);
    const sx = Math.floor(x / B2) * B2 + (B2 >> 1), sy = Math.floor(y / B2) * B2 + (B2 >> 1);
    const v = big[(by % n) * n + (bx % n)] * 0.75 + small[(sy % n) * n + (sx % n)] * 0.45;
    const k = v < -0.25 ? 3 : v < 0 ? 2 : v < 0.28 ? 1 : 0;
    const c = cols[k];
    A[0][i] = c[0]; A[1][i] = c[1]; A[2][i] = c[2];
    height[i] = (3 - k) * 0.25;
    rough[i] = 0.7;
  }
  return { albedo: A, cover: fill(n, 1), height, rough, metal: fill(n, 0) };
}
function arctic(n) {
  const f = (s, c, w) => fbm(n, { cells: c, oct: 5, seed: s, warp: w });
  return layered(n, '#e3e7e9', [['#b9c2c8', f(41, 5, 0.7), 0.1, 0.02], ['#7d8790', f(42, 7, 0.8), 0.3, 0.015]], { rough: 0.62 });
}
function tiger(n) {
  // long thin stripes along the gun, jagged, over a green / khaki base
  const st = fbm(n, { cells: 3, oct: 5, seed: 51, warp: 0.8, aniso: [1, 7] });
  const st2 = fbm(n, { cells: 4, oct: 4, seed: 52, warp: 0.9, aniso: [1, 6] });
  const base = fbm(n, { cells: 3, oct: 4, seed: 53 });
  return layered(n, '#6b7745', [['#8f7f4c', base, 0.05, 0.05],
    ['#27281b', map(st, (v) => 1 - smooth(0.035, 0.1, Math.abs(v))), 0.5, 0.12],
    ['#3a3c22', map(st2, (v) => 1 - smooth(0.015, 0.05, Math.abs(v))), 0.5, 0.15]]);
}
function carbon(n) {
  // 2x2 twill weave: tows alternating over / under, fibres along each tow, gloss clear coat
  const T = 32;                           // tows across the texture
  const tw = n / T;
  const fib = fbm(n, { cells: 256, oct: 2, seed: 61, aniso: [1, 8] });
  const fib2 = fbm(n, { cells: 256, oct: 2, seed: 62, aniso: [8, 1] });
  const A = rgb(n), height = new Float32Array(n * n), rough = new Float32Array(n * n);
  const dk = lin('#0d0e10'), lt = lin('#34373d');
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    const cx = Math.floor(x / tw), cy = Math.floor(y / tw);
    const fx = x / tw - cx, fy = y / tw - cy;
    const warpUp = ((cx + cy) & 3) < 2;     // warp tow on top in this cell
    const across = warpUp ? fx : fy;        // position across the tow on top
    const crown = Math.sin(Math.PI * across);
    // the tows along u look bright, the ones along v dark (the sheen of the fibres)
    const k = warpUp ? 0.75 + fib2[i] * 0.2 : 0.18 + fib[i] * 0.12;
    for (let c = 0; c < 3; c++) A[c][i] = lerp(dk[c], lt[c], k * (0.7 + crown * 0.3));
    height[i] = crown * 1.4;
    rough[i] = clamp01(0.12 + (1 - crown) * 0.05);
  }
  return { albedo: A, cover: fill(n, 1), height, rough, metal: fill(n, 0.1) };
}
function damascus(n) {
  // pattern-welded layers folded and twisted: bright and dark steel alternating, the dark ones
  // etched a little deeper and rougher
  const w1 = fbm(n, { cells: 2, oct: 5, seed: 71, warp: 1.6 });
  const w2 = fbm(n, { cells: 5, oct: 4, seed: 72, warp: 1.2 });
  const A = rgb(n), height = new Float32Array(n * n), rough = new Float32Array(n * n);
  const br = lin('#c3c8ce'), dk = lin('#3e4248');
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    const t = (y / n) * 22 + w1[i] * 7 + w2[i] * 2.5 + Math.sin((x / n) * Math.PI * 2 * 3 + w1[i] * 3) * 1.1;
    const b = 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
    const m = smooth(0.35, 0.65, b);
    for (let c = 0; c < 3; c++) A[c][i] = lerp(dk[c], br[c], m);
    height[i] = m * 0.9;
    rough[i] = lerp(0.42, 0.2, m);
  }
  return { albedo: A, cover: fill(n, 1), height, rough, metal: fill(n, 1) };
}
function gold(n, rng) {
  // polished gold with engraved scrollwork: curling grooves from the iso-lines of a slow field
  const f = fbm(n, { cells: 3, oct: 3, seed: 81, warp: 2 });
  const g = fbm(n, { cells: 6, oct: 2, seed: 82 });
  const A = rgb(n), height = new Float32Array(n * n), rough = new Float32Array(n * n);
  const au = lin('#f2c45a'), deep = lin('#7a5418');
  for (let i = 0; i < n * n; i++) {
    const iso = Math.abs(Math.sin((f[i] * 16 + g[i] * 2.5) * Math.PI));
    const groove = 1 - smooth(0.0, 0.12, iso);
    const mask = smooth(-0.1, 0.25, g[i]);           // engraved panels, plain gold between
    const e = groove * mask;
    for (let c = 0; c < 3; c++) A[c][i] = lerp(au[c], deep[c], e * 0.75);
    height[i] = -e * 1.4;
    rough[i] = lerp(0.14, 0.42, e);
  }
  return { albedo: A, cover: fill(n, 1), height, rough, metal: fill(n, 1) };
}
function blood(n, rng) {
  // dried blood (splatters, drips running one way, smears) and grime caked in a broad film;
  // cover = where either is
  const s = S(n);
  const bl = fill(n, 0);
  // splats: a blob whose rim wobbles (radius from a noise round the angle), satellite drops
  // thrown outward, and drips running toward -v (rows up the image: down the gun)
  for (let k = 0; k < 24; k++) {
    const cx = rng() * n, cy = rng() * n, r = (10 + rng() * 30) * s;
    const ph = [rng() * 6.3, rng() * 6.3, rng() * 6.3];
    disc(bl, n, cx, cy, r * 1.7, (f, idx, d, dx, dy) => {
      const a = Math.atan2(dy, dx);
      const rim = 0.62 + 0.16 * Math.sin(a * 3 + ph[0]) + 0.1 * Math.sin(a * 7 + ph[1]) + 0.06 * Math.sin(a * 13 + ph[2]);
      const v = smooth(rim + 0.05, rim - 0.05, d);
      if (v > f[idx]) f[idx] = v;
    });
    for (let j = 0; j < 12; j++) {
      const a = rng() * Math.PI * 2, dd = r * (1.3 + rng() * 3.2), rr = r * (0.05 + rng() * 0.18);
      disc(bl, n, cx + Math.cos(a) * dd, cy + Math.sin(a) * dd, rr, (f, idx, d) => { const v = smooth(1, 0.7, d); if (v > f[idx]) f[idx] = v; });
    }
    if (rng() < 0.55) {
      const x = cx + (rng() - 0.5) * r, L = (40 + rng() * 120) * s;
      const pts = [[x, cy]];
      for (let t = 1; t <= 6; t++) pts.push([x + (rng() - 0.5) * 3 * s, cy - (L * t) / 6]);
      polyStroke(bl, n, pts, (t) => Math.max(1, r * 0.28 * (1 - t * 0.55)), (f, idx, cov) => { if (cov > f[idx]) f[idx] = cov; });
      disc(bl, n, pts[6][0], pts[6][1], Math.max(1.2, r * 0.2), (f, idx, d) => { const v = smooth(1, 0.6, d); if (v > f[idx]) f[idx] = v; });
    }
  }
  const smear = fbm(n, { cells: 4, oct: 5, seed: 91, warp: 1.5, aniso: [1, 1.5] });
  const grime = fbm(n, { cells: 6, oct: 5, seed: 92, warp: 1.2 });
  const A = rgb(n), cover = new Float32Array(n * n), height = new Float32Array(n * n), rough = new Float32Array(n * n);
  const dry = lin('#3d0e09'), wet = lin('#5c140c'), dirt = lin('#2b2620'), crust = lin('#24100c');
  const fine = fbm(n, { cells: 128, oct: 2, seed: 93 });
  for (let i = 0; i < n * n; i++) {
    const b = Math.max(bl[i], smooth(0.32, 0.5, smear[i]) * 0.85);
    const gr = smooth(0.1, 0.55, grime[i]) * 0.8;
    const gloss = smooth(0.4, 0.75, fine[i] + bl[i] * 0.3);
    for (let c = 0; c < 3; c++) {
      let v = lerp(dirt[c], lerp(dry[c], wet[c], gloss * 0.6), smooth(0.05, 0.3, b));
      v = lerp(v, crust[c], smooth(0.75, 1, b) * 0.6);
      A[c][i] = v * (0.9 + fine[i] * 0.15);
    }
    cover[i] = clamp01(Math.max(smooth(0.05, 0.3, b), gr));
    height[i] = b * 1.2 + gr * 0.4 + fine[i] * 0.2;
    rough[i] = clamp01(b > 0.2 ? lerp(0.62, 0.28, gloss) : 0.88);
  }
  return { albedo: A, cover, height, rough, metal: fill(n, 0) };
}
function hazard(n, rng) {
  // diagonal yellow / black stripes painted by hand: wobbly edges, brush marks, chips
  const wob = fbm(n, { cells: 8, oct: 4, seed: 101 });
  const brush = fbm(n, { cells: 6, oct: 4, seed: 102, aniso: [8, 1] });
  const chips = fbm(n, { cells: 10, oct: 5, seed: 103, warp: 1 });
  const K = 6;          // stripe pairs across (integer: tileable along the diagonal)
  const A = rgb(n), cover = new Float32Array(n * n), height = new Float32Array(n * n), rough = new Float32Array(n * n);
  const yel = lin('#f0b406'), blk = lin('#161616');
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    const t = ((x + y) / n) * K + wob[i] * 0.06;
    const f = t - Math.floor(t);
    const m = smooth(0.48, 0.52, f) * (1 - smooth(0.98, 1, f)) + (f < 0.02 ? smooth(0.02, 0, f) : 0);
    const br = 0.92 + brush[i] * 0.12;
    for (let c = 0; c < 3; c++) A[c][i] = lerp(yel[c], blk[c], m) * br;
    const chip = smooth(0.5, 0.54, chips[i]);
    cover[i] = 1 - chip;
    height[i] = 0.8 + brush[i] * 0.6 - chip * 0.8;
    rough[i] = clamp01(0.42 + brush[i] * 0.08);
  }
  return { albedo: A, cover, height, rough, metal: fill(n, 0) };
}

export const SKIN_RECIPES = { woodland, desert, urban, arctic, tiger, carbon, damascus, gold, blood, hazard };
