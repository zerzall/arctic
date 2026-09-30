// Fort Harlan Airfield — story level (JOURNEY.md). Owner: agent C3.
//
// SPEC is the contract other parts depend on (the mission scripts, the engine, the tests): keep every
// section id (in this order), anchor name and gate id. Change the layout, the size, add sections,
// anchors, gates and props freely.
//
// Sgt. Okafor's unit fell back to the airbase. The field runs west to east across a 12000 × 4000 plain,
// four fence lines splitting it into five strips:
//
//   Perimeter      the county road out of the pines, an abandoned outer checkpoint (HESCO chicane, a
//                  guard tower, a burnt convoy), the perimeter fence with razor wire and searchlights, the
//                  guardhouse at the main gate.
//   Barracks       Main Street inside the gate: Barracks B (a corridor of bunk rooms, the latrine, the day
//                  room), the armory with its issue cage, the dining facility (serving line, kitchen), the
//                  parade ground turned quarantine screening point, the motor pool; the flight line fence.
//   Hangar Row     the apron under floodlights, three hangars (a Black Hawk in maintenance, the cargo
//                  plane, a field morgue), the fuel depot in its bund, a crashed helicopter burning.
//   Control Tower  through the tower's door: the lobby, the stair up to the radio room (terrain 120 up),
//                  the tower compound with the crash-rescue station and the runway gate.
//   Runway 27      the runway under its edge lights, the flare path for the supply drop, the far end.
//
// Every gate and roof stays on the ground; only the tower's radio room and its stair stand on terrain
// (shared/terrain.js plateaus). The level art (render3d/levels/airbase.js) reads BASE and map.levelArt.

import { wallBox, wallLine, stairFlight, landing, artData, spawnRows, supplyCrate } from './dam.js';

export const SPEC = Object.freeze({
  "id": "airbase",
  "name": "Fort Harlan Airfield",
  "chapter": 4,
  "time": "night",
  "owner": "C3",
  "description": "Rain on an abandoned airbase: the perimeter fence and its searchlights, the barracks, the hangars and a cargo plane, the control tower radio and the runway lights.",
  "sections": [
    {
      "id": "perimeter",
      "name": "Perimeter"
    },
    {
      "id": "barracks",
      "name": "Barracks"
    },
    {
      "id": "hangars",
      "name": "Hangar Row"
    },
    {
      "id": "tower",
      "name": "Control Tower"
    },
    {
      "id": "runway",
      "name": "Runway 27"
    }
  ],
  "anchors": {
    "perimeter": [
      "start",
      "perimeter_gate",
      "guard_post"
    ],
    "barracks": [
      "barracks_armory",
      "barracks_mess",
      "barracks_yard"
    ],
    "hangars": [
      "hangar_doors",
      "hangar_plane",
      "fuel_depot"
    ],
    "tower": [
      "tower_radio",
      "tower_stairs"
    ],
    "runway": [
      "runway_flares",
      "runway_end"
    ]
  },
  "gates": [
    {
      "id": "base_gate",
      "kind": "gate",
      "from": "perimeter",
      "to": "barracks",
      "label": "Main gate"
    },
    {
      "id": "hangar_fence",
      "kind": "fence",
      "from": "barracks",
      "to": "hangars",
      "label": "Flight line fence"
    },
    {
      "id": "tower_door",
      "kind": "door",
      "from": "hangars",
      "to": "tower",
      "label": "Tower door"
    },
    {
      "id": "runway_gate",
      "kind": "gate",
      "from": "tower",
      "to": "runway",
      "label": "Runway gate"
    }
  ]
});

/** World size and mood (maps.js MAP_DEFS). */
export const DEF = { width: 12000, height: 4000, darkness: 0.62, tint: '#3a4a60', ground: '#3f4a33' };

/** Key coordinates the art reads too (world units). */
export const BASE = Object.freeze({
  road: { y0: 1900, y1: 2100 },                 // the county road and Main Street
  fence: 2400,                                  // the perimeter fence (x), the main gate in the road
  inner: 5000,                                  // the flight line fence (x)
  towerX: 8400,                                 // the tower's fence line (x): the tower stands in it
  runwayX: 9200,                                // the runway fence (x)
  guard: { x0: 2230, x1: 2370, y0: 1740, y1: 1860, door: [2270, 2350] },
  barracks: { x0: 2700, x1: 3500, y0: 1150, y1: 1600, hall: [1340, 1420], door: [3060, 3140], north: [2900, 3100, 3300], south: [3000, 3200] },
  armory: { x0: 3700, x1: 4100, y0: 1300, y1: 1650, door: [3860, 3940], cage: 1470, hatch: [3960, 4040] },
  mess: { x0: 4250, x1: 4850, y0: 1150, y1: 1650, door: [4500, 4600], line: 1330, side: [1500, 1580] },
  yard: { x0: 2700, x1: 4300, y0: 2250, y1: 3000 },
  motor: { x0: 4350, x1: 4900, y0: 2300, y1: 2800 },
  hangars: [
    { n: 1, x0: 5200, x1: 5800, y0: 650, y1: 1450, door: [5380, 5620], h: 300 },
    { n: 2, x0: 6000, x1: 7100, y0: 450, y1: 1450, door: [6300, 6800], h: 380 },
    { n: 3, x0: 7300, x1: 7900, y0: 650, y1: 1450, door: [7480, 7720], h: 300 },
  ],
  plane: { x: 6550, y0: 540, y1: 1330, span: 900, wingY: 900 },  // nose north, the ramp down at the door
  apron: { x0: 5000, x1: 8400, y0: 1450, y1: 2700 },
  fuel: { x0: 5300, x1: 6300, y0: 2850, y1: 3350, gap: [5720, 5880] },
  tower: { x0: 8400, x1: 8840, y0: 1400, y1: 1760, floor: 120, door: [1560, 1660], exit: [8440, 8540], stair: { x0: 8480, x1: 8620, y0: 1410, y1: 1510 } },
  fire: { x0: 8700, x1: 9100, y0: 2400, y1: 2760 },
  taxi: { y0: 2000, y1: 2200 },
  runway: { x0: 9400, x1: 12000, y0: 2500, y1: 3100, flares: 10400 },
});

/**
 * Lay the level out.
 * @param {object} B map builder (maps.js createBuilder) with the level calls of JOURNEY.md §3
 */
export function build(B) {
  const { W, H } = B;
  const plats = [];
  B.map.terrain = { hills: [], plateaus: plats };
  // by night rain from a low sky, the searchlights and floodlights; by day a grey, wet morning after it
  B.map.look = {
    day: {
      az: 235, el: 26, haze: '#a3abb0', horizon: '#b4bbc0', zenith: '#56657a', fog: 0.0002, cover: 0.82,
      sunColor: '#f2e8d6', sunI: 2.8, hemiSky: '#aebac8', hemiGround: '#55584a', hemi: 1.0, exposure: 1.02,
      heat: 0, ridge: '#56605e', wet: 0.7, mist: 0.9,
      grade: { saturation: 0.9, contrast: 1.08, gain: [1.0, 1.0, 1.02], vignette: 0.24 },
    },
    night: {
      fog: '#0a0e14', horizon: '#18202c', zenith: '#03050a', sky: '#56657a', ground: '#2a2c26', moon: '#8ea4c4',
      fogDensity: 0.00112, hemi: 0.95, moonI: 0.36,
    },
    trees: ['pine', 'pine', 'spruce', 'oak'],
    deciduous: 0.25,
  };
  const A = artData(B);
  A.lights = [];   // runway edge lights etc. (art only: emissive studs with halos)

  // ---- sections (travel order) and the ground
  B.section('perimeter', 'Perimeter', 1200, 2000, 2400, 4000);
  B.section('barracks', 'Barracks', 3700, 2000, 2600, 4000);
  B.section('hangars', 'Hangar Row', 6700, 2000, 3400, 4000);
  B.section('tower', 'Control Tower', 8800, 2000, 800, 4000);
  B.section('runway', 'Runway 27', 10600, 2000, 2800, 4000);

  B.box('grass', 0, 0, W, H);
  B.box('dirt', 0, 1850, BASE.fence, 2150);
  B.box('asphalt', 0, BASE.road.y0, BASE.inner, BASE.road.y1);
  B.box('gravel', 1150, 1650, 1750, 2350);                       // the outer checkpoint's pad
  B.box('concrete', BASE.fence, 1660, BASE.inner, 1900);           // the sidewalk along Main Street
  B.box('asphalt', 2700, 2250, 4300, 3000);                        // the parade ground
  B.box('asphalt', 3000, 2100, 3300, 2250);                        // its way in from the street
  B.box('gravel', 4300, 2250, 4950, 2850);                         // the motor pool
  B.box('concrete', BASE.apron.x0, BASE.apron.y0, BASE.apron.x1, BASE.apron.y1);
  for (const h of BASE.hangars) B.box('concrete', h.x0, h.y0, h.x1, h.y1);
  B.box('gravel', 5200, 2750, 6400, 3450);                         // the fuel depot
  B.box('asphalt', 8400, BASE.taxi.y0, 9700, BASE.taxi.y1);        // taxiway A past the tower
  B.box('asphalt', 9500, BASE.taxi.y1, 9700, BASE.runway.y0);
  B.box('asphalt', BASE.runway.x0, BASE.runway.y0, W, BASE.runway.y1);
  B.box('concrete', 8400, 1400, 8840, 1760);                       // the tower
  B.box('concrete', 8600, 2300, 9150, 2800);                       // the crash-rescue station's pad
  for (const b of [BASE.guard, BASE.barracks, BASE.armory, BASE.mess]) B.box('concrete', b.x0, b.y0, b.x1, b.y1);

  buildPerimeter(B, A);
  buildBarracks(B, A);
  buildHangars(B, A);
  buildTower(B, A, plats);
  buildRunway(B, A);

  // the world's edges
  wallBox(B, 0, 0, 40, H, { style: 'nodraw' });
  wallBox(B, W - 40, 0, W, H, { style: 'nodraw' });
  wallBox(B, 0, 0, W, 40, { style: 'nodraw' });
  wallBox(B, 0, H - 40, W, H, { style: 'nodraw' });
  B.groundClutter({ cracks: 90, oil: 40, paper: 60, debris: 50, blood: 36, tires: 6, tufts: 700, bushes: 120, rocks: 40 });
}

/** A fence line across the whole field at x, with gaps [[y0, y1], ...] (the chain-link and razor wire). */
function fenceLine(B, x, gaps, section, style = 'perimfence') {
  return wallLine(B, x, 0, x, 4000, 12, gaps, { style, section });
}

/** A tall floodlight / searchlight tower on four legs (art: style), and its light. */
function lightTower(B, x, y, section, o = {}) {
  B.ob('pillar', x, y, 44, 44, 0, { style: o.style || 'lighttower', label: o.label, section });
  if (o.light !== false) B.light(x, y, o.r || 600, o.color || '#e4f0ff', 0, o.h || 380);
}

// ---- 1. the perimeter ------------------------------------------------------------------------------------------

function buildPerimeter(B, A) {
  const S = { section: 'perimeter' };
  const R = BASE.road, G = BASE.guard;
  // the pines either side of the county road
  B.forest(900, 850, 900, 650, 150);
  B.forest(900, 3150, 900, 650, 150);
  B.forest(1950, 700, 350, 500, 40);
  B.forest(1950, 3300, 350, 500, 40);
  // the outer checkpoint: HESCO walls funnel the road into a chicane of jersey barriers, a guard tower,
  // sandbag positions, the burnt convoy that did not get in
  for (const [y0, y1] of [[1460, 1830], [2170, 2540]]) {
    for (let y = y0; y < y1; y += 60) B.ob('hesco', 1400, y + 30, 60, 60, 0, S);
  }
  B.ob('barrier', 1250, 1955, 110, 20, 0.12);
  B.ob('barrier', 1420, 2050, 110, 20, -0.1);
  B.ob('barrier', 1600, 1950, 110, 20, 0.05);
  B.ob('barrier', 1520, 2120, 90, 20, 1.2);
  B.ob('sandbags', 1520, 1780, 130, 28, 0.1);
  B.ob('sandbags', 1560, 2240, 130, 28, -0.15);
  B.ob('sandbags', 1470, 1735, 28, 90, 0);
  lightTower(B, 1490, 1660, 'perimeter', { style: 'guardtower', color: '#e4f0ff', r: 420, h: 300 });
  B.ob('suv', 700, 2030, 104, 52, 0.12, { color: '#3a3c2a', style: 'humvee', wrecked: true, section: 'perimeter' });
  B.vehicle('truck', 960, 1960, -0.18, { color: '#4b5320', wrecked: true, burning: true });
  B.ob('suv', 1880, 2060, 104, 52, -0.35, { color: '#4b5320', style: 'humvee', section: 'perimeter' });
  B.vehicle('pickup', 520, 1830, 0.6, { wrecked: true });
  B.fire(1180, 1840, 18);
  // signs along the road
  B.ob('wall', 1000, 1830, 10, 10, 0, { style: 'signrestricted', ...S });
  B.ob('wall', 2150, 1830, 10, 10, 0, { style: 'signbase', ...S });

  // the perimeter fence and the main gate; searchlight towers either side of the gate
  fenceLine(B, BASE.fence, [[R.y0, R.y1]], 'perimeter');
  B.gate('base_gate', 'gate', BASE.fence, (R.y0 + R.y1) / 2, 12, R.y1 - R.y0, 0, { section: 'perimeter', label: 'Main gate', style: 'basegate' });
  lightTower(B, 2330, 1560, 'perimeter', { style: 'searchtower', label: '0', color: '#e8f0ff', r: 460, h: 320 });
  lightTower(B, 2330, 2460, 'perimeter', { style: 'searchtower', label: '1', color: '#e8f0ff', r: 460, h: 320 });
  // the guardhouse outside the gate: a door on the road, the gate console inside
  wallLine(B, G.x0, G.y0, G.x1, G.y0, 12, [], { style: 'guardwall', ...S });
  wallLine(B, G.x0, G.y0, G.x0, G.y1, 12, [], { style: 'guardwall', ...S });
  wallLine(B, G.x1, G.y0, G.x1, G.y1, 12, [], { style: 'guardwall', ...S });
  wallLine(B, G.x0, G.y1, G.x1, G.y1, 12, [G.door], { style: 'guardwall', ...S });
  B.ob('desk', (G.x0 + G.x1) / 2, G.y0 + 26, 100, 28, 0, { style: 'gateconsole', ...S });
  B.roof((G.x0 + G.x1) / 2, (G.y0 + G.y1) / 2, G.x1 - G.x0 + 20, G.y1 - G.y0 + 20, 0, { kind: 'plain', height: 120, section: 'perimeter', dark: 0.8, style: 'guardroom' });
  B.light((G.x0 + G.x1) / 2, (G.y0 + G.y1) / 2, 170, '#ffd9a0', 0.25, 110);
  // the wreck of a Black Hawk in the trees outside the wire, still burning
  B.ob('wall', 1960, 1250, 190, 70, 0.5, { style: 'helowreck', ...S });
  B.ob('wall', 2110, 1170, 120, 14, 0.9, { style: 'nodraw', ...S });
  B.fire(1990, 1270, 26);
  B.fire(1900, 1210, 14);

  B.anchor('start', 300, 2000, 180);
  B.anchor('perimeter_gate', 2320, 2000, 110);
  B.anchor('guard_post', (G.x0 + G.x1) / 2, G.y0 + 70, 50);
  spawnRows(B, 220, 2000);
  B.supply(420, 2180);
  B.checkpoint('perimeter', 300, 1880);
  B.checkpoint('perimeter', 300, 2120);
  B.checkpoint('perimeter', 1750, 2000);
  B.zspawn(2150, 900, 160, 200, 1.2, 'perimeter');
  B.zspawn(2150, 3100, 160, 200, 1.2, 'perimeter');
  B.zspawn(1700, 1450, 160, 90, 1, 'perimeter');
  B.zspawn(1700, 2600, 160, 90, 1, 'perimeter');
  B.zspawn(2250, 1650, 80, 60, 0.7, 'perimeter');
}

// ---- 2. the barracks --------------------------------------------------------------------------------------------

function buildBarracks(B, A) {
  const S = { section: 'barracks' };
  const R = BASE.road;
  // Barracks B: a corridor through the block (doors at both ends), bunk rooms to the north, the latrine,
  // the entry hall and the day room to the south
  const K = BASE.barracks, hy0 = K.hall[0], hy1 = K.hall[1];
  wallLine(B, K.x0, K.y0, K.x1, K.y0, 16, [], { style: 'bwall', ...S });
  wallLine(B, K.x0, K.y1, K.x1, K.y1, 16, [K.door], { style: 'bwall', ...S });
  wallLine(B, K.x0, K.y0, K.x0, K.y1, 16, [[hy0, hy1]], { style: 'bwall', ...S });
  wallLine(B, K.x1, K.y0, K.x1, K.y1, 16, [[hy0, hy1]], { style: 'bwall', ...S });
  const nDoors = [[2760, 2840], [2960, 3040], [3160, 3240], [3360, 3440]];
  wallLine(B, K.x0, hy0, K.x1, hy0, 10, nDoors, { style: 'bpart', ...S });
  for (const x of K.north) wallLine(B, x, K.y0, x, hy0, 10, [], { style: 'bpart', ...S });
  wallLine(B, K.x0, hy1, K.south[0], hy1, 10, [[2800, 2880]], { style: 'bpart', ...S });
  wallLine(B, K.south[1], hy1, K.x1, hy1, 10, [[3320, 3400]], { style: 'bpart', ...S });
  for (const x of K.south) wallLine(B, x, hy1, x, K.y1, 10, [], { style: 'bpart', ...S });
  // bunks and lockers in the four rooms, the latrine's sinks, the day room's couch and TV
  for (let k = 0; k < 4; k++) {
    const x0 = K.x0 + k * 200;
    B.ob('desk', x0 + 50, K.y0 + 60, 36, 84, 0, { style: 'bunk', ...S });
    B.ob('desk', x0 + 150, K.y0 + 60, 36, 84, 0, { style: 'bunk', label: k === 2 ? 'blood' : undefined, ...S });
    B.ob('cabinet', x0 + 100, K.y0 + 24, 60, 24, 0, { style: 'lockers', ...S });
  }
  B.ob('counter', 2850, 1560, 200, 30, 0, { style: 'sinks', ...S });
  B.ob('wall', 2740, 1500, 40, 110, 0, { style: 'stalls', ...S });
  B.ob('desk', 3350, 1520, 110, 36, 0, { style: 'couch', ...S });
  B.ob('cabinet', 3460, 1470, 24, 60, 0, { style: 'tvstand', ...S });
  B.roof((K.x0 + K.x1) / 2, (K.y0 + K.y1) / 2, K.x1 - K.x0, K.y1 - K.y0, 0, { kind: 'office', height: 140, section: 'barracks', dark: 0.8, style: 'barracks' });
  for (let k = 0; k < 4; k++) B.light(K.x0 + 100 + k * 200, K.y0 + 90, 150, '#fff0d8', k === 1 ? 0.4 : 0.1, 130);
  B.light(3100, 1380, 180, '#e8f0ff', 0.3, 130);
  B.light(3100, 1510, 150, '#ffd9a0', 0, 130);

  // the armory: concrete, one door; the issue cage across the room, racks behind it
  const M = BASE.armory;
  wallLine(B, M.x0, M.y0, M.x1, M.y0, 24, [], { style: 'armwall', ...S });
  wallLine(B, M.x0, M.y1, M.x1, M.y1, 24, [M.door], { style: 'armwall', ...S });
  wallLine(B, M.x0, M.y0, M.x0, M.y1, 24, [], { style: 'armwall', ...S });
  wallLine(B, M.x1, M.y0, M.x1, M.y1, 24, [], { style: 'armwall', ...S });
  wallLine(B, M.x0, M.cage, M.x1, M.cage, 10, [M.hatch], { style: 'cage', ...S });
  B.ob('counter', (M.x0 + 3920) / 2, M.cage + 22, 3920 - M.x0 - 30, 26, 0, { style: 'issuecounter', ...S });
  for (const x of [3760, 3880, 4000]) B.ob('cabinet', x, M.y0 + 30, 90, 26, 0, { style: 'gunrack', ...S });
  B.ob('cabinet', M.x0 + 26, 1400, 24, 110, 0, { style: 'gunrack', ...S });
  supplyCrate(B, 3770, 1590, 0.15, 'barracks');
  B.roof((M.x0 + M.x1) / 2, (M.y0 + M.y1) / 2, M.x1 - M.x0, M.y1 - M.y0, 0, { kind: 'plain', height: 130, section: 'barracks', dark: 0.85, style: 'armory' });
  B.light(3900, 1560, 180, '#ff4a3a', 0.2, 120);
  B.light(3900, 1380, 150, '#fff0d8', 0.3, 120);

  // the dining facility: the doors on the street, long tables, the serving line, the kitchen behind it
  const D = BASE.mess;
  wallLine(B, D.x0, D.y0, D.x1, D.y0, 16, [], { style: 'messwall', ...S });
  wallLine(B, D.x0, D.y1, D.x1, D.y1, 16, [D.door], { style: 'messwall', ...S });
  wallLine(B, D.x0, D.y0, D.x0, D.y1, 16, [], { style: 'messwall', ...S });
  wallLine(B, D.x1, D.y0, D.x1, D.y1, 16, [D.side], { style: 'messwall', ...S });
  B.ob('counter', (D.x0 + D.x1) / 2, D.line, D.x1 - D.x0 - 120, 30, 0, { style: 'servingline', ...S });
  for (const x of [4370, 4730]) for (const y of [1420, 1500, 1580]) B.ob('desk', x, y, 170, 34, 0, { style: 'messtable', ...S });
  B.ob('counter', 4550, D.y0 + 30, 400, 34, 0, { style: 'stoves', ...S });
  B.ob('cabinet', D.x0 + 30, D.y0 + 60, 36, 70, 0, { style: 'fridge', ...S });
  B.roof((D.x0 + D.x1) / 2, (D.y0 + D.y1) / 2, D.x1 - D.x0, D.y1 - D.y0, 0, { kind: 'office', height: 150, section: 'barracks', dark: 0.8, style: 'mess' });
  for (const x of [4370, 4730]) B.light(x, 1500, 200, '#fff4e0', x === 4730 ? 0.35 : 0.05, 140);
  B.light(4550, 1240, 160, '#e8f0ff', 0.2, 140);

  // the parade ground: the flagpole, the screening tents of the quarantine, HESCO, trucks, pallets
  const Y = BASE.yard;
  B.ob('pillar', 3500, 2290, 14, 14, 0, { style: 'flagpole', ...S });
  B.ob('tent', 2880, 2460, 220, 130, 0, { style: 'medtent', color: '#5a6340', roof: '#6b7449', ...S });
  B.ob('tent', 2880, 2760, 220, 130, 0, { style: 'medtent', color: '#5a6340', roof: '#6b7449', ...S });
  B.ob('tent', 3210, 2800, 200, 120, 0.05, { style: 'medtent', color: '#5a6340', roof: '#6b7449', label: 'red', ...S });
  for (let y = 2340; y < 2920; y += 60) B.ob('hesco', 2730, y + 30, 60, 60, 0, S);
  B.ob('wall', 3100, 2330, 20, 20, 0, { style: 'signquarantine', ...S });
  B.ob('booth', 3350, 2480, 60, 60, 0.02, { style: 'screenbooth', ...S });
  B.vehicle('truck', 3900, 2470, 0.3, { color: '#4b5320' });
  B.vehicle('truck', 4000, 2800, -0.12, { color: '#556b2f', wrecked: true });
  B.ob('wall', 3650, 2900, 90, 90, 0.1, { style: 'pallets', ...S });
  B.ob('wall', 3780, 2920, 90, 90, -0.2, { style: 'pallets', ...S });
  B.ob('sandbags', 3700, 2290, 140, 28, 0);
  B.ob('sandbags', 4200, 2600, 28, 140, 0);
  lightTower(B, 3500, 2960, 'barracks', { r: 640 });
  // the motor pool: an open shelter over trucks and Humvees
  const P = BASE.motor;
  for (const x of [P.x0, (P.x0 + P.x1) / 2, P.x1]) for (const y of [P.y0, P.y1]) B.ob('pillar', x, y, 16, 16, 0, { style: 'shelterpost', ...S });
  B.roof((P.x0 + P.x1) / 2, (P.y0 + P.y1) / 2, P.x1 - P.x0 + 40, P.y1 - P.y0 + 40, 0, { kind: 'industrial', height: 170, section: 'barracks', dark: 0.4, style: 'shelter' });
  B.ob('suv', 4480, 2430, 104, 52, Math.PI / 2, { color: '#4b5320', style: 'humvee', ...S });
  B.ob('suv', 4620, 2440, 104, 52, Math.PI / 2 + 0.05, { color: '#556b2f', style: 'humvee', ...S });
  B.vehicle('truck', 4800, 2620, Math.PI / 2, { color: '#4a4f35' });
  B.ob('wall', 4500, 2730, 60, 40, 0, { style: 'drums', ...S });
  B.light(4620, 2550, 260, '#ffc070', 0.1, 160);
  // Main Street: lamps, a bus shelter, the base sign, parked and crashed vehicles
  for (const x of [2600, 3150, 3700, 4250, 4800]) B.lamp(x, 1870, { dead: x === 3700 });
  for (const x of [2900, 3950]) B.lamp(x, 2130, { a: Math.PI, dead: x === 3950 });
  B.vehicle('pickup', 3350, 1985, 0.05, { color: '#3a3c2a', wrecked: true });
  B.ob('suv', 4350, 2040, 104, 52, 2.9, { color: '#4b5320', style: 'humvee', wrecked: true, section: 'barracks' });
  B.fire(4330, 2030, 14);
  B.ob('barrier', 2700, 2000, 100, 20, 1.45);
  // the flight line fence and its gate
  fenceLine(B, BASE.inner, [[R.y0, R.y1]], 'barracks');
  B.gate('hangar_fence', 'fence', BASE.inner, (R.y0 + R.y1) / 2, 12, R.y1 - R.y0, 0, { section: 'barracks', label: 'Flight line fence', style: 'flightfence' });
  B.ob('booth', 4880, 1800, 70, 70, 0, { style: 'flightbooth', ...S });

  B.anchor('barracks_armory', 3900, 1540, 70);
  B.anchor('barracks_mess', 4550, 1385, 90);
  B.anchor('barracks_yard', 3560, 2620, 160);
  B.checkpoint('barracks', 2560, 1960);
  B.checkpoint('barracks', 2560, 2140);
  B.checkpoint('barracks', 3600, 2150);
  B.checkpoint('barracks', 4650, 1990);
  B.zspawn(3600, 1000, 300, 120, 1, 'barracks');
  B.zspawn(4600, 1000, 300, 120, 1, 'barracks');
  B.zspawn(4800, 3200, 200, 150, 1.2, 'barracks');
  B.zspawn(2700, 3300, 300, 150, 1, 'barracks');
  B.zspawn(4850, 2150, 80, 80, 0.8, 'barracks');
}

// ---- 3. the hangars ---------------------------------------------------------------------------------------------

function buildHangars(B, A) {
  const S = { section: 'hangars' };
  // the three hangars: steel walls, the sliding doors part open on the apron
  for (const h of BASE.hangars) {
    wallLine(B, h.x0, h.y0, h.x1, h.y0, 24, [], { style: 'hwall', ...S });
    wallLine(B, h.x0, h.y0, h.x0, h.y1, 24, [], { style: 'hwall', ...S });
    wallLine(B, h.x1, h.y0, h.x1, h.y1, 24, [], { style: 'hwall', ...S });
    wallLine(B, h.x0, h.y1, h.x1, h.y1, 24, [h.door], { style: 'hdoor', label: String(h.n), ...S });
    B.roof((h.x0 + h.x1) / 2, (h.y0 + h.y1) / 2, h.x1 - h.x0, h.y1 - h.y0, 0, { kind: 'industrial', height: h.h, section: 'hangars', dark: 0.72, style: 'hangar' });
    for (let x = h.x0 + 150; x < h.x1 - 100; x += 300) B.light(x, (h.y0 + h.y1) / 2, 380, '#ffd6a0', 0, h.h - 30);
  }
  const [H1, H2, H3] = BASE.hangars;
  // hangar 1: a Black Hawk in maintenance, work stands, shelving, benches
  B.ob('wall', 5480, 1000, 200, 64, 0.08, { style: 'uh60', ...S });
  B.ob('wall', 5650, 1015, 150, 14, 0.08, { style: 'nodraw', ...S });
  for (const x of [5300, 5420, 5540, 5660]) B.ob('cabinet', x, H1.y0 + 30, 100, 30, 0, { style: 'shelving', ...S });
  B.ob('counter', H1.x0 + 30, 1100, 30, 160, 0, { style: 'bench', ...S });
  B.ob('counter', H1.x1 - 30, 900, 30, 160, 0, { style: 'bench', ...S });
  B.ob('desk', 5330, 1300, 60, 40, 0.3, { style: 'toolcart', ...S });
  // hangar 2: the cargo plane, nose in, the ramp down at the door; pallets and a K-loader beside it
  const PL = BASE.plane;
  // (local x along the fuselage, nose to tail: the frame faces south)
  B.ob('wall', PL.x, (PL.y0 + PL.y1) / 2, PL.y1 - PL.y0, 92, Math.PI / 2, { style: 'c27', ...S });
  B.ob('wall', PL.x, 1000, 150, 180, 0, { style: 'nodraw', ...S });
  B.ob('wall', 6200, 700, 140, 90, 0, { style: 'pallets', ...S });
  B.ob('wall', 6900, 700, 140, 90, 0, { style: 'pallets', ...S });
  B.ob('wall', 6880, 1250, 90, 180, 0, { style: 'kloader', ...S });
  B.ob('cabinet', 6060, 1000, 30, 200, 0, { style: 'shelving', ...S });
  // hangar 3: the field morgue: cots in rows, a triage tent, a reefer trailer at the back
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) B.ob('desk', 7400 + c * 110, 900 + r * 130, 44, 90, 0, { style: 'cot', label: (r + c) % 3 === 0 ? 'bag' : undefined, ...S });
  B.ob('tent', 7780, 950, 160, 150, Math.PI / 2, { style: 'medtent', color: '#c8c4b8', roof: '#d8d4c8', label: 'white', ...S });
  B.ob('bus', 7600, H3.y0 + 70, 250, 60, 0, { style: 'reefer', color: '#d8d8d4', ...S });
  // the apron: floodlight towers, the crashed Black Hawk burning, a refueler, tugs, pallets, HESCO
  for (const x of [5500, 6600, 7700]) lightTower(B, x, 2300, 'hangars', { r: 760, h: 420 });
  B.ob('wall', 7550, 2050, 200, 70, 2.5, { style: 'helowreck', ...S });
  B.ob('wall', 7400, 2160, 130, 14, 2.1, { style: 'nodraw', ...S });
  B.fire(7560, 2040, 28);
  B.fire(7480, 2110, 16);
  B.ob('truck', 5700, 2500, 170, 60, 0.05, { color: '#c8c2a8', style: 'refueler', ...S });
  B.ob('wall', 6300, 1650, 60, 40, 0.3, { style: 'tug', ...S });
  B.ob('wall', 7050, 1700, 140, 90, 0.1, { style: 'pallets', ...S });
  B.ob('sandbags', 6100, 2150, 140, 28, 0.05);
  B.ob('sandbags', 6960, 2350, 140, 28, -0.1);
  for (const x of [5900, 7150]) for (let k = 0; k < 4; k++) B.ob('hesco', x, 1560 + k * 60, 60, 60, 0, S);
  B.ob('suv', 6450, 2450, 104, 52, 0.3, { color: '#4b5320', style: 'humvee', ...S });
  B.vehicle('truck', 8100, 1700, 1.4, { color: '#4b5320', wrecked: true });
  // the fuel depot: tanks inside a low bund, the pump stand at its opening
  const F = BASE.fuel;
  wallLine(B, F.x0, F.y0, F.x1, F.y0, 20, [F.gap], { style: 'bund', ...S });
  wallLine(B, F.x0, F.y1, F.x1, F.y1, 20, [], { style: 'bund', ...S });
  wallLine(B, F.x0, F.y0, F.x0, F.y1, 20, [], { style: 'bund', ...S });
  wallLine(B, F.x1, F.y0, F.x1, F.y1, 20, [], { style: 'bund', ...S });
  for (const [x, y] of [[5500, 3130], [6100, 3130]]) B.ob('silo', x, y, 230, 230, 0, { style: 'fueltank', ...S });
  B.ob('wall', 5800, 3230, 80, 80, 0, { style: 'pumphouse', ...S });
  B.ob('wall', 5640, 2800, 50, 36, 0, { style: 'fuelpump', ...S });
  B.ob('wall', 5960, 2800, 50, 36, 0, { style: 'fuelpump', ...S });
  B.light(5800, 2800, 300, '#ffd9a0', 0, 220);
  supplyCrate(B, 6420, 1560, 0.1, 'hangars');
  // the fence of the tower's compound: the tower stands in it; taxiway A is shut behind a wreck
  wallLine(B, BASE.towerX, 0, BASE.towerX, BASE.tower.y0, 12, [], { style: 'perimfence', ...S });
  wallLine(B, BASE.towerX, BASE.tower.y1, BASE.towerX, BASE.taxi.y0, 12, [], { style: 'perimfence', ...S });
  wallBox(B, BASE.towerX - 6, BASE.taxi.y0, BASE.towerX + 6, BASE.taxi.y1, { style: 'taxigate', ...S });
  wallLine(B, BASE.towerX, BASE.taxi.y1, BASE.towerX, 4000, 12, [], { style: 'perimfence', ...S });
  B.ob('tanker', BASE.towerX - 150, 2100, 230, 60, 1.35, { style: 'refueler', color: '#8a8672', wrecked: true, ...S });
  B.fire(BASE.towerX - 160, 2150, 16);

  B.anchor('hangar_doors', H2.door[0] - 60, H2.y1 + 70, 90);
  B.anchor('hangar_plane', PL.x, PL.y1 + 60, 90);
  B.anchor('fuel_depot', 5800, 2780, 110);
  B.checkpoint('hangars', 5150, 1960);
  B.checkpoint('hangars', 5150, 2140);
  B.checkpoint('hangars', 6550, 1800);
  B.zspawn(6500, 250, 800, 120, 1, 'hangars');
  B.zspawn(7600, 1100, 150, 150, 1.3, 'hangars');
  B.zspawn(8200, 1200, 150, 200, 1, 'hangars');
  B.zspawn(7300, 3200, 300, 150, 1, 'hangars');
  B.zspawn(8250, 2900, 100, 200, 1, 'hangars');
  void H1;
}

// ---- 4. the control tower ----------------------------------------------------------------------------------------

function buildTower(B, A, plats) {
  const S = { section: 'tower' };
  const T = BASE.tower, st = T.stair, f = T.floor;
  // the base: the door on the apron (the gate), the lobby's exit into the compound, the stair along the
  // north wall (its foot in an alcove off the lobby, a rail along its open side) up to the radio room (a
  // plateau: the room below it is closed)
  wallLine(B, T.x0, T.y0, T.x1, T.y0, 20, [], { style: 'twall', ...S });
  wallLine(B, T.x0, T.y1, T.x1, T.y1, 20, [T.exit], { style: 'twall', ...S });
  wallLine(B, T.x0, T.y0, T.x0, T.y1, 20, [T.door], { style: 'twall', ...S });
  wallLine(B, T.x1, T.y0, T.x1, T.y1, 20, [], { style: 'twall', ...S });
  B.gate('tower_door', 'door', T.x0, (T.door[0] + T.door[1]) / 2, 20, T.door[1] - T.door[0], 0, { section: 'hangars', label: 'Tower door', style: 'towerdoor' });
  A.flights.push(stairFlight(plats, st.x0, st.y0, st.x1, st.y1, 'e', 0, f));
  landing(plats, st.x1, T.y0 + 10, T.x1 - 10, T.y1 - 10, f, 1.5);
  wallLine(B, st.x0, st.y1 + 5, st.x1 + 10, st.y1 + 5, 10, [], { style: 'trail', ...S });
  wallLine(B, st.x1 + 5, st.y1, st.x1 + 5, T.y1 - 10, 10, [], { style: 'tinner', ...S });
  B.roof((T.x0 + T.x1) / 2, (T.y0 + T.y1) / 2, T.x1 - T.x0, T.y1 - T.y0, 0, { kind: 'plain', height: f + 130, section: 'tower', dark: 0.85, style: 'towerbase' });
  // the radio room: consoles under the windows, the radio desk, a map table
  B.ob('counter', T.x1 - 40, 1580, 30, 240, 0, { style: 'consoles', ...S });
  B.ob('desk', 8720, T.y1 - 40, 120, 36, 0, { style: 'radiodesk', ...S });
  B.ob('desk', 8690, 1560, 60, 80, 0, { style: 'maptable', ...S });
  B.ob('cabinet', 8600, 1690, 24, 70, 0, { style: 'lockers', ...S });
  B.light(8730, 1580, 220, '#bfffd8', 0.1, f + 110);
  B.light(8500, 1640, 160, '#ffd9a0', 0.3, 100);
  A.marks.push({ t: 'tower', x: (st.x1 + T.x1) / 2, y: (T.y0 + T.y1) / 2 });
  // the compound: the crash-rescue station, its tender, the windsock, the taxiway to the runway gate
  const F = BASE.fire;
  wallBox(B, F.x0, F.y0, F.x1, F.y1, { style: 'firestation', ...S });
  B.ob('truck', 8820, 2330, 180, 70, 0, { color: '#b8c21a', style: 'crashtender', ...S });
  B.ob('pillar', 9000, 1300, 12, 12, 0, { style: 'windsock', ...S });
  B.ob('suv', 8650, 1950, 104, 52, 0.4, { color: '#4b5320', style: 'humvee', wrecked: true, ...S });
  B.ob('sandbags', 9080, 1960, 28, 120, 0);
  lightTower(B, 8700, 1150, 'tower', { r: 560 });
  // the runway fence and its gate across the taxiway
  fenceLine(B, BASE.runwayX, [[BASE.taxi.y0, BASE.taxi.y1]], 'tower');
  B.gate('runway_gate', 'gate', BASE.runwayX, (BASE.taxi.y0 + BASE.taxi.y1) / 2, 12, BASE.taxi.y1 - BASE.taxi.y0, 0, { section: 'tower', label: 'Runway gate', style: 'runwaygate' });
  B.light(9150, 2100, 300, '#ffc070', 0, 200);

  B.anchor('tower_radio', 8740, 1660, 50);
  B.anchor('tower_stairs', 8450, 1560, 50);
  B.checkpoint('tower', 8500, 1680);
  B.checkpoint('tower', 8700, 2100);
  B.checkpoint('tower', 9050, 2150);
  B.zspawn(8800, 600, 400, 200, 1, 'tower');
  B.zspawn(8800, 3300, 400, 200, 1, 'tower');
  B.zspawn(9120, 2900, 60, 200, 0.8, 'tower');
}

// ---- 5. the runway ------------------------------------------------------------------------------------------------

function buildRunway(B, A) {
  const S = { section: 'runway' };
  const R = BASE.runway;
  const cy = (R.y0 + R.y1) / 2;
  // painted markings: the centreline dashes, the edge lines, the threshold bars, the touchdown zone
  for (let x = R.x0 + 400; x < R.x1 - 500; x += 240) B.line('white', x, cy, x + 120, cy, 6);
  B.line('white', R.x0, R.y0 + 14, R.x1, R.y0 + 14, 5);
  B.line('white', R.x0, R.y1 - 14, R.x1, R.y1 - 14, 5);
  for (const tx of [R.x0 + 60, R.x1 - 260]) for (let y = R.y0 + 60; y < R.y1 - 40; y += 42) if (Math.abs(y - cy) > 40) B.line('white', tx, y, tx + 180, y, 14);
  // the flare path: crates of road flares at the middle, the drop zone's panels
  B.ob('counter', R.flares - 40, R.y0 + 60, 50, 34, 0.1, { style: 'flarecrate', ...S });
  B.ob('counter', R.flares + 60, R.y0 + 70, 50, 34, -0.2, { style: 'flarecrate', ...S });
  A.marks.push({ t: 'flares', x0: R.x0 + 300, x1: R.x1 - 200, y: cy, at: R.flares });
  // the edge lights and threshold bars (art), the PAPI, the approach lights past the end
  A.marks.push({ t: 'runway', x0: R.x0, x1: R.x1, y0: R.y0, y1: R.y1 });
  // cover for the last stand: HESCO bastions and sandbags either side, an abandoned loader, a burnt truck
  for (const [x, y] of [[10150, 2420], [10650, 2420], [10150, 3180], [10650, 3180]]) {
    for (let k = -1; k <= 1; k++) B.ob('hesco', x + k * 60, y, 60, 60, 0, S);
  }
  B.ob('sandbags', R.flares, R.y0 + 140, 160, 28, 0.02);
  B.ob('sandbags', R.flares + 240, R.y1 - 120, 160, 28, -0.05);
  B.ob('wall', 10900, 2760, 90, 180, 0.4, { style: 'kloader', ...S });
  B.vehicle('truck', 11300, 2650, -0.5, { color: '#4b5320', wrecked: true, burning: true });
  B.ob('suv', 9900, 2900, 104, 52, 2.4, { color: '#4b5320', style: 'humvee', ...S });
  B.ob('wall', 11600, 3300, 60, 60, 0, { style: 'glideslope', ...S });
  B.ob('pillar', 11750, 2380, 40, 40, 0, { style: 'papi', ...S });
  lightTower(B, 10400, 2300, 'runway', { r: 720, h: 420 });
  lightTower(B, 11500, 3250, 'runway', { r: 620, h: 420, light: true });
  // the runway's own map lights: the edge lights near the flares (a mission may switch the section's
  // lights off and on with the flares)
  for (let x = R.x0 + 400; x < R.x1; x += 800) {
    B.light(x, R.y0 + 6, 120, '#fff0c8', 0, 12);
    B.light(x, R.y1 - 6, 120, '#fff0c8', 0, 12);
  }
  for (let k = 0; k < 5; k++) B.light(R.flares - 400 + k * 200, cy + (k % 2 ? 80 : -80), 180, '#ff3a2a', 0.5, 10);

  B.anchor('runway_flares', R.flares, cy, 200);
  B.anchor('runway_end', R.x1 - 300, cy, 200);
  B.checkpoint('runway', 9350, 2060);
  B.checkpoint('runway', 9350, 2150);
  B.checkpoint('runway', 9900, 2350);
  B.zspawn(11850, 2500, 80, 600, 1.4, 'runway');
  B.zspawn(10800, 1500, 500, 150, 1, 'runway');
  B.zspawn(10800, 3550, 500, 150, 1, 'runway');
  B.zspawn(11700, 1900, 200, 150, 1, 'runway');
}
