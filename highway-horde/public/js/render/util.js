// Small helpers shared by the render modules: offscreen canvases, colour maths and a
// tileable value-noise generator for the procedural textures. Browser only.

import { createRng, hashString } from '../shared/rng.js';

export { createRng, hashString };

/**
 * Create an offscreen 2D canvas. Plain <canvas> elements are used instead of
 * OffscreenCanvas because every browser can drawImage() them and they are GPU backed.
 * @param {number} w width in texels
 * @param {number} h height in texels
 * @returns {HTMLCanvasElement}
 */
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/** 2D context helper that asks for the fast path when available. */
export function ctx2d(canvas, opts) {
  return canvas.getContext('2d', opts);
}

/** Free the backing store of a canvas right away instead of waiting for GC. */
export function releaseCanvas(c) {
  if (!c) return;
  c.width = 1;
  c.height = 1;
}

// ---- colour ------------------------------------------------------------------------

const rgbCache = new Map();

/** Parse '#rgb' / '#rrggbb' into [r, g, b] (0..255). Cached. */
export function hexToRgb(hex) {
  let v = rgbCache.get(hex);
  if (v) return v;
  let h = String(hex || '#000').replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16) || 0;
  v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  rgbCache.set(hex, v);
  return v;
}

function toHex2(v) {
  const s = Math.round(Math.max(0, Math.min(255, v))).toString(16);
  return s.length < 2 ? '0' + s : s;
}

/** [r, g, b] → '#rrggbb'. */
export function rgbToHex(r, g, b) {
  return '#' + toHex2(r) + toHex2(g) + toHex2(b);
}

/** Mix two hex colours, t = 0 → a, 1 → b. */
export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

/** Lighten (amt > 0) or darken (amt < 0) a hex colour by mixing with white/black. */
export function shade(hex, amt) {
  return amt >= 0 ? mix(hex, '#ffffff', amt) : mix(hex, '#000000', -amt);
}

/** Hex colour with alpha as an rgba() string. */
export function rgba(hex, a) {
  const c = hexToRgb(hex);
  return `rgba(${c[0]},${c[1]},${c[2]},${Math.round(a * 1000) / 1000})`;
}

/** Increase saturation/brightness of a colour (used to make entities pop at night). */
export function vivid(hex, sat = 0.2, light = 0.05) {
  const [r, g, b] = hexToRgb(hex);
  const avg = (r + g + b) / 3;
  const k = 1 + sat;
  const L = 1 + light;
  return rgbToHex((avg + (r - avg) * k) * L, (avg + (g - avg) * k) * L, (avg + (b - avg) * k) * L);
}

// ---- noise ---------------------------------------------------------------------------

/**
 * Periodic value noise on a `cells` x `cells` lattice, so textures built from it tile
 * seamlessly. Returns sample(u, v) for u, v in [0, 1) → [0, 1].
 */
export function periodicNoise(cells, rng) {
  const lat = new Float32Array(cells * cells);
  for (let i = 0; i < lat.length; i++) lat[i] = rng.next();
  return (u, v) => {
    const x = u * cells, y = v * cells;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const xa = ((x0 % cells) + cells) % cells, ya = ((y0 % cells) + cells) % cells;
    const xb = (xa + 1) % cells, yb = (ya + 1) % cells;
    const a = lat[ya * cells + xa], b = lat[ya * cells + xb];
    const c = lat[yb * cells + xa], d = lat[yb * cells + xb];
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  };
}

/** Fractal (fBm) periodic noise: octaves of periodicNoise, normalised to [0, 1]. */
export function periodicFbm(baseCells, octaves, rng, gain = 0.5) {
  const layers = [];
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    layers.push({ fn: periodicNoise(baseCells << o, rng), amp });
    total += amp;
    amp *= gain;
  }
  return (u, v) => {
    let s = 0;
    for (let i = 0; i < layers.length; i++) s += layers[i].fn(u, v) * layers[i].amp;
    return s / total;
  };
}

/** Cheap integer hash → [0, 1). Used for per-entity variation without an rng stream. */
export function hash01(n) {
  n = (n | 0) ^ 0x27d4eb2d;
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
  n ^= n >>> 15;
  return (n >>> 0) / 4294967296;
}

/** Rounded rectangle path (no reliance on ctx.roundRect, which older Safari lacks). */
export function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** Fill a rounded rect in one call. */
export function fillRoundRect(ctx, x, y, w, h, r, style) {
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, r);
  if (style) ctx.fillStyle = style;
  ctx.fill();
}

/** Filled circle. */
export function fillCircle(ctx, x, y, r, style) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (style) ctx.fillStyle = style;
  ctx.fill();
}

/** Filled ellipse (axis aligned in the current transform). */
export function fillEllipse(ctx, x, y, rx, ry, style, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, Math.PI * 2);
  if (style) ctx.fillStyle = style;
  ctx.fill();
}

/** Irregular blob polygon around (x, y) — rocks, puddles, bushes. */
export function blobPath(ctx, x, y, r, rng, points = 9, jag = 0.3) {
  ctx.beginPath();
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const rr = r * (1 - jag / 2 + rng.next() * jag);
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** A soft radial sprite: white core fading to transparent. */
export function makeRadialSprite(size, stops, color = '#ffffff') {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const [r, gg, b] = hexToRgb(color);
  for (const [t, a] of stops) grad.addColorStop(t, `rgba(${r},${gg},${b},${a})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}
