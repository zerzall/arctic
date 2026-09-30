// Harlan Farmstead (chapters 5–6): a barn, a farmhouse porch, an orchard and a pond at golden
// hour. See maps-hideouts.js for the hideout data contract.
//
//   the farmhouse (west) and the barn (east) look onto a yard with a bonfire and hay-bale seats;
//   the silo, the windmill and the chicken run are round the barn; the orchard fills the
//   south-middle, the pond and its dock the south-west; the range is the east paddock.

import { kit, stdSlot, TAU, PI, HALF } from './maps-hideouts-kit.js';

export function buildFarmstead(B) {
  const K = kit(B, 'farmstead', 'Harlan Farmstead', {
    chapters: [5, 6], defaultTime: 'day', bounds: { x0: 200, y0: 210, x1: 2010, y1: 1350 },
    look: {
      trees: ['oak', 'oak', 'oak', 'maple', 'oak', 'birch'],
      deciduous: 0.72,
      night: {
        ground: '#1c2a26', sky: '#7088b8', moon: '#a8c0f0', moonI: 0.7, hemi: 1.0,
        grade: { saturation: 1.02, contrast: 1.06, lift: [0.010, 0.012, 0.022], gain: [1.05, 1.0, 0.95] },
      },
      day: {
        az: 205, el: 12, warm: 1, haze: '#efc08e', horizon: '#ffd39c', zenith: '#3f6fb8', fog: 0.00042, cover: 0.5, heat: 0.15, ridge: '#8a6a5a', wet: 0.2,
        sunColor: '#ff9a48', sunI: 4.8, hemiSky: '#c4b8ae', hemiGround: '#6f8448', hemi: 0.95, exposure: 1.06, mist: 0.9, lampK: 0.55, fireK: 0.9,
        grade: { contrast: 1.07, saturation: 1.1, lift: [0.008, 0.005, 0.004], gain: [1.1, 1.0, 0.86], vignette: 0.3, bloom: 0.34, bloomThreshold: 1.3 },
      },
    },
  });
  const CF = { x: 1000, y: 790 };
  K.hub.scatter = ['pebbles', 'tallgrass', 'flowers', 'flowers', 'fern'];

  B.objective('diner', 'The Old Windmill', 1930, 800, 62, 62, 0, 1, 40);
  B.map.objective.prop = 'windmill';
  B.supply(300, 760);
  K.spawns(CF.x, CF.y, 200, 8, 0.2);

  // ---- ground: grass everywhere, the packed farmyard, lanes, the orchard floor, the pond
  B.box('grass', 0, 0, 2200, 1600);
  B.box('dirt', 640, 560, 1440, 1000);         // the farmyard
  B.area('dirt', 1000, 1000, 120, 320, 0);
  B.area('dirt', 1500, 620, 320, 120, 0.02);   // barn apron
  B.area('dirt', 640, 500, 240, 100, 0);       // porch path
  B.area('gravel', 1180, 1340, 260, 60, 0);    // the lane out
  B.box('dirt', 140, 1190, 1000, 1352);        // (worn ground by the pond)
  B.box('grass', 820, 900, 1500, 1350);        // orchard
  B.area('dirt', 1000, 1240, 700, 90, 0);
  B.box('dirt', 1500, 1000, 2020, 1350);       // the east paddock (range)
  B.area('dirt', 345, 520, 320, 200, 0);       // the garden plot
  // the pond: two water rects with the dock lane left between them
  B.box('water', 470, 1030, 780, 1138);
  B.box('water', 520, 990, 720, 1138);
  B.box('water', 440, 1070, 800, 1138);
  B.box('water', 470, 1186, 780, 1296);
  B.box('water', 520, 1186, 720, 1330);
  B.box('water', 440, 1186, 800, 1250);
  B.area('sand', 420, 1240, 120, 200, 0.3);

  // ---- the perimeter: white board fences, a lane gate in the south wall
  const per = (x, y, w, h) => K.ob('wall', 'perimeter', x, y, w, h, 0, { color: '#e8e2d0' });
  per(1100, 172, 1900, 66);
  per(1100, 1362, 1900, 20);
  per(170, 790, 40, 1170);
  per(2040, 790, 40, 1170);
  K.prop('gate', 1180, 1362, 0, { w: 200, farm: true });

  // ---- the buildings
  K.ob('building', null, 640, 360, 230, 150, 0, { color: '#eee8d8', roof: '#4a4038', top: 150, arch: 'house', lit: 1 });
  K.ob('building', null, 1500, 400, 210, 330, 0, { color: '#a3261c', roof: '#5c5a58', top: 150, arch: 'barn' });
  K.ob('silo', null, 1730, 260, 86, 86, 0, { color: '#c8ccd0' });
  K.ob('tent', 'coop', 1240, 650, 62, 48, 0, { color: '#8a6a44', roof: '#7a5a38' });
  K.ob('building', null, 300, 740, 120, 96, 0, { color: '#8a3a2c', roof: '#3a3a3c', top: 118, arch: 'shack', lit: 1 });
  K.ob('tent', 'slot:infirmary', 300, 1010, 150, 104, 0, { color: '#d8d4c0', roof: '#d8d4c0' });

  // ---- the bonfire and its hay-bale seats
  K.ob('pillar', 'campring', CF.x, CF.y, 58, 58, 0, { color: '#6d6a63' });
  K.fire(CF.x, CF.y, 22, 440, '#ff9a4a', 0.9);
  for (let k = 0; k < 8; k++) {
    if (k === 5) continue;
    const ang = 0.3 + (k / 8) * TAU;
    K.ob('rock', 'haybale', CF.x + Math.cos(ang) * 132, CF.y + Math.sin(ang) * 120, 50, 30, ang + PI / 2, { solid: false, color: '#c9a850' });
  }
  K.ob('rock', 'couch', 880, 720, 84, 34, -0.2, { solid: false, color: '#6a3f34' });

  // ---- the orchard: rows of apple trees (real obstacles)
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 7; col++) {
      const x = 900 + col * 116 + (row % 2) * 58, y = 1030 + row * 128;
      if (x > 1470) continue;
      const o = B.ob('tree', x, y, 30, 30, (col * 1.7 + row) % 6, { color: '#4a3826' });
      B.decor('tree_canopy', x, y, (col + row * 3) % 6, 0.72 + ((col * 7 + row * 3) % 5) * 0.03, true);
      o.prop = 'orchardtree';
    }
  }

  // ---- the stations
  K.ob('counter', 'maptable', 640, 512, 128, 64, 0, { color: '#8a6a44' });
  K.station('board', 'board', 640, 512, 112, 'Kitchen table', { h: 88 });
  K.prop('pergola2', 640, 512, 0, { w: 180, d: 110 });
  K.ob('booth', 'signboard', 900, 480, 122, 26, 0, { color: '#5a4630' });
  K.station('upgrades', 'upgrades', 900, 480, 100, 'Upgrade board', { h: 96 });
  K.ob('counter', 'workbench', 1700, 500, 112, 60, HALF, { color: '#5a4630' });
  K.station('workbench', 'workbench', 1700, 500, 112, 'Barn workbench', { h: 84 });
  K.prop('leanto', 1730, 500, HALF, { w: 190, d: 140, hi: 108, lo: 84, metal: true });
  K.station('bed', 'bed', 1450, 600, 90, 'Hayloft', { h: 100 });
  K.prop('bedlamp', 1400, 610, HALF, {});
  K.station('campfire', 'campfire', CF.x, CF.y, 150, 'Bonfire', { h: 110 });
  K.station('armory', 'armory', 300, 760, 118, 'Tool shed', { h: 90 });
  K.station('infirmary', 'infirmary', 300, 1010, 118, 'Infirmary', { h: 100 });
  K.ob('counter', 'rangebench', 1536, 1180, 40, 160, 0, { color: '#5a4630' });
  K.station('range', 'range', 1480, 1180, 105, 'Shooting range', { h: 70 });
  K.hub.range = {
    line: { x: 1510, y: 1180, a: 0 },
    targets: [
      { id: 'r1', x: 1710, y: 1122, a: PI },
      { id: 'r2', x: 1820, y: 1180, a: PI },
      { id: 'r3', x: 1930, y: 1238, a: PI },
      { id: 'r4', x: 1990, y: 1140, a: PI },
    ],
    backstop: { x: 2010, y0: 1060, y1: 1340 },
  };
  for (const [x, y, h] of [[2006, 1110, 110], [2006, 1260, 110]]) K.ob('rock', 'haybale', x, y, h, 30, HALF, { solid: false, color: '#c9a850' });

  // ---- upgrade slots
  const GEN = { x: 1860, y: 640 }, WT = { x: 1980, y: 380 }, MAST = { x: 1990, y: 520 };
  const GAR = { x: 345, y: 520, w: 300, h: 200 };
  K.ob('container', 'slot:generator', GEN.x, GEN.y, 76, 52, 0, { color: '#48544a' });
  K.ob('watchtower', 'slot:watchtower', WT.x, WT.y, 58, 58, 0, { color: '#5b4a36' });
  K.ob('pillar', 'slot:radiomast', MAST.x, MAST.y, 26, 26, 0, { color: '#8a8e92' });
  for (const [x, y, w, h] of [[GAR.x, GAR.y - GAR.h / 2, GAR.w, 10], [GAR.x, GAR.y + GAR.h / 2, GAR.w, 10], [GAR.x - GAR.w / 2, GAR.y, 10, GAR.h], [GAR.x + GAR.w / 2, GAR.y - 60, 10, 80]]) {
    K.ob('wall', 'slot:garden', x, y, w, h, 0, { color: '#6b5433', solid: true });
  }
  stdSlot(K, 'generator', GEN.x, GEN.y, 0, 90, 'Generator', {
    model: { cable: [[1825, 640], [1780, 600], [1730, 540]] },
    props: [[], [{ t: 'stringlights', id: 'g1', pts: [[1600, 640, 96], [1700, 600, 110], [1820, 640, 100]], sag: 8 }],
      [{ t: 'stringlights', id: 'g2', pts: [[720, 440, 118], [860, 560, 136], [1000, 700, 148]], sag: 12 }, { t: 'stringlights', id: 'g2b', pts: [[1000, 700, 148], [1250, 580, 134], [1400, 640, 118]], sag: 12 }],
      [{ t: 'stringlights', id: 'g3', pts: [[1000, 700, 148], [900, 950, 132], [820, 1040, 112]], sag: 12 }, { t: 'stringlights', id: 'g3b', pts: [[1000, 700, 148], [1200, 900, 136], [1420, 1010, 112]], sag: 12 }, { t: 'floodlight', x: 1350, y: 640, z: 150, aim: 0 }]],
    lights: [[], [{ x: 1700, y: 610, r: 260, color: '#ffd9a0', h: 96 }], [{ x: 860, y: 560, r: 300, color: '#ffcf8a', h: 130 }], [{ x: 1350, y: 650, r: 400, color: '#fff0d6', h: 150 }, { x: 900, y: 950, r: 300, color: '#ffd9a0', h: 130 }]],
  });
  stdSlot(K, 'watchtower', WT.x, WT.y, 0, 100, 'Watchtower', { lights: [[], [{ x: WT.x, y: WT.y, r: 300, color: '#ffc27a', h: 190 }], [], []] });
  stdSlot(K, 'infirmary', 300, 1010, 0, 118, 'Infirmary', { model: { w: 150, h: 104 }, lights: [[], [{ x: 380, y: 1010, r: 260, color: '#ff8a80', h: 70 }], [{ x: 300, y: 1010, r: 260, color: '#f4f7ff', h: 70 }], []] });
  stdSlot(K, 'armory', 300, 740, 0, 118, 'Armory', { model: { w: 120, h: 96 }, lights: [[], [{ x: 340, y: 780, r: 240, color: '#ffd090', h: 74 }], [], []] });
  stdSlot(K, 'radiomast', MAST.x, MAST.y, 0, 90, 'Radio mast', {});
  stdSlot(K, 'garden', GAR.x, GAR.y, 0, 150, 'Garden', { model: { w: GAR.w, h: GAR.h } });
  stdSlot(K, 'palisade', 1180, 1362, 0, 400, 'Palisade', {});

  // ---- details: the chicken run, the dock, a porch swing, a scarecrow, kids' things
  K.prop('dock', 800, 1162, PI, { len: 150 });
  K.prop('porchswing', 640, 452, HALF, {});
  K.prop('scarecrow', 1460, 860, 2.2, {});
  K.prop('picnic', 900, 900, 0.3, { game: 'checkers' });
  K.prop('guitar', 940, 840, 2.4);
  K.prop('cat', 1290, 600, PI);
  K.prop('orchardcrates', 1100, 1150, 0.3, {});
  K.prop('paintedsign', 1150, 1338, -HALF, { text: 'HAVEN OR BUST', w: 190, h: 40, z: 92 });
  K.prop('bunting', 0, 0, 0, { pts: [[520, 460, 96], [640, 470, 100], [760, 460, 96]] });
  K.prop('stringlights', 0, 0, 0, { id: 'base1', pts: [[540, 448, 100], [700, 620, 140], [1000, 700, 150]], sag: 12 });
  K.prop('stringlights', 0, 0, 0, { id: 'base2', pts: [[1400, 580, 100], [1200, 660, 142], [1000, 700, 150]], sag: 12 });
  for (const [x, y] of [[960, 860], [1080, 740], [640, 470], [1420, 610], [860, 500]]) K.prop('lantern', x, y, 0, { z: 8 });
  K.lamp(1000, 700, 148, 340, '#ffc98a', 0, 0.55);
  K.lamp(640, 470, 110, 240, '#ffd6a0', 0, 0.55);
  K.lamp(1440, 620, 110, 240, '#ffd6a0', 0, 0.55);
  K.lamp(900, 500, 100, 200, '#ffd6a0', 0, 0.45);
  K.lamp(1180, 1330, 150, 240, '#ffc27a', 0, 0.5);
  K.hub.firefly = [{ x: 620, y: 1160, w: 500, h: 400 }, { x: 1150, y: 1100, w: 500, h: 300 }];
  K.hub.chickens = [{ x: 1240, y: 690, r: 62, n: 10 }];
  K.npc('mara', 'Mara Voss', 'medic', 410, 1010, 0, 'stand', { station: 'infirmary' });
  K.npc('deke', 'Deke Harlan', 'mechanic', 1655, 500, 0.1, 'work', { station: 'workbench' });
  K.npc('ozzy', 'Ozzy', 'radio', 640, 468, HALF, 'stand', { station: 'board' });
  K.npc('june', 'June', 'kid', 930, 820, -0.5, 'sit');
  K.npc('okafor', 'Sgt. Okafor', 'quartermaster', 380, 770, PI, 'stand', { station: 'armory', recruit: 'okafor' });
  K.npc('priya', 'Priya Nair', 'scout', 1500, 585, HALF, 'watch', { z: 110, recruit: 'priya' });
  // ground clutter: tufts, pebbles, wildflowers (small decor, no collision)
  B.sprinkle('grass_tuft', 260, 60, 60, 2140, 1540, { s: [0.7, 1.5] });
  B.sprinkle('bush', 26, 60, 60, 2140, 1540, { s: [0.7, 1.3], keep: true });
  B.sprinkle('rock', 22, 60, 60, 2140, 1540, { s: [0.5, 1.1], off: ['water'] });
  K.dress(FARM_DRESS);
}

const FARM_DRESS = [
  ['hay', 1330, 470, 0.2, 1], ['hay', 1330, 520, 0.1, 1], ['hay_sq', 1300, 560, 0.3, 1], ['tractor', 1570, 640, 0.6, 1], ['tractor', 720, 1290, -0.8, 1],
  ['hay', 1800, 800, 0, 1], ['hay', 1850, 900, 0.3, 1], ['hay_sq', 1700, 860, 0, 1], ['woodpile', 1650, 330, 0.3, 1], ['wheelbarrow', 1110, 600, 0.5, 1],
  ['trough', 1150, 700, 0.1, 1], ['bench', 780, 440, HALF, 1], ['mailbox', 1240, 1340, HALF, 1], ['planter', 600, 470, 0, 1], ['planter', 680, 470, 0, 1],
  ['flowers', 590, 440, 0, 1], ['flowers', 700, 440, 0, 1], ['laundry', 480, 380, 0, 1], ['cooler', 1040, 850, 0.4, 1], ['bicycle', 780, 820, 1, 1],
  ['beachball', 1100, 880, 0, 1], ['teddy', 960, 890, 0.5, 1], ['gnome', 560, 520, 0.6, 1], ['crates', 1350, 690, 0.4, 1], ['ibc', 1780, 460, 0, 1],
  ['drums', 1860, 720, 0, 1], ['generator', 1820, 700, 0, 1], ['fuel_can', 1888, 690, 0.5, 1], ['chair', 990, 880, 0.7, 1], ['chair', 1130, 720, 2.6, 1],
  ['shrub', 480, 320, 0, 1], ['shrub', 800, 300, 0, 1], ['shrub', 240, 640, 0, 1], ['flowers', 250, 820, 0, 1], ['flowers', 1350, 780, 0, 1],
  ['tallgrass', 500, 960, 0, 1], ['reeds', 470, 1090, 0, 1], ['reeds', 760, 1250, 0, 1], ['lily', 600, 1080, 0, 1], ['lily', 540, 1260, 0, 1], ['rowboat', 470, 1180, 1.7, 1],
  ['boulders', 2130, 700, 0, 1.3], ['deadtree', 90, 200, 0, 1], ['pole', 1100, 100, 0, 1], ['scarecrow', 400, 560, 1, 1],
];
