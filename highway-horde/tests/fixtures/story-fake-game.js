// A FakeGame for the story session tests: hideout ids build on an existing map, the sampled
// win/loss events of FakeGame never fire (a test decides when a mission ends by pushing a
// `storyend` into `game.events`), and the story data the host passes in is kept for asserts.

import { FakeGame } from './net-fake-game.js';
import { STUB_HUB_IDS } from '../../public/js/shared/story/stub-hub.js';

export class StoryFakeGame extends FakeGame {
  static real = false;

  constructor(opts) {
    super({ ...opts, mapId: STUB_HUB_IDS.includes(opts.mapId) ? 'truckstop' : opts.mapId, zombies: 0 });
    /** What the host asked for: settings (with settings.story) and the players with their specs. */
    this.opts = opts;
    this.specs = new Map(opts.players.map((p) => [p.id, p.story]));
    // Without the mission director (the default here) the core coerces 'mission' to a wave
    // game; set StoryFakeGame.real = true to behave like the real director instead.
    if (!StoryFakeGame.real && this.settings.mode === 'mission') this.settings.mode = 'defend';
  }

  addPlayer(info) {
    this.specs.set(info.id, info.story);
    return super.addPlayer(info);
  }

  step() {
    super.step();
    this.events = this.events.filter((e) => e.type !== 'victory' && e.type !== 'gameover' && e.type !== 'wave');
    if (this.pending && this.pending.length) {
      this.events.push(...this.pending);
      this.pending = [];
    }
  }

  /** Emit an event on the next step (the sampled win/loss events are filtered out). */
  inject(ev) {
    (this.pending || (this.pending = [])).push(ev);
  }

  /** End the mission the way the mission director does. */
  endMission(result = 'victory', stars = 2, stats = {}) {
    this.inject({ type: 'storyend', result, stars, stats, time: Math.round(this.tick / 60) });
  }
}
