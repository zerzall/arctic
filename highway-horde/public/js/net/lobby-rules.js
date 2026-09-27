// Validation of everything a (possibly modified) client can send to the host: names,
// colours, classes, chat and lobby settings. The host applies these; clients never
// trust each other.

import {
  NAME_MAX_LENGTH, CHAT_MAX_LENGTH, PLAYER_COLORS, DIFFICULTY_IDS, DEFAULT_SETTINGS,
} from '../shared/constants.js';
import { CLASS_IDS } from '../shared/classes.js';
import { MAP_LIST } from '../shared/maps.js';

const DEFAULT_NAME = 'Survivor';
// Control characters, zero-width/bidi overrides and other invisible troublemakers.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g;
const MAX_WAVES = 999;

/**
 * Clean a display name: no invisible characters, collapsed spaces, ≤ NAME_MAX_LENGTH.
 * @param {*} name
 * @returns {string}
 */
export function sanitizeName(name) {
  if (typeof name !== 'string') return DEFAULT_NAME;
  const clean = [...name.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim()].slice(0, NAME_MAX_LENGTH).join('').trim();
  return clean || DEFAULT_NAME;
}

/**
 * Make `name` unique among `taken` (case-insensitive) by appending " 2", " 3", ...
 * @param {string} name already sanitised
 * @param {string[]} taken names of the other players
 * @returns {string}
 */
export function uniqueName(name, taken) {
  const lower = new Set(taken.map((n) => n.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  for (let n = 2; n < 100; n++) {
    const suffix = ` ${n}`;
    const base = [...name].slice(0, NAME_MAX_LENGTH - suffix.length).join('').trimEnd();
    const candidate = base + suffix;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
  return name;
}

/** True if `c` is a valid colour index. */
export function isColor(c) {
  return Number.isInteger(c) && c >= 0 && c < PLAYER_COLORS.length;
}

/**
 * The colour a joining player gets: their choice if free, else the first free one,
 * else their choice anyway (more players than colours cannot happen with 6 + 6).
 * @param {*} wanted
 * @param {number[]} taken colours of the other players
 * @returns {number}
 */
export function pickColor(wanted, taken) {
  const want = isColor(wanted) ? wanted : 0;
  if (!taken.includes(want)) return want;
  for (let c = 0; c < PLAYER_COLORS.length; c++) if (!taken.includes(c)) return c;
  return want;
}

/** A valid class id (unknown → the first class). */
export function sanitizeClass(cls) {
  return CLASS_IDS.includes(cls) ? cls : CLASS_IDS[0];
}

/** Names for AI survivors (fictional characters and call signs, never real people). */
export const BOT_NAMES = [
  'Ripley', 'Hicks', 'Vasquez', 'Tank-Girl', 'Chopper', 'Hudson', 'Bishop', 'Newt', 'Apone', 'Frost',
  'Dutch', 'Buckshot', 'Dozer', 'Scrapper', 'Ironside', 'Maverick',
];
/** Classes a bot picks, in order of preference (a medic first: bots revive a lot). */
export const BOT_CLASS_ORDER = ['medic', 'soldier', 'engineer', 'heavy', 'scout', 'demo'];

/**
 * Profile for a new AI survivor joining `roster`: a name nobody uses, a free colour and
 * preferably a class nobody has picked yet (else the least-picked one).
 * @param {object[]} roster current roster entries ({ name, color, cls })
 * @returns {{ name: string, color: number, cls: string }}
 */
export function botProfile(roster) {
  const names = roster.map((r) => r.name);
  const lower = new Set(names.map((n) => n.toLowerCase()));
  const free = BOT_NAMES.find((n) => !lower.has(n.toLowerCase()));
  const name = free || uniqueName('Bot', names);
  const color = pickColor(0, roster.map((r) => r.color));
  let cls = BOT_CLASS_ORDER[0], fewest = Infinity;
  for (const c of BOT_CLASS_ORDER) {
    const n = roster.filter((r) => r.cls === c).length;
    if (n < fewest) {
      fewest = n;
      cls = c;
    }
  }
  return { name, color, cls };
}

/**
 * Clean a chat line.
 * @param {*} text
 * @returns {string|null} null if nothing is left to send
 */
export function sanitizeChat(text) {
  if (typeof text !== 'string') return null;
  const clean = [...text.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim()].slice(0, CHAT_MAX_LENGTH).join('').trim();
  return clean || null;
}

/**
 * Merge a settings patch into the current lobby settings, ignoring invalid values.
 * @param {object} current
 * @param {object} patch
 * @returns {object} new settings object
 */
export function mergeSettings(current, patch) {
  const out = { ...DEFAULT_SETTINGS, ...current };
  if (!patch || typeof patch !== 'object') return out;
  if (MAP_LIST.some((m) => m.id === patch.mapId)) out.mapId = patch.mapId;
  if (DIFFICULTY_IDS.includes(patch.difficulty)) out.difficulty = patch.difficulty;
  if (Number.isInteger(patch.waves) && patch.waves >= 0 && patch.waves <= MAX_WAVES) out.waves = patch.waves;
  if (typeof patch.objective === 'boolean') out.objective = patch.objective;
  if (typeof patch.friendlyFire === 'boolean') out.friendlyFire = patch.friendlyFire;
  return out;
}

/** Token bucket for chat: `burst` messages at once, then one every `every` seconds. */
export class ChatLimiter {
  constructor(burst = 4, every = 1.5) {
    this.burst = burst;
    this.every = every;
    this.tokens = burst;
    this.last = null;
  }

  /** @param {number} now seconds @returns {boolean} true if a message may be sent */
  take(now) {
    if (this.last !== null) this.tokens = Math.min(this.burst, this.tokens + (now - this.last) / this.every);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
