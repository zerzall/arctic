// Small numeric helpers shared by every module. Pure functions, no allocation-heavy code.

export const TAU = Math.PI * 2;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Wrap an angle into (-PI, PI]. */
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Signed shortest difference b - a, in (-PI, PI]. */
export function angleDiff(a, b) {
  return wrapAngle(b - a);
}

/** Interpolate between two angles along the shortest arc. */
export function lerpAngle(a, b, t) {
  return a + angleDiff(a, b) * t;
}

/** Rotate `from` towards `to` by at most `maxStep` radians. */
export function turnTowards(from, to, maxStep) {
  const d = angleDiff(from, to);
  if (Math.abs(d) <= maxStep) return to;
  return from + Math.sign(d) * maxStep;
}

export function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

export function dist2(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
}

export function length(x, y) {
  return Math.hypot(x, y);
}

/** Normalise (x, y); returns {x: 0, y: 0} for a zero vector. */
export function normalize(x, y) {
  const l = Math.hypot(x, y);
  return l > 1e-9 ? { x: x / l, y: y / l } : { x: 0, y: 0 };
}

export function approach(v, target, step) {
  return v < target ? Math.min(v + step, target) : Math.max(v - step, target);
}

/** Frame-rate independent exponential smoothing factor. */
export function damp(rate, dt) {
  return 1 - Math.exp(-rate * dt);
}

export function round1(v) {
  return Math.round(v * 10) / 10;
}
