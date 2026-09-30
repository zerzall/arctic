// Harlan Rail Yard — story level (JOURNEY.md). Owner: agent C3.
//
// SPEC is the contract other parts depend on (the mission scripts, the engine, the tests): keep every
// section id (in this order), anchor name and gate id. Change the layout, the size, add sections,
// anchors, gates and props freely.
//
// Get a locomotive running to reach Checkpoint Delta. The yard runs west to east along the main line
// across a 12000 × 4000 valley floor:
//
//   The Sidings    the crew walks in along the main line between strings of boxcars, tank cars and
//                  hoppers on eight sidings, past the water tower and the yard office; a derailed train
//                  lies across the tracks at the east end, so the only way on is the engine shed.
//   Engine Sheds   a three-road brick shed: inspection pits under the roads (the floor stands on terrain
//                  30 up, the pits go down to the ground), a dead locomotive on the jacks, the overhead
//                  crane, the foreman's office; out through the east door to the yard gate.
//   Signal Box     the junction before the bridge: signal gantries over the throat, a relay hut and the
//                  two-storey signal box, its lever room up an outside stair (terrain 100 up).
//   Rail Bridge    a three-span steel truss across the Blackwater river, the water 16 below the deck.
//   Freight Yard   container stacks in rows, the rail-mounted gantry crane over two loading tracks, the
//                  grain elevator beyond the fence, the switch stand on the main line.
//   The Main Line  the diesel locomotive standing on the main line, a boxcar across the throat, the line
//                  running on east toward Checkpoint Delta.
//
// Every gate and roof stays on the ground; only the shed floor and the signal box's upper floor stand on
// terrain (shared/terrain.js plateaus). The level art (render3d/levels/railyard.js) reads map.levelArt.

import { wallBox, wallLine, stairFlight, landing, artData, cliffLine, spawnRows, floorWithHoles } from './dam.js';

export const SPEC = Object.freeze({
  "id": "railyard",
  "name": "Harlan Rail Yard",
  "chapter": 4,
  "time": "day",
  "owner": "C3",
  "description": "Hard sun on the tracks and the rust: the sidings, the dark engine sheds, the signal box, the rail bridge over the river, the freight yard and the line to Checkpoint Delta.",
  "sections": [
    {
      "id": "sidings",
      "name": "The Sidings"
    },
    {
      "id": "sheds",
      "name": "Engine Sheds"
    },
    {
      "id": "signalbox",
      "name": "Signal Box"
    },
    {
      "id": "bridge",
      "name": "Rail Bridge"
    },
    {
      "id": "freight",
      "name": "Freight Yard"
    },
    {
      "id": "mainline",
      "name": "The Main Line"
    }
  ],
  "anchors": {
    "sidings": [
      "start",
      "siding_wagon",
      "siding_tower"
    ],
    "sheds": [
      "shed_crane",
      "shed_pit",
      "shed_office"
    ],
    "signalbox": [
      "signal_lever",
      "signal_stairs"
    ],
    "bridge": [
      "bridge_mid",
      "bridge_far"
    ],
    "freight": [
      "freight_container",
      "freight_crane",
      "freight_switch"
    ],
    "mainline": [
      "locomotive",
      "line_gate"
    ]
  },
  "gates": [
    {
      "id": "shed_door",
      "kind": "shutter",
      "from": "sidings",
      "to": "sheds",
      "label": "Shed door"
    },
    {
      "id": "yard_gate",
      "kind": "gate",
      "from": "sheds",
      "to": "signalbox",
      "label": "Yard gate"
    },
    {
      "id": "bridge_gate",
      "kind": "bars",
      "from": "signalbox",
      "to": "bridge",
      "label": "Bridge gate"
    },
    {
      "id": "freight_gate",
      "kind": "fence",
      "from": "bridge",
      "to": "freight",
      "label": "Freight fence"
    },
    {
      "id": "line_gate",
      "kind": "vehicle",
      "from": "freight",
      "to": "mainline",
      "label": "A boxcar across the line"
    }
  ]
});

/** World size and mood (maps.js MAP_DEFS). */
export const DEF = { width: 12000, height: 4000, darkness: 0.64, tint: '#5a4a3a', ground: '#5a5040' };

/** Key coordinates the art reads too. */
export const YARD = Object.freeze({
  main: [2650, 2760],                          // the main line's two tracks (y)
  sidings: [1700, 1810, 1920, 2030, 2140, 2250, 2360, 2470],
  shed: { x0: 3400, x1: 5000, y0: 1100, y1: 2100, floor: 30, roads: [1350, 1600, 1850] },
  pit: { x0: 3720, x1: 4780, w: 40 },
  box: { x0: 5700, x1: 5940, y0: 2250, y1: 2400, floor: 100 },
  river: { x0: 6500, x1: 7700 },
  deck: { y0: 2540, y1: 2860 },
  crane: 9000,
  loco: { x: 11000, y: 2650 },
});

const GAUGE = 23;

/** A track (a pair of rails on sleepers) for the art: from (x1, y1) to (x2, y2). */
function track(A, x1, y1, x2, y2, o = {}) {
  A.rails.push({ x1, y1, x2, y2, rust: o.rust ?? 0.5 });
}

/**
 * Lay the level out.
 * @param {object} B map builder (maps.js createBuilder) with the level calls of JOURNEY.md §3
 */
export function build(B) {
  const { W, H } = B;
  const plats = [];
  B.map.terrain = { hills: [], plateaus: plats };
  // a hard, hazy summer day over the yard; by night a sodium-orange sky over the town
  B.map.look = {
    day: {
      az: 150, el: 44, haze: '#c9c2b0', horizon: '#d8d0bc', zenith: '#3f78b8', fog: 0.00016, cover: 0.34,
      sunColor: '#fff0d0', sunI: 4.6, hemiSky: '#b8c8e0', hemiGround: '#7a6a4a', hemi: 0.9, exposure: 1.0,
      heat: 0.5, ridge: '#7a7f78', wet: 0.08, mist: 0.5,
      grade: { saturation: 1.06, contrast: 1.08, gain: [1.04, 1.0, 0.95], vignette: 0.22 },
    },
    night: {
      fog: '#1a1410', horizon: '#3a2a1c', zenith: '#05060a', sky: '#8a7a6a', ground: '#3a3026', moon: '#9aaccc',
      fogDensity: 0.00105, hemi: 1.0, moonI: 0.4,
    },
    trees: ['oak', 'maple', 'birch', 'pine'],
    deciduous: 0.7,
  };
  const A = artData(B);
  A.rails = [];

  // ---- sections and their spawns
  B.section('sidings', 'The Sidings', 1700, 2400, 3400, 1800);
  B.section('sheds', 'Engine Sheds', 4300, 1640, 1800, 1100);
  B.section('signalbox', 'Signal Box', 5800, 2380, 1200, 1700);
  B.section('bridge', 'Rail Bridge', 7150, 2700, 1500, 400);
  B.section('freight', 'Freight Yard', 9100, 2400, 2400, 2400);
  B.section('mainline', 'The Main Line', 11150, 2700, 1700, 1000);

  // ---- ground: ballast over the yard, the service roads, the river
  B.box('dirt', 0, 1400, W, 3500);
  B.box('gravel', 60, 1620, 3400, 2830);
  B.box('gravel', 3400, 2580, 12000, 2830);
  B.box('gravel', 5200, 1900, 6400, 2830);
  B.box('gravel', 7900, 1500, 10300, 3300);
  B.box('asphalt', 60, 2900, 3400, 3060);         // the yard's service road
  B.box('concrete', 400, 3060, 1400, 3300);       // the yard office's lot
  B.box('concrete', 3400, 1100, 5200, 2300);      // the shed and its aprons
  B.box('concrete', 8000, 1500, 9900, 2450);      // the container terminal
  B.box('asphalt', 8200, 1560, 9800, 1660);       // the terminal's truck lane
  B.box('asphalt', 7900, 2880, 10300, 3040);      // the yard road on the east bank
  B.box('water', 6500, 0, 7700, YARD.deck.y0);
  B.box('water', 6500, YARD.deck.y1, 7700, H);
  B.box('grass', 60, 60, 6400, 1400);
  B.box('grass', 7800, 60, W - 60, 1400);
  B.box('grass', 60, 3500, 6400, H - 60);
  B.box('grass', 7800, 3500, W - 60, H - 60);

  buildSidings(B, A);
  buildShed(B, A, plats);
  buildSignalBox(B, A, plats);
  buildBridge(B, A);
  buildFreight(B, A);
  buildMainline(B, A);

  // the world's edges
  wallBox(B, 0, 0, 40, H, { style: 'nodraw' });
  wallBox(B, W - 40, 0, W, H, { style: 'nodraw' });
  wallBox(B, 0, 0, W, 40, { style: 'nodraw' });
  wallBox(B, 0, H - 40, W, H, { style: 'nodraw' });
  B.groundClutter({ cracks: 60, oil: 40, paper: 40, debris: 60, blood: 24, tires: 6, tufts: 500, bushes: 50, rocks: 30 });
}

// ---- 1. the sidings ---------------------------------------------------------------------------------------

/** A string of wagons on a track: [style, length] items, `gaps` of open track between some. */
function consist(B, x0, y, items, color = null) {
  let x = x0;
  const out = [];
  for (const it of items) {
    if (typeof it === 'number') { x += it; continue; }
    const [style, len, col] = it;
    const o = B.ob(style === 'tankcar' ? 'tanker' : 'bus', x + len / 2, y, len, style === 'flatcar' ? 56 : 62, 0, { style, color: col || color || '#7a3a2a', section: 'sidings' });
    out.push(o);
    x += len + 6;
  }
  return out;
}

function buildSidings(B, A) {
  const S = { section: 'sidings' };
  const Y = YARD.sidings;
  for (const y of Y) track(A, 60, y, 3400, y);
  for (const y of YARD.main) track(A, 60, y, 3380, y, { rust: 0.15 });
  // switches fanning the sidings off the main line (diagonal tracks at the west end)
  track(A, 200, 2650, 620, 2470);
  track(A, 620, 2470, 1300, 1700);
  // wagons: long strings with gaps to walk through; the start is at the west end of the main line
  const RED = '#7a3a2a', BRN = '#5a4a3a', GRN = '#3f5a48', GRY = '#6a6e70', BLK = '#2a2a2c', YEL = '#b8902a';
  consist(B, 900, Y[0], [['boxcar', 250, RED], ['boxcar', 250, BRN], 180, ['hopper', 220, GRY], ['hopper', 220, GRY], ['hopper', 220, GRY], 300, ['boxcar', 250, GRN]]);
  consist(B, 1300, Y[1], [['tankcar', 230, BLK], ['tankcar', 230, BLK], ['tankcar', 230, '#c8c4bc'], 260, ['flatcar', 250, BRN], ['boxcar', 250, RED]]);
  consist(B, 700, Y[2], [['gondola', 240, BRN], ['gondola', 240, BRN], 420, ['boxcar', 250, YEL], ['boxcar', 250, RED], ['boxcar', 250, GRN]]);
  consist(B, 1500, Y[3], [['hopper', 220, GRY], ['hopper', 220, '#8a4a2a'], 160, ['tankcar', 230, BLK], ['tankcar', 230, BLK]]);
  consist(B, 900, Y[4], [['boxcar', 250, BRN], 300, ['flatcar', 250, BRN], ['flatcar', 250, BRN], 140, ['boxcar', 250, RED], ['caboose', 160, '#a8261c']]);
  consist(B, 1200, Y[5], [['tankcar', 230, '#c8c4bc'], ['tankcar', 230, BLK], 380, ['gondola', 240, BRN], ['boxcar', 250, GRN]]);
  consist(B, 800, Y[6], [['boxcar', 250, RED], ['boxcar', 250, RED], 260, ['hopper', 220, GRY], 200, ['boxcar', 250, BRN]]);
  consist(B, 1700, Y[7], [['flatcar', 250, BRN], ['boxcar', 250, YEL], 300, ['tankcar', 230, BLK]]);
  // the wagon a mission opens: a boxcar with its door open, on the main line's siding
  const w = B.ob('bus', 2400, Y[7], 250, 62, 0, { style: 'boxcar', color: '#7a3a2a', label: 'open', section: 'sidings' });
  void w;
  // the derailment across the east end: wagons thrown over the tracks, a wall behind them
  for (const [x, y, a, st, col] of [[3180, 2230, 0.9, 'boxcar', RED], [3230, 2480, -0.6, 'tankcar', BLK], [3150, 2720, 1.3, 'hopper', GRY], [3260, 2980, 0.4, 'boxcar', GRN]]) {
    B.ob(st === 'tankcar' ? 'tanker' : 'bus', x, y, st === 'tankcar' ? 230 : st === 'hopper' ? 220 : 250, 62, a, { style: st, color: col, label: 'derailed', section: 'sidings' });
  }
  wallLine(B, 3400, 2100, 3400, 3330, 30, [], { style: 'nodraw', ...S });
  // the yard's north fence (a warehouse row behind it) and the south fence along the service road
  wallLine(B, 60, 1580, 3400, 1580, 10, [], { style: 'yardfence', ...S });
  wallLine(B, 60, 3330, 3400, 3330, 10, [], { style: 'yardfence', ...S });
  B.ob('building', 1000, 1470, 600, 180, 0, { color: '#8a5a44', roof: '#4f5a60', section: 'sidings' }).arch = 'industrial';
  B.ob('building', 2200, 1480, 500, 160, 0, { color: '#7a6a5a', roof: '#4f5a60', section: 'sidings' }).arch = 'industrial';
  // the water tower between the sidings and the office, the yard office and its lot, a truck
  for (const [dx, dy] of [[-40, -40], [40, -40], [40, 40], [-40, 40]]) B.ob('pillar', 1800 + dx, 3180 + dy, 16, 16, 0, { color: '#4a4e52', style: 'nodraw', ...S });
  A.marks.push({ t: 'watertower', x: 1800, y: 3180, a: 0 });
  B.ob('building', 800, 3180, 240, 150, 0, { color: '#b8ad98', roof: '#5b6770', section: 'sidings' }).arch = 'shack';
  B.vehicle('pickup', 1150, 3150, 0.2, { color: '#e8e2d0', jitter: 0 });
  B.vehicle('truck', 2600, 2980, 0.02, { wrecked: true });
  B.vehicle('car', 400, 2980, -0.1, { wrecked: true });
  // stacks of sleepers, a speeder on the main line, drums
  B.ob('wall', 2100, 2580, 140, 40, 0, { style: 'sleepers', ...S });
  B.ob('wall', 600, 2560, 70, 36, 0.05, { style: 'speeder', ...S });
  // lights: tall yard floodlight masts (on by night), the office lamp, drum fires
  for (const [x, y] of [[500, 2580], [1600, 2580], [2700, 2580], [1600, 1650]]) {
    B.ob('pillar', x, y, 24, 24, 0, { style: 'mast', ...S });
    B.light(x, y, 520, '#ffb04a', 0, 360);
  }
  B.light(800, 3270, 200, '#ffcf8a', 0.2, 100);
  B.fire(2250, 2580, 14);
  B.fire(1100, 3060, 14);

  B.anchor('start', 300, 2705, 180);
  B.anchor('siding_wagon', 2350, Y[7] + 64, 140);
  B.anchor('siding_tower', 1800, 3060, 160);
  spawnRows(B, 220, 2705);
  B.supply(420, 2860);
  B.checkpoint('sidings', 300, 2600);
  B.checkpoint('sidings', 360, 2810);
  B.checkpoint('sidings', 2000, 2700);
  B.checkpoint('sidings', 2700, 2210);
  B.zspawn(1500, 1630, 200, 60, 1, 'sidings');
  B.zspawn(2900, 1625, 200, 70, 1.2, 'sidings');
  B.zspawn(2400, 3230, 240, 70, 1, 'sidings');
  B.zspawn(3000, 2700, 120, 80, 1.3, 'sidings');
  B.zspawn(1300, 2080, 120, 50, 0.8, 'sidings');
}

// ---- 2. the engine shed -------------------------------------------------------------------------------------

function buildShed(B, A, plats) {
  const S = { section: 'sheds' };
  const K = YARD.shed, P = YARD.pit;
  const T = 24;
  // the walls: the west gable with three road doors (the middle one is the gate), the east gable with an
  // open door on road 3, the long sides with windows (drawn)
  wallLine(B, K.x0, K.y0, K.x0, K.y1, T, [[1520, 1680]], { style: 'shedwall', ...S });
  B.gate('shed_door', 'shutter', K.x0, 1600, T, 160, 0, { section: 'sidings', label: 'Shed door', style: 'shedshutter' });
  wallLine(B, K.x1, K.y0, K.x1, K.y1, T, [[1770, 1930]], { style: 'shedwall', ...S });
  wallLine(B, K.x0, K.y0, K.x1, K.y0, T, [], { style: 'shedwall', ...S });
  wallLine(B, K.x0, K.y1, K.x1, K.y1, T, [], { style: 'shedwall', ...S });
  // the floor stands 30 up; the pits under the roads go down to the ground, and so do the feet of the
  // steps inside the two doors
  const f = K.floor;
  const pits = K.roads.map((y) => [P.x0, y - P.w / 2, P.x1, y + P.w / 2]);
  const inX0 = K.x0 + 12, inX1 = K.x1 - 12;
  const doorW = [inX0, 1520, inX0 + 60, 1680], doorE = [inX1 - 60, 1770, inX1, 1930];
  floorWithHoles(plats, inX0, K.y0 + 12, inX1, K.y1 - 12, f, [...pits, doorW, doorE]);
  A.pits = pits.map(([x0, y0, x1, y1]) => ({ x0, y0, x1, y1, h: f }));
  A.flights.push(stairFlight(plats, doorW[0], doorW[1], doorW[2], doorW[3], 'e', 0, f, 10));
  A.flights.push(stairFlight(plats, doorE[0], doorE[1], doorE[2], doorE[3], 'w', 0, f, 10));
  B.roof((K.x0 + K.x1) / 2, (K.y0 + K.y1) / 2, K.x1 - K.x0, K.y1 - K.y0, 0, { kind: 'industrial', height: f + 260, section: 'sheds', dark: 0.7, style: 'shed' });
  // inside: the dead locomotive on road 2 over its pit, a tank engine on road 1, benches, the wheel lathe
  B.ob('bus', 4250, K.roads[1], 330, 64, 0, { style: 'diesel', color: '#2f4a6a', label: 'dead', section: 'sheds' });
  B.ob('bus', 3960, K.roads[0], 250, 62, 0, { style: 'boxcar', color: '#5a4a3a', section: 'sheds' });
  B.ob('wall', 4640, K.roads[2] - 110, 160, 40, 0, { style: 'bench', ...S });
  B.ob('wall', 3700, K.y1 - 60, 200, 40, 0, { style: 'bench', ...S });
  B.ob('wall', 3560, K.y0 + 70, 90, 70, 0, { style: 'lathe', ...S });
  B.ob('wall', 4480, K.y0 + 60, 70, 50, 0, { style: 'drums', ...S });
  B.ob('wall', 4120, K.y1 - 70, 60, 60, 0, { style: 'wheels', ...S });
  // the foreman's office in the north-east corner: walls with a doorway, a window onto the shed
  wallLine(B, 4700, K.y0, 4700, 1300, 16, [[1180, 1270]], { style: 'officewall', ...S });
  wallLine(B, 4700, 1300, K.x1, 1300, 16, [], { style: 'officewall', ...S });
  B.ob('desk', 4860, 1180, 120, 44, 0, { style: 'foremandesk', ...S });
  B.ob('cabinet', 4960, 1260, 30, 60, 0, { style: 'filecab', ...S });
  B.roof(4850, 1200, 300, 200, 0, { kind: 'office', height: f + 130, section: 'sheds', dark: 0.8, style: 'shedoffice' });
  // the east apron to the yard gate: a fence line with the gate, a tractor, oil drums
  wallLine(B, 5200, 1100, 5200, 2300, 10, [[1780, 1940]], { style: 'yardfence', ...S });
  B.gate('yard_gate', 'gate', 5200, 1860, 10, 160, 0, { section: 'sheds', label: 'Yard gate', style: 'slidegate' });
  wallLine(B, K.x1, K.y0, 5200, K.y0, 10, [], { style: 'yardfence', ...S });
  wallLine(B, K.x0, 2300, 5200, 2300, 10, [], { style: 'yardfence', ...S });
  wallLine(B, K.x0, K.y1, K.x0, 2300, 10, [], { style: 'yardfence', ...S });
  B.vehicle('pickup', 5100, 1300, Math.PI / 2, { wrecked: true });
  B.ob('wall', 5100, 2150, 60, 60, 0, { style: 'drums', ...S });
  // lights: the shed's high bays, the office, a red lamp at the pit, the apron flood
  for (let k = 0; k < 4; k++) B.light(3650 + k * 380, 1600, 340, '#ffd0a0', k === 1 ? 0.3 : 0, f + 230);
  B.light(4850, 1200, 200, '#e8f0ff', 0.2, f + 120);
  B.light(4000, K.roads[2], 160, '#ff4030', 0.4, f + 20);
  B.light(5100, 1860, 300, '#ffb04a', 0, 220);

  B.anchor('shed_crane', 4000, 1480, 120);
  B.anchor('shed_pit', 4400, K.roads[2] - 60, 120);
  B.anchor('shed_office', 4860, 1250, 90);
  B.checkpoint('sheds', 3560, 1460);
  B.checkpoint('sheds', 3560, 1780);
  B.checkpoint('sheds', 4550, 1690);
  B.zspawn(4880, 1470, 100, 60, 1, 'sheds');
  B.zspawn(4900, 2000, 100, 80, 1, 'sheds');
  B.zspawn(3700, 1200, 120, 60, 0.8, 'sheds');
  B.zspawn(5100, 1500, 100, 160, 1, 'sheds');
}

// ---- 3. the signal box ---------------------------------------------------------------------------------------

function buildSignalBox(B, A, plats) {
  const S = { section: 'signalbox' };
  const X = YARD.box;
  for (const y of YARD.main) track(A, 3400, y, 6500, y, { rust: 0.15 });
  track(A, 5200, 1860, 5500, 1860);
  track(A, 5500, 1860, 6000, 2650);
  track(A, 5200, 2250, 5600, 2250);
  // the box: the relay room below (closed), the lever room up the outside stair on its west side
  const f = X.floor;
  wallLine(B, X.x0, X.y0, X.x1, X.y0, 20, [], { style: 'boxwall', ...S });
  wallLine(B, X.x0, X.y1, X.x1, X.y1, 20, [], { style: 'boxwall', ...S });
  wallLine(B, X.x1, X.y0, X.x1, X.y1, 20, [], { style: 'boxwall', ...S });
  wallLine(B, X.x0, X.y0, X.x0, X.y1, 20, [[X.y0 + 10, X.y0 + 100]], { style: 'boxwall', ...S });
  landing(plats, X.x0 + 10, X.y0 + 10, X.x1 - 10, X.y1 - 10, f, 1.5);
  // the stair along the west wall: from the ground at the south up to a landing at the door
  const st = { x0: X.x0 - 100, x1: X.x0 - 10, y0: X.y0 + 10, y1: X.y0 + 250 };
  A.flights.push(stairFlight(plats, st.x0, st.y0 + 90, st.x1, st.y1, 'n', 0, f));
  landing(plats, st.x0, st.y0, X.x0 + 10, st.y0 + 90, f, 1.5);
  wallLine(B, st.x0 - 8, st.y0 - 8, st.x0 - 8, st.y1, 12, [], { style: 'stairrail', ...S });
  wallLine(B, st.x0 - 8, st.y0 - 8, X.x0, st.y0 - 8, 12, [], { style: 'stairrail', ...S });
  wallLine(B, st.x1 + 4, st.y0 + 100, st.x1 + 4, st.y1, 12, [], { style: 'nodraw', ...S });
  B.roof((X.x0 + X.x1) / 2, (X.y0 + X.y1) / 2, X.x1 - X.x0, X.y1 - X.y0, 0, { kind: 'plain', height: f + 130, section: 'signalbox', dark: 0.6, style: 'leverroom' });
  B.ob('wall', (X.x0 + X.x1) / 2, X.y1 - 40, 180, 30, 0, { style: 'leverframe', ...S });
  // the relay hut, signal gantries over the throat, point rodding and a ground frame
  B.ob('building', 5500, 2000, 140, 100, 0, { color: '#8a5a44', roof: '#4a3f33', section: 'signalbox' }).arch = 'shack';
  A.marks.push({ t: 'gantry', x: 5400, y: 2705, a: 0, w: 320 });
  A.marks.push({ t: 'gantry', x: 6250, y: 2705, a: 0, w: 320 });
  B.ob('wall', 6000, 2850, 50, 30, 0, { style: 'groundframe', ...S });
  // the area's fences and the bridge gate at the bridgehead
  wallLine(B, 5200, 1500, 6400, 1500, 10, [], { style: 'yardfence', ...S });
  wallLine(B, 5200, 1500, 5200, 1100, 10, [], { style: 'nodraw', ...S });
  wallLine(B, 5200, 2300, 5200, 3300, 10, [], { style: 'yardfence', ...S });
  wallLine(B, 5200, 3300, 6400, 3300, 10, [], { style: 'yardfence', ...S });
  wallLine(B, 6400, 1500, 6400, 3300, 20, [[YARD.deck.y0, YARD.deck.y1]], { style: 'bridgehead', ...S });
  B.gate('bridge_gate', 'bars', 6400, (YARD.deck.y0 + YARD.deck.y1) / 2, 20, YARD.deck.y1 - YARD.deck.y0, 0, { section: 'signalbox', label: 'Bridge gate', style: 'portcullis' });
  // wrecks: a derailed hopper in the throat, a burnt-out car at the crossing
  B.ob('bus', 5750, 2980, 220, 62, 0.4, { style: 'hopper', color: '#6a6e70', label: 'derailed', section: 'signalbox' });
  B.vehicle('car', 6100, 2500, 0.8, { wrecked: true, burning: true });
  B.vehicle('van', 5450, 3100, -0.2, { wrecked: true });
  // lights: the box's lamps, the gantry signals (red), a floodlight mast
  B.light((X.x0 + X.x1) / 2, (X.y0 + X.y1) / 2, 220, '#ffd9a0', 0.15, f + 110);
  B.ob('pillar', 5900, 1900, 24, 24, 0, { style: 'mast', ...S });
  B.light(5900, 1900, 520, '#ffb04a', 0, 360);
  B.light(5400, 2705, 160, '#ff3020', 0.2, 170);
  B.light(6250, 2705, 160, '#ff3020', 0.2, 170);

  B.anchor('signal_lever', (X.x0 + X.x1) / 2, X.y1 - 90, 90);
  B.anchor('signal_stairs', st.x0 + 45, st.y1 + 60, 120);
  B.checkpoint('signalbox', 5320, 1860);
  B.checkpoint('signalbox', 5400, 2400);
  B.checkpoint('signalbox', 6100, 2750);
  B.zspawn(6300, 1650, 120, 120, 1, 'signalbox');
  B.zspawn(6300, 3150, 120, 120, 1, 'signalbox');
  B.zspawn(5500, 3200, 200, 70, 1, 'signalbox');
  B.zspawn(5850, 2330, 100, 60, 0.6, 'signalbox');
}

// ---- 4. the rail bridge -----------------------------------------------------------------------------------------

function buildBridge(B, A) {
  const S = { section: 'bridge' };
  const D = YARD.deck, R = YARD.river;
  for (const y of YARD.main) track(A, 6400, y, 7900, y, { rust: 0.1 });
  // the trusses along both edges of the deck (sim walls: nobody goes over the side)
  wallLine(B, R.x0 - 60, D.y0 + 6, R.x1 + 60, D.y0 + 6, 12, [], { style: 'truss', ...S });
  wallLine(B, R.x0 - 60, D.y1 - 6, R.x1 + 60, D.y1 - 6, 12, [], { style: 'truss', ...S });
  wallLine(B, 6400, D.y0 + 6, R.x0 - 60, D.y0 + 6, 12, [], { style: 'nodraw', ...S });
  wallLine(B, 6400, D.y1 - 6, R.x0 - 60, D.y1 - 6, 12, [], { style: 'nodraw', ...S });
  wallLine(B, R.x1 + 60, D.y0 + 6, 7900, D.y0 + 6, 12, [], { style: 'nodraw', ...S });
  wallLine(B, R.x1 + 60, D.y1 - 6, 7900, D.y1 - 6, 12, [], { style: 'nodraw', ...S });
  A.marks.push({ t: 'bridge', x0: R.x0, x1: R.x1, y0: D.y0, y1: D.y1, spans: 3 });
  // on the deck: a stalled work train (a flatcar with a crane, a boxcar), a velocipede, debris
  B.ob('bus', 6950, YARD.main[1], 250, 56, 0, { style: 'flatcar', color: '#5a4a3a', label: 'crane', section: 'bridge' });
  B.ob('bus', 7400, YARD.main[0], 250, 62, 0.02, { style: 'boxcar', color: '#3f5a48', section: 'bridge' });
  B.ob('sandbags', 7650, 2640, 90, 24, Math.PI / 2);
  // lights along the trusses
  for (let x = R.x0 + 200; x < R.x1; x += 400) {
    B.light(x, D.y0 + 20, 260, '#ffb04a', 0, 150);
    B.light(x + 200, D.y1 - 20, 260, '#ffb04a', 0, 150);
  }
  B.anchor('bridge_mid', 7100, 2700, 150);
  B.anchor('bridge_far', 7760, 2700, 150);
  B.checkpoint('bridge', 6480, 2610);
  B.checkpoint('bridge', 6480, 2790);
  B.checkpoint('bridge', 7150, 2600);
  B.zspawn(7800, 2600, 120, 70, 1.2, 'bridge');
  B.zspawn(7800, 2800, 120, 70, 1.2, 'bridge');
}

// ---- 5. the freight yard -----------------------------------------------------------------------------------------

function buildFreight(B, A) {
  const S = { section: 'freight' };
  const D = YARD.deck;
  for (const y of YARD.main) track(A, 7900, y, 12000, y, { rust: 0.15 });
  track(A, 7900, 1760, 9900, 1760);
  track(A, 7900, 1900, 9900, 1900);
  track(A, 9900, 1900, 10200, 2650);
  track(A, 7900, 3150, 10000, 3150);
  // the freight fence across the bridge's east end, the bank walls either side
  B.gate('freight_gate', 'fence', 7900, (D.y0 + D.y1) / 2, 8, D.y1 - D.y0 - 12, 0, { section: 'bridge', label: 'Freight fence', style: 'fencepanel' });
  wallLine(B, 7900, 1300, 7900, D.y0 + 6, 20, [], { style: 'bankwall', ...S });
  wallLine(B, 7900, D.y1 - 6, 7900, 3500, 20, [], { style: 'bankwall', ...S });
  // the yard's outer fence
  wallLine(B, 7900, 1300, 10300, 1300, 10, [], { style: 'yardfence', ...S });
  wallLine(B, 7900, 3500, 10300, 3500, 10, [], { style: 'yardfence', ...S });
  // container stacks in rows (walls drawn as stacks: `label` is how many high)
  const stack = (x, y, w, h, n, a = 0) => B.ob('wall', x, y, w, h, a, { style: 'stack', label: String(n), ...S });
  for (let k = 0; k < 4; k++) stack(8200 + k * 420, 2140, 300, 120, 2 + (k % 2));
  for (let k = 0; k < 3; k++) stack(8410 + k * 420, 2360, 280, 60, 1 + ((k + 1) % 3));
  for (let k = 0; k < 5; k++) stack(8100 + k * 380, 1420, 320, 60, 2 + (k % 2));
  for (let k = 0; k < 4; k++) stack(8200 + k * 420, 3380, 340, 60, 2 + (k % 2));
  stack(8400, 3180, 300, 60, 1);
  stack(9240, 3180, 300, 60, 2);
  // the loose container a mission opens (doors open, supplies inside)
  B.ob('container', 8600, 1680, 150, 56, 0, { color: '#8a6d2f', style: 'opencontainer', ...S });
  // the rail-mounted gantry crane over the two loading tracks and the truck lane
  for (const y of [1545, 2000]) for (const dx of [-80, 80]) B.ob('wall', YARD.crane + dx, y, 40, 40, 0, { style: 'rmgleg', ...S });
  A.marks.push({ t: 'rmg', x: YARD.crane, y0: 1545, y1: 2000 });
  // the grain elevator beyond the north fence (a landmark), a reach stacker, trucks, a switch stand
  A.marks.push({ t: 'elevator', x: 9000, y: 900 });
  B.ob('wall', 10100, 2560, 30, 30, 0, { style: 'switchstand', ...S });
  B.vehicle('truck', 8400, 1600, 0.02, { color: '#c8622a', jitter: 0 });
  B.semi(9300, 1610, 0, 0, { trailerColor: '#9aa3a8' });
  B.semi(8900, 2960, 0.05, 0.3, { wrecked: true });
  B.vehicle('car', 9700, 2980, 2.6, { wrecked: true, burning: true });
  B.ob('wall', 9750, 1780, 180, 90, 0.1, { style: 'reachstacker', ...S });
  // lights: floodlight masts over the terminal, the crane's lamps
  for (const [x, y] of [[8300, 2560], [9200, 2560], [8800, 3220], [9900, 1650]]) {
    B.ob('pillar', x, y, 24, 24, 0, { style: 'mast', ...S });
    B.light(x, y, 560, '#ffb04a', 0, 380);
  }
  B.light(YARD.crane, 1770, 300, '#fff0d0', 0, 260);

  B.anchor('freight_container', 8600, 1760, 120);
  B.anchor('freight_crane', YARD.crane, 1770, 140);
  B.anchor('freight_switch', 10060, 2610, 100);
  B.checkpoint('freight', 8000, 2640);
  B.checkpoint('freight', 8000, 2780);
  B.checkpoint('freight', 9000, 2700);
  B.zspawn(9800, 1400, 200, 80, 1, 'freight');
  B.zspawn(10150, 3200, 120, 200, 1.2, 'freight');
  B.zspawn(8800, 2180, 160, 50, 0.8, 'freight');
  B.zspawn(8850, 3270, 160, 50, 1, 'freight');
  B.zspawn(10150, 1500, 120, 200, 1.2, 'freight');
}

// ---- 6. the main line ------------------------------------------------------------------------------------------------

function buildMainline(B, A) {
  const S = { section: 'mainline' };
  const L = YARD.loco;
  // the throat: stacks either side, the boxcar across the line (the gate), the fence beyond
  wallLine(B, 10300, 1300, 10300, 2575, 30, [], { style: 'stackwall', ...S });
  wallLine(B, 10300, 2825, 10300, 3500, 30, [], { style: 'stackwall', ...S });
  B.gate('line_gate', 'vehicle', 10300, 2700, 62, 250, 0, { section: 'freight', label: 'A boxcar across the line', style: 'boxcargate', color: '#7a3a2a' });
  track(A, 10300, 2300, 10300, 3100);
  wallLine(B, 10300, 2200, W_(), 2200, 10, [], { style: 'yardfence', ...S });
  wallLine(B, 10300, 3200, W_(), 3200, 10, [], { style: 'yardfence', ...S });
  // the locomotive on the main line, a caboose behind, the line running on east
  B.ob('bus', L.x, L.y, 360, 66, 0, { style: 'diesel', color: '#1f4a7a', label: 'live', section: 'mainline' });
  B.ob('bus', L.x - 300, L.y, 160, 62, 0, { style: 'caboose', color: '#a8261c', section: 'mainline' });
  B.ob('bus', 11100, YARD.main[1], 250, 62, 0, { style: 'boxcar', color: '#5a4a3a', section: 'mainline' });
  A.marks.push({ t: 'delta', x: 11800, y: 2560, a: Math.PI });
  A.marks.push({ t: 'catenary', x0: 3400, x1: 12000, y: 2705 });
  // fuel point by the line, drums, a relay cabinet
  B.ob('wall', 11500, 2380, 120, 60, 0, { style: 'fueltank', ...S });
  B.ob('wall', 10700, 3050, 60, 60, 0, { style: 'drums', ...S });
  for (const [x, y] of [[10700, 2300], [11600, 3100]]) {
    B.ob('pillar', x, y, 24, 24, 0, { style: 'mast', ...S });
    B.light(x, y, 520, '#ffb04a', 0, 360);
  }
  B.light(L.x + 150, L.y, 260, '#fff4d8', 0, 70);    // the loco's headlight

  B.anchor('locomotive', L.x - 120, L.y - 70, 110);
  B.anchor('line_gate', 10230, 2560, 120);
  B.checkpoint('mainline', 10420, 2600);
  B.checkpoint('mainline', 10420, 2800);
  B.zspawn(11900, 2400, 80, 200, 1.4, 'mainline');
  B.zspawn(11900, 3000, 80, 200, 1.4, 'mainline');
  B.zspawn(11300, 3120, 200, 60, 1, 'mainline');
}

function W_() { return 12000 - 40; }

void cliffLine;
