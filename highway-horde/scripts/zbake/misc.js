// The remaining zombie sets (scripts/bake-zombies.js):
//   wounds  an atlas of eight wounds, 4 × 2 cells, each a decal with a coverage alpha: a gash
//           with layered flesh (skin, fat, muscle), a gash to the bone, a bite (crescents of
//           tooth marks round a torn-out chunk), a gunshot wound (abrasion ring, powder
//           stippling, a trickle of blood), a burn (charred, cracked, raw and blistered rings),
//           an acid crater, maggot-pocked rot (subtle) and a laceration with a flap of skin.
//           Cell coordinates: q = offset / wound radius, the cell spans q ∈ [−2.2, 2.2], +v up.
//   grime   tileable masks the runtime thresholds by where on the body a texel is: R blood
//           soaking from the collar and front (tide-lined), G mud from the hem up (splatter and
//           caked), B sweat and body fluids, A drip runs; the normal is the stiff crust of dried
//           blood and mud; pack B the holes torn in a garment (a ramp the runtime opens wider the
//           more torn the clothes, frayed: loose threads cross every rim).
//   scalp   tileable thinning, matted hair over a grey scalp, a coverage alpha for the hair
//           (the runtime tints it with the zombie's hair colour).

import { Rgb, blur, stamp, stroke, rng, fbm, ridged, cells, noise, smooth, clamp01, mix, lin, mixc, sc, gauss } from './lib.js';
import { wfbm } from './skin.js';

export const WOUND_CELLS = { gash: 0, bone: 1, bite: 2, bullet: 3, burn: 4, acid: 5, maggots: 6, tear: 7 };
export const WOUND_Q = 2.2;

// ---------------------------------------------------------------------------------------
// wounds

function wounds(N) {
  const n = N * N, CW = N / 4, CH = N / 2;
  const alb = new Rgb(N), cov = new Float32Array(n), h = new Float32Array(n), rough = new Float32Array(n).fill(0.6), wet = new Float32Array(n);
  const put = (i, c, t, o) => {
    if (t <= 0) return;
    t = Math.min(1, t);
    alb.lay(i, c, cov[i] > 0 ? t : 1);
    cov[i] = Math.max(cov[i], t);
    if (o.rough !== undefined) rough[i] = mix(rough[i], o.rough, t);
    if (o.h) h[i] += o.h * t;
    if (o.wet !== undefined) wet[i] = mix(wet[i], o.wet, t);
  };
  const C = (hex) => lin(hex);
  const skinEdge = C('#7a5a52'), crust = C('#2a0d08'), fat = C('#b89a5a'), mus = C('#621610'), musD = C('#2c0605'), deep = C('#140303');
  const bruise = C('#4c3446'), bone = C('#d2c6a6');
  const r = rng(5101);
  for (let cell = 0; cell < 8; cell++) {
    const cx0 = (cell % 4) * CW, cy0 = Math.floor(cell / 4) * CH;
    const drips = [];
    const dripMask = new Float32Array(CW * CH);
    const drawDrip = (qx, qy, len, w) => {
      // a run of blood straight down (−q y) with a little wander, a drop at the end
      const pts = [];
      let x = qx;
      for (let s = 0; s <= 16; s++) { const t = s / 16; x += (r() - 0.5) * 0.04; pts.push([x, qy - len * t, w * (1 - t * 0.5)]); }
      drips.push(pts);
    };
    if (cell === 0 || cell === 1 || cell === 7) for (let k = 0; k < 4; k++) drawDrip((r() - 0.5) * 1.0, -0.25 - r() * 0.15, 0.6 + r() * 1.1, 0.05 + r() * 0.05);
    if (cell === 3) for (let k = 0; k < 2; k++) drawDrip((r() - 0.5) * 0.15, -0.15, 0.9 + r() * 1.0, 0.05 + r() * 0.03);
    if (cell === 2) for (let k = 0; k < 3; k++) drawDrip((r() - 0.5) * 0.9, -0.5, 0.5 + r() * 0.8, 0.05 + r() * 0.04);
    // rasterise the drips into the cell (q units → cell pixels)
    const toPx = (q) => (q / WOUND_Q * 0.5 + 0.5);
    for (const pts of drips) {
      for (let k = 0; k + 1 < pts.length; k++) {
        const [ax, ay, aw] = pts[k], [bx, by] = pts[k + 1];
        const steps = 6;
        for (let s = 0; s <= steps; s++) {
          const t = s / steps, qx = ax + (bx - ax) * t, qy = ay + (by - ay) * t;
          const px = toPx(qx) * CW, py = toPx(qy) * CH, rr = aw / (2 * WOUND_Q) * CW;
          for (let yy = Math.floor(py - rr - 1); yy <= py + rr + 1; yy++) for (let xx = Math.floor(px - rr - 1); xx <= px + rr + 1; xx++) {
            if (xx < 0 || yy < 0 || xx >= CW || yy >= CH) continue;
            const d = Math.hypot(xx + 0.5 - px, yy + 0.5 - py) / Math.max(0.5, rr);
            if (d < 1) dripMask[yy * CW + xx] = Math.max(dripMask[yy * CW + xx], 1 - d * d);
          }
        }
      }
    }
    for (let yy = 0; yy < CH; yy++) {
      for (let xx = 0; xx < CW; xx++) {
        const i = (cy0 + yy) * N + cx0 + xx;
        const qx = ((xx + 0.5) / CW * 2 - 1) * WOUND_Q, qy = ((yy + 0.5) / CH * 2 - 1) * WOUND_Q;
        const u = (cx0 + xx + 0.5) / N, v = (cy0 + yy + 0.5) / N;
        const edgeFade = smooth(2.15, 1.9, Math.max(Math.abs(qx), Math.abs(qy)));
        if (edgeFade <= 0) continue;
        const nz = fbm(u, v, 24, 4, 5102 + cell) * 0.5, nz2 = fbm(u, v, 80, 3, 5103 + cell);
        const rr = Math.hypot(qx, qy);
        const dm = dripMask[yy * CW + xx];
        if (dm > 0) put(i, mixc(C('#3a0806'), C('#5a0a07'), nz2 * 0.5 + 0.5), dm * 0.95 * edgeFade, { rough: 0.25, h: dm * 0.2, wet: 0.6 });
        if (cell === 0 || cell === 1 || cell === 7) {
          // a long cut along a diagonal: layers by the distance across it
          const ang = cell === 7 ? 0.25 : -0.5, ca = Math.cos(ang), sa = Math.sin(ang);
          const a = (qx * ca + qy * sa) / 1.15, b = -qx * sa + qy * ca;
          const zig = cell === 7 ? Math.abs(((a * 4 + 0.25) % 1 + 1) % 1 - 0.5) * 0.25 - 0.06 : 0;
          const wid = (cell === 1 ? 0.6 : cell === 7 ? 0.42 : 0.38) * Math.pow(Math.max(0, 1 - a * a), 0.6) * (1 + nz * 0.5);
          const t = (Math.abs(b - zig)) / Math.max(0.02, wid);
          const halo = smooth(2.0, 0.9, rr) * smooth(1.2, 0.6, Math.abs(a));
          put(i, bruise, halo * 0.45 * edgeFade, { abs: 0 });
          if (t < 1.6 && Math.abs(a) < 1.15) {
            put(i, crust, smooth(1.6, 1.15, t) * 0.9, { rough: 0.85, h: 0.25 });
            put(i, skinEdge, smooth(1.15, 1.0, t) * smooth(0.75, 0.95, t), { rough: 0.6, h: 0.5 });
            put(i, mixc(fat, sc(fat, 0.75), nz2 * 0.5 + 0.5), smooth(0.98, 0.9, t) * smooth(0.6, 0.75, t), { rough: 0.35, h: 0.1, wet: 0.5 });
            const fib = Math.abs(noise(b * 40, a * 4, 128, 16, 5104 + cell));
            put(i, mixc(mus, musD, fib * 0.6 + smooth(0.6, 0.1, t) * 0.4), smooth(0.75, 0.6, t), { rough: 0.22, h: -0.6 + fib * 0.2, wet: 0.85 });
            put(i, deep, smooth(0.25, 0.08, t), { rough: 0.18, h: -0.8, wet: 1 });
            if (cell === 1) {
              const bt = Math.abs(b) / 0.2;
              if (bt < 1 && Math.abs(a) < 0.8) {
                const crack = Math.pow(ridged(u, v, 60, 2, 5105), 18);
                put(i, mixc(sc(bone, 0.85 + 0.25 * Math.sqrt(1 - bt * bt)), C('#6a2a20'), crack * 0.6 + smooth(0.6, 0.8, Math.abs(a)) * 0.5), 1, { rough: 0.55, h: 1.2 * Math.sqrt(1 - bt * bt), wet: 0.3 });
              }
            }
            if (cell === 7) {
              // the flap of skin peeled back from the upper lip of the tear
              const fa = (a + 0.2) / 0.55, fb = (b - wid * 1.1) / 0.35;
              if (fb > 0 && fb < 1 && Math.abs(fa) < 1 - fb * 0.6) put(i, mixc(skinEdge, C('#a89080'), 0.3 + nz), 1, { rough: 0.55, h: 0.9 * (1 - fb), wet: 0.2 });
            }
          }
        } else if (cell === 2) {
          // bite: a torn-out chunk, crescents of tooth marks above and below, bruising
          const d = Math.hypot(qx, qy * 1.25) * (1 + nz * 0.6);
          put(i, bruise, smooth(2.0, 1.1, rr) * 0.6 * edgeFade, {});
          const ang = Math.atan2(qy, qx);
          const ringD = Math.abs(Math.hypot(qx, qy * 1.25) - 0.95);
          const tooth = smooth(0.22, 0.05, ringD) * smooth(0.45, 0.85, Math.abs(Math.cos(ang * 7))) * smooth(0.3, 0.6, Math.abs(Math.sin(ang)));
          put(i, C('#300504'), tooth, { rough: 0.35, h: -0.7, wet: 0.6 });
          if (d < 0.8) {
            const k = smooth(0.8, 0.62, d);
            const fib = Math.abs(noise(qx * 10, qy * 10, 64, 64, 5106));
            put(i, mixc(mus, musD, fib * 0.7 + smooth(0.6, 0.1, d) * 0.3), k, { rough: 0.2, h: -0.9 * k, wet: 0.95 });
            put(i, crust, smooth(0.62, 0.8, d) * k * 0.8, { rough: 0.7 });
          }
        } else if (cell === 3) {
          // gunshot: a small dark hole, the abrasion collar, powder stippling
          const d = rr * (1 + nz * 0.25);
          if (d < 0.16) put(i, C('#0a0202'), 1, { rough: 0.2, h: -1.2, wet: 1 });
          else if (d < 0.3) put(i, mixc(C('#5a1a12'), C('#2a0806'), smooth(0.16, 0.3, d)), 1, { rough: 0.5, h: -0.3, wet: 0.5 });
          const st = cells(u, v, 220, 5107, {}, 1);
          const spk = st.f1 < 0.12 && (st.id * 0.613) % 1 < 0.6 ? 1 - st.f1 / 0.12 : 0;
          if (spk > 0 && d < 1.1) put(i, C('#1a1210'), spk * smooth(1.1, 0.3, d), { rough: 0.8 });
          put(i, C('#5a3848'), smooth(0.9, 0.35, d) * 0.4, {});
        } else if (cell === 4) {
          // burn: charred black centre (cracked), raw wet ring, peeling blistered skin, reddened halo
          const d = rr * (1 + nz * 0.8);
          const crack = Math.pow(ridged(u, v, 40, 3, 5108), 10);
          put(i, C('#6a2a22'), smooth(1.9, 1.2, d) * 0.5 * edgeFade, {});
          if (d < 1.3) put(i, mixc(C('#d2c4a0'), C('#a89060'), nz2 * 0.5 + 0.5), smooth(1.3, 1.15, d) * smooth(0.95, 1.1, d), { rough: 0.7, h: 0.6 });
          if (d < 1.0) put(i, mixc(C('#8a2a20'), C('#5a1410'), nz2 * 0.5 + 0.5), smooth(1.0, 0.9, d) * smooth(0.55, 0.7, d), { rough: 0.2, h: -0.2, wet: 0.85 });
          if (d < 0.7) put(i, mixc(C('#100a08'), C('#3a1408'), crack), smooth(0.7, 0.6, d), { rough: 0.92, h: -0.1 - crack * 0.6 + nz2 * 0.3, wet: 0 });
        } else if (cell === 5) {
          // acid: a crater with a bubbled yellow-green crust, a dark rim, wet sickly fluid inside
          const d = rr * (1 + nz * 0.7);
          const pit = cells(u, v, 70, 5109, {}, 1).f1;
          if (d < 1.4) put(i, mixc(C('#a89e48'), C('#6a6a2a'), smooth(0.2, 0.5, pit)), smooth(1.4, 1.15, d) * smooth(0.75, 0.95, d), { rough: 0.75, h: 0.5 - pit * 0.5 });
          if (d < 0.95) put(i, C('#2a2010'), smooth(0.95, 0.85, d) * smooth(0.65, 0.78, d), { rough: 0.6, h: -0.2 });
          if (d < 0.75) put(i, mixc(C('#7a7a2a'), C('#3a3a10'), smooth(0.6, 0.0, d) + pit * 0.3), smooth(0.75, 0.65, d), { rough: 0.12, h: -0.9 - pit * 0.4, wet: 1 });
        } else if (cell === 6) {
          // maggot-pocked rot: grey-green-brown flesh full of pits, pale maggots in some (subtle)
          const d = rr * (1 + nz * 0.7);
          if (d > 1.3) continue;
          const k = smooth(1.3, 1.0, d);
          const pc = cells(u, v, 120, 5110, {}, 1);
          const pit = pc.f1 < 0.3 ? 1 - pc.f1 / 0.3 : 0;
          put(i, mixc(C('#4a4430'), C('#2a2418'), nz2 * 0.5 + 0.5), k, { rough: 0.3, h: -0.4 * k, wet: 0.7 });
          put(i, C('#120c06'), pit * k * 0.9, { rough: 0.25, h: -0.6 * pit, wet: 0.9 });
          // a maggot: a small pale grub in a pit, along a random direction
          if ((pc.id * 0.4142) % 1 < 0.35 && pc.f1 < 0.33) {
            const a = ((pc.id * 0.7071) % 1) * Math.PI;
            const mx = pc.dx * Math.cos(a) + pc.dy * Math.sin(a), my = -pc.dx * Math.sin(a) + pc.dy * Math.cos(a);
            const e = Math.hypot(mx / 0.28, my / 0.11);
            if (e < 1) put(i, mixc(C('#d6cca8'), C('#a89a78'), Math.abs(Math.sin(mx * 40))), k * smooth(1, 0.7, e), { rough: 0.35, h: 0.8 * Math.sqrt(1 - e * e), wet: 0.4 });
          }
        }
      }
    }
  }
  const hb = blur(h, N, Math.max(1, N / 512), false);
  const ao = new Float32Array(n);
  for (let i = 0; i < n; i++) { ao[i] = 1 - clamp01((hb[i] - h[i]) * 1.2) * 0.7; alb.scale(i, 0.7 + 0.3 * ao[i]); }
  return { alb, alpha: cov, h, rough, ao, b: wet, nStrength: 6, wrap: false };
}

// ---------------------------------------------------------------------------------------
// grime / stain masks

function grime(N) {
  const n = N * N;
  const alb = new Rgb(N), drip = new Float32Array(n), h = new Float32Array(n), rough = new Float32Array(n);
  const r = rng(5201);
  // drip runs: thin vertical streaks of various lengths
  const runs = new Float32Array(n);
  for (let k = 0; k < 260; k++) {
    const x = r(), y = r(), L = 0.04 + r() * r() * 0.35, w = 0.001 + r() * 0.0035;
    const pts = [];
    let xx = x;
    for (let s = 0; s <= 20; s++) { const t = s / 20; xx += (r() - 0.5) * 0.002; pts.push([xx, y - L * t, w * (1 - t * 0.6)]); }
    stroke(runs, N, pts, (d) => 1 - d * d);
    stamp(runs, N, xx, y - L, w * 1.6, (dx, dy) => { const d = Math.hypot(dx, dy) / (w * 1.6); return d < 1 ? 1 - d * d : 0; });
  }
  // mud splatter: dots and flecks
  const spl = new Float32Array(n);
  for (let k = 0; k < 900; k++) {
    const x = r(), y = r(), rad = 0.0008 + r() * r() * 0.006;
    stamp(spl, N, x, y, rad * 1.4, (dx, dy) => { const d = Math.hypot(dx, dy) / rad * (1 + 0.35 * noise((x + dx) * 700, (y + dy) * 700, 700, 700, k)); return d < 1 ? 1 : 0; });
  }
  for (let y = 0; y < N; y++) {
    const v = (y + 0.5) / N;
    for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N, i = y * N + x;
      // R: soak breakup: a smooth warped field the runtime thresholds (tide lines at the edge)
      const soak = wfbm(u, v, 3, 6, 5202, 0.12);
      // G: mud: caked areas (low frequency) plus the splatter
      const caked = wfbm(u, v, 5, 5, 5203, 0.1);
      const mud = clamp01(caked * 0.75 + spl[i] * 0.5);
      // B: sweat / fluid stains: blotches with rings
      const sw = wfbm(u, v, 4, 5, 5204, 0.1);
      alb.r[i] = soak; alb.g[i] = mud; alb.b[i] = sw;
      drip[i] = clamp01(runs[i]);
      // the crust: cracked, flaky, bumpy
      const cr = Math.pow(ridged(u, v, 30, 3, 5205), 12);
      h[i] = fbm(u, v, 60, 4, 5206) * 0.6 - cr * 0.8 + spl[i] * 0.4;
      rough[i] = clamp01(0.7 + fbm(u, v, 40, 3, 5207) * 0.2);
    }
  }
  // holes: a warped field (the runtime cuts at a level set by the tear), threads across the rims
  const holes = new Float32Array(n);
  for (let y = 0; y < N; y++) {
    const v = (y + 0.5) / N;
    for (let x = 0; x < N; x++) { const u = (x + 0.5) / N; holes[y * N + x] = clamp01((wfbm(u, v, 5, 6, 5208, 0.12) - 0.5) / 0.3); }
  }
  const fray = new Float32Array(n);
  for (let k = 0; k < 9000; k++) {
    const x = r(), y = r();
    const hv = holes[Math.floor(y * N) * N + Math.floor(x * N)];
    if (hv < 0.35 || hv > 0.85) continue;
    const vert = r() < 0.5, L = 0.003 + r() * 0.01;
    const ang = vert ? Math.PI / 2 + (r() - 0.5) * 0.4 : (r() - 0.5) * 0.4;
    stroke(fray, N, [[x - Math.cos(ang) * L, y - Math.sin(ang) * L, 0.0006], [x + Math.cos(ang) * L, y + Math.sin(ang) * L, 0.0004]], (d) => 1 - d);
  }
  for (let i = 0; i < n; i++) { holes[i] = clamp01(holes[i] - fray[i] * 0.45); h[i] += fray[i] * 0.4; }
  const hb = blur(h, N, Math.max(1, N / 700));
  const ao = new Float32Array(n);
  for (let i = 0; i < n; i++) ao[i] = 1 - clamp01((hb[i] - h[i]) * 1.5) * 0.6;
  return { alb, alpha: drip, h, rough, ao, b: holes, nStrength: 5, linear: true };
}

// ---------------------------------------------------------------------------------------
// scalp: thinning, matted hair

function scalp(N) {
  const n = N * N;
  const alb = new Rgb(N), hairCov = new Float32Array(n), h = new Float32Array(n), rough = new Float32Array(n).fill(0.72);
  const r = rng(5301);
  const hair = new Float32Array(n), clump = new Float32Array(n);
  // clumps of strands combed down (−v), matted together, with bare scalp between
  for (let k = 0; k < 420; k++) {
    const cx = r(), cy = r();
    const dens = wfbm(cx, cy, 3, 3, 5302, 0.1);
    if (dens < 0.42) continue;
    const ns = 10 + Math.floor(r() * 30), L = 0.05 + r() * 0.12, ang = -Math.PI / 2 + (r() - 0.5) * 0.7;
    for (let j = 0; j < ns; j++) {
      const ox = cx + (r() - 0.5) * 0.02, oy = cy + (r() - 0.5) * 0.02, w = 0.0005 + r() * 0.0007;
      const pts = [];
      let x = ox, y = oy, a = ang + (r() - 0.5) * 0.2;
      for (let s = 0; s <= 12; s++) {
        pts.push([x, y, w]);
        a += (r() - 0.5) * 0.12;
        x += Math.cos(a) * L / 12; y += Math.sin(a) * L / 12;
        // strands of a clump drift together toward its end (matted)
        x += (cx + Math.cos(ang) * L * (s / 12) - x) * 0.08;
      }
      stroke(hair, N, pts, (d) => (1 - d) * (0.7 + 0.3 * r()));
    }
    stroke(clump, N, [[cx, cy, 0.012], [cx + Math.cos(ang) * L, cy + Math.sin(ang) * L, 0.004]], (d) => 1 - d * d);
  }
  const hb2 = blur(hair, N, Math.max(1, N / 2048));
  const scalpC = lin('#7d6e62'), scalpD = lin('#5a4c42');
  for (let y = 0; y < N; y++) {
    const v = (y + 0.5) / N;
    for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N, i = y * N + x;
      const t = clamp01(hb2[i] * 1.3 + clump[i] * 0.35);
      const nn = fbm(u, v, 30, 3, 5303) * 0.5 + 0.5;
      // the colour of the hair is the instance's; here a luminance about it (strand highlights)
      const lumH = 0.35 + 0.3 * nn + 0.25 * hb2[i];
      const c = mixc(mixc(scalpC, scalpD, nn), [lumH, lumH, lumH], t);
      alb.r[i] = c[0]; alb.g[i] = c[1]; alb.b[i] = c[2];
      hairCov[i] = t;
      h[i] = t * 0.8 + clump[i] * 0.3 + fbm(u, v, 80, 2, 5304) * 0.1;
      rough[i] = mix(0.72, 0.55, t);
    }
  }
  const hb = blur(h, N, Math.max(1, N / 800));
  const ao = new Float32Array(n);
  for (let i = 0; i < n; i++) { ao[i] = 1 - clamp01((hb[i] - h[i]) * 1.5) * 0.6; }
  return { alb, alpha: hairCov, h, rough, ao, nStrength: 4 };
}

export const MISC_SETS = {
  scalp: { kind: 'scalp', fn: scalp },
  wounds: { kind: 'wound', fn: wounds },
  grime: { kind: 'grime', fn: grime },
};
