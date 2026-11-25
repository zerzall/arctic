// Zombie models for the GPU rig (actor-rig.js). The body is a real human one: the MakeHuman base
// mesh (CC0) shaped per type and decayed (actor-zbody.js: a starved walker with sunken eyes and
// cheeks, receding lips, ribs and collarbones under grey skin; the fresher, fuller runner; the legless
// crawler; the bloater's sagging gut; the spitter's distended throat; the thin screamer's long jaw;
// the hulking brute; the hunched boss with its hump, bare spine and third arm), skinned onto the
// rig's 20 bones as one continuous surface (no jointed segments, no ball joints), UV-mapped for the
// baked skin atlases. Clothes are shells offset from the body (the top, sleeves and trousers, cut per
// instance by the rig shader); the eyes, teeth and tongue are MakeHuman's own helpers. Hats, hair,
// gear, gore and armour (actor-zkit.js) sit on the real head and torso (P: the type's measured
// proportions). Three LODs per type, by decimation (scripts/build-zbody.js): every tier's near model
// is the full shape at its own density, mid range drops the small gear and the tongue, far away a
// plain silhouette whose clothes are painted on the body.
//
// One model per type and LOD serves every zombie of that type: hems, sleeves and trouser legs are
// cut per instance, accessories are option groups switched per instance (actor-zlook.js), and four
// body morphs (sex, fat, emaciation, age) are blended per instance in the vertex shader, so a horde
// of one type is still a single draw call per LOD and no two of them have the same body.
//
// Model space: +X forward, +Y up, +Z right; feet on y = 0; ~56 units (1.7 m) tall at scale 1.

import { ShapeBuilder, SLOT, MAT, PART, lineRings } from './actor-shape.js';
import { B } from './actor-rig.js';
import { addAccessories } from './actor-zkit.js';
import { optionsForType } from './actor-zlook.js';
import { zbodyType, addZBody, headDeformOf, ZBODY } from './actor-zbody.js';

const BONE = '#cfc4a2';
const FLESH = '#5e1616';

export { ZBODY };

const pcache = new Map();

/**
 * The proportions of a type: the measured body (actor-zbody.js) plus the top's shell as functions
 * the accessories sit on (front, back and side of the shell at a height; its surface at a side
 * offset; the crest of the shoulder over a side offset).
 */
function params(type) {
  let P = pcache.get(type);
  if (P) return P;
  const T = zbodyType(type);
  P = { ...T.P };
  P.loose = type === 'boss' ? 0.9 : type === 'brute' ? 0.7 : type === 'runner' ? 0.45 : 0.55;
  // the shell from the torso's vertices: per 0.5-unit height band and side offset, the front and back
  const pos = T.pos, n = pos.length / 3;
  const YB = 0.75, ZB = 0.75, y0 = P.hip - 8, ny = Math.ceil((P.neck + 4 - y0) / YB), nz = 26;
  const fr = new Float64Array(ny * nz).fill(-1e9), bk = new Float64Array(ny * nz).fill(1e9), sideZ = new Float64Array(ny).fill(0);
  const sp = [B.HIPS, B.SPINE, B.CHEST, B.NECK].map((b) => T.pivots[b]);
  const xc = (y) => {
    if (y <= sp[0][1]) return sp[0][0];
    for (let k = 1; k < sp.length; k++) if (y <= sp[k][1]) { const t = (y - sp[k - 1][1]) / (sp[k][1] - sp[k - 1][1]); return sp[k - 1][0] + (sp[k][0] - sp[k - 1][0]) * t; }
    return sp[3][0];
  };
  for (let i = 0; i < n; i++) {
    const b = T.bA[i];
    if (!(b === B.HIPS || b === B.SPINE || b === B.CHEST || b === B.NECK || b === B.X1 || b === B.X2)) continue;
    const x = pos[i * 3], y = pos[i * 3 + 1], z = Math.abs(pos[i * 3 + 2]);
    const iy = Math.floor((y - y0) / YB), iz = Math.floor(z / ZB);
    if (iy < 0 || iy >= ny || iz >= nz) continue;
    // (in front of the spine's line the front of the shell, behind it the back)
    if (x > xc(y)) fr[iy * nz + iz] = Math.max(fr[iy * nz + iz], x);
    else bk[iy * nz + iz] = Math.min(bk[iy * nz + iz], x);
    if (y < P.sY - 1.5) sideZ[iy] = Math.max(sideZ[iy], z);
  }
  const band = (y) => Math.max(0, Math.min(ny - 1, Math.floor((y - y0) / YB)));
  const look = (arr, y, z, best, pick) => {
    const iy = band(y), iz = Math.min(nz - 1, Math.floor(Math.abs(z) / ZB));
    // nearest filled cell along z (outward, then inward), averaged with the bands above and below
    let acc = 0, c = 0;
    for (const dy of [-1, 0, 1]) {
      const yy = Math.max(0, Math.min(ny - 1, iy + dy));
      for (let d = 0; d < nz; d++) {
        const k1 = iz - d, k2 = iz + d;
        let v = best;
        if (k1 >= 0 && arr[yy * nz + k1] !== best) v = arr[yy * nz + k1];
        else if (k2 < nz && arr[yy * nz + k2] !== best) v = arr[yy * nz + k2];
        if (v !== best) { acc += v; c++; break; }
      }
    }
    return c ? acc / c : pick;
  };
  const L = P.loose;
  P.frontX = (y) => look(fr, y, 0, -1e9, 3) + L;
  P.backX = (y) => look(bk, y, 0, 1e9, -3) - L;
  P.sideZ = (y) => { let m = 0; for (let d = -1; d <= 1; d++) m = Math.max(m, sideZ[Math.max(0, Math.min(ny - 1, band(y) + d))]); return (m || 5) + L; };
  P.shellX = (y, z, face = 1) => (face > 0 ? look(fr, y, z, -1e9, 3) + L : look(bk, y, z, 1e9, -3) - L);
  P.crestY = (z) => {
    for (let y = P.neck + 0.3; y > P.sY - 4; y -= 0.1) {
      const iy = band(y), iz = Math.min(nz - 1, Math.floor(Math.abs(z) / ZB));
      if (fr[iy * nz + iz] > -1e9) return y + L;
    }
    return P.sY + L;
  };
  // the old fit factors (accessories made for the procedural torso: rx = 4.7 · fitD, rz = 6.2 · fitK)
  P.fitD = (P.frontX(P.chest) - P.backX(P.chest)) / 2 / 4.7 / 1.25;
  P.fitK = P.sideZ(P.chest) / 6.2;
  // the trousers' waistband (belts)
  P.beltX = Math.max(P.frontX(P.waist - 1) - L, -P.backX(P.waist - 1) - L) + 0.55;
  P.beltZ = P.sideZ(P.waist - 1) - L + 0.55;
  P.hipZ = P.sideZ(P.hip - 1);
  // where the arms and the feet are (the rig's pivots are not on the x = 0 plane)
  P.elbowX = T.pivots[B.FARM_L][0]; P.wristX = T.pivots[B.HAND_L][0];
  P.foot = T.toes.map((t, k) => { const a = T.pivots[k ? B.FOOT_R : B.FOOT_L]; return { ankle: a, toe: t }; });
  pcache.set(type, P);
  return P;
}

/** Skeleton pivots for the proportions (parents: actor-rig DEFAULT_PARENTS, X1/X2 per type). */
export function zombieSkeleton(type) {
  const T = zbodyType(type);
  return { pivots: T.pivots.map((p) => p.slice()), parents: T.parents.slice(), P: params(type) };
}

/** The proportions of a type (for tests and the renderer's hit points). */
export function zombieParams(type) {
  return params(type);
}

/**
 * Where a type's eyes and mouth are (model units): the eye centre { ex, ey, ez } (ez: the right
 * eye's z) and the mouth's line `my` — the corpse material shades the eyes from these.
 */
export function faceAnchors(type) {
  const P = params(type);
  return { ex: P.eye[0], ey: P.eye[1], ez: P.eye[2], my: P.mouthY };
}

// ---------------------------------------------------------------------------------------

/**
 * Build one zombie model.
 * @param {string} type zombies.js id
 * @param {number} L LOD 0 (near) · 1 (mid) · 2 (far)
 * @param {number} [tier] quality tier (-1 cinematic, 0 ultra, 1 high, 2 low)
 * @returns {ShapeBuilder}
 */
export function buildZombie(type, L, tier = 0) {
  const P = params(type);
  const sb = new ShapeBuilder();
  sb.morphs = true;
  const T = addZBody(sb, type, L, tier);
  const bodyEnd = sb.vertexCount;
  if (L < 2) shoes(sb, P, L);
  const optSet = optionsForType(type);
  // (the MakeHuman face has its own nose: the old skull's nose option is not built)
  const has = (name) => optSet.has(name) && name !== 'nose';
  if (tier < 2) addAccessories(sb, P, tier <= 0 ? L : Math.max(L, 1), headDeformOf(type), has, tier < 0 && L === 0);
  extras(sb, P, L, type, T);
  transferMorphs(sb, bodyEnd);
  return sb;
}

/**
 * Everything that is not the body (shoes, gear, gore, armour, the types' extras) follows the
 * instance's body morphs: each vertex takes the position deltas of the nearest skin vertex.
 */
function transferMorphs(sb, from) {
  const n = sb.vertexCount;
  if (from >= n) return;
  const C = 2;
  const grid = new Map();
  const key = (x, y, z) => (Math.floor(x / C) + 512) * 1048576 + (Math.floor(y / C) + 512) * 1024 + (Math.floor(z / C) + 512);
  for (let i = 0; i < from; i++) {
    if (sb.MH[i * 2] < 0) continue;
    const k = key(sb.P[i * 3], sb.P[i * 3 + 1], sb.P[i * 3 + 2]);
    let l = grid.get(k);
    if (!l) grid.set(k, (l = []));
    l.push(i);
  }
  for (let i = from; i < n; i++) {
    const x = sb.P[i * 3], y = sb.P[i * 3 + 1], z = sb.P[i * 3 + 2];
    let best = -1, bd = Infinity;
    for (let r = 0; r <= 4 && best < 0; r++) {
      const cx = Math.floor(x / C), cy = Math.floor(y / C), cz = Math.floor(z / C);
      for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) {
        if (Math.max(Math.abs(a), Math.abs(b), Math.abs(c)) !== r) continue;
        const l = grid.get((cx + a + 512) * 1048576 + (cy + b + 512) * 1024 + (cz + c + 512));
        if (!l) continue;
        for (const j of l) { const d = (sb.P[j * 3] - x) ** 2 + (sb.P[j * 3 + 1] - y) ** 2 + (sb.P[j * 3 + 2] - z) ** 2; if (d < bd) { bd = d; best = j; } }
      }
    }
    if (best < 0) continue;
    for (let k = 0; k < 4; k++) for (let c = 0; c < 3; c++) sb.MO[i * 16 + k * 4 + c] = sb.MO[best * 16 + k * 4 + c];
  }
}

/** One shoe for everybody over the bare foot: the shaft (boots) and the sole colour (sneakers) are per instance. */
function shoes(sb, P, L) {
  const seg = L ? 6 : 10, segH = L ? 4 : 5;
  if (P.legs === 'stumps') return;
  P.foot.forEach(({ ankle, toe }, k) => {
    const FT = k ? B.FOOT_R : B.FOOT_L, SH = k ? B.SHIN_R : B.SHIN_L;
    const heel = ankle[0] - 1.55, len = toe[0] + 0.55 - heel, cx = heel + len / 2;
    const z = (ankle[2] * 0.55 + toe[2] * 0.45);
    const S = { opt: 'shoe', bone: FT };
    sb.ellipsoid([cx + 0.05, 1.5, z], [len / 2 + 0.25, 1.72, 1.62], { ...S, slot: SLOT.TRIM, part: PART.SHOE, segW: seg, segH, mat: MAT.LEATHER, color: '#ffffff', paint: 0.45,
      deform: (p) => { if (p.y < -0.2) p.y = -0.2 - (p.y + 0.2) * 0.25; if (p.x < -0.2 && p.y > 0) p.x *= 0.85; if (p.x > 0.5) p.y *= 0.8; } });
    sb.ellipsoid([cx + 0.1, 0.38, z], [len / 2 + 0.4, 0.45, 1.72], { ...S, slot: SLOT.FIXED, part: PART.SOLE, segW: L ? 7 : 10, segH: 3, mat: MAT.RUBBER, color: '#ffffff' });
    if (L === 0) {
      const r = P.calfR;
      sb.tube([{ c: [ankle[0] + 0.1, ankle[1] + 0.7, ankle[2]], rx: r * 0.62 + 0.6, rz: r * 0.6 + 0.55, bone: SH }, { c: [ankle[0] + 0.15, ankle[1] + 5.6, ankle[2] * 0.98], rx: r * 0.86 + 0.5, rz: r * 0.82 + 0.45, bone: SH }, { c: [ankle[0] + 0.2, ankle[1] + 6.3, ankle[2] * 0.98], rx: r * 0.86 + 0.3, rz: r * 0.82 + 0.3, bone: SH }],
        { ...S, seg: 8, slot: SLOT.TRIM, part: PART.SHAFT, mat: MAT.LEATHER, color: '#ffffff', paint: 0.35, cap1: 'flat' });
    }
  });
}

// ---------------------------------------------------------------------------------------

/** The nearest skin vertex of the type's rest shape to a point → { p, n } (n: outward, from the body's centre line). */
function surface(T, at, bones = null) {
  let best = -1, bd = Infinity;
  const pos = T.pos;
  for (let i = 0; i < pos.length / 3; i++) {
    if (bones && !bones.includes(T.bA[i])) continue;
    const d = (pos[i * 3] - at[0]) ** 2 + (pos[i * 3 + 1] - at[1]) ** 2 + (pos[i * 3 + 2] - at[2]) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  const p = [pos[best * 3], pos[best * 3 + 1], pos[best * 3 + 2]];
  const o = [at[0] - p[0], at[1] - p[1], at[2] - p[2]];
  const l = Math.hypot(...o) || 1;
  return { p, n: bd > 0.01 ? o.map((v) => v / l) : [1, 0, 0] };
}

function extras(sb, P, L, type, T) {
  const GLOWC = { bloater: '#b8c060', spitter: '#9cd83a', boss: '#c8a040' };
  if (type === 'bloater' && L < 2) {
    // weeping blisters over the swollen gut and its sides (a few glow faintly with the sickness inside)
    const cx = T.pivots[B.X1][0], cy = T.pivots[B.X1][1];
    for (let k = 0; k < (L === 0 ? 14 : 6); k++) {
      const th = k * 2.39996, u = (k + 0.5) / 14;
      const at = [cx + 12, cy - 6 + u * 13, Math.sin(th) * 9];
      const s = surface(T, at, [B.X1, B.SPINE, B.HIPS]);
      const r = 0.25 + ((k * 0.77) % 1) * 0.4, lit = k % 3 === 0;
      sb.ellipsoid([s.p[0] - 0.05, s.p[1], s.p[2]], [r, r * 0.8, r], { segW: 6, segH: 4, slot: lit ? SLOT.GLOW : SLOT.FIXED, mat: lit ? MAT.GLOW : MAT.FLESH, color: lit ? GLOWC.bloater : '#7a7440', bone: B.X1, paint: lit ? 0 : 0.1 });
    }
  } else if (type === 'spitter' && L < 2) {
    // acid glands along the shoulders and upper back, drool strands hanging from the jaw
    for (let k = 0; k < (L === 0 ? 7 : 3); k++) {
      const a = 2.2 + k * 0.62 + (k % 2) * 0.3, r = 0.4 + ((k * 0.61) % 1) * 0.45;
      const s = surface(T, [Math.cos(a) * 9 - 1, P.sY - 1 + (k % 3) * 1.4 - 1.5, Math.sin(a) * 9], [B.CHEST]);
      sb.ellipsoid([s.p[0], s.p[1], s.p[2]], [r, r, r], { segW: 6, segH: 4, slot: SLOT.GLOW, mat: MAT.GLOW, color: GLOWC.spitter, bone: B.CHEST });
    }
    // the throat sac glows under its stretched skin
    const th = T.pivots[B.X1];
    sb.ellipsoid([th[0] - 0.2, th[1] + 0.1, 0], [1.45, 1.55, 1.9], { segW: L === 0 ? 12 : 7, segH: L === 0 ? 8 : 5, slot: SLOT.GLOW, mat: MAT.GLOW, color: '#6fb420', bone: B.X1 });
    if (L === 0) {
      for (let d = 0; d < 3; d++) {
        const z = (d - 1) * 0.5, len = 3.5 + d * 2.0, x = P.eye[0] + 0.2;
        sb.tube(lineRings([x, P.mouthY - 0.9, z], [x + 0.3, P.mouthY - 0.9 - len, z * 1.2], 0.18, 0.07, 4), { seg: 4, cap1: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.FLESH, color: '#8a9a50', bone: B.JAW, paint: 0.2 });
      }
    }
  } else if (type === 'brute' && L < 2) {
    // bone breaking through the back and the club arm's shoulder; bony growths plating that forearm
    const spurs = [[-5, P.sY + 1, -3.5, -0.5, 5], [-5.5, P.chest + 3, 2.5, 0.35, 6], [-5, P.chest - 1, -2, -0.2, 4.5], [-3, P.sY + 3, 5, 0.8, 4], [0, P.sY + 1.5, 11, 1.3, 4.2]];
    for (const [x, y, z, a, len] of spurs) {
      const s = surface(T, [x, y, z], [B.CHEST, B.UARM_R, B.NECK]);
      const bone = s.p[2] > 8 ? B.UARM_R : B.CHEST;
      const dx = -Math.cos(a) * 0.85, dz = Math.sin(a) * 0.9, dy = 0.45, o = s.p;
      sb.tube(lineRings([o[0] + dx * 0.3, o[1], o[2] + dz * 0.3], [o[0] + dx * len, o[1] + dy * len, o[2] + dz * len], 0.9, 0.05, 4), { seg: 6, cap0: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.BONE, color: BONE, bone });
      sb.ellipsoid([o[0], o[1], o[2]], [1.2, 1.2, 1.2], { segW: 6, segH: 4, slot: SLOT.FIXED, mat: MAT.FLESH, color: FLESH, bone, paint: 0.8 });
    }
    const el = T.pivots[B.FARM_R], wr = T.pivots[B.HAND_R];
    for (let k = 0; k < (L === 0 ? 7 : 3); k++) {
      const t = (k + 0.5) / 7, a = k * 2.1;
      const c = [el[0] + (wr[0] - el[0]) * t + Math.cos(a) * 3, el[1] + (wr[1] - el[1]) * t, el[2] + (wr[2] - el[2]) * t + Math.sin(a) * 3];
      const s = surface(T, c, [B.FARM_R]);
      sb.ellipsoid([s.p[0], s.p[1], s.p[2]], [1.0, 1.4, 0.9], { segW: 6, segH: 4, rot: [a, 0, 0.3], slot: SLOT.FIXED, mat: MAT.BONE, color: '#bfb190', bone: B.FARM_R,
        deform: (p) => { if (p.y > 0) { p.x *= 1 - p.y * 0.6; p.z *= 1 - p.y * 0.6; } } });
    }
  } else if (type === 'boss') {
    // the flayed strip down the back with the spine bare, spikes along it and the shoulders, glowing
    // tumours, a withered third arm out of the left shoulder blade, horns of bone out of the skull
    if (L < 2) {
      const top = surface(T, [-12, P.sY + 2, 0], [B.CHEST, B.X1, B.NECK]).p, bot = surface(T, [-12, P.waist, 0], [B.SPINE, B.CHEST, B.X1]).p;
      const mid = [(top[0] + bot[0]) / 2 - 0.3, (top[1] + bot[1]) / 2, 0];
      sb.ellipsoid(mid, [1.4, (top[1] - bot[1]) / 2 + 1, 3.1], { segW: L ? 6 : 10, segH: L ? 8 : 14, slot: SLOT.FIXED, mat: MAT.FLESH, color: '#4a1418', bone: B.X1, paint: 0.9 });
      const nv = L === 0 ? 11 : 6;
      for (let i = 0; i < nv; i++) {
        const y = top[1] + 1 - (i / (nv - 1)) * (top[1] - bot[1] + 1);
        const s = surface(T, [-14, y, 0], [B.CHEST, B.X1, B.SPINE]);
        sb.ellipsoid([s.p[0] - 0.5, y, 0], [1.05, 0.72, 1.25], { segW: 6, segH: 4, slot: SLOT.FIXED, mat: MAT.BONE, color: BONE, bone: B.X1 });
        if (L === 0) for (const z of [-1, 1]) sb.tube(lineRings([s.p[0] - 0.3, y, z * 1.2], [s.p[0] + 1.6, y - 0.9, z * 5.2], 0.28, 0.14, 3), { seg: 4, slot: SLOT.FIXED, mat: MAT.BONE, color: BONE, bone: B.X1 });
        if (i % 2 === 0 && i < 9) {
          const z = (i % 4 ? 1 : -1) * 4.2, sp = surface(T, [-14, y, z], [B.CHEST, B.X1, B.SPINE]).p, a = z > 0 ? 0.45 : -0.45, len = 6 + (i % 3) * 2.2;
          sb.tube(lineRings(sp, [sp[0] - Math.cos(a) * 0.8 * len, sp[1] + 0.5 * len, sp[2] + Math.sin(a) * 0.95 * len], 1.1, 0.06, 4), { seg: L === 0 ? 7 : 5, cap0: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.BONE, color: '#c8bc9c', bone: B.X1 });
        }
      }
      for (const z of [-1, 1]) {
        const sp = surface(T, [-1, P.sY + 4, z * 11], [B.CHEST, B.UARM_L, B.UARM_R]).p;
        sb.tube(lineRings(sp, [sp[0] - 1, sp[1] + 4.5, sp[2] + z * 5], 1.1, 0.06, 4), { seg: 6, cap0: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.BONE, color: '#c8bc9c', bone: B.CHEST });
      }
      for (let k = 0; k < (L === 0 ? 12 : 5); k++) {
        const a = k * 2.4, s = surface(T, [Math.cos(a) * 12, P.chest - 6 + (k % 4) * 3.5, Math.sin(a) * 12], [B.CHEST, B.SPINE, B.X1]);
        const r = 0.8 + (k % 3) * 0.45;
        sb.ellipsoid(s.p, [r, r, r], { segW: 6, segH: 4, slot: SLOT.GLOW, mat: MAT.GLOW, color: GLOWC.boss, bone: B.CHEST });
      }
      // third arm: withered, clawed, sprouting from the left shoulder blade
      const sh = surface(T, [-6, P.sY - 3, -9], [B.CHEST, B.X1]).p;
      const X2 = B.X2;
      sb.tube([
        { c: [sh[0] + 0.5, sh[1], sh[2] + 0.4], r: 1.6, bone: B.CHEST },
        { c: [sh[0] - 0.4, sh[1] - 6, sh[2] - 1.2], r: 1.3, bone: X2 },
        { c: [sh[0] - 0.2, sh[1] - 12, sh[2] - 1.8], r: 1.0, bone: X2 },
        { c: [sh[0] + 0.1, sh[1] - 16.5, sh[2] - 2.0], r: 0.8, bone: X2 },
      ], { seg: L === 0 ? 8 : 5, cap1: 'round', capRings: 1, slot: SLOT.SKIN, mat: MAT.SKIN, color: '#d8d8d8', paint: 0.5, part: PART.LIMB });
      for (let f = 0; f < 3; f++) {
        sb.tube(lineRings([sh[0] + 0.3, sh[1] - 17, sh[2] - 2 + (f - 1) * 0.7], [sh[0] + 1.5, sh[1] - 20.5, sh[2] - 2 + (f - 1) * 1.1], 0.35, 0.03, 3), { seg: 4, slot: SLOT.FIXED, mat: MAT.BONE, color: BONE, bone: X2 });
      }
      // horns
      const c = P.headC, r = P.headR;
      for (const s of [-1, 1]) sb.tube([{ c: [c[0] - 0.5, c[1] + r[1] * 0.72, s * 2.0], r: 0.8, bone: B.HEAD }, { c: [c[0] - 1.6, c[1] + r[1] + 1.2, s * 3.2], r: 0.62, bone: B.HEAD }, { c: [c[0] - 3.2, c[1] + r[1] + 2.8, s * 3.7], r: 0.36, bone: B.HEAD }, { c: [c[0] - 4.8, c[1] + r[1] + 3.2, s * 3.4], r: 0.05, bone: B.HEAD }], { seg: 6, slot: SLOT.FIXED, mat: MAT.BONE, color: '#bfb496' });
    }
  } else if (type === 'crawler' && L === 0) {
    // entrails trailing from a torn belly, dragged along the ground
    const s = surface(T, [8, P.hip + 1.5, 1], [B.HIPS, B.SPINE]).p;
    for (let k = 0; k < 3; k++) {
      const pts = [];
      for (let i = 0; i <= 9; i++) {
        const t = i / 9;
        pts.push({ c: [s[0] - 0.4 + Math.sin(t * 6 + k * 2) * 0.9 - t * 2, s[1] - t * (9 + k * 3), s[2] + (k - 1) * 1.2 + Math.sin(t * 5 + k) * 1.1], r: 0.55 + Math.sin(t * 11 + k) * 0.16, bone: B.HIPS });
      }
      sb.tube(pts, { seg: 5, cap1: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.FLESH, color: k % 2 ? '#6a2a30' : '#7a3238', paint: 0.9 });
    }
  }
}
