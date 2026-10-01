// Fort Harlan's buildings on Main Street and at the gate: the guardhouse, Barracks B (a two-storey block:
// the ground floor is the corridor and rooms the layout walls, the upper floor is windows onto rooms that
// are only pictures), the armory and the dining facility (a big Quonset hut). The layout's wall pieces are
// drawn one by one (windows placed on a grid in world coordinates, so they line up across pieces); the
// roofs (map.roofs by style) draw the ceilings, the roofs above them, the door heads and the floors.

import { BASE } from '../../shared/levels/airbase.js';
import {
  T, DET, S, CONC, STEEL, PAINTED, PLASTER, WOOD, at, pic, flatPic, rod, lampGlow, tubeLamp, shadeHex, hash01,
} from './dam-kit.js';

const HALF = Math.PI / 2;
const BRICK = S(DET.brick, 0.9, 0);
const STUCCO = S(DET.stucco, 0.9, 0);
const LINO = S(DET.linoleum, 0.55, 0);
const TILE = S(DET.tile, 0.5, 0);

/** Looks of the buildings: height, outside and inside colours, the window grid. */
export const LOOK = {
  guard: { H: 124, out: '#a89c84', band: '#6a5a44', inLo: '#4a5a4a', inHi: '#d8d2c0', win: { step: 70, w: 50, y0: 50, y1: 104, glass: 'vglass' }, surf: STUCCO },
  barracks: { H: 150, out: '#8a6450', band: '#b8ac94', inLo: '#5a6a5a', inHi: '#dcd6c4', win: { step: 100, w: 56, y0: 52, y1: 118, glass: 'vglass' }, surf: BRICK, upper: 140 },
  armory: { H: 150, out: '#9a968a', band: '#6a6e62', inLo: '#4a5048', inHi: '#c8c4b4', win: { step: 130, w: 40, y0: 96, y1: 124, glass: 'bars' }, surf: CONC },
  tower: { H: 250, out: '#b2ada2', band: '#8a867a', inLo: '#4a5a5a', inHi: '#d6d2c6', win: { step: 90, w: 54, y0: 150, y1: 226, glass: 'vglass' }, surf: CONC },
};
const STYLE_LOOK = { guardwall: 'guard', bwall: 'barracks', armwall: 'armory', twall: 'tower' };

/** The building rect of a styled exterior wall piece. */
function boxOf(style, o) {
  if (style === 'guardwall') return BASE.guard;
  if (style === 'bwall') return BASE.barracks;
  if (style === 'armwall') return BASE.armory;
  if (style === 'twall') return BASE.tower;
  void o;
  return null;
}

/**
 * Frame a wall piece at ground level (absolute 0: the tower's walls stand beside its raised floor) with
 * local x along it. Returns its length, thickness, the side its outside faces (local z sign) and the world
 * coordinate of its local x = 0 along the wall's axis.
 */
function frameWall(P, o, box) {
  const along = o.w >= o.h;
  const L = along ? o.w : o.h, t = along ? o.h : o.w;
  at(P.B, P.gy, o.x, o.y, 0, along ? 0 : HALF, o.id * 31);
  if (!box) return { L, t, sz: 1, c: along ? o.x : o.y, along };
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  // (a = PI/2: local x runs along sim +y, local z along sim -x)
  return { L, t, sz: along ? (o.y < cy ? -1 : 1) : (o.x < cx ? 1 : -1), c: along ? o.x : o.y, along, lo: along ? box.x0 : box.y0, hi: along ? box.x1 : box.y1 };
}

/** Window centres (local x) on the building's grid that fit inside the piece with a margin. */
function windowsOf(f, w, step, margin = 30) {
  const out = [];
  const a0 = f.c - f.L / 2 + margin + w / 2, a1 = f.c + f.L / 2 - margin - w / 2;
  for (let p = f.lo + step / 2; p < f.hi; p += step) if (p >= a0 && p <= a1) out.push(p - f.c);
  return out;
}

/**
 * A wall pierced by windows: the solid parts as blocks in the outside colour, a two-tone skin on the inside
 * face, and for each opening a frame, the glazing (see-through, barred or boarded) and a sill.
 */
function pierced(B, f, H, xs, win, look, o = {}) {
  const { L, t, sz } = f;
  const hw = win.w / 2;
  const edges = [-L / 2];
  for (const x of xs) edges.push(x - hw, x + hw);
  edges.push(L / 2);
  const surf = { ...look.surf, noJitter: true };
  const inZ = -sz * (t / 2 + 0.5), dado = 52;
  const skin = (x0, x1, y0, y1) => {
    if (x1 - x0 < 0.5 || y1 - y0 < 0.5) return;
    const lo = Math.min(y1, dado);
    if (lo > y0) B.box('std', (x0 + x1) / 2, (y0 + lo) / 2, inZ, x1 - x0, lo - y0, 1, look.inLo, null, { ...PAINTED, noJitter: true });
    const hi0 = Math.max(y0, dado);
    if (y1 > hi0) B.box('std', (x0 + x1) / 2, (hi0 + y1) / 2, inZ, x1 - x0, y1 - hi0, 0.8, look.inHi, null, { ...PLASTER, noJitter: true });
  };
  const solid = (x0, x1, y0, y1) => {
    if (x1 - x0 < 0.5 || y1 - y0 < 0.5) return;
    B.block('std', (x0 + x1) / 2, y0, 0, x1 - x0, y1 - y0, t, look.out, null, surf);
    if (o.inside !== false) skin(x0, x1, y0, Math.min(y1, o.inH || H));
  };
  for (let k = 0; k < edges.length; k += 2) solid(edges[k], edges[k + 1], 0, H);
  for (const x of xs) {
    solid(x - hw, x + hw, 0, win.y0);
    solid(x - hw, x + hw, win.y1, H);
    const wy = (win.y0 + win.y1) / 2, wh = win.y1 - win.y0;
    // frame, a transom, the glazing and a projecting sill outside
    for (const s of [-1, 1]) B.box('std', x + s * (hw - 1.5), wy, 0, 3, wh, t - 2, '#3a3c3a', null, STEEL);
    B.box('std', x, win.y1 - 1.5, 0, win.w, 3, t - 2, '#3a3c3a', null, STEEL);
    B.box('std', x, win.y0 + 1, 0, win.w, 2, t - 2, '#3a3c3a', null, STEEL);
    B.box('std', x, win.y0 - 2, sz * (t / 2 + 2), win.w + 8, 4, 6, look.band, null, CONC);
    const h = hash01(Math.round((f.c + x) * 7 + f.sz * 3 + (f.along ? 1 : 5)));
    if (win.glass === 'bars') {
      B.box('vglass', x, wy, 0, win.w - 4, wh - 4, 0.6, '#1e282c');
      for (let bx = -hw + 6; bx < hw - 2; bx += 7) B.cyl('std', x + bx, win.y0 + 2, sz * (t / 2 - 2), 0.9, wh - 4, '#2a2c2e', 5, 1, null, STEEL);
    } else if (h < 0.14 && !o.intact) {
      // boarded over from inside, a plank off
      B.box('std', x, wy, -sz * (t / 2 - 2), win.w - 6, wh - 6, 1.6, '#7a6244', [0, 0, 0.02], WOOD);
      B.box('std', x, wy + 8, sz * 0.5, win.w + 4, 6, 1.2, '#6a5238', [0, 0, 0.18], WOOD);
    } else if (h < 0.3 && !o.intact) {
      // shot out: shards left in the frame
      B.add('vglass', T.plane(), [x - hw * 0.4, win.y0 + wh * 0.25, 0], [win.w * 0.3, wh * 0.4, 1], [0, 0, 0.6], '#22323a');
      B.add('vglass', T.plane(), [x + hw * 0.5, win.y1 - wh * 0.2, 0], [win.w * 0.3, wh * 0.3, 1], [0, 0, -0.5], '#22323a');
    } else {
      B.box('vglass', x, wy, 0, win.w - 4, wh - 4, 0.6, '#22323a');
      B.box('std', x, wy, 0, 1.6, wh - 4, 1.4, '#3a3c3a', null, STEEL);
    }
  }
}

/** A door head over a doorway (world rect of the gap on a wall line): the wall above it and a casing. */
export function doorHead(P, axis, at0, a0, a1, t, H, look, dh = 104, o = {}) {
  const { B, gy } = P;
  const mid = (a0 + a1) / 2, w = a1 - a0;
  if (axis === 'x') at(B, gy, mid, at0, 0, 0, 7001 + Math.round(mid));
  else at(B, gy, at0, mid, 0, HALF, 7001 + Math.round(mid));
  B.block('std', 0, dh, 0, w + 2, H - dh, t, look.out, null, { ...look.surf, noJitter: true });
  for (const s of [-1, 1]) {
    B.box('std', 0, dh + 3, s * (t / 2 + 0.8), w + 10, 6, 1.6, o.trim || '#3a3c3a', null, PAINTED);
    for (const e of [-1, 1]) B.box('std', e * (w / 2 + 2.5), dh / 2, s * (t / 2 + 0.8), 5, dh, 1.6, o.trim || '#3a3c3a', null, PAINTED);
    if (o.inside) B.box('std', 0, (dh + Math.min(H, o.inH || H)) / 2, s * (t / 2 + 0.5), w, Math.min(H, o.inH || H) - dh, 0.8, s === o.inside ? look.inHi : look.out, null, PLASTER);
  }
}

/** An exterior wall piece of one of the buildings (styles guardwall, bwall, armwall, twall). */
export function buildingWall(P, o) {
  const look = LOOK[STYLE_LOOK[o.style]];
  if (!look) return false;
  const f = frameWall(P, o, boxOf(o.style, o));
  const { B } = P;
  let xs = windowsOf(f, look.win.w, look.win.step);
  // (the tower's radio room windows are its upper storey: the lobby side of the west wall has none)
  pierced(B, f, look.H, xs, look.win, look, { inH: o.style === 'twall' ? 250 : o.style === 'bwall' ? 140 : look.H - 6 });
  // a plinth outside, and for the two-storey barracks the upper floor's windows onto picture rooms
  B.block('std', 0, 0, f.sz * (f.t / 2 + 1.5), f.L, 14, 3, shadeHex(look.out, -0.25), null, CONC);
  if (o.style === 'bwall') {
    const H2 = 290;
    B.block('std', 0, look.H, 0, f.L, H2 - look.H, f.t, look.out, null, { ...BRICK, noJitter: true });
    B.box('std', 0, look.H + 4, f.sz * (f.t / 2 + 2), f.L, 8, 4, look.band, null, CONC);
    xs = windowsOf(f, look.win.w, look.win.step, 20);
    for (const x of xs) {
      const id = Math.floor(hash01(Math.round(f.c + x) * 3 + f.sz) * 255);
      B.add('glass', T.plane(), [x, 222, f.sz * (f.t / 2 + 0.4)], [look.win.w, 64, 1], [0, f.sz > 0 ? 0 : Math.PI, 0], '#2a3238', { pane: { id: 3 * 256 + id, w: look.win.w, h: 64 } });
      B.box('std', x, 188, f.sz * (f.t / 2 + 2), look.win.w + 8, 4, 6, look.band, null, CONC);
      B.box('std', x, 222, f.sz * (f.t / 2 + 0.9), 2, 64, 1.4, '#3a3c3a', null, STEEL);
    }
  }
  return true;
}

/** An interior partition (styles bpart, tinner, trail): painted both sides, a skirting. */
export function partitionWall(P, o) {
  const { B, gy } = P;
  const along = o.w >= o.h, L = along ? o.w : o.h, t = along ? o.h : o.w;
  at(B, gy, o.x, o.y, 0, along ? 0 : HALF, o.id * 31);
  if (o.style === 'trail') {
    // the stair's balustrade: a steel rail on posts over a low wall rising with the flight
    const st = BASE.tower.stair;
    const run = (st.x1 - st.x0), f = BASE.tower.floor;
    const hAt = (lx) => Math.max(0, Math.min(f, ((o.x + lx - st.x0) / run) * f));
    for (let k = 0; k < 12; k++) {
      const x0 = -L / 2 + (L * k) / 12, x1 = -L / 2 + (L * (k + 1)) / 12;
      const h = hAt((x0 + x1) / 2);
      B.block('std', (x0 + x1) / 2, 0, 0, x1 - x0 + 0.2, h + 26, t - 2, '#d6d2c6', null, PLASTER);
    }
    rod(B, 'std', [-L / 2, hAt(-L / 2) + 40, 0], [L / 2, hAt(L / 2) + 40, 0], 1.4, '#3a4a5a', PAINTED, 6);
    return true;
  }
  const H = o.style === 'tinner' ? 250 : 140;
  const look = o.style === 'tinner' ? LOOK.tower : LOOK.barracks;
  B.block('std', 0, 0, 0, L, H, t, look.inHi, null, PLASTER);
  for (const s of [-1, 1]) {
    B.box('std', 0, 26, s * (t / 2 + 0.6), L, 52, 1.2, look.inLo, null, { ...PAINTED, noJitter: true });
    B.box('std', 0, 3, s * (t / 2 + 1.1), L, 6, 1.6, '#2a2e2c', null, { ...PAINTED, noJitter: true });
  }
  // a notice or a stain on some pieces
  const h = hash01(o.id * 13);
  if (L > 120 && h < 0.35) pic(B, h < 0.12 ? 'poster_b' : h < 0.24 ? 'calendar' : 'd_blood2', (h - 0.2) * L, 80, t / 2 + 1.4, h < 0.24 ? 30 : 40, 0);
  return true;
}

// ---- roofs: ceilings, the roofs above them, floors, door heads -----------------------------------------------------

/** A suspended tile ceiling over a room rect (local frame centred on it) at h, some tiles down. */
function tileCeiling(B, w, d, h, seed) {
  const nx = Math.max(1, Math.round(w / 40)), nz = Math.max(1, Math.round(d / 40));
  B.box('std', 0, h + 24, 0, w, 2, d, '#1c1c1c', null, CONC);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const x = -w / 2 + (i + 0.5) * (w / nx), z = -d / 2 + (j + 0.5) * (d / nz);
      const r = hash01(seed + i * 97 + j * 13);
      if (r < 0.05) continue;
      if (r < 0.07) { B.add('std', T.box(), [x, h - 14, z], [w / nx - 1.2, 1.2, d / nz - 1.2], [0.9, 0, 0.3], '#cfcabd', S(DET.ceiltile, 0.95, 0)); continue; }
      B.box('std', x, h + 1, z, w / nx - 1.2, 1.2, d / nz - 1.2, r < 0.2 ? '#c2b8a0' : '#d6d2c6', null, S(DET.ceiltile, 0.95, 0));
    }
  }
  for (let i = 0; i <= nx; i++) B.box('std', -w / 2 + i * (w / nx), h + 0.4, 0, 1, 1, d, '#8a8e92', null, STEEL);
  for (let j = 0; j <= nz; j++) B.box('std', 0, h + 0.4, -d / 2 + j * (d / nz), w, 1, 1, '#8a8e92', null, STEEL);
}

/** A flat roof over a rect: slab, parapet with coping, a few roof units; (x, z) local, frame on the rect. */
function flatRoof(B, w, d, h, col, o = {}) {
  B.block('std', 0, h, 0, w + 4, 10, d + 4, '#6a665e', null, CONC);
  for (const s of [-1, 1]) {
    B.block('std', 0, h + 10, s * (d / 2 + 1), w + 6, o.parapet ?? 16, 6, col, null, o.surf || CONC);
    B.block('std', s * (w / 2 + 1), h + 10, 0, 6, o.parapet ?? 16, d, col, null, o.surf || CONC);
    B.box('std', 0, h + 11 + (o.parapet ?? 16), s * (d / 2 + 1), w + 8, 3, 9, '#8a867a', null, CONC);
  }
  for (const [x, z, sx, sz] of o.units || []) {
    B.rblock('std', x, h + 10, z, sx, 30, sz, 2, '#8e9294', null, STEEL);
    for (let v = 0; v < 5; v++) B.box('std', x - sx / 2 + (v + 0.5) * (sx / 5), h + 32, z, sx / 6, 1.2, sz - 6, '#4a4e52', null, STEEL);
    B.cylX('std', x, h + 26, z + sz / 2 + 0.2, 10, 0.8, '#2a2c2e', 12, STEEL);
  }
}

/** Floor finish over a rect (frame centred): a lino field with a border. */
function floorFinish(B, w, d, col = '#6a6e62') {
  B.box('std', 0, 0.5, 0, w, 1, d, col, null, { ...LINO, noJitter: true });
  B.box('std', 0, 0.3, 0, w + 6, 0.6, d + 6, shadeHex(col, -0.3), null, { ...LINO, noJitter: true });
}

/** The guardhouse (roof style 'guardroom'): ceiling, a roof with a deep overhang, the door, a light. */
export function guardhouse(P, r) {
  const { B, gy, halos } = P;
  const G = BASE.guard, look = LOOK.guard;
  const w = G.x1 - G.x0, d = G.y1 - G.y0;
  at(B, gy, r.x, r.y, 0, 0, 7101);
  floorFinish(B, w - 12, d - 12, '#5a5e56');
  B.box('std', 0, 121, 0, w - 12, 2, d - 12, '#cfcabd', null, S(DET.ceiltile, 0.95, 0));
  tubeLamp(B, halos, 0, 116, 0, 50, r.x, r.y, { y0: 0, flicker: 0.25, k: 2.6 });
  // the roof: a slab with a deep overhang, fascia with the unit's colours
  B.block('std', 0, look.H, 0, w + 60, 10, d + 60, '#4a4e44', null, CONC);
  B.box('std', 0, look.H + 5, 0, w + 62, 8, d + 62, '#3a4028', null, PAINTED);
  pic(B, 'restricted', 0, 70, d / 2 + 8, 30, 0, { w: 60 });
  // door head and an open steel door swung out, the gate's controls on the wall by it
  doorHead(P, 'x', G.y1, G.door[0], G.door[1], 12, look.H, look, 100);
  at(B, gy, G.door[0] + 4, G.y1 + 6, 0, 0, 7102);
  B.add('std', T.box(), [0, 50, 38], [3, 98, 78], [0, 0.15, 0], '#5a6048', PAINTED);
  // floodlight on the corner over the road
  at(B, gy, G.x1, G.y1, 0, 0, 7103);
  B.rblock('std', 0, look.H + 8, 20, 14, 10, 12, 2, '#2a2c2e', null, STEEL);
  lampGlow(B, halos, 0, look.H + 6, 27, G.x1, G.y1 + 27, '#e8f0ff', { size: [10, 6, 1], k: P.day ? 0.4 : 4, halo: P.day ? 0 : 110, strength: 0.6, y0: 0 });
}

/** Barracks B (roof style 'barracks'): the tile ceilings of the corridor and rooms, the roof, door heads. */
export function barracksRoof(P, r) {
  const { B, gy, halos } = P;
  const K = BASE.barracks, look = LOOK.barracks;
  const w = K.x1 - K.x0, d = K.y1 - K.y0;
  at(B, gy, r.x, r.y, 0, 0, 7201);
  floorFinish(B, w - 16, d - 16, '#6e6a5e');
  tileCeiling(B, w - 16, d - 16, 140, 7201);
  // the roof over the upper floor: slab, parapet, roof units, a flag bracket over the door
  at(B, gy, r.x, r.y, 0, 0, 7202);
  flatRoof(B, w, d, 290, '#8a6450', { surf: BRICK, units: [[-240, -80, 60, 44], [120, 60, 60, 44]] });
  // corridor lamps (one out, one flickering), room lamps
  for (let k = 0; k < 4; k++) {
    const x = K.x0 + 100 + k * 200;
    tubeLamp(B, halos, x - r.x, 136, (K.hall[0] + K.hall[1]) / 2 - r.y, 50, x, (K.hall[0] + K.hall[1]) / 2, { y0: 0, lit: k !== 2, flicker: k === 1 ? 0.5 : 0.1, k: 2.6 });
    tubeLamp(B, halos, x - r.x, 136, K.y0 + 90 - r.y, 50, x, K.y0 + 90, { y0: 0, lit: k !== 3, flicker: k === 1 ? 0.4 : 0, k: 2.4 });
  }
  // door heads: the corridor's ends, the front door with its canopy and the unit's sign, the rooms' doors
  const inside = { inside: 1, inH: 140 };
  doorHead(P, 'y', K.x0, K.hall[0], K.hall[1], 16, look.H, look, 104);
  doorHead(P, 'y', K.x1, K.hall[0], K.hall[1], 16, look.H, look, 104);
  doorHead(P, 'x', K.y1, K.door[0], K.door[1], 16, look.H, look, 104);
  for (const [a0, a1] of [[2760, 2840], [2960, 3040], [3160, 3240], [3360, 3440]]) doorHead(P, 'x', K.hall[0], a0, a1, 10, 140, LOOK.barracks, 100, inside);
  for (const [a0, a1] of [[2800, 2880], [3320, 3400]]) doorHead(P, 'x', K.hall[1], a0, a1, 10, 140, LOOK.barracks, 100, inside);
  at(B, gy, (K.door[0] + K.door[1]) / 2, K.y1, 0, 0, 7203);
  B.block('std', 0, 112, 40, 150, 6, 80, '#5a5e56', null, CONC);
  for (const e of [-1, 1]) B.cyl('std', e * 66, 0, 72, 3, 112, '#d8d2c0', 8, 1, null, PAINTED);
  pic(B, 'barracks', 0, 130, 8.6 + 0.3, 20, 0);
  pic(B, 'usarmy', 0, 250, 8.8, 18, 0);
  lampGlow(B, halos, 0, 110, 40, (K.door[0] + K.door[1]) / 2, K.y1 + 40, '#ffe0b0', { size: [8, 1.5, 8], k: P.day ? 0.5 : 3.2, halo: P.day ? 0 : 70, strength: 0.45, flicker: 0.15, y0: 0 });
  // the wide opening from the corridor into the entry hall: a beam
  at(B, gy, (K.south[0] + K.south[1]) / 2, K.hall[1], 0, 0, 7204);
  B.block('std', 0, 110, 0, K.south[1] - K.south[0], 30, 12, LOOK.barracks.inHi, null, PLASTER);
  // blood trail down the corridor, a mattress dragged out
  at(B, gy, 3000, (K.hall[0] + K.hall[1]) / 2, 0, 0, 7205);
  flatPic(B, 'd_drag', -120, 1.4, 0, 180, 40, 0.1);
  flatPic(B, 'd_blood1', 200, 1.4, 6, 50, 50, 0.8);
  B.add('std', T.box(), [60, 4, 10], [70, 8, 30], [0, 0.4, 0.05], '#6a7a8a', S(DET.fabric, 0.95, 0));
}

/** The armory (roof style 'armory'): a plain ceiling and caged lamps, the vault door, the sign, a slab roof. */
export function armoryRoof(P, r) {
  const { B, gy, halos } = P;
  const M = BASE.armory, look = LOOK.armory;
  const w = M.x1 - M.x0, d = M.y1 - M.y0;
  at(B, gy, r.x, r.y, 0, 0, 7301);
  B.box('std', 0, 0.5, 0, w - 24, 1, d - 24, '#5a5c56', null, { ...CONC, noJitter: true });
  B.box('std', 0, 133, 0, w - 24, 6, d - 24, '#8a867c', null, CONC);
  flatRoof(B, w, d, look.H, '#8a867a', { units: [[100, -60, 50, 40]] });
  for (const [x, z] of [[-100, -90], [100, -90], [0, 60]]) {
    B.box('std', x, 128, z, 30, 3, 10, '#3a3e42', null, STEEL);
    lampGlow(B, halos, x, 125, z, r.x + x, r.y + z, z > 0 ? '#ff5a3a' : '#fff0d8', { size: [24, 1.5, 6], k: P.day ? 1.2 : 3, halo: 60, strength: 0.45, flicker: x > 0 ? 0.3 : 0, y0: 0 });
  }
  // the door: a heavy steel door swung open inward, a keypad, the sign over it, sandbags either side
  doorHead(P, 'x', M.y1, M.door[0], M.door[1], 24, look.H, look, 110);
  at(B, gy, M.door[1] - 4, M.y1 - 12, 0, 0, 7302);
  B.add('std', T.box(), [0, 54, -38], [6, 106, 78], [0, -1.35, 0], '#5a5e58', STEEL);
  at(B, gy, (M.door[0] + M.door[1]) / 2, M.y1, 0, 0, 7303);
  pic(B, 'armory', 0, 128, 12.6, 18, 0);
  B.rblock('std', 52, 60, 12.5, 10, 14, 2, 1, '#2a2c2e', null, STEEL);
  lampGlow(B, null, 52, 64, 13.8, 0, 0, '#ff3020', { size: [2, 2, 0.5], k: 4, halo: 0 });
  for (const e of [-1, 1]) for (let k = 0; k < 3; k++) B.rblock('std', e * (70 + k * 24), k * 11, 30, 26, 12, 18, 5, '#8a7a55', [0, (k - 1) * 0.1, 0], S(DET.fabric, 0.95, 0));
  // inside: spent cases and a blood smear by the cage, a dead radio on the counter
  at(B, gy, 3900, M.cage + 60, 0, 0, 7304);
  flatPic(B, 'd_blood2', 20, 1.2, 10, 60, 60, 0.4);
}

/** The dining facility: a Quonset hut with its axis north-south, the end walls, the vault inside and out. */
export function messHall(P, r) {
  const { B, gy, halos, tier } = P;
  const D = BASE.mess;
  const w = D.x1 - D.x0, d = D.y1 - D.y0;
  const R = w / 2 + 8, K = 0.62, n = tier === 'low' ? 12 : 22;
  const arc = (a, k = 1) => [Math.cos(a) * R * k, Math.sin(a) * R * K * k];
  at(B, gy, r.x, r.y, 0, 0, 7401);
  floorFinish(B, w - 20, d - 20, '#7a6e5e');
  // the vault: corrugated arcs outside, painted boards inside, ribs every bay
  const seg = (a0, a1, k, zc, depth, th, col, surf) => {
    const [x0, y0] = arc(a0, k), [x1, y1] = arc(a1, k);
    B.add('std', T.box(), [(x0 + x1) / 2, (y0 + y1) / 2, zc], [Math.hypot(x1 - x0, y1 - y0) + 1, th, depth], [0, 0, Math.atan2(y1 - y0, x1 - x0)], col, surf);
  };
  for (let k = 0; k < n; k++) {
    const a0 = Math.PI * (k / n), a1 = Math.PI * ((k + 1) / n);
    seg(a0, a1, 1, 0, d + 16, 2.4, '#5a6048', S(DET.corrugated, 0.6, 0.35));
    seg(a0, a1, 0.975, 0, d - 4, 1, '#d6cfbb', PLASTER);
    for (let z = -d / 2 + 60; z < d / 2 - 20; z += 80) seg(a0, a1, 0.955, z, 5, 4, '#8a8272', WOOD);
  }
  // the end walls: timber boarding under the arch; the south one has the doors cut out of it
  const arch = [];
  for (let k = 0; k <= 16; k++) arch.push(arc(Math.PI * (k / 16)));
  const dx0 = D.door[0] - r.x, dx1 = D.door[1] - r.x;
  const south = [...arch, [dx0, 0], [dx0, 112], [dx1, 112], [dx1, 0]];
  B.add('std', T.profile('c3quonsetN' + Math.round(R), arch, 0, 1), [0, 0, -d / 2], [1, 1, 16], null, '#b8ae98', S(DET.siding, 0.85, 0));
  B.add('std', T.profile('c3quonsetS' + Math.round(R), south, 0, 1), [0, 0, d / 2], [1, 1, 16], null, '#b8ae98', S(DET.siding, 0.85, 0));
  // (the north end's inside face: paint)
  B.add('std', T.profile('c3quonsetI' + Math.round(R), arch.map(([x, y]) => [x * 0.97, y * 0.97]), 0, 1), [0, 0, -d / 2 + 8.6], [1, 1, 1], null, '#cfc8b4', PLASTER);
  at(B, gy, (D.door[0] + D.door[1]) / 2, D.y1, 0, 0, 7402);
  // the doors: frames, one leaf hanging open, the canopy and the sign, the end wall's windows
  for (const e of [-1, 1]) B.box('std', e * ((dx1 - dx0) / 2 + 2), 56, 0, 4, 112, 20, '#3a3c3a', null, PAINTED);
  B.box('std', 0, 114, 0, dx1 - dx0 + 8, 4, 20, '#3a3c3a', null, PAINTED);
  B.add('std', T.box(), [(dx0 - dx1) / 2 + 22, 55, 30], [3, 106, 48], [0, 1.2, 0], '#5a6a5a', PAINTED);
  B.block('std', 0, 118, 30, 170, 6, 56, '#4a5040', null, PAINTED);
  pic(B, 'mess', 0, 150, 8.9, 26, 0);
  for (const x of [-210, -120, 120, 210]) {
    B.box('vglass', x, 95, 0, 44, 50, 0.6, '#22323a');
    for (const s of [-1, 1]) B.box('std', x, 95, s * 8.5, 48, 54, 1, '#3a3c3a', null, STEEL);
  }
  lampGlow(B, halos, 0, 116, 40, (D.door[0] + D.door[1]) / 2, D.y1 + 40, '#ffe0b0', { size: [10, 1.5, 6], k: P.day ? 0.4 : 3, halo: P.day ? 0 : 80, strength: 0.5, y0: 0 });
  // inside: pendant lamps down the hall, the menu board over the line, the unit's crest
  at(B, gy, r.x, r.y, 0, 0, 7403);
  for (const x of [-120, 120]) {
    for (const z of [-60, 60, 180]) {
      rod(B, 'std', [x, 172, z], [x, 152, z], 0.4, '#1a1a1a', STEEL, 3);
      B.add('std', T.cyl(10, 0.3, true), [x, 148, z], [12, 8, 12], [Math.PI, 0, 0], '#3a4a3a', STEEL);
      lampGlow(B, halos, x, 145, z, r.x + x, r.y + z, '#ffe8c0', { size: [7, 1, 7], k: P.day ? 1 : 3, halo: 70, strength: 0.4, flicker: x > 0 && z > 100 ? 0.4 : 0, y0: 0 });
    }
  }
  pic(B, 'e_lamps', 0, 150, -d / 2 + 9, 8, 0, { w: 140, bucket: 'c3sign' });
  pic(B, 'insignia', -170, 104, -d / 2 + 9, 50, 0);
  pic(B, 'd_blood1', 150, 60, -d / 2 + 9.2, 40, 0);
}

/** The dining facility's pieces: side walls are the vault; the end walls come with the hut. */
export function messWall() { return true; }
