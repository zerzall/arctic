// Where the game finds a mission script by its id. shared/story/missions.js (the fifteen
// real missions) registers itself here with registerMissions(MISSIONS); tests and tools
// register their own. The sim and the map builder resolve `settings.story.nodeId` through
// getMission(), so host and clients agree on a mission without the script travelling on the
// wire.

const REG = new Map();

/** Register (or replace) mission scripts by their `id`. */
export function registerMissions(list) {
  for (const m of list || []) if (m && typeof m.id === 'string') REG.set(m.id, m);
}

/** The mission with this id, or null. */
export function getMission(id) {
  return REG.get(id) || null;
}

/** Every registered mission (registration order). */
export function allMissions() {
  return [...REG.values()];
}

/** Forget every registered mission (tests). */
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
