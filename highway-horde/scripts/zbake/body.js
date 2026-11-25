// The zombies' body atlases (scripts/bake-zbody.js): skin painted in the MakeHuman UV layout from the
// body itself. Every texel knows where it is on the body (the posed full-resolution mesh rasterised
// into UV space: rest-pose position, normal, bone, ambient occlusion), so the paint follows anatomy:
// pores and fine wrinkles everywhere, creases at the knuckles, the eyes and the neck, veins where
// they show (temples, throat, inner arms, the backs of the hands, the chest), the sunken sockets
// bruised dark, the lips shrunk and cracked, nails gone grey and dirty, the scalp's hair matted and
// falling out, livor and marbling where the blood settled and rotted, bruises, scrapes, slipped skin
// (the long dead), dried blood round the mouth and nose. Eight sets: three stages of decay (the
// walkers, runners and crawlers) and the five specials' own skins.
//
// Maps (as the other zombie sets, scripts/bake-zombies.js encodeSet): albedo (sRGB), normal (tangent
// space in the UV frame, x along +u, y along +v), pack R roughness · G ambient occlusion · B hair
// coverage (tinted per zombie with its hair colour by the shader).

import { buildBody } from '../build-zbody.js';
import { Rgb, smooth, clamp01, mix } from './lib.js';

// ---- 3D gradient noise (Perlin, improved) -----------------------------------------------------
const PERM = new Uint8Array(512);
{
  let s = 1337;
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function grad(h, x, y, z) {
  const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}
/** Perlin noise, −1..1 (roughly). */
export function pnoise(x, y, z) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  x -= X; y -= Y; z -= Z;
  const xi = X & 255, yi = Y & 255, zi = Z & 255;
  const u = fade(x), v = fade(y), w = fade(z);
  const A = PERM[xi] + yi, AA = PERM[A] + zi, AB = PERM[A + 1] + zi, Bq = PERM[xi + 1] + yi, BA = PERM[Bq] + zi, BB = PERM[Bq + 1] + zi;
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(grad(PERM[AA] & 15, x, y, z), grad(PERM[BA] & 15, x - 1, y, z), u), l(grad(PERM[AB] & 15, x, y - 1, z), grad(PERM[BB] & 15, x - 1, y - 1, z), u), v),
    l(l(grad(PERM[AA + 1] & 15, x, y, z - 1), grad(PERM[BA + 1] & 15, x - 1, y, z - 1), u), l(grad(PERM[AB + 1] & 15, x, y - 1, z - 1), grad(PERM[BB + 1] & 15, x - 1, y - 1, z - 1), u), v), w) * 1.1;
}
export function fbm3(x, y, z, oct, gain = 0.5) {
  let a = 0, k = 1, n = 0;
  for (let o = 0; o < oct; o++) { a += pnoise(x * k + o * 17.3, y * k - o * 9.1, z * k + o * 5.7) / (1 << o) * (gain * 2) ** o; n += (gain * 2) ** o / (1 << o); k *= 2; }
  return a / n;
}
/** Ridged noise (veins, cracks): 1 on the ridge lines, 0 away from them. */
export function ridge3(x, y, z, oct) {
  let a = 0, k = 1, amp = 1, n = 0;
  for (let o = 0; o < oct; o++) { const v = 1 - Math.abs(pnoise(x * k + o * 3.1, y * k + o * 7.7, z * k - o * 2.3)); a += v * v * v * v * amp; n += amp; k *= 2.1; amp *= 0.5; }
  return a / n;
}
/** Cellular (Worley F1) distance in 3D, ~0..1. */
export function cell3(x, y, z) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  let d = 9;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
    const h = PERM[(PERM[(PERM[(X + i) & 255] + Y + j) & 255] + Z + k) & 255];
    const h2 = PERM[(h + 71) & 255], h3 = PERM[(h + 151) & 255];
    const dx = i + h / 255 - (x - X), dy = j + h2 / 255 - (y - Y), dz = k + h3 / 255 - (z - Z);
    d = Math.min(d, dx * dx + dy * dy + dz * dz);
  }
  return Math.sqrt(d);
}

// ---- the body in UV space -----------------------------------------------------------------------
let BODY = null;
async function body() {
  if (!BODY) BODY = await buildBody({ levels: false, log: () => {} });
  return BODY;
}

/**
 * Rasterise the body into N×N texels (rows bottom-up, v up): per texel the rest-pose position, the
 * normal, the dominant rig bone, the ambient occlusion; `cover` marks texels inside a UV island and
 * `near` points every texel outside the islands at the nearest one inside (padding for the mips).
 */
export async function raster(N) {
  const Bd = await body();
  const { rpos, ruv, rnrm, rao, bodyTris, RV, RW } = Bd;
  const n = N * N;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), ao = new Float32Array(n), bone = new Uint8Array(n), cover = new Uint8Array(n);
  for (let t = 0; t < bodyTris.length; t += 3) {
    const a = bodyTris[t], b = bodyTris[t + 1], c = bodyTris[t + 2];
    const ax = ruv[a * 2] * N, ay = ruv[a * 2 + 1] * N, bx = ruv[b * 2] * N, by = ruv[b * 2 + 1] * N, cx = ruv[c * 2] * N, cy = ruv[c * 2 + 1] * N;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 1)), x1 = Math.min(N - 1, Math.ceil(Math.max(ax, bx, cx) + 1));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - 1)), y1 = Math.min(N - 1, Math.ceil(Math.max(ay, by, cy) + 1));
    const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(det) < 1e-12) continue;
    const dom = RW[RV[a][0]].w < 0.5 ? RW[RV[a][0]].a : RW[RV[a][0]].b;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      let u = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / det;
      let v = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / det;
      let w = 1 - u - v;
      // (a texel whose centre is just outside still takes the triangle: no cracks along edges)
      const e = -0.02;
      if (u < e || v < e || w < e) continue;
      u = Math.max(0, u); v = Math.max(0, v); w = Math.max(0, w);
      const s = u + v + w; u /= s; v /= s; w /= s;
      const i = y * N + x;
      for (let k = 0; k < 3; k++) {
        pos[i * 3 + k] = rpos[a * 3 + k] * u + rpos[b * 3 + k] * v + rpos[c * 3 + k] * w;
        nrm[i * 3 + k] = rnrm[a * 3 + k] * u + rnrm[b * 3 + k] * v + rnrm[c * 3 + k] * w;
      }
      ao[i] = rao[a] * u + rao[b] * v + rao[c] * w;
      bone[i] = dom;
      cover[i] = 1;
    }
  }
  // padding: every uncovered texel copies its nearest covered texel (two-pass jump flood)
  const near = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) if (cover[i]) near[i] = i;
  for (let step = N >> 1; step >= 1; step >>= 1) {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x;
      let best = near[i], bd = best >= 0 ? (best % N - x) ** 2 + (Math.floor(best / N) - y) ** 2 : Infinity;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx * step, yy = y + dy * step;
        if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
        const c = near[yy * N + xx];
        if (c < 0) continue;
        const d = (c % N - x) ** 2 + (Math.floor(c / N) - y) ** 2;
        if (d < bd) { bd = d; best = c; }
      }
      near[i] = best;
    }
  }
  return { N, pos, nrm, ao, bone, cover, near, J: Bd.J0, piv: Object.fromEntries(Bd.PIV_NAMES.map((k, i) => [k, Bd.J0[i]])) };
}

// ---- the paint ------------------------------------------------------------------------------
const lin = (hex) => { const v = parseInt(hex.slice(1), 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255].map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); };
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mulc = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const g2 = (x, s) => Math.exp(-(x * x) / (s * s));

/**
 * Per set: the base skin and its variation, the extremities' colour, marbling (rot in the veins),
 * how much the veins, bruises and slipped skin show, wetness, cracks, scars, stretch marks, acid
 * burns, the eye sockets, lips and nails.
 */
export const BODY_LOOKS = {
  'body-fresh': { base: '#a7a39b', base2: '#9da6aa', ext: '#7c8494', lip: '#5c5058', sock: '#4a3a44', vein: '#5a6680', veins: 0.75, marble: 0.1, bruise: 0.55, slip: 0, rough: 0.56, crack: 0, nail: '#8e8a86', blood: 0.65, liv: '#7a5468' },
  'body-weeks': { base: '#8e937a', base2: '#9a8e72', ext: '#5e6050', lip: '#3c3432', sock: '#2e2a26', vein: '#38452c', veins: 0.55, marble: 0.85, bruise: 0.7, slip: 0.35, rough: 0.6, crack: 0.1, nail: '#6e6450', blood: 0.55, liv: '#5a4a50', wet: 0.35 },
  'body-months': { base: '#7a6c58', base2: '#6c6a58', ext: '#3c3026', lip: '#2a1e1a', sock: '#1e1612', vein: '#3a3020', veins: 0.3, marble: 0.5, bruise: 0.4, slip: 0.75, rough: 0.76, crack: 0.75, nail: '#4a3a28', blood: 0.45, liv: '#4a3a34' },
  'body-bloater': { base: '#97976a', base2: '#8a9a60', ext: '#5e6040', lip: '#3a3428', sock: '#2e2a20', vein: '#2e4020', veins: 0.6, marble: 1.0, bruise: 0.6, slip: 0.3, rough: 0.42, crack: 0, nail: '#6a6448', blood: 0.4, liv: '#5a5040', wet: 0.55, stretch: 1, blister: 1 },
  'body-spitter': { base: '#99946a', base2: '#a0965e', ext: '#6a6440', lip: '#3a3020', sock: '#2e2618', vein: '#3c4a1e', veins: 0.7, marble: 0.6, bruise: 0.4, slip: 0.25, rough: 0.55, crack: 0.15, nail: '#6e6640', blood: 0.35, liv: '#5a5030', acid: 1 },
  'body-brute': { base: '#a09496', base2: '#958c92', ext: '#62545c', lip: '#3a2a2e', sock: '#2a1e22', vein: '#3a3048', veins: 0.6, marble: 0.35, bruise: 0.8, slip: 0.1, rough: 0.66, crack: 0.2, nail: '#5a5048', blood: 0.6, liv: '#5a3a48', scars: 1 },
  'body-screamer': { base: '#b4b6b8', base2: '#a9b0ba', ext: '#7a8090', lip: '#4a3a48', sock: '#2e2232', vein: '#4a5a8a', veins: 1.0, marble: 0.2, bruise: 0.35, slip: 0.15, rough: 0.54, crack: 0.1, nail: '#8a8890', blood: 0.8, liv: '#6a4a62' },
  'body-boss': { base: '#946a60', base2: '#86645a', ext: '#4e3028', lip: '#2a1414', sock: '#1a0c0c', vein: '#3a1418', veins: 0.6, marble: 0.4, bruise: 0.5, slip: 0.6, rough: 0.6, crack: 0.9, nail: '#4a3028', blood: 0.6, liv: '#4a2a2a', ulcer: 1 },
};

/**
 * Paint one body set at N² → the encodeSet record (alb, nx/ny, rough, ao, b = hair coverage,
 * linear: false). R from raster(N).
 */
export function paintBody(name, R) {
  const S = BODY_LOOKS[name];
  const { N, pos, nrm, bone, cover, near } = R;
  const n = N * N;
  const col = { base: lin(S.base), base2: lin(S.base2), ext: lin(S.ext), lip: lin(S.lip), sock: lin(S.sock), vein: lin(S.vein), nail: lin(S.nail), liv: lin(S.liv) };
  const BLOOD_OLD = lin('#2a0c08'), BLOOD = lin('#4a0a08'), DIRT = lin('#3a3024'), RAW = lin('#7a4a40'), BRUISE = lin('#4a3050'), BRUISE2 = lin('#5e6a3a'), SCAR = lin('#8a6a66'), ACID = lin('#8a9a2a'), NIPPLE = lin('#6a4a44');
  const J = R.piv;
  const EL = J.EYE_L, ER = J.EYE_R;
  const eye = [(EL[0] + ER[0]) / 2, (EL[1] + ER[1]) / 2, Math.abs(EL[2])];
  const mouthY = eye[1] - 2.05;
  const B = { HEAD: 4, JAW: 5, UARM_L: 6, FARM_L: 7, HAND_L: 8, UARM_R: 9, FARM_R: 10, HAND_R: 11, THIGH_L: 12, SHIN_L: 13, FOOT_L: 14, THIGH_R: 15, SHIN_R: 16, FOOT_R: 17, CHEST: 2, SPINE: 1, HIPS: 0, NECK: 3 };
  // the face's front (the nose tip) and the fingertips' and toes' reach
  let noseX = -1e9;
  for (let i = 0; i < n; i++) if (cover[i] && bone[i] === B.HEAD && Math.abs(pos[i * 3 + 2]) < 0.3 && Math.abs(pos[i * 3 + 1] - (eye[1] - 1.1)) < 0.5) noseX = Math.max(noseX, pos[i * 3]);
  const wristL = J.HAND_L, wristR = J.HAND_R;
  let reachL = 0, reachR = 0, toeX = -1e9;
  for (let i = 0; i < n; i++) {
    if (!cover[i]) continue;
    const b = bone[i], y = pos[i * 3 + 1];
    if (b === B.HAND_L) reachL = Math.max(reachL, wristL[1] - y);
    if (b === B.HAND_R) reachR = Math.max(reachR, wristR[1] - y);
    if (b === B.FOOT_L || b === B.FOOT_R) toeX = Math.max(toeX, pos[i * 3]);
  }
  const alb = new Rgb(N), h = new Float32Array(n), rough = new Float32Array(n), ao = new Float32Array(n), hair = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = cover[i] ? i : near[i];
    if (s < 0) { alb.r[i] = alb.g[i] = alb.b[i] = 0.3; rough[i] = 0.7; ao[i] = 1; continue; }
    const x = pos[s * 3], y = pos[s * 3 + 1], z = pos[s * 3 + 2];
    const nx = nrm[s * 3], ny = nrm[s * 3 + 1], nz = nrm[s * 3 + 2];
    const b = bone[s], az = Math.abs(z);
    const isHead = b === B.HEAD || b === B.JAW;
    const isHand = b === B.HAND_L || b === B.HAND_R, isFoot = b === B.FOOT_L || b === B.FOOT_R;
    const isArm = b === B.UARM_L || b === B.UARM_R || b === B.FARM_L || b === B.FARM_R;
    const isLeg = b === B.THIGH_L || b === B.THIGH_R || b === B.SHIN_L || b === B.SHIN_R;
    // ---- base colour: two skin hues blotched at a body scale, a finer mottle, pallor ----
    const m1 = fbm3(x * 0.09, y * 0.09, z * 0.09, 3), m2 = fbm3(x * 0.45 + 11, y * 0.45, z * 0.45, 3), m3 = pnoise(x * 2.1, y * 2.1, z * 2.1);
    let c = mixc(col.base, col.base2, clamp01(0.5 + m1 * 1.2));
    c = c.map((v) => v * (0.9 + m2 * 0.16 + m3 * 0.04));
    let hgt = 0, r = S.rough + m2 * 0.06, hk = 0, wet = 0;
    // pores and skin grain: cells at ~1.5 mm, a crease network at ~5 mm
    const pore = cell3(x * 7.5, y * 7.5, z * 7.5);
    const grain = ridge3(x * 1.9, y * 1.9, z * 1.9, 2);
    hgt += smooth(0.05, 0.45, pore) * 0.012 - grain * 0.01;
    c = c.map((v) => v * (0.97 + 0.05 * smooth(0.1, 0.5, pore)));
    // extremities: cyanotic or dark (fingers, toes, ears, nose, lips) — from the reach of the limb
    let ext = 0;
    if (isHand) { const reach = (b === B.HAND_L ? wristL[1] : wristR[1]) - y; ext = smooth(0.25, 1.0, reach / (b === B.HAND_L ? reachL : reachR)); }
    if (isFoot) ext = smooth(toeX - 3.5, toeX - 0.5, x) * 0.9 + 0.2;
    if (isHead) {
      ext = Math.max(ext, g2(az - 2.8, 0.5) * smooth(eye[0] - 1.5, eye[0] - 3.5, x) * 0.7);     // the ears
      ext = Math.max(ext, g2(z, 0.35) * smooth(noseX - 0.7, noseX, x) * g2(y - (eye[1] - 1.15), 0.5) * 0.6);   // the nose's tip
    }
    c = mixc(c, mulc(c, col.ext.map((v) => v / Math.max(0.05, (col.base[0] + col.base[1] + col.base[2]) / 3))), ext * 0.55);
    // ---- veins: a network under the skin, where it is thin ----
    let vk = S.veins * (0.25 + 0.75 * (isArm || isHand ? 1 : isLeg ? 0.7 : isHead ? 0.6 : 0.55));
    if (isHead) vk *= 0.4 + g2(Math.hypot(az - 2.0, y - (eye[1] + 0.6)), 0.9) * 1.5;            // the temples
    if (b === B.NECK) vk *= 1.4;
    const vr = ridge3(x * 0.55 + 3, y * 0.32, z * 0.55, 3);
    const vein = smooth(0.62, 0.86, vr) * vk;
    c = mixc(c, mulc(c, col.vein.map((v) => v * 2.2)), vein * 0.6);
    hgt += vein * 0.035;
    // ---- marbling: rot in the superficial veins (dark green-brown branching), worst on the trunk and thighs ----
    if (S.marble > 0) {
      const mk = S.marble * (b === B.CHEST || b === B.SPINE || b === B.HIPS ? 1 : isLeg || isArm ? 0.75 : 0.4);
      const mr = ridge3(x * 0.3 - 5, y * 0.24, z * 0.3 + 2, 3);
      const marble = smooth(0.55, 0.85, mr) * mk;
      c = mixc(c, mulc(c, [0.42, 0.48, 0.28]), marble * 0.75);
      // the green discoloration of the belly (where rot starts)
      const belly = g2(y - (J.SPINE[1] - 2), 4) * smooth(0, 3, x) * S.marble;
      c = mixc(c, mulc(c, [0.72, 0.85, 0.52]), belly * 0.45 * clamp01(0.5 + m1));
    }
    // ---- bruises: purple going green-yellow at the edges ----
    const bz = fbm3(x * 0.22 + 40, y * 0.22, z * 0.22, 3);
    const bruise = smooth(0.32, 0.58, bz) * S.bruise * (isArm || isLeg || isHand ? 1 : 0.6);
    c = mixc(c, mixc(mulc(c, BRUISE.map((v) => v * 2.4)), mulc(c, BRUISE2.map((v) => v * 2.2)), smooth(0.5, 0.32, bz)), bruise * 0.6);
    // ---- livor in the hands and feet (the shader adds the legs' by height) ----
    if (isHand || isFoot) c = mixc(c, mulc(c, col.liv.map((v) => v * 2.4)), 0.35 * (isHand ? ext : 0.7));
    // ---- the face ----
    if (isHead) {
      // sunken sockets: a bruised dark ring round the eyes, red-rimmed lids
      for (const E of [EL, ER]) {
        const d = Math.hypot((y - E[1]) * 1.25, (z - E[2]) * 0.95, Math.max(0, E[0] - 0.3 - x) * 0.6);
        const ring = smooth(1.55, 0.6, d);
        c = mixc(c, mulc(c, col.sock.map((v) => v * 3)), ring * 0.7);
        const lid = g2(d - 0.55, 0.12) * smooth(E[0] - 0.6, E[0] + 0.2, x);
        c = mixc(c, mulc(c, [1.25, 0.55, 0.55]), lid * 0.5);
        hgt -= ring * 0.04;
        wet = Math.max(wet, lid * 0.4);
        // crow's feet
        const cf = g2(d - 1.05, 0.35) * smooth(0.3, 1.0, az - Math.abs(E[2]) + 0.4);
        hgt -= cf * Math.max(0, Math.sin(Math.atan2(y - E[1], az - Math.abs(E[2])) * 9)) * 0.02;
      }
      // brows: sparse hair over the brow ridge
      const browY = eye[1] + 0.68 + 0.12 * g2(az - 1.0, 0.5) - 0.18 * smooth(1.1, 1.8, az);
      const brow = g2(y - browY, 0.16) * smooth(0.15, 0.4, az) * smooth(1.95, 1.5, az) * smooth(eye[0] - 0.5, eye[0] + 0.3, x);
      hk = Math.max(hk, brow * smooth(0.35, 0.6, 0.5 + pnoise(x * 9, y * 22, z * 9) * 0.7));
      // forehead creases
      const fh = smooth(eye[1] + 1.0, eye[1] + 1.4, y) * smooth(eye[1] + 2.6, eye[1] + 2.1, y) * smooth(eye[0] - 0.4, eye[0] + 0.3, x) * smooth(2.0, 1.2, az);
      hgt -= fh * smooth(0.6, 0.95, Math.sin(y * 6.5 + pnoise(z, y, 0) * 1.5) * 0.5 + 0.5) * 0.025;
      // lips: shrunk back, dark, cracked
      const lip = g2(y - mouthY, 0.33) * g2(z, 0.95) * smooth(noseX - 1.6, noseX - 0.8, x);
      c = mixc(c, col.lip.map((v) => v * (0.9 + 0.2 * m3)), lip * 0.85);
      hgt -= lip * smooth(0.7, 0.95, Math.abs(Math.sin(z * 18 + pnoise(z * 4, y * 4, 0) * 2))) * 0.02;
      r = mix(r, 0.45, lip);
      // the mouth's corners and the nostrils: dried blood, crusted dark
      const corner = g2(y - (mouthY - 0.15), 0.5) * g2(az - 0.85, 0.35) * smooth(noseX - 2.0, noseX - 1.0, x);
      const nostril = g2(y - (eye[1] - 1.55), 0.25) * g2(az - 0.32, 0.22) * smooth(noseX - 1.0, noseX - 0.4, x);
      // a run of it down the chin from the mouth
      const run = g2(z - pnoise(y * 0.5, 3, 0) * 0.6, 0.55 + 0.2 * pnoise(y * 2, 0, 1)) * smooth(mouthY, mouthY - 0.3, y) * smooth(noseX - 1.6, noseX - 0.6, x);
      const bl = clamp01(corner * 0.9 + nostril + run * 0.8) * S.blood;
      c = mixc(c, mixc(BLOOD_OLD, BLOOD, 0.3 + 0.3 * m3), smooth(0.15, 0.45, bl + m2 * 0.15) * 0.9);
      hgt += smooth(0.2, 0.5, bl) * 0.01;
      // the scalp: hair from the hairline (forehead, temples, the nape), matted into clumps with bald patches
      const front = smooth(eye[0] - 2.4, eye[0] - 0.8, x);
      const line = mix(eye[1] - 2.1, eye[1] + 1.9, front) + (front > 0.1 && front < 0.9 ? 0.6 * g2(front - 0.5, 0.25) : 0) - 0.5 * g2(az - 2.6, 0.5) * smooth(eye[0] - 4.5, eye[0] - 2.5, x);
      const scalp = smooth(line - 0.1, line + 0.45, y) * (1 - g2(az - 3.0, 0.45) * smooth(eye[1] + 0.6, eye[1] - 0.6, y));
      const clump = 0.5 + 0.5 * fbm3(x * 1.6, y * 1.6, z * 1.6, 3), strands = 0.5 + 0.5 * pnoise(x * 6, y * 14, z * 6);
      const bald = smooth(0.62, 0.48, fbm3(x * 0.35 + 9, y * 0.35, z * 0.35, 2) + 0.5);
      hk = Math.max(hk, scalp * smooth(0.35, 0.6, clump * 0.7 + strands * 0.4) * (0.35 + 0.65 * bald));
      c = mixc(c, mulc(c, [0.8, 0.78, 0.76]), scalp * 0.3);
      hgt += scalp * strands * 0.01;
    }
    // ---- nails: grey-yellow, dirty under the tips, glossy ----
    let nail = 0;
    if (isHand) {
      const reach = ((b === B.HAND_L ? wristL[1] : wristR[1]) - y) / (b === B.HAND_L ? reachL : reachR);
      const side = b === B.HAND_L ? -1 : 1;
      const dors = nz * side;                     // the backs of the fingers face out
      nail = smooth(0.84, 0.9, reach) * smooth(0.15, 0.55, dors);
      // knuckle creases
      const kn = smooth(0.35, 0.55, reach) * smooth(0.75, 0.6, reach) * smooth(0.0, 0.5, dors);
      hgt -= kn * smooth(0.55, 0.9, Math.sin(reach * 60) * 0.5 + 0.5) * 0.02;
      c = mixc(c, mulc(c, DIRT.map((v) => v * 2.5)), smooth(0.7, 1.0, reach) * 0.5);
    }
    if (isFoot) nail = smooth(toeX - 0.9, toeX - 0.5, x) * smooth(0.2, 0.6, ny);
    if (nail > 0) {
      c = mixc(c, col.nail.map((v) => v * (0.85 + m3 * 0.2)), nail * 0.85);
      r = mix(r, 0.32, nail);
      hgt += nail * 0.02;
    }
    // ---- nipples and the navel ----
    if (b === B.CHEST && x > 1) for (const sz of [-1, 1]) {
      const d = Math.hypot(y - (J.UARM_L[1] - 5.6), z - sz * 2.6);
      c = mixc(c, mulc(c, NIPPLE.map((v) => v * 2)), smooth(0.75, 0.45, d) * 0.6);
    }
    // ---- scrapes on the knees, the elbows and the knuckles (dragged along the road) ----
    let scrape = 0;
    if (isLeg) scrape = g2(y - J.SHIN_L[1], 1.6) * smooth(J.SHIN_L[0] + 0.5, J.SHIN_L[0] + 2.0, x);
    if (isArm) scrape = g2(y - J.FARM_L[1], 1.4) * smooth(J.FARM_L[0] - 0.5, J.FARM_L[0] - 2.0, x);
    if (scrape > 0) {
      const sc = scrape * smooth(0.45, 0.7, 0.5 + fbm3(x * 2, y * 0.6, z * 2, 3));
      c = mixc(c, mixc(RAW, BLOOD_OLD, 0.5 + 0.5 * m3), sc * 0.8);
      hgt -= sc * 0.02; r = mix(r, 0.7, sc);
    }
    // ---- slipped skin: the epidermis gone in ragged sheets, raw moist dermis under it ----
    if (S.slip > 0) {
      const sl = fbm3(x * 0.3 + 70, y * 0.3, z * 0.3, 4) + 0.2 * pnoise(x * 3, y * 3, z * 3);
      const edge = 0.42 - S.slip * 0.2;
      const raw = smooth(edge, edge + 0.04, sl) * (isHead ? 0.5 : 1);
      const rim = g2(sl - edge, 0.02);
      c = mixc(c, mixc(RAW, mulc(RAW, [0.7, 0.55, 0.5]), 0.5 + m3 * 0.5), raw * 0.85);
      c = mixc(c, mulc(c, [1.25, 1.2, 1.05]), rim * 0.6);
      hgt -= raw * 0.03; hgt += rim * 0.015;
      wet = Math.max(wet, raw * (S.wet ?? 0.2));
      r = mix(r, 0.48, raw);
    }
    // ---- cracks: dried, leathery skin split into plates ----
    if (S.crack > 0) {
      const cr = cell3(x * 0.9 + 5, y * 0.9, z * 0.9 - 3);
      const ck = smooth(0.12, 0.03, Math.abs(cr - 0.55)) * S.crack * (0.4 + 0.6 * clamp01(0.5 + m1));
      c = mixc(c, mulc(c, [0.45, 0.35, 0.3]), ck * 0.7);
      hgt -= ck * 0.035;
    }
    // ---- per set extras ----
    if (S.stretch) {
      // stretch marks round the swollen belly and the flanks
      const zone = g2(y - (J.SPINE[1] - 1), 5) * (b === B.SPINE || b === B.HIPS || b === B.CHEST ? 1 : 0);
      const st = smooth(0.7, 0.95, Math.sin((y + pnoise(x * 0.6, z * 0.6, 0) * 1.2) * 4.5 + az * 0.9) * 0.5 + 0.5) * zone;
      c = mixc(c, mulc(c, [1.18, 0.95, 1.05]), st * 0.5);
      hgt -= st * 0.015; r = mix(r, 0.35, zone * 0.5);
    }
    if (S.blister) {
      const bc = cell3(x * 0.8, y * 0.8, z * 0.8 + 4), bk = smooth(0.32, 0.2, bc) * smooth(0.55, 0.7, 0.5 + m1);
      c = mixc(c, [0.42, 0.42, 0.18], bk * 0.6);
      hgt += bk * 0.06; wet = Math.max(wet, bk * 0.7);
    }
    if (S.acid) {
      // chemical burns from what it brings up: the chin, the throat, down the chest
      const zone = (isHead ? g2(y - (mouthY - 1), 1.6) : b === B.NECK ? 1 : b === B.CHEST ? smooth(J.CHEST[1] + 3, J.UARM_L[1] + 2, y) : 0) * smooth(-1, 1.5, x);
      const ak = smooth(0.4, 0.62, 0.5 + fbm3(x * 0.8 + 3, y * 0.5, z * 0.8, 3)) * zone;
      c = mixc(c, mixc(ACID, RAW, 0.4 + 0.3 * m3), ak * 0.75);
      hgt -= ak * 0.03; wet = Math.max(wet, ak * 0.6); r = mix(r, 0.4, ak);
    }
    if (S.scars) {
      // old keloid scars: raised, pale, shiny lines
      const sr = ridge3(x * 0.18 + 2, y * 0.12, z * 0.18 - 4, 1);
      const sk = smooth(0.9, 0.97, sr) * (isHead ? 0.4 : 1);
      c = mixc(c, SCAR, sk * 0.7);
      hgt += sk * 0.05; r = mix(r, 0.38, sk);
    }
    if (S.ulcer) {
      const uc = cell3(x * 0.5 + 8, y * 0.5, z * 0.5), uk = smooth(0.3, 0.18, uc) * smooth(0.5, 0.65, 0.5 + m1 * 0.8);
      c = mixc(c, mixc(RAW, [0.3, 0.12, 0.05], 0.4), uk * 0.85);
      hgt -= uk * 0.05; wet = Math.max(wet, uk * 0.6); r = mix(r, 0.4, uk);
    }
    // ---- dirt: on the feet, the shins, the hands, worked into the creases ----
    const dz = (isFoot ? 0.9 : isLeg ? smooth(J.SHIN_L[1] + 3, 3, y) * 0.6 : isHand ? 0.4 : 0.08) * smooth(0.4, 0.65, 0.5 + fbm3(x * 0.7 + 30, y * 0.7, z * 0.7, 3));
    c = mixc(c, mulc(c, DIRT.map((v) => v * 2.2)), clamp01(dz) * 0.7);
    r = mix(r, 0.85, clamp01(dz) * 0.5);
    r = mix(r, 0.3, wet);
    // occlusion: the body's (vertex) and the paint's own creases
    const occ = R.ao[s];
    alb.r[i] = c[0]; alb.g[i] = c[1]; alb.b[i] = c[2];
    h[i] = hgt;
    rough[i] = clamp01(r);
    ao[i] = clamp01(0.35 + 0.65 * occ);
    hair[i] = clamp01(hk);
  }
  // normals from the height in model units (each texel's footprint on the body: no island looks flatter)
  const nxa = new Float32Array(n), nya = new Float32Array(n);
  const P = (k) => (cover[k] ? k : near[k] >= 0 ? near[k] : k);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, s = P(i);
    const l = P(y * N + Math.max(0, x - 1)), rr = P(y * N + Math.min(N - 1, x + 1)), d = P(Math.max(0, y - 1) * N + x), u = P(Math.min(N - 1, y + 1) * N + x);
    const du = Math.hypot(pos[rr * 3] - pos[l * 3], pos[rr * 3 + 1] - pos[l * 3 + 1], pos[rr * 3 + 2] - pos[l * 3 + 2]) || 1e-3;
    const dv = Math.hypot(pos[u * 3] - pos[d * 3], pos[u * 3 + 1] - pos[d * 3 + 1], pos[u * 3 + 2] - pos[d * 3 + 2]) || 1e-3;
    let gx = (h[rr] - h[l]) / du, gy = (h[u] - h[d]) / dv;
    if (s !== i) { gx = 0; gy = 0; }
    const k = 1 / Math.hypot(gx, gy, 1);
    nxa[i] = -gx * k; nya[i] = -gy * k;
  }
  // (padding copies the island's normals too)
  for (let i = 0; i < n; i++) if (!cover[i] && near[i] >= 0) { nxa[i] = nxa[near[i]]; nya[i] = nya[near[i]]; }
  return { alb, nx: nxa, ny: nya, rough, ao, b: hair, wrap: false };
}
