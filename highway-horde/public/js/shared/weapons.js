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
//   'cryo'       like 'flame', but its 'frost' puffs chill instead of burning (see FROST)
//   'melee'      continuous short-range cone: every 1/rate s it cuts every zombie within
//                `range` px of the wielder and `arc` radians of the aim; `mag` is fuel
//
// reserve: maximum reserve ammo, -1 means infinite.
// pierce: how many zombies a single bullet can damage (1 = stops at the first).
// falloff: damage multiplier reached at max range (linear from full damage at 40% range).
// knockback: impulse (px/s) given to a zombie hit by one pellet/bullet (scaled by its mass).
// spinup: seconds of holding fire before the first shot (minigun).
// moveMult: movement speed multiplier while this gun is held.
// recoil: camera shake for the shooter (0..1).
// burst: rounds fired per trigger pull at `rate` (a burst finishes even if the trigger is
//   released); `burstDelay` seconds pass after the last round before the next burst.
// reloadOne: `reload` is the time per round; rounds go in one at a time and a fresh
//   trigger pull with a round in the chamber stops the reload.
// penetrate: { walls, thick, loss } a round passes through up to `walls` shot-blocking
//   obstacles at most `thick` px deep along its path, losing `loss` of its damage each.
// gib: kills blow zombies apart (like explosions and the railgun).
// burn: { dps, duration } sets hit zombies on fire. chill: frost added per puff (FROST).
// projectile.flare: { radius, duration, dps } the flare burns on the ground where it lands.
// projectile.drag / pin: a harpoon carries up to `drag` impaled zombies along and pins
//   them (stunned) for `pin` s where it stops.
// arc: full cone width of a 'melee' weapon (radians).

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
    price: 900, unlockWave: 1,
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
    kind: 'hitscan', damage: 18, rate: 15, mag: 32, reserve: 288, reload: 1.4,
    pellets: 1, spread: 0.09, range: 750, pierce: 1, falloff: 0.6, knockback: 25,
    moveMult: 1.0, recoil: 0.07, sound: 'smg', tracer: '#ffe9a8',
    sprite: { len: 22, width: 6, color: '#222', accent: '#444', style: 'smg' },
  },
  shotgun: {
    name: 'Pump Shotgun', short: 'PUMP', category: 'shotgun',
    price: 1100, unlockWave: 1,
    kind: 'hitscan', damage: 20, rate: 1.4, mag: 6, reserve: 48, reload: 2.1,
    pellets: 8, spread: 0.28, range: 480, pierce: 1, falloff: 0.4, knockback: 90,
    moveMult: 0.97, recoil: 0.4, sound: 'shotgun', tracer: '#ffd27a',
    sprite: { len: 34, width: 7, color: '#3a2a1c', accent: '#222', style: 'shotgun' },
  },
  rifle: {
    name: 'Assault Rifle', short: 'AR', category: 'rifle',
    price: 1900, unlockWave: 1,
    kind: 'hitscan', damage: 36, rate: 10, mag: 30, reserve: 270, reload: 1.9,
    pellets: 1, spread: 0.045, range: 1100, pierce: 1, falloff: 0.75, knockback: 45,
    moveMult: 0.95, recoil: 0.12, sound: 'rifle', tracer: '#ffe08a',
    sprite: { len: 36, width: 6, color: '#2f3326', accent: '#4a4f3a', style: 'rifle' },
  },
  flare: {
    name: 'Flare Gun', short: 'FLR', category: 'special',
    price: 900, unlockWave: 2,
    kind: 'projectile', damage: 70, rate: 1.5, mag: 1, reserve: 30, reload: 1.0,
    pellets: 1, spread: 0.015, range: 1000, pierce: 1, falloff: 1, knockback: 60,
    projectile: { kind: 'flare', speed: 950, radius: 5, life: 1.05, flare: { radius: 52, duration: 8, dps: 30 } },
    burn: { dps: 35, duration: 4 },
    moveMult: 1.0, recoil: 0.2, sound: 'flare', tracer: '#ff5a3a',
    sprite: { len: 18, width: 8, color: '#e2541b', accent: '#2e2e2e', style: 'flare' },
  },
  tommy: {
    name: 'Tommy Gun', short: 'TMY', category: 'smg',
    price: 1300, unlockWave: 2,
    kind: 'hitscan', damage: 23, rate: 13, mag: 50, reserve: 350, reload: 2.6,
    pellets: 1, spread: 0.12, range: 650, pierce: 1, falloff: 0.55, knockback: 35,
    moveMult: 0.97, recoil: 0.1, sound: 'tommy', tracer: '#ffcf7a',
    sprite: { len: 28, width: 8, color: '#26231f', accent: '#7a4a26', style: 'tommy' },
  },
  burst_rifle: {
    name: 'Burst Rifle', short: 'BRST', category: 'rifle',
    price: 1500, unlockWave: 2,
    kind: 'hitscan', damage: 40, rate: 15, burst: 3, burstDelay: 0.3, mag: 30, reserve: 270, reload: 2.0,
    pellets: 1, spread: 0.02, range: 1200, pierce: 1, falloff: 0.8, knockback: 50,
    moveMult: 0.96, recoil: 0.13, sound: 'burst', tracer: '#ffd98a',
    sprite: { len: 34, width: 6, color: '#3a3f46', accent: '#8a7350', style: 'burst' },
  },
  dual_smg: {
    name: 'Twin Vipers', short: 'DUAL', category: 'smg',
    price: 2100, unlockWave: 3,
    kind: 'hitscan', damage: 17, rate: 24, mag: 64, reserve: 448, reload: 2.2,
    pellets: 1, spread: 0.12, range: 700, pierce: 1, falloff: 0.6, knockback: 22,
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
    price: 2800, unlockWave: 3,
    kind: 'hitscan', damage: 85, rate: 3.5, mag: 20, reserve: 160, reload: 2.2,
    pellets: 1, spread: 0.02, range: 1300, pierce: 3, falloff: 0.85, knockback: 90,
    moveMult: 0.95, recoil: 0.22, sound: 'rifle_heavy', tracer: '#fff0b0',
    sprite: { len: 40, width: 6, color: '#3e3a2c', accent: '#6d6450', style: 'dmr' },
  },
  lever: {
    name: 'Lever-Action Rifle', short: 'LVR', category: 'rifle',
    price: 1800, unlockWave: 3,
    kind: 'hitscan', damage: 160, rate: 2, mag: 8, reserve: 64, reload: 0.42, reloadOne: true,
    pellets: 1, spread: 0.008, range: 1400, pierce: 2, falloff: 0.9, knockback: 150,
    moveMult: 1.0, recoil: 0.32, sound: 'lever', tracer: '#fff0c0',
    sprite: { len: 38, width: 5, color: '#6e5c3c', accent: '#8a5a30', style: 'lever' },
  },
  sniper: {
    name: 'Sniper Rifle', short: 'SNPR', category: 'sniper',
    price: 3200, unlockWave: 4,
    kind: 'hitscan', damage: 450, rate: 0.9, mag: 5, reserve: 40, reload: 2.8,
    pellets: 1, spread: 0, range: 2400, pierce: 10, falloff: 1, knockback: 250,
    moveMult: 0.9, recoil: 0.55, sound: 'sniper', tracer: '#ffffff',
    sprite: { len: 50, width: 6, color: '#263238', accent: '#37474f', style: 'sniper' },
  },
  chainsaw: {
    name: 'Chainsaw', short: 'CSAW', category: 'melee',
    price: 2400, unlockWave: 4,
    kind: 'melee', damage: 24, rate: 10, mag: 100, reserve: -1, reload: 2.0,
    pellets: 1, spread: 0, range: 64, arc: 1.5, pierce: 99, falloff: 1, knockback: 70, gib: true,
    moveMult: 0.92, recoil: 0.05, sound: 'chainsaw', tracer: '#c8c8c8',
    sprite: { len: 34, width: 9, color: '#e8620c', accent: '#2f2f2f', style: 'chainsaw' },
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
  harpoon: {
    name: 'Harpoon Gun', short: 'HARP', category: 'special',
    price: 2800, unlockWave: 5,
    kind: 'projectile', damage: 250, rate: 1.2, mag: 4, reserve: 32, reload: 2.0,
    pellets: 1, spread: 0.005, range: 1100, pierce: 5, falloff: 1, knockback: 0,
    projectile: { kind: 'harpoon', speed: 1250, radius: 5, life: 0.9, drag: 3, pin: 1.2 },
    moveMult: 0.94, recoil: 0.35, sound: 'harpoon', tracer: '#b0bec5',
    sprite: { len: 34, width: 8, color: '#3d4a52', accent: '#f2a900', style: 'harpoon' },
  },
  cryo: {
    name: 'Cryo Blaster', short: 'CRYO', category: 'special',
    price: 3200, unlockWave: 5,
    kind: 'cryo', damage: 9, rate: 20, mag: 160, reserve: 320, reload: 2.8,
    pellets: 1, spread: 0.1, range: 300, pierce: 99, falloff: 1, knockback: 0,
    projectile: { kind: 'frost', speed: 560, radius: 16, life: 0.55 },
    chill: 0.07,
    moveMult: 0.92, recoil: 0.02, sound: 'cryo', tracer: '#9ae8ff',
    sprite: { len: 32, width: 10, color: '#c9d6dc', accent: '#4fc3f7', style: 'cryo' },
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
    kind: 'chain', damage: 45, rate: 6, mag: 40, reserve: 200, reload: 2.5,
    pellets: 1, spread: 0.05, range: 600, pierce: 1, falloff: 1, knockback: 30,
    chains: 5, chainRange: 180,
    moveMult: 0.95, recoil: 0.1, sound: 'tesla', tracer: '#80d8ff',
    sprite: { len: 30, width: 11, color: '#0d47a1', accent: '#80d8ff', style: 'tesla' },
  },
  minigun: {
    name: 'Minigun', short: 'MINI', category: 'heavy',
    price: 8000, unlockWave: 9,
    kind: 'hitscan', damage: 30, rate: 30, mag: 300, reserve: 600, reload: 5.0,
    pellets: 1, spread: 0.07, range: 1000, pierce: 1, falloff: 0.7, knockback: 35,
    spinup: 0.7,
    moveMult: 0.62, recoil: 0.12, sound: 'minigun', tracer: '#ffcc66',
    sprite: { len: 44, width: 14, color: '#424242', accent: '#9e9e9e', style: 'minigun' },
  },
  railgun: {
    name: 'Railgun', short: 'RAIL', category: 'special',
    price: 9500, unlockWave: 10,
    kind: 'rail', damage: 900, rate: 0.85, mag: 4, reserve: 28, reload: 2.6,
    pellets: 1, spread: 0, range: 3000, pierce: 999, falloff: 1, knockback: 300,
    moveMult: 0.9, recoil: 0.7, sound: 'rail', tracer: '#b388ff',
    sprite: { len: 48, width: 9, color: '#311b92', accent: '#b388ff', style: 'railgun' },
  },
  amr: {
    name: '.50 Anti-Materiel Rifle', short: '.50', category: 'sniper',
    price: 10000, unlockWave: 10,
    kind: 'hitscan', damage: 1200, rate: 0.55, mag: 5, reserve: 30, reload: 3.4,
    pellets: 1, spread: 0, range: 3000, pierce: 20, falloff: 1, knockback: 420, gib: true,
    penetrate: { walls: 2, thick: 90, loss: 0.25 },
    moveMult: 0.82, recoil: 0.9, sound: 'amr', tracer: '#fff4e0',
    sprite: { len: 56, width: 7, color: '#2c3027', accent: '#1b1c1a', style: 'amr' },
  },
  // Carried at the hip with a 500-round belt fed from a backpack: no spin-up like the
  // minigun, a slower but harder-hitting stream, and a long belt change.
  hmg: {
    name: 'Belt-Fed Heavy MG', short: 'HMG', category: 'heavy',
    price: 7400, unlockWave: 8,
    kind: 'hitscan', damage: 40, rate: 16, mag: 500, reserve: 1000, reload: 6.0,
    pellets: 1, spread: 0.075, range: 1100, pierce: 2, falloff: 0.75, knockback: 55,
    moveMult: 0.7, recoil: 0.16, sound: 'hmg', tracer: '#ffb74d',
    sprite: { len: 46, width: 12, color: '#2b2d27', accent: '#5b5a3c', style: 'hmg' },
  },
};

// Stable order — the wire protocol sends weapons as indices into this array.
export const WEAPON_IDS = Object.keys(WEAPONS);

export function weaponIndex(id) {
  return WEAPON_IDS.indexOf(id);
}

/**
 * Shots per second with the trigger held (a burst gun pauses `burstDelay` after each
 * burst; everything else fires at `rate`).
 */
export function effectiveRate(w) {
  if (!w.burst || w.burst <= 1) return w.rate;
  return w.burst / ((w.burst - 1) / w.rate + w.burstDelay);
}

/** Seconds to fill an empty magazine (per-round reloads load `mag` rounds one by one). */
export function fullReloadTime(w) {
  return w.reloadOne ? w.reload * w.mag : w.reload;
}

/** Weapons a random weapon crate may contain on the given wave (never the starter pistol). */
export function crateWeaponPool(wave) {
  return WEAPON_IDS.filter((id) => id !== 'pistol' && WEAPONS[id].unlockWave <= wave + 2);
}

// Things thrown or fired that exist as entities for a while.
export const PROJECTILE_KINDS = ['bolt', 'grenade', 'rocket', 'flame', 'frag', 'molotov', 'acid', 'flare', 'frost', 'harpoon'];

/**
 * Frost from the cryo blaster. Each 'frost' puff adds the gun's `chill` (0..1) to every
 * zombie it touches; a chilled zombie moves and attacks `slow` × chill slower, and at
 * chill 1 it freezes solid for `freezeTime` s (it can't move or attack and takes
 * `brittle` × damage), then thaws to `afterThaw`. Chill melts at `thaw` per second.
 * Heavies (mass ≥ 0.9) chill at `heavyGain` of the rate; bosses never freeze and chill at
 * most to `bossCap`. Fire and frost cancel out: igniting a zombie thaws it, and frost
 * puts out a burning one.
 */
export const FROST = {
  slow: 0.6, freezeTime: 1.6, thaw: 0.4, afterThaw: 0.5, brittle: 1.3, heavyGain: 0.5, bossCap: 0.5,
};

// Thrown items (not guns) — keys G and F.
export const THROWABLES = {
  frag: { name: 'Frag Grenade', fuse: 1.6, explodeRadius: 150, explodeDamage: 260, bounce: 0.45 },
  molotov: { name: 'Molotov', fireRadius: 110, fireDuration: 7, fireDps: 40 },
};
