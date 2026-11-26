// The 3D art of the story level "millroad" (JOURNEY.md §5). Owner: agent C1.
//
// The layout (shared/levels/millroad.js) tags its obstacles with a style and records floors, door frames,
// free props and the corn in map.art; the kit (millroad-kit.js) draws the walls, doors and floors and runs
// the model tables of the five sections:
//   millroad-jam.js   the Jam: the semi on the bridge, the logging truck, the ambulance, the crop-duster, Deke's shutter
//   millroad-gas.js   Mill Road Gas: the store, the garage, the canopy and pumps, the tow truck, the tanks, the car wash
//   millroad-park.js  Shady Acres: the trailers, the office, the pool, Ozzy's radio shack and mast, the park's gates
//   millroad-farm.js  the Haskell corn, the scarecrow, the tractor, the pivot, the farmyard, and the Roadhouse
//
// The interface is the one of render3d/levels/index.js (obstacle, gateModel, roof, props, finish, update,
// setQuality, dispose, material, buckets).

import { createKitArt, KIT_BUCKETS } from './millroad-kit.js';
import { JAM_MODELS, JAM_GATES } from './millroad-jam.js';
import { GAS_MODELS, GAS_ROOFS } from './millroad-gas.js';
import { PARK_MODELS, PARK_GATES, PARK_ROOFS } from './millroad-park.js';
import { FARM_MODELS_LV, FARM_GATES, FARM_ROOFS, plantCorn } from './millroad-farm.js';
import { COMMON_MODELS } from '../world-hideout-props.js';

/** Extra geo-builder buckets of this level (the kit's: level atlas signs, glow, decals, corn; the hub atlas). */
export const BUCKETS = KIT_BUCKETS;

const MODELS = { ...JAM_MODELS, ...GAS_MODELS, ...PARK_MODELS, ...FARM_MODELS_LV };
const GATES = { ...JAM_GATES, ...PARK_GATES, ...FARM_GATES };
const ROOFS = { ...GAS_ROOFS, ...PARK_ROOFS, ...FARM_ROOFS };

/** Dress items that would land in the corn's rows (the corn hides them) or across its lanes are dropped. */
function cornSkip(map) {
  const corn = map.art && map.art.corn;
  if (!corn) return null;
  return (it) => it.k !== 'perch' && it.k !== 'watertower' && corn.rects.some(([x0, y0, x1, y1]) => it.x > x0 && it.x < x1 && it.y > y0 && it.y < y1)
    && !['leaves', 'mud', 'puddle', 'pebbles', 'tallgrass', 'stain', 'blood', 'shoe', 'bag', 'litter', 'paperf'].includes(it.k);
}

/**
 * @param {object} ctx renderer ctx (ctx.map is the built level)
 * @param {object} deps { root, mats, fx, halos, shafts, day, aniso, gy, tier, full, newBuilder(), matOf(bucket, tier) }
 * @returns {object}
 */
export function createLevelArt(ctx, deps) {
  return createKitArt(ctx, deps, {
    models: MODELS,
    gates: GATES,
    roofs: ROOFS,
    hubModels: COMMON_MODELS,
    extraSkip: cornSkip(ctx.map),
    props(P) { plantCorn(P); },
  });
}
