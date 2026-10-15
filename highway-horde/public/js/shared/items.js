// Shop items that are not guns. Guns are bought by their weapon id (see weapons.js).
//
// The shop is open to everyone during the prep and intermission phases, and mid-wave to
// anyone standing within SUPPLY_RADIUS of the map's supply station.
//
// Buying a gun:
//   - already owned: refills that gun's magazine and reserve for `ammoPrice(id)` instead
//   - free slot: goes into the first free slot and is equipped
//   - slots full: replaces the gun in the current slot (the pistol slot 0 can be replaced too)

import { WEAPONS } from './weapons.js';

export const ITEMS = {
  ammo:       { name: 'Ammo Crate',      price: 300,  desc: 'Refill reserve ammo for every gun you carry.' },
  armor:      { name: 'Kevlar Vest',     price: 400,  desc: '+50 armour (max 100). Soaks up 60% of damage.' },
  medkit:     { name: 'Medkit',          price: 300,  desc: 'Heal to full health.' },
  frag:       { name: 'Frag Grenade',    price: 150,  desc: 'Press G to throw. Big boom.' },
  molotov:    { name: 'Molotov',         price: 200,  desc: 'Press F to throw. Sets the ground on fire.' },
  barricade:  { name: 'Barricade',       price: 350,  desc: 'Press C to place a wall zombies must smash through.' },
  turret:     { name: 'Sentry Turret',   price: 2000, desc: 'Press T to place an auto-firing turret.' },
  selfrevive: { name: 'Self-Revive Kit', price: 1500, desc: 'Get back up on your own once when downed.' },
  repair:     { name: 'Repair Kit',      price: 600,  desc: 'Restore 20% of the objective\'s health.' },
};

export const ITEM_IDS = Object.keys(ITEMS);

/** Price to refill one gun you already own. */
export function ammoPrice(weaponId) {
  const w = WEAPONS[weaponId];
  if (!w || w.reserve < 0) return 0;
  return Math.max(100, Math.round((w.price * 0.25) / 50) * 50);
}

/** True if `id` is a weapon id (own keys only: 'constructor' and friends are not guns). */
export function isWeaponId(id) {
  return typeof id === 'string' && Object.hasOwn(WEAPONS, id);
}

/** True if `id` is a non-gun shop item (own keys only). */
export function isItemId(id) {
  return typeof id === 'string' && Object.hasOwn(ITEMS, id);
}

/** True if `id` names something purchasable (gun or item). */
export function isBuyable(id) {
  return isItemId(id) || (isWeaponId(id) && WEAPONS[id].price > 0);
}

// Pickups dropped by zombies or found as crates.
// weapon crates ('crate') hold a random gun and require pressing E; everything else is
// auto-collected by walking over it.
export const PICKUP_KINDS = ['ammo', 'health', 'cash', 'armor', 'frag', 'crate'];

export const PICKUPS = {
  ammo:   { name: 'Ammo',          desc: 'Refills 35% of reserve ammo for every gun.' },
  health: { name: 'First Aid',     desc: '+35 health.' },
  cash:   { name: 'Cash',          desc: '+$50 to $150.' },
  armor:  { name: 'Armour Plate',  desc: '+25 armour.' },
  frag:   { name: 'Grenade',       desc: '+1 frag grenade.' },
  crate:  { name: 'Weapon Crate',  desc: 'Press E to take the gun inside.' },
};

// Chance that a killed zombie drops something, and what.
export const DROP_CHANCE = 0.06;
export const DROP_TABLE = [
  { kind: 'ammo', weight: 45 },
  { kind: 'health', weight: 25 },
  { kind: 'cash', weight: 20 },
  { kind: 'armor', weight: 5 },
  { kind: 'frag', weight: 5 },
];
export const CRATE_DROP_CHANCE = 0.004;    // per kill, independent of DROP_CHANCE
