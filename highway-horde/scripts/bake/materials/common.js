// Building blocks shared by several material families: cast cement, rust runs from spots, cracks cut
// into a surface, paint peeled off a mineral base.

import { fbm, voronoi, blur, field, smooth, clamp01, lerp, hash01, warp } from '../noise.js';
import { vary, flecks } from '../fx.js';
import { hex } from '../surface.js';

/**
 * Cast cement: bug holes (air voids) of mixed sizes, a fine sand grain, a cloudy cement mottle,
 * worn patches where the aggregate's tops show. Fills albedo / height / roughness / tint.
 */
export function cementBase(m, seed, o = {}) {
  const N = m.N;
  const mott = fbm(N, { p: o.mottP ?? 5, oct: 7, seed: seed + 1, gain: 0.58 });
  const mid = fbm(N, { p: 24, oct: 4, seed: seed + 2 });
  const sand = fbm(N, { p: 384, oct: 1, seed: seed + 3 });
  const holes = voronoi(N, o.holes ?? 120, o.holes ?? 120, seed + 4, { jitter: 1 });
  const big = voronoi(N, 30, 30, seed + 5, { jitter: 1 });
  const agg = voronoi(N, o.agg ?? 160, o.agg ?? 160, seed + 6, { jitter: 1 });
  const wearF = fbm(N, { p: 6, oct: 5, seed: seed + 7 });
  const base = hex(o.color || '#8f8d87');
  for (let i = 0; i < m.NN; i++) {
    const hole = holes.id[i] < (o.holeRate ?? 0.22) ? smooth(m.mm(1.6 + holes.id[i] * 6), m.mm(0.4), holes.f1[i]) : 0;
    const bh = big.id[i] < 0.05 ? smooth(m.mm(6 + big.id[i] * 60), m.mm(1.5), big.f1[i]) : 0;
    const worn = smooth(0.62, 0.72, wearF[i]) * (o.wear ?? 0.6);
    const stone = smooth(m.mm(1.5), m.mm(4), agg.edge[i]) * worn;
    const k = 1 + (mott[i] - 0.5) * (o.mottAmt ?? 0.3) + (mid[i] - 0.5) * 0.08 + (sand[i] - 0.5) * 0.08 - hole * 0.35 - bh * 0.3;
    m.set(i, vary(base, k, (mid[i] - 0.5) * 0.05));
    if (stone > 0) m.mix(i, vary([0.55 + agg.id[i] * 0.25, 0.53 + agg.id[i] * 0.24, 0.5 + agg.id[i] * 0.22], 1, (agg.id[i] - 0.5) * 0.2), stone * 0.8);
    m.h[i] = 0.6 + (mott[i] - 0.5) * 0.04 + (mid[i] - 0.5) * 0.03 - hole * 0.35 - bh * 0.45 + stone * 0.04 - worn * 0.03;
    m.micro[i] = sand[i];
    m.rough[i] = 0.82 + (mid[i] - 0.5) * 0.12 + hole * 0.1 + worn * 0.05;
    m.tint[i] = 0.85 - stone * 0.5;
  }
  return { mott, mid, sand, wearF };
}

/** Rust (or water) running down from a 0..1 source field: wandering, thinning trails. */
export function runsFrom(m, src, seed, amt, o = {}) {
  const N = m.N;
  const wander = fbm(N, { pu: 16, pv: 2, oct: 3, seed: seed + 1 });
  const thin = fbm(N, { pu: 64, pv: 4, oct: 3, seed: seed + 2 });
  const decay = 1 - (o.decay ?? 0.0035) / m.s;
  const out = field(N);
  for (let x = 0; x < N; x++) {
    let run = 0;
    for (let k = 2 * N - 1; k >= 0; k--) {
      const y = k & (N - 1);
      const xs = (x + Math.round((wander[y * N + x] - 0.5) * 8 * m.s) + N) & (N - 1);
      run = Math.max(run * decay, src[y * N + xs]);
      if (k < N) out[y * N + x] = Math.max(out[y * N + x], run);
    }
  }
  const col = o.color || [0.45, 0.24, 0.1];
  for (let i = 0; i < m.NN; i++) {
    const k = out[i] * (0.35 + 0.65 * thin[i]) * amt;
    out[i] = k;
    if (k < 0.004) continue;
    m.mix(i, col, k * 0.7);
    m.rough[i] = lerp(m.rough[i], o.rough ?? 0.8, k * 0.5);
    m.tint[i] *= 1 - k * 0.9;
  }
  return out;
}

/** Rust bleeding from `count` spots (rebar, bolts) and running down. */
export function spotRust(m, seed, count, amt = 0.6) {
  const N = m.N, src = field(N);
  flecks(N, count, m.mm(3), m.mm(9), seed, (i, k) => { if (k > src[i]) src[i] = k; });
  return runsFrom(m, blur(N, src, 2 * m.s, 2), seed, amt);
}

/** Cut a crack field (0..1) into the surface: dark, rough, a groove; no tint inside. */
export function applyCracks(m, cr, o = {}) {
  const dark = o.dark ?? 0.55, depth = o.depth ?? 0.25, col = o.color || [0.1, 0.09, 0.08];
  for (let i = 0; i < m.NN; i++) {
    const k = cr[i];
    if (k <= 0.002) continue;
    m.mix(i, col, k * dark);
    m.h[i] -= k * depth;
    m.rough[i] = clamp01(m.rough[i] + k * 0.1);
    m.tint[i] *= 1 - k * 0.7;
  }
}

/**
 * Paint over a mineral base already in the surface, peeled back in patches: a lifted, lighter rim
 * around each, the bare base (and optionally an older coat) inside. Paint takes the tint.
 */
export function paintedOver(m, seed, o) {
  const N = m.N;
  const peelF = warp(N, fbm(N, { p: o.peelP ?? 4, oct: 7, seed: seed + 41, gain: 0.6 }), fbm(N, { p: 8, oct: 4, seed: seed + 42 }), fbm(N, { p: 8, oct: 4, seed: seed + 43 }), 40 * m.s);
  const paint = hex(o.paint || '#d8d4ca');
  const chalk = fbm(N, { p: 7, oct: 5, seed: seed + 44 });
  const t = o.peel ?? 0.7;
  const cover = field(N);
  for (let i = 0; i < m.NN; i++) {
    const v = peelF[i];
    const p = 1 - smooth(t - 0.006, t + 0.006, v);
    const rim = smooth(t - 0.03, t - 0.004, v) * p;
    const under = smooth(t, t + 0.04, v);
    cover[i] = p;
    if (o.under && p < 1) m.mix(i, vary(hex(o.under), 0.95 + chalk[i] * 0.1), (1 - under) * (1 - p) * 0.8);
    if (p > 0) {
      m.mix(i, vary(paint, 0.96 + (chalk[i] - 0.5) * (o.chalk ?? 0.12) + rim * 0.06), p);
      m.h[i] = lerp(m.h[i], m.h[i] * 0.4 + 0.62 + rim * 0.05, p);
      m.rough[i] = lerp(m.rough[i], (o.paintRough ?? 0.78) + (chalk[i] - 0.5) * 0.1, p);
      m.tint[i] = lerp(m.tint[i], 1, p);
    }
  }
  return cover;
}

/** Straight-line distance field helpers. */
export const edgeDist = (x, y, N) => Math.min(x + 0.5, N - x - 0.5, y + 0.5, N - y - 0.5);

export { hash01 };
