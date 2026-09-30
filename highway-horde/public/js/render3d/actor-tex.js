// Procedural surface textures for the ACTORS (no texture files, SPEC §7.5). The pixel
// data is generated once per page (module cache of plain typed arrays, ~0.2 s in total)
// and every renderer wraps it in its own three.js textures, which its sub-systems dispose.
// Nothing GPU-side is cached at module level here, so nothing can keep a finished game's
// renderer alive (see the GPU rules in SPEC §7.5).
//
//   actorDetail  512² RGBA, tileable: R rot mottle · G fabric weave · B grime · A splatter
//   actorDetail2 512² RGBA, tileable: R vein network · G spots / sores / freckles · B blotches (rust, stains) · A cracks
//   actorNormal  512² RGBA, tileable: RG skin normal (wrinkles, pores, veins) · BA cloth normal
//   gunAtlas    1024² RGBA, 2×2 tiles (metal, polymer, wood, knurl):
//               R albedo factor · G/B normal xy · A roughness
//   vmEnv        equirect night studio for the first-person gun's reflections

import * as THREE from 'three';

const cache = new Map();

function cached(key, fn) {
  let v = cache.get(key);
  if (!v) { v = fn(); if (v && typeof v.next === 'function') v = runSync(v); cache.set(key, v); }
  return v;
}

/** Run a generator to completion. */
function runSync(gen) {
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value;
}

/**
 * Run a generator in time slices (`budget` ms of work per slice, then a macrotask break),
 * so building a big texture never freezes the page; resolves with the generator's result.
 */
export function driveAsync(gen, budget = 8) {
  return new Promise((resolve, reject) => {
    const step = () => {
      try {
        const t0 = performance.now();
        let r;
        do r = gen.next(); while (!r.done && performance.now() - t0 < budget);
        if (r.done) resolve(r.value); else setTimeout(step, 0);
      } catch (err) { reject(err); }
    };
    step();
  });
}

// ---------------------------------------------------------------------------------------
// tileable noise on the unit square

function hash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const lattices = new Map();
function lattice(px, py, seed) {
  const k = (px * 4096 + py) * 1000 + seed;
  let a = lattices.get(k);
  if (!a) {
    a = new Float32Array(px * py);
    for (let j = 0; j < py; j++) for (let i = 0; i < px; i++) a[j * px + i] = hash2(i, j, seed);
    lattices.set(k, a);
  }
  return a;
}

/**
 * Value noise 0..1 over the unit square with px × py cells (tileable; different periods
 * per axis give stretched, still seamless, streaks).
 */
function vnoiseL(L, px, py, u, v) {
  const x = u * px, y = v * py;
  let xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  xi %= px; if (xi < 0) xi += px;
  yi %= py; if (yi < 0) yi += py;
  const x1 = xi + 1 === px ? 0 : xi + 1, y1 = yi + 1 === py ? 0 : yi + 1;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = L[yi * px + xi], b = L[yi * px + x1], c = L[y1 * px + xi], d = L[y1 * px + x1];
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function vnoise(u, v, px, seed, py = px) {
  return vnoiseL(lattice(px, py, seed), px, py, u, v);
}

/** fbm with its lattices bound once (the per-pixel loops call this ~20 times). */
function makeFbm(p, oct, seed, gain = 0.5, py = p) {
  const Ls = [], PX = [], PY = [], A = [];
  let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    Ls.push(lattice(p << o, py << o, seed + o * 17)); PX.push(p << o); PY.push(py << o); A.push(amp);
    tot += amp; amp *= gain;
  }
  for (let o = 0; o < oct; o++) A[o] /= tot;
  return (u, v) => {
    let s = 0;
    for (let o = 0; o < oct; o++) s += vnoiseL(Ls[o], PX[o], PY[o], u, v) * A[o];
    return s;
  };
}
/** A single-octave value noise bound to its lattice. */
function makeVn(px, seed, py = px) {
  const L = lattice(px, py, seed);
  return (u, v) => vnoiseL(L, px, py, u, v);
}

/** Tileable Worley F1 (distance to the nearest feature point, in cell units), px × py cells. */
const features = new Map();
function worley(u, v, p, seed, py = p) {
  const key = (p * 4096 + py) * 1000 + seed;
  let F = features.get(key);
  if (!F) {
    F = new Float32Array(p * py * 2);
    for (let j = 0; j < py; j++) for (let i = 0; i < p; i++) { F[(j * p + i) * 2] = hash2(i, j, seed); F[(j * p + i) * 2 + 1] = hash2(i, j, seed + 1); }
    features.set(key, F);
  }
  const x = u * p, y = v * py;
  const xi = Math.floor(x), yi = Math.floor(y);
  let best = 9;
  for (let j = -1; j <= 1; j++) {
    const cy = yi + j;
    let wy = cy % py; if (wy < 0) wy += py;
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i;
      let wx = cx % p; if (wx < 0) wx += p;
      const o = (wy * p + wx) * 2;
      const dx = cx + F[o] - x, dy = cy + F[o + 1] - y;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Normal xy (0..255 encoded) from a wrapping height field. */
function heightToNormal(h, W, H, strength, out, off, stride) {
  for (let y = 0; y < H; y++) {
    const ym = ((y - 1 + H) % H) * W, yp = ((y + 1) % H) * W, y0 = y * W;
    for (let x = 0; x < W; x++) {
      const xm = (x - 1 + W) % W, xp = (x + 1) % W;
      let nx = (h[y0 + xm] - h[y0 + xp]) * strength;
      let ny = (h[ym + x] - h[yp + x]) * strength;
      const l = Math.sqrt(nx * nx + ny * ny + 1);
      nx /= l; ny /= l;
      const o = (y0 + x) * stride + off;
      out[o] = Math.round((nx * 0.5 + 0.5) * 255);
      out[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
    }
  }
}

// ---------------------------------------------------------------------------------------
// actor skin / cloth

// noise functions used by the generators, bound to their lattices once
const F_128_2_41 = makeFbm(128, 2, 41);
const F_12_2_103 = makeFbm(12, 2, 103);
const F_12_3_73 = makeFbm(12, 3, 73);
const F_16_2_81 = makeFbm(16, 2, 81);
const F_16_3_23 = makeFbm(16, 3, 23);
const F_32_2_51 = makeFbm(32, 2, 51);
const F_3_3_23 = makeFbm(3, 3, 23);
const F_3_4_31 = makeFbm(3, 4, 31);
const F_3_5_57 = makeFbm(3, 5, 57);
const F_4_3_7 = makeFbm(4, 3, 7);
const F_4_4_17 = makeFbm(4, 4, 17);
const F_4_5_11 = makeFbm(4, 5, 11);
const F_5_3_101 = makeFbm(5, 3, 101);
const F_6_2_85 = makeFbm(6, 2, 85);
const F_6_3_101 = makeFbm(6, 3, 101);
const F_8_2_33 = makeFbm(8, 2, 33);
const F_8_4_91 = makeFbm(8, 4, 91);
const V_128_41 = makeVn(128, 41);
const V_256_9 = makeVn(256, 9);
const V_2_13 = makeVn(2, 13);
const V_4_15_256 = makeVn(4, 15, 256);
const V_512_39 = makeVn(512, 39);
const V_8_16_512 = makeVn(8, 16, 512);
const V_8_3 = makeVn(8, 3);

function* genActorDetail(S = 512, fine = false) {
  const px = new Uint8Array(S * S * 4);
  const hSkin = new Float32Array(S * S), hCloth = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    if ((y & 7) === 7) yield y / S;
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const i = y * S + x;
      // R: rot mottle — broad blotches with fine speckle
      const m = F_4_5_11(u, v);
      const blot = smooth(0.5, 0.72, F_3_3_23(u, v));
      const speck = smooth(0.18, 0.02, worley(u, v, 40, 31));
      // dark veins branching through the rot
      const vn = smooth(0.93, 0.985, 1 - Math.abs(F_6_3_101(u, v) * 2 - 1)) + smooth(0.95, 0.99, 1 - Math.abs(F_12_2_103(u, v) * 2 - 1)) * 0.6;
      const rot = clamp01(0.5 + (m - 0.5) * 2.1 - blot * 0.38 + speck * 0.18 - vn * 0.3);
      // G: woven fabric (plain weave over/under) with fibre fuzz
      const wu = u * 256, wv = v * 256;
      const over = ((Math.floor(wu) + Math.floor(wv)) & 1) === 0;
      const tu = wu - Math.floor(wu), tv = wv - Math.floor(wv);
      const thread = over ? Math.sin(tu * Math.PI) : Math.sin(tv * Math.PI);
      const fibre = F_128_2_41(u, v);
      const slub = F_16_2_81(u, v);            // uneven, worn fabric
      const weave = clamp01(0.3 + thread * 0.35 + (fibre - 0.5) * 0.5 + (slub - 0.5) * 0.35);
      // B: grime — soft dirty patches
      const grime = smooth(0.38, 0.78, F_3_5_57(u + 0.37, v + 0.11));
      // A: splatter — blobs with drips and speckles (blood / tear masks)
      const f1 = worley(u, v, 5, 71);
      const wob = F_12_3_73(u, v);
      const blob = smooth(0.42 + wob * 0.25, 0.12, f1);
      const drip = smooth(0.2, 0.02, worley(u, v, 24, 79, 5) + Math.abs(F_16_2_81(u, v) - 0.5));
      const spk = smooth(0.14, 0.0, worley(u, v, 22, 83)) * (F_6_2_85(u, v) > 0.5 ? 1 : 0);
      const splat = clamp01(Math.max(blob, drip * 0.8, spk));
      const o = i * 4;
      px[o] = rot * 255; px[o + 1] = weave * 255; px[o + 2] = grime * 255; px[o + 3] = splat * 255;
      // heights for the normal maps
      const vein = smooth(0.9, 0.99, 1 - Math.abs(F_5_3_101(u, v) * 2 - 1));
      if (fine) {
        // cinematic skin: fine pores and micro-wrinkles with no orange-peel lumps
        const ridge = 1 - Math.abs(F_16_3_23(u * 3, v * 3) * 2 - 1);
        const pores = smooth(0.06, 0.4, worley(u, v, 150, 97));
        const crease = smooth(0.75, 0.97, 1 - Math.abs(F_32_2_51(u + F_8_2_33(u, v) * 0.05, v) * 2 - 1));
        hSkin[i] = ridge * ridge * 0.16 + pores * 0.16 + crease * 0.12 + vein * 0.24 + m * 0.1;
      } else {
        const ridge = 1 - Math.abs(F_8_4_91(u, v) * 2 - 1);
        const pores = smooth(0.05, 0.45, worley(u, v, 56, 97));
        hSkin[i] = ridge * ridge * 0.55 + pores * 0.22 + vein * 0.35 + m * 0.4;
      }
      hCloth[i] = thread * 0.35 + fibre * 0.45 + slub * 0.6;
    }
  }
  const nrm = new Uint8Array(S * S * 4);
  // (a texel of the 1024 map is half as wide, so the same height slope needs twice the strength)
  const k = S / 512;
  heightToNormal(hSkin, S, S, (fine ? 2.4 : 3.2) * k, nrm, 0, 4);
  heightToNormal(hCloth, S, S, 3.0 * k, nrm, 2, 4);
  return { detail: px, normal: nrm, size: S };
}

const F_7_3_301 = makeFbm(7, 3, 301);
const F_13_2_311 = makeFbm(13, 2, 311);
const F_5_4_321 = makeFbm(5, 4, 321);
const F_20_2_331 = makeFbm(20, 2, 331);
const F_3_3_341 = makeFbm(3, 3, 341);

/** Worley distance to the second-nearest feature minus the nearest (thin cell edges → cracks). */
function worleyEdge(u, v, p, seed) {
  const key = p * 4096 * 1000 + seed + 7;
  let F = features.get(key);
  if (!F) {
    F = new Float32Array(p * p * 2);
    for (let j = 0; j < p; j++) for (let i = 0; i < p; i++) { F[(j * p + i) * 2] = hash2(i, j, seed); F[(j * p + i) * 2 + 1] = hash2(i, j, seed + 1); }
    features.set(key, F);
  }
  const x = u * p, y = v * p;
  const xi = Math.floor(x), yi = Math.floor(y);
  let b1 = 9, b2 = 9;
  for (let j = -1; j <= 1; j++) {
    const cy = yi + j;
    let wy = cy % p; if (wy < 0) wy += p;
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i;
      let wx = cx % p; if (wx < 0) wx += p;
      const o = (wy * p + wx) * 2;
      const dx = cx + F[o] - x, dy = cy + F[o + 1] - y;
      const d = dx * dx + dy * dy;
      if (d < b1) { b2 = b1; b1 = d; } else if (d < b2) b2 = d;
    }
  }
  return Math.sqrt(b2) - Math.sqrt(b1);
}

function* genActorDetail2(S = 512) {
  const px = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    if ((y & 7) === 7) yield y / S;
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const o = (y * S + x) * 4;
      // R: branching veins — ridges of two noise fields, thin and slightly beaded
      const r1 = 1 - Math.abs(F_7_3_301(u, v) * 2 - 1), r2 = 1 - Math.abs(F_13_2_311(u + 0.21, v + 0.6) * 2 - 1);
      const vein = clamp01(smooth(0.9, 0.985, r1) + smooth(0.93, 0.99, r2) * 0.7);
      // G: freckles / sores: a scatter of round blobs, some large and soft (sores), most tiny
      const f = worley(u, v, 22, 201);
      const pick = hash2(Math.floor(u * 22), Math.floor(v * 22), 203);
      const spot = pick > 0.55 ? smooth(0.32, 0.12, f) : 0;
      const speck = smooth(0.12, 0.02, worley(u, v, 70, 207)) * 0.7;
      // B: blotches
      const blot = smooth(0.35, 0.75, F_5_4_321(u + 0.4, v + 0.15) * 0.7 + F_20_2_331(u, v) * 0.3);
      // A: cracks between cells, wobbled by noise
      const crack = smooth(0.09, 0.0, worleyEdge(u + (F_3_3_341(u, v) - 0.5) * 0.04, v, 9, 211));
      px[o] = vein * 255; px[o + 1] = clamp01(Math.max(spot, speck)) * 255; px[o + 2] = blot * 255; px[o + 3] = crack * 255;
    }
  }
  return { detail: px, size: S };
}

function dataTex(data, size, aniso = 8) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = aniso;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * Fresh textures over the cached actor pixel data (caller disposes).
 * @returns {{ detail: THREE.DataTexture, normal: THREE.DataTexture, detail2: THREE.DataTexture }}
 */
export function actorTextures(aniso = 8, scale = 1) {
  const hi = scale > 1;
  const d = cached(hi ? 'actor1024' : 'actor', () => genActorDetail(hi ? 1024 : 512, hi));
  const d2 = cached(hi ? 'actor2-1024' : 'actor2', () => genActorDetail2(hi ? 1024 : 512));
  return { detail: dataTex(d.detail, d.size, aniso), normal: dataTex(d.normal, d.size, aniso), detail2: dataTex(d2.detail, d2.size, aniso) };
}

/**
 * The cinematic 1024² actor textures, generated in time slices (about 2.5 s of work spread
 * over frames). Resolves with fresh textures (caller disposes) once the pixels exist; the
 * page keeps drawing with the 512² set meanwhile.
 */
let actorHiJob = null;
export async function actorTexturesAsync(aniso = 8) {
  // one generation however many sub-systems (zombies, survivors, the viewmodel) ask for it
  if (!actorHiJob) {
    actorHiJob = (async () => {
      if (!cache.has('actor1024')) cache.set('actor1024', await driveAsync(genActorDetail(1024, true)));
      if (!cache.has('actor2-1024')) cache.set('actor2-1024', await driveAsync(genActorDetail2(1024)));
    })();
  }
  await actorHiJob;
  return actorTextures(aniso, 2);
}

// ---------------------------------------------------------------------------------------
// guns

function* genGunAtlas(S = 1024) {
  const T = S / 2, K = S / 1024;       // (K = 2 for the cinematic 2048² atlas)
  const px = new Uint8Array(S * S * 4);
  const h = new Float32Array(T * T);
  const tile = function* (ox, oy, fn, strength) {
    for (let y = 0; y < T; y++) {
      if ((y & 15) === 15) yield y / T;
      for (let x = 0; x < T; x++) {
        const r = fn(x / T, y / T);
        h[y * T + x] = r.h;
        const o = ((oy + y) * S + ox + x) * 4;
        px[o] = clamp01(r.a) * 255;
        px[o + 3] = clamp01(r.r) * 255;
      }
    }
    const tmp = new Uint8Array(T * T * 4);
    heightToNormal(h, T, T, strength * K, tmp, 0, 4);
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const o = ((oy + y) * S + ox + x) * 4, s = (y * T + x) * 4;
        px[o + 1] = tmp[s]; px[o + 2] = tmp[s + 1];
      }
    }
  };
  // scratches: short random strokes (shared by metal and polymer)
  const scratch = new Float32Array(T * T);
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // (the cinematic atlas is scratched more: the long strokes plus a haze of hairlines)
  const nScratch = Math.round(220 * (K > 1 ? 1.5 * K : 1)) + (K > 1 ? 900 : 0);
  for (let k = 0; k < nScratch; k++) {
    let x = rnd() * T, y = rnd() * T;
    const hair = k >= 220 * (K > 1 ? 1.5 * K : 1);
    const a = (rnd() - 0.5) * (hair ? 3.2 : 0.6) + (rnd() < 0.3 ? Math.PI / 2 : 0), L = (hair ? 3 + rnd() * 18 : 8 + rnd() * 60) * K, w = hair ? 0.18 + rnd() * 0.3 : 0.4 + rnd() * 0.6;
    for (let s = 0; s < L; s++) {
      const ix = ((Math.round(x) % T) + T) % T, iy = ((Math.round(y) % T) + T) % T;
      scratch[iy * T + ix] = Math.max(scratch[iy * T + ix], w * (1 - Math.abs(s / L - 0.5) * 1.4));
      x += Math.cos(a); y += Math.sin(a);
    }
  }
  // metal: brushed along u, fine scratches, faint mottling
  yield* tile(0, 0, (u, v) => {
    const brush = V_8_3(u, v) * 0.3 + F_4_3_7(u, v) * 0.2 + (V_256_9(u, v) - 0.5) * 0.15;
    // long streaks along u: few cells across u, many along v
    const streak = V_2_13(u, v) * 0.2 + (V_4_15_256(u, v) - 0.5) * 0.9 + (V_8_16_512(u, v) - 0.5) * 0.4;
    const sc = scratch[Math.floor(v * T) * T + Math.floor(u * T)];
    const blot = F_4_4_17(u, v);
    return { h: streak * 0.6 + brush * 0.1 - sc * 0.9, a: 0.86 + (blot - 0.5) * 0.18 + sc * 0.3, r: 0.36 + streak * 0.16 + (blot - 0.5) * 0.25 - sc * 0.22 };
  }, 1.6);
  // polymer: fine stipple
  yield* tile(T, 0, (u, v) => {
    const st = worley(u, v, 96, 21);
    const f = F_16_3_23(u, v);
    const sc = scratch[Math.floor(u * T) * T + Math.floor(v * T)];
    return { h: smooth(0.0, 0.5, st) * 0.6 + f * 0.3 - sc * 0.3, a: 0.92 + (f - 0.5) * 0.12, r: 0.62 + (f - 0.5) * 0.2 - sc * 0.15 };
  }, 2.2);
  // wood: grain lines along u with rings and pores
  yield* tile(0, T, (u, v) => {
    const warp = F_3_4_31(u, v) * 2.2 + F_8_2_33(u, v) * 0.4;
    const g = v * 14 + warp;
    const ring = 0.5 + 0.5 * Math.sin(g * Math.PI * 2);
    const ringSharp = Math.pow(ring, 3);
    const pores = smooth(0.12, 0.0, worley(u, v, 8, 37, 128)) * 0.5;
    const fibre = V_512_39(u, v) * 0.5 + V_128_41(u, v) * 0.5;
    return { h: ringSharp * 0.5 + fibre * 0.2 - pores * 0.6, a: 0.62 + ringSharp * 0.34 - pores * 0.25 + (fibre - 0.5) * 0.12, r: 0.5 + (1 - ring) * 0.15 + pores * 0.3 };
  }, 1.4);
  // knurl / checkered grip
  yield* tile(T, T, (u, v) => {
    const a = u * 40 + v * 40, b = u * 40 - v * 40;
    const da = Math.abs(a - Math.round(a)), db = Math.abs(b - Math.round(b));
    const d = Math.min(da, db);
    const f = F_32_2_51(u, v);
    return { h: smooth(0.0, 0.35, d) * 0.9 + f * 0.1, a: 0.9 + f * 0.1 - (1 - smooth(0.0, 0.3, d)) * 0.25, r: 0.72 + (1 - smooth(0, 0.3, d)) * 0.15 };
  }, 3.0);
  return { data: px, size: S };
}

/** Fresh gun atlas texture (caller disposes); scale 2 = the cinematic 2048² atlas (built synchronously). */
export function gunAtlasTexture(aniso = 8, scale = 1) {
  const d = cached(scale > 1 ? 'gun2048' : 'gun', () => genGunAtlas(scale > 1 ? 2048 : 1024));
  return dataTex(d.data, d.size, aniso);
}

/** The 2048² atlas pixels { data, size }, generated in time slices (about 3 s of work over frames). */
let gunAtlasJob = null;
export async function gunAtlasPixelsAsync() {
  if (!cache.has('gun2048')) {
    if (!gunAtlasJob) gunAtlasJob = driveAsync(genGunAtlas(2048)).then((d) => { cache.set('gun2048', d); });
    await gunAtlasJob;
  }
  return cache.get('gun2048');
}

// ---------------------------------------------------------------------------------------
// viewmodel environment: a night "studio" so metal and polymer have something to reflect —
// cool moonlit sky above, a warm flashlight bounce low in front, dark ground behind

function genEnvCanvas() {
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#46526e');
  sky.addColorStop(0.35, '#232a3a');
  sky.addColorStop(0.5, '#15171c');
  sky.addColorStop(0.62, '#1a1612');
  sky.addColorStop(1, '#070605');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  const blob = (x, y, rx, ry, col, a) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, rx);
    gr.addColorStop(0, col);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.save();
    g.globalAlpha = a;
    g.translate(x, y);
    g.scale(1, ry / rx);
    g.translate(-x, -y);
    g.fillStyle = gr;
    g.fillRect(x - rx, y - rx, rx * 2, rx * 2);
    g.restore();
  };
  g.globalCompositeOperation = 'lighter';
  blob(W * 0.25, H * 0.28, 110, 40, '#c8d8ff', 0.35);     // moon-lit sky panel
  blob(W * 0.62, H * 0.2, 70, 26, '#ffffff', 0.25);       // soft key from above
  blob(W * 0.5, H * 0.56, 150, 26, '#ffcf96', 0.35);      // warm flashlight bounce ahead
  blob(W * 0.9, H * 0.45, 60, 30, '#ff9a4a', 0.3);        // distant fire
  blob(W * 0.05, H * 0.4, 70, 30, '#7fa8ff', 0.25);
  return c;
}

/** Fresh equirect environment texture for the viewmodel scene (caller disposes). */
export function viewmodelEnvTexture() {
  const c = cached('env', genEnvCanvas);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------------------
// stamped markings on the guns: one shared label sheet, a row of text per label (the
// builders ask for rows as they lay out a gun; the sheet is repainted and re-uploaded)

const MARK_W = 512, MARK_H = 1024, MARK_ROW = 16;
const marks = { canvas: null, g: null, rows: new Map(), n: 0, version: 1 };

/** Row of the label sheet holding `text`: { aspect (width / height), u1, v0, v1 }. */
export function markRow(text) {
  let r = marks.rows.get(text);
  if (r) return r;
  if (!marks.canvas) {
    marks.canvas = document.createElement('canvas');
    marks.canvas.width = MARK_W; marks.canvas.height = MARK_H;
    marks.g = marks.canvas.getContext('2d');
  }
  const g = marks.g;
  const idx = marks.n++ % (MARK_H / MARK_ROW);
  g.clearRect(0, idx * MARK_ROW, MARK_W, MARK_ROW);
  g.font = 'bold 12px "DejaVu Sans Mono", "Liberation Mono", "Courier New", monospace';
  g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  const w = Math.min(MARK_W - 4, Math.ceil(g.measureText(text).width) + 6);
  g.fillText(text, 3, idx * MARK_ROW + MARK_ROW / 2 + 0.5);
  r = { idx, aspect: w / MARK_ROW, u1: w / MARK_W, v0: 1 - (idx + 1) * MARK_ROW / MARK_H, v1: 1 - idx * MARK_ROW / MARK_H };
  marks.rows.set(text, r);
  marks.version++;
  return r;
}

/** Bumps whenever a row is added (callers re-upload their texture). */
export function markVersion() { return marks.version; }

/** Fresh texture over the shared label sheet (caller disposes). */
export function markTexture() {
  if (!marks.canvas) markRow('HH');
  const t = new THREE.CanvasTexture(marks.canvas);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  t.userData.v = marks.version;
  return t;
}
