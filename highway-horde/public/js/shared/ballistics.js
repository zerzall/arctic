// First-person bullets through the world (SPEC §3.4 "Gunplay"): a ray from the shooter's eye
// along its aim, yaw and pitch, against the map's obstacles at their real heights and against
// the ground, with Counter-Strike-like wall penetration. Shared by the simulation
// (sim/combat.js) and the clients' shot prediction.
//
// The ray: from (x, y) at height z0 along the unit horizontal direction (dx, dy), rising k per
// unit (k = tan(pitch)); every distance here is the horizontal distance s along it.
//
// Obstacles: an obstacle stops (or is penetrated by) the bullet only where the bullet is
// below its top (shotTop: the rendered height, so a shot over a car's bonnet flies on and
// one aimed at the legs of a zombie behind it hits the car). Water never stops a bullet in
// flight (the ground under it does). Penetration: a bullet carries `power` (handling `pen`:
// pistols and SMGs 1, rifles 2, snipers 3, the .50 5); crossing an obstacle costs its
// material's base cost plus a cost per unit of depth (penCost: chain-link fences and tents
// next to nothing, car bodies and thin metal ~1.2-1.6, drywall ~1.2, brick and concrete 2.4 and
// up, buildings and rocks everything). With power left it goes on and its damage drops
// (DAMAGE_PER_COST of the cost relative to the power it started with, plus PEN_LOSS a wall).

import { MASK_MOVE, MASK_WATER, MASK_OBJECTIVE } from './geom.js';
import { Z_UNIT } from './jump.js';

/** Damage kept through a wall: 1 - PEN_LOSS - DAMAGE_PER_COST × cost / power at the muzzle. */
export const PEN_LOSS = 0.1;
export const DAMAGE_PER_COST = 0.45;
/** Never less than this share of the damage after a penetration. */
export const PEN_MIN = 0.2;
/** At most this many obstacles in one bullet's path. */
export const MAX_PEN = 4;

/** Height (above its base) a bullet must clear to fly over an obstacle of each kind. */
const SHOT_TOP = {
  car: 44, suv: 56, pickup: 52, van: 72, truck: 100, bus: 100, tanker: 112,
  barrier: 26, sandbags: 30, guardrail: 22, pump: 52, hesco: 70, tent: 80, booth: 90,
  grave: 30, desk: 30, counter: 40, cabinet: 70, hvac: 56, parapet: 44,
};

/**
 * Height above its base that a bullet must clear to fly over MapDef obstacle `o`
 * (Infinity: buildings, trees, tall walls, pillars, the objective).
 * @param {object} o
 * @returns {number}
 */
export function shotTop(o) {
  if (!o || typeof o.kind !== 'string') return Infinity;
  const k = o.kind;
  if (k === 'semi') return o.w <= 100 ? 110 : 124;
  if (k === 'container') return Math.max(o.w, o.h) <= 72 ? 62 : 84;
  if (k === 'rock') return Math.max(16, Math.min(30, 10 + Math.min(o.w, o.h) * 0.4));
  if (k === 'wall') {
    if (o.walkin !== undefined && Number.isFinite(o.top)) return o.top;
    return Math.min(o.w, o.h) <= 8 ? 40 : 90;
  }
  if ((k === 'pier' || k === 'ramp') && Number.isFinite(o.top)) return o.top;
  const t = SHOT_TOP[k];
  return t > 0 ? t : Infinity;
}

/** Material [base cost, cost per unit of depth] per kind (Infinity: nothing gets through). */
const PEN_COST = {
  car: [1.2, 0], suv: [1.4, 0], pickup: [1.4, 0], van: [1.5, 0], bus: [1.6, 0], truck: [2.2, 0], semi: [2.4, 0], tanker: [3.5, 0],
  pump: [1.2, 0], booth: [2.4, 0], tent: [0.15, 0], guardrail: [0.7, 0],
  barrier: [4, 0.02], sandbags: [3.4, 0.02], hesco: [4.5, 0.02], rock: [5, 0.02], grave: [4, 0.02],
  tree: [0.6, 0.06], palisade: [0.4, 0.04], watchtower: [0.5, 0.05], desk: [0.6, 0.03], counter: [0.8, 0.03],
  cabinet: [1.0, 0.02], hvac: [1.2, 0.02], parapet: [3, 0.05],
  pillar: [2.4, 0.06], pier: [2.4, 0.06], ramp: [2.4, 0.06], stairs: [2.4, 0.06], iwall: [1.4, 0.05], ipillar: [2.4, 0.06],
  silo: [2.6, 0.06], tower: [2.6, 0.06], mast: [2.0, 0.05], rim: [2.4, 0.06],
};

/**
 * Penetration cost of crossing MapDef obstacle `o` over `depth` units of the bullet's path.
 * @param {object} o
 * @param {number} depth
 * @returns {number} Infinity when nothing gets through
 */
export function penCost(o, depth) {
  if (!o || typeof o.kind !== 'string') return Infinity;
  const k = o.kind;
  if (k === 'building' || k === 'objective') return Infinity;
  if (k === 'container') return Math.max(o.w, o.h) <= 72 ? 1.6 : 1.3;
  if (k === 'wall') {
    const t = Math.min(o.w, o.h);
    if (t <= 8) return 0.25;                    // chain-link fence
    if (t <= 11) return 0.8 + 0.04 * depth;     // drywall partitions, planks
    return 1.6 + 0.05 * depth;                  // brick and concrete
  }
  const c = PEN_COST[k];
  return c ? c[0] + c[1] * depth : Infinity;
}

/** Damage multiplier after crossing an obstacle of penetration cost `cost` with a bullet of muzzle power `power`. */
export function penDamage(cost, power) {
  if (!(power > 0) || !Number.isFinite(power)) return 1 - PEN_LOSS * 0.5;
  return Math.max(PEN_MIN, 1 - PEN_LOSS - DAMAGE_PER_COST * cost / power);
}

const EPS = 1e-9;

/** The shot height of a collider box (cached on it): absolute, its base included. */
function topOf(box) {
  let t = box.shotTop;
  if (t === undefined) {
    const o = box.ref;
    if (box.mask & MASK_OBJECTIVE) t = Infinity;
    else {
      t = shotTop(o);
      if (Number.isFinite(box.top) && t !== Infinity) t = Math.max(t, box.top - box.baseQ * Z_UNIT);
      if (Number.isFinite(t)) t += box.baseQ * Z_UNIT;
    }
    box.shotTop = t;
  }
  return t;
}

/** Entry / exit of the 2D ray through box `ob` (slab test), written to _c; false on a miss within maxT. */
const _c = { t1: 0, t2: 0 };
function crossing(ob, ox, oy, dx, dy, maxT) {
  const rx = ox - ob.x, ry = oy - ob.y;
  const lx = rx * ob.c + ry * ob.s, ly = -rx * ob.s + ry * ob.c;
  const ldx = dx * ob.c + dy * ob.s, ldy = -dx * ob.s + dy * ob.c;
  let t1 = -Infinity, t2 = Infinity;
  if (Math.abs(ldx) < EPS) {
    if (lx < -ob.hw || lx > ob.hw) return false;
  } else {
    let a = (-ob.hw - lx) / ldx, b = (ob.hw - lx) / ldx;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > t1) t1 = a;
    if (b < t2) t2 = b;
  }
  if (Math.abs(ldy) < EPS) {
    if (ly < -ob.hh || ly > ob.hh) return false;
  } else {
    let a = (-ob.hh - ly) / ldy, b = (ob.hh - ly) / ldy;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > t1) t1 = a;
    if (b < t2) t2 = b;
  }
  if (t2 < 0 || t1 > t2 || t1 > maxT) return false;
  _c.t1 = t1 < 0 ? 0 : t1;
  _c.t2 = t2;
  return true;
}

/** A trace result (reuse one per caller): see traceShot. */
export function createTrace() {
  return {
    stop: 0, hit: 0, ground: false, top: false, h: 0, obs: null, n: 0,
    at: new Float64Array(MAX_PEN), mult: new Float64Array(MAX_PEN), obj: new Array(MAX_PEN).fill(null),
    exitAt: new Float64Array(MAX_PEN), power: 0,
    // scratch of the crossings waiting to be judged (sorted by entry)
    _box: [], _t1: [], _t2: [],
  };
}

/**
 * Trace one bullet (see the header). Writes into `out`: stop (distance where it ends), hit (2
 * when an obstacle or the ground stopped it, 0 at range), ground (it ended in the ground), top
 * (it ended on an obstacle's top face), h (its height there), obs (the stopping collider box or
 * null), n + at[i] / exitAt[i] / mult[i] / obj[i] (the obstacles it went through: where it
 * entered and left each and the damage share it kept after it, cumulative), power (left).
 * @param {CollisionWorld} world
 * @param {number} power penetration power (0: stops at the first obstacle)
 * @returns {object} out
 */
export function traceShot(world, x, y, z0, dx, dy, k, range, power, out) {
  out.stop = range;
  out.hit = 0;
  out.ground = false;
  out.top = false;
  out.obs = null;
  out.n = 0;
  out.power = power;
  const p0 = power;
  // the ground: the flat ground at 0, a campaign map's terrain by marching down the slope
  let maxT = range;
  const terrain = world.terrain;
  if (!terrain || terrain.flat) {
    if (k < -1e-9) {
      const tg = -z0 / k;
      if (tg < maxT) { maxT = tg; out.ground = true; }
    }
  } else {
    const step = 8;
    for (let t = step; t <= range + step; t += step) {
      const tt = Math.min(t, range);
      const gx = x + dx * tt, gy = y + dy * tt;
      const gh = terrain.height(gx, gy);
      if (z0 + k * tt <= gh) {
        // refine between the last two samples
        let lo = tt - step, hi = tt;
        for (let i = 0; i < 6; i++) {
          const m = (lo + hi) / 2;
          if (z0 + k * m <= terrain.height(x + dx * m, y + dy * m)) hi = m; else lo = m;
        }
        maxT = Math.max(0, hi);
        out.ground = true;
        break;
      }
      if (tt >= range) break;
    }
  }
  const idx = world.index;
  const st = idx._nextStamp();
  const stamps = idx.stamps;
  const cs = idx.cs;
  let cx = idx._cx(x), cy = idx._cy(y);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  let tMaxX = adx < EPS ? Infinity : ((cx + (dx > 0 ? 1 : 0)) * cs + idx.ox - x) / dx;
  let tMaxY = ady < EPS ? Infinity : ((cy + (dy > 0 ? 1 : 0)) * cs + idx.oy - y) / dy;
  if (tMaxX < 0) tMaxX = Infinity;
  if (tMaxY < 0) tMaxY = Infinity;
  const tDX = adx < EPS ? Infinity : cs / adx, tDY = ady < EPS ? Infinity : cs / ady;
  const pb = out._box, p1 = out._t1, p2 = out._t2;
  pb.length = 0;
  p1.length = 0;
  p2.length = 0;
  const slope = Math.sqrt(1 + k * k);
  let done = false;
  for (;;) {
    const c = cy * idx.cols + cx;
    for (let i = idx.start[c], e = idx.start[c + 1]; i < e; i++) {
      const oi = idx.items[i];
      if (stamps[oi] === st) continue;
      stamps[oi] = st;
      const ob = idx.obbs[oi];
      if (!(ob.mask & MASK_MOVE) || (ob.mask & MASK_WATER)) continue;
      if (!crossing(ob, x, y, dx, dy, maxT)) continue;
      // keep the pending list sorted by entry (it holds a handful)
      let j = pb.length;
      pb.push(ob); p1.push(_c.t1); p2.push(_c.t2);
      while (j > 0 && p1[j - 1] > _c.t1) {
        pb[j] = pb[j - 1]; p1[j] = p1[j - 1]; p2[j] = p2[j - 1];
        j--;
      }
      pb[j] = ob; p1[j] = _c.t1; p2[j] = _c.t2;
    }
    const tNext = tMaxX < tMaxY ? tMaxX : tMaxY;
    const last = tNext > maxT;
    // every crossing entering before the next cell is known now: judge them in order
    let used = 0;
    while (used < pb.length && (last || p1[used] <= tNext)) {
      const ob = pb[used], t1 = p1[used], t2 = Math.min(p2[used], maxT);
      used++;
      const top = topOf(ob);
      const h1 = z0 + k * t1, h2 = z0 + k * t2;
      if (Math.min(h1, h2) >= top) continue;            // flies over it
      // where it meets the obstacle: its side, or its top face coming down onto it
      let tin = t1, tout = t2, onTop = false;
      if (h1 >= top) { tin = (top - z0) / k; onTop = true; }
      else if (h2 >= top) tout = (top - z0) / k;
      const depth = Math.max(0, tout - tin) * slope;
      const cost = ob.mask & MASK_OBJECTIVE ? Infinity : penCost(ob.ref, depth);
      if (out.n < MAX_PEN && cost <= power && !onTop) {
        power -= cost;
        out.at[out.n] = tin;
        out.exitAt[out.n] = tout;
        out.obj[out.n] = ob;
        out.mult[out.n] = (out.n ? out.mult[out.n - 1] : 1) * penDamage(cost, p0);
        out.n++;
        continue;
      }
      out.stop = tin;
      out.hit = 2;
      out.ground = false;
      out.top = onTop;
      out.obs = ob;
      done = true;
      break;
    }
    if (done) break;
    if (used) {
      pb.splice(0, used);
      p1.splice(0, used);
      p2.splice(0, used);
    }
    if (last) break;
    if (tMaxX < tMaxY) {
      cx += stepX;
      if (cx < 0 || cx >= idx.cols) break;
      tMaxX += tDX;
    } else {
      cy += stepY;
      if (cy < 0 || cy >= idx.rows) break;
      tMaxY += tDY;
    }
  }
  if (!done && out.ground) {
    out.stop = maxT;
    out.hit = 2;
  }
  out.power = power;
  out.h = z0 + k * out.stop;
  return out;
}

/** Walls a bullet went through before distance t (out of a traceShot result). */
export function wallsBefore(tr, t) {
  let n = 0;
  while (n < tr.n && tr.at[n] < t) n++;
  return n;
}

/** Damage share a bullet kept at distance t (1 before any wall). */
export function multAt(tr, t) {
  const n = wallsBefore(tr, t);
  return n ? tr.mult[n - 1] : 1;
}
