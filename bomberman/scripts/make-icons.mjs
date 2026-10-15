#!/usr/bin/env node
// Draws the Blast Party app icon and writes client/icons/*. Run it with `node scripts/make-icons.mjs`; the outputs
// are committed, so nobody has to run it to play (docs/SPEC.md section 8.3).
//
//   icon.svg               the design as hand-authored SVG (used as the browser tab icon and as the "any" size)
//   icon-192.png icon-512.png     "any" purpose: rounded square with transparent corners
//   icon-maskable-512.png         "maskable" purpose: full-bleed background, art shrunk into the 80 % safe zone
//   apple-touch-icon.png          180 px and OPAQUE (iOS paints transparency black and rounds the corners itself)
//   favicon-32.png                32 px fallback for browsers without SVG favicons
//
// No dependencies: a tiny signed-distance-field rasteriser (analytic anti-aliasing, so every size is drawn natively
// instead of being downscaled) feeds a PNG encoder built on node:zlib plus a CRC-32 table.
//
// The art is defined once in a 512 x 512 design space; the raster code and the SVG both read the constants below.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------------------------------------------
// PNG encoder
// ---------------------------------------------------------------------------------------------------------------

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** PNG scanline filters 0..4 (None, Sub, Up, Average, Paeth) applied to one row; `bpp` = bytes per pixel. */
function filterRow(type, row, prev, bpp) {
  const out = new Uint8Array(row.length);
  for (let i = 0; i < row.length; i++) {
    const left = i >= bpp ? row[i - bpp] : 0;
    const up = prev[i];
    const upLeft = i >= bpp ? prev[i - bpp] : 0;
    const predicted = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][type];
    out[i] = (row[i] - predicted) & 0xff;
  }
  return out;
}

/**
 * Encodes 8-bit pixels as a PNG.
 * @param {{ width: number, height: number, rgba: Uint8Array, opaque?: boolean }} image `rgba` holds 4 bytes per pixel,
 *   straight (not premultiplied) alpha. With `opaque` the alpha channel is dropped and an RGB image is written.
 * @returns {Buffer}
 */
export function encodePng({ width, height, rgba, opaque = false }) {
  const bpp = opaque ? 3 : 4;
  const stride = width * bpp;
  const raw = Buffer.alloc((stride + 1) * height);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(stride);
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < bpp; c++) row[x * bpp + c] = rgba[(y * width + x) * 4 + c];
    }
    // Per-row choice of the filter whose output is closest to zero: the usual cheap heuristic for good compression.
    let best = null;
    let bestType = 0;
    let bestCost = Infinity;
    for (let type = 0; type < 5; type++) {
      const candidate = filterRow(type, row, prev, bpp);
      let cost = 0;
      for (const b of candidate) cost += b < 128 ? b : 256 - b;
      if (cost < bestCost) [best, bestType, bestCost] = [candidate, type, cost];
    }
    raw[y * (stride + 1)] = bestType;
    raw.set(best, y * (stride + 1) + 1);
    prev = row;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = opaque ? 2 : 6; // colour type: truecolour / truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------------------------------------------
// The design (512 x 512 units)
// ---------------------------------------------------------------------------------------------------------------

const SIZE = 512;
const CORNER = 112; // 22 % of the side: what iOS and Android round to, so the "any" icon looks native

// Electric indigo to violet to hot pink: the yellow spark and the black bomb both stay vivid against every stop.
const BG_STOPS = [
  [0, '#5b6cff'],
  [0.5, '#a24df0'],
  [1, '#ff5fa2'],
];
const CONFETTI = [ // [x, y, length, thickness, angle in degrees, colour]: from the player palette, kept off the bomb
  [66, 96, 26, 11, 32, '#ffd23f'],
  [132, 50, 22, 10, -24, '#2ed9e6'],
  [452, 244, 24, 11, 62, '#ffffff'],
  [470, 356, 26, 11, -35, '#ffd23f'],
  [438, 452, 22, 10, 18, '#2ed9e6'],
  [54, 388, 24, 11, -50, '#38c85a'],
  [76, 470, 20, 9, 40, '#ffffff'],
];
const BODY = { x: 226, y: 302, r: 148 };
const CAP_ANGLE = (-55 * Math.PI) / 180; // the neck points up and to the right
const CAP_DIR = { x: Math.cos(CAP_ANGLE), y: Math.sin(CAP_ANGLE) };
const FUSE = [ // cubic Bezier from the top of the neck, hooking over to the spark
  [CAP_DIR.x * (BODY.r + 34) + BODY.x, CAP_DIR.y * (BODY.r + 34) + BODY.y],
  [316, 98],
  [366, 52],
  [412, 106],
];
const SPARK = { x: FUSE[3][0], y: FUSE[3][1] };
const SPARK_R = 62;
const SPARK_R_BIG = SPARK_R * 1.3; // favicon: the spark must survive 32 px
const SPARK_VERTICES = starPolygon(SPARK.x, SPARK.y, SPARK_R, 23, 8, 0.2);
const SPARK_VERTICES_BIG = starPolygon(SPARK.x, SPARK.y, SPARK_R_BIG, 30, 8, 0.2);
const SPARKLES = [ // small four-point stars around the big one: [dx, dy, radius]
  [58, -50, 14],
  [72, 46, 12],
  [-4, -82, 10],
].map(([dx, dy, r]) => ({ r, vertices: starPolygon(SPARK.x + dx, SPARK.y + dy, r, r * 0.28, 4, 0) }));
const SHADOW = { x: 226, y: 468, rx: 138, ry: 17 };

// ---------------------------------------------------------------------------------------------------------------
// Tiny vector maths
// ---------------------------------------------------------------------------------------------------------------

const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
const mix = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const mixRgb = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/** Piecewise-linear colour ramp; `stops` = [[position, colour], …] with colour as [r, g, b] in 0..1. */
function ramp(stops, t) {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) return mixRgb(stops[i - 1][1], stops[i][1], (t - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
  }
  return stops[stops.length - 1][1];
}
const rampOf = (stops) => stops.map(([t, hex]) => [t, rgb(hex)]);

function starPolygon(cx, cy, outer, inner, points, rotation) {
  const vertices = [];
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = rotation + (i * Math.PI) / points - Math.PI / 2;
    vertices.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
  }
  return vertices;
}

function cubicPoints(p, segments) {
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const u = 1 - t;
    points.push([0, 1].map((k) => u * u * u * p[0][k] + 3 * u * u * t * p[1][k] + 3 * u * t * t * p[2][k] + t * t * t * p[3][k]));
  }
  return points;
}

// Signed distances: negative inside, positive outside, in design units.
const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;

function sdRoundedBox(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Ellipse distance estimate (good near the outline, which is all anti-aliasing needs). */
function sdEllipse(px, py, cx, cy, rx, ry, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = px - cx;
  const dy = py - cy;
  const x = dx * cos + dy * sin;
  const y = -dx * sin + dy * cos;
  const k0 = Math.hypot(x / rx, y / ry);
  const k1 = Math.hypot(x / (rx * rx), y / (ry * ry));
  return k1 === 0 ? -Math.min(rx, ry) : (k0 * (k0 - 1)) / k1;
}

/** Distance to a polyline and the arc length of the nearest point (for the rope pattern). */
function polylineDistance(px, py, points, cumulative) {
  let best = Infinity;
  let along = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    const abx = bx - ax;
    const aby = by - ay;
    const t = clamp(((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby));
    const d = Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
    if (d < best) {
      best = d;
      along = cumulative[i] + t * Math.hypot(abx, aby);
    }
  }
  return { d: best, along };
}

function sdPolygon(px, py, vertices) {
  let d = Infinity;
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const [ax, ay] = vertices[j];
    const [bx, by] = vertices[i];
    const ex = bx - ax;
    const ey = by - ay;
    const t = clamp(((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey));
    d = Math.min(d, Math.hypot(px - (ax + ex * t), py - (ay + ey * t)));
    if (ay > py !== by > py && px < ax + ((py - ay) / (by - ay)) * ex) inside = !inside;
  }
  return inside ? -d : d;
}

// ---------------------------------------------------------------------------------------------------------------
// Rasteriser
// ---------------------------------------------------------------------------------------------------------------

const BG_RAMP = rampOf(BG_STOPS);
const FUSE_POINTS = cubicPoints(FUSE, 40);
const FUSE_BOX = [ // bounding box of the fuse plus its outline, to skip the distance loop elsewhere
  Math.min(...FUSE_POINTS.map((p) => p[0])) - 20,
  Math.min(...FUSE_POINTS.map((p) => p[1])) - 20,
  Math.max(...FUSE_POINTS.map((p) => p[0])) + 20,
  Math.max(...FUSE_POINTS.map((p) => p[1])) + 20,
];
const FUSE_LENGTHS = FUSE_POINTS.reduce((acc, p, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1] + Math.hypot(p[0] - FUSE_POINTS[i - 1][0], p[1] - FUSE_POINTS[i - 1][1]));
  return acc;
}, []);
const BODY_RAMP = rampOf([[0, '#6a63a8'], [0.3, '#332d5e'], [0.7, '#15112e'], [1, '#07050f']]);
const STAR_RAMP = rampOf([[0, '#ffffff'], [0.35, '#fff3a8'], [0.7, '#ffd23f'], [1, '#ff8a1f']]);
const CAP_PERP = { x: -CAP_DIR.y, y: CAP_DIR.x };

/**
 * Accumulator for premultiplied colour: `paint` composites a source with coverage `cover` over what is there.
 * @param {Float64Array} acc [r, g, b, a] premultiplied
 */
function paint(acc, cover, color, alpha = 1) {
  const a = cover * alpha;
  if (a <= 0) return;
  const keep = 1 - a;
  acc[0] = color[0] * a + acc[0] * keep;
  acc[1] = color[1] * a + acc[1] * keep;
  acc[2] = color[2] * a + acc[2] * keep;
  acc[3] = a + acc[3] * keep;
}

/** Coverage of a shape whose signed distance is `d`, for a pixel `aa` design units wide. */
const coverage = (d, aa) => clamp(0.5 - d / aa);

/** The full-bleed or rounded background, gloss and rim. `aa` = pixel width in design units. */
function paintBackground(acc, x, y, aa, rounded) {
  const shape = rounded ? sdRoundedBox(x, y, SIZE / 2, SIZE / 2, SIZE / 2, SIZE / 2, CORNER) : -Infinity;
  const cover = coverage(shape, aa);
  paint(acc, cover, ramp(BG_RAMP, clamp((x + y) / (2 * SIZE))));
  // Soft light from the top left and a little depth at the bottom: both multiply into the coverage.
  paint(acc, cover, [1, 1, 1], 0.3 * (1 - smoothstep(0, 400, Math.hypot(x - 140, y - 90))));
  paint(acc, cover, [0.1, 0.02, 0.25], 0.28 * smoothstep(300, 620, y));
  if (rounded) paint(acc, cover * coverage(Math.abs(shape + 2.5) - 1.5, aa), [1, 1, 1], 0.32);
}

function paintConfetti(acc, x, y, aa) {
  for (const [cx, cy, length, thickness, degrees, color] of CONFETTI) {
    if (Math.abs(x - cx) > length || Math.abs(y - cy) > length) continue;
    const angle = (degrees * Math.PI) / 180;
    const dx = x - cx;
    const dy = y - cy;
    const u = dx * Math.cos(angle) + dy * Math.sin(angle);
    const v = -dx * Math.sin(angle) + dy * Math.cos(angle);
    const d = sdRoundedBox(u, v, 0, 0, length / 2, thickness / 2, thickness / 2.5);
    paint(acc, coverage(d, aa), rgb(color), 0.85);
  }
}

function paintFuse(acc, x, y, aa, detailed) {
  if (x < FUSE_BOX[0] || x > FUSE_BOX[2] || y < FUSE_BOX[1] || y > FUSE_BOX[3]) return;
  const { d, along } = polylineDistance(x, y, FUSE_POINTS, FUSE_LENGTHS);
  const grow = detailed ? 0 : 5; // at favicon size the fuse would be a sub-pixel line
  paint(acc, coverage(d - 15 - grow, aa), rgb('#2c1650'), 0.85); // dark outline keeps it readable on every background stop
  paint(acc, coverage(d - 10.5 - grow, aa), rgb('#ffe9b3'));
  if (detailed) paint(acc, coverage(d - 10.5, aa) * (Math.sin(along * 0.55) > 0.3 ? 1 : 0), rgb('#c98a45'), 0.6); // rope twist
}

function paintCap(acc, x, y, aa) {
  // Local frame of the neck: t runs from the bomb centre outwards, v across it.
  const dx = x - BODY.x;
  const dy = y - BODY.y;
  const t = dx * CAP_DIR.x + dy * CAP_DIR.y;
  const v = dx * CAP_PERP.x + dy * CAP_PERP.y;
  const local = (lo, hi, halfWidth, radius) => sdRoundedBox(t, v, (lo + hi) / 2, 0, (hi - lo) / 2, halfWidth, radius);
  const metal = rampOf([[0, '#2b2650'], [0.3, '#524b86'], [0.5, '#b9b2ea'], [0.62, '#6c64a6'], [1, '#231e46']]);
  const shade = (halfWidth) => ramp(metal, clamp((v + halfWidth) / (2 * halfWidth)));
  const neck = local(BODY.r + 6, BODY.r + 40, 31, 9);
  const collar = local(BODY.r - 16, BODY.r + 14, 44, 10);
  paint(acc, coverage(neck, aa), shade(31));
  paint(acc, coverage(collar + 3.5, aa) * (1 - coverage(collar, aa)), rgb('#120d2b'), 0.7); // shadow the collar casts on the neck
  paint(acc, coverage(collar, aa), shade(44));
  paint(acc, coverage(Math.abs(t - (BODY.r + 14)) - 1.5, aa) * coverage(collar + 6, aa), rgb('#120d2b'), 0.45);
}

function paintBody(acc, x, y, aa) {
  const d = sdCircle(x, y, BODY.x, BODY.y, BODY.r);
  const cover = coverage(d, aa);
  const nx = (x - BODY.x) / BODY.r;
  const ny = (y - BODY.y) / BODY.r;
  const radial = Math.hypot(x - (BODY.x - 0.38 * BODY.r), y - (BODY.y - 0.42 * BODY.r)) / (1.62 * BODY.r);
  paint(acc, cover, ramp(BODY_RAMP, clamp(radial)));
  // Pink light bouncing back from the background along the lower right rim: separates the black from the backdrop.
  const rim = smoothstep(0.88, 1, Math.hypot(nx, ny)) * clamp((nx * 0.55 + ny * 0.83) * 1.6 - 0.15);
  paint(acc, cover, rgb('#ff8fd0'), 0.8 * rim);
  // Glossy specular streak following the curvature at the upper left, a fainter sheen and a dot.
  const streak = sdEllipse(x, y, BODY.x - 0.47 * BODY.r, BODY.y - 0.36 * BODY.r, 0.36 * BODY.r, 0.15 * BODY.r, (-49 * Math.PI) / 180);
  paint(acc, cover * coverage(streak, aa), [1, 1, 1], 0.92);
  const sheen = sdEllipse(x, y, BODY.x - 0.3 * BODY.r, BODY.y - 0.25 * BODY.r, 0.6 * BODY.r, 0.42 * BODY.r, (-49 * Math.PI) / 180);
  paint(acc, cover, [1, 1, 1], 0.1 * (1 - smoothstep(-0.4 * BODY.r, 0, sheen)));
  paint(acc, cover * coverage(sdCircle(x, y, BODY.x - 0.16 * BODY.r, BODY.y - 0.62 * BODY.r, 0.05 * BODY.r), aa), [1, 1, 1], 0.9);
}

function paintSpark(acc, x, y, aa, detailed) {
  const dist = Math.hypot(x - SPARK.x, y - SPARK.y);
  if (dist > 130) return;
  const reach = detailed ? SPARK_R : SPARK_R_BIG;
  if (detailed) paint(acc, 1, rgb('#ffcf4a'), 0.55 * (1 - smoothstep(0, 115, dist)) ** 2); // halo
  const star = sdPolygon(x, y, detailed ? SPARK_VERTICES : SPARK_VERTICES_BIG);
  paint(acc, coverage(star - 3, aa), rgb('#ff7a1a'), 0.9); // orange edge around the star
  paint(acc, coverage(star, aa), ramp(STAR_RAMP, clamp(dist / reach)));
  paint(acc, coverage(dist - (detailed ? 14 : 20), aa), [1, 1, 1]);
  if (!detailed) return;
  for (const { vertices } of SPARKLES) paint(acc, coverage(sdPolygon(x, y, vertices), aa), rgb('#fff6c2'), 0.95);
}

function paintShadow(acc, x, y) {
  if (Math.abs(y - SHADOW.y) > SHADOW.ry * 3) return;
  const d = sdEllipse(x, y, SHADOW.x, SHADOW.y, SHADOW.rx, SHADOW.ry, 0);
  paint(acc, 1, rgb('#1b0b3d'), 0.42 * (1 - smoothstep(-SHADOW.ry * 0.9, SHADOW.ry * 1.4, d))); // no hard edge: it is a soft contact shadow
}

/**
 * Renders the icon.
 * @param {number} size pixels per side
 * @param {{ rounded?: boolean, contentScale?: number }} [options] `rounded`: transparent corners (default). `contentScale`
 *   shrinks the bomb about the centre, used for the maskable icon whose corners the OS cuts off.
 * @returns {Uint8Array} straight-alpha RGBA
 */
export function renderIcon(size, { rounded = true, contentScale = 1 } = {}) {
  const out = new Uint8Array(size * size * 4);
  const acc = new Float64Array(4);
  const pixel = SIZE / size; // pixel width in design units
  const aa = pixel / contentScale; // ... and in content units, after the content transform
  const detailed = size >= 96; // the rope twist and glints turn into noise at favicon size
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const sx = (i + 0.5) * pixel;
      const sy = (j + 0.5) * pixel;
      acc.fill(0);
      paintBackground(acc, sx, sy, pixel, rounded);
      const x = SIZE / 2 + (sx - SIZE / 2) / contentScale;
      const y = SIZE / 2 + (sy - SIZE / 2) / contentScale;
      if (detailed) paintConfetti(acc, x, y, aa);
      paintShadow(acc, x, y);
      paintFuse(acc, x, y, aa, detailed);
      paintBody(acc, x, y, aa);
      paintCap(acc, x, y, aa);
      paintSpark(acc, x, y, aa, detailed);
      const a = acc[3];
      const o = (j * size + i) * 4;
      for (let c = 0; c < 3; c++) out[o + c] = a > 0 ? Math.round(clamp(acc[c] / a) * 255) : 0;
      out[o + 3] = Math.round(clamp(a) * 255);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// SVG twin of the raster art
// ---------------------------------------------------------------------------------------------------------------

const f = (n) => Number(n.toFixed(1));
const stops = (list) => list.map(([t, hex]) => `<stop offset="${t}" stop-color="${hex}"/>`).join('');

/** The design as SVG: the same constants as the raster code, drawn with gradients instead of distance fields. */
export function iconSvg() {
  const [p0, p1, p2, p3] = FUSE.map(([x, y]) => `${f(x)} ${f(y)}`);
  const capTransform = `translate(${BODY.x} ${BODY.y}) rotate(${f((CAP_ANGLE * 180) / Math.PI)})`;
  const sparkle = ({ vertices }) => `<polygon fill="#fff6c2" points="${vertices.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}"/>`;
  const confetti = CONFETTI.map(
    ([x, y, length, thickness, angle, color]) =>
      `<rect x="${-length / 2}" y="${-thickness / 2}" width="${length}" height="${thickness}" rx="${f(thickness / 2.5)}" fill="${color}" opacity=".85" transform="translate(${x} ${y}) rotate(${angle})"/>`,
  ).join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" role="img" aria-labelledby="title">
  <title id="title">Blast Party: a glossy black bomb with a lit fuse</title>
  <defs>
    <linearGradient id="bg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${SIZE}" y2="${SIZE}">${stops(BG_STOPS)}</linearGradient>
    <radialGradient id="light" gradientUnits="userSpaceOnUse" cx="140" cy="90" r="400"><stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="depth" gradientUnits="userSpaceOnUse" x1="0" y1="300" x2="0" y2="620"><stop offset="0" stop-color="#1a0540" stop-opacity="0"/><stop offset="1" stop-color="#1a0540" stop-opacity=".28"/></linearGradient>
    <radialGradient id="body" gradientUnits="userSpaceOnUse" cx="${f(BODY.x - 0.38 * BODY.r)}" cy="${f(BODY.y - 0.42 * BODY.r)}" r="${f(1.62 * BODY.r)}">${stops([[0, '#6a63a8'], [0.3, '#332d5e'], [0.7, '#15112e'], [1, '#07050f']])}</radialGradient>
    <radialGradient id="rim" gradientUnits="userSpaceOnUse" cx="${BODY.x}" cy="${BODY.y}" r="${BODY.r}"><stop offset=".88" stop-color="#ff8fd0" stop-opacity="0"/><stop offset="1" stop-color="#ff8fd0" stop-opacity=".8"/></radialGradient>
    <linearGradient id="lit" gradientUnits="userSpaceOnUse" x1="${f(BODY.x - 0.55 * BODY.r)}" y1="${f(BODY.y - 0.83 * BODY.r)}" x2="${f(BODY.x + 0.55 * BODY.r)}" y2="${f(BODY.y + 0.83 * BODY.r)}"><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset=".86" stop-color="#fff"/></linearGradient>
    <mask id="rimMask"><circle cx="${BODY.x}" cy="${BODY.y}" r="${BODY.r}" fill="url(#lit)"/></mask>
    <radialGradient id="sheen"><stop offset="0" stop-color="#fff" stop-opacity=".14"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1">${stops([[0, '#2b2650'], [0.3, '#524b86'], [0.5, '#b9b2ea'], [0.62, '#6c64a6'], [1, '#231e46']])}</linearGradient>
    <radialGradient id="halo" gradientUnits="userSpaceOnUse" cx="${SPARK.x}" cy="${SPARK.y}" r="110"><stop offset="0" stop-color="#ffcf4a" stop-opacity=".55"/><stop offset="1" stop-color="#ffcf4a" stop-opacity="0"/></radialGradient>
    <radialGradient id="flare" gradientUnits="userSpaceOnUse" cx="${SPARK.x}" cy="${SPARK.y}" r="${SPARK_R}">${stops([[0, '#ffffff'], [0.35, '#fff3a8'], [0.7, '#ffd23f'], [1, '#ff8a1f']])}</radialGradient>
    <filter id="soft" x="-20%" y="-200%" width="140%" height="500%"><feGaussianBlur stdDeviation="9"/></filter>
    <clipPath id="ball"><circle cx="${BODY.x}" cy="${BODY.y}" r="${BODY.r}"/></clipPath>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" rx="${CORNER}" fill="url(#bg)"/>
  <rect width="${SIZE}" height="${SIZE}" rx="${CORNER}" fill="url(#light)"/>
  <rect width="${SIZE}" height="${SIZE}" rx="${CORNER}" fill="url(#depth)"/>
  <rect x="2.5" y="2.5" width="${SIZE - 5}" height="${SIZE - 5}" rx="${CORNER - 2.5}" fill="none" stroke="#fff" stroke-opacity=".32" stroke-width="3"/>
  ${confetti}
  <ellipse cx="${SHADOW.x}" cy="${SHADOW.y}" rx="${SHADOW.rx}" ry="${SHADOW.ry}" fill="#1b0b3d" opacity=".5" filter="url(#soft)"/>
  <path d="M${p0} C${p1} ${p2} ${p3}" fill="none" stroke="#2c1650" stroke-opacity=".85" stroke-width="30" stroke-linecap="round"/>
  <path d="M${p0} C${p1} ${p2} ${p3}" fill="none" stroke="#ffe9b3" stroke-width="21" stroke-linecap="round"/>
  <path d="M${p0} C${p1} ${p2} ${p3}" fill="none" stroke="#c98a45" stroke-opacity=".6" stroke-width="21" stroke-dasharray="5.7 5.7"/>
  <circle cx="${BODY.x}" cy="${BODY.y}" r="${BODY.r}" fill="url(#body)"/>
  <circle cx="${BODY.x}" cy="${BODY.y}" r="${BODY.r}" fill="url(#rim)" mask="url(#rimMask)"/>
  <g clip-path="url(#ball)" fill="#fff">
    <ellipse cx="${f(BODY.x - 0.47 * BODY.r)}" cy="${f(BODY.y - 0.36 * BODY.r)}" rx="${f(0.36 * BODY.r)}" ry="${f(0.15 * BODY.r)}" transform="rotate(-49 ${f(BODY.x - 0.47 * BODY.r)} ${f(BODY.y - 0.36 * BODY.r)})" opacity=".92"/>
    <ellipse cx="${f(BODY.x - 0.3 * BODY.r)}" cy="${f(BODY.y - 0.25 * BODY.r)}" rx="${f(0.6 * BODY.r)}" ry="${f(0.42 * BODY.r)}" transform="rotate(-49 ${f(BODY.x - 0.3 * BODY.r)} ${f(BODY.y - 0.25 * BODY.r)})" fill="url(#sheen)"/>
    <circle cx="${f(BODY.x - 0.16 * BODY.r)}" cy="${f(BODY.y - 0.62 * BODY.r)}" r="${f(0.05 * BODY.r)}" opacity=".9"/>
  </g>
  <g transform="${capTransform}">
    <rect x="${BODY.r + 6}" y="-31" width="34" height="62" rx="9" fill="url(#metal)"/>
    <rect x="${BODY.r - 16}" y="-44" width="30" height="88" rx="10" fill="url(#metal)"/>
    <rect x="${BODY.r + 13}" y="-40" width="3" height="80" fill="#120d2b" opacity=".45"/>
  </g>
  <circle cx="${SPARK.x}" cy="${SPARK.y}" r="110" fill="url(#halo)"/>
  <polygon fill="#ff7a1a" opacity=".9" stroke="#ff7a1a" stroke-width="6" stroke-linejoin="round" points="${SPARK_VERTICES.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}"/>
  <polygon fill="url(#flare)" points="${SPARK_VERTICES.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}"/>
  <circle cx="${SPARK.x}" cy="${SPARK.y}" r="13" fill="#fff"/>
  ${SPARKLES.map(sparkle).join('\n  ')}
</svg>
`;
}

// ---------------------------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------------------------

/** Everything written to client/icons, as [file name, contents]. */
export function buildIcons() {
  const png = (size, options, opaque = false) => encodePng({ width: size, height: size, rgba: renderIcon(size, options), opaque });
  return [
    ['icon.svg', iconSvg()],
    ['icon-192.png', png(192)],
    ['icon-512.png', png(512)],
    // The OS applies its own mask (circle, squircle, ...) and only promises the inner 80 % (a circle of radius 205 in
    // design units). The bomb, fuse and spark star reach 281 units from the centre, so 0.72 (-> 202) keeps all of
    // them inside; the sparkles and confetti are decoration and may be masked away.
    ['icon-maskable-512.png', png(512, { rounded: false, contentScale: 0.72 })],
    ['apple-touch-icon.png', png(180, { rounded: false }, true)],
    ['favicon-32.png', png(32)],
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'icons');
  mkdirSync(dir, { recursive: true });
  for (const [name, contents] of buildIcons()) {
    writeFileSync(join(dir, name), contents);
    console.log(`wrote client/icons/${name} (${contents.length} bytes)`);
  }
}
