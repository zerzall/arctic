// ROAD TO HAVEN — story data entry point (pure, no DOM; Node and browser).
//
//   import { CAST, MISSIONS, CHAPTERS, DIALOGUE, TIPS, mission, nextNodes } from './shared/story/index.js';
//
// World shape it reads (STORY.md §3): world.progress = { node, completed:{[missionId]:{stars,time}},
// flags:{} }, world.hideout = { recruited:{[npcId]:true} }. Every helper accepts a missing/partial
// world (a brand-new campaign) and never mutates its arguments.

import { CAST, CAST_IDS, NPC_IDS, castMember } from './cast.js';
import { MISSIONS, CHAPTERS, HIDEOUTS, NOTES, NOTE_IDS, EPILOGUE, EPILOGUE_FLAG, TODO_REQUESTS, ITEM_KINDS, STEP_TYPES, ANCHORS } from './missions.js';
import { DIALOGUE, TIPS, STAGES, conditionMet, stageFor, conversation, banterFor, expandTokens } from './dialogue.js';

export {
  CAST, CAST_IDS, NPC_IDS, castMember,
  MISSIONS, CHAPTERS, HIDEOUTS, NOTES, NOTE_IDS, EPILOGUE, EPILOGUE_FLAG, TODO_REQUESTS, ITEM_KINDS, STEP_TYPES, ANCHORS,
  DIALOGUE, TIPS, STAGES, conditionMet, stageFor, conversation, banterFor, expandTokens,
};

export const FIRST_MISSION = 'm1_1';
export const LAST_MISSION = 'm6_2';
/** The crew's first day (STORY.md §2). The bed station adds one per night. */
export const START_DAY = 41;

const BY_ID = new Map(MISSIONS.map((m) => [m.id, m]));
const doneOf = (world) => (world && world.progress && world.progress.completed) || {};
const flagsOf = (world) => (world && world.progress && world.progress.flags) || {};

/** A mission by id (null when unknown). */
export function mission(id) {
  return BY_ID.get(id) || null;
}

/** 0-based position of a mission in the campaign order (-1 when unknown). */
export function missionIndex(id) {
  return MISSIONS.findIndex((m) => m.id === id);
}

/** The chapter object a mission (or chapter number) belongs to. */
export function chapterOf(missionOrNumber) {
  const n = typeof missionOrNumber === 'number' ? missionOrNumber : (mission(missionOrNumber) || {}).chapter;
  return CHAPTERS.find((c) => c.n === n) || null;
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

/** Sum of the mission XP rewards over the whole campaign. */
export function totalRewardXp() {
  return MISSIONS.reduce((s, m) => s + m.rewards.xp, 0);
}

/** XP a party has banked from mission rewards before mission `id` (used to check the level bands). */
export function xpBefore(id) {
  let xp = 0;
  for (const m of MISSIONS) {
    if (m.id === id) break;
    xp += m.rewards.xp;
  }
  return xp;
}

// ---- the unlock graph -----------------------------------------------------------------------------
/**
 * What comes right after the debrief of mission `id`:
 *   { kind:'mission', id } (road missions chain), { kind:'hideout', id } or { kind:'epilogue' }.
 * The session still asks nextNodes() (below) for the pending arrival scene.
 */
export function afterMission(id) {
  const m = mission(id);
  if (!m) return null;
  if (m.after === 'epilogue') return { kind: 'epilogue', id: 'epilogue' };
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
 *   { kind:'mission', id, chapter, hub, direct }    available missions; `direct` = no hideout in
 *                                                   between (road missions: start the briefing at once)
 *   { kind:'epilogue', id:'epilogue' }              every mission done, the ending not yet seen
 *   []                                              campaign complete and the epilogue seen
 */
export function nextNodes(world) {
  const done = doneOf(world), flags = flagsOf(world);
  for (const ch of CHAPTERS) {
    if (!ch.arrival) continue;
    const last = ch.missions[ch.missions.length - 1];
    if (done[last] && !flags[ch.arrival.flag]) return [{ kind: 'hideout', id: ch.arrival.hideout, arrival: true, chapter: ch.n }];
  }
  const avail = MISSIONS.filter((m) => !done[m.id] && m.requires.every((r) => done[r]));
  if (avail.length) {
    return avail.map((m) => ({ kind: 'mission', id: m.id, chapter: m.chapter, hub: m.hub, direct: m.hub === null }));
  }
  if (MISSIONS.every((m) => done[m.id])) return flags[EPILOGUE_FLAG] ? [] : [{ kind: 'epilogue', id: 'epilogue' }];
  return [];
}

/** Every mission with its state for a mission list: 'done' | 'available' | 'locked' (+ stars). */
export function missionStates(world) {
  const done = doneOf(world);
  return MISSIONS.map((m) => {
    const rec = done[m.id];
    const state = rec ? 'done' : m.requires.every((r) => done[r]) ? 'available' : 'locked';
    return { id: m.id, chapter: m.chapter, title: m.title, state, stars: rec ? rec.stars || 0 : 0 };
  });
}

/** The chapter the crew is in now (the chapter of the first unfinished mission; the last when done). */
export function currentChapter(world) {
  const done = doneOf(world);
  const m = MISSIONS.find((x) => !done[x.id]);
  return chapterOf(m ? m.chapter : 6);
}

// ---- NPCs -------------------------------------------------------------------------------------------
/** Is this NPC with the crew in this world? (recruited flag, or the mission that unlocks them is done) */
export function npcAvailable(npcId, world) {
  const c = CAST[npcId];
  if (!c || c.system || c.radioOnly || c.spoiler) return false;
  if (world && world.hideout && world.hideout.recruited && world.hideout.recruited[npcId]) return true;
  const j = c.joins;
  if (!j) return false;
  if (j.mission) return !!doneOf(world)[j.mission];
  if (j.hideout) return !!flagsOf(world)['seen_arrival_' + j.hideout] || !!doneOf(world).m1_3;
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
