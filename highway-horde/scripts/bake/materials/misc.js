// Other recipes: terracotta barrel roof tiles, canvas, woven poly tarp, tyre tread rubber, cracked
// glass and HESCO barrier mesh. Sizes are written for 2048² (× m.s).

import { fbm, voronoi, blur, field, smooth, clamp01, lerp, hash01, warp, fract } from '../noise.js';
import { vary, blotch, flecks, grid, streaks, tideStains } from '../fx.js';
import { hex } from '../surface.js';

/** A plain weave: `T` threads per tile each way; returns per texel the thread height (0..1) and which set is on top. */
function weave(m, seed, T, o = {}) {
  const N = m.N, tw = N / T;
  const slub = fbm(N, { pu: 4, pv: T * 2, oct: 3, seed: seed + 1 }), slub2 = fbm(N, { pu: T * 2, pv: 4, oct: 3, seed: seed + 2 });
  const fuzz = fbm(N, { p: 512, oct: 1, seed: seed + 3 });
  const hgt = field(N), top = new Uint8Array(N * N), tone = field(N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const iu = Math.floor(x / tw), iv = Math.floor(y / tw);
      const fu = (x + 0.5) / tw - iu, fv = (y + 0.5) / tw - iv;
      const over = ((iu + iv) & 1) === 0;          // warp (along v) over weft here
      // a thread's round profile across it, and its rise and fall along it as it goes over and under
      const warpH = Math.sin(Math.PI * clamp01((fu - 0.08) / 0.84)) * (0.7 + 0.3 * Math.cos(Math.PI * (fv - 0.5) * (over ? 1 : -1) * 1.6));
      const weftH = Math.sin(Math.PI * clamp01((fv - 0.08) / 0.84)) * (0.7 + 0.3 * Math.cos(Math.PI * (fu - 0.5) * (over ? -1 : 1) * 1.6));
      const wh = warpH * (over ? 1 : 0.55) + (slub[i] - 0.5) * 0.3, fh = weftH * (over ? 0.55 : 1) + (slub2[i] - 0.5) * 0.3;
      hgt[i] = Math.max(wh, fh) * (o.amp ?? 1) + (fuzz[i] - 0.5) * 0.06;
      top[i] = wh > fh ? 1 : 0;
      tone[i] = (top[i] ? slub[i] : slub2[i]);
    }
  }
  return { hgt, top, tone, fuzz };
}

export const MISC = [
  {
    name: 'terracotta', det: 'tile', depth: 30, cells: [8, 8, 0, 0.14],
    about: 'barrel clay roof tiles in eight columns, each row lying over the top of the row below: fired-orange variety, dark under the overlaps, lichen, the odd cracked tile',
    bake(m, seed) {
      const N = m.N;
      const fine = fbm(N, { p: 96, oct: 3, seed: seed + 1 });
      const mott = fbm(N, { p: 8, oct: 5, seed: seed + 2 });
      const lich = voronoi(N, 40, 40, seed + 3, { jitter: 1 });
      const crackF = fbm(N, { p: 12, oct: 4, seed: seed + 4, ridge: true });
      const pal = ['#b4562f', '#a64e2b', '#c46a3c', '#9a4428', '#b86040', '#8c4a30'].map(hex);
      grid(N, 8, 8, 0, (i, e) => {
        const fx = e.fx / e.ew, fy = e.fy / e.eh;   // fy = 0 at the lower end
        const barrel = Math.sin(Math.PI * fx);       // a half-round across the column
        const lap = 1 - fy * 0.25;                    // the lower end rides on the tile below
        const under = smooth(0.18, 0, fy) * 0.6 + smooth(0.85, 1, fy) * 0.3;
        const gap = smooth(0.06, 0.0, Math.min(fx, 1 - fx));
        const cracked = e.id3 < 0.06 ? smooth(0.95, 0.97, crackF[i]) : 0;
        m.h[i] = 0.15 + barrel * 0.6 * lap + (fine[i] - 0.5) * 0.03 - gap * 0.2 - cracked * 0.1;
        const c = vary(pal[Math.floor(e.id * pal.length)], 0.85 + e.id2 * 0.25 + (mott[i] - 0.5) * 0.2 + barrel * 0.08 - under * 0.4 - gap * 0.6);
        m.set(i, c);
        m.mix(i, [0.1, 0.07, 0.05], cracked * 0.8);
        const lk = lich.id[i] < 0.2 ? smooth(m.mm(40) * (0.3 + lich.id[i] * 3), m.mm(6), lich.f1[i]) * barrel : 0;
        m.mix(i, lich.id[i] < 0.05 ? [0.75, 0.6, 0.3] : [0.55, 0.58, 0.48], lk * 0.75);
        m.micro[i] = fine[i];
        m.rough[i] = 0.78 + lk * 0.15;
        m.tint[i] = 0.75 * (1 - lk) * (1 - under * 0.5);
      });
      streaks(m, { seed: seed + 9, amt: 0.15, t: 0.6, color: [0.2, 0.14, 0.1] });
      m.grime({ amt: 0.3, rad: 10, gain: 6, color: [0.1, 0.07, 0.05], wear: 0.04 });
    },
  },
  {
    name: 'canvas', det: 'fabric', depth: 1.2, shift: [10 / 48, 14 / 48],
    about: 'heavy cotton canvas: a coarse plain weave with slubbed yarns and fuzz, faded and dirty in patches, a few stains and water marks',
    bake(m, seed) {
      const N = m.N;
      const w = weave(m, seed, 48);
      const fade = fbm(N, { p: 4, oct: 6, seed: seed + 5 });
      for (let i = 0; i < m.NN; i++) {
        m.set(i, vary([0.6, 0.57, 0.5], 0.75 + w.hgt[i] * 0.35 + (w.tone[i] - 0.5) * 0.1 + (fade[i] - 0.5) * 0.12 + (w.fuzz[i] - 0.5) * 0.06));
        m.h[i] = 0.2 + w.hgt[i] * 0.7;
        m.micro[i] = w.fuzz[i];
        m.rough[i] = 0.92;
        m.tint[i] = 0.95;
      }
      tideStains(m, { seed: seed + 6, amt: 0.3, t: 0.68, color: [0.35, 0.3, 0.22] });
      m.grime({ amt: 0.25, rad: 8, gain: 6, color: [0.15, 0.13, 0.1], wear: 0.04 });
    },
  },
  {
    name: 'tarp', det: 'plastic', depth: 4,
    about: 'woven polyethylene tarp and sheeting: a fine tape weave under a laminated skin, soft folds and creases with pale stress whitening on the ridges, dust in the hollows, a sheen',
    bake(m, seed) {
      const N = m.N;
      const w = weave(m, seed, 120, { amp: 0.5 });
      const fold = warp(N, fbm(N, { p: 3, oct: 6, seed: seed + 1, gain: 0.55 }), fbm(N, { p: 4, oct: 3, seed: seed + 2 }), fbm(N, { p: 4, oct: 3, seed: seed + 3 }), 100 * m.s);
      const crease = fbm(N, { p: 6, oct: 5, seed: seed + 4, ridge: true });
      for (let i = 0; i < m.NN; i++) {
        const cr = smooth(0.85, 0.95, crease[i]);
        m.h[i] = 0.3 + fold[i] * 0.5 + w.hgt[i] * 0.03 + cr * 0.05;
        m.set(i, vary([0.55, 0.56, 0.58], 0.92 + w.hgt[i] * 0.06 + (fold[i] - 0.5) * 0.1));
        m.mix(i, [0.9, 0.9, 0.9], cr * 0.3);
        m.micro[i] = w.hgt[i];
        m.rough[i] = 0.42 + cr * 0.2;
        m.tint[i] = 0.95;
      }
      m.grime({ amt: 0.3, rad: 16, gain: 4, color: [0.3, 0.27, 0.22], wear: 0.05 });
    },
  },
  {
    name: 'rubber', det: 'rubber', depth: 14, shift: [7 / 24, 0],
    about: 'tyre tread: 24 blocks around (u), four ribs across (v) with circumferential grooves, sipes cut in the blocks, worn shoulders, dust and grit packed in the grooves',
    bake(m, seed) {
      const N = m.N;
      const fine = fbm(N, { p: 128, oct: 3, seed: seed + 1 });
      const dust = fbm(N, { p: 6, oct: 5, seed: seed + 2 });
      const blocks = 24, ribsV = [0, 0.22, 0.5, 0.78, 1];
      for (let y = 0; y < N; y++) {
        const v = (y + 0.5) / N;
        let r = 0; while (r < 3 && v > ribsV[r + 1]) r++;
        const fv = (v - ribsV[r]) / (ribsV[r + 1] - ribsV[r]);
        const shoulder = r === 0 || r === 3;
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          // blocks staggered rib to rib, edges slanted
          const u = (x + 0.5) / N * blocks + (r & 1) * 0.5 + (fv - 0.5) * 0.35;
          const fu = fract(u);
          const groove = smooth(0.06, 0.02, Math.min(fv, 1 - fv)) + smooth(0.1, 0.05, Math.min(fu, 1 - fu));
          const sipe = Math.abs(fu - 0.5) < 0.012 && fv > 0.15 && fv < 0.85 ? 1 : 0;
          const g = clamp01(groove);
          const wear = shoulder ? 0.5 : 0.2;
          m.h[i] = 0.85 - g * 0.75 - sipe * 0.3 - (shoulder ? (fv < 0.5 ? 0.0 : 0.05) : 0) + (fine[i] - 0.5) * 0.03;
          m.set(i, vary([0.07, 0.07, 0.07], 1 + (fine[i] - 0.5) * 0.3 + (1 - g) * wear * 0.4));
          m.mix(i, [0.35, 0.32, 0.27], g * smooth(0.3, 0.7, dust[i]) * 0.6);
          m.micro[i] = fine[i];
          m.rough[i] = 0.85 - (1 - g) * 0.15;
          m.tint[i] = 0.3;
        }
      }
    },
  },
  {
    name: 'glass_cracked', det: 'glass', depth: 1,
    about: 'cracked glass: a shatter star of radial cracks and rings round an impact, shards each tilted a little, a film of grime and water spots',
    bake(m, seed) {
      const N = m.N;
      const cx = N * 0.5, cy = N * 0.5;
      const shards = voronoi(N, 10, 10, seed + 1, { jitter: 1 });
      const grime = fbm(N, { p: 4, oct: 6, seed: seed + 2 });
      const spots = voronoi(N, 120, 120, seed + 3, { jitter: 1 });
      const radials = Array.from({ length: 14 }, (_, k) => k / 14 * Math.PI * 2 + (hash01(k, 1, seed) - 0.5) * 0.3);
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
          let rad = 0;
          for (const ra of radials) { let da = Math.abs(a - ra); da = Math.min(da, Math.PI * 2 - da); rad = Math.max(rad, smooth(m.mm(1.2), 0, da * r) * smooth(N * 0.48, N * 0.1, r)); }
          const ringR = [0.05, 0.11, 0.2].map((k) => k * N);
          let ring = 0;
          for (const rr of ringR) ring = Math.max(ring, smooth(m.mm(1), 0, Math.abs(r - rr - Math.sin(a * 7) * m.mm(8))));
          const crk = Math.max(rad, ring * smooth(N * 0.3, N * 0.15, r), (1 - smooth(m.mm(0.5), m.mm(1.2), shards.edge[i])) * 0.5 * smooth(N * 0.5, N * 0.2, r));
          const tilt = (shards.id[i] - 0.5) * 0.08 * smooth(N * 0.5, N * 0.1, r);
          m.h[i] = 0.6 + tilt * ((x / N) - 0.5) - crk * 0.1;
          m.set(i, vary([0.32, 0.36, 0.37], 1));
          m.mix(i, [0.85, 0.88, 0.88], crk * 0.8);
          const gk = smooth(0.4, 0.85, grime[i]);
          m.mix(i, [0.36, 0.33, 0.28], gk * 0.5);
          const sp = spots.id[i] < 0.3 ? smooth(m.mm(3), m.mm(1), spots.f1[i]) : 0;
          m.mix(i, [0.6, 0.6, 0.58], sp * 0.3);
          m.rough[i] = 0.06 + gk * 0.4 + crk * 0.3 + sp * 0.2;
          m.tint[i] = 0.9 * (1 - crk);
        }
      }
    },
  },
  {
    name: 'hesco', det: 'hesco', depth: 20, shift: [3 / 10, 4 / 10],
    about: 'HESCO barrier: a welded steel wire mesh (10 × 10 per tile) over non-woven geotextile bulging out between the wires, dusty with the fill, stained and torn here and there',
    bake(m, seed) {
      const N = m.N;
      const cw = N / 10;
      const felt = fbm(N, { p: 300, oct: 2, seed: seed + 1 });
      const st = fbm(N, { p: 5, oct: 6, seed: seed + 2 });
      const rustF = fbm(N, { p: 30, oct: 3, seed: seed + 3 });
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          const fx = (x + 0.5) / cw - Math.floor((x + 0.5) / cw), fy = (y + 0.5) / cw - Math.floor((y + 0.5) / cw);
          const bulge = Math.sin(Math.PI * fx) * Math.sin(Math.PI * fy);
          const dw = Math.min(fx, 1 - fx, fy, 1 - fy) * cw;
          const wire = smooth(m.mm(3.2), m.mm(2), dw);
          m.h[i] = lerp(0.2 + Math.sqrt(bulge) * 0.5 + (felt[i] - 0.5) * 0.04, 0.85, wire);
          const tex = vary([0.62, 0.57, 0.45], 0.88 + (felt[i] - 0.5) * 0.2 + bulge * 0.08 - smooth(0.4, 0.8, st[i]) * 0.2);
          const metal = vary(smooth(0.6, 0.8, rustF[i]) > 0.5 ? [0.42, 0.25, 0.14] : [0.55, 0.56, 0.55], 0.9 + rustF[i] * 0.2);
          m.set(i, [lerp(tex[0], metal[0], wire), lerp(tex[1], metal[1], wire), lerp(tex[2], metal[2], wire)]);
          m.metal[i] = wire * (smooth(0.6, 0.8, rustF[i]) > 0.5 ? 0.2 : 0.85);
          m.micro[i] = felt[i] * (1 - wire);
          m.rough[i] = lerp(0.97, 0.5, wire);
          m.tint[i] = lerp(0.75, 0.1, wire);
        }
      }
      m.grime({ amt: 0.35, rad: 10, gain: 6, color: [0.3, 0.25, 0.18], wear: 0.03 });
    },
  },
];
