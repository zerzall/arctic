// Where the game finds a mission script by its id. The fifteen written missions
// (shared/story/missions.js, agent S4) are always there; tests and tools register their own with
// registerMissions(). The sim and the map builder resolve `settings.story.nodeId` through
// getMission(), so host and clients agree on a mission without the script travelling on the wire.

import { MISSIONS } from './missions.js';
import { getMission as installedMission } from './content.js';

const WRITTEN = new Map(MISSIONS.map((m) => [m.id, m]));
const REG = new Map();

/** Register (or replace) mission scripts by their `id`. */
export function registerMissions(list) {
  for (const m of list || []) if (m && typeof m.id === 'string') REG.set(m.id, m);
}

/**
 * The mission with this id, or null: a registered one first, then the story content the session
 * installed (content.js: the written campaign in the game, a stand-in in tests and tools, so the sim
 * always plays the very mission the session briefed), then the written campaign.
 */
export function getMission(id) {
  return REG.get(id) || installedMission(id) || WRITTEN.get(id) || null;
}

/** Every mission the game knows: the written campaign, then the registered ones. */
export function allMissions() {
  const out = new Map(WRITTEN);
  for (const [id, m] of REG) out.set(id, m);
  return [...out.values()];
}

/** Forget the missions registered with registerMissions() (tests); the written campaign stays. */
export function clearMissions() {
  REG.clear();
}

/**
 * The mission script a game's `settings` ask for: `settings.story.mission` (the script itself,
 * tests and tools) or the registered mission `settings.story.nodeId`. Null when neither.
 */
export function missionOf(settings) {
  const st = settings && settings.story;
  if (!st || typeof st !== 'object') return null;
  if (st.mission && typeof st.mission === 'object') return st.mission;
  const id = st.nodeId || st.missionId;
  return typeof id === 'string' ? getMission(id) : null;
}

/**
 * The sim mode the mission runs on: 'defend' | 'zone' | 'campaign' | 'free'. `story.simMode`
 * (set by the session) wins over the mission's own `mode`.
 */
export function simModeOf(settings) {
  const st = settings && settings.story;
  if (!st) return 'free';
  const mode = st.simMode || (missionOf(settings) || {}).mode;
  return mode === 'defend' || mode === 'zone' || mode === 'campaign' ? mode : 'free';
}

/** The options for buildMap(id, seed, opts) of a game with these settings (host, clients, tools agree). */
export function mapBuildOptions(settings) {
  const mode = settings ? settings.mode : undefined;
  if (mode === 'mission') return { mode: simModeOf(settings) === 'campaign' ? 'campaign' : 'mission' };
  return { mode };
}
