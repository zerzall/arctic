// Upgrades (STORY.md §4): weapon tiers 0-5 bought with scrap at the workbench, the hideout's
// seven upgrade lines (three tiers each) bought from the stash, and the supplies a survivor
// can carry into a mission. Pure data and pure functions; the sim only ever sees the
// numbers that mods.js derives from them.

import { WEAPONS, WEAPON_IDS } from '../weapons.js';

// ---------------------------------------------------------------- weapon tiers

/** Highest tier of a weapon (tier 0 = as found). */
export const MAX_TIER = 5;

/** Base scrap price of each tier (index = tier); scaled by the weapon (see tierCost). */
export const TIER_BASE_COST = [0, 60, 120, 220, 380, 600];

/**
 * What a tier does, as multipliers on the gun's table entry (cumulative, index = tier).
 * Each tier: +7% damage, +3% fire rate, -4% reload time, -6% spread, about +8% magazine.
 * @param {number} tier
 * @returns {{ damage: number, rate: number, reload: number, spread: number, mag: number }}
 */
export function tierEffect(tier) {
  const t = clampTier(tier);
  return {
    damage: round3(1 + 0.07 * t),
    rate: round3(1 + 0.03 * t),
    reload: round3(1 - 0.04 * t),
    spread: round3(1 - 0.06 * t),
    mag: round3(0.08 * t),
  };
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

/** Tier as a whole number 0..MAX_TIER. */
export function clampTier(t) {
  const n = Math.floor(Number(t));
  return Number.isFinite(n) ? Math.min(MAX_TIER, Math.max(0, n)) : 0;
}

/** Magazine size of `base` mag at `tier` (small magazines gain a round every two tiers). */
export function tierMag(base, tier) {
  const t = clampTier(tier);
  if (t === 0) return base;
  return base + Math.round(base * 0.08 * t) + (base <= 8 ? Math.floor(t / 2) : 0);
}

/** True for a gun that exists (own keys only). */
export function isWeaponKnown(id) {
  return typeof id === 'string' && Object.hasOwn(WEAPONS, id);
}

/**
 * Scrap to raise a weapon from tier-1 to `tier` (one step). Heavier guns cost more.
 * @param {string} weaponId
 * @param {number} tier the tier being bought (1..MAX_TIER)
 * @returns {number} 0 for an invalid request
 */
export function tierCost(weaponId, tier) {
  const t = clampTier(tier);
  if (!isWeaponKnown(weaponId) || t < 1) return 0;
  const f = 0.7 + 0.6 * Math.min(1, WEAPONS[weaponId].price / 5000);
  return Math.max(5, Math.round((TIER_BASE_COST[t] * f) / 5) * 5);
}

/** Scrap already sunk into a weapon at `tier` (the sum of its steps). */
export function tierSpent(weaponId, tier) {
  let n = 0;
  for (let t = 1; t <= clampTier(tier); t++) n += tierCost(weaponId, t);
  return n;
}

/**
 * The chapter (1..6) in which a gun becomes available at the workbench, from the shop's
 * unlock wave. Guns can also be found earlier as mission rewards and crates.
 */
export function weaponChapter(weaponId) {
  if (!isWeaponKnown(weaponId)) return 99;
  return Math.min(6, Math.max(1, Math.ceil(WEAPONS[weaponId].unlockWave / 1.7)));
}

/** Scrap price of a gun at the workbench (a tenth of its shop price). 0 for the pistol. */
export function weaponScrapCost(weaponId) {
  if (!isWeaponKnown(weaponId)) return 0;
  return Math.round(WEAPONS[weaponId].price / 100) * 10;
}

/** Guns every survivor owns from the start (the pistol plus their class weapon, see profile.js). */
export const FREE_WEAPONS = ['pistol'];

/** All guns in table order. */
export const ALL_WEAPONS = WEAPON_IDS.slice();

/**
 * Workbench: can this profile raise `weaponId` one tier now?
 * @param {object} profile
 * @param {string} weaponId
 * @param {number} [discount] price multiplier from hideout upgrades (1 = full price)
 * @returns {{ ok: true, cost: number, tier: number } | { ok: false, reason: 'unknown'|'unowned'|'max'|'scrap', cost?: number }}
 */
export function canUpgradeWeapon(profile, weaponId, discount = 1) {
  if (!isWeaponKnown(weaponId)) return { ok: false, reason: 'unknown' };
  const w = profile.weapons && profile.weapons[weaponId];
  if (!w) return { ok: false, reason: 'unowned' };
  const tier = clampTier(w.tier);
  if (tier >= MAX_TIER) return { ok: false, reason: 'max' };
  const cost = Math.max(1, Math.round(tierCost(weaponId, tier + 1) * discount));
  if ((profile.scrap | 0) < cost) return { ok: false, reason: 'scrap', cost };
  return { ok: true, cost, tier: tier + 1 };
}

/**
 * Raise a weapon one tier. The input is not modified.
 * @returns {{ ok: true, profile: object, cost: number, tier: number } | { ok: false, reason: string }}
 */
export function upgradeWeapon(profile, weaponId, discount = 1) {
  const can = canUpgradeWeapon(profile, weaponId, discount);
  if (!can.ok) return can;
  return {
    ok: true,
    cost: can.cost,
    tier: can.tier,
    profile: {
      ...profile,
      scrap: (profile.scrap | 0) - can.cost,
      weapons: { ...profile.weapons, [weaponId]: { tier: can.tier } },
    },
  };
}

/**
 * Workbench: buy an unowned gun with scrap.
 * @param {object} profile
 * @param {string} weaponId
 * @param {number} chapter the campaign's current chapter (1..6)
 */
export function canBuyWeapon(profile, weaponId, chapter = 1) {
  if (!isWeaponKnown(weaponId)) return { ok: false, reason: 'unknown' };
  if (profile.weapons && profile.weapons[weaponId]) return { ok: false, reason: 'owned' };
  if (WEAPONS[weaponId].price <= 0) return { ok: false, reason: 'unknown' };
  if (weaponChapter(weaponId) > chapter) return { ok: false, reason: 'locked', chapter: weaponChapter(weaponId) };
  const cost = weaponScrapCost(weaponId);
  if ((profile.scrap | 0) < cost) return { ok: false, reason: 'scrap', cost };
  return { ok: true, cost };
}

/**
 * Buy a gun (tier 0). The input is not modified.
 * @returns {{ ok: true, profile: object, cost: number } | { ok: false, reason: string }}
 */
export function buyWeapon(profile, weaponId, chapter = 1) {
  const can = canBuyWeapon(profile, weaponId, chapter);
  if (!can.ok) return can;
  return {
    ok: true,
    cost: can.cost,
    profile: { ...profile, scrap: (profile.scrap | 0) - can.cost, weapons: { ...profile.weapons, [weaponId]: { tier: 0 } } },
  };
}

/**
 * Give a gun to a profile for free (mission reward, crate, blueprint); keeps the tier of a
 * gun already owned.
 */
export function grantWeapon(profile, weaponId) {
  if (!isWeaponKnown(weaponId) || (profile.weapons && profile.weapons[weaponId])) return profile;
  return { ...profile, weapons: { ...profile.weapons, [weaponId]: { tier: 0 } } };
}

/**
 * Set the three-slot loadout from owned guns. Slot 0 is required; a gun may appear once.
 * @param {object} profile
 * @param {(string|null)[]} loadout
 * @returns {{ ok: true, profile: object } | { ok: false, reason: string }}
 */
export function setLoadout(profile, loadout) {
  if (!Array.isArray(loadout)) return { ok: false, reason: 'invalid' };
  const out = [null, null, null];
  const seen = new Set();
  for (let i = 0; i < 3; i++) {
    const id = loadout[i];
    if (id === null || id === undefined) continue;
    if (!isWeaponKnown(id) || !profile.weapons || !profile.weapons[id]) return { ok: false, reason: 'unowned' };
    if (seen.has(id)) return { ok: false, reason: 'duplicate' };
    seen.add(id);
    out[i] = id;
  }
  if (!out[0]) return { ok: false, reason: 'empty' };
  return { ok: true, profile: { ...profile, loadout: out } };
}

// ---------------------------------------------------------------- supplies

/**
 * Supplies a survivor can carry into a mission (`profile.kit`). They come out of the stash
 * (`world.hideout.stash`) and are spent at the mission start: the sim gives them as
 * grenades, vest, deployables and a self-revive kit. `scrap` is the workbench-side price of
 * a fresh one from the armory; `max` is how many one survivor may carry.
 */
export const KIT_ITEMS = {
  frag: { name: 'Frag Grenade', scrap: 15, max: 3 },
  molotov: { name: 'Molotov', scrap: 20, max: 2 },
  armor: { name: 'Armour Plate', scrap: 25, max: 2 },
  barricade: { name: 'Barricade', scrap: 20, max: 3 },
  turret: { name: 'Sentry Turret', scrap: 70, max: 1 },
  selfrevive: { name: 'Self-Revive Kit', scrap: 90, max: 1 },
};
export const KIT_IDS = Object.keys(KIT_ITEMS);

/** True for a known kit item id. */
export function isKitItem(id) {
  return typeof id === 'string' && Object.hasOwn(KIT_ITEMS, id);
}

// ---------------------------------------------------------------- hideout upgrades

/** Tiers of every hideout upgrade line. */
export const HIDEOUT_TIERS = 3;
/** Minimum campaign chapter for tier 1, 2, 3. */
export const HIDEOUT_TIER_CHAPTER = [1, 2, 4];

/**
 * The hideout's upgrade lines. Each tier: `cost` (stash scrap + parts, the latter from
 * missions' `upgradePoints`), `text` and `fx`, the effect record at that tier (see
 * hideoutEffects). Visible in the 3D hub (S3 draws `hub.upgradeSlots[id]` at the tier).
 */
export const HIDEOUT_UPGRADES = {
  generator: {
    id: 'generator', name: 'Generator', desc: 'Power for the lights and the workshop tools.',
    tiers: [
      { cost: { scrap: 80, parts: 1 }, text: 'Lights on in the hideout', fx: { light: 1 } },
      { cost: { scrap: 160, parts: 2 }, text: 'Workbench upgrades cost 10% less', fx: { light: 2, bench: 0.9 } },
      { cost: { scrap: 300, parts: 3 }, text: 'Workbench upgrades cost 20% less', fx: { light: 3, bench: 0.8 } },
    ],
  },
  watchtower: {
    id: 'watchtower', name: 'Watchtower', desc: 'A lookout over the road. Guards the hideout.',
    tiers: [
      { cost: { scrap: 90, parts: 1 }, text: 'A lookout watches the road', fx: { guard: 1 } },
      { cost: { scrap: 180, parts: 2 }, text: 'Spotters: everyone starts with a grenade', fx: { guard: 2, frags: 1 } },
      { cost: { scrap: 320, parts: 3 }, text: 'A sentry turret goes with every survivor', fx: { guard: 3, frags: 1, turrets: 1 } },
    ],
  },
  infirmary: {
    id: 'infirmary', name: 'Infirmary', desc: 'Bandages, a cot and a steady hand.',
    tiers: [
      { cost: { scrap: 90, parts: 1 }, text: 'Start missions with 10 armour', fx: { armor: 10 } },
      { cost: { scrap: 170, parts: 2 }, text: '20 armour, revive 10% faster', fx: { armor: 20, reviveSpeed: 1.1 } },
      { cost: { scrap: 300, parts: 3 }, text: '30 armour, revive 20% faster', fx: { armor: 30, reviveSpeed: 1.2 } },
    ],
  },
  armory: {
    id: 'armory', name: 'Armory', desc: 'Racks, crates and a loading bench.',
    tiers: [
      { cost: { scrap: 90, parts: 1 }, text: '+8% reserve ammo', fx: { reserve: 1.08 } },
      { cost: { scrap: 170, parts: 2 }, text: '+16% reserve ammo', fx: { reserve: 1.16 } },
      { cost: { scrap: 300, parts: 3 }, text: '+25% reserve ammo, one more grenade', fx: { reserve: 1.25, frags: 1 } },
    ],
  },
  radio: {
    id: 'radio', name: 'Radio Mast', desc: 'Listen to the road. Ozzy will find you side jobs.',
    tiers: [
      { cost: { scrap: 70, parts: 1 }, text: 'Radio hints in the mission log', fx: { hints: 1 } },
      { cost: { scrap: 150, parts: 2 }, text: 'Side jobs on the board, +3% XP', fx: { hints: 2, side: 1, xp: 1.03 } },
      { cost: { scrap: 280, parts: 3 }, text: '+6% XP from every mission', fx: { hints: 3, side: 1, xp: 1.06 } },
    ],
  },
  garden: {
    id: 'garden', name: 'Garden', desc: 'Something green. It feeds everyone and sells well.',
    tiers: [
      { cost: { scrap: 70, parts: 1 }, text: '+8% scrap from missions', fx: { scrap: 1.08, supplies: 1 } },
      { cost: { scrap: 150, parts: 2 }, text: '+16% scrap, more supplies', fx: { scrap: 1.16, supplies: 2 } },
      { cost: { scrap: 260, parts: 3 }, text: '+25% scrap, plenty of supplies', fx: { scrap: 1.25, supplies: 3 } },
    ],
  },
  palisade: {
    id: 'palisade', name: 'Palisade', desc: 'Walls of scrap timber. Nobody sneaks up on a wall.',
    tiers: [
      { cost: { scrap: 80, parts: 1 }, text: 'Everyone starts with 1 barricade', fx: { wall: 1, barricades: 1 } },
      { cost: { scrap: 160, parts: 2 }, text: '2 barricades each', fx: { wall: 2, barricades: 2 } },
      { cost: { scrap: 290, parts: 3 }, text: '3 barricades each', fx: { wall: 3, barricades: 3 } },
    ],
  },
};
export const HIDEOUT_IDS = Object.keys(HIDEOUT_UPGRADES);

/** True for a known hideout upgrade id. */
export function isHideoutUpgrade(id) {
  return typeof id === 'string' && Object.hasOwn(HIDEOUT_UPGRADES, id);
}

/** Tier (0..3) of an upgrade line in a `hideout.upgrades` map. */
export function upgradeTier(upgrades, id) {
  if (!isHideoutUpgrade(id) || !upgrades || typeof upgrades !== 'object') return 0;
  const n = Math.floor(Number(upgrades[id]));
  return Number.isFinite(n) ? Math.min(HIDEOUT_TIERS, Math.max(0, n)) : 0;
}

/** The neutral hideout effect record. */
export function neutralHideoutEffects() {
  return {
    light: 0, bench: 1, guard: 0, frags: 0, turrets: 0, armor: 0, reviveSpeed: 1, reserve: 1, hints: 0, side: 0, xp: 1,
    scrap: 1, supplies: 0, wall: 0, barricades: 0,
  };
}

/**
 * The combined effect of a hideout's upgrades (each line contributes its current tier).
 * @param {Record<string, number>} upgrades `world.hideout.upgrades`
 */
export function hideoutEffects(upgrades) {
  const fx = neutralHideoutEffects();
  for (const id of HIDEOUT_IDS) {
    const t = upgradeTier(upgrades, id);
    if (!t) continue;
    const tier = HIDEOUT_UPGRADES[id].tiers[t - 1].fx;
    for (const k of Object.keys(tier)) {
      if (k === 'bench' || k === 'reviveSpeed' || k === 'reserve' || k === 'xp' || k === 'scrap') fx[k] *= tier[k];
      else if (k === 'frags' || k === 'turrets' || k === 'armor' || k === 'barricades' || k === 'supplies') fx[k] += tier[k];
      else fx[k] = Math.max(fx[k], tier[k]);
    }
  }
  return fx;
}

/**
 * Can the stash pay for the next tier of a hideout upgrade line?
 * @param {object} world
 * @param {string} id
 * @param {number} chapter the campaign's current chapter
 * @returns {{ ok: true, tier: number, cost: {scrap: number, parts: number} } | { ok: false, reason: 'unknown'|'max'|'chapter'|'scrap'|'parts', need?: number }}
 */
export function canUpgradeHideout(world, id, chapter = 1) {
  if (!isHideoutUpgrade(id)) return { ok: false, reason: 'unknown' };
  const cur = upgradeTier(world.hideout && world.hideout.upgrades, id);
  if (cur >= HIDEOUT_TIERS) return { ok: false, reason: 'max' };
  if (chapter < HIDEOUT_TIER_CHAPTER[cur]) return { ok: false, reason: 'chapter', need: HIDEOUT_TIER_CHAPTER[cur] };
  const cost = HIDEOUT_UPGRADES[id].tiers[cur].cost;
  const stash = (world.hideout && world.hideout.stash) || {};
  if ((stash.scrap | 0) < cost.scrap) return { ok: false, reason: 'scrap' };
  if ((stash.parts | 0) < cost.parts) return { ok: false, reason: 'parts' };
  return { ok: true, tier: cur + 1, cost };
}

/**
 * Buy the next tier of a hideout upgrade from the stash. Returns the changed hideout
 * fields; world.js turns that into a new world revision.
 * @returns {{ ok: true, tier: number, cost: object, upgrades: object, stash: object } | { ok: false, reason: string }}
 */
export function upgradeHideout(world, id, chapter = 1) {
  const can = canUpgradeHideout(world, id, chapter);
  if (!can.ok) return can;
  const stash = { ...world.hideout.stash };
  stash.scrap = (stash.scrap | 0) - can.cost.scrap;
  stash.parts = (stash.parts | 0) - can.cost.parts;
  return { ok: true, tier: can.tier, cost: can.cost, stash, upgrades: { ...world.hideout.upgrades, [id]: can.tier } };
}
