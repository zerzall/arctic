// Hollow Creek — story level (JOURNEY.md). Owner: agent C1.
//
// SPEC is the contract other parts depend on (the mission scripts, the engine, the tests): keep every
// section id (in this order), anchor name and gate id. The layout below is hand-built:
//
//   A small town the crew crosses east to west and back round: the county road in from the east past
//   the welcome sign, the rail crossing and the water tower to the barricade the town threw across its
//   entrance; Main Street west (the diner and the hardware store to walk through, the fountain square,
//   the Bijou's dead marquee, back alleys on both sides); the Rexall at the end of the street (its
//   grille, the looted front, the counter, the back room); out the back into the lot and through the
//   gate of St. Anne's churchyard (the nave, the bell tower, the graves); over the school fence into
//   Hollow Creek Elementary (the bus, the halls, the office, the gym, the portables' roof); and through
//   the police sally port into the station (booking, the cells, the armory, the lot) and out west.
//
//     x:  0          2600               5600              8400        11000
//   y=0   +-----------+--------+---------+-----------------+-----------+
//         |  school   |  church (St. Anne's)| (houses)       | outskirts |
//   2000  +-----------+--------+---------+-----------------+           |
//         |  police   |  pharmacy        |  mainstreet      |           |
//   4000  +-----------+------------------+-----------------+-----------+

import { artOf, prop, wall, wallGaps, room, fence, spawn, ob, dress, facade, HALF, PI } from './millroad.js';

export const SPEC = Object.freeze({
  "id": "hollowcreek",
  "name": "Hollow Creek",
  "chapter": 2,
  "time": "day",
  "owner": "C1",
  "description": "A small town gone quiet in broad daylight: the edge of town, Main Street and its diner, the pharmacy, St. Anne's church and bell tower, Hollow Creek Elementary and the police station.",
  "sections": [
    {
      "id": "outskirts",
      "name": "Town Line"
    },
    {
      "id": "mainstreet",
      "name": "Main Street"
    },
    {
      "id": "pharmacy",
      "name": "Rexall Pharmacy"
    },
    {
      "id": "church",
      "name": "St. Anne's"
    },
    {
      "id": "school",
      "name": "Hollow Creek Elementary"
    },
    {
      "id": "police",
      "name": "Police Station"
    }
  ],
  "anchors": {
    "outskirts": [
      "start",
      "welcome_sign",
      "water_tower"
    ],
    "mainstreet": [
      "main_diner",
      "main_hardware",
      "main_fountain",
      "main_barricade"
    ],
    "pharmacy": [
      "pharmacy_door",
      "pharmacy_counter",
      "pharmacy_back"
    ],
    "church": [
      "church_doors",
      "church_bell",
      "church_yard"
    ],
    "school": [
      "school_bus",
      "school_gym",
      "school_office",
      "school_roof"
    ],
    "police": [
      "police_lot",
      "police_armory",
      "police_cells",
      "police_exit"
    ]
  },
  "gates": [
    {
      "id": "main_barricade",
      "kind": "barricade",
      "from": "outskirts",
      "to": "mainstreet",
      "label": "The Main Street barricade"
    },
    {
      "id": "pharmacy_gate",
      "kind": "shutter",
      "from": "mainstreet",
      "to": "pharmacy",
      "label": "Pharmacy roll-down"
    },
    {
      "id": "church_gate",
      "kind": "gate",
      "from": "pharmacy",
      "to": "church",
      "label": "Churchyard gate"
    },
    {
      "id": "school_fence",
      "kind": "fence",
      "from": "church",
      "to": "school",
      "label": "School fence"
    },
    {
      "id": "police_gate",
      "kind": "bars",
      "from": "school",
      "to": "police",
      "label": "Police sally port"
    }
  ]
});

/** World size and mood (maps.js MAP_DEFS). */
export const DEF = { width: 11000, height: 4000, darkness: 0.6, tint: '#35465e', ground: '#48532f' };

const W = 11000, H = 4000;
const XE = 8400;     // the town's east edge (the barricade)
const XP = 4400;     // the pharmacy's front, Main Street's west end
const XW = 2600;     // school / church | police / pharmacy
const XC = 5600;     // the churchyard's east wall
const YN = 2000;     // the north half | the south half
const MY = 3000;     // Main Street's centre line
const HR = 130;      // half the street's width
const FRONT_N = MY - HR - 90, FRONT_S = MY + HR + 90;   // the two rows of shop fronts

const LOOK = {
  trees: ['oak', 'maple', 'oak', 'birch', 'maple', 'oak'],
  deciduous: 0.9,
  day: {
    // a clear, bright small-town afternoon: high sun from the south-west, crisp shadows, a light haze
    az: 125, el: 42, haze: '#c4d2dc', horizon: '#d8e4ec', zenith: '#2f6cc0', fog: 0.00021, cover: 0.38, heat: 0.12,
    ridge: '#62788a', wet: 0.08, sunColor: '#fff2d8', sunI: 4.6, hemiSky: '#b0c8ee', hemiGround: '#6f6a48', hemi: 0.9, exposure: 1.0, mist: 0.4,
  },
  night: {
    fog: '#0a0e16', horizon: '#121a28', zenith: '#02040a', sky: '#7488b0', ground: '#2a2824', moon: '#a4b8e0', moonI: 0.55, hemi: 0.85, fogDensity: 0.0012,
    grade: { saturation: 0.95, contrast: 1.08, lift: [0.008, 0.01, 0.02], gain: [1.03, 1.0, 0.98] },
  },
};

/**
 * Lay the level out.
 * @param {object} B map builder (maps.js createBuilder) with the level calls of JOURNEY.md §3
 */
export function build(B) {
  B.map.look = LOOK;
  artOf(B);
  B.section('outskirts', 'Town Line', (XE + W) / 2, H / 2, W - XE, H);
  B.section('mainstreet', 'Main Street', (XP + XE) / 2, (YN + H) / 2, XE - XP, H - YN);
  B.section('pharmacy', 'Rexall Pharmacy', (XW + XP) / 2, (YN + H) / 2, XP - XW, H - YN);
  B.section('church', "St. Anne's", (XW + XC) / 2, YN / 2, XC - XW, YN);
  B.section('school', 'Hollow Creek Elementary', XW / 2, YN / 2, XW, YN);
  B.section('police', 'Police Station', XW / 2, (YN + H) / 2, XW, H - YN);
  outskirts(B);
  mainstreet(B);
  houses(B);
  pharmacy(B);
  church(B);
  school(B);
  police(B);
}

// ---- 1. Town line -----------------------------------------------------------------------------------------

function outskirts(B) {
  const sec = 'outskirts';
  B.box('grass', XE, 0, W, H);
  B.box('dirt', 9860, 400, 10900, 1900);
  B.box('gravel', XE, MY - HR - 60, W, MY + HR + 60);
  B.box('asphalt', XE, MY - HR + 20, W, MY + HR - 20);
  B.box('gravel', 9620, 0, 9780, H);                  // the rail line's ballast
  B.line('yellow_double', XE, MY, W, MY, 3);
  for (const s of [-1, 1]) B.line('white', XE, MY + s * (HR - 30), W, MY + s * (HR - 30), 3);
  B.line('stop', 9500, MY + 20, 9500, MY + HR - 26, 6);
  B.line('stop', 9900, MY - HR + 26, 9900, MY - 20, 6);
  B.line('crosswalk', 9640, MY - HR + 20, 9640, MY + HR - 20, 20);
  prop(B, 'hc-rails', 9700, H / 2, HALF, { len: H + 200 });
  prop(B, 'hc-crossing', 9700, MY, 0);
  // freight cars stopped on the line north and south of the crossing (a gap where one is missing)
  for (const y of [2640, 2370, 2100, 1830, 1260, 990, 720, 450, 180]) ob(B, 'bus', y === 1830 ? 'hc-tankcar' : 'hc-boxcar', 9700, y, 250, 62, HALF, { sec, color: ['#7a3a2a', '#3a4a5a', '#6a5a3a', '#4a3a30'][Math.round(y / 270) % 4] });
  for (const y of [3360, 3630, 3900]) ob(B, 'bus', 'hc-boxcar', 9700, y, 250, 62, HALF, { sec, color: '#5a3a2a' });
  // the water tower, the welcome sign, the feed store, a farm
  for (const [dx, dy] of [[-44, -44], [44, -44], [44, 44], [-44, 44]]) ob(B, 'ipillar', 'nodraw', 9100 + dx, 1300 + dy, 12, 12, 0, { sec });
  prop(B, 'hc-watertower', 9100, 1300, 0);
  B.anchor('water_tower', 9100, 1460, 160);
  prop(B, 'hc-welcome', 10330, 3280, -HALF);
  ob(B, 'wall', 'nodraw', 10330, 3280, 20, 180, 0, { sec });
  B.anchor('welcome_sign', 10420, 3180, 150);
  facade(B, 8950, 3560, 360, 180, PI, 'industrial', { sec, color: '#8a8478', roof: '#5a5a58', top: 150, style: 'hc-feedstore' });
  facade(B, 10500, 1100, 240, 170, HALF, 'house', { sec, color: '#e0d8c8', roof: '#3a3a40', lit: 0.1 });
  facade(B, 10750, 1500, 200, 150, 0, 'barn', { sec, color: '#7d3a2c', roof: '#5a2b22' });
  B.ob('silo', 10900, 900, 80, 80, 0, { color: '#b8bcbf', section: sec });
  ob(B, 'counter', 'hc-farmstand', 10150, 2700, 140, 50, 0, { sec });
  // traffic heading into town, a sheriff's car into the sign
  for (const [k, x, y, a, wr] of [['car', 10700, MY - 60, PI, false], ['suv', 10480, MY + 55, PI + 0.3, true], ['pickup', 9300, MY - 50, PI - 0.1, false], ['car', 8950, MY + 70, PI + 0.5, true], ['van', 8750, MY - 55, PI, false]]) {
    B.vehicle(k, x, y, a, { wrecked: wr, jitter: 0.3 }).section = sec;
  }
  B.ob('car', 10250, 3380, 84, 42, 2.2, { color: '#1a1c22', section: sec, style: 'hc-cruiser', wrecked: true });
  B.fire(10240, 3370, 16);
  // the barricade across the town's entrance (the gate), and the fences either side of it
  fence(B, XE, 0, XE, YN, 'woodfence', [], { t: 16, sec: 'mainstreet' });
  wall(B, XE, YN, XE, MY - 150, 'junk', { t: 40, sec });
  wall(B, XE, MY + 150, XE, H, 'junk', { t: 40, sec });
  B.gate('main_barricade', 'barricade', XE, MY, 300, 40, HALF, { section: sec, label: 'The Main Street barricade', style: 'hc-barricade' });
  B.anchor('outskirts_barricade', XE + 140, MY - 20, 140);
  B.lamp(9500, MY - HR - 30, { a: HALF, r: 280, dead: false });
  B.lamp(10300, MY + HR + 30, { a: -HALF, r: 260 });
  B.lamp(8700, MY - HR - 30, { a: HALF, r: 280, dead: false });
  // the start: coming in along the county road from the east
  B.anchor('start', 10820, MY + 150, 170);
  for (let k = 0; k < 6; k++) B.pspawn(10760 + (k % 3) * 70, MY + 110 + Math.floor(k / 3) * 80);
  B.supply(10620, MY + 250);
  B.checkpoint(sec, 10700, MY + 230);
  B.checkpoint(sec, 9300, MY + 200);
  B.checkpoint(sec, 8650, MY + 190);
  spawn(B, sec, 9200, 300, 600, 200, 1);
  spawn(B, sec, 8800, 2200, 400, 400, 1.2);
  spawn(B, sec, 10200, 2300, 500, 300, 0.8);
  spawn(B, sec, 9200, 3850, 400, 100, 1);
  spawn(B, sec, 10400, 3850, 500, 100, 0.6);
}

// ---- 2. Main Street ------------------------------------------------------------------------------------------

function mainstreet(B) {
  const sec = 'mainstreet';
  // ground: the street, the sidewalks, the square, the back alleys
  B.box('concrete', XP, FRONT_N, XE, FRONT_S);
  B.box('asphalt', XP, MY - HR, XE, MY + HR);
  B.box('asphalt', XP, YN + 20, XE, FRONT_N - 300);
  B.box('asphalt', XP, FRONT_S + 300, XE, H);
  B.box('concrete', 6100, FRONT_N - 560, 6900, FRONT_N);
  B.line('yellow_double', XP + 40, MY, XE, MY, 3);
  for (let x = XP + 200; x < XE - 100; x += 90) B.line('parking', x, MY - HR, x, MY - HR + 50, 3);
  B.line('crosswalk', 6150, MY - HR, 6150, MY + HR, 30);
  B.line('crosswalk', 6850, MY - HR, 6850, MY + HR, 30);
  // the north back alley's fence and the south alley's end at the pharmacy
  fence(B, XP, YN, XE, YN, 'woodfence', [], { t: 16, sec });
  // ---- shop fronts: the north row faces south, the south row north (solid buildings, walk-in ones below)
  const dN = 300;
  const north = [[4400, 4850, 'apartment', '#7a4a3a', 230], [5350, 5750, 'hc-theater', '#6a3a3a', 200], [5750, 6100, 'shops', '#8a6a4a', 180], [7350, 7700, 'shops', '#6a5a4a', 190], [7800, 8100, 'shops', '#7a5040', 170], [8100, 8380, 'shops', '#8a7a60', 180]];
  for (const [x0, x1, arch, color, top] of north) {
    const st = arch.startsWith('hc-') ? arch : null;
    facade(B, (x0 + x1) / 2, FRONT_N - dN / 2, x1 - x0, dN, 0, st ? 'shops' : arch, { sec, color, roof: '#3a3634', top, style: st, lit: 0.12 });
  }
  const south = [[4400, 4900, 'shops', '#8a5a44', 190], [4900, 5300, 'shops', '#6a6a5a', 170], [5300, 5800, 'hc-postoffice', '#9a8a70', 180], [5900, 6350, 'shops', '#7a4a3a', 200], [6350, 6800, 'shops', '#8a7a60', 170], [6800, 7250, 'apartment', '#6a4a3a', 230], [7250, 7700, 'shops', '#8a6a4a', 180], [7800, 8380, 'shops', '#7a6a5a', 190]];
  for (const [x0, x1, arch, color, top] of south) {
    const st = arch.startsWith('hc-') ? arch : null;
    facade(B, (x0 + x1) / 2, FRONT_S + dN / 2, x1 - x0, dN, PI, st ? 'shops' : arch, { sec, color, roof: '#3a3634', top, style: st, lit: 0.12 });
  }
  // the alleys between the fronts end at a fence, so the back alleys are loops round the rows
  // ---- the hardware store (walk through): front door on the street, back door to the alley
  room(B, {
    x: 5050, y: FRONT_N - dN / 2, w: 400, h: dN, look: 'hardware', looks: { s: 'hwfront' }, sec, floor: 'garage',
    doors: { s: [[-40, 100, 'glass2']], n: [[120, 84, 'steel']] }, roof: { kind: 'industrial', height: 150, dark: 0.6 },
  });
  for (const x of [4950, 5070, 5190]) ob(B, 'cabinet', 'hc-hwshelf', x, FRONT_N - 170, 180, 32, HALF, { sec });
  ob(B, 'counter', 'hc-hwcounter', 4920, FRONT_N - 40, 120, 36, 0, { sec });
  prop(B, 'hc-hwstuff', 5050, FRONT_N - dN / 2, 0, { w: 400, h: dN });
  B.light(5050, FRONT_N - 150, 240, '#fff0d8', 0.2, 140);
  B.anchor('main_hardware', 5000, FRONT_N - 80, 110);
  // ---- the diner (walk through): booths along the windows, the counter and stools, the kitchen
  room(B, {
    x: 7125, y: FRONT_N - dN / 2, w: 450, h: dN, look: 'diner', looks: { s: 'dinerfront' }, sec, floor: 'lino-check',
    doors: { s: [[60, 100, 'glass2']], n: [[-150, 84, 'steel']] }, roof: { kind: 'office', height: 130, dark: 0.55 },
  });
  wallGaps(B, 6900, FRONT_N - 200, 7350, FRONT_N - 200, [[80, 170, 'wood'], [320, 400, null]], 'dinerint', { t: 10, side: 'both', sec });
  ob(B, 'counter', 'hc-dinercounter', 7190, FRONT_N - 150, 280, 30, 0, { sec });
  for (const x of [6960, 7040, 7290]) ob(B, 'desk', 'hc-booth', x, FRONT_N - 36, 60, 44, 0, { sec });
  prop(B, 'hc-dinerstuff', 7125, FRONT_N - dN / 2, 0, { w: 450, h: dN });
  B.light(7050, FRONT_N - 90, 220, '#ffe0b0', 0.3, 120);
  B.light(7200, FRONT_N - 250, 160, '#e8f0ff', 0.5, 110);
  B.anchor('main_diner', 7050, FRONT_N - 110, 110);
  // ---- the square: the fountain, the memorial, benches, trees
  ob(B, 'rock', 'hc-fountain', 6500, FRONT_N - 260, 180, 180, 0, { sec, color: '#a8a498' });
  B.anchor('main_fountain', 6500, FRONT_N - 90, 150);
  // the bandstand the town made its stand on (sandbags on the deck)
  ob(B, 'counter', 'hc-gazebo', 6640, FRONT_N - 470, 150, 150, 0, { sec });
  prop(B, 'hc-memorial', 6250, FRONT_N - 470, 0);
  ob(B, 'rock', 'nodraw', 6250, FRONT_N - 470, 40, 40, 0, { sec, color: '#888888' });
  for (const [x, y] of [[6180, FRONT_N - 120], [6820, FRONT_N - 120], [6820, FRONT_N - 470]]) B.tree(x, y, 1.1);
  for (const [x, y, a] of [[6330, FRONT_N - 60, 0], [6670, FRONT_N - 60, 0], [6150, FRONT_N - 300, HALF], [6850, FRONT_N - 300, -HALF]]) dress(B, 'bench', x, y, a);
  prop(B, 'hc-bunting', 6500, MY, HALF, { len: 2 * HR + 180, text: 'harvest' });
  prop(B, 'hc-bunting', 5200, MY, HALF, { len: 2 * HR + 180 });
  prop(B, 'hc-bunting', 7700, MY, HALF, { len: 2 * HR + 180 });
  // ---- the street: old lamps, parked cars on the north curb, a last stand at the west end
  for (let x = XP + 300; x < XE - 100; x += 420) {
    for (const s of [-1, 1]) {
      const y = MY + s * (HR + 40);
      prop(B, 'hc-lamp', x + (s > 0 ? 210 : 0), y, 0);
      B.light(x + (s > 0 ? 210 : 0), y, 240, '#ffd49a', (x / 420) % 3 === 0 ? 0.3 : 0, 150);
    }
  }
  for (const [k, x, a, wr] of [['car', 4700, PI, false], ['suv', 5500, PI + 0.05, false], ['car', 5900, PI, true], ['pickup', 7450, PI, false], ['car', 7900, PI - 0.05, false], ['van', 8150, PI, true]]) {
    B.vehicle(k, x, MY - HR + 26, a, { wrecked: wr, jitter: 0.2 }).section = sec;
  }
  B.vehicle('car', 6200, MY + 60, 0.4, { wrecked: true, jitter: 0 }).section = sec;
  // the town's last stand: sandbags and a car across the west end, the way round it on the south side
  B.vehicle('suv', 4640, MY - 70, HALF + 0.2, { wrecked: true, jitter: 0 }).section = sec;
  for (const [x, y, w, a] of [[4760, MY - 100, 110, HALF], [4690, MY - 190, 90, 0.2]]) B.ob('sandbags', x, y, w, 26, a, { section: sec });
  prop(B, 'hc-laststand', 4720, MY, 0);
  B.anchor('main_barricade', XE - 170, MY + 40, 150);
  prop(B, 'hc-barricadeback', XE, MY, HALF);
  // checkpoints and spawns (the back alleys, the alley gaps, the square's back)
  B.checkpoint(sec, 8100, MY + 60);
  B.checkpoint(sec, 6500, MY + 60);
  B.checkpoint(sec, 4900, MY + 90);
  spawn(B, sec, 7000, YN + 140, 800, 80, 1);
  spawn(B, sec, 5300, YN + 140, 700, 80, 1);
  spawn(B, sec, 6500, H - 100, 900, 80, 1);
  spawn(B, sec, 5000, H - 100, 600, 80, 1);
  spawn(B, sec, 7750, FRONT_S + 130, 60, 160, 0.8);
  spawn(B, sec, 5850, FRONT_S + 130, 60, 160, 0.8);
  spawn(B, sec, 5300, FRONT_N - 130, 60, 160, 0.8);
}

/** The houses behind Main Street's north row (the backdrop between the church and the town line). */
function houses(B) {
  const sec = 'mainstreet';
  B.box('grass', XC, 0, XE, YN);
  fence(B, XC, 0, XC, YN, 'hedge', [], { t: 20, sec: 'church' });
  const hs = [[6000, 500, 0], [6500, 460, 0], [7050, 520, 0], [7600, 480, 0], [8100, 500, 0], [6200, 1350, PI], [6800, 1400, PI], [7400, 1330, PI], [8000, 1380, PI]];
  hs.forEach(([x, y, a], i) => facade(B, x, y, 230 + (i % 3) * 20, 170, a, 'house', { sec, color: ['#e0d8c8', '#c8d0d8', '#e8dcc0', '#d0c8b8', '#b8c8b0'][i % 5], roof: ['#3a3a40', '#5a3a2a', '#3a4a3a'][i % 3], lit: 0.12 }));
  for (let i = 0; i < 14; i++) B.tree(5800 + (i % 7) * 380 + (i % 2) * 90, 900 + Math.floor(i / 7) * 180, 1.2);
  B.box('asphalt', XC + 40, 870, XE - 40, 1030);
}

// ---- 3. The Rexall -----------------------------------------------------------------------------------------------

function pharmacy(B) {
  const sec = 'pharmacy';
  const PX0 = 3450, PX1 = XP, PY0 = MY - 250, PY1 = MY + 250;
  const PXB = 3730;     // the stock room's partition
  const CX = (PX0 + PX1) / 2;
  B.box('asphalt', XW, YN + 20, XP, PY0 - 10);
  B.box('gravel', XW, PY0 - 10, PX0 - 10, H);
  B.box('asphalt', PX0 - 10, PY1 + 10, XP, H);
  for (let x = 2800; x < 4300; x += 90) B.line('parking', x, 2300, x, 2420, 3);
  B.line('white', 3500, 2560, 4300, 2560, 3);
  // the boundary with Main Street: the back alleys end in fences either side of the store's front
  fence(B, XP, YN, XP, PY0, 'woodfence', [], { t: 16, sec: 'mainstreet' });
  fence(B, XP, PY1, XP, H, 'woodfence', [], { t: 16, sec: 'mainstreet' });
  // the store: the grille over the front (the gate), the looted sales floor, the counter and the dispensary
  // behind it, the stock room at the back with the loading door out to the lot (the way on)
  room(B, {
    x: CX, y: MY, w: PX1 - PX0, h: PY1 - PY0, look: 'pharm', looks: { e: 'pharmfront' }, sec,
    doors: { e: [[0, 220, 'grille']], n: [[3590 - CX, 170, 'rollup']], s: [[4150 - CX, 84, 'steel']] }, roof: { kind: 'office', height: 130, dark: 0.62 },
  });
  artOf(B).floors.push({ x: (PXB + PX1) / 2, y: MY, w: PX1 - PXB - 12, h: PY1 - PY0 - 12, a: 0, look: 'lino', sec });
  artOf(B).floors.push({ x: (PX0 + PXB) / 2, y: MY, w: PXB - PX0 - 12, h: PY1 - PY0 - 12, a: 0, look: 'garage', sec });
  B.area('concrete', CX, MY, PX1 - PX0 - 12, PY1 - PY0 - 12, 0);
  B.gate('pharmacy_gate', 'shutter', XP, MY, 220, 16, HALF, { section: 'mainstreet', label: 'Pharmacy roll-down', style: 'hc-grille' });
  wallGaps(B, PXB, PY0, PXB, PY1, [[160, 340, 'swing']], 'pharmint', { t: 10, side: 'both', sec });
  // the sales floor: wall shelving north, a gondola, the counter (south-west) with the bins behind it, the till by the door
  ob(B, 'cabinet', 'hc-wallshelf', 4060, PY0 + 20, 560, 24, 0, { sec });
  ob(B, 'cabinet', 'hc-gondola', 4120, MY - 140, 330, 34, 0, { sec });
  ob(B, 'counter', 'hc-pcounter', 3850, MY + 120, 220, 34, 0, { sec });
  ob(B, 'cabinet', 'hc-bins', 3860, PY1 - 20, 240, 24, 0, { sec });
  ob(B, 'counter', 'hc-till', 4320, MY + 190, 100, 34, HALF, { sec });
  prop(B, 'hc-pstuff', (PXB + PX1) / 2, MY, 0, { w: PX1 - PXB, h: PY1 - PY0 });
  // the stock room: racks along the west wall, the drug safe, pallets
  ob(B, 'cabinet', 'hc-rack', PX0 + 28, MY - 60, 280, 36, HALF, { sec });
  ob(B, 'cabinet', 'hc-drugsafe', PX0 + 40, PY1 - 50, 60, 50, 0, { sec });
  ob(B, 'counter', 'hc-pallet', 3640, PY1 - 50, 70, 60, 0.1, { sec });
  prop(B, 'hc-stock', (PX0 + PXB) / 2, MY, 0, { w: PXB - PX0, h: PY1 - PY0 });
  B.light(4200, MY, 220, '#e8f0ff', 0.4, 125);
  B.light(3900, MY + 150, 160, '#e8f0ff', 0, 125);
  B.light(3590, MY + 60, 160, '#ffd9a0', 0.2, 110);
  B.anchor('pharmacy_door', XP + 90, MY + 40, 120);
  B.anchor('pharmacy_counter', 3880, MY + 60, 90);
  B.anchor('pharmacy_back', 3590, MY + 120, 80);
  // the lot behind it: the bank and the laundromat, a delivery van, dumpsters; the churchyard gate north
  facade(B, 2950, 3200, 420, 500, -HALF, 'office', { sec, color: '#b8ae9c', roof: '#4a4846', top: 190, style: 'hc-bank', lit: 0.1 });
  facade(B, 3700, 3720, 420, 240, PI, 'shops', { sec, color: '#8a9aa0', roof: '#3a3c40', top: 160, style: 'hc-laundromat', lit: 0.15 });
  B.vehicle('van', 3200, 2560, 0.1, { color: '#e8e4dc', jitter: 0 }).section = sec;
  B.vehicle('car', 3900, 2360, HALF, { jitter: 0.2 }).section = sec;
  B.vehicle('car', 4000, 3400, 0.4, { wrecked: true, jitter: 0.2 }).section = sec;
  for (const [x, y] of [[4330, 2420], [4330, 2490]]) B.ob('container', x, y, 64, 36, HALF, { color: '#2e5d3a', roof: '#294f33', section: sec });
  prop(B, 'hc-pharmsign', XP + 6, MY, 0);
  // the boundary with the police station (west)
  fence(B, XW, YN, XW, H, 'brickwall', [], { t: 24, sec });
  B.lamp(3300, 2300, { a: 0, r: 280, dead: false });
  B.lamp(3300, 3800, { a: 0, r: 260 });
  B.checkpoint(sec, 4150, MY - 20);
  B.checkpoint(sec, 3590, 2610);
  B.checkpoint(sec, 3420, 2160);
  spawn(B, sec, 2750, 2150, 200, 180, 1);
  spawn(B, sec, 2800, 3750, 250, 300, 1);
  spawn(B, sec, 4200, 3880, 300, 100, 0.8);
  spawn(B, sec, 3300, 2450, 200, 60, 0.6);
}

// ---- 4. St. Anne's -------------------------------------------------------------------------------------------------

function church(B) {
  const sec = 'church';
  B.box('grass', XW, 0, XC, YN);
  B.box('gravel', 3340, 1520, 3500, YN);          // path from the gate
  B.box('gravel', 3500, 1480, 4400, 1620);
  B.box('gravel', 4420, 250, 4520, 1700);         // the graveyard's paths
  B.box('gravel', 4420, 950, 5450, 1040);
  // the churchyard wall along the lot, its gate (the gate), the hedge to the houses (east)
  fence(B, XW, YN, XC, YN, 'stonewall', [[3300 - XW, 3540 - XW, null]], { t: 24, sec: 'pharmacy' });
  B.gate('church_gate', 'gate', 3420, YN, 240, 20, 0, { section: 'pharmacy', label: 'Churchyard gate', style: 'hc-irongate' });
  prop(B, 'hc-gateposts', 3420, YN, 0, { w: 240 });
  // the nave: front doors south, a side door west into the tower, a door east to the graves
  const NX0 = 3700, NX1 = 4200, NY0 = 380, NY1 = 1400;
  room(B, {
    x: (NX0 + NX1) / 2, y: (NY0 + NY1) / 2, w: NX1 - NX0, h: NY1 - NY0, look: 'nave', sec, floor: 'wood',
    doors: { s: [[0, 110, 'wood2']], w: [[400, 84, 'wood']], e: [[-150, 84, 'wood']] }, roof: { kind: 'house', height: 170, dark: 0.7, style: 'hc-nave' }, t: 16,
  });
  // the bell tower against the nave's west wall, its own door south
  room(B, {
    x: 3600, y: 1300, w: 200, h: 200, look: 'tower', sec, floor: 'stone', skip: ['e'],
    doors: { s: [[0, 80, 'wood']] }, roof: { kind: 'plain', height: 160, dark: 0.75, style: 'hc-steeple' }, t: 16,
  });
  // pews in two blocks, the altar and its rail, the pulpit
  for (let y = 620; y <= 1260; y += 64) {
    for (const x of [3830, 4070]) ob(B, 'desk', 'hc-pew', x, y, 150, 22, 0, { sec });
  }
  ob(B, 'counter', 'hc-altar', 3950, 470, 140, 40, 0, { sec });
  prop(B, 'hc-nave', 3950, 890, 0, { w: NX1 - NX0, h: NY1 - NY0 });
  prop(B, 'hc-bell', 3600, 1300, 0);
  B.light(3950, 480, 200, '#ffb860', 0.6, 60);
  B.light(3950, 1000, 260, '#ffd8a0', 0.3, 150);
  B.light(3600, 1300, 150, '#ffc070', 0.5, 70);
  B.anchor('church_doors', 3950, 1500, 130);
  B.anchor('church_bell', 3600, 1260, 70);
  // the graves, a mausoleum, the old oak; the rectory
  let gi = 0;
  for (let x = 4600; x <= 5460; x += 70) {
    for (let y = 300; y <= 1800; y += 90) {
      if (Math.abs(y - 995) < 80 || (x > 4950 && x < 5250 && y > 350 && y < 700)) continue;
      if ((gi++ * 7) % 11 === 3) continue;
      B.ob('grave', x + B.rng.range(-6, 6), y + B.rng.range(-6, 6), 24, 10, B.rng.range(-0.08, 0.08), { color: B.rng.pick(['#8e8c86', '#9a968c', '#7a7870']), section: sec });
    }
  }
  ob(B, 'building', 'hc-mausoleum', 5100, 520, 150, 110, PI, { sec, color: '#a8a498' });
  B.tree(4540, 1850, 1.4);
  B.tree(5480, 120, 1.3);
  B.tree(2800, 1700, 1.2);
  facade(B, 3000, 480, 260, 180, HALF, 'house', { sec, color: '#d8d0c0', roof: '#3a3a40', lit: 0.2 });
  B.anchor('church_yard', 4900, 1000, 170);
  prop(B, 'hc-churchsign', 3700, 1880, 0);
  // lamps along the path, candles by the doors
  B.lamp(3280, 1700, { a: 0, r: 260 });
  B.lamp(4480, 1100, { a: PI, r: 260, dead: false });
  B.checkpoint(sec, 3420, 1800);
  B.checkpoint(sec, 3950, 1620);
  B.checkpoint(sec, 3000, 1100);
  spawn(B, sec, 4900, 100, 700, 70, 1);
  spawn(B, sec, 3950, 150, 400, 150, 1);
  spawn(B, sec, 2750, 150, 200, 200, 1);
  spawn(B, sec, 5100, 1920, 500, 50, 0.8);
}

// ---- 5. Hollow Creek Elementary -----------------------------------------------------------------------------------

function school(B) {
  const sec = 'school';
  B.box('grass', 0, 0, XW, YN);
  B.box('asphalt', 600, 780, 2400, 1020);         // the bus loop
  B.box('concrete', 1150, 650, 1450, 780);         // the entrance plaza
  B.box('asphalt', 250, 1180, 950, 1650);          // the court
  B.box('concrete', 1500, 1150, 2450, 1850);       // the playground
  B.line('white', 600, 1415, 950, 1415, 3);
  for (let x = 800; x < 2300; x += 100) B.line('parking', x, 790, x, 850, 3);
  // the school fence to the churchyard (with the panel the crew cuts), and the police compound's fence
  fence(B, XW, YN, XW, 0, 'chain', [[1000, 1200, null]], { sec: 'church' });
  B.gate('school_fence', 'fence', XW, 900, 200, 16, HALF, { section: 'church', label: 'School fence', style: 'hc-schoolpanel' });
  fence(B, 0, YN, XW, YN, 'chainslat', [[1100, 1340, null]], { sec });
  B.gate('police_gate', 'bars', 1220, YN, 240, 24, 0, { section: 'school', label: 'Police sally port', style: 'hc-sallybars' });
  prop(B, 'hc-sallyframe', 1220, YN, 0, { w: 240 });
  // ---- the school: the gym (west), halls, classrooms, the office by the front doors
  const SX0 = 400, SX1 = 2200, SY0 = 150, SY1 = 650;
  const HY0 = 380, HY1 = 520;   // the hall
  room(B, {
    x: (SX0 + SX1) / 2, y: (SY0 + SY1) / 2, w: SX1 - SX0, h: SY1 - SY0, look: 'school', sec,
    doors: { s: [[-620, 90, 'steel'], [-160, 110, 'glass2']], e: [[50, 90, 'steel']], n: [[-600, 84, 'steel']] }, roof: false, t: 14,
  });
  // the gym: its wall to the hall with double doors
  wallGaps(B, 900, SY0, 900, SY1, [[260, 370, 'wood2']], 'gymwall', { t: 12, side: 'both', sec });
  // the hall's two walls with the classroom and office doors
  wallGaps(B, 900, HY0, SX1, HY0, [[150, 234, 'wood'], [550, 634, 'wood'], [950, 1034, 'wood']], 'schoolint', { t: 12, side: 'both', sec });
  wallGaps(B, 900, HY1, SX1, HY1, [[80, 164, 'wood'], [270, 450, null], [700, 784, 'wood'], [1050, 1134, 'wood']], 'schoolint', { t: 12, side: 'both', sec });
  for (const x of [1300, 1700]) wall(B, x, SY0, x, HY0, 'schoolint', { t: 12, side: 'both', sec });
  for (const x of [1170, 1700]) wall(B, x, HY1, x, SY1, 'schoolint', { t: 12, side: 'both', sec });
  artOf(B).floors.push({ x: 650, y: 400, w: 490, h: 490, a: 0, look: 'gym', sec });
  artOf(B).floors.push({ x: 1550, y: 450, w: 1290, h: 490, a: 0, look: 'lino', sec });
  B.area('concrete', 1300, 400, 1790, 490, 0);
  B.roof(650, 400, 514, 514, 0, { kind: 'industrial', height: 150, section: sec, dark: 0.6 });
  B.roof(1550, 400, 1314, 514, 0, { kind: 'office', height: 120, section: sec, dark: 0.65 });
  // hall lockers, classroom desks, the office counter and desks, the gym's bleachers
  for (const x of [1050, 1500, 1950]) ob(B, 'cabinet', 'hc-lockers', x, HY0 + 16, 140, 20, 0, { sec });
  for (const [x0, x1] of [[900, 1300], [1300, 1700], [1700, 2200]]) prop(B, 'hc-classroom', (x0 + x1) / 2, (SY0 + HY0) / 2, 0, { w: x1 - x0, h: HY0 - SY0 });
  ob(B, 'counter', 'hc-officecounter', 1440, 560, 150, 30, 0, { sec });
  prop(B, 'hc-office', (1170 + 1700) / 2, (HY1 + SY1) / 2, 0, { w: 530, h: SY1 - HY1 });
  ob(B, 'cabinet', 'hc-bleachers', 650, 200, 400, 60, 0, { sec });
  prop(B, 'hc-gym', 650, 400, 0, { w: 490, h: 490 });
  prop(B, 'hc-hall', (900 + SX1) / 2, (HY0 + HY1) / 2, 0, { w: SX1 - 900, h: HY1 - HY0 });
  for (const [x, y, c] of [[650, 400, '#fff4e0'], [1100, 450, '#e8f0ff'], [1700, 450, '#e8f0ff'], [1450, 580, '#fff0d8'], [1500, 260, '#e8f0ff']]) B.light(x, y, 220, c, 0.35, 110);
  B.anchor('school_gym', 700, 470, 150);
  B.anchor('school_office', 1330, 590, 70);
  // ---- outside: the bus in the loop, the flag, the sign, the portables (their roof), the court, the playground
  ob(B, 'bus', 'hc-schoolbus', 1500, 900, 250, 62, 0.04, { sec, color: '#e3a41a' });
  B.anchor('school_bus', 1500, 1030, 150);
  prop(B, 'hc-schoolsign', 2470, 1140, -HALF);
  prop(B, 'hc-flag', 1280, 720, 0);
  for (const x of [700, 980]) ob(B, 'container', 'hc-portable', x, 1780, 240, 110, 0, { sec, color: '#d8d0bc' });
  ob(B, 'container', 'hc-dumpster', 1180, 1760, 64, 36, HALF, { sec, color: '#2e5d3a' });
  B.anchor('school_roof', 1180, 1690, 90);
  for (const x of [320, 880]) prop(B, 'hc-hoop', x, 1415, x < 600 ? 0 : PI);
  prop(B, 'mr-playground', 1950, 1500, 0);
  for (let i = 0; i < 6; i++) B.tree(80 + i * 60, 300 + i * 260, 1.1);
  B.lamp(1000, 1080, { a: -HALF, r: 280, dead: false });
  B.lamp(2000, 1080, { a: -HALF, r: 280 });
  B.checkpoint(sec, 2400, 900);
  B.checkpoint(sec, 1900, 1100);
  B.checkpoint(sec, 900, 1100);
  spawn(B, sec, 1300, 60, 1600, 70, 1);
  spawn(B, sec, 55, 1100, 90, 600, 1);
  spawn(B, sec, 2350, 1950, 400, 60, 0.8);
  spawn(B, sec, 1500, 1920, 400, 50, 0.8);
}

// ---- 6. The police station -------------------------------------------------------------------------------------------

function police(B) {
  const sec = 'police';
  B.box('asphalt', 0, 2010, XW - 20, 2330);         // the sally port yard
  B.box('asphalt', 0, 3000, XW - 20, 3520);         // the front lot
  B.box('asphalt', 0, 3590, XW - 20, 3830);         // the road out west
  B.line('yellow_double', 0, 3710, XW - 20, 3710, 3);
  for (let x = 200; x < 2400; x += 95) B.line('parking', x, 3010, x, 3130, 3);
  // the station: booking, the cell block, the armory, the hall, the bullpen, the lobby and front doors
  const SX0 = 600, SX1 = 2000, SY0 = 2340, SY1 = 2940, HY0 = 2620, HY1 = 2740;
  room(B, {
    x: (SX0 + SX1) / 2, y: (SY0 + SY1) / 2, w: SX1 - SX0, h: SY1 - SY0, look: 'police', sec, floor: 'lino',
    doors: { n: [[-50, 96, 'steel']], s: [[350, 120, 'glass2']], w: [[160, 84, 'steel']] }, roof: { kind: 'office', height: 125, dark: 0.66 }, t: 14,
  });
  wallGaps(B, SX0, HY0, SX1, HY0, [[200, 284, 'steel'], [660, 750, 'steel'], [1080, 1170, 'bars']], 'policeint', { t: 12, side: 'both', sec });
  wallGaps(B, SX0, HY1, SX1, HY1, [[300, 384, 'wood'], [760, 1300, null]], 'policeint', { t: 12, side: 'both', sec });
  for (const x of [1100, 1450]) wall(B, x, SY0, x, HY0, 'policeint', { t: 12, side: 'both', sec });
  wall(B, 1300, HY1, 1300, SY1, 'policeint', { t: 12, side: 'both', sec });
  // the cells: bar fronts with their doors hanging open
  for (const [x0, x1] of [[606, 760], [760, 930], [930, 1094]]) wallGaps(B, x0, 2500, x1, 2500, [[(x1 - x0) / 2 - 36, (x1 - x0) / 2 + 36, 'cell']], 'bars', { t: 10, side: 'both', sec });
  for (const x of [760, 930]) wall(B, x, SY0, x, 2500, 'policeint', { t: 12, side: 'both', sec });
  prop(B, 'hc-cells', 850, 2420, 0);
  ob(B, 'cabinet', 'hc-gunrack', 1725, SY0 + 22, 440, 26, 0, { sec });
  ob(B, 'cabinet', 'hc-gunrack', 1990 - 14, 2480, 180, 22, HALF, { sec });
  prop(B, 'hc-armory', 1725, 2480, 0);
  ob(B, 'counter', 'hc-booking', 1275, 2500, 200, 32, 0, { sec });
  ob(B, 'counter', 'hc-frontdesk', 1650, 2810, 240, 36, 0, { sec });
  for (const [x, y] of [[750, 2800], [950, 2800], [1150, 2800], [850, 2890]]) ob(B, 'desk', 'hc-copdesk', x, y, 80, 44, 0, { sec });
  prop(B, 'hc-station', (SX0 + SX1) / 2, (SY0 + SY1) / 2, 0, { w: SX1 - SX0, h: SY1 - SY0 });
  for (const [x, y, c, f] of [[850, 2480, '#e8f0ff', 0.6], [1275, 2480, '#e8f0ff', 0], [1725, 2480, '#ff4030', 0.2], [1300, 2680, '#e8f0ff', 0.5], [950, 2840, '#e8f0ff', 0], [1650, 2840, '#fff0d8', 0]]) B.light(x, y, 200, c, f, 110);
  B.anchor('police_cells', 850, 2570, 70);
  B.anchor('police_armory', 1725, 2530, 90);
  // the sally port yard: a transport van, the bay; the front lot: cruisers, the flag, the sign
  ob(B, 'van', 'hc-copvan', 1500, 2200, 104, 50, 0.1, { sec, color: '#1a1c22' });
  for (const [x, a, wr] of [[400, HALF, false], [590, HALF + 0.1, true], [1000, HALF, false], [2100, HALF - 0.1, false]]) ob(B, 'car', 'hc-cruiser', x, 3070, 84, 42, a, { sec, color: '#1a1c22', wrecked: wr });
  B.fire(590, 3070, 16);
  prop(B, 'hc-policesign', 1900, 3000, 0);
  prop(B, 'hc-flag', 1500, 2990, 0);
  B.anchor('police_lot', 1250, 3250, 170);
  B.anchor('police_exit', 160, 3710, 140);
  for (const [k, x, y, a] of [['car', 1200, 3660, PI], ['suv', 2200, 3760, PI + 0.2]]) B.vehicle(k, x, y, a, { jitter: 0.2 }).section = sec;
  B.lamp(800, 3560, { a: HALF, r: 280, dead: false });
  B.lamp(1800, 3560, { a: HALF, r: 280 });
  B.lamp(1300, 2250, { a: 0, r: 260, dead: false });
  B.checkpoint(sec, 1220, 2150);
  B.checkpoint(sec, 1300, 3250);
  B.checkpoint(sec, 400, 3700);
  spawn(B, sec, 300, 2150, 350, 200, 1);
  spawn(B, sec, 2400, 2300, 250, 450, 1);
  spawn(B, sec, 2400, 3700, 300, 200, 1);
  spawn(B, sec, 1300, 3940, 1400, 60, 1);
  spawn(B, sec, 300, 2600, 300, 400, 0.8);
}
