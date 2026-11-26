// The material canvas of the texture baker: a set of per-texel fields a recipe paints into
// (albedo in sRGB, height, roughness, metalness, tint, micro relief, extra occlusion) and the
// finishing pass that turns them into the library's maps:
//   albedo.png  RGB, sRGB albedo
//   normal.png  RGB, tangent-space normal, OpenGL convention (green = up the surface = +v)
//   rah.png     RGB, R roughness, G ambient occlusion, B height (0 = deepest, 1 = highest)
//   mask.png    RGB, R metalness, G tint (how much of the surface takes the object's own colour in
//               the game: paint, a brick's body; 0 = keeps its baked colour: rust, mortar, bare wood)
// Rows of every field run up the surface (row 0 = v = 0, the bottom of a wall); the PNGs are written
// top row first, so they look the right way up in an image viewer.

import { field, blur, clamp01 } from './noise.js';

/** sRGB (0..1) → linear. */
export const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
/** linear → sRGB (0..1). */
export const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** '#rrggbb' → [r, g, b] 0..1 (sRGB). */
export function hex(s) {
  const v = parseInt(s.replace('#', ''), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export class Surface {
  /**
   * @param {number} N size in texels (a power of two)
   * @param {number} tileM metres covered by the tile
   * @param {number} depthMM millimetres of relief spanned by height 0..1
   */
  constructor(N, tileM, depthMM) {
    this.N = N;
    this.NN = N * N;
    /** Texel-size factor: recipes give sizes in texels at 2048² and multiply by s. */
    this.s = N / 2048;
    this.tileM = tileM;
    this.texMM = (tileM * 1000) / N;
    this.depthMM = depthMM;
    this.r = field(N, 0.5); this.g = field(N, 0.5); this.b = field(N, 0.5);
    this.h = field(N, 0.5);
    this.rough = field(N, 0.7);
    this.metal = field(N, 0);
    this.tint = field(N, 0);
    /** micro relief: height (in units of depthMM × microK) that only bends the normal */
    this.micro = field(N, 0);
    this.microK = 0.15;
    /** occlusion multiplied on top of the one computed from the height (0..1) */
    this.occ = field(N, 1);
    /** normal strength multiplier on top of the physical slope */
    this.normalK = 1;
    /** cavity AO strength */
    this.aoK = 1;
  }

  /** Texels per millimetre. */
  get perMM() { return 1 / this.texMM; }
  /** Millimetres → texels. */
  mm(v) { return v / this.texMM; }

  /** Set texel i's albedo. */
  set(i, c) { this.r[i] = c[0]; this.g[i] = c[1]; this.b[i] = c[2]; }
  /** Blend texel i's albedo toward colour c by t. */
  mix(i, c, t) {
    if (t <= 0) return;
    if (t > 1) t = 1;
    this.r[i] += (c[0] - this.r[i]) * t; this.g[i] += (c[1] - this.g[i]) * t; this.b[i] += (c[2] - this.b[i]) * t;
  }
  /** Multiply texel i's albedo by k (scalar or [r, g, b]). */
  mul(i, k) {
    if (typeof k === 'number') { this.r[i] *= k; this.g[i] *= k; this.b[i] *= k; } else { this.r[i] *= k[0]; this.g[i] *= k[1]; this.b[i] *= k[2]; }
  }

  /**
   * Height minus its neighbourhood at radius r (texels): > 0 on ridges, edges and tops, < 0 in
   * joints, cracks and pits. Scaled to roughly ±1.
   */
  cavity(r, gain = 6) {
    const bl = blur(this.N, this.h, r, 2);
    const out = field(this.N);
    for (let i = 0; i < this.NN; i++) out[i] = Math.max(-1, Math.min(1, (this.h[i] - bl[i]) * gain));
    return out;
  }

  /**
   * Grime in the low spots: darker, browner and rougher where the height lies below its
   * neighbourhood, a little lighter (worn, dusty) on the high points.
   */
  grime(o = {}) {
    const amt = o.amt ?? 0.3, rad = (o.rad ?? 12) * this.s, gain = o.gain ?? 6, col = o.color || [0.16, 0.13, 0.1];
    const wear = o.wear ?? 0.08, mask = o.mask || null, rough = o.rough ?? 0.1;
    const cav = this.cavity(Math.max(1, rad), gain);
    for (let i = 0; i < this.NN; i++) {
      const m = mask ? mask[i] : 1;
      const c = cav[i];
      if (c < 0) {
        const k = -c * amt * m;
        this.mix(i, col, k);
        this.rough[i] = clamp01(this.rough[i] + k * rough);
      } else if (wear) {
        const k = c * wear * m;
        this.r[i] += (1 - this.r[i]) * k * 0.5; this.g[i] += (1 - this.g[i]) * k * 0.5; this.b[i] += (1 - this.b[i]) * k * 0.5;
      }
    }
    return cav;
  }

  /**
   * Finish: the four maps as 8-bit pixel buffers (top row first) plus the statistics the runtime
   * needs (the mean linear colour of the tinted texels, the mean roughness).
   */
  finish() {
    const { N, NN } = this;
    const M = N - 1;
    // (slope per texel of height 0..1, as the physical relief over the texel size)
    const S = (this.depthMM / this.texMM) * this.normalK;
    const SM = S * this.microK;
    // ambient occlusion from the height: how far each texel lies below its neighbourhood at three
    // scales, as a horizon angle (depth over distance), plus the recipe's own occlusion
    const occ = field(N);
    const radii = [2, 7, 24, 64];
    const wts = [0.35, 0.35, 0.2, 0.1];
    for (let k = 0; k < radii.length; k++) {
      const rr = Math.max(1, Math.round(radii[k] * this.s));
      const bl = blur(N, this.h, rr, 2);
      const distMM = rr * this.texMM * 1.6;
      for (let i = 0; i < NN; i++) {
        const d = (bl[i] - this.h[i]) * this.depthMM;
        if (d > 0) occ[i] += wts[k] * Math.min(1.5, d / distMM);
      }
    }
    // the normal is taken from a lightly smoothed height (a [1 2 1] kernel mixed in by normalSoft):
    // single-texel noise only glitters in the mips and costs the PNG most of its bytes
    const hs0 = this.h, mi0 = this.micro;
    const soft = this.normalSoft ?? 1;
    const hN = soft > 0 ? softened(N, hs0, soft) : hs0, mN = soft > 0 ? softened(N, mi0, soft) : mi0;
    const albedo = new Uint8Array(NN * 3), normal = new Uint8Array(NN * 3), rah = new Uint8Array(NN * 3), mask = new Uint8Array(NN * 3);
    let tr = 0, tg = 0, tb = 0, tw = 0, ar = 0, ag = 0, ab = 0, rs = 0, hs = 0, ms = 0;
    for (let y = 0; y < N; y++) {
      const ym = ((y - 1) & M) * N, yp = ((y + 1) & M) * N, yc = y * N;
      const o = (N - 1 - y) * N * 3;   // (top row of the image = the highest row of the surface)
      for (let x = 0; x < N; x++) {
        const i = yc + x, xm = yc + ((x - 1) & M), xp = yc + ((x + 1) & M);
        const dhx = (hN[xp] - hN[xm]) * 0.5 * S + (mN[xp] - mN[xm]) * 0.5 * SM;
        const dhy = (hN[yp + x] - hN[ym + x]) * 0.5 * S + (mN[yp + x] - mN[ym + x]) * 0.5 * SM;
        const nx = -dhx, ny = -dhy, inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
        const p = o + x * 3;
        normal[p] = q8(nx * inv * 0.5 + 0.5); normal[p + 1] = q8(ny * inv * 0.5 + 0.5); normal[p + 2] = q8(inv * 0.5 + 0.5);
        const r = clamp01(this.r[i]), g = clamp01(this.g[i]), b = clamp01(this.b[i]);
        albedo[p] = q8(r); albedo[p + 1] = q8(g); albedo[p + 2] = q8(b);
        const ao = clamp01((1 - occ[i] * this.aoK) * this.occ[i]);
        const rough = clamp01(this.rough[i]), h = clamp01(this.h[i]), met = clamp01(this.metal[i]), t = clamp01(this.tint[i]);
        // (roughness in 64 steps and occlusion in 128: finer steps are invisible and cost the PNG bytes)
        rah[p] = qn(rough, 63); rah[p + 1] = qn(Math.max(0.08, ao), 127); rah[p + 2] = q8(h);
        mask[p] = q8(met); mask[p + 1] = q8(t); mask[p + 2] = 0;
        const lr = toLin(r), lg = toLin(g), lb = toLin(b);
        tr += lr * t; tg += lg * t; tb += lb * t; tw += t;
        ar += lr; ag += lg; ab += lb; rs += rough; hs += h; ms += met;
      }
    }
    const meanAll = [ar / NN, ag / NN, ab / NN];
    const mean = tw > NN * 0.01 ? [tr / tw, tg / tw, tb / tw] : meanAll;
    return {
      albedo, normal, rah, mask,
      stats: {
        mean: mean.map(r4), meanAll: meanAll.map(r4), rough: r4(rs / NN), height: r4(hs / NN), metal: r4(ms / NN), tint: r4(tw / NN),
      },
    };
  }
}

/**
 * Box-filter finished maps (Surface.finish() output) from N² down by an integer factor: colour,
 * roughness / occlusion / height and masks are averaged, normals averaged as vectors and
 * renormalised (the length lost is the detail the mips will lose anyway).
 */
export function downsampleMaps(maps, N, f) {
  if (f <= 1) return maps;
  const n = N / f, k = 1 / (f * f);
  const out = { albedo: new Uint8Array(n * n * 3), normal: new Uint8Array(n * n * 3), rah: new Uint8Array(n * n * 3), mask: new Uint8Array(n * n * 3), stats: maps.stats };
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const acc = new Float64Array(12);
      let nx = 0, ny = 0, nz = 0;
      for (let dy = 0; dy < f; dy++) {
        for (let dx = 0; dx < f; dx++) {
          const p = ((y * f + dy) * N + (x * f + dx)) * 3;
          // (albedo averaged in linear light, like the GPU's mips)
          acc[0] += toLin(maps.albedo[p] / 255); acc[1] += toLin(maps.albedo[p + 1] / 255); acc[2] += toLin(maps.albedo[p + 2] / 255);
          acc[3] += maps.rah[p]; acc[4] += maps.rah[p + 1]; acc[5] += maps.rah[p + 2];
          acc[6] += maps.mask[p]; acc[7] += maps.mask[p + 1];
          nx += maps.normal[p] / 127.5 - 1; ny += maps.normal[p + 1] / 127.5 - 1; nz += maps.normal[p + 2] / 127.5 - 1;
        }
      }
      const q = (y * n + x) * 3;
      out.albedo[q] = q8(toSrgb(acc[0] * k)); out.albedo[q + 1] = q8(toSrgb(acc[1] * k)); out.albedo[q + 2] = q8(toSrgb(acc[2] * k));
      out.rah[q] = qn(acc[3] * k / 255, 63); out.rah[q + 1] = qn(acc[4] * k / 255, 127); out.rah[q + 2] = Math.round(acc[5] * k);
      out.mask[q] = Math.round(acc[6] * k); out.mask[q + 1] = Math.round(acc[7] * k); out.mask[q + 2] = 0;
      const l = Math.hypot(nx, ny, nz) || 1;
      out.normal[q] = q8(nx / l * 0.5 + 0.5); out.normal[q + 1] = q8(ny / l * 0.5 + 0.5); out.normal[q + 2] = q8(nz / l * 0.5 + 0.5);
    }
  }
  return out;
}

/**
 * Levels kept per stored channel (the PNGs are lossless, so every level of noise costs bytes; below
 * these steps the difference is invisible after filtering and lighting): albedo and normal 128
 * levels, roughness and occlusion 32, height 128, metalness and tint 16.
 */
export const QUANT = Object.freeze({ albedo: 127, normal: 127, rough: 31, ao: 31, height: 127, metal: 15, tint: 15 });

/** Quantise stored maps in place to QUANT (the normal's z is rebuilt from the stepped x, y). */
export function quantizeMaps(maps, Q = QUANT) {
  const q = (v, s) => Math.round(Math.round((v / 255) * s) * 255 / s);
  const lut = (s) => Uint8Array.from({ length: 256 }, (_, v) => q(v, s));
  const LA = lut(Q.albedo), LN = lut(Q.normal), LR = lut(Q.rough), LO = lut(Q.ao), LH = lut(Q.height), LM = lut(Q.metal), LT = lut(Q.tint);
  const { albedo, normal, rah, mask } = maps;
  for (let p = 0; p < albedo.length; p += 3) {
    albedo[p] = LA[albedo[p]]; albedo[p + 1] = LA[albedo[p + 1]]; albedo[p + 2] = LA[albedo[p + 2]];
    const nx = LN[normal[p]], ny = LN[normal[p + 1]];
    const x = nx / 127.5 - 1, y = ny / 127.5 - 1, z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    normal[p] = nx; normal[p + 1] = ny; normal[p + 2] = q8(z * 0.5 + 0.5);
    rah[p] = LR[rah[p]]; rah[p + 1] = LO[rah[p + 1]]; rah[p + 2] = LH[rah[p + 2]];
    mask[p] = LM[mask[p]]; mask[p + 1] = LT[mask[p + 1]];
  }
  return maps;
}

/** f mixed by k with its [1 2 1]² smoothing (wrapping). */
function softened(N, f, k) {
  const M = N - 1, t = new Float32Array(N * N), o = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    const r = y * N;
    for (let x = 0; x < N; x++) t[r + x] = (f[r + ((x - 1) & M)] + 2 * f[r + x] + f[r + ((x + 1) & M)]) * 0.25;
  }
  for (let y = 0; y < N; y++) {
    const a = ((y - 1) & M) * N, b = y * N, c = ((y + 1) & M) * N;
    for (let x = 0; x < N; x++) {
      const v = (t[a + x] + 2 * t[b + x] + t[c + x]) * 0.25;
      o[b + x] = f[b + x] + (v - f[b + x]) * k;
    }
  }
  return o;
}

const r4 = (v) => Math.round(v * 1e4) / 1e4;
/** 0..1 → a byte on a grid of `steps` + 1 levels. */
function qn(v, steps) { const k = Math.round(clamp01(v) * steps); return Math.round((k * 255) / steps); }
function q8(v) { return v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0; }
