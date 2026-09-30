// Blackwater Dam's concrete: the dam body (the sloped downstream face in monolith blocks with lift lines,
// stains, gallery doors and the painted name; the upstream face, trash racks and intake towers), the
// spillway (gate piers, radial gates, the chute between training walls, the flip bucket), the crest's
// parapets and lamp standards, the art-deco towers over the stair heads, the spillway hoist houses and
// the gantry crane. Coordinates follow shared/levels/dam.js (DAM, DAM_Z).

import { DAM, DAM_Z } from '../../shared/levels/dam.js';
import {
  T, DET, S, CONC, SLAB, RUST, STEEL, PAINTED, COL, at, pic, quad4, slopedSlab, rod, railing, lampGlow, shadeHex, mixHex, hash01, atlasUV, c3UV,
} from './dam-kit.js';

const Z = DAM_Z;
const C = DAM.crest;
const TOE = DAM.toeY;
/** The downstream face: vertical from the crest down to FACE_TOP at y FACE_Y, then sloping to the toe. */
const FACE_Y = C.y1 + 26, FACE_TOP = Z - 50;
const faceY = (h) => (h >= FACE_TOP ? FACE_Y : FACE_Y + ((FACE_TOP - h) / FACE_TOP) * (TOE - FACE_Y));
const UP_Y = C.y0 - 22;          // the upstream face
const RES = DAM.reservoir;
const X0 = 3720, X1 = 7420;      // the dam body between the abutment towers
const SP = DAM.spill;

/**
 * The dam body: downstream face, upstream face, and the concrete between them seen from the ends.
 * @param {object} P { B, gy, halos, tier, day }
 */
export function damBody(P) {
  const { B, gy, tier } = P;
  const blockW = 92;
  const segs = [[X0, SP.x0 - 30], [SP.x1 + 30, X1]];
  // ---- downstream face in monolith blocks (a frame per block keeps the cells local)
  for (const [x0, x1] of segs) {
    const nb = Math.round((x1 - x0) / blockW);
    for (let k = 0; k < nb; k++) {
      const a = x0 + ((x1 - x0) * k) / nb, b = x0 + ((x1 - x0) * (k + 1)) / nb;
      const xc = (a + b) / 2;
      at(B, gy, xc, TOE + 20, 0, 0, 900 + k);
      B.setAO(0, 1);
      const zt = FACE_Y - (TOE + 20), zb = TOE - (TOE + 20);
      const hw = (b - a) / 2 - 0.7;
      const col = mixHex(COL.conc, hash01(k * 7 + x0) < 0.5 ? '#8a857a' : '#a39e92', hash01(k * 13 + x0) * 0.6);
      // the vertical band under the crest's cornice, then the slope
      quad4(B, 'std', [-hw, FACE_TOP, zt], [hw, FACE_TOP, zt], [hw, Z - 6, zt], [-hw, Z - 6, zt], shadeHex(col, 0.04), { ...CONC, noJitter: true });
      quad4(B, 'std', [-hw, 0, zb], [hw, 0, zb], [hw, FACE_TOP, zt], [-hw, FACE_TOP, zt], col, { ...CONC, noJitter: true });
      // the joint: a dark recess behind the gap between blocks
      quad4(B, 'std', [hw - 1, -2, zb - 3], [hw + 1.4, -2, zb - 3], [hw + 1.4, FACE_TOP, zt - 3], [hw - 1, FACE_TOP, zt - 3], '#3a3834', { ...CONC, noJitter: true });
      B.setAO(34, 0.42);
    }
    // lift lines: a thin shadowed step every 46 units of height, across the whole stretch
    at(B, gy, (x0 + x1) / 2, TOE + 20, 0, 0, 77);
    B.setAO(0, 1);
    const hl = (x1 - x0) / 2;
    for (let h = 46; h < FACE_TOP; h += 46) {
      const z = faceY(h) - (TOE + 20), z2 = faceY(h + 3) - (TOE + 20);
      quad4(B, 'std', [-hl, h, z + 0.6], [hl, h, z + 0.6], [hl, h + 3, z2 + 0.6], [-hl, h + 3, z2 + 0.6], '#6e6a62', { ...CONC, noJitter: true });
    }
    B.setAO(34, 0.42);
  }
  // ---- water streaks, moss at the toe, rust from the drains, the painted name
  let n = 0;
  for (let x = X0 + 60; x < X1 - 40; x += 70 + hash01(x) * 120) {
    if (x > SP.x0 - 60 && x < SP.x1 + 60) continue;
    const h0 = FACE_TOP - hash01(x * 3) * 80, len = 140 + hash01(x * 5) * 300;
    faceDecal(B, gy, hash01(x * 7) < 0.25 ? 'd_rust' : 'd_streak', x, h0, 30 + hash01(x) * 40, len, n++);
  }
  for (let x = X0 + 100; x < X1 - 60; x += 240) {
    if (x > SP.x0 - 60 && x < SP.x1 + 60) continue;
    faceDecal(B, gy, 'd_moss', x, 70, 220, 80, n++);
  }
  if (tier !== 'low') faceDecal(B, gy, 'facename', 6480, FACE_TOP - 70, 1100, 172, n++, 'c3sign');
  // gallery doors and drains on the face
  for (const x of [4200, 5880, 6660, 7160]) galleryDoor(B, gy, x, 250);
  for (let x = X0 + 150; x < X1; x += 300) {
    if (x > SP.x0 - 60 && x < SP.x1 + 60) continue;
    const h = 120;
    at(B, gy, x, faceY(h), h, 0, x);
    B.cylZ('std', 0, 0, 4, 5, 14, '#3a3834', 10, RUST);
    B.cylZ('std', 0, 0, 10, 3.6, 2, '#1a1816', 10, RUST);
  }
  // penstocks: four steel pipes down the face into the turbine hall's back wall
  for (let k = 0; k < 4; k++) {
    const x = 6180 + k * 360;
    const hA = Z - 120, hB = 190;
    const yA = faceY(hA) + 30, yB = TOE + 2;
    at(B, gy, x, yA, hA, 0, 400 + k);
    const dz = yB - yA, dh = hB - hA;
    rod(B, 'std', [0, 0, 0], [0, dh, dz], 26, '#5a605e', RUST, tier === 'low' ? 10 : 18);
    for (let t = 0.08; t < 1; t += 0.12) {
      B.add('std', T.torus(tier === 'low' ? 10 : 18, 0.08, 4), [0, dh * t, dz * t], [27.5, 27.5, 27.5], [Math.atan2(dz, dh) - Math.PI / 2 + Math.PI / 2, 0, 0], '#4a4e4c', RUST);
      B.box('std', 0, dh * t - 26, dz * t, 30, 6, 12, COL.concD, null, CONC);
    }
    // the anchor block where the pipe leaves the dam
    B.rblock('std', 0, -40, -10, 90, 80, 60, 4, COL.concD, null, CONC);
  }
  // ---- the upstream face (the reservoir side): vertical from the crest into the water
  for (let x = C.x0; x < C.x1; x += 400) {
    const x1 = Math.min(C.x1, x + 400);
    at(B, gy, (x + x1) / 2, UP_Y - 30, 0, 0, 55 + x);
    B.setAO(0, 1);
    const hl = (x1 - x) / 2, z = UP_Y - (UP_Y - 30);
    quad4(B, 'std', [hl, RES - 200, z], [-hl, RES - 200, z], [-hl, Z - 4, z], [hl, Z - 4, z], '#7e7a70', { ...CONC, noJitter: true });
    // the wet band at the waterline and the algae below it
    quad4(B, 'std', [hl, RES - 40, z - 0.5], [-hl, RES - 40, z - 0.5], [-hl, RES + 14, z - 0.5], [hl, RES + 14, z - 0.5], '#46473c', { ...CONC, noJitter: true });
    B.setAO(34, 0.42);
    // trash racks on the intakes (the steel grilles at the waterline)
    if (x > 5600 && x < 7000) {
      for (let k = 0; k < 8; k++) B.box('std', -hl + 30 + k * 46, RES - 20, z - 3, 3, 70, 3, '#3a3a36', null, RUST);
      B.box('std', 0, RES + 16, z - 3, hl * 2 - 40, 4, 5, '#3a3a36', null, RUST);
    }
  }
  // the intake towers standing in the reservoir, their footbridges to the parapet
  for (const tx of [5760, 6860]) intakeTower(P, tx, UP_Y - 170);
  // the gauge board on the upstream face by the west tower
  at(B, gy, 4000, UP_Y - 2, 0, 0, 3);
  pic(B, 'gauge_level', 0, RES + 10, 0, 180, Math.PI, { w: 24 });
}

/** A decal on the sloped downstream face: x centre, top height h0, width w, length len down the slope. */
function faceDecal(B, gy, cell, x, h0, w, len, seed, bucket = 'c3stain') {
  const h1 = Math.max(4, h0 - len * 0.82);
  const zA = faceY(h0), zB = faceY(h1);
  at(B, gy, x, TOE + 20, 0, 0, seed);
  const z0 = zA - (TOE + 20) + 0.8, z1 = zB - (TOE + 20) + 0.8;
  const uv = c3UV(cell);
  const hw = w / 2;
  const geo = [[-hw, h1, z1], [hw, h1, z1], [hw, h0, z0], [-hw, h1, z1], [hw, h0, z0], [-hw, h0, z0]].flat();
  const uvs = [uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[1], uv[2], uv[3], uv[0], uv[3]];
  B.add(bucket, geoUV(geo, uvs), [0, 0, 0], [1, 1, 1], null, '#ffffff', { noAO: true, noJitter: true });
}

function geoUV(pos, uv) {
  // a one-off textured geometry (uv already in atlas space: the bucket's uv rect option is not used)
  return { attributes: { position: { array: new Float32Array(pos) }, normal: { array: normalsOf(pos) }, uv: { array: new Float32Array(uv) } } };
}

function normalsOf(pos) {
  const out = new Float32Array(pos.length);
  for (let t = 0; t < pos.length; t += 9) {
    const ux = pos[t + 3] - pos[t], uy = pos[t + 4] - pos[t + 1], uz = pos[t + 5] - pos[t + 2];
    const vx = pos[t + 6] - pos[t], vy = pos[t + 7] - pos[t + 1], vz = pos[t + 8] - pos[t + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (let k = 0; k < 3; k++) { out[t + k * 3] = nx; out[t + k * 3 + 1] = ny; out[t + k * 3 + 2] = nz; }
  }
  return out;
}

export { geoUV };

/** An inspection gallery door set into the face at height h. */
function galleryDoor(B, gy, x, h) {
  const y = faceY(h);
  at(B, gy, x, y, h, 0, x);
  B.box('std', 0, 0, 6, 70, 8, 26, COL.concD, null, CONC);                      // the little landing
  B.box('std', 0, 30, -4, 44, 60, 14, '#23211e', null, CONC);                     // the recess
  B.box('std', 0, 29, 1.5, 36, 54, 2, '#4a4e4c', null, RUST);                      // the steel door
  B.box('std', 0, 60, 4, 50, 4, 10, COL.concD, null, CONC);
  railing(B, -34, 18, 34, 18, 4, 30, COL.yellow, { step: 34 });
}

/** A cylindrical intake tower in the reservoir with its gate house and footbridge to the crest. */
function intakeTower(P, x, y) {
  const { B, gy, halos } = P;
  at(B, gy, x, y, 0, 0, x);
  const R = 62;
  B.cyl('std', 0, RES - 220, 0, R, Z + 30 - (RES - 220), '#8a857a', 28, 1, null, CONC);
  for (let hh = RES - 40; hh < Z + 20; hh += 40) B.cyl('std', 0, hh, 0, R + 1.2, 3, '#77736a', 28, 1, null, CONC);
  B.cyl('std', 0, RES - 30, 0, R + 0.6, 40, '#4a4a3e', 28, 1, null, CONC);          // the wet band
  // the gate house on top
  B.cyl('std', 0, Z + 30, 0, R + 6, 8, COL.concL, 28, 1, null, CONC);
  B.cyl('std', 0, Z + 38, 0, R - 14, 70, '#b0aa9c', 20, 1, null, CONC);
  B.cyl('std', 0, Z + 108, 0, R - 8, 8, COL.concD, 20, 1, null, CONC);
  B.add('std', T.cyl(20, 0.1), [0, Z + 132, 0], [R - 6, 40, R - 6], null, '#4a5a56', S(DET.metalroof, 0.5, 0.5));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    B.box('glass', Math.cos(a) * (R - 13.5), Z + 78, Math.sin(a) * (R - 13.5), 16, 26, 2, '#141a1e', [0, -a + Math.PI / 2, 0]);
  }
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    B.cyl('std', Math.cos(a) * (R + 3), Z + 38, Math.sin(a) * (R + 3), 0.9, 34, COL.yellow, 5, 1, null, PAINTED);
  }
  B.add('std', T.torus(28, 0.02, 4), [0, Z + 72, 0], [R + 3, R + 3, R + 3], [Math.PI / 2, 0, 0], COL.yellow, PAINTED);
  // the footbridge south to the crest parapet
  const len = UP_Y - y - R + 6;
  B.box('std', 0, Z + 30, R + len / 2 - 4, 30, 6, len, COL.concD, null, CONC);
  for (const s of [-1, 1]) railing(B, s * 14, R - 4, s * 14, R + len - 6, Z + 33, 34, COL.yellow, { step: 40 });
  lampGlow(B, halos, 0, Z + 160, 0, x, y, '#ff4a3a', { size: [4, 4, 4], k: 5, halo: 70, strength: 0.6, blink: 1, y0: 0, shape: 'sphere' });
}

// ---- the spillway ------------------------------------------------------------------------------------

/** The spillway chute's floor height at sim y (the ogee crest under the road bridge, the chute, the bucket). */
export function chuteFloor(y) {
  const top = Z - 80;                  // the ogee crest
  if (y <= FACE_Y) return top;
  if (y >= TOE) return 12 + Math.min(1, (y - TOE) / 60) * 10;   // the flip bucket's lip
  const t = (y - FACE_Y) / (TOE - FACE_Y);
  // an ogee: gentle at the top, steepening, then a curve into the bucket
  const s = t < 0.12 ? (t / 0.12) ** 2 * 0.06 : 0.06 + ((t - 0.12) / 0.88) * 0.94;
  return top - s * (top - 12);
}

/** Piers, radial gates, the road bridge's fascia, the chute between its training walls, the bucket. */
export function spillway(P) {
  const { B, gy, tier } = P;
  const w = SP.x1 - SP.x0;
  const bays = 4;
  // gate piers upstream of the crest road, reaching out into the reservoir
  for (let k = 0; k <= bays; k++) {
    const x = SP.x0 + (k * w) / bays;
    at(B, gy, x, UP_Y - 50, 0, 0, 60 + k);
    B.rblock('std', 0, RES - 200, 0, 30, Z + 60 - (RES - 200), 104, 3, COL.conc, null, CONC);
    B.add('std', T.cyl(12, 1), [0, RES - 200, -52], [15, Z + 60 - (RES - 200), 15], null, COL.conc, CONC);   // the rounded nose
    B.box('std', 0, RES - 30, -52, 31.5, 40, 1, '#4a4a3e', null, CONC);
  }
  // radial (Tainter) gates between the piers: curved skin plates facing the reservoir, trunnion arms
  for (let k = 0; k < bays; k++) {
    const x0 = SP.x0 + (k * w) / bays + 15, x1 = SP.x0 + ((k + 1) * w) / bays - 15;
    const xc = (x0 + x1) / 2;
    at(B, gy, xc, UP_Y - 20, 0, 0, 70 + k);
    const R = 110, piv = [0, RES - 20, 40];
    const open = k === 1 ? 0.35 : 0.12;      // one gate cracked open wider (the roaring bay)
    for (let s = 0; s < 8; s++) {
      const a0 = -0.55 + open + s * 0.11, a1 = a0 + 0.11;
      const za = piv[2] - Math.cos(a0) * R, ya = piv[1] + Math.sin(a0) * R;
      const zb = piv[2] - Math.cos(a1) * R, yb = piv[1] + Math.sin(a1) * R;
      quad4(B, 'std', [(x1 - x0) / 2, ya, za], [-(x1 - x0) / 2, ya, za], [-(x1 - x0) / 2, yb, zb], [(x1 - x0) / 2, yb, zb], '#4e5a58', RUST);
      quad4(B, 'std', [-(x1 - x0) / 2, ya, za + 0.6], [(x1 - x0) / 2, ya, za + 0.6], [(x1 - x0) / 2, yb, zb + 0.6], [-(x1 - x0) / 2, yb, zb + 0.6], '#3e4846', RUST);
    }
    for (const sx of [-1, 1]) {
      const ax = sx * ((x1 - x0) / 2 - 8);
      rod(B, 'std', [ax, piv[1], piv[2]], [ax, piv[1] + Math.sin(-0.55 + open) * R, piv[2] - Math.cos(-0.55 + open) * R], 3.4, '#3a4442', RUST, 6);
      rod(B, 'std', [ax, piv[1], piv[2]], [ax, piv[1] + Math.sin(0.33 + open) * R, piv[2] - Math.cos(0.33 + open) * R], 3.4, '#3a4442', RUST, 6);
      B.cylX('std', ax, piv[1], piv[2], 7, 10, '#2a2e2e', 10, RUST);
    }
  }
  // the crest road's bridge over the spillway: a deep fascia beam on the downstream side
  at(B, gy, (SP.x0 + SP.x1) / 2, TOE + 20, 0, 0, 81);
  B.setAO(0, 1);
  const zF = FACE_Y - 6 - (TOE + 20);
  B.box('std', 0, Z - 40, zF, w + 60, 44, 16, COL.concL, null, CONC);
  B.box('std', 0, Z - 18, zF + 8, w + 60, 4, 4, COL.concD, null, CONC);
  // the chute floor and its training walls, following the profile
  const N = tier === 'low' ? 16 : 40;
  const ys = [];
  for (let i = 0; i <= N; i++) ys.push(FACE_Y - 30 + ((TOE + 60 - (FACE_Y - 30)) * i) / N);
  const z = (y) => y - (TOE + 20);
  const hx = w / 2;
  for (let i = 0; i < N; i++) {
    const ya = ys[i], yb = ys[i + 1];
    const fa = chuteFloor(ya), fb = chuteFloor(yb);
    quad4(B, 'std', [-hx, fa, z(ya)], [-hx, fb, z(yb)], [hx, fb, z(yb)], [hx, fa, z(ya)], i % 2 ? '#8e8a80' : '#96928a', { ...CONC, noJitter: true });
    for (const s of [-1, 1]) {
      const xw = s * (hx + 12);
      // training wall: its top 60 above the floor, both faces and the cap
      quad4(B, 'std', [xw - s * 12, fa - 4, z(ya)], [xw - s * 12, fb - 4, z(yb)], [xw - s * 12, fb + 60, z(yb)], [xw - s * 12, fa + 60, z(ya)], s < 0 ? '#8a867c' : '#8a867c', { ...CONC, noJitter: true });
      quad4(B, 'std', [xw + s * 12, fa + 60, z(ya)], [xw + s * 12, fb + 60, z(yb)], [xw + s * 12, Math.max(0, fb - 200), z(yb)], [xw + s * 12, Math.max(0, fa - 200), z(ya)], '#7e7a70', { ...CONC, noJitter: true });
      quad4(B, 'std', [xw - 12, fa + 60, z(ya)], [xw + 12, fa + 60, z(ya)], [xw + 12, fb + 60, z(yb)], [xw - 12, fb + 60, z(yb)], COL.concL, { ...CONC, noJitter: true });
    }
  }
  // the flip bucket's end sill and the baffle blocks
  B.box('std', 0, 14, z(TOE + 60), w + 48, 22, 16, COL.concD, null, CONC);
  for (let k = 0; k < 7; k++) B.rblock('std', -hx + 50 + k * (w - 100) / 6, 8, z(TOE + 40), 26, 26, 22, 2, COL.concD, null, CONC);
  B.setAO(34, 0.42);
  // lamps on the training walls' tops
  for (const s of [-1, 1]) {
    const xw = (SP.x0 + SP.x1) / 2 + s * (hx + 12);
    for (const yy of [1020, 1160]) {
      const h = chuteFloor(yy) + 60;
      at(B, gy, xw, yy, h, 0, yy);
      B.cyl('std', 0, 0, 0, 1.6, 50, '#4a4e52', 8, 1, null, STEEL);
      lampGlow(B, P.halos, 0, 52, 0, xw, yy, '#ffd9a0', { size: [7, 3, 7], k: 3.4, halo: 90, strength: 0.5, y0: h });
    }
  }
}

// ---- the crest --------------------------------------------------------------------------------------------

/** A parapet obstacle on the crest (north: over the reservoir, south: over the drop), with its cornice. */
export function parapet(P, o) {
  const { B } = P;
  const L = o.w, north = o.style === 'parapetN';
  const s = north ? -1 : 1;        // the outer side (local z)
  const H = 24;                    // a low wall: the eye (52) sees over it, down to the water
  const BR = S(DET.panel, 0.35, 0.8);
  B.rblock('std', 0, 0, 0, L, H, o.h, 2, COL.concL, null, { ...CONC, noJitter: true });
  B.rblock('std', 0, H, 0, L + 2, 5, o.h + 6, 2, '#bdb7aa', null, { ...CONC, noJitter: true });
  // the outer cornice under the deck's edge
  B.box('std', 0, -6, s * (o.h / 2 + 5), L + 2, 12, 10, COL.concD, null, { ...CONC, noJitter: true });
  // an art-deco bronze railing on the wall: square posts, a rail of flat bars between them, a top rail
  const lowTier = P.tier === 'low';
  const postStep = 90, bronze = '#4a3a24', patina = '#3e4a3c';
  for (let x = -L / 2 + 6; x <= L / 2 - 4; x += postStep) {
    B.box('std', x, H + 5 + 9, 0, 3.2, 18, 3.2, bronze, null, BR);
    B.cyl('std', x, H + 5 + 18, 0, 2.4, 3, bronze, 8, 0.4, null, BR);
  }
  rod(B, 'std', [-L / 2, H + 5 + 18, 0], [L / 2, H + 5 + 18, 0], 1.5, bronze, BR, 8);
  rod(B, 'std', [-L / 2, H + 5 + 3, 0], [L / 2, H + 5 + 3, 0], 0.8, patina, BR, 5);
  if (!lowTier) for (let x = -L / 2 + 12; x < L / 2 - 4; x += 12) B.box('std', x, H + 5 + 10.5, 0, 0.7, 14, 0.7, patina, null, BR);
  return true;
}

/** Art-deco lamp standards on the parapets, where the layout put the crest's lights. */
export function crestLamps(P, map) {
  const { B, gy, halos } = P;
  const BR = S(DET.panel, 0.35, 0.8);
  for (const l of map.lights) {
    if (!(l.h > Z + 100 && l.h < Z + 130)) continue;
    const north = l.y < 800;
    const py = north ? C.y0 - 8 : C.y1 + 8;
    at(B, gy, l.x, py, Z, 0, Math.round(l.x));
    // a pylon standing through the parapet: a stepped concrete base, a fluted bronze shaft, a lantern
    B.rblock('std', 0, 0, 0, 22, 34, 22, 2, '#b8b2a4', null, CONC);
    B.rblock('std', 0, 34, 0, 16, 6, 16, 1.5, '#a8a296', null, CONC);
    B.cyl('std', 0, 40, 0, 3.4, 64, COL.bronze, 10, 0.75, null, BR);
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; B.box('std', Math.cos(a) * 3, 60, Math.sin(a) * 3, 1.2, 36, 1.2, '#6a5230', [0, -a, 0], BR); }
    B.cyl('std', 0, 104, 0, 7, 3, COL.bronze, 10, 1, null, BR);
    B.cyl('glass', 0, 107, 0, 6.5, 16, '#e8dcc0', 10, 1.2, null, S(0, 0.15, 0.1));
    B.cyl('std', 0, 123, 0, 8.4, 3, COL.bronze, 10, 0.5, null, BR);
    B.cyl('std', 0, 126, 0, 1.4, 6, COL.bronze, 6, 0.3, null, BR);
    lampGlow(B, halos, 0, 114, 0, l.x, py, l.color, { size: [5, 7, 5], k: P.day ? 1.2 : 3.6, halo: 120, strength: 0.7, y0: Z, shape: 'sphere' });
  }
}

/** The art-deco tower over a stair head: stepped setbacks, fins, the relief lettering and a beacon. */
export function stairTower(P, xc, east) {
  const { B, gy, halos } = P;
  const y0 = C.y1 + 6, y1 = C.y1 + 170;
  const yc = (y0 + y1) / 2;
  at(B, gy, xc, yc, Z, 0, xc);
  const D = y1 - y0, Wd = 280;
  const hw = Wd / 2, hd = D / 2;
  const door = 80;                 // half the doorway (the stair lane is 160 wide)
  // the walls of the ground storey around the doorway on the crest side (-z)
  for (const s of [-1, 1]) {
    B.block('std', s * (hw - (hw - door) / 2), 0, -hd + 10, hw - door, 180, 20, COL.concL, null, CONC);
    B.block('std', s * (hw - 10), 0, 0, 20, 180, D, COL.concL, null, CONC);
  }
  B.block('std', 0, 180, -hd + 10, Wd, 60, 20, COL.concL, null, CONC);
  // setbacks above
  B.block('std', 0, 240, 0, Wd, 10, D, '#b8b2a4', null, CONC);
  B.block('std', 0, 250, 0, Wd - 50, 80, D - 40, COL.concL, null, CONC);
  B.block('std', 0, 330, 0, Wd - 100, 50, D - 80, '#c4beb0', null, CONC);
  B.block('std', 0, 380, 0, Wd - 150, 26, D - 110, COL.concL, null, CONC);
  // vertical fins on the crest face
  for (let k = -3; k <= 3; k++) B.block('std', k * 30, 190, -hd - 2, 8, 130 - Math.abs(k) * 10, 8, '#cfc9ba', null, CONC);
  // the door surround, the lettering and the year
  B.box('std', 0, 170, -hd - 1, door * 2 + 16, 10, 8, COL.bronze, null, S(DET.panel, 0.35, 0.8));
  pic(B, 'damname', 0, 212, -hd - 0.5, 22, Math.PI, { w: Wd - 30 });
  pic(B, 'dam1936', 0, 305, -hd + 19.5, 22, Math.PI);
  // the stair head's inner ceiling and a lamp inside
  B.box('std', 0, 176, 0, Wd - 40, 6, D - 20, '#8a867c', null, CONC);
  lampGlow(B, halos, 0, 168, 0, xc, yc, '#ffd9a0', { size: [10, 2, 10], k: 3, halo: 80, strength: 0.5, y0: Z });
  // a red beacon on the top
  B.cyl('std', 0, 406, 0, 3, 20, '#3a3c3e', 8, 1, null, STEEL);
  lampGlow(B, halos, 0, 428, 0, xc, yc, '#ff3a2a', { size: [4, 4, 4], k: 6, halo: 120, strength: 0.8, blink: 1, y0: Z, shape: 'sphere' });
  void east;
}

/** A spillway hoist house on the crest's north lane over a gate pier. */
export function hoistHouse(P, o) {
  const { B } = P;
  const L = o.w, W = o.h;
  B.rblock('std', 0, 0, 0, L, 96, W, 2, '#aaa498', null, CONC);
  B.rblock('std', 0, 96, 0, L + 6, 6, W + 6, 2, COL.concD, null, CONC);
  B.box('std', 0, 40, W / 2 + 0.6, 26, 60, 1.2, '#4a5652', null, RUST);            // the steel door (road side)
  B.box('std', 12, 42, W / 2 + 1.2, 2, 4, 1, '#c8c0a0', null, STEEL);
  for (let k = 0; k < 4; k++) B.box('std', -L / 2 - 0.6, 60 + k * 6, 0, 1.2, 3, W * 0.5, '#5a605e', null, STEEL);   // louvres
  // the hoist beam reaching north over the parapet to the gate arms, its winch drum
  B.box('std', 0, 102, -W / 2 - 40, 14, 12, 90, '#4e5a58', null, RUST);
  B.cylX('std', 0, 118, -W / 2 - 60, 10, 30, '#3a4442', 12, RUST);
  rod(B, 'std', [0, 102, -W / 2 - 80], [0, 20, -W / 2 - 110], 0.8, '#2a2a2a', STEEL, 4);
  pic(B, 'hv', 0, 70, W / 2 + 0.8, 16, 0);
  return true;
}

/** A leg of the gantry crane (the crane itself is drawn once, by `gantryCrane`). */
export function craneLeg(P, o) {
  void P; void o;
  return true;
}

/** The yellow gantry crane straddling the crest road at DAM.crane, cantilevered over the reservoir. */
export function gantryCrane(P) {
  const { B, gy, halos } = P;
  const x = DAM.crane;
  at(B, gy, x, (C.y0 + C.y1) / 2, Z, 0, 42);
  const Y = '#d8a21c', YD = '#a87a14';
  const legZ = [C.y0 + 22 - 800, C.y1 - 22 - 800];
  const topH = 210;
  for (const lx of [-50, 50]) {
    for (const lz of legZ) {
      // a boxed leg tapering up, its wheel bogie on the rail
      B.rblock('std', lx, 0, lz, 40, 14, 26, 2, '#3a3c3e', null, STEEL);
      B.cylZ('std', lx - 12, 7, lz, 7, 22, '#2a2a2c', 10, STEEL);
      B.cylZ('std', lx + 12, 7, lz, 7, 22, '#2a2a2c', 10, STEEL);
      B.add('std', T.cyl(4, 0.7), [lx, 14 + (topH - 14) / 2, lz], [15, topH - 14, 12], [0, Math.PI / 4, 0], Y, PAINTED);
    }
    // the sill beam along each side at the top
    B.box('std', lx, topH, 0, 18, 22, legZ[1] - legZ[0] + 60, Y, null, PAINTED);
    // diagonal bracing between the legs
    rod(B, 'std', [lx, 30, legZ[0]], [lx, topH - 10, legZ[1]], 2.4, YD, PAINTED, 6);
  }
  // the main girders across (along the crane's span, z), cantilevered north over the water
  for (const gx of [-36, 36]) {
    B.box('std', gx, topH + 30, -40, 14, 40, 420, Y, null, PAINTED);
    for (let z = -240; z <= 160; z += 40) B.box('std', gx, topH + 30, z, 14.4, 38, 2, YD, null, PAINTED);
  }
  B.box('std', 0, topH + 12, 0, 100, 8, 26, Y, null, PAINTED);
  // hazard striping on the girder ends
  for (const gz of [-250, 170]) B.add('decal', T.plane(), [0, topH + 30, gz + (gz < 0 ? -0.8 : 0.8)], [86, 40, 1], [0, gz < 0 ? Math.PI : 0, 0], '#ffffff', { uv: atlasUV('stripeYB'), noAO: true, noJitter: true });
  // the trolley out over the reservoir with its hoist drum, cables and the hook block hanging down
  const tz = -190;
  B.rblock('std', 0, topH + 52, tz, 90, 26, 60, 2, '#c89818', null, PAINTED);
  B.cylX('std', 0, topH + 66, tz, 12, 60, '#3a3c3e', 12, STEEL);
  const hookY = 40;
  for (const cx of [-8, 8]) rod(B, 'std', [cx, topH + 52, tz], [cx, hookY + 20, tz - 10], 0.7, '#1c1c1e', STEEL, 4);
  B.rblock('std', 0, hookY, tz - 10, 24, 22, 12, 2, Y, null, PAINTED);
  B.add('std', T.torus(10, 0.3, 6), [0, hookY - 8, tz - 10], [8, 8, 8], [0, 0, 0], '#3a3a3a', STEEL);
  // the operator's cab under the girder, a ladder up a leg, the walkway rail
  B.rblock('std', 60, topH - 30, 40, 36, 36, 40, 3, Y, null, PAINTED);
  B.box('vglass', 78.5, topH - 12, 40, 1, 18, 30, '#1a2a30');
  B.box('vglass', 60, topH - 12, 60.5, 28, 18, 1, '#1a2a30');
  for (const lz of [legZ[1] + 16]) {
    for (const s of [-5, 5]) rod(B, 'std', [50 + s, 0, lz], [50 + s, topH, lz], 0.7, '#3a3a3a', STEEL, 4);
    for (let y = 8; y < topH; y += 11) rod(B, 'std', [45, y, lz], [55, y, lz], 0.6, '#3a3a3a', STEEL, 4);
  }
  for (const gx of [-50, 50]) rod(B, 'std', [gx, topH + 70, -250], [gx, topH + 70, 170], 0.9, Y, PAINTED, 5);
  pic(B, 'hazard', 0, topH - 4, legZ[1] + 14, 8, 0, { w: 90 });
  // the beacon (the layout's light sits at Z + 260)
  lampGlow(B, halos, 0, topH + 56, 0, x, (C.y0 + C.y1) / 2, '#ff5a3a', { size: [5, 5, 5], k: 6, halo: 120, strength: 0.8, blink: 1, y0: Z, shape: 'sphere' });
  // crane rails along the crest (embedded steel strips the whole length)
  for (const rz of [C.y0 + 22, C.y1 - 22]) {
    for (let xx = C.x0; xx < C.x1; xx += 500) {
      const x1 = Math.min(C.x1, xx + 500);
      at(B, gy, (xx + x1) / 2, rz, Z, 0, xx);
      B.box('std', 0, 0.35, 0, x1 - xx, 0.7, 6, '#6a6a68', null, S(DET.rust, 0.35, 0.85));
    }
  }
}
