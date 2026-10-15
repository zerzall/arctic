// Set dressing of the maps (client-side only): a deterministic list of props laid on top of
// a finished MapDef — road debris, abandoned belongings, street furniture, industrial
// clutter, signs of the apocalypse, nature and the anchors of the small animated life.
//
// It is a pure function of the MapDef (which every peer builds identically from (id, seed))
// so it costs nothing on the wire, is never part of the simulation (nothing here collides,
// blocks a shot or a spawn) and is only ever read by the 3D world (render3d/world-dress.js)
// and, for the flat marks, the top-down renderer. Every item keeps its own rank `q` in
// [0, 1): a quality tier shows the items with q < DRESS_DENSITY[tier], so the thinned sets
// are nested and the same props stay in the same places on every tier.
//
//   buildDress(map) → Item[]      Item = { k, x, y, a, s, v, q, w?, x2?, y2?, g? }
//   k kind (DRESS_KINDS), (x, y) position, a facing (sim angle; local +x of the model),
//   s scale, v variant seed, w length (fences, tape, wires), g group id
//
// Rules the placement obeys (tests/dress.test.js): nothing inside an obstacle (flat marks
// may pass under a vehicle), water, the objective, the supply station, a player or zombie
// spawn or a campaign annex floor; nothing tall under a viaduct deck; inside the map.

import { createRng, hashString } from './rng.js';
import { hideoutDressItems } from './maps-hideouts.js';
import { sandstoneDressItems } from './maps-sandstone.js';

/** Items shown per quality tier (fraction of the ranks). */
export const DRESS_DENSITY = Object.freeze({ cinematic: 1, ultra: 1, high: 0.6, low: 0.25 });

/** Density of a tier name (unknown names count as 'high'). */
export function dressDensity(tier) {
  return DRESS_DENSITY[tier] ?? DRESS_DENSITY.high;
}

/**
 * Prop kinds: [footprint radius, height, flags] in world units (1 unit ≈ 3 cm).
 * Flags: f = flat mark on the ground (may lie under a vehicle), w = attached to a wall or
 * post (no obstacle test), l = a line (fence, tape, wire: `w` long), t = tall (kept out from
 * under viaduct decks).
 */
export const DRESS_KINDS = Object.freeze({
  // flat marks
  skid: [60, 0, 'f'], tread: [50, 0, 'f'], puddle: [28, 0, 'f'], mud: [26, 0, 'f'], stain: [22, 0, 'f'],
  soot: [24, 0, 'f'], leaves: [26, 0, 'f'], paperf: [22, 0, 'f'], chalk: [44, 0, 'f'], glassf: [16, 0, 'f'], blood: [22, 0, 'f'],
  // road debris
  suitcase: [14, 10], duffel: [14, 10], backpack: [9, 10], shoe: [6, 4], shoes: [8, 4], car_door: [26, 26],
  box: [12, 14], box_stack: [20, 28], box_open: [14, 14], bag: [6, 6], newsp: [10, 2], cone_dn: [8, 6], cone_up: [7, 20],
  triangle: [10, 14], flare: [6, 4], litter: [11, 6], fuel_can: [6, 14], hubcap: [7, 3], bumper: [30, 8], panel: [24, 4],
  clothes: [14, 5], teddy: [6, 10], toy: [6, 6], spill: [38, 16], wheel_loose: [9, 8],
  // abandoned belongings
  stroller: [14, 26], bicycle: [18, 22], cart: [16, 28], picnic: [36, 24], tent_camp: [28, 32], chair: [10, 20],
  sleeping_bag: [14, 4], cooler: [9, 10], grill: [12, 26], gnome: [4, 10], campfire: [14, 8], laundry: [46, 34],
  umbrella: [24, 44], wheelchair: [12, 26], gurney: [26, 18], beachball: [7, 14], scarecrow: [10, 66],
  // street furniture
  bench: [28, 16], busstop: [52, 74], mailbox: [6, 36], postbox: [7, 42], phone: [9, 80], bin: [8, 28], bin_fall: [12, 12],
  meter: [4, 38], hydrant: [5, 24], vend: [11, 62], newsbox: [6, 30], billboard: [120, 330, 't'], rsign: [8, 84],
  barrel_t: [6, 26], fence_cl: [6, 40, 'l'], fence_pk: [6, 30, 'l'], bollard: [4, 18], bikerack: [16, 14], planter: [14, 14],
  flagpole: [6, 180, 't'], pole: [8, 300, 't'], wire: [0, 0, 'l'], lamp_old: [6, 150], atm: [10, 64],
  // industrial and farm
  pallet: [18, 10], pallets: [18, 34], crate: [14, 16], crates: [26, 30], drum: [8, 20], drums: [22, 20], pipes: [32, 22],
  generator: [18, 26], forklift: [32, 52], hay: [22, 24], hay_sq: [16, 18], tractor: [42, 52], watertower: [60, 320, 't'],
  reel: [14, 16], woodpile: [26, 26], wheelbarrow: [14, 12], gascyl: [5, 20], ibc: [16, 30], trough: [30, 14],
  // signs of the apocalypse
  barricade: [42, 44], plywood: [14, 40], board_door: [18, 40, 'w'], graf: [16, 0, 'w'], poster: [6, 0, 'w'], wposter: [10, 0, 'w'], bodybag: [14, 4],
  helmet: [5, 5], milcrate: [14, 14], mil_box: [8, 8], sandarc: [30, 16], tarp: [32, 20], medtent: [70, 62], tape: [4, 30, 'l'],
  banner: [4, 220, 'lt'], shrine: [20, 22], cross: [8, 44], sawhorse: [26, 32],
  // nature
  log: [32, 14], boulders: [34, 26], shrub: [16, 18], flowers: [14, 12], reeds: [14, 44], deadtree: [20, 170, 't'],
  tallgrass: [16, 18], mushrooms: [7, 6], stump: [10, 12], fern: [13, 12], pebbles: [9, 3], driftwood: [34, 10],
  lily: [12, 0, 'f'], rowboat: [52, 22], cactus: [12, 80], tumbleweed: [10, 14], bones: [10, 4],
  // animated life anchors (world-dress.js): perches for crows, flower beds for butterflies
  perch: [1, 0, 'w'],
});

const FLAG = (k) => DRESS_KINDS[k][2] || '';

/** Solid-looking props: kept off the open ground near the action, where nothing would stop a player walking through them. */
const BULKY = new Set(['barricade', 'medtent', 'tent_camp', 'picnic', 'crates', 'pallets', 'drums', 'generator', 'forklift', 'tractor', 'hay', 'ibc',
  'billboard', 'busstop', 'phone', 'vend', 'boulders', 'deadtree', 'watertower', 'woodpile', 'pipes', 'rowboat', 'cart']);

const VEHICLE = new Set(['car', 'suv', 'pickup', 'van', 'truck', 'semi', 'bus', 'tanker']);
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------

/** Distance from a point to an oriented rectangle (0 inside). */
function distToRect(o, x, y) {
  const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0);
  const dx = x - o.x, dy = y - o.y;
  const lx = Math.abs(dx * c + dy * s) - o.w / 2, ly = Math.abs(-dx * s + dy * c) - o.h / 2;
  return Math.hypot(Math.max(lx, 0), Math.max(ly, 0)) + Math.min(0, Math.max(lx, ly));
}

function inRect(o, x, y, pad = 0) {
  const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0);
  const dx = x - o.x, dy = y - o.y;
  return Math.abs(dx * c + dy * s) <= o.w / 2 + pad && Math.abs(-dx * s + dy * c) <= o.h / 2 + pad;
}

function makeGrid(cell) {
  const m = new Map();
  return {
    cell,
    add(x0, y0, x1, y1, v) {
      for (let gy = Math.floor(y0 / cell); gy <= Math.floor(y1 / cell); gy++) {
        for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++) {
          const k = gy * 8192 + gx;
          const l = m.get(k);
          if (l) l.push(v); else m.set(k, [v]);
        }
      }
    },
    near(x, y, r) {
      const out = [];
      for (let gy = Math.floor((y - r) / cell); gy <= Math.floor((y + r) / cell); gy++) {
        for (let gx = Math.floor((x - r) / cell); gx <= Math.floor((x + r) / cell); gx++) {
          const l = m.get(gy * 8192 + gx);
          if (l) for (const v of l) out.push(v);
        }
      }
      return out;
    },
  };
}

/** Build the set dressing of a map. Deterministic for the MapDef. */
const CACHE = new WeakMap();

/** Build the set dressing of a map (memoised per MapDef object: the 3D world and the classic view share it). */
export function buildDress(map0) {
  let items = CACHE.get(map0);
  if (!items) { items = placeDress(map0); CACHE.set(map0, items); }
  return items;
}

function placeDress(map0) {
  // a story hideout is dressed by hand (maps-hideouts.js), not with road debris
  if (map0.kind === 'hideout' && map0.hub) return hideoutDressItems(map0);
  // ... and so is the desert town of Horde Elimination (maps-sandstone.js)
  if (map0.id === 'sandstone' && map0.horde) return sandstoneDressItems(map0);
  // (a partial MapDef, like the renderer tests' fixtures, is dressed too: missing lists count as empty)
  const map = { id: 'map', seed: 0, width: 3000, height: 2000, areas: [], lines: [], obstacles: [], decor: [], lights: [], pois: [], playerSpawns: [], zombieSpawns: [], overpass: null, ...map0 };
  const W = map.width, H = map.height;
  const tag = `${map.id}:${map.campaign ? 'c' : 'd'}:${map.seed}:${W}x${H}`;
  const R = (name) => createRng(hashString(`dress:${name}:${tag}`));
  const items = [];
  const obstacles = map.obstacles;

  // ---- spatial indices --------------------------------------------------------------------
  const og = makeGrid(160);
  for (const o of obstacles) {
    const c = Math.abs(Math.cos(o.a || 0)), s = Math.abs(Math.sin(o.a || 0));
    const ex = (o.w * c + o.h * s) / 2, ey = (o.w * s + o.h * c) / 2;
    og.add(o.x - ex, o.y - ey, o.x + ex, o.y + ey, o);
  }
  const ag = makeGrid(256);
  map.areas.forEach((a, i) => {
    const c = Math.abs(Math.cos(a.a || 0)), s = Math.abs(Math.sin(a.a || 0));
    const ex = (a.w * c + a.h * s) / 2, ey = (a.w * s + a.h * c) / 2;
    ag.add(a.x - ex, a.y - ey, a.x + ex, a.y + ey, i);
  });
  const surf = (x, y) => {
    let best = -1;
    for (const i of ag.near(x, y, 0)) if (i > best && inRect(map.areas[i], x, y)) best = i;
    return best < 0 ? 'ground' : map.areas[best].kind;
  };
  const waters = map.areas.filter((a) => a.kind === 'water');
  const inWater = (x, y, pad) => waters.some((w) => inRect(w, x, y, pad));

  // keep-outs: spawns, objective, supply, campaign annex (interior floors)
  const keepC = [];   // circles [x, y, r]
  const keepR = [];   // oriented rects
  for (const p of map.playerSpawns) keepC.push([p.x, p.y, 80]);
  if (map.supply) keepC.push([map.supply.x, map.supply.y, 120]);
  if (map.objective) keepR.push({ ...map.objective, pad: 70 });
  for (const z of map.zombieSpawns) keepR.push({ x: z.x, y: z.y, w: z.w, h: z.h, a: 0, pad: 60 });
  const annex = [];
  const cp = map.campaign;
  if (cp) {
    for (const p of cp.hill.spawns) keepC.push([p.x, p.y, 70]);
    keepC.push([cp.hill.x, cp.hill.y, 120]);
    keepC.push([cp.entrance.x, cp.entrance.y, cp.entrance.r + 40]);
    for (const f of cp.floors) {
      annex.push({ x0: f.x0 - 60, y0: f.y0 - 60, x1: f.x1 + 60, y1: f.y1 + 60 });
      for (const s of f.spawns) keepR.push({ x: s.x, y: s.y, w: s.w, h: s.h, a: 0, pad: 50 });
    }
    const rf = cp.roof, ld = cp.landing;
    annex.push({ x0: rf.x0 - 60, y0: rf.y0 - 60, x1: rf.x1 + 60, y1: rf.y1 + 60 });
    annex.push({ x0: ld.x0 - 60, y0: ld.y0 - 60, x1: ld.x1 + 60, y1: ld.y1 + 60 });
    for (const s of rf.spawns) keepR.push({ x: s.x, y: s.y, w: s.w, h: s.h, a: 0, pad: 50 });
  }
  const keeps = (x, y, r) => {
    for (const [cx, cy, cr] of keepC) if (Math.hypot(x - cx, y - cy) < cr + r) return true;
    for (const k of keepR) if (inRect(k, x, y, k.pad + r)) return true;
    for (const a of annex) if (x > a.x0 - r && x < a.x1 + r && y > a.y0 - r && y < a.y1 + r) return true;
    return false;
  };
  // the viaduct decks (tall props keep out from under them)
  const decks = (map.overpass ? map.overpass.decks : []).filter((d) => d.kind === 'viaduct');
  const underDeck = (x, y) => {
    for (const d of decks) {
      for (let i = 0; i + 1 < d.pts.length; i++) {
        const [x1, y1] = d.pts[i], [x2, y2] = d.pts[i + 1];
        const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / l2));
        if (Math.hypot(x - (x1 + dx * t), y - (y1 + dy * t)) < d.w / 2 + 30) return true;
      }
    }
    return false;
  };
  const dg = makeGrid(96);   // placed items: [x, y, r]

  const hot = [];   // where the player spends time: denser dressing there
  for (const p of map.playerSpawns) hot.push([p.x, p.y, 900]);
  if (map.objective) hot.push([map.objective.x, map.objective.y, 1000]);
  if (map.supply) hot.push([map.supply.x, map.supply.y, 800]);
  for (const p of map.pois) hot.push([p.x, p.y, p.r * 1.2]);
  if (cp) hot.push([cp.hill.x, cp.hill.y, 1100]);
  const heat = (x, y) => {
    let h = 0;
    for (const [hx, hy, hr] of hot) h = Math.max(h, 1 - Math.hypot(x - hx, y - hy) / hr);
    return Math.max(0, h);
  };

  const nearSolid = (x, y, d) => {
    for (const o of og.near(x, y, d + 10)) if (distToRect(o, x, y) < d) return true;
    return false;
  };
  const inMap = (x, y, r) => x > 24 + r && y > 24 + r && x < W - 24 - r && y < H - 24 - r;

  /** Is a footprint circle free? (flat marks ignore vehicles.) */
  function free(x, y, r, flat, nogap, wet) {
    if (!inMap(x, y, Math.min(r, 30))) return false;
    if (inWater(x, y, wet ? -2 : r + 50)) return false;
    if (keeps(x, y, r)) return false;
    for (const o of og.near(x, y, r + 8)) {
      if (flat && VEHICLE.has(o.kind)) continue;
      if (distToRect(o, x, y) < r + (nogap ? 0 : 3)) return false;
    }
    return true;
  }
  function spaced(x, y, r, gid) {
    for (const p of dg.near(x, y, r + 40)) {
      if (gid !== undefined && p[3] === gid) continue;
      if (Math.hypot(p[0] - x, p[1] - y) < (p[2] + r) * 0.8) return false;
    }
    return true;
  }

  const stats = {};
  let gseq = 1;
  /**
   * Place one item (checked). o: { s, v, q (rank multiplier), w, x2, y2, g, free (skip the
   * obstacle test: attached props), soft (skip the spacing test) }
   */
  function put(rng, k, x, y, a, o = {}) {
    const def = DRESS_KINDS[k];
    if (!def) throw new Error('dress: unknown kind ' + k);
    const s = o.s ?? 1;
    const fl = def[2] || '';
    const r = def[0] * s;
    const flat = fl.includes('f');
    if (!fl.includes('l') && !o.free) {
      if (!free(x, y, r, flat, o.tight, o.wet)) return null;
    } else if (!inMap(x, y, 0) || keeps(x, y, 4) || (!o.wet && inWater(x, y, 6))) return null;
    if (fl.includes('l') && o.x2 !== undefined && k !== 'wire') {
      // a line (fence, tape, banner): every 30 units of it must be clear of spawns, water and (bar the banner overhead) obstacles
      const n = Math.max(1, Math.ceil(Math.hypot(o.x2 - x, o.y2 - y) / 30));
      for (let i = 1; i <= n; i++) {
        const px = x + ((o.x2 - x) * i) / n, py = y + ((o.y2 - y) * i) / n;
        if (!inMap(px, py, 0) || keeps(px, py, 6) || inWater(px, py, 6)) return null;
        if (k !== 'banner') for (const ob of og.near(px, py, 12)) if (distToRect(ob, px, py) < 3) return null;
      }
    }
    if (!o.soft && !flat && !fl.includes('l') && !spaced(x, y, r, o.g)) return null;
    if (fl.includes('t') && underDeck(x, y)) return null;
    // bulky, solid-looking props (nothing collides with them) stay out of the open ground where the
    // team fights: near the action they only stand up against something real
    if (BULKY.has(k) && !o.free && heat(x, y) > 0.12 && !nearSolid(x, y, 120)) return null;
    const it = { k, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, a: Math.round(a * 1000) / 1000, s: Math.round(s * 100) / 100, v: (rng.next() * 65536) | 0, q: Math.round(rng.next() * (o.q ?? 1) * 1e4) / 1e4 };
    if (o.w !== undefined) it.w = Math.round(o.w * 10) / 10;
    if (o.x2 !== undefined) { it.x2 = Math.round(o.x2 * 10) / 10; it.y2 = Math.round(o.y2 * 10) / 10; }
    if (o.g !== undefined) it.g = o.g;
    if (o.vv !== undefined) it.v = o.vv;
    items.push(it);
    if (!flat) dg.add(x - r, y - r, x + r, y + r, [x, y, r, o.g]);
    stats[k] = (stats[k] || 0) + 1;
    return it;
  }

  // ---- anchors ----------------------------------------------------------------------------
  const vehicles = obstacles.filter((o) => VEHICLE.has(o.kind));
  const cars = vehicles.filter((o) => o.kind === 'car' || o.kind === 'suv' || o.kind === 'pickup' || o.kind === 'van');
  const bigRigs = obstacles.filter((o) => o.kind === 'semi' || o.kind === 'truck' || o.kind === 'tanker' || o.kind === 'bus');
  const buildings = obstacles.filter((o) => o.kind === 'building');
  const masonry = obstacles.filter((o) => o.kind === 'wall' && o.h > 8 && o.w >= 60);
  const containers = obstacles.filter((o) => o.kind === 'container' && Math.max(o.w, o.h) > 72);
  const trees = obstacles.filter((o) => o.kind === 'tree');
  const pumps = obstacles.filter((o) => o.kind === 'pump');
  const mil = obstacles.filter((o) => o.kind === 'hesco' || o.kind === 'booth' || o.kind === 'tent' || o.kind === 'sandbags');
  const decorOf = (kind) => map.decor.filter((d) => d.kind === kind);
  const lamps = decorOf('lamp_post').map((d) => ({ x: d.x - Math.cos(d.a) * 16, y: d.y - Math.sin(d.a) * 16, a: d.a }));
  const roads = [];
  for (const a of map.areas) {
    if (a.kind !== 'asphalt') continue;
    const along = a.w >= a.h ? a.a : a.a + Math.PI / 2;
    const L = Math.max(a.w, a.h), Wd = Math.min(a.w, a.h);
    roads.push({ x: a.x, y: a.y, a: along, L, W: Wd, area: a, long: L >= 500 && Wd <= 420 });
  }
  const lots = map.areas.filter((a) => a.kind === 'concrete' && Math.min(a.w, a.h) >= 120);
  const total = (kinds) => map.areas.filter((a) => kinds.includes(a.kind)).reduce((s, a) => s + a.w * a.h, 0);
  const areaMega = (W * H) / 1e6;

  /** A random point in areas of the given kinds (weighted by size), confirmed by surf(). */
  const regionCache = new Map();
  function pointIn(rng, kinds) {
    const key = kinds.join(',');
    let reg = regionCache.get(key);
    if (!reg) {
      const l = map.areas.filter((a) => kinds.includes(a.kind));
      reg = { list: l, wsum: l.reduce((s, a) => s + a.w * a.h, 0) };
      regionCache.set(key, reg);
    }
    const { list, wsum } = reg;
    const wantGround = kinds.includes('ground');
    const groundW = wantGround ? W * H * 0.45 : 0;
    for (let t = 0; t < 6; t++) {
      let x, y;
      let pick = rng.next() * (wsum + groundW);
      if (pick >= wsum) { x = rng.range(0, W); y = rng.range(0, H); } else {
        let a = list[0];
        for (const q of list) { pick -= q.w * q.h; if (pick <= 0) { a = q; break; } }
        const lx = rng.range(-a.w / 2, a.w / 2), ly = rng.range(-a.h / 2, a.h / 2);
        const c = Math.cos(a.a || 0), s = Math.sin(a.a || 0);
        x = a.x + lx * c - ly * s; y = a.y + lx * s + ly * c;
      }
      if (kinds.includes(surf(x, y))) return [x, y];
    }
    return null;
  }
  /** Run fn at ~perM random points per million unit² of the given surfaces (denser near the action). */
  function scatter(name, perM, kinds, fn, opts = {}) {
    const rng = R(name);
    const land = kinds.reduce((s, k) => s + (k === 'ground' ? W * H * 0.45 : total([k])), 0) / 1e6;
    const n = Math.round(perM * Math.min(land, areaMega) * (opts.mul ?? 1));
    for (let i = 0; i < n; i++) {
      const p = pointIn(rng, kinds);
      if (!p) continue;
      const h = heat(p[0], p[1]);
      if (rng.next() > 0.55 + 0.45 * h) continue;
      fn(p[0], p[1], rng, h);
    }
  }
  /** Run fn(o, rng) for each anchor with probability p (a few times when `n` > 1). */
  function around(name, list, p, fn) {
    const rng = R(name);
    for (const o of list) if (rng.next() < p) fn(o, rng);
  }
  const rot = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
  const at = (o, lx, ly) => { const [dx, dy] = rot(lx, ly, o.a || 0); return [o.x + dx, o.y + dy]; };
  const pickW = (rng, table) => {
    let tot = 0;
    for (const [, w] of table) tot += w;
    let r = rng.next() * tot;
    for (const [k, w] of table) { r -= w; if (r < 0) return k; }
    return table[0][0];
  };

  // =========================================================================================
  // 1. ROAD AND PARKING DEBRIS
  // =========================================================================================
  {
    // tyre marks along the lanes and into the wrecks
    const rng = R('skid');
    for (const rd of roads) {
      const n = Math.round((rd.L * rd.W) / 1e6 * 22) + (rd.long ? 2 : 0);
      for (let i = 0; i < n; i++) {
        const lx = rng.range(-rd.L / 2, rd.L / 2), ly = rng.range(-rd.W / 2 + 12, rd.W / 2 - 12);
        const [x, y] = at(rd, lx, ly);
        if (surf(x, y) !== 'asphalt') continue;
        put(rng, rng.chance(0.75) ? 'skid' : 'tread', x, y, rd.a + (rng.chance(0.5) ? 0 : Math.PI) + rng.range(-0.12, 0.12), { s: rng.range(0.8, 1.9), q: 0.9 });
      }
    }
    // a skid mark ending at a wreck
    const rng2 = R('skid2');
    for (const v of vehicles) {
      if (!rng2.chance(0.35)) continue;
      const back = 90 + rng2.range(0, 100);
      const [x, y] = at(v, -v.w / 2 - back * 0.5, rng2.range(-8, 8));
      if (surf(x, y) === 'asphalt' || surf(x, y) === 'concrete') put(rng2, 'skid', x, y, v.a + rng2.range(-0.08, 0.08), { s: 1 + back / 120, q: 0.8 });
    }
  }
  {
    // belongings strewn around the abandoned cars, vans and buses
    const rng = R('carstuff');
    const near = (v, lo, hi) => {
      const side = rng.chance(0.5) ? 1 : -1;
      const along = rng.range(-v.w * 0.5, v.w * 0.5);
      const off = v.h / 2 + rng.range(lo, hi);
      return at(v, along, side * off);
    };
    for (const v of vehicles) {
      const isBus = v.kind === 'bus';
      if (rng.chance(isBus ? 0.9 : 0.4)) {
        const n = 1 + (rng.chance(0.45) ? 1 : 0) + (isBus ? 3 : 0);
        for (let i = 0; i < n; i++) {
          const [x, y] = near(v, 14, 46);
          const k = pickW(rng, [['suitcase', 4], ['duffel', 2], ['backpack', 2.5], ['box', 1.4], ['bag', 1.4], ['clothes', 1.5]]);
          put(rng, k, x, y, rng.range(0, TAU), { s: rng.range(0.9, 1.2), q: 0.85 });
        }
      }
      if (rng.chance(0.3)) { const [x, y] = near(v, 8, 30); put(rng, rng.chance(0.5) ? 'shoe' : 'shoes', x, y, rng.range(0, TAU), { q: 0.7 }); }
      if (rng.chance(0.09)) { const [x, y] = near(v, 24, 40); put(rng, 'car_door', x, y, v.a + rng.range(-0.5, 0.5), { q: 0.9 }); }
      if (rng.chance(0.55)) { const [x, y] = near(v, 4, 30); put(rng, 'glassf', x, y, rng.range(0, TAU), { s: rng.range(0.8, 1.6), q: 0.8 }); }
      if (rng.chance(0.14)) { const [x, y] = near(v, 8, 30); put(rng, rng.chance(0.5) ? 'hubcap' : 'wheel_loose', x, y, rng.range(0, TAU), { q: 0.6 }); }
      if (rng.chance(0.07)) { const [x, y] = near(v, 8, 40); put(rng, rng.chance(0.5) ? 'bumper' : 'panel', x, y, v.a + rng.range(-0.4, 0.4), { q: 0.6 }); }
      if (rng.chance(0.05)) { const [x, y] = near(v, 16, 34); put(rng, 'fuel_can', x, y, rng.range(0, TAU), { q: 0.6 }); }
      if (rng.chance(0.06)) { const [x, y] = near(v, 18, 40); put(rng, rng.chance(0.5) ? 'stroller' : 'teddy', x, y, rng.range(0, TAU), { q: 0.85 }); }
      if (rng.chance(0.14)) { const [x, y] = at(v, -v.w / 2 - rng.range(70, 130), rng.range(-16, 16)); put(rng, 'triangle', x, y, v.a + Math.PI + rng.range(-0.4, 0.4), { q: 0.9 }); }
      if (rng.chance(0.07)) { const [x, y] = at(v, -v.w / 2 - rng.range(40, 100), rng.range(-24, 24)); put(rng, 'flare', x, y, rng.range(0, TAU), { q: 0.95 }); }
      if (rng.chance(0.07)) { const [x, y] = near(v, 0, 20); put(rng, rng.chance(0.5) ? 'stain' : 'soot', x, y, rng.range(0, TAU), { s: rng.range(0.9, 1.6), q: 0.8 }); }
      if (rng.chance(0.06)) { const [x, y] = near(v, 14, 44); put(rng, 'blood', x, y, rng.range(0, TAU), { s: rng.range(0.8, 1.3), q: 0.7 }); }
    }
    // spilled loads behind the trucks and trailers
    const rng2 = R('spill');
    for (const v of bigRigs) {
      if (v.kind === 'bus' || !rng2.chance(0.4)) continue;
      const [x, y] = at(v, -v.w / 2 - rng2.range(30, 90), rng2.range(-v.h * 0.6, v.h * 0.6));
      put(rng2, 'spill', x, y, rng2.range(0, TAU), { s: rng2.range(0.9, 1.4), q: 0.9 });
    }
  }
  {
    const pave = ['asphalt', 'concrete'];
    const loose = ['asphalt', 'concrete', 'gravel', 'dirt', 'sand'];
    scatter('shoes', 10, pave, (x, y, rng) => { put(rng, rng.chance(0.6) ? 'shoe' : 'shoes', x, y, rng.range(0, TAU)); });
    scatter('boxes', 20, loose, (x, y, rng) => {
      const k = pickW(rng, [['box', 5], ['box_open', 2], ['box_stack', 1.2]]);
      put(rng, k, x, y, rng.range(0, TAU), { s: rng.range(0.85, 1.2) });
    });
    scatter('bags', 28, loose.concat(['grass']), (x, y, rng) => { put(rng, 'bag', x, y, rng.range(0, TAU), { s: rng.range(0.8, 1.2) }); });
    scatter('newsp', 24, loose, (x, y, rng) => { put(rng, 'newsp', x, y, rng.range(0, TAU)); });
    scatter('litter', 34, loose.concat(['grass']), (x, y, rng) => { put(rng, 'litter', x, y, rng.range(0, TAU), { s: rng.range(0.8, 1.3) }); });
    scatter('leaves', 30, ['asphalt', 'concrete', 'grass', 'dirt', 'gravel'], (x, y, rng) => { put(rng, 'leaves', x, y, rng.range(0, TAU), { s: rng.range(0.8, 1.7), q: 0.9 }); });
    scatter('paperf', 14, loose, (x, y, rng) => { put(rng, 'paperf', x, y, rng.range(0, TAU), { s: rng.range(0.8, 1.4) }); });
    scatter('puddle', 20, ['asphalt', 'concrete', 'dirt', 'gravel'], (x, y, rng) => { put(rng, 'puddle', x, y, rng.range(0, TAU), { s: rng.range(0.7, 2.4), q: 0.9 }); });
    scatter('mud', 16, ['dirt', 'ground', 'gravel', 'sand'], (x, y, rng) => { put(rng, 'mud', x, y, rng.range(0, TAU), { s: rng.range(0.8, 2.2), q: 0.9 }); });
    scatter('chalk', 1.0, ['asphalt', 'concrete'], (x, y, rng) => { put(rng, 'chalk', x, y, rng.range(0, TAU), { q: 0.5 }); });
    scatter('toys', 5, loose, (x, y, rng) => { put(rng, rng.chance(0.5) ? 'teddy' : rng.chance(0.5) ? 'toy' : 'beachball', x, y, rng.range(0, TAU)); });
    scatter('clothes', 7, loose.concat(['grass']), (x, y, rng) => { put(rng, 'clothes', x, y, rng.range(0, TAU), { s: rng.range(0.8, 1.3) }); });
    scatter('luggage', 14, pave, (x, y, rng) => {
      const g = gseq++;
      const n = 2 + rng.int(0, 2);
      for (let i = 0; i < n; i++) {
        put(rng, pickW(rng, [['suitcase', 4], ['duffel', 2], ['backpack', 2]]), x + rng.range(-30, 30), y + rng.range(-24, 24), rng.range(0, TAU), { s: rng.range(0.9, 1.2), g, q: 0.9 });
      }
    });
    // cone lines tapering into the lane
    scatter('cones', 3, ['asphalt'], (x, y, rng) => {
      const a = rng.range(0, TAU), g = gseq++;
      const n = 3 + rng.int(0, 3);
      for (let i = 0; i < n; i++) {
        const k = rng.chance(0.3) ? 'cone_dn' : 'cone_up';
        put(rng, k, x + Math.cos(a) * i * 34, y + Math.sin(a) * i * 34 + i * 6, rng.range(0, TAU), { g, q: 0.9 });
      }
    });
    scatter('barrels_t', 5, ['asphalt', 'concrete'], (x, y, rng) => { put(rng, 'barrel_t', x, y, rng.range(0, TAU), { q: 0.8 }); });
    scatter('glass', 12, pave, (x, y, rng) => { put(rng, 'glassf', x, y, rng.range(0, TAU), { s: rng.range(0.9, 1.7) }); });
  }

  // =========================================================================================
  // 2. STREET FURNITURE, SIGNS, UTILITIES
  // =========================================================================================
  {
    // signs along the roads
    const rng = R('rsigns');
    for (const rd of roads) {
      if (!rd.long) continue;
      const n = Math.round(rd.L / 620);
      for (let i = 0; i < n; i++) {
        const side = rng.chance(0.5) ? 1 : -1;
        const lx = rng.range(-rd.L / 2 + 40, rd.L / 2 - 40);
        const [x, y] = at(rd, lx, side * (rd.W / 2 + rng.range(26, 46)));
        const facing = rd.a + (side > 0 ? -Math.PI / 2 : Math.PI / 2) + rng.range(-0.15, 0.15);
        // v: the sign kind lives in the item's variant number (world-dress.js decodes it)
        put(rng, 'rsign', x, y, facing, { s: rng.range(0.95, 1.1), q: 0.85 });
      }
    }
    // utility poles with sagging wires along the long roads
    const rngP = R('poles');
    let gp = 0;
    for (const rd of roads) {
      if (!rd.long || rd.L < 900) continue;
      const side = (gp++ % 2) ? 1 : -1;
      const off = rd.W / 2 + 62;
      const step = 340;
      let prev = null;
      for (let lx = -rd.L / 2 + 120; lx < rd.L / 2 - 60; lx += step) {
        const [x, y] = at(rd, lx + rngP.range(-30, 30), side * (off + rngP.range(-8, 8)));
        const it = put(rngP, 'pole', x, y, rd.a + (side > 0 ? -Math.PI / 2 : Math.PI / 2), { q: 0.5 });
        if (it && prev && Math.hypot(it.x - prev.x, it.y - prev.y) < 460) {
          put(rngP, 'wire', prev.x, prev.y, Math.atan2(it.y - prev.y, it.x - prev.x), { w: Math.hypot(it.x - prev.x, it.y - prev.y), x2: it.x, y2: it.y, q: 0.5 });
        }
        prev = it;
      }
    }
    // billboards
    const rngB = R('billboards');
    for (const rd of roads) {
      if (!rd.long || rd.L < 1400) continue;
      const n = Math.max(1, Math.round(rd.L / 2600));
      for (let i = 0; i < n; i++) {
        const side = rngB.chance(0.5) ? 1 : -1;
        const [x, y] = at(rd, rngB.range(-rd.L / 2 + 300, rd.L / 2 - 300), side * (rd.W / 2 + rngB.range(150, 260)));
        put(rngB, 'billboard', x, y, rd.a + (side > 0 ? -Math.PI / 2 : Math.PI / 2), { q: 0.55 });
      }
    }
    // bus stops, benches, mailboxes, hydrants, meters along the roads and at the buildings
    const rngS = R('street');
    for (const rd of roads) {
      if (rd.L < 260) continue;
      const side = rngS.chance(0.5) ? 1 : -1;
      if (rd.long && rngS.chance(0.7)) {
        const n = Math.max(1, Math.round(rd.L / 2200));
        for (let i = 0; i < n; i++) {
          const [x, y] = at(rd, rngS.range(-rd.L * 0.4, rd.L * 0.4), side * (rd.W / 2 + 60));
          const it = put(rngS, 'busstop', x, y, rd.a + (side > 0 ? Math.PI / 2 : -Math.PI / 2), { q: 0.8 });
          if (it) {
            const g = gseq++;
            const [bx, by] = at(rd, (it.x - rd.x) * Math.cos(-rd.a) - (it.y - rd.y) * Math.sin(-rd.a) + 74, side * (rd.W / 2 + 60));
            put(rngS, 'bin', bx, by, rd.a, { g, q: 0.8 });
          }
        }
      }
      const nm = Math.round(rd.L / 500);
      for (let i = 0; i < nm; i++) {
        const sd = rngS.chance(0.5) ? 1 : -1;
        const [x, y] = at(rd, rngS.range(-rd.L / 2 + 30, rd.L / 2 - 30), sd * (rd.W / 2 + rngS.range(22, 40)));
        const facing = rd.a + (sd > 0 ? -Math.PI / 2 : Math.PI / 2);
        const k = pickW(rngS, [['hydrant', 2], ['mailbox', 2], ['postbox', 0.7], ['bin', 1.6], ['newsbox', 1], ['bollard', 0.8], ['barrel_t', 0.8]]);
        put(rngS, k, x, y, facing, { q: 0.8 });
      }
    }
    // furniture at the buildings' fronts
    const rngF = R('bfront');
    for (const b of buildings) {
      const n = 1 + rngF.int(0, 3);
      for (let i = 0; i < n; i++) {
        const side = rngF.int(0, 3);
        const lenSide = side < 2 ? b.w : b.h;
        const t = rngF.range(-lenSide * 0.42, lenSide * 0.42);
        const k = pickW(rngF, [['bench', 2], ['bin', 2.2], ['bin_fall', 0.8], ['vend', 1.6], ['newsbox', 1.1], ['phone', 1], ['bikerack', 1], ['planter', 1.2], ['mailbox', 1], ['gnome', 0.6], ['atm', 0.4], ['bicycle', 1.2], ['cart', 0.8], ['box_stack', 0.8], ['wheelchair', 0.3]]);
        const out = DRESS_KINDS[k][0] + 3 + rngF.range(0, 12);
        const ln = side === 0 ? [t, b.h / 2 + out] : side === 1 ? [t, -b.h / 2 - out] : side === 2 ? [b.w / 2 + out, t] : [-b.w / 2 - out, t];
        const nrm = side === 0 ? Math.PI / 2 : side === 1 ? -Math.PI / 2 : side === 2 ? 0 : Math.PI;
        const [x, y] = at(b, ln[0], ln[1]);
        put(rngF, k, x, y, b.a + nrm + rngF.range(-0.2, 0.2), { q: 0.85 });
      }
      // apocalypse at the doors: boards, messages, leaning plywood
      const a1 = R('bplywood' + b.id);
      if (a1.chance(0.55)) {
        const [x, y] = at(b, a1.range(-b.w * 0.4, b.w * 0.4), b.h / 2 + 15);
        put(a1, 'plywood', x, y, b.a + Math.PI / 2, { q: 0.7, tight: true });
      }
      if (a1.chance(0.5)) {
        const [x, y] = at(b, a1.range(-b.w * 0.4, b.w * 0.4), -b.h / 2 - 15);
        put(a1, 'plywood', x, y, b.a - Math.PI / 2, { q: 0.7, tight: true });
      }
      if (a1.chance(0.55)) {
        // planks across the front door (front = local +y side, the door in the middle)
        const n2 = Math.max(1, Math.floor((b.w - 20) / 34));
        const step = (b.w - 20) / n2;
        const tdoor = -b.w / 2 + 10 + (Math.floor(n2 / 2) + 0.5) * step;
        const [x, y] = at(b, tdoor, b.h / 2 + 2);
        put(a1, 'board_door', x, y, b.a + Math.PI / 2, { free: true, q: 0.8 });
      }
      if (a1.chance(0.4)) {
        const [x, y] = at(b, a1.range(-b.w * 0.35, b.w * 0.35), b.h / 2 + 16);
        put(a1, 'graf', x, y, b.a + Math.PI / 2, { free: true, q: 0.8, vv: a1.int(0, 5) });
      }
      // missing-person posters and notices pasted by the door
      if (a1.chance(0.6)) {
        for (let k = 0; k < 1 + a1.int(0, 2); k++) {
          const [x, y] = at(b, a1.range(-b.w * 0.42, b.w * 0.42), b.h / 2 + 0.9);
          put(a1, 'wposter', x, y, b.a + Math.PI / 2, { free: true, q: 0.7, soft: true });
        }
      }
    }
    // fences and walls carry graffiti and posters
    const rngG = R('graf');
    for (const m of masonry.concat(containers)) {
      if (!rngG.chance(0.6)) continue;
      const sd = rngG.chance(0.5) ? 1 : -1;
      const [x, y] = at(m, rngG.range(-m.w * 0.3, m.w * 0.3), sd * (m.h / 2 + 1.2));
      put(rngG, 'graf', x, y, m.a + (sd > 0 ? Math.PI / 2 : -Math.PI / 2), { free: true, q: 0.7, vv: rngG.int(0, 5) });
    }
    // posters on the lamp posts and poles
    const rngPo = R('posters');
    for (const l of lamps) {
      if (rngPo.chance(0.28)) put(rngPo, 'poster', l.x, l.y, rngPo.range(0, TAU), { free: true, q: 0.6, soft: true });
    }
    // chain link and picket fences around the yards (buildings that are houses)
    const rngY = R('yards');
    for (const b of buildings) {
      if (Math.max(b.w, b.h) >= 190 || !rngY.chance(0.65)) continue;
      const pk = rngY.chance(0.5) ? 'fence_pk' : 'fence_cl';
      const gap = 70 + rngY.range(0, 30);
      const c = (lx, ly) => at(b, lx, ly);
      const hw = b.w / 2 + gap, hh = b.h / 2 + gap;
      // three sides fenced (the front, +y side, has the gate opening in the middle)
      const segs = [
        [c(-hw, -hh), c(hw, -hh)],
        [c(hw, -hh), c(hw, hh)],
        [c(-hw, hh), c(-hw, -hh)],
        [c(-hw, hh), c(-hw * 0.25, hh)],
        [c(hw * 0.25, hh), c(hw, hh)],
      ];
      segs.forEach(([p, q], i) => {
        if (i === 2 && rngY.chance(0.3)) return;
        put(rngY, pk, p[0], p[1], Math.atan2(q[1] - p[1], q[0] - p[0]), { w: Math.hypot(q[0] - p[0], q[1] - p[1]), x2: q[0], y2: q[1], q: 0.75 });
      });
    }
    // parking meters in rows along the paved lots that have parking lines
    const rngM = R('meters');
    for (const ln of map.lines) {
      if (ln.kind !== 'parking' || !rngM.chance(0.03)) continue;
      put(rngM, 'meter', ln.x1, ln.y1, rngM.range(0, TAU), { q: 0.8 });
    }
    scatter('carts', 6, ['concrete'], (x, y, rng) => { put(rng, 'cart', x, y, rng.range(0, TAU), { q: 0.8 }); });
    scatter('bikes', 3, ['concrete', 'asphalt', 'gravel', 'grass'], (x, y, rng) => { put(rng, 'bicycle', x, y, rng.range(0, TAU), { q: 0.85 }); });
    scatter('strollers', 2, ['concrete', 'asphalt', 'grass'], (x, y, rng) => { put(rng, 'stroller', x, y, rng.range(0, TAU), { q: 0.85 }); });
    scatter('hydrants', 1.2, ['concrete', 'grass'], (x, y, rng) => { put(rng, 'hydrant', x, y, rng.range(0, TAU), { q: 0.8 }); });
    scatter('gnomes', 3.5, ['grass'], (x, y, rng) => { put(rng, 'gnome', x, y, rng.range(0, TAU), { q: 0.7 }); });
    scatter('flagpoles', 0.4, ['concrete', 'grass'], (x, y, rng) => { put(rng, 'flagpole', x, y, rng.range(0, TAU), { q: 0.6 }); });
    scatter('lampold', 0.9, ['concrete'], (x, y, rng) => { put(rng, 'lamp_old', x, y, rng.range(0, TAU), { q: 0.7 }); });
    // pumps: cans and squeegee buckets
    around('pumpdress', pumps, 0.6, (p, rng) => {
      const [x, y] = at(p, rng.range(-30, 30), (rng.chance(0.5) ? 1 : -1) * (p.h / 2 + 24));
      put(rng, pickW(rng, [['fuel_can', 2], ['stain', 3], ['barrel_t', 1], ['bin', 1]]), x, y, rng.range(0, TAU), { q: 0.85 });
    });
  }

  // =========================================================================================
  // 3. CAMPS, PICNICS, FARMS, INDUSTRY
  // =========================================================================================
  {
    scatter('camps', 2.5, ['grass', 'dirt', 'sand', 'ground'], (x, y, rng) => {
      if (heat(x, y) > 0.7 || !free(x, y, 70)) return;
      const g = gseq++;
      const a = rng.range(0, TAU);
      put(rng, 'tent_camp', x, y, a, { g, s: rng.range(0.9, 1.2), q: 0.8 });
      const fx = x + Math.cos(a) * 90, fy = y + Math.sin(a) * 90;
      put(rng, 'campfire', fx, fy, rng.range(0, TAU), { g, q: 0.8 });
      for (let i = 0; i < 2 + rng.int(0, 1); i++) {
        const b = a + 0.9 + i * 1.6 + rng.range(-0.3, 0.3);
        put(rng, 'chair', fx + Math.cos(b) * 40, fy + Math.sin(b) * 40, b + Math.PI + rng.range(-0.3, 0.3), { g, q: 0.8 });
      }
      if (rng.chance(0.7)) put(rng, 'cooler', x + Math.cos(a + 1.2) * 46, y + Math.sin(a + 1.2) * 46, rng.range(0, TAU), { g, q: 0.8 });
      if (rng.chance(0.5)) put(rng, 'grill', x + Math.cos(a - 1.4) * 60, y + Math.sin(a - 1.4) * 60, rng.range(0, TAU), { g, q: 0.8 });
      if (rng.chance(0.6)) put(rng, 'sleeping_bag', x + Math.cos(a + Math.PI) * 44, y + Math.sin(a + Math.PI) * 44, rng.range(0, TAU), { g, q: 0.8 });
      if (rng.chance(0.4)) put(rng, 'laundry', x + Math.cos(a - 2.2) * 84, y + Math.sin(a - 2.2) * 84, a + Math.PI / 2, { g, q: 0.8 });
      if (rng.chance(0.4)) put(rng, 'backpack', x + Math.cos(a + 2) * 40, y + Math.sin(a + 2) * 40, rng.range(0, TAU), { g, q: 0.8 });
    });
    scatter('picnics', 1.6, ['grass'], (x, y, rng) => {
      if (!free(x, y, 60)) return;
      const g = gseq++;
      const a = rng.range(0, TAU);
      put(rng, 'picnic', x, y, a, { g, q: 0.8 });
      if (rng.chance(0.5)) put(rng, 'umbrella', x + Math.cos(a + 1.4) * 76, y + Math.sin(a + 1.4) * 76, rng.range(0, TAU), { g, q: 0.8 });
      if (rng.chance(0.6)) put(rng, 'cooler', x + Math.cos(a - 1.2) * 50, y + Math.sin(a - 1.2) * 50, rng.range(0, TAU), { g, q: 0.8 });
    });
    scatter('pallets', 7, ['concrete', 'gravel', 'dirt', 'asphalt'], (x, y, rng) => {
      put(rng, pickW(rng, [['pallet', 3], ['pallets', 2], ['crate', 3], ['crates', 2], ['drum', 2], ['drums', 1.6], ['ibc', 0.6], ['gascyl', 0.8], ['reel', 0.5], ['woodpile', 0.6], ['wheelbarrow', 0.5]]), x, y, rng.range(0, TAU), { q: 0.85 });
    });
    around('contdress', containers, 0.9, (c, rng) => {
      for (let i = 0; i < 1 + rng.int(0, 2); i++) {
        const sd = rng.chance(0.5) ? 1 : -1;
        const [x, y] = at(c, rng.range(-c.w * 0.4, c.w * 0.4), sd * (c.h / 2 + 22 + rng.range(0, 16)));
        put(rng, pickW(rng, [['pallet', 2], ['pallets', 1.5], ['crate', 2], ['crates', 2], ['drum', 2], ['drums', 1.5], ['forklift', 0.5], ['box_stack', 1], ['generator', 0.5], ['pipes', 0.5]]), x, y, c.a + rng.range(-1, 1), { q: 0.8 });
      }
    });
    scatter('hay', 5, ['grass'], (x, y, rng) => {
      // hay bales lie only well off the roads (in the fields)
      if (heat(x, y) > 0.5) return;
      const g = gseq++;
      const n = 1 + rng.int(0, 3);
      for (let i = 0; i < n; i++) put(rng, rng.chance(0.55) ? 'hay' : 'hay_sq', x + rng.range(-70, 70), y + rng.range(-70, 70), rng.range(0, TAU), { g, q: 0.75 });
    }, { mul: map.id === 'harlan' || map.id === 'highway' || map.id === 'checkpoint' ? 1 : 0.2 });
    scatter('tractors', 0.3, ['grass', 'dirt'], (x, y, rng) => { if (heat(x, y) < 0.6) put(rng, 'tractor', x, y, rng.range(0, TAU), { q: 0.7 }); });
    scatter('scarecrows', 0.6, ['grass', 'dirt'], (x, y, rng) => { if (heat(x, y) < 0.7) put(rng, 'scarecrow', x, y, rng.range(0, TAU), { q: 0.6 }); });
    scatter('trough', 0.5, ['grass', 'dirt'], (x, y, rng) => { put(rng, 'trough', x, y, rng.range(0, TAU), { q: 0.6 }); });
    scatter('forklifts', 0.5, ['concrete', 'gravel', 'dirt'], (x, y, rng) => { put(rng, 'forklift', x, y, rng.range(0, TAU), { q: 0.6 }); });
    scatter('generators', 0.9, ['concrete', 'gravel', 'dirt', 'grass'], (x, y, rng) => { put(rng, 'generator', x, y, rng.range(0, TAU), { q: 0.6 }); });
    scatter('pipes', 1.0, ['gravel', 'dirt', 'concrete'], (x, y, rng) => { put(rng, 'pipes', x, y, rng.range(0, TAU), { q: 0.6 }); });
    // one water tower and a few tall silhouettes far from the action
    const rngW = R('watertower');
    for (let t = 0; t < 40 && map.id !== 'bridge'; t++) {
      const x = rngW.range(200, W - 200), y = rngW.range(160, H - 160);
      if (heat(x, y) > 0.05 || surf(x, y) === 'asphalt') continue;
      if (put(rngW, 'watertower', x, y, rngW.range(0, TAU), { q: 0.4 })) break;
    }
  }

  // =========================================================================================
  // 4. SIGNS OF THE APOCALYPSE
  // =========================================================================================
  {
    scatter('barricades', 1.4, ['asphalt', 'concrete', 'gravel', 'dirt'], (x, y, rng) => { put(rng, 'barricade', x, y, rng.range(0, TAU), { q: 0.7 }); });
    scatter('sawhorse', 1.8, ['asphalt', 'concrete'], (x, y, rng) => { put(rng, 'sawhorse', x, y, rng.range(0, TAU), { q: 0.75 }); });
    scatter('plywoods', 2.4, ['asphalt', 'concrete', 'gravel', 'dirt', 'grass'], (x, y, rng) => { put(rng, 'plywood', x, y, rng.range(0, TAU), { q: 0.7 }); });
    scatter('tarps', 3, ['asphalt', 'concrete', 'gravel', 'dirt', 'grass'], (x, y, rng) => { put(rng, 'tarp', x, y, rng.range(0, TAU), { q: 0.75 }); });
    scatter('bodybags', 1.2, ['grass', 'dirt', 'gravel', 'concrete', 'asphalt'], (x, y, rng) => {
      const g = gseq++, a = rng.range(0, TAU), n = 1 + (rng.chance(0.35) ? rng.int(1, 3) : 0);
      for (let i = 0; i < n; i++) put(rng, 'bodybag', x - Math.sin(a) * i * 22, y + Math.cos(a) * i * 22, a, { g, q: 0.8 });
    });
    scatter('shrines', 1.0, ['asphalt', 'grass', 'gravel', 'dirt', 'concrete'], (x, y, rng) => {
      if (heat(x, y) < 0.05 && rng.chance(0.5)) return;
      put(rng, rng.chance(0.65) ? 'shrine' : 'cross', x, y, rng.range(0, TAU), { q: 0.7 });
    });
    scatter('milgear', 8, ['grass', 'dirt', 'gravel', 'concrete'], (x, y, rng) => {
      // only near the sandbags, tents and bastions
      let near = false;
      for (const o of og.near(x, y, 160)) if (o.kind === 'hesco' || o.kind === 'tent' || o.kind === 'booth' || o.kind === 'sandbags') { near = true; break; }
      if (!near) return;
      put(rng, pickW(rng, [['helmet', 2], ['milcrate', 3], ['mil_box', 3], ['sandarc', 1], ['bodybag', 0.6], ['tarp', 1], ['generator', 0.5], ['cooler', 0.6]]), x, y, rng.range(0, TAU), { q: 0.85 });
    });
    // tape and banners across the roads at a few places
    const rngT = R('tape');
    for (const rd of roads) {
      if (!rd.long) continue;
      const n = Math.max(1, Math.round(rd.L / 3200));
      for (let i = 0; i < n; i++) {
        const lx = rngT.range(-rd.L / 2 + 400, rd.L / 2 - 400);
        const [x1, y1] = at(rd, lx, -rd.W / 2 - 6), [x2, y2] = at(rd, lx, rd.W / 2 + 6);
        if (rngT.chance(0.5)) put(rngT, 'banner', x1, y1, Math.atan2(y2 - y1, x2 - x1), { w: rd.W + 12, x2, y2, q: 0.6 });
        else put(rngT, 'tape', x1, y1, Math.atan2(y2 - y1, x2 - x1), { w: rd.W + 12, x2, y2, q: 0.6 });
      }
    }
  }

  // =========================================================================================
  // 5. NATURE
  // =========================================================================================
  {
    const desert = map.id === 'truckstop';
    const wild = ['grass', 'dirt', 'ground', 'sand', 'gravel'];
    scatter('logs', 5, ['grass', 'dirt', 'ground'], (x, y, rng) => { put(rng, 'log', x, y, rng.range(0, TAU), { s: rng.range(0.8, 1.4), q: 0.85 }); });
    scatter('stumps', 3.5, ['grass', 'dirt', 'ground'], (x, y, rng) => { put(rng, 'stump', x, y, rng.range(0, TAU), { s: rng.range(0.8, 1.4), q: 0.85 }); });
    scatter('boulders', 5, wild, (x, y, rng) => { put(rng, 'boulders', x, y, rng.range(0, TAU), { s: rng.range(0.8, 1.5), q: 0.8 }); });
    scatter('shrubs', 18, ['grass', 'ground', 'dirt'], (x, y, rng) => { put(rng, 'shrub', x, y, rng.range(0, TAU), { s: rng.range(0.8, 1.4), q: 0.9 }); });
    if (!desert) scatter('ferns', 14, ['grass', 'ground'], (x, y, rng) => { put(rng, 'fern', x, y, rng.range(0, TAU), { s: rng.range(0.8, 1.3), q: 0.9 }); });
    if (desert) {
      scatter('cacti', 3.5, ['sand', 'dirt', 'ground', 'gravel'], (x, y, rng) => { put(rng, 'cactus', x, y, rng.range(0, TAU), { s: rng.range(0.7, 1.4), q: 0.85 }); });
      scatter('tumbleweeds', 7, ['sand', 'dirt', 'ground', 'gravel', 'asphalt', 'concrete'], (x, y, rng) => { put(rng, 'tumbleweed', x, y, rng.range(0, TAU), { s: rng.range(0.8, 1.5), q: 0.9 }); });
      scatter('bones', 1.2, ['sand', 'dirt', 'ground'], (x, y, rng) => { put(rng, 'bones', x, y, rng.range(0, TAU), { q: 0.7 }); });
    }
    if (!desert) scatter('flowers', 30, ['grass', 'ground'], (x, y, rng) => { put(rng, 'flowers', x, y, rng.range(0, TAU), { s: rng.range(0.8, 1.4), q: 0.95 }); });
    scatter('tallgrass', 55, ['grass', 'ground', 'dirt', 'sand'], (x, y, rng) => { put(rng, 'tallgrass', x, y, rng.range(0, TAU), { s: rng.range(0.8, 1.5), q: 0.95 }); });
    if (!desert) scatter('mushrooms', 9, ['grass', 'ground'], (x, y, rng) => { put(rng, 'mushrooms', x, y, rng.range(0, TAU), { s: rng.range(0.8, 1.4), q: 0.9 }); });
    scatter('pebbles', 16, wild, (x, y, rng) => { put(rng, 'pebbles', x, y, rng.range(0, TAU), { s: rng.range(0.8, 1.6), q: 0.9 }); });
    scatter('deadtrees', 2.2, ['dirt', 'sand', 'gravel', 'ground', 'grass'], (x, y, rng) => { if (heat(x, y) < 0.8 || rng.chance(0.5)) put(rng, 'deadtree', x, y, rng.range(0, TAU), { s: rng.range(0.8, 1.3), q: 0.7 }); });
    // around the trees: litter, mushrooms, ferns, fallen branches
    const rngTr = R('treefloor');
    for (const t of trees) {
      const n = rngTr.int(1, 3);
      for (let i = 0; i < n; i++) {
        const a = rngTr.range(0, TAU), d = rngTr.range(24, 70);
        const k = pickW(rngTr, [['leaves', 4], ['mushrooms', 2], ['fern', 2], ['log', 1], ['stump', 0.4], ['pebbles', 1]]);
        put(rngTr, k, t.x + Math.cos(a) * d, t.y + Math.sin(a) * d, rngTr.range(0, TAU), { q: 0.85 });
      }
    }
    // water: reeds and cattails, driftwood, lily pads, a rowboat
    const rngWa = R('shore');
    for (const w of waters) {
      const per = 60;
      for (const sd of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const horiz = sd[1] !== 0;
        const len = horiz ? w.w : w.h;
        const n = Math.round(len / per);
        for (let i = 0; i < n; i++) {
          const t = rngWa.range(-len / 2, len / 2);
          const ex = horiz ? w.x + t : w.x + sd[0] * w.w / 2, ey = horiz ? w.y + sd[1] * w.h / 2 : w.y + t;
          const off = rngWa.range(-14, 26);
          const x = ex - sd[0] * -off * 0 + sd[0] * off, y = ey + sd[1] * off;
          const k = pickW(rngWa, [['reeds', 5], ['driftwood', 0.8], ['tallgrass', 1.2], ['boulders', 0.5], ['lily', 1.2]]);
          if (k === 'lily') {
            put(rngWa, 'lily', ex - sd[0] * rngWa.range(20, 90), ey - sd[1] * rngWa.range(20, 90), rngWa.range(0, TAU), { free: true, wet: true, q: 0.9 });
          } else put(rngWa, k, x, y, rngWa.range(0, TAU), { q: 0.85, wet: k === 'reeds' });
        }
      }
    }
    // (lily pads and reeds sit at the water's edge: the water test above only bites inside it)
  }

  // =========================================================================================
  // 5b. THE ACTION: clutter piled up around the objective, the supply station and the start
  // of the team, and a dense strip of small things along both edges of every long road
  // =========================================================================================
  {
    const rng = R('hubs');
    const hubs = [];
    if (map.objective) hubs.push([map.objective.x, map.objective.y, 0, Math.max(map.objective.w, map.objective.h) / 2 + 560, 260, map.objective]);
    if (map.supply) hubs.push([map.supply.x, map.supply.y, 120, 520, 140]);
    if (cp) hubs.push([cp.hill.x, cp.hill.y, 180, 760, 180]);
    if (map.playerSpawns.length) {
      const px = map.playerSpawns.reduce((a, p) => a + p.x, 0) / map.playerSpawns.length, py = map.playerSpawns.reduce((a, p) => a + p.y, 0) / map.playerSpawns.length;
      hubs.push([px, py, 110, 560, 130]);
    }
    const TABLE = [
      ['suitcase', 3], ['duffel', 1.5], ['backpack', 2], ['box', 3], ['box_open', 1], ['box_stack', 1.5], ['bag', 3], ['clothes', 1.5], ['teddy', 0.5],
      ['shoes', 2], ['newsp', 2], ['litter', 3], ['cone_up', 2], ['cone_dn', 1.5], ['barrel_t', 1.5], ['triangle', 1], ['flare', 0.8], ['car_door', 0.4],
      ['hubcap', 0.6], ['glassf', 3], ['puddle', 2], ['stain', 2], ['blood', 1], ['leaves', 2], ['tarp', 1], ['plywood', 1.2], ['barricade', 0.6],
      ['sawhorse', 0.8], ['crate', 1.5], ['crates', 0.8], ['drum', 1.2], ['drums', 0.5], ['bin_fall', 0.8], ['bodybag', 0.5], ['cooler', 0.5],
      ['chair', 0.6], ['bicycle', 0.6], ['cart', 0.6], ['stroller', 0.4], ['shrine', 0.4], ['paperf', 1.5], ['soot', 1], ['mud', 1],
    ];
    for (const [hx, hy, r0, r1, n, body] of hubs) {
      // (target-driven: keep trying until n props stand there or the attempts run out)
      let placed = 0;
      for (let i = 0; i < n * 14 && placed < n * 1.6; i++) {
        const a = rng.range(0, TAU), d = r0 + Math.sqrt(rng.next()) * (r1 - r0);
        const x = hx + Math.cos(a) * d, y = hy + Math.sin(a) * d;
        // (around the objective the ring is measured from its hull, so its flanks are dressed too)
        if (body && distToRect(body, x, y) < 24) continue;
        const k = pickW(rng, TABLE);
        if (put(rng, k, x, y, rng.range(0, TAU), { s: rng.range(0.9, 1.2), q: 0.8 })) placed++;
      }
    }
    // in the lanes: debris every few paces along the long roads (mostly flat marks and small things)
    const LANE = [['glassf', 3], ['paperf', 2], ['newsp', 2], ['litter', 2], ['bag', 1.5], ['stain', 2], ['puddle', 1.5], ['leaves', 1.5], ['blood', 0.8], ['shoe', 0.5], ['box', 1], ['suitcase', 0.7], ['duffel', 0.4], ['backpack', 0.5], ['cone_dn', 0.5], ['hubcap', 0.4], ['clothes', 0.6], ['soot', 0.7], ['tread', 1], ['skid', 0.8]];
    for (const rd of roads) {
      if (!rd.long) continue;
      const n = Math.round(Math.max(rd.L / 34, (rd.L * rd.W) / 5500));
      for (let i = 0; i < n; i++) {
        const [x, y] = at(rd, rng.range(-rd.L / 2, rd.L / 2), rng.range(-rd.W / 2 + 6, rd.W / 2 - 6));
        const k = pickW(rng, LANE);
        put(rng, k, x, y, k === 'skid' || k === 'tread' ? rd.a + rng.range(-0.15, 0.15) : rng.range(0, TAU), { s: rng.range(0.85, 1.4), q: 0.85 });
      }
    }
    // roadsides
    const SHOULDER = [['litter', 3], ['bag', 2], ['tallgrass', 3], ['pebbles', 2], ['leaves', 2], ['cone_up', 0.8], ['barrel_t', 0.6], ['box', 1], ['newsp', 1.5], ['shoe', 0.5], ['puddle', 1], ['mud', 1], ['paperf', 1], ['flowers', 1.2], ['fern', 1], ['shrub', 1], ['boulders', 0.4], ['stump', 0.3], ['log', 0.4]];
    for (const rd of roads) {
      if (!rd.long) continue;
      const n = Math.round(rd.L / 80);
      for (let i = 0; i < n; i++) {
        const sd = rng.chance(0.5) ? 1 : -1;
        const [x, y] = at(rd, rng.range(-rd.L / 2, rd.L / 2), sd * (rd.W / 2 + rng.range(6, 70)));
        put(rng, pickW(rng, SHOULDER), x, y, rng.range(0, TAU), { s: rng.range(0.85, 1.3), q: 0.85 });
      }
    }
  }

  // =========================================================================================
  // 6. POINT-OF-INTEREST SET PIECES
  // =========================================================================================
  for (const poi of map.pois) {
    const rng = R('poi:' + poi.name);
    const name = poi.name.toLowerCase();
    const inDisc = (rMax, rMin = 30) => {
      const a = rng.range(0, TAU), d = rMin + Math.sqrt(rng.next()) * (rMax - rMin);
      return [poi.x + Math.cos(a) * d, poi.y + Math.sin(a) * d];
    };
    const many = (n, table, rMax, opts = {}) => {
      for (let i = 0; i < n; i++) {
        const [x, y] = inDisc(rMax);
        if (opts.on && !opts.on.includes(surf(x, y))) continue;
        put(rng, pickW(rng, table), x, y, rng.range(0, TAU), { q: opts.q ?? 0.7, s: rng.range(0.9, 1.2) });
      }
    };
    const R0 = Math.min(poi.r, 520);
    if (/farm|barn|yard/.test(name)) {
      many(9, [['hay', 3], ['hay_sq', 3], ['trough', 1], ['wheelbarrow', 1], ['tractor', 0.6], ['scarecrow', 0.6], ['barrel_t', 0.6], ['woodpile', 1]], R0, { q: 0.6 });
    } else if (/gas|pump|fuel/.test(name)) {
      many(12, [['drums', 2], ['drum', 3], ['fuel_can', 2], ['stain', 3], ['vend', 1], ['phone', 0.6], ['bin', 1], ['cone_up', 1], ['barrel_t', 1], ['box_stack', 1]], R0, { q: 0.6 });
    } else if (/church|jude/.test(name)) {
      many(10, [['cross', 3], ['shrine', 3], ['bench', 2], ['flowers', 3], ['leaves', 2], ['stump', 1]], R0, { q: 0.6 });
    } else if (/hospital/.test(name)) {
      many(6, [['medtent', 1]], R0 * 0.8, { q: 0.4 });
      many(20, [['bodybag', 3], ['gurney', 1.4], ['wheelchair', 1], ['tarp', 1.5], ['barricade', 0.8], ['milcrate', 1.6], ['mil_box', 1.4], ['generator', 0.7], ['cooler', 0.6], ['plywood', 0.5]], R0, { q: 0.6 });
    } else if (/quarry|junk/.test(name)) {
      many(14, [['boulders', 4], ['pipes', 2], ['drums', 1.6], ['wheel_loose', 2], ['panel', 1.6], ['bumper', 1], ['generator', 1], ['reel', 1], ['pallets', 1]], R0, { q: 0.6 });
    } else if (/marina|bridge|shack|bait|lake|boat/.test(name)) {
      many(9, [['rowboat', 1.2], ['crates', 2], ['crate', 2], ['barrel_t', 1], ['drum', 1.5], ['reeds', 2], ['driftwood', 2], ['cooler', 1], ['bin', 1]], R0, { q: 0.6 });
    } else if (/motel|diner|lot|stop|junction|main|street/.test(name)) {
      many(14, [['cart', 2], ['bicycle', 2], ['bin', 2], ['bin_fall', 1], ['vend', 1.4], ['phone', 0.8], ['bench', 1.4], ['meter', 1.2], ['newsbox', 1], ['cone_up', 1], ['stroller', 0.8], ['suitcase', 1.5], ['box_stack', 1]], R0, { q: 0.6 });
    } else if (/bus|overpass|interchange|road|west end|desert/.test(name)) {
      many(14, [['suitcase', 2], ['duffel', 1.4], ['backpack', 1.6], ['stroller', 0.8], ['teddy', 0.8], ['cone_dn', 1.5], ['triangle', 1.5], ['flare', 1], ['barrel_t', 1], ['bag', 1.4], ['sawhorse', 0.8], ['shoes', 1.2]], R0, { q: 0.6 });
    } else if (/compound|check|block|houses|farmhouse|woods|shady|radio/.test(name)) {
      many(14, [['sandarc', 1.4], ['milcrate', 2], ['mil_box', 2], ['helmet', 1.4], ['bodybag', 1], ['barricade', 1], ['tarp', 1], ['gnome', 0.8], ['mailbox', 1], ['bicycle', 0.8], ['campfire', 0.6], ['log', 1], ['stump', 1]], R0, { q: 0.6 });
    } else {
      many(10, [['suitcase', 1], ['bag', 1], ['box', 1], ['crate', 1], ['barrel_t', 1], ['tarp', 1]], R0, { q: 0.6 });
    }
  }

  // one message per map that is always there (GOD HELP US at a road edge near the players)
  {
    const rng = R('message');
    const hub = map.objective || map.supply || { x: W / 2, y: H / 2 };
    for (let t = 0; t < 400; t++) {
      const a = rng.range(0, TAU), d = rng.range(260, 900);
      const x = hub.x + Math.cos(a) * d, y = hub.y + Math.sin(a) * d;
      const s = surf(x, y);
      if (s === 'water' || heat(x, y) < 0.05) continue;
      if (put(rng, 'plywood', x, y, a + Math.PI, { q: 0.05, vv: 0 })) break;
    }
  }

  // ---- crow perches: lamp poles, wrecks, fences, bales (the world spawns birds on a subset) ----
  {
    const rng = R('perches');
    for (const l of lamps) if (rng.chance(0.25)) put(rng, 'perch', l.x, l.y, rng.range(0, TAU), { free: true, soft: true, vv: 230, q: 0.7 });
    for (const v of vehicles) if (rng.chance(0.08)) put(rng, 'perch', v.x, v.y, rng.range(0, TAU), { free: true, soft: true, vv: Math.round(v.kind === 'bus' ? 102 : 50), q: 0.7 });
    for (const t of trees) if (rng.chance(0.12)) put(rng, 'perch', t.x, t.y, rng.range(0, TAU), { free: true, soft: true, vv: 110, q: 0.7 });
  }

  // ranks: keep the order (important props first), spread them evenly over [0, 1) so a tier's
  // density is exactly its share of the props
  const byRank = items.map((it, i) => i).sort((a, b) => items[a].q - items[b].q || a - b);
  byRank.forEach((idx, n) => { items[idx].q = Math.round(((n + 0.5) / byRank.length) * 1e5) / 1e5; });

  // stable order: by kind then position (so builders and tests see one canonical list)
  items.sort((p, q) => (p.k < q.k ? -1 : p.k > q.k ? 1 : p.x - q.x || p.y - q.y));
  items.stats = stats;
  return items;
}

/** Items of a set that a tier shows (q below the tier's density). */
export function dressForTier(items, tier) {
  const d = dressDensity(tier);
  return items.filter((it) => it.q < d);
}

export { FLAG as dressFlags };
