// Modelling kit of the hideouts (world-hideout*.js): the small vocabulary every hub prop is
// written in — slabs, posts, ropes, crates, barrels, lanterns, emissive bulbs, catenaries of
// string lights, painted signs and neon words from the hub atlas, tents and tarps.
//
// Everything writes through the world's geo builder `B` (world-geo.js) in the current object
// frame (B.obj(x, y, a)): local +x along the prop's facing `a`, +y up, +z to its right
// (sim +y at a = 0). Emissive pieces go to the unlit 'glow' bucket (colour multipliers above
// 1 make the bloom pass catch them), text and pictures to the hub atlas' 'hub' (lit, alpha
// tested) and 'hubneon' (unlit) buckets.

import { T, shadeHex, mixHex, hash01 } from './world-geo.js';
import { DET } from './world-surf.js';
import { atlasUV } from './world-tex.js';
import { rod, plank } from './dress-kit.js';
import { hubUV } from './world-hideout-atlas.js';

export { T, shadeHex, mixHex, hash01, DET, atlasUV, rod, plank, hubUV };

/** Surface shorthand. */
export const S = (layer = 0, rough = 0.8, metal = 0) => ({ surf: [layer, rough, metal] });
export const WOOD = S(DET.wood, 0.86, 0);
export const RUSTY = S(DET.rust, 0.55, 0.7);
export const CANVAS = S(DET.fabric, 0.95, 0);
export const METAL = S(DET.panel, 0.45, 0.6);
export const CORR = S(DET.corrugated, 0.5, 0.55);

export const C = {
  wood: '#7a5a38', woodD: '#4f3823', woodL: '#a08256', plank: '#8a6a44', bark: '#4c3a28', rust: '#6a4a38', steel: '#7f868c', steelD: '#4a4f54',
  canvas: '#a8a084', canvasG: '#5a6340', tarpB: '#3a5a8a', tarpO: '#c9772a', red: '#a83a2a', white: '#e8e2d0', black: '#1c1c1e',
  bulbW: '#ffd9a0', bulbA: '#ffb54a', bulbR: '#ff6a5a', bulbG: '#9aff9a', bulbB: '#8ab8ff', bulbP: '#ff8ad0',
};

/** Bright, warm-white and coloured bulb palettes (HDR multipliers are applied by `bulb`). */
export const BULBS = {
  warm: [C.bulbW, C.bulbA, C.bulbW, '#ffe6b8'],
  multi: [C.bulbR, C.bulbA, C.bulbG, C.bulbB, C.bulbP, C.bulbW],
  white: ['#f4f8ff', '#e8f0ff', '#f4f8ff'],
};

// ---- primitives -------------------------------------------------------------------------------

/** A flat slab along local x with a pitch (about z) and yaw (about y): centre c, length × thickness × width. */
export function slab(B, bucket, c, len, thick, wid, yaw, pitch, color, o = null) {
  B.add(bucket, T.box(), c, [len, thick, wid], [0, yaw, pitch], color, o);
}

/** A vertical post standing on y0. */
export function post(B, x, y0, z, rad, h, color = C.woodD, o = WOOD, seg = 6) {
  B.cyl('std', x, y0, z, rad, h, color, seg, 0.9, null, o);
}

/** A rope / wire / pole between two local points. */
export function line(B, p0, p1, rad = 0.35, color = '#2a2622', o = null) {
  rod(B, 'std', p0, p1, rad, color, o || S(0, 0.7, 0.2), 4);
}

/** A crate (wood, straps, a stencil) standing on y0. */
export function crate(B, x, y0, z, s, rot = 0, color = C.wood, o = {}) {
  const w = o.w || s, d = o.d || s, h = o.h || s;
  B.rblock('std', x, y0, z, w, h, d, 0.6, color, [0, rot, 0], WOOD);
  B.box('std', x, y0 + h * 0.5, z, w + 0.5, 2.2, d + 0.5, shadeHex(color, -0.25), [0, rot, 0], WOOD);
  B.box('std', x, y0 + h - 1, z, w + 0.5, 1.6, d + 0.5, shadeHex(color, -0.2), [0, rot, 0], WOOD);
  B.box('std', x, y0 + 1.2, z, w + 0.5, 1.6, d + 0.5, shadeHex(color, -0.2), [0, rot, 0], WOOD);
}

/** An oil drum / barrel. */
export function barrel(B, x, y0, z, color = '#4a5a6a', h = 30, rad = 11, open = false) {
  B.cyl('std', x, y0, z, rad, h, color, 14, 1, null, RUSTY);
  for (const yy of [h * 0.3, h * 0.7]) B.cyl('std', x, y0 + yy, z, rad + 0.4, 1.3, shadeHex(color, -0.25), 14, 1, null, RUSTY);
  B.cyl('std', x, y0 + h - 0.2, z, rad + 0.5, 1.4, shadeHex(color, -0.35), 14, 1, null, RUSTY);
  if (open) B.cyl('std', x, y0 + h - 1.4, z, rad - 1.2, 0.8, '#141210', 14, 1, null, S(DET.char, 0.95, 0));
}

/** A jerry can. */
export function jerrycan(B, x, y0, z, rot = 0, color = '#a8382a') {
  B.rblock('std', x, y0, z, 9, 13, 5, 0.8, color, [0, rot, 0], METAL);
  B.box('std', x, y0 + 14, z, 4, 2, 2, shadeHex(color, -0.3), [0, rot, 0], METAL);
}

/** A mug (a cylinder and a handle). */
export function mug(B, x, y0, z, color = '#e8e2d0') {
  B.cyl('std', x, y0, z, 1.9, 3.6, color, 8, 0.95, null, S(DET.plastic, 0.4, 0));
  B.box('std', x + 2.1, y0 + 1.9, z, 0.7, 2.2, 0.8, color, null, S(DET.plastic, 0.4, 0));
}

/** A stump / round log seat. */
export function stump(B, x, y0, z, rad = 9, h = 12, color = C.bark) {
  B.cyl('std', x, y0, z, rad, h, color, 9, 0.92, null, S(DET.bark, 0.92, 0));
  B.cyl('std', x, y0 + h - 0.1, z, rad * 0.9, 0.5, '#b39064', 9, 1, null, S(DET.wood, 0.85, 0));
}

/** A small sandbag ring / arc segment: bags on a circle of radius R over an arc. */
export function sandbagArc(B, cx, cz, R, a0, a1, rows = 3, color = '#8a7a55') {
  const r = B.rng;
  const bagL = 16;
  const n = Math.max(2, Math.round(Math.abs(a1 - a0) * R / (bagL - 2)));
  for (let row = 0; row < rows; row++) {
    for (let i = 0; i < n; i++) {
      const a = a0 + ((i + 0.5 + (row % 2) * 0.5) / n) * (a1 - a0);
      const c = mixHex(color, r.chance(0.5) ? '#a09070' : '#5e5238', r.range(0, 0.35));
      B.add('std', T.pillow(10, 6, 0.4), [cx + Math.cos(a) * R, 3.6 + row * 6.4, cz + Math.sin(a) * R], [bagL / 2, 3.4, 5.2], [0, -a + PI2, 0], c, CANVAS);
    }
  }
}
const PI2 = Math.PI / 2;

/** A straight wall of sandbags between two floor points. */
export function sandbagRun(B, x0, z0, x1, z1, rows = 3, color = '#8a7a55') {
  const len = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(z1 - z0, x1 - x0);
  const r = B.rng;
  const n = Math.max(1, Math.round(len / 15));
  for (let row = 0; row < rows; row++) {
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5 + (row % 2) * 0.5) / n;
      if (t > 1) continue;
      const c = mixHex(color, r.chance(0.5) ? '#a09070' : '#5e5238', r.range(0, 0.35));
      B.add('std', T.pillow(10, 6, 0.4), [x0 + (x1 - x0) * t, 3.6 + row * 6.4, z0 + (z1 - z0) * t], [len / n / 2 + 1, 3.4, 5.5], [r.range(-0.05, 0.05), -a, r.range(-0.05, 0.05)], c, CANVAS);
    }
  }
}

// ---- lights -----------------------------------------------------------------------------------

/**
 * An emissive bulb (unlit, HDR: the bloom pass makes it glow) plus a soft halo sprite.
 * `k` is the emissive multiplier; `halo` the sprite size (0 = none).
 */
export function bulb(B, halos, wx, wz, y, color = C.bulbW, o = {}) {
  const r = o.r ?? 1.5;
  B.add('glow', T.sphere(6, 4), [o.lx ?? 0, y, o.lz ?? 0], [r, r, r], null, color, { emissive: o.k ?? 3.4, uv: atlasUV('white'), noAO: true, noJitter: true });
  const size = o.halo ?? 42;
  if (halos && size > 0 && wx !== undefined) halos.push({ x: wx, y: wz, h: y + (o.baseY || 0), color, size, strength: o.strength ?? 0.5, flicker: o.flicker || 0 });
}

/**
 * A standing / hanging lantern: a glass chimney, a burning wick, a cap and a bail; a halo.
 * (x, y0, z) local; world position (wx, wz) for the halo.
 */
export function lantern(B, halos, x, y0, z, wx, wz, o = {}) {
  const col = o.color || '#ffb45a';
  const h = o.h ?? 9;
  B.cyl('std', x, y0, z, 3.4, 1.6, '#2a2a2c', 8, 0.9, null, RUSTY);
  B.cyl('glass', x, y0 + 1.6, z, 3, h - 2.6, '#ffd8a0', 8, 1.05, null, { surf: [0, 0.1, 0.1] });
  B.cyl('glow', x, y0 + 2.2, z, 1.9, h - 4.2, col, 6, 0.8, null, { emissive: o.k ?? 4.2, noAO: true, uv: atlasUV('white') });
  B.cyl('std', x, y0 + h - 1, z, 3.4, 1.6, '#2a2a2c', 8, 0.5, null, RUSTY);
  if (o.hang) rod(B, 'std', [x, y0 + h, z], [x, y0 + h + o.hang, z], 0.3, '#2a2622', S(0, 0.7, 0.3), 4);
  else B.add('std', T.torus(8, 0.12, 4), [x, y0 + h + 1.4, z], [2.2, 2.2, 2.2], [PI2, 0, 0], '#2a2a2c', RUSTY);
  if (halos && wx !== undefined) halos.push({ x: wx, y: wz, h: y0 + h * 0.55, color: col, size: o.halo ?? 60, strength: o.strength ?? 0.55, flicker: 0.5 });
}

/** Points along a hanging wire through `pts` ([x, y, z] in three axes: y up), sagging `sag` between the supports. */
export function catenary(pts, sag, step = 16) {
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b[0] - a[0], b[2] - a[2], b[1] - a[1]);
    const n = Math.max(2, Math.round(len / step));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t]);
    }
  }
  return out;
}

/**
 * A string of lights hung between supports, in WORLD coordinates (the caller placed the
 * frame at the sim origin: B.obj(0, 0, 0)). pts = [[sim x, sim y, height], ...].
 */
export function stringLights(B, halos, pts, sag, o = {}) {
  const r = B.rng;
  const path = catenary(pts.map(([x, y, h]) => [x, h, y]), sag, o.step ?? 12);
  const palette = BULBS[o.palette || 'warm'];
  let acc = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i], b = path[i + 1];
    rod(B, 'std', a, b, 0.32, '#1e1c1a', S(0, 0.8, 0.1), 4);
    acc += Math.hypot(b[0] - a[0], b[2] - a[2], b[1] - a[1]);
    if (acc >= (o.gap ?? 20)) {
      acc = 0;
      const c = palette[Math.floor(r.next() * palette.length) % palette.length];
      // socket and bulb hang just under the wire
      B.cyl('std', b[0], b[1] - 2.2, b[2], 0.7, 1.6, '#2a2622', 5, 1, null, S(0, 0.7, 0.2));
      bulb(B, halos, b[0], b[2], b[1] - 3.4, c, { lx: b[0], lz: b[2], r: 1.55, k: o.k ?? 3.6, halo: o.halo ?? 36, strength: o.strength ?? 0.38 });
    }
  }
  return path;
}

// ---- pictures and signs -----------------------------------------------------------------------

/** A picture / sign from the hub atlas on a vertical plane facing local +z (rotate with ry). */
export function pic(B, cell, x, y, z, w, h, ry = 0, o = {}) {
  B.add('hub', T.plane(), [x, y, z], [w, h, 1], [o.rx || 0, ry, o.rz || 0], o.color || '#ffffff', { uv: hubUV(cell), noAO: true, noJitter: true });
}

/** The same on both faces (a free-standing board). */
export function pic2(B, cell, x, y, z, w, h, ry = 0, o = {}) {
  pic(B, cell, x, y, z, w, h, ry, o);
  B.add('hub', T.plane(), [x, y, z], [w, h, 1], [o.rx || 0, ry + Math.PI, o.rz || 0], o.color || '#ffffff', { uv: hubUV(cell), noAO: true, noJitter: true });
}

/** A neon word (unlit, HDR) on a plane facing local +z, both faces when `both`. */
export function neonWord(B, cell, x, y, z, w, h, ry = 0, k = 3, both = true, bucket = 'hubneon') {
  B.add(bucket, T.plane(), [x, y, z], [w, h, 1], [0, ry, 0], '#ffffff', { uv: hubUV(cell), emissive: k, noAO: true, noJitter: true });
  if (both) B.add(bucket, T.plane(), [x, y, z], [w, h, 1], [0, ry + Math.PI, 0], '#ffffff', { uv: hubUV(cell), emissive: k, noAO: true, noJitter: true });
}

/** A framed painted board on two posts (free standing) facing local +z. */
export function boardSign(B, cell, x, z, w, h, y0 = 22, ry = 0, o = {}) {
  const c = o.frame || C.woodD;
  for (const s of [-1, 1]) post(B, x + Math.cos(ry) * s * (w / 2 - 3), y0 - 12, z - Math.sin(ry) * s * (w / 2 - 3), 1.6, h + 12 + (o.tall || 0), c);
  pic2(B, cell, x, y0 + h / 2, z, w, h, ry);
  B.box('std', x, y0 + h + 0.4, z, w + 1.6, 1.4, 2.2, c, [0, ry, 0], WOOD);
  B.box('std', x, y0 - 0.4, z, w + 1.6, 1.4, 2.2, c, [0, ry, 0], WOOD);
}

// ---- tents, tarps, canvas ------------------------------------------------------------------------

/**
 * A ridge tent along local x (length L, width W, wall height wh, ridge height rh) with a
 * rolled-up front flap facing +x when `open`.
 */
export function ridgeTent(B, L, W, wh, rh, color = C.canvasG, o = {}) {
  const half = W / 2;
  const slope = Math.atan2(rh - wh, half);
  const slen = Math.hypot(half, rh - wh) + 1.4;
  for (const s of [-1, 1]) {
    // roof panel from the eave (z = ±half, y = wh) up to the ridge
    B.add('std', T.box(), [0, (wh + rh) / 2, s * half / 2], [L + 3, 1.0, slen], [s * slope, 0, 0], color, CANVAS);
    // wall skirt
    B.box('std', 0, wh / 2, s * half, L, wh, 0.9, shadeHex(color, -0.08), null, CANVAS);
  }
  // gable ends
  const prof = [[-half, wh], [half, wh], [0, rh]];
  for (const e of [-1, 1]) {
    if (e === 1 && o.open) continue;
    B.add('std', T.profile('tentgable' + wh + ':' + rh + ':' + W, [[-half, 0], [half, 0], [half, wh], [0, rh], [-half, wh]], 0, 1), [e * L / 2, 0, 0], [1, 1, 1], [0, Math.PI / 2, 0], shadeHex(color, -0.12), CANVAS);
  }
  void prof;
  B.cyl('std', 0, rh - 0.6, 0, 0.9, 0.9, C.woodD, 5);
  B.add('std', T.cyl(5), [0, rh, 0], [0.7, L + 4, 0.7], [0, 0, PI2], C.woodD, WOOD);
  // guy ropes and pegs
  for (const s of [-1, 1]) for (const e of [-1, 1]) {
    line(B, [e * (L / 2 + 1), wh, s * half], [e * (L / 2 + 14), 0.5, s * (half + 12)], 0.3, '#bdb090', S(DET.fabric, 0.9, 0));
    B.box('std', e * (L / 2 + 14), 2, s * (half + 12), 0.8, 4, 0.8, C.woodD, null, WOOD);
  }
}

/** A tarp (canvas sheet) between four corner points, sagging in the middle. */
export function tarpSheet(B, corners, color = C.tarpB, seg = 3) {
  // corners: [[x, y, z] ×4] in order; two triangles per cell of a seg × seg grid
  const P = (u, v) => {
    const a = corners[0], b = corners[1], c = corners[2], d = corners[3];
    const top = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
    const bot = [d[0] + (c[0] - d[0]) * u, d[1] + (c[1] - d[1]) * u, d[2] + (c[2] - d[2]) * u];
    const sag = -Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * 2.2;
    return [top[0] + (bot[0] - top[0]) * v, top[1] + (bot[1] - top[1]) * v + sag, top[2] + (bot[2] - top[2]) * v];
  };
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < seg; j++) {
      const p00 = P(i / seg, j / seg), p10 = P((i + 1) / seg, j / seg), p01 = P(i / seg, (j + 1) / seg), p11 = P((i + 1) / seg, (j + 1) / seg);
      const cx = (p00[0] + p11[0]) / 2, cy = (p00[1] + p11[1]) / 2, cz = (p00[2] + p11[2]) / 2;
      // a thin box fitted to the quad's plane
      const e1 = [p10[0] - p00[0], p10[1] - p00[1], p10[2] - p00[2]], e2 = [p01[0] - p00[0], p01[1] - p00[1], p01[2] - p00[2]];
      B.quad('std', [cx, cy, cz], e1, e2, color, CANVAS);
      B.quad('std', [cx, cy - 0.4, cz], e2, e1, shadeHex(color, -0.15), CANVAS);
    }
  }
}

/** A flat-bottomed cot (canvas on a frame) along local x; `o.y0` lifts it (a bunk on a floor). */
export function cot(B, x, z, rot = 0, blanket = '#7a3a3a', o = {}) {
  const L = o.L || 34, W = o.W || 15, y0 = o.y0 || 0, h = 8 + y0;
  B.add('std', T.box(), [x, h, z], [L, 1.2, W], [0, rot, 0], '#8a8060', CANVAS);
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const cx = x + (Math.cos(rot) * dx * (L / 2 - 2)) - (Math.sin(rot) * dz * (W / 2 - 1));
    const cz = z + (Math.sin(rot) * dx * (L / 2 - 2)) + (Math.cos(rot) * dz * (W / 2 - 1));
    B.cyl('std', cx, y0, cz, 0.8, 8, '#5a5e62', 5, 1, null, RUSTY);
  }
  // pillow and blanket
  const px = x - Math.cos(rot) * (L / 2 - 6), pz = z - Math.sin(rot) * (L / 2 - 6);
  B.add('std', T.pillow(8, 5, 0.5), [px, h + 2.2, pz], [5.2, 2, W / 2 - 2.5], [0, -rot, 0], '#e8e4d4', CANVAS);
  const bx = x + Math.cos(rot) * 5, bz = z + Math.sin(rot) * 5;
  B.add('std', T.pillow(8, 5, 0.4), [bx, h + 2.4, bz], [L / 2 - 9, 2.2, W / 2 - 0.5], [0, -rot, 0], blanket, CANVAS);
}

/** Hash of a world position → [0, 1) (stable variation per prop). */
export function hash2(x, y) {
  return hash01(Math.round(x * 7.3) * 73856093 ^ Math.round(y * 5.1) * 19349663);
}
