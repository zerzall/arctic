// Shared weathering and structure effects for the baker's recipes: colour ramps, element grids
// (bricks, tiles, slabs, planks), crack networks, rust, peeling paint, stains and streaks. Every
// function works on a Surface (surface.js) or on plain fields and is deterministic in its seed.

import { fbm, voronoi, blur, field, smooth, clamp01, lerp, hash01, trailDown, warp, fract } from './noise.js';

/** Piecewise-linear colour ramp: stops [[t, [r, g, b]], ...] sorted by t. */
export function ramp(stops, t) {
  if (t <= stops[0][0]) return stops[0][1];
  for (let k = 1; k < stops.length; k++) {
    if (t <= stops[k][0]) {
      const [t0, a] = stops[k - 1], [t1, b] = stops[k];
      const u = (t - t0) / (t1 - t0);
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
    }
  }
  return stops[stops.length - 1][1];
}

/** Colour c with its brightness scaled by k and hue nudged (warm > 0 toward red/yellow). */
export function vary(c, k, warm = 0) {
  return [clamp01(c[0] * k * (1 + warm)), clamp01(c[1] * k * (1 + warm * 0.35)), clamp01(c[2] * k * (1 - warm))];
}

/**
 * A running-bond (or stack, off = 0) grid of rectangular elements: cu across × cv rows up the tile,
 * odd rows shifted by off (fraction of an element). Calls fn(i, info) per texel with the element's
 * row / column / ids and the distance (texels) to its nearest edge.
 */
export function grid(N, cu, cv, off, fn) {
  const ew = N / cu, eh = N / cv;
  for (let y = 0; y < N; y++) {
    const row = Math.floor(y / eh), fy = y + 0.5 - row * eh;
    const sh = (row & 1) * off;
    for (let x = 0; x < N; x++) {
      const xx = (x + 0.5) / ew + sh;
      const colU = Math.floor(xx), fx = (xx - colU) * ew;
      const col = ((colU % cu) + cu) % cu;
      const ex = Math.min(fx, ew - fx), ey = Math.min(fy, eh - fy);
      const d = Math.min(ex, ey);
      // (corner: which of the four, and the distance to it)
      const corner = (fx < ew * 0.5 ? 0 : 1) + (fy < eh * 0.5 ? 0 : 2);
      fn(y * N + x, {
        row, col, fx, fy, ew, eh, d, ex, ey, dc: Math.hypot(ex, ey), corner,
        id: hash01(col, row, 77), id2: hash01(col, row, 78), id3: hash01(col, row, 79), idc: hash01(col * 4 + corner, row, 80),
      });
    }
  }
}

/**
 * A crack network: the borders of a warped Voronoi diagram, only some of them open (per pair of
 * cells), thin and branching. Returns a 0..1 field (1 at the crack's centre).
 * @param {object} o { cells, width (texels), seed, keep (fraction of borders that are cracked), warp }
 */
export function cracks(N, o) {
  const s = N / 2048;
  const cells = o.cells ?? 6, seed = o.seed ?? 1, keep = o.keep ?? 0.5, w = (o.width ?? 2.2) * s;
  const wx = fbm(N, { p: 4, oct: 5, seed: seed + 11 }), wy = fbm(N, { p: 4, oct: 5, seed: seed + 12 });
  const v = voronoi(N, cells, cells, seed, { wx, wy, wamt: (o.warp ?? 90) * s, jitter: 0.95 });
  const fine = fbm(N, { p: 32, oct: 3, seed: seed + 13 });
  const sel = fbm(N, { p: Math.max(2, cells >> 1), oct: 3, seed: seed + 14 });
  const out = field(N);
  for (let i = 0; i < out.length; i++) {
    // (the borders are open where a broad mask says so: a crack runs a while and dies out)
    const open = smooth(1 - keep - 0.1, 1 - keep + 0.1, sel[i]);
    const wid = w * (0.5 + fine[i]) * (0.4 + 0.6 * open);
    const e = v.edge[i] + (fine[i] - 0.5) * 1.2 * s;
    out[i] = (1 - smooth(wid * 0.35, wid, e)) * open;
  }
  return out;
}

/** Hairline cracks from ridged noise: fine, wandering lines (plaster, glaze crazing, paint). */
export function hairlines(N, o) {
  const seed = o.seed ?? 1, p = o.p ?? 6, thr = o.thr ?? 0.93;
  const r = fbm(N, { p, oct: o.oct ?? 4, seed, ridge: true });
  const m = o.mask ? o.mask : null;
  const out = field(N);
  for (let i = 0; i < out.length; i++) out[i] = smooth(thr, thr + (o.soft ?? 0.03), r[i]) * (m ? m[i] : 1);
  return out;
}

/**
 * Blotchy mask with soft or sharp edges from fbm: threshold t, edge softness e (in fbm units).
 * Used for stains, peeled paint, rust blooms, moss.
 */
export function blotch(N, o) {
  const f = fbm(N, { p: o.p ?? 4, oct: o.oct ?? 6, seed: o.seed ?? 1, gain: o.gain ?? 0.55 });
  const t = o.t ?? 0.6, e = o.e ?? 0.03;
  const out = field(N);
  for (let i = 0; i < out.length; i++) out[i] = smooth(t - e, t + e, f[i]);
  return { mask: out, f };
}

/**
 * Rust palette by a 0..1 "age" value plus per-texel variation v (0..1): fresh orange through brown to
 * the near-black scale of deep rust.
 */
export const RUST = [
  [0.0, [0.52, 0.27, 0.12]], [0.25, [0.6, 0.31, 0.12]], [0.45, [0.45, 0.2, 0.08]],
  [0.65, [0.32, 0.15, 0.07]], [0.85, [0.2, 0.11, 0.06]], [1.0, [0.12, 0.08, 0.05]],
];

/**
 * Paint rust onto a surface where `mask` (0..1): colour from the rust ramp, scaly height, high
 * roughness, no metal, no tint. `lift` raises the scale above the paint.
 */
export function applyRust(m, mask, o = {}) {
  const N = m.N, seed = o.seed ?? 5, lift = o.lift ?? 0.04;
  const age = fbm(N, { p: 8, oct: 6, seed: seed + 1 });
  const scale = voronoi(N, Math.round(48 * (o.scaleK ?? 1)), Math.round(48 * (o.scaleK ?? 1)), seed + 2, { jitter: 1 });
  const fine = fbm(N, { p: 64, oct: 3, seed: seed + 3 });
  for (let i = 0; i < m.NN; i++) {
    const k = mask[i];
    if (k <= 0.001) continue;
    const flake = smooth(0.0, 6 * m.s, scale.edge[i]);
    const t = clamp01(age[i] * 0.85 + (scale.id[i] - 0.5) * 0.12 + (1 - flake) * 0.1 + (fine[i] - 0.5) * 0.15 + (o.age ?? 0));
    const c = ramp(RUST, t);
    const v = 0.85 + fine[i] * 0.3;
    m.mix(i, [c[0] * v, c[1] * v, c[2] * v], k);
    m.h[i] += k * (lift * (0.6 + 0.4 * flake) + (fine[i] - 0.5) * 0.04 + (scale.id[i] - 0.5) * 0.01);
    m.rough[i] = lerp(m.rough[i], 0.82 + fine[i] * 0.15, k);
    m.metal[i] = lerp(m.metal[i], 0, k);
    m.tint[i] = lerp(m.tint[i], 0, k);
  }
  return age;
}

/**
 * Rust running down from a source mask (screws, seams, edges): streaks fading downward, wandering.
 */
export function rustRuns(m, src, o = {}) {
  const N = m.N;
  const wander = fbm(N, { pu: 16, pv: 2, oct: 3, seed: (o.seed ?? 9) + 1 });
  const run = trailDown(N, src, 1 - (o.decay ?? 0.004) / m.s, wander, 6 * m.s);
  const thin = fbm(N, { pu: 48, pv: 3, oct: 3, seed: (o.seed ?? 9) + 2 });
  const out = field(N);
  for (let i = 0; i < m.NN; i++) {
    const k = run[i] * (0.4 + 0.6 * thin[i]) * (o.amt ?? 0.8);
    out[i] = k;
    if (k <= 0.003) continue;
    m.mix(i, [0.42, 0.2, 0.08], k * 0.75);
    m.rough[i] = lerp(m.rough[i], 0.75, k * 0.6);
    m.tint[i] *= 1 - k * 0.8;
  }
  return out;
}

/**
 * Water / dirt streaks down a wall: vertical bands of grime from the top edge of the tile (or a
 * source mask), wandering and fading.
 */
export function streaks(m, o = {}) {
  const N = m.N, seed = o.seed ?? 21;
  const band = fbm(N, { pu: o.pu ?? 24, pv: 1, oct: 4, seed, gain: 0.6 });
  const along = fbm(N, { pu: 6, pv: 3, oct: 4, seed: seed + 1 });
  const fine = fbm(N, { pu: 96, pv: 6, oct: 2, seed: seed + 2 });
  const amt = o.amt ?? 0.25, col = o.color || [0.2, 0.18, 0.15];
  const out = field(N);
  for (let i = 0; i < m.NN; i++) {
    const k = smooth(o.t ?? 0.6, (o.t ?? 0.6) + 0.18, band[i] * 0.75 + along[i] * 0.25) * (0.6 + 0.4 * fine[i]) * amt;
    out[i] = k;
    m.mix(i, col, k);
    m.rough[i] = clamp01(m.rough[i] + k * 0.1);
  }
  return out;
}

/**
 * A tide-marked stain: a blotch darkening the surface with a darker, browner ring at its edge.
 */
export function tideStains(m, o = {}) {
  const N = m.N;
  const { f } = blotch(N, { p: o.p ?? 3, oct: 6, seed: o.seed ?? 31, t: 0.6 });
  const t = o.t ?? 0.64, amt = o.amt ?? 0.3, col = o.color || [0.45, 0.36, 0.22];
  const out = field(N);
  for (let i = 0; i < m.NN; i++) {
    const v = f[i];
    const inside = smooth(t - 0.01, t + 0.01, v);
    const ring = smooth(t - 0.012, t, v) * (1 - smooth(t + 0.004, t + 0.02, v));
    const k = (inside * 0.45 + ring * 0.9) * amt;
    out[i] = inside;
    m.mix(i, col, k);
  }
  return out;
}

/**
 * Peeling paint over a base already in the surface: where `peel` (0..1 field) is above `t` the paint
 * is gone (the recipe has painted the base there), a lifted, lighter rim around each patch, a dark
 * shadow line under it. `paint(i)` gives the paint colour. Returns the 0..1 coverage of the paint.
 */
export function peelPaint(m, peelF, t, paint, o = {}) {
  const s = m.s, thick = o.thick ?? 0.05, cover = field(m.N);
  const e = (o.edge ?? 0.006);
  for (let i = 0; i < m.NN; i++) {
    const v = peelF[i];
    const p = 1 - smooth(t - e, t + e, v);    // 1 = painted
    const rim = smooth(t - e * 5, t - e, v) * p;
    cover[i] = p;
    if (p > 0) {
      const c = paint(i);
      m.mix(i, c, p);
      m.h[i] += p * thick + rim * thick * 0.8;
      m.mix(i, [1, 1, 1], rim * 0.08);
    }
  }
  return cover;
}

/** Sprinkle small round flecks: fn(i, k) for texels inside count flecks of radius r (texels). */
export function flecks(N, count, rMin, rMax, seed, fn) {
  const M = N - 1;
  for (let k = 0; k < count; k++) {
    const cx = hash01(k, 1, seed) * N, cy = hash01(k, 2, seed) * N;
    const r = rMin + (rMax - rMin) * Math.pow(hash01(k, 3, seed), 2);
    const R = Math.ceil(r + 1);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const d = Math.hypot(dx + 0.5 - fract(cx), dy + 0.5 - fract(cy)) / r;
        if (d >= 1) continue;
        fn((((Math.floor(cy) + dy) & M) * N) + ((Math.floor(cx) + dx) & M), 1 - d, k);
      }
    }
  }
}

export { warp, blur };
