// The 3D art of the story level "hospital", Saint Mercy (JOURNEY.md §5). Owner: agent C2.
//
// The layout (shared/levels/hospital.js) tags its walls and props; this module gives them their look
// through the interior kit (hospital-kit.js): the room finishes (terrazzo in the waiting room, teal
// vinyl and bumper rails in the ER, sage wards, green-tiled theatres, painted block in the plant room
// and the fire stair), the façades (a two-storey precast podium with a ribbon of windows, the tower with
// its storeys, the lit SAINT MERCY letters), the ceilings and their fixtures, and the models of the
// props (hospital-props.js) and the signs of the atlas (hospital-atlas.js).
//
// The interface (render3d/levels/index.js fills in no-ops):
//   BUCKETS, createLevelArt(ctx, deps) → { obstacle, roof, props, finish, update, setQuality, dispose,
//   material, gateModel, setLights }

import * as THREE from 'three';
import { createInteriorArt, KIT_BUCKETS, T, DET, S, STEEL, CHROME, PAINT, PLAST, CONC, shadeHex, mixHex, hash01 } from './hospital-kit.js';
import { hospitalAtlas } from './hospital-atlas.js';
import { OBSTACLES, ITEMS, lampsOf } from './hospital-props.js';
import { roomId } from '../world-arch.js';
import { building } from '../world-bld.js';
import { FABRIC } from './hospital-kit.js';

/** Extra geo-builder buckets of this level. */
export const BUCKETS = { ...KIT_BUCKETS };

const HALF = Math.PI / 2;

// ---- room finishes ---------------------------------------------------------------------------------
const TROFFER = { kind: 'troffer', step: 160, rowStep: 210, color: '#e8f0ff', stray: 0.1 };
const TUBE = { kind: 'tube', step: 200, rowStep: 260, color: '#e8f0ff', stray: 0.05 };
const ROUND = { kind: 'round', step: 150, rowStep: 180, color: '#ffe8c8', stray: 0.05 };

const WARD_PROPS = ['gel', 'ext', 'poster', 'clock', 'sharps', 'glove', 'bin', 'chair', 'notice', 'blood', 'panel', 'gel', 'bin', 'cart'];
const CORR_PROPS = ['gel', 'ext', 'poster', 'bin', 'chair', 'blood', 'notice', 'evac', 'cart', 'wheelchair', 'phone', 'poster'];
const PLAIN_PROPS = ['ext', 'panel', 'bin', 'blood', 'poster'];
const BLOODY = ['blood_trail', 'blood_pool', 'blood_splat', 'grime', 'blood_trail'];

const ROOMS = {
  'hs-wait': { wallProps: CORR_PROPS, floorDecals: BLOODY, floor: '#a4a197', floorDet: DET.terrazzo, floorRough: 0.28, lower: '#6c8c86', lowerH: 38, lowerDet: DET.wallpaper, upper: '#d9dbd2', rail: '#7a5a3c', railSurf: S(DET.wood, 0.6, 0), railY: 38, railH: 4, skirt: '#2c3230', ceil: '#dcdcd4', ceilKind: 'grid', fixture: TROFFER, blinds: 0.6, grime: 0.55, missing: 0.05 },
  'hs-resus': { wallProps: WARD_PROPS, floorDecals: ['blood_pool', 'blood_splat', 'blood_trail'], decalArea: 60000, floor: '#7c979a', floorDet: DET.linoleum, lower: '#dfe5e4', lowerH: 56, lowerDet: DET.tile, upper: '#c8d5d7', rail: '#aab4b8', skirt: '#48585c', ceil: '#dfe0dc', ceilKind: 'grid', fixture: TROFFER, blinds: 0.9, grime: 0.7, grimeCells: ['blood_hand', 'blood_splat', 'grime'] },
  'hs-pit': { wallProps: WARD_PROPS, floorDecals: BLOODY, decalArea: 90000, floor: '#8da3a5', floorDet: DET.linoleum, lower: '#b5c5c2', lowerH: 32, lowerDet: DET.linoleum, upper: '#dfe3dd', rail: '#4f8790', railH: 5, skirt: '#2f4a50', ceil: '#dcdcd6', ceilKind: 'grid', fixture: TROFFER, grime: 0.6, missing: 0.07, stripe: ['#b3261e', '#2a6ab0'] },
  'hs-pharm': { wallProps: PLAIN_PROPS, floorDecals: ['grime', 'blood_splat'], floor: '#8d8c85', floorDet: DET.linoleum, upper: '#d2d1c8', skirt: '#3a3d3e', ceil: '#d8d8d0', ceilKind: 'grid', fixture: TROFFER, grime: 0.3 },
  'hs-xray': { floor: '#6c7276', floorDet: DET.linoleum, upper: '#c4c9ca', lower: '#8a9296', lowerH: 34, skirt: '#2c3032', ceil: '#d4d6d4', ceilKind: 'plain', fixture: ROUND, grime: 0.3 },
  'hs-staff': { wallProps: ['poster', 'clock', 'notice', 'bin', 'chair'], floorDecals: ['grime'], floor: '#7d6c5a', floorDet: DET.wood, floorRough: 0.5, upper: '#d9cfba', lower: '#a89a82', lowerH: 34, rail: '#6b5038', skirt: '#3a2e22', ceil: '#dad8d0', ceilKind: 'grid', fixture: TROFFER, grime: 0.4 },
  'hs-store': { wallProps: PLAIN_PROPS, floorDecals: ['grime', 'mold'], floor: '#74746d', floorDet: DET.concrete, floorRough: 0.7, upper: '#bdbdb4', lower: '#6d7a70', lowerH: 26, skirt: '#2c2e2c', ceil: '#9a9a94', ceilKind: 'slab', fixture: TUBE, grime: 0.6, grimeCells: ['grime', 'mold', 'grime2'] },
  'hs-bay': { wallProps: WARD_PROPS, floorDecals: BLOODY, decalArea: 90000, floor: '#a3a58e', floorDet: DET.linoleum, lower: '#b7c4a6', lowerH: 34, lowerDet: DET.linoleum, upper: '#e3e5d6', rail: '#88a39f', railH: 4.5, skirt: '#3c4a44', ceil: '#dcdcd4', ceilKind: 'grid', fixture: { ...TROFFER, color: '#fff0dc', step: 180 }, blinds: 0.85, grime: 0.5, grimeCells: ['grime', 'blood_hand', 'grime2'] },
  'hs-recovery': { wallProps: WARD_PROPS, floorDecals: BLOODY, floor: '#9aa8a2', floorDet: DET.linoleum, lower: '#b9c9c2', lowerH: 34, upper: '#e4e7de', rail: '#7ea09a', skirt: '#35463f', ceil: '#dcdcd4', ceilKind: 'grid', fixture: TROFFER, blinds: 0.85, grime: 0.4 },
  'hs-corr': { wallProps: CORR_PROPS, wallStep: 130, floorDecals: BLOODY, decalArea: 70000, floor: '#8e999c', floorDet: DET.linoleum, lower: '#9cafad', lowerH: 30, lowerDet: DET.linoleum, upper: '#dcdfd7', rail: '#5d8a94', railH: 5.5, railY: 30, skirt: '#2f4448', ceil: '#dadad2', ceilKind: 'grid', fixture: { ...TROFFER, step: 150 }, grime: 0.7, grimeCells: ['grime', 'blood_trail', 'blood_hand', 'grime2', 'g_help', 'g_dead'], missing: 0.06, stripe: ['#2a6ab0', '#d2a52a'] },
  'hs-records': { floor: '#7a796f', floorDet: DET.carpet, floorRough: 0.9, upper: '#d0cdc1', skirt: '#3a3730', ceil: '#d6d4cc', ceilKind: 'grid', fixture: TROFFER, grime: 0.3 },
  'hs-station': { wallProps: ['poster', 'clock', 'notice', 'phone'], floor: '#8e999c', floorDet: DET.linoleum, upper: '#e2dfd2', lower: '#8fb0aa', lowerH: 32, rail: '#5d8a94', skirt: '#2f4448', ceil: '#dadad2', ceilKind: 'grid', fixture: TROFFER, grime: 0.4 },
  'hs-meds': { floor: '#8d8c85', floorDet: DET.linoleum, upper: '#d2d1c8', skirt: '#3a3d3e', ceil: '#d8d8d0', ceilKind: 'grid', fixture: TROFFER },
  'hs-sluice': { floorDecals: ['mold', 'grime2', 'blood_pool'], floor: '#707a78', floorDet: DET.tile, floorRough: 0.35, lower: '#cfd8d5', lowerH: 84, lowerDet: DET.tile, upper: '#d6dbd6', skirt: '#4a5250', ceil: '#d4d6d2', ceilKind: 'plain', fixture: TUBE, grime: 0.8, grimeCells: ['mold', 'grime2', 'blood_drip'] },
  'hs-plant': { wallProps: ['panel', 'ext', 'panel'], floorDecals: ['grime2', 'grime'], floor: '#6a6a63', floorDet: DET.concrete, floorRough: 0.75, lower: '#56624f', lowerH: 28, lowerDet: DET.brick, upper: '#9ea196', upperDet: DET.brick, skirt: '#2a2c28', ceil: '#8f8f88', ceilKind: 'slab', fixture: TUBE, grime: 0.8, grimeCells: ['grime', 'mold', 'grime2'] },
  'hs-or': { wallProps: ['panel', 'gel', 'glove', 'sharps'], floorDecals: ['blood_pool', 'blood_splat', 'blood_trail'], decalArea: 70000, floor: '#6e8d84', floorDet: DET.linoleum, floorRough: 0.3, upper: '#a1bdb3', upperDet: DET.tile, upperRough: 0.4, skirt: '#44625a', skirtH: 8, ceil: '#e2e6e4', ceilKind: 'or', fixture: { kind: 'orpanel', step: 200, rowStep: 260, color: '#f0f8ff', stray: 0 }, grime: 0.5, grimeCells: ['blood_splat', 'blood_hand', 'blood_drip'] },
  'hs-corr-or': { wallProps: CORR_PROPS, floorDecals: BLOODY, decalArea: 70000, floor: '#86a098', floorDet: DET.linoleum, lower: '#a9c2b9', lowerH: 32, upper: '#dbe4de', rail: '#6d958b', railH: 5, skirt: '#35524a', ceil: '#dde0dc', ceilKind: 'grid', fixture: { ...TROFFER, step: 150 }, grime: 0.6, grimeCells: ['blood_trail', 'grime', 'blood_hand'], stripe: ['#d8231b'] },
  'hs-scrub': { wallProps: ['gel', 'glove', 'poster'], floor: '#7d918c', floorDet: DET.tile, floorRough: 0.3, lower: '#d6e0dc', lowerH: 90, lowerDet: DET.tile, upper: '#dfe5e1', skirt: '#4d5e59', ceil: '#dcdfdc', ceilKind: 'plain', fixture: TROFFER },
  'hs-lobby-lift': { wallProps: CORR_PROPS, floorDecals: BLOODY, decalArea: 60000, floor: '#7d8a8c', floorDet: DET.linoleum, lower: '#8f9c9a', lowerH: 32, upper: '#cfd3cc', rail: '#5d7a80', skirt: '#2f3c40', ceil: '#cfd0ca', ceilKind: 'grid', fixture: TROFFER, grime: 0.8, missing: 0.12, grimeCells: ['blood_trail', 'g_roof', 'grime', 'blood_hand'] },
  'hs-lift': { floor: '#5c6062', floorDet: DET.panel, floorRough: 0.35, upper: '#8d9498', upperSurf: STEEL, skirt: '#3a3e40', ceil: '#6d7274', ceilKind: 'plain', fixture: ROUND },
  'hs-stair': { noFloor: true, ceilKind: 'none', upper: '#b9b8ae', upperDet: DET.brick, upperRough: 0.85, tall: 600 },
};

// ---- things on the walls (hospital-kit's wall props) ---------------------------------------------------
/** A wall prop at t along a wall face (W.s: which face, W.z its plane, W.ry the turn facing out of it). */
function wallProp(W) {
  const { B, s, t, z, ry, base, kind, seed } = W;
  const out = (d) => z + s * d;
  switch (kind) {
    case 'gel': B.rblock('std', t, base + 48, out(2.2), 6, 10, 4.4, 0.6, '#e8e8e4', [0, ry, 0], PLAST); W.pic(B, 'hs_handgel', t, base + 54, out(4.5), 5, 6.5, ry); break;
    case 'ext': {
      B.rblock('std', t, base + 22, out(3.4), 8, 20, 6, 3, '#c62828', null, PAINT);
      B.box('std', t, base + 43.5, out(3.4), 3, 3, 3, '#1a1a1a', null, STEEL);
      B.box('std', t, base + 80, out(0.8), 16, 16, 0.6, '#c62828', [0, ry, 0], PAINT);
      break;
    }
    case 'poster': W.pic(B, ['hs_poster1', 'hs_poster2', 'hs_poster3'][seed % 3], t, base + 62, out(0.4), 17, 24, ry); break;
    case 'evac': W.pic(B, 'hs_evac', t, base + 60, out(0.4), 22, 17, ry); break;
    case 'clock': W.pic(B, 'hs_clock', t, base + 96, out(0.8), 12, 12, ry); B.cyl('std', t, base + 96, out(0.3), 6.2, 0.8, '#2a2c2e', 14, 1, [Math.PI / 2, 0, 0], PLAST); break;
    case 'notice': B.box('std', t, base + 64, out(0.6), 44, 34, 1.2, '#6b4a2c', [0, ry, 0], S(DET.wood, 0.7, 0)); W.pic(B, 'hs_notice', t, base + 64, out(1.3), 40, 30, ry); break;
    case 'sharps': B.rblock('std', t, base + 42, out(3), 8, 9, 6, 0.8, '#f2c21a', null, PLAST); B.box('std', t, base + 51.4, out(3), 8, 1.4, 6, '#c62828', null, PLAST); break;
    case 'glove': for (let k = 0; k < 3; k++) B.rblock('std', t - 8 + k * 8, base + 58, out(2.2), 7, 4, 4, 0.4, ['#8ab0d8', '#a8d8a8', '#d8a8c8'][k], null, PLAST); break;
    case 'panel': B.rblock('std', t, base + 70, out(2), 16, 20, 4, 0.6, '#b8b6aa', null, S(DET.panel, 0.5, 0.5)); B.box('std', t, base + 95, out(1.4), 3, 30, 2.4, '#8a9096', null, STEEL); break;
    case 'phone': B.rblock('std', t, base + 58, out(2), 8, 14, 4, 0.8, '#d8d4c8', null, PLAST); B.rblock('std', t - 2, base + 56, out(4.4), 2, 10, 2, 0.8, '#2a2c2e', null, PLAST); break;
    case 'blood': W.decal(B, seed % 2 ? 'blood_hand' : 'blood_drip', t, base + 50, out(0.5), 34, 44, ry); break;
    case 'bin': {
      B.cyl('std', t, base, out(10), 8, 22, seed % 3 ? '#8a9094' : '#c62828', 12, 0.95, null, PLAST);
      B.cyl('std', t, base + 22, out(10), 8.4, 1.6, '#5a6066', 12, 1, null, STEEL);
      break;
    }
    case 'chair': {
      const fall = seed % 4 === 0;
      const r = [fall ? Math.PI / 2 : 0, ry + (seed % 5) * 0.2, 0];
      B.rblock('std', t, base + (fall ? 8 : 16), out(14), 16, 2, 15, 0.6, '#3f6f7a', r, PLAST);
      if (!fall) {
        B.rblock('std', t, base + 18, out(5.5), 16, 16, 2, 0.6, '#3f6f7a', [0, ry, 0], PLAST);
        for (const [dx, dz] of [[-6, 8], [6, 8], [-6, 20], [6, 20]]) B.box('std', t + dx, base + 8, out(dz), 1.2, 16, 1.2, '#2a2c2e', null, STEEL);
      }
      break;
    }
    case 'cart': {
      // a linen cart: a steel frame and a canvas bag
      B.rblock('std', t, base + 4, out(18), 40, 34, 24, 2, '#6a8aa8', null, S(DET.fabric, 0.9, 0));
      B.box('std', t, base + 39, out(18), 42, 1.6, 26, '#9aa0a4', null, STEEL);
      for (const [dx, dz] of [[-18, 8], [18, 8], [-18, 28], [18, 28]]) B.cylZ('std', t + dx, base + 2, out(dz), 2, 1.4, '#1c1c1c', 8, S(DET.rubber, 0.9, 0));
      break;
    }
    case 'wheelchair': {
      for (const e of [-1, 1]) { B.cylZ('std', t + e * 9, base + 10, out(16), 10, 1.2, '#2a2c2e', 16, STEEL); }
      B.box('std', t, base + 18, out(16), 18, 2, 16, '#1d2a3a', null, FABRIC);
      B.box('std', t, base + 28, out(8), 18, 18, 1.6, '#1d2a3a', [0, ry, 0], FABRIC);
      break;
    }
    default: break;
  }
}

// ---- façades ------------------------------------------------------------------------------------------
const PRECAST = '#cdc8bd', PRECAST_D = '#a39e93', GRANITE = '#3a3c3d', BAND = '#8e897e';

/** A band of a face (t0..t1, y0..y1) cut round the holes, `out` proud of the wall. */
function band(B, o, s, t0, t1, y0, y1, color, surf, holes = [], out = 0.06) {
  const z = s * (o.h / 2 + out);
  let cur = t0;
  const q = (a, b, ya, yb) => { if (b - a > 0.05 && yb - ya > 0.05) B.quad('std', [(a + b) / 2, (ya + yb) / 2, z], [s * (b - a), 0, 0], [0, yb - ya, 0], color, surf); };
  for (const hl of holes) {
    const h0 = hl.t - hl.w / 2, h1 = hl.t + hl.w / 2;
    if (h1 <= t0 || h0 >= t1 || hl.y1 <= y0 || hl.y0 >= y1) continue;
    const a = Math.max(t0, h0), b = Math.min(t1, h1);
    q(cur, a, y0, y1);
    q(a, b, y0, Math.max(y0, hl.y0));
    q(a, b, Math.min(y1, hl.y1), y1);
    cur = b;
  }
  q(cur, t1, y0, y1);
}

/**
 * A row of recessed windows along t0..t1 between y0 and y1: reveals, a frame, an interior-mapped room
 * behind the glass (some lit at night). `step` apart, `ww` wide.
 */
function windowBand(P, s, t0, t1, y0, y1, step, ww, o2 = {}) {
  const { B, o, day } = P;
  const z = s * o.h / 2;
  const n = Math.max(1, Math.floor((t1 - t0) / step));
  const pad = (t1 - t0 - n * step) / 2;
  const holes = [];
  for (let i = 0; i < n; i++) holes.push({ t: t0 + pad + (i + 0.5) * step, w: ww, y0, y1 });
  band(B, o, s, t0, t1, y0 - 0.01, y1 + 0.01, o2.pier || PRECAST, S(DET.concrete, 0.85, 0), holes);
  const R = o2.depth || 4;
  const rev = shadeHex(o2.pier || PRECAST, -0.3);
  for (const hl of holes) {
    const t = hl.t, yc = (y0 + y1) / 2, h = y1 - y0;
    const seed = Math.round(P.o.x * 3 + P.o.y * 7 + t * 13);
    const hsh = hash01(seed);
    // reveals
    for (const e of [-1, 1]) B.quad('std', [t + e * ww / 2, yc, z - s * R / 2], [0, 0, e * R], [0, h, 0], rev, S(DET.concrete, 0.9, 0));
    B.quad('std', [t, y1, z - s * R / 2], [s * ww, 0, 0], [0, 0, s * R], shadeHex(rev, -0.15), S(DET.concrete, 0.9, 0));
    B.quad('std', [t, y0, z - s * R / 2], [s * ww, 0, 0], [0, 0, -s * R], shadeHex(rev, 0.1), S(DET.concrete, 0.9, 0));
    // the pane: a lit room now and then at night, dark glass otherwise, a boarded one
    const type = o2.roomType ?? 2;
    const lit = !day && hsh < (o2.lit ?? 0.07);
    const zp = z - s * (R - 0.6);
    if (o2.boarded && hsh > 0.8) {
      B.quad('std', [t, yc, z - s * 0.8], [s * ww, 0, 0], [0, h, 0], '#6b5a44', S(DET.wood, 0.85, 0));
    } else if (lit) {
      B.quad('room', [t, yc, zp], [s * ww, 0, 0], [0, h, 0], hsh < 0.03 ? '#ff6a4a' : '#dfe8ff', { pane: { id: roomId(type, seed), w: ww, h }, emissive: 1.1 });
    } else {
      B.quad('glass', [t, yc, zp], [s * ww, 0, 0], [0, h, 0], hsh > 0.93 ? '#05070a' : '#101820', { pane: { id: roomId(hsh > 0.93 ? 4 : type, seed), w: ww, h } });
    }
    // frame and mullion
    const fz = z - s * (R - 1.2);
    B.box('std', t, y1 - 1, fz, ww, 2, 1.6, o2.frame || '#4a5056', null, STEEL);
    B.box('std', t, y0 + 1, fz, ww, 2, 1.6, o2.frame || '#4a5056', null, STEEL);
    if (ww > 34) B.box('std', t, yc, fz, 1.6, h, 1.6, o2.frame || '#4a5056', null, STEEL);
  }
}

/** The podium: granite plinth, precast ground floor (real windows cut in it), a ribbon of first-floor windows, the parapet. */
function podiumFacade(P, s, t0, t1, holes) {
  const { B, o } = P;
  const z = s * o.h / 2;
  const C = S(DET.concrete, 0.85, 0);
  band(B, o, s, t0, t1, 0, 12, GRANITE, S(DET.concrete, 0.55, 0.05), holes);
  band(B, o, s, t0, t1, 12, 126, PRECAST, C, holes);
  // horizontal reveals in the precast every 38 units (panel joints)
  if (P.lod() >= 1) for (const y of [50, 88]) band(B, o, s, t0, t1, y - 0.5, y + 0.5, PRECAST_D, C, holes, 0.1);
  B.box('std', (t0 + t1) / 2, 128, z + s * 1.5, t1 - t0, 4, 3, PRECAST_D, null, C);
  band(B, o, s, t0, t1, 130, 152, BAND, C);
  windowBand(P, s, t0, t1, 160, 252, 58, 46, { roomType: 2, lit: 0.08, pier: '#d2cdc2' });
  band(B, o, s, t0, t1, 152, 160, '#d2cdc2', C);
  band(B, o, s, t0, t1, 252, 290, PRECAST, C);
  if (P.lod() >= 1) band(B, o, s, t0, t1, 268, 269, PRECAST_D, C, [], 0.1);
  B.box('std', (t0 + t1) / 2, 293, z + s * 0.8, t1 - t0, 6, o.h + 3, '#7d8286', null, STEEL);
  // downpipes every ~600
  if (P.lod() >= 1) {
    for (let t = t0 + 300; t < t1 - 100; t += 620) B.cyl('std', t, 0, z + s * 3, 2.4, 290, '#5b6065', 8, 1, null, STEEL);
  }
}

/** The tower: a glazed lobby at the foot, three storeys of punched windows, the parapet. */
function towerFacade(P, s, t0, t1, holes, from = 0) {
  const { B, o } = P;
  const z = s * o.h / 2;
  const C = S(DET.concrete, 0.85, 0);
  if (from < 12) band(B, o, s, t0, t1, 0, 12, GRANITE, S(DET.concrete, 0.55, 0.05), holes);
  if (from < 140) {
    windowBand(P, s, t0, t1, 18, 132, 70, 62, { roomType: 1, lit: 0.04, pier: '#8f959a', depth: 3, frame: '#2a2e32', boarded: true });
    band(B, o, s, t0, t1, 12, 18, '#8f959a', STEEL);
    band(B, o, s, t0, t1, 132, 146, '#6d7378', STEEL);
  }
  for (let k = 0; k < 3; k++) {
    const y0 = 146 + k * 101;
    if (y0 + 101 < from) continue;
    band(B, o, s, t0, t1, y0, y0 + 20, '#c9c4b8', C);
    windowBand(P, s, t0, t1, y0 + 20, y0 + 86, 64, 40, { roomType: 2, lit: 0.06, pier: '#d4cfc4' });
    band(B, o, s, t0, t1, y0 + 86, y0 + 101, '#c9c4b8', C);
  }
  band(B, o, s, t0, t1, 449, 490, '#d4cfc4', C);
  B.box('std', (t0 + t1) / 2, 492, z + s * 0.6, t1 - t0, 5, o.h + 3, '#7d8286', null, STEEL);
  // vertical fins at the corners of each 380 bay
  if (P.lod() >= 1) for (let t = t0 + 190; t < t1 - 40; t += 380) B.box('std', t, 146 + 150, z + s * 3, 6, 300, 6, '#b9b4a8', null, C);
}

/** The roof side of a parapet: its inner face from the roof up, the coping. */
function parapetInner(P, s, t0, t1, base) {
  const { B, o } = P;
  band(B, o, s, t0, t1, base, base + 40, '#a9a49a', S(DET.concrete, 0.9, 0));
  band(B, o, s, t0, t1, base, base + 4, '#6d6a64', S(DET.concrete, 0.9, 0), [], 0.4);
}

const WALLS = {
  hosp: { face: '#cfcac0' },
  plant: { face: '#9ea196' },
  lift: { face: '#8d9498' },
  'hosp-or': { face: '#a1bdb3' },
  'hosp-ext': { face: PRECAST, facadeTop: 296 },
  'tower-ext': { face: '#d4cfc4', facadeTop: 494 },
  stair: { face: '#b9b8ae', top: 600 },
  'hosp-tower': {
    face: '#d4cfc4', facadeTop: 494,
    // above the podium's roof, the tower's west face rises from 300
    after(P) {
      P.at(P.B, P.o.x, P.o.y, P.o.a, P.o.id * 31 + 5, 0);
      towerFacade(P, 1, -P.o.w / 2, P.o.w / 2, [], 286);
    },
  },
  yardgate: { draw: (P) => OBSTACLES.yardgate(P) },
  plantblock: { draw: (P) => plantBlock(P) },
  duct: { draw: (P) => OBSTACLES.duct(P) },
  mast: { draw: () => {} },
};

/** The plant block east of the stair: the tower's façade outside, a louvred screen round cooling towers above the roof. */
function plantBlock(P) {
  const { B, o } = P;
  const L = o.w, W = o.h;
  P.at(B, o.x, o.y, 0, o.id * 31, 0);
  const TOP = 450, SCR = 548;
  // the screen: steel louvres on a frame, all four sides, from the roof up
  const side = (cx, cz, len, ry) => {
    B.add('std', T.box(), [cx, (TOP + SCR) / 2, cz], [len, SCR - TOP, 1.5], [0, ry, 0], '#6d7378', S(DET.corrugated, 0.5, 0.6));
    if (P.lod() >= 1) for (let y = TOP + 8; y < SCR - 2; y += 9) B.add('std', T.box(), [cx, y, cz], [len, 1.2, 4], [0.5, ry, 0], '#8a9096', STEEL);
  };
  side(0, -W / 2, L, 0); side(0, W / 2, L, 0); side(-L / 2, 0, W, HALF); side(L / 2, 0, W, HALF);
  B.quad('std', [0, SCR - 30, 0], [L, 0, 0], [0, 0, -W], '#4a4e52', S(DET.concrete, 0.9, 0));
  // cooling towers: cylinders with fan shrouds, rising over the screen
  for (const [x, z] of [[-L * 0.28, -W * 0.2], [L * 0.05, -W * 0.2], [L * 0.32, -W * 0.2], [-L * 0.2, W * 0.25], [L * 0.2, W * 0.25]]) {
    B.rblock('std', x, SCR - 30, z, 150, 70, 150, 3, '#9aa0a2', null, S(DET.panel, 0.5, 0.5));
    B.cyl('std', x, SCR + 40, z, 52, 20, '#7d8386', 22, 0.92, null, STEEL);
    B.cyl('std', x, SCR + 58, z, 48, 2, '#1c1e20', 20, 1, null, S(DET.hesco, 0.6, 0.6));
  }
  // steam from the vents is the hideout's trick; here a red beacon on the tallest
  B.add('blink', T.sphere(6, 4), [L * 0.32, SCR + 70, -W * 0.2], [3, 3, 3], null, '#ff2a1a', { emissive: 3.4 });
  // the tower's own façade wraps the block below the roof (south and east: the tower walls draw it)
}

function facade(P, s, t0, t1, holes) {
  const { o } = P;
  if (o.style === 'stair') return;          // (the stair house wraps the shaft above the roof)
  const [wx, wy] = P.toWorld(o, (t0 + t1) / 2, s * (o.h / 2 + 16));
  const ground = P.gy(wx, wy);
  if (ground > 200) { parapetInner(P, s, t0, t1, ground); return; }
  switch (o.style) {
    case 'hosp-ext': podiumFacade(P, s, t0, t1, holes); break;
    case 'tower-ext': case 'hosp-tower': towerFacade(P, s, t0, t1, holes); break;
    case 'stair': break;
    default: band(P.B, o, s, t0, t1, 0, 130, '#bdb8ac', S(DET.concrete, 0.9, 0), holes);
  }
}

// ---- special ceilings -------------------------------------------------------------------------------
const CEILINGS = {
  /** Exposed slab: concrete soffit, beams, a duct and a cable tray, pipes. */
  slab(C) {
    const { B, r, H, fin } = C;
    B.quad('std', [0, H + 14, 0], [r.w, 0, 0], [0, 0, r.h], fin.ceil, { noAO: true, surf: [DET.concrete, 0.9, 0] });
    const along = r.w >= r.h;
    const len = along ? r.w : r.h, wid = along ? r.h : r.w;
    const nb = Math.max(1, Math.floor(len / 200));
    for (let i = 1; i < nb; i++) {
      const t = -len / 2 + (i * len) / nb;
      if (along) B.box('std', t, H + 5, 0, 16, 18, r.h, shadeHex(fin.ceil, -0.1), null, S(DET.concrete, 0.9, 0));
      else B.box('std', 0, H + 5, t, r.w, 18, 16, shadeHex(fin.ceil, -0.1), null, S(DET.concrete, 0.9, 0));
    }
    if (C.lod() >= 1) {
      const off = wid * 0.28;
      if (along) {
        B.box('std', 0, H - 6, -off, r.w, 14, 22, '#9aa0a2', null, S(DET.panel, 0.5, 0.6));
        B.cylX('std', 0, H - 4, off, 2.4, r.w, '#b8433a', 8, S(0, 0.5, 0.3));
        B.cylX('std', 0, H - 4, off + 8, 1.8, r.w, '#4a7ab0', 8, S(0, 0.5, 0.3));
        B.box('std', 0, H - 2, off - 20, r.w, 1.2, 14, '#6d7276', null, STEEL);
      } else {
        B.box('std', -off, H - 6, 0, 22, 14, r.h, '#9aa0a2', null, S(DET.panel, 0.5, 0.6));
        B.cylZ('std', off, H - 4, 0, 2.4, r.h, '#b8433a', 8, S(0, 0.5, 0.3));
        B.cylZ('std', off + 8, H - 4, 0, 1.8, r.h, '#4a7ab0', 8, S(0, 0.5, 0.3));
      }
    }
  },
  /** The theatre ceiling: smooth panels, the laminar-flow canopy over the table. */
  or(C) {
    const { B, r, H, fin } = C;
    B.quad('std', [0, H, 0], [r.w, 0, 0], [0, 0, r.h], fin.ceil, { noAO: true, surf: [DET.plaster, 0.7, 0] });
    B.box('std', 0, H - 2, 0, 220, 4, 160, '#e8ecec', null, S(DET.panel, 0.4, 0.2));
    if (C.lod() >= 1) for (let i = -3; i <= 3; i++) B.box('std', i * 30, H - 4.2, 0, 1.2, 0.6, 150, '#b8bec0', null, CHROME);
  },
};

/** A ceiling fixture of the kit's per-section set: `C.lit` / `C.color` from the map lights. */
function fixture(C) {
  const { B, H, fx, lit, color } = C;
  const glowC = color ? mixHex(color, '#ffffff', 0.35) : null;
  switch (fx.kind) {
    case 'tube': {
      // a bare batten under the slab, hung on two rods
      const y = H - 8;
      B.box('std', 0, y + 1.6, 0, 72, 2.4, 5, '#c9cbc8', null, S(0, 0.5, 0.4));
      for (const e of [-1, 1]) B.cyl('std', e * 26, y + 2.5, 0, 0.3, 10, '#555', 4);
      if (lit) C.glow(B, 0, y, 0, 66, 1.6, 1.6, glowC, 3.2); else B.cylX('std', 0, y, 0, 0.9, 66, '#b8bcbc', 6, S(0, 0.3, 0));
      break;
    }
    case 'round': {
      B.cyl('std', 0, H - 1.2, 0, 8, 1.2, '#c9c9c4', 14, 1, null, S(0, 0.4, 0.5));
      if (lit) C.glow(B, 0, H - 1.6, 0, 11, 0.4, 11, glowC, 2.6); else B.cyl('std', 0, H - 1.6, 0, 6.5, 0.4, '#8a8d8e', 12, 1, null, S(0, 0.3, 0));
      break;
    }
    case 'orpanel': {
      B.box('std', 0, H - 0.8, 0, 90, 1.6, 40, '#d8dcdc', null, S(0, 0.4, 0.5));
      if (lit) C.glow(B, 0, H - 1.7, 0, 84, 0.4, 34, glowC, 2.2); else B.box('std', 0, H - 1.7, 0, 84, 0.4, 34, '#a8acae', null, S(0, 0.3, 0));
      break;
    }
    default: {
      // a recessed 2 x 4 troffer with a prismatic diffuser
      const w = 60, d = 26;
      B.box('std', 0, H - 0.6, 0, w + 3, 1.2, d + 3, '#c9c9c4', null, S(0, 0.4, 0.5));
      if (lit) C.glow(B, 0, H - 1.3, 0, w, 0.4, d, glowC, 2.4); else B.box('std', 0, H - 1.3, 0, w, 0.4, d, '#9ea1a2', null, S(DET.plastic, 0.4, 0));
      if (C.lod() >= 1) for (const e of [-1, 1]) B.box('std', 0, H - 1.6, e * d / 4, w, 0.5, 0.7, '#b0b2b2', null, S(0, 0.4, 0.6));
    }
  }
}

/** Floors: guide lines in the corridors and the pit (the colour-coded wayfinding lines). */
function floorFx(C) {
  const { B, r, fin } = C;
  if (!fin.stripe) return;
  const along = r.w >= r.h;
  fin.stripe.forEach((c, i) => {
    const off = (i - (fin.stripe.length - 1) / 2) * 9;
    if (along) B.quad('lvfloor', [0, 0.05, off], [r.w - 40, 0, 0], [0, 0, -4], c, { noAO: true, surf: [DET.linoleum, 0.35, 0] });
    else B.quad('lvfloor', [off, 0.05, 0], [4, 0, 0], [0, 0, -(r.h - 40)], c, { noAO: true, surf: [DET.linoleum, 0.35, 0] });
  });
}
for (const f of Object.values(ROOMS)) if (f.stripe) f.floorFx = floorFx;

// ---- gates: the closed leaves (E animates them, JOURNEY §4.1) ------------------------------------------
function gate(P) {
  const { B, o, gate: g } = P;
  const L = o.w, h = g && g.kind === 'shutter' ? 108 : 86;
  const kind = o.gateKind;
  if (kind === 'shutter') {
    // a roller shutter: slats, bottom rail, guides, the coil box above
    B.block('std', 0, 0, 0, L, h, 2.4, '#8a9096', null, S(DET.corrugated, 0.5, 0.6));
    for (let y = 6; y < h; y += 6) B.box('std', 0, y, 1.3, L, 0.8, 0.6, '#6d7378', null, STEEL);
    B.box('std', 0, 2, 0, L, 4, 4, '#3a3e42', null, STEEL);
    B.box('std', 0, h + 6, 0, L + 8, 14, 12, '#5a6066', null, STEEL);
    P.pic(B, 'hs_caution', 0, 12, 1.5, L - 8, 5, 0);
    P.pic(B, 'hs_caution', 0, 12, -1.5, L - 8, 5, Math.PI);
    return;
  }
  // a door leaf: steel with a wired-glass vision panel, kick plate, push plate; the ER's are glazed
  const glazed = o.gate === 'er_doors';
  const color = o.gate === 'stair_door' ? '#a33a2a' : glazed ? '#5c6268' : '#7f8f96';
  B.rblock('std', 0, 1, 0, L - 1, h - 2, 3.6, 0.6, color, null, PAINT);
  if (glazed) {
    B.box('glass', 0, h * 0.55, 0, L - 12, h * 0.72, 3.8, '#1a2830', null, S(DET.glass, 0.1, 0.3));
  } else {
    B.box('glass', L * 0.1, h * 0.68, 0, L * 0.28, h * 0.26, 3.8, '#1c262e', null, S(DET.glass, 0.1, 0.3));
  }
  B.box('std', 0, 4, 0, L - 4, 7, 3.9, '#a3a8ac', null, CHROME);
  B.box('std', L * 0.3, h * 0.48, 0, 5, 10, 4.4, '#b8bcc0', null, CHROME);
  if (o.gate === 'stair_door') {
    B.box('std', 0, h * 0.44, 0, L - 10, 2.4, 6.5, '#c9ced3', null, CHROME);    // panic bar both sides
    P.pic(B, 'hs_stairb', 0, h * 0.82, 1.9, 30, 10, 0);
  }
  if (o.gate === 'ward_doors') { P.pic(B, 'hs_wardc', 0, h * 0.82, 1.9, 36, 8, 0); P.decal(B, 'blood_hand', L * 0.1, h * 0.45, 1.95, 22, 22, 0); }
  if (o.gate === 'surgery_doors') { P.pic(B, 'hs_or1', 0, h * 0.82, 1.9, 32, 9, 0); P.pic(B, 'hs_biohazard', 0, h * 0.62, -1.9, 12, 12, Math.PI); }
  void T; void CONC;
}

// ---- the city round the hospital: a street of buildings across the avenue and the road behind, a skyline ----
const FACADES = ['#8c8478', '#9a8a72', '#7a6a5a', '#a09080', '#6a6258', '#8a7a6a', '#7a8088', '#b0a28c'];

/** Buildings along a line outside the map (art only): fronts facing the hospital. */
function streetRow(B, x0, x1, y, a, seed) {
  let x = x0, i = 0;
  while (x < x1) {
    const L = 260 + hash01(seed + i * 7) * 260, W = 170 + hash01(seed + i * 3) * 90;
    const cx = x + L / 2;
    const off = W / 2 + 6;
    const o = { id: seed + i, kind: 'building', w: L, h: W, a, color: FACADES[Math.floor(hash01(seed + i * 11) * FACADES.length)], roof: '#4e4a45', top: 160 + Math.round(hash01(seed + i * 5) * 80) };
    // (a = 0: the front faces +y (south); a = PI: north; a = PI/2: west)
    const px = a === Math.PI / 2 ? y + off : cx, py = a === Math.PI / 2 ? cx : a === 0 ? y - off : y + off;
    o.x = px; o.y = py;
    B.obj(px, py, a, o.id * 31);
    B.setJitter(0.05);
    try { building(B, o, L, W, null); } catch (err) { /* a backdrop building is not worth a warning */ }
    x += L + 20 + hash01(seed + i) * 40;
    i++;
  }
}

/** The city skyline beyond the backdrop (one mesh): boxes with lit windows, red lights on the tall ones. */
function skyline(api, root, day) {
  const list = [];
  let k = 0;
  const add = (x, y, w, d, h) => list.push({ x, y, w, d, h, s: k++ });
  for (let x = -600; x < 10400; x += 260 + hash01(k * 3) * 300) add(x, -700 - hash01(k * 7) * 900, 180 + hash01(k) * 200, 180 + hash01(k * 5) * 160, 260 + hash01(k * 11) * 700);
  for (let y = 400; y < 5600; y += 300 + hash01(k * 3) * 300) add(9500 + hash01(k * 7) * 900, y, 160 + hash01(k) * 200, 180 + hash01(k * 5) * 200, 220 + hash01(k * 11) * 600);
  const pos = [], nor = [], uv = [], col = [], idx = [];
  let vi = 0;
  const quad = (a, b, c, d, n, u1, v1, kk) => {
    for (const p of [a, b, c, d]) { pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]); }
    uv.push(0, 0, u1, 0, u1, v1, 0, v1);
    for (let i = 0; i < 4; i++) col.push(kk, kk, kk);
    idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
    vi += 4;
  };
  for (const s of list) {
    const x0 = s.x - s.w / 2, x1 = s.x + s.w / 2, z0 = s.y - s.d / 2, z1 = s.y + s.d / 2, h = s.h;
    const t = 0.7 + hash01(s.s) * 0.5;
    const uw = s.w / 90, ud = s.d / 90, vh = h / 60;
    quad([x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1], [0, 0, 1], uw, vh, t);
    quad([x1, 0, z0], [x0, 0, z0], [x0, h, z0], [x1, h, z0], [0, 0, -1], uw, vh, t * 0.9);
    quad([x1, 0, z1], [x1, 0, z0], [x1, h, z0], [x1, h, z1], [1, 0, 0], ud, vh, t * 0.8);
    quad([x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0], [-1, 0, 0], ud, vh, t * 0.85);
    quad([x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], [0, 1, 0], 0.01, 0.01, t * 0.5);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  // a window texture: dark glass and concrete, a few lit rooms (the emissive map: only the lit ones glow)
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const c2 = cv.getContext('2d');
  const cl = document.createElement('canvas');
  cl.width = cl.height = 256;
  const g2 = cl.getContext('2d');
  c2.fillStyle = day ? '#6a727a' : '#14171c'; c2.fillRect(0, 0, 256, 256);
  g2.fillStyle = '#000'; g2.fillRect(0, 0, 256, 256);
  for (let yy = 0; yy < 8; yy++) for (let xx = 0; xx < 8; xx++) {
    const lit = hash01(xx * 7 + yy * 13 + 1) < 0.14;
    c2.fillStyle = day ? (hash01(xx + yy * 5) < 0.5 ? '#3a4652' : '#4a5866') : lit ? '#e8c890' : '#0a0c10';
    c2.fillRect(xx * 32 + 6, yy * 32 + 8, 20, 16);
    if (lit && !day) { g2.fillStyle = hash01(xx * 3 + yy) < 0.3 ? '#9ab8ff' : '#ffd8a0'; g2.fillRect(xx * 32 + 6, yy * 32 + 8, 20, 16); }
  }
  const tex = new THREE.CanvasTexture(cv), emi = new THREE.CanvasTexture(cl);
  for (const t of [tex, emi]) { t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; }
  const mat = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.8, metalness: 0.1, emissive: new THREE.Color('#ffffff'), emissiveMap: emi, emissiveIntensity: day ? 0 : 0.8 });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'lv-skyline';
  mesh.frustumCulled = false;
  root.add(mesh);
  // aviation lights on the tall ones
  const halos = api.halos;
  for (const s of list) if (s.h > 700) halos.push({ x: s.x, y: s.y, h: s.h + 6, color: '#ff2a1a', size: 40, blink: 1, strength: 0.6 });
  return { mesh, dispose() { root.remove(mesh); g.dispose(); mat.dispose(); tex.dispose(); emi.dispose(); } };
}

/** The atlas cells a wall's grime can use (by room when the finish lists none). */
const GRIME = ['grime', 'grime2', 'blood_hand', 'mold'];

/**
 * @param {object} ctx renderer ctx (ctx.map is the built level)
 * @param {object} deps { root, mats, fx, halos, shafts, day, aniso, gy, tier, full, newBuilder(), matOf(bucket, tier) }
 */
export function createLevelArt(ctx, deps) {
  const map = ctx.map;
  let sky = null;
  const level = {
    id: 'hospital',
    atlas: hospitalAtlas(),
    buckets: BUCKETS,
    rooms: ROOMS,
    walls: WALLS,
    facade,
    ceilings: CEILINGS,
    fixture,
    grimeCells: GRIME,
    brokenWindows: 0.16,
    obstacles: OBSTACLES,
    items: ITEMS,
    gate,
    lamps: (L) => lampsOf(L, map),
    doorFrame: (it) => (it.style === 'stair' ? { color: '#6d7074', surf: STEEL, jamb: 3 } : it.style === 'hosp-ext' ? { color: '#4a5056', surf: STEEL, jamb: 4 } : { color: '#9aa2a8', surf: S(DET.panel, 0.45, 0.5), jamb: 3 }),
    leafColor: (it) => (it.style === 'plant' ? '#5d6a5a' : it.style === 'lift' ? '#8d9498' : ['#8fa6ae', '#a8b4a0', '#9aa8b8', '#b0a894'][Math.floor(hash01(Math.round(it.x + it.y)) * 4)]),
    windowFrame: () => ({ color: '#dcdcd4', surf: S(DET.panel, 0.5, 0.2) }),
    wallProp,
    // the city round it: a street of buildings across Mercy Avenue, the road behind, the skyline
    props(P) {
      // (each row in one cell per bucket: a backdrop is seen whole, few draw calls beat culling here)
      P.B.setCell('hs-street-n');
      streetRow(P.B, -200, 9000, 0, 0, 5000);
      P.B.setCell('hs-street-s');
      if (P.lod() >= 1) streetRow(P.B, -200, 9000, 4600, Math.PI, 6000);
      P.B.setCell(null);
    },
    finish(P) { sky = skyline(P, P.root, P.day); },
    dispose() { if (sky) sky.dispose(); },
  };
  void HALF;
  return createInteriorArt(ctx, deps, level);
}
