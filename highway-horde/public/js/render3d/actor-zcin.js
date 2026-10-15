// Cinematic-tier hero details for the zombie models (actor-zmodels.js builds them only when
// the tier is 'cinematic' and only for LOD 0): a sculpted dead face (the relief of the nose's
// stump, philtrum and nasolabial folds; small eyeballs sunk under heavy drooping lids, a
// clouded iris and pupil; thin dry lips shrunk back off a human arch of stained, gapped teeth
// on dark gums; a tongue with a groove; thin ears with a helix — the nose itself is the
// zombies' 'nose' option, actor-zkit.js), hands with three-segment fingers, knuckles and nails,
// and fold profiles for the garments. The survivors' cinematic face (cinSoldierFace) and the
// shared relief (cinFaceRelief) live here too.
//
// Everything here is plain geometry for the same rig and material as the rest of the model
// (one draw call per type and LOD); the wet look of eyes and teeth comes from the material
// classes SCLERA / TEETH (actor-rigmat.js, actor-zmat.js).

import { SLOT, MAT, PART, lineRings } from './actor-shape.js';
import { B } from './actor-consts.js';

const gauss = (x, s) => Math.exp(-(x * x) / (s * s));
export const smooth01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

const TEETH_COLS = ['#9a8c68', '#8a7a56', '#7c6c4a', '#6a5a3a', '#948660', '#827250'];
// dried, receded lips (grey-mauve, darker when rotten), dark gums, a dirty yellowed sclera
const GUM = '#4a1a1e', LIP = '#5e3c3e', LIP_DARK = '#3a2224', SCLERA = '#b8ae90';
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/**
 * Face relief on top of the base head deform (a radial factor on the unit sphere, so it
 * composes with the base by direction only). Nose bridge, alae and nostril pits, philtrum,
 * lips, nasolabial folds, cheeks, eyelid creases and bulges.
 */
export function cinFaceRelief(P) {
  const nk = Math.pow(Math.max(0.02, P.nose) / 0.14, 0.7);
  return (p) => {
    const l = Math.hypot(p.x, p.y, p.z) || 1;
    const x = p.x / l, y = p.y / l, z = p.z / l, az = Math.abs(z);
    const F = smooth01((x - 0.3) / 0.45);
    if (F <= 0.001) return;
    let k = 0;
    // nose: the base deform's wedge is replaced by a bridge, a tip bulb, wings and an undercut with pits
    k -= 0.75 * P.nose * gauss(z, 0.09) * gauss(y + 0.08, 0.2) * smooth01((x - 0.75) / 0.2);
    k += (0.02 + 0.045 * smooth01((0.3 - y) / 0.35)) * nk * gauss(z, 0.05 + 0.03 * smooth01((0.1 - y) / 0.25)) * smooth01((y + 0.1) / 0.1) * smooth01((0.32 - y) / 0.12) * smooth01((x - 0.6) / 0.2);
    k += 0.085 * nk * gauss(z, 0.07) * gauss(y + 0.125, 0.05) * smooth01((x - 0.7) / 0.15);
    k += 0.055 * nk * gauss(az - 0.115, 0.04) * gauss(y + 0.16, 0.045) * smooth01((x - 0.7) / 0.15);
    k -= 0.06 * gauss(y + 0.225, 0.028) * gauss(z, 0.15) * smooth01((x - 0.8) / 0.1);
    k -= 0.06 * gauss(az - 0.07, 0.028) * gauss(y + 0.19, 0.03) * smooth01((x - 0.8) / 0.1);
    // philtrum groove and the ridge above the upper lip
    k -= 0.02 * gauss(z, 0.035) * gauss(y + 0.29, 0.045);
    k += 0.055 * gauss(y + 0.335, 0.045) * gauss(z, 0.38) * smooth01((x - 0.5) / 0.25);
    // nasolabial folds and cheek mass
    const fold = az - (0.17 + Math.max(0, -y - 0.12) * 0.95);
    k -= 0.032 * gauss(fold, 0.04) * gauss(y + 0.25, 0.14);
    k += 0.03 * gauss(y + 0.12, 0.16) * gauss(az - 0.5, 0.15);
    // eyelids: crease above, bulge over the eye, bag below; glabella between the brows
    k -= 0.022 * gauss(y - 0.245, 0.02) * gauss(az - 0.37, 0.15);
    k += 0.03 * gauss(y - 0.19, 0.05) * gauss(az - 0.37, 0.13);
    k -= 0.02 * gauss(z, 0.045) * gauss(y - 0.3, 0.06);
    k += 0.022 * gauss(y + 0.03, 0.045) * gauss(az - 0.38, 0.14);
    // temple hollows and the jaw's angle
    k -= 0.028 * gauss(y - 0.15, 0.14) * gauss(az - 0.85, 0.1) * smooth01((x + 0.1) / 0.3);
    const s = 1 + k * F;
    p.x *= s; p.y *= s; p.z *= s;
  };
}

/** One tooth: a rounded crown tapering to its edge (upper: root at the top). */
function tooth(sb, c, kind, size, color, bone, upper, tilt, paint) {
  const [w, h, d] = size;
  sb.ellipsoid(c, [d, h, w], {
    segW: 8, segH: 6, bone, slot: SLOT.FIXED, mat: MAT.TEETH, color, paint, rot: [tilt, 0, 0],
    deform: (p) => {
      const t = smooth01(upper ? -p.y : p.y);           // toward the biting edge
      if (kind === 'canine') { p.z *= 1 - 0.4 * t * t; p.x *= 1 - 0.45 * t; } else if (kind === 'incisor') { p.x *= 1 - 0.55 * t; p.z *= 1 - 0.1 * t; } else { p.x *= 1 - 0.15 * t; p.z *= 1 - 0.2 * t; if (t > 0.6) p.y *= 0.92 + 0.12 * Math.sin(p.z * 6); }
    },
  });
}

/**
 * The cinematic face parts of a zombie. `pt(x, y, z, inset)` is a point on the finished skull
 * from a unit direction (actor-zmodels headPoint); `jaw` = { jc, jr, def } describes the
 * mandible. A dead face, not a monster's: small eyeballs sunk under drooping lids with a
 * clouded iris, thin dry lips shrunk back off a human row of stained teeth on dark gums.
 */
export function cinFace(sb, P, type, pt, def, jaw) {
  const c = P.headC, r = P.headR;
  const { jc, jr, def: jawDef } = jaw;
  const rot = P.gaunt > 1.1;
  const hs = r[2] / 3.45;          // parts were sized on a 3.45-wide skull
  // ---- eyes: sclera, a clouded iris (the faintly glowing part), a milky pupil, heavy lids ----
  for (const s of [-1, 1]) {
    const e = pt(0.9, 0.1, s * 0.36, 0.87);
    const R = 0.5 * hs;
    const dirZ = s * 0.2, dl = Math.hypot(1, dirZ);
    const ey = [0, -s * 0.2, 0];      // rotation about Y turns the disc's x axis toward +z * s
    sb.ellipsoid(e, [R, R * 0.97, R], { segW: 20, segH: 14, slot: SLOT.FIXED, mat: MAT.SCLERA, color: SCLERA, bone: B.HEAD, part: PART.EYE, paint: 0.2 });
    const ic = [e[0] + R * 0.8 / dl, e[1] - R * 0.05, e[2] + dirZ * R * 0.8 / dl];
    sb.ellipsoid(ic, [0.07 * hs, R * 0.56, R * 0.56], { segW: 20, segH: 8, rot: ey, slot: SLOT.ACCENT, mat: MAT.EYE, color: '#ffffff', bone: B.HEAD, part: PART.EYE });
    sb.ellipsoid([ic[0] + 0.05, ic[1], ic[2] + dirZ * 0.05], [0.05, R * 0.2, R * 0.2], { segW: 12, segH: 6, rot: ey, slot: SLOT.FIXED, mat: MAT.SCLERA, color: '#4a4640', bone: B.HEAD });
    // lids: skin shells a little larger than the eyeball; the upper one droops over the iris
    sb.ellipsoid([e[0] - 0.02, e[1] + 0.02, e[2]], [R * 1.12, R * 1.1, R * 1.12], { segW: 22, segH: 10, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#c8bcc0', bone: B.HEAD, paint: 0.3, part: PART.HEAD,
      deform: (p) => { const cut = 0.14 + Math.max(0, p.x) * 0.05 + Math.abs(p.z) * 0.12; if (p.y < cut) p.y = cut + (p.y - cut) * 0.04; if (p.x < 0.15) p.x = 0.15 + (p.x - 0.15) * 0.3; } });
    sb.ellipsoid([e[0] - 0.02, e[1] - 0.03, e[2]], [R * 1.1, R * 1.08, R * 1.1], { segW: 22, segH: 8, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#b09aa4', bone: B.HEAD, paint: 0.45, part: PART.HEAD,
      deform: (p) => { const cut = -0.5; if (p.y > cut) p.y = cut + (p.y - cut) * 0.04; if (p.x < 0.15) p.x = 0.15 + (p.x - 0.15) * 0.3; } });
    // brows: a thin ridge of sparse hairs
    const b0 = pt(0.86, 0.32, s * 0.14, 1.004), b1 = pt(0.78, 0.35, s * 0.36, 1.004), b2 = pt(0.66, 0.31, s * 0.58, 1.004);
    sb.tube([{ c: b0, rx: 0.07, rz: 0.12 }, { c: b1, rx: 0.08, rz: 0.12 }, { c: b2, rx: 0.04, rz: 0.06 }], { seg: 8, subdiv: 3, cap0: 'round', cap1: 'round', capRings: 2, slot: SLOT.HAIR, mat: MAT.HAIR, color: '#8a8680', bone: B.HEAD, part: PART.NONE, ref: [0, 1, 0] });
    // nostril: the dark pit is in the relief; the wings get a rim
    const n0 = pt(0.93, -0.2, s * 0.08, 1.0);
    sb.ellipsoid(n0, [0.16 * hs, 0.12 * hs, 0.13 * hs], { segW: 8, segH: 5, slot: SLOT.FIXED, mat: MAT.FLESH, color: '#1a0606', bone: B.HEAD });
  }
  // ---- lips: thin and dry, shrunk back off the teeth --------------------------------------------
  const upper = [], lowerJ = [];
  for (let i = 0; i <= 12; i++) {
    const u = -0.8 + i / 7.5;
    const bow = 0.016 * Math.max(0, 1 - Math.abs(u) * 3.2);
    upper.push({ c: pt(0.95 - 0.34 * u * u, -0.3 + bow - 0.05 * u * u, u * 0.36, 1.003), rx: (0.075 - 0.025 * Math.abs(u)) * hs, rz: (0.07 - 0.02 * Math.abs(u)) * hs, bone: B.HEAD });
  }
  sb.tube(upper, { seg: 10, subdiv: 2, cap0: 'round', cap1: 'round', capRings: 2, slot: SLOT.FIXED, mat: MAT.FLESH, color: rot ? LIP_DARK : LIP, bone: B.HEAD, ref: [0, 1, 0], paint: 0.35 });
  // lower lip on the jaw's front rim
  for (let i = 0; i <= 12; i++) {
    const a = -0.7 + (i / 12) * 1.4;
    const q = { x: Math.cos(a) * 0.93, y: 0.16, z: Math.sin(a) * 0.93 };
    jawDef(q);
    lowerJ.push({ c: [jc[0] + q.x * jr[0], jc[1] + q.y * jr[1] + 0.05, q.z * jr[2]], rx: (0.09 - 0.03 * Math.abs(a) / 0.7) * hs, rz: 0.075 * hs, bone: B.JAW });
  }
  sb.tube(lowerJ, { seg: 10, subdiv: 2, cap0: 'round', cap1: 'round', capRings: 2, slot: SLOT.FIXED, mat: MAT.FLESH, color: rot ? LIP_DARK : LIP, bone: B.JAW, ref: [0, 1, 0], paint: 0.5 });

  // ---- teeth on gums: a human arch (the canines no longer than the rest), stained and gapped ----
  const kinds = ['molar', 'premolar', 'premolar', 'canine', 'incisor', 'incisor'];
  const NU = 11;
  const gumU = [];
  const tk = hs * 0.82;
  for (let t = 0; t < NU; t++) {
    const a = -0.46 + (t / (NU - 1)) * 0.92;
    const kind = kinds[Math.min(5, Math.round(Math.abs(a) / 0.46 * 5))];
    const kx = 0.86 - Math.abs(a) * 0.34;
    const up = pt(kx, -0.35, a * 1.0, 0.985);
    gumU.push({ c: [up[0] - 0.02, up[1] + 0.12 * tk, up[2]], r: 0.15 * tk, bone: B.HEAD });
    if (hash(t * 3.1 + type.length) < 0.16 && kind !== 'canine') continue;       // a missing tooth
    const size = kind === 'incisor' ? [0.19, 0.36, 0.14] : kind === 'canine' ? [0.16, 0.38, 0.15] : [0.18, 0.28, 0.16];
    tooth(sb, [up[0], up[1] - size[1] * 0.8 * tk, up[2]], kind, size.map((v) => v * tk), TEETH_COLS[(t * 5 + type.length) % TEETH_COLS.length], B.HEAD, true, 0.07 * (t % 3 - 1), kind === 'incisor' ? 0.25 : 0.15);
  }
  sb.tube(gumU, { seg: 6, subdiv: 2, cap0: 'round', cap1: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.FLESH, color: GUM, bone: B.HEAD, ref: [0, 1, 0], paint: 0.6 });
  const NL = 11, gumL = [];
  for (let t = 0; t < NL; t++) {
    const a = -0.8 + (t / (NL - 1)) * 1.6;
    const kind = kinds[Math.min(5, Math.round(Math.abs(a) / 0.8 * 5))];
    const q = { x: Math.cos(a) * 0.74, y: 0.3, z: Math.sin(a) * 0.74 };
    jawDef(q);
    const lo = [jc[0] + q.x * jr[0], jc[1] + q.y * jr[1], q.z * jr[2]];
    gumL.push({ c: [lo[0], lo[1] - 0.06, lo[2]], r: 0.14 * tk, bone: B.JAW });
    if (hash(t * 5.3 + 2 + type.length) < 0.2 && kind !== 'canine') continue;
    const size = kind === 'incisor' ? [0.16, 0.3, 0.12] : kind === 'canine' ? [0.15, 0.32, 0.14] : [0.18, 0.24, 0.16];
    tooth(sb, [lo[0], lo[1] + size[1] * 0.66 * tk, lo[2]], kind, size.map((v) => v * tk), TEETH_COLS[(t * 3 + 1 + type.length) % TEETH_COLS.length], B.JAW, false, 0.06 * (t % 3 - 1), 0.15);
  }
  sb.tube(gumL, { seg: 6, subdiv: 2, cap0: 'round', cap1: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.FLESH, color: GUM, bone: B.JAW, ref: [0, 1, 0], paint: 0.6 });
  // ---- tongue with a groove, dark and dry --------------------------------------------------------
  sb.ellipsoid([jc[0] + jr[0] * 0.1, jc[1] + jr[1] * 0.26, 0], [jr[0] * 0.58, 0.45 * hs, jr[2] * 0.42], { segW: 16, segH: 9, slot: SLOT.FIXED, mat: MAT.FLESH, color: '#4a1a1e', bone: B.JAW, paint: 0.5,
    deform: (p) => { p.y -= 0.35 * gauss(p.z, 0.18) * Math.max(0, p.y); if (p.x > 0.5) p.y += (p.x - 0.5) * 0.4; } });
  // ---- ears with a rim (thin, a little torn) --------------------------------------------------
  for (const s of [-1, 1]) {
    const e = pt(-0.08, 0.02, s, 0.97);
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 1.75 - 0.4;
      pts.push({ c: [e[0] - Math.sin(a) * 0.55 * hs, e[1] + Math.cos(a) * 0.95 * hs, e[2] + s * (0.08 + 0.18 * Math.sin(a * 0.9)) * hs], r: (0.13 + 0.03 * Math.sin(a * 2)) * hs, bone: B.HEAD });
    }
    sb.tube(pts, { seg: 6, cap0: 'round', cap1: 'round', capRings: 1, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#d8d0d0', bone: B.HEAD, paint: 0.4, ref: [0, 0, s], part: PART.HEAD });
    sb.ellipsoid([e[0] - 0.05, e[1] - 0.85 * hs, e[2] + s * 0.2 * hs], [0.26 * hs, 0.36 * hs, 0.18 * hs], { segW: 8, segH: 6, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#d0c8c8', bone: B.HEAD, paint: 0.45, part: PART.HEAD });
  }
}

// ---- survivors ----------------------------------------------------------------------------------------

const IRIS = { soldier: '#4a3a28', medic: '#3a6a8a', engineer: '#3a2a1c', scout: '#4a6a3a', demo: '#5a4a30', heavy: '#2a1c14' };
const BROW = { soldier: '#2a1c12', medic: '#5a4028', engineer: '#1c140e', scout: '#3a2a1a', demo: '#3a2a1c', heavy: '#18120e' };

/**
 * The cinematic survivor face parts (eyes with a coloured iris and lashes, lids, brows, a nose
 * with nostrils, lips and a mouth line, ears with a rim and a lobe, an Adam's apple). The skull is
 * built by actor-smodels with cinFaceRelief on top of its own deform; `pt` is a point on it.
 */
export function cinSoldierFace(sb, P, cls, pt, skin, mixHex) {
  const iris = IRIS[cls] || IRIS.soldier, brow = BROW[cls] || BROW.soldier;
  const lipC = mixHex(skin, '#a04848', 0.42), lipD = mixHex(skin, '#5a2a2a', 0.55);
  for (const s of [-1, 1]) {
    const e = pt(0.9, 0.12, s * 0.36, 0.93);
    const dirZ = s * 0.18, dl = Math.hypot(1, dirZ);
    const ey = [0, -s * 0.18, 0];
    sb.ellipsoid(e, [0.5, 0.48, 0.5], { segW: 18, segH: 12, slot: SLOT.FIXED, mat: MAT.SCLERA, color: '#e6e0d6', bone: B.HEAD });
    const ic = [e[0] + 0.42 / dl, e[1], e[2] + dirZ * 0.42 / dl];
    sb.ellipsoid(ic, [0.07, 0.26, 0.26], { segW: 18, segH: 8, rot: ey, slot: SLOT.FIXED, mat: MAT.SCLERA, color: iris, bone: B.HEAD });
    sb.ellipsoid([ic[0] + 0.05, ic[1], ic[2] + dirZ * 0.05], [0.05, 0.11, 0.11], { segW: 10, segH: 6, rot: ey, slot: SLOT.FIXED, mat: MAT.SCLERA, color: '#060404', bone: B.HEAD });
    // lids and the lash line
    sb.ellipsoid([e[0] - 0.02, e[1] + 0.02, e[2]], [0.56, 0.55, 0.56], { segW: 20, segH: 9, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#f4f4f4', bone: B.HEAD,
      deform: (p) => { const cut = 0.15 + Math.max(0, p.x) * 0.05; if (p.y < cut) p.y = cut + (p.y - cut) * 0.04; if (p.x < 0.15) p.x = 0.15 + (p.x - 0.15) * 0.3; } });
    sb.ellipsoid([e[0] - 0.02, e[1] - 0.02, e[2]], [0.55, 0.53, 0.55], { segW: 20, segH: 8, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#ececec', bone: B.HEAD,
      deform: (p) => { const cut = -0.4; if (p.y > cut) p.y = cut + (p.y - cut) * 0.04; if (p.x < 0.15) p.x = 0.15 + (p.x - 0.15) * 0.3; } });
    const l0 = pt(0.92, 0.19, s * 0.26, 1.0), l1 = pt(0.9, 0.2, s * 0.36, 1.0), l2 = pt(0.84, 0.18, s * 0.47, 1.0);
    sb.tube([{ c: l0, r: 0.06 }, { c: l1, r: 0.07 }, { c: l2, r: 0.05 }], { seg: 5, subdiv: 3, cap0: 'round', cap1: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.HAIR, color: '#1a1210', bone: B.HEAD });
    // brows
    const b0 = pt(0.9, 0.31, s * 0.14, 1.004), b1 = pt(0.82, 0.34, s * 0.34, 1.004), b2 = pt(0.7, 0.3, s * 0.56, 1.004);
    sb.tube([{ c: b0, rx: 0.14, rz: 0.2 }, { c: b1, rx: 0.16, rz: 0.2 }, { c: b2, rx: 0.06, rz: 0.1 }], { seg: 8, subdiv: 3, cap0: 'round', cap1: 'round', capRings: 2, slot: SLOT.FIXED, mat: MAT.HAIR, color: brow, bone: B.HEAD, ref: [0, 1, 0] });
    // nostril
    const n0 = pt(0.93, -0.2, s * 0.085, 1.0);
    sb.ellipsoid(n0, [0.17, 0.12, 0.14], { segW: 8, segH: 5, slot: SLOT.FIXED, mat: MAT.FLESH, color: '#2a1410', bone: B.HEAD });
    // ear: rim, lobe
    const ear = pt(-0.08, 0.04, s, 0.97);
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 1.75 - 0.4;
      pts.push({ c: [ear[0] - Math.sin(a) * 0.55, ear[1] + Math.cos(a) * 0.95, ear[2] + s * (0.1 + 0.18 * Math.sin(a * 0.9))], r: 0.15 + 0.03 * Math.sin(a * 2) });
    }
    sb.tube(pts, { seg: 6, cap0: 'round', cap1: 'round', capRings: 1, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#ececec', bone: B.HEAD, ref: [0, 0, s] });
    sb.ellipsoid([ear[0] - 0.05, ear[1] - 0.86, ear[2] + s * 0.2], [0.28, 0.4, 0.2], { segW: 8, segH: 6, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#e6e6e6', bone: B.HEAD });
  }
  // lips and the line between them
  const upper = [], lower = [], line = [];
  for (let i = 0; i <= 10; i++) {
    const u = -0.75 + i * 0.15;
    const bow = 0.02 * Math.max(0, 1 - Math.abs(u) * 3.4);
    upper.push({ c: pt(0.96 - 0.32 * u * u, -0.33 + bow - 0.03 * u * u, u * 0.36, 1.004), rx: 0.11 - 0.04 * Math.abs(u), rz: 0.09 - 0.03 * Math.abs(u) });
    lower.push({ c: pt(0.95 - 0.3 * u * u, -0.395 - 0.02 * (1 - u * u) - 0.02 * u * u, u * 0.33, 1.004), rx: 0.13 - 0.05 * Math.abs(u), rz: 0.1 - 0.03 * Math.abs(u) });
    line.push({ c: pt(0.97 - 0.32 * u * u, -0.362 - 0.014 * u * u, u * 0.37, 1.008), r: 0.045 });
  }
  const LP = { seg: 10, subdiv: 2, cap0: 'round', cap1: 'round', capRings: 2, slot: SLOT.FIXED, mat: MAT.SKIN, bone: B.HEAD, ref: [0, 1, 0] };
  sb.tube(upper, { ...LP, color: lipC });
  sb.tube(lower, { ...LP, color: mixHex(lipC, '#ffffff', 0.06) });
  sb.tube(line, { seg: 5, subdiv: 2, cap0: 'round', cap1: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.FLESH, color: lipD, bone: B.HEAD });
  // the larynx
  sb.ellipsoid([P.headC[0] + 0.5, P.neck - 1.2, 0], [0.7, 0.9, 0.6], { segW: 10, segH: 6, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#f0f0f0', bone: B.NECK });
}
