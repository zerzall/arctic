// Story profile → player (STORY.md §4, S1): perks, weapon tiers, hideout upgrades and the
// supplies taken along become numeric modifiers on a sim player at game start.
//
//   new Game({ players: [{ id, name, color, cls, story: <StorySpec> }] })
//
// `spec` is shared/story/mods.js's compact description; everything is derived by pure
// arithmetic from it (storyMods), so the client's prediction can derive the same numbers
// from the same spec (see net/client-session.js). Players without a `story` spec are
// untouched: `weaponOf(p, id)` is then just `WEAPONS[id]`.
//
// What changes on the player (all through fields the sim already reads):
//   p.perks        maxHp, startArmor, speedMult, staminaMult, reviveSpeed, healAura, cashMult,
//                  explosiveMult (and the new optional explosiveRadius, bleedoutMult,
//                  dropMult, crateMult, reviveDelayMult, reviveHpBonus, each 1/0 when absent)
//   p.story        the StoryMods; weaponOf(p, id) is the gun table entry for this survivor
//                  (tier + perks: damage, magazine, reserve, reload, spread, rate, falloff)
//   p.slots/mag/res the loadout, filled from the derived table

import { WEAPONS } from '../weapons.js';
import { ARMOR_MAX } from '../constants.js';
import { storyMods, weaponFor, sanitizeSpec } from '../story/mods.js';

/**
 * The gun table entry that governs player `p`'s gun `id`: the plain `WEAPONS[id]` unless
 * the player has story mods.
 * @param {{ story?: object|null }} p
 * @param {string} id
 */
export function weaponOf(p, id) {
  const m = p.story;
  return m ? weaponFor(m, id) : WEAPONS[id];
}

/**
 * Fill a story player's slots from the loadout (a respawn does the same).
 * @param {object} p a sim player with `story` mods
 */
export function giveStoryKit(p) {
  const lo = p.story.loadout;
  for (let i = 0; i < p.slots.length; i++) {
    const id = lo[i] && WEAPONS[lo[i]] ? lo[i] : null;
    p.slots[i] = id;
    if (id) {
      const w = weaponFor(p.story, id);
      p.mag[i] = w.mag;
      p.res[i] = w.reserve;
    } else {
      p.mag[i] = 0;
      p.res[i] = 0;
    }
  }
  p.slot = p.slots[1] ? 1 : 0;
  p.lastSlot = 0;
}

/**
 * Apply a survivor's story spec to a freshly created sim player.
 * @param {object} game the sim (unused today; kept for hooks that need the map or mode)
 * @param {object} p the player from createPlayer()
 * @param {object} rawSpec a StorySpec (sanitised again here: it may come from the wire)
 * @returns {object|null} the StoryMods applied, or null when the spec was unusable
 */
export function applyProfileToPlayer(game, p, rawSpec) {
  const spec = sanitizeSpec(rawSpec);
  if (!spec) return null;
  const m = storyMods(spec);
  p.story = m;
  const perks = { ...p.perks };
  perks.maxHp += m.hp;
  perks.startArmor = Math.min(ARMOR_MAX, perks.startArmor + m.armor);
  perks.speedMult *= m.speed;
  perks.staminaMult *= m.stamina;
  perks.reviveSpeed *= m.reviveSpeed;
  perks.healAura = Math.max(perks.healAura, m.healAura);
  perks.healRadius = Math.max(perks.healRadius, m.healRadius);
  perks.cashMult *= m.cash;
  perks.explosiveMult *= m.explosive;
  perks.startFrags += m.frags;
  perks.startMolotovs += m.molotovs;
  perks.startTurrets += m.turrets;
  if (m.radius !== 1) perks.explosiveRadius = m.radius;
  if (m.bleedout !== 1) perks.bleedoutMult = m.bleedout;
  if (m.drop !== 1) perks.dropMult = m.drop;
  if (m.crate !== 1) perks.crateMult = m.crate;
  if (m.reviveDelay !== 1) perks.reviveDelayMult = m.reviveDelay;
  if (m.reviveHp) perks.reviveHpBonus = m.reviveHp;
  p.perks = perks;
  p.maxHp = perks.maxHp;
  p.hp = p.maxHp;
  p.armor = perks.startArmor;
  p.speedMult = perks.speedMult;
  p.staminaMult = perks.staminaMult;
  p.frags = perks.startFrags;
  p.molotovs = perks.startMolotovs;
  p.turrets = perks.startTurrets;
  p.barricades = m.barricades;
  if (m.selfRevive > 0) p.selfRevive = true;
  giveStoryKit(p);
  return m;
}
