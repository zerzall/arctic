// Zombie hit volumes (SPEC §3.4 "Gunplay", §7.5): where on a zombie a first-person bullet
// lands — head, chest (upper body and arms), stomach (belly and pelvis), legs — in 3D, posed
// like the 3D model draws it.
//
// The volumes are built from the zombie rig's own proportions and joint pivots (mirrored
// from render3d/actor-zmodels.js ZPARAMS / zombieSkeleton, model units: +x forward, +y up,
// +z right, feet at y = 0, ~56 tall) by the rig's forward kinematics (render3d/actor-rig.js:
// each bone turns about its pivot) in the type's average gait pose (render3d/zombies3d.js
// poseZombie with the per-zombie hunch / jut / seeds of zombieBody), then scaled like the
// renderer places the model (SCALE per type × the zombie's height and girth, × 1.08 for
// elites). zombieBody(type, id) is the single source of a zombie's build: the renderer poses
// and scales every zombie with it, so the volumes sit on what you see. A lunging attacker
// (ZFLAG.ATTACKING) and a charging brute (CHARGING) lean further in.
//
// Pure functions: the simulation tests its rays here (sim/combat.js), the clients predict
// their own shots with it, the bots aim at aimPoint(), and the fps sandbox draws the
// volumes over the models (render3d/overlay.js, dev only).

import { ZONE } from './handling.js';

/** Height scale of each type's 3D model (render3d/zombies3d.js uses this table). */
export const ZOMBIE_SCALE = { walker: 1, runner: 0.95, crawler: 0.9, bloater: 1.12, spitter: 1, screamer: 1.02, brute: 1.55, boss: 2.5 };
/** Model scale of an elite zombie on top of its type's. */
export const ELITE_SCALE = 1.08;

/** Damage multipliers that replace the gun's per zone for a type (heavy skulls). */
export const TYPE_ZONES = {
  brute: { head: 2 },
  boss: { head: 2 },
};

const BASE = {
  hip: 29.7, knee: 16.19, ankle: 2.38, legGap: 3.48, thighR: 2.08, calfR: 1.3, waist: 35.01, chest: 37.56, sY: 44.64, sw: 5.49, uarm: 8.18, farm: 7.83, armR: 1.15, neck: 48.33, headC: [1.63, 52.37], headR: [3.05, 4.18, 2.78],
  neckR: 1, bulk: 1, depth: 1, upper: 1, rArmK: 1, stumps: false,
};
/**
 * Per-type proportions: measured from the MakeHuman bodies (render3d/actor-zbody.js zbodyType(type).P,
 * scale 1, rest pose: keep the two in step when the bodies change), plus the volumes' own shape
 * factors (bulk, depth, upper, neckR, rArmK, stumps).
 */
const PARAMS = {
  walker: {},
  runner: { hip: 29.77, knee: 16.14, ankle: 2.37, legGap: 3.45, thighR: 2.6, calfR: 1.56, waist: 35, sY: 44.68, sw: 5.53, farm: 7.86, armR: 1.46, neck: 48.39, headC: [1.62, 52.47], headR: [3.14, 4.16, 2.8], bulk: 1.06, depth: 1.08, neckR: 1.08 },
  crawler: { hip: 29.74, knee: 16.17, thighR: 1.73, calfR: 1.12, waist: 35.03, chest: 37.59, sY: 44.68, sw: 5.54, farm: 7.85, armR: 0.97, neck: 48.38, headC: [1.58, 52.43], headR: [3.01, 4.19, 2.78], bulk: 0.94, depth: 0.9, stumps: true },
  bloater: { hip: 29.76, knee: 16.14, ankle: 2.36, legGap: 3.45, thighR: 2.88, calfR: 1.7, waist: 34.99, sY: 44.67, sw: 5.97, uarm: 8.19, farm: 7.86, armR: 1.8, neck: 48.38, headC: [1.71, 52.47], headR: [3.3, 4.16, 3.03], bulk: 1.3, depth: 1.32, neckR: 1.45 },
  spitter: { hip: 29.78, knee: 16.13, ankle: 2.37, legGap: 3.46, thighR: 1.99, calfR: 1.25, waist: 35.03, chest: 37.59, sY: 44.71, sw: 5.57, farm: 7.87, armR: 1.12, neck: 48.42, headC: [1.55, 52.99], headR: [3.04, 4.67, 2.79], bulk: 0.95, depth: 0.95, neckR: 1.1 },
  screamer: { hip: 29.75, knee: 16.17, thighR: 1.59, calfR: 1.05, waist: 35.03, chest: 37.59, sY: 44.69, sw: 5.55, uarm: 8.67, farm: 8.9, armR: 0.9, neck: 48.39, headC: [1.56, 52.44], headR: [3, 4.19, 2.78], bulk: 0.86, depth: 0.85, neckR: 0.9 },
  brute: { hip: 29.76, knee: 16.68, ankle: 3.72, legGap: 3.45, thighR: 4.05, calfR: 2.57, waist: 34.99, sY: 44.5, sw: 6.85, uarm: 8.07, farm: 8.06, armR: 3.37, neck: 48.24, headC: [4.43, 51.37], headR: [3.7, 4.27, 2.71], bulk: 1.3, depth: 1.45, upper: 1.28, neckR: 1.9, rArmK: 1.45 },
  boss: { hip: 29.76, knee: 16.54, ankle: 3.45, legGap: 3.45, thighR: 4.22, calfR: 2.74, waist: 34.99, sY: 44.48, sw: 7.07, uarm: 8.21, farm: 8.42, armR: 3.9, neck: 48.22, headC: [4.71, 51.2], headR: [3.68, 4.26, 2.66], bulk: 1.35, depth: 1.55, upper: 1.3, neckR: 2.0 },
};
const typeParams = new Map();
function paramsOf(type) {
  let P = typeParams.get(type);
  if (!P) {
    P = { ...BASE, ...(PARAMS[type] || PARAMS.walker) };
    typeParams.set(type, P);
  }
  return P;
}

/**
 * The 0..1 hash render3d/actor-kit.js hash01 uses (kept identical: the renderer's per-zombie
 * pose seeds come from it).
 */
export function hash01(n) {
  let x = (n | 0) * 374761393 + 668265263;
  x = (x ^ (x >>> 13)) * 1274126177;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/**
 * A zombie's build from its sim id (the same on every client): height, girth (width / depth),
 * hunch and how far the neck juts, plus the two pose seeds the renderer's gait uses.
 * @param {string} type
 * @param {number} id
 * @returns {{ h: number, gw: number, gd: number, hunch: number, jut: number, seed: number, seed2: number }}
 */
export function zombieBody(type, id) {
  const i = id | 0;
  const big = type === 'brute' || type === 'boss';
  const r = (k) => hash01(i * 92821 + k * 7919 + 17);
  return {
    h: big ? 0.96 + r(1) * 0.1 : 0.93 + r(1) * 0.15,
    gw: (0.88 + r(2) * 0.28) * (type === 'runner' ? 0.97 : 1),
    gd: (0.92 + r(3) * 0.2) * (type === 'runner' ? 0.98 : 1),
    hunch: r(4),
    jut: 0.2 + r(5) * 0.8,
    seed: hash01(i * 31 + 7),
    seed2: hash01(i * 7 + 3),
  };
}

// ---- forward kinematics in the sagittal plane (x forward, y up): 2×3 affine [a, b, tx, c, d, ty]

function setRot(m, px, py, th) {
  const c = Math.cos(th), s = Math.sin(th);
  m[0] = c; m[1] = -s; m[2] = px - (c * px - s * py);
  m[3] = s; m[4] = c; m[5] = py - (s * px + c * py);
}
function mul2(out, a, b) {
  const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5];
  out[0] = a0 * b[0] + a1 * b[3]; out[1] = a0 * b[1] + a1 * b[4]; out[2] = a0 * b[2] + a1 * b[5] + a2;
  out[3] = a3 * b[0] + a4 * b[3]; out[4] = a3 * b[1] + a4 * b[4]; out[5] = a3 * b[2] + a4 * b[5] + a5;
}
function apply(m, x, y, out) {
  out[0] = m[0] * x + m[1] * y + m[2];
  out[1] = m[3] * x + m[4] * y + m[5];
  return out;
}
const angOf = (m) => Math.atan2(m[3], m[0]);

/**
 * Joint rotations (about the side axis; negative leans forward) of a type's average gait,
 * from zombies3d.js poseZombie with the zombie's build. `v`: 0 walking, 1 lunging (an attack
 * swing), 2 charging (brute).
 */
function gaitOf(type, b, v) {
  const g = { rootX: 0, rootY: -0.16, hips: 0, spine: 0, chest: 0, neck: 0, head: 0, ua: [0, 0], fa: [0, 0], thigh: [0, 0] };
  g.spine = -0.12 - b.seed * 0.1 - b.hunch * 0.16 - 0.035;
  g.chest = -0.1 - b.seed2 * 0.12 - b.hunch * 0.08;
  g.neck = 0.06 + b.hunch * 0.04 - b.jut * 0.22;
  g.head = -(g.spine + g.chest + g.neck) * 0.85 - 0.08;
  switch (type) {
    case 'runner':
      g.spine = -0.44 - b.hunch * 0.1; g.chest = -0.2; g.neck = 0.25; g.head = 0.3; g.rootY = -0.3;
      break;
    case 'crawler':
      g.hips = -1.42; g.rootY = -22.1; g.rootX = -1.2; g.spine = 0.06; g.chest = 0.12; g.neck = 0.55; g.head = 0.75;
      g.ua = [2.2, 2.2]; g.fa = [-0.5, -0.5]; g.thigh = [0.15, 0.1];
      break;
    case 'bloater':
      g.spine = 0.16; g.chest = 0.05; g.neck = 0.1; g.head = 0.05;
      g.ua = [0.75, 0.75]; g.fa = [0.55, 0.5];
      break;
    case 'spitter':
      g.spine = -0.2; g.chest = -0.28; g.neck = 0.45; g.head = 0.2;
      break;
    case 'screamer':
      g.spine = -0.05; g.chest = -0.06; g.neck = 0.1; g.head = 0.25;
      break;
    case 'brute':
      g.spine = -0.25; g.chest = -0.25; g.neck = 0.35; g.head = 0.3; g.rootY = 0;
      g.ua = [0.35, 0.25]; g.fa = [0.5, 0.35];
      if (v === 2) { g.spine -= 0.45; g.chest -= 0.25; g.neck += 0.35; g.head += 0.2; g.ua = [-0.55, -0.65]; }
      break;
    case 'boss':
      g.spine = -0.15; g.chest = -0.18; g.neck = 0.35; g.head = 0.2; g.rootY = 0;
      g.ua = [0.55, 0.55]; g.fa = [0.55, 0.55];
      break;
    default:
      break;
  }
  if (v === 1 && type !== 'crawler') {
    // mid-swing of an attack: the spine and chest fold into the lunge, the body steps in
    g.spine -= 0.18; g.chest -= 0.14; g.head -= 0.08; g.rootX += 2.6;
  } else if (v === 1) {
    g.rootX += 4; g.head += 0.2;
  }
  return g;
}

/** Volume layout in a Float64Array: 10 numbers each. */
const V = 10;
const CAP = 0, BOX = 1;

const _m = {
  root: new Float64Array(6), hips: new Float64Array(6), spine: new Float64Array(6), chest: new Float64Array(6),
  neck: new Float64Array(6), head: new Float64Array(6), t: new Float64Array(6), l: new Float64Array(6),
};
const _p = [0, 0], _q = [0, 0];

function chain(P, g) {
  const M = _m;
  M.root[0] = 1; M.root[1] = 0; M.root[2] = g.rootX; M.root[3] = 0; M.root[4] = 1; M.root[5] = g.rootY;
  setRot(M.l, 0, P.hip, g.hips); mul2(M.hips, M.root, M.l);
  setRot(M.l, 0, P.waist, g.spine); mul2(M.spine, M.hips, M.l);
  setRot(M.l, 0, P.chest, g.chest); mul2(M.chest, M.spine, M.l);
  setRot(M.l, 0.3, P.neck, g.neck); mul2(M.neck, M.chest, M.l);
  setRot(M.l, P.headC[0] - 0.5, P.headC[1] - P.headR[1] * 0.62, g.head); mul2(M.head, M.neck, M.l);
  return M;
}

function pushCap(out, n, zone, ax, ay, az, bx, by, bz, r) {
  const o = n * V;
  out[o] = CAP; out[o + 1] = zone;
  out[o + 2] = ax; out[o + 3] = ay; out[o + 4] = az; out[o + 5] = bx; out[o + 6] = by; out[o + 7] = bz; out[o + 8] = r; out[o + 9] = 0;
  return n + 1;
}

/** A box in the sagittal plane: centre, half extents (depth, height, width), tilt th (rig sign). */
function pushBox(out, n, zone, cx, cy, cz, hx, hy, hz, th) {
  const o = n * V;
  out[o] = BOX; out[o + 1] = zone;
  out[o + 2] = cx; out[o + 3] = cy; out[o + 4] = cz; out[o + 5] = hx; out[o + 6] = hy; out[o + 7] = hz;
  out[o + 8] = Math.cos(th); out[o + 9] = Math.sin(th);
  return n + 1;
}

/** Limb from a parent frame: shoulder (or hip) pivot, upper and lower segment rotations. */
function limb(out, n, zone, parent, px, py, z, len1, len2, r1, r2, a1, a2) {
  const M = _m;
  setRot(M.l, px, py, a1); mul2(M.t, parent, M.l);
  apply(M.t, px, py, _p);
  apply(M.t, px, py - len1, _q);
  const sx = _p[0], sy = _p[1], ex = _q[0], ey = _q[1];
  n = pushCap(out, n, zone, sx, sy, z, ex, ey, z, r1);
  if (len2 > 0) {
    setRot(M.l, px, py - len1, a2);
    const T2 = new Float64Array(6);
    mul2(T2, M.t, M.l);
    apply(T2, px, py - len1 - len2, _p);
    n = pushCap(out, n, zone, ex, ey, z, _p[0], _p[1], z, r2);
  }
  return n;
}

/**
 * The volumes of one zombie in its model space (unscaled; scale with volumeScale), into a
 * fresh Float64Array (10 numbers a volume) with `count` set.
 */
function build(type, b, v) {
  const P = paramsOf(type);
  const g = gaitOf(type, b, v);
  const M = chain(P, g);
  const out = new Float64Array(V * 14);
  let n = 0;
  const loose = type === 'boss' ? 0.9 : type === 'brute' ? 0.7 : type === 'runner' ? 0.45 : 0.6;
  // head: a capsule along the head's own up axis (chin to crown)
  const hc = P.headC, hr = P.headR;
  const hu = Math.max(0.2, hr[1] - Math.min(hr[0], hr[2]) * 0.95);
  apply(M.head, hc[0], hc[1] - hu, _p);
  apply(M.head, hc[0], hc[1] + hu, _q);
  const headR = (hr[0] + hr[2]) * 0.5 * 1.02;
  n = pushCap(out, n, ZONE.HEAD, _p[0], _p[1], 0, _q[0], _q[1], 0, headR);
  // neck (counts as the chest)
  apply(M.neck, 0.3, P.sY - 0.5, _p);
  apply(M.neck, 0.5, P.neck + 1.2, _q);
  n = pushCap(out, n, ZONE.CHEST, _p[0], _p[1], 0, _q[0], _q[1], 0, 1.9 * P.neckR);
  // chest: ribs to the shoulders (with the armpits and the tops of the arms)
  const up = P.upper;
  const cy0 = P.waist + 3.2, cy1 = P.sY + 1.2;
  apply(M.chest, 0.25, (cy0 + cy1) / 2, _p);
  const chestTh = angOf(M.chest);
  n = pushBox(out, n, ZONE.CHEST, _p[0], _p[1], 0, 3.6 * P.depth * (1 + (up - 1) * 0.6) + loose, (cy1 - cy0) / 2 + 0.3,
    6.0 * P.bulk * up + loose + (type === 'crawler' ? 0 : 0.6), chestTh);
  // stomach: belly and pelvis (the bloater's sagging belly sticks out in front)
  const sy0 = P.hip - 2.4, sy1 = P.waist + 3.2;
  const fat = type === 'bloater' ? 2.6 : 0;
  apply(M.spine, 0.2 + fat * 0.6, (sy0 + sy1) / 2, _p);
  n = pushBox(out, n, ZONE.STOMACH, _p[0], _p[1], 0, 3.4 * P.depth + loose + fat, (sy1 - sy0) / 2,
    5.0 * P.bulk + loose, angOf(M.spine));
  // legs: hip to ankle (the crawler drags thigh stumps behind it)
  for (const side of [-1, 1]) {
    // (a touch closer together than the joints: the thighs meet at the crotch)
    const z = side * P.legGap * (P.stumps ? 1 : 0.72);
    if (P.stumps) {
      n = limb(out, n, ZONE.LEGS, M.hips, 0, P.hip, z, P.hip - P.knee + 1.5, 0, P.thighR + 0.4, 0, side < 0 ? g.thigh[0] : g.thigh[1], 0);
    } else {
      apply(M.hips, 0, P.hip - 0.6, _p);
      apply(M.hips, 0.1, P.ankle - 1.2, _q);
      n = pushCap(out, n, ZONE.LEGS, _p[0], _p[1], z, _q[0], _q[1], z, (P.thighR + P.calfR) * 0.5 + 0.75);
    }
  }
  // arms where the type always holds them the same way (the heavies, the bloater's, the crawler's
  // pulling arms); a walker's arms wave about, its chest box covers the shoulders
  if (type === 'brute' || type === 'boss' || type === 'bloater' || type === 'crawler') {
    for (let s = 0; s < 2; s++) {
      const side = s ? 1 : -1;
      const rk = s && P.rArmK > 1 ? P.rArmK : 1;
      const z = side * (P.sw * (rk > 1 ? 1.06 : 1) + (type === 'bloater' ? 1.6 : 0));
      n = limb(out, n, ZONE.CHEST, M.chest, 0, P.sY, z, P.uarm * rk, P.farm * rk, P.armR + 0.55, P.armR * 0.85 + 0.45, g.ua[s], g.fa[s]);
    }
  }
  out.count = n;
  return out;
}

const cache = new Map();
const CACHE_MAX = 6000;

/** Pose variant from the snapshot flags (ZFLAG.ATTACKING 2, CHARGING 4). */
export function variantOf(type, flags) {
  if ((flags & 4) && type === 'brute') return 2;
  return flags & 2 ? 1 : 0;
}

/**
 * The volumes of zombie (type, id) in pose variant v (0 walk, 1 lunge, 2 charge), cached:
 * a Float64Array with `count` volumes of 10 numbers ([kind 0 capsule | 1 box, zone, ...]),
 * in model units before volumeScale.
 */
export function zombieVolumes(type, id, v = 0) {
  const key = (id | 0) * 32 + v * 8 + (ZOMBIE_TYPE_INDEX.get(type) ?? 0);
  let e = cache.get(key);
  if (e && e.type === type) return e.vols;
  if (cache.size >= CACHE_MAX) cache.clear();
  const body = zombieBody(type, id);
  e = { type, body, vols: build(type, body, v) };
  cache.set(key, e);
  return e.vols;
}
const ZOMBIE_TYPE_INDEX = new Map(Object.keys(ZOMBIE_SCALE).map((t, i) => [t, i]));

/** Model-to-world scale of a zombie: [depth (forward), height, width (side)]. */
export function volumeScale(type, id, elite, out) {
  const b = zombieBody(type, id);
  const s = (ZOMBIE_SCALE[type] || 1) * (elite ? ELITE_SCALE : 1);
  out[0] = s * b.gd; out[1] = s * b.h; out[2] = s * b.gw;
  return out;
}

const _sc = [1, 1, 1];
const _hit = { s: -1, zone: 0 };

/**
 * First hit of a ray on a zombie's volumes. The ray starts at (ox, oy) at height oz and
 * runs along the unit horizontal direction (dx, dy) rising `k` per unit (the slope); `s` is
 * the horizontal distance along it. The zombie stands at (zx, zy) with its feet at zz,
 * facing `za`.
 * @param {object} z { type, id, flags } (sim zombies: flags of the pose, see variantOf)
 * @returns {{ s: number, zone: number }} s = -1 on a miss within maxS (shared object)
 */
export function rayZombie(type, id, flags, zx, zy, zz, za, ox, oy, oz, dx, dy, k, maxS, out = _hit) {
  out.s = -1;
  out.zone = 0;
  volumeScale(type, id, (flags & 16) !== 0, _sc);
  const sx = _sc[0], sy = _sc[1], sz = _sc[2];
  const ca = Math.cos(za), sa = Math.sin(za);
  const px = ox - zx, py = oy - zy;
  // into the model's frame (forward, up, side), unscaled: a straight line stays one, and
  // its parameter (s) is unchanged
  const lx = (px * ca + py * sa) / sx, ly = (oz - zz) / sy, lz = (-px * sa + py * ca) / sz;
  const vx = (dx * ca + dy * sa) / sx, vy = k / sy, vz = (-dx * sa + dy * ca) / sz;
  // quick reject: the line's closest approach to the body's axis, against its reach
  const reach = type === 'crawler' ? 34 : type === 'boss' || type === 'brute' ? 40 : 26;
  const vh = vx * vx + vz * vz;
  if (vh > 1e-12) {
    const t = -(lx * vx + lz * vz) / vh;
    const cx = lx + vx * t, cz = lz + vz * t;
    if (cx * cx + cz * cz > reach * reach) return out;
  }
  const vols = zombieVolumes(type, id, variantOf(type, flags));
  let best = Infinity, zone = 0;
  for (let i = 0, n = vols.count; i < n; i++) {
    const o = i * V;
    const t = vols[o] === CAP
      ? rayCapsule(lx, ly, lz, vx, vy, vz, vols[o + 2], vols[o + 3], vols[o + 4], vols[o + 5], vols[o + 6], vols[o + 7], vols[o + 8])
      : rayBox(lx, ly, lz, vx, vy, vz, vols, o);
    if (t >= 0 && t < best) {
      best = t;
      zone = vols[o + 1];
    }
  }
  if (best <= maxS) {
    out.s = best;
    out.zone = zone;
  }
  return out;
}

/** Ray (origin o, direction v, not unit) vs capsule a–b of radius r: entry parameter, or -1. */
function rayCapsule(ox, oy, oz, vx, vy, vz, ax, ay, az, bx, by, bz, r) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const aox = ox - ax, aoy = oy - ay, aoz = oz - az;
  const ab2 = abx * abx + aby * aby + abz * abz;
  if (ab2 < 1e-9) return raySphere(aox, aoy, aoz, vx, vy, vz, r);
  const abv = abx * vx + aby * vy + abz * vz;
  const abo = abx * aox + aby * aoy + abz * aoz;
  const vv = vx * vx + vy * vy + vz * vz;
  const vo = vx * aox + vy * aoy + vz * aoz;
  const oo = aox * aox + aoy * aoy + aoz * aoz;
  // the infinite cylinder
  const A = ab2 * vv - abv * abv;
  const Bh = ab2 * vo - abo * abv;
  const C = ab2 * oo - abo * abo - r * r * ab2;
  let best = Infinity;
  // starting inside the round body: hit at once
  if (C <= 0 && abo >= 0 && abo <= ab2) return 0;
  if (Math.abs(A) > 1e-12) {
    const disc = Bh * Bh - A * C;
    if (disc >= 0) {
      const t = (-Bh - Math.sqrt(disc)) / A;
      const u = abo + t * abv;
      if (t >= 0 && u >= 0 && u <= ab2) best = t;
    }
  }
  // the end caps
  const t0 = raySphere(aox, aoy, aoz, vx, vy, vz, r);
  if (t0 >= 0 && t0 < best) best = t0;
  const t1 = raySphere(ox - bx, oy - by, oz - bz, vx, vy, vz, r);
  if (t1 >= 0 && t1 < best) best = t1;
  return best === Infinity ? -1 : best;
}

/** Ray from offset o (origin minus centre) along v vs a sphere of radius r: entry, 0 inside, -1 miss. */
function raySphere(ox, oy, oz, vx, vy, vz, r) {
  const c = ox * ox + oy * oy + oz * oz - r * r;
  if (c <= 0) return 0;
  const b = ox * vx + oy * vy + oz * vz;
  if (b >= 0) return -1;
  const a = vx * vx + vy * vy + vz * vz;
  const disc = b * b - a * c;
  if (disc < 0) return -1;
  return (-b - Math.sqrt(disc)) / a;
}

/** Ray vs a box of the volume table at offset o (tilted in the sagittal plane): entry, 0 inside, -1 miss. */
function rayBox(ox, oy, oz, vx, vy, vz, vols, o) {
  const c = vols[o + 8], s = vols[o + 9];
  const qx = ox - vols[o + 2], qy = oy - vols[o + 3], qz = oz - vols[o + 4];
  // into the box's frame (undo its tilt)
  const bx = qx * c + qy * s, by = -qx * s + qy * c;
  const ux = vx * c + vy * s, uy = -vx * s + vy * c;
  let t0 = -Infinity, t1 = Infinity;
  for (let ax = 0; ax < 3; ax++) {
    const p = ax === 0 ? bx : ax === 1 ? by : qz;
    const d = ax === 0 ? ux : ax === 1 ? uy : vz;
    const h = vols[o + 5 + ax];
    if (Math.abs(d) < 1e-12) {
      if (p < -h || p > h) return -1;
      continue;
    }
    let a = (-h - p) / d, b = (h - p) / d;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return -1;
  }
  if (t1 < 0) return -1;
  return t0 >= 0 ? t0 : 0;
}

const _bh = { f: 0, side: 0, h: 0 }, _bl = { f: 0, side: 0, h: 0 };
/**
 * rayZombie for a beam `beam` px thick (the railgun): the thin test first, else the ray
 * passing within the body's half-width + beam of the zombie's centre, between its feet and the
 * top of its head, hits the part at that height.
 */
export function rayZombieBeam(type, id, flags, zx, zy, zz, za, ox, oy, oz, dx, dy, k, maxS, beam, out = _hit) {
  rayZombie(type, id, flags, zx, zy, zz, za, ox, oy, oz, dx, dy, k, maxS, out);
  if (out.s >= 0 || !(beam > 0)) return out;
  const px = zx - ox, py = zy - oy;
  const t = px * dx + py * dy;
  if (t < 0 || t > maxS) return out;
  const cx = px - dx * t, cy = py - dy * t;
  const sc = (ZOMBIE_SCALE[type] || 1) * ((flags & 16) !== 0 ? ELITE_SCALE : 1);
  const r = 7 * sc + beam;
  const d2 = cx * cx + cy * cy;
  if (d2 > r * r) return out;
  const s = Math.max(0, t - Math.sqrt(r * r - d2));
  aimPoint(type, id, flags, 'head', _bh);
  aimPoint(type, id, flags, 'legs', _bl);
  const hz = oz + k * s - zz;
  const top = _bh.h + 5 * sc;
  if (hz < 0 || hz > top) return out;
  out.s = s;
  const f = hz / top;
  out.zone = hz >= _bh.h - 3 * sc ? ZONE.HEAD : hz <= _bl.h + 6 * sc ? ZONE.LEGS : f < 0.56 ? ZONE.STOMACH : ZONE.CHEST;
  return out;
}

/**
 * Where to aim at a zombie: the centre of its head or chest (or stomach / legs) in world
 * terms relative to its feet: { f (forward of its position along its facing), side, h (height
 * above its feet) }.
 * @param {string} part 'head' | 'chest' | 'stomach' | 'legs'
 */
export function aimPoint(type, id, flags, part, out = { f: 0, side: 0, h: 0 }) {
  const vols = zombieVolumes(type, id, variantOf(type, flags));
  const want = part === 'head' ? ZONE.HEAD : part === 'stomach' ? ZONE.STOMACH : part === 'legs' ? ZONE.LEGS : ZONE.CHEST;
  volumeScale(type, id, (flags & 16) !== 0, _sc);
  out.f = 0; out.side = 0; out.h = 30 * _sc[1];
  for (let i = 0, n = vols.count; i < n; i++) {
    const o = i * V;
    if (vols[o + 1] !== want) continue;
    // (the chest's first volume is the neck: take the box after it)
    if (want === ZONE.CHEST && vols[o] !== BOX) continue;
    const x = vols[o] === CAP ? (vols[o + 2] + vols[o + 5]) / 2 : vols[o + 2];
    const y = vols[o] === CAP ? (vols[o + 3] + vols[o + 6]) / 2 : vols[o + 3];
    const z = vols[o] === CAP ? (vols[o + 4] + vols[o + 7]) / 2 : vols[o + 4];
    out.f = x * _sc[0]; out.h = y * _sc[1]; out.side = z * _sc[2];
    return out;
  }
  return out;
}

/**
 * The volumes of a zombie in world space, for drawing (dev overlay): an array of
 * { zone, kind: 'cap' | 'box', a: [x, h, y], b: [x, h, y], r } (boxes as their 8 corners in
 * `corners` [[x, h, y], ...]).
 */
export function worldVolumes(type, id, flags, zx, zy, zz, za) {
  const vols = zombieVolumes(type, id, variantOf(type, flags));
  const sc = volumeScale(type, id, (flags & 16) !== 0, [1, 1, 1]);
  const ca = Math.cos(za), sa = Math.sin(za);
  const W = (x, y, z) => {
    const fx = x * sc[0], fy = y * sc[1], fz = z * sc[2];
    return [zx + fx * ca - fz * sa, zz + fy, zy + fx * sa + fz * ca];
  };
  const out = [];
  for (let i = 0, n = vols.count; i < n; i++) {
    const o = i * V;
    if (vols[o] === CAP) {
      const r = vols[o + 8] * Math.min(sc[0], sc[2]);
      out.push({ zone: vols[o + 1], kind: 'cap', a: W(vols[o + 2], vols[o + 3], vols[o + 4]), b: W(vols[o + 5], vols[o + 6], vols[o + 7]), r });
    } else {
      const c = vols[o + 8], s = vols[o + 9];
      const corners = [];
      for (const ex of [-1, 1]) for (const ey of [-1, 1]) for (const ez of [-1, 1]) {
        const bx = ex * vols[o + 5], by = ey * vols[o + 6];
        corners.push(W(vols[o + 2] + bx * c - by * s, vols[o + 3] + bx * s + by * c, vols[o + 4] + ez * vols[o + 7]));
      }
      out.push({ zone: vols[o + 1], kind: 'box', corners });
    }
  }
  return out;
}
