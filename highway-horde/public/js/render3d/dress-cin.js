// Cinematic-tier finishing of the set dressing (world-dress.js): after a prop's own builder has run,
// every ground-standing prop gets the small things that seat it in the world: a soft soot / grime
// patch under it (the contact shadow the sun does not cast), grit and pebbles round its foot, a few
// weeds pushing through, and hydrants get real hardware (flange nuts, cap bolts, a chain). Cheap by
// design (about 50 triangles a prop) so the map's dressing budget still covers the same props.

import * as THREE from 'three';
import { DRESS_KINDS } from '../shared/dress.js';
import { T, S, DET, mark, rod } from './dress-kit.js';
import { shadeHex } from './world-geo.js';

const GRASS = ['#3d4f26', '#4a5a2c', '#56552f', '#34461f', '#5e5a36', '#6a6a3a'];
const GRIT = ['#6f6a62', '#5a564f', '#807a6e', '#4a4640', '#8a8478'];
const lowTorus = (tube) => T.custom('dtor' + tube, () => new THREE.TorusGeometry(1, tube, 4, 10));
const DOME = () => T.custom('ddome', () => new THREE.SphereGeometry(1, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2));

/** Kinds that need none of the ground dressing (flat marks, wall pieces, lines, things that are themselves ground cover). */
const SKIP = new Set(['leaves', 'pebbles', 'fern', 'tallgrass', 'flowers', 'reeds', 'shrub', 'mushrooms', 'boulders', 'lily', 'perch', 'campfire', 'log', 'driftwood', 'bones', 'litter', 'newsp', 'spill', 'clothes', 'tumbleweed', 'wire', 'laundry']);

/** A bolt / rivet head; `dir` is 'up' or 'pz' / 'nz' / 'px' / 'nx'. */
function bolt(D, x, y, z, dir, r, color = '#7a7e82') {
  const rot = dir === 'up' ? [0, 0, 0] : dir === 'pz' ? [Math.PI / 2, 0, 0] : dir === 'nz' ? [-Math.PI / 2, 0, 0] : dir === 'px' ? [0, 0, -Math.PI / 2] : [0, 0, Math.PI / 2];
  D.add('std', DOME(), [x, y, z], [r, r * 0.6, r], rot, color, { surf: [0, 0.45, 0.8], noAO: true, noJitter: true });
}

const EXTRAS = {
  hydrant(D, r) {
    for (const a of [0, 1, 2, 3]) bolt(D, Math.cos(a * 1.5708) * 3.6, 2.9, Math.sin(a * 1.5708) * 3.6, 'up', 0.55, '#3a3c40');   // the base flange nuts
    for (const z of [-1, 1]) for (let k = 0; k < 4; k++) {
      const a = k * 1.5708 + 0.4;
      bolt(D, 0.3 * Math.cos(a) + 0, 9.2 + Math.sin(a) * 1.4, z * 5.9, z > 0 ? 'pz' : 'nz', 0.32, '#c9ced3');
    }
    // the chain from the cap to the outlet
    D.add('std', lowTorus(0.14), [2.4, 11.2, 0.4], [1.2, 1.5, 1.2], [0.4, 1.2, 0.2], '#9a9a9a', S(0, 0.35, 0.9));
    D.add('std', lowTorus(0.14), [3.1, 9.6, 0.9], [1.2, 1.5, 1.2], [0.2, 0.3, 0.8], '#9a9a9a', S(0, 0.35, 0.9));
    if (r.chance(0.5)) mark(D, 'f_puddle', 0, 0, 20, 14, r.range(0, 6), '#1a1c1e', 0.3, 'wet');
  },
};

/**
 * Finish one prop. `it` is the dress item; the builder has already drawn it in the object frame.
 * Returns nothing; adds to `D` (the dress geo builder).
 */
export function cinDressExtras(D, it) {
  const def = DRESS_KINDS[it.k];
  if (!def) return;
  const flags = def[2] || '';
  if (flags.includes('f') || flags.includes('w') || flags.includes('l') || flags.includes('t') || SKIP.has(it.k)) return;
  const r = D.rng;
  const R = def[0];
  const h = def[1];
  if (EXTRAS[it.k]) EXTRAS[it.k](D, r);
  if (R < 4) return;
  // the contact patch: a dark soot blot a little wider than the footprint
  mark(D, 'f_soot', 0, 0, R * 2.6, R * 2.6, r.range(0, 6.28), '#0d0b09', 0.28);
  // grit round the foot
  const n = 2 + Math.floor(Math.min(R, 40) / 12);
  for (let i = 0; i < n; i++) {
    const a = r.range(0, 6.28), d = R * r.range(0.7, 1.25);
    const sz = r.range(0.35, 1.1);
    D.add('std', T.dodeca(), [Math.cos(a) * d, sz * 0.3, Math.sin(a) * d], [sz * 1.3, sz * 0.7, sz], [r.range(0, 1), r.range(0, 6), 0], r.pick(GRIT), { surf: [DET.rock, 0.9, 0], noAO: true });
  }
  // weeds pushing through the cracks beside it
  if (h > 2 && r.chance(0.65)) {
    const nb = 4 + Math.floor(r.next() * 5);
    const a0 = r.range(0, 6.28);
    for (let i = 0; i < nb; i++) {
      const a = a0 + r.range(-0.7, 0.7), d = R * r.range(0.75, 1.15);
      D.add('std', T.blade(), [Math.cos(a) * d, 0, Math.sin(a) * d], [r.range(0.9, 1.6), r.range(5, 11), 1], [r.range(-0.3, 0.3), r.range(0, 6.28), r.range(-0.4, 0.4)], r.pick(GRASS), { noAO: true, surf: [0, 0.9, 0] });
    }
  }
  void shadeHex; void rod;
}
