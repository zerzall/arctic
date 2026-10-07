// Fabrics (scripts/bake-zombies.js): eleven tileable cloths for the dead — denim, flannel,
// cotton tee, hospital gown, police uniform, military ripstop, workwear canvas, business
// shirting, suiting, hoodie fleece, a printed dress fabric — woven or knitted thread by thread
// (twill, plain, oxford basket, jersey, ripstop), then worn: slubs and fading, sun-bleached
// blotches, grime and tide-marked stains, threadbare patches, pilling, and holes with frayed
// edges (the hole mask itself is the grime set's, scripts/zbake/misc.js, shared by every fabric).
//
// The albedo is a relative brightness (0.5 = the garment's own colour, which the runtime takes
// from the zombie's look) so one tile serves every colour; pack B is "bleach" (how far a thread
// goes toward white: denim's weft, oxford's white weft, sun-fade, a print).
// A tile spans 16 model units (48 cm); the thread counts are a little coarse so the weave reads.

import { Rgb, blur, fbm, cells, noise, smooth, clamp01, mix, hash3 } from './lib.js';
import { wfbm } from './skin.js';

export const CLOTH_TILE_UNITS = 16;

const TAU = Math.PI * 2;

/**
 * Weave height and which thread is on top at (u, v):
 *   threads per tile (warp along v = vertical threads, weft along u), weave kind
 * → { h (0..1), warpTop (bool), i (warp index), j (weft index), fu, fv }
 */
function weaveAt(u, v, o, out) {
  const W = o.warp, F = o.weft;
  const x = u * W, y = v * F;
  const i = Math.floor(x), j = Math.floor(y);
  const fu = x - i, fv = y - j;
  let warpTop;
  switch (o.weave) {
    case 'twill31': warpTop = ((i + j) % 4 + 4) % 4 !== 0; break;
    case 'twill22': warpTop = (((i + j) % 4) + 4) % 4 < 2; break;
    case 'twill21': warpTop = (((i + 2 * j) % 3) + 3) % 3 !== 0; break;
    case 'basket': warpTop = ((Math.floor(i / 2) + j) % 2) === 0; break;
    default: warpTop = ((i + j) % 2) === 0;
  }
  // a thread is a rounded strand; the top one bulges between the crossings
  const across = warpTop ? fu : fv, along = warpTop ? fv : fu;
  const prof = Math.sqrt(Math.max(0, 1 - Math.pow((across - 0.5) * 2, 2)));
  const bulge = 0.65 + 0.35 * Math.sin(along * Math.PI);
  out.h = prof * bulge;
  out.warpTop = warpTop; out.i = i; out.j = j; out.fu = fu; out.fv = fv;
  return out;
}

/** Jersey knit: columns of V-shaped loops (two slanted legs per stitch). */
function knitAt(u, v, cols, rows, out) {
  const x = u * cols, y = v * rows;
  const i = Math.floor(x), j = Math.floor(y);
  const fu = x - i, fv = y - j;
  let h = 0;
  for (const side of [-1, 1]) {
    const cx = 0.5 + side * 0.22, a = side * 0.55;
    const dx = fu - cx, dy = fv - 0.5;
    const rx = dx * Math.cos(a) - dy * Math.sin(a), ry = dx * Math.sin(a) + dy * Math.cos(a);
    const d = Math.hypot(rx / 0.2, ry / 0.62);
    h = Math.max(h, d < 1 ? Math.sqrt(1 - d * d) : 0);
  }
  out.h = h; out.i = i; out.j = j; out.warpTop = true; out.fu = fu; out.fv = fv;
  return out;
}

/** A plaid sett: bands along one axis → { lum, bleach } for coordinate t (0..1 over the tile). */
function sett(t, bands) {
  let x = (t % 1 + 1) % 1, acc = 0;
  const total = bands.reduce((s, b) => s + b[0], 0);
  x *= total;
  for (const b of bands) { acc += b[0]; if (x < acc) return b; }
  return bands[bands.length - 1];
}

/**
 * Build a fabric. o: { seed, warp, weft, weave | knit: [cols, rows], warpLum, weftLum,
 * warpBleach, weftBleach, slub, fuzz, pattern(u, v) → { lum, bleach }, holes, wear, rough, n }
 */
function fabric(N, o) {
  const n = N * N, s = o.seed;
  const lum = new Float32Array(n), h = new Float32Array(n), bleach = new Float32Array(n), rough = new Float32Array(n);
  const w = {}, cell = {};
  for (let y = 0; y < N; y++) {
    const v = (y + 0.5) / N;
    for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N, i = y * N + x;
      // threads wander a little (no ruler-straight grid)
      const wu = u + fbm(u, v, 8, 2, s + 1) * 0.0018, wv = v + fbm(u, v, 8, 2, s + 2) * 0.0018;
      if (o.knit) knitAt(wu, wv, o.knit[0], o.knit[1], w); else weaveAt(wu, wv, o, w);
      // yarn: per-thread tone, slubs (thick-thin) along the thread
      const tid = w.warpTop ? w.i : w.j;
      const yarn = (hash3(tid, w.warpTop ? 1 : 2, s) - 0.5) * (o.yarn ?? 0.12);
      const slub = noise((w.warpTop ? v : u) * (o.slubF ?? 40), tid * 0.37, o.slubF ?? 40, 4096, s + 3) * (o.slub ?? 0.1);
      let L = (w.warpTop ? (o.warpLum ?? 1) : (o.weftLum ?? 1)) + yarn + slub;
      let B = w.warpTop ? (o.warpBleach ?? 0) : (o.weftBleach ?? 0);
      let H = w.h * (1 + slub * 2);
      // the shaded gaps between threads
      L *= 0.72 + 0.28 * w.h;
      if (o.pattern) { const p = o.pattern(u, v, w); L *= p.lum; B = Math.max(B, p.bleach || 0); if (p.h) H += p.h; }
      // fuzz: fibres sticking up, catching light
      const fz = (fbm(u, v, 160, 3, s + 4) * 0.5 + 0.5) * (o.fuzz ?? 0.15);
      H = mix(H, 0.6, (o.fuzz ?? 0.15) * 0.8) + fz * 0.6;
      L += fz * 0.25;
      // pilling (knits): little balls of fibre
      if (o.pills) {
        cells(u, v, 90, s + 5, cell, 1);
        if ((cell.id * 0.7713) % 1 < o.pills && cell.f1 < 0.18) { const t = 1 - cell.f1 / 0.18; H += t * 1.2; L += t * 0.12; }
      }
      // wear: sun-bleached blotches, threadbare patches (flattened, paler), grime, stains
      const sun = smooth(0.45, 0.85, wfbm(u, v, 2, 4, s + 6, 0.1)) * (o.sun ?? 0.35);
      const bare = smooth(0.66, 0.8, wfbm(u, v, 4, 5, s + 7, 0.08)) * (o.wear ?? 0.5);
      const grime = wfbm(u, v, 5, 5, s + 8, 0.08);
      const st = wfbm(u, v, 3, 5, s + 9, 0.12);
      const stain = smooth(0.62, 0.66, st) * 0.35 + smooth(0.655, 0.665, st) * (1 - smooth(0.665, 0.69, st)) * 0.35;   // a tide line at the edge
      B = Math.max(B, sun * 0.55 + bare * 0.4);
      H = mix(H, 0.45, bare * 0.6);
      L *= (1 - (grime - 0.5) * 0.45) * (1 - stain * 0.5) * (1 + bare * 0.15);
      lum[i] = L; h[i] = H; bleach[i] = clamp01(B);
      rough[i] = clamp01((o.rough ?? 0.92) + (1 - w.h) * 0.04 - bare * 0.04);
    }
  }
  const alb = new Rgb(N);
  for (let i = 0; i < n; i++) {
    // relative brightness about 0.5 (a linear value: the runtime divides by 0.5)
    const c = clamp01(lum[i] * 0.5);
    alb.r[i] = c; alb.g[i] = c; alb.b[i] = c;
  }
  // ambient occlusion from the weave (baked into the brightness already, kept for the pack)
  const hb = blur(h, N, Math.max(1, N / 1024));
  const ao = new Float32Array(n);
  for (let i = 0; i < n; i++) ao[i] = 1 - clamp01((hb[i] - h[i]) * 1.5) * 0.6;
  return { alb, h, rough, ao, b: bleach, nStrength: o.n ?? 2.2 };
}

// ---------------------------------------------------------------------------------------
// the fabrics

const camo = (s) => (u, v) => {
  const a = wfbm(u, v, 3, 5, s + 51, 0.1), b = wfbm(u, v, 4, 5, s + 52, 0.1), c = wfbm(u, v, 5, 4, s + 53, 0.1);
  if (c > 0.66) return { lum: 0.32 };              // black
  if (a > 0.6) return { lum: 0.62 };                // brown
  if (b > 0.62) return { lum: 1.05, bleach: 0.5 };  // tan
  return { lum: 1 };                                // the base green
};

const PLAID = [[10, 0.38, 0], [2, 1, 0.65], [4, 0.6, 0], [10, 1, 0], [1.5, 0.3, 0], [3, 1, 0.3]];

export function denim(N) {
  return fabric(N, {
    seed: 3101, warp: 420, weft: 360, weave: 'twill31', warpLum: 0.95, weftLum: 1.25, weftBleach: 0.75, yarn: 0.22, slub: 0.16, slubF: 60, fuzz: 0.08, sun: 0.5, wear: 0.6, n: 2.6,
    // rope-dyed warp: lighter streaks down the leg; whiskers of fading
    pattern: (u, v) => ({ lum: 1 + (noise(u * 300, 3, 300, 8, 3111) * 0.12), bleach: smooth(0.6, 0.9, wfbm(u * 2, v * 0.5, 3, 4, 3112, 0.1)) * 0.35 }),
  });
}
export function flannel(N) {
  return fabric(N, {
    seed: 3201, warp: 300, weft: 300, weave: 'twill22', yarn: 0.08, slub: 0.08, fuzz: 0.45, sun: 0.3, wear: 0.45, rough: 0.95, n: 1.6,
    pattern: (u, v) => { const a = sett(u * 3, PLAID), b = sett(v * 3, PLAID); return { lum: Math.min(a[1], b[1]) * (0.85 + 0.15 * Math.max(a[1], b[1])), bleach: Math.max(a[2], b[2]) * (a[2] && b[2] ? 1 : 0.7) }; },
  });
}
export function tee(N) {
  return fabric(N, { seed: 3301, knit: [340, 280], yarn: 0.05, slub: 0.05, fuzz: 0.2, pills: 0.02, sun: 0.45, wear: 0.55, n: 1.8, pattern: (u, v) => ({ lum: 1 + (fbm(u, v, 60, 2, 3311)) * 0.06 }) });
}
export function gown(N) {
  return fabric(N, {
    seed: 3401, warp: 460, weft: 440, weave: 'plain', yarn: 0.06, slub: 0.08, fuzz: 0.12, sun: 0.3, wear: 0.4, n: 1.5,
    // the hospital print: small diamonds on a lattice, a dot between
    pattern: (u, v) => {
      const gx = u * 22, gy = v * 22;
      const fx = gx - Math.floor(gx) - 0.5, fy = gy - Math.floor(gy) - 0.5;
      const dia = Math.abs(fx) + Math.abs(fy) < 0.16 ? 1 : 0;
      const fx2 = ((gx + 0.5) % 1) - 0.5, fy2 = ((gy + 0.5) % 1) - 0.5;
      const dot = Math.hypot(fx2, fy2) < 0.06 ? 1 : 0;
      return { lum: 1 - dia * 0.45, bleach: dot * 0.6 };
    },
  });
}
export function police(N) {
  return fabric(N, { seed: 3501, warp: 520, weft: 400, weave: 'twill21', warpLum: 1, weftLum: 0.9, yarn: 0.06, slub: 0.05, fuzz: 0.06, sun: 0.4, wear: 0.45, rough: 0.82, n: 1.6 });
}
export function military(N) {
  return fabric(N, {
    seed: 3601, warp: 380, weft: 380, weave: 'plain', yarn: 0.08, slub: 0.06, fuzz: 0.08, sun: 0.4, wear: 0.4, n: 2.0,
    pattern: (u, v, w) => {
      const p = camo(3601)(u, v);
      // the ripstop grid: a heavier thread every 8
      const grid = (w.i % 8 === 0 && w.warpTop) || (w.j % 8 === 0 && !w.warpTop) ? 1 : 0;
      return { lum: p.lum * (1 + grid * 0.06), bleach: p.bleach || 0, h: grid * 0.35 };
    },
  });
}
export function work(N) {
  return fabric(N, { seed: 3701, warp: 200, weft: 180, weave: 'plain', yarn: 0.16, slub: 0.18, slubF: 30, fuzz: 0.12, sun: 0.45, wear: 0.65, rough: 0.9, n: 3.0 });
}
export function shirt(N) {
  return fabric(N, { seed: 3801, warp: 560, weft: 380, weave: 'basket', warpLum: 0.95, weftLum: 1.15, weftBleach: 0.45, yarn: 0.06, slub: 0.05, fuzz: 0.08, sun: 0.3, wear: 0.4, rough: 0.88, n: 1.6 });
}
export function suit(N) {
  return fabric(N, { seed: 3901, warp: 600, weft: 560, weave: 'twill22', yarn: 0.05, slub: 0.04, fuzz: 0.14, sun: 0.35, wear: 0.4, rough: 0.86, n: 1.4,
    pattern: (u, v) => ({ lum: 1 + (fbm(u, v, 90, 2, 3911)) * 0.05 }) });
}
export function hoodie(N) {
  return fabric(N, { seed: 4001, knit: [220, 180], yarn: 0.06, slub: 0.08, fuzz: 0.38, pills: 0.06, sun: 0.45, wear: 0.5, rough: 0.97, n: 2.2, pattern: (u, v) => ({ lum: 1 + (fbm(u, v, 50, 2, 4011)) * 0.08 }) });
}
export function dress(N) {
  return fabric(N, {
    seed: 4101, warp: 480, weft: 460, weave: 'plain', yarn: 0.05, slub: 0.05, fuzz: 0.08, sun: 0.5, wear: 0.45, rough: 0.85, n: 1.3,
    // a scattered floral print: pale petals round a dark centre, darker leaves
    pattern: (u, v) => {
      const c = cells(u, v, 9, 4111, {}, 0.8);
      const ang = Math.atan2(c.dy, c.dx), r = c.f1;
      const petal = r < 0.22 * (0.6 + 0.4 * Math.abs(Math.cos(ang * 2.5))) ? 1 : 0;
      const centre = r < 0.05 ? 1 : 0;
      const c2 = cells(u + 0.031, v + 0.057, 14, 4112, {}, 0.9);
      const leaf = c2.f1 < 0.12 && Math.abs(Math.sin(Math.atan2(c2.dy, c2.dx) + 0.6)) > 0.6 ? 1 : 0;
      return { lum: centre ? 0.45 : leaf && !petal ? 0.6 : 1, bleach: petal && !centre ? 0.7 : 0 };
    },
  });
}

export const CLOTH_SETS = {
  'cloth-denim': denim, 'cloth-flannel': flannel, 'cloth-tee': tee, 'cloth-gown': gown, 'cloth-police': police,
  'cloth-military': military, 'cloth-work': work, 'cloth-shirt': shirt, 'cloth-suit': suit, 'cloth-hoodie': hoodie, 'cloth-dress': dress,
};
