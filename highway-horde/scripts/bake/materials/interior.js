// Interior recipes (the story levels): sheet vinyl, carpet tiles, drywall, ceiling tiles, wallpaper,
// terrazzo, marble and glazed ceramic tile for the hospital, the metro and the mall. Sizes are
// written for 2048² (× m.s).

import { fbm, voronoi, blur, field, smooth, clamp01, lerp, hash01, warp, fract, stroke } from '../noise.js';
import { vary, blotch, flecks, grid, hairlines, tideStains, streaks } from '../fx.js';
import { hex } from '../surface.js';
import { applyCracks } from './common.js';

/** Scuffs: short dark curved strokes (heels, trolley wheels), 0..1 field. */
function scuffs(N, seed, count, o = {}) {
  const f = field(N), s = N / 2048;
  for (let k = 0; k < count; k++) {
    const x = hash01(k, 1, seed) * N, y = (o.y0 ?? 0) * N + hash01(k, 2, seed) * N * (o.yspan ?? 1);
    const a = hash01(k, 3, seed) * Math.PI * 2, len = (o.len ?? 60) * s * (0.4 + hash01(k, 4, seed)), bend = (hash01(k, 5, seed) - 0.5) * 0.8;
    const pts = [];
    for (let t = 0; t <= 6; t++) { const aa = a + bend * t / 6; pts.push([x + Math.cos(aa) * len * t / 6, y + Math.sin(aa) * len * t / 6]); }
    stroke(N, f, pts, (o.w ?? 3) * s * (0.4 + hash01(k, 6, seed)), 0.3 + hash01(k, 7, seed) * 0.7, 2 * s);
  }
  return f;
}

/** Wear lanes: broad soft bands where feet have dulled a floor's polish. */
function lanes(N, seed) {
  const f = fbm(N, { pu: 2, pv: 2, oct: 4, seed });
  const out = field(N);
  for (let i = 0; i < out.length; i++) out[i] = smooth(0.45, 0.7, f[i]);
  return out;
}

/**
 * Glazed ceramic tile in a grid: each tile a slightly domed, slightly tilted glossy face of its own
 * tone, bevelled edges (bevel texels), grout lines, crazing, the odd cracked or chipped tile, dirty
 * grout. Returns the grout mask.
 */
function ceramic(m, seed, o) {
  const N = m.N;
  const fine = fbm(N, { p: 96, oct: 3, seed: seed + 1 });
  const glazeW = fbm(N, { p: 24, oct: 4, seed: seed + 2 });
  const speck = fbm(N, { p: 512, oct: 1, seed: seed + 3 });
  const craze = hairlines(N, { seed: seed + 4, p: 24, thr: 0.965, soft: 0.02 });
  const crack = hairlines(N, { seed: seed + 5, p: 6, thr: 0.95, soft: 0.02 });
  const dirt = fbm(N, { p: 5, oct: 6, seed: seed + 6 });
  const tileC = hex(o.color), groutC = hex(o.grout);
  const grout = field(N);
  grid(N, o.cu, o.cv, o.off ?? 0, (i, e) => {
    const gw = m.mm(o.groutMM ?? 2.5);
    const d = e.d - gw * 0.5;
    const face = smooth(0, m.mm(o.bevelMM ?? 1.2), d);
    const bev = smooth(0, m.mm(o.bevelMM ?? 1.2) * 3, d);
    const tilt = ((e.fx / e.ew) - 0.5) * (e.id - 0.5) * 0.08 + ((e.fy / e.eh) - 0.5) * (e.id2 - 0.5) * 0.08;
    const dome = Math.sin(Math.PI * e.fx / e.ew) * Math.sin(Math.PI * e.fy / e.eh) * 0.04;
    const chipR = e.idc < (o.chips ?? 0.05) ? m.mm(3 + 8 * hash01(e.col, e.row, e.corner)) : 0;
    const chip = chipR ? smooth(chipR, chipR * 0.6, e.dc) : 0;
    const cracked = e.id3 < (o.cracked ?? 0.05) ? crack[i] : 0;
    const t = vary(tileC, 1 + (e.id - 0.5) * (o.tone ?? 0.06) + (fine[i] - 0.5) * 0.03 + (glazeW[i] - 0.5) * 0.03 + (speck[i] > 0.93 ? (o.speck ?? 0) : 0), (e.id2 - 0.5) * 0.02);
    const g = vary(groutC, 0.9 + (fine[i] - 0.5) * 0.25 - smooth(0.4, 0.8, dirt[i]) * (o.groutDirt ?? 0.3));
    m.set(i, [lerp(g[0], t[0], face), lerp(g[1], t[1], face), lerp(g[2], t[2], face)]);
    if (chip > 0) m.mix(i, [0.75, 0.72, 0.66], chip * 0.9);
    m.mix(i, [0.25, 0.23, 0.2], cracked * 0.7 + craze[i] * face * (o.craze ?? 0.15));
    m.h[i] = lerp(0.3 + (fine[i] - 0.5) * 0.04, 0.8 + bev * 0.08 + tilt + dome + (glazeW[i] - 0.5) * 0.01 - chip * 0.2 - cracked * 0.05, face);
    m.micro[i] = fine[i] * (1 - face) + glazeW[i] * face * 0.2;
    m.rough[i] = lerp(0.9, (o.gloss ?? 0.12) + (glazeW[i] - 0.5) * 0.05 + chip * 0.5, face);
    m.tint[i] = lerp(0.15, o.tint ?? 0.85, face) * (1 - chip);
    grout[i] = 1 - face;
  });
  return grout;
}

export const INTERIOR = [
  {
    name: 'linoleum', det: 'linoleum', depth: 1.5,
    about: 'sheet vinyl: a marbled chip in two tones, a heat-welded seam, heel scuffs, the polish worn dull along the walking lanes, a slight wave in the floor',
    bake(m, seed) {
      const N = m.N;
      const wx = fbm(N, { p: 8, oct: 4, seed: seed + 1 }), wy = fbm(N, { p: 8, oct: 4, seed: seed + 2 });
      const marb = warp(N, fbm(N, { pu: 24, pv: 6, oct: 5, seed: seed + 3 }), wx, wy, 80 * m.s);
      const chips = voronoi(N, 220, 110, seed + 4, { jitter: 1 });
      const wave = fbm(N, { p: 3, oct: 4, seed: seed + 5 });
      const lane = lanes(N, seed + 6);
      const sc = scuffs(N, seed + 7, 260, { len: 50 });
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          const ch = chips.id[i] < 0.2 ? smooth(m.mm(1.2), m.mm(0.4), chips.f1[i]) : 0;
          let c = vary([0.62, 0.64, 0.6], 0.92 + (marb[i] - 0.5) * 0.25);
          if (ch) c = vary(c, chips.id[i] < 0.1 ? 0.7 : 1.25);
          m.set(i, c);
          const seam = smooth(m.mm(1.5), m.mm(0.5), Math.min(x + 0.5, N - x - 0.5));
          m.mix(i, [0.3, 0.3, 0.28], seam * 0.6);
          m.mix(i, [0.12, 0.12, 0.12], sc[i] * 0.55);
          m.h[i] = 0.6 + (wave[i] - 0.5) * 0.4 - seam * 0.2 + ch * 0.01;
          m.rough[i] = 0.25 + lane[i] * 0.35 + sc[i] * 0.2 + (marb[i] - 0.5) * 0.04;
          m.tint[i] = 0.85 - sc[i] * 0.5;
        }
      }
      m.grime({ amt: 0.25, rad: 10, gain: 8, color: [0.25, 0.23, 0.2], wear: 0 });
    },
  },
  {
    name: 'linoleum_hospital', det: 'linohosp', depth: 1.5,
    about: 'hospital vinyl: speckled sea-green sheet, fresh-ish but scuffed, long curved scrapes from beds and trolleys, a dull lane down the middle, dirt at the edges',
    bake(m, seed) {
      const N = m.N;
      const mott = fbm(N, { p: 6, oct: 6, seed: seed + 1 });
      const sp = fbm(N, { p: 512, oct: 1, seed: seed + 2 });
      const sp2 = voronoi(N, 300, 300, seed + 3, { jitter: 1 });
      const wave = fbm(N, { p: 3, oct: 4, seed: seed + 4 });
      const lane = lanes(N, seed + 5);
      const sc = scuffs(N, seed + 6, 150, { len: 40, w: 2.5 });
      const scrape = scuffs(N, seed + 7, 40, { len: 700, w: 1.2 });
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          let c = vary([0.6, 0.66, 0.63], 0.95 + (mott[i] - 0.5) * 0.08);
          if (sp2.id[i] < 0.25 && sp2.f1[i] < m.mm(0.9)) c = sp2.id[i] < 0.12 ? vary(c, 0.6) : vary(c, 1.3);
          if (sp[i] > 0.9) c = vary(c, 1.15);
          m.set(i, c);
          const seam = smooth(m.mm(1.5), m.mm(0.5), Math.min(x + 0.5, N - x - 0.5, y + 0.5, N - y - 0.5));
          m.mix(i, [0.32, 0.36, 0.34], seam * 0.6);
          m.mix(i, [0.15, 0.15, 0.15], sc[i] * 0.45 + scrape[i] * 0.25);
          m.h[i] = 0.6 + (wave[i] - 0.5) * 0.3 - seam * 0.2 - scrape[i] * 0.05;
          m.rough[i] = 0.18 + lane[i] * 0.3 + sc[i] * 0.2 + scrape[i] * 0.25;
          m.tint[i] = 0.9 - sc[i] * 0.4;
        }
      }
      m.grime({ amt: 0.2, rad: 10, gain: 8, color: [0.3, 0.3, 0.27], wear: 0 });
    },
  },
  {
    name: 'carpet', det: 'carpet', depth: 3, cells: [3, 3, 0, 0.06],
    about: 'commercial carpet tiles (3 × 3), laid quarter-turned: a striated loop pile catching the light differently tile to tile, tweed flecks, seams, a worn lane, stains',
    bake(m, seed) {
      const N = m.N;
      const loops = fbm(N, { p: 512, oct: 1, seed: seed + 1 });
      const strA = fbm(N, { pu: 6, pv: 160, oct: 3, seed: seed + 2 }), strB = fbm(N, { pu: 160, pv: 6, oct: 3, seed: seed + 3 });
      const fleck = voronoi(N, 260, 260, seed + 4, { jitter: 1 });
      const lane = lanes(N, seed + 5);
      const stains = blotch(N, { p: 4, oct: 6, seed: seed + 6, t: 0.72, e: 0.03 }).mask;
      grid(N, 3, 3, 0, (i, e) => {
        const turn = (e.row + e.col) & 1;
        const st = turn ? strB[i] : strA[i];
        const seam = smooth(m.mm(2), m.mm(0.5), e.d);
        let c = vary([0.3, 0.32, 0.36], 0.85 + st * 0.3 + (loops[i] - 0.5) * 0.25 + (turn ? 0.04 : -0.04));
        if (fleck.id[i] < 0.18 && fleck.f1[i] < m.mm(1.4)) c = fleck.id[i] < 0.06 ? [0.55, 0.2, 0.15] : fleck.id[i] < 0.12 ? [0.6, 0.6, 0.58] : [0.12, 0.12, 0.14];
        m.set(i, c);
        m.mul(i, 1 - lane[i] * 0.12 - seam * 0.35);
        m.mix(i, [0.2, 0.17, 0.12], stains[i] * 0.5);
        m.h[i] = 0.5 + (loops[i] - 0.5) * 0.4 + (st - 0.5) * 0.2 - lane[i] * 0.1 - seam * 0.3;
        m.micro[i] = loops[i];
        m.rough[i] = 0.97;
        m.tint[i] = 0.8 * (1 - stains[i] * 0.5);
      });
    },
  },
  {
    name: 'drywall', det: 'drywall', depth: 2,
    about: 'painted drywall: roller stipple, taped joints every 1.2 m feathered smooth, screw pops in rows, dings, a patched spot with a different sheen, scuffs along the bottom',
    bake(m, seed) {
      const N = m.N;
      const stip = fbm(N, { p: 300, oct: 2, seed: seed + 1 });
      const und = fbm(N, { p: 4, oct: 5, seed: seed + 2 });
      const patch = blotch(N, { p: 3, oct: 6, seed: seed + 3, t: 0.7, e: 0.02 }).mask;
      const dings = voronoi(N, 30, 30, seed + 4, { jitter: 1 });
      const sc = scuffs(N, seed + 5, 200, { y0: 0, yspan: 0.12, len: 70, w: 3 });
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          const jd = Math.min(Math.abs(x + 0.5 - N * 0.25), Math.abs(x + 0.5 - N * 0.75));
          const tape = smooth(m.mm(160), m.mm(40), jd);
          const sm = Math.max(tape * 0.6, patch[i]);
          const sx = Math.abs(((x + N / 16) % (N / 8)) - N / 16), sy = Math.abs(((y + N / 12) % (N / 6)) - N / 12);
          const pop = Math.hypot(sx, sy) < m.mm(5) && hash01(Math.floor(x / (N / 8)), Math.floor(y / (N / 6)), seed) < 0.35 ? 1 - Math.hypot(sx, sy) / m.mm(5) : 0;
          const ding = dings.id[i] < 0.05 ? smooth(m.mm(8), m.mm(2), dings.f1[i]) : 0;
          m.set(i, vary([0.86, 0.85, 0.82], 0.98 + (stip[i] - 0.5) * 0.04 * (1 - sm) + patch[i] * 0.02 - ding * 0.08));
          m.mix(i, [0.18, 0.17, 0.16], sc[i] * 0.5);
          m.h[i] = 0.5 + (und[i] - 0.5) * 0.06 + tape * 0.04 + pop * 0.15 - ding * 0.3;
          m.micro[i] = stip[i] * (1 - sm);
          m.rough[i] = 0.8 - patch[i] * 0.2 + (stip[i] - 0.5) * 0.06;
          m.tint[i] = 1 - sc[i] * 0.5;
        }
      }
      tideStains(m, { seed: seed + 6, amt: 0.15, t: 0.72, color: [0.6, 0.5, 0.36] });
      m.grime({ amt: 0.15, rad: 10, gain: 8, color: [0.3, 0.28, 0.25], wear: 0 });
    },
  },
  {
    name: 'ceiling_tile', det: 'ceiltile', depth: 6, cells: [2, 2, 0, 0.04],
    about: 'acoustic ceiling: 2 × 2 fissured mineral-fibre tiles in a white T-bar grid, pinholes everywhere, a brown water stain with a tide mark on the odd tile, a sagging tile',
    bake(m, seed) {
      const N = m.N;
      const fis = fbm(N, { p: 48, oct: 4, seed: seed + 1, ridge: true });
      const fis2 = warp(N, fbm(N, { p: 30, oct: 3, seed: seed + 2, ridge: true }), fbm(N, { p: 16, oct: 2, seed: seed + 3 }), fbm(N, { p: 16, oct: 2, seed: seed + 4 }), 20 * m.s);
      const pin = voronoi(N, 380, 380, seed + 5, { jitter: 1 });
      const stainF = fbm(N, { p: 6, oct: 6, seed: seed + 6 });
      grid(N, 2, 2, 0, (i, e) => {
        const bar = smooth(m.mm(14), m.mm(11), e.d);
        const fissure = smooth(0.82, 0.92, Math.max(fis[i], fis2[i]));
        const pinhole = pin.id[i] < 0.35 && pin.f1[i] < m.mm(0.8) ? 1 : 0;
        const sag = e.id < 0.12 ? Math.sin(Math.PI * e.fx / e.ew) * Math.sin(Math.PI * e.fy / e.eh) * -0.15 : 0;
        const stained = e.id2 < 0.25;
        const sv = stainF[i] + (Math.hypot(e.fx / e.ew - 0.5, e.fy / e.eh - 0.5) * -0.6);
        const st = stained ? smooth(0.2, 0.25, sv) : 0, tide = stained ? smooth(0.18, 0.2, sv) * (1 - smooth(0.2, 0.23, sv)) : 0;
        let c = vary([0.85, 0.84, 0.8], 0.97 - fissure * 0.25 - pinhole * 0.4 + (e.id3 - 0.5) * 0.04);
        c = [lerp(c[0], 0.96, bar), lerp(c[1], 0.96, bar), lerp(c[2], 0.95, bar)];
        m.set(i, c);
        m.mix(i, [0.66, 0.55, 0.38], st * 0.45 + tide * 0.5);
        m.h[i] = lerp(0.55 + sag - fissure * 0.25 - pinhole * 0.2, 0.8, bar) - smooth(m.mm(16), m.mm(14), e.d) * (1 - bar) * 0.25;
        m.rough[i] = lerp(0.97, 0.45, bar);
        m.metal[i] = bar * 0.2;
        m.tint[i] = lerp(0.9, 0.3, bar) * (1 - st * 0.6);
      });
    },
  },
  {
    name: 'wallpaper', det: 'wallpaper', depth: 1.5, shift: [1 / 3, 1 / 6],
    about: 'three strips of faded patterned paper: a stripe and a damask lozenge with a flower in a second tone, seams a little open, sun-faded patches, water stains, torn to the grey plaster in places',
    bake(m, seed) {
      const N = m.N;
      const strips = 3, sw = N / strips;
      const fade = fbm(N, { p: 3, oct: 6, seed: seed + 1 });
      const paper = fbm(N, { p: 200, oct: 2, seed: seed + 2 });
      const tear = warp(N, fbm(N, { p: 4, oct: 7, seed: seed + 3, gain: 0.6 }), fbm(N, { p: 10, oct: 3, seed: seed + 4 }), fbm(N, { p: 10, oct: 3, seed: seed + 5 }), 40 * m.s);
      const ground = hex('#c9bf9f'), ink = hex('#8d7d5c'), plasterC = hex('#9f9a8f');
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          const sx = (x % sw) / sw;
          const seamD = Math.min(x % sw, sw - (x % sw));
          const seam = smooth(m.mm(1.2), m.mm(0.3), seamD);
          // motif: a lozenge lattice (6 per strip across, 12 up the tile) with a four-petal flower
          const u = sx * 4, v = (y / N) * 12;
          const lu = fract(u) - 0.5, lv = fract(v) - 0.5;
          const loz = Math.abs(Math.abs(lu) + Math.abs(lv) - 0.42) < 0.03 ? 1 : 0;
          const r = Math.hypot(lu, lv), a = Math.atan2(lv, lu);
          const flower = r < 0.14 + 0.07 * Math.cos(a * 4) ? 1 : 0;
          const stripe = Math.abs(sx - 0.5) < 0.012 || Math.abs(sx - 0.02) < 0.006 ? 1 : 0;
          const motif = Math.max(loz * 0.8, flower, stripe * 0.6);
          const nearSeam = smooth(m.mm(60), 0, seamD);
          const torn = smooth(0.66, 0.68, tear[i] + nearSeam * 0.12);
          const rim = smooth(0.63, 0.66, tear[i] + nearSeam * 0.12) * (1 - torn);
          const fk = smooth(0.4, 0.8, fade[i]);
          let c = vary(ground, 0.97 + (paper[i] - 0.5) * 0.05 + fk * 0.08);
          const ik = vary(ink, 1 + fk * 0.25);
          c = [lerp(c[0], ik[0], motif * (1 - fk * 0.5)), lerp(c[1], ik[1], motif * (1 - fk * 0.5)), lerp(c[2], ik[2], motif * (1 - fk * 0.5))];
          const pl = vary(plasterC, 0.9 + paper[i] * 0.2);
          m.set(i, [lerp(c[0], pl[0], torn), lerp(c[1], pl[1], torn), lerp(c[2], pl[2], torn)]);
          m.mix(i, [0.3, 0.27, 0.22], seam * 0.5);
          m.mix(i, [0.95, 0.93, 0.88], rim * 0.4);
          m.h[i] = 0.6 + (paper[i] - 0.5) * 0.08 + motif * 0.03 - torn * 0.25 + rim * 0.1 - seam * 0.15;
          m.micro[i] = paper[i];
          m.rough[i] = 0.75 + torn * 0.2;
          m.tint[i] = (1 - torn) * 0.6;
        }
      }
      tideStains(m, { seed: seed + 6, amt: 0.3, t: 0.66, color: [0.55, 0.45, 0.28] });
      m.grime({ amt: 0.2, rad: 8, gain: 8, color: [0.3, 0.26, 0.2], wear: 0 });
    },
  },
  {
    name: 'terrazzo', det: 'terrazzo', depth: 1, cells: [1, 1, 0, 0.04],
    about: 'mall terrazzo: crushed marble chips of several stones in a cement matrix, ground and polished, brass divider strips at the panel edges, dull scuffed lanes, a hairline crack',
    bake(m, seed) {
      const N = m.N;
      const big = voronoi(N, 90, 90, seed + 1, { jitter: 1 });
      const small = voronoi(N, 260, 260, seed + 2, { jitter: 1 });
      const mat = fbm(N, { p: 8, oct: 5, seed: seed + 3 });
      const lane = lanes(N, seed + 4);
      const sc = scuffs(N, seed + 5, 200, { len: 50 });
      const stones = [[0.92, 0.9, 0.86], [0.55, 0.55, 0.53], [0.16, 0.15, 0.15], [0.62, 0.4, 0.3], [0.45, 0.52, 0.42], [0.82, 0.74, 0.6]];
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          let c = vary([0.72, 0.69, 0.63], 0.95 + (mat[i] - 0.5) * 0.1);
          const b = big.id[i] < 0.75 ? smooth(m.mm(0.6), m.mm(1.4), big.edge[i] - m.mm(1.5)) : 0;
          const s = small.id[i] < 0.6 ? smooth(m.mm(0.4), m.mm(0.9), small.edge[i] - m.mm(0.8)) : 0;
          if (b > 0) c = [lerp(c[0], vary(stones[Math.floor(big.id[i] * 97) % 6], 0.9 + big.id[i] * 0.2)[0], b), lerp(c[1], vary(stones[Math.floor(big.id[i] * 97) % 6], 0.9 + big.id[i] * 0.2)[1], b), lerp(c[2], vary(stones[Math.floor(big.id[i] * 97) % 6], 0.9 + big.id[i] * 0.2)[2], b)];
          else if (s > 0) { const sc2 = stones[Math.floor(small.id[i] * 89) % 6]; c = [lerp(c[0], sc2[0], s), lerp(c[1], sc2[1], s), lerp(c[2], sc2[2], s)]; }
          m.set(i, c);
          const strip = smooth(m.mm(2.5), m.mm(1.5), Math.min(x + 0.5, N - x - 0.5, y + 0.5, N - y - 0.5));
          m.mix(i, [0.7, 0.55, 0.3], strip);
          m.metal[i] = strip;
          m.mix(i, [0.25, 0.24, 0.22], sc[i] * 0.4);
          m.h[i] = 0.6 + strip * 0.02 - sc[i] * 0.01;
          m.rough[i] = lerp(0.12 + lane[i] * 0.3 + sc[i] * 0.2, 0.3, strip);
          m.tint[i] = 0.35 * (1 - strip);
        }
      }
      applyCracks(m, hairlines(N, { seed: seed + 6, p: 3, thr: 0.965, soft: 0.01 }), { dark: 0.4, depth: 0.05 });
    },
  },
  {
    name: 'marble', det: 'marble', depth: 1, cells: [2, 2, 0, 0.06],
    about: 'polished marble slabs (2 × 2): white Carrara-like stone with grey veins branching through it, book-matched slab to slab, fine joints, dull traffic lanes',
    bake(m, seed) {
      const N = m.N;
      const wx = fbm(N, { p: 3, oct: 6, seed: seed + 1 }), wy = fbm(N, { p: 3, oct: 6, seed: seed + 2 });
      const vein = warp(N, fbm(N, { p: 3, oct: 7, seed: seed + 3, ridge: true, gain: 0.55 }), wx, wy, 300 * m.s);
      const vein2 = warp(N, fbm(N, { p: 8, oct: 5, seed: seed + 4, ridge: true }), wy, wx, 120 * m.s);
      const cloud = fbm(N, { p: 4, oct: 7, seed: seed + 5 });
      const lane = lanes(N, seed + 6);
      grid(N, 2, 2, 0, (i, e) => {
        const v1 = smooth(0.8, 0.93, vein[i]), v2 = smooth(0.84, 0.95, vein2[i]) * 0.6;
        const c = vary([0.9, 0.89, 0.87], 0.94 + (cloud[i] - 0.5) * 0.08 + (e.id - 0.5) * 0.04);
        m.set(i, c);
        m.mix(i, [0.42, 0.43, 0.45], Math.max(v1, v2) * 0.8);
        const joint = smooth(m.mm(1), m.mm(0.3), e.d);
        m.mix(i, [0.5, 0.48, 0.45], joint * 0.7);
        m.h[i] = 0.6 - joint * 0.3;
        m.rough[i] = 0.08 + lane[i] * 0.22 + joint * 0.4;
        m.tint[i] = 0.3;
      });
    },
  },
  {
    name: 'tile_hospital', det: 'tilehosp', depth: 3, cells: [8, 8, 0, 0.04],
    about: 'hospital wall tile: 15 cm glazed ceramic squares, pale and clean-ish, grey grout darkening near the floor, crazed glaze, a cracked or chipped tile here and there, scuffs',
    bake(m, seed) {
      const N = m.N;
      ceramic(m, seed, { cu: 8, cv: 8, color: '#dfe3e1', grout: '#a6a9a5', tone: 0.04, chips: 0.04, cracked: 0.04, groutDirt: 0.25, gloss: 0.1, tint: 0.9 });
      const sc = scuffs(N, seed + 20, 120, { y0: 0, yspan: 0.3, len: 60, w: 2.5 });
      for (let y = 0; y < N; y++) {
        const low = smooth(0.35, 0, y / N);
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          m.mix(i, [0.2, 0.2, 0.19], sc[i] * 0.4);
          m.rough[i] = lerp(m.rough[i], 0.4, sc[i]);
          m.mix(i, [0.35, 0.33, 0.3], low * 0.12);
        }
      }
    },
  },
  {
    name: 'tile_metro', det: 'tilemetro', depth: 4, cells: [8, 16, 0.5, 0.05],
    about: 'metro subway tile: bevelled white tiles in running bond, black grime-filled grout, soot and seepage streaks, crazed glaze, cracked and missing tiles showing the mortar bed',
    bake(m, seed) {
      const N = m.N;
      const grout = ceramic(m, seed, { cu: 8, cv: 16, off: 0.5, color: '#e6e2d6', grout: '#57534c', tone: 0.06, chips: 0.08, cracked: 0.06, groutDirt: 0.6, gloss: 0.12, bevelMM: 2.5, craze: 0.3, tint: 0.85 });
      // a missing tile or two: the scored mortar bed behind
      const N8 = N / 8, N16 = N / 16;
      for (let k = 0; k < 3; k++) {
        const row = Math.floor(hash01(k, 1, seed) * 16), col = Math.floor(hash01(k, 2, seed) * 8);
        const x0 = (col + (row & 1) * 0.5) * N8, y0 = row * N16;
        const comb = fbm(N, { pu: 64, pv: 4, oct: 2, seed: seed + 30 + k });
        for (let y = Math.floor(y0); y < y0 + N16; y++) for (let x = Math.floor(x0); x < x0 + N8; x++) {
          const i = (y % N) * N + (x % N);
          m.set(i, vary([0.45, 0.43, 0.4], 0.8 + comb[i] * 0.3)); m.h[i] = 0.2 + comb[i] * 0.1; m.rough[i] = 0.95; m.tint[i] = 0;
        }
      }
      streaks(m, { seed: seed + 40, amt: 0.35, t: 0.55, pu: 30, color: [0.2, 0.18, 0.14] });
      const soot = fbm(N, { p: 3, oct: 6, seed: seed + 41 });
      for (let i = 0; i < m.NN; i++) { m.mul(i, 1 - smooth(0.5, 0.85, soot[i]) * 0.35); m.rough[i] = lerp(m.rough[i], 0.6, smooth(0.5, 0.85, soot[i]) * 0.6); }
      m.grime({ amt: 0.3, rad: 6, gain: 8, color: [0.08, 0.07, 0.06], wear: 0 });
      void grout;
    },
  },
  {
    name: 'tile_ceramic', det: 'tileceramic', depth: 2, cells: [8, 8, 0, 0.06],
    about: 'mall floor tile: matte beige porcelain squares with a granite-like speckle, light grout gone grey in the traffic lanes, scuffs, dull wear',
    bake(m, seed) {
      const N = m.N;
      ceramic(m, seed, { cu: 8, cv: 8, color: '#c9bca3', grout: '#a39c8e', tone: 0.07, chips: 0.03, cracked: 0.03, groutDirt: 0.4, gloss: 0.3, speck: -0.25, craze: 0, tint: 0.85 });
      const sp = voronoi(N, 400, 400, seed + 20, { jitter: 1 });
      const lane = lanes(N, seed + 21);
      const sc = scuffs(N, seed + 22, 220, { len: 45 });
      for (let i = 0; i < m.NN; i++) {
        if (sp.id[i] < 0.3 && sp.f1[i] < m.mm(0.8) && m.tint[i] > 0.5) m.mix(i, sp.id[i] < 0.15 ? [0.3, 0.27, 0.24] : [0.92, 0.9, 0.85], 0.6);
        m.mix(i, [0.2, 0.19, 0.17], sc[i] * 0.4);
        m.rough[i] = lerp(m.rough[i], 0.55, lane[i] * 0.6 + sc[i] * 0.3);
      }
    },
  },
];
