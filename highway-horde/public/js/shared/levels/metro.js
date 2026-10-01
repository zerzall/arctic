// Harlan Metro — story level (JOURNEY.md). Owner: agent C2.
//
// SPEC is the contract other parts depend on (the mission scripts, the engine, the tests): keep every
// section id (in this order), anchor name and gate id.
//
// The place, in travel order (north is -y). The city's streets stand on terrain 320 up; everything under
// them is at 0 to 140 (shared/terrain.js has no depth below 0, so the street is raised instead):
//
//   STREET       Station Street, a canyon of shops in the sun: wrecks, the newsstand, the station
//                building at the east end. Its lobby's glass lets the day in; the stairs go down to the
//                ticket hall's unpaid side (140), the ticket machines, the turnstile line.
//   CONCOURSE    The paid concourse (140): columns, the ticket office, the café and the shuttered shops, the
//                public stairs to the trains caved in; a staff door on the north wall.
//   PLATFORM     The staff stair down to Line 2 (the platform at 40, the track bed at 0): a dead train
//                along the platform, a collapse that sends you through its cars (or down onto the tracks),
//                the cab at the head, the platform end and its steps down to the tunnel mouth.
//   TUNNEL       Tunnel 2: double track east to the junction; the east bore is blocked by a derailed
//                engineering train, the south bore runs past the signals to a bulkhead.
//   FLOODED      The Sump: a brick drainage chamber standing in water, the pump room, the sump valve.
//   MAINTENANCE  The works: the shutter, the breaker room, the workshop, the freight lift; the exit gate.
//   EXIT         The stairs up into Harlan Square (320): the statue, the plaza, the way out.
//
// Everything the renderer needs beyond obstacles and roofs is listed in `map.levelArt`
// (render3d/levels/metro.js); the set dressing is hand placed (`map.dressItems`).

import { levelKit } from './hospital.js';

export const SPEC = Object.freeze({
  "id": "metro",
  "name": "Harlan Metro",
  "chapter": 5,
  "time": "day",
  "owner": "C2",
  "description": "Under the city at midday: the street entrance, the ticket concourse, a platform with a dead train, the tunnels, a flooded section, the maintenance works and the stairs up into the sunlit Harlan Square.",
  "sections": [
    {
      "id": "street",
      "name": "Station Street"
    },
    {
      "id": "concourse",
      "name": "Concourse"
    },
    {
      "id": "platform",
      "name": "Line 2 Platform"
    },
    {
      "id": "tunnel",
      "name": "Tunnel 2"
    },
    {
      "id": "flooded",
      "name": "The Sump"
    },
    {
      "id": "maintenance",
      "name": "Maintenance Works"
    },
    {
      "id": "exit",
      "name": "Harlan Square"
    }
  ],
  "anchors": {
    "street": [
      "start",
      "metro_entrance",
      "newsstand"
    ],
    "concourse": [
      "concourse_gates",
      "ticket_office",
      "concourse_shops"
    ],
    "platform": [
      "platform_train",
      "platform_cab",
      "platform_end"
    ],
    "tunnel": [
      "tunnel_junction",
      "tunnel_signal"
    ],
    "flooded": [
      "pump_room",
      "sump_valve"
    ],
    "maintenance": [
      "breaker",
      "workshop",
      "maint_lift"
    ],
    "exit": [
      "exit_stairs",
      "square_statue"
    ]
  },
  "gates": [
    {
      "id": "turnstiles",
      "kind": "bars",
      "from": "street",
      "to": "concourse",
      "label": "Turnstile gate"
    },
    {
      "id": "platform_door",
      "kind": "door",
      "from": "concourse",
      "to": "platform",
      "label": "Staff door"
    },
    {
      "id": "tunnel_gate",
      "kind": "gate",
      "from": "platform",
      "to": "tunnel",
      "label": "Tunnel gate"
    },
    {
      "id": "sump_door",
      "kind": "door",
      "from": "tunnel",
      "to": "flooded",
      "label": "Bulkhead"
    },
    {
      "id": "maint_shutter",
      "kind": "shutter",
      "from": "flooded",
      "to": "maintenance",
      "label": "Works shutter"
    },
    {
      "id": "exit_gate",
      "kind": "gate",
      "from": "maintenance",
      "to": "exit",
      "label": "Exit gate"
    }
  ]
});

/** World size and mood (maps.js MAP_DEFS). */
export const DEF = { width: 11800, height: 5600, darkness: 0.62, tint: '#3a4a60', ground: '#4a4a44' };

const HALF = Math.PI / 2;

/** Key heights and places of the layout (the art reads them). */
export const METRO = Object.freeze({
  street: 320, concourse: 140, platform: 40,
  station: { x0: 2000, y0: 1500, x1: 2700, y1: 2900 },
  entryStair: { x0: 2300, x1: 2700, y0: 1990, y1: 2230 },
  foyer: { x0: 2700, y0: 1500, x1: 3500, y1: 2700 },
  concourseRect: { x0: 3500, y0: 1500, x1: 5600, y1: 3000 },
  staffStair: { x0: 4800, x1: 5200, y0: 1100, y1: 1300 },
  hall: { x0: 5200, y0: 300, x1: 9040, y1: 1300 },
  platformRect: { x0: 5200, y0: 820, x1: 8800, y1: 1300 },
  cars: [[5500, 6100], [6120, 6720], [6740, 7340]],
  car: { y0: 670, y1: 820 },
  tunnel: { x0: 9040, y0: 300, x1: 11700, y1: 820 },
  south: { x0: 10560, y0: 820, x1: 10900, y1: 2700 },
  sump: { x0: 8900, y0: 2200, x1: 10560, y1: 3000 },
  pump: { x0: 8200, y0: 2200, x1: 8900, y1: 2700 },
  works: { x0: 6600, y0: 3500, x1: 9400, y1: 4700 },
  exitStair: { x0: 4900, x1: 5500, y0: 4190, y1: 4430 },
  square: { x0: 1400, y0: 3900, x1: 4900, y1: 5500 },
  statue: { x: 3200, y: 4700 },
});

/**
 * Lay the level out.
 * @param {object} B map builder (maps.js createBuilder) with the level calls of JOURNEY.md §3
 */
export function build(B) {
  const K = levelKit(B, { wall: 16, door: 80, style: 'mt' });
  // midday: the sun high over the square; underground, the day comes down the stairwells and through
  // the pavement lights. At night the streets are dark and the tunnels darker.
  B.map.look = { day: { az: 200, el: 58, cover: 0.3, wet: 0.2, fog: 0.00022 }, night: { fogDensity: 0.0011, hemi: 0.7, moonI: 0.4 } };

  B.section('street', 'Station Street', 1750, 2200, 3500, 2200);
  B.section('concourse', 'Concourse', 4550, 2250, 2100, 1500);
  B.section('platform', 'Line 2 Platform', 6820, 900, 4440, 1200);
  B.section('tunnel', 'Tunnel 2', 10370, 1500, 2660, 2400);
  B.section('flooded', 'The Sump', 9380, 2550, 2360, 900);
  B.section('maintenance', 'Maintenance Works', 7650, 3900, 4300, 1800);
  B.section('exit', 'Harlan Square', 3250, 4600, 4500, 2000);

  buildStreet(B, K);
  buildConcourse(B, K);
  buildPlatform(B, K);
  buildTunnel(B, K);
  buildSump(B, K);
  buildWorks(B, K);
  buildSquare(B, K);

  const sx = 300, sy = 2200;
  B.anchor('start', sx, sy, 180);
  for (let k = 0; k < 6; k++) B.pspawn(sx - 90 + (k % 3) * 90, sy - 50 + Math.floor(k / 3) * 100);
  B.supply(sx + 220, sy - 80);
  K.finish();
}

// ---------------------------------------------------------------------------------------------
// STREET (x 0..2700 at 320) and the unpaid foyer (140)

function buildStreet(B, K) {
  const S = 'street', H = METRO.street, ST = METRO.station, ES = METRO.entryStair, F = METRO.foyer;
  const { rng, drng } = B;
  // the city's ground, raised (it runs on past the map's west edge so the backdrop stands on it)
  K.plateau(-3000, -3000, ST.x0, 3600, H);
  K.plateau(ST.x0, -3000, ST.x1, ES.y0, H);
  K.plateau(ST.x0, ES.y1, ST.x1, 3600, H);
  K.plateau(ST.x0, ES.y0, ES.x0, ES.y1, H);                     // the lobby's floor over the stair's head
  K.flightX(ES.x0, ES.x1, ES.y0, ES.y1, METRO.concourse, H, -1, ES.x0, 48);
  K.plateau(ES.x1 - 40, ES.y0, ES.x1, ES.y1, METRO.concourse);   // (a flight leaves its lowest run to the floor below)
  K.guard(ES.x0, ES.y0, ES.x1, ES.y1);
  // the street: road, sidewalks, the crossing at the station
  B.box('asphalt', -200, 1750, ST.x0, 2650);
  B.box('concrete', -200, 1500, ST.x0, 1750);
  B.box('concrete', -200, 2650, ST.x0, 2900);
  B.line('yellow_double', 0, 2200, 1700, 2200, 3);
  B.line('crosswalk', 1720, 1760, 1720, 2640, 50);
  // the buildings along both sides (and one across the west end, off the map)
  const blocks = (y, a, xs, depth, seed) => {
    xs.forEach(([x0, x1], i) => {
      const top = 180 + Math.round(((seed * 7 + i * 13) % 50));
      B.ob('building', (x0 + x1) / 2, y, x1 - x0, depth, a, { color: ['#8c7a6a', '#9a8a72', '#7a6a5a', '#a09080', '#8a6a5a'][(i + seed) % 5], roof: '#4e4a45', top, section: S });
    });
  };
  blocks(1300, 0, [[0, 430], [430, 900], [900, 1420], [1420, 2000]], 400, 1);
  blocks(3250, Math.PI, [[0, 520], [520, 980], [980, 1500], [1500, 2000]], 700, 2);
  // north and south of the station building: more blocks on the raised ground
  B.ob('building', 2350, 1300, 700, 400, 0, { color: '#7a7a82', roof: '#4e4a45', top: 230, section: S });
  B.ob('building', 2350, 3250, 700, 700, Math.PI, { color: '#8a7a6a', roof: '#4e4a45', top: 210, section: S });
  // the station building: a lobby behind a glass front, the stairs down under its east half
  const EXT = 24;
  K.wall(ST.x0, ST.y0, ST.x0, ST.y1, { t: EXT, style: 'station-ext', section: S, doors: [{ at: 2110, w: 300, kind: 'arch', style: 'station-ext' }] });
  K.windowRow(ST.x0, ST.y0, ST.x0, ST.y1, 160, { w: 120, h: 150, sill: 16, t: EXT, section: S, style: 'station-ext', skip: [[1930, 2290]] });
  K.wall(ST.x0, ST.y0, ST.x1, ST.y0, { t: EXT, style: 'station-ext', section: S });
  K.wall(ST.x0, ST.y1, ST.x1, ST.y1, { t: EXT, style: 'station-ext', section: S });
  K.wall(ST.x1, ST.y0, ST.x1, ES.y0 - 8, { t: EXT, style: 'station-ext', section: S });
  K.wall(ST.x1, ES.y1 + 8, ST.x1, ST.y1, { t: EXT, style: 'station-ext', section: S });
  K.roof(ST.x0 + 12, ST.y0 + 12, ES.x0, ST.y1 - 12, { kind: 'plain', height: 150, section: S, style: 'mt-lobby', dark: 0.3 });
  // the stairwell: walls either side from the lobby down to the foyer, a tall sloped ceiling
  K.wall(ES.x0, ES.y0 - 8, ES.x1 + 16, ES.y0 - 8, { style: 'mt-tile', section: S });
  K.wall(ES.x0, ES.y1 + 8, ES.x1 + 16, ES.y1 + 8, { style: 'mt-tile', section: S });
  K.wall(ES.x0, ST.y0 + 12, ES.x0, ES.y0 - 16, { style: 'mt-tile', section: S });
  K.wall(ES.x0, ES.y1 + 16, ES.x0, ST.y1 - 12, { style: 'mt-tile', section: S });
  K.roof(ES.x0, ES.y0, ES.x1, ES.y1, { kind: 'plain', height: 470, section: S, style: 'mt-stair', dark: 0.5 });
  K.put('stairflight', (ES.x0 + ES.x1) / 2, (ES.y0 + ES.y1) / 2, 0, { x0: ES.x0, x1: ES.x1, y0: ES.y0, y1: ES.y1, h0: METRO.concourse, h1: H, dir: -1 });
  // the lobby: a map board, benches, a fallen departures sign
  B.ob('desk', 2150, 1650, 160, 30, 0, { style: 'mt-bench', section: S });
  B.ob('desk', 2150, 2750, 160, 30, 0, { style: 'mt-bench', section: S });
  B.ob('cabinet', 2270, 1620, 30, 120, 0, { style: 'mt-mapboard', section: S });
  K.put('bigsign', ST.x0 - 14, 2110, Math.PI, { hy: H + 190, w: 460 });
  B.anchor('metro_entrance', 1850, 2110, 150);
  // the newsstand on the south sidewalk, a phone box, a bus stop
  B.ob('booth', 1500, 2790, 130, 70, 0, { style: 'newsstand', section: S });
  B.anchor('newsstand', 1500, 2660, 120);
  B.ob('cabinet', 900, 2840, 30, 30, 0, { style: 'phonebox', section: S });
  // wrecks: a jam heading east, a bus across the road, a police cruiser
  for (const [x, y, a, k] of [[300, 1950, 0.05, 'car'], [520, 1960, -0.1, 'suv'], [760, 2430, 3.2, 'van'], [1120, 1920, 0.3, 'car'], [1350, 2450, 2.9, 'pickup'], [1600, 2380, 3.5, 'car']]) {
    B.vehicle(k, x, y, a, { wrecked: drng.chance(0.4) });
  }
  B.vehicle('bus', 950, 2150, 0.55, { wrecked: true, color: '#c9a227' });
  B.vehicle('car', 1850, 1880, 2.2, { wrecked: true, burning: true });
  // street furniture: lamp posts, trees in pits, bins, hydrants, barricades
  for (let x = 200; x < 1900; x += 420) {
    B.lamp(x, 1560, { a: HALF, color: B.lib.LAMP_COLOR, deadChance: 0.5, r: 300 });
    B.lamp(x + 210, 2840, { a: -HALF, color: B.lib.LAMP_COLOR, deadChance: 0.5, r: 300 });
  }
  for (const [x, y] of [[400, 1620], [1250, 1620], [650, 2790], [1900, 2790]]) B.tree(x, y, 0.9);
  for (const [x, y, a] of [[1700, 1650, 0.2], [1760, 2560, 1.2], [1600, 2110, 1.57]]) K.dress('barricade', x, y, a, 1, 0.3);
  for (const [x, y] of [[700, 1560], [1500, 1560], [300, 2840]]) K.dress('bin', x, y, 0, 1, 0.4);
  K.dress('hydrant', 1100, 1570, 0, 1, 0.4);
  K.dress('busstop', 600, 2860, Math.PI, 1, 0.2);
  // spawns: the street's ends and alleys, the lobby's back corners
  B.zspawn(120, 1620, 160, 160, 1, S);
  B.zspawn(120, 2780, 160, 160, 1, S);
  B.zspawn(1000, 1580, 300, 80, 0.8, S);
  B.zspawn(1300, 2830, 300, 80, 0.8, S);
  B.zspawn(2230, 1820, 100, 160, 1, S);
  B.zspawn(2230, 2520, 100, 160, 1, S);
  B.checkpoint(S, 700, 2200);
  B.checkpoint(S, 1700, 2200);
  B.checkpoint(S, 2150, 2110);
  K.scatter('litter', 40, 0, 1520, 2000, 2880, [0.8, 1.2], 8);
  K.scatter('paperf', 30, 0, 1520, 2000, 2880, [0.8, 1.3], 6);
  K.scatter('glassf', 16, 0, 1520, 2000, 2880, [0.9, 1.5], 4);
  K.scatter('bag', 14, 0, 1520, 2000, 2880, [0.8, 1.2], 8);
  K.scatter('blood', 12, 0, 1520, 2000, 2880, [0.8, 1.5], 6);
  K.scatter('shoe', 8, 0, 1520, 2000, 2880, [0.9, 1.1], 8);
  K.scatter('suitcase', 5, 0, 1520, 2000, 2880, [0.9, 1.1], 10);
  K.scatter('leaves', 14, 0, 1520, 2000, 2880, [0.8, 1.5], 6);
  K.scatter('paperf', 10, 2020, 1520, 2290, 2880, [0.8, 1.3], 6);

  // ---- the foyer (the unpaid side, 140): ticket machines, the office window, the turnstile line
  K.plateau(F.x0, F.y0, F.x1, F.y1, METRO.concourse);
  K.guard(F.x0, F.y0, F.x1, F.y1);
  K.wall(F.x0, F.y0, F.x1, F.y0, { style: 'mt-tile', section: S });
  K.wall(F.x0, F.y1, F.x1, F.y1, { style: 'mt-tile', section: S });
  K.roof(F.x0, F.y0, F.x1, F.y1, { kind: 'plain', height: 170, section: S, style: 'mt-foyer', dark: 0.7 });
  for (let x = 2800; x < 3150; x += 90) B.ob('cabinet', x, F.y0 + 30, 50, 36, 0, { style: 'ticketmachine', section: S });
  for (let x = 2850; x < 3400; x += 90) B.ob('cabinet', x, F.y1 - 30, 50, 36, Math.PI, { style: 'ticketmachine', section: S });
  // the ticket office (x 3180..3500, y 1500..1780): its window onto the foyer, its door on the paid side
  K.wall(3180, F.y0 + 8, 3180, 1780, { style: 'mt-office', section: S });
  K.wall(3180, 1780, 3500, 1780, { style: 'mt-office', section: S });
  K.windowRow(3180, 1780, 3500, 1780, 100, { w: 80, h: 40, sill: 34, section: S, style: 'mt-office', kind: 'glass' });
  K.roof(3188, F.y0 + 8, 3492, 1772, { kind: 'office', height: 120, section: 'concourse', style: 'mt-office', dark: 0.7 });
  B.ob('counter', 3340, 1740, 300, 30, 0, { style: 'mt-ticketdesk', section: 'concourse' });
  B.ob('cabinet', 3460, 1560, 40, 90, 0, { style: 'mt-safe', section: 'concourse' });
  // the line: turnstiles either side of the wide gate (the gate: bars)
  B.ob('wall', F.x1, (1780 + 2020) / 2, 50, 2020 - 1780, 0, { style: 'turnstiles', section: S });
  K.gateIn('turnstiles', 'bars', F.x1, 2110, 180, false, { t: 50, section: 'concourse', label: 'Turnstile gate', frame: 'mt-gateframe', h: 100 });
  B.ob('wall', F.x1, (2200 + F.y1) / 2, 50, F.y1 - 2200, 0, { style: 'turnstiles', section: S });
  // lights: the day down the stairs; strip lights, a flickering one
  const L = (x, y, r, c, f = 0, h = METRO.concourse + 165) => B.light(x, y, r, c, f, h);
  L(2950, 1800, 240, '#e8f0ff', 0.3); L(3200, 2400, 240, '#e8f0ff', 0.7); L(2150, 2200, 300, '#fff0d8', 0, H + 145);
  B.zspawn(2800, 2600, 160, 80, 1, S);
  B.zspawn(3100, 1560, 120, 60, 0.8, S);
  B.checkpoint(S, 2850, 2110);
  B.checkpoint(S, 3300, 2400);
  K.scatter('paperf', 16, F.x0 + 30, F.y0 + 60, F.x1 - 60, F.y1 - 60, [0.8, 1.3], 6);
  K.scatter('litter', 14, F.x0 + 30, F.y0 + 60, F.x1 - 60, F.y1 - 60, [0.8, 1.2], 8);
  K.scatter('blood', 6, F.x0 + 30, F.y0 + 60, F.x1 - 60, F.y1 - 60, [0.8, 1.5], 6);
}

// ---------------------------------------------------------------------------------------------
// CONCOURSE (x 3500..5600, y 1500..3000 at 140)

function buildConcourse(B, K) {
  const S = 'concourse', C = METRO.concourseRect, HC = METRO.concourse;
  K.plateau(C.x0, C.y0, C.x1, C.y1, HC);
  K.guard(C.x0, C.y0, C.x1, C.y1);
  // the walls: north (the staff door, the caved-in public stairs), south (the shops), east
  K.wall(C.x0, C.y0, 4630, C.y0, { style: 'mt-tile', section: S });
  K.gateIn('platform_door', 'door', 4700, C.y0, 120, true, { section: 'platform', label: 'Staff door', frame: 'mt-tile', h: 86, leaves: 1 });
  K.wall(4770, C.y0, C.x1, C.y0, { style: 'mt-tile', section: S });
  K.wall(C.x1, C.y0, C.x1, C.y1, { style: 'mt-tile', section: S });
  K.wall(C.x0, 1500, C.x0, 1780, { style: 'mt-office', section: S, doors: [{ at: 1640, w: 90, kind: 'leaf', style: 'mt-office' }] });
  // the public stairs to the trains: a shutter down, rubble in front
  B.ob('wall', 5380, C.y0 + 30, 300, 24, 0, { style: 'mt-shutter-closed', section: S });
  for (const [x, y, w, h, a] of [[5300, 1620, 120, 60, 0.3], [5450, 1640, 90, 50, -0.4]]) B.ob('counter', x, y, w, h, a, { style: 'rubble', section: S });
  // shops along the south wall: the café (open), the newsagent (shut), the florist (open)
  const SY = 2700;
  K.wall(C.x0, SY, C.x1 - 400, SY, { style: 'mt-shopfront', section: S, doors: [{ at: 3950, w: 110, kind: 'glass' }, { at: 4950, w: 110, kind: 'glass' }] });
  for (const x of [4200, 4700]) K.wall(x, SY + 8, x, C.y1, { style: 'mt-tile', section: S });
  K.windowRow(C.x0, SY, 4200, SY, 140, { w: 110, h: 80, sill: 14, section: S, style: 'mt-shopfront', skip: [[3880, 4020]] });
  K.windowRow(4700, SY, 5200, SY, 140, { w: 110, h: 80, sill: 14, section: S, style: 'mt-shopfront', skip: [[4880, 5020]] });
  K.put('shopfront', 4450, SY - 9, Math.PI, { w: 460, h: 130, base: HC, kind: 'shutter', name: 'news' });
  K.put('fascia', 3850, SY - 9, Math.PI, { w: 680, base: HC, name: 'cafe' });
  K.put('fascia', 4950, SY - 9, Math.PI, { w: 480, base: HC, name: 'florist' });
  const R = (x0, y0, x1, y1, style, h = 130) => K.roof(x0, y0, x1, y1, { kind: 'plain', height: h, section: S, style, dark: 0.8 });
  R(C.x0, SY, 4200, C.y1, 'mt-cafe');
  R(4200, SY, 4700, C.y1, 'mt-void');
  R(4700, SY, 5200, C.y1, 'mt-florist');
  R(5200, SY, C.x1, C.y1, 'mt-void');
  K.wall(5200, SY, 5200, C.y1, { style: 'mt-tile', section: S });
  K.wall(5200, SY, C.x1, SY, { style: 'mt-tile', section: S });
  // the hall
  R(C.x0, C.y0, C.x1, SY, 'mt-concourse', 190);
  for (let x = 3850; x < 5500; x += 350) for (const y of [1950, 2350]) B.ob('ipillar', x, y, 40, 40, 0, { style: 'mt-col', section: S, top: HC + 190 });
  // the café: tables, the counter, the coffee machine
  B.ob('counter', 3700, 2940, 300, 40, 0, { style: 'cafecounter', section: S });
  for (const [x, y] of [[3650, 2820], [3830, 2830], [4030, 2800], [4100, 2920]]) B.ob('desk', x, y, 50, 50, x * 0.01, { style: 'cafetable', section: S });
  // the florist: buckets and a counter
  B.ob('counter', 4950, 2950, 300, 36, 0, { style: 'florist', section: S });
  // benches, bins, the line map, a vending machine
  for (const [x, y] of [[4000, 2150], [4700, 2150], [5250, 2150]]) B.ob('desk', x, y, 140, 30, 0, { style: 'mt-bench', section: S });
  B.ob('cabinet', 5560, 2200, 36, 60, 0, { style: 'mt-vend', section: S });
  B.ob('cabinet', 5570, 2500, 20, 200, 0, { style: 'mt-mapboard', section: S });
  B.anchor('concourse_gates', 3620, 2110, 130);
  B.anchor('ticket_office', 3590, 1640, 100);
  B.anchor('concourse_shops', 4450, 2580, 140);
  // lights: strip lights, pavement lights (the day comes through), the café's neon
  const L = (x, y, r, c, f = 0, h = HC + 185) => B.light(x, y, r, c, f, h);
  L(3900, 1800, 300, '#e8f0ff', 0.2); L(4600, 2200, 300, '#e8f0ff', 0.6); L(5300, 1800, 260, '#e8f0ff'); L(4300, 2500, 260, '#e8f0ff', 0.9);
  L(3850, 2850, 220, '#ffd8a0', 0.3, HC + 125); L(4950, 2850, 200, '#ffb0c8', 0.5, HC + 125); L(3340, 1640, 180, '#ffe8c8', 0.2, HC + 115);
  K.put('pavementlights', 4550, 2000, 0, { x0: 3800, x1: 5300, y0: 1700, y1: 2500, h: HC + 190 });
  B.zspawn(5470, 1800, 100, 80, 1, S);
  B.zspawn(5450, 2600, 120, 100, 1, S);
  B.zspawn(3980, 2950, 80, 40, 0.8, S);
  B.zspawn(5120, 2800, 80, 80, 0.8, S);
  B.checkpoint(S, 3700, 2110);
  B.checkpoint(S, 4600, 1750);
  B.checkpoint(S, 5200, 2450);
  K.scatter('paperf', 26, C.x0 + 60, C.y0 + 60, C.x1 - 60, SY - 40, [0.8, 1.3], 6);
  K.scatter('litter', 26, C.x0 + 60, C.y0 + 60, C.x1 - 60, SY - 40, [0.8, 1.2], 8);
  K.scatter('glassf', 12, C.x0 + 60, C.y0 + 60, C.x1 - 60, SY - 40, [0.9, 1.5], 4);
  K.scatter('blood', 12, C.x0 + 60, C.y0 + 60, C.x1 - 60, SY - 40, [0.8, 1.5], 6);
  K.scatter('bag', 10, C.x0 + 60, C.y0 + 60, C.x1 - 60, SY - 40, [0.8, 1.2], 8);
  K.scatter('suitcase', 4, C.x0 + 60, C.y0 + 60, C.x1 - 60, SY - 40, [0.9, 1.1], 10);
  K.dress('bodybag', 4300, 1900, 0.4, 1, 0.3);
  K.dress('stroller', 4900, 2250, 1.1, 1, 0.5);
}

// ---------------------------------------------------------------------------------------------
// PLATFORM (the staff way down, Line 2: platform at 40, track bed at 0, the dead train)

function buildPlatform(B, K) {
  const S = 'platform', HC = METRO.concourse, HP = METRO.platform, SS = METRO.staffStair, HL = METRO.hall, P = METRO.platformRect;
  // the staff corridor (140) and the service stair down to the platform's west end
  K.plateau(4600, SS.y0, SS.x0, METRO.concourseRect.y0, HC);
  K.guard(4600, SS.y0, SS.x0, METRO.concourseRect.y0);
  K.flightX(SS.x0, SS.x1, SS.y0, SS.y1, HP, HC, -1, SS.x0, 32);
  K.plateau(SS.x1 - 40, SS.y0, SS.x1, SS.y1, HP);
  K.guard(SS.x0, SS.y0, SS.x1, SS.y1);
  K.wall(4600, SS.y0, 4600, METRO.concourseRect.y0, { style: 'mt-service', section: S });
  K.wall(4600, SS.y0, SS.x1, SS.y0, { style: 'mt-service', section: S });
  K.wall(4800, SS.y1, 4800, METRO.concourseRect.y0, { style: 'mt-service', section: S });
  K.wall(4800, SS.y1, SS.x1, SS.y1, { style: 'mt-service', section: S });
  K.roof(4600, SS.y0, 4800, METRO.concourseRect.y0, { kind: 'plain', height: 120, section: S, style: 'mt-service', dark: 0.9 });
  K.roof(SS.x0, SS.y0, SS.x1, SS.y1, { kind: 'plain', height: 220, section: S, style: 'mt-servicestair', dark: 0.9 });
  K.put('stairflight', (SS.x0 + SS.x1) / 2, (SS.y0 + SS.y1) / 2, 0, { x0: SS.x0, x1: SS.x1, y0: SS.y0, y1: SS.y1, h0: HP, h1: HC, dir: -1, service: 1 });
  // the platform hall: a tiled barrel vault over the platform (40) and the track bed (0)
  K.plateau(P.x0, P.y0, P.x1, P.y1, HP);
  K.guard(P.x0, P.y0, P.x1, P.y1);
  K.wall(HL.x0, HL.y0, HL.x1, HL.y0, { t: 24, style: 'mt-tunnelwall', section: S });
  K.wall(HL.x0, P.y1, P.x1 + 200, P.y1, { t: 24, style: 'mt-tile', section: S });
  K.wall(HL.x0, HL.y0, HL.x0, SS.y0, { t: 24, style: 'mt-tile', section: S });
  K.roof(HL.x0, P.y0, P.x1, P.y1, { kind: 'plain', height: 200, section: S, style: 'mt-platform', dark: 0.75 });
  K.roof(HL.x0, HL.y0, 9040, P.y0, { kind: 'plain', height: 240, section: S, style: 'mt-track', dark: 0.8 });
  K.roof(P.x1, P.y0, 9040, P.y1, { kind: 'plain', height: 240, section: S, style: 'mt-track', dark: 0.8 });
  K.put('rails', (HL.x0 + 9040) / 2, 500, 0, { x0: HL.x0, x1: 9040, ys: [455, 745] });
  K.put('platformedge', (P.x0 + P.x1) / 2, P.y0, 0, { x0: P.x0, x1: P.x1, h: HP });
  // the dead train: three cars you can walk through, the cab at the head (east)
  const CY = METRO.car;
  const T = 12;
  METRO.cars.forEach(([x0, x1], k) => {
    K.plateau(x0, CY.y0, x1, CY.y1, HP);
    const doorsS = [x0 + 120, x0 + 300, x0 + 480].map((at) => ({ at, w: 80, kind: 'train', style: 'train' }));
    const doorsN = (k === 1 ? [x0 + 150, x0 + 450] : [x0 + 300]).map((at) => ({ at, w: 80, kind: 'train', style: 'train' }));
    K.wall(x0, CY.y1 - T / 2, x1, CY.y1 - T / 2, { t: T, style: 'train', section: S, doors: doorsS });
    K.wall(x0, CY.y0 + T / 2, x1, CY.y0 + T / 2, { t: T, style: 'train', section: S, doors: doorsN });
    K.wall(x0 + T / 2, CY.y0 + T, x0 + T / 2, CY.y1 - T, { t: T, style: 'train', section: S, doors: [{ at: 745, w: 76, kind: 'train', style: 'train' }] });
    K.wall(x1 - T / 2, CY.y0 + T, x1 - T / 2, CY.y1 - T, { t: T, style: 'train', section: S, doors: k === 2 ? [] : [{ at: 745, w: 76, kind: 'train', style: 'train' }] });
    K.roof(x0 + T, CY.y0 + T, x1 - T, CY.y1 - T, { kind: 'plain', height: 92, section: S, style: 'mt-car', dark: 0.7 });
    if (k < 2) K.plateau(x1, 705, METRO.cars[k + 1][0], 785, HP);
    // seats along both sides between the doors (none in front of a door)
    const clear = (a, b, ds) => !ds.some((d) => a < d.at + d.w / 2 + 4 && b > d.at - d.w / 2 - 4);
    for (const [a, b] of [[x0 + 20, x0 + 76], [x0 + 164, x0 + 256], [x0 + 344, x0 + 436], [x0 + 524, x0 + 580]]) {
      if (k === 2 && b > x1 - 140) continue;
      if (clear(a, b, doorsS)) B.ob('desk', (a + b) / 2, CY.y1 - T - 14, b - a, 24, 0, { style: 'trainseat', section: S });
      if (clear(a, b, doorsN)) B.ob('desk', (a + b) / 2, CY.y0 + T + 14, b - a, 24, Math.PI, { style: 'trainseat', section: S });
    }
    K.put('traincar', (x0 + x1) / 2, (CY.y0 + CY.y1) / 2, 0, { x0, x1, y0: CY.y0, y1: CY.y1, h: HP, k, cab: k === 2 ? 1 : 0 });
  });
  // the cab: a partition with a door, the driver's desk
  const [c0, c1] = METRO.cars[2];
  K.wall(c1 - 120, CY.y0 + T, c1 - 120, CY.y1 - T, { style: 'train', section: S, doors: [{ at: 745, w: 76, kind: 'leaf', style: 'train' }] });
  B.ob('counter', c1 - 30, 745, 30, 100, 0, { style: 'cabdesk', section: S });
  B.anchor('platform_cab', c1 - 75, 745, 50);
  void c0;
  // the collapse: the platform's ceiling came down between the second and third cars' doors
  for (const [x, y, w, h, a] of [[6560, 900, 200, 150, 0.2], [6600, 1060, 240, 140, -0.3], [6540, 1210, 200, 150, 0.4]]) B.ob('wall', x, y, w, h, a, { style: 'rubble', section: S });
  K.put('collapse', 6560, 1060, 0, { w: 360, d: 480 });
  B.anchor('platform_train', 6000, 900, 120);
  // platform furniture: benches, bins, the station name, maps
  for (const x of [5500, 5950, 7200, 7750, 8300]) B.ob('desk', x, P.y1 - 40, 140, 30, 0, { style: 'mt-bench', section: S });
  for (const x of [5700, 7500, 8550]) B.ob('cabinet', x, P.y1 - 30, 24, 24, 0, { style: 'mt-bin', section: S });
  B.ob('cabinet', 8000, P.y1 - 24, 40, 30, 0, { style: 'mt-vend', section: S });
  for (const x of [5500, 6300, 7100, 7900, 8600]) K.put('stationname', x, P.y1 - 13, Math.PI, { h: HP });
  // the platform end: steps down to the track bed and the tunnel mouth
  K.flightX(P.x1, P.x1 + 200, 830, 1100, 0, HP, -1, P.x1, 12);
  K.plateau(P.x1, 1100, P.x1 + 200, P.y1, HP);
  K.guard(P.x1, 830, P.x1 + 200, 1100);
  K.put('stairflight', P.x1 + 100, 965, 0, { x0: P.x1, x1: P.x1 + 200, y0: 830, y1: 1100, h0: 0, h1: HP, dir: -1, service: 1 });
  K.wall(P.x1 + 200, 1100, P.x1 + 200, P.y1, { t: 24, style: 'mt-tile', section: S });
  K.wall(P.x1, 1100, P.x1 + 200, 1100, { style: 'mt-tile', section: S });
  B.anchor('platform_end', 8650, 1060, 110);
  // the tunnel gate across the mouth, the wall below the steps
  K.gateIn('tunnel_gate', 'gate', 9040, (HL.y0 + CY.y1) / 2, CY.y1 - HL.y0, false, { t: 20, section: 'tunnel', label: 'Tunnel gate', frame: 'mt-tunnelwall', h: 140 });
  K.wall(9040, CY.y1, 9040, 1100, { t: 24, style: 'mt-tunnelwall', section: S });
  // lights: strip lights on the platform (a few alive), the train's emergency lamps
  const L = (x, y, r, c, f = 0, h = HP + 195) => B.light(x, y, r, c, f, h);
  L(5600, 1060, 300, '#e8f0ff', 0.3); L(6900, 1060, 280, '#e8f0ff', 0.8); L(7900, 1060, 300, '#e8f0ff', 0.2); L(8600, 1000, 240, '#ff4030', 0.3, HP + 180);
  for (const [x0] of METRO.cars) B.light(x0 + 300, 745, 200, '#dfe8ff', 0.5, HP + 90);
  L(4700, 1300, 160, '#ffb060', 0.4, HC + 115);
  B.zspawn(5300, 400, 160, 120, 1, S);
  B.zspawn(8900, 400, 200, 120, 1, S);
  B.zspawn(7700, 450, 300, 100, 1, S);
  B.zspawn(8300, 1220, 200, 60, 0.8, S);
  B.zspawn(5350, 1230, 160, 60, 0.8, S);
  B.checkpoint(S, 5350, 1000);
  B.checkpoint(S, 7000, 1050);
  B.checkpoint(S, 8500, 950);
  K.scatter('paperf', 26, P.x0 + 40, P.y0 + 30, P.x1 - 40, P.y1 - 60, [0.8, 1.3], 6);
  K.scatter('litter', 20, P.x0 + 40, P.y0 + 30, P.x1 - 40, P.y1 - 60, [0.8, 1.2], 8);
  K.scatter('blood', 14, P.x0 + 40, P.y0 + 30, P.x1 - 40, P.y1 - 60, [0.8, 1.6], 6);
  K.scatter('bag', 10, P.x0 + 40, P.y0 + 30, P.x1 - 40, P.y1 - 60, [0.8, 1.2], 8);
  K.scatter('suitcase', 6, P.x0 + 40, P.y0 + 30, P.x1 - 40, P.y1 - 60, [0.9, 1.1], 10);
  K.scatter('litter', 16, HL.x0 + 40, HL.y0 + 40, 9000, 650, [0.8, 1.2], 8);
  K.dress('bodybag', 7600, 1000, 0.1, 1, 0.3);
}

// ---------------------------------------------------------------------------------------------
// TUNNEL (double track east to the junction, the blocked east bore, the south bore)

function buildTunnel(B, K) {
  const S = 'tunnel', TN = METRO.tunnel, SB = METRO.south;
  K.wall(TN.x0, TN.y0, TN.x1, TN.y0, { t: 24, style: 'mt-tunnelwall', section: S });
  K.wall(TN.x0, TN.y1, SB.x0, TN.y1, { t: 24, style: 'mt-tunnelwall', section: S });
  K.wall(SB.x1, TN.y1, TN.x1, TN.y1, { t: 24, style: 'mt-tunnelwall', section: S });
  K.wall(TN.x1, TN.y0, TN.x1, TN.y1, { t: 24, style: 'mt-tunnelwall', section: S });
  K.roof(TN.x0, TN.y0, TN.x1, TN.y1, { kind: 'plain', height: 170, section: S, style: 'mt-tunnel', dark: 0.9 });
  K.put('rails', (TN.x0 + TN.x1) / 2, 560, 0, { x0: TN.x0, x1: TN.x1, ys: [455, 665] });
  // the south bore
  K.wall(SB.x0, TN.y1, SB.x0, 2440, { t: 24, style: 'mt-tunnelwall', section: S });
  K.gateIn('sump_door', 'door', SB.x0, 2500, 120, false, { t: 24, section: 'flooded', label: 'Bulkhead', frame: 'mt-tunnelwall', h: 88, leaves: 1 });
  K.wall(SB.x0, 2560, SB.x0, SB.y1, { t: 24, style: 'mt-tunnelwall', section: S });
  K.wall(SB.x1, TN.y1, SB.x1, SB.y1, { t: 24, style: 'mt-tunnelwall', section: S });
  K.wall(SB.x0, SB.y1, SB.x1, SB.y1, { t: 24, style: 'mt-tunnelwall', section: S });
  K.roof(SB.x0, TN.y1, SB.x1, SB.y1, { kind: 'plain', height: 170, section: S, style: 'mt-tunnel', dark: 0.9 });
  K.put('rails', (SB.x0 + SB.x1) / 2, (TN.y1 + SB.y1) / 2, HALF, { y0: TN.y1 - 100, y1: SB.y1 - 40, xs: [SB.x0 + 120, SB.x1 - 120], axis: 'y' });
  // the junction: points, the signal box on the wall; the east bore blocked by a derailed works train
  B.anchor('tunnel_junction', 10700, 560, 130);
  for (const [x, y, w, h, a] of [[11250, 480, 300, 110, 0.35], [11420, 650, 260, 100, -0.25]]) B.ob('container', x, y, w, h, a, { style: 'workscar', section: S });
  B.ob('wall', 11600, 560, 120, 480, 0, { style: 'rubble', section: S });
  // signals along the south bore; the anchor by the red one
  for (const y of [1000, 1500, 2100]) K.put('signal', SB.x1 - 16, y, Math.PI, { red: y === 1500 ? 1 : 0 });
  B.anchor('tunnel_signal', 10730, 1500, 110);
  // a refuge niche and cable runs
  K.put('cables', (TN.x0 + TN.x1) / 2, TN.y0 + 14, 0, { x0: TN.x0, x1: TN.x1, side: 1 });
  K.put('cables', SB.x1 - 14, (SB.y0 + SB.y1) / 2, HALF, { y0: SB.y0, y1: SB.y1, side: -1, axis: 'y' });
  // a service trolley and sleepers stacked along the way
  B.ob('counter', 9800, 380, 120, 50, 0, { style: 'sleepers', section: S });
  B.ob('counter', 10700, 1900, 60, 120, 0, { style: 'railtrolley', section: S });
  B.ob('counter', 10640, 1200, 50, 100, 0, { style: 'sleepers', section: S });
  // lights: the odd working bulkhead lamp, the signals' glow
  const L = (x, y, r, c, f = 0, h = 150) => B.light(x, y, r, c, f, h);
  L(9400, 330, 220, '#ffc27a', 0.4); L(10200, 790, 220, '#ffc27a', 0.2); L(10880, 1300, 200, '#ffc27a', 0.6); L(10580, 2200, 200, '#ffc27a', 0.3);
  L(10880, 1500, 120, '#ff2a1a', 0, 120);
  B.zspawn(11000, 400, 200, 120, 1, S);
  B.zspawn(10730, 2600, 200, 100, 1, S);
  B.zspawn(9500, 760, 200, 60, 0.8, S);
  B.checkpoint(S, 9300, 560);
  B.checkpoint(S, 10700, 900);
  B.checkpoint(S, 10730, 2300);
  K.scatter('litter', 16, TN.x0 + 40, TN.y0 + 40, 11000, TN.y1 - 40, [0.8, 1.2], 8);
  K.scatter('blood', 10, TN.x0 + 40, TN.y0 + 40, 11000, TN.y1 - 40, [0.8, 1.6], 6);
  K.scatter('paperf', 8, SB.x0 + 40, SB.y0 + 40, SB.x1 - 40, SB.y1 - 40, [0.8, 1.2], 6);
  K.scatter('blood', 8, SB.x0 + 40, SB.y0 + 40, SB.x1 - 40, SB.y1 - 40, [0.8, 1.6], 6);
}

// ---------------------------------------------------------------------------------------------
// FLOODED (the sump chamber in water, the pump room, the valve)

function buildSump(B, K) {
  const S = 'flooded', SU = METRO.sump, PU = METRO.pump;
  // (the east side is the south bore's wall, with the bulkhead; below the bore's end, the chamber's own)
  K.wall(SU.x0, SU.y0, SU.x1, SU.y0, { t: 24, style: 'mt-brick', section: S });
  K.wall(SU.x1, METRO.south.y1, SU.x1, SU.y1, { t: 24, style: 'mt-brick', section: S });
  K.wall(SU.x0, SU.y1, 9200, SU.y1, { t: 24, style: 'mt-brick', section: S });
  K.gateIn('maint_shutter', 'shutter', 9300, SU.y1, 200, true, { t: 24, section: 'maintenance', label: 'Works shutter', frame: 'mt-brick', h: 120 });
  K.wall(9400, SU.y1, SU.x1, SU.y1, { t: 24, style: 'mt-brick', section: S });
  K.wall(SU.x0, SU.y0, SU.x0, PU.y1, { t: 24, style: 'mt-brick', section: S, doors: [{ at: 2450, w: 140, kind: 'arch', style: 'mt-brick' }] });
  K.wall(SU.x0, PU.y1, SU.x0, SU.y1, { t: 24, style: 'mt-brick', section: S });
  K.roof(SU.x0, SU.y0, SU.x1, SU.y1, { kind: 'plain', height: 190, section: S, style: 'mt-sump', dark: 0.9 });
  K.put('floodwater', (SU.x0 + SU.x1) / 2, (SU.y0 + SU.y1) / 2, 0, { x0: SU.x0, y0: SU.y0, x1: SU.x1, y1: SU.y1, h: 14 });
  // the pump room
  K.wall(PU.x0, PU.y0, SU.x0, PU.y0, { t: 24, style: 'mt-brick', section: S });
  K.wall(PU.x0, PU.y1, SU.x0, PU.y1, { t: 24, style: 'mt-brick', section: S });
  K.wall(PU.x0, PU.y0, PU.x0, PU.y1, { t: 24, style: 'mt-brick', section: S });
  K.roof(PU.x0, PU.y0, SU.x0, PU.y1, { kind: 'plain', height: 150, section: S, style: 'mt-pump', dark: 0.85 });
  for (const [x, y] of [[8350, 2300], [8600, 2300]]) B.ob('cabinet', x, y, 120, 90, 0, { style: 'pump', section: S });
  B.ob('cabinet', 8240, 2550, 40, 160, 0, { style: 'pumppanel', section: S });
  B.anchor('pump_room', 8550, 2480, 110);
  // pipes across the chamber, the valve manifold on the south wall
  B.ob('cabinet', 9850, SU.y1 - 50, 220, 60, 0, { style: 'valve', section: S });
  B.anchor('sump_valve', 9850, 2880, 110);
  for (const [x, y] of [[9700, 2350], [10200, 2350], [9700, 2750], [10200, 2750]]) B.ob('ipillar', x, y, 40, 40, 0, { style: 'mt-brickcol', section: S, top: 190 });
  K.put('pipes', (SU.x0 + SU.x1) / 2, SU.y0 + 30, 0, { x0: SU.x0, x1: SU.x1, y: SU.y0 + 30 });
  const L = (x, y, r, c, f = 0, h = 170) => B.light(x, y, r, c, f, h);
  L(9300, 2500, 260, '#ffc27a', 0.5); L(10200, 2600, 220, '#bfe6ff', 0.3); L(8550, 2450, 220, '#ffd8a0', 0.2, 140);
  B.zspawn(10300, 2300, 200, 100, 1, S);
  B.zspawn(9900, 2900, 200, 60, 1, S);
  B.zspawn(8300, 2640, 140, 60, 0.8, S);
  B.checkpoint(S, 10300, 2550);
  B.checkpoint(S, 9300, 2600);
  K.scatter('litter', 10, SU.x0 + 40, SU.y0 + 60, SU.x1 - 40, SU.y1 - 60, [0.8, 1.2], 8);
  K.scatter('leaves', 8, SU.x0 + 40, SU.y0 + 60, SU.x1 - 40, SU.y1 - 60, [0.8, 1.2], 6);
}

// ---------------------------------------------------------------------------------------------
// MAINTENANCE (the works: breaker room, workshop, freight lift) and the exit gate

function buildWorks(B, K) {
  const S = 'maintenance', W = METRO.works, EX = METRO.exitStair;
  // the corridor from the shutter down to the works
  K.wall(9200, 3000, 9200, W.y0, { style: 'mt-service', section: S });
  K.wall(9400, 3000, 9400, W.y0, { style: 'mt-service', section: S });
  K.roof(9208, 3012, 9392, W.y0, { kind: 'plain', height: 120, section: S, style: 'mt-service', dark: 0.9 });
  // the hall
  K.wall(W.x0, W.y0, 9200, W.y0, { t: 24, style: 'mt-works', section: S });
  K.wall(W.x1, W.y0, W.x1, W.y1, { t: 24, style: 'mt-works', section: S });
  K.wall(W.x0, W.y1, W.x1, W.y1, { t: 24, style: 'mt-works', section: S });
  K.wall(W.x0, W.y0, W.x0, EX.y0 - 8, { t: 24, style: 'mt-works', section: S });
  K.wall(W.x0, EX.y1 + 8, W.x0, W.y1, { t: 24, style: 'mt-works', section: S });
  K.roof(W.x0, W.y0, W.x1, W.y1, { kind: 'industrial', height: 210, section: S, style: 'mt-works', dark: 0.8 });
  // the breaker room (south-east corner)
  K.wall(8700, 4200, W.x1, 4200, { style: 'mt-service', section: S, doors: [{ at: 9000, w: 110, kind: 'leaf', style: 'mt-service' }] });
  K.wall(8700, 4200, 8700, W.y1, { style: 'mt-service', section: S });
  K.roof(8700, 4200, W.x1, W.y1, { kind: 'plain', height: 130, section: S, style: 'mt-breaker', dark: 0.9 });
  for (const x of [8800, 8930, 9060, 9190, 9320]) B.ob('cabinet', x, W.y1 - 40, 110, 40, Math.PI, { style: 'switchgear', section: S });
  B.anchor('breaker', 9100, 4420, 110);
  // the workshop: benches, a lathe, a rail cart on a stub of track, racks
  for (const [x, y, a] of [[7600, 3560, 0], [8000, 3560, 0], [8400, 3560, 0]]) B.ob('counter', x, y, 260, 50, a, { style: 'workbench', section: S });
  B.ob('cabinet', 7200, 3900, 120, 60, 0, { style: 'lathe', section: S });
  B.ob('container', 7800, 4350, 280, 110, 0, { style: 'railcart', section: S });
  K.put('rails', 7800, 4350, 0, { x0: 7300, x1: 8500, ys: [4310, 4390] });
  B.ob('cabinet', W.x0 + 40, 4000, 40, 300, 0, { style: 'shelf-parts', section: S });
  B.ob('cabinet', 8300, 4650, 400, 40, 0, { style: 'shelf-parts', section: S });
  B.anchor('workshop', 7800, 4050, 130);
  // the freight lift in the north-west corner
  K.wall(W.x0, 3800, 6900, 3800, { style: 'mt-lift', section: S, doors: [{ at: 6750, w: 180, kind: 'lift', style: 'mt-lift' }] });
  K.wall(6900, W.y0, 6900, 3800, { style: 'mt-lift', section: S });
  K.roof(W.x0, W.y0, 6900, 3800, { kind: 'plain', height: 140, section: S, style: 'mt-liftcar', dark: 0.9 });
  B.anchor('maint_lift', 6750, 3900, 110);
  // a gantry crane over the hall
  K.put('gantry', (W.x0 + W.x1) / 2, 4100, 0, { x0: W.x0, x1: W.x1, y0: W.y0, y1: W.y1, h: 200 });
  // the passage west to the exit stairs and the gate at their foot
  K.wall(EX.x1, EX.y0 - 8, W.x0, EX.y0 - 8, { style: 'mt-service', section: S });
  K.wall(EX.x1, EX.y1 + 8, W.x0, EX.y1 + 8, { style: 'mt-service', section: S });
  K.roof(EX.x1, EX.y0, W.x0, EX.y1, { kind: 'plain', height: 130, section: S, style: 'mt-service', dark: 0.9 });
  K.gateIn('exit_gate', 'gate', EX.x1 + 20, (EX.y0 + EX.y1) / 2, EX.y1 - EX.y0, false, { t: 20, section: 'exit', label: 'Exit gate', frame: 'mt-service', h: 120 });
  const L = (x, y, r, c, f = 0, h = 200) => B.light(x, y, r, c, f, h);
  L(7200, 3700, 320, '#ffc070', 0.3); L(8200, 4000, 320, '#ffc070'); L(7000, 4500, 300, '#ffc070', 0.6); L(9050, 4450, 200, '#e8f0ff', 0.8, 125); L(9300, 3250, 180, '#ffb060', 0.4, 115);
  L(6000, 4310, 200, '#ff4030', 0.3, 125);
  B.zspawn(W.x1 - 100, W.y0 + 100, 120, 100, 1, S);
  B.zspawn(W.x0 + 100, 4600, 120, 80, 1, S);
  B.zspawn(7600, 4620, 200, 60, 0.8, S);
  B.zspawn(6750, 3650, 200, 100, 1, S);
  B.checkpoint(S, 9300, 3300);
  B.checkpoint(S, 8500, 3900);
  B.checkpoint(S, 7000, 4300);
  B.checkpoint(S, 6000, 4310);
  K.scatter('litter', 16, W.x0 + 60, W.y0 + 60, W.x1 - 60, W.y1 - 60, [0.8, 1.2], 8);
  K.scatter('box', 10, W.x0 + 60, W.y0 + 60, W.x1 - 60, W.y1 - 60, [0.9, 1.2], 10);
  K.scatter('oil', 8, W.x0 + 60, W.y0 + 60, W.x1 - 60, W.y1 - 60, [0.9, 1.5], 10);
  K.scatter('blood', 8, W.x0 + 60, W.y0 + 60, W.x1 - 60, W.y1 - 60, [0.8, 1.5], 6);
  K.dress('drums', 9200, 3700, 0.3, 1, 0.3);
  K.dress('pallets', 6800, 4550, 0.1, 1, 0.3);
}

// ---------------------------------------------------------------------------------------------
// EXIT (the stairs up into Harlan Square, 320)

function buildSquare(B, K) {
  const S = 'exit', H = METRO.street, EX = METRO.exitStair, SQ = METRO.square, ST = METRO.statue;
  K.plateau(-3000, 3600, EX.x0, 8000, H);
  K.plateau(EX.x0, 3600, 5400, EX.y0, H);
  K.plateau(EX.x0, EX.y1, 5400, 8000, H);
  K.flightX(EX.x0, EX.x1, EX.y0, EX.y1, 0, H, -1, EX.x0, 80);
  K.guard(EX.x0, EX.y0, EX.x1, EX.y1);
  // the stair's walls, its roof under the east buildings, the canopy at its head
  K.wall(EX.x0, EX.y0 - 8, EX.x1, EX.y0 - 8, { style: 'mt-tile', section: S });
  K.wall(EX.x0, EX.y1 + 8, EX.x1, EX.y1 + 8, { style: 'mt-tile', section: S });
  K.roof(5000, EX.y0, EX.x1, EX.y1, { kind: 'plain', height: 460, section: S, style: 'mt-stair', dark: 0.5 });
  K.put('stairflight', (EX.x0 + EX.x1) / 2, (EX.y0 + EX.y1) / 2, 0, { x0: EX.x0, x1: EX.x1, y0: EX.y0, y1: EX.y1, h0: 0, h1: H, dir: -1 });
  K.put('entrance', EX.x0 - 60, (EX.y0 + EX.y1) / 2, 0, { w: 120, d: EX.y1 - EX.y0 + 60, h: H });
  B.anchor('exit_stairs', 4780, (EX.y0 + EX.y1) / 2, 130);
  // the plaza: paving, the statue, trees, benches, the army's last post
  B.box('concrete', SQ.x0, SQ.y0, SQ.x1, SQ.y1);
  B.box('asphalt', SQ.x0, SQ.y1 - 260, SQ.x1, SQ.y1);
  B.ob('counter', ST.x, ST.y, 120, 120, 0, { style: 'statue', section: S });
  B.anchor('square_statue', ST.x, ST.y - 190, 140);
  for (const [x, y] of [[2300, 4300], [4100, 4300], [2300, 5000], [4100, 5000], [1700, 4650]]) { B.box('grass', x - 70, y - 70, x + 70, y + 70); B.tree(x, y, 1.1); }
  for (const [x, y, a] of [[2800, 4450, 0], [3600, 4450, 0], [2800, 4950, Math.PI], [3600, 4950, Math.PI]]) B.ob('desk', x, y, 140, 30, a, { style: 'mt-bench', section: S });
  B.ob('sandbags', 4300, 4700, 200, 40, 1.2, {});
  B.ob('sandbags', 4150, 4900, 200, 40, 0.3, {});
  B.vehicle('truck', 2400, 5300, 0.1, { wrecked: false });
  B.vehicle('car', 3600, 5300, 3.0, { wrecked: true });
  B.vehicle('car', 1900, 5250, 0.4, { wrecked: true });
  // the buildings round the square (north: the backs of Station Street's blocks; east: over the stairs)
  const blocks = (y, a, xs, depth, seed) => xs.forEach(([x0, x1], i) => B.ob('building', (x0 + x1) / 2, y, x1 - x0, depth, a, { color: ['#8c7a6a', '#9a8a72', '#7a6a5a', '#a09080', '#8a6a5a'][(i + seed) % 5], roof: '#4e4a45', top: 170 + ((i * 29 + seed * 11) % 60), section: S }));
  blocks(3750, 0, [[1000, 1700], [1700, 2400], [2400, 3100], [3100, 3800], [3800, 4400], [4400, 4900]], 300, 3);
  // (a = PI/2: the long side runs along y, the front faces west onto the square; -PI/2 faces east)
  B.ob('building', 5150, (3600 + EX.y0 - 8) / 2, EX.y0 - 8 - 3600, 500, HALF, { color: '#7a7a82', roof: '#4e4a45', top: 220, section: S });
  B.ob('building', 5150, (EX.y1 + 8 + 5600) / 2, 5600 - EX.y1 - 8, 500, HALF, { color: '#8c7a6a', roof: '#4e4a45', top: 200, section: S });
  B.ob('building', 1200, 4750, 1700, 400, -HALF, { color: '#9a8a72', roof: '#4e4a45', top: 190, section: S });
  for (let x = 1600; x < 4800; x += 500) B.lamp(x, 4150, { a: HALF, color: B.lib.LAMP_COLOR, deadChance: 0.4, r: 320 });
  B.light(4700, 4310, 220, '#fff0d8', 0.2, H + 110);
  B.zspawn(1500, 5300, 200, 160, 1, S);
  B.zspawn(4600, 5300, 200, 160, 1, S);
  B.zspawn(1500, 4100, 160, 120, 1, S);
  B.zspawn(4500, 4050, 200, 100, 1, S);
  B.checkpoint(S, 4600, 4310);
  B.checkpoint(S, 3200, 4300);
  B.checkpoint(S, 3200, 5150);
  K.scatter('litter', 30, SQ.x0 + 40, SQ.y0 + 40, SQ.x1 - 40, SQ.y1 - 40, [0.8, 1.2], 8);
  K.scatter('paperf', 20, SQ.x0 + 40, SQ.y0 + 40, SQ.x1 - 40, SQ.y1 - 40, [0.8, 1.3], 6);
  K.scatter('leaves', 24, SQ.x0 + 40, SQ.y0 + 40, SQ.x1 - 40, SQ.y1 - 40, [0.8, 1.5], 6);
  K.scatter('blood', 10, SQ.x0 + 40, SQ.y0 + 40, SQ.x1 - 40, SQ.y1 - 40, [0.8, 1.5], 6);
  K.scatter('shoe', 6, SQ.x0 + 40, SQ.y0 + 40, SQ.x1 - 40, SQ.y1 - 40, [0.9, 1.1], 8);
  for (const [x, y, a] of [[4450, 4200, 0.3], [4450, 4420, 1.2]]) K.dress('barricade', x, y, a, 1, 0.3);
}
