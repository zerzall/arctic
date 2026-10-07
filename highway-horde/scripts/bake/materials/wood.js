// Wood recipes: raw planks, painted lap siding, painted louvred shutters, tree bark, asphalt roof
// shingles and charred timber. Sizes are written for 2048² (× m.s).

import { fbm, voronoi, blur, field, smooth, clamp01, lerp, hash01, warp, fract, trailDown } from '../noise.js';
import { vary, blotch, flecks, grid } from '../fx.js';
import { hex } from '../surface.js';
import { runsFrom, applyCracks } from './common.js';

/**
 * Flat-sawn board grain along u in horizontal boards of height bh (texels): growth rings arching
 * into cathedrals, latewood lines, fibres and pores, knots with the grain swirling round them.
 * Returns per texel { ring (0..1 latewood), fibre, knot (0..1 knot core), board (index), fy (0..1 across) }.
 */
function grain(m, seed, boards, o = {}) {
  const N = m.N, bh = N / boards;
  const fib = fbm(N, { pu: 3, pv: 300, oct: 3, seed: seed + 1 });
  const fib2 = fbm(N, { pu: 12, pv: 512, oct: 1, seed: seed + 2 });
  const arch = fbm(N, { pu: 3, pv: 1, oct: 4, seed: seed + 3 });
  const wav = fbm(N, { pu: 8, pv: 2, oct: 3, seed: seed + 4 });
  const ring = field(N), fibre = field(N), knot = field(N), board = new Int16Array(N * N), fyA = field(N);
  // knots: a few per board
  const K = [];
  for (let b = 0; b < boards; b++) {
    const n = Math.floor(hash01(b, 1, seed) * (o.knots ?? 2.4));
    for (let k = 0; k < n; k++) K.push({ b, x: hash01(b, k + 10, seed) * N, y: (b + 0.25 + hash01(b, k + 20, seed) * 0.5) * bh, r: m.mm(6 + hash01(b, k + 30, seed) * 16) });
  }
  const rings = o.rings ?? 9;
  for (let y = 0; y < N; y++) {
    const b = Math.floor(y / bh), fy = (y + 0.5 - b * bh) / bh;
    const pith = hash01(b, 2, seed) * 1.6 - 0.3, dens = rings * (0.7 + hash01(b, 3, seed) * 0.8);
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      let rc = Math.abs(fy - pith) * dens + (arch[i] - 0.5) * 3 * (0.5 + hash01(b, 4, seed)) + (wav[i] - 0.5) * 0.6;
      let kc = 0;
      for (const kn of K) {
        if (kn.b !== b) continue;
        let dx = x - kn.x; dx -= Math.round(dx / N) * N;
        const dy = y - kn.y, d = Math.hypot(dx * 0.6, dy) / kn.r;
        if (d < 4) rc += Math.exp(-d * d * 0.35) * 2.5 * (1 - d / 4);
        kc = Math.max(kc, smooth(1, 0.5, d));
      }
      const f = fract(rc);
      ring[i] = smooth(0.72, 0.9, f) * (1 - smooth(0.93, 1, f));
      fibre[i] = fib[i] * 0.7 + fib2[i] * 0.3;
      knot[i] = kc; board[i] = b; fyA[i] = fy;
    }
  }
  return { ring, fibre, knot, board, fy: fyA, bh };
}

/** Weathered timber colour: fresh tan to silver grey by `weather` (0..1). */
function woodColour(base, ring, fibre, knot, weather, k = 1) {
  const fresh = vary(base, k * (1 - ring * 0.35 + (fibre - 0.5) * 0.18 - knot * 0.5), ring * 0.04);
  const grey = vary([0.52, 0.5, 0.46], k * (1 - ring * 0.2 + (fibre - 0.5) * 0.25 - knot * 0.35));
  return [lerp(fresh[0], grey[0], weather), lerp(fresh[1], grey[1], weather), lerp(fresh[2], grey[2], weather)];
}

/** Rusty nail heads at the given positions (texel coordinates) with a stain bleeding down. */
function nails(m, seed, pts) {
  const N = m.N, src = field(N), R = m.mm(2.8);
  for (const [cx, cy] of pts) {
    for (let dy = -Math.ceil(R); dy <= R; dy++) for (let dx = -Math.ceil(R); dx <= R; dx++) {
      const d = Math.hypot(dx, dy) / R;
      if (d > 1) continue;
      const i = (((Math.round(cy) + dy) % N + N) % N) * N + (((Math.round(cx) + dx) % N + N) % N);
      m.mix(i, [0.22, 0.14, 0.09], 0.9); m.h[i] += 0.03 * (1 - d); m.metal[i] = 0.3; m.tint[i] = 0; src[i] = 0.7;
    }
  }
  runsFrom(m, blur(N, src, 2 * m.s, 1), seed, 0.5, { color: [0.3, 0.17, 0.08], decay: 0.008 });
}

export const WOOD = [
  {
    name: 'planks', det: 'wood', depth: 10,
    about: 'raw wooden boards (crates, pallets, fences, floors): six boards per tile with flat-sawn grain and knots, weathered silver in places, checks along the grain, nails with rust bleed, gaps',
    bake(m, seed) {
      const N = m.N;
      const g = grain(m, seed, 6);
      const weather = fbm(N, { p: 4, oct: 5, seed: seed + 5 });
      const checkF = fbm(N, { pu: 6, pv: 90, oct: 3, seed: seed + 6, ridge: true });
      const butt = (b) => hash01(b, 7, seed) * N;
      const pal = ['#a07a52', '#8f6a45', '#b08a5e', '#7e5c3c', '#9a7450'].map(hex);
      const pts = [];
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x, b = g.board[i], fy = g.fy[i];
          const edge = Math.min(fy, 1 - fy) * g.bh;
          let dj = Math.abs(x - butt(b)); dj = Math.min(dj, N - dj);
          const gap = 1 - smooth(m.mm(1.5), m.mm(3.5), Math.min(edge, dj));
          const round = smooth(0, m.mm(6), Math.min(edge, dj));
          const w = clamp01(smooth(0.3, 0.75, weather[i]) * 0.8 + hash01(b, 8, seed) * 0.3);
          const c = woodColour(pal[b % pal.length], g.ring[i], g.fibre[i], g.knot[i], w, 0.95 + hash01(b, 9, seed) * 0.1);
          const check = smooth(0.94, 0.97, checkF[i]) * w;
          m.set(i, c);
          m.mix(i, [0.05, 0.04, 0.03], gap * 0.95 + check * 0.6);
          m.h[i] = 0.75 + round * 0.12 - g.ring[i] * 0.03 * (0.3 + w) + (g.fibre[i] - 0.5) * 0.04 * (0.5 + w) - gap * 0.7 - check * 0.15 + (hash01(b, 11, seed) - 0.5) * 0.06;
          m.micro[i] = g.fibre[i];
          m.rough[i] = 0.7 + w * 0.2 - g.knot[i] * 0.1;
          m.tint[i] = (1 - gap) * (0.75 - w * 0.25);
        }
        const b = Math.floor(y / g.bh);
        if (Math.abs((y + 0.5) - (b + 0.5) * g.bh) < 0.5) {
          for (const off of [m.mm(30), -m.mm(30)]) for (const side of [-0.28, 0.28]) pts.push([(butt(b) + off + N) % N, (b + 0.5 + side) * g.bh]);
        }
      }
      nails(m, seed + 12, pts);
      m.grime({ amt: 0.3, rad: 6, gain: 7, color: [0.12, 0.09, 0.06], wear: 0.04 });
    },
  },
  {
    name: 'siding', det: 'siding', depth: 14,
    about: 'painted lap siding: twelve boards per tile, each lapping the one below, paint cracked along the grain and peeled to silver wood, nail rows, butt joints, dirt under the laps',
    bake(m, seed) {
      const N = m.N;
      const g = grain(m, seed, 12, { knots: 0.8, rings: 6 });
      const peel = warp(N, fbm(N, { pu: 3, pv: 6, oct: 7, seed: seed + 1, gain: 0.6 }), fbm(N, { pu: 4, pv: 30, oct: 3, seed: seed + 2 }), fbm(N, { pu: 4, pv: 30, oct: 3, seed: seed + 3 }), 50 * m.s);
      const crackF = fbm(N, { pu: 4, pv: 200, oct: 3, seed: seed + 4, ridge: true });
      const chalk = fbm(N, { p: 5, oct: 5, seed: seed + 5 });
      const paintC = hex('#d7d2c4');
      const pts = [];
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x, b = g.board[i], fy = g.fy[i];
          const joint = hash01(b, 21, seed) * N;
          let dj = Math.abs(x - joint); dj = Math.min(dj, N - dj);
          const butt = smooth(m.mm(1.5), m.mm(0.4), dj);
          // a lap board: thick at its lower (butt) edge, tapering up under the board above
          const lap = 0.92 - fy * 0.5 - smooth(m.mm(3) / g.bh, 0, fy) * 0.12;
          const shade = smooth(0.82, 1, fy);
          const cr = smooth(0.95, 0.975, crackF[i]);
          const pv = peel[i] + cr * 0.06;
          const p = 1 - smooth(0.645, 0.655, pv);
          const rim = smooth(0.62, 0.645, pv) * p;
          const wood = woodColour(hex('#8a7558'), g.ring[i], g.fibre[i], g.knot[i], 0.85);
          const pc = vary(paintC, 0.95 + (chalk[i] - 0.5) * 0.12 + rim * 0.05 - cr * 0.3);
          m.set(i, [lerp(wood[0], pc[0], p), lerp(wood[1], pc[1], p), lerp(wood[2], pc[2], p)]);
          m.mul(i, 1 - shade * 0.35 - butt * 0.5);
          m.h[i] = lap + p * 0.03 + rim * 0.02 + (g.fibre[i] - 0.5) * 0.03 * (1.5 - p) - butt * 0.2 - cr * 0.02;
          m.micro[i] = g.fibre[i] * (1 - p * 0.5);
          m.rough[i] = lerp(0.85, 0.6 + chalk[i] * 0.2, p);
          m.tint[i] = p * (1 - shade * 0.5);
        }
        const b = Math.floor(y / g.bh);
        if (Math.abs((y + 0.5) - (b + 0.18) * g.bh) < 0.5) for (let k = 0; k < 8; k++) pts.push([(k + 0.5) / 8 * N + (b % 2) * m.mm(13), (b + 0.18) * g.bh]);
      }
      nails(m, seed + 6, pts);
      m.grime({ amt: 0.25, rad: 8, gain: 6, color: [0.15, 0.13, 0.1], wear: 0.03 });
    },
  },
  {
    name: 'shutter_blue', det: 'shutter', depth: 16, shift: [0.37, 0.25],
    about: 'painted louvred shutter: eight slats per tile, sun-faded blue enamel cracked and peeled to grey wood and an older green coat, dust along each slat',
    bake(m, seed) {
      const N = m.N;
      const g = grain(m, seed, 8, { knots: 0.5, rings: 5 });
      const peel = warp(N, fbm(N, { pu: 4, pv: 8, oct: 7, seed: seed + 1, gain: 0.6 }), fbm(N, { pu: 4, pv: 30, oct: 3, seed: seed + 2 }), fbm(N, { pu: 4, pv: 30, oct: 3, seed: seed + 3 }), 40 * m.s);
      const crackF = fbm(N, { pu: 4, pv: 180, oct: 3, seed: seed + 4, ridge: true });
      const fade = fbm(N, { p: 4, oct: 5, seed: seed + 5 });
      const blue = hex('#3f6f9a'), green = hex('#5b7f5a');
      for (let i = 0; i < m.NN; i++) {
        const fy = g.fy[i];
        // a slat seen face on: tilted, its top edge under the slat above in shadow
        const slat = 0.35 + fy * 0.55 - smooth(0.9, 1, fy) * 0.5;
        const shadow = smooth(0.2, 0, fy) * 0.6 + smooth(0.88, 1, fy) * 0.8;
        const cr = smooth(0.95, 0.975, crackF[i]);
        const pv = peel[i] + cr * 0.05;
        const p = 1 - smooth(0.6, 0.61, pv), old = 1 - smooth(0.66, 0.67, pv);
        const wood = woodColour(hex('#7d6a52'), g.ring[i], g.fibre[i], g.knot[i], 0.9);
        const gc = vary(green, 0.9 + fade[i] * 0.2);
        const bc = vary(blue, 0.92 + (fade[i] - 0.5) * 0.25 - cr * 0.3);
        let c = [lerp(wood[0], gc[0], old), lerp(wood[1], gc[1], old), lerp(wood[2], gc[2], old)];
        c = [lerp(c[0], bc[0], p), lerp(c[1], bc[1], p), lerp(c[2], bc[2], p)];
        m.set(i, c);
        m.mix(i, [0.85, 0.85, 0.85], smooth(0.5, 0.85, fade[i]) * 0.25 * p);
        m.mul(i, 1 - shadow * 0.6);
        m.mix(i, [0.5, 0.45, 0.38], smooth(0.75, 0.9, fy) * 0.25);
        m.h[i] = slat + p * 0.03 + old * 0.015 + (g.fibre[i] - 0.5) * 0.03 * (1.5 - p);
        m.micro[i] = g.fibre[i];
        m.rough[i] = lerp(0.85, 0.55 + fade[i] * 0.25, p);
        m.tint[i] = p * 0.95;
      }
      m.grime({ amt: 0.25, rad: 6, gain: 7, color: [0.15, 0.13, 0.1], wear: 0.03 });
    },
  },
  {
    name: 'bark', det: 'bark', depth: 50,
    about: 'tree bark: deep vertical fissures between corky ridges plated by cross-cracks, grey weathered tops, brown in the furrows, moss and lichen patches',
    bake(m, seed) {
      const N = m.N;
      // ridges: Voronoi stretched along v (the trunk), warped so they braid
      const wx = fbm(N, { pu: 6, pv: 2, oct: 4, seed: seed + 1 }), wy = fbm(N, { pu: 6, pv: 2, oct: 4, seed: seed + 2 });
      const v = voronoi(N, 9, 3, seed + 3, { jitter: 1, wx, wy, wamt: 140 * m.s });
      const plates = voronoi(N, 9, 14, seed + 4, { jitter: 1, wx, wy, wamt: 60 * m.s });
      const fine = fbm(N, { pu: 40, pv: 10, oct: 3, seed: seed + 5 });
      const fib = fbm(N, { pu: 6, pv: 200, oct: 2, seed: seed + 6 });
      const moss = fbm(N, { p: 5, oct: 6, seed: seed + 7 });
      const cork = fbm(N, { pu: 24, pv: 6, oct: 4, seed: seed + 8, ridge: true });
      for (let i = 0; i < m.NN; i++) {
        // broad corky ridges, rounded, split by deep narrow fissures; a few cross-breaks on the ridges
        const ridge = Math.sqrt(smooth(0, m.mm(45), v.edge[i]));
        const cross = (1 - smooth(m.mm(1.5), m.mm(5), plates.edge[i])) * smooth(0.3, 0.7, ridge) * (plates.id[i] < 0.5 ? 1 : 0);
        const hgt = ridge * (0.8 - cross * 0.3) + (cork[i] - 0.5) * 0.12 * ridge + (fine[i] - 0.5) * 0.06 + (fib[i] - 0.5) * 0.04;
        m.h[i] = 0.15 + hgt * 0.8;
        const top = smooth(0.5, 0.9, hgt);
        const deep = vary([0.24, 0.17, 0.12], 0.9 + fine[i] * 0.2);
        const grey = vary([0.48, 0.45, 0.4], 0.85 + fib[i] * 0.3 + (v.id[i] - 0.5) * 0.15);
        m.set(i, [lerp(deep[0], grey[0], top), lerp(deep[1], grey[1], top), lerp(deep[2], grey[2], top)]);
        m.micro[i] = fib[i];
        m.rough[i] = 0.92;
        m.tint[i] = 0.6;
        const mk = smooth(0.55, 0.75, moss[i]) * (0.4 + top * 0.6);
        m.mix(i, [0.22, 0.3, 0.12], mk * 0.7);
      }
      m.grime({ amt: 0.4, rad: 12, gain: 5, color: [0.06, 0.04, 0.03], wear: 0.05 });
    },
  },
  {
    name: 'shingles', det: 'shingle', depth: 12, cells: [8, 10, 0.5, 0.12],
    about: 'asphalt roof shingles: ten courses of three-tab shingles, mineral granules, granule loss going black, algae streaks, curled and missing tabs',
    bake(m, seed) {
      const N = m.N;
      const gran = fbm(N, { p: 512, oct: 1, seed: seed + 1 });
      const gran2 = fbm(N, { p: 220, oct: 2, seed: seed + 2 });
      const loss = fbm(N, { p: 6, oct: 6, seed: seed + 3 });
      const alg = fbm(N, { pu: 18, pv: 2, oct: 5, seed: seed + 4 });
      grid(N, 8, 10, 0.5, (i, e) => {
        const fy = e.fy / e.eh;                              // 0 at the butt edge (downslope)
        const fx = e.fx / e.ew;
        const slot = smooth(0.035, 0.015, Math.min(fx, 1 - fx)) * smooth(0.7, 0.55, fy);
        const missing = hash01(e.col, e.row, 14) < 0.03 ? smooth(0.62, 0.55, fy) : 0;
        const curl = hash01(e.col, e.row, 15) < 0.12 ? smooth(0.25, 0, fy) * 0.15 : 0;
        const lost = smooth(0.6, 0.7, loss[i] + (e.id - 0.5) * 0.15);
        m.h[i] = 0.92 - fy * 0.42 - slot * 0.35 - missing * 0.3 + curl + (gran[i] - 0.5) * 0.06 * (1 - lost) + (gran2[i] - 0.5) * 0.03;
        const tone = 0.85 + e.id * 0.3;
        let c = vary([0.33, 0.32, 0.31], tone * (0.85 + gran[i] * 0.3 + (gran2[i] - 0.5) * 0.2), (e.id2 - 0.5) * 0.1);
        if (gran[i] > 0.88) c = vary(c, 1.5);
        m.set(i, c);
        m.mix(i, [0.07, 0.07, 0.07], lost * 0.7 + slot * 0.8 + missing * 0.6);
        m.mul(i, 1 - smooth(0.12, 0, fy) * 0.3);
        m.mix(i, [0.12, 0.13, 0.1], smooth(0.58, 0.82, alg[i]) * 0.45);
        m.micro[i] = gran[i];
        m.rough[i] = 0.9 - lost * 0.15;
        m.tint[i] = 0.8 * (1 - lost * 0.6) * (1 - slot);
      });
      m.grime({ amt: 0.3, rad: 6, gain: 7, color: [0.05, 0.05, 0.05], wear: 0.04 });
    },
  },
  {
    name: 'char', det: 'char', depth: 14,
    about: 'charred timber: alligator checking into glossy black blocks, deep cracks, silver ash in drifts, brown half-burnt wood showing where it flaked',
    bake(m, seed) {
      const N = m.N;
      // checking: blocks elongated along the grain (u)
      const v = voronoi(N, 22, 36, seed + 1, { jitter: 0.8, wx: fbm(N, { p: 16, oct: 3, seed: seed + 2 }), wy: fbm(N, { p: 16, oct: 3, seed: seed + 3 }), wamt: 20 * m.s });
      const fine = fbm(N, { pu: 8, pv: 120, oct: 3, seed: seed + 4 });
      const ash = fbm(N, { p: 5, oct: 6, seed: seed + 5 });
      const flake = fbm(N, { p: 8, oct: 6, seed: seed + 6 });
      for (let i = 0; i < m.NN; i++) {
        const blk = smooth(0, m.mm(8), v.edge[i]);
        const crack = 1 - smooth(m.mm(1), m.mm(3.5), v.edge[i]);
        m.h[i] = 0.3 + Math.sqrt(blk) * 0.55 + (v.id[i] - 0.5) * 0.08 + (fine[i] - 0.5) * 0.05;
        m.set(i, vary([0.06, 0.055, 0.05], 0.8 + blk * 0.5 + fine[i] * 0.3));
        m.mix(i, [0.01, 0.01, 0.01], crack * 0.9);
        const fl = smooth(0.68, 0.72, flake[i]);
        m.mix(i, vary([0.32, 0.2, 0.12], 0.8 + fine[i] * 0.4), fl * 0.85);
        const a = smooth(0.55, 0.8, ash[i]) * (0.5 + (1 - blk) * 0.5);
        m.mix(i, [0.55, 0.53, 0.5], a * 0.7);
        m.micro[i] = fine[i];
        m.rough[i] = lerp(0.45, 0.95, Math.max(a, fl, crack)) + (fine[i] - 0.5) * 0.1;
        m.tint[i] = 0.25 * (1 - a);
      }
      m.grime({ amt: 0.3, rad: 6, gain: 7, color: [0.01, 0.01, 0.01], wear: 0.03 });
    },
  },
];
