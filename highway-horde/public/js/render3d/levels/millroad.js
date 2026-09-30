// The 3D art of the story level "millroad" (JOURNEY.md §5). Owner: agent C1.
//
// world.js hands this module the level's obstacles, its free props and a finish/update/quality/dispose
// cycle, exactly like the hideouts (world-hideout.js). Return null (the default below) and the level is
// drawn with the generic models of world-bld.js / world-props.js from the obstacle kinds alone.
//
// The interface (every member optional; render3d/levels/index.js fills in no-ops):
//   BUCKETS                   (export) extra geo-builder buckets, merged into world.js's own
//   art.material(bucket, t)   the material of one of those buckets at tier t ('low' | 'high' | 'ultra')
//   art.obstacle(B, o)        true = this module drew obstacle o (by o.style / o.prop / o.gate), false = default model
//   art.objective(B, ob)      the same for the map's objective (a level usually has none)
//   art.props(B)              free props that are not obstacles (drawn once, in the static meshes)
//   art.finish()              after the static meshes exist: build separate meshes (signs, animated parts)
//   art.update(view, frame)   per frame
//   art.setQuality(full)      the tier changed ('low' | 'high' | 'ultra' | 'cinematic')
//   art.dispose()

/** Extra geo-builder buckets of this level (none yet). */
export const BUCKETS = {};

/**
 * @param {object} ctx renderer ctx (ctx.map is the built level)
 * @param {object} deps { root, mats, fx, halos, shafts, day, aniso, gy, tier, full, newBuilder(), matOf(bucket, tier) }
 * @returns {object|null}
 */
export function createLevelArt(ctx, deps) {
  void ctx; void deps;
  return null;
}
