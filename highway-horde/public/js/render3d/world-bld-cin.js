// Cinematic-tier roofs for world-bld.js (WORLD): gable roofs get real shingle courses (a row of thin
// slightly darker slabs every few units up the slope, so the roof reads in raking light), rafter
// tails under the eaves, a ridge vent and plumbing vents; flat roofs get membrane seams, roof
// drains and parapet scuppers, ballast stones, skylights, a cable tray on stands, an exhaust fan
// and a maintenance rail. Uses its own seeded rng (never `B.rng`), so turning it on does not move
// anything else in the building.

import * as THREE from 'three';
import { T, shadeHex, seededRng } from './world-geo.js';
import { DET } from './world-surf.js';

const lowCyl = (seg) => T.custom('blowcyl' + seg, () => new THREE.CylinderGeometry(1, 1, 1, seg, 1));
const _v = new THREE.Vector3();
const _e = new THREE.Euler();

/** Gable roof extras. `g` is gableRoof's return, `slabs` its slab numbers: { th, oh, gh, phi, slopeLen, hx, cy }. */
export function cinGable(B, ctx, g, slabs, rc, layer) {
  const r = seededRng((ctx.id | 0) * 7919 + 17);
  const { th, oh, gh, phi, slopeLen, hx, cy } = slabs;
  const { len, span, rise, map, rotY } = g;
  const wallH = ctx.wallH;
  const surf = { surf: [layer, 0.88, layer === DET.metalroof ? 0.6 : 0], noJitter: true, noAO: true };
  const dark = shadeHex(rc, -0.13), light = shadeHex(rc, 0.06);
  for (const sd of [-1, 1]) {
    _e.set(sd * phi, 0, 0);
    const eul = new THREE.Euler(sd * phi, rotY, 0, 'YXZ');
    // shingle courses: a thin slab every 4.4 units of slope, alternately darker, a hand's width proud
    const n = Math.floor(slopeLen / 4.4);
    for (let k = 0; k < n; k++) {
      const zl = -slopeLen / 2 + (k + 0.6) * (slopeLen / n);
      _v.set(0, th / 2 + 0.18, zl).applyEuler(_e);
      B.add('std', T.box(), map(0, cy + _v.y, sd * hx + _v.z), [len + gh * 2 - 0.4, 0.42, slopeLen / n * 0.55], eul, k % 2 ? dark : light, surf);
    }
    // rafter tails: the ends of the rafters under the overhang
    const tail = oh / Math.cos(phi);
    for (let u = -len / 2 + 5; u < len / 2 - 3; u += 7) {
      _v.set(0, -th / 2 - 1.1, slopeLen / 2 - tail / 2).applyEuler(_e);
      B.add('std', T.box(), map(u, cy + _v.y, sd * hx + _v.z), [1.5, 2.2, tail], eul, ctx.trim, { surf: [DET.wood, 0.85, 0], noJitter: true });
    }
  }
  // ridge vent along most of the ridge
  B.add('std', T.box(), map(0, wallH + rise + 1.9, 0), [len * 0.78, 1.0, 2.2], [0, rotY, 0], '#2a2a2a', { surf: [DET.rust, 0.6, 0.5], noJitter: true });
  // plumbing vents and a pipe collar on the back slope
  for (let i = 0; i < 2; i++) {
    const u = r.range(-len * 0.3, len * 0.3), v = -span * r.range(0.12, 0.28);
    const y = wallH + rise - Math.abs(v) * Math.tan(phi) + th;
    const p = map(u, y, v);
    B.add('std', lowCyl(8), [p[0], p[1] + 4.5, p[2]], [1.2, 9, 1.2], null, '#5a5e62', { surf: [DET.rust, 0.5, 0.7], noJitter: true });
    B.add('std', lowCyl(10), [p[0], p[1] + 0.4, p[2]], [2.4, 0.8, 2.4], null, '#4a4e52', { surf: [DET.rust, 0.5, 0.7], noJitter: true });
  }
}

/** Flat roof extras (`L` x `W` deck at wallH, parapet height `ph`). */
export function cinFlatRoof(B, ctx, ph) {
  const r = seededRng((ctx.id | 0) * 6151 + 29);
  const { L, W, wallH } = ctx;
  const seam = shadeHex(ctx.roofColor, -0.3);
  // membrane seams across the deck
  for (let x = -L / 2 + 14; x < L / 2 - 8; x += 22) B.box('std', x, wallH + 1.4, 0, 0.7, 0.35, W - 8, seam, null, { surf: [0, 0.9, 0], noAO: true, noJitter: true });
  // ballast stones
  for (let i = 0; i < 14; i++) {
    const s = r.range(0.7, 1.6);
    B.add('std', T.dodeca(), [r.range(-L * 0.42, L * 0.42), wallH + 1.4 + s * 0.3, r.range(-W * 0.4, W * 0.4)], [s * 1.4, s * 0.7, s], [r.range(0, 1), r.range(0, 6), 0], r.pick(['#8a867c', '#6e6a62', '#9a9488']), { surf: [DET.rock, 0.9, 0], noAO: true });
  }
  // roof drains, and scuppers through the parapet toward them
  for (const sd of [-1, 1]) {
    const x = r.range(-L * 0.3, L * 0.3);
    B.add('std', lowCyl(12), [x, wallH + 1.5, sd * (W / 2 - 9)], [3, 0.6, 3], null, '#26282a', { surf: [DET.rust, 0.6, 0.7], noAO: true, noJitter: true });
    B.box('std', x, wallH + 2.5, sd * (W / 2 - 1.5), 5, 1.8, 1.5, '#1c1d1e', null, { surf: [DET.rust, 0.6, 0.7], noAO: true, noJitter: true });
    B.box('std', x, wallH + 1.2, sd * (W / 2 - 5.5), 2.2, 0.3, 8, seam, null, { surf: [0, 0.9, 0], noAO: true, noJitter: true });
  }
  // a skylight
  if (r.chance(0.6)) {
    const x = r.range(-L * 0.25, L * 0.25), z = r.range(-W * 0.2, W * 0.2);
    B.rbox('std', x, wallH + 3.2, z, 20, 4, 14, 0.8, '#7d8286', null, { surf: [DET.panel, 0.5, 0.5], noAO: true, noJitter: true });
    B.box('glass', x, wallH + 5.4, z, 17, 0.6, 11, '#2a3844', [0, 0, 0.05]);
    for (const dx of [-5.6, 0, 5.6]) B.box('std', x + dx, wallH + 5.7, z, 0.5, 0.5, 11.4, '#5a5e62', null, { surf: [DET.rust, 0.5, 0.7], noAO: true, noJitter: true });
  }
  // a cable tray on little stands, and junction boxes
  if (r.chance(0.6)) {
    const z = r.range(-W * 0.35, W * 0.35), x0 = -L * 0.3, x1 = L * 0.2;
    B.box('std', (x0 + x1) / 2, wallH + 5, z, x1 - x0, 0.6, 5, '#7a7e82', null, { surf: [DET.rust, 0.5, 0.7], noAO: true, noJitter: true });
    for (let x = x0; x <= x1; x += 14) {
      B.box('std', x, wallH + 3, z, 0.8, 4, 0.8, '#5a5e62', null, { surf: [DET.rust, 0.5, 0.7], noAO: true, noJitter: true });
      B.box('std', x, wallH + 3, z + 3.4, 0.8, 4, 0.8, '#5a5e62', null, { surf: [DET.rust, 0.5, 0.7], noAO: true, noJitter: true });
    }
    B.rbox('std', x1 + 4, wallH + 5, z, 6, 8, 5, 0.6, '#7d8286', null, { surf: [DET.panel, 0.5, 0.5], noAO: true, noJitter: true });
  }
  // an exhaust fan: a curb, a dome and a guard ring
  if (r.chance(0.6)) {
    const x = r.range(-L * 0.35, L * 0.35), z = r.range(-W * 0.3, W * 0.3);
    B.add('std', T.cyl(14), [x, wallH + 3.4, z], [5.4, 4.4, 5.4], null, '#8a8e92', { surf: [DET.panel, 0.45, 0.6], noAO: true, noJitter: true });
    B.add('std', T.sphere(12, 5), [x, wallH + 5.6, z], [5, 2.2, 5], null, '#6e7276', { surf: [DET.panel, 0.45, 0.6], noAO: true, noJitter: true });
    B.add('std', T.torus(14, 0.12, 4), [x, wallH + 5.8, z], [4.6, 4.6, 4.6], [Math.PI / 2, 0, 0], '#3a3c40', { surf: [DET.rust, 0.5, 0.7], noAO: true, noJitter: true });
  }
  // a maintenance rail along the front parapet
  if (r.chance(0.35)) {
    for (let x = -L * 0.3; x <= L * 0.3; x += 22) B.box('std', x, wallH + ph + 7, W / 2 - 2, 0.9, 12, 0.9, '#9aa0a4', null, { surf: [DET.rust, 0.4, 0.85], noAO: true, noJitter: true });
    B.cylX('std', 0, wallH + ph + 13, W / 2 - 2, 0.6, L * 0.6, '#9aa0a4', 6, { surf: [DET.rust, 0.4, 0.85], noAO: true, noJitter: true });
  }
}
