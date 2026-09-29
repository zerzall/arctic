// Validation of everything a (possibly modified) client can send to the host: names,
// colours, classes, chat and lobby settings. The host applies these; clients never
// trust each other.

import {
  NAME_MAX_LENGTH, CHAT_MAX_LENGTH, PLAYER_COLORS, DIFFICULTY_IDS, DEFAULT_SETTINGS,
} from '../shared/constants.js';
import { CLASS_IDS } from '../shared/classes.js';
import { MAP_LIST } from '../shared/maps.js';
import { MODE_IDS, fixModeCombo } from '../shared/zone.js';
import { WEAPONS } from '../shared/weapons.js';
import { ITEMS } from '../shared/items.js';

const DEFAULT_NAME = 'Survivor';
// Control characters, zero-width/bidi overrides, tag characters and code points that
// render as blank (Hangul fillers, braille blank, soft hyphen ...).
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u2800\u3164\ufeff\uffa0\u{e0000}-\u{e007f}]/gu;
/** More than this many combining marks on one character are dropped (no "Zalgo" towers). */
const MAX_MARKS = 2;
const EXCESS_MARKS = new RegExp(`(\\p{M}{${MAX_MARKS}})\\p{M}+`, 'gu');
/** A name needs at least one letter, digit, symbol or punctuation mark to be visible. */
const VISIBLE = /[\p{L}\p{N}\p{S}\p{P}]/u;
const MAX_WAVES = 999;

/**
 * Clean a display name: no invisible characters, at most MAX_MARKS combining marks per
 * character, collapsed spaces, ≤ NAME_MAX_LENGTH, and something visible left in it.
 * @param {*} name
 * @returns {string}
 */
export function sanitizeName(name) {
  if (typeof name !== 'string') return DEFAULT_NAME;
  const stripped = name.replace(INVISIBLE, '').replace(EXCESS_MARKS, '$1').replace(/\s+/g, ' ').trim();
  const clean = [...stripped].slice(0, NAME_MAX_LENGTH).join('').trim();
  return VISIBLE.test(clean) ? clean : DEFAULT_NAME;
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

/** Longest shop id the host passes on to the sim (the real ones are far shorter). */
const MAX_ITEM_LENGTH = 32;

/**
 * True if `id` names something the shop sells: a gun with a price or an ITEMS entry
 * (own keys only, so 'constructor' / '__proto__' are not items).
 * @param {*} id
 * @returns {boolean}
 */
export function isShopItem(id) {
  if (typeof id !== 'string' || id.length > MAX_ITEM_LENGTH) return false;
  if (Object.hasOwn(ITEMS, id)) return true;
  return Object.hasOwn(WEAPONS, id) && WEAPONS[id].price > 0;
}

/**
 * The per-tab id a client sends in its hello (so the host recognises a player coming
 * back after a reload), or null if `token` is not a well-formed one.
 * @param {*} token
 * @returns {string|null}
 */
export function clientToken(token) {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(token) ? token : null;
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
  const mapPicked = MAP_LIST.some((m) => m.id === patch.mapId);
  const modePicked = MODE_IDS.includes(patch.mode);
  if (mapPicked) out.mapId = patch.mapId;
  if (modePicked) out.mode = patch.mode;
  // A map that doesn't play the mode (Harlan County is Evac Run only): the pick wins, the
  // other setting follows it.
  const fixed = fixModeCombo(out.mapId, out.mode, modePicked && !mapPicked ? 'mode' : 'map');
  out.mapId = fixed.mapId;
  out.mode = fixed.mode;
  if (DIFFICULTY_IDS.includes(patch.difficulty)) out.difficulty = patch.difficulty;
  if (Number.isInteger(patch.waves) && patch.waves >= 0 && patch.waves <= MAX_WAVES) out.waves = patch.waves;
  if (typeof patch.objective === 'boolean') out.objective = patch.objective;
  if (typeof patch.friendlyFire === 'boolean') out.friendlyFire = patch.friendlyFire;
  return out;
}

/**
 * Token bucket: `burst` messages at once, then one every `every` seconds. Used for chat
 * lines and, with a bigger bucket, for every control message a peer sends.
 */
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
