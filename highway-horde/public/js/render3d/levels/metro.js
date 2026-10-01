// The 3D art of the story level "metro", Harlan Metro (JOURNEY.md §5). Owner: agent C2.
//
// The layout (shared/levels/metro.js) tags its walls and props; this module gives them their look through
// the interior kit (hospital-kit.js): the station's oxblood terracotta front on a sunlit street, its lobby
// and the glazed lantern over the stairs (the day falls down them), white subway tile with the line's blue
// band in the ticket hall, the concourse's coffered ceiling and pavement lights, the platform's tiled
// barrel vault over a dead train, the tunnels' arches, the sump's brick vault standing in water, the
// works under their trusses, the stairs up into Harlan Square; and the models of the props
// (metro-props.js) and the signs of the atlas (metro-atlas.js).
//
// The interface (render3d/levels/index.js fills in no-ops):
//   BUCKETS, createLevelArt(ctx, deps) → { obstacle, roof, props, finish, update, setQuality, dispose,
//   material, gateModel, setLights }

import { createInteriorArt, KIT_BUCKETS, T, DET, S, STEEL, CHROME, PAINT, PLAST, CONC, mixHex, hash01 } from './hospital-kit.js';
import { metroAtlas } from './metro-atlas.js';
import { metroProps, PAVEMENT } from './metro-props.js';
import { RTRI } from './mall-props.js';
import { buildWater, buildGlass } from './mall.js';
import { streetRow, skyline } from './hospital.js';
import { METRO } from '../../shared/levels/metro.js';

/** Extra geo-builder buckets of this level. */
export const BUCKETS = { ...KIT_BUCKETS };

const HALF = Math.PI / 2;
const TILE_S = S(DET.tile, 0.3, 0);

// ---- room finishes ---------------------------------------------------------------------------------
const STRIP = { kind: 'strip', step: 220, rowStep: 260, color: '#eef4ff', stray: 0.06 };
const GLOBE = { kind: 'globe', step: 200, rowStep: 260, color: '#fff0d8', stray: 0.1, halo: 60 };
const TUBE = { kind: 'tube', step: 200, rowStep: 240, color: '#e8f0ff', stray: 0.05 };
const BULK = { kind: 'bulk', step: 260, rowStep: 600, color: '#ffc27a', stray: 0.04, halo: 50 };
const CAGE = { kind: 'cage', step: 300, rowStep: 400, color: '#ffd8a0', stray: 0.05, halo: 50 };
const HIGHBAY = { kind: 'highbay', step: 380, rowStep: 400, color: '#ffc070', stray: 0.04, halo: 80 };
const DOWN = { kind: 'down', step: 120, rowStep: 140, color: '#fff0d8', stray: 0.06 };
const TROF = { kind: 'troffer', step: 160, rowStep: 200, color: '#eef4ff', stray: 0.06 };

const TILE_PROPS = ['poster', 'notice', 'exit', 'graffiti', 'blood', 'bin', 'ad', 'ad', 'map'];
const BACK_PROPS = ['panel', 'graffiti', 'blood', 'vent', 'exit', 'hv'];
const BLOODY = ['blood_trail', 'blood_pool', 'blood_splat', 'grime', 'soot'];
const TILED = { upper: '#eceae0', upperDet: DET.tile, upperRough: 0.3, lower: '#eceae0', lowerH: 70, lowerDet: DET.tile, rail: '#1d3f7a', railY: 70, railH: 7, railSurf: TILE_S, skirt: '#2a2c30', skirtH: 6 };

const ROOMS = {
  'mt-lobby': { floor: '#b8a890', floorDet: DET.terrazzo, floorRough: 0.3, upper: '#e8e2d0', upperDet: DET.plaster, lower: '#e8dcc0', lowerH: 60, lowerDet: DET.tile, rail: '#2a6a4a', railY: 60, railH: 6, railSurf: TILE_S, skirt: '#3a2a22', cornice: '#f0ece0', ceil: '#ece6d8', ceilDet: DET.plaster, ceilKind: 'plain', fixture: GLOBE, grime: 0.5, wallProps: ['poster', 'notice', 'map', 'exit', 'graffiti'], floorDecals: BLOODY, decalArea: 90000 },
  'mt-stair': { noFloor: true, ceilKind: 'none', tall: 470, ...TILED },
  'mt-servicestair': { noFloor: true, ceilKind: 'none', tall: 280, upper: '#9a9a90', upperDet: DET.brick, upperRough: 0.85 },
  'mt-foyer': { floor: '#a8a090', floorDet: DET.terrazzo, floorRough: 0.3, ...TILED, ceil: '#d8d6ce', ceilKind: 'grid', tile: 50, missing: 0.08, fixture: STRIP, grime: 0.6, grimeCells: ['grime', 'g_tag1', 'blood_hand', 'wstain'], wallProps: TILE_PROPS, floorDecals: BLOODY, decalArea: 100000 },
  'mt-concourse': { floor: '#a8a090', floorDet: DET.terrazzo, floorRough: 0.3, ...TILED, ceil: '#e0dcd0', ceilKind: 'coffer', fixture: STRIP, grime: 0.6, grimeCells: ['grime', 'g_tag2', 'blood_hand', 'wstain', 'g_help'], wallProps: TILE_PROPS, wallStep: 170, floorDecals: BLOODY, decalArea: 140000 },
  'mt-office': { floor: '#6a6e6a', floorDet: DET.linoleum, upper: '#d8d4c8', skirt: '#3a3a36', ceil: '#dcdcd4', ceilKind: 'grid', fixture: TROF, grime: 0.4, wallProps: ['notice', 'poster'], floorDecals: ['grime'] },
  'mt-cafe': { floor: '#7a5a3a', floorDet: DET.wood, floorRough: 0.5, upper: '#e8dcc8', lower: '#5a3a24', lowerH: 34, lowerDet: DET.wood, skirt: '#2a1a12', ceil: '#e8e2d4', ceilKind: 'plain', fixture: DOWN, grime: 0.4, floorDecals: ['grime', 'blood_splat'] },
  'mt-florist': { floor: '#c8c4b8', floorDet: DET.tile, floorRough: 0.3, upper: '#f0ece4', skirt: '#8a8478', ceil: '#f0ece4', ceilKind: 'plain', fixture: DOWN, grime: 0.3, floorDecals: ['mud', 'grime'] },
  'mt-void': { noFloor: true, ceilKind: 'none', upper: '#3a3a38', skirtH: 0 },
  'mt-service': { floor: '#6a6862', floorDet: DET.concrete, floorRough: 0.8, lower: '#4a6a5a', lowerH: 36, lowerDet: DET.brick, upper: '#a8a8a0', upperDet: DET.brick, skirt: '#2a2c28', ceil: '#8f8f88', ceilKind: 'slab', fixture: TUBE, grime: 0.8, grimeCells: ['grime', 'mold', 'wstain', 'g_square'], wallProps: BACK_PROPS, floorDecals: ['grime2', 'blood_trail', 'mud'], decalArea: 60000 },
  'mt-platform': { base: METRO.platform, floor: '#8a8a84', floorDet: DET.slab, floorRough: 0.6, ...TILED, ceilKind: 'open', fixture: { ...STRIP, step: 260, rowStep: 240 }, grime: 0.6, grimeCells: ['grime', 'g_tag1', 'g_tag2', 'blood_hand', 'wstain'], wallProps: ['poster', 'bin', 'exit', 'blood', 'notice'], wallStep: 200, floorDecals: BLOODY, decalArea: 120000 },
  'mt-track': { base: 0, floor: '#4a4640', floorDet: DET.gravel, floorRough: 0.95, upper: '#7a7870', upperDet: DET.concrete, lower: '#5a5852', lowerH: 40, lowerDet: DET.concrete, skirtH: 0, ceilKind: 'hall', grime: 0.8, grimeCells: ['soot', 'wstain', 'grime2', 'g_tag1'], floorDecals: ['soot', 'grime2'] },
  'mt-car': { base: METRO.platform, floor: '#3a3d40', floorDet: DET.rubber, floorRough: 0.8, upper: '#dcdcd4', upperDet: DET.panel, upperRough: 0.5, lower: '#5a6a8a', lowerH: 28, lowerDet: DET.panel, skirt: '#2a2c2e', skirtH: 3, ceil: '#e8e8e4', ceilKind: 'plain', fixture: { kind: 'tube', step: 150, rowStep: 140, color: '#eef4ff', stray: 0.1 }, grime: 0.5, grimeCells: ['g_tag1', 'g_tag2', 'blood_hand', 'grime'], floorDecals: ['blood_trail', 'blood_pool', 'grime'], decalArea: 30000 },
  'mt-tunnel': { floor: '#4a4640', floorDet: DET.gravel, floorRough: 0.95, upper: '#6a6862', upperDet: DET.concrete, lower: '#4a4842', lowerH: 30, lowerDet: DET.concrete, skirtH: 0, ceil: '#5a5852', ceilKind: 'tunnel', fixture: BULK, grime: 0.9, grimeCells: ['soot', 'wstain', 'g_tag2', 'g_quarantine', 'mold'], wallProps: ['refuge', 'hv', 'graffiti', 'blood'], wallStep: 300, floorDecals: ['soot', 'blood_trail', 'grime2'], decalArea: 120000 },
  'mt-sump': { floor: '#3a3a32', floorDet: DET.concrete, floorRough: 0.6, upper: '#7a4a3a', upperDet: DET.brick, upperRough: 0.85, lower: '#4a3a30', lowerH: 40, lowerDet: DET.brick, skirtH: 0, ceil: '#6a4034', ceilKind: 'brickvault', fixture: CAGE, grime: 0.9, grimeCells: ['mold', 'wstain', 'grime2'], floorDecals: ['mud'] },
  'mt-pump': { floor: '#6a6862', floorDet: DET.concrete, floorRough: 0.7, lower: '#2a5a7a', lowerH: 40, lowerDet: DET.brick, upper: '#b0aca0', upperDet: DET.brick, skirt: '#2a2c28', ceil: '#8f8f88', ceilKind: 'slab', fixture: TUBE, grime: 0.7, grimeCells: ['mold', 'wstain'], wallProps: ['panel', 'hv'], floorDecals: ['mud', 'grime2'] },
  'mt-works': { floor: '#6a6862', floorDet: DET.concrete, floorRough: 0.75, lower: '#3a5a4a', lowerH: 40, lowerDet: DET.brick, upper: '#a8a8a0', upperDet: DET.brick, skirt: '#2a2c28', ceil: '#6a6a64', ceilKind: 'truss', fixture: HIGHBAY, grime: 0.7, grimeCells: ['grime', 'wstain', 'soot'], wallProps: ['panel', 'hv', 'ext', 'notice', 'graffiti'], wallStep: 220, floorDecals: ['grime2', 'soot', 'blood_trail'], decalArea: 120000 },
  'mt-breaker': { floor: '#5a5e5a', floorDet: DET.linoleum, upper: '#b8b8ae', upperDet: DET.brick, skirt: '#2a2c28', ceil: '#8f8f88', ceilKind: 'slab', fixture: TUBE, grime: 0.6, wallProps: ['hv', 'panel'], floorDecals: ['grime2'] },
  'mt-liftcar': { floor: '#5c6062', floorDet: DET.corrugated, floorRough: 0.5, upper: '#8d9498', upperSurf: STEEL, skirt: '#3a3e40', ceil: '#6d7274', ceilKind: 'plain', fixture: { kind: 'cage', step: 200, rowStep: 200, color: '#ffd8a0', stray: 0.3 }, grime: 0.6, floorDecals: ['blood_pool'] },
};

// ---- façades ------------------------------------------------------------------------------------------
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

const OXBLOOD = '#7a2a22', OX_D = '#5a1e18';

/** The station's front: a granite plinth, oxblood glazed terracotta, arched heads over the windows, a cornice. */
function stationFace(P, s, t0, t1, holes) {
  const { B, o } = P;
  const [wx, wy] = P.toWorld(o, (t0 + t1) / 2, s * (o.h / 2 + 20));
  const g = P.gy(wx, wy);
  const z = s * o.h / 2;
  const T2 = S(DET.tile, 0.25, 0.05);
  band(B, o, s, t0, t1, g, g + 14, '#4a4440', S(DET.terrazzo, 0.4, 0), holes);
  band(B, o, s, t0, t1, g + 14, g + 176, OXBLOOD, T2, holes);
  band(B, o, s, t0, t1, g + 176, g + 186, '#d8ccb0', S(DET.plaster, 0.6, 0));
  band(B, o, s, t0, t1, g + 186, g + 238, OXBLOOD, T2);
  B.box('std', (t0 + t1) / 2, g + 181, z + s * 2, t1 - t0, 8, 4, '#e8dcc0', null, S(DET.plaster, 0.6, 0));
  B.box('std', (t0 + t1) / 2, g + 242, z + s * 2, t1 - t0, 8, 5, '#e8dcc0', null, S(DET.plaster, 0.6, 0));
  // pilasters every 160 between the windows, round heads over the openings
  if (P.lod() >= 1) {
    for (let t = Math.ceil((t0 + 80) / 160) * 160 - 80; t < t1; t += 160) {
      if (holes.some((hl) => Math.abs(hl.t - t) < hl.w / 2 + 4)) continue;
      B.box('std', t, g + 95, z + s * 2, 14, 162, 4, OX_D, null, T2);
    }
    for (const hl of holes) {
      if (hl.t < t0 || hl.t > t1) continue;
      B.add('std', T.cyl(14, 1, true), [hl.t, hl.y1, z + s * 1.2], [hl.w / 2 + 6, 3, hl.w / 2 + 6], [HALF, 0, 0], '#e8dcc0', S(DET.plaster, 0.6, 0));
    }
  }
}

/** The train's livery outside its car walls: silver body, the line's blue band, a red pinstripe. */
function trainFace(P, s, t0, t1, holes) {
  const { B, o } = P;
  const h = METRO.platform;
  band(B, o, s, t0, t1, h, h + 30, '#c8ccd0', STEEL, holes, 0.3);
  band(B, o, s, t0, t1, h + 30, h + 38, '#1d3f7a', PAINT, holes, 0.3);
  band(B, o, s, t0, t1, h + 38, h + 90, '#c8ccd0', STEEL, holes, 0.3);
  band(B, o, s, t0, t1, h + 90, h + 96, '#b3120e', PAINT, holes, 0.3);
}

function facade(P, s, t0, t1, holes, top) {
  const { o } = P;
  switch (o.style) {
    case 'station-ext': stationFace(P, s, t0, t1, holes); break;
    case 'train': trainFace(P, s, t0, t1, holes); break;
    default: band(P.B, o, s, t0, t1, 0, top, (WALLS[o.style] && WALLS[o.style].face) || '#8a877e', S(DET.concrete, 0.9, 0), holes);
  }
}

let gyRef = () => 0;
const WALLS = {
  'station-ext': { face: OXBLOOD, facadeTop: (x, y) => gyRef(x, y) + 246 },
  'mt-tile': { face: '#eceae0' },
  'mt-office': { face: '#d8d4c8' },
  'mt-gateframe': { face: '#8a9096' },
  'mt-shopfront': { face: '#2a2c30' },
  'mt-service': { face: '#9a9a90' },
  'mt-tunnelwall': { face: '#7a7870' },
  train: { face: '#c8ccd0', facadeTop: METRO.platform + 96 },
  'mt-brick': { face: '#7a4a3a' },
  'mt-works': { face: '#8a8a80' },
  'mt-lift': { face: '#8a9096' },
};

// ---- ceilings ------------------------------------------------------------------------------------------
/** A barrel across the short side of a room (local frame at the room's centre): spring, crown, segments. */
function barrel(C, spring, rise, color, surf, o = {}) {
  const { B, r } = C;
  const along = r.w >= r.h;
  const len = along ? r.w : r.h, span = along ? r.h : r.w;
  const segs = o.segs || 10;
  const prof = (k) => { const t = -1 + (2 * k) / segs; return [(t * span) / 2, spring + rise * (1 - t * t)]; };
  for (let k = 0; k < segs; k++) {
    const [a, ya] = prof(k), [b, yb] = prof(k + 1);
    // a strip along the room, its normal down and in
    if (along) B.quad('std', [0, (ya + yb) / 2, (a + b) / 2], [len, 0, 0], [0, yb - ya, b - a], color, surf);
    else B.quad('std', [(a + b) / 2, (ya + yb) / 2, 0], [0, 0, -len], [b - a, yb - ya, 0], color, surf);
  }
  // the ends: walls from the spring up under the arch, both faces (an arch open at its ends shows the sky)
  for (const e of [-1, 1]) {
    for (let k = 0; k < segs; k++) {
      const [a, ya] = prof(k), [b, yb] = prof(k + 1);
      const lo = Math.min(ya, yb), hi = Math.max(ya, yb);
      const t = (e * len) / 2;
      if (along) {
        for (const f of [1, -1]) B.quad('std', [t, (spring + lo) / 2, (a + b) / 2], [0, 0, f * (b - a)], [0, lo - spring, 0], color, surf);
        if (hi > lo) B.add('std', RTRI(), yb > ya ? [t, ya, a] : [t, yb, b], [b - a, hi - lo, 1], [0, yb > ya ? -HALF : HALF, 0], color, surf);
      } else {
        for (const f of [1, -1]) B.quad('std', [(a + b) / 2, (spring + lo) / 2, t], [f * (b - a), 0, 0], [0, lo - spring, 0], color, surf);
        if (hi > lo) B.add('std', RTRI(), yb > ya ? [a, ya, t] : [b, yb, t], [b - a, hi - lo, 1], yb > ya ? null : [0, Math.PI, 0], color, surf);
      }
    }
  }
  // ribs (rings) every `ribStep`
  if (o.ribStep && C.lod() >= 1) {
    for (let t = -len / 2 + o.ribStep / 2; t < len / 2; t += o.ribStep) {
      for (let k = 0; k < segs; k++) {
        const [a, ya] = prof(k), [b, yb] = prof(k + 1);
        const L = Math.hypot(b - a, yb - ya), ang = Math.atan2(yb - ya, b - a);
        if (along) C.B.box('std', t, (ya + yb) / 2 - 2, (a + b) / 2, o.ribW || 10, 5, L + 1, o.ribColor || color, [-ang, 0, 0], surf);
        else C.B.box('std', (a + b) / 2, (ya + yb) / 2 - 2, t, L + 1, 5, o.ribW || 10, o.ribColor || color, [0, 0, ang], surf);
      }
    }
  }
  return prof;
}

const CEILINGS = {
  /** Under the hall's vault (drawn with the track's room): nothing of its own, its strip lamps hang below. */
  open() {},
  /** The platform hall: a tiled barrel vault over the platform and the track, its end walls, a cable trough. */
  hall(C) {
    const { B, r } = C;
    if (r.w < 1000) return;
    const HL = METRO.hall;
    C.at(B, 0, 0, 0, 71, 0);
    const span = HL.y1 - HL.y0, yc = (HL.y0 + HL.y1) / 2, xc = (HL.x0 + HL.x1) / 2, len = HL.x1 - HL.x0;
    const spring = 240, rise = 110, segs = 14;
    const prof = (k) => { const t = -1 + (2 * k) / segs; return [yc + (t * span) / 2, spring + rise * (1 - t * t)]; };
    for (let k = 0; k < segs; k++) {
      const [a, ya] = prof(k), [b, yb] = prof(k + 1);
      B.quad('std', [xc, (ya + yb) / 2, (a + b) / 2], [len, 0, 0], [0, yb - ya, b - a], '#e4e2d8', S(DET.tile, 0.3, 0));
    }
    // the end walls (tympana) at both ends, over the walls' tops
    for (const [x, e] of [[HL.x0, 1], [HL.x1, -1]]) {
      for (let k = 0; k < segs; k++) {
        const [a, ya] = prof(k), [b, yb] = prof(k + 1);
        const lo = Math.min(ya, yb);
        B.quad('std', [x, (spring + lo) / 2, (a + b) / 2], [0, 0, e * (b - a)], [0, lo - spring, 0], '#d8d4c8', S(DET.tile, 0.35, 0));
        if (yb > ya) B.add('std', RTRI(), [x, ya, a], [b - a, yb - ya, 1], [0, -HALF, 0], '#d8d4c8', S(DET.tile, 0.35, 0));
        else B.add('std', RTRI(), [x, yb, b], [b - a, ya - yb, 1], [0, HALF, 0], '#d8d4c8', S(DET.tile, 0.35, 0));
      }
    }
    // the crown's cable trough, the soot over the track
    B.box('std', xc, spring + rise - 6, yc - 120, len, 8, 30, '#5a6066', null, STEEL);
    if (C.lod() >= 1) for (let k = 0; k < 10; k++) C.decal(B, 'soot', HL.x0 + 200 + k * 380, spring + 40, HL.y0 + 13, 300, 80, 0);
  },
  /** A tunnel's arch: concrete segments, ring joints, soot. */
  tunnel(C) {
    barrel(C, 120, Math.min(150, Math.min(C.r.w, C.r.h) * 0.3), C.fin.ceil, S(DET.concrete, 0.9, 0), { segs: 10, ribStep: 120, ribW: 4, ribColor: '#4a4842' });
  },
  /** The sump's brick vault on its ribs. */
  brickvault(C) {
    barrel(C, 140, 80, C.fin.ceil, S(DET.brick, 0.9, 0), { segs: 10, ribStep: 330, ribW: 22, ribColor: '#5a3428' });
  },
  /** The concourse: a coffered concrete ceiling (the pavement lights are their own item). */
  coffer(C) {
    const { B, r, H, fin } = C;
    B.quad('std', [0, H + 12, 0], [r.w, 0, 0], [0, 0, r.h], fin.ceil, { noAO: true, surf: [DET.plaster, 0.8, 0] });
    for (let x = -r.w / 2 + 150; x < r.w / 2; x += 300) B.box('std', x, H + 4, 0, 16, 16, r.h, '#d4d0c4', null, S(DET.plaster, 0.8, 0));
    for (let z = -r.h / 2 + 150; z < r.h / 2; z += 300) B.box('std', 0, H + 4, z, r.w, 16, 16, '#d4d0c4', null, S(DET.plaster, 0.8, 0));
    // the panel lights' frames show from below (their glass is drawn by the item)
    void PAVEMENT;
  },
  /** The works: steel trusses under a profiled deck. */
  truss(C) {
    const { B, r, H, fin } = C;
    B.quad('std', [0, H + 30, 0], [r.w, 0, 0], [0, 0, r.h], fin.ceil, { noAO: true, surf: [DET.corrugated, 0.6, 0.5] });
    const along = r.w >= r.h;
    const len = along ? r.w : r.h, span = along ? r.h : r.w;
    for (let t = -len / 2 + 200; t < len / 2; t += 400) {
      const bx = (x, y, z, sx, sy, sz, rot) => (along ? B.box('std', t + x, y, z, sx, sy, sz, '#3a5a8a', rot, STEEL) : B.box('std', z, y, t + x, sz, sy, sx, '#3a5a8a', rot, STEEL));
      bx(0, H, 0, 6, 6, span, null);
      bx(0, H + 28, 0, 6, 6, span, null);
      if (C.lod() >= 1) for (let k = 0; k < Math.floor(span / 60); k++) bx(0, H + 14, -span / 2 + 30 + k * 60, 4, 34, 3, along ? [k % 2 ? 0.7 : -0.7, 0, 0] : [0, 0, k % 2 ? 0.7 : -0.7]);
    }
  },
  /** A concrete slab with beams, a sprinkler main. */
  slab(C) {
    const { B, r, H, fin } = C;
    B.quad('std', [0, H, 0], [r.w, 0, 0], [0, 0, r.h], fin.ceil, { noAO: true, surf: [DET.slab, 0.9, 0] });
    const along = r.w >= r.h;
    const len = along ? r.w : r.h;
    for (let t = -len / 2 + 200; t < len / 2; t += 300) {
      if (along) B.box('std', t, H - 7, 0, 14, 14, r.h, '#8a8a84', null, CONC); else B.box('std', 0, H - 7, t, r.w, 14, 14, '#8a8a84', null, CONC);
    }
    if (C.lod() >= 1) {
      if (along) B.cylX('std', 0, H - 4, r.h * 0.3, 1.8, r.w, '#b8433a', 8, S(0, 0.5, 0.3)); else B.cylZ('std', r.w * 0.3, H - 4, 0, 1.8, r.h, '#b8433a', 8, S(0, 0.5, 0.3));
    }
  },
};

/** A fixture of the kit's per-section set (`C.lit` / `C.color` from the map lights). */
function fixture(C) {
  const { B, H, fx, lit, color } = C;
  const glowC = color ? mixHex(color, '#ffffff', 0.35) : null;
  switch (fx.kind) {
    case 'strip': {
      // a long fluorescent strip on drop rods (the platform's, the ticket hall's)
      const y = H - 14;
      for (const e of [-1, 1]) B.cyl('std', e * 50, y + 2, 0, 0.3, 12, '#555', 4);
      B.box('std', 0, y + 1.6, 0, 124, 3, 8, '#d8d8d4', null, S(0, 0.5, 0.4));
      if (lit) C.glow(B, 0, y - 0.2, 0, 118, 0.6, 6, glowC, 2.6); else B.box('std', 0, y - 0.2, 0, 118, 0.6, 6, '#9a9d9e', null, PLAST);
      break;
    }
    case 'globe': {
      B.cyl('std', 0, H - 26, 0, 0.3, 26, '#2a2a2a', 4);
      if (lit) C.glow(B, 0, H - 32, 0, 12, 12, 12, glowC, 2.2); else B.add('std', T.sphere(10, 8), [0, H - 32, 0], [6, 6, 6], null, '#e8e4d8', PLAST);
      break;
    }
    case 'bulk': case 'cage': {
      // a bulkhead / a caged bulb under the crown of the arch (or the flat ceiling)
      const span = Math.min(C.r.w, C.r.h);
      const crown = C.fin.ceilKind === 'tunnel' ? 120 + Math.min(150, span * 0.3) : C.fin.ceilKind === 'brickvault' ? 220 : H;
      const y = crown - 10;
      B.rblock('std', 0, y, 0, 14, 6, 10, 1, '#2a2c2e', null, STEEL);
      if (lit) C.glow(B, 0, y - 2, 0, 10, 3, 7, glowC, 2.8); else B.box('std', 0, y - 2, 0, 10, 3, 7, '#6a5a3a', null, PLAST);
      break;
    }
    case 'highbay': {
      B.cyl('std', 0, H - 30, 0, 0.6, 30, '#2a2a2a', 4);
      B.cyl('std', 0, H - 40, 0, 16, 12, '#3a3d40', 14, 0.4, null, STEEL);
      if (lit) C.glow(B, 0, H - 40.4, 0, 22, 0.6, 22, glowC, 2.6); else B.cyl('std', 0, H - 40.6, 0, 10, 0.6, '#6a5a3a', 12, 1, null, PLAST);
      break;
    }
    case 'tube': {
      const y = H - 3;
      B.box('std', 0, y + 1.6, 0, 72, 2.4, 6, '#c9cbc8', null, S(0, 0.5, 0.4));
      if (lit) C.glow(B, 0, y, 0, 66, 1.4, 3, glowC, 3); else B.cylX('std', 0, y, 0, 0.9, 66, '#b8bcbc', 6, S(0, 0.3, 0));
      break;
    }
    case 'down': {
      B.cyl('std', 0, H - 0.8, 0, 7, 0.8, '#d8d4cc', 14, 1, null, S(0, 0.4, 0.5));
      if (lit) C.glow(B, 0, H - 1.2, 0, 9, 0.4, 9, glowC, 2.4);
      break;
    }
    default: {
      B.box('std', 0, H - 0.6, 0, 63, 1.2, 29, '#c9c9c4', null, S(0, 0.4, 0.5));
      if (lit) C.glow(B, 0, H - 1.3, 0, 60, 0.4, 26, glowC, 2.4); else B.box('std', 0, H - 1.3, 0, 60, 0.4, 26, '#9ea1a2', null, PLAST);
    }
  }
}

// ---- things on the walls ------------------------------------------------------------------------------
function wallProp(W) {
  const { B, s, t, z, ry, base, h, kind, seed } = W;
  const out = (d) => z + s * d;
  switch (kind) {
    case 'poster': W.pic(B, ['mt_poster', 'mt_notice', 'mt_ad1'][seed % 3], t, base + 60, out(0.4), seed % 3 === 2 ? 60 : 26, seed % 3 === 2 ? 30 : 36, ry); break;
    case 'ad': {
      B.box('std', t, base + 70, out(0.8), 104, 54, 1.4, '#2a2c2e', [0, ry, 0], STEEL);
      W.pic(B, ['mt_ad1', 'mt_ad2', 'mt_ad3', 'mt_ad4'][seed % 4], t, base + 70, out(1.6), 98, 49, ry);
      break;
    }
    case 'map': B.box('std', t, base + 70, out(0.8), 64, 48, 1.4, '#2a2c2e', [0, ry, 0], STEEL); W.pic(B, seed % 2 ? 'mt_linemap' : 'mt_map', t, base + 70, out(1.6), seed % 2 ? 60 : 34, seed % 2 ? 13 : 42, ry); break;
    case 'notice': W.pic(B, 'mt_notice', t, base + 60, out(0.4), 24, 19, ry); break;
    case 'exit': {
      if (h < 100) break;
      B.rbox('std', t, base + Math.min(h - 14, 110), out(2), 26, 11, 4, 0.8, '#e8e8e4', [0, ry, 0], PLAST);
      W.pic(B, 'mt_exit', t, base + Math.min(h - 14, 110), out(4.1), 22, 8, ry, { lit: true, k: 1.6 });
      break;
    }
    case 'graffiti': W.decal(B, ['g_tag1', 'g_tag2', 'g_help', 'g_dead', 'g_tally', 'g_square'][seed % 6], t, base + 50, out(0.45), 90, 34, ry); break;
    case 'blood': W.decal(B, seed % 2 ? 'blood_hand' : 'blood_drip', t, base + 50, out(0.5), 34, 44, ry); break;
    case 'bin': B.cyl('std', t, base, out(12), 9, 28, '#1a1c1e', 12, 0.95, null, PLAST); break;
    case 'panel': B.rblock('std', t, base + 60, out(2), 18, 26, 4, 0.6, '#8a9096', null, S(DET.panel, 0.5, 0.5)); W.pic(B, 'mt_hv', t, base + 80, out(4.2), 8, 8, ry); break;
    case 'hv': W.pic(B, 'mt_hv', t, base + 70, out(0.4), 16, 16, ry); break;
    case 'vent': W.pic(B, 'mt_vent', t, base + 90, out(0.4), 22, 22, ry); break;
    case 'refuge': {
      // a refuge niche's yellow surround and its lamp
      W.pic(B, 'mt_caution', t, base + 2, out(0.4), 60, 6, ry);
      B.box('std', t, base + 50, out(0.5), 4, 100, 1, '#f2c21a', [0, ry, 0], PAINT);
      W.pic(B, 'mt_danger', t, base + 112, out(0.4), 40, 15, ry);
      break;
    }
    default: break;
  }
}

// ---- gates: the closed leaves (E animates them, JOURNEY §4.1) ------------------------------------------
const GATE_H = { turnstiles: 100, platform_door: 86, tunnel_gate: 140, sump_door: 88, maint_shutter: 120, exit_gate: 120 };

function gate(P) {
  const { B, o } = P;
  const L = o.w, H = GATE_H[o.gate] || 90;
  switch (o.gateKind) {
    case 'shutter': {
      B.block('std', 0, 0, 0, L, H, 2.4, '#8a9096', null, S(DET.corrugated, 0.5, 0.6));
      for (let y = 6; y < H; y += 6) B.box('std', 0, y, 1.3, L, 0.8, 0.6, '#6d7378', null, STEEL);
      B.box('std', 0, 2, 0, L, 4, 4, '#3a3e42', null, STEEL);
      B.box('std', 0, H + 7, 0, L + 8, 14, 12, '#5a6066', null, STEEL);
      for (const f of [1, -1]) P.pic(B, 'mt_works', 0, H * 0.6, f * 1.5, Math.min(L - 20, 140), 30, f > 0 ? 0 : Math.PI);
      return;
    }
    case 'bars': case 'gate': {
      // a steel gate: a frame, mesh (or bars), a padlocked chain
      const mesh = o.gateKind === 'gate';
      for (const e of [-1, 1]) B.box('std', e * (L / 2 - 3), H / 2, 0, 6, H, 6, '#3a3d40', null, STEEL);
      for (const y of [3, H / 2, H - 3]) B.box('std', 0, y, 0, L, 5, 5, '#3a3d40', null, STEEL);
      if (mesh) {
        const n = Math.max(1, Math.round(L / 40)), m = Math.max(1, Math.round(H / 40));
        for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) for (const f of [1, -1]) P.pic(B, 'mt_mesh', -L / 2 + (i + 0.5) * (L / n), (j + 0.5) * (H / m), f * 0.6, L / n, H / m, f > 0 ? 0 : Math.PI);
      } else {
        for (let x = -L / 2 + 10; x < L / 2 - 6; x += 10) B.cyl('std', x, 0, 0, 1.2, H, '#5a6066', 6, 1, null, STEEL);
      }
      B.cyl('std', 0, H / 2 - 6, 3.4, 2.4, 10, '#b8bcc0', 8, 1, [HALF, 0, 0], CHROME);
      for (const f of [1, -1]) P.pic(B, o.gate === 'tunnel_gate' ? 'mt_track' : 'mt_noentry', L * 0.25, H * 0.7, f * 3.2, 44, 16, f > 0 ? 0 : Math.PI);
      return;
    }
    default: {
      // a door: the staff door (steel, a wired pane), the bulkhead (heavy, a wheel)
      const bulk = o.gate === 'sump_door';
      B.rblock('std', 0, 1, 0, L - 1, H - 2, bulk ? 8 : 3.6, bulk ? 2 : 0.6, bulk ? '#4a5a4a' : '#5a6a7a', null, PAINT);
      if (bulk) {
        for (const f of [1, -1]) B.add('std', T.torus(14, 0.14, 6), [0, H * 0.5, f * 6], [12, 12, 12], null, '#b3120e', PAINT);
        for (const y of [10, H - 10]) for (const f of [1, -1]) B.box('std', 0, y, f * 4.6, L - 8, 4, 2, '#3a4a3a', null, STEEL);
        for (const f of [1, -1]) P.pic(B, 'mt_bulkhead', 0, H * 0.85, f * 4.4, 54, 14, f > 0 ? 0 : Math.PI);
      } else {
        B.box('glass', L * 0.15, H * 0.7, 0, L * 0.3, H * 0.24, 3.8, '#1c262e', null, S(DET.glass, 0.1, 0.3));
        B.box('std', 0, H * 0.44, 0, L - 10, 2.4, 6.5, '#c9ced3', null, CHROME);
        for (const f of [1, -1]) P.pic(B, 'mt_staff', 0, H * 0.86, f * 2.1, 40, 12, f > 0 ? 0 : Math.PI);
      }
    }
  }
}

/** The train's sliding doors: the leaves pushed into their pockets (the frame is the kit's). */
function doorLeaves(D) {
  const { B, it, w, th, h } = D;
  if (it.kind !== 'train') return false;
  const open = hash01(Math.round(it.x)) < 0.75;
  for (const e of [-1, 1]) {
    const x = open ? e * (w / 2 + w / 4 - 4) : e * w / 4;
    B.box('std', x, h / 2, 0, w / 2 - 2, h - 2, 2.4, '#c8ccd0', null, STEEL);
    B.box('glass', x, h * 0.66, 0, w / 2 - 14, h * 0.3, 2.6, '#1a2830', null, S(DET.glass, 0.1, 0.3));
  }
  if (!open) B.box('std', 0, h / 2, 0, 2, h - 4, th + 2, '#1a1a1a', null, RUBBER_S);
  return true;
}
const RUBBER_S = S(DET.rubber, 0.9, 0);

// ---- the switchable lamps -------------------------------------------------------------------------------
function lampsOf(L, map) {
  const items = map.levelArt || [];
  // the tunnel signals: red, or green
  for (const it of items.filter((q) => q.t === 'signal')) {
    const B = L.builderFor('tunnel', false);
    L.at(B, it.x, it.y, it.a || 0, 81, 0);
    const y = it.red ? 74 : 102;
    B.add('glow', T.cyl(10), [0, y, 11.2], [3.6, 1, 3.6], [HALF, 0, 0], it.red ? '#ff2a1a' : '#3cff7a', { emissive: 3.4, noAO: true, noJitter: true });
    const [wx, wy] = L.toWorld(it, 0, 14);
    L.halo(wx, wy, y, it.red ? '#ff2a1a' : '#3cff7a', 50, 0.6);
  }
  // the stairs' strip lamps under their soffits
  for (const it of items.filter((q) => q.t === 'stairflight')) {
    const sec = it.service ? 'platform' : it.h1 > 300 && it.x0 < 3000 ? 'street' : 'exit';
    const B = L.builderFor(sec, !!it.service);
    L.at(B, 0, 0, 0, 83, 0);
    const clear = it.service ? 120 : 150;
    const run = it.x1 - it.x0, rise = it.h1 - it.h0;
    const yc = (it.y0 + it.y1) / 2;
    for (let k = 1; k < 4; k++) {
      const x = it.x1 - (k * run) / 4, hy = it.h0 + (k * rise) / 4 + clear - 1;
      if (it.lantern && x < it.x0 + 220) continue;
      L.glow(B, x, hy, yc, 40, 0.6, 8, '#eef4ff', 2.4);
    }
  }
}

// ---- the town round the station and the square -----------------------------------------------------------
const METRO_SKY = [
  { axis: 'x', from: -1500, to: 9500, at: -900, depth: -1200, h: [200, 600], base: METRO.street },
  { axis: 'y', from: -800, to: 6800, at: -1300, depth: -900, h: [180, 500], base: METRO.street },
  { axis: 'x', from: -1500, to: 6500, at: 6700, depth: 1000, h: [180, 520], base: METRO.street },
];

/** Signs the layout implies: the platform's name and its PLATFORM 2, the hall's departures, EXIT boxes. */
function signs(P) {
  const { B } = P;
  const put = (x, y, ry, cell, w, h, hy, o = {}) => { P.at(B, x, y, 0, 87, 0); P.pic(B, cell, 0, hy, 0, w, h, ry, o); };
  put(3520.6, 2110, HALF, 'mt_platform2', 120, 20, METRO.concourse + 150);
  put(2712.6, 2110, HALF, 'mt_dep', 100, 20, METRO.concourse + 140, { lit: !P.day, k: 1 });
  put(3500 + 8.6, 1640, HALF, 'mt_ticketoffice', 70, 15, METRO.concourse + 100);
  put(4700, 1508.6, 0, 'mt_staff', 50, 15, METRO.concourse + 100);
  put(5200 - 0.6, 1200, -HALF, 'mt_platform2', 120, 20, METRO.platform + 170);
  put(9040 - 13, 1000, -HALF, 'mt_danger', 60, 22, 70);
  put(METRO.south.x0 + 13, 2380, HALF, 'mt_bulkhead', 70, 17, 110);
  put(9300, 3000 - 13, Math.PI, 'mt_works', 80, 20, 140);
  put(9300, 3000 + 13, 0, 'mt_works', 80, 20, 140);
  put(8900 - 13, 2450, -HALF, 'mt_pump', 70, 17, 120);
  put(6750, 3800 + 9, 0, 'mt_lift', 80, 20, 150);
  put(5600, 4190 + 0.6, 0, 'mt_square', 90, 22, 110);
  put(5600, 4430 - 0.6, Math.PI, 'mt_wayout', 90, 22, 110);
}

/**
 * @param {object} ctx renderer ctx (ctx.map is the built level)
 * @param {object} deps { root, mats, fx, halos, shafts, day, aniso, gy, tier, full, newBuilder(), matOf(bucket, tier) }
 */
export function createLevelArt(ctx, deps) {
  const map = ctx.map;
  gyRef = deps.gy || (() => 0);
  const state = { waters: [], glass: [], tris: [], gtris: [] };
  const { OBSTACLES, ITEMS } = metroProps(state);
  let sky = null, water = null;
  const ES = METRO.entryStair, EX = METRO.exitStair;
  // (over a flight the floor patch would hang flat in mid air: the stairs get the shafts only)
  const skylights = [
    { x0: ES.x0 + 4, x1: ES.x0 + 216, y0: ES.y0 + 4, y1: ES.y1 - 4, h: METRO.street + 170, floor: 250, clip: ES, patch: 0 },
    ...PAVEMENT.map((p) => ({ ...p, h: METRO.concourse + 190, floor: METRO.concourse, k: 0.6, patch: 0.07, clip: METRO.concourseRect })),
    { x0: EX.x0, x1: EX.x0 + 100, y0: EX.y0 + 4, y1: EX.y1 - 4, h: METRO.street + 140, floor: 260, clip: EX, patch: 0 },
  ];
  const level = {
    id: 'metro',
    atlas: metroAtlas(),
    buckets: BUCKETS,
    rooms: ROOMS,
    walls: WALLS,
    facade,
    ceilings: CEILINGS,
    fixture,
    grimeCells: ['grime', 'grime2', 'wstain', 'soot'],
    brokenWindows: 0.25,
    obstacles: OBSTACLES,
    items: ITEMS,
    gate,
    doorLeaves,
    skylights,
    lamps: (L) => lampsOf(L, map),
    doorFrame: (it) => {
      switch (it.style) {
        case 'train': return { color: '#9aa0a4', surf: STEEL, jamb: 2.4 };
        case 'station-ext': return { color: '#e8dcc0', surf: S(DET.plaster, 0.6, 0), jamb: 6 };
        case 'mt-tunnelwall': case 'mt-brick': return { color: '#5a5852', surf: CONC, jamb: 8 };
        default: return { color: '#6d7378', surf: STEEL, jamb: 3.4 };
      }
    },
    leafColor: (it) => ({ 'mt-office': '#5a6a7a', 'mt-service': '#4a5a4a', 'mt-lift': '#8d9498' })[it.style] || '#6a7a8a',
    windowFrame: (it) => (it.style === 'station-ext' ? { color: '#2a2a26', surf: STEEL } : it.style === 'train' ? { color: '#2a2c2e', surf: RUBBER_S } : { color: '#3a3d40', surf: STEEL }),
    wallProp,
    props(P) {
      signs(P);
      const B = P.B;
      // the street's west end and the square's south side: blocks standing on the city's raised ground
      B.setCell('mt-street-w');
      streetRow(B, 1000, 3700, 0, -HALF, 8100, { tall: [140, 80] });
      B.setCell('mt-square-s');
      streetRow(B, 900, 5600, 5600, Math.PI, 8200, { tall: [130, 90] });
      B.setCell(null);
    },
    finish(P) {
      buildGlass(P, state);
      water = buildWater(P, state.waters, false);
      sky = skyline(P, P.root, P.day, METRO_SKY);
    },
    update(view, frame) {
      if (water) { const dt = Math.min(0.1, (frame && frame.dt) || 0.016); water.nrm.offset.x += dt * 0.003; }
    },
    dispose() { if (sky) sky.dispose(); if (water) water.dispose(); },
  };
  void CHROME;
  return createInteriorArt(ctx, deps, level);
}
