// Survivor (teammate) models for the GPU rig: sculpted soldiers per class built with the
// organic shape builder — combat trousers with knee pads and cargo pockets, laced boots,
// a shirt under a vest with pouches (class-specific kit: mag pouches, medic cross, tool
// belt with hi-vis stripes, grenades, armour plates), a backpack, gloved hands closed
// round a grip, a face (brow, nose, ears, eyes, stubble) and the class headgear: combat
// helmet, cap, hard hat, bandana, beanie or a shaved head. The player's colour shows as
// an armband and a stripe on the headgear (colour slot ACCENT).
//
// Model space as actor-rig.js: +X forward, +Y up, +Z right; feet at y = 0 (~57 tall).

import { ShapeBuilder, SLOT, MAT, PART, lineRings } from './actor-shape.js';
import { addClassGear, GLOVES } from './actor-sgear.js';
import { B } from './actor-rig.js';
import { CLASSES } from '../shared/classes.js';
import { shadeHex, mixHex } from './actor-kit.js';

const gauss = (x, s) => Math.exp(-(x * x) / (s * s));
const smooth01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const bw = (a, b, w) => (w <= 0 ? a : w >= 1 ? b : [a, b, w]);

export const SP = {
  hip: 29, knee: 15.5, ankle: 3, legGap: 3.8, thighR: 3.05, calfR: 2.3,
  waist: 32.5, chest: 38.5, sY: 45.4, sw: 8.4, uarm: 11.2, farm: 10.2, armR: 2.15,
  neck: 47.2, headC: [0.9, 52.6, 0], headR: [4.05, 4.55, 3.45],
};

/** Skeleton pivots + parents for survivors. */
export function soldierSkeleton() {
  const P = SP;
  const piv = [];
  piv[B.HIPS] = [0, P.hip, 0];
  piv[B.SPINE] = [0, P.waist, 0];
  piv[B.CHEST] = [0, P.chest, 0];
  piv[B.NECK] = [0.2, P.neck, 0];
  piv[B.HEAD] = [0.4, P.headC[1] - P.headR[1] * 0.62, 0];
  piv[B.JAW] = [0.4, P.headC[1] - P.headR[1] * 0.2, 0];
  for (const s of [-1, 1]) {
    const R = s > 0;
    piv[R ? B.UARM_R : B.UARM_L] = [0, P.sY, s * P.sw];
    piv[R ? B.FARM_R : B.FARM_L] = [0, P.sY - P.uarm, s * P.sw];
    piv[R ? B.HAND_R : B.HAND_L] = [0, P.sY - P.uarm - P.farm, s * P.sw];
    piv[R ? B.THIGH_R : B.THIGH_L] = [0, P.hip, s * P.legGap];
    piv[R ? B.SHIN_R : B.SHIN_L] = [0, P.knee, s * P.legGap];
    piv[R ? B.FOOT_R : B.FOOT_L] = [0, P.ankle, s * P.legGap];
  }
  piv[B.X1] = [0, P.chest, 0];
  piv[B.X2] = [0, P.chest, 0];
  return { pivots: piv, parents: [-1, 0, 1, 2, 3, 4, 2, 6, 7, 2, 9, 10, 0, 12, 13, 0, 15, 16, 2, 2] };
}

const BOOT = '#1f1a15', SOLE = '#121010', GLOVE = '#26211c', STRAP = '#2a261e', BUCKLE = '#6a6a66';

/**
 * @param {string} cls classes.js id
 * @param {number} L 0 near · 1 far
 * @param {number} [tier] quality tier (2 = low: no class gear beyond the base kit)
 */
export function buildSoldier(cls, L, tier = 0) {
  const P = SP;
  const look = (CLASSES[cls] || CLASSES.soldier).look;
  const vest = look.vest, hat = look.hat;
  const heavy = cls === 'heavy';
  const sb = new ShapeBuilder();
  const seg = (a, b) => (L === 0 ? a : b);

  // ---- torso (shirt in the outfit colour) ----
  const tor = [
    [-0.1, P.hip - 1.4, 3.9, 5.9, B.HIPS],
    [0.1, P.hip + 1.4, 3.85, 5.7, bw(B.HIPS, B.SPINE, 0.5)],
    [0.2, P.waist + 0.8, 4.0, 5.8, B.SPINE],
    [0.25, P.waist + 3.6, 4.3, 6.5, bw(B.SPINE, B.CHEST, 0.5)],
    [0.2, P.chest + 1.0, 4.6, 7.3, B.CHEST],
    [0.1, P.chest + 3.8, 4.6, 7.7, B.CHEST],
    [-0.2, P.sY - 0.6, 4.1, 7.6, B.CHEST],
    [-0.3, P.sY + 1.0, 3.2, 6.3, B.CHEST],
    [0.1, P.neck + 0.2, 2.2, 3.0, bw(B.CHEST, B.NECK, 0.3)],
  ];
  const rings = tor.map(([x, y, rx, rz, bone]) => ({ c: [x, y, 0], rx, rz, bone }));
  sb.tube(rings, { seg: seg(18, 10), cap0: 'round', cap1: 'round', capRings: seg(3, 1), slot: SLOT.CLOTH, mat: MAT.CLOTH, color: '#ffffff', paint: 0.05, part: PART.TOP,
    profile: (th) => 1 - 0.1 * Math.max(0, -Math.cos(th)) });
  // ---- vest: a thicker shell over the chest with pouches ----
  const vk = heavy ? 1.2 : 1;
  const vr = rings.slice(2, 8).map((r, i) => ({ c: [r.c[0] + 0.1, r.c[1] + (i === 5 ? -0.8 : 0), 0], rx: r.rx + 0.9 * vk, rz: r.rz + 0.7 * vk, bone: r.bone }));
  vr[0].c[1] -= 0.8;
  sb.tube(vr, { seg: seg(18, 10), cap0: 'flat', slot: SLOT.FIXED, mat: MAT.LEATHER, color: vest, paint: 0.05,
    profile: (th) => 1 - 0.08 * Math.max(0, -Math.cos(th)) });
  // shoulder straps
  for (const s of [-1, 1]) {
    sb.tube(lineRings([4.4, P.chest + 4, s * 4.2], [-4.2, P.chest + 4, s * 4.2], 0.5, 0.5, 5, (r, t) => { r.c[1] += Math.sin(t * Math.PI) * 4.4; r.rz = 1.5; r.rx = 0.55; }),
      { seg: 6, slot: SLOT.FIXED, mat: MAT.LEATHER, color: shadeHex(vest, -0.1), bone: B.CHEST, ref: [0, 1, 0] });
  }
  // belt + pouches + holster
  sb.tube(lineRings([0.2, P.waist - 1.6, 0], [0.2, P.waist - 0.2, 0], 4.5, 4.5, 2, (r) => { r.rz = 6.15; }), { seg: seg(18, 10), slot: SLOT.FIXED, mat: MAT.LEATHER, color: STRAP, bone: B.SPINE });
  if (L === 0) {
    sb.ellipsoid([4.6, P.waist - 0.9, 0], [0.4, 0.8, 1.2], { segW: 6, segH: 4, slot: SLOT.FIXED, mat: MAT.METAL, color: BUCKLE, bone: B.SPINE });
    for (const z of [-4.5, 4.5]) roundBox(sb, [-2.2, P.waist - 1.8, z], [2.2, 3.0, 1.6], shadeHex(vest, -0.05), B.SPINE, MAT.LEATHER);
    roundBox(sb, [-4.2, P.waist - 1.5, 0], [1.8, 2.6, 4.2], shadeHex(vest, -0.08), B.SPINE, MAT.LEATHER);
  }
  // class kit on the vest front
  const front = (y, z, size, color, mat = MAT.LEATHER) => roundBox(sb, [4.9 * vk + size[0] * 0.3, y, z], size, color, B.CHEST, mat);
  if (cls === 'soldier' || cls === 'heavy') {
    for (let k = -1; k <= 1; k++) front(P.waist + 5.2, k * 2.6, [1.5, 3.4, 2.2], shadeHex(vest, -0.12));
    if (L === 0) front(P.chest + 4.4, -3.2, [1.0, 1.8, 2.2], shadeHex(vest, -0.18));
  } else if (cls === 'medic') {
    // white cross on the chest and back
    for (const x of [5.3, -5.3]) {
      roundBox(sb, [x, P.chest + 1.5, 0], [0.4, 4.2, 1.3], '#dadad6', B.CHEST, MAT.CLOTH);
      roundBox(sb, [x, P.chest + 1.5, 0], [0.4, 1.3, 4.2], '#dadad6', B.CHEST, MAT.CLOTH);
    }
    front(P.waist + 5, 3.2, [1.4, 2.6, 2.4], '#e0e0e0');
  } else if (cls === 'engineer') {
    // hi-vis stripes round the vest + tool pouches
    for (const y of [P.waist + 4.2, P.chest + 3.2]) {
      sb.tube(lineRings([0.3, y - 0.45, 0], [0.3, y + 0.45, 0], 1, 1, 2, (r) => { r.rx = 5.35; r.rz = 8.25; }), { seg: seg(18, 10), slot: SLOT.FIXED, mat: MAT.CLOTH, color: '#e8e070', bone: B.CHEST });
    }
    if (L === 0) {
      roundBox(sb, [3.8, P.waist - 3.4, 5.2], [2.4, 3.4, 1.8], '#5d4a32', B.HIPS, MAT.LEATHER);
      sb.tube(lineRings([4.2, P.waist - 2, 5.9], [4.6, P.waist - 7, 6.2], 0.3, 0.3, 2), { seg: 5, slot: SLOT.FIXED, mat: MAT.METAL, color: '#9a9a9a', bone: B.HIPS });
    }
  } else if (cls === 'demo') {
    for (let k = -1; k <= 1; k++) {
      sb.ellipsoid([5.6 * vk, P.waist + 4.6, k * 2.8], [1.1, 1.35, 1.1], { segW: 8, segH: 6, slot: SLOT.FIXED, mat: MAT.METAL, color: '#4a5a2a', bone: B.CHEST });
      if (L === 0) sb.ellipsoid([5.7 * vk, P.waist + 6.2, k * 2.8], [0.35, 0.45, 0.35], { segW: 5, segH: 3, slot: SLOT.FIXED, mat: MAT.METAL, color: '#8a8a80', bone: B.CHEST });
    }
  } else if (cls === 'scout') {
    front(P.waist + 5.4, -2.0, [1.3, 2.8, 1.8], shadeHex(vest, 0.1));
    front(P.waist + 5.4, 2.0, [1.3, 2.8, 1.8], shadeHex(vest, 0.1));
  }
  if (heavy) {
    // armour plates, neck guard and pauldrons
    roundBox(sb, [5.4, P.chest + 1, 0], [1.2, 9.5, 9.5], shadeHex(vest, 0.08), B.CHEST, MAT.METAL);
    sb.tube(lineRings([-0.2, P.sY + 0.6, 0], [-0.2, P.sY + 2.6, 0], 5, 4.2, 3, (r) => { r.rx = 4.4 - (r.c[1] - P.sY) * 0.25; r.rz = 6.6 - (r.c[1] - P.sY) * 0.8; }),
      { seg: seg(16, 10), slot: SLOT.FIXED, mat: MAT.LEATHER, color: vest, bone: B.CHEST });
  }
  // ---- backpack ----
  backpack(sb, P, cls, vest, look.outfit, L);

  // ---- legs: trousers (outfit colour), knee pads, boots ----
  for (const s of [-1, 1]) {
    const z = s * P.legGap;
    const TH = s < 0 ? B.THIGH_L : B.THIGH_R, SH = s < 0 ? B.SHIN_L : B.SHIN_R, FT = s < 0 ? B.FOOT_L : B.FOOT_R;
    const tr = P.thighR, cr = P.calfR;
    sb.tube([
      { c: [0.1, P.hip + 1.4, z * 0.92], r: tr * 1.12, bone: bw(B.HIPS, TH, 0.55) },
      { c: [0.3, P.hip - 3.5, z], rx: tr * 1.08, rz: tr * 1.02, bone: TH },
      { c: [0.35, P.hip - 8.5, z], rx: tr * 0.95, rz: tr * 0.92, bone: TH },
      { c: [0.4, P.knee + 1.6, z], rx: tr * 0.8, rz: tr * 0.78, bone: bw(TH, SH, 0.3) },
      { c: [0.5, P.knee, z], rx: tr * 0.78, rz: tr * 0.74, bone: bw(TH, SH, 0.5) },
      { c: [0.1, P.knee - 3, z], rx: cr * 1.08, rz: cr * 0.98, bone: bw(TH, SH, 0.9) },
      { c: [-0.2, P.knee - 6.5, z], rx: cr * 1.05, rz: cr * 0.95, bone: SH },
      { c: [0.1, P.ankle + 2.4, z], rx: cr * 0.85, rz: cr * 0.8, bone: SH },
    ], { seg: seg(12, 7), cap0: 'round', capRings: 1, slot: SLOT.CLOTH, mat: MAT.CLOTH, color: '#e8e8e8', paint: 0.12, part: PART.LEG });
    // cargo pocket
    if (L === 0) roundBox(sb, [0.4, P.hip - 6.5, z + s * 2.9], [2.6, 3.4, 0.9], '#d6d6d6', TH, MAT.CLOTH, SLOT.CLOTH);
    // knee pad
    sb.ellipsoid([P.thighR * 0.72, P.knee + 0.3, z], [0.9, 2.1, 2.0], { segW: seg(8, 5), segH: seg(6, 4), slot: SLOT.FIXED, mat: MAT.RUBBER, color: shadeHex(vest, -0.15), bone: bw(TH, SH, 0.6) });
    // boot
    sb.tube([
      { c: [0.1, P.ankle + 3.6, z], r: cr * 0.95, bone: SH },
      { c: [0.2, P.ankle + 1.2, z], r: cr * 0.9, bone: bw(SH, FT, 0.6) },
    ], { seg: seg(10, 6), slot: SLOT.FIXED, mat: MAT.LEATHER, color: BOOT });
    sb.ellipsoid([1.6, 1.9, z], [3.8, 2.1, 2.05], { segW: seg(14, 7), segH: seg(7, 4), slot: SLOT.FIXED, mat: MAT.LEATHER, color: BOOT, bone: FT,
      deform: (p) => { if (p.y < -0.25) p.y = -0.25 - (p.y + 0.25) * 0.2; if (p.x < -0.3) p.x *= 0.85; } });
    sb.ellipsoid([1.8, 0.45, z], [4.1, 0.5, 2.15], { segW: seg(12, 6), segH: 3, slot: SLOT.FIXED, mat: MAT.RUBBER, color: SOLE, bone: FT });
  }
  // hips (trouser seat)
  sb.tube([
    { c: [0, P.hip - 4, 0], rx: 3.2, rz: 4.9, bone: B.HIPS },
    { c: [0, P.hip - 1.2, 0], rx: 4.2, rz: 6.1, bone: B.HIPS },
    { c: [0.2, P.waist - 0.5, 0], rx: 4.2, rz: 6.0, bone: bw(B.HIPS, B.SPINE, 0.5) },
  ], { seg: seg(16, 8), cap0: 'round', capRings: 1, slot: SLOT.CLOTH, mat: MAT.CLOTH, color: '#e0e0e0', paint: 0.1, part: PART.PELVIS });

  // ---- arms: sleeves, armband (player colour), gloves ----
  const rolled = cls === 'scout' || cls === 'engineer';
  for (const s of [-1, 1]) {
    const R = s > 0;
    const UA = R ? B.UARM_R : B.UARM_L, FA = R ? B.FARM_R : B.FARM_L, HD = R ? B.HAND_R : B.HAND_L;
    const z = s * P.sw, top = P.sY, el = P.sY - P.uarm, wr = P.sY - P.uarm - P.farm;
    const r = P.armR;
    const arm = [
      { c: [-0.2, top + 1.5, z * 0.93], r: r * 1.2, bone: bw(B.CHEST, UA, 0.55) },
      { c: [0.1, top - 1.4, z * 1.02], rx: r * 1.2, rz: r * 1.14, bone: UA },
      { c: [0, top - 5.5, z], rx: r * 1.0, rz: r * 0.95, bone: UA },
      { c: [-0.2, el + 1.2, z], rx: r * 0.88, rz: r * 0.85, bone: bw(UA, FA, 0.25) },
      { c: [-0.3, el, z], rx: r * 0.86, rz: r * 0.82, bone: bw(UA, FA, 0.5) },
      { c: [0.05, el - 2.8, z], rx: r * 0.95, rz: r * 0.88, bone: bw(UA, FA, 0.85) },
      { c: [0.2, wr + 3, z], rx: r * 0.75, rz: r * 0.68, bone: FA },
      { c: [0.2, wr + 0.6, z], rx: r * 0.66, rz: r * 0.58, bone: bw(FA, HD, 0.4) },
    ];
    if (rolled) {
      sb.tube(arm.slice(0, 5).map((q) => ({ ...q, rx: (q.rx ?? q.r) + 0.3, rz: (q.rz ?? q.r) + 0.3, r: undefined })), { seg: seg(12, 7), cap0: 'round', capRings: 1, slot: SLOT.CLOTH, mat: MAT.CLOTH, color: '#ffffff', part: PART.SLEEVE });
      sb.tube(arm.slice(3), { seg: seg(10, 6), slot: SLOT.SKIN, mat: MAT.SKIN, color: '#ffffff' });
      sb.tube(lineRings([-0.3, el + 1.6, z], [-0.3, el - 0.2, z], r + 0.6, r + 0.55, 2), { seg: seg(12, 7), slot: SLOT.CLOTH, mat: MAT.CLOTH, color: '#d8d8d8', bone: bw(UA, FA, 0.3) });
    } else {
      sb.tube(arm.map((q) => ({ ...q, rx: (q.rx ?? q.r) + 0.25, rz: (q.rz ?? q.r) + 0.25, r: undefined })), { seg: seg(12, 7), cap0: 'round', capRings: 1, slot: SLOT.CLOTH, mat: MAT.CLOTH, color: '#ffffff', part: PART.SLEEVE });
    }
    // armband in the player's colour
    sb.tube(lineRings([0.05, top - 3.2, z], [0.05, top - 5.2, z], r * 1.22, r * 1.12, 2), { seg: seg(12, 7), slot: SLOT.ACCENT, mat: MAT.CLOTH, color: '#ffffff', bone: UA });
    if (heavy) sb.ellipsoid([0, top + 0.8, z * 1.05], [3.2, 2.2, 3.0], { segW: seg(12, 6), segH: seg(6, 4), slot: SLOT.FIXED, mat: MAT.METAL, color: shadeHex(vest, 0.05), bone: bw(B.CHEST, UA, 0.6) });
    // gloved fist
    glove(sb, [0.3, wr, z], s, HD, L, cls);
  }

  // ---- neck + head + headgear ----
  sb.tube([
    { c: [0, P.neck - 1.6, 0], rx: 2.35, rz: 2.6, bone: bw(B.CHEST, B.NECK, 0.3) },
    { c: [0.3, P.neck + 0.8, 0], rx: 2.0, rz: 2.2, bone: B.NECK },
    { c: [0.6, P.headC[1] - P.headR[1] * 0.55, 0], rx: 2.0, rz: 2.2, bone: bw(B.NECK, B.HEAD, 0.7) },
  ], { seg: seg(12, 7), slot: SLOT.SKIN, mat: MAT.SKIN, color: '#f0f0f0' });
  face(sb, P, L, hat === 'none');
  headgear(sb, P, hat, look, L);
  if (tier < 2) addClassGear(sb, P, cls, look, L);
  return sb;
}

/** Rounded box as a squashed ellipsoid-cube (superellipsoid-ish). */
export function roundBox(sb, c, size, color, bone, mat = MAT.LEATHER, slot = SLOT.FIXED, seg = 8) {
  sb.ellipsoid(c, [size[0] / 2, size[1] / 2, size[2] / 2], {
    segW: seg, segH: Math.max(4, seg - 2), slot, mat, color, bone,
    deform: (p) => {
      // push the sphere toward a cube (rounded corners)
      const e = 0.45;
      const f = (v) => Math.sign(v) * Math.pow(Math.abs(v), e);
      const x = f(p.x), y = f(p.y), z = f(p.z);
      const l = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
      p.x = x / l; p.y = y / l; p.z = z / l;
    },
  });
}

function backpack(sb, P, cls, vest, outfit, L) {
  const x0 = -5.2;
  if (cls === 'medic') {
    roundBox(sb, [x0 - 2.2, P.chest + 1, 0], [4.2, 10, 8.6], '#c8c8c4', B.CHEST, MAT.CLOTH);
    roundBox(sb, [x0 - 4.35, P.chest + 1.5, 0], [0.3, 3.6, 1.1], '#c62828', B.CHEST, MAT.CLOTH);
    roundBox(sb, [x0 - 4.35, P.chest + 1.5, 0], [0.3, 1.1, 3.6], '#c62828', B.CHEST, MAT.CLOTH);
  } else if (cls === 'engineer') {
    roundBox(sb, [x0 - 2.4, P.chest, 0], [4.4, 11, 9], '#5d4a32', B.CHEST, MAT.LEATHER);
    if (L === 0) sb.tube(lineRings([x0 - 2.6, P.chest + 6, -3], [x0 - 2.6, P.chest + 6, 3], 0.45, 0.45, 2), { seg: 6, slot: SLOT.FIXED, mat: MAT.METAL, color: '#8a8a8a', bone: B.CHEST });
  } else if (cls === 'scout') {
    roundBox(sb, [x0 - 1.6, P.chest + 2, 0], [3.0, 7.5, 7], '#3b3226', B.CHEST, MAT.CLOTH);
  } else if (cls === 'demo') {
    roundBox(sb, [x0 - 1.8, P.chest - 1, 0], [3.4, 7, 9], '#2e2a22', B.CHEST, MAT.LEATHER);
  } else if (cls === 'heavy') {
    roundBox(sb, [x0 - 2.6, P.chest + 0.5, 0], [4.8, 10, 9.6], shadeHex(vest, -0.1), B.CHEST, MAT.METAL);
  } else {
    // soldier: pack with a bedroll on top
    roundBox(sb, [x0 - 2.3, P.chest + 0.5, 0], [4.4, 11, 9.2], mixHex(outfit, '#2a2a20', 0.35), B.CHEST, MAT.CLOTH);
    if (L === 0) roundBox(sb, [x0 - 3.8, P.chest - 1, 0], [1.4, 4, 6], mixHex(outfit, '#2a2a20', 0.5), B.CHEST, MAT.CLOTH);
    sb.tube(lineRings([x0 - 2.2, P.chest + 7.2, -5.2], [x0 - 2.2, P.chest + 7.2, 5.2], 1.5, 1.5, 2), { seg: seg8(L), cap0: 'round', cap1: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.CLOTH, color: '#4a5236', bone: B.CHEST });
  }
}
const seg8 = (L) => (L === 0 ? 10 : 6);

function glove(sb, w, side, HD, L, cls) {
  // a fist closed round a grip: palm block + curled finger roll + thumb over the top; each
  // class has its own gloves (nitrile, work leather, fingerless with tape, padded knuckles)
  const G = GLOVES[cls] || GLOVES.soldier;
  const k = G.thick ? 1.18 : 1;
  const mat = G.glossy ? MAT.RUBBER : MAT.LEATHER;
  sb.ellipsoid([w[0] + 0.3, w[1] - 2.2, w[2]], [1.4 * k, 2.3 * k, 1.7 * k], { segW: L ? 7 : 10, segH: L ? 4 : 6, slot: SLOT.FIXED, mat, color: G.color, bone: HD, part: PART.HAND });
  if (L === 0) {
    for (let f = 0; f < 4; f++) {
      const y = w[1] - 3.4 - f * 0.75;
      sb.ellipsoid([w[0] + 1.35, y, w[2] + side * 0.25], [0.62 * k, 0.42 * k, 1.25 * k], { segW: 6, segH: 4, slot: SLOT.FIXED, mat, color: G.color, bone: HD });
      if (G.fingerless && f < 3) sb.ellipsoid([w[0] + 1.75, y, w[2] + side * 0.25], [0.3, 0.38, 1.1], { segW: 5, segH: 3, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#ffffff', bone: HD });
    }
    sb.tube(lineRings([w[0] + 0.6, w[1] - 1.2, w[2] - side * 1.3], [w[0] + 1.7, w[1] - 2.6, w[2] - side * 0.9], 0.55 * k, 0.45 * k, 3), { seg: 6, cap1: 'round', capRings: 1, slot: SLOT.FIXED, mat, color: G.color, bone: HD });
    // knuckle pad, cuff, velcro strap
    sb.ellipsoid([w[0] + 1.0, w[1] - 3.0, w[2] + side * 0.1], [0.5, 0.35, 1.35 * k], { segW: 6, segH: 4, slot: SLOT.FIXED, mat: MAT.RUBBER, color: G.pad, bone: HD });
    sb.tube(lineRings([w[0] - 0.1, w[1] + 0.9, w[2]], [w[0] - 0.1, w[1] - 0.5, w[2]], 1.5 * k, 1.5 * k, 2, (r) => { r.rz = 1.4 * k; }), { seg: 10, slot: SLOT.FIXED, mat: MAT.CLOTH, color: G.cuff, bone: HD });
    if (G.tape) for (let t = 0; t < 3; t++) sb.tube(lineRings([w[0] + 0.1, w[1] + 2.4 + t * 0.55, w[2]], [w[0] + 0.1, w[1] + 2.75 + t * 0.55, w[2]], 1.6, 1.6, 2, (r) => { r.rz = 1.5; }), { seg: 10, slot: SLOT.FIXED, mat: MAT.CLOTH, color: '#e0d8c0', bone: HD });
  } else {
    sb.ellipsoid([w[0] + 1.2, w[1] - 4.1, w[2]], [0.8, 1.6, 1.4], { segW: 5, segH: 4, slot: SLOT.FIXED, mat, color: G.color, bone: HD });
  }
}

function faceDeform() {
  return (p) => {
    let k = 1;
    const front = smooth01((p.x - 0.35) / 0.4);
    k += 0.05 * gauss(p.y - 0.45, 0.35) * smooth01(-p.x * 2);
    if (p.y < -0.25) k -= smooth01((-0.25 - p.y) / 0.7) * (0.12 + 0.08 * front);
    k += 0.06 * gauss(p.y - 0.28, 0.09) * front;                         // brow
    for (const s of [-1, 1]) k -= 0.06 * gauss(p.y - 0.12, 0.12) * gauss(p.z - s * 0.36, 0.15) * front;   // eye sockets
    for (const s of [-1, 1]) k += 0.04 * gauss(p.y + 0.1, 0.12) * gauss(p.z - s * 0.55, 0.16) * front;   // cheekbones
    k += 0.16 * gauss(p.z, 0.08) * gauss(p.y + 0.06, 0.18) * smooth01((p.x - 0.75) / 0.2);             // nose
    k += 0.05 * gauss(p.z, 0.25) * gauss(p.y + 0.72, 0.12) * front;                                     // chin
    p.x *= k; p.y *= k; p.z *= k;
  };
}

function face(sb, P, L, bald) {
  const c = P.headC, r = P.headR;
  const def = faceDeform();
  sb.ellipsoid(c, r, { segW: L ? 14 : 24, segH: L ? 10 : 18, deform: def, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#ffffff', bone: B.HEAD,
    colorFn: L === 0 ? (x, y, z) => {
      const ux = (x - c[0]) / r[0], uy = (y - c[1]) / r[1], uz = z / r[2];
      // stubble on the jaw, darker lips
      if (ux > 0.55 && uy < -0.3 && uy > -0.45 && Math.abs(uz) < 0.3) return '#9a6a5a';
      if (uy < -0.35 && ux > -0.2) return '#c8b8a8';
      return '#ffffff';
    } : null });
  const at = (x, y, z, inset = 1) => {
    const l = Math.hypot(x, y, z);
    const p = { x: x / l, y: y / l, z: z / l };
    def(p);
    return [c[0] + p.x * r[0] * inset, c[1] + p.y * r[1] * inset, c[2] + p.z * r[2] * inset];
  };
  for (const s of [-1, 1]) {
    // eyes (white + dark iris) and brows
    const e = at(0.9, 0.12, s * 0.36, 0.93);
    sb.ellipsoid(e, [0.5, 0.42, 0.55], { segW: 6, segH: 4, slot: SLOT.FIXED, mat: MAT.BONE, color: '#d8d4cc', bone: B.HEAD });
    sb.ellipsoid([e[0] + 0.38, e[1], e[2]], [0.18, 0.28, 0.28], { segW: 5, segH: 3, slot: SLOT.FIXED, mat: MAT.EYE, color: '#1a1410', bone: B.HEAD });
    if (L === 0) {
      const b0 = at(0.92, 0.3, s * 0.2, 1.01), b1 = at(0.8, 0.3, s * 0.55, 1.01);
      sb.tube(lineRings(b0, b1, 0.32, 0.25, 3), { seg: 5, cap0: 'round', cap1: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.HAIR, color: '#241a12', bone: B.HEAD });
    }
    const ear = at(-0.08, 0.04, s, 0.97);
    sb.ellipsoid(ear, [0.95, 1.35, 0.35], { segW: 6, segH: 4, rot: [0, 0, 0.2], slot: SLOT.SKIN, mat: MAT.SKIN, color: '#e8e8e8', bone: B.HEAD });
  }
  if (bald && L === 0) {
    // heavy: beard
    sb.ellipsoid([c[0] + 1.6, c[1] - 3.2, 0], [2.7, 2.2, 3.2], { segW: 12, segH: 8, slot: SLOT.FIXED, mat: MAT.HAIR, color: '#2e2418', bone: B.HEAD,
      deform: (p) => { if (p.x < -0.2) p.x *= 0.4; } });
  }
}

function headgear(sb, P, hat, look, L) {
  const c = P.headC, r = P.headR;
  const segW = L ? 14 : 24, segH = L ? 8 : 12;
  const cap = (y0, k, color, mat, slot = SLOT.FIXED) => sb.ellipsoid([c[0] - 0.2, c[1] + y0, 0], [r[0] * k, r[1] * k * 0.95, r[2] * k * 1.02], {
    segW, segH, slot, mat, color, bone: B.HEAD,
    deform: (p) => { const cut = -0.05 + Math.max(0, p.x) * 0.2; if (p.y < cut) p.y = cut + (p.y - cut) * 0.12; },
  });
  if (hat === 'helmet') {
    cap(0.6, 1.2, look.outfit, MAT.METAL);
    // rim, accent stripe, chin strap, NVG mount
    sb.tube(lineRings([c[0] - 0.2, c[1] + 0.2, 0], [c[0] - 0.2, c[1] + 0.9, 0], 1, 1, 2, (q) => { q.rx = r[0] * 1.24; q.rz = r[2] * 1.26; }), { seg: segW, slot: SLOT.FIXED, mat: MAT.RUBBER, color: shadeHex(look.outfit, -0.3), bone: B.HEAD });
    sb.tube(lineRings([c[0] - 0.2, c[1] + 2.5, 0], [c[0] - 0.2, c[1] + 3.3, 0], 1, 1, 2, (q) => { q.rx = r[0] * 1.19; q.rz = r[2] * 1.22; }), { seg: segW, slot: SLOT.ACCENT, mat: MAT.CLOTH, color: '#ffffff', bone: B.HEAD });
    if (L === 0) {
      roundBox(sb, [c[0] + r[0] * 1.12, c[1] + 2.8, 0], [0.8, 1.6, 1.8], '#2a2a2a', B.HEAD, MAT.METAL);
      for (const s of [-1, 1]) sb.tube(lineRings([c[0] - 0.4, c[1] + 0.4, s * r[2] * 1.12], [c[0] + 1.8, c[1] - 4.2, s * r[2] * 0.7], 0.22, 0.22, 3), { seg: 4, slot: SLOT.FIXED, mat: MAT.LEATHER, color: STRAP, bone: B.HEAD });
    }
  } else if (hat === 'cap') {
    cap(0.9, 1.08, '#d4d4d0', MAT.CLOTH);
    sb.ellipsoid([c[0] + r[0] * 1.15, c[1] + 1.1, 0], [2.6, 0.3, 3.0], { segW: 12, segH: 3, rot: [0, 0, -0.12], slot: SLOT.FIXED, mat: MAT.CLOTH, color: '#c62828', bone: B.HEAD,
      deform: (p) => { if (p.x < 0) p.x *= 0.3; } });
    sb.tube(lineRings([c[0] - 0.2, c[1] + 3.0, 0], [c[0] - 0.2, c[1] + 3.8, 0], 1, 1, 2, (q) => { q.rx = r[0] * 0.95; q.rz = r[2] * 0.95; }), { seg: segW, slot: SLOT.ACCENT, mat: MAT.CLOTH, color: '#ffffff', bone: B.HEAD });
    sb.ellipsoid([c[0] + r[0] * 0.95, c[1] + 2.2, 0], [0.3, 1.1, 1.1], { segW: 6, segH: 4, slot: SLOT.FIXED, mat: MAT.CLOTH, color: '#c62828', bone: B.HEAD });
  } else if (hat === 'hardhat') {
    cap(1.0, 1.16, '#ffb300', MAT.RUBBER);
    sb.tube(lineRings([c[0] + 0.1, c[1] + 0.8, 0], [c[0] + 0.1, c[1] + 1.2, 0], 1, 1, 2, (q) => { q.rx = r[0] * 1.5; q.rz = r[2] * 1.45; }), { seg: segW, cap0: 'flat', cap1: 'flat', slot: SLOT.FIXED, mat: MAT.RUBBER, color: '#f0a000', bone: B.HEAD });
    sb.tube(lineRings([c[0] - 4.2, c[1] + 4.9, 0], [c[0] + 4.4, c[1] + 4.9, 0], 0.6, 0.6, 5, (q, t) => { q.c[1] += Math.sin(t * Math.PI) * 0.9; }), { seg: 6, slot: SLOT.FIXED, mat: MAT.RUBBER, color: '#ffc21a', bone: B.HEAD });
    sb.ellipsoid([c[0] + r[0] * 0.8, c[1] + 3.2, 0], [0.4, 1.0, 1.9], { segW: 6, segH: 4, slot: SLOT.ACCENT, mat: MAT.CLOTH, color: '#ffffff', bone: B.HEAD });
  } else if (hat === 'bandana') {
    const col = look.vest === '#004d40' ? '#26a69a' : look.vest;
    cap(0.3, 1.06, col, MAT.CLOTH);
    // knot + tails at the back, in the player's colour
    sb.ellipsoid([c[0] - r[0] * 1.02, c[1] + 0.9, 0], [0.8, 0.8, 1.2], { segW: 8, segH: 5, slot: SLOT.ACCENT, mat: MAT.CLOTH, color: '#ffffff', bone: B.HEAD });
    for (const s of [-1, 1]) sb.tube(lineRings([c[0] - r[0] * 1.05, c[1] + 0.6, s * 0.4], [c[0] - r[0] * 1.4, c[1] - 3.2, s * 1.4], 0.55, 0.35, 3, (q) => { q.rz = 0.2; }), { seg: 5, slot: SLOT.ACCENT, mat: MAT.CLOTH, color: '#ffffff', bone: B.HEAD });
  } else if (hat === 'beanie') {
    cap(1.3, 1.1, '#2a2a2a', MAT.CLOTH);
    sb.tube(lineRings([c[0] - 0.2, c[1] + 0.1, 0], [c[0] - 0.2, c[1] + 1.9, 0], 1, 1, 3, (q) => { q.rx = r[0] * 1.12; q.rz = r[2] * 1.15; }), { seg: segW, slot: SLOT.ACCENT, mat: MAT.CLOTH, color: '#ffffff', bone: B.HEAD });
  } else {
    // shaved head: a headband in the player's colour
    sb.tube(lineRings([c[0] - 0.1, c[1] + 1.2, 0], [c[0] - 0.1, c[1] + 2.3, 0], 1, 1, 2, (q) => { q.rx = r[0] * 1.02; q.rz = r[2] * 1.05; }), { seg: segW, slot: SLOT.ACCENT, mat: MAT.CLOTH, color: '#ffffff', bone: B.HEAD });
  }
}
