// Ground recipes: asphalt and its large-scale wear, road paint, grass, dirt, mud, gravel, rail
// ballast, sand, rock, sandstone strata and cracked earth. Sizes are written for 2048² (× m.s).

import { fbm, voronoi, blur, field, smooth, clamp01, lerp, hash01, warp, trailDown } from '../noise.js';
import { ramp, vary, cracks, hairlines, blotch, flecks } from '../fx.js';
import { hex } from '../surface.js';
import { applyCracks } from './common.js';

/**
 * A layer of stones: Voronoi cells shrunk by a gap (binder / soil between them), each domed (round:
 * river gravel) or faceted (angular: crushed rock), its own colour from `pal`, worn flat on top by
 * `flat` (0..1). Writes where the stone is above what is there (max height) and returns its mask.
 */
function stones(m, seed, o) {
  const N = m.N;
  const cells = o.cells;
  const wx = fbm(N, { p: Math.max(4, cells >> 2), oct: 4, seed: seed + 1 }), wy = fbm(N, { p: Math.max(4, cells >> 2), oct: 4, seed: seed + 2 });
  const v = voronoi(N, cells, cells, seed, { jitter: 1, wx, wy, wamt: (o.warp ?? 0.35) * (N / cells) });
  const fine = fbm(N, { p: Math.min(512, cells * 8), oct: 2, seed: seed + 3 });
  const pal = o.pal.map(hex);
  const cover = field(N);
  const cellR = N / cells * 0.5;
  for (let i = 0; i < m.NN; i++) {
    const id = v.id[i];
    if (id > (o.density ?? 1)) continue;
    const size = 0.55 + hash01(Math.floor(id * 1e6), 1, seed) * 0.6;
    const gap = cellR * (1 - size * (o.fill ?? 0.9));
    const e = v.edge[i] - gap;
    if (e <= 0) continue;
    const r = cellR * size;
    let dome;
    if (o.angular) {
      // facets: a tilted plane per stone, clipped by the edge falloff
      const a = hash01(Math.floor(id * 1e6), 2, seed) * 6.283, t = 0.3 + hash01(Math.floor(id * 1e6), 3, seed) * 0.5;
      const dx = (i % N) + 0.5 - v.px[i], dy = Math.floor(i / N) + 0.5 - v.py[i];
      dome = clamp01(0.75 + (Math.cos(a) * dx + Math.sin(a) * dy) / r * t * 0.5) * smooth(0, r * 0.25, e);
    } else {
      dome = Math.sqrt(clamp01(e / (r * 0.7)));
    }
    const top = Math.min(dome, 1 - (o.flat ?? 0) * 0.5);
    const hgt = (o.base ?? 0.45) + top * (o.lift ?? 0.5) * (0.7 + size * 0.4) + (fine[i] - 0.5) * 0.03;
    if (hgt <= m.h[i]) continue;
    const k = smooth(0, Math.max(1, r * 0.08), e);
    const c = vary(pal[Math.floor(id * 997) % pal.length], 0.82 + ((id * 7919) % 1) * 0.36 + (fine[i] - 0.5) * 0.12 + top * 0.06, ((id * 31) % 1 - 0.5) * 0.12);
    m.mix(i, c, k);
    m.h[i] = lerp(m.h[i], hgt, k);
    m.rough[i] = lerp(m.rough[i], (o.rough ?? 0.7) - top * (o.flat ?? 0) * 0.25 + (fine[i] - 0.5) * 0.08, k);
    m.tint[i] = lerp(m.tint[i], o.tint ?? 0.3, k);
    cover[i] = Math.max(cover[i], k);
  }
  return cover;
}

/** Fill the surface with a soil / binder colour from a noise ramp. */
function soil(m, seed, o) {
  const N = m.N;
  const a = fbm(N, { p: o.p ?? 6, oct: 7, seed: seed + 1, gain: 0.58 });
  const b = fbm(N, { p: 96, oct: 3, seed: seed + 2 });
  const g = fbm(N, { p: 512, oct: 1, seed: seed + 3 });
  const pal = o.pal.map(hex);
  for (let i = 0; i < m.NN; i++) {
    const t = clamp01(a[i] * 0.7 + b[i] * 0.3);
    const c = ramp(pal.map((c, k) => [k / (pal.length - 1), c]), t);
    m.set(i, vary(c, 0.92 + (g[i] - 0.5) * (o.grain ?? 0.25) + (b[i] - 0.5) * 0.1));
    m.h[i] = (o.h ?? 0.35) + (a[i] - 0.5) * (o.relief ?? 0.12) + (b[i] - 0.5) * 0.06 + (g[i] - 0.5) * 0.04;
    m.micro[i] = g[i];
    m.rough[i] = o.rough ?? 0.92;
    m.tint[i] = o.tint ?? 0.6;
  }
  return { a, b, g };
}

/** Grass blades: short strokes leaning one way and another, of many greens and dry straw. */
function blades(m, seed, o) {
  const N = m.N, M = N - 1;
  const clump = fbm(N, { p: 10, oct: 4, seed: seed + 1 });
  const dry = fbm(N, { p: 5, oct: 5, seed: seed + 2 });
  const greens = (o.greens || ['#4d6b2a', '#5e7d33', '#3f5a24', '#6f8a3c', '#52742e', '#7a8f45']).map(hex);
  const straw = (o.straw || ['#a39a62', '#8e8550', '#b5aa74']).map(hex);
  const count = Math.round((o.count ?? 110000) * m.s * m.s);
  for (let k = 0; k < count; k++) {
    const x = hash01(k, 1, seed) * N, y = hash01(k, 2, seed) * N;
    const ci = (Math.floor(y) & M) * N + (Math.floor(x) & M);
    if (hash01(k, 9, seed) > 0.35 + clump[ci] * 0.9) continue;
    const ang = hash01(k, 3, seed) * Math.PI * 2;
    const len = m.mm((o.len ?? 22) * (0.5 + hash01(k, 4, seed))), wid = Math.max(0.6, m.mm(o.wid ?? 1.6) * (0.6 + hash01(k, 5, seed) * 0.6));
    const isDry = hash01(k, 6, seed) < 0.12 + smooth(0.5, 0.8, dry[ci]) * (o.dry ?? 0.5);
    const col = isDry ? straw[k % straw.length] : greens[k % greens.length];
    const hb = 0.5 + hash01(k, 7, seed) * 0.45;
    const dx = Math.cos(ang), dy = Math.sin(ang), n = Math.max(2, Math.ceil(len));
    for (let t = 0; t < n; t++) {
      const f = t / n;
      const w = wid * (1 - f * 0.8);
      const cx = x + dx * t, cy = y + dy * t;
      const R = Math.ceil(w);
      for (let oy = -R; oy <= R; oy++) {
        for (let ox = -R; ox <= R; ox++) {
          if (ox * ox + oy * oy > w * w) continue;
          const i = ((Math.floor(cy) + oy) & M) * N + ((Math.floor(cx) + ox) & M);
          const hh = hb * (0.65 + f * 0.35);   // (the blade rises toward its tip, seen from above)
          if (hh <= m.h[i]) continue;
          const shade = 0.75 + f * 0.4;
          m.set(i, vary(col, shade, isDry ? 0.02 : 0));
          m.h[i] = hh;
          m.rough[i] = isDry ? 0.8 : 0.62;
          m.tint[i] = isDry ? 0.4 : 0.85;
        }
      }
    }
  }
}

export const GROUND = [
  {
    name: 'asphalt', det: 'asphalt', depth: 6,
    about: 'asphalt concrete: angular aggregate of several rocks set in the binder, worn flat and polished by tyres, sand in the voids, pull-outs and tar bleeding',
    bake(m, seed) {
      const N = m.N;
      soil(m, seed, { pal: ['#1d1d1e', '#262627', '#2e2d2c', '#232324'], h: 0.3, relief: 0.04, rough: 0.9, tint: 0.7, grain: 0.35 });
      const rock = ['#5c5b58', '#6e6c67', '#4b4a48', '#8a8680', '#6b6158', '#55524e', '#7b736a'];
      stones(m, seed + 10, { cells: 70, pal: rock, angular: true, flat: 0.8, lift: 0.45, base: 0.35, fill: 0.85, density: 0.9, tint: 0.45, rough: 0.6 });
      stones(m, seed + 20, { cells: 170, pal: rock, angular: true, flat: 0.6, lift: 0.35, base: 0.33, fill: 0.8, density: 0.8, tint: 0.5, rough: 0.65 });
      // pull-outs (a stone gone, a dark socket) and tar bleeding up in smooth patches
      const pull = voronoi(N, 60, 60, seed + 30, { jitter: 1 });
      const tar = blotch(N, { p: 4, oct: 6, seed: seed + 31, t: 0.79, e: 0.04 }).mask;
      for (let i = 0; i < m.NN; i++) {
        const p = pull.id[i] < 0.04 ? smooth(m.mm(6), m.mm(3), pull.f1[i]) : 0;
        m.h[i] -= p * 0.25;
        m.mix(i, [0.05, 0.05, 0.05], p * 0.8 + tar[i] * 0.45);
        m.rough[i] = lerp(m.rough[i], 0.5, tar[i] * 0.6);
        m.h[i] = lerp(m.h[i], 0.42, tar[i] * 0.5);
      }
      m.grime({ amt: 0.35, rad: 4, gain: 10, color: [0.05, 0.05, 0.05], wear: 0.1 });
    },
  },
  {
    name: 'road_wear', det: 'crackmacro', depth: 10,
    about: 'old road at the large scale: block and alligator cracking with ravelled rims, black crack sealant, patches of newer and older asphalt, oil drips',
    bake(m, seed) {
      const N = m.N;
      soil(m, seed, { pal: ['#3a3a3a', '#434241', '#3c3b3a'], h: 0.55, relief: 0.03, rough: 0.85, tint: 0.7, grain: 0.15 });
      // patches: rectangles of other asphalt with a tarred seam
      for (let k = 0; k < 4; k++) {
        const cx = hash01(k, 1, seed) * N, cy = hash01(k, 2, seed) * N;
        const w = m.mm(400 + hash01(k, 3, seed) * 1400), h = m.mm(300 + hash01(k, 4, seed) * 900);
        const tone = hash01(k, 5, seed) < 0.5 ? 0.88 : 1.12;
        for (let y = Math.floor(cy - h / 2 - 4); y < cy + h / 2 + 4; y++) {
          for (let x = Math.floor(cx - w / 2 - 4); x < cx + w / 2 + 4; x++) {
            const i = ((y + N) % N) * N + ((x + N) % N);
            const d = Math.min(x - (cx - w / 2), cx + w / 2 - x, y - (cy - h / 2), cy + h / 2 - y);
            if (d < -m.mm(25)) continue;
            const inside = smooth(-m.mm(30), m.mm(30), d + (hash01(x >> 3, y >> 3, k) - 0.5) * m.mm(40)), seam = smooth(m.mm(15), 0, Math.abs(d)) * 0.6;
            m.mul(i, lerp(1, tone, inside));
            m.h[i] += inside * 0.03 * (tone > 1 ? -1 : 1);
            m.mix(i, [0.07, 0.07, 0.07], seam * 0.8);
            m.rough[i] = lerp(m.rough[i], 0.55, seam * 0.7);
            m.h[i] += seam * 0.06;
          }
        }
      }
      // block cracking at two scales, alligator cracking in two patches
      const c1 = cracks(N, { cells: 5, seed: seed + 10, keep: 0.55, width: 5, warp: 220 });
      const c2 = cracks(N, { cells: 12, seed: seed + 11, keep: 0.35, width: 3, warp: 90 });
      const gator = voronoi(N, 70, 70, seed + 12, { jitter: 1, wx: fbm(N, { p: 16, oct: 3, seed: seed + 13 }), wy: fbm(N, { p: 16, oct: 3, seed: seed + 14 }), wamt: 20 * m.s });
      const gz = blotch(N, { p: 3, oct: 5, seed: seed + 15, t: 0.64, e: 0.06 }).mask;
      const seal = blotch(N, { p: 3, oct: 5, seed: seed + 16, t: 0.55, e: 0.02 }).mask;
      const rav = fbm(N, { p: 64, oct: 3, seed: seed + 17 });
      for (let i = 0; i < m.NN; i++) {
        const ga = (1 - smooth(m.mm(1.5), m.mm(5), gator.edge[i])) * gz[i];
        const cr = Math.max(c1[i], c2[i] * 0.8, ga);
        const sealed = seal[i] * Math.max(c1[i], c2[i]);
        // ravelled rims: aggregate loosened along the crack
        const rim = smooth(0.0, 0.5, cr) * (1 - cr) * rav[i];
        m.h[i] -= cr * 0.35 * (1 - sealed) - sealed * 0.08 + rim * 0.04;
        m.mix(i, [0.03, 0.03, 0.03], cr * 0.85 + sealed * 0.3);
        m.mix(i, [0.42, 0.41, 0.39], rim * 0.25);
        m.rough[i] = lerp(m.rough[i], sealed > 0.5 ? 0.4 : 0.95, Math.max(cr, sealed));
        m.tint[i] *= 1 - Math.max(cr, sealed) * 0.8;
      }
      const oil = blotch(N, { p: 5, oct: 6, seed: seed + 18, t: 0.74, e: 0.04 }).mask;
      for (let i = 0; i < m.NN; i++) { m.mix(i, [0.05, 0.05, 0.05], oil[i] * 0.5); m.rough[i] = lerp(m.rough[i], 0.35, oil[i] * 0.6); m.tint[i] *= 1 - oil[i] * 0.5; }
    },
  },
  {
    name: 'road_paint', det: 'roadpaint', depth: 3,
    about: 'thermoplastic road paint: a thick, slightly lumpy line with glass beads, cracked into plates and worn through to the asphalt by the tyres',
    bake(m, seed) {
      const N = m.N;
      soil(m, seed, { pal: ['#1f1f20', '#2a2a2a'], h: 0.2, relief: 0.03, rough: 0.9, tint: 0, grain: 0.35 });
      const wear = warp(N, fbm(N, { p: 4, oct: 7, seed: seed + 1, gain: 0.6 }), fbm(N, { p: 8, oct: 3, seed: seed + 2 }), fbm(N, { p: 8, oct: 3, seed: seed + 3 }), 30 * m.s);
      const plates = voronoi(N, 18, 18, seed + 4, { jitter: 1 });
      const lump = fbm(N, { p: 24, oct: 4, seed: seed + 5 });
      const beads = fbm(N, { p: 512, oct: 1, seed: seed + 6 });
      for (let i = 0; i < m.NN; i++) {
        const p = 1 - smooth(0.66, 0.69, wear[i]);
        const crack = plates.id[i] < 0.1 ? 0.25 - 0.25 * smooth(m.mm(0.3), m.mm(0.8), plates.edge[i] + (lump[i] - 0.5) * m.mm(1.5)) : 0;
        const k = p * (1 - crack * 0.9);
        const c = vary([0.86, 0.86, 0.83], 0.92 + (lump[i] - 0.5) * 0.12 + (beads[i] > 0.85 ? 0.08 : 0));
        m.mix(i, c, k);
        m.h[i] = lerp(m.h[i], 0.7 + (lump[i] - 0.5) * 0.15, k);
        m.rough[i] = lerp(m.rough[i], beads[i] > 0.85 ? 0.25 : 0.55, k);
        m.tint[i] = k;
      }
      m.grime({ amt: 0.3, rad: 4, gain: 10, color: [0.2, 0.2, 0.19], wear: 0.02 });
    },
  },
  {
    name: 'grass', det: 'grass', depth: 30,
    about: 'grass seen from above: thousands of blades of many greens in clumps, dry straw among them, soil and old leaves in the gaps',
    bake(m, seed) {
      soil(m, seed, { pal: ['#3b2f22', '#4a3c2a', '#33291e'], h: 0.15, relief: 0.06, rough: 0.95, tint: 0.3 });
      blades(m, seed + 10, {});
      m.grime({ amt: 0.4, rad: 6, gain: 6, color: [0.06, 0.07, 0.04], wear: 0.05 });
    },
  },
  {
    name: 'dirt', det: 'dirt', depth: 14,
    about: 'packed earth: soil tones from umber to grey, clods, crumbs, small stones, twigs and dead leaves, damp darker patches',
    bake(m, seed) {
      const N = m.N;
      soil(m, seed, { pal: ['#4e3d2c', '#5c4934', '#6a5640', '#57483a', '#4a3f33'], h: 0.4, relief: 0.2, rough: 0.94, tint: 0.65 });
      // clods: lumps of soil, crumbs
      const cl = voronoi(N, 40, 40, seed + 5, { jitter: 1, wx: fbm(N, { p: 12, oct: 4, seed: seed + 6 }), wy: fbm(N, { p: 12, oct: 4, seed: seed + 7 }), wamt: 40 * m.s });
      for (let i = 0; i < m.NN; i++) {
        if (cl.id[i] > 0.35) continue;
        const k = smooth(0, m.mm(10), cl.edge[i]);
        m.h[i] += k * 0.18 * (0.5 + cl.id[i]);
        m.mul(i, 1 + k * 0.08);
      }
      stones(m, seed + 10, { cells: 90, pal: ['#7a746a', '#8d8478', '#5f5a52', '#9a8c74'], density: 0.18, fill: 0.7, lift: 0.4, base: 0.4, tint: 0.3 });
      // twigs and leaf bits
      for (let k = 0; k < 700 * m.s * m.s * 4; k++) {
        const x = hash01(k, 1, seed) * N, y = hash01(k, 2, seed) * N, a = hash01(k, 3, seed) * Math.PI, len = m.mm(15 + hash01(k, 4, seed) * 50);
        for (let t = 0; t < len; t++) {
          const i = (((Math.floor(y + Math.sin(a) * t)) % N + N) % N) * N + (((Math.floor(x + Math.cos(a) * t)) % N + N) % N);
          m.mix(i, [0.24, 0.17, 0.1], 0.7); m.h[i] = Math.max(m.h[i], 0.62); m.tint[i] *= 0.4;
        }
      }
      flecks(N, Math.round(1600 * m.s * m.s * 4), m.mm(3), m.mm(8), seed + 20, (i, k, n) => {
        const c = [[0.38, 0.24, 0.1], [0.3, 0.22, 0.12], [0.45, 0.33, 0.15]][n % 3];
        m.mix(i, c, smooth(0, 0.2, k) * 0.8); m.h[i] = Math.max(m.h[i], 0.55); m.tint[i] *= 0.5;
      });
      const damp = blotch(N, { p: 4, oct: 6, seed: seed + 30, t: 0.62, e: 0.08 }).mask;
      for (let i = 0; i < m.NN; i++) { m.mul(i, 1 - damp[i] * 0.3); m.rough[i] -= damp[i] * 0.15; }
      m.grime({ amt: 0.35, rad: 6, gain: 7, color: [0.12, 0.09, 0.06], wear: 0.1 });
    },
  },
  {
    name: 'mud', det: 'mud', depth: 18,
    about: 'wet mud: churned, boot and tyre marks, glossy water standing in the low spots, drier crusted ridges, bits of straw and grit',
    bake(m, seed) {
      const N = m.N;
      const { a } = soil(m, seed, { pal: ['#33281d', '#3d3024', '#4a3a2b', '#2e2419'], h: 0.4, relief: 0.35, rough: 0.6, tint: 0.55 });
      const churn = fbm(N, { p: 14, oct: 5, seed: seed + 3, ridge: true });
      // ruts along v
      const rut = fbm(N, { pu: 2, pv: 1, oct: 3, seed: seed + 4 });
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          const u = x / N + (rut[i] - 0.5) * 0.1;
          const r = Math.exp(-Math.pow((((u * 2) % 1) - 0.5) / 0.12, 2));
          m.h[i] += (churn[i] - 0.5) * 0.12 - r * 0.15;
        }
      }
      // boot prints: ovals pressed in, with a ridged rim
      for (let k = 0; k < 28; k++) {
        const cx = hash01(k, 1, seed) * N, cy = hash01(k, 2, seed) * N, ang = hash01(k, 3, seed) * 6.283;
        const L = m.mm(140), W = m.mm(50), ca = Math.cos(ang), sa = Math.sin(ang);
        for (let dy = -L; dy <= L; dy++) {
          for (let dx = -L; dx <= L; dx++) {
            const u = (dx * ca + dy * sa) / (L * 0.5), v = (-dx * sa + dy * ca) / (W * 0.5);
            const d = Math.sqrt(u * u + v * v);
            if (d > 1.3) continue;
            const i = ((Math.round(cy + dy) % N + N) % N) * N + ((Math.round(cx + dx) % N + N) % N);
            const lug = Math.sin(u * 18) > 0.3 ? 0.03 : 0;
            m.h[i] += d < 1 ? -0.12 + lug : smooth(1.3, 1, d) * 0.05;
          }
        }
      }
      // standing water in the low spots: dark, mirror smooth
      const hb = blur(N, m.h, 30 * m.s, 2);
      for (let i = 0; i < m.NN; i++) {
        const wet = smooth(0.02, -0.03, m.h[i] - hb[i] + (a[i] - 0.5) * 0.06);
        m.mul(i, 1 - wet * 0.35);
        m.rough[i] = lerp(0.55 + (a[i] - 0.5) * 0.2, 0.08, wet);
        if (wet > 0.5) m.h[i] = lerp(m.h[i], hb[i] - 0.03, (wet - 0.5) * 2);
        // crusted dry ridges
        const dry = smooth(0.03, 0.08, m.h[i] - hb[i]);
        m.mul(i, 1 + dry * 0.25);
        m.rough[i] = lerp(m.rough[i], 0.9, dry);
      }
      flecks(N, Math.round(900 * m.s * m.s * 4), m.mm(2), m.mm(5), seed + 9, (i, k) => { m.mix(i, [0.5, 0.45, 0.35], smooth(0, 0.3, k) * 0.6); });
    },
  },
  {
    name: 'gravel', det: 'gravel', depth: 22,
    about: 'loose gravel: rounded pebbles of three sizes, each its own rock, larger ones lying on top, grit and fines between',
    bake(m, seed) {
      soil(m, seed, { pal: ['#5a5148', '#6a6056', '#4d453d'], h: 0.2, relief: 0.06, rough: 0.95, tint: 0.5 });
      const pal = ['#8b857b', '#a29a8d', '#6f6a63', '#b3a690', '#7d6f5e', '#9b9184', '#5c5852', '#c0b6a4', '#8a7660'];
      stones(m, seed + 10, { cells: 200, pal, fill: 0.9, lift: 0.3, base: 0.25, tint: 0.35, rough: 0.75 });
      stones(m, seed + 20, { cells: 110, pal, fill: 0.92, lift: 0.4, base: 0.3, tint: 0.35, rough: 0.72 });
      stones(m, seed + 30, { cells: 52, pal, fill: 0.9, lift: 0.5, base: 0.35, density: 0.55, tint: 0.35, rough: 0.7 });
      m.grime({ amt: 0.5, rad: 6, gain: 7, color: [0.12, 0.1, 0.08], wear: 0.06 });
    },
  },
  {
    name: 'ballast', det: 'ballast', depth: 40,
    about: 'rail ballast: angular crushed granite, grey and pink-grey, black oil soaked into the stones, rust-brown brake dust over everything',
    bake(m, seed) {
      const N = m.N;
      soil(m, seed, { pal: ['#2c2722', '#3a332b'], h: 0.1, relief: 0.05, rough: 0.95, tint: 0.4 });
      const pal = ['#7d7a75', '#8f8a84', '#6a6662', '#9a8f88', '#857b74', '#5f5c59'];
      stones(m, seed + 10, { cells: 60, pal, angular: true, fill: 1.2, lift: 0.5, base: 0.2, tint: 0.4, rough: 0.8 });
      stones(m, seed + 15, { cells: 40, pal, angular: true, fill: 1.15, lift: 0.6, base: 0.25, density: 0.8, tint: 0.4, rough: 0.8 });
      stones(m, seed + 20, { cells: 26, pal, angular: true, fill: 1.1, lift: 0.7, base: 0.3, density: 0.45, tint: 0.4, rough: 0.8 });
      const oil = blotch(N, { p: 4, oct: 6, seed: seed + 30, t: 0.66, e: 0.08 }).mask;
      const dust = fbm(N, { p: 5, oct: 5, seed: seed + 31 });
      for (let i = 0; i < m.NN; i++) {
        m.mix(i, [0.05, 0.045, 0.04], oil[i] * 0.75);
        m.rough[i] = lerp(m.rough[i], 0.35, oil[i] * 0.7);
        m.mix(i, [0.38, 0.22, 0.13], smooth(0.4, 0.8, dust[i]) * 0.35);
        m.tint[i] *= 1 - oil[i] * 0.6;
      }
      m.grime({ amt: 0.55, rad: 8, gain: 6, color: [0.06, 0.05, 0.04], wear: 0.08 });
    },
  },
  {
    name: 'sand', det: 'sand', depth: 10,
    about: 'wind-blown sand: ripples wandering across the tile, grains of mixed minerals, the odd pebble and shell, darker heavy minerals in the troughs',
    bake(m, seed) {
      const N = m.N;
      soil(m, seed, { pal: ['#b89c70', '#c4a878', '#ae9266', '#c9b083'], h: 0.4, relief: 0.08, rough: 0.92, tint: 0.7, grain: 0.3 });
      const wv = fbm(N, { p: 3, oct: 4, seed: seed + 5 }), wu = fbm(N, { p: 3, oct: 4, seed: seed + 6 });
      const g = fbm(N, { p: 512, oct: 1, seed: seed + 7 });
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          // asymmetric ripples: a gentle stoss slope, a steep lee
          const ph = (y / N) * 22 + (wv[i] - 0.5) * 3 + (x / N) * 2 + (wu[i] - 0.5) * 1.5;
          const f = ph - Math.floor(ph);
          const r = f < 0.75 ? f / 0.75 : (1 - f) / 0.25;
          m.h[i] += (r - 0.5) * 0.25;
          const trough = smooth(0.25, 0, r);
          m.mix(i, [0.42, 0.34, 0.25], trough * 0.25 + (g[i] > 0.9 ? 0.4 : 0));
          if (g[i] < 0.06) m.mix(i, [0.92, 0.88, 0.8], 0.5);
        }
      }
      flecks(N, Math.round(120 * m.s * m.s * 4), m.mm(3), m.mm(9), seed + 9, (i, k) => { const s = smooth(0, 0.4, k); m.mix(i, [0.6, 0.55, 0.5], s * 0.8); m.h[i] = Math.max(m.h[i], 0.55 + k * 0.2); m.tint[i] *= 1 - s * 0.6; });
    },
  },
  {
    name: 'rock', det: 'rock', depth: 60,
    about: 'weathered granite rock face: fractured blocks, rounded by erosion, quartz and feldspar speckle, lichen crusts, dark water stains down the joints',
    bake(m, seed) {
      const N = m.N;
      const ero = fbm(N, { p: 8, oct: 7, seed: seed + 4, gain: 0.55, ridge: true });
      const chunk = fbm(N, { p: 5, oct: 5, seed: seed + 12, ridge: true });
      const big = warp(N, fbm(N, { p: 2, oct: 7, seed: seed + 5, gain: 0.55 }), fbm(N, { p: 4, oct: 4, seed: seed + 2 }), fbm(N, { p: 4, oct: 4, seed: seed + 3 }), 120 * m.s);
      const tone = fbm(N, { p: 5, oct: 6, seed: seed + 1 });
      const speck = fbm(N, { p: 512, oct: 1, seed: seed + 6 });
      const speck2 = fbm(N, { p: 200, oct: 2, seed: seed + 7 });
      const fr = cracks(N, { cells: 4, seed: seed + 10, keep: 0.6, width: 4, warp: 260 });
      const facets = voronoi(N, 7, 7, seed + 13, { jitter: 1, wx: big, wy: tone, wamt: 120 * m.s });
      const fr2 = cracks(N, { cells: 11, seed: seed + 11, keep: 0.3, width: 1.8, warp: 120 });
      for (let i = 0; i < m.NN; i++) {
        const j = Math.max(fr[i], fr2[i] * 0.7);
        // big rounded masses, sharpened by ridged erosion runnels, split by fractures
        // angular facets: each fracture block a tilted plane, rounded off by erosion near its edges
        const fa = facets.id[i] * 6.283, ft = 0.25 + facets.id[i] * 0.3;
        const fdx = ((i % N) + 0.5 - facets.px[i]) / (N / 7), fdy = (Math.floor(i / N) + 0.5 - facets.py[i]) / (N / 7);
        const facet = (Math.cos(fa) * fdx + Math.sin(fa) * fdy) * ft * smooth(0, m.mm(60), facets.edge[i]);
        m.h[i] = 0.3 + big[i] * 0.3 + facet * 0.5 + (chunk[i] - 0.5) * 0.15 + (ero[i] - 0.5) * 0.12 + (speck2[i] - 0.5) * 0.03 - j * 0.3;
        m.set(i, vary(hex('#8a857d'), 0.82 + tone[i] * 0.3 + (big[i] - 0.5) * 0.15, (tone[i] - 0.5) * 0.1));
        if (speck[i] > 0.78) m.mix(i, [0.88, 0.86, 0.82], 0.55);
        else if (speck[i] < 0.15) m.mix(i, [0.18, 0.17, 0.16], 0.55);
        else if (speck2[i] > 0.7) m.mix(i, [0.66, 0.52, 0.45], 0.3);
        m.mix(i, [0.12, 0.11, 0.1], j * 0.6);
        m.micro[i] = speck[i];
        m.rough[i] = 0.82 + (speck[i] - 0.5) * 0.1;
        m.tint[i] = 0.55 * (1 - j);
      }
      // lichen: crusty pale green-grey and orange rosettes on the high ground
      const li = voronoi(N, 50, 50, seed + 8, { jitter: 1 });
      const lf = fbm(N, { p: 64, oct: 3, seed: seed + 9 });
      const cav = m.cavity(20 * m.s, 6);
      for (let i = 0; i < m.NN; i++) {
        if (li.id[i] > 0.28 || cav[i] < -0.1) continue;
        const k = smooth(m.mm(30) * (0.4 + li.id[i] * 2), m.mm(5), li.f1[i]) * smooth(0.3, 0.6, lf[i]);
        m.mix(i, li.id[i] < 0.05 ? [0.75, 0.5, 0.18] : [0.6, 0.64, 0.52], k * 0.8);
        m.h[i] += k * 0.02; m.rough[i] = lerp(m.rough[i], 0.95, k); m.tint[i] *= 1 - k;
      }
      const st = trailDown(N, (() => { const f = field(N); for (let i = 0; i < m.NN; i++) f[i] = cav[i] < -0.3 ? 0.6 : 0; return f; })(), 1 - 0.002 / m.s);
      for (let i = 0; i < m.NN; i++) m.mul(i, 1 - st[i] * 0.25);
      m.grime({ amt: 0.4, rad: 12, gain: 6, color: [0.1, 0.1, 0.09], wear: 0.08 });
    },
  },
  {
    name: 'sandstone', det: 'strata', depth: 70,
    about: 'sandstone cliff: beds of different hardness and colour, cross-bedding, soft beds weathered back into honeycomb, vertical joints, iron staining and desert varnish',
    bake(m, seed) {
      const N = m.N;
      const bands = 12;
      const wav = fbm(N, { pu: 3, pv: 2, oct: 4, seed: seed + 1 });
      const cross = fbm(N, { pu: 30, pv: 6, oct: 3, seed: seed + 2 });
      const fine = fbm(N, { p: 96, oct: 3, seed: seed + 3 });
      const sand = fbm(N, { p: 512, oct: 1, seed: seed + 4 });
      const comb = voronoi(N, 90, 90, seed + 5, { jitter: 1 });
      // vertical joints: 5 per tile, wandering, each running through some of the beds only
      const jw = fbm(N, { pu: 2, pv: 6, oct: 4, seed: seed + 7 });
      const JX = [0, 1, 2, 3, 4].map((k) => (k + 0.2 + hash01(k, 1, seed) * 0.6) / 5);
      const joint = { edge: field(N) };
      for (let y = 0; y < N; y++) {
        const band = Math.floor((y / N) * bands);
        for (let x = 0; x < N; x++) {
          const i = y * N + x, u = x / N + (jw[i] - 0.5) * 0.05;
          let d = 1e9;
          for (let k = 0; k < 5; k++) {
            if (hash01(k, band, seed + 3) > 0.55) continue;
            const du = Math.abs(((u - JX[k]) % 1 + 1.5) % 1 - 0.5) * N;
            if (du < d) d = du;
          }
          joint.edge[i] = d;
        }
      }
      const pal = ['#c79f6f', '#b98a5c', '#d4b083', '#a8784c', '#c69568', '#e0c095', '#b07f55'].map(hex);
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          const bv = (y / N) * bands + (wav[i] - 0.5) * 0.8;
          const b = Math.floor(bv), fb = bv - b;
          const bi = ((b % bands) + bands) % bands;
          const hard = hash01(bi, 1, seed);
          const soft = hard < 0.4;
          // soft beds stand back, rounded into the cliff; honeycomb pits in them
          const prof = Math.sin(Math.PI * fb);
          const pit = soft ? smooth(m.mm(9), m.mm(2), comb.edge[i]) * smooth(0.2, 0.5, prof) : 0;
          const lam = (cross[i] - 0.5) * 0.12;
          const jt = 1 - smooth(m.mm(3), m.mm(14), joint.edge[i]);
          m.h[i] = (soft ? 0.35 + prof * 0.2 - (1 - pit) * 0.0 - pit * 0.0 + (1 - pit) * 0.08 : 0.62 + prof * 0.12) + lam * 0.2 + (fine[i] - 0.5) * 0.05 - jt * 0.3 - smooth(0.92, 1, fb) * 0.06;
          const c = vary(pal[bi % pal.length], 0.92 + lam + (fine[i] - 0.5) * 0.1 + (sand[i] - 0.5) * 0.1 - pit * 0.2);
          m.set(i, c);
          m.micro[i] = sand[i];
          m.rough[i] = 0.9;
          m.tint[i] = 0.5 * (1 - jt);
          m.mix(i, [0.2, 0.13, 0.09], jt * 0.5);
        }
      }
      // iron staining and dark varnish running down from the joints and ledges
      const src = field(N);
      for (let i = 0; i < m.NN; i++) src[i] = 1 - smooth(m.mm(3), m.mm(10), joint.edge[i]);
      const run = trailDown(N, src, 1 - 0.0012 / m.s);
      const vn = fbm(N, { pu: 40, pv: 3, oct: 3, seed: seed + 9 });
      for (let i = 0; i < m.NN; i++) { m.mix(i, [0.32, 0.16, 0.08], run[i] * vn[i] * 0.5); m.tint[i] *= 1 - run[i] * 0.4; }
      m.grime({ amt: 0.3, rad: 10, gain: 6, color: [0.3, 0.18, 0.1], wear: 0.06 });
    },
  },
  {
    name: 'cracked_earth', det: 'cracked', depth: 24,
    about: 'dry lake-bed mud: polygonal plates curling up at their rims, deep shadowed cracks, a skin of pale dust, finer cracks inside the plates',
    bake(m, seed) {
      const N = m.N;
      soil(m, seed, { pal: ['#9c8366', '#a88f70', '#8f775c'], h: 0.6, relief: 0.05, rough: 0.95, tint: 0.65 });
      const v = voronoi(N, 9, 9, seed + 1, { jitter: 1, wx: fbm(N, { p: 6, oct: 4, seed: seed + 2 }), wy: fbm(N, { p: 6, oct: 4, seed: seed + 3 }), wamt: 90 * m.s });
      const v2 = voronoi(N, 26, 26, seed + 4, { jitter: 1, wx: fbm(N, { p: 12, oct: 4, seed: seed + 5 }), wy: fbm(N, { p: 12, oct: 4, seed: seed + 6 }), wamt: 40 * m.s });
      const dust = fbm(N, { p: 8, oct: 5, seed: seed + 7 });
      for (let i = 0; i < m.NN; i++) {
        const e = v.edge[i];
        const crack = 1 - smooth(m.mm(5), m.mm(14), e);
        const curl = smooth(m.mm(60), m.mm(12), e) * (1 - crack);
        const fine = (1 - smooth(m.mm(1), m.mm(4), v2.edge[i])) * (1 - crack) * smooth(0.4, 0.6, v2.id[i]);
        m.h[i] += curl * 0.18 - crack * 0.55 - fine * 0.12 + (v.id[i] - 0.5) * 0.06;
        m.mul(i, (1 + (v.id[i] - 0.5) * 0.06 + curl * 0.03) * (1 - crack * 0.45 - fine * 0.2));
        m.mix(i, [0.82, 0.76, 0.66], smooth(0.5, 0.75, dust[i]) * 0.3 * (1 - crack));
        m.tint[i] *= 1 - crack * 0.8;
      }
      m.grime({ amt: 0.2, rad: 6, gain: 7, color: [0.2, 0.15, 0.1], wear: 0.1 });
    },
  },
];
