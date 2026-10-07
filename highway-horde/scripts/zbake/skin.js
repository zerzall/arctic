// Tileable corpse skin (scripts/bake-zombies.js): three stages of decay and the five special
// infected, painted as layers on one surface — creases and pores, a blotchy value breakup,
// decomposition patches, marbling (the dark branching veins of a body days to weeks gone),
// livor, bruises, grazes, skin slip, blisters, mould, dried blood, grime, and for the long dead a
// cracked leather with tendon and bone showing through. Every mask edge is domain-warped so
// nothing reads as a stamped circle. A tile spans about 60 cm of body (20 model units):
// 2048 px → 34 px/cm.
//
// Every generator returns { alb: Rgb (linear), h (height), rough, ao, thick } — the albedo is
// painted at a mid reference tone and the runtime shifts it toward the person's own skin tone,
// so the decay reads the same on every complexion.

import {
  Rgb, blur, cavity, stamp, stroke, tree, rng, fbm, ridged, cells, noise,
  smooth, clamp01, mix, lin, mixc, sc,
} from './lib.js';

export const SKIN_TILE_UNITS = 20;

/** A painting context: N, albedo, height, roughness, thickness, a seed. */
export function skinCtx(N, seed) {
  return { N, seed, alb: new Rgb(N), h: new Float32Array(N * N), rough: new Float32Array(N * N), thick: new Float32Array(N * N) };
}

/** Run fn(u, v, i) over every pixel. */
export function each(S, fn) {
  const N = S.N;
  for (let y = 0; y < N; y++) {
    const v = (y + 0.5) / N;
    for (let x = 0; x < N; x++) fn((x + 0.5) / N, v, y * N + x);
  }
}

/** A domain-warped fBm in 0..1 (organic masks). */
export function wfbm(u, v, f, oct, s, warp = 0.06) {
  const wu = u + fbm(u, v, Math.max(1, f), 3, s + 501) * warp, wv = v + fbm(u, v, Math.max(1, f), 3, s + 502) * warp;
  return fbm(wu, wv, f, oct, s) * 0.5 + 0.5;
}

// ---------------------------------------------------------------------------------------
// shared layers

/**
 * Base colour: three tints blended by warped low-frequency fields, then a strong multi-scale
 * value breakup (corpse skin is never an even colour).
 */
export function baseTone(S, tints, o = {}) {
  const [t0, t1, t2] = tints.map((h) => lin(h));
  const s = S.seed, f0 = o.f0 ?? 3;
  each(S, (u, v, i) => {
    const a = wfbm(u, v, f0, 4, s + 1, 0.08), b = wfbm(u, v, f0 * 2, 4, s + 2, 0.06);
    let c = mixc(t0, t1, smooth(0.32, 0.7, a));
    c = mixc(c, t2, smooth(0.48, 0.82, b) * (o.third ?? 0.7));
    const m = (wfbm(u, v, f0 * 4, 4, s + 3, 0.05) - 0.5) * (o.mottle ?? 0.35) + (fbm(u, v, f0 * 16, 3, s + 4) * (o.fine ?? 0.08));
    const k = Math.max(0.2, 1 + m);
    S.alb.r[i] = c[0] * k; S.alb.g[i] = c[1] * k; S.alb.b[i] = c[2] * k;
  });
}

/**
 * Skin relief: pores on a jittered grid, a dense net of fine skin lines (two crossing ridged
 * fields), broader creases and folds, low lumps.
 */
export function relief(S, o) {
  const cell = {};
  const s = S.seed, pf = o.poreF ?? 420;
  each(S, (u, v, i) => {
    cells(u, v, pf, s + 11, cell, 0.95);
    const pore = cell.f1 < 0.3 ? (1 - cell.f1 / 0.3) ** 2 * (0.5 + 0.5 * ((cell.id * 0.618) % 1)) : 0;
    const wu = u + fbm(u, v, 5, 3, s + 12) * 0.035, wv = v + fbm(u, v, 5, 3, s + 13) * 0.035;
    // skin lines: two families crossing at an angle, the fine diamond net of real skin
    const l1 = Math.pow(ridged(wu * 1.0 + wv * 0.35, wv, o.lineF ?? 60, 2, s + 14), 10);
    const l2 = Math.pow(ridged(wu, wv - wu * 0.4, (o.lineF ?? 60) * 1.15 | 0, 2, s + 15), 10);
    // creases: longer, deeper, mostly one way
    const cr = Math.pow(ridged(wu * (o.aniso ?? 0.7), wv * 1.4, o.creaseF ?? 10, 4, s + 16), o.creaseSharp ?? 5);
    const lump = fbm(u, v, o.lumpF ?? 12, 4, s + 17);
    S.h[i] += -pore * (o.pores ?? 0.3) - (l1 + l2) * (o.lines ?? 0.25) - cr * (o.crease ?? 0.6) + lump * (o.lump ?? 0.3);
  });
}

/**
 * Discoloured patches (decomposition, livor): irregular soft-edged areas tinted and darkened,
 * mottled inside. `mul` is the colour multiplier at full strength.
 */
export function patches(S, o) {
  const s = S.seed + (o.salt ?? 0);
  each(S, (u, v, i) => {
    const m = wfbm(u, v, o.f ?? 3, 5, s + 21, o.warp ?? 0.1);
    const t = smooth(o.at ?? 0.6, (o.at ?? 0.6) + (o.soft ?? 0.12), m);
    if (t <= 0) return;
    const inner = wfbm(u, v, (o.f ?? 3) * 6, 3, s + 22, 0.04);
    const k = t * (o.k ?? 0.7) * (0.65 + 0.7 * inner);
    S.alb.mul(i, o.mul, k);
    if (o.mul2) S.alb.mul(i, o.mul2, smooth(0.65, 1, t) * smooth(0.5, 0.8, inner) * (o.k ?? 0.7));
    S.thick[i] += t * (o.thick ?? 0);
    S.rough[i] += t * (o.rough ?? 0);
  });
}

/**
 * Marbling: branching vein trees under the skin — a dark core and a broad soft halo — in
 * clusters (a mask leaves some areas clean), over a faint capillary net.
 */
export function veins(S, o) {
  const N = S.N;
  const r = rng(S.seed + 31);
  const core = new Float32Array(N * N), wide = new Float32Array(N * N);
  for (let k = 0; k < o.count; k++) {
    const x = r(), y = r(), a = r() * Math.PI * 2;
    tree(r, x, y, a, o.len * (0.6 + r() * 0.8), o.w * (0.6 + r() * 0.8), o.depth ?? 4, (pts) => {
      stroke(core, N, pts, (d) => { const t = 1 - d; return t * t * (3 - 2 * t); });
      stroke(wide, N, pts.map(([px, py, w]) => [px, py, w * (o.haloW ?? 4.5)]), (d) => (1 - d) ** 2);
    }, { curl: o.curl ?? 0.55, split: o.split ?? 0.8, shrink: 0.6, taper: 0.6, step: 0.004 });
  }
  const c2 = blur(core, N, Math.max(1, N / 1400));
  const soft = blur(wide, N, Math.max(1, N / 400));
  S.veinCore = c2;
  each(S, (u, v, i) => {
    const vis = smooth(o.clusterAt ?? 0.3, (o.clusterAt ?? 0.3) + 0.35, wfbm(u, v, 2, 3, S.seed + 32, 0.1));
    const cap = Math.pow(ridged(u + fbm(u, v, 6, 2, S.seed + 33) * 0.04, v, o.capF ?? 22, 3, S.seed + 34), 9) * (o.cap ?? 0.3);
    S.alb.mul(i, o.halo, clamp01(soft[i] * (o.haloK ?? 0.6) + cap) * (0.25 + 0.75 * vis));
    S.alb.mul(i, o.core, clamp01(c2[i] * (o.coreK ?? 0.7)) * (0.35 + 0.65 * vis));
    S.h[i] += c2[i] * (o.raise ?? 0.15);
  });
}

/** Bruises: purple cores fading through green-grey to a yellow rim. */
export function bruises(S, o) {
  each(S, (u, v, i) => {
    const b = wfbm(u, v, o.f ?? 4, 5, S.seed + 41, 0.1);
    const at = o.at ?? 0.64;
    const t = smooth(at, at + 0.16, b);
    if (t <= 0) return;
    const core = o.core || [0.55, 0.38, 0.6], mid = o.mid || [0.72, 0.68, 0.66], rim = o.rim || [1.05, 1.0, 0.72];
    const c = t > 0.55 ? mixc(mid, core, smooth(0.55, 1, t)) : mixc(rim, mid, smooth(0.0, 0.55, t));
    S.alb.mul(i, c, Math.min(1, t * 2.2) * (o.k ?? 0.85));
    S.thick[i] -= t * 0.1;
  });
}

/**
 * Grazes and scratches: patches of fine parallel scratch lines (an abrasion from a fall),
 * reddish-brown and dry, plus a few long single scratches.
 */
export function grazes(S, o) {
  const N = S.N, r = rng(S.seed + 51);
  const m = new Float32Array(N * N);
  for (let k = 0; k < (o.patches ?? 6); k++) {
    const cx = r(), cy = r(), a = r() * Math.PI * 2, R = 0.02 + r() * 0.05;
    const n = 20 + Math.floor(r() * 30);
    for (let j = 0; j < n; j++) {
      const off = (r() - 0.5) * 2 * R, L = R * (0.6 + r() * 1.4), along = (r() - 0.5) * R;
      const ox = cx + Math.cos(a + 1.5708) * off + Math.cos(a) * along, oy = cy + Math.sin(a + 1.5708) * off + Math.sin(a) * along;
      const w = 0.0004 + r() * 0.0012;
      stroke(m, N, [[ox, oy, w], [ox + Math.cos(a) * L * 0.5, oy + Math.sin(a) * L * 0.5, w * 1.2], [ox + Math.cos(a) * L, oy + Math.sin(a) * L, w * 0.3]], (d) => (1 - d) * (0.5 + r() * 0.5), 'max');
    }
  }
  for (let k = 0; k < (o.lines ?? 8); k++) {
    const x = r(), y = r(), a = r() * Math.PI * 2, L = 0.05 + r() * 0.12, w = 0.0008 + r() * 0.0012;
    const pts = [];
    for (let s = 0; s <= 10; s++) { const t = s / 10; pts.push([x + Math.cos(a) * L * t + Math.sin(t * 5 + k) * 0.002, y + Math.sin(a) * L * t, w * Math.sin(Math.PI * (0.1 + t * 0.85))]); }
    stroke(m, N, pts, (d) => 1 - d);
  }
  const halo = blur(m, N, Math.max(1, N / 700));
  const red = lin('#5e241c'), pink = [1.05, 0.82, 0.8];
  for (let i = 0; i < N * N; i++) {
    const h = clamp01(halo[i] * 2.5);
    if (h > 0) S.alb.mul(i, pink, h * 0.5);
    if (m[i] > 0) { S.alb.lay(i, red, m[i] * 0.8); S.h[i] -= m[i] * 0.35; S.rough[i] = mix(S.rough[i], 0.85, m[i]); }
  }
}

/** Grime: dirt settles in the creases and pores (the cavity) and in smeared blotches. */
export function grime(S, o) {
  const cav = cavity(S.h, S.N, o.r ?? 5, o.cavK ?? 2.5);
  const dc = lin(o.col || '#463a2c');
  each(S, (u, v, i) => {
    const blot = smooth(0.5, 0.85, wfbm(u, v, 5, 4, S.seed + 61, 0.08));
    const smear = smooth(0.62, 0.9, wfbm(u * 0.6, v * 1.8, 4, 4, S.seed + 62, 0.12));
    const g = clamp01(cav[i] * (o.cav ?? 1) + blot * (o.blot ?? 0.3) + smear * (o.smear ?? 0.2));
    S.alb.lay(i, mixc([S.alb.r[i], S.alb.g[i], S.alb.b[i]], dc, 0.8), g * (o.k ?? 0.6));
    S.rough[i] += g * 0.1;
  });
}

/** Dried blood: smears and a fine spray, brown-black and matte, a little crust. */
export function driedBlood(S, o) {
  const N = S.N, r = rng(S.seed + 71);
  const m = new Float32Array(N * N);
  for (let k = 0; k < (o.spray ?? 30); k++) {
    const cx = r(), cy = r(), n = 3 + Math.floor(r() * 10);
    for (let j = 0; j < n; j++) {
      const rad = 0.0006 + r() * r() * 0.005;
      const x = cx + (r() - 0.5) * 0.04, y = cy + (r() - 0.5) * 0.04;
      stamp(m, N, x, y, rad * 1.3, (dx, dy) => { const d = Math.hypot(dx, dy) / rad * (1 + 0.3 * noise((x + dx) * 900, (y + dy) * 900, 900, 900, k)); return d < 1 ? 1 - d * d : 0; });
    }
  }
  each(S, (u, v, i) => {
    const smear = smooth(o.at ?? 0.72, (o.at ?? 0.72) + 0.05, wfbm(u * 0.8, v * 1.5, 4, 5, S.seed + 72, 0.14));
    const t = Math.max(m[i], smear * (0.5 + 0.5 * wfbm(u, v, 40, 2, S.seed + 73, 0.02)));
    if (t <= 0.01) return;
    const c = mixc(lin('#2a0c08'), lin('#4a1810'), wfbm(u, v, 30, 2, S.seed + 74, 0.02));
    S.alb.lay(i, c, t * (o.k ?? 0.8));
    S.rough[i] = mix(S.rough[i], 0.78, t);
    S.h[i] += t * 0.08;
    S.thick[i] = mix(S.thick[i], 0, t * 0.5);
  });
}

/** Skin slip: the epidermis sloughed off in sheets — raw, moist dermis, a curled, lifted rim. */
export function slip(S, o) {
  const raw0 = lin(o.raw || '#8a5444'), raw1 = lin(o.raw2 || '#a68a5e'), rim = lin(o.rim || '#c7beac');
  each(S, (u, v, i) => {
    const m = wfbm(u, v, o.f ?? 3, 6, S.seed + 81, 0.09);
    const at = o.at ?? 0.66;
    const inside = smooth(at, at + 0.01, m);
    const ring = smooth(at - 0.035, at - 0.004, m) * (1 - inside);
    if (inside <= 0 && ring <= 0) return;
    const n = wfbm(u, v, 30, 3, S.seed + 82, 0.03);
    const depth = smooth(at, at + 0.1, m);
    S.alb.lay(i, mixc(mixc(raw0, raw1, smooth(0.35, 0.75, n)), sc(raw0, 0.7), depth * 0.5), inside * 0.95);
    S.alb.lay(i, rim, ring * 0.65 * (0.6 + n * 0.6));
    S.h[i] += -inside * (0.8 + depth * 0.4) + ring * (1.3 + n);
    S.rough[i] = mix(S.rough[i], 0.32 + n * 0.2, inside);
    S.rough[i] = mix(S.rough[i], 0.82, ring);
    S.thick[i] = mix(S.thick[i], 0.2, inside);
  });
}

/**
 * Blisters: irregular tense domes of cloudy fluid with a darker settled level and an inflamed
 * rim; some burst into wet craters with a torn flap of skin.
 */
export function blisters(S, o) {
  const N = S.N, r = rng(S.seed + 91);
  const dome = new Float32Array(N * N), burst = new Float32Array(N * N), flap = new Float32Array(N * N);
  for (let k = 0; k < o.count; k++) {
    const cx = r(), cy = r();
    const cl = 1 + Math.floor(r() * (o.cluster ?? 5));
    for (let j = 0; j < cl; j++) {
      const rad = (o.min ?? 0.003) + r() * r() * (o.max ?? 0.016);
      const x = cx + (r() - 0.5) * 0.06, y = cy + (r() - 0.5) * 0.06;
      const sq = 0.7 + r() * 0.6, seed = k * 31 + j;
      const shape = (dx, dy) => Math.hypot(dx * sq, dy) / rad * (1 + 0.28 * noise((x + dx) * 300, (y + dy) * 300, 300, 300, seed));
      if (r() < (o.burst ?? 0.25)) {
        stamp(burst, N, x, y, rad * 1.6, (dx, dy) => (shape(dx, dy) < 1 ? 1 : 0));
        stamp(flap, N, x, y, rad * 1.9, (dx, dy) => { const d = shape(dx, dy); return d >= 0.85 && d < 1.45 ? 1 - Math.abs(d - 1.1) / 0.35 : 0; });
      } else stamp(dome, N, x, y, rad * 1.6, (dx, dy) => { const d = shape(dx, dy); return d < 1 ? Math.sqrt(1 - d * d) : 0; });
    }
  }
  const fl0 = lin(o.fluid || '#b8a46c'), fl1 = lin(o.fluid2 || '#7e6a44'), edge = [0.78, 0.55, 0.5], wet = lin('#5e261c'), fc = lin('#cdc2aa');
  const halo = blur(dome, N, Math.max(1, N / 500));
  each(S, (u, v, i) => {
    const d = dome[i], b = burst[i], f = flap[i];
    const hl = clamp01(halo[i] * 2.5);
    if (hl > 0) S.alb.mul(i, edge, hl * (1 - clamp01(d * 4)) * 0.6);
    if (d > 0) {
      const t = clamp01(d * 5);
      // the fluid settles: darker at the bottom of the dome (−v), a lighter skin film on top
      const lvl = smooth(0.2, 0.8, d) * (0.5 + 0.5 * fbm(u, v, 80, 2, S.seed + 92));
      S.alb.lay(i, mixc(fl1, fl0, lvl), t * 0.85);
      S.h[i] += d * 2.6;
      S.rough[i] = mix(S.rough[i], 0.16, t);
      S.thick[i] = mix(S.thick[i], 1, t);
    }
    if (b > 0) { S.alb.lay(i, mixc(wet, sc(wet, 1.5), fbm(u, v, 120, 2, S.seed + 93) * 0.5 + 0.5), b * 0.92); S.h[i] -= b * 0.5; S.rough[i] = mix(S.rough[i], 0.2, b); S.thick[i] = 0.3; }
    if (f > 0) { S.alb.lay(i, fc, f * 0.55); S.h[i] += f * 0.8; S.rough[i] = mix(S.rough[i], 0.8, f); }
  });
}

/** Mould: colonies of tiny fuzzy specks, white-grey and grey-green, densest at the middle. */
export function mould(S, o) {
  const N = S.N, r = rng(S.seed + 101);
  const m = new Float32Array(N * N);
  for (let k = 0; k < (o.colonies ?? 14); k++) {
    const cx = r(), cy = r(), cr = 0.015 + r() * 0.05;
    const n = Math.round((o.specks ?? 300) * cr / 0.035);
    for (let j = 0; j < n; j++) {
      const a = r() * Math.PI * 2, d = Math.pow(r(), 0.7) * cr;
      const rad = 0.0006 + r() * r() * 0.003;
      const kk = 1 - (d / cr) * 0.7;
      stamp(m, N, cx + Math.cos(a) * d, cy + Math.sin(a) * d, rad, (dx, dy) => { const q = Math.hypot(dx, dy) / rad; return q < 1 ? (1 - q * q) * kk : 0; });
    }
  }
  const sm = blur(m, N, Math.max(1, N / 1600));
  const white = lin(o.c1 || '#d4d3c4'), green = lin(o.c2 || '#8b9876');
  each(S, (u, v, i) => {
    const t = clamp01(sm[i] * 1.8);
    if (t <= 0.01) return;
    S.alb.lay(i, mixc(green, white, wfbm(u, v, 40, 2, S.seed + 102, 0.02)), t * (o.k ?? 0.75));
    S.h[i] += t * 0.3;
    S.rough[i] = mix(S.rough[i], 0.97, t);
  });
}

/**
 * Desiccation: leather folds and a crack network that follows them (ridged noise, so cracks
 * connect and run with the folds), lifting at the edges; strongest in patches.
 */
export function leather(S, o) {
  const dark = lin(o.crack || '#22180f'), flake = lin(o.flake || '#a3916f');
  const cell = {};
  each(S, (u, v, i) => {
    const wu = u + fbm(u, v, 5, 3, S.seed + 111) * 0.03, wv = v + fbm(u, v, 5, 3, S.seed + 112) * 0.03;
    const fold = Math.pow(ridged(wu * 0.8, wv * 1.5, o.foldF ?? 7, 4, S.seed + 113), 3);
    const area = smooth(0.35, 0.65, wfbm(u, v, 3, 4, S.seed + 114, 0.1));
    // cracks: thin lines where a sharper ridged field peaks, plus a cell net for the crazing between
    const c1 = Math.pow(ridged(wu * 1.6 + fold * 0.02, wv * 0.9, o.crackF ?? 9, 3, S.seed + 115), 30);
    cells(wu, wv, o.cellF ?? 26, S.seed + 116, cell, 1);
    const craze = 1 - smooth(0, 0.06, cell.f2 - cell.f1);
    const crack = clamp01(c1 * 1.4 + craze * 0.5 * area) * (0.35 + 0.65 * area);
    const lift = smooth(0.04, 0.12, cell.f2 - cell.f1) * (1 - smooth(0.12, 0.3, cell.f2 - cell.f1)) * area;
    S.h[i] += fold * (o.fold ?? 1.2) - crack * 1.6 + lift * 0.4 + (1 - cell.f1) * 0.2 * area;
    S.alb.lay(i, dark, crack * 0.85);
    S.alb.lay(i, flake, lift * 0.3);
    S.alb.scale(i, 0.8 + fold * 0.4);
    S.rough[i] += crack * 0.05;
  });
}

/**
 * Where the skin has rotted through: ragged dark edges, dried muscle with fibres, pale tendon
 * strips and ivory bone at the deepest point.
 */
export function exposed(S, o) {
  const mus0 = lin('#5c271c'), mus1 = lin('#33140e'), ten = lin('#cbc0a4'), bone = lin('#d4c8a6'), edge = lin('#24160f');
  const cell = {};
  each(S, (u, v, i) => {
    const m = wfbm(u, v, o.f ?? 3, 6, S.seed + 121, 0.1);
    const at = o.at ?? 0.7;
    if (m < at - 0.04) return;
    const depth = smooth(at, at + 0.14, m);
    const rim = smooth(at - 0.04, at - 0.005, m) * (1 - smooth(at - 0.005, at + 0.008, m));
    const inside = smooth(at - 0.005, at + 0.008, m);
    const ang = fbm(u, v, 2, 2, S.seed + 122) * 3;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const along = u * ca + v * sa, across = -u * sa + v * ca;
    const fib = Math.pow(Math.abs(noise(across * 700, along * 30, 700, 30, S.seed + 123)), 0.6);
    let c = mixc(mus0, mus1, fib * 0.6 + depth * 0.3);
    const band = smooth(0.5, 0.8, Math.abs(noise(across * 40, along * 3, 40, 3, S.seed + 124)));
    const tend = band * smooth(0.2, 0.45, depth) * (o.tendon ?? 1);
    c = mixc(c, mixc(ten, sc(ten, 0.78), fib), tend * 0.9);
    cells(u, v, 260, S.seed + 125, cell, 1);
    const boneK = smooth(0.7, 0.8, depth) * (o.bone ?? 1);
    c = mixc(c, sc(bone, 0.8 + 0.3 * cell.f1), boneK);
    S.alb.lay(i, c, inside);
    S.alb.lay(i, edge, rim * 0.9);
    S.h[i] += -inside * (1.4 + depth * 1.6) + rim * 1.1 + fib * inside * 0.3 + tend * 0.6 + boneK * 1.8;
    S.rough[i] = mix(S.rough[i], mix(0.6, 0.45, tend) * (1 - boneK) + boneK * 0.8, inside);
    S.thick[i] = mix(S.thick[i], 0, inside);
  });
}

/** Raised scars (keloid ridges), some stitched; for the brute's hide. */
export function scars(S, o) {
  const N = S.N, r = rng(S.seed + 131);
  const m = new Float32Array(N * N), st = new Float32Array(N * N);
  for (let k = 0; k < o.count; k++) {
    const x = r(), y = r(), a = r() * Math.PI * 2, L = 0.05 + r() * 0.22, w = 0.002 + r() * 0.006;
    const pts = [];
    let px = x, py = y, ang = a;
    for (let s = 0; s <= 24; s++) {
      const t = s / 24;
      pts.push([px, py, w * Math.sin(Math.PI * (0.06 + t * 0.88)) * (0.75 + 0.5 * noise(t * 8, k, 64, 64, 7))]);
      ang += (r() - 0.5) * 0.25; px += Math.cos(ang) * L / 24; py += Math.sin(ang) * L / 24;
    }
    stroke(m, N, pts, (d) => Math.sqrt(1 - d * d));
    if (r() < (o.stitched ?? 0.35)) {
      for (let s = 1; s < 24; s += 2) {
        const [sx, sy] = pts[s], [tx, ty] = pts[s + 1];
        const dx = tx - sx, dy = ty - sy, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l, sw = w * 3.4;
        stroke(st, N, [[sx - nx * sw, sy - ny * sw, 0.0008], [sx + nx * sw, sy + ny * sw, 0.0008]], (d) => 1 - d);
      }
    }
  }
  const sm = blur(m, N, Math.max(1, N / 900));
  const sc0 = lin(o.col || '#9c8682'), stc = lin('#1c110c');
  for (let i = 0; i < N * N; i++) {
    if (sm[i] > 0.01) { S.alb.lay(i, sc0, clamp01(sm[i]) * 0.55); S.h[i] += sm[i] * 1.8; S.rough[i] = mix(S.rough[i], 0.5, clamp01(sm[i])); }
    if (st[i] > 0) { S.alb.lay(i, stc, st[i] * 0.85); S.h[i] -= st[i] * 0.4; }
  }
}

/** Bony growths: calcified lumps pushing up under thick skin, cracking it over the top. */
export function nodules(S, o) {
  const N = S.N, r = rng(S.seed + 141);
  const m = new Float32Array(N * N);
  for (let k = 0; k < o.count; k++) {
    const x = r(), y = r(), rad = 0.01 + r() * r() * 0.035, sq = 0.6 + r() * 0.8;
    stamp(m, N, x, y, rad * 1.9, (dx, dy) => {
      const d = Math.hypot(dx * sq, dy) / rad * (1 + 0.25 * noise((x + dx) * 200, (y + dy) * 200, 200, 200, k));
      return d < 1.7 ? Math.max(0, 1 - (d * d) / 2.9) : 0;
    }, 'add');
  }
  const ivory = lin('#bfae88'), crk = lin('#2c2219');
  each(S, (u, v, i) => {
    const t = Math.min(1.3, m[i]);
    if (t <= 0) return;
    const top = smooth(0.62, 0.95, t);
    const n = wfbm(u, v, 70, 2, S.seed + 142, 0.02);
    const crack = Math.pow(ridged(u, v, 120, 2, S.seed + 143), 16) * smooth(0.35, 0.7, t);
    S.alb.lay(i, sc(ivory, 0.75 + n * 0.35), top * 0.75);
    S.alb.lay(i, crk, crack * 0.8);
    S.h[i] += t * t * 3.4 - crack * 0.6;
    S.rough[i] = mix(S.rough[i], 0.7, top);
    S.thick[i] = mix(S.thick[i], 0, top);
  });
}

/** Pustules: yellow heads on inflamed red rims, clustered (the bloater). */
export function pustules(S, o) {
  const N = S.N, r = rng(S.seed + 151);
  const head = new Float32Array(N * N), rim = new Float32Array(N * N);
  for (let k = 0; k < o.count; k++) {
    const cx = r(), cy = r(), n = 1 + Math.floor(r() * 6);
    for (let j = 0; j < n; j++) {
      const x = cx + (r() - 0.5) * 0.04, y = cy + (r() - 0.5) * 0.04, rad = 0.0018 + r() * r() * 0.008;
      stamp(head, N, x, y, rad, (dx, dy) => { const d = Math.hypot(dx, dy) / rad; return d < 1 ? Math.sqrt(1 - d * d) : 0; });
      stamp(rim, N, x, y, rad * 3, (dx, dy) => { const d = Math.hypot(dx, dy) / (rad * 3) * (1 + 0.3 * noise((x + dx) * 400, (y + dy) * 400, 400, 400, k + j)); return d < 1 ? (1 - d) ** 1.4 : 0; }, 'add');
    }
  }
  const yc0 = lin('#d9c47e'), yc1 = lin('#b29a52'), rc = [1.0, 0.62, 0.55];
  each(S, (u, v, i) => {
    if (rim[i] > 0) { S.alb.mul(i, rc, clamp01(rim[i]) * 0.7); S.h[i] += Math.min(1, rim[i]) * 0.8; }
    if (head[i] > 0) { const t = clamp01(head[i] * 3); S.alb.lay(i, mixc(yc1, yc0, head[i]), t * 0.95); S.h[i] += head[i] * 2; S.rough[i] = mix(S.rough[i], 0.18, t); S.thick[i] = 1; }
  });
}

/** Stretch marks: long pale striae with purple edges (distended skin). */
export function striae(S, o) {
  const N = S.N, r = rng(S.seed + 161);
  const m = new Float32Array(N * N);
  for (let k = 0; k < o.count; k++) {
    const x = r(), y = r(), a = (r() - 0.5) * 0.6, L = 0.04 + r() * 0.12, w = 0.0015 + r() * 0.004;
    const pts = [];
    for (let s = 0; s <= 12; s++) { const t = s / 12; pts.push([x + Math.cos(a) * L * t, y + Math.sin(a) * L * t + Math.sin(t * 3 + k) * 0.004, w * Math.sin(Math.PI * t)]); }
    stroke(m, N, pts, (d) => 1 - d * d);
  }
  const edge = blur(m, N, Math.max(1, N / 500));
  for (let i = 0; i < N * N; i++) {
    const e = clamp01(edge[i] * 2.2 - m[i]);
    if (e > 0) S.alb.mul(i, [0.75, 0.6, 0.75], e * 0.6);
    if (m[i] > 0) { S.alb.mul(i, [1.18, 1.15, 1.08], m[i] * 0.8); S.h[i] -= m[i] * 0.4; S.rough[i] = mix(S.rough[i], 0.32, m[i]); }
  }
}

/** Acid burns: merged, irregular — bleached crust, a charred ring, raw weeping pits; runs dripping down. */
export function acidBurns(S, o) {
  const N = S.N, r = rng(S.seed + 171);
  const run = new Float32Array(N * N);
  each(S, () => {});
  const crust = lin('#c8bd92'), char = lin('#33231a'), raw = lin('#8a372c'), bile = [0.95, 1.0, 0.55];
  const cell = {};
  // the burns themselves: a warped field thresholded in bands
  const field = new Float32Array(N * N);
  each(S, (u, v, i) => { field[i] = wfbm(u, v, o.f ?? 4, 6, S.seed + 172, 0.12); });
  // runs from the lower edge of each burn, downward
  for (let k = 0; k < (o.runs ?? 40); k++) {
    const x = r(), y = r();
    const xi = Math.floor(x * N), yi = Math.floor(y * N);
    if (field[yi * N + xi] < (o.at ?? 0.62) - 0.02) continue;
    const L = 0.04 + r() * 0.14, w = 0.0015 + r() * 0.004;
    const pts = [];
    for (let s = 0; s <= 14; s++) { const t = s / 14; pts.push([x + Math.sin(t * 5 + k) * 0.003, y - L * t, w * (1 - t * 0.6)]); }
    stroke(run, N, pts, (d) => 1 - d);
  }
  each(S, (u, v, i) => {
    if (run[i] > 0) { S.alb.mul(i, bile, run[i] * 0.7); S.rough[i] = mix(S.rough[i], 0.42, run[i]); S.h[i] -= run[i] * 0.2; }
    const at = o.at ?? 0.62;
    const t = field[i];
    if (t < at - 0.04) return;
    const outer = smooth(at - 0.04, at, t) * (1 - smooth(at + 0.02, at + 0.035, t));
    const ring = smooth(at + 0.015, at + 0.03, t) * (1 - smooth(at + 0.05, at + 0.07, t));
    const core = smooth(at + 0.05, at + 0.08, t);
    cells(u, v, 140, S.seed + 173, cell, 1);
    const pit = Math.pow(1 - Math.min(1, cell.f1 * 1.6), 3);
    const n = wfbm(u, v, 60, 2, S.seed + 174, 0.02);
    S.alb.lay(i, sc(crust, 0.8 + n * 0.4), outer * 0.8);
    S.alb.lay(i, char, ring * 0.85);
    S.alb.lay(i, mixc(raw, sc(raw, 0.5), pit), core * 0.95);
    S.h[i] += outer * 0.6 - ring * 0.3 - core * (1.2 + pit * 0.9);
    S.rough[i] = mix(S.rough[i], 0.88, outer);
    S.rough[i] = mix(S.rough[i], 0.18 + pit * 0.1, core);
    S.thick[i] = mix(S.thick[i], 0.1, ring + core);
  });
}

/** Thin splits where stretched skin has torn: narrow red slits with pale lifted lips. */
export function splits(S, o) {
  const N = S.N, r = rng(S.seed + 181);
  const m = new Float32Array(N * N);
  for (let k = 0; k < o.count; k++) {
    const x = r(), y = r(), a = r() * Math.PI, L = 0.01 + r() * 0.05, w = 0.0012 + r() * 0.003;
    const pts = [];
    for (let s = 0; s <= 10; s++) { const t = s / 10; pts.push([x + Math.cos(a) * L * t + Math.sin(t * 6 + k) * 0.001, y + Math.sin(a) * L * t, w * Math.sin(Math.PI * t)]); }
    stroke(m, N, pts, (d) => 1 - d * d);
  }
  const red = lin('#561515'), halo = blur(m, N, Math.max(1, N / 700));
  for (let i = 0; i < N * N; i++) {
    const hl = clamp01(halo[i] * 2 - m[i]);
    if (hl > 0) { S.alb.mul(i, [1.1, 1.05, 1.02], hl * 0.5); S.h[i] += hl * 0.5; }
    if (m[i] > 0) { S.alb.lay(i, red, m[i]); S.h[i] -= m[i]; S.rough[i] = mix(S.rough[i], 0.2, m[i]); }
  }
}

/** Finish: bake the cavity into the albedo, clamp the channels, return the set. */
export function finish(S, o = {}) {
  const N = S.N;
  const cav = cavity(S.h, N, o.aoR ?? 10, o.aoK ?? 1.1);
  const ao = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    ao[i] = 1 - clamp01(cav[i]) * (o.ao ?? 0.75);
    S.alb.scale(i, 0.6 + 0.4 * ao[i]);
    S.rough[i] = clamp01(S.rough[i]);
    S.thick[i] = clamp01(S.thick[i]);
  }
  return { alb: S.alb, h: S.h, rough: S.rough, ao, thick: S.thick, nStrength: o.n ?? 14 };
}

// ---------------------------------------------------------------------------------------
// the decay stages

/** Freshly turned: waxy pallor going grey-blue, livor, faint blue-grey veins, bruises, grazes. */
export function skinFresh(N) {
  const S = skinCtx(N, 1101);
  S.rough.fill(0.55); S.thick.fill(0.78);
  baseTone(S, ['#bcb0a6', '#a2a5ad', '#b89ca2'], { mottle: 0.28, third: 0.6 });
  relief(S, { pores: 0.3, lines: 0.22, crease: 0.35, creaseF: 9, lump: 0.25 });
  // livor: blotchy purple-pink settling, and grey-blue pallor patches
  patches(S, { f: 3, at: 0.56, soft: 0.16, mul: [0.86, 0.72, 0.86], k: 0.8, salt: 1 });
  patches(S, { f: 4, at: 0.6, soft: 0.12, mul: [0.86, 0.9, 1.04], k: 0.6, salt: 2 });
  veins(S, { count: 30, len: 0.18, w: 0.004, depth: 3, core: [0.62, 0.68, 0.86], halo: [0.86, 0.88, 0.97], coreK: 0.75, haloK: 0.7, cap: 0.25, raise: 0.05, clusterAt: 0.35 });
  bruises(S, { f: 4, at: 0.64, k: 0.85 });
  grazes(S, { patches: 5, lines: 10 });
  grime(S, { k: 0.45, blot: 0.2, smear: 0.15, col: '#594a3c' });
  driedBlood(S, { spray: 18, at: 0.8, k: 0.75 });
  return finish(S, { n: 10, ao: 0.6 });
}

/** Weeks dead: grey-green and yellow, marbled, discoloured, slipping, blistered, mould starting. */
export function skinWeeks(N) {
  const S = skinCtx(N, 1201);
  S.rough.fill(0.64); S.thick.fill(0.36);
  baseTone(S, ['#8f967c', '#a59f72', '#86797f'], { mottle: 0.42, fine: 0.1 });
  relief(S, { pores: 0.3, lines: 0.3, crease: 0.6, creaseF: 10, lump: 0.4 });
  // decomposition: dark green-black and purple-brown patches
  patches(S, { f: 3, at: 0.55, soft: 0.14, mul: [0.55, 0.62, 0.48], mul2: [0.7, 0.6, 0.72], k: 0.75, salt: 1, rough: 0.05 });
  patches(S, { f: 5, at: 0.62, soft: 0.1, mul: [1.12, 1.06, 0.78], k: 0.55, salt: 2 });
  veins(S, { count: 40, len: 0.25, w: 0.006, depth: 4, core: [0.38, 0.42, 0.32], halo: [0.66, 0.7, 0.6], coreK: 0.8, haloK: 0.75, cap: 0.4, raise: 0.12, clusterAt: 0.25 });
  bruises(S, { f: 4, at: 0.62, k: 0.7, core: [0.5, 0.42, 0.52], mid: [0.62, 0.68, 0.55], rim: [1.0, 0.98, 0.7] });
  slip(S, { f: 3, at: 0.68 });
  blisters(S, { count: 16, min: 0.003, max: 0.02, burst: 0.3, cluster: 5 });
  grime(S, { k: 0.6, blot: 0.3, smear: 0.25 });
  mould(S, { colonies: 10, specks: 280, k: 0.7 });
  driedBlood(S, { spray: 30, at: 0.76, k: 0.8 });
  return finish(S, { n: 14 });
}

/** Months dead: desiccated leather, folded, cracked and sunken; tendon and bone through the rot. */
export function skinMonths(N) {
  const S = skinCtx(N, 1301);
  S.rough.fill(0.86); S.thick.fill(0.0);
  baseTone(S, ['#7a6750', '#564533', '#8a806a'], { mottle: 0.45, fine: 0.12 });
  relief(S, { pores: 0.15, lines: 0.35, crease: 0.8, creaseF: 8, lump: 0.5, creaseSharp: 3 });
  patches(S, { f: 3, at: 0.56, soft: 0.14, mul: [0.55, 0.5, 0.42], k: 0.8, salt: 1 });
  patches(S, { f: 4, at: 0.6, soft: 0.12, mul: [1.15, 1.1, 0.9], k: 0.5, salt: 2 });
  veins(S, { count: 14, len: 0.2, w: 0.006, depth: 3, core: [0.45, 0.4, 0.34], halo: [0.75, 0.72, 0.66], coreK: 0.6, haloK: 0.5, cap: 0.15, raise: 0.3, clusterAt: 0.4 });
  leather(S, { fold: 1.3, crackF: 9, cellF: 24 });
  exposed(S, { f: 3, at: 0.69 });
  grime(S, { k: 0.75, blot: 0.4, smear: 0.3, col: '#33291e' });
  mould(S, { colonies: 7, specks: 220, k: 0.6, c1: '#5a5848', c2: '#2f3a2a' });
  driedBlood(S, { spray: 20, at: 0.8, k: 0.7 });
  return finish(S, { n: 18, ao: 0.85 });
}

// ---------------------------------------------------------------------------------------
// the special infected

/** Bloater: stretched, shiny, translucent skin over a dense dark marbling; pustules and striae. */
export function skinBloater(N) {
  const S = skinCtx(N, 1401);
  S.rough.fill(0.42); S.thick.fill(0.84);
  baseTone(S, ['#b2b28c', '#9ea47a', '#a68e88'], { f0: 2, mottle: 0.3, third: 0.45 });
  relief(S, { pores: 0.12, lines: 0.06, crease: 0.12, creaseF: 8, lump: 0.25 });
  patches(S, { f: 3, at: 0.55, soft: 0.15, mul: [0.7, 0.62, 0.62], mul2: [0.6, 0.7, 0.5], k: 0.65, salt: 1 });
  veins(S, { count: 55, len: 0.32, w: 0.0075, depth: 5, core: [0.42, 0.34, 0.42], halo: [0.68, 0.74, 0.6], coreK: 0.85, haloK: 0.85, cap: 0.55, raise: 0.2, haloW: 5.5, clusterAt: 0.15 });
  striae(S, { count: 80 });
  pustules(S, { count: 70 });
  blisters(S, { count: 10, min: 0.006, max: 0.022, burst: 0.4, fluid: '#c4b06c' });
  grime(S, { k: 0.35, blot: 0.2, smear: 0.15 });
  return finish(S, { n: 10, ao: 0.6 });
}

/** Spitter: grey-green skin stained with bile, eaten by acid burns that weep and run. */
export function skinSpitter(N) {
  const S = skinCtx(N, 1501);
  S.rough.fill(0.62); S.thick.fill(0.38);
  baseTone(S, ['#869070', '#a29c58', '#7c886a'], { mottle: 0.38 });
  relief(S, { pores: 0.3, lines: 0.3, crease: 0.55, creaseF: 10, lump: 0.35 });
  patches(S, { f: 3, at: 0.5, soft: 0.2, mul: [1.04, 1.06, 0.6], k: 0.7, salt: 1 });
  veins(S, { count: 30, len: 0.22, w: 0.005, depth: 4, core: [0.4, 0.48, 0.32], halo: [0.7, 0.78, 0.6], coreK: 0.75, haloK: 0.6, clusterAt: 0.3 });
  acidBurns(S, { f: 4, at: 0.64, runs: 60 });
  grime(S, { k: 0.5, blot: 0.3, smear: 0.2, col: '#4a4626' });
  return finish(S, { n: 14 });
}

/** Brute: thick, coarse, scarred hide with bony growths through it. */
export function skinBrute(N) {
  const S = skinCtx(N, 1601);
  S.rough.fill(0.8); S.thick.fill(0.12);
  baseTone(S, ['#6e5f58', '#59584e', '#7a685e'], { mottle: 0.4, fine: 0.12 });
  relief(S, { pores: 0.55, lines: 0.4, crease: 1.0, creaseF: 7, lump: 0.8, lumpF: 9, poreF: 300, creaseSharp: 3 });
  const cell = {};
  each(S, (u, v, i) => { cells(u, v, 34, 1611, cell, 1); S.h[i] += (1 - cell.f1) * 0.6; });
  patches(S, { f: 3, at: 0.56, soft: 0.14, mul: [0.66, 0.6, 0.62], k: 0.7, salt: 1 });
  veins(S, { count: 16, len: 0.22, w: 0.009, depth: 3, core: [0.55, 0.45, 0.48], halo: [0.82, 0.76, 0.76], coreK: 0.5, haloK: 0.5, raise: 0.6 });
  scars(S, { count: 36, stitched: 0.4 });
  nodules(S, { count: 26 });
  grime(S, { k: 0.65, blot: 0.35, smear: 0.25 });
  driedBlood(S, { spray: 25, at: 0.78 });
  return finish(S, { n: 18, ao: 0.85 });
}

/** Screamer: thin, tight, pale skin with a dense blue-violet vein net showing through, small splits. */
export function skinScreamer(N) {
  const S = skinCtx(N, 1701);
  S.rough.fill(0.46); S.thick.fill(0.68);
  baseTone(S, ['#bfbab4', '#a5a9b3', '#b5a6ac'], { mottle: 0.22, fine: 0.05 });
  relief(S, { pores: 0.1, lines: 0.12, crease: 0.18, creaseF: 12, lump: 0.12 });
  patches(S, { f: 4, at: 0.58, soft: 0.14, mul: [1.12, 1.12, 1.1], k: 0.6, salt: 1 });
  patches(S, { f: 3, at: 0.6, soft: 0.14, mul: [0.8, 0.76, 0.9], k: 0.6, salt: 2 });
  veins(S, { count: 80, len: 0.2, w: 0.0032, depth: 5, core: [0.5, 0.52, 0.8], halo: [0.8, 0.8, 0.94], coreK: 0.85, haloK: 0.65, cap: 0.6, capF: 30, raise: 0.12, clusterAt: 0.15 });
  splits(S, { count: 34 });
  grime(S, { k: 0.3, blot: 0.12, smear: 0.1 });
  driedBlood(S, { spray: 12, at: 0.84 });
  return finish(S, { n: 8, ao: 0.5 });
}

/** Boss: a patchwork of tissues — rotten skin, raw muscle, tumours, bone plates — sewn together. */
export function skinBoss(N) {
  const S = skinCtx(N, 1801);
  S.rough.fill(0.7); S.thick.fill(0.2);
  baseTone(S, ['#6c584e', '#594839', '#786256'], { mottle: 0.4 });
  relief(S, { pores: 0.3, lines: 0.3, crease: 0.7, creaseF: 9, lump: 0.5 });
  const cell = {}, c2 = {};
  const mus = lin('#661f17'), tum = lin('#b0937a'), bone = lin('#c2b492'), rot = [0.6, 0.62, 0.5], seam = lin('#1f110b');
  each(S, (u, v, i) => {
    const wu = u + fbm(u, v, 5, 3, 1802) * 0.05, wv = v + fbm(u, v, 5, 3, 1803) * 0.05;
    cells(wu, wv, 5, 1804, cell, 0.9);
    const kind = Math.floor(((cell.id * 0.61803) % 1) * 5);
    const e = cell.f2 - cell.f1;
    const sm = smooth(0.03, 0.1, e);
    const n = wfbm(u, v, 40, 3, 1805, 0.02);
    if (kind === 1) {
      const fib = Math.abs(noise(u * 600, v * 40, 600, 40, 1806));
      S.alb.lay(i, mixc(mus, sc(mus, 0.5), fib), sm * 0.95);
      S.h[i] += sm * (fib * 0.5 - 0.4);
      S.rough[i] = mix(S.rough[i], 0.3, sm);
    } else if (kind === 2) {
      cells(u, v, 30, 1807, c2, 1);
      const b = 1 - c2.f1;
      S.alb.lay(i, mixc(tum, sc(tum, 1.15), b), sm * 0.9);
      S.alb.mul(i, [0.7, 0.55, 0.62], smooth(0.4, 0.1, b) * sm * 0.5);
      S.h[i] += sm * b * b * 2.6;
      S.rough[i] = mix(S.rough[i], 0.4, sm);
      S.thick[i] = mix(S.thick[i], 0.7, sm);
    } else if (kind === 3) {
      S.alb.lay(i, sc(bone, 0.75 + n * 0.35), sm * 0.9);
      S.h[i] += sm * (1 + n * 0.5);
      S.rough[i] = mix(S.rough[i], 0.78, sm);
      S.thick[i] = mix(S.thick[i], 0, sm);
    } else if (kind === 4) S.alb.mul(i, rot, sm * 0.8);
    // seams between the tissues: a dark crusted ridge, a furrow in the middle
    const sw = 1 - smooth(0.0, 0.04, e);
    S.alb.lay(i, seam, sw * 0.85);
    S.h[i] += sw * 0.8 - (1 - smooth(0, 0.012, e)) * 1.2;
  });
  veins(S, { count: 22, len: 0.25, w: 0.007, depth: 4, core: [0.45, 0.36, 0.38], halo: [0.75, 0.68, 0.68], coreK: 0.7, haloK: 0.5, raise: 0.4 });
  scars(S, { count: 14, stitched: 0.8, col: '#7a605a' });
  grime(S, { k: 0.55, blot: 0.3, smear: 0.25, col: '#2a1e16' });
  driedBlood(S, { spray: 30, at: 0.74 });
  return finish(S, { n: 18, ao: 0.85 });
}

export const SKIN_SETS = {
  'skin-fresh': skinFresh,
  'skin-weeks': skinWeeks,
  'skin-months': skinMonths,
  'skin-bloater': skinBloater,
  'skin-spitter': skinSpitter,
  'skin-brute': skinBrute,
  'skin-screamer': skinScreamer,
  'skin-boss': skinBoss,
};
