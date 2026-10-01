// Story progression: the XP curve, levels and what earns XP (STORY.md §4). Pure functions
// over plain profile objects, no DOM, no Math.random: they run in the browser, in the
// host's session code and in Node tests.
//
//   cumulative XP needed to reach level L = round(90 * (L - 1) ^ 1.7)      (level 1 = 0 XP)
//   level cap 20; every level gained is one perk point (perks.js).

/** Highest level a survivor can reach. */
export const MAX_LEVEL = 20;

/** XP that pays out per kill, by zombie type (elites pay double). */
export const KILL_XP = {
  walker: 2, runner: 3, crawler: 2, bloater: 6, spitter: 5, screamer: 8, brute: 15, boss: 100,
};

/** XP multiplier by difficulty (the world's difficulty scales what a mission pays). */
export const DIFFICULTY_XP = { easy: 0.8, normal: 1, hard: 1.25, nightmare: 1.5 };

/** XP for finishing an objective step of a mission (`stats.objectives` counts them). */
export const OBJECTIVE_XP = 20;

/** A revive is worth this much XP; a mission cleared with nobody going down adds a bonus. */
export const REVIVE_XP = 15;

/** Extra XP per star above the first (share of the mission's base XP). */
export const STAR_XP_BONUS = 0.1;

/** A mission replayed for the second time pays this share of its XP and scrap. */
export const REPLAY_SHARE = 0.5;

/** Defeat still pays this share of the XP earned by fighting (kills, revives). */
export const DEFEAT_XP_SHARE = 0.5;

/** Playing below a mission's recommended level pays 10% more XP per missing level (max 50%). */
export const CATCH_UP_PER_LEVEL = 0.1;
export const CATCH_UP_MAX = 0.5;

function toLevel(l) {
  const n = Math.floor(Number(l));
  return Number.isFinite(n) ? Math.min(MAX_LEVEL, Math.max(1, n)) : 1;
}

/**
 * Cumulative XP needed to reach level `level` (1 → 0, 2 → 90, 20 → 13 4xx).
 * @param {number} level 1..MAX_LEVEL (clamped)
 * @returns {number}
 */
export function xpForLevel(level) {
  const l = toLevel(level);
  return l <= 1 ? 0 : Math.round(90 * Math.pow(l - 1, 1.7));
}

/** Total XP at the level cap. */
export const MAX_XP = xpForLevel(MAX_LEVEL);

/**
 * The level a total of `xp` reaches.
 * @param {number} xp
 * @returns {number} 1..MAX_LEVEL
 */
export function levelForXp(xp) {
  const v = Number(xp);
  if (!Number.isFinite(v) || v <= 0) return 1;
  let level = 1;
  while (level < MAX_LEVEL && v >= xpForLevel(level + 1)) level++;
  return level;
}

/**
 * Where a profile stands on the current level's bar.
 * @param {{xp: number}} profile
 * @returns {{ level: number, xp: number, floor: number, next: number, into: number, span: number, frac: number, maxed: boolean }}
 */
export function xpBar(profile) {
  const xp = Math.min(MAX_XP, Math.max(0, Math.floor(Number(profile && profile.xp) || 0)));
  const level = levelForXp(xp);
  const floor = xpForLevel(level);
  if (level >= MAX_LEVEL) return { level, xp, floor, next: floor, into: 0, span: 0, frac: 1, maxed: true };
  const next = xpForLevel(level + 1);
  const span = next - floor;
  const into = xp - floor;
  return { level, xp, floor, next, into, span, frac: span > 0 ? into / span : 0, maxed: false };
}

/**
 * XP for one kill.
 * @param {string} type zombie type id
 * @param {boolean} [elite]
 * @returns {number}
 */
export function killXp(type, elite = false) {
  const base = Object.hasOwn(KILL_XP, type) ? KILL_XP[type] : 2;
  return elite ? base * 2 : base;
}

/**
 * XP from a per-player stats record (the `storyend` event's `stats[pid]`): kills by type,
 * objective steps and revives. Unknown fields are ignored; a plain `kills` count without
 * a breakdown pays like walkers.
 * @param {object} stats { kills?, kinds?: {[type]: n}, elites?, objectives?, revives? }
 * @returns {number} whole XP (before difficulty, stars and replay factors)
 */
export function statsXp(stats) {
  if (!stats || typeof stats !== 'object') return 0;
  let xp = 0;
  let counted = 0;
  if (stats.kinds && typeof stats.kinds === 'object') {
    for (const [type, n] of Object.entries(stats.kinds)) {
      const c = Math.max(0, Math.min(5000, Math.floor(Number(n) || 0)));
      xp += c * killXp(type);
      counted += c;
    }
  }
  const kills = Math.max(0, Math.min(5000, Math.floor(Number(stats.kills) || 0)));
  if (kills > counted) xp += (kills - counted) * killXp('walker');
  xp += Math.max(0, Math.min(5000, Math.floor(Number(stats.elites) || 0))) * 4;
  xp += Math.max(0, Math.min(200, Math.floor(Number(stats.objectives) || 0))) * OBJECTIVE_XP;
  xp += Math.max(0, Math.min(200, Math.floor(Number(stats.revives) || 0))) * REVIVE_XP;
  return Math.round(xp);
}

/**
 * The catch-up multiplier for a survivor below the mission's recommended level.
 * @param {number} level the survivor's level
 * @param {number} recommended the mission's minimum recommended level (0/undefined = none)
 * @returns {number} 1 .. 1 + CATCH_UP_MAX
 */
export function catchUpMult(level, recommended) {
  const rec = Math.floor(Number(recommended) || 0);
  if (rec <= 1) return 1;
  return 1 + Math.min(CATCH_UP_MAX, Math.max(0, rec - toLevel(level)) * CATCH_UP_PER_LEVEL);
}

/**
 * Add XP to a profile and report what it unlocked. The input is not modified.
 * @param {object} profile
 * @param {number} amount XP to add (fractions are rounded, negatives ignored)
 * @returns {{ profile: object, gained: number, fromLevel: number, toLevel: number, levelsGained: number,
 *   perkPointsGained: number, levels: number[] }}
 */
export function addXp(profile, amount) {
  const add = Math.max(0, Math.round(Number(amount) || 0));
  const xp0 = Math.min(MAX_XP, Math.max(0, Math.floor(Number(profile.xp) || 0)));
  const from = levelForXp(xp0);
  const xp1 = Math.min(MAX_XP, xp0 + add);
  const to = levelForXp(xp1);
  const levels = [];
  for (let l = from + 1; l <= to; l++) levels.push(l);
  const next = {
    ...profile,
    xp: xp1,
    level: to,
    perkPoints: Math.max(0, Math.floor(Number(profile.perkPoints) || 0)) + (to - from),
  };
  return { profile: next, gained: xp1 - xp0, fromLevel: from, toLevel: to, levelsGained: to - from, perkPointsGained: to - from, levels };
}
