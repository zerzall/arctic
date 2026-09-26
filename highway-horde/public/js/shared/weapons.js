// Every gun in the game. The simulation reads the combat numbers, the renderer reads
// `sprite`/`tracer`, the audio engine reads `sound`, the shop reads price/unlockWave.
//
// kind:
//   'hitscan'    instant rays; `pellets` rays per shot, each spread randomly within ±spread
//   'projectile' spawns `projectile` entities (see PROJECTILE_KINDS) that fly and hit/explode
//   'flame'      spawns short-lived 'flame' projectiles that pierce everything and ignite
//   'chain'      tesla arc: hits the first zombie along the aim ray (within `range`),
//                then jumps to up to `chains` more zombies within `chainRange` of the last one
//   'rail'       an infinitely piercing beam that is only stopped by shot-blocking obstacles
//
// reserve: maximum reserve ammo, -1 means infinite.
// pierce: how many zombies a single bullet can damage (1 = stops at the first).
// falloff: damage multiplier reached at max range (linear from full damage at 40% range).
// knockback: impulse (px/s) given to a zombie hit by one pellet/bullet (scaled by its mass).
// spinup: seconds of holding fire before the first shot (minigun).
// moveMult: movement speed multiplier while this gun is held.
// recoil: camera shake for the shooter (0..1).

export const WEAPONS = {
  pistol: {
    name: 'M9 Pistol', short: 'M9', category: 'pistol',
    price: 0, unlockWave: 1,
    kind: 'hitscan', damage: 25, rate: 5, mag: 12, reserve: -1, reload: 1.1,
    pellets: 1, spread: 0.03, range: 900, pierce: 1, falloff: 0.7, knockback: 40,
    moveMult: 1.0, recoil: 0.08, sound: 'pistol', tracer: '#ffe9a8',
    sprite: { len: 16, width: 5, color: '#2b2b2b', accent: '#555', style: 'pistol' },
  },
  magnum: {
    name: 'Magnum Revolver', short: 'MAG', category: 'pistol',
    price: 750, unlockWave: 1,
    kind: 'hitscan', damage: 110, rate: 2.2, mag: 6, reserve: 48, reload: 1.8,
    pellets: 1, spread: 0.015, range: 1100, pierce: 3, falloff: 0.8, knockback: 160,
    moveMult: 1.0, recoil: 0.3, sound: 'magnum', tracer: '#fff3c4',
    sprite: { len: 20, width: 6, color: '#8d8d8d', accent: '#5a3b22', style: 'revolver' },
  },
  sawedoff: {
    name: 'Sawed-Off', short: 'SAW', category: 'shotgun',
    price: 700, unlockWave: 1,
    kind: 'hitscan', damage: 17, rate: 4, mag: 2, reserve: 40, reload: 1.6,
    pellets: 10, spread: 0.38, range: 360, pierce: 1, falloff: 0.35, knockback: 70,
    moveMult: 1.0, recoil: 0.45, sound: 'shotgun', tracer: '#ffd27a',
    sprite: { len: 22, width: 8, color: '#3b2a1e', accent: '#777', style: 'double' },
  },
  uzi: {
    name: 'Micro SMG', short: 'SMG', category: 'smg',
    price: 900, unlockWave: 1,
    kind: 'hitscan', damage: 16, rate: 15, mag: 32, reserve: 288, reload: 1.4,
    pellets: 1, spread: 0.11, range: 750, pierce: 1, falloff: 0.6, knockback: 25,
    moveMult: 1.0, recoil: 0.07, sound: 'smg', tracer: '#ffe9a8',
    sprite: { len: 22, width: 6, color: '#222', accent: '#444', style: 'smg' },
  },
  shotgun: {
    name: 'Pump Shotgun', short: 'PUMP', category: 'shotgun',
    price: 1100, unlockWave: 1,
    kind: 'hitscan', damage: 18, rate: 1.25, mag: 6, reserve: 48, reload: 2.4,
    pellets: 8, spread: 0.28, range: 480, pierce: 1, falloff: 0.4, knockback: 90,
    moveMult: 0.97, recoil: 0.4, sound: 'shotgun', tracer: '#ffd27a',
    sprite: { len: 34, width: 7, color: '#3a2a1c', accent: '#222', style: 'shotgun' },
  },
  rifle: {
    name: 'Assault Rifle', short: 'AR', category: 'rifle',
    price: 1900, unlockWave: 1,
    kind: 'hitscan', damage: 34, rate: 10, mag: 30, reserve: 270, reload: 1.9,
    pellets: 1, spread: 0.045, range: 1100, pierce: 1, falloff: 0.75, knockback: 45,
    moveMult: 0.95, recoil: 0.12, sound: 'rifle', tracer: '#ffe08a',
    sprite: { len: 36, width: 6, color: '#2f3326', accent: '#4a4f3a', style: 'rifle' },
  },
  dual_smg: {
    name: 'Twin Vipers', short: 'DUAL', category: 'smg',
    price: 2100, unlockWave: 3,
    kind: 'hitscan', damage: 15, rate: 24, mag: 64, reserve: 448, reload: 2.2,
    pellets: 1, spread: 0.15, range: 700, pierce: 1, falloff: 0.6, knockback: 22,
    moveMult: 1.0, recoil: 0.09, sound: 'smg', tracer: '#ffe9a8',
    sprite: { len: 20, width: 6, color: '#1d1d1d', accent: '#b8860b', style: 'dual' },
  },
  crossbow: {
    name: 'Crossbow', short: 'XBOW', category: 'special',
    price: 2400, unlockWave: 3,
    kind: 'projectile', damage: 180, rate: 1.6, mag: 6, reserve: 60, reload: 2.0,
    pellets: 1, spread: 0.01, range: 1400, pierce: 8, falloff: 1, knockback: 120,
    projectile: { kind: 'bolt', speed: 1600, radius: 4, life: 1.2 },
    moveMult: 1.0, recoil: 0.15, sound: 'crossbow', tracer: '#c8e6ff',
    sprite: { len: 30, width: 18, color: '#5d4037', accent: '#9e9e9e', style: 'crossbow' },
  },
  dmr: {
    name: 'Battle Rifle', short: 'DMR', category: 'rifle',
    price: 2600, unlockWave: 3,
    kind: 'hitscan', damage: 85, rate: 3.5, mag: 20, reserve: 160, reload: 2.2,
    pellets: 1, spread: 0.02, range: 1300, pierce: 3, falloff: 0.85, knockback: 90,
    moveMult: 0.95, recoil: 0.22, sound: 'rifle_heavy', tracer: '#fff0b0',
    sprite: { len: 40, width: 6, color: '#3e3a2c', accent: '#6d6450', style: 'dmr' },
  },
  sniper: {
    name: 'Sniper Rifle', short: 'SNPR', category: 'sniper',
    price: 3200, unlockWave: 4,
    kind: 'hitscan', damage: 450, rate: 0.9, mag: 5, reserve: 40, reload: 2.8,
    pellets: 1, spread: 0, range: 2400, pierce: 10, falloff: 1, knockback: 250,
    moveMult: 0.9, recoil: 0.55, sound: 'sniper', tracer: '#ffffff',
    sprite: { len: 50, width: 6, color: '#263238', accent: '#37474f', style: 'sniper' },
  },
  auto_shotgun: {
    name: 'Auto Shotgun', short: 'AA12', category: 'shotgun',
    price: 3600, unlockWave: 5,
    kind: 'hitscan', damage: 16, rate: 4, mag: 16, reserve: 112, reload: 2.6,
    pellets: 7, spread: 0.3, range: 450, pierce: 1, falloff: 0.4, knockback: 70,
    moveMult: 0.93, recoil: 0.35, sound: 'shotgun', tracer: '#ffd27a',
    sprite: { len: 34, width: 9, color: '#212121', accent: '#555', style: 'autoshotgun' },
  },
  flamethrower: {
    name: 'Flamethrower', short: 'FLAME', category: 'heavy',
    price: 4200, unlockWave: 5,
    kind: 'flame', damage: 9, rate: 30, mag: 200, reserve: 400, reload: 3.0,
    pellets: 1, spread: 0.12, range: 330, pierce: 99, falloff: 1, knockback: 0,
    projectile: { kind: 'flame', speed: 620, radius: 14, life: 0.5 },
    burn: { dps: 25, duration: 3 },
    moveMult: 0.9, recoil: 0.02, sound: 'flame', tracer: '#ff9800',
    sprite: { len: 36, width: 10, color: '#b71c1c', accent: '#616161', style: 'flamethrower' },
  },
  lmg: {
    name: 'Light Machine Gun', short: 'LMG', category: 'heavy',
    price: 4400, unlockWave: 6,
    kind: 'hitscan', damage: 36, rate: 12, mag: 100, reserve: 400, reload: 4.0,
    pellets: 1, spread: 0.07, range: 1100, pierce: 2, falloff: 0.75, knockback: 50,
    moveMult: 0.82, recoil: 0.14, sound: 'lmg', tracer: '#ffcc66',
    sprite: { len: 42, width: 9, color: '#2e2e24', accent: '#6b6b4f', style: 'lmg' },
  },
  grenade_launcher: {
    name: 'Grenade Launcher', short: 'GL', category: 'explosive',
    price: 4600, unlockWave: 6,
    kind: 'projectile', damage: 60, rate: 1.5, mag: 6, reserve: 36, reload: 3.0,
    pellets: 1, spread: 0.02, range: 900, pierce: 1, falloff: 1, knockback: 0,
    projectile: { kind: 'grenade', speed: 700, radius: 6, life: 1.3, explodeRadius: 130, explodeDamage: 220 },
    moveMult: 0.93, recoil: 0.3, sound: 'launcher', tracer: '#aaaaaa',
    sprite: { len: 30, width: 12, color: '#33691e', accent: '#1b1b1b', style: 'launcher' },
  },
  rocket: {
    name: 'Rocket Launcher', short: 'RPG', category: 'explosive',
    price: 6200, unlockWave: 8,
    kind: 'projectile', damage: 120, rate: 0.9, mag: 1, reserve: 14, reload: 1.8,
    pellets: 1, spread: 0.01, range: 1600, pierce: 1, falloff: 1, knockback: 0,
    projectile: { kind: 'rocket', speed: 900, radius: 7, life: 2.0, explodeRadius: 180, explodeDamage: 600 },
    moveMult: 0.85, recoil: 0.6, sound: 'rocket', tracer: '#ffab40',
    sprite: { len: 44, width: 11, color: '#4e5b31', accent: '#8d6e63', style: 'rocket' },
  },
  tesla: {
    name: 'Tesla Gun', short: 'TSLA', category: 'special',
    price: 6800, unlockWave: 8,
    kind: 'chain', damage: 55, rate: 6, mag: 40, reserve: 200, reload: 2.5,
    pellets: 1, spread: 0.05, range: 600, pierce: 1, falloff: 1, knockback: 30,
    chains: 6, chainRange: 180,
    moveMult: 0.95, recoil: 0.1, sound: 'tesla', tracer: '#80d8ff',
    sprite: { len: 30, width: 11, color: '#0d47a1', accent: '#80d8ff', style: 'tesla' },
  },
  minigun: {
    name: 'Minigun', short: 'MINI', category: 'heavy',
    price: 8000, unlockWave: 9,
    kind: 'hitscan', damage: 30, rate: 30, mag: 300, reserve: 600, reload: 5.0,
    pellets: 1, spread: 0.1, range: 1000, pierce: 1, falloff: 0.7, knockback: 35,
    spinup: 0.7,
    moveMult: 0.62, recoil: 0.12, sound: 'minigun', tracer: '#ffcc66',
    sprite: { len: 44, width: 14, color: '#424242', accent: '#9e9e9e', style: 'minigun' },
  },
  railgun: {
    name: 'Railgun', short: 'RAIL', category: 'special',
    price: 9500, unlockWave: 10,
    kind: 'rail', damage: 900, rate: 0.7, mag: 4, reserve: 28, reload: 3.0,
    pellets: 1, spread: 0, range: 3000, pierce: 999, falloff: 1, knockback: 300,
    moveMult: 0.9, recoil: 0.7, sound: 'rail', tracer: '#b388ff',
    sprite: { len: 48, width: 9, color: '#311b92', accent: '#b388ff', style: 'railgun' },
  },
};

// Stable order — the wire protocol sends weapons as indices into this array.
export const WEAPON_IDS = Object.keys(WEAPONS);

export function weaponIndex(id) {
  return WEAPON_IDS.indexOf(id);
}

/** Weapons a random weapon crate may contain on the given wave (never the starter pistol). */
export function crateWeaponPool(wave) {
  return WEAPON_IDS.filter((id) => id !== 'pistol' && WEAPONS[id].unlockWave <= wave + 2);
}

// Things thrown or fired that exist as entities for a while.
export const PROJECTILE_KINDS = ['bolt', 'grenade', 'rocket', 'flame', 'frag', 'molotov', 'acid'];

// Thrown items (not guns) — keys G and F.
export const THROWABLES = {
  frag: { name: 'Frag Grenade', fuse: 1.6, explodeRadius: 150, explodeDamage: 260, bounce: 0.45 },
  molotov: { name: 'Molotov', fireRadius: 110, fireDuration: 7, fireDps: 40 },
};
