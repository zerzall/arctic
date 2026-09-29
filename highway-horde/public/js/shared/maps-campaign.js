// The campaign extension of a map (SPEC §3.8, mode 'campaign'). It is added to a map that
// has already been laid out by its own builder (maps.js) and gives it, on top of the
// existing streets and fields:
//
//   1. a fortified HILL — real terrain (shared/terrain.js): a plateau ringed by a palisade
//      with eight gates, sandbag funnels behind the gates, a ruined watchtower, the supply
//      station and a repaired truck; the slope below it is where the horde climbs;
//   2. the TOWER — a 440-unit office tower at the far end of a wrecked street with a plaza,
//      flanking buildings, wrecks and barriers; the team enters at its front door;
//   3. an ANNEX below the map, unreachable except by stairs: three compact office floors
//      (lobby, offices, atrium), the rooftop with its parapet, helipad and zip-line gantry,
//      and the landing pad at the end of the cable. The floors sit on terrain plateaus of
//      rising height, so the renderer's camera and the sim's feet heights agree.
//
// Every builder is parameterised by a site record (CAMPAIGN_SITES): where the hill, the
// tower and the route between them go on this map; the parts are shared by all sites.
// Everything is deterministic for (map id, seed): host and clients build identical maps.

import { TAU } from './math.js';

/** Obstacle kinds this file introduces (renderers and tests iterate them). */
export const CAMPAIGN_KINDS = Object.freeze([
  'palisade', 'watchtower', 'tower', 'iwall', 'desk', 'cabinet', 'counter', 'ipillar', 'stairs',
  'hvac', 'parapet', 'rim', 'mast',
]);

/** Heights of the campaign kinds (world units above the ground they stand on). */
export const CAMPAIGN_HEIGHT = Object.freeze({
  palisade: 74, watchtower: 230, tower: 440, iwall: 132, desk: 30, cabinet: 92, counter: 40,
  ipillar: 132, stairs: 132, hvac: 56, parapet: 44, rim: 0, mast: 300,
});

/**
 * Where the parts go on each map (world units of the finished base map). `pad` enlarges the
 * world to the right (the hill may sit in the new ground); `route` runs from the hill's
 * centre to the tower's front door.
 */
export const CAMPAIGN_SITES = Object.freeze({
  checkpoint: {
    pad: { right: 1850 },
    hill: { x: 3850, y: 1500 },
    tower: { x: 330, y: 1500, a: 0, len: 560 },
    route: [[3850, 1500], [500, 1500]],
    look: { grass: 'grass', street: 'asphalt' },
  },
  highway: {
    pad: { right: 1900 },
    hill: { x: 8500, y: 1100 },
    tower: { x: 5700, y: 300, a: Math.PI / 2, len: 440, plaza: 300, clear: 640 },
    route: [[8500, 1100], [5700, 1100], [5700, 520]],
    look: { grass: 'grass', street: 'asphalt' },
  },
  harlan: {
    pad: {},
    hill: { x: 5860, y: 5600 },
    tower: { x: 2930, y: 3600, a: 0, len: 560 },
    route: [[5860, 5600], [5200, 5420], [5200, 3660], [3130, 3600]],
    look: { grass: 'grass', street: 'asphalt' },
  },
});

/** Tuning of the parts (shared by every site). */
export const CAMPAIGN_PARTS = Object.freeze({
  hill: { r: 980, plateau: 350, h: 110, ring: 330, gates: 8, gateW: 84 },
  tower: { depth: 240, width: 300, top: 440, doorR: 120 },
  annex: {
    marginX: 140, gap160: 160, floorW: 1000, floorH: 680, roofW: 1300, roofH: 860, land: 420,
    heights: { lobby: 0, offices: 100, atrium: 200, roof: 380, landing: 60 },
    ceil: { lobby: 150, offices: 150, atrium: 210 },
    wall: 28,
  },
});

/** Width (units) of the steep skirt at the foot of a plateau (a cliff: the renderer dresses it as a facade). */
export const PLATEAU_EDGE = 8;

const round1 = (v) => Math.round(v * 10) / 10;

function polar(cx, cy, r, a) {
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
}

function pathLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

/**
 * Extend the map in builder B with the campaign parts of site `id`.
 * @param {object} B map builder (maps.js createBuilder)
 * @param {string} id map id (key of CAMPAIGN_SITES)
 */
export function buildCampaign(B, id) {
  const site = CAMPAIGN_SITES[id];
  const map = B.map;
  const P = CAMPAIGN_PARTS;
  const W0 = B.W, H0 = B.H;
  // ---- the world grows: room for a hill beside the map and the annex below it
  const annex = planAnnex(P.annex, H0 + 300);
  const W = Math.max(W0 + (site.pad.right || 0), annex.right + 200);
  const H = annex.bottom + 200;
  B.resize(W, H);
  map.time = 'day';

  const terrain = { hills: [], plateaus: [] };
  const camp = { v: 1, site: id, hill: null, route: site.route.map(([x, y]) => [x, y]), floors: [], roof: null, landing: null, skyline: [] };
  camp.routeLen = round1(pathLength(camp.route));
  map.terrain = terrain;
  map.campaign = camp;
  // the old objective (bus, radio, ...) stays as scenery; the team defends the hill instead
  map.zombieSpawns = [];
  map.playerSpawns = [];

  buildHill(B, site, terrain, camp);
  buildTower(B, site, camp);
  buildAnnex(B, annex, terrain, camp);
  buildSkyline(B, site, annex, camp);
  return map;
}

// ---------------------------------------------------------------------------------------
// The hill

function buildHill(B, site, terrain, camp) {
  const map = B.map, rng = B.rng, drng = B.drng;
  const H = CAMPAIGN_PARTS.hill;
  const { x: hx, y: hy } = site.hill;
  const gate = Math.atan2(site.route[1][1] - hy, site.route[1][0] - hx);
  camp.hill = { x: hx, y: hy, r: H.r, plateau: H.plateau, h: H.h, gate: round1(gate * 100) / 100 };
  terrain.hills.push({ x: hx, y: hy, r: H.r, plateau: H.plateau, h: H.h, flank: true });

  // Clear the site: the hill replaces whatever stood here.
  B.clearCircle(hx, hy, H.r + 30);
  // (the padded ground is base ground already; the octagon of meadow makes the slope green)
  const g = site.look.grass;
  B.area(g, hx, hy, H.r * 1.72, H.r * 1.72, 0);
  B.area(g, hx, hy, H.r * 1.72, H.r * 1.72, Math.PI / 4);
  B.area('dirt', hx, hy, H.plateau * 1.72, H.plateau * 1.72, 0);
  B.area('dirt', hx, hy, H.plateau * 1.72, H.plateau * 1.72, Math.PI / 4);
  // cart tracks up from every gate; the back gate's is a gravel road
  for (let k = 0; k < H.gates; k++) {
    const a = k * TAU / H.gates + gate;
    const [x0, y0] = polar(hx, hy, H.ring - 20, a);
    const [x1, y1] = polar(hx, hy, H.r - 40, a);
    const m = [(x0 + x1) / 2, (y0 + y1) / 2];
    B.area(k === 0 ? 'gravel' : 'dirt', m[0], m[1], Math.hypot(x1 - x0, y1 - y0), k === 0 ? 96 : 60, a);
  }

  // ---- the fort ------------------------------------------------------------------------
  const R = H.ring;
  const gateHalf = H.gateW / 2;
  for (let k = 0; k < H.gates; k++) {
    // a palisade section between gate k and gate k + 1 (gate 0 faces the route, and is wider)
    const a0 = gate + (k * TAU) / H.gates, a1 = gate + ((k + 1) * TAU) / H.gates;
    const am = (a0 + a1) / 2;
    const chord = 2 * R * Math.sin(Math.PI / H.gates);
    const g0 = (k === 0 ? gateHalf * 2.2 : gateHalf), g1 = (k + 1 === H.gates ? gateHalf * 2.2 : gateHalf);
    const len = chord - g0 - g1;
    const shift = (g0 - g1) / 2;
    // centre of the section, shifted along the chord toward the wider side's far end
    const ca = Math.cos(am), sa = Math.sin(am);
    const cx = hx + ca * R * Math.cos(Math.PI / H.gates) + -sa * shift;
    const cy = hy + sa * R * Math.cos(Math.PI / H.gates) + ca * shift;
    B.ob('palisade', cx, cy, len, 14, am + Math.PI / 2, { color: '#6b4a2c' });
  }
  // funnels behind the gates (all but the back gate stay closed by sandbags on both sides)
  for (let k = 0; k < H.gates; k++) {
    const a = gate + (k * TAU) / H.gates;
    const flank = k === 0 ? 0.30 : 0.24;
    for (const s of [-1, 1]) {
      const [x, y] = polar(hx, hy, R - 66, a + s * flank);
      B.ob('sandbags', x, y, 76, 24, a + s * flank * 0.55 + Math.PI / 2, { color: '#8a7a55' });
    }
    if (k !== 0) {
      // a lone barrel fire watching each gate (not a hazard: cosmetic light)
      const [x, y] = polar(hx, hy, R - 120, a + 0.42);
      if (k % 2 === 1) B.fire(x, y, 11);
    }
  }
  // the ruined watchtower (a landmark: 230 units of timber and corrugated iron)
  B.ob('watchtower', hx - 24, hy - 136, 84, 84, 0.18, { color: '#5b4a36' });
  // camp: tents, the repaired truck, ammo crates, the supply station
  B.ob('tent', hx + 150, hy - 96, 100, 74, 0.35, { color: '#5a6340', roof: '#6b7449' });
  B.ob('truck', hx - 130, hy + 96, 136, 56, 0.55, { color: '#4b5320', solid: true });
  B.ob('container', hx + 40, hy + 168, 62, 38, 0.1, { color: '#7a3b2e' });
  B.supply(hx + 82, hy + 50);
  // the lookout's lamp and a campfire
  B.fire(hx - 60, hy + 40, 14);
  B.light(hx, hy - 20, 460, '#ffe6b0', 0);
  B.light(hx - 24, hy - 136, 240, '#ffd08a', 0.18, H.h + 100);

  // player spawns: inside the fort, well clear of everything
  const spawns = [];
  const free = (x, y) => !B.blockedAt(x, y, 30) && !B.blockedAt(x + 14, y, 24) && !B.blockedAt(x - 14, y, 24);
  for (let k = 0; k < 10; k++) {
    for (let t = 0; t < 30; t++) {
      const a = (k + 0.5) * TAU / 10 + t * 0.35;
      const r = 96 + (t % 3) * 20 + Math.floor(t / 3) * 6;
      const [x, y] = polar(hx, hy, r, a);
      if (!free(x, y)) continue;
      if (spawns.some((s) => Math.hypot(s.x - x, s.y - y) < 40)) continue;
      spawns.push({ x: round1(x), y: round1(y) });
      break;
    }
  }
  for (const s of spawns) B.pspawn(s.x, s.y);
  camp.hill.spawns = spawns;

  // ---- the slope: boulders, scrub and the forest around the foot -------------------------
  for (let i = 0; i < 40; i++) {
    for (let t = 0; t < 12; t++) {
      const a = rng.range(0, TAU), d = rng.range(H.plateau + 50, H.r - 90);
      const [x, y] = polar(hx, hy, d, a);
      // keep the tracks and the gates clear
      const w = rng.range(30, 64), h2 = w * rng.range(0.65, 0.95);
      if (!B.fits({ x, y, w, h: h2, a }, 70, ['asphalt', 'concrete'])) continue;
      if (!trackFree(hx, hy, gate, H, x, y)) continue;
      B.ob('rock', x, y, w, h2, a, { color: rng.pick(['#6d6a63', '#77726a', '#5f5b55']) });
      break;
    }
  }
  for (let i = 0; i < 9; i++) {
    const a = (i + rng.range(-0.2, 0.2)) * TAU / 9;
    const [x, y] = polar(hx, hy, H.r * 0.9, a);
    if (i % 3 === 0) continue;          // leave gaps in the tree line where the tracks arrive
    B.forest(x, y, 200, 130, 7, { avoid: ['asphalt', 'concrete', 'gravel', 'water', 'sand', 'dirt'] });
  }
  B.cluster('grass_tuft', 260, hx, hy, H.r, { s: [0.7, 1.4] });
  B.cluster('bush', 60, hx, hy, H.r * 0.9, { s: [0.6, 1.3] });
  B.cluster('rock', 40, hx, hy, H.r * 0.8, { s: [0.5, 1.3] });
  B.cluster('debris', 14, hx, hy, H.plateau * 0.9, { s: [0.6, 1.1] });
  B.cluster('blood_old', 10, hx, hy, H.plateau, { s: [0.7, 1.4] });
  B.decor('flag', hx - 24, hy - 88, 0, 1.1);
  B.decor('flag', hx + 30, hy + 110, 0.6, 0.9);
}

function trackFree(hx, hy, gate, H, x, y) {
  const a = Math.atan2(y - hy, x - hx);
  for (let k = 0; k < H.gates; k++) {
    let d = Math.abs(((a - (gate + (k * TAU) / H.gates)) % TAU + TAU + Math.PI) % TAU - Math.PI);
    if (d < 0.11) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------
// The tower and the wrecked street that leads to it

function buildTower(B, site, camp) {
  const rng = B.rng, drng = B.drng, map = B.map;
  const T = CAMPAIGN_PARTS.tower;
  const { x: tx, y: ty, a } = site.tower;
  const fx = Math.cos(a), fy = Math.sin(a);         // out of the front door
  const sx = -fy, sy = fx;                            // to the right of it
  const at = (u, v) => [tx + fx * u + sx * v, ty + fy * u + sy * v];
  // everything in the way goes
  const len = site.tower.len;
  const [cx, cy] = at(len / 2 + 40, 0);
  const plazaD = site.tower.plaza || 520;
  B.clearRect(cx, cy, len + 160, site.tower.clear || 900, a, 0);
  B.clearCircle(tx, ty, 220);
  // plaza and street
  const [px, py] = at(T.depth / 2 + plazaD / 2, 0);
  B.area('concrete', px, py, plazaD, Math.min(700, site.tower.clear || 700), a);
  const [qx, qy] = at(T.depth / 2 + 700, 0);
  B.area(site.look.street, qx, qy, len * 0.9 + 100, 300, a);
  const [ex, ey] = at(T.depth / 2 + 20, 0);
  const [e2x, e2y] = at(T.depth / 2 + len, 0);
  B.line('yellow', ex, ey, e2x, e2y, 4);
  for (const v of [-130, 130]) {
    const [l0x, l0y] = at(T.depth / 2 + 300, v);
    const [l1x, l1y] = at(T.depth / 2 + len, v);
    B.line('white', l0x, l0y, l1x, l1y, 3);
  }
  // steps and the door apron
  const [ax, ay] = at(T.depth / 2 + 55, 0);
  B.area('concrete', ax, ay, 110, 230, a);

  // the tower itself: door on the front (+x local) face; the collider is the whole footprint
  B.ob('tower', tx, ty, T.depth, T.width, a, { color: '#7d8794', top: T.top });
  const doorU = T.depth / 2 + 90;
  const [dx, dy] = at(doorU, 0);
  camp.entrance = { x: round1(dx), y: round1(dy), r: T.doorR };
  // the route ends at the door
  camp.route[camp.route.length - 1] = [camp.entrance.x, camp.entrance.y];
  camp.routeLen = round1(pathLength(camp.route));
  camp.tower = { x: tx, y: ty, w: T.depth, h: T.width, a, top: T.top, doorU: T.depth / 2 };

  // flanking buildings that make the street a canyon (tall enough to read from the hill)
  const flank = [[420, 250, 230, 250, 230], [760, 260, 260, 220, 190], [1080, 250, 250, 240, 260]];
  for (const [u, v, w, h, top] of flank) {
    if (u + w / 2 > len - 60) continue;
    for (const s of [-1, 1]) {
      const [bx, by] = at(u, s * v);
      B.ob('building', bx, by, w, h, a + (s > 0 ? 0.02 : -0.03), {
        color: rng.pick(['#8c8478', '#7c8288', '#9a8f7e', '#77736b']), roof: '#4e4a45', top,
      });
    }
  }
  // the barricade the evac never finished: hesco walls and sandbags at the plaza mouth
  for (const s of [-1, 1]) {
    const [bx, by] = at(T.depth / 2 + 520, s * 230);
    B.ob('hesco', bx, by, 90, 30, a + Math.PI / 2, { color: '#a08a62' });
    const [cx2, cy2] = at(T.depth / 2 + 470, s * 300);
    B.ob('sandbags', cx2, cy2, 90, 26, a + Math.PI / 2, { color: '#8a7a55' });
  }
  // wrecks and barriers along the street, leaving a winding lane
  const wrecks = [
    [T.depth / 2 + 330, -70, 0.2, 'car'], [T.depth / 2 + 380, 90, 2.9, 'suv'], [T.depth / 2 + 560, -20, 1.7, 'van'],
    [T.depth / 2 + 690, 80, 0.4, 'pickup'], [T.depth / 2 + 800, -100, 3.3, 'car'], [T.depth / 2 + 930, 30, 1.2, 'bus'],
    [T.depth / 2 + 1010, -110, 2.5, 'suv'], [T.depth / 2 + 440, 170, 0.1, 'car'],
  ];
  for (const [u, v, ang, kind] of wrecks) {
    if (u > T.depth / 2 + len - 80) continue;
    const [wx, wy] = at(u, v);
    const veh = B.vehicle(kind, wx, wy, a + ang, { wrecked: true });
    if (kind === 'car' && u > 700) B.burning(veh);
  }
  for (const [u, v] of [[T.depth / 2 + 620, 145], [T.depth / 2 + 900, -150], [T.depth / 2 + 260, 200], [T.depth / 2 + 260, -200]]) {
    const [bx, by] = at(u, v);
    B.ob('barrier', bx, by, 60, 20, a + rng.range(-0.3, 0.3), { color: '#9a9890' });
  }
  for (let i = 0; i < 5; i++) {
    if (200 + i * 240 > len - 60) break;
    for (const s of [-1, 1]) {
      const [lx, ly] = at(T.depth / 2 + 200 + i * 240, s * 165);
      B.lamp(lx, ly, { a: a + (s > 0 ? -Math.PI / 2 : Math.PI / 2), deadChance: 0.3 });
    }
  }
  // tower glow: entrance lights and a warning beacon on the roof line (lit by the renderer)
  B.light(dx, dy, 380, '#dbe8ff', 0, 90);
  B.light(tx, ty, 260, '#ff5a3a', 0.5, 430);
  B.decor('rubble', ...at(T.depth / 2 + 240, 0), 0, 1.2, true);
  B.cluster('debris', 22, ...at(T.depth / 2 + 600, 0), 260, { s: [0.7, 1.2] });
  B.cluster('paper', 26, ...at(T.depth / 2 + 500, 0), 300, { s: [0.7, 1.2] });
  B.cluster('crack', 20, ...at(T.depth / 2 + 500, 0), 320, { s: [0.8, 1.6] });
  B.cluster('blood_old', 12, ...at(T.depth / 2 + 500, 0), 300, { s: [0.7, 1.4] });
  B.cluster('cone', 8, ...at(T.depth / 2 + 700, 0), 200, { s: [0.9, 1.1] });
  // the entrance is a flat, walkable apron: keep it (and the plaza) free of scatter
  B.keep(...at(T.depth / 2 + 300, 0), 600, 720, a);
}

// ---------------------------------------------------------------------------------------
// The annex: three floors, the roof and the landing pad

function planAnnex(A, y0) {
  const x0 = A.marginX;
  const colB = x0 + A.floorW + A.gap160;
  const floors = [
    { id: 'lobby', name: 'Lobby', x: x0, y: y0, w: A.floorW, h: A.floorH },
    { id: 'offices', name: 'Offices', x: x0, y: y0 + A.floorH + A.gap160, w: A.floorW, h: A.floorH },
    { id: 'atrium', name: 'Atrium', x: x0, y: y0 + (A.floorH + A.gap160) * 2, w: A.floorW, h: A.floorH },
  ];
  const roof = { id: 'roof', name: 'Rooftop', x: colB, y: y0, w: A.roofW, h: A.roofH };
  const landing = { id: 'landing', name: 'Landing', x: colB + (A.roofW - A.land) / 2, y: y0 + A.roofH + 700, w: A.land, h: A.land };
  const bottom = Math.max(floors[2].y + floors[2].h, landing.y + landing.h);
  return { floors, roof, landing, right: colB + A.roofW, bottom, y0 };
}

function buildAnnex(B, annex, terrain, camp) {
  const A = CAMPAIGN_PARTS.annex;
  const map = B.map, rng = B.rng;
  // the void between the arenas is a dark rooftop-city slab
  B.box('asphalt', 0, annex.y0 - 200, B.W, B.H);
  const heights = A.heights;
  const wall = A.wall;

  // ---- helpers over an arena rect ------------------------------------------------------
  const ring = (r, top) => {
    const x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
    B.ob('iwall', (x0 + x1) / 2, y0 + wall / 2, r.w, wall, 0, { top });
    B.ob('iwall', (x0 + x1) / 2, y1 - wall / 2, r.w, wall, 0, { top });
    B.ob('iwall', x0 + wall / 2, (y0 + y1) / 2, wall, r.h - 2 * wall, 0, { top });
    B.ob('iwall', x1 - wall / 2, (y0 + y1) / 2, wall, r.h - 2 * wall, 0, { top });
  };
  const plateau = (r, h) => {
    if (h > 0) terrain.plateaus.push({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h, h, edge: PLATEAU_EDGE });
  };
  const light = (x, y, r, color, flicker, h) => B.light(x, y, r, color, flicker, h);

  // ---- floor 1: the lobby ----------------------------------------------------------------
  const floors = [];
  {
    const r = annex.floors[0], base = heights.lobby, ceil = A.ceil.lobby;
    const X = (u) => r.x + u, Y = (v) => r.y + v;
    ring(r, ceil);
    plateau(r, base);
    B.area('concrete', r.x + r.w / 2, r.y + r.h / 2, r.w, r.h, 0);
    B.area('asphalt', r.x + 170, r.y + r.h / 2, 300, 240, 0);           // entrance mat
    for (const u of [260, 500, 740]) for (const v of [176, 448]) B.ob('ipillar', X(u), Y(v), 38, 38, 0, { top: ceil });
    B.ob('counter', X(400), Y(340), 190, 42, 0);
    B.ob('counter', X(600), Y(268), 76, 30, 0);
    B.ob('counter', X(600), Y(410), 76, 30, 0);
    for (const [u, v] of [[230, 100], [230, 580], [760, 110], [760, 570]]) B.ob('desk', X(u), Y(v), 96, 30, 0);
    B.ob('cabinet', X(420), Y(60), 90, 34, 0);
    B.ob('cabinet', X(560), Y(620), 90, 34, 0);
    B.ob('stairs', X(884), Y(340), 128, 250, 0, { top: ceil - 18 });
    for (const [u, v] of [[300, 300], [700, 330]]) light(X(u), Y(v), 460, '#e6efff', 0, base + 130);
    light(X(500), Y(120), 340, '#e6efff', 0.25, base + 130);
    light(X(500), Y(560), 340, '#e6efff', 0, base + 130);
    light(X(860), Y(340), 200, '#ff5a3a', 0.45, base + 100);
    floors.push({
      id: 'lobby', name: 'Lobby', n: 1, x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h, base, ceil: A.ceil.lobby,
      arrive: slots(X(96), Y(340), 6, 0, 44),
      stairs: { x: X(778), y: Y(340), r: 84, a: 0 },
      spawns: [rect(X(250), Y(56), 92, 46), rect(X(700), Y(56), 92, 46), rect(X(250), Y(624), 92, 46), rect(X(700), Y(624), 92, 46), rect(X(910), Y(130), 46, 90)],
      supply: { x: X(100), y: Y(570) },
      doors: [door(X(250), Y(30), 0, 90), door(X(700), Y(30), 0, 90), door(X(250), Y(650), Math.PI, 90), door(X(700), Y(650), Math.PI, 90)],
    });
  }
  // ---- floor 2: the offices -----------------------------------------------------------------
  {
    const r = annex.floors[1], base = heights.offices, ceil = A.ceil.offices;
    const X = (u) => r.x + u, Y = (v) => r.y + v;
    ring(r, ceil);
    plateau(r, base);
    B.area('concrete', r.x + r.w / 2, r.y + r.h / 2, r.w, r.h, 0);
    // cubicle blocks: two desks and a partition
    let n = 0;
    for (const u of [260, 490, 720]) {
      for (const v of [170, 460]) {
        B.ob('desk', X(u - 24), Y(v - 40), 76, 34, 0);
        B.ob('desk', X(u + 24), Y(v + 40), 76, 34, 0);
        B.ob('cabinet', X(u), Y(v), 118, 16, 0);
        if (n++ % 2 === 0) B.ob('cabinet', X(u + 72), Y(v), 16, 96, 0);
      }
    }
    // a meeting room in the corner (glass wall, one door) and the server closet
    B.ob('iwall', X(130), Y(170), 240, 16, 0, { top: 110 });
    B.ob('iwall', X(250), Y(112), 16, 120, 0, { top: 110 });
    B.ob('desk', X(122), Y(96), 110, 50, 0);
    B.ob('cabinet', X(880), Y(90), 60, 120, 0);
    B.ob('cabinet', X(880), Y(560), 60, 90, 0);
    B.ob('stairs', X(884), Y(330), 128, 200, 0, { top: ceil - 18 });
    for (const [u, v] of [[250, 250], [500, 330], [760, 250], [420, 560]]) light(X(u), Y(v), 400, '#e6efff', u === 500 ? 0.3 : 0, base + 130);
    light(X(880), Y(330), 200, '#ff5a3a', 0.45, base + 100);
    floors.push({
      id: 'offices', name: 'Offices', n: 2, x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h, base, ceil: A.ceil.offices,
      arrive: slots(X(70), Y(400), 6, 0, 44),
      stairs: { x: X(776), y: Y(330), r: 84, a: 0 },
      spawns: [rect(X(340), Y(56), 100, 46), rect(X(650), Y(56), 100, 46), rect(X(340), Y(624), 100, 46), rect(X(650), Y(624), 100, 46), rect(X(230), Y(340), 60, 60)],
      supply: { x: X(110), y: Y(590) },
      doors: [door(X(340), Y(30), 0, 90), door(X(650), Y(30), 0, 90), door(X(340), Y(650), Math.PI, 90), door(X(650), Y(650), Math.PI, 90)],
    });
  }
  // ---- floor 3: the atrium -------------------------------------------------------------------
  {
    const r = annex.floors[2], base = heights.atrium, ceil = A.ceil.atrium;
    const X = (u) => r.x + u, Y = (v) => r.y + v;
    ring(r, ceil);
    plateau(r, base);
    B.area('concrete', r.x + r.w / 2, r.y + r.h / 2, r.w, r.h, 0);
    B.area('concrete', X(500), Y(340), 330, 330, Math.PI / 4);
    const cxA = X(500), cyA = Y(345);
    for (let k = 0; k < 8; k++) {
      const [x, y] = polar(cxA, cyA, 214, k * TAU / 8 + TAU / 16);
      B.ob('ipillar', x, y, 40, 40, 0, { top: ceil });
    }
    B.ob('counter', cxA, cyA, 118, 118, Math.PI / 4);          // the atrium planter
    for (let k = 0; k < 4; k++) {
      const [x, y] = polar(cxA, cyA, 132, k * TAU / 4);
      B.ob('desk', x, y, 84, 28, k * TAU / 4 + Math.PI / 2);
    }
    for (const [u, v] of [[200, 130], [200, 550], [800, 130], [800, 550]]) B.ob('cabinet', X(u), Y(v), 70, 34, 0);
    B.ob('stairs', X(500), Y(74), 92, 260, -Math.PI / 2, { top: ceil - 30 });
    for (const [u, v] of [[500, 345], [250, 200], [750, 500]]) light(X(u), Y(v), 520, '#f0f6ff', 0, base + 150);
    light(X(500), Y(110), 220, '#ff5a3a', 0.45, base + 100);
    floors.push({
      id: 'atrium', name: 'Atrium', n: 3, x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h, base, ceil: A.ceil.atrium,
      arrive: slots(X(90), Y(500), 6, 0, -44),
      stairs: { x: X(500), y: Y(156), r: 84, a: -Math.PI / 2 },
      spawns: [rect(X(120), Y(60), 92, 46), rect(X(880), Y(60), 92, 46), rect(X(880), Y(624), 92, 46), rect(X(500), Y(628), 120, 46), rect(X(880), Y(340), 56, 100)],
      supply: { x: X(110), y: Y(620) },
      doors: [door(X(120), Y(30), 0, 90), door(X(880), Y(30), 0, 90), door(X(880), Y(650), Math.PI, 90), door(X(500), Y(650), Math.PI, 110)],
      skylight: { x: cxA, y: cyA, r: 200 },
    });
  }
  camp.floors = floors;

  // ---- the roof --------------------------------------------------------------------------------
  {
    const r = annex.roof, base = heights.roof;
    const X = (u) => r.x + u, Y = (v) => r.y + v;
    plateau(r, base);
    B.area('asphalt', r.x + r.w / 2, r.y + r.h / 2, r.w, r.h, 0);
    const cxR = X(r.w / 2 + 40), cyR = Y(r.h / 2);
    // parapet ring (climbable ledge) and the rim wall behind it that keeps everyone up here
    const t = 26, rim = 30;
    const x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
    B.ob('parapet', (x0 + x1) / 2, y0 + t / 2, r.w, t, 0);
    B.ob('parapet', (x0 + x1) / 2, y1 - t / 2, r.w, t, 0);
    B.ob('parapet', x0 + t / 2, (y0 + y1) / 2, t, r.h - 2 * t, 0);
    B.ob('parapet', x1 - t / 2, (y0 + y1) / 2, t, r.h - 2 * t, 0);
    B.ob('rim', (x0 + x1) / 2, y0 - rim / 2, r.w + 2 * rim, rim, 0);
    B.ob('rim', (x0 + x1) / 2, y1 + rim / 2, r.w + 2 * rim, rim, 0);
    B.ob('rim', x0 - rim / 2, (y0 + y1) / 2, rim, r.h, 0);
    B.ob('rim', x1 + rim / 2, (y0 + y1) / 2, rim, r.h, 0);
    // stair housing on the west side, the door zombies pour from
    B.ob('building', X(96), Y(r.h / 2), 150, 210, 0, { color: '#8a877e', roof: '#5a5650', top: 112 });
    // helipad markings
    const hp = { x: cxR, y: cyR, r: 168 };
    for (const [ux, uy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const c = [hp.x + ux * hp.r * 0.72, hp.y + uy * hp.r * 0.72];
      B.line('yellow', c[0], c[1], c[0] - ux * 60, c[1], 5);
      B.line('yellow', c[0], c[1], c[0], c[1] - uy * 60, 5);
    }
    B.line('white', hp.x - 44, hp.y - 60, hp.x - 44, hp.y + 60, 14);
    B.line('white', hp.x + 44, hp.y - 60, hp.x + 44, hp.y + 60, 14);
    B.line('white', hp.x - 44, hp.y, hp.x + 44, hp.y, 14);
    // roof plant
    for (const [u, v, w, h] of [[330, 130, 90, 62], [470, 118, 70, 54], [860, 140, 96, 64], [1000, 120, 70, 54],
      [340, 720, 96, 64], [520, 736, 70, 54], [880, 724, 90, 62], [1040, 730, 70, 54], [560, 400, 80, 56], [560, 470, 80, 56]]) {
      B.ob('hvac', X(u), Y(v), w, h, rng.range(-0.06, 0.06));
    }
    B.ob('mast', X(1180), Y(150), 26, 26, 0, { top: 300 });
    B.ob('cabinet', X(1180), Y(380), 80, 40, 0);
    B.ob('cabinet', X(1170), Y(520), 80, 40, 0.1);
    B.ob('sandbags', X(440), Y(400), 80, 24, Math.PI / 2, { color: '#8a7a55' });
    B.ob('sandbags', X(440), Y(470), 80, 24, Math.PI / 2, { color: '#8a7a55' });
    B.ob('barrier', X(880), Y(300), 70, 20, 0.4);
    B.ob('barrier', X(880), Y(560), 70, 20, -0.4);
    // the zip-line gantry on the south edge: two posts and a crossbeam
    const zx = cxR, zy = y1 - 80;
    B.ob('mast', zx - 46, zy, 22, 22, 0, { top: 168 });
    B.ob('mast', zx + 46, zy, 22, 22, 0, { top: 168 });
    for (const [u, v] of [[-1, 0], [1, 0]]) light(zx + u * 46, zy - 6, 200, '#7dffb0', 0.15, base + 180);
    light(cxR, cyR, 720, '#ffffff', 0, base + 260);
    light(X(96), Y(r.h / 2), 260, '#ff5a3a', 0.5, base + 120);
    camp.roof = {
      id: 'roof', name: 'Rooftop', n: 4, x0: r.x, y0: r.y, x1: x1, y1: y1, base, ceil: 0,
      arrive: slots(X(280), Y(r.h / 2 + 10), 6, 0, 44),
      spawns: [rect(X(200), Y(r.h / 2), 60, 110), rect(X(380), Y(50), 220, 40), rect(X(920), Y(50), 220, 40), rect(X(380), Y(r.h - 50), 220, 40),
        rect(X(920), Y(r.h - 50), 220, 40), rect(X(r.w - 50), Y(r.h / 2), 40, 260), rect(X(700), Y(50), 160, 40)],
      supply: { x: X(330), y: Y(r.h / 2 + 200) },
      doors: [door(X(196), Y(r.h / 2), 0, 110)],
      pad: hp,
      zip: { x: zx, y: zy, z: base + 168, ix: zx, iy: zy - 76, r: 100 },
      quota: 0,
    };
    // the landing pad at the end of the cable, south of the roof
    const l = annex.landing;
    const lx = l.x + l.w / 2, ly = l.y + l.h / 2;
    plateau(l, heights.landing);
    B.area('concrete', lx, ly, l.w, l.h, 0);
    const tl = 22, lr = 30;
    B.ob('parapet', lx, l.y + tl / 2, l.w, tl, 0);
    B.ob('parapet', lx, l.y + l.h - tl / 2, l.w, tl, 0);
    B.ob('parapet', l.x + tl / 2, ly, tl, l.h - 2 * tl, 0);
    B.ob('parapet', l.x + l.w - tl / 2, ly, tl, l.h - 2 * tl, 0);
    B.ob('rim', lx, l.y - lr / 2, l.w + 2 * lr, lr, 0);
    B.ob('rim', lx, l.y + l.h + lr / 2, l.w + 2 * lr, lr, 0);
    B.ob('rim', l.x - lr / 2, ly, lr, l.h, 0);
    B.ob('rim', l.x + l.w + lr / 2, ly, lr, l.h, 0);
    B.ob('mast', lx - 40, l.y + 60, 24, 24, 0, { top: 150 });
    B.ob('mast', lx + 40, l.y + 60, 24, 24, 0, { top: 150 });
    B.ob('hvac', l.x + 70, l.y + l.h - 70, 70, 54, 0);
    light(lx, ly, 460, '#ffffff', 0, heights.landing + 180);
    camp.landing = {
      id: 'landing', x0: l.x, y0: l.y, x1: l.x + l.w, y1: l.y + l.h, base: heights.landing,
      x: lx, y: ly, slots: slots(lx, ly + 60, 6, 40, 0),
      end: { x: lx, y: l.y + 60, z: heights.landing + 150 },
    };
  }
}

function rect(x, y, w, h) {
  return { x: round1(x), y: round1(y), w, h };
}

function door(x, y, a, w) {
  return { x: round1(x), y: round1(y), a, w };
}

/** n slots in a row starting at (x, y), stepping (dx, dy); a second row when there are many. */
function slots(x, y, n, dx, dy) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = i - (n - 1) / 2;
    out.push({ x: round1(x + (dx ? k * dx : (i % 2) * 44)), y: round1(y + (dy ? k * dy : k * 0)) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// The distant skyline (3D only, no collision): blocks outside the playable world

function buildSkyline(B, site, annex, camp) {
  const rng = B.rng;
  const W = B.W, H = B.H;
  const sky = camp.skyline;
  const ring = (x0, y0, x1, y1, n, depth, hMin, hMax) => {
    for (let i = 0; i < n; i++) {
      const t = (i + rng.range(0.1, 0.9)) / n;
      const px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
      const w = rng.range(120, 300), d = rng.range(120, 260), h = rng.range(hMin, hMax);
      sky.push({ x: Math.round(px), y: Math.round(py), w: Math.round(w), d: Math.round(d), h: Math.round(h), s: Math.floor(rng.range(0, 1e6)) });
    }
  };
  const o = 520;
  ring(-o, -o, W + o, -o, 26, o, 120, 520);
  ring(-o, H + o, W + o, H + o, 26, o, 160, 620);
  ring(-o, -o, -o, H + o, 26, o, 120, 520);
  ring(W + o, -o, W + o, H + o, 26, o, 120, 520);
  // a second, denser row a little farther out
  ring(-o - 420, -o - 420, W + o + 420, -o - 420, 22, o, 200, 700);
  ring(-o - 420, H + o + 420, W + o + 420, H + o + 420, 22, o, 260, 760);
  ring(-o - 420, -o - 420, -o - 420, H + o + 420, 22, o, 200, 700);
  ring(W + o + 420, -o - 420, W + o + 420, H + o + 420, 22, o, 200, 700);
}
