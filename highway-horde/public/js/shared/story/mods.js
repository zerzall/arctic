// Turns a survivor's persistent state (perks, weapon tiers, hideout upgrades, carried
// supplies) into the numbers the simulation uses: the "story mods" (STORY.md §4, S1).
//
//   Profile ──specFromProfile()──► spec (small JSON, travels in the start message)
//   spec ──storyMods()──► mods: flat bonuses and multipliers + a lazily derived per-gun table
//
// Host and clients derive the mods from the same spec with the same code, so client
// prediction (reload time, magazine, fire cadence, movement speed) agrees with the host.
// Everything here is plain arithmetic (no Math.random, no time): deterministic everywhere.

import { WEAPONS } from '../weapons.js';
import { perkEffects, PERK_IDS, MAX_RANK, isPerkId } from './perks.js';
import {
  tierEffect, tierMag, clampTier, MAX_TIER, isWeaponKnown, hideoutEffects, HIDEOUT_IDS, HIDEOUT_TIERS,
  isHideoutUpgrade, KIT_ITEMS, KIT_IDS, isKitItem,
} from './upgrades.js';

/** Spec format version. */
export const SPEC_VERSION = 1;

/** Armour plates in a mission kit add this much armour each. */
export const ARMOR_PER_PLATE = 50;

/**
 * The compact description of one survivor for one game.
 * @typedef {object} StorySpec
 * @property {number} v SPEC_VERSION
 * @property {number} lvl level (display; bots use it for nothing)
 * @property {(string|null)[]} loadout three gun ids (slot 0 first)
 * @property {Record<string, number>} tiers weapon tiers by gun id (owned guns only)
 * @property {Record<string, number>} perks perk ranks
 * @property {Record<string, number>} hideout hideout upgrade tiers
 * @property {Record<string, number>} kit supplies taken into the mission
 */

/**
 * Build the spec of a profile for a game in a hideout with the given upgrades.
 * @param {object} profile a valid Profile
 * @param {Record<string, number>} [hideoutUpgrades] `world.hideout.upgrades`
 * @param {Record<string, number>} [kit] supplies to take along (defaults to `profile.kit`)
 * @returns {StorySpec}
 */
export function specFromProfile(profile, hideoutUpgrades = {}, kit) {
  const tiers = {};
  for (const [id, w] of Object.entries(profile.weapons || {})) {
    if (isWeaponKnown(id) && w && clampTier(w.tier) > 0) tiers[id] = clampTier(w.tier);
  }
  const perks = {};
  for (const id of PERK_IDS) {
    const r = Math.floor(Number(profile.perks && profile.perks[id]));
    if (r > 0) perks[id] = Math.min(MAX_RANK, r);
  }
  const hideout = {};
  for (const id of HIDEOUT_IDS) {
    const t = Math.floor(Number(hideoutUpgrades && hideoutUpgrades[id]));
    if (t > 0) hideout[id] = Math.min(HIDEOUT_TIERS, t);
  }
  const k = {};
  const src = kit || profile.kit || {};
  for (const id of KIT_IDS) {
    const n = Math.floor(Number(src[id]));
    if (n > 0) k[id] = Math.min(KIT_ITEMS[id].max, n);
  }
  const loadout = [null, null, null];
  for (let i = 0; i < 3; i++) {
    const id = profile.loadout && profile.loadout[i];
    loadout[i] = isWeaponKnown(id) ? id : null;
  }
  if (!loadout[0]) loadout[0] = 'pistol';
  return { v: SPEC_VERSION, lvl: Math.max(1, Math.floor(Number(profile.level) || 1)), loadout, tiers, perks, hideout, kit: k };
}

/**
 * Validate a spec that came over the wire (or from a save). Unknown ids and out-of-range
 * numbers are dropped, never trusted.
 * @param {*} raw
 * @returns {StorySpec|null} null when it is not an object at all
 */
export function sanitizeSpec(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const tiers = {};
  if (raw.tiers && typeof raw.tiers === 'object') {
    for (const id of Object.keys(raw.tiers)) if (isWeaponKnown(id) && clampTier(raw.tiers[id]) > 0) tiers[id] = clampTier(raw.tiers[id]);
  }
  const perks = {};
  if (raw.perks && typeof raw.perks === 'object') {
    for (const id of Object.keys(raw.perks)) {
      const r = Math.floor(Number(raw.perks[id]));
      if (isPerkId(id) && r > 0) perks[id] = Math.min(MAX_RANK, r);
    }
  }
  const hideout = {};
  if (raw.hideout && typeof raw.hideout === 'object') {
    for (const id of Object.keys(raw.hideout)) {
      const t = Math.floor(Number(raw.hideout[id]));
      if (isHideoutUpgrade(id) && t > 0) hideout[id] = Math.min(HIDEOUT_TIERS, t);
    }
  }
  const kit = {};
  if (raw.kit && typeof raw.kit === 'object') {
    for (const id of Object.keys(raw.kit)) {
      const n = Math.floor(Number(raw.kit[id]));
      if (isKitItem(id) && n > 0) kit[id] = Math.min(KIT_ITEMS[id].max, n);
    }
  }
  const loadout = [null, null, null];
  const seen = new Set();
  if (Array.isArray(raw.loadout)) {
    for (let i = 0; i < 3; i++) {
      const id = raw.loadout[i];
      if (isWeaponKnown(id) && !seen.has(id)) {
        loadout[i] = id;
        seen.add(id);
      }
    }
  }
  if (!loadout[0]) loadout[0] = 'pistol';
  return { v: SPEC_VERSION, lvl: Math.min(99, Math.max(1, Math.floor(Number(raw.lvl) || 1))), loadout, tiers, perks, hideout, kit };
}

/**
 * The gun table entry for `base` at `tier` with the survivor's perk effects folded in
 * (spread, reload, reserve ammo, range falloff and range). Missing fields stay as they are.
 * @param {object} base a WEAPONS entry
 * @param {number} tier 0..MAX_TIER
 * @param {object} fx perkEffects() record (times the hideout's reserve bonus)
 * @returns {object} a new table entry (the base is not modified)
 */
export function deriveWeapon(base, tier, fx) {
  const t = clampTier(tier);
  const te = tierEffect(t);
  const w = { ...base };
  w.damage = base.damage * te.damage;
  w.rate = base.rate * te.rate;
  if (base.burstDelay) w.burstDelay = base.burstDelay / te.rate;
  w.mag = tierMag(base.mag, t);
  w.reload = base.reload * te.reload * fx.reload;
  w.spread = base.spread * te.spread * fx.spread;
  w.reserve = base.reserve < 0 ? base.reserve : Math.round(base.reserve * fx.reserve);
  if (base.falloff < 1) w.falloff = base.falloff + (1 - base.falloff) * fx.falloffFix;
  if (base.kind === 'hitscan' || base.kind === 'rail') w.range = Math.round(base.range * fx.range);
  if (base.projectile && base.projectile.explodeDamage) {
    w.projectile = { ...base.projectile, explodeDamage: base.projectile.explodeDamage * te.damage };
  }
  w.tier = t;
  return w;
}

/**
 * The simulation modifiers of one survivor. Multipliers are 1 when neutral, bonuses 0.
 * @typedef {object} StoryMods
 * @property {StorySpec} spec
 * @property {(string|null)[]} loadout
 * @property {number} hp flat bonus to max health
 * @property {number} armor flat bonus to starting armour
 * @property {number} speed movement multiplier
 * @property {number} stamina stamina multiplier
 * @property {number} reviveSpeed revive speed multiplier (this survivor reviving others)
 * @property {number} healAura hp/s healed around this survivor (0 = none)
 * @property {number} healRadius
 * @property {number} bleedout multiplier on the time until a downed survivor dies
 * @property {number} selfRevive free self-revive kits at the start
 * @property {number} reviveDelay multiplier on the self-revive delay
 * @property {number} reviveHp flat bonus to the health after a revive
 * @property {number} explosive multiplier on explosion damage
 * @property {number} radius multiplier on explosion radius
 * @property {number} drop multiplier on the drop chance of this survivor's kills
 * @property {number} crate multiplier on the crate chance of this survivor's kills
 * @property {number} cash multiplier on kill cash
 * @property {number} frags starting grenades
 * @property {number} molotovs
 * @property {number} turrets
 * @property {number} barricades
 * @property {object} fx the perk effect record with the hideout's reserve bonus folded in
 * @property {Record<string, number>} tiers
 * @property {Record<string, object>} cache derived gun table entries (filled on demand)
 */

const MODS_CACHE = new Map();
const MODS_CACHE_MAX = 64;

/**
 * Derive the mods of a spec (memoised: many players share few specs).
 * @param {StorySpec} spec a sanitised spec
 * @returns {StoryMods}
 */
export function storyMods(spec) {
  const key = JSON.stringify(spec);
  const hit = MODS_CACHE.get(key);
  if (hit) return hit;
  const pf = perkEffects(spec.perks);
  const hf = hideoutEffects(spec.hideout);
  const kit = spec.kit || {};
  const fx = { ...pf, reserve: pf.reserve * hf.reserve };
  const mods = {
    spec,
    loadout: spec.loadout.slice(),
    hp: pf.hp,
    armor: pf.armor + hf.armor + (kit.armor || 0) * ARMOR_PER_PLATE,
    speed: pf.speed,
    stamina: pf.stamina,
    reviveSpeed: pf.reviveSpeed * hf.reviveSpeed,
    healAura: pf.healAura,
    healRadius: pf.healRadius,
    bleedout: pf.bleedout,
    selfRevive: pf.kit + (kit.selfrevive || 0),
    reviveDelay: pf.reviveDelay,
    reviveHp: pf.reviveHp,
    explosive: pf.explosive,
    radius: pf.radius,
    drop: pf.drop,
    crate: pf.crate,
    cash: pf.cash,
    frags: pf.frags + hf.frags + (kit.frag || 0),
    molotovs: kit.molotov || 0,
    turrets: hf.turrets + (kit.turret || 0),
    barricades: hf.barricades + (kit.barricade || 0),
    fx,
    tiers: spec.tiers,
    cache: {},
  };
  if (MODS_CACHE.size >= MODS_CACHE_MAX) MODS_CACHE.delete(MODS_CACHE.keys().next().value);
  MODS_CACHE.set(key, mods);
  return mods;
}

/**
 * The effective table entry of gun `id` for a survivor with these mods (derived once).
 * @param {StoryMods|null} mods null = the plain table entry
 * @param {string} id
 */
export function weaponFor(mods, id) {
  const base = WEAPONS[id];
  if (!mods || !base) return base;
  let w = mods.cache[id];
  if (!w) w = mods.cache[id] = deriveWeapon(base, mods.tiers[id] || 0, mods.fx);
  return w;
}

/** The highest weapon tier a spec can have (for sanity checks in tests/tools). */
export const TOP_TIER = MAX_TIER;
