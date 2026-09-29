// Vertical movement shared by the host simulation and client-side prediction (SPEC §3.2):
// jumping, standing on top of things, falling off them and mantling onto them. The
// world-dependent steps (what is under your feet, what you can grab) live in movement.js.
//
// Heights are whole multiples of Z_UNIT, so the state is a handful of integers that a
// snapshot carries exactly and a client replaying its inputs lands on the same tick:
//   zq       feet height in Z_UNITs (z = zq × Z_UNIT world units)
//   vzq      vertical speed in Z_UNITs per tick; 0 = standing (on the ground or on top of
//            something). Airborne it is always odd (a jump starts at JUMP_VQ = 35, a fall
//            at -1, gravity takes GRAVITY_Q = 2 a tick), so it never reads 0 mid-air.
//   jumpCd   ticks of landing cooldown left before the next jump
//   climbT   ticks of mantle left (0 = not climbing); climbTo is the collider (index into
//            CollisionWorld.colliders) being climbed, -1 otherwise
// With Z_UNIT = JUMP_HEIGHT / (JUMP_TICKS / 2)², a jump from flat ground is exactly the
// old fixed parabola: after n ticks zq = n × (JUMP_TICKS - n), JUMP_HEIGHT at the apex,
// back down after JUMP_TICKS. A fall from standing drops n² Z_UNITs after n ticks.

import {
  DT, JUMP_HEIGHT, JUMP_TIME, JUMP_COOLDOWN, JUMP_CLEAR, CLIMB_TOP,
} from './constants.js';

/** Ticks from take-off to touch-down on flat ground. */
export const JUMP_TICKS = Math.round(JUMP_TIME / DT);
const HALF = JUMP_TICKS / 2;
/** One height step (world units). */
export const Z_UNIT = JUMP_HEIGHT / (HALF * HALF);
/** Take-off speed and gravity in Z_UNITs per tick (per tick²). */
export const JUMP_VQ = JUMP_TICKS - 1;
export const GRAVITY_Q = 2;
/** Fastest fall (Z_UNITs per tick; odd, fits the wire's signed byte). */
export const MAX_FALL_VQ = -127;
/** Landing cooldown in ticks. */
export const COOL_TICKS = Math.round(JUMP_COOLDOWN / DT);
/** The same arc in world units per second (per second²), for the zombies' float physics. */
export const JUMP_SPEED = (4 * JUMP_HEIGHT) / JUMP_TIME;
export const JUMP_GRAVITY = (8 * JUMP_HEIGHT) / (JUMP_TIME * JUMP_TIME);

/** Largest possible feet height (the wire's u16). */
const MAX_ZQ = 65535;

/**
 * Height of the feet above flat ground (world units) `t` seconds after take-off; 0 on
 * the ground (t ≤ 0 or t ≥ JUMP_TIME).
 * @param {number} t
 * @returns {number}
 */
export function jumpHeight(t) {
  if (!(t > 0) || t >= JUMP_TIME - 1e-6) return 0;
  const u = t / JUMP_TIME;
  return 4 * JUMP_HEIGHT * u * (1 - u);
}

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** 'fence' for a chain-link fence (a thin 'wall'), else the obstacle's kind. */
function kindOf(o) {
  if (!o) return '';
  if (o.kind === 'wall' && Math.min(o.w, o.h) <= 8) return 'fence';
  return typeof o.kind === 'string' ? o.kind : '';
}

/**
 * Feet height on top of obstacle `o` when it can be stood on (CLIMB_TOP), else 0.
 * @param {object} o MapDef obstacle
 * @returns {number} world units (not yet on the Z_UNIT grid)
 */
export function standTop(o) {
  const k = kindOf(o);
  if (!k || !own(CLIMB_TOP, k)) return 0;
  const t = CLIMB_TOP[k];
  if (k === 'rock') return Math.max(16, Math.min(30, 10 + Math.min(o.w, o.h) * 0.4));
  if (Array.isArray(t)) {
    // semi: cab (≤ 100 long) / trailer; container: dumpster-sized (≤ 72) / shipping container
    const big = k === 'semi' ? o.w > 100 : Math.max(o.w, o.h) > 72;
    return t[big ? 1 : 0];
  }
  return t > 0 ? t : 0;
}

/**
 * Height the feet must reach to pass over obstacle `o` (MapDef obstacle): its top when it
 * can be stood on (standTop) or jumped (JUMP_CLEAR), else Infinity.
 * @param {object} o
 * @returns {number}
 */
export function jumpClearance(o) {
  const s = standTop(o);
  if (s > 0) return s;
  const k = kindOf(o);
  const h = k && own(JUMP_CLEAR, k) ? JUMP_CLEAR[k] : 0;
  return h > 0 ? h : Infinity;
}

/** A height in world units on the Z_UNIT grid (whole Z_UNITs, rounded). */
export function toZq(z) {
  return Math.round(z / Z_UNIT);
}

/** True while in the air (jumping or falling; not while mantling). */
export function isAirborne(p) {
  return !!p && (p.vzq | 0) !== 0;
}

/** Put a record on its feet at height zq (default the ground) with nothing in progress. */
export function resetVertical(p, zq = 0) {
  p.zq = zq;
  p.vzq = 0;
  p.jumpCd = 0;
  p.climbT = 0;
  p.climbTo = -1;
  p.z = zq * Z_UNIT;
}

/** Copy the vertical state (a snapshot player → a predicted one, or back). */
export function copyVertical(dst, src) {
  dst.zq = src.zq | 0;
  dst.vzq = src.vzq | 0;
  dst.jumpCd = src.jumpCd | 0;
  dst.climbT = src.climbT | 0;
  dst.climbTo = src.climbT > 0 && Number.isInteger(src.climbTo) ? src.climbTo : -1;
  dst.z = dst.zq * Z_UNIT;
  return dst;
}

/** Coerce the vertical fields of a record to their integer ranges (missing = ground). */
export function normVertical(p) {
  const zq = Number.isFinite(p.zq) ? Math.round(p.zq) : 0;
  p.zq = zq < 0 ? 0 : zq > MAX_ZQ ? MAX_ZQ : zq;
  let v = Number.isFinite(p.vzq) ? Math.round(p.vzq) : 0;
  if (v < MAX_FALL_VQ) v = MAX_FALL_VQ; else if (v > JUMP_VQ) v = JUMP_VQ;
  p.vzq = v;
  p.jumpCd = p.jumpCd > 0 ? Math.min(255, Math.round(p.jumpCd)) : 0;
  p.climbT = p.climbT > 0 ? Math.min(255, Math.round(p.climbT)) : 0;
  if (!p.climbT || !Number.isInteger(p.climbTo)) p.climbTo = -1;
}

/**
 * One tick of jumping and falling (not mantling): take off when `cmd.jump` is set while
 * standing ready (alive only: a player downed mid-air still comes down), fly, and touch
 * down on the highest thing under the feet they were above (`groundQ(x, y, zq)`: the
 * highest standable top ≤ zq under (x, y), 0 for the ground), then JUMP_COOLDOWN.
 * Mutates p.zq, p.vzq, p.jumpCd and p.z.
 * @param {object} p
 * @param {object} cmd InputCmd (jump is read)
 * @param {function} groundQ (x, y, zq) → zq of the support
 * @returns {number} 1 = took off this tick, -1 = landed this tick, 0 otherwise
 */
export function stepJump(p, cmd, groundQ) {
  let ev = 0;
  if (p.jumpCd > 0) p.jumpCd--;
  if (p.vzq === 0 && p.jumpCd === 0 && cmd && cmd.jump && p.state === 'alive') {
    p.vzq = JUMP_VQ;
    ev = 1;
  }
  if (p.vzq !== 0) {
    const prev = p.zq;
    p.zq += p.vzq;
    p.vzq -= GRAVITY_Q;
    if (p.vzq < MAX_FALL_VQ) p.vzq = MAX_FALL_VQ;
    if (p.zq < prev || p.zq <= 0) {
      const g = groundQ(p.x, p.y, prev);
      if (p.zq <= g) {
        p.zq = g;
        p.vzq = 0;
        p.jumpCd = COOL_TICKS;
        ev = -1;
      }
    }
  }
  p.z = p.zq * Z_UNIT;
  return ev;
}
