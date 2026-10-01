// 6. Sandstone (the Horde Elimination map, SPEC §2 / §3.12)
//
// A sun-baked walled town of sandstone and adobe, 4000 x 4000, built for a crew holding out
// against a finite horde: the defenders start in Fountain Square at the north end, with the
// radio mast and the supply station, and two defensible courtyards ("sites") to hold:
//
//   THE TERRACE    (north-east) a paved terrace 76 units up, reached by the A stairs from the
//                  square, the ramp at the top of the Long Hall and the rampart walk over it;
//                  a back stair climbs to it from the east edge (an entrance).
//   CISTERN COURT  (north-west) an enclosed courtyard with several ways in: the upper tunnel
//                  from Well Square, the big double doorway and a window from the square's west
//                  wing, and a breach in its west wall (an entrance).
//
// Between them runs Mid Street, a long sightline from the Great Doors (big wooden double doors
// at the square's south side) down to the South Souk plaza. The Long Hall is a long walled
// corridor along the east side, with a raised rampart walk along its west wall and the Long
// Doors at its south end onto the Caravan Yard. Two tunnels, dark inside, meet in the enclosed
// Well Square: the upper one north into Cistern Court, the lower one east into Mid Street; a
// market lane under tarps leads south from it to the souk.
//
// The horde comes in through six entrances at the edges (`map.horde.lanes`, every zombie spawn
// rect tagged with its lane): the South Gate, the Caravan Gate, the Well Gate, the West Breach,
// the East Stairs and, late in a round, the North Arch behind the defenders.
//
// Inspired by the feel of the classic competitive desert maps (tight lanes, long sightlines,
// two sites, mid doors), but its own layout, names and places. Everything here is fixed layout
// (the same for every seed) except the dressing scatter; the art module draws it from the
// obstacles' `style` / `prop` tags and the `map.sandArt` list (render3d/maps/sandstone.js).

import { createRng, hashString } from './rng.js';

/** World size and mood (maps.js MAP_DEFS). */
export const SANDSTONE_DEF = { width: 4000, height: 4000, darkness: 0.6, tint: '#9a6a3a', ground: '#c7a77a' };

/** Height of the raised terrace and the rampart walk (units). */
export const SANDSTONE_H = 76;

/** Key open places (axis-aligned rectangles, x0..x1 × y0..y1). Tests and the art read them. */
export const SANDSTONE = Object.freeze({
  square: { x0: 1250, y0: 140, x1: 2550, y1: 820 },
  terrace: { x0: 2800, y0: 340, x1: 3700, y1: 1000 },
  rampart: { x0: 3240, y0: 1000, x1: 3350, y1: 2380 },
  ramp: { x0: 3350, y0: 1000, x1: 3650, y1: 1360 },
  long: { x0: 3350, y0: 1360, x1: 3650, y1: 3230 },
  aStairs: { x0: 2550, y0: 560, x1: 2800, y1: 720 },
  shortStairs: { x0: 3000, y0: 2210, x1: 3240, y1: 2370 },
  backStairs: { x0: 3700, y0: 430, x1: 3880, y1: 590 },
  mid: { x0: 1800, y0: 860, x1: 2200, y1: 3150 },
  court: { x0: 300, y0: 250, x1: 1230, y1: 1150 },
  upperTunnel: { x0: 550, y0: 1150, x1: 750, y1: 1950 },
  lowerTunnel: { x0: 1300, y0: 2050, x1: 1800, y1: 2220 },
  well: { x0: 300, y0: 1950, x1: 1300, y1: 2650 },
  souk: { x0: 950, y0: 2650, x1: 1150, y1: 3150 },
  plaza: { x0: 950, y0: 3150, x1: 2700, y1: 3820 },
  yard: { x0: 3100, y0: 3270, x1: 3900, y1: 3850 },
});

/** The horde's entrances, in lane order (zombie spawn rects carry `lane`: the index). */
export const SANDSTONE_LANES = Object.freeze([
  { name: 'South Gate', x: 2000, y: 3900 },
  { name: 'Caravan Gate', x: 3530, y: 3900 },
  { name: 'Well Gate', x: 80, y: 2535 },
  { name: 'West Breach', x: 80, y: 950 },
  { name: 'East Stairs', x: 3920, y: 510 },
  { name: 'North Arch', x: 1350, y: 80, late: true },
]);

const H = SANDSTONE_H;
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
 * Build Sandstone into builder B (see maps.js createBuilder).
 * @param {object} B map builder
 */
export function buildSandstone(B) {
  const map = B.map;
  const art = map.sandArt = [];
  const put = (t, x, y, a = 0, extra = {}) => {
    const it = { t, x: r1(x), y: r1(y), a: r3(a), ...extra };
    art.push(it);
    return it;
  };
  const S = SANDSTONE;

  // ---- the terrain: the terrace, the rampart walk and their stairs and ramp (shared/terrain.js)
  const terrain = map.terrain = { hills: [], plateaus: [] };
  const plateau = (x0, y0, x1, y1, h) => terrain.plateaus.push({ x0: r1(x0), y0: r1(y0), x1: r1(x1), y1: r1(y1), h: r3(h), edge: 0 });
  // (a zero-height plateau just outside a raised block: the ground mesh climbs the cliff at its edge)
  const guard = (x0, y0, x1, y1) => terrain.plateaus.push({ x0: r1(x0 - 1), y0: r1(y0 - 1), x1: r1(x1 + 1), y1: r1(y1 + 1), h: 0, edge: 0 });
  /** Steps rising along x (dir +1 = toward +x) from h0 at one end to h1 at the other, across y0..y1. */
  const flightX = (xa, xb, y0, y1, h0, h1, dir, n) => {
    const run = (xb - xa) / n, dh = (h1 - h0) / n;
    for (let j = 1; j <= n; j++) {
      if (dir > 0) plateau(xa + j * run, y0, xb, y1, h0 + j * dh);
      else plateau(xa, y0, xb - j * run, y1, h0 + j * dh);
    }
  };
  /** The same along y (dir +1 = rising toward +y), across x0..x1. */
  const flightY = (ya, yb, x0, x1, h0, h1, dir, n) => {
    const run = (yb - ya) / n, dh = (h1 - h0) / n;
    for (let j = 1; j <= n; j++) {
      if (dir > 0) plateau(x0, ya + j * run, x1, yb, h0 + j * dh);
      else plateau(x0, ya, x1, yb - j * run, h0 + j * dh);
    }
  };
  plateau(S.terrace.x0, S.terrace.y0, S.terrace.x1, S.terrace.y1, H);
  plateau(S.rampart.x0, S.rampart.y0, S.rampart.x1, S.rampart.y1, H);
  guard(S.terrace.x0, S.terrace.y0, S.terrace.x1, S.terrace.y1);
  guard(S.rampart.x0, S.rampart.y0, S.rampart.x1, S.rampart.y1);
  const AS = S.aStairs, SS = S.shortStairs, BS = S.backStairs, RP = S.ramp;
  flightX(AS.x0, AS.x1, AS.y0, AS.y1, 0, H, 1, 16);        // the A stairs: up east from the square
  flightX(SS.x0, SS.x1, SS.y0, SS.y1, 0, H, 1, 16);        // the short stairs: up east onto the rampart
  flightX(BS.x0, BS.x1, BS.y0, BS.y1, 0, H, -1, 14);       // the back stairs: up west from the East Stairs alley
  flightY(RP.y0, RP.y1, RP.x0, RP.x1, 0, H, -1, 24);       // the ramp: up north out of the Long Hall
  put('stairs', (AS.x0 + AS.x1) / 2, (AS.y0 + AS.y1) / 2, 0, { ...AS, h0: 0, h1: H, axis: 'x', dir: 1, n: 16 });
  put('stairs', (SS.x0 + SS.x1) / 2, (SS.y0 + SS.y1) / 2, 0, { ...SS, h0: 0, h1: H, axis: 'x', dir: 1, n: 16 });
  put('stairs', (BS.x0 + BS.x1) / 2, (BS.y0 + BS.y1) / 2, 0, { ...BS, h0: 0, h1: H, axis: 'x', dir: -1, n: 14 });
  put('ramp', (RP.x0 + RP.x1) / 2, (RP.y0 + RP.y1) / 2, 0, { ...RP, h0: 0, h1: H, axis: 'y', dir: -1 });
  put('terrace', 0, 0, 0, { ...S.terrace, h: H });
  put('rampart', 0, 0, 0, { ...S.rampart, h: H });

  // ---- the defenders' start: Fountain Square (the radio mast, the supply station, the spawns)
  B.objective('radio', 'Radio Mast', 2150, 230, 70, 70, 0, 4500, 110);
  B.supply(2300, 560);
  for (const [x, y] of [[1840, 360], [1940, 400], [2040, 420], [2140, 420], [2240, 400], [2340, 360], [1890, 470], [2190, 480]]) B.pspawn(x, y);
  map.horde = { lanes: SANDSTONE_LANES.map((l) => ({ ...l })), hold: { x: 2000, y: 470, r: 380 } };
  // (the classic desert of the 3D view: palms and nothing else; the art module that draws the town)
  // (no grass field and few weeds; the streets in sand, the squares in warm stone paving; a dry night)
  map.look = {
    trees: ['palm'], grass: false, weeds: 0.15, nightWet: 0.25,
    // (a clear desert night: a blue-black sky over the warm lanterns rather than the dust-brown of the tint)
    night: { fog: '#151a24', horizon: '#1e2636', zenith: '#02040a', sky: '#8193b4', moon: '#a8bbe0', moonI: 0.62 },
    areas: { concrete: '#ad9573', sand: '#bd9f72', gravel: '#9c8566', dirt: '#a08462' },
  };
  map.art = 'sandstone';

  // ---- the horde's entrances (spawn rects at the edges, each tagged with its lane)
  const zs = (lane, x, y, w, h) => {
    const r = B.zspawn(x, y, w, h);
    r.lane = lane;
  };
  zs(0, 2000, 3935, 240, 70);    // South Gate
  zs(1, 3530, 3935, 180, 70);    // Caravan Gate
  zs(2, 60, 2535, 70, 190);      // Well Gate
  zs(3, 60, 950, 70, 170);       // West Breach
  zs(4, 3935, 510, 80, 130);     // East Stairs
  zs(5, 1350, 60, 160, 70);      // North Arch (late in a round)
  // the town's gates at the entrances (the art: towers, an arch, the West Breach a broken wall)
  put('gatearch', 2000, 3895, 0, { w: 280, name: 'South Gate' });
  put('gatearch', 3530, 3900, 0, { w: 220, name: 'Caravan Gate' });
  put('gatearch', 40, 2535, HALF, { w: 230, name: 'Well Gate' });
  put('gatearch', 40, 950, HALF, { w: 200, name: 'West Breach', broken: 1 });
  put('gatearch', 3975, 510, HALF, { w: 160, name: 'East Stairs' });
  put('gatearch', 1350, 40, 0, { w: 200, name: 'North Arch' });

  // ---- ground: sand streets, paved squares and terrace, a gravel yard
  B.box('sand', 0, 0, 4000, 4000);
  B.box('concrete', S.square.x0, S.square.y0, S.square.x1, S.square.y1);
  B.box('concrete', S.terrace.x0, S.terrace.y0, S.terrace.x1, S.terrace.y1);
  B.box('concrete', S.rampart.x0, S.rampart.y0, S.rampart.x1, S.rampart.y1);
  B.box('concrete', S.court.x0, S.court.y0, S.court.x1, S.court.y1);
  B.box('concrete', S.well.x0 + 120, S.well.y0 + 120, S.well.x1 - 120, S.well.y1 - 120);
  B.box('gravel', S.yard.x0, S.yard.y0, S.yard.x1, S.yard.y1);
  B.box('dirt', S.plaza.x0 + 200, S.plaza.y0 + 120, S.plaza.x1 - 300, S.plaza.y1 - 140);

  // ---- the town: blocks of houses between the lanes (solid, flat roofs of different heights)
  /**
   * A block of houses over the rectangle, split along its long side (and in two across a deep
   * one) at fixed places; `lo`..`hi` storeys of height (units of 36 above a 110 ground floor).
   */
  const block = (x0, y0, x1, y1, lo = 0, hi = 3) => {
    const w = x1 - x0, h = y1 - y0;
    const along = w >= h;
    const L = along ? w : h, D = along ? h : w;
    const cuts = [0];
    let t = 0;
    for (let k = 0; L - t > 460; k++) {
      t += 190 + Math.round(fh(x0, y0, k, 1) * 230);
      if (L - t < 150) break;
      cuts.push(t);
    }
    cuts.push(L);
    const deep = D > 520 ? [0, Math.round(D * (0.42 + fh(x0, y1, 7) * 0.16)), D] : [0, D];
    for (let i = 0; i + 1 < cuts.length; i++) {
      for (let j = 0; j + 1 < deep.length; j++) {
        const a0 = cuts[i], a1 = cuts[i + 1], b0 = deep[j], b1 = deep[j + 1];
        const hx0 = along ? x0 + a0 : x0 + b0, hx1 = along ? x0 + a1 : x0 + b1;
        const hy0 = along ? y0 + b0 : y0 + a0, hy1 = along ? y0 + b1 : y0 + a1;
        const k = fh(hx0, hy0, hx1, hy1);
        const storeys = lo + Math.floor(fh(hy0, hx1, 3) * (hi - lo + 1));
        B.ob('building', (hx0 + hx1) / 2, (hy0 + hy1) / 2, hx1 - hx0, hy1 - hy0, 0, {
          color: WALLS[Math.floor(k * WALLS.length)], roof: ROOFS[Math.floor(fh(hx1, hy1) * ROOFS.length)],
          top: 110 + storeys * 36, style: 'house',
        });
      }
    }
  };
  block(0, 0, 1250, 250, 1, 2);           // north of Cistern Court
  block(1450, 0, 2800, 140, 1, 3);        // north of the square
  block(2550, 140, 2800, 560, 1, 2);      // the square's east side, north of the A stairs
  block(2550, 720, 2800, 820, 0, 1);      // ... south of them
  block(2200, 820, 2800, 2210, 0, 2);     // between Mid Street and the terrace
  block(2800, 0, 4000, 340, 0, 2);        // north of the terrace (low: you see over the roofs)
  block(3700, 340, 4000, 430, 0, 1);
  block(3700, 590, 4000, 1000, 0, 1);
  block(2800, 1000, 3240, 2210, 1, 3);    // behind the rampart walk
  // the Long Hall's east wall, with an alcove half way down (the Pit: a flank spot with crates)
  block(3650, 1000, 4000, 2480, 1, 3);
  block(3800, 2480, 4000, 2760, 0, 1);
  block(3650, 2760, 4000, 3230, 1, 3);
  block(2200, 2370, 3350, 3150, 0, 2);    // between the short alley and the souk
  block(2700, 3150, 3350, 3270, 0, 1);
  block(2700, 3270, 3100, 3560, 0, 1);
  block(2700, 3680, 3100, 3850, 0, 1);
  block(0, 3820, 1860, 4000, 0, 1);       // the south edge
  block(2140, 3820, 2700, 4000, 0, 1);
  block(2700, 3850, 3420, 4000, 0, 1);
  block(3640, 3850, 4000, 4000, 0, 1);
  block(3900, 3270, 4000, 3850, 0, 1);
  block(0, 250, 300, 850, 0, 2);          // west of Cistern Court
  block(0, 1050, 300, 2420, 0, 2);
  block(0, 2650, 950, 3820, 0, 2);        // the south-west quarter
  block(300, 1150, 550, 1950, 1, 2);      // either side of the upper tunnel
  block(750, 1150, 1250, 1950, 1, 2);
  block(1250, 820, 1800, 1950, 1, 3);     // between the square's west wing and Mid Street
  block(1300, 1950, 1800, 2050, 0, 1);
  block(1300, 2220, 1800, 2650, 0, 2);
  block(1150, 2650, 1800, 3150, 0, 2);
  // (the block between the tunnels' mouths and Cistern Court is the tunnels' roof)

  // ---- walls and doors: Cistern Court's east wall (the double doorway, the window), the Great
  // Doors across Mid Street and the Long Doors at the foot of the Long Hall
  const wallOpts = (style, extra = {}) => ({ color: '#cbb089', style, ...extra });
  B.ob('wall', 1240, 335, 20, 170, 0, wallOpts('courtwall'));            // y 250..420
  B.ob('counter', 1240, 460, 20, 80, 0, { color: '#c4a982', style: 'sill' });   // the window (y 420..500): vault it, shoot through it
  B.ob('wall', 1240, 570, 20, 140, 0, wallOpts('courtwall'));            // y 500..640
  B.ob('wall', 1240, 975, 20, 350, 0, wallOpts('courtwall'));            // y 800..1150
  put('window', 1240, 460, HALF, { w: 80, sill: 40, h: 64 });
  put('doorway', 1240, 720, HALF, { w: 160, h: 132, kind: 'double' });
  // the doorway's leaves stand open into the court
  B.ob('wall', 1195, 645, 70, 10, 0, wallOpts('doorleaf', { color: '#2f6f9a' }));
  B.ob('wall', 1195, 795, 70, 10, 0, wallOpts('doorleaf', { color: '#2f6f9a' }));
  // the Great Doors (mid doors): a gatehouse wall across the street, the leaves swung open north
  B.ob('wall', 1860, 840, 120, 40, 0, wallOpts('gatehouse'));
  B.ob('wall', 2140, 840, 120, 40, 0, wallOpts('gatehouse'));
  B.ob('wall', 1925, 782, 10, 76, 0, wallOpts('bigdoor', { color: WOOD }));
  B.ob('wall', 2075, 782, 10, 76, 0, wallOpts('bigdoor', { color: WOOD }));
  put('doorway', 2000, 840, 0, { w: 160, h: 170, kind: 'great', th: 40 });
  // the Long Doors: a wall across the foot of the Long Hall, the leaves open into it
  B.ob('wall', 3390, 3250, 80, 40, 0, wallOpts('gatehouse'));
  B.ob('wall', 3610, 3250, 80, 40, 0, wallOpts('gatehouse'));
  B.ob('wall', 3435, 3192, 10, 76, 0, wallOpts('bigdoor', { color: WOOD }));
  B.ob('wall', 3565, 3192, 10, 76, 0, wallOpts('bigdoor', { color: WOOD }));
  put('doorway', 3500, 3250, 0, { w: 140, h: 160, kind: 'great', th: 40 });

  // ---- the terrace's edge over the Long Hall: a retaining wall below (climbable from its foot
  // by the horde, not by a survivor) and a parapet on the rampart walk (shoot over it)
  const RA = S.rampart;
  for (let y = RA.y0 + 80; y < RA.y1 - 10; y += 200) {
    const y1 = Math.min(RA.y1 - 10, y + 200);
    B.ob('parapet', RA.x1 - 7, (y + y1) / 2, 14, y1 - y, 0, { color: '#cdb38b', style: 'parapet' });
  }
  for (let y = S.ramp.y1; y < RA.y1 - 10; y += 255) {
    const y1 = Math.min(RA.y1 - 10, y + 255);
    B.ob('hesco', RA.x1 + 8, (y + y1) / 2, 16, y1 - y, 0, { color: '#c2a57c', style: 'retain' });
  }

  // ---- cover: crates (stand on the big ones), low crates and barrels, stalls, carts, a well
  const crate = (x, y, a = 0, s = 56) => B.ob('container', x, y, s, s, a, { color: CRATE, roof: '#8a6a40', style: 'crate' });
  const low = (x, y, w, h, a = 0, style = 'lowcrate') => B.ob('counter', x, y, w, h, a, { color: '#a07a4c', style });
  const stall = (x, y, a = 0, w = 120) => B.ob('booth', x, y, w, 56, a, { color: '#8a6440', roof: STALL_ROOF[Math.floor(fh(x, y) * STALL_ROOF.length)], style: 'stall' });
  // Fountain Square: the dry fountain, planters, a few crates by the exits
  low(1640, 560, 120, 120, 0, 'fountain');
  crate(2470, 690, 0.1);
  low(2470, 760, 44, 40, 0.3, 'barrels');
  low(1330, 760, 70, 40, 0, 'lowcrate');
  crate(1500, 330, 0);
  B.tree(1560, 210, 1.1);
  B.tree(2460, 220, 1.0);
  // the Terrace (site): crate stacks, low cover, a cart, palms in raised beds
  crate(3040, 600, 0);
  crate(3098, 600, 0);
  crate(3070, 655, 0.05);
  low(3420, 800, 90, 40, 0);
  low(2960, 900, 40, 80, 0, 'barrels');
  low(3560, 520, 80, 60, 0.4, 'cart');
  crate(3260, 420, 0.2);
  low(3300, 930, 110, 40, 0, 'planter');
  B.tree(3600, 400, 1.15);
  B.tree(2900, 420, 0.95);
  // the Long Hall: crates at the ramp's foot, a burnt-out car halfway, barrels by the doors
  crate(3420, 1480, 0.15);
  low(3600, 1720, 50, 90, 0, 'lowcrate');
  B.vehicle('car', 3530, 2560, -HALF + 0.35, { wrecked: true, jitter: 0 });
  low(3600, 2120, 44, 44, 0, 'barrels');
  low(3410, 2900, 44, 80, 0, 'barrels');
  crate(3600, 3090, 0.1);
  crate(3740, 2540, 0);
  low(3760, 2700, 44, 44, 0, 'barrels');
  // Mid Street: a pair of crates, a cart, the corner crate at the short alley
  crate(1880, 1520, 0.08);
  low(1885, 1580, 60, 40, 0);
  crate(2140, 2150, 0);
  low(2120, 2640, 50, 110, 0, 'cart');
  low(1870, 2980, 44, 44, 0, 'barrels');
  // the short alley: barrels and crates for the climb
  low(2560, 2250, 44, 44, 0, 'barrels');
  crate(2860, 2330, 0.1);
  // Cistern Court (site): the burnt-out car, crates, stalls along the west wall, palms
  B.vehicle('car', 720, 560, 0.4, { wrecked: true, jitter: 0 });
  crate(400, 330, 0);
  crate(458, 330, 0);
  crate(400, 388, 0.1);
  crate(1110, 1040, 0.2);
  low(980, 300, 120, 40, 0, 'planter');
  stall(360, 720, HALF);
  low(1150, 520, 44, 44, 0, 'barrels');
  low(820, 960, 100, 40, 0.1);
  B.tree(1050, 400, 1.05);
  B.tree(430, 1060, 0.95);
  // the upper tunnel: crates inside; the lower tunnel: barrels
  low(600, 1420, 44, 44, 0, 'barrels');
  crate(700, 1700, 0.1);
  low(1500, 2190, 60, 40, 0);
  // Well Square: the well, stalls, a cart, palms
  low(800, 2300, 72, 72, 0, 'well');
  stall(420, 2120, HALF);
  stall(1180, 2560, 0);
  low(560, 2560, 90, 50, 0.3, 'cart');
  crate(1180, 2000, 0);
  B.tree(1050, 2180, 1.0);
  B.tree(520, 2380, 1.1);
  // the souk lane: low crates of goods
  low(1110, 2860, 40, 70, 0, 'lowcrate');
  low(990, 3020, 40, 50, 0, 'barrels');
  // the South Souk: rows of stalls, crates, a burnt van, palms
  for (const [x, y, a] of [[1250, 3330, 0], [1430, 3330, 0], [1250, 3560, 0], [1430, 3560, 0], [2300, 3330, 0], [2480, 3330, 0], [2400, 3600, HALF]]) stall(x, y, a);
  crate(1700, 3450, 0.2);
  crate(2050, 3640, 0);
  low(1960, 3330, 50, 50, 0, 'barrels');
  B.vehicle('van', 1720, 3700, 0.25, { wrecked: true, jitter: 0 });
  B.tree(1100, 3700, 1.1);
  B.tree(2600, 3720, 1.0);
  // the Caravan Yard: a burnt pickup, crates, barrels, palms, a fire
  B.vehicle('pickup', 3300, 3560, 0.5, { wrecked: true, jitter: 0 });
  B.fire(3300 + Math.cos(0.5) * 22, 3560 + Math.sin(0.5) * 22, 22);   // (still burning; a fixed fire, the same on every seed)
  crate(3700, 3420, 0);
  crate(3758, 3420, 0);
  low(3520, 3700, 44, 44, 0, 'barrels');
  low(3780, 3700, 110, 40, 0.2, 'cart');
  B.tree(3200, 3780, 1.05);
  B.tree(3830, 3320, 1.0);
  // the side street: a cart
  low(2900, 3620, 70, 40, 0, 'lowcrate');

  // ---- roofs: the two tunnels are dark inside (the art draws their stone vaults)
  B.roof((S.upperTunnel.x0 + S.upperTunnel.x1) / 2, (S.upperTunnel.y0 + S.upperTunnel.y1) / 2, S.upperTunnel.x1 - S.upperTunnel.x0, S.upperTunnel.y1 - S.upperTunnel.y0, 0, { kind: 'plain', height: 120, dark: 0.85, style: 'tunnel' });
  B.roof((S.lowerTunnel.x0 + S.lowerTunnel.x1) / 2, (S.lowerTunnel.y0 + S.lowerTunnel.y1) / 2, S.lowerTunnel.x1 - S.lowerTunnel.x0, S.lowerTunnel.y1 - S.lowerTunnel.y0, 0, { kind: 'plain', height: 112, dark: 0.85, style: 'tunnel' });
  put('tunnel', 0, 0, 0, { ...S.upperTunnel, height: 120, axis: 'y', name: 'Upper Tunnel' });
  put('tunnel', 0, 0, 0, { ...S.lowerTunnel, height: 112, axis: 'x', name: 'Lower Tunnel' });

  // ---- the art's free pieces: arches over passages, tarps over the souk, awnings, signs
  put('arch', 650, 1150, 0, { w: 200, h: 120 });                 // the upper tunnel's mouth into the court
  put('arch', 650, 1950, 0, { w: 200, h: 120 });                 // ... into Well Square
  put('arch', 1300, 2135, HALF, { w: 170, h: 112 });             // the lower tunnel's mouths
  put('arch', 1800, 2135, HALF, { w: 170, h: 112 });
  put('arch', 1350, 380, 0, { w: 200, h: 150 });                 // the North Arch passage
  put('arch', 150, 950, HALF, { w: 200, h: 130, broken: 1 });    // the West Breach
  put('arch', 150, 2535, HALF, { w: 230, h: 140 });              // the Well Gate
  put('arch', 2600, 2290, HALF, { w: 160, h: 130 });             // over the short alley
  put('arch', 3245, 3620, HALF, { w: 120, h: 120 });             // the side street
  put('arch', 1050, 2650, 0, { w: 200, h: 140 });                // the souk lane's gate
  for (let y = 2700; y < 3120; y += 140) put('tarp', 1050, y + 60, 0, { w: 200, d: 110, h: 130 });
  for (const [x, y, w] of [[1340, 3200, 420], [2390, 3200, 360], [1700, 3810, 300]]) put('tarp', x, y + (y > 3500 ? -60 : 60), 0, { w, d: 120, h: 125 });
  put('tarp', 3180, 880, 0, { w: 240, d: 130, h: 118, posts: 1 });   // shade over the terrace, on posts
  put('sign', 1251, 720, 0, { text: 'CISTERN', w: 90, h: 150 });
  put('sign', 3500, 3271, HALF, { text: 'CARAVANSERAI', w: 120, h: 172 });
  put('sign', 650, 1951, HALF, { text: 'SOUK', w: 70, h: 150 });

  // ---- lights: lanterns by the doors, braziers, the tunnels' bulbs (night and dusk)
  const LANTERN = '#ffb562';
  const lantern = (x, y, h = 70, r = 240) => { B.light(x, y, r, LANTERN, 0.12, h); put('lantern', x, y, 0, { h }); };
  lantern(1920, 700, 120);
  lantern(2080, 700, 120);
  lantern(1260, 600, 90);
  lantern(2560, 640, 90);
  lantern(2820, 740, H + 70);
  lantern(3640, 820, H + 70);
  lantern(3350, 1300, 110);
  lantern(3640, 2200, 90);
  lantern(3640, 3120, 90);
  lantern(650, 1300, 95, 200);
  lantern(650, 1800, 95, 200);
  lantern(1550, 2135, 90, 200);
  lantern(1240, 1000, 90);
  lantern(320, 650, 90);
  lantern(1290, 2400, 90);
  lantern(1150, 2900, 100);
  lantern(2200, 3200, 90);
  lantern(3120, 3400, 90);
  lantern(2200, 1400, 90);
  B.fire(1980, 3460, 14);       // braziers
  B.fire(2620, 480, 14);
  B.fire(900, 2120, 14);

  // ---- points of interest (Evac Run vocabulary; also the HUD's place names) and named anchors
  B.poi('Fountain Square', 1900, 480, 420);
  B.poi('The Terrace', 3250, 670, 380);
  B.poi('Cistern Court', 765, 700, 420);
  B.poi('Mid Street', 2000, 2000, 340);
  B.poi('Well Square', 800, 2190, 340);
  B.poi('South Souk', 1800, 3480, 420);
  B.poi('Caravan Yard', 3500, 3560, 340);
  B.anchor('square', 2000, 500, 260);
  B.anchor('terrace', 3250, 760, 260);
  B.anchor('cistern', 765, 760, 280);
  B.anchor('mid', 2000, 1800, 200);
  B.anchor('wellSquare', 800, 2200, 220);
  B.anchor('longHall', 3500, 2000, 200);
  B.anchor('souk', 1800, 3480, 260);
  B.anchor('caravanYard', 3500, 3480, 220);

  // ---- decor (the set dressing is sandstoneDressItems below: client-side, never in the MapDef)
  B.sprinkle('crack', 24, 0, 0, 4000, 4000, { on: ['concrete'], s: [0.5, 1.0] });
  B.sprinkle('debris', 90, 0, 0, 4000, 4000, { s: [0.6, 1.1] });
  B.sprinkle('rubble', 26, 0, 0, 4000, 4000, { s: [0.5, 1] });
  B.sprinkle('paper', 60, 0, 0, 4000, 4000, { s: [0.6, 1] });
  B.sprinkle('oil', 12, 0, 0, 4000, 4000, { on: ['concrete', 'gravel'], s: [0.5, 0.9] });
  B.sprinkle('manhole', 6, 0, 0, 4000, 4000, { on: ['concrete'], s: [1, 1] });
  B.sprinkle('blood_old', 30, 0, 0, 4000, 4000, { s: [0.6, 1.4] });
  B.sprinkle('rock', 40, 0, 0, 4000, 4000, { on: ['sand', 'gravel', 'dirt'], s: [0.4, 0.8] });
  B.sprinkle('bush', 14, 0, 0, 4000, 4000, { on: ['sand', 'dirt'], s: [0.5, 0.9], keep: true });
}

const STALL_ROOF = ['#b8452f', '#2e6a8f', '#d7a43a', '#3f7d4d', '#e2d7c0', '#8a3a5c'];

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
  /** Free ground: no obstacle, spawn, supply or objective under or next to it. */
  const clear = (x, y, pad) => {
    if (x < 20 || y < 20 || x > map.width - 20 || y > map.height - 20) return false;
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
  const OPEN = [S.square, S.court, S.well, S.plaza, S.yard, S.mid, S.long, S.terrace, S.souk];
  for (const R of OPEN) {
    scatter('litter', 7, R);
    scatter('stain', 5, R, [0.8, 1.6]);
    scatter('pebbles', 6, R);
    scatter('blood', 3, R, [0.7, 1.4]);
    scatter('newsp', 3, R);
    scatter('paperf', 3, R);
    scatter('soot', 2, R, [0.8, 1.5]);
    scatter('bag', 2, R);
  }
  // the souk: goods, boxes, parasols, rugs of clothes, chairs knocked over
  for (const R of [S.plaza, S.souk, S.well]) {
    scatter('box', 8, R);
    scatter('box_open', 5, R);
    scatter('box_stack', 3, R);
    scatter('crates', 2, R);
    scatter('clothes', 4, R);
    scatter('chair', 5, R);
    scatter('cooler', 1, R);
    scatter('toy', 2, R);
    scatter('teddy', 1, R);
  }
  scatter('umbrella', 4, S.plaza, [0.9, 1.1], 120);
  scatter('picnic', 1, S.plaza, [0.9, 1.0], 160);
  scatter('grill', 2, S.plaza, [0.9, 1.1], 120);
  // the yard and the long hall: a caravan stop and its fuel, pallets and drums
  for (const R of [S.yard, S.long]) {
    scatter('drum', 5, R);
    scatter('drums', 2, R);
    scatter('pallet', 4, R);
    scatter('pallets', 1, R);
    scatter('fuel_can', 3, R);
    scatter('gascyl', 2, R);
  }
  scatter('bones', 5, S.yard);
  scatter('trough', 2, S.yard, [0.9, 1.1], 80);
  scatter('ibc', 1, S.yard, [0.9, 1.0], 80);
  scatter('generator', 1, S.yard, [0.9, 1.0], 80);
  scatter('reel', 1, S.yard, [0.9, 1.0], 80);
  // the defenders' corners: luggage of the people who fled, a last stand on the terrace
  scatter('suitcase', 4, S.square);
  scatter('duffel', 2, S.square);
  scatter('backpack', 3, S.square);
  scatter('shoes', 4, S.square);
  scatter('sandarc', 2, S.terrace, [0.9, 1.1], 100);
  scatter('milcrate', 4, S.terrace, [0.9, 1.1], 60);
  scatter('mil_box', 3, S.terrace, [0.9, 1.1], 60);
  scatter('helmet', 3, S.terrace);
  scatter('bodybag', 2, S.terrace);
  scatter('shrine', 1, S.court, [0.9, 1.0], 100);
  scatter('crate', 8, S.court);
  scatter('wheelbarrow', 2, S.court);
  scatter('planter', 4, S.court);
  scatter('bicycle', 2, S.well);
  scatter('woodpile', 2, S.well, [0.9, 1.1], 60);
  scatter('drum', 4, S.mid);
  scatter('shoes', 4, S.mid);
  scatter('bin_fall', 3, S.mid);
  scatter('car_door', 1, S.mid);
  scatter('wheel_loose', 2, S.long);
  // the desert creeping in: tumbleweed, dry shrubs and a few cacti in the corners
  for (const R of OPEN) scatter('tumbleweed', 2, R, [0.7, 1.1]);
  for (const R of [S.yard, S.plaza, S.well, S.court]) {
    scatter('shrub', 3, R, [0.6, 1.0], 50);
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
