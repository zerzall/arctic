// Movement and collision shared by the host simulation and client-side prediction.
// Everything here is pure and deterministic: the same (player, cmd, world) always
// produces the same result, so a client replaying its inputs lands exactly where the
// host put it.

import {
  PLAYER_RADIUS, PLAYER_SPEED, SPRINT_MULT, STAMINA_MAX, STAMINA_DRAIN, STAMINA_REGEN,
  STAMINA_MIN_TO_SPRINT, DOWNED_SPEED, BARRICADE, STAND_PAD, MANTLE_REACH, MANTLE_MIN, MANTLE_TICKS,
} from './constants.js';
import {
  StaticIndex, makeObb, setObbPose, circleObbPush, circleOverlapsObb, mapColliders, obbOverlap,
  pointInObb, distToObb, closestPointOnObb,
  MASK_MOVE, MASK_SOLID, MASK_WATER, MASK_BARRICADE, MASK_BULKY,
} from './geom.js';
import { stepJump, normVertical, toZq, Z_UNIT, COOL_TICKS, JUMP_TICKS } from './jump.js';
import { terrainOf } from './terrain.js';

/**
 * Collision mask for heavies (bloater, brute, boss): they crash over crushable low
 * cover (barriers, sandbags, guard rails, fences) but not vehicles, buildings, water
 * or the objective.
 */
export const MASK_HEAVY = MASK_BULKY | MASK_WATER;

const RESOLVE_ITERATIONS = 4;
/**
 * Where a landing may search for room (a player coming down on top of low cover wedged
 * against a wall, water or a barricade): rings every UNSTICK_STEP px up to UNSTICK_MAX,
 * in 8 fixed directions (exact constants, so every JS engine picks the same spot).
 */
const UNSTICK_STEP = 4;
const UNSTICK_MAX = 96;
const R2 = Math.SQRT1_2;
const UNSTICK_DIRS = [1, 0, R2, R2, 0, 1, -R2, R2, -1, 0, -R2, -R2, 0, -1, R2, -R2];

// Mantling (SPEC §3.2): a ledge counts when the body touches it (within LEDGE_GAP) and the
// move input points into it (within ~60° of straight in). The climb rises first, reaching
// the top MANTLE_TOP_TICKS before the end, and swings over onto it in the last
// MANTLE_OVER_TICKS, ending MANTLE_INSET in from the edge.
const LEDGE_GAP = 3;
const LEDGE_FACING = -0.5;
const MANTLE_TOP_TICKS = 8;
const MANTLE_OVER_TICKS = 12;
const MANTLE_INSET = PLAYER_RADIUS + 2;
const REACH_Q = toZq(MANTLE_REACH);
/** Walking over terrain: a standing body follows the ground up or down by at most this (Z_UNITs) a tick. */
const TERRAIN_SNAP_Q = toZq(12);
const MIN_Q = toZq(MANTLE_MIN);
/** Height of a jump's apex in Z_UNITs. */
const APEX_Q = (JUMP_TICKS / 2) * (JUMP_TICKS / 2);
const _spot = { x: 0, y: 0 };
const _cp = { x: 0, y: 0 };

/**
 * Build the static collision world for a map: obstacles (solid or low cover), water,
 * the objective, the map bounds, plus dynamic barricades set with setBarricades().
 * @param {object} map MapDef
 * @returns {CollisionWorld}
 */
export function createCollisionWorld(map) {
  return new CollisionWorld(map);
}

/** Static colliders of a map plus dynamic barricades; built by createCollisionWorld. */
export class CollisionWorld {
  constructor(map) {
    this.width = map.width;
    this.height = map.height;
    this.colliders = mapColliders(map);
    /** Terrain height field of a campaign map (shared/terrain.js); flat elsewhere. */
    this.terrain = terrainOf(map);
    this.index = new StaticIndex(this.colliders, map.width, map.height, { cellSize: 128, margin: 24 });
    /** Barricade boxes, parallel to the list given to setBarricades(). */
    this.barricades = [];
    this.barricadeSrc = [];
    this._near = [];
    this._push = { nx: 0, ny: 0, depth: 0 };
    /** Index (into the setBarricades list) of the last barricade resolveCircle touched, else -1. */
    this.touchedBarricade = -1;
    /** Deepest push normal of the last resolveCircle call (for bounce/stuck logic). */
    this.pushNX = 0;
    this.pushNY = 0;
  }

  /**
   * Replace the dynamic barricade walls. Each entry is { x, y, a } (angle of the long
   * side, BARRICADE.width x BARRICADE.height). Reuses box objects between calls.
   */
  setBarricades(list) {
    const n = list ? list.length : 0;
    for (let i = 0; i < n; i++) {
      const b = list[i];
      const a = b.a !== undefined ? b.a : (b.angle || 0);
      if (!this.barricades[i]) {
        this.barricades[i] = makeObb(b.x, b.y, BARRICADE.width, BARRICADE.height, a, MASK_MOVE | MASK_BARRICADE, b);
      } else {
        setObbPose(this.barricades[i], b.x, b.y, a);
        this.barricades[i].ref = b;
      }
    }
    this.barricades.length = n;
    this.barricadeSrc = list || [];
  }

  /**
   * Push a circle out of every walk-blocking collider (static + barricades) and clamp
   * it to the map bounds. `pos` ({x, y}) is mutated.
   * @param {object} pos
   * @param {number} r radius
   * @param {number} [mask] which static colliders count (MASK_MOVE, or MASK_HEAVY)
   * @param {number} [z] feet height: static colliders it is above (top ≤ z, see
   *   jump.js) are ignored
   * @returns {number} MASK_* bits of what was touched (0 if nothing)
   */
  resolveCircle(pos, r, mask = MASK_MOVE, z = 0) {
    let touched = 0;
    this.touchedBarricade = -1;
    this.pushNX = 0;
    this.pushNY = 0;
    let bestDepth = 0;
    const push = this._push, near = this._near;
    for (let iter = 0; iter < RESOLVE_ITERATIONS; iter++) {
      let moved = false;
      const n = this.index.query(pos.x - r, pos.y - r, pos.x + r, pos.y + r, mask, near);
      for (let i = 0; i < n; i++) {
        if (z >= near[i].top) continue;
        if (circleObbPush(near[i], pos.x, pos.y, r, push)) {
          pos.x += push.nx * push.depth;
          pos.y += push.ny * push.depth;
          touched |= near[i].mask;
          moved = true;
          if (push.depth > bestDepth) {
            bestDepth = push.depth;
            this.pushNX = push.nx;
            this.pushNY = push.ny;
          }
        }
      }
      const bs = this.barricades;
      for (let i = 0; i < bs.length; i++) {
        if (circleObbPush(bs[i], pos.x, pos.y, r, push)) {
          pos.x += push.nx * push.depth;
          pos.y += push.ny * push.depth;
          touched |= MASK_BARRICADE;
          this.touchedBarricade = i;
          moved = true;
          if (push.depth > bestDepth) {
            bestDepth = push.depth;
            this.pushNX = push.nx;
            this.pushNY = push.ny;
          }
        }
      }
      if (this.clampToBounds(pos, r)) moved = true;
      if (!moved) break;
    }
    return touched;
  }

  /** Keep a circle inside the map. @returns {boolean} true if it was moved */
  clampToBounds(pos, r) {
    let moved = false;
    if (pos.x < r) { pos.x = r; moved = true; } else if (pos.x > this.width - r) { pos.x = this.width - r; moved = true; }
    if (pos.y < r) { pos.y = r; moved = true; } else if (pos.y > this.height - r) { pos.y = this.height - r; moved = true; }
    return moved;
  }

  /**
   * Move a circle by (dx, dy) with sliding, sub-stepping so fast movers never tunnel
   * through thin walls. `pos` is mutated.
   * @param {number} [mask] as for resolveCircle
   * @param {number} [z] as for resolveCircle
   * @returns {number} MASK_* bits touched during the move
   */
  moveCircle(pos, r, dx, dy, mask = MASK_MOVE, z = 0) {
    const d = Math.hypot(dx, dy);
    const maxStep = Math.max(2, r * 0.5);
    const steps = d > maxStep ? Math.ceil(d / maxStep) : 1;
    const sx = dx / steps, sy = dy / steps;
    let touched = 0, barricade = -1;
    let pnx = 0, pny = 0;
    for (let i = 0; i < steps; i++) {
      pos.x += sx;
      pos.y += sy;
      const t = this.resolveCircle(pos, r, mask, z);
      if (t) {
        touched |= t;
        pnx = this.pushNX;
        pny = this.pushNY;
      }
      if (this.touchedBarricade >= 0) barricade = this.touchedBarricade;
    }
    this.touchedBarricade = barricade;
    this.pushNX = pnx;
    this.pushNY = pny;
    return touched;
  }

  /** True if a circle at (x, y) overlaps no walk-blocking collider and is inside bounds. */
  isCircleFree(x, y, r, includeBarricades = true, mask = MASK_MOVE) {
    if (x < r || y < r || x > this.width - r || y > this.height - r) return false;
    if (this.index.circleBlocked(x, y, r, mask)) return false;
    if (includeBarricades) {
      for (const b of this.barricades) if (circleOverlapsObb(b, x, y, r)) return false;
    }
    return true;
  }

  /**
   * True if a circle whose feet are `z` high overlaps a walk-blocking collider it doesn't
   * clear (static ones with hop > z, any barricade) or pokes out of the map.
   */
  circleBlockedAt(x, y, r, z = 0) {
    if (x < r || y < r || x > this.width - r || y > this.height - r) return true;
    const near = this._near;
    const n = this.index.query(x - r, y - r, x + r, y + r, MASK_MOVE, near);
    for (let i = 0; i < n; i++) {
      if (z < near[i].top && circleOverlapsObb(near[i], x, y, r)) return true;
    }
    for (const b of this.barricades) if (circleOverlapsObb(b, x, y, r)) return true;
    return false;
  }

  /**
   * Move a circle stuck inside colliders (circleBlockedAt) to the nearest free spot within
   * UNSTICK_MAX px; stays put when there is none. `pos` is mutated.
   * @returns {boolean} true if it was moved
   */
  unstick(pos, r, z = 0) {
    if (!this.circleBlockedAt(pos.x, pos.y, r, z)) return false;
    for (let d = UNSTICK_STEP; d <= UNSTICK_MAX; d += UNSTICK_STEP) {
      for (let k = 0; k < UNSTICK_DIRS.length; k += 2) {
        const x = pos.x + UNSTICK_DIRS[k] * d, y = pos.y + UNSTICK_DIRS[k + 1] * d;
        if (!this.circleBlockedAt(x, y, r, z)) {
          pos.x = x;
          pos.y = y;
          return true;
        }
      }
    }
    return false;
  }

  /** True if a box overlaps no walk-blocking collider or barricade and lies inside bounds. */
  isObbFree(ob) {
    if (ob.minX < 0 || ob.minY < 0 || ob.maxX > this.width || ob.maxY > this.height) return false;
    const near = this._near;
    const n = this.index.query(ob.minX, ob.minY, ob.maxX, ob.maxY, MASK_MOVE, near);
    for (let i = 0; i < n; i++) if (obbOverlap(near[i], ob)) return false;
    for (const b of this.barricades) if (obbOverlap(b, ob)) return false;
    return true;
  }

  /**
   * Feet height (whole Z_UNITs) of the highest standable top at most `zq` high under
   * (x, y) (within STAND_PAD of its footprint), 0 for the ground. The collider is left
   * in this.groundOb (null on the ground).
   */
  groundQ(x, y, zq) {
    const near = this._near;
    const n = this.index.query(x - STAND_PAD, y - STAND_PAD, x + STAND_PAD, y + STAND_PAD, MASK_MOVE, near);
    // the terrain is always a floor (even above the feet: a body under the hill comes up onto it)
    let best = this.terrain.flat ? 0 : this.terrain.q(x, y), ob = null;
    for (let i = 0; i < n; i++) {
      const o = near[i];
      if (o.stand && o.topQ <= zq && o.topQ > best && pointInObb(o, x, y, STAND_PAD)) {
        best = o.topQ;
        ob = o;
      }
    }
    this.groundOb = ob;
    return best;
  }

  /** groundQ in world units, for float heights (zombies): the highest top ≤ z under (x, y). */
  groundAt(x, y, z) {
    const near = this._near;
    const n = this.index.query(x - STAND_PAD, y - STAND_PAD, x + STAND_PAD, y + STAND_PAD, MASK_MOVE, near);
    let best = this.terrain.flat ? 0 : this.terrain.height(x, y), ob = null;
    for (let i = 0; i < n; i++) {
      const o = near[i];
      if (o.stand && o.top <= z + 1e-6 && o.top > best && pointInObb(o, x, y, STAND_PAD)) {
        best = o.top;
        ob = o;
      }
    }
    this.groundOb = ob;
    return best;
  }

  /** Terrain height at (x, y) in whole Z_UNITs (0 on a flat map). */
  terrainQ(x, y) {
    return this.terrain.flat ? 0 : this.terrain.q(x, y);
  }

  /** Terrain height at (x, y) in world units (0 on a flat map). */
  terrainH(x, y) {
    return this.terrain.flat ? 0 : this.terrain.height(x, y);
  }

  /**
   * First shot-blocking obstacle along a ray (unit direction). Barricades never block
   * shots; from `above` (the shooter's feet height) obstacles no taller are shot over.
   * @returns {number} distance or -1; details in this.index.hit
   */
  raycastSolid(ox, oy, dx, dy, maxT, above = 0) {
    return this.index.raycast(ox, oy, dx, dy, maxT, MASK_SOLID, 0, above);
  }

  /** Line of sight for shots between two points (over obstacles no taller than `above`). */
  lineOfSight(x1, y1, x2, y2, above = 0) {
    return this.index.segmentClear(x1, y1, x2, y2, MASK_SOLID, 0, above);
  }

  /**
   * Line of movement: a walker of radius ~2*pad could go straight from 1 to 2 (at feet
   * height `above`, over whatever is no taller).
   */
  lineOfMovement(x1, y1, x2, y2, pad = 0, mask = MASK_MOVE, above = 0) {
    if (!this.index.segmentClear(x1, y1, x2, y2, mask, pad, above)) return false;
    const bs = this.barricades;
    if (bs.length) {
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      if (len > 1e-6) {
        for (const b of bs) {
          if (segmentHitsBox(b, x1, y1, dx / len, dy / len, len, pad)) return false;
        }
      }
    }
    return true;
  }
}

function segmentHitsBox(b, x, y, dx, dy, len, pad) {
  // Local slab test without importing rayObb's out-param variant.
  const rx = x - b.x, ry = y - b.y;
  const lx = rx * b.c + ry * b.s, ly = -rx * b.s + ry * b.c;
  const ldx = dx * b.c + dy * b.s, ldy = -dx * b.s + dy * b.c;
  const hw = b.hw + pad, hh = b.hh + pad;
  let t0 = 0, t1 = len;
  if (Math.abs(ldx) < 1e-9) {
    if (lx < -hw || lx > hw) return false;
  } else {
    let a = (-hw - lx) / ldx, c = (hw - lx) / ldx;
    if (a > c) { const t = a; a = c; c = t; }
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    if (t0 > t1) return false;
  }
  if (Math.abs(ldy) < 1e-9) {
    if (ly < -hh || ly > hh) return false;
  } else {
    let a = (-hh - ly) / ldy, c = (hh - ly) / ldy;
    if (a > c) { const t = a; a = c; c = t; }
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * Where a climb onto box `o` ends for a body at (x, y): the point clamped into the box
 * `inset` in from its edges (or onto its middle line when it is too narrow). Written to out.
 */
export function mantleSpot(o, x, y, inset, out) {
  const dx = x - o.x, dy = y - o.y;
  let lx = dx * o.c + dy * o.s;
  let ly = -dx * o.s + dy * o.c;
  const ix = Math.max(0, o.hw - inset), iy = Math.max(0, o.hh - inset);
  lx = lx < -ix ? -ix : lx > ix ? ix : lx;
  ly = ly < -iy ? -iy : ly > iy ? iy : ly;
  out.x = o.x + lx * o.c - ly * o.s;
  out.y = o.y + lx * o.s + ly * o.c;
  return out;
}

/**
 * The ledge a body at (x, y) with feet at `zq` would mantle when pushing along the unit
 * vector (dirX, dirY): a standable collider it touches and pushes into, topped higher than
 * low cover (MANTLE_MIN) and than its feet, by at most MANTLE_REACH, with room on top.
 * The nearest wins (then the lowest index).
 * @returns {number} collider index (world.colliders), or -1
 */
export function findLedge(world, x, y, r, zq, dirX, dirY) {
  const near = world._ledge || (world._ledge = []);
  const reach = r + LEDGE_GAP;
  const n = world.index.query(x - reach, y - reach, x + reach, y + reach, MASK_MOVE, near);
  let best = -1, bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const o = near[i];
    if (!o.stand || o.topQ <= zq || o.topQ - o.baseQ <= MIN_Q || o.topQ - zq > REACH_Q) continue;
    const d = distToObb(o, x, y);
    if (d > reach || d < 1e-6 || d > bestD || (d === bestD && o.ci > best)) continue;
    closestPointOnObb(o, x, y, _cp);
    if (((x - _cp.x) * dirX + (y - _cp.y) * dirY) / d > LEDGE_FACING) continue;
    mantleSpot(o, x, y, MANTLE_INSET, _spot);
    if (world.circleBlockedAt(_spot.x, _spot.y, r, o.top)) continue;
    best = o.ci;
    bestD = d;
  }
  return best;
}

/**
 * For the HUD's "SPACE — climb" hint: a ledge just ahead of a standing player at (x, y)
 * with feet at `zq`, facing along the unit vector (dirX, dirY), that a jump into it would
 * mantle (the same rules as findLedge, with the jump's apex added to the reach).
 * @returns {number} collider index, or -1
 */
export function ledgeAhead(world, x, y, zq, dirX, dirY, look = 40) {
  const near = world._ledge || (world._ledge = []);
  const r = PLAYER_RADIUS, reach = r + look;
  const n = world.index.query(x - reach, y - reach, x + reach, y + reach, MASK_MOVE, near);
  let best = -1, bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const o = near[i];
    if (!o.stand || o.topQ <= zq || o.topQ - o.baseQ <= MIN_Q || o.topQ - zq > REACH_Q + APEX_Q) continue;
    const d = distToObb(o, x, y);
    if (d > reach || d < 1e-6 || d >= bestD) continue;
    closestPointOnObb(o, x, y, _cp);
    if (((x - _cp.x) * dirX + (y - _cp.y) * dirY) / d > -0.7) continue;
    mantleSpot(o, x, y, MANTLE_INSET, _spot);
    if (world.circleBlockedAt(_spot.x, _spot.y, r, o.top)) continue;
    best = o.ci;
    bestD = d;
  }
  return best;
}

/**
 * One tick of a mantle (p.climbT > 0): up the side first, then over onto the top of
 * world.colliders[p.climbTo]. No collisions on the way (the end spot was checked free).
 * @returns {number} -1 on the tick it ends (standing on top), else 0
 */
function stepMantle(p, world) {
  const o = world.colliders[p.climbTo];
  if (!o || !o.stand) {
    // Not a ledge on this map (a bad record): let go.
    p.climbT = 0;
    p.climbTo = -1;
    p.vzq = -1;
    return 0;
  }
  const k = p.climbT;
  if (k > MANTLE_TOP_TICKS) {
    const left = o.topQ - p.zq;
    if (left > 0) p.zq += Math.ceil(left / (k - MANTLE_TOP_TICKS));
  } else {
    p.zq = o.topQ;
  }
  if (k <= MANTLE_OVER_TICKS) {
    mantleSpot(o, p.x, p.y, MANTLE_INSET, _spot);
    p.x += (_spot.x - p.x) / k;
    p.y += (_spot.y - p.y) / k;
  }
  p.climbT = k - 1;
  let ev = 0;
  if (p.climbT === 0) {
    p.zq = o.topQ;
    p.climbTo = -1;
    p.jumpCd = COOL_TICKS;
    ev = -1;
  }
  p.z = p.zq * Z_UNIT;
  return ev;
}

/**
 * Advance one player by one input command (SPEC §3.2). Mutates p.x, p.y, p.stamina,
 * p.sprintLock, p.sprinting and the vertical state (jump.js: zq, vzq, jumpCd, climbT,
 * climbTo, z). Players collide with obstacles, water, the objective, barricades and the
 * map bounds, never with zombies or other players — except obstacles their feet are
 * above (they jump over low cover and walk around on top of what they stand on). They
 * stand on the highest standable top under them and fall when they walk off it; jumping
 * (or falling) while pushing into a ledge within reach mantles onto it. A landing that
 * leaves them inside something moves them to the nearest free spot.
 *
 * @param {object} p { x, y, state, stamina, sprintLock, speedMult, moveMult,
 *   staminaMult?, zq?, vzq?, jumpCd?, climbT?, climbTo? } — staminaMult (default 1) is the
 *   class stamina perk: it slows the drain and speeds up regeneration while STAMINA_MAX
 *   stays the HUD's scale.
 * @param {object} cmd InputCmd (moveX, moveY, sprint, jump are read)
 * @param {number} dt seconds
 * @param {CollisionWorld} world
 * @returns {number} 1 = took off this tick, -1 = landed (or finished a climb), 2 = started
 *   a climb, 0 otherwise
 */
export function stepPlayerMovement(p, cmd, dt, world) {
  normVertical(p);
  if (p.state === 'dead') {
    p.sprinting = false;
    settleVertical(p, world);
    return 0;
  }
  // Riding the zip line (campaign): the director moves the body along the cable.
  if (p.frozen) {
    p.sprinting = false;
    return 0;
  }
  const sm = p.staminaMult > 0 ? p.staminaMult : 1;
  let stamina = Number.isFinite(p.stamina) ? p.stamina : STAMINA_MAX;
  if (p.climbT > 0) {
    // Climbing: no walking or sprinting; the stamina bar recovers as usual.
    p.stamina = Math.min(STAMINA_MAX, stamina + STAMINA_REGEN * sm * dt);
    if (p.sprintLock && p.stamina >= STAMINA_MIN_TO_SPRINT) p.sprintLock = false;
    p.sprinting = false;
    return stepMantle(p, world);
  }
  const jump = stepJump(p, cmd, (x, y, zq) => world.groundQ(x, y, zq));
  const z = p.z;
  let mx = cmd && Number.isFinite(cmd.moveX) ? cmd.moveX : 0;
  let my = cmd && Number.isFinite(cmd.moveY) ? cmd.moveY : 0;
  const len = Math.hypot(mx, my);
  if (len > 1) {
    mx /= len;
    my /= len;
  }
  const moving = len > 0.05;
  const downed = p.state === 'downed';
  let lock = !!p.sprintLock;
  if (lock && stamina >= STAMINA_MIN_TO_SPRINT) lock = false;
  const sprinting = !!(cmd && cmd.sprint) && moving && !downed && !lock && stamina > 0;
  if (sprinting) {
    stamina -= (STAMINA_DRAIN / sm) * dt;
    if (stamina <= 0) {
      stamina = 0;
      lock = true;
    }
  } else {
    stamina += STAMINA_REGEN * sm * dt;
    if (stamina > STAMINA_MAX) stamina = STAMINA_MAX;
  }
  p.stamina = stamina;
  p.sprintLock = lock;
  p.sprinting = sprinting;
  if (!moving) {
    // Still resolve so a barricade placed on top of someone pushes them out.
    world.resolveCircle(p, PLAYER_RADIUS, MASK_MOVE, z);
  } else {
    const speed = downed
      ? DOWNED_SPEED
      : PLAYER_SPEED * (p.speedMult || 1) * (p.moveMult || 1) * (sprinting ? SPRINT_MULT : 1);
    world.moveCircle(p, PLAYER_RADIUS, mx * speed * dt, my * speed * dt, MASK_MOVE, z);
  }
  // Walked off the edge of what we stand on: fall from the next tick. On terrain a body
  // standing on the ground follows it up and down the slope instead (no fall, no landing).
  if (p.vzq === 0 && (p.zq > 0 || !world.terrain.flat)) {
    const g = world.groundQ(p.x, p.y, p.zq);
    if (g > p.zq) {
      p.zq = g;
      p.z = g * Z_UNIT;
    } else if (g < p.zq) {
      if (world.groundOb === null && p.zq - g <= TERRAIN_SNAP_Q) {
        p.zq = g;
        p.z = g * Z_UNIT;
      } else {
        p.vzq = -1;
      }
    }
  }
  // Coming down onto low cover wedged against something else can leave no way out by the
  // shortest push: walk out to the nearest free spot instead of staying stuck inside.
  if (jump < 0 || p.vzq !== 0) world.unstick(p, PLAYER_RADIUS, z);
  // Jumping or falling into a ledge within reach: climb it.
  if (moving && p.state === 'alive' && (p.vzq !== 0 || (cmd && cmd.jump))) {
    const l = len > 1 ? 1 : len;
    const ci = findLedge(world, p.x, p.y, PLAYER_RADIUS, p.zq, mx / l, my / l);
    if (ci >= 0) {
      p.climbT = MANTLE_TICKS;
      p.climbTo = ci;
      p.vzq = 0;
      p.sprinting = false;
      return 2;
    }
  }
  return jump;
}

/**
 * Drop a record that can't move any more (the dead) onto whatever is under it: a corpse
 * on a car roof stays up there, one killed mid-jump lands.
 */
export function settleVertical(p, world) {
  normVertical(p);
  p.vzq = 0;
  p.climbT = 0;
  p.climbTo = -1;
  p.jumpCd = 0;
  p.zq = p.zq > 0 || !world.terrain.flat ? world.groundQ(p.x, p.y, p.zq) : 0;
  p.z = p.zq * Z_UNIT;
}
