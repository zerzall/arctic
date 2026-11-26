// The zombies' body atlases (scripts/bake-zombies.js): skin painted in the MakeHuman UV layout from the
// body itself. Every texel knows where it is on the body (the posed full-resolution mesh rasterised
// into UV space: rest-pose position, normal, bone, ambient occlusion), so the paint follows anatomy
// and reads at a distance as well as up close: three skin tones blotched at the body's scale with a
// strong value breakup, marbling (the rotting veins' dark web), veins under thin skin, livor where the
// blood settled (the back, the backs of the legs, the hands and feet), bruises, sores and lesions,
// scrapes on the knees, elbows and knuckles, dirt in patches and runs and worked into every crease,
// old blood smeared on the hands and arms, slipped skin and leathery cracks on the long dead; the
// face's sunken, near-black sockets, red-rimmed lids, cracked lips, crusted nostrils and the blood run
// from the mouth; nails, palms, soles, the navel, the folds at the joints; and per special its own
// (stretch marks, blisters, acid burns, keloid scars, ulcers, necrosis). Eight sets: three stages of
// decay (the walkers, runners and crawlers) and the five specials' own skins.
//
// Maps (as the other zombie sets, scripts/bake-zombies.js encodeSet): albedo (sRGB), normal (tangent
// space in the UV frame, x along +u, y along +v), pack R roughness · G ambient occlusion (the body's,
// times the paint's creases) · B the hair's rank (paintBody: the shader keeps the hair where the rank
// is over the zombie's own threshold and tints it with its hair colour).

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

/** Cellular noise with the nearest cell's own random value: out.d (F1 distance), out.id (0..1). */
function cellId(x, y, z, out) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  let d = 9, id = 0;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
    const h = PERM[(PERM[(PERM[(X + i) & 255] + Y + j) & 255] + Z + k) & 255];
    const h2 = PERM[(h + 71) & 255], h3 = PERM[(h + 151) & 255];
    const dx = i + h / 255 - (x - X), dy = j + h2 / 255 - (y - Y), dz = k + h3 / 255 - (z - Z);
    const q = dx * dx + dy * dy + dz * dz;
    if (q < d) { d = q; id = PERM[(h + 37) & 255] / 255; }
  }
  out.d = Math.sqrt(d); out.id = id;
  return out;
}

/** Box blur of a field over the atlas (three passes, clamped at the edges). */
function blurField(src, N, r) {
  let a = Float32Array.from(src), b = new Float32Array(src.length);
  const inv = 1 / (2 * r + 1);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < N; y++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += a[y * N + Math.min(N - 1, Math.max(0, k))];
      for (let x = 0; x < N; x++) {
        b[y * N + x] = s * inv;
        s += a[y * N + Math.min(N - 1, x + r + 1)] - a[y * N + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < N; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += b[Math.min(N - 1, Math.max(0, k)) * N + x];
      for (let y = 0; y < N; y++) {
        a[y * N + x] = s * inv;
        s += b[Math.min(N - 1, y + r + 1) * N + x] - b[Math.max(0, y - r) * N + x];
      }
    }
  }
  return a;
}

/**
 * Per set (sRGB hex colours, multipliers as linear factors): three skin tones blended by warped
 * fields at the body's scale (tones), the strength of the mottling, marbling (rot in the veins), the
 * superficial veins, livor (settled blood: the back, the hands and feet), bruises, sores, scrapes,
 * dirt, dried blood, slipped skin, cracked leathery skin, and per type its own: stretch marks, blisters,
 * acid burns, keloid scars, ulcers and necrosis. `rough` is the dry skin's roughness (the dead are matte).
 */
export const BODY_LOOKS = {
  // turned within hours or days (the runners): grey pallor with a cold cast, waxy patches, violet livor,
  // the veins showing blue through thin skin, dark sockets, blood still bright round the mouth
  'body-fresh': { tones: ['#8e8c88', '#7b8392', '#988c7e'], third: '#8a7f8c', mottle: 0.3, marble: 0.25, marbleK: [0.62, 0.62, 0.86], veins: 0.95, veinK: [0.55, 0.58, 0.82], liv: 0.8, livK: [0.78, 0.46, 0.66], bruise: 0.75, sores: 0.12, scrape: 0.85, dirt: 0.7, blood: 0.85, slip: 0, crack: 0, rough: 0.62, wet: 0.25, sock: '#2e2430', lip: '#463844', nail: '#787686' },
  // weeks gone (walkers, crawlers): grey-green with purple-grey patches, marbled green-black, slipping
  'body-weeks': { tones: ['#7e826c', '#6c745e', '#8a7c66'], third: '#776a78', mottle: 0.36, marble: 0.95, marbleK: [0.42, 0.5, 0.3], veins: 0.55, veinK: [0.5, 0.58, 0.42], liv: 0.6, livK: [0.72, 0.5, 0.6], bruise: 0.8, sores: 0.6, scrape: 0.9, dirt: 0.85, blood: 0.6, slip: 0.45, crack: 0.12, rough: 0.7, wet: 0.4, sock: '#221c18', lip: '#352a28', nail: '#62584a' },
  // months: dried to a brown-grey leather, split into plates, dark rot patches, sheets of skin gone
  'body-months': { tones: ['#6e6352', '#5e5c4c', '#7a6a52'], third: '#4f4a44', mottle: 0.42, marble: 0.5, marbleK: [0.5, 0.44, 0.34], veins: 0.25, veinK: [0.55, 0.5, 0.42], liv: 0.4, livK: [0.72, 0.56, 0.56], bruise: 0.4, sores: 0.5, scrape: 0.7, dirt: 0.9, blood: 0.45, slip: 0.8, crack: 0.85, mould: 0.6, rough: 0.8, wet: 0.25, sock: '#18120e', lip: '#261b16', nail: '#45382a' },
  // swollen with gas: taut, green-yellow, marbled black-green, blisters, stretch marks, a wet sheen
  'body-bloater': { tones: ['#7f8768', '#74845c', '#8c8662'], third: '#6c6878', mottle: 0.34, marble: 1.0, marbleK: [0.38, 0.48, 0.26], veins: 0.7, veinK: [0.42, 0.52, 0.36], liv: 0.55, livK: [0.7, 0.5, 0.58], bruise: 0.5, sores: 0.6, scrape: 0.6, dirt: 0.75, blood: 0.45, slip: 0.3, crack: 0, stretch: 1, blister: 1, rough: 0.58, wet: 0.55, sock: '#221e14', lip: '#3a3226', nail: '#5e5840' },
  // sallow yellow-green, chemical burns from what it brings up (the chin, the throat, the chest)
  'body-spitter': { tones: ['#8a866a', '#8e865e', '#7a7e68'], third: '#7a6e70', mottle: 0.34, marble: 0.6, marbleK: [0.46, 0.52, 0.32], veins: 0.75, veinK: [0.48, 0.56, 0.38], liv: 0.55, livK: [0.72, 0.52, 0.56], bruise: 0.45, sores: 0.5, scrape: 0.7, dirt: 0.75, blood: 0.4, slip: 0.25, crack: 0.15, acid: 1, rough: 0.66, wet: 0.35, sock: '#221c12', lip: '#382e20', nail: '#5e5840' },
  // the brute: grey with a bruised purple-brown cast (no pink), battered and scarred, the skin split by
  // the growth in stretch marks over the shoulders, arms and chest, bulging dark veins, filthy
  // the mutation tore it open: bursts of raw, fibrous muscle where the growth outran the skin (the
  // shoulders, arms, chest, back), livid striae, a grey-green dead cast (no warm skin left), cords of
  // muscle and vein in strong relief, greasy and dry by turns
  'body-brute': { tones: ['#64675f', '#565c54', '#6a645a'], third: '#544a58', desat: 0.45, mottle: 0.5, marble: 0.4, marbleK: [0.6, 0.56, 0.56], veins: 1.0, veinK: [0.38, 0.4, 0.46], veinH: 2.6, liv: 0.75, livK: [0.66, 0.46, 0.6], bruise: 0.95, sores: 0.55, scrape: 1.0, dirt: 0.8, blood: 0.8, slip: 0.15, crack: 0.25, scars: 1, stretchArms: 1.4, split: 1, cords: 1, relief: 1.8, roughVar: 0.22, rough: 0.74, wet: 0.35, sock: '#1a1216', lip: '#2a1c22', nail: '#463e36' },
  // the screamer: starved, a bloodless blue-grey, dark veins standing out all over, bruised sockets
  'body-screamer': { tones: ['#96989c', '#868d99', '#9b948b'], third: '#8a8094', mottle: 0.3, marble: 0.3, marbleK: [0.55, 0.58, 0.82], veins: 1.0, veinK: [0.38, 0.42, 0.66], veinH: 1.2, liv: 0.6, livK: [0.74, 0.5, 0.68], bruise: 0.55, sores: 0.25, scrape: 0.7, dirt: 0.6, blood: 0.85, slip: 0.15, crack: 0.1, rough: 0.62, wet: 0.3, sock: '#1e1626', lip: '#3e3040', nail: '#7a7686' },
  // the boss: necrotic, grey-brown mottled with purple-black dead flesh, ulcers and raw muscle, split
  // (desaturated toward grey, split open far more than the brute, the bare spine's strip flayed raw,
  // the graft of the third arm stitched into the left shoulder blade)
  'body-boss': { tones: ['#5c5a52', '#4e5050', '#625a50'], third: '#403440', desat: 0.4, mottle: 0.55, marble: 0.35, marbleK: [0.6, 0.5, 0.56], veins: 0.9, veinK: [0.36, 0.34, 0.4], veinH: 2.4, liv: 0.65, livK: [0.64, 0.44, 0.56], bruise: 0.7, sores: 0.6, scrape: 0.9, dirt: 0.7, blood: 0.85, slip: 0.5, crack: 0.3, ulcer: 1, necro: 0.8, scars: 0.8, stretchArms: 1.1, split: 1.25, cords: 1.2, spineRaw: 1, graft: 1, relief: 1.8, roughVar: 0.22, rough: 0.74, wet: 0.45, sock: '#120a0c', lip: '#20121a', nail: '#3a2c26' },
};

/**
 * Paint one body set at N² → the encodeSet record (alb, nx/ny, rough, ao, b, linear: false). R from
 * raster(N). The B channel is the hair's rank, not its coverage: 0 where no hair grows, on the scalp
 * the density (thinnest on the crown and the temples, where hair goes first) times the strands and
 * clumps, the brows near 1. The runtime keeps the hair where the rank is over the zombie's own
 * threshold, so one atlas serves a full head of hair, thinning, patchy and bald (brows only).
 */
export function paintBody(name, R) {
  const S = BODY_LOOKS[name];
  const { N, pos, nrm, bone, cover, near } = R;
  const n = N * N;
  const T = S.tones.map(lin), T3 = lin(S.third);
  const SOCK = lin(S.sock), LIP = lin(S.lip), NAIL = lin(S.nail);
  const BLOOD_OLD = lin('#2a0d08'), BLOOD = lin('#4a0b08'), DIRT = [0.34, 0.29, 0.22], RAW = lin('#5e2e28'), SCAB = lin('#34170f'), PUS = lin('#7a7046');
  const SCAR = lin('#8a7474'), ACID = lin('#7e8c2a'), NIPPLE = [0.72, 0.56, 0.58], MOULD = lin('#9a9a86'), NECRO = lin('#2a1a22');
  const J = R.piv;
  const EL = J.EYE_L, ER = J.EYE_R;
  const eye = [(EL[0] + ER[0]) / 2, (EL[1] + ER[1]) / 2, Math.abs(EL[2])];
  const mouthY = eye[1] - 2.05;
  const B = { HEAD: 4, JAW: 5, UARM_L: 6, FARM_L: 7, HAND_L: 8, UARM_R: 9, FARM_R: 10, HAND_R: 11, THIGH_L: 12, SHIN_L: 13, FOOT_L: 14, THIGH_R: 15, SHIN_R: 16, FOOT_R: 17, CHEST: 2, SPINE: 1, HIPS: 0, NECK: 3 };
  // the face's front (the nose tip) and the fingertips' and toes' reach
  let noseX = -1e9;
  for (let i = 0; i < n; i++) if (cover[i] && bone[i] === B.HEAD && Math.abs(pos[i * 3 + 2]) < 0.3 && Math.abs(pos[i * 3 + 1] - (eye[1] - 1.1)) < 0.5) noseX = Math.max(noseX, pos[i * 3]);
  const wristL = J.HAND_L, wristR = J.HAND_R;
  let reachL = 0, reachR = 0, toeX = -1e9, headTop = -1e9;
  for (let i = 0; i < n; i++) {
    if (!cover[i]) continue;
    const b = bone[i], y = pos[i * 3 + 1];
    if (b === B.HAND_L) reachL = Math.max(reachL, wristL[1] - y);
    if (b === B.HAND_R) reachR = Math.max(reachR, wristR[1] - y);
    if (b === B.FOOT_L || b === B.FOOT_R) toeX = Math.max(toeX, pos[i * 3]);
    if (b === B.HEAD) headTop = Math.max(headTop, y);
  }
  // the hair's whorl (a little off the crown's centre) and the skull's centre
  const skull = [eye[0] - 2.3, eye[1] - 0.55, 0];
  const whorl = [skull[0] - 1.1, headTop - 0.35, 0.35];
  const alb = new Rgb(N), h = new Float32Array(n), rough = new Float32Array(n), ao = new Float32Array(n), hair = new Float32Array(n);
  const dirtK = new Float32Array(n);    // how much the creases collect dirt here (second pass)
  const cid = { d: 0, id: 0 }, cid2 = { d: 0, id: 0 };
  for (let i = 0; i < n; i++) {
    if (!cover[i]) continue;
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
    const b = bone[i], az = Math.abs(z);
    const isHead = b === B.HEAD || b === B.JAW;
    const isHand = b === B.HAND_L || b === B.HAND_R, isFoot = b === B.FOOT_L || b === B.FOOT_R;
    const isArm = b === B.UARM_L || b === B.UARM_R || b === B.FARM_L || b === B.FARM_R;
    const isFarm = b === B.FARM_L || b === B.FARM_R;
    const isLeg = b === B.THIGH_L || b === B.THIGH_R || b === B.SHIN_L || b === B.SHIN_R;
    const isTrunk = b === B.CHEST || b === B.SPINE || b === B.HIPS;
    // ---- the fields every layer shares: blotches at the body's scale, at a hand's, at a finger's ----
    const L1 = fbm3(x * 0.055 + 3.1, y * 0.055, z * 0.055 - 1.7, 3);
    const L2 = fbm3(x * 0.17 - 4.3, y * 0.17 + 2.2, z * 0.17, 3);
    const L3 = fbm3(x * 0.52 + 9.4, y * 0.52, z * 0.52 + 5.1, 3);
    const F1 = pnoise(x * 1.9, y * 1.9, z * 1.9);
    // ---- base: three tones in warped patches, a strong multi-scale value breakup ----
    let c = mixc(T[0], T[1], smooth(-0.3, 0.3, L1 + L3 * 0.15));
    c = mixc(c, T[2], smooth(0.02, 0.42, L2 + L1 * 0.3) * 0.75);
    c = mixc(c, T3, smooth(0.18, 0.5, fbm3(x * 0.11 + 21, y * 0.11, z * 0.11, 3)) * 0.65);
    const val = 1 + (L2 * 0.55 + L3 * 0.45) * S.mottle * 1.5 + F1 * 0.05;
    c = c.map((v) => v * Math.max(0.35, val));
    if (S.desat) { const l = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722; c = mixc(c, [l, l, l], S.desat); }
    let hgt = 0, r = S.rough + L3 * 0.05 + (S.roughVar ? fbm3(x * 0.3 + 7, y * 0.3, z * 0.3 - 4, 2) * 2 * S.roughVar : 0), wet = 0, hk = 0, occ = 1, dk = isFoot ? 0.9 : isHand ? 0.8 : isLeg ? 0.45 : isArm ? 0.4 : isHead ? 0.35 : 0.3;
    // pores and grain: cells at ~2 mm, a crease network at ~6 mm (older skin creases more)
    const pore = cell3(x * 6.5, y * 6.5, z * 6.5);
    const grain = ridge3(x * 1.7, y * 1.7, z * 1.7, 2);
    hgt += smooth(0.05, 0.5, pore) * 0.014 - grain * 0.014;
    c = c.map((v) => v * (0.96 + 0.06 * smooth(0.1, 0.55, pore) - grain * 0.04));
    // ---- extremities: cyanotic, darker (fingers, toes, ears, the nose's tip) ----
    let ext = 0;
    if (isHand) { const reach = (b === B.HAND_L ? wristL[1] : wristR[1]) - y; ext = smooth(0.2, 1.0, reach / (b === B.HAND_L ? reachL : reachR)); }
    if (isFoot) ext = smooth(toeX - 4.0, toeX - 0.5, x) * 0.9 + 0.25;
    if (isHead) {
      ext = Math.max(ext, g2(az - 2.8, 0.55) * smooth(eye[0] - 1.5, eye[0] - 3.5, x) * 0.8);
      ext = Math.max(ext, g2(z, 0.35) * smooth(noseX - 0.7, noseX, x) * g2(y - (eye[1] - 1.15), 0.5) * 0.6);
    }
    c = mixc(c, mulc(c, S.livK.map((v) => v * 0.85)), ext * 0.6);
    // ---- marbling: rot in the superficial veins, a dark branching web, worst on the trunk and thighs ----
    if (S.marble > 0) {
      const mk = S.marble * (isTrunk ? 1 : isLeg || b === B.UARM_L || b === B.UARM_R ? 0.8 : b === B.NECK ? 0.7 : isHead ? 0.3 : 0.5);
      const m1 = ridge3(x * 0.2 + 5, y * 0.15, z * 0.2 - 2, 3), m2 = ridge3(x * 0.6 - 7, y * 0.48, z * 0.6, 2);
      const patch = smooth(-0.25, 0.25, L2 + 0.15);
      const marble = clamp01(smooth(0.55, 0.8, m1) * 0.85 + smooth(0.62, 0.86, m2) * 0.5) * mk * patch;
      c = mixc(c, mulc(c, S.marbleK), marble * 0.85);
      hgt += marble * 0.012;
      // the green belly (where the rot starts) and patches of it elsewhere
      const belly = g2(y - (J.SPINE[1] - 2.5), 4.5) * smooth(-0.5, 3, x) * (isTrunk ? 1 : 0);
      c = mixc(c, mulc(c, [0.7, 0.84, 0.5]), clamp01(belly * 0.6 + smooth(0.25, 0.55, L1) * 0.3) * S.marble * 0.6);
    }
    // ---- veins under thin skin (temples, throat, inner arms, the backs of hands, chest, feet), raised ----
    {
      let vk = S.veins * (isArm || isHand ? 1 : isFoot ? 0.9 : isLeg ? 0.65 : b === B.NECK ? 1.3 : isHead ? 0.25 : b === B.CHEST ? 0.7 : 0.45);
      if (isHead) vk *= 1 + g2(Math.hypot(az - 2.1, y - (eye[1] + 0.7)), 0.9) * 3;      // the temples
      if (isArm) vk *= 0.6 + 0.6 * smooth(0.2, -0.6, nz * Math.sign(z));                  // the inner arm
      const vr = ridge3(x * 0.42 + 3, y * 0.26, z * 0.42, 3);
      const vein = smooth(0.66, 0.88, vr) * vk;
      c = mixc(c, mulc(c, S.veinK), clamp01(vein) * 0.75);
      hgt += vein * 0.04 * (S.veinH || 1);
    }
    // ---- livor: settled blood in the back (the body lay on it), the buttocks, the backs of the legs ----
    {
      const back = smooth(-0.1, -0.7, nx) * (isTrunk || b === B.THIGH_L || b === B.THIGH_R || b === B.UARM_L || b === B.UARM_R ? 1 : 0.4);
      const low = isLeg || isFoot ? smooth(16, 2, y) * 0.8 : 0;
      const blot = smooth(-0.2, 0.3, L2 * 0.8 + L3 * 0.5 + 0.1);
      const liv = clamp01((back * 0.9 + low) * blot + (isHand || isFoot ? ext * 0.5 : 0)) * S.liv;
      c = mixc(c, mulc(c, S.livK), liv * 0.85);
    }
    // ---- bruises: purple-black cores going green-yellow at the edges ----
    {
      const bz = fbm3(x * 0.21 + 40, y * 0.21, z * 0.21, 3);
      const bw = S.bruise * (isArm || isLeg || isHand ? 1 : isHead ? 0.55 : 0.7);
      const br = smooth(0.24, 0.48, bz) * bw;
      const core = smooth(0.32, 0.5, bz);
      const col = mixc([0.82, 0.86, 0.5], [0.52, 0.36, 0.56], core);
      c = mixc(c, mulc(c, col), br * 0.8);
      hgt += br * 0.006;
    }
    // ---- the face ----
    if (isHead) {
      for (const E of [EL, ER]) {
        const d = Math.hypot((y - E[1]) * 1.2, (z - E[2]) * 0.95, Math.max(0, E[0] - 0.3 - x) * 0.6);
        // sunken sockets: a bruised, near-black ring round the eye; red-rimmed wet lids; bags under it
        const ring = smooth(1.9, 0.55, d);
        c = mixc(c, mulc(c, SOCK.map((v) => v * 3.2)), ring * 0.82);
        occ *= 1 - ring * 0.45;
        const lid = g2(d - 0.55, 0.13) * smooth(E[0] - 0.6, E[0] + 0.2, x);
        c = mixc(c, mulc(c, [1.3, 0.5, 0.5]), lid * 0.55);
        hgt -= ring * 0.045;
        wet = Math.max(wet, lid * 0.5);
        const bag = g2(y - (E[1] - 0.95), 0.32) * g2(z - E[2], 0.75) * smooth(E[0] - 1.4, E[0] - 0.2, x);
        c = mixc(c, mulc(c, [0.62, 0.52, 0.6]), bag * 0.6);
        hgt += bag * 0.02 - g2(y - (E[1] - 1.3), 0.12) * g2(z - E[2], 0.7) * 0.02;
        // crow's feet
        const cf = g2(d - 1.15, 0.35) * smooth(0.3, 1.0, az - Math.abs(E[2]) + 0.4);
        hgt -= cf * Math.max(0, Math.sin(Math.atan2(y - E[1], az - Math.abs(E[2])) * 9)) * 0.022;
      }
      // the brows: sparse, ragged hair over the brow ridge (they outlast the scalp: a rank near 1)
      const browY = eye[1] + 0.68 + 0.12 * g2(az - 1.0, 0.5) - 0.18 * smooth(1.1, 1.8, az);
      const brow = g2(y - browY, 0.17) * smooth(0.15, 0.4, az) * smooth(1.95, 1.5, az) * smooth(eye[0] - 0.5, eye[0] + 0.3, x);
      const bs = smooth(0.3, 0.6, 0.5 + pnoise(x * 9, y * 26, z * 9) * 0.7);
      if (brow * bs > 0.15) hk = Math.max(hk, (0.9 + 0.09 * bs) * smooth(0.15, 0.45, brow * bs));
      // forehead creases, the folds from the nose to the mouth
      const fh = smooth(eye[1] + 1.0, eye[1] + 1.4, y) * smooth(eye[1] + 2.7, eye[1] + 2.1, y) * smooth(eye[0] - 0.4, eye[0] + 0.3, x) * smooth(2.0, 1.2, az);
      hgt -= fh * smooth(0.55, 0.95, Math.sin(y * 6.5 + pnoise(z, y, 0) * 1.5) * 0.5 + 0.5) * 0.03;
      const nlT = clamp01((eye[1] - 1.45 - y) / 1.0);
      const nl = g2(az - (0.55 + nlT * 0.45), 0.09) * (nlT > 0 && nlT < 1 ? 1 : 0) * smooth(noseX - 2.2, noseX - 1.2, x);
      hgt -= nl * 0.035; occ *= 1 - nl * 0.3;
      // the cheeks sunk under the cheekbones
      const hollow = g2(y - (eye[1] - 1.55), 0.55) * g2(az - (eye[2] + 0.45), 0.6) * smooth(eye[0] - 2.4, eye[0] - 0.8, x);
      c = mixc(c, mulc(c, [0.72, 0.68, 0.7]), hollow * 0.5);
      // lips: shrunk back, dark, cracked
      const lip = g2(y - mouthY, 0.33) * g2(z, 0.95) * smooth(noseX - 1.6, noseX - 0.8, x);
      c = mixc(c, LIP.map((v) => v * (0.85 + 0.25 * L3)), lip * 0.88);
      hgt -= lip * smooth(0.65, 0.95, Math.abs(Math.sin(z * 18 + pnoise(z * 4, y * 4, 0) * 2))) * 0.025;
      r = mix(r, 0.5, lip);
      // the nostrils and the mouth's corners: dark, crusted with dried blood; a run of it down the chin
      const corner = g2(y - (mouthY - 0.15), 0.5) * g2(az - 0.85, 0.35) * smooth(noseX - 2.0, noseX - 1.0, x);
      const nostril = g2(y - (eye[1] - 1.55), 0.25) * g2(az - 0.32, 0.22) * smooth(noseX - 1.0, noseX - 0.4, x);
      c = mixc(c, mulc(c, [0.35, 0.28, 0.28]), nostril * 0.8);
      occ *= 1 - nostril * 0.5;
      const run = g2(z - pnoise(y * 0.5, 3, 0) * 0.6, 0.55 + 0.2 * pnoise(y * 2, 0, 1)) * smooth(mouthY, mouthY - 0.3, y) * smooth(noseX - 1.6, noseX - 0.6, x);
      const nrun = g2(z * 1.3 - 0.3 * pnoise(y, 5, 0), 0.4) * smooth(eye[1] - 1.5, eye[1] - 1.9, y) * smooth(mouthY - 0.2, mouthY + 0.3, y) * smooth(noseX - 1.3, noseX - 0.4, x);
      const bl = clamp01(corner * 0.9 + nostril + run * 0.85 + nrun * 0.6) * S.blood;
      const bm = smooth(0.15, 0.45, bl + L3 * 0.15);
      c = mixc(c, mixc(BLOOD_OLD, BLOOD, 0.3 + 0.3 * F1), bm * 0.92);
      hgt += smooth(0.2, 0.5, bl) * 0.012; r = mix(r, 0.55, bm);
      // the ears: dark in their folds
      const ear = g2(az - 2.9, 0.45) * smooth(eye[0] - 2.0, eye[0] - 3.2, x) * g2(y - (eye[1] - 0.4), 1.4);
      occ *= 1 - ear * 0.35;
      // ---- the scalp: hair combed out from the whorl, in clumps of strands, thinning in the
      // places hair goes first (the crown and the temples); its rank goes to the B channel ----
      const front = smooth(eye[0] - 2.4, eye[0] - 0.8, x);
      const line = mix(eye[1] - 2.1, eye[1] + 1.9, front) + (front > 0.1 && front < 0.9 ? 0.6 * g2(front - 0.5, 0.25) : 0) - 0.5 * g2(az - 2.6, 0.5) * smooth(eye[0] - 4.5, eye[0] - 2.5, x)
        + 0.25 * pnoise(x * 2.2, z * 2.2, 3.3);
      const scalp = smooth(line - 0.15, line + 0.35, y) * (1 - g2(az - 3.0, 0.45) * smooth(eye[1] + 0.6, eye[1] - 0.6, y));
      if (scalp > 0.001) {
        const vx = x - whorl[0], vy = y - whorl[1], vz = z - whorl[2];
        const hl = Math.hypot(vx, vz) || 1e-3, dist = Math.hypot(vx, vy, vz);
        // azimuth round the whorl (strands run along lines of constant azimuth), waved a little
        const wv = pnoise(vx / hl * 1.3 + 4, vz / hl * 1.3, dist * 0.45) * 0.28;
        const ca = vx / hl * Math.cos(wv) - vz / hl * Math.sin(wv), sa = vx / hl * Math.sin(wv) + vz / hl * Math.cos(wv);
        const clump = pnoise(ca * 7.5 + 11, sa * 7.5, dist * 0.32 + 2.5);
        const strand = pnoise(ca * 34 + 3, sa * 34, dist * 0.75 + 7.5);
        const sv = clamp01(0.5 + clump * 0.75 + strand * 0.45);
        // where hair goes first: the crown and the top of the head, the temples
        const top = smooth(eye[1] + 1.2, eye[1] + 3.4, y) * smooth(eye[0] - 4.6, eye[0] - 1.6, x);
        const temple = g2(az - 2.0, 0.6) * smooth(eye[0] - 2.8, eye[0] - 0.8, x) * g2(y - (eye[1] + 2.0), 1.1);
        const dens = clamp01(1 - 0.36 * top - 0.32 * temple + 0.08 * L3);
        const fringe = smooth(line - 0.1, line + 0.9, y);
        hk = Math.max(hk, scalp * dens * (0.28 + 0.72 * sv) * (0.5 + 0.5 * fringe));
        // the scalp itself: paler, greasy, a little relief from the hair lying on it
        c = mixc(c, mulc(c, [0.82, 0.8, 0.78]), scalp * 0.35);
        hgt += scalp * (clump * 0.006 + strand * 0.004);
      }
      // the beard: a low band of the rank (0.06 .. 0.2), which the shader shows on the bearded and as
      // a shadow of stubble on the other men: the jaw and under it, the chin, the upper lip, the
      // cheeks below the bone, up the sideburns to the ear (not the lips)
      {
        const top = mix(eye[1] + 0.2, eye[1] - 1.45, smooth(eye[0] - 3.1, eye[0] - 1.1, x));
        const reg = smooth(top + 0.25, top - 0.2, y) * smooth(eye[1] - 4.9, eye[1] - 4.1, y) * smooth(eye[0] - 3.6, eye[0] - 3.0, x) * smooth(3.1, 2.6, az) * (1 - smooth(0.25, 0.6, lip));
        if (reg > 0.02 && hk < 0.25) {
          const stub = 0.5 + 0.5 * pnoise(x * 16 + 2, y * 16, z * 16);
          hk = Math.max(hk, reg * (0.07 + 0.13 * stub));
        }
      }
    }
    // ---- nails: grey-yellow, dirty under the tips; the fingertips gone dark ----
    let nail = 0;
    if (isHand) {
      const reach = ((b === B.HAND_L ? wristL[1] : wristR[1]) - y) / (b === B.HAND_L ? reachL : reachR);
      const side = b === B.HAND_L ? -1 : 1;
      const dors = nz * side;                     // the backs of the fingers face out
      nail = smooth(0.84, 0.9, reach) * smooth(0.15, 0.55, dors);
      // knuckle creases and the palm's lines
      const kn = smooth(0.35, 0.55, reach) * smooth(0.75, 0.6, reach) * smooth(0.0, 0.5, dors);
      hgt -= kn * smooth(0.55, 0.9, Math.sin(reach * 60) * 0.5 + 0.5) * 0.024;
      const palm = smooth(0.0, -0.5, dors) * smooth(0.1, 0.4, reach) * smooth(0.7, 0.5, reach);
      hgt -= palm * smooth(0.82, 0.96, ridge3(x * 1.4, y * 1.4, z * 1.4, 1)) * 0.02;
      // grime: black in the creases, under the nails, on the palms and fingertips
      c = mixc(c, mulc(c, DIRT), smooth(0.65, 1.0, reach) * 0.65 + palm * 0.35);
      dk = 1;
    }
    if (isFoot) {
      nail = smooth(toeX - 0.9, toeX - 0.5, x) * smooth(0.2, 0.6, ny);
      // the soles: black with the road
      const sole = smooth(-0.3, -0.75, ny);
      c = mixc(c, mulc(c, [0.25, 0.22, 0.18]), sole * 0.85);
      r = mix(r, 0.92, sole);
    }
    if (nail > 0) {
      c = mixc(c, NAIL.map((v) => v * (0.85 + F1 * 0.2)), nail * 0.85);
      r = mix(r, 0.4, nail);
      hgt += nail * 0.02;
    }
    // ---- nipples and the navel ----
    if (b === B.CHEST && x > 1) for (const sz of [-1, 1]) {
      const d = Math.hypot(y - (J.UARM_L[1] - 5.6), z - sz * 2.6);
      c = mixc(c, mulc(c, NIPPLE), smooth(0.8, 0.4, d) * 0.7);
      hgt += smooth(0.35, 0.1, d) * 0.03;
    }
    if (isTrunk && x > 0) {
      const nv = Math.hypot(y - (J.SPINE[1] - 3.2), z * 1.3);
      occ *= 1 - smooth(0.45, 0.1, nv) * 0.6;
      hgt -= smooth(0.45, 0.05, nv) * 0.06;
    }
    // ---- joints: folds at the elbow's crook, the back of the knee, the neck's rings, the armpits ----
    if (b === B.NECK || (isHead && y < mouthY - 0.6)) {
      const ringN = smooth(0.62, 0.95, Math.sin(y * 4.2 + pnoise(x, z, 4) * 0.8) * 0.5 + 0.5) * smooth(-0.3, 0.5, nx);
      hgt -= ringN * 0.022; occ *= 1 - ringN * 0.12;
    }
    if (isLeg) {
      const kneeY = J.SHIN_L[1], kd = y - kneeY;
      const fold = g2(kd, 1.2) * smooth(J.SHIN_L[0] - 0.5, J.SHIN_L[0] - 2.0, x);
      hgt -= fold * smooth(0.6, 0.9, Math.sin(kd * 7) * 0.5 + 0.5) * 0.03; occ *= 1 - fold * 0.25;
      const kw = g2(kd, 1.3) * smooth(J.SHIN_L[0] + 0.5, J.SHIN_L[0] + 2.0, x);
      hgt -= kw * smooth(0.7, 0.95, Math.sin(kd * 9 + az * 2) * 0.5 + 0.5) * 0.02;
    }
    if (isArm) {
      const ed = y - J.FARM_L[1];
      const crook = g2(ed, 1.0) * smooth(J.FARM_L[0] + 0.3, J.FARM_L[0] + 1.6, x);
      hgt -= crook * 0.025; occ *= 1 - crook * 0.25;
      const elbow = g2(ed, 1.2) * smooth(J.FARM_L[0] - 0.4, J.FARM_L[0] - 1.8, x);
      hgt -= elbow * smooth(0.65, 0.95, Math.sin(ed * 8 + az) * 0.5 + 0.5) * 0.025;
    }
    // ---- scrapes on the knees, the elbows, the knuckles, a cheekbone (dragged along the road) ----
    {
      let scrape = 0;
      if (isLeg) scrape = g2(y - J.SHIN_L[1], 1.8) * smooth(J.SHIN_L[0] + 0.5, J.SHIN_L[0] + 2.0, x) + smooth(12, 4, y) * smooth(0.2, 0.8, nx) * 0.45;
      if (isArm) scrape = g2(y - J.FARM_L[1], 1.6) * smooth(J.FARM_L[0] - 0.5, J.FARM_L[0] - 2.0, x);
      if (isHand) scrape = 0.6 * smooth(0.2, 0.6, nz * (b === B.HAND_L ? -1 : 1));
      if (isHead) scrape = g2(y - (eye[1] - 0.8), 0.7) * g2(az - 2.2, 0.6) * smooth(eye[0] - 2.0, eye[0] - 0.4, x) * 0.7 + g2(y - (eye[1] + 1.8), 0.8) * g2(z - 0.8, 0.9) * 0.5;
      if (scrape > 0) {
        const sc = clamp01(scrape) * smooth(0.42, 0.66, 0.5 + fbm3(x * 2, y * 0.7, z * 2, 3)) * S.scrape;
        c = mixc(c, mixc(RAW, SCAB, 0.45 + 0.45 * F1), sc * 0.85);
        hgt -= sc * 0.02 - sc * smooth(0.3, 0.7, 0.5 + F1) * 0.012; r = mix(r, 0.78, sc);
      }
    }
    // ---- sores and lesions: dark scabbed cores, a yellow crust, a raised rim; some weep ----
    if (S.sores > 0) {
      cellId(x * 0.36 + 11, y * 0.36, z * 0.36 - 3, cid);
      const sel = cid.id < S.sores * (isHead ? 0.1 : 0.16);
      if (sel) {
        const rad = 0.16 + cid.id * 0.18;
        const core = smooth(rad, rad * 0.45, cid.d), rim = g2(cid.d - rad * 1.08, rad * 0.25);
        c = mixc(c, mixc(SCAB, mixc(RAW, PUS, 0.3), smooth(0.4, 0.8, F1 + 0.5) * 0.6), core * 0.92);
        c = mixc(c, mulc(c, [1.05, 0.96, 0.62]), rim * 0.55);
        hgt += rim * 0.035 - core * 0.025;
        wet = Math.max(wet, core * (cid.id < S.sores * 0.3 ? 0.75 : 0.15));
        r = mix(r, 0.6, core);
      }
    }
    // ---- slipped skin: the epidermis gone in ragged sheets, moist dermis under it, white rims ----
    if (S.slip > 0) {
      const sl = fbm3(x * 0.3 + 70, y * 0.3, z * 0.3, 4) + 0.2 * pnoise(x * 3, y * 3, z * 3);
      const edge = 0.46 - S.slip * 0.24;
      const raw = smooth(edge, edge + 0.04, sl) * (isHead ? 0.45 : 1) * smooth(0, 0.3, S.slip);
      const rim = g2(sl - edge, 0.02);
      c = mixc(c, mixc(RAW, mulc(RAW, [0.62, 0.5, 0.46]), 0.5 + F1 * 0.5), raw * 0.85);
      c = mixc(c, mulc(c, [1.3, 1.25, 1.1]), rim * 0.65);
      hgt -= raw * 0.035; hgt += rim * 0.018;
      wet = Math.max(wet, raw * (S.wet ?? 0.2));
      r = mix(r, 0.5, raw);
    }
    // ---- cracks: dried, leathery skin split into plates ----
    if (S.crack > 0) {
      const cr = cell3(x * 0.9 + 5, y * 0.9, z * 0.9 - 3);
      const ck = smooth(0.12, 0.03, Math.abs(cr - 0.55)) * S.crack * (0.4 + 0.6 * clamp01(0.5 + L1));
      c = mixc(c, mulc(c, [0.42, 0.33, 0.28]), ck * 0.75);
      hgt -= ck * 0.04; occ *= 1 - ck * 0.3;
      r = mix(r, 0.9, ck * 0.5);
    }
    if (S.mould > 0) {
      const mo = smooth(0.62, 0.78, 0.5 + fbm3(x * 0.8 + 33, y * 0.8, z * 0.8, 3) * 0.8) * smooth(-0.2, 0.3, L2) * S.mould;
      c = mixc(c, mixc(c, MOULD, 0.6), mo * smooth(0.3, 0.7, 0.5 + F1));
      hgt += mo * 0.01; r = mix(r, 0.92, mo);
    }
    // ---- per set extras ----
    if (S.stretch) {
      // stretch marks round the swollen belly, the flanks and the thighs
      const zone = (isTrunk ? g2(y - (J.SPINE[1] - 1), 5.5) : b === B.THIGH_L || b === B.THIGH_R ? smooth(J.SHIN_L[1] + 4, J.THIGH_L[1] - 2, y) * 0.7 : 0);
      const st = smooth(0.72, 0.95, Math.sin((y + pnoise(x * 0.6, z * 0.6, 0) * 1.2) * 4.5 + az * 0.9) * 0.5 + 0.5) * zone;
      c = mixc(c, mulc(c, [1.15, 0.92, 1.08]), st * 0.6);
      hgt -= st * 0.018;
    }
    if (S.stretchArms) {
      // the brute's growth split its skin over the shoulders, the biceps, the chest and the armpits
      const zone = (b === B.UARM_L || b === B.UARM_R ? 1 : b === B.CHEST ? smooth(3.5, 6.5, az) * smooth(J.CHEST[1], J.UARM_L[1], y) : 0);
      const zone2 = zone + (S.stretchArms > 1 ? (b === B.THIGH_L || b === B.THIGH_R ? 0.6 : isTrunk ? smooth(2.5, 5, az) * 0.8 : 0) : 0);
      const seg = smooth(-0.1, 0.25, pnoise(x * 0.9 + 3, y * 0.35, z * 0.9));
      const st = smooth(0.74, 0.95, Math.sin((x * 0.4 + y + pnoise(x * 0.5, z * 0.5, 2) * 1.4) * 3.6 + az * 0.3) * 0.5 + 0.5) * Math.min(1, zone2) * seg;
      // (fresh striae livid purple-red, the old ones silvered and sunk)
      const old = smooth(-0.2, 0.3, pnoise(x * 0.3, y * 0.3 + 9, z * 0.3));
      c = mixc(c, mixc(mulc(c, [1.05, 0.62, 0.78]), mulc(c, [1.25, 1.2, 1.18]), old), st * Math.min(1, 0.55 * S.stretchArms));
      hgt -= st * 0.026;
      r = mix(r, 0.5, st * old * 0.5);
    }
    // ---- muscle cords under the skin: long ridges down the limbs and over the trunk ----
    if (S.cords && !isHead && !isHand && !isFoot) {
      const cr = ridge3(x * 0.42 + 13, y * 0.1, z * 0.42 - 6, 2);
      const ck = smooth(0.5, 0.92, cr) * S.cords * (isArm ? 1 : isLeg ? 0.8 : 0.6);
      hgt += ck * 0.035;
      c = mixc(c, mulc(c, [0.8, 0.78, 0.8]), (1 - ck) * smooth(0.3, 0.5, cr) * 0.25 * S.cords);
    }
    // ---- the skin split by the mutation: raw, fibrous muscle under torn edges (a thin yellow layer of
    // fat at the edge, the skin curled back, a bruised halo, dried blood run down from each split) ----
    const muscle = (f, deep) => {
      let m = mixc(lin('#4e1813'), lin('#7a3026'), 0.5 + 0.5 * f);
      m = m.map((v) => v * (0.82 + 0.3 * L3) * (1 - deep * 0.35));
      const fas = smooth(0.86, 0.97, ridge3(x * 0.8 + 2, y * 0.3, z * 0.8, 2));
      return mixc(m, lin('#8e7f6c'), fas * 0.45);
    };
    if (S.split && !isHead && !isHand && !isFoot) {
      const back = isTrunk ? smooth(-0.1, -0.6, nx) : 0;
      const zone = b === B.UARM_L || b === B.UARM_R ? 1 : isFarm ? 0.55 : b === B.CHEST ? Math.max(back * 0.85, smooth(J.CHEST[1], J.UARM_L[1], y) * (0.45 + 0.55 * smooth(2, 5, az))) : b === B.NECK ? 0.45 : b === B.SPINE ? Math.max(0.3, back * 0.6) : b === B.THIGH_L || b === B.THIGH_R ? 0.5 : isLeg ? 0.25 : 0.2;
      const field = (yy) => fbm3(x * 0.2 + 91, yy * 0.075, z * 0.2 - 13, 3) + 0.12 * pnoise(x * 1.4, yy * 0.6, z * 1.4);
      const tear = field(y), edge = 0.37 - 0.17 * S.split * zone;
      const raw = smooth(edge, edge + 0.025, tear);
      const f = Math.sin((isTrunk ? (y + az * 0.45) : (x * 0.8 + z)) * 9 + pnoise(x * 2, y * 0.4, z * 2) * 3);
      if (raw > 0) {
        const deep = smooth(edge + 0.03, edge + 0.14, tear);
        c = mixc(c, muscle(f, deep), raw);
        c = mixc(c, lin('#a08c58'), g2(tear - (edge + 0.014), 0.008) * 0.75);
        hgt += raw * (-0.06 + (0.5 + 0.5 * f) * 0.02);
        wet = Math.max(wet, raw * (0.55 + 0.3 * deep));
        r = mix(r, 0.3 + 0.2 * (0.5 - 0.5 * f), raw);
      }
      const halo = smooth(edge - 0.11, edge, tear) * (1 - raw);
      c = mixc(c, mulc(c, [0.56, 0.36, 0.42]), halo * 0.7);
      hgt += g2(tear - (edge - 0.012), 0.012) * 0.05;          // the torn skin curled back
      if (raw < 0.5 && zone > 0.1) {
        let above = 0;
        for (const d of [0.9, 2.0, 3.4]) above = Math.max(above, smooth(edge, edge + 0.03, field(y + d)) * (1 - d / 4.5));
        const runs = smooth(0.52, 0.72, 0.5 + pnoise(x * 2.4 + 5, y * 0.12, z * 2.4) * 0.9);
        const bl = above * runs * (1 - raw);
        c = mixc(c, mixc(BLOOD_OLD, BLOOD, 0.3 + 0.2 * F1), bl * 0.9);
        hgt += bl * 0.008; r = mix(r, 0.55, bl);
      }
    }
    // the boss: the strip down the back flayed raw round the bared spine
    if (S.spineRaw && (isTrunk || b === B.NECK) && nx < -0.2) {
      const wdt = 2.4 + 0.6 * pnoise(y * 0.5, 4, 1) + 0.3 * pnoise(y * 2.5, z, 2);
      const sp = smooth(wdt + 0.15, wdt - 0.15, az) * smooth(J.SPINE[1] - 3, J.SPINE[1] - 1, y) * smooth(-0.2, -0.5, nx);
      if (sp > 0) {
        const f = Math.sin((az * 0.5 + y) * 8 + pnoise(x * 2, y, z * 2) * 2.5);
        c = mixc(c, muscle(f, smooth(1.5, 0.3, az)), sp);
        hgt -= sp * 0.05; wet = Math.max(wet, sp * 0.75); r = mix(r, 0.3, sp);
      }
      const rim = g2(az - wdt - 0.25, 0.25) * smooth(J.SPINE[1] - 3, J.SPINE[1] - 1, y) * smooth(-0.2, -0.5, nx);
      c = mixc(c, mulc(c, [0.5, 0.3, 0.32]), rim * 0.7); hgt += rim * 0.04;
    }
    // the boss: the third arm's graft, stitched into the left shoulder blade (a raw seam, crude stitches)
    if (S.graft && b === B.CHEST && nx < 0) {
      const gz = J.UARM_L[2] * 0.62, gy = J.UARM_L[1] - 3;
      const d = Math.hypot(y - gy, z - gz), ang = Math.atan2(y - gy, z - gz);
      const seam = g2(d - 2.6, 0.32) * smooth(0, -0.4, nx);
      const inside = smooth(2.5, 1.9, d) * smooth(0, -0.4, nx);
      c = mixc(c, muscle(Math.sin(ang * 5 + d * 3), 0.4), inside * 0.9);
      c = mixc(c, mixc(RAW, SCAB, 0.6), seam * 0.85);
      const stitch = g2(d - 2.6, 0.7) * smooth(0.55, 0.85, Math.sin(ang * 16) * 0.5 + 0.5) * smooth(0, -0.4, nx);
      c = mixc(c, [0.03, 0.025, 0.02], stitch * 0.8);
      hgt += stitch * 0.04 - seam * 0.03 - inside * 0.03; wet = Math.max(wet, inside * 0.6);
    }
    if (S.blister) {
      cellId(x * 0.8, y * 0.8, z * 0.8 + 4, cid2);
      const bk = smooth(0.32, 0.18, cid2.d) * (cid2.id < 0.35 ? 1 : 0) * smooth(0.5, 0.7, 0.5 + L1);
      c = mixc(c, [0.38, 0.38, 0.17], bk * 0.6);
      hgt += bk * 0.06; wet = Math.max(wet, bk * 0.7);
    }
    if (S.acid) {
      // chemical burns from what it brings up: the chin, the throat, down the chest
      const zone = (isHead ? g2(y - (mouthY - 1), 1.6) : b === B.NECK ? 1 : b === B.CHEST ? smooth(J.CHEST[1] + 3, J.UARM_L[1] + 2, y) : 0) * smooth(-1, 1.5, x);
      const ak = smooth(0.4, 0.62, 0.5 + fbm3(x * 0.8 + 3, y * 0.5, z * 0.8, 3)) * zone;
      c = mixc(c, mixc(ACID, RAW, 0.4 + 0.3 * F1), ak * 0.75);
      hgt -= ak * 0.03; wet = Math.max(wet, ak * 0.6); r = mix(r, 0.42, ak);
    }
    if (S.scars) {
      // old keloid scars: raised, pale, shiny lines, a few stitched
      const sr = ridge3(x * 0.18 + 2, y * 0.12, z * 0.18 - 4, 1);
      const sk = smooth(0.93, 0.98, sr) * smooth(0.05, 0.35, L1 + 0.25) * (isHead ? 0.4 : 1) * S.scars;
      c = mixc(c, SCAR, sk * 0.7);
      const stitch = sk * smooth(0.6, 0.9, Math.sin((x + y * 0.3 + z) * 9) * 0.5 + 0.5);
      c = mixc(c, mulc(c, [0.35, 0.3, 0.3]), stitch * 0.5);
      hgt += sk * 0.05; r = mix(r, 0.45, sk);
    }
    if (S.ulcer) {
      cellId(x * 0.5 + 8, y * 0.5, z * 0.5, cid2);
      const uk = smooth(0.34, 0.16, cid2.d) * (cid2.id < 0.55 ? 1 : 0) * smooth(0.45, 0.6, 0.5 + L1 * 0.8);
      c = mixc(c, mixc(RAW, [0.26, 0.1, 0.05], 0.35 + 0.3 * F1), uk * 0.9);
      c = mixc(c, mulc(c, [0.8, 0.7, 0.45]), g2(cid2.d - 0.36, 0.06) * (cid2.id < 0.55 ? 1 : 0) * 0.6);
      hgt -= uk * 0.06; wet = Math.max(wet, uk * 0.65); r = mix(r, 0.45, uk);
    }
    if (S.necro) {
      // dead flesh: purple-black patches with a bruised rim
      const nk = fbm3(x * 0.16 - 12, y * 0.16, z * 0.16 + 6, 4);
      const core = smooth(0.18, 0.34, nk), rim = smooth(0.05, 0.2, nk) * (1 - core);
      c = mixc(c, mulc(NECRO, [1 + F1 * 0.3, 1, 1]), core * 0.85);
      c = mixc(c, mulc(c, [0.7, 0.5, 0.62]), rim * 0.6);
      hgt -= core * 0.02; r = mix(r, 0.62, core);
    }
    // ---- dirt: dragged through the road, wiped hands: patches and streaks running down ----
    {
      const dn = fbm3(x * 0.24 + 30, y * 0.24, z * 0.24, 3), streak = fbm3(x * 0.7 - 2, y * 0.11, z * 0.7, 2);
      const zone = isFoot ? 0.95 : isLeg ? 0.35 + smooth(18, 4, y) * 0.55 : isHand ? 0.75 : isFarm ? 0.5 : isArm ? 0.3 : isHead ? 0.22 : 0.3;
      const front = isTrunk ? 0.7 + 0.3 * smooth(-0.3, 0.6, nx) : 1;
      const dirt = smooth(0.42, 0.72, 0.5 + dn * 0.75 + streak * 0.4 + L3 * 0.15) * zone * front * S.dirt;
      c = mixc(c, mulc(c, DIRT), clamp01(dirt) * 0.85);
      r = mix(r, 0.9, clamp01(dirt) * 0.7);
      dk *= 0.6 + S.dirt * 0.5;
      // old blood smeared on the hands, the forearms, the front of the chest
      const smear = (isHand ? 0.85 : isFarm ? 0.55 * smooth(-0.2, 0.5, nx) : b === B.CHEST ? 0.3 * smooth(0.2, 0.8, nx) : isHead ? 0.15 : 0.08) * S.blood;
      const sm = smooth(0.62, 0.78, 0.5 + fbm3(x * 0.45 + 50, y * 0.3, z * 0.45, 3) * 0.8 + F1 * 0.1) * smear;
      c = mixc(c, mixc(BLOOD_OLD, BLOOD, 0.25 + F1 * 0.2), clamp01(sm) * 0.88);
      r = mix(r, 0.62, clamp01(sm));
    }
    r = mix(r, 0.32, wet);
    alb.r[i] = c[0]; alb.g[i] = c[1]; alb.b[i] = c[2];
    h[i] = hgt * (S.relief || 1);
    rough[i] = clamp01(r);
    ao[i] = clamp01(0.22 + 0.78 * R.ao[i]) * occ;
    hair[i] = clamp01(hk);
    dirtK[i] = dk;
  }
  // padding: every texel outside the islands copies its nearest one inside (before the blurs, so the
  // islands' edges blur with their own skin)
  for (let i = 0; i < n; i++) {
    if (cover[i]) continue;
    const s = near[i];
    if (s < 0) { alb.r[i] = alb.g[i] = alb.b[i] = 0.2; rough[i] = 0.75; ao[i] = 1; continue; }
    alb.r[i] = alb.r[s]; alb.g[i] = alb.g[s]; alb.b[i] = alb.b[s];
    h[i] = h[s]; rough[i] = rough[s]; ao[i] = ao[s]; hair[i] = hair[s]; dirtK[i] = dirtK[s];
  }
  // ---- creases: grime and shadow collect where the skin dips below its surroundings ----
  {
    const hb = blurField(h, N, Math.max(1, Math.round(N / 400)));
    for (let i = 0; i < n; i++) {
      const cav = clamp01((hb[i] - h[i]) * 55 / (S.relief || 1));
      const k = cav * dirtK[i];
      alb.mul(i, [0.42, 0.37, 0.31], k * 0.85);
      ao[i] *= 1 - cav * 0.45;
      rough[i] = Math.min(1, rough[i] + k * 0.1);
    }
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
