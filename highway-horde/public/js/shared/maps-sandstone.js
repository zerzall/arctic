// 6. Sandstone (the Horde Elimination map, SPEC §2 / §3.12)
//
// A sun-baked walled town of sandstone and lime plaster, 3300 x 3200, laid out like the classic
// two-site desert map of competitive shooters, scaled to our units (a Hammer unit ≈ 0.63 of ours):
// the crew holds the CT side in the north, the horde comes from the T side in the south.
//
//   CT SPAWN      (north centre, 76 up) the radio mast, the supply station, the crew's start.
//   A SITE        (north-east, 140 up) reached up the long ramp from Long A, the short stairs from
//                 the catwalk and the CT ramp from CT spawn; the A platform (156) with goose in its
//                 far corner, the default crates.
//   LONG A        (east, 76 up) outside long → the long doors (double doors with the gap) → the long
//                 corridor straight north to the ramp; the pit (sunk to 0) at its bottom-east, out by
//                 its stairs; a blue bin and the corner car.
//   MID           (centre, a valley at 0) top mid (110) down the mid slope, xbox and the catwalk
//                 stairs, the catwalk (76) along its east side with the drop, the mid doors (the big
//                 double doors with the gap), CT mid and the CT ramp up into CT spawn.
//   B             (north-west, 76) outside tunnels → the dark upper tunnels → the B tunnel into B
//                 site (B platform at 116, the window, the B doors from CT, the B car); the lower
//                 tunnels down stairs into lower mid.
//   T SPAWN       (south, 110) and the four entrances of the horde: T Spawn, Outside Long, Top of
//                 Tunnels and Top Mid (`map.horde.lanes`, every spawn rect tagged with its lane).
//
// Heights: the terrain (shared/terrain.js plateaus; stairs and ramps are flights of small steps)
// carries the levels; the one-way drops (the catwalk into mid, long into the pit, off the B platform)
// are low retaining walls standing on the low side whose top is under the high side (`desk`, low
// cover: a survivor up there walks over and drops, one below is stopped short of a jump, the horde
// goes round by the stairs, shots pass over). Every walkable place is one of
// the rectangles of SANDSTONE; everything between them is the town's houses (built from their
// complement). The layout is fixed (the same for every seed) except the dressing scatter; the art
// module draws it from the obstacles' `style` tags and `map.sandArt` (render3d/maps/sandstone.js).

import { createRng, hashString } from './rng.js';
import { sandstoneDecals } from './maps-decals.js';

/** World size and mood (maps.js MAP_DEFS). */
export const SANDSTONE_DEF = { width: 3300, height: 3200, darkness: 0.6, tint: '#9a6a3a', ground: '#c7a77a' };

/** Levels of the town (terrain heights, units). */
export const SANDSTONE_LEVELS = Object.freeze({ low: 0, up: 40, t: 76, a: 100, aPlat: 112, bPlat: 76 });
/** Height of the upper town (the catwalk, long, CT spawn, B): kept for the old name. */
export const SANDSTONE_H = SANDSTONE_LEVELS.up;

const L = SANDSTONE_LEVELS;
const rect = (x0, y0, x1, y1, h, name) => Object.freeze({ x0, y0, x1, y1, h, name });

/**
 * The walkable places (axis-aligned rectangles x0..x1 × y0..y1, `h` their floor; a ramp or a flight
 * of stairs has `h0` → `h1`). Tests and the art read them. Everything else is houses.
 */
export const SANDSTONE = Object.freeze({
  // B
  bSite: rect(200, 200, 900, 950, L.up, 'B Site'),
  bPlat: rect(200, 200, 500, 360, L.bPlat, 'B Platform'),
  bPlatStairs: Object.freeze({ ...rect(500, 200, 600, 300, 0, 'B Platform Stairs'), h0: L.up, h1: L.bPlat, axis: 'x', dir: -1, n: 8, stairs: true }),
  bDoors: rect(900, 600, 940, 800, L.up, 'B Doors'),
  bWindow: rect(900, 340, 940, 420, L.up, 'B Window'),
  windowRoom: rect(940, 300, 1100, 600, L.up, 'Window Room'),
  ctB: rect(940, 600, 1400, 800, L.up, 'CT to B'),
  bTunnel: rect(650, 950, 850, 1450, L.up, 'B Tunnel'),
  tunnelRoom: rect(600, 1450, 1000, 1650, L.up, 'Upper Tunnels'),
  upperTunnel: rect(700, 1650, 900, 2500, L.up, 'Upper Tunnels'),
  lowerStairs: Object.freeze({ ...rect(1000, 1500, 1150, 1650, 0, 'Tunnel Stairs'), h0: L.low, h1: L.up, axis: 'x', dir: -1, n: 8, stairs: true }),
  lowerTunnel: rect(1150, 1500, 1350, 1650, L.low, 'Lower Tunnels'),
  tunnelSlope: Object.freeze({ ...rect(700, 2500, 900, 2750, 0, 'Top of Tunnels'), h0: L.up, h1: L.t, axis: 'y', dir: 1, n: 8 }),
  outsideTunnels: rect(0, 2750, 1350, 2950, L.t, 'Outside Tunnels'),
  // CT
  ctSpawn: rect(1400, 250, 2050, 900, L.up, 'CT Spawn'),
  ctRamp: Object.freeze({ ...rect(1400, 900, 1660, 1150, 0, 'CT Ramp'), h0: L.low, h1: L.up, axis: 'y', dir: -1, n: 8 }),
  ctMid: rect(1350, 1150, 1660, 1400, L.low, 'CT Mid'),
  // mid
  lowerMid: rect(1350, 1400, 1660, 1950, L.low, 'Lower Mid'),
  midSlope: Object.freeze({ ...rect(1350, 1950, 1660, 2300, 0, 'Mid'), h0: L.low, h1: L.t, axis: 'y', dir: 1, n: 16 }),
  topMid: rect(1350, 2300, 1750, 2600, L.t, 'Top Mid'),
  xboxPocket: rect(1660, 1850, 1840, 1950, L.low, 'Xbox'),
  catStairs: Object.freeze({ ...rect(1660, 1650, 1840, 1850, 0, 'Catwalk Stairs'), h0: L.low, h1: L.up, axis: 'y', dir: -1, n: 16, stairs: true }),
  catwalk: rect(1660, 1400, 1840, 1650, L.up, 'Catwalk'),
  catwalkN: rect(1700, 950, 1840, 1400, L.up, 'Catwalk'),
  short: rect(1840, 950, 2400, 1100, L.up, 'Short A'),
  shortStairs: Object.freeze({ ...rect(2220, 760, 2400, 950, 0, 'Short Stairs'), h0: L.up, h1: L.a, axis: 'y', dir: -1, n: 12, stairs: true }),
  // A
  aSite: rect(2200, 200, 2950, 760, L.a, 'A Site'),
  aPlat: rect(2520, 200, 2950, 440, L.aPlat, 'A Platform'),
  ctToA: Object.freeze({ ...rect(2050, 380, 2200, 620, 0, 'CT Ramp to A'), h0: L.up, h1: L.a, axis: 'x', dir: 1, n: 12 }),
  longRamp: Object.freeze({ ...rect(2720, 760, 2900, 1000, 0, 'A Ramp'), h0: L.up, h1: L.a, axis: 'y', dir: -1, n: 12 }),
  long: rect(2700, 1000, 2980, 2050, L.up, 'Long A'),
  longBottom: rect(2700, 2050, 2980, 2350, L.up, 'Long A'),
  pitLedge: rect(2980, 1780, 3180, 1880, L.up, 'Pit'),
  pitStairs: Object.freeze({ ...rect(2980, 1880, 3180, 2050, 0, 'Pit Stairs'), h0: L.low, h1: L.up, axis: 'y', dir: -1, n: 16, stairs: true }),
  pit: rect(2980, 2050, 3180, 2350, L.low, 'Pit'),
  longDoors: rect(2700, 2350, 2900, 2520, L.up, 'Long Doors'),
  outsideLong: rect(2650, 2520, 3300, 2800, L.up, 'Outside Long'),
  outsideLongW: Object.freeze({ ...rect(2450, 2550, 2650, 2800, 0, 'Outside Long'), h0: L.up, h1: L.t, axis: 'x', dir: -1, n: 8 }),
  // T
  tSpawn: rect(1700, 2650, 2450, 3200, L.t, 'T Spawn'),
  tRamp: rect(1600, 2600, 1750, 2700, L.t, 'T Ramp'),
  tWest: rect(1550, 2800, 1700, 2950, L.t, 'T Spawn'),
  midAlley: rect(1350, 2600, 1550, 3200, L.t, 'Mid Alley'),
});

/** The places below the upper town (the terrain's 76 plateau leaves them out). */
const LOW = ['ctRamp', 'ctMid', 'lowerMid', 'midSlope', 'xboxPocket', 'catStairs', 'lowerStairs', 'lowerTunnel', 'pitStairs', 'pit'];
/** Flat places above it. */
const HIGH = ['tSpawn', 'tRamp', 'tWest', 'midAlley', 'topMid', 'outsideTunnels', 'aSite', 'aPlat', 'bPlat'];

/** Where the defenders hold (bots without a human to follow): CT spawn, and the three spots a surge's entrances call for. */
export const SANDSTONE_HOLDS = Object.freeze({
  ct: Object.freeze({ x: 1720, y: 600, r: 340 }),
  a: Object.freeze({ x: 2560, y: 600, r: 300 }),
  b: Object.freeze({ x: 560, y: 640, r: 320 }),
  mid: Object.freeze({ x: 1505, y: 1260, r: 220 }),
});

/** The horde's entrances (the T side), in lane order (zombie spawn rects carry `lane`: the index). */
export const SANDSTONE_LANES = Object.freeze([
  Object.freeze({ name: 'T Spawn', x: 2080, y: 3150, hold: 'ct' }),
  Object.freeze({ name: 'Outside Long', x: 3250, y: 2660, hold: 'a' }),
  Object.freeze({ name: 'Top of Tunnels', x: 50, y: 2850, hold: 'b' }),
  Object.freeze({ name: 'Top Mid', x: 1450, y: 3150, hold: 'mid' }),
]);

const HALF = Math.PI / 2;
const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;

// Sandstone, adobe and lime-washed plaster; flat earth roofs.
const WALLS = ['#d9c29c', '#cfb487', '#e3d2b1', '#c8a678', '#bf9b6c', '#e8dcc4', '#c99c6b', '#d4b892', '#b88d60', '#dcc7a2'];
const ROOFS = ['#b9a27c', '#a98f68', '#c2ab84', '#9f8762'];
const WOOD = '#6e4a2c';
const CRATE = '#9a7448';

/** Fixed (seed-independent) hash of a few numbers → [0, 1). */
function fh(...v) {
  let h = 0x811c9dc5;
  for (const n of v) {
    h ^= Math.round(n) | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * The complement of a set of rectangles inside [0, W] × [0, H], as rectangles: a coordinate-compressed
 * grid of the rectangles' edges, its free cells merged greedily (row by row, as wide and then as tall
 * as they go). Deterministic.
 * @param {object[]} rects [{ x0, y0, x1, y1 }]
 * @returns {object[]} [{ x0, y0, x1, y1 }]
 */
export function complementRects(rects, W, H) {
  const xs = [...new Set([0, W, ...rects.flatMap((r) => [r.x0, r.x1])])].filter((v) => v >= 0 && v <= W).sort((a, b) => a - b);
  const ys = [...new Set([0, H, ...rects.flatMap((r) => [r.y0, r.y1])])].filter((v) => v >= 0 && v <= H).sort((a, b) => a - b);
  const nx = xs.length - 1, ny = ys.length - 1;
  const used = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
      if (rects.some((r) => cx > r.x0 && cx < r.x1 && cy > r.y0 && cy < r.y1)) used[j * nx + i] = 1;
    }
  }
  const out = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (used[j * nx + i]) continue;
      let i1 = i;
      while (i1 + 1 < nx && !used[j * nx + i1 + 1]) i1++;
      let j1 = j;
      for (;;) {
        if (j1 + 1 >= ny) break;
        let ok = true;
        for (let k = i; k <= i1; k++) if (used[(j1 + 1) * nx + k]) { ok = false; break; }
        if (!ok) break;
        j1++;
      }
      for (let jj = j; jj <= j1; jj++) for (let k = i; k <= i1; k++) used[jj * nx + k] = 1;
      out.push({ x0: xs[i], y0: ys[j], x1: xs[i1 + 1], y1: ys[j1 + 1] });
    }
  }
  return out;
}

/**
 * Build Sandstone into builder B (see maps.js createBuilder).
 * @param {object} B map builder
 */
export function buildSandstone(B) {
  const map = B.map;
  const W = B.W, Hh = B.H;
  const art = map.sandArt = [];
  const put = (t, x, y, a = 0, extra = {}) => {
    const it = { t, x: r1(x), y: r1(y), a: r3(a), ...extra };
    art.push(it);
    return it;
  };
  const S = SANDSTONE;
  const mid = (R) => [(R.x0 + R.x1) / 2, (R.y0 + R.y1) / 2];

  // ---- the terrain: the upper town, the high places and the flights between (shared/terrain.js)
  const terrain = map.terrain = { hills: [], plateaus: [] };
  const plateau = (x0, y0, x1, y1, h) => terrain.plateaus.push({ x0: r1(x0), y0: r1(y0), x1: r1(x1), y1: r1(y1), h: r3(h), edge: 0 });
  // (a zero-height plateau just outside a raised block: the ground mesh climbs the cliff at its edge)
  const guard = (R) => terrain.plateaus.push({ x0: r1(R.x0 - 1), y0: r1(R.y0 - 1), x1: r1(R.x1 + 1), y1: r1(R.y1 + 1), h: 0, edge: 0 });
  /** A flight (or a ramp of fine steps) over rectangle F from F.h0 to F.h1, rising along F.axis toward F.dir. */
  const flight = (F) => {
    const alongX = F.axis === 'x';
    const a0 = alongX ? F.x0 : F.y0, a1 = alongX ? F.x1 : F.y1;
    const run = (a1 - a0) / F.n, dh = (F.h1 - F.h0) / F.n;
    for (let j = 1; j < F.n; j++) {
      const lo = F.dir > 0 ? a0 + j * run : a0, hi = F.dir > 0 ? a1 : a1 - j * run;
      if (alongX) plateau(lo, F.y0, hi, F.y1, F.h0 + j * dh);
      else plateau(F.x0, lo, F.x1, hi, F.h0 + j * dh);
    }
  };
  // the upper town: everything but the low places
  const ups = complementRects(LOW.map((k) => S[k]), W, Hh);
  for (const R of ups) { plateau(R.x0, R.y0, R.x1, R.y1, L.up); guard(R); }
  for (const k of HIGH) { plateau(S[k].x0, S[k].y0, S[k].x1, S[k].y1, S[k].h); guard(S[k]); }
  const FLIGHTS = Object.keys(S).filter((k) => S[k].axis);
  for (const k of FLIGHTS) {
    flight(S[k]);
    const F = S[k];
    const kind = F.stairs ? 'stairs' : 'ramp';
    put(kind, ...mid(F), 0, { x0: F.x0, y0: F.y0, x1: F.x1, y1: F.y1, h0: F.h0, h1: F.h1, axis: F.axis, dir: F.dir, n: F.n, name: F.name });
  }
  /** Terrain height of the layout at (x, y) (the plateaus as written so far: the final ones). */
  const tH = (x, y) => {
    let best = 0;
    for (const p of terrain.plateaus) if (x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1 && p.h > best) best = p.h;
    return best;
  };

  // ---- the defenders' start: CT spawn (the radio mast, the supply station, the spawns)
  B.objective('radio', 'Radio Mast', 1560, 360, 70, 70, 0, 4500, 110);
  B.supply(1840, 470);
  for (const [x, y] of [[1620, 520], [1720, 520], [1620, 640], [1720, 640], [1840, 640], [1940, 560], [1840, 760], [1940, 760]]) B.pspawn(x, y);
  map.horde = {
    lanes: SANDSTONE_LANES.map((l) => ({ ...l })),
    hold: { ...SANDSTONE_HOLDS.ct },
    holds: Object.fromEntries(Object.entries(SANDSTONE_HOLDS).map(([k, v]) => [k, { ...v }])),
  };
  // (the classic desert of the 3D view: palms and nothing else; the art module that draws the town)
  map.look = {
    trees: ['palm'], grass: false, weeds: 0.15, nightWet: 0.25,
    // (a clear desert night: a blue-black sky over the warm lanterns rather than the dust-brown of the tint)
    night: { fog: '#151a24', horizon: '#1e2636', zenith: '#02040a', sky: '#8193b4', moon: '#a8bbe0', moonI: 0.62 },
    areas: { concrete: '#ad9573', sand: '#bd9f72', gravel: '#9c8566', dirt: '#a08462' },
  };
  map.art = 'sandstone';

  // ---- the horde's entrances (spawn rects at the edges of the T side, each tagged with its lane)
  const zs = (lane, x, y, w, h) => { B.zspawn(x, y, w, h).lane = lane; };
  zs(0, 2080, 3150, 280, 70);     // T Spawn
  zs(1, 3250, 2660, 70, 200);     // Outside Long
  zs(2, 50, 2850, 70, 160);       // Top of Tunnels
  zs(3, 1450, 3150, 150, 70);     // Top Mid
  put('gatearch', 2080, 3180, 0, { w: 320, name: 'T Spawn', ground: L.t });
  put('gatearch', 3285, 2660, HALF, { w: 260, name: 'Outside Long', ground: L.up });
  put('gatearch', 15, 2850, HALF, { w: 180, name: 'Top of Tunnels', ground: L.t, broken: 1 });
  put('gatearch', 1450, 3185, 0, { w: 180, name: 'Top Mid', ground: L.t });

  // ---- ground: sand lanes, paved sites and spawns, a gravel pit
  B.box('sand', 0, 0, W, Hh);
  for (const k of ['ctSpawn', 'aSite', 'bSite', 'catwalk', 'catwalkN', 'short', 'windowRoom', 'ctB']) B.box('concrete', S[k].x0, S[k].y0, S[k].x1, S[k].y1);
  B.box('gravel', S.pit.x0, S.pit.y0, S.pit.x1, S.pit.y1);
  B.box('dirt', S.tSpawn.x0 + 120, S.tSpawn.y0 + 100, S.tSpawn.x1 - 120, S.tSpawn.y1 - 120);
  B.box('dirt', S.lowerMid.x0 + 40, S.lowerMid.y0 + 60, S.lowerMid.x1 - 40, S.lowerMid.y1 - 60);

  // ---- the town: houses filling everything between the walkable places
  const WALK = Object.values(S).filter((R) => R.name !== 'B Platform' && R.name !== 'A Platform' && R.name !== 'B Platform Stairs');
  const blocks = complementRects(WALK, W, Hh);
  /** Highest walkable floor right around a block (its roofs stand over the street). */
  const around = (R, pad) => {
    let g = 0;
    for (const P of WALK) {
      if (P.x1 < R.x0 - pad || P.x0 > R.x1 + pad || P.y1 < R.y0 - pad || P.y0 > R.y1 + pad) continue;
      g = Math.max(g, P.h1 !== undefined ? Math.max(P.h0, P.h1) : P.h);
    }
    return g;
  };
  /** One house (or a thin wall where the gap is a sliver). */
  const house = (x0, y0, x1, y1, R) => {
    const w = x1 - x0, h = y1 - y0;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const g = tH(cx, cy);
    const street = around({ x0, y0, x1, y1 }, 40);
    const k = fh(x0, y0, x1, y1);
    const storeys = Math.floor(fh(y0, x1, 3) * 3);
    const top = Math.max(0, street - g) + 104 + storeys * 36 + Math.round(fh(x1, y0, 5) * 8);
    if (Math.min(w, h) < 70) {
      B.ob('wall', cx, cy, w, h, 0, { color: WALLS[Math.floor(k * WALLS.length)], style: 'courtwall', top: r1(top - 30) });
      return;
    }
    B.ob('building', cx, cy, w, h, 0, {
      color: WALLS[Math.floor(k * WALLS.length)], roof: ROOFS[Math.floor(fh(x1, y1) * ROOFS.length)], top: r1(top), style: 'house',
    });
    void R;
  };
  /** A block split along its long side (and in two across a deep one) at fixed places. */
  const block = (R) => {
    const w = R.x1 - R.x0, h = R.y1 - R.y0;
    const along = w >= h;
    const Lg = along ? w : h, D = along ? h : w;
    const cuts = [0];
    let t = 0;
    for (let k = 0; Lg - t > 520; k++) {
      t += 220 + Math.round(fh(R.x0, R.y0, k, 1) * 240);
      if (Lg - t < 180) break;
      cuts.push(t);
    }
    cuts.push(Lg);
    const deep = D > 560 ? [0, Math.round(D * (0.42 + fh(R.x0, R.y1, 7) * 0.16)), D] : [0, D];
    for (let i = 0; i + 1 < cuts.length; i++) {
      for (let j = 0; j + 1 < deep.length; j++) {
        const a0 = cuts[i], a1 = cuts[i + 1], b0 = deep[j], b1 = deep[j + 1];
        house(along ? R.x0 + a0 : R.x0 + b0, along ? R.y0 + b0 : R.y0 + a0, along ? R.x0 + a1 : R.x0 + b1, along ? R.y0 + b1 : R.y0 + a1, R);
      }
    }
  };
  for (const R of blocks) block(R);

  // ---- doors: the mid doors across mid, the long doors in their passage, the B doors into B site.
  // A doorway is a wall across the way with an opening, the two great wooden leaves standing open
  // past it (the gap between their edges is what you look through).
  const wallOpts = (style, extra = {}) => ({ color: '#cbb089', style, ...extra });
  /**
   * Doors across a passage along x at y (x0..x1), the opening ox0..ox1, the leaves (length `leaf`)
   * hinged at the opening's sides swung `open` radians off the wall toward `side` (−1 = −y).
   */
  const doorsX = (x0, x1, y, th, ox0, ox1, leaf, openL, openR, side, name, H = 175, sign = false) => {
    B.ob('wall', (x0 + ox0) / 2, y, ox0 - x0, th, 0, wallOpts('gatehouse', { top: H }));
    B.ob('wall', (ox1 + x1) / 2, y, x1 - ox1, th, 0, wallOpts('gatehouse', { top: H }));
    const hy = y + side * (th / 2 + 4);
    for (const [hx, s, open] of [[ox0 + 5, 1, openL], [ox1 - 5, -1, openR]]) {
      // the leaf: from the hinge along +x (left) or −x (right), turned `open` toward the side
      const ax = Math.cos(open) * s, ay = Math.sin(open) * side;
      B.ob('wall', hx + ax * leaf / 2, hy + ay * leaf / 2, leaf, 8, Math.atan2(ay, ax), wallOpts('bigdoor', { color: WOOD }));
    }
    put('doorway', (ox0 + ox1) / 2, y, 0, { w: ox1 - ox0, h: H - 30, kind: 'great', th, name, sign, ground: tH((ox0 + ox1) / 2, y) });
  };
  /** The same for a passage along y at x (y0..y1), the leaves swung toward `side` (−1 = −x). */
  const doorsY = (y0, y1, x, th, oy0, oy1, leaf, openL, openR, side, name, H = 175) => {
    B.ob('wall', x, (y0 + oy0) / 2, th, oy0 - y0, 0, wallOpts('gatehouse', { top: H }));
    B.ob('wall', x, (oy1 + y1) / 2, th, y1 - oy1, 0, wallOpts('gatehouse', { top: H }));
    const hx = x + side * (th / 2 + 4);
    for (const [hy, s, open] of [[oy0 + 5, 1, openL], [oy1 - 5, -1, openR]]) {
      const ay = Math.cos(open) * s, ax = Math.sin(open) * side;
      B.ob('wall', hx + ax * leaf / 2, hy + ay * leaf / 2, leaf, 8, Math.atan2(ay, ax), wallOpts('bigdoor', { color: WOOD }));
    }
    put('doorway', x, (oy0 + oy1) / 2, HALF, { w: oy1 - oy0, h: H - 30, kind: 'great', th, name, ground: tH(x, (oy0 + oy1) / 2) });
  };
  // the mid doors: both leaves half open toward CT, the gap between them in the middle of mid
  doorsX(S.lowerMid.x0, S.lowerMid.x1, 1405, 40, 1415, 1595, 76, 1.25, 1.25, -1, 'Mid Doors', 190, true);
  // the long doors: the left leaf back against the wall, the right one half shut (the gap)
  doorsX(S.longDoors.x0, S.longDoors.x1, 2440, 40, 2730, 2880, 60, 1.45, 1.2, -1, 'Long Doors', 170);
  // the B doors: in B site's east wall, swung into the site
  doorsY(S.bDoors.y0, S.bDoors.y1, 920, 40, 620, 780, 66, 1.3, 1.3, -1, 'B Doors', 165);
  // B window: a sill in the slot of B's east wall (vault it, shoot through it)
  B.ob('counter', 920, 380, 40, 80, 0, { color: '#c4a982', style: 'sill' });
  put('window', 920, 380, HALF, { w: 80, sill: 40, h: 64, ground: L.up });

  // ---- the drops and edges: retaining walls whose top is under the high side
  /** A run of retaining wall pieces along x = x (the low side's edge), y0..y1. */
  const retainY = (x, y0, y1, th = 12, maxLen = 130) => {
    const n = Math.max(1, Math.ceil((y1 - y0) / maxLen));
    for (let i = 0; i < n; i++) {
      const a = y0 + ((y1 - y0) * i) / n, b = y0 + ((y1 - y0) * (i + 1)) / n;
      B.ob('desk', x, (a + b) / 2, th, b - a, 0, { color: '#c2a57c', style: 'retain', solid: false });
    }
  };
  // the catwalk's edge over lower mid (drop down; xbox and a jump get you up)
  retainY(S.catwalk.x0 - 6, S.catwalk.y0, S.catwalk.y1);
  // the catwalk stairs' side wall over mid
  B.ob('wall', S.catStairs.x0 - 6, (S.catStairs.y0 + S.catStairs.y1) / 2, 12, S.catStairs.y1 - S.catStairs.y0, 0, wallOpts('stairwall'));
  // the pit: drop in from long, out by its stairs
  retainY(S.pit.x0 + 6, S.pit.y0, S.pit.y1);
  B.ob('wall', S.pitStairs.x0 + 6, (S.pitStairs.y0 + S.pitStairs.y1) / 2, 12, S.pitStairs.y1 - S.pitStairs.y0, 0, wallOpts('stairwall'));
  // B platform's edge: a low wall (step down off it, climb it by the stairs)
  B.ob('desk', (S.bPlat.x0 + S.bPlat.x1) / 2, S.bPlat.y1 + 6, S.bPlat.x1 - S.bPlat.x0, 12, 0, { color: '#c6a87c', style: 'platedge' });
  B.ob('desk', S.bPlat.x1 + 6, (S.bPlatStairs.y1 + S.bPlat.y1) / 2 + 3, 12, S.bPlat.y1 - S.bPlatStairs.y1 + 6, 0, { color: '#c6a87c', style: 'platedge' });
  // the A platform's step (16 units: walk up, step down)
  put('step', 0, 0, 0, { x0: S.aPlat.x0, y0: S.aPlat.y0, x1: S.aPlat.x1, y1: S.aPlat.y1, h0: L.a, h1: L.aPlat, sides: ['w', 's'] });

  // ---- cover: crates (stand on the big ones), low crates and barrels, carts, planters, the cars
  const crate = (x, y, a = 0, s = 56) => B.ob('container', x, y, s, s, a, { color: CRATE, roof: '#8a6a40', style: 'crate' });
  const low = (x, y, w, h, a = 0, style = 'lowcrate') => B.ob('counter', x, y, w, h, a, { color: '#a07a4c', style });
  // CT spawn: the crates by the ramps, planters, palms
  crate(1980, 330, 0.05);
  crate(1430, 620, 0);
  low(1440, 860, 60, 40, 0, 'barrels');
  low(1990, 860, 90, 40, 0, 'planter');
  B.tree(1450, 820, 1.05);
  B.tree(2010, 300, 1.0);
  B.tree(1430, 290, 0.9);
  // A site: the default crates on the platform, goose in the corner, the ramp's crates
  crate(2640, 330, 0.0);
  crate(2696, 330, 0.0);
  crate(2668, 300, 0.04, 56);
  low(2620, 400, 90, 40, 0);
  crate(2900, 360, 0.08);
  crate(2900, 416, 0.0);
  low(2830, 250, 44, 44, 0, 'barrels');
  crate(2260, 700, 0.1);
  low(2420, 560, 80, 40, 0.2, 'cart');
  low(2250, 260, 120, 40, 0, 'planter');
  B.tree(2240, 330, 1.1);
  B.tree(2920, 720, 1.0);
  // long: the corner car at the top, the blue bin at the bottom, crates in the pit
  B.vehicle('car', 2925, 1110, HALF + 0.12, { jitter: 0, color: '#8a3a2a' });
  B.ob('container', 2740, 2160, 56, 100, 0, { color: '#2f5f8f' });
  crate(2940, 1560, 0.1);
  low(2730, 1300, 44, 44, 0, 'barrels');
  crate(3140, 2310, 0.0);
  crate(3140, 2254, 0.06);
  low(3030, 2310, 44, 44, 0, 'barrels');
  crate(3150, 2580, 0.1);
  low(2950, 2760, 90, 40, 0, 'cart');
  B.tree(2700, 2760, 1.0);
  // mid: xbox by the catwalk, the top mid crates, the barrels at the doors
  crate(1612, 1590, 0, 64);
  crate(1390, 2340, 0.08);
  crate(1710, 2560, 0.0);
  low(1400, 1450, 44, 44, 0, 'barrels');
  low(1420, 1700, 60, 40, 0.1);
  low(1390, 1880, 44, 80, 0, 'barrels');
  low(1810, 1930, 40, 36, 0, 'barrels');
  // the catwalk and short: a crate at the short corner, barrels
  crate(1880, 1060, 0.12);
  low(1790, 1000, 44, 44, 0, 'barrels');
  low(2360, 1040, 60, 40, 0);
  // B site: the B car by the tunnel exit, the double stack, crates under the window, palms
  B.vehicle('car', 380, 840, -HALF + 0.35, { jitter: 0, color: '#5a6a72' });
  crate(560, 560, 0);
  crate(560, 504, 0.03);
  crate(616, 560, 0.0);
  crate(840, 330, 0.1);
  low(840, 880, 50, 90, 0, 'lowcrate');
  low(260, 460, 44, 44, 0, 'barrels');
  B.tree(250, 900, 1.05);
  B.tree(860, 240, 0.95);
  // the tunnels: crates and barrels inside
  low(760, 1550, 60, 40, 0.1);
  crate(940, 1490, 0.0);
  low(860, 2100, 44, 44, 0, 'barrels');
  crate(730, 1200, 0.1);
  low(1300, 1530, 40, 40, 0, 'barrels');
  // T spawn: crates, a cart, palms
  crate(1780, 3080, 0.1);
  crate(1836, 3080, 0.0);
  low(2330, 2980, 90, 40, 0.3, 'cart');
  low(2400, 2700, 44, 44, 0, 'barrels');
  crate(1500, 2700, 0.05);
  low(1120, 2800, 70, 40, 0);
  B.tree(1760, 2720, 1.1);
  B.tree(2400, 3120, 1.0);
  B.tree(2050, 2700, 0.95);
  B.tree(300, 2900, 1.0);
  // CT to B: barrels, a planter
  low(1200, 760, 90, 40, 0, 'planter');
  low(980, 640, 44, 44, 0, 'barrels');

  // ---- roofs: the tunnels are dark inside (the art draws their stone vaults); heights are absolute
  const tunnel = (R, height, axis, name) => {
    B.roof((R.x0 + R.x1) / 2, (R.y0 + R.y1) / 2, R.x1 - R.x0, R.y1 - R.y0, 0, { kind: 'plain', height, dark: 0.86, style: 'tunnel' });
    put('tunnel', 0, 0, 0, { x0: R.x0, y0: R.y0, x1: R.x1, y1: R.y1, height, axis, name });
  };
  tunnel({ x0: 700, y0: 1650, x1: 900, y1: 2380 }, L.up + 130, 'y', 'Upper Tunnels');
  tunnel(S.tunnelRoom, L.up + 136, 'x', 'Upper Tunnels');
  tunnel({ x0: 650, y0: 1100, x1: 850, y1: 1450 }, L.up + 130, 'y', 'B Tunnel');
  tunnel({ x0: 1000, y0: 1500, x1: 1350, y1: 1650 }, L.up + 104, 'x', 'Lower Tunnels');

  // ---- the art's free pieces: arches over the passages, awnings, signs, the sites' marks
  put('arch', 750, 950, 0, { w: 200, h: 140, ground: L.up });                 // the B tunnel's mouth into B site
  put('arch', 800, 2380, 0, { w: 200, h: 140, ground: L.up });                // the upper tunnels' mouth
  put('arch', 1350, 1575, HALF, { w: 150, h: 112, ground: 0 });               // the lower tunnels into mid
  put('arch', 1625, 2650, HALF, { w: 100, h: 130, ground: L.t });             // the T ramp
  put('arch', 2550, 2675, HALF, { w: 250, h: 160, ground: 93 });              // outside long's arch
  put('arch', 2050, 500, HALF, { w: 240, h: 170, ground: L.up });             // CT spawn's arch to A
  put('arch', 1400, 700, HALF, { w: 200, h: 150, ground: L.up });             // CT to B
  put('arch', 1770, 1100, 0, { w: 140, h: 120, ground: L.up });               // the catwalk under the short arch
  put('sitemark', 2240, 205, 0, { letter: 'A', ground: L.a, z: 70 });
  put('sitemark', 2945, 600, -HALF, { letter: 'A', ground: L.a, z: 60 });
  put('sitemark', 205, 700, HALF, { letter: 'B', ground: L.up, z: 70 });
  put('sitemark', 640, 205, 0, { letter: 'B', ground: L.up, z: 60 });
  put('tarp', 1550, 2450, 0, { w: 160, d: 110, h: L.t + 118, posts: 1 });            // shade at top mid
  put('tarp', 2040, 2760, 0, { w: 240, d: 120, h: L.t + 120, posts: 1 });            // T spawn
  put('tarp', 1930, 820, 0, { w: 160, d: 110, h: L.up + 118, posts: 1 });            // CT spawn
  put('tarp', 2840, 2700, 0, { w: 200, d: 110, h: L.up + 120 });                     // outside long
  put('tarp', 3080, 1830, 0, { w: 200, d: 100, h: L.up + 116 });                     // over the pit's ledge
  put('awning', 2200, 2651, 0, { w: 180, h: 96 });                // T spawn
  put('awning', 1351, 2470, -HALF, { w: 150, h: 92 });            // top mid
  put('awning', 1351, 1800, -HALF, { w: 140, h: 92 });            // lower mid, across from xbox
  put('awning', 2049, 780, HALF, { w: 140, h: 92 });              // CT spawn
  put('awning', 3000, 2799, Math.PI, { w: 170, h: 96 });          // outside long
  put('awning', 1101, 450, HALF, { w: 120, h: 92 });              // the window room

  // ---- lights: lanterns by the doors, braziers, the tunnels' bulbs (night and dusk); heights absolute
  const LANTERN = '#ffb562';
  const lantern = (x, y, h = 70, r = 240) => { const z = tH(x, y) + h; B.light(x, y, r, LANTERN, 0.12, z); put('lantern', x, y, 0, { h: z }); };
  lantern(1440, 1440, 120);
  lantern(1620, 1440, 120);
  lantern(2715, 2400, 100);
  lantern(2885, 2400, 100);
  lantern(905, 600, 100);
  lantern(905, 800, 100);
  lantern(1700, 270, 90);
  lantern(2030, 760, 90);
  lantern(2930, 500, 90);
  lantern(2220, 400, 90);
  lantern(2960, 1300, 90);
  lantern(2715, 1900, 90);
  lantern(3165, 2100, 90, 200);
  lantern(712, 1720, 110, 200);
  lantern(888, 2200, 110, 200);
  lantern(662, 1300, 110, 200);
  lantern(1250, 1520, 90, 200);
  lantern(612, 1550, 110, 200);
  lantern(1820, 1200, 90);
  lantern(1365, 2200, 90);
  lantern(1735, 2400, 90);
  lantern(2430, 2900, 90);
  lantern(220, 400, 90);
  lantern(880, 930, 90);
  lantern(1100, 2770, 90);
  lantern(3200, 2540, 90);
  B.fire(2100, 2930, 14);       // braziers
  B.fire(1980, 600, 14);
  B.fire(1500, 2520, 14);

  // ---- points of interest (also the HUD's place names) and named anchors
  B.poi('CT Spawn', 1720, 580, 320);
  B.poi('A Site', 2560, 520, 340);
  B.poi('B Site', 560, 640, 340);
  B.poi('Mid', 1505, 1700, 300);
  B.poi('Long A', 2840, 1600, 300);
  B.poi('Tunnels', 800, 1900, 300);
  B.poi('T Spawn', 2080, 2900, 340);
  B.anchor('ctSpawn', 1720, 600, 260);
  B.anchor('aSite', 2470, 620, 240);
  B.anchor('goose', 2870, 260, 60);
  B.anchor('aPlat', 2780, 320, 120);
  B.anchor('longRamp', 2810, 880, 90);
  B.anchor('longCorner', 2800, 1120, 120);
  B.anchor('long', 2840, 1650, 160);
  B.anchor('pit', 3080, 2200, 100);
  B.anchor('longDoors', 2800, 2400, 60);
  B.anchor('outsideLong', 2950, 2660, 160);
  B.anchor('bSite', 640, 700, 260);
  B.anchor('bPlat', 330, 280, 100);
  B.anchor('bDoors', 980, 700, 70);
  B.anchor('bWindow', 1020, 400, 60);
  B.anchor('bTunnel', 750, 1300, 90);
  B.anchor('upperTunnels', 800, 2000, 100);
  B.anchor('lowerTunnels', 1250, 1575, 70);
  B.anchor('ctMid', 1505, 1260, 120);
  B.anchor('midDoors', 1505, 1460, 80);
  B.anchor('lowerMid', 1505, 1700, 140);
  B.anchor('xbox', 1560, 1650, 60);
  B.anchor('catwalk', 1750, 1500, 80);
  B.anchor('short', 2100, 1025, 100);
  B.anchor('topMid', 1550, 2420, 160);
  B.anchor('tSpawn', 2080, 2900, 260);
  B.anchor('outsideTunnels', 600, 2850, 140);

  // ---- decor (the set dressing is sandstoneDressItems below: client-side, never in the MapDef)
  B.sprinkle('crack', 24, 0, 0, W, Hh, { on: ['concrete'], s: [0.5, 1.0] });
  B.sprinkle('debris', 130, 0, 0, W, Hh, { s: [0.6, 1.1] });
  B.sprinkle('rubble', 40, 0, 0, W, Hh, { s: [0.5, 1] });
  B.sprinkle('paper', 90, 0, 0, W, Hh, { s: [0.6, 1] });
  B.sprinkle('oil', 10, 0, 0, W, Hh, { on: ['concrete', 'gravel'], s: [0.5, 0.9] });
  B.sprinkle('blood_old', 26, 0, 0, W, Hh, { s: [0.6, 1.4] });
  B.sprinkle('rock', 60, 0, 0, W, Hh, { on: ['sand', 'gravel', 'dirt'], s: [0.4, 0.8] });
  B.sprinkle('bush', 10, 0, 0, W, Hh, { on: ['sand', 'dirt'], s: [0.5, 0.9], keep: true });
  // the hand-placed decals (maps-decals.js)
  sandstoneDecals(B);
}

// ---------------------------------------------------------------------------------------------
// Set dressing (shared/dress.js buildDress dispatches here for this map): a desert town's
// clutter instead of the generic road debris and street furniture. A pure function of the
// finished MapDef, so every peer lays the same props; nothing of it collides.

function inRect(o, x, y, pad) {
  const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0);
  const dx = x - o.x, dy = y - o.y;
  return Math.abs(dx * c + dy * s) <= o.w / 2 + pad && Math.abs(-dx * s + dy * c) <= o.h / 2 + pad;
}

/**
 * The set dressing of Sandstone (shared/dress.js item format: { k, x, y, a, s, v, q }).
 * @param {object} map the Sandstone MapDef
 * @returns {object[]}
 */
export function sandstoneDressItems(map) {
  const S = SANDSTONE;
  const items = [];
  const rng = createRng(hashString(`sandstone:dress:${map.seed}`));
  // (no props on a flight of stairs or a ramp: they would float over the steps)
  const flights = Object.values(S).filter((R) => R.axis);
  /** Free ground: no obstacle, spawn, supply or objective under or next to it. */
  const clear = (x, y, pad) => {
    if (x < 20 || y < 20 || x > map.width - 20 || y > map.height - 20) return false;
    for (const F of flights) if (x > F.x0 - pad && x < F.x1 + pad && y > F.y0 - pad && y < F.y1 + pad) return false;
    for (const o of map.obstacles) {
      if (Math.abs(o.x - x) > o.w + o.h + pad || Math.abs(o.y - y) > o.w + o.h + pad) continue;
      if (inRect(o, x, y, pad)) return false;
    }
    if (map.objective && inRect(map.objective, x, y, pad + 12)) return false;
    if (map.supply && Math.hypot(map.supply.x - x, map.supply.y - y) < 80) return false;
    for (const p of map.playerSpawns) if (Math.hypot(p.x - x, p.y - y) < 56) return false;
    for (const z of map.zombieSpawns) if (inRect({ ...z, a: 0 }, x, y, 24)) return false;
    return true;
  };
  const put = (k, x, y, a, s, q = null, wall = false) => {
    if (!wall && !clear(x, y, 10)) return false;
    items.push({ k, x: r1(x), y: r1(y), a: r3(a), s: r3(s), v: (rng.next() * 65536) | 0, q: q === null ? r3(rng.next() * 0.999) : q });
    return true;
  };
  const scatter = (k, n, R, s = [0.8, 1.2], inset = 30) => {
    for (let i = 0; i < n; i++) {
      for (let tr = 0; tr < 10; tr++) {
        const x = rng.range(R.x0 + inset, R.x1 - inset), y = rng.range(R.y0 + inset, R.y1 - inset);
        if (put(k, x, y, rng.range(0, Math.PI * 2), rng.range(s[0], s[1]))) break;
      }
    }
  };
  const OPEN = [S.ctSpawn, S.aSite, S.bSite, S.long, S.longBottom, S.lowerMid, S.topMid, S.tSpawn, S.outsideLong, S.outsideTunnels, S.ctB, S.short, S.pit, S.upperTunnel];
  for (const R of OPEN) {
    scatter('litter', 5, R);
    scatter('stain', 4, R, [0.8, 1.6]);
    scatter('pebbles', 5, R);
    scatter('blood', 2, R, [0.7, 1.4]);
    scatter('newsp', 2, R);
    scatter('paperf', 2, R);
    scatter('soot', 1, R, [0.8, 1.5]);
    scatter('bag', 1, R);
  }
  // T spawn and outside long: a caravan stop's goods, boxes, rugs of clothes, chairs knocked over
  for (const R of [S.tSpawn, S.outsideLong, S.topMid, S.outsideTunnels]) {
    scatter('box', 5, R);
    scatter('box_open', 3, R);
    scatter('box_stack', 2, R);
    scatter('clothes', 2, R);
    scatter('chair', 3, R);
    scatter('toy', 1, R);
  }
  scatter('umbrella', 2, S.tSpawn, [0.9, 1.1], 120);
  scatter('grill', 1, S.tSpawn, [0.9, 1.1], 120);
  // long and the pit: pallets, drums, fuel cans
  for (const R of [S.long, S.longBottom, S.pit]) {
    scatter('drum', 3, R);
    scatter('pallet', 2, R);
    scatter('fuel_can', 2, R);
  }
  scatter('drums', 1, S.pit, [0.9, 1.0], 60);
  scatter('gascyl', 2, S.outsideLong);
  scatter('generator', 1, S.outsideLong, [0.9, 1.0], 80);
  scatter('wheel_loose', 2, S.long);
  // the defenders' side: luggage of the people who fled, the last stands on the sites
  scatter('suitcase', 3, S.ctSpawn);
  scatter('duffel', 2, S.ctSpawn);
  scatter('backpack', 2, S.ctSpawn);
  scatter('shoes', 3, S.ctSpawn);
  scatter('milcrate', 3, S.aSite, [0.9, 1.1], 60);
  scatter('mil_box', 2, S.aSite, [0.9, 1.1], 60);
  scatter('helmet', 2, S.aSite);
  scatter('sandarc', 1, S.aSite, [0.9, 1.1], 100);
  scatter('bodybag', 1, S.bSite);
  scatter('crate', 4, S.bSite);
  scatter('wheelbarrow', 1, S.bSite);
  scatter('planter', 2, S.bSite);
  scatter('bicycle', 1, S.ctB);
  scatter('woodpile', 1, S.tSpawn, [0.9, 1.1], 60);
  scatter('drum', 3, S.lowerMid);
  scatter('shoes', 3, S.lowerMid);
  scatter('bin_fall', 2, S.topMid);
  scatter('car_door', 1, S.lowerMid);
  scatter('bones', 3, S.pit);
  scatter('cooler', 1, S.tSpawn);
  scatter('teddy', 1, S.ctSpawn);
  scatter('picnic', 1, S.tSpawn, [0.9, 1.0], 160);
  scatter('trough', 1, S.outsideLong, [0.9, 1.1], 80);
  scatter('ibc', 1, S.outsideLong, [0.9, 1.0], 80);
  scatter('reel', 1, S.longBottom, [0.9, 1.0], 60);
  scatter('crates', 2, S.tSpawn);
  scatter('box', 3, S.bSite);
  scatter('drums', 1, S.outsideTunnels, [0.9, 1.0], 60);
  // the desert creeping in: tumbleweed, dry shrubs and a few cacti in the corners
  for (const R of OPEN) scatter('tumbleweed', 1, R, [0.7, 1.1]);
  for (const R of [S.tSpawn, S.outsideLong, S.outsideTunnels, S.bSite]) {
    scatter('shrub', 2, R, [0.6, 1.0], 50);
    scatter('cactus', 1, R, [0.7, 1.0], 60);
    scatter('boulders', 1, R, [0.6, 0.9], 80);
  }
  // on the walls along the streets: graffiti, posters, boarded doors (they hang on their wall)
  for (const o of map.obstacles) {
    if (o.kind !== 'building' || o.w < 160 || o.h < 120) continue;
    for (const [dx, dy, nrm, len] of [[0, o.h / 2, HALF, o.w], [0, -o.h / 2, -HALF, o.w], [o.w / 2, 0, 0, o.h], [-o.w / 2, 0, Math.PI, o.h]]) {
      // only a face on open ground (a street or a square), not one against its neighbour
      const fx = o.x + dx + Math.cos(nrm) * 40, fy = o.y + dy + Math.sin(nrm) * 40;
      if (!clear(fx, fy, 4)) continue;
      const along = rng.range(-len * 0.36, len * 0.36);
      const tx = -Math.sin(nrm), ty = Math.cos(nrm);
      const px = o.x + dx + tx * along + Math.cos(nrm) * 1.2, py = o.y + dy + ty * along + Math.sin(nrm) * 1.2;
      const roll = rng.next();
      if (roll < 0.22) put('graf', px, py, nrm, 1, r3(0.5 + rng.next() * 0.45), true);
      else if (roll < 0.4) put('wposter', px, py, nrm, 1, r3(0.5 + rng.next() * 0.45), true);
      else if (roll < 0.48) put('board_door', px, py, nrm, 1, r3(0.6 + rng.next() * 0.35), true);
      else if (roll < 0.6) put('plywood', o.x + dx + tx * along + Math.cos(nrm) * 14, o.y + dy + ty * along + Math.sin(nrm) * 14, nrm, 1);
    }
  }
  return items;
}
