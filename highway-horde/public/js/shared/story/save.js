// Saving (STORY.md §3): the profile and the campaign worlds live in this browser's
// localStorage, and can be exported to / imported from a JSON file.
//
//   highway-horde:story:profile:v1   this browser's player Profile
//   highway-horde:story:worlds:v1    { [worldId]: World } every campaign this browser has played
//
// Every storage access is wrapped in try/catch and every function takes the storage as an
// optional last argument (default `globalThis.localStorage`), so private windows, blocked
// storage and full quotas degrade to "nothing saved" and Node tests can inject a fake.
// Loaded data always goes through the sanitisers: storage may hold something an older build
// wrote or a player edited by hand. This module never touches the DOM (the download itself
// is in ui/story-screen.js).

import { sanitizeProfile, PROFILE_VERSION } from './profile.js';
import { sanitizeWorld, pickHighest, WORLD_VERSION } from './world.js';

export const PROFILE_KEY = 'highway-horde:story:profile:v1';
export const WORLDS_KEY = 'highway-horde:story:worlds:v1';
/** `format` marker of exported files. */
export const FILE_FORMAT = 'highway-horde-save';
/** Version of the export file layout. */
export const FILE_VERSION = 1;
/** Largest file the importer reads. */
export const MAX_IMPORT_BYTES = 512 * 1024;
/** Worlds a browser keeps (the oldest untouched ones fall off the list). */
export const MAX_WORLDS = 12;

function store(storage) {
  try {
    return storage || globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function readJson(key, storage) {
  try {
    const s = store(storage);
    const raw = s && s.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key, value, storage) {
  try {
    const s = store(storage);
    if (!s) return false;
    s.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- migrations

/**
 * Bring a stored/imported profile of any known version up to PROFILE_VERSION. Version 0 is
 * the shape of the earliest prototypes: `perks` as an array of ids (one rank each),
 * `weapons` as an array of ids and `loadout` as a plain array or missing. Unknown newer
 * versions are passed through (the sanitiser drops what it does not know).
 * @param {*} raw
 * @returns {*} an object the profile sanitiser accepts
 */
export function migrateProfile(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  let p = raw;
  const v = Number(p.v) || 0;
  if (v < 1) {
    p = { ...p, v: 1 };
    if (Array.isArray(p.perks)) {
      const perks = {};
      for (const id of p.perks) if (typeof id === 'string') perks[id] = Math.min(3, (perks[id] || 0) + 1);
      p.perks = perks;
    }
    if (Array.isArray(p.weapons)) {
      const weapons = {};
      for (const id of p.weapons) if (typeof id === 'string') weapons[id] = { tier: 0 };
      p.weapons = weapons;
    }
    if (typeof p.scrap !== 'number' && typeof p.parts === 'number') p.scrap = p.parts;
    if (typeof p.name !== 'string' && typeof p.callsign === 'string') p.name = p.callsign;
  }
  return p;
}

/**
 * Bring a stored/imported world up to WORLD_VERSION. Version 0: `chapter` and `missions`
 * (a list of finished mission ids) instead of `progress`, `upgrades` at the top level.
 */
export function migrateWorld(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  let w = raw;
  const v = Number(w.v) || 0;
  if (v < 1) {
    w = { ...w, v: 1 };
    if (!w.progress && Array.isArray(w.missions)) {
      const completed = {};
      for (const id of w.missions) if (typeof id === 'string') completed[id] = { stars: 1, time: 0 };
      w.progress = { node: 'hideout:roadhouse', completed, flags: w.flags && typeof w.flags === 'object' ? w.flags : {} };
    }
    if (!w.hideout && w.upgrades && typeof w.upgrades === 'object') {
      w.hideout = { current: 'roadhouse', upgrades: w.upgrades, recruited: {}, stash: w.stash || {} };
    }
    if (typeof w.rev !== 'number') w.rev = 0;
  }
  return w;
}

// ---------------------------------------------------------------- profile

/**
 * The stored profile, sanitised and migrated; null when there is none.
 * @param {Storage} [storage]
 * @returns {object|null}
 */
export function loadProfile(storage) {
  const raw = readJson(PROFILE_KEY, storage);
  if (!raw) return null;
  return sanitizeProfile(migrateProfile(raw)).profile;
}

/**
 * Store the profile.
 * @returns {boolean} whether it was written
 */
export function saveProfile(profile, storage) {
  if (!profile || profile.v !== PROFILE_VERSION) return false;
  return writeJson(PROFILE_KEY, profile, storage);
}

/** Forget the stored profile. */
export function clearProfile(storage) {
  try {
    const s = store(storage);
    if (s) s.removeItem(PROFILE_KEY);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- worlds

/**
 * Every stored world by id (sanitised and migrated; broken entries are skipped).
 * @returns {Record<string, object>}
 */
export function loadWorlds(storage) {
  const raw = readJson(WORLDS_KEY, storage);
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const id of Object.keys(raw)) {
    const { world } = sanitizeWorld(migrateWorld(raw[id]));
    if (world && world.id === id) out[id] = world;
  }
  return out;
}

/** Worlds as a list, the most recently played first. */
export function listWorlds(storage) {
  return Object.values(loadWorlds(storage)).sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Store a world copy, keeping the higher revision when this browser already has one
 * (a stale copy never overwrites a newer one). Keeps at most MAX_WORLDS worlds.
 * @returns {{ saved: boolean, world: object }} `world` is the copy that is stored now
 */
export function saveWorld(world, storage) {
  const all = loadWorlds(storage);
  const best = pickHighest(all[world.id] || null, world);
  const changed = !all[world.id] || best !== all[world.id];
  if (!changed) return { saved: false, world: all[world.id] };
  all[world.id] = best;
  const ids = Object.keys(all);
  if (ids.length > MAX_WORLDS) {
    ids.sort((a, b) => all[a].updatedAt - all[b].updatedAt);
    for (const id of ids.slice(0, ids.length - MAX_WORLDS)) if (id !== world.id) delete all[id];
  }
  return { saved: writeJson(WORLDS_KEY, all, storage), world: best };
}

/** Remove a world from this browser. */
export function deleteWorld(id, storage) {
  const all = loadWorlds(storage);
  if (!Object.hasOwn(all, id)) return false;
  delete all[id];
  return writeJson(WORLDS_KEY, all, storage);
}

// ---------------------------------------------------------------- export / import

/**
 * The text of an export file.
 * @param {{ profile?: object|null, worlds?: object[], now?: number }} args
 * @returns {string} pretty JSON
 */
export function exportSave({ profile = null, worlds = [], now = Date.now() } = {}) {
  const file = {
    format: FILE_FORMAT,
    fileVersion: FILE_VERSION,
    exportedAt: now,
    profile: profile || null,
    worlds: {},
  };
  for (const w of worlds) if (w && w.id) file.worlds[w.id] = w;
  return JSON.stringify(file, null, 2);
}

/** A file name for an export: `road-to-haven-<name>-<yyyymmdd>.json`. */
export function exportFileName(name, now = Date.now()) {
  const slug = String(name || 'save').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'save';
  const d = new Date(now);
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `road-to-haven-${slug}-${ymd}.json`;
}

/**
 * Read an export file. Validates everything; on success returns the sanitised profile
 * and/or worlds, never partial garbage.
 * @param {string} text the file contents
 * @returns {{ ok: true, profile: object|null, worlds: object[], notes: string[] } | { ok: false, error: string }}
 */
export function parseSave(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'The file is empty.' };
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, error: 'That file is too big to be a save.' };
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That is not a save file (not valid JSON).' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'That is not a save file.' };
  const notes = [];
  let profile = null;
  const worlds = [];
  // Also accept a bare profile or world (a hand-made file)
  const looksLikeFile = data.format === FILE_FORMAT;
  if (!looksLikeFile && !(data.profile || data.worlds) && typeof data.id === 'string') {
    if (data.progress || data.hideout || data.missions) data.worlds = { [data.id]: data };
    else data.profile = data;
  } else if (!looksLikeFile && !data.profile && !data.worlds) {
    return { ok: false, error: 'That is not a Highway Horde save.' };
  }
  if (Number(data.fileVersion) > FILE_VERSION) notes.push('saved by a newer version of the game');
  if (data.profile) {
    const res = sanitizeProfile(migrateProfile(data.profile));
    if (res.profile) {
      profile = res.profile;
      for (const n of res.notes) notes.push(`profile: ${n}`);
    } else {
      notes.push('profile could not be read');
    }
  }
  const raw = data.worlds && typeof data.worlds === 'object' ? data.worlds : {};
  for (const id of Object.keys(raw).slice(0, MAX_WORLDS)) {
    const res = sanitizeWorld(migrateWorld(raw[id]));
    if (res.world) {
      worlds.push(res.world);
      for (const n of res.notes) notes.push(`world ${res.world.name}: ${n}`);
    } else {
      notes.push('a world could not be read');
    }
  }
  if (!profile && !worlds.length) return { ok: false, error: 'Nothing in that file could be read as a save.' };
  return { ok: true, profile, worlds, notes };
}

/**
 * Import parsed data into storage. A world is merged by revision (the higher wins); the
 * profile replaces the stored one only when `replaceProfile` says so or none is stored, or
 * when it is the same survivor with more progress.
 * @param {{ profile: object|null, worlds: object[] }} parsed the result of parseSave()
 * @param {{ replaceProfile?: boolean }} [opts]
 * @param {Storage} [storage]
 * @returns {{ profile: object|null, profileReplaced: boolean, worlds: object[], newer: number, kept: number }}
 */
export function importParsed(parsed, opts = {}, storage) {
  let profile = loadProfile(storage);
  let replaced = false;
  const incoming = parsed.profile;
  if (incoming) {
    const same = profile && profile.id === incoming.id;
    if (!profile || opts.replaceProfile || (same && (incoming.xp > profile.xp || incoming.updatedAt > profile.updatedAt))) {
      if (saveProfile(incoming, storage)) {
        profile = incoming;
        replaced = true;
      }
    }
  }
  let newer = 0, kept = 0;
  const saved = [];
  for (const w of parsed.worlds || []) {
    const before = loadWorlds(storage)[w.id];
    const res = saveWorld(w, storage);
    if (!before || pickHighest(before, w) === w) newer++;
    else kept++;
    saved.push(res.world);
  }
  return { profile, profileReplaced: replaced, worlds: saved, newer, kept };
}

/** Both format versions, for tools/tests. */
export const VERSIONS = { profile: PROFILE_VERSION, world: WORLD_VERSION, file: FILE_VERSION };
