// Jumping, shared by the host simulation and client-side prediction (SPEC §3.2).
//
// The jump is a fixed parabola in time, so its whole state is one number per player,
// `jumpT` (seconds):
//   jumpT > 0   airborne, seconds since take-off (height = jumpHeight(jumpT))
//   jumpT < 0   just landed: cooldown left before the next jump (on the ground)
//   jumpT = 0   on the ground, ready
// Every step adds exactly one tick, so the value is always a whole number of ticks and
// travels exactly in a snapshot (protocol.js sends it as signed ticks): a client replaying
// its inputs from an acknowledged snapshot lands on the same tick as the host.

import { JUMP_HEIGHT, JUMP_TIME, JUMP_COOLDOWN, JUMP_CLEAR } from './constants.js';

/** Take-off speed (units/s) and gravity (units/s²) of the JUMP_HEIGHT / JUMP_TIME arc. */
export const JUMP_SPEED = (4 * JUMP_HEIGHT) / JUMP_TIME;
export const JUMP_GRAVITY = (8 * JUMP_HEIGHT) / (JUMP_TIME * JUMP_TIME);
/** The highest JUMP_CLEAR value: below it a descending player may meet low cover again. */
export const JUMP_CLEAR_MAX = Math.max(0, ...Object.values(JUMP_CLEAR));

// Float residue of adding 1/60 repeatedly must never cost or gain a tick.
const EPS = 1e-6;

/**
 * Height of the feet above the ground (world units) `t` seconds after take-off; 0 on the
 * ground (t ≤ 0 or t ≥ JUMP_TIME).
 * @param {number} t jumpT
 * @returns {number}
 */
export function jumpHeight(t) {
  if (!(t > 0) || t >= JUMP_TIME - EPS) return 0;
  const u = t / JUMP_TIME;
  return 4 * JUMP_HEIGHT * u * (1 - u);
}

/**
 * Advance a player's jump by one tick: land at the end of the arc (then JUMP_COOLDOWN on
 * the ground), take off when `cmd.jump` is set while standing ready. Only 'alive' players
 * take off (a player downed mid-air still comes down); the dead are reset to the ground.
 * Mutates p.jumpT and p.z (feet height).
 * @param {object} p { state, jumpT }
 * @param {object} cmd InputCmd (jump is read)
 * @param {number} dt seconds (one tick)
 * @returns {number} 1 = took off this tick, -1 = landed this tick, 0 otherwise
 */
export function stepJump(p, cmd, dt) {
  let t = Number.isFinite(p.jumpT) ? p.jumpT : 0;
  let ev = 0;
  if (p.state === 'dead') {
    t = 0;
  } else if (t > 0) {
    t += dt;
    if (t >= JUMP_TIME - EPS) {
      t = JUMP_COOLDOWN > EPS ? -JUMP_COOLDOWN : 0;
      ev = -1;
    }
  } else if (t < 0) {
    t += dt;
    if (t > -EPS) t = 0;
  }
  if (t === 0 && ev === 0 && cmd && cmd.jump && p.state === 'alive') {
    t = dt;
    ev = 1;
  }
  p.jumpT = t;
  p.z = jumpHeight(t);
  return ev;
}

/**
 * Height a jumping player's feet must reach to pass over obstacle `o` (MapDef obstacle),
 * or Infinity when it can't be jumped (see JUMP_CLEAR).
 * @param {object} o
 * @returns {number}
 */
export function jumpClearance(o) {
  const h = o && Object.prototype.hasOwnProperty.call(JUMP_CLEAR, o.kind) ? JUMP_CLEAR[o.kind] : undefined;
  return h > 0 ? h : Infinity;
}
