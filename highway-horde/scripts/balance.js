#!/usr/bin/env node
// Headless balance harness (docs/BALANCE.md). Runs the real Game (shared/sim.js) with
// AI survivors (shared/sim/bots.js) as fast as the CPU allows, no rendering, spread over
// worker threads, and reports per wave: how many teams reach and clear it, time, damage
// taken, downs, deaths, cash earned / spent / banked, objective hp, zombies alive peak
// and boss fight length; plus guns bought, kills per weapon, class and mono-class
// results, and a static gun table (DPS / cost / range).
//
//   node scripts/balance.js --quick            ~2 min on 4 cores (normal + a few others)
//   node scripts/balance.js                    full sweep (~15-20 min on 4 cores)
//   node scripts/balance.js --diffs normal --profiles average --sizes 4 --seeds 3
//
// Options (comma lists): --maps, --diffs, --sizes, --profiles (average|skilled),
// --seeds N (seeds 1..N), --waves N (game length, default 15), --workers N,
// --mono (add the mono-class sweep: 4 average bots of one class, normal),
// --no-mono, --detail all|none (per-wave tables: default normal only),
// --out FILE (markdown report), --json FILE (raw per-run results),
// --set 'WEAPONS.shotgun.damage=22;ZOMBIES.boss.hp=6000' (try numbers held in the data
// tables' objects without editing them: WEAPONS, ZOMBIES, CLASSES, ITEMS, DIFFICULTIES,
// WAVE_ZOMBIES, SPAWN_PACING, TURRET, BARRICADE, THROWABLES).
//
// Profiles: 'skilled' = the lobby bots (botSkill 1); 'average' = BOT_SKILL.AVERAGE, a
// stand-in for an average human (slower reactions, worse aim, plain shopping).
//
// --mode defend|zone (default: defend, and 'zone' on maps that only play the Evac Run):
// zone runs add per-wave columns for the move before each wave (its length, when the
// whole team was in the circle, harasser kills and damage taken on the way) and the
// blight damage taken during the wave.
//   node scripts/balance.js --mode zone --maps harlan --diffs normal --sizes 1,4 --seeds 3

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Game } from '../public/js/shared/sim.js';
import { MAP_LIST } from '../public/js/shared/maps.js';
import { WEAPONS, WEAPON_IDS, THROWABLES, effectiveRate, fullReloadTime } from '../public/js/shared/weapons.js';
import { ZOMBIES } from '../public/js/shared/zombies.js';
import { ammoPrice, ITEMS } from '../public/js/shared/items.js';
import { CLASSES, CLASS_IDS } from '../public/js/shared/classes.js';
import {
  DIFFICULTIES, DIFFICULTY_IDS, TICK_RATE, BOSS_EVERY, WAVE_ZOMBIES, SPAWN_PACING, TURRET, BARRICADE,
} from '../public/js/shared/constants.js';
import { BOT_SKILL } from '../public/js/shared/sim/bots.js';
import { mapModes } from '../public/js/shared/zone.js';

const PROFILES = { skilled: BOT_SKILL.SKILLED, average: BOT_SKILL.AVERAGE };
/** A wave that runs longer than this (sim seconds) is a stall: the run stops there. */
const WAVE_CAP_S = 480;
const EXPLOSION_GUN = { grenade: 'grenade_launcher', rocket: 'rocket', frag: 'frag', bloater: 'bloater burst' };

// -------------------------------------------------------------------------------------
// One match

/**
 * Play one match to the end with bots only and collect the numbers.
 * @param {object} job { map, diff, size, seed, profile, waves, classes? }
 */
export function runMatch(job) {
  const t0 = Date.now();
  const skill = PROFILES[job.profile] ?? 1;
  const classes = job.classes || teamClasses(job);
  const players = classes.map((cls, i) => ({
    id: i + 1, name: `Bot${i + 1}`, color: i % 6, cls, bot: true, botSkill: skill,
  }));
  const g = new Game({
    mapId: job.map, seed: job.seed,
    settings: { difficulty: job.diff, waves: job.waves, objective: true, friendlyFire: false, mode: job.mode || 'defend' },
    players,
  });
  // Evac Run: the move before each wave (length, arrival, fights on the way) and the blight.
  const zone = g.zone;
  let breakStart = 0, arrive = -1, moveKills = 0, moveDmg = 0, fog0 = 0, harassed0 = 0;
  const n = players.length;
  const waves = [];
  const buys = {};
  const crates = {};
  const kills = {};
  const taken = new Float64Array(n + 1);
  let cur = null;
  let over = null;
  const teamMoney = () => {
    let earned = 0, cash = 0;
    for (const p of g.players) {
      earned += p.earned;
      cash += p.cash;
    }
    return { earned, cash };
  };
  let lastEarned = teamMoney().earned, lastCash = teamMoney().cash;
  // Objective damage by zombie type (split over the zombies chewing on it that tick).
  const objBy = {};
  let rays = 0, hits = 0;
  const inHand = {};
  let objHp = g.objective ? g.objective.hp : 0;
  // Per-tick scratch for kill attribution.
  const shotBy = new Map();
  const turretOwners = new Set();
  const blasts = [];
  const blastAt = [];
  const hurtBy = {};
  const meleeBy = new Set();
  const downNow = new Set();

  const closeWave = (cleared) => {
    if (!cur) return;
    const m = teamMoney();
    cur.earned = (m.earned - cur.e0) / n;
    cur.spent = (m.earned - cur.e0 - (m.cash - cur.c0)) / n;
    cur.end = g.tick;
    cur.dur = (g.tick - cur.start) / TICK_RATE;
    cur.cleared = cleared;
    cur.objEnd = g.objective ? Math.max(0, g.objective.hp) / g.objective.maxHp : 1;
    cur.dmgTaken /= n;
    waves.push(cur);
    cur = null;
  };

  while (!over) {
    g.step();
    shotBy.clear();
    turretOwners.clear();
    blasts.length = 0;
    blastAt.length = 0;
    meleeBy.clear();
    downNow.clear();
    const evs = g.events;
    for (const e of evs) {
      switch (e.type) {
        case 'shot':
          if (e.pid) {
            shotBy.set(e.pid, e.weapon);
            // Hitscan accuracy: rays that hit flesh (single-pierce guns, where the
            // ray's end tells hit from miss).
            if (WEAPONS[e.weapon].pierce === 1) for (const r of e.rays) {
              rays++;
              if (r.hit === 1) hits++;
            }
          }
          else if (e.turret) {
            const t = g.turrets.find((q) => q.id === e.turret);
            if (t) turretOwners.add(t.owner);
          }
          break;
        case 'explosion':
          blasts.push(e.kind);
          blastAt.push(e);
          break;
        case 'melee': meleeBy.add(e.pid); break;
        case 'down': downNow.add(e.pid); break;
        default: break;
      }
    }
    for (const e of evs) {
      switch (e.type) {
        case 'wave': {
          const m = teamMoney();
          // Spending in the break before this wave belongs to it.
          const spentBreak = (m.earned - lastEarned - (m.cash - lastCash)) / n;
          cur = {
            wave: e.wave, boss: e.boss, start: g.tick, e0: m.earned, c0: m.cash, bank: m.cash / n,
            spentBreak, downs: 0, deaths: 0, revives: 0, selfRevives: 0, dmgTaken: 0, peakAlive: 0,
            objStart: g.objective ? g.objective.hp / g.objective.maxHp : 1,
            bossSpawn: -1, bossDead: -1, bossesLeft: 0, kills: 0,
          };
          if (zone) {
            cur.move = (g.tick - breakStart) / TICK_RATE;
            cur.arrive = arrive >= 0 ? (arrive - breakStart) / TICK_RATE : cur.move;
            cur.moveKills = moveKills;
            cur.moveDmg = moveDmg / n;
            cur.harassed = zone.stats.harassed - harassed0;
            fog0 = zone.stats.fog;
          }
          break;
        }
        case 'waveclear':
          if (cur && zone) cur.fog = (zone.stats.fog - fog0) / n;
          closeWave(true);
          if (zone) {
            breakStart = g.tick;
            arrive = -1;
            moveKills = 0;
            moveDmg = 0;
            harassed0 = zone.stats.harassed;
          }
          {
            const m = teamMoney();
            lastEarned = m.earned;
            lastCash = m.cash;
          }
          break;
        case 'pdamage':
          if (!cur && zone) moveDmg += e.amount;
          if (cur) {
            const p = g.getPlayer(e.pid);
            if (p && (p.state === 'alive' || downNow.has(e.pid))) {
              cur.dmgTaken += e.amount;
              taken[e.pid] += e.amount;
              const src = hurtSource(g, e, blastAt);
              const band = cur.wave <= 4 ? 'w1-4' : cur.wave <= 9 ? 'w5-9' : 'w10+';
              const hb = hurtBy[band] || (hurtBy[band] = {});
              hb[src] = (hb[src] || 0) + e.amount;
            }
          }
          break;
        case 'down': if (cur) cur.downs++; break;
        case 'died': if (cur) cur.deaths++; break;
        case 'revived':
          if (cur) {
            if (e.by === e.pid) cur.selfRevives++;
            else if (e.by) cur.revives++;
          }
          break;
        case 'bossspawn':
          if (cur) {
            if (cur.bossSpawn < 0) cur.bossSpawn = g.tick;
            cur.bossesLeft++;
          }
          break;
        case 'zdie': {
          if (!cur && zone) moveKills++;
          if (cur) {
            cur.kills++;
            if (e.ztype === 'boss' && --cur.bossesLeft <= 0) cur.bossDead = g.tick;
          }
          const key = killSource(g, e, shotBy, turretOwners, blasts, meleeBy);
          kills[key] = (kills[key] || 0) + 1;
          break;
        }
        case 'buy': {
          buys[e.item] = (buys[e.item] || 0) + 1;
          break;
        }
        case 'pickup':
          if (e.kind === 'crate' && e.weapon) crates[e.weapon] = (crates[e.weapon] || 0) + 1;
          break;
        case 'gameover':
          over = e.reason;
          break;
        case 'victory':
          over = 'victory';
          break;
        default: break;
      }
    }
    evs.length = 0;
    if (zone && g.phase !== 'wave' && arrive < 0 && zone.everyoneIn()) arrive = g.tick;
    if (g.phase === 'wave') {
      for (const p of g.players) {
        if (p.state !== 'alive') continue;
        const id = p.slots[p.slot];
        if (id) inHand[id] = (inHand[id] || 0) + 1;
      }
    }
    if (g.objective && g.objective.hp < objHp) objDamage(g, objHp - g.objective.hp, objBy);
    if (g.objective) objHp = g.objective.hp;
    if (cur) {
      const alive = g.zombies.length;
      if (alive > cur.peakAlive) cur.peakAlive = alive;
      if (g.tick - cur.start > WAVE_CAP_S * TICK_RATE) over = 'stall';
    }
  }
  if (cur && zone) cur.fog = (zone.stats.fog - fog0) / n;
  closeWave(false);
  const cleared = waves.filter((w) => w.cleared).length;
  const perPlayer = g.players.map((p) => ({
    cls: p.cls, kills: p.kills, downs: p.downs, revives: p.revives, damage: Math.round(p.damage),
    taken: Math.round(taken[p.id]), earned: Math.round(p.earned), cash: Math.round(p.cash),
    slots: p.slots.slice(),
  }));
  return {
    job: { ...job, classes },
    over, cleared, reached: waves.length ? waves[waves.length - 1].wave : 0,
    waves: waves.map((w) => ({
      wave: w.wave, boss: w.boss, cleared: w.cleared, dur: round2(w.dur), downs: w.downs, deaths: w.deaths,
      revives: w.revives, selfRevives: w.selfRevives, dmgTaken: round2(w.dmgTaken), peakAlive: w.peakAlive,
      objStart: round2(w.objStart), objEnd: round2(w.objEnd), bank: Math.round(w.bank),
      earned: Math.round(w.earned), spent: Math.round(w.spent + w.spentBreak), kills: w.kills,
      bossDur: w.bossSpawn >= 0 && w.bossDead >= 0 ? round2((w.bossDead - w.bossSpawn) / TICK_RATE) : w.bossSpawn >= 0 ? -1 : null,
      ...(zone ? {
        move: round2(w.move), arrive: round2(w.arrive), moveKills: w.moveKills, moveDmg: round2(w.moveDmg),
        harassed: w.harassed, fog: round2(w.fog || 0),
      } : {}),
    })),
    buys, crates, kills, objBy, hurtBy, inHand, players: perPlayer, rays, hits,
    ticks: g.tick, ms: Date.now() - t0,
  };
}

/** What hurt a player: the zombie type standing where the hit came from, a blast, or acid. */
function hurtSource(g, e, blastAt) {
  for (const h of g.hazards) if (h.kind === 'acid' && Math.abs(h.x - e.x) < 1.5 && Math.abs(h.y - e.y) < 1.5) return 'acid';
  for (const b of blastAt) if (Math.abs(b.x - e.x) < 1.5 && Math.abs(b.y - e.y) < 1.5) return b.kind === 'bloater' ? 'bloater burst' : `own ${b.kind}`;
  let best = null, bd = 12;
  for (const z of g.zombies) {
    const d = Math.abs(z.x - e.x) + Math.abs(z.y - e.y);
    if (d < bd) {
      bd = d;
      best = z;
    }
  }
  if (best) return best.type;
  // Evac Run: a survivor outside the circle mid-wave is hurt by the blight
  const zc = g.zone && g.phase === 'wave' && g.zone.stage > 0 ? g.zone.circle : null;
  const p = zc && g.getPlayer(e.pid);
  if (p && Math.hypot(p.x - zc.x, p.y - zc.y) > zc.r) return 'blight';
  return 'acid glob / other';
}

/** Split an objective hp loss over the zombies attacking it (by their hit damage). */
function objDamage(g, amount, out) {
  let total = 0;
  for (const z of g.zombies) if (z.tgtKind === 3 && z.tgtGap < z.def.attackRange + 6) total += z.damage;
  if (total <= 0) {
    out.other = (out.other || 0) + amount;
    return;
  }
  for (const z of g.zombies) {
    if (z.tgtKind === 3 && z.tgtGap < z.def.attackRange + 6) out[z.type] = (out[z.type] || 0) + (amount * z.damage) / total;
  }
}

/** Best guess at what killed a zombie (zdie only names the player). */
function killSource(g, e, shotBy, turretOwners, blasts, meleeBy) {
  const by = e.by;
  if (!by) return e.gib && blasts.includes('bloater') ? 'bloater burst' : 'none';
  const shot = shotBy.get(by);
  if (e.gib) {
    if (shot === 'railgun' || shot === 'amr' || shot === 'chainsaw') return shot;
    const k = blasts.find((b) => b !== 'bloater') || blasts[0];
    if (k) return EXPLOSION_GUN[k] || k;
  }
  if (meleeBy.has(by) && !shot) return 'melee';
  if (shot) return shot;
  if (turretOwners.has(by)) return 'turret';
  const p = g.getPlayer(by);
  const id = p && p.slots[p.slot];
  if (id && WEAPONS[id].kind !== 'hitscan' && WEAPONS[id].kind !== 'rail') return id;
  return 'burn/other';
}

/** Classes of a team: rotated per job so every class shows up evenly across runs. */
function teamClasses(job) {
  const off = (job.seed * 5 + MAP_LIST.findIndex((m) => m.id === job.map) * 2 + job.size) % CLASS_IDS.length;
  const out = [];
  for (let i = 0; i < job.size; i++) out.push(CLASS_IDS[(off + i) % CLASS_IDS.length]);
  return out;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

const TABLES = { WEAPONS, ZOMBIES, CLASSES, ITEMS, DIFFICULTIES, WAVE_ZOMBIES, SPAWN_PACING, TURRET, BARRICADE, THROWABLES };

/** Apply 'A.b.c=1;D.e=2' overrides to the shared data tables (this thread only). */
export function applySets(spec) {
  if (!spec) return;
  for (const part of String(spec).split(';')) {
    const m = part.trim().match(/^([\w.]+)=(.+)$/);
    if (!m) continue;
    const path = m[1].split('.');
    let o = TABLES[path[0]];
    for (let i = 1; o && i < path.length - 1; i++) o = o[path[i]];
    const key = path[path.length - 1];
    if (!o || !(key in o)) throw new Error(`--set: unknown ${m[1]}`);
    const v = Number(m[2]);
    o[key] = Number.isFinite(v) ? v : m[2] === 'true' ? true : m[2] === 'false' ? false : m[2];
  }
}

// -------------------------------------------------------------------------------------
// Worker side

if (!isMainThread && workerData && workerData.balanceWorker) {
  applySets(workerData.set);
  parentPort.on('message', (job) => {
    if (!job) {
      process.exit(0);
    }
    let res;
    try {
      res = runMatch(job);
    } catch (err) {
      res = { job, error: String(err && err.stack || err) };
    }
    parentPort.postMessage(res);
  });
}

// -------------------------------------------------------------------------------------
// Main side: jobs, pool, report

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    o[k] = v;
  }
  return o;
}

const list = (v, def) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : def);

export function buildJobs(opt) {
  const quick = !!opt.quick;
  const maps = list(opt.maps, MAP_LIST.map((m) => m.id));
  const waves = Number(opt.waves) || 15;
  const seeds = Number(opt.seeds) || (quick ? 1 : 3);
  const jobs = [];
  // Evac Run on request; maps that only play it always run it
  const modeOf = (map) => (typeof opt.mode === 'string' && mapModes(map).includes(opt.mode) ? opt.mode : mapModes(map).includes('defend') ? 'defend' : 'zone');
  const add = (j) => jobs.push({ waves, mode: modeOf(j.map), ...j });
  if (quick && !opt.diffs && !opt.sizes && !opt.profiles) {
    // Normal for every team size and both profiles, and 4 average players elsewhere.
    for (const map of maps) {
      for (let s = 1; s <= seeds; s++) {
        for (const profile of ['average', 'skilled']) {
          for (const size of [1, 2, 4, 6]) add({ map, diff: 'normal', size, seed: s, profile });
        }
        for (const diff of ['easy', 'hard', 'nightmare']) add({ map, diff, size: 4, seed: s, profile: 'average' });
      }
    }
  } else {
    const diffs = list(opt.diffs, DIFFICULTY_IDS);
    const sizes = list(opt.sizes, ['1', '2', '4', '6']).map(Number);
    const profiles = list(opt.profiles, ['average', 'skilled']);
    for (const map of maps) {
      for (let s = 1; s <= seeds; s++) {
        for (const diff of diffs) {
          for (const profile of profiles) {
            for (const size of sizes) add({ map, diff, size, seed: s, profile });
          }
        }
      }
    }
  }
  const mono = opt.mono === true || (!quick && opt.mono !== 'false' && !opt['no-mono'] && !opt.diffs && !opt.sizes && !opt.profiles);
  if (mono) {
    for (const map of maps) {
      for (let s = 1; s <= Math.min(seeds, 2); s++) {
        for (const cls of CLASS_IDS) {
          add({ map, diff: 'normal', size: 4, seed: 100 + s, profile: 'average', classes: [cls, cls, cls, cls], mono: cls });
        }
      }
    }
  }
  // Longest first so the pool drains evenly.
  jobs.sort((a, b) => cost(b) - cost(a));
  return jobs;
}

function cost(j) {
  const d = { easy: 1.4, normal: 1, hard: 0.7, nightmare: 0.5 }[j.diff] || 1;
  return j.size * d * (j.profile === 'skilled' ? 1.3 : 1);
}

async function runPool(jobs, workers, set) {
  const results = [];
  let next = 0, done = 0;
  const t0 = Date.now();
  await new Promise((resolve, reject) => {
    let live = 0;
    const spawn = () => {
      const w = new Worker(new URL(import.meta.url), { workerData: { balanceWorker: true, set } });
      live++;
      const feed = () => {
        if (next < jobs.length) w.postMessage(jobs[next++]);
        else w.postMessage(null);
      };
      w.on('message', (res) => {
        results.push(res);
        done++;
        if (res.error) process.stderr.write(`\n! ${JSON.stringify(res.job)}: ${res.error}\n`);
        const el = ((Date.now() - t0) / 1000).toFixed(0);
        process.stderr.write(`\r  ${done}/${jobs.length} runs, ${el}s   `);
        feed();
      });
      w.on('error', reject);
      w.on('exit', () => {
        if (--live === 0) resolve();
      });
      feed();
    };
    for (let i = 0; i < Math.min(workers, jobs.length); i++) spawn();
    if (!jobs.length) resolve();
  });
  process.stderr.write('\n');
  return results;
}

// ---- aggregation -------------------------------------------------------------------

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length & 1 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '-');
const f0 = (v) => (Number.isFinite(v) ? String(Math.round(v)) : '-');
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-');
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '-');

function table(head, rows) {
  const out = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  for (const r of rows) out.push(`| ${r.join(' | ')} |`);
  return out.join('\n');
}

function groupBy(results, keyFn) {
  const m = new Map();
  for (const r of results) {
    const k = keyFn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

const DIFF_ORDER = Object.fromEntries(DIFFICULTY_IDS.map((d, i) => [d, i]));

function summaryTable(results) {
  const g = groupBy(results.filter((r) => !r.job.mono), (r) => `${r.job.profile}|${r.job.diff}|${r.job.size}`);
  const keys = [...g.keys()].sort((a, b) => {
    const [pa, da, sa] = a.split('|'), [pb, db, sb] = b.split('|');
    return pa.localeCompare(pb) || DIFF_ORDER[da] - DIFF_ORDER[db] || sa - sb;
  });
  // (mixed maps/modes land in one row: filter with --maps/--mode for clean numbers)
  const rows = keys.map((k) => {
    const rs = g.get(k);
    const [profile, diff, size] = k.split('|');
    const W = rs[0].job.waves;
    const cl = rs.map((r) => r.cleared);
    const allW = rs.flatMap((r) => r.waves);
    const lostObj = rs.filter((r) => r.over === 'objective').length;
    const wiped = rs.filter((r) => r.over === 'wiped').length;
    const stall = rs.filter((r) => r.over === 'stall').length;
    return [profile, diff, size, rs.length,
      pct(cl.filter((c) => c >= 5).length / rs.length), pct(cl.filter((c) => c >= 10).length / rs.length),
      pct(cl.filter((c) => c >= W).length / rs.length), f1(median(cl)), f1(mean(cl)),
      `${wiped}/${lostObj}${stall ? `/${stall}!` : ''}`,
      f2(mean(allW.map((w) => w.downs / Number(size)))), f2(mean(allW.map((w) => w.revives / Number(size)))),
      f0(mean(allW.map((w) => w.dur))), pct(rs.reduce((a, r) => a + r.hits, 0) / Math.max(1, rs.reduce((a, r) => a + r.rays, 0)))];
  });
  return table(['profile', 'diff', 'team', 'runs', 'clear 5', 'clear 10', `clear ${results[0] ? results[0].job.waves : 15}`,
    'median cleared', 'mean cleared', 'wiped/obj lost', 'downs/pl/wave', 'revives/pl/wave', 'wave s', 'hit rate'], rows);
}

function waveTable(rs) {
  const maxW = Math.max(...rs.map((r) => r.reached), 0);
  const n = rs.length;
  const size = rs[0].job.size;
  const rows = [];
  for (let w = 1; w <= maxW; w++) {
    const ws = rs.map((r) => r.waves.find((x) => x.wave === w)).filter(Boolean);
    const cl = ws.filter((x) => x.cleared);
    const boss = ws.filter((x) => x.bossDur != null);
    const bossDone = boss.filter((x) => x.bossDur >= 0);
    rows.push([
      w + (w % BOSS_EVERY === 0 ? 'B' : ''), pct(ws.length / n), pct(cl.length / n),
      f0(mean(cl.map((x) => x.dur))), f1(mean(ws.map((x) => x.dmgTaken))),
      f2(mean(ws.map((x) => x.downs / size))), f2(mean(ws.map((x) => x.deaths / size))),
      f2(mean(ws.map((x) => x.revives / size))),
      f0(mean(ws.map((x) => x.bank))), f0(mean(ws.map((x) => x.earned))), f0(mean(ws.map((x) => x.spent))),
      pct(mean(ws.map((x) => x.objEnd))), pct(Math.min(...ws.map((x) => x.objEnd))), f0(mean(ws.map((x) => x.peakAlive))),
      boss.length ? `${f0(mean(bossDone.map((x) => x.bossDur)))}${bossDone.length < boss.length ? ` (${boss.length - bossDone.length} unk.)` : ''}` : '',
    ]);
  }
  const head = ['wave', 'reached', 'cleared', 'time s', 'dmg taken/pl', 'downs/pl', 'deaths/pl', 'revives/pl',
    'bank/pl $', 'earned/pl $', 'spent/pl $', 'obj hp end', 'obj min', 'peak alive', 'boss s'];
  if (rs[0].job.mode !== 'zone') return table(head, rows);
  // Evac Run: the move before the wave and the blight during it (no objective columns)
  for (let w = 1; w <= maxW; w++) {
    const ws = rs.map((r) => r.waves.find((x) => x.wave === w)).filter(Boolean);
    const row = rows[w - 1];
    row.splice(11, 2);
    row.push(f0(mean(ws.map((x) => x.move))), f0(mean(ws.map((x) => x.arrive))), f1(mean(ws.map((x) => x.harassed))),
      f1(mean(ws.map((x) => x.moveKills))), f1(mean(ws.map((x) => x.moveDmg))), f1(mean(ws.map((x) => x.fog))));
  }
  head.splice(11, 2);
  head.push('move s', 'all in s', 'harassers', 'move kills', 'move dmg/pl', 'blight dmg/pl');
  return table(head, rows);
}

function weaponUseTable(results) {
  const buys = {}, crates = {}, kills = {}, hand = {};
  let totalKills = 0;
  for (const r of results) {
    for (const [k, v] of Object.entries(r.inHand || {})) hand[k] = (hand[k] || 0) + v / TICK_RATE / 60;
    for (const [k, v] of Object.entries(r.buys)) buys[k] = (buys[k] || 0) + v;
    for (const [k, v] of Object.entries(r.crates)) crates[k] = (crates[k] || 0) + v;
    for (const [k, v] of Object.entries(r.kills)) {
      kills[k] = (kills[k] || 0) + v;
      totalKills += v;
    }
  }
  const final = {};
  for (const r of results) for (const p of r.players) for (const s of p.slots) if (s) final[s] = (final[s] || 0) + 1;
  const keys = [...new Set([...WEAPON_IDS, ...Object.keys(kills)])];
  const rows = keys.filter((k) => buys[k] || kills[k] || crates[k] || final[k]).map((k) => [
    k, buys[k] || 0, crates[k] || 0, final[k] || 0, kills[k] || 0, pct((kills[k] || 0) / Math.max(1, totalKills)),
    hand[k] ? f0(hand[k]) : '', hand[k] ? f1((kills[k] || 0) / hand[k]) : '',
  ]);
  rows.sort((a, b) => b[4] - a[4]);
  const items = Object.keys(buys).filter((k) => !(k in WEAPONS)).sort((a, b) => buys[b] - buys[a]);
  return `${table(['gun / source', 'bought (incl. refills)', 'from crates', 'held at end', 'kills', 'kill share', 'min in hand', 'kills/min in hand'], rows)}\n\n`
    + `Items bought: ${items.map((k) => `${k} ${buys[k]}`).join(', ')}`;
}

function hurtTable(results) {
  const bands = ['w1-4', 'w5-9', 'w10+'];
  const acc = {}, tot = {};
  let all = 0;
  for (const r of results) {
    for (const band of bands) {
      for (const [k, v] of Object.entries((r.hurtBy || {})[band] || {})) {
        const a = acc[k] || (acc[k] = { sum: 0 });
        a.sum += v;
        a[band] = (a[band] || 0) + v;
        tot[band] = (tot[band] || 0) + v;
        all += v;
      }
    }
  }
  const rows = Object.keys(acc).sort((a, b) => acc[b].sum - acc[a].sum).map((k) => [
    k, f0(acc[k].sum / results.length), pct(acc[k].sum / Math.max(1, all)),
    ...bands.map((b) => pct((acc[k][b] || 0) / Math.max(1, tot[b] || 0))),
  ]);
  rows.push(['(total)', f0(all / results.length), '100%', ...bands.map((b) => f0((tot[b] || 0) / results.length))]);
  return table(['source', 'hp per run', 'share', ...bands.map((b) => `share ${b}`)], rows);
}

function objTable(results) {
  const acc = {};
  let total = 0;
  for (const r of results) {
    for (const [k, v] of Object.entries(r.objBy || {})) {
      acc[k] = (acc[k] || 0) + v;
      total += v;
    }
  }
  const rows = Object.keys(acc).sort((a, b) => acc[b] - acc[a]).map((k) => [k, f0(acc[k] / results.length), pct(acc[k] / Math.max(1, total))]);
  return table(['zombie', 'objective hp lost per run', 'share'], rows);
}

function classTable(results) {
  const acc = {};
  for (const r of results) {
    if (r.job.mono) continue;
    const played = Math.max(1, r.waves.length);
    for (const p of r.players) {
      const a = acc[p.cls] || (acc[p.cls] = { n: 0, waves: 0, kills: 0, downs: 0, revives: 0, damage: 0, taken: 0, earned: 0, won: 0, teams: 0 });
      a.n++;
      a.waves += played;
      a.kills += p.kills;
      a.downs += p.downs;
      a.revives += p.revives;
      a.damage += p.damage;
      a.taken += p.taken;
      a.earned += p.earned;
    }
  }
  const rows = CLASS_IDS.filter((c) => acc[c]).map((c) => {
    const a = acc[c];
    return [c, a.n, f1(a.kills / a.waves), f0(a.damage / a.waves), f1(a.taken / a.waves), f2(a.downs / a.waves),
      f2(a.revives / a.waves), f0(a.earned / a.waves)];
  });
  return table(['class', 'player-runs', 'kills/wave', 'dmg dealt/wave', 'dmg taken/wave', 'downs/wave', 'revives/wave', 'earned/wave $'], rows);
}

function monoTable(results) {
  const g = groupBy(results.filter((r) => r.job.mono), (r) => r.job.mono);
  if (!g.size) return '';
  const rows = CLASS_IDS.filter((c) => g.has(c)).map((c) => {
    const rs = g.get(c);
    const cl = rs.map((r) => r.cleared);
    const W = rs[0].job.waves;
    return [c, rs.length, pct(cl.filter((x) => x >= 5).length / rs.length), pct(cl.filter((x) => x >= 10).length / rs.length),
      pct(cl.filter((x) => x >= W).length / rs.length), f1(mean(cl)),
      f2(mean(rs.flatMap((r) => r.waves).map((w) => w.downs / 4)))];
  });
  return table(['mono class (4 average, normal)', 'runs', 'clear 5', 'clear 10', 'clear all', 'mean cleared', 'downs/pl/wave'], rows);
}

/** Paper numbers for every gun: burst and sustained DPS, $ per DPS, refill cost. */
export function gunTable() {
  const rows = [];
  for (const id of WEAPON_IDS) {
    const w = WEAPONS[id];
    const exp = w.projectile && w.projectile.explodeDamage ? w.projectile.explodeDamage : 0;
    let hit = w.damage * (w.pellets || 1) + exp;
    if (w.kind === 'flame') hit = w.damage + w.burn.dps / w.rate;
    // a flare's burn: the full fire on a direct hit (the burning flare on the ground not counted)
    else if (w.burn) hit += w.burn.dps * w.burn.duration;
    // bursts pause between trigger pulls; round-by-round reloads load the whole mag
    const rate = effectiveRate(w);
    const burst = hit * rate;
    const cycle = w.mag / rate + fullReloadTime(w);
    const sustained = (hit * w.mag) / cycle;
    const refill = ammoPrice(id);
    const shots = w.reserve < 0 ? Infinity : w.mag + w.reserve;
    rows.push([
      id, w.price, w.unlockWave, w.kind, f0(burst), f0(sustained), w.range, w.pierce >= 99 ? 'all' : w.pierce,
      w.price ? f1(w.price / sustained) : '-', refill || '-',
      Number.isFinite(shots) ? f0((hit * shots) / Math.max(1, refill) ) : 'inf', w.moveMult,
    ]);
  }
  return table(['gun', 'price', 'unlock', 'kind', 'burst dps', 'sustained dps', 'range', 'pierce', '$ per sust. dps',
    'refill $', 'dmg per refill $', 'move'], rows);
}

function report(results, opt) {
  const parts = [];
  const ok = results.filter((r) => !r.error);
  const secs = ok.reduce((s, r) => s + r.ticks, 0) / TICK_RATE;
  const cpu = ok.reduce((s, r) => s + r.ms, 0) / 1000;
  parts.push(`# Balance run (${ok.length} runs, ${f0(secs / 3600)} h of game time simulated in ${f0(cpu)} CPU s)`);
  if (typeof opt.set === 'string') parts.push(`Overrides: \`${opt.set}\``);
  parts.push('## Summary\n\nclear N = share of runs that cleared wave N; wiped/obj lost = how the lost runs ended.\n\n' + summaryTable(ok));
  const detail = opt.detail || 'normal';
  if (detail !== 'none') {
    const g = groupBy(ok.filter((r) => !r.job.mono && (detail === 'all' || r.job.diff === detail)),
      (r) => `${r.job.profile}|${r.job.diff}|${r.job.size}`);
    const keys = [...g.keys()].sort((a, b) => {
      const [pa, da, sa] = a.split('|'), [pb, db, sb] = b.split('|');
      return pa.localeCompare(pb) || DIFF_ORDER[da] - DIFF_ORDER[db] || sa - sb;
    });
    for (const k of keys) {
      const [profile, diff, size] = k.split('|');
      const zoneRuns = g.get(k)[0].job.mode === 'zone' ? `Evac Run on ${[...new Set(g.get(k).map((r) => r.job.map))].join('/')}, ` : '';
      parts.push(`## Per wave: ${zoneRuns}${profile}, ${diff}, ${size} player${size === '1' ? '' : 's'} (${g.get(k).length} runs)\n\n` + waveTable(g.get(k)));
    }
  }
  parts.push('## Guns (all runs)\n\n' + weaponUseTable(ok));
  const avg = ok.filter((r) => r.job.profile === 'average' && !r.job.mono);
  if (avg.length) parts.push('## Guns (average teams)\n\n' + weaponUseTable(avg));
  parts.push('## Player damage taken by source (hp after armour per run; share within each wave band)\n\n' + hurtTable(ok));
  parts.push('## Objective damage by zombie type (hp, all runs)\n\n' + objTable(ok));
  parts.push('## Classes (mixed teams, per player per wave played)\n\n' + classTable(ok));
  const mono = monoTable(ok);
  if (mono) parts.push('## Mono-class teams\n\n' + mono);
  parts.push('## Gun table (paper numbers)\n\n' + gunTable());
  return parts.join('\n\n') + '\n';
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  const jobs = buildJobs(opt);
  const workers = Math.max(1, Number(opt.workers) || Math.min(4, os.availableParallelism ? os.availableParallelism() : os.cpus().length));
  process.stderr.write(`balance: ${jobs.length} runs on ${workers} workers\n`);
  const t0 = Date.now();
  if (typeof opt.set === 'string') applySets(opt.set);
  const results = await runPool(jobs, workers, typeof opt.set === 'string' ? opt.set : null);
  const text = report(results, opt);
  process.stdout.write(text);
  process.stderr.write(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
  if (typeof opt.out === 'string') fs.writeFileSync(opt.out, text);
  if (typeof opt.json === 'string') fs.writeFileSync(opt.json, JSON.stringify(results));
}

if (isMainThread && process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
