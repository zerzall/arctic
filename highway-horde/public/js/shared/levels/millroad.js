// Mill Road — story level (JOURNEY.md). Owner: agent C1.
//
// SPEC is the contract other parts depend on (the mission scripts, the engine, the tests): keep every
// section id (in this order), anchor name and gate id. The layout below is hand-built:
//
//   The dawn after the pileup. The crew comes down Mill Road from the interstate in the north-east
//   corner, across the creek bridge (a jackknifed semi on it), south past a logging truck that went
//   over and an abandoned ambulance, and west to Deke's barricade in front of Mill Road Gas. The road
//   west is closed by an army roadblock, so from the station the way goes north through Shady Acres
//   (the office, the pool, Ozzy's radio shack under its antenna), out through the farm fence into the
//   Haskell corn, past the scarecrow and the stuck tractor to the silo and the barn, and down the farm
//   drive onto Mill Road again, where the Roadhouse's gate stands across the road.
//
//     x:  0                4420              7800                     11600
//   y=0   +-----------------+-----------------+--------------------------+
//         |  corn           |  trailers       |  jam  (road A, the creek |
//         |  (the Haskell   |  (Shady Acres)  |   bridge, road B south)  |
//   2300  |   cornfield)    +-----------------+                          |
//         |                 |  gasstation     |                          |
//   3700  +-----------------+  (Mill Road Gas)|  <- road C (Mill Road) --|
//         |  motel (the Roadhouse)            |                          |
//   4400  +-----------------+-----------------+--------------------------+
//
// Render-only records for the level's art (render3d/levels/millroad.js) live in `map.art`: floors,
// door frames, free props, the corn. The kit functions below write them and are shared by the other
// levels of this owner (hollowcreek.js, forest.js import them).

import { TAU } from '../math.js';

export const SPEC = Object.freeze({
  "id": "millroad",
  "name": "Mill Road",
  "chapter": 1,
  "time": "day",
  "owner": "C1",
  "description": "Dawn after the pileup. Walk west through miles of dead traffic, strip Mill Road Gas for a tow truck, cross the Shady Acres trailer park and the Haskell cornfield to the gates of the Roadhouse motel.",
  "sections": [
    {
      "id": "jam",
      "name": "The Jam"
    },
    {
      "id": "gasstation",
      "name": "Mill Road Gas"
    },
    {
      "id": "trailers",
      "name": "Shady Acres"
    },
    {
      "id": "corn",
      "name": "Haskell Cornfield"
    },
    {
      "id": "motel",
      "name": "The Roadhouse Gate"
    }
  ],
  "anchors": {
    "jam": [
      "start",
      "jam_wreck",
      "jam_semi",
      "jam_ambulance"
    ],
    "gasstation": [
      "gas_forecourt",
      "gas_office",
      "gas_garage",
      "gas_tow",
      "gas_tanks"
    ],
    "trailers": [
      "trailer_office",
      "trailer_radio",
      "trailer_pool",
      "trailer_exit"
    ],
    "corn": [
      "corn_scarecrow",
      "corn_tractor",
      "corn_silo"
    ],
    "motel": [
      "motel_sign",
      "motel_gate",
      "motel_lot"
    ]
  },
  "gates": [
    {
      "id": "gas_shutter",
      "kind": "shutter",
      "from": "jam",
      "to": "gasstation",
      "label": "Mill Road Gas: the forecourt barricade"
    },
    {
      "id": "trailer_gate",
      "kind": "gate",
      "from": "gasstation",
      "to": "trailers",
      "label": "Shady Acres gate"
    },
    {
      "id": "corn_fence",
      "kind": "fence",
      "from": "trailers",
      "to": "corn",
      "label": "The farm fence"
    },
    {
      "id": "motel_gate",
      "kind": "gate",
      "from": "corn",
      "to": "motel",
      "label": "The Roadhouse gate"
    }
  ]
});

/** World size and mood (maps.js MAP_DEFS). */
export const DEF = { width: 11600, height: 4400, darkness: 0.58, tint: '#3c4c5e', ground: '#46512f' };

// =====================================================================================================
// The kit (shared by this owner's levels)
// =====================================================================================================

export const HALF = Math.PI / 2;
export const PI = Math.PI;
export { TAU };
const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;

/** The level's render-only records: map.art = { floors, doors, props, corn }. */
export function artOf(B) {
  if (!B.map.art) B.map.art = { floors: [], doors: [], props: [], corn: null };
  return B.map.art;
}

/**
 * A free prop the level art draws (no collision): `t` names the model (render3d/levels kit or the
 * level's own MODELS), the rest are its parameters.
 */
export function prop(B, t, x, y, a = 0, o = {}) {
  const p = { t, x: r1(x), y: r1(y), a: r3(a) };
  for (const [k, v] of Object.entries(o)) p[k] = typeof v === 'number' ? r1(v) : v;
  artOf(B).props.push(p);
  return p;
}

/**
 * One wall from (x1, y1) to (x2, y2), `t` thick (more than 8: a thin 'wall' is a jumpable fence to
 * the sim). `look` is the look the art gives it (kit LOOKS); `side` which face is indoors ('in' =
 * the wall's local +y, the left of its run in screen space; 'out' = none; 'both').
 */
export function wall(B, x1, y1, x2, y2, look, o = {}) {
  const t = o.t || 12;
  const ext = o.ext || 0;
  const len = Math.hypot(x2 - x1, y2 - y1) + ext * 2;
  const a = Math.atan2(y2 - y1, x2 - x1);
  const ob = B.ob(o.kind || 'wall', (x1 + x2) / 2, (y1 + y2) / 2, len, t, a, {
    style: 'w:' + look, prop: o.side || 'out', section: o.sec, color: o.color, solid: o.solid,
  });
  if (o.top !== undefined) ob.top = o.top;
  return ob;
}

/**
 * A wall line with openings. `gaps` = [[from, to, door], ...] measured along the line from (x1, y1);
 * `door` names the frame the art draws in the opening (null = a plain opening, no frame). Long
 * stretches are cut into pieces of at most `o.maxLen`. Returns the openings' centres.
 */
export function wallGaps(B, x1, y1, x2, y2, gaps, look, o = {}) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  const a = Math.atan2(uy, ux);
  const ext = o.ext || 0;
  const maxLen = o.maxLen || 900;
  const at = (s) => [x1 + ux * s, y1 + uy * s];
  const sorted = [...gaps].sort((p, q) => p[0] - q[0]);
  let cur = -ext;
  const pieces = [];
  for (const g of sorted) {
    if (g[0] > cur + 4) pieces.push([cur, g[0]]);
    cur = Math.max(cur, g[1]);
  }
  if (len + ext > cur + 4) pieces.push([cur, len + ext]);
  for (const [p0, p1] of pieces) {
    const n = Math.max(1, Math.ceil((p1 - p0) / maxLen));
    for (let i = 0; i < n; i++) {
      const s0 = p0 + ((p1 - p0) * i) / n, s1 = p0 + ((p1 - p0) * (i + 1)) / n;
      const [ax, ay] = at(s0), [bx, by] = at(s1);
      wall(B, ax, ay, bx, by, look, { ...o, ext: 0 });
    }
  }
  const out = [];
  for (const g of sorted) {
    const [cx, cy] = at((g[0] + g[1]) / 2);
    out.push({ x: cx, y: cy });
    if (g[2]) artOf(B).doors.push({ x: r1(cx), y: r1(cy), a: r3(a), w: r1(g[1] - g[0]), t: o.t || 12, look: g[2], h: o.doorH || 76, wall: look, side: o.side || 'out' });
  }
  return out;
}

/**
 * A walk-in building: four walls with their indoor faces inward (`skip` leaves sides out), doorways
 * (`doors.n|s|e|w` = [[offset, width, frame], ...]; offsets along the side from its middle, +x / +y of
 * the room frame), a floor for the art (`floor` = its look), a paved floor area (no grass indoors) and a
 * roof (`roof` = { kind, height, dark, style } or false).
 *   r = { x, y, w, h, a, look, t, doors, skip, floor, roof, sec, ext }
 */
export function room(B, r) {
  const { x, y, w, h } = r;
  const a = r.a || 0, t = r.t || 12;
  const c = Math.cos(a), s = Math.sin(a);
  const P = (lx, ly) => [x + lx * c - ly * s, y + lx * s + ly * c];
  const hw = w / 2, hh = h / 2;
  const runs = {
    n: [[-hw, -hh], [hw, -hh], (off) => off + hw],
    s: [[hw, hh], [-hw, hh], (off) => hw - off],
    e: [[hw, -hh], [hw, hh], (off) => off + hh],
    w: [[-hw, hh], [-hw, -hh], (off) => hh - off],
  };
  const doors = r.doors || {};
  const skip = r.skip || [];
  const looks = r.looks || {};
  const opened = {};
  for (const side of ['n', 's', 'e', 'w']) {
    if (skip.includes(side)) continue;
    const [p0, p1, along] = runs[side];
    const [ax, ay] = P(...p0), [bx, by] = P(...p1);
    const gaps = (doors[side] || []).map(([off, dw, frame]) => {
      const m = along(off);
      return [m - dw / 2, m + dw / 2, frame === undefined ? 'door' : frame];
    });
    opened[side] = wallGaps(B, ax, ay, bx, by, gaps, looks[side] || r.look, { t, side: 'in', sec: r.sec, ext: r.ext ?? t / 2, doorH: r.doorH });
  }
  if (r.floor) {
    artOf(B).floors.push({ x: r1(x), y: r1(y), w: r1(w - t), h: r1(h - t), a: r3(a), look: r.floor, sec: r.sec });
    if (r.pave !== false) B.area('concrete', x, y, w - t, h - t, a);
  }
  if (r.roof !== false && r.roof) {
    B.roof(x, y, w + t, h + t, a, { kind: r.roof.kind || 'plain', height: r.roof.height || 130, section: r.sec, dark: r.roof.dark ?? 0.72, style: r.roof.style });
  }
  return { P, opened };
}

/** A straight fence or boundary with gaps (a thick 'wall', so nobody hops it). */
export function fence(B, x1, y1, x2, y2, look, gaps = [], o = {}) {
  return wallGaps(B, x1, y1, x2, y2, gaps, look, { t: 14, maxLen: 700, ...o });
}

/** A section's spawn rectangle (zombies from here while this section or the one before is played). */
export function spawn(B, sec, x, y, w, h, weight = 1) {
  B.zspawn(x, y, w, h, weight, sec);
}

/** A hand-placed set-dressing item (shared/dress.js DRESS_KINDS; no collision), drawn by the world's dressing. */
export function dress(B, k, x, y, a = 0, s = 1) {
  const art = artOf(B);
  if (!art.dress) art.dress = [];
  art.dress.push([k, r1(x), r1(y), r3(a), r3(s)]);
}

/**
 * A solid building façade ('building' obstacle drawn by world-bld.js as `arch`), its front toward
 * local +y at angle `a`. Returns the obstacle.
 */
export function facade(B, x, y, w, d, a, arch, o = {}) {
  const b = B.ob('building', x, y, w, d, a, { color: o.color || '#8a5a44', roof: o.roof || '#3a3634', section: o.sec });
  b.arch = arch;
  if (o.top) b.top = o.top;
  if (o.lit !== undefined) b.lit = o.lit;
  if (o.style) b.style = o.style;
  return b;
}

/** A tagged obstacle whose model the level art draws (`style`). */
export function ob(B, kind, style, x, y, w, h, a = 0, o = {}) {
  return B.ob(kind, x, y, w, h, a, { ...o, style, section: o.sec });
}

// =====================================================================================================
// Mill Road
// =====================================================================================================

const W = 11600, H = 4400;
const RA = 1000;       // road A (east-west, from the interstate) centre line y
const RX = 9000;       // road B (north-south) centre line x
const RY = 3500;       // road C (Mill Road west) centre line y
const HR = 85;         // half the road's width (two lanes)
const CREEK = [10230, 10390];
const BRIDGE = [830, 1180];
const XB = 7800;       // Deke's barricade / the trailer park's east fence
const XT = 4420;       // the army roadblock / the trailer park's west fence
const YT = 2300;       // the trailer park's south fence
const YM = 3720;       // the Roadhouse's north wall

/** Morning and night looks (render3d reads map.look). */
const LOOK = {
  trees: ['oak', 'oak', 'maple', 'birch', 'pine', 'oak', 'dead'],
  deciduous: 0.8,
  day: {
    // dawn: a low sun in the east behind the crew, pink-gold haze over the fields, dew on the tarmac
    az: 8, el: 13, warm: 1, haze: '#d6c2ae', horizon: '#f6c898', zenith: '#3d6bb0', fog: 0.00022, cover: 0.3, heat: 0.05,
    ridge: '#6c7a8a', wet: 0.3, sunColor: '#ffbe84', sunI: 4.9, hemiSky: '#b4c0d6', hemiGround: '#6e6a48', hemi: 0.88, exposure: 1.02, mist: 0.7,
    lampK: 0.12, fireK: 0.7,
    grade: { contrast: 1.07, saturation: 1.08, lift: [0.006, 0.004, 0.006], gain: [1.08, 1.0, 0.9], vignette: 0.26, bloom: 0.3, bloomThreshold: 1.35 },
  },
  night: {
    fog: '#0b1018', horizon: '#141c28', zenith: '#03050a', sky: '#7c90b8', ground: '#2a2a22', moon: '#a9bde6', moonI: 0.62, hemi: 0.95, fogDensity: 0.0011,
    grade: { saturation: 0.96, contrast: 1.08, lift: [0.008, 0.011, 0.02], gain: [1.02, 1.0, 1.0] },
  },
};

/**
 * Lay the level out.
 * @param {object} B map builder (maps.js createBuilder) with the level calls of JOURNEY.md §3
 */
export function build(B) {
  B.map.look = LOOK;
  artOf(B);
  // the sections in travel order (rectangles: x, y = centre)
  B.section('jam', 'The Jam', (XB + W) / 2, H / 2, W - XB, H);
  B.section('gasstation', 'Mill Road Gas', (XT + XB) / 2, (YT + H) / 2, XB - XT, H - YT);
  B.section('trailers', 'Shady Acres', (XT + XB) / 2, YT / 2, XB - XT, YT);
  B.section('corn', 'Haskell Cornfield', XT / 2, YM / 2, XT, YM);
  B.section('motel', 'The Roadhouse Gate', XT / 2, (YM + H) / 2, XT, H - YM);

  ground(B);
  jam(B);
  barricade(B);
  gas(B);
  trailers(B);
  corn(B);
  motel(B);
}

// ---- the ground: fields, roads, the creek ------------------------------------------------------------

function ground(B) {
  // fields first (later areas paint over earlier ones)
  B.box('grass', XB, 0, W, H);
  B.box('grass', 0, 3300, XT, YM);
  B.box('dirt', CREEK[1] + 90, 1750, 11480, 2150);                 // a ploughed strip on the farm
  B.box('dirt', 9200, 1700, CREEK[0] - 60, 3250);                   // the crop-duster's field
  B.box('gravel', 10840, 1160, 10940, 2280);                        // the farm's drive
  B.box('gravel', 10700, 2280, 11420, 2780);                        // its yard
  // Mill Road: A east-west from the interstate, B south, C west to the Roadhouse
  B.box('gravel', RX - 150, RA - 150, W, RA + 150);
  B.box('gravel', RX - 150, RA - 150, RX + 150, RY + 150);
  B.box('gravel', 0, RY - 150, RX + 150, RY + 150);
  B.box('asphalt', RX - HR, RA - HR, W, RA + HR);
  B.box('asphalt', RX - HR, RA - HR, RX + HR, RY + HR);
  B.box('asphalt', 0, RY - HR, RX + HR, RY + HR);
  // the creek and the bridge deck (the gap between the two water areas)
  B.box('water', CREEK[0], -30, CREEK[1], BRIDGE[0]);
  B.box('water', CREEK[0], BRIDGE[1], CREEK[1], H + 30);
  B.box('concrete', CREEK[0] - 40, BRIDGE[0], CREEK[1] + 40, RA - HR);
  B.box('concrete', CREEK[0] - 40, RA + HR, CREEK[1] + 40, BRIDGE[1]);
  // paint: centre lines and edge lines, broken at the corners
  B.line('yellow_double', RX + 110, RA, W, RA, 3);
  B.line('yellow_double', RX, RA + 110, RX, RY - 110, 3);
  B.line('yellow_double', 0, RY, RX - 110, RY, 3);
  for (const s of [-1, 1]) {
    B.line('white', RX + 100, RA + s * (HR - 7), W, RA + s * (HR - 7), 3);
    B.line('white', RX + s * (HR - 7), RA + 100, RX + s * (HR - 7), RY - 100, 3);
    B.line('white', 0, RY + s * (HR - 7), RX - 100, RY + s * (HR - 7), 3);
  }
}

// ---- 1. The Jam -----------------------------------------------------------------------------------------

function jam(B) {
  const sec = 'jam';
  const WEST = PI, SOUTH = HALF;
  const car = (kind, x, y, a, o = {}) => {
    const v = B.vehicle(kind, x, y, a, { jitter: 0.4, ...o });
    v.section = sec;
    return v;
  };
  // the start: the crew walks down from the interstate (east edge) onto road A
  B.anchor('start', 11380, 1250, 170);
  for (let k = 0; k < 6; k++) B.pspawn(11300 + (k % 3) * 70, 1200 + Math.floor(k / 3) * 90);
  B.supply(11180, 1300);
  B.checkpoint(sec, 11200, 1220);
  B.checkpoint(sec, 9500, 1250);
  B.checkpoint(sec, 9250, 2700);
  B.checkpoint(sec, 8300, 3260);

  // ---- road A: the queue heading west, both lanes, up to the bridge
  const qa = [
    ['car', 11560, 958, 0], ['van', 11420, 952, 0.05], ['car', 11250, 962, -0.04], ['pickup', 11080, 958, 0.12, { wrecked: true }],
    ['suv', 10930, 958, 0], ['car', 10790, 968, 0.22],
    ['car', 11500, 1042, 0], ['car', 11150, 1046, -0.1, { wrecked: true, burning: true }], ['car', 10990, 1040, 0.02],
    ['van', 10820, 1050, -0.18], ['car', 10690, 1052, -0.42, { wrecked: true }],
  ];
  for (const [k, x, y, da, o] of qa) car(k, x, y, WEST + da, o);
  // the semi jackknifed on the bridge: the trailer on the east approach, the cab slewed onto the deck
  const tr = B.ob('semi', 10470, 890, 240, 62, WEST + 0.04, { color: '#c4b89c', section: sec, style: 'mr-reefer' });
  void tr;
  B.ob('semi', 10332, 925, 60, 56, WEST - 0.95, { color: '#8a2f2a', section: sec });
  B.anchor('jam_semi', 10480, 1050, 180);
  prop(B, 'mr-bridge', (CREEK[0] + CREEK[1]) / 2, RA, 0, { len: CREEK[1] - CREEK[0] + 120, deck: BRIDGE[1] - BRIDGE[0] });
  // west of the bridge
  const qb = [
    ['car', 10060, 958, 0.1], ['car', 9930, 1045, 0], ['suv', 9850, 1040, -0.12, { wrecked: true }], ['car', 9700, 962, 0.05],
    ['van', 9560, 1046, 0], ['car', 9420, 958, 0.16], ['pickup', 9280, 1042, -0.22],
  ];
  for (const [k, x, y, da, o] of qb) car(k, x, y, WEST + da, o);
  // the corner: a car that missed it and went through the fence into the ditch
  car('car', 8790, 790, WEST + 0.62, { wrecked: true });
  prop(B, 'mr-chevrons', RX - 200, RA - 170, 0, { n: 4 });
  prop(B, 'mr-chevrons', RX - 170, RA - 200, HALF, { n: 4 });

  // ---- road B: the logging truck went over (the wreck), the queue south of it, the ambulance
  B.ob('semi', 9010, 1650, 240, 62, 0.42, { color: '#5a4632', section: sec, style: 'mr-logtrailer' });
  B.ob('semi', 9170, 1760, 60, 56, 0.42 + 0.95, { color: '#2f4f6f', section: sec, wrecked: true });
  B.fire(9190, 1775, 18);
  car('car', 8925, 1760, SOUTH + 0.35, { wrecked: true });
  // spilled logs (low: hop over them)
  const logs = [[8880, 1540, 0.3], [8860, 1600, 0.36], [8905, 1660, 0.22], [8840, 1700, 1.1], [8890, 1820, 0.62], [9100, 1520, -0.2]];
  for (const [x, y, a] of logs) B.ob('rock', x, y, 118, 15, a, { color: '#5a4632', section: sec, style: 'mr-log' });
  B.anchor('jam_wreck', 9230, 1560, 190);
  const qc = [
    ['car', 8958, 1960, 0], ['suv', 9042, 2090, 0.04], ['car', 8960, 2230, 0.06], ['car', 8952, 2660, -0.04],
    ['van', 9042, 2810, 0.1, { wrecked: true, burning: true }], ['car', 8958, 2990, 0], ['pickup', 9046, 3130, 0.1], ['car', 8962, 3290, 0.3],
  ];
  for (const [k, x, y, da, o] of qc) car(k, x, y, SOUTH + da, o);
  B.ob('van', 9118, 2470, 104, 50, SOUTH - 0.26, { color: '#e6e6e0', section: sec, style: 'mr-ambulance' });
  B.anchor('jam_ambulance', 9230, 2400, 170);
  prop(B, 'mr-triage', 9185, 2395, SOUTH - 0.26);
  B.light(9150, 2420, 260, '#ff5040', 0.1, 90);

  // ---- road C east of the barricade: Deke pushed the cars onto the shoulders to clear a lane
  const qd = [
    ['car', 8700, 3380, -0.4], ['suv', 8540, 3625, 0.5], ['car', 8350, 3385, -0.25], ['van', 8180, 3630, 0.3, { wrecked: true }], ['car', 8010, 3372, -0.15],
  ];
  for (const [k, x, y, da, o] of qd) car(k, x, y, WEST + da, o);
  car('car', 7960, 3640, WEST + 0.2, { wrecked: true, burning: true });

  // ---- the fields: a crop-duster that came down in the dawn fog, the farm, bales
  B.ob('truck', 9760, 2360, 124, 36, -2.55, { color: '#d8b020', section: sec, style: 'mr-plane' });
  B.box('dirt', 9760 + 120, 2360 + 90, 9760 + 480, 2360 + 150);
  B.fire(9730, 2330, 15);
  const house = B.ob('building', 11080, 2480, 250, 170, PI, { color: '#d9d2c2', roof: '#4a4442', section: sec });
  house.arch = 'house'; house.lit = 0.15;
  const barn = B.ob('building', 11160, 3380, 250, 180, 0, { color: '#7d3a2c', roof: '#5a2b22', section: sec });
  barn.arch = 'barn';
  B.ob('pickup', 10960, 2690, 100, 46, 0.3, { color: '#6d4c3a', section: sec });
  prop(B, 'mr-windmill', 10700, 3080, 0.6);
  B.ob('wall', 10700, 3080, 44, 44, 0, { style: 'nodraw', section: sec });
  prop(B, 'mr-mailbox', 10905, 1175, HALF);
  for (const [x, y, a] of [[10000, 1900, 0.3], [10060, 1960, 1.4], [9600, 3150, 0.1], [11300, 2000, 0.8], [11350, 2080, 2.1], [8200, 1600, 0.5], [8260, 1660, 1.9], [8620, 2720, 0.2]]) {
    B.ob('rock', x, y, 34, 34, a, { color: '#c9a850', section: sec, style: 'mr-bale' });
  }
  // the fence line along the road (posts and wire, broken where the cars went through)
  prop(B, 'mr-farmfence', (RX + 180 + W) / 2, RA - 260, 0, { len: W - RX - 200, gaps: [[10180, 10440], [8700, 9300]] });
  prop(B, 'mr-farmfence', (RX + 180 + W) / 2, RA + 330, 0, { len: W - RX - 200, gaps: [[10180, 10440], [10800, 10980]] });
  prop(B, 'mr-farmfence', RX - 190, (RA + 200 + RY - 200) / 2, HALF, { len: RY - RA - 400, gaps: [] });
  prop(B, 'mr-farmfence', RX + 190, (RA + 200 + RY - 200) / 2, HALF, { len: RY - RA - 400, gaps: [[2350, 2500]] });
  prop(B, 'mr-roadsign', 11200, RA - 120, PI, { text: 'millrd' });
  prop(B, 'mr-roadsign', RX - 125, 2000, HALF, { text: 'gas2' });
  prop(B, 'mr-roadsign', 8500, RY - 125, PI, { text: 'shady' });

  // spawns: ahead of the crew (fields, the treeline, behind the farm) and behind the wrecks
  spawn(B, sec, 9600, 110, 700, 110, 0.8);
  spawn(B, sec, 8300, 620, 500, 300, 1);
  spawn(B, sec, 8250, 2250, 500, 500, 1.2);
  spawn(B, sec, 9700, 3350, 600, 220, 1);
  spawn(B, sec, 10800, 3950, 500, 260, 0.7);
  spawn(B, sec, 8500, 4240, 700, 120, 1);
  spawn(B, sec, 9700, 1400, 500, 180, 0.8);
}

// ---- Deke's barricade (the gate into the gas station) ------------------------------------------------------

function barricade(B) {
  const sec = 'jam';
  const g0 = RY - 120, g1 = RY + 120;
  wall(B, XB, YT, XB, g0, 'junk', { t: 40, sec });
  wall(B, XB, g1, XB, H, 'junk', { t: 40, sec });
  B.gate('gas_shutter', 'shutter', XB, RY, g1 - g0, 30, HALF, { section: sec, label: 'Mill Road Gas: the forecourt barricade', style: 'mr-shutter' });
  prop(B, 'mr-shutterframe', XB, RY, HALF, { w: g1 - g0 });
}

// ---- 2. Mill Road Gas ------------------------------------------------------------------------------------------

function gas(B) {
  const sec = 'gasstation';
  // ground: the forecourt, the side lot, the tank pad, the access road to Shady Acres, the car wash lot
  B.box('concrete', 5440, 2800, 7480, RY - 150);
  B.box('concrete', 5440, 2330, 5700, 2800);
  B.box('concrete', 6900, 2330, 7560, 2800);
  B.box('asphalt', 5270, YT, 5430, RY - HR);
  B.box('concrete', 5880, RY + 150, 6760, 3980);
  B.box('dirt', 4460, 2340, 5230, H - 20);
  B.box('gravel', 4600, 2500, 5100, 3300);
  for (let x = 6620; x <= 7380; x += 95) B.line('parking', x, 3130, x, 3240, 3);

  // ---- the station: the store (west) and the two-bay garage (east) under one roof line
  const Y0 = 2420, Y1 = 2800, X0 = 5700, XM = 6250, X1 = 6900;
  room(B, {
    x: (X0 + XM) / 2, y: (Y0 + Y1) / 2, w: XM - X0, h: Y1 - Y0, look: 'store', sec, floor: 'lino-check',
    doors: { s: [[25, 104, 'glass2']], e: [[-30, 84, 'wood']], w: [[60, 80, 'steel']] },
    roof: { kind: 'office', height: 132, dark: 0.55 },
  });
  // the office behind the counter (north-east corner of the store)
  wallGaps(B, 6080, Y0, 6080, 2570, [[50, 130, 'wood']], 'office', { t: 10, side: 'both', sec });
  wall(B, 6080, 2570, XM, 2570, 'office', { t: 10, side: 'both', sec });
  artOf(B).floors.push({ x: 6165, y: 2495, w: 158, h: 138, a: 0, look: 'carpet-blue', sec });
  room(B, {
    x: (XM + X1) / 2, y: (Y0 + Y1) / 2, w: X1 - XM, h: Y1 - Y0, look: 'garage', sec, floor: 'garage', skip: ['w'],
    doors: { s: [[-150, 184, 'rollup'], [80, 184, 'rollup']], e: [[60, 80, 'steel']] },
    roof: { kind: 'industrial', height: 150, dark: 0.5 },
  });
  // store furniture: coolers along the west wall, two shelving units, the checkout counter
  ob(B, 'cabinet', 'mr-coolers', 5726, 2615, 340, 34, HALF, { sec });
  ob(B, 'cabinet', 'mr-shelf', 5850, 2600, 200, 34, HALF, { sec });
  ob(B, 'cabinet', 'mr-shelf', 5962, 2600, 200, 34, HALF, { sec });
  ob(B, 'counter', 'mr-checkout', 6130, 2690, 150, 40, HALF, { sec });
  ob(B, 'desk', 'mr-officedesk', 6190, 2520, 90, 44, PI, { sec });
  prop(B, 'mr-storestuff', (X0 + XM) / 2, (Y0 + Y1) / 2, 0, { w: XM - X0, h: Y1 - Y0 });
  B.light(5850, 2520, 220, '#e8f0ff', 0.25, 125);
  B.light(6000, 2700, 240, '#e8f0ff', 0, 125);
  B.light(6160, 2500, 150, '#ffd9a0', 0, 110);
  // garage: the lift with a sedan up on it, workbench, tool chests, tyre rack
  for (const x of [6305, 6475]) ob(B, 'wall', 'mr-liftpost', x, 2600, 16, 16, 0, { sec });
  prop(B, 'mr-liftcar', 6390, 2600, 0);
  ob(B, 'counter', 'mr-workbench', 6620, 2446, 260, 34, 0, { sec });
  ob(B, 'cabinet', 'mr-toolchest', 6830, 2448, 70, 30, 0, { sec });
  ob(B, 'cabinet', 'mr-tyrerack', 6872, 2640, 180, 30, HALF, { sec });
  prop(B, 'mr-garagestuff', (XM + X1) / 2, (Y0 + Y1) / 2, 0, { w: X1 - XM, h: Y1 - Y0 });
  B.light(6390, 2560, 260, '#ffc680', 0.15, 140);
  B.light(6680, 2600, 260, '#ffc680', 0, 140);

  // ---- the canopy and the pumps
  for (const [x, y] of [[5790, 2955], [6210, 2955], [5790, 3175], [6210, 3175]]) ob(B, 'ipillar', 'mr-canopycol', x, y, 18, 18, 0, { sec });
  prop(B, 'mr-canopy', 6000, 3065, 0, { w: 560, d: 330, h: 150 });
  for (const x of [5875, 5935, 6065, 6125]) ob(B, 'pump', 'mr-pump', x, 3065, 24, 46, 0, { sec });
  for (const [x, y] of [[5900, 3000], [6100, 3130], [5920, 3140]]) B.light(x, y, 230, '#eef4ff', 0, 140);
  ob(B, 'ipillar', 'mr-pylon', 5560, 3300, 22, 22, 0, { sec });
  // the tow truck on the apron in front of bay 2 (Deke's), nose to the road
  B.ob('truck', 6650, 2985, 152, 56, HALF, { color: '#b8412a', section: sec, style: 'mr-tow' });
  B.anchor('gas_tow', 6520, 3010, 150);
  // ---- the fuel tanks: two horizontal tanks in a low bund, the tanker unloading beside them
  for (const [x1, y1, x2, y2] of [[7020, 2440, 7480, 2440], [7480, 2440, 7480, 2770], [7020, 2440, 7020, 2770], [7020, 2770, 7180, 2770], [7320, 2770, 7480, 2770]]) {
    wall(B, x1, y1, x2, y2, 'bund', { t: 14, kind: 'barrier', sec, solid: false });
  }
  ob(B, 'container', 'mr-tank', 7250, 2530, 300, 70, 0, { sec, color: '#d8d4c8' });
  ob(B, 'container', 'mr-tank', 7250, 2680, 300, 70, 0, { sec, color: '#c9c4b6' });
  B.ob('tanker', 7250, 2930, 230, 60, 0, { color: '#b9bcbf', section: sec });
  B.anchor('gas_tanks', 7250, 2840, 170);
  // ---- the side lot: dumpster, the propane cage, the ice chest, air and vacuum
  B.ob('container', 5560, 2470, 64, 36, 0, { color: '#2e5d3a', roof: '#294f33', section: sec });
  ob(B, 'container', 'mr-propane', 5480, 2640, 40, 64, 0, { sec });
  ob(B, 'cabinet', 'mr-icechest', 5650, 2860, 60, 30, 0, { sec });
  prop(B, 'mr-airstand', 5520, 2860, 0);
  // ---- south of the road: the car wash (walk through it), vacuum islands
  const cwX0 = 6060, cwX1 = 6560, cwY0 = 3700, cwY1 = 3880;
  wall(B, cwX0, cwY0, cwX1, cwY0, 'carwash', { t: 12, side: 'in', sec, ext: 6 });
  wall(B, cwX1, cwY1, cwX0, cwY1, 'carwash', { t: 12, side: 'in', sec, ext: 6 });
  B.roof((cwX0 + cwX1) / 2, (cwY0 + cwY1) / 2, cwX1 - cwX0 + 24, cwY1 - cwY0 + 12, 0, { kind: 'plain', height: 118, section: sec, dark: 0.45, style: 'mr-carwash' });
  prop(B, 'mr-carwash', (cwX0 + cwX1) / 2, (cwY0 + cwY1) / 2, 0, { w: cwX1 - cwX0, d: cwY1 - cwY0 });
  artOf(B).floors.push({ x: (cwX0 + cwX1) / 2, y: (cwY0 + cwY1) / 2, w: cwX1 - cwX0, h: cwY1 - cwY0 - 12, a: 0, look: 'wash', sec });
  B.vehicle('car', 6220, 3790, 0, { color: '#355c7d', jitter: 0 }).section = sec;
  for (const x of [5960, 6660]) prop(B, 'mr-vacuum', x, 3930, 0);
  B.light(6310, 3790, 200, '#dfe8ff', 0.35, 110);
  // ---- the army's roadblock (west): T-walls across the road, the overrun quarantine post
  fence(B, XT, YT, XT, H, 'twall', [], { t: 30, sec });
  prop(B, 'mr-quarantine', 4830, 3000, 0);
  B.ob('tent', 4760, 2640, 150, 104, HALF, { color: '#5a6340', roof: '#6b7449', section: sec });
  B.ob('tent', 4960, 2640, 150, 104, HALF, { color: '#c9c4b0', roof: '#d8d4c0', section: sec });
  B.ob('truck', 4800, 3780, 136, 56, -HALF + 0.2, { color: '#4b5320', section: sec, wrecked: true });
  B.ob('truck', 5020, 4050, 136, 56, 0.4, { color: '#4b5320', section: sec });
  for (const [x, y, w, a] of [[4600, 3300, 160, HALF], [4600, 3700, 160, HALF], [4760, 3420, 120, 0.1], [4700, 4180, 200, 0]]) B.ob('sandbags', x, y, w, 26, a, { section: sec });
  B.ob('watchtower', 4560, 3500, 58, 58, 0, { color: '#5b4a36', section: sec });
  prop(B, 'mr-roadclosed', XT + 40, RY, 0);
  B.fire(4980, 3260, 14);
  // ---- lamps: the forecourt poles and the roadside
  for (const [x, y] of [[5480, 3330], [7440, 3330], [6420, 3640], [7060, 2860]]) B.lamp(x, y, { dead: false, a: -HALF, r: 300, color: '#ffe6c0' });
  B.lamp(5360, 3620, { a: -HALF });
  // anchors, checkpoints, spawns
  B.anchor('gas_forecourt', 6340, 3250, 220);
  B.anchor('gas_office', 6170, 2470, 90);
  B.anchor('gas_garage', 6600, 2640, 140);
  B.checkpoint(sec, 7600, 3240);
  B.checkpoint(sec, 6500, 3300);
  B.checkpoint(sec, 5350, 2700);
  spawn(B, sec, 6300, 2360, 560, 60, 1.2);
  spawn(B, sec, 6450, 3790, 120, 90, 1);
  spawn(B, sec, 4900, 3050, 260, 300, 1);
  spawn(B, sec, 6900, 4300, 900, 100, 1);
  spawn(B, sec, 4860, 4250, 300, 100, 0.8);
}

// ---- 3. Shady Acres ---------------------------------------------------------------------------------------------

/** A single-wide trailer: `a` points its long axis; the door side is its local +y. */
function trailer(B, x, y, a, sec, o = {}) {
  const t = B.ob('building', x, y, o.L || 236, o.W || 82, a, { color: o.color || B.rng.pick(TRAILER_PAINT), roof: '#8a8d8a', section: sec });
  t.style = o.style || 'mr-trailer';
  t.top = 74;
  return t;
}
const TRAILER_PAINT = ['#e8e2d2', '#d8d0bc', '#b8cdd4', '#c9d8c0', '#e0c8a8', '#d4d4cc', '#a8b8c0', '#e6dcc8', '#c8b8a0'];

function trailers(B) {
  const sec = 'trailers';
  const X0 = XT, X1 = XB, Y1 = YT;
  // ---- fences: south (the gate from the gas station), east, west (the cut into the corn)
  fence(B, X0, Y1, X1, Y1, 'chainslat', [[5240 - X0, 5460 - X0, null]], { sec: 'gasstation' });
  B.gate('trailer_gate', 'gate', 5350, Y1, 220, 16, 0, { section: 'gasstation', label: 'Shady Acres gate', style: 'mr-slidegate' });
  prop(B, 'mr-gatetrack', 5350, Y1, 0, { w: 220 });
  fence(B, X1, 0, X1, Y1, 'chainslat', [], { sec });
  fence(B, X0, Y1, X0, 0, 'chain', [[Y1 - 500, Y1 - 300, null]], { sec });
  B.gate('corn_fence', 'fence', X0, 400, 200, 16, HALF, { section: sec, label: 'The farm fence', style: 'mr-fencepanel' });
  // ---- streets
  B.box('grass', X0, 0, X1, Y1);
  B.box('asphalt', 5270, 1750, 5430, Y1);
  B.box('gravel', 4600, 1750, 7540, 1910);        // south street
  B.box('gravel', 7380, 320, 7540, 1910);         // east street
  B.box('gravel', X0, 320, 7540, 480);            // north street (to the fence cut)
  B.box('gravel', 4600, 1020, 7540, 1180);        // middle street
  B.box('gravel', 4600, 320, 4760, 1910);         // west street
  prop(B, 'mr-parkarch', 5350, 2200, 0, { w: 200 });
  // ---- the office (a double-wide, walk in) by the entrance
  room(B, {
    x: 5700, y: 2090, w: 360, h: 240, look: 'trailerint', looks: {}, sec, floor: 'wood',
    doors: { w: [[-20, 80, 'screen']], n: [[80, 80, 'wood']] }, roof: { kind: 'house', height: 104, dark: 0.66 },
  });
  prop(B, 'mr-officetrailer', 5700, 2090, 0, { w: 360, h: 240 });
  ob(B, 'counter', 'mr-reception', 5640, 2090, 150, 36, HALF, { sec });
  ob(B, 'cabinet', 'mr-files', 5846, 2160, 90, 26, HALF, { sec });
  ob(B, 'desk', 'mr-desk', 5790, 2010, 90, 44, 0, { sec });
  B.light(5720, 2090, 200, '#ffe0b0', 0.2, 100);
  B.anchor('trailer_office', 5600, 2060, 110);
  // ---- trailers: rows along the streets (door sides to the street), gaps, a burned one, a crushed one
  const rowN = (y, xs, a, o = {}) => xs.forEach((x, i) => trailer(B, x + B.rng.range(-6, 6), y + B.rng.range(-4, 4), a + B.rng.range(-0.03, 0.03), sec, typeof o === 'function' ? o(i) : o));
  // block south of the middle street (door sides north / south) up to the pool
  rowN(1300, [4840, 5010, 5180, 5520, 5690, 5860, 6030, 6200], HALF, (i) => (i === 3 ? { style: 'mr-trailer-burnt', color: '#3a3430' } : {}));
  rowN(1630, [4840, 5010, 5350, 5520, 5690, 6030, 6200], -HALF);
  // block north of the middle street
  rowN(905, [4840, 5010, 5180, 5350, 6380, 6550, 6720, 6890, 7060, 7230], -HALF, (i) => (i === 6 ? { style: 'mr-trailer-tree', L: 220 } : { L: 220 }));
  rowN(595, [4840, 5010, 5180, 5350, 6380, 6550, 6890, 7060, 7230], HALF, { L: 220 });
  // along the south fence (facing north) and the north edge (facing south)
  rowN(2140, [6120, 6290, 6460, 6630, 6800, 6970, 7140, 7310], -HALF);
  rowN(190, [4840, 5010, 5180, 5350, 5520, 5690, 5860, 6200, 6370, 6540], HALF);
  // east strip (long axis east-west, facing the east street)
  for (const y of [700, 870, 1300, 1470, 1640]) trailer(B, 7660, y + B.rng.range(-4, 4), PI, sec);
  // the laundry block and the playground in the gap of the north block
  room(B, {
    x: 5780, y: 760, w: 240, h: 160, look: 'block', sec, floor: 'tile-white',
    doors: { s: [[0, 84, 'steel']], n: [[-60, 80, 'steel']] }, roof: { kind: 'plain', height: 110, dark: 0.6 },
  });
  prop(B, 'mr-laundry', 5780, 760, 0, { w: 240, h: 160 });
  prop(B, 'mr-playground', 6070, 780, 0);
  prop(B, 'mr-mailboxes', 5500, 1990, 0);
  // ---- the pool: fenced, drained to a green sludge, a pool house with the showers
  const PX0 = 6420, PX1 = 7290, PY0 = 1230, PY1 = 1710;
  fence(B, PX0, PY0, PX1, PY0, 'poolfence', [[140, 230, null]], { t: 12, sec });
  fence(B, PX0, PY1, PX1, PY1, 'poolfence', [[300, 390, null]], { t: 12, sec });
  fence(B, PX0, PY0, PX0, PY1, 'poolfence', [[180, 270, null]], { t: 12, sec });
  fence(B, PX1, PY0, PX1, PY1, 'poolfence', [], { t: 12, sec });
  B.box('concrete', PX0 + 8, PY0 + 8, PX1 - 8, PY1 - 8);
  B.box('water', 6560, 1330, 6980, 1560);
  prop(B, 'mr-pool', 6770, 1445, 0, { w: 420, d: 230 });
  room(B, {
    x: 7170, y: 1340, w: 200, h: 200, look: 'block', sec, floor: 'tile-white',
    doors: { w: [[40, 80, 'steel']] }, roof: { kind: 'plain', height: 100, dark: 0.7 },
  });
  prop(B, 'mr-poolhouse', 7170, 1340, 0);
  prop(B, 'mr-pooldeck', 6770, 1445, 0, { x0: PX0, y0: PY0, x1: PX1, y1: PY1 });
  B.anchor('trailer_pool', 6760, 1640, 130);
  // ---- Ozzy's radio shack under its mast (north-east corner)
  room(B, {
    x: 7090, y: 175, w: 300, h: 230, look: 'shack', sec, floor: 'wood-old',
    doors: { s: [[-40, 84, 'screen']] }, roof: { kind: 'house', height: 100, dark: 0.7, style: 'mr-shackroof' },
  });
  ob(B, 'counter', 'mr-radiodesk', 7090, 90, 220, 40, 0, { sec });
  ob(B, 'ipillar', 'mr-mast', 7320, 110, 26, 26, 0, { sec });
  prop(B, 'mr-shack', 7090, 175, 0, { w: 300, h: 230 });
  B.light(7090, 150, 190, '#ffc27a', 0.3, 90);
  B.light(7090, 130, 120, '#7affc8', 0.6, 60);
  B.anchor('trailer_radio', 7060, 210, 110);
  B.anchor('trailer_exit', 4580, 400, 130);
  // street lamps (some dead) and yard lights
  for (const [x, y, a] of [[5460, 1720, -HALF], [6300, 1720, -HALF], [7300, 1940, PI], [7560, 1100, PI], [7560, 400, PI], [6100, 510, -HALF], [5000, 510, -HALF], [4800, 1200, 0]]) B.lamp(x, y, { a, r: 240 });
  // checkpoints and spawns (between the rows, the north treeline, behind the east strip)
  B.checkpoint(sec, 5350, 2120);
  B.checkpoint(sec, 6700, 1830);
  B.checkpoint(sec, 7460, 1000);
  B.checkpoint(sec, 5600, 400);
  spawn(B, sec, 5500, 1465, 600, 44, 1);
  spawn(B, sec, 6600, 750, 500, 50, 1);
  spawn(B, sec, 5800, 40, 1300, 36, 1.2);
  spawn(B, sec, 7740, 1100, 36, 250, 0.8);
  spawn(B, sec, 4520, 1500, 120, 500, 1);
  spawn(B, sec, 7700, 2240, 120, 60, 0.6);
}

// ---- 4. The Haskell cornfield ---------------------------------------------------------------------------------------

function corn(B) {
  const sec = 'corn';
  // ---- the field (dirt under the corn), the farmyard, the drive down to Mill Road
  B.box('dirt', 150, 60, XT - 30, 3240);
  B.box('gravel', 380, 2330, 2360, 3200);
  B.box('gravel', 1440, 3200, 1580, RY - 150);
  // the corn: rectangles of rows, minus the clearings and the trampled lanes
  const paths = [
    [XT, 400, 3700, 480, 170], [3700, 480, 3280, 900, 160], [3280, 900, 2700, 1480, 170], [2700, 1480, 2250, 1720, 190],
    [2250, 1720, 1880, 2040, 170], [1880, 2040, 1500, 2380, 180],
    [3280, 900, 3620, 1760, 130], [3620, 1760, 3060, 2460, 130], [3060, 2460, 2380, 2760, 130],
    [1200, 700, 2000, 1250, 110], [2000, 1250, 2250, 1720, 110],
  ];
  const clear = [[2240, 1720, 260], [3160, 1030, 150], [1060, 2500, 180], [3900, 3000, 130]];
  artOf(B).corn = {
    rects: [[150, 90, XT - 30, 2330], [2360, 2330, XT - 30, 3180]],
    paths, clear,
  };
  // ---- the scarecrow in its clearing, the tractor stuck in the rows, the irrigation pivot
  prop(B, 'mr-scarecrow', 2200, 1680, 0.4);
  B.ob('wall', 2200, 1680, 14, 14, 0, { style: 'nodraw', section: sec });
  B.anchor('corn_scarecrow', 2300, 1780, 150);
  B.ob('truck', 3130, 1060, 104, 58, 2.45, { color: '#2f6a3a', section: sec, style: 'mr-tractor' });
  B.anchor('corn_tractor', 3030, 1190, 150);
  prop(B, 'mr-pivot', 2620, 2020, -2.2, { len: 1500 });
  B.ob('wall', 2620, 2020, 40, 40, 0, { style: 'nodraw', section: sec });
  // ---- the farmyard: the silos, grain bins, the barn, the machine shed with a combine, the house
  B.ob('silo', 1060, 2420, 100, 100, 0, { color: '#b8bcbf', section: sec });
  B.ob('silo', 900, 2330, 76, 76, 0, { color: '#a9aeb2', section: sec });
  prop(B, 'mr-siloextras', 1060, 2420, 0);
  for (const [x, y] of [[700, 2640], [700, 2800]]) ob(B, 'silo', 'mr-grainbin', x, y, 110, 110, 0, { sec, color: '#c0c4c6' });
  const barn = B.ob('building', 1600, 2530, 300, 200, 0, { color: '#7d3a2c', roof: '#5a2b22', section: sec });
  barn.arch = 'barn';
  prop(B, 'mr-barnsign', 1600, 2530, 0, { w: 300, h: 200 });
  // the machine shed: open along its south side, a combine harvester parked in it
  const SX0 = 1960, SX1 = 2300, SY0 = 2440, SY1 = 2640;
  wall(B, SX0, SY0, SX1, SY0, 'shed', { t: 12, side: 'in', sec, ext: 6 });
  wall(B, SX1, SY0, SX1, SY1, 'shed', { t: 12, side: 'in', sec, ext: 6 });
  wall(B, SX0, SY1, SX0, SY0, 'shed', { t: 12, side: 'in', sec, ext: 6 });
  B.roof((SX0 + SX1) / 2, (SY0 + SY1) / 2 + 10, SX1 - SX0 + 20, SY1 - SY0 + 40, 0, { kind: 'industrial', height: 140, section: sec, dark: 0.5, style: 'mr-shedroof' });
  B.ob('truck', 2130, 2530, 170, 70, PI, { color: '#2f7a3a', section: sec, style: 'mr-combine' });
  const farmhouse = B.ob('building', 640, 3050, 220, 170, -HALF, { color: '#e0d8c6', roof: '#3f3a38', section: sec });
  farmhouse.arch = 'house'; farmhouse.lit = 0.1;
  B.ob('pickup', 980, 3000, 100, 46, 1.2, { color: '#8a2f2a', section: sec, wrecked: true });
  B.anchor('corn_silo', 1150, 2560, 150);
  for (const [x, y, a] of [[1300, 2880, 0.2], [1360, 2930, 1.2], [1250, 2960, 2.2], [2500, 2980, 0.4], [480, 2500, 1]]) B.ob('rock', x, y, 34, 34, a, { color: '#c9a850', section: sec, style: 'mr-bale' });
  prop(B, 'mr-farmfence', XT / 2 + 100, RY - 200, 0, { len: XT - 400, gaps: [[1400, 1620]] });
  prop(B, 'mr-farmgate', 1510, RY - 200, 0, { w: 220 });
  B.lamp(1510, 2960, { a: -HALF, r: 300 });
  B.lamp(700, 2480, { a: 0, r: 260 });
  B.light(2130, 2540, 220, '#ffc070', 0.2, 120);
  // ---- Mill Road in front of the Roadhouse
  for (const [k, x, y, a, w] of [['car', 3200, 3456, PI + 0.1, false], ['suv', 3700, 3545, 0.4, true], ['car', 1000, 3450, PI - 0.3, true], ['van', 400, 3542, 0.05, false]]) {
    B.vehicle(k, x, y, a, { wrecked: w, jitter: 0.3 }).section = sec;
  }
  prop(B, 'mr-roadsign', 3000, RY - 125, PI, { text: 'roadhouse' });
  // checkpoints and spawns (deep in the corn, the treeline, behind the barn and the house)
  B.checkpoint(sec, 4250, 420);
  B.checkpoint(sec, 2330, 1640);
  B.checkpoint(sec, 1500, 2960);
  B.checkpoint(sec, 2400, RY - 10);
  spawn(B, sec, 3900, 1500, 300, 300, 1);
  spawn(B, sec, 3000, 2150, 400, 260, 1);
  spawn(B, sec, 1150, 1200, 500, 460, 1.2);
  spawn(B, sec, 600, 600, 400, 400, 0.8);
  spawn(B, sec, 2600, 450, 500, 240, 0.8);
  spawn(B, sec, 260, 2700, 120, 400, 1);
  spawn(B, sec, 3900, 2900, 400, 300, 1);
  spawn(B, sec, 200, RY, 150, 250, 0.8);
}

// ---- 5. The Roadhouse gate ---------------------------------------------------------------------------------------------

function motel(B) {
  const sec = 'motel';
  const gx = 2600;
  // the Roadhouse's scrap wall along Mill Road, its gate facing the road
  fence(B, 0, YM, XT, YM, 'scrap', [[gx - 120, gx + 120, null]], { t: 30, sec: 'corn' });
  B.gate('motel_gate', 'gate', gx, YM, 240, 26, 0, { section: 'corn', label: 'The Roadhouse gate', style: 'mr-rhgate' });
  prop(B, 'mr-rhgateframe', gx, YM, 0, { w: 240 });
  B.anchor('motel_gate', gx, YM - 100, 140);
  // the lot inside, the sign, the motel block, the office, the diner, the junk yard
  B.box('sand', 0, YM + 15, XT - 20, H);
  B.box('asphalt', 1000, YM + 30, 3950, 4060);
  for (let x = 1100; x <= 2400; x += 90) B.line('parking', x, 3970, x, 4055, 3);
  const motelBlock = B.ob('building', 1700, 4190, 1400, 150, PI, { color: '#cdb48c', roof: '#5c4a3a', section: sec });
  motelBlock.arch = 'motel'; motelBlock.top = 132; motelBlock.lit = 0.3;
  const office = B.ob('building', 2560, 4200, 150, 130, PI, { color: '#7d9089', roof: '#4a4038', section: sec });
  office.arch = 'house'; office.top = 120; office.lit = 1; office.style = 'mr-rhoffice';
  ob(B, 'building', 'mr-rhdiner', 600, 4100, 300, 170, PI, { sec, color: '#c8cdd0' });
  ob(B, 'ipillar', 'mr-rhsign', 3050, 3830, 20, 20, PI, { sec });
  B.anchor('motel_sign', 3000, 3920, 150);
  B.anchor('motel_lot', 2000, 3890, 220);
  B.anchor('motel_door', 2560, 4080, 100);
  for (const [k, x, y, a, wr] of [['car', 1400, 4010, HALF, false], ['pickup', 1850, 4000, HALF + 0.1, false], ['car', 3300, 3900, 0.8, true], ['van', 3600, 4010, HALF, false]]) {
    B.vehicle(k, x, y, a, { wrecked: wr, jitter: 0.2 }).section = sec;
  }
  for (const [x, y, a] of [[4100, 3860, 0.2], [4250, 4050, 1.3], [4080, 4240, 0.6]]) B.vehicle('car', x, y, a, { wrecked: true, jitter: 0 }).section = sec;
  prop(B, 'mr-junk', 4150, 4050, 0);
  for (const [x, y, w] of [[2380, 3790, 140], [2820, 3790, 140]]) B.ob('sandbags', x, y, w, 26, 0, { section: sec });
  B.fire(2250, 3860, 14);
  B.fire(2950, 3860, 14);
  B.light(2600, 3800, 260, '#ffc27a', 0, 150);
  B.light(1700, 4060, 300, '#ffd6a0', 0, 110);
  B.light(3050, 3830, 320, '#ff5a9c', 0, 250);
  B.checkpoint(sec, 2600, 3850);
  B.checkpoint(sec, 2150, 3870);
  spawn(B, sec, 1700, 4340, 1200, 60, 1);
  spawn(B, sec, 4300, 3900, 100, 140, 0.8);
  spawn(B, sec, 150, 4000, 120, 200, 0.8);
  void TAU;
}
