// The story levels' 3D art (JOURNEY.md §5): one module per level (shared/levels/<id>.js lays the level
// out, render3d/levels/<id>.js draws it). world.js asks this registry for the level's art the way it asks
// world-hideout.js for a hideout's, through the same seams; every seam is a no-op on the other maps.
//
// A match map may have an art module too (SPEC §7.5.4): its MapDef names it with a string `art`
// (Sandstone: `map.art = 'sandstone'`, render3d/maps/sandstone.js), and the same seams draw it. (A
// level's own `map.art` is its layout's data for its module, which is found by the level's id.)

import * as millroad from './millroad.js';
import * as hollowcreek from './hollowcreek.js';
import * as forest from './forest.js';
import * as hospital from './hospital.js';
import * as mall from './mall.js';
import * as metro from './metro.js';
import * as dam from './dam.js';
import * as railyard from './railyard.js';
import * as airbase from './airbase.js';
import * as sandstone from '../maps/sandstone.js';

const MODULES = { millroad, hollowcreek, forest, hospital, mall, metro, dam, railyard, airbase };
/** The art modules of match maps, by the MapDef's `art` name. */
const MAP_ART = { sandstone };

/** The art module of a map: a level's by its id, a match map's by its `art` name; else null. */
export function artModuleOf(map) {
  if (!map) return null;
  if (map.kind === 'level') return MODULES[map.id] || null;
  return typeof map.art === 'string' && Object.prototype.hasOwnProperty.call(MAP_ART, map.art) ? MAP_ART[map.art] : null;
}

const NOOP = {
  obstacle: () => false,
  objective: () => false,
  roof: () => false,        // true = the art drew this roof's ceiling itself (the generic one is skipped)
  props() {},
  finish() {},
  update() {},
  setQuality() {},
  dispose() {},
};

/** The extra geo-builder buckets of the map's level art ({} on any other map). */
export function levelBuckets(map) {
  const m = artModuleOf(map);
  return (m && m.BUCKETS) || {};
}

/**
 * The level art of ctx.map, or null (not a level, or the level has no art of its own yet).
 * The object returned always has every seam (missing ones are no-ops) plus `buckets`.
 * @param {object} ctx renderer ctx
 * @param {object} deps see render3d/levels/<id>.js
 */
export function createLevelArt(ctx, deps) {
  const m = artModuleOf(ctx.map);
  if (!m || !m.createLevelArt) return null;
  const art = m.createLevelArt(ctx, deps);
  if (!art) return null;
  for (const [k, fn] of Object.entries(NOOP)) if (typeof art[k] !== 'function') art[k] = fn;
  if (!art.buckets) art.buckets = m.BUCKETS || {};
  if (typeof art.material !== 'function') art.material = (bucket, t) => deps.mats.get('std', t);
  return art;
}
