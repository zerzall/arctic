// Which baked texture set (public/textures/<set>/, scripts/bake-textures.js) draws each surface id
// (DET, world-surf-gen.js), and the per-map themes that swap in a level's hero sets: the hospital's
// scuffed wall tile and vinyl, the metro's grimy subway tile, the dam's water-stained concrete, the
// rail yard's oily ballast and rusted rail, the airbase's camouflage paint and runway, Sandstone's
// sun-bleached plaster, adobe and blue shutters. Pure data and functions: the baker, the renderer
// (world-surf-bake.js) and the tests all read it. Geometry and level art never change: they keep
// writing DET ids; only the set behind an id changes.

import { DET, DET_COUNT, DET_NAMES } from './world-surf-gen.js';

/** Surface name → its baked set (every DET name but 'none' and 'macro', the weathering noise). */
export const SET_OF = Object.freeze({
  brick: 'brick_red', concrete: 'concrete', siding: 'siding', corrugated: 'corrugated', panel: 'metal_painted',
  char: 'char', wood: 'planks', fabric: 'canvas', bark: 'bark', rubber: 'rubber', shingle: 'shingles', hesco: 'hesco',
  stucco: 'stucco', rock: 'rock', glass: 'glass_cracked', asphalt: 'asphalt', slab: 'concrete_slab', grass: 'grass',
  gravel: 'gravel', rust: 'steel_rusted', plastic: 'tarp', dirt: 'dirt', plaster: 'plaster', tile: 'terracotta',
  metalroof: 'metal_roof', paver: 'sidewalk', cracked: 'cracked_earth', strata: 'sandstone', crackmacro: 'road_wear',
  sand: 'sand', linoleum: 'linoleum', carpet: 'carpet', drywall: 'drywall', ceiltile: 'ceiling_tile',
  wallpaper: 'wallpaper', terrazzo: 'terrazzo',
  brickyellow: 'brick_yellow', cinder: 'cinder_block', adobe: 'adobe', diamond: 'diamond_plate',
  tilehosp: 'tile_hospital', tilemetro: 'tile_metro', marble: 'marble', mud: 'mud', runway: 'runway',
  ballast: 'ballast', railrust: 'rail_rust', camo: 'metal_camo', shutter: 'shutter_blue',
  plasterbleach: 'plaster_bleached', concretedam: 'concrete_dam', linohosp: 'linoleum_hospital',
  roadpaint: 'road_paint', tileceramic: 'tile_ceramic', corrugatedrust: 'corrugated_rust',
});

/** Surface names that are not drawn by a set (no detail; the weathering's raw noise fields). */
export const NO_SET = Object.freeze(['none', 'macro']);

/**
 * Per-map themes: surface name → the surface whose set draws it there. Keyed by map id (the match
 * maps, the story levels and hideouts).
 */
export const THEMES = Object.freeze({
  hospital: { tile: 'tilehosp', linoleum: 'linohosp' },
  metro: { tile: 'tilemetro', gravel: 'ballast' },
  mall: { tile: 'tileceramic' },
  dam: { concrete: 'concretedam', slab: 'concretedam' },
  railyard: { gravel: 'ballast', rust: 'railrust' },
  airbase: { panel: 'camo', slab: 'runway', brick: 'cinder' },
  sandstone: { plaster: 'plasterbleach', stucco: 'adobe', wood: 'shutter' },
  hollowcreek: { brick: 'brickyellow' },
  forest: { dirt: 'mud' },
});

/** The surfaces the ground shader (ground.js) samples, besides what the world's geometry uses. */
export const GROUND_DETS = Object.freeze(['asphalt', 'slab', 'grass', 'gravel', 'dirt', 'sand', 'cracked', 'crackmacro', 'concrete', 'roadpaint']);

/**
 * The set that draws each surface id on a map: an array of DET_COUNT set names (null for none /
 * macro).
 * @param {string} [mapId]
 * @returns {(string|null)[]}
 */
export function setsForMap(mapId) {
  const theme = (mapId && THEMES[mapId]) || {};
  const out = new Array(DET_COUNT).fill(null);
  for (let id = 0; id < DET_COUNT; id++) {
    const name = DET_NAMES[id];
    if (NO_SET.includes(name)) continue;
    const via = theme[name] || name;
    out[id] = SET_OF[via] || SET_OF[name] || null;
  }
  return out;
}

/**
 * Plan the slots of a map's baked arrays: the distinct sets its used surface ids need, in a stable
 * order, and the slot of each id (-1 = none: drawn without detail).
 * @param {string} mapId
 * @param {Iterable<number>} usedIds surface ids the world's geometry uses (plus the ground's)
 * @returns {{ sets: string[], slotOf: Int16Array, setOf: (string|null)[] }}
 */
export function planSlots(mapId, usedIds) {
  const setOf = setsForMap(mapId);
  const want = new Set();
  for (const id of usedIds) if (id > 0 && id < DET_COUNT && setOf[id]) want.add(setOf[id]);
  for (const n of GROUND_DETS) { const s = setOf[DET[n]]; if (s) want.add(s); }
  // (stable: in the order of the surface ids)
  const sets = [];
  for (let id = 0; id < DET_COUNT; id++) { const s = setOf[id]; if (s && want.has(s) && !sets.includes(s)) sets.push(s); }
  const slotOf = new Int16Array(DET_COUNT).fill(-1);
  for (let id = 0; id < DET_COUNT; id++) { const s = setOf[id]; if (s && want.has(s)) slotOf[id] = sets.indexOf(s); }
  return { sets, slotOf, setOf };
}

/** Every set name the library must have. */
export function allSets() {
  return [...new Set(Object.values(SET_OF))];
}
