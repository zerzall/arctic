// The scripted actions a mission step's `onStart` / `onDone` may list beside its radio and say
// lines (JOURNEY.md §4.3, `LEVEL_ACTIONS` in story-defs.js): gate, horde, explode, lights, title,
// music, shake, checkpoint. The mission director (sim/story.js) queues every action of a list
// when the list runs and fires each `delay` seconds later, in list order; this file does what
// each one means. `gate`, `lights` and `checkpoint` act on a story level (sim/level.js) and do
// nothing elsewhere; the others work on any map.
//
// Clients see the results only: events (`gate`, `lights`, `checkpoint` from the level director,
// `title`, `music`, `shake`, `horde` here, the `explosion`s of a blast) and the lasting state in
// the snapshot's `level` block (gates, lights, checkpoint), so a late joiner never replays them.

import { ZOMBIES } from '../zombies.js';
import { TAU } from '../math.js';
import { explode } from './combat.js';
import { sectionIndex } from '../level.js';

/** Default radius and zombie damage of an `explode` action (the validator allows r 30..600). */
export const BLAST_R = 260;
export const BLAST_DAMAGE = 400;
/** Push (px/s) a blast gives a survivor at its centre (no damage), falling off to its edge. */
const BLAST_SHOVE = 520;
/** Survivors this far from the crew's centre feel a `shake`. */
export const SHAKE_RANGE = 1800;
/** Hardest a `horde` may push the number of zombies alive past the difficulty's cap. */
const HORDE_OVER_CAP = 12;

const str = (v, n) => String(v === undefined || v === null ? '' : v).slice(0, n);

/**
 * Do action `a` now.
 * @param {import('./story.js').StoryDirector} dir
 * @param {object} a `{ type, ...fields }` (story-defs.js LEVEL_ACTIONS)
 * @returns {boolean} true when it did something
 */
export function runAction(dir, a) {
  const g = dir.game, level = g.level;
  switch (a.type) {
    case 'gate':
      return !!level && level.setGate(String(a.id), a.open !== false);
    case 'lights':
      return !!level && level.setLights(String(a.section), a.on !== false);
    case 'checkpoint':
      return !!level && level.setCheckpoint(String(a.section));
    case 'title':
      g.emit({ type: 'title', text: str(a.text, 60), sub: str(a.sub, 90) });
      return true;
    case 'music':
      g.emit({ type: 'music', state: str(a.state, 20) });
      return true;
    case 'shake': {
      const c = dir.centre();
      const k = Number.isFinite(a.k) ? Math.max(0, Math.min(1, a.k)) : 0.5;
      g.emit({ type: 'shake', k: Math.round(k * 10) / 10, x: Math.round(c.x), y: Math.round(c.y), r: SHAKE_RANGE });
      return true;
    }
    case 'explode':
      return blast(dir, a);
    case 'horde':
      return horde(dir, a) > 0;
    default:
      return false;
  }
}

/** `explode { at, r, damage }`: the grenade / barrel blast scaled up; zombies take damage, survivors are only shoved. */
function blast(dir, a) {
  const g = dir.game;
  const at = dir.anchor(a.at);
  if (!at) return false;
  const r = Math.max(30, Math.min(600, Number(a.r) || BLAST_R));
  const dmg = Math.max(0, Number.isFinite(a.damage) ? a.damage : BLAST_DAMAGE);
  explode(g, at.x, at.y, r, 0, null, 'rocket', { zombieDmg: dmg, playerDmg: 0, structDmg: 0, credit: 0 });
  const reach = r * 1.3;
  for (const p of g.players) {
    if (p.state === 'dead' || p.escaped) continue;
    const dx = p.x - at.x, dy = p.y - at.y;
    const d = Math.hypot(dx, dy);
    if (d >= reach || (d > 1 && !g.world.lineOfSight(at.x, at.y, p.x, p.y))) continue;
    const f = 1 - d / reach;
    const nx = d > 1e-3 ? dx / d : 1, ny = d > 1e-3 ? dy / d : 0;
    p.kbx += nx * BLAST_SHOVE * f;
    p.kby += ny * BLAST_SHOVE * f;
  }
  return true;
}

/**
 * `horde { at | section, count, zombie }`: a burst of zombies out of an anchor (a doorway, the
 * back of a truck) or out of a section's spawn rects (shut gates or not). `count` is written for
 * a party of four (×0.5 alone .. ×1.5 for six, as `kill` counts); `zombie` a type or 'any' (the
 * mission's mix). Returns how many came.
 */
export function horde(dir, a) {
  const g = dir.game, rng = dir.rng;
  const scale = Math.max(0.5, Math.min(1.5, Math.max(1, g.players.length) / 4));
  let n = Math.max(1, Math.round((Math.floor(a.count) || 8) * scale));
  let alive = 0;
  for (const z of g.zombies) if (!z.dead) alive++;
  n = Math.min(n, Math.max(1, g.diff.maxAlive + HORDE_OVER_CAP - alive));
  const fixed = typeof a.zombie === 'string' && a.zombie !== 'any' && ZOMBIES[a.zombie] ? a.zombie : null;
  const tier = Math.max(1, Math.round(dir.tier));
  const anchor = a.at !== undefined ? dir.anchor(a.at) : null;
  const si = a.section !== undefined && g.level ? sectionIndex(g.map, String(a.section)) : -1;
  const saved = g.wave;
  g.wave = tier - g.tierBonus;
  let made = 0, sx = 0, sy = 0;
  let spot = null, inSpot = 0;
  for (let k = 0; k < n; k++) {
    const type = fixed || g.pickZombieType(tier);
    const heavy = ZOMBIES[type].radius >= 20;
    let x, y;
    if (anchor) {
      // out of the spot: a tight knot growing outward
      const ang = rng.range(0, TAU), rr = 18 + Math.sqrt(k + 1) * 22;
      x = anchor.x + Math.cos(ang) * rr;
      y = anchor.y + Math.sin(ang) * rr;
      if (!g.world.isCircleFree(x, y, heavy ? 28 : 16, true)) {
        const f = dir.freeNear(x, y, 90, heavy ? 30 : 18);
        x = f.x;
        y = f.y;
      }
    } else {
      // groups of six from the section's spawn rects (or the level's current ones)
      if (!spot || inSpot >= 6) {
        spot = g.level ? g.level.spawnSpot(rng, si, si >= 0, 40) : null;
        if (!spot) {
          const c = dir.centre();
          spot = dir.ringSpot(c.x, c.y, 650, 1000, 560) || dir.freeNear(c.x + 600, c.y, 200, 40);
        }
        inSpot = 0;
      }
      inSpot++;
      x = spot.x + rng.range(-60, 60);
      y = spot.y + rng.range(-60, 60);
      if (!g.world.isCircleFree(x, y, heavy ? 28 : 16, true)) {
        x = spot.x;
        y = spot.y;
      }
    }
    g.spawnZombieAt(type, x, y);
    sx += x;
    sy += y;
    made++;
  }
  g.wave = saved;
  dir.stats.spawned += made;
  if (made) g.emit({ type: 'horde', x: Math.round(sx / made), y: Math.round(sy / made), n: made });
  return made;
}
