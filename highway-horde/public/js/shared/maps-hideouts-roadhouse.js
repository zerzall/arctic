// The Roadhouse (chapters 1–2): see maps-hideouts.js for the hideout data contract.

import { kit, tier, TAU, PI, r1, r3 } from './maps-hideouts-kit.js';

// ---------------------------------------------------------------------------------------------
// 1. The Roadhouse (chapters 1–2): a desert motel and diner on the highway shoulder
//
//   north row (facing the yard): the motel (300..1500), the office with the radio room and the
//   diner; a west wing of motel rooms; a fire ring with log seats in the middle of the yard;
//   the mission table by the office, the workbench lean-to and generator on the east side, the
//   armory and infirmary tents beside the west wing, a garden plot in the south-west corner, the
//   shooting range in the south-east corner and the gate to the highway in the south wall.

export function buildRoadhouse(B) {
  const K = kit(B, 'roadhouse', 'The Roadhouse', {
    chapters: [1, 2], defaultTime: 'night', bounds: { x0: 200, y0: 210, x1: 2020, y1: 1352 },
    look: {
      night: {
        ground: '#1c2536', sky: '#7088b8', moon: '#a8c0f0', moonI: 0.72, hemi: 1.0,
        grade: { saturation: 1.0, contrast: 1.07, lift: [0.010, 0.012, 0.024], gain: [1.05, 1.0, 0.95] },
      },
      day: { az: 250, el: 36, haze: '#e6d6b4', horizon: '#efe0bd', zenith: '#3a86cc', fog: 0.00025, cover: 0.16, heat: 0.7, ridge: '#a4805a', wet: 0.06, hemiGround: '#a58a5a', hemiSky: '#e2dccb', mist: 0.35 },
    },
  });
  const CF = { x: 1080, y: 880 };   // the campfire

  // ---- objective (the diner), supply (the armory stash) and the party's start
  B.objective('diner', 'The Roadhouse Diner', 1760, 290, 300, 170, 0, 1, 40);
  B.map.objective.prop = 'rhdiner';
  B.supply(560, 610);
  K.spawns(CF.x, CF.y, 205, 8, 0.3);

  // ---- ground: desert, the packed yard, the walkway, the old parking lot, the highway
  B.box('sand', 0, 0, 2200, 1600);
  B.box('dirt', 150, 140, 2050, 1372);
  B.box('gravel', 560, 980, 1450, 1372);
  B.box('asphalt', 640, 1040, 1430, 1350);
  B.box('concrete', 300, 305, 1510, 372);
  B.box('concrete', 1610, 375, 1912, 484);
  B.box('concrete', 296, 300, 366, 860);
  B.box('gravel', 0, 1372, 2200, 1432);
  B.box('asphalt', 0, 1432, 2200, 1592);
  B.line('yellow_double', 0, 1512, 2200, 1512, 4);
  B.line('white', 0, 1446, 2200, 1446, 3);
  B.line('white', 0, 1578, 2200, 1578, 3);
  for (let x = 700; x <= 1360; x += 82) B.line('parking', x, 1050, x, 1112, 3);
  B.line('white', 640, 1112, 1430, 1112, 3);
  // packed earth paths worn by boots
  B.area('gravel', 1080, 1110, 130, 460, 0);
  B.area('gravel', 1300, 610, 620, 110, 0.05);
  B.area('gravel', 1740, 640, 300, 120, 1.1);
  B.area('sand', 500, 1110, 520, 260, 0.1);
  B.area('dirt', 560, 1150, 420, 240, 0.12);        // the garden plot

  // ---- the perimeter (scrap fence; the palisade upgrade dresses it): thick so nobody hops it
  const per = (x, y, w, h) => K.ob('wall', 'perimeter', x, y, w, h, 0, { color: '#6b5a44' });
  per(1100, 172, 1900, 66);            // north, behind the buildings
  per(1100, 1362, 1900, 20);           // south (the gate is drawn on it)
  per(170, 790, 40, 1170);             // west
  per(2040, 790, 40, 1170);            // east

  // ---- the motel: north block and west wing (their fronts face the yard)
  K.ob('building', null, 900, 255, 1200, 100, 0, { color: '#cdb48c', roof: '#5c4a3a', top: 132, arch: 'motel', lit: 0.55 });
  K.ob('building', null, 245, 565, 520, 100, -PI / 2, { color: '#c9ae86', roof: '#5c4a3a', top: 132, arch: 'motel', lit: 0.5 });
  // the office and its radio room
  K.ob('building', 'rhoffice', 1555, 262, 112, 112, 0, { color: '#7d9089', roof: '#4a4038', top: 128, arch: 'house', lit: 1 });

  // ---- the fire ring, its log seats, a couch
  K.ob('pillar', 'campring', CF.x, CF.y, 58, 58, 0, { color: '#6d6a63' });
  K.fire(CF.x, CF.y, 21, 420, '#ff9a4a', 0.95);
  const seats = [];
  for (let k = 0; k < 8; k++) {
    if (k === 5 || k === 6) continue;
    const ang = 0.35 + (k / 8) * TAU;
    const sx = CF.x + Math.cos(ang) * 128, sy = CF.y + Math.sin(ang) * 118;
    seats.push([r1(sx), r1(sy), r3(ang + PI / 2)]);
    K.ob('rock', 'logseat', sx, sy, 66, 24, ang + PI / 2, { solid: false, color: '#5b4128' });
  }
  K.ob('rock', 'couch', 905, 722, 92, 34, -0.84, { solid: false, color: '#6a3f34' });

  // ---- gate, the repaired pickup, oil drum fires and the sandbag-and-pallet funnel
  K.prop('gate', 1080, 1362, 0, { w: 240 });
  B.vehicle('pickup', 900, 1296, 0.38, { color: '#b5482f', jitter: 0 });
  B.vehicle('car', 1290, 1300, -0.25, { color: '#59606a', wrecked: true, jitter: 0 });
  B.fire(1185, 1300, 14);
  B.fire(985, 1225, 14);
  for (const [x, y, w, a] of [[1010, 1332, 150, 0], [1190, 1334, 130, 0.05]]) B.ob('sandbags', x, y, w, 26, a, { color: '#8a7a55' });
  B.ob('barrier', 1082, 1328, 70, 26, 0.1, { color: '#a89a60' });
  K.lamp(1080, 1330, 150, 260, '#ffc27a', 0, 0.6);

  // ---- the stations
  // mission table with the map and the radio (lean-to canopy over it)
  K.ob('counter', 'maptable', 1560, 480, 128, 66, 0, { color: '#6b4a2c' });
  K.station('board', 'board', 1560, 480, 112, 'Mission board', { h: 84 });
  K.prop('leanto', 1560, 462, 0, { w: 190, d: 120, hi: 104, lo: 82, tilt: 'south', cloth: '#7a6a4a' });
  // the upgrade board on the diner's apron
  K.ob('booth', 'signboard', 1790, 478, 122, 26, 0, { color: '#5a4630' });
  K.station('upgrades', 'upgrades', 1790, 478, 100, 'Upgrade board', { h: 96 });
  // workbench under a corrugated lean-to, a drum fire beside it
  K.ob('counter', 'workbench', 1900, 700, 112, 60, PI / 2, { color: '#4a4e52' });
  K.station('workbench', 'workbench', 1900, 700, 112, 'Workbench', { h: 80 });
  K.prop('leanto', 1935, 700, PI / 2, { w: 200, d: 150, hi: 110, lo: 86, tilt: 'east', metal: true });
  B.fire(1962, 772, 14);
  B.fire(1830, 620, 14);
  // your room: a motel door with a lamp and a mat
  K.station('bed', 'bed', 1210, 350, 84, 'Your room', { h: 80 });
  K.prop('bedlamp', 1210, 322, PI / 2);
  // the campfire itself
  K.station('campfire', 'campfire', CF.x, CF.y, 150, 'Campfire', { h: 110 });
  // the shooting range
  K.ob('counter', 'rangebench', 1526, 1150, 40, 160, 0, { color: '#5a4630' });
  K.station('range', 'range', 1470, 1150, 105, 'Shooting range', { h: 70 });
  K.hub.range = {
    line: { x: 1500, y: 1150, a: 0 },
    targets: [
      { id: 'r1', x: 1700, y: 1092, a: PI },
      { id: 'r2', x: 1800, y: 1150, a: PI },
      { id: 'r3', x: 1910, y: 1208, a: PI },
      { id: 'r4', x: 1990, y: 1108, a: PI },
    ],
    backstop: { x: 2010, y0: 1040, y1: 1330 },
  };
  for (const [x, y, w, h, a] of [[2004, 1092, 26, 120, 0], [2004, 1244, 26, 150, 0]]) B.ob('sandbags', x, y, h, w, a + PI / 2, { color: '#8a7a55' });

  // ---- upgrade slots (footprints are real; tiers add the visible parts)
  const GEN = { x: 1975, y: 905 };
  K.ob('container', 'slot:generator', GEN.x, GEN.y, 76, 52, 0, { color: '#48544a' });
  K.slot('generator', GEN.x, GEN.y, 0, 90, 'Generator', [
    tier({ props: [{ t: 'up_generator', tier: 0, x: GEN.x, y: GEN.y, a: 0 }] }),
    tier({
      props: [{ t: 'up_generator', tier: 1, x: GEN.x, y: GEN.y, a: 0 }, { t: 'stringlights', id: 'g1', pts: [[1890, 640, 96], [1935, 610, 112], [1980, 640, 96]], sag: 6 }],
      lights: [{ x: 1900, y: 700, r: 300, color: '#ffd9a0', h: 96 }, { x: 1975, y: 905, r: 200, color: '#ffe2b8', h: 80 }],
    }),
    tier({
      props: [
        { t: 'up_generator', tier: 2, x: GEN.x, y: GEN.y, a: 0 },
        { t: 'stringlights', id: 'g2a', pts: [[330, 350, 104], [560, 420, 128], [800, 500, 136], [1080, 700, 150]], sag: 12 },
        { t: 'stringlights', id: 'g2b', pts: [[1080, 700, 150], [1330, 620, 132], [1560, 430, 118]], sag: 12 },
      ],
      lights: [{ x: 1080, y: 700, r: 420, color: '#ffcf8a', h: 150 }, { x: 800, y: 500, r: 300, color: '#ffcf8a', h: 130 }],
    }),
    tier({
      props: [
        { t: 'up_generator', tier: 3, x: GEN.x, y: GEN.y, a: 0 },
        { t: 'stringlights', id: 'g3a', pts: [[1080, 700, 150], [900, 1000, 150], [720, 1120, 118]], sag: 12 },
        { t: 'stringlights', id: 'g3b', pts: [[1080, 700, 150], [1300, 1000, 140], [1500, 1120, 118]], sag: 12 },
        { t: 'floodlight', x: 900, y: 320, z: 140, aim: PI / 2 }, { t: 'floodlight', x: 1300, y: 320, z: 140, aim: PI / 2 },
      ],
      lights: [{ x: 900, y: 420, r: 420, color: '#fff0d6', h: 150 }, { x: 1300, y: 420, r: 420, color: '#fff0d6', h: 150 }, { x: 1080, y: 1050, r: 420, color: '#ffd9a0', h: 150 }],
    }),
  ]);

  const WT = { x: 1420, y: 1298 };
  K.ob('watchtower', 'slot:watchtower', WT.x, WT.y, 58, 58, 0, { color: '#5b4a36' });
  K.slot('watchtower', WT.x, WT.y, 0, 100, 'Watchtower', [
    tier({ props: [{ t: 'up_watchtower', tier: 0, x: WT.x, y: WT.y, a: 0 }] }),
    tier({ props: [{ t: 'up_watchtower', tier: 1, x: WT.x, y: WT.y, a: 0 }], lights: [{ x: WT.x, y: WT.y, r: 300, color: '#ffc27a', h: 190 }] }),
    tier({ props: [{ t: 'up_watchtower', tier: 2, x: WT.x, y: WT.y, a: 0 }], lights: [] }),
    tier({ props: [{ t: 'up_watchtower', tier: 3, x: WT.x, y: WT.y, a: 0 }], lights: [] }),
  ]);

  const INF = { x: 505, y: 800 };
  K.ob('tent', 'slot:infirmary', INF.x, INF.y, 150, 104, 0, { color: '#c9c4b0', roof: '#d8d4c0' });
  K.station('infirmary', 'infirmary', INF.x, INF.y, 118, 'Infirmary', { h: 100 });
  K.slot('infirmary', INF.x, INF.y, 0, 118, 'Infirmary', [
    tier({ props: [{ t: 'up_infirmary', tier: 0, x: INF.x, y: INF.y, a: 0 }] }),
    tier({ props: [{ t: 'up_infirmary', tier: 1, x: INF.x, y: INF.y, a: 0 }], lights: [{ x: INF.x + 80, y: INF.y, r: 260, color: '#ff8a80', h: 70 }] }),
    tier({ props: [{ t: 'up_infirmary', tier: 2, x: INF.x, y: INF.y, a: 0 }], lights: [{ x: INF.x, y: INF.y, r: 260, color: '#f4f7ff', h: 70 }] }),
    tier({ props: [{ t: 'up_infirmary', tier: 3, x: INF.x, y: INF.y, a: 0 }] }),
  ]);

  const ARM = { x: 505, y: 470 };
  K.ob('tent', 'slot:armory', ARM.x, ARM.y, 150, 104, 0, { color: '#4b5320', roof: '#5a6340' });
  K.station('armory', 'armory', ARM.x, ARM.y, 118, 'Armory', { h: 100 });
  K.slot('armory', ARM.x, ARM.y, 0, 118, 'Armory', [
    tier({ props: [{ t: 'up_armory', tier: 0, x: ARM.x, y: ARM.y, a: 0 }] }),
    tier({ props: [{ t: 'up_armory', tier: 1, x: ARM.x, y: ARM.y, a: 0 }], lights: [{ x: ARM.x + 70, y: ARM.y, r: 240, color: '#ffd090', h: 74 }] }),
    tier({ props: [{ t: 'up_armory', tier: 2, x: ARM.x, y: ARM.y, a: 0 }] }),
    tier({ props: [{ t: 'up_armory', tier: 3, x: ARM.x, y: ARM.y, a: 0 }] }),
  ]);

  const MAST = { x: 1978, y: 330 };
  K.ob('pillar', 'slot:radiomast', MAST.x, MAST.y, 26, 26, 0, { color: '#8a8e92' });
  K.slot('radiomast', MAST.x, MAST.y, 0, 90, 'Radio mast', [
    tier({ props: [{ t: 'up_radiomast', tier: 0, x: MAST.x, y: MAST.y, a: 0 }] }),
    tier({ props: [{ t: 'up_radiomast', tier: 1, x: MAST.x, y: MAST.y, a: 0 }] }),
    tier({ props: [{ t: 'up_radiomast', tier: 2, x: MAST.x, y: MAST.y, a: 0 }] }),
    tier({ props: [{ t: 'up_radiomast', tier: 3, x: MAST.x, y: MAST.y, a: 0 }] }),
  ]);

  const GAR = { x: 500, y: 1150, w: 430, h: 250 };
  for (const [x, y, w, h] of [[GAR.x, GAR.y - GAR.h / 2, GAR.w, 10], [GAR.x, GAR.y + GAR.h / 2, GAR.w, 10], [GAR.x - GAR.w / 2, GAR.y, 10, GAR.h], [GAR.x + GAR.w / 2, GAR.y - 84, 10, 84]]) {
    K.ob('wall', 'slot:garden', x, y, w, h, 0, { color: '#6b5433', solid: true });
  }
  K.slot('garden', GAR.x, GAR.y, 0, 150, 'Garden', [
    tier({ props: [{ t: 'up_garden', tier: 0, x: GAR.x, y: GAR.y, a: 0, w: GAR.w, h: GAR.h }] }),
    tier({ props: [{ t: 'up_garden', tier: 1, x: GAR.x, y: GAR.y, a: 0, w: GAR.w, h: GAR.h }] }),
    tier({ props: [{ t: 'up_garden', tier: 2, x: GAR.x, y: GAR.y, a: 0, w: GAR.w, h: GAR.h }] }),
    tier({ props: [{ t: 'up_garden', tier: 3, x: GAR.x, y: GAR.y, a: 0, w: GAR.w, h: GAR.h }] }),
  ]);

  K.slot('palisade', 1100, 1362, 0, 400, 'Palisade', [
    tier({ props: [{ t: 'up_palisade', tier: 0, x: 1100, y: 1362, a: 0 }] }),
    tier({ props: [{ t: 'up_palisade', tier: 1, x: 1100, y: 1362, a: 0 }] }),
    tier({ props: [{ t: 'up_palisade', tier: 2, x: 1100, y: 1362, a: 0 }] }),
    tier({ props: [{ t: 'up_palisade', tier: 3, x: 1100, y: 1362, a: 0 }] }),
  ]);

  // ---- lived-in details (no collision)
  K.prop('picnic', 1350, 740, 0.2, { game: 'checkers' });
  K.prop('guitar', 1000, 950, 0.6);
  K.prop('cat', 1760, 1130, 0);
  K.prop('photowall', 1690, 400, PI / 2);
  K.prop('pinboard', 1520, 336, PI / 2, { kids: true });
  K.prop('paintedsign', 1080, 1338, PI / 2, { text: 'HAVEN OR BUST', w: 190, h: 40, z: 92 });
  K.prop('signpole', 1560, 1332, 0, { text: 'ROADHOUSE', sub: 'VACANCY', h: 250 });
  K.prop('lookoutnest', 1835, 292, 0, { z: 96 });
  K.prop('roofantenna', 1555, 262, 0, { z: 128 });
  K.prop('bunting', 0, 0, 0, { pts: [[300, 340, 108], [900, 346, 108], [1500, 340, 108]] });
  K.prop('stringlights', 0, 0, 0, { id: 'base1', pts: [[300, 372, 100], [520, 480, 122], [820, 600, 138], [1080, 712, 150]], sag: 14 });
  K.prop('stringlights', 0, 0, 0, { id: 'base2', pts: [[1500, 372, 100], [1360, 560, 120], [1200, 700, 140], [1080, 712, 150]], sag: 14 });
  for (const [x, y] of [[1000, 900], [1160, 850], [1120, 950], [340, 700], [1650, 650], [1830, 900]]) K.prop('lantern', x, y, 0, { z: 8 });
  K.lamp(1080, 712, 150, 340, '#ffc98a', 0, 0.55);
  K.lamp(800, 520, 130, 280, '#ffc98a', 0, 0.5);
  K.lamp(1330, 560, 120, 260, '#ffc98a', 0, 0.5);
  K.lamp(330, 480, 110, 220, '#ffc98a', 0, 0.5);
  K.lamp(1560, 372, 100, 200, '#ffd6a0', 0, 0.45);
  K.lamp(1795, 396, 100, 200, '#ffd6a0', 0, 0.45);
  K.lamp(1215, 372, 100, 200, '#ffd6a0', 0, 0.45);
  K.lamp(1560, 1310, 190, 250, '#ff5a9c', 0, 0.55);
  K.lamp(1420, 1240, 70, 200, '#ffb060', 0.4, 0.6);

  // ---- NPCs: idle spots. `id` is the cast key (shared/story/cast.js: name, look and voice come from
  // there); `pose` is a hint (the NPC layer stands them on the spot), `recruit` (the mission that unlocks
  // them) keeps a spot empty until the host lists the NPC in settings.story.npcs. Roz and June live here.
  K.npc('roz', 'Roz Pruitt', 'cook', 1132, 942, -2.26, 'work', { station: 'campfire' });
  K.npc('june', 'June', 'kid', 1002, 930, -0.55, 'sit', { station: 'bed' });
  K.npc('mara', 'Mara Voss', 'medic', 612, 800, 0, 'stand', { station: 'infirmary', recruit: 'm1_1' });
  K.npc('deke', 'Deke Harlan', 'mechanic', 1852, 712, 0.1, 'work', { station: 'workbench', recruit: 'm1_2' });
  K.npc('ozzy', 'Ozzy', 'radio', 1560, 432, PI / 2, 'stand', { station: 'board', recruit: 'm1_3' });
  K.npc('quill', 'Silas Quill', 'trader', 1290, 610, 2.23, 'stand', { recruit: 'm2_1' });
  // the road crew's boss keeps watch: a slow patrol along the south fence
  K.npc('dutch', 'Dutch Kessler', 'guard', 1250, 1215, -2.04, 'watch', { recruit: 'm2_3', mode: 'walk', loop: true, route: [{ x: 1250, y: 1215 }, { x: 1700, y: 1180 }] });

  B.sprinkle('grass_tuft', 150, 60, 60, 2140, 1540, { s: [0.6, 1.3], off: ['asphalt', 'concrete'] });
  B.sprinkle('bush', 14, 60, 60, 2140, 1540, { s: [0.7, 1.2], keep: true, off: ['asphalt', 'concrete'] });
  B.sprinkle('rock', 26, 60, 60, 2140, 1540, { s: [0.5, 1.2], off: ['asphalt', 'concrete'] });
  B.sprinkle('debris', 12, 200, 220, 2000, 1340, { s: [0.6, 1.1] });
  K.dress(ROADHOUSE_DRESS);
}

// [kind, x, y, angle, scale] — DRESS_KINDS of dress.js. Order = importance (first = always shown).
const ROADHOUSE_DRESS = [
  ['clothes', 1041, 972, 0.3, 1], ['cooler', 1180, 930, 0.4, 1], ['vend', 352, 338, PI / 2, 1], ['bench', 700, 344, PI / 2, 1],
  ['bench', 1030, 346, PI / 2, 1], ['laundry', 402, 610, PI / 2, 1], ['grill', 1325, 690, -0.6, 1], ['generator', 1940, 820, 0, 1],
  ['woodpile', 1780, 690, 0.4, 1], ['crates', 1850, 800, 0.5, 1], ['drums', 1985, 780, 0, 1], ['tent_camp', 690, 1180, 0.3, 1],
  ['tent_camp', 770, 1250, -0.4, 1], ['bicycle', 760, 900, 1.2, 1], ['planter', 322, 400, 0, 1], ['planter', 322, 760, 0, 1],
  ['gnome', 330, 690, 1, 1], ['beachball', 940, 960, 0, 1], ['teddy', 1062, 990, 0.5, 1], ['mailbox', 1010, 1340, PI / 2, 1],
  ['hydrant', 644, 344, 0, 1], ['bin', 1470, 350, 0, 1], ['bin', 1480, 360, 0.5, 1], ['shrine', 1690, 440, PI / 2, 1],
  ['sawhorse', 900, 1330, 0.1, 1], ['cone_up', 1240, 1330, 0, 1], ['cone_up', 950, 1335, 0, 1], ['fuel_can', 936, 1270, 0.3, 1],
  ['fuel_can', 948, 1262, 1.3, 1], ['tarp', 780, 1300, 0.6, 1], ['pallets', 1600, 1300, 0.3, 1], ['pallet', 1560, 1240, 0.9, 1],
  ['wheelbarrow', 640, 1290, 0.7, 1], ['trough', 700, 1040, 0, 1], ['chair', 1100, 1000, -1.2, 1], ['chair', 1220, 800, 2.4, 1],
  ['chair', 1360, 800, 0.4, 1], ['sleeping_bag', 700, 1140, 0.3, 1], ['flowers', 1490, 336, 0, 1], ['flowers', 380, 340, 0, 1],
  ['cactus', 90, 300, 0, 1.1], ['cactus', 260, 60, 0, 0.9], ['cactus', 2120, 1000, 0, 1.2], ['cactus', 2080, 300, 0, 1], ['cactus', 120, 1240, 0, 0.9],
  ['boulders', 90, 800, 0.4, 1.3], ['boulders', 2130, 640, 0, 1.4], ['boulders', 1500, 90, 0, 1.2], ['tumbleweed', 200, 1500, 0, 1],
  ['tumbleweed', 1700, 1400, 0, 1], ['pole', 200, 1400, 0, 1], ['pole', 1000, 1400, 0, 1], ['pole', 1800, 1400, 0, 1],
  ['rsign', 480, 1400, PI, 1], ['rsign', 1720, 1400, 0, 1], ['shrub', 240, 1080, 0, 1], ['shrub', 1990, 560, 0, 1],
];

