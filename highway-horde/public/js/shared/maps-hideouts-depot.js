// Blackwater Depot (chapters 3–4): a rail depot beside a water tower. See maps-hideouts.js for
// the hideout data contract.
//
//   the north yard: the forge shed, the departures office, the mess tent, the water tower; the
//   fire in the middle with railway-sleeper seats; two tracks across the south with a dead
//   locomotive, three bunk boxcars and a caboose clinic; the south lot with the armory vault,
//   a garden and the range.

import { kit, stdSlot, TAU, PI, HALF } from './maps-hideouts-kit.js';

export function buildDepot(B) {
  const K = kit(B, 'depot', 'Blackwater Depot', {
    chapters: [3, 4], defaultTime: 'night', bounds: { x0: 200, y0: 210, x1: 2010, y1: 1350 },
    look: {
      night: {
        ground: '#121a24', sky: '#5c7898', moon: '#88a8d8', moonI: 0.66, hemi: 0.95,
        grade: { saturation: 0.98, contrast: 1.08, lift: [0.008, 0.014, 0.024], gain: [1.03, 1.0, 0.97] },
      },
      day: { az: 215, el: 30, haze: '#b8c6c8', horizon: '#ccdadc', zenith: '#3f78b8', fog: 0.0003, cover: 0.62, heat: 0.1, ridge: '#5d6f78', wet: 0.3, hemiGround: '#6a6a52', mist: 0.8 },
    },
  });
  const CF = { x: 1100, y: 690 };
  K.hub.scatter = ['pebbles', 'tallgrass', 'flowers'];

  B.objective('apc', 'Dead Locomotive', 640, 1020, 330, 64, 0, 1, 40);
  B.map.objective.prop = 'locomotive';
  B.supply(1110, 1290);
  K.spawns(CF.x, CF.y, 200, 8, 0.2);

  // ---- ground: the packed yard, the ballast band of the tracks, concrete aprons, the lot
  B.box('dirt', 0, 0, 2200, 1600);
  B.box('dirt', 150, 140, 2050, 1372);
  B.box('gravel', 150, 880, 2050, 1180);
  B.box('concrete', 250, 260, 640, 520);          // the forge apron
  B.box('concrete', 700, 380, 990, 560);          // the departures platform
  B.box('concrete', 1550, 400, 1650, 540);        // the water tower footing
  B.box('gravel', 1000, 210, 1340, 330);
  B.box('asphalt', 560, 1190, 1700, 1350);        // the lot
  B.line('white', 560, 1270, 1700, 1270, 3);
  B.area('gravel', 1100, 800, 130, 300, 0);
  B.area('gravel', 900, 620, 520, 100, 0.3);
  B.area('dirt', 620, 1265, 430, 190, 0);          // the garden plot
  B.box('gravel', 0, 1372, 2200, 1440);
  B.box('gravel', 0, 900, 150, 1180);
  B.box('gravel', 2050, 900, 2200, 1180);

  // ---- the perimeter: corrugated sheets and rail-iron posts; the track gates are drawn on the side walls
  const per = (x, y, w, h) => K.ob('wall', 'perimeter', x, y, w, h, 0, { color: '#6b6a64' });
  per(1100, 172, 1900, 66);
  per(1100, 1362, 1900, 20);
  per(170, 790, 40, 1170);
  per(2040, 790, 40, 1170);
  K.prop('gate', 170, 940, HALF, { w: 150, rail: true });
  K.prop('gate', 2040, 940, -HALF, { w: 150, rail: true });

  // ---- the rails and their sleepers
  K.prop('rails', 0, 0, 0, { x1: 152, y1: 940, x2: 2048, y2: 940 });
  K.prop('rails', 0, 0, 0, { x1: 152, y1: 1020, x2: 1180, y2: 1020 });
  K.prop('rails', 0, 0, 0, { x1: 1180, y1: 1120, x2: 2048, y2: 1120 });

  // ---- buildings
  K.ob('building', null, 430, 330, 300, 170, 0, { color: '#8a8d90', roof: '#4f5a60', top: 126, arch: 'industrial', lit: 1 });
  K.ob('building', 'departures', 830, 350, 150, 110, 0, { color: '#8a6a44', roof: '#3a4a4a', top: 128, arch: 'shack', lit: 1 });
  K.ob('tent', 'messtent', 1180, 385, 240, 130, 0, { color: '#6b6a44', roof: '#7a7a54' });
  // the water tower: four legs (the tank is a free prop, the gallery is the watchtower upgrade)
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) K.ob('pillar', 'nodraw', 1600 + dx * 44, 470 + dz * 44, 16, 16, 0, { color: '#4a4e52' });
  K.prop('watertower', 1600, 470, 0, {});

  // ---- the fire: railway sleepers around a ring, stacks of tyres behind
  K.ob('pillar', 'campring', CF.x, CF.y, 58, 58, 0, { color: '#6d6a63' });
  K.fire(CF.x, CF.y, 21, 420, '#ff9a4a', 0.95);
  for (let k = 0; k < 8; k++) {
    if (k === 6) continue;
    const ang = 0.3 + (k / 8) * TAU;
    K.ob('rock', 'logseat', CF.x + Math.cos(ang) * 128, CF.y + Math.sin(ang) * 118, 66, 24, ang + PI / 2, { solid: false, color: '#4a3a2c' });
  }
  K.prop('tirestack', CF.x - 210, CF.y - 80, 0.4, {});
  K.prop('tirestack', CF.x + 220, CF.y + 70, 1.4, {});

  // ---- the trains
  const boxcar = (x, y, v) => { const o = K.ob('bus', 'boxcar', x, y, 250, 62, 0, { color: ['#7a3a2a', '#3f5a48', '#5a4a3a'][v] }); o.variant = v; return o; };
  boxcar(1125, 940, 0);
  boxcar(1415, 940, 1);
  boxcar(1705, 940, 2);
  K.ob('bus', 'slot:infirmary', 1300, 1120, 190, 58, 0, { color: '#8a2a20' });
  K.prop('sleeperpile', 900, 880, 0.2, {});

  // ---- fires and lamps: the forge, drum fires along the tracks, sodium lamps
  K.lamp(330, 470, 44, 380, '#ff7a2a', 0.65, 0.95);   // the forge's glow
  K.ob('pillar', 'nodraw', 330, 462, 62, 44, 0, { color: '#7a4a3a' });
  K.prop('forge', 330, 462, 0, {});
  B.fire(760, 900, 14);
  B.fire(1000, 1200, 14);
  B.fire(1880, 900, 14);
  K.lamp(1110, 866, 130, 300, '#ffb266', 0, 0.55);
  K.lamp(1420, 866, 130, 300, '#ffb266', 0, 0.55);
  K.lamp(1705, 866, 130, 300, '#ffb266', 0, 0.5);
  K.lamp(830, 460, 110, 260, '#ffcf8a', 0, 0.5);
  K.lamp(1180, 460, 110, 260, '#ffcf8a', 0, 0.5);
  K.lamp(1600, 560, 100, 240, '#ffd6a0', 0, 0.5);
  K.lamp(640, 966, 120, 280, '#ffb266', 0, 0.5);
  K.lamp(1100, 1330, 130, 280, '#ffb266', 0, 0.5);
  K.lamp(1640, 1236, 120, 360, '#ffcf8a', 0, 0.6);
  K.lamp(1860, 1250, 110, 300, '#ffcf8a', 0, 0.5);
  B.fire(1480, 1200, 14);

  // ---- the stations
  K.ob('counter', 'maptable', 830, 490, 128, 64, 0, { color: '#6b4a2c' });
  K.station('board', 'board', 830, 490, 112, 'Departures board', { h: 90 });
  K.prop('departures', 830, 424, HALF, {});
  K.ob('booth', 'signboard', 1440, 578, 122, 26, 0, { color: '#5a4630' });
  K.station('upgrades', 'upgrades', 1440, 578, 100, 'Upgrade board', { h: 96 });
  K.ob('counter', 'workbench', 430, 470, 112, 60, 0, { color: '#4a4e52' });
  K.station('workbench', 'workbench', 430, 470, 112, 'Forge & bench', { h: 84 });
  K.station('bed', 'bed', 1125, 872, 90, 'Bunkhouse', { h: 80 });
  K.prop('bedlamp', 1080, 880, -HALF, {});
  K.station('campfire', 'campfire', CF.x, CF.y, 150, 'Campfire', { h: 110 });
  K.ob('counter', 'rangebench', 1546, 1270, 40, 160, 0, { color: '#5a4630' });
  K.station('range', 'range', 1490, 1270, 105, 'Shooting range', { h: 70 });
  K.hub.range = {
    line: { x: 1520, y: 1270, a: 0 },
    targets: [
      { id: 'r1', x: 1700, y: 1216, a: PI },
      { id: 'r2', x: 1810, y: 1272, a: PI },
      { id: 'r3', x: 1920, y: 1226, a: PI },
      { id: 'r4', x: 1990, y: 1310, a: PI },
    ],
    backstop: { x: 2010, y0: 1190, y1: 1350 },
  };
  for (const [x, y, h] of [[2006, 1210, 100], [2006, 1310, 100]]) B.ob('sandbags', x, y, h, 26, HALF, { color: '#8a7a55' });

  // ---- upgrade slots (footprints are real colliders; the tiers add the visible parts)
  const VAULT = { x: 1110, y: 1290 };
  const GEN = { x: 1960, y: 730 };
  const MAST = { x: 1940, y: 330 };
  const GAR = { x: 620, y: 1265, w: 430, h: 170 };
  K.ob('container', 'slot:armory', VAULT.x, VAULT.y, 120, 56, 0, { color: '#4a5a4a' });
  K.station('armory', 'armory', VAULT.x, VAULT.y, 118, 'Armory vault', { h: 100 });
  K.ob('container', 'slot:generator', GEN.x, GEN.y, 76, 52, 0, { color: '#48544a' });
  K.ob('pillar', 'slot:radiomast', MAST.x, MAST.y, 26, 26, 0, { color: '#8a8e92' });
  for (const [x, y, w, h] of [[GAR.x, GAR.y - GAR.h / 2, GAR.w, 10], [GAR.x, GAR.y + GAR.h / 2, GAR.w, 10], [GAR.x - GAR.w / 2, GAR.y, 10, GAR.h], [GAR.x + GAR.w / 2, GAR.y - 60, 10, 50]]) {
    K.ob('wall', 'slot:garden', x, y, w, h, 0, { color: '#6b5433', solid: true });
  }
  K.station('infirmary', 'infirmary', 1300, 1175, 118, 'Caboose clinic', { h: 100 });
  stdSlot(K, 'generator', GEN.x, GEN.y, 0, 90, 'Generator', {
    model: { cable: [[1925, 705], [1850, 640], [1700, 600]] },
    props: [[], [{ t: 'stringlights', id: 'g1', pts: [[1560, 620, 96], [1660, 590, 110], [1780, 620, 100]], sag: 8 }],
      [{ t: 'stringlights', id: 'g2', pts: [[830, 470, 118], [1000, 560, 138], [1100, 700, 150]], sag: 12 }, { t: 'stringlights', id: 'g2b', pts: [[1100, 700, 150], [1250, 560, 130], [1180, 430, 116]], sag: 10 }],
      [{ t: 'stringlights', id: 'g3', pts: [[1100, 700, 150], [1120, 860, 130], [1410, 872, 118]], sag: 10 }, { t: 'floodlight', x: 1500, y: 640, z: 150, aim: PI }, { t: 'floodlight', x: 700, y: 1180, z: 150, aim: 0 }]],
    lights: [[], [{ x: 1700, y: 610, r: 280, color: '#ffd9a0', h: 96 }], [{ x: 1000, y: 560, r: 320, color: '#ffcf8a', h: 130 }], [{ x: 1500, y: 640, r: 420, color: '#fff0d6', h: 150 }, { x: 700, y: 1180, r: 420, color: '#fff0d6', h: 150 }]],
  });
  stdSlot(K, 'watchtower', 1600, 470, 0, 100, 'Watchtower', { lights: [[], [{ x: 1600, y: 470, r: 320, color: '#ffc27a', h: 250 }], [], []] });
  stdSlot(K, 'infirmary', 1300, 1120, 0, 118, 'Infirmary', { model: { w: 190, h: 58 }, lights: [[], [{ x: 1300, y: 1150, r: 240, color: '#ff8a80', h: 80 }], [{ x: 1300, y: 1120, r: 260, color: '#f4f7ff', h: 80 }], []] });
  stdSlot(K, 'armory', VAULT.x, VAULT.y, 0, 118, 'Armory', { model: { w: 120, h: 56 }, lights: [[], [{ x: VAULT.x, y: VAULT.y + 40, r: 240, color: '#ffd090', h: 74 }], [], []] });
  stdSlot(K, 'radiomast', MAST.x, MAST.y, 0, 90, 'Radio mast', {});
  stdSlot(K, 'garden', GAR.x, GAR.y, 0, 150, 'Garden', { model: { w: GAR.w, h: GAR.h } });
  stdSlot(K, 'palisade', 1100, 1362, 0, 400, 'Palisade', {});

  // ---- details
  K.prop('picnic', 1010, 800, 0.2, { game: 'chess' });
  K.prop('guitar', 1000, 760, 2.6);
  K.prop('cat', 1560, 1130, PI);
  K.prop('photowall', 940, 566, HALF, {});
  K.prop('pinboard', 780, 297, HALF, { kids: true });
  K.prop('paintedsign', 1085, 1338, -HALF, { text: 'HAVEN OR BUST', w: 190, h: 40, z: 92 });
  K.prop('bunting', 0, 0, 0, { pts: [[300, 520, 100], [700, 530, 100], [1000, 540, 100]] });
  K.prop('stringlights', 0, 0, 0, { id: 'base1', pts: [[1030, 909, 106], [1100, 760, 142], [1180, 448, 116]], sag: 12 });
  K.prop('stringlights', 0, 0, 0, { id: 'base2', pts: [[1200, 909, 106], [1130, 730, 146], [1000, 560, 120]], sag: 12 });
  K.prop('stringlights', 0, 0, 0, { id: 'base3', pts: [[1390, 909, 106], [1250, 770, 140], [1130, 730, 146]], sag: 12 });
  for (const [x, y] of [[1000, 700], [1200, 660], [1080, 820], [880, 560], [1500, 880]]) K.prop('lantern', x, y, 0, { z: 8 });
  // (`id` is the cast key, shared/story/cast.js; `recruit` = the mission that unlocks the NPC, see the roadhouse)
  K.npc('june', 'June', 'kid', 1000, 760, 0.3, 'sit', { station: 'bed' });
  K.npc('mara', 'Mara Voss', 'medic', 1300, 1212, -HALF, 'stand', { station: 'infirmary', recruit: 'm1_1' });
  K.npc('deke', 'Deke Harlan', 'mechanic', 430, 515, -HALF, 'work', { station: 'workbench', recruit: 'm1_2' });
  K.npc('ozzy', 'Ozzy', 'radio', 830, 452, HALF, 'stand', { station: 'board', recruit: 'm1_3' });
  K.npc('priya', 'Priya Nair', 'scout', 1600, 470, HALF, 'watch', { station: 'upgrades', recruit: 'm3_1' });
  K.npc('wendell', 'Wendell Pike', 'handler', 1445, 1204, 0, 'stand', { station: 'range', recruit: 'm3_2' });
  K.npc('okafor', 'Sgt. Okafor', 'quartermaster', 1110, 1338, -HALF, 'stand', { station: 'armory', recruit: 'm4_1' });
  K.npc('danny', 'Pvt. Danny Ruiz', 'soldier', 1023, 1257, -1.44, 'stand', { station: 'armory', recruit: 'm4_2' });
  B.sprinkle('grass_tuft', 200, 60, 60, 2140, 1540, { s: [0.6, 1.3] });
  B.sprinkle('bush', 16, 60, 60, 2140, 1540, { s: [0.7, 1.2], keep: true });
  B.sprinkle('rock', 24, 60, 60, 2140, 1540, { s: [0.5, 1.2] });
  B.sprinkle('debris', 16, 200, 220, 2000, 1340, { s: [0.6, 1.1] });
  K.dress(DEPOT_DRESS);
}

const DEPOT_DRESS = [
  ['cooler', 1160, 730, 0.4, 1], ['crates', 470, 560, 0.3, 1], ['pallets', 250, 560, 0.5, 1], ['drums', 248, 300, 0, 1], ['woodpile', 640, 330, 0.5, 1],
  ['reel', 1010, 300, 0, 1], ['pipes', 1300, 290, 0.1, 1], ['forklift', 300, 620, 0.9, 1], ['barrel_t', 1650, 720, 0, 1], ['ibc', 1280, 1330, 0, 1],
  ['bin', 700, 330, 0.3, 1], ['hydrant', 960, 580, 0, 1], ['planter', 780, 470, 0, 1], ['flowers', 720, 480, 0, 1], ['bench', 790, 560, HALF, 1],
  ['bench', 880, 560, HALF, 1], ['laundry', 1290, 830, 0, 1], ['tarp', 1750, 1050, 0.4, 1], ['sawhorse', 520, 1150, 0.2, 1], ['cone_up', 190, 900, 0, 1],
  ['gascyl', 340, 1230, 0, 1], ['wheelbarrow', 900, 1250, 0.6, 1], ['crates', 1840, 620, 0.2, 1], ['pallet', 1860, 1250, 0.3, 1], ['generator', 1880, 780, 0, 1],
  ['fuel_can', 1010, 1280, 0.4, 1], ['chair', 1140, 780, 0.6, 1], ['chair', 1050, 630, -1, 1], ['gnome', 1240, 1180, 0.4, 1], ['bicycle', 970, 830, 1, 1],
  ['pole', 260, 880, 0, 1], ['pole', 2100, 880, 0, 1], ['shrub', 100, 300, 0, 1], ['boulders', 90, 1400, 0.3, 1.4], ['boulders', 2130, 300, 0, 1.3],
  ['tumbleweed', 1500, 1500, 0, 1], ['rsign', 380, 1430, PI, 1],
];
