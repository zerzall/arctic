// How every gun handles in first person (SPEC §3.4 "Gunplay"): Counter-Strike-like
// mechanics on top of the combat numbers in weapons.js. Pure data and pure functions, shared
// by the simulation (sim/players.js, sim/combat.js), the clients' shot prediction
// (net/client-session.js), the bots, the HUD's crosshair and the renderers.
//
// Every gun gets the defaults of its `category` (pistol, smg, shotgun, rifle, sniper, heavy,
// melee, special, explosive; an unknown category falls back to 'special'), then the
// overrides of its id in WEAPON_HANDLING (a gun this file does not list works through its
// category alone). handlingOf(id) returns the merged, frozen record:
//
//   inacc    random inaccuracy cone (radians, the radius of the cone; a shot lands at a
//            uniformly random radius within it, so most land near the middle):
//            { stand, crouch, move (extra at the weapon's full running speed), air (extra
//              while airborne), land (extra right after landing, fading over LAND_TICKS),
//              fire (added per shot), fireMax (cap of the added part), recover (s to shed
//              90 % of the added part standing; crouched ×0.75) }
//   spread   fixed per-pellet spread (radius, rad) on top of the shared inaccuracy
//   spray    the recoil pattern (see sprayOffset): { up, climb, tail, side, sway, lean,
//            first, jit, seed }; every gun's pattern is fixed: the same every spray
//   recovery seconds for a full spray's recoil to settle once the trigger stops (95 %)
//   viewKick share of the recoil the camera follows (the bullets land at the full offset)
//   speed    running speed multiplier while held (default: the gun's own weapons.js moveMult)
//   deploy   seconds from drawing the gun to the first shot (enforced by the sim)
//   pen      penetration power (sim/ballistics.js: thin cover costs power, damage drops)
//   zones    damage multipliers per hit zone { head, chest, stomach, legs }
//   tracer   own tracers on every n-th shot (others' tracers always show)
//   secondary  right mouse: { type: 'scope', levels: [fov, ...], speed, inacc: { stand,
//            crouch, move } } | { type: 'burst', count, delay, rate } | { type: 'silencer',
//            time, damage, sound } | null. A `secondary` field on the weapons.js entry wins.
//   sprint   inaccuracy multiplier while sprinting (on top of the movement term)

import { WEAPONS } from './weapons.js';

/** Ticks after landing during which the landing inaccuracy fades out. */
export const LAND_TICKS = 20;
/** Below this share of the weapon's running speed a shooter counts as standing still (CS: 34 %). */
export const ACCURATE_SPEED = 0.34;
/** The hit zones (shared/hitbox.js volumes carry one each). */
export const ZONE = { NONE: 0, HEAD: 1, CHEST: 2, STOMACH: 3, LEGS: 4 };
export const ZONE_NAMES = ['none', 'head', 'chest', 'stomach', 'legs'];
/** Weapon mode bits per slot (snapshot `modes`): burst fire on, silencer on. */
export const MODE_BURST = 1;
export const MODE_SIL = 2;

const DEFAULT_ZONES = { head: 4, chest: 1, stomach: 1.25, legs: 0.75 };

/** Per-category defaults. Angles in radians, times in seconds. */
export const CATEGORY_HANDLING = {
  pistol: {
    inacc: { stand: 0.0065, crouch: 0.005, move: 0.045, air: 0.16, land: 0.05, fire: 0.034, fireMax: 0.1, recover: 0.34 },
    spread: 0.002,
    spray: { up: 0.022, climb: 1, tail: 0.022, side: 0.006, sway: 2, lean: 0.2, first: 1, jit: 0.004, seed: 11 },
    recovery: 0.3, viewKick: 0.55, deploy: 0.45, pen: 1, tracer: 3, sprint: 1.3,
  },
  smg: {
    inacc: { stand: 0.011, crouch: 0.0085, move: 0.04, air: 0.12, land: 0.04, fire: 0.0065, fireMax: 0.065, recover: 0.3 },
    spread: 0.003,
    spray: { up: 0.05, climb: 8, tail: 0.0012, side: 0.024, sway: 5, lean: 0.3, first: -1, jit: 0.003, seed: 23 },
    recovery: 0.32, viewKick: 0.45, deploy: 0.6, pen: 1, tracer: 3, sprint: 1.25,
  },
  shotgun: {
    inacc: { stand: 0.012, crouch: 0.009, move: 0.03, air: 0.12, land: 0.04, fire: 0.02, fireMax: 0.06, recover: 0.42 },
    spread: 0.15,
    spray: { up: 0.045, climb: 1, tail: 0.045, side: 0.01, sway: 2, lean: 0.3, first: 1, jit: 0.006, seed: 37 },
    recovery: 0.4, viewKick: 0.6, deploy: 0.65, pen: 0.5, tracer: 1, sprint: 1.2,
  },
  rifle: {
    inacc: { stand: 0.0055, crouch: 0.004, move: 0.13, air: 0.26, land: 0.08, fire: 0.0072, fireMax: 0.085, recover: 0.42 },
    spread: 0.0006,
    spray: { up: 0.1, climb: 9, tail: 0.0016, side: 0.034, sway: 6, lean: 0.25, first: -1, jit: 0.0025, seed: 41 },
    recovery: 0.42, viewKick: 0.45, deploy: 0.75, pen: 2, tracer: 3, sprint: 1.3,
  },
  sniper: {
    inacc: { stand: 0.07, crouch: 0.06, move: 0.2, air: 0.34, land: 0.1, fire: 0.08, fireMax: 0.1, recover: 0.35 },
    spread: 0.0002,
    spray: { up: 0.06, climb: 1, tail: 0.06, side: 0.008, sway: 2, lean: 0.1, first: 1, jit: 0.004, seed: 53 },
    recovery: 0.45, viewKick: 0.6, deploy: 0.9, pen: 3, tracer: 1, sprint: 1.3,
    secondary: { type: 'scope', levels: [40, 15], speed: 0.55, inacc: { stand: 0.0012, crouch: 0.0009, move: 0.2 } },
  },
  heavy: {
    inacc: { stand: 0.012, crouch: 0.008, move: 0.15, air: 0.3, land: 0.1, fire: 0.003, fireMax: 0.05, recover: 0.6 },
    spread: 0.0025,
    spray: { up: 0.055, climb: 12, tail: 0.001, side: 0.034, sway: 8, lean: 0.35, first: 1, jit: 0.003, seed: 67 },
    recovery: 0.5, viewKick: 0.4, deploy: 1.0, pen: 2.2, tracer: 3, sprint: 1.35,
  },
  melee: {
    inacc: { stand: 0, crouch: 0, move: 0, air: 0, land: 0, fire: 0, fireMax: 0, recover: 0.3 },
    spread: 0,
    spray: null,
    recovery: 0.3, viewKick: 0.3, deploy: 0.6, pen: 0, tracer: 1, sprint: 1,
  },
  special: {
    inacc: { stand: 0.006, crouch: 0.005, move: 0.06, air: 0.15, land: 0.05, fire: 0.01, fireMax: 0.05, recover: 0.4 },
    spread: 0,
    spray: { up: 0.03, climb: 1, tail: 0.03, side: 0.006, sway: 2, lean: 0.2, first: 1, jit: 0.003, seed: 79 },
    recovery: 0.4, viewKick: 0.5, deploy: 0.7, pen: 1, tracer: 1, sprint: 1.2,
  },
  explosive: {
    inacc: { stand: 0.006, crouch: 0.005, move: 0.06, air: 0.15, land: 0.05, fire: 0.01, fireMax: 0.05, recover: 0.4 },
    spread: 0,
    spray: { up: 0.05, climb: 1, tail: 0.05, side: 0.008, sway: 2, lean: 0.2, first: 1, jit: 0.004, seed: 83 },
    recovery: 0.5, viewKick: 0.6, deploy: 0.85, pen: 0, tracer: 1, sprint: 1.2,
  },
};

/**
 * Per-gun overrides of the category defaults (merged one level deep: an `inacc` override
 * replaces only the fields it names). Guns not listed here use their category as is.
 */
export const WEAPON_HANDLING = {
  // (M9) the starter: quick to draw, accurate first shot, punished when spammed
  pistol: { deploy: 0.4 },
  // a hand cannon: a big kick and a long recovery, goes through a car door
  magnum: {
    inacc: { stand: 0.005, fire: 0.06, fireMax: 0.12, recover: 0.55 },
    spray: { up: 0.05, climb: 1, tail: 0.05, side: 0.012, sway: 2, lean: 0.4, first: 1, jit: 0.006, seed: 13 },
    recovery: 0.45, deploy: 0.55, pen: 1.8,
  },
  sawedoff: { spread: 0.2, inacc: { stand: 0.014 }, deploy: 0.5, spray: { up: 0.055, climb: 1, tail: 0.055, side: 0.014, sway: 2, lean: 0.5, first: 1, jit: 0.006, seed: 31 } },
  uzi: { spray: { up: 0.045, climb: 8, tail: 0.001, side: 0.026, sway: 4, lean: 0.35, first: 1, jit: 0.004, seed: 29 }, deploy: 0.55 },
  shotgun: { spread: 0.14, deploy: 0.6 },
  rifle: {
    spray: { up: 0.1, climb: 9, tail: 0.0015, side: 0.036, sway: 6, lean: 0.2, first: -1, jit: 0.0025, seed: 43 },
    secondary: null,
  },
  tommy: {
    inacc: { stand: 0.012, move: 0.05 },
    spray: { up: 0.065, climb: 10, tail: 0.0012, side: 0.03, sway: 7, lean: -0.3, first: 1, jit: 0.003, seed: 47 },
    deploy: 0.7,
  },
  // three-round bursts: each burst climbs, the pause between bursts brings it back down
  burst_rifle: {
    inacc: { stand: 0.005, crouch: 0.0038, fire: 0.006 },
    spray: { up: 0.06, climb: 6, tail: 0.002, side: 0.02, sway: 5, lean: 0.4, first: 1, jit: 0.002, seed: 59 },
    recovery: 0.32,
  },
  dual_smg: {
    inacc: { stand: 0.018, crouch: 0.014, fire: 0.0055 },
    spray: { up: 0.045, climb: 10, tail: 0.001, side: 0.032, sway: 4, lean: 0.2, first: -1, jit: 0.005, seed: 61 },
    deploy: 0.75,
  },
  crossbow: { deploy: 0.8 },
  // semi-automatic battle rifle: tap fire, each shot kicks; through cars and fences
  dmr: {
    inacc: { stand: 0.004, crouch: 0.003, move: 0.14, fire: 0.03, fireMax: 0.08, recover: 0.38 },
    spray: { up: 0.034, climb: 1, tail: 0.034, side: 0.009, sway: 2, lean: 0.3, first: -1, jit: 0.004, seed: 71 },
    recovery: 0.36, deploy: 0.8, pen: 2.5, tracer: 2,
  },
  lever: {
    inacc: { stand: 0.0035, crouch: 0.0026, move: 0.12, fire: 0.04, fireMax: 0.08, recover: 0.4 },
    spray: { up: 0.045, climb: 1, tail: 0.045, side: 0.008, sway: 2, lean: 0.3, first: 1, jit: 0.004, seed: 73 },
    recovery: 0.4, deploy: 0.7, pen: 2.2, tracer: 1,
  },
  sniper: { pen: 3, deploy: 0.9 },
  chainsaw: { deploy: 0.7 },
  auto_shotgun: {
    spread: 0.15,
    spray: { up: 0.06, climb: 6, tail: 0.003, side: 0.02, sway: 3, lean: 0.4, first: 1, jit: 0.006, seed: 89 },
    deploy: 0.8,
  },
  flamethrower: { deploy: 0.9 },
  harpoon: { deploy: 0.8 },
  cryo: { deploy: 0.85 },
  lmg: {
    spray: { up: 0.06, climb: 12, tail: 0.001, side: 0.036, sway: 9, lean: 0.3, first: 1, jit: 0.003, seed: 97 },
    deploy: 1.1,
  },
  grenade_launcher: { deploy: 0.85 },
  rocket: { deploy: 1.1 },
  tesla: { deploy: 0.8 },
  // a wall of lead: barely climbs, shakes side to side instead
  minigun: {
    inacc: { stand: 0.02, crouch: 0.016, move: 0.12, fire: 0.002, fireMax: 0.05 },
    spray: { up: 0.035, climb: 10, tail: 0.0005, side: 0.04, sway: 5, lean: 0.1, first: -1, jit: 0.004, seed: 101 },
    recovery: 0.55, deploy: 1.2, pen: 1.6,
  },
  // (its beam pierces every zombie but stops at the first wall, like before)
  // (a beam, not a bullet: `beam` px thick, so a line of zombies goes down like it did in 2D)
  railgun: { inacc: { stand: 0, crouch: 0, fire: 0, fireMax: 0 }, deploy: 1.0, pen: 0, tracer: 1, beam: 9 },
  amr: {
    spray: { up: 0.09, climb: 1, tail: 0.09, side: 0.012, sway: 2, lean: 0.2, first: 1, jit: 0.005, seed: 103 },
    recovery: 0.55, deploy: 1.15, pen: 5,
    secondary: { type: 'scope', levels: [36, 12], speed: 0.5, inacc: { stand: 0.001, crouch: 0.0008, move: 0.22 } },
  },
  hmg: {
    spray: { up: 0.055, climb: 12, tail: 0.001, side: 0.036, sway: 8, lean: -0.3, first: -1, jit: 0.003, seed: 107 },
    deploy: 1.15, pen: 2.4,
  },

  // ---- the arsenal update (weapons.js, appended guns) ----
  // pistols: the compact 9 barely kicks (burst on right click), the .45 is the precise one, the
  // hand cannon kicks like the magnum and takes long to settle, the machine pistol sprays
  compact9: {
    inacc: { fire: 0.026, fireMax: 0.09, recover: 0.28 },
    spray: { up: 0.016, climb: 1, tail: 0.016, side: 0.006, sway: 2, lean: 0.2, first: 1, jit: 0.004, seed: 111 },
    deploy: 0.4,
  },
  tac45: {
    inacc: { stand: 0.005, crouch: 0.0038, fire: 0.03, fireMax: 0.09, recover: 0.3 },
    spray: { up: 0.02, climb: 1, tail: 0.02, side: 0.007, sway: 2, lean: 0.3, first: -1, jit: 0.004, seed: 113 },
    deploy: 0.45,
  },
  handcannon: {
    inacc: { stand: 0.0045, fire: 0.07, fireMax: 0.13, recover: 0.6 },
    spray: { up: 0.06, climb: 1, tail: 0.06, side: 0.013, sway: 2, lean: 0.4, first: 1, jit: 0.006, seed: 117 },
    recovery: 0.5, deploy: 0.6, pen: 1.8,
  },
  mpistol: {
    inacc: { stand: 0.009, crouch: 0.007, move: 0.05, fire: 0.012, fireMax: 0.09 },
    spray: { up: 0.05, climb: 8, tail: 0.002, side: 0.03, sway: 4, lean: 0.3, first: -1, jit: 0.005, seed: 119 },
    deploy: 0.5,
  },
  // SMGs: the 9mm is easy, the PDW shoots well on the move, the .45 kicks harder and goes further in
  smg9: {
    inacc: { stand: 0.01, move: 0.035 },
    spray: { up: 0.04, climb: 8, tail: 0.0012, side: 0.024, sway: 5, lean: 0.25, first: 1, jit: 0.0035, seed: 127 },
    deploy: 0.55,
  },
  pdw: {
    inacc: { stand: 0.012, move: 0.03, fire: 0.0055, fireMax: 0.06 },
    spray: { up: 0.035, climb: 10, tail: 0.001, side: 0.022, sway: 6, lean: -0.2, first: -1, jit: 0.004, seed: 131 },
    deploy: 0.6,
  },
  smg45: {
    spray: { up: 0.055, climb: 8, tail: 0.0015, side: 0.028, sway: 5, lean: 0.3, first: 1, jit: 0.004, seed: 137 },
    pen: 1.2,
  },
  combat_sg: { deploy: 0.7, spray: { up: 0.04, climb: 1, tail: 0.04, side: 0.012, sway: 2, lean: 0.3, first: 1, jit: 0.006, seed: 139 } },
  box_sg: { spread: 0.12, deploy: 0.7, spray: { up: 0.05, climb: 1, tail: 0.05, side: 0.012, sway: 2, lean: -0.3, first: -1, jit: 0.006, seed: 149 } },
  // rifles: the AK climbs hard and swings wide (and goes through more), the M4 is the tamer
  // spray, the scoped bullpup is precise through its scope
  ak: {
    inacc: { stand: 0.006, crouch: 0.0045, move: 0.14, fire: 0.0085, fireMax: 0.09 },
    spray: { up: 0.12, climb: 9, tail: 0.002, side: 0.042, sway: 6, lean: 0.35, first: -1, jit: 0.003, seed: 151 },
    recovery: 0.45, pen: 2.3,
  },
  m4: {
    inacc: { stand: 0.005, crouch: 0.0038, fire: 0.0065, fireMax: 0.08 },
    spray: { up: 0.085, climb: 9, tail: 0.0012, side: 0.03, sway: 6, lean: 0.15, first: 1, jit: 0.0022, seed: 157 },
    recovery: 0.4, pen: 1.9,
  },
  bullpup: {
    spray: { up: 0.08, climb: 9, tail: 0.0012, side: 0.026, sway: 6, lean: 0.2, first: 1, jit: 0.002, seed: 163 },
    secondary: { type: 'scope', levels: [50], speed: 0.75, inacc: { stand: 0.0022, crouch: 0.0017, move: 0.11 } },
  },
  // snipers: the scout is light (better on the move, quicker to draw), the magnum is the one-shot
  // bolt gun that is hopeless unscoped, the semi-auto kicks every shot
  scout: {
    inacc: { stand: 0.045, crouch: 0.038, move: 0.12, air: 0.2 },
    recovery: 0.4, deploy: 0.75, pen: 2.6,
    secondary: { type: 'scope', levels: [40, 15], speed: 0.75, inacc: { stand: 0.0015, crouch: 0.0011, move: 0.12 } },
  },
  magsniper: {
    inacc: { stand: 0.085, crouch: 0.075, move: 0.24, air: 0.4 },
    recovery: 0.6, deploy: 1.1, pen: 4,
    secondary: { type: 'scope', levels: [40, 12], speed: 0.5, inacc: { stand: 0.0007, crouch: 0.0005, move: 0.24 } },
  },
  autosniper: {
    inacc: { fire: 0.03, fireMax: 0.08, recover: 0.3 },
    spray: { up: 0.04, climb: 1, tail: 0.04, side: 0.01, sway: 2, lean: 0.2, first: 1, jit: 0.004, seed: 167 },
    deploy: 1.0, pen: 3,
    secondary: { type: 'scope', levels: [40, 15], speed: 0.55, inacc: { stand: 0.0022, crouch: 0.0016, move: 0.18 } },
  },
  // machine guns: the M60 climbs and swings like the LMG but harder; the Barrage flattens out
  // (its cone also tightens with the wind-up: weapons.js `tighten`, aimNow's accK)
  m60: {
    spray: { up: 0.07, climb: 12, tail: 0.0012, side: 0.04, sway: 9, lean: 0.3, first: 1, jit: 0.003, seed: 173 },
    deploy: 1.2, pen: 2.5,
  },
  barrage: {
    inacc: { stand: 0.014, fire: 0.002, fireMax: 0.04 },
    spray: { up: 0.05, climb: 8, tail: 0.0003, side: 0.03, sway: 10, lean: 0.1, first: -1, jit: 0.003, seed: 179 },
    deploy: 1.15, pen: 2,
  },
  sawblade: { deploy: 0.75 },
  hollowstar: { deploy: 1.0 },
};

const SECONDARY_DEFAULTS = {
  scope: { type: 'scope', levels: [40], speed: 0.6, inacc: null, settle: 0.12 },
  burst: { type: 'burst', count: 3, delay: 0.3, rate: 0 },
  silencer: { type: 'silencer', time: 1.4, damage: 0.9, sound: 0.4 },
};

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** One-level-deep merge of `over` onto `base` (objects merge, everything else replaces). */
function merge(base, over) {
  const out = { ...base };
  if (!isObj(over)) return out;
  for (const k of Object.keys(over)) {
    const v = over[k];
    out[k] = isObj(v) && isObj(base[k]) ? { ...base[k], ...v } : v;
  }
  return out;
}

/** A secondary spec (from weapons.js or the handling data) completed with its type's defaults, or null. */
function normSecondary(s) {
  if (!isObj(s) || !SECONDARY_DEFAULTS[s.type]) return null;
  const d = SECONDARY_DEFAULTS[s.type];
  const out = { ...d, ...s };
  if (s.type === 'scope') {
    const lv = Array.isArray(s.levels) ? s.levels.filter((f) => Number.isFinite(f) && f > 1 && f < 179) : [];
    out.levels = lv.length ? lv.slice(0, 3) : d.levels.slice();
    if (!(out.speed > 0)) out.speed = d.speed;
  }
  if (s.type === 'burst') {
    out.count = Math.max(2, Math.min(6, Math.round(Number(s.count) || d.count)));
    out.delay = Number(s.delay) > 0 ? Number(s.delay) : d.delay;
    out.rate = Number(s.rate) > 0 ? Number(s.rate) : 0;
  }
  if (s.type === 'silencer') {
    out.time = Number(s.time) >= 0 ? Number(s.time) : d.time;
    out.damage = Number(s.damage) > 0 ? Number(s.damage) : d.damage;
  }
  return Object.freeze(out);
}

const cache = new Map();
const FALLBACK = 'special';

/**
 * The handling record of gun `id` (category defaults + its overrides; `secondary` from the
 * weapons.js entry when it declares one). Unknown ids and categories get safe defaults.
 * @param {string} id
 * @returns {object} frozen
 */
export function handlingOf(id) {
  let h = cache.get(id);
  if (h) return h;
  const w = WEAPONS[id];
  const cat = w && CATEGORY_HANDLING[w.category] ? w.category : FALLBACK;
  const merged = merge(CATEGORY_HANDLING[cat], WEAPON_HANDLING[id]);
  const inacc = { ...CATEGORY_HANDLING[cat].inacc, ...(merged.inacc || {}) };
  for (const k of Object.keys(inacc)) if (!(Number(inacc[k]) >= 0)) inacc[k] = 0;
  if (!(inacc.recover > 0)) inacc.recover = 0.4;
  const zones = { ...DEFAULT_ZONES, ...(merged.zones || {}) };
  // weapons.js `secondary` (a gun's own declaration) wins over the handling defaults; a declaration
  // of the same type only overrides the fields it names (a sniper declaring its zoom levels keeps
  // the handling's scoped accuracy)
  let sec = merged.secondary;
  if (w && Object.prototype.hasOwnProperty.call(w, 'secondary')) {
    const own = w.secondary;
    sec = isObj(own) && isObj(sec) && sec.type === own.type ? { ...sec, ...own } : own;
  }
  h = Object.freeze({
    id,
    category: cat,
    inacc: Object.freeze(inacc),
    spread: Number(merged.spread) >= 0 ? Number(merged.spread) : 0,
    spray: merged.spray ? Object.freeze({ ...merged.spray }) : null,
    recovery: merged.recovery > 0 ? merged.recovery : 0.4,
    viewKick: Number.isFinite(merged.viewKick) ? merged.viewKick : 0.5,
    speed: Number(merged.speed) > 0 ? Number(merged.speed) : w && Number(w.moveMult) > 0 ? w.moveMult : 1,
    deploy: Number(merged.deploy) >= 0 ? Number(merged.deploy) : 0.6,
    pen: Number(merged.pen) >= 0 ? Number(merged.pen) : 1,
    zones: Object.freeze(zones),
    tracer: Math.max(1, Math.round(Number(merged.tracer) || 1)),
    // a beam's thickness (px) on top of the hit volumes (the railgun), 0 for bullets
    beam: Number(merged.beam) > 0 ? Number(merged.beam) : 0,
    sprint: Number(merged.sprint) > 0 ? Number(merged.sprint) : 1.2,
    secondary: normSecondary(sec),
    // pellet guns spread their pellets around one shared inaccuracy offset
    pellets: w ? Math.max(1, w.pellets | 0) : 1,
    // automatic: holding the trigger keeps firing (recoil flows along the pattern)
    auto: !!w && (w.rate >= 5 || !!w.spinup),
  });
  cache.set(id, h);
  return h;
}

/**
 * Forget the cached handling records: after the weapon or handling tables were patched at run
 * time (scripts/balance.js --set, tests, a mod declaring `secondary` on a gun).
 */
export function resetHandling() {
  cache.clear();
}

/** The right-mouse action of gun `id`, or null (right mouse shoves). */
export function secondaryOf(id) {
  return id ? handlingOf(id).secondary : null;
}

/** Short name of a secondary mode for buttons and hints: 'ZOOM' | 'BURST' | 'SIL' (null: none). */
export function secondaryLabel(sec) {
  if (!sec) return null;
  return sec.type === 'scope' ? 'ZOOM' : sec.type === 'burst' ? 'BURST' : sec.type === 'silencer' ? 'SIL' : null;
}

/**
 * The field of view (degrees) a player sees through gun `id`'s scope at zoom `level`
 * (0 = not scoped: null). The renderer narrows the camera to it; the UI scales the mouse
 * by the zoom so a flick moves the crosshair over the same part of the picture.
 */
export function scopeFov(id, level) {
  const sec = level > 0 ? secondaryOf(id) : null;
  if (!sec || sec.type !== 'scope') return null;
  const l = sec.levels[Math.min(sec.levels.length, level) - 1];
  return Number.isFinite(l) && l > 0 ? l : null;
}

// ---- recoil patterns ----------------------------------------------------------------------

/** A fixed pseudo-random number in [-0.5, 0.5) from (seed, k): the pattern's jitter never changes. */
function jitter(seed, k) {
  let x = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul((k | 0) + 1, 0x85ebca6b);
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 12;
  x = Math.imul(x, 0x297a2d39);
  x ^= x >>> 15;
  return ((x >>> 0) / 4294967296) - 0.5;
}

/** Triangle wave through 0 at u = 0, +1 at u = 1, -1 at u = 3, period 4. */
function tri(u) {
  const p = ((u % 4) + 4) % 4;
  return p < 1 ? p : p < 3 ? 2 - p : p - 4;
}

/**
 * Where shot number `k` (0 = the first of a spray) lands relative to the crosshair with
 * the trigger held from rest: [yaw (+ = right), pitch (+ = up)] in radians, written to out.
 * The first `climb` shots climb (`up` in all), later ones keep rising by `tail` a shot and
 * swing side to side `side` wide every `sway` shots (first toward `first`), with a fixed
 * per-shot jitter of `jit`. Fractional k interpolates. Pure: the same every spray.
 * @param {object|null} s a handling `spray`
 * @param {number} k
 * @param {number[]} out [yaw, pitch]
 */
export function sprayOffset(s, k, out) {
  out[0] = 0;
  out[1] = 0;
  if (!s || !(k > 0)) return out;
  const k0 = Math.floor(k), f = k - k0;
  if (f > 1e-9) {
    const a = sprayAt(s, k0), ay = a[0], ap = a[1];
    const b = sprayAt(s, k0 + 1);
    out[0] = ay + (b[0] - ay) * f;
    out[1] = ap + (b[1] - ap) * f;
    return out;
  }
  const a = sprayAt(s, k0);
  out[0] = a[0];
  out[1] = a[1];
  return out;
}

const _sp = [0, 0];
function sprayAt(s, k) {
  if (k <= 0) { _sp[0] = 0; _sp[1] = 0; return _sp; }
  const climb = Math.max(1, s.climb || 1);
  const c = Math.min(k, climb) / climb;
  // the climb eases off toward its top; past it the tail keeps rising slowly
  let pitch = s.up * (climb === 1 ? 1 : 1 - (1 - c) * (1 - c) * 0.35 - (1 - c) * 0.65);
  if (k > climb) pitch += (s.tail || 0) * (k - climb);
  const side = s.side || 0;
  let yaw = (s.lean || 0) * side * c;
  if (k > climb) yaw += (s.first || 1) * side * tri((k - climb) / Math.max(1, s.sway || 4));
  const j = s.jit || 0;
  yaw += jitter(s.seed, k * 2) * j;
  pitch += jitter(s.seed, k * 2 + 1) * j * 0.6;
  _sp[0] = yaw;
  _sp[1] = pitch;
  return _sp;
}

// ---- the aim state of one shooter -------------------------------------------------------

/**
 * Fresh recoil / inaccuracy state (sim players and the client's prediction keep one each):
 * spray = shots into the current spray (fractional while it recovers), py / pp = the
 * accumulated recoil offset (yaw / pitch, rad), inacc = the per-shot inaccuracy added so
 * far, since = ticks since the last shot, landT = ticks since landing.
 */
export function createAim() {
  return { spray: 0, py: 0, pp: 0, inacc: 0, since: 999, landT: 999 };
}

/** Reset the recoil and the added inaccuracy (weapon switch, respawn). */
export function resetAim(a) {
  a.spray = 0;
  a.py = 0;
  a.pp = 0;
  a.inacc = 0;
  a.since = 999;
  return a;
}

/**
 * One tick of recovery (call once per tick before firing): the per-shot inaccuracy decays
 * (sheds 90 % in `recover` s, faster crouched); the recoil settles once shots stop
 * flowing (more than a fire cycle and a bit since the last shot): an exponential with
 * 95 % gone in `recovery` s plus a small linear part so it ends.
 * @param {object} a aim state
 * @param {object} h handlingOf(...)
 * @param {number} rate shots per second of the gun right now
 * @param {number} dt
 * @param {number} duck 0..1 crouched
 */
export function aimTick(a, h, rate, dt, duck = 0) {
  a.since = a.since < 999 ? a.since + 1 : 999;
  a.landT = a.landT < 999 ? a.landT + 1 : 999;
  if (a.inacc > 0) {
    const rec = h.inacc.recover * (1 - 0.25 * duck);
    a.inacc *= Math.pow(10, -dt / Math.max(0.05, rec));
    if (a.inacc < 1e-5) a.inacc = 0;
  }
  if (a.spray > 0) {
    // An automatic's spray holds while the shots keep coming (the pattern is the offset);
    // a gun that kicks once per shot (semi-automatics, bolt guns, pumps: a one-step
    // pattern) recovers all the time, so tapping it as fast as it cycles doesn't climb
    // forever (its per-shot inaccuracy punishes the spam instead).
    const flow = h.auto && !(h.spray && h.spray.climb <= 1) ? Math.ceil(60 / Math.max(0.5, rate)) + 2 : 0;
    if (a.since > flow) {
      const r = h.recovery;
      const s0 = a.spray;
      let s1 = s0 - dt * (s0 * 3 / r + 2 / r);
      if (s1 < 1e-3) s1 = 0;
      const k = s1 / s0;
      a.spray = s1;
      a.py *= k;
      a.pp *= k;
      if (s1 === 0) { a.py = 0; a.pp = 0; }
    }
  }
  return a;
}

const _o0 = [0, 0], _o1 = [0, 0];
/**
 * Apply one shot's recoil and inaccuracy (call right after the shot used a.py / a.pp):
 * the offset moves to the pattern's next step, the spray index advances, the per-shot
 * inaccuracy grows (capped).
 * @param {object} a
 * @param {object} h
 * @param {number} k multiplier of the kick (1; a crouched shooter 0.85)
 */
export function aimKick(a, h, k = 1) {
  if (h.spray) {
    sprayOffset(h.spray, a.spray, _o0);
    sprayOffset(h.spray, a.spray + 1, _o1);
    a.py += (_o1[0] - _o0[0]) * k;
    a.pp += (_o1[1] - _o0[1]) * k;
  }
  a.spray += 1;
  a.since = 0;
  a.inacc = Math.min(h.inacc.fireMax, a.inacc + h.inacc.fire);
}

/**
 * The inaccuracy cone (radius, rad) of a shot fired right now.
 * @param {object} h handlingOf(...)
 * @param {object} s { speed (px/s), maxSpeed (px/s: the gun's running speed, unscoped), air
 *   (bool), landT (ticks since landing), duck (0..1), scope (0 = unscoped, else level), scopeK
 *   (0..1: how settled the zoom is; scoped accuracy blends in), sprint (bool), added (a.inacc),
 *   accK (story tier accuracy multiplier, 1) }
 * @returns {number}
 */
export function inaccuracyOf(h, s) {
  const sec = h.secondary;
  const base = h.inacc;
  const duck = Math.max(0, Math.min(1, s.duck || 0));
  let still = base.stand * (1 - duck) + base.crouch * duck;
  let move = base.move;
  if (s.scope > 0 && sec && sec.type === 'scope' && sec.inacc) {
    const k = Number.isFinite(s.scopeK) ? Math.max(0, Math.min(1, s.scopeK)) : 1;
    const si = sec.inacc;
    const sStill = (si.stand ?? base.stand) * (1 - duck) + (si.crouch ?? base.crouch) * duck;
    still += (sStill - still) * k;
    move += ((si.move ?? base.move) - move) * k;
  }
  let v = still;
  const maxV = Math.max(1, s.maxSpeed || 1);
  const acc = maxV * ACCURATE_SPEED;
  if (s.speed > acc) {
    const k = Math.min(1.6, (s.speed - acc) / Math.max(1, maxV - acc));
    v += move * k * (s.sprint ? h.sprint : 1);
  }
  if (s.air) v += h.inacc.air;
  else if (s.landT < LAND_TICKS) v += h.inacc.land * (1 - s.landT / LAND_TICKS);
  v += s.added || 0;
  return v * (s.accK > 0 ? s.accK : 1);
}

/** Damage multiplier of a hit in `zone` (ZONE.*) for gun handling `h` against zombie type data `zt`. */
export function zoneMult(h, zone, zt) {
  const name = ZONE_NAMES[zone] || 'chest';
  // a type's own multipliers (hitbox.js TYPE_ZONES: the brute's and the boss's heavy skulls)
  const tz = zt ? zt.zones || zt : null;
  if (tz && Number.isFinite(tz[name])) return tz[name];
  const v = h.zones[name];
  return Number.isFinite(v) ? v : 1;
}

/**
 * Random point in a disc of radius r (uniform in radius, so dense in the middle, like
 * Counter-Strike's spread), from two rng draws; written to out [x, y].
 */
export function discOffset(r, u1, u2, out) {
  const rad = r * u1, a = u2 * Math.PI * 2;
  out[0] = Math.cos(a) * rad;
  out[1] = Math.sin(a) * rad;
  return out;
}

/** Fire timing of gun `w` in its current mode: { burst, burstDelay, rate } (burst 0 = none). */
export function fireSpec(w, h, modes, out) {
  out.rate = w.rate;
  out.burst = w.burst > 1 ? w.burst : 0;
  out.burstDelay = w.burstDelay || 0;
  const sec = h.secondary;
  if (sec && sec.type === 'burst' && (modes & MODE_BURST) && !out.burst) {
    out.burst = sec.count;
    out.burstDelay = sec.delay;
    if (sec.rate > 0) out.rate = sec.rate;
  }
  return out;
}
