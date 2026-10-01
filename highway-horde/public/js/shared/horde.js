// "Horde Elimination" (settings.mode 'horde', SPEC §3.12): one round against a finite horde.
// A short buy time, then the whole horde comes in surges out of the map's entrances with a
// cap on how many walk at once; the type mix and toughness ramp up surge by surge. Nobody
// respawns (the downed can still be revived). Every zombie dead is a victory, every
// survivor dead a defeat.
//
// This file is the shared part: the tuning table, the horde size, the surge plan, the
// entrances ("lanes") of a map and the small view helpers the HUD, the shop and both
// renderers use. The director that runs a round lives in sim/horde.js; nothing here keeps
// state or touches the DOM.

import { TAU } from './math.js';

/**
 * Tuning (seconds, world px, cash).
 *   prep       buy time before the first surge (the ready vote skips it)
 *   startCash  every survivor's cash at the start (instead of START_CASH): one real gun in
 *              the buy time, like a pistol round's savings
 *   total      horde size: round(base × (1 + perPlayer × (n − 1)) × difficulty.count) (perPlayer
 *              as the defend waves' WAVE_ZOMBIES.perPlayer: at 0.5 teams of 4 bots won every
 *              Hard round without a down, docs/BALANCE.md)
 *   surges     the horde arrives in this many surges; surge k's share of it ∝ 1 + grow × (k − 1)
 *   cap        alive at once during surge k: (base + perSurge × (k − 1)) × (1 + perPlayer × (n − 1))
 *              × difficulty.count, never above difficulty.maxAlive (bosses don't count)
 *   tier       the wave the last surge plays as (zombies.js type weights, hp and speed growth);
 *              surge 1 plays wave 1, the others spread evenly in between
 *   lanes      entrances a surge comes out of (0 = every one); `lateLane` entrances (a flank
 *              behind the defenders) only open from surge `lateFrom`
 *   group      zombies per spawn group: [min, max] + 1 per `groupPer` surges
 *   every      seconds between groups: [min, max] / crowd^0.5 (crowd = the total's player × difficulty factor)
 *   gap        the breather before a surge: `first` s after the buy time, then from `max` down to
 *              `min` s over the round; the next one is announced once its predecessor is all out
 *              and down to `lull` (from lull[0] to lull[1] over the round) of its size alive, or
 *              `wait` s after its last group
 *   travel     a zombie farther than `far` px from its survivor moves up to `mult` × faster (full
 *              from far + ramp): the entrances are a long walk from the defenders (a walker
 *              does 34-48 px/s; Sandstone's gates are 2000-3800 px from the square)
 *   bossDelay  the last surge's bosses (ceil(n / 3)) walk in this long after it starts
 *   surgeBonus cash to every living survivor at each surge after the first (resupply money)
 *   shopMin    the shop always sells at least wave `shopMin`'s guns (the buy time)
 */
export const HORDE = Object.freeze({
  prep: 25,
  startCash: 1000,
  total: Object.freeze({ base: 150, perPlayer: 0.6 }),
  surges: 8,
  grow: 0.25,
  cap: Object.freeze({ base: 22, perSurge: 4, perPlayer: 0.55 }),
  tier: Object.freeze({ easy: 7, normal: 9, hard: 10, nightmare: 12 }),
  lanes: Object.freeze([1, 1, 2, 2, 2, 3, 3, 0]),
  lateFrom: 4,
  group: Object.freeze([4, 7]),
  groupPer: 3,
  every: Object.freeze([1.3, 2.4]),
  gap: Object.freeze({ first: 4, max: 12, min: 5, lull: Object.freeze([0.2, 0.55]), wait: 24 }),
  travel: Object.freeze({ far: 1100, ramp: 500, mult: 1.8 }),
  bossDelay: 8,
  surgeBonus: 100,
  shopMin: 2,
});

/** Director stages (snapshot `horde.stage`). */
export const HORDE_STAGES = Object.freeze(['prep', 'breather', 'surge', 'hold', 'over']);
export const HS_PREP = 0, HS_BREATHER = 1, HS_SURGE = 2, HS_HOLD = 3, HS_OVER = 4;

/** Most entrances a map may name (the snapshot carries them as a 16-bit mask). */
export const MAX_LANES = 16;

/** The crowd factor of a team of `players` at difficulty `diff` (DIFFICULTIES entry). */
export function hordeCrowd(players, diff) {
  return (1 + HORDE.total.perPlayer * (Math.max(1, players) - 1)) * ((diff && diff.count) || 1);
}

/**
 * Zombies in the whole horde (bosses included) for `players` survivors at difficulty `diff`.
 * @param {number} players team size at the start (bots count)
 * @param {object} diff DIFFICULTIES entry
 * @returns {number}
 */
export function hordeTotal(players, diff) {
  return Math.max(HORDE.surges * 3, Math.round(HORDE.total.base * hordeCrowd(players, diff)));
}

/**
 * The surge plan of a round: `HORDE.surges` entries { n (1-based), size (bosses included),
 * bosses, tier, lanes (how many entrances; 0 = all), cap }. Sizes add up to the total.
 * @param {number} total hordeTotal()
 * @param {number} players team size
 * @param {object} diff DIFFICULTIES entry
 * @param {string} diffId 'easy'|'normal'|'hard'|'nightmare'
 * @returns {object[]}
 */
export function surgePlan(total, players, diff, diffId = 'normal') {
  const K = HORDE.surges;
  const weights = [];
  let sum = 0;
  for (let k = 0; k < K; k++) {
    const w = 1 + HORDE.grow * k;
    weights.push(w);
    sum += w;
  }
  // largest remainder: the sizes add up to the total exactly
  const raw = weights.map((w) => (total * w) / sum);
  const sizes = raw.map((r) => Math.floor(r));
  let left = total - sizes.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let i = 0; left > 0; i = (i + 1) % K, left--) sizes[order[i][1]]++;
  const top = HORDE.tier[diffId] || HORDE.tier.normal;
  const crowdCap = (1 + HORDE.cap.perPlayer * (Math.max(1, players) - 1)) * ((diff && diff.count) || 1);
  const maxAlive = (diff && diff.maxAlive) || 170;
  const bosses = Math.ceil(Math.max(1, players) / 3);
  return sizes.map((size, k) => ({
    n: k + 1,
    size,
    bosses: k === K - 1 ? Math.min(bosses, size) : 0,
    tier: 1 + Math.round((k * (top - 1)) / (K - 1)),
    lanes: HORDE.lanes[k] ?? 0,
    cap: Math.max(6, Math.min(maxAlive, Math.round((HORDE.cap.base + HORDE.cap.perSurge * k) * crowdCap))),
  }));
}

/** Seconds of breather before surge `n` (1-based) of `K`. */
export function surgeGap(n, K = HORDE.surges) {
  if (n <= 1) return HORDE.gap.first;
  const u = (n - 2) / Math.max(1, K - 2);
  return Math.round(HORDE.gap.max + (HORDE.gap.min - HORDE.gap.max) * u);
}

/** Share of surge `n`'s size still alive that lets the next one come (0..1). */
export function surgeLull(n, K = HORDE.surges) {
  const u = (n - 1) / Math.max(1, K - 1);
  return HORDE.gap.lull[0] + (HORDE.gap.lull[1] - HORDE.gap.lull[0]) * u;
}

const COMPASS = ['East', 'South-East', 'South', 'South-West', 'West', 'North-West', 'North', 'North-East'];
const LANE_CACHE = new WeakMap();

/**
 * Where the defenders hold by default (bots without a human to stick with, the HUD's
 * reference point): the map's `horde.hold`, else its objective, else the centre of the
 * player spawns.
 * @param {object} map MapDef
 * @returns {{ x: number, y: number, r: number }}
 */
export function hordeHold(map) {
  if (map.horde && map.horde.hold) return map.horde.hold;
  if (map.objective) return { x: map.objective.x, y: map.objective.y, r: 300 };
  const sp = map.playerSpawns || [];
  if (!sp.length) return { x: map.width / 2, y: map.height / 2, r: 300 };
  let x = 0, y = 0;
  for (const p of sp) { x += p.x; y += p.y; }
  return { x: x / sp.length, y: y / sp.length, r: 300 };
}

/**
 * The entrances of a map, the horde's lanes: [{ i, name, x, y, late, rects: [zombieSpawns] }].
 * A map may name them (`map.horde.lanes` [{ name, x, y, late? }], each spawn rect tagged with
 * `lane`: its index); otherwise the spawn rects are grouped by compass bearing from the hold
 * point (at most 8 lanes, "North", "South-East", ...). Cached per map; deterministic.
 * @param {object} map MapDef
 * @returns {object[]}
 */
export function hordeLanes(map) {
  let out = LANE_CACHE.get(map);
  if (out) return out;
  const rects = map.zombieSpawns || [];
  if (map.horde && Array.isArray(map.horde.lanes) && map.horde.lanes.length) {
    out = map.horde.lanes.slice(0, MAX_LANES).map((l, i) => ({
      i, name: l.name, x: l.x, y: l.y, late: !!l.late, rects: rects.filter((r) => r.lane === i),
    })).filter((l) => l.rects.length);
    out.forEach((l, i) => { l.i = i; });
  } else {
    const hold = hordeHold(map);
    const sectors = new Map();
    for (const r of rects) {
      const a = Math.atan2(r.y - hold.y, r.x - hold.x);
      const s = ((Math.round(a / (TAU / 8)) % 8) + 8) % 8;
      if (!sectors.has(s)) sectors.set(s, []);
      sectors.get(s).push(r);
    }
    out = [...sectors.keys()].sort((a, b) => a - b).map((s, i) => {
      const list = sectors.get(s);
      let x = 0, y = 0;
      for (const r of list) { x += r.x; y += r.y; }
      return { i, name: COMPASS[s], x: Math.round(x / list.length), y: Math.round(y / list.length), late: false, rects: list };
    });
  }
  if (!out.length && rects.length) out = [{ i: 0, name: 'The edge', x: rects[0].x, y: rects[0].y, late: false, rects: rects.slice() }];
  LANE_CACHE.set(map, out);
  return out;
}

/** Names of the lanes in a 16-bit mask ("Long Doors · South Gate"). */
export function laneNames(map, mask) {
  const lanes = hordeLanes(map);
  const out = [];
  for (const l of lanes) if (mask & (1 << l.i)) out.push(l.name);
  return out;
}

/**
 * The wave whose guns the shop sells (shop.js and the sim agree on it): in a horde round
 * the current surge's tier, at least HORDE.shopMin; otherwise the current wave, or the
 * next one between waves.
 * @param {string} phase snapshot / game phase
 * @param {number} wave snapshot / game wave
 * @param {object|null} horde snapshot horde block (or the director's view of it)
 */
export function shopWaveOf(phase, wave, horde) {
  if (horde) return Math.max(HORDE.shopMin, horde.tier | 0);
  return phase === 'wave' ? Math.max(1, wave) : wave + 1;
}

/** "3:05" style clock for a number of seconds. */
export function formatClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
