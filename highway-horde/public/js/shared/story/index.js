// ROAD TO HAVEN — story data entry point (pure, no DOM; Node and browser).
//
//   import { CAST, MISSIONS, CHAPTERS, DIALOGUE, TIPS, mission, nextNodes } from './shared/story/index.js';
//
// World shape it reads (STORY.md §3): world.progress = { node, completed:{[missionId]:{stars,time}},
// flags:{} }, world.hideout = { current, recruited:{[npcId]:true} }. Every helper accepts a missing/partial
// world (a brand-new campaign) and never mutates its arguments.
//
// MISSIONS holds the twelve story missions (chapters 1-6) and then the twelve side jobs of the hideout
// board (`side: true`, chapter 7). The story walks the first; the side jobs never appear in nextNodes().

import { CAST, CAST_IDS, NPC_IDS, castMember } from './cast.js';
import {
  MISSIONS, STORY_MISSIONS, SIDE_JOBS, SIDE_CHAPTER, CHAPTERS, HIDEOUTS, NOTES, NOTE_IDS, EPILOGUE, EPILOGUE_FLAG, TODO_REQUESTS, ITEM_KINDS,
  STEP_TYPES, ANCHORS,
} from './missions.js';
import { DIALOGUE, TIPS, STAGES, conditionMet, stageFor, conversation, banterFor, expandTokens } from './dialogue.js';

export {
  CAST, CAST_IDS, NPC_IDS, castMember,
  MISSIONS, STORY_MISSIONS, SIDE_JOBS, SIDE_CHAPTER, CHAPTERS, HIDEOUTS, NOTES, NOTE_IDS, EPILOGUE, EPILOGUE_FLAG, TODO_REQUESTS, ITEM_KINDS,
  STEP_TYPES, ANCHORS,
  DIALOGUE, TIPS, STAGES, conditionMet, stageFor, conversation, banterFor, expandTokens,
};

export const FIRST_MISSION = 'm1_1';
export const LAST_MISSION = 'm6_2';
/** The crew's first day (STORY.md §2). The bed station adds one per night. */
export const START_DAY = 41;

/**
 * How the first campaign's missions map onto this one (old saves keep working). The story missions
 * kept the old ids by chapter and position, so an old World's `completed` already names the matching
 * point of the new road: old m1_2 (Fuel Run) counts as Mill Road, old m2_1 (Diner Siege) as Hollow
 * Creek, old m3_1 (The Crossing) as Westgate, and so on. The old missions that had no place of their own
 * (m1_3 Beacon, m2_3 Night Hauler, m4_3 Ghosts) always came after the one before them in their chapter,
 * which already carries the progress. `progress.node` is always rebuilt as 'hideout:<current>' by the
 * world sanitiser, and resolveNext() walks the crew from there to where the story stands.
 *   old id -> { now: the story mission at that point, was: the old mission's title, side: its side job }
 */
export const LEGACY_MISSIONS = Object.freeze({
  m1_1: { now: 'm1_1', was: 'Pileup', side: null },
  m1_2: { now: 'm1_2', was: 'Fuel Run', side: 'sj_fuel' },
  m1_3: { now: 'm1_2', was: 'Beacon', side: 'sj_beacon' },
  m2_1: { now: 'm2_1', was: 'Diner Siege', side: 'sj_diner' },
  m2_2: { now: 'm2_2', was: 'Radio Parts', side: 'sj_radio' },
  m2_3: { now: 'm2_1', was: 'Night Hauler', side: 'sj_hauler' },
  m3_1: { now: 'm3_1', was: 'The Crossing', side: 'sj_crossing' },
  m3_2: { now: 'm3_2', was: 'Sunken Cargo', side: 'sj_cargo' },
  m4_1: { now: 'm4_1', was: 'Hold the Tower', side: 'sj_tower' },
  m4_2: { now: 'm4_2', was: 'Broken Line', side: 'sj_line' },
  m4_3: { now: 'm4_2', was: 'Ghosts', side: 'sj_ghosts' },
  m5_1: { now: 'm5_1', was: 'Down the Interstate', side: 'sj_interstate' },
  m5_2: { now: 'm5_2', was: 'Field Hospital', side: 'sj_hospital' },
  m6_1: { now: 'm6_1', was: 'Last Stand', side: null },
  m6_2: { now: 'm6_2', was: 'The Tower', side: null },
});

const BY_ID = new Map(MISSIONS.map((m) => [m.id, m]));
const doneOf = (world) => (world && world.progress && world.progress.completed) || {};
const flagsOf = (world) => (world && world.progress && world.progress.flags) || {};

/** A mission or side job by id (null when unknown). */
export function mission(id) {
  return BY_ID.get(id) || null;
}

/** Is this (a mission object or an id) a side job of the hideout board? */
export function isSideJob(m) {
  const x = typeof m === 'string' ? mission(m) : m;
  return !!(x && x.side === true);
}

/** 0-based position of a mission in MISSIONS (the story first, then the side jobs); -1 when unknown. */
export function missionIndex(id) {
  return MISSIONS.findIndex((m) => m.id === id);
}

/** The chapter object a mission (or chapter number) belongs to; a side job's is the side-jobs chapter. */
export function chapterOf(missionOrNumber) {
  const n = typeof missionOrNumber === 'number' ? missionOrNumber : (mission(missionOrNumber) || {}).chapter;
  return CHAPTERS.find((c) => c.n === n) || null;
}

/** The story chapter a mission belongs to: its own for a story mission, `opens` for a side job. */
export function storyChapterOf(id) {
  const m = mission(id);
  return m ? (m.side ? m.opens : m.chapter) : null;
}

// ---- levels ----------------------------------------------------------------------------------------
/** Cumulative XP needed to reach level L (STORY.md §2 curve). */
export function xpForLevel(level) {
  return level <= 1 ? 0 : Math.round(90 * Math.pow(level - 1, 1.7));
}

/** The level (1..20) a total of `xp` reaches. */
export function levelForXp(xp) {
  let l = 1;
  while (l < 20 && xp >= xpForLevel(l + 1)) l++;
  return l;
}

/** Sum of the XP rewards of the twelve story missions (side jobs are extra on top). */
export function totalRewardXp() {
  return STORY_MISSIONS.reduce((s, m) => s + m.rewards.xp, 0);
}

/**
 * XP a party has banked from story rewards before mission `id` (used to check the level bands). For a
 * side job: the XP of the story up to and including the story mission that puts it on the board.
 */
export function xpBefore(id) {
  const m = mission(id);
  if (m && m.side) {
    const last = opensAfter(m);
    if (!last) return 0;
    const i = STORY_MISSIONS.findIndex((q) => q.id === last);
    return STORY_MISSIONS.slice(0, i + 1).reduce((s, q) => s + q.rewards.xp, 0);
  }
  let xp = 0;
  for (const q of STORY_MISSIONS) {
    if (q.id === id) break;
    xp += q.rewards.xp;
  }
  return xp;
}

/** The story mission that puts a side job on the board: the latest one it requires (through other side jobs too). */
export function opensAfter(sideJob) {
  const req = (sideJob.requires || []).map((r) => mission(r)).filter(Boolean);
  let best = null;
  for (const r of req) {
    const id = r.side ? opensAfter(r) : r.id;
    if (id && (best === null || missionIndex(id) > missionIndex(best))) best = id;
  }
  return best;
}

// ---- the unlock graph -----------------------------------------------------------------------------
/**
 * What comes right after the debrief of mission `id`:
 *   { kind:'mission', id } (road missions chain), { kind:'hideout', id } or { kind:'epilogue' }.
 * A side job's `after: 'hideout'` is the hideout the crew is in (`world.hideout.current`).
 * The session still asks nextNodes() (below) for the pending arrival scene.
 */
export function afterMission(id, world = null) {
  const m = mission(id);
  if (!m) return null;
  if (m.after === 'epilogue') return { kind: 'epilogue', id: 'epilogue' };
  if (m.after === 'hideout') return { kind: 'hideout', id: (world && world.hideout && world.hideout.current) || m.hub || 'roadhouse' };
  if (m.after.startsWith('hideout:')) return { kind: 'hideout', id: m.after.slice('hideout:'.length) };
  return { kind: 'mission', id: m.after };
}

/** The arrival scene of a hideout ({ hideout, flag, scene, chapter }) or null. */
export function arrivalFor(hideoutId) {
  const ch = CHAPTERS.find((c) => c.arrival && c.arrival.hideout === hideoutId);
  return ch ? { ...ch.arrival, chapter: ch.n } : null;
}

/**
 * Where the crew can go next. Returns an array of nodes, in campaign order:
 *   { kind:'hideout', id, arrival:true, chapter }   a hideout whose arrival scene has not been seen
 *   { kind:'mission', id, chapter, hub, direct }    available story missions; `direct` = no hideout in
 *                                                   between (road missions: start the briefing at once)
 *   { kind:'epilogue', id:'epilogue' }              every story mission done, the ending not yet seen
 *   []                                              campaign complete and the epilogue seen
 * Side jobs are never nodes (they wait on the board: see sideJobStates()).
 */
export function nextNodes(world) {
  const done = doneOf(world), flags = flagsOf(world);
  for (const ch of CHAPTERS) {
    if (!ch.arrival) continue;
    const last = ch.missions[ch.missions.length - 1];
    if (done[last] && !flags[ch.arrival.flag]) return [{ kind: 'hideout', id: ch.arrival.hideout, arrival: true, chapter: ch.n }];
  }
  const avail = STORY_MISSIONS.filter((m) => !done[m.id] && m.requires.every((r) => done[r]));
  if (avail.length) {
    return avail.map((m) => ({ kind: 'mission', id: m.id, chapter: m.chapter, hub: m.hub, direct: m.hub === null }));
  }
  if (STORY_MISSIONS.every((m) => done[m.id])) return flags[EPILOGUE_FLAG] ? [] : [{ kind: 'epilogue', id: 'epilogue' }];
  return [];
}

/** Every story mission with its state for a mission list: 'done' | 'available' | 'locked' (+ stars). */
export function missionStates(world) {
  const done = doneOf(world);
  return STORY_MISSIONS.map((m) => {
    const rec = done[m.id];
    const state = rec ? 'done' : m.requires.every((r) => done[r]) ? 'available' : 'locked';
    return { id: m.id, chapter: m.chapter, title: m.title, state, stars: rec ? rec.stars || 0 : 0 };
  });
}

/**
 * The side jobs of the hideout board with their state: 'locked' (the story has not reached them),
 * 'available' (never played) or 'done' (played at least once: still replayable), plus stars and the
 * story chapter they belong to.
 */
export function sideJobStates(world) {
  const done = doneOf(world);
  return SIDE_JOBS.map((m) => {
    const rec = done[m.id];
    const open = m.requires.every((r) => done[r]);
    const state = rec ? 'done' : open ? 'available' : 'locked';
    return { id: m.id, opens: m.opens, title: m.title, state, stars: rec ? rec.stars || 0 : 0 };
  });
}

/** The chapter the crew is in now (the chapter of the first unfinished story mission; the last when done). */
export function currentChapter(world) {
  const done = doneOf(world);
  const m = STORY_MISSIONS.find((x) => !done[x.id]);
  return chapterOf(m ? m.chapter : 6);
}

// ---- NPCs -------------------------------------------------------------------------------------------
/** Is this NPC with the crew in this world? (recruited flag, or the mission that brings them is done) */
export function npcAvailable(npcId, world) {
  const c = CAST[npcId];
  if (!c || c.system || c.radioOnly || c.spoiler) return false;
  if (world && world.hideout && world.hideout.recruited && world.hideout.recruited[npcId]) return true;
  const j = c.joins;
  if (!j) return false;
  if (j.mission) return !!doneOf(world)[j.mission];
  if (j.hideout) {
    const ch = CHAPTERS.find((q) => q.arrival && q.arrival.hideout === j.hideout);
    const last = ch ? ch.missions[ch.missions.length - 1] : null;
    return !!flagsOf(world)['seen_arrival_' + j.hideout] || (last !== null && !!doneOf(world)[last]);
  }
  return false;
}

/** All NPC ids that live in the hideout in this world, in cast order. */
export function npcsAt(world) {
  return NPC_IDS.filter((id) => npcAvailable(id, world));
}

/** The day number shown at the bed (STORY.md: it starts at Day 41; `world.day` overrides when present). */
export function dayOf(world) {
  return world && Number.isFinite(world.day) ? world.day : START_DAY;
}
