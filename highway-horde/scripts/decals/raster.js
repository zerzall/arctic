// A small software 2D rasteriser for the decal baker (scripts/bake-decals.js): no canvas, no
// dependencies, deterministic to the bit. Everything is float32.
//
//   Mask     coverage 0..1 per pixel. Filled by anti-aliased primitives (capsule strokes with a
//            width that varies along the line, circles, ellipses, rounded rects, polygons with a
//            non-zero scanline fill), combined (max, min, cut, mul) and blurred.
//   Canvas   premultiplied RGBA + a height field + a roughness channel. `paint(mask, colour)`
//            composites source-over; `lift(mask, h)` raises or carves the height field (the normal
//            map is derived from it); `erase(mask)` cuts alpha (tears, worn-through paint).
//
// Coordinates are pixels of the canvas, y down. Colours are sRGB triples 0..1 (or a function
// (x, y) → [r, g, b] for gradients and noise).

/** Deterministic hash of integers → [0, 1). */
export function hash2(x, y, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Seeded rng (mulberry32). */
export function rngOf(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length) % arr.length],
    // roughly normal (sum of three)
    gauss: (m = 0, sd = 1) => m + sd * ((next() + next() + next()) * 2 - 3) / 1.0,
    seed: () => Math.floor(next() * 2147483647),
  };
  return r;
}

/** String → 32-bit seed. */
export function seedOf(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

const smooth = (t) => t * t * (3 - 2 * t);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Value noise in [0, 1). */
export function vnoise(x, y, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = smooth(x - xi), fy = smooth(y - yi);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fractal value noise in [0, 1) (oct octaves, frequency doubling). */
export function fbm(x, y, oct = 4, s = 0) {
  let sum = 0, amp = 0.5, tot = 0, f = 1;
  for (let i = 0; i < oct; i++) {
    sum += vnoise(x * f, y * f, s + i * 101) * amp;
    tot += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / tot;
}

/** Ridged noise (cracks, veins) in [0, 1]: 1 on the ridges. */
export function ridge(x, y, oct = 3, s = 0) {
  let sum = 0, amp = 0.5, tot = 0, f = 1;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(vnoise(x * f, y * f, s + i * 57) * 2 - 1);
    sum += n * n * amp;
    tot += amp;
    amp *= 0.5;
    f *= 2.1;
  }
  return sum / tot;
}

/** Hex '#rrggbb' → [r, g, b] 0..1. */
export function hex(h) {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

// ---------------------------------------------------------------------------------------

export class Mask {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.d = new Float32Array(w * h);
  }

  clone() {
    const m = new Mask(this.w, this.h);
    m.d.set(this.d);
    return m;
  }

  clear() { this.d.fill(0); return this; }

  /** Union of a capsule a→b with radii ra, rb (half widths) and opacity k. */
  capsule(ax, ay, bx, by, ra, rb = ra, k = 1) {
    const { w, h, d } = this;
    const rm = Math.max(ra, rb) + 1.5;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - rm)), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + rm));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - rm)), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + rm));
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5 - ay;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5 - ax;
        let t = L2 > 1e-9 ? (px * dx + py * dy) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = px - dx * t, ey = py - dy * t;
        const r = ra + (rb - ra) * t;
        const c = r + 0.5 - Math.sqrt(ex * ex + ey * ey);
        if (c <= 0) continue;
        const v = (c > 1 ? 1 : c) * k;
        const i = y * w + x;
        if (v > d[i]) d[i] = v;
      }
    }
    return this;
  }

  /**
   * A polyline stroke. `pts` [[x, y], ...]; width a number or a function (t 0..1 along the line) →
   * width; opts.k opacity.
   */
  stroke(pts, width, k = 1) {
    if (pts.length === 1) return this.capsule(pts[0][0], pts[0][1], pts[0][0], pts[0][1], (typeof width === 'function' ? width(0) : width) / 2, undefined, k);
    let total = 0;
    const seg = [];
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); total += l; }
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const wa = typeof width === 'function' ? width(total ? acc / total : 0) : width;
      acc += seg[i - 1];
      const wb = typeof width === 'function' ? width(total ? acc / total : 1) : width;
      this.capsule(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], wa / 2, wb / 2, k);
    }
    return this;
  }

  circle(cx, cy, r, k = 1) { return this.capsule(cx, cy, cx, cy, r, r, k); }

  /** A flat-ended bar a→b of half width r (stencils, printed rules). */
  bar(ax, ay, bx, by, r, k = 1) {
    const { w, h, d } = this;
    const rm = r + 1.5;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - rm)), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + rm));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - rm)), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + rm));
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    if (L < 1e-6) return this;
    const ux = dx / L, uy = dy / L;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5 - ax, py = y + 0.5 - ay;
        const u = px * ux + py * uy, v = Math.abs(-px * uy + py * ux);
        const cl = Math.min(u, L - u) + 0.5, cw = r + 0.5 - v;
        if (cl <= 0 || cw <= 0) continue;
        const val = Math.min(1, cl) * Math.min(1, cw) * k;
        const i = y * w + x;
        if (val > d[i]) d[i] = val;
      }
    }
    return this;
  }

  /** A butt-capped polyline with round joins. */
  strokeButt(pts, width, k = 1) {
    for (let i = 1; i < pts.length; i++) this.bar(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], width / 2, k);
    for (let i = 1; i < pts.length - 1; i++) this.circle(pts[i][0], pts[i][1], width / 2, k);
    return this;
  }

  /** Rotated ellipse (approximate distance; fine for AA edges). */
  ellipse(cx, cy, rx, ry, rot = 0, k = 1) {
    const { w, h, d } = this;
    const R = Math.max(rx, ry) + 1.5;
    const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(w - 1, Math.ceil(cx + R));
    const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(h - 1, Math.ceil(cy + R));
    const c = Math.cos(rot), s = Math.sin(rot), mr = Math.min(rx, ry);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5 - cx, py = y + 0.5 - cy;
        const lx = (px * c + py * s) / rx, ly = (-px * s + py * c) / ry;
        const dd = (Math.sqrt(lx * lx + ly * ly) - 1) * mr;
        const v0 = 0.5 - dd;
        if (v0 <= 0) continue;
        const v = (v0 > 1 ? 1 : v0) * k;
        const i = y * w + x;
        if (v > d[i]) d[i] = v;
      }
    }
    return this;
  }

  /** Rounded rectangle centred at (cx, cy), size sw × sh, corner radius r, rotation rot. */
  rect(cx, cy, sw, sh, r = 0, rot = 0, k = 1) {
    const { w, h, d } = this;
    const R = Math.hypot(sw, sh) / 2 + 1.5;
    const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(w - 1, Math.ceil(cx + R));
    const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(h - 1, Math.ceil(cy + R));
    const c = Math.cos(rot), s = Math.sin(rot);
    const hx = sw / 2 - r, hy = sh / 2 - r;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5 - cx, py = y + 0.5 - cy;
        const lx = Math.abs(px * c + py * s) - hx, ly = Math.abs(-px * s + py * c) - hy;
        const ox = lx > 0 ? lx : 0, oy = ly > 0 ? ly : 0;
        const dd = Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(lx, ly), 0) - r;
        const v0 = 0.5 - dd;
        if (v0 <= 0) continue;
        const v = (v0 > 1 ? 1 : v0) * k;
        const i = y * w + x;
        if (v > d[i]) d[i] = v;
      }
    }
    return this;
  }

  /** Non-zero polygon fill (one or more rings), anti-aliased with 5 sub-scanlines. */
  poly(rings, k = 1) {
    if (!rings.length) return this;
    if (typeof rings[0][0] === 'number') rings = [rings];
    const { w, h, d } = this;
    const edges = [];
    let ymin = Infinity, ymax = -Infinity;
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        if (a[1] === b[1]) continue;
        const dir = b[1] > a[1] ? 1 : -1;
        const [p, q] = dir > 0 ? [a, b] : [b, a];
        edges.push([p[0], p[1], q[0], q[1], dir]);
        ymin = Math.min(ymin, p[1]);
        ymax = Math.max(ymax, q[1]);
      }
    }
    const SUB = 5;
    const acc = new Float32Array(w + 2);
    const ya = Math.max(0, Math.floor(ymin)), yb = Math.min(h - 1, Math.ceil(ymax));
    const xs = [];
    for (let y = ya; y <= yb; y++) {
      acc.fill(0);
      let any = false, lo = w, hi = 0;
      for (let s = 0; s < SUB; s++) {
        const sy = y + (s + 0.5) / SUB;
        xs.length = 0;
        for (const e of edges) {
          if (sy < e[1] || sy >= e[3]) continue;
          xs.push([e[0] + (e[2] - e[0]) * (sy - e[1]) / (e[3] - e[1]), e[4]]);
        }
        if (xs.length < 2) continue;
        xs.sort((p, q) => p[0] - q[0]);
        let wind = 0;
        for (let i = 0; i < xs.length - 1; i++) {
          wind += xs[i][1];
          if (wind === 0) continue;
          let xa = xs[i][0], xb = xs[i + 1][0];
          if (xb <= 0 || xa >= w) continue;
          xa = Math.max(0, xa); xb = Math.min(w, xb);
          any = true;
          const ia = Math.floor(xa), ib = Math.floor(xb);
          lo = Math.min(lo, ia); hi = Math.max(hi, ib);
          if (ia === ib) { acc[ia] += (xb - xa) / SUB; continue; }
          acc[ia] += (ia + 1 - xa) / SUB;
          for (let x = ia + 1; x < ib; x++) acc[x] += 1 / SUB;
          if (ib < w) acc[ib] += (xb - ib) / SUB;
        }
      }
      if (!any) continue;
      for (let x = lo; x <= Math.min(hi, w - 1); x++) {
        const v = Math.min(1, acc[x]) * k;
        const i = y * w + x;
        if (v > d[i]) d[i] = v;
      }
    }
    return this;
  }

  /** Per-pixel function: d = f(x, y, d). */
  map(f) {
    const { w, h, d } = this;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; d[i] = f(x, y, d[i]); }
    return this;
  }

  /** Multiply by a function of (x, y). */
  mulBy(f) {
    const { w, h, d } = this;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (d[i] > 0) d[i] *= f(x, y); }
    return this;
  }

  max(o) { const a = this.d, b = o.d; for (let i = 0; i < a.length; i++) if (b[i] > a[i]) a[i] = b[i]; return this; }
  min(o) { const a = this.d, b = o.d; for (let i = 0; i < a.length; i++) if (b[i] < a[i]) a[i] = b[i]; return this; }
  mul(o) { const a = this.d, b = o.d; for (let i = 0; i < a.length; i++) a[i] *= b[i]; return this; }
  cut(o, k = 1) { const a = this.d, b = o.d; for (let i = 0; i < a.length; i++) a[i] *= 1 - b[i] * k; return this; }
  scale(k) { const a = this.d; for (let i = 0; i < a.length; i++) a[i] = Math.min(1, a[i] * k); return this; }
  invert() { const a = this.d; for (let i = 0; i < a.length; i++) a[i] = 1 - a[i]; return this; }
  fill(v = 1) { this.d.fill(v); return this; }

  /** Threshold with a soft edge: smoothstep(t - s, t + s). */
  thresh(t, s = 0.05) { const a = this.d; for (let i = 0; i < a.length; i++) a[i] = smoothstep(t - s, t + s, a[i]); return this; }

  /** Gaussian-ish blur: three box passes of radius r (pixels). */
  blur(r) {
    if (r < 0.5) return this;
    const R = Math.max(1, Math.round(r / 1.7));
    for (let p = 0; p < 3; p++) { boxH(this.d, this.w, this.h, R); boxV(this.d, this.w, this.h, R); }
    return this;
  }

  /** Grow (r > 0) or shrink (r < 0) by a soft amount (blur + threshold). */
  grow(r) {
    this.blur(Math.abs(r));
    return this.thresh(r > 0 ? 0.25 : 0.75, 0.2);
  }

  /** Shift by (dx, dy) pixels (integer). */
  shifted(dx, dy) {
    const m = new Mask(this.w, this.h);
    const { w, h } = this;
    for (let y = 0; y < h; y++) {
      const sy = y - dy;
      if (sy < 0 || sy >= h) continue;
      for (let x = 0; x < w; x++) {
        const sx = x - dx;
        if (sx < 0 || sx >= w) continue;
        m.d[y * w + x] = this.d[sy * w + sx];
      }
    }
    return m;
  }

  /** Displace by a noise field (warp edges): amp pixels, freq per pixel. */
  warp(amp, freq, seed = 0) {
    const { w, h, d } = this;
    const src = d.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ox = (fbm(x * freq, y * freq, 3, seed) - 0.5) * 2 * amp;
        const oy = (fbm(x * freq + 31.7, y * freq + 11.3, 3, seed + 7) - 0.5) * 2 * amp;
        d[y * w + x] = sample(src, w, h, x + ox, y + oy);
      }
    }
    return this;
  }

  sum() { let s = 0; for (const v of this.d) s += v; return s; }
}

function sample(a, w, h, x, y) {
  x -= 0.5; y -= 0.5;
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const g = (xx, yy) => (xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : a[yy * w + xx]);
  return (g(xi, yi) * (1 - fx) + g(xi + 1, yi) * fx) * (1 - fy) + (g(xi, yi + 1) * (1 - fx) + g(xi + 1, yi + 1) * fx) * fy;
}

function boxH(a, w, h, r) {
  const row = new Float32Array(w);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let s = 0;
    for (let x = -r; x <= r; x++) s += a[o + Math.min(w - 1, Math.max(0, x))] * (x < 0 || x >= w ? 0 : 1);
    for (let x = 0; x < w; x++) {
      row[x] = s / n;
      const add = x + r + 1, sub = x - r;
      s += (add < w ? a[o + add] : 0) - (sub >= 0 ? a[o + sub] : 0);
    }
    a.set(row, o);
  }
}

function boxV(a, w, h, r) {
  const col = new Float32Array(h);
  const n = 2 * r + 1;
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = 0; y <= r && y < h; y++) s += a[y * w + x];
    for (let y = 0; y < h; y++) {
      col[y] = s / n;
      const add = y + r + 1, sub = y - r;
      s += (add < h ? a[add * w + x] : 0) - (sub >= 0 ? a[sub * w + x] : 0);
    }
    for (let y = 0; y < h; y++) a[y * w + x] = col[y];
  }
}

// ---------------------------------------------------------------------------------------

export class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.c = new Float32Array(w * h * 4);   // premultiplied rgba
    this.ht = new Float32Array(w * h);      // height (pixels of relief; + up)
    this.ro = new Float32Array(w * h).fill(0.85);   // roughness
  }

  mask() { return new Mask(this.w, this.h); }

  /**
   * Composite colour through a mask (source-over). col: [r, g, b] or (x, y) → [r, g, b];
   * opts.rough sets the roughness where painted; opts.alpha a function (x, y) → 0..1 too.
   */
  paint(m, col, alpha = 1, opts = {}) {
    const { w, h, c, ro } = this;
    const fn = typeof col === 'function';
    const af = typeof alpha === 'function';
    const rough = opts.rough;
    const md = m.d;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const mv = md[i];
        if (mv <= 0.0005) continue;
        const a = mv * (af ? alpha(x, y) : alpha);
        if (a <= 0) continue;
        const k = fn ? col(x, y) : col;
        const j = i * 4, ia = 1 - a;
        c[j] = k[0] * a + c[j] * ia;
        c[j + 1] = k[1] * a + c[j + 1] * ia;
        c[j + 2] = k[2] * a + c[j + 2] * ia;
        c[j + 3] = a + c[j + 3] * ia;
        if (rough !== undefined) ro[i] = ro[i] * ia + (typeof rough === 'function' ? rough(x, y) : rough) * a;
      }
    }
    return this;
  }

  /** Multiply the colour (not alpha) through a mask: darken / tint. col [r, g, b] or fn. */
  multiply(m, col, k = 1) {
    const { w, h, c } = this;
    const fn = typeof col === 'function';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, mv = m.d[i] * k;
        if (mv <= 0) continue;
        const t = fn ? col(x, y) : col;
        const j = i * 4;
        c[j] *= 1 - mv + mv * t[0];
        c[j + 1] *= 1 - mv + mv * t[1];
        c[j + 2] *= 1 - mv + mv * t[2];
      }
    }
    return this;
  }

  /** Cut alpha (and colour, premultiplied) through a mask. */
  erase(m, k = 1) {
    const { c } = this;
    for (let i = 0; i < m.d.length; i++) {
      const v = 1 - m.d[i] * k;
      if (v >= 1) continue;
      const j = i * 4;
      c[j] *= v; c[j + 1] *= v; c[j + 2] *= v; c[j + 3] *= v;
    }
    return this;
  }

  /** Scale alpha everywhere by f(x, y) (fades). */
  fade(f) {
    const { w, h, c } = this;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const j = (y * w + x) * 4;
      if (c[j + 3] <= 0) continue;
      const v = typeof f === 'function' ? f(x, y) : f;
      c[j] *= v; c[j + 1] *= v; c[j + 2] *= v; c[j + 3] *= v;
    }
    return this;
  }

  /** Add relief: ht += m * amt (mode 'max' keeps the highest). */
  lift(m, amt, mode = 'add') {
    const { ht } = this;
    const fn = typeof amt === 'function';
    for (let i = 0; i < ht.length; i++) {
      const v = m.d[i];
      if (v <= 0) continue;
      const a = fn ? amt(i % this.w, (i / this.w) | 0) : amt;
      if (mode === 'max') ht[i] = Math.max(ht[i], v * a); else ht[i] += v * a;
    }
    return this;
  }

  /** Roughness through a mask. */
  rough(m, r) {
    const { ro } = this;
    for (let i = 0; i < ro.length; i++) { const v = m.d[i]; if (v > 0) ro[i] = ro[i] * (1 - v) + r * v; }
    return this;
  }

  /** The alpha channel as a mask. */
  alphaMask() {
    const m = this.mask();
    for (let i = 0; i < m.d.length; i++) m.d[i] = this.c[i * 4 + 3];
    return m;
  }

  /** Straight (un-premultiplied) colour at a pixel. */
  get(x, y) {
    const j = (y * this.w + x) * 4, a = this.c[j + 3];
    return a > 1e-6 ? [this.c[j] / a, this.c[j + 1] / a, this.c[j + 2] / a, a] : [0, 0, 0, 0];
  }
}
