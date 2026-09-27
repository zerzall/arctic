// Movement and collision shared by the host simulation and client-side prediction.
// Everything here is pure and deterministic: the same (player, cmd, world) always
// produces the same result, so a client replaying its inputs lands exactly where the
// host put it.

import {
  PLAYER_RADIUS, PLAYER_SPEED, SPRINT_MULT, STAMINA_MAX, STAMINA_DRAIN, STAMINA_REGEN,
  STAMINA_MIN_TO_SPRINT, DOWNED_SPEED, BARRICADE,
} from './constants.js';
import {
  StaticIndex, makeObb, setObbPose, circleObbPush, circleOverlapsObb, mapColliders, obbOverlap,
  MASK_MOVE, MASK_SOLID, MASK_WATER, MASK_BARRICADE,
} from './geom.js';

/**
 * Collision mask for heavies (bloater, brute, boss): they crash over low cover
 * (obstacles with solid: false) but not cars, buildings, water or the objective.
 */
export const MASK_HEAVY = MASK_SOLID | MASK_WATER;

const RESOLVE_ITERATIONS = 4;

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
   * @returns {number} MASK_* bits of what was touched (0 if nothing)
   */
  resolveCircle(pos, r, mask = MASK_MOVE) {
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
   * @returns {number} MASK_* bits touched during the move
   */
  moveCircle(pos, r, dx, dy, mask = MASK_MOVE) {
    const d = Math.hypot(dx, dy);
    const maxStep = Math.max(2, r * 0.5);
    const steps = d > maxStep ? Math.ceil(d / maxStep) : 1;
    const sx = dx / steps, sy = dy / steps;
    let touched = 0, barricade = -1;
    let pnx = 0, pny = 0;
    for (let i = 0; i < steps; i++) {
      pos.x += sx;
      pos.y += sy;
      const t = this.resolveCircle(pos, r, mask);
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
   * First shot-blocking obstacle along a ray (unit direction). Barricades never block
   * shots. @returns {number} distance or -1; details in this.index.hit
   */
  raycastSolid(ox, oy, dx, dy, maxT) {
    return this.index.raycast(ox, oy, dx, dy, maxT, MASK_SOLID, 0);
  }

  /** Line of sight for shots between two points. */
  lineOfSight(x1, y1, x2, y2) {
    return this.index.segmentClear(x1, y1, x2, y2, MASK_SOLID, 0);
  }

  /** Line of movement: a walker of radius ~2*pad could go straight from 1 to 2. */
  lineOfMovement(x1, y1, x2, y2, pad = 0, mask = MASK_MOVE) {
    if (!this.index.segmentClear(x1, y1, x2, y2, mask, pad)) return false;
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
 * Advance one player by one input command (SPEC §3.2). Mutates p.x, p.y, p.stamina,
 * p.sprintLock and p.sprinting. Players collide with obstacles, water, the objective,
 * barricades and the map bounds, never with zombies or other players.
 *
 * @param {object} p { x, y, state, stamina, sprintLock, speedMult, moveMult,
 *   staminaMult? } — staminaMult (default 1) is the class stamina perk: it slows the
 *   drain and speeds up regeneration while STAMINA_MAX stays the HUD's scale.
 * @param {object} cmd InputCmd (moveX, moveY, sprint are read)
 * @param {number} dt seconds
 * @param {CollisionWorld} world
 */
export function stepPlayerMovement(p, cmd, dt, world) {
  if (p.state === 'dead') {
    p.sprinting = false;
    return;
  }
  let mx = cmd && Number.isFinite(cmd.moveX) ? cmd.moveX : 0;
  let my = cmd && Number.isFinite(cmd.moveY) ? cmd.moveY : 0;
  const len = Math.hypot(mx, my);
  if (len > 1) {
    mx /= len;
    my /= len;
  }
  const moving = len > 0.05;
  const downed = p.state === 'downed';
  const sm = p.staminaMult > 0 ? p.staminaMult : 1;
  let stamina = Number.isFinite(p.stamina) ? p.stamina : STAMINA_MAX;
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
    world.resolveCircle(p, PLAYER_RADIUS);
    return;
  }
  const speed = downed
    ? DOWNED_SPEED
    : PLAYER_SPEED * (p.speedMult || 1) * (p.moveMult || 1) * (sprinting ? SPRINT_MULT : 1);
  world.moveCircle(p, PLAYER_RADIUS, mx * speed * dt, my * speed * dt);
}
