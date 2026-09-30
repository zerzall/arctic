// The story levels' 3D art (JOURNEY.md §5): one module per level (shared/levels/<id>.js lays the level
// out, render3d/levels/<id>.js draws it). world.js asks this registry for the level's art the way it asks
// world-hideout.js for a hideout's, through the same seams; every seam is a no-op on the other maps.

import * as millroad from './millroad.js';
import * as hollowcreek from './hollowcreek.js';
import * as forest from './forest.js';
import * as hospital from './hospital.js';
import * as mall from './mall.js';
import * as metro from './metro.js';
import * as dam from './dam.js';
import * as railyard from './railyard.js';
import * as airbase from './airbase.js';

const MODULES = { millroad, hollowcreek, forest, hospital, mall, metro, dam, railyard, airbase };

const NOOP = {
  obstacle: () => false,
  objective: () => false,
  props() {},
  finish() {},
  update() {},
  setQuality() {},
  dispose() {},
};

/** The extra geo-builder buckets of the map's level art ({} on any other map). */
export function levelBuckets(map) {
  const m = map && map.kind === 'level' ? MODULES[map.id] : null;
  return (m && m.BUCKETS) || {};
}

/**
 * The level art of ctx.map, or null (not a level, or the level has no art of its own yet).
 * The object returned always has every seam (missing ones are no-ops) plus `buckets`.
 * @param {object} ctx renderer ctx
 * @param {object} deps see render3d/levels/<id>.js
 */
export function createLevelArt(ctx, deps) {
  const map = ctx.map;
  const m = map && map.kind === 'level' ? MODULES[map.id] : null;
  if (!m || !m.createLevelArt) return null;
  const art = m.createLevelArt(ctx, deps);
  if (!art) return null;
  for (const [k, fn] of Object.entries(NOOP)) if (typeof art[k] !== 'function') art[k] = fn;
  if (!art.buckets) art.buckets = m.BUCKETS || {};
  if (typeof art.material !== 'function') art.material = (bucket, t) => deps.mats.get('std', t);
  return art;
}
