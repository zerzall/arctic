// The 3D art of the story level "hollowcreek" (JOURNEY.md §5). Owner: agent C1.
//
// The layout (shared/levels/hollowcreek.js) tags its obstacles with a style and records floors, door
// frames and free props in map.art; the kit (millroad-kit.js, shared with Mill Road) draws the walls, doors
// and floors and runs the model tables of the six sections:
//   hollowcreek-atlas.js   the town's pictures (signs, stained glass, the school's boards, liveries, notices)
//   hollowcreek-looks.js   its wall looks, fences, door kinds and floors (added to the kit's tables)
//   hollowcreek-town.js    the town line and Main Street
//   hollowcreek-church.js  the Rexall and St. Anne's
//   hollowcreek-school.js  Hollow Creek Elementary and the police station
//
// The interface is the one of render3d/levels/index.js (obstacle, gateModel, roof, props, finish, update,
// setQuality, dispose, material, buckets).

import './hollowcreek-atlas.js';
import './hollowcreek-looks.js';
import { createKitArt, KIT_BUCKETS } from './millroad-kit.js';
import { TOWN_MODELS, TOWN_GATES } from './hollowcreek-town.js';
import { CHURCH_MODELS, CHURCH_GATES, CHURCH_ROOFS } from './hollowcreek-church.js';
import { SCHOOL_MODELS, SCHOOL_GATES } from './hollowcreek-school.js';
import { PARK_MODELS } from './millroad-park.js';
import { JAM_MODELS } from './millroad-jam.js';
import { FARM_MODELS_LV } from './millroad-farm.js';

/** Extra geo-builder buckets of this level (the kit's). */
export const BUCKETS = KIT_BUCKETS;

const MODELS = {
  'mr-playground': PARK_MODELS['mr-playground'], 'mr-bale': JAM_MODELS['mr-bale'], 'mr-farmfence': JAM_MODELS['mr-farmfence'],
  'mr-tractor': FARM_MODELS_LV['mr-tractor'], 'mr-scarecrow': FARM_MODELS_LV['mr-scarecrow'],
  ...TOWN_MODELS, ...CHURCH_MODELS, ...SCHOOL_MODELS,
};
const GATES = { ...TOWN_GATES, ...CHURCH_GATES, ...SCHOOL_GATES };
const ROOFS = { ...CHURCH_ROOFS };

/**
 * @param {object} ctx renderer ctx (ctx.map is the built level)
 * @param {object} deps { root, mats, fx, halos, shafts, day, aniso, gy, tier, full, newBuilder(), matOf(bucket, tier) }
 * @returns {object}
 */
export function createLevelArt(ctx, deps) {
  return createKitArt(ctx, deps, { models: MODELS, gates: GATES, roofs: ROOFS });
}
