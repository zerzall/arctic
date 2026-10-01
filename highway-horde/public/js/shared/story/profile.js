// The player's Profile (STORY.md §3): level, XP, perks, scrap, weapons and loadout. Lives in
// each player's own browser; a joining player sends theirs in the handshake and the host
// sanity-checks it here (level <= 20, XP/perk points/scrap consistent with the level, tiers
// <= 5, guns that exist, loadout made of owned guns) before it plays a single tick.
//
//   Profile = { v:1, id, name, xp, level, perkPoints, perks:{[perkId]:rank}, scrap,
//     weapons:{[weaponId]:{tier}}, loadout:[weaponId, weaponId|null, weaponId|null], cls, color,
//     stats:{kills, missions, deaths, revives, playtime}, cosmetics:{}, kit:{[item]:n},
//     perkReset:chapter, updatedAt }
//
// (`kit` = supplies taken from the stash for the next mission and `perkReset` = the chapter
// in which the free perk reset was used last are S1 additions to the contract.)
// All functions are pure; nothing here touches storage or the network.

import { CLASSES, CLASS_IDS } from '../classes.js';
import { WEAPONS } from '../weapons.js';
import { PLAYER_COLORS, NAME_MAX_LENGTH } from '../constants.js';
import { MAX_LEVEL, MAX_XP, levelForXp } from './progression.js';
import { PERK_IDS, MAX_RANK, RANK_LEVELS, perkPointsSpent, totalPerkPoints } from './perks.js';
import {
  KIT_ITEMS, KIT_IDS, MAX_TIER, clampTier, isWeaponKnown, tierSpent,
} from './upgrades.js';

/** Profile format version (see save.js for migrations). */
export const PROFILE_VERSION = 1;
/** Hard cap on carried scrap. */
export const MAX_SCRAP = 99999;
/** Longest counter kept in `stats`. */
const MAX_STAT = 99999999;

/**
 * The most scrap (unspent + sunk into weapon tiers) a survivor of `level` can plausibly
 * own; the host trims a joiner's profile to this.
 * @param {number} level
 */
export function scrapBudget(level) {
  return 300 + 450 * Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(level) || 1)));
}

/** A fresh random id (uuid-like, 32 hex characters). */
export function newId() {
  const bytes = new Uint8Array(16);
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** True for a well-formed profile/world id. */
export function isId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

// Control characters, zero-width/bidi overrides and other blank code points.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯⠀ㅤ﻿ﾠ\u{e0000}-\u{e007f}]/gu;
const VISIBLE = /[\p{L}\p{N}\p{S}\p{P}]/u;

/**
 * Clean a display string: no invisible characters, collapsed spaces, at most `max`
 * characters, something visible left in it.
 * @param {*} text
 * @param {number} max
 * @param {string} fallback
 */
export function cleanText(text, max = NAME_MAX_LENGTH, fallback = 'Survivor') {
  if (typeof text !== 'string') return fallback;
  const clean = [...text.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim()].slice(0, max).join('').trim();
  return VISIBLE.test(clean) ? clean : fallback;
}

function int(v, lo, hi, fallback = lo) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

/** The gun a class starts with. */
export function classWeapon(cls) {
  const c = CLASSES[cls] || CLASSES.soldier;
  return c.startWeapon && WEAPONS[c.startWeapon] ? c.startWeapon : 'pistol';
}

/** The default loadout of a class: pistol in slot 0, the class weapon in slot 1. */
export function defaultLoadout(cls) {
  const cw = classWeapon(cls);
  return ['pistol', cw !== 'pistol' ? cw : null, null];
}

/**
 * A brand-new level-1 profile.
 * @param {{ name?: string, cls?: string, color?: number, id?: string, now?: number }} [opts]
 */
export function createProfile(opts = {}) {
  const cls = CLASS_IDS.includes(opts.cls) ? opts.cls : CLASS_IDS[0];
  const weapons = { pistol: { tier: 0 } };
  const cw = classWeapon(cls);
  weapons[cw] = { tier: 0 };
  return {
    v: PROFILE_VERSION,
    id: isId(opts.id) ? opts.id : newId(),
    name: cleanText(opts.name),
    xp: 0,
    level: 1,
    perkPoints: 0,
    perks: {},
    scrap: 0,
    weapons,
    loadout: defaultLoadout(cls),
    cls,
    color: int(opts.color, 0, PLAYER_COLORS.length - 1, 0),
    stats: { kills: 0, missions: 0, deaths: 0, revives: 0, playtime: 0 },
    cosmetics: {},
    kit: {},
    perkReset: 0,
    updatedAt: Number.isFinite(opts.now) ? opts.now : Date.now(),
  };
}

/**
 * Check and repair anything that arrives as a profile: from localStorage, an imported file
 * or a joining player. Never throws. With `strict` (a joiner) the scrap is also trimmed to
 * what the level can plausibly have earned.
 * @param {*} raw
 * @param {{ strict?: boolean, now?: number }} [opts]
 * @returns {{ profile: object|null, notes: string[] }} profile is null only when `raw` is
 *   not an object; notes list every repair that was made
 */
export function sanitizeProfile(raw, opts = {}) {
  const notes = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { profile: null, notes: ['not a profile'] };
  const note = (s) => notes.push(s);

  const id = isId(raw.id) ? raw.id : (note('id replaced'), newId());
  const cls = CLASS_IDS.includes(raw.cls) ? raw.cls : (raw.cls !== undefined && note('class reset'), CLASS_IDS[0]);
  const color = Number.isInteger(raw.color) && raw.color >= 0 && raw.color < PLAYER_COLORS.length ? raw.color : 0;

  // XP is the truth; the level follows it.
  const xp = int(raw.xp, 0, MAX_XP, 0);
  if (Number.isFinite(raw.level) && Math.floor(raw.level) !== levelForXp(xp)) note('level recomputed from xp');
  const level = levelForXp(xp);

  // Perks: known ids, ranks within the level gates and the points the level provides.
  const perks = {};
  const src = raw.perks && typeof raw.perks === 'object' && !Array.isArray(raw.perks) ? raw.perks : {};
  for (const pid of PERK_IDS) {
    let r = int(src[pid], 0, MAX_RANK, 0);
    while (r > 0 && level < RANK_LEVELS[r - 1]) {
      r--;
      note(`perk ${pid} rank cut to the level`);
    }
    if (r > 0) perks[pid] = r;
  }
  const points = totalPerkPoints(level);
  let spent = perkPointsSpent(perks);
  if (spent > points) {
    note('perks exceed the level\'s points');
    const order = PERK_IDS.slice().reverse();
    while (spent > points) {
      // take a rank off the highest-ranked perk (later perks first on ties)
      let best = null;
      for (const pid of order) if (perks[pid] && (best === null || perks[pid] > perks[best])) best = pid;
      if (best === null) break;
      if (--perks[best] <= 0) delete perks[best];
      spent--;
    }
  }
  let perkPoints = int(raw.perkPoints, 0, MAX_LEVEL, 0);
  if (perkPoints > points - spent) {
    if (perkPoints > 0) note('perk points trimmed');
    perkPoints = Math.max(0, points - spent);
  }

  // Weapons: guns that exist, tiers 0..MAX_TIER, the pistol and the class gun always owned.
  const weapons = {};
  const sw = raw.weapons && typeof raw.weapons === 'object' && !Array.isArray(raw.weapons) ? raw.weapons : {};
  for (const wid of Object.keys(sw)) {
    if (!isWeaponKnown(wid)) {
      note(`unknown weapon ${String(wid).slice(0, 24)} dropped`);
      continue;
    }
    const w = sw[wid];
    const tier = w && typeof w === 'object' ? clampTier(w.tier) : 0;
    if (w && typeof w === 'object' && Number(w.tier) > MAX_TIER) note(`${wid} tier capped`);
    weapons[wid] = { tier };
  }
  if (!weapons.pistol) weapons.pistol = { tier: 0 };
  const cw = classWeapon(cls);
  if (!weapons[cw]) weapons[cw] = { tier: 0 };

  // Scrap: 0..MAX_SCRAP; a joiner is also held to what the level can have earned.
  let scrap = int(raw.scrap, 0, MAX_SCRAP, 0);
  if (opts.strict) {
    const budget = scrapBudget(level);
    let sunk = 0;
    for (const wid of Object.keys(weapons)) sunk += tierSpent(wid, weapons[wid].tier);
    if (sunk > budget) {
      note('weapon tiers exceed what the level can afford');
      const ids = Object.keys(weapons).sort((a, b) => weapons[b].tier - weapons[a].tier);
      while (sunk > budget) {
        const top = ids.find((wid) => weapons[wid].tier > 0);
        if (!top) break;
        sunk -= tierSpent(top, weapons[top].tier) - tierSpent(top, weapons[top].tier - 1);
        weapons[top].tier--;
      }
    }
    if (scrap + sunk > budget) {
      note('scrap trimmed to the level');
      scrap = Math.max(0, budget - sunk);
    }
  }

  // Loadout: owned guns, each once, slot 0 filled.
  const loadout = [null, null, null];
  const seen = new Set();
  const sl = Array.isArray(raw.loadout) ? raw.loadout : defaultLoadout(cls);
  for (let i = 0; i < 3; i++) {
    const wid = sl[i];
    if (typeof wid === 'string' && Object.hasOwn(weapons, wid) && !seen.has(wid)) {
      loadout[i] = wid;
      seen.add(wid);
    } else if (wid) {
      note('loadout entry dropped');
    }
  }
  if (!loadout[0]) {
    // slot 0 is required: the pistol, else any unused gun, else shift the others up
    const pick = ['pistol', ...Object.keys(weapons)].find((w) => Object.hasOwn(weapons, w) && !seen.has(w));
    if (pick) {
      loadout[0] = pick;
    } else {
      loadout[0] = loadout[1];
      loadout[1] = loadout[2];
      loadout[2] = null;
    }
  }

  // Stats and cosmetics: bounded counters and a few short strings.
  const st = raw.stats && typeof raw.stats === 'object' ? raw.stats : {};
  const stats = {
    kills: int(st.kills, 0, MAX_STAT, 0),
    missions: int(st.missions, 0, MAX_STAT, 0),
    deaths: int(st.deaths, 0, MAX_STAT, 0),
    revives: int(st.revives, 0, MAX_STAT, 0),
    playtime: int(st.playtime, 0, MAX_STAT, 0),
  };
  const cosmetics = {};
  if (raw.cosmetics && typeof raw.cosmetics === 'object' && !Array.isArray(raw.cosmetics)) {
    for (const k of Object.keys(raw.cosmetics).slice(0, 8)) {
      const v = raw.cosmetics[k];
      if (/^[a-z][A-Za-z0-9_]{0,15}$/.test(k) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
        cosmetics[k] = typeof v === 'string' ? v.slice(0, 32) : v;
      }
    }
  }
  const kit = {};
  if (raw.kit && typeof raw.kit === 'object') {
    for (const k of KIT_IDS) {
      const n = int(raw.kit[k], 0, KIT_ITEMS[k].max, 0);
      if (n > 0) kit[k] = n;
    }
  }

  const profile = {
    v: PROFILE_VERSION,
    id,
    name: cleanText(raw.name),
    xp,
    level,
    perkPoints,
    perks,
    scrap,
    weapons,
    loadout,
    cls,
    color,
    stats,
    cosmetics,
    kit,
    perkReset: int(raw.perkReset, 0, 9, 0),
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Number.isFinite(opts.now) ? opts.now : Date.now(),
  };
  return { profile, notes };
}

/**
 * Whether `raw` is already a clean profile (sanitising changes nothing).
 * @returns {{ ok: boolean, notes: string[] }}
 */
export function validateProfile(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, notes: ['not a profile'] };
  const { notes } = sanitizeProfile(raw);
  if (raw.v !== PROFILE_VERSION) notes.push('unknown version');
  return { ok: notes.length === 0, notes };
}

/**
 * The profile a joining player is allowed to bring into a session: sanitised, strict
 * scrap cap, this session's display name.
 * @param {*} raw whatever the joiner sent
 * @param {{ name?: string, now?: number }} [opts]
 * @returns {{ profile: object|null, notes: string[] }}
 */
export function acceptJoinProfile(raw, opts = {}) {
  const res = sanitizeProfile(raw, { strict: true, now: opts.now });
  if (res.profile && opts.name) res.profile.name = cleanText(opts.name);
  return res;
}

/** Copy a profile with `patch` applied and `updatedAt` bumped. */
export function touchProfile(profile, patch = {}, now = Date.now()) {
  return { ...profile, ...patch, updatedAt: now };
}

const BOT_GUNS = ['shotgun', 'uzi', 'rifle', 'burst_rifle', 'dmr', 'lmg', 'minigun'];
const BOT_PERKS = ['thick', 'quick', 'steady', 'hoarder', 'sprinter', 'medic', 'ironwill', 'marksman', 'scavenger', 'lucky', 'demolition', 'secondwind'];

/**
 * A profile for an AI survivor of a story party, scaled to the party's level: it never
 * touches storage and earns nothing.
 * @param {{ name: string, cls: string, color: number, level: number }} opts
 */
export function botStoryProfile({ name, cls, color, level }) {
  const lvl = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(level) || 1)));
  const p = createProfile({ name, cls, color, id: `bot${lvl}${String(cls).slice(0, 4)}xxxxxxxx` });
  const gun = BOT_GUNS[Math.min(BOT_GUNS.length - 1, Math.floor((lvl - 1) / 3))];
  const tier = Math.min(MAX_TIER, Math.floor(lvl / 4));
  if (lvl >= 3) {
    p.weapons[gun] = { tier };
    const cw = classWeapon(p.cls);
    p.loadout = ['pistol', gun, cw !== 'pistol' && cw !== gun ? cw : null];
  }
  const perks = {};
  let points = totalPerkPoints(lvl);
  for (let i = 0; points > 0 && i < 40; i++) {
    const id = BOT_PERKS[i % BOT_PERKS.length];
    const rank = (perks[id] || 0) + 1;
    if (rank > MAX_RANK || lvl < RANK_LEVELS[rank - 1]) continue;
    perks[id] = rank;
    points--;
  }
  p.perks = perks;
  p.perkPoints = 0;
  p.xp = lvl > 1 ? Math.round(90 * Math.pow(lvl - 1, 1.7)) : 0;
  p.level = levelForXp(p.xp);
  return p;
}
