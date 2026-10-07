// Tileable scalar fields for the gun textures (scripts/bake-guns.js): seeded integer hashing (no
// Math.random, so a bake is deterministic), gradient noise and fBm on a wrapping lattice, cellular
// (Worley) noise, periodic blurs, anti-aliased strokes and stamps that wrap round the edges, and
// the conversions to the texture channels (height → tangent-space normal, cavity AO, sRGB bytes).
// Every field is a Float32Array of n*n values, row-major, row 0 at the top (texture v = 0).

/** 32-bit integer hash of up to three ints → [0, 1). */
export function hash3(x, y, s = 0) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Seeded generator (mulberry32): () → [0, 1). */
export function rngOf(seed) {
  let a = (seed | 0) ^ 0x6d2b79f5;
  const r = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  r.gauss = () => (r() + r() + r() + r() - 2) * 0.866;
  return r;
}

export function seedOf(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const mod = (a, m) => ((a % m) + m) % m;

// ---- gradient noise on a wrapping lattice -------------------------------------------------

const GX = new Float32Array(256), GY = new Float32Array(256);
for (let i = 0; i < 256; i++) { const a = (i / 256) * Math.PI * 2; GX[i] = Math.cos(a); GY[i] = Math.sin(a); }

/**
 * Gradient noise at (u, v) in lattice cells, wrapping every px cells along u and py along v.
 * Roughly in [-0.7, 0.7].
 */
export function perlin(u, v, px, py, seed) {
  const iu = Math.floor(u), iv = Math.floor(v);
  const fu = u - iu, fv = v - iv;
  const i0 = mod(iu, px), i1 = mod(iu + 1, px), j0 = mod(iv, py), j1 = mod(iv + 1, py);
  const g00 = (hash3(i0, j0, seed) * 256) | 0, g10 = (hash3(i1, j0, seed) * 256) | 0;
  const g01 = (hash3(i0, j1, seed) * 256) | 0, g11 = (hash3(i1, j1, seed) * 256) | 0;
  const n00 = GX[g00] * fu + GY[g00] * fv;
  const n10 = GX[g10] * (fu - 1) + GY[g10] * fv;
  const n01 = GX[g01] * fu + GY[g01] * (fv - 1);
  const n11 = GX[g11] * (fu - 1) + GY[g11] * (fv - 1);
  const su = fu * fu * fu * (fu * (fu * 6 - 15) + 10), sv = fv * fv * fv * (fv * (fv * 6 - 15) + 10);
  const a = n00 + (n10 - n00) * su, b = n01 + (n11 - n01) * su;
  return a + (b - a) * sv;
}

/**
 * Tileable fBm field. cells: lattice cells across the texture at the first octave (an integer);
 * aniso [ax, ay] stretches it (cells along x and y = cells * ax, cells * ay; integers keep it
 * tileable); warp: domain-warp amount in cells (a second noise displaces the lookup).
 * Returns values roughly in [-1, 1].
 */
export function fbm(n, o = {}) {
  const cells = o.cells || 4, oct = o.oct || 5, gain = o.gain ?? 0.5, seed = o.seed || 0;
  const ax = o.aniso ? o.aniso[0] : 1, ay = o.aniso ? o.aniso[1] : 1;
  const warp = o.warp || 0;
  const out = new Float32Array(n * n);
  let norm = 0;
  for (let k = 0, a = 1; k < oct; k++, a *= gain) norm += a;
  const inv = 1 / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let u = x * inv, v = y * inv;
      if (warp) {
        const wc = Math.max(1, Math.round(cells * 0.5));
        u += perlin(u * wc, v * wc, wc, wc, seed + 7001) * warp / cells;
        v += perlin(u * wc + 17.3, v * wc + 5.1, wc, wc, seed + 7002) * warp / cells;
      }
      let s = 0, a = 1, c = cells;
      for (let k = 0; k < oct; k++) {
        const px = Math.max(1, Math.round(c * ax)), py = Math.max(1, Math.round(c * ay));
        s += a * perlin(u * px, v * py, px, py, seed + k * 131);
        a *= gain; c *= 2;
      }
      out[y * n + x] = (s / norm) * 1.6;
    }
  }
  return out;
}

/**
 * Tileable cellular noise: `cells` feature cells across, one jittered point each.
 * Returns { f1, f2 (distances in cell units), id (per-cell random [0,1)), dx, dy (offset to the nearest point) }.
 */
export function worley(n, cells, seed, jitter = 0.9) {
  const f1 = new Float32Array(n * n), f2 = new Float32Array(n * n), id = new Float32Array(n * n);
  const px = new Float32Array(cells * cells), py = new Float32Array(cells * cells), pid = new Float32Array(cells * cells);
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    const k = j * cells + i;
    px[k] = 0.5 + (hash3(i, j, seed) - 0.5) * jitter;
    py[k] = 0.5 + (hash3(i, j, seed + 1) - 0.5) * jitter;
    pid[k] = hash3(i, j, seed + 2);
  }
  const s = cells / n;
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) * s, cj = Math.floor(v);
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) * s, ci = Math.floor(u);
      let d1 = 9, d2 = 9, best = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = mod(cj + dj, cells);
        for (let di = -1; di <= 1; di++) {
          const ii = mod(ci + di, cells);
          const k = jj * cells + ii;
          const fx = ci + di + px[k] - u, fy = cj + dj + py[k] - v;
          const d = Math.sqrt(fx * fx + fy * fy);
          if (d < d1) { d2 = d1; d1 = d; best = k; } else if (d < d2) d2 = d;
        }
      }
      const o = y * n + x;
      f1[o] = d1; f2[o] = d2; id[o] = pid[best];
    }
  }
  return { f1, f2, id };
}

// ---- field operations --------------------------------------------------------------------

/** Periodic box blur of radius r (pixels), `passes` times (3 passes ≈ a gaussian). In place. */
export function blur(f, n, r, passes = 3) {
  if (r < 1) return f;
  const tmp = new Float32Array(n);
  const w = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < n; y++) {
      const o = y * n;
      let s = 0;
      for (let k = -r; k <= r; k++) s += f[o + mod(k, n)];
      for (let x = 0; x < n; x++) {
        tmp[x] = s / w;
        s += f[o + mod(x + r + 1, n)] - f[o + mod(x - r, n)];
      }
      f.set(tmp, o);
    }
    for (let x = 0; x < n; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += f[mod(k, n) * n + x];
      for (let y = 0; y < n; y++) {
        tmp[y] = s / w;
        s += f[mod(y + r + 1, n) * n + x] - f[mod(y - r, n) * n + x];
      }
      for (let y = 0; y < n; y++) f[y * n + x] = tmp[y];
    }
  }
  return f;
}

export function copy(f) { return new Float32Array(f); }

/** Remap to [0, 1] by its min / max. In place. */
export function normalize(f) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < f.length; i++) { if (f[i] < lo) lo = f[i]; if (f[i] > hi) hi = f[i]; }
  const k = hi > lo ? 1 / (hi - lo) : 0;
  for (let i = 0; i < f.length; i++) f[i] = (f[i] - lo) * k;
  return f;
}

/** f[i] = fn(f[i], i). In place. */
export function map(f, fn) {
  for (let i = 0; i < f.length; i++) f[i] = fn(f[i], i);
  return f;
}

/** A new field fn(i, x, y). */
export function make(n, fn) {
  const f = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) f[y * n + x] = fn(y * n + x, x, y);
  return f;
}

/**
 * An anti-aliased stroke from (x0, y0) to (x1, y1) (pixels, wrapping round the edges), width w:
 * op(f, index, coverage, t) is called for every pixel it touches (t: 0..1 along the stroke).
 */
export function stroke(f, n, x0, y0, x1, y1, w, op) {
  const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1e-6;
  const hw = w / 2 + 1;
  const minx = Math.floor(Math.min(x0, x1) - hw), maxx = Math.ceil(Math.max(x0, x1) + hw);
  const miny = Math.floor(Math.min(y0, y1) - hw), maxy = Math.ceil(Math.max(y0, y1) + hw);
  for (let y = miny; y <= maxy; y++) {
    for (let x = minx; x <= maxx; x++) {
      let t = ((x - x0) * dx + (y - y0) * dy) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = x0 + dx * t - x, ey = y0 + dy * t - y;
      const d = Math.sqrt(ex * ex + ey * ey);
      const cov = clamp01(w / 2 + 0.5 - d);
      if (cov <= 0) continue;
      op(f, mod(y, n) * n + mod(x, n), cov, t, d);
    }
  }
}

/** A polyline stroke through pts [[x, y], ...] with a width per point (w(t)). */
export function polyStroke(f, n, pts, w, op) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const t0 = total ? acc / total : 0, t1 = total ? (acc + l) / total : 1;
    const ww = typeof w === 'function' ? w((t0 + t1) / 2) : w;
    stroke(f, n, a[0], a[1], b[0], b[1], ww, (ff, idx, cov, t, d) => op(ff, idx, cov, t0 + (t1 - t0) * t, d));
    acc += l;
  }
}

/** A disc of radius r at (cx, cy) wrapping round the edges: op(f, index, d / r) for d < r. */
export function disc(f, n, cx, cy, r, op) {
  const x0 = Math.floor(cx - r - 1), x1 = Math.ceil(cx + r + 1), y0 = Math.floor(cy - r - 1), y1 = Math.ceil(cy + r + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d >= r) continue;
      op(f, mod(y, n) * n + mod(x, n), d / r, x - cx, y - cy);
    }
  }
}

// ---- channel conversions -------------------------------------------------------------------

/**
 * Tangent-space normal map from a height field (heights in texels × `strength`): RGB bytes,
 * +x right (texture u), +y toward increasing rows (texture v), z out of the surface.
 */
export function normalMap(h, n, strength = 1) {
  const out = new Uint8Array(n * n * 3);
  for (let y = 0; y < n; y++) {
    const ym = mod(y - 1, n) * n, yp = mod(y + 1, n) * n, yo = y * n;
    for (let x = 0; x < n; x++) {
      const xm = mod(x - 1, n), xp = mod(x + 1, n);
      const gx = (h[yo + xp] - h[yo + xm]) * 0.5 * strength;
      const gy = (h[yp + x] - h[ym + x]) * 0.5 * strength;
      let nx = -gx, ny = -gy, nz = 1;
      const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= l; ny *= l; nz *= l;
      const o = (yo + x) * 3;
      out[o] = Math.round((nx * 0.5 + 0.5) * 255);
      out[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    }
  }
  return out;
}

/** Cavity ambient occlusion: how far below its blurred surroundings each point lies. */
export function cavity(h, n, r, k) {
  const b = blur(copy(h), n, r, 2);
  const out = new Float32Array(n * n);
  for (let i = 0; i < out.length; i++) out[i] = clamp01(1 - Math.max(0, b[i] - h[i]) * k);
  return out;
}

const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
export const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const SRGB_LUT = new Uint8Array(4096);
for (let i = 0; i < 4096; i++) SRGB_LUT[i] = Math.round(toSrgb(i / 4095) * 255);

/** Linear float RGB (three fields) → sRGB RGB bytes. */
export function srgbBytes(r, g, b, n) {
  const out = new Uint8Array(n * n * 3);
  for (let i = 0; i < n * n; i++) {
    out[i * 3] = SRGB_LUT[Math.round(clamp01(r[i]) * 4095)];
    out[i * 3 + 1] = SRGB_LUT[Math.round(clamp01(g[i]) * 4095)];
    out[i * 3 + 2] = SRGB_LUT[Math.round(clamp01(b[i]) * 4095)];
  }
  return out;
}

/** Linear [0, 1] fields → interleaved bytes (one per field). */
export function bytes(fields, n) {
  const ch = fields.length, out = new Uint8Array(n * n * ch);
  for (let i = 0; i < n * n; i++) for (let c = 0; c < ch; c++) out[i * ch + c] = Math.round(clamp01(fields[c][i]) * 255);
  return out;
}

/** '#rrggbb' → linear [r, g, b]. */
export function lin(hex) {
  const v = parseInt(hex.replace('#', ''), 16);
  return [srgbToLinear((v >> 16 & 255) / 255), srgbToLinear((v >> 8 & 255) / 255), srgbToLinear((v & 255) / 255)];
}
