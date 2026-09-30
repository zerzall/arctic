// Sculpted zombie models for the GPU rig (actor-rig.js), built procedurally with the
// organic shape builder (actor-shape.js): tapered, muscled limbs with blended joints, a
// rounded skull with brow, cheekbones, sunken eye sockets and glowing eyes, a separate
// hinged jaw with teeth and a dark mouth cavity, layered garments, shoes, hair and a
// wardrobe of accessories. Eight silhouettes from zombies.js (walker, runner lean, legless
// crawler, bloater with a pulsing belly and glowing boils, spitter with an acid sack and
// drool, pale long-haired screamer, hunched armoured brute with a club arm and bone spurs,
// spiked boss with growths and a third arm). Three LODs per type: full detail up close, no
// fingers/teeth/small gear at mid range, a light silhouette far away.
//
// One model per type and LOD serves every zombie of that type: the garments are shells
// whose hems, sleeves and trouser legs are cut per instance by the rig shader, and the
// accessories (actor-zkit.js) are option groups the instance switches on (actor-zlook.js
// decides who wears what), so a horde of one type is still a single draw call per LOD.
//
// Model space: +X forward, +Y up, +Z right; feet on y = 0; ~56 units tall at scale 1.

import { ShapeBuilder, SLOT, MAT, PART, lineRings } from './actor-shape.js';
import * as THREE from 'three';
import { B } from './actor-rig.js';
import { addAccessories } from './actor-zkit.js';
import { optionsForType } from './actor-zlook.js';
import { cinFaceRelief, cinFace } from './actor-zcin.js';

const _dc = new THREE.Color();

const TAU = Math.PI * 2;
const SOLE = '#141110', BONE = '#d9d0b4', NAIL = '#3a3228';
const FLESH = '#6a1616';
const gauss = (x, s) => Math.exp(-(x * x) / (s * s));
/** Two-bone weight spec (single bone when w is 0 or 1). */
const bw = (a, b, w) => (w <= 0 ? a : w >= 1 ? b : [a, b, w]);
const smooth01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Base proportions (walker). */
const BASE = {
  hip: 28.5, knee: 15, ankle: 3, legGap: 3.9, thighR: 3.0, calfR: 2.25,
  waist: 32, chest: 38, sY: 44.6, sw: 8.0, uarm: 11.4, farm: 10.4, armR: 2.05, handS: 1,
  neck: 46.4, headC: [1.2, 52.2, 0], headR: [4.05, 4.5, 3.45],
  bulk: 1, depth: 1, lean: 0,
  legs: 'full', socket: 0.13, nose: 0.14, claws: false, jawDrop: 1, rArmK: 1, lArmK: 1, shellFrom: 1,
};

/** Per-type proportions (look.scale is applied by the renderer). */
export const ZPARAMS = {
  walker: {},
  runner: { bulk: 0.9, depth: 0.92, thighR: 2.8, calfR: 2.1, armR: 2.0, socket: 0.16 },
  crawler: { bulk: 0.86, depth: 0.85, armR: 1.9, uarm: 12.6, farm: 11.8, legs: 'stumps', claws: true, socket: 0.18, nose: 0.05 },
  bloater: { bulk: 1.18, depth: 1.1, thighR: 3.9, calfR: 3.0, armR: 2.7, handS: 1.2, sw: 9.4, headR: [3.9, 4.3, 3.4], headC: [1.4, 51.8, 0], neck: 46, socket: 0.1, shellFrom: 4 },
  spitter: { bulk: 0.94, depth: 0.95, neck: 47.2, headC: [1.6, 53.4, 0], headR: [4.4, 4.9, 3.6], jawDrop: 1.3, socket: 0.15 },
  screamer: { bulk: 0.84, depth: 0.86, armR: 1.85, uarm: 12.4, farm: 11.4, thighR: 2.6, calfR: 1.9, headR: [4.2, 5.1, 3.5], jawDrop: 1.5, socket: 0.17, nose: 0.1 },
  brute: { bulk: 1.3, depth: 1.22, thighR: 3.9, calfR: 3.1, armR: 3.0, handS: 1.35, sw: 10.2, uarm: 12.4, farm: 11.6, headR: [3.9, 4.2, 3.4], headC: [2.6, 51.0, 0], neck: 45.6,
    claws: true, rArmK: 1.45, socket: 0.12, nose: 0.06 },
  boss: { bulk: 1.34, depth: 1.25, thighR: 4.2, calfR: 3.4, armR: 3.2, handS: 1.45, sw: 10.8, uarm: 12.8, farm: 12.2, headR: [3.7, 4.0, 3.3], headC: [3.0, 50.8, 0], neck: 45.4,
    claws: true, socket: 0.14, nose: 0.02 },
};

function params(type) {
  return { ...BASE, ...(ZPARAMS[type] || {}) };
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
  piv[B.X1] = type === 'bloater' ? [3, 33, 0] : type === 'spitter' ? [2.5, 47, 0] : type === 'boss' ? [-3, 44, 0] : [0, P.chest, 0];
  piv[B.X2] = type === 'boss' ? [-2.5, 42, -8.5] : [0, P.chest, 0];
  const parents = [-1, 0, 1, 2, 3, 4, 2, 6, 7, 2, 9, 10, 0, 12, 13, 0, 15, 16, 2, 2];
  if (type === 'bloater') parents[B.X1] = B.SPINE;
  if (type === 'spitter') parents[B.X1] = B.NECK;
  return { pivots: piv, parents, P };
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
/**
 * Cloth folds for a garment tube: creases that run round the limb and bunch near the joint
 * (`joint` = ring fraction of the elbow / knee); 1 + small waves, cinematic LOD 0 only.
 */
function folds(L, seed, amp, joint = 0.5, freq = 34) {
  if (!(TIER < 0 && L === 0)) return null;
  return (th, t) => {
    const env = 0.35 + 0.65 * Math.exp(-((t - joint) * (t - joint)) / 0.045);
    return 1 + amp * env * (0.6 * Math.sin(t * freq + th * 2 + seed) + 0.4 * Math.sin(t * freq * 1.73 - th * 3 + seed * 2.1));
  };
}
const withFolds = (base, f) => (base && f ? (th, t) => base(th, t) * f(th, t) : base || f || undefined);

/**
 * Build one zombie model.
 * @param {string} type zombies.js id
 * @param {number} L LOD 0 (near) · 1 (mid) · 2 (far)
 * @param {number} [tier] quality tier (0 ultra, 1 high, 2 low)
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
  // rings: [x offset, y, front-back radius, half width, bones]
  const tor = [
    [-0.2, P.hip - 1.6, 3.9, 5.8, B.HIPS],
    [0.0, P.hip + 1.2, 3.8, 5.55, bw(B.HIPS, B.SPINE, 0.5)],
    [0.35, P.waist + 0.4, 4.0, 5.6, B.SPINE],
    [0.4, P.waist + 3.2, 4.3, 6.3, bw(B.SPINE, B.CHEST, 0.5)],
    [0.3, P.chest + 0.6, 4.65, 7.1, B.CHEST],
    [0.15, P.chest + 3.4, 4.75, 7.6, B.CHEST],
    [-0.2, P.sY - 0.9, 4.25, 7.8, B.CHEST],
    [-0.35, P.sY + 0.7, 3.4, 7.1, B.CHEST],
    [0.1, P.neck + 0.3, 2.2, 3.1, bw(B.CHEST, B.NECK, 0.3)],
  ];
  const belly = type === 'bloater' ? 0 : 1;
  const torsoRings = tor.map(([x, y, rx, rz, bone], i) => ({
    c: [x + P.lean * (y - P.hip) * 0.05, y, 0],
    rx: rx * D * (i === 2 && belly ? 1.02 : 1), rz: rz * K, bone,
  }));
  const torsoProfile = (th, t) => {
    // flatter back, shoulder blades, pecs
    const c = Math.cos(th), s = Math.sin(th);
    let k = 1 - 0.1 * Math.max(0, -c);
    k += 0.05 * gauss(t - 0.62, 0.12) * Math.max(0, c) * (1 - Math.abs(s) * 0.4);
    k += 0.04 * gauss(t - 0.7, 0.1) * Math.max(0, -c) * Math.abs(s);
    return k;
  };
  sb.tube(torsoRings, {
    seg: seg(18, 8, 6), cap0: 'round', cap1: 'round', capRings: seg(3, 1, 1), profile: torsoProfile, dec: L === 2 ? 2 : 1, subdiv: sd(L),
    slot: L < 2 ? SLOT.SKIN : SLOT.CLOTH, mat: L < 2 ? MAT.SKIN : MAT.CLOTH, color: '#ffffff',
    noise: L === 0 ? { amp: 0.28, freq: 0.45 } : null,
    paint: 0.15,
  });

  // ---- clothes: the top (a shell whose hem is cut per instance), sleeves ------------------
  if (L < 2) topShell(sb, P, L, torsoRings, torsoProfile, type);

  // ---- hips / trousers ---------------------------------------------------------------
  sb.tube([
    { c: [0, P.hip - 4.2, 0], rx: 3.2 * D, rz: 4.8 * K, bone: B.HIPS },
    { c: [0, P.hip - 1.4, 0], rx: 4.15 * D, rz: 6.1 * K, bone: B.HIPS },
    { c: [0.2, P.hip + 1.6, 0], rx: 4.1 * D, rz: 5.95 * K, bone: bw(B.HIPS, B.SPINE, 0.4) },
    { c: [0.3, P.waist + 0.6, 0], rx: 4.2 * D, rz: 5.85 * K, bone: B.SPINE },
  ], { seg: seg(16, 8, 6), subdiv: sd(L), cap0: 'round', capRings: seg(2, 1, 1), slot: SLOT.CLOTH2, mat: MAT.CLOTH, color: '#ffffff', paint: 0.35, part: PART.PELVIS });
  if (L === 0) {
    sb.tube(lineRings([0.3, P.waist - 0.2, 0], [0.3, P.waist + 1.1, 0], 4.35 * D, 4.35 * D, 2, (r) => { r.rz = 6.0 * K; r.rx = 4.35 * D; }),
      { seg: 16, slot: SLOT.FIXED, mat: MAT.LEATHER, color: '#2a1e16', bone: B.SPINE });
  }

  // ---- legs ---------------------------------------------------------------------------
  for (const side of [-1, 1]) legs(sb, P, L, side, type);

  // ---- arms ---------------------------------------------------------------------------
  for (const side of [-1, 1]) arm(sb, P, L, side, type);

  // ---- neck + head --------------------------------------------------------------------
  const headDef = head(sb, P, L, type);

  // ---- accessories (hats, hair, gear, gore, armour) ------------------------------------
  if (tier < 2) addAccessories(sb, P, tier <= 0 ? L : Math.max(L, 1), headDef, has);

  // ---- per-type extras ----------------------------------------------------------------
  extras(sb, P, L, type);
  return sb;
}

function topShell(sb, P, L, torsoRings, profile, type) {
  const D = P.depth, K = P.bulk;
  const loose = type === 'boss' ? 0.9 : type === 'brute' ? 0.7 : 0.5;
  const rings = [];
  if (P.shellFrom <= 1) {
    // the skirt of a coat or gown, hanging from the hips (the hem is cut per instance)
    rings.push({ c: [0.3, P.knee - 1.5, 0], rx: 6.2 * D, rz: 8.4 * K, bone: B.HIPS });
    rings.push({ c: [0.35, P.knee + 1.5, 0], rx: 5.8 * D, rz: 7.9 * K, bone: B.HIPS });
    rings.push({ c: [0.3, P.hip - 8.5, 0], rx: 5.3 * D, rz: 7.2 * K, bone: B.HIPS });
    rings.push({ c: [0.2, P.hip - 4.0, 0], rx: 4.95 * D, rz: 6.6 * K, bone: B.HIPS });
  }
  for (let i = P.shellFrom; i <= 7; i++) {
    const r = torsoRings[i];
    rings.push({ c: r.c.slice(), rx: r.rx + loose, rz: r.rz + loose * 1.1, bone: r.bone });
  }
  const top = torsoRings[8];
  rings.push({ c: [top.c[0] - 0.2, top.c[1] - 0.6, 0], rx: top.rx + 0.9, rz: top.rz + 1.2, bone: top.bone });
  sb.tube(rings, {
    seg: L === 0 ? dq(20) : 8, profile: withFolds(profile, folds(L, 1.3, 0.022, 0.55, 26)), subdiv: sd(L), slot: SLOT.CLOTH, mat: MAT.TEAR, color: '#ffffff', part: PART.TOP,
    noise: L === 0 ? { amp: 0.35, freq: 0.3, seed: 5 } : null, paint: (x, y) => (y < P.hip + 3 ? 0.55 : 0.3),
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
}

function legs(sb, P, L, side, type) {
  const z = side * P.legGap;
  const TH = side < 0 ? B.THIGH_L : B.THIGH_R, SH = side < 0 ? B.SHIN_L : B.SHIN_R, FT = side < 0 ? B.FOOT_L : B.FOOT_R;
  const tr = P.thighR * P.bulk, cr = P.calfR * P.bulk;
  const seg = L === 0 ? dq(12) : L === 1 ? 6 : 5;
  const legSlot = SLOT.CLOTH2;
  if (P.legs === 'stumps') {
    // legs torn off below the knee: thigh + ragged stump with the bone showing
    sb.tube([
      { c: [0, P.hip + 1, z * 0.9], r: tr * 1.05, bone: bw(B.HIPS, TH, 0.6) },
      { c: [0.2, P.hip - 5, z], r: tr * 0.95, bone: TH },
      { c: [0.3, P.knee + 2, z], r: tr * 0.75, bone: TH },
      { c: [0.3, P.knee - 1.5, z], r: tr * 0.62, bone: bw(TH, SH, 0.6), paint: 1 },
    ], { seg, cap0: 'round', cap1: 'flat', slot: legSlot, mat: MAT.CLOTH, color: '#ffffff', paint: 0.3, part: PART.LEG });
    sb.ellipsoid([0.3, P.knee - 1.8, z], [tr * 0.6, 0.9, tr * 0.6], { segW: seg, segH: 3, slot: SLOT.FIXED, mat: MAT.FLESH, color: FLESH, bone: SH, paint: 0.9 });
    if (L < 2) sb.tube(lineRings([0.3, P.knee - 1, z], [0.4, P.knee - 4.5, z + side * 0.3], 0.6, 0.45, 3), { seg: 5, cap1: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.BONE, color: BONE, bone: SH });
    return;
  }
  const kneeY = P.knee, hip = P.hip, ank = P.ankle;
  const rings = [
    { c: [0.1, hip + 1.2, z * 0.92], r: tr * 1.08, bone: bw(B.HIPS, TH, 0.55) },
    { c: [0.35, hip - 3.5, z], rx: tr * 1.02, rz: tr * 0.98, bone: TH },
    { c: [0.4, hip - 8, z], rx: tr * 0.9, rz: tr * 0.86, bone: TH },
    { c: [0.35, kneeY + 2.2, z], rx: tr * 0.74, rz: tr * 0.7, bone: bw(TH, SH, 0.2) },
    { c: [0.55, kneeY, z], rx: tr * 0.72, rz: tr * 0.66, bone: bw(TH, SH, 0.5) },
    { c: [0.2, kneeY - 2.4, z], rx: cr * 0.95, rz: cr * 0.86, bone: bw(TH, SH, 0.85) },
    { c: [-0.35, kneeY - 5.5, z], rx: cr * 1.05, rz: cr * 0.9, bone: SH },
    { c: [0.05, ank + 3.5, z], rx: cr * 0.66, rz: cr * 0.6, bone: SH },
    { c: [0.1, ank + 0.6, z], rx: cr * 0.55, rz: cr * 0.5, bone: bw(SH, FT, 0.4) },
  ];
  // one shell: trousers above the per-instance hem, bare skin below it (the shader decides)
  const pr = rings.map((r, i) => ({ ...r, rx: (r.rx ?? r.r) + 0.3 + (i > 5 ? 0.25 : 0), rz: (r.rz ?? r.r) + 0.3 + (i > 5 ? 0.2 : 0), r: undefined }));
  sb.tube(pr, { seg, subdiv: sd(L), profile: folds(L, side * 2.1, 0.03, 0.55, 30), cap0: 'round', capRings: 1, slot: legSlot, mat: MAT.CLOTH, color: '#ffffff', paint: (x, y) => (y < kneeY - 3 ? 0.5 : 0.28), dec: L === 2 ? 2 : 1,
    noise: L === 0 ? { amp: 0.22, freq: 0.35, seed: side * 3 } : null, part: PART.LEG });
  // the foot: bare skin (toes), shoes are option groups over it
  const fx = 1.7;
  sb.ellipsoid([fx, 1.1, z], [3.2, 1.25, 1.55], { segW: L ? 7 : 12, segH: L ? 4 : 6, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#e0e0e0', bone: FT, paint: 0.7,
    deform: (p) => { if (p.y < 0) p.y *= 0.5; if (p.x > 0.4) p.y *= 0.8; } });
  if (L === 0) {
    for (let t = 0; t < 4; t++) {
      sb.ellipsoid([fx + 3.0, 0.6, z + side * (-0.7 + t * 0.45)], [0.55, 0.45, 0.28], { segW: 5, segH: 3, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#d0d0d0', bone: FT, paint: 0.7 });
    }
  }
  if (L < 2) shoes(sb, P, L, side, z, FT, SH, ank, cr);
}

function shoes(sb, P, L, side, z, FT, SH, ank, cr) {
  // one shoe for everybody: the shaft (boots) and the sole colour (sneakers) are per instance
  const fx = 1.7;
  const seg = L ? 6 : 10, segH = L ? 4 : 5;
  const S = { opt: 'shoe', bone: FT };
  sb.ellipsoid([fx + 0.12, 1.65, z], [3.85, 1.9, 1.9], { ...S, slot: SLOT.TRIM, part: PART.SHOE, segW: seg, segH, mat: MAT.LEATHER, color: '#ffffff', paint: 0.45,
    deform: (p) => { if (p.y < -0.2) p.y = -0.2 - (p.y + 0.2) * 0.25; if (p.x < -0.2 && p.y > 0) p.x *= 0.8; if (p.x > 0.5) p.y *= 0.85; } });
  sb.ellipsoid([fx + 0.2, 0.4, z], [4.0, 0.5, 1.95], { ...S, slot: SLOT.FIXED, part: PART.SOLE, segW: L ? 7 : 10, segH: 3, mat: MAT.RUBBER, color: '#ffffff' });
  if (L === 0) {
    sb.tube([{ c: [0.05, ank + 3.0, z], rx: cr * 1.0 + 0.55, rz: cr * 0.95 + 0.5, bone: SH }, { c: [0.15, ank + 7.5, z], rx: cr * 1.05 + 0.5, rz: cr * 0.98 + 0.45, bone: SH }, { c: [0.2, ank + 8.2, z], rx: cr * 1.05 + 0.3, rz: cr * 0.98 + 0.3, bone: SH }],
      { ...S, seg: 8, slot: SLOT.TRIM, part: PART.SHAFT, mat: MAT.LEATHER, color: '#ffffff', paint: 0.35, cap1: 'flat' });
  }
}

function arm(sb, P, L, side, type) {
  const R = side > 0;
  const k = R ? P.rArmK : P.lArmK;
  const UA = R ? B.UARM_R : B.UARM_L, FA = R ? B.FARM_R : B.FARM_L, HD = R ? B.HAND_R : B.HAND_L;
  const z = side * P.sw * (R && k > 1 ? 1.06 : 1);
  const top = P.sY, elbow = P.sY - P.uarm * k, wrist = P.sY - (P.uarm + P.farm) * k;
  const r = P.armR * k * (type === 'bloater' ? 1.1 : 1);
  const seg = L === 0 ? dq(12) : L === 1 ? 6 : 5;
  const rings = [
    { c: [-0.2, top - 0.1, z * 0.9], r: r * 0.85, bone: [B.CHEST, UA, 0.55] },
    { c: [0.1, top - 1.6, z * 1.0], rx: r * 1.05, rz: r * 0.98, bone: UA },
    { c: [0.0, top - (elbow - top) * -0.45, z], rx: r * 0.95, rz: r * 0.9, bone: UA },
    { c: [-0.2, elbow + 1.2, z], rx: r * 0.8, rz: r * 0.78, bone: [UA, FA, 0.25] },
    { c: [-0.3, elbow, z], rx: r * 0.8, rz: r * 0.76, bone: [UA, FA, 0.5] },
    { c: [0.05, elbow - 2.8, z], rx: r * 0.92, rz: r * 0.85, bone: [UA, FA, 0.85] },
    { c: [0.2, wrist + 3.2, z], rx: r * 0.7, rz: r * 0.62, bone: FA },
    { c: [0.2, wrist + 0.3, z], rx: r * 0.55, rz: r * 0.46, bone: [FA, HD, 0.5] },
  ];
  sb.tube(rings, { seg, subdiv: sd(L), cap0: 'round', capRings: L ? 1 : 2, cap1: 'flat', slot: SLOT.SKIN, mat: MAT.SKIN, color: '#ffffff', dec: L === 2 ? 2 : 1,
    paint: (x, y) => (y < elbow ? 0.45 : 0.15), noise: L === 0 ? { amp: 0.16 * k, freq: 0.6, seed: side } : null });
  // sleeves: long, cut to length per instance
  if (L < 2) {
    const srings = rings.slice(0, 7).map((q) => ({ ...q, rx: (q.rx ?? q.r) + 0.4, rz: (q.rz ?? q.r) + 0.4, r: undefined }));
    sb.tube(srings, { seg, subdiv: sd(L), profile: folds(L, side * 1.7, 0.035, 0.62, 32), slot: SLOT.CLOTH, mat: MAT.TEAR, color: '#ffffff', paint: 0.25, part: PART.SLEEVE, noise: L === 0 ? { amp: 0.2, freq: 0.5 } : null });
  }
  hand(sb, P, L, side, HD, [0.3, wrist, z], r, k);
}

function hand(sb, P, L, side, HD, w, r, k) {
  const s = P.handS * k;
  const claw = P.claws;
  const H = { part: PART.HAND };
  // palm
  sb.ellipsoid([w[0] + 0.4 * s, w[1] - 2.2 * s, w[2]], [1.25 * s, 2.3 * s, 1.75 * s * (L === 2 ? 1 : 0.95)], {
    ...H, segW: L === 0 ? 10 : L === 1 ? 7 : 5, segH: L === 0 ? 6 : 4, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#f0f0f0', bone: HD, paint: 0.5,
  });
  if (L === 2) return;
  if (L === 1) {
    // mitten of fingers
    sb.ellipsoid([w[0] + 0.9 * s, w[1] - 4.6 * s, w[2]], [0.9 * s, 1.8 * s, 1.6 * s], { ...H, segW: 6, segH: 4, rot: [0, 0, 0.35], slot: SLOT.SKIN, mat: MAT.SKIN, color: '#e8e8e8', bone: HD, paint: 0.5 });
    return;
  }
  // fingers: slightly curled forward (zombie hands reach), claws on some types
  for (let f = 0; f < 4; f++) {
    const fz = w[2] + side * (-1.15 + f * 0.78) * s;
    const len = [2.6, 3.1, 3.0, 2.3][f] * s;
    const x0 = w[0] + 0.6 * s, y0 = w[1] - 4.1 * s;
    const pts = [];
    for (let j = 0; j <= 3; j++) {
      const t = j / 3, curl = t * t * 1.1;
      pts.push({ c: [x0 + Math.sin(curl) * len * t, y0 - Math.cos(curl * 0.8) * len * t, fz], r: 0.42 * s * (1 - t * 0.28) });
    }
    sb.tube(pts, { ...H, seg: 6, cap0: 'round', cap1: 'round', capRings: 1, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#e6e6e6', bone: HD, paint: 0.55 });
    const tip = pts[3].c;
    if (claw) {
      sb.tube(lineRings([tip[0] - 0.1, tip[1] + 0.2, tip[2]], [tip[0] + 0.9 * s, tip[1] - 1.2 * s, tip[2]], 0.28 * s, 0.02, 3), { seg: 5, slot: SLOT.FIXED, mat: MAT.BONE, color: '#bfb49a', bone: HD });
    } else {
      sb.ellipsoid([tip[0] + 0.12, tip[1] + 0.1, tip[2]], [0.3 * s, 0.4 * s, 0.32 * s], { segW: 5, segH: 3, slot: SLOT.FIXED, mat: MAT.BONE, color: NAIL, bone: HD });
    }
  }
  // thumb
  const tz = w[2] - side * 1.3 * s;
  sb.tube(lineRings([w[0] + 0.9 * s, w[1] - 1.4 * s, tz], [w[0] + 2.2 * s, w[1] - 3.6 * s, tz - side * 0.3 * s], 0.5 * s, 0.38 * s, 3), { ...H, seg: 6, cap1: 'round', capRings: 1, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#e6e6e6', bone: HD, paint: 0.5 });
}

// ---------------------------------------------------------------------------------------
// head

function headDeform(P, type) {
  const sock = P.socket, nose = P.nose;
  return (p) => {
    let k = 1;
    const front = smooth01((p.x - 0.35) / 0.4);
    // cranium: fuller at the back, narrower temples
    k += 0.05 * gauss(p.y - 0.45, 0.35) * smooth01(-p.x * 2);
    k -= 0.05 * gauss(p.y - 0.2, 0.2) * gauss(Math.abs(p.z) - 0.75, 0.2);
    // lower face narrows toward the chin
    if (p.y < -0.25) k -= smooth01((-0.25 - p.y) / 0.6) * (0.14 + 0.1 * front);
    // the mouth: below the upper lip the face recedes into a dark hollow that the jaw
    // (a separate hinged part) covers when closed and reveals when it hangs open
    k -= 0.34 * smooth01((-0.36 - p.y) / 0.16) * smooth01((p.x - 0.3) / 0.3) * gauss(p.z, 0.62);
    // brow ridge
    k += 0.07 * gauss(p.y - 0.3, 0.1) * front;
    // sunken eye sockets
    for (const s of [-1, 1]) k -= sock * gauss(p.y - 0.12, 0.13) * gauss(p.z - s * 0.37, 0.16) * front;
    // cheekbones, hollow cheeks
    for (const s of [-1, 1]) k += 0.05 * gauss(p.y + 0.12, 0.12) * gauss(p.z - s * 0.55, 0.16) * front;
    for (const s of [-1, 1]) k -= 0.05 * gauss(p.y + 0.4, 0.15) * gauss(p.z - s * 0.55, 0.2) * front;
    // nose (often rotted down to the cavity)
    k += nose * gauss(p.z, 0.09) * gauss(p.y + 0.08, 0.2) * smooth01((p.x - 0.75) / 0.2);
    if (nose < 0.08) k -= 0.05 * gauss(p.z, 0.1) * gauss(p.y + 0.12, 0.08) * front;
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
  // neck with tendons
  sb.tube([
    { c: [0.0, P.neck - 1.6, 0], rx: 2.3, rz: 2.6, bone: [B.CHEST, B.NECK, 0.3] },
    { c: [0.3, P.neck + 0.6, 0], rx: 1.9, rz: 2.15, bone: B.NECK },
    { c: [c[0] - 0.8, c[1] - r[1] * 0.55, 0], rx: 2.0, rz: 2.2, bone: [B.NECK, B.HEAD, 0.7] },
  ], { seg: L === 0 ? dq(12) : 7, subdiv: sd(L) * 2, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#f2f2f2', paint: 0.3,
    profile: L === 0 ? (th) => 1 + 0.08 * Math.pow(Math.abs(Math.cos(th - 0.6)), 8) + 0.08 * Math.pow(Math.abs(Math.cos(th + 0.6)), 8) : null });
  // skull (the mouth hollow is dark wet flesh)
  const inMouth = (x, y, z) => {
    const ux = (x - c[0]) / r[0], uy = (y - c[1]) / r[1], uz = z / r[2];
    return uy < -0.3 && ux > 0.1 && ux < 0.8 && Math.abs(uz) < 0.62;
  };
  sb.ellipsoid(c, r, { segW: L === 0 ? (cin ? 72 : dq(26)) : L === 1 ? 12 : 8, segH: L === 0 ? (cin ? 52 : dq(20)) : L === 1 ? 9 : 6, deform: def,
    slot: SLOT.SKIN, mat: MAT.SKIN, color: '#ffffff', bone: B.HEAD,
    colorFn: L < 2 ? (x, y, z) => {
      if (inMouth(x, y, z)) return '#2a0808';
      const ux = (x - c[0]) / r[0], uy = (y - c[1]) / r[1], uz = z / r[2];
      if (ux < 0.3) return '#ffffff';
      // sunken, bruised eye sockets and a rotted nose
      const sock = Math.max(gauss(uy - 0.12, 0.17) * gauss(uz - 0.37, 0.2), gauss(uy - 0.12, 0.17) * gauss(uz + 0.37, 0.2));
      const nose = gauss(uz, 0.1) * gauss(uy + 0.14, 0.08) * (P.nose < 0.08 ? 1 : 0.4);
      const lips = gauss(uy + 0.34, 0.06) * gauss(uz, 0.45);
      const k = Math.min(1, sock * 0.85 + nose + lips * 0.5);
      const bag = gauss(uy - 0.0, 0.1) * Math.max(gauss(uz - 0.4, 0.2), gauss(uz + 0.4, 0.2)) * 0.35;      // under-eye bags
      const kk = Math.min(1, k + bag);
      _dc.setRGB(1 - kk * 0.8, 1 - kk * 0.9, 1 - kk * 0.78);
      return _dc;
    } : null,
    matFn: L < 2 ? (x, y, z) => (inMouth(x, y, z) ? MAT.FLESH : MAT.SKIN) : null,
    paint: (x, y) => (y < c[1] - r[1] * 0.3 && x > c[0] ? 0.8 : 0.2) });
  // eyes: glowing, deep in the sockets
  if (!cin) for (const s of [-1, 1]) {
    const e = headPoint(P, 0.9, 0.12, s * 0.37, def, 0.9);
    sb.ellipsoid(e, [0.66, 0.6, 0.7], { segW: L === 2 ? 4 : 8, segH: L === 2 ? 3 : 5, slot: SLOT.ACCENT, mat: MAT.EYE, color: '#ffffff', bone: B.HEAD, part: PART.EYE });
  }
  if (L === 0 && !cin) {
    // heavy, sparse brows over the sockets and dark nostrils
    for (const s of [-1, 1]) {
      const b0 = headPoint(P, 0.86, 0.34, s * 0.16, def, 1.005), b1 = headPoint(P, 0.72, 0.36, s * 0.55, def, 1.005);
      sb.tube(lineRings(b0, b1, 0.3, 0.22, 3), { seg: 5, cap0: 'round', cap1: 'round', capRings: 1, slot: SLOT.HAIR, mat: MAT.CLOTH, color: '#7a7a7a', bone: B.HEAD });
      const n = headPoint(P, 0.92, -0.22, s * 0.11, def, 1.0);
      sb.ellipsoid(n, [0.2, 0.16, 0.18], { segW: 5, segH: 3, slot: SLOT.FIXED, mat: MAT.FLESH, color: '#1a0606', bone: B.HEAD });
    }
  }
  // the jaw: a solid mandible hinged under the ears
  const jc = [c[0] + r[0] * 0.14, c[1] - r[1] * 0.7, 0];
  const jr = [r[0] * 0.78, r[1] * 0.3 * Math.min(1.25, P.jawDrop), r[2] * 0.82];
  const jawDef = (p) => {
    p.z *= 1 - 0.3 * Math.max(0, p.x);                   // V toward the chin
    if (p.y > 0.25) p.y = 0.25 + (p.y - 0.25) * 0.35;     // flat top (teeth sit on it)
    if (p.x < -0.4) p.y *= 1.25;                          // taller at the hinge
    if (cin) {
      // chin: a dimple and a firmer point; the jaw line
      const f = Math.max(0, p.x);
      const l = Math.hypot(p.x, p.y, p.z) || 1;
      const k = 1 + 0.05 * gauss(p.y / l + 0.55, 0.3) * gauss(p.z / l, 0.35) * smooth01((p.x / l - 0.5) / 0.3) - 0.03 * gauss(p.z / l, 0.05) * smooth01((p.x / l - 0.7) / 0.2) * (p.y < 0 ? 1 : 0) + 0.02 * f * 0;
      p.x *= k; p.y *= k; p.z *= k;
    }
  };
  sb.ellipsoid(jc, jr, { segW: L === 0 ? (cin ? 48 : 16) : L === 1 ? 8 : 6, segH: L === 0 ? (cin ? 22 : 8) : 4, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#ececec', bone: B.JAW,
    paint: 0.75, colorFn: L < 2 ? (x, y) => (y > jc[1] + jr[1] * 0.55 && x > jc[0] - jr[0] * 0.2 ? '#3a0c0c' : '#ececec') : null,
    deform: jawDef });
  if (L === 2) return def;
  if (L === 1) return def;
  if (cin) {
    cinFace(sb, P, type, (x, y, z, inset) => headPoint(P, x, y, z, def, inset), def, { jc, jr, def: jawDef });
    return def;
  }
  // ears
  for (const s of [-1, 1]) {
    const e = headPoint(P, -0.08, 0.02, s, def, 0.97);
    sb.ellipsoid(e, [1.0, 1.45, 0.35], { segW: 6, segH: 4, rot: [0, 0, 0.2], slot: SLOT.SKIN, mat: MAT.SKIN, color: '#e0e0e0', bone: B.HEAD, paint: 0.4 });
  }
  // tongue lolling on the jaw
  sb.ellipsoid([jc[0] + jr[0] * 0.15, jc[1] + jr[1] * 0.25, 0], [jr[0] * 0.55, 0.5, jr[2] * 0.45], { segW: 7, segH: 4, slot: SLOT.FIXED, mat: MAT.FLESH, color: '#5a1818', bone: B.JAW });
  // teeth: upper row under the lip, lower row on the jaw; a few missing
  for (let t = 0; t < 8; t++) {
    if (t === 2 || t === 6) continue;
    const a = -0.5 + t * 0.143;
    const up = headPoint(P, 0.8, -0.36, a, def, 0.99);
    up[1] -= 0.35;
    sb.ellipsoid(up, [0.18, 0.34 + (t % 3) * 0.06, 0.16], { segW: 5, segH: 3, slot: SLOT.FIXED, mat: MAT.BONE, color: t % 3 ? '#a89c7c' : '#7a6c4c', bone: B.HEAD });
    if (t === 4) continue;
    const ang = a * 1.55;
    const lo = [jc[0] + jr[0] * 0.78 * Math.cos(ang), jc[1] + jr[1] * 0.42, jr[2] * 0.72 * Math.sin(ang)];
    sb.ellipsoid(lo, [0.17, 0.3 + (t % 2) * 0.05, 0.15], { segW: 5, segH: 3, slot: SLOT.FIXED, mat: MAT.BONE, color: t % 2 ? '#a09070' : '#7e6c4a', bone: B.JAW });
  }
  return def;
}

// ---------------------------------------------------------------------------------------

function extras(sb, P, L, type) {
  const GLOWC = { bloater: '#e0ff6a', spitter: '#9cff3a', boss: '#d04dff' };
  if (type === 'bloater') {
    // the belly: a huge distended sphere on X1 (pulses), stretched skin, glowing boils
    sb.ellipsoid([4.4, 33.5, 0], [8.8, 9.5, 9.8], {
      segW: L === 0 ? 24 : L === 1 ? 14 : 8, segH: L === 0 ? 16 : L === 1 ? 10 : 6, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#f4f4e8', bone: B.X1,
      paint: (x, y) => (y < 28 ? 0.6 : 0.25),
      deform: (p) => { if (p.y < -0.3) p.y *= 0.85; const k = 1 + 0.06 * Math.sin(p.x * 7) * Math.sin(p.z * 6); p.x *= k; p.z *= k; },
    });
    if (L < 2) {
      for (let k = 0; k < (L === 0 ? 16 : 8); k++) {
        // scattered over the front and sides (golden-angle spiral), sizes varying
        const u = (k + 0.5) / 16, th = k * 2.39996;
        const ph = -0.75 + u * 1.5;                 // latitude
        const lon = Math.sin(th) * 1.3;             // longitude round the front
        const cy = Math.sin(ph), cr = Math.cos(ph);
        const s = 0.35 + ((k * 0.77) % 1) * 0.55;
        sb.ellipsoid([4.4 + Math.cos(lon) * cr * 8.75, 33.5 + cy * 9.4, Math.sin(lon) * cr * 9.7], [s, s * 0.9, s], { segW: 6, segH: 4, slot: SLOT.GLOW, mat: MAT.GLOW, color: GLOWC.bloater, bone: B.X1 });
      }
      // split navel
      sb.ellipsoid([13.1, 31.5, 0], [0.4, 1.8, 0.7], { segW: 6, segH: 4, slot: SLOT.FIXED, mat: MAT.FLESH, color: '#5a1010', bone: B.X1 });
      // a stretch of swollen veins across the belly
      if (L === 0) for (let v = 0; v < 3; v++) {
        const pts = [];
        for (let i = 0; i <= 6; i++) { const t = i / 6, a = -0.9 + t * 1.8 + v * 0.35; pts.push({ c: [4.4 + Math.cos(a) * 8.95 * Math.cos(0.2 - v * 0.35), 33.5 + Math.sin(0.2 - v * 0.35 + t * 0.5) * 9.6, Math.sin(a) * 10.0 * Math.cos(0.2 - v * 0.35)], r: 0.3 }); }
        sb.tube(pts, { seg: 4, slot: SLOT.FIXED, mat: MAT.FLESH, color: '#4a3a6a', bone: B.X1 });
      }
    }
  } else if (type === 'spitter') {
    // throat sack of acid (glows through the skin), swelling on X1
    const sackDef = (p) => { const k = 1 + 0.08 * Math.sin(p.x * 9 + p.y * 5); p.x *= k; p.z *= k; if (p.y < 0) p.y *= 1.2; };
    sb.ellipsoid([3.2, P.neck - 0.6, 0], [2.1, 2.1, 2.4], { segW: L === 0 ? 12 : 7, segH: L === 0 ? 8 : 5, slot: SLOT.GLOW, mat: MAT.GLOW, color: '#6fd420', bone: B.X1, deform: sackDef });
    if (L < 2) {
      sb.ellipsoid([3.3, P.neck - 0.6, 0], [2.45, 2.4, 2.75], { segW: L === 0 ? 18 : 10, segH: L === 0 ? 12 : 6, slot: SLOT.SKIN, mat: MAT.SKIN_TEAR, color: '#e8f0c8', bone: B.X1, deform: sackDef, paint: 0.3 });
      // acid glands: pustules along the shoulders and upper back
      const gl = L === 0 ? 9 : 4;
      for (let k = 0; k < gl; k++) {
        const a = 2.2 + k * 0.62 + (k % 2) * 0.3, s = 0.5 + ((k * 0.61) % 1) * 0.6;
        sb.ellipsoid([Math.cos(a) * 4.6 * P.depth - 0.4, P.sY - 1 + (k % 3) * 1.6 - 1.5, Math.sin(a) * 7.4], [s, s, s], { segW: 6, segH: 4, slot: SLOT.GLOW, mat: MAT.GLOW, color: GLOWC.spitter, bone: B.CHEST });
      }
      // drool strands hanging from the jaw
      const c = P.headC;
      for (let d = 0; d < 3; d++) {
        const z = (d - 1) * 1.1, len = 5 + d * 2.2;
        sb.tube(lineRings([c[0] + 3.2, c[1] - 4.2, z], [c[0] + 3.5, c[1] - 4.2 - len, z * 1.2], 0.3, 0.12, 4), { seg: 4, cap1: 'round', capRings: 1, slot: SLOT.GLOW, mat: MAT.GLOW, color: '#b8ff4a', bone: B.JAW });
      }
    }
  } else if (type === 'brute') {
    // hulking trapezius and shoulder masses, bone spurs through the back
    sb.ellipsoid([-1.2, P.sY + 1.6, 0], [4.6, 3.6, 7.4], { segW: L === 0 ? 18 : 10, segH: L === 0 ? 10 : 6, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#ffffff', bone: B.CHEST, paint: 0.3 });
    sb.ellipsoid([0, P.sY - 0.5, P.sw * 1.06 + 0.6], [4.4, 4.8, 4.2], { segW: L === 0 ? 14 : 8, segH: L === 0 ? 10 : 5, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#ffffff', bone: [B.CHEST, B.UARM_R, 0.7], paint: 0.4 });
    sb.ellipsoid([0, P.sY - 0.2, -P.sw - 0.2], [3.4, 3.6, 3.2], { segW: L === 0 ? 12 : 7, segH: L === 0 ? 8 : 5, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#ffffff', bone: [B.CHEST, B.UARM_L, 0.7], paint: 0.3 });
    if (L < 2) {
      const spurs = [[-4.6, P.sY + 2.5, -3.5, -0.5, 5], [-5.2, P.chest + 3, 2.5, 0.35, 6], [-4.4, P.chest - 1, -2, -0.2, 4.5], [-2, P.sY + 4.2, 5, 0.8, 4], [1, P.sY + 2.5, 11.5, 1.3, 4.2]];
      for (const [x, y, z, a, len] of spurs) {
        const dx = -Math.cos(a) * 0.85, dz = Math.sin(a) * 0.9, dy = 0.45;
        sb.tube(lineRings([x, y, z], [x + dx * len, y + dy * len, z + dz * len], 0.9, 0.05, 4), { seg: 6, cap0: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.BONE, color: BONE, bone: z > 9 ? B.UARM_R : B.CHEST });
      }
      // scar lattice across the chest (painted wet flesh)
      sb.tube(lineRings([4.8, P.chest + 4, -5], [5.4, P.waist, 4], 0.3, 0.3, 4), { seg: 4, slot: SLOT.FIXED, mat: MAT.FLESH, color: '#6a2020', bone: B.CHEST });
    }
  } else if (type === 'boss') {
    // hump, exposed spine, spikes along the spine and shoulders, tumours, a withered third arm, flayed belly
    sb.ellipsoid([-4, P.sY - 1, 0], [5.8, 7.2, 8.6], { segW: L === 0 ? 20 : 10, segH: L === 0 ? 14 : 6, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#ffffff', bone: B.X1, paint: 0.35,
      deform: (p) => { const k = 1 + 0.1 * Math.sin(p.x * 6 + 1) * Math.sin(p.y * 5) * Math.sin(p.z * 4 + 2); p.x *= k; p.y *= k; p.z *= k; } });
    sb.ellipsoid([4.2, P.waist + 1, 0], [2.8, 5.2, 5.2], { segW: L === 0 ? 14 : 8, segH: L === 0 ? 10 : 5, slot: SLOT.FIXED, mat: MAT.FLESH, color: '#7a1c22', bone: B.SPINE, paint: 0.8 });
    if (L < 2) {
      // flayed strip down the back with the spine bare: vertebrae and rib stubs
      sb.ellipsoid([-9.6, P.sY - 6, 0], [1.4, 16.5, 3.1], { segW: L ? 6 : 10, segH: L ? 8 : 14, slot: SLOT.FIXED, mat: MAT.FLESH, color: '#5a1418', bone: B.X1, paint: 0.9 });
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
        sb.tube(lineRings([x, y, z], [x + dx * len, y + dy * len, z + dz * len], 1.1, 0.06, 4), { seg: L === 0 ? 7 : 5, cap0: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.BONE, color: '#e6dcbc', bone: Math.abs(z) > 9 ? B.CHEST : B.X1 });
      }
      for (let k = 0; k < (L === 0 ? 12 : 5); k++) {
        const a = k * 2.4, y = P.chest - 6 + (k % 4) * 3.5;
        const s = 0.9 + (k % 3) * 0.5;
        sb.ellipsoid([Math.cos(a) * 5.4, y, Math.sin(a) * 8], [s, s, s], { segW: 6, segH: 4, slot: SLOT.GLOW, mat: MAT.GLOW, color: GLOWC.boss, bone: B.CHEST });
      }
      // a great tumour cluster on the right flank
      if (L === 0) for (let k = 0; k < 4; k++) sb.ellipsoid([1 + k * 0.6, P.waist + 4 + k * 2.2, 11 + (k % 2) * 1.4], [2.2 - k * 0.3, 2.2 - k * 0.3, 2.4 - k * 0.3], { segW: 8, segH: 6, slot: SLOT.SKIN, mat: MAT.SKIN_TEAR, color: '#c0a0c8', bone: B.SPINE, paint: 0.3 });
      // third arm: withered, clawed, sprouting from the left shoulder blade
      const X2 = B.X2;
      sb.tube([
        { c: [-2.5, 42, -8.5], r: 1.6, bone: B.CHEST },
        { c: [-2.5, 36, -9.5], r: 1.3, bone: X2 },
        { c: [-2.3, 30, -10], r: 1.0, bone: X2 },
        { c: [-2.0, 25.5, -10.2], r: 0.8, bone: X2 },
      ], { seg: L === 0 ? 8 : 5, cap1: 'round', capRings: 1, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#d8d8d8', paint: 0.5 });
      for (let f = 0; f < 3; f++) {
        sb.tube(lineRings([-2, 25, -10.2 + (f - 1) * 0.7], [-0.8, 21.5, -10.2 + (f - 1) * 1.1], 0.35, 0.03, 3), { seg: 4, slot: SLOT.FIXED, mat: MAT.BONE, color: BONE, bone: X2 });
      }
      // horns curling off the skull
      const c = P.headC;
      for (const s of [-1, 1]) sb.tube([{ c: [c[0] - 0.5, c[1] + 3, s * 2.6], r: 0.9, bone: B.HEAD }, { c: [c[0] - 1.6, c[1] + 5.2, s * 3.9], r: 0.7, bone: B.HEAD }, { c: [c[0] - 3.2, c[1] + 7.0, s * 4.4], r: 0.4, bone: B.HEAD }, { c: [c[0] - 4.8, c[1] + 7.4, s * 4.0], r: 0.05, bone: B.HEAD }], { seg: 6, slot: SLOT.FIXED, mat: MAT.BONE, color: '#cfc4a4' });
    }
  } else if (type === 'crawler' && L < 2) {
    // torn open at the hips: the spine stub and entrails trailing behind on the ground
    sb.tube(lineRings([-0.4, P.hip - 4.5, 0], [-0.6, P.hip - 8.5, 0.3], 0.7, 0.55, 3), { seg: 6, cap1: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.BONE, color: BONE, bone: B.HIPS });
    if (L === 0) {
      for (let k = 0; k < 3; k++) {
        const pts = [];
        for (let i = 0; i <= 9; i++) {
          const t = i / 9;
          pts.push({ c: [0.6 + Math.sin(t * 6 + k * 2) * 0.9, P.hip - 4.6 - t * (14 + k * 4), (k - 1) * 1.3 + Math.sin(t * 5 + k) * 1.1], r: 0.62 + Math.sin(t * 11 + k) * 0.18, bone: B.HIPS });
        }
        sb.tube(pts, { seg: 5, cap1: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.FLESH, color: k % 2 ? '#8a3a44' : '#a04a52', paint: 0.9 });
      }
    }
  } else if (type === 'screamer' && L < 2) {
    // bony collarbones
    for (const s of [-1, 1]) sb.tube(lineRings([3.2, P.sY + 0.2, s * 0.8], [2.4, P.sY + 0.8, s * 6.4], 0.45, 0.35, 3), { seg: 5, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#ffffff', bone: B.CHEST });
  }
}
