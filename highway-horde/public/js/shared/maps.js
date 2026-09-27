// The four battlefields. Every map is hand-laid in code (roads, wrecks, buildings,
// objective, spawns) and only the dressing — tree placement, rocks, decals, which lamps
// still work, wreck colours, small position jitter — comes from the seeded rng, so the
// host and every client build byte-identical maps from the same (mapId, seed).
//
// Layout conventions shared by all maps:
//   - (x, y) of every rectangle (areas, obstacles, zombieSpawns, objective) is its centre.
//   - The objective sits near the middle with a clearing around it; the supply station is
//     250..450 px away; zombie spawn rectangles hug the map edges and never touch an
//     obstacle, so a zombie can appear anywhere inside one.
//   - Water is only ever an axis-aligned area of kind 'water' (the sim makes it
//     impassable), so a bridge is simply a gap between two water rectangles.

import { createRng, hashString } from './rng.js';
import { TAU, round1 } from './math.js';

/** Maps in lobby order. */
export const MAP_LIST = [
  {
    id: 'highway',
    name: 'Highway 9 Pileup',
    description: 'A school bus full of kids is stuck in a forty-car pileup. The horde pours in from both ends of the highway and across the fields.',
  },
  {
    id: 'truckstop',
    name: 'Last Chance Truck Stop',
    description: 'Survivors barricaded themselves inside the diner. Hold the forecourt, the pumps and the truck lot against the desert hordes.',
  },
  {
    id: 'bridge',
    name: 'Blackwater Bridge',
    description: 'An army APC broke down in the middle of the only bridge over the river. The dead come from both banks and must funnel across.',
  },
  {
    id: 'checkpoint',
    name: 'Checkpoint Delta',
    description: 'A fortified crossroads checkpoint. Keep the radio tower alive while the horde comes down all four roads and through the breaches.',
  },
];

const BUILDERS = {
  highway: buildHighway,
  truckstop: buildTruckStop,
  bridge: buildBridge,
  checkpoint: buildCheckpoint,
};

/**
 * Build the full map definition for `id`. Deterministic for a given (id, seed).
 * @param {string} id one of the MAP_LIST ids
 * @param {number} seed any integer; the same seed always yields the same map
 * @returns {object} MapDef (see SPEC §2)
 */
export function buildMap(id, seed) {
  const build = Object.prototype.hasOwnProperty.call(BUILDERS, id) ? BUILDERS[id] : null;
  if (!build) throw new Error(`Unknown map id: ${id}`);
  const meta = MAP_LIST.find((m) => m.id === id);
  const s = Number.isFinite(seed) ? seed : 0;
  const B = createBuilder(meta, s);
  build(B);
  return B.finish();
}

// ---------------------------------------------------------------------------------
// Palettes & sizes

const VEHICLE_SIZE = {
  car: [84, 42],
  suv: [92, 46],
  pickup: [100, 46],
  van: [104, 50],
  truck: [136, 56],
  bus: [250, 62],
  tanker: [230, 60],
};
const SEMI_CAB = [60, 56];
const SEMI_TRAILER = [240, 62];

// Muted civilian paint (night, dust and grime).
const CIVIL_COLORS = [
  '#6b2d2a', '#2f4858', '#5b5f63', '#8a8d8f', '#3b4a3a', '#7a6a4f', '#2a2d34',
  '#8c7b5a', '#4a3b52', '#9a9c98', '#5a3a2a', '#355c7d', '#7d6b3d', '#4f5d6b',
];
const MILITARY_COLORS = ['#4b5320', '#556b2f', '#4a4f35', '#5a5a3c'];
const SEMI_COLORS = ['#8a2f2a', '#2f4f6f', '#d0cbc0', '#3f5a3a', '#6b6f73', '#a8742f'];
const TRAILER_COLORS = ['#cfcac0', '#b7b3aa', '#9aa3a8', '#c4b89c', '#8d9aa0'];
const CONTAINER_COLORS = ['#7a3b2e', '#2f5a78', '#3d6b45', '#8a6d2f', '#6b3f5e', '#5b6770'];
const TRUNK_COLOR = '#4a3826';

const KIND_DEFAULTS = {
  // Sedans and rocks sit below eye level: shots fly over them (first-person view).
  car: { color: null, solid: false },
  suv: { color: null, solid: true },
  pickup: { color: null, solid: true },
  van: { color: null, solid: true },
  truck: { color: '#4b5320', solid: true },
  semi: { color: '#8a2f2a', solid: true },
  bus: { color: '#d9a21b', solid: true },
  tanker: { color: '#b9bcbf', solid: true },
  barrier: { color: '#9a9890', solid: false },
  sandbags: { color: '#8a7a55', solid: false },
  building: { color: '#8c8478', solid: true, roof: '#4e4a45' },
  wall: { color: '#77736b', solid: true },
  container: { color: '#2f5a78', solid: true, roof: '#2f5a78' },
  pump: { color: '#c9c4b6', solid: true },
  tree: { color: TRUNK_COLOR, solid: true },
  rock: { color: '#6d6a63', solid: false },
  hesco: { color: '#a08a62', solid: true },
  tent: { color: '#5a6340', solid: true, roof: '#6b7449' },
  booth: { color: '#5b6150', solid: true, roof: '#44493c' },
  guardrail: { color: '#8f979c', solid: false },
  pillar: { color: '#8d8a82', solid: true },
};
const ROOFED = new Set(['building', 'container', 'tent', 'booth']);
const VEHICLES = new Set(['car', 'suv', 'pickup', 'van', 'truck', 'semi', 'bus', 'tanker']);

const LAMP_COLOR = '#ffcf8a';
const SODIUM_COLOR = '#ffb04a';
const FIRE_COLOR = '#ff8a33';
const FLOOD_COLOR = '#e4f0ff';

// ---------------------------------------------------------------------------------
// Geometry (oriented rectangles). Kept local so maps.js has no dependency on the sim.

function pointInRect(px, py, r, pad) {
  const dx = px - r.x, dy = py - r.y;
  const a = r.a || 0;
  const c = Math.cos(a), s = Math.sin(a);
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;
  return Math.abs(lx) <= r.w / 2 + pad && Math.abs(ly) <= r.h / 2 + pad;
}

// Separating-axis test between two oriented rectangles; `pad` grows `A` on every side.
function rectsOverlap(A, B, pad) {
  const aa = A.a || 0, ba = B.a || 0;
  const ac = Math.cos(aa), as = Math.sin(aa), bc = Math.cos(ba), bs = Math.sin(ba);
  const axes = [ac, as, -as, ac, bc, bs, -bs, bc];
  const dx = B.x - A.x, dy = B.y - A.y;
  const ahw = A.w / 2 + pad, ahh = A.h / 2 + pad, bhw = B.w / 2, bhh = B.h / 2;
  for (let i = 0; i < 8; i += 2) {
    const ux = axes[i], uy = axes[i + 1];
    const ra = ahw * Math.abs(ac * ux + as * uy) + ahh * Math.abs(-as * ux + ac * uy);
    const rb = bhw * Math.abs(bc * ux + bs * uy) + bhh * Math.abs(-bs * ux + bc * uy);
    if (Math.abs(dx * ux + dy * uy) > ra + rb) return false;
  }
  return true;
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

function normAngle(a) {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  if (a <= -Math.PI) a += TAU;
  return round3(a);
}

// Blend a hex colour toward another; used for soot-darkened wrecks.
function mixColor(hex, toHex, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = p(hex), b = p(toHex);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------------
// Builder: the small vocabulary the four layouts are written in.

function createBuilder(meta, seed) {
  const def = MAP_DEFS[meta.id];
  const map = {
    id: meta.id,
    name: meta.name,
    width: def.width,
    height: def.height,
    seed,
    ambient: { darkness: def.darkness, tint: def.tint },
    ground: def.ground,
    areas: [],
    lines: [],
    obstacles: [],
    decor: [],
    lights: [],
    fires: [],
    playerSpawns: [],
    zombieSpawns: [],
    objective: null,
    supply: null,
  };
  // Two independent streams: layout jitter never shifts because decor changed, and vice versa.
  const rng = createRng(hashString(`${meta.id}:layout:${seed}`));
  const drng = createRng(hashString(`${meta.id}:decor:${seed}`));
  const keepouts = [];   // rects scatter (trees, rocks, decor clutter) must stay out of
  const waters = [];

  const B = {
    map,
    rng,
    drng,
    W: def.width,
    H: def.height,

    area(kind, x, y, w, h, a = 0) {
      const r = { kind, x: round1(x), y: round1(y), w: round1(w), h: round1(h), a: normAngle(a) };
      map.areas.push(r);
      if (kind === 'water') waters.push(r);
      return r;
    },
    /** Area from its corner coordinates (axis aligned). */
    box(kind, x0, y0, x1, y1) {
      return B.area(kind, (x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), 0);
    },
    line(kind, x1, y1, x2, y2, w) {
      map.lines.push({ kind, x1: round1(x1), y1: round1(y1), x2: round1(x2), y2: round1(y2), w });
    },

    /**
     * Organic ground patch: a few overlapping rotated rectangles around a centre. Pieces
     * that would poke out of the world are dropped so every area stays in bounds.
     */
    blob(kind, cx, cy, size) {
      const n = 3 + Math.floor(rng.next() * 3);
      for (let i = 0; i < n; i++) {
        const ang = rng.range(0, TAU), d = size * 0.35 * rng.next();
        const r = {
          x: cx + Math.cos(ang) * d, y: cy + Math.sin(ang) * d,
          w: size * rng.range(0.45, 0.9), h: size * rng.range(0.3, 0.6), a: rng.range(-Math.PI, Math.PI),
        };
        const ext = Math.hypot(r.w, r.h) / 2;
        if (r.x - ext < 0 || r.y - ext < 0 || r.x + ext > B.W || r.y + ext > B.H) continue;
        B.area(kind, r.x, r.y, r.w, r.h, r.a);
      }
    },
    /** Scatter `n` blobs over a region, kinds drawn from `kinds`. */
    patches(kinds, n, x0, y0, x1, y1, size = [180, 420]) {
      for (let i = 0; i < n; i++) {
        B.blob(rng.pick(kinds), rng.range(x0, x1), rng.range(y0, y1), rng.range(size[0], size[1]));
      }
    },

    /** Add an obstacle; `opts` may override color/solid/wrecked/roof. */
    ob(kind, x, y, w, h, a = 0, opts = {}) {
      const d = KIND_DEFAULTS[kind];
      const o = {
        id: map.obstacles.length,
        kind,
        x: round1(x),
        y: round1(y),
        w: round1(w),
        h: round1(h),
        a: normAngle(a),
        color: opts.color || d.color || '#777777',
        solid: opts.solid !== undefined ? !!opts.solid : d.solid,
        wrecked: VEHICLES.has(kind) ? !!opts.wrecked : false,
        roof: ROOFED.has(kind) ? (opts.roof || d.roof || '#555555') : null,
      };
      map.obstacles.push(o);
      return o;
    },

    /** Any road vehicle; picks a paint job from the rng when no colour is given. */
    vehicle(kind, x, y, a, opts = {}) {
      const [w, h] = VEHICLE_SIZE[kind];
      const j = opts.jitter === undefined ? 1 : opts.jitter;
      const vx = x + rng.centered() * 6 * j;
      const vy = y + rng.centered() * 4 * j;
      const va = a + rng.centered() * 0.06 * j;
      let color = opts.color || rng.pick(kind === 'truck' ? MILITARY_COLORS : CIVIL_COLORS);
      if (opts.wrecked) color = mixColor(color, '#221e1b', 0.45);
      const o = B.ob(kind, vx, vy, w, h, va, { color, wrecked: opts.wrecked });
      if (opts.burning) B.burning(o);
      return o;
    },

    /** Tractor + trailer. `jack` bends the cab relative to the trailer (jackknife). */
    semi(x, y, a, jack = 0, opts = {}) {
      const tColor = opts.trailerColor || rng.pick(TRAILER_COLORS);
      let cColor = opts.cabColor || rng.pick(SEMI_COLORS);
      const wrecked = !!opts.wrecked;
      if (wrecked) cColor = mixColor(cColor, '#221e1b', 0.45);
      const trailer = B.ob('semi', x, y, SEMI_TRAILER[0], SEMI_TRAILER[1], a,
        { color: wrecked ? mixColor(tColor, '#221e1b', 0.35) : tColor, wrecked });
      if (opts.noCab) return [trailer];
      const hx = x + Math.cos(a) * (SEMI_TRAILER[0] / 2 - 6);
      const hy = y + Math.sin(a) * (SEMI_TRAILER[0] / 2 - 6);
      const ca = a + jack;
      const cab = B.ob('semi', hx + Math.cos(ca) * 26, hy + Math.sin(ca) * 26,
        SEMI_CAB[0], SEMI_CAB[1], ca, { color: cColor, wrecked });
      if (opts.burning) B.burning(cab);
      return [trailer, cab];
    },

    /** Flames on the front half of a wreck plus their flickering glow. */
    burning(o, size = 1) {
      const fx = o.x + Math.cos(o.a) * o.w * 0.22;
      const fy = o.y + Math.sin(o.a) * o.w * 0.22;
      B.fire(fx, fy, (22 + drng.range(0, 10)) * size);
    },
    fire(x, y, r) {
      map.fires.push({ x: round1(x), y: round1(y), r: round1(r) });
      B.light(x, y, 200 + r * 2, FIRE_COLOR, 0.55);
    },
    light(x, y, r, color, flicker = 0) {
      map.lights.push({ x: round1(x), y: round1(y), r: round1(r), color, flicker });
    },
    /** Street lamp: always a post, and a light unless the rng decided the bulb is dead. */
    lamp(x, y, opts = {}) {
      B.decor('lamp_post', x, y, opts.a || 0, 1);
      const dead = opts.dead !== undefined ? opts.dead : drng.chance(opts.deadChance ?? 0.18);
      if (!dead) B.light(x, y, opts.r || 220, opts.color || LAMP_COLOR, drng.chance(0.15) ? 0.2 : 0);
    },

    tree(x, y, s = 1) {
      const size = 20 + 10 * s;
      const o = B.ob('tree', x, y, size, size, rng.range(0, TAU), { color: TRUNK_COLOR });
      B.decor('tree_canopy', x, y, drng.range(0, TAU), round3(0.85 + s * 0.55), true);
      return o;
    },

    /** Rail, fence or wall run from (x1,y1) to (x2,y2), split into pieces <= maxLen. */
    run(kind, x1, y1, x2, y2, thick, opts = {}) {
      const len = Math.hypot(x2 - x1, y2 - y1);
      const n = Math.max(1, Math.ceil(len / (opts.maxLen || 420)));
      const a = Math.atan2(y2 - y1, x2 - x1);
      const out = [];
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        out.push(B.ob(kind, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, len / n, thick, a, opts));
      }
      return out;
    },
    /** Horizontal run along y from x0 to x1 with [from, to] gaps left open. */
    runX(kind, y, x0, x1, gaps, thick, opts) {
      for (const [g0, g1] of B.spans(x0, x1, gaps)) B.run(kind, g0, y, g1, y, thick, opts);
    },
    runY(kind, x, y0, y1, gaps, thick, opts) {
      for (const [g0, g1] of B.spans(y0, y1, gaps)) B.run(kind, x, g0, x, g1, thick, opts);
    },
    spans(a0, a1, gaps) {
      const out = [];
      let cur = a0;
      for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) {
        if (g0 > cur) out.push([cur, Math.min(g0, a1)]);
        cur = Math.max(cur, g1);
      }
      if (cur < a1) out.push([cur, a1]);
      return out.filter(([p, q]) => q - p >= 24);
    },

    objective(kind, name, x, y, w, h, a, hp, clearing = 150) {
      map.objective = { kind, name, x, y, w, h, a, hp };
      B.keep(x, y, w + clearing * 2, h + clearing * 2, a);
    },
    supply(x, y) {
      map.supply = { x, y };
      B.keep(x, y, 150, 150);
    },
    pspawn(x, y) {
      map.playerSpawns.push({ x, y });
      B.keep(x, y, 70, 70);
    },
    zspawn(x, y, w, h) {
      map.zombieSpawns.push({ x, y, w, h });
      B.keep(x, y, w + 200, h + 200);
    },
    /** Reserve a rectangle that scatter (trees, rocks, clutter decor) must leave empty. */
    keep(x, y, w, h, a = 0) {
      keepouts.push({ x, y, w, h, a });
    },

    /** Kind of the topmost area under a point ('ground' when none). */
    surfaceAt(x, y) {
      for (let i = map.areas.length - 1; i >= 0; i--) {
        if (pointInRect(x, y, map.areas[i], 0)) return map.areas[i].kind;
      }
      return 'ground';
    },
    inWater(x, y, pad = 0) {
      for (const w of waters) if (pointInRect(x, y, w, pad)) return true;
      return false;
    },
    blockedAt(x, y, pad) {
      for (const o of map.obstacles) if (pointInRect(x, y, o, pad)) return true;
      const ob = map.objective;
      return !!ob && pointInRect(x, y, ob, pad);
    },
    kept(x, y, pad = 0) {
      for (const k of keepouts) if (pointInRect(x, y, k, pad)) return true;
      return false;
    },

    /**
     * Try to put a scattered obstacle somewhere free: not on the listed surfaces, not in
     * water, a keep-out or another obstacle (with `pad` px to spare).
     */
    fits(r, pad, avoidSurfaces) {
      if (r.x - r.w / 2 < 40 || r.y - r.h / 2 < 40 || r.x + r.w / 2 > B.W - 40 || r.y + r.h / 2 > B.H - 40) return false;
      if (avoidSurfaces && avoidSurfaces.includes(B.surfaceAt(r.x, r.y))) return false;
      if (B.inWater(r.x, r.y, Math.max(r.w, r.h) / 2 + 30)) return false;
      if (B.kept(r.x, r.y, Math.max(r.w, r.h) / 2)) return false;
      for (const o of map.obstacles) if (rectsOverlap(r, o, pad)) return false;
      const ob = map.objective;
      if (ob && rectsOverlap(r, ob, pad + 40)) return false;
      return true;
    },

    /** Cluster of `n` trees inside an ellipse, spaced so walkers can thread between them. */
    forest(cx, cy, rx, ry, n, opts = {}) {
      const avoid = opts.avoid || ['asphalt', 'concrete', 'gravel', 'water', 'sand'];
      for (let i = 0; i < n; i++) {
        for (let t = 0; t < 30; t++) {
          const ang = rng.range(0, TAU), d = Math.sqrt(rng.next());
          const x = cx + Math.cos(ang) * rx * d, y = cy + Math.sin(ang) * ry * d;
          const s = rng.range(0.6, 1.25);
          const size = 20 + 10 * s;
          if (!B.fits({ x, y, w: size, h: size, a: 0 }, opts.spacing || 64, avoid)) continue;
          B.tree(x, y, s);
          if (drng.chance(0.5)) B.decor('bush', x + drng.centered() * 70, y + drng.centered() * 70, drng.range(0, TAU), drng.range(0.6, 1.2));
          break;
        }
      }
    },
    /** A few boulders in a region. */
    boulders(x0, y0, x1, y1, n, opts = {}) {
      const avoid = opts.avoid || ['asphalt', 'concrete', 'gravel', 'water'];
      for (let i = 0; i < n; i++) {
        for (let t = 0; t < 30; t++) {
          const w = rng.range(opts.min || 34, opts.max || 64), h = w * rng.range(0.65, 0.95);
          const r = { x: rng.range(x0, x1), y: rng.range(y0, y1), w, h, a: rng.range(0, TAU) };
          if (!B.fits(r, opts.spacing || 70, avoid)) continue;
          B.ob('rock', r.x, r.y, w, h, r.a, { color: opts.color || rng.pick(['#6d6a63', '#77726a', '#5f5b55']) });
          break;
        }
      }
    },

    /**
     * Add one decor item. Clutter is refused when it would sit under an obstacle, in water
     * or out of bounds; `force` skips the checks for things that belong on top of an
     * obstacle's footprint by design (tree canopies).
     */
    decor(kind, x, y, a = 0, s = 1, force = false) {
      if (!force) {
        if (x < 8 || y < 8 || x > B.W - 8 || y > B.H - 8) return false;
        if (B.inWater(x, y, 6)) return false;
        if (B.blockedAt(x, y, 6)) return false;
      }
      map.decor.push({ kind, x: round1(x), y: round1(y), a: normAngle(a), s: round3(s) });
      return true;
    },
    /**
     * Scatter `n` decor items in a rectangle. opts.on limits them to some surfaces,
     * opts.keep=true also respects keep-outs (for clutter that must not crowd spawns).
     */
    sprinkle(kind, n, x0, y0, x1, y1, opts = {}) {
      const [slo, shi] = opts.s || [0.8, 1.2];
      for (let i = 0; i < n; i++) {
        for (let t = 0; t < 12; t++) {
          const x = drng.range(x0, x1), y = drng.range(y0, y1);
          if (opts.on && !opts.on.includes(B.surfaceAt(x, y))) continue;
          if (opts.off && opts.off.includes(B.surfaceAt(x, y))) continue;
          if (opts.keep && B.kept(x, y)) continue;
          const a = opts.a !== undefined ? opts.a + drng.centered() * (opts.aJitter ?? 0.25) : drng.range(0, TAU);
          if (B.decor(kind, x, y, a, drng.range(slo, shi))) break;
        }
      }
    },
    /** Scatter around a point, denser in the middle. */
    cluster(kind, n, cx, cy, r, opts = {}) {
      const [slo, shi] = opts.s || [0.8, 1.2];
      for (let i = 0; i < n; i++) {
        for (let t = 0; t < 10; t++) {
          const ang = drng.range(0, TAU), d = r * drng.next();
          const x = cx + Math.cos(ang) * d, y = cy + Math.sin(ang) * d;
          if (opts.on && !opts.on.includes(B.surfaceAt(x, y))) continue;
          if (B.decor(kind, x, y, drng.range(0, TAU), drng.range(slo, shi))) break;
        }
      }
    },
    /** Tyre marks following a direction, e.g. into a crash. */
    skids(n, x0, y0, x1, y1, a) {
      B.sprinkle('skid', n, x0, y0, x1, y1, { a, aJitter: 0.18, s: [1, 2.2], on: ['asphalt', 'concrete'] });
    },
    /** Generic lived-in clutter every map gets on its paved and open ground. */
    groundClutter(opts) {
      const { W, H } = B;
      const paved = ['asphalt', 'concrete'];
      B.sprinkle('crack', opts.cracks, 0, 0, W, H, { on: paved, s: [0.7, 1.6] });
      B.sprinkle('oil', opts.oil, 0, 0, W, H, { on: paved, s: [0.6, 1.4] });
      B.sprinkle('paper', opts.paper, 0, 0, W, H, { s: [0.6, 1.1] });
      B.sprinkle('debris', opts.debris, 0, 0, W, H, { on: paved.concat(['gravel', 'dirt']), s: [0.6, 1.2] });
      B.sprinkle('blood_old', opts.blood, 0, 0, W, H, { s: [0.6, 1.5], off: ['water'] });
      B.sprinkle('tire', opts.tires, 0, 0, W, H, { s: [0.8, 1.1], keep: true });
      B.sprinkle('grass_tuft', opts.tufts, 0, 0, W, H, { on: opts.tuftOn || ['grass', 'ground'], s: [0.6, 1.4] });
      B.sprinkle('bush', opts.bushes, 0, 0, W, H, { on: opts.tuftOn || ['grass', 'ground'], s: [0.6, 1.3], keep: true });
      B.sprinkle('rock', opts.rocks, 0, 0, W, H, { off: paved.concat(['water']), s: [0.5, 1.1] });
    },

    finish() {
      if (!map.objective || !map.supply) throw new Error(`map ${map.id} is missing its objective or supply`);
      return map;
    },
  };
  return B;
}

// Per-map world size and mood; kept in one table so the builders stay about layout.
const MAP_DEFS = {
  highway: { width: 3600, height: 2200, darkness: 0.68, tint: '#2c4a7a', ground: '#34452a' },
  truckstop: { width: 3400, height: 2400, darkness: 0.6, tint: '#a0602a', ground: '#7c6a4c' },
  bridge: { width: 4000, height: 2000, darkness: 0.72, tint: '#2f6b68', ground: '#34442f' },
  checkpoint: { width: 3000, height: 3000, darkness: 0.66, tint: '#56644c', ground: '#434a33' },
};

// ---------------------------------------------------------------------------------
// 1. Highway 9 Pileup
//
// A divided six-lane highway crosses the map west-east. The school bus is stuck in the
// eastbound lanes just behind a pileup; the westbound lanes hold a jackknifed semi and an
// overturned tanker. Guard-rail gaps connect the farm fields north and south.

function buildHighway(B) {
  const { W, H, rng } = B;
  const NORTH = [895, 965, 1035];   // westbound lane centres (traffic heading west)
  const SOUTH = [1165, 1235, 1305]; // eastbound lane centres (traffic heading east)
  const WEST = Math.PI, EAST = 0;

  // Objective, supply and spawns first so scatter knows what to keep clear.
  const BUS = { x: 1800, y: 1235 };
  B.objective('bus', 'School Bus', BUS.x, BUS.y, 250, 62, -0.04, 5000, 130);
  B.supply(1800, 978);
  for (const [x, y] of [[1640, 1155], [1760, 1158], [1880, 1158], [1990, 1170],
    [1600, 1318], [1740, 1322], [1880, 1318], [2000, 1305]]) B.pspawn(x, y);
  B.zspawn(60, 1100, 100, 520);
  B.zspawn(W - 60, 1100, 100, 520);
  B.zspawn(450, 60, 520, 90);
  B.zspawn(1800, 60, 700, 90);
  B.zspawn(3120, 60, 520, 90);
  B.zspawn(620, H - 60, 520, 90);
  B.zspawn(1800, H - 60, 700, 90);
  B.zspawn(3000, H - 60, 460, 90);
  // Keep the approaches along the carriageway shoulders open for sight lines.
  B.keep(W / 2, 1100, W, 640);

  // ---- ground
  B.patches(['grass', 'grass', 'dirt'], 9, 150, 150, W - 150, 700);
  B.patches(['grass', 'grass', 'dirt'], 9, 150, 1500, W - 150, H - 150);
  B.area('dirt', 2980, 1760, 820, 420, 0.03);          // ploughed field by the barn
  B.box('dirt', 868, 380, 932, 800);                   // farm track north
  B.area('dirt', 900, 300, 320, 220, 0);                // farmyard
  B.box('dirt', 2668, 1400, 2732, 1820);               // farm track south
  B.box('gravel', 0, 800, W, 1400);                     // shoulders
  B.box('asphalt', 0, 858, W, 1072);
  B.box('asphalt', 0, 1128, W, 1342);
  B.box('concrete', 0, 1072, W, 1128);                  // median

  // ---- paint
  B.line('white', 0, 864, W, 864, 4);
  B.line('white', 0, 1336, W, 1336, 4);
  B.line('yellow', 0, 1067, W, 1067, 4);
  B.line('yellow', 0, 1133, W, 1133, 4);
  for (const y of [930, 1000, 1200, 1270]) B.line('white_dashed', 0, y, W, y, 3);

  // ---- guard rails with gaps where tracks and fields meet the road
  B.runX('guardrail', 800, 0, W, [[500, 700], [820, 980], [1460, 1660], [2220, 2420], [2940, 3140]], 8, { maxLen: 480 });
  B.runX('guardrail', 1400, 0, W, [[380, 580], [1140, 1340], [1860, 2080], [2600, 2800], [3220, 3420]], 8, { maxLen: 480 });

  // ---- median jersey barriers; the crash knocked a section loose
  B.runX('barrier', 1100, 150, W - 150, [[360, 480], [1060, 1180], [1680, 1920], [2200, 2440], [2560, 2680], [3180, 3300]], 16, { maxLen: 300 });
  B.ob('barrier', 2262, 1116, 110, 16, 0.38);
  B.ob('barrier', 2392, 1082, 96, 16, -0.52);

  // ---- westbound: overturned tanker, jackknifed semi, pileup, then the jam behind it
  B.ob('tanker', 1235, 975, 230, 60, WEST + 0.42, { color: '#9da2a6', wrecked: true });
  B.ob('semi', 1070, 912, SEMI_CAB[0], SEMI_CAB[1], WEST + 1.15, { color: mixColor(rng.pick(SEMI_COLORS), '#221e1b', 0.45), wrecked: true });
  B.fire(1330, 1030, 44);
  B.fire(1150, 1000, 26);
  B.vehicle('car', 1440, 915, WEST + 0.5, { wrecked: true, burning: true });
  B.vehicle('suv', 1505, 1030, WEST - 0.35, { wrecked: true });
  B.vehicle('car', 1585, 925, 2.0, { wrecked: true });
  B.vehicle('truck', 1800, 892, WEST + 0.05, { color: '#4b5320', jitter: 0 });   // army supply truck
  B.vehicle('car', 2035, 1025, WEST - 0.9, { wrecked: true });
  B.vehicle('pickup', 2110, 905, WEST + 0.3, { wrecked: true, burning: true });
  B.semi(2365, 972, WEST - 0.5, 1.25, { wrecked: rng.chance(0.5) });
  B.vehicle('car', 2565, 905, WEST + 0.2);
  B.vehicle('van', 2645, 1030, WEST - 0.25, { wrecked: true });
  for (const [kind, x, y] of [['car', 2800, NORTH[0]], ['car', 3020, NORTH[0]], ['suv', 3300, NORTH[0]],
    ['van', 2860, NORTH[1]], ['car', 3130, NORTH[1]],
    ['car', 2790, NORTH[2]], ['pickup', 3060, NORTH[2]], ['car', 3330, NORTH[2]]]) {
    B.vehicle(kind, x, y, WEST, { wrecked: rng.chance(0.15) });
  }
  // A couple of cars that made it past the crash before it happened.
  B.vehicle('car', 700, 940, WEST + 0.4, { wrecked: true, burning: rng.chance(0.5) });
  B.vehicle('suv', 420, 1010, WEST - 0.1);

  // ---- eastbound: pileup ahead of the bus, traffic queued behind it
  B.vehicle('car', 2135, 1178, 0.75, { wrecked: true, burning: true });
  B.vehicle('suv', 2235, 1292, -0.45, { wrecked: true });
  B.vehicle('pickup', 2345, 1195, 1.25, { wrecked: true });
  B.vehicle('car', 2470, 1300, 0.2);
  B.vehicle('van', 2565, 1180, -0.7, { wrecked: true, burning: rng.chance(0.5) });
  B.vehicle('car', 2720, 1240, 0.1);
  B.vehicle('car', 2960, 1175, 0.05);
  B.vehicle('suv', 3200, 1300, -0.1);
  for (const [kind, x, y] of [['car', 1420, SOUTH[1]], ['car', 1330, SOUTH[0]], ['van', 1280, SOUTH[2]],
    ['car', 1100, SOUTH[0]], ['car', 1010, SOUTH[2]], ['car', 860, SOUTH[0]],
    ['pickup', 740, SOUTH[1]], ['suv', 630, SOUTH[2]], ['car', 540, SOUTH[0]], ['car', 330, SOUTH[1]]]) {
    B.vehicle(kind, x, y, EAST, { wrecked: rng.chance(0.12) });
  }

  // ---- farms
  B.ob('building', 900, 300, 200, 140, 0, { color: '#9a8f7e', roof: '#6e3b2f' });   // farmhouse
  B.ob('building', 1085, 250, 90, 70, 0.05, { color: '#7a6a55', roof: '#5b5048' }); // shed
  B.ob('building', 2980, 1900, 200, 150, 0, { color: '#7d3a2c', roof: '#5a2b22' }); // barn
  B.ob('pickup', 1000, 390, 100, 46, 1.4, { color: '#6d4c3a' });
  B.runX('wall', 640, 1250, 2300, [[1760, 1880]], 6, { color: '#6b5433', solid: false, maxLen: 280 });
  B.runX('wall', 1580, 700, 1500, [[1040, 1160]], 6, { color: '#6b5433', solid: false, maxLen: 280 });
  B.runY('wall', 2560, 1470, 2060, [[1700, 1800]], 6, { color: '#6b5433', solid: false, maxLen: 300 });

  B.forest(300, 360, 220, 170, 6);
  B.forest(1520, 330, 250, 150, 5);
  B.forest(2400, 360, 260, 180, 6);
  B.forest(3300, 420, 200, 200, 5);
  B.forest(420, 1820, 260, 170, 6);
  B.forest(1400, 1900, 240, 140, 5);
  B.forest(2160, 1800, 200, 150, 4);
  B.forest(3380, 1700, 150, 200, 4);
  B.boulders(100, 150, W - 100, 740, 4);
  B.boulders(100, 1470, W - 100, H - 150, 4);

  // ---- lights: shoulder lamps, bus interior, army work light, farmhouse porch
  for (const x of [300, 1100, 2700, 3500]) B.lamp(x, 832);
  for (const x of [700, 1500, 2300, 3100]) B.lamp(x, 1370);
  B.lamp(1900, 832, { dead: false });
  B.light(BUS.x, BUS.y, 170, '#ffe2a0', 0.05);
  B.light(1800, 960, 190, FLOOD_COLOR, 0);
  B.light(900, 390, 150, '#ffcf80', 0.15);
  B.light(2980, 1990, 130, '#ffcf80', 0.1);

  // ---- decor
  B.skids(18, 900, 870, 2500, 1060, WEST);
  B.skids(14, 1000, 1140, 2600, 1330, EAST);
  B.cluster('debris', 40, 1850, 1100, 750);
  B.cluster('debris', 14, 1240, 980, 180);
  B.cluster('rubble', 8, 2330, 1100, 90);
  B.cluster('oil', 6, 1260, 1000, 150, { s: [1.2, 2.2] });
  B.cluster('tire', 8, 2200, 1100, 400);
  B.cluster('blood_old', 16, 1800, 1150, 700);
  for (const [x, y] of [[1690, 1040], [1720, 1050], [1900, 1045], [1930, 1036], [1640, 870]]) {
    B.decor('cone', x + B.drng.centered() * 8, y + B.drng.centered() * 6, B.drng.range(0, TAU), 1);
  }
  B.decor('sign', 200, 1382, 0, 1.2);
  B.decor('sign', 3420, 818, Math.PI, 1.2);
  B.decor('sign', 1240, 1382, 0, 1);
  B.decor('flag', 1760, 850, 0, 1, true);
  B.groundClutter({ cracks: 60, oil: 18, paper: 40, debris: 30, blood: 18, tires: 6, tufts: 260, bushes: 70, rocks: 40 });
  B.sprinkle('bush', 30, 0, 760, W, 800, { keep: true, s: [0.6, 1.1] });
  B.sprinkle('bush', 30, 0, 1400, W, 1440, { keep: true, s: [0.6, 1.1] });
}

// ---------------------------------------------------------------------------------
// 2. Last Chance Truck Stop
//
// Desert crossroads services: a two-lane road along the south edge, the fuel forecourt
// with its pump islands and store to the west, the diner (objective) in the middle with
// its parking lot, and a fenced gravel truck lot to the east.

function buildTruckStop(B) {
  const { W, H, rng } = B;
  const DINER = { x: 1700, y: 1060 };
  B.objective('diner', 'The Diner', DINER.x, DINER.y, 260, 160, 0, 6000, 140);
  B.supply(1700, 1400);
  for (const [x, y] of [[1560, 1205], [1660, 1210], [1760, 1210], [1860, 1205],
    [1500, 1060], [1900, 1060], [1580, 1300], [1820, 1300]]) B.pspawn(x, y);
  B.zspawn(700, 60, 700, 90);
  B.zspawn(1800, 60, 600, 90);
  B.zspawn(2850, 60, 700, 90);
  B.zspawn(60, 600, 90, 600);
  B.zspawn(60, 1600, 90, 500);
  B.zspawn(W - 60, 500, 90, 600);
  B.zspawn(W - 60, 1550, 90, 500);
  B.zspawn(600, H - 50, 700, 80);
  B.zspawn(1700, H - 50, 600, 80);
  B.zspawn(2800, H - 50, 700, 80);

  // ---- ground
  B.patches(['sand', 'sand', 'dirt'], 18, 150, 150, W - 150, 1900);
  B.box('sand', 0, 2040, W, H);
  B.box('gravel', 2200, 760, 3140, 1720);                // truck lot
  B.box('dirt', 2230, 380, 2600, 660);                   // garage yard
  B.box('dirt', 2640, 330, 3120, 660);                   // junkyard
  B.box('asphalt', 0, 2075, W, 2225);                    // the road
  B.box('asphalt', 780, 1640, 1020, 2080);               // forecourt entry
  B.box('asphalt', 1620, 1440, 1780, 2080);              // diner drive
  B.box('gravel', 2560, 1720, 2760, 2080);               // truck lot drive
  B.box('concrete', 480, 1150, 1320, 1650);              // forecourt
  B.box('concrete', 660, 1260, 1140, 1560);              // canopy slab
  B.box('asphalt', 1380, 1150, 2040, 1450);              // diner parking
  B.box('concrete', 1540, 960, 1860, 1160);              // diner apron / porch
  B.box('asphalt', 440, 530, 1100, 690);                 // motel parking
  B.box('dirt', 1220, 620, 1600, 900);                   // RV pitch

  // ---- paint
  B.line('yellow_double', 0, 2150, W, 2150, 3);
  B.line('white', 0, 2081, W, 2081, 3);
  B.line('white', 0, 2219, W, 2219, 3);
  for (let x = 1420; x <= 2000; x += 58) {
    if (x > 1560 && x < 1840) continue;
    B.line('parking', x, 1160, x, 1235, 3);
  }
  for (let x = 1420; x <= 2000; x += 58) B.line('parking', x, 1440, x, 1370, 3);
  for (let x = 480; x <= 1060; x += 58) B.line('parking', x, 540, x, 610, 3);
  B.line('stop', 790, 2066, 1010, 2066, 6);
  B.line('stop', 1630, 2066, 1770, 2066, 6);

  // ---- fuel station: store, pump islands, canopy pillars, the fuel delivery
  B.ob('building', 880, 1040, 380, 170, 0, { color: '#b8ad98', roof: '#5b6770' });
  B.ob('container', 1130, 1060, 60, 34, Math.PI / 2, { color: '#d9d9d0', roof: '#c9c9c0' }); // propane cage
  B.ob('container', 620, 1080, 64, 36, 0, { color: '#2e5d3a', roof: '#294f33' });            // dumpster
  for (const x of [760, 900, 1040]) {
    for (const y of [1350, 1470]) B.ob('pump', x, y, 24, 46, 0, { color: rng.pick(['#b53a2e', '#c9c4b6', '#2f5f8a']) });
  }
  for (const [x, y] of [[680, 1280], [1120, 1280], [680, 1540], [1120, 1540]]) B.ob('pillar', x, y, 18, 18, 0);
  B.ob('tanker', 1245, 1450, 230, 60, -Math.PI / 2, { color: '#c4c7c9' });
  B.ob('semi', 1245, 1312, SEMI_CAB[0], SEMI_CAB[1], -Math.PI / 2, { color: rng.pick(SEMI_COLORS) });
  B.vehicle('car', 830, 1410, Math.PI / 2 + 0.05, { jitter: 0.5 });
  B.vehicle('pickup', 1105, 1600, 0.9, { wrecked: true, burning: true });   // ploughed into the canopy
  B.vehicle('suv', 560, 1590, -0.2, { wrecked: rng.chance(0.3) });

  // ---- diner surroundings
  B.ob('container', 1520, 895, 64, 36, 0, { color: '#2e5d3a', roof: '#294f33' });
  B.ob('container', 1885, 895, 64, 36, 0.1, { color: '#2e5d3a', roof: '#294f33' });
  B.vehicle('car', 1440, 1195, Math.PI / 2);
  B.vehicle('suv', 1960, 1195, Math.PI / 2 + 0.03);
  B.vehicle('car', 2010, 1405, -Math.PI / 2, { wrecked: true });
  B.vehicle('car', 1420, 1400, -Math.PI / 2 + 0.1);
  B.vehicle('pickup', 1560, 1405, -Math.PI / 2, { color: '#5a5a3c', jitter: 0 });  // supply pickup

  // ---- RV pitch between the store and the diner
  B.ob('bus', 1300, 700, 190, 56, 0.25, { color: '#d8d0bc' });
  B.ob('bus', 1500, 760, 170, 54, -0.15, { color: '#b9c2c4' });

  // ---- truck lot: chain-link fence and rigs in diagonal bays, nose to tail across the aisle
  B.runX('wall', 740, 2200, 3140, [[2560, 2720]], 6, { color: '#8a8f93', solid: false, maxLen: 320 });
  B.runY('wall', 3140, 740, 1720, [[1180, 1320]], 6, { color: '#8a8f93', solid: false, maxLen: 340 });
  B.runY('wall', 2200, 740, 1720, [[900, 1040], [1300, 1460]], 6, { color: '#8a8f93', solid: false, maxLen: 340 });
  const bayRow = (x0, y, ang, burningIndex) => {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    for (let i = 0; i <= 4; i++) {
      const mx = x0 + (i - 0.5) * 180;
      B.line('parking', mx - dx * 140, y - dy * 140, mx + dx * 140, y + dy * 140, 3);
    }
    for (let i = 0; i < 4; i++) {
      const roll = rng.next();
      if (roll < 0.12 && i !== burningIndex) continue;   // empty bay
      const burning = i === burningIndex;
      B.semi(x0 + i * 180, y, ang, rng.centered() * 0.05, {
        noCab: !burning && roll < 0.32, wrecked: burning || rng.chance(0.2), burning,
      });
    }
  };
  bayRow(2400, 1010, -Math.PI / 2 - 0.55, -1);
  bayRow(2350, 1480, Math.PI / 2 - 0.55, 2);
  B.ob('building', 2120, 1600, 150, 90, 0, { color: '#8c8478', roof: '#6b4a3a' });  // lot office
  B.vehicle('pickup', 2900, 1250, Math.PI / 2 + 0.2);

  // ---- billboard facing the road
  B.ob('wall', 2300, 1960, 240, 14, -0.12, { color: '#39424e', solid: true });

  // ---- motel, garage and junkyard to the north
  B.ob('building', 700, 440, 460, 120, 0, { color: '#a58f73', roof: '#6d5a4a' });
  B.ob('building', 1010, 400, 120, 200, 0, { color: '#a58f73', roof: '#6d5a4a' });
  B.vehicle('car', 540, 578, Math.PI / 2, { wrecked: true });
  B.vehicle('van', 770, 580, Math.PI / 2 - 0.05);
  B.vehicle('car', 950, 575, Math.PI / 2 + 0.1, { wrecked: rng.chance(0.5) });
  B.ob('building', 2400, 470, 240, 150, 0, { color: '#8d8a82', roof: '#4f5a60' });   // garage
  B.vehicle('car', 2330, 600, 0.05, { wrecked: true });
  for (const [x, y, a] of [[2720, 420, 0.4], [2850, 480, -0.9], [2980, 400, 2.3], [2780, 590, 1.2], [3000, 570, 0.1]]) {
    B.vehicle(rng.pick(['car', 'car', 'suv', 'pickup']), x, y, a, { wrecked: true });
  }

  // ---- road wrecks
  B.vehicle('car', 380, 2115, 0.2, { wrecked: true });
  B.vehicle('suv', 1260, 2185, Math.PI - 0.2, { wrecked: true, burning: true });
  B.vehicle('car', 2150, 2185, Math.PI + 0.15);
  B.vehicle('van', 2960, 2120, -0.3, { wrecked: true });
  B.semi(3190, 2185, Math.PI, 0.35, { wrecked: true });

  // ---- scrub and rock outcrops
  B.forest(250, 1100, 200, 300, 4, { spacing: 90 });
  B.forest(1900, 480, 250, 160, 4, { spacing: 90 });
  B.forest(3300, 1150, 90, 250, 3, { spacing: 90 });
  B.boulders(200, 230, 520, 420, 3, { min: 50, max: 90 });
  B.boulders(260, 1740, 660, 1950, 4, { min: 50, max: 90 });
  B.boulders(1900, 1650, 2500, 1950, 3, { min: 40, max: 70 });
  B.boulders(1150, 200, 1700, 500, 3, { min: 40, max: 80 });
  B.boulders(3200, 700, 3320, 1900, 3, { min: 40, max: 60 });

  // ---- lights: canopy floods, sodium lot lamps, neon, barrel fires
  for (const x of [760, 1040]) B.light(x, 1410, 230, '#f4efcf', 0);
  B.light(900, 1060, 170, '#bfe4ff', 0.1);
  B.light(DINER.x, DINER.y + 110, 200, '#ff7aa2', 0.25);  // neon sign
  B.light(DINER.x, DINER.y, 150, '#ffd9a0', 0.05);
  for (const [x, y] of [[1400, 1300], [2000, 1300], [2400, 1245], [2800, 1245], [1700, 1650], [900, 1760], [2660, 1800], [760, 700]]) {
    B.lamp(x, y, { color: SODIUM_COLOR, r: 240 });
  }
  B.fire(1400, 830, 12);   // campers' barrel
  B.fire(2470, 1245, 12);
  B.fire(2600, 620, 12);
  B.light(2120, 1600, 140, '#ffe2a0', 0.1);
  B.light(2400, 560, 130, '#cfe6ff', 0.3);

  // ---- decor
  B.skids(14, 400, 2090, 3200, 2210, 0);
  B.skids(8, 500, 1180, 1300, 1640, -0.3);
  B.cluster('oil', 12, 900, 1410, 260, { s: [0.8, 1.8] });
  B.cluster('oil', 14, 2660, 1245, 420, { s: [0.8, 1.8] });
  B.cluster('tire', 16, 2880, 500, 240);
  B.cluster('debris', 16, 2880, 500, 260);
  B.cluster('tire', 6, 2400, 600, 120);
  B.cluster('rubble', 10, 700, 440, 300);
  B.cluster('blood_old', 14, 1700, 1250, 300);
  B.cluster('paper', 20, 1700, 1300, 350);
  B.cluster('debris', 10, 1400, 760, 180);
  for (const [x, y] of [[1620, 1620], [1780, 1620], [800, 1700], [1000, 1700], [2600, 1760]]) B.decor('cone', x, y, B.drng.range(0, TAU), 1);
  for (const [x, y] of [[560, 1250], [1300, 1180], [1900, 1480], [2300, 1400]]) B.decor('manhole', x, y, 0, 1);
  B.decor('sign', 1500, 2020, 0, 1.4);
  B.decor('sign', 3000, 2030, 0, 1);
  B.decor('sign', 1180, 1700, 0, 1.2);
  B.decor('flag', 1110, 960, 0, 1);
  B.groundClutter({ cracks: 70, oil: 16, paper: 40, debris: 50, blood: 18, tires: 8, tufts: 170, bushes: 60, rocks: 70, tuftOn: ['sand', 'dirt', 'ground'] });
}

// ---------------------------------------------------------------------------------
// 3. Blackwater Bridge
//
// An 800 px river runs north-south through the middle. The one crossing is a 440 px
// concrete bridge; the APC sits on its crown. Both banks spawn zombies, and everything
// has to come over the bridge heads, which have sandbag positions for the defenders.

function buildBridge(B) {
  const { W, H, rng } = B;
  const RIVER_X0 = 1600, RIVER_X1 = 2400, DECK_Y0 = 780, DECK_Y1 = 1220, CY = 1000;
  const APC = { x: 2000, y: CY };
  B.objective('apc', 'Army APC', APC.x, APC.y, 150, 70, 0, 6000, 120);
  B.supply(1710, 1000);
  for (const [x, y] of [[1860, 880], [2000, 870], [2140, 880], [1860, 1120],
    [2000, 1130], [2140, 1120], [2220, 1000], [1790, 900]]) B.pspawn(x, y);
  // West bank
  B.zspawn(60, CY, 90, 500);
  B.zspawn(500, 60, 600, 90);
  B.zspawn(500, H - 60, 600, 90);
  B.zspawn(1300, 60, 280, 90);
  B.zspawn(1300, H - 60, 280, 90);
  // East bank
  B.zspawn(W - 60, CY, 90, 500);
  B.zspawn(3500, 60, 600, 90);
  B.zspawn(3500, H - 60, 600, 90);
  B.zspawn(2750, 60, 280, 90);
  B.zspawn(2750, H - 60, 280, 90);

  // ---- ground: banks, mud, then the river split by the bridge
  B.patches(['grass', 'grass', 'dirt'], 8, 150, 150, 1250, H - 150);
  B.patches(['grass', 'grass', 'dirt'], 8, 2850, 150, W - 150, H - 150);
  B.box('dirt', 1470, 0, RIVER_X0 + 20, H);
  B.box('dirt', RIVER_X1 - 20, 0, 2530, H);
  for (let i = 0; i < 6; i++) {
    B.area('sand', rng.range(1500, 1580), rng.range(220, H - 220), rng.range(60, 120), rng.range(120, 300), rng.range(-0.2, 0.2));
    B.area('sand', rng.range(2420, 2500), rng.range(220, H - 220), rng.range(60, 120), rng.range(120, 300), rng.range(-0.2, 0.2));
  }
  B.box('water', RIVER_X0, 0, RIVER_X1, DECK_Y0);
  B.box('water', RIVER_X0, DECK_Y1, RIVER_X1, H);
  // River roads on both banks, then the highway and bridge deck.
  B.box('gravel', 1300, 0, 1400, H);
  B.box('asphalt', 2640, 0, 2760, H);
  B.box('asphalt', 0, 850, RIVER_X0 - 60, 1150);
  B.box('asphalt', RIVER_X1 + 60, 850, W, 1150);
  B.box('concrete', RIVER_X0 - 80, DECK_Y0, RIVER_X1 + 80, DECK_Y1);
  B.box('asphalt', RIVER_X0 - 80, 820, RIVER_X1 + 80, 1180);
  B.area('concrete', 1530, 440, 220, 90, 0);   // boat ramp
  B.box('gravel', 1150, 300, 1300, 520);       // shack yard
  B.box('gravel', 2760, 1320, 3100, 1600);     // bait shop lot

  // ---- paint
  B.line('yellow_double', 0, CY, W, CY, 3);
  for (const y of [925, 1075]) B.line('white_dashed', 0, y, W, y, 3);
  B.line('white', 0, 856, RIVER_X0 - 60, 856, 3);
  B.line('white', 0, 1144, RIVER_X0 - 60, 1144, 3);
  B.line('white', RIVER_X1 + 60, 856, W, 856, 3);
  B.line('white', RIVER_X1 + 60, 1144, W, 1144, 3);
  B.line('white', RIVER_X0 - 80, 826, RIVER_X1 + 80, 826, 3);
  B.line('white', RIVER_X0 - 80, 1174, RIVER_X1 + 80, 1174, 3);
  B.line('yellow', 2700, 0, 2700, 850, 3);
  B.line('yellow', 2700, 1150, 2700, H, 3);
  B.line('stop', 2645, 840, 2695, 840, 5);
  B.line('crosswalk', 1320, 860, 1320, 1140, 40);
  B.line('crosswalk', 2700, 860, 2700, 1140, 40);

  // ---- bridge: rails over the water edges, sandbag positions at each head, wrecks
  B.run('guardrail', RIVER_X0 - 80, DECK_Y0 + 5, RIVER_X1 + 80, DECK_Y0 + 5, 10, { maxLen: 340 });
  B.run('guardrail', RIVER_X0 - 80, DECK_Y1 - 5, RIVER_X1 + 80, DECK_Y1 - 5, 10, { maxLen: 340 });
  // Approach rails steer the banks' traffic onto the carriageway.
  B.run('guardrail', 1440, 846, RIVER_X0 - 80, DECK_Y0 + 5, 8);
  B.run('guardrail', 1440, 1154, RIVER_X0 - 80, DECK_Y1 - 5, 8);
  B.run('guardrail', RIVER_X1 + 80, DECK_Y0 + 5, 2580, 846, 8);
  B.run('guardrail', RIVER_X1 + 80, DECK_Y1 - 5, 2580, 1154, 8);
  B.ob('sandbags', 1600, 860, 24, 110, 0);
  B.ob('sandbags', 1600, 1140, 24, 110, 0);
  B.ob('sandbags', 2400, 860, 24, 110, 0);
  B.ob('sandbags', 2400, 1140, 24, 110, 0);
  B.vehicle('car', 1650, 875, 0.18, { wrecked: true });
  B.vehicle('truck', 1700, 1130, 0.06, { color: '#556b2f', jitter: 0 });   // supply humvee
  B.vehicle('car', 2290, 880, Math.PI + 0.25, { wrecked: true, burning: true });
  B.vehicle('van', 2330, 1120, Math.PI - 0.12);

  // ---- west bank: wrecked convoy on the road, shack with boat ramp, woods
  B.vehicle('truck', 1080, 1080, 0.3, { wrecked: true, burning: true });
  B.vehicle('car', 860, 920, -0.4, { wrecked: true });
  B.vehicle('suv', 620, 1085, 0.1);
  B.vehicle('car', 380, 910, Math.PI + 0.3, { wrecked: true });
  B.vehicle('pickup', 1350, 1500, Math.PI / 2 + 0.2, { wrecked: true });
  B.ob('building', 1210, 400, 150, 110, 0.03, { color: '#6b5a44', roof: '#4a3f33' });     // shack
  B.vehicle('pickup', 1420, 520, 0.05, { color: '#3b4a3a' });
  B.ob('wall', 1170, 560, 220, 6, 0, { color: '#6b5433', solid: false });                  // shack fence
  B.forest(600, 420, 380, 220, 10);
  B.forest(600, 1560, 380, 230, 10);
  B.forest(1100, 1700, 160, 180, 3);

  // ---- east bank: roadblock, bait shop, woods
  B.ob('barrier', 2900, 900, 110, 18, Math.PI / 2 + 0.1);
  B.ob('barrier', 3080, 1090, 110, 18, Math.PI / 2 - 0.1);
  B.vehicle('truck', 3250, 900, Math.PI + 0.1, { wrecked: rng.chance(0.5) });
  B.vehicle('car', 3450, 1090, Math.PI - 0.2);
  B.vehicle('car', 3700, 920, Math.PI + 0.35, { wrecked: true });
  B.vehicle('suv', 2700, 1760, -Math.PI / 2 + 0.1, { wrecked: true });
  B.ob('building', 2960, 1440, 200, 120, 0, { color: '#7a6a55', roof: '#3f4a52' });       // bait shop
  B.vehicle('car', 3000, 1560, 0.05);
  B.forest(3450, 420, 380, 230, 10);
  B.forest(3450, 1560, 380, 230, 10);
  B.forest(2950, 300, 150, 180, 3);

  B.boulders(1450, 80, 1560, H - 80, 3, { avoid: ['water', 'asphalt', 'concrete'], min: 30, max: 50, spacing: 60 });
  B.boulders(2440, 80, 2560, H - 80, 3, { avoid: ['water', 'asphalt', 'concrete'], min: 30, max: 50, spacing: 60 });

  // ---- lights
  for (const x of [RIVER_X0 - 40, 1800, 2200, RIVER_X1 + 40]) {
    B.lamp(x, DECK_Y0 + 22, { color: '#ffd89a' });
    B.lamp(x, DECK_Y1 - 22, { color: '#ffd89a' });
  }
  for (const x of [400, 1000, 3000, 3600]) B.lamp(x, 1170, { color: SODIUM_COLOR, r: 230 });
  B.light(APC.x, APC.y, 180, '#a8d8ff', 0);
  B.light(1210, 480, 140, '#ffcf80', 0.2);
  B.light(2960, 1520, 150, '#ffcf80', 0.1);
  B.fire(1290, 330, 12);    // campfire by the shack
  B.fire(3120, 980, 14);    // barrel at the roadblock

  // ---- decor
  B.skids(16, 200, 860, 3800, 1140, 0);
  B.cluster('debris', 30, 2000, 1000, 420);
  B.cluster('blood_old', 16, 2000, 1000, 420);
  B.cluster('paper', 16, 2000, 1000, 380);
  B.cluster('debris', 12, 1000, 1000, 200);
  for (const [x, y] of [[2880, 1000], [2930, 1040], [3100, 960], [1540, 1000], [1560, 960]]) B.decor('cone', x, y, B.drng.range(0, TAU), 1);
  B.decor('sign', 1250, 1180, 0, 1.3);
  B.decor('sign', 2760, 820, Math.PI, 1.3);
  B.decor('flag', 2000, 1045, 0, 0.9, true);
  B.sprinkle('rock', 40, 1470, 0, 1600, H, { s: [0.5, 1.1] });
  B.sprinkle('rock', 40, 2400, 0, 2530, H, { s: [0.5, 1.1] });
  B.sprinkle('bush', 40, 1420, 0, 1500, H, { keep: true, s: [0.6, 1.1] });
  B.sprinkle('bush', 40, 2500, 0, 2600, H, { keep: true, s: [0.6, 1.1] });
  B.groundClutter({ cracks: 80, oil: 14, paper: 30, debris: 30, blood: 16, tires: 6, tufts: 300, bushes: 70, rocks: 30 });
}

// ---------------------------------------------------------------------------------
// 4. Checkpoint Delta
//
// Two highways cross in the middle of a HESCO-walled compound. Each road enters through
// a gate; two blast breaches in the wall give the horde extra ways in. The radio mast
// stands on the crossroads itself so every gate has a line of fire to it.

function buildCheckpoint(B) {
  const { W, H, rng } = B;
  const C = W / 2;                            // crossroads centre (square map)
  const R0 = C - 150, R1 = C + 150;           // road band (both roads)
  const K0 = C - 500, K1 = C + 500;           // compound wall centre lines
  const T = 44;                               // HESCO thickness
  const IN0 = K0 + T / 2, IN1 = K1 - T / 2;   // inner faces of the walls
  B.objective('radio', 'Radio Tower', C, C, 70, 70, 0, 4500, 140);
  B.supply(C - 230, C + 290);
  for (const [dx, dy] of [[-60, -150], [60, -150], [-60, 150], [60, 150],
    [-150, -60], [-150, 60], [150, -60], [150, 60]]) B.pspawn(C + dx, C + dy);
  B.zspawn(C, 60, 300, 90);
  B.zspawn(C, H - 60, 300, 90);
  B.zspawn(60, C, 90, 300);
  B.zspawn(W - 60, C, 90, 300);
  B.zspawn(190, 190, 260, 260);
  B.zspawn(W - 190, 190, 260, 260);
  B.zspawn(190, H - 190, 260, 260);
  B.zspawn(W - 190, H - 190, 260, 260);

  // ---- ground
  B.patches(['grass', 'grass', 'dirt'], 6, 200, 200, K0 - 200, K0 - 200);
  B.patches(['grass', 'grass', 'dirt'], 6, K1 + 200, 200, W - 200, K0 - 200);
  B.patches(['grass', 'grass', 'dirt'], 6, 200, K1 + 200, K0 - 200, H - 200);
  B.patches(['grass', 'grass', 'dirt'], 6, K1 + 200, K1 + 200, W - 200, H - 200);
  B.box('gravel', K0 - 80, K0 - 80, K1 + 80, K1 + 80);  // cleared strip round the walls
  B.box('dirt', K0, K0, K1, K1);                         // compound floor
  B.box('dirt', C + 900, C - 1150, C + 1250, C - 820);   // farmyard NE
  B.box('concrete', C - 1230, C + 760, C - 800, C + 1100); // gas station ruin SW
  B.box('asphalt', R0, 0, R1, H);
  B.box('asphalt', 0, R0, W, R1);
  B.box('concrete', C + 240, C - 440, C + 470, C - 210);  // helipad
  B.box('concrete', IN0, IN0, R0 - 20, C - 290);          // tent pad
  B.box('gravel', IN0, C + 220, R0 - 20, IN1);            // container yard
  B.box('gravel', R1 + 20, C + 220, IN1, IN1);            // motor pool

  // ---- paint: centre lines stop short of the crossroads, crosswalks round it
  for (const [a0, a1] of [[0, R0 - 60], [R1 + 60, H]]) {
    B.line('yellow_double', C, a0, C, a1, 3);
    B.line('yellow_double', a0, C, a1, C, 3);
    for (const o of [-75, 75]) {
      B.line('white_dashed', C + o, a0, C + o, a1, 3);
      B.line('white_dashed', a0, C + o, a1, C + o, 3);
    }
    for (const e of [R0 + 5, R1 - 5]) {
      B.line('white', e, a0, e, a1, 3);
      B.line('white', a0, e, a1, e, 3);
    }
  }
  B.line('crosswalk', R0, R0 - 30, R1, R0 - 30, 36);
  B.line('crosswalk', R0, R1 + 30, R1, R1 + 30, 36);
  B.line('crosswalk', R0 - 30, R0, R0 - 30, R1, 36);
  B.line('crosswalk', R1 + 30, R0, R1 + 30, R1, 36);
  B.line('stop', R0 + 5, R0 - 58, C, R0 - 58, 6);
  B.line('stop', C, R1 + 58, R1 - 5, R1 + 58, 6);
  B.line('stop', R0 - 58, C, R0 - 58, R1 - 5, 6);
  B.line('stop', R1 + 58, R0 + 5, R1 + 58, C, 6);
  // Helipad: square border and a big H.
  const HX = C + 355, HY = C - 325;
  B.line('yellow', HX - 100, HY - 100, HX + 100, HY - 100, 5);
  B.line('yellow', HX - 100, HY + 100, HX + 100, HY + 100, 5);
  B.line('yellow', HX - 100, HY - 100, HX - 100, HY + 100, 5);
  B.line('yellow', HX + 100, HY - 100, HX + 100, HY + 100, 5);
  B.line('white', HX - 45, HY - 60, HX - 45, HY + 60, 12);
  B.line('white', HX + 45, HY - 60, HX + 45, HY + 60, 12);
  B.line('white', HX - 45, HY, HX + 45, HY, 12);

  // ---- HESCO perimeter: gates on the roads, blast breaches in the west and east walls
  const gate = [R0 - 30, R1 + 30];
  B.runX('hesco', K0, K0 - T / 2, K1 + T / 2, [gate], T, { maxLen: 170 });
  B.runX('hesco', K1, K0 - T / 2, K1 + T / 2, [gate], T, { maxLen: 170 });
  B.runY('hesco', K0, IN0, IN1, [gate, [K0 + 110, K0 + 250]], T, { maxLen: 170 });
  B.runY('hesco', K1, IN0, IN1, [gate, [K1 - 250, K1 - 110]], T, { maxLen: 170 });

  // Guard booths just inside each gate.
  B.ob('booth', R1 + 50, IN0 + 38, 52, 52, 0);
  B.ob('booth', R0 - 50, IN1 - 38, 52, 52, 0);
  B.ob('booth', IN0 + 38, R0 - 50, 52, 52, 0);
  B.ob('booth', IN1 - 38, R1 + 50, 52, 52, 0);
  // Sandbag emplacements: one inside each gate, four round the mast.
  B.ob('sandbags', C, K0 + 180, 150, 24, 0);
  B.ob('sandbags', C, K1 - 180, 150, 24, 0);
  B.ob('sandbags', K0 + 180, C, 24, 150, 0);
  B.ob('sandbags', K1 - 180, C, 24, 150, 0);
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    B.ob('sandbags', C + dx * 150, C + dy * 150, 96, 22, Math.atan2(dy, dx) + Math.PI / 2);
  }
  // NW: tents along the north wall. SW: container stack in the corner.
  // SE: motor pool. NE: helipad (kept empty for the chopper that never came).
  B.ob('tent', IN0 + 78, IN0 + 46, 150, 88, 0);
  B.ob('tent', IN0 + 240, IN0 + 46, 120, 88, 0, { color: '#50593a', roof: '#606a42' });
  B.ob('sandbags', C - 300, C - 230, 100, 22, 0);
  B.ob('container', IN0 + 28, IN1 - 75, 150, 56, Math.PI / 2, { color: rng.pick(CONTAINER_COLORS) });
  B.ob('container', IN0 + 56 + 75, IN1 - 28, 150, 56, 0, { color: rng.pick(CONTAINER_COLORS) });
  B.ob('container', IN0 + 56 + 75, IN1 - 84, 150, 56, 0.02, { color: rng.pick(CONTAINER_COLORS) });
  B.ob('container', IN0 + 160, C + 250, 60, 42, 0, { color: '#4a4f35', roof: '#3f432d' });   // generator
  B.vehicle('truck', R1 + 110, C + 300, Math.PI / 2, { jitter: 0 });
  B.vehicle('truck', R1 + 220, C + 290, Math.PI / 2 + 0.08, { jitter: 0, wrecked: rng.chance(0.3) });
  B.ob('tent', R1 + 170, IN1 - 30, 130, 60, 0, { color: '#50593a', roof: '#606a42' });

  // ---- chicanes of jersey barriers outside each gate
  for (const s of [-1, 1]) {
    B.ob('barrier', C - 80, C + s * 650, 130, 20, 0);
    B.ob('barrier', C + 80, C + s * 760, 130, 20, 0);
    B.ob('barrier', C + s * 650, C + 80, 20, 130, 0);
    B.ob('barrier', C + s * 760, C - 80, 20, 130, 0);
  }

  // ---- queues on the inbound lanes; the outbound lanes stay open as firing lanes.
  // Traffic keeps right: southbound in the west lanes, eastbound in the south lanes, ...
  const LA = [C - 113, C - 38], LB = [C + 38, C + 113];
  const queue = (place) => {
    for (let i = 0; i < 5; i++) {
      const kind = rng.pick(['car', 'car', 'car', 'suv', 'pickup', 'van']);
      place(i, C - 850 - i * 105 - (i % 2) * 40, C + 850 + i * 105 + (i % 2) * 40, kind, rng.chance(0.25));
    }
  };
  queue((i, near, far, kind, wrecked) => B.vehicle(kind, LA[i % 2], near, Math.PI / 2, { wrecked, burning: i === 3 }));
  queue((i, near, far, kind, wrecked) => B.vehicle(kind, LB[i % 2], far, -Math.PI / 2, { wrecked, burning: i === 2 }));
  queue((i, near, far, kind, wrecked) => B.vehicle(kind, near, LB[i % 2], 0, { wrecked }));
  queue((i, near, far, kind, wrecked) => B.vehicle(kind, far, LA[i % 2], Math.PI, { wrecked, burning: i === 4 }));
  // Military vehicles abandoned outside the wire, in the outbound lanes.
  B.vehicle('truck', C + 90, C - 1100, -Math.PI / 2 + 0.3, { wrecked: true, burning: true });
  B.vehicle('truck', C + 1080, C + 90, 0.25, { wrecked: rng.chance(0.5) });
  B.vehicle('truck', C - 1100, C - 90, Math.PI + 0.2, { wrecked: true });

  // ---- corners: farm NE, gas station ruin SW, houses SE, woods
  B.ob('building', C + 1050, C - 1040, 220, 150, 0, { color: '#9a8f7e', roof: '#6e3b2f' });
  B.ob('building', C + 1280, C - 880, 150, 110, 0.05, { color: '#7d3a2c', roof: '#5a2b22' });
  B.ob('building', C - 1040, C + 840, 260, 110, 0, { color: '#b8ad98', roof: '#5b6770' });
  B.ob('pump', C - 1100, C + 1000, 24, 46, 0, { color: '#b53a2e' });
  B.ob('pump', C - 940, C + 1000, 24, 46, 0, { color: '#b53a2e' });
  B.vehicle('car', C - 880, C + 1060, 0.4, { wrecked: true });
  B.ob('building', C + 900, C + 880, 180, 140, 0.03, { color: '#8c7b6a', roof: '#4f4a52' });
  B.ob('building', C + 1200, C + 850, 160, 140, -0.02, { color: '#9a917f', roof: '#5a3f35' });
  B.ob('building', C + 960, C + 1200, 170, 130, 0, { color: '#7f8a7a', roof: '#4a3f33' });
  B.forest(C - 850, C - 950, 380, 330, 9);
  B.forest(C + 1000, C - 600, 300, 150, 3);
  B.forest(C - 950, C + 550, 300, 200, 5);
  B.forest(C + 750, C + 1150, 200, 250, 4);
  B.forest(C + 1350, C + 500, 180, 250, 4);
  B.boulders(150, 150, W - 150, H - 150, 5);

  // ---- lights: floodlights on the wall corners, lamps along the roads, barrel fires
  for (const [x, y] of [[IN0 + 18, IN0 + 18], [IN1 - 18, IN0 + 18], [IN0 + 18, IN1 - 18], [IN1 - 18, IN1 - 18]]) {
    B.decor('lamp_post', x, y, 0, 1.2);
    B.light(x, y, 320, FLOOD_COLOR, 0);
  }
  B.light(C, C, 160, '#ff5a4a', 0.35);    // mast warning beacon
  B.light(HX, HY, 150, '#c8e0ff', 0);
  for (const d of [650, 1000, 1350]) {
    B.lamp(R0 - 40, C - d);
    B.lamp(R1 + 40, C + d);
    B.lamp(C + d, R0 - 40);
    B.lamp(C - d, R1 + 40);
  }
  B.fire(C - 190, C - 330, 12);
  B.fire(C + 330, C + 440, 12);
  B.light(C + 1050, C - 950, 140, '#ffcf80', 0.15);

  // ---- decor
  B.skids(12, R0, 200, R1, K0 - 100, Math.PI / 2);
  B.skids(12, R0, K1 + 100, R1, H - 200, -Math.PI / 2);
  B.skids(12, 200, R0, K0 - 100, R1, 0);
  B.skids(12, K1 + 100, R0, W - 200, R1, Math.PI);
  B.cluster('rubble', 10, K0, K0 + 180, 90);
  B.cluster('rubble', 10, K1, K1 - 180, 90);
  B.cluster('debris', 30, C, C, 480);
  B.cluster('blood_old', 20, C, C, 700);
  B.cluster('paper', 26, C, C, 600);
  for (let i = 0; i < 6; i++) {
    B.decor('cone', C - 130 + i * 52, K0 - 60, 0, 1);
    B.decor('cone', C - 130 + i * 52, K1 + 60, 0, 1);
  }
  for (const [x, y] of [[C - 170, IN0 + 110], [R1 + 60, IN1 - 90], [IN1 - 20, IN0 + 90]]) B.decor('flag', x, y, 0, 1);
  for (const [x, y] of [[C - 75, K0 - 200], [C + 75, K1 + 200], [K0 - 200, C + 75], [K1 + 200, C - 75]]) B.decor('manhole', x, y, 0, 1);
  B.decor('sign', R0 - 40, 300, 0, 1.3);
  B.decor('sign', R1 + 40, H - 300, 0, 1.3);
  B.decor('sign', 300, R1 + 40, 0, 1.3);
  B.decor('sign', W - 300, R0 - 40, 0, 1.3);
  B.groundClutter({ cracks: 80, oil: 18, paper: 30, debris: 40, blood: 20, tires: 8, tufts: 280, bushes: 70, rocks: 40 });
  B.sprinkle('rubble', 16, K0 - 60, K0 - 60, K1 + 60, K1 + 60, { off: ['asphalt'], s: [0.5, 0.9] });
}
