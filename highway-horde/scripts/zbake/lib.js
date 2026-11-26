// The zombie texture baker's toolkit (scripts/bake-zombies.js): a PNG writer and reader on
// node's zlib, seeded randomness, tileable noise (gradient fBm, ridged, cellular), float fields
// with wrap-around blur, height → normal / cavity, and soft brushes (dots, strokes, branching
// trees) that wrap at the tile edge. Plain node, no dependencies; everything is a pure function
// of its seed, so a bake is byte-for-byte repeatable.

import { deflateSync, inflateSync } from 'node:zlib';

// ---------------------------------------------------------------------------------------
// PNG

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(buf, start = 0, end = buf.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out, 4, 8 + data.length), 8 + data.length);
  return out;
}

const COLOR_TYPE = { 1: 0, 2: 4, 3: 2, 4: 6 };

/**
 * Encode 8-bit pixels (rows top to bottom, `ch` channels: 1 grey, 2 grey+alpha, 3 RGB, 4 RGBA)
 * as a PNG. Each row gets the filter with the smallest sum of absolute residuals.
 */
export function encodePNG(w, h, ch, px) {
  const stride = w * ch;
  const raw = Buffer.alloc((stride + 1) * h);
  const cand = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)];
  for (let y = 0; y < h; y++) {
    const row = y * stride, prev = (y - 1) * stride;
    for (let i = 0; i < stride; i++) {
      const x = px[row + i];
      const a = i >= ch ? px[row + i - ch] : 0;
      const b = y > 0 ? px[prev + i] : 0;
      const c = y > 0 && i >= ch ? px[prev + i - ch] : 0;
      cand[0][i] = x;
      cand[1][i] = (x - a) & 255;
      cand[2][i] = (x - b) & 255;
      cand[3][i] = (x - ((a + b) >> 1)) & 255;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      cand[4][i] = (x - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
    }
    let best = 0, bestS = Infinity;
    for (let f = 0; f < 5; f++) {
      let s = 0;
      const cf = cand[f];
      for (let i = 0; i < stride; i++) { const v = cf[i]; s += v < 128 ? v : 256 - v; }
      if (s < bestS) { bestS = s; best = f; }
    }
    raw[y * (stride + 1)] = best;
    cand[best].copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = COLOR_TYPE[ch];
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9, memLevel: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Decode an 8-bit, non-interlaced PNG (any colour type but palette) → { w, h, ch, px }. Checks every CRC. */
export function decodePNG(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error('not a PNG');
  let o = 8, w = 0, h = 0, ch = 0;
  const idat = [];
  let ended = false;
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString('ascii', o + 4, o + 8);
    if (crc32(buf, o + 4, o + 8 + len) !== buf.readUInt32BE(o + 8 + len)) throw new Error('bad CRC in ' + type);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('unsupported PNG');
      ch = { 0: 1, 4: 2, 2: 3, 6: 4 }[data[9]];
      if (!ch) throw new Error('unsupported colour type');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') { ended = true; break; }
    o += 12 + len;
  }
  if (!ended || !w) throw new Error('truncated PNG');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  if (raw.length !== (stride + 1) * h) throw new Error('bad image data size');
  const px = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride, prev = row - stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? px[row + i - ch] : 0, b = y > 0 ? px[prev + i] : 0, c = y > 0 && i >= ch ? px[prev + i - ch] : 0;
      let v = raw[src + i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (f !== 0) throw new Error('bad filter');
      px[row + i] = v & 255;
    }
  }
  return { w, h, ch, px };
}

// ---------------------------------------------------------------------------------------
// randomness

export function rng(seed) {
  let a = (seed * 2654435761) >>> 0 ^ 0x9e3779b9;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash → [0, 1). */
export function hash3(x, y, s) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------------------
// tileable noise (lattice coordinates; px, py are the integer periods)

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const GX = new Float32Array(256), GY = new Float32Array(256);
for (let i = 0; i < 256; i++) { const a = (i / 256) * Math.PI * 2 + 0.3; GX[i] = Math.cos(a); GY[i] = Math.sin(a); }

function grad(ix, iy, s, fx, fy) {
  const g = (hash3(ix, iy, s) * 256) | 0;
  return GX[g] * fx + GY[g] * fy;
}

/** Periodic gradient noise, about −1..1. */
export function noise(x, y, px, py, s) {
  const xf = Math.floor(x), yf = Math.floor(y);
  const fx = x - xf, fy = y - yf;
  const x0 = ((xf % px) + px) % px, y0 = ((yf % py) + py) % py;
  const x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
  const u = fade(fx), v = fade(fy);
  const a = grad(x0, y0, s, fx, fy), b = grad(x1, y0, s, fx - 1, fy);
  const c = grad(x0, y1, s, fx, fy - 1), d = grad(x1, y1, s, fx - 1, fy - 1);
  return (a + (b - a) * u + (c - a + (a - b - c + d) * u) * v) * 1.41;
}

/** Tileable fBm on the unit square: base frequency f (integer), `oct` octaves → about −1..1. */
export function fbm(u, v, f, oct, s, gain = 0.5, lac = 2) {
  let sum = 0, amp = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += noise(u * f, v * f, f, f, s + o * 101) * amp;
    norm += amp;
    amp *= gain;
    f *= lac;
  }
  return sum / norm;
}

/** Ridged fBm (sharp creases where the noise crosses zero) → 0..1. */
export function ridged(u, v, f, oct, s, gain = 0.55) {
  let sum = 0, amp = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    const n = 1 - Math.abs(noise(u * f, v * f, f, f, s + o * 131));
    sum += n * n * amp;
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

/**
 * Periodic cellular noise at f cells a side: F1, F2 (in cell units) and the nearest cell's id
 * (written into `out`). `jit` is how far a cell's point strays from the cell centre.
 */
export function cells(u, v, f, s, out, jit = 1) {
  const x = u * f, y = v * f;
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0, nx = 0, ny = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i, cy = yi + j;
      const wx = ((cx % f) + f) % f, wy = ((cy % f) + f) % f;
      const px = cx + 0.5 + (hash3(wx, wy, s) - 0.5) * jit, py = cy + 0.5 + (hash3(wx, wy, s + 7) - 0.5) * jit;
      const d = Math.hypot(px - x, py - y);
      if (d < f1) { f2 = f1; f1 = d; id = wx + wy * f; nx = px - x; ny = py - y; } else if (d < f2) f2 = d;
    }
  }
  out.f1 = f1; out.f2 = f2; out.id = id; out.dx = nx; out.dy = ny;
  return out;
}

// ---------------------------------------------------------------------------------------
// fields (N×N Float32Array, row = v * N from the bottom, x = u * N)

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const mix = (a, b, t) => a + (b - a) * t;
export const gauss = (x, s) => Math.exp(-(x * x) / (2 * s * s));

/** A field filled per pixel by fn(u, v, i). */
export function field(N, fn) {
  const f = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    const v = (y + 0.5) / N;
    for (let x = 0; x < N; x++) f[y * N + x] = fn((x + 0.5) / N, v, y * N + x);
  }
  return f;
}

/** Wrap-around (or clamped) box blur, three passes ≈ a gaussian of the given radius in pixels. */
export function blur(src, N, r, wrap = true) {
  r = Math.max(1, Math.round(r));
  let a = Float32Array.from(src), b = new Float32Array(N * N);
  const pass = (from, to, horiz) => {
    const inv = 1 / (2 * r + 1);
    for (let l = 0; l < N; l++) {
      let s = 0;
      const at = (k) => {
        if (wrap) k = ((k % N) + N) % N; else k = k < 0 ? 0 : k >= N ? N - 1 : k;
        return horiz ? from[l * N + k] : from[k * N + l];
      };
      for (let k = -r; k <= r; k++) s += at(k);
      for (let k = 0; k < N; k++) {
        if (horiz) to[l * N + k] = s * inv; else to[k * N + l] = s * inv;
        s += at(k + r + 1) - at(k - r);
      }
    }
  };
  for (let i = 0; i < 3; i++) { pass(a, b, true); pass(b, a, false); }
  return a;
}

/** Tangent-space normals (x, y as −1..1) from a height field in "pixels of the full-size map". */
export function normals(h, N, strength, wrap = true) {
  const nx = new Float32Array(N * N), ny = new Float32Array(N * N);
  const k = strength * N / 2048;
  const at = (x, y) => {
    if (wrap) { x = (x + N) % N; y = (y + N) % N; } else { x = x < 0 ? 0 : x >= N ? N - 1 : x; y = y < 0 ? 0 : y >= N ? N - 1 : y; }
    return h[y * N + x];
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * k, dy = (at(x, y + 1) - at(x, y - 1)) * 0.5 * k;
      const l = Math.hypot(dx, dy, 1);
      nx[y * N + x] = -dx / l;
      ny[y * N + x] = -dy / l;
    }
  }
  return { nx, ny };
}

/** Cavity (0 open .. 1 deep): how far a point sits below its blurred neighbourhood. */
export function cavity(h, N, r, scale, wrap = true) {
  const b = blur(h, N, r * N / 2048, wrap);
  const out = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) out[i] = clamp01((b[i] - h[i]) * scale);
  return out;
}

// ---------------------------------------------------------------------------------------
// brushes (unit-square coordinates, wrapping at the edges when `wrap`)

/**
 * Stamp fn(dx, dy) (offsets in unit-square units, |d| < r) into a field around (cx, cy) by
 * `op`: 'max', 'add', 'min' or a function(old, value).
 */
export function stamp(f, N, cx, cy, r, fn, op = 'max', wrap = true) {
  const x0 = Math.floor((cx - r) * N), x1 = Math.ceil((cx + r) * N);
  const y0 = Math.floor((cy - r) * N), y1 = Math.ceil((cy + r) * N);
  for (let y = y0; y <= y1; y++) {
    let yy = y;
    if (wrap) yy = ((y % N) + N) % N; else if (y < 0 || y >= N) continue;
    const dy = (y + 0.5) / N - cy;
    for (let x = x0; x <= x1; x++) {
      let xx = x;
      if (wrap) xx = ((x % N) + N) % N; else if (x < 0 || x >= N) continue;
      const dx = (x + 0.5) / N - cx;
      const v = fn(dx, dy);
      if (v === 0 || v === undefined) continue;
      const i = yy * N + xx;
      if (op === 'max') { if (v > f[i]) f[i] = v; } else if (op === 'add') f[i] += v; else if (op === 'min') { if (v < f[i]) f[i] = v; } else f[i] = op(f[i], v, i);
    }
  }
}

/** Distance from p to the segment a-b and the position along it (0..1). */
export function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const l2 = vx * vx + vy * vy || 1e-12;
  const t = clamp01(((px - ax) * vx + (py - ay) * vy) / l2);
  const dx = px - ax - vx * t, dy = py - ay - vy * t;
  return [Math.sqrt(dx * dx + dy * dy), t];
}

/**
 * A soft stroke along a polyline [[x, y, width], ...]: value(d / width, along) with d the
 * distance to the line; max-blended. `prof` maps the normalised distance (0 centre, 1 edge) to a value.
 */
export function stroke(f, N, pts, prof, op = 'max', wrap = true) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay, aw] = pts[i], [bx, by, bw] = pts[i + 1];
    const w = Math.max(aw, bw);
    const cx = (ax + bx) / 2, cy = (ay + by) / 2;
    const r = Math.hypot(bx - ax, by - ay) / 2 + w * 1.05;
    stamp(f, N, cx, cy, r, (dx, dy) => {
      const [d, t] = segDist(cx + dx, cy + dy, ax, ay, bx, by);
      const ww = aw + (bw - aw) * t;
      if (d >= ww) return 0;
      return prof(d / ww, (i + t) / (pts.length - 1));
    }, op, wrap);
  }
}

/**
 * A branching tree of curved strokes (veins, cracks, scars): starts at (x, y) heading `a`,
 * `len` long and `w` wide, splitting `depth` times. Calls draw(points, level) for each branch.
 */
export function tree(r, x, y, a, len, w, depth, draw, opt = {}) {
  const curl = opt.curl ?? 0.35, split = opt.split ?? 0.55, shrink = opt.shrink ?? 0.68, taper = opt.taper ?? 0.6;
  const steps = Math.max(3, Math.round(len / (opt.step || 0.006)));
  const pts = [];
  let px = x, py = y, ang = a;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    pts.push([px, py, w * (1 - t * taper)]);
    ang += (r() - 0.5) * curl;
    px += Math.cos(ang) * len / steps;
    py += Math.sin(ang) * len / steps;
    if (depth > 0 && s > 1 && s < steps - 1 && r() < split / steps * 3) {
      const side = r() < 0.5 ? -1 : 1;
      tree(r, px, py, ang + side * (0.4 + r() * 0.6), len * (0.35 + r() * 0.35), w * shrink * (1 - t * taper * 0.5), depth - 1, draw, opt);
    }
  }
  draw(pts, opt.level || 0);
}

// ---------------------------------------------------------------------------------------
// colour

/** '#rrggbb' → linear [r, g, b]. */
export function lin(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return c.map((x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
}
export function toSrgb8(x) {
  x = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return Math.round((x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055) * 255);
}
export const to8 = (x) => Math.round(clamp01(x) * 255);

/** An RGB image of linear floats (three planes) with painting helpers. */
export class Rgb {
  constructor(N) { this.N = N; this.r = new Float32Array(N * N); this.g = new Float32Array(N * N); this.b = new Float32Array(N * N); }
  fill(c) { this.r.fill(c[0]); this.g.fill(c[1]); this.b.fill(c[2]); return this; }
  /** Blend colour c over pixel i by t (0..1). */
  lay(i, c, t) {
    if (t <= 0) return;
    if (t > 1) t = 1;
    this.r[i] += (c[0] - this.r[i]) * t; this.g[i] += (c[1] - this.g[i]) * t; this.b[i] += (c[2] - this.b[i]) * t;
  }
  /** Multiply pixel i by colour c blended by t. */
  mul(i, c, t = 1) {
    if (t <= 0) return;
    this.r[i] *= 1 + (c[0] - 1) * t; this.g[i] *= 1 + (c[1] - 1) * t; this.b[i] *= 1 + (c[2] - 1) * t;
  }
  scale(i, k) { this.r[i] *= k; this.g[i] *= k; this.b[i] *= k; }
  lum(i) { return this.r[i] * 0.2126 + this.g[i] * 0.7152 + this.b[i] * 0.0722; }
}

/** Mix two linear colours. */
export const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** Multiply a colour by a scalar. */
export const sc = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
