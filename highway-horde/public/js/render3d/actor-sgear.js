// Class gear for the survivor models (actor-smodels.js): what makes Sarge, Doc, Sparks,
// Swift, Boom and Tank recognisable across a street — helmets with goggles and NVG mounts,
// medic packs and headlamps, tool belts and welding goggles, hydration packs, grenade
// bandoliers and bomb-suit padding, armour plates and ammo belts. The player's colour (slot
// ACCENT) shows on shoulder patches, pack bands and a small status light.
//
// Model space as actor-rig.js: +X forward, +Y up, +Z right; feet at y = 0 (~57 tall).

import { SLOT, MAT, lineRings } from './actor-shape.js';
import { B } from './actor-consts.js';
import { shadeHex } from './actor-kit.js';

/** Skin tone per class (the survivors' faces and the bare fingertips of fingerless gloves). */
export const CLASS_SKIN = { soldier: '#c68e6a', medic: '#e3b899', engineer: '#8d5a3b', scout: '#b9835a', demo: '#d9a57c', heavy: '#6f4a33' };

/** Gloves per class: shared by the third-person model and the first-person hands. */
export const GLOVES = {
  soldier: { color: '#26221e', pad: '#3a3630', cuff: '#1a1814', fingerless: false },
  medic: { color: '#3a72c4', pad: '#3a72c4', cuff: '#e8e8e4', fingerless: false, glossy: true },
  engineer: { color: '#a87c3c', pad: '#8a6430', cuff: '#e07a10', fingerless: false },
  scout: { color: '#2a2622', pad: '#3a342e', cuff: '#1c1a18', fingerless: true },
  demo: { color: '#1e1c1a', pad: '#4a4640', cuff: '#2a2822', fingerless: false, thick: true },
  heavy: { color: '#2a2622', pad: '#4a4640', cuff: '#c8c0a8', fingerless: true, tape: true },
};

const bw = (a, b, w) => (w <= 0 ? a : w >= 1 ? b : [a, b, w]);

function cubeDeform(e = 0.5) {
  return (p) => {
    const f = (v) => Math.sign(v) * Math.pow(Math.abs(v), e);
    const x = f(p.x), y = f(p.y), z = f(p.z);
    const l = Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) || 1;
    p.x = x / l; p.y = y / l; p.z = z / l;
  };
}

/** Builder facade with default part options. */
function kit(sb, defaults = {}) {
  return {
    ell(c, r, o = {}) { return sb.ellipsoid(c, r, { segW: 8, segH: 5, slot: SLOT.FIXED, mat: MAT.CLOTH, ...defaults, ...o }); },
    box(c, size, o = {}) {
      const sg = o.seg || 7;
      return sb.ellipsoid(c, [size[0] / 2, size[1] / 2, size[2] / 2], { segW: sg, segH: Math.max(4, sg - 2), deform: cubeDeform(o.round ?? 0.5), slot: SLOT.FIXED, mat: MAT.CLOTH, ...defaults, ...o });
    },
    tube(rings, o = {}) { return sb.tube(rings, { seg: 8, slot: SLOT.FIXED, mat: MAT.CLOTH, ...defaults, ...o }); },
    line(a, b, r0, r1, n, o = {}, extra) { return sb.tube(lineRings(a, b, r0, r1, n, extra), { seg: 6, slot: SLOT.FIXED, mat: MAT.CLOTH, ...defaults, ...o }); },
  };
}

/**
 * @param {ShapeBuilder} sb
 * @param {object} P survivor proportions (actor-smodels SP)
 * @param {string} cls classes.js id
 * @param {object} look classes.js look { outfit, vest, hat }
 * @param {number} L 0 near, 1 far
 */
export function addClassGear(sb, P, cls, look, L) {
  const K = kit(sb, { bone: B.CHEST });
  const vest = look.vest;
  const heavy = cls === 'heavy';
  const F = heavy ? 6.4 : 5.5;            // the vest's front surface
  const Bk = -F;
  const sw = P.sw;

  // ---- the player's colour: shoulder patches + a status light --------------------------
  for (const s of [-1, 1]) {
    K.box([-0.4, P.sY + 0.9, s * (sw + 1.6)], [2.6, 0.5, 3.0], { slot: SLOT.ACCENT, mat: MAT.CLOTH, color: '#ffffff', seg: 6, bone: bw(B.CHEST, s < 0 ? B.UARM_L : B.UARM_R, 0.7), round: 0.3 });
  }
  if (L === 0) K.ell([Bk + 0.2, P.sY - 1, 0], [0.5, 0.5, 0.5], { slot: SLOT.ACCENT, mat: MAT.EYE, color: '#ffffff', segW: 6, segH: 4 });

  if (cls === 'soldier') soldier(K, sb, P, L, F, vest);
  else if (cls === 'medic') medic(K, sb, P, L, F, vest);
  else if (cls === 'engineer') engineer(K, sb, P, L, F, vest);
  else if (cls === 'scout') scout(K, sb, P, L, F, vest);
  else if (cls === 'demo') demo(K, sb, P, L, F, vest);
  else if (cls === 'heavy') heavyGear(K, sb, P, L, F, vest);
}

// ---------------------------------------------------------------------------------------

function soldier(K, sb, P, L, F, vest) {
  const c = P.headC;
  // plate front panel with MOLLE webbing rows, admin patch, radio on the left shoulder
  K.box([F + 0.5, P.chest + 2.6, 0], [1.1, 7.2, 7.6], { color: shadeHex(vest, 0.08), mat: MAT.CLOTH, seg: 8, round: 0.3 });
  if (L === 0) {
    for (let k = 0; k < 4; k++) K.box([F + 1.08, P.chest + 0.4 + k * 1.6, 0], [0.15, 0.32, 7.2], { color: shadeHex(vest, -0.25), seg: 5, round: 0.3 });
    K.box([F + 1.1, P.chest + 5.0, 2.4], [0.12, 1.5, 2.2], { slot: SLOT.ACCENT, color: '#ffffff', seg: 5, round: 0.3 });
    // radio + antenna
    K.box([-1.4, P.sY - 1.2, -6.4], [2.4, 4.0, 2.0], { color: '#232622', mat: MAT.RUBBER, seg: 6 });
    K.line([-1.4, P.sY + 0.6, -6.4], [-2.6, P.sY + 9, -6.6], 0.14, 0.08, 3, { seg: 4, color: '#111111' });
    // dog tags and chain
    K.tube([{ c: [0.5, P.neck, -2.5], r: 0.12 }, { c: [F * 0.9, P.sY - 1.4, -1.0], r: 0.12 }, { c: [F * 0.98, P.chest + 6.4, 0], r: 0.12 }, { c: [F * 0.9, P.sY - 1.4, 1.0], r: 0.12 }, { c: [0.5, P.neck, 2.5], r: 0.12 }], { seg: 3, mat: MAT.METAL, color: '#9a9a96' });
    // neck gaiter
    K.tube([{ c: [0.2, P.neck - 0.5, 0], rx: 3.0, rz: 3.3 }, { c: [0.3, P.neck + 1.4, 0], rx: 2.8, rz: 3.1 }], { seg: 10, color: shadeHex(vest, 0.15), bone: bw(B.CHEST, B.NECK, 0.5) });
  }
  // helmet: goggles on the front, cover strap, rear light
  const goggle = [c[0] + P.headR[0] * 1.14, c[1] + 2.3, 0];
  for (const s of [-1, 1]) K.ell([goggle[0], goggle[1], s * 1.55], [0.4, 0.95, 1.35], { color: '#1a2a30', mat: MAT.GLASS, segW: 8, segH: 5, bone: B.HEAD });
  K.tube([{ c: [c[0] - 0.2, c[1] + 2.0, 0], rx: P.headR[0] * 1.2, rz: P.headR[2] * 1.24 }, { c: [c[0] - 0.2, c[1] + 2.8, 0], rx: P.headR[0] * 1.2, rz: P.headR[2] * 1.24 }], { seg: 14, bone: B.HEAD, color: '#26282a', mat: MAT.RUBBER });
  // canteen and bedroll straps on the pack
  K.line([-8.4, P.chest - 4, -3.2], [-8.4, P.chest + 1, -3.2], 1.5, 1.5, 3, { seg: 8, cap0: 'round', cap1: 'round', capRings: 1, color: '#4a5236' });
  // holster on the right thigh
  K.box([0.9, P.hip - 8.6, P.legGap + 3.5], [2.3, 5.6, 1.8], { color: '#1c1c1a', mat: MAT.LEATHER, seg: 6, bone: B.THIGH_R });
  K.box([0.9, P.hip - 4.6, P.legGap + 3.5], [1.3, 2.2, 1.6], { color: '#26262a', mat: MAT.METAL, seg: 5, bone: B.THIGH_R });
}

function medic(K, sb, P, L, F, vest) {
  const c = P.headC;
  // headlamp on the cap: band, lamp housing and a glowing lens
  K.tube([{ c: [c[0] - 0.2, c[1] + 0.7, 0], rx: P.headR[0] * 1.09, rz: P.headR[2] * 1.12 }, { c: [c[0] - 0.2, c[1] + 1.4, 0], rx: P.headR[0] * 1.09, rz: P.headR[2] * 1.12 }], { seg: 14, bone: B.HEAD, color: '#1c1c1c', mat: MAT.RUBBER });
  K.box([c[0] + P.headR[0] * 1.1, c[1] + 1.05, 0], [1.3, 1.6, 2.2], { bone: B.HEAD, color: '#222426', mat: MAT.METAL, seg: 6 });
  K.ell([c[0] + P.headR[0] * 1.1 + 0.7, c[1] + 1.05, 0], [0.12, 0.6, 0.9], { bone: B.HEAD, color: '#ffffff', slot: SLOT.GLOW, segW: 7, segH: 4 });
  // red cross on the cap
  K.box([c[0] + P.headR[0] * 1.02 + 0.3, c[1] + 3.6, 0], [0.2, 1.3, 0.4], { bone: B.HEAD, color: '#c62828', seg: 4 });
  K.box([c[0] + P.headR[0] * 1.02 + 0.3, c[1] + 3.6, 0], [0.2, 0.4, 1.3], { bone: B.HEAD, color: '#c62828', seg: 4 });
  if (L > 0) return;
  // stethoscope around the neck
  const pts = [];
  for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI; pts.push({ c: [Math.sin(a) * 3.0 + 0.9, P.neck - 0.4 - Math.sin(a * 0.5) * 4.2, Math.cos(a) * 3.6], r: 0.25 }); }
  K.tube(pts, { seg: 4, mat: MAT.RUBBER, color: '#1c1c1c' });
  K.ell([F * 0.9 + 0.5, P.chest + 4.2, 2.8], [0.3, 0.9, 0.9], { mat: MAT.METAL, color: '#b0b0b0', segW: 7, segH: 4 });
  // thigh med pouch with a cross, forearm-side shears sheath
  K.box([0.9, P.hip - 6.2, -P.legGap - 3.5], [2.6, 5.0, 1.8], { color: '#c8c8c4', seg: 6, bone: B.THIGH_L });
  K.box([0.9 + 1.4, P.hip - 6.2, -P.legGap - 3.5], [0.2, 2.6, 0.5], { color: '#c62828', seg: 4, bone: B.THIGH_L });
  K.box([0.9 + 1.4, P.hip - 6.2, -P.legGap - 3.5], [0.2, 0.5, 2.6], { color: '#c62828', seg: 4, bone: B.THIGH_L });
  // pack: straps and a second cross on the side, tube of bandages
  K.line([-8.0, P.chest + 7.4, -4.8], [-8.0, P.chest + 7.4, 4.8], 1.1, 1.1, 3, { seg: 8, cap0: 'round', cap1: 'round', capRings: 1, color: '#c9c9c4' });
}

function engineer(K, sb, P, L, F, vest) {
  const c = P.headC;
  // hard-hat lamp and welding goggles pushed up on the brow
  K.box([c[0] + P.headR[0] * 1.15, c[1] + 3.0, 0], [1.4, 1.5, 2.4], { bone: B.HEAD, color: '#26282a', mat: MAT.METAL, seg: 6 });
  K.ell([c[0] + P.headR[0] * 1.15 + 0.75, c[1] + 3.0, 0], [0.12, 0.55, 0.85], { bone: B.HEAD, color: '#fff2c0', slot: SLOT.GLOW, segW: 7, segH: 4 });
  if (L === 0) {
    for (const s of [-1, 1]) {
      K.tube([{ c: [c[0] + 2.3, c[1] + 1.9, s * 1.6], rx: 1.25, rz: 1.25, bone: B.HEAD }, { c: [c[0] + 3.0, c[1] + 2.4, s * 1.6], rx: 1.25, rz: 1.25, bone: B.HEAD }], { seg: 10, mat: MAT.METAL, color: '#2a2a2c', bone: B.HEAD, ref: [0, 1, 0] });
      K.ell([c[0] + 3.05, c[1] + 2.4, s * 1.6], [0.12, 0.95, 0.95], { bone: B.HEAD, color: '#1a5a4a', mat: MAT.GLASS, segW: 8, segH: 5 });
    }
    K.line([c[0] + 3.0, c[1] + 2.4, -0.4], [c[0] + 3.0, c[1] + 2.4, 0.4], 0.3, 0.3, 2, { seg: 4, bone: B.HEAD, mat: MAT.METAL, color: '#2a2a2c' });
    K.tube([{ c: [c[0] - 0.2, c[1] + 2.0, 0], rx: P.headR[0] * 1.22, rz: P.headR[2] * 1.25 }, { c: [c[0] - 0.2, c[1] + 2.6, 0], rx: P.headR[0] * 1.22, rz: P.headR[2] * 1.25 }], { seg: 14, bone: B.HEAD, color: '#3a3a3c', mat: MAT.RUBBER });
    // tool belt: hammer, wrench, pliers, tape roll
    K.line([2.2, P.waist - 2, 5.9], [2.2, P.waist - 10.5, 6.3], 0.3, 0.3, 3, { seg: 5, bone: B.HIPS, mat: MAT.LEATHER, color: '#6a4a2a' });
    K.box([2.2, P.waist - 11.3, 6.3], [1.0, 1.6, 3.2], { bone: B.HIPS, mat: MAT.METAL, color: '#5a5a58', seg: 6 });
    K.line([-2.4, P.waist - 2, 6.2], [-2.6, P.waist - 9.8, 6.6], 0.34, 0.34, 3, { seg: 5, bone: B.HIPS, mat: MAT.METAL, color: '#8a8a88' });
    K.box([-2.6, P.waist - 10.6, 6.6], [0.8, 1.8, 2.2], { bone: B.HIPS, mat: MAT.METAL, color: '#8a8a88', seg: 5 });
    K.tube([{ c: [0.4, P.waist - 3.2, -6.4], rx: 1.3, rz: 0.5 }, { c: [0.4, P.waist - 3.2, -5.8], rx: 1.3, rz: 0.5 }], { seg: 10, bone: B.HIPS, color: '#c8b070', ref: [1, 0, 0] });
    // reflective bands on the vest
    for (const y of [P.chest + 6.0]) K.tube([{ c: [0.1, y, 0], rx: F * 0.98, rz: 8.2 }, { c: [0.1, y + 0.7, 0], rx: F * 0.98, rz: 8.2 }], { seg: 16, color: '#c8ccc8', mat: MAT.CLOTH, bone: B.CHEST });
    // coil of rope on the pack, wrench handle sticking out
    for (let k = 0; k < 4; k++) K.tube([{ c: [-8.6, P.chest + 7.6 + k * 0.9, 0], rx: 3.8 - k * 0.1, rz: 3.8 - k * 0.1 }, { c: [-8.6, P.chest + 8.3 + k * 0.9, 0], rx: 3.8 - k * 0.1, rz: 3.8 - k * 0.1 }], { seg: 12, color: '#b09a5a', ref: [1, 0, 0] });
    K.line([-7.4, P.chest - 5, 3.2], [-9.8, P.chest + 6, 3.4], 0.4, 0.4, 3, { seg: 5, mat: MAT.METAL, color: '#8a8a88' });
  }
}

function scout(K, sb, P, L, F, vest) {
  const c = P.headC;
  // sunglasses pushed up over the bandana
  for (const s of [-1, 1]) K.ell([c[0] + P.headR[0] * 0.9, c[1] + 2.8, s * 1.6], [0.35, 0.8, 1.35], { bone: B.HEAD, color: '#0a0c10', mat: MAT.GLASS, segW: 8, segH: 5 });
  K.line([c[0] + P.headR[0] * 0.95, c[1] + 2.8, -0.5], [c[0] + P.headR[0] * 0.95, c[1] + 2.8, 0.5], 0.2, 0.2, 2, { seg: 4, bone: B.HEAD, mat: MAT.METAL, color: '#181818' });
  // hydration pack: a slim rounded pack, the tube over the shoulder to a bite valve on the chest
  K.box([-6.6, P.chest + 1.6, 0], [3.4, 11.5, 7.2], { color: shadeHex(vest, 0.1), seg: 8 });
  K.box([-8.3, P.chest + 1.6, 0], [0.3, 6, 5], { slot: SLOT.ACCENT, color: '#ffffff', seg: 6, round: 0.3 });
  if (L === 0) {
    K.tube([{ c: [-6.4, P.chest + 7.2, 2.2], r: 0.28 }, { c: [-3.6, P.sY + 1.6, 3.4], r: 0.28 }, { c: [1.2, P.sY + 1.2, 4.2], r: 0.28 }, { c: [F * 0.9, P.chest + 5, 3.6], r: 0.28 }, { c: [F * 0.95, P.chest + 3.4, 3.0], r: 0.28 }], { seg: 4, mat: MAT.RUBBER, color: '#1a3038' });
    K.ell([F * 0.98, P.chest + 3.2, 3.0], [0.4, 0.4, 0.4], { color: '#e8e8e4', segW: 6, segH: 4 });
    // thigh holster + belt pouches
    K.box([0.9, P.hip - 7.4, -P.legGap - 3.4], [2.3, 5.0, 1.8], { color: '#1c1c1a', mat: MAT.LEATHER, seg: 6, bone: B.THIGH_L });
    for (const z of [-2.6, 2.6]) K.box([-3.4, P.waist - 1.2, z], [1.4, 2.2, 1.8], { color: '#3b3226', mat: MAT.LEATHER, seg: 5, bone: B.SPINE });
    // wrist band in the player's colour (worn on both arms)
    for (const s of [-1, 1]) {
      const wr = P.sY - P.uarm - P.farm;
      K.tube([{ c: [0.2, wr + 2.5, s * P.sw], rx: P.armR * 0.85 + 0.55, rz: P.armR * 0.8 + 0.55 }, { c: [0.2, wr + 1.5, s * P.sw], rx: P.armR * 0.85 + 0.55, rz: P.armR * 0.8 + 0.55 }], { seg: 10, slot: SLOT.ACCENT, color: '#ffffff', bone: s < 0 ? B.FARM_L : B.FARM_R });
    }
  }
}

function demo(K, sb, P, L, F, vest) {
  const c = P.headC;
  // goggles pushed up on the beanie
  if (L === 0) {
    for (const s of [-1, 1]) {
      K.tube([{ c: [c[0] + 3.0, c[1] + 2.2, s * 1.55], rx: 1.2, rz: 1.2, bone: B.HEAD }, { c: [c[0] + 3.6, c[1] + 2.6, s * 1.55], rx: 1.2, rz: 1.2, bone: B.HEAD }], { seg: 9, mat: MAT.RUBBER, color: '#26282a', ref: [0, 1, 0], bone: B.HEAD });
      K.ell([c[0] + 3.65, c[1] + 2.6, s * 1.55], [0.12, 0.9, 0.9], { bone: B.HEAD, color: '#3a2a14', mat: MAT.GLASS, segW: 8, segH: 5 });
    }
    K.tube([{ c: [c[0] - 0.2, c[1] + 2.1, 0], rx: P.headR[0] * 1.13, rz: P.headR[2] * 1.16 }, { c: [c[0] - 0.2, c[1] + 2.9, 0], rx: P.headR[0] * 1.13, rz: P.headR[2] * 1.16 }], { seg: 14, bone: B.HEAD, color: '#26282a', mat: MAT.RUBBER });
  }
  // bomb-suit padding: quilted rings round the chest and a groin flap
  for (let k = 0; k < 4; k++) K.tube([{ c: [0.1, P.waist + 2.4 + k * 1.8, 0], rx: F * 0.98 + 0.5, rz: 7.4 + (k > 2 ? 0.2 : 0.4) }, { c: [0.1, P.waist + 3.6 + k * 1.8, 0], rx: F * 0.98 + 0.5, rz: 7.4 + (k > 2 ? 0.2 : 0.4) }], { seg: L ? 10 : 16, color: k % 2 ? shadeHex(vest, 0.06) : shadeHex(vest, -0.05), mat: MAT.LEATHER, ref: [1, 0, 0] });
  K.box([F * 0.7, P.hip - 3.2, 0], [1.2, 6.5, 5.6], { color: shadeHex(vest, 0.04), mat: MAT.LEATHER, seg: 7, bone: B.HIPS });
  // bandolier of grenades from the left shoulder to the right hip
  if (L === 0) {
    const p0 = [-0.6, P.sY + 0.6, -3.6], p1 = [F * 0.95, P.chest - 2, 0], p2 = [0.6, P.waist - 1, 5.6];
    K.tube([{ c: p0, rx: 0.4, rz: 1.0 }, { c: [F * 0.9, P.chest + 4, -2.2], rx: 0.4, rz: 1.0 }, { c: p1, rx: 0.4, rz: 1.0 }, { c: [F * 0.9, P.waist + 1, 3.2], rx: 0.4, rz: 1.0 }, { c: p2, rx: 0.4, rz: 1.0, bone: B.SPINE }], { seg: 5, mat: MAT.LEATHER, color: '#2a2a20' });
    for (let g = 0; g < 4; g++) {
      const t = 0.2 + g * 0.2;
      K.ell([F * 0.98 + 0.9, P.chest + 3.6 - g * 2.4, -2.4 + g * 1.8], [1.0, 1.35, 1.0], { color: '#4a5a2a', mat: MAT.METAL, segW: 7, segH: 5 });
      K.ell([F * 0.98 + 0.95, P.chest + 5.1 - g * 2.4, -2.4 + g * 1.8], [0.3, 0.4, 0.3], { color: '#8a8a80', mat: MAT.METAL, segW: 5, segH: 3 });
    }
    // detonator with an antenna on the belt, coil of wire
    K.box([2.4, P.waist - 2.4, -6.0], [2.0, 3.2, 1.6], { bone: B.HIPS, color: '#2a2a20', mat: MAT.METAL, seg: 6 });
    K.ell([3.4, P.waist - 1.4, -6.0], [0.3, 0.3, 0.3], { bone: B.HIPS, color: '#ff3a2a', slot: SLOT.GLOW, segW: 5, segH: 3 });
    K.line([2.4, P.waist - 0.8, -6.0], [2.4, P.waist + 3.6, -6.2], 0.12, 0.08, 2, { bone: B.HIPS, seg: 4, color: '#111111' });
  }
}

function heavyGear(K, sb, P, L, F, vest) {
  // pauldrons, chest plate ridges, thigh plates, forearm bracers
  for (const s of [-1, 1]) {
    K.ell([0, P.sY + 0.4, s * (P.sw + 0.3)], [3.9, 2.6, 4.2], { bone: bw(B.CHEST, s < 0 ? B.UARM_L : B.UARM_R, 0.8), color: shadeHex(vest, 0.14), mat: MAT.METAL, segW: L ? 7 : 12, segH: L ? 4 : 7, deform: (p) => { if (p.y < -0.1) p.y = -0.1 + (p.y + 0.1) * 0.25; } });
    if (L === 0) {
      K.ell([0, P.sY - 1.4, s * (P.sw + 0.3)], [3.3, 1.8, 3.6], { bone: bw(B.CHEST, s < 0 ? B.UARM_L : B.UARM_R, 0.85), color: shadeHex(vest, 0.06), mat: MAT.METAL, segW: 10, segH: 5, deform: (p) => { if (p.y < -0.1) p.y = -0.1 + (p.y + 0.1) * 0.3; } });
      const TH = s < 0 ? B.THIGH_L : B.THIGH_R;
      K.box([1.1, P.hip - 6.2, s * (P.legGap + 3.1)], [1.0, 9.0, 3.4], { bone: TH, color: shadeHex(vest, 0.1), mat: MAT.METAL, seg: 7 });
      const FA = s < 0 ? B.FARM_L : B.FARM_R;
      const el = P.sY - P.uarm, wr = P.sY - P.uarm - P.farm;
      K.tube([{ c: [0, el - 1.4, s * P.sw], rx: P.armR + 0.75, rz: P.armR + 0.7 }, { c: [0, wr + 1.8, s * P.sw], rx: P.armR * 0.85 + 0.65, rz: P.armR * 0.8 + 0.6 }], { seg: 10, mat: MAT.LEATHER, color: '#1a1a18', bone: FA });
    }
  }
  if (L > 0) return;
  // the LMG ammo belt across the chest: links and brass rounds
  const path = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    path.push([Math.sin(t * Math.PI * 0.9 + 0.1) * (F * 0.96) + 0.6, P.sY - 0.6 - t * (P.sY - P.waist + 1), -4.8 + t * 9.6]);
  }
  K.tube(path.map((q) => ({ c: q, rx: 0.42, rz: 1.1 })), { seg: 5, mat: MAT.METAL, color: '#4a4a44' });
  for (let i = 1; i < path.length - 1; i++) {
    const q = path[i];
    K.ell([q[0] + 0.55, q[1] + 0.2, q[2]], [0.28, 0.6, 0.35], { mat: MAT.METAL, color: '#c9a24a', segW: 5, segH: 4 });
  }
  // big buckle and an ammo box on the hip
  K.box([F * 0.9, P.waist - 1.2, 0], [1.0, 2.4, 3.6], { bone: B.SPINE, color: '#8a8a86', mat: MAT.METAL, seg: 6 });
  K.box([-1.0, P.waist - 4.2, P.legGap * 2.2], [3.6, 4.6, 2.6], { bone: B.HIPS, color: '#3a4030', mat: MAT.METAL, seg: 6 });
}
