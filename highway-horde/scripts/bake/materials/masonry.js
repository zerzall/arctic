// Masonry recipes: brick (red and old yellow), cinder block, poured concrete and slabs, stucco,
// plaster, adobe, sandstone. Sizes are written for 2048² (multiply texel sizes by m.s).

import { fbm, voronoi, blur, field, smooth, clamp01, lerp, hash01, fract, warp } from '../noise.js';
import { grid, ramp, vary, cracks, hairlines, blotch, streaks, tideStains, flecks } from '../fx.js';
import { hex } from '../surface.js';
import { cementBase, runsFrom, spotRust, applyCracks, paintedOver, edgeDist } from './common.js';

/**
 * Bricks in running bond, 5 across × 16 courses per tile (the procedural layer's grid, so the game's
 * per-brick tones line up). `pal` = brick body colours, `mortar` its colour.
 */
function brickWall(m, seed, o) {
  const N = m.N;
  const joint = m.mm(o.joint ?? 10);          // mortar joint width
  const grain = fbm(N, { p: 128, oct: 3, seed: seed + 1 });
  const wx = fbm(N, { p: 6, oct: 4, seed: seed + 10 }), wy = fbm(N, { p: 6, oct: 4, seed: seed + 11 });
  const mott = warpField(N, fbm(N, { p: 12, oct: 6, seed: seed + 2, gain: 0.6 }), wx, wy, 60 * m.s);
  const broad = fbm(N, { p: 3, oct: 5, seed: seed + 3 });
  const sand = fbm(N, { p: 512, oct: 1, seed: seed + 4 });
  const edgeN = fbm(N, { p: 48, oct: 4, seed: seed + 5, gain: 0.6 });
  const pits = voronoi(N, 140, 140, seed + 6, { jitter: 1 });
  const spallF = fbm(N, { p: 20, oct: 5, seed: seed + 7 });
  const salt = blotch(N, { p: 3, oct: 6, seed: seed + 8, t: o.salt ?? 0.66, e: 0.06 }).mask;
  const soot = fbm(N, { p: 3, oct: 5, seed: seed + 9 });
  const mortarErode = fbm(N, { p: 10, oct: 5, seed: seed + 12 });
  const pal = o.pal.map(hex), mortar = hex(o.mortar);
  const spallRate = o.spall ?? 0.07;
  grid(N, 5, 16, 0.5, (i, e) => {
    // arrises: worn round and nibbled; corners knocked off on some bricks
    const nib = Math.max(0, edgeN[i] - 0.55) * m.mm(9);
    const chipR = e.idc < 0.45 ? m.mm(4 + 16 * hash01(e.col, e.row, e.corner + 90)) * (0.7 + 0.6 * edgeN[i]) : 0;
    const chip = chipR > 0 ? smooth(chipR, chipR * 0.6, e.dc) : 0;
    const d = e.d - joint * 0.5 + (edgeN[i] - 0.5) * m.mm(2.2) - nib;
    const face = smooth(0, m.mm(1.6), d);              // 0 = mortar, 1 = brick
    const round = smooth(0, m.mm(5), d);               // rounded arris
    // each brick: a colour from the palette, a tilt; a few over-burnt (dark, glossy) or pale ones
    const pick = Math.floor(e.id * pal.length);
    const burnt = e.id2 < (o.burnt ?? 0.1), pale = e.id2 > 1 - (o.pale ?? 0.08);
    let c = vary(pal[pick], 0.9 + e.id3 * 0.2 + (burnt ? -0.32 : 0) + (pale ? 0.16 : 0), (e.id3 - 0.5) * 0.08 + (pale ? -0.04 : 0));
    const end = e.id3 > 0.5 ? 1 : 0;
    const flash = (o.flash ?? 0.3) * (1 - clamp01(Math.abs(e.fx / e.ew - end) * 2.2)) * (e.id > 0.4 ? 1 : 0.3);
    // spalled bricks: the face has burst off in a patch, showing the coarse, paler core
    const spall = hash01(e.col, e.row, 91) < spallRate ? smooth(0.52, 0.56, spallF[i] + (hash01(e.col, e.row, 92) - 0.5) * 0.2) * smooth(m.mm(3), m.mm(10), d) : 0;
    const pit = pits.id[i] < 0.3 ? smooth(m.mm(1.6 * (0.5 + pits.id[i] * 2)), m.mm(0.2), pits.f1[i]) : 0;
    const t = 1 + (mott[i] - 0.5) * 0.34 + (grain[i] - 0.5) * 0.1 + (broad[i] - 0.5) * 0.14 - flash * 0.45 - pit * 0.35
      + (sand[i] > 0.8 ? 0.1 : sand[i] < 0.12 ? -0.16 : 0) - chip * 0.04 + spall * 0.12;
    let bk = vary(c, t, (mott[i] - 0.5) * 0.08 + spall * 0.06);
    // mortar: coarse sand in cement, recessed, eroded deeper in places, darker with dirt
    const er = smooth(0.55, 0.75, mortarErode[i]);
    const mk = 0.86 + (grain[i] - 0.5) * 0.3 + (sand[i] - 0.5) * 0.35 - er * 0.12;
    const mc = vary(mortar, mk, (sand[i] - 0.5) * 0.1);
    m.set(i, [lerp(mc[0], bk[0], face), lerp(mc[1], bk[1], face), lerp(mc[2], bk[2], face)]);
    const tilt = ((e.fx / e.ew) - 0.5) * (e.id - 0.5) * 0.05 + ((e.fy / e.eh) - 0.5) * (e.id2 - 0.5) * 0.05;
    const hb = 0.86 + round * 0.08 + tilt + (grain[i] - 0.5) * 0.025 + (mott[i] - 0.5) * 0.015 - pit * 0.16
      - chip * 0.22 * (1 - smooth(0, chipR * 0.6, e.dc)) - spall * (0.14 + (grain[i] - 0.5) * 0.08);
    const hm = 0.3 - er * 0.14 + (sand[i] - 0.5) * 0.035 + (grain[i] - 0.5) * 0.05;
    m.h[i] = lerp(hm, hb, face);
    m.micro[i] = sand[i] * (1 - face * 0.6) + spall * grain[i];
    m.rough[i] = lerp(0.95, (burnt ? 0.6 : 0.82) + (grain[i] - 0.5) * 0.1 + spall * 0.1, face);
    m.tint[i] = lerp(0.1, 0.9 - spall * 0.4, face);
    // salt bloom (efflorescence) washing out of the joints, soot in patches
    const sk = salt[i] * (0.3 + 0.7 * (1 - face)) * (o.saltAmt ?? 0.5) * (0.5 + 0.5 * grain[i]);
    m.mix(i, [0.84, 0.83, 0.79], sk);
    m.tint[i] *= 1 - sk;
    const so = smooth(0.62, 0.85, soot[i]) * (o.soot ?? 0.3);
    m.mul(i, 1 - so * 0.5);
  });
  m.grime({ amt: o.grime ?? 0.45, rad: 8, gain: 8, color: [0.1, 0.085, 0.07], wear: 0.05 });
  streaks(m, { seed: seed + 20, amt: o.streak ?? 0.16, t: 0.6, color: [0.16, 0.14, 0.12] });
}

/** warp() with fields 0..1 (texel displacement amt). */
function warpField(N, f, wx, wy, amt) { return warp(N, f, wx, wy, amt); }

export const MASONRY = [
  {
    name: 'brick_red', det: 'brick', depth: 14, cells: [5, 16, 0.5, 0.12],
    about: 'red clay brick in running bond: fired-colour variety, burnt headers, chipped corners, spalled faces, recessed sandy mortar, salt bloom, soot',
    bake(m, seed) {
      brickWall(m, seed, { pal: ['#8e3d2b', '#9b4a33', '#7c3426', '#a6573b', '#874030', '#6e2f24', '#9a5240'], mortar: '#a8a093', salt: 0.7, saltAmt: 0.4 });
    },
  },
  {
    name: 'brick_yellow', det: 'brickyellow', depth: 16, cells: [5, 16, 0.5, 0.14],
    about: 'old yellow stock brick: buff and sulphur tones with dark cinder specks, heavy soot, worn lime mortar standing back',
    bake(m, seed) {
      brickWall(m, seed, {
        pal: ['#b99a5e', '#c6a86a', '#a88a52', '#b5925a', '#9d8456', '#c2a774', '#8e7a52'], mortar: '#b8b0a0',
        burnt: 0.06, pale: 0.05, flash: 0.15, soot: 0.28, salt: 0.72, saltAmt: 0.3, grime: 0.55, spall: 0.1, joint: 12, streak: 0.24,
      });
      flecks(m.N, 9000, 0.6 * m.s, 2.2 * m.s, seed + 60, (i, k) => { if (m.tint[i] > 0.5) m.mix(i, [0.16, 0.13, 0.11], k * 0.8); });
    },
  },
  {
    name: 'cinder_block', det: 'cinder', depth: 18, cells: [6, 12, 0.5, 0.1],
    about: 'concrete masonry units: coarse porous faces, concave tooled joints, nibbled edges, efflorescence and grime',
    bake(m, seed) {
      const N = m.N;
      const pores = voronoi(N, 260, 260, seed + 1, { jitter: 1 });
      const pores2 = voronoi(N, 90, 90, seed + 2, { jitter: 1 });
      const tex = fbm(N, { p: 64, oct: 3, seed: seed + 3 });
      const mott = fbm(N, { p: 4, oct: 6, seed: seed + 4 });
      const edgeN = fbm(N, { p: 64, oct: 3, seed: seed + 5 });
      const joint = m.mm(10);
      grid(N, 6, 12, 0.5, (i, e) => {
        const d = e.d - joint * 0.5 + (edgeN[i] - 0.5) * m.mm(2) - Math.max(0, edgeN[i] - 0.68) * m.mm(10);
        const face = smooth(0, m.mm(1.5), d);
        const pore = pores.id[i] < 0.45 ? smooth(m.mm(1.4), m.mm(0.3), pores.f1[i]) : 0;
        const pore2 = pores2.id[i] < 0.2 ? smooth(m.mm(2.5), m.mm(0.6), pores2.f1[i]) : 0;
        const k = 0.95 + (mott[i] - 0.5) * 0.18 + (tex[i] - 0.5) * 0.2 + (e.id - 0.5) * 0.12 - pore * 0.3 - pore2 * 0.35;
        const block = vary(hex('#8f8b83'), k, (e.id2 - 0.5) * 0.06);
        const mor = vary(hex('#9b968c'), 0.9 + (tex[i] - 0.5) * 0.15);
        m.set(i, [lerp(mor[0], block[0], face), lerp(mor[1], block[1], face), lerp(mor[2], block[2], face)]);
        // (the tooled joint is concave: deepest in its middle)
        const jm = Math.sin(Math.PI * clamp01((d + joint * 0.5) / joint));
        m.h[i] = lerp(0.46 - jm * 0.1, 0.86 + (tex[i] - 0.5) * 0.06 - pore * 0.3 - pore2 * 0.35 + (e.id3 - 0.5) * 0.02, face);
        m.micro[i] = tex[i];
        m.rough[i] = lerp(0.9, 0.93, face);
        m.tint[i] = lerp(0.2, 0.9, face);
      });
      m.grime({ amt: 0.4, rad: 10, gain: 7, color: [0.12, 0.11, 0.1], wear: 0.05 });
      streaks(m, { seed: seed + 9, amt: 0.15, t: 0.6 });
      const salt = blotch(N, { p: 3, oct: 6, seed: seed + 10, t: 0.76, e: 0.05 }).mask;
      for (let i = 0; i < m.NN; i++) m.mix(i, [0.85, 0.85, 0.82], salt[i] * 0.1);
    },
  },
  {
    name: 'concrete', det: 'concrete', depth: 8,
    about: 'poured concrete wall: bug holes, cement mottle, faint board-form grain, worn patches of aggregate, cracks, rebar rust runs, water streaks',
    bake(m, seed) {
      const N = m.N;
      cementBase(m, seed, {});
      const board = fbm(N, { pu: 3, pv: 40, oct: 4, seed: seed + 20 });
      for (let i = 0; i < m.NN; i++) { m.h[i] += (board[i] - 0.5) * 0.04; m.mul(i, 1 + (board[i] - 0.5) * 0.05); }
      applyCracks(m, cracks(N, { cells: 5, seed: seed + 21, keep: 0.35, width: 1.6 }), { dark: 0.5, depth: 0.2 });
      applyCracks(m, hairlines(N, { seed: seed + 22, p: 5, thr: 0.955 }), { dark: 0.25, depth: 0.08 });
      spotRust(m, seed + 23, 3, 0.5);
      m.grime({ amt: 0.35, rad: 6, gain: 9, color: [0.2, 0.18, 0.15], wear: 0.04 });
      streaks(m, { seed: seed + 24, amt: 0.22, t: 0.58, color: [0.22, 0.21, 0.19] });
      tideStains(m, { seed: seed + 25, amt: 0.18, t: 0.68, color: [0.42, 0.38, 0.32] });
    },
  },
  {
    name: 'concrete_dam', det: 'concretedam', depth: 10, shift: [0.5, 0.5],
    about: 'dam concrete: heavy water staining, calcite runs, dark algae low down, form-tie holes in a grid with rust halos, lift lines',
    bake(m, seed) {
      const N = m.N;
      cementBase(m, seed, { color: '#8a8780', wear: 0.8 });
      const src = field(N), R = m.mm(14), M = N - 1;
      for (let a = 0; a < 4; a++) {
        for (let b = 0; b < 4; b++) {
          const cx = Math.round((a + 0.5) * N / 4), cy = Math.round((b + 0.5) * N / 4), Q = Math.ceil(R * 3);
          for (let dy = -Q; dy <= Q; dy++) {
            for (let dx = -Q; dx <= Q; dx++) {
              const d = Math.hypot(dx, dy), i = ((cy + dy) & M) * N + ((cx + dx) & M);
              if (d < R) { m.h[i] -= 0.4 * smooth(R, R * 0.6, d); m.mul(i, 1 - 0.45 * smooth(R, R * 0.7, d)); }
              if (d < Q) src[i] = Math.max(src[i], smooth(Q, R, d) * 0.6);
            }
          }
        }
      }
      runsFrom(m, src, seed + 30, 0.5);
      for (let y = 0; y < N; y++) {
        const ly = Math.abs(((y + N / 8) % (N / 4)) - N / 8 + 0.5);
        const k = smooth(m.mm(5), 0, ly);
        if (k <= 0) continue;
        for (let x = 0; x < N; x++) { const i = y * N + x; m.h[i] -= k * 0.08; m.mul(i, 1 - k * 0.15); }
      }
      streaks(m, { seed: seed + 31, amt: 0.45, t: 0.5, pu: 30, color: [0.18, 0.19, 0.17] });
      const calc = streaks(m, { seed: seed + 32, amt: 0.25, t: 0.72, pu: 60, color: [0.86, 0.85, 0.8] });
      for (let i = 0; i < m.NN; i++) m.h[i] += calc[i] * 0.05;
      const alg = fbm(N, { p: 4, oct: 6, seed: seed + 33 });
      for (let y = 0; y < N; y++) {
        const low = smooth(0.45, 0.0, y / N);
        for (let x = 0; x < N; x++) {
          const i = y * N + x, k = low * smooth(0.45, 0.7, alg[i]);
          m.mix(i, [0.16, 0.2, 0.12], k * 0.6);
          m.rough[i] = lerp(m.rough[i], 0.6, k * 0.4);
          m.tint[i] *= 1 - k * 0.5;
        }
      }
      m.grime({ amt: 0.4, rad: 6, gain: 9, color: [0.16, 0.16, 0.14], wear: 0.03 });
    },
  },
  {
    name: 'concrete_slab', det: 'slab', depth: 8, cells: [1, 1, 0, 0.1],
    about: 'poured concrete slab: tooled joints full of dirt, broom finish, spalls, a crack or two, oil and rust stains',
    bake(m, seed) {
      const N = m.N;
      cementBase(m, seed, { color: '#94918a', holeRate: 0.1, wear: 0.4 });
      const broom = fbm(N, { pu: 3, pv: 220, oct: 2, seed: seed + 10 });
      const sp = fbm(N, { p: 10, oct: 5, seed: seed + 11 });
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x, d = edgeDist(x, y, N);
          const j = smooth(m.mm(6), m.mm(3), d);
          const lip = smooth(m.mm(20), m.mm(6), d) * (1 - j);
          const spall = smooth(0.6, 0.66, sp[i]) * smooth(m.mm(60), m.mm(8), d);
          m.h[i] += (broom[i] - 0.5) * 0.05 * (1 - lip) - j * 0.6 - spall * 0.25 + lip * 0.02;
          m.mix(i, [0.18, 0.16, 0.13], j * 0.8 + spall * 0.15);
          m.mul(i, 1 - lip * 0.05 + (broom[i] - 0.5) * 0.04);
          m.rough[i] = clamp01(m.rough[i] + j * 0.1 + spall * 0.08);
          m.tint[i] *= 1 - j * 0.8;
        }
      }
      applyCracks(m, cracks(N, { cells: 3, seed: seed + 12, keep: 0.3, width: 2.4, warp: 160 }), { dark: 0.6, depth: 0.3 });
      const oil = blotch(N, { p: 5, oct: 6, seed: seed + 13, t: 0.72, e: 0.04 }).mask;
      for (let i = 0; i < m.NN; i++) { m.mix(i, [0.12, 0.11, 0.1], oil[i] * 0.45); m.rough[i] = lerp(m.rough[i], 0.45, oil[i] * 0.5); m.tint[i] *= 1 - oil[i] * 0.6; }
      tideStains(m, { seed: seed + 14, amt: 0.2, t: 0.7, color: [0.42, 0.33, 0.22] });
      m.grime({ amt: 0.3, rad: 6, gain: 9, color: [0.17, 0.15, 0.12] });
    },
  },
  {
    name: 'runway', det: 'runway', depth: 8, cells: [1, 1, 0, 0.08],
    about: 'airfield concrete panel: sealed joints, transverse grooving, black tyre-rubber smears along the direction of travel, paint flecks, oil',
    bake(m, seed) {
      const N = m.N;
      cementBase(m, seed, { color: '#9a978f', holeRate: 0.08, wear: 0.5, mottP: 4 });
      const smear = fbm(N, { pu: 2, pv: 14, oct: 6, seed: seed + 10, gain: 0.6 });
      const smear2 = fbm(N, { pu: 4, pv: 60, oct: 3, seed: seed + 11 });
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x, d = edgeDist(x, y, N);
          const j = smooth(m.mm(10), m.mm(5), d);
          const gy = Math.abs(((y * m.texMM) % 38) - 19);
          const groove = smooth(3.5, 2, gy);
          const band = Math.exp(-Math.pow((y / N - 0.5) / 0.28, 2));
          const rub = smooth(0.45, 0.75, smear[i] * 0.7 + smear2[i] * 0.3) * band;
          m.h[i] -= j * 0.6 + groove * 0.12 * (1 - rub);
          m.mix(i, [0.06, 0.06, 0.06], j * 0.85 + rub * 0.75);
          m.rough[i] = lerp(m.rough[i], 0.6, rub * 0.6) + groove * 0.04;
          m.tint[i] *= 1 - Math.max(j, rub) * 0.85;
        }
      }
      flecks(N, 600, 0.8 * m.s, 3 * m.s, seed + 12, (i, k, n) => { m.mix(i, hash01(n, 1, 3) < 0.5 ? [0.85, 0.82, 0.75] : [0.8, 0.62, 0.15], k * 0.7); });
      const oil = blotch(N, { p: 4, oct: 6, seed: seed + 13, t: 0.74, e: 0.03 }).mask;
      for (let i = 0; i < m.NN; i++) { m.mix(i, [0.1, 0.1, 0.09], oil[i] * 0.4); m.tint[i] *= 1 - oil[i] * 0.5; }
      m.grime({ amt: 0.25, rad: 5, gain: 9 });
    },
  },
  {
    name: 'sidewalk', det: 'paver', depth: 12, cells: [4, 4, 0, 0.1],
    about: 'sidewalk slabs (4 × 4): each heaved out of true, chipped corners, cracked slabs, gum spots, moss and grit in the joints',
    bake(m, seed) {
      const N = m.N;
      const { mid } = cementBase(m, seed, { color: '#9b9890', holeRate: 0.12, wear: 0.55 });
      const cr = cracks(N, { cells: 7, seed: seed + 10, keep: 0.25, width: 2.2, warp: 70 });
      const mossF = fbm(N, { p: 16, oct: 4, seed: seed + 11 });
      const h0 = Float32Array.from(m.h);
      grid(N, 4, 4, 0, (i, e) => {
        const chipR = e.idc < 0.4 ? m.mm(10 + 40 * hash01(e.col, e.row, e.corner + 5)) : 0;
        const chip = chipR ? smooth(chipR, chipR * 0.7, e.dc + (mid[i] - 0.5) * m.mm(10)) : 0;
        const d = e.d - m.mm(4) + (mid[i] - 0.5) * m.mm(2);
        const j = 1 - smooth(0, m.mm(2), d);
        const heave = ((e.fx / e.ew) - 0.5) * (e.id - 0.5) * 0.12 + ((e.fy / e.eh) - 0.5) * (e.id2 - 0.5) * 0.12 + (e.id3 - 0.5) * 0.06;
        const crack = e.id < 0.3 ? cr[i] : 0;
        m.h[i] = lerp(h0[i] + heave - chip * 0.25 - crack * 0.25, 0.15, j);
        m.mul(i, (1 + (e.id3 - 0.5) * 0.12) * (1 - crack * 0.5));
        const moss = j * smooth(0.45, 0.7, mossF[i]);
        m.mix(i, [0.14, 0.13, 0.11], j * 0.85);
        m.mix(i, [0.22, 0.27, 0.12], moss * 0.8);
        m.rough[i] = lerp(m.rough[i], 0.95, j);
        m.tint[i] = lerp(m.tint[i], 0.05, Math.max(j, crack * 0.5));
      });
      flecks(N, 140, m.mm(6), m.mm(14), seed + 12, (i, k) => { const g = smooth(0, 0.3, k); m.mix(i, [0.24, 0.23, 0.22], g * 0.7); m.h[i] += g * 0.02; m.rough[i] = lerp(m.rough[i], 0.6, g); m.tint[i] *= 1 - g; });
      tideStains(m, { seed: seed + 13, amt: 0.2, t: 0.68, color: [0.3, 0.27, 0.22] });
      m.grime({ amt: 0.3, rad: 6, gain: 9, color: [0.16, 0.15, 0.12] });
    },
  },
  {
    name: 'stucco', det: 'stucco', depth: 9,
    about: 'knock-down stucco render: trowelled-flat lumps of thrown mortar, hairline cracks, dirt in the hollows, water streaks',
    bake(m, seed) {
      const N = m.N;
      const wx = fbm(N, { p: 12, oct: 5, seed: seed + 2 }), wy = fbm(N, { p: 12, oct: 5, seed: seed + 3 });
      const lumpsA = voronoi(N, 46, 46, seed + 1, { jitter: 1, wx, wy, wamt: 90 * m.s });
      const lumpsB = voronoi(N, 110, 110, seed + 9, { jitter: 1, wx: wy, wy: wx, wamt: 50 * m.s });
      const fl = fbm(N, { p: 32, oct: 4, seed: seed + 4 });
      const sand = fbm(N, { p: 512, oct: 1, seed: seed + 5 });
      const mott = fbm(N, { p: 4, oct: 6, seed: seed + 6 });
      const dens = fbm(N, { p: 6, oct: 4, seed: seed + 10 });
      const base = hex('#c9bfae');
      for (let i = 0; i < m.NN; i++) {
        // splatters of two sizes, sparse in places, each domed and its top knocked flat with the trowel
        const big = lumpsA.id[i] < 0.25 + dens[i] * 0.4;
        const L = big ? lumpsA : lumpsB;
        const lump = smooth(0, m.mm(big ? 10 : 5) * (0.5 + L.id[i]), L.edge[i] + (fl[i] - 0.5) * m.mm(5));
        const top = Math.min(lump * (0.6 + fl[i] * 0.6), 0.7 + L.id[i] * 0.2);
        const has = big || lumpsB.id[i] < 0.2 + dens[i] * 0.35 ? 1 : 0;
        m.h[i] = 0.35 + has * top * 0.5 + (sand[i] - 0.5) * 0.05 + (fl[i] - 0.5) * 0.05;
        m.micro[i] = sand[i];
        m.set(i, vary(base, 0.97 + (mott[i] - 0.5) * 0.14 + has * (top - 0.4) * 0.08 + (sand[i] - 0.5) * 0.08));
        m.rough[i] = 0.88 + (sand[i] - 0.5) * 0.08 - has * top * 0.08;
        m.tint[i] = 0.95;
      }
      applyCracks(m, hairlines(N, { seed: seed + 7, p: 4, thr: 0.95, soft: 0.02 }), { dark: 0.35, depth: 0.15 });
      m.grime({ amt: 0.4, rad: 5, gain: 9, color: [0.3, 0.27, 0.22], wear: 0.05 });
      streaks(m, { seed: seed + 8, amt: 0.2, t: 0.6, color: [0.3, 0.28, 0.24] });
    },
  },
  {
    name: 'plaster', det: 'plaster', depth: 5,
    about: 'painted plaster: trowelled undulation, hairline cracks, paint peeled back to the grey skim and an older green coat, lifted rims, tide-marked damp stains',
    bake(m, seed) {
      const N = m.N;
      const und = fbm(N, { p: 3, oct: 6, seed: seed + 1 });
      const sk = fbm(N, { p: 48, oct: 4, seed: seed + 2 });
      const sand = fbm(N, { p: 512, oct: 1, seed: seed + 3 });
      for (let i = 0; i < m.NN; i++) {
        m.set(i, vary(hex('#a59f94'), 0.95 + (sk[i] - 0.5) * 0.15 + (sand[i] - 0.5) * 0.08));
        m.h[i] = 0.45 + (und[i] - 0.5) * 0.12 + (sk[i] - 0.5) * 0.03;
        m.micro[i] = sand[i] * 0.5;
        m.rough[i] = 0.9;
        m.tint[i] = 0.15;
      }
      paintedOver(m, seed, { paint: '#d9d4c8', peel: 0.7, under: '#b9c4b0', paintRough: 0.72, chalk: 0.1 });
      const st = fbm(N, { p: 160, oct: 2, seed: seed + 5 });
      for (let i = 0; i < m.NN; i++) m.micro[i] += st[i] * m.tint[i] * 0.6;
      applyCracks(m, hairlines(N, { seed: seed + 6, p: 4, thr: 0.958, soft: 0.02 }), { dark: 0.3, depth: 0.12 });
      tideStains(m, { seed: seed + 7, amt: 0.25, t: 0.66, color: [0.5, 0.42, 0.3] });
      m.grime({ amt: 0.25, rad: 8, gain: 9, color: [0.3, 0.27, 0.23], wear: 0.03 });
      streaks(m, { seed: seed + 8, amt: 0.12, t: 0.62, color: [0.35, 0.32, 0.27] });
    },
  },
  {
    name: 'plaster_bleached', det: 'plasterbleach', depth: 7,
    about: 'sun-bleached limewash over old plaster: chalky, brushed in uneven coats, older ochre and rose coats showing through, eroded back to the stone in places',
    bake(m, seed) {
      const N = m.N;
      const und = fbm(N, { p: 3, oct: 6, seed: seed + 1 });
      const sk = fbm(N, { p: 40, oct: 4, seed: seed + 2 });
      const brush = fbm(N, { pu: 30, pv: 6, oct: 4, seed: seed + 3 });
      const coat = fbm(N, { p: 5, oct: 6, seed: seed + 4 });
      const er = fbm(N, { p: 6, oct: 6, seed: seed + 5 });
      const stone = voronoi(N, 10, 14, seed + 6, { jitter: 0.8 });
      const ochre = hex('#cfae78'), rose = hex('#c99a7a'), limeC = hex('#efe9dc'), stoneC = hex('#b49a70');
      for (let i = 0; i < m.NN; i++) {
        const eroded = smooth(0.7, 0.74, er[i]);
        const old = vary(coat[i] > 0.53 ? rose : ochre, 0.95 + sk[i] * 0.1);
        const lime = vary(limeC, 0.96 + (brush[i] - 0.5) * 0.12 + (sk[i] - 0.5) * 0.06);
        const thin = smooth(0.35, 0.65, brush[i] * 0.6 + coat[i] * 0.4);
        const w = 0.55 + thin * 0.45;
        let c = [lerp(old[0], lime[0], w), lerp(old[1], lime[1], w), lerp(old[2], lime[2], w)];
        const jt = smooth(m.mm(8), m.mm(2), stone.edge[i]);
        const st = vary(stoneC, (0.88 + stone.id[i] * 0.18) * (1 - jt * 0.18));
        c = [lerp(c[0], st[0], eroded), lerp(c[1], st[1], eroded), lerp(c[2], st[2], eroded)];
        m.set(i, c);
        m.h[i] = 0.55 + (und[i] - 0.5) * 0.12 + (brush[i] - 0.5) * 0.03 - eroded * (0.15 + jt * 0.2);
        m.micro[i] = sk[i];
        m.rough[i] = 0.93;
        m.tint[i] = (1 - eroded) * (0.35 + thin * 0.4);
      }
      applyCracks(m, hairlines(N, { seed: seed + 7, p: 3, thr: 0.95 }), { dark: 0.25, depth: 0.15, color: [0.4, 0.35, 0.28] });
      streaks(m, { seed: seed + 8, amt: 0.15, t: 0.6, color: [0.55, 0.48, 0.38] });
      m.grime({ amt: 0.2, rad: 6, gain: 9, color: [0.45, 0.38, 0.3], wear: 0.06 });
    },
  },
  {
    name: 'adobe', det: 'adobe', depth: 16,
    about: 'adobe: sun-dried mud bricks under a cracked mud render with straw, the render washed off in patches, rain-eroded joints',
    bake(m, seed) {
      const N = m.N;
      const mott = fbm(N, { p: 4, oct: 6, seed: seed + 1 });
      const lumpy = fbm(N, { p: 14, oct: 5, seed: seed + 2 });
      const sand = fbm(N, { p: 400, oct: 1, seed: seed + 3 });
      const loss = warp(N, fbm(N, { p: 3, oct: 7, seed: seed + 4, gain: 0.6 }), fbm(N, { p: 6, oct: 3, seed: seed + 5 }), fbm(N, { p: 6, oct: 3, seed: seed + 6 }), 60 * m.s);
      const brick = field(N), bid = field(N);
      grid(N, 4, 9, 0.5, (i, e) => {
        brick[i] = smooth(0, m.mm(12), e.d - m.mm(14) + (lumpy[i] - 0.5) * m.mm(18)); bid[i] = e.id;
      });
      const renC = hex('#b98d63'), brC = hex('#a77a52'), jtC = hex('#8f6a48');
      for (let i = 0; i < m.NN; i++) {
        const off = smooth(0.62, 0.66, loss[i]);
        const ren = vary(renC, 0.95 + (mott[i] - 0.5) * 0.2 + (sand[i] - 0.5) * 0.12);
        const br = vary(brC, 0.85 + bid[i] * 0.25 + (lumpy[i] - 0.5) * 0.2, (bid[i] - 0.5) * 0.1);
        const jt = vary(jtC, 0.8 + sand[i] * 0.2);
        const b = brick[i];
        const under = [lerp(jt[0], br[0], b), lerp(jt[1], br[1], b), lerp(jt[2], br[2], b)];
        m.set(i, [lerp(ren[0], under[0], off), lerp(ren[1], under[1], off), lerp(ren[2], under[2], off)]);
        m.h[i] = lerp(0.72 + (lumpy[i] - 0.5) * 0.14, 0.3 + b * 0.28 + (lumpy[i] - 0.5) * 0.12, off);
        m.micro[i] = sand[i];
        m.rough[i] = 0.95;
        m.tint[i] = 0.55 - off * 0.25;
      }
      // straw fibres in the render
      for (let k = 0; k < 2600; k++) {
        const x = hash01(k, 1, seed) * N, y = hash01(k, 2, seed) * N, ang = hash01(k, 3, seed) * Math.PI, len = m.mm(10 + hash01(k, 4, seed) * 25);
        for (let t = 0, n = Math.max(2, Math.round(len)); t < n; t++) {
          const i = (((Math.floor(y + Math.sin(ang) * t) % N) + N) % N) * N + (((Math.floor(x + Math.cos(ang) * t) % N) + N) % N);
          if (m.h[i] < 0.6) continue;
          m.mix(i, [0.78, 0.66, 0.4], 0.6); m.h[i] += 0.02; m.tint[i] *= 0.5;
        }
      }
      applyCracks(m, cracks(N, { cells: 7, seed: seed + 10, keep: 0.38, width: 1.8, warp: 70 }), { dark: 0.45, depth: 0.3, color: [0.2, 0.13, 0.08] });
      streaks(m, { seed: seed + 11, amt: 0.2, t: 0.58, color: [0.42, 0.3, 0.2] });
      m.grime({ amt: 0.3, rad: 8, gain: 7, color: [0.28, 0.2, 0.13], wear: 0.06 });
    },
  },
];

