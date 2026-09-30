// Where the crew goes next (the unlock graph of STORY.md / S4's data model). The content may
// bring its own `nextNodes(world)` (shared/story/index.js); this is the default with the same
// meaning, built from the mission fields `requires` (default: the previous mission), `hub`
// (the hideout the mission starts from, null = it chains along the road) and the chapters'
// `arrival` scenes.
//
//   node { kind:'hideout', id, arrival:true, chapter }            an arrival scene is pending
//        { kind:'mission', id, chapter, hub, direct }             an available mission
//        { kind:'epilogue', id:'epilogue' }                        every mission done, ending not seen
//
// Side jobs (`side: true`, JOURNEY.md §2) are never nodes: they wait on the hideout board, optional and
// replayable, and the story goes on without them. After one the crew is back where the story stands
// (resolveNext() of the world), which is the hideout it left from.
//
// Pure functions of the world and the installed content.

import { getMissions, getChapters, getNextNodesOverride, getEpilogue } from './content.js';
import { isCompleted } from './world.js';

function doneOf(world) {
  return (world && world.progress && world.progress.completed) || {};
}

function flagsOf(world) {
  return (world && world.progress && world.progress.flags) || {};
}

/** Is this mission a side job of the hideout board (never part of the story's chain)? */
export function isSideJob(m) {
  return !!(m && m.side === true);
}

/** The story's own missions (the side jobs left out), in campaign order. */
export function mainMissions(missions = getMissions()) {
  return missions.filter((m) => !isSideJob(m));
}

/** The side jobs, in board order. */
export function sideJobs(missions = getMissions()) {
  return missions.filter(isSideJob);
}

/** Is a mission available (not done, every prerequisite done)? */
function requiresMet(world, missions, m) {
  const done = doneOf(world);
  if (Array.isArray(m.requires)) return m.requires.every((r) => done[r]);
  const i = missions.findIndex((q) => q.id === m.id);
  return i <= 0 || !!done[missions[i - 1].id];
}

/**
 * The nodes the crew can go to next (see the header). An arrival scene comes before anything
 * else; then the available missions; then the epilogue; then nothing.
 * @param {object} world
 * @returns {object[]}
 */
export function nextNodes(world) {
  const override = getNextNodesOverride();
  if (override) {
    try {
      return override(world);
    } catch {
      // fall back to the default below
    }
  }
  const missions = mainMissions();
  const done = doneOf(world), flags = flagsOf(world);
  for (const ch of getChapters()) {
    if (!ch.arrival || !Array.isArray(ch.missions) || !ch.missions.length) continue;
    const last = ch.missions[ch.missions.length - 1];
    if (done[last] && !flags[ch.arrival.flag]) return [{ kind: 'hideout', id: ch.arrival.hideout, arrival: true, chapter: ch.n }];
  }
  const avail = missions.filter((m) => !done[m.id] && requiresMet(world, missions, m));
  if (avail.length) {
    return avail.map((m) => ({ kind: 'mission', id: m.id, chapter: m.chapter, hub: m.hub === undefined ? 'roadhouse' : m.hub, direct: m.hub === null }));
  }
  if (missions.length && missions.every((m) => done[m.id])) {
    const ep = getEpilogue();
    return ep.lines && flags[ep.flag] ? [] : ep.lines ? [{ kind: 'epilogue', id: 'epilogue' }] : [];
  }
  return [];
}

/** The arrival scene pending for a hideout: { flag, scene, chapter } or null. */
export function pendingArrival(world, hideoutId) {
  const flags = flagsOf(world);
  for (const ch of getChapters()) {
    if (ch.arrival && ch.arrival.hideout === hideoutId && !flags[ch.arrival.flag]) {
      const last = Array.isArray(ch.missions) && ch.missions.length ? ch.missions[ch.missions.length - 1] : null;
      if (!last || doneOf(world)[last]) return { hideout: hideoutId, flag: ch.arrival.flag, scene: ch.arrival.scene, chapter: ch.n };
    }
  }
  return null;
}

/** True while the ending has not been seen and every mission of the story is done (side jobs never count). */
export function epiloguePending(world) {
  const ep = getEpilogue();
  const missions = mainMissions();
  return !!ep.lines && missions.length > 0 && missions.every((m) => isCompleted(world, m.id)) && !flagsOf(world)[ep.flag];
}

/**
 * Where the crew stands after a mission or at the start of a campaign:
 *   { kind:'hideout', hideout, arrival? , epilogue? }   walk into that hideout (the board lists the missions)
 *   { kind:'briefing', mission }                         a road mission: straight to its briefing
 * @param {object} world
 */
export function resolveNext(world) {
  const nodes = nextNodes(world);
  const first = nodes[0];
  const current = (world && world.hideout && world.hideout.current) || 'roadhouse';
  if (!first) return { kind: 'hideout', hideout: current, done: true };
  if (first.kind === 'hideout') return { kind: 'hideout', hideout: first.id, arrival: true };
  if (first.kind === 'epilogue') return { kind: 'hideout', hideout: current, epilogue: true };
  const withHub = nodes.find((n) => n.kind === 'mission' && n.hub);
  if (withHub) return { kind: 'hideout', hideout: withHub.hub };
  return { kind: 'briefing', mission: first.id };
}
