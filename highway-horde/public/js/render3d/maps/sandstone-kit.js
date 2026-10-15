// The modelling kit of Sandstone (render3d/maps/sandstone.js): the town's houses and walls. A house
// (an obstacle styled 'house', its `top` its height) is a lime-washed or sandstone block with a flat
// earth roof behind a parapet; its open faces get windows (an interior-mapped room behind the glass,
// a sill and a lintel, blue or green shutters open, half-open or shut, a grille on the ground floor,
// now and then a wooden lattice bay), studded doors under arches, shop fronts with boards and striped
// awnings, air conditioners, beam ends, patches of fallen plaster over the brick, grime; its roof gets
// water tanks, dishes, stair huts, laundry lines, a dome now and then. A face against a taller
// neighbour is plain wall. Detail follows the tier (P.lod 0 low .. 3 cinematic).
//
// Local frame of an object (world-geo.js): +x along the obstacle's `w`, +z along its `h`, +y up.

import * as THREE from 'three';
import { T, shadeHex, mixHex, hash01 } from '../world-geo.js';
import { DET } from '../world-surf.js';
import { atlasUV } from '../world-tex.js';
import { roomId } from '../world-arch.js';
import { rod } from '../dress-kit.js';
import { ssUV } from './sandstone-atlas.js';

export { T, shadeHex, mixHex, hash01, DET, atlasUV, rod, ssUV };

export const HALF = Math.PI / 2;
export const PI = Math.PI;

/** Surface shorthand: { surf: [layer, roughness, metalness] }. */
export const S = (layer = 0, rough = 0.85, metal = 0) => ({ surf: [layer, rough, metal] });
export const PLASTER = S(DET.plaster, 0.92, 0);
export const STUCCO = S(DET.stucco, 0.93, 0);
export const STONE = S(DET.stucco, 0.9, 0);
export const BRICK = S(DET.brick, 0.9, 0);
export const WOOD = S(DET.wood, 0.85, 0);
export const IRON = S(DET.rust, 0.6, 0.55);
export const METAL = S(DET.panel, 0.45, 0.55);
export const FABRIC = S(DET.fabric, 0.95, 0);
export const ROOFS = S(DET.plaster, 0.95, 0);
export const NJ = { noJitter: true };

/** Shutter and door paints: the town's blues and a few greens. */
export const BLUES = ['#2f6f9a', '#3b80b0', '#24577e', '#2c8aa8', '#3d6f8f', '#2e7a6a', '#4a7f5a'];
const SHOP_SIGNS = ['s_cafe', 's_hammam', 's_pharm', 's_bakery', 's_tailor'];
const PLAQUES = ['p_rue1', 'p_rue2', 'p_rue3', 'p_rue4'];
const AWNINGS = ['st_red', 'st_blue', 'st_ochre', 'st_green'];

// ---- small helpers --------------------------------------------------------------------------------

/** An atlas picture on a plane facing local +z rotated `ry` about y (bucket 'sssign'). */
export function pic(B, cell, x, y, z, w, h, ry = 0, o = {}) {
  B.add(o.bucket || 'sssign', T.plane(), [x, y, z], [w, h, 1], [o.rx || 0, ry, o.rz || 0], o.color || '#ffffff', { uv: o.uv || ssUV(cell), noAO: true, noJitter: true, emissive: o.k });
}

/** A blended decal (grime, blood, cracks) on a plane facing local +z rotated `ry`. */
export function decal(B, cell, x, y, z, w, h, ry = 0, o = {}) {
  B.add('ssdecal', T.plane(), [x, y, z], [w, h, 1], [o.rx || 0, ry, 0], o.color || '#ffffff', { uv: ssUV(cell), noAO: true, noJitter: true });
}

/** An unlit emissive box (lantern glass, bulbs). */
export function glowBox(B, x, y, z, sx, sy, sz, color, k = 3, r = null) {
  B.box('glow', x, y, z, sx, sy, sz, color, r, { emissive: k, uv: atlasUV('white'), noAO: true, noJitter: true });
}

/** A semicircular arch outline as an extrusion profile (radius 1, springing at y = 0), a wall of thickness `t` around it. */
export function archProfile(n = 10) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = PI - (i / n) * PI;
    pts.push([Math.cos(a), Math.sin(a)]);
  }
  return pts;
}

/**
 * The spandrel of an arch: the wall above a semicircular opening of radius r (springing at y = 0),
 * up to height `top` above the springing, as an extruded profile (centred on z, `depth` deep).
 */
export function archWall(B, bucket, x, y, z, r, top, depth, color, ry = 0, o = STONE, n = 10) {
  const key = `ssarch:${r.toFixed(1)}:${top.toFixed(1)}:${n}`;
  const pts = [[-r - 0.01, 0], [-r - 0.01, top], [r + 0.01, top], [r + 0.01, 0]];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * PI;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  B.add(bucket, T.profile(key, pts), [x, y, z], [1, 1, depth], [0, ry, 0], color, o);
}

/** A half disc (the head of an arched window or door) as a thin extruded profile. */
export function archHead(B, bucket, x, y, z, r, depth, color, ry = 0, o = null, n = 10) {
  const pts = [[-r, 0]];
  for (let i = 1; i < n; i++) {
    const a = PI - (i / n) * PI;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  pts.push([r, 0]);
  B.add(bucket, T.profile(`sshead:${r.toFixed(1)}:${n}`, pts), [x, y, z], [1, 1, depth], [0, ry, 0], color, o);
}

// ---- faces ---------------------------------------------------------------------------------------------

/**
 * The four faces of an obstacle in its local frame: side 0 = +z (sim local +y), 1 = −z, 2 = +x, 3 = −x.
 * `at(t, d)` is the local [x, z] of along-position t (−L/2..L/2) at d units out of the face.
 */
export function faceOf(o, side) {
  const hw = o.w / 2, hd = o.h / 2;
  switch (side) {
    case 0: return { side, L: o.w, ry: 0, at: (t, d = 0) => [t, hd + d], n: [0, 1] };
    case 1: return { side, L: o.w, ry: PI, at: (t, d = 0) => [-t, -hd - d], n: [0, -1] };
    case 2: return { side, L: o.h, ry: HALF, at: (t, d = 0) => [hw + d, -t], n: [1, 0] };
    default: return { side, L: o.h, ry: -HALF, at: (t, d = 0) => [-hw - d, t], n: [-1, 0] };
  }
}

/** World (sim) point of a local [x, z] of obstacle o. */
export function toWorld(o, lx, lz) {
  const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0);
  return [o.x + lx * c - lz * s, o.y + lx * s + lz * c];
}

/**
 * How much of a face is open to the street: for points along it a little way out, the height of the
 * building standing there (0 = open ground). Returns { open: share of open samples, cover: highest
 * neighbour top, ceil: the lowest vault springing over the street there (Infinity in the open),
 * samples: [{ t, top }] }.
 */
export function faceCover(P, o, F, base = 0) {
  const out = [];
  let open = 0, cover = 0, ceil = Infinity;
  const n = Math.max(3, Math.round(F.L / 60));
  for (let i = 0; i < n; i++) {
    const t = -F.L / 2 + ((i + 0.5) / n) * F.L;
    const [lx, lz] = F.at(t, 8);
    const [wx, wy] = toWorld(o, lx, lz);
    // (blockTop is absolute, 0 in the open: a neighbour's top over this face's street)
    const abs = P.blockTop(wx, wy, o);
    const top = abs > 0 ? Math.max(0, abs - base) : 0;
    out.push({ t, top });
    if (top <= 0) open++;
    cover = Math.max(cover, top);
    if (P.ceilAt) ceil = Math.min(ceil, P.ceilAt(wx, wy) - base);
  }
  return { open: open / n, cover, ceil, samples: out };
}

/**
 * The ground along a face of obstacle o (a few points `out` units off it), relative to the ground at
 * the obstacle's centre (where its frame stands): { lo, hi } (0, 0 on flat ground).
 */
export function faceGround(P, o, F, out = 10) {
  if (!P.gy) return { lo: 0, hi: 0 };
  const g0 = P.gy(o.x, o.y);
  let lo = Infinity, hi = -Infinity;
  for (const u of [-0.45, -0.15, 0.15, 0.45]) {
    const [lx, lz] = F.at(u * F.L, out);
    const [wx, wy] = toWorld(o, lx, lz);
    const g = P.gy(wx, wy) - g0;
    lo = Math.min(lo, g);
    hi = Math.max(hi, g);
  }
  return { lo, hi };
}

/** The lowest ground around obstacle o (just off each face), relative to its centre's (≤ 0). */
export function lowGround(P, o, out = 8) {
  let lo = 0;
  for (const side of [0, 1, 2, 3]) lo = Math.min(lo, faceGround(P, o, faceOf(o, side), out).lo);
  return lo;
}

// ---- the house ---------------------------------------------------------------------------------------

/**
 * One house of the town (the frame is at the obstacle).
 * @param {object} P model context { B, o, lod, day, blockTop(x, y, self) }
 */
export function house(P) {
  const { B, o, lod } = P;
  const H = o.top || 150;
  const w = o.w, d = o.h;
  const seed = Math.round(o.x * 7 + o.y * 13);
  const h0 = hash01(seed);
  const col = o.color || '#d9c29c';
  const roofCol = o.roof || '#b9a27c';
  const adobe = h0 < 0.35;
  const fin = adobe ? STUCCO : PLASTER;
  // the streets around it: on a town of levels a face may stand over a lower street (the body
  // reaches down to it) or a higher one (its doors and windows climb with it)
  const faces = [0, 1, 2, 3].map((side) => {
    const F = faceOf(o, side);
    return { F, g: faceGround(P, o, F) };
  });
  const y0 = Math.min(0, ...faces.map((f) => f.g.lo));
  // the body (rounded corners from 'high' up: lime plaster softens every edge)
  if (lod >= 1) B.rblock('std', 0, y0, 0, w, H - y0, d, Math.min(3.5, w * 0.05, d * 0.05), col, null, fin);
  else B.block('std', 0, y0, 0, w, H - y0, d, col, null, fin);
  // a darker plinth where the street splashes the wall (at each face's own street)
  for (const { F, g } of faces) {
    const [px, pz] = F.at(0, 0.6);
    B.box('std', px, g.lo + 6.5, pz, F.L + 1.2, 13, 1.2, shadeHex(col, -0.22), [0, F.ry, 0], STUCCO);
  }
  // the cornice: a moulded band under the parapet (two steps out)
  if (lod >= 1) {
    const cc = shadeHex(col, -0.06);
    B.block('std', 0, H - 7, 0, w + 3, 3, d + 3, cc, null, STONE);
    B.block('std', 0, H - 4, 0, w + 5, 4, d + 5, shadeHex(col, 0.03), null, STONE);
    if (lod >= 2) B.block('std', 0, H - 10, 0, w + 1.6, 2, d + 1.6, shadeHex(col, -0.14), null, STONE);
  }
  // the roof: an earth slab behind a parapet with a cap
  const PT = 4, PH = 12 + Math.round(hash01(seed + 5) * 8);
  B.block('std', 0, H, 0, w - PT * 2, 1, d - PT * 2, roofCol, null, ROOFS);
  const parCol = shadeHex(col, 0.04);
  B.block('std', 0, H, d / 2 - PT / 2, w, PH, PT, parCol, null, fin);
  B.block('std', 0, H, -d / 2 + PT / 2, w, PH, PT, parCol, null, fin);
  B.block('std', w / 2 - PT / 2, H, 0, PT, PH, d - PT * 2, parCol, null, fin);
  B.block('std', -w / 2 + PT / 2, H, 0, PT, PH, d - PT * 2, parCol, null, fin);
  if (lod >= 1) {
    const cap = shadeHex(col, -0.12);
    B.block('std', 0, H + PH, d / 2 - PT / 2, w + 1.4, 2, PT + 1.4, cap, null, STONE);
    B.block('std', 0, H + PH, -d / 2 + PT / 2, w + 1.4, 2, PT + 1.4, cap, null, STONE);
    B.block('std', w / 2 - PT / 2, H + PH, 0, PT + 1.4, 2, d - PT * 2, cap, null, STONE);
    B.block('std', -w / 2 + PT / 2, H + PH, 0, PT + 1.4, 2, d - PT * 2, cap, null, STONE);
  }
  // merlons on the old houses (stepped crenellation on the parapet)
  const crenel = lod >= 1 && hash01(seed + 9) < 0.28;
  if (crenel) {
    for (const side of [0, 1, 2, 3]) {
      const F = faceOf(o, side);
      const n = Math.floor(F.L / 22);
      for (let i = 0; i < n; i++) {
        if (i % 2) continue;
        const t = -F.L / 2 + (i + 0.5) * (F.L / n);
        const [x, z] = F.at(t, -PT / 2);
        B.block('std', x, H + PH, z, 9, 7, PT, parCol, [0, F.ry, 0], fin);
      }
    }
  }
  // the faces, each from its own street up (the frame lifted to it for the facade)
  const objSeed = Math.round(o.id * 31);
  for (const { F, g } of faces) {
    if (F.L < 60) continue;
    const base = g.lo;
    const Hf = H - base;
    if (Hf < 40) continue;
    const storeys = Math.max(1, Math.floor((Hf - 20) / 46));
    const cov = faceCover(P, o, F, (P.gy ? P.gy(o.x, o.y) : 0) + base);
    if (base !== 0) B.obj(o.x, o.y, o.a || 0, objSeed + F.side, base);
    // (a face along a ramp: no door, it would sink into the slope at one end)
    facade(P, F, cov, { H: Hf, storeys, col, seed: seed + F.side * 101, adobe, slope: g.hi - g.lo > 8 });
    if (base !== 0) B.obj(o.x, o.y, o.a || 0, objSeed + 7);
  }
  roofProps(P, { H, PH, w, d, seed, col });
}

/** Windows, doors, shop fronts and the wall's wear on one face. */
function facade(P, F, cov, h) {
  const { B, lod } = P;
  const { H, storeys, col, seed, adobe } = h;
  const L = F.L;
  // a face buried against a taller neighbour: plain wall
  if (cov.open < 0.2 && cov.cover >= H - 4) return;
  const rnd = (k) => hash01(seed * 31 + k * 17);
  const shut = BLUES[Math.floor(rnd(1) * BLUES.length)];
  // a face under a tunnel's vault keeps everything below the springing (Infinity in the open)
  const lim = Math.min(H, cov.ceil - 6);
  // beam ends (vigas) under the parapet of an adobe house
  if (adobe && lod >= 1 && lim >= H) {
    for (let t = -L / 2 + 18; t < L / 2 - 10; t += 26) {
      const [x, z] = F.at(t, 3);
      B.add('std', T.cyl(6), [x, H - 9, z], [2.6, 8, 2.6], [HALF, F.ry, 0], '#5a3a22', { ...WOOD, map: 'cyl', noJitter: true });
    }
  }
  // the ground floor: a door or a shop front on a face to the street, else windows
  const ground = cov.open >= 0.5 && !h.slope;
  const pitch = 64 + rnd(2) * 34;
  const n = Math.max(1, Math.floor((L - 40) / pitch));
  const step = (L - 40) / n;
  const doorAt = ground && L >= 110 ? Math.floor(rnd(3) * n) : -1;
  const shop = doorAt >= 0 && rnd(4) < 0.32 && L >= 160 && lim >= H;
  for (let k = 0; k < storeys; k++) {
    const yb = 26 + k * 46;
    for (let i = 0; i < n; i++) {
      const t = -L / 2 + 20 + (i + 0.5) * step;
      // only where the wall is open to the air at this height
      const s = cov.samples.reduce((best, q) => (Math.abs(q.t - t) < Math.abs(best.t - t) ? q : best), cov.samples[0]);
      // (a door fits under a vault: it hugs the wall, where the vault curves up from the springing)
      if (s.top > yb + 40 || (yb + (k ? 40 : 34) > lim && !(k === 0 && i === doorAt))) continue;
      if (k === 0 && i === doorAt) {
        if (shop) shopFront(P, F, t, Math.min(step - 10, 110), rnd(i + 40));
        else door(P, F, t, shut, rnd(i + 50));
        continue;
      }
      const r = rnd(k * 13 + i + 7);
      if (r < 0.18) continue;                       // blank wall
      windowUnit(P, F, t, yb, { r, shut, ground: k === 0, seed: seed + k * 7 + i, top: k === storeys - 1 });
    }
  }
  // fallen plaster over the brick, grime at the foot, a stain or two
  if (lod >= 1 && L > 80 && rnd(59) < 0.7) {
    // fallen plaster: a ragged patch of bare brick (two overlapping pieces, muted toward the wall's colour)
    const pw = 10 + rnd(61) * 18, ph = 8 + rnd(62) * 12;
    const t = (rnd(63) - 0.5) * (L - pw - 30), y = 16 + rnd(64) * Math.max(0, lim - ph - 44);
    const brick = mixHex('#9a6a4e', col, 0.45);
    const [x, z] = F.at(t, 0.18);
    B.add('std', T.plane(), [x, y + ph / 2, z], [pw, ph, 1], [0, F.ry, 0], brick, { ...BRICK, noJitter: true });
    const [x2, z2] = F.at(t + pw * 0.35, 0.2);
    B.add('std', T.plane(), [x2, y + ph * 0.8, z2], [pw * 0.6, ph * 0.7, 1], [0, F.ry, 0], brick, { ...BRICK, noJitter: true });
  }
  if (lod >= 2 && L > 60) {
    const [x, z] = F.at((rnd(70) - 0.5) * L * 0.5, 0.35);
    decal(B, 'grime', x, 22, z, Math.min(L * 0.7, 120), 44, F.ry);
    if (rnd(71) < 0.45 && lim >= H) {
      const [x2, z2] = F.at((rnd(72) - 0.5) * L * 0.6, 0.4);
      decal(B, 'streak', x2, H - 40, z2, 18, 70, F.ry);
    }
    if (rnd(73) < 0.3 && lim > 100) {
      const [x3, z3] = F.at((rnd(74) - 0.5) * L * 0.6, 0.45);
      decal(B, 'cracks', x3, 40 + rnd(75) * (lim - 80), z3, 50, 50, F.ry);
    }
  }
  // a street plaque at a corner, now and then
  if (lod >= 1 && ground && lim > 100 && rnd(80) < 0.18) {
    const [x, z] = F.at(L / 2 - 26, 0.6);
    pic(B, PLAQUES[Math.floor(rnd(81) * PLAQUES.length)], x, 92, z, 30, 10.5, F.ry);
  }
  // an air conditioner on the upper floors, between two windows (or by the corner)
  if (lod >= 1 && storeys >= 2 && lim >= H && rnd(90) < 0.5) {
    const t = n > 1 ? -L / 2 + 20 + (1 + Math.floor(rnd(91) * (n - 1))) * step : (rnd(91) < 0.5 ? -1 : 1) * (L / 2 - 22);
    const y = 26 + (1 + Math.floor(rnd(92) * (storeys - 1))) * 46 + 4;
    const [x, z] = F.at(t, 5);
    B.box('std', x, y, z, 18, 12, 10, '#d8d6cc', [0, F.ry, 0], METAL);
    const [gx, gz] = F.at(t, 10.2);
    B.add('std', T.cyl(12), [gx, y, gz], [4.6, 0.6, 4.6], [HALF, F.ry, 0], '#3a3c3e', { ...METAL, map: 'cyl' });
    if (lod >= 2) {
      const [sx, sz] = F.at(t, 0.5);
      decal(B, 'streak', sx, y - 26, sz, 10, 40, F.ry);
    }
  }
}

/**
 * A window on a face: an interior-mapped pane, a stone sill and lintel, a frame, shutters (open,
 * half-open or shut), a grille on the ground floor, an arched head or a wooden lattice bay now and then.
 */
function windowUnit(P, F, t, yb, o) {
  const { B, lod } = P;
  const r = o.r;
  const ww = o.ground ? 20 : 22 + Math.round(hash01(o.seed) * 6);
  const wh = o.ground ? 26 : 30;
  const yc = yb + wh / 2;
  const arched = !o.ground && hash01(o.seed + 3) < 0.3;
  const ry = F.ry;
  // the bay: a projecting lattice box on an upper floor (mashrabiya)
  if (!o.ground && lod >= 2 && hash01(o.seed + 11) < 0.12) {
    const [x, z] = F.at(t, 7);
    B.block('std', x, yb - 6, z, ww + 12, wh + 14, 14, '#5a3a1e', [0, ry, 0], WOOD);
    const [px, pz] = F.at(t, 14.2);
    pic(B, 'lattice', px, yc + 1, pz, ww + 8, wh + 8, ry, { color: '#c8a070' });
    const [hx, hz] = F.at(t, 8);
    B.block('std', hx, yb + wh + 8, hz, ww + 16, 3, 18, '#4a3018', [0, ry, 0], WOOD);
    return;
  }
  // the pane: a dim room behind the glass (a derelict one now and then)
  const [px, pz] = F.at(t, 0.25);
  const rid = roomId(hash01(o.seed + 5) < 0.3 ? 4 : 0, o.seed);
  B.add('glass', T.plane(), [px, yc, pz], [ww, wh, 1], [0, ry, 0], '#151b22', { pane: { id: rid, w: ww, h: wh } });
  if (arched) archHead(B, 'std', px, yb + wh, pz - F.n[1] * 0, ww / 2, 0.6, '#1a1e24', ry, S(0, 0.2, 0));
  // reveal: a dark frame around the pane, sill and lintel stones
  const frame = '#3a2a1c';
  if (lod >= 1) {
    for (const s of [-1, 1]) {
      const [fx, fz] = F.at(t + s * (ww / 2 + 1), 1);
      B.box('std', fx, yc, fz, 2, wh + 2, 2, frame, [0, ry, 0], WOOD);
    }
  }
  const [sx, sz] = F.at(t, 2.4);
  B.box('std', sx, yb - 1.5, sz, ww + 8, 3, 5, '#cbb894', [0, ry, 0], STONE);
  if (!arched) {
    const [lx, lz] = F.at(t, 1.2);
    B.box('std', lx, yb + wh + 2, lz, ww + 6, 4, 2.6, '#bba67e', [0, ry, 0], STONE);
  }
  // shutters
  const color = o.shut;
  if (r < 0.42 || lod === 0) {
    // open flat against the wall
    for (const s of [-1, 1]) {
      const [kx, kz] = F.at(t + s * (ww * 0.75 + 1.5), 1.1);
      B.box('std', kx, yc, kz, ww / 2, wh + (arched ? ww / 2 : 0), 1.4, color, [0, ry, 0], WOOD);
      if (lod >= 2) for (let k = 0; k < 4; k++) {
        const [lx2, lz2] = F.at(t + s * (ww * 0.75 + 1.5), 2);
        B.box('std', lx2, yb + 4 + k * (wh / 4), lz2, ww / 2 - 2, 0.8, 0.6, shadeHex(color, -0.25), [0, ry, 0], WOOD);
      }
    }
  } else if (r < 0.62) {
    // shut (a window boarded by its own shutters)
    const [kx, kz] = F.at(t, 1.2);
    B.box('std', kx, yc, kz, ww + 1, wh, 1.6, color, [0, ry, 0], WOOD);
    const [mx, mz] = F.at(t, 2.1);
    B.box('std', mx, yc, mz, 0.8, wh, 0.4, shadeHex(color, -0.35), [0, ry, 0], WOOD);
  } else if (r < 0.8 && lod >= 1) {
    // half open: each leaf swung out on its hinge at the window's side, θ from the wall
    const ax = Math.cos(ry), az = -Math.sin(ry), nx = Math.sin(ry), nz = Math.cos(ry);
    for (const s of [-1, 1]) {
      const th = 0.6 + hash01(o.seed + 7 + s) * 0.7;
      const [hx, hz] = F.at(t + s * ww / 2, 0.8);
      // from the hinge: back over the window when shut (−s along), out of the wall as it opens
      const ux = -s * ax * Math.cos(th) + nx * Math.sin(th), uz = -s * az * Math.cos(th) + nz * Math.sin(th);
      B.box('std', hx + ux * ww / 4, yc, hz + uz * ww / 4, ww / 2, wh, 1.4, color, [0, -Math.atan2(uz, ux), 0], WOOD);
    }
  }
  // a grille over the ground floor's windows
  if (o.ground && lod >= 1) {
    const [gx, gz] = F.at(t, 1.8);
    pic(B, 'grille', gx, yc, gz, ww + 2, wh + 2, ry);
  }
  // flower pots on a sill, laundry from an upper window
  if (lod >= 2 && !o.ground && hash01(o.seed + 13) < 0.16) {
    for (let k = 0; k < 3; k++) {
      const [qx, qz] = F.at(t - ww / 2 + 4 + k * (ww / 2 - 2), 4);
      B.cyl('std', qx, yb, qz, 2.6, 4.4, '#a8522e', 8, 1.25, null, S(DET.stucco, 0.8, 0));
      B.add('std', T.ico(1), [qx, yb + 6.4, qz], [3.6, 3, 3.6], null, k === 1 ? '#b8323e' : '#4a6a2a', { surf: [DET.fabric, 0.9, 0], wobble: { amp: 0.25, seed: o.seed + k } });
    }
  }
}

/** A studded door under an arch, a step, a lamp-less frame of stone. */
function door(P, F, t, color, r) {
  const { B, lod } = P;
  const dw = 30 + Math.round(r * 10), dh = 58;
  const ry = F.ry;
  const [x, z] = F.at(t, 0.3);
  // the stone surround (an arch on most doors) and the recess
  const surround = shadeHex('#cbb48c', r * 0.2 - 0.1);
  const arched = r < 0.7;
  const [sx, sz] = F.at(t, 1.6);
  for (const s of [-1, 1]) {
    const [jx, jz] = F.at(t + s * (dw / 2 + 3), 1.6);
    B.box('std', jx, dh / 2, jz, 6, dh, 3.2, surround, [0, ry, 0], STONE);
  }
  if (arched) {
    archWall(B, 'std', sx, dh, sz, dw / 2, dw / 2 + 4, 3.2, surround, ry, STONE);
    archHead(B, 'std', x, dh, z, dw / 2, 1, color, ry, WOOD);
  } else {
    B.box('std', sx, dh + 3, sz, dw + 12, 6, 3.2, surround, [0, ry, 0], STONE);
  }
  // the leaf: planks, iron bands, studs, a ring
  B.add('std', T.plane(), [x, dh / 2, z], [dw, dh, 1], [0, ry, 0], color, { ...WOOD, noJitter: true });
  if (lod >= 1) {
    for (const y of [12, dh - 12]) {
      const [bx, bz] = F.at(t, 0.8);
      B.box('std', bx, y, bz, dw - 2, 2, 0.8, '#2a2a2a', [0, ry, 0], IRON);
    }
    const [rx, rz] = F.at(t + dw * 0.22, 1.2);
    B.add('std', T.torus(10, 0.22, 5), [rx, dh * 0.5, rz], [2.4, 2.4, 2.4], [0, ry, 0], '#2a2622', IRON);
  }
  if (lod >= 2) {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 6; j++) {
      const [qx, qz] = F.at(t - dw / 2 + 5 + i * ((dw - 10) / 3), 0.9);
      B.add('std', T.sphere(4, 3), [qx, 8 + j * ((dh - 16) / 5), qz], [0.8, 0.8, 0.5], null, '#1e1c1a', IRON);
    }
  }
  // the step
  const [tx, tz] = F.at(t, 5);
  B.block('std', tx, 0, tz, dw + 10, 3, 10, '#b8a682', [0, ry, 0], STONE);
}

/** A shop front: a roller shutter (down, up or half), a painted board, a striped awning. */
function shopFront(P, F, t, sw, r) {
  const { B, lod } = P;
  const ry = F.ry;
  const sh = 60;
  const [x, z] = F.at(t, 0.3);
  // the opening's frame
  for (const s of [-1, 1]) {
    const [jx, jz] = F.at(t + s * (sw / 2 + 2), 1.2);
    B.box('std', jx, sh / 2, jz, 4, sh, 2.4, '#7a6a52', [0, ry, 0], STONE);
  }
  const up = r < 0.3 ? 1 : r < 0.55 ? 0.45 : 0;
  // behind a raised shutter: the dark shop
  if (up > 0) B.add('glass', T.plane(), [x, sh / 2, z - 0.1], [sw, sh, 1], [0, ry, 0], '#14181c', { pane: { id: roomId(1, Math.round(r * 9999)), w: sw, h: sh } });
  const down = sh * (1 - up);
  if (down > 1) {
    const [qx, qz] = F.at(t, 0.8);
    B.add('std', T.plane(), [qx, sh - down / 2, qz], [sw, down, 1], [0, ry, 0], mixHex('#8a8c88', '#9a6a3a', r), { ...S(DET.corrugated, 0.55, 0.5), noJitter: true });
  }
  const [bx, bz] = F.at(t, 1.6);
  B.box('std', bx, sh + 2, bz, sw + 6, 6, 3, '#6a5a44', [0, ry, 0], METAL);
  // the board and the awning
  const [px, pz] = F.at(t, 1.9);
  pic(B, SHOP_SIGNS[Math.floor(r * 997) % SHOP_SIGNS.length], px, sh + 16, pz, Math.min(sw, 90), 22, ry);
  if (lod >= 1) {
    const cell = AWNINGS[Math.floor(r * 31) % AWNINGS.length];
    const depth = 26;
    const [ax, az] = F.at(t, depth / 2);
    // a sloped canvas from the wall down and out
    B.add('sscloth', T.plane(), [ax, sh + 3, az], [sw + 10, Math.hypot(depth, 10), 1], [-HALF + 0.36, ry, 0], '#ffffff', { uv: ssUV(cell), noAO: true, noJitter: true });
    const [vx, vz] = F.at(t, depth);
    B.add('sscloth', T.plane(), [vx, sh - 6, vz], [sw + 10, 8, 1], [0, ry, 0], '#ffffff', { uv: ssUV(cell), noAO: true, noJitter: true });
  }
}

/** Roof clutter: water tanks, a dish, a stair hut, laundry, an aerial; a small dome now and then. */
function roofProps(P, h) {
  const { B, lod } = P;
  if (lod < 1) return;
  const { H, w, d, seed } = h;
  const rnd = (k) => hash01(seed * 17 + k * 29);
  const inner = (u, v) => [(u - 0.5) * (w - 30), (v - 0.5) * (d - 30)];
  if (rnd(1) < 0.55 && w > 70 && d > 70) {
    const [x, z] = inner(rnd(2), rnd(3));
    const c = ['#e8e6e0', '#2a2a2c', '#3a6a9a'][Math.floor(rnd(4) * 3)];
    for (const [dx, dz] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) B.box('std', x + dx, H + 7, z + dz, 1.4, 14, 1.4, '#5a5a5a', null, IRON);
    B.cyl('std', x, H + 14, z, 12, 22, c, 14, 1, null, S(DET.plastic, 0.5, 0.1));
    B.cyl('std', x, H + 36, z, 4, 2, shadeHex(c, -0.2), 10, 1, null, S(DET.plastic, 0.5, 0.1));
  }
  if (rnd(5) < 0.4) {
    const [x, z] = inner(rnd(6), rnd(7));
    rod(B, 'std', [x, H, z], [x, H + 18, z], 0.8, '#6a6a6a', IRON, 5);
    B.add('std', T.sphere(10, 4), [x, H + 20, z], [9, 9, 3], [0.6, rnd(8) * 6, 0], '#e8e8e2', { ...METAL, noJitter: true });
  }
  if (rnd(9) < 0.3 && w > 110 && d > 110) {
    // the stair hut onto the roof
    const [x, z] = inner(rnd(10) * 0.6 + 0.2, rnd(11) * 0.6 + 0.2);
    B.rblock('std', x, H, z, 34, 32, 30, 2, h.col, null, PLASTER);
    B.block('std', x, H + 32, z, 36, 2, 32, shadeHex(h.col, -0.1), null, STONE);
    B.add('std', T.plane(), [x, H + 13, z + 15.2], [14, 26, 1], null, BLUES[Math.floor(rnd(12) * BLUES.length)], WOOD);
  }
  if (lod >= 2 && rnd(13) < 0.35 && w > 90) {
    // a laundry line between two posts
    const [x0, z0] = inner(0.15, rnd(14));
    const [x1, z1] = inner(0.85, rnd(14));
    rod(B, 'std', [x0, H, z0], [x0, H + 26, z0], 0.7, '#5a4a3a', WOOD, 5);
    rod(B, 'std', [x1, H, z1], [x1, H + 26, z1], 0.7, '#5a4a3a', WOOD, 5);
    const len = Math.hypot(x1 - x0, z1 - z0);
    B.add('sscloth', T.plane(), [(x0 + x1) / 2, H + 18, (z0 + z1) / 2], [len, 15, 1], [0, -Math.atan2(z1 - z0, x1 - x0), 0], '#ffffff', { uv: ssUV('laundry'), noAO: true, noJitter: true });
  }
  if (rnd(15) < 0.08 && w > 120 && d > 120) {
    // a small whitewashed dome on a drum
    B.cyl('std', 0, H, 0, 22, 10, h.col, 16, 1, null, PLASTER);
    B.add('std', T.sphere(16, 8), [0, H + 10, 0], [22, 20, 22], null, '#ece6d8', { ...PLASTER, noJitter: true });
    B.cyl('std', 0, H + 29, 0, 1.4, 10, '#c8a03a', 6, 0.6, null, METAL);
  }
  if (rnd(16) < 0.25) {
    // a TV aerial
    const [x, z] = inner(rnd(17), rnd(18));
    rod(B, 'std', [x, H, z], [x, H + 40, z], 0.6, '#8a8a8a', METAL, 4);
    for (let k = 0; k < 4; k++) rod(B, 'std', [x - 10 + k, H + 30 + k * 3, z], [x + 10 - k, H + 30 + k * 3, z], 0.35, '#8a8a8a', METAL, 4);
  }
}

// ---- walls and doors -----------------------------------------------------------------------------------

/** A thick sandstone wall (the court's east wall): ashlar courses, a cap, fallen plaster. */
export function courtWall(P, H0 = 130) {
  const { B, o, lod } = P;
  const H = o.top || H0;
  const col = o.color || '#cbb089';
  const y0 = lowGround(P, o);
  B.block('std', 0, y0, 0, o.w, H - y0, o.h, col, null, STONE);
  B.block('std', 0, H, 0, o.w + 3, 4, o.h + 3, shadeHex(col, -0.15), null, STONE);
  if (lod >= 1) B.block('std', 0, H - 6, 0, o.w + 2, 3, o.h + 2, shadeHex(col, -0.06), null, STONE);
  B.block('std', 0, y0, 0, o.w + 1.4, 12, o.h + 1.4, shadeHex(col, -0.22), null, STUCCO);
  if (lod >= 1) {
    // ashlar courses: shallow grooves every 20 units on both long faces
    const long = o.w >= o.h ? 'x' : 'z';
    for (let y = y0 + 20; y < H; y += 20) {
      if (long === 'x') for (const s of [-1, 1]) B.box('std', 0, y, s * (o.h / 2 + 0.15), o.w, 0.8, 0.3, shadeHex(col, -0.3), null, STONE);
      else for (const s of [-1, 1]) B.box('std', s * (o.w / 2 + 0.15), y, 0, 0.3, 0.8, o.h, shadeHex(col, -0.3), null, STONE);
    }
  }
}

/** A gatehouse wall beside the big doors: tall masonry with a battered base and crenellations. */
export function gatehouse(P) {
  const { B, o, lod } = P;
  const H = o.top || 175;
  const col = '#c9ad84';
  const y0 = lowGround(P, o);
  B.block('std', 0, y0, 0, o.w, H - y0, o.h, col, null, STONE);
  B.block('std', 0, y0, 0, o.w + 6, 26 - y0, o.h + 6, shadeHex(col, -0.12), null, STONE);
  if (lod >= 1) B.block('std', 0, H - 8, 0, o.w + 5, 5, o.h + 5, shadeHex(col, -0.05), null, STONE);
  if (lod >= 1) {
    const n = Math.max(2, Math.round(o.w / 22));
    for (let i = 0; i < n; i += 2) B.block('std', -o.w / 2 + (i + 0.5) * (o.w / n), H, 0, o.w / n, 12, o.h, col, null, STONE);
    for (let y = 30; y < H - 10; y += 24) for (const s of [-1, 1]) B.box('std', 0, y, s * (o.h / 2 + 0.15), o.w, 0.8, 0.3, shadeHex(col, -0.3), null, STONE);
  }
}

/**
 * A great wooden door leaf standing open (the obstacle is the leaf: w its thickness on local x, h its
 * width on local z): planks, iron bands, studs, a ring.
 */
export function bigDoor(P) {
  const { B, o, lod } = P;
  const long = o.h >= o.w;
  const len = long ? o.h : o.w, th = Math.min(o.w, o.h);
  const H = 160;
  const ry = long ? HALF : 0;
  const col = o.color || '#6e4a2c';
  B.add('std', T.box(), [0, H / 2, 0], [len, H, th * 0.8], [0, ry, 0], col, { ...WOOD, noJitter: true });
  if (lod >= 1) {
    // vertical planks: grooves
    for (let k = 1; k < 6; k++) {
      const t = -len / 2 + (k / 6) * len;
      for (const s of [-1, 1]) {
        const lx = long ? s * (th * 0.4 + 0.1) : t, lz = long ? t : s * (th * 0.4 + 0.1);
        B.box('std', lx, H / 2, lz, long ? 0.3 : 0.6, H, long ? 0.6 : 0.3, shadeHex(col, -0.3), null, WOOD);
      }
    }
    for (const y of [20, 80, 140]) B.add('std', T.box(), [0, y, 0], [len + 0.4, 4, th * 0.8 + 1.2], [0, ry, 0], '#262422', IRON);
  }
  if (lod >= 1) {
    for (let i = 0; i < 5; i++) for (const y of [20, 80, 140]) for (const s of [-1, 1]) {
      const t = -len / 2 + 6 + i * ((len - 12) / 4);
      const lx = long ? s * (th * 0.4 + 0.8) : t, lz = long ? t : s * (th * 0.4 + 0.8);
      B.add('std', T.sphere(5, 3), [lx, y, lz], [1.3, 1.3, 1.3], null, '#1c1a18', IRON);
    }
  }
}

/**
 * The side wall of a flight of stairs over a lower street (the catwalk stairs over mid, the pit's
 * stairs): a balustrade of masonry stepping up with the treads, from the street to above the steps.
 */
export function stairWall(P) {
  const { B, o, lod } = P;
  const col = o.color || '#cbb089';
  const alongZ = o.h >= o.w;
  const L = alongZ ? o.h : o.w, th = alongZ ? o.w : o.h;
  const g0 = P.gy ? P.gy(o.x, o.y) : 0;
  const n = Math.max(2, Math.round(L / 24));
  for (let i = 0; i < n; i++) {
    const t = -L / 2 + ((i + 0.5) / n) * L;
    let lo = Infinity, hi = -Infinity;
    for (const s of [-1, 1]) {
      const [wx, wy] = toWorld(o, alongZ ? s * (th / 2 + 8) : t, alongZ ? t : s * (th / 2 + 8));
      const g = (P.gy ? P.gy(wx, wy) : 0) - g0;
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
    }
    const top = hi + 30;
    const seg = L / n + 0.3;
    if (alongZ) B.block('std', 0, lo, t, th, top - lo, seg, col, null, STONE);
    else B.block('std', t, lo, 0, seg, top - lo, th, col, null, STONE);
    if (lod >= 1) {
      // the coping stones, a shade darker
      if (alongZ) B.block('std', 0, top, t, th + 3, 3, seg, shadeHex(col, -0.12), null, STONE);
      else B.block('std', t, top, 0, seg, 3, th + 3, shadeHex(col, -0.12), null, STONE);
    }
  }
}

/** A painted door leaf standing open (the court's doorway: blue, 110 tall). */
export function doorLeaf(P) {
  const { B, o, lod } = P;
  const long = o.w >= o.h;
  const len = long ? o.w : o.h, th = Math.min(o.w, o.h);
  const H = 116;
  const ry = long ? 0 : HALF;
  const col = o.color || '#2f6f9a';
  B.add('std', T.box(), [0, H / 2, 0], [len, H, th * 0.6], [0, ry, 0], col, { ...WOOD, noJitter: true });
  if (lod >= 1) {
    // raised panels
    for (const y of [28, 78]) for (const s of [-1, 1]) {
      const lz = s * (th * 0.3 + 0.5);
      B.add('std', T.box(), [long ? 0 : lz, y, long ? lz : 0], [len - 12, 34, 1], [0, ry, 0], shadeHex(col, 0.1), { ...WOOD, noJitter: true });
    }
  }
}
