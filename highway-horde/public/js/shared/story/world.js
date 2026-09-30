// The World (STORY.md §3): one crew's campaign. Every participant keeps a copy; the host
// broadcasts it after each change and `rev` grows with every change, so whoever hosts the
// campaign later takes the highest-`rev` copy it has and the campaign survives its
// original host leaving.
//
//   World = { v:1, id, name, rev, createdAt, updatedAt, difficulty, day,
//     progress:{ node, completed:{[missionId]:{stars,time}}, flags:{[k]:true} },
//     hideout:{ current, upgrades:{[id]:tier}, recruited:{[npcId]:true}, stash:{ scrap, parts, medkit, ammo, frag ... } },
//     members:{[profileId]:{ name, lastSeen }}, settings:{ daylight } }
//
// `settings` are the crew's campaign options (JOURNEY.md §2.1): `daylight` = every mission and side
// job plays by day, whatever its script says (shared/story/daylight.js). Worlds saved before the
// option existed read as all options off.
//
// `progress.node` is always 'hideout:<id>' in a saved world: a mission in progress is not
// saved (leaving mid-mission keeps everyone's profile and the crew resumes at the hideout).
// Pure functions; nothing here touches storage or the network.

import { DIFFICULTY_IDS } from '../constants.js';
import { newId, isId, cleanText } from './profile.js';
import { HIDEOUT_IDS, HIDEOUT_TIERS, KIT_IDS } from './upgrades.js';
import { FIRST_HIDEOUT, START_DAY, chapterTitle } from './content.js';

/** World format version (see save.js for migrations). */
export const WORLD_VERSION = 1;
/** Longest campaign name. */
export const WORLD_NAME_MAX = 24;
/** Limits that keep the JSON small (it travels to every player after each change). */
export const MAX_FLAGS = 120;
export const MAX_COMPLETED = 64;
export const MAX_RECRUITED = 32;
export const MAX_MEMBERS = 32;
export const MAX_STASH = 9999;
/** The hideouts a world may be in. */
export const HIDEOUT_MAP_IDS = ['roadhouse', 'depot', 'farmstead'];
/** What the stash holds besides supplies. */
export const STASH_KEYS = ['scrap', 'parts', 'medkit', 'ammo', ...KIT_IDS];

const FLAG_RE = /^[a-z][A-Za-z0-9_.:-]{0,39}$/;
const MISSION_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,23}$/;
const NPC_RE = /^[a-z][a-z0-9_]{0,23}$/;

function int(v, lo, hi, fallback = lo) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

/** The campaign options a world may carry, with their defaults. */
export const WORLD_SETTINGS = Object.freeze({ daylight: false });

/** Clean campaign options: known keys only, booleans. */
export function cleanWorldSettings(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const k of Object.keys(WORLD_SETTINGS)) out[k] = typeof src[k] === 'boolean' ? src[k] : WORLD_SETTINGS[k];
  return out;
}

/** True when the crew chose "Daylight only": every mission plays by day. */
export function isDaylightOnly(world) {
  return !!(world && world.settings && world.settings.daylight === true);
}

/** The stash a new campaign starts with. */
export function startingStash() {
  return { scrap: 40, parts: 0, medkit: 2, ammo: 0, frag: 4, molotov: 2, armor: 2, barricade: 2, turret: 0, selfrevive: 0 };
}

/**
 * A new campaign.
 * @param {{ name?: string, difficulty?: string, profile?: object, now?: number, id?: string, daylight?: boolean }} [opts]
 */
export function createWorld(opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const world = {
    v: WORLD_VERSION,
    id: isId(opts.id) ? opts.id : newId(),
    name: cleanText(opts.name, WORLD_NAME_MAX, 'The Crew'),
    rev: 0,
    createdAt: now,
    updatedAt: now,
    difficulty: DIFFICULTY_IDS.includes(opts.difficulty) ? opts.difficulty : 'normal',
    day: START_DAY,
    progress: { node: `hideout:${FIRST_HIDEOUT}`, completed: {}, flags: {} },
    hideout: { current: FIRST_HIDEOUT, upgrades: {}, recruited: {}, stash: startingStash() },
    members: {},
    settings: cleanWorldSettings({ daylight: opts.daylight === true }),
  };
  if (opts.profile) world.members[opts.profile.id] = { name: cleanText(opts.profile.name), lastSeen: now };
  return world;
}

/**
 * Check and repair a world from storage, an import or the host. Never throws.
 * @param {*} raw
 * @param {{ now?: number }} [opts]
 * @returns {{ world: object|null, notes: string[] }} world is null when `raw` is unusable
 */
export function sanitizeWorld(raw, opts = {}) {
  const notes = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { world: null, notes: ['not a world'] };
  if (!isId(raw.id)) return { world: null, notes: ['world has no valid id'] };
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();

  const completed = {};
  const rc = raw.progress && raw.progress.completed && typeof raw.progress.completed === 'object' ? raw.progress.completed : {};
  for (const id of Object.keys(rc)) {
    if (Object.keys(completed).length >= MAX_COMPLETED) break;
    if (!MISSION_RE.test(id)) continue;
    const c = rc[id];
    completed[id] = { stars: int(c && c.stars, 1, 3, 1), time: int(c && c.time, 0, 99999, 0) };
  }
  const flags = {};
  const rf = raw.progress && raw.progress.flags && typeof raw.progress.flags === 'object' ? raw.progress.flags : {};
  for (const k of Object.keys(rf)) {
    if (Object.keys(flags).length >= MAX_FLAGS) {
      notes.push('flags capped');
      break;
    }
    if (FLAG_RE.test(k) && rf[k]) flags[k] = true;
  }

  const rh = raw.hideout && typeof raw.hideout === 'object' ? raw.hideout : {};
  const current = HIDEOUT_MAP_IDS.includes(rh.current) ? rh.current : (rh.current !== undefined && notes.push('hideout reset'), FIRST_HIDEOUT);
  const upgrades = {};
  if (rh.upgrades && typeof rh.upgrades === 'object') {
    for (const id of HIDEOUT_IDS) {
      const t = int(rh.upgrades[id], 0, HIDEOUT_TIERS, 0);
      if (t > 0) upgrades[id] = t;
    }
  }
  const recruited = {};
  if (rh.recruited && typeof rh.recruited === 'object') {
    for (const k of Object.keys(rh.recruited)) {
      if (Object.keys(recruited).length >= MAX_RECRUITED) break;
      if (NPC_RE.test(k) && rh.recruited[k]) recruited[k] = true;
    }
  }
  const stash = {};
  const rs = rh.stash && typeof rh.stash === 'object' ? rh.stash : {};
  for (const k of STASH_KEYS) stash[k] = int(rs[k], 0, MAX_STASH, 0);

  const members = {};
  if (raw.members && typeof raw.members === 'object') {
    for (const pid of Object.keys(raw.members)) {
      if (Object.keys(members).length >= MAX_MEMBERS) break;
      if (!isId(pid)) continue;
      const m = raw.members[pid];
      members[pid] = { name: cleanText(m && m.name), lastSeen: Number.isFinite(m && m.lastSeen) ? m.lastSeen : now };
    }
  }

  const world = {
    v: WORLD_VERSION,
    id: raw.id,
    name: cleanText(raw.name, WORLD_NAME_MAX, 'The Crew'),
    rev: int(raw.rev, 0, 1e9, 0),
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : now,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : now,
    difficulty: DIFFICULTY_IDS.includes(raw.difficulty) ? raw.difficulty : 'normal',
    day: int(raw.day, START_DAY, 999, START_DAY),
    progress: { node: `hideout:${current}`, completed, flags },
    hideout: { current, upgrades, recruited, stash },
    members,
    settings: cleanWorldSettings(raw.settings),
  };
  return { world, notes };
}

/** Whether `raw` is already a clean world. */
export function validateWorld(raw) {
  const { world, notes } = sanitizeWorld(raw);
  if (!world) return { ok: false, notes };
  if (raw.v !== WORLD_VERSION) notes.push('unknown version');
  return { ok: notes.length === 0, notes };
}

/**
 * Change a world: `edit` gets a deep copy to modify, the result has `rev` + 1 and a new
 * `updatedAt`. The input is not modified.
 * @param {object} world
 * @param {(draft: object) => void} edit
 * @param {number} [now]
 */
export function changeWorld(world, edit, now = Date.now()) {
  const draft = JSON.parse(JSON.stringify(world));
  edit(draft);
  draft.rev = world.rev + 1;
  draft.updatedAt = Math.max(now, world.updatedAt);
  draft.progress.node = `hideout:${draft.hideout.current}`;
  return draft;
}

/**
 * Which of two copies of the same world wins: the higher `rev`, then the later
 * `updatedAt`, then `a`. Copies of different worlds return `a`.
 * @param {object|null} a
 * @param {object|null} b
 */
export function pickHighest(a, b) {
  if (!a) return b || null;
  if (!b || a.id !== b.id) return a;
  if (b.rev !== a.rev) return b.rev > a.rev ? b : a;
  return b.updatedAt > a.updatedAt ? b : a;
}

/**
 * Record a player as a member of the campaign (or refresh their name and last-seen).
 * @returns {object} the world with rev + 1
 */
export function touchMember(world, profile, now = Date.now()) {
  return changeWorld(world, (w) => addMember(w, profile, now), now);
}

/**
 * Record a member inside a `changeWorld` edit (no revision bump of its own).
 * @param {object} draft the world being edited
 * @param {{ id: string, name: string }} profile
 * @param {number} now
 */
export function addMember(draft, profile, now = Date.now()) {
  if (!isId(profile.id)) return;
  if (!draft.members[profile.id] && Object.keys(draft.members).length >= MAX_MEMBERS) return;
  draft.members[profile.id] = { name: cleanText(profile.name), lastSeen: now };
}

/** Is this profile a member of the campaign? */
export function isMember(world, profileId) {
  return !!(world && world.members && Object.hasOwn(world.members, profileId));
}

// ---------------------------------------------------------------- progress

/** Was a mission finished (at least once)? */
export function isCompleted(world, missionId) {
  return Object.hasOwn(world.progress.completed, missionId);
}

/**
 * Where a mission stands: 'done', 'available' (its predecessor is done) or 'locked'.
 * A mission may name `requires: [ids]` to override the default chain (every earlier
 * mission of the same chapter, and the previous chapter's last mission).
 * @param {object} world
 * @param {object[]} missions in campaign order
 * @param {object} m the mission
 */
export function missionStatus(world, missions, m) {
  if (isCompleted(world, m.id)) return 'done';
  if (Array.isArray(m.requires)) return m.requires.every((id) => isCompleted(world, id)) ? 'available' : 'locked';
  const i = missions.findIndex((q) => q.id === m.id);
  if (i <= 0) return 'available';
  const prev = missions[i - 1];
  return isCompleted(world, prev.id) ? 'available' : 'locked';
}

/**
 * Every mission with its status and stars.
 * @returns {{ mission: object, status: 'done'|'available'|'locked', stars: number }[]}
 */
export function missionBoard(world, missions) {
  return missions.map((mission) => {
    const status = missionStatus(world, missions, mission);
    return { mission, status, stars: status === 'done' ? world.progress.completed[mission.id].stars : 0 };
  });
}

/** The missions the crew may start now (finished ones can be replayed). */
export function availableMissions(world, missions) {
  return missionBoard(world, missions).filter((e) => e.status !== 'locked').map((e) => e.mission);
}

/** The first mission not finished yet, or null when the campaign is complete. */
export function nextMission(world, missions) {
  return missions.find((m) => !isCompleted(world, m.id)) || null;
}

/** The chapter the crew is in: that of the next unfinished mission (the last one when done). */
export function currentChapter(world, missions) {
  const next = nextMission(world, missions);
  if (next) return next.chapter;
  return missions.length ? missions[missions.length - 1].chapter : 1;
}

/** True when every mission of `chapter` is finished. */
export function chapterDone(world, missions, chapter) {
  const list = missions.filter((m) => m.chapter === chapter);
  return list.length > 0 && list.every((m) => isCompleted(world, m.id));
}

/** True when every mission is finished. */
export function campaignDone(world, missions) {
  return missions.length > 0 && missions.every((m) => isCompleted(world, m.id));
}

/**
 * A short summary of a world for the menus.
 * @param {object} world
 * @param {object[]} missions
 */
export function worldSummary(world, missions) {
  const done = missions.filter((m) => isCompleted(world, m.id));
  const stars = done.reduce((a, m) => a + world.progress.completed[m.id].stars, 0);
  const next = nextMission(world, missions);
  const chapter = currentChapter(world, missions);
  return {
    id: world.id,
    name: world.name,
    difficulty: world.difficulty,
    rev: world.rev,
    chapter,
    chapterTitle: chapterTitle(chapter),
    missionsDone: done.length,
    missionsTotal: missions.length,
    stars,
    starsTotal: missions.length * 3,
    hideout: world.hideout.current,
    next,
    complete: campaignDone(world, missions),
    members: Object.values(world.members).map((m) => m.name),
    updatedAt: world.updatedAt,
  };
}
