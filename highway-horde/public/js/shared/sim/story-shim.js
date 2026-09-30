// Story-mode games while the real mission director and hideout maps (S2/S3) are not in the
// tree: everything the session and the UI need from a hideout `Game` and from a mission
// `Game`, built from what exists today. It is a shim behind two narrow functions:
//
//   buildStoryMap(mapId, seed, opts)   like buildMap(); unknown hideout ids (roadhouse, depot,
//                                      farmstead) become a stub hub on the Last Chance truck stop
//                                      (stations as `interactables`, lights to find them)
//   createStoryGame(opts)              a Game for a story stage. When the simulation has the real
//                                      'hideout' / 'mission' modes (S2) it is that Game; otherwise
//                                      a hideout with no waves and press-E stations, or a plain
//                                      wave game for a mission.
//
// When S2/S3 land the real paths win by themselves: buildMap() knows the hideout ids and the
// core keeps `settings.mode` 'hideout' / 'mission'; nothing here needs to be deleted (see the
// "S1 seams" section of STORY.md).

import { Game } from '../sim.js';
import { buildStoryMap } from '../story/stub-hub.js';

export { buildStoryMap, STUB_HUB_IDS } from '../story/stub-hub.js';

/**
 * The stub hideout: a Game that never starts a wave, never ends, has no zombies, and turns
 * a press of E next to a station into an `interact` event { type, pid, id, kind }.
 */
export class StubHideoutGame extends Game {
  constructor(opts) {
    super({
      ...opts,
      map: buildStoryMap(opts.mapId, opts.seed),
      settings: { ...opts.settings, mode: 'defend', waves: 0, objective: false },
    });
    this.storyMode = 'hideout';
    this.settings.mode = 'hideout';
    this.phase = 'intermission';
    this.timer = 0;
    this.wave = 0;
    this._stationHeld = new Map();
  }

  _updatePhase() {
    this.timer = 0;
  }

  _checkEnd() {}

  /** The cash shop stays shut in a hideout (its stations trade in scrap instead). */
  command(id, cmd) {
    if (cmd && cmd.type === 'buy') return;
    super.command(id, cmd);
  }

  step() {
    super.step();
    const list = this.map.interactables;
    for (const p of this.players) {
      const down = !!p.cmd.interact && p.state === 'alive';
      const was = this._stationHeld.get(p.id) || false;
      this._stationHeld.set(p.id, down);
      if (!down || was) continue;
      let best = null, bestD = Infinity;
      for (const it of list) {
        const d = Math.hypot(it.x - p.x, it.y - p.y);
        if (d <= it.r + 16 && d < bestD) {
          bestD = d;
          best = it;
        }
      }
      if (best) this.emit({ type: 'interact', pid: p.id, id: best.id, kind: best.kind });
    }
  }
}

let storySupported = null;

/**
 * Build the Game of a story stage.
 * @param {object} opts the usual Game options: { mapId, seed, settings, players }, where
 *   `settings.mode` is 'hideout' | 'mission' (with `settings.story`), or a plain mode for the
 *   stub mission (`stage.stub` says so)
 * @param {{ stage: 'hideout'|'mission', stub?: object }} stage
 * @returns {Game}
 */
export function createStoryGame(opts, stage) {
  if (storySupported !== false) {
    try {
      const g = new Game(opts);
      if (g.settings.mode === opts.settings.mode) {
        storySupported = true;
        return g;
      }
      storySupported = false;
    } catch (err) {
      if (storySupported === true) throw err;
      storySupported = false;
    }
  }
  if (stage.stage === 'hideout') return new StubHideoutGame(opts);
  // a stub mission: the classic wave rules on the mission's map
  const stub = stage.stub || {};
  const settings = {
    ...opts.settings,
    mode: stage.mapMode || 'defend',
    waves: Math.max(1, Math.floor(stub.waves) || 3),
    objective: true,
  };
  return new Game({ ...opts, settings });
}

/** Tests: forget whether the simulation knows the story modes. */
export function resetStorySupport() {
  storySupported = null;
}
