// The 3D art of the story level "mall", Westgate (JOURNEY.md §5). Owner: agent C2.
//
// The layout (shared/levels/mall.js) tags its walls and props; this module gives them their look through
// the interior kit (hospital-kit.js): terrazzo under a glass barrel vault in the atrium (the day pours in
// through it and the west glass wall), a food court lit by lantern skylights, tiled kitchens and steel
// freezers, Harrow's blacked-out department store, the concrete garage with its sodium tubes, the loading
// dock; the façades (precast and a terracotta band, WESTGATE over the doors, the open-deck garage), the
// standing water on the flooded car park, and the models of the props (mall-props.js) and the signs of the
// atlas (mall-atlas.js).
//
// The interface (render3d/levels/index.js fills in no-ops):
//   BUCKETS, createLevelArt(ctx, deps) → { obstacle, roof, props, finish, update, setQuality, dispose,
//   material, gateModel, setLights }

import * as THREE from 'three';
import { createInteriorArt, KIT_BUCKETS, T, DET, S, STEEL, CHROME, PAINT, PLAST, WOODS, CONC, shadeHex, mixHex, hash01 } from './hospital-kit.js';
import { mallAtlas } from './mall-atlas.js';
import { mallProps, VAULT, SKYLIGHTS, rectMinus, RTRI } from './mall-props.js';
import { streetRow, skyline } from './hospital.js';
import { makeWaterNormal } from '../world-tex.js';
import { rod } from '../dress-kit.js';

/** Extra geo-builder buckets of this level. */
export const BUCKETS = { ...KIT_BUCKETS };

const HALF = Math.PI / 2;
const PLASTER = S(DET.plaster, 0.6, 0);

// ---- room finishes ---------------------------------------------------------------------------------
const DOWN = { kind: 'down', step: 140, rowStep: 150, color: '#fff0d8', stray: 0.05, halo: 40 };
const TROF = { kind: 'troffer', step: 160, rowStep: 200, color: '#eef4ff', stray: 0.05 };
const TUBE = { kind: 'tube', step: 200, rowStep: 240, color: '#e8f0ff', stray: 0.05 };
const SODIUM = { kind: 'sodium', step: 240, rowStep: 300, color: '#ffc070', stray: 0.03, halo: 70, haloK: 0.35 };
const PEND = { kind: 'pendant', step: 270, rowStep: 330, color: '#fff0d0', stray: 0.08, halo: 70 };
const COLD = { kind: 'down', step: 120, rowStep: 140, color: '#cfe6ff', stray: 0.1 };

const MALL_PROPS = ['poster', 'ext', 'bin', 'blood', 'notice', 'poster', 'graffiti', 'bench', 'plant', 'missing', 'exit'];
const BACK_PROPS = ['ext', 'panel', 'blood', 'graffiti', 'vent', 'notice', 'exit'];
const BLOODY = ['blood_trail', 'blood_pool', 'blood_splat', 'grime', 'mud'];

const ROOMS = {
  'wg-atrium': { floor: '#cfc8bb', floorDet: DET.terrazzo, floorRough: 0.22, upper: '#e8e2d6', upperDet: DET.plaster, skirt: '#8a8478', skirtH: 8, cornice: '#f0ece4', ceilKind: 'vault', grime: 0.5, grimeCells: ['grime', 'wstain', 'blood_hand', 'g_help'], wallProps: MALL_PROPS, wallStep: 180, floorDecals: BLOODY, decalArea: 220000 },
  'wg-gallery': { floor: '#d4cdbf', floorDet: DET.terrazzo, floorRough: 0.25, upper: '#e8e2d6', skirt: '#8a8478', skirtH: 6, cornice: '#f0ece4', ceil: '#ece8e0', ceilDet: DET.plaster, ceilKind: 'plain', fixture: DOWN, grime: 0.5, wallProps: MALL_PROPS, floorDecals: BLOODY, decalArea: 120000 },
  'wg-arcade': { floor: '#d4cdbf', floorDet: DET.terrazzo, floorRough: 0.25, upper: '#e8e2d6', skirt: '#8a8478', skirtH: 6, ceil: '#ece8e0', ceilDet: DET.plaster, ceilKind: 'plain', fixture: DOWN, grime: 0.5, wallProps: MALL_PROPS, floorDecals: BLOODY, decalArea: 120000 },
  'wg-security': { floor: '#4a4e56', floorDet: DET.carpet, floorRough: 0.9, upper: '#c8c8c0', lower: '#8a8e92', lowerH: 30, skirt: '#2a2c30', ceil: '#dcdcd4', ceilKind: 'grid', fixture: TROF, grime: 0.4, wallProps: ['notice', 'poster', 'clock', 'ext', 'graffiti'], floorDecals: ['blood_pool', 'grime'] },
  'wg-backroom': { floor: '#7a7870', floorDet: DET.concrete, floorRough: 0.75, upper: '#b8b8ae', upperDet: DET.brick, skirt: '#3a3a36', ceil: '#9a9a94', ceilKind: 'slab', fixture: TUBE, grime: 0.7, grimeCells: ['grime', 'mold', 'grime2', 'wstain'], wallProps: BACK_PROPS, floorDecals: ['grime2', 'mud', 'blood_trail'] },
  'wg-shop-phone': { floor: '#e8e8e4', floorDet: DET.tile, floorRough: 0.25, upper: '#f4f4f0', skirt: '#c8c8c4', ceil: '#f0f0ec', ceilKind: 'grid', fixture: TROF, grime: 0.4, wallProps: ['poster', 'blood', 'graffiti'], floorDecals: ['blood_splat', 'grime', 'blood_trail'] },
  'wg-shop-clothes': { floor: '#8a6a4a', floorDet: DET.wood, floorRough: 0.45, upper: '#e8e0d4', lower: '#b8a890', lowerH: 34, rail: '#6a5038', railSurf: WOODS, skirt: '#4a3a2a', ceil: '#ece8e0', ceilKind: 'plain', fixture: DOWN, grime: 0.4, wallProps: ['poster', 'mirror', 'mirror', 'blood'], floorDecals: ['grime', 'blood_splat'] },
  'wg-stall': { floor: '#8a4a3a', floorDet: DET.tile, floorRough: 0.35, lower: '#e8e8e2', lowerH: 90, lowerDet: DET.tile, upper: '#d8d4ca', skirt: '#5a3a2a', ceil: '#dcdcd4', ceilKind: 'plain', fixture: TUBE, grime: 0.8, grimeCells: ['grime2', 'blood_drip', 'grime'], floorDecals: ['grime2', 'blood_pool', 'mud'] },
  'wg-service': { floor: '#6a6862', floorDet: DET.concrete, floorRough: 0.8, lower: '#5a6a5a', lowerH: 36, lowerDet: DET.brick, upper: '#b0b0a6', upperDet: DET.brick, skirt: '#2a2c28', ceil: '#8f8f88', ceilKind: 'slab', fixture: TUBE, grime: 0.8, grimeCells: ['grime', 'mold', 'wstain', 'g_arrow', 'blood_hand'], wallProps: BACK_PROPS, floorDecals: ['grime2', 'blood_trail', 'mud'], decalArea: 90000 },
  'wg-food': { floor: '#c8bfae', floorDet: DET.terrazzo, floorRough: 0.25, upper: '#e8e0d0', lower: '#a8543a', lowerH: 26, lowerDet: DET.tile, skirt: '#5a3a2a', ceil: '#ece8e0', ceilDet: DET.plaster, ceilKind: 'skylights', fixture: PEND, grime: 0.5, wallProps: MALL_PROPS, floorDecals: BLOODY, decalArea: 160000 },
  'wg-freezer': { floor: '#8a9096', floorDet: DET.corrugated, floorRough: 0.4, upper: '#d8dcdc', upperSurf: STEEL, skirt: '#6a7074', ceil: '#d8dcdc', ceilKind: 'plain', fixture: COLD, grime: 0.6, grimeCells: ['blood_hand', 'mold', 'blood_drip'], floorDecals: ['blood_pool', 'blood_trail'], decalArea: 60000 },
  'wg-kitchen': { floor: '#7a3a2a', floorDet: DET.tile, floorRough: 0.35, lower: '#eeeee8', lowerH: 100, lowerDet: DET.tile, upper: '#d8d4ca', skirt: '#4a2a1a', ceil: '#dcdcd4', ceilKind: 'plain', fixture: TUBE, grime: 0.8, grimeCells: ['grime2', 'blood_drip', 'blood_hand'], floorDecals: ['blood_pool', 'grime2', 'blood_trail'], decalArea: 80000 },
  'wg-stock': { floor: '#7a7870', floorDet: DET.concrete, floorRough: 0.75, upper: '#b8b8ae', upperDet: DET.brick, skirt: '#3a3a36', ceil: '#9a9a94', ceilKind: 'slab', fixture: TUBE, grime: 0.7, grimeCells: ['grime', 'mold', 'grime2', 'wstain'], wallProps: BACK_PROPS, floorDecals: ['grime2', 'mud', 'blood_trail'] },
  'wg-store': { floor: '#bdb6a8', floorDet: DET.linoleum, floorRough: 0.3, upper: '#d8d2c6', skirt: '#4a4a48', skirtH: 6, ceil: '#b8b4ac', ceilKind: 'grid', tile: 50, fixture: { ...TROF, stray: 0.02 }, missing: 0.09, grime: 0.6, wallProps: ['poster', 'ext', 'graffiti', 'blood', 'exit'], floorDecals: BLOODY, decalArea: 150000 },
  'wg-garage': { floor: '#6a6862', floorDet: DET.concrete, floorRough: 0.8, lower: '#8a867c', lowerH: 24, lowerDet: DET.concrete, upper: '#a8a498', upperDet: DET.concrete, skirt: '#c8a01a', skirtH: 6, ceil: '#9c9c98', ceilKind: 'slab', fixture: SODIUM, grime: 0.7, grimeCells: ['grime', 'wstain', 'grime2', 'g_arrow'], wallProps: ['ext', 'garagesign', 'graffiti', 'vent', 'exit'], wallStep: 260, floorDecals: ['grime2', 'mud', 'grime2', 'blood_trail'], decalArea: 120000 },
  'wg-office': { floor: '#7a7a70', floorDet: DET.linoleum, upper: '#d8d4c8', skirt: '#3a3a36', ceil: '#dcdcd4', ceilKind: 'grid', fixture: TROF, grime: 0.5, wallProps: ['notice', 'poster', 'clock'], floorDecals: ['grime', 'mud'] },
  'wg-void': { noFloor: true, ceilKind: 'none', upper: '#3a3a38', skirtH: 0 },
};

// ---- floors: the atrium's inlays, the food court's checker, the store's carpet, the garage's bays ----
ROOMS['wg-atrium'].floorFx = (C) => {
  const { B, r } = C;
  const inset = 70, bw = 36;
  const q = (x, z, w, d, c) => B.quad('lvfloor', [x, 0.04, z], [w, 0, 0], [0, 0, -d], c, { noAO: true, surf: [DET.terrazzo, 0.22, 0] });
  const W = r.w - 2 * inset, D = r.h - 2 * inset;
  q(0, -D / 2, W, bw, '#8a7a66'); q(0, D / 2, W, bw, '#8a7a66');
  q(-W / 2, 0, bw, D, '#8a7a66'); q(W / 2, 0, bw, D, '#8a7a66');
  // a ring round the fountain, and a star of inlaid strips
  const fx = 3800 - r.x, fz = 2450 - r.y;
  const n = 32;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2, R = 290;
    B.add('lvfloor', T.plane(), [fx + Math.cos(a) * R, 0.05, fz + Math.sin(a) * R], [(2 * Math.PI * R) / n + 1, 26, 1], [-HALF, -a + HALF, 0], '#6a5a4a', { noAO: true, surf: [DET.terrazzo, 0.22, 0] });
  }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2, R0 = 320, len = k % 2 ? 180 : 320;
    B.add('lvfloor', T.plane(), [fx + Math.cos(a) * (R0 + len / 2), 0.05, fz + Math.sin(a) * (R0 + len / 2)], [len, 10, 1], [-HALF, -a, 0], '#b89a5a', { noAO: true, surf: [DET.terrazzo, 0.2, 0.3] });
  }
};
ROOMS['wg-food'].floorFx = (C) => {
  const { B, r } = C;
  if (r.w < 1000) return;
  // a checkerboard of terracotta and cream under the tables
  const step = 120;
  const nx = Math.floor((r.w - 200) / step), nz = Math.floor((r.h - 500) / step);
  const x0 = -nx * step / 2, z0 = -r.h / 2 + 350;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    if ((i + j) % 2) continue;
    B.quad('lvfloor', [x0 + (i + 0.5) * step, 0.04, z0 + (j + 0.5) * step], [step, 0, 0], [0, 0, -step], '#a86a4a', { noAO: true, surf: [DET.tile, 0.3, 0] });
  }
};
ROOMS['wg-store'].floorFx = (C) => {
  const { B, r } = C;
  if (r.w < 1000) return;
  // carpet in the fashion department, white tile in the pharmacy
  const q = (x0, y0, x1, y1, c, det, rough) => B.quad('lvfloor', [(x0 + x1) / 2 - r.x, 0.04, (y0 + y1) / 2 - r.y], [x1 - x0, 0, 0], [0, 0, -(y1 - y0)], c, { noAO: true, surf: [det, rough, 0] });
  q(7780, 2080, 8820, 3320, '#5a4a56', DET.carpet, 0.95);
  q(7240, 3380, 7860, 3960, '#e4e4de', DET.tile, 0.25);
  q(8780, 3200, 9280, 3960, '#4a5a4a', DET.carpet, 0.95);
};
ROOMS['wg-garage'].floorFx = (C) => {
  const { B, r } = C;
  const q = (x, z, w, d, c) => B.quad('lvfloor', [x, 0.05, z], [w, 0, 0], [0, 0, -d], c, { noAO: true, surf: [0, 0.7, 0] });
  // bay lines either side of the aisles (the layout parks its cars at y 330 / 930 / 1540)
  for (const yc of [330, 930, 1540]) {
    const zc = yc - r.y;
    if (Math.abs(zc) > r.h / 2 - 60) continue;
    for (let x = -r.w / 2 + 30; x < r.w / 2 - 30; x += 110) q(x, zc, 3, 120, '#e8e4d8');
  }
  // the aisle's direction arrows (paint)
  if (C.lod() >= 1) for (let x = -r.w / 2 + 200; x < r.w / 2 - 200; x += 500) for (const zc of [630 - r.y, 1240 - r.y]) if (Math.abs(zc) < r.h / 2 - 40) q(x, zc, 60, 6, '#e8e4d8');
};

// ---- façades ------------------------------------------------------------------------------------------
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

/** The façade heights: Harrow's is lower (roof 240), the atrium's glass wall rises to the vault. */
function mallTop(x, y) {
  if (x > 7190 && y > 1790) return 256;
  if (x < 2610 && y > VAULT.y0 - 10 && y < VAULT.y1 + 10) return 446;
  return 346;
}
function garageTop(x, y) { return x > 9590 && y < 1210 ? 150 : 138; }

/** Run `draw(a, b, h)` over the spans of t0..t1 where the height fn (at the world point) is constant. */
function heightSpans(P, t0, t1, fn, draw) {
  const n = Math.max(1, Math.round((t1 - t0) / 50));
  let a = t0, hp = null;
  for (let i = 0; i < n; i++) {
    const tm = t0 + ((i + 0.5) * (t1 - t0)) / n;
    const [wx, wy] = P.toWorld(P.o, tm, 0);
    const h = fn(wx, wy);
    if (hp !== null && h !== hp) { const t = t0 + (i * (t1 - t0)) / n; draw(a, t, hp); a = t; }
    hp = h;
  }
  draw(a, t1, hp);
}

const CLAD = '#d6cdbd', CLAD_D = '#b8ae9c', GRAN = '#3a3836', TERRA = '#9a4a32';

/** The mall's precast skin: granite plinth, cladding with joints, the terracotta band, the upper band, coping, signs. */
function mallFace(P, s, t0, t1, holes, top) {
  const { B, o } = P;
  const C = S(DET.concrete, 0.8, 0);
  const z = s * o.h / 2;
  band(B, o, s, t0, t1, 0, 12, GRAN, S(DET.terrazzo, 0.4, 0), holes);
  const tall = top > 400;
  const bandY = tall ? 232 : 150;
  band(B, o, s, t0, t1, 12, bandY, CLAD, C, holes);
  band(B, o, s, t0, t1, bandY, bandY + 18, TERRA, S(DET.tile, 0.5, 0), holes);
  band(B, o, s, t0, t1, bandY + 18, top - 40, CLAD, C, holes);
  band(B, o, s, t0, t1, top - 40, top - 6, CLAD_D, C, holes);
  B.box('std', (t0 + t1) / 2, top - 3, z + s * 0.8, t1 - t0, 6, 3, '#6d7275', null, STEEL);
  // panel joints: vertical reveals every 180 (off the windows)
  if (P.lod() >= 1) {
    for (let t = Math.ceil(t0 / 180) * 180; t < t1; t += 180) {
      if (holes.some((hl) => Math.abs(hl.t - t) < hl.w / 2 + 3)) continue;
      B.box('std', t, (12 + bandY) / 2, z + s * 0.3, 1.2, bandY - 12, 0.8, CLAD_D, null, C);
    }
    for (let t = t0 + 350; t < t1 - 100; t += 700) B.cyl('std', t, 0, z + s * 3, 2.4, top - 8, '#5b6065', 8, 1, null, STEEL);
  }
  // a sign in the middle of a long run: which one depends on where it faces
  if (t1 - t0 > 1000) {
    const tm = (t0 + t1) / 2;
    const [wx, wy] = P.toWorld(o, tm, 0), [nx, ny] = P.toWorld(o, tm, s);
    const dx = nx - wx, dy = ny - wy;
    let cell = null, y = top - 80, w = 520, h = 90;
    if (dy > 0.5 && wx < 7200) { cell = 'wg_logo'; }
    else if (dy > 0.5 || dx > 0.5) { cell = 'wg_harrows'; y = top - 70; w = 380; h = 84; }
    else if (dy < -0.5 && wx < 7200 && wx > 5000) { cell = 'wg_foodcourt'; y = top - 76; w = 380; h = 72; }
    if (cell) P.pic(B, cell, tm, y, z + s * 1.2, w, h, s > 0 ? 0 : Math.PI, { lit: !P.day, k: 1.1 });
  }
}

/** The garage's open-deck skin: spandrels, dark openings with cables, pilasters; on deck B, a parapet. */
function garageFace(P, s, t0, t1, top) {
  const { B, o } = P;
  const z = s * o.h / 2;
  const C = S(DET.concrete, 0.85, 0);
  const [wx, wy] = P.toWorld(o, (t0 + t1) / 2, s * (o.h / 2 + 20));
  if (wx > 9600 && wy < 1200 && wy > 60) {
    // the deck's parapet (the lower part is in the deck)
    band(B, o, s, t0, t1, 100, top, '#a8a498', C);
    B.box('std', (t0 + t1) / 2, top - 2, z + s * 0.2, t1 - t0, 4, 3, '#d8b01a', null, PAINT);
    return;
  }
  band(B, o, s, t0, t1, 0, 30, '#b8b4aa', C);
  band(B, o, s, t0, t1, 96, top, '#b8b4aa', C);
  band(B, o, s, t0, t1, 30, 96, '#141414', S(0, 1, 0), [], 0.02);
  for (const y of [48, 62, 76]) B.cylX('std', (t0 + t1) / 2, y, z + s * 2, 0.5, t1 - t0, '#8a9096', 6, STEEL);
  for (let t = Math.ceil(t0 / 320) * 320; t < t1; t += 320) B.box('std', t, top / 2, z + s * 2, 20, top, 4, '#c8c4ba', null, C);
  if (P.lod() >= 1) for (let t = t0 + 400; t < t1 - 200; t += 900) P.decal(B, 'wstain', t, 20, z + s * 0.2, 40, 36, s > 0 ? 0 : Math.PI);
}

/** The dock office's steel cladding. */
function officeFace(P, s, t0, t1, holes, top) {
  const { B, o } = P;
  band(B, o, s, t0, t1, 0, top - 10, '#8a9aa0', S(DET.corrugated, 0.5, 0.5), holes);
  band(B, o, s, t0, t1, top - 10, top, '#e8e4dc', PAINT, holes);
}

function facade(P, s, t0, t1, holes, top) {
  const { o } = P;
  switch (o.style) {
    case 'mall-ext': heightSpans(P, t0, t1, mallTop, (a, b, h) => mallFace(P, s, a, b, holes, h)); break;
    case 'garage-ext': heightSpans(P, t0, t1, garageTop, (a, b, h) => garageFace(P, s, a, b, h)); break;
    case 'office-ext': officeFace(P, s, t0, t1, holes, 130); break;
    default: band(P.B, o, s, t0, t1, 0, top, (WALLS[o.style] && WALLS[o.style].face) || '#bdb8ac', S(DET.concrete, 0.9, 0), holes);
  }
}

const WALLS = {
  mall: { face: '#d8d2c4' },
  'mall-ext': { face: CLAD, facadeTop: mallTop },
  'mall-shop': { face: '#2a2c30' },
  kitchen: { face: '#e8e8e2' },
  'garage-ext': { face: '#b8b4aa', facadeTop: garageTop },
  'garage-int': { face: '#a8a498' },
  'office-ext': { face: '#8a9aa0', facadeTop: 130 },
};

// ---- ceilings ------------------------------------------------------------------------------------------
/** Per build: the glass the ceilings leave for finish() (see-through, casting no shadow). */
function ceilingsFor(state) {
  const glass = state.glass;
  /** A glass quad in world space (both faces). */
  const pane = (c, e1, e2) => glass.push({ c, e1, e2 });
  return {
    /** The atrium: a glass barrel vault on steel ribs over plaster rims, the gables in white panels. */
    vault(C) {
      const { B, r, H } = C;
      const w = r.w, d = r.h, rise = VAULT.rise, segs = 12, bays = VAULT.bays;
      const prof = (k) => { const t = -1 + (2 * k) / segs; return [(t * d) / 2, H + rise * (1 - t * t)]; };
      const W = '#e8e4dc';
      // the rims (north over the gallery, south over the mezzanine) and the ring beam
      for (const e of [-1, 1]) {
        B.quad('std', [0, (290 + H) / 2, e * d / 2], [-e * w, 0, 0], [0, H - 290, 0], '#e8e2d6', PLASTER);
        B.box('std', 0, 300, e * (d / 2 - 3), w, 6, 6, '#c8c2b4', null, PLASTER);
        B.quad('std', [0, (330 + H + 14) / 2, e * (d / 2 + 12)], [e * w, 0, 0], [0, H + 14 - 330, 0], CLAD, CONC);
        B.quad('std', [0, H + 14, e * (d / 2 + 6)], [w, 0, 0], [0, 0, -e * 12 * -1], '#8a8680', CONC);
        B.box('std', 0, H + 5, e * (d / 2 - 7), w, 12, 14, W, null, PAINT);
        B.box('std', e * (w / 2 - 7), H + 5, 0, 14, 12, d, W, null, PAINT);
      }
      // the east side above the food court's roof (the wall's own face stops at the food court's ceiling)
      B.quad('std', [w / 2 + 28.5, (300 + H + 14) / 2, 0], [0, 0, -d], [0, H + 14 - 300, 0], CLAD, CONC);
      // ribs across, purlins along
      for (let i = 0; i <= bays; i++) {
        const x = -w / 2 + (i * w) / bays;
        for (let k = 0; k < segs; k++) {
          const [za, ya] = prof(k), [zb, yb] = prof(k + 1);
          const len = Math.hypot(zb - za, yb - ya);
          B.box('std', x, (ya + yb) / 2, (za + zb) / 2, 8, 10, len + 1, W, [Math.atan2(-(yb - ya), zb - za), 0, 0], PAINT);
        }
      }
      for (let k = 1; k < segs; k++) {
        const [zk, yk] = prof(k);
        B.box('std', 0, yk - 1, zk, w, 3, 3, W, null, PAINT);
      }
      // the glass between them (in world space)
      for (let i = 0; i < bays; i++) {
        const xa = -w / 2 + (i * w) / bays, bw = w / bays;
        for (let k = 0; k < segs; k++) {
          const [za, ya] = prof(k), [zb, yb] = prof(k + 1);
          pane([r.x + xa + bw / 2, (ya + yb) / 2 + 3, r.y + (za + zb) / 2], [-bw + 4, 0, 0], [0, yb - ya, zb - za]);
        }
      }
      // the gables: glazed under the arch at both ends, a mullion at every node
      for (const e of [-1, 1]) {
        const x = e * w / 2, wx = r.x + x;
        for (let k = 0; k < segs; k++) {
          const [za, ya] = prof(k), [zb, yb] = prof(k + 1);
          const lo = Math.min(ya, yb);
          pane([wx, (H + lo) / 2, r.y + (za + zb) / 2], [0, 0, zb - za], [0, lo - H, 0]);
          if (yb > ya) state.gtris.push({ p: [wx, ya, r.y + za], s: [zb - za, yb - ya, 1], r: [0, -HALF, 0] });
          else state.gtris.push({ p: [wx, yb, r.y + zb], s: [zb - za, ya - yb, 1], r: [0, HALF, 0] });
          if (k > 0) B.box('std', x, (H + ya) / 2, za, 4, ya - H, 4, W, null, PAINT);
        }
        B.box('std', x, H + rise * 0.5, 0, 4, 3, d, W, null, PAINT);
      }
    },
    /** The food court: a plaster ceiling with lantern skylights (wells up to the roof, glass lanterns on it). */
    skylights(C) {
      const { B, r, H, fin } = C;
      const rect = { x0: r.x - r.w / 2, y0: r.y - r.h / 2, x1: r.x + r.w / 2, y1: r.y + r.h / 2 };
      const holes = SKYLIGHTS.filter((h) => h.x0 >= rect.x0 && h.x1 <= rect.x1 && h.y0 >= rect.y0 && h.y1 <= rect.y1);
      for (const q of rectMinus(rect, holes)) {
        B.quad('std', [(q.x0 + q.x1) / 2 - r.x, H, (q.y0 + q.y1) / 2 - r.y], [q.x1 - q.x0, 0, 0], [0, 0, q.y1 - q.y0], fin.ceil, { noAO: true, surf: [DET.plaster, 0.85, 0] });
      }
      const RH = 330, LH = 346, RIDGE = 52;
      for (const h of holes) {
        const x0 = h.x0 - r.x, x1 = h.x1 - r.x, z0 = h.y0 - r.y, z1 = h.y1 - r.y, xc = (x0 + x1) / 2, zc = (z0 + z1) / 2;
        const wdt = x1 - x0, dep = z1 - z0;
        // the well's faces (facing in), the curb on the roof
        B.quad('std', [xc, (H + LH) / 2, z0], [wdt, 0, 0], [0, LH - H, 0], '#e8e4dc', PLASTER);
        B.quad('std', [xc, (H + LH) / 2, z1], [-wdt, 0, 0], [0, LH - H, 0], '#e8e4dc', PLASTER);
        B.quad('std', [x0, (H + LH) / 2, zc], [0, 0, -dep], [0, LH - H, 0], '#e8e4dc', PLASTER);
        B.quad('std', [x1, (H + LH) / 2, zc], [0, 0, dep], [0, LH - H, 0], '#e8e4dc', PLASTER);
        for (const [cx, cz, sx, sz] of [[xc, z0 - 4, wdt + 16, 8], [xc, z1 + 4, wdt + 16, 8], [x0 - 4, zc, 8, dep], [x1 + 4, zc, 8, dep]]) B.block('std', cx, RH, cz, sx, LH - RH, sz, '#8a9096', null, STEEL);
        // the lantern: a steel ridge and glazing bars, the glass
        B.box('std', xc, LH + RIDGE, zc, wdt, 4, 4, '#5a6066', null, STEEL);
        for (let x = x0; x <= x1 + 0.1; x += wdt / 5) {
          for (const e of [-1, 1]) {
            const za = e < 0 ? z0 : z1;
            B.add('std', T.box(), [x, LH + RIDGE / 2, (za + zc) / 2], [2.4, 2.4, Math.hypot(dep / 2, RIDGE)], [e * Math.atan2(RIDGE, dep / 2), 0, 0], '#5a6066', STEEL);
          }
        }
        const wx = r.x, wz = r.y;
        pane([wx + xc, LH + RIDGE / 2, wz + (z0 + zc) / 2], [-wdt, 0, 0], [0, RIDGE, dep / 2]);
        pane([wx + xc, LH + RIDGE / 2, wz + (z1 + zc) / 2], [wdt, 0, 0], [0, RIDGE, -dep / 2]);
        state.tris.push({ x: wx + x0, z0: wz + z0, z1: wz + z1, y: LH, H: RIDGE }, { x: wx + x1, z0: wz + z0, z1: wz + z1, y: LH, H: RIDGE });
      }
    },
    /** A concrete slab: beams across, a sprinkler main and a cable tray along. */
    slab(C) {
      const { B, r, H, fin } = C;
      B.quad('std', [0, H, 0], [r.w, 0, 0], [0, 0, r.h], fin.ceil, { noAO: true, surf: [DET.slab, 0.9, 0] });
      const along = r.w >= r.h;
      const len = along ? r.w : r.h, wid = along ? r.h : r.w;
      const nb = Math.max(1, Math.floor(len / 320));
      for (let i = 1; i < nb; i++) {
        const t = -len / 2 + (i * len) / nb;
        if (along) B.box('std', t, H - 7, 0, 14, 14, r.h, shadeHex(fin.ceil, -0.08), null, CONC);
        else B.box('std', 0, H - 7, t, r.w, 14, 14, shadeHex(fin.ceil, -0.08), null, CONC);
      }
      if (C.lod() >= 1) {
        const off = wid * 0.3;
        if (along) {
          B.cylX('std', 0, H - 4, off, 1.8, r.w, '#b8433a', 8, S(0, 0.5, 0.3));
          B.box('std', 0, H - 3, -off, r.w, 1.2, 14, '#6d7276', null, STEEL);
        } else {
          B.cylZ('std', off, H - 4, 0, 1.8, r.h, '#b8433a', 8, S(0, 0.5, 0.3));
          B.box('std', -off, H - 3, 0, 14, 1.2, r.h, '#6d7276', null, STEEL);
        }
      }
    },
  };
}

/** A fixture of the kit's per-section set (`C.lit` / `C.color` from the map lights). */
function fixture(C) {
  const { B, H, fx, lit, color, wx, wy } = C;
  const glowC = color ? mixHex(color, '#ffffff', 0.35) : null;
  // (none in the skylight wells)
  if (SKYLIGHTS.some((h) => wx > h.x0 - 30 && wx < h.x1 + 30 && wy > h.y0 - 30 && wy < h.y1 + 30)) return;
  switch (fx.kind) {
    case 'down': {
      B.cyl('std', 0, H - 0.8, 0, 7, 0.8, '#d8d4cc', 14, 1, null, S(0, 0.4, 0.5));
      if (lit) C.glow(B, 0, H - 1.2, 0, 9, 0.4, 9, glowC, 2.4); else B.cyl('std', 0, H - 1.2, 0, 5, 0.4, '#8a8d8e', 12, 1, null, S(0, 0.3, 0));
      break;
    }
    case 'tube': {
      const y = H - 6;
      B.box('std', 0, y + 1.6, 0, 72, 2.4, 5, '#c9cbc8', null, S(0, 0.5, 0.4));
      for (const e of [-1, 1]) B.cyl('std', e * 26, y + 2.5, 0, 0.3, 8, '#555', 4);
      if (lit) C.glow(B, 0, y, 0, 66, 1.6, 1.6, glowC, 3.2); else B.cylX('std', 0, y, 0, 0.9, 66, '#b8bcbc', 6, S(0, 0.3, 0));
      break;
    }
    case 'sodium': {
      // a caged batten under the slab
      const y = H - 10;
      B.box('std', 0, y + 2, 0, 60, 3, 8, '#5a6066', null, STEEL);
      for (let x = -24; x <= 24; x += 12) B.box('std', x, y - 1, 0, 0.6, 5, 9, '#3a3d40', null, STEEL);
      if (lit) C.glow(B, 0, y - 0.5, 0, 52, 2, 3, glowC, 3); else B.box('std', 0, y - 0.5, 0, 52, 2, 3, '#6a5a3a', null, PLAST);
      break;
    }
    case 'pendant': {
      // a drum pendant on a cable
      const y = H - 40;
      B.cyl('std', 0, y + 10, 0, 0.3, 30, '#1a1a1a', 4);
      B.cyl('std', 0, y, 0, 16, 10, '#2a3a3a', 16, 0.8, null, PAINT);
      if (lit) C.glow(B, 0, y - 0.3, 0, 22, 0.4, 22, glowC, 2.4); else B.cyl('std', 0, y - 0.4, 0, 12, 0.4, '#8a8d8e', 12, 1, null, S(0, 0.3, 0));
      break;
    }
    default: {
      const w = 60, d = 26;
      B.box('std', 0, H - 0.6, 0, w + 3, 1.2, d + 3, '#c9c9c4', null, S(0, 0.4, 0.5));
      if (lit) C.glow(B, 0, H - 1.3, 0, w, 0.4, d, glowC, 2.4); else B.box('std', 0, H - 1.3, 0, w, 0.4, d, '#9ea1a2', null, S(DET.plastic, 0.4, 0));
    }
  }
}

// ---- things on the walls ------------------------------------------------------------------------------
function wallProp(W) {
  const { B, s, t, z, ry, base, h, kind, seed } = W;
  const out = (d) => z + s * d;
  switch (kind) {
    case 'poster': W.pic(B, ['wg_poster1', 'wg_poster2', 'wg_poster3', 'wg_movie', 'wg_sale'][seed % 5], t, base + 62, out(0.4), 30, 45, ry); break;
    case 'missing': for (let k = 0; k < 4; k++) W.pic(B, 'wg_missing', t - 18 + k * 12, base + 54 + (k % 2) * 8, out(0.4 + k * 0.04), 11, 14, ry, { rz: (hash01(seed + k) - 0.5) * 0.3 }); break;
    case 'notice': W.pic(B, 'wg_notice', t, base + 60, out(0.4), 24, 19, ry); break;
    case 'ext': {
      B.rblock('std', t, base + 22, out(3.4), 8, 20, 6, 3, '#c62828', null, PAINT);
      B.box('std', t, base + 43.5, out(3.4), 3, 3, 3, '#1a1a1a', null, STEEL);
      break;
    }
    case 'bin': {
      B.cyl('std', t, base, out(12), 9, 30, '#b8bcc0', 14, 0.95, null, CHROME);
      B.add('std', T.sphere(12, 6), [t, base + 30, out(12)], [9.4, 5, 9.4], null, '#8a9096', CHROME);
      break;
    }
    case 'blood': W.decal(B, seed % 2 ? 'blood_hand' : 'blood_drip', t, base + 50, out(0.5), 34, 44, ry); break;
    case 'graffiti': W.decal(B, ['g_help', 'g_dead', 'g_noentry', 'g_tally', 'g_alive', 'g_looters'][seed % 6], t, base + 56, out(0.45), 80, 30, ry); break;
    case 'bench': {
      const r = [0, ry, 0];
      for (const e of [-1, 1]) B.rblock('std', t + e * 36, base, out(14), 4, 17, 22, 0.6, '#3a3d40', r, STEEL);
      B.rblock('std', t, base + 17, out(14), 90, 2.4, 24, 0.6, '#8a6a44', r, WOODS);
      break;
    }
    case 'plant': {
      B.rblock('std', t, base, out(16), 26, 22, 26, 2, '#b8b0a2', null, S(DET.terrazzo, 0.3, 0));
      for (let k = 0; k < 5; k++) B.add('std', T.ico(1), [t + (hash01(seed + k) - 0.5) * 12, base + 28 + k * 3, out(16 + (hash01(seed * 3 + k) - 0.5) * 10)], [9, 8, 9], null, ['#4a5a2a', '#6a5a2a', '#5a4a2a'][k % 3], S(DET.fabric, 0.9, 0));
      break;
    }
    case 'vent': W.pic(B, 'wg_vent', t, base + 90, out(0.4), 22, 22, ry); break;
    case 'panel': B.rblock('std', t, base + 60, out(2), 18, 26, 4, 0.6, '#8a9096', null, S(DET.panel, 0.5, 0.5)); W.pic(B, 'wg_hazard', t, base + 78, out(4.2), 8, 8, ry); break;
    case 'clock': B.cyl('std', t, base + 96, out(0.3), 6.2, 0.8, '#2a2c2e', 14, 1, [HALF, 0, 0], PLAST); break;
    case 'mirror': B.box('std', t, base + 50, out(0.8), 30, 80, 1, '#c8d0d4', [0, ry, 0], S(0, 0.05, 0.95)); break;
    case 'exit': {
      if (h < 100) break;
      B.rbox('std', t, base + h - 14, out(2), 26, 11, 4, 0.8, '#e8e8e4', null, PLAST);
      W.pic(B, 'wg_exit', t, base + h - 14, out(4.1), 22, 8, ry, { lit: true, k: 1.6 });
      break;
    }
    case 'garagesign': W.pic(B, seed % 2 ? 'wg_height' : 'wg_parking', t, base + 80, out(0.5), 60, 14, ry); break;
    default: break;
  }
}

// ---- gates: the closed leaves (E animates them, JOURNEY §4.1) ------------------------------------------
const GATE_H = { mall_doors: 94, food_shutter: 128, store_shutter: 128, garage_door: 88, dock_gate: 118 };

function gate(P) {
  const { B, o } = P;
  const L = o.w, H = GATE_H[o.gate] || 90;
  if (o.gateKind === 'shutter') {
    // a security grille: bars you can see through, a bottom rail, the guides, the coil box
    const n = Math.max(1, Math.round(L / 40)), m = Math.max(1, Math.round(H / 40));
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      const x = -L / 2 + (i + 0.5) * (L / n), y = (j + 0.5) * (H / m);
      P.pic(B, 'wg_grille', x, y, 0.6, L / n, H / m, 0);
      P.pic(B, 'wg_grille', x, y, -0.6, L / n, H / m, Math.PI);
    }
    B.box('std', 0, 2, 0, L, 4, 4, '#3a3e42', null, STEEL);
    B.box('std', 0, H + 8, 0, L + 8, 16, 14, '#5a6066', null, STEEL);
    for (const e of [-1, 1]) B.box('std', e * (L / 2 - 1), H / 2, 0, 3, H, 6, '#4a4e52', null, STEEL);
    P.decal(B, 'g_noentry', L * 0.15, H * 0.55, 1.4, 70, 26, 0);
    return;
  }
  if (o.gate === 'mall_doors') {
    // a glass door: a bronze frame, the glass, a push bar
    const fr = '#3a3026';
    for (const e of [-1, 1]) B.box('std', e * (L / 2 - 2), H / 2, 0, 4, H, 4, fr, null, STEEL);
    B.box('std', 0, H - 2, 0, L, 4, 4, fr, null, STEEL);
    B.box('std', 0, 4, 0, L, 8, 4, fr, null, STEEL);
    for (const f of [1, -1]) B.add('vglass', T.plane(), [0, H / 2 + 2, f * 0.4], [L - 8, H - 12, 1], f > 0 ? null : [0, Math.PI, 0], '#9fb0b8', { noAO: true, noJitter: true });
    for (const f of [1, -1]) B.box('std', 0, H * 0.45, f * 3.4, L - 14, 2, 2, '#c9ced3', null, CHROME);
    P.decal(B, 'blood_hand', -L * 0.2, H * 0.5, 2.3, 20, 20, 0);
    return;
  }
  // a steel door: the leaf, wired glass, a panic bar
  B.rblock('std', 0, 1, 0, L - 1, H - 2, 3.6, 0.6, '#6a7a8a', null, PAINT);
  B.box('glass', L * 0.1, H * 0.7, 0, L * 0.3, H * 0.24, 3.8, '#1c262e', null, S(DET.glass, 0.1, 0.3));
  B.box('std', 0, H * 0.44, 0, L - 10, 2.4, 6.5, '#c9ced3', null, CHROME);
  B.box('std', 0, 4, 0, L - 4, 7, 3.9, '#a3a8ac', null, CHROME);
}

// ---- the switchable lamps -------------------------------------------------------------------------------
function lampsOf(L, map) {
  const items = map.levelArt || [];
  // the atrium's pendant globes, hung from the vault's crown
  const B = L.builderFor('atrium', false);
  for (let i = 0; i < 6; i++) {
    const x = VAULT.x0 + ((i + 0.5) * (VAULT.x1 - VAULT.x0)) / 6, y = (VAULT.y0 + VAULT.y1) / 2 + (i % 2 ? 260 : -260);
    L.at(B, x, y, 0, 21 + i, 0);
    const hy = 320;
    rod(B, 'std', [0, hy + 18, 0], [0, VAULT.base + VAULT.rise * 0.9, 0], 0.4, '#2a2c2e', STEEL, 4);
    B.cyl('std', 0, hy + 12, 0, 6, 8, '#3a3d40', 10, 0.6, null, STEEL);
    if (hash01(i * 7 + 1) < 0.5) {
      B.add('glow', T.sphere(12, 8), [0, hy, 0], [15, 15, 15], null, '#fff0d0', { emissive: 2.4, noAO: true, noJitter: true });
      L.halo(x, y, hy, '#ffe8c0', 140, 0.45);
    } else B.add('std', T.sphere(12, 8), [0, hy, 0], [15, 15, 15], null, '#d8d4c8', PLAST);
  }
  // the stage's par cans (one still on, stuttering), the truss
  for (const it of items.filter((q) => q.t === 'stagetruss')) {
    const Bf = L.builderFor('foodcourt', true);
    L.at(Bf, it.x, it.y, 0, 23, 0);
    for (const [k, c] of [[1, '#ff5ab0'], [4, '#5ab8ff']]) {
      const x = -it.w / 2 + 60 + (k * (it.w - 120)) / 5;
      Bf.add('glow', T.cyl(10), [x, 190 - 26, -it.d / 2 + 16], [4.4, 0.6, 4.4], [0.5, 0, 0], c, { emissive: 3, noAO: true, noJitter: true });
      L.halo(it.x + x, it.y - it.d / 2 + 20, 162, c, 70, 0.6, 0.4);
    }
  }
  // deck B's pole lamps (half of them work)
  for (const o of map.obstacles) {
    if (o.style !== 'garage-col' || (o.top || 0) <= 150) continue;
    if (hash01(o.id * 3) < 0.5) continue;
    const Bg = L.builderFor('garage', false);
    L.at(Bg, o.x, o.y, 0, 25 + o.id, L.gy(o.x, o.y));
    for (const e of [-1, 1]) Bg.add('glow', T.box(), [e * 28, 171.6, 0], [12, 0.6, 6], null, '#ffe8c8', { emissive: 3, noAO: true, noJitter: true });
    L.halo(o.x, o.y, L.gy(o.x, o.y) + 170, '#ffe0b0', 90, 0.45);
  }
  // the dock bays' lamps
  for (const it of items.filter((q) => q.t === 'dockbay')) {
    const Bd = L.builderFor('dock', false);
    L.at(Bd, it.x, it.y, 0, 27, 0);
    Bd.add('glow', T.sphere(8, 6), [32, 138, it.w / 2 + 8], [4, 2, 4], null, '#ffd8a0', { emissive: 3, noAO: true, noJitter: true });
    L.halo(it.x + 32, it.y + it.w / 2 + 8, 136, '#ffd8a0', 70, 0.5);
  }
}

// ---- the water: the flood over the car park, the fountain (a mirror of the sky, dark and still) ---------
export function buildWater(P, waters, day) {
  if (!waters.length) return null;
  const pos = [], col = [], uvs = [], idx = [];
  let vi = 0;
  const vert = (x, y, z, a) => { pos.push(x, y, z); col.push(1, 1, 1, a); uvs.push(x / 300, z / 300); return vi++; };
  for (const w of waters) {
    const n = 36;
    const c = vert(w.x, w.h, w.y, 1);
    const inner = [], outer = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      if (w.kind === 'rect') {
        // a basin between walls: the corners (a fan from the centre)
        if (k % 9) continue;
        const q = k / 9;
        inner.push(vert(w.x + (q === 1 || q === 2 ? 1 : -1) * w.w / 2, w.h, w.y + (q >= 2 ? 1 : -1) * w.d / 2, 1));
      } else if (w.kind === 'fountain') {
        inner.push(vert(w.x + Math.cos(a) * w.r, w.h, w.y + Math.sin(a) * w.r, 1));
      } else {
        // an irregular pool: lobes from a few sines, feathered out at the rim
        const s = w.seed || 1;
        const k1 = 1 + 0.16 * Math.sin(a * 3 + s) + 0.1 * Math.sin(a * 5 + s * 1.7) + 0.06 * Math.sin(a * 9 + s * 0.3);
        const rx = (w.w / 2) * 0.82 * k1, rz = (w.d / 2) * 0.82 * k1;
        inner.push(vert(w.x + Math.cos(a) * rx, w.h, w.y + Math.sin(a) * rz, 0.92));
        outer.push(vert(w.x + Math.cos(a) * rx * 1.22, w.h, w.y + Math.sin(a) * rz * 1.22, 0));
      }
    }
    const m = inner.length;
    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      idx.push(c, inner[k2], inner[k]);
      if (outer.length) idx.push(inner[k], inner[k2], outer[k2], inner[k], outer[k2], outer[k]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  const nrm = makeWaterNormal();
  nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping;
  const mat = new THREE.MeshStandardMaterial({
    color: day ? '#2a3a3a' : '#05090b', roughness: 0.05, metalness: 0.1, normalMap: nrm, normalScale: new THREE.Vector2(0.18, 0.18),
    envMapIntensity: day ? 1.0 : 0.5, transparent: true, depthWrite: false, vertexColors: true,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'lv-water';
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  P.root.add(mesh);
  return { mesh, nrm, dispose() { P.root.remove(mesh); g.dispose(); mat.dispose(); nrm.dispose(); } };
}

/** The vault's and the lanterns' glass (see-through, no shadow: the sun comes in). */
export function buildGlass(P, state) {
  if (!state.glass.length && !state.tris.length && !state.gtris.length) return;
  const b = P.newBuilder();
  P.at(b, 0, 0, 0, 1, 0);
  const c = P.day ? '#a8bcc8' : '#3a4a54';
  for (const q of state.glass) {
    b.quad('vglass', q.c, q.e1, q.e2, c, { noAO: true, noJitter: true });
    b.quad('vglass', q.c, q.e1.map((v) => -v), q.e2, c, { noAO: true, noJitter: true });
  }
  // the vault's gable triangles, the lanterns' gable ends (two right triangles each)
  for (const t of state.gtris) b.add('vglass', RTRI(), t.p, t.s, t.r, c, { noAO: true, noJitter: true });
  for (const t of state.tris) {
    const zc = (t.z0 + t.z1) / 2, half = (t.z1 - t.z0) / 2;
    b.add('vglass', RTRI(), [t.x, t.y, t.z0], [half, t.H, 1], [0, -HALF, 0], c, { noAO: true, noJitter: true });
    b.add('vglass', RTRI(), [t.x, t.y, t.z1], [half, t.H, 1], [0, HALF, 0], c, { noAO: true, noJitter: true });
    void zc;
  }
  for (const { bucket, geometry } of b.finish()) {
    const mesh = new THREE.Mesh(geometry, P.matOf(bucket, P.tier));
    mesh.matrixAutoUpdate = false;
    mesh.name = 'lv-roofglass';
    mesh.userData.bucket = bucket;
    P.root.add(mesh);
    P.extraMeshes.push(mesh);
  }
}

// ---- the town round the mall ----------------------------------------------------------------------------
const MALL_SKY = [
  { axis: 'x', from: -800, to: 12400, at: -1100, depth: -900, h: [160, 420] },
  { axis: 'y', from: -600, to: 5000, at: 12600, depth: 900, h: [140, 360] },
];

/** Signs the layout implies: the shops' fascias on the arcade, the department names, EXIT boxes. */
function signs(P) {
  const { B } = P;
  const put = (x, y, ry, cell, w, h, hy, o = {}) => { P.at(B, x, y, 0, 31, o.base || 0); P.pic(B, cell, 0, hy, 0, w, h, ry, o); };
  // the arcade's two open shops (their fronts are the wall with the windows)
  for (const [x, cell] of [[3058, 'f_phone'], [4200, 'f_clothes']]) {
    P.at(B, x, 3300 - 8, 0, 33, 0);
    B.block('std', 0, 112, -1.5, 380, 28, 3, '#1a1c20', null, PAINT);
    P.pic(B, cell, 0, 126, -3.2, 300, 22, Math.PI, { lit: !P.day, k: 0.7 });
  }
  put(4988 - 0.6, 2300, -HALF, 'wg_foodcourt', 180, 34, 176);
  // the food court's north wall over the stalls: a bulkhead of panels, FOOD COURT, neon stars
  P.at(B, 6100, 1308, 0, 37, 0);
  B.block('std', 0, 150, 2, 2176, 70, 4, '#2a3a4a', null, PAINT);
  B.block('std', 0, 146, 4, 2176, 4, 6, '#b89a5a', null, S(0, 0.3, 0.8));
  B.block('std', 0, 220, 4, 2176, 4, 6, '#b89a5a', null, S(0, 0.3, 0.8));
  P.pic(B, 'wg_foodcourt', 0, 185, 4.3, 420, 64, 0, { lit: !P.day, k: 0.9 });
  for (const x of [-700, 700]) P.pic(B, 'n_star', x, 185, 4.3, 60, 60, 0, { lit: !P.day, k: 1.6, color: x < 0 ? '#ff5ab0' : '#5ab8ff' });
  for (let x = -1000; x <= 1000; x += 250) B.box('std', x, 260, 1, 6, 80, 2, '#c8c2b4', null, PLASTER);
  put(7188 - 0.6, 2750, -HALF, 'wg_harrows', 200, 44, 176, { lit: !P.day, k: 0.9 });
  put(8600, 1812.6, 0, 'wg_parking', 90, 22, 108);
  put(3620, 1248.6, 0, 'wg_security', 80, 20, 100, { base: 150 });
  put(3450, 1248.6, 0, 'wg_level2', 26, 26, 100, { base: 150 });
  put(2800, 1519, 0, 'wg_level1', 26, 26, 150);
  put(9312.6, 2450, HALF, 'wg_staff', 60, 20, 104);
  put(10800, 1788, Math.PI, 'wg_dock', 90, 22, 140);
  put(9900, 1812.6, 0, 'wg_nopark', 60, 20, 90);
  // EXIT boxes over the ways out
  for (const [x, y, ry, hy] of [[2612.5, 2230, HALF, 106], [11250, 1788, Math.PI, 132], [7212.5, 2750, HALF, 140]]) {
    P.at(B, x, y, 0, 35, 0);
    const [dx, dz] = [Math.sin(ry) * 3, Math.cos(ry) * 3];
    B.rbox('std', dx, hy, dz, ry === HALF ? 4 : 26, 11, ry === HALF ? 26 : 4, 0.8, '#e8e8e4', null, PLAST);
    P.pic(B, 'wg_exit', dx * 1.7, hy, dz * 1.7, 22, 8, ry, { lit: true, k: 1.6 });
  }
}

/**
 * @param {object} ctx renderer ctx (ctx.map is the built level)
 * @param {object} deps { root, mats, fx, halos, shafts, day, aniso, gy, tier, full, newBuilder(), matOf(bucket, tier) }
 */
export function createLevelArt(ctx, deps) {
  const map = ctx.map;
  const state = { waters: [], glass: [], tris: [], gtris: [] };
  const { OBSTACLES, ITEMS } = mallProps(state);
  let sky = null, water = null;
  const bays = VAULT.bays, bw = (VAULT.x1 - VAULT.x0) / bays;
  const skylights = [
    ...Array.from({ length: bays }, (_, i) => ({ x0: VAULT.x0 + i * bw + 6, x1: VAULT.x0 + (i + 1) * bw - 6, y0: VAULT.y0 + 20, y1: VAULT.y1 - 20, h: VAULT.base, floor: 0, clip: VAULT, patch: 0.07, k: 0.9 })),
    ...SKYLIGHTS.map((s) => ({ ...s, h: 330, floor: 0, clip: { x0: 5012, y0: 1300, x1: 7188, y1: 3400 }, patch: 0.14 })),
  ];
  const level = {
    id: 'mall',
    atlas: mallAtlas(),
    buckets: BUCKETS,
    rooms: ROOMS,
    walls: WALLS,
    facade,
    ceilings: ceilingsFor(state),
    fixture,
    grimeCells: ['grime', 'grime2', 'wstain', 'blood_hand'],
    brokenWindows: 0.22,
    obstacles: OBSTACLES,
    items: ITEMS,
    gate,
    skylights,
    lamps: (L) => lampsOf(L, map),
    doorFrame: (it) => {
      switch (it.style) {
        case 'mall-ext': return { color: '#3a3026', surf: STEEL, jamb: 4 };
        case 'kitchen': case 'freezer': return { color: '#b8bcc0', surf: STEEL, jamb: 3 };
        case 'garage-ext': case 'garage-int': return { color: '#5a6066', surf: STEEL, jamb: 4 };
        default: return { color: '#8a8f94', surf: STEEL, jamb: 3 };
      }
    },
    leafColor: (it) => ({ secdoor: '#5a6068', kitchen: '#b8bcc0', freezer: '#e8ecec', stock: '#6a7a8a' })[it.style] || '#7d8a92',
    windowFrame: (it) => (it.style === 'mall-ext' ? { color: '#3a3026', surf: STEEL } : it.style === 'office-ext' ? { color: '#e8e4dc', surf: PAINT } : { color: '#2a2c30', surf: STEEL }),
    wallProp,
    props(P) {
      signs(P);
      // the town round it: low commercial blocks on all four sides (few draw calls: one cell a side)
      const B = P.B;
      B.setCell('wg-street-n');
      streetRow(B, -200, 12000, 0, 0, 7000, { tall: [110, 70] });
      B.setCell('wg-street-w');
      streetRow(B, -200, 4150, 0, -HALF, 7100, { tall: [100, 60] });
      if (P.lod() >= 1) {
        B.setCell('wg-street-s');
        streetRow(B, -200, 12000, 4400, Math.PI, 7200, { tall: [100, 80] });
        B.setCell('wg-street-e');
        streetRow(B, -200, 4600, 11600, HALF, 7300, { tall: [110, 60] });
      }
      B.setCell(null);
    },
    finish(P) {
      buildGlass(P, state);
      water = buildWater(P, state.waters, P.day);
      sky = skyline(P, P.root, P.day, MALL_SKY);
    },
    update(view, frame) {
      if (water) { const dt = Math.min(0.1, (frame && frame.dt) || 0.016); water.nrm.offset.x += dt * 0.004; water.nrm.offset.y += dt * 0.0025; }
    },
    dispose() { if (sky) sky.dispose(); if (water) water.dispose(); },
  };
  void CHROME; void shadeHex;
  return createInteriorArt(ctx, deps, level);
}
