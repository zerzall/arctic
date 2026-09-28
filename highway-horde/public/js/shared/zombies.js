// Zombie types. hp/speed/damage are wave-1, normal-difficulty values; the simulation
// scales them by wave (HP_GROWTH_PER_WAVE, SPEED_GROWTH_PER_WAVE) and difficulty.
//
// speed: [min, max] px/s, each zombie picks a value in the range when it spawns.
// attackRange: reach beyond the two touching radii.
// mass: 0..1 knockback resistance (1 = immovable).
// weight(wave): relative spawn weight on a wave; 0 means it never spawns there.
// special: behaviour-specific numbers, see comments per type.
// look: drawing hints for the renderer (skin/clothes/scale).

export const ZOMBIES = {
  walker: {
    name: 'Walker', hp: 70, speed: [52, 74], radius: 14, damage: 12, attackRate: 1.0, attackRange: 10,
    mass: 0.2, cash: 10, score: 10,
    weight: (w) => Math.max(10, 100 - w * 4),
    look: { skin: '#7c9a6d', clothes: ['#5d4037', '#37474f', '#4e342e', '#455a64', '#6d4c41', '#283593'], scale: 1 },
  },
  runner: {
    name: 'Runner', hp: 45, speed: [150, 178], radius: 12, damage: 8, attackRate: 1.4, attackRange: 8,
    mass: 0.1, cash: 15, score: 15,
    weight: (w) => (w < 2 ? 0 : 28 + w * 1.8),
    look: { skin: '#a3b88a', clothes: ['#c62828', '#1565c0', '#2e7d32', '#f9a825'], scale: 0.9 },
  },
  crawler: {
    name: 'Crawler', hp: 35, speed: [80, 96], radius: 11, damage: 6, attackRate: 1.6, attackRange: 6,
    mass: 0.1, cash: 10, score: 10,
    weight: (w) => (w < 3 ? 0 : 14 + w),
    look: { skin: '#5f7356', clothes: ['#3e2723', '#212121'], scale: 0.8 },
  },
  bloater: {
    name: 'Bloater', hp: 160, speed: [44, 56], radius: 21, damage: 15, attackRate: 0.8, attackRange: 10,
    mass: 0.6, cash: 30, score: 30,
    weight: (w) => (w < 4 ? 0 : 5 + w * 0.6),
    // Bursts when it dies: damages players (and turrets/barricades) and other zombies nearby.
    special: { deathRadius: 115, deathDamage: 45, zombieDamage: 200 },
    look: { skin: '#8fa35a', clothes: ['#6d6d3d'], scale: 1.4 },
  },
  spitter: {
    name: 'Spitter', hp: 90, speed: [66, 78], radius: 14, damage: 10, attackRate: 1.0, attackRange: 10,
    mass: 0.2, cash: 25, score: 25,
    weight: (w) => (w < 4 ? 0 : 4 + w * 0.4),
    // Stops at `keepAway` px from its target and lobs an 'acid' projectile every `cooldown`
    // seconds while it has line of sight within `range`. The glob leaves an 'acid' hazard.
    special: { range: 380, keepAway: 260, cooldown: 3.8, speed: 420, poolRadius: 60, poolDps: 10, poolDuration: 4 },
    look: { skin: '#6f8f3a', clothes: ['#827717', '#558b2f'], scale: 1 },
  },
  screamer: {
    name: 'Screamer', hp: 110, speed: [84, 96], radius: 13, damage: 8, attackRate: 1.0, attackRange: 8,
    mass: 0.2, cash: 35, score: 35,
    weight: (w) => (w < 6 ? 0 : 3 + w * 0.3),
    // Screams every `cooldown` s: zombies within `radius` move `speedBuff`x faster for `duration` s.
    special: { radius: 240, speedBuff: 1.4, duration: 5, cooldown: 8 },
    look: { skin: '#cfd8c4', clothes: ['#eceff1', '#b0bec5'], scale: 1 },
  },
  brute: {
    name: 'Brute', hp: 1100, speed: [56, 64], radius: 26, damage: 35, attackRate: 0.7, attackRange: 14,
    mass: 0.9, cash: 120, score: 120,
    weight: (w) => (w < 5 ? 0 : 1.6 + w * 0.08),
    // Within `triggerRange` of its target it charges at `chargeSpeed` for `duration` s,
    // knocking back and damaging (`chargeDamage`) whoever it runs into. Recharges after `cooldown`.
    special: { triggerRange: 320, chargeSpeed: 330, duration: 1.1, cooldown: 6, chargeDamage: 30, knockback: 520 },
    look: { skin: '#6b7d5c', clothes: ['#3e2723', '#263238'], scale: 1.9 },
  },
  boss: {
    name: 'Abomination', hp: 8500, speed: [62, 62], radius: 44, damage: 50, attackRate: 0.6, attackRange: 20,
    mass: 1, cash: 1000, score: 1000,
    // Never spawned by weight; one per player-count bracket on every BOSS_EVERY-th wave.
    weight: () => 0,
    // Slams the ground every `cooldown` s when a target is within `radius`: `damage` + knockback.
    // HP is multiplied by (hpBase + hpPerPlayer * playerCount) / bossCount on top of the
    // difficulty and its own wave growth: hp × (1 + hpGrowth × (wave - 1)).
    special: { radius: 190, damage: 40, knockback: 650, cooldown: 4.5, windup: 0.8, hpBase: 0.4, hpPerPlayer: 0.25, hpGrowth: 0.04 },
    look: { skin: '#5b6b3f', clothes: ['#4a148c'], scale: 3.2 },
  },
};

// Stable order — the wire protocol sends zombie types as indices into this array.
export const ZOMBIE_IDS = Object.keys(ZOMBIES);

export function zombieIndex(id) {
  return ZOMBIE_IDS.indexOf(id);
}

// Snapshot flag bits for zombies.
export const ZFLAG = {
  BURNING: 1,
  ATTACKING: 2,
  CHARGING: 4,   // brute charge / boss slam wind-up
  BUFFED: 8,     // screamer speed buff active
  ELITE: 16,     // rare tougher variant (1.6x hp, glowing eyes)
  SLOWED: 32,    // chilled by frost (cryo blaster): slower, frosted over
  FROZEN: 64,    // frozen solid: can't move or attack, takes extra damage
};
