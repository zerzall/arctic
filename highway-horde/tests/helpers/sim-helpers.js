// Helpers for simulation tests: build games on fixture maps, place zombies, script
// inputs. Tests may poke at GameCore internals; the game itself never relies on this.

import { GameCore } from '../../public/js/shared/sim/core.js';
import { spawnZombie } from '../../public/js/shared/sim/zombies.js';
import { buildArenaMap, buildFixtureMap } from '../fixtures/sim-map.js';

/** A neutral InputCmd with overrides. */
export function cmd(over = {}) {
  return {
    seq: 0, moveX: 0, moveY: 0, angle: 0, fire: false, melee: false, sprint: false, interact: false,
    reload: false, frag: false, molotov: false, turret: false, barricade: false, lastWeapon: false,
    slot: -1, cycle: 0, ...over,
  };
}

/**
 * GameCore on the empty arena (or `map`) with `n` players (or explicit `players`).
 * `sandbox: true` freezes the phase in a long intermission so no waves spawn and
 * scripted zombies are the only ones around.
 */
export function makeGame({
  n = 1, players = null, map = null, seed = 1, settings = {}, sandbox = true, cls = 'soldier', objective = false,
} = {}) {
  const list = players || Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `P${i + 1}`, color: i, cls }));
  const g = new GameCore({
    map: map || buildArenaMap(),
    seed,
    settings: { difficulty: 'normal', waves: 15, objective, friendlyFire: false, ...settings },
    players: list,
  });
  if (sandbox) {
    g.phase = 'intermission';
    g.timer = 1e9;
    g.wave = 1;
  }
  return g;
}

export { buildArenaMap, buildFixtureMap };

/** Spawn a zombie of `type` at (x, y). */
export function addZombie(g, type, x, y, elite = false) {
  return spawnZombie(g, type, x, y, elite);
}

/** Put player `id` at (x, y), facing `angle`. */
export function place(g, id, x, y, angle = 0) {
  const p = g.getPlayer(id);
  p.x = x;
  p.y = y;
  p.angle = angle;
  p.cmd.angle = angle;
  return p;
}

/**
 * Step `ticks` times; `inputs(g, t)` may return { [id]: cmdOverrides } for that tick.
 * Stops early once `until(g)` is true. Collects every event emitted (via snapshot).
 */
export function run(g, ticks, inputs = null, until = null) {
  const events = [];
  const seqs = new Map();
  for (let t = 0; t < ticks; t++) {
    if (inputs) {
      const m = inputs(g, t) || {};
      for (const [id, c] of Object.entries(m)) {
        const s = (seqs.get(id) || 0) + 1;
        seqs.set(id, s);
        g.setInput(Number(id), cmd({ seq: s, ...c }));
      }
    }
    g.step();
    for (const e of g.snapshot().events) events.push(e);
    if (until && until(g)) break;
  }
  return events;
}

/** Keep every player topped up so tests about other things can't be lost to damage. */
export function godMode(g) {
  for (const p of g.players) {
    if (p.state === 'alive') p.hp = p.maxHp;
  }
}

export function eventsOf(events, type) {
  return events.filter((e) => e.type === type);
}
