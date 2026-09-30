// The Game of a story stage (STORY.md, SPEC §3.9 and §10): a hideout visit or a mission is an
// ordinary `Game` with `settings.mode` 'hideout' | 'mission' and `settings.story` (the mission
// director of shared/sim/story.js does the rest). The only thing the session adds is the map:
//
//   buildStoryMap(mapId, seed, opts)   like buildMap(), except that a hideout id the map list does
//                                      not know (roadhouse, depot, farmstead) becomes a stub hub on
//                                      the Last Chance truck stop (five stations as `interactables`,
//                                      a light on each). The real hub maps of shared/maps-hideouts.js,
//                                      once they exist, are found first and win by themselves.
//   createStoryGame(opts)              `new Game({ ...opts, map })` with that map.
//
// Host and clients both build the map through `mapBuildOptions(settings)` (shared/story/
// registry.js), so a campaign mission gets the campaign variant of its map everywhere.

import { Game } from '../sim.js';
import { buildStoryMap } from '../story/stub-hub.js';
import { mapBuildOptions } from '../story/registry.js';

export { buildStoryMap, STUB_HUB_IDS } from '../story/stub-hub.js';

/**
 * Build the Game of a story stage.
 * @param {object} opts the usual Game options: { mapId, seed, settings, players } with
 *   `settings.mode` 'hideout' | 'mission' and `settings.story`
 * @returns {Game}
 */
export function createStoryGame(opts) {
  const map = opts.map || buildStoryMap(opts.mapId, opts.seed, mapBuildOptions(opts.settings));
  return new Game({ ...opts, map });
}
