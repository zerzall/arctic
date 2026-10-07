// The perk tree (STORY.md §4): twelve perks with three ranks each. A level-up is one perk
// point, a rank costs one point, so a level-20 survivor (19 points) cannot have everything:
// the choices are the point. Higher ranks need a minimum level (RANK_LEVELS).
//
// Every rank lists its numbers as the value AT that rank (not a delta). `perkEffects()`
// folds a survivor's ranks into one record of multipliers/bonuses that mods.js turns into
// the sim modifiers; the sim itself never sees perk ids.
//
//   spread / reload / bleedout / drop ... multipliers (1 = no change)
//   hp / armor / reviveHp ....................... flat bonuses
//   falloffFix ................................. share of a gun's range falloff removed (0..1)

/** Perks may be bought up to this rank. */
export const MAX_RANK = 3;
/** Minimum player level for rank 1, 2, 3 of any perk. */
export const RANK_LEVELS = [1, 4, 8];
/** Scrap price of resetting all perks when it is not free (infirmary, once per chapter). */
export const PERK_RESET_COST = 100;

/** @typedef {{ id: string, name: string, icon: string, desc: string, ranks: object[] }} PerkDef */

/** @type {Record<string, PerkDef>} */
export const PERKS = {
  steady: {
    id: 'steady', name: 'Steady Hands', icon: '⌖',
    desc: 'Every gun you carry shoots tighter.',
    ranks: [
      { text: '-10% spread', spread: 0.9 },
      { text: '-22% spread', spread: 0.78 },
      { text: '-35% spread', spread: 0.65 },
    ],
  },
  quick: {
    id: 'quick', name: 'Quick Hands', icon: '⟲',
    desc: 'Reload faster.',
    ranks: [
      { text: '-8% reload time', reload: 0.92 },
      { text: '-16% reload time', reload: 0.84 },
      { text: '-28% reload time', reload: 0.72 },
    ],
  },
  thick: {
    id: 'thick', name: 'Thick Skin', icon: '♥',
    desc: 'More health, and a little armour at the top.',
    ranks: [
      { text: '+10 health', hp: 10 },
      { text: '+22 health', hp: 22 },
      { text: '+35 health, +10 armour', hp: 35, armor: 10 },
    ],
  },
  medic: {
    id: 'medic', name: 'Field Medic', icon: '✚',
    desc: 'Revive faster and patch up the people around you.',
    ranks: [
      { text: 'Revive 25% faster', reviveSpeed: 1.25 },
      { text: 'Revive 50% faster, heal nearby allies 0.6 hp/s', reviveSpeed: 1.5, healAura: 0.6, healRadius: 170 },
      { text: 'Revive twice as fast, heal nearby allies 1.2 hp/s', reviveSpeed: 2, healAura: 1.2, healRadius: 190 },
    ],
  },
  scavenger: {
    id: 'scavenger', name: 'Scavenger', icon: '⚒',
    desc: 'Find more scrap after a mission and more cash in it.',
    ranks: [
      { text: '+10% scrap, +5% cash', scrap: 1.1, cash: 1.05 },
      { text: '+20% scrap, +10% cash', scrap: 1.2, cash: 1.1 },
      { text: '+35% scrap, +20% cash', scrap: 1.35, cash: 1.2 },
    ],
  },
  hoarder: {
    id: 'hoarder', name: 'Ammo Hoarder', icon: '≡',
    desc: 'Start with more ammunition and carry more of it.',
    ranks: [
      { text: '+15% reserve ammo', reserve: 1.15 },
      { text: '+30% reserve ammo', reserve: 1.3 },
      { text: '+50% reserve ammo, +1 grenade', reserve: 1.5, frags: 1 },
    ],
  },
  sprinter: {
    id: 'sprinter', name: 'Sprinter', icon: '»',
    desc: 'Run faster and for longer.',
    ranks: [
      { text: '+3% speed, +10% stamina', speed: 1.03, stamina: 1.1 },
      { text: '+6% speed, +25% stamina', speed: 1.06, stamina: 1.25 },
      { text: '+10% speed, +50% stamina', speed: 1.1, stamina: 1.5 },
    ],
  },
  ironwill: {
    id: 'ironwill', name: 'Iron Will', icon: '⚔',
    desc: 'Hold on longer when you are down.',
    ranks: [
      { text: 'Bleed out 30% slower', bleedout: 1.3 },
      { text: 'Bleed out 60% slower', bleedout: 1.6 },
      { text: 'Bleed out twice as slowly', bleedout: 2 },
    ],
  },
  demolition: {
    id: 'demolition', name: 'Demolition', icon: '✹',
    desc: 'Bigger, harder explosions.',
    ranks: [
      { text: '+15% explosive damage, +8% radius', explosive: 1.15, radius: 1.08 },
      { text: '+30% explosive damage, +16% radius', explosive: 1.3, radius: 1.16 },
      { text: '+50% explosive damage, +25% radius', explosive: 1.5, radius: 1.25 },
    ],
  },
  marksman: {
    id: 'marksman', name: 'Marksman', icon: '◎',
    desc: 'Bullets lose less punch over distance.',
    ranks: [
      { text: 'Range falloff -35%', falloffFix: 0.35 },
      { text: 'Range falloff -65%, +5% range', falloffFix: 0.65, range: 1.05 },
      { text: 'No range falloff, +10% range', falloffFix: 1, range: 1.1 },
    ],
  },
  lucky: {
    id: 'lucky', name: 'Lucky Loot', icon: '☘',
    desc: 'Zombies drop supplies and weapon crates more often.',
    ranks: [
      { text: '+20% drops', drop: 1.2 },
      { text: '+45% drops, +50% crates', drop: 1.45, crate: 1.5 },
      { text: '+75% drops, twice the crates', drop: 1.75, crate: 2 },
    ],
  },
  secondwind: {
    id: 'secondwind', name: 'Second Wind', icon: '✉',
    desc: 'One free self-revive every mission.',
    ranks: [
      { text: 'A free self-revive each mission', kit: 1 },
      { text: 'Free self-revive, gets you up 40% faster', kit: 1, reviveDelay: 0.6 },
      { text: 'Free self-revive, up in half the time and with +30 health', kit: 1, reviveDelay: 0.35, reviveHp: 30 },
    ],
  },
};

export const PERK_IDS = Object.keys(PERKS);

/** True for a known perk id (own keys only). */
export function isPerkId(id) {
  return typeof id === 'string' && Object.hasOwn(PERKS, id);
}

/** Perk points a level provides in total (one per level after the first). */
export function totalPerkPoints(level) {
  return Math.max(0, Math.floor(Number(level) || 1) - 1);
}

/**
 * Points sunk into a perks map ({ [perkId]: rank }).
 * @param {Record<string, number>} perks
 * @returns {number}
 */
export function perkPointsSpent(perks) {
  let n = 0;
  if (perks && typeof perks === 'object') {
    for (const id of PERK_IDS) n += clampRank(perks[id]);
  }
  return n;
}

function clampRank(r) {
  const n = Math.floor(Number(r));
  return Number.isFinite(n) ? Math.min(MAX_RANK, Math.max(0, n)) : 0;
}

/** Rank of `id` in a perks map (0 when unknown/absent). */
export function rankOf(perks, id) {
  return isPerkId(id) && perks && typeof perks === 'object' ? clampRank(perks[id]) : 0;
}

/**
 * Whether a profile can take the next rank of `id` now.
 * @returns {{ ok: true } | { ok: false, reason: 'unknown'|'max'|'points'|'level' }}
 */
export function canBuyPerk(profile, id) {
  if (!isPerkId(id)) return { ok: false, reason: 'unknown' };
  const rank = rankOf(profile.perks, id);
  if (rank >= MAX_RANK) return { ok: false, reason: 'max' };
  if ((profile.perkPoints | 0) < 1) return { ok: false, reason: 'points' };
  if ((profile.level | 0) < RANK_LEVELS[rank]) return { ok: false, reason: 'level' };
  return { ok: true };
}

/**
 * Spend a perk point on the next rank of `id`. The input is not modified.
 * @returns {{ ok: true, profile: object, rank: number } | { ok: false, reason: string }}
 */
export function buyPerk(profile, id) {
  const can = canBuyPerk(profile, id);
  if (!can.ok) return can;
  const rank = rankOf(profile.perks, id) + 1;
  return {
    ok: true,
    rank,
    profile: { ...profile, perkPoints: (profile.perkPoints | 0) - 1, perks: { ...profile.perks, [id]: rank } },
  };
}

/**
 * Refund every perk point. The input is not modified.
 * @returns {object} the profile with all ranks removed and the points back
 */
export function resetPerks(profile) {
  return { ...profile, perkPoints: (profile.perkPoints | 0) + perkPointsSpent(profile.perks), perks: {} };
}

/** The neutral perk effect record (every multiplier 1, every bonus 0). */
export function neutralEffects() {
  return {
    spread: 1, reload: 1, hp: 0, armor: 0, reviveSpeed: 1, healAura: 0, healRadius: 0, scrap: 1, cash: 1,
    reserve: 1, frags: 0, speed: 1, stamina: 1, bleedout: 1, explosive: 1, radius: 1, falloffFix: 0, range: 1,
    drop: 1, crate: 1, kit: 0, reviveDelay: 1, reviveHp: 0,
  };
}

/**
 * Fold a perks map into one effect record. Multipliers multiply, bonuses add, the heal
 * aura takes its strongest value.
 * @param {Record<string, number>} perks
 * @returns {ReturnType<typeof neutralEffects>}
 */
export function perkEffects(perks) {
  const fx = neutralEffects();
  for (const id of PERK_IDS) {
    const rank = rankOf(perks, id);
    if (!rank) continue;
    const r = PERKS[id].ranks[rank - 1];
    for (const k of Object.keys(r)) {
      if (k === 'text') continue;
      switch (k) {
        case 'hp': case 'armor': case 'frags': case 'kit': case 'reviveHp':
          fx[k] += r[k];
          break;
        case 'healAura': case 'healRadius':
          fx[k] = Math.max(fx[k], r[k]);
          break;
        case 'falloffFix':
          fx[k] = Math.max(fx[k], r[k]);
          break;
        default:
          fx[k] *= r[k];
      }
    }
  }
  return fx;
}
