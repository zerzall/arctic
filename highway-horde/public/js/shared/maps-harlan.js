// 5. Harlan County (the Evac Run map, SPEC §2 / §3.7)
//
// A big square stretch of farm country, 7200 x 7200, built for the moving safe zone: ten
// points of interest joined by county roads through fields and woods. State Route 7 runs
// north-south through the middle and County Road 9 east-west; they cross on Main Street in
// the town of Harlan. The elevated I-70 crosses the north of the map with a diamond
// interchange down to Route 7. Around them: the Gas-N-Go on Old Mill Road, Haskell Farm
// with its barns and silos, St. Jude's church and graveyard, a FEMA field hospital behind
// HESCO walls on the county road, Miller Quarry & Lumber, the KHRL radio mast on its hill,
// the Shady Pines trailer park and the marina on Lake Harlan.
//
// Written in the same builder vocabulary as the other maps (maps.js); `B.lib` carries the
// palettes and helpers it shares with them.

import { TAU } from './math.js';

const W7 = 3600;            // Route 7 centre line (x)
const C9 = 3600;            // County Road 9 centre line (y)
const RW = 75;              // half width of the two main roads
const I70 = 1000, DZ = 200, DW = 300;   // interstate centre line (y), deck height and width

/** Points of interest (zone centres) in the order the map lists them. */
export const HARLAN_POIS = [
  { name: 'Main Street', x: 3600, y: 3600, r: 700 },
  { name: 'Gas-N-Go', x: 2260, y: 2230, r: 540 },
  { name: 'Haskell Farm', x: 5950, y: 1420, r: 700 },
  { name: "St. Jude's Church", x: 980, y: 3360, r: 620 },
  { name: 'Field Hospital', x: 6150, y: 3600, r: 660 },
  { name: 'I-70 Interchange', x: 3600, y: 1260, r: 660 },
  { name: 'Miller Quarry', x: 1180, y: 1180, r: 660 },
  { name: 'Radio Hill', x: 5760, y: 5660, r: 620 },
  { name: 'Shady Pines', x: 1300, y: 5880, r: 660 },
  { name: 'Lake Harlan Marina', x: 3600, y: 6300, r: 600 },
];

/**
 * Build Harlan County into builder B (see maps.js createBuilder).
 * @param {object} B map builder
 */
export function buildHarlan(B) {
  const { W, H, rng, drng } = B;
  const L = B.lib;
  const FENCE = '#6b5433', CHAIN = '#8a8f93', IRON = '#2c2c2e';
  const TRAILERS = ['#d8d0bc', '#b9c2c4', '#c9b28a', '#9fb3a0', '#d9c7a6', '#c4a4a0', '#a9b8c9'];

  // ---- the objective (the radio mast on its hill), the supply station and the start in
  // town. Evac Run never defends the mast; it is the landmark of Radio Hill.
  B.objective('radio', 'Radio Tower', 5860, 5600, 70, 70, 0, 4500, 110);
  B.supply(W7, 3330);
  for (const [x, y] of [[3440, 3560], [3440, 3640], [3760, 3560], [3760, 3640],
    [3560, 3450], [3640, 3450], [3560, 3760], [3640, 3760]]) B.pspawn(x, y);
  for (const p of HARLAN_POIS) {
    B.poi(p.name, p.x, p.y, p.r);
    // keep scatter (trees, boulders) out of the heart of every point of interest
    B.keep(p.x, p.y, p.r * 0.9, p.r * 0.9);
  }

  // ---- zombie spawns (defend mode would use them; the zone mode rings its circle)
  B.zspawn(60, C9, 90, 120);
  B.zspawn(W - 60, C9, 90, 120);
  B.zspawn(W7, 60, 120, 90);
  B.zspawn(60, 2250, 90, 110);
  B.zspawn(W - 60, 1700, 90, 100);
  B.zspawn(60, 5300, 90, 100);
  B.zspawn(1900, 60, 300, 90);
  B.zspawn(5400, 60, 300, 90);
  B.zspawn(W - 60, 5000, 90, 300);
  B.zspawn(1500, H - 60, 400, 90);
  B.zspawn(5900, H - 60, 400, 90);
  B.zspawn(60, 4400, 90, 300);

  // ---- the interstate: a viaduct over the whole north of the map, a diamond interchange
  // with four ramps down to Route 7
  B.deck('viaduct', [[-1500, I70, DZ], [W + 1500, I70, DZ]], DW);
  for (let x = -1330; x <= W + 1330; x += 380) {
    if ((x > W7 - 260 && x < W7 + 260) || (x > 2380 && x < 2820) || (x > 4380 && x < 4820)) continue;
    B.bent(x, I70, Math.PI / 2, 220, DZ);
  }
  const ramps = [
    B.ramp(2600, I70 + DW / 2, DZ, W7 - RW - 90, 1400, 120),
    B.ramp(4600, I70 + DW / 2, DZ, W7 + RW + 90, 1400, 120),
    B.ramp(2600, I70 - DW / 2, DZ, W7 - RW - 90, 600, 120),
    B.ramp(4600, I70 - DW / 2, DZ, W7 + RW + 90, 600, 120),
  ];
  B.overpass().signs.push({ x: W7, y: I70 + DW / 2, a: Math.PI / 2, w: 200 }, { x: W7, y: I70 - DW / 2, a: -Math.PI / 2, w: 200 });

  // ---- ground: fields and meadows, then the roads on top
  B.patches(['grass', 'grass', 'dirt', 'grass'], 70, 200, 200, W - 200, H - 200, [300, 700]);
  // ploughed fields round the farm and along the county roads
  B.area('dirt', 4750, 1150, 900, 520, 0.02);
  B.area('dirt', 6800, 2350, 560, 900, -0.03);
  B.area('dirt', 5200, 2500, 1000, 560, 0.04);
  B.area('dirt', 2300, 4400, 900, 600, -0.02);
  B.area('dirt', 4900, 4600, 700, 900, 0.03);
  B.area('dirt', 2600, 5750, 700, 500, 0.02);
  // gravel verges along the main roads
  B.box('gravel', W7 - RW - 30, 0, W7 + RW + 30, 6190);
  B.box('gravel', 0, C9 - RW - 30, W, C9 + RW + 30);
  B.box('gravel', 0, 2150, W7, 2350);
  B.box('gravel', W7, 1620, W, 1780);
  B.box('gravel', 0, 5220, W7, 5380);
  // yards and lots
  B.box('gravel', 600, 700, 1700, 1560);                 // quarry yard
  B.box('dirt', 560, 420, 1220, 1000);                   // quarry pit floor
  B.box('concrete', 1940, 1870, 2620, 2175);             // Gas-N-Go forecourt
  B.box('asphalt', 1990, 2325, 2520, 2480);              // motel parking
  B.box('dirt', 5440, 950, 6420, 1640);                  // farmyard
  B.box('gravel', 1290, 3240, 1560, 3525);               // church parking
  B.box('grass', 400, 2940, 950, 3470);                  // graveyard lawn
  B.box('dirt', 5770, 3220, 6530, 3980);                 // field hospital compound
  B.box('concrete', 6620, 3150, 6920, 3450);             // helipad
  B.box('gravel', 680, 5540, 1960, 6320);                // trailer park
  B.box('concrete', 3150, 6180, 4050, 6480);             // marina lot
  B.box('sand', 2300, 6470, 4900, 6530);                 // lake shore
  B.box('gravel', 5480, 5380, 6160, 5960);               // radio station yard
  B.box('dirt', 1000, 3700, 1400, 3900);                 // church path
  // the roads
  B.box('asphalt', W7 - RW, 0, W7 + RW, 6190);           // State Route 7
  B.box('asphalt', 0, C9 - RW, W, C9 + RW);              // County Road 9 / Main Street
  B.box('asphalt', 0, 2175, W7 - RW, 2325);              // Old Mill Road
  B.box('asphalt', W7 + RW, 1640, W, 1760);              // Haskell Road
  B.box('asphalt', 0, 5240, W7 - RW, 5360);              // Pine Road
  B.box('asphalt', 5140, C9 + RW, 5260, 5440);           // Radio Road
  B.box('gravel', 5140, 5440, 5520, 5560);               // up the hill to the gate
  B.box('gravel', 1170, 1500, 1230, 2175);               // quarry track
  B.box('gravel', 1270, 5360, 1330, 5560);               // trailer park entry
  for (const r of ramps) {
    // short aprons from the ramp toes onto Route 7
    const x0 = Math.min(r.x, W7), x1 = Math.max(r.x, W7);
    B.box('asphalt', x0 - 60, r.y - 60, x1, r.y + 60);
  }
  B.box('gravel', W7 - 200, I70 - DW / 2 - 40, W7 + 200, I70 + DW / 2 + 40);   // under the deck
  B.box('concrete', 2800, C9 - RW - 75, 4400, C9 - RW);  // Main Street sidewalks
  B.box('concrete', 2800, C9 + RW, 4400, C9 + RW + 75);
  B.box('concrete', W7 - RW - 70, 3000, W7 - RW, C9 - RW);
  B.box('concrete', W7 + RW, 3000, W7 + RW + 70, C9 - RW);
  // Lake Harlan: the dock runs out between two water areas
  B.box('water', 2300, 6530, 3560, H);
  B.box('water', 3640, 6530, 4900, H);
  B.box('water', 3560, 6960, 3640, H);
  B.box('concrete', 3560, 6480, 3640, 6960);             // the dock

  // ---- road paint
  const lineX = (kind, y, x0, x1, w, gaps) => { for (const [a, b] of B.spans(x0, x1, gaps)) B.line(kind, a, y, b, y, w); };
  const lineY = (kind, x, y0, y1, w, gaps) => { for (const [a, b] of B.spans(y0, y1, gaps)) B.line(kind, x, a, x, b, w); };
  const junction = [[C9 - RW - 40, C9 + RW + 40]];
  lineY('yellow_double', W7, 0, 6150, 3, [...junction, [2135, 2365], [1600, 1800]]);
  lineY('white', W7 - RW + 5, 0, 6150, 3, [...junction, [2175, 2325], [1340, 1460], [540, 660]]);
  lineY('white', W7 + RW - 5, 0, 6150, 3, [...junction, [1640, 1760], [1340, 1460], [540, 660]]);
  lineX('yellow_double', C9, 0, W, 3, [[W7 - RW - 40, W7 + RW + 40], [5100, 5300]]);
  lineX('white', C9 - RW + 5, 0, W, 3, [[W7 - RW, W7 + RW]]);
  lineX('white', C9 + RW - 5, 0, W, 3, [[W7 - RW, W7 + RW], [5140, 5260]]);
  lineX('yellow', 2250, 0, W7 - RW, 3, []);
  lineX('white_dashed', 1700, W7 + RW, W, 3, []);
  lineX('yellow', 5300, 0, W7 - RW, 3, []);
  lineY('white_dashed', 5200, C9 + RW, 5440, 3, []);
  B.line('crosswalk', W7 - RW, C9 - RW - 30, W7 + RW, C9 - RW - 30, 30);
  B.line('crosswalk', W7 - RW, C9 + RW + 30, W7 + RW, C9 + RW + 30, 30);
  B.line('crosswalk', W7 - RW - 30, C9 - RW, W7 - RW - 30, C9 + RW, 30);
  B.line('crosswalk', W7 + RW + 30, C9 - RW, W7 + RW + 30, C9 + RW, 30);
  B.line('stop', W7 - RW + 5, C9 - RW - 58, W7 - 4, C9 - RW - 58, 6);
  B.line('stop', W7 + 4, C9 + RW + 58, W7 + RW - 5, C9 + RW + 58, 6);
  B.line('stop', W7 - RW - 58, C9 + 4, W7 - RW - 58, C9 + RW - 5, 6);
  B.line('stop', W7 + RW + 58, C9 - RW + 5, W7 + RW + 58, C9 - 4, 6);
  B.line('stop', W7 - RW - 10, 2185, W7 - RW - 10, 2315, 6);
  for (let x = 2030; x <= 2480; x += 58) B.line('parking', x, 2340, x, 2410, 3);
  for (let x = 3200; x <= 3480; x += 58) B.line('parking', x, 6195, x, 6265, 3);
  for (let x = 3720; x <= 4000; x += 58) B.line('parking', x, 6195, x, 6265, 3);
  // helipad
  const HX = 6770, HY = 3300;
  for (const [x1, y1, x2, y2] of [[-110, -110, 110, -110], [-110, 110, 110, 110], [-110, -110, -110, 110], [110, -110, 110, 110]]) B.line('yellow', HX + x1, HY + y1, HX + x2, HY + y2, 5);
  B.line('white', HX - 45, HY - 60, HX - 45, HY + 60, 12);
  B.line('white', HX + 45, HY - 60, HX + 45, HY + 60, 12);
  B.line('white', HX - 45, HY, HX + 45, HY, 12);

  // =====================================================================================
  // Main Street, Harlan: two blocks of storefronts either side of the crossroads
  const store = (x, y, w, h, color, roof) => B.ob('building', x, y, w, h, 0, { color, roof });
  const north = C9 - RW - 80, south = C9 + RW + 80;
  const fronts = [
    [2900, 150, '#7d3a2c', '#4e3a32'], [3130, 130, '#b8ad98', '#5b6770'], [3360, 160, '#9a917f', '#4f4a52'],
    [3840, 150, '#a58f73', '#6d5a4a'], [4070, 130, '#8c7b6a', '#4a3f33'], [4300, 160, '#b9b2a4', '#7a3b2e'],
  ];
  fronts.forEach(([x, d, color, roof], i) => {
    store(x, north - d / 2, 170, d, color, roof);
    const s = fronts[(i + 3) % fronts.length];
    store(x, south + s[1] / 2, 170, s[1], s[2], s[3]);
  });
  // back lots: dumpsters, a pickup, the old hotel and the feed store
  B.ob('building', 3180, 3080, 360, 150, 0, { color: '#8c8478', roof: '#4e4a45' });
  B.ob('building', 4120, 4130, 300, 150, 0, { color: '#9a8f7e', roof: '#5a3f35' });
  for (const [x, y] of [[3000, 3230], [3420, 3240], [3800, 3960], [4250, 3960]]) B.ob('container', x, y, 64, 36, 0, { color: '#2e5d3a', roof: '#294f33' });
  B.vehicle('pickup', 2880, 3190, 0.1, { wrecked: rng.chance(0.4) });
  B.vehicle('car', 4380, 3990, Math.PI / 2 + 0.1);
  // parked along the curbs, a crash in the crossroads, a burning car
  for (const [kind, x, y, a, wr] of [['car', 2880, C9 - 50, 0, false], ['suv', 3090, C9 - 52, 0, true], ['car', 3320, C9 + 52, Math.PI, false],
    ['van', 2960, C9 + 52, Math.PI, false], ['car', 3900, C9 - 50, 0, true], ['pickup', 4180, C9 + 50, Math.PI, false],
    ['car', 4330, C9 - 50, 0, false]]) B.vehicle(kind, x, y, a, { wrecked: wr || rng.chance(0.2) });
  B.vehicle('car', W7 - 30, C9 + 20, 0.7, { wrecked: true, burning: true });
  B.vehicle('suv', W7 + 60, C9 - 55, -0.4, { wrecked: true });
  B.vehicle('car', W7 + 40, 2860, Math.PI / 2 + 0.2, { wrecked: true });
  B.vehicle('bus', W7 - 20, 4180, Math.PI / 2 - 0.08, { color: '#d9a21b', wrecked: true });   // the school bus that never made it
  // the square: a few old trees and the memorial flag
  for (const [x, y] of [[3350, 4150], [3450, 4260], [3280, 4300]]) B.tree(x, y, 1.1);
  B.decor('flag', 3380, 4210, 0, 1.1, true);
  B.signal(W7 - RW - 26, C9 - RW - 26, Math.PI / 2, 150);
  B.signal(W7 + RW + 26, C9 + RW + 26, -Math.PI / 2, 150);
  for (const x of [2850, 3100, 3350, 3850, 4100, 4350]) {
    B.lamp(x, C9 - RW - 40, { a: Math.PI / 2 });
    B.lamp(x + 120, C9 + RW + 40, { a: -Math.PI / 2 });
  }
  B.light(3130, north - 70, 150, '#ffd9a0', 0.1);
  B.light(3840, north - 70, 170, '#ff7aa2', 0.25);   // the diner's neon
  B.light(4070, south + 60, 140, '#bfe4ff', 0.2);

  // =====================================================================================
  // Gas-N-Go on Old Mill Road, and the Lucky 7 motel across the road
  B.ob('building', 2080, 1960, 220, 110, 0, { color: '#b8ad98', roof: '#5b6770' });
  B.ob('container', 1980, 2110, 64, 36, Math.PI / 2, { color: '#2e5d3a', roof: '#294f33' });
  B.ob('container', 2200, 2080, 60, 34, 0, { color: '#d9d9d0', roof: '#c9c9c0' });   // propane cage
  for (const [x, y] of [[2320, 2000], [2500, 2000], [2320, 2130], [2500, 2130]]) B.ob('pillar', x, y, 18, 18, 0);
  for (const x of [2380, 2440]) B.ob('pump', x, 2065, 24, 46, 0, { color: rng.pick(['#b53a2e', '#c9c4b6', '#2f5f8a']) });
  B.vehicle('car', 2410, 2130, 0.05, { jitter: 0.5, wrecked: rng.chance(0.3) });
  B.vehicle('pickup', 2560, 1930, Math.PI / 2 + 0.2, { wrecked: true, burning: true });
  B.ob('tanker', 2020, 2290, 230, 60, 0.04, { color: '#c4c7c9', wrecked: true });
  B.ob('semi', 2160, 2296, L.SEMI_CAB[0], L.SEMI_CAB[1], 0.2, { color: L.mixColor(rng.pick(L.SEMI_COLORS), '#221e1b', 0.45), wrecked: true });
  B.fire(2180, 2300, 30);
  B.decor('pylon', 2620, 1900, 0, 1);
  B.ob('building', 2250, 2560, 400, 110, 0, { color: '#a58f73', roof: '#6d5a4a' });   // motel
  for (const [kind, x, a] of [['car', 2060, Math.PI / 2], ['van', 2240, Math.PI / 2 - 0.05], ['car', 2420, Math.PI / 2 + 0.1]]) {
    B.vehicle(kind, x, 2410, a, { wrecked: rng.chance(0.3) });
  }
  B.light(2410, 2065, 220, '#f4efcf', 0.15);
  B.light(2250, 2480, 170, '#ff7aa2', 0.25);
  B.lamp(2620, 2170, { color: L.SODIUM_COLOR, r: 230 });
  B.lamp(1900, 2340, { color: L.SODIUM_COLOR, r: 230 });

  // =====================================================================================
  // Haskell Farm: farmhouse, the big red barn, silos, a machine shed and fenced paddocks
  B.ob('building', 5620, 1180, 210, 140, 0, { color: '#9a8f7e', roof: '#6e3b2f' });
  B.ob('building', 6060, 1160, 270, 180, 0, { color: '#7d3a2c', roof: '#5a2b22' });
  B.ob('building', 6300, 1470, 160, 110, 0.03, { color: '#7a6a55', roof: '#5b5048' });
  for (const [x, y, s] of [[6290, 1080, 86], [6290, 1190, 76], [6385, 1130, 70]]) B.ob('silo', x, y, s, s, 0, { color: rng.pick(['#b8bcbf', '#a9aeb2', '#c7c2b6']) });
  B.vehicle('pickup', 5780, 1340, 1.3, { color: '#6d4c3a' });
  B.vehicle('truck', 5900, 1520, 0.1, { color: '#3f6b2f', wrecked: rng.chance(0.3) });   // the farm truck
  B.runX('wall', 950, 5440, 6420, [[5520, 5720]], 6, { color: FENCE, solid: false, maxLen: 300 });
  B.runY('wall', 5440, 950, 1620, [[1250, 1400]], 6, { color: FENCE, solid: false, maxLen: 300 });
  B.runY('wall', 6420, 950, 1620, [[1300, 1420]], 6, { color: FENCE, solid: false, maxLen: 300 });
  B.runX('wall', 1600, 4300, 5200, [[4700, 4820]], 6, { color: FENCE, solid: false, maxLen: 300 });
  B.runY('wall', 6520, 1900, 2800, [[2300, 2420]], 6, { color: FENCE, solid: false, maxLen: 300 });
  B.light(5620, 1270, 150, '#ffcf80', 0.15);
  B.light(6060, 1270, 140, '#ffcf80', 0.1);
  B.lamp(5720, 1600, { color: L.LAMP_COLOR });
  B.fire(5900, 1250, 12);

  // =====================================================================================
  // St. Jude's: the church with its tower, the parking lot and the graveyard
  B.ob('building', 1120, 3290, 280, 150, 0, { color: '#c9c2b2', roof: '#4f4a52' });
  B.ob('building', 945, 3290, 70, 70, 0, { color: '#bfb8a8', roof: '#3a3a40', top: 330 });
  B.vehicle('car', 1360, 3310, Math.PI / 2, { wrecked: rng.chance(0.3) });
  B.vehicle('van', 1480, 3380, Math.PI / 2 + 0.1, { color: '#e3e3e3' });   // the church van
  B.runX('wall', 2940, 400, 950, [], 6, { color: IRON, solid: false, maxLen: 280 });
  B.runX('wall', 3470, 400, 950, [[620, 720]], 6, { color: IRON, solid: false, maxLen: 280 });
  B.runY('wall', 400, 2940, 3470, [], 6, { color: IRON, solid: false, maxLen: 280 });
  B.runY('wall', 950, 2940, 3180, [], 6, { color: IRON, solid: false, maxLen: 280 });
  for (let row = 0; row < 6; row++) {
    const y = 3020 + row * 72;
    for (let x = 470; x <= 890; x += 56) {
      if (x > 640 && x < 700) continue;   // the aisle
      if (rng.chance(0.14)) continue;
      B.ob('grave', x + rng.centered() * 5, y + rng.centered() * 4, rng.pick([26, 30, 34]), 10, rng.centered() * 0.08, { color: rng.pick(['#8e8c86', '#7d7b75', '#9a978f', '#6e6c67']) });
    }
  }
  for (const [x, y] of [[450, 2980], [920, 2990], [430, 3430], [880, 3430]]) B.tree(x, y, 1.2);
  B.light(1120, 3380, 150, '#ffd9a0', 0.1);
  B.light(945, 3345, 120, '#ffe7b0', 0.05);
  B.lamp(1420, 3240, { color: L.LAMP_COLOR });
  B.decor('sign', 1300, 3500, 0, 1);

  // =====================================================================================
  // Field hospital: a HESCO compound across County Road 9, tents, trucks, the helipad
  const K0 = 5770, K1 = 6530, KN = 3220, KS = 3980, T = 44;
  const gate = [C9 - RW - 35, C9 + RW + 35];
  B.runX('hesco', KN, K0 - T / 2, K1 + T / 2, [[6090, 6230]], T, { maxLen: 170 });
  B.runX('hesco', KS, K0 - T / 2, K1 + T / 2, [[6300, 6430]], T, { maxLen: 170 });
  B.runY('hesco', K0, KN + T / 2, KS - T / 2, [gate], T, { maxLen: 170 });
  B.runY('hesco', K1, KN + T / 2, KS - T / 2, [gate], T, { maxLen: 170 });
  B.ob('booth', K0 + 50, C9 - RW - 45, 52, 52, 0);
  B.ob('booth', K1 - 50, C9 + RW + 45, 52, 52, 0);
  for (const [x, y, w, h] of [[5900, 3330, 150, 88], [6090, 3330, 150, 88], [6400, 3330, 150, 88],
    [5910, 3870, 150, 88], [6110, 3870, 150, 88]]) B.ob('tent', x, y, w, h, 0, { color: '#50593a', roof: '#606a42' });
  B.ob('sandbags', K0 + 150, C9 - RW - 60, 24, 90, 0);
  B.ob('sandbags', K1 - 150, C9 + RW + 60, 24, 90, 0);
  B.ob('sandbags', 6160, KN + 120, 110, 22, 0);
  B.vehicle('truck', 6380, 3860, Math.PI / 2, { jitter: 0 });
  B.vehicle('truck', 6470, 3860, Math.PI / 2 + 0.06, { jitter: 0, wrecked: rng.chance(0.3) });
  B.ob('container', 6300, 3480, 60, 42, 0, { color: '#4a4f35', roof: '#3f432d' });   // generator
  B.ob('container', 5850, 3470, 150, 56, 0, { color: rng.pick(L.CONTAINER_COLORS) });
  B.vehicle('truck', 5480, C9 - 30, Math.PI + 0.25, { wrecked: true, burning: true });   // the convoy that didn't make it
  B.vehicle('suv', 6900, C9 + 40, -0.3, { wrecked: true });
  for (const s of [-1, 1]) B.ob('barrier', s < 0 ? K0 - 180 : K1 + 180, C9 + s * 40, 20, 110, 0);
  for (const [x, y] of [[K0 + 22, KN + 22], [K1 - 22, KN + 22], [K0 + 22, KS - 22], [K1 - 22, KS - 22]]) {
    B.decor('lamp_post', x, y, 0, 1.2);
    B.light(x, y, 320, L.FLOOD_COLOR, 0);
  }
  B.light(HX, HY, 150, '#c8e0ff', 0);
  B.decor('flag', 6160, 3470, 0, 1, true);
  for (let i = 0; i < 5; i++) B.decor('cone', K0 - 70, C9 - 60 + i * 30, 0, 1);

  // =====================================================================================
  // The interchange: the pileup on Route 7 under the deck, wrecks up on the interstate
  B.semi(W7 - 30, 1210, Math.PI / 2 + 0.35, -1.1, { wrecked: true });
  B.vehicle('car', W7 + 40, 860, Math.PI / 2 - 0.3, { wrecked: true, burning: true });
  B.vehicle('suv', W7 - 40, 760, -Math.PI / 2 + 0.2);
  B.vehicle('car', W7 + 30, 1520, Math.PI / 2 + 0.1, { wrecked: rng.chance(0.5) });
  B.vehicle('van', W7 - 35, 1900, -Math.PI / 2 - 0.15, { wrecked: true });
  B.vehicle('car', W7 + 35, 480, Math.PI / 2);
  B.deckVehicle('semi', 3000, I70 - 60, 0.12, {});
  B.deckVehicle('car', 3300, I70 + 70, Math.PI - 0.3, { wrecked: true, burning: true });
  B.deckVehicle('car', W7 + 20, I70 + DW / 2 + 4, Math.PI / 2 - 0.1, { wrecked: true, pitch: -0.5, roll: 0.1 });
  B.deckVehicle('suv', 4100, I70 - 40, 0.05, { wrecked: rng.chance(0.5) });
  B.deckVehicle('van', 5200, I70 + 60, Math.PI + 0.2, { wrecked: true });
  B.deckVehicle('car', 1900, I70 + 30, -0.2, {});
  for (const [y, fl] of [[I70 - 110, 0.1], [I70 + 110, 0.3]]) B.light(W7, y, 210, L.SODIUM_COLOR, fl, DZ - 36 - 26 - 4);
  for (const y of [300, 1700, 2600]) B.lamp(W7 - RW - 40, y, { color: L.SODIUM_COLOR, r: 230 });
  B.decor('sign', W7 + RW + 40, 1560, Math.PI / 2, 1.2);
  B.decor('sign', W7 - RW - 40, 480, -Math.PI / 2, 1.2);

  // =====================================================================================
  // Miller Quarry & Lumber: the pit under its rock face, gravel heaps, the sawmill, trucks
  for (let i = 0; i < 11; i++) {
    const a = Math.PI + (i / 10) * (Math.PI / 2) + rng.centered() * 0.05;
    const x = 1230 + Math.cos(a) * 560, y = 1010 + Math.sin(a) * 520;
    B.ob('rock', x, y, rng.range(120, 160), rng.range(80, 110), a + Math.PI / 2, { color: rng.pick(['#8a8378', '#7c766c', '#958d80']) });
  }
  for (const [x, y] of [[860, 760], [1060, 640], [800, 950]]) B.ob('rock', x, y, 110, 90, rng.range(0, TAU), { color: '#a39a88' });   // gravel heaps
  B.ob('building', 1450, 930, 280, 150, 0, { color: '#8d8a82', roof: '#4f5a60' });   // sawmill
  B.ob('building', 1540, 1300, 120, 90, 0, { color: '#7a6a55', roof: '#4a3f33' });   // office
  for (const [x, y, a] of [[1100, 1330, 0.05], [1100, 1400, -0.02], [1300, 1460, 0.08]]) B.ob('container', x, y, 150, 56, a, { color: '#6b4a2c', roof: '#5a3d24' });   // lumber stacks
  B.vehicle('truck', 950, 1180, -0.6, { color: '#c9a227', jitter: 0 });   // dump trucks
  B.vehicle('truck', 1320, 1150, 2.3, { color: '#c9a227', wrecked: true });
  B.semi(1500, 1620, 0.02, 0.4, { trailerColor: '#8d9aa0' });
  B.light(1450, 1030, 160, '#ffe2a0', 0.1);
  B.light(1540, 1370, 120, '#cfe6ff', 0.3);
  B.fire(1000, 850, 12);
  B.decor('lamp_post', 900, 1450, 0, 1.2);
  B.light(900, 1450, 300, L.FLOOD_COLOR, 0);

  // =====================================================================================
  // Radio Hill: the mast (objective), the transmitter hut behind a chain-link fence, rocks
  B.ob('building', 5640, 5760, 150, 90, 0, { color: '#8d8a82', roof: '#4f5a60' });
  B.ob('container', 5980, 5780, 60, 42, 0, { color: '#4a4f35', roof: '#3f432d' });
  B.runX('wall', 5400, 5480, 6160, [], 6, { color: CHAIN, solid: false, maxLen: 340 });
  B.runX('wall', 5960, 5480, 6160, [[5760, 5880]], 6, { color: CHAIN, solid: false, maxLen: 340 });
  B.runY('wall', 5480, 5400, 5960, [[5440, 5560]], 6, { color: CHAIN, solid: false, maxLen: 340 });
  B.runY('wall', 6160, 5400, 5960, [], 6, { color: CHAIN, solid: false, maxLen: 340 });
  B.vehicle('pickup', 5580, 5500, 0.1, { color: '#e3e3e3' });
  B.vehicle('car', 5320, 5500, 0.3, { wrecked: true, burning: true });
  B.boulders(5250, 5150, 6450, 6250, 14, { min: 60, max: 120, spacing: 90 });
  B.light(5640, 5830, 130, '#ffe2a0', 0.2);
  B.decor('lamp_post', 5500, 5420, 0, 1.2);
  B.light(5500, 5420, 280, L.FLOOD_COLOR, 0);

  // =====================================================================================
  // Shady Pines trailer park: two rows of trailers either side of the lanes
  B.box('gravel', 700, 5560, 1940, 5620);
  B.box('gravel', 700, 6160, 1940, 6220);
  for (const [row, y] of [[0, 5790], [1, 6060]]) {
    for (let x = 780; x <= 1860; x += 120) {
      if (x > 1240 && x < 1360) continue;   // the entry lane
      if (rng.chance(0.12)) continue;
      const burnt = rng.chance(0.15);
      const color = burnt ? L.mixColor(rng.pick(TRAILERS), '#221e1b', 0.5) : rng.pick(TRAILERS);
      B.ob('bus', x + rng.centered() * 6, y + (row ? 1 : -1) * rng.range(0, 10), 180, 56, Math.PI / 2 + rng.centered() * 0.04, { color });
      if (burnt && rng.chance(0.5)) B.fire(x, y - 40, 20);
    }
  }
  B.runX('wall', 5480, 680, 1960, [[1240, 1360]], 6, { color: CHAIN, solid: false, maxLen: 320 });
  B.runY('wall', 680, 5480, 6320, [[5860, 5980]], 6, { color: CHAIN, solid: false, maxLen: 320 });
  B.runY('wall', 1960, 5480, 6320, [[5900, 6000]], 6, { color: CHAIN, solid: false, maxLen: 320 });
  B.vehicle('pickup', 1050, 5590, 0.05, { wrecked: rng.chance(0.4) });
  B.vehicle('car', 1650, 6190, Math.PI + 0.1);
  B.vehicle('car', 800, 6190, 0.2, { wrecked: true });
  for (const [x, y] of [[900, 5900], [1500, 5920], [1780, 6300]]) B.fire(x, y, 12);
  B.light(1300, 5590, 160, '#ffcf80', 0.2);
  B.light(1650, 6090, 120, '#ffd9a0', 0.15);
  B.lamp(1360, 5420, { color: L.SODIUM_COLOR, r: 230 });

  // =====================================================================================
  // Lake Harlan marina: boathouse, bait & tackle, the dock out onto the lake
  B.ob('building', 3290, 6360, 200, 120, 0, { color: '#6b5a44', roof: '#4a3f33' });
  B.ob('building', 3930, 6350, 170, 100, 0, { color: '#7a6a55', roof: '#3f4a52' });
  B.vehicle('pickup', 3420, 6230, Math.PI / 2, { color: '#3b4a3a' });
  B.vehicle('suv', 3780, 6230, Math.PI / 2 + 0.1, { wrecked: rng.chance(0.4) });
  B.vehicle('car', 4020, 6230, Math.PI / 2 - 0.05, { wrecked: true, burning: true });
  B.vehicle('car', W7 + 30, 5650, Math.PI / 2, { wrecked: rng.chance(0.5) });
  for (const y of [6600, 6900]) B.lamp(3600 + (y > 6700 ? 30 : -30), y, { color: '#ffd89a', dead: false });
  B.light(3290, 6440, 140, '#ffcf80', 0.15);
  B.light(3930, 6420, 140, '#bfe4ff', 0.2);
  B.lamp(3150, 6200, { color: L.SODIUM_COLOR, r: 230 });
  B.lamp(4050, 6200, { color: L.SODIUM_COLOR, r: 230 });

  // =====================================================================================
  // Scattered farmsteads and wrecks along the roads (between the points of interest)
  B.ob('building', 4700, 2280, 180, 130, 0.02, { color: '#8c7b6a', roof: '#4f4a52' });
  B.ob('building', 2500, 4700, 170, 120, -0.03, { color: '#9a917f', roof: '#5a3f35' });
  B.ob('building', 6700, 4900, 200, 140, 0.04, { color: '#7d3a2c', roof: '#5a2b22' });
  B.ob('building', 1900, 3950, 160, 110, 0, { color: '#8c8478', roof: '#6b4a3a' });
  B.vehicle('car', 1500, C9 + 10, 0.1, { wrecked: true });
  B.vehicle('pickup', 4800, C9 - 40, Math.PI - 0.2, { wrecked: rng.chance(0.5) });
  B.vehicle('car', 700, 2260, 0.4, { wrecked: true, burning: rng.chance(0.5) });
  B.vehicle('van', 2900, 5290, Math.PI + 0.1, { wrecked: true });
  B.vehicle('car', 5200, 4400, Math.PI / 2 + 0.15, { wrecked: rng.chance(0.4) });
  B.vehicle('car', 6900, 1710, Math.PI + 0.2, { wrecked: true });
  B.vehicle('suv', W7 + 20, 4900, -Math.PI / 2, { wrecked: rng.chance(0.3) });
  B.light(4700, 2360, 130, '#ffcf80', 0.15);
  B.light(6700, 4990, 130, '#ffcf80', 0.15);
  for (const [x, y] of [[W7 - RW - 40, 4600], [W7 + RW + 40, 5500], [1800, C9 - RW - 40], [5000, C9 + RW + 40], [6600, C9 - RW - 40]]) {
    B.lamp(x, y, { color: L.SODIUM_COLOR, r: 230, deadChance: 0.35 });
  }

  // ---- woods between the points of interest
  const woods = [
    [2250, 520, 600, 260, 22], [4900, 450, 560, 240, 18], [6700, 520, 360, 300, 12],
    [300, 2400, 240, 700, 14], [2700, 3000, 300, 380, 10], [4700, 3000, 420, 380, 12],
    [5300, 2600, 300, 200, 6], [6900, 3000, 220, 380, 8],
    [450, 4500, 380, 520, 18], [2100, 4700, 520, 380, 18], [4600, 4700, 300, 300, 8],
    [6600, 4200, 420, 360, 14], [2350, 6300, 420, 200, 10], [4900, 6150, 300, 260, 10],
    [6700, 6300, 420, 600, 18], [6200, 2700, 260, 240, 7], [1800, 6750, 500, 280, 14],
    [300, 6800, 260, 300, 8], [1400, 2900, 260, 150, 5], [2900, 1750, 320, 200, 8],
  ];
  for (const [x, y, rx, ry, n] of woods) B.forest(x, y, rx, ry, n, { spacing: 70 });
  B.boulders(200, 200, W - 200, H - 200, 26, { spacing: 90 });

  // ---- decor
  B.skids(12, W7 - 70, 3200, W7 + 70, 4000, Math.PI / 2);
  B.skids(10, W7 - 70, 700, W7 + 70, 1500, -Math.PI / 2 + 0.3);
  B.skids(8, 1800, 2180, 2400, 2320, 0);
  B.cluster('debris', 30, W7, C9, 700);
  B.cluster('debris', 16, W7, 1200, 300);
  B.cluster('rubble', 10, W7 - 60, 1180, 120);
  B.cluster('blood_old', 20, W7, C9, 600);
  B.cluster('paper', 30, 3500, C9, 700);
  B.cluster('debris', 14, 6150, 3600, 350);
  B.cluster('blood_old', 10, 6150, 3600, 300);
  B.cluster('tire', 10, 1100, 1250, 300);
  B.cluster('rubble', 14, 950, 800, 300);
  B.cluster('oil', 8, 2250, 2250, 250, { s: [1, 2] });
  B.cluster('debris', 12, 1300, 5900, 400);
  B.cluster('oil', 6, W7, 1200, 200, { s: [1, 2] });
  for (const [x, y] of [[W7 - 60, 1100], [W7 + 50, 1330], [2450, 2170], [K0 - 100, C9 + 20]]) B.decor('cone', x, y, drng.range(0, TAU), 1);
  for (const [x, y] of [[W7 - 30, C9 - 110], [3200, C9 + 20], [4000, C9 - 20], [W7 + 30, 2700]]) B.decor('manhole', x, y, 0, 1);
  B.decor('sign', W7 + RW + 40, 2900, Math.PI / 2, 1.2);
  B.decor('sign', W7 - RW - 40, 4400, -Math.PI / 2, 1.2);
  B.decor('sign', 2700, C9 - RW - 40, 0, 1.1);
  B.decor('sign', 4600, C9 + RW + 40, Math.PI, 1.1);
  B.decor('sign', 400, 2330, 0, 1);
  B.decor('sign', 6800, 1790, Math.PI, 1);
  B.decor('sign', 400, 5380, 0, 1);
  B.decor('sign', 5100, 4000, -Math.PI / 2, 1);
  B.groundClutter({ cracks: 220, oil: 40, paper: 140, debris: 110, blood: 50, tires: 22, tufts: 1100, bushes: 320, rocks: 160 });
  B.sprinkle('bush', 80, 0, 0, W, H, { keep: true, s: [0.6, 1.2], on: ['grass', 'ground'] });
}
