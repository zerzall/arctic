// Faces (scripts/bake-zombies.js): six head sets painted in the face frame of the zombie
// models — a front projection of the head, unit head coordinates z (right) and y (up) — on the
// walker's anchors (actor-zmodels.js faceAnchors; the runtime stretches them onto every other
// type): the eyes, the lips, the mouth and chin, the nose, the cheeks. The base skin comes from
// the body's own stage texture; a face paints only what a face adds, with a coverage alpha:
//   eyes      milky cataracts over faded irises, yellowed bloodshot sclera, a wet red lid rim
//   sockets   sunken, bruised, dirt in the creases (nasolabial folds, crow's feet, brow lines)
//   mouth     bluish lips (fresh), cracked grey lips (weeks), lips gone to the gums (months),
//             torn cheeks onto the molars; fresh and dried blood from the mouth down the chin
//   nose      a rotted-away nose leaves the nasal cavity (variants for the nose-less only)
//   scalp     matted hair and bare patches at the hairline
// pack B marks "absolute" paint (blood, eyes, teeth, gums: not shifted by the skin tone).

import { Rgb, blur, stamp, stroke, tree, rng, fbm, ridged, cells, noise, smooth, clamp01, mix, lin, mixc, sc, gauss } from './lib.js';

/** The canonical (walker) anchors and the frame's extent, in unit head coordinates. */
export const FACE = { EZ: 0.266, EY: 0.074, MY: -0.325, CY: -0.985, Z0: -1.1, Z1: 1.1, Y0: -1.25, Y1: 0.95, RZ: 2.8, RY: 3.85 };
const EYE_RZ = 0.42 / FACE.RZ * 1.08, EYE_RY = 0.4 / FACE.RY * 1.1;
/** The eye spots (frame uv centres and radius): left and right eye, looked up in eye-local coordinates. */
export const EYE_SPOT = { L: [0.075, 0.075], R: [0.925, 0.075], r: 0.065, RZ: EYE_RZ, RY: EYE_RY };

function fctx(N, seed) {
  const n = N * N;
  return { N, seed, alb: new Rgb(N), cov: new Float32Array(n), h: new Float32Array(n), rough: new Float32Array(n).fill(0.6), abs: new Float32Array(n) };
}

/** Pixel centre → unit head coordinates. */
const ZY = (N, x, y) => [FACE.Z0 + (x + 0.5) / N * (FACE.Z1 - FACE.Z0), FACE.Y0 + (y + 0.5) / N * (FACE.Y1 - FACE.Y0)];
/** Unit head coordinates → frame uv. */
const UV = (z, y) => [(z - FACE.Z0) / (FACE.Z1 - FACE.Z0), (y - FACE.Y0) / (FACE.Y1 - FACE.Y0)];

function each(F, fn) {
  const N = F.N;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const [z, yy] = ZY(N, x, y); fn(z, yy, y * N + x, (x + 0.5) / N, (y + 0.5) / N); }
}

/** Paint colour c with coverage t (max-combined), roughness, height, absolute flag. */
function paint(F, i, c, t, o = {}) {
  if (t <= 0) return;
  t = Math.min(1, t);
  F.alb.lay(i, c, F.cov[i] > 0 ? t : 1);
  F.cov[i] = Math.max(F.cov[i], t);
  if (o.rough !== undefined) F.rough[i] = mix(F.rough[i], o.rough, t);
  if (o.h) F.h[i] += o.h * t;
  if (o.abs !== undefined) F.abs[i] = mix(F.abs[i], o.abs, t);
}

/** Physical distance (model units) between two points in unit head coordinates. */
const pd = (z0, y0, z1, y1) => Math.hypot((z1 - z0) * FACE.RZ, (y1 - y0) * FACE.RY);

// ---------------------------------------------------------------------------------------
// features

/**
 * The eyes, painted into two spots of their own at the bottom corners of the frame (below the
 * jaw, where no head surface projects): the eye materials look them up in eye-local
 * coordinates (x outward, y up, the eyeball's front radius = 1). A cloudy cornea over a faded
 * iris (cataract `milk` 0..1), yellowed sclera with red vessels and hemorrhage blotches
 * (`blood`); `gone` paints a dried dark ruin instead (-1 left, 1 right). On the face itself the
 * eye leaves only a wet red rim of lid.
 */
function eyes(F, o) {
  const scl0 = lin(o.sclera || '#a39577'), scl1 = lin('#6e5c40'), vessel = lin('#7a1712'), hem = lin('#5e0c0a');
  const iris = lin(o.iris || '#6a6a5a'), milk = lin(o.milkCol || '#aab0ac'), pupil = lin('#4a4e4c');
  const lidRim = lin('#6a2a26'), dead = lin('#1c0907');
  const N = F.N, r = rng(F.seed + 7);
  for (const s of [-1, 1]) {
    const [cu, cv] = s < 0 ? EYE_SPOT.L : EYE_SPOT.R, R = EYE_SPOT.r;
    // vessels: thin trees from the edge of the eye toward the iris
    const ves = new Float32Array(N * N);
    for (let k = 0; k < (o.vessels ?? 22); k++) {
      const a = r() * Math.PI * 2;
      tree(r, cu + Math.cos(a) * R * 0.98, cv + Math.sin(a) * R * 0.98, a + Math.PI + (r() - 0.5) * 0.6, R * (0.25 + r() * 0.3), R * (0.012 + r() * 0.012), 2,
        (pts) => stroke(ves, N, pts, (d) => 1 - d, 'max', false), { curl: 0.7, split: 0.9, step: R * 0.02 });
    }
    const gone = o.gone === s;
    const x0 = Math.floor((cu - R * 1.2) * N), x1 = Math.ceil((cu + R * 1.2) * N), y0 = Math.floor((cv - R * 1.2) * N), y1 = Math.ceil((cv + R * 1.2) * N);
    for (let y = Math.max(0, y0); y <= Math.min(N - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(N - 1, x1); x++) {
      const u = (x + 0.5) / N, v = (y + 0.5) / N, i = y * N + x;
      const dx = (u - cu) / R, dy = (v - cv) / R, d = Math.hypot(dx, dy);
      if (d > 1.2) continue;
      if (gone) {
        const n = fbm(u, v, 60, 3, F.seed + 9) * 0.5 + 0.5;
        paint(F, i, mixc(dead, lin('#3a1a10'), n * smooth(0.2, 1, d)), 1, { rough: 0.5 + n * 0.3, h: -1.2 * (1 - Math.min(1, d) ** 2) + n * 0.3, abs: 1 });
        continue;
      }
      // sclera, then the iris disc (looking a little off)
      const iz = dx - (o.look ?? 0.1), iy = dy + 0.06;
      const di = Math.hypot(iz, iy) / (o.irisR ?? 0.44);
      const n = fbm(u, v, 90, 3, F.seed + 11) * 0.5 + 0.5;
      let c = mixc(scl0, scl1, smooth(0.35, 1.0, d) * 0.85 + n * 0.25);
      const corner = smooth(0.3, 0.95, Math.abs(dx));
      c = mixc(c, vessel, clamp01(ves[i] * (0.6 + corner * 0.6)) * (o.blood ?? 0.8));
      const bl = smooth(0.62, 0.8, fbm(u, v, 14, 3, F.seed + 12 + s) * 0.5 + 0.5) * corner * (o.blood ?? 0.8);
      c = mixc(c, hem, bl * 0.8);
      if (di < 1.1) {
        const ang = Math.atan2(iy, iz);
        const streak = noise(ang * 8, di * 3, 16, 64, F.seed + 13) * 0.5 + 0.5;
        let ic = mixc(sc(iris, 0.6), sc(iris, 1.25), streak);
        ic = mixc(ic, pupil, smooth(0.42, 0.3, di));
        // cataract: a milky cloud over it, densest in the middle
        const cl = (o.milk ?? 0.8) * (0.35 + 0.5 * smooth(1.0, 0.15, di)) * (0.6 + 0.4 * (fbm(u, v, 40, 3, F.seed + 14) * 0.5 + 0.5));
        ic = mixc(ic, milk, clamp01(cl));
        c = mixc(c, ic, smooth(1.0, 0.92, di));
        c = mixc(c, sc(iris, 0.45), smooth(0.85, 1.0, di) * smooth(1.1, 1.0, di) * 0.6);
      }
      paint(F, i, c, 1, { rough: 0.08, abs: 1 });
    }
  }
  // on the face: the wet red rim of the lids round each eye
  each(F, (z, y, i, u, v) => {
    for (const s of [-1, 1]) {
      const d = Math.hypot((z - s * FACE.EZ) / EYE_RZ, (y - FACE.EY) / EYE_RY);
      if (d > 1.35) continue;
      const t = smooth(1.35, 1.0, d) * (o.rim ?? 0.75) * (0.6 + 0.4 * (fbm(u, v, 30, 2, F.seed + 15) * 0.5 + 0.5));
      paint(F, i, mixc(lidRim, lin('#2a1412'), smooth(1.0, 0.6, d)), t * 0.85, { rough: 0.3, abs: 0.5 });
    }
  });
}

/** Sunken sockets, bruised and dark, bags under the eyes, crow's feet and brow lines. */
function sockets(F, o) {
  const dark = lin(o.col || '#4c3c46'), bag = lin(o.bag || '#6a5458');
  each(F, (z, y, i, u, v) => {
    for (const s of [-1, 1]) {
      const dz = (z - s * FACE.EZ) / EYE_RZ, dy = (y - FACE.EY) / EYE_RY;
      const d = Math.hypot(dz * 0.8, dy * 0.95);
      if (d > 3.2) continue;
      const n = fbm(u, v, 20, 3, F.seed + 21) * 0.5 + 0.5;
      const t = smooth(3.2, 1.6, d) * (o.k ?? 0.65) * (0.7 + 0.5 * n);
      const under = dy < 0 ? smooth(-1.2, -2.4, dy) * smooth(3.3, 2.0, d) : 0;
      paint(F, i, mixc(dark, bag, under), t, { h: -0.8 * t, abs: 0 });
      // crow's feet at the outer corner
      if (dz * s > 1.4) {
        const cf = Math.pow(Math.abs(noise((Math.atan2(dy, dz * s)) * 10, d, 32, 8, F.seed + 22)), 0.15);
        F.h[i] -= (1 - cf) * 0.3 * smooth(3.0, 1.8, d);
      }
    }
  });
  // brow lines: shallow horizontal furrows on the forehead
  each(F, (z, y, i, u, v) => {
    if (y < 0.3 || y > 0.85 || Math.abs(z) > 0.75) return;
    const w = Math.sin((y + fbm(u, v, 4, 2, F.seed + 23) * 0.05) * (62 + 14 * (fbm(u, v, 2, 2, F.seed + 24))));
    F.h[i] -= Math.pow(Math.max(0, w), 8) * 0.35 * smooth(0.85, 0.5, Math.abs(z));
  });
}

/** Nasolabial folds and dirt worked into the creases of the face. */
function creases(F, o) {
  const dirt = lin(o.dirt || '#3e3226');
  each(F, (z, y, i, u, v) => {
    let g = 0;
    for (const s of [-1, 1]) {
      // the fold from beside the nose down to the mouth corner
      const t = clamp01((y + 0.12) / (-0.36 + 0.12));
      const zc = s * (0.14 + t * 0.24);
      if (y < 0.0 && y > -0.48) {
        const d = Math.abs(z - zc) * FACE.RZ;
        const f = gauss(d, 0.09) * smooth(0.0, 0.1, -y);
        F.h[i] -= f * 0.9;
        g = Math.max(g, f);
      }
    }
    // around the nostrils and under the nose
    g = Math.max(g, gauss(pd(z, y, 0, -0.2), 0.25) * 0.6);
    const n = fbm(u, v, 30, 3, F.seed + 31) * 0.5 + 0.5;
    if (g > 0.02) paint(F, i, dirt, g * (o.k ?? 0.55) * (0.6 + 0.6 * n), { rough: 0.85, abs: 0 });
    // general grime blotches over the face
    const gb = smooth(0.62, 0.85, fbm(u, v, 6, 4, F.seed + 32) * 0.5 + 0.5) * (o.grime ?? 0.35);
    if (gb > 0.02 && Math.abs(z) < 1) paint(F, i, dirt, gb * 0.6, { rough: 0.85, abs: 0 });
  });
}

/** Lips by stage: 'blue' (fresh: bluish-purple), 'grey' (cracked, dark), 'gone' (receded to the gums). */
function lips(F, o) {
  const blue = lin('#5a4a62'), grey = lin('#4a3634'), gum = lin('#5a1a1a'), tooth = lin('#9a8858'), gap = lin('#160605');
  each(F, (z, y, i, u, v) => {
    const az = Math.abs(z);
    if (az > 0.45 || y > -0.2 || y < -0.55) return;
    const w = smooth(0.42, 0.3, az);
    // upper lip band around MY, lower lip a little below (the jaw at rest)
    const up = gauss((y - (FACE.MY + 0.01 - az * az * 0.15)) * FACE.RY, 0.1) * w;
    const lo = gauss((y - (FACE.MY - 0.09 - az * az * 0.1)) * FACE.RY, 0.12) * w;
    const n = fbm(u, v, 50, 3, F.seed + 41) * 0.5 + 0.5;
    const crack = Math.pow(Math.abs(noise(z * 120, y * 12, 256, 32, F.seed + 42)), 0.25);
    if (o.kind === 'gone') {
      // no lips: the gum line and the roots of the teeth bared above and below the mouth
      const band = Math.max(up, lo);
      const toothK = smooth(0.5, 0.8, Math.abs(Math.sin((z + 0.02) * 40))) * smooth(0.4, 0.75, band);
      const c = mixc(mixc(gum, sc(gum, 0.6), n), mixc(tooth, sc(tooth, 0.6), n), toothK);
      paint(F, i, mixc(c, gap, smooth(0.45, 0.6, 1 - Math.abs(Math.sin((z + 0.02) * 40))) * toothK * 0.8), band * 1.2, { rough: 0.45, h: band * 0.3 - (1 - toothK) * band * 0.4, abs: 1 });
    } else {
      const c = o.kind === 'blue' ? mixc(blue, sc(blue, 0.7), n) : mixc(grey, sc(grey, 0.6), n);
      const t = Math.max(up, lo) * (o.k ?? 0.85);
      paint(F, i, mixc(c, sc(c, 0.5), (1 - crack) * 0.6), t, { rough: o.kind === 'blue' ? 0.5 : 0.8, h: t * 0.25 - (1 - crack) * t * 0.3, abs: 0.4 });
    }
  });
}

/**
 * Blood from the mouth: a smear round it, runs down over the chin (gravity, wandering), drops
 * at their ends; `fresh` 1 is red and wet, 0 brown-black and dry, cracked.
 */
function mouthBlood(F, o) {
  const N = F.N, r = rng(F.seed + 51);
  const m = new Float32Array(N * N);
  const runs = o.runs ?? 9;
  for (let k = 0; k < runs; k++) {
    const z0 = (r() - 0.5) * 0.7, y0 = FACE.MY - 0.06 - r() * 0.05;
    const L = 0.3 + r() * 0.65, w = 0.006 + r() * 0.01;
    const pts = [];
    let z = z0;
    for (let s = 0; s <= 20; s++) {
      const t = s / 20;
      z += (r() - 0.5) * 0.02;
      const [u, v] = UV(z, y0 - L * t);
      pts.push([u, v, w * (1 - t * 0.55) * (0.8 + 0.4 * r())]);
    }
    stroke(m, N, pts, (d) => 1 - d * d, 'max', false);
    const [ue, ve] = UV(z, y0 - L);
    stamp(m, N, ue, ve - w * 0.5, w * 1.5, (dx, dy) => { const d = Math.hypot(dx, dy) / (w * 1.5); return d < 1 ? 1 - d * d : 0; }, 'max', false);
  }
  each(F, (z, y, i, u, v) => {
    // the smear round the mouth: widest at the corners and below
    // distance to the mouth's outline (an ellipse about the lips), the smear is a ring round it,
    // heavier at the corners and under the lower lip
    const ez = z * FACE.RZ / 1.05, ey = (y - FACE.MY + 0.05) * FACE.RY / 0.42;
    const rd = Math.abs(Math.hypot(ez, ey) - 0.75);
    const corner = gauss(Math.abs(ez) - 0.95, 0.35) * 0.6 + 0.1 + 0.4 * smooth(0.3, -0.5, ey);
    const brk = fbm(u, v, 18, 4, F.seed + 52) * 0.5 + 0.5;
    const sm = gauss(rd, 0.35 + 0.25 * (o.smear ?? 1)) * corner;
    const t = Math.max(m[i] * (0.75 + 0.35 * brk), smooth(0.25, 0.55, sm * (o.smear ?? 1) * (0.4 + 1.0 * brk)) * 0.9);
    if (t <= 0.02) return;
    const fresh = o.fresh ?? 0.5;
    const fr = clamp01(fresh + (brk - 0.5) * 0.6 - (1 - m[i]) * 0.2);
    const c = mixc(lin('#2a0b07'), lin('#4e0806'), fr);
    const crack = (1 - fr) * Math.pow(ridged(u, v, 90, 2, F.seed + 53), 12);
    paint(F, i, mixc(c, sc(c, 0.4), crack), t * 0.97, { rough: mix(0.8, 0.14, fr), h: t * (0.15 + (1 - fr) * 0.15) - crack * 0.2, abs: 1 });
  });
}

/** The rotted-away nose: a dark triangular cavity with ragged, crusted edges. */
function noseCavity(F) {
  each(F, (z, y, i, u, v) => {
    if (y > 0.1 || y < -0.32) return;
    const t = clamp01((0.05 - y) / 0.32);
    const half = 0.035 + t * 0.09;
    const n = fbm(u, v, 30, 3, F.seed + 61) * 0.045;
    const d = (Math.abs(z) - half - n) / 0.03;
    if (d > 2.5) return;
    const inner = smooth(0.5, -0.5, d), rim = smooth(2.5, 0.5, d) * (1 - inner);
    const split = gauss(z * FACE.RZ, 0.03) * smooth(-0.05, -0.2, y);   // the septum ridge
    paint(F, i, mixc(lin('#140605'), lin('#3c1610'), split), inner, { rough: 0.4, h: -1.6 * inner + split * 0.6, abs: 1 });
    paint(F, i, lin('#3a1c14'), rim * 0.85, { rough: 0.75, h: rim * 0.3, abs: 0.7 });
  });
}

/** A torn cheek: a ragged hole onto the molars and gums, red muscle fibres at its edges. */
function tornCheek(F, o) {
  const s = o.side ?? 1, cz = s * 0.52, cy = -0.36;
  each(F, (z, y, i, u, v) => {
    const dz = (z - cz) * FACE.RZ, dy = (y - cy) * FACE.RY;
    const n = fbm(u, v, 22, 4, F.seed + 71) * 0.35;
    const d = Math.hypot(dz / 0.75, dy / 0.45) * (1 + n);
    if (d > 1.8) return;
    if (d < 1) {
      // inside: the molars on their gums, a dark gap between the rows
      const row = Math.abs(dy) < 0.06 ? 0 : dy > 0 ? 1 : -1;
      const tooth = smooth(0.35, 0.7, Math.abs(Math.sin(dz * 9 + noise(dz * 3, row * 5, 64, 64, F.seed + 73) * 1.2))) * (0.6 + 0.4 * (fbm(u, v, 60, 2, F.seed + 74) * 0.5 + 0.5));
      const gumK = smooth(0.12, 0.3, Math.abs(dy));
      let c = row === 0 ? lin('#120403') : mixc(mixc(lin('#8a7448'), lin('#4a3a22'), fbm(u, v, 80, 2, F.seed + 75) * 0.5 + 0.5), lin('#5c1c1a'), gumK);
      c = mixc(c, lin('#1a0605'), (1 - tooth) * (1 - gumK) * 0.7);
      paint(F, i, c, 1, { rough: 0.35, h: -1.2 + tooth * 0.4, abs: 1 });
    } else {
      // the edge: muscle fibres running back toward the ear, then torn skin
      const fib = Math.abs(noise(dy * 30, dz * 4, 64, 16, F.seed + 72));
      const t = smooth(1.8, 1.05, d);
      paint(F, i, mixc(lin('#6a1a14'), lin('#3a0c0a'), fib), t * smooth(1.6, 1.2, d), { rough: 0.3, h: -0.6 * t, abs: 1 });
      paint(F, i, lin('#2c0c08'), smooth(1.2, 1.0, d) * 0.9, { rough: 0.4, abs: 1 });
    }
  });
}

/** A bite: crescents of tooth marks round a torn-out chunk, bruising about it. */
function bite(F, o) {
  const cz = o.z, cy = o.y;
  each(F, (z, y, i, u, v) => {
    const dz = (z - cz) * FACE.RZ, dy = (y - cy) * FACE.RY;
    const R = o.r ?? 0.5;
    const d = Math.hypot(dz, dy * 1.2) / R;
    if (d > 2.0) return;
    const ang = Math.atan2(dy, dz);
    const n = fbm(u, v, 25, 3, F.seed + 81) * 0.25;
    const bruise = smooth(2.0, 1.1, d);
    paint(F, i, lin('#4a3048'), bruise * 0.55, { abs: 0 });
    const marks = smooth(0.25, 0.0, Math.abs(d - 0.95)) * smooth(0.55, 0.95, Math.abs(Math.cos(ang * 6)));
    paint(F, i, lin('#3a0605'), marks, { rough: 0.3, h: -0.6 * marks, abs: 1 });
    if (d < 0.75 + n) {
      const k = smooth(0.75 + n, 0.55 + n, d);
      const fib = Math.abs(noise(dz * 12, dy * 12, 64, 64, F.seed + 82));
      paint(F, i, mixc(lin('#5e1210'), lin('#2a0504'), fib), k, { rough: 0.22, h: -1.0 * k, abs: 1 });
    }
  });
}

/** Matted hair and bare patches along the hairline, and a scalp gone grey-brown. */
function hairline(F, o) {
  const hair = lin(o.hair || '#2a221c'), scalp = lin('#6a5a4c');
  const N = F.N, r = rng(F.seed + 91);
  const m = new Float32Array(N * N);
  for (let k = 0; k < 900; k++) {
    const z = (r() - 0.5) * 2.0, y0 = 0.62 + r() * 0.35 + Math.abs(z) * -0.12;
    const L = 0.08 + r() * 0.25, w = 0.0012 + r() * 0.0014;
    const pts = [];
    let zz = z;
    for (let s = 0; s <= 8; s++) { const t = s / 8; zz += (r() - 0.5) * 0.02 + z * 0.006; const [u, v] = UV(zz, y0 - L * t); pts.push([u, v, w]); }
    stroke(m, N, pts, (d) => 1 - d, 'max', false);
  }
  const mm = blur(m, N, Math.max(1, N / 2048), false);
  each(F, (z, y, i, u, v) => {
    const line = 0.62 - z * z * 0.18 + fbm(u, v, 8, 3, F.seed + 92) * 0.06;
    if (y < line - 0.15) return;
    const bald = smooth(0.55, 0.7, fbm(u, v, 5, 4, F.seed + 93) * 0.5 + 0.5) * (o.bald ?? 0.6);
    const up = smooth(line - 0.12, line + 0.05, y);
    paint(F, i, scalp, up * bald * 0.5, { abs: 0 });
    const t = clamp01(mm[i] * 1.5) * up * (1 - bald * 0.8);
    paint(F, i, mixc(hair, sc(hair, 1.6), fbm(u, v, 70, 2, F.seed + 94) * 0.5 + 0.5), t, { rough: 0.6, h: t * 0.4, abs: 0.3 });
  });
}

/** Skin slipping off the forehead or a cheek: raw dermis with a curled rim. */
function faceSlip(F, o) {
  each(F, (z, y, i, u, v) => {
    const d = pd(z, y, o.z, o.y) / (o.r ?? 0.8);
    const n = fbm(u, v, 12, 4, F.seed + 101) * 0.4;
    const q = d * (1 + n);
    if (q > 1.25) return;
    const inside = smooth(1.0, 0.92, q), ring = smooth(1.25, 1.05, q) * (1 - inside);
    paint(F, i, mixc(lin('#8a5444'), lin('#a88a5c'), fbm(u, v, 40, 2, F.seed + 102) * 0.5 + 0.5), inside, { rough: 0.32, h: -0.5 * inside, abs: 0.6 });
    paint(F, i, lin('#c4bba8'), ring * 0.7, { rough: 0.8, h: ring * 0.9, abs: 0.3 });
  });
}

/** Marbling across the face (weeks): dark green-brown veins at the temples and jaw. */
function faceVeins(F, o) {
  const N = F.N, r = rng(F.seed + 111);
  const m = new Float32Array(N * N);
  for (let k = 0; k < (o.count ?? 10); k++) {
    const s = r() < 0.5 ? -1 : 1;
    const [u, v] = UV(s * (0.55 + r() * 0.4), -0.6 + r() * 1.2);
    tree(r, u, v, Math.PI * (s > 0 ? 1 : 0) + (r() - 0.5) * 1.2, 0.1 + r() * 0.12, 0.004 + r() * 0.003, 3, (pts) => stroke(m, N, pts, (d) => 1 - d * d, 'max', false), { curl: 0.6, split: 0.8, step: 0.003 });
  }
  const mm = blur(m, N, Math.max(1, N / 900), false);
  each(F, (z, y, i) => { if (mm[i] > 0.02) paint(F, i, lin(o.col || '#3c4632'), clamp01(mm[i]) * 0.55, { abs: 0 }); });
}

/** Months: the face shrunk onto the skull — deep hollows under the cheekbones and at the temples. */
function gauntness(F, o) {
  each(F, (z, y, i, u, v) => {
    let h = 0;
    for (const s of [-1, 1]) {
      h -= gauss(pd(z, y, s * 0.5, -0.36), 0.55) * 1.2;   // under the cheekbone
      h -= gauss(pd(z, y, s * 0.78, 0.22), 0.5) * 0.8;    // the temple
      h += gauss(pd(z, y, s * 0.55, -0.06), 0.3) * 0.6;   // the cheekbone
    }
    F.h[i] += h * (o.k ?? 1);
    const dk = clamp01(-h * 0.5) * (o.dark ?? 0.5);
    if (dk > 0.02) paint(F, i, lin('#3a2c22'), dk, { abs: 0 });
  });
}

function finish(F, o = {}) {
  const N = F.N;
  // creases and wrinkles everywhere (fine), and cavity darkening into the albedo
  const hb = blur(F.h, N, Math.max(1, N / 300), false);
  const ao = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    const cav = clamp01((hb[i] - F.h[i]) * 0.8);
    ao[i] = 1 - cav * 0.7;
    F.alb.scale(i, 0.7 + 0.3 * ao[i]);
    F.rough[i] = clamp01(F.rough[i]);
  }
  return { alb: F.alb, alpha: F.cov, h: F.h, rough: F.rough, ao, b: F.abs, nStrength: o.n ?? 10, wrap: false };
}

// ---------------------------------------------------------------------------------------
// the six faces: two fresh, two weeks dead, two months dead (B and D, F carry the rotted nose:
// the runtime only gives those to zombies without one)

/** A: freshly turned — bluish lips, bruised sockets, fresh blood down the chin. */
function faceA(N) {
  const F = fctx(N, 2101);
  sockets(F, { k: 0.6, col: '#4e3e4c' });
  creases(F, { k: 0.4, grime: 0.25 });
  lips(F, { kind: 'blue' });
  mouthBlood(F, { fresh: 0.9, runs: 10, smear: 1 });
  eyes(F, { milk: 0.55, blood: 1.0, iris: '#5a6a72', rim: 0.85 });
  return finish(F);
}

/** B: freshly turned, nose gone — a bite on the cheek, the blood half dried. */
function faceB(N) {
  const F = fctx(N, 2201);
  sockets(F, { k: 0.7 });
  creases(F, { k: 0.5, grime: 0.35 });
  lips(F, { kind: 'blue', k: 0.7 });
  noseCavity(F);
  bite(F, { z: -0.6, y: -0.25, r: 0.6 });
  mouthBlood(F, { fresh: 0.55, runs: 8, smear: 1.2 });
  eyes(F, { milk: 0.7, blood: 0.9, iris: '#6a5a40' });
  return finish(F);
}

/** C: weeks dead — marbled temples, cracked grey lips, a torn cheek onto the molars, dried blood. */
function faceC(N) {
  const F = fctx(N, 2301);
  sockets(F, { k: 0.75, col: '#3e3a32', bag: '#5a5446' });
  creases(F, { k: 0.6, grime: 0.45 });
  faceVeins(F, { count: 12 });
  lips(F, { kind: 'grey' });
  tornCheek(F, { side: 1 });
  mouthBlood(F, { fresh: 0.25, runs: 7, smear: 1.1 });
  eyes(F, { milk: 0.9, blood: 0.6, iris: '#606054', rim: 0.6 });
  hairline(F, { bald: 0.5 });
  return finish(F);
}

/** D: weeks dead, nose gone — skin slipping off the forehead, one eye gone milky-white, an ear torn. */
function faceD(N) {
  const F = fctx(N, 2401);
  sockets(F, { k: 0.8, col: '#3a3630' });
  creases(F, { k: 0.6, grime: 0.5 });
  faceVeins(F, { count: 8, col: '#3a3a2c' });
  lips(F, { kind: 'grey', k: 0.9 });
  noseCavity(F);
  faceSlip(F, { z: 0.3, y: 0.55, r: 0.9 });
  mouthBlood(F, { fresh: 0.3, runs: 10, smear: 0.8 });
  eyes(F, { milk: 1.0, blood: 0.5, iris: '#707066', milkCol: '#d6d8d2' });
  return finish(F);
}

/** E: months dead — lips gone to the gums, the face shrunk onto the skull, old black blood. */
function faceE(N) {
  const F = fctx(N, 2501);
  gauntness(F, { k: 1.0, dark: 0.55 });
  sockets(F, { k: 0.9, col: '#2c241c', bag: '#3a2e24' });
  creases(F, { k: 0.7, grime: 0.55, dirt: '#2e261c' });
  lips(F, { kind: 'gone' });
  mouthBlood(F, { fresh: 0.0, runs: 6, smear: 0.7 });
  eyes(F, { milk: 1.0, blood: 0.3, iris: '#585446', sclera: '#9a8c6a', rim: 0.4 });
  hairline(F, { bald: 0.75, hair: '#3a3028' });
  return finish(F, { n: 12 });
}

/** F: months dead, nose gone — one eye rotted out of a dark socket, lips gone, a torn cheek. */
function faceF(N) {
  const F = fctx(N, 2601);
  gauntness(F, { k: 1.1, dark: 0.6 });
  sockets(F, { k: 0.9, col: '#281e18', bag: '#36281e' });
  creases(F, { k: 0.75, grime: 0.6, dirt: '#2a2018' });
  lips(F, { kind: 'gone' });
  noseCavity(F);
  tornCheek(F, { side: -1 });
  mouthBlood(F, { fresh: 0.1, runs: 5, smear: 0.6 });
  eyes(F, { milk: 1.0, blood: 0.25, iris: '#565244', sclera: '#958666', rim: 0.35, gone: 1 });
  hairline(F, { bald: 0.85, hair: '#2a241e' });
  return finish(F, { n: 12 });
}

export const FACE_SETS = { 'face-a': faceA, 'face-b': faceB, 'face-c': faceC, 'face-d': faceD, 'face-e': faceE, 'face-f': faceF };
/** Per face: its decay stage (0 fresh, 1 weeks, 2 months) and whether it paints the rotted nose. */
export const FACE_INFO = { 'face-a': [0, 0], 'face-b': [0, 1], 'face-c': [1, 0], 'face-d': [1, 1], 'face-e': [2, 0], 'face-f': [2, 1] };
