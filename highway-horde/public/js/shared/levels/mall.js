// Westgate Mall — story level 3.1 (JOURNEY.md). Owner: agent C2.
//
// SPEC is the contract other parts depend on (the mission scripts, the engine, the tests): keep every
// section id (in this order), anchor name and gate id.
//
// The place, in travel order (north is -y), by day: the sun pours through the atrium's glass vault and
// the food court's skylights, while the department store is blacked out and the back corridors are dark.
//
//   LOT        The flooded car park west of the mall: rows of stalls, abandoned cars and carts, cart
//              corrals, standing water. The crew comes in from the road at the south-west corner and
//              crosses to the glass entrance (mall_doors).
//   ATRIUM     Two levels under a glass vault: the fountain, palms and kiosks on the ground floor, shops
//              round it under a mezzanine, the escalators up to the north gallery where Priya is
//              barricaded in the security office (terrain: the gallery is 150 up), dead neon everywhere.
//   FOODCOURT  The food court: counters and their kitchens along the north, the tables, the stage, the
//              walk-in freezers and the main kitchen along the south.
//   STORE      Harrow's department store, blacked out: cosmetics at the door, clothing and mannequins,
//              electronics (the TV wall), sporting goods, the pharmacy, the stockroom.
//   GARAGE     A split-level parking garage north of the store: the lower deck, a ramp up to the upper
//              deck (open to the sky), a ramp down to the exit lane and the pay booth.
//   DOCK       The loading dock yard east of the store: a truck at the bays, the dock office, the gate out.
//
// Everything the renderer needs beyond obstacles and roofs is listed in `map.levelArt`
// (render3d/levels/mall.js); the set dressing is hand placed (`map.dressItems`).

import { levelKit } from './hospital.js';

export const SPEC = Object.freeze({
  "id": "mall",
  "name": "Westgate Mall",
  "chapter": 3,
  "time": "day",
  "owner": "C2",
  "description": "A two-level mall gone dark: the flooded car park, the atrium and its fountain, the food court, a department store, the parking garage and the loading dock.",
  "sections": [
    {
      "id": "lot",
      "name": "Car Park"
    },
    {
      "id": "atrium",
      "name": "Grand Atrium"
    },
    {
      "id": "foodcourt",
      "name": "Food Court"
    },
    {
      "id": "store",
      "name": "Harrow's Department Store"
    },
    {
      "id": "garage",
      "name": "Parking Garage"
    },
    {
      "id": "dock",
      "name": "Loading Dock"
    }
  ],
  "anchors": {
    "lot": [
      "start",
      "lot_cart",
      "mall_entrance"
    ],
    "atrium": [
      "atrium_fountain",
      "security_office",
      "atrium_escalator"
    ],
    "foodcourt": [
      "food_stage",
      "food_freezer",
      "food_kitchen"
    ],
    "store": [
      "store_electronics",
      "store_sporting",
      "store_pharmacy"
    ],
    "garage": [
      "garage_ramp",
      "garage_booth",
      "garage_car"
    ],
    "dock": [
      "dock_truck",
      "dock_office",
      "dock_exit"
    ]
  },
  "gates": [
    {
      "id": "mall_doors",
      "kind": "door",
      "from": "lot",
      "to": "atrium",
      "label": "Mall entrance"
    },
    {
      "id": "food_shutter",
      "kind": "shutter",
      "from": "atrium",
      "to": "foodcourt",
      "label": "Food court shutter"
    },
    {
      "id": "store_shutter",
      "kind": "shutter",
      "from": "foodcourt",
      "to": "store",
      "label": "Store shutter"
    },
    {
      "id": "garage_door",
      "kind": "door",
      "from": "store",
      "to": "garage",
      "label": "Garage door"
    },
    {
      "id": "dock_gate",
      "kind": "shutter",
      "from": "garage",
      "to": "dock",
      "label": "Dock door"
    }
  ]
});

/** World size and mood (maps.js MAP_DEFS). */
export const DEF = { width: 11600, height: 4400, darkness: 0.6, tint: '#3a4a5c', ground: '#4a4a42' };

const HALF = Math.PI / 2;

/** Key places of the layout (the art reads some of them). */
export const MALL = Object.freeze({
  shell: { x0: 2600, y0: 700, x1: 9800, y1: 4000 },
  upper: { x0: 2616, y0: 716, x1: 4984, y1: 1500, h: 150 },
  deckB: { x0: 9600, y0: 76, x1: 11584, y1: 1200, h: 110 },
  fountain: { x: 3800, y: 2450 },
});

/**
 * Lay the level out.
 * @param {object} B map builder (maps.js createBuilder) with the level calls of JOURNEY.md §3
 */
export function build(B) {
  const K = levelKit(B, { wall: 16, door: 80, style: 'mall' });
  // an overcast day after the storm: the lot is flooded, everything wet; clouds break over the vault
  B.map.look = { day: { wet: 0.8, cover: 0.55, fog: 0.00026, az: 205, el: 40, mist: 0.6 }, night: { fogDensity: 0.00115, hemi: 0.8 } };

  B.section('lot', 'Car Park', 1300, 2200, 2600, 4400);
  B.section('atrium', "Grand Atrium", 3800, 2350, 2400, 3300);
  B.section('foodcourt', 'Food Court', 6100, 2350, 2200, 3300);
  B.section('store', "Harrow's Department Store", 8500, 2900, 2600, 2200);
  B.section('garage', 'Parking Garage', 9400, 930, 4400, 1740);
  B.section('dock', 'Loading Dock', 10700, 3100, 1800, 2600);

  buildLot(B, K);
  buildShell(B, K);
  buildAtrium(B, K);
  buildFoodCourt(B, K);
  buildStore(B, K);
  buildGarage(B, K);
  buildDock(B, K);

  const sx = 420, sy = 4120;
  B.anchor('start', sx, sy, 180);
  for (let k = 0; k < 6; k++) B.pspawn(sx - 100 + (k % 3) * 90, sy - 40 + Math.floor(k / 3) * 100);
  B.supply(sx + 240, sy - 60);
  K.finish();
}

// ---------------------------------------------------------------------------------------------
// LOT (x 0..2600)

function buildLot(B, K) {
  const { rng, drng } = B;
  B.box('asphalt', 0, 0, 2600, 4400);
  B.box('concrete', 2440, 700, 2600, 4000);                // the sidewalk along the façade
  B.box('asphalt', 0, 4200, 2600, 4400);                   // the road in
  B.line('yellow_double', 0, 4300, 2600, 4300, 3);
  // stall rows (north-south aisles at x 520, 1220, 1920)
  for (const [x0, x1] of [[160, 440], [600, 880], [1000, 1280], [1400, 1680], [1800, 2080]]) {
    for (let y = 300; y <= 3900; y += 58) { B.line('parking', x0, y, x0 + 110, y, 3); B.line('parking', x1 - 110, y, x1, y, 3); }
  }
  // the drive aisle along the façade and the crosswalk to the doors
  B.line('crosswalk', 2280, 2230, 2440, 2230, 44);
  // flooded low ground: the standing water is drawn by the art (walkable)
  for (const [x, y, w, h] of [[900, 1500, 900, 700], [1600, 2900, 1100, 800], [500, 3300, 600, 500], [2000, 800, 700, 500]]) {
    K.put('flood', x, y, 0, { w, d: h });
  }
  // parked and abandoned cars: in the stalls (some gone), a jam in the aisles, a crash into the corral
  for (const [x, y] of [[860, 2600], [1640, 1250], [1640, 3350], [440, 2000]]) B.ob('wall', x, y, 130, 30, 0, { style: 'corral', solid: false });
  const stall = (x, y, a) => {
    if (drng.chance(0.3) || B.blockedAt(x, y, 34)) return;
    B.vehicle(rng.pick(['car', 'car', 'suv', 'suv', 'pickup', 'van']), x, y, a + rng.range(-0.06, 0.06), { wrecked: drng.chance(0.15) });
  };
  for (const [x0, x1] of [[160, 440], [600, 880], [1000, 1280], [1400, 1680], [1800, 2080]]) {
    for (let y = 329; y <= 3870; y += 58 * 2) {
      if (y > 2050 && y < 2400) continue;                 // the lane to the doors
      stall(x0 + 55, y + (rng.next() < 0.5 ? 0 : 29), rng.next() < 0.5 ? 0 : Math.PI);
      stall(x1 - 55, y + 29, rng.next() < 0.5 ? 0 : Math.PI);
    }
  }
  // the jam: cars that tried to leave, nose to tail in the aisles
  for (const [x, y, a, k] of [[520, 1200, -HALF, 'suv'], [510, 1330, -HALF + 0.2, 'car'], [1220, 2900, HALF, 'van'], [1240, 3050, HALF - 0.3, 'car'], [1920, 1700, -HALF, 'pickup'], [1930, 1560, -HALF + 0.15, 'car']]) {
    B.vehicle(k, x, y, a, { wrecked: drng.chance(0.4) });
  }
  B.vehicle('car', 2300, 1600, 2.7, { wrecked: true, burning: true });
  B.vehicle('bus', 1100, 4150, 0.05, { wrecked: true, color: '#c9a227' });
  // cart corrals and loose carts
  B.anchor('lot_cart', 860, 2530, 140);
  for (let i = 0; i < 26; i++) {
    const x = drng.range(200, 2400), y = drng.range(300, 4100);
    if (B.blockedAt(x, y, 20)) continue;
    K.dress('cart', x, y, drng.range(0, 6.28), 1, drng.range(0.1, 0.8));
  }
  // light poles along the aisles, the pylon sign by the road, trees in the islands
  for (let y = 400; y < 4100; y += 600) for (const x of [520, 1220, 1920]) B.lamp(x, y, { a: 0, color: B.lib.LAMP_COLOR, deadChance: 0.5, r: 320 });
  K.put('pylon', 2300, 4050, 0, { h: 420 });
  for (const [x, y] of [[300, 700], [300, 2600], [2280, 3600], [2280, 900]]) { B.box('grass', x - 60, y - 60, x + 60, y + 60); B.tree(x, y, 1); }
  // the bus shelter on the road, the entrance canopy
  K.dress('busstop', 1300, 4230, Math.PI, 1, 0.2);
  K.put('entrycanopy', 2480, 2230, 0, { w: 180, d: 420 });
  B.anchor('mall_entrance', 2450, 2230, 150);
  // spawns: the road's ends, between the cars, behind the bus, along the façade's corners
  B.zspawn(120, 4300, 160, 120, 1, 'lot');
  B.zspawn(2500, 4300, 160, 120, 1, 'lot');
  B.zspawn(120, 200, 200, 200, 1, 'lot');
  B.zspawn(1300, 150, 400, 120, 1.2, 'lot');
  B.zspawn(2480, 900, 100, 300, 1, 'lot');
  B.zspawn(2480, 3600, 100, 300, 1, 'lot');
  B.zspawn(1900, 3950, 160, 100, 0.8, 'lot');
  B.checkpoint('lot', 520, 3800);
  B.checkpoint('lot', 1220, 2230);
  B.checkpoint('lot', 2250, 2400);
  // dressing
  K.scatter('puddle', 40, 100, 100, 2500, 4300, [1, 2.6], 6);
  K.scatter('litter', 40, 100, 100, 2500, 4300, [0.8, 1.2], 8);
  K.scatter('bag', 24, 100, 100, 2500, 4300, [0.8, 1.2], 8);
  K.scatter('paperf', 20, 100, 100, 2500, 4300, [0.8, 1.3], 6);
  K.scatter('shoe', 10, 100, 100, 2500, 4300, [0.9, 1.1], 8);
  K.scatter('suitcase', 6, 100, 1800, 2500, 2700, [0.9, 1.1], 10);
  K.scatter('glassf', 12, 100, 100, 2500, 4300, [0.9, 1.6], 4);
  K.scatter('leaves', 14, 100, 100, 2500, 4300, [0.8, 1.5], 6);
  K.scatter('box', 10, 100, 100, 2500, 4300, [0.9, 1.2], 8);
  for (const [x, y, a] of [[2300, 2080, 0.4], [2350, 2380, 1.1], [2150, 2150, 2.4]]) K.dress('barricade', x, y, a, 1, 0.3);
  K.dress('stroller', 2200, 2450, 0.6, 1, 0.5);
  K.dress('teddy', 2230, 2470, 0.2, 1, 0.6);
  for (const [x, y] of [[2350, 1900], [2380, 2600], [2340, 3100]]) K.dress('bench', x, y, HALF, 1, 0.4);
  for (const [x, y] of [[2420, 1500], [2420, 3000]]) K.dress('bin', x, y, 0, 1, 0.5);
}

// ---------------------------------------------------------------------------------------------
// The mall's shell

function buildShell(B, K) {
  const S = MALL.shell;
  const EXT = 24;
  // west façade: the glass entrance (mall_doors) in the middle
  K.wall(S.x0, S.y0, S.x0, 2130, { t: EXT, style: 'mall-ext', section: 'atrium' });
  K.gateIn('mall_doors', 'door', S.x0, 2230, 200, false, { t: EXT, section: 'atrium', label: 'Mall entrance', frame: 'mall-ext', h: 96 });
  K.wall(S.x0, 2330, S.x0, S.y1, { t: EXT, style: 'mall-ext', section: 'atrium' });
  // the atrium's glass wall onto the car park either side of the doors (the sun comes in through it)
  K.windowRow(S.x0, 1530, S.x0, 2120, 150, { w: 124, h: 210, sill: 12, t: EXT, section: 'atrium', style: 'mall-ext' });
  K.windowRow(S.x0, 2340, S.x0, 3090, 150, { w: 124, h: 210, sill: 12, t: EXT, section: 'atrium', style: 'mall-ext' });
  // north (atrium + food court), south (all along), the food court / garage wall
  K.wall(S.x0, S.y0, 7200, S.y0, { t: EXT, style: 'mall-ext', section: 'atrium' });
  K.wall(S.x0, S.y1, S.x1, S.y1, { t: EXT, style: 'mall-ext', section: 'store' });
  K.wall(7200, S.y0, 7200, 1800, { t: EXT, style: 'mall-ext', section: 'foodcourt' });
  // the fences that close the service yards north and south of the mall
  B.ob('wall', S.x0, 350, 30, 700, 0, { style: 'mallfence', section: 'lot' });
  B.ob('wall', S.x0, 4200, 30, 400, 0, { style: 'mallfence', section: 'lot' });
  // hard floors under the whole building, the service roads north and south (seen through the glass)
  B.box('concrete', S.x0, S.y0, S.x1, S.y1);
  B.box('asphalt', S.x0 + 16, 60, 7200, S.y0 - 12);
  B.box('concrete', 7200, 0, 11600, 1812);                 // the garage's decks
  B.box('asphalt', S.x0 + 16, S.y1 + 12, 9800, 4400);
  // the rooftops (the art: gravel, plant, the glass vault)
  K.put('mallroof', 3800, 2350, 0, { x0: S.x0, y0: S.y0, x1: 7200, y1: S.y1, h: 330, skirt: 'e' });
  K.put('mallroof', 8500, 2900, 0, { x0: 7200, y0: 1800, x1: S.x1, y1: S.y1, h: 240, skirt: 'n' });
}

// ---------------------------------------------------------------------------------------------
// ATRIUM (x 2616..4984)

function buildAtrium(B, K) {
  const S = 'atrium';
  const U = MALL.upper;
  const R = (x0, y0, x1, y1, style, o = {}) => K.roof(x0, y0, x1, y1, { kind: 'mall', height: o.h || 150, section: S, style, dark: o.dark ?? 0.6 });
  // ---- the upper level (a plateau): the north gallery, the security office, closed shops
  K.plateau(U.x0, U.y0, U.x1, U.y1, U.h);
  K.guard(U.x0, U.y0, U.x1, U.y1);
  // the escalators: two lanes rising north from the atrium floor to the gallery
  const EY0 = U.y1, EY1 = 1820;
  for (const [x0, x1] of [[3700, 3790], [3810, 3900]]) K.flightY(EY0, EY1, x0, x1, 0, U.h, -1, EY0, 48);
  K.guard(3700, EY0, 3900, EY1);
  for (const x of [3695, 3800, 3905]) B.ob('wall', x, (EY0 + EY1) / 2 + 4, 10, EY1 - EY0 - 8, 0, { style: 'escalator-side', section: S, solid: false });
  K.put('escalators', 3800, (EY0 + EY1) / 2, 0, { x0: 3690, x1: 3910, y0: EY0, y1: EY1, h: U.h, lanes: 2 });
  B.anchor('atrium_escalator', 3800, 1900, 120);
  // the gallery's balustrade (glass; you can shoot through it, not fall off)
  for (const [x0, x1] of [[U.x0, 3690], [3910, U.x1]]) B.ob('wall', (x0 + x1) / 2, U.y1 + 5, x1 - x0, 10, 0, { style: 'balustrade', section: S, solid: false });
  // gallery walkway y 1240..1500; the upper rooms behind a wall at y 1240
  const GY = 1240;
  K.wall(U.x0, GY, U.x1, GY, { section: S, style: 'mall', doors: [{ at: 3900, w: 100, kind: 'leaf', style: 'secdoor' }, { at: 3150, w: 90, kind: 'leaf' }] });
  for (const x of [3000, 3620, 4180, 4600]) K.wall(x, U.y0 + 8, x, GY - 8, { section: S, style: 'mall' });
  // the security office (x 3620..4180): Priya's barricade inside, monitors, lockers; a window onto the gallery
  K.windowRow(3620, GY, 4180, GY, 120, { w: 90, h: 46, sill: 40, section: S, style: 'mall', kind: 'glass', skip: [[3850, 3960]] });
  R(3620, U.y0, 4180, GY, 'wg-security', { h: 125 });
  R(3000, U.y0, 3620, GY, 'wg-backroom', { h: 125 });
  R(U.x0, GY, U.x1, U.y1, 'wg-gallery', { h: 140, dark: 0.45 });
  // (the closed shops behind their shutters: shut rooms, no way in)
  for (const [x0, x1] of [[U.x0, 3000], [4180, 4600], [4600, U.x1]]) R(x0, U.y0, x1, GY, 'wg-void', { h: 120 });
  B.ob('desk', 3760, 960, 150, 50, 0, { style: 'secdesk', section: S });
  B.ob('cabinet', 4150, 1000, 40, 200, 0, { style: 'monitors', section: S });
  B.ob('cabinet', 3660, 1100, 40, 180, 0, { style: 'lockers-mall', section: S });
  B.ob('desk', 3880, 1180, 120, 36, 0.12, { style: 'barricade-desk', section: S });
  B.anchor('security_office', 3900, 1320, 120);
  // the back room (x 3000..3620): stock, a staff corridor feel
  B.ob('cabinet', 3300, 740, 500, 34, 0, { style: 'shelf-stock', section: S });
  // closed upper shops (shutters down: walls with the shutter art)
  for (const [x0, x1, name] of [[U.x0, 3000, 'up1'], [4180, 4600, 'up2'], [4600, U.x1, 'up3']]) {
    K.put('shopfront', (x0 + x1) / 2, GY + 9, 0, { w: x1 - x0 - 30, h: 110, base: U.h, kind: 'shutter', name });
  }
  // ---- the ground floor: shopfronts under the gallery (the plateau's face), the south shops under the mezzanine
  for (const [x0, x1, name] of [[2640, 3180, 'g1'], [3180, 3690, 'g2'], [3910, 4440, 'g3'], [4440, 4960, 'g4']]) {
    K.put('shopfront', (x0 + x1) / 2, U.y1 + 2, 0, { w: x1 - x0 - 20, h: 146, base: 0, kind: 'glass', name });
  }
  // south shops y 3300..3984: a phone shop (open), a clothes shop (open), two closed; the mezzanine over the walkway
  const SY = 3300;
  K.wall(2616, SY, 4984, SY, { section: S, style: 'mall-shop', doors: [{ at: 3000, w: 180, kind: 'glass' }, { at: 4200, w: 200, kind: 'glass' }] });
  for (const x of [3500, 3900, 4500]) K.wall(x, SY + 8, x, 3984, { section: S, style: 'mall' });
  R(2616, SY, 3500, 3984, 'wg-shop-phone', { h: 150 });
  R(3900, SY, 4500, 3984, 'wg-shop-clothes', { h: 150 });
  for (const [x0, x1] of [[3500, 3900], [4500, 4984]]) R(x0, SY, x1, 3984, 'wg-void', { h: 150 });
  K.put('shopfront', 3700, SY - 9, Math.PI, { w: 380, h: 146, base: 0, kind: 'shutter', name: 'g5' });
  K.put('shopfront', 4740, SY - 9, Math.PI, { w: 470, h: 146, base: 0, kind: 'shutter', name: 'g6' });
  K.windowRow(2616, SY, 3500, SY, 170, { w: 150, h: 96, sill: 12, section: S, style: 'mall-shop', skip: [[2900, 3100]] });
  K.windowRow(3900, SY, 4500, SY, 170, { w: 150, h: 96, sill: 12, section: S, style: 'mall-shop', skip: [[4090, 4310]] });
  K.put('mezzanine', 3800, 3200, 0, { x0: 2616, x1: 4984, y0: 3100, y1: SY, h: 150 });
  R(2616, 3100, 4984, SY, 'wg-arcade', { h: 150, dark: 0.55 });
  // the void under the vault: open to the sky for the engine (the glass lets the sun in), a room for the art
  K.glassRoom(2616, U.y1, 4984, 3100, { height: 430, section: S, style: 'wg-atrium' });
  // the phone shop and the clothes shop
  for (const [x, y] of [[2800, 3500], [3100, 3500], [3300, 3700]]) B.ob('counter', x, y, 120, 50, 0, { style: 'phonetable', section: S });
  B.ob('cabinet', 2640, 3640, 30, 500, 0, { style: 'phonewall', section: S });
  for (const [x, y, a] of [[4050, 3500, 0], [4300, 3520, 0.3], [4100, 3780, 0], [4350, 3800, -0.2]]) B.ob('desk', x, y, 110, 40, a, { style: 'clothesrack', section: S });
  for (const [x, y] of [[3980, 3900], [4440, 3420]]) K.put('mannequin', x, y, Math.PI / 2, {});
  // ---- the atrium floor: the fountain, palms, kiosks, columns, benches
  const F = MALL.fountain;
  B.ob('counter', F.x, F.y, 360, 360, 0, { style: 'fountain', section: S });
  B.anchor('atrium_fountain', F.x, F.y + 260, 140);
  for (const [x, y] of [[3200, 2000], [4400, 2000], [3200, 2900], [4400, 2900]]) B.ob('counter', x, y, 90, 90, 0, { style: 'palm', section: S });
  for (const [x, y, a] of [[3000, 2450, HALF], [4600, 2450, HALF], [3800, 2110, 0]]) B.ob('desk', x, y, 120, 70, a, { style: 'kiosk', section: S });
  for (const [x, y] of [[2900, 1700], [4700, 1700], [2900, 3000], [4700, 3000]]) B.ob('ipillar', x, y, 44, 44, 0, { style: 'mall-col', section: S, top: 430 });
  for (const [x, y, a] of [[3450, 2150, 0.1], [4150, 2150, -0.1], [3450, 2750, -0.1], [4150, 2750, 0.1]]) B.ob('desk', x, y, 100, 26, a, { style: 'mallbench', section: S });
  K.put('directory', 2800, 2230, HALF, {});
  K.put('banner', 3800, 2450, 0, { h: 360, w: 300 });
  // lights (few: the mall is on emergency power; by day the vault lights it)
  const L = (x, y, r, c, f = 0, h = 140) => B.light(x, y, r, c, f, h);
  L(3000, 3200, 260, '#ffe2b8', 0.2); L(4600, 3200, 260, '#ffe2b8');
  L(3900, 1370, 240, '#dfe8ff', 0.4, 150 + 130); L(3000, 1370, 220, '#ffe2b8', 0.6, 150 + 130); L(4600, 1370, 220, '#ffe2b8', 0, 150 + 130);
  L(3900, 1000, 220, '#dfe8ff', 0.5, 150 + 118);
  L(F.x, F.y, 420, '#9fd8ff', 0.1, 60);
  L(2800, 3650, 200, '#bfe0ff', 0.3, 140); L(4200, 3650, 200, '#ffd8b0', 0.5, 140);
  // spawns: the shops, the back room, the far end of the gallery
  B.zspawn(3100, 3780, 200, 120, 1, S);
  B.zspawn(4250, 3910, 160, 80, 1, S);
  B.zspawn(3300, 1000, 300, 120, 1, S);
  B.zspawn(4800, 1370, 120, 120, 1, S);
  B.zspawn(2750, 1370, 120, 120, 1, S);
  B.checkpoint(S, 2800, 2230);
  B.checkpoint(S, 3800, 2950);
  B.checkpoint(S, 4800, 2300);
  // dressing
  K.scatter('litter', 30, 2640, 1520, 4960, 3280, [0.8, 1.2], 8);
  K.scatter('paperf', 24, 2640, 1520, 4960, 3280, [0.8, 1.3], 6);
  K.scatter('glassf', 16, 2640, 1520, 4960, 3280, [0.9, 1.6], 4);
  K.scatter('bag', 14, 2640, 1520, 4960, 3280, [0.8, 1.2], 8);
  K.scatter('blood', 12, 2640, 1520, 4960, 3280, [0.8, 1.5], 6);
  K.scatter('clothes', 10, 2640, 1520, 4960, 3900, [0.8, 1.2], 8);
  K.scatter('puddle', 8, 2800, 1700, 4800, 3000, [0.8, 1.8], 6);
  for (const [x, y] of [[3350, 2400], [4250, 2600], [3600, 3050], [2950, 1900]]) K.dress('cart', x, y, 0.5 + x, 1, 0.4);
  for (const [x, y, a] of [[3900, 1420, 0.2], [3300, 1400, 1.4], [4400, 1440, 2.4]]) K.dress('barricade', x, y, a, 0.8, 0.4);
  K.dress('bodybag', 3700, 2800, 0.3, 1, 0.3);
  K.dress('stroller', 3400, 2600, 2.2, 1, 0.5);
  K.dress('vend', 2640, 1700, HALF, 1, 0.3);
  K.dress('atm', 2640, 1850, HALF, 1, 0.4);
}

// ---------------------------------------------------------------------------------------------
// FOOD COURT (x 5016..7184)

function buildFoodCourt(B, K) {
  const S = 'foodcourt';
  const R = (x0, y0, x1, y1, style, o = {}) => K.roof(x0, y0, x1, y1, { kind: 'mall', height: o.h || 150, section: S, style, dark: o.dark ?? 0.6 });
  // the atrium / food court wall with the food court shutter
  K.wall(5000, 716, 5000, 2150, { t: 24, section: S, style: 'mall' });
  K.gateIn('food_shutter', 'shutter', 5000, 2300, 300, false, { t: 24, section: S, label: 'Food court shutter', frame: 'mall', h: 130 });
  K.wall(5000, 2450, 5000, 3984, { t: 24, section: S, style: 'mall' });
  // north: five food counters (y 900..1300) with their kitchens, a service corridor behind (y 716..900)
  const NY = 1300, CY = 900;
  const stalls = [[5012, 5450, 'pizza'], [5450, 5890, 'wok'], [5890, 6330, 'burger'], [6330, 6770, 'taco'], [6770, 7188, 'coffee']];
  K.wall(5012, NY, 7188, NY, { section: S, style: 'mall', doors: stalls.map(([a, b]) => ({ at: (a + b) / 2 + 150, w: 80, kind: 'leaf', style: 'kitchen' })) });
  K.wall(5012, CY, 7188, CY, { section: S, style: 'kitchen', doors: stalls.map(([a, b]) => ({ at: (a + b) / 2 - 120, w: 80, kind: 'leaf', style: 'kitchen' })) });
  for (const [x] of stalls.slice(1)) K.wall(x, CY + 8, x, NY - 8, { section: S, style: 'kitchen' });
  stalls.forEach(([x0, x1, name], i) => {
    const cx = (x0 + x1) / 2;
    R(x0 + 8, CY, x1 - 8, NY, 'wg-stall', { h: 120, dark: 0.8 });
    B.ob('counter', cx - 40, NY + 40, x1 - x0 - 150, 44, 0, { style: 'foodcounter', section: S, label: name });
    B.ob('cabinet', cx + 60, CY + 40, 200, 40, 0, { style: 'kitchenline', section: S });
    K.put('stallsign', cx, NY + 8, 0, { w: x1 - x0 - 40, name, i });
  });
  R(5012, 716, 7188, CY, 'wg-service', { h: 120, dark: 0.85 });
  // the hall: tables and chairs, planters, the stage in the south-east
  // (the six lantern skylights are gaps in the engine's roof: the sun falls through them)
  K.glassRoom(5012, NY, 7188, 3400, { height: 300, section: S, style: 'wg-food', dark: 0.35, open: [5350, 6100, 6850].flatMap((x) => [1850, 2800].map((y) => ({ x0: x - 150, y0: y - 120, x1: x + 150, y1: y + 120 }))) });
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      const x = 5300 + col * 360 + (row % 2) * 120, y = 1650 + row * 380;
      if (x > 6900) continue;
      B.ob('desk', x, y, 70, 70, (row * 5 + col) * 0.37, { style: 'fctable', section: S });
    }
  }
  for (const [x, y] of [[5500, 2500], [6700, 2500]]) B.ob('counter', x, y, 80, 80, 0, { style: 'palm', section: S });
  B.ob('counter', 6700, 3230, 560, 220, 0, { style: 'stage', section: S });
  K.put('stagetruss', 6700, 3230, 0, { w: 560, d: 220 });
  B.anchor('food_stage', 6700, 3030, 130);
  // south: the walk-in freezers (x 5012..5500) and the main kitchen (x 5500..6400), behind a wall at y 3400
  const SY = 3400;
  K.wall(5012, SY, 6400, SY, { section: S, style: 'mall', doors: [{ at: 5250, w: 100, kind: 'leaf', style: 'freezer' }, { at: 5950, w: 110, kind: 'double', style: 'kitchen' }] });
  K.wall(5500, SY + 8, 5500, 3984, { section: S, style: 'kitchen' });
  K.wall(6400, SY, 6400, 3984, { section: S, style: 'mall' });
  R(5012, SY, 5500, 3984, 'wg-freezer', { h: 120, dark: 0.9 });
  R(5500, SY, 6400, 3984, 'wg-kitchen', { h: 130, dark: 0.85 });
  R(6400, 3400, 7188, 3984, 'wg-food', { h: 300, dark: 0.4 });
  B.anchor('food_freezer', 5250, 3320, 110);
  B.anchor('food_kitchen', 5950, 3480, 110);
  for (const y of [3560, 3800]) B.ob('cabinet', 5250, y, 400, 30, 0, { style: 'freezershelf', section: S });
  for (const [x, y, w, h] of [[5950, 3600, 500, 60], [5950, 3860, 500, 50], [6300, 3700, 50, 300]]) B.ob('counter', x, y, w, h, 0, { style: 'steelcounter', section: S });
  B.ob('cabinet', 5700, 3960, 300, 30, 0, { style: 'stoves', section: S });
  // the food court / store wall, the store shutter
  K.wall(7200, 1800, 7200, 2600, { t: 24, section: S, style: 'mall' });
  K.gateIn('store_shutter', 'shutter', 7200, 2750, 300, false, { t: 24, section: 'store', label: 'Store shutter', frame: 'mall', h: 130 });
  K.wall(7200, 2900, 7200, 3984, { t: 24, section: S, style: 'mall' });
  // lights: skylight daylight by day; at night the emergency lamps and a neon or two still on
  const L = (x, y, r, c, f = 0, h = 280) => B.light(x, y, r, c, f, h);
  L(5600, 2000, 380, '#ffe2b8', 0.1); L(6600, 2000, 380, '#ffe2b8', 0.5); L(6100, 2900, 360, '#ffe2b8');
  L(6700, 3150, 300, '#ff5ab0', 0.4, 170); L(5250, 3700, 200, '#bfe6ff', 0.2, 115); L(5950, 3700, 240, '#ffd8a0', 0.6, 125);
  L(5700, 1100, 200, '#ffb060', 0.5, 115); L(6550, 1100, 200, '#ffb060', 0, 115); L(6100, 800, 200, '#ff3a2a', 0.4, 115);
  // spawns: the service corridor, the kitchens, the freezers, the stage's back
  B.zspawn(5700, 800, 300, 90, 1, S);
  B.zspawn(6700, 800, 300, 90, 1, S);
  B.zspawn(5250, 3860, 200, 100, 1, S);
  B.zspawn(6100, 3900, 300, 80, 1, S);
  B.zspawn(6900, 3800, 300, 120, 1, S);
  B.checkpoint(S, 5200, 2300);
  B.checkpoint(S, 6100, 2600);
  B.checkpoint(S, 7000, 2750);
  K.scatter('litter', 40, 5040, 1340, 7160, 3380, [0.8, 1.2], 8);
  K.scatter('paperf', 20, 5040, 1340, 7160, 3380, [0.8, 1.3], 6);
  K.scatter('spill', 6, 5040, 1340, 7160, 3380, [0.8, 1.2], 20);
  K.scatter('blood', 12, 5040, 1340, 7160, 3380, [0.8, 1.6], 6);
  K.scatter('bag', 12, 5040, 1340, 7160, 3380, [0.8, 1.2], 8);
  K.scatter('glassf', 8, 5040, 1340, 7160, 3380, [0.9, 1.4], 4);
  for (const [x, y, a] of [[5200, 2700, 0.3], [6900, 2000, 1.4], [6200, 1500, 2.2]]) K.dress('chair', x, y, a, 1, 0.3);
  K.dress('bodybag', 6300, 2200, 0.8, 1, 0.3);
  K.dress('box_stack', 7100, 3500, 0.1, 1, 0.5);
}

// ---------------------------------------------------------------------------------------------
// STORE (x 7216..9784, y 1816..3984)

function buildStore(B, K) {
  const S = 'store';
  const R = (x0, y0, x1, y1, style, o = {}) => K.roof(x0, y0, x1, y1, { kind: 'mall', height: o.h || 180, section: S, style, dark: o.dark ?? 0.9 });
  // the store's north wall with the garage door; the east wall (the dock side)
  K.wall(7200, 1800, 8520, 1800, { t: 24, section: S, style: 'mall-ext' });
  K.gateIn('garage_door', 'door', 8600, 1800, 160, true, { t: 24, section: 'garage', label: 'Garage door', frame: 'mall-ext', h: 90 });
  K.wall(8680, 1800, 9800, 1800, { t: 24, section: S, style: 'mall-ext' });
  K.wall(9800, 1800, 9800, 4000, { t: 24, section: S, style: 'mall-ext' });
  // the stockroom in the north-east (x 9300..9784, y 1816..2700)
  K.wall(9300, 1816, 9300, 2700, { section: S, style: 'mall', doors: [{ at: 2450, w: 110, kind: 'double', style: 'stock' }] });
  K.wall(9300, 2700, 9784, 2700, { section: S, style: 'mall' });
  R(9300, 1816, 9784, 2700, 'wg-stock', { h: 170 });
  R(7216, 1816, 9300, 3984, 'wg-store', { h: 180 });
  R(9300, 2700, 9784, 3984, 'wg-store', { h: 180 });
  for (let x = 9340; x < 9760; x += 110) B.ob('cabinet', x, 2000, 40, 220, 0, { style: 'shelf-stock', section: S });
  // cosmetics by the door: glass counters in a square
  for (const [x, y, w, h] of [[7550, 2600, 200, 40], [7550, 2900, 200, 40], [7430, 2750, 40, 260], [7670, 2750, 40, 200]]) B.ob('counter', x, y, w, h, 0, { style: 'glasscounter', section: S });
  // clothing: racks and mannequins in the middle
  for (let i = 0; i < 12; i++) {
    const x = 7900 + (i % 4) * 230, y = 2300 + Math.floor(i / 4) * 360 + (i % 2) * 60;
    B.ob('desk', x, y, 120, 40, (i % 3) * 0.5, { style: 'clothesrack', section: S });
  }
  for (const [x, y, a] of [[7820, 2150, 0], [8000, 2100, 0.6], [8350, 3500, 2.2], [8650, 2200, 1.2], [7800, 3400, 2.8], [8900, 3000, 0.4], [8100, 3700, 1.9]]) K.put('mannequin', x, y, a, {});
  // electronics (north-east): the TV wall, display tables, the counter
  B.ob('cabinet', 9000, 1840, 500, 30, 0, { style: 'tvwall', section: S });
  for (const [x, y] of [[8900, 2200], [9180, 2200]]) B.ob('counter', x, y, 160, 70, 0, { style: 'displaytable', section: S });
  B.ob('counter', 9150, 2500, 60, 240, 0, { style: 'shopcounter', section: S });
  B.anchor('store_electronics', 8850, 2320, 120);
  // sporting goods (south-east): racks of bikes, tents, the gun cabinet
  B.ob('cabinet', 9760, 3500, 30, 700, 0, { style: 'sportwall', section: S });
  for (const [x, y] of [[9300, 3300], [9300, 3650]]) B.ob('desk', x, y, 200, 60, 0, { style: 'bikerack', section: S });
  B.ob('desk', 8900, 3600, 150, 120, 0.1, { style: 'tentdisplay', section: S });
  B.ob('counter', 9500, 3900, 400, 50, 0, { style: 'guncounter', section: S });
  B.anchor('store_sporting', 9450, 3780, 120);
  // pharmacy (south-west): shelves, the counter
  for (const y of [3500, 3680]) B.ob('cabinet', 7550, y, 420, 30, 0, { style: 'shelf-pharm', section: S });
  B.ob('counter', 7550, 3900, 420, 50, 0, { style: 'pharmcounter', section: S });
  B.ob('cabinet', 7240, 3700, 30, 400, 0, { style: 'shelf-pharm', section: S });
  B.anchor('store_pharmacy', 7550, 3800, 110);
  // aisle shelves across the middle-south
  for (const x of [8150, 8450]) B.ob('cabinet', x, 3450, 30, 400, 0, { style: 'shelf-general', section: S });
  // lights: a blackout; a few emergency lamps, a flickering one, the exit signs
  const L = (x, y, r, c, f = 0, h = 172) => B.light(x, y, r, c, f, h);
  L(7400, 2750, 220, '#ff4030', 0.25); L(8600, 1900, 220, '#ff4030', 0.3); L(9500, 3800, 200, '#ff4030', 0.2); L(8200, 2900, 240, '#e8f0ff', 0.9);
  L(9540, 2200, 180, '#ffd8a0', 0.5, 160);
  // spawns: the stockroom, behind the TV wall, the fitting rooms (south-west corner behind the pharmacy)
  B.zspawn(9540, 2400, 160, 200, 1, S);
  B.zspawn(8150, 3850, 200, 120, 1, S);
  B.zspawn(9000, 2600, 200, 120, 0.8, S);
  B.zspawn(7700, 2150, 200, 120, 1, S);
  B.checkpoint(S, 7400, 2400);
  B.checkpoint(S, 8400, 2900);
  B.checkpoint(S, 8600, 2000);
  K.scatter('clothes', 30, 7240, 1840, 9280, 3960, [0.8, 1.3], 8);
  K.scatter('box_open', 12, 7240, 1840, 9780, 3960, [0.9, 1.2], 10);
  K.scatter('box', 14, 7240, 1840, 9780, 3960, [0.9, 1.2], 10);
  K.scatter('paperf', 16, 7240, 1840, 9780, 3960, [0.8, 1.3], 6);
  K.scatter('glassf', 12, 7240, 1840, 9780, 3960, [0.9, 1.5], 4);
  K.scatter('blood', 10, 7240, 1840, 9780, 3960, [0.8, 1.5], 6);
  K.scatter('shoes', 10, 7240, 1840, 9280, 3960, [0.9, 1.1], 8);
  K.dress('bodybag', 8500, 3200, 1.1, 1, 0.3);
  K.dress('bicycle', 9150, 3450, 0.4, 1, 0.4);
}

// ---------------------------------------------------------------------------------------------
// GARAGE (x 7216..11584, y 76..1784): lower deck, ramp up, upper deck B (open), ramp down, the exit lane

function buildGarage(B, K) {
  const S = 'garage';
  const D = MALL.deckB;
  // the shell: the west wall (x 7200 from 60 to 700; the food court wall does the rest), north, east, south
  K.wall(7200, 60, 7200, 700, { t: 24, section: S, style: 'garage-ext' });
  K.wall(7200, 60, 11600, 60, { t: 24, section: S, style: 'garage-ext' });
  K.wall(11588, 60, 11588, 1800, { t: 24, section: S, style: 'garage-ext' });
  K.wall(9800, 1800, 11120, 1800, { t: 24, section: S, style: 'garage-ext' });
  K.gateIn('dock_gate', 'shutter', 11250, 1800, 260, true, { t: 24, section: 'dock', label: 'Dock door', frame: 'garage-ext', h: 120 });
  K.wall(11380, 1800, 11600, 1800, { t: 24, section: S, style: 'garage-ext' });
  // deck B (110 up) and its ramps
  K.plateau(D.x0, D.y0, D.x1, D.y1, D.h);
  K.guard(D.x0, D.y0, D.x1, D.y1);
  K.flightX(9100, D.x0, 290, 560, 0, D.h, 1, D.x0, 50);            // ramp up, rising east
  K.guard(9100, 290, D.x0, 560);
  K.flightY(D.y1, 1640, 11100, 11400, 0, D.h, -1, D.y1, 50);      // ramp down, falling south
  K.guard(11100, D.y1, 11400, 1640);
  K.put('ramp', 9350, 425, 0, { x0: 9100, x1: D.x0, y0: 290, y1: 560, h: D.h, axis: 'x' });
  K.put('ramp', 11250, 1420, 0, { x0: 11100, x1: 11400, y0: D.y1, y1: 1640, h: D.h, axis: 'y' });
  B.anchor('garage_ramp', 9000, 425, 120);
  // parapets on deck B's edges (a drop of 110), leaving the ramps
  B.ob('wall', D.x0 + 5, (D.y0 + 290) / 2, 10, 290 - D.y0, 0, { style: 'deckedge', section: S, solid: false });
  B.ob('wall', D.x0 + 5, (560 + D.y1) / 2, 10, D.y1 - 560, 0, { style: 'deckedge', section: S, solid: false });
  B.ob('wall', (D.x0 + 11100) / 2, D.y1 + 5, 11100 - D.x0, 10, 0, { style: 'deckedge', section: S, solid: false });
  B.ob('wall', (11400 + D.x1) / 2, D.y1 + 5, D.x1 - 11400, 10, 0, { style: 'deckedge', section: S, solid: false });
  for (const x of [11095, 11405]) B.ob('wall', x, (D.y1 + 1640) / 2, 10, 1640 - D.y1, 0, { style: 'deckedge', section: S, solid: false });
  for (const y of [285, 565]) B.ob('wall', (9100 + D.x0) / 2, y, D.x0 - 9100, 10, 0, { style: 'deckedge', section: S, solid: false });
  // the exit lane under deck B's edge is closed off from the lower deck (the way is over the top)
  K.wall(9620, D.y1, 9620, 1784, { t: 20, section: S, style: 'garage-int' });
  // roofs: the lower deck and the exit lane under slabs (open over the ramps: you drive up into the
  // daylight); deck B is open to the sky
  const G = (x0, y0, x1, y1, dark) => K.roof(x0, y0, x1, y1, { kind: 'industrial', height: 110, section: S, style: 'wg-garage', dark });
  G(7216, 560, 9600, 1784, 0.7); G(7216, 76, 9600, 290, 0.7); G(7216, 290, 9100, 560, 0.7);
  G(9640, D.y1 + 10, 11100, 1784, 0.75); G(11400, D.y1 + 10, 11584, 1784, 0.75); G(11100, 1640, 11400, 1784, 0.75);
  // the lower deck's top and the exit lane's (seen from deck B), with the ramps' openings
  K.put('mallroof', 8400, 930, 0, { x0: 7200, y0: 60, x1: 9600, y1: 1800, h: 122, kind: 'deck', holes: [{ x0: 9100, y0: 290, x1: 9600, y1: 560 }] });
  K.put('mallroof', 10600, 1500, 0, { x0: 9620, y0: D.y1, x1: 11600, y1: 1800, h: 122, kind: 'deck', holes: [{ x0: 11100, y0: D.y1, x1: 11400, y1: 1640 }] });
  K.put('deckB', (D.x0 + D.x1) / 2, (D.y0 + D.y1) / 2, 0, { x0: D.x0, y0: D.y0, x1: D.x1, y1: D.y1, h: D.h });
  // pillars on both decks (clear of the lanes), parked cars
  for (let x = 7500; x < 9400; x += 320) for (const y of [620, 1240]) B.ob('ipillar', x, y, 30, 30, 0, { style: 'garage-col', section: S, top: 110 });
  for (let x = 9900; x < 11500; x += 320) B.ob('ipillar', x, 640, 30, 30, 0, { style: 'garage-col', section: S, top: D.h + 110 });
  const { rng, drng } = B;
  for (let x = 7340; x < 9300; x += 110) {
    for (const [y, a] of [[330, HALF], [930, -HALF], [1540, -HALF]]) {
      if (drng.chance(0.35) || (y > 1500 && Math.abs(x - 8600) < 200)) continue;
      B.vehicle(rng.pick(['car', 'suv', 'car', 'van', 'pickup']), x, y, a + rng.range(-0.05, 0.05), { wrecked: drng.chance(0.15) });
    }
  }
  for (let x = 9780; x < 11500; x += 110) {
    for (const [y, a] of [[250, HALF], [1030, -HALF]]) {
      if (drng.chance(0.4) || (x > 11050 && y > 900)) continue;
      B.vehicle(rng.pick(['car', 'suv', 'car', 'pickup']), x, y, a + rng.range(-0.05, 0.05), { wrecked: drng.chance(0.2) });
    }
  }
  B.vehicle('suv', 10400, 820, 0.1, { color: '#2f4858' });
  B.anchor('garage_car', 10400, 720, 120);
  // the pay booth and the barrier in the exit lane
  B.ob('booth', 10700, 1580, 70, 60, 0, { style: 'paybooth', section: S });
  K.put('barrierarm', 10900, 1560, HALF, { w: 150 });
  B.anchor('garage_booth', 10700, 1470, 110);
  // lights: sodium tubes under the lower deck (half dead), daylight on deck B
  for (let x = 7500; x < 9400; x += 480) for (const y of [470, 1090]) B.light(x, y, 280, '#ffc070', (x / 480) % 3 === 0 ? 0.5 : 0, 104);
  B.light(10500, 1500, 260, '#ffc070', 0.3, 104);
  B.light(11250, 1700, 200, '#ff4030', 0.3, 100);
  // spawns: the lower deck's far corners, the stairs cores, the upper deck's far end
  B.zspawn(7350, 200, 140, 140, 1, S);
  B.zspawn(7350, 1700, 140, 100, 1, S);
  B.zspawn(11480, 500, 140, 100, 1, S);
  B.zspawn(10200, 1650, 300, 100, 1, S);
  B.zspawn(8800, 750, 200, 80, 0.8, S);
  B.checkpoint(S, 8600, 1650);
  B.checkpoint(S, 8700, 470);
  B.checkpoint(S, 10400, 470);
  B.checkpoint(S, 11250, 1700);
  K.scatter('puddle', 14, 7300, 150, 11500, 1750, [1, 2.2], 6);
  K.scatter('litter', 20, 7300, 150, 11500, 1750, [0.8, 1.2], 8);
  K.scatter('bag', 8, 7300, 150, 11500, 1750, [0.8, 1.2], 8);
  K.scatter('cone_up', 6, 7300, 150, 11500, 1750, [0.9, 1.1], 10);
  K.scatter('cart', 8, 7300, 150, 11500, 1750, [1, 1], 20);
  K.scatter('glassf', 10, 7300, 150, 11500, 1750, [0.9, 1.5], 4);
}

// ---------------------------------------------------------------------------------------------
// DOCK (x 9812..11600, y 1812..4400)

function buildDock(B, K) {
  const S = 'dock';
  B.box('concrete', 9812, 1812, 11600, 4400);
  B.box('asphalt', 10300, 3600, 11600, 4400);
  B.ob('wall', 9800, 4200, 30, 400, 0, { style: 'mallfence', section: S });
  // the loading bays on the store's east wall, the truck backed onto the middle one
  for (const y of [2400, 2800, 3200]) K.put('dockbay', 9812, y, 0, { w: 150 });
  B.semi(9950, 2800, 0, 0, { trailerColor: '#d8d4c8', cabColor: '#2f4f6f' });
  B.anchor('dock_truck', 10300, 2680, 130);
  // the dock office (a small building with a door and windows) at the yard's east
  K.wall(10900, 2300, 11500, 2300, { section: S, style: 'office-ext' });
  K.wall(10900, 2800, 11500, 2800, { section: S, style: 'office-ext', doors: [{ at: 11050, w: 90, kind: 'leaf' }] });
  K.wall(10900, 2300, 10900, 2800, { section: S, style: 'office-ext' });
  K.wall(11500, 2300, 11500, 2800, { section: S, style: 'office-ext' });
  K.windowRow(10900, 2800, 11500, 2800, 140, { w: 90, h: 46, sill: 36, section: S, style: 'office-ext', skip: [[10990, 11110]] });
  K.windowRow(10900, 2300, 10900, 2800, 160, { w: 90, h: 46, sill: 36, section: S, style: 'office-ext' });
  K.roof(10908, 2308, 11492, 2792, { kind: 'office', height: 120, section: S, style: 'wg-office', dark: 0.7 });
  B.ob('desk', 11200, 2450, 120, 50, 0, { style: 'officedesk', section: S });
  B.ob('cabinet', 11470, 2600, 30, 200, 0, { style: 'filing', section: S });
  B.anchor('dock_office', 11050, 2900, 110);
  // the yard: containers, pallets, a forklift, dumpsters; the gate out (south)
  B.ob('container', 11350, 3300, 240, 60, HALF, { color: '#7a3b2e' });
  B.ob('container', 10600, 2000, 240, 60, 0, { color: '#2f5a78' });
  B.ob('container', 11500, 2100, 70, 56, 0, { style: 'dumpster', color: '#2f5a3a' });
  B.ob('container', 10000, 3700, 70, 56, 0.2, { style: 'dumpster', color: '#2f5a3a' });
  K.put('yardgate', 10800, 4380, 0, { w: 500 });
  B.anchor('dock_exit', 10800, 4230, 140);
  for (const [x, y] of [[10100, 2200], [10150, 3300]]) B.lamp(x, y, { a: 0, color: B.lib.SODIUM_COLOR, dead: false, r: 300 });
  B.light(9830, 2800, 200, '#ffd8a0', 0.3, 120);
  B.zspawn(11450, 4200, 200, 200, 1, S);
  B.zspawn(10100, 4200, 300, 200, 1, S);
  B.zspawn(11450, 2000, 120, 120, 0.8, S);
  B.checkpoint(S, 11250, 1950);
  B.checkpoint(S, 10600, 3000);
  B.checkpoint(S, 10800, 3900);
  K.scatter('pallet', 10, 9900, 1900, 11500, 4300, [0.9, 1.1], 20);
  K.scatter('crate', 8, 9900, 1900, 11500, 4300, [0.9, 1.1], 16);
  K.scatter('puddle', 12, 9900, 1900, 11500, 4300, [1, 2.2], 6);
  K.scatter('litter', 16, 9900, 1900, 11500, 4300, [0.8, 1.2], 8);
  K.dress('forklift', 10500, 3350, 1.2, 1, 0.2);
  K.dress('pallets', 10200, 3500, 0.2, 1, 0.3);
  K.dress('drums', 11150, 3700, 0.4, 1, 0.4);
}
