// The baker's material library: every recipe, in a fixed order (the manifest follows it).
// A recipe: { name, det (the DET layer whose tile size it takes, or tileUnits), depth (mm of relief
// for height 0..1), cells / shift / parallax (overrides of the game's per-layer tables), about,
// bake(surface, seed) }.

import { DET, DET_TILE } from '../../../public/js/render3d/world-surf-gen.js';
import { MASONRY } from './masonry.js';
import { GROUND } from './ground.js';
import { METAL } from './metal.js';
import { WOOD } from './wood.js';
import { INTERIOR } from './interior.js';
import { MISC } from './misc.js';

/** World units (≈ 3 cm) → metres. */
export const UNIT_M = 0.03;

export const RECIPES = [...MASONRY, ...GROUND, ...METAL, ...WOOD, ...INTERIOR, ...MISC];

/** Tile size of a recipe in metres (its DET layer's repeat, unless it gives its own). */
export function recipeTile(r) {
  const units = r.tileUnits ?? DET_TILE[DET[r.det]];
  if (!(units > 0)) throw new Error(`${r.name}: no tile size (det ${r.det})`);
  return units * UNIT_M;
}
