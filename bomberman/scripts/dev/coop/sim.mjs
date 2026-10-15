// Developer tooling (not a spec): a headless runner that plays the co-op modes with bots standing in for the humans, to tune the
// difficulty of docs/SPEC.md Appendix C by numbers instead of by feel.
//
//   node scripts/dev/coop/sim.mjs adventure --runs 40 --team easy --difficulty easy      # a kid on their own
//   node scripts/dev/coop/sim.mjs adventure --runs 40 --team normal,normal                 # two players
//   node scripts/dev/coop/sim.mjs coop --runs 40 --team normal --waves 5 --difficulty normal
//   node scripts/dev/coop/sim.mjs adventure --runs 20 --team normal --helpers easy        # plus a helper bot (a lobby bot)
//
// It drives World and BotBrain the way Room.step does (one cmd per alive bot per tick while PLAYING, then tick()) and carries what the
// Room carries from one level or wave to the next: lives, score and every fighter's power-ups. The "team" bots are marked as humans
// (isBot false), so they spend lives and respawn exactly like people; --helpers adds real helper bots. Every run is seeded and
// reproducible. Bot skill is not human skill: an `easy` bot stands in for a small child (it wanders, blunders into its own blasts and
// does not hunt), `normal` for a casual player.
//
// Options: --runs N  --seed S  --team a,b  --helpers a,b  --difficulty easy|normal|hard  --waves N (coop)  --levels N (adventure: stop
//          after N levels)  --items none|few|normal|many  --json FILE

import { writeFileSync } from 'node:fs';
import { World } from '../../../shared/world.js';
import { BotBrain } from '../../../shared/bots.js';
import { STATE, ADVENTURE_LEVELS, TICK_RATE } from '../../../shared/constants.js';
import { startingLives, coopWavePlan, coopWaveItems, coopTeamStart, MONSTER_KILLER } from '../../../shared/coop.js';

const roundSeedOf = (base, n) => (base + Math.imul(n, 0x9E3779B1)) >>> 0;
const botSeedOf = (rSeed, id) => (rSeed ^ Math.imul(id + 1, 0x85EBCA6B)) >>> 0;
const LIMIT = TICK_RATE * 60 * 12;            // ticks: a level still running after 12 minutes counts as stuck

/** Plays one World round with every fighter driven by a BotBrain; returns the world and what happened in it. */
function playLevel(world, levels) {
  const brains = world.players.map((p, i) => new BotBrain({ level: levels[i], seed: botSeedOf(world.seed, p.id) }));
  const seq = new Array(world.players.length).fill(0);
  const rec = { deaths: { monster: 0, self: 0, enemy: 0, other: 0 }, monsters: 0, doorAt: -1, openAt: -1, lifeLost: 0, ticks: 0, stuck: false, thinkMs: 0 };
  let cursor = 0;
  while (world.state !== STATE.OVER) {
    if (world.tickNo > LIMIT) { rec.stuck = true; break; }
    if (world.state === STATE.PLAYING) {
      world.players.forEach((p, i) => {
        if (!p.alive) return;
        const t0 = performance.now();
        const cmd = brains[i].think(world, p.id);
        rec.thinkMs += performance.now() - t0;
        world.applyCmd(p.id, { s: ++seq[i], d: cmd.d, b: cmd.b, x: cmd.x });
      });
    }
    world.tick();
    for (const ev of world.eventsSince(cursor)) {
      if (ev[0] === 'death') {
        const victim = world.player(ev[1]);
        if (victim.team !== 0) continue;
        if (ev[2] === MONSTER_KILLER) rec.deaths.monster++;
        else if (ev[2] === ev[1]) rec.deaths.self++;
        else if (ev[2] >= 0 && world.player(ev[2])?.team === 1) rec.deaths.enemy++;
        else rec.deaths.other++;
      } else if (ev[0] === 'mdeath') rec.monsters++;
      else if (ev[0] === 'door' && ev[3] === 0 && rec.doorAt < 0) rec.doorAt = world.tickNo;
      else if (ev[0] === 'door' && ev[3] === 1) rec.openAt = world.tickNo;
      else if (ev[0] === 'life') rec.lifeLost++;
    }
    cursor = world.evCount;
    world.trimEvents(cursor);
  }
  rec.ticks = world.outcome ? world.outcome.tick : world.tickNo;
  rec.reason = world.outcome ? world.outcome.reason : 'stuck';
  return rec;
}

function fightersFor(team, helpers, foes = []) {
  const out = [];
  team.forEach((level, i) => out.push({ id: i, name: `P${i + 1}`, color: i, team: 0, isBot: false, level }));
  helpers.forEach((level, i) => out.push({ id: out.length, name: `H${i + 1}`, color: out.length, team: 0, isBot: true, level }));
  foes.forEach((f) => out.push({ id: out.length, name: `E${out.length}`, color: out.length % 8, team: 1, isBot: true, level: f.level, start: f.start }));
  return out;
}

/** One adventure from level 1 until the team clears the last level or runs out of lives. */
export function runAdventure({ seed, team, helpers = [], difficulty = 'normal', items = 'normal', maxLevels = ADVENTURE_LEVELS }) {
  let lives = startingLives(difficulty, team.length);
  let score = 0;
  const carry = new Map();
  const levels = [];
  for (let level = 1; level <= maxLevels; level++) {
    const fighters = fightersFor(team, helpers).map((f) => ({ ...f, start: carry.get(f.id) }));
    const world = new World({ seed: roundSeedOf(seed, level), fighters, mode: 'adventure', items, theme: 'meadow', coop: { level, difficulty, lives, score } });
    const rec = playLevel(world, fighters.map((f) => f.level));
    rec.level = level;
    rec.livesBefore = lives;
    levels.push(rec);
    lives = world.coop.lives;
    score = world.coop.score;
    for (const p of world.players) carry.set(p.id, { bombsMax: p.bombsMax, range: p.range, speedLv: p.speedLv, kick: p.kick, glove: p.glove });
    if (rec.reason !== 'clear') break;
  }
  const cleared = levels.filter((l) => l.reason === 'clear').length;
  return { seed, cleared, score, livesLeft: lives, levels };
}

/** One coop run: waves until the team loses one or clears them all. */
export function runCoop({ seed, team, helpers = [], difficulty = 'normal', items = 'normal', waves = 3, roundTime = 120, suddenDeath = true }) {
  const carry = new Map();
  const out = [];
  let score = 0;
  for (let n = 1; n <= waves; n++) {
    const side = team.length + helpers.length;
    const foes = coopWavePlan(n, difficulty, side);
    const fighters = fightersFor(team, helpers, foes).map((f) => (f.team === 0 ? { ...f, start: coopTeamStart(difficulty, carry.get(f.id)) } : f));
    const world = new World({ seed: roundSeedOf(seed, n), fighters, mode: 'coop', items: coopWaveItems(n, items), theme: 'meadow', roundTime, suddenDeath, coop: { level: n, difficulty, score } });
    const rec = playLevel(world, fighters.map((f) => f.level));
    rec.level = n;
    rec.foes = foes.map((f) => f.level).join(',');
    out.push(rec);
    score = world.coop.score;
    carry.clear();
    for (const p of world.players) if (p.team === 0 && p.alive) carry.set(p.id, { bombsMax: p.bombsMax, range: p.range, speedLv: p.speedLv, kick: p.kick, glove: p.glove });
    if (rec.reason !== 'clear') break;
  }
  return { seed, cleared: out.filter((r) => r.reason === 'clear').length, score, levels: out };
}

// ---- CLI ---------------------------------------------------------------------------------------------

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-');
const avg = (list, f) => (list.length ? list.reduce((s, x) => s + f(x), 0) / list.length : 0);

function report(kind, runs, total) {
  const by = new Map();
  for (const r of runs) for (const l of r.levels) (by.get(l.level) ?? by.set(l.level, []).get(l.level)).push(l);
  console.log(`\n${kind}: ${runs.length} runs, cleared everything in ${pct(runs.filter((r) => r.cleared === total).length, runs.length)}, ` +
    `average reached ${avg(runs, (r) => Math.min(total, r.cleared + 1)).toFixed(2)} of ${total}, average score ${Math.round(avg(runs, (r) => r.score))}`);
  console.log('level  played  cleared  time(s)  lives lost  deaths: monster/self/enemy/other  monsters popped  think ms/tick');
  for (const [level, list] of [...by].sort((a, b) => a[0] - b[0])) {
    const won = list.filter((l) => l.reason === 'clear');
    const d = (k) => avg(list, (l) => l.deaths[k]).toFixed(2);
    console.log(`${String(level).padStart(5)}  ${String(list.length).padStart(6)}  ${pct(won.length, list.length).padStart(7)}  ${avg(won, (l) => l.ticks / 60).toFixed(0).padStart(7)}  ` +
      `${avg(list, (l) => l.lifeLost).toFixed(2).padStart(10)}  ${`${d('monster')}/${d('self')}/${d('enemy')}/${d('other')}`.padStart(33)}  ` +
      `${avg(list, (l) => l.monsters).toFixed(1).padStart(15)}  ${avg(list, (l) => l.thinkMs / Math.max(1, l.ticks)).toFixed(3).padStart(13)}` +
      `${list.some((l) => l.stuck) ? `  (${list.filter((l) => l.stuck).length} stuck)` : ''}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const kind = process.argv[2] === 'coop' ? 'coop' : 'adventure';
  const runs = Number(arg('runs', 20));
  const seed0 = Number(arg('seed', 1));
  const team = arg('team', 'normal').split(',').filter(Boolean);
  const helpers = (arg('helpers', '') || '').split(',').filter(Boolean);
  const difficulty = arg('difficulty', 'normal');
  const items = arg('items', 'normal');
  const results = [];
  const t0 = performance.now();
  for (let r = 0; r < runs; r++) {
    const seed = (seed0 + r * 7919) >>> 0;
    results.push(kind === 'coop'
      ? runCoop({ seed, team, helpers, difficulty, items, waves: Number(arg('waves', 3)) })
      : runAdventure({ seed, team, helpers, difficulty, items, maxLevels: Number(arg('levels', ADVENTURE_LEVELS)) }));
  }
  const total = kind === 'coop' ? Number(arg('waves', 3)) : Number(arg('levels', ADVENTURE_LEVELS));
  console.log(`team ${team.join(',')}${helpers.length ? ` + helpers ${helpers.join(',')}` : ''}, difficulty ${difficulty}, items ${items}  (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  report(kind, results, total);
  const json = arg('json', '');
  if (json) writeFileSync(json, JSON.stringify(results, null, 1));
}
