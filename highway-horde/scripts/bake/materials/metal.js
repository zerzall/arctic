// Metal recipes: painted sheet (the 'panel' of vehicles, machines, posts and signs), corrugated sheet
// painted and rusted, standing-seam roofing, rusted plate, rusted rail steel, diamond tread plate and
// camouflage-painted airframe skin. Sizes are written for 2048² (× m.s).

import { fbm, voronoi, blur, field, smooth, clamp01, lerp, hash01, warp, stroke, trailDown } from '../noise.js';
import { ramp, vary, blotch, flecks, applyRust, RUST } from '../fx.js';
import { hex } from '../surface.js';
import { runsFrom } from './common.js';

const STEEL = [0.56, 0.57, 0.58];
const PRIMER = [0.45, 0.2, 0.13];

/** Fine scratches: many short straight strokes of a few directions, a 0..1 field. */
function scratchField(N, seed, count, o = {}) {
  const f = field(N);
  const dirs = o.dirs ?? [0.1, 1.7, 2.6];
  for (let k = 0; k < count; k++) {
    const x = hash01(k, 1, seed) * N, y = hash01(k, 2, seed) * N;
    const a = dirs[k % dirs.length] + (hash01(k, 3, seed) - 0.5) * (o.spread ?? 0.5);
    const len = (o.len ?? 60) * (N / 2048) * (0.3 + hash01(k, 4, seed) * 1.4);
    const pts = [];
    for (let t = 0; t <= 4; t++) pts.push([x + Math.cos(a) * len * t / 4 + (hash01(k, t + 10, seed) - 0.5) * 2, y + Math.sin(a) * len * t / 4]);
    stroke(N, f, pts, Math.max(0.6, (o.w ?? 1.2) * (N / 2048) * (0.5 + hash01(k, 5, seed))), 0.4 + hash01(k, 6, seed) * 0.6, 0.6);
  }
  return f;
}

/**
 * Painted steel: orange-peel paint (tinted), chipped to the red-oxide primer and to bare steel at
 * points and along `edges`, scratched, dusty; rust where the bare steel has been out long enough.
 * Writes everything; returns { paint (coverage), bare (bare steel) }.
 */
function paintedSteel(m, seed, o = {}) {
  const N = m.N;
  const peel = fbm(N, { p: 160, oct: 2, seed: seed + 1 });
  const smudge = fbm(N, { p: 5, oct: 6, seed: seed + 2 });
  const fine = fbm(N, { p: 64, oct: 3, seed: seed + 3 });
  const chipV = voronoi(N, o.chipCells ?? 60, o.chipCells ?? 60, seed + 4, { jitter: 1, wx: fbm(N, { p: 32, oct: 3, seed: seed + 5 }), wy: fbm(N, { p: 32, oct: 3, seed: seed + 6 }), wamt: 10 * m.s });
  const scr = scratchField(N, seed + 7, Math.round(o.scratches ?? 500), { len: o.scratchLen ?? 80 });
  const paintC = hex(o.paint || '#8a8d8c');
  const paint = field(N), bare = field(N);
  for (let i = 0; i < m.NN; i++) {
    // chips: a chipped spot loses the paint to the primer, the middle to the steel
    const ch = chipV.id[i] < (o.chips ?? 0.12) ? smooth(m.mm(1 + chipV.id[i] * 30), m.mm(0.5), chipV.f1[i]) : 0;
    const s = scr[i];
    const toPrimer = Math.max(ch > 0.05 ? 1 : 0, s > 0.25 ? 1 : 0);
    const toSteel = Math.max(smooth(0.4, 0.7, ch), smooth(0.65, 0.9, s));
    const p = 1 - Math.max(smooth(0.02, 0.1, ch), smooth(0.2, 0.35, s));
    const c = vary(paintC, 0.96 + (smudge[i] - 0.5) * 0.12 + (fine[i] - 0.5) * 0.05);
    m.set(i, c);
    if (toPrimer) m.mix(i, vary(PRIMER, 0.9 + fine[i] * 0.2), 1 - p);
    if (toSteel > 0) m.mix(i, vary(STEEL, 0.85 + fine[i] * 0.3), toSteel);
    m.h[i] = 0.6 + (peel[i] - 0.5) * 0.02 * p + (fine[i] - 0.5) * 0.01 - (1 - p) * 0.06 - toSteel * 0.03;
    m.micro[i] = peel[i] * p;
    m.rough[i] = lerp(lerp(o.gloss ?? 0.38, 0.6, smooth(0.4, 0.8, smudge[i])), 0.42 - toSteel * 0.12, 1 - p) + (fine[i] - 0.5) * 0.06;
    m.metal[i] = toSteel;
    m.tint[i] = p;
    paint[i] = p; bare[i] = toSteel;
  }
  return { paint, bare, smudge };
}

/** Dust settling on everything, thicker in patches (dull, pale, no tint change). */
function dust(m, seed, amt, col = [0.55, 0.5, 0.42]) {
  const f = fbm(m.N, { p: 6, oct: 6, seed });
  for (let i = 0; i < m.NN; i++) {
    const k = smooth(0.35, 0.85, f[i]) * amt;
    m.mix(i, col, k * 0.35);
    m.rough[i] = lerp(m.rough[i], 0.9, k * 0.6);
  }
}

/** Corrugated sheet height: 14 sine ribs across u; returns the rib profile field (0 valley, 1 crest). */
function ribs(m, n = 14) {
  const N = m.N, prof = field(N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) prof[y * N + x] = 0.5 + 0.5 * Math.sin((x + 0.5) / N * Math.PI * 2 * n);
  return prof;
}

/** Screws in the valleys of the ribs, `rows` rows; returns the source mask (1 on a screw head). */
function screws(m, nRibs, rows, seed, phase = 0.75) {
  const N = m.N, src = field(N);
  const R = m.mm(7);
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < nRibs; k++) {
      if (hash01(k, r, seed) > 0.8) continue;
      const cx = ((k + phase) / nRibs) * N, cy = ((r + 0.12) / rows) * N;
      for (let dy = -Math.ceil(R); dy <= R; dy++) {
        for (let dx = -Math.ceil(R); dx <= R; dx++) {
          const d = Math.hypot(dx, dy) / R;
          if (d > 1) continue;
          const i = (((Math.round(cy) + dy) % N + N) % N) * N + (((Math.round(cx) + dx) % N + N) % N);
          src[i] = Math.max(src[i], d < 0.75 ? 1 : 0.5);
          m.h[i] += (d < 0.75 ? 0.08 * (1 - d * d) : 0.02);
          m.set(i, d < 0.75 ? vary([0.5, 0.5, 0.5], 0.9 + (1 - d) * 0.3) : [0.2, 0.2, 0.2]);
          m.metal[i] = d < 0.75 ? 0.8 : 0;
          m.tint[i] = 0;
        }
      }
    }
  }
  return src;
}

export const METAL = [
  {
    name: 'metal_painted', det: 'panel', depth: 3,
    about: 'painted sheet steel (vehicles, machines, posts, signs): orange-peel enamel, chips to the red primer and bare steel, scratches, smudged gloss, dust, soft dents',
    bake(m, seed) {
      const N = m.N;
      const { bare } = paintedSteel(m, seed, { paint: '#9a9c9a', chips: 0.1, scratches: 700 });
      const dents = voronoi(N, 7, 7, seed + 20, { jitter: 1 });
      for (let i = 0; i < m.NN; i++) if (dents.id[i] < 0.3) m.h[i] -= smooth(m.mm(120), 0, dents.f1[i]) * 0.25;
      const rustM = field(N);
      for (let i = 0; i < m.NN; i++) rustM[i] = bare[i] * smooth(0.4, 0.8, hash01(Math.floor(i / 97), 1, seed) * 0.5 + 0.4);
      applyRust(m, blur(N, rustM, 1.5 * m.s, 1), { seed: seed + 21, lift: 0.01 });
      dust(m, seed + 22, 0.5);
      m.grime({ amt: 0.2, rad: 4, gain: 8, color: [0.12, 0.1, 0.08], wear: 0 });
    },
  },
  {
    name: 'corrugated', det: 'corrugated', depth: 18,
    about: 'painted corrugated steel: 14 ribs per tile, chalky faded paint, white oxidation, rust blooms at the fasteners and the lower edge, runs down the valleys',
    bake(m, seed) {
      const N = m.N;
      const prof = ribs(m);
      const { paint } = paintedSteel(m, seed, { paint: '#8f9590', chips: 0.05, scratches: 250, gloss: 0.5 });
      const chalk = fbm(N, { p: 4, oct: 6, seed: seed + 10 });
      for (let i = 0; i < m.NN; i++) {
        m.h[i] = prof[i] * 0.85 + (m.h[i] - 0.6) * 0.5 + 0.05;
        const ch = smooth(0.45, 0.8, chalk[i]) * prof[i];
        m.mix(i, [0.82, 0.82, 0.8], ch * 0.3 * paint[i]);
        m.rough[i] = lerp(m.rough[i], 0.75, ch);
      }
      const src = screws(m, 14, 2, seed + 11);
      const rustM = field(N);
      const rf = fbm(N, { p: 8, oct: 6, seed: seed + 12 });
      for (let y = 0; y < N; y++) {
        const low = smooth(0.15, 0, y / N);
        for (let x = 0; x < N; x++) { const i = y * N + x; rustM[i] = Math.max(smooth(0.68, 0.8, rf[i] + low * 0.4), blur1(src, i) * 0.7); }
      }
      applyRust(m, blur(N, rustM, 3 * m.s, 2), { seed: seed + 13, lift: 0.01 });
      runsFrom(m, blur(N, src, 4 * m.s, 2), seed + 14, 0.7, { color: [0.4, 0.2, 0.08] });
      dust(m, seed + 15, 0.4);
      m.grime({ amt: 0.25, rad: 10, gain: 5, color: [0.12, 0.1, 0.08], wear: 0.02 });
      function blur1(f, i) { return f[i]; }
    },
  },
  {
    name: 'corrugated_rust', det: 'corrugatedrust', depth: 18,
    about: 'old corrugated iron: the galvanising gone grey and spangled in patches, rust over most of it, holes rusted through in the valleys, heavy dark runs',
    bake(m, seed) {
      const N = m.N;
      const prof = ribs(m);
      const span = voronoi(N, 90, 90, seed + 1, { jitter: 1 });
      const fine = fbm(N, { p: 48, oct: 3, seed: seed + 2 });
      for (let i = 0; i < m.NN; i++) {
        m.set(i, vary([0.52, 0.53, 0.52], 0.85 + span.id[i] * 0.3 + (fine[i] - 0.5) * 0.1));
        m.h[i] = prof[i] * 0.85 + 0.05 + (fine[i] - 0.5) * 0.01;
        m.metal[i] = 0.85; m.rough[i] = 0.45 + span.id[i] * 0.2; m.tint[i] = 0.2;
      }
      const rf = warp(N, fbm(N, { p: 4, oct: 7, seed: seed + 3, gain: 0.6 }), fbm(N, { p: 8, oct: 3, seed: seed + 4 }), fbm(N, { p: 8, oct: 3, seed: seed + 5 }), 40 * m.s);
      const rustM = field(N);
      for (let i = 0; i < m.NN; i++) rustM[i] = smooth(0.38, 0.5, rf[i]);
      applyRust(m, rustM, { seed: seed + 6, lift: 0.015, age: 0.15 });
      // holes rusted through, in the valleys, ragged
      const holes = voronoi(N, 20, 20, seed + 7, { jitter: 1, wx: fbm(N, { p: 64, oct: 3, seed: seed + 8 }), wy: fbm(N, { p: 64, oct: 3, seed: seed + 9 }), wamt: 16 * m.s });
      for (let i = 0; i < m.NN; i++) {
        if (holes.id[i] > 0.12 || prof[i] > 0.4 || rustM[i] < 0.5) continue;
        const k = smooth(m.mm(12) * (0.4 + holes.id[i] * 6), m.mm(4), holes.f1[i]);
        m.mix(i, [0.03, 0.025, 0.02], k); m.h[i] -= k * 0.3; m.occ[i] *= 1 - k * 0.8; m.rough[i] = lerp(m.rough[i], 1, k);
      }
      const src = screws(m, 14, 2, seed + 10);
      runsFrom(m, blur(N, src, 5 * m.s, 2), seed + 11, 0.9, { color: [0.3, 0.15, 0.07] });
      const st = fbm(N, { pu: 40, pv: 2, oct: 4, seed: seed + 12 });
      for (let i = 0; i < m.NN; i++) { const k = smooth(0.55, 0.8, st[i]) * (1 - prof[i] * 0.5); m.mix(i, [0.2, 0.11, 0.06], k * 0.35); }
      m.grime({ amt: 0.3, rad: 10, gain: 5, color: [0.1, 0.07, 0.05], wear: 0.02 });
    },
  },
  {
    name: 'metal_roof', det: 'metalroof', depth: 20, cells: [4, 1, 0, 0.06],
    about: 'standing-seam roofing: four pans per tile with raised seams, a slight oil-canning in each pan, chalky sun fade, rust blooms at the clips and runs down the pans',
    bake(m, seed) {
      const N = m.N;
      const { paint } = paintedSteel(m, seed, { paint: '#7f8a86', chips: 0.03, scratches: 150, gloss: 0.45 });
      const can = fbm(N, { pu: 4, pv: 3, oct: 3, seed: seed + 1 });
      const fade = fbm(N, { pu: 3, pv: 4, oct: 5, seed: seed + 2 });
      const pw = N / 4;
      const src = field(N);
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x, sx = x % pw, ds = Math.min(sx, pw - sx);
          const seam = smooth(m.mm(16), m.mm(4), ds);
          const pan = Math.sin((sx / pw) * Math.PI);
          m.h[i] = 0.35 + seam * 0.6 + pan * (can[i] - 0.5) * 0.08 + (m.h[i] - 0.6) * 0.3;
          m.mix(i, [0.85, 0.85, 0.83], smooth(0.4, 0.8, fade[i]) * 0.25 * paint[i]);
          m.rough[i] = lerp(m.rough[i], 0.7, smooth(0.4, 0.8, fade[i]) * 0.6);
          // clips along the seams every sixth of the tile
          const cy = Math.abs(((y + N / 12) % (N / 6)) - N / 12);
          if (ds < m.mm(14) && cy < m.mm(10) && hash01(Math.floor(x / pw), Math.floor(y / (N / 6)), seed) < 0.7) src[i] = 1;
        }
      }
      const rf = fbm(N, { p: 8, oct: 6, seed: seed + 3 });
      const rustM = field(N), sb = blur(N, src, 6 * m.s, 2);
      for (let i = 0; i < m.NN; i++) rustM[i] = Math.max(smooth(0.7, 0.82, rf[i]), smooth(0.05, 0.4, sb[i]) * 0.9);
      applyRust(m, blur(N, rustM, 2 * m.s, 1), { seed: seed + 4, lift: 0.01 });
      runsFrom(m, sb, seed + 5, 0.8, { color: [0.4, 0.2, 0.08], decay: 0.0025 });
      dust(m, seed + 6, 0.5);
      m.grime({ amt: 0.25, rad: 8, gain: 6, color: [0.12, 0.1, 0.08], wear: 0.02 });
    },
  },
  {
    name: 'steel_rusted', det: 'rust', depth: 6,
    about: 'rusted steel plate: layered scale flaking off, pits, the last of the paint in islands with lifted edges, a weld seam, bolts, dark wet runs',
    bake(m, seed) {
      const N = m.N;
      const { paint } = paintedSteel(m, seed, { paint: '#6f7a72', chips: 0.0, scratches: 200, gloss: 0.6 });
      const keep = warp(N, fbm(N, { p: 4, oct: 7, seed: seed + 1, gain: 0.6 }), fbm(N, { p: 8, oct: 3, seed: seed + 2 }), fbm(N, { p: 8, oct: 3, seed: seed + 3 }), 50 * m.s);
      const rustM = field(N);
      for (let i = 0; i < m.NN; i++) rustM[i] = smooth(0.42, 0.46, keep[i]);
      applyRust(m, rustM, { seed: seed + 4, lift: 0.04, age: 0.1, scaleK: 1.2 });
      const pits = voronoi(N, 160, 160, seed + 5, { jitter: 1 });
      for (let i = 0; i < m.NN; i++) {
        if (pits.id[i] < 0.3) { const k = smooth(m.mm(2), m.mm(0.5), pits.f1[i]) * rustM[i]; m.h[i] -= k * 0.2; m.mul(i, 1 - k * 0.4); }
      }
      // a horizontal weld bead and a row of bolts
      const wy = Math.round(N * 0.62);
      const bead = fbm(N, { pu: 128, pv: 2, oct: 2, seed: seed + 6 });
      for (let y = wy - Math.ceil(m.mm(12)); y <= wy + m.mm(12); y++) {
        for (let x = 0; x < N; x++) {
          const i = (((y % N) + N) % N) * N + x, d = Math.abs(y - wy) / m.mm(10);
          if (d > 1.2) continue;
          const ripple = 0.5 + 0.5 * Math.sin(x / m.mm(4) * 6.283);
          m.h[i] += smooth(1.2, 0, d) * (0.18 + ripple * 0.04 + (bead[i] - 0.5) * 0.04);
          m.mix(i, [0.25, 0.2, 0.17], smooth(1.2, 0.3, d) * 0.5);
        }
      }
      for (let k = 0; k < 6; k++) {
        const cx = (k + 0.5) / 6 * N, cy = N * 0.12, R = m.mm(18);
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
          const d = Math.hypot(dx, dy) / R;
          if (d > 1) continue;
          const i = ((Math.round(cy + dy) + N) % N) * N + ((Math.round(cx + dx) + N) % N);
          m.h[i] += 0.25 * Math.sqrt(1 - d * d);
          m.mix(i, ramp(RUST, 0.5 + d * 0.3), 0.8);
        }
      }
      runsFrom(m, (() => { const f = field(N); for (let i = 0; i < m.NN; i++) f[i] = rustM[i] * (1 - paint[i]) * 0.4; return blur(N, f, 3 * m.s, 1); })(), seed + 7, 0.5, { color: [0.25, 0.12, 0.06] });
      m.grime({ amt: 0.35, rad: 6, gain: 7, color: [0.12, 0.07, 0.04], wear: 0.03 });
    },
  },
  {
    name: 'rail_rust', det: 'railrust', depth: 4,
    about: 'rusted rail and structural steel: brown-orange rust over dark mill scale, black oil and brake-dust grime, bright scuffs along the running direction',
    bake(m, seed) {
      const N = m.N;
      const fine = fbm(N, { p: 80, oct: 3, seed: seed + 1 });
      for (let i = 0; i < m.NN; i++) { m.set(i, vary([0.22, 0.2, 0.19], 0.9 + fine[i] * 0.2)); m.h[i] = 0.5; m.metal[i] = 0.6; m.rough[i] = 0.55; m.tint[i] = 0.1; }
      const rf = fbm(N, { p: 5, oct: 7, seed: seed + 2, gain: 0.6 });
      const rustM = field(N);
      for (let i = 0; i < m.NN; i++) rustM[i] = smooth(0.3, 0.55, rf[i]);
      applyRust(m, rustM, { seed: seed + 3, lift: 0.03, age: -0.05 });
      const scuff = scratchField(N, seed + 4, 900, { dirs: [0, Math.PI], spread: 0.08, len: 220, w: 1.6 });
      const oil = blotch(N, { p: 4, oct: 6, seed: seed + 5, t: 0.6, e: 0.08 }).mask;
      for (let i = 0; i < m.NN; i++) {
        const s = smooth(0.3, 0.8, scuff[i]);
        m.mix(i, [0.6, 0.6, 0.6], s * 0.7); m.metal[i] = lerp(m.metal[i], 1, s); m.rough[i] = lerp(m.rough[i], 0.3, s);
        m.mix(i, [0.05, 0.04, 0.035], oil[i] * 0.6); m.rough[i] = lerp(m.rough[i], 0.4, oil[i] * 0.5);
      }
      dust(m, seed + 6, 0.5, [0.35, 0.22, 0.14]);
      m.grime({ amt: 0.3, rad: 5, gain: 8, color: [0.08, 0.06, 0.05] });
    },
  },
  {
    name: 'diamond_plate', det: 'diamond', depth: 6, shift: [0.25, 0.25],
    about: 'aluminium-steel tread plate: raised lugs in alternating directions, their tops worn bright, grime and grit packed between, scratches, a few rust specks',
    bake(m, seed) {
      const N = m.N;
      const cells = 16, cw = N / cells;
      const fine = fbm(N, { p: 96, oct: 3, seed: seed + 1 });
      const grimeF = fbm(N, { p: 6, oct: 6, seed: seed + 2 });
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          const cx = Math.floor(x / cw), cy = Math.floor(y / cw);
          const fx = (x + 0.5) / cw - cx - 0.5, fy = (y + 0.5) / cw - cy - 0.5;
          // a lug: an elongated lens at ±45°, alternating cell to cell
          const a = ((cx + cy) & 1) ? Math.PI / 4 : -Math.PI / 4;
          const u = fx * Math.cos(a) + fy * Math.sin(a), v = -fx * Math.sin(a) + fy * Math.cos(a);
          const d = Math.sqrt((u / 0.38) ** 2 + (v / 0.09) ** 2);
          const lug = smooth(1, 0.7, d);
          const top = smooth(0.8, 0.2, d);
          m.h[i] = 0.3 + lug * 0.5 + top * 0.08 + (fine[i] - 0.5) * 0.02;
          const g = smooth(0.4, 0.75, grimeF[i]) * (1 - lug);
          m.set(i, vary([0.6, 0.61, 0.62], 0.8 + top * 0.35 + (fine[i] - 0.5) * 0.15));
          m.mix(i, [0.15, 0.13, 0.11], g * 0.75);
          m.metal[i] = 1 - g * 0.8;
          m.rough[i] = lerp(0.48, 0.22, top) + g * 0.4 + (fine[i] - 0.5) * 0.05;
          m.tint[i] = 0.25 * (1 - g);
        }
      }
      const scr = scratchField(N, seed + 3, 600, { len: 120 });
      for (let i = 0; i < m.NN; i++) { const s = smooth(0.3, 0.8, scr[i]); m.mix(i, [0.75, 0.75, 0.76], s * 0.4); m.rough[i] = lerp(m.rough[i], 0.25, s); }
      const rs = field(N);
      flecks(N, 260, m.mm(2), m.mm(10), seed + 4, (i, k) => { rs[i] = Math.max(rs[i], smooth(0, 0.5, k)); });
      applyRust(m, rs, { seed: seed + 5, lift: 0.005 });
      m.grime({ amt: 0.4, rad: 4, gain: 9, color: [0.1, 0.09, 0.08], wear: 0.05 });
    },
  },
  {
    name: 'metal_camo', det: 'camo', depth: 3,
    about: 'camouflage-painted airframe and vehicle skin: hard-edged green, brown and black disruptive pattern, panel lines with rivet rows, chipped and faded paint, exhaust soot, dust',
    bake(m, seed) {
      const N = m.N;
      const { paint } = paintedSteel(m, seed, { paint: '#4d5a3a', chips: 0.06, scratches: 400, gloss: 0.7 });
      const b1 = warp(N, fbm(N, { p: 3, oct: 6, seed: seed + 1, gain: 0.55 }), fbm(N, { p: 6, oct: 3, seed: seed + 2 }), fbm(N, { p: 6, oct: 3, seed: seed + 3 }), 80 * m.s);
      const b2 = warp(N, fbm(N, { p: 4, oct: 6, seed: seed + 4, gain: 0.55 }), fbm(N, { p: 6, oct: 3, seed: seed + 5 }), fbm(N, { p: 6, oct: 3, seed: seed + 6 }), 80 * m.s);
      const fade = fbm(N, { p: 4, oct: 5, seed: seed + 7 });
      const brown = hex('#5e4a33'), black = hex('#23251f'), green = hex('#4b5a39');
      for (let i = 0; i < m.NN; i++) {
        const p = paint[i];
        let c = green;
        if (b1[i] > 0.6) c = brown;
        if (b2[i] > 0.66) c = black;
        const cc = vary(c, 0.95 + (fade[i] - 0.5) * 0.18);
        m.mix(i, cc, p);
        m.mix(i, [0.6, 0.6, 0.55], smooth(0.55, 0.85, fade[i]) * 0.18 * p);
        m.tint[i] = p * 0.3;
        m.rough[i] = lerp(m.rough[i], 0.75, p);
      }
      // panel lines and rivets on a 4 × 3 grid of skin panels
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          const dx = Math.abs(((x + N / 8) % (N / 4)) - N / 8), dy = Math.abs(((y + N / 6) % (N / 3)) - N / 6);
          const line = smooth(m.mm(2), m.mm(0.5), Math.min(dx, dy));
          const rx = Math.abs(((x + m.mm(20)) % m.mm(40)) - m.mm(20)), ry = Math.abs(((y + m.mm(20)) % m.mm(40)) - m.mm(20));
          const rivetX = dx > m.mm(8) && dx < m.mm(14) ? smooth(m.mm(3), m.mm(1.5), Math.hypot(dx - m.mm(11), ry)) : 0;
          const rivetY = dy > m.mm(8) && dy < m.mm(14) ? smooth(m.mm(3), m.mm(1.5), Math.hypot(rx, dy - m.mm(11))) : 0;
          const rv = Math.max(rivetX, rivetY);
          m.h[i] += -line * 0.25 + rv * 0.12;
          m.mix(i, [0.08, 0.08, 0.07], line * 0.6);
        }
      }
      const soot = fbm(N, { pu: 3, pv: 2, oct: 6, seed: seed + 8 });
      for (let i = 0; i < m.NN; i++) m.mix(i, [0.05, 0.05, 0.05], smooth(0.62, 0.9, soot[i]) * 0.4);
      dust(m, seed + 9, 0.6, [0.5, 0.45, 0.36]);
      m.grime({ amt: 0.3, rad: 3, gain: 9, color: [0.08, 0.08, 0.07], wear: 0.03 });
    },
  },
];
