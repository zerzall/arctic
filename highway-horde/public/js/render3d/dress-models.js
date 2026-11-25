// Set-dressing kinds drawn with the photo-scanned models (props3d.js) once their library is in, on every
// tier but 'low'. Each entry places one or more model instances in the prop's own frame (+x = the way it
// faces, +y up, +z sideways; world-dress.js turns that into the world) and returns true; one that returns
// false (a variant the models do not cover: a wire basket, a wheelie bin) leaves the procedural builder of
// the kind to draw it. The builders may still add their small procedural extras (a stain, a stencil) on D.
//
// put(name, x, y, z, rotY, k, o): model `name` standing at local (x, y, z), turned by rotY about +y,
// scaled k × UNITS (o: { tilt: [rx, rz] radians, tint: [r, g, b] multiplier, sx / sz: per-axis factors }).

import { mark } from './dress-kit.js';

/** World units per metre the models are drawn at (1 unit ≈ 3 cm; a touch under real so they fit the props' footprints). */
export const UNITS = 31;
const TAU = Math.PI * 2;

/** A little brightness and warmth variation so repeated models do not look cloned. */
function tintOf(r, amt = 0.14, warm = 0.05) {
  const b = 1 + (r.next() - 0.5) * 2 * amt, w = (r.next() - 0.5) * 2 * warm;
  return [b * (1 + w), b, b * (1 - w)];
}

const DRUMS = ['drum_a', 'drum_b', 'drum_c'];

export const MODEL_KINDS = {
  drum(P, put) {
    const r = P.D.rng;
    const m = r.pick(DRUMS);
    if (r.chance(0.2)) {
      // lying on its side, a dark stain where it leaked
      const a = r.range(0, TAU);
      put(m, 0, 8.6, 0, a, 1, { tilt: [Math.PI / 2, 0], tint: tintOf(r) });
      mark(P.D, 'f_stain', Math.cos(a) * 16, -Math.sin(a) * 16, 24, 18, a, '#070605', 0.25);
    } else put(m, 0, 0, 0, r.range(0, TAU), 1, { tint: tintOf(r) });
    return true;
  },
  drums(P, put) {
    const r = P.D.rng;
    const pts = [[-9.5, -9.5], [9.5, -9.5], [-9.5, 9.5], [9.5, 9.5]];
    const n = 3 + Math.floor(r.next() * 2);
    const m0 = r.pick(DRUMS);
    for (let i = 0; i < n; i++) {
      const [x, z] = pts[i];
      put(r.chance(0.7) ? m0 : r.pick(DRUMS), x + r.range(-1, 1), 0, z + r.range(-1, 1), r.range(0, TAU), 1, { tint: tintOf(r) });
    }
    if (r.chance(0.4)) put(r.pick(DRUMS), 26, 8.6, r.range(-6, 6), r.range(0, TAU), 1, { tilt: [Math.PI / 2, 0], tint: tintOf(r) });
    return true;
  },
  crate(P, put) {
    const r = P.D.rng;
    put(r.chance(0.5) ? 'crate_a' : 'crate_b', 0, 0, 0, r.range(0, TAU), 1.25 * (P.s || 1), { tint: tintOf(r, 0.18) });
    return true;
  },
  crates(P, put) {
    const r = P.D.rng;
    const base = r.range(0, TAU);
    const c = Math.cos(base), s = Math.sin(base);
    const at = (lx, lz) => [lx * c + lz * s, -lx * s + lz * c];
    const k = 1.3;
    let [x, z] = at(-17, 0); put('crate_a', x, 0, z, base + r.range(-0.1, 0.1), k, { tint: tintOf(r, 0.18) });
    [x, z] = at(17, 0); put('crate_a', x, 0, z, base + r.range(-0.1, 0.1), k, { tint: tintOf(r, 0.18) });
    // (crate_a is 0.35 m high)
    [x, z] = at(0, 0); put('crate_a', x, 0.35 * UNITS * k, z, base + r.range(-0.3, 0.3), k, { tint: tintOf(r, 0.18) });
    if (r.chance(0.5)) { [x, z] = at(4, -28); put('crate_b', x, 0, z, base + Math.PI / 2 + r.range(-0.2, 0.2), 1.2, { tint: tintOf(r, 0.18) }); }
    return true;
  },
  milcrate(P, put) {
    const r = P.D.rng;
    put('milcrate', 0, 0, 0, r.range(0, TAU), 1, { tint: tintOf(r, 0.1) });
    if (r.chance(0.4)) put('milcrate', r.range(-2, 2), 0.3 * UNITS, r.range(-2, 2), r.range(0, TAU), 0.9, { tint: tintOf(r, 0.1) });
    return true;
  },
  mil_box(P, put) {
    const r = P.D.rng;
    put('milcrate', 0, 0, 0, r.range(0, TAU), 0.75, { tint: tintOf(r, 0.1) });
    return true;
  },
  box(P, put) {
    const r = P.D.rng;
    put('cardboard', 0, 0, 0, r.range(0, TAU), r.range(0.8, 1.15) * (P.s || 1), { tint: tintOf(r, 0.12, 0.06) });
    return true;
  },
  box_stack(P, put) {
    const r = P.D.rng;
    const n = 2 + Math.floor(r.next() * 3);
    const base = r.range(0, TAU);
    let y = 0;
    for (let i = 0; i < n; i++) {
      const k = r.range(0.9, 1.15) * (1 - i * 0.06);
      put('cardboard', r.range(-2, 2), y, r.range(-2, 2), base + r.range(-0.3, 0.3), k, { tint: tintOf(r, 0.12, 0.06) });
      y += 0.34 * UNITS * k;
    }
    if (r.chance(0.5)) put('cardboard', r.range(14, 18), 0, r.range(-6, 6), base + r.range(-0.6, 0.6), 0.85, { tint: tintOf(r, 0.12, 0.06) });
    return true;
  },
  gascyl(P, put) {
    const r = P.D.rng;
    if (r.chance(0.2)) put('propane', 0, 0.17 * UNITS * 1.1, 0, r.range(0, TAU), 1.1, { tilt: [Math.PI / 2, 0], tint: tintOf(r) });
    else put('propane', 0, 0, 0, r.range(0, TAU), 1.1, { tint: tintOf(r) });
    return true;
  },
  fuel_can(P, put) {
    const r = P.D.rng;
    if (r.chance(0.25)) put('jerrycan', 0, 0.085 * UNITS, 0, r.range(0, TAU), 0.95, { tilt: [Math.PI / 2, 0], tint: tintOf(r) });
    else put('jerrycan', 0, 0, 0, r.range(0, TAU), 0.95, { tint: tintOf(r) });
    return true;
  },
  bin(P, put) {
    const r = P.D.rng;
    // (the procedural builder draws the wire baskets and wheelie bins: about half of them)
    if (r.next() < 0.5) return false;
    put(r.chance(0.5) ? 'trashcan_rust' : 'trashcan', 0, 0, 0, r.range(0, TAU), 1, { tint: tintOf(r) });
    return true;
  },
  bin_fall(P, put) {
    const r = P.D.rng;
    if (r.next() < 0.4) return false;
    put(r.chance(0.6) ? 'trashcan_rust' : 'trashcan', 0, 0.28 * UNITS, 0, r.range(0, TAU), 1, { tilt: [Math.PI / 2, 0], tint: tintOf(r) });
    for (let i = 0; i < 2; i++) put('trashbag', r.range(10, 22), 0, r.range(-10, 10), r.range(0, TAU), r.range(0.6, 0.8), { tint: tintOf(r, 0.1) });
    return true;
  },
  hydrant(P, put) {
    const r = P.D.rng;
    put('hydrant', 0, 0, 0, r.range(0, TAU), 1, { tint: tintOf(r, 0.1) });
    return true;
  },
  generator(P, put) {
    const r = P.D.rng;
    put('generator', 0, 0, 0, r.range(0, TAU), 1.1, { tint: tintOf(r, 0.08) });
    return true;
  },
  wheel_loose(P, put) {
    const r = P.D.rng;
    // lying flat (the model stands on its tread: tipped onto its side)
    put('tyre', 0, 0.3 * UNITS, 0, r.range(0, TAU), 0.9, { tilt: [Math.PI / 2, 0], tint: tintOf(r, 0.1, 0) });
    return true;
  },
  bag(P, put) {
    const r = P.D.rng;
    put('trashbag', 0, 0, 0, r.range(0, TAU), r.range(0.55, 0.8), { tint: tintOf(r, 0.1, 0) });
    return true;
  },
  picnic(P, put) {
    const r = P.D.rng;
    put('picnic', 0, 0, 0, r.range(0, TAU), 0.9, { tint: tintOf(r, 0.12) });
    return true;
  },
  chair(P, put) {
    const r = P.D.rng;
    if (r.chance(0.5)) return false;   // (folding camp chairs stay procedural)
    put('chair', 0, 0, 0, r.range(0, TAU), 0.95, { tint: tintOf(r, 0.06, 0) });
    return true;
  },
  stump(P, put) {
    const r = P.D.rng;
    put('stump', 0, -2, 0, r.range(0, TAU), r.range(0.8, 1.05), { tint: tintOf(r, 0.15) });
    return true;
  },
  log(P, put) {
    const r = P.D.rng;
    put('log', 0, 0, 0, r.range(-0.3, 0.3), r.range(0.9, 1.25), { tint: tintOf(r, 0.15) });
    return true;
  },
  boulders(P, put) {
    const r = P.D.rng;
    put('boulder', 0, -3, 0, r.range(0, TAU), r.range(0.55, 0.85), { tint: tintOf(r, 0.12, 0.03).map((v) => v * 1.25) });
    const n = Math.floor(r.next() * 3);
    for (let i = 0; i < n; i++) put('boulder', r.range(-30, 30), -2, r.range(-24, 24), r.range(0, TAU), r.range(0.25, 0.4), { tint: tintOf(r, 0.12, 0.03).map((v) => v * 1.25) });
    return true;
  },
  wheelchair(P, put) {
    const r = P.D.rng;
    put('wheelchair', 0, 0, 0, r.range(0, TAU), 0.95, { tint: tintOf(r, 0.06, 0) });
    return true;
  },
};

/** Kinds that may be drawn by models. */
export const MODEL_KIND_LIST = Object.freeze(Object.keys(MODEL_KINDS));
