// Blackpine Forest — story level (JOURNEY.md). Owner: agent C1.
//
// SPEC is the contract other parts depend on (the mission scripts, the engine, the tests): keep every
// section id (in this order), anchor name and gate id. The layout below is hand-built:
//
//   A morning walk east through the state forest in the fog: from the trailhead lot at the end of the county
//   road (the map board, the car someone left with its doors open) through the log gate of Blackpine
//   Campground (the loop of sites, the RV, the shower block, the campfire circle in the middle); through the
//   chain-link of the ranger compound (the station and its radio, the fire lookout high over the trees, the
//   ranger's truck, the helipad); down past the rockfall into Cutter's Gorge (the river in its canyon, the
//   road bridge down, the swinging footbridge and its winch); up through the gate of Harlan Lumber (the log
//   decks, the saw hall, the wigwam burner, the office, the log pond) to the board fence of the Harlan farm
//   and its signal.
//
//     x:  0       1800          4600          6800          8900          10900   12000
//         | trail-  | campground   | ranger       | gorge  ~~   | lumber mill  | farm  |
//         | head    |              |              |       river |              |       |

import { artOf, prop, wall, wallGaps, room, fence, spawn, ob, dress, facade, HALF, PI } from './millroad.js';

export const SPEC = Object.freeze({
  "id": "forest",
  "name": "Blackpine Forest",
  "chapter": 5,
  "time": "day",
  "owner": "C1",
  "description": "Morning fog in the pines: a trailhead, a campground, the ranger station and fire lookout, a river gorge with a swinging footbridge, a dead lumber mill and the fence of the Harlan farm.",
  "sections": [
    {
      "id": "trailhead",
      "name": "Trailhead"
    },
    {
      "id": "campground",
      "name": "Blackpine Campground"
    },
    {
      "id": "ranger",
      "name": "Ranger Station"
    },
    {
      "id": "gorge",
      "name": "Cutter's Gorge"
    },
    {
      "id": "lumbermill",
      "name": "Harlan Lumber"
    },
    {
      "id": "farmgate",
      "name": "The Farm Fence"
    }
  ],
  "anchors": {
    "trailhead": [
      "start",
      "trail_map",
      "trail_car"
    ],
    "campground": [
      "camp_fire",
      "camp_rv",
      "camp_showers"
    ],
    "ranger": [
      "ranger_radio",
      "ranger_lookout",
      "ranger_truck"
    ],
    "gorge": [
      "gorge_bridge",
      "gorge_winch",
      "gorge_far"
    ],
    "lumbermill": [
      "mill_saw",
      "mill_yard",
      "mill_office"
    ],
    "farmgate": [
      "farm_gate",
      "farm_signal"
    ]
  },
  "gates": [
    {
      "id": "camp_gate",
      "kind": "gate",
      "from": "trailhead",
      "to": "campground",
      "label": "Campground gate"
    },
    {
      "id": "ranger_gate",
      "kind": "fence",
      "from": "campground",
      "to": "ranger",
      "label": "Ranger compound"
    },
    {
      "id": "gorge_rubble",
      "kind": "rubble",
      "from": "ranger",
      "to": "gorge",
      "label": "Rockfall"
    },
    {
      "id": "mill_gate",
      "kind": "gate",
      "from": "gorge",
      "to": "lumbermill",
      "label": "Mill gate"
    },
    {
      "id": "farm_fence",
      "kind": "fence",
      "from": "lumbermill",
      "to": "farmgate",
      "label": "Farm fence"
    }
  ]
});

/** World size and mood (maps.js MAP_DEFS). */
export const DEF = { width: 12000, height: 4000, darkness: 0.62, tint: '#3a4a60', ground: '#3f4a33' };

const W = 12000, H = 4000;
const X1 = 1800, X2 = 4600, X3 = 6800, X4 = 8900, X5 = 10900;
const RIVER = [7600, 7800];      // the river's banks (x)
const BRIDGE = [1915, 2085];     // the footbridge (y): the gap in the water
const CW = [7450, 7950];         // the gorge's cliff walls (x)

const LOOK = {
  trees: ['pine', 'spruce', 'pine', 'spruce', 'pine', 'dead', 'spruce', 'birch'],
  deciduous: 0.12,
  day: {
    // a cold, still morning: the sun low in the east through fog lying in the trees
    az: 18, el: 11, warm: 0.85, haze: '#c6ccc8', horizon: '#d4d8d2', zenith: '#6a8aa8', fog: 0.00052, cover: 0.55, heat: 0,
    ridge: '#4a5a52', wet: 0.35, sunColor: '#ffe2b8', sunI: 3.2, hemiSky: '#b8c4cc', hemiGround: '#4a5038', hemi: 1.0, exposure: 1.02, mist: 1.0,
  },
  night: {
    fog: '#070a0e', horizon: '#0e141c', zenith: '#020306', sky: '#5a6a88', ground: '#20241c', moon: '#a8b8d8', moonI: 0.45, hemi: 0.8, fogDensity: 0.0016,
    grade: { saturation: 0.85, contrast: 1.1, lift: [0.006, 0.01, 0.014], gain: [0.98, 1.0, 1.03] },
  },
};

// ---- helpers ---------------------------------------------------------------------------------------------

/** The level's trail/road polylines (kept clear of trees) and clearings. */
function keepOf(B) {
  const art = artOf(B);
  if (!art.keep) art.keep = { paths: [], clear: [], rects: [] };
  return art.keep;
}

/** A trail or road along points, `w` wide, of ground `kind` (segments of oriented areas, round joints). */
function trail(B, pts, w, kind = 'dirt') {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    B.area(kind, (ax + bx) / 2, (ay + by) / 2, len + w * 0.5, w, Math.atan2(by - ay, bx - ax));
    keepOf(B).paths.push([ax, ay, bx, by, w]);
  }
}

/** A clearing (no trees): a circle, or a rectangle x0, y0, x1, y1. */
function clearing(B, x, y, r) {
  keepOf(B).clear.push([x, y, r]);
}
function clearRect(B, x0, y0, x1, y1) {
  keepOf(B).rects.push([x0, y0, x1, y1]);
}

function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2));
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

/**
 * Fill a rectangle with forest: a jittered grid of trees (cell `step`, chance `p`), none on the trails,
 * in the clearings, in water or on anything already built.
 */
function forest(B, x0, y0, x1, y1, step = 150, p = 0.55) {
  const k = keepOf(B);
  const r = B.rng;
  const m = B.map;
  for (let x = x0 + step / 2; x < x1; x += step) {
    for (let y = y0 + step / 2; y < y1; y += step) {
      if (!r.chance(p)) continue;
      const tx = x + r.range(-step * 0.4, step * 0.4), ty = y + r.range(-step * 0.4, step * 0.4);
      if (tx < x0 + 20 || tx > x1 - 20 || ty < 20 || ty > H - 20) continue;
      if (k.paths.some(([ax, ay, bx, by, w]) => segDist(tx, ty, ax, ay, bx, by) < w / 2 + 40)) continue;
      if (k.clear.some(([cx, cy, cr]) => Math.hypot(tx - cx, ty - cy) < cr)) continue;
      if (k.rects.some(([ax, ay, bx, by]) => tx > ax && tx < bx && ty > ay && ty < by)) continue;
      // (checkpoints, anchors, spawn rectangles and player spawns stay on open ground)
      if (m.checkpoints.some((c) => Math.hypot(tx - c.x, ty - c.y) < 70)) continue;
      if (Object.values(m.anchors).some((c) => Math.hypot(tx - c.x, ty - c.y) < 70)) continue;
      if (m.playerSpawns.some((c) => Math.hypot(tx - c.x, ty - c.y) < 60)) continue;
      // (nor indoors, nor in front of a doorway)
      if ((m.roofs || []).some((q) => Math.abs(tx - q.x) < q.w / 2 + 40 && Math.abs(ty - q.y) < q.h / 2 + 40)) continue;
      if (artOf(B).doors.some((d) => Math.hypot(tx - d.x, ty - d.y) < d.w / 2 + 110)) continue;
      if (m.zombieSpawns.some((z) => Math.abs(tx - z.x) < z.w / 2 + 30 && Math.abs(ty - z.y) < z.h / 2 + 30)) continue;
      if (B.inWater(tx, ty, 30) || B.blockedAt(tx, ty, 34)) continue;
      B.tree(tx, ty, r.range(0.9, 1.6));
    }
  }
}

/** A ridge of rock (a wall the art draws as a cliff), with gaps. */
function cliff(B, x1, y1, x2, y2, gaps = [], o = {}) {
  return wallGaps(B, x1, y1, x2, y2, gaps, o.look || 'cliff', { t: o.t || 60, maxLen: 500, sec: o.sec, side: 'out' });
}

// ---- the level -------------------------------------------------------------------------------------------

/**
 * Lay the level out.
 * @param {object} B map builder (maps.js createBuilder) with the level calls of JOURNEY.md §3
 */
export function build(B) {
  B.map.look = LOOK;
  artOf(B);
  B.section('trailhead', 'Trailhead', X1 / 2, H / 2, X1, H);
  B.section('campground', 'Blackpine Campground', (X1 + X2) / 2, H / 2, X2 - X1, H);
  B.section('ranger', 'Ranger Station', (X2 + X3) / 2, H / 2, X3 - X2, H);
  B.section('gorge', "Cutter's Gorge", (X3 + X4) / 2, H / 2, X4 - X3, H);
  B.section('lumbermill', 'Harlan Lumber', (X4 + X5) / 2, H / 2, X5 - X4, H);
  B.section('farmgate', 'The Farm Fence', (X5 + W) / 2, H / 2, W - X5, H);
  B.box('grass', 0, 0, W, H);
  trailhead(B);
  campground(B);
  ranger(B);
  gorge(B);
  lumbermill(B);
  farm(B);
  // the forest last, round everything built
  forest(B, 0, 0, X1, H, 150, 0.6);
  forest(B, X1, 0, X2, H, 160, 0.55);
  forest(B, X2, 0, X3, H, 160, 0.55);
  forest(B, X3, 0, CW[0], H, 150, 0.5);
  forest(B, CW[1], 0, X4, H, 150, 0.5);
  forest(B, X4, 0, X5, H, 190, 0.35);
  forest(B, X5, 0, W, H, 220, 0.3);
}

// ---- 1. The trailhead ----------------------------------------------------------------------------------------

function trailhead(B) {
  const sec = 'trailhead';
  // the county road in from the south, the lot at its end, the camp road east
  B.box('asphalt', 560, 2950, 740, H);
  B.line('yellow_double', 650, 3000, 650, H, 3);
  keepOf(B).paths.push([650, 2950, 650, H, 180]);
  B.box('gravel', 380, 2330, 1520, 2960);
  clearing(B, 950, 2640, 640);
  trail(B, [[1450, 2620], [1800, 2600], [2400, 2600]], 190, 'dirt');
  for (let x = 460; x < 1460; x += 70) prop(B, 'bp-wheelstop', x, 2350, 0);
  // the car someone left with its doors open, the others
  B.vehicle('suv', 900, 2460, HALF + 0.08, { color: '#7a2a24', jitter: 0 }).section = sec;
  prop(B, 'bp-opencar', 900, 2460, HALF + 0.08);
  B.anchor('trail_car', 900, 2610, 120);
  B.vehicle('pickup', 1180, 2440, HALF - 0.1, { color: '#3a4a5a', jitter: 0.2 }).section = sec;
  B.vehicle('car', 600, 2470, HALF + 0.2, { wrecked: true, jitter: 0.2 }).section = sec;
  B.vehicle('car', 470, 3300, -HALF + 0.3, { wrecked: true, jitter: 0.2 }).section = sec;
  // the map board, the vault toilet, the bear-proof bins, the trail sign
  ob(B, 'wall', 'bp-kiosk', 1300, 2780, 90, 20, 0, { sec });
  B.anchor('trail_map', 1300, 2700, 110);
  facade(B, 470, 2200, 110, 90, 0, 'shack', { sec, color: '#6a5038', roof: '#3a3a34', style: 'bp-outhouse', top: 110 });
  for (const x of [700, 760]) ob(B, 'cabinet', 'bp-bearbin', x, 2270, 44, 30, 0, { sec });
  prop(B, 'bp-trailsign', 1560, 2740, 0, { text: 'camp' });
  prop(B, 'bp-forestsign', 760, 3500, HALF);
  ob(B, 'wall', 'nodraw', 760, 3500, 16, 120, 0, { sec });
  // the barrier with the campground: the ridge north and south, the camp's stockade and its gate
  cliff(B, X1, 0, X1, 2000, [], { sec });
  wall(B, X1, 2000, X1, 2480, 'stockade', { t: 24, sec });
  wall(B, X1, 2720, X1, 3200, 'stockade', { t: 24, sec });
  cliff(B, X1, 3200, X1, H, [], { sec });
  B.gate('camp_gate', 'gate', X1, 2600, 240, 20, HALF, { section: sec, label: 'Campground gate', style: 'bp-campgate' });
  prop(B, 'bp-camparch', X1, 2600, HALF, { w: 240 });
  // the start: up the county road from the south
  B.anchor('start', 650, 3780, 170);
  for (let k = 0; k < 6; k++) B.pspawn(590 + (k % 3) * 60, 3700 + Math.floor(k / 3) * 80);
  B.supply(860, 3640);
  clearing(B, 860, 3640, 90);
  B.checkpoint(sec, 650, 3420);
  B.checkpoint(sec, 950, 2700);
  B.checkpoint(sec, 1650, 2620);
  spawn(B, sec, 300, 900, 400, 400, 1);
  spawn(B, sec, 1300, 900, 400, 400, 1);
  spawn(B, sec, 1400, 3600, 300, 300, 0.8);
  spawn(B, sec, 160, 2700, 200, 300, 0.8);
}

// ---- 2. Blackpine Campground ---------------------------------------------------------------------------------

function campground(B) {
  const sec = 'campground';
  const LX0 = 2400, LX1 = 4100, LY0 = 1500, LY1 = 3000, RW = 170;
  // the loop road round the campfire island, the road on to the ranger compound
  trail(B, [[2400, 2600], [LX0, LY1], [LX1, LY1], [LX1, LY0], [LX0, LY0], [LX0, 2600]], RW, 'gravel');
  trail(B, [[LX1, LY0], [4350, 1320], [X2 + 60, 1300]], 180, 'gravel');
  // the check-in booth just inside the gate, the camp host's trailer
  ob(B, 'booth', 'bp-checkin', 1990, 2420, 70, 60, 0, { sec });
  ob(B, 'container', 'mr-trailer', 2150, 2020, 260, 70, HALF, { sec, color: '#e8e0cc' });
  prop(B, 'bp-hostsign', 2230, 2200, HALF);
  // the campfire circle in the middle of the loop: the fire ring, log benches round it, the screen
  clearing(B, 3250, 2250, 470);
  B.fire(3250, 2250, 26);
  ob(B, 'rock', 'bp-firering', 3250, 2250, 70, 70, 0, { sec, color: '#6a6660' });
  for (let k = 0; k < 7; k++) {
    const a = PI * 0.15 + (k / 6) * PI * 0.7;
    ob(B, 'desk', 'bp-logbench', 3250 - Math.cos(a) * 190, 2250 + Math.sin(a) * 190, 110, 22, HALF - a, { sec });
  }
  prop(B, 'bp-campscreen', 3250, 1980, 0);
  B.anchor('camp_fire', 3250, 2120, 100);
  // the sites round the loop: a pad, a picnic table, a fire ring, a tent or a car
  const sites = [
    [2600, 1250, 0], [2950, 1250, 0], [3650, 1250, 0], [3950, 1260, 0],
    [2650, 3260, PI], [3000, 3260, PI], [3350, 3260, PI], [4350, 2300, HALF], [4350, 2700, HALF], [2150, 3150, -HALF],
  ];
  sites.forEach(([x, y, a], i) => site(B, sec, x, y, a, i));
  // the RV at the big site on the south-east corner, awning out
  B.area('dirt', 3900, 3300, 360, 200, 0);
  ob(B, 'bus', 'bp-rv', 3900, 3320, 250, 62, 0, { sec, color: '#e8e4d8' });
  prop(B, 'bp-rvcamp', 3900, 3320, 0);
  B.anchor('camp_rv', 3900, 3190, 110);
  // the shower block north of the loop: two sides, a breezeway between
  room(B, {
    x: 3300, y: 1050, w: 340, h: 200, look: 'block', sec, floor: 'tile-white',
    doors: { s: [[-90, 84, 'steel'], [90, 84, 'steel']] }, roof: { kind: 'plain', height: 110, dark: 0.7 },
  });
  wall(B, 3300, 950, 3300, 1150, 'block', { t: 12, side: 'both', sec });
  prop(B, 'bp-showers', 3300, 1050, 0, { w: 340, h: 200 });
  B.anchor('camp_showers', 3210, 1070, 60);
  B.light(3210, 1050, 160, '#e8f0ff', 0.5, 110);
  B.light(3390, 1050, 160, '#e8f0ff', 0, 110);
  // water, bear boxes, the board, the firewood stand
  for (const [x, y] of [[2480, 2100], [4020, 2100], [3250, 1400]]) prop(B, 'bp-spigot', x, y, 0);
  prop(B, 'bp-campboard', 2300, 2380, HALF);
  ob(B, 'cabinet', 'bp-firewood', 2050, 2780, 80, 40, 0, { sec });
  // lantern posts along the loop (the campground has no street lights)
  for (const [x, y] of [[2500, 2480], [3250, 1610], [4010, 2880], [2500, 1620], [3700, 2890]]) {
    prop(B, 'bp-lanternpost', x, y, 0);
    B.light(x, y, 220, '#ffc070', 0.25, 70);
  }
  // the barrier with the ranger compound: the ridge north and south, the compound's chain-link with the panel
  cliff(B, X2, 0, X2, 900, [], { sec });
  fence(B, X2, 900, X2, 2000, 'chain', [[300, 500, null]], { sec, t: 14 });
  cliff(B, X2, 2000, X2, H, [], { sec });
  B.gate('ranger_gate', 'fence', X2, 1300, 200, 16, HALF, { section: sec, label: 'Ranger compound', style: 'hc-schoolpanel' });
  B.checkpoint(sec, 2150, 2600);
  B.checkpoint(sec, LX0, 2050);
  B.checkpoint(sec, 3250, LY0);
  B.checkpoint(sec, 4420, 1330);
  spawn(B, sec, 2200, 500, 400, 300, 1);
  spawn(B, sec, 3700, 500, 600, 200, 1);
  spawn(B, sec, 2600, 3750, 600, 200, 1);
  spawn(B, sec, 4300, 3600, 300, 300, 0.8);
}

/** A campsite: the pad, a picnic table, a fire ring, a tent (or a car), a lantern post. */
function site(B, sec, x, y, a, i) {
  const c = Math.cos(a), s = Math.sin(a);
  const at = (lx, ly) => [x + lx * c - ly * s, y + lx * s + ly * c];
  B.area('dirt', x, y, 220, 170, a);
  clearing(B, x, y, 150);
  const [tx, ty] = at(-40, -10);
  ob(B, 'desk', 'bp-picnic', tx, ty, 64, 44, a, { sec });
  const [fx, fy] = at(50, 20);
  prop(B, 'bp-ringsmall', fx, fy, 0);
  if (i % 3 === 2) {
    const [cx, cy] = at(20, -70);
    B.vehicle(i % 2 ? 'car' : 'suv', cx, cy, a + 0.1, { jitter: 0.2, wrecked: i === 5 }).section = sec;
  } else {
    const [nx, ny] = at(20, -60);
    ob(B, 'tent', i % 2 ? 'bp-tent' : 'bp-tent2', nx, ny, 70, 60, a + 0.15 * (i % 2 ? 1 : -1), { sec, color: ['#c8641c', '#2a5a8a', '#3a7a3a', '#c8b020'][i % 4] });
  }
  prop(B, 'bp-sitepost', ...at(-95, 60), a, { n: i + 1 });
}

// ---- 3. The ranger station -------------------------------------------------------------------------------------

function ranger(B) {
  const sec = 'ranger';
  B.box('gravel', X2, 700, 6100, 2000);
  clearRect(B, X2, 700, 6100, 2000);
  trail(B, [[X2, 1300], [5300, 1400], [6000, 1700], [6400, 2350], [6700, 2780], [X3 + 80, 2800]], 180, 'dirt');
  clearing(B, 5350, 1350, 760);
  // the station: the front office and its counter, the radio room, the bunk room
  const SX = 5300, SY = 1050, SW = 480, SH = 280;
  room(B, {
    x: SX, y: SY, w: SW, h: SH, look: 'ranger', sec, floor: 'wood-old',
    doors: { s: [[25, 90, 'wood']], e: [[60, 84, 'wood']] }, roof: { kind: 'house', height: 130, dark: 0.68 }, t: 14,
  });
  wallGaps(B, SX - 60, SY - SH / 2, SX - 60, SY + SH / 2, [[150, 234, 'wood']], 'rangerint', { t: 12, side: 'both', sec });
  wallGaps(B, SX + 110, SY - SH / 2, SX + 110, SY + SH / 2, [[40, 124, 'wood']], 'rangerint', { t: 12, side: 'both', sec });
  ob(B, 'counter', 'bp-rcounter', SX, SY + 10, 90, 30, 0, { sec });
  ob(B, 'counter', 'bp-radiodesk', SX - 150, SY - 100, 150, 34, 0, { sec });
  prop(B, 'bp-station', SX, SY, 0, { w: SW, h: SH });
  B.anchor('ranger_radio', SX - 150, SY - 30, 70);
  B.light(SX - 150, SY - 40, 160, '#ffe0b0', 0.2, 110);
  B.light(SX + 20, SY + 40, 180, '#fff0d8', 0, 110);
  ob(B, 'mast', 'bp-radiomast', SX - 280, SY - 120, 24, 24, 0, { sec });
  prop(B, 'bp-flag', SX - 100, SY + SH / 2 + 80, 0);
  prop(B, 'bp-rangersign', SX + 160, SY + SH / 2 + 110, 0);
  // the fire lookout: four legs (the art draws the tower, the stairs and the cab high over the trees)
  const LX = 6000, LY = 1150;
  for (const [dx, dy] of [[-55, -55], [55, -55], [55, 55], [-55, 55]]) ob(B, 'ipillar', 'nodraw', LX + dx, LY + dy, 14, 14, 0, { sec });
  prop(B, 'bp-lookout', LX, LY, 0);
  B.anchor('ranger_lookout', LX, LY + 120, 90);
  // the ranger's truck, the fuel tank, the generator shed, the helipad, the brush engine
  ob(B, 'pickup', 'bp-rangertruck', 5000, 1620, 92, 44, 0.25, { sec, color: '#2f5a3a' });
  B.anchor('ranger_truck', 5050, 1750, 100);
  ob(B, 'silo', 'bp-fueltank', 4800, 880, 60, 60, 0, { sec, color: '#c8c4b8' });
  facade(B, 4760, 1720, 130, 110, HALF, 'shack', { sec, color: '#7a5a3a', roof: '#3a3a34', style: 'bp-genshed', top: 120 });
  B.area('concrete', 5700, 1750, 200, 200, 0);
  prop(B, 'bp-helipad', 5700, 1750, 0);
  B.ob('truck', 5650, 820, 130, 56, 0.05, { section: sec, color: '#b01818' });
  B.lamp(5000, 1350, { a: 0, r: 280, dead: false });
  B.lamp(5800, 1450, { a: PI, r: 260 });
  // the barrier with the gorge: the rim, the rockfall across the trail down
  cliff(B, X3, 0, X3, 2690, [], { sec });
  cliff(B, X3, 2910, X3, H, [], { sec });
  B.gate('gorge_rubble', 'rubble', X3, 2800, 220, 50, HALF, { section: sec, label: 'Rockfall', style: 'bp-rockfall' });
  prop(B, 'bp-rockfallside', X3, 2800, HALF, { w: 220 });
  B.checkpoint(sec, 4820, 1350);
  B.checkpoint(sec, 5500, 1500);
  B.checkpoint(sec, 6600, 2640);
  spawn(B, sec, 5200, 300, 800, 200, 1);
  spawn(B, sec, 5000, 3300, 600, 500, 1);
  spawn(B, sec, 6400, 500, 400, 300, 0.8);
  spawn(B, sec, 6300, 3600, 400, 300, 0.8);
}

// ---- 4. Cutter's Gorge -----------------------------------------------------------------------------------------------

function gorge(B) {
  const sec = 'gorge';
  // the river in its canyon: the water, the gravel bars, the cliff walls either side with the trail's gaps
  B.box('gravel', CW[0], 0, CW[1], H);
  B.box('water', RIVER[0], 0, RIVER[1], BRIDGE[0]);
  B.box('water', RIVER[0], BRIDGE[1], RIVER[1], H);
  const gap = [[BRIDGE[0] - 60, BRIDGE[1] + 60, null]];
  for (const x of CW) cliff(B, x, 0, x, H, gap.map(([a, b]) => [a, b, null]), { sec, t: 70, look: 'canyon' });
  trail(B, [[X3 - 60, 2800], [7050, 2600], [7250, 2250], [CW[0] - 20, 2000], [RIVER[0], 2000]], 190, 'dirt');
  trail(B, [[RIVER[1], 2000], [CW[1] + 40, 2000], [8300, 1800], [8650, 1520], [X4 + 60, 1500]], 190, 'dirt');
  clearing(B, 7250, 2150, 260);
  clearing(B, 8150, 1950, 220);
  // the footbridge (walked on: the gap in the water), its towers and cables; the winch on the near rim
  prop(B, 'bp-footbridge', (RIVER[0] + RIVER[1]) / 2, 2000, 0, { len: CW[1] - CW[0] + 40, w: BRIDGE[1] - BRIDGE[0] });
  B.anchor('gorge_bridge', (RIVER[0] + RIVER[1]) / 2, 2000, 60);
  ob(B, 'cabinet', 'bp-winch', 7330, 1870, 60, 40, -0.3, { sec });
  B.anchor('gorge_winch', 7250, 1960, 80);
  B.anchor('gorge_far', 8150, 1960, 120);
  // the road bridge upstream, down in the river; rapids and boulders
  prop(B, 'bp-roadbridge', (RIVER[0] + RIVER[1]) / 2, 700, 0, { len: CW[1] - CW[0] });
  prop(B, 'bp-rapids', (RIVER[0] + RIVER[1]) / 2, H / 2, HALF, { len: H, w: RIVER[1] - RIVER[0] });
  for (const [x, y, s] of [[7000, 1500, 70], [7150, 3100, 90], [8450, 2500, 80], [8200, 900, 60], [6950, 1150, 90]]) ob(B, 'rock', 'bp-boulder', x, y, s, s * 0.8, B.rng.range(0, PI), { sec, color: '#6a6a64' });
  prop(B, 'bp-gorgesign', 7150, 2420, -0.6);
  // the barrier with the mill: the rim north and south, the mill's perimeter fence with its gate
  cliff(B, X4, 0, X4, 600, [], { sec });
  fence(B, X4, 600, X4, 3400, 'chainslat', [[780, 1020, null]], { sec, t: 14 });
  cliff(B, X4, 3400, X4, H, [], { sec });
  B.gate('mill_gate', 'gate', X4, 1500, 240, 20, HALF, { section: sec, label: 'Mill gate', style: 'bp-millgate' });
  prop(B, 'bp-millgatesign', X4, 1500, HALF, { w: 240 });
  B.checkpoint(sec, 7050, 2620);
  B.checkpoint(sec, 7320, 2000);
  B.checkpoint(sec, 8150, 2050);
  B.checkpoint(sec, 8650, 1560);
  spawn(B, sec, 7100, 600, 400, 300, 1);
  spawn(B, sec, 7100, 3500, 400, 400, 1);
  spawn(B, sec, 8450, 3300, 500, 400, 1);
  spawn(B, sec, 8400, 500, 500, 300, 0.8);
}

// ---- 5. Harlan Lumber -----------------------------------------------------------------------------------------------

function lumbermill(B) {
  const sec = 'lumbermill';
  B.box('dirt', X4, 400, X5, 3600);
  clearRect(B, X4, 400, X5, 3600);
  trail(B, [[X4, 1500], [9300, 1500], [9300, 2700], [10500, 2800], [X5 + 60, 2800]], 200, 'gravel');
  // the log decks north, the loader, a loaded truck
  for (const [x, y, w] of [[9500, 650, 420], [10100, 650, 380], [9500, 1050, 420], [10150, 1080, 300]]) ob(B, 'container', 'bp-logdeck', x, y, w, 110, 0, { sec, color: '#6a4a30' });
  ob(B, 'truck', 'bp-loader', 9850, 870, 150, 70, 0.3, { sec, color: '#d8a020' });
  B.ob('semi', 9500, 1330, 82, 42, 0.02, { section: sec, color: '#8a2f2a' });
  ob(B, 'semi', 'mr-logtrailer', 9680, 1330, 240, 42, 0.02, { sec, color: '#3a3c3e' });
  B.anchor('mill_yard', 9800, 1260, 120);
  // the saw hall: a long shed open at both ends, the head rig, the edger, the green chain
  const HX = 9950, HY = 2150, HW = 1000, HH = 420;
  room(B, {
    x: HX, y: HY, w: HW, h: HH, look: 'mill', sec, floor: 'garage',
    doors: { w: [[-60, 200, 'none']], e: [[0, 200, 'none']], s: [[-300, 90, 'steel']] }, roof: { kind: 'industrial', height: 190, dark: 0.6, style: 'bp-sawroof' }, t: 14,
  });
  ob(B, 'counter', 'bp-carriage', 9750, 2040, 360, 40, 0, { sec });
  ob(B, 'cabinet', 'bp-bandsaw', 9980, 1990, 60, 60, 0, { sec });
  ob(B, 'counter', 'bp-rollers', 10200, 2060, 300, 34, 0, { sec });
  ob(B, 'counter', 'bp-greenchain', 10150, 2300, 520, 60, 0, { sec });
  prop(B, 'bp-sawhall', HX, HY, 0, { w: HW, h: HH });
  B.anchor('mill_saw', 9980, 2140, 80);
  for (const x of [9650, 9950, 10250]) B.light(x, HY, 240, '#ffd49a', 0.3, 170);
  // the wigwam burner and the conveyor up to it
  ob(B, 'silo', 'bp-burner', 10550, 1000, 240, 240, 0, { sec, color: '#5a4a40' });
  prop(B, 'bp-conveyor', 10450, 1500, 0);
  // the office
  room(B, {
    x: 9350, y: 3050, w: 240, h: 170, look: 'ranger', sec, floor: 'carpet-brown',
    doors: { n: [[50, 84, 'wood']] }, roof: { kind: 'office', height: 120, dark: 0.66 }, t: 14,
  });
  ob(B, 'desk', 'bp-milldesk', 9330, 3080, 90, 44, 0, { sec });
  prop(B, 'bp-milloffice', 9350, 3050, 0, { w: 240, h: 170 });
  B.anchor('mill_office', 9420, 3020, 60);
  B.light(9350, 3050, 150, '#ffe0b0', 0.3, 110);
  prop(B, 'bp-millsign', 9150, 1700, HALF);
  // the log pond
  B.box('water', 10000, 3150, 10700, 3550);
  prop(B, 'bp-pondlogs', 10350, 3350, 0, { w: 700, h: 400 });
  B.lamp(9300, 1650, { a: 0, r: 300, dead: false });
  B.lamp(10600, 2650, { a: PI, r: 280 });
  // the barrier with the farm: the board fence of the Harlan place, the panel the crew pushes in
  fence(B, X5, 0, X5, H, 'farmfence', [[2700, 2900, null]], { sec, t: 16 });
  B.gate('farm_fence', 'fence', X5, 2800, 200, 16, HALF, { section: sec, label: 'Farm fence', style: 'bp-farmpanel' });
  B.checkpoint(sec, 9150, 1520);
  B.checkpoint(sec, 9320, 2600);
  B.checkpoint(sec, 10650, 2820);
  spawn(B, sec, 9300, 3500, 400, 120, 1);
  spawn(B, sec, 10700, 600, 300, 300, 1);
  spawn(B, sec, 10700, 1800, 250, 400, 0.8);
  spawn(B, sec, 9100, 500, 250, 150, 0.8);
}

// ---- 6. The farm fence --------------------------------------------------------------------------------------------------

function farm(B) {
  const sec = 'farmgate';
  trail(B, [[X5, 2800], [11300, 2780], [11700, 2600], [W, 2550]], 180, 'dirt');
  clearing(B, 11450, 2400, 700);
  clearRect(B, X5, 1100, W, 3700);
  B.anchor('farm_gate', X5 + 140, 2810, 100);
  // the signal: a tall pole with the beacon, a smoke flare barrel, the Harlan board
  ob(B, 'mast', 'bp-signal', 11500, 2420, 24, 24, 0, { sec });
  B.anchor('farm_signal', 11500, 2560, 100);
  // the farm beyond: the barn, the house, the silo, a stock trailer, the field fences
  facade(B, 11800, 1800, 300, 200, -HALF, 'barn', { sec, color: '#7d3a2c', roof: '#4a2b22' });
  facade(B, 11700, 3350, 240, 180, PI, 'house', { sec, color: '#e8e0cc', roof: '#3a3a40', lit: 0.2 });
  B.ob('silo', 11900, 1400, 90, 90, 0, { color: '#b8bcbf', section: sec });
  B.vehicle('pickup', 11250, 2560, 0.3, { color: '#8a2a22', jitter: 0 }).section = sec;
  prop(B, 'bp-cattleguard', X5 + 60, 2800, HALF);
  prop(B, 'mr-farmfence', 11460, 2240, 0, { len: 1060, gaps: [] });
  prop(B, 'mr-farmfence', 11460, 3060, 0, { len: 1060, gaps: [[11560, 11760]] });
  prop(B, 'mr-windmill', 11780, 2900, 0.5);
  for (const [x, y, a] of [[11250, 2380, 0.3], [11310, 2340, 1.4], [11220, 3150, 0.8], [11900, 2450, 2.1]]) B.ob('rock', x, y, 34, 34, a, { color: '#c9a850', section: sec, style: 'mr-bale' });
  B.lamp(11300, 2650, { a: HALF, r: 300, dead: false });
  B.checkpoint(sec, 11100, 2800);
  B.checkpoint(sec, 11600, 2650);
  spawn(B, sec, 11500, 600, 500, 300, 1);
  spawn(B, sec, 11400, 3750, 600, 150, 1);
}

void [dress];
