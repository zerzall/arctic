// The two projectiles with physics of their own (weapons.js projectile kinds 'blade' and
// 'singularity'): the saw-blade launcher's blades, which slice through zombies and ricochet
// off walls, and the Hollow Star's orb, which drags the horde into itself and collapses.
// Deterministic: they read and write sim state only (no randomness), so a seeded game
// replays them exactly.

import { DT } from '../constants.js';
import { rayCircle, MASK_SOLID } from '../geom.js';
import { damageZombie, knockZombie, MAX_ZOMBIE_RADIUS } from './combat.js';

/** Zombie modes (sim/zombies.js): the orb only grabs walkers going about their business. */
const MODE_NORMAL = 0;
const MODE_STUN = 3;
/** A blade's cuts that cost more of its budget: heavies (mass ≥ HEAVY_MASS) bite into it. */
const HEAVY_MASS = 0.9;
const HEAVY_CUTS = 3;
const HEAVY_SLOW = 0.85;
/** Below this speed a blade drops out of the air. */
const BLADE_MIN_SPEED = 260;
/** 'cut' events per blade per tick (feedback only). */
const CUT_EVENTS = 1;
/** An orb that meets a wall hangs there this long (at most) before it collapses. */
const STUCK_LIFE = 0.45;
/** The orb's pull ramps up over this long after it leaves the muzzle. */
const PULL_RAMP = 0.25;
/** Share of the pull turned sideways: the horde spirals in instead of sliding straight. */
const SWIRL = 0.38;
/** A grabbed zombie stays helpless this long after the pull lets go. */
const GRAB_STUN = 0.15;
/** Outward shove of the collapse's shockwave on what survives it (px/s at the centre). */
const COLLAPSE_SHOVE = 520;

// scratch (no allocation per tick)
const cutT = new Float64Array(64);
const cutZ = new Array(64);
const edge = { t: -1, nx: 0, ny: 0 };

/**
 * The projectile fields a blade or an orb needs, from the gun's `projectile` spec (combat.js
 * fireProjectile spreads them in).
 */
export function specialFields(spec, w) {
  if (spec.kind === 'blade') {
    return {
      bounces: spec.bounces ?? 3, keep: spec.keep ?? 0.86, slow: spec.slow ?? 0.95,
      left: w.pierce || 1, gib: !!w.gib, cuts: 0,
    };
  }
  if (spec.kind === 'singularity') {
    return { age: 0, stuck: false, pull: spec.pull, core: spec.core, gib: true };
  }
  return null;
}

// -------------------------------------------------------------------------------------
// Saw blades

/** Where a ray from the blade meets the map edge (its rim touching it): writes `edge`. */
function mapEdge(game, pr, dx, dy, maxT) {
  const W = game.map.width, H = game.map.height, r = pr.radius;
  edge.t = -1;
  const test = (t, nx, ny) => {
    if (t >= 0 && t <= maxT && (edge.t < 0 || t < edge.t)) { edge.t = t; edge.nx = nx; edge.ny = ny; }
  };
  if (dx > 1e-9) test((W - r - pr.x) / dx, -1, 0);
  else if (dx < -1e-9) test((r - pr.x) / dx, 1, 0);
  if (dy > 1e-9) test((H - r - pr.y) / dy, 0, -1);
  else if (dy < -1e-9) test((r - pr.y) / dy, 0, 1);
  return edge;
}

/** The blade comes to rest at (pr.x, pr.y): embedded in a wall, or spent and dropped. */
function stopBlade(game, pr) {
  pr.dead = true;
  game.emit({ type: 'blade', what: 'stop', x: Math.round(pr.x), y: Math.round(pr.y), angle: pr.angle });
}

/**
 * Cut every zombie the blade's rim passes on the stretch [0, seg] ahead, nearest first,
 * each once per flight leg. Returns the distance at which the blade was spent (its cut
 * budget ran out, or a boss stopped it), or -1 when it flies on.
 */
function cutAlong(game, pr, dx, dy, seg) {
  const cand = game.tmpA;
  const n = game.zgrid.queryRay(pr.x, pr.y, dx, dy, seg, MAX_ZOMBIE_RADIUS + pr.radius, cand);
  let m = 0;
  for (let i = 0; i < n; i++) {
    const z = cand[i];
    if (z.dead || (pr.hits && pr.hits.includes(z.id))) continue;
    const t = rayCircle(pr.x, pr.y, dx, dy, z.x, z.y, z.radius + pr.radius * 0.6, seg);
    if (t < 0 || (m >= cutT.length && t >= cutT[m - 1])) continue;
    // insertion into the sorted scratch list (a handful of zombies at most)
    let j = m < cutT.length ? m++ : m - 1;
    while (j > 0 && cutT[j - 1] > t) {
      cutT[j] = cutT[j - 1];
      cutZ[j] = cutZ[j - 1];
      j--;
    }
    cutT[j] = t;
    cutZ[j] = z;
  }
  let spentAt = -1;
  for (let i = 0; i < m; i++) {
    const z = cutZ[i];
    cutZ[i] = null;
    if (spentAt >= 0 || z.dead) continue;
    if (!pr.hits) pr.hits = [];
    pr.hits.push(z.id);
    const heavy = z.mass >= HEAVY_MASS;
    knockZombie(z, dx, dy, pr.knockback);
    damageZombie(game, z, pr.damage, pr.owner, pr.gib);
    pr.left -= heavy ? HEAVY_CUTS : 1;
    const s = heavy ? HEAVY_SLOW : pr.slow;
    pr.vx *= s;
    pr.vy *= s;
    if (pr.cuts < CUT_EVENTS) {
      pr.cuts++;
      game.emit({ type: 'blade', what: 'cut', x: Math.round(z.x), y: Math.round(z.y), angle: pr.angle });
    }
    // a boss stops a blade dead; so does an empty budget
    if (z.boss || pr.left <= 0) spentAt = cutT[i];
  }
  return spentAt;
}

/**
 * One tick of a saw blade: fly, cut, ricochet. A ricochet reflects the velocity about the
 * wall's normal (the map edge is a wall too), keeps `keep` of the speed and starts a new
 * leg (zombies already cut may be cut again on the way back). After its last bounce the
 * blade embeds in the wall it hits; it also drops when its life or speed runs out.
 */
export function stepBlade(game, pr) {
  pr.life -= DT;
  pr.cuts = 0;
  const idx = game.world.index;
  const above = pr.above || 0;
  let remaining = Math.hypot(pr.vx, pr.vy) * DT;
  for (let iter = 0; iter < 4 && remaining > 1e-4; iter++) {
    const speed = Math.hypot(pr.vx, pr.vy);
    if (speed < 1e-6) break;
    const dx = pr.vx / speed, dy = pr.vy / speed;
    // the first wall the blade's rim touches (boxes grown by most of its radius) or the map edge
    let tw = idx.raycast(pr.x, pr.y, dx, dy, remaining, MASK_SOLID, pr.radius * 0.7, above);
    let nx = 0, ny = 0;
    if (tw >= 0) { nx = idx.hit.nx; ny = idx.hit.ny; }
    const e = mapEdge(game, pr, dx, dy, remaining);
    if (e.t >= 0 && (tw < 0 || e.t < tw)) { tw = e.t; nx = e.nx; ny = e.ny; }
    // started against a wall it is already leaving: step off it and fly on
    if (tw >= 0 && tw < 1e-6 && pr.vx * nx + pr.vy * ny >= 0) {
      pr.x += nx * 0.5;
      pr.y += ny * 0.5;
      continue;
    }
    const seg = tw >= 0 ? tw : remaining;
    const spent = cutAlong(game, pr, dx, dy, seg);
    if (spent >= 0) {
      pr.x += dx * spent;
      pr.y += dy * spent;
      stopBlade(game, pr);
      return;
    }
    pr.x += dx * seg;
    pr.y += dy * seg;
    remaining -= seg;
    if (tw < 0) break;
    if (pr.bounces <= 0) {
      stopBlade(game, pr);
      return;
    }
    // ricochet
    pr.bounces--;
    const vn = pr.vx * nx + pr.vy * ny;
    pr.vx = (pr.vx - 2 * vn * nx) * pr.keep;
    pr.vy = (pr.vy - 2 * vn * ny) * pr.keep;
    pr.angle = Math.atan2(pr.vy, pr.vx);
    pr.hits = null;
    remaining *= pr.keep;
    pr.x += nx * 0.5;
    pr.y += ny * 0.5;
    game.emit({ type: 'blade', what: 'wall', x: Math.round(pr.x), y: Math.round(pr.y), angle: pr.angle });
  }
  if (pr.life <= 0 || Math.hypot(pr.vx, pr.vy) < BLADE_MIN_SPEED) stopBlade(game, pr);
}

// -------------------------------------------------------------------------------------
// The Hollow Star's singularity

/**
 * One tick of the orb: it drifts along (stopping at the first wall it meets, where it hangs
 * for at most STUCK_LIFE), drags every zombie it can see within `pull.radius` toward itself
 * (stronger close in, with a swirl; heavies barely move, bosses never), holds the small
 * ones helpless while it has them, crushes what reaches its core, and collapses when its
 * life runs out.
 */
export function stepSingularity(game, pr) {
  pr.life -= DT;
  pr.age += DT;
  const above = pr.above || 0;
  if (!pr.stuck) {
    const speed = Math.hypot(pr.vx, pr.vy);
    if (speed > 1e-6) {
      const dx = pr.vx / speed, dy = pr.vy / speed, step = speed * DT;
      const tw = game.world.index.raycast(pr.x, pr.y, dx, dy, step, MASK_SOLID, pr.radius, above);
      if (tw >= 0) {
        pr.x += dx * Math.max(0, tw - 1);
        pr.y += dy * Math.max(0, tw - 1);
        pr.stuck = true;
      } else {
        pr.x += dx * step;
        pr.y += dy * step;
      }
      const W = game.map.width, H = game.map.height;
      if (pr.x < pr.radius || pr.y < pr.radius || pr.x > W - pr.radius || pr.y > H - pr.radius) {
        pr.x = Math.max(pr.radius, Math.min(W - pr.radius, pr.x));
        pr.y = Math.max(pr.radius, Math.min(H - pr.radius, pr.y));
        pr.stuck = true;
      }
      if (pr.stuck) {
        pr.vx = 0;
        pr.vy = 0;
        pr.life = Math.min(pr.life, STUCK_LIFE);
      }
    }
  }
  const R = pr.pull.radius;
  const ramp = Math.min(1, pr.age / PULL_RAMP);
  const list = game.tmpA;
  const n = game.zgrid.queryRadius(pr.x, pr.y, R + MAX_ZOMBIE_RADIUS, list);
  for (let i = 0; i < n; i++) {
    const z = list[i];
    if (z.dead) continue;
    const dx = pr.x - z.x, dy = pr.y - z.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const reach = R + z.radius;
    if (d > reach) continue;
    if (d > 1 && !game.world.lineOfSight(pr.x, pr.y, z.x, z.y, above)) continue;
    // the core crushes
    if (d < pr.core.radius + z.radius) {
      damageZombie(game, z, pr.core.dps * DT, pr.owner, true);
      if (z.dead) continue;
    }
    if (z.boss || z.dummy || d <= 1) continue;
    // the pull: strongest close in, turned a little sideways so the pack spirals into the orb
    const f = pr.pull.force * Math.sqrt(1 - d / reach) * ramp;
    const ux = dx / d, uy = dy / d;
    knockZombie(z, ux - uy * SWIRL, uy + ux * SWIRL, f * DT);
    if (z.mass < HEAVY_MASS && (z.mode === MODE_NORMAL || z.mode === MODE_STUN)) {
      z.mode = MODE_STUN;
      if (z.modeT < GRAB_STUN) z.modeT = GRAB_STUN;
    }
  }
  if (pr.life <= 0) collapse(game, pr);
}

/**
 * The orb collapses: `explodeDamage` to every zombie in sight within `explodeRadius` (full at
 * the centre, half at the edge; kills blow them apart), then a shockwave shoves the
 * survivors outward. Players are never hurt. Emits 'explosion' (kind 'singularity').
 */
function collapse(game, pr) {
  pr.dead = true;
  const r = pr.explodeRadius;
  const x = pr.x, y = pr.y, above = pr.above || 0;
  game.emit({ type: 'explosion', x: Math.round(x), y: Math.round(y), r, kind: 'singularity' });
  const list = game.tmpA;
  const n = game.zgrid.queryRadius(x, y, r + MAX_ZOMBIE_RADIUS, list);
  // copy first: kills (a bloater's burst) re-enter the zombie grid queries
  const hits = list.slice(0, n);
  for (const z of hits) {
    if (z.dead) continue;
    const dx = z.x - x, dy = z.y - y;
    const dc = Math.sqrt(dx * dx + dy * dy);
    const d = Math.max(0, dc - z.radius);
    if (d > r) continue;
    if (dc > 1 && !game.world.lineOfSight(x, y, z.x, z.y, above)) continue;
    const f = 1 - 0.5 * Math.min(1, d / r);
    if (dc > 1e-3) knockZombie(z, dx / dc, dy / dc, COLLAPSE_SHOVE * f);
    damageZombie(game, z, pr.explodeDamage * f, pr.owner, true);
  }
}
