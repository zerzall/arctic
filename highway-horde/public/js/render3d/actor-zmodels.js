// Sculpted zombie models for the GPU rig (actor-rig.js), built procedurally with the
// organic shape builder (actor-shape.js): tapered, muscled limbs with blended joints, a
// rounded skull with brow, cheekbones, sunken eye sockets and glowing eyes, a separate
// hinged jaw with teeth and a dark mouth cavity, exposed ribs in a torn wound, layered
// torn clothes (the shirt is a loose shell over the body that rots through per instance),
// shoes or bare feet, patchy hair. Eight silhouettes from zombies.js (walker, runner lean,
// legless crawler, bloater with a pulsing belly and glowing boils, spitter with an acid
// sack and drool, pale long-haired screamer, hunched brute with a club arm and bone spurs,
// spiked boss with growths and a third arm). Three LODs per type: full detail up close,
// no fingers/teeth/ribs at mid range, a light silhouette far away.
//
// Model space: +X forward, +Y up, +Z right; feet on y = 0; ~56 units tall at scale 1.

import { ShapeBuilder, SLOT, MAT, lineRings } from './actor-shape.js';
import * as THREE from 'three';
import { B } from './actor-rig.js';

const _dc = new THREE.Color();

const TAU = Math.PI * 2;
const SHOE = '#2a2019', SOLE = '#141110', BONE = '#d9d0b4', GUM = '#5a1e1e', CAVITY = '#2a0707', NAIL = '#3a3228';
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
  shirt: 'tee', pants: 'jeans', feet: 'shoes', hair: 'patchy', ribs: true, legs: 'full',
  socket: 0.13, nose: 0.14, claws: false, jawDrop: 1, rArmK: 1, lArmK: 1,
};

/** Per-type proportions and wardrobe (look.scale is applied by the renderer). */
export const ZPARAMS = {
  walker: {},
  runner: { bulk: 0.9, depth: 0.92, thighR: 2.8, calfR: 2.1, armR: 2.0, shirt: 'hoodie', pants: 'track', feet: 'sneakers', hair: 'short', ribs: false, socket: 0.16 },
  crawler: { bulk: 0.86, depth: 0.85, armR: 1.9, uarm: 12.6, farm: 11.8, shirt: 'rags', pants: 'shorts', feet: 'bare', legs: 'stumps', hair: 'stringy', claws: true, socket: 0.18, nose: 0.05 },
  bloater: { bulk: 1.18, depth: 1.1, thighR: 3.9, calfR: 3.0, armR: 2.7, handS: 1.2, sw: 9.4, headR: [3.9, 4.3, 3.4], headC: [1.4, 51.8, 0], neck: 46, shirt: 'top', pants: 'jeans', feet: 'shoes', hair: 'none', ribs: false, socket: 0.1 },
  spitter: { bulk: 0.94, depth: 0.95, neck: 47.2, headC: [1.6, 53.4, 0], headR: [4.4, 4.9, 3.6], shirt: 'overalls', pants: 'jeans', feet: 'shoes', hair: 'patchy', ribs: false, jawDrop: 1.3, socket: 0.15 },
  screamer: { bulk: 0.84, depth: 0.86, armR: 1.85, uarm: 12.4, farm: 11.4, thighR: 2.6, calfR: 1.9, headR: [4.2, 5.1, 3.5], shirt: 'gown', pants: 'none', feet: 'bare', hair: 'long', ribs: false, jawDrop: 1.5, socket: 0.17, nose: 0.1 },
  brute: { bulk: 1.3, depth: 1.22, thighR: 3.9, calfR: 3.1, armR: 3.0, handS: 1.35, sw: 10.2, uarm: 12.4, farm: 11.6, headR: [3.9, 4.2, 3.4], headC: [2.6, 51.0, 0], neck: 45.6,
    shirt: 'straps', pants: 'torn', feet: 'boots', hair: 'none', ribs: false, claws: true, rArmK: 1.45, socket: 0.12, nose: 0.06 },
  boss: { bulk: 1.34, depth: 1.25, thighR: 4.2, calfR: 3.4, armR: 3.2, handS: 1.45, sw: 10.8, uarm: 12.8, farm: 12.2, headR: [3.7, 4.0, 3.3], headC: [3.0, 50.8, 0], neck: 45.4,
    shirt: 'robe', pants: 'none', feet: 'bare', hair: 'none', ribs: true, claws: true, socket: 0.14, nose: 0.02 },
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

/**
 * Build one zombie model.
 * @param {string} type zombies.js id
 * @param {number} L LOD 0 (near) · 1 (mid) · 2 (far)
 * @returns {ShapeBuilder}
 */
export function buildZombie(type, L) {
  const P = params(type);
  const sb = new ShapeBuilder();
  const seg = (a, b, c) => (L === 0 ? a : L === 1 ? b : c);
  const K = P.bulk, D = P.depth;

  // ---- torso ------------------------------------------------------------------------
  // rings: [x offset, y, front-back radius, half width, bones]
  const tor = [
    [-0.2, P.hip - 1.6, 3.9, 5.8, B.HIPS],
    [0.0, P.hip + 1.2, 3.8, 5.55, bw(B.HIPS, B.SPINE, 0.5)],
    [0.35, P.waist + 0.4, 4.0, 5.6, B.SPINE],
    [0.4, P.waist + 3.2, 4.3, 6.3, bw(B.SPINE, B.CHEST, 0.5)],
    [0.3, P.chest + 0.6, 4.65, 7.1, B.CHEST],
    [0.15, P.chest + 3.4, 4.75, 7.6, B.CHEST],
    [-0.2, P.sY - 0.9, 4.25, 7.7, B.CHEST],
    [-0.35, P.sY + 0.8, 3.3, 6.5, B.CHEST],
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
  const ribWin = P.ribs && L < 2;
  // the rib wound sits on the left front: θ ≈ 0.35..1.45 (0 = front, π/2 = left)
  const inWound = (x, y, z) => {
    const th = Math.atan2(-z, x);
    return th > 0.25 && th < 1.55 && y > P.chest - 3 && y < P.chest + 5.5;
  };
  const torsoMat = P.shirt === 'none' || L < 2 ? MAT.SKIN : MAT.CLOTH;
  sb.tube(torsoRings, {
    seg: seg(18, 8, 6), cap0: 'round', cap1: 'round', capRings: seg(3, 1, 1), profile: torsoProfile,
    slot: L < 2 ? SLOT.SKIN : SLOT.CLOTH, mat: torsoMat, color: '#ffffff',
    noise: L === 0 ? { amp: 0.28, freq: 0.45 } : null,
    paint: (x, y, z) => (ribWin && inWound(x, y, z) ? 1 : 0.15),
  });
  if (ribWin) woundRibs(sb, P, L);

  // ---- clothes: shirt shell (rots through per instance) ------------------------------
  if (L < 2 && P.shirt !== 'none') shirt(sb, P, L, torsoRings, torsoProfile, type);

  // ---- hips / trousers ---------------------------------------------------------------
  const pantsSlot = SLOT.CLOTH2;
  if (P.pants !== 'none') {
    sb.tube([
      { c: [0, P.hip - 4.2, 0], rx: 3.2 * D, rz: 4.8 * K, bone: B.HIPS },
      { c: [0, P.hip - 1.4, 0], rx: 4.15 * D, rz: 6.1 * K, bone: B.HIPS },
      { c: [0.2, P.hip + 1.6, 0], rx: 4.1 * D, rz: 5.95 * K, bone: bw(B.HIPS, B.SPINE, 0.4) },
      { c: [0.3, P.waist + 0.6, 0], rx: 4.2 * D, rz: 5.85 * K, bone: B.SPINE },
    ], { seg: seg(16, 8, 6), cap0: 'round', capRings: seg(2, 1, 1), slot: pantsSlot, mat: MAT.CLOTH, color: '#ffffff', paint: 0.35 });
    // belt
    if (L === 0 && P.pants === 'jeans') {
      sb.tube(lineRings([0.3, P.waist - 0.2, 0], [0.3, P.waist + 1.1, 0], 4.35 * D, 4.35 * D, 2, (r) => { r.rz = 6.0 * K; r.rx = 4.35 * D; }),
        { seg: 16, slot: SLOT.FIXED, mat: MAT.LEATHER, color: '#2a1e16', bone: B.SPINE });
    }
  }

  // ---- legs ---------------------------------------------------------------------------
  for (const side of [-1, 1]) legs(sb, P, L, side, type);

  // ---- arms ---------------------------------------------------------------------------
  for (const side of [-1, 1]) arm(sb, P, L, side, type);

  // ---- neck + head --------------------------------------------------------------------
  head(sb, P, L, type);

  // ---- per-type extras ----------------------------------------------------------------
  extras(sb, P, L, type);
  return sb;
}

function woundRibs(sb, P, L) {
  const D = P.depth, K = P.bulk;
  // dark cavity behind the ribs, then 4 ribs curving round the left front of the chest
  sb.ellipsoid([2.6 * D, P.chest + 1.2, -4.4 * K], [1.6, 3.8, 2.4 * K], {
    segW: 8, segH: 6, rot: [0, -0.9, 0], slot: SLOT.FIXED, mat: MAT.FLESH, color: '#3a0808', bone: B.CHEST, paint: 0.6,
  });
  if (L > 0) return;
  for (let k = 0; k < 4; k++) {
    const y = P.chest - 1.2 + k * 1.75;
    const rx = 4.75 * D, rz = (7.3 - Math.abs(k - 1.5) * 0.35) * K;
    const pts = [];
    for (let s = 0; s <= 6; s++) {
      const th = 0.28 + (s / 6) * 1.15;
      pts.push({ c: [Math.cos(th) * rx * 1.0, y - s * 0.12, -Math.sin(th) * rz * 1.0], r: 0.42 - s * 0.02 });
    }
    sb.tube(pts, { seg: 5, cap0: 'round', cap1: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.BONE, color: BONE, bone: B.CHEST });
  }
}

function shirt(sb, P, L, torsoRings, profile, type) {
  const kind = P.shirt;
  const slot = SLOT.CLOTH;
  const loose = kind === 'hoodie' ? 0.75 : kind === 'robe' ? 0.9 : 0.5;
  // which torso rings the shell covers (bottom hem → shoulders)
  let from = 1, to = 7;
  if (kind === 'top') from = 4;                                   // bloater: rides up over the belly
  if (kind === 'straps' || kind === 'rags') from = 3;
  const rings = [];
  for (let i = from; i <= to; i++) {
    const r = torsoRings[i];
    rings.push({ c: r.c.slice(), rx: r.rx + loose, rz: r.rz + loose * 1.1, bone: r.bone });
  }
  if (kind === 'gown' || kind === 'robe') {
    // long garment flaring to the knees
    rings.unshift({ c: [0.2, P.hip - 4, 0], rx: 5.4 * P.depth, rz: 7.2 * P.bulk, bone: B.HIPS });
    rings.unshift({ c: [0.4, P.knee + 1, 0], rx: 6.4 * P.depth, rz: 8.6 * P.bulk, bone: B.HIPS });
  }
  if (kind === 'hoodie') rings[0].rx += 0.3;
  // collar
  const top = torsoRings[8];
  rings.push({ c: [top.c[0] - 0.2, top.c[1] - 0.6, 0], rx: top.rx + 0.9, rz: top.rz + 1.2, bone: top.bone });
  const woundArc = P.ribs ? [1.6, TAU + 0.2] : null;
  sb.tube(rings, {
    seg: L === 0 ? 20 : 8, profile, slot, mat: MAT.TEAR, color: '#ffffff', arc: woundArc,
    noise: L === 0 ? { amp: 0.35, freq: 0.3, seed: 5 } : null, paint: (x, y) => (y < P.hip + 3 ? 0.55 : 0.3),
  });
  if (kind === 'straps') {
    // brute: torn shirt remnants hanging from a strap
    sb.tube(lineRings([3.5, P.sY + 0.4, 4.5], [4.6, P.waist - 1, -4.5], 0.9, 0.9, 5, (r) => { r.rz = 1.6; }),
      { seg: 6, slot, mat: MAT.CLOTH, color: '#ffffff', bone: B.CHEST });
  }
  if (kind === 'hoodie' && L < 2) {
    // hood bunched behind the neck
    sb.ellipsoid([-3.3, P.sY + 2.2, 0], [2.4, 2.8, 4.6], { segW: L ? 8 : 14, segH: L ? 5 : 8, slot, mat: MAT.CLOTH, color: '#e8e8e8', bone: B.CHEST, rot: [0, 0, 0.35] });
    // drawstrings
    if (L === 0) for (const s of [-1, 1]) sb.tube(lineRings([4.4, P.sY + 0.6, s * 1.6], [4.9, P.sY - 5, s * 1.9], 0.18, 0.18, 3), { seg: 4, slot: SLOT.FIXED, mat: MAT.CLOTH, color: '#d0d0d0', bone: B.CHEST });
  }
  if (kind === 'overalls') {
    // bib + straps in the trouser colour
    sb.tube([
      { c: [0.6, P.waist - 1, 0], rx: 4.55 * P.depth, rz: 5.3 * P.bulk, bone: B.SPINE },
      { c: [0.7, P.chest + 1.5, 0], rx: 5.1 * P.depth, rz: 5.2 * P.bulk, bone: B.CHEST },
    ], { seg: 16, arc: [-0.9, 0.9], slot: SLOT.CLOTH2, mat: MAT.CLOTH, color: '#ffffff', paint: 0.3 });
    for (const s of [-1, 1]) {
      sb.tube(lineRings([4.4, P.chest + 1.5, s * 3.4], [-4.2, P.chest - 2, s * 3.8], 0.35, 0.35, 5, (r, t) => { r.c[1] += Math.sin(t * Math.PI) * 6.3; r.c[0] = 4.4 - t * 8.6; r.rz = 1.0; }),
        { seg: 4, slot: SLOT.CLOTH2, mat: MAT.CLOTH, color: '#ffffff', bone: B.CHEST, ref: [0, 1, 0] });
    }
  }
  if (kind === 'robe' && L < 2) {
    // tattered cape hanging off the boss' back
    sb.tube([
      { c: [-5.2, P.sY + 1, 0], rx: 1.2, rz: 9, bone: B.CHEST },
      { c: [-6.8, P.chest - 3, 0], rx: 1.4, rz: 10, bone: B.CHEST },
      { c: [-7.2, P.hip - 6, 0], rx: 1.6, rz: 11, bone: bw(B.CHEST, B.HIPS, 0.6) },
      { c: [-6.5, P.knee - 2, 0], rx: 1.5, rz: 11.5, bone: B.HIPS },
    ], { seg: L ? 8 : 16, slot, mat: MAT.TEAR, color: '#bdbdbd', noise: { amp: 0.9, freq: 0.2 } });
  }
}

function legs(sb, P, L, side, type) {
  const z = side * P.legGap;
  const TH = side < 0 ? B.THIGH_L : B.THIGH_R, SH = side < 0 ? B.SHIN_L : B.SHIN_R, FT = side < 0 ? B.FOOT_L : B.FOOT_R;
  const tr = P.thighR * P.bulk, cr = P.calfR * P.bulk;
  const bare = P.pants === 'none' || P.pants === 'shorts';
  const seg = L === 0 ? 12 : L === 1 ? 6 : 5;
  if (P.legs === 'stumps') {
    // legs torn off below the knee: thigh + ragged stump with the bone showing
    sb.tube([
      { c: [0, P.hip + 1, z * 0.9], r: tr * 1.05, bone: bw(B.HIPS, TH, 0.6) },
      { c: [0.2, P.hip - 5, z], r: tr * 0.95, bone: TH },
      { c: [0.3, P.knee + 2, z], r: tr * 0.75, bone: TH },
      { c: [0.3, P.knee - 1.5, z], r: tr * 0.62, bone: bw(TH, SH, 0.6), paint: 1 },
    ], { seg, cap0: 'round', cap1: 'flat', slot: bare ? SLOT.SKIN : SLOT.CLOTH2, mat: bare ? MAT.SKIN : MAT.CLOTH, color: '#ffffff', paint: 0.3 });
    sb.ellipsoid([0.3, P.knee - 1.8, z], [tr * 0.6, 0.9, tr * 0.6], { segW: seg, segH: 3, slot: SLOT.FIXED, mat: MAT.FLESH, color: FLESH, bone: SH, paint: 0.9 });
    if (L < 2) sb.tube(lineRings([0.3, P.knee - 1, z], [0.4, P.knee - 4.5, z + side * 0.3], 0.6, 0.45, 3), { seg: 5, cap1: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.BONE, color: BONE, bone: SH });
    return;
  }
  const kneeY = P.knee, hip = P.hip, ank = P.ankle;
  const legSlot = bare ? SLOT.SKIN : SLOT.CLOTH2, legMat = bare ? MAT.SKIN : MAT.CLOTH;
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
  // shorts / skin legs: trousers stop at the thigh
  if (P.pants === 'shorts' || P.pants === 'none') {
    sb.tube(rings, { seg, cap0: 'round', capRings: 1, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#ffffff', paint: (x, y) => (y < kneeY ? 0.45 : 0.2),
      noise: L === 0 ? { amp: 0.18, freq: 0.5 } : null });
    if (P.pants === 'shorts') {
      sb.tube(rings.slice(0, 3).map((r) => ({ ...r, rx: (r.rx ?? r.r) + 0.45, rz: (r.rz ?? r.r) + 0.45, r: undefined })),
        { seg, slot: SLOT.CLOTH2, mat: MAT.TEAR, color: '#ffffff', paint: 0.4 });
    }
  } else {
    const loose = P.pants === 'track' ? 0.25 : 0.3;
    const pr = rings.map((r, i) => ({ ...r, rx: (r.rx ?? r.r) + loose + (i > 5 ? 0.25 : 0), rz: (r.rz ?? r.r) + loose + (i > 5 ? 0.2 : 0), r: undefined }));
    if (P.pants === 'torn') {
      // brute: trousers ripped off at the knee, bare shins below
      sb.tube(pr.slice(0, 6), { seg, cap0: 'round', capRings: 1, slot: legSlot, mat: MAT.TEAR, color: '#ffffff', paint: 0.4,
        noise: L === 0 ? { amp: 0.3, freq: 0.4 } : null });
      sb.tube(rings.slice(3), { seg, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#ffffff', paint: 0.35 });
    } else {
      sb.tube(pr, { seg, cap0: 'round', capRings: 1, slot: legSlot, mat: legMat, color: '#ffffff', paint: (x, y) => (y < kneeY - 3 ? 0.5 : 0.28),
        noise: L === 0 ? { amp: 0.22, freq: 0.35, seed: side * 3 } : null });
    }
  }
  // feet
  const fx = 1.7;
  if (P.feet === 'bare') {
    sb.ellipsoid([fx, 1.1, z], [3.2, 1.25, 1.55], { segW: L ? 7 : 12, segH: L ? 4 : 6, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#e0e0e0', bone: FT, paint: 0.7,
      deform: (p) => { if (p.y < 0) p.y *= 0.5; if (p.x > 0.4) p.y *= 0.8; } });
    if (L === 0) {
      for (let t = 0; t < 4; t++) {
        sb.ellipsoid([fx + 3.0, 0.6, z + side * (-0.7 + t * 0.45)], [0.55, 0.45, 0.28], { segW: 5, segH: 3, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#d0d0d0', bone: FT, paint: 0.7 });
      }
    }
  } else {
    const boot = P.feet === 'boots', snk = P.feet === 'sneakers';
    const up = boot ? 3.4 : 1.6;
    sb.ellipsoid([fx, up * 0.5 + 0.55, z], [3.6, up * 0.5 + 0.9, 1.8], {
      segW: L ? 7 : 14, segH: L ? 4 : 7, slot: SLOT.FIXED, mat: snk ? MAT.CLOTH : MAT.LEATHER, color: snk ? '#8a8a8a' : boot ? '#231b14' : SHOE, bone: FT, paint: 0.45,
      deform: (p) => { if (p.y < -0.2) p.y = -0.2 - (p.y + 0.2) * 0.25; if (p.x < -0.2 && p.y > 0) p.x *= 0.8; },
    });
    if (L === 0) sb.ellipsoid([fx + 0.2, 0.35, z], [3.8, 0.4, 1.9], { segW: 12, segH: 3, slot: SLOT.FIXED, mat: MAT.RUBBER, color: snk ? '#d8d4c8' : SOLE, bone: FT });
  }
}

function arm(sb, P, L, side, type) {
  const R = side > 0;
  const k = R ? P.rArmK : P.lArmK;
  const UA = R ? B.UARM_R : B.UARM_L, FA = R ? B.FARM_R : B.FARM_L, HD = R ? B.HAND_R : B.HAND_L;
  const z = side * P.sw * (R && k > 1 ? 1.06 : 1);
  const top = P.sY, elbow = P.sY - P.uarm * k, wrist = P.sY - (P.uarm + P.farm) * k;
  const r = P.armR * k * (type === 'bloater' ? 1.1 : 1);
  const seg = L === 0 ? 12 : L === 1 ? 6 : 5;
  const rings = [
    { c: [-0.2, top + 0.9, z * 0.9], r: r * 0.92, bone: [B.CHEST, UA, 0.55] },
    { c: [0.1, top - 1.4, z * 1.0], rx: r * 1.08, rz: r * 1.0, bone: UA },
    { c: [0.0, top - (elbow - top) * -0.45, z], rx: r * 0.95, rz: r * 0.9, bone: UA },
    { c: [-0.2, elbow + 1.2, z], rx: r * 0.8, rz: r * 0.78, bone: [UA, FA, 0.25] },
    { c: [-0.3, elbow, z], rx: r * 0.8, rz: r * 0.76, bone: [UA, FA, 0.5] },
    { c: [0.05, elbow - 2.8, z], rx: r * 0.92, rz: r * 0.85, bone: [UA, FA, 0.85] },
    { c: [0.2, wrist + 3.2, z], rx: r * 0.7, rz: r * 0.62, bone: FA },
    { c: [0.2, wrist + 0.3, z], rx: r * 0.55, rz: r * 0.46, bone: [FA, HD, 0.5] },
  ];
  sb.tube(rings, { seg, cap0: 'round', capRings: L ? 1 : 2, cap1: 'flat', slot: SLOT.SKIN, mat: MAT.SKIN, color: '#ffffff',
    paint: (x, y) => (y < elbow ? 0.45 : 0.15), noise: L === 0 ? { amp: 0.16 * k, freq: 0.6, seed: side } : null });
  // sleeves
  const sl = P.shirt;
  if (L < 2 && (sl === 'tee' || sl === 'hoodie' || sl === 'gown' || sl === 'overalls' || sl === 'robe')) {
    const long = sl === 'hoodie' || sl === 'robe';
    const n = long ? 7 : 3;
    const loose = long ? 0.4 : 0.22;
    const srings = rings.slice(0, n).map((q) => ({ ...q, rx: (q.rx ?? q.r) + loose, rz: (q.rz ?? q.r) + loose, r: undefined }));
    if (!long) srings[srings.length - 1] = { ...srings[srings.length - 1], rx: srings[srings.length - 1].rx + 0.2, rz: srings[srings.length - 1].rz + 0.2 };
    sb.tube(srings, { seg, slot: SLOT.CLOTH, mat: long ? MAT.CLOTH : MAT.TEAR, color: '#ffffff', paint: 0.25, noise: L === 0 ? { amp: 0.2, freq: 0.5 } : null });
  }
  hand(sb, P, L, side, HD, [0.3, wrist, z], r, k);
}

function hand(sb, P, L, side, HD, w, r, k) {
  const s = P.handS * k;
  const claw = P.claws;
  // palm
  sb.ellipsoid([w[0] + 0.4 * s, w[1] - 2.2 * s, w[2]], [1.25 * s, 2.3 * s, 1.75 * s * (L === 2 ? 1 : 0.95)], {
    segW: L === 0 ? 10 : L === 1 ? 7 : 5, segH: L === 0 ? 6 : 4, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#f0f0f0', bone: HD, paint: 0.5,
  });
  if (L === 2) return;
  if (L === 1) {
    // mitten of fingers
    sb.ellipsoid([w[0] + 0.9 * s, w[1] - 4.6 * s, w[2]], [0.9 * s, 1.8 * s, 1.6 * s], { segW: 6, segH: 4, rot: [0, 0, 0.35], slot: SLOT.SKIN, mat: MAT.SKIN, color: '#e8e8e8', bone: HD, paint: 0.5 });
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
    sb.tube(pts, { seg: 6, cap0: 'round', cap1: 'round', capRings: 1, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#e6e6e6', bone: HD, paint: 0.55 });
    const tip = pts[3].c;
    if (claw) {
      sb.tube(lineRings([tip[0] - 0.1, tip[1] + 0.2, tip[2]], [tip[0] + 0.9 * s, tip[1] - 1.2 * s, tip[2]], 0.28 * s, 0.02, 3), { seg: 5, slot: SLOT.FIXED, mat: MAT.BONE, color: '#bfb49a', bone: HD });
    } else {
      sb.ellipsoid([tip[0] + 0.12, tip[1] + 0.1, tip[2]], [0.3 * s, 0.4 * s, 0.32 * s], { segW: 5, segH: 3, slot: SLOT.FIXED, mat: MAT.BONE, color: NAIL, bone: HD });
    }
  }
  // thumb
  const tz = w[2] - side * 1.3 * s;
  sb.tube(lineRings([w[0] + 0.9 * s, w[1] - 1.4 * s, tz], [w[0] + 2.2 * s, w[1] - 3.6 * s, tz - side * 0.3 * s], 0.5 * s, 0.38 * s, 3), { seg: 6, cap1: 'round', capRings: 1, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#e6e6e6', bone: HD, paint: 0.5 });
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
  const def = headDeform(P, type);
  // neck with tendons
  sb.tube([
    { c: [0.0, P.neck - 1.6, 0], rx: 2.3, rz: 2.6, bone: [B.CHEST, B.NECK, 0.3] },
    { c: [0.3, P.neck + 0.6, 0], rx: 1.9, rz: 2.15, bone: B.NECK },
    { c: [c[0] - 0.8, c[1] - r[1] * 0.55, 0], rx: 2.0, rz: 2.2, bone: [B.NECK, B.HEAD, 0.7] },
  ], { seg: L === 0 ? 12 : 7, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#f2f2f2', paint: 0.3,
    profile: L === 0 ? (th) => 1 + 0.08 * Math.pow(Math.abs(Math.cos(th - 0.6)), 8) + 0.08 * Math.pow(Math.abs(Math.cos(th + 0.6)), 8) : null });
  // skull (the mouth hollow is dark wet flesh)
  const inMouth = (x, y, z) => {
    const ux = (x - c[0]) / r[0], uy = (y - c[1]) / r[1], uz = z / r[2];
    return uy < -0.3 && ux > 0.1 && ux < 0.8 && Math.abs(uz) < 0.62;
  };
  sb.ellipsoid(c, r, { segW: L === 0 ? 26 : L === 1 ? 12 : 8, segH: L === 0 ? 20 : L === 1 ? 9 : 6, deform: def,
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
      _dc.setRGB(1 - k * 0.72, 1 - k * 0.8, 1 - k * 0.7);
      return _dc;
    } : null,
    matFn: L < 2 ? (x, y, z) => (inMouth(x, y, z) ? MAT.FLESH : MAT.SKIN) : null,
    paint: (x, y) => (y < c[1] - r[1] * 0.3 && x > c[0] ? 0.8 : 0.2) });
  // eyes: glowing, deep in the sockets
  for (const s of [-1, 1]) {
    const e = headPoint(P, 0.9, 0.12, s * 0.37, def, 0.9);
    sb.ellipsoid(e, [0.66, 0.6, 0.7], { segW: L === 2 ? 4 : 8, segH: L === 2 ? 3 : 5, slot: SLOT.ACCENT, mat: MAT.EYE, color: '#ffffff', bone: B.HEAD });
  }
  // the jaw: a solid mandible hinged under the ears
  const jc = [c[0] + r[0] * 0.14, c[1] - r[1] * 0.7, 0];
  const jr = [r[0] * 0.78, r[1] * 0.3 * Math.min(1.25, P.jawDrop), r[2] * 0.82];
  sb.ellipsoid(jc, jr, { segW: L === 0 ? 16 : L === 1 ? 8 : 6, segH: L === 0 ? 8 : 4, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#ececec', bone: B.JAW,
    paint: 0.75, colorFn: L < 2 ? (x, y) => (y > jc[1] + jr[1] * 0.55 && x > jc[0] - jr[0] * 0.2 ? '#3a0c0c' : '#ececec') : null,
    deform: (p) => {
      p.z *= 1 - 0.3 * Math.max(0, p.x);                   // V toward the chin
      if (p.y > 0.25) p.y = 0.25 + (p.y - 0.25) * 0.35;     // flat top (teeth sit on it)
      if (p.x < -0.4) p.y *= 1.25;                          // taller at the hinge
    } });
  if (L === 2) return;
  if (L === 1) { hair(sb, P, L, type, def); return; }
  // ears
  for (const s of [-1, 1]) {
    const e = headPoint(P, -0.08, 0.02, s, def, 0.97);
    sb.ellipsoid(e, [1.0, 1.45, 0.35], { segW: 6, segH: 4, rot: [0, 0, 0.2], slot: SLOT.SKIN, mat: MAT.SKIN, color: '#e0e0e0', bone: B.HEAD, paint: 0.4 });
  }
  // tongue lolling on the jaw
  sb.ellipsoid([jc[0] + jr[0] * 0.15, jc[1] + jr[1] * 0.25, 0], [jr[0] * 0.55, 0.5, jr[2] * 0.45], { segW: 7, segH: 4, slot: SLOT.FIXED, mat: MAT.FLESH, color: '#5a1818', bone: B.JAW });
  if (L === 0) {
    // teeth: upper row under the lip, lower row on the jaw; a few missing
    for (let t = 0; t < 8; t++) {
      if (t === 2 || t === 6) continue;
      const a = -0.5 + t * 0.143;
      const up = headPoint(P, 0.8, -0.36, a, def, 0.99);
      up[1] -= 0.35;
      sb.ellipsoid(up, [0.24, 0.48, 0.2], { segW: 5, segH: 3, slot: SLOT.FIXED, mat: MAT.BONE, color: t % 3 ? '#b8ab88' : '#8a7a58', bone: B.HEAD });
      if (t === 4) continue;
      const ang = a * 1.55;
      const lo = [jc[0] + jr[0] * 0.78 * Math.cos(ang), jc[1] + jr[1] * 0.42, jr[2] * 0.72 * Math.sin(ang)];
      sb.ellipsoid(lo, [0.22, 0.42, 0.2], { segW: 5, segH: 3, slot: SLOT.FIXED, mat: MAT.BONE, color: t % 2 ? '#b0a080' : '#8e7c5a', bone: B.JAW });
    }
  }
  // hair
  hair(sb, P, L, type, def);
}

function hair(sb, P, L, type, def) {
  const c = P.headC, r = P.headR;
  const kind = P.hair;
  if (kind === 'none') return;
  const on = (x, y, z, inset) => {
    const l = Math.hypot(x, y, z);
    const p = { x: x / l, y: y / l, z: z / l };
    def(p);
    return [c[0] + p.x * r[0] * inset, c[1] + p.y * r[1] * inset, c[2] + p.z * r[2] * inset];
  };
  if (kind === 'short' || kind === 'patchy') {
    // a thin, matted scalp layer (the hair material thins it into patches)...
    sb.ellipsoid([c[0] - 0.15, c[1] + 0.05, 0], [r[0] * 1.012, r[1] * 1.01, r[2] * 1.018], {
      segW: L ? 10 : 22, segH: L ? 6 : 12, slot: SLOT.HAIR, mat: MAT.HAIR, color: '#ffffff', bone: B.HEAD,
      deform: (p) => {
        def(p);
        const hl = 0.25 + Math.max(0, p.x) * 0.3 - Math.max(0, -p.x) * 0.4;
        if (p.y < hl) { p.x *= 0.94; p.y = hl - (hl - p.y) * 0.2; p.z *= 0.94; }
      },
    });
  }
  // ...and clumps of lank strands hanging from it
  const n = kind === 'long' ? (L === 0 ? 18 : 9) : kind === 'stringy' ? (L === 0 ? 12 : 6) : 0;
  const len0 = kind === 'long' ? 17 : kind === 'stringy' ? 9 : kind === 'patchy' ? 4.5 : 2.2;
  for (let i = 0; i < n; i++) {
    const h1 = ((i * 0.618034) % 1), h2 = ((i * 0.414214 + 0.3) % 1);
    // roots spread over the crown and the back of the head
    const lon = kind === 'long' ? (i / (n - 1)) * Math.PI * 1.3 + Math.PI * 0.35 : 0.4 + h1 * (Math.PI * 2 - 0.8);
    const lat = kind === 'long' ? 0.35 + h2 * 0.25 : 0.25 + h2 * 0.55;
    const ux = Math.cos(lon) * Math.cos(lat), uz = Math.sin(lon) * Math.cos(lat), uy = Math.sin(lat);
    const root = on(ux, uy, uz, 0.97);
    const len = len0 * (0.7 + h1 * 0.6);
    const out = [ux * 0.25, 0, uz * 0.25];
    const pts = [];
    for (let j = 0; j <= 4; j++) {
      const t = j / 4;
      const sag = t * t;
      pts.push({ c: [root[0] + out[0] * t * 2 - sag * (kind === 'long' ? 1.6 : 0.4), root[1] - len * sag - t * 0.8, root[2] + out[2] * t * 2 + sag * uz * (kind === 'long' ? 1.5 : 0.3)],
        rx: (0.75 - t * 0.5) * (L ? 1.3 : 1) * (kind === 'long' ? 1.1 : 0.8), rz: 0.32,
        bone: kind === 'long' ? (t < 0.3 ? B.HEAD : t < 0.7 ? [B.HEAD, B.CHEST, 0.5] : B.CHEST) : B.HEAD });
    }
    sb.tube(pts, { seg: L ? 4 : 5, cap1: 'round', capRings: 1, slot: SLOT.HAIR, mat: MAT.CLOTH, color: '#ffffff', ref: [ux, uy, uz] });
  }
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
    }
  } else if (type === 'spitter') {
    // throat sack of acid (glows through the skin), swelling on X1
    const sackDef = (p) => { const k = 1 + 0.08 * Math.sin(p.x * 9 + p.y * 5); p.x *= k; p.z *= k; if (p.y < 0) p.y *= 1.2; };
    sb.ellipsoid([3.2, P.neck - 0.6, 0], [2.1, 2.1, 2.4], { segW: L === 0 ? 12 : 7, segH: L === 0 ? 8 : 5, slot: SLOT.GLOW, mat: MAT.GLOW, color: '#6fd420', bone: B.X1, deform: sackDef });
    if (L < 2) {
      sb.ellipsoid([3.3, P.neck - 0.6, 0], [2.45, 2.4, 2.75], { segW: L === 0 ? 18 : 10, segH: L === 0 ? 12 : 6, slot: SLOT.SKIN, mat: MAT.SKIN_TEAR, color: '#e8f0c8', bone: B.X1, deform: sackDef, paint: 0.3 });
    }
    if (L < 2) {
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
    // hump, spikes along the spine and shoulders, tumours, a withered third arm, flayed belly
    sb.ellipsoid([-4, P.sY - 1, 0], [5.8, 7.2, 8.6], { segW: L === 0 ? 20 : 10, segH: L === 0 ? 14 : 6, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#ffffff', bone: B.X1, paint: 0.35,
      deform: (p) => { const k = 1 + 0.1 * Math.sin(p.x * 6 + 1) * Math.sin(p.y * 5) * Math.sin(p.z * 4 + 2); p.x *= k; p.y *= k; p.z *= k; } });
    sb.ellipsoid([4.2, P.waist + 1, 0], [2.8, 5.2, 5.2], { segW: L === 0 ? 14 : 8, segH: L === 0 ? 10 : 5, slot: SLOT.FIXED, mat: MAT.FLESH, color: '#7a1c22', bone: B.SPINE, paint: 0.8 });
    if (L < 2) {
      const spikes = [];
      for (let i = 0; i < 9; i++) spikes.push([-8.5 + Math.abs(i - 4) * 0.3, P.sY + 5 - i * 2.4, (i % 2 ? 1 : -1) * (2.2 + (i % 3)), (i % 2 ? 0.45 : -0.45), 6 + (i % 3) * 2.2]);
      spikes.push([-1, P.sY + 3.5, -10, -1.3, 6.5], [-1, P.sY + 3.5, 10, 1.3, 6.5], [-2, P.sY + 1, -12, -1.5, 5], [-2, P.sY + 1, 12, 1.5, 5]);
      for (const [x, y, z, a, len] of spikes) {
        const dx = -Math.cos(a) * 0.8, dz = Math.sin(a) * 0.95, dy = 0.5;
        sb.tube(lineRings([x, y, z], [x + dx * len, y + dy * len, z + dz * len], 1.1, 0.06, 4), { seg: L === 0 ? 7 : 5, cap0: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.BONE, color: '#e6dcbc', bone: Math.abs(z) > 9 ? B.CHEST : B.X1 });
      }
      for (let k = 0; k < (L === 0 ? 10 : 5); k++) {
        const a = k * 2.4, y = P.chest - 6 + (k % 4) * 3.5;
        const s = 0.9 + (k % 3) * 0.5;
        sb.ellipsoid([Math.cos(a) * 5.4, y, Math.sin(a) * 8], [s, s, s], { segW: 6, segH: 4, slot: SLOT.GLOW, mat: MAT.GLOW, color: GLOWC.boss, bone: B.CHEST });
      }
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
    }
  } else if (type === 'screamer' && L < 2) {
    // bony collarbones and a gown tie at the back
    for (const s of [-1, 1]) sb.tube(lineRings([3.2, P.sY + 0.2, s * 0.8], [2.4, P.sY + 0.8, s * 6.4], 0.45, 0.35, 3), { seg: 5, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#ffffff', bone: B.CHEST });
  }
}
