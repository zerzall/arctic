// Tileable noise and field tools for the texture baker (scripts/bake-textures.js). Every field is a
// Float32Array of N × N texels on a periodic domain (it wraps at the edges, so a texture made of
// them tiles). Rows run UP the surface: row 0 is v = 0, the bottom of a wall (the PNG writer flips
// them). Everything is a pure function of its arguments and seed: the same call gives the same
// field, bit for bit.

/** Integer hash of up to three ints → uint32. */
export function hash3(a, b = 0, c = 0) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x3c6ef372, 0x165667b1) ^ Math.imul((c | 0) + 0x5bd1e995, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
/** Hash → [0, 1). */
export const hash01 = (a, b = 0, c = 0) => hash3(a, b, c) / 4294967296;

/** A seeded PRNG (mulberry32) → () => [0, 1). */
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
export const fract = (v) => v - Math.floor(v);
export const wrapi = (i, n) => ((i % n) + n) % n;

/** A new zeroed field. */
export const field = (N, fill = 0) => { const f = new Float32Array(N * N); if (fill) f.fill(fill); return f; };

// ---- gradient (Perlin) noise ---------------------------------------------------------------------

/**
 * Add `amp` × periodic gradient noise with `pu` × `pv` lattice cells over the tile into `out`
 * (values about ±0.7·amp). Quintic fade, a random unit gradient per lattice point.
 */
export function perlinAdd(N, out, pu, pv, seed, amp = 1) {
  pu = Math.max(1, pu | 0); pv = Math.max(1, pv | 0);
  const gx = new Float32Array(pu * pv), gy = new Float32Array(pu * pv);
  for (let j = 0; j < pv; j++) {
    for (let i = 0; i < pu; i++) {
      const a = hash01(i, j, seed) * Math.PI * 2;
      gx[j * pu + i] = Math.cos(a); gy[j * pu + i] = Math.sin(a);
    }
  }
  const i0 = new Int32Array(N), i1 = new Int32Array(N), tx = new Float32Array(N), sx = new Float32Array(N);
  for (let x = 0; x < N; x++) {
    const f = ((x + 0.5) / N) * pu, a = Math.floor(f), t = f - a;
    i0[x] = a % pu; i1[x] = (a + 1) % pu; tx[x] = t; sx[x] = t * t * t * (t * (t * 6 - 15) + 10);
  }
  for (let y = 0; y < N; y++) {
    const f = ((y + 0.5) / N) * pv, b = Math.floor(f), ty = f - b, sy = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
    const r0 = (b % pv) * pu, r1 = ((b + 1) % pv) * pu, o = y * N;
    for (let x = 0; x < N; x++) {
      const t = tx[x], k00 = r0 + i0[x], k10 = r0 + i1[x], k01 = r1 + i0[x], k11 = r1 + i1[x];
      const n00 = gx[k00] * t + gy[k00] * ty;
      const n10 = gx[k10] * (t - 1) + gy[k10] * ty;
      const n01 = gx[k01] * t + gy[k01] * (ty - 1);
      const n11 = gx[k11] * (t - 1) + gy[k11] * (ty - 1);
      const s = sx[x];
      const a = n00 + (n10 - n00) * s, c = n01 + (n11 - n01) * s;
      out[o + x] += (a + (c - a) * sy) * amp;
    }
  }
  return out;
}

/**
 * Fractal gradient noise normalised to 0..1.
 * @param {number} N
 * @param {object} o { p: base cells (or pu / pv), oct, gain, lac (integer, default 2), seed, ridge, turb }
 *   ridge: ridged multifractal (sharp crests: erosion gullies, cracks); turb: |noise| billows
 */
export function fbm(N, o) {
  const pu0 = o.pu ?? o.p ?? 4, pv0 = o.pv ?? o.p ?? 4, oct = o.oct ?? 5, gain = o.gain ?? 0.5, lac = o.lac ?? 2, seed = o.seed ?? 1;
  const out = field(N);
  const tmp = o.ridge || o.turb ? field(N) : null;
  let amp = 1, pu = pu0, pv = pv0;
  for (let k = 0; k < oct; k++) {
    if (pu > N || pv > N) break;
    if (tmp) {
      tmp.fill(0);
      perlinAdd(N, tmp, pu, pv, seed * 131 + k * 7919, 1);
      if (o.ridge) {
        // (each octave's crests weighted by the one below: rivulets branch off the big gullies)
        for (let i = 0; i < out.length; i++) { const r = 1 - Math.abs(tmp[i]) * 1.4; out[i] += r * r * amp; }
      } else for (let i = 0; i < out.length; i++) out[i] += Math.abs(tmp[i]) * amp;
    } else perlinAdd(N, out, pu, pv, seed * 131 + k * 7919, amp);
    amp *= gain; pu *= lac; pv *= lac;
  }
  return normalize(out);
}

/** Rescale a field in place to 0..1 (by its min / max). */
export function normalize(f) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < f.length; i++) { const v = f[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const k = hi > lo ? 1 / (hi - lo) : 0;
  for (let i = 0; i < f.length; i++) f[i] = (f[i] - lo) * k;
  return f;
}

/** Rescale a field in place so its `lo`..`hi` quantiles map to 0..1 (clamped): an even spread. */
export function equalize(f, lo = 0.01, hi = 0.99) {
  const s = Float32Array.from(f.length > 65536 ? f.filter((_, i) => (i & 15) === 0) : f).sort();
  const a = s[Math.floor(lo * (s.length - 1))], b = s[Math.floor(hi * (s.length - 1))];
  const k = b > a ? 1 / (b - a) : 0;
  for (let i = 0; i < f.length; i++) f[i] = clamp01((f[i] - a) * k);
  return f;
}

/** The value at quantile q (0..1) of a field (sampled). */
export function quantile(f, q) {
  const s = Float32Array.from(f.filter((_, i) => (i & 7) === 0)).sort();
  return s[Math.floor(clamp01(q) * (s.length - 1))];
}

// ---- sampling, warping, blurring ------------------------------------------------------------------

/** Bilinear sample of a field at texel coordinates (wrapping). */
export function sample(f, N, x, y) {
  x -= 0.5; y -= 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  const M = N - 1;
  const xa = x0 & M, xb = (x0 + 1) & M, ya = (y0 & M) * N, yb = ((y0 + 1) & M) * N;
  const a = f[ya + xa], b = f[ya + xb], c = f[yb + xa], d = f[yb + xb];
  return a + (b - a) * tx + (c + (d - c) * tx - a - (b - a) * tx) * ty;
}

/**
 * Domain warp: `f` resampled at each texel displaced by (wx - 0.5, wy - 0.5) × amt texels
 * (wx, wy fields 0..1). N must be a power of two.
 */
export function warp(N, f, wx, wy, amt) {
  const out = field(N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      out[i] = sample(f, N, x + 0.5 + (wx[i] - 0.5) * amt, y + 0.5 + (wy[i] - 0.5) * amt);
    }
  }
  return out;
}

/** Separable box blur with wrap-around, radius r texels, `passes` times (3 ≈ Gaussian). */
export function blur(N, src, r, passes = 3) {
  r = Math.max(1, Math.round(r));
  if (r >= N / 2) r = N / 2 - 1;
  let a = Float32Array.from(src);
  const t = field(N), inv = 1 / (2 * r + 1), M = N - 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < N; y++) {
      const o = y * N;
      let s = 0;
      for (let k = -r; k <= r; k++) s += a[o + (k & M)];
      for (let x = 0; x < N; x++) {
        t[o + x] = s * inv;
        s += a[o + ((x + r + 1) & M)] - a[o + ((x - r) & M)];
      }
    }
    for (let x = 0; x < N; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += t[(k & M) * N + x];
      for (let y = 0; y < N; y++) {
        a[y * N + x] = s * inv;
        s += t[((y + r + 1) & M) * N + x] - t[((y - r) & M) * N + x];
      }
    }
  }
  return a;
}

/** A directional box blur along rows (dx) or columns (dy): streaks, brushed grain. */
export function blurDir(N, src, r, vertical, passes = 2) {
  r = Math.max(1, Math.round(r));
  let a = Float32Array.from(src);
  const t = field(N), inv = 1 / (2 * r + 1), M = N - 1;
  for (let p = 0; p < passes; p++) {
    if (!vertical) {
      for (let y = 0; y < N; y++) {
        const o = y * N;
        let s = 0;
        for (let k = -r; k <= r; k++) s += a[o + (k & M)];
        for (let x = 0; x < N; x++) { t[o + x] = s * inv; s += a[o + ((x + r + 1) & M)] - a[o + ((x - r) & M)]; }
      }
    } else {
      for (let x = 0; x < N; x++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += a[(k & M) * N + x];
        for (let y = 0; y < N; y++) { t[y * N + x] = s * inv; s += a[((y + r + 1) & M) * N + x] - a[((y - r) & M) * N + x]; }
      }
    }
    const sw = a; a = t.slice(); t.set(sw);
  }
  return a;
}

/**
 * Runs DOWN the surface (toward row 0) from a source mask: water and rust trails under their source,
 * decaying by `decay` per texel, wandering with `wander` (0..1 field) if given.
 */
export function trailDown(N, src, decay, wander = null, amt = 0) {
  const out = field(N);
  for (let x = 0; x < N; x++) {
    let run = 0;
    for (let k = 2 * N - 1; k >= 0; k--) {
      const y = k & (N - 1);
      const xs = wander ? (x + Math.round((wander[y * N + x] - 0.5) * amt) + N) & (N - 1) : x;
      run = Math.max(run * decay, src[y * N + xs]);
      if (k < N) out[y * N + x] = Math.max(out[y * N + x], run);
    }
  }
  return out;
}

// ---- cellular noise -------------------------------------------------------------------------------

/**
 * Periodic Voronoi on a jittered grid of cu × cv cells. Per texel: f1 / f2 (distance to the nearest /
 * second-nearest feature point, in texels), edge (exact distance to the nearest cell border, in
 * texels), id (0..1 per cell), cell (the cell's index) and the nearest point's position (px, py,
 * texels, unwrapped near the texel). Optional `wx`, `wy` fields (0..1) displace the lookup by
 * (w - 0.5) × wamt texels: crooked borders.
 */
export function voronoi(N, cu, cv, seed, o = {}) {
  const jit = o.jitter ?? 0.9, wx = o.wx || null, wy = o.wy || null, wamt = o.wamt || 0;
  const C = cu * cv;
  const PX = new Float32Array(C), PY = new Float32Array(C), ID = new Float32Array(C);
  const cw = N / cu, ch = N / cv;
  for (let j = 0; j < cv; j++) {
    for (let i = 0; i < cu; i++) {
      const k = j * cu + i;
      PX[k] = (i + 0.5 + (hash01(i, j, seed) - 0.5) * jit) * cw;
      PY[k] = (j + 0.5 + (hash01(i, j, seed + 1) - 0.5) * jit) * ch;
      ID[k] = hash01(i, j, seed + 2);
    }
  }
  const f1 = field(N), f2 = field(N), edge = field(N), id = field(N), cell = new Int32Array(N * N), px = field(N), py = field(N);
  const ox = new Float32Array(25), oy = new Float32Array(25), ok = new Int32Array(25);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      let qx = x + 0.5, qy = y + 0.5;
      if (wx) { qx += (wx[i] - 0.5) * wamt; qy += (wy[i] - 0.5) * wamt; }
      const ci = Math.floor(qx / cw), cj = Math.floor(qy / ch);
      let d1 = Infinity, d2 = Infinity, b = 0, n = 0;
      for (let dj = -2; dj <= 2; dj++) {
        const jj = cj + dj, wj = ((jj % cv) + cv) % cv, sy = (jj - wj) * ch;
        for (let di = -2; di <= 2; di++) {
          const ii = ci + di, wi = ((ii % cu) + cu) % cu, sx = (ii - wi) * cw;
          const k = wj * cu + wi;
          const ax = PX[k] + sx, ay = PY[k] + sy;
          ox[n] = ax; oy[n] = ay; ok[n] = k;
          const dx = ax - qx, dy = ay - qy, d = dx * dx + dy * dy;
          if (d < d1) { d2 = d1; d1 = d; b = n; } else if (d < d2) d2 = d;
          n++;
        }
      }
      // exact border distance: the nearest bisector between the winner and any neighbour
      const bx = ox[b], by = oy[b];
      let e = Infinity;
      for (let m = 0; m < n; m++) {
        if (m === b) continue;
        const dx = ox[m] - bx, dy = oy[m] - by, l = Math.sqrt(dx * dx + dy * dy);
        if (l < 1e-6) continue;
        const d = ((bx + ox[m]) * 0.5 - qx) * dx / l + ((by + oy[m]) * 0.5 - qy) * dy / l;
        if (d < e) e = d;
      }
      f1[i] = Math.sqrt(d1); f2[i] = Math.sqrt(d2); edge[i] = e; id[i] = ID[ok[b]]; cell[i] = ok[b];
      px[i] = bx; py[i] = by;
    }
  }
  return { f1, f2, edge, id, cell, px, py, cw, ch, count: C };
}

/** Gradient magnitude-free derivatives of a field (central differences, wrapping): [dx, dy]. */
export function grad(N, f) {
  const dx = field(N), dy = field(N), M = N - 1;
  for (let y = 0; y < N; y++) {
    const ym = ((y - 1) & M) * N, yp = ((y + 1) & M) * N, yc = y * N;
    for (let x = 0; x < N; x++) {
      dx[yc + x] = (f[yc + ((x + 1) & M)] - f[yc + ((x - 1) & M)]) * 0.5;
      dy[yc + x] = (f[yp + x] - f[ym + x]) * 0.5;
    }
  }
  return [dx, dy];
}

/** Stamp a soft round blob (radius r texels, `fn(d01)` profile) at (cx, cy) into f, wrapping, by max. */
export function stamp(N, f, cx, cy, r, val, mode = 'max', profile = null) {
  const M = N - 1, R = Math.ceil(r);
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy) / r;
      if (d >= 1) continue;
      const k = profile ? profile(d) : (1 - d * d) * (1 - d * d);
      const i = ((Math.round(cy) + dy) & M) * N + ((Math.round(cx) + dx) & M);
      const v = val * k;
      if (mode === 'max') { if (v > f[i]) f[i] = v; } else if (mode === 'add') f[i] += v; else if (mode === 'min') { if (-v < f[i]) f[i] = -v; }
    }
  }
}

/** Draw an anti-aliased poly-line stroke of width w (texels) into f by max, wrapping. */
export function stroke(N, f, pts, w, val = 1, soft = 1) {
  const M = N - 1;
  for (let s = 0; s + 1 < pts.length; s++) {
    const [ax, ay] = pts[s], [bx, by] = pts[s + 1];
    const minx = Math.floor(Math.min(ax, bx) - w - soft - 1), maxx = Math.ceil(Math.max(ax, bx) + w + soft + 1);
    const miny = Math.floor(Math.min(ay, by) - w - soft - 1), maxy = Math.ceil(Math.max(ay, by) + w + soft + 1);
    const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey || 1e-6;
    for (let y = miny; y <= maxy; y++) {
      for (let x = minx; x <= maxx; x++) {
        const px = x + 0.5 - ax, py = y + 0.5 - ay;
        const t = clamp01((px * ex + py * ey) / l2);
        const dx = px - ex * t, dy = py - ey * t, d = Math.sqrt(dx * dx + dy * dy);
        const k = 1 - smooth(w * 0.5, w * 0.5 + soft, d);
        if (k <= 0) continue;
        const i = (y & M) * N + (x & M);
        const v = val * k;
        if (v > f[i]) f[i] = v;
      }
    }
  }
}
