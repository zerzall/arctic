// The zombies' human body (MakeHuman, CC0: scripts/build-zbody.js → actor-zbody-data.js), shaped
// per type and appended to a model (actor-zmodels.js). This is where they stop being dolls: a real
// adult anatomy (skull, jaw, collarbones, ribcage, the hands' tendons and knuckles), one continuous
// skinned surface instead of jointed segments, the MakeHuman UV layout for the baked skin atlases
// (actor-ztex.js), and four morphs per instance (sex, fat, emaciation, age: the vertex shader blends
// them, so a horde of one type is still one draw call per LOD but no two bodies are alike).
//
// Per type (cached): the macro mix (a starved walker, a fresh runner, the bloater's belly, the brute's
// muscle), decay sculpted into the surface (sunken eyes, cheeks and temples, receding lips, ribs and
// collarbones under the skin), the type's own deformities (the bloater's sagging gut and the
// spitter's throat on their own bones so they pulse, the screamer's long jaw, the brute's and the
// boss's hunch and bulk), and a rest pose fitted by forward kinematics on the rig's bones. From that
// shape come the skeleton's pivots and the proportions the accessories and the shader use (P: hip,
// knee, shoulder, the head's frame, the top's shell).
//
// Per model (type × LOD × tier): a level of the body, the clothes as shells offset from it (the top
// and sleeves, the trousers: cut per instance by the rig shader), eyes, teeth, tongue and the mouth's
// cavity, a crawler's stumps.

import { ZBODY_HEADER as H, ZBODY_DATA } from './actor-zbody-data.js';
import { B } from './actor-consts.js';
import { SLOT, MAT, PART } from './actor-shape.js';

// ---------------------------------------------------------------------------------------
// decoding (once per page)

let DEC = null;
function decode() {
  if (DEC) return DEC;
  let bin;
  if (typeof atob === 'function') {
    const s = atob(ZBODY_DATA);
    bin = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bin[i] = s.charCodeAt(i);
  } else bin = new Uint8Array(globalThis.Buffer.from(ZBODY_DATA, 'base64'));
  const part = (n) => {
    const [off, len, type] = H.parts[n];
    const C = { Int16Array, Uint16Array, Uint8Array, Uint32Array, Float32Array }[type];
    return new C(bin.buffer.slice(off, off + len * C.BYTES_PER_ELEMENT));
  };
  const nP = H.nP, q = 1 / H.QPOS;
  const pos = Float32Array.from(part('pos'), (x) => x * q);
  const uv16 = part('uv'), info = part('info');
  const uv = Float32Array.from(uv16, (x) => x / 65535);
  const morph = {};
  for (const n of H.morphs) morph[n] = Float32Array.from(part('m_' + n), (x) => x * q);
  const bA = new Uint8Array(nP), bB = new Uint8Array(nP), bw = new Float32Array(nP), ao = new Float32Array(nP), grp = new Uint8Array(nP);
  for (let i = 0; i < nP; i++) { bA[i] = info[i * 5]; bB[i] = info[i * 5 + 1]; bw[i] = info[i * 5 + 2] / 255; ao[i] = info[i * 5 + 3] / 255; grp[i] = info[i * 5 + 4]; }
  const levels = H.levels.map((_, k) => part('lv' + k));
  const helpers = part('helpers');
  const piv = {}, jd = {};
  H.pivots.forEach((n, i) => { piv[n] = H.j0[i]; });
  for (const m of H.morphs) { jd[m] = {}; H.pivots.forEach((n, i) => { jd[m][n] = H.jd[m][i]; }); }
  // MakeHuman vertex identity for welding normals across UV seams: quantised rest position
  DEC = { nP, pos, uv, morph, bA, bB, bw, ao, grp, levels, helpers, piv, jd };
  return DEC;
}

// ---------------------------------------------------------------------------------------
// the types

const gauss = (x, s) => Math.exp(-(x * x) / (s * s));
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Per type: the macro mix (from the neutral adult: thin = emaciated, fat, muscle, old, belly), how
 * far decay has sunk the face and bared the bones, the rest pose (bone → [rx, ry, rz] in the rig's
 * Euler order) and bone scales (bone → [sx, sy, sz]: x depth, y length, z width), and the instance
 * morph ranges (actor-zmodels zombieMorph).
 */
export const ZBODY = {
  walker: { mix: { thin: 0.6, old: 0.15 }, decay: 1.0 },
  runner: { mix: { muscle: 0.3, thin: 0.12 }, decay: 0.3 },
  crawler: { mix: { thin: 0.95, old: 0.1 }, decay: 1.3, stumps: true },
  bloater: { mix: { fat: 1.0, belly: 1.15 }, decay: 0.25, belly: 1, scale: { CHEST: [1.05, 1, 1.08] } },
  spitter: { mix: { thin: 0.7 }, decay: 1.1, throat: 1, scale: { NECK: [1, 1.12, 1] } },
  screamer: { mix: { thin: 1.1, old: 0.1 }, decay: 1.45, jaw: 1, scale: { UARM_L: [1, 1.06, 1], UARM_R: [1, 1.06, 1], FARM_L: [1, 1.07, 1], FARM_R: [1, 1.07, 1] } },
  brute: {
    mix: { muscle: 1.0, fat: 0.55 }, decay: 0.3, hunch: 1,
    rot: { CHEST: [0, 0, -0.12], NECK: [0, 0, -0.22], HEAD: [0, 0, 0.3] },
    scale: { CHEST: [1.12, 1, 1.24], NECK: [1.1, 1, 0.82], HEAD: [0.98, 0.96, 0.95], UARM_L: [1.32, 1, 1.32], UARM_R: [1.45, 1.02, 1.45], FARM_L: [1.08, 1, 1.08], FARM_R: [1.12, 1.02, 1.12], HAND_L: [1.1, 1.1, 1.1], HAND_R: [1.15, 1.15, 1.15], THIGH_L: [1.28, 0.96, 1.28], THIGH_R: [1.28, 0.96, 1.28], SHIN_L: [1.12, 0.98, 1.12], SHIN_R: [1.12, 0.98, 1.12] },
  },
  boss: {
    mix: { muscle: 1.0, fat: 0.7 }, decay: 0.55, hunch: 1, hump: 1,
    rot: { CHEST: [0, 0, -0.13], NECK: [0, 0, -0.24], HEAD: [0, 0, 0.32] },
    scale: { CHEST: [1.16, 1, 1.28], NECK: [1.1, 1, 0.8], HEAD: [0.95, 0.94, 0.93], UARM_L: [1.4, 1.02, 1.4], UARM_R: [1.4, 1.02, 1.4], FARM_L: [1.12, 1.02, 1.12], FARM_R: [1.12, 1.02, 1.12], HAND_L: [1.15, 1.15, 1.15], HAND_R: [1.15, 1.15, 1.15], THIGH_L: [1.3, 0.97, 1.3], THIGH_R: [1.3, 0.97, 1.3], SHIN_L: [1.15, 0.98, 1.15], SHIN_R: [1.15, 0.98, 1.15] },
  },
};
/** The instance morphs the shader blends, in attribute order (aMorph0..3, weights in T_MORPH). */
export const INST_MORPHS = ['sex', 'fat', 'thin', 'old'];

const BN = Object.keys(B);
const PARENTS = [-1, 0, 1, 2, 3, 4, 2, 6, 7, 2, 9, 10, 0, 12, 13, 0, 15, 16, 2, 2];
const PIV_OF = { HIPS: 'HIPS', SPINE: 'SPINE', CHEST: 'CHEST', NECK: 'NECK', HEAD: 'HEAD', JAW: 'JAW', UARM_L: 'UARM_L', FARM_L: 'FARM_L', HAND_L: 'HAND_L', UARM_R: 'UARM_R', FARM_R: 'FARM_R', HAND_R: 'HAND_R', THIGH_L: 'THIGH_L', SHIN_L: 'SHIN_L', FOOT_L: 'FOOT_L', THIGH_R: 'THIGH_R', SHIN_R: 'SHIN_R', FOOT_R: 'FOOT_R' };

// rig Euler (R = Ry·Rx·Rz) with per-column scale, as actor-rig.js eulerMat → 3×4 row-major
function eulerMat(x, y, z, sx, sy, sz) {
  const cx = Math.cos(x), snx = Math.sin(x), cy = Math.cos(y), sny = Math.sin(y), cz = Math.cos(z), snz = Math.sin(z);
  return [
    (cy * cz + sny * snx * snz) * sx, (-cy * snz + sny * snx * cz) * sy, sny * cx * sz, 0,
    cx * snz * sx, cx * cz * sy, -snx * sz, 0,
    (-sny * cz + cy * snx * snz) * sx, (sny * snz + cy * snx * cz) * sy, cy * cx * sz, 0,
  ];
}
function mul(a, b) {
  const o = new Array(12);
  for (let r = 0; r < 12; r += 4) {
    o[r] = a[r] * b[0] + a[r + 1] * b[4] + a[r + 2] * b[8];
    o[r + 1] = a[r] * b[1] + a[r + 1] * b[5] + a[r + 2] * b[9];
    o[r + 2] = a[r] * b[2] + a[r + 1] * b[6] + a[r + 2] * b[10];
    o[r + 3] = a[r] * b[3] + a[r + 1] * b[7] + a[r + 2] * b[11] + a[r + 3];
  }
  return o;
}
const ap = (m, x, y, z) => [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
const ad = (m, x, y, z) => [m[0] * x + m[1] * y + m[2] * z, m[4] * x + m[5] * y + m[6] * z, m[8] * x + m[9] * y + m[10] * z];

const tcache = new Map();

/**
 * A type's shaped body in its rest pose: positions (pool), instance morph deltas, pivots, the
 * proportions (P) and landmarks. Cached.
 */
export function zbodyType(type) {
  let T = tcache.get(type);
  if (T) return T;
  const D = decode();
  const cfg = ZBODY[type] || ZBODY.walker;
  const nP = D.nP;
  // ---- the macro mix ----
  const pos = Float32Array.from(D.pos);
  const J = {};
  for (const n of Object.keys(D.piv)) J[n] = D.piv[n].slice();
  for (const [m, w] of Object.entries(cfg.mix || {})) {
    const d = D.morph[m];
    for (let i = 0; i < pos.length; i++) pos[i] += d[i] * w;
    for (const n of Object.keys(J)) for (let k = 0; k < 3; k++) J[n][k] += D.jd[m][n][k] * w;
  }
  const g = cfg.decay ?? 1;
  const isHead = (i) => D.bA[i] === B.HEAD || D.bA[i] === B.JAW;
  // ---- decay and deformities, sculpted in the mixed shape ----
  const EL = J.EYE_L, ER = J.EYE_R;
  const eyeY = (EL[1] + ER[1]) / 2, eyeX = (EL[0] + ER[0]) / 2, eyeZ = Math.abs(EL[2]);
  const mouthY = eyeY - 2.05, chinY = eyeY - 3.6;
  for (let i = 0; i < nP; i++) {
    let x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const gr = D.grp[i];
    if (gr === 1 || gr === 2) {
      // the eyeballs sink back into the sockets
      x -= 0.22 * g;
    } else if (gr === 0 && isHead(i)) {
      const az = Math.abs(z);
      const front = sm(eyeX - 2.2, eyeX - 0.6, x);
      // sunken sockets: the lids and the rim recede round the eyeball
      const sock = gauss(Math.hypot(y - eyeY, az - eyeZ), 0.75) * front;
      x -= 0.24 * g * sock;
      // hollow temples
      x -= 0.0; z -= Math.sign(z) * 0.22 * g * gauss(y - eyeY - 0.5, 0.7) * gauss(x - (eyeX - 1.9), 0.8) * sm(1.6, 2.2, az);
      // the cheeks sunk under sharp cheekbones
      const ch = gauss(y - (eyeY - 1.35), 0.55) * gauss(az - (eyeZ + 0.35), 0.6) * front;
      x -= 0.18 * g * ch; z -= Math.sign(z) * 0.22 * g * ch;
      const bone = gauss(y - (eyeY - 0.55), 0.3) * gauss(az - (eyeZ + 0.55), 0.45) * front;
      z += Math.sign(z) * 0.08 * g * bone;
      // the lips shrink back off the teeth
      const lip = gauss(y - mouthY, 0.42) * gauss(z, 0.85) * sm(eyeX - 0.4, eyeX + 0.4, x);
      x -= 0.22 * g * lip;
      // the screamer's long jaw: the chin and lower face drawn down
      if (cfg.jaw && D.bA[i] === B.JAW) { const w = 1 - (D.bB[i] === B.JAW ? 0 : D.bw[i]); y -= 0.75 * w * sm(mouthY + 0.5, chinY, y); }
    } else if (gr === 0) {
      const b = D.bA[i];
      // collarbones and the hollows above them, the sternum, the ribs under thin skin
      if (b === B.CHEST || b === B.SPINE || b === B.NECK) {
        const sY = J.UARM_L[1];
        const clav = gauss(y - (sY + 0.9 - Math.abs(z) * 0.04), 0.38) * sm(0.6, 1.6, Math.abs(z)) * sm(3.2, 1.2, Math.abs(z) - 2.2) * sm(-0.5, 1.5, x);
        x += 0.22 * g * clav;
        x -= 0.2 * g * gauss(y - (sY + 2.0), 0.45) * gauss(Math.abs(z) - 1.6, 0.8) * sm(-0.5, 1.5, x);
        const ribZone = sm(J.SPINE[1] + 1.5, J.SPINE[1] + 3.5, y) * sm(sY - 1.0, sY - 3.5, y);
        if (ribZone > 0) {
          const ph = (y + Math.max(0, x) * 0.45 - Math.abs(z) * 0.06) / 1.45;
          const rib = Math.pow(0.5 + 0.5 * Math.cos(ph * 2 * Math.PI), 2);
          const side = sm(0.8, 3.2, Math.abs(z)) * (1 - 0.8 * sm(-0.2, -2.5, x));
          const k = 0.16 * g * ribZone * side * (rib - 0.4);
          const l = Math.hypot(x, z) || 1;
          x += (x / l) * k; z += (z / l) * k;
        }
      }
      // the bloater's gut: sagging forward over the belt, on its own bone (X1) so it heaves
      if (cfg.belly && (b === B.SPINE || b === B.HIPS || b === B.CHEST)) {
        const by = J.SPINE[1] - 1.2;
        const k = gauss(y - by, 5.2) * sm(-1.5, 2.0, x) * gauss(z, 6.5);
        const sag = sm(by + 3, by - 4, y);
        x += 2.2 * k * cfg.belly; y -= 1.1 * k * sag; z *= 1 + 0.1 * k;
      }
      // the spitter's throat: a distended goitre under the jaw
      if (cfg.throat && (b === B.NECK || (b === B.CHEST && y > J.NECK[1] - 2))) {
        const k = gauss(y - (J.NECK[1] + 0.6), 1.3) * sm(-0.6, 1.0, x - J.NECK[0]);
        x += 1.5 * k; z *= 1 + 0.32 * k;
      }
      // the boss's hump over the shoulder blades
      if (cfg.hump && (b === B.CHEST || b === B.NECK || b === B.SPINE)) {
        const k = gauss(y - (J.UARM_L[1] - 2.5), 4.2) * sm(0.5, -2.0, x) * gauss(z, 4.6);
        x -= 3.2 * k; y += 0.8 * k;
      }
    }
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
  }
  // ---- the rest pose (forward kinematics over the rig's bones) ----
  const piv = BN.map((n) => (PIV_OF[n] ? J[PIV_OF[n]].slice() : J.CHEST.slice()));
  piv[B.X1] = cfg.belly ? [J.SPINE[0] + 3.2, J.SPINE[1] - 1.5, 0] : cfg.throat ? [J.NECK[0] + 1.6, J.NECK[1] + 0.4, 0] : cfg.hump ? [J.CHEST[0] - 3.5, J.UARM_L[1] - 2, 0] : J.CHEST.slice();
  piv[B.X2] = cfg.hump ? [J.CHEST[0] - 2.5, J.UARM_L[1] - 2.5, -J.UARM_L[2] * -1.45] : J.CHEST.slice();
  const parents = PARENTS.slice();
  if (cfg.belly) parents[B.X1] = B.SPINE;
  if (cfg.throat) parents[B.X1] = B.NECK;
  const M = [];
  for (let b = 0; b < BN.length; b++) {
    const r = (cfg.rot && cfg.rot[BN[b]]) || [0, 0, 0], s = (cfg.scale && cfg.scale[BN[b]]) || [1, 1, 1];
    const L = eulerMat(r[0], r[1], r[2], s[0], s[1], s[2]);
    const p = piv[b];
    const lp = ap(L, p[0], p[1], p[2]);
    L[3] = p[0] - lp[0]; L[7] = p[1] - lp[1]; L[11] = p[2] - lp[2];
    M[b] = parents[b] < 0 ? L : mul(M[parents[b]], L);
  }
  const outP = new Float32Array(nP * 3);
  const inst = INST_MORPHS.map(() => new Float32Array(nP * 3));
  // bone of every pool vertex (with the type's own bones for the belly, throat and hump)
  const bA = Uint8Array.from(D.bA), bB = Uint8Array.from(D.bB), bw = Float32Array.from(D.bw);
  for (let i = 0; i < nP; i++) {
    if (D.grp[i] !== 0) continue;
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    let k = 0;
    if (cfg.belly && (bA[i] === B.SPINE || bA[i] === B.HIPS)) k = gauss(y - (J.SPINE[1] - 1.5), 4.5) * sm(0, 3, x) * gauss(z, 6);
    if (cfg.throat && bA[i] === B.NECK) k = gauss(y - (J.NECK[1] + 0.6), 1.4) * sm(-0.2, 1.2, x - J.NECK[0]);
    if (cfg.hump && bA[i] === B.CHEST) k = gauss(y - (J.UARM_L[1] - 2.5), 4) * sm(-0.5, -3, x) * gauss(z, 4.5);
    if (k > 0.08) { bB[i] = bA[i]; bA[i] = B.X1; bw[i] = Math.min(0.92, 1 - k); }
  }
  for (let i = 0; i < nP; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const ma = M[bA[i]], mb = M[bB[i]], w = bw[i];
    const pa = ap(ma, x, y, z), pb = w > 0 ? ap(mb, x, y, z) : pa;
    outP[i * 3] = pa[0] + (pb[0] - pa[0]) * w; outP[i * 3 + 1] = pa[1] + (pb[1] - pa[1]) * w; outP[i * 3 + 2] = pa[2] + (pb[2] - pa[2]) * w;
    INST_MORPHS.forEach((m, j) => {
      const d = D.morph[m], dx = d[i * 3], dy = d[i * 3 + 1], dz = d[i * 3 + 2];
      const qa = ad(ma, dx, dy, dz), qb = w > 0 ? ad(mb, dx, dy, dz) : qa;
      inst[j][i * 3] = qa[0] + (qb[0] - qa[0]) * w; inst[j][i * 3 + 1] = qa[1] + (qb[1] - qa[1]) * w; inst[j][i * 3 + 2] = qa[2] + (qb[2] - qa[2]) * w;
    });
  }
  const pivots = piv.map((p, b) => (parents[b] < 0 ? ap(M[b], p[0], p[1], p[2]) : ap(M[parents[b]], p[0], p[1], p[2])));
  const lm = (n, b) => ap(M[b], J[n][0], J[n][1], J[n][2]);
  const eyeL = lm('EYE_L', B.HEAD), eyeR = lm('EYE_R', B.HEAD);
  T = { type, cfg, pos: outP, inst, bA, bB, bw, pivots, parents, J, eyeL: eyeL.map((v, k) => v - (k === 0 ? 0.22 * g : 0)), eyeR: eyeR.map((v, k) => v - (k === 0 ? 0.22 * g : 0)), tips: [lm('TIP_L', B.HAND_L), lm('TIP_R', B.HAND_R)], toes: [lm('TOE_L', B.FOOT_L), lm('TOE_R', B.FOOT_R)] };
  T.P = measure(T, D);
  tcache.set(type, T);
  return T;
}

/** The proportions the accessories and the shader read (as actor-zmodels' old params). */
function measure(T, D) {
  const { pos, pivots: pv } = T;
  const nP = D.nP;
  const P = {
    hip: pv[B.THIGH_L][1], knee: pv[B.SHIN_L][1], ankle: pv[B.FOOT_L][1], legGap: Math.abs(pv[B.THIGH_L][2]),
    waist: pv[B.SPINE][1], chest: pv[B.CHEST][1], sY: pv[B.UARM_L][1], sw: Math.abs(pv[B.UARM_L][2]),
    uarm: pv[B.UARM_L][1] - pv[B.FARM_L][1], farm: pv[B.FARM_L][1] - pv[B.HAND_L][1], neck: pv[B.NECK][1],
    armX: [pv[B.UARM_L][0], pv[B.FARM_L][0], pv[B.HAND_L][0]],
  };
  // limb radii: the mean distance of a bone's vertices from its axis (measured half-way down)
  const rad = (b, b2) => {
    const a = pv[b], c = pv[b2], mid = (a[1] + c[1]) / 2;
    let s = 0, n = 0;
    for (let i = 0; i < nP; i++) {
      if (D.grp[i] !== 0 || T.bA[i] !== b || Math.abs(pos[i * 3 + 1] - mid) > 1.2) continue;
      const t = (pos[i * 3 + 1] - a[1]) / (c[1] - a[1]);
      s += Math.hypot(pos[i * 3] - (a[0] + (c[0] - a[0]) * t), pos[i * 3 + 2] - (a[2] + (c[2] - a[2]) * t)); n++;
    }
    return n ? s / n : 1.5;
  };
  P.armR = rad(B.UARM_L, B.FARM_L); P.thighR = rad(B.THIGH_L, B.SHIN_L); P.calfR = rad(B.SHIN_L, B.FOOT_L);
  // the head's frame: the eyes sit at about unit (0.95, 0.13, ±0.37) of it (where the accessories put
  // glasses), its crown at the top and its back at the back of the skull
  let top = -1e9, back = 1e9, side = 0;
  for (let i = 0; i < nP; i++) {
    if (D.grp[i] !== 0 || T.bA[i] !== B.HEAD) continue;
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    top = Math.max(top, y);
    if (Math.abs(y - (T.eyeL[1] + 0.4)) < 0.8) { back = Math.min(back, x); if (x < T.eyeL[0] - 2.5) side = Math.max(side, Math.abs(z)); }
  }
  const ey = (T.eyeL[1] + T.eyeR[1]) / 2, ex = (T.eyeL[0] + T.eyeR[0]) / 2, ez = Math.abs(T.eyeL[2]);
  const ry = (top - ey) / 0.87, cy = top - ry;
  const front = ex + 0.45;
  const rx = (front - back) / 1.9, cx = back + rx;
  P.headC = [cx, cy, 0];
  P.headR = [rx, ry, Math.max(side, ez / 0.37)];
  P.headR[2] = Math.max(P.headR[2] * 0.97, ez / 0.4);
  P.eye = [ex, ey, ez];
  P.mouthY = ey - 2.05 - (T.cfg.jaw ? 0.3 : 0);
  // torso girth relative to the old procedural build (the accessories' D/K factors)
  let fx = -1e9, bx = 1e9, wz = 0;
  for (let i = 0; i < nP; i++) {
    if (D.grp[i] !== 0 || (T.bA[i] !== B.CHEST && T.bA[i] !== B.SPINE)) continue;
    const y = pos[i * 3 + 1];
    if (Math.abs(y - P.chest) > 1) continue;
    fx = Math.max(fx, pos[i * 3]); bx = Math.min(bx, pos[i * 3]); wz = Math.max(wz, Math.abs(pos[i * 3 + 2]));
  }
  P.depth = (fx - bx) / 7.0; P.bulk = wz / 5.2; P.upper = 1; P.gaunt = T.cfg.decay ?? 1;
  P.lean = 0; P.handS = 1; P.rArmK = 1; P.lArmK = 1; P.jawDrop = T.cfg.jaw ? 1.6 : 1; P.claws = T.type === 'crawler' || T.type === 'brute' || T.type === 'boss';
  P.legs = T.cfg.stumps ? 'stumps' : 'full';
  P.type = T.type;
  return P;
}

// ---------------------------------------------------------------------------------------
// models

/** Level of the body per LOD and tier (-1 cinematic, 0 ultra, 1 high, 2 low). */
export function bodyLevel(L, tier) {
  if (tier < 0 && L === 0) return 0;
  const t = Math.max(0, tier);
  return [[1, 3, 5], [2, 3, 5], [3, 4, 5]][Math.min(2, t)][L];
}

/** Region of a vertex by its bone: 'head' | 'torso' | 'arm' | 'hand' | 'leg' | 'foot'. */
function regionOf(b) {
  if (b === B.HEAD || b === B.JAW) return 'head';
  if (b === B.UARM_L || b === B.UARM_R || b === B.FARM_L || b === B.FARM_R) return 'arm';
  if (b === B.HAND_L || b === B.HAND_R) return 'hand';
  if (b === B.THIGH_L || b === B.THIGH_R || b === B.SHIN_L || b === B.SHIN_R) return 'leg';
  if (b === B.FOOT_L || b === B.FOOT_R) return 'foot';
  return 'torso';
}

/** Pack a normal delta (components −1..1) into one exact float (3 × 7 bits). */
const packN = (x, y, z) => {
  const q = (v) => Math.max(0, Math.min(127, Math.round((Math.max(-1, Math.min(1, v)) * 0.5 + 0.5) * 127)));
  return q(x) + q(y) * 128 + q(z) * 16384;
};

/** Smooth normals of a triangle list over positions, welded by the weld key per vertex. */
function computeNormals(pos, idx, weld, n) {
  const acc = new Float32Array(n * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [weld[a], weld[b], weld[c]]) { acc[v * 3] += nx; acc[v * 3 + 1] += ny; acc[v * 3 + 2] += nz; }
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const w = weld[i], l = Math.hypot(acc[w * 3], acc[w * 3 + 1], acc[w * 3 + 2]) || 1;
    out[i * 3] = acc[w * 3] / l; out[i * 3 + 1] = acc[w * 3 + 1] / l; out[i * 3 + 2] = acc[w * 3 + 2] / l;
  }
  return out;
}

/** Weld map: vertices at the same position (UV seams) share one id. */
function weldOf(pos, n) {
  const key = new Map(), weld = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const k = ((Math.round(pos[i * 3] * 200) + 65536) * 131072 + (Math.round(pos[i * 3 + 1] * 200) + 65536)) * 131072 + (Math.round(pos[i * 3 + 2] * 200) + 65536);
    let c = key.get(k);
    if (c === undefined) { c = i; key.set(k, i); }
    weld[i] = c;
  }
  return weld;
}

/** A level's vertices compacted: { vid (pool ids), idx (local), map (pool → local or -1) }. */
function compact(D, poolIdx) {
  const map = new Int32Array(D.nP).fill(-1), vid = [];
  const idx = new Uint32Array(poolIdx.length);
  for (let i = 0; i < poolIdx.length; i++) {
    const p = poolIdx[i];
    if (map[p] < 0) { map[p] = vid.length; vid.push(p); }
    idx[i] = map[p];
  }
  return { vid, idx, map };
}

/**
 * Append the body (and its clothes, eyes, teeth, stumps) of a type to a shape builder.
 * @param {import('./actor-shape.js').ShapeBuilder} sb
 * @param {string} type
 * @param {number} L LOD
 * @param {number} tier -1 cinematic .. 2 low
 */
export function addZBody(sb, type, L, tier) {
  const D = decode();
  const T = zbodyType(type);
  const P = T.P;
  const lv = bodyLevel(L, tier);
  let tris = D.levels[lv];
  // the crawler: torn off above the knees
  if (T.cfg.stumps) {
    const cutY = P.knee + 3.2;
    const keep = [];
    for (let t = 0; t < tris.length; t += 3) {
      let low = false;
      for (let k = 0; k < 3; k++) { const v = tris[t + k], b = T.bA[v]; if (T.pos[v * 3 + 1] < cutY && (regionOf(b) === 'leg' || regionOf(b) === 'foot')) low = true; }
      if (!low) keep.push(tris[t], tris[t + 1], tris[t + 2]);
    }
    tris = Uint32Array.from(keep);
  }
  const body = meshOf(D, T, tris);
  const far = L === 2;
  // ---- the skin ----
  sb.raw(body, (i, v) => {
    const r = regionOf(T.bA[v]);
    const y = body.pos[i * 3 + 1], x = body.pos[i * 3];
    let slot = SLOT.SKIN, mat = MAT.SKIN, part = PART.NONE;
    if (!far) part = r === 'head' ? PART.HEAD : r === 'arm' || r === 'leg' ? PART.LIMB : r === 'hand' ? PART.HAND : r === 'foot' ? PART.FOOT : PART.TORSO;
    else if (r === 'torso' && y < P.neck - 0.6) { slot = SLOT.CLOTH; mat = MAT.CLOTH; part = y < P.hip - 1 ? PART.PELVIS : PART.NONE; if (y < P.hip - 1) slot = SLOT.CLOTH2; }
    else if (r === 'leg') { slot = SLOT.CLOTH2; mat = MAT.CLOTH; part = PART.LEG; }
    else if (r === 'hand') part = PART.HAND;
    else if (r === 'foot') part = PART.FOOT;
    // blood paint: the mouth and chin, the hands, the feet and shins, a little everywhere
    let paint = 0.12;
    if (r === 'head') paint = y < P.mouthY + 0.6 && x > P.headC[0] ? 0.85 : 0.2;
    else if (r === 'hand') paint = 0.6;
    else if (r === 'arm') paint = y < P.sY - P.uarm ? 0.42 : 0.15;
    else if (r === 'leg' || r === 'foot') paint = y < P.knee - 3 ? 0.5 : 0.28;
    return { slot, mat, part, paint, mh: true };
  });
  if (far) { helpers(sb, D, T, L); return T; }
  // ---- the clothes: shells over the torso and arms (top, sleeves) and the hips and legs (trousers) ----
  const sl = Math.min(5, lv + (lv === 0 ? 1 : 1));
  shells(sb, D, T, sl, L, tier);
  helpers(sb, D, T, L);
  if (T.cfg.stumps) stumps(sb, T, L);
  return T;
}

/** A body mesh over a pool index list: compacted, with normals and morph deltas (+ normal deltas). */
function meshOf(D, T, poolIdx) {
  const { vid, idx } = compact(D, poolIdx);
  const n = vid.length;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const v = vid[i]; pos[i * 3] = T.pos[v * 3]; pos[i * 3 + 1] = T.pos[v * 3 + 1]; pos[i * 3 + 2] = T.pos[v * 3 + 2]; }
  const weld = weldOf(pos, n);
  const nor = computeNormals(pos, idx, weld, n);
  const morph = new Float32Array(n * 16);
  INST_MORPHS.forEach((m, j) => {
    const d = T.inst[j];
    const mp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const v = vid[i]; for (let k = 0; k < 3; k++) mp[i * 3 + k] = pos[i * 3 + k] + d[v * 3 + k]; }
    const mn = computeNormals(mp, idx, weld, n);
    for (let i = 0; i < n; i++) {
      const v = vid[i];
      morph[i * 16 + j * 4] = d[v * 3]; morph[i * 16 + j * 4 + 1] = d[v * 3 + 1]; morph[i * 16 + j * 4 + 2] = d[v * 3 + 2];
      morph[i * 16 + j * 4 + 3] = packN(mn[i * 3] - nor[i * 3], mn[i * 3 + 1] - nor[i * 3 + 1], mn[i * 3 + 2] - nor[i * 3 + 2]);
    }
  });
  const uv = new Float32Array(n * 2), bones = new Float32Array(n * 3), ao = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = vid[i];
    uv[i * 2] = D.uv[v * 2]; uv[i * 2 + 1] = D.uv[v * 2 + 1];
    bones[i * 3] = T.bA[v]; bones[i * 3 + 1] = T.bB[v]; bones[i * 3 + 2] = T.bw[v];
    ao[i] = D.ao[v];
  }
  return { n, vid, idx, pos, nor, morph, uv, bones, ao, weld };
}

/** Garment shells offset from a (coarser) level of the body. */
function shells(sb, D, T, lv, L, tier) {
  const P = T.P;
  const tris = D.levels[lv];
  const neckCut = (x) => P.neck - 0.9 + Math.max(0, -x) * 0.35 - Math.max(0, x - 1) * 0.25;
  // which garment a pool vertex belongs to (0 none, 1 top/sleeve, 2 trousers)
  const garment = (v) => {
    const b = T.bA[v], r = regionOf(b), x = T.pos[v * 3], y = T.pos[v * 3 + 1];
    if (D.grp[v] !== 0) return 0;
    if (r === 'arm') return 1;
    if (r === 'torso') {
      if (y > neckCut(x)) return 0;
      if (y > P.hip + 1.2) return 1;
      return 2;
    }
    if (r === 'leg') return T.cfg.stumps && y < P.knee + 3.2 ? 0 : 2;
    return 0;
  };
  for (const gk of [1, 2]) {
    const keep = [];
    for (let t = 0; t < tris.length; t += 3) {
      // (the top reaches a little below the waistband, the trousers a little above it: no gap)
      let ok = true;
      for (let k = 0; k < 3; k++) {
        const v = tris[t + k], gv = garment(v), y = T.pos[v * 3 + 1];
        if (gv === gk) continue;
        if (gk === 1 && gv === 2 && y > P.hip - 3.5 && regionOf(T.bA[v]) === 'torso') continue;
        if (gk === 2 && gv === 1 && y < P.hip + 3.0 && regionOf(T.bA[v]) === 'torso') continue;
        ok = false;
      }
      if (ok) keep.push(tris[t], tris[t + 1], tris[t + 2]);
    }
    if (!keep.length) continue;
    const m = meshOf(D, T, Uint32Array.from(keep));
    // offset along the normal, then relax outward so the cloth bridges hollows (the sunken belly,
    // between the ribs, the small of the back) instead of clinging into them
    const loose = gk === 1 ? (T.type === 'runner' ? 0.38 : 0.5) : 0.42;
    const base = Float32Array.from(m.pos);
    for (let i = 0; i < m.n; i++) for (let k = 0; k < 3; k++) m.pos[i * 3 + k] += m.nor[i * 3 + k] * loose;
    const nbr = Array.from({ length: m.n }, () => new Set());
    for (let t = 0; t < m.idx.length; t += 3) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (a !== b) nbr[m.weld[m.idx[t + a]]].add(m.weld[m.idx[t + b]]);
    const tmp = new Float32Array(m.pos.length);
    for (let it = 0; it < 6; it++) {
      tmp.set(m.pos);
      for (let i = 0; i < m.n; i++) {
        const w = m.weld[i];
        if (w !== i) continue;
        let sx = 0, sy = 0, sz = 0, c = 0;
        for (const j of nbr[w]) { sx += tmp[j * 3]; sy += tmp[j * 3 + 1]; sz += tmp[j * 3 + 2]; c++; }
        if (!c) continue;
        const ax = sx / c - tmp[i * 3], ay = sy / c - tmp[i * 3 + 1], az = sz / c - tmp[i * 3 + 2];
        // only the outward part of the pull (fills hollows, never shrinks over a bulge)
        const out = ax * m.nor[i * 3] + ay * m.nor[i * 3 + 1] + az * m.nor[i * 3 + 2];
        if (out > 0) { m.pos[i * 3] += m.nor[i * 3] * out * 0.6; m.pos[i * 3 + 1] += m.nor[i * 3 + 1] * out * 0.6; m.pos[i * 3 + 2] += m.nor[i * 3 + 2] * out * 0.6; }
      }
    }
    for (let i = 0; i < m.n; i++) { const w = m.weld[i]; if (w !== i) for (let k = 0; k < 3; k++) m.pos[i * 3 + k] = m.pos[w * 3 + k]; }
    // a fold or two: low-frequency wrinkles round the limbs (bunched at the elbows and knees)
    for (let i = 0; i < m.n; i++) {
      const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
      const f = Math.sin(y * 1.7 + z * 0.6) * Math.sin(y * 0.9 - x * 1.3 + 1.7) * 0.12;
      for (let k = 0; k < 3; k++) m.pos[i * 3 + k] += m.nor[i * 3 + k] * f;
    }
    m.nor = computeNormals(m.pos, m.idx, m.weld, m.n);
    sb.raw(m, (i, v) => {
      const r = regionOf(T.bA[v]);
      if (gk === 1) return { slot: SLOT.CLOTH, mat: MAT.TEAR, part: r === 'arm' ? PART.SLEEVE : PART.TOP, paint: 0.22 };
      return { slot: SLOT.CLOTH2, mat: MAT.CLOTH, part: r === 'leg' ? PART.TROUSER : PART.PELVIS, paint: (m.pos[i * 3 + 1] < P.knee - 3 ? 0.5 : 0.3) };
    });
  }
}

/** Eyes, teeth, tongue (pool helpers) and the dark cavity of the mouth. */
function helpers(sb, D, T, L) {
  const keep = [];
  const h = D.helpers;
  for (let t = 0; t < h.length; t += 3) {
    const g = D.grp[h[t]];
    if (L === 2 && g !== 1 && g !== 2) continue;
    if (L === 1 && g === 5) continue;
    keep.push(h[t], h[t + 1], h[t + 2]);
  }
  const m = meshOf(D, T, Uint32Array.from(keep));
  sb.raw(m, (i, v) => {
    const g = D.grp[v];
    if (g === 1 || g === 2) return { slot: SLOT.ACCENT, mat: MAT.EYE, part: PART.EYE, paint: 0, color: '#ffffff' };
    if (g === 3 || g === 4) return { slot: SLOT.FIXED, mat: MAT.TEETH, part: PART.NONE, paint: 0.25, color: (i * 7) % 5 ? '#8a7c5c' : '#6a5c40' };
    return { slot: SLOT.FIXED, mat: MAT.FLESH, part: PART.NONE, paint: 0.4, color: '#3a1214' };
  });
  if (L < 2) {
    // the mouth's cavity (seen when the jaw hangs open)
    const P = T.P;
    // (its roof rides the skull, its floor the jaw)
    const c = [P.eye[0] - 1.05, P.mouthY - 0.1, 0];
    sb.ellipsoid(c, [0.95, 0.7, 1.0], { segW: 8, segH: 5, slot: SLOT.FIXED, mat: MAT.FLESH, color: '#1e0606', paint: 0.6,
      bone: (x, y, z, o) => { o.a = B.HEAD; o.b = B.JAW; o.w = Math.min(1, Math.max(0, (c[1] + 0.25 - y) / 0.6)); } });
  }
}

/** The crawler's thighs end in torn stumps (flesh and the femur's end). */
function stumps(sb, T, L) {
  const P = T.P;
  for (const s of [-1, 1]) {
    const th = T.pivots[s < 0 ? B.THIGH_L : B.THIGH_R], SH = s < 0 ? B.SHIN_L : B.SHIN_R, TH = s < 0 ? B.THIGH_L : B.THIGH_R;
    const y = P.knee + 3.0, z = th[2] * 1.05;
    sb.ellipsoid([th[0] + 0.3, y, z], [P.thighR * 0.92, 1.1, P.thighR * 0.92], { segW: L ? 7 : 10, segH: 4, slot: SLOT.FIXED, mat: MAT.FLESH, color: '#5e1616', bone: TH, paint: 0.9 });
    if (L === 0) sb.tube([{ c: [th[0] + 0.3, y, z], r: 0.55, bone: TH }, { c: [th[0] + 0.4, y - 2.6, z + s * 0.2], r: 0.42, bone: SH }], { seg: 5, cap1: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.BONE, color: '#cfc4a2' });
  }
}

/**
 * The head's shape for the accessories (actor-zkit.js): a deform of unit-sphere directions in the
 * head's frame (P.headC, P.headR) onto the body's real skull, from a table of the head vertices'
 * radii by direction.
 */
export function headDeformOf(type) {
  const T = zbodyType(type);
  if (T.headDef) return T.headDef;
  const D = decode();
  const P = T.P, c = P.headC, r = P.headR;
  const NT = 24, NP = 48;
  const tab = new Float32Array(NT * NP);
  for (let i = 0; i < D.nP; i++) {
    if (D.grp[i] !== 0 || (T.bA[i] !== B.HEAD && T.bA[i] !== B.JAW)) continue;
    const ux = (T.pos[i * 3] - c[0]) / r[0], uy = (T.pos[i * 3 + 1] - c[1]) / r[1], uz = (T.pos[i * 3 + 2] - c[2]) / r[2];
    const l = Math.hypot(ux, uy, uz);
    if (l < 1e-6) continue;
    const th = Math.acos(Math.max(-1, Math.min(1, uy / l))), ph = Math.atan2(uz, ux) + Math.PI;
    const a = Math.min(NT - 1, Math.floor(th / Math.PI * NT)), b = Math.min(NP - 1, Math.floor(ph / (2 * Math.PI) * NP));
    tab[a * NP + b] = Math.max(tab[a * NP + b], l);
  }
  // fill the empty cells (the neck below the jaw: an ellipsoid's radius) and soften the table
  for (let it = 0; it < 4; it++) {
    for (let a = 0; a < NT; a++) for (let b = 0; b < NP; b++) {
      if (tab[a * NP + b] > 0) continue;
      let s = 0, n = 0;
      for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const aa = a + da, bb = (b + db + NP) % NP; if (aa < 0 || aa >= NT) continue; const v = tab[aa * NP + bb]; if (v > 0) { s += v; n++; } }
      if (n) tab[a * NP + b] = s / n;
    }
  }
  for (let i = 0; i < tab.length; i++) if (!(tab[i] > 0)) tab[i] = 1;
  const look = (x, y, z) => {
    const l = Math.hypot(x, y, z) || 1;
    const th = Math.acos(Math.max(-1, Math.min(1, y / l))) / Math.PI * NT - 0.5, ph = (Math.atan2(z, x) + Math.PI) / (2 * Math.PI) * NP - 0.5;
    const a0 = Math.max(0, Math.min(NT - 1, Math.floor(th))), a1 = Math.min(NT - 1, a0 + 1), fa = Math.max(0, Math.min(1, th - a0));
    const b0 = ((Math.floor(ph) % NP) + NP) % NP, b1 = (b0 + 1) % NP, fb = ph - Math.floor(ph);
    const v0 = tab[a0 * NP + b0] * (1 - fb) + tab[a0 * NP + b1] * fb, v1 = tab[a1 * NP + b0] * (1 - fb) + tab[a1 * NP + b1] * fb;
    return v0 * (1 - fa) + v1 * fa;
  };
  T.headDef = (p) => { const k = look(p.x, p.y, p.z); p.x *= k; p.y *= k; p.z *= k; };
  return T.headDef;
}
