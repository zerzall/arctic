// Mission results → rewards (STORY.md §5.1/§5.5). When the sim reports
// `{ type:'storyend', result:'victory'|'defeat', stars, stats }` the host session calls
// `settleMission()` once: it returns each human player's new profile with a `delta` for the
// debrief screen, and the crew's new world (completion, stars, flags, stash, hideout).
// Pure: the same inputs always produce the same outputs, and nothing is modified in place.
//
//   stats: { [pid]: { kills, kinds:{[zombieType]:n}, elites, objectives, revives, downs, damage } }
//
// (`stats` per player is what S2's mission director fills; every field is optional.)

import { DIFFICULTIES } from '../constants.js';
import {
  addXp, statsXp, catchUpMult, DIFFICULTY_XP, STAR_XP_BONUS, REPLAY_SHARE, DEFEAT_XP_SHARE,
} from './progression.js';
import { perkEffects } from './perks.js';
import { hideoutEffects, grantWeapon, isWeaponKnown } from './upgrades.js';
import { changeWorld, isCompleted, MAX_STASH, addMember, MAX_FLAGS } from './world.js';
import { resolveNext } from './graph.js';
import { getMissions } from './content.js';

/** Scrap multiplier by difficulty (harder worlds pay better). */
export const DIFFICULTY_SCRAP = { easy: 0.8, normal: 1, hard: 1.2, nightmare: 1.5 };
/** Share of a mission's scrap that goes to the crew's stash instead of the players. */
export const STASH_SCRAP_SHARE = 0.5;
/** Each star above the first adds this share to a player's scrap payout. */
export const STAR_SCRAP_BONUS = 0.05;

/** Stars as a whole number: 1..3 for a victory, 0 for a defeat. */
export function clampStars(stars, victory) {
  if (!victory) return 0;
  const n = Math.floor(Number(stars));
  return Number.isFinite(n) ? Math.min(3, Math.max(1, n)) : 1;
}

function statOf(stats, pid) {
  const s = stats && typeof stats === 'object' ? stats[pid] : null;
  return s && typeof s === 'object' ? s : {};
}

function nz(v, hi = 99999) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(0, n)) : 0;
}

/**
 * @typedef {object} PlayerResult
 * @property {object} profile the new profile
 * @property {object} delta what changed, for the debrief: xp, scrap, levels, perk points, kills...
 * @property {{ label: string, xp: number }[]} breakdown where the XP came from
 */

/**
 * Settle a finished mission.
 * @param {object} args
 * @param {object} args.world the crew's world before the mission
 * @param {object} args.mission the mission (STORY.md §5.4)
 * @param {object} args.result the `storyend` event { result, stars, stats, time? }
 * @param {{ pid: number, profile: object, human?: boolean }[]} args.party who took part (bots earn nothing)
 * @param {string} [args.difficulty] defaults to the world's
 * @param {object[]} [args.missions] campaign order (defaults to the installed content)
 * @param {number} [args.now]
 * @returns {{ world: object, victory: boolean, stars: number, firstClear: boolean, replay: boolean,
 *   players: Record<number, PlayerResult>, stash: Record<string, number>, unlocks: object }}
 */
export function settleMission({ world, mission, result, party, difficulty, missions, now = Date.now() }) {
  const victory = !!result && result.result === 'victory';
  const stars = clampStars(result && result.stars, victory);
  const diff = DIFFICULTIES[difficulty || world.difficulty] ? difficulty || world.difficulty : 'normal';
  const list = missions || getMissions();
  const firstClear = victory && !isCompleted(world, mission.id);
  const replay = victory && !firstClear;
  const rw = mission.rewards || {};
  const hf = hideoutEffects(world.hideout.upgrades);
  const recLevel = Array.isArray(mission.level) ? nz(mission.level[0], 20) : 0;
  const share = replay ? REPLAY_SHARE : 1;
  const time = nz(result && result.time, 99999);

  const players = {};
  for (const member of party) {
    if (member.human === false) continue;
    const p = member.profile;
    const st = statOf(result && result.stats, member.pid);
    const fx = perkEffects(p.perks);
    const fight = statsXp(st);
    const breakdown = [];
    let xp = 0;
    if (victory) {
      const base = nz(rw.xp, 100000);
      const starXp = Math.round(base * STAR_XP_BONUS * (stars - 1));
      const mult = (DIFFICULTY_XP[diff] || 1) * share * hf.xp * catchUpMult(p.level, recLevel);
      if (fight) breakdown.push({ label: 'Kills & objectives', xp: Math.round(fight * mult) });
      breakdown.push({ label: 'Mission', xp: Math.round(base * mult) });
      if (starXp) breakdown.push({ label: `${stars} stars`, xp: Math.round(starXp * mult) });
      xp = breakdown.reduce((a, b) => a + b.xp, 0);
    } else {
      xp = Math.round(fight * DEFEAT_XP_SHARE * (DIFFICULTY_XP[diff] || 1));
      if (xp) breakdown.push({ label: 'Kills & objectives', xp });
    }
    const scrapBase = victory ? nz(rw.scrap, 100000) : 0;
    const scrap = Math.round(scrapBase * (DIFFICULTY_SCRAP[diff] || 1) * share * fx.scrap * hf.scrap * (1 + STAR_SCRAP_BONUS * Math.max(0, stars - 1)));

    const lv = addXp(p, xp);
    let np = lv.profile;
    let gunGranted = null;
    if (firstClear && isWeaponKnown(rw.weapon) && !(np.weapons && np.weapons[rw.weapon])) {
      np = grantWeapon(np, rw.weapon);
      gunGranted = rw.weapon;
    }
    const kills = nz(st.kills) || Object.values(st.kinds || {}).reduce((a, n) => a + nz(n), 0);
    const downs = nz(st.downs);
    np = {
      ...np,
      scrap: Math.min(99999, (np.scrap | 0) + scrap),
      // supplies are spent on a win; a lost mission keeps them for the retry
      kit: victory ? {} : { ...(np.kit || {}) },
      stats: {
        kills: (np.stats.kills | 0) + kills,
        missions: (np.stats.missions | 0) + (victory ? 1 : 0),
        deaths: (np.stats.deaths | 0) + downs,
        revives: (np.stats.revives | 0) + nz(st.revives),
        playtime: (np.stats.playtime | 0) + time,
      },
      updatedAt: now,
    };
    players[member.pid] = {
      profile: np,
      breakdown,
      delta: {
        xp: lv.gained,
        xpBefore: p.xp | 0,
        xpAfter: np.xp,
        levelBefore: lv.fromLevel,
        levelAfter: lv.toLevel,
        levelUps: lv.levels,
        perkPoints: lv.perkPointsGained,
        scrap,
        weapon: gunGranted,
        kills,
        downs,
        revives: nz(st.revives),
      },
    };
  }

  // The crew's world: completion, flags, unlocks, stash and the hideout they return to.
  const stash = {};
  let changed = world;
  const unlocks = { weapon: null, npc: null, flags: [], hideout: null, chapterDone: false, upgradePoints: 0, next: null };
  if (victory) {
    const prevHideout = world.hideout.current;
    changed = changeWorld(world, (w) => {
      const prev = w.progress.completed[mission.id];
      w.progress.completed[mission.id] = {
        stars: prev ? Math.max(prev.stars, stars) : stars,
        time: prev && prev.time ? Math.min(prev.time, time || prev.time) : time,
      };
      if (firstClear) {
        for (const k of Object.keys(rw.flags || {})) {
          if (rw.flags[k] && /^[a-z][A-Za-z0-9_.:-]{0,39}$/.test(k) && Object.keys(w.progress.flags).length < MAX_FLAGS) {
            w.progress.flags[k] = true;
            unlocks.flags.push(k);
          }
        }
        if (typeof rw.unlockNpc === 'string' && /^[a-z][a-z0-9_]{0,23}$/.test(rw.unlockNpc)) {
          w.hideout.recruited[rw.unlockNpc] = true;
          unlocks.npc = rw.unlockNpc;
        }
        if (isWeaponKnown(rw.weapon)) unlocks.weapon = rw.weapon;
      }
      const add = (k, n) => {
        if (n > 0) {
          w.hideout.stash[k] = Math.min(MAX_STASH, (w.hideout.stash[k] | 0) + n);
          stash[k] = (stash[k] || 0) + n;
        }
      };
      add('scrap', Math.round(nz(rw.scrap, 100000) * STASH_SCRAP_SHARE * (DIFFICULTY_SCRAP[diff] || 1) * share * hf.scrap));
      if (firstClear) {
        const parts = nz(rw.upgradePoints, 50);
        add('parts', parts);
        unlocks.upgradePoints = parts;
      }
      // the garden's harvest (more each tier)
      if (hf.supplies > 0) {
        add('medkit', hf.supplies);
        if (hf.supplies >= 2) add('frag', 1);
        if (hf.supplies >= 3) add('armor', 1);
      }
      for (const member of party) {
        const pr = players[member.pid];
        if (pr) addMember(w, pr.profile, now);
      }
      // a first win is a day on the road
      if (firstClear) w.day = Math.min(999, (w.day | 0) + 1);
      // where the crew goes next (an arrival at a hideout, its board, or straight to the next
      // road mission); the hideout they rest in follows
      const next = resolveNext(w);
      if (next.kind === 'hideout' && next.hideout !== w.hideout.current) w.hideout.current = next.hideout;
      unlocks.next = next;
      if (next.kind === 'hideout' && next.hideout !== prevHideout) unlocks.hideout = next.hideout;
    }, now);
    unlocks.chapterDone = list.length > 0
      && list.filter((m) => m.chapter === mission.chapter).every((m) => isCompleted(changed, m.id));
  }
  return { world: changed, victory, stars, firstClear, replay, players, stash, unlocks };
}
