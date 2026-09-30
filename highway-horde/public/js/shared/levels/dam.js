// Blackwater Dam — story level (JOURNEY.md). Owner: agent C3.
//
// SPEC is the contract other parts depend on (the mission scripts, the engine, the tests): keep every
// section id (in this order), anchor name and gate id. Change the layout, the size, add sections,
// anchors, gates and props freely.
//
// The river bridge is out, so the dam is the only crossing to Blackwater Depot. The level is a canyon:
//
//   Canyon Road   the crew walks out of a highway tunnel at the west edge, down a canyon past a
//                 jackknifed truck, to a fork: the highway bridge ahead is down in the river (BRIDGE OUT),
//                 the dam access road turns north to the spillway gate.
//   Spillway      the spillway yard at the foot of the dam: the chute roars down the dam face into the
//                 stilling basin, a steel service bridge crosses the white water to the valve platform.
//   Control Room  the control building against the west abutment: vestibule, control room with panels,
//                 desks and big windows onto the basin, the radio office, and the stair hall.
//   Dam Crest     a stair shaft climbs 520 units through the abutment to the crest: a 4000-unit road
//                 between parapets with the reservoir lapping on one side and a sheer drop to the river
//                 on the other, the spillway hoist houses, a gantry crane; a second shaft goes down.
//   Turbine Hall  the powerhouse at the dam's toe: four generators, the crane, the breaker panel; out
//                 through the tailrace yard to the old highway and the River gate.
//   Riverside     the village on the east bank: the main street along the river, docks, the church,
//                 the back lane, and the Blackwater Depot gate at the east end.
//
// The crest and the two stair shafts stand on terrain (shared/terrain.js plateaus, as the campaign's
// floors): the sim walks the stairs and the crest 520 units up, and every gate and roof stays on the
// ground (height 0), where the engine's generic gate and roof code expect them. The level art
// (render3d/levels/dam.js) reads `map.levelArt` for the pieces it draws that are not obstacles.
//
// The helpers below (walls, stair terrain, cliff lines) are shared by the other two levels of this
// owner (railyard.js, airbase.js).

export const SPEC = Object.freeze({
  "id": "dam",
  "name": "Blackwater Dam",
  "chapter": 3,
  "time": "day",
  "owner": "C3",
  "description": "A storm over the river: the canyon road, the spillway, the control room, the walkway along the crest, the turbine hall and the river village below the depot.",
  "sections": [
    {
      "id": "road",
      "name": "Canyon Road"
    },
    {
      "id": "spillway",
      "name": "Spillway"
    },
    {
      "id": "control",
      "name": "Control Room"
    },
    {
      "id": "crest",
      "name": "Dam Crest"
    },
    {
      "id": "turbines",
      "name": "Turbine Hall"
    },
    {
      "id": "riverside",
      "name": "Riverside"
    }
  ],
  "anchors": {
    "road": [
      "start",
      "road_tunnel",
      "road_truck"
    ],
    "spillway": [
      "spill_valve",
      "spill_bridge"
    ],
    "control": [
      "control_panel",
      "control_door",
      "control_radio"
    ],
    "crest": [
      "crest_mid",
      "crest_crane"
    ],
    "turbines": [
      "turbine_breaker",
      "turbine_floor",
      "turbine_exit"
    ],
    "riverside": [
      "river_boat",
      "depot_gate"
    ]
  },
  "gates": [
    {
      "id": "spill_gate",
      "kind": "gate",
      "from": "road",
      "to": "spillway",
      "label": "Spillway gate"
    },
    {
      "id": "control_door",
      "kind": "door",
      "from": "spillway",
      "to": "control",
      "label": "Control room door"
    },
    {
      "id": "crest_gate",
      "kind": "bars",
      "from": "control",
      "to": "crest",
      "label": "Crest gate"
    },
    {
      "id": "turbine_door",
      "kind": "shutter",
      "from": "crest",
      "to": "turbines",
      "label": "Turbine hall door"
    },
    {
      "id": "river_gate",
      "kind": "gate",
      "from": "turbines",
      "to": "riverside",
      "label": "River gate"
    }
  ]
});

/** World size and mood (maps.js MAP_DEFS). */
export const DEF = { width: 11200, height: 4000, darkness: 0.6, tint: '#3c4c5e', ground: '#4a4f3e' };

// ---- the C3 kit: helpers shared by dam.js, railyard.js and airbase.js --------------------------------

const r1 = (v) => Math.round(v * 10) / 10;

/**
 * An axis-aligned solid wall from its corners. `o` = B.ob opts (style, section, color...).
 * Returns the obstacle.
 */
export function wallBox(B, x0, y0, x1, y1, o = {}) {
  return B.ob('wall', (x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), 0, o);
}

/**
 * A straight wall of thickness `t` from (x0, y0) to (x1, y1), axis aligned, with gaps [[a, b], ...]
 * along its length (doorways). Pieces shorter than 12 are dropped. Returns the pieces.
 */
export function wallLine(B, x0, y0, x1, y1, t, gaps = [], o = {}) {
  const out = [];
  const horiz = Math.abs(y1 - y0) < 1e-6;
  const a0 = horiz ? Math.min(x0, x1) : Math.min(y0, y1), a1 = horiz ? Math.max(x0, x1) : Math.max(y0, y1);
  let cur = a0;
  const spans = [];
  for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) {
    if (g0 > cur) spans.push([cur, Math.min(g0, a1)]);
    cur = Math.max(cur, g1);
  }
  if (cur < a1) spans.push([cur, a1]);
  for (const [p, q] of spans) {
    if (q - p < 12) continue;
    out.push(horiz ? wallBox(B, p, y0 - t / 2, q, y0 + t / 2, o) : wallBox(B, x0 - t / 2, p, x0 + t / 2, q, o));
  }
  return out;
}

/** A wall along a polyline of [x, y] points (any angles), `t` thick, split into pieces of at most maxLen. */
export function wallPath(B, pts, t, o = {}, maxLen = 600) {
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 4) continue;
    const n = Math.max(1, Math.ceil(len / maxLen));
    const a = Math.atan2(y1 - y0, x1 - x0);
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      // pieces overlap a little at the joints so a bend never leaves a gap
      const cx = x0 + (x1 - x0) * (t0 + t1) / 2, cy = y0 + (y1 - y0) * (t0 + t1) / 2;
      out.push(B.ob('wall', cx, cy, len / n + t, t, a, o));
    }
  }
  return out;
}

/**
 * Terrain for a straight flight of stairs over the rectangle [x0, x1] × [y0, y1]: `up` is the side the
 * flight climbs toward ('n' = -y, 's' = +y, 'e' = +x, 'w' = -x), from h0 at the foot to h1 at the head.
 * Each tread is a plateau covering the flight from its own edge to the head, so the height field (the
 * highest plateau) is a clean staircase; risers stay under the sim's walking snap (12 units), so bodies
 * walk it both ways. Pushes the plateaus onto `plats` and returns the flight record the art draws.
 */
export function stairFlight(plats, x0, y0, x1, y1, up, h0, h1, rise = 11.5) {
  const n = Math.max(1, Math.ceil(Math.abs(h1 - h0) / rise));
  const alongY = up === 'n' || up === 's';
  const len = alongY ? y1 - y0 : x1 - x0;
  const run = len / n;
  for (let k = 0; k < n; k++) {
    const h = r1(h0 + ((h1 - h0) * (k + 1)) / n);
    // tread k spans from the foot + k runs to the head
    let p;
    if (up === 'n') p = { x0, x1, y0, y1: r1(y1 - k * run) };
    else if (up === 's') p = { x0, x1, y0: r1(y0 + k * run), y1 };
    else if (up === 'e') p = { x0: r1(x0 + k * run), x1, y0, y1 };
    else p = { x0, x1: r1(x1 - k * run), y0, y1 };
    plats.push({ ...p, h, edge: 1.5 });
  }
  return { x0, y0, x1, y1, up, h0, h1, n };
}

/** A flat raised floor (a landing, a deck) over [x0, x1] × [y0, y1] at height h. */
export function landing(plats, x0, y0, x1, y1, h, edge = 2) {
  plats.push({ x0, y0, x1, y1, h, edge });
}

/**
 * The level art's own record on the map (`map.levelArt`): lists of things the art draws that are not
 * obstacles (cliff lines, stair flights, water planes, spans). Plain data, part of the deterministic map.
 */
export function artData(B) {
  if (!B.map.levelArt) B.map.levelArt = { cliffs: [], flights: [], planes: [], marks: [] };
  return B.map.levelArt;
}

/**
 * A canyon wall along a polyline: the art draws a rock face of height `h` whose foot runs along `pts`,
 * facing `side` (+1: the walkable side is to the left of the direction of travel, -1: to the right).
 * `wall` (default true) also lays a solid wall along the foot so nobody walks into the rock.
 */
export function cliffLine(B, pts, h, side = 1, o = {}) {
  const A = artData(B);
  A.cliffs.push({ pts: pts.map(([x, y]) => [r1(x), r1(y)]), h, side, seed: A.cliffs.length * 7 + 3, rough: o.rough ?? 1 });
  if (o.wall !== false) {
    // the solid foot sits a little inside the rock (the face leans over it)
    const off = o.inset ?? 18;
    const pts2 = offsetPath(pts, -side * off);
    wallPath(B, pts2, 40, { style: 'nodraw', section: o.section });
  }
}

/** A polyline moved sideways by d (to the left of the direction of travel for d > 0). */
export function offsetPath(pts, d) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l; ty /= l;
    // left of travel in sim space (y down on the map): (ty, -tx)
    out.push([p[0] + ty * d, p[1] - tx * d]);
  }
  return out;
}

/** Player spawns in two rows of three around (x, y), facing along +x. */
export function spawnRows(B, x, y, dx = 70, dy = 70) {
  for (let k = 0; k < 6; k++) B.pspawn(x + (k % 3) * dx - dx, y + (Math.floor(k / 3) - 0.5) * dy);
}

// ---- the layout ----------------------------------------------------------------------------------------

/** Height of the dam crest (the sim walks it on a terrain plateau). */
export const DAM_Z = 520;

/** Key coordinates the art reads too (world units). */
export const DAM = Object.freeze({
  crest: { x0: 3500, x1: 7640, y0: 700, y1: 900 },      // the walkable crest road between the parapets
  toeY: 1250,                                           // the foot of the downstream face
  reservoir: 470,                                       // the reservoir's surface height
  spill: { x0: 4800, x1: 5440 },                        // the spillway chute on the downstream face
  westStair: { x0: 3540, x1: 3700, y0: 1000, y1: 1740 },
  eastStair: { x0: 7440, x1: 7600, y0: 1000, y1: 1740 },
  control: { x0: 3500, x1: 4420, y0: 1300, y1: 1900 },
  hall: { x0: 5900, x1: 7430, y0: 1250, y1: 1900 },
  crane: 6260,
});

/**
 * Lay the level out.
 * @param {object} B map builder (maps.js createBuilder) with the level calls of JOURNEY.md §3
 */
export function build(B) {
  const { W, H } = B;
  const plats = [];
  B.map.terrain = { hills: [], plateaus: plats };
  // a storm over the canyon by day, a wet blue-black night (the renderers read map.look)
  B.map.look = {
    day: {
      az: 205, el: 38, haze: '#8e979c', horizon: '#9aa3a8', zenith: '#4f5c68', fog: 0.00036, cover: 0.97,
      sunColor: '#dfe6ee', sunI: 1.9, hemiSky: '#a9b6c4', hemiGround: '#5a5a4a', hemi: 1.12, exposure: 1.06,
      heat: 0, ridge: '#4f5a60', wet: 0.95, mist: 1.6,
      grade: { saturation: 0.86, contrast: 1.08, gain: [0.99, 1.0, 1.02], vignette: 0.26 },
    },
    night: {
      fog: '#0b1117', horizon: '#141c24', zenith: '#03060a', sky: '#5f7188', ground: '#2a2a26', moon: '#8ea4c4',
      fogDensity: 0.00118, hemi: 0.9, moonI: 0.42,
    },
    deciduous: 0.15,
  };
  const A = artData(B);
  const C = DAM.crest;

  // =====================================================================================================
  // sections (travel order) and the zombies' spawn rects
  B.section('road', 'Canyon Road', 2350, 3220, 4700, 1160);
  B.section('spillway', 'Spillway', 3975, 1960, 1550, 1320);
  B.section('control', 'Control Room', 3960, 1600, 920, 600);
  B.section('crest', 'Dam Crest', 5570, 820, 4140, 360);
  B.section('turbines', 'Turbine Hall', 6660, 2100, 1540, 1700);
  B.section('riverside', 'Riverside', 9300, 2540, 3800, 1260);

  // =====================================================================================================
  // ground: the reservoir, the river, the canyon floor
  // the reservoir (the art draws its surface up at the crest; the sim sees water)
  B.box('water', 0, 0, W, 660);
  // the river below the dam: the stilling basin with the valve platform and the service bridge, the
  // tailwater, then the bend east along the village
  B.box('water', 4700, 1250, 5900, 1480);        // the basin under the chute
  B.box('water', 5260, 1480, 5900, 1900);        // east of the platform
  B.box('water', 4700, 1640, 5000, 1900);        // south of the service bridge
  B.box('water', 4700, 1900, 5900, 2960);        // the tailwater
  B.box('water', 4700, 2950, 8560, 3700);        // the river east...
  B.box('water', 8560, 3160, 8680, 3700);       // ...under the dock
  B.box('water', 8680, 2950, W, 3700);           // ...and past the village
  // paved and bare ground
  B.box('dirt', 0, 2600, 4700, 3800);
  B.box('gravel', 60, 3000, 1600, 3700);
  B.box('gravel', 2500, 2700, 4700, 3300);
  B.box('concrete', 3200, 1900, 4700, 2640);     // the spillway yard
  B.box('concrete', 4420, 1260, 4700, 1900);     // the quay
  B.box('concrete', 5000, 1480, 5260, 1900);     // the valve platform
  B.box('concrete', 4700, 1480, 5000, 1640);     // the service bridge
  B.box('concrete', C.x0 - 40, C.y0 - 20, C.x1 + 40, C.y1 + 20);   // the crest
  B.box('asphalt', C.x0 - 40, C.y0 + 40, C.x1 + 40, C.y1 - 40);    // the crest road
  B.box('concrete', 5880, 1900, 7430, 2640);     // the tailrace yard
  B.box('gravel', 7440, 1880, W, 2640);          // the village
  B.box('dirt', 7440, 1880, W, 2020);
  B.box('grass', 7600, 2140, 11000, 2500);
  B.box('concrete', 7440, 2500, W, 2640);
  B.box('concrete', 7440, 2840, W, 2950);
  // the old highway: through the tunnel, down the canyon to the fallen bridge; past the river along the village
  B.box('asphalt', 60, 3250, 1500, 3470);
  B.area('asphalt', 2050, 3160, 1180, 220, -0.405);
  B.box('asphalt', 2540, 2880, 4700, 3100);
  B.box('asphalt', 3390, 2620, 3610, 2900);      // the dam access road
  B.box('asphalt', 5880, 2640, W, 2840);         // the main street
  B.box('asphalt', 6180, 1900, 6400, 2640);      // the yard road
  B.box('asphalt', 8800, 2140, 9000, 2640);      // the church lane
  B.box('asphalt', 7440, 2020, 10800, 2140);     // the back lane

  // paint
  B.line('yellow_double', 60, 3360, 1500, 3360, 3);
  B.line('yellow_double', 1500, 3360, 2560, 2990, 3);
  B.line('yellow_double', 2560, 2990, 4640, 2990, 3);
  for (const y of [3262, 3458]) B.line('white', 60, y, 1500, y, 3);
  B.line('white', 2560, 2892, 4640, 2892, 3);
  B.line('white', 2560, 3088, 4640, 3088, 3);
  B.line('yellow_double', 5900, 2740, W, 2740, 3);
  B.line('white', 5900, 2652, W, 2652, 3);
  B.line('white', 5900, 2828, W, 2828, 3);
  B.line('yellow', C.x0, (C.y0 + C.y1) / 2, C.x1, (C.y0 + C.y1) / 2, 3);
  B.line('white', C.x0, C.y0 + 44, C.x1, C.y0 + 44, 3);
  B.line('white', C.x0, C.y1 - 44, C.x1, C.y1 - 44, 3);
  B.line('stop', 3400, 2660, 3600, 2660, 6);
  B.line('crosswalk', 7520, 2650, 7520, 2830, 40);

  buildRoad(B, A);
  buildSpillway(B, A);
  buildControl(B, A);
  buildCrest(B, A, plats);
  buildTurbines(B, A);
  buildRiverside(B, A);
  buildCanyon(B, A);

  // ---- the world's edges (nothing leaves the canyon)
  wallBox(B, 0, 0, 40, H, { style: 'nodraw' });
  wallBox(B, W - 40, 0, W, H, { style: 'nodraw' });
  wallBox(B, 0, 0, W, 40, { style: 'nodraw' });
  wallBox(B, 0, H - 40, W, H, { style: 'nodraw' });

  B.groundClutter({ cracks: 90, oil: 16, paper: 40, debris: 50, blood: 26, tires: 5, tufts: 260, bushes: 40, rocks: 40 });
}

// ---- 1. the canyon road ---------------------------------------------------------------------------------

function buildRoad(B, A) {
  const S = { section: 'road' };
  // the tunnel: its bore runs off the map (caved in behind the party), the portal at x 360
  wallLine(B, 40, 3240, 380, 3240, 20, [], { style: 'tunnelwall', ...S });
  wallLine(B, 40, 3480, 380, 3480, 20, [], { style: 'tunnelwall', ...S });
  wallBox(B, 40, 3250, 70, 3470, { style: 'rubblewall', ...S });
  B.roof(210, 3360, 340, 240, 0, { kind: 'plain', height: 170, section: 'road', dark: 0.85, style: 'tunnel' });
  A.marks.push({ t: 'portal', x: 380, y: 3360, a: 0, w: 240 });
  // wrecks in and out of the tunnel
  B.vehicle('car', 180, 3300, 0.1, { wrecked: true });
  B.vehicle('van', 250, 3425, -0.08, { wrecked: true });
  B.vehicle('car', 860, 3280, 0.35, { wrecked: true });
  B.vehicle('suv', 1000, 3440, -0.2);
  B.vehicle('car', 1120, 3285, 0.05, { wrecked: true, burning: true });
  // the jackknifed rig across the bend, a car crushed under its trailer
  const [tr] = B.semi(1980, 3175, -0.405 + 0.62, -1.5, { wrecked: true, trailerColor: '#b7b3aa', cabColor: '#2f4f6f' });
  void tr;
  B.vehicle('car', 1840, 3270, 2.4, { wrecked: true });
  B.vehicle('pickup', 2260, 3000, Math.PI - 0.5, { wrecked: true, burning: true });
  // the rockslide against the north wall of the bend and fallen boulders
  B.ob('rock', 1560, 3070, 90, 70, 0.4);
  B.ob('rock', 1650, 3040, 60, 50, 1.1);
  B.ob('rock', 2420, 2860, 80, 60, 0.2);
  B.ob('rock', 1200, 3560, 70, 60, 0.7);
  // a highway patrol roadblock that failed: jersey barriers, a cruiser, flares
  B.ob('barrier', 2980, 2920, 110, 20, 0.2);
  B.ob('barrier', 3120, 3060, 110, 20, -0.15);
  B.vehicle('car', 3240, 2960, Math.PI / 2 + 0.3, { color: '#e8e6e0', jitter: 0 });
  B.ob('sandbags', 3700, 3180, 120, 26, 0.1);
  // the bridge approach: barricade across the road, the fallen deck beyond (art)
  B.ob('barrier', 4560, 2930, 120, 20, Math.PI / 2);
  B.ob('barrier', 4560, 3050, 120, 20, Math.PI / 2);
  B.ob('barrier', 4480, 2990, 90, 20, Math.PI / 2 + 0.3);
  B.vehicle('car', 4380, 3150, 0.9, { wrecked: true });
  B.vehicle('truck', 4250, 2900, 0.1, { color: '#4b5320', jitter: 0, wrecked: true });
  A.marks.push({ t: 'bridgeout', x: 4700, y: 2990, a: 0 });
  // a rest stop in the pocket north of the road: a booth and a picnic shelter
  B.ob('booth', 820, 3100, 60, 60, 0.1);
  B.ob('building', 3060, 3230, 170, 110, 0, { color: '#8a7a64', roof: '#4a3f33', section: 'road' }).arch = 'shack';

  // lights (the day storm is dim, the night black): the tunnel's lamps, flares, a burning wreck
  for (const x of [110, 230, 350]) B.light(x, 3360, 180, '#ffb35a', x === 230 ? 0.35 : 0, 150);
  B.fire(1130, 3285, 20);
  B.fire(2260, 3000, 18);
  B.light(4520, 2990, 200, '#ff4a3a', 0.6, 20);   // road flares at the barricade
  B.light(3240, 2960, 180, '#5a8cff', 0.5, 70);    // the cruiser's light bar
  for (const [x, y] of [[1400, 3240], [2700, 2860], [3900, 2860]]) B.lamp(x, y, { color: '#ffb04a', r: 260 });

  // anchors, spawns, checkpoints
  B.anchor('start', 640, 3360, 180);
  B.anchor('road_tunnel', 360, 3360, 200);
  B.anchor('road_truck', 2060, 3290, 180);
  spawnRows(B, 560, 3360);
  B.supply(760, 3180);
  B.checkpoint('road', 700, 3300);
  B.checkpoint('road', 760, 3430);
  B.checkpoint('road', 2680, 3000);
  B.checkpoint('road', 3300, 3100);
  // zombies come from ahead: the side ravine in the bend, the rest stop, the bridge approach, the south gulch
  B.zspawn(1700, 3560, 160, 110, 1, 'road');
  B.zspawn(2600, 3260, 160, 100, 1, 'road');
  B.zspawn(3060, 3310, 160, 40, 1, 'road');
  B.zspawn(4150, 3100, 200, 80, 1.4, 'road');
  B.zspawn(3900, 2720, 180, 90, 1.2, 'road');
}

// ---- 2. the spillway ------------------------------------------------------------------------------------

function buildSpillway(B, A) {
  const S = { section: 'spillway' };
  // the yard's south wall with the spillway gate across the access road
  wallLine(B, 3200, 2640, 4700, 2640, 24, [[3380, 3620]], { style: 'yardwall', ...S });
  B.gate('spill_gate', 'gate', 3500, 2640, 240, 16, 0, { section: 'road', label: 'Spillway gate', style: 'yardgate' });
  // the basin's edge along the quay, the platform's rails (low, see-through: water is the barrier)
  // the valve platform: the valve wheel on its pedestal and the gate-control cabinet
  B.ob('wall', 5130, 1535, 40, 36, 0, { style: 'valvewheel', ...S });
  B.ob('wall', 5210, 1760, 40, 90, 0, { style: 'cabinet', ...S });
  // the yard: the valve house, a crane truck, pipe stacks, a generator
  B.ob('building', 3560, 2100, 200, 150, 0, { color: '#8e8a80', roof: '#4a4e52', section: 'spillway' }).arch = 'industrial';
  B.vehicle('truck', 3900, 2450, 0.15, { color: '#c9a02a', jitter: 0 });
  B.ob('container', 4250, 2520, 150, 56, 0.05, { color: '#2f5a78', ...S });
  B.ob('container', 3320, 2400, 60, 44, 0, { color: '#4a4f35', roof: '#3f432d', ...S });
  B.ob('sandbags', 4120, 2200, 110, 24, -0.3);
  B.ob('sandbags', 4560, 2360, 100, 24, Math.PI / 2);
  B.vehicle('pickup', 4540, 2080, Math.PI / 2 + 0.1, { color: '#e8e2d0', jitter: 0 });
  A.marks.push({ t: 'pipes', x: 3880, y: 1990, a: 0.05 });

  // lights: floods on poles over the basin, the quay's lamps
  for (const [x, y] of [[4460, 1400], [4460, 1880], [3300, 2560], [4640, 2560]]) {
    B.decor('lamp_post', x, y, x < 4000 ? 0 : Math.PI, 1.25);
    B.light(x, y, 360, '#e8f0ff', 0);
  }
  B.light(5130, 1700, 260, '#ffd08a', 0, 90);
  B.light(3560, 2200, 200, '#ffcf8a', 0.15, 110);

  B.anchor('spill_bridge', 4860, 1560, 140);
  B.anchor('spill_valve', 5130, 1610, 120);
  B.checkpoint('spillway', 3700, 2520);
  B.checkpoint('spillway', 4200, 2360);
  B.checkpoint('spillway', 4560, 2200);
  B.zspawn(3320, 2180, 120, 180, 1, 'spillway');
  B.zspawn(4560, 1360, 140, 110, 1, 'spillway');
  B.zspawn(5110, 1850, 120, 70, 0.8, 'spillway');
  B.zspawn(4000, 2000, 160, 100, 1, 'spillway');
}

// ---- 3. the control building ------------------------------------------------------------------------------

function buildControl(B, A) {
  const S = { section: 'control' };
  const K = DAM.control;
  const T = 20;
  const ext = { style: 'cext', ...S };
  const int = { style: 'cwall', ...S };
  // shell: the north wall against the abutment, the east wall on the quay (the door and the big windows)
  wallLine(B, 3720, K.y0, K.x1, K.y0, T, [], ext);
  wallLine(B, K.x0, K.y1, K.x1, K.y1, T, [], ext);
  wallLine(B, K.x1, K.y0, K.x1, K.y1, T, [[1640, 1780]], { ...ext, style: 'cwindows' });
  B.gate('control_door', 'door', K.x1, 1710, 20, 140, 0, { section: 'spillway', label: 'Control room door', style: 'steeldoor' });
  // the stair hall (west wing) and its wall with a doorway, the stair shaft's walls
  wallLine(B, 3720, 1740, 3720, K.y1, 16, [[1760, 1880]], int);
  wallLine(B, 3530, 900, 3530, K.y1, 20, [], { style: 'shaft', ...S });
  wallLine(B, 3710, 900, 3710, 1756, 20, [], { style: 'shaft', ...S });
  // the dam's toe between the building and the basin (nobody walks under the downstream face)
  wallBox(B, 4380, 1240, 4700, 1300, { style: 'toewall', ...S });
  B.gate('crest_gate', 'bars', 3620, 1748, 160, 16, 0, { section: 'control', label: 'Crest gate', style: 'cagebars' });
  // the radio office (NE) and the vestibule (SE): partition with doorways
  wallLine(B, 4180, K.y0, 4180, 1560, 16, [[1400, 1500]], int);
  wallLine(B, 4180, 1560, K.x1, 1560, 16, [[4250, 4350]], int);
  wallLine(B, 4180, 1620, 4180, K.y1, 16, [[1650, 1800]], int);
  // furniture: the long control desk before the windows, the panel wall (north), work desks, lockers
  B.ob('wall', 3950, 1330, 400, 30, 0, { style: 'panelwall', ...S });
  B.ob('desk', 3950, 1470, 300, 44, 0, { style: 'ctrldesk', ...S });
  B.ob('desk', 3830, 1640, 120, 50, 0.1, { style: 'desk', ...S });
  B.ob('desk', 4060, 1680, 120, 50, -0.2, { style: 'desk', ...S });
  B.ob('cabinet', 3760, 1330, 60, 30, 0, { style: 'rack', ...S });
  B.ob('cabinet', 4120, 1840, 90, 30, 0, { style: 'lockers', ...S });
  B.ob('desk', 4300, 1330, 180, 40, 0, { style: 'radiodesk', ...S });
  B.ob('cabinet', 4400, 1470, 30, 90, 0, { style: 'rack', ...S });
  B.ob('counter', 4300, 1840, 160, 30, 0, { style: 'counter', ...S });
  B.roof((3720 + K.x1) / 2, (K.y0 + K.y1) / 2, K.x1 - 3720, K.y1 - K.y0, 0, { kind: 'office', height: 150, section: 'control', dark: 0.7, style: 'controlroom' });
  B.roof(3620, (1740 + K.y1) / 2, 200, K.y1 - 1740, 0, { kind: 'plain', height: 150, section: 'control', dark: 0.8, style: 'stairhall' });
  // lamps: tube rows, the red emergency light in the stair hall, the radio's lamp
  for (const [x, y] of [[3880, 1420], [3880, 1740], [4060, 1560], [4300, 1440], [4300, 1720]]) B.light(x, y, 230, '#e4ecff', x === 4060 ? 0.3 : 0, 140);
  B.light(3620, 1820, 200, '#ff3a2a', 0.5, 130);

  B.anchor('control_door', 4500, 1710, 120);
  B.anchor('control_panel', 3950, 1400, 120);
  B.anchor('control_radio', 4300, 1410, 100);
  B.checkpoint('control', 3900, 1760);
  B.checkpoint('control', 4040, 1560);
  B.zspawn(3790, 1400, 60, 70, 0.6, 'control');
  B.zspawn(4300, 1720, 80, 80, 0.8, 'control');
  B.zspawn(3780, 1820, 60, 60, 0.6, 'control');
  void A;
}

// ---- 4. the crest -----------------------------------------------------------------------------------------

function buildCrest(B, A, plats) {
  const S = { section: 'crest' };
  const C = DAM.crest;
  const Z = DAM_Z;
  // the plateau of the crest (a little wider than the road: the parapets stand on it)
  landing(plats, C.x0, C.y0 - 20, C.x1, C.y1 + 20, Z, 1.5);
  // the stair shafts: the west one climbs north out of the control building's stair hall, the east one
  // comes down south to the turbine hall's side door; a landing joins each to the crest
  const ws = DAM.westStair, es = DAM.eastStair;
  landing(plats, ws.x0, C.y1, ws.x1, ws.y0, Z, 1.5);
  landing(plats, es.x0, C.y1, es.x1, es.y0, Z, 1.5);
  A.flights.push(stairFlight(plats, ws.x0, ws.y0, ws.x1, ws.y1, 'n', 0, Z));
  A.flights.push(stairFlight(plats, es.x0, es.y0, es.x1, es.y1, 'n', 0, Z));
  B.roof((ws.x0 + ws.x1) / 2, (C.y1 + ws.y1) / 2, ws.x1 - ws.x0 + 40, ws.y1 - C.y1, 0, { kind: 'plain', height: Z + 150, section: 'crest', dark: 0.9, style: 'shaft' });
  B.roof((es.x0 + es.x1) / 2, (C.y1 + es.y1) / 2, es.x1 - es.x0 + 40, es.y1 - C.y1, 0, { kind: 'plain', height: Z + 150, section: 'crest', dark: 0.9, style: 'shaft' });
  // the parapets: upstream (the reservoir, 50 below) and downstream (the drop), with the shaft doors
  wallLine(B, C.x0, C.y0 - 8, C.x1, C.y0 - 8, 16, [], { style: 'parapetN', ...S });
  wallLine(B, C.x0, C.y1 + 8, C.x1, C.y1 + 8, 16, [[ws.x0, ws.x1], [es.x0, es.x1]], { style: 'parapetS', ...S });
  wallBox(B, C.x0 - 40, C.y0 - 16, C.x0, C.y1 + 16, { style: 'nodraw', ...S });
  wallBox(B, C.x1, C.y0 - 16, C.x1 + 40, C.y1 + 16, { style: 'nodraw', ...S });
  // the east shaft's walls and the bottom landing with the turbine hall's side door
  wallLine(B, 7430, 900, 7430, 1900, 20, [[1760, 1880]], { style: 'shaft', ...S });
  wallLine(B, 7610, 900, 7610, 1900, 20, [], { style: 'shaft', ...S });
  wallLine(B, 7440, 1900, 7600, 1900, 20, [], { style: 'shaft', ...S });
  B.gate('turbine_door', 'shutter', 7430, 1820, 20, 120, 0, { section: 'crest', label: 'Turbine hall door', style: 'rollshutter' });
  // the spillway's gate piers: hoist houses on the upstream half over the four gate bays
  const sp = DAM.spill;
  for (let k = 0; k <= 4; k++) {
    const x = sp.x0 + (k * (sp.x1 - sp.x0)) / 4;
    B.ob('wall', x, C.y0 + 38, 70, 60, 0, { style: 'hoist', ...S });
  }
  // the gantry crane: its legs stand at the road's edges, the girder spans the crest (art)
  B.ob('wall', DAM.crane - 50, C.y0 + 22, 36, 30, 0, { style: 'craneleg', ...S });
  B.ob('wall', DAM.crane + 50, C.y0 + 22, 36, 30, 0, { style: 'craneleg', ...S });
  B.ob('wall', DAM.crane - 50, C.y1 - 22, 36, 30, 0, { style: 'craneleg', ...S });
  B.ob('wall', DAM.crane + 50, C.y1 - 22, 36, 30, 0, { style: 'craneleg', ...S });
  // cover along the road: a maintenance truck, a car, a failed army line, a fallen lamp, cable drums
  B.vehicle('truck', 4400, 830, 0.02, { color: '#c9a02a', jitter: 0 });
  B.vehicle('car', 5760, 760, -0.25, { wrecked: true });
  B.vehicle('van', 6900, 820, 0.12, { wrecked: true, burning: true });
  B.ob('sandbags', 6560, 760, 120, 26, 0.1);
  B.ob('sandbags', 6600, 860, 90, 26, -0.2);
  B.ob('barrier', 5300, 860, 110, 20, 0.15);
  B.ob('barrier', 7100, 740, 110, 20, -0.1);
  B.ob('container', 4900, 860, 64, 40, 0.1, { color: '#48544a', roof: '#3a4238', ...S });
  B.ob('rock', 6020, 870, 40, 30, 0.3);
  // lamps along both parapets (the art draws the posts)
  for (let x = C.x0 + 200; x < C.x1 - 100; x += 420) {
    B.light(x, C.y0 + 6, 320, '#ffcf8a', (x / 420) % 3 < 1 ? 0.2 : 0, Z + 118);
    B.light(x + 210, C.y1 - 6, 320, '#ffcf8a', 0, Z + 118);
  }
  B.light(DAM.crane, 800, 260, '#ff5a3a', 0.4, Z + 260);   // the crane's warning beacon
  // the shafts' lamps (absolute heights: halfway up and at the top)
  for (const s of [ws, es]) {
    B.light((s.x0 + s.x1) / 2, 1500, 200, '#ffb04a', 0.2, 170 + Z * 0.3);
    B.light((s.x0 + s.x1) / 2, 1150, 200, '#ffb04a', 0, Z * 0.8 + 150);
  }

  B.anchor('crest_mid', 5600, 800, 180);
  B.anchor('crest_crane', DAM.crane, 800, 140);
  B.checkpoint('crest', 3800, 800);
  B.checkpoint('crest', 4200, 780);
  B.checkpoint('crest', 5900, 820);
  B.zspawn(7300, 800, 160, 120, 1.2, 'crest');
  B.zspawn(6800, 760, 120, 60, 0.8, 'crest');
  B.zspawn(5700, 860, 120, 50, 0.8, 'crest');
  B.zspawn(7520, 1200, 120, 120, 1, 'crest');
}

// ---- 5. the turbine hall ---------------------------------------------------------------------------------------

function buildTurbines(B, A) {
  const S = { section: 'turbines' };
  const Hh = DAM.hall;
  // shell: the dam's toe to the north, the tailrace wall south with the big door, the west gable
  wallLine(B, Hh.x0, Hh.y0, Hh.x1, Hh.y0, 24, [], { style: 'hallwall', ...S });
  wallLine(B, Hh.x0, Hh.y1, Hh.x1 - 10, Hh.y1, 24, [[6130, 6450]], { style: 'hallwall', ...S });
  wallLine(B, Hh.x0, Hh.y0, Hh.x0, Hh.y1, 24, [], { style: 'hallwall', ...S });
  B.roof((Hh.x0 + Hh.x1) / 2, (Hh.y0 + Hh.y1) / 2, Hh.x1 - Hh.x0, Hh.y1 - Hh.y0, 0, { kind: 'industrial', height: 300, section: 'turbines', dark: 0.72, style: 'hall' });
  // four generators in a row on the machine floor, their exciter housings and a control desk
  for (let k = 0; k < 4; k++) B.ob('wall', 6180 + k * 360, 1470, 200, 200, 0, { style: 'generator', label: 'G' + (k + 1), ...S });
  B.ob('wall', 6000, 1720, 50, 140, 0, { style: 'breaker', ...S });
  B.ob('desk', 6330, 1700, 140, 40, 0, { style: 'ctrldesk', ...S });
  B.ob('cabinet', 7300, 1300, 120, 40, 0, { style: 'rack', ...S });
  B.ob('container', 7000, 1800, 110, 50, 0.05, { color: '#4a5a4a', ...S });
  B.ob('cabinet', 6700, 1850, 100, 30, 0, { style: 'lockers', ...S });
  // the tailrace yard: transformers behind a fence, service trucks, a crane truck; the old highway
  // from the fallen bridge; the River gate across it to the village
  for (let k = 0; k < 3; k++) B.ob('wall', 6700 + k * 180, 2120, 110, 90, 0, { style: 'transformer', ...S });
  wallLine(B, 6560, 2020, 7240, 2020, 6, [[6860, 6960]], { ...S, color: '#8a8f93' });
  wallLine(B, 6560, 2220, 7240, 2220, 6, [], { ...S, color: '#8a8f93' });
  wallLine(B, 7240, 2020, 7240, 2220, 6, [], { ...S, color: '#8a8f93' });
  wallLine(B, 6560, 2020, 6560, 2220, 6, [], { ...S, color: '#8a8f93' });
  B.vehicle('pickup', 6000, 2150, Math.PI / 2, { color: '#e8e2d0', jitter: 0 });
  B.vehicle('truck', 6800, 2450, 0.05, { color: '#c9a02a', jitter: 0, wrecked: true });
  B.vehicle('van', 7200, 2400, -0.3, { wrecked: true });
  B.vehicle('car', 6050, 2720, Math.PI - 0.2, { wrecked: true });
  B.ob('barrier', 5980, 2690, 110, 20, Math.PI / 2 + 0.2);
  A.marks.push({ t: 'bridgeout', x: 5900, y: 2740, a: Math.PI });
  // the yard's walls: the dam toe to the north is the hall; the east side is the village fence
  wallLine(B, 7430, 1900, 7430, 2960, 20, [[2640, 2840]], { style: 'yardwall', ...S });
  B.gate('river_gate', 'gate', 7430, 2740, 20, 200, 0, { section: 'turbines', label: 'River gate', style: 'yardgate' });

  // lights: the hall's high-bays and the yard floods
  for (let k = 0; k < 4; k++) B.light(6180 + k * 360, 1700, 360, '#ffcf96', k === 2 ? 0.25 : 0, 280);
  B.light(6000, 1720, 180, '#ff5040', 0.5, 120);
  for (const [x, y] of [[6100, 2000], [7300, 2300], [6600, 2600]]) {
    B.decor('lamp_post', x, y, 0, 1.25);
    B.light(x, y, 360, '#e8f0ff', 0);
  }

  B.anchor('turbine_breaker', 6060, 1720, 110);
  B.anchor('turbine_floor', 6720, 1740, 180);
  B.anchor('turbine_exit', 6290, 2020, 140);
  B.checkpoint('turbines', 7240, 1780);
  B.checkpoint('turbines', 6720, 1760);
  B.checkpoint('turbines', 6300, 2400);
  B.zspawn(5990, 1330, 110, 90, 1, 'turbines');
  B.zspawn(7150, 1690, 110, 60, 0.8, 'turbines');
  B.zspawn(6000, 2480, 140, 140, 1, 'turbines');
  B.zspawn(7300, 2600, 120, 140, 1.2, 'turbines');
}

// ---- 6. the riverside village -------------------------------------------------------------------------------------

function buildRiverside(B, A) {
  const S = { section: 'riverside' };
  const bld = (x, y, w, h, color, roof, arch, extra = {}) => {
    const o = B.ob('building', x, y, w, h, 0, { color, roof, section: 'riverside', ...extra });
    if (arch) o.arch = arch;
    return o;
  };
  // the main street's north row: shops, a diner, houses, the feed store at the east end
  bld(7700, 2400, 220, 150, '#9a8f7e', '#4f4a52', 'shops');
  bld(8040, 2410, 200, 140, '#7a6a55', '#3f4a52', 'shops');
  bld(8420, 2400, 240, 150, '#8c7b6a', '#5a3f35', 'shops');
  bld(9300, 2410, 200, 140, '#b8ad98', '#5b6770', 'house');
  bld(9660, 2400, 220, 150, '#8a6a44', '#3a4a4a', 'shops');
  bld(10060, 2410, 200, 140, '#9a917f', '#5a3f35', 'house');
  bld(10460, 2390, 240, 160, '#7f8a7a', '#4a3f33', 'industrial');
  // the back lane: houses up the slope, the church and its steeple between the lane and the street
  bld(7800, 1950, 160, 110, '#c4b89c', '#5a3f35', 'house');
  bld(8200, 1950, 150, 110, '#9aa3a8', '#4a3f33', 'house');
  bld(9520, 1950, 170, 110, '#b7b3aa', '#6e3b2f', 'house');
  bld(9900, 1950, 160, 110, '#8c7b5a', '#4a3f33', 'house');
  bld(10360, 1950, 170, 110, '#9a9c98', '#5a3f35', 'house');
  bld(8560, 2230, 260, 140, '#c9c2b2', '#4a4e52', 'church');
  bld(8390, 2230, 70, 70, '#c9c2b2', '#3a3e42', 'steeple', { top: 380 });
  // the gas station on the corner of the church lane
  B.ob('pump', 9050, 2560, 24, 46, 0, { color: '#b53a2e' });
  B.ob('pump', 9150, 2560, 24, 46, 0, { color: '#b53a2e' });
  // the riverbank: the dock with the boat
  wallLine(B, 8560, 2950, 8560, 3160, 14, [], { style: 'dockrail', ...S });
  wallLine(B, 8680, 2950, 8680, 3160, 14, [], { style: 'dockrail', ...S });
  A.marks.push({ t: 'dock', x: 8620, y: 3055, a: Math.PI / 2, w: 120, l: 210 });
  A.marks.push({ t: 'boat', x: 8740, y: 3080, a: Math.PI / 2 });
  // wrecks in the street, a school bus, a burning car, the barricade of a last stand at the depot
  B.vehicle('car', 7900, 2700, 0.1, { wrecked: true });
  B.vehicle('suv', 8350, 2780, Math.PI - 0.3, { wrecked: true, burning: true });
  B.vehicle('bus', 9300, 2710, 0.06, { color: '#d9a21b', jitter: 0, wrecked: true });
  B.vehicle('car', 9900, 2690, -0.2);
  B.vehicle('pickup', 10300, 2780, 0.3, { wrecked: true });
  B.vehicle('car', 8950, 2080, 0.05, { wrecked: true });
  B.ob('barrier', 10700, 2680, 110, 20, Math.PI / 2 + 0.2);
  B.ob('sandbags', 10820, 2810, 120, 26, Math.PI / 2);
  B.ob('sandbags', 10820, 2580, 90, 26, Math.PI / 2 - 0.2);
  // the depot's gate at the east end (the art draws it; the edge wall holds)
  A.marks.push({ t: 'depotgate', x: 11160, y: 2740, a: Math.PI });
  // trees on the slope behind the village and along the bank
  B.forest(8600, 1640, 1500, 150, 22, { spacing: 70 });
  B.forest(10400, 1660, 500, 140, 8, { spacing: 70 });
  for (const x of [7700, 7980, 9900, 10500]) B.tree(x, 2900, 1.1);
  // lights: street lamps, the church, the gas station, a fire at the barricade, the dock's lamp
  for (let x = 7700; x < 11000; x += 520) B.lamp(x, 2610, { color: '#ffcf8a', r: 280, deadChance: 0.3 });
  for (let x = 7900; x < 10800; x += 700) B.lamp(x, 2160, { color: '#ffcf8a', r: 240, deadChance: 0.4 });
  B.light(8560, 2330, 240, '#ffd9a0', 0.2, 120);
  B.fire(10760, 2740, 20);
  B.light(8620, 3100, 200, '#ffcf8a', 0.3, 60);

  B.anchor('river_boat', 8620, 3090, 110);
  B.anchor('depot_gate', 10980, 2740, 200);
  B.checkpoint('riverside', 7600, 2740);
  B.checkpoint('riverside', 7700, 2580);
  B.checkpoint('riverside', 9500, 2580);
  B.zspawn(8600, 2080, 140, 80, 1, 'riverside');
  B.zspawn(10700, 2080, 160, 100, 1.2, 'riverside');
  B.zspawn(9800, 2890, 160, 60, 1, 'riverside');
  B.zspawn(10600, 2560, 100, 80, 1, 'riverside');
  B.zspawn(7700, 2100, 100, 80, 0.8, 'riverside');
}

// ---- the canyon walls -----------------------------------------------------------------------------------------------

function buildCanyon(B, A) {
  // north wall of the canyon road (the rock above the spillway yard to its east)
  cliffLine(B, [[380, 3240], [380, 3060], [1200, 3040], [1560, 3000], [2300, 2760], [3200, 2680], [3200, 1900]], 900, -1, { section: 'road' });
  // south wall of the canyon road down to the river
  cliffLine(B, [[380, 3480], [380, 3700], [1500, 3720], [2600, 3380], [3700, 3300], [4200, 3200], [4700, 3120]], 820, 1, { section: 'road' });
  // the spillway yard's west cliff up to the control building and the west abutment
  cliffLine(B, [[3200, 1900], [3300, 1300], [3500, 1300]], 1000, -1, { wall: false });
  // the west abutment above the crest's end and the reservoir's west shore
  cliffLine(B, [[3500, 1300], [3480, 900], [3500, 660], [3300, 300], [2600, -300]], 1150, -1, { wall: false });
  // the east abutment, the hill behind the village, the south bank
  cliffLine(B, [[8400, -300], [7700, 400], [7640, 660], [7640, 1000]], 1150, -1, { wall: false });
  cliffLine(B, [[7610, 1250], [8100, 1380], [9400, 1450], [10300, 1400], [11300, 1500]], 700, -1, { wall: false });
  cliffLine(B, [[4600, 3760], [7000, 3800], [9000, 3760], [11300, 3780]], 760, 1, { wall: false });
  // the village's back fence up the slope (below the rock)
  wallLine(B, 7620, 1880, 11160, 1880, 20, [], { style: 'nodraw', section: 'riverside' });
}
