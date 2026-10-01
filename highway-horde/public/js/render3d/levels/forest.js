// The 3D art of the story level "forest", Blackpine (JOURNEY.md §5). Owner: agent C1.
//
// The layout (shared/levels/forest.js) tags its obstacles with a style and records floors, door frames, free
// props and the trails kept clear in map.art; the kit (millroad-kit.js, shared with Mill Road and Hollow Creek)
// draws the walls, doors and floors and runs the model tables of the six sections:
//   forest-atlas.js   the forest's pictures (routed signs, the trail map, boards, notices, ferns, needles)
//   forest-looks.js   its rock ridges and canyon walls, the stockade, the farm fence, the station's and mill's walls
//   forest-camp.js    the trailhead and Blackpine Campground
//   forest-ranger.js  the ranger station and its lookout, Cutter's Gorge and its footbridge
//   forest-mill.js    Harlan Lumber, the farm fence and its signal, and the forest floor
//
// The interface is the one of render3d/levels/index.js (obstacle, gateModel, roof, props, finish, update,
// setQuality, dispose, material, buckets).

import './forest-atlas.js';
import './forest-looks.js';
import { createKitArt, KIT_BUCKETS } from './millroad-kit.js';
import { CAMP_MODELS, CAMP_GATES } from './forest-camp.js';
import { RANGER_MODELS, RANGER_GATES } from './forest-ranger.js';
import { MILL_MODELS, MILL_GATES, MILL_ROOFS, forestFloor } from './forest-mill.js';
import { PARK_MODELS } from './millroad-park.js';
import { JAM_MODELS } from './millroad-jam.js';
import { SCHOOL_MODELS, SCHOOL_GATES } from './hollowcreek-school.js';

/** Extra geo-builder buckets of this level (the kit's). */
export const BUCKETS = KIT_BUCKETS;

const MODELS = {
  'mr-trailer': PARK_MODELS['mr-trailer'], 'mr-logtrailer': JAM_MODELS['mr-logtrailer'], 'bp-flag': SCHOOL_MODELS['hc-flag'],
  ...CAMP_MODELS, ...RANGER_MODELS, ...MILL_MODELS,
};
const GATES = { 'hc-schoolpanel': SCHOOL_GATES['hc-schoolpanel'], ...CAMP_GATES, ...RANGER_GATES, ...MILL_GATES };
const ROOFS = { ...MILL_ROOFS };

/**
 * @param {object} ctx renderer ctx (ctx.map is the built level)
 * @param {object} deps { root, mats, fx, halos, shafts, day, aniso, gy, tier, full, newBuilder(), matOf(bucket, tier) }
 * @returns {object}
 */
export function createLevelArt(ctx, deps) {
  return createKitArt(ctx, deps, { models: MODELS, gates: GATES, roofs: ROOFS, props(P) { forestFloor(P); } });
}
