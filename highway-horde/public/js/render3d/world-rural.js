// Harlan County's own obstacle kinds for the static world (WORLD, SPEC §7.5): grain silos
// (corrugated steel on a concrete ring, banded, a conical roof with a vent, a caged ladder
// and an aviation light) and graveyard headstones (a stone slab with a rounded or cross top,
// its grave mound in front). Same geo-builder conventions as world-props.js: local x along
// the obstacle's length (o.w), z along its width (o.h), y up.

import { T, shadeHex, hash01 } from './world-geo.js';
import { DET } from './world-surf.js';

const CONCRETE = '#8a877e';

/** Canonical heights (units) of the kinds built here. */
export const RURAL_HEIGHT = Object.freeze({ silo: 300, grave: 30 });

/** Grain silo, `L` wide (round: the smaller side is the diameter). */
export function silo(B, L, W, color) {
  const R = Math.min(L, W) / 2;
  const H = RURAL_HEIGHT.silo - 40;
  const steel = { surf: [DET.corrugated, 0.5, 0.75] };
  B.cyl('std', 0, 0, 0, R + 4, 8, CONCRETE, 24, 1, null, { surf: [DET.concrete, 0.9, 0] });
  B.cyl('std', 0, 8, 0, R, H - 8, color, 24, 1, null, steel);
  // stiffening bands and a darker weathered skirt
  for (let y = 40; y < H - 10; y += 46) B.cyl('std', 0, y, 0, R + 0.9, 2.5, shadeHex(color, -0.18), 24, 1, null, steel);
  B.cyl('std', 0, 8, 0, R + 0.4, 34, shadeHex(color, -0.28), 24, 1, null, { surf: [DET.rust, 0.7, 0.6] });
  // conical roof, vent cap
  B.cyl('std', 0, H, 0, R + 3, 36, shadeHex(color, 0.08), 24, 0.14, null, steel);
  B.cyl('std', 0, H + 34, 0, R * 0.2, 10, shadeHex(color, -0.1), 12, 1, null, steel);
  B.cyl('std', 0, H + 44, 0, R * 0.28, 3, shadeHex(color, -0.25), 12, 0.3, null, steel);
  // caged ladder up the +x side
  const lx = R + 3;
  for (const z of [-5, 5]) B.box('std', lx, H / 2 + 4, z, 1.2, H - 8, 1.2, '#4a4c4e', null, { surf: [DET.rust, 0.5, 0.8] });
  for (let y = 16; y < H; y += 12) B.box('std', lx, y, 0, 1, 1, 10, '#4a4c4e', null, { surf: [DET.rust, 0.5, 0.8] });
  for (let y = 70; y < H; y += 36) B.add('std', T.torus(10, 0.08, 4), [lx + 5, y, 0], [8, 8, 8], [Math.PI / 2, 0, 0], '#4a4c4e', { surf: [DET.rust, 0.5, 0.8] });
  // the red aviation light on top
  B.box('blink', 0, H + 48, 0, 3, 3, 3, '#ff3a2a', null, { emissive: 3 });
}

/** Headstone: a stone slab, rounded or crowned by a cross, with its mound in front (+z). */
export function headstone(B, L, W, color, seed = 0) {
  const stone = { surf: [DET.rock, 0.86, 0] };
  const kind = hash01(seed * 13 + 7);
  const h = RURAL_HEIGHT.grave - 6;
  if (kind < 0.25) {
    // a cross
    B.rblock('std', 0, 0, 0, L * 0.7, 4, W, 1, shadeHex(color, -0.1), null, stone);
    B.rblock('std', 0, 4, 0, 5, h + 4, 5, 1, color, null, stone);
    B.rblock('std', 0, h - 6, 0, L * 0.6, 5, 5, 1, color, null, stone);
  } else {
    B.rblock('std', 0, 0, 0, L * 0.92, h, W * 0.75, 1.2, color, null, stone);
    if (kind < 0.7) B.add('std', T.cyl(14), [0, h, 0], [L * 0.46, W * 0.75, L * 0.46], [Math.PI / 2, 0, 0], color, { map: 'cyl', ...stone });
    // lichen down one side
    B.box('std', -L * 0.2, h * 0.35, W * 0.38, L * 0.3, h * 0.5, 0.4, '#5d6b48', null, { surf: [DET.rock, 0.95, 0] });
  }
  B.add('std', T.pillow(10, 6, 0.5), [0, 0.5, W / 2 + 16], [L * 0.42, 2.5, 13], null, '#3a3226', { surf: [DET.dirt, 0.95, 0] });
}
