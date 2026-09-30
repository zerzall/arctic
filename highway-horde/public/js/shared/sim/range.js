// The shooting range of a story hideout (SPEC §3.10). In `mode: 'hideout'` a map with
// `hub.range.targets` gets one immobile DUMMY per target: an ordinary walker entity (so every
// weapon, blast and flame already knows how to hit it, and the existing zombie snapshot carries
// it) flagged `dummy`. It never walks, attacks, burns, freezes, is shoved or dies: damage
// dealt to it is reset at once and reported as a `rangehit` event instead, one per dummy per
// tick with the tick's total (a shotgun blast is one number):
//
//   { type: 'rangehit', id (zombie id), tid (target id), x, y, dmg, dist, by, big }
//
// The renderers recognise a dummy by its position (it stands exactly on a `hub.range.targets`
// spot; `isRangeTarget`) and draw a target stand instead of a zombie, with the damage number
// floating up from the hit. Nothing here is created in any other mode.

import { spawnZombie } from './zombies.js';

/** The hp a dummy shows (it is topped up after every hit, so this is display only). */
export const DUMMY_HP = 1e9;

/**
 * Is (x, y) one of the map's range target spots (within 1.5 units)?
 * @param {object} map
 */
export function isRangeTarget(map, x, y) {
  const rt = map && map.hub && map.hub.range && map.hub.range.targets;
  if (!rt) return false;
  for (const t of rt) if (Math.abs(t.x - x) < 1.5 && Math.abs(t.y - y) < 1.5) return true;
  return false;
}

/** Turn a freshly spawned zombie into the dummy standing at target `t`. */
function makeDummy(z, t) {
  z.dummy = true;
  z.tid = t.id;
  z.x = t.x;
  z.y = t.y;
  z.angle = t.a;
  z.hp = z.maxHp = DUMMY_HP;
  z.mass = 1;
  z.speed = 0;
  z.pend = 0;
  z.pendBy = 0;
  z.pendBig = false;
  return z;
}

/**
 * The range of a game: its dummies and the per-tick report.
 * @param {object} game GameCore (needs .map.hub.range, ids, zombies)
 */
export function createRange(game) {
  const dummies = [];
  for (const t of game.map.hub.range.targets) dummies.push(makeDummy(spawnZombie(game, 'walker', t.x, t.y), t));
  return {
    dummies,
    /** A dummy took `amount` damage from player `by` (combat.js damageZombie calls this instead of hurting it). */
    hit(z, amount, by) {
      z.pend += amount;
      if (by) z.pendBy = by;
      if (amount >= 60) z.pendBig = true;
      z.hurtT = 0.12;
    },
    /** End of a tick: report what each dummy took as one `rangehit` event and top it up. */
    update() {
      for (const z of dummies) {
        z.hp = DUMMY_HP;
        z.kvx = z.kvy = 0;
        if (z.hurtT > 0) z.hurtT -= 1 / 60;
        if (z.pend <= 0) continue;
        const p = z.pendBy ? game.getPlayer(z.pendBy) : null;
        const dist = p ? Math.hypot(p.x - z.x, p.y - z.y) : 0;
        game.emit({
          type: 'rangehit', id: z.id, tid: z.tid, x: Math.round(z.x), y: Math.round(z.y), dmg: Math.round(z.pend * 10) / 10,
          dist: Math.round(dist), by: z.pendBy, big: z.pendBig,
        });
        z.pend = 0;
        z.pendBy = 0;
        z.pendBig = false;
      }
    },
  };
}
