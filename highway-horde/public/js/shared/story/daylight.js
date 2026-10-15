// The time of day a story mission plays (JOURNEY.md §2.1). A mission script says `time: 'day'`
// or `'night'`; campaign missions (the Harlan finale) always play by day; and a crew that chose
// "Daylight only" (`world.settings.daylight`, shared/story/world.js) plays every mission and side
// job by day. A map that does not play the wanted time falls back to one it does. Pure.
//
//   missionTime(mission, world)  -> 'day' | 'night'     (net/story-host.js launches with it)

import { resolveTime } from '../timeofday.js';
import { LEVEL_LIST } from '../levels/index.js';
import { isDaylightOnly } from './world.js';

/** The MAP_LIST / LEVEL_LIST entry (or the id) resolveTime understands for a map id. */
function mapEntry(mapId) {
  return LEVEL_LIST.find((l) => l.id === mapId) || mapId;
}

/**
 * The time a mission plays in this world.
 * @param {object} mission the mission script ({ map, time, mode })
 * @param {object|null} world the crew's world (its `settings.daylight`)
 * @param {string} [simMode] the sim mode the session runs it on (defaults to the script's `mode`)
 * @returns {'day'|'night'}
 */
export function missionTime(mission, world, simMode) {
  const m = mission || {};
  const mode = simMode || m.mode;
  const want = isDaylightOnly(world) || mode === 'campaign' || m.time === 'day' ? 'day' : 'night';
  return typeof m.map === 'string' ? resolveTime(mapEntry(m.map), want) : want;
}

export { isDaylightOnly };
