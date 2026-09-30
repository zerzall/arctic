// Architectural building blocks of the static world (WORLD, SPEC §7.5): a building's wall is
// built as a skin of quads with real openings in it (piers, aprons and spandrels around
// recessed windows), so every window has depth: reveals, a frame, a sill and a lintel, and
// behind the pane an interior-mapped room (world-mat.js). Doors, shop fronts with signs and
// awnings, cornices, pilasters, balconies, fire escapes, AC units, pipes, chimneys, dormers,
// roof plant and vines are the other pieces; world-bld.js composes them into archetypes.
//
// Everything is written through the geo builder in the building's object frame. A `Face`
// maps a wall's own coordinates (t along the face, y up, out along its normal) onto it;
// looking at the face from outside, t grows to the right.

import * as THREE from 'three';
import { T, shadeHex, mixHex, hash01 } from './world-geo.js';
import { DET } from './world-surf.js';
import { atlasUV } from './world-tex.js';

/** Geometry detail of the buildings: 0 low, 1 high, 2 ultra, 3 cinematic (set by world.js from the tier). */
export const DETAIL = { level: 2 };
export function setDetailLevel(l) { DETAIL.level = l; }

export const GLASS = '#0f151b';
const NORMALS = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0]];
const ALONG = [[1, 0, 0], [-1, 0, 0], [0, 0, -1], [0, 0, 1]];
const FROT = [0, Math.PI, Math.PI / 2, -Math.PI / 2];
/** Rotation about y that takes a profile's +x (its "outward" axis) onto the face normal. */
const PROT = [-Math.PI / 2, Math.PI / 2, 0, Math.PI];

// lamp colours of lit rooms (linear-ish hex, multiplied by their strength in the colour)
const LAMPS = ['#ffcf8a', '#ffd9a0', '#ffe2b8', '#fff0d8', '#dcecff', '#ffc27a'];

export class Face {
  /** @param {object} B geo builder  @param {number} i 0 +z (front) 1 -z 2 +x 3 -x  @param {number} L length (x)  @param {number} W width (z) */
  constructor(B, i, L, W) {
    this.B = B;
    this.i = i;
    this.n = NORMALS[i];
    this.a = ALONG[i];
    this.len = i < 2 ? L : W;
    this.half = i < 2 ? W / 2 : L / 2;
    this.frot = FROT[i];
    this.prot = PROT[i];
  }

  /** Object-frame point at wall coordinates (t along, y up, out along the normal). */
  P(t, y, out = 0) {
    return [this.n[0] * (this.half + out) + this.a[0] * t, y, this.n[2] * (this.half + out) + this.a[2] * t];
  }

  /** Outward-facing rectangle (centre t, y; size w x h) at `out` from the wall plane. */
  rect(bucket, t, y, out, w, h, color, o) {
    this.B.quad(bucket, this.P(t, y, out), [this.a[0] * w, 0, this.a[2] * w], [0, h, 0], color, o);
  }

  /** Rectangle spanning t0..t1 and y0..y1. */
  span(bucket, t0, t1, y0, y1, out, color, o) {
    this.rect(bucket, (t0 + t1) / 2, (y0 + y1) / 2, out, t1 - t0, y1 - y0, color, o);
  }

  /** Box: centre t, y; width w along the face, height h, depth d measured outward from `out0`. */
  box(bucket, t, y, out0, w, h, d, color, o) {
    this.B.add(bucket, T.box(), this.P(t, y, out0 + d / 2), [w, h, d], [0, this.frot, 0], color, o);
  }

  /** Rounded-edge box (exact size). */
  rbox(bucket, t, y, out0, w, h, d, rad, color, o) {
    this.B.add(bucket, T.rbox(w, h, d, rad), this.P(t, y, out0 + d / 2), [1, 1, 1], [0, this.frot, 0], color, o);
  }

  /** A quad facing along the wall (`dir` 0 = toward +t, 1 = toward -t, 2 = down, 3 = up) spanning depth `d` inward from `out`. */
  reveal(bucket, dir, t, y, out, w, h, d, color, o) {
    const [nx, , nz] = this.n, [ax, , az] = this.a;
    const P = this.P(t, y, out - d / 2);
    if (dir === 0) this.B.quad(bucket, P, [-nx * d, 0, -nz * d], [0, h, 0], color, o);
    else if (dir === 1) this.B.quad(bucket, P, [nx * d, 0, nz * d], [0, h, 0], color, o);
    else if (dir === 2) this.B.quad(bucket, P, [ax * w, 0, az * w], [nx * d, 0, nz * d], color, o);
    else this.B.quad(bucket, P, [ax * w, 0, az * w], [-nx * d, 0, -nz * d], color, o);
  }

  /** A profile (pts in [out, y]) extruded along t from t0..t1, its origin at wall coordinate y. */
  prof(bucket, key, pts, t0, t1, y, color, o, bevel = 0) {
    const len = t1 - t0;
    const c = this.P((t0 + t1) / 2, y, 0);
    if (bevel > 0) this.B.add(bucket, T.profile(key, pts, bevel, len), c, [1, 1, 1], [0, this.prot, 0], color, o);
    else this.B.add(bucket, T.profile(key, pts), c, [1, 1, len], [0, this.prot, 0], color, o);
  }
}

// ---- walls ---------------------------------------------------------------------------------------

/**
 * A band of wall (y0..y1) as quads around the given openings [{t0, t1, y0, y1}], sorted by t0.
 */
export function skinBand(F, y0, y1, holes, color, o) {
  const half = F.len / 2;
  let cur = -half;
  for (const h of holes) {
    if (h.t0 > cur + 0.05) F.span('std', cur, h.t0, y0, y1, 0, color, o);
    if (h.y0 > y0 + 0.05) F.span('std', h.t0, h.t1, y0, h.y0, 0, color, o);
    if (h.y1 < y1 - 0.05) F.span('std', h.t0, h.t1, h.y1, y1, 0, color, o);
    cur = h.t1;
  }
  if (cur < half - 0.05) F.span('std', cur, half, y0, y1, 0, color, o);
}

// ---- windows -------------------------------------------------------------------------------------

/** A room id for a pane: `type` (0 flat, 1 shop, 2 office, 3 warehouse, 4 derelict) and a hash. */
export function roomId(type, h) {
  return type * 256 + Math.floor(hash01(h) * 255);
}

/**
 * A recessed window. spec: { t, yc, ww, wh, R (depth), state: 'dark'|'lit'|'broken'|'boarded'|'blank',
 * room (id), lamp (hex), k (lamp strength), frame (hex), wall (hex), sill (bool), lintel (bool),
 * trim (hex), mullion: 0 none / 1 cross / 2 vertical, shutters (hex|null), ac (bool), seed }
 */
export function windowUnit(F, s) {
  const B = F.B;
  const lod = DETAIL.level;
  const { t, yc, ww, wh, R } = s;
  const y0 = yc - wh / 2, y1 = yc + wh / 2;
  const inner = { noJitter: true, surf: [0, 0.9, 0] };
  const revC = shadeHex(s.wall, -0.32);
  // the four sides of the opening
  F.reveal('std', 0, t - ww / 2, yc, 0, 0, wh, R, revC, inner);
  F.reveal('std', 1, t + ww / 2, yc, 0, 0, wh, R, revC, inner);
  F.reveal('std', 2, t, y1, 0, ww, 0, R, shadeHex(s.wall, -0.4), inner);
  if (!s.sill) F.reveal('std', 3, t, y0, 0, ww, 0, R, revC, inner);
  const rp = R - 0.9;   // pane depth
  if (s.state === 'blank') {
    F.rect('std', t, yc, -R + 0.2, ww, wh, shadeHex(s.wall, -0.55), inner);
  } else {
    const opts = { pane: { id: s.room, w: ww, h: wh } };
    if (s.state === 'lit') {
      const c = s.lamp || LAMPS[Math.floor(hash01(s.seed) * LAMPS.length)];
      F.rect('room', t, yc, -rp, ww, wh, mixHex(c, '#ffffff', 0.1), { pane: { id: s.room, w: ww, h: wh }, emissive: s.k || 1.3 });
    } else {
      // broken windows show a derelict room and no reflection worth mentioning
      F.rect('glass', t, yc, -rp, ww, wh, s.state === 'broken' ? '#05070a' : GLASS, opts);
    }
  }
  // frame: bars in front of the pane
  if (s.state !== 'blank') {
    const fb = 1.5;
    const fc = s.frame;
    const fo = { noJitter: true, surf: [DET.panel, 0.6, 0.15] };
    if ((lod >= 2 && yc < 80) || lod >= 3) {
      F.box('std', t, y1 - fb / 2, -R + 0.3, ww, fb, 1.5, fc, fo);
      F.box('std', t, y0 + fb / 2, -R + 0.3, ww, fb, 1.5, fc, fo);
      F.box('std', t - ww / 2 + fb / 2, yc, -R + 0.3, fb, wh - 2 * fb, 1.5, fc, fo);
      F.box('std', t + ww / 2 - fb / 2, yc, -R + 0.3, fb, wh - 2 * fb, 1.5, fc, fo);
      if (s.mullion) F.box('std', t, yc, -R + 0.3, 1.1, wh - 2 * fb, 1.3, fc, fo);
      if (s.mullion === 1) F.box('std', t, yc + wh * 0.06, -R + 0.3, ww - 2 * fb, 1.1, 1.3, fc, fo);
    } else if (lod >= 1) {
      F.span('std', t - ww / 2, t + ww / 2, y1 - fb, y1, -R + 0.9, fc, fo);
      F.span('std', t - ww / 2, t + ww / 2, y0, y0 + fb, -R + 0.9, fc, fo);
      F.span('std', t - ww / 2, t - ww / 2 + fb, y0, y1, -R + 0.9, fc, fo);
      F.span('std', t + ww / 2 - fb, t + ww / 2, y0, y1, -R + 0.9, fc, fo);
      if (s.mullion) F.rect('std', t, yc, -R + 0.9, 1.1, wh, fc, fo);
      if (s.mullion === 1) F.rect('std', t, yc + wh * 0.06, -R + 0.9, ww, 1.1, fc, fo);
    }
  }
  if (s.state === 'boarded') {
    // plywood planks nailed across the opening, one hanging loose
    const n = 3 + (hash01(s.seed + 5) < 0.4 ? 1 : 0);
    const woods = ['#5a4632', '#6b5a44', '#4a3a2a', '#75604a'];
    for (let p = 0; p < n; p++) {
      const py = y0 + (p + 0.5) * (wh / n);
      const tilt = (hash01(s.seed * 7 + p) - 0.5) * 0.12;
      B.add('std', T.box(), F.P(t + (hash01(s.seed + p) - 0.5) * 2, py, 1.0), [ww + 4, wh / n - 0.8, 0.8], [0, F.frot, 0], woods[(p + Math.floor(hash01(s.seed) * 4)) % 4], { surf: [DET.wood, 0.85, 0], map: 'box' });
      void tilt;
    }
  } else if (s.state === 'broken' && lod >= 1) {
    // teeth of glass left in the frame
    for (let k = 0; k < 4; k++) {
      const side = k % 2 ? 1 : -1;
      const tx = t + side * (ww / 2 - 1.2 - hash01(s.seed + k) * 2);
      F.rect('glass', tx, y1 - 2.5 - hash01(s.seed + k * 3) * 4, -rp + 0.1, 2.4, 5.5, GLASS, { surf: [DET.glass, -1, -1] });
    }
  }
  // sill and lintel
  if (s.sill) F.box('std', t, y0 - 1.15, -R, ww + 5, 2.3, R + 2.6, s.trim, { noJitter: true, surf: [DET.concrete, 0.85, 0] });
  if (s.lintel && lod >= 1) F.box('std', t, y1 + 1.5, 0, ww + 5, 3, 1.8, s.trim, { noJitter: true, surf: [DET.concrete, 0.85, 0] });
  if (lod >= 3 && s.state !== 'blank') windowCin(F, s, t, yc, ww, wh, y0, y1, R);
  if (s.shutters && lod >= 1) {
    for (const sd of [-1, 1]) F.box('std', t + sd * (ww / 2 + 3.6), yc, 0, ww * 0.42, wh + 1, 1.2, s.shutters, { noJitter: true, surf: [DET.siding, 0.85, 0] });
  }
  if (s.ac && lod >= 1) {
    // a window air conditioner: grille, a drip stain below
    F.rbox('std', t, y0 + wh * 0.32, -1, ww * 0.82, wh * 0.5, 9, 0.8, '#b8b9b4', { surf: [DET.panel, 0.5, 0.4] });
    F.rect('std', t, y0 + wh * 0.3, 8.1, ww * 0.6, wh * 0.28, '#2b2d2e', { noJitter: true, surf: [DET.hesco, 0.5, 0.6] });
  }
}

/**
 * Cinematic window trim: a meeting rail and glazing bars in the sash, corbels under the sill, a drip
 * cap and a keystone over the lintel, a thin dark shadow gap under the sill.
 */
function windowCin(F, s, t, yc, ww, wh, y0, y1, R) {
  const fc = s.frame, fo = { noJitter: true, surf: [DET.panel, 0.6, 0.15] };
  const light = shadeHex(s.trim, 0.08);
  const co = { noJitter: true, surf: [DET.concrete, 0.85, 0] };
  if (s.state !== 'boarded') {
    // meeting rail of the double-hung sash and glazing bars over the pane
    F.box('std', t, yc, -R + 0.25, ww - 3, 1.5, 1.7, fc, fo);
    if (ww > 12) for (const k of [-1, 1]) F.box('std', t + k * ww / 6, yc + wh * 0.25, -R + 0.5, 0.55, wh * 0.46, 1.1, fc, fo);
    if (ww > 12) for (const k of [-1, 1]) F.box('std', t + k * ww / 6, yc - wh * 0.25, -R + 0.5, 0.55, wh * 0.46, 1.1, fc, fo);
    F.box('std', t, yc + wh * 0.26, -R + 0.5, ww - 3, 0.55, 1.1, fc, fo);
    F.box('std', t, yc - wh * 0.26, -R + 0.5, ww - 3, 0.55, 1.1, fc, fo);
  }
  if (s.sill) {
    for (const k of [-1, 1]) F.box('std', t + k * (ww / 2 - 0.4), y0 - 3.7, -R * 0.4, 1.7, 2.6, R * 0.7 + 1.6, light, co);     // corbels
    F.box('std', t, y0 - 2.5, -R + 0.4, ww + 1.4, 0.5, 1, '#0a0a0b', { noJitter: true, surf: [0, 0.9, 0] });                  // shadow under the sill
  }
  if (s.lintel) {
    F.box('std', t, y1 + 3.35, 0.2, ww + 7.2, 0.9, 2.7, light, co);          // drip cap
    F.box('std', t, y1 + 1.6, 0.5, 3.2, 3.4, 2.3, light, co);                 // keystone
  }
}

// ---- doors ---------------------------------------------------------------------------------------

/**
 * A recessed door: reveals, a leaf with panels, a frame, a step, a lamp. spec: { t, w, h, y0 (floor),
 * R, leaf (hex), frame (hex), wall (hex), glazed (bool), step (bool), lamp (bool), seed, room, trim }
 */
export function doorUnit(F, s) {
  const B = F.B;
  const lod = DETAIL.level;
  const { t, w, h, y0, R } = s;
  const y1 = y0 + h, yc = y0 + h / 2;
  const inner = { noJitter: true, surf: [0, 0.9, 0] };
  F.reveal('std', 0, t - w / 2, yc, 0, 0, h, R, shadeHex(s.wall, -0.32), inner);
  F.reveal('std', 1, t + w / 2, yc, 0, 0, h, R, shadeHex(s.wall, -0.32), inner);
  F.reveal('std', 2, t, y1, 0, w, 0, R, shadeHex(s.wall, -0.4), inner);
  F.reveal('std', 3, t, y0, 0, w, 0, R, shadeHex(s.wall, -0.45), inner);
  const wood = { noJitter: true, surf: [DET.wood, 0.8, 0] };
  if (s.glazed) {
    // a glass door: lit shop behind (interior mapped), steel frame
    F.rect('room', t, yc + 1, -R + 1.4, w - 3.6, h - 2, '#ffe6c0', { pane: { id: s.room, w: w - 3.6, h: h - 2 }, emissive: 1.1 });
    const fo = { noJitter: true, surf: [DET.panel, 0.4, 0.6] };
    F.box('std', t - w / 2 + 1.1, yc, -R + 1, 2.2, h, 1.6, s.frame, fo);
    F.box('std', t + w / 2 - 1.1, yc, -R + 1, 2.2, h, 1.6, s.frame, fo);
    F.box('std', t, y1 - 1.1, -R + 1, w, 2.2, 1.6, s.frame, fo);
    F.box('std', t, y0 + 3.5, -R + 1, w, 7, 1.6, s.frame, fo);
    F.box('std', t, yc, -R + 1, 1.4, h, 1.6, s.frame, fo);
    if (lod >= 1) F.box('std', t + w * 0.22, yc - 1, -R + 2.4, 1.1, 10, 1.2, '#c9ced3', { noJitter: true, surf: [0, 0.2, 1] });
  } else {
    F.rect('std', t, yc, -R + 1.3, w - 1, h, s.leaf, wood);
    if (lod >= 1) {
      // raised panels
      for (const [py, ph] of [[y0 + h * 0.25, h * 0.32], [y0 + h * 0.72, h * 0.34]]) {
        F.box('std', t, py, -R + 1.2, w * 0.66, ph, 0.9, shadeHex(s.leaf, 0.08), wood);
      }
      F.box('std', t + w * 0.32, yc - 2, -R + 0.4, 1.6, 1.6, 1.6, '#c9a24a', { noJitter: true, surf: [0, 0.3, 0.9] });
      if (lod >= 3) doorCin(F, s, t, w, h, y0, yc, R);
    }
  }
  // frame and head
  const fr = { noJitter: true, surf: [DET.concrete, 0.85, 0] };
  F.box('std', t, y1 + 1.6, 0, w + 6, 3.2, 2.2, s.trim, fr);
  if (lod >= 1) {
    F.box('std', t - w / 2 - 1.3, yc, 0, 2.6, h, 1.4, s.trim, fr);
    F.box('std', t + w / 2 + 1.3, yc, 0, 2.6, h, 1.4, s.trim, fr);
  }
  if (s.step) {
    // a stoop from the ground up to the sill, and one lower step in front of it
    F.box('std', t, Math.max(1.5, y0 / 2), 0, w + 12, Math.max(3, y0), 8, '#8f8b82', { surf: [DET.slab, 0.88, 0] });
    if (y0 > 6) F.box('std', t, y0 / 4, 8, w + 8, y0 / 2, 5, '#8a867d', { surf: [DET.slab, 0.88, 0] });
  }
  if (s.lamp) {
    F.box('std', t + w / 2 + 6.5, y1 - 3, 0, 3.6, 5, 3, '#2a2c2e', { noJitter: true, surf: [DET.panel, 0.5, 0.5] });
    F.box('glow', t + w / 2 + 6.5, y1 - 3.4, 3, 2.6, 3.2, 1.2, '#ffd79a', { emissive: 4, uv: atlasUV('white'), noAO: true });
  }
}

/** Cinematic door furniture: panel mouldings, hinges, a lever handle on a rose, a kick plate, a house number. */
function doorCin(F, s, t, w, h, y0, yc, R) {
  const brass = { noJitter: true, surf: [0, 0.28, 0.95] };
  const wood = { noJitter: true, surf: [DET.wood, 0.8, 0] };
  const mould = shadeHex(s.leaf, 0.16);
  for (const [py, ph] of [[y0 + h * 0.25, h * 0.32], [y0 + h * 0.72, h * 0.34]]) {
    const pw = w * 0.66;
    F.box('std', t, py + ph / 2 + 0.3, -R + 0.75, pw + 1.2, 0.7, 0.5, mould, wood);
    F.box('std', t, py - ph / 2 - 0.3, -R + 0.75, pw + 1.2, 0.7, 0.5, mould, wood);
    for (const k of [-1, 1]) F.box('std', t + k * (pw / 2 + 0.3), py, -R + 0.75, 0.7, ph + 1.2, 0.5, mould, wood);
  }
  for (const y of [y0 + h * 0.16, yc, y0 + h * 0.86]) F.box('std', t - w * 0.47, y, -R + 0.5, 0.9, 3.4, 0.9, '#25262a', { noJitter: true, surf: [0, 0.4, 0.8] });
  F.box('std', t + w * 0.32, yc - 2, -R + 0.15, 2.6, 5.2, 0.5, '#b9b2a2', brass);                                  // the handle rose
  F.box('std', t + w * 0.28, yc - 2.4, -R - 0.3, 4.4, 0.8, 0.8, '#d2ccbc', brass);                               // the lever
  F.box('std', t + w * 0.32, yc + 3.2, -R + 0.25, 1.4, 1.4, 1.2, '#b9b2a2', brass);                              // the deadbolt
  F.box('std', t, y0 + 3.4, -R + 0.6, w * 0.8, 5.4, 0.35, '#8a8d90', { noJitter: true, surf: [0, 0.35, 0.8] });   // kick plate
  F.box('std', t, y0 + h * 0.6, -R + 0.5, 1.1, 1.1, 0.4, '#1a1a1c', { noJitter: true, surf: [0, 0.2, 0.8] });     // peephole
  F.box('std', t + w / 2 + 5, y0 + h * 0.7, 0.3, 2.6, 3.4, 0.6, '#d8d2c2', brass);                                // number plate
}

// ---- shop fronts, awnings, signs -------------------------------------------------------------------

/** A striped fabric awning over t0..t1 from height y, sloping down and out by `d`. */
export function awning(F, t0, t1, y, d, colA, colB) {
  const lod = DETAIL.level;
  const stripes = Math.max(2, Math.round((t1 - t0) / 9));
  const w = (t1 - t0) / stripes;
  const pts = [[0, 0], [d, -d * 0.55], [d, -d * 0.55 - 1.3], [0, -1.3 + 2.2]];
  for (let i = 0; i < stripes; i++) {
    const c = i % 2 ? colB : colA;
    F.prof('std', 'awn' + d, pts, t0 + i * w, t0 + (i + 1) * w - 0.05, y, c, { noJitter: true, surf: [DET.fabric, 0.85, 0] });
  }
  // the scalloped valance
  if (lod >= 1) {
    for (let i = 0; i < stripes; i++) F.box('std', t0 + (i + 0.5) * w, y - d * 0.55 - 2.6, d - 0.6, w - 0.1, 3.8, 0.9, i % 2 ? colB : colA, { noJitter: true, surf: [DET.fabric, 0.85, 0] });
  }
  // rods
  if (lod >= 2) for (const t of [t0 + 1, t1 - 1]) F.box('std', t, y - d * 0.28, 0, 0.9, 0.9, d, '#3a3c3e', { noJitter: true, surf: [DET.rust, 0.5, 0.7] });
}

/** A painted sign board on the wall: a frame, the atlas sign, a lamp on an arm. */
export function signBoard(F, t, y, w, cell, opts = {}) {
  const h = w / 4;
  const c = opts.color || '#ffffff';
  F.box('std', t, y, 0, w + 3, h + 3, 2.2, opts.frame || '#2a2622', { noJitter: true, surf: [DET.wood, 0.8, 0] });
  F.rect('decal', t, y, 2.25, w, h, c, { uv: atlasUV(cell), noAO: true, noJitter: true });
  if (opts.lamp !== false && DETAIL.level >= 1) {
    for (const s of [-0.32, 0.32]) {
      F.box('std', t + w * s, y + h / 2 + 3.4, 2, 1, 1, 5, '#2a2c2e', { noJitter: true, surf: [DET.rust, 0.5, 0.7] });
      F.box('glow', t + w * s, y + h / 2 + 3.6, 6.5, 4.2, 1.4, 2.2, '#fff0d0', { emissive: 3, uv: atlasUV('white'), noAO: true });
    }
  }
}

/** A roll-up shutter half down over t0..t1 from y0 to y1 (a garage cell texture, rust and dust). */
export function shutter(F, t0, t1, y0, y1, seed) {
  const lod = DETAIL.level;
  F.span('decal', t0, t1, y0, y1, -1.6, '#ffffff', { uv: atlasUV('garage'), noAO: true });
  if (lod >= 1) {
    F.box('std', (t0 + t1) / 2, y1 + 1.6, -2.4, t1 - t0 + 2, 3.2, 4, '#3a3d40', { noJitter: true, surf: [DET.rust, 0.6, 0.6] });
    F.box('std', (t0 + t1) / 2, y0 + 1.4, -1.5, t1 - t0 - 1, 2.8, 1.6, '#4a4e52', { noJitter: true, surf: [DET.rust, 0.6, 0.7] });
  }
  void seed;
}

// ---- cornices and trim ------------------------------------------------------------------------------

/** Stepped cornice along the top of a face (t from -len/2 - ext to len/2 + ext). */
export function cornice(F, y, color, ext = 2, size = 1) {
  const s = size;
  const pts = [[-0.5, -3.4 * s], [1.6 * s, -3.4 * s], [1.6 * s, -2.2 * s], [3.1 * s, -1.2 * s], [3.1 * s, 0.6 * s], [4.4 * s, 1.6 * s], [4.4 * s, 3 * s], [-0.5, 3 * s]];
  F.prof('std', 'cornice' + s, pts, -F.len / 2 - ext, F.len / 2 + ext, y, color, { noJitter: true, surf: [DET.concrete, 0.85, 0] });
  if (DETAIL.level >= 2) {
    // brackets under the cornice every so often
    const n = Math.max(2, Math.floor(F.len / 22));
    for (let i = 0; i < n; i++) {
      const t = -F.len / 2 + (i + 0.5) * (F.len / n);
      F.box('std', t, y - 4.6 * s, 0, 2.2 * s, 3.4 * s, 2.6 * s, shadeHex(color, -0.08), { noJitter: true, surf: [DET.concrete, 0.85, 0] });
    }
  }
}

/** A drainpipe from the roof edge to the ground with a couple of brackets. */
export function downspout(F, t, top, color = '#5a5e62') {
  F.B.add('std', T.cyl(6), F.P(t, top / 2 + 1, 1.6), [1.1, top - 2, 1.1], null, color, { surf: [DET.rust, 0.5, 0.7], map: 'cyl', noJitter: true });
  if (DETAIL.level >= 1) {
    for (let y = 14; y < top - 6; y += 34) F.box('std', t, y, 0, 3, 1.2, 2.6, '#3a3c3e', { noJitter: true, surf: [DET.rust, 0.5, 0.7] });
    F.box('std', t, top - 1, 0.5, 4.4, 4.4, 3.6, color, { noJitter: true, surf: [DET.rust, 0.5, 0.7] });
  }
}

/** A conduit / pipe run along a wall at height y between t0 and t1, with a few clamps. */
export function conduit(F, t0, t1, y, color = '#6a6d70') {
  const c = F.P((t0 + t1) / 2, y, 1.4);
  F.B.add('std', T.cyl(6), c, [0.8, t1 - t0, 0.8], [0, 0, Math.PI / 2], color, { surf: [DET.rust, 0.5, 0.7], map: 'cyl', noJitter: true });
}

// ---- balconies, walkways, fire escapes ---------------------------------------------------------------------

/** A railing along a face between t0..t1 at floor height y: posts and rails. */
export function railing(F, t0, t1, y, out, color, high = 13) {
  const lod = DETAIL.level;
  const n = Math.max(2, Math.round((t1 - t0) / 9));
  const S = { noJitter: true, surf: [DET.rust, 0.5, 0.75] };
  F.box('std', (t0 + t1) / 2, y + high, out, t1 - t0, 1.2, 1.2, color, S);
  F.box('std', (t0 + t1) / 2, y + high * 0.45, out, t1 - t0, 0.7, 0.7, color, S);
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    F.box('std', t, y + high / 2, out, 1.1, high, 1.1, color, S);
    if (lod >= 2 && i < n) for (let k = 1; k < 3; k++) F.box('std', t + ((t1 - t0) / n) * (k / 3), y + high / 2, out, 0.5, high, 0.5, color, S);
  }
}

/** A balcony / walkway slab with a railing, brackets under it. */
export function balcony(F, t0, t1, y, depth, color, railColor) {
  F.box('std', (t0 + t1) / 2, y - 1.2, 0, t1 - t0, 2.4, depth, color, { noJitter: true, surf: [DET.concrete, 0.86, 0] });
  railing(F, t0 + 1, t1 - 1, y, depth - 1, railColor);
  if (DETAIL.level >= 1) {
    for (const t of [t0 + 2, t1 - 2]) F.box('std', t, y - 6, 0, 1.6, 8, 1.6, '#3a3c3e', { noJitter: true, surf: [DET.rust, 0.5, 0.7] });
  }
}

/** A steel fire escape up a face: platforms with railings at each floor and zig-zag stairs between them. */
export function fireEscape(F, t, floors, floorY, w = 26, depth = 12) {
  const lod = DETAIL.level;
  const steel = '#2c2f32';
  const S = { noJitter: true, surf: [DET.rust, 0.55, 0.7] };
  for (let f = 1; f < floors; f++) {
    const y = floorY(f);
    F.box('std', t, y - 0.8, 0, w, 1.6, depth, steel, S);
    F.box('std', t, y + 5.5, depth - 0.8, w, 0.9, 0.9, steel, S);
    F.box('std', t, y + 11, depth - 0.8, w, 1, 1, steel, S);
    for (const sd of [-1, 1]) F.box('std', t + sd * (w / 2 - 0.5), y + 5.5, depth / 2, 0.9, 11, depth, steel, S);
    for (let k = 0; k <= 4; k++) F.box('std', t - w / 2 + (k * w) / 4, y + 5.5, depth - 0.8, 0.8, 11, 0.8, steel, S);
    if (f > 1) {
      // stairs down to the floor below, running along the wall: two stringers and the treads
      const y0 = floorY(f - 1), dir = f % 2 ? 1 : -1;
      const steps = 9, run = w - 7, rise = y - y0;
      const ang = Math.atan2(rise, run) * dir;
      for (const zo of [0.25, 0.85]) {
        F.B.add('std', T.box(), F.P(t, (y + y0) / 2, depth * zo * 0.9 + 0.5), [Math.hypot(run, rise), 0.9, 0.9], [0, F.frot, ang], steel, S);
      }
      if (lod >= 1) {
        for (let k = 0; k < steps; k++) {
          const u = (k + 0.5) / steps;
          F.box('std', t + dir * (-run / 2 + run * u), y0 + rise * u, depth * 0.2, run / steps * 0.9, 0.7, depth * 0.62, steel, S);
        }
      }
    }
  }
  // the drop ladder from the bottom platform
  const yb = floorY(1);
  for (const sd of [-1, 1]) F.box('std', t + sd * 2.6, yb / 2, depth - 1.5, 0.8, yb - 2, 0.8, steel, S);
  if (lod >= 1) for (let y = 6; y < yb - 4; y += 6) F.box('std', t, y, depth - 1.5, 5.6, 0.7, 0.7, steel, S);
}

// ---- roof plant ---------------------------------------------------------------------------------------------

/** A rooftop AC unit: casing, louvred side, fan grille. `x, z` roof-frame position on y0. */
export function acUnit(B, x, y0, z, w, d, h, rot = 0, color = '#8e9294') {
  const r = [0, rot, 0];
  B.add('std', T.rbox(w, h, d, 1), [x, y0 + h / 2, z], [1, 1, 1], r, color, { surf: [DET.panel, 0.45, 0.6] });
  const c = Math.cos(rot), s = Math.sin(rot);
  // louvres on the front (+z of the unit)
  B.add('std', T.box(), [x + s * (d / 2 + 0.2), y0 + h * 0.45, z + c * (d / 2 + 0.2)], [w * 0.8, h * 0.55, 0.5], r, '#2a2c2e', { surf: [DET.corrugated, 0.5, 0.7], noJitter: true });
  // fan on top
  B.add('std', T.cyl(14), [x, y0 + h + 0.4, z], [Math.min(w, d) * 0.34, 0.8, Math.min(w, d) * 0.34], null, '#2b2d2f', { surf: [DET.hesco, 0.5, 0.75], map: 'cyl', noJitter: true });
  if (DETAIL.level >= 1) {
    // refrigerant lines running off the unit
    B.add('std', T.cyl(5), [x + c * (w / 2 + 6), y0 + 2, z + s * (w / 2 + 6)], [0.7, 12, 0.7], [0, 0, Math.PI / 2], '#b9bcb5', { surf: [DET.plastic, 0.5, 0], map: 'cyl', noJitter: true });
  }
}

/** A squat chimney / vent stack with a cap. */
export function ventStack(B, x, y0, z, rad, h, color = '#5a5e62') {
  B.cyl('std', x, y0, z, rad, h, color, 8, 1, null, { surf: [DET.rust, 0.5, 0.7], noJitter: true });
  B.cyl('std', x, y0 + h, z, rad * 1.7, 1.2, shadeHex(color, -0.15), 8, 0.9, null, { surf: [DET.rust, 0.5, 0.7], noJitter: true });
  B.cyl('std', x, y0 + h + 1.2, z, rad * 1.2, 0.8, '#3a3c3e', 8, 0.2, null, { surf: [DET.rust, 0.5, 0.7], noJitter: true });
}

/** A water tank on a steel frame with a conical roof and a ladder. */
export function waterTank(B, x, y0, z, rad = 13) {
  const wood = { surf: [DET.wood, 0.85, 0] };
  const steel = { surf: [DET.rust, 0.6, 0.65], noJitter: true };
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.block('std', x + a * rad * 0.62, y0, z + b * rad * 0.62, 1.6, 22, 1.6, '#3a3632', null, steel);
  for (const yy of [8, 16]) {
    B.box('std', x, y0 + yy, z - rad * 0.62, rad * 1.28, 0.9, 0.9, '#3a3632', null, steel);
    B.box('std', x, y0 + yy, z + rad * 0.62, rad * 1.28, 0.9, 0.9, '#3a3632', null, steel);
    B.box('std', x - rad * 0.62, y0 + yy, z, 0.9, 0.9, rad * 1.28, '#3a3632', null, steel);
    B.box('std', x + rad * 0.62, y0 + yy, z, 0.9, 0.9, rad * 1.28, '#3a3632', null, steel);
  }
  B.cyl('std', x, y0 + 22, z, rad, 26, '#5a4a3a', 14, 1, null, wood);
  for (const yy of [26, 34, 42]) B.cyl('std', x, y0 + yy, z, rad + 0.5, 1, '#2f2b26', 14, 1, null, steel);
  B.cyl('std', x, y0 + 48, z, rad + 0.6, 6, '#3a3632', 14, 0.05, null, { surf: [DET.rust, 0.7, 0.4], noJitter: true });
  for (let y = 2; y < 46; y += 5) B.box('std', x + rad + 1.4, y0 + y, z, 0.8, 0.8, 5, '#3a3632', null, steel);
}

/** A rooftop antenna mast with cross arms, or a TV yagi. */
export function antenna(B, x, y0, z, h = 40, seed = 0) {
  const steel = { surf: [0, 0.4, 0.9], noJitter: true };
  B.cyl('std', x, y0, z, 0.8, h, '#8a8e92', 5, 0.8, null, steel);
  for (let k = 0; k < 3; k++) {
    const y = y0 + h * (0.45 + k * 0.17);
    B.box('std', x, y, z, 12 - k * 2.4, 0.6, 0.6, '#9a9ea2', null, steel);
  }
  if (DETAIL.level >= 1) {
    // guy wires
    for (const a of [0.4, 2.5, 4.4]) B.add('std', T.cyl(3), [x + Math.cos(a) * 8, y0 + h * 0.35, z + Math.sin(a) * 8], [0.2, h * 0.72, 0.2], [Math.sin(a) * 0.22, 0, -Math.cos(a) * 0.22], '#6a6d70', { surf: [0, 0.4, 0.8], map: 'cyl', noJitter: true });
  }
  void seed;
}

/** A satellite dish on a short mount, tilted at the sky. */
export function dish(B, x, y0, z, r = 7, rot = 0.6) {
  B.cyl('std', x, y0, z, 0.9, 6, '#7a7e82', 6, 1, null, { surf: [DET.rust, 0.5, 0.7], noJitter: true });
  B.add('std', T.sphere(12, 6), [x, y0 + 8, z], [r, r * 0.42, r], [0.9, rot, 0], '#d8d8d0', { surf: [DET.panel, 0.45, 0.35], noJitter: true });
  B.add('std', T.cyl(4), [x + Math.sin(rot) * 3, y0 + 9.5, z + Math.cos(rot) * 3], [0.4, 6, 0.4], [1.0, rot, 0], '#333', { surf: [0, 0.5, 0.6], map: 'cyl', noJitter: true });
}

/** A skylight / roof hatch: a low curb with a translucent panel. */
export function hatch(B, x, y0, z, w, d, rot = 0) {
  B.add('std', T.rbox(w, 5, d, 0.8), [x, y0 + 2.5, z], [1, 1, 1], [0, rot, 0], '#77797b', { surf: [DET.panel, 0.5, 0.5], noJitter: true });
  B.add('std', T.box(), [x, y0 + 5.2, z], [w * 0.84, 0.6, d * 0.84], [0, rot, 0], '#5a6c74', { surf: [DET.glass, 0.3, 0.4], noJitter: true });
}

/** A chimney of brick with a cap and a flue. Stands on y0. */
export function chimney(B, x, y0, z, w, h, color) {
  B.rblock('std', x, y0, z, w, h, w, 0.6, shadeHex(color, -0.18), null, { surf: [DET.brick, 0.9, 0], noJitter: true });
  B.rblock('std', x, y0 + h, z, w + 3, 2.6, w + 3, 0.5, '#8a877e', null, { surf: [DET.concrete, 0.85, 0], noJitter: true });
  B.box('std', x, y0 + h + 3.4, z, w * 0.5, 1.6, w * 0.5, '#1c1a18', null, { surf: [DET.char, 0.9, 0.2], noJitter: true });
  if (DETAIL.level >= 1) B.cyl('std', x, y0 + h + 2.6, z, w * 0.2, 5, '#5a5e62', 8, 1, null, { surf: [DET.rust, 0.5, 0.7], noJitter: true });
}
