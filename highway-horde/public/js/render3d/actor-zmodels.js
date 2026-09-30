// Sculpted zombie models for the GPU rig (actor-rig.js), built procedurally with the
// organic shape builder (actor-shape.js). They are dead people, not dolls: adult human
// proportions (the head a seventh and a half of the body, shoulders no wider than a
// person's), a gaunt torso with a sunken belly, a costal arch, collarbones, hip bones,
// shoulder blades and a spine ridge (model-space relief on the near models; ribs, tendons
// and knuckles are the shader's relief, actor-zmat.js), long thin limbs with knobbly knees
// and elbows, bony hands with long fingers, a narrow skull with hollow temples and cheeks,
// deep sockets, small milky eyes under drooping lids, a slack jaw with receded lips over a
// narrow row of teeth. Eight silhouettes from zombies.js: the walker, the fresh and fuller
// runner, the legless crawler, the swollen bloater (a sagging, marbled belly), the spitter
// (a distended throat), the thin screamer with a long jaw, the brute (a hulk with bony
// growths, scar tissue and a club arm) and the boss (hump, bare spine, spurs, a third arm).
// Three LODs per type: full detail up close, no fingers/teeth/small gear at mid range, a
// light silhouette far away.
//
// One model per type and LOD serves every zombie of that type: the garments are shells
// whose hems, sleeves and trouser legs are cut per instance by the rig shader (torn strips
// hang below the cut on the near models), and the accessories (actor-zkit.js) are option
// groups the instance switches on (actor-zlook.js decides who wears what), so a horde of
// one type is still a single draw call per LOD.
//
// Model space: +X forward, +Y up, +Z right; feet on y = 0; ~56 units (1.7 m) tall at scale 1.

import { ShapeBuilder, SLOT, MAT, PART, lineRings } from './actor-shape.js';
import * as THREE from 'three';
import { B } from './actor-rig.js';
import { addAccessories } from './actor-zkit.js';
import { optionsForType } from './actor-zlook.js';
import { cinFaceRelief, cinFace } from './actor-zcin.js';

const _dc = new THREE.Color();

const TAU = Math.PI * 2;
const BONE = '#cfc4a2', NAIL = '#3a3026';
const FLESH = '#5e1616';
const gauss = (x, s) => Math.exp(-(x * x) / (s * s));
/** Two-bone weight spec (single bone when w is 0 or 1). */
const bw = (a, b, w) => (w <= 0 ? a : w >= 1 ? b : [a, b, w]);
const smooth01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/**
 * Base proportions (walker): a gaunt adult. Heights in model units (1 ≈ 3 cm): hip joint at
 * half the height, knee at 0.27, shoulder at 0.8, chin at 0.86; the head is 7.7 tall and 5.6
 * wide, the shoulders 44 across. `gaunt` 0..1.4 scales the wasting (sunken belly, bones
 * standing out), `upper` widens the chest and shoulders over the hips (the brute's V).
 */
const BASE = {
  hip: 28.2, knee: 15.4, ankle: 2.9, legGap: 2.9, thighR: 2.3, calfR: 1.72,
  waist: 32.4, chest: 38.4, sY: 45.0, sw: 6.5, uarm: 11.3, farm: 10.3, armR: 1.42, handS: 1,
  neck: 47.0, headC: [1.25, 52.5, 0], headR: [3.35, 3.85, 2.8], neckR: 1,
  bulk: 1, depth: 1, upper: 1, lean: 0, gaunt: 1,
  // (the skull carries only a rotted stump of a nose over the cavity: the nose itself is the
  // 'nose' option most zombies still wear, actor-zkit.js)
  legs: 'full', socket: 0.2, nose: 0.04, claws: false, jawDrop: 1, rArmK: 1, lArmK: 1, shellFrom: 1,
};

/** Per-type proportions (look.scale is applied by the renderer). */
export const ZPARAMS = {
  walker: {},
  // freshly turned: fuller, athletic, barely wasted
  runner: { bulk: 1.06, depth: 1.08, gaunt: 0.25, thighR: 2.6, calfR: 1.95, armR: 1.62, socket: 0.13, neckR: 1.08 },
  crawler: { bulk: 0.94, depth: 0.9, gaunt: 1.3, armR: 1.38, uarm: 12.2, farm: 11.4, legs: 'stumps', claws: true, socket: 0.24, nose: 0.03, thighR: 2.1 },
  bloater: { bulk: 1.3, depth: 1.32, gaunt: 0, thighR: 3.9, calfR: 3.0, armR: 2.5, handS: 1.16, sw: 7.7, headR: [3.45, 3.9, 3.0], headC: [1.5, 52.0, 0], neck: 46.6, neckR: 1.45, socket: 0.12, shellFrom: 4 },
  spitter: { bulk: 0.95, depth: 0.95, gaunt: 1.1, thighR: 2.25, calfR: 1.7, armR: 1.45, neck: 47.6, headC: [1.8, 53.3, 0], headR: [3.35, 3.9, 2.8], jawDrop: 1.3, socket: 0.22, neckR: 1.1 },
  screamer: { bulk: 0.86, depth: 0.85, gaunt: 1.4, armR: 1.25, uarm: 12.2, farm: 11.2, thighR: 1.95, calfR: 1.45, headR: [3.3, 4.05, 2.72], jawDrop: 1.6, jawW: 1.12, socket: 0.25, neckR: 0.9 },
  brute: { bulk: 1.3, depth: 1.45, upper: 1.28, gaunt: 0.3, thighR: 4.8, calfR: 3.9, armR: 3.1, handS: 1.45, sw: 10.2, uarm: 12.4, farm: 11.6, headR: [3.2, 3.55, 2.85], headC: [2.8, 50.9, 0], neck: 45.8, neckR: 1.9,
    claws: true, rArmK: 1.45, socket: 0.17, nose: 0.05 },
  boss: { bulk: 1.35, depth: 1.55, upper: 1.3, gaunt: 0.5, thighR: 5.4, calfR: 4.4, armR: 3.3, handS: 1.5, sw: 11.0, uarm: 12.8, farm: 12.2, headR: [3.15, 3.45, 2.8], headC: [3.0, 50.7, 0], neck: 45.4, neckR: 2.0,
    claws: true, socket: 0.2, nose: 0.02 },
};

const pcache = new Map();
function params(type) {
  let P = pcache.get(type);
  if (P) return P;
  P = { ...BASE, ...(ZPARAMS[type] || {}), type };
  P.loose = type === 'boss' ? 0.9 : type === 'brute' ? 0.7 : type === 'runner' ? 0.45 : 0.6;
  // the accessories (actor-zkit.js) sit on the top's shell: its front, back and side at a height
  P.fitD = P.depth * 0.76;
  P.fitK = P.bulk * 0.74 * (1 + (P.upper - 1) * 0.8);
  const sh = shellRings(P, torsoOf(P), P.shellFrom);
  P.frontX = (y) => { const s = ringAt(sh, y); return s.x + s.rx * 0.97; };
  P.backX = (y) => { const s = ringAt(sh, y); return s.x - s.rx * 0.92; };
  P.sideZ = (y) => ringAt(sh, y).rz;
  // the shell's surface at a height and a side offset: +1 its front, -1 its back (straps, cords)
  P.shellX = (y, z, face = 1) => {
    const s = ringAt(sh, y), u = Math.min(1, Math.abs(z) / s.rz);
    return s.x + face * s.rx * (face > 0 ? 0.97 : 0.92) * Math.sqrt(Math.max(0, 1 - u * u));
  };
  // the height where the shell's shoulder slope passes over side offset z (the crest a strap crosses)
  P.crestY = (z) => {
    for (let y = P.sY - 2; y < P.neck + 1; y += 0.1) if (ringAt(sh, y).rz < Math.abs(z)) return y;
    return P.neck + 1;
  };
  pcache.set(type, P);
  return P;
}

/**
 * The top's shell over the torso rings from `from` up (cloth hangs off a wasted body:
 * loose, and straight across the sunken belly), plus the collar ring.
 */
function shellRings(P, torsoRings, from) {
  const R = (i, k) => torsoRings[i][k];
  const loose = P.loose;
  const rings = [];
  for (let i = from; i <= 7; i++) {
    const r = torsoRings[i];
    const hang = (k) => (i > 0 && i < 7 ? Math.max(R(i, k), (R(i - 1, k) + R(i + 1, k)) * 0.5) : R(i, k));
    rings.push({ c: r.c.slice(), rx: hang('rx') + loose, rz: hang('rz') + loose * 1.1, bone: r.bone });
  }
  const top = torsoRings[8];
  rings.push({ c: [top.c[0] - 0.2, top.c[1] - 0.6, 0], rx: top.rx + 0.8, rz: top.rz + 1.0, bone: top.bone });
  return rings;
}

/** Skeleton pivots for the proportions (parents: actor-rig DEFAULT_PARENTS, X1/X2 per type). */
export function zombieSkeleton(type) {
  const P = params(type);
  const hc = P.headC;
  const piv = [];
  piv[B.HIPS] = [0, P.hip, 0];
  piv[B.SPINE] = [0, P.waist, 0];
  piv[B.CHEST] = [0, P.chest, 0];
  piv[B.NECK] = [0.3, P.neck, 0];
  piv[B.HEAD] = [hc[0] - 0.5, hc[1] - P.headR[1] * 0.62, 0];
  piv[B.JAW] = [hc[0] - 0.4, hc[1] - P.headR[1] * 0.2, 0];
  const armY = [P.sY, P.sY - P.uarm, P.sY - P.uarm - P.farm];
  const rk = P.rArmK;
  piv[B.UARM_L] = [0, armY[0], -P.sw];
  piv[B.FARM_L] = [0, armY[1], -P.sw];
  piv[B.HAND_L] = [0, armY[2], -P.sw];
  piv[B.UARM_R] = [0, armY[0], P.sw * (rk > 1 ? 1.06 : 1)];
  piv[B.FARM_R] = [0, P.sY - P.uarm * rk, P.sw * (rk > 1 ? 1.06 : 1)];
  piv[B.HAND_R] = [0, P.sY - (P.uarm + P.farm) * rk, P.sw * (rk > 1 ? 1.06 : 1)];
  piv[B.THIGH_L] = [0, P.hip, -P.legGap];
  piv[B.SHIN_L] = [0, P.knee, -P.legGap];
  piv[B.FOOT_L] = [0, P.ankle, -P.legGap];
  piv[B.THIGH_R] = [0, P.hip, P.legGap];
  piv[B.SHIN_R] = [0, P.knee, P.legGap];
  piv[B.FOOT_R] = [0, P.ankle, P.legGap];
  // extras: belly (bloater), throat sack (spitter), hump (boss) / third arm (boss)
  piv[B.X1] = type === 'bloater' ? [3, 33, 0] : type === 'spitter' ? [2.2, 47.4, 0] : type === 'boss' ? [-3, 44, 0] : [0, P.chest, 0];
  piv[B.X2] = type === 'boss' ? [-2.5, 42, -8.5] : [0, P.chest, 0];
  const parents = [-1, 0, 1, 2, 3, 4, 2, 6, 7, 2, 9, 10, 0, 12, 13, 0, 15, 16, 2, 2];
  if (type === 'bloater') parents[B.X1] = B.SPINE;
  if (type === 'spitter') parents[B.X1] = B.NECK;
  return { pivots: piv, parents, P };
}

/** The proportions of a type (for tests and the renderer's hit points). */
export function zombieParams(type) {
  return params(type);
}

// ---------------------------------------------------------------------------------------

// Quality tier of the build being made: 0 ultra (everything), 1 high (rounder-but-coarser
// meshes, only the big accessories), 2 low (coarser still, no accessories: variety then
// comes from the shader alone — hems, patterns, wounds, skin, colours).
let TIER = 0;
// -1 is the cinematic tier: LOD 0 only, everything smoother and with the hero details of actor-zcin.js
const CIN = () => TIER < 0;
const dq = (n) => (TIER < 0 ? Math.round(n * 1.75) : TIER >= 1 ? Math.max(5, Math.round(n * 0.78)) : n);
/** Ring subdivision of the hero body parts (cinematic only). */
const sd = (L) => (TIER < 0 && L === 0 ? 2 : 1);
/** Ring subdivision of the parts that carry anatomy relief (near models of ultra and cinematic). */
const sdRelief = (L, n) => (L !== 0 || TIER >= 1 ? 1 : TIER < 0 ? n + 1 : n);
/** Near model of ultra / cinematic: the one that carries the relief and the torn strips. */
const HERO = (L) => L === 0 && TIER <= 0;
/**
 * Cloth folds for a garment tube: creases that run round the limb and bunch near the joint
 * (`joint` = ring fraction of the elbow / knee); 1 + small waves, near models of ultra and cinematic.
 */
function folds(L, seed, amp, joint = 0.5, freq = 34) {
  if (!HERO(L)) return null;
  const a = TIER < 0 ? amp : amp * 0.7;
  return (th, t) => {
    const env = 0.35 + 0.65 * Math.exp(-((t - joint) * (t - joint)) / 0.045);
    return 1 + a * env * (0.6 * Math.sin(t * freq + th * 2 + seed) + 0.4 * Math.sin(t * freq * 1.73 - th * 3 + seed * 2.1));
  };
}
const withFolds = (base, f) => (base && f ? (th, t) => base(th, t) * f(th, t) : base || f || undefined);

/**
 * Build one zombie model.
 * @param {string} type zombies.js id
 * @param {number} L LOD 0 (near) · 1 (mid) · 2 (far)
 * @param {number} [tier] quality tier (-1 cinematic, 0 ultra, 1 high, 2 low)
 * @returns {ShapeBuilder}
 */
export function buildZombie(type, L, tier = 0) {
  TIER = tier < 0 && L > 0 ? 0 : tier;       // (the cinematic hero is LOD 0; the far levels are the ultra ones)
  try { return buildModel(type, L, tier); } finally { TIER = 0; }
}

function buildModel(type, L, tier) {
  const P = params(type);
  const sb = new ShapeBuilder();
  const seg = (a, b, c) => (L === 0 ? dq(a) : L === 1 ? b : c);
  const K = P.bulk, D = P.depth;
  const optSet = optionsForType(type);
  const has = (name) => optSet.has(name);

  // ---- torso ------------------------------------------------------------------------
  const torsoRings = torsoOf(P);
  const torsoProfile = (th, t) => {
    // flatter back and front, the chest a little fuller than the sunken belly
    const c = Math.cos(th), s = Math.sin(th);
    let k = 1 - 0.08 * Math.max(0, -c) - 0.03 * Math.max(0, c);
    k += 0.04 * (1 - P.gaunt * 0.5) * gauss(t - 0.62, 0.12) * Math.max(0, c) * (1 - Math.abs(s) * 0.4);
    return k;
  };
  sb.tube(torsoRings, {
    seg: seg(18, 9, 6), cap0: 'round', cap1: 'round', capRings: seg(3, 1, 1), profile: torsoProfile, dec: L === 2 ? 2 : 1,
    subdiv: sdRelief(L, 3) > 1 ? sdRelief(L, 3) : sd(L),
    slot: L < 2 ? SLOT.SKIN : SLOT.CLOTH, mat: L < 2 ? MAT.SKIN : MAT.CLOTH, color: '#ffffff', part: L < 2 ? PART.TORSO : PART.NONE,
    noise: L === 0 ? { amp: 0.1, freq: 0.5 } : null,
    disp: HERO(L) ? torsoRelief(P) : null, shade: torsoShade(P),
    paint: 0.12,
  });

  // ---- clothes: the top (a shell whose hem is cut per instance), sleeves ------------------
  const shell = L < 2 ? topShell(sb, P, L, torsoRings, torsoProfile, type) : null;

  // ---- hips / trousers ---------------------------------------------------------------
  sb.tube([
    { c: [0, P.hip - 4.4, 0], rx: 2.9 * D, rz: 4.3 * K, bone: B.HIPS },
    { c: [-0.15, P.hip - 1.5, 0], rx: 3.75 * D, rz: 5.5 * K, bone: B.HIPS },
    { c: [0.15, P.hip + 1.6, 0], rx: 3.5 * D, rz: 5.35 * K, bone: bw(B.HIPS, B.SPINE, 0.4) },
    { c: [0.3, P.waist + 0.6, 0], rx: 3.35 * D, rz: 5.0 * K, bone: B.SPINE },
  ], { seg: seg(16, 8, 6), subdiv: sd(L), cap0: 'round', capRings: seg(2, 1, 1), slot: SLOT.CLOTH2, mat: MAT.CLOTH, color: '#ffffff', paint: 0.35, part: PART.PELVIS,
    noise: L === 0 ? { amp: 0.12, freq: 0.5, seed: 9 } : null });
  if (L === 0) {
    // a belt cinched round a waist that has shrunk inside the trousers
    sb.tube(lineRings([0.3, P.waist - 0.2, 0], [0.3, P.waist + 1.1, 0], 3.45 * D, 3.45 * D, 2, (r) => { r.rz = 5.1 * K; r.rx = 3.45 * D; }),
      { seg: 16, slot: SLOT.FIXED, mat: MAT.LEATHER, color: '#2a1e16', bone: B.SPINE });
  }

  // ---- legs ---------------------------------------------------------------------------
  for (const side of [-1, 1]) legs(sb, P, L, side, type);

  // ---- arms ---------------------------------------------------------------------------
  for (const side of [-1, 1]) arm(sb, P, L, side, type);

  // ---- neck + head --------------------------------------------------------------------
  const headDef = head(sb, P, L, type);

  // ---- torn strips below the top's hem (near models of high, ultra and cinematic) --------
  if (L === 0 && tier < 2 && shell && P.shellFrom <= 1) tatters(sb, P, shell);

  // ---- accessories (hats, hair, gear, gore, armour) ------------------------------------
  if (tier < 2) addAccessories(sb, P, tier <= 0 ? L : Math.max(L, 1), headDef, has, CIN() && L === 0);

  // ---- per-type extras ----------------------------------------------------------------
  extras(sb, P, L, type);
  return sb;
}

/** Torso cross-sections: [x offset, y, front-back radius, half width, bones] from the pelvis up to the neck. */
function torsoOf(P) {
  const g = P.gaunt, K = P.bulk, D = P.depth, U = P.upper;
  const up = (i) => (i >= 4 ? U : i === 3 ? 1 + (U - 1) * 0.5 : 1);
  const T = [
    [-0.3, P.hip - 1.6, 3.4, 5.1, B.HIPS],                                   // buttocks
    [0.0, P.hip + 1.3, 3.15, 4.85 + 0.1 * g, bw(B.HIPS, B.SPINE, 0.5)],      // iliac crest (hip bones jut when wasted)
    [0.3, P.waist + 0.3, 3.05 - 0.3 * g, 4.55 - 0.25 * g, B.SPINE],          // waist: the belly sinks
    [0.45, P.waist + 3.2, 3.15, 4.65, bw(B.SPINE, B.CHEST, 0.5)],            // costal arch
    [0.35, P.chest + 0.6, 3.45, 5.0, B.CHEST],                              // ribcage
    [0.2, P.chest + 3.3, 3.55, 5.4, B.CHEST],                               // upper chest
    [-0.2, P.sY - 0.9, 3.15, 5.75, B.CHEST],                                // armpits
    [-0.45, P.sY + 0.55, 2.4, 4.9, B.CHEST],                                // trapezius slope
    [0.0, P.neck + 0.3, 1.7 * P.neckR, 2.1 * P.neckR, bw(B.CHEST, B.NECK, 0.3)],
  ];
  return T.map(([x, y, rx, rz, bone], i) => ({
    c: [x + P.lean * (y - P.hip) * 0.05, y, 0],
    rx: rx * (i < 8 ? D * (i >= 4 ? 1 + (U - 1) * 0.6 : 1) : 1), rz: rz * (i < 8 ? K * up(i) : Math.max(1, K * 0.8)), bone,
  }));
}

/**
 * Model-space relief of the bare torso (radial offset): the belly sunk under the ribs, the
 * costal arch, collarbones with the hollows above them, the sternal notch, hip bones, the
 * spine ridge and the shoulder blades. Scaled by how wasted the type is.
 */
function torsoRelief(P) {
  const g = P.gaunt, K = P.bulk * P.upper;
  return (x, y, z, ux) => {
    const front = Math.max(0, ux), back = Math.max(0, -ux), az = Math.abs(z);
    let d = 0;
    d -= 0.42 * g * gauss(y - (P.waist + 0.6), 2.4) * front * front;
    const arch = P.waist + 4.4 - az * 0.5 / K;
    d += 0.24 * g * gauss(y - arch, 0.75) * front * smooth01(az / (1.1 * K));
    const cy = P.sY + 0.05 + az * 0.05;
    d += 0.3 * g * gauss(y - cy, 0.5) * smooth01((az - 0.5) / 0.8) * smooth01((P.sw * 0.95 - az) / 1.2) * front;
    d -= 0.3 * g * gauss(y - cy - 1.0, 0.55) * gauss(az - 2.3 * K, 1.0) * front;
    d -= 0.22 * g * gauss(y - (P.sY + 0.6), 0.55) * gauss(z, 0.6) * front;
    d += 0.08 * g * gauss(z, 0.45) * gauss(y - (P.chest + 1.5), 3.5) * front;
    for (const s of [-1, 1]) d += 0.28 * g * gauss(y - (P.hip + 1.8), 0.9) * gauss(z - s * 4.0 * P.bulk, 0.9) * (0.3 + front);
    d += 0.15 * g * gauss(z, 0.4) * back * smooth01((y - P.hip) / 3) * smooth01((P.neck - y) / 2);
    for (const s of [-1, 1]) d += 0.26 * g * gauss(y - (P.chest + 3.2), 2.0) * gauss(z - s * 2.9 * K, 1.3) * back;
    return d;
  };
}

function topShell(sb, P, L, torsoRings, profile, type) {
  const D = P.depth, K = P.bulk;
  const rings = [];
  if (P.shellFrom <= 1) {
    // the skirt of a coat or gown, hanging from the hips (the hem is cut per instance)
    rings.push({ c: [0.3, P.knee - 1.5, 0], rx: 5.6 * D, rz: 7.6 * K, bone: B.HIPS });
    rings.push({ c: [0.35, P.knee + 1.5, 0], rx: 5.2 * D, rz: 7.1 * K, bone: B.HIPS });
    rings.push({ c: [0.3, P.hip - 8.5, 0], rx: 4.75 * D, rz: 6.5 * K, bone: B.HIPS });
    rings.push({ c: [0.2, P.hip - 4.0, 0], rx: 4.4 * D, rz: 6.0 * K, bone: B.HIPS });
  }
  rings.push(...shellRings(P, torsoRings, P.shellFrom));
  sb.tube(rings, {
    seg: L === 0 ? dq(20) : 8, profile: withFolds(profile, folds(L, 1.3, 0.024, 0.55, 26)), subdiv: HERO(L) ? 2 : sd(L), slot: SLOT.CLOTH, mat: MAT.TEAR, color: '#ffffff', part: PART.TOP,
    noise: L === 0 ? { amp: 0.3, freq: 0.3, seed: 5 } : null, shade: torsoShade(P), paint: (x, y) => (y < P.hip + 3 ? 0.55 : y > P.chest + 2 ? 0.4 : 0.28),
  });
  if (type === 'boss' && L < 2) {
    // tattered cape hanging off the boss' back
    sb.tube([
      { c: [-5.2, P.sY + 1, 0], rx: 1.2, rz: 9, bone: B.CHEST },
      { c: [-6.8, P.chest - 3, 0], rx: 1.4, rz: 10, bone: B.CHEST },
      { c: [-7.2, P.hip - 6, 0], rx: 1.6, rz: 11, bone: bw(B.CHEST, B.HIPS, 0.6) },
      { c: [-6.5, P.knee - 2, 0], rx: 1.5, rz: 11.5, bone: B.HIPS },
    ], { seg: L ? 8 : 16, slot: SLOT.CLOTH, mat: MAT.TEAR, color: '#bdbdbd', noise: { amp: 0.9, freq: 0.2 }, part: PART.TOP });
  }
  return rings;
}

/** A ring list's radii at height y (linear between rings, flaring a little below the lowest). */
function ringAt(rings, y) {
  const lo = rings[0];
  if (y <= lo.c[1]) { const f = (lo.c[1] - y) * 0.06; return { x: lo.c[0], rx: (lo.rx ?? lo.r) + f, rz: (lo.rz ?? lo.r) + f * 1.2 }; }
  for (let i = 1; i < rings.length; i++) {
    const a = rings[i - 1], b = rings[i];
    if (y <= b.c[1]) {
      const t = (y - a.c[1]) / Math.max(1e-4, b.c[1] - a.c[1]);
      return { x: a.c[0] + (b.c[0] - a.c[0]) * t, rx: (a.rx ?? a.r) + ((b.rx ?? b.r) - (a.rx ?? a.r)) * t, rz: (a.rz ?? a.r) + ((b.rz ?? b.r) - (a.rz ?? a.r)) * t };
    }
  }
  const e = rings[rings.length - 1];
  return { x: e.c[0], rx: e.rx ?? e.r, rz: e.rz ?? e.r };
}

/**
 * Torn strips of the top round the hips: the shader keeps a strip only in a band below the
 * instance's hem (its length per strip and instance), so the hem frays into hanging rags
 * wherever it was cut. The strips lie on the shell itself, a hair outside it.
 */
function tatters(sb, P, shell) {
  const nTop = TIER < 0 ? 16 : 11;
  const y0 = P.chest + 1, y1 = P.knee - 1;
  for (let i = 0; i < nTop; i++) {
    const a0 = (i / nTop) * TAU + ((i * 0.618) % 1) * 0.2, w = 0.28 + ((i * 0.37) % 1) * 0.2;
    const front = Math.cos(a0 + w / 2), right = Math.sin(a0 + w / 2);
    const pts = [];
    for (let k = 0; k <= 8; k++) {
      const y = y0 - k * ((y0 - y1) / 8);
      const s = ringAt(shell, y);
      // strips over the thighs follow them a little when the legs swing
      const leg = y < P.hip - 3 && front > 0.2 ? (right > 0 ? B.THIGH_R : B.THIGH_L) : -1;
      pts.push({ c: [s.x, y, 0], rx: s.rx + 0.06, rz: s.rz + 0.06, bone: y > P.waist ? B.SPINE : leg >= 0 ? bw(B.HIPS, leg, Math.min(0.45, (P.hip - 3 - y) * 0.06)) : B.HIPS });
    }
    sb.tube(pts, { seg: TIER < 0 ? 4 : 2, arc: [a0, a0 + w], ref: [1, 0, 0], slot: SLOT.CLOTH, mat: MAT.TEAR, color: '#e8e8e8', part: PART.TATTER, paint: 0.4 });
  }
}

/** Torn strips of a trouser leg (on its shell, below the per-instance hem). */
function legTatters(sb, P, side, shell, TH, SH) {
  const n = TIER < 0 ? 8 : 6;
  const y0 = P.hip - 4, y1 = P.ankle + 1;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TAU + side * 0.4 + ((i * 0.41) % 1) * 0.3, w = 0.42 + ((i * 0.53) % 1) * 0.25;
    const pts = [];
    for (let k = 0; k <= 8; k++) {
      const y = y0 - k * ((y0 - y1) / 8);
      const s = ringAt(shell, y);
      const kn = y > P.knee + 2 ? 0 : y > P.knee - 2 ? 0.5 : 1;
      pts.push({ c: [s.x, y, side * P.legGap], rx: s.rx + 0.06, rz: s.rz + 0.06, bone: bw(TH, SH, kn) });
    }
    sb.tube(pts, { seg: TIER < 0 ? 4 : 2, arc: [a0, a0 + w], ref: [1, 0, 0], slot: SLOT.CLOTH2, mat: MAT.TEAR, color: '#e8e8e8', part: PART.LTATTER, paint: 0.45 });
  }
}

// Baked cavity occlusion (vertex colour): where the body hides itself from the sky — the flanks
// under the arms, the inside of the arms and thighs, the throat under the jaw. Under a high sun
// the ambient fill otherwise lights a body as evenly as a doll's.
function torsoShade(P) {
  return (x, y, z, nx, ny, nz) => {
    const env = smooth01((y - P.waist + 3) / 5) * smooth01((P.sY + 0.2 - y) / 2.5);
    const side = Math.max(0, Math.abs(nz)) ** 2;
    return 1 - 0.3 * side * env - 0.12 * Math.max(0, -ny) * smooth01((P.hip + 2 - y) / 3);
  };
}
function limbShade(side, top, bottom, k) {
  return (x, y, z, nx, ny, nz) => 1 - k * Math.max(0, -nz * side) * smooth01((y - bottom) / 3) * (0.6 + 0.4 * smooth01((y - (top - 4)) / 3));
}
function neckShade(P) {
  return (x, y, z, nx, ny) => 1 - 0.38 * Math.max(0, nx + 0.2) * smooth01((y - P.neck) / 2.5) - 0.2 * Math.max(0, -ny);
}

/** Relief of a bare leg: the kneecap and the shin bone, the ankle bones. */
function legRelief(P, z0) {
  const g = Math.max(0.35, P.gaunt);
  return (x, y, z, ux, uy, uz) => {
    const front = Math.max(0, ux), side = Math.abs(uz);
    let d = 0.34 * g * gauss(y - (P.knee + 0.4), 1.0) * front * front;              // patella
    d -= 0.12 * g * gauss(y - (P.knee + 2.2), 0.8) * (0.4 + front);                  // the dip above it
    d += 0.1 * g * smooth01((P.knee - 1.5 - y) / 2) * smooth01((y - P.ankle - 3) / 2) * gauss(uz, 0.35) * front;   // shin
    d += 0.18 * g * gauss(y - (P.ankle + 0.4), 0.55) * side;                          // malleoli
    return d;
  };
}

function legs(sb, P, L, side, type) {
  const z = side * P.legGap;
  const TH = side < 0 ? B.THIGH_L : B.THIGH_R, SH = side < 0 ? B.SHIN_L : B.SHIN_R, FT = side < 0 ? B.FOOT_L : B.FOOT_R;
  const tr = P.thighR, cr = P.calfR;
  const seg = L === 0 ? dq(12) : L === 1 ? 6 : 5;
  const legSlot = SLOT.CLOTH2;
  if (P.legs === 'stumps') {
    // legs torn off below the knee: thigh + ragged stump with the bone showing
    sb.tube([
      { c: [0, P.hip + 1, z * 0.9], r: tr * 1.05, bone: bw(B.HIPS, TH, 0.6) },
      { c: [0.2, P.hip - 5, z], r: tr * 0.9, bone: TH },
      { c: [0.3, P.knee + 2, z], r: tr * 0.7, bone: TH },
      { c: [0.3, P.knee - 1.5, z], r: tr * 0.6, bone: bw(TH, SH, 0.6), paint: 1 },
    ], { seg, cap0: 'round', cap1: 'flat', slot: legSlot, mat: MAT.CLOTH, color: '#ffffff', paint: 0.3, part: PART.LEG });
    sb.ellipsoid([0.3, P.knee - 1.8, z], [tr * 0.58, 0.9, tr * 0.58], { segW: seg, segH: 3, slot: SLOT.FIXED, mat: MAT.FLESH, color: FLESH, bone: SH, paint: 0.9 });
    if (L < 2) sb.tube(lineRings([0.3, P.knee - 1, z], [0.4, P.knee - 4.5, z + side * 0.3], 0.55, 0.4, 3), { seg: 5, cap1: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.BONE, color: BONE, bone: SH });
    return;
  }
  const kneeY = P.knee, hip = P.hip, ank = P.ankle;
  const rings = [
    { c: [0.1, hip + 1.2, z * 0.92], r: tr * 1.08, bone: bw(B.HIPS, TH, 0.55) },
    { c: [0.35, hip - 3.5, z], rx: tr * 0.96, rz: tr * 0.9, bone: TH },
    { c: [0.4, hip - 7.8, z], rx: tr * 0.8, rz: tr * 0.74, bone: TH },
    { c: [0.35, kneeY + 2.5, z], rx: tr * 0.7, rz: tr * 0.66, bone: bw(TH, SH, 0.15) },
    { c: [0.5, kneeY + 0.2, z], rx: tr * 0.78, rz: tr * 0.74, bone: bw(TH, SH, 0.5) },
    { c: [0.25, kneeY - 2.2, z], rx: cr * 0.9, rz: cr * 0.84, bone: bw(TH, SH, 0.85) },
    { c: [-0.4, kneeY - 5.2, z], rx: cr * 1.02, rz: cr * 0.86, bone: SH },
    { c: [0.0, ank + 3.6, z], rx: cr * 0.62, rz: cr * 0.58, bone: SH },
    { c: [0.1, ank + 0.6, z], rx: cr * 0.58, rz: cr * 0.66, bone: bw(SH, FT, 0.4) },
  ];
  // one shell: trousers above the per-instance hem, bare skin below it (the shader decides);
  // the knee's knob is smoothed out of the cloth, which hangs loose on a wasted leg
  const pr = rings.map((r, i) => {
    const rx = r.rx ?? r.r, rz = r.rz ?? r.r;
    const bag = i === 3 || i === 4 ? Math.max(0, (rings[2].rx - rx) * 0.6) : 0;
    return { ...r, rx: rx + 0.42 + bag + (i > 5 ? 0.22 : 0), rz: rz + 0.42 + bag * 0.8 + (i > 5 ? 0.2 : 0), r: undefined };
  });
  sb.tube(HERO(L) ? rings.map((r) => ({ ...r })) : pr, {
    seg, subdiv: HERO(L) ? sdRelief(L, 2) : sd(L), profile: HERO(L) ? null : folds(L, side * 2.1, 0.03, 0.55, 30), cap0: 'round', capRings: 1,
    slot: HERO(L) ? SLOT.SKIN : legSlot, mat: HERO(L) ? MAT.SKIN : MAT.CLOTH, color: '#ffffff', paint: (x, y) => (y < kneeY - 3 ? 0.5 : 0.28), dec: L === 2 ? 2 : 1,
    noise: L === 0 ? { amp: 0.12, freq: 0.45, seed: side * 3 } : null, part: HERO(L) ? PART.LIMB : PART.LEG, disp: HERO(L) ? legRelief(P, z) : null, shade: limbShade(side, hip, kneeY - 6, 0.26),
  });
  if (HERO(L)) {
    // near models: the bony leg is its own skin and the trousers a loose shell over it (cut
    // away below the per-instance hem), fraying into strips
    sb.tube(pr, { seg, subdiv: sd(L), profile: folds(L, side * 2.1, 0.03, 0.55, 30), slot: legSlot, mat: MAT.CLOTH, color: '#ffffff', paint: (x, y) => (y < kneeY - 3 ? 0.5 : 0.28),
      noise: { amp: 0.2, freq: 0.35, seed: side * 3 }, part: PART.TROUSER, cap0: 'round', capRings: 1, shade: limbShade(side, hip, kneeY - 6, 0.26) });
    legTatters(sb, P, side, pr.slice().reverse(), TH, SH);
  }
  // the foot: bare skin (toes), shoes are option groups over it
  const fx = 1.6;
  sb.ellipsoid([fx, 1.05, z], [3.1, 1.15, 1.4], { segW: L ? 7 : 12, segH: L ? 4 : 6, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#e0e0e0', bone: FT, paint: 0.7, part: PART.FOOT,
    deform: (p) => { if (p.y < 0) p.y *= 0.5; if (p.x > 0.4) p.y *= 0.75; } });
  if (L === 0) {
    for (let t = 0; t < 4; t++) {
      sb.ellipsoid([fx + 2.85, 0.55, z + side * (-0.6 + t * 0.4)], [0.5, 0.4, 0.25], { segW: 5, segH: 3, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#d0d0d0', bone: FT, paint: 0.7, part: PART.FOOT });
    }
  }
  if (L < 2) shoes(sb, P, L, side, z, FT, SH, ank, cr);
}

function shoes(sb, P, L, side, z, FT, SH, ank, cr) {
  // one shoe for everybody: the shaft (boots) and the sole colour (sneakers) are per instance
  const fx = 1.6;
  const seg = L ? 6 : 10, segH = L ? 4 : 5;
  const S = { opt: 'shoe', bone: FT };
  sb.ellipsoid([fx + 0.12, 1.6, z], [3.75, 1.8, 1.72], { ...S, slot: SLOT.TRIM, part: PART.SHOE, segW: seg, segH, mat: MAT.LEATHER, color: '#ffffff', paint: 0.45,
    deform: (p) => { if (p.y < -0.2) p.y = -0.2 - (p.y + 0.2) * 0.25; if (p.x < -0.2 && p.y > 0) p.x *= 0.8; if (p.x > 0.5) p.y *= 0.85; } });
  sb.ellipsoid([fx + 0.2, 0.4, z], [3.9, 0.5, 1.8], { ...S, slot: SLOT.FIXED, part: PART.SOLE, segW: L ? 7 : 10, segH: 3, mat: MAT.RUBBER, color: '#ffffff' });
  if (L === 0) {
    sb.tube([{ c: [0.05, ank + 3.0, z], rx: cr * 0.66 + 0.6, rz: cr * 0.62 + 0.55, bone: SH }, { c: [0.15, ank + 7.5, z], rx: cr * 0.92 + 0.5, rz: cr * 0.86 + 0.45, bone: SH }, { c: [0.2, ank + 8.2, z], rx: cr * 0.92 + 0.3, rz: cr * 0.86 + 0.3, bone: SH }],
      { ...S, seg: 8, slot: SLOT.TRIM, part: PART.SHAFT, mat: MAT.LEATHER, color: '#ffffff', paint: 0.35, cap1: 'flat' });
  }
}

/** Relief of a bare arm: the point of the elbow and the wrist bone. */
function armRelief(P, elbow, wrist, side) {
  const g = Math.max(0.35, P.gaunt);
  return (x, y, z, ux, uy, uz) => {
    const back = Math.max(0, -ux);
    let d = 0.3 * g * gauss(y - elbow, 0.9) * back * back;                          // olecranon
    d += 0.12 * g * gauss(y - (elbow - 1.2), 1.0) * Math.max(0, uz * side);          // epicondyle
    d += 0.12 * g * gauss(y - (wrist + 0.6), 0.5) * Math.max(0, -uz * side);          // ulnar head
    d -= 0.08 * g * gauss(y - (elbow + 2.4), 1.5) * (1 - Math.abs(ux));               // wasted biceps
    return d;
  };
}

function arm(sb, P, L, side, type) {
  const R = side > 0;
  const k = R ? P.rArmK : P.lArmK;
  const UA = R ? B.UARM_R : B.UARM_L, FA = R ? B.FARM_R : B.FARM_L, HD = R ? B.HAND_R : B.HAND_L;
  const z = side * P.sw * (R && k > 1 ? 1.06 : 1);
  const top = P.sY, elbow = P.sY - P.uarm * k, wrist = P.sY - (P.uarm + P.farm) * k;
  const r = P.armR * k;
  const seg = L === 0 ? dq(12) : L === 1 ? 6 : 5;
  const rings = [
    { c: [-0.2, top - 0.1, z * 0.9], r: r * 1.0, bone: [B.CHEST, UA, 0.55] },
    { c: [0.1, top - 1.6, z * 1.0], rx: r * 1.06, rz: r * 0.98, bone: UA },
    { c: [0.0, top - P.uarm * k * 0.45, z], rx: r * 0.86, rz: r * 0.8, bone: UA },
    { c: [-0.15, elbow + 1.5, z], rx: r * 0.74, rz: r * 0.72, bone: [UA, FA, 0.2] },
    { c: [-0.3, elbow, z], rx: r * 0.84, rz: r * 0.8, bone: [UA, FA, 0.5] },
    { c: [0.05, elbow - 2.4, z], rx: r * 0.88, rz: r * 0.8, bone: [UA, FA, 0.85] },
    { c: [0.2, wrist + 3.2, z], rx: r * 0.56, rz: r * 0.62, bone: FA },
    { c: [0.2, wrist + 0.3, z], rx: r * 0.45, rz: r * 0.62, bone: [FA, HD, 0.5] },
  ];
  sb.tube(rings, { seg, subdiv: sdRelief(L, 2) > 1 ? sdRelief(L, 2) : sd(L), cap0: 'round', capRings: L ? 1 : 2, cap1: 'flat', slot: SLOT.SKIN, mat: MAT.SKIN, color: '#ffffff', dec: L === 2 ? 2 : 1,
    paint: (x, y) => (y < elbow ? 0.45 : 0.15), noise: L === 0 ? { amp: 0.08 * k, freq: 0.6, seed: side } : null, part: L < 2 ? PART.LIMB : PART.NONE,
    disp: HERO(L) ? armRelief(P, elbow, wrist, side) : null, shade: limbShade(side, top, wrist, 0.3) });
  // sleeves: long, cut to length per instance; loose over the thin arm (the elbow's knob does not show through)
  if (L < 2) {
    const srings = rings.slice(0, 7).map((q, i) => {
      const bag = i >= 3 && i <= 5 ? Math.max(0, (rings[2].rx - (q.rx ?? q.r)) * 0.7) : 0;
      return { ...q, rx: (q.rx ?? q.r) + 0.5 + bag, rz: (q.rz ?? q.r) + 0.5 + bag, r: undefined };
    });
    sb.tube(srings, { seg, subdiv: sd(L), profile: folds(L, side * 1.7, 0.04, 0.62, 32), slot: SLOT.CLOTH, mat: MAT.TEAR, color: '#ffffff', paint: 0.25, part: PART.SLEEVE, noise: L === 0 ? { amp: 0.22, freq: 0.5 } : null, shade: limbShade(side, top, wrist, 0.3) });
  }
  hand(sb, P, L, side, HD, [0.3, wrist, z], r, k);
}

function hand(sb, P, L, side, HD, w, r, k) {
  const s = P.handS * k;
  const claw = P.claws;
  const H = { part: PART.HAND };
  // palm: narrow and bony
  sb.ellipsoid([w[0] + 0.25 * s, w[1] - 1.8 * s, w[2]], [0.82 * s, 1.85 * s, 1.4 * s], {
    ...H, segW: L === 0 ? dq(10) : L === 1 ? 7 : 5, segH: L === 0 ? dq(6) : 4, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#f0f0f0', bone: HD, paint: 0.55,
    deform: (p) => { if (p.x > 0) p.x *= 0.8; },
  });
  if (L === 2) return;
  if (L === 1) {
    // mitten of fingers
    sb.ellipsoid([w[0] + 0.7 * s, w[1] - 4.1 * s, w[2]], [0.6 * s, 1.7 * s, 1.25 * s], { ...H, segW: 6, segH: 4, rot: [0, 0, 0.4], slot: SLOT.SKIN, mat: MAT.SKIN, color: '#e8e8e8', bone: HD, paint: 0.55 });
    return;
  }
  // fingers: long, bony, curled forward (zombie hands reach), claws on some types
  const cinH = CIN();
  for (let f = 0; f < 4; f++) {
    const fz = w[2] + side * (-0.95 + f * 0.63) * s;
    const len = [2.5, 2.9, 2.75, 2.15][f] * s * (claw ? 1.05 : 1);
    const x0 = w[0] + 0.45 * s, y0 = w[1] - 3.45 * s;
    const pts = [];
    const JN = cinH ? 6 : 4;
    const curl0 = 0.9 + ((f * 0.37) % 1) * 0.5;
    for (let j = 0; j <= JN; j++) {
      const t = j / JN, curl = t * t * curl0;
      // knuckles swell over the wasted finger at each joint
      const knuckle = 1 + (cinH ? 0.2 : 0.14) * (gauss(t - 0.02, 0.08) + gauss(t - 0.42, 0.07) + gauss(t - 0.74, 0.06));
      pts.push({ c: [x0 + Math.sin(curl) * len * t, y0 - Math.cos(curl * 0.8) * len * t, fz], r: 0.3 * s * (1 - t * 0.3) * knuckle });
    }
    sb.tube(pts, { ...H, seg: cinH ? 10 : 6, subdiv: cinH ? 2 : 1, cap0: 'round', cap1: 'round', capRings: 1, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#e6e6e6', bone: HD, paint: 0.6 });
    const tip = pts[JN].c;
    if (claw) {
      sb.tube(lineRings([tip[0] - 0.1, tip[1] + 0.2, tip[2]], [tip[0] + 0.8 * s, tip[1] - 1.1 * s, tip[2]], 0.22 * s, 0.02, 3), { seg: 5, slot: SLOT.FIXED, mat: MAT.BONE, color: '#9a8c70', bone: HD });
    } else {
      sb.ellipsoid([tip[0] + 0.1, tip[1] + 0.08, tip[2]], [0.22 * s, 0.3 * s, 0.24 * s], { segW: cinH ? 10 : 5, segH: cinH ? 6 : 3, slot: SLOT.FIXED, mat: MAT.BONE, color: NAIL, bone: HD });
    }
  }
  // thumb
  const tz = w[2] - side * 1.05 * s;
  sb.tube(lineRings([w[0] + 0.7 * s, w[1] - 1.2 * s, tz], [w[0] + 1.9 * s, w[1] - 3.3 * s, tz - side * 0.25 * s], 0.36 * s, 0.27 * s, 4,
    (q, t) => { q.r *= 1 + 0.15 * gauss(t - 0.5, 0.15); }), { ...H, seg: 6, cap1: 'round', capRings: 1, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#e6e6e6', bone: HD, paint: 0.55 });
}

// ---------------------------------------------------------------------------------------
// head

function headDeform(P, type) {
  const sock = P.socket, nose = P.nose, g = P.gaunt;
  return (p) => {
    let k = 1;
    const front = smooth01((p.x - 0.35) / 0.4);
    const az = Math.abs(p.z);
    // cranium: fuller at the back and crown, flatter at the sides
    k += 0.06 * gauss(p.y - 0.45, 0.35) * smooth01(-p.x * 2);
    k -= 0.03 * gauss(az - 1, 0.35) * gauss(p.y - 0.1, 0.5);
    // hollow temples
    k -= (0.045 + 0.035 * g) * gauss(p.y - 0.2, 0.2) * gauss(az - 0.75, 0.2) * smooth01((p.x + 0.15) / 0.4);
    // lower face narrows toward the chin
    if (p.y < -0.25) k -= smooth01((-0.25 - p.y) / 0.6) * (0.15 + 0.1 * front);
    // the mouth: below the upper lip the face recedes into a dark hollow that the jaw
    // (a separate hinged part) covers when closed and reveals when it hangs open
    k -= 0.3 * smooth01((-0.36 - p.y) / 0.16) * smooth01((p.x - 0.3) / 0.3) * gauss(p.z, 0.46);
    // brow ridge (a bar over the sockets, lower in the middle)
    k += 0.08 * gauss(p.y - 0.3 + gauss(p.z, 0.2) * 0.04, 0.085) * front;
    // deep sockets
    for (const s of [-1, 1]) k -= sock * gauss(p.y - 0.1, 0.14) * gauss(p.z - s * 0.36, 0.17) * front;
    // sharp cheekbones, the cheeks sunk under them
    for (const s of [-1, 1]) k += (0.045 + 0.03 * g) * gauss(p.y + 0.08, 0.1) * gauss(p.z - s * 0.56, 0.14) * front;
    for (const s of [-1, 1]) k -= (0.04 + 0.06 * g) * gauss(p.y + 0.36, 0.14) * gauss(p.z - s * 0.5, 0.18) * front;
    // nose (often rotted down to the cavity)
    k += nose * gauss(p.z, 0.085) * gauss(p.y + 0.08, 0.2) * smooth01((p.x - 0.75) / 0.2);
    if (nose < 0.08) k -= 0.06 * gauss(p.z, 0.09) * gauss(p.y + 0.12, 0.08) * front;
    p.x *= k; p.y *= k; p.z *= k;
    if (type === 'brute' || type === 'boss') { if (p.y > 0.3) p.y *= 0.85; }
  };
}

/** Point on the (deformed) head surface for unit direction (x, y, z) — for eyes/ears. */
function headPoint(P, x, y, z, def, inset = 1) {
  const l = Math.hypot(x, y, z);
  const p = { x: x / l, y: y / l, z: z / l };
  def(p);
  const c = P.headC, r = P.headR;
  return [c[0] + p.x * r[0] * inset, c[1] + p.y * r[1] * inset, c[2] + p.z * r[2] * inset];
}

function head(sb, P, L, type) {
  const c = P.headC, r = P.headR;
  const cin = CIN() && L === 0;
  let def = headDeform(P, type);
  if (cin) {
    const base = def, relief = cinFaceRelief(P);
    def = (p) => { base(p); relief(p); };
  }
  // a thin neck with the tendons standing out
  const nk = P.neckR;
  sb.tube([
    { c: [0.0, P.neck - 1.6, 0], rx: 1.95 * nk, rz: 2.3 * nk, bone: [B.CHEST, B.NECK, 0.3] },
    { c: [0.35, P.neck + 0.9, 0], rx: 1.55 * nk, rz: 1.65 * nk, bone: B.NECK },
    { c: [c[0] - 0.9, c[1] - r[1] * 0.55, 0], rx: 1.7 * nk, rz: 1.8 * nk, bone: [B.NECK, B.HEAD, 0.7] },
  ], { seg: L === 0 ? dq(14) : 7, subdiv: sd(L) > 1 ? 4 : L === 0 ? 2 : 1, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#f2f2f2', paint: 0.3, part: L < 2 ? PART.TORSO : PART.NONE, shade: neckShade(P),
    profile: L === 0 ? (th) => 1 + 0.12 * Math.pow(Math.abs(Math.cos(th - 0.6)), 8) + 0.12 * Math.pow(Math.abs(Math.cos(th + 0.6)), 8) + 0.05 * Math.pow(Math.max(0, Math.cos(th)), 12) - 0.05 * Math.pow(Math.max(0, -Math.cos(th)), 2) : null });
  // skull (the mouth hollow is dark wet flesh)
  const inMouth = (x, y, z) => {
    const ux = (x - c[0]) / r[0], uy = (y - c[1]) / r[1], uz = z / r[2];
    return uy < -0.3 && ux > 0.1 && ux < 0.8 && Math.abs(uz) < 0.46;
  };
  sb.ellipsoid(c, r, { segW: L === 0 ? (cin ? 72 : dq(34)) : L === 1 ? 12 : 8, segH: L === 0 ? (cin ? 52 : dq(26)) : L === 1 ? 9 : 6, deform: def,
    slot: SLOT.SKIN, mat: MAT.SKIN, color: '#ffffff', bone: B.HEAD, part: L < 2 ? PART.HEAD : PART.NONE,
    colorFn: L < 2 ? (x, y, z) => {
      if (inMouth(x, y, z)) return '#2a0808';
      const ux = (x - c[0]) / r[0], uy = (y - c[1]) / r[1], uz = z / r[2];
      if (ux < 0.2) return '#ffffff';
      // sunken, bruised eye sockets, a rotted nose, the dark receded lips
      const sock = Math.max(gauss(uy - 0.11, 0.19) * gauss(uz - 0.36, 0.22), gauss(uy - 0.11, 0.19) * gauss(uz + 0.36, 0.22));
      const nose = gauss(uz, 0.1) * gauss(uy + 0.14, 0.08) * (P.nose < 0.08 ? 1 : 0.4);
      const lips = gauss(uy + 0.35, 0.06) * gauss(uz, 0.36);
      const temple = gauss(uy - 0.2, 0.2) * gauss(Math.abs(uz) - 0.75, 0.2) * 0.25;
      const cheek = gauss(uy + 0.36, 0.14) * gauss(Math.abs(uz) - 0.5, 0.18) * 0.3;
      const k = Math.min(1, sock * 0.95 + nose + lips * 0.6 + temple + cheek);
      _dc.setRGB(1 - k * 0.78, 1 - k * 0.88, 1 - k * 0.72);
      return _dc;
    } : null,
    matFn: L < 2 ? (x, y, z) => (inMouth(x, y, z) ? MAT.FLESH : MAT.SKIN) : null,
    paint: (x, y) => (y < c[1] - r[1] * 0.3 && x > c[0] ? 0.8 : 0.2) });
  // eyes: small, deep in the sockets, milky (the glow is faint; elites burn red)
  if (!cin) for (const s of [-1, 1]) {
    const e = headPoint(P, 0.9, 0.1, s * 0.36, def, 0.9);
    sb.ellipsoid(e, [0.42, 0.4, 0.44], { segW: L === 2 ? 4 : 8, segH: L === 2 ? 3 : 5, slot: SLOT.ACCENT, mat: MAT.EYE, color: '#ffffff', bone: B.HEAD, part: PART.EYE });
    if (L === 0) {
      // heavy upper lids drooping over the eyeball, a sagging lower lid
      sb.ellipsoid([e[0] + 0.02, e[1] + 0.02, e[2]], [0.48, 0.47, 0.5], { segW: 10, segH: 6, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#c8bcc0', bone: B.HEAD, paint: 0.25, part: PART.HEAD,
        deform: (p) => { const cut = 0.14 + Math.max(0, p.x) * 0.05 + Math.abs(p.z) * 0.12; if (p.y < cut) p.y = cut + (p.y - cut) * 0.04; if (p.x < 0.1) p.x = 0.1 + (p.x - 0.1) * 0.3; } });
      sb.ellipsoid([e[0] + 0.02, e[1] - 0.03, e[2]], [0.47, 0.45, 0.49], { segW: 10, segH: 5, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#b09aa4', bone: B.HEAD, paint: 0.4, part: PART.HEAD,
        deform: (p) => { const cut = -0.52; if (p.y > cut) p.y = cut + (p.y - cut) * 0.04; if (p.x < 0.1) p.x = 0.1 + (p.x - 0.1) * 0.3; } });
    }
  }
  if (L === 0 && !cin) {
    // thin, sparse brows over the sockets and dark nostrils under the nose (or in the cavity)
    for (const s of [-1, 1]) {
      const b0 = headPoint(P, 0.86, 0.32, s * 0.15, def, 1.004), b1 = headPoint(P, 0.72, 0.35, s * 0.52, def, 1.004);
      sb.tube(lineRings(b0, b1, 0.09, 0.06, 3), { seg: 5, cap0: 'round', cap1: 'round', capRings: 1, slot: SLOT.HAIR, mat: MAT.HAIR, color: '#9a9690', bone: B.HEAD });
      const n = headPoint(P, 0.92, -0.2, s * 0.08, def, 1.0);
      sb.ellipsoid(n, [0.13, 0.1, 0.11], { segW: 5, segH: 3, slot: SLOT.FIXED, mat: MAT.FLESH, color: '#1a0606', bone: B.HEAD });
    }
  }
  // the jaw: a narrow mandible hinged under the ears
  const jc = [c[0] + r[0] * 0.14, c[1] - r[1] * 0.7, 0];
  const jr = [r[0] * 0.78 * (P.jawW || 1), r[1] * 0.3 * Math.min(1.35, P.jawDrop), r[2] * 0.8 * (P.jawW || 1)];
  const jawDef = (p) => {
    p.z *= 1 - 0.34 * Math.max(0, p.x);                   // V toward the chin
    if (p.y > 0.25) p.y = 0.25 + (p.y - 0.25) * 0.35;     // flat top (teeth sit on it)
    if (p.x < -0.4) p.y *= 1.3;                           // taller at the hinge (the jaw's angle shows on a wasted face)
    if (p.x > 0.75 && p.y < 0) p.y *= 1.1;                // a point of a chin
    if (cin) {
      const l = Math.hypot(p.x, p.y, p.z) || 1;
      const k = 1 + 0.05 * gauss(p.y / l + 0.55, 0.3) * gauss(p.z / l, 0.35) * smooth01((p.x / l - 0.5) / 0.3) - 0.03 * gauss(p.z / l, 0.05) * smooth01((p.x / l - 0.7) / 0.2) * (p.y < 0 ? 1 : 0);
      p.x *= k; p.y *= k; p.z *= k;
    }
  };
  sb.ellipsoid(jc, jr, { segW: L === 0 ? (cin ? 48 : 18) : L === 1 ? 8 : 6, segH: L === 0 ? (cin ? 22 : 9) : 4, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#ececec', bone: B.JAW, part: L < 2 ? PART.HEAD : PART.NONE,
    paint: 0.75, colorFn: L < 2 ? (x, y) => (y > jc[1] + jr[1] * 0.55 && x > jc[0] - jr[0] * 0.2 ? '#3a0c0c' : '#ececec') : null,
    deform: jawDef });
  if (L === 2) return def;
  if (L === 1) return def;
  if (cin) {
    cinFace(sb, P, type, (x, y, z, inset) => headPoint(P, x, y, z, def, inset), def, { jc, jr, def: jawDef });
    return def;
  }
  // ears (thin, a little torn)
  for (const s of [-1, 1]) {
    const e = headPoint(P, -0.08, 0.02, s, def, 0.97);
    sb.ellipsoid(e, [0.78, 1.15, 0.26], { segW: 6, segH: 4, rot: [0, 0, 0.2], slot: SLOT.SKIN, mat: MAT.SKIN, color: '#d8d0d0', bone: B.HEAD, paint: 0.4, part: PART.HEAD,
      deform: (p) => { if (p.y > 0.5 && p.x > 0) p.x *= 0.6; } });
  }
  // lips shrunk back off the teeth: a thin dark upper lip over a strip of gum, a lower lip on the jaw
  const ul = [], ll = [], gum = [];
  for (let i = 0; i <= 8; i++) {
    const u = -1 + i / 4;
    ul.push({ c: headPoint(P, 0.93 - 0.2 * u * u, -0.29 - 0.03 * u * u, u * 0.34, def, 1.0), rx: 0.07, rz: 0.07 - 0.02 * Math.abs(u) });
    gum.push({ c: headPoint(P, 0.86 - 0.22 * u * u, -0.33, u * 0.32, def, 0.985), r: 0.11 });
    const a = u * 0.6;
    const q = { x: Math.cos(a) * 0.93, y: 0.2, z: Math.sin(a) * 0.93 };
    jawDef(q);
    ll.push({ c: [jc[0] + q.x * jr[0], jc[1] + q.y * jr[1] - 0.05, q.z * jr[2]], rx: 0.08, rz: 0.07, bone: B.JAW });
  }
  const lip = P.gaunt > 1.1 ? '#3a2224' : '#5e3c3e';
  sb.tube(ul, { seg: 5, cap0: 'round', cap1: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.FLESH, color: lip, bone: B.HEAD, ref: [0, 1, 0], paint: 0.35 });
  sb.tube(gum, { seg: 5, cap0: 'round', cap1: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.FLESH, color: '#4a1a1e', bone: B.HEAD, ref: [0, 1, 0], paint: 0.5 });
  sb.tube(ll, { seg: 5, cap0: 'round', cap1: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.FLESH, color: lip, bone: B.JAW, ref: [0, 1, 0], paint: 0.5 });
  // tongue lolling on the jaw
  sb.ellipsoid([jc[0] + jr[0] * 0.15, jc[1] + jr[1] * 0.25, 0], [jr[0] * 0.52, 0.38, jr[2] * 0.42], { segW: 7, segH: 4, slot: SLOT.FIXED, mat: MAT.FLESH, color: '#401618', bone: B.JAW });
  // teeth: a narrow human row, stained and gapped (incisors square-edged, not fangs)
  for (let t = 0; t < 8; t++) {
    if (t === 1 || t === 6) continue;
    const a = -0.32 + t * 0.091;
    const up = headPoint(P, 0.84 - Math.abs(a) * 0.25, -0.35, a, def, 0.985);
    up[1] -= 0.14;
    sb.ellipsoid(up, [0.1, 0.19 + (t % 3) * 0.025, 0.12], { segW: 5, segH: 3, slot: SLOT.FIXED, mat: MAT.TEETH, color: t % 3 ? '#8e8060' : '#6e6042', bone: B.HEAD, paint: 0.15,
      deform: (p) => { if (p.y < 0) p.y *= 0.6; } });
    if (t === 4) continue;
    const ang = a * 1.7;
    const lo = [jc[0] + jr[0] * 0.8 * Math.cos(ang), jc[1] + jr[1] * 0.42, jr[2] * 0.74 * Math.sin(ang)];
    sb.ellipsoid(lo, [0.09, 0.17 + (t % 2) * 0.025, 0.1], { segW: 5, segH: 3, slot: SLOT.FIXED, mat: MAT.TEETH, color: t % 2 ? '#847458' : '#665a3e', bone: B.JAW, paint: 0.15,
      deform: (p) => { if (p.y > 0) p.y *= 0.6; } });
  }
  return def;
}

// ---------------------------------------------------------------------------------------

function extras(sb, P, L, type) {
  const GLOWC = { bloater: '#b8c060', spitter: '#9cd83a', boss: '#c8a040' };
  if (type === 'bloater') {
    // the belly: a huge distended, sagging bag on X1 (pulses), stretched marbled skin, weeping blisters
    sb.ellipsoid([4.0, 32.6, 0], [8.4, 9.4, 9.2], {
      segW: L === 0 ? dq(26) : L === 1 ? 14 : 8, segH: L === 0 ? dq(18) : L === 1 ? 10 : 6, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#f0ece0', bone: B.X1, part: L < 2 ? PART.TORSO : PART.NONE,
      paint: (x, y) => (y < 27 ? 0.55 : 0.2),
      deform: (p) => {
        if (p.y < -0.2) { p.y *= 1.08; p.x *= 1 + 0.12 * Math.max(0, -p.y); }       // it sags over the belt
        const k = 1 + 0.05 * Math.sin(p.x * 7) * Math.sin(p.z * 6) + 0.03 * Math.sin(p.y * 11 + p.z * 5);
        p.x *= k; p.z *= k;
      },
    });
    if (L < 2) {
      for (let k = 0; k < (L === 0 ? 14 : 7); k++) {
        // weeping blisters scattered over the front and sides (golden-angle spiral), sizes
        // varying; a few glow faintly with the sickness inside, the rest are pus and wet skin
        const u = (k + 0.5) / 14, th = k * 2.39996;
        const ph = -0.7 + u * 1.4;
        const lon = Math.sin(th) * 1.3;
        const cy = Math.sin(ph), cr = Math.cos(ph);
        const s = 0.25 + ((k * 0.77) % 1) * 0.4;
        const lit = k % 3 === 0;
        sb.ellipsoid([4.0 + Math.cos(lon) * cr * 8.25, 32.6 + cy * 9.25, Math.sin(lon) * cr * 9.05], [s, s * 0.8, s], { segW: 6, segH: 4, slot: lit ? SLOT.GLOW : SLOT.FIXED, mat: lit ? MAT.GLOW : MAT.FLESH, color: lit ? GLOWC.bloater : '#7a7440', bone: B.X1, paint: lit ? 0 : 0.1 });
      }
      // split navel
      sb.ellipsoid([12.3, 30.8, 0], [0.4, 1.7, 0.6], { segW: 6, segH: 4, slot: SLOT.FIXED, mat: MAT.FLESH, color: '#3a0e0e', bone: B.X1 });
    }
  } else if (type === 'spitter') {
    // a distended throat: a goitre of acid under stretched, split skin (the acid shows through the cracks)
    const sackDef = (p) => { const k = 1 + 0.08 * Math.sin(p.x * 9 + p.y * 5); p.x *= k; p.z *= k; if (p.y < 0) p.y *= 1.25; };
    sb.ellipsoid([3.0, P.neck - 0.3, 0], [2.0, 2.1, 2.3], { segW: L === 0 ? 12 : 7, segH: L === 0 ? 8 : 5, slot: SLOT.GLOW, mat: MAT.GLOW, color: '#6fb420', bone: B.X1, deform: sackDef });
    if (L < 2) {
      sb.ellipsoid([3.1, P.neck - 0.3, 0], [2.35, 2.4, 2.65], { segW: L === 0 ? 18 : 10, segH: L === 0 ? 12 : 6, slot: SLOT.SKIN, mat: MAT.SKIN_TEAR, color: '#d8dcc0', bone: B.X1, deform: sackDef, paint: 0.3, part: PART.TORSO });
      // acid glands: a few blisters along the shoulders and upper back
      const gl = L === 0 ? 7 : 3;
      for (let k = 0; k < gl; k++) {
        const a = 2.2 + k * 0.62 + (k % 2) * 0.3, s = 0.4 + ((k * 0.61) % 1) * 0.45;
        sb.ellipsoid([Math.cos(a) * 3.6 * P.depth - 0.4, P.sY - 1 + (k % 3) * 1.4 - 1.5, Math.sin(a) * 5.4], [s, s, s], { segW: 6, segH: 4, slot: SLOT.GLOW, mat: MAT.GLOW, color: GLOWC.spitter, bone: B.CHEST });
      }
      // drool strands hanging from the jaw (wet, not lit)
      const c = P.headC;
      for (let d = 0; d < 3; d++) {
        const z = (d - 1) * 0.7, len = 4 + d * 2.2;
        sb.tube(lineRings([c[0] + 2.6, c[1] - 3.6, z], [c[0] + 2.9, c[1] - 3.6 - len, z * 1.2], 0.2, 0.08, 4), { seg: 4, cap1: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.FLESH, color: '#8a9a50', bone: B.JAW, paint: 0.2 });
      }
    }
  } else if (type === 'brute') {
    // hulking trapezius and shoulder masses: scar tissue, bone breaking through the back
    sb.ellipsoid([-1.2, P.sY + 1.6, 0], [4.4, 3.6, 7.0], { segW: L === 0 ? 18 : 10, segH: L === 0 ? 10 : 6, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#ffffff', bone: B.CHEST, paint: 0.3, part: PART.TORSO });
    sb.ellipsoid([0, P.sY - 0.5, P.sw * 1.06 + 0.6], [4.2, 4.6, 4.0], { segW: L === 0 ? 14 : 8, segH: L === 0 ? 10 : 5, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#ffffff', bone: [B.CHEST, B.UARM_R, 0.7], paint: 0.4, part: PART.LIMB });
    sb.ellipsoid([0, P.sY - 0.2, -P.sw - 0.2], [3.3, 3.5, 3.1], { segW: L === 0 ? 12 : 7, segH: L === 0 ? 8 : 5, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#ffffff', bone: [B.CHEST, B.UARM_L, 0.7], paint: 0.3, part: PART.LIMB });
    if (L < 2) {
      const spurs = [[-4.6, P.sY + 2.5, -3.5, -0.5, 5], [-5.2, P.chest + 3, 2.5, 0.35, 6], [-4.4, P.chest - 1, -2, -0.2, 4.5], [-2, P.sY + 4.2, 5, 0.8, 4], [1, P.sY + 2.5, 11.5, 1.3, 4.2]];
      for (const [x, y, z, a, len] of spurs) {
        const dx = -Math.cos(a) * 0.85, dz = Math.sin(a) * 0.9, dy = 0.45;
        sb.tube(lineRings([x, y, z], [x + dx * len, y + dy * len, z + dz * len], 0.9, 0.05, 4), { seg: 6, cap0: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.BONE, color: BONE, bone: z > 9 ? B.UARM_R : B.CHEST });
        // the torn skin round each spur
        sb.ellipsoid([x - 0.2, y, z], [1.2, 1.2, 1.2], { segW: 6, segH: 4, slot: SLOT.FIXED, mat: MAT.FLESH, color: FLESH, bone: z > 9 ? B.UARM_R : B.CHEST, paint: 0.8 });
      }
      // bony growths plating the club forearm and the knuckles
      const el = P.sY - P.uarm * P.rArmK, wr = P.sY - (P.uarm + P.farm) * P.rArmK, zR = P.sw * 1.06;
      for (let k = 0; k < (L === 0 ? 7 : 3); k++) {
        const t = (k + 0.5) / 7, y = el - (el - wr) * t, a = k * 2.1;
        sb.ellipsoid([Math.cos(a) * P.armR * P.rArmK * 0.7, y, zR + Math.sin(a) * P.armR * P.rArmK * 0.72], [1.0, 1.4, 0.9], { segW: 6, segH: 4, rot: [a, 0, 0.3], slot: SLOT.FIXED, mat: MAT.BONE, color: '#bfb190', bone: B.FARM_R,
          deform: (p) => { if (p.y > 0) { p.x *= 1 - p.y * 0.6; p.z *= 1 - p.y * 0.6; } } });
      }
      // keloid scars across the chest and belly (raised, shiny, pale)
      for (let q = 0; q < 3; q++) {
        sb.tube(lineRings([4.4 * P.fitD / 0.76 * 0.98, P.chest + 4 - q * 3.2, -5 + q], [4.6 * P.fitD / 0.76 * 0.95, P.waist + 2 - q * 2.2, 4 - q * 1.5], 0.28, 0.28, 5), { seg: 4, slot: SLOT.FIXED, mat: MAT.FLESH, color: '#7a4a48', bone: B.CHEST, paint: 0.2 });
      }
    }
  } else if (type === 'boss') {
    // hump, exposed spine, spikes along the spine and shoulders, tumours, a withered third arm, flayed belly
    sb.ellipsoid([-4, P.sY - 1, 0], [5.8, 7.2, 8.6], { segW: L === 0 ? 20 : 10, segH: L === 0 ? 14 : 6, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#ffffff', bone: B.X1, paint: 0.35, part: PART.TORSO,
      deform: (p) => { const k = 1 + 0.1 * Math.sin(p.x * 6 + 1) * Math.sin(p.y * 5) * Math.sin(p.z * 4 + 2); p.x *= k; p.y *= k; p.z *= k; } });
    // the flayed belly: a raw wound laid open over the gut (mostly sunk into the body)
    sb.ellipsoid([P.frontX(P.waist + 1) - 1.4, P.waist + 1, 0], [1.9, 5.0, 4.6], { segW: L === 0 ? 14 : 8, segH: L === 0 ? 10 : 5, slot: SLOT.FIXED, mat: MAT.FLESH, color: '#4a1418', bone: B.SPINE, paint: 0.9,
      deform: (p) => { const k = 1 + 0.12 * Math.sin(p.y * 9 + p.z * 4) * Math.sin(p.z * 7); p.x *= k; } });
    if (L < 2) {
      // flayed strip down the back with the spine bare: vertebrae and rib stubs
      sb.ellipsoid([-9.6, P.sY - 6, 0], [1.4, 16.5, 3.1], { segW: L ? 6 : 10, segH: L ? 8 : 14, slot: SLOT.FIXED, mat: MAT.FLESH, color: '#4a1418', bone: B.X1, paint: 0.9 });
      const nv = L === 0 ? 11 : 6;
      for (let i = 0; i < nv; i++) {
        const y = P.sY + 3.2 - i * (L ? 3.1 : 1.9);
        sb.ellipsoid([-10.6, y, 0], [1.05, 0.72, 1.25], { segW: 6, segH: 4, slot: SLOT.FIXED, mat: MAT.BONE, color: BONE, bone: B.X1 });
        if (L === 0) for (const s of [-1, 1]) sb.tube(lineRings([-10.4, y, s * 1.2], [-8.2, y - 0.9, s * 5.6], 0.28, 0.14, 3), { seg: 4, slot: SLOT.FIXED, mat: MAT.BONE, color: BONE, bone: B.X1 });
      }
      const spikes = [];
      for (let i = 0; i < 9; i++) spikes.push([-8.5 + Math.abs(i - 4) * 0.3, P.sY + 5 - i * 2.4, (i % 2 ? 1 : -1) * (4.6 + (i % 3)), (i % 2 ? 0.45 : -0.45), 6 + (i % 3) * 2.2]);
      spikes.push([-1, P.sY + 3.5, -10, -1.3, 6.5], [-1, P.sY + 3.5, 10, 1.3, 6.5], [-2, P.sY + 1, -12, -1.5, 5], [-2, P.sY + 1, 12, 1.5, 5]);
      for (const [x, y, z, a, len] of spikes) {
        const dx = -Math.cos(a) * 0.8, dz = Math.sin(a) * 0.95, dy = 0.5;
        sb.tube(lineRings([x, y, z], [x + dx * len, y + dy * len, z + dz * len], 1.1, 0.06, 4), { seg: L === 0 ? 7 : 5, cap0: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.BONE, color: '#c8bc9c', bone: Math.abs(z) > 9 ? B.CHEST : B.X1 });
      }
      for (let k = 0; k < (L === 0 ? 12 : 5); k++) {
        const a = k * 2.4, y = P.chest - 6 + (k % 4) * 3.5;
        const s = 0.8 + (k % 3) * 0.45;
        sb.ellipsoid([Math.cos(a) * 5.4, y, Math.sin(a) * 8], [s, s, s], { segW: 6, segH: 4, slot: SLOT.GLOW, mat: MAT.GLOW, color: GLOWC.boss, bone: B.CHEST });
      }
      // a great tumour cluster on the right flank
      if (L === 0) for (let k = 0; k < 4; k++) sb.ellipsoid([1 + k * 0.6, P.waist + 4 + k * 2.2, 11 + (k % 2) * 1.4], [2.2 - k * 0.3, 2.2 - k * 0.3, 2.4 - k * 0.3], { segW: 8, segH: 6, slot: SLOT.SKIN, mat: MAT.SKIN_TEAR, color: '#b0a0a0', bone: B.SPINE, paint: 0.3, part: PART.TORSO });
      // third arm: withered, clawed, sprouting from the left shoulder blade
      const X2 = B.X2;
      sb.tube([
        { c: [-2.5, 42, -8.5], r: 1.6, bone: B.CHEST },
        { c: [-2.5, 36, -9.5], r: 1.3, bone: X2 },
        { c: [-2.3, 30, -10], r: 1.0, bone: X2 },
        { c: [-2.0, 25.5, -10.2], r: 0.8, bone: X2 },
      ], { seg: L === 0 ? 8 : 5, cap1: 'round', capRings: 1, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#d8d8d8', paint: 0.5, part: PART.LIMB });
      for (let f = 0; f < 3; f++) {
        sb.tube(lineRings([-2, 25, -10.2 + (f - 1) * 0.7], [-0.8, 21.5, -10.2 + (f - 1) * 1.1], 0.35, 0.03, 3), { seg: 4, slot: SLOT.FIXED, mat: MAT.BONE, color: BONE, bone: X2 });
      }
      // horns of bone breaking out of the skull
      const c = P.headC;
      for (const s of [-1, 1]) sb.tube([{ c: [c[0] - 0.5, c[1] + 2.6, s * 2.2], r: 0.8, bone: B.HEAD }, { c: [c[0] - 1.6, c[1] + 4.6, s * 3.4], r: 0.62, bone: B.HEAD }, { c: [c[0] - 3.2, c[1] + 6.2, s * 3.9], r: 0.36, bone: B.HEAD }, { c: [c[0] - 4.8, c[1] + 6.6, s * 3.6], r: 0.05, bone: B.HEAD }], { seg: 6, slot: SLOT.FIXED, mat: MAT.BONE, color: '#bfb496' });
    }
  } else if (type === 'crawler' && L < 2) {
    // torn open at the hips: the spine stub and entrails trailing behind on the ground
    sb.tube(lineRings([-0.4, P.hip - 4.5, 0], [-0.6, P.hip - 8.5, 0.3], 0.6, 0.5, 3), { seg: 6, cap1: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.BONE, color: BONE, bone: B.HIPS });
    if (L === 0) {
      for (let k = 0; k < 3; k++) {
        const pts = [];
        for (let i = 0; i <= 9; i++) {
          const t = i / 9;
          pts.push({ c: [0.6 + Math.sin(t * 6 + k * 2) * 0.9, P.hip - 4.6 - t * (14 + k * 4), (k - 1) * 1.2 + Math.sin(t * 5 + k) * 1.1], r: 0.55 + Math.sin(t * 11 + k) * 0.16, bone: B.HIPS });
        }
        sb.tube(pts, { seg: 5, cap1: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.FLESH, color: k % 2 ? '#6a2a30' : '#7a3238', paint: 0.9 });
      }
    }
  }
}
