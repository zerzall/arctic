// Developer tooling (not a spec): a headless bot-vs-bot arena for tuning shared/bots.js.
//
//   node scripts/dev/bots/arena.mjs --rounds 200 --levels hard,hard,hard,hard
//   node scripts/dev/bots/arena.mjs --rounds 200 --duel hard,easy --workers 4
//   node scripts/dev/bots/arena.mjs --rounds 100 --levels hard,hard,normal,normal --mode teams --layout open
//
// It uses ONLY World and BotBrain, the way Room.step does: one cmd per alive bot per tick while the world is PLAYING (seq stamped
// here), then world.tick(). Rounds are independent and seeded, so every number is reproducible and a bad round can be replayed with
// replay.mjs. The same library backs specs/unit/bots.spec.js.
//
// Options: --rounds N  --seed S (first round seed)  --levels a,b,c,d  --duel hard,easy (two fighters)  --mode ffa|teams
//          --layout classic|open  --blocks few|normal|many  --items none|few|normal|many  --roundTime SECONDS  --no-sd
//          --workers N (default: cores - 1)  --json FILE (raw round records)  --list self|enemy|sd|team [--max 30] (deaths with their seeds)

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { World } from '../../../shared/world.js';
import { BotBrain } from '../../../shared/bots.js';
import { STATE, SD_INTERVAL, SD_WARN_TICKS, TICK_RATE } from '../../../shared/constants.js';

const hrtime = () => process.hrtime.bigint();

/** The Room's derivation of a round seed and of a bot's seed (docs/SPEC.md §4.6). */
export const roundSeedOf = (base, n) => (base + Math.imul(n, 0x9E3779B1)) >>> 0;
export const botSeedOf = (rSeed, id) => (rSeed ^ Math.imul(id + 1, 0x85EBCA6B)) >>> 0;

const HARD_LIMIT = 60 * 60 * 20;         // ticks: a round that is still running after 20 minutes is a bug
const IDLE_FLAG = 600;                   // ticks (10 s) standing on the same tile outside sudden death

/**
 * Plays one round to its end.
 * @param {object} cfg
 * @param {number} cfg.seed round seed
 * @param {string[]} cfg.levels one bot level per fighter; fighter ids are 0..n-1
 * @param {number[]} [cfg.teams] team per fighter (mode 'teams'); default alternating
 * @param {(o: {level: string, seed: number}) => {think: Function}} [cfg.factory] default: new BotBrain
 * @param {(ctx: {world: World, brains: object[], cmds: object[]}) => void} [cfg.onTick] called after the bots thought, before world.tick()
 * @param {(events: any[][], ctx: {world: World, brains: object[]}) => void} [cfg.onEvents] called with the events of each tick, after world.tick()
 * @returns {object} the round record
 */
export function playRound(cfg) {
  const {
    seed, levels, mode = 'ffa', layout = 'classic', blocks = 'normal', items = 'normal', roundTime = 120, suddenDeath = true,
    factory = (o) => new BotBrain(o), onTick = null, onEvents = null,
  } = cfg;
  const n = levels.length;
  const teams = cfg.teams ?? levels.map((_, i) => i % 2);
  const fighters = levels.map((level, id) => ({ id, name: `${level}${id}`, color: id % 8, team: teams[id], isBot: true, lastSeq: 0 }));
  const world = new World({ seed, fighters, mode, layout, blocks, items, theme: 'meadow', roundTime, suddenDeath });
  const brains = levels.map((level, id) => factory({ level, seed: botSeedOf(seed, id) }));
  const seq = new Array(n).fill(0);
  const cmds = new Array(n).fill(null);

  const rec = {
    seed, levels: levels.slice(), teams: teams.slice(), mode, layout, ticks: 0, outcome: null, sdStart: -1, sdDone: -1, endedBeforeSdDone: true,
    deaths: [], thinkNs: { easy: 0, normal: 0, hard: 0 }, thinkCalls: { easy: 0, normal: 0, hard: 0 }, thinkMaxNs: 0,
    idle: new Array(n).fill(0), errors: [], stats: null, status: {},
  };
  const lastTile = new Array(n).fill(-1);
  const sameSince = new Array(n).fill(0);
  const curseOf = new Array(n).fill(null);
  let cursor = 0;

  while (world.state !== STATE.OVER && world.tickNo < HARD_LIMIT) {
    if (world.state === STATE.PLAYING) {
      for (let i = 0; i < n; i++) {
        const p = world.player(i);
        cmds[i] = null;
        if (!p.alive) continue;
        let cmd;
        const t0 = hrtime();
        try {
          cmd = brains[i].think(world, i);
        } catch (err) {
          rec.errors.push(`seed ${seed} tick ${world.tickNo} bot ${i} (${levels[i]}): ${err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : err}`);
          cmd = { d: 0, b: 0, x: 0 };
        }
        const ns = Number(hrtime() - t0);
        rec.thinkNs[levels[i]] += ns;
        rec.thinkCalls[levels[i]]++;
        if (ns > rec.thinkMaxNs) rec.thinkMaxNs = ns;
        cmds[i] = { s: ++seq[i], d: cmd?.d | 0, b: cmd?.b ? 1 : 0, x: cmd?.x ? 1 : 0 };
        world.applyCmd(i, cmds[i]);
        curseOf[i] = p.curse;
        const st = brains[i].status;
        if (st !== undefined) {
          const h = (rec.status[levels[i]] ??= {});
          h[st] = (h[st] ?? 0) + 1;
        }
        const tile = Math.floor(p.y) * 15 + Math.floor(p.x);
        if (tile !== lastTile[i]) { lastTile[i] = tile; sameSince[i] = world.tickNo; }
        else if (!world.suddenDeath && world.tickNo - sameSince[i] > rec.idle[i]) rec.idle[i] = world.tickNo - sameSince[i];
      }
      if (onTick) onTick({ world, brains, cmds });
    }
    world.tick();
    const fresh = world.eventsSince(cursor);
    if (onEvents && fresh.length) onEvents(fresh, { world, brains });
    for (const ev of fresh) {
      if (ev[0] === 'death') {
        const [, victim, killer] = ev;
        let cause = 'enemy';
        if (killer === victim) cause = 'self';
        else if (killer < 0) cause = 'sd';
        else if (mode === 'teams' && teams[killer] === teams[victim]) cause = 'team';
        rec.deaths.push({ id: victim, level: levels[victim], tick: world.tickNo, killer, cause, curse: cause === 'self' ? curseOf[victim] : null, status: brains[victim]?.status ?? '' });
      }
    }
    cursor = world.evCount;
    world.trimEvents(cursor);
  }

  rec.ticks = world.outcome ? world.outcome.tick - 180 : world.tickNo - 180;      // playing ticks until the outcome locked
  rec.outcome = world.outcome;
  rec.sdStart = world.sdStart;
  if (world.sdStart >= 0) {
    rec.sdDone = world.sdStart + (world.sdOrder.length - 1) * SD_INTERVAL + SD_WARN_TICKS;
    rec.endedBeforeSdDone = !world.outcome || world.outcome.tick < rec.sdDone;
  }
  rec.stats = world.players.map((p) => ({ id: p.id, level: levels[p.id], team: p.team, ...p.stats, alive: p.alive }));
  rec.timedOut = world.state !== STATE.OVER;
  return rec;
}

/** Winner level of a finished round ('draw' when nobody won). */
export function winnerLevel(rec) {
  const o = rec.outcome;
  if (!o || o.draw) return 'draw';
  if (o.winnerId !== null) return rec.levels[o.winnerId];
  return `team${o.winnerTeam}`;
}

const pct = (a, b) => (b > 0 ? (100 * a / b) : 0);
const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);

/** Aggregates round records into the numbers the quality gates talk about. */
export function summarize(records) {
  const rounds = records.length;
  const lens = records.map((r) => r.ticks).sort((a, b) => a - b);
  const byLevel = {};
  const lv = (l) => (byLevel[l] ??= { fighters: 0, wins: 0, deaths: 0, self: 0, enemy: 0, sd: 0, team: 0, kills: 0, blocks: 0, items: 0, thinkNs: 0, thinkCalls: 0, selfByCurse: {}, idleFlags: 0, idleMax: 0 });
  let draws = 0;
  let sdRounds = 0;
  let before = 0;
  let timeouts = 0;
  const errors = [];
  for (const r of records) {
    const w = winnerLevel(r);
    if (w === 'draw') draws++;
    if (r.sdStart >= 0) { sdRounds++; if (r.endedBeforeSdDone) before++; }
    if (r.timedOut) timeouts++;
    errors.push(...r.errors);
    r.levels.forEach((l, i) => {
      const e = lv(l);
      e.fighters++;
      if (r.outcome && !r.outcome.draw && (r.outcome.winnerId === i || (r.outcome.winnerTeam !== null && r.teams[i] === r.outcome.winnerTeam))) e.wins++;
      e.kills += r.stats[i].kills;
      e.blocks += r.stats[i].blocks;
      e.items += r.stats[i].items;
      e.idleMax = Math.max(e.idleMax, r.idle[i]);
      if (r.idle[i] >= IDLE_FLAG) e.idleFlags++;
    });
    for (const l of Object.keys(r.thinkNs)) { lv(l).thinkNs += r.thinkNs[l]; lv(l).thinkCalls += r.thinkCalls[l]; }
    for (const d of r.deaths) {
      const e = lv(d.level);
      e.deaths++;
      e[d.cause]++;
      if (d.cause === 'self') e.selfByCurse[d.curse ?? 'none'] = (e.selfByCurse[d.curse ?? 'none'] ?? 0) + 1;
    }
  }
  const total = { deaths: 0, self: 0, enemy: 0, sd: 0, team: 0 };
  const status = {};
  for (const r of records) for (const [l, h] of Object.entries(r.status)) for (const [k, v] of Object.entries(h)) ((status[l] ??= {})[k] = (status[l][k] ?? 0) + v);
  const selfStatus = {};
  for (const r of records) for (const d of r.deaths) if (d.cause === 'self') selfStatus[d.status] = (selfStatus[d.status] ?? 0) + 1;
  for (const e of Object.values(byLevel)) for (const k of Object.keys(total)) total[k] += e[k];
  return {
    rounds, draws, timeouts, errors, byLevel, total, selfStatus, status,
    length: { mean: lens.reduce((a, b) => a + b, 0) / Math.max(1, rounds), p10: quantile(lens, 0.1), median: quantile(lens, 0.5), p90: quantile(lens, 0.9), max: lens[lens.length - 1] ?? 0 },
    sdRounds, endedBeforeSdDone: sdRounds ? before : 0,
    endedBeforeSdDonePct: rounds ? pct(rounds - sdRounds + before, rounds) : 100,
    selfKillPct: pct(total.self, total.deaths),
  };
}

export function formatSummary(sum, title = '') {
  const s = (t) => (t / TICK_RATE).toFixed(1);
  const out = [];
  out.push(`${title ? `${title}: ` : ''}${sum.rounds} rounds, ${sum.draws} draws, ${sum.timeouts} timeouts, ${sum.errors.length} exceptions`);
  out.push(`  round length (s): mean ${s(sum.length.mean)}  p10 ${s(sum.length.p10)}  median ${s(sum.length.median)}  p90 ${s(sum.length.p90)}  max ${s(sum.length.max)}   sudden death reached in ${sum.sdRounds} rounds; ${sum.endedBeforeSdDonePct.toFixed(1)}% ended before it completed`);
  out.push(`  deaths ${sum.total.deaths}: self ${sum.total.self} (${sum.selfKillPct.toFixed(1)}%)  enemy ${sum.total.enemy}  sudden death ${sum.total.sd}  teammate ${sum.total.team}`);
  for (const [l, e] of Object.entries(sum.byLevel)) {
    const causes = Object.entries(e.selfByCurse).map(([k, v]) => `${k}:${v}`).join(' ');
    out.push(`  ${l.padEnd(6)} fighters ${String(e.fighters).padStart(4)}  wins ${String(e.wins).padStart(4)} (${pct(e.wins, e.fighters).toFixed(1)}%)  deaths ${String(e.deaths).padStart(4)}  self ${pct(e.self, e.deaths).toFixed(1)}%  enemy ${pct(e.enemy, e.deaths).toFixed(1)}%  sd ${pct(e.sd, e.deaths).toFixed(1)}%  kills/round ${(e.kills / Math.max(1, e.fighters)).toFixed(2)}  blocks ${(e.blocks / Math.max(1, e.fighters)).toFixed(1)}  items ${(e.items / Math.max(1, e.fighters)).toFixed(1)}`
      + `  think ${(e.thinkNs / Math.max(1, e.thinkCalls) / 1000).toFixed(1)}us  idle>=10s ${e.idleFlags} (max ${s(e.idleMax)}s)${causes ? `  selfByCurse {${causes}}` : ''}`);
  }
  for (const [l, h] of Object.entries(sum.status)) {
    const all = Object.values(h).reduce((a, b) => a + b, 0);
    out.push(`  ${l.padEnd(6)} time in: ${Object.entries(h).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(100 * v / all).toFixed(0)}%`).join('  ')}`);
  }
  if (sum.total.self) out.push(`  self-kills by the bot's status at death: ${Object.entries(sum.selfStatus).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  for (const err of sum.errors.slice(0, 5)) out.push(`  ERROR ${err}`);
  return out.join('\n');
}

/** Rounds `first .. first+count-1` of one configuration, on this thread. */
export function playSeries({ count, first = 1, baseSeed = 1, ...cfg }) {
  const records = [];
  for (let k = 0; k < count; k++) records.push(playRound({ ...cfg, seed: roundSeedOf(baseSeed, first + k) }));
  return records;
}

/** Splits a series over worker threads (each worker replays a strided share of the round numbers). */
export async function playParallel({ count, workers = Math.max(1, availableParallelism() - 1), baseSeed = 1, ...cfg }) {
  if (workers <= 1 || count < 2) return playSeries({ count, baseSeed, ...cfg });
  const jobs = [];
  for (let w = 0; w < Math.min(workers, count); w++) {
    const ids = [];
    for (let k = w; k < count; k += workers) ids.push(k + 1);
    jobs.push(new Promise((resolve, reject) => {
      const worker = new Worker(new URL(import.meta.url), { workerData: { ids, baseSeed, cfg } });
      worker.once('message', resolve);
      worker.once('error', reject);
    }));
  }
  const parts = await Promise.all(jobs);
  return parts.flat().sort((a, b) => a.seed - b.seed);
}

if (!isMainThread && workerData?.ids) {
  const { ids, baseSeed, cfg } = workerData;
  parentPort.postMessage(ids.map((n) => playRound({ ...cfg, seed: roundSeedOf(baseSeed, n) })));
}

// ---- CLI ----------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    opts[key] = val;
  }
  return opts;
}

if (isMainThread && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const o = parseArgs(process.argv.slice(2));
  const levels = (o.duel ?? o.levels ?? 'hard,hard,hard,hard').split(',');
  const cfg = {
    count: Number(o.rounds ?? 40), baseSeed: Number(o.seed ?? 1), levels, mode: o.mode ?? 'ffa', layout: o.layout ?? 'classic',
    blocks: o.blocks ?? 'normal', items: o.items ?? 'normal', roundTime: Number(o.roundTime ?? 120), suddenDeath: !o['no-sd'],
    workers: Number(o.workers ?? Math.max(1, availableParallelism() - 1)),
  };
  const t0 = Date.now();
  const records = await playParallel(cfg);
  const sum = summarize(records);
  console.log(formatSummary(sum, `${levels.join(',')} ${cfg.mode} ${cfg.layout}`));
  console.log(`  wall ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (o.list) {
    let shown = 0;
    for (const r of records) {
      for (const d of r.deaths) {
        if (d.cause !== o.list || shown >= Number(o.max ?? 30)) continue;
        shown++;
        console.log(`  ${o.list}: seed=${r.seed} bot=${d.id} (${d.level}) tick=${d.tick} killer=${d.killer} curse=${d.curse}`);
      }
    }
  }
  if (o.json) writeFileSync(o.json, JSON.stringify(records));
  if (sum.errors.length) process.exitCode = 1;
}
