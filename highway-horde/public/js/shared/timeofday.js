// Time of day (SPEC §7.5.1): a lobby setting next to the game mode. 'night' is the original
// look of every map; 'day' is a bright sunny variant of the same layout. A map may fix the
// time it plays (map data `time: 'day'`, or `times: [...]` in its MAP_LIST entry), the same
// way Harlan County fixes the mode to Evac Run. Pure helpers shared by the lobby rules, the
// UI, the simulation's settings and both renderers; nothing here touches the DOM.

import { MAP_LIST, mapMeta } from './maps.js';

/** Times of day in lobby order. 'night' is the original look and the default. */
export const TIME_LIST = [
  { id: 'night', name: 'Night', short: 'Moonlit, flashlights on' },
  { id: 'day', name: 'Day', short: 'Bright sun, long shadows' },
  // (the day look with the sun low in the west: gold light, very long shadows, the lamps coming on)
  { id: 'dusk', name: 'Dusk', short: 'Low gold sun, lanterns coming on' },
];
export const TIME_IDS = TIME_LIST.map((t) => t.id);
/**
 * The times a map plays when it declares none. Dusk is opt-in (a map lists it in `times`): its
 * look is tuned per map (render3d/daylight-look.js DUSK_PRESETS), and only Sandstone has one so far.
 */
export const BASE_TIMES = ['night', 'day'];

/**
 * Times a map supports (MAP_LIST entry or MapDef). A map declares either a single fixed
 * `time` or a `times` list; a map with neither plays night and day (BASE_TIMES).
 * @param {object|string} map MAP_LIST entry, MapDef or map id
 * @returns {string[]}
 */
export function mapTimes(map) {
  const meta = typeof map === 'string' ? mapMeta(map) : map;
  if (meta && Array.isArray(meta.times)) {
    const l = meta.times.filter((t) => TIME_IDS.includes(t));
    if (l.length) return l;
  }
  if (meta && TIME_IDS.includes(meta.time)) return [meta.time];
  return BASE_TIMES;
}

/** True if `mapId` can be played at `time`. */
export function mapSupportsTime(mapId, time) {
  return TIME_IDS.includes(time) && mapTimes(mapId).includes(time);
}

/**
 * Keep a (mapId, time) combination valid. `changed` says which one the player just picked:
 * picking a map that doesn't play the current time switches the time to the map's first;
 * picking a time the current map doesn't play switches to the first map that plays it.
 * @returns {{ mapId: string, time: string }}
 */
export function fixTimeCombo(mapId, time, changed = 'map') {
  if (!TIME_IDS.includes(time)) time = TIME_IDS[0];
  if (!MAP_LIST.some((m) => m.id === mapId)) mapId = MAP_LIST[0].id;
  if (mapSupportsTime(mapId, time)) return { mapId, time };
  if (changed === 'time') {
    const m = MAP_LIST.find((e) => mapTimes(e).includes(time));
    if (m) return { mapId: m.id, time };
  }
  return { mapId, time: mapTimes(mapId)[0] };
}

/**
 * The time of day a game on `map` really plays: the requested one when the map plays it,
 * else the map's first. Unknown / missing requests mean the default, 'night'.
 * @param {object|string} map MapDef, MAP_LIST entry or id
 * @param {string} [requested] settings.time
 * @returns {'night'|'day'|'dusk'}
 */
export function resolveTime(map, requested) {
  const times = mapTimes(map);
  // (no request: the map's own default time when it names one — Sandstone is a day map that also plays by night)
  const want = TIME_IDS.includes(requested) ? requested : defaultTimeOf(map) || TIME_IDS[0];
  return times.includes(want) ? want : times[0];
}

/**
 * The time a map plays when nobody asked for one (its MAP_LIST `defaultTime`), or null. The lobby
 * switches to it when the map is picked (net/lobby-rules.js mergeSettings).
 * @param {object|string} map MapDef, MAP_LIST entry or id
 * @returns {string|null}
 */
export function defaultTimeOf(map) {
  const meta = typeof map === 'string' ? mapMeta(map) : map && map.id && !map.defaultTime ? mapMeta(map.id) || map : map;
  const t = meta && meta.defaultTime;
  return TIME_IDS.includes(t) && mapTimes(meta).includes(t) ? t : null;
}
