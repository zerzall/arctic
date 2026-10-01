// Saint Mercy Hospital — story level 2.2 (JOURNEY.md). Owner: agent C2.
//
// SPEC is the contract other parts depend on (the mission scripts, the engine, the tests): keep every
// section id (in this order), anchor name and gate id.
//
// The place, in travel order (north is -y):
//
//   PARKING   Mercy Avenue and the big car park north of the hospital. The crew comes in from the
//             street at the north-east corner, under the tower, and fights west past the parked cars,
//             a crashed ambulance and the army's abandoned quarantine checkpoint to the ambulance bay
//             and its canopy at the west end, where the ER doors are.
//   ER        The emergency department: the waiting room, two resus rooms, "the pit" (the central
//             nurses' station ringed by curtained triage bays), the pharmacy cage (the insulin fridge),
//             X-ray, supplies and the staff room.
//   WARDS     Ward C: a racetrack ward. A ring corridor round a core (the nurses' station, the records
//             room with the case files, the medication room, the staff room and the sluice), four-bed
//             bays on the outside, and the generator room (plant) in the south-east corner.
//   SURGERY   The theatre suite: a sterile corridor with two operating theatres to the north, recovery
//             behind them (a loop), the scrub room, sterile supply, equipment and the freight lift.
//   STAIRWELL Stair B, a fire stair of four flights in the tower (real height: the level has terrain),
//             climbing from the surgery floor to the roof, 450 units up.
//   ROOF      The tower roof: the helipad, the plant, the comms mast and the radio. It looks down on
//             the car park the crew fought through.
//
// The hospital's ground floor is one flat podium (x 200..6800, y 1600..4250); the tower (x 6800..8400)
// stands on its east end. The roof and the stair flights are terrain plateaus (shared/terrain.js): the
// sim walks up them for real. Everything the renderer needs beyond obstacles and roofs is listed in
// `map.levelArt` (door frames, windows, free props, the rooftops: render3d/levels/hospital.js) and the
// set dressing is hand placed (`map.dressItems`).

import { createRng, hashString } from '../rng.js';

export const SPEC = Object.freeze({
  "id": "hospital",
  "name": "Saint Mercy Hospital",
  "chapter": 2,
  "time": "night",
  "owner": "C2",
  "description": "The hospital where the outbreak was first treated: the ambulance bay and car park, the emergency department, the wards, surgery, the stairwell and the rooftop helipad.",
  "sections": [
    {
      "id": "parking",
      "name": "Ambulance Bay"
    },
    {
      "id": "er",
      "name": "Emergency"
    },
    {
      "id": "wards",
      "name": "Ward C"
    },
    {
      "id": "surgery",
      "name": "Surgery"
    },
    {
      "id": "stairwell",
      "name": "Stair B"
    },
    {
      "id": "roof",
      "name": "Helipad"
    }
  ],
  "anchors": {
    "parking": [
      "start",
      "ambulance",
      "er_doors"
    ],
    "er": [
      "er_desk",
      "er_triage",
      "er_pharmacy"
    ],
    "wards": [
      "ward_nurses",
      "ward_records",
      "ward_generator"
    ],
    "surgery": [
      "surgery_theatre",
      "surgery_scrub",
      "surgery_lift"
    ],
    "stairwell": [
      "stair_bottom",
      "stair_top"
    ],
    "roof": [
      "roof_door",
      "helipad",
      "roof_radio"
    ]
  },
  "gates": [
    {
      "id": "er_doors",
      "kind": "door",
      "from": "parking",
      "to": "er",
      "label": "ER doors"
    },
    {
      "id": "ward_doors",
      "kind": "door",
      "from": "er",
      "to": "wards",
      "label": "Ward C doors"
    },
    {
      "id": "surgery_doors",
      "kind": "door",
      "from": "wards",
      "to": "surgery",
      "label": "Surgery doors"
    },
    {
      "id": "stair_door",
      "kind": "door",
      "from": "surgery",
      "to": "stairwell",
      "label": "Stair B door"
    },
    {
      "id": "roof_door",
      "kind": "shutter",
      "from": "stairwell",
      "to": "roof",
      "label": "Roof access"
    }
  ]
});

/** World size and mood (maps.js MAP_DEFS). */
export const DEF = { width: 8800, height: 4600, darkness: 0.66, tint: '#34465e', ground: '#3b4436' };

// ---------------------------------------------------------------------------------------------
// The layout kit of C2's interior levels (hospital, mall, metro): walls with doorways, gates that fill
// their doorways, roofs, terrain plateaus and stair flights, windows, free props for the level art and
// the hand placed set dressing. Pure data on top of the map builder (maps.js createBuilder).

const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;
const HALF = Math.PI / 2;

/**
 * The layout kit. Everything it adds for the renderer goes to `map.levelArt` (a list of
 * `{ t, x, y, a, ... }` items that render3d/levels/<id>.js draws) and `map.dressItems` (set dressing in
 * the shared/dress.js item format, which render3d/world-dress.js draws instead of the generic scatter).
 * @param {object} B map builder
 * @param {object} [o] { wall: default wall thickness, door: default door height, style: default wall style }
 */
export function levelKit(B, o = {}) {
  const map = B.map;
  const art = map.levelArt || (map.levelArt = []);
  const dress = [];
  const T = o.wall || 16;
  const DOOR_H = o.door || 78;
  let terrain = null;
  const drng = createRng(hashString(`${map.id}:kitdress:${map.seed}`));

  const K = {
    art,
    T,
    /** A free item for the level art. */
    put(t, x, y, a = 0, extra = {}) {
      const it = { t, x: r1(x), y: r1(y), a: r3(a), ...extra };
      art.push(it);
      return it;
    },

    /**
     * A straight axis-aligned wall from (x0, y0) to (x1, y1) (x0 === x1 or y0 === y1) with doorways.
     * o.doors: [{ at, w, kind, h, style }] (`at` = the doorway's centre along the wall; kind 'open' | 'leaf' |
     * 'double' | 'swing' | 'glass' | 'arch' | 'cage' | 'lift' | 'none'), o.t thickness, o.style (the art's wall
     * finish tag), o.section, o.solid (default true), o.h the wall's own height hint for the art (0 = the
     * rooms decide), o.win windows [{ at, w, h, sill }] along it.
     * Returns the wall pieces.
     */
    wall(x0, y0, x1, y1, w = {}) {
      const horiz = Math.abs(y1 - y0) < 1e-6;
      const t = w.t || T;
      const a0 = horiz ? Math.min(x0, x1) : Math.min(y0, y1);
      const a1 = horiz ? Math.max(x0, x1) : Math.max(y0, y1);
      const c = horiz ? y0 : x0;
      const doors = (w.doors || []).map((d) => ({ ...d, w: d.w || 90 })).sort((p, q) => p.at - q.at);
      const gaps = doors.map((d) => [d.at - d.w / 2, d.at + d.w / 2]);
      const pieces = [];
      const opts = { style: w.style || o.style || 'int', section: w.section, solid: w.solid !== undefined ? w.solid : true };
      if (w.h) opts.top = w.h;
      for (const [p, q] of spans(a0, a1, gaps)) {
        if (q - p < 2) continue;
        const m = (p + q) / 2;
        const ob = horiz ? B.ob('wall', m, c, q - p, t, 0, opts) : B.ob('wall', c, m, t, q - p, 0, opts);
        pieces.push(ob);
      }
      for (const d of doors) {
        if (d.kind === 'none') continue;
        K.put('door', horiz ? d.at : c, horiz ? c : d.at, horiz ? 0 : HALF, { w: d.w, th: t, kind: d.kind || 'open', h: d.h || DOOR_H, style: d.style || w.style || o.style || 'int', sec: w.section, flip: d.flip ? 1 : 0 });
      }
      for (const wi of w.win || []) {
        K.put('window', horiz ? wi.at : c, horiz ? c : wi.at, horiz ? 0 : HALF, { w: wi.w || 80, h: wi.h || 44, sill: wi.sill ?? 34, th: t, style: wi.style || w.style || 'ext', kind: wi.kind || 'glass', sec: w.section });
      }
      return pieces;
    },
    /** Windows every `step` along a wall line, skipping the given [from, to] spans. */
    windowRow(x0, y0, x1, y1, step, spec = {}) {
      const horiz = Math.abs(y1 - y0) < 1e-6;
      const a0 = horiz ? Math.min(x0, x1) : Math.min(y0, y1), a1 = horiz ? Math.max(x0, x1) : Math.max(y0, y1);
      const c = horiz ? y0 : x0;
      const skip = spec.skip || [];
      const n = Math.max(1, Math.floor((a1 - a0) / step));
      const pad = (a1 - a0 - n * step) / 2;
      for (let i = 0; i < n; i++) {
        const at = a0 + pad + (i + 0.5) * step;
        const ww = spec.w || 80;
        if (skip.some(([p, q]) => at + ww / 2 > p && at - ww / 2 < q)) continue;
        K.put('window', horiz ? at : c, horiz ? c : at, horiz ? 0 : HALF, { w: ww, h: spec.h || 44, sill: spec.sill ?? 34, th: spec.t || T, style: spec.style || 'ext', kind: spec.kind || 'glass', sec: spec.section, inside: spec.inside || 0 });
      }
    },

    /**
     * A gate filling a doorway in an axis-aligned wall: `n` leaves (2 = double doors hinged at both ends,
     * mirrored) across the gap centred on (x, y), the gap `w` wide along the wall (`horiz` = the wall runs
     * along x). Adds the door frame for the art. Returns the gate pieces.
     */
    gateIn(id, kind, x, y, w, horiz, g = {}) {
      const t = g.t || T;
      const n = g.leaves || (kind === 'door' && w > 110 ? 2 : 1);
      const pieces = [];
      const a = horiz ? 0 : HALF;
      const opts = { section: g.section, label: g.label || '', style: g.style, top: g.top };
      if (n === 2) {
        const hw = w / 4;
        const ux = horiz ? 1 : 0, uy = horiz ? 0 : 1;
        pieces.push(B.gate(id, kind, x - ux * hw, y - uy * hw, w / 2, t, a, opts));
        pieces.push(B.gate(id, kind, x + ux * hw, y + uy * hw, w / 2, t, a + Math.PI, opts));
      } else {
        pieces.push(B.gate(id, kind, x, y, w, t, a, opts));
      }
      K.put('door', x, y, a, { w, th: t, kind: 'gate', gate: id, gateKind: kind, h: g.h || (kind === 'shutter' ? 110 : DOOR_H + 6), style: g.frame || o.style || 'int', sec: g.section });
      return pieces;
    },

    /** An indoor space (B.roof) given by its corners; the style tells the art what the room is. */
    roof(x0, y0, x1, y1, r = {}) {
      B.roof((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), 0, { kind: r.kind || 'plain', height: r.height, section: r.section, dark: r.dark, style: r.style });
    },

    // ---- terrain: plateaus and stair flights (shared/terrain.js) ------------------------------------
    /** A flat raised floor at height h over the rectangle (sharp edges: walls hide the cliffs). */
    plateau(x0, y0, x1, y1, h) {
      if (!terrain) terrain = map.terrain = { hills: [], plateaus: [] };
      terrain.plateaus.push({ x0: r1(Math.min(x0, x1)), y0: r1(Math.min(y0, y1)), x1: r1(Math.max(x0, x1)), y1: r1(Math.max(y0, y1)), h: r3(h), edge: 0 });
    },
    /**
     * Ground-mesh guide lines 1 unit outside a raised block: a zero-height plateau, so the ground mesh
     * climbs the cliff right at the block's edge (inside the wall that stands there).
     */
    guard(x0, y0, x1, y1) {
      if (!terrain) terrain = map.terrain = { hills: [], plateaus: [] };
      terrain.plateaus.push({ x0: r1(x0 - 1), y0: r1(y0 - 1), x1: r1(x1 + 1), y1: r1(y1 + 1), h: 0, edge: 0 });
    },
    /**
     * A stair flight rising from h0 to h1 along x (dir +1 = rising toward +x) between xa and xb, across
     * y0..y1, as `n` micro steps (the camera climbs a smooth slope). `landing` extends the top step's
     * plateau past the flight to `to` (the upper landing).
     */
    flightX(xa, xb, y0, y1, h0, h1, dir, to, n = 60) {
      const run = (xb - xa) / n, dh = (h1 - h0) / n;
      for (let j = 1; j <= n; j++) {
        const h = h0 + j * dh;
        if (dir > 0) K.plateau(xa + j * run, y0, to, y1, h);
        else K.plateau(to, y0, xb - j * run, y1, h);
      }
    },

    /** The same along y (dir +1 = rising toward +y), across x0..x1; the top step's plateau reaches `to`. */
    flightY(ya, yb, x0, x1, h0, h1, dir, to, n = 60) {
      const run = (yb - ya) / n, dh = (h1 - h0) / n;
      for (let j = 1; j <= n; j++) {
        const h = h0 + j * dh;
        if (dir > 0) K.plateau(x0, ya + j * run, x1, to, h);
        else K.plateau(x0, to, x1, yb - j * run, h);
      }
    },

    // ---- set dressing (shared/dress.js kinds, drawn by world-dress.js) ---------------------------------
    /** One hand placed dress item. `q` ranks it (low = kept on the low tiers). */
    dress(k, x, y, a = 0, s = 1, q = null) {
      dress.push({ k, x: r1(x), y: r1(y), a: r3(a), s: r3(s), v: (drng.next() * 65536) | 0, q: q === null ? r3(drng.next()) : q });
    },
    /** Scatter `n` of kind k in a rect (clear of obstacles, given pad). */
    scatter(k, n, x0, y0, x1, y1, s = [0.8, 1.2], pad = 10, qmul = 1) {
      for (let i = 0; i < n; i++) {
        for (let tr = 0; tr < 8; tr++) {
          const x = drng.range(x0, x1), y = drng.range(y0, y1);
          if (B.blockedAt(x, y, pad)) continue;
          K.dress(k, x, y, drng.range(0, Math.PI * 2), drng.range(s[0], s[1]), r3(drng.next() * qmul));
          break;
        }
      }
    },
    get drng() { return drng; },
    /** Finish: store the dressing (hand placed list replaces the generic road scatter). */
    finish() {
      map.dressItems = dress;
    },
  };
  return K;
}

/** Spans of [a0, a1] left between the sorted gaps. */
function spans(a0, a1, gaps) {
  const out = [];
  let cur = a0;
  for (const [g0, g1] of gaps) {
    if (g0 > cur) out.push([cur, Math.min(g0, a1)]);
    cur = Math.max(cur, g1);
  }
  if (cur < a1) out.push([cur, a1]);
  return out;
}

// ---------------------------------------------------------------------------------------------
// The layout

/** Key heights (world units): the ground floor, the stair landings and the roof. */
export const HOSPITAL = Object.freeze({
  ceil: 120, podiumTop: 300, towerTop: 450, parapet: 44,
  podium: { x0: 200, y0: 1600, x1: 6800, y1: 4250 },
  tower: { x0: 6800, y0: 1600, x1: 8400, y1: 4250 },
  stair: { x0: 6800, y0: 3450, x1: 7316, y1: 4250 },
});

/**
 * Lay the level out.
 * @param {object} B map builder (maps.js createBuilder) with the level calls of JOURNEY.md §3
 */
export function build(B) {
  const K = levelKit(B, { wall: 16, door: 78, style: 'hosp' });
  // a clear, cold night over the city: the fog thins so the skyline shows from the roof; less sky light
  // indoors (the lamps light the rooms)
  B.map.look = { night: { fogDensity: 0.00082, horizon: '#2a2a2e', fog: '#0f1116', hemi: 0.72, moonI: 0.42 } };
  const { rng } = B;
  const EXT = 24;          // exterior walls
  const P = HOSPITAL.podium;
  const CEIL = HOSPITAL.ceil;

  // ============================================================================================
  // Sections (travel order)
  B.section('parking', 'Ambulance Bay', 4400, 800, 8800, 1600);
  B.section('er', 'Emergency', 1400, 2925, 2400, 2650);
  B.section('wards', 'Ward C', 3700, 2925, 2200, 2650);
  B.section('surgery', 'Surgery', 5800, 2925, 2000, 2650);
  B.section('stairwell', 'Stair B', 7058, 3850, 516, 800);
  B.section('roof', 'Helipad', 7600, 2525, 1600, 1850);

  // ============================================================================================
  // PARKING: Mercy Avenue (the street, y 60..330) and the car park (y 330..1590)
  buildParking(B, K);

  // ============================================================================================
  // The podium's shell: north façade (windows onto the car park), west and south façades
  const sec = (x) => (x < 2600 ? 'er' : x < 4800 ? 'wards' : 'surgery');
  // north façade, the ER doors in it (gate) and the main entrance (barricaded shut: a wall)
  K.wall(P.x0, P.y0, 1520, P.y0, { t: EXT, style: 'hosp-ext', section: 'er' });
  K.gateIn('er_doors', 'door', 1610, P.y0, 180, true, { t: EXT, section: 'er', label: 'ER doors', frame: 'hosp-ext', h: 92 });
  K.wall(1700, P.y0, P.x1, P.y0, { t: EXT, style: 'hosp-ext', section: 'wards' });
  K.wall(P.x0, P.y0, P.x0, P.y1, { t: EXT, style: 'hosp-ext', section: 'er' });
  K.wall(P.x0, P.y1, P.x1, P.y1, { t: EXT, style: 'hosp-ext', section: 'wards' });
  // windows: ground floor rooms along the north and south façades
  K.windowRow(P.x0, P.y0, 1480, P.y0, 150, { t: EXT, w: 96, h: 50, sill: 30, section: 'er' });
  K.windowRow(1760, P.y0, 2588, P.y0, 150, { t: EXT, w: 96, h: 50, sill: 30, section: 'er' });
  for (const [x0, x1, s] of [[2612, 3156, 'wards'], [3156, 3700, 'wards'], [3700, 4244, 'wards'], [4244, 4788, 'wards'], [4812, 6788, 'surgery']]) {
    K.windowRow(x0, P.y0, x1, P.y0, 136, { t: EXT, w: 84, h: 50, sill: 30, section: s });
  }
  for (const [x0, x1, s] of [[P.x0, 900, 'er'], [2612, 3300, 'wards'], [3300, 4044, 'wards']]) {
    K.windowRow(x0, P.y1, x1, P.y1, 150, { t: EXT, w: 84, h: 46, sill: 34, section: s });
  }
  K.windowRow(P.x0, 1612, P.x0, 2330, 170, { t: EXT, w: 96, h: 50, sill: 30, section: 'er' });
  // hard floors under the whole building (no grass, no weeds indoors), the service road behind it
  B.box('concrete', P.x0, P.y0, HOSPITAL.tower.x1, P.y1);
  B.box('asphalt', 0, P.y1 + 16, 8800, 4600);
  B.line('white', 0, 4420, 8800, 4420, 3);
  // the rooftop of the podium (two storeys: the first floor is the building's mass)
  K.put('rooftop', (P.x0 + P.x1) / 2, (P.y0 + P.y1) / 2, 0, { w: P.x1 - P.x0, d: P.y1 - P.y0, h: HOSPITAL.podiumTop, style: 'hosp' });
  void sec;

  buildER(B, K, CEIL);
  buildWards(B, K, CEIL);
  buildSurgery(B, K, CEIL);
  buildTower(B, K);

  // ============================================================================================
  // the party starts on Mercy Avenue at the north-east corner, under the tower
  const sx = 7650, sy = 230;
  B.anchor('start', sx, sy, 180);
  for (let k = 0; k < 6; k++) B.pspawn(sx - 120 + (k % 3) * 90, sy - 50 + Math.floor(k / 3) * 100);
  B.supply(sx + 220, sy + 40);
  K.finish();
  void rng;
}

// ---------------------------------------------------------------------------------------------
// PARKING

function buildParking(B, K) {
  const { rng, drng } = B;
  // ground: the avenue, the sidewalk, the car park asphalt, the drop-off concrete by the canopy
  B.box('concrete', 0, 0, 8800, 64);                   // the far sidewalk
  B.box('asphalt', 0, 64, 8800, 320);                  // Mercy Avenue
  B.box('concrete', 0, 320, 8800, 390);                // north sidewalk strip of the car park
  B.box('asphalt', 60, 390, 8740, 1560);               // the car park
  B.box('concrete', 400, 1110, 2700, 1590);            // ambulance bay apron
  B.box('concrete', 6560, 1380, 8740, 1590);           // the tower's forecourt
  B.box('grass', 2900, 1400, 6400, 1590);              // the lawn strip along the podium
  B.line('yellow_double', 0, 190, 8800, 190, 3);
  B.line('white', 0, 80, 8800, 80, 3);
  B.line('white', 0, 300, 8800, 300, 3);
  // parking bays: two double rows of stalls either side of the main aisle (y 820..1000)
  for (let x = 2900; x <= 6300; x += 58) {
    B.line('parking', x, 420, x, 560, 3);
    B.line('parking', x, 660, x, 800, 3);
    B.line('parking', x, 1020, x, 1160, 3);
    B.line('parking', x, 1260, x, 1390, 3);
  }
  for (let x = 700; x <= 2500; x += 58) { B.line('parking', x, 420, x, 560, 3); B.line('parking', x, 660, x, 800, 3); }
  // the ambulance bay: bays painted yellow, a hatched no-parking box at the doors
  for (const x of [700, 900, 1100, 2100, 2300]) B.line('yellow', x, 1180, x, 1440, 4);
  B.line('yellow', 1400, 1470, 1820, 1470, 4);

  // the fence and hedge between the avenue and the car park (openings: the entrance at the east, a
  // pedestrian gap at the west, and one where a truck smashed through)
  const fenceY = 350;
  for (const [x0, x1] of [[60, 900], [1100, 3400], [3700, 6800], [7160, 8740]]) {
    B.run('wall', x0, fenceY, x1, fenceY, 6, { color: '#6f7479', maxLen: 360 });
  }
  for (let x = 120; x < 8700; x += 150) {
    if ((x > 880 && x < 1120) || (x > 3380 && x < 3720) || (x > 6780 && x < 7180)) continue;
    B.decor('bush', x + drng.range(-20, 20), fenceY + 26, drng.range(0, 6.28), drng.range(0.7, 1.1));
  }
  // the entrance: gate posts and a barrier arm (knocked off), the hospital sign
  K.put('monument', 7250, 440, 0, { w: 260, text: 'hs_sign' });
  K.put('barrierarm', 6980, 370, 0, { w: 160 });
  // street lamps along the avenue and the car park aisles (sodium), some dead
  for (let x = 300; x < 8700; x += 620) B.lamp(x, 330, { a: -HALF, color: B.lib.SODIUM_COLOR, deadChance: 0.3, r: 300 });
  for (const x of [1200, 2200, 3200, 4200, 5200, 6200]) {
    B.lamp(x + 15, 610, { a: HALF, color: B.lib.SODIUM_COLOR, deadChance: 0.25, r: 360 });
    if (x > 2500) B.lamp(x - 15, 1210, { a: -HALF, color: B.lib.SODIUM_COLOR, deadChance: 0.3, r: 340 });
  }
  B.lamp(7900, 1260, { a: 0, color: B.lib.LAMP_COLOR, dead: false, r: 300 });
  B.lamp(3000, 1480, { a: -HALF, color: B.lib.LAMP_COLOR, dead: true });
  B.lamp(4800, 1480, { a: -HALF, color: B.lib.LAMP_COLOR, dead: false, r: 260 });

  // parked cars in the stalls (a few gone, a few askew), wrecks in the aisle
  const stall = (x, y, down) => {
    if (drng.chance(0.28)) return;
    const kind = rng.pick(['car', 'car', 'car', 'suv', 'suv', 'pickup', 'van']);
    const a = (down ? HALF : -HALF) + rng.range(-0.08, 0.08);
    B.vehicle(kind, x, y, a, { wrecked: drng.chance(0.22) });
  };
  for (let x = 2929; x <= 6250; x += 58 * 2) {
    stall(x + 29 * (rng.next() < 0.5 ? 0 : 1), 490, true);
    stall(x + 29, 730, false);
    if (x < 5900) stall(x + 29, 1090, true);
    if (x > 3200 && x < 5900) stall(x + 29 * (rng.next() < 0.5 ? 0 : 1), 1325, false);
  }
  for (let x = 729; x <= 2450; x += 58 * 2) { stall(x, 490, true); stall(x + 29, 730, false); }
  // wrecks: a car nosed into another, a pickup across the aisle, a burning sedan
  B.vehicle('suv', 5520, 905, 0.35, { wrecked: true });
  B.vehicle('car', 4380, 930, -2.6, { wrecked: true, burning: true });
  B.vehicle('pickup', 2650, 880, 1.2, { wrecked: true });
  B.vehicle('car', 1650, 960, 2.9, { wrecked: true });
  // a truck that came through the fence off the avenue
  B.vehicle('truck', 3550, 420, -1.25, { wrecked: true, color: '#4b5320' });

  // the army's quarantine checkpoint across the aisle (x 3800..4700): HESCO, sandbags, tents,
  // jersey barriers leaving a chicane, floodlights, a dead generator
  for (const [x, y, w, h] of [[3860, 640, 70, 70], [3860, 720, 70, 70], [3860, 1180, 70, 70], [3860, 1260, 70, 70]]) B.ob('hesco', x, y, w, h, 0, { color: '#a08a62' });
  B.ob('barrier', 3960, 830, 90, 22, HALF + 0.2);
  B.ob('barrier', 3980, 1070, 90, 22, HALF - 0.15);
  B.ob('sandbags', 4080, 960, 120, 28, HALF, { color: '#8a7a55' });
  B.ob('tent', 4420, 1240, 180, 120, 0.05, { color: '#56603f', roof: '#66704a', style: 'medtent', prop: 'medtent' });
  B.ob('tent', 4620, 600, 160, 110, -0.08, { color: '#56603f', roof: '#66704a', style: 'medtent', prop: 'medtent' });
  B.ob('container', 4760, 1250, 70, 56, 0.1, { style: 'armygen', color: '#4b5320' });
  K.put('floodtower', 4280, 780, 0.5, { h: 190 });
  K.put('floodtower', 4280, 1120, -0.5, { h: 190 });
  B.light(4300, 800, 420, B.lib.FLOOD_COLOR, 0.15, 190);
  B.light(4290, 1110, 380, B.lib.FLOOD_COLOR, 0.35, 190);
  K.put('signboard', 3790, 970, Math.PI, { text: 'hs_quarantine', w: 90, h: 60 });
  // fences of the checkpoint (chain link, thin: vault-able at the torn places)
  B.run('wall', 3860, 400, 3860, 600, 6, { color: '#7a7f84' });
  B.run('wall', 3860, 1300, 3860, 1390, 6, { color: '#7a7f84' });

  // the ambulance bay: three ambulances (one crashed into a pillar), the canopy over the ER doors
  B.ob('van', 800, 1310, 124, 54, -HALF + 0.03, { style: 'ambulance', color: '#e8e6df' });
  B.ob('van', 1000, 1300, 124, 54, -HALF - 0.06, { style: 'ambulance', color: '#e8e6df' });
  B.ob('van', 1230, 1210, 124, 54, -HALF + 0.55, { style: 'ambulance', color: '#e8e6df', label: 'crashed' });
  B.ob('van', 2200, 1320, 124, 54, -HALF, { style: 'ambulance', color: '#e8e6df' });
  B.anchor('ambulance', 1330, 1310, 150);
  // canopy columns (the canopy itself is drawn by the art)
  for (const x of [1300, 1920]) for (const y of [1180]) B.ob('pillar', x, y, 26, 26, 0, { style: 'hosp-col', color: '#d8d4ca' });
  K.put('canopy', 1610, 1390, 0, { w: 760, d: 420, h: 128 });
  B.light(1500, 1420, 300, '#dfe8ff', 0, 124);
  B.light(1760, 1330, 300, '#dfe8ff', 0.35, 124);
  B.light(1610, 1530, 200, '#ff3a30', 0.1, 150);                  // the red EMERGENCY sign's glow
  B.anchor('er_doors', 1610, 1470, 160);
  // gurneys and a triage tent by the bay (dress), a burning bin
  B.fire(2480, 1480, 14);

  // the yards west of the podium and east of the tower are fenced off (service gates, chained)
  B.ob('wall', 100, 1600, 200, 24, 0, { style: 'yardgate', section: 'parking' });
  B.ob('wall', 8600, 1600, 400, 24, 0, { style: 'yardgate', section: 'parking' });
  // the tower's forecourt: planters, benches, the main entrance's revolving door (boarded: a wall)
  for (const x of [6700, 7300, 7900, 8500]) B.ob('counter', x, 1470, 64, 64, 0, { style: 'planter' });
  K.put('bench', 7600, 1530, Math.PI, {});
  K.put('bench', 8150, 1530, Math.PI, {});
  // trees on the lawn strip and along the avenue sidewalk
  for (const x of [3100, 3700, 4300, 4900, 5500, 6100]) B.tree(x, 1500, drng.range(0.8, 1.1));

  // zombie spawns: the avenue's ends, the hedge gaps, among the tents, the west alley, the tower foot
  B.zspawn(120, 190, 120, 180, 1, 'parking');
  B.zspawn(8680, 190, 100, 180, 0.6, 'parking');
  B.zspawn(3500, 190, 240, 140, 1, 'parking');
  B.zspawn(5600, 190, 280, 140, 1, 'parking');
  B.zspawn(2100, 190, 280, 140, 1, 'parking');
  B.zspawn(4520, 1430, 160, 90, 1.2, 'parking');
  B.zspawn(300, 900, 140, 300, 1.2, 'parking');
  B.zspawn(2600, 1480, 160, 80, 1, 'parking');
  B.zspawn(6250, 1250, 160, 100, 0.8, 'parking');
  B.checkpoint('parking', 7400, 250);
  B.checkpoint('parking', 5000, 900);
  B.checkpoint('parking', 3300, 950);
  B.checkpoint('parking', 1900, 1000);

  // dressing: litter, bags, shoes across the lot; body bags and gurneys by the triage tents; blood
  // trails to the ER doors; glass under the wrecks; puddles (it rained)
  K.scatter('puddle', 26, 200, 420, 8600, 1560, [0.9, 2.4], 6, 0.9);
  K.scatter('leaves', 22, 2800, 1300, 6500, 1560, [0.8, 1.6], 6);
  K.scatter('litter', 40, 200, 400, 8600, 1560, [0.8, 1.2], 8);
  K.scatter('paperf', 26, 200, 400, 8600, 1560, [0.8, 1.3], 6);
  K.scatter('bag', 16, 200, 400, 8600, 1560, [0.8, 1.2], 8);
  K.scatter('shoe', 10, 400, 400, 8000, 1560, [0.9, 1.1], 8);
  K.scatter('glassf', 16, 2000, 400, 6200, 1400, [0.9, 1.6], 4);
  K.scatter('blood', 10, 700, 1150, 2400, 1560, [0.8, 1.4], 6);
  K.scatter('newsp', 10, 200, 80, 8600, 320, [0.9, 1.1], 6);
  for (const [x, y, a] of [[4300, 1360, 0.2], [4360, 1390, 0.1], [4460, 1400, -0.1], [4700, 1100, 1.2], [4730, 740, 0.4], [4530, 700, 1.4]]) K.dress('bodybag', x, y, a, 1, 0.3);
  for (const [x, y, a] of [[4200, 1300, 0.6], [4650, 800, 2.2], [1450, 1250, 1.3], [2000, 1200, -0.4], [1780, 1480, 0.2]]) K.dress('gurney', x, y, a, 1, 0.25);
  K.dress('wheelchair', 1550, 1300, 2.2, 1, 0.3);
  K.dress('wheelchair', 2380, 1250, -0.8, 1, 0.5);
  for (const [x, y, a] of [[4150, 880, 0.3], [4180, 1040, -0.2], [4580, 1000, 1.9], [4000, 1180, 0.5]]) K.dress('milcrate', x, y, a, 1, 0.5);
  for (const [x, y] of [[4230, 950], [4110, 1120], [4520, 880]]) K.dress('helmet', x, y, drng.range(0, 6), 1, 0.6);
  K.dress('tape', 3870, 820, HALF, 1, 0.4);
  K.dress('medtent', 500, 700, 0.1, 1, 0.2);
  for (const [x, y, a] of [[5600, 1470, 0], [6300, 1500, 0.3], [3300, 1180, 1.4]]) K.dress('barricade', x, y, a, 1, 0.5);
  for (const [x, y] of [[3600, 900], [5000, 1000], [6600, 880], [2300, 1000]]) K.dress('cone_up', x, y, 0, 1, 0.6);
  K.dress('suitcase', 6650, 700, 0.4, 1, 0.5);
  K.dress('stroller', 3150, 980, 1.1, 1, 0.7);
  K.dress('teddy', 3170, 1010, 0.3, 1, 0.7);
  K.dress('busstop', 5900, 90, 0, 1, 0.2);
  K.dress('newsbox', 6050, 300, Math.PI, 1, 0.6);
  K.dress('hydrant', 2750, 335, 0, 1, 0.6);
  K.dress('bin', 7100, 300, 0, 1, 0.5);
  K.dress('bin_fall', 4600, 330, 1.0, 1, 0.6);
  K.dress('atm', 8600, 1450, Math.PI, 1, 0.6);
  K.dress('vend', 8380, 1440, Math.PI, 1, 0.5);
  // the blood trail from the crashed ambulance to the ER doors
  for (let i = 0; i < 9; i++) K.dress('blood', 1300 + i * 36, 1330 + i * 16, 0.3 + i * 0.1, 0.7 + (i % 3) * 0.2, 0.15);
}

// ---------------------------------------------------------------------------------------------
// ER (x 212..2588)

function buildER(B, K, CEIL) {
  const S = 'er';
  const R = (x0, y0, x1, y1, style, o = {}) => K.roof(x0, y0, x1, y1, { kind: 'hospital', height: o.h || CEIL, section: S, style, dark: o.dark ?? 0.8 });
  // the waiting room (x 212..1980, y 1612..2330), resus rooms 1 and 2 (x 1980..2588)
  K.wall(212, 2330, 2588, 2330, { section: S, style: 'hosp', doors: [{ at: 970, w: 180, kind: 'swing' }, { at: 2130, w: 100, kind: 'leaf' }, { at: 2440, w: 100, kind: 'leaf' }] });
  K.wall(1980, 1612, 1980, 2330, { section: S, style: 'hosp' });
  K.wall(2290, 1612, 2290, 2330, { section: S, style: 'hosp' });
  R(212, 1612, 1980, 2330, 'hs-wait');
  R(1980, 1612, 2290, 2330, 'hs-resus');
  R(2290, 1612, 2588, 2330, 'hs-resus');
  // the ER / ward C wall with ward_doors
  K.wall(2600, 1612, 2600, 2920, { section: S, style: 'hosp' });
  K.gateIn('ward_doors', 'door', 2600, 3000, 160, false, { section: 'wards', label: 'Ward C doors', frame: 'hosp' });
  K.wall(2600, 3080, 2600, 4238, { section: S, style: 'hosp' });
  // the pit (x 212..2588, y 2330..3700); the south row of rooms behind y 3700
  K.wall(212, 3700, 2588, 3700, { section: S, style: 'hosp', doors: [{ at: 740, w: 90, kind: 'cage' }, { at: 1200, w: 100, kind: 'leaf' }, { at: 1740, w: 100, kind: 'leaf', flip: true }, { at: 2340, w: 100, kind: 'leaf' }] });
  for (const x of [900, 1500, 2100]) K.wall(x, 3708, x, 4238, { section: S, style: 'hosp' });
  R(212, 2330, 2588, 3700, 'hs-pit', { dark: 0.82 });
  R(212, 3700, 900, 4238, 'hs-pharm');
  R(900, 3700, 1500, 4238, 'hs-xray');
  R(1500, 3700, 2100, 4238, 'hs-staff');
  R(2100, 3700, 2588, 4238, 'hs-store');
  // (the cage front of the pharmacy is drawn as steel mesh over the wall above; its door is open)

  // ---- the waiting room: seat rows facing the TV wall, vending machines, the triage desk
  for (const [x, y] of [[520, 1860], [520, 2020], [880, 1860], [880, 2020], [1240, 1860], [1240, 2020]]) {
    B.ob('desk', x, y, 190, 26, 0, { style: 'seats', section: S });
  }
  B.ob('desk', 1700, 1760, 150, 26, HALF, { style: 'seats', section: S });
  for (const [x, y] of [[700, 1680], [1300, 1680]]) B.ob('ipillar', x, y + 260, 34, 34, 0, { style: 'hosp-col', section: S, top: CEIL });
  B.ob('cabinet', 240, 1760, 36, 60, 0, { style: 'vend', section: S });
  B.ob('cabinet', 240, 1840, 36, 60, 0, { style: 'vend2', section: S });
  B.ob('counter', 1560, 2250, 300, 44, 0, { style: 'triage-desk', section: S });
  K.put('tvwall', 880, 2322, Math.PI, { w: 90 });
  K.put('noticeboard', 212, 2100, -HALF, { w: 90, h: 60 });
  K.put('sign', 970, 2322, 0, { cell: 'hs_treatment', w: 110, h: 22, hy: 96, face: -1 });
  K.put('sign', 1610, 1612, Math.PI, { cell: 'hs_emergency_in', w: 130, h: 24, hy: 104, face: -1 });
  K.put('kidscorner', 380, 2220, 0, {});
  // resus rooms: trolleys, overhead lamps, crash carts
  B.ob('desk', 2135, 1950, 76, 36, HALF, { style: 'gurney-bed', section: S });
  B.ob('desk', 2440, 1950, 76, 36, HALF, { style: 'gurney-bed', section: S });
  K.put('ceilinglamp', 2135, 1950, 0, { h: CEIL });
  K.put('ceilinglamp', 2440, 1950, 0, { h: CEIL });
  K.put('crashcart', 2040, 1720, 0.2, {});
  K.put('crashcart', 2530, 2150, 2.8, {});
  K.put('monitor', 2230, 1880, Math.PI, {});
  K.put('monitor', 2350, 1880, 0, {});

  // ---- the pit: the nurses' station, curtained bays along the west and the south
  B.ob('counter', 1400, 2950, 440, 60, 0, { style: 'nstation', section: S });
  B.ob('counter', 1400, 3080, 440, 60, 0, { style: 'nstation-back', section: S });
  B.ob('counter', 1205, 3015, 50, 70, 0, { style: 'nstation-end', section: S });
  B.anchor('er_desk', 1400, 2830, 150);
  // west bays (x 212..600): five curtained cubicles with trolley beds
  for (let i = 0; i < 5; i++) {
    const y = 2440 + i * 240;
    B.ob('desk', 330, y + 110, 76, 36, 0, { style: 'gurney-bed', section: S });
    K.put('bay', 406, y + 110, 0, { w: 388, d: 230, open: 'e', i });
  }
  // south bays (x 700..2100, y 3350..3690)
  for (let i = 0; i < 5; i++) {
    const x = 760 + i * 270;
    B.ob('desk', x + 130, 3610, 76, 36, HALF, { style: 'gurney-bed', section: S });
    K.put('bay', x + 130, 3527, -HALF, { w: 330, d: 260, open: 'n', i: i + 5 });
  }
  B.anchor('er_triage', 1300, 3230, 150);
  // pillars in the pit
  for (const [x, y] of [[800, 2700], [2000, 2700], [800, 3200], [2000, 3200]]) B.ob('ipillar', x, y, 34, 34, 0, { style: 'hosp-col', section: S, top: CEIL });
  // quarantine plastic hung across the east of the pit, a barricade of gurneys by the ward doors
  K.put('plastic', 2300, 2600, HALF, { w: 260, h: CEIL });
  K.put('plastic', 2420, 3420, 0, { w: 220, h: CEIL });
  B.ob('desk', 2440, 2800, 76, 36, 0.4, { style: 'gurney', section: S });
  B.ob('desk', 2470, 3200, 76, 36, -0.5, { style: 'gurney', section: S });
  // the floor of the pit: trolleys abandoned where the triage broke down, a crash cart, a monitor
  B.ob('desk', 960, 2560, 76, 36, 0.8, { style: 'gurney', section: S });
  B.ob('desk', 1820, 2520, 76, 36, -0.35, { style: 'gurney-bed', section: S });
  B.ob('desk', 1760, 3260, 76, 36, 1.9, { style: 'gurney', section: S });
  K.put('crashcart', 1080, 2650, 1.1, {});
  K.put('monitor', 1880, 2610, 2.4, {});

  // ---- pharmacy cage (x 212..900, y 3700..4238): shelves, the insulin fridge
  B.ob('cabinet', 440, 4210, 360, 36, 0, { style: 'shelf-meds', section: S });
  B.ob('cabinet', 240, 3960, 36, 300, 0, { style: 'shelf-meds', section: S });
  B.ob('cabinet', 520, 3900, 200, 30, 0, { style: 'shelf-meds', section: S });
  B.ob('cabinet', 860, 4040, 40, 60, 0, { style: 'medfridge', section: S });
  B.anchor('er_pharmacy', 760, 4060, 110);
  // X-ray: the machine and its table; staff room: sofa, table, lockers; store: shelves, linen cages
  B.ob('desk', 1200, 4000, 110, 40, 0, { style: 'xray-table', section: S });
  K.put('xray-arm', 1200, 3930, 0, {});
  B.ob('cabinet', 1528, 3960, 30, 200, 0, { style: 'lockers', section: S });
  B.ob('desk', 1800, 4050, 110, 50, 0, { style: 'sofa', section: S });
  B.ob('desk', 1800, 3900, 80, 50, 0, { style: 'table', section: S });
  B.ob('cabinet', 2340, 4210, 400, 34, 0, { style: 'shelf-supply', section: S });
  B.ob('cabinet', 2560, 3950, 34, 260, 0, { style: 'shelf-supply', section: S });

  // ---- lights: cold tubes, a flickering one in the pit, red emergency over the doors
  const L = (x, y, r, c = '#e4ecff', f = 0, h = CEIL - 4) => B.light(x, y, r, c, f, h);
  L(620, 1850, 330); L(1300, 1850, 330, '#e4ecff', 0.4); L(1600, 2150, 260);
  L(2135, 1950, 260, '#f4f8ff'); L(2440, 1950, 240, '#f4f8ff', 0.6);
  L(1400, 2600, 340); L(1400, 3300, 320, '#e4ecff', 0.5); L(500, 2800, 300); L(2150, 3000, 300);
  L(700, 3450, 260, '#ff4030', 0.3, CEIL - 10);
  L(560, 3960, 220, '#cfe6ff', 0.7); L(1200, 3960, 200, '#e4ecff', 0.2); L(1800, 3960, 220, '#ffe0b0'); L(2340, 3960, 180, '#e4ecff', 0.8);
  L(2560, 3000, 180, '#ff3a2a', 0.25, CEIL - 20);

  // ---- spawns: the side rooms and the resus rooms (their doors open onto the pit)
  B.zspawn(1200, 4130, 160, 120, 1, S);
  B.zspawn(1800, 4150, 200, 90, 1, S);
  B.zspawn(2340, 4000, 160, 200, 1.2, S);
  B.zspawn(2135, 1700, 160, 100, 0.8, S);
  B.zspawn(2440, 2180, 160, 100, 0.8, S);
  B.zspawn(400, 1700, 120, 90, 0.6, S);
  B.checkpoint(S, 1610, 1720);
  B.checkpoint(S, 1000, 2600);
  B.checkpoint(S, 2250, 2950);

  // ---- dressing
  K.scatter('paperf', 26, 240, 1640, 2560, 3680, [0.8, 1.3], 6);
  K.scatter('blood', 18, 240, 1640, 2560, 3680, [0.8, 1.6], 6);
  K.scatter('litter', 16, 240, 1640, 1960, 2320, [0.8, 1.1], 6);
  K.scatter('glassf', 8, 1500, 1640, 1900, 1800, [0.9, 1.4], 4);
  K.scatter('clothes', 6, 240, 2360, 2560, 3680, [0.8, 1.1], 8);
  for (const [x, y, a] of [[1100, 2600, 0.4], [1700, 2500, 2.1], [600, 3250, 1.2], [2250, 3500, 0.2]]) K.dress('wheelchair', x, y, a, 1, 0.35);
  for (const [x, y, a] of [[1250, 2450, 1.9], [2000, 2450, 0.3]]) K.dress('gurney', x, y, a, 1, 0.3);
  K.dress('bodybag', 1650, 3250, 0.3, 1, 0.3);
  K.dress('bodybag', 1720, 3300, 0.1, 1, 0.45);
  K.dress('backpack', 900, 1950, 1.2, 1, 0.6);
  K.dress('suitcase', 1300, 2150, 0.1, 1, 0.6);
  K.dress('teddy', 420, 2180, 0.8, 1, 0.5);
  for (let i = 0; i < 10; i++) K.dress('blood', 1610 + Math.sin(i * 0.7) * 30, 1660 + i * 60, 1.57 + Math.sin(i) * 0.3, 0.6 + (i % 3) * 0.2, 0.12);
}

// ---------------------------------------------------------------------------------------------
// WARD C (x 2612..4788): a ring corridor round a core

function buildWards(B, K, CEIL) {
  const S = 'wards';
  const R = (x0, y0, x1, y1, style, o = {}) => K.roof(x0, y0, x1, y1, { kind: 'hospital', height: o.h || CEIL, section: S, style, dark: o.dark ?? 0.8 });
  // north bays (y 1612..2250): four four-bed bays, windows onto the car park
  const bx = [2612, 3156, 3700, 4244, 4788];
  K.wall(2612, 2250, 4788, 2250, { section: S, style: 'hosp', doors: [0, 1, 2, 3].map((i) => ({ at: (bx[i] + bx[i + 1]) / 2, w: 120, kind: 'double' })) });
  for (const x of [3156, 3700, 4244]) K.wall(x, 1612, x, 2242, { section: S, style: 'hosp' });
  for (let i = 0; i < 4; i++) {
    R(bx[i] + (i ? 8 : 0), 1612, bx[i + 1] - (i < 3 ? 8 : 12), 2250, 'hs-bay');
    const cx = (bx[i] + bx[i + 1]) / 2;
    for (const [dx, dy, a] of [[-150, 1668, HALF], [150, 1668, HALF], [-150, 2190, -HALF], [150, 2190, -HALF]]) {
      if (i === 2 && dx > 0 && dy > 2000) continue;          // an empty bed space: the bed was dragged out
      B.ob('desk', cx + dx, dy, 78, 40, a, { style: 'bed', section: S });
      K.put('bedcurtain', cx + dx, dy, a, { i: i * 4 + (dx > 0 ? 1 : 0) + (dy > 2000 ? 2 : 0) });
    }
    K.put('sign', cx, 2258, 0, { cell: 'hs_bay' + (i + 1), w: 50, h: 18, hy: 98, face: 1 });
  }
  // the ring corridor and the core (x 2950..4450, y 2450..3430)
  const cx0 = 2950, cx1 = 4450, cy0 = 2450, cy1 = 3430;
  R(2612, 2250, 4788, cy0, 'hs-corr');
  R(2612, cy0, cx0, cy1, 'hs-corr');
  R(cx1, cy0, 4788, cy1, 'hs-corr');
  R(2612, cy1, 4788, 3630, 'hs-corr');
  // core walls: the nurses' station opens onto the north corridor (x 3400..4000)
  K.wall(cx0, cy0, 3400, cy0, { section: S, style: 'hosp' });
  K.wall(4000, cy0, cx1, cy0, { section: S, style: 'hosp' });
  K.wall(cx0, cy0, cx0, cy1, { section: S, style: 'hosp', doors: [{ at: 2660, w: 96, kind: 'leaf' }] });
  K.wall(cx1, cy0, cx1, cy1, { section: S, style: 'hosp', doors: [{ at: 2660, w: 96, kind: 'leaf', flip: true }] });
  K.wall(cx0, cy1, cx1, cy1, { section: S, style: 'hosp', doors: [{ at: 3250, w: 96, kind: 'leaf' }, { at: 4050, w: 96, kind: 'leaf' }] });
  K.wall(3400, cy0 + 8, 3400, 2940, { section: S, style: 'hosp' });
  K.wall(4000, cy0 + 8, 4000, 2940, { section: S, style: 'hosp' });
  K.wall(cx0 + 8, 2940, cx1 - 8, 2940, { section: S, style: 'hosp', doors: [{ at: 3550, w: 90, kind: 'leaf' }] });
  K.wall(3700, 2948, 3700, cy1 - 8, { section: S, style: 'hosp' });
  R(cx0, cy0, 3400, 2940, 'hs-records');
  R(3400, cy0, 4000, 2940, 'hs-station');
  R(4000, cy0, cx1, 2940, 'hs-meds');
  R(cx0, 2940, 3700, cy1, 'hs-staff');
  R(3700, 2940, cx1, cy1, 'hs-sluice');
  // the nurses' station: a long counter facing the corridor, a desk behind
  B.ob('counter', 3700, 2560, 420, 44, 0, { style: 'nstation', section: S });
  B.ob('desk', 3560, 2800, 120, 50, 0, { style: 'officedesk', section: S });
  B.ob('cabinet', 3880, 2900, 180, 32, 0, { style: 'filing', section: S });
  K.put('whiteboard', 3700, 2932, Math.PI, { w: 150, h: 60 });
  B.anchor('ward_nurses', 3700, 2380, 150);
  // the records room: rows of shelves of case files
  for (const y of [2560, 2680, 2800]) B.ob('cabinet', 3200, y, 300, 30, 0, { style: 'shelf-files', section: S });
  B.ob('desk', 3020, 2880, 70, 40, HALF, { style: 'officedesk', section: S });
  B.anchor('ward_records', 3150, 2880, 110);
  // meds room: shelves and a fridge; staff room: table, sofa; sluice: steel sinks
  B.ob('cabinet', 4225, 2470, 400, 30, 0, { style: 'shelf-meds', section: S });
  B.ob('cabinet', 4430, 2700, 30, 200, 0, { style: 'shelf-meds', section: S });
  B.ob('cabinet', 4060, 2880, 60, 40, 0, { style: 'medfridge', section: S });
  B.ob('desk', 3300, 3200, 140, 70, 0, { style: 'table', section: S });
  B.ob('desk', 3060, 3380, 150, 50, 0, { style: 'sofa', section: S });
  B.ob('counter', 4200, 3400, 300, 40, 0, { style: 'sluice', section: S });
  // south row: two bays and the generator room (x 4044..4788)
  K.wall(2612, 3630, 4788, 3630, { section: S, style: 'hosp', doors: [{ at: 2960, w: 120, kind: 'double' }, { at: 3670, w: 120, kind: 'double' }, { at: 4570, w: 150, kind: 'double', style: 'plant' }] });
  K.wall(3300, 3638, 3300, 4238, { section: S, style: 'hosp' });
  K.wall(4044, 3638, 4044, 4238, { section: S, style: 'plant' });
  R(2612, 3630, 3300, 4238, 'hs-bay');
  R(3300, 3630, 4044, 4238, 'hs-bay');
  R(4044, 3630, 4788, 4238, 'hs-plant', { dark: 0.85 });
  for (const [x, y, a] of [[2800, 3690, HALF], [3100, 3690, HALF], [2800, 4180, -HALF], [3500, 3690, HALF], [3850, 3690, HALF], [3500, 4180, -HALF], [3850, 4180, -HALF]]) {
    B.ob('desk', x, y, 78, 40, a, { style: 'bed', section: S });
    K.put('bedcurtain', x, y, a, { i: Math.round(x + y) });
  }
  // the generator: a big diesel set on its plinth, the day tank, the switchboard
  B.ob('container', 4460, 4080, 230, 100, 0, { style: 'generator', section: S });
  B.ob('cabinet', 4700, 3780, 50, 150, 0, { style: 'switchboard', section: S });
  B.ob('cabinet', 4130, 4130, 80, 160, 0, { style: 'daytank', section: S });
  B.anchor('ward_generator', 4460, 3920, 110);
  // the ward's exit: surgery_doors
  K.wall(4800, 1612, 4800, 2920, { section: S, style: 'hosp' });
  K.gateIn('surgery_doors', 'door', 4800, 3000, 160, false, { section: 'surgery', label: 'Surgery doors', frame: 'hosp' });
  K.wall(4800, 3080, 4800, 4238, { section: S, style: 'hosp' });
  // quarantine plastic over the west corridor, a barricade of beds in the south corridor
  K.put('plastic', 2780, 2350, 0, { w: 320, h: CEIL });
  B.ob('desk', 3300, 3530, 78, 40, 0.5, { style: 'bed', section: S });
  B.ob('desk', 3390, 3500, 78, 40, -0.3, { style: 'bed', section: S });
  K.put('sign', 2592, 3000, HALF, { cell: 'hs_wardc', w: 120, h: 27, hy: 104, face: 1 });

  // lights: the ward at night: dim warm corridor lights, a flickering tube, the nurses' station lamp
  const L = (x, y, r, c = '#dfe6f4', f = 0, h = CEIL - 4) => B.light(x, y, r, c, f, h);
  L(2780, 2700, 280, '#dfe6f4'); L(3200, 2350, 260, '#dfe6f4', 0.5); L(4200, 2350, 260); L(4620, 2700, 280, '#dfe6f4', 0.3);
  L(3100, 3530, 260); L(4300, 3530, 260, '#dfe6f4', 0.7);
  L(3700, 2700, 240, '#ffe6c0', 0, 90);
  L(2884, 1930, 240, '#ffe8c8', 0.2, 100); L(3428, 1930, 220, '#ffe8c8'); L(3972, 1930, 220, '#ffe8c8', 0.6); L(4516, 1930, 220, '#ffe8c8');
  L(3170, 2700, 200, '#e4ecff', 0.4); L(4225, 2700, 180, '#e4ecff');
  L(2950, 3930, 240, '#ffe8c8', 0.3); L(3670, 3930, 240, '#ffe8c8');
  L(4420, 3900, 280, '#ff5a2a', 0.45, CEIL - 10);
  // spawns: the bays (north and south), the staff room
  B.zspawn(2884, 1700, 160, 90, 1, S);
  B.zspawn(4516, 1700, 160, 90, 1, S);
  B.zspawn(3972, 1720, 160, 90, 1, S);
  B.zspawn(2950, 4160, 200, 100, 1, S);
  B.zspawn(3670, 4160, 200, 100, 1, S);
  B.zspawn(3300, 3060, 180, 80, 0.7, S);
  B.checkpoint(S, 2780, 3000);
  B.checkpoint(S, 3700, 2350);
  B.checkpoint(S, 4620, 3000);

  K.scatter('paperf', 30, 2630, 1630, 4770, 4220, [0.8, 1.3], 6);
  K.scatter('blood', 18, 2630, 2260, 4770, 3620, [0.8, 1.6], 6);
  K.scatter('clothes', 8, 2630, 1630, 4770, 4220, [0.8, 1.1], 8);
  K.scatter('litter', 10, 2630, 2260, 4770, 3620, [0.8, 1.1], 6);
  for (const [x, y, a] of [[2800, 2900, 0.4], [4600, 2400, 2.1], [3600, 3520, 1.2]]) K.dress('wheelchair', x, y, a, 1, 0.35);
  K.dress('gurney', 4200, 2350, 0.1, 1, 0.3);
  K.dress('bodybag', 3150, 2330, 0.1, 1, 0.3);
  K.dress('bodybag', 4400, 3540, 1.5, 1, 0.4);
  for (let i = 0; i < 12; i++) K.dress('blood', 3950 + i * 50, 3540 + Math.sin(i) * 20, 0.1, 0.6 + (i % 3) * 0.2, 0.12);
}

// ---------------------------------------------------------------------------------------------
// SURGERY (x 4812..6788)

function buildSurgery(B, K, CEIL) {
  const S = 'surgery';
  const R = (x0, y0, x1, y1, style, o = {}) => K.roof(x0, y0, x1, y1, { kind: 'hospital', height: o.h || CEIL, section: S, style, dark: o.dark ?? 0.8 });
  // recovery (y 1612..2150) behind the theatres; the west and east passages make a loop
  K.wall(5100, 2150, 6500, 2150, { section: S, style: 'hosp', doors: [{ at: 5425, w: 110, kind: 'double' }, { at: 6175, w: 110, kind: 'double' }] });
  R(4812, 1612, 6788, 2150, 'hs-recovery');
  for (const x of [5250, 5650, 6050, 6450]) {
    B.ob('desk', x, 1668, 78, 40, HALF, { style: 'bed', section: S });
    K.put('bedcurtain', x, 1668, HALF, { i: x });
    K.put('monitor', x + 50, 1700, HALF, {});
  }
  B.ob('desk', 5450, 1980, 78, 40, 0.3, { style: 'bed', section: S });
  // the theatres (OR 1 x 5100..5750, OR 2 x 5850..6500; y 2150..2850)
  K.wall(5100, 2158, 5100, 2850, { section: S, style: 'hosp-or' });
  K.wall(5750, 2158, 5750, 2850, { section: S, style: 'hosp-or' });
  K.wall(5850, 2158, 5850, 2850, { section: S, style: 'hosp-or' });
  K.wall(6500, 2158, 6500, 2850, { section: S, style: 'hosp-or' });
  K.wall(5100, 2850, 6500, 2850, { section: S, style: 'hosp-or', doors: [{ at: 5425, w: 130, kind: 'swing' }, { at: 6175, w: 130, kind: 'swing' }] });
  R(5100, 2150, 5750, 2850, 'hs-or', { h: CEIL + 10, dark: 0.85 });
  R(5850, 2150, 6500, 2850, 'hs-or', { h: CEIL + 10, dark: 0.85 });
  R(4812, 2150, 5100, 2850, 'hs-corr');
  R(6500, 2150, 6788, 2850, 'hs-corr');
  for (const [x, lbl] of [[5425, 1], [6175, 2]]) {
    B.ob('desk', x, 2500, 110, 40, 0, { style: 'ortable', section: S });
    K.put('orlamp', x, 2500, 0, { h: CEIL + 10 });
    B.ob('cabinet', x - 190, 2330, 60, 50, 0, { style: 'anesthesia', section: S });
    K.put('instrument', x + 110, 2440, 0.2, {});
    K.put('instrument', x + 90, 2600, -0.3, {});
    K.put('monitor', x - 150, 2560, HALF, {});
    K.put('sign', x, 2858, Math.PI, { cell: 'hs_or' + lbl, w: 80, h: 22, hy: 96, face: -1 });
    K.put('inuse', x + 90, 2858, Math.PI, {});
    B.light(x, 2500, 300, '#f4fbff', lbl === 2 ? 0.55 : 0, CEIL + 4);
  }
  B.anchor('surgery_theatre', 5425, 2640, 120);
  // the sterile corridor (y 2850..3150) and the south rooms
  R(4812, 2850, 6788, 3150, 'hs-corr-or');
  K.wall(4812, 3150, 6100, 3150, { section: S, style: 'hosp', doors: [{ at: 5150, w: 100, kind: 'leaf' }, { at: 5800, w: 110, kind: 'double' }] });
  K.wall(5500, 3158, 5500, 4238, { section: S, style: 'hosp' });
  K.wall(6100, 3150, 6100, 3700, { section: S, style: 'hosp' });
  K.wall(5500, 3700, 6100, 3700, { section: S, style: 'hosp', doors: [{ at: 5800, w: 100, kind: 'leaf' }] });
  R(4812, 3150, 5500, 4238, 'hs-store');
  R(5500, 3150, 6100, 3700, 'hs-scrub');
  R(5500, 3700, 6100, 4238, 'hs-store');
  R(6100, 3150, 6788, 4238, 'hs-lobby-lift');
  // scrub room: the long steel scrub trough on the north wall, gown shelves
  B.ob('counter', 6070, 3420, 40, 380, 0, { style: 'scrubsink', section: S });
  B.ob('cabinet', 5530, 3440, 30, 300, 0, { style: 'shelf-gowns', section: S });
  B.anchor('surgery_scrub', 5960, 3420, 110);
  // sterile supply: rows of wire shelving; equipment store: machines under sheets
  for (const y of [3300, 3500, 3700, 3900]) B.ob('cabinet', 5150, y, 480, 30, 0, { style: 'shelf-supply', section: S });
  for (const [x, y] of [[5650, 3900], [5850, 4080], [6000, 3860]]) B.ob('cabinet', x, y, 70, 60, 0.2, { style: 'sheeted', section: S });
  // the freight lift: shaft on the east side of the lift lobby, its doors jammed open
  K.wall(6400, 3150, 6400, 3640, { section: S, style: 'lift', doors: [{ at: 3390, w: 200, kind: 'lift' }] });
  K.wall(6400, 3640, 6788, 3640, { section: S, style: 'lift' });
  K.wall(6400, 3150, 6788, 3150, { section: S, style: 'lift' });
  R(6400, 3150, 6788, 3640, 'hs-lift', { h: CEIL, dark: 0.9 });
  K.put('liftcar', 6594, 3395, 0, { w: 370, d: 470 });
  B.anchor('surgery_lift', 6280, 3390, 120);
  // the stair door: into Stair B (the tower)
  K.wall(6800, 1612, 6800, 4084, { t: 24, section: S, style: 'hosp-tower' });
  K.gateIn('stair_door', 'door', 6800, 4144, 120, false, { t: 24, section: 'stairwell', label: 'Stair B door', frame: 'stair', leaves: 1 });
  K.wall(6800, 4204, 6800, 4238, { t: 24, section: S, style: 'hosp-tower' });
  K.put('sign', 6788, 4144, -HALF, { cell: 'hs_stairb', w: 70, h: 24, hy: 106, face: -1 });
  K.put('exitsign', 6786, 4144, -HALF, { hy: 92 });
  B.ob('desk', 6300, 3900, 76, 36, 0.9, { style: 'gurney', section: S });

  const L = (x, y, r, c = '#e8f0ff', f = 0, h = CEIL - 4) => B.light(x, y, r, c, f, h);
  L(5000, 3000, 260); L(5800, 3000, 280, '#e8f0ff', 0.3); L(6500, 3000, 260);
  L(5300, 1880, 260, '#e0e8f8', 0.2); L(6200, 1880, 260, '#e0e8f8');
  L(4950, 2500, 220, '#e8f0ff', 0.6); L(6640, 2500, 220);
  L(5800, 3400, 240, '#e8f0ff', 0.2); L(5150, 3600, 240, '#e8f0ff', 0.7); L(5800, 3960, 200, '#ffd8a8', 0.3);
  L(6300, 3400, 240, '#ffb060', 0.25, CEIL - 10); L(6600, 4000, 220, '#ff3a2a', 0.35, CEIL - 10); L(6594, 3395, 160, '#fff0d0', 0.8, CEIL - 10);
  // spawns: recovery, the stores, the lift shaft
  B.zspawn(5250, 1700, 200, 90, 1, S);
  B.zspawn(6400, 1700, 200, 90, 1, S);
  B.zspawn(5150, 4100, 200, 120, 1, S);
  B.zspawn(5800, 4150, 200, 100, 1, S);
  B.zspawn(6650, 3300, 120, 140, 1.2, S);
  B.checkpoint(S, 4950, 3000);
  B.checkpoint(S, 6300, 3000);
  B.checkpoint(S, 6300, 4100);

  K.scatter('paperf', 20, 4830, 1630, 6770, 4220, [0.8, 1.3], 6);
  K.scatter('blood', 16, 4830, 2860, 6770, 4220, [0.8, 1.6], 6);
  K.scatter('glassf', 6, 5150, 2200, 6450, 2800, [0.8, 1.2], 4);
  K.dress('bodybag', 5600, 3000, 0.1, 1, 0.3);
  K.dress('wheelchair', 6700, 3780, 2.1, 1, 0.4);
  for (let i = 0; i < 14; i++) K.dress('blood', 6150 + i * 40, 3860 + i * 22, 0.5, 0.6 + (i % 3) * 0.2, 0.12);
}

// ---------------------------------------------------------------------------------------------
// THE TOWER: Stair B (four flights) and the roof

function buildTower(B, K) {
  const Tw = HOSPITAL.tower, St = HOSPITAL.stair, TOP = HOSPITAL.towerTop;
  const EXT = 24;
  // the tower's shell (the podium's east wall at x 6800 is its west wall)
  K.wall(Tw.x0, Tw.y0, Tw.x1, Tw.y0, { t: EXT, style: 'tower-ext', section: 'roof' });
  K.wall(Tw.x1, Tw.y0, Tw.x1, Tw.y1, { t: EXT, style: 'tower-ext', section: 'roof' });
  K.wall(Tw.x0, Tw.y1, Tw.x1, Tw.y1, { t: EXT, style: 'tower-ext', section: 'stairwell' });
  // the plant block (x 7316..8400, y 3450..4250): cooling towers on a housing, not walkable
  B.ob('wall', 7858, 3850, 1084, 800, 0, { style: 'plantblock', section: 'roof' });

  // ---- Stair B: four lanes (south to north), each a flight between two landings
  const xa = St.x0 + 12, xb = St.x1 - 8;            // lane interior along x (6812..7308)
  const LAND = 140;
  const lanes = [];
  let y = St.y1 - 12;                                 // the south wall's inner face
  for (let k = 0; k < 4; k++) {
    const y1 = y, y0 = y - 180;
    lanes.push({ k, y0, y1, yc: (y0 + y1) / 2, h0: k * TOP / 4, h1: (k + 1) * TOP / 4, east: k % 2 === 0 });
    y = y0 - 16;
  }
  const northFace = y;                                 // lane 3's y0 - 16 = the north wall's south face
  // flights (micro steps), landings, the plateaus under the openings between lanes
  for (const L of lanes) {
    const f0 = xa + LAND, f1 = xb - LAND;
    if (L.h0 > 0) K.plateau(xa, L.y0, xb, L.y1, L.h0);   // the lane's lower landing level everywhere
    if (L.east) K.flightX(f0, f1, L.y0, L.y1, L.h0, L.h1, 1, xb, 60);
    else K.flightX(f0, f1, L.y0, L.y1, L.h0, L.h1, -1, xa, 60);
  }
  // openings between lanes: at the east landings (0-1, 2-3) and the west landing (1-2)
  for (const [lo, hi, east] of [[0, 1, true], [1, 2, false], [2, 3, true]]) {
    const A = lanes[lo], Bq = lanes[hi];
    const x0 = east ? xb - LAND : xa, x1 = east ? xb : xa + LAND;
    K.plateau(x0, Bq.y1, x1, A.y0, A.h1);               // the floor under the opening in the divider
  }
  K.guard(St.x0, St.y0, St.x1, St.y1);
  // the lane dividers (with the openings), the enclosure walls
  for (const [lo, hi, east] of [[0, 1, true], [1, 2, false], [2, 3, true]]) {
    const A = lanes[lo];
    const wy = A.y0 - 8;
    const open = east ? { at: xb - LAND / 2 - 4, w: LAND - 16 } : { at: xa + LAND / 2 + 4, w: LAND - 16 };
    K.wall(St.x0 + 12, wy, St.x1 - 8, wy, { section: 'stairwell', style: 'stair', doors: [{ ...open, kind: 'arch' }] });
  }
  K.wall(St.x1, St.y0, St.x1, St.y1, { t: 16, style: 'stair', section: 'stairwell' });
  // the north wall (roof side) with the roof door at lane 3's west landing
  const L3 = lanes[3];
  const doorX = xa + 70;
  const ny = L3.y0 - 8;                                  // wall centre (16 thick) just north of lane 3
  void northFace;
  K.wall(St.x0, ny, doorX - 60, ny, { t: 16, style: 'stair', section: 'stairwell' });
  K.gateIn('roof_door', 'shutter', doorX, ny, 120, true, { t: 16, section: 'roof', label: 'Roof access', frame: 'stair', h: 104 });
  K.wall(doorX + 60, ny, St.x1, ny, { t: 16, style: 'stair', section: 'stairwell' });
  K.plateau(doorX - 60, ny - 8, doorX + 60, ny + 8, TOP);
  // stair art: the flights, landings, rails, ceilings, the floor numbers
  for (const L of lanes) {
    K.put('flight', (xa + xb) / 2, L.yc, 0, { x0: xa, x1: xb, y0: L.y0, y1: L.y1, f0: xa + LAND, f1: xb - LAND, h0: L.h0, h1: L.h1, east: L.east ? 1 : 0, k: L.k });
  }
  K.put('stairfloor', xa + 70, lanes[1].yc, 0, { n: 2, h: lanes[1].h1, face: 1 });
  K.put('stairfloor', xb - 70, lanes[2].yc, 0, { n: 3, h: lanes[2].h1, face: -1 });
  K.put('stairfloor', xa + 70, L3.yc, 0, { n: 'R', h: TOP, face: 1 });
  // roofs over the lanes (the art draws the sloped soffits itself)
  for (const L of lanes) K.roof(xa - 12, L.y0 - 8, xb + 8, L.y1 + 8, { kind: 'plain', height: 170, section: 'stairwell', style: 'hs-stair', dark: 0.92 });
  // emergency lights on the landings, the EXIT signs
  const lx = (L, west) => (west ? xa + 60 : xb - 60);
  for (const L of lanes) {
    B.light(lx(L, true), L.yc, 230, '#ffb35a', L.k === 2 ? 0.55 : 0.12, (L.east ? L.h0 : L.h1) + 108);
    B.light(lx(L, false), L.yc, 230, L.k % 2 ? '#ff4a30' : '#ffb35a', 0.25, (L.east ? L.h1 : L.h0) + 108);
  }
  B.anchor('stair_bottom', xa + 70, lanes[0].yc, 90);
  B.anchor('stair_top', xa + 90, L3.yc + 45, 90);
  B.anchor('roof_door', doorX, L3.y0 + 50, 70);
  B.zspawn(xb - 60, lanes[2].yc, 70, 120, 1, 'stairwell');
  B.zspawn(xa + 60, lanes[3].yc + 20, 70, 100, 1, 'stairwell');
  B.zspawn(xb - 60, lanes[1].yc, 70, 120, 0.7, 'stairwell');
  B.checkpoint('stairwell', xa + 60, lanes[0].yc);
  B.checkpoint('stairwell', xb - 60, lanes[0].yc);
  B.checkpoint('stairwell', xa + 60, lanes[2].yc);

  // ---- the roof (x 6812..8388, y 1612..3438 at h 450)
  const R0 = { x0: Tw.x0 + 12, y0: Tw.y0 + 12, x1: Tw.x1 - 12, y1: ny - 8 };
  K.plateau(R0.x0, R0.y0, R0.x1, R0.y1, TOP);
  K.guard(R0.x0, R0.y0, R0.x1, R0.y1);
  B.box('concrete', R0.x0, R0.y0, R0.x1, R0.y1);
  K.put('roofdeck', (R0.x0 + R0.x1) / 2, (R0.y0 + R0.y1) / 2, 0, { w: R0.x1 - R0.x0, d: R0.y1 - R0.y0, h: TOP });
  // the stair housing: the lanes' shaft rises above the roof (a penthouse), the roof door on its north face
  K.put('stairhouse', (St.x0 + St.x1) / 2, (St.y0 + St.y1) / 2, 0, { x0: St.x0 - 12, y0: ny - 8, x1: St.x1 + 8, y1: St.y1 + 12, h: TOP, top: 600 });
  // the helipad (north-east, over the car park), its lights, the windsock, the radio console
  const hx = 7780, hy = 2280, hr = 280;
  K.put('helipad', hx, hy, 0, { r: hr, h: TOP });
  B.anchor('helipad', hx, hy, 220);
  B.light(hx, hy, 620, '#f2f6ff', 0, TOP + 240);
  B.ob('cabinet', 8290, 2760, 60, 120, 0, { style: 'radio', section: 'roof' });
  B.ob('wall', 8330, 2560, 30, 30, 0, { style: 'mast', section: 'roof' });
  K.put('mast', 8330, 2560, 0, { h: TOP, top: TOP + 360 });
  K.put('windsock', 8330, 1720, 0, { h: TOP });
  B.anchor('roof_radio', 8200, 2760, 100);
  B.light(8250, 2760, 200, '#9fe0ff', 0.2, TOP + 70);
  // plant: HVAC units and ducts, the water tank, the big sign facing the car park
  for (const [x, y, w, h] of [[7100, 2000, 110, 70], [7100, 2150, 110, 70], [7300, 2900, 140, 80], [7520, 2900, 140, 80], [7740, 3150, 110, 70], [7950, 3200, 110, 70]]) {
    B.ob('hvac', x, y, w, h, 0, { section: 'roof', style: 'hs-hvac' });
  }
  B.ob('container', 7060, 2720, 90, 90, 0, { style: 'watertank', section: 'roof' });
  B.ob('wall', 7500, 2700, 360, 20, 0, { style: 'duct', section: 'roof', solid: false });
  K.put('bigsign', 7600, Tw.y0, 0, { w: 900, h: 120 });
  K.put('redcross', 8300, Tw.y0 + 120, 0, { hy: TOP + 110 });
  B.light(7600, 1700, 300, '#ff5a4a', 0, TOP + 120);
  // parapet lights and the beacon
  B.light(7000, 3300, 240, '#ffb35a', 0.2, TOP + 60);
  B.light(8200, 3300, 240, '#ffb35a', 0, TOP + 60);
  // spawns: behind the plant, the stair housing's back, the far corners
  B.zspawn(8250, 3300, 120, 120, 1, 'roof');
  B.zspawn(7000, 1720, 160, 100, 1, 'roof');
  B.zspawn(8250, 1720, 160, 100, 1, 'roof');
  B.zspawn(7650, 3330, 200, 80, 1, 'roof');
  B.checkpoint('roof', 7000, 3200);
  B.checkpoint('roof', 7400, 2500);
  B.checkpoint('roof', 8000, 2600);

  K.scatter('paperf', 10, R0.x0 + 30, R0.y0 + 30, R0.x1 - 30, R0.y1 - 30, [0.9, 1.3], 8);
  K.scatter('puddle', 8, R0.x0 + 30, R0.y0 + 30, R0.x1 - 30, R0.y1 - 30, [1, 2.2], 6);
  K.scatter('blood', 5, 6900, 2800, 7400, 3400, [0.8, 1.4], 8);
  K.dress('bodybag', 7400, 2300, 0.4, 1, 0.3);
  K.dress('milcrate', 8150, 2900, 0.2, 1, 0.4);
  K.dress('milcrate', 8170, 2940, 0.9, 1, 0.6);
  K.dress('flare', 7650, 2100, 0, 1, 0.5);
  K.dress('flare', 7950, 2450, 0, 1, 0.6);
}
