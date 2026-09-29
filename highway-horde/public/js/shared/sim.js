// The authoritative game simulation (SPEC §3). The host builds one Game per match:
//
//   const game = new Game({ mapId, seed, settings, players });
//   game.setInput(id, cmd); game.command(id, { type: 'buy', item });
//   game.step();            // one 60 Hz tick
//   game.snapshot();        // render state + events since the last snapshot
//
// The rules live in shared/sim/*.js; this file only resolves the map.

import { buildMap } from './maps.js';
import { GameCore } from './sim/core.js';

/** The match simulation of SPEC §3.1 (GameCore with the map built from mapId/seed). */
export class Game extends GameCore {
  /**
   * @param {object} opts
   *   mapId, seed      the map is built with buildMap(mapId, seed, { mode })
   *   map              optional ready MapDef (tests/tools); takes precedence over mapId
   *   settings         { difficulty, waves, objective, friendlyFire }
   *   players          [{ id, name, color, cls, bot? }] — bot: true makes an AI survivor
   */
  constructor(opts = {}) {
    const map = opts.map || buildMap(opts.mapId, opts.seed, { mode: opts.settings && opts.settings.mode });
    super({ ...opts, map, mapId: opts.mapId || map.id });
  }
}

export { GameCore };
