// Automatic decal placement for the maps that have no hand-placed set (the match maps, the campaign):
// grime at the foot of walls, water stains and rust running from the tops, posters and graffiti on
// the faces people walk past, cracks and bullet holes, rust and tags on containers, and on the
// ground oil and tyre marks on the asphalt, cracks in the concrete, puddles, litter by the buildings,
// leaves under the trees and blood where the wrecks are. A pure function of the MapDef (seeded by its
// id and seed), like the set dressing, so every peer and every run gets the same decals.
//
// Every entry carries a rank q in [0, 1): a tier keeps those with q < its share (decals.js), so the
// thinned sets are nested.

import { DECALS, DECAL_TAGS } from './decals-manifest.js';
import { facesOf, insideOb, isWallLike } from '../shared/decals.js';

function rngOf(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, range: (a, b) => a + (b - a) * next(), chance: (p) => next() < p, pick: (arr) => arr[Math.floor(next() * arr.length) % arr.length] };
}
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

const tag = (t) => (DECAL_TAGS[t] || []).filter((id) => DECALS[id]);
const without = (ids, re) => ids.filter((id) => !re.test(id));
// (story decals stay where the story put them: no notes, no names of the cast on a random wall)
const STORYISH = /note\.|june|mara|radio|haven|delta|ruth|deke|missing-hand|xcode/;

/**
 * @param {object} map MapDef
 * @param {object} [opts] { heightOf(o) → top of an obstacle, own (hand-placed decals: no auto
 *   decal goes within 30 units of one) , theme 'town' | 'desert' }
 * @returns {object[]} decals (shared/decals.js format) each with a rank q
 */
export function autoDecals(map, opts = {}) {
  const rng = rngOf(hashStr(`${map.id}:decals:${map.seed | 0}`));
  const out = [];
  const desert = opts.theme === 'desert' || !!(map.look && map.look.grass === false);
  const heightOf = opts.heightOf || ((o) => (o.kind === 'building' ? 160 : o.kind === 'container' ? 80 : 90));
  const pools = {
    grime: tag('base').filter((id) => /^grime\.base|^stain\.damp/.test(id)),
    poster: without(tag('poster'), STORYISH).filter((id) => !/quarantine|torn-layers/.test(id) || /torn-layers/.test(id)),
    graffiti: without(tag('graffiti'), STORYISH).filter((id) => !/symbol|tally/.test(id) || /skull/.test(id)),
    message: without(tag('message'), STORYISH),
    stainTop: ['stain.water', 'soot.streak1', 'soot.streak2'].filter((id) => DECALS[id]),
    rust: tag('rust'),
    crack: tag('crack').filter((id) => /wall/.test(id)).concat(tag('spall')),
    holes: ['holes.concrete', 'holes.concrete-line', 'holes.plaster'].filter((id) => DECALS[id]),
    holesMetal: ['holes.metal', 'holes.metal-line'].filter((id) => DECALS[id]),
    tags: tag('tag'),
    blood: ['blood.spray', 'blood.hands', 'blood.drips', 'blood.spray.dry', 'blood.hands.dry'].filter((id) => DECALS[id]),
    peel: tag('peel'),
    moss: tag('moss'),
  };
  const own = opts.own || [];
  const near = (x, y, r, list) => list.some((d) => Math.abs(d.x - x) < r && Math.abs(d.y - y) < r);
  const inMap = (x, y, m = 10) => x > m && y > m && x < map.width - m && y < map.height - m;
  // obstacles by grid cell for the "is this spot free" tests
  const G = 256, grid = new Map();
  for (const o of map.obstacles) {
    const r = Math.hypot(o.w, o.h) / 2;
    for (let gy = Math.floor((o.y - r) / G); gy <= Math.floor((o.y + r) / G); gy++) for (let gx = Math.floor((o.x - r) / G); gx <= Math.floor((o.x + r) / G); gx++) {
      const k = gy * 4096 + gx;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(o);
    }
  }
  const blocked = (x, y, pad, self) => {
    const l = grid.get(Math.floor(y / G) * 4096 + Math.floor(x / G));
    if (l) for (const o of l) if (o !== self && insideOb(o, x, y, pad)) return true;
    return false;
  };
  const waters = map.areas.filter((a) => a.kind === 'water');
  const wet = (x, y) => waters.some((a) => insideOb(a, x, y, 20));
  const push = (d, q) => { out.push({ ...d, q }); };

  // ---- faces of buildings, walls and containers ------------------------------------------------
  for (const o of map.obstacles) {
    const container = o.kind === 'container' && Math.max(o.w, o.h) > 72;
    if (!container && !isWallLike(o)) continue;
    const top = heightOf(o);
    if (!(top > 30)) continue;
    for (const f of facesOf(o)) {
      if (f.len < 70) continue;
      const free = (t, half) => [-0.9, 0, 0.9].every((k) => {
        const px = f.cx + f.tx * (t + k * half) + f.nx * 6, py = f.cy + f.ty * (t + k * half) + f.ny * 6;
        return inMap(px, py) && !blocked(px, py, 0, o) && !wet(px, py);
      });
      const taken = [];   // [t, half w, z, half h] of this face's decals: no two overlap (except the grime band)
      const wall = (id, t, z, w, h, q, extra = {}) => {
        if (!DECALS[id]) return;
        const half = (w || DECALS[id][5]) / 2, hh = (h || DECALS[id][6]) / 2;
        if (Math.abs(t) > f.len / 2 - half - 2 || !free(t, half)) return;
        if (!/^grime\.base|^stain\.damp/.test(id)) {
          if (taken.some(([t2, h2, z2, v2]) => Math.abs(t2 - t) < half + h2 - 1 && Math.abs(z2 - z) < hh + v2 - 1)) return;
          taken.push([t, half, z, hh]);
        }
        const x = f.cx + f.tx * t, y = f.cy + f.ty * t;
        if (near(x, y, 30, own)) return;
        push({ id, x, y, z, a: extra.a || 0, nx: f.nx, ny: f.ny, w: w || 0, h: h || 0, o: o.id }, q);
      };
      if (container) {
        if (rng.chance(0.55)) wall(rng.pick(pools.rust), rng.range(-0.35, 0.35) * f.len, top - 16, 0, 0, rng.range(0, 0.6));
        if (rng.chance(0.25)) wall(rng.pick(pools.tags), rng.range(-0.25, 0.25) * f.len, 30, 0, 0, rng.range(0.2, 1));
        if (rng.chance(0.15)) wall(rng.pick(pools.holesMetal), rng.range(-0.3, 0.3) * f.len, rng.range(20, 50), 0, 0, rng.range(0.3, 1));
        continue;
      }
      // grime along the foot of the wall
      const step = 104;
      for (let t = -f.len / 2 + 52; t < f.len / 2 - 40; t += step) {
        if (rng.chance(desert ? 0.3 : 0.7)) wall(rng.pick(pools.grime), t + rng.range(-6, 6), 12.5, Math.min(100, f.len - 6), 0, rng.range(0, 0.7));
      }
      if (desert) {
        if (rng.chance(0.25)) wall(rng.pick(pools.crack), rng.range(-0.3, 0.3) * f.len, rng.range(25, Math.max(30, top - 40)), 0, 0, rng.range(0.1, 1));
        if (rng.chance(0.2)) wall(rng.pick(pools.holes), rng.range(-0.3, 0.3) * f.len, rng.range(20, 60), 0, 0, rng.range(0.2, 1));
        if (rng.chance(0.08)) wall(rng.pick(pools.graffiti), rng.range(-0.25, 0.25) * f.len, 40, 0, 0, rng.range(0.3, 1));
        continue;
      }
      // a poster wall: a run of bills at head height
      if (f.len >= 110 && rng.chance(o.kind === 'building' ? 0.38 : 0.2)) {
        const n = 1 + Math.floor(rng.next() * Math.min(4, f.len / 50));
        const t0 = rng.range(-0.3, 0.3) * f.len;
        const q = rng.range(0, 0.9);
        for (let k = 0; k < n; k++) wall(rng.pick(pools.poster), t0 + (k - (n - 1) / 2) * 17.5, 40 + rng.range(-3, 3), 0, 0, q, { a: rng.range(-0.04, 0.04) });
      }
      if (rng.chance(o.kind === 'wall' ? 0.35 : 0.28)) {
        const id = rng.chance(0.3) ? rng.pick(pools.message) : rng.pick(pools.graffiti);
        wall(id, rng.range(-0.3, 0.3) * f.len, Math.min(top - 25, 34 + rng.range(0, 14)), 0, 0, rng.range(0.05, 1));
      }
      if (top > 110 && rng.chance(0.3)) {
        const id = rng.pick(pools.stainTop);
        const h = DECALS[id][6];
        wall(id, rng.range(-0.35, 0.35) * f.len, id.startsWith('soot') ? rng.range(70, top - h / 2 - 2) : top - h / 2 - 3, 0, 0, rng.range(0.1, 1));
      }
      if (rng.chance(0.18)) wall(rng.pick(pools.crack), rng.range(-0.35, 0.35) * f.len, rng.range(25, Math.max(30, Math.min(90, top - 25))), 0, 0, rng.range(0.2, 1));
      if (rng.chance(0.12)) wall(rng.pick(pools.holes), rng.range(-0.35, 0.35) * f.len, rng.range(25, 60), 0, 0, rng.range(0.3, 1));
      if (rng.chance(0.08)) wall(rng.pick(pools.peel), rng.range(-0.35, 0.35) * f.len, rng.range(30, 70), 0, 0, rng.range(0.4, 1));
      if (rng.chance(0.07)) wall(rng.pick(pools.blood), rng.range(-0.3, 0.3) * f.len, rng.range(30, 45), 0, 0, rng.range(0.2, 1));
      if (rng.chance(0.1)) wall(rng.pick(pools.moss), rng.range(-0.35, 0.35) * f.len, 16, 0, 0, rng.range(0.4, 1));
    }
  }

  // ---- the ground ------------------------------------------------------------------------------
  const floor = (id, x, y, a, q, w = 0, h = 0) => {
    if (!DECALS[id] || !inMap(x, y, 40)) return;
    const r = Math.max(w || DECALS[id][5], h || DECALS[id][6]) * 0.45;
    if (blocked(x, y, Math.min(r, 20), null) || wet(x, y) || near(x, y, 20, own)) return;
    push({ id, x, y, z: 0, a, nx: 0, ny: 0, w, h }, q);
  };
  const areaPts = (kinds, per) => {
    const pts = [];
    for (const a of map.areas) {
      if (!kinds.includes(a.kind)) continue;
      const n = Math.min(40, Math.round((a.w * a.h) / per * (0.6 + rng.next() * 0.8)));
      const c = Math.cos(a.a || 0), s = Math.sin(a.a || 0);
      for (let i = 0; i < n; i++) {
        const lx = rng.range(-0.45, 0.45) * a.w, ly = rng.range(-0.45, 0.45) * a.h;
        pts.push([a.x + lx * c - ly * s, a.y + lx * s + ly * c, a.a || 0]);
      }
    }
    return pts;
  };
  for (const [x, y, aa] of areaPts(['asphalt'], 260000)) {
    const r = rng.next();
    if (r < 0.35) floor(rng.pick(tag('oil')), x, y, rng.range(0, 6.28), rng.range(0, 1));
    else if (r < 0.55) floor('tyre.skid', x, y, aa + rng.range(-0.25, 0.25) + (rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2), rng.range(0, 1));
    else if (r < 0.75) floor(rng.pick(['crack.floor1', 'crack.floor2']), x, y, rng.range(0, 6.28), rng.range(0, 1));
    else if (r < 0.9) floor(rng.pick(['puddle.rim1', 'puddle.rim2']), x, y, rng.range(0, 6.28), rng.range(0.1, 1));
    else floor(rng.pick(['blood.pool', 'blood.drag', 'blood.splat2', 'blood.pool.dry']), x, y, rng.range(0, 6.28), rng.range(0.2, 1));
  }
  for (const [x, y] of areaPts(['concrete', 'gravel'], 200000)) {
    const r = rng.next();
    if (r < 0.4) floor(rng.pick(['crack.floor1', 'crack.floor2']), x, y, rng.range(0, 6.28), rng.range(0, 1));
    else if (r < 0.65) floor(rng.pick(tag('oil')), x, y, rng.range(0, 6.28), rng.range(0, 1));
    else if (r < 0.85) floor(rng.pick(tag('litter')), x, y, rng.range(0, 6.28), rng.range(0, 1));
    else floor(desert ? rng.pick(tag('sand')) : 'grime.patch', x, y, rng.range(0, 6.28), rng.range(0.2, 1));
  }
  // by the buildings: litter and puddles; under trees: leaves; by the wrecks: blood
  for (const o of map.obstacles) {
    if (o.kind === 'building' && rng.chance(0.6)) {
      const f = rng.pick(facesOf(o));
      const t = rng.range(-0.4, 0.4) * f.len, d = rng.range(26, 60);
      floor(rng.pick(desert ? tag('sand') : tag('litter').concat(['dust.drift'])), f.cx + f.tx * t + f.nx * d, f.cy + f.ty * t + f.ny * d, Math.atan2(f.ty, f.tx), rng.range(0, 1));
    } else if (o.kind === 'tree' && !desert && rng.chance(0.3)) {
      floor(rng.pick(tag('leaves')), o.x + rng.range(-40, 40), o.y + rng.range(-40, 40), rng.range(0, 6.28), rng.range(0.1, 1));
    } else if ((o.kind === 'car' || o.kind === 'suv' || o.kind === 'van' || o.kind === 'pickup') && rng.chance(0.12)) {
      const a = (o.a || 0) + (rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2);
      const d = o.h / 2 + rng.range(20, 50);
      floor(rng.pick(['blood.pool', 'blood.splat1', 'blood.splat3', 'blood.drag', 'glass.shards', 'oil.1']), o.x + Math.cos(a) * d, o.y + Math.sin(a) * d, rng.range(0, 6.28), rng.range(0, 1));
    }
  }
  // stable order: walls and floors as generated; ranks decide what a tier keeps
  return out;
}
