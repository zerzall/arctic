// First-person look math (SPEC §7.5 "Look & movement"): pure functions shared by
// ui/match.js and ui/input.js and unit-tested in Node. The UI owns yaw/pitch in fps view:
// mouse/touch deltas (CSS px) and the gamepad's right stick (converted to an equivalent
// delta per frame) turn the camera; WASD/stick movement is rotated from "relative to where
// I look" into world space before it reaches the session.
//
// Angles follow the sim (SPEC §0): 0 = +x, +π/2 = +y (south on the map), so turning right
// increases the yaw. Pitch > 0 looks up.

/** Radians per CSS px of mouse movement at sensitivity 1 (SPEC §7.5: ≈ 0.0022). */
export const LOOK_RAD_PER_PX = 0.0022;
/** Pitch clamp (radians), SPEC §7.5. */
export const PITCH_LIMIT = 1.35;
/** Full right-stick deflection turns this many px-equivalents per second (≈ 2.9 rad/s at 1×). */
export const PAD_LOOK_PX_PER_S = 1300;
/** Vertical stick look is slower than horizontal: pitch needs precision, yaw needs speed. */
export const PAD_LOOK_PITCH = 0.6;
/** Touch drags are short thumb strokes: scale them up to feel like a mouse. */
export const TOUCH_LOOK_GAIN = 1.8;
/** Sensitivity multipliers offered by the settings. */
export const SENS_MIN = 0.2;
export const SENS_MAX = 3;

/**
 * Aim assist (gamepad/touch only): light yaw magnetism toward the zombie nearest the
 * crosshair. The pull fades to zero at the cone edge and at the aim point, so it settles on
 * a target without ever snapping, and any turn faster than ~0.25 rad/s escapes it.
 */
export const AIM_ASSIST = {
  cone: 0.16,        // half-angle (rad) around the crosshair a target must be in
  range: 1000,       // world px
  minRange: 12,      // ignore anything inside the player
  rate: 6,           // pull strength (1/s)
};

const TAU = Math.PI * 2;

/** Wrap an angle into (-π, π]. */
export function wrapAngle(a) {
  if (!Number.isFinite(a)) return 0;
  a %= TAU;
  if (a <= -Math.PI) a += TAU;
  else if (a > Math.PI) a -= TAU;
  return a;
}

/** Signed smallest difference b - a in (-π, π]. */
export function angleDelta(a, b) {
  return wrapAngle(b - a);
}

/** Clamp a pitch to ±PITCH_LIMIT. */
export function clampPitch(p) {
  if (!Number.isFinite(p)) return 0;
  return Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, p));
}

/** A settings value as a finite sensitivity multiplier in [SENS_MIN, SENS_MAX]. */
export function sensitivityOf(v, fallback = 1) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(SENS_MIN, Math.min(SENS_MAX, n));
}

/**
 * Turn `look` by a pointer delta (CSS px; +dx = right, +dy = down). Mutates and returns it.
 * @param {{yaw: number, pitch: number}} look
 * @param {number} dx
 * @param {number} dy
 * @param {{sensitivity?: number, invertY?: boolean}} [opts]
 */
export function applyLook(look, dx, dy, opts = {}) {
  const k = LOOK_RAD_PER_PX * sensitivityOf(opts.sensitivity);
  const ddx = Number.isFinite(dx) ? dx : 0;
  const ddy = Number.isFinite(dy) ? dy : 0;
  look.yaw = wrapAngle(look.yaw + ddx * k);
  // Mouse down looks down (pitch decreases) unless the player inverted the Y axis.
  look.pitch = clampPitch(look.pitch + (opts.invertY ? ddy : -ddy) * k);
  return look;
}

/**
 * Rotate a view-relative move vector into world space. (mx, my) come from the input with
 * the top-down convention: +mx = strafe right (D), +my = backwards (S).
 * forward = (cos yaw, sin yaw), right = (cos(yaw + π/2), sin(yaw + π/2)).
 * @param {number} mx
 * @param {number} my
 * @param {number} yaw
 * @param {{x: number, y: number}} [out]
 * @returns {{x: number, y: number}}
 */
export function moveToWorld(mx, my, yaw, out = { x: 0, y: 0 }) {
  const f = -(my || 0), r = mx || 0;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  out.x = c * f - s * r;
  out.y = s * f + c * r;
  // Float noise must never push a unit input past length 1 (the sim clamps anyway).
  const len = Math.hypot(out.x, out.y);
  if (len > 1) {
    out.x /= len;
    out.y /= len;
  }
  return out;
}

/**
 * Stick response curve (after the dead zone): gentle near the centre for fine aim, full
 * speed at the rim. Monotonic, curve(0) = 0, curve(1) = 1.
 * @param {number} m magnitude 0..1
 */
export function stickCurve(m) {
  const x = Math.max(0, Math.min(1, m || 0));
  return 0.3 * x + 0.7 * x * x * x;
}

/**
 * Right-stick look for one frame as a px-equivalent delta (same units as mouse movement).
 * @param {number} sx stick x after the dead zone (-1..1)
 * @param {number} sy stick y after the dead zone (-1..1, +1 = down)
 * @param {number} dt seconds
 * @param {{dx: number, dy: number}} [out]
 */
export function padLookDelta(sx, sy, dt, out = { dx: 0, dy: 0 }) {
  const m = Math.min(1, Math.hypot(sx || 0, sy || 0));
  if (!(m > 0) || !(dt > 0)) {
    out.dx = 0;
    out.dy = 0;
    return out;
  }
  const k = (stickCurve(m) / m) * PAD_LOOK_PX_PER_S * Math.min(dt, 0.1);
  out.dx = sx * k;
  out.dy = sy * k * PAD_LOOK_PITCH;
  return out;
}

/**
 * The zombie nearest the crosshair (smallest angle off the view direction) inside the
 * assist cone and range, or null.
 * @param {number} yaw
 * @param {number} px player x
 * @param {number} py player y
 * @param {Array<{x: number, y: number}>} zombies
 * @param {object} [opts] overrides for AIM_ASSIST
 * @returns {{target: object, delta: number}|null} delta = signed yaw change toward it
 */
export function assistTarget(yaw, px, py, zombies, opts = AIM_ASSIST) {
  const cone = opts.cone ?? AIM_ASSIST.cone;
  const range = opts.range ?? AIM_ASSIST.range;
  const minR = opts.minRange ?? AIM_ASSIST.minRange;
  let best = null, bestAbs = Infinity, bestDelta = 0;
  if (!zombies) return null;
  for (let i = 0; i < zombies.length; i++) {
    const z = zombies[i];
    const dx = z.x - px, dy = z.y - py;
    const d = Math.hypot(dx, dy);
    if (!(d > minR) || d > range) continue;
    const delta = angleDelta(yaw, Math.atan2(dy, dx));
    const abs = Math.abs(delta);
    if (abs <= cone && abs < bestAbs) {
      bestAbs = abs;
      best = z;
      bestDelta = delta;
    }
  }
  return best ? { target: best, delta: bestDelta } : null;
}

/**
 * One frame of aim assist: returns the new yaw. The pull is delta·rate·(1 − |delta|/cone),
 * zero at the target and at the cone edge, and never overshoots the target.
 * @param {number} yaw
 * @param {number} px
 * @param {number} py
 * @param {Array<{x: number, y: number}>} zombies
 * @param {number} dt
 * @param {object} [opts] overrides for AIM_ASSIST
 */
export function aimAssist(yaw, px, py, zombies, dt, opts = AIM_ASSIST) {
  if (!(dt > 0)) return yaw;
  const t = assistTarget(yaw, px, py, zombies, opts);
  if (!t) return yaw;
  const cone = opts.cone ?? AIM_ASSIST.cone;
  const rate = opts.rate ?? AIM_ASSIST.rate;
  const falloff = Math.max(0, 1 - Math.abs(t.delta) / cone);
  let step = t.delta * rate * falloff * Math.min(dt, 0.1);
  if (Math.abs(step) > Math.abs(t.delta)) step = t.delta;
  return wrapAngle(yaw + step);
}

/**
 * Compass heading in whole degrees for a sim angle: 0 = north (-y), 90 = east (+x).
 * @param {number} yaw
 */
export function headingDeg(yaw) {
  const d = Math.round(((yaw + Math.PI / 2) * 180) / Math.PI);
  return ((d % 360) + 360) % 360;
}
