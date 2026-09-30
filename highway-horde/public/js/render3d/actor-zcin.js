// Cinematic-tier hero details for the zombie models (actor-zmodels.js builds them only when
// the tier is 'cinematic' and only for LOD 0): a sculpted face (nose bridge and wings,
// nostril pits, philtrum, lips, nasolabial folds, eyelids over real eyeballs with an iris and
// a pupil, a full arch of individually shaped teeth on gums, a tongue with a groove, ears with
// a helix), hands with three-segment fingers, knuckles and nails, laced shoes with a lugged
// sole, and fold profiles for the garments.
//
// Everything here is plain geometry for the same rig and material as the rest of the model
// (one draw call per type and LOD); the wet look of eyes and teeth comes from the material
// classes SCLERA / TEETH (actor-rigmat.js).

import { SLOT, MAT, PART, lineRings } from './actor-shape.js';
import { B } from './actor-consts.js';

const gauss = (x, s) => Math.exp(-(x * x) / (s * s));
export const smooth01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

const TEETH_COLS = ['#cdc2a0', '#bfb28c', '#ab9c74', '#918258', '#c8bea2', '#b5a57c'];
const GUM = '#5a1a20', LIP = '#8a4a4c', LIP_DARK = '#4a1a20', SCLERA = '#d8cdb2';
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
      if (kind === 'canine') { p.z *= 1 - 0.85 * t * t; p.x *= 1 - 0.5 * t; } else if (kind === 'incisor') { p.x *= 1 - 0.55 * t; p.z *= 1 - 0.1 * t; } else { p.x *= 1 - 0.15 * t; p.z *= 1 - 0.2 * t; if (t > 0.6) p.y *= 0.92 + 0.12 * Math.sin(p.z * 6); }
    },
  });
}

/**
 * The cinematic face parts. `pt(x, y, z, inset)` is a point on the finished skull from a
 * unit direction (actor-zmodels headPoint); `jaw` = { jc, jr, def } describes the mandible.
 */
export function cinFace(sb, P, type, pt, def, jaw) {
  const c = P.headC, r = P.headR;
  const { jc, jr, def: jawDef } = jaw;
  const rot = P.nose < 0.08;
  // ---- eyes: sclera, iris (the glowing part), pupil, lids ----------------------------------
  for (const s of [-1, 1]) {
    const e = pt(0.9, 0.12, s * 0.37, 0.9);
    const dirZ = s * 0.2, dl = Math.hypot(1, dirZ);
    const ey = [0, -s * 0.2, 0];      // rotation about Y turns the disc's x axis toward +z * s
    sb.ellipsoid(e, [0.62, 0.6, 0.62], { segW: 20, segH: 14, slot: SLOT.FIXED, mat: MAT.SCLERA, color: SCLERA, bone: B.HEAD, part: PART.EYE, paint: 0.2 });
    const ic = [e[0] + 0.5 / dl, e[1], e[2] + dirZ * 0.5 / dl];
    sb.ellipsoid(ic, [0.09, 0.36, 0.36], { segW: 20, segH: 8, rot: ey, slot: SLOT.ACCENT, mat: MAT.EYE, color: '#ffffff', bone: B.HEAD, part: PART.EYE });
    sb.ellipsoid([ic[0] + 0.07, ic[1], ic[2] + dirZ * 0.07], [0.06, 0.14, 0.14], { segW: 12, segH: 6, rot: ey, slot: SLOT.FIXED, mat: MAT.SCLERA, color: '#050101', bone: B.HEAD });
    // lids: skin shells a little larger than the eyeball, collapsed to a rim below / above
    sb.ellipsoid([e[0] - 0.02, e[1] + 0.02, e[2]], [0.69, 0.68, 0.69], { segW: 22, segH: 10, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#f0f0f0', bone: B.HEAD, paint: 0.35,
      deform: (p) => { const cut = 0.18 + Math.max(0, p.x) * 0.05; if (p.y < cut) p.y = cut + (p.y - cut) * 0.04; if (p.x < 0.15) p.x = 0.15 + (p.x - 0.15) * 0.3; } });
    sb.ellipsoid([e[0] - 0.02, e[1] - 0.02, e[2]], [0.68, 0.66, 0.68], { segW: 22, segH: 8, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#e0e0e0', bone: B.HEAD, paint: 0.5,
      deform: (p) => { const cut = -0.44; if (p.y > cut) p.y = cut + (p.y - cut) * 0.04; if (p.x < 0.15) p.x = 0.15 + (p.x - 0.15) * 0.3; } });
    // brows: a ridge of coarse hairs
    const b0 = pt(0.86, 0.34, s * 0.14, 1.004), b1 = pt(0.78, 0.37, s * 0.36, 1.004), b2 = pt(0.66, 0.33, s * 0.6, 1.004);
    sb.tube([{ c: b0, rx: 0.13, rz: 0.2 }, { c: b1, rx: 0.15, rz: 0.2 }, { c: b2, rx: 0.06, rz: 0.1 }], { seg: 8, subdiv: 3, cap0: 'round', cap1: 'round', capRings: 2, slot: SLOT.HAIR, mat: MAT.HAIR, color: '#6a665e', bone: B.HEAD, part: PART.NONE, ref: [0, 1, 0] });
    // nostril: the dark pit is in the relief; the wings get a rim
    const n0 = pt(0.93, -0.2, s * 0.085, 1.0);
    sb.ellipsoid(n0, [0.2, 0.15, 0.17], { segW: 8, segH: 5, slot: SLOT.FIXED, mat: MAT.FLESH, color: '#1a0606', bone: B.HEAD });
  }
  // ---- lips ---------------------------------------------------------------------------------
  const upper = [], lowerJ = [];
  for (let i = 0; i <= 12; i++) {
    const u = -0.8 + i / 7.5;
    const bow = 0.022 * Math.max(0, 1 - Math.abs(u) * 3.2);
    upper.push({ c: pt(0.95 - 0.34 * u * u, -0.335 + bow - 0.05 * u * u, u * 0.4, 1.004), rx: 0.12 - 0.04 * Math.abs(u), rz: 0.1 - 0.03 * Math.abs(u), bone: B.HEAD });
  }
  sb.tube(upper, { seg: 10, subdiv: 2, cap0: 'round', cap1: 'round', capRings: 2, slot: SLOT.FIXED, mat: MAT.FLESH, color: rot ? LIP_DARK : LIP, bone: B.HEAD, ref: [0, 1, 0], paint: 0.2 });
  // lower lip on the jaw's front rim
  for (let i = 0; i <= 12; i++) {
    const a = -0.75 + (i / 12) * 1.5;
    const q = { x: Math.cos(a) * 0.93, y: 0.16, z: Math.sin(a) * 0.93 };
    jawDef(q);
    lowerJ.push({ c: [jc[0] + q.x * jr[0], jc[1] + q.y * jr[1] + 0.05, q.z * jr[2]], rx: 0.14 - 0.04 * Math.abs(a) / 0.75, rz: 0.11, bone: B.JAW });
  }
  sb.tube(lowerJ, { seg: 10, subdiv: 2, cap0: 'round', cap1: 'round', capRings: 2, slot: SLOT.FIXED, mat: MAT.FLESH, color: rot ? LIP_DARK : LIP, bone: B.JAW, ref: [0, 1, 0], paint: 0.2 });

  // ---- teeth on gums ------------------------------------------------------------------------
  const kinds = ['molar', 'premolar', 'premolar', 'canine', 'incisor', 'incisor'];
  const NU = 11;
  const gumU = [];
  for (let t = 0; t < NU; t++) {
    const a = -0.5 + (t / (NU - 1)) * 1.0;
    const kind = kinds[Math.min(5, Math.round(Math.abs(a) / 0.5 * 5))];
    const kx = 0.86 - Math.abs(a) * 0.32;
    const up = pt(kx, -0.36, a * 1.0, 0.985);
    gumU.push({ c: [up[0] - 0.02, up[1] + 0.1, up[2]], r: 0.16, bone: B.HEAD });
    if (hash(t * 3.1 + type.length) < 0.14 && kind !== 'canine') continue;       // a missing tooth
    const size = kind === 'incisor' ? [0.2, 0.42, 0.15] : kind === 'canine' ? [0.17, 0.5 + (t % 2) * 0.1, 0.16] : [0.19, 0.3, 0.16];
    tooth(sb, [up[0], up[1] - size[1] * 0.85, up[2]], kind, size, TEETH_COLS[(t * 5 + type.length) % TEETH_COLS.length], B.HEAD, true, 0.06 * (t % 3 - 1), kind === 'incisor' ? 0.25 : 0.15);
  }
  sb.tube(gumU, { seg: 6, subdiv: 2, cap0: 'round', cap1: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.FLESH, color: GUM, bone: B.HEAD, ref: [0, 1, 0], paint: 0.6 });
  const NL = 11, gumL = [];
  for (let t = 0; t < NL; t++) {
    const a = -0.85 + (t / (NL - 1)) * 1.7;
    const kind = kinds[Math.min(5, Math.round(Math.abs(a) / 0.85 * 5))];
    const q = { x: Math.cos(a) * 0.74, y: 0.3, z: Math.sin(a) * 0.74 };
    jawDef(q);
    const lo = [jc[0] + q.x * jr[0], jc[1] + q.y * jr[1], q.z * jr[2]];
    gumL.push({ c: [lo[0], lo[1] - 0.06, lo[2]], r: 0.15, bone: B.JAW });
    if (hash(t * 5.3 + 2 + type.length) < 0.18 && kind !== 'canine') continue;
    const size = kind === 'incisor' ? [0.17, 0.34, 0.13] : kind === 'canine' ? [0.16, 0.42, 0.15] : [0.19, 0.26, 0.16];
    tooth(sb, [lo[0], lo[1] + size[1] * 0.7, lo[2]], kind, size, TEETH_COLS[(t * 3 + 1 + type.length) % TEETH_COLS.length], B.JAW, false, 0.05 * (t % 3 - 1), 0.15);
  }
  sb.tube(gumL, { seg: 6, subdiv: 2, cap0: 'round', cap1: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.FLESH, color: GUM, bone: B.JAW, ref: [0, 1, 0], paint: 0.6 });
  // ---- tongue with a groove --------------------------------------------------------------
  sb.ellipsoid([jc[0] + jr[0] * 0.1, jc[1] + jr[1] * 0.28, 0], [jr[0] * 0.6, 0.55, jr[2] * 0.42], { segW: 16, segH: 9, slot: SLOT.FIXED, mat: MAT.FLESH, color: '#6a2024', bone: B.JAW, paint: 0.5,
    deform: (p) => { p.y -= 0.35 * gauss(p.z, 0.18) * Math.max(0, p.y); if (p.x > 0.5) p.y += (p.x - 0.5) * 0.4; } });
  // ---- ears with a rim ----------------------------------------------------------------------
  for (const s of [-1, 1]) {
    const e = pt(-0.08, 0.02, s, 0.97);
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 1.75 - 0.4;
      pts.push({ c: [e[0] - Math.sin(a) * 0.62, e[1] + Math.cos(a) * 1.05, e[2] + s * (0.1 + 0.2 * Math.sin(a * 0.9))], r: 0.16 + 0.03 * Math.sin(a * 2), bone: B.HEAD });
    }
    sb.tube(pts, { seg: 6, cap0: 'round', cap1: 'round', capRings: 1, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#e6e6e6', bone: B.HEAD, paint: 0.4, ref: [0, 0, s] });
    sb.ellipsoid([e[0] - 0.05, e[1] - 0.95, e[2] + s * 0.22], [0.3, 0.42, 0.22], { segW: 8, segH: 6, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#e0e0e0', bone: B.HEAD, paint: 0.45 });
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
